package `in`.aeka.workspace

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import `in`.aeka.workspace.core.Apps
import `in`.aeka.workspace.core.Links
import `in`.aeka.workspace.core.Protocol
import `in`.aeka.workspace.core.RecentReplies
import `in`.aeka.workspace.core.SyncPolicy
import `in`.aeka.workspace.core.Texts
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pairing and sync with the workspace. One worker thread, so syncs never overlap. New events
 * schedule a sync about five seconds later; failures retry with backoff through JobScheduler.
 */
internal class Syncer private constructor(context: Context) {
    data class Result(val ok: Boolean, val error: String?)

    companion object {
        @Volatile
        private var instance: Syncer? = null

        fun get(context: Context): Syncer =
            instance ?: synchronized(this) { instance ?: Syncer(context.applicationContext).also { instance = it } }

        /** Replies sent from Aeka recently, to skip WhatsApp's copy of them. */
        val recentReplies = RecentReplies()

        fun workspaceOrigin(): String = Links.origin(BuildConfig.WORKSPACE_ORIGIN) ?: Protocol.DEFAULT_ORIGIN
    }

    private val app = context.applicationContext
    private val store = Store.get(app)
    private val api = DeviceApi(workspaceOrigin())
    private val worker: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "aeka-sync").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var soonPending = false

    /** Called (on the worker thread) when the pairing or sync state changes; the page refreshes status(). */
    @Volatile
    var onStateChanged: (() -> Unit)? = null

    /** Sync about five seconds from now, unless one is already due. */
    fun requestSoon() {
        if (soonPending) return
        soonPending = true
        main.postDelayed({
            soonPending = false
            syncAsync(null)
        }, SyncPolicy.DEBOUNCE_MS)
    }

    fun syncAsync(done: ((Result) -> Unit)?) {
        worker.execute {
            val r = try {
                syncBlocking()
            } catch (_: RuntimeException) {
                Result(false, Texts.SERVER)
            }
            done?.invoke(r)
        }
    }

    fun pairAsync(code: String?, done: (Result) -> Unit) {
        worker.execute {
            val r = try {
                pairBlocking(code)
            } catch (_: RuntimeException) {
                Result(false, Texts.PAIR_FAILED)
            }
            done(r)
        }
    }

    fun unpair() {
        worker.execute {
            disconnect(null)
        }
    }

    private fun pairBlocking(code: String?): Result {
        val c = code?.trim()?.takeIf { it.isNotEmpty() && it.length <= 64 } ?: return Result(false, Texts.NO_CODE)
        val name = Device.name(app)
        val body = Protocol.pairBody(c, name, Device.model(), Protocol.APP_VERSION, Build.VERSION.SDK_INT)
        return when (val reply = api.post(body, null)) {
            is DeviceApi.Reply.Ok -> {
                val v = reply.value as? JSONObject ?: return Result(false, Texts.PAIR_FAILED)
                val token = v.optString("token", "").takeIf { it.isNotBlank() } ?: return Result(false, Texts.PAIR_FAILED)
                val member = v.optJSONObject("member")
                store.queue.clear()
                store.setPaired(
                    token = token,
                    deviceId = v.optString("deviceId", "").ifBlank { null },
                    deviceName = name,
                    memberName = member?.optString("name", "")?.ifBlank { null },
                    memberEmail = member?.optString("email", "")?.ifBlank { null },
                )
                Jobs.schedulePeriodic(app, store.syncSeconds)
                try {
                    NotificationListenerService.requestRebind(Device.captureComponent(app))
                } catch (_: RuntimeException) {
                    // Access not granted yet; the reader binds when it is.
                }
                CaptureService.active?.sweep()
                notifyChanged()
                // The first sync runs after the "paired" event has gone to the page.
                syncAsync(null)
                Result(true, null)
            }
            is DeviceApi.Reply.Unauthorised -> Result(false, reply.message ?: Texts.PAIR_FAILED)
            is DeviceApi.Reply.Failed -> Result(false, reply.message)
        }
    }

    /** Sends queued events (at most ten batches of 200, oldest first) and applies the reply. Worker thread only. */
    private fun syncBlocking(): Result {
        val token = store.token ?: return Result(false, Texts.NOT_PAIRED)
        var batches = 0
        while (true) {
            val rows = SyncPolicy.batch(store.queue.oldest(SyncPolicy.MAX_BATCH))
            val body = Protocol.syncBody(
                Protocol.APP_VERSION,
                Build.VERSION.SDK_INT,
                Device.access(app),
                rows.map { it.json },
                LiveChats.replyable(),
            )
            when (val reply = api.post(body, token)) {
                is DeviceApi.Reply.Ok -> {
                    store.queue.delete(rows.map { it.id })
                    (reply.value as? JSONObject)?.let { apply(it) }
                    store.lastSyncAt = System.currentTimeMillis()
                    store.lastError = null
                    store.failures = 0
                    Jobs.cancelRetry(app)
                }
                is DeviceApi.Reply.Unauthorised -> {
                    disconnect(Texts.DISCONNECTED)
                    return Result(false, Texts.DISCONNECTED)
                }
                is DeviceApi.Reply.Failed -> {
                    val failures = store.failures + 1
                    store.failures = failures
                    store.lastError = reply.message
                    Jobs.scheduleRetry(app, SyncPolicy.backoffMillis(failures))
                    notifyChanged()
                    return Result(false, reply.message)
                }
            }
            batches++
            if (rows.size < SyncPolicy.MAX_BATCH) break
            if (batches >= SyncPolicy.MAX_BATCHES_PER_RUN) {
                requestSoon()
                break
            }
        }
        store.queue.pruneSeen()
        notifyChanged()
        return Result(true, null)
    }

    private fun apply(value: JSONObject) {
        value.optJSONObject("apps")?.let { o ->
            val apps = Apps.ALL.filter { o.has(it) }.associateWith { o.optBoolean(it, true) }
            val merged = Apps.withDefaults(apps)
            store.apps = merged
            merged.filterValues { !it }.keys.forEach { LiveChats.removeApp(it) }
        }
        val notices: JSONArray? = value.optJSONArray("notices")
        if (notices != null) {
            for (i in 0 until notices.length()) {
                val n = notices.optJSONObject(i) ?: continue
                val id = n.optString("id", "").ifBlank { null } ?: continue
                Nudges.show(
                    app,
                    id = id,
                    title = n.optString("title", "").ifBlank { Texts.NUDGE_CHANNEL },
                    body = n.optString("body", ""),
                    link = n.optString("link", "").ifBlank { null },
                )
            }
        }
        if (value.has("syncSeconds")) {
            val period = SyncPolicy.periodSeconds(value.optLong("syncSeconds", SyncPolicy.MIN_PERIOD_SECONDS))
            if (period != store.syncSeconds) {
                store.syncSeconds = period
                Jobs.schedulePeriodic(app, period)
            }
        }
    }

    /** Forgets the token and queue and stops reading. [error] is kept for status() (null on unpair). */
    private fun disconnect(error: String?) {
        store.clearPairing(error)
        LiveChats.clear()
        Jobs.cancelAll(app)
        notifyChanged()
    }

    private fun notifyChanged() {
        try {
            onStateChanged?.invoke()
        } catch (_: RuntimeException) {
            // The page is gone.
        }
    }
}
