package `in`.aeka.workspace.core

import java.security.MessageDigest

/** Chat keys, addresses and message ids (protocol, "Chat keys and message ids"). */
object ChatKeys {
    // WhatsApp person ids carry the phone number. Group ids (@g.us), broadcast lists and privacy
    // ids (@lid) do not, so they never yield an address.
    private val WHATSAPP_PERSON = Regex("^\\+?(\\d{7,15})@(s\\.whatsapp\\.net|c\\.us)$")
    private val PHONE = Regex("^\\+?[\\d\\s().-]{7,24}$")

    /**
     * `<app>:<stable id>`: the shortcut id, else the tag, else the title (lower case, spaces
     * collapsed). For Gmail the stable id is the sender. At most 200 characters.
     */
    fun chatKey(app: String, shortcutId: String?, tag: String?, title: String?, sender: String?): String? {
        val stable = if (app == Apps.GMAIL) {
            sender?.let { Text.key(it) }
        } else {
            Text.clean(shortcutId) ?: Text.clean(tag) ?: title?.let { Text.key(it) }
        }
        if (stable.isNullOrEmpty()) return null
        return Text.truncate("$app:$stable", Text.MAX_CHAT)
    }

    /** The stable id part of a chat key. */
    fun stableId(chat: String): String = chat.substringAfter(':', "")

    /**
     * Digits of the phone number when the stable id (a WhatsApp person id or a bare number) or the
     * SMS sender shows one, else null.
     */
    fun address(app: String, stableId: String?, smsSender: String?): String? {
        stableId?.let { id -> phoneDigits(id)?.let { return it } }
        if (app == Apps.SMS) smsSender?.let { s -> phoneDigits(s)?.let { return it } }
        return null
    }

    fun phoneDigits(s: String): String? {
        val t = Text.clean(s) ?: return null
        WHATSAPP_PERSON.matchEntire(t)?.let { return it.groupValues[1] }
        if (!PHONE.matches(t)) return null
        val digits = t.filter { it.isDigit() }
        // Without a "+", short numbers are more likely thread ids than phone numbers.
        val min = if (t.startsWith("+")) 7 else 10
        return if (digits.length in min..15) digits else null
    }

    /**
     * Lower-case hex of SHA-256 over chat, sender, at and text joined by newlines, first 32
     * characters.
     */
    fun messageId(chat: String, sender: String, at: Long, text: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$chat\n$sender\n$at\n$text".toByteArray(Charsets.UTF_8))
        val hex = StringBuilder(64)
        for (b in digest) {
            val v = b.toInt() and 0xFF
            hex.append(HEX[v shr 4]).append(HEX[v and 0xF])
        }
        return hex.substring(0, 32)
    }

    private const val HEX = "0123456789abcdef"
}
