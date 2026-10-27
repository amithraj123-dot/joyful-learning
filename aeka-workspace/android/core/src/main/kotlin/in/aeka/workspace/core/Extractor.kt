package `in`.aeka.workspace.core

/**
 * Turns one notification into chat messages, or says why it is dropped. Pure and deterministic:
 * the same notification always gives the same events and ids, so WhatsApp's repeated history
 * collapses to one message each.
 */
object Extractor {
    /** Sender name for the phone owner's own messages when the notification does not name them. */
    const val ME = "Me"

    private val APP_LABELS = setOf("whatsapp", "whatsapp business", "messages", "gmail", "linkedin", "teams", "microsoft teams", "slack")

    // Older WhatsApp group notifications without MessagingStyle: title "Priya @ Family".
    private val AT_GROUP_TITLE = Regex("^(.{1,80}?) @ (.{1,200})$")

    // Text "Priya: Running late" inside a group notification without MessagingStyle.
    private val SENDER_PREFIX = Regex("^([^:\\n]{1,80}): (.+)$", RegexOption.DOT_MATCHES_ALL)

    fun extract(n: RawNotification, app: String): Extraction {
        if (n.isGroupSummary) return Extraction.Dropped(DropReason.SUMMARY)
        if (n.isOngoing || n.isForegroundService) return Extraction.Dropped(DropReason.ONGOING)
        val styled = n.messages.filter { Text.body(it.text) != null }
        return if (styled.isNotEmpty()) fromMessagingStyle(n, app, styled) else fromPlain(n, app)
    }

    private fun fromMessagingStyle(n: RawNotification, app: String, styled: List<RawMessage>): Extraction {
        val title = Text.name(n.title)
        val conv = Text.name(n.conversationTitle)
        val group = n.isGroupConversation ?: (conv != null && conv != title)
        val chatTitle = conv ?: title ?: return Extraction.Dropped(DropReason.EMPTY)
        val chat = ChatKeys.chatKey(app, n.shortcutId, n.tag, chatTitle, chatTitle)
            ?: return Extraction.Dropped(DropReason.EMPTY)
        val ref = ChatRef(
            app = app,
            chat = chat,
            title = Text.truncate(chatTitle, Text.MAX_TITLE),
            group = group,
            address = ChatKeys.address(app, ChatKeys.stableId(chat), if (group) null else chatTitle),
        )
        val selfName = Text.name(n.selfName)
        var hidden = false
        var otp = false
        val out = ArrayList<MessageEvent>(styled.size)
        for (m in styled) {
            val body = Text.body(m.text) ?: continue
            if (Filters.isHiddenPreview(body)) {
                hidden = true
                continue
            }
            if (Filters.isOtp(body)) {
                otp = true
                continue
            }
            val senderName = Text.name(m.sender)
            val fromMe = isSelf(m, senderName, n.selfKey, selfName)
            val sender = when {
                fromMe -> selfName ?: ME
                group -> senderName ?: chatTitle
                else -> chatTitle
            }
            out += message(ref, sender, fromMe, body, atOf(m.time, n))
        }
        return finish(ref, out, hidden, otp)
    }

    private fun fromPlain(n: RawNotification, app: String): Extraction {
        val title = Text.name(n.title)
        val text = Text.clean(n.text)

        missedCall(n, app, title, text)?.let { return it }
        if (Filters.isCallInProgress(n.category, title, text)) return Extraction.Dropped(DropReason.CALL)
        if (Filters.isDroppedCategory(n.category)) return Extraction.Dropped(DropReason.STATUS)
        if (Filters.isStatusNotice(title, text)) return Extraction.Dropped(DropReason.STATUS)

        if (app == Apps.GMAIL) return gmail(n, title, text)

        if (Filters.isHiddenPreview(text) || (text == null && Filters.isHiddenPreview(title))) {
            return Extraction.PreviewsHidden(app)
        }
        if (app == Apps.LINKEDIN && n.category != "msg" && n.channelId?.contains("messag", true) != true &&
            Filters.isLinkedInNoise(title, text)
        ) {
            return Extraction.Dropped(DropReason.NOISE)
        }

        var conv = Text.name(n.conversationTitle)
        var sender: String? = null
        if ((app == Apps.WHATSAPP || app == Apps.WHATSAPP_BUSINESS) && conv == null && title != null) {
            AT_GROUP_TITLE.matchEntire(title)?.let {
                sender = Text.name(it.groupValues[1])
                conv = Text.name(it.groupValues[2])
            }
        }
        val group = n.isGroupConversation ?: (conv != null && conv != title)
        val chatTitle = conv ?: title ?: return Extraction.Dropped(DropReason.EMPTY)
        var body = Text.body(longer(n.bigText, text)) ?: Text.body(n.textLines.lastOrNull())
            ?: return Extraction.Dropped(DropReason.EMPTY)
        if (group && sender == null) {
            SENDER_PREFIX.matchEntire(body)?.let {
                sender = Text.name(it.groupValues[1])
                body = Text.body(it.groupValues[2]) ?: body
            }
        }
        if (Filters.isOtp(body)) return Extraction.Dropped(DropReason.OTP)
        if (conv == null && n.shortcutId == null && chatTitle.lowercase() in APP_LABELS) {
            // A notice titled with the app's own name ("WhatsApp", "Slack") is not a chat.
            return Extraction.Dropped(DropReason.STATUS)
        }
        val chat = ChatKeys.chatKey(app, n.shortcutId, n.tag, chatTitle, chatTitle)
            ?: return Extraction.Dropped(DropReason.EMPTY)
        val ref = ChatRef(
            app = app,
            chat = chat,
            title = Text.truncate(chatTitle, Text.MAX_TITLE),
            group = group,
            address = ChatKeys.address(app, ChatKeys.stableId(chat), if (group) null else chatTitle),
        )
        val from = if (group) sender ?: chatTitle else chatTitle
        return finish(ref, listOf(message(ref, from, false, body, atOf(0, n))), hidden = false, otp = false)
    }

    private fun gmail(n: RawNotification, title: String?, subject: String?): Extraction {
        val sender = title ?: return Extraction.Dropped(DropReason.EMPTY)
        // "3 new messages" as a title is Gmail's own count, not a sender.
        if (Filters.isHiddenPreview(sender)) return Extraction.Dropped(DropReason.STATUS)
        val big = Text.body(n.bigText)
        val body = when {
            big != null && subject != null && !big.startsWith(subject) -> "$subject\n$big"
            big != null -> big
            else -> subject
        }?.let { Text.body(it) } ?: return Extraction.Dropped(DropReason.EMPTY)
        if (Filters.isOtp(body)) return Extraction.Dropped(DropReason.OTP)
        val chat = ChatKeys.chatKey(Apps.GMAIL, n.shortcutId, n.tag, sender, sender)
            ?: return Extraction.Dropped(DropReason.EMPTY)
        val ref = ChatRef(Apps.GMAIL, chat, Text.truncate(sender, Text.MAX_TITLE), group = false, address = null)
        return finish(ref, listOf(message(ref, sender, false, body, atOf(0, n))), hidden = false, otp = false)
    }

    private fun missedCall(n: RawNotification, app: String, title: String?, text: String?): Extraction? {
        val fromText = Filters.missedCallText(text)
        val fromTitle = Filters.missedCallText(title)
        if (n.category != Filters.CATEGORY_MISSED_CALL && fromText == null && fromTitle == null) return null
        val callText = fromText ?: fromTitle ?: "Missed voice call"
        val caller = when {
            fromTitle != null -> Text.name(text)?.takeIf { Filters.missedCallText(it) == null }
            else -> title
        }
        if (caller == null || caller.lowercase() in APP_LABELS) return Extraction.Dropped(DropReason.EMPTY)
        // The tag is skipped here: apps tend to use one tag for every missed call.
        val chat = ChatKeys.chatKey(app, n.shortcutId, null, caller, caller)
            ?: return Extraction.Dropped(DropReason.EMPTY)
        val ref = ChatRef(
            app = app,
            chat = chat,
            title = Text.truncate(caller, Text.MAX_TITLE),
            group = false,
            address = ChatKeys.address(app, ChatKeys.stableId(chat), caller),
        )
        return finish(ref, listOf(message(ref, caller, false, callText, atOf(0, n))), hidden = false, otp = false)
    }

    private fun isSelf(m: RawMessage, senderName: String?, selfKey: String?, selfName: String?): Boolean {
        if (senderName == null && m.senderKey == null) return true
        if (selfKey != null && m.senderKey == selfKey) return true
        if (senderName != null && selfName != null && senderName == selfName) return true
        return senderName.equals("You", ignoreCase = true)
    }

    private fun longer(big: String?, text: String?): String? {
        val b = Text.clean(big) ?: return text
        val t = text ?: return b
        return if (b.length >= t.length) b else t
    }

    private fun atOf(messageTime: Long, n: RawNotification): Long = when {
        messageTime > 0 -> messageTime
        n.whenTime > 0 -> n.whenTime
        else -> n.postTime
    }

    private fun message(ref: ChatRef, sender: String, fromMe: Boolean, text: String, at: Long): MessageEvent {
        val s = Text.truncate(sender, Text.MAX_SENDER)
        val t = Text.truncate(text, Text.MAX_TEXT)
        return MessageEvent(
            id = ChatKeys.messageId(ref.chat, s, at, t),
            app = ref.app,
            chat = ref.chat,
            title = ref.title,
            group = ref.group,
            sender = s,
            fromMe = fromMe,
            text = t,
            at = at,
            address = ref.address,
        )
    }

    private fun finish(ref: ChatRef, messages: List<MessageEvent>, hidden: Boolean, otp: Boolean): Extraction {
        val unique = messages.distinctBy { it.id }
        return when {
            unique.isNotEmpty() -> Extraction.Messages(ref, unique)
            hidden -> Extraction.PreviewsHidden(ref.app)
            otp -> Extraction.Dropped(DropReason.OTP)
            else -> Extraction.Dropped(DropReason.EMPTY)
        }
    }
}
