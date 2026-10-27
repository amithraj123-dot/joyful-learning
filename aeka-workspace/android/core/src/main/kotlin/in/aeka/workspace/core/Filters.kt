package `in`.aeka.workspace.core

/** What the phone drops before anything leaves it (protocol, "What the phone drops"). */
object Filters {
    private val I = RegexOption.IGNORE_CASE

    /** Notification categories that are never a message. */
    private val DROP_CATEGORIES = setOf(
        "call", "progress", "service", "sys", "transport", "navigation", "alarm", "stopwatch",
        "location_sharing", "workout",
    )

    /** Notification.CATEGORY_MISSED_CALL (API 30). */
    const val CATEGORY_MISSED_CALL = "missed_call"

    fun isDroppedCategory(category: String?): Boolean = category != null && category in DROP_CATEGORIES

    // The apps' own status notices. Matched against the title and the text.
    private val STATUS = listOf(
        Regex("^checking for (new )?messages", I),
        Regex("^whatsapp( business)? web is (currently )?active", I),
        Regex("^(whatsapp )?web is (currently )?active", I),
        Regex("^(chat )?backup (is )?in progress", I),
        Regex("^backing up( messages| media| chats)?\\b", I),
        Regex("^preparing (backup|media)", I),
        Regex("^restoring (messages|media|chats|backup)", I),
        Regex("^\\d+ (new )?messages? from \\d+ (chats?|conversations?)$", I),
        Regex("^\\d+ (new )?(e-?mails?|messages?) (in|for) ", I),
        Regex("^\\d+ new e-?mails?$", I),
        Regex("^you may have new messages", I),
        Regex("^sending (\\d+ )?(messages?|media|files?)", I),
        Regex("^(uploading|downloading) ", I),
        Regex("^waiting for (wi-?fi|network|connection)", I),
        Regex("^connecting\u2026?$|^connecting\\.\\.\\.$", I),
        Regex("^syncing\\b", I),
    )

    fun isStatusNotice(title: String?, text: String?): Boolean =
        listOfNotNull(title, text).any { s -> STATUS.any { it.containsMatchIn(s.trim()) } }

    // Previews switched off: "New message", "3 new messages", "1 new message".
    private val HIDDEN = listOf(
        Regex("^(\\d+ )?new (messages?|notifications?)$", I),
        Regex("^\\d+ (unread )?messages?$", I),
        Regex("^message$", I),
    )

    fun isHiddenPreview(text: String?): Boolean {
        val t = text?.trim()?.trimEnd('.') ?: return false
        return HIDDEN.any { it.matches(t) }
    }

    // Calls in progress or ringing. Missed calls are handled separately and kept.
    private val CALL_IN_PROGRESS = listOf(
        Regex("^(incoming|ongoing|outgoing) (voice |video |group )*call", I),
        Regex("^(calling|ringing|connecting|reconnecting)(\u2026|\\.\\.\\.)?$", I),
        Regex("^on hold$", I),
        Regex("^(voice|video) call in progress", I),
    )

    fun isCallInProgress(category: String?, title: String?, text: String?): Boolean {
        if (category == "call") return true
        return listOfNotNull(title, text).any { s -> CALL_IN_PROGRESS.any { it.containsMatchIn(s.trim()) } }
    }

    private val MISSED = Regex("^(\\d+\\s+)?missed\\s+((voice|video|group voice|group video|audio)\\s+)?calls?\\b", I)

    /**
     * "Missed voice call" or "Missed video call" when [s] describes a missed call (also
     * "2 missed voice calls", "Missed call at 10:12"), else null.
     */
    fun missedCallText(s: String?): String? {
        val t = s?.trim() ?: return null
        if (!MISSED.containsMatchIn(t)) return null
        return if (t.contains("video", ignoreCase = true)) "Missed video call" else "Missed voice call"
    }

    // One-time passwords and verification codes. A keyword and a code must both be present, so
    // "Can you send me the OTP?" stays.
    private val OTP_WORDS = Regex(
        "\\b(otp|one[\\s-]?time[\\s-]?(password|passcode|pin|code)|verification code|verify code|security code|" +
            "login code|log-?in code|sign-?in code|auth(entication)? code|confirmation code|passcode|access code|" +
            "2fa code|two[\\s-]factor|is your( \\w+){0,4} code|code is|your code)\\b",
        I,
    )
    private val OTP_CODE = Regex("(?<![\\d,.])(\\d{4,8}|\\d{3}[\\s-]\\d{3}|[A-Z]-\\d{4,8})(?![\\d,])")

    fun isOtp(text: String?): Boolean {
        val t = text ?: return false
        return OTP_WORDS.containsMatchIn(t) && OTP_CODE.containsMatchIn(t)
    }

    // LinkedIn notifications that are not conversations.
    private val LINKEDIN_NOISE = listOf(
        Regex("\\bviewed your profile\\b", I),
        Regex("\\bappeared in \\d+ search", I),
        Regex("\\bsearch appearances?\\b", I),
        Regex("\\b(new )?jobs?\\b.*\\b(for you|match|matching|alert)", I),
        Regex("\\bis hiring\\b", I),
        Regex("\\bpeople you may know\\b", I),
        Regex("\\b(commented|reacted|replied) (on|to) (your|a|this)\\b", I),
        Regex("\\b(liked|shared|reposted|mentioned you in) ", I),
        Regex("\\b(work anniversary|birthday|new position|started a new)\\b", I),
        Regex("\\bendorsed you\\b", I),
        Regex("\\b(posted|is live|trending|newsletter|invites you to follow|wants to connect|invitation)\\b", I),
        Regex("\\baccepted your invitation\\b", I),
    )

    fun isLinkedInNoise(title: String?, text: String?): Boolean =
        listOfNotNull(title, text).any { s -> LINKEDIN_NOISE.any { it.containsMatchIn(s) } }
}
