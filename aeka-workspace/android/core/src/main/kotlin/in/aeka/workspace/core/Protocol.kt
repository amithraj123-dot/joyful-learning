package `in`.aeka.workspace.core

import java.net.URI
import java.util.Locale

/** Request bodies for `POST /api/device` (protocol, "API"). */
object Protocol {
    const val APP_VERSION = "0.9.0"
    const val DEFAULT_ORIGIN = "https://flow-voice-workspace.amithraj123.chatgpt.site"
    const val DEVICE_PATH = "/api/device"

    fun pairBody(code: String, name: String, model: String, appVersion: String, android: Int): String = Json.obj(
        "op" to "pair",
        "code" to code,
        "name" to name,
        "model" to model,
        "appVersion" to appVersion,
        "android" to android,
    )

    data class Access(val notifications: Boolean, val postNotifications: Boolean, val batteryUnrestricted: Boolean)

    /** [events] are queued event JSON texts, written as they are. */
    fun syncBody(appVersion: String, android: Int, access: Access, events: List<String>, live: Collection<String>): String =
        Json.obj(
            "op" to "sync",
            "appVersion" to appVersion,
            "android" to android,
            "access" to mapOf(
                "notifications" to access.notifications,
                "postNotifications" to access.postNotifications,
                "batteryUnrestricted" to access.batteryUnrestricted,
            ),
            "events" to events.map { Json.Raw(it) },
            "live" to live.sorted(),
        )

    // NotificationListenerService.REASON_* values (stable since API 26).
    const val REASON_CLICK = 1
    const val REASON_CANCEL = 2
    const val REASON_CANCEL_ALL = 3
    const val REASON_APP_CANCEL = 8
    const val REASON_APP_CANCEL_ALL = 9

    /** `cleared.reason` for onNotificationRemoved's reason code. */
    fun clearedReason(code: Int): String = when (code) {
        REASON_CLICK -> "opened"
        REASON_CANCEL, REASON_CANCEL_ALL -> "dismissed"
        REASON_APP_CANCEL, REASON_APP_CANCEL_ALL -> "read"
        else -> "other"
    }
}

/** Origins and nudge links. */
object Links {
    /** `scheme://host[:port]` in lower case, the default port left out; null when not http(s). */
    fun origin(url: String?): String? {
        if (url.isNullOrEmpty()) return null
        return try {
            val u = URI(url)
            val scheme = u.scheme?.lowercase(Locale.ROOT) ?: return null
            if (scheme != "https" && scheme != "http") return null
            val host = u.host?.lowercase(Locale.ROOT) ?: return null
            val port = u.port
            val defaultPort = if (scheme == "https") 443 else 80
            if (port == -1 || port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
        } catch (_: Exception) {
            null
        }
    }

    fun isHttps(url: String?): Boolean = origin(url)?.startsWith("https://") == true

    private val PAGE = Regex("^[A-Za-z0-9][A-Za-z0-9/_-]{0,99}$")
    private val ANCHOR = Regex("^[A-Za-z0-9._:~-]{1,200}$")

    /** A nudge link (`chats/inbox#<thread id>`) split into page id and anchor; null when malformed. */
    fun parse(link: String?): Pair<String, String?>? {
        val l = link?.trim()?.removePrefix("/") ?: return null
        val page = l.substringBefore('#')
        val anchor = if ('#' in l) l.substringAfter('#') else null
        if (!PAGE.matches(page) || page.contains("//")) return null
        if (anchor != null && !ANCHOR.matches(anchor)) return page to null
        return page to anchor
    }

    /** The URL that opens a nudge link on a cold start: `${origin}/?page=<page id>#<id>`. */
    fun pageUrl(origin: String, link: String?): String {
        val (page, anchor) = parse(link) ?: return "$origin/"
        return "$origin/?page=$page" + (anchor?.let { "#$it" } ?: "")
    }
}

/** Queue and retry rules for the sync client. */
object SyncPolicy {
    const val MAX_BATCH = 200
    const val MAX_BATCHES_PER_RUN = 10
    const val MAX_QUEUE = 5000
    const val DEBOUNCE_MS = 5_000L

    /**
     * How long a removed notification waits before it is reported as `cleared`. Apps sometimes
     * cancel and re-post a chat's notification; a new one for the same chat within this time
     * cancels the report.
     */
    const val CLEAR_GRACE_MS = 3_000L
    const val TIMEOUT_MS = 20_000
    const val MIN_PERIOD_SECONDS = 900L
    private const val MAX_PERIOD_SECONDS = 6 * 3600L
    private const val BACKOFF_BASE_MS = 30_000L
    private const val BACKOFF_MAX_MS = 30 * 60_000L

    /** Delay before retry number [failures] (1 for the first failure): 30 s doubling to 30 min. */
    fun backoffMillis(failures: Int): Long {
        if (failures <= 0) return 0
        val shift = (failures - 1).coerceAtMost(16)
        return (BACKOFF_BASE_MS shl shift).coerceAtMost(BACKOFF_MAX_MS)
    }

    /** The periodic job interval for the reply's `syncSeconds` (JobScheduler allows 15 minutes at least). */
    fun periodSeconds(syncSeconds: Long?): Long =
        (syncSeconds ?: MIN_PERIOD_SECONDS).coerceIn(MIN_PERIOD_SECONDS, MAX_PERIOD_SECONDS)

    /** How many of the oldest queued events to drop so the queue keeps at most [MAX_QUEUE]. */
    fun overflow(queued: Int, adding: Int): Int = (queued + adding - MAX_QUEUE).coerceAtLeast(0)

    /** The next batch: at most [MAX_BATCH] ids, oldest first. [ids] are queue row ids in insertion order. */
    fun <T> batch(oldestFirst: List<T>): List<T> = oldestFirst.take(MAX_BATCH)
}
