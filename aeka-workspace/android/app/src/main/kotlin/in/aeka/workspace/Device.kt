package `in`.aeka.workspace

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import `in`.aeka.workspace.core.Protocol
import java.util.Locale

/** What the phone allows Aeka to do, and how it names itself when pairing. */
internal object Device {
    fun captureComponent(context: Context) = ComponentName(context, CaptureService::class.java)

    fun notificationAccess(context: Context): Boolean {
        val component = captureComponent(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return false
            return nm.isNotificationListenerAccessGranted(component)
        }
        val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }

    fun postNotifications(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true
    }

    fun batteryUnrestricted(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true

    fun access(context: Context) = Protocol.Access(
        notifications = notificationAccess(context),
        postNotifications = postNotifications(context),
        batteryUnrestricted = batteryUnrestricted(context),
    )

    fun defaultSmsPackage(context: Context): String? = try {
        Telephony.Sms.getDefaultSmsPackage(context)
    } catch (_: RuntimeException) {
        null
    }

    /** The name the person gave the phone ("Amith's Pixel"), else its model. */
    fun name(context: Context): String {
        val set = try {
            Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
        } catch (_: RuntimeException) {
            null
        }
        return set?.trim()?.takeIf { it.isNotEmpty() }?.take(80) ?: model()
    }

    /** "Google Pixel 8", "Samsung SM-S921B". */
    fun model(): String {
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.titlecase(Locale.ROOT) }
        val model = Build.MODEL.orEmpty()
        return when {
            model.isEmpty() -> maker.ifEmpty { "Android phone" }
            maker.isEmpty() || model.startsWith(maker, ignoreCase = true) -> model
            else -> "$maker $model"
        }
    }
}
