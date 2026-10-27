package `in`.aeka.workspace

import android.os.Build
import android.webkit.CookieManager
import `in`.aeka.workspace.core.Protocol
import `in`.aeka.workspace.core.SyncPolicy
import `in`.aeka.workspace.core.Texts
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONException
import org.json.JSONObject

/** `POST /api/device` over HttpURLConnection. Never logs request or reply bodies. */
internal class DeviceApi(private val origin: String) {
    sealed interface Reply {
        data class Ok(val value: Any?) : Reply

        /** 401 from the workspace: the device was disconnected there. */
        data class Unauthorised(val message: String?) : Reply

        data class Failed(val message: String, val status: Int) : Reply
    }

    fun post(body: String, token: String?): Reply {
        val conn = try {
            URI(origin + Protocol.DEVICE_PATH).toURL().openConnection() as HttpURLConnection
        } catch (_: Exception) {
            return Reply.Failed(Texts.NETWORK, 0)
        }
        try {
            val bytes = body.toByteArray(Charsets.UTF_8)
            conn.requestMethod = "POST"
            conn.connectTimeout = SyncPolicy.TIMEOUT_MS
            conn.readTimeout = SyncPolicy.TIMEOUT_MS
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(bytes.size)
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Origin", origin)
            conn.setRequestProperty("User-Agent", "AekaAndroid/${Protocol.APP_VERSION} (Android ${Build.VERSION.SDK_INT})")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            // The hosting platform may require its own sign-in on every path. The WebView holds that
            // session, so its cookies for the workspace origin go with the request, as in a browser.
            webCookies()?.let { conn.setRequestProperty("Cookie", it) }

            conn.outputStream.use { it.write(bytes) }
            val status = conn.responseCode
            val json = (conn.contentType ?: "").contains("json", ignoreCase = true)
            val text = read(if (status >= 400) conn.errorStream else conn.inputStream)

            if (status in 300..399 || !json) {
                // A sign-in page or redirect, not the workspace API.
                return Reply.Failed(Texts.SIGN_IN, status)
            }
            val obj = try {
                JSONObject(text)
            } catch (_: JSONException) {
                return Reply.Failed(Texts.SERVER, status)
            }
            val error = obj.optString("error", "").takeIf { it.isNotBlank() }
            return when {
                status == 200 -> Reply.Ok(obj.opt("value"))
                status == 401 -> Reply.Unauthorised(error)
                else -> Reply.Failed(error ?: Texts.SERVER, status)
            }
        } catch (_: IOException) {
            return Reply.Failed(Texts.NETWORK, 0)
        } catch (_: SecurityException) {
            return Reply.Failed(Texts.NETWORK, 0)
        } finally {
            conn.disconnect()
        }
    }

    private fun webCookies(): String? = try {
        CookieManager.getInstance().getCookie(origin)?.takeIf { it.isNotBlank() }
    } catch (_: Throwable) {
        // No WebView provider (being updated, or missing): send without cookies.
        null
    }

    private fun read(stream: InputStream?): String {
        if (stream == null) return ""
        stream.use { s ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var total = 0
            while (true) {
                val n = s.read(buf)
                if (n < 0) break
                total += n
                if (total > MAX_REPLY_BYTES) throw IOException("Reply too large")
                out.write(buf, 0, n)
            }
            return out.toString("UTF-8")
        }
    }

    private companion object {
        const val MAX_REPLY_BYTES = 2 * 1024 * 1024
    }
}
