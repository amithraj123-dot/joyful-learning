package `in`.aeka.workspace

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import `in`.aeka.workspace.core.SyncPolicy

/**
 * Events waiting to be sent, in app-private storage (`databases/queue.db`, excluded from backup).
 * `seen` remembers message ids already queued, so WhatsApp's repeated history is not queued again
 * after it has been sent.
 */
internal class EventQueue(context: Context) : SQLiteOpenHelper(context, "queue.db", null, 1) {
    data class Row(val id: Long, val json: String)

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL, created INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE seen (msg_id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS events")
        db.execSQL("DROP TABLE IF EXISTS seen")
        onCreate(db)
    }

    /** Queues a message event unless its id was queued before. True when it was added. */
    @Synchronized
    fun addMessage(messageId: String, json: String): Boolean {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            val seen = ContentValues().apply {
                put("msg_id", messageId)
                put("at", now)
            }
            if (db.insertWithOnConflict("seen", null, seen, SQLiteDatabase.CONFLICT_IGNORE) == -1L) return false
            insertEvent(db, json, now)
            db.setTransactionSuccessful()
            return true
        } finally {
            db.endTransaction()
        }
    }

    /** Records a message id as handled without queuing it (a copy of a reply already queued). */
    @Synchronized
    fun markSeen(messageId: String) {
        val v = ContentValues().apply {
            put("msg_id", messageId)
            put("at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("seen", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }

    @Synchronized
    fun addEvent(json: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            insertEvent(db, json, System.currentTimeMillis())
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun insertEvent(db: SQLiteDatabase, json: String, now: Long) {
        val over = SyncPolicy.overflow(DatabaseUtils.queryNumEntries(db, "events").toInt(), 1)
        if (over > 0) {
            db.execSQL("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id LIMIT $over)")
        }
        val v = ContentValues().apply {
            put("json", json)
            put("created", now)
        }
        db.insert("events", null, v)
    }

    /** The oldest events, at most [limit]. */
    @Synchronized
    fun oldest(limit: Int = SyncPolicy.MAX_BATCH): List<Row> {
        val out = ArrayList<Row>()
        readableDatabase.rawQuery("SELECT id, json FROM events ORDER BY id LIMIT ?", arrayOf(limit.toString())).use { c ->
            while (c.moveToNext()) out += Row(c.getLong(0), c.getString(1))
        }
        return out
    }

    @Synchronized
    fun delete(ids: List<Long>) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (chunk in ids.chunked(200)) {
                db.execSQL("DELETE FROM events WHERE id IN (${chunk.joinToString(",")})")
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun count(): Int = DatabaseUtils.queryNumEntries(readableDatabase, "events").toInt()

    /** Forgets message ids older than [days], so the table stays small. */
    @Synchronized
    fun pruneSeen(days: Int = 14) {
        val cutoff = System.currentTimeMillis() - days * 24L * 3600_000L
        writableDatabase.delete("seen", "at < ?", arrayOf(cutoff.toString()))
    }

    @Synchronized
    fun clear() {
        val db = writableDatabase
        db.delete("events", null, null)
        db.delete("seen", null, null)
    }
}
