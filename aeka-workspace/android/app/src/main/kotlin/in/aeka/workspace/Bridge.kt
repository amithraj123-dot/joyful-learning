package `in`.aeka.workspace

import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.webkit.JavascriptInterface
import `in`.aeka.workspace.core.Apps
import `in`.aeka.workspace.core.Json
import `in`.aeka.workspace.core.Protocol
import `in`.aeka.workspace.core.Texts

/**
 * `window.AekaAndroid` (protocol, "JavaScript bridge"). Methods run on the WebView's bridge thread.
 * Each one first checks that the page on screen is the workspace origin and does nothing for any
 * other page (value methods then return null). Results are JSON strings. The device token never
 * reaches the page.
 */
internal class Bridge(private val activity: MainActivity, private val origin: String) {
    /** The main frame's origin, updated by the WebViewClient on the UI thread. */
    @Volatile
    var currentOrigin: String? = null

    private val app = activity.applicationContext
    private val store = Store.get(app)

    private fun allowed(): Boolean = currentOrigin == origin

    @JavascriptInterface
    fun version(): String? = if (allowed()) Json.quote(Protocol.APP_VERSION) else null

    @JavascriptInterface
    fun status(): String? = if (allowed()) statusJson() else null

    @JavascriptInterface
    fun pair(code: String?) {
        if (!allowed()) return
        Syncer.get(app).pairAsync(code) { r ->
            activity.dispatch(event("paired", r))
            if (r.ok) activity.afterPairing()
        }
    }

    @JavascriptInterface
    fun unpair() {
        if (!allowed()) return
        Syncer.get(app).unpair()
    }

    @JavascriptInterface
    fun syncNow() {
        if (!allowed()) return
        if (!store.paired) {
            activity.dispatch(event("synced", Syncer.Result(false, Texts.NOT_PAIRED)))
            return
        }
        Syncer.get(app).syncAsync { r -> activity.dispatch(event("synced", r)) }
    }

    @JavascriptInterface
    fun openSettings(which: String?): String? {
        if (!allowed()) return null
        val ok = activity.onUi(false) { activity.openSettings(which) }
        return if (ok) Json.obj("ok" to true) else Json.obj("ok" to false, "error" to Texts.NO_SETTINGS)
    }

    @JavascriptInterface
    fun reply(chat: String?, text: String?): String? {
        if (!allowed()) return null
        if (!store.paired) return Json.obj("ok" to false, "reason" to "not_paired")
        return when (val r = LiveChats.reply(app, chat, text)) {
            is LiveChats.ReplyResult.Refused -> Json.obj("ok" to false, "reason" to r.reason)
            is LiveChats.ReplyResult.Sent -> {
                Syncer.recentReplies.record(r.event.chat, r.event.text, r.event.at)
                store.queue.addMessage(r.event.id, r.event.toJson())
                Syncer.get(app).syncAsync(null)
                Json.obj("ok" to true)
            }
        }
    }

    @JavascriptInterface
    fun openChat(chat: String?, address: String?): String? {
        if (!allowed()) return null
        val how = activity.onUi<String?>(null) { LiveChats.openChat(activity, chat, address) }
        return if (how != null) Json.obj("ok" to true, "how" to how) else Json.obj("ok" to false)
    }

    @JavascriptInterface
    fun copy(text: String?): String? {
        if (!allowed()) return null
        val ok = activity.onUi(false) {
            val cm = activity.getSystemService(ClipboardManager::class.java)
            if (cm == null) {
                false
            } else {
                cm.setPrimaryClip(ClipData.newPlainText(Texts.COPY_LABEL, text ?: ""))
                true
            }
        }
        return Json.obj("ok" to ok)
    }

    /** The status() object; also sent with `{ type: "status" }` events. */
    fun statusJson(): String {
        val paired = store.paired
        return Json.obj(
            "paired" to paired,
            "deviceName" to (store.deviceName ?: Device.name(app)),
            "notificationAccess" to Device.notificationAccess(app),
            "postNotifications" to Device.postNotifications(app),
            "batteryUnrestricted" to Device.batteryUnrestricted(app),
            "apps" to store.apps,
            "previewsHidden" to Apps.ALL.filter { it in store.previewsHidden },
            "live" to if (paired) LiveChats.replyable() else emptyList(),
            "pending" to store.queue.count(),
            "lastSyncAt" to (store.lastSyncAt ?: Json.Raw("null")),
            "lastError" to (store.lastError ?: Json.Raw("null")),
            "readerConnected" to (CaptureService.active != null),
            "appVersion" to Protocol.APP_VERSION,
            "android" to Build.VERSION.SDK_INT,
        )
    }

    private fun event(type: String, r: Syncer.Result): String =
        Json.obj("type" to type, "ok" to r.ok, "error" to r.error)
}
