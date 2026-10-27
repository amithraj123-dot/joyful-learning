package `in`.aeka.workspace.core

/**
 * A small JSON writer for the request bodies and queued events. Keys with a null value are left
 * out. The output is also safe to embed in JavaScript source: U+2028, U+2029 and lone surrogates
 * are escaped.
 */
object Json {
    /** Text that is already valid JSON and is written as is. */
    @JvmInline
    value class Raw(val json: String)

    fun obj(vararg fields: Pair<String, Any?>): String = buildString {
        append('{')
        var first = true
        for ((k, v) in fields) {
            if (v == null) continue
            if (!first) append(',')
            first = false
            writeString(this, k)
            append(':')
            writeValue(this, v)
        }
        append('}')
    }

    fun quote(s: String): String = buildString { writeString(this, s) }

    /** Any supported value (string, number, boolean, map, list, [Raw]) as JSON. */
    fun value(v: Any?): String = buildString { writeValue(this, v) }

    fun writeValue(out: StringBuilder, v: Any?) {
        when (v) {
            null -> out.append("null")
            is Raw -> out.append(v.json)
            is String -> writeString(out, v)
            is Boolean -> out.append(if (v) "true" else "false")
            is Int, is Long, is Short, is Byte -> out.append(v.toString())
            is Double -> {
                require(v.isFinite()) { "JSON cannot hold $v" }
                out.append(if (v == Math.floor(v) && Math.abs(v) < 1e15) v.toLong().toString() else v.toString())
            }
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, value) in v) {
                    if (value == null) continue
                    if (!first) out.append(',')
                    first = false
                    writeString(out, k.toString())
                    out.append(':')
                    writeValue(out, value)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (item in v) {
                    if (!first) out.append(',')
                    first = false
                    writeValue(out, item)
                }
                out.append(']')
            }
            else -> throw IllegalArgumentException("Unsupported JSON value: ${v::class.java.name}")
        }
    }

    private const val HEX = "0123456789abcdef"

    private fun writeString(out: StringBuilder, s: String) {
        out.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c == '\b' -> out.append("\\b")
                c == '\u000C' -> out.append("\\f")
                c < ' ' || c == '\u2028' || c == '\u2029' || c == '\u007F' -> unicodeEscape(out, c)
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> {
                    out.append(c).append(s[i + 1])
                    i++
                }
                Character.isSurrogate(c) -> unicodeEscape(out, c)
                else -> out.append(c)
            }
            i++
        }
        out.append('"')
    }

    private fun unicodeEscape(out: StringBuilder, c: Char) {
        val n = c.code
        out.append("\\u")
            .append(HEX[(n shr 12) and 0xF])
            .append(HEX[(n shr 8) and 0xF])
            .append(HEX[(n shr 4) and 0xF])
            .append(HEX[n and 0xF])
    }
}
