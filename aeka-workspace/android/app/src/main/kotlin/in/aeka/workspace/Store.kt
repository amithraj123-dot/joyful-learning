package `in`.aeka.workspace

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import `in`.aeka.workspace.core.Apps
import `in`.aeka.workspace.core.Json
import `in`.aeka.workspace.core.SyncPolicy
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * The phone's state, in app-private storage: the pairing (device token wrapped with an Android
 * Keystore key), the enabled apps from the last sync reply, and sync bookkeeping. Never holds
 * message text; that lives only in the queue until it is sent.
 */
internal class Store private constructor(context: Context) {
    companion object {
        @Volatile
        private var instance: Store? = null

        fun get(context: Context): Store =
            instance ?: synchronized(this) { instance ?: Store(context.applicationContext).also { instance = it } }

        private const val K_TOKEN = "token"
        private const val K_DEVICE_ID = "device_id"
        private const val K_DEVICE_NAME = "device_name"
        private const val K_MEMBER_NAME = "member_name"
        private const val K_MEMBER_EMAIL = "member_email"
        private const val K_APPS = "apps"
        private const val K_PREVIEWS_HIDDEN = "previews_hidden"
        private const val K_LAST_SYNC = "last_sync_at"
        private const val K_LAST_ERROR = "last_error"
        private const val K_FAILURES = "failures"
        private const val K_SYNC_SECONDS = "sync_seconds"
        private const val K_ASKED_POST = "asked_post"
    }

    private val prefs: SharedPreferences = context.getSharedPreferences("aeka", Context.MODE_PRIVATE)
    val queue = EventQueue(context)

    @Volatile
    private var cachedToken: String? = null

    @Volatile
    private var tokenLoaded = false

    /** The device token, or null when this phone is not paired. Never given to the page. */
    val token: String?
        get() {
            if (!tokenLoaded) {
                synchronized(this) {
                    if (!tokenLoaded) {
                        cachedToken = TokenCipher.decrypt(prefs.getString(K_TOKEN, null))
                        tokenLoaded = true
                    }
                }
            }
            return cachedToken
        }

    val paired: Boolean get() = token != null

    val deviceName: String? get() = prefs.getString(K_DEVICE_NAME, null)

    @Synchronized
    fun setPaired(token: String, deviceId: String?, deviceName: String, memberName: String?, memberEmail: String?) {
        prefs.edit()
            .putString(K_TOKEN, TokenCipher.encrypt(token))
            .putString(K_DEVICE_ID, deviceId)
            .putString(K_DEVICE_NAME, deviceName)
            .putString(K_MEMBER_NAME, memberName)
            .putString(K_MEMBER_EMAIL, memberEmail)
            .remove(K_LAST_ERROR)
            .putInt(K_FAILURES, 0)
            .apply()
        cachedToken = token
        tokenLoaded = true
    }

    /** Forgets the pairing and everything queued. [error] is shown in status() (for example after a 401). */
    @Synchronized
    fun clearPairing(error: String?) {
        val edit = prefs.edit()
            .remove(K_TOKEN)
            .remove(K_DEVICE_ID)
            .remove(K_MEMBER_NAME)
            .remove(K_MEMBER_EMAIL)
            .remove(K_PREVIEWS_HIDDEN)
            .remove(K_LAST_SYNC)
            .putInt(K_FAILURES, 0)
        if (error == null) edit.remove(K_LAST_ERROR) else edit.putString(K_LAST_ERROR, error)
        edit.apply()
        cachedToken = null
        tokenLoaded = true
        queue.clear()
    }

    @Volatile
    private var cachedApps: Map<String, Boolean>? = null

    /** Enabled apps from the last sync reply; every app defaults to on. */
    var apps: Map<String, Boolean>
        get() {
            cachedApps?.let { return it }
            val raw = prefs.getString(K_APPS, null)
            val parsed = try {
                val o = JSONObject(raw ?: "{}")
                Apps.withDefaults(Apps.ALL.filter { o.has(it) }.associateWith { o.optBoolean(it, true) })
            } catch (_: Exception) {
                Apps.withDefaults(emptyMap())
            }
            cachedApps = parsed
            return parsed
        }
        set(value) {
            val all = Apps.withDefaults(value)
            cachedApps = all
            prefs.edit().putString(K_APPS, Json.value(all)).apply()
        }

    fun isEnabled(app: String): Boolean = apps[app] ?: true

    val previewsHidden: Set<String> get() = prefs.getStringSet(K_PREVIEWS_HIDDEN, emptySet()) ?: emptySet()

    fun setPreviewsHidden(app: String, hidden: Boolean) {
        val now = previewsHidden
        if (hidden == (app in now)) return
        prefs.edit().putStringSet(K_PREVIEWS_HIDDEN, if (hidden) now + app else now - app).apply()
    }

    var lastSyncAt: Long?
        get() = prefs.getLong(K_LAST_SYNC, 0L).takeIf { it > 0 }
        set(value) = prefs.edit().putLong(K_LAST_SYNC, value ?: 0L).apply()

    var lastError: String?
        get() = prefs.getString(K_LAST_ERROR, null)
        set(value) = prefs.edit().putString(K_LAST_ERROR, value).apply()

    var failures: Int
        get() = prefs.getInt(K_FAILURES, 0)
        set(value) = prefs.edit().putInt(K_FAILURES, value).apply()

    var syncSeconds: Long
        get() = prefs.getLong(K_SYNC_SECONDS, SyncPolicy.MIN_PERIOD_SECONDS)
        set(value) = prefs.edit().putLong(K_SYNC_SECONDS, value).apply()

    var askedPostNotifications: Boolean
        get() = prefs.getBoolean(K_ASKED_POST, false)
        set(value) = prefs.edit().putBoolean(K_ASKED_POST, value).apply()
}

/**
 * Wraps the device token with an AES-GCM key held in the Android Keystore, so a copy of the
 * preferences file alone does not reveal it. Falls back to plain private storage on phones whose
 * keystore is broken.
 */
internal object TokenCipher {
    private const val ALIAS = "aeka_device_token"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String = try {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key())
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        "k1:" + b64(c.iv) + ":" + b64(ct)
    } catch (_: Exception) {
        "p1:$plain"
    }

    fun decrypt(stored: String?): String? {
        if (stored.isNullOrEmpty()) return null
        if (stored.startsWith("p1:")) return stored.substring(3).ifEmpty { null }
        if (!stored.startsWith("k1:")) return null
        return try {
            val parts = stored.split(':')
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(parts[1])))
            String(c.doFinal(unb64(parts[2])), Charsets.UTF_8).ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
}
