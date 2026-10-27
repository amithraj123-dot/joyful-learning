package `in`.aeka.workspace

import android.app.Notification
import android.app.Person
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.service.notification.StatusBarNotification
import `in`.aeka.workspace.core.RawMessage
import `in`.aeka.workspace.core.RawNotification

/** Converts a StatusBarNotification into the plain [RawNotification] the core module reads. */
internal object NotificationReader {
    // Extra keys, written out so they also read on API levels before the constant was public.
    private const val EXTRA_IS_GROUP_CONVERSATION = "android.isGroupConversation"
    private const val EXTRA_MESSAGING_PERSON = "android.messagingUser"
    private const val EXTRA_SELF_DISPLAY_NAME = "android.selfDisplayName"

    // Keys inside each android.messages bundle (Notification.MessagingStyle.Message).
    private const val KEY_TEXT = "text"
    private const val KEY_TIME = "time"
    private const val KEY_SENDER = "sender"
    private const val KEY_SENDER_PERSON = "sender_person"

    fun read(sbn: StatusBarNotification): RawNotification {
        val n = sbn.notification
        val ex = n.extras ?: Bundle.EMPTY
        val self = person(ex, EXTRA_MESSAGING_PERSON)
        return RawNotification(
            packageName = sbn.packageName,
            postTime = sbn.postTime,
            whenTime = n.`when`,
            key = sbn.key,
            tag = sbn.tag,
            shortcutId = n.shortcutId,
            category = n.category,
            channelId = n.channelId,
            isGroupSummary = (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
            isOngoing = sbn.isOngoing || (n.flags and Notification.FLAG_ONGOING_EVENT) != 0,
            isForegroundService = (n.flags and Notification.FLAG_FOREGROUND_SERVICE) != 0,
            title = text(ex, Notification.EXTRA_TITLE),
            text = text(ex, Notification.EXTRA_TEXT),
            bigText = text(ex, Notification.EXTRA_BIG_TEXT),
            subText = text(ex, Notification.EXTRA_SUB_TEXT),
            textLines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.mapNotNull { it?.toString() } ?: emptyList(),
            conversationTitle = text(ex, Notification.EXTRA_CONVERSATION_TITLE),
            isGroupConversation = if (ex.containsKey(EXTRA_IS_GROUP_CONVERSATION)) ex.getBoolean(EXTRA_IS_GROUP_CONVERSATION) else null,
            selfName = text(ex, EXTRA_SELF_DISPLAY_NAME) ?: self?.name?.toString(),
            selfKey = self?.key,
            messages = messages(ex),
            hasReplyAction = replyAction(n) != null,
        )
    }

    private fun text(ex: Bundle, key: String): String? = try {
        ex.getCharSequence(key)?.toString()
    } catch (_: RuntimeException) {
        null
    }

    private data class P(val name: CharSequence?, val key: String?)

    private fun person(b: Bundle, key: String): P? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        return try {
            @Suppress("DEPRECATION")
            val p = b.getParcelable<Parcelable>(key) as? Person ?: return null
            P(p.name, p.key)
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun messages(ex: Bundle): List<RawMessage> {
        val arr: Array<Parcelable>? = try {
            @Suppress("DEPRECATION")
            ex.getParcelableArray(Notification.EXTRA_MESSAGES)
        } catch (_: RuntimeException) {
            null
        }
        if (arr.isNullOrEmpty()) return emptyList()
        return arr.mapNotNull { item ->
            val b = item as? Bundle ?: return@mapNotNull null
            val person = person(b, KEY_SENDER_PERSON)
            val sender = b.getCharSequence(KEY_SENDER)?.toString() ?: person?.name?.toString()
            RawMessage(
                text = b.getCharSequence(KEY_TEXT)?.toString(),
                time = b.getLong(KEY_TIME, 0L),
                sender = sender,
                senderKey = person?.key,
            )
        }
    }

    /**
     * The notification's Reply action: one with a free-form RemoteInput, preferring the declared
     * reply semantic. A "mark as read" action is never chosen, even if it carries an input.
     */
    fun replyAction(n: Notification): Notification.Action? {
        val candidates = (n.actions?.toList() ?: emptyList()) + wearableActions(n)
        val withInput = candidates.filter { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            withInput.firstOrNull { it.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY }?.let { return it }
            return withInput.firstOrNull {
                it.semanticAction == Notification.Action.SEMANTIC_ACTION_NONE ||
                    it.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY
            }
        }
        return withInput.firstOrNull()
    }

    private fun wearableActions(n: Notification): List<Notification.Action> = try {
        @Suppress("DEPRECATION")
        Notification.WearableExtender(n).actions ?: emptyList()
    } catch (_: RuntimeException) {
        emptyList()
    }
}
