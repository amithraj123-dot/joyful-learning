package `in`.aeka.workspace.core

import java.util.Locale

/** Text clean-up and the protocol's length limits. */
object Text {
    const val MAX_TEXT = 4000
    const val MAX_TITLE = 200
    const val MAX_SENDER = 120
    const val MAX_CHAT = 200

    // Bidirectional marks and isolates WhatsApp puts around phone numbers ("\u202A+91 98123 45678\u202C"),
    // plus zero-width spaces and the BOM. Zero-width joiners stay: emoji sequences need them.
    private val INVISIBLE = Regex("[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]")
    private val SPACES = Regex("\\s+")

    // "Rahul Mehta (2 messages)", "Family (5 new messages)", "Rahul Mehta (3)", "Rahul \u2022 2 new messages"
    private val COUNTER = Regex(
        "\\s*(?:\\(\\s*\\d+(?:\\s+(?:new\\s+)?messages?)?\\s*\\)|[\u2022\u00B7:]\\s*\\d+\\s+(?:new\\s+)?messages?)\\s*$",
        RegexOption.IGNORE_CASE,
    )

    /** Trimmed, invisible marks removed, null when empty. */
    fun clean(s: CharSequence?): String? {
        if (s == null) return null
        val t = INVISIBLE.replace(s.toString(), "").trim()
        return t.ifEmpty { null }
    }

    /** A display name: cleaned, whitespace collapsed, message counters removed. */
    fun name(s: CharSequence?): String? {
        val t = clean(s) ?: return null
        val collapsed = SPACES.replace(t, " ")
        return COUNTER.replace(collapsed, "").trim().ifEmpty { null }
    }

    /** Lower case with spaces collapsed, for chat keys built from a title or sender. */
    fun key(s: String): String = SPACES.replace(INVISIBLE.replace(s, ""), " ").trim().lowercase(Locale.ROOT)

    /** At most [max] UTF-16 units (the length JavaScript sees), never splitting a surrogate pair. */
    fun truncate(s: String, max: Int): String {
        if (s.length <= max) return s
        var end = max
        if (end > 0 && Character.isHighSurrogate(s[end - 1])) end--
        return s.substring(0, end)
    }

    /** Message text: cleaned at the ends only (line breaks inside are kept), then limited. */
    fun body(s: CharSequence?): String? {
        if (s == null) return null
        val t = s.toString().replace("\r\n", "\n").trim { it.isWhitespace() || INVISIBLE.matches(it.toString()) }
        return if (t.isEmpty()) null else truncate(t, MAX_TEXT)
    }
}
