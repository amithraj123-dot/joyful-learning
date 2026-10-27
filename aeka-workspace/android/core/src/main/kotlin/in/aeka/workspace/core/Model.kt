package `in`.aeka.workspace.core

/**
 * One message inside a notification's `MessagingStyle` (`android.messages`). A null [sender] and a
 * null [senderKey] mean the phone's owner wrote it (the MessagingStyle convention).
 */
data class RawMessage(
    val text: String?,
    val time: Long,
    val sender: String?,
    val senderKey: String? = null,
)

/**
 * A notification as plain data. The Android layer fills this from a StatusBarNotification and its
 * extras; everything after that (filters, chat keys, ids) is in this module and tested.
 */
data class RawNotification(
    val packageName: String,
    val postTime: Long,
    val whenTime: Long = 0,
    val key: String = "",
    val tag: String? = null,
    val shortcutId: String? = null,
    val category: String? = null,
    val channelId: String? = null,
    val isGroupSummary: Boolean = false,
    val isOngoing: Boolean = false,
    val isForegroundService: Boolean = false,
    /** `android.title` */
    val title: String? = null,
    /** `android.text` */
    val text: String? = null,
    /** `android.bigText` */
    val bigText: String? = null,
    /** `android.subText` */
    val subText: String? = null,
    /** `android.textLines` (InboxStyle) */
    val textLines: List<String> = emptyList(),
    /** `android.conversationTitle` */
    val conversationTitle: String? = null,
    /** `android.isGroupConversation`, null when the extra is absent */
    val isGroupConversation: Boolean? = null,
    /** `android.selfDisplayName` or the `android.messagingUser` person's name */
    val selfName: String? = null,
    /** The `android.messagingUser` person's key */
    val selfKey: String? = null,
    /** `android.messages` */
    val messages: List<RawMessage> = emptyList(),
    /** True when an action carries a free-form RemoteInput (a Reply action). */
    val hasReplyAction: Boolean = false,
)

/** The chat a notification belongs to. */
data class ChatRef(
    val app: String,
    val chat: String,
    val title: String,
    val group: Boolean,
    val address: String?,
)

/** A `message` event (protocol "sync"). */
data class MessageEvent(
    val id: String,
    val app: String,
    val chat: String,
    val title: String,
    val group: Boolean,
    val sender: String,
    val fromMe: Boolean,
    val text: String,
    val at: Long,
    val address: String?,
) {
    fun toJson(): String = Json.obj(
        "type" to "message",
        "id" to id,
        "app" to app,
        "chat" to chat,
        "title" to title,
        "group" to group,
        "sender" to sender,
        "fromMe" to fromMe,
        "text" to text,
        "at" to at,
        "address" to address,
    )
}

/** A `cleared` event (protocol "sync"). */
data class ClearedEvent(
    val app: String,
    val chat: String,
    val at: Long,
    val reason: String,
) {
    fun toJson(): String = Json.obj(
        "type" to "cleared",
        "app" to app,
        "chat" to chat,
        "at" to at,
        "reason" to reason,
    )
}

/** Why a notification was not turned into messages. */
enum class DropReason {
    /** FLAG_GROUP_SUMMARY */
    SUMMARY,

    /** Ongoing or foreground-service notification */
    ONGOING,

    /** The app's own status notice ("Checking for new messages", "N messages from M chats") */
    STATUS,

    /** A call in progress or ringing */
    CALL,

    /** A one-time password or verification code */
    OTP,

    /** Not a conversation (for example a LinkedIn profile view) */
    NOISE,

    /** Nothing to read */
    EMPTY,
}

sealed interface Extraction {
    data class Dropped(val reason: DropReason) : Extraction

    /** The notification hides its text ("New message"); reported in status(), nothing queued. */
    data class PreviewsHidden(val app: String) : Extraction

    data class Messages(val chat: ChatRef, val messages: List<MessageEvent>) : Extraction
}
