package `in`.aeka.workspace

import android.os.Handler
import android.os.HandlerThread
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import `in`.aeka.workspace.core.Apps
import `in`.aeka.workspace.core.ClearedEvent
import `in`.aeka.workspace.core.Extraction
import `in`.aeka.workspace.core.Extractor
import `in`.aeka.workspace.core.Protocol
import `in`.aeka.workspace.core.SyncPolicy

/**
 * Reads notifications from the chosen apps while this phone is paired. Work happens on a background
 * thread; nothing is logged. Message text goes only to the private queue and then to the workspace.
 */
class CaptureService : NotificationListenerService() {
    companion object {
        /** The connected reader, if any. */
        @Volatile
        internal var active: CaptureService? = null
            private set

        private const val SMS_REFRESH_MS = 60_000L
    }

    private lateinit var store: Store
    private lateinit var thread: HandlerThread
    private lateinit var work: Handler

    @Volatile
    private var defaultSms: String? = null
    private var smsCheckedAt = 0L

    /** `cleared` reports waiting out [SyncPolicy.CLEAR_GRACE_MS], by chat key. Worker thread only. */
    private val pendingCleared = HashMap<String, Runnable>()

    override fun onCreate() {
        super.onCreate()
        store = Store.get(this)
        thread = HandlerThread("aeka-capture").apply { start() }
        work = Handler(thread.looper)
    }

    override fun onDestroy() {
        if (active === this) active = null
        thread.quitSafely()
        super.onDestroy()
    }

    override fun onListenerConnected() {
        active = this
        if (store.paired) Jobs.schedulePeriodic(this, store.syncSeconds)
        sweep()
    }

    override fun onListenerDisconnected() {
        if (active === this) active = null
        LiveChats.clear()
        try {
            requestRebind(Device.captureComponent(this))
        } catch (_: RuntimeException) {
            // Access was withdrawn; nothing to rebind.
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val s = sbn ?: return
        work.post { safely { posted(s) } }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?, rankingMap: RankingMap?, reason: Int) {
        val s = sbn ?: return
        work.post { safely { removed(s, reason) } }
    }

    /** Reads every notification on screen now: after connecting, pairing, or apps changing. */
    internal fun sweep() {
        work.post {
            safely {
                if (!store.paired) return@safely
                val all = try {
                    activeNotifications
                } catch (_: RuntimeException) {
                    null
                }
                all?.forEach { posted(it) }
            }
        }
    }

    private fun appFor(packageName: String): String? {
        val now = System.currentTimeMillis()
        if (now - smsCheckedAt > SMS_REFRESH_MS) {
            defaultSms = Device.defaultSmsPackage(this)
            smsCheckedAt = now
        }
        val app = Apps.forPackage(packageName, defaultSms) ?: return null
        return app.takeIf { store.isEnabled(it) }
    }

    private fun posted(sbn: StatusBarNotification) {
        if (!store.paired) return
        val app = appFor(sbn.packageName) ?: return
        val raw = NotificationReader.read(sbn)
        when (val result = Extractor.extract(raw, app)) {
            is Extraction.Messages -> {
                pendingCleared.remove(result.chat.chat)?.let { work.removeCallbacks(it) }
                LiveChats.put(
                    LiveChat(
                        notificationKey = sbn.key,
                        ref = result.chat,
                        selfName = raw.selfName,
                        reply = NotificationReader.replyAction(sbn.notification),
                        contentIntent = sbn.notification.contentIntent,
                    ),
                )
                var added = 0
                for (m in result.messages) {
                    if (m.fromMe && Syncer.recentReplies.isEcho(m.chat, m.text, m.at)) {
                        store.queue.markSeen(m.id)
                        continue
                    }
                    if (store.queue.addMessage(m.id, m.toJson())) added++
                }
                store.setPreviewsHidden(app, false)
                if (added > 0) Syncer.get(this).requestSoon()
            }
            is Extraction.PreviewsHidden -> store.setPreviewsHidden(app, true)
            is Extraction.Dropped -> Unit
        }
    }

    private fun removed(sbn: StatusBarNotification, reason: Int) {
        if (!store.paired) return
        val app = appFor(sbn.packageName) ?: return
        val result = Extractor.extract(NotificationReader.read(sbn), app) as? Extraction.Messages ?: return
        val chat = result.chat.chat
        LiveChats.removeIfKey(chat, sbn.key)
        val event = ClearedEvent(app, chat, System.currentTimeMillis(), Protocol.clearedReason(reason)).toJson()
        pendingCleared.remove(chat)?.let { work.removeCallbacks(it) }
        val report = Runnable {
            safely {
                pendingCleared.remove(chat)
                if (!store.paired) return@safely
                store.queue.addEvent(event)
                Syncer.get(this).requestSoon()
            }
        }
        pendingCleared[chat] = report
        work.postDelayed(report, SyncPolicy.CLEAR_GRACE_MS)
    }

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (_: RuntimeException) {
            // A malformed notification from another app must not stop the reader. Not logged:
            // the exception could carry message text.
        }
    }
}
