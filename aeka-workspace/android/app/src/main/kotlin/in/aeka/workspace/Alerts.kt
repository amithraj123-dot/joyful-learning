package `in`.aeka.workspace

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * To-dos and reminders due in the next 24 hours (the sync reply's `upcoming`), alerted at their time by
 * the phone's own alarms, so they are on time even between syncs and without a connection. Each alert
 * has the key of the notice the workspace raises for the same thing, and a key is shown once only,
 * whichever arrives first. Holds to-do and reminder titles only, never message text.
 */
internal object Alerts {
    private const val PREFS = "aeka_alerts"
    private const val K_UPCOMING = "upcoming"
    private const val K_SHOWN = "shown"
    const val ACTION = "in.aeka.workspace.ALERT"
    private const val SCHEME = "aeka-alert"
    private const val KEEP_SHOWN_MS = 3L * 24 * 60 * 60 * 1000
    private const val MAX_SHOWN = 400
    private const val MAX_ITEMS = 50

    /** An alert missed while the phone was off is still shown if it is at most this late. */
    private const val LATE_MS = 60L * 60 * 1000

    data class Item(val key: String, val at: Long, val title: String, val body: String, val link: String?)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun parse(array: JSONArray?): List<Item> {
        if (array == null) return emptyList()
        val out = ArrayList<Item>()
        for (i in 0 until minOf(array.length(), MAX_ITEMS)) {
            val o = array.optJSONObject(i) ?: continue
            val key = o.optString("key", "").takeIf { it.isNotBlank() && it.length <= 200 } ?: continue
            val at = o.optLong("at", 0L).takeIf { it > 0 } ?: continue
            val title = o.optString("title", "").take(200)
            if (title.isBlank()) continue
            val link = o.optString("link", "").takeIf { it.isNotBlank() }
            out.add(Item(key, at, title, o.optString("body", "").take(500), link))
        }
        return out
    }

    private fun stored(context: Context): List<Item> = try {
        parse(JSONArray(prefs(context).getString(K_UPCOMING, "[]") ?: "[]"))
    } catch (_: JSONException) {
        emptyList()
    }

    private fun save(context: Context, items: List<Item>) {
        val a = JSONArray()
        for (i in items)
            a.put(JSONObject().put("key", i.key).put("at", i.at).put("title", i.title).put("body", i.body).put("link", i.link ?: ""))
        prefs(context).edit().putString(K_UPCOMING, a.toString()).apply()
    }

    /** Replaces the scheduled alerts with [items] (from a sync reply). */
    @Synchronized
    fun schedule(context: Context, items: List<Item>) {
        val keep = items.map { it.key }.toSet()
        for (old in stored(context)) if (old.key !in keep) cancel(context, old.key)
        save(context, items)
        val now = System.currentTimeMillis()
        for (i in items) if (i.at > now && !alreadyShown(context, i.key)) set(context, i)
    }

    /** After a restart or an app update, when alarms are lost: set them again, and show recent ones missed. */
    @Synchronized
    fun reschedule(context: Context) {
        val now = System.currentTimeMillis()
        for (i in stored(context)) {
            if (alreadyShown(context, i.key)) continue
            if (i.at > now) set(context, i) else if (now - i.at <= LATE_MS) show(context, i)
        }
    }

    @Synchronized
    fun cancelAll(context: Context) {
        for (i in stored(context)) cancel(context, i.key)
        prefs(context).edit().remove(K_UPCOMING).apply()
    }

    /** Called by the alarm. */
    fun fire(context: Context, key: String) {
        val item = synchronized(this) { stored(context).firstOrNull { it.key == key } } ?: return
        show(context, item)
    }

    private fun show(context: Context, i: Item) {
        Nudges.show(context, id = i.key, title = i.title, body = i.body, link = i.link, key = i.key)
    }

    private fun intent(context: Context, key: String) =
        Intent(context, AlarmReceiver::class.java).setAction(ACTION).setData(Uri.fromParts(SCHEME, key, null))

    private fun pending(context: Context, key: String, flags: Int): PendingIntent? =
        PendingIntent.getBroadcast(context, key.hashCode(), intent(context, key), flags or PendingIntent.FLAG_IMMUTABLE)

    private fun set(context: Context, i: Item) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val pi = pending(context, i.key, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
        // Not an exact alarm (that needs a permission Android keeps for alarm-clock apps): Android may
        // deliver it a few minutes late in deep sleep, which suits a to-do.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, i.at, pi)
    }

    private fun cancel(context: Context, key: String) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        pending(context, key, PendingIntent.FLAG_NO_CREATE)?.let {
            am.cancel(it)
            it.cancel()
        }
    }

    // ---------- Keys already shown ----------

    @Synchronized
    fun alreadyShown(context: Context, key: String): Boolean = shownMap(context).has(key)

    /** Records [key] as shown; returns false if it already was. */
    @Synchronized
    fun markShown(context: Context, key: String): Boolean {
        val map = shownMap(context)
        if (map.has(key)) return false
        val now = System.currentTimeMillis()
        map.put(key, now)
        // Keep the last three days, and at most a few hundred keys.
        val entries = map.keys().asSequence().map { it to map.optLong(it, 0L) }
            .filter { now - it.second <= KEEP_SHOWN_MS }
            .sortedByDescending { it.second }
            .take(MAX_SHOWN)
            .toList()
        val pruned = JSONObject()
        for ((k, t) in entries) pruned.put(k, t)
        prefs(context).edit().putString(K_SHOWN, pruned.toString()).apply()
        return true
    }

    private fun shownMap(context: Context): JSONObject = try {
        JSONObject(prefs(context).getString(K_SHOWN, "{}") ?: "{}")
    } catch (_: JSONException) {
        JSONObject()
    }
}

/** Shows a to-do or reminder alert when its alarm goes off. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Alerts.ACTION) return
        val key = intent.data?.schemeSpecificPart?.takeIf { it.isNotBlank() } ?: return
        if (!Store.get(context).paired) return
        Alerts.fire(context, key)
    }
}

/** Alarms do not survive a restart or an app update: set them again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val store = Store.get(context)
        if (!store.paired) return
        Alerts.reschedule(context)
        Jobs.schedulePeriodic(context, store.syncSeconds)
    }
}
