package `in`.aeka.workspace

import android.app.ActivityOptions
import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import `in`.aeka.workspace.core.Apps
import `in`.aeka.workspace.core.ChatKeys
import `in`.aeka.workspace.core.ChatRef
import `in`.aeka.workspace.core.Extractor
import `in`.aeka.workspace.core.MessageEvent
import `in`.aeka.workspace.core.Text
import java.util.concurrent.ConcurrentHashMap

/** A chat with a notification on screen now. Held in memory only; rebuilt when the reader reconnects. */
internal data class LiveChat(
    val notificationKey: String,
    val ref: ChatRef,
    val selfName: String?,
    val reply: Notification.Action?,
    val contentIntent: PendingIntent?,
)

/**
 * Live notifications per chat key, with their Reply action and tap action. Only the Reply action is
 * ever fired, and only when the person taps Send in the workspace.
 */
internal object LiveChats {
    private val chats = ConcurrentHashMap<String, LiveChat>()

    fun put(c: LiveChat) {
        chats[c.ref.chat] = c
    }

    fun get(chat: String): LiveChat? = chats[chat]

    /** Removes the chat when this notification is the one recorded for it. */
    fun removeIfKey(chat: String, notificationKey: String) {
        chats[chat]?.let { if (it.notificationKey == notificationKey) chats.remove(chat, it) }
    }

    fun removeApp(app: String) {
        chats.values.removeAll { it.ref.app == app }
    }

    fun clear() = chats.clear()

    /** Chat keys that can be replied to right now (the sync `live` list). */
    fun replyable(): List<String> = chats.values.filter { it.reply != null }.map { it.ref.chat }.sorted()

    sealed interface ReplyResult {
        data class Sent(val event: MessageEvent) : ReplyResult
        data class Refused(val reason: String) : ReplyResult
    }

    /**
     * Sends [text] through the chat's live Reply action, as if typed into the notification. Returns
     * the `fromMe` message to queue, or the reason it was not sent (`not_live`, `failed`).
     */
    fun reply(context: Context, chat: String?, text: String?): ReplyResult {
        val live = chat?.let { chats[it] } ?: return ReplyResult.Refused("not_live")
        val action = live.reply ?: return ReplyResult.Refused("not_live")
        val inputs = action.remoteInputs?.takeIf { it.isNotEmpty() } ?: return ReplyResult.Refused("failed")
        val body = Text.body(text) ?: return ReplyResult.Refused("failed")

        val results = Bundle()
        for (input in inputs) if (input.allowFreeFormInput) results.putCharSequence(input.resultKey, body)
        val fill = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        RemoteInput.addResultsToIntent(inputs, fill, results)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            RemoteInput.setResultsSource(fill, RemoteInput.SOURCE_FREE_FORM_INPUT)
        }
        try {
            action.actionIntent.send(context, 0, fill, null, null, null, startOptions())
        } catch (_: PendingIntent.CanceledException) {
            chats.remove(live.ref.chat, live)
            return ReplyResult.Refused("failed")
        } catch (_: RuntimeException) {
            return ReplyResult.Refused("failed")
        }

        val now = System.currentTimeMillis()
        val sender = Text.truncate(Text.name(live.selfName) ?: Extractor.ME, Text.MAX_SENDER)
        val ref = live.ref
        return ReplyResult.Sent(
            MessageEvent(
                id = ChatKeys.messageId(ref.chat, sender, now, body),
                app = ref.app,
                chat = ref.chat,
                title = ref.title,
                group = ref.group,
                sender = sender,
                fromMe = true,
                text = body,
                at = now,
                address = ref.address,
            ),
        )
    }

    /**
     * Opens the chat: the live notification's own tap action, else `https://wa.me/<digits>` for
     * WhatsApp (or an SMS compose screen for SMS), else the app. Returns `how`, or null on failure.
     * Call from the foreground activity.
     */
    fun openChat(context: Context, chat: String?, address: String?): String? {
        val live = chat?.let { chats[it] }
        live?.contentIntent?.let { pi ->
            try {
                pi.send(context, 0, null, null, null, null, startOptions())
                return "notification"
            } catch (_: PendingIntent.CanceledException) {
                chats.remove(live.ref.chat, live)
            } catch (_: RuntimeException) {
                // Fall through to the link.
            }
        }
        val app = chat?.let { Apps.ofChat(it) } ?: live?.ref?.app
        val digits = (address ?: live?.ref?.address)?.filter { it.isDigit() }?.takeIf { it.length in 7..15 }
        if (digits != null && (app == Apps.WHATSAPP || app == Apps.WHATSAPP_BUSINESS)) {
            val view = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val pkg = Apps.launchPackage(app, null)
            if (pkg != null && start(context, Intent(view).setPackage(pkg))) return "link"
            if (start(context, view)) return "link"
        }
        if (digits != null && app == Apps.SMS) {
            if (start(context, Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return "link"
        }
        val pkg = app?.let { Apps.launchPackage(it, Device.defaultSmsPackage(context)) } ?: return null
        val launch = context.packageManager.getLaunchIntentForPackage(pkg) ?: return null
        return if (start(context, launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) "app" else null
    }

    private fun start(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (_: RuntimeException) {
        false
    }

    /**
     * From Android 14 a PendingIntent sent by an app in the foreground may start the other app's
     * activity only if the sender allows it. Aeka only sends while the person is using it.
     */
    private fun startOptions(): Bundle? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return null
        return ActivityOptions.makeBasic()
            .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            .toBundle()
    }
}
