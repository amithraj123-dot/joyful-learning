package `in`.aeka.workspace

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import `in`.aeka.workspace.core.Json
import `in`.aeka.workspace.core.Links
import `in`.aeka.workspace.core.Protocol
import `in`.aeka.workspace.core.Texts
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The workspace in a full-screen WebView, with the `AekaAndroid` bridge. */
class MainActivity : Activity() {
    companion object {
        const val EXTRA_LINK = "link"
        const val ACTION_OPEN = "in.aeka.workspace.OPEN"
        private const val REQ_POST = 11
        private const val REQ_FILE = 12

        // Opened by the system, not inside the WebView.
        private val EXTERNAL_SCHEMES = setOf("mailto", "tel", "sms", "smsto")
        private val EXTERNAL_HOSTS = setOf("wa.me", "api.whatsapp.com", "play.google.com")
    }

    private val origin = Syncer.workspaceOrigin()
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var bridge: Bridge
    private var pageReady = false
    private var mainFrameFailed = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var backCallback: Any? = null
    private var dark = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        Nudges.ensureChannel(this)
        bridge = Bridge(this, origin)

        root = FrameLayout(this).apply { setBackgroundColor(if (dark) Color.rgb(18, 18, 18) else Color.WHITE) }
        offline = buildOfflineView()
        web = createWebView()
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(offline, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        applyEdgeToEdge()

        // A restored activity is not a new nudge tap: its launch intent's link was handled before.
        val restored = savedInstanceState?.let { web.restoreState(it) } != null
        if (!restored) {
            val link = if (savedInstanceState == null) intent?.getStringExtra(EXTRA_LINK) else null
            intent?.removeExtra(EXTRA_LINK)
            web.loadUrl(if (link != null) Links.pageUrl(origin, link) else "$origin/")
        }

        Syncer.get(this).onStateChanged = { dispatchStatus() }
        val store = Store.get(this)
        if (store.paired) Jobs.schedulePeriodic(this, store.syncSeconds)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        dispatchStatus()
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        Syncer.get(this).onStateChanged = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        root.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Android 13 and later use the OnBackInvokedCallback registered in updateBack().")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    // WebView

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        val w = WebView(this)
        w.setBackgroundColor(if (dark) Color.rgb(18, 18, 18) else Color.WHITE)
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            safeBrowsingEnabled = true
            userAgentString = "$userAgentString AekaAndroid/${Protocol.APP_VERSION}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, true)
        }
        w.addJavascriptInterface(bridge, "AekaAndroid")
        w.webViewClient = Client()
        w.webChromeClient = Chrome()
        w.setDownloadListener { url, _, _, _, _ ->
            if (Links.isHttps(url)) openExternal(Uri.parse(url))
        }
        return w
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase()
            if (!request.isForMainFrame) return scheme != "https"
            if (scheme == "https") {
                if (uri.host?.lowercase() in EXTERNAL_HOSTS) {
                    openExternal(uri)
                    return true
                }
                // Leaving the workspace: close the bridge before the next page can run script.
                if (Links.origin(uri.toString()) != origin) bridge.currentOrigin = null
                return false
            }
            if (scheme in EXTERNAL_SCHEMES) openExternal(uri)
            // Anything else (http, intent, javascript, file, content, data) never loads.
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            bridge.currentOrigin = Links.origin(url)
            pageReady = false
            mainFrameFailed = false
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            bridge.currentOrigin = Links.origin(url)
            updateBack()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            bridge.currentOrigin = Links.origin(view.url)
            pageReady = bridge.currentOrigin == origin
            if (!mainFrameFailed) offline.visibility = View.GONE
            updateBack()
            if (pageReady) dispatchStatus()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                mainFrameFailed = true
                pageReady = false
                bridge.currentOrigin = null
                offline.visibility = View.VISIBLE
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The page's renderer stopped (out of memory or crashed): start a fresh WebView.
            bridge.currentOrigin = null
            root.removeView(web)
            web.destroy()
            web = createWebView()
            root.addView(web, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.loadUrl("$origin/")
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            try {
                startActivityForResult(params.createIntent(), REQ_FILE)
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                callback.onReceiveValue(null)
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            request.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun updateBack() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val want = web.canGoBack()
        if (want && backCallback == null) {
            val cb = OnBackInvokedCallback { if (web.canGoBack()) web.goBack() }
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
            backCallback = cb
        } else if (!want && backCallback != null) {
            onBackInvokedDispatcher.unregisterOnBackInvokedCallback(backCallback as OnBackInvokedCallback)
            backCallback = null
        }
    }

    // Layout

    /** Android 15 draws apps edge to edge: pad the content by the system bars, cut-out and keyboard. */
    private fun applyEdgeToEdge() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // Android 15 always draws edge to edge; earlier versions opt in.
            @Suppress("DEPRECATION")
            window.setDecorFitsSystemWindows(false)
        }
        window.insetsController?.setSystemBarsAppearance(
            if (dark) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        )
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsets.CONSUMED
        }
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    /** Shown when the workspace cannot load (offline). */
    private fun buildOfflineView(): View {
        val fg = if (dark) Color.rgb(236, 236, 236) else Color.rgb(32, 32, 32)
        val muted = if (dark) Color.rgb(180, 180, 180) else Color.rgb(90, 90, 90)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
            setBackgroundColor(if (dark) Color.rgb(18, 18, 18) else Color.WHITE)
            visibility = View.GONE
            isClickable = true
            addView(TextView(context).apply {
                text = Texts.OFFLINE_TITLE
                setTextColor(fg)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = Texts.OFFLINE_BODY
                setTextColor(muted)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                gravity = Gravity.CENTER
                setPadding(0, dp(12), 0, dp(24))
            })
            addView(Button(context).apply {
                text = Texts.RETRY
                setOnClickListener {
                    offline.visibility = View.GONE
                    val current = web.url?.takeIf { Links.isHttps(it) }
                    if (current == null || mainFrameFailed) web.loadUrl(current ?: "$origin/") else web.reload()
                }
            })
        }
    }

    // Links from nudges

    private fun handleLink(intent: Intent?) {
        val link = intent?.getStringExtra(EXTRA_LINK) ?: return
        intent.removeExtra(EXTRA_LINK)
        val (page, anchor) = Links.parse(link) ?: return
        val clean = page + (anchor?.let { "#$it" } ?: "")
        if (pageReady && bridge.currentOrigin == origin) {
            dispatch(Json.obj("type" to "open", "link" to clean))
        } else {
            web.loadUrl(Links.pageUrl(origin, clean))
        }
    }

    // Bridge support

    /** Sends `{ detail }` to the page as an "aeka-android" event, only while it shows the workspace. */
    fun dispatch(detailJson: String) {
        runOnUiThread {
            if (isDestroyed || Links.origin(web.url) != origin) return@runOnUiThread
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent(\"aeka-android\",{detail:$detailJson}));",
                null,
            )
        }
    }

    fun dispatchStatus() {
        // status() reads the queue, so build it off the UI thread.
        Thread {
            val status = try {
                bridge.statusJson()
            } catch (_: RuntimeException) {
                return@Thread
            }
            dispatch(Json.obj("type" to "status", "status" to Json.Raw(status)))
        }.start()
    }

    /** Runs [block] on the UI thread and waits for it (up to five seconds). */
    fun <T> onUi(fallback: T, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val latch = CountDownLatch(1)
        var result = fallback
        runOnUiThread {
            try {
                result = block()
            } catch (_: RuntimeException) {
                // Keep the fallback.
            } finally {
                latch.countDown()
            }
        }
        return if (latch.await(5, TimeUnit.SECONDS)) result else fallback
    }

    /** After the first pairing: ask for permission to show nudges, if not asked before. */
    fun afterPairing() {
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                !Store.get(this).askedPostNotifications
            ) {
                Store.get(this).askedPostNotifications = true
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_POST)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_POST) dispatchStatus()
    }

    /** openSettings(which). UI thread. */
    @SuppressLint("BatteryLife")
    fun openSettings(which: String?): Boolean {
        val pkg = Uri.parse("package:$packageName")
        return when (which) {
            "notifications" -> {
                val detail = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, Device.captureComponent(this).flattenToString())
                } else {
                    null
                }
                (detail != null && start(detail)) || start(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            "battery" ->
                start(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)) ||
                    start(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            "app" -> start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
            "post" -> requestPostNotifications()
            else -> false
        }
    }

    private fun requestPostNotifications(): Boolean {
        val store = Store.get(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            (!store.askedPostNotifications || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
        ) {
            store.askedPostNotifications = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_POST)
            return true
        }
        // Granted already, refused for good, or Android 12 and earlier: the app's notification settings.
        return start(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }

    private fun start(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }

    private fun openExternal(uri: Uri) {
        start(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
