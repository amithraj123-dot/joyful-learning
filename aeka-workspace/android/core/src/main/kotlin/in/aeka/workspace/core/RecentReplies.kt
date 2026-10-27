package `in`.aeka.workspace.core

/**
 * Replies sent from Aeka in the last few minutes. When WhatsApp updates its notification to show
 * the reply, that copy carries WhatsApp's own time, so it would get a new message id; this lets the
 * phone recognise it and skip it, as the reply was already queued.
 */
class RecentReplies(private val windowMs: Long = 10 * 60_000L, private val clock: () -> Long = System::currentTimeMillis) {
    private data class Entry(val chat: String, val text: String, val at: Long)

    private val entries = ArrayDeque<Entry>()

    @Synchronized
    fun record(chat: String, text: String, at: Long = clock()) {
        prune()
        entries.addLast(Entry(chat, norm(text), at))
        while (entries.size > 50) entries.removeFirst()
    }

    @Synchronized
    fun isEcho(chat: String, text: String, at: Long): Boolean {
        prune()
        val t = norm(text)
        return entries.any { it.chat == chat && it.text == t && kotlin.math.abs(at - it.at) <= windowMs }
    }

    private fun prune() {
        val cutoff = clock() - windowMs
        while (entries.isNotEmpty() && entries.first().at < cutoff) entries.removeFirst()
    }

    private fun norm(s: String): String = Text.key(Text.body(s) ?: "")
}
