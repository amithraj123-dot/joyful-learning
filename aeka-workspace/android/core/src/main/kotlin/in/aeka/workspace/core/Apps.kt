package `in`.aeka.workspace.core

/** The apps the phone reads, by protocol app id (docs/ANDROID-PROTOCOL.md, "Apps read"). */
object Apps {
    const val WHATSAPP = "whatsapp"
    const val WHATSAPP_BUSINESS = "whatsapp_business"
    const val LINKEDIN = "linkedin"
    const val GMAIL = "gmail"
    const val SMS = "sms"
    const val TEAMS = "teams"
    const val SLACK = "slack"

    /** All app ids, in the order the workspace lists them. */
    val ALL: List<String> = listOf(WHATSAPP, WHATSAPP_BUSINESS, LINKEDIN, GMAIL, SMS, TEAMS, SLACK)

    /** Fixed packages. SMS also includes the phone's default SMS app, passed to [forPackage]. */
    val PACKAGES: Map<String, String> = mapOf(
        "com.whatsapp" to WHATSAPP,
        "com.whatsapp.w4b" to WHATSAPP_BUSINESS,
        "com.linkedin.android" to LINKEDIN,
        "com.google.android.gm" to GMAIL,
        "com.google.android.apps.messaging" to SMS,
        "com.samsung.android.messaging" to SMS,
        "com.microsoft.teams" to TEAMS,
        "com.Slack" to SLACK,
    )

    /** The package to open for an app id when there is no live notification or link. */
    fun launchPackage(app: String, defaultSmsPackage: String?): String? = when (app) {
        SMS -> defaultSmsPackage ?: "com.google.android.apps.messaging"
        else -> PACKAGES.entries.firstOrNull { it.value == app }?.key
    }

    /**
     * The app id for a notification's package, or null when the phone does not read it. Package
     * names are case sensitive on Android (`com.Slack`).
     */
    fun forPackage(packageName: String, defaultSmsPackage: String?): String? {
        PACKAGES[packageName]?.let { return it }
        if (!defaultSmsPackage.isNullOrEmpty() && packageName == defaultSmsPackage) return SMS
        return null
    }

    /** The app id at the front of a chat key (`whatsapp:9198...`), or null. */
    fun ofChat(chat: String): String? {
        val app = chat.substringBefore(':', "")
        return app.takeIf { it in ALL }
    }

    /** The enabled-apps map with every app present: missing entries default to on. */
    fun withDefaults(enabled: Map<String, Boolean>): Map<String, Boolean> =
        ALL.associateWith { enabled[it] ?: true }
}
