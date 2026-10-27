package `in`.aeka.workspace

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import `in`.aeka.workspace.core.Texts

/** Workspace notices shown as Android notifications in the channel "Aeka nudges". */
internal object Nudges {
    private const val CHANNEL = "nudges"
    private const val BRAND_RED = 0xFFB3261E.toInt()

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(CHANNEL, Texts.NUDGE_CHANNEL, NotificationManager.IMPORTANCE_HIGH).apply {
            description = Texts.NUDGE_CHANNEL_DESCRIPTION
            enableVibration(true)
            setShowBadge(true)
        }
        nm.createNotificationChannel(channel)
    }

    fun show(context: Context, id: String, title: String, body: String, link: String?) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_OPEN)
            // Unique data keeps one PendingIntent per notice.
            .setData(Uri.parse("aeka-notice:" + Uri.encode(id)))
            .putExtra(MainActivity.EXTRA_LINK, link)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(
            context,
            id.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_aeka)
            .setColor(BRAND_RED)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(tap)
            .build()
        try {
            nm.notify("notice:$id", 1, n)
        } catch (_: SecurityException) {
            // Notifications not allowed; status() reports postNotifications false.
        }
    }
}
