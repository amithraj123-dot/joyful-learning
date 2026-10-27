package `in`.aeka.workspace.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test
    fun appsByPackage() {
        assertEquals(Apps.WHATSAPP, Apps.forPackage("com.whatsapp", null))
        assertEquals(Apps.WHATSAPP_BUSINESS, Apps.forPackage("com.whatsapp.w4b", null))
        assertEquals(Apps.LINKEDIN, Apps.forPackage("com.linkedin.android", null))
        assertEquals(Apps.GMAIL, Apps.forPackage("com.google.android.gm", null))
        assertEquals(Apps.SMS, Apps.forPackage("com.google.android.apps.messaging", null))
        assertEquals(Apps.SMS, Apps.forPackage("com.samsung.android.messaging", null))
        assertEquals(Apps.SMS, Apps.forPackage("com.oneplus.mms", "com.oneplus.mms"))
        assertEquals(Apps.TEAMS, Apps.forPackage("com.microsoft.teams", null))
        assertEquals(Apps.SLACK, Apps.forPackage("com.Slack", null))
        assertNull(Apps.forPackage("com.slack", null))
        assertNull(Apps.forPackage("com.microsoft.office.outlook", null))
        assertNull(Apps.forPackage("com.oneplus.mms", null))
        assertNull(Apps.forPackage("in.aeka.workspace", ""))
    }

    @Test
    fun appsHelpers() {
        assertEquals(Apps.ALL.associateWith { it != Apps.SLACK }, Apps.withDefaults(mapOf(Apps.SLACK to false)))
        assertEquals(Apps.WHATSAPP, Apps.ofChat("whatsapp:919812345678@s.whatsapp.net"))
        assertEquals(Apps.TEAMS, Apps.ofChat("teams:19:abc@thread.v2"))
        assertNull(Apps.ofChat("outlook:x"))
        assertNull(Apps.ofChat("nocolon"))
        assertEquals("com.Slack", Apps.launchPackage(Apps.SLACK, null))
        assertEquals("com.oneplus.mms", Apps.launchPackage(Apps.SMS, "com.oneplus.mms"))
        assertEquals("com.google.android.apps.messaging", Apps.launchPackage(Apps.SMS, null))
    }

    @Test
    fun chatKeys() {
        assertEquals("whatsapp:jid", ChatKeys.chatKey("whatsapp", "jid", "tag", "Title", "Title"))
        assertEquals("whatsapp:tag", ChatKeys.chatKey("whatsapp", null, "tag", "Title", "Title"))
        assertEquals("whatsapp:rahul mehta", ChatKeys.chatKey("whatsapp", " ", null, "  Rahul \n Mehta ", null))
        assertEquals("gmail:rahul mehta", ChatKeys.chatKey("gmail", "shortcut", "tag", "ignored", "Rahul Mehta"))
        assertNull(ChatKeys.chatKey("whatsapp", null, null, null, null))
        val long = ChatKeys.chatKey("slack", "x".repeat(400), null, null, null)!!
        assertEquals(200, long.length)
        assertTrue(long.startsWith("slack:x"))
    }

    @Test
    fun addresses() {
        assertEquals("919812345678", ChatKeys.address("whatsapp", "919812345678@s.whatsapp.net", null))
        assertEquals("919812345678", ChatKeys.address("whatsapp", "+919812345678", null))
        assertNull(ChatKeys.address("whatsapp", "120363025512345678@g.us", null))
        assertNull(ChatKeys.address("whatsapp", "123456789012345@lid", null))
        assertNull(ChatKeys.address("whatsapp", "rahul mehta", "+91 98123 45678"))
        assertEquals("919812345678", ChatKeys.address("sms", "42", "+91 98123 45678"))
        assertEquals("9812345678", ChatKeys.address("sms", "42", "(981) 234-5678"))
        assertNull(ChatKeys.address("sms", "42", "VM-HDFCBK"))
        assertNull(ChatKeys.address("sms", "1234567", null))
        assertEquals("1234567", ChatKeys.phoneDigits("+1234567"))
    }

    @Test
    fun messageIds() {
        assertEquals(
            "b1eeaba2871e3df1e507cf43f9c53cf5",
            ChatKeys.messageId(
                "whatsapp:919812345678@s.whatsapp.net",
                "Rahul Mehta",
                1793080000000,
                "Can you send the revised valuation note today?",
            ),
        )
        // UTF-8, not platform encoding.
        assertEquals("a7316b7d689ee9bfe5b8e8cb1bb4b519", ChatKeys.messageId("sms:42", "+91 98123 45678", 1, "\u20B9 ok \uD83D\uDE00"))
    }

    @Test
    fun jsonEscaping() {
        assertEquals(
            """{"a":"q\"b\\s\n\r\t\u0001\u2028\u2029","n":5,"t":true,"l":["x"],"m":{"k":false}}""",
            Json.obj(
                "a" to "q\"b\\s\n\r\t\u0001\u2028\u2029",
                "skip" to null,
                "n" to 5,
                "t" to true,
                "l" to listOf("x"),
                "m" to mapOf("k" to false, "gone" to null),
            ),
        )
        assertEquals("\"\uD83D\uDE00\"", Json.quote("\uD83D\uDE00"))
        assertEquals("\"\\ud83d.\"", Json.quote("\uD83D."))
        assertEquals("[1,{\"r\":1}]", buildString { Json.writeValue(this, listOf(1L, Json.Raw("{\"r\":1}"))) })
        assertEquals("1.5", buildString { Json.writeValue(this, 1.5) })
    }

    @Test
    fun pairBody() {
        assertEquals(
            """{"op":"pair","code":"K7Q2-M9XD","name":"Amith's Pixel","model":"Google Pixel 8","appVersion":"0.9.0","android":34}""",
            Protocol.pairBody("K7Q2-M9XD", "Amith's Pixel", "Google Pixel 8", Protocol.APP_VERSION, 34),
        )
    }

    @Test
    fun syncBody() {
        val message = MessageEvent(
            id = "4f0c2e",
            app = "whatsapp",
            chat = "whatsapp:919812345678@s.whatsapp.net",
            title = "Rahul Mehta",
            group = false,
            sender = "Rahul Mehta",
            fromMe = false,
            text = "Hi",
            at = 1793080000000,
            address = null,
        )
        val cleared = ClearedEvent("whatsapp", "whatsapp:919812345678@s.whatsapp.net", 1793080600000, "read")
        val body = Protocol.syncBody(
            "0.9.0",
            34,
            Protocol.Access(notifications = true, postNotifications = true, batteryUnrestricted = false),
            listOf(message.toJson(), cleared.toJson()),
            setOf("whatsapp:b", "whatsapp:a"),
        )
        assertEquals(
            """{"op":"sync","appVersion":"0.9.0","android":34,""" +
                """"access":{"notifications":true,"postNotifications":true,"batteryUnrestricted":false},""" +
                """"events":[{"type":"message","id":"4f0c2e","app":"whatsapp","chat":"whatsapp:919812345678@s.whatsapp.net",""" +
                """"title":"Rahul Mehta","group":false,"sender":"Rahul Mehta","fromMe":false,"text":"Hi","at":1793080000000},""" +
                """{"type":"cleared","app":"whatsapp","chat":"whatsapp:919812345678@s.whatsapp.net","at":1793080600000,"reason":"read"}],""" +
                """"live":["whatsapp:a","whatsapp:b"]}""",
            body,
        )
        assertEquals(
            """{"op":"sync","appVersion":"0.9.0","android":26,"access":{"notifications":false,"postNotifications":false,"batteryUnrestricted":false},"events":[],"live":[]}""",
            Protocol.syncBody("0.9.0", 26, Protocol.Access(false, false, false), emptyList(), emptyList()),
        )
    }

    @Test
    fun clearedReasons() {
        assertEquals("opened", Protocol.clearedReason(1))
        assertEquals("dismissed", Protocol.clearedReason(2))
        assertEquals("dismissed", Protocol.clearedReason(3))
        assertEquals("read", Protocol.clearedReason(8))
        assertEquals("read", Protocol.clearedReason(9))
        assertEquals("other", Protocol.clearedReason(10))
        assertEquals("other", Protocol.clearedReason(18))
    }

    @Test
    fun origins() {
        val o = Protocol.DEFAULT_ORIGIN
        assertEquals(o, Links.origin("$o/?page=chats"))
        assertEquals(o, Links.origin("HTTPS://Flow-Voice-Workspace.amithraj123.chatgpt.site:443/x#y"))
        assertEquals("https://a.example:8443", Links.origin("https://a.example:8443/"))
        assertNull(Links.origin("javascript:alert(1)"))
        assertNull(Links.origin("file:///sdcard/x.html"))
        assertNull(Links.origin("about:blank"))
        assertNull(Links.origin(null))
        assertFalse(o == Links.origin("https://flow-voice-workspace.amithraj123.chatgpt.site.evil.example/"))
        assertFalse(o == Links.origin("https://evil.example/@flow-voice-workspace.amithraj123.chatgpt.site"))
        assertTrue(Links.isHttps("https://x.example"))
        assertFalse(Links.isHttps("http://x.example"))
    }

    @Test
    fun nudgeLinks() {
        val o = "https://w.example"
        assertEquals("$o/?page=chats/inbox#thr_123", Links.pageUrl(o, "chats/inbox#thr_123"))
        assertEquals("$o/?page=mail", Links.pageUrl(o, "mail"))
        assertEquals("$o/?page=mail", Links.pageUrl(o, "/mail#<script>"))
        assertEquals("$o/", Links.pageUrl(o, "javascript:alert(1)"))
        assertEquals("$o/", Links.pageUrl(o, "//evil.example"))
        assertEquals("$o/", Links.pageUrl(o, null))
        assertEquals("chats/inbox" to "t1", Links.parse("chats/inbox#t1"))
        assertNull(Links.parse("chats?x=1"))
    }

    @Test
    fun syncPolicy() {
        assertEquals(0, SyncPolicy.backoffMillis(0))
        assertEquals(30_000, SyncPolicy.backoffMillis(1))
        assertEquals(60_000, SyncPolicy.backoffMillis(2))
        assertEquals(120_000, SyncPolicy.backoffMillis(3))
        assertEquals(30 * 60_000L, SyncPolicy.backoffMillis(7))
        assertEquals(30 * 60_000L, SyncPolicy.backoffMillis(500))
        assertEquals(900, SyncPolicy.periodSeconds(null))
        assertEquals(900, SyncPolicy.periodSeconds(60))
        assertEquals(1800, SyncPolicy.periodSeconds(1800))
        assertEquals(6 * 3600L, SyncPolicy.periodSeconds(999_999))
        assertEquals(0, SyncPolicy.overflow(10, 5))
        assertEquals(5, SyncPolicy.overflow(SyncPolicy.MAX_QUEUE, 5))
        assertEquals(200, SyncPolicy.batch((1..450).toList()).size)
        assertEquals(1, SyncPolicy.batch((1..450).toList()).first())
        assertEquals(3, SyncPolicy.batch(listOf(1, 2, 3)).size)
    }

    @Test
    fun recentReplies() {
        var now = 1_000_000L
        val r = RecentReplies(windowMs = 60_000, clock = { now })
        r.record("whatsapp:a", "Will send  by 6 ")
        assertTrue(r.isEcho("whatsapp:a", "Will send by 6", now + 5_000))
        assertFalse(r.isEcho("whatsapp:b", "Will send by 6", now))
        assertFalse(r.isEcho("whatsapp:a", "Something else", now))
        now += 120_000
        assertFalse(r.isEcho("whatsapp:a", "Will send by 6", now))
    }

    @Test
    fun textHelpers() {
        assertEquals("ab", Text.truncate("ab\uD83D\uDE00", 3))
        assertEquals("ab\uD83D\uDE00", Text.truncate("ab\uD83D\uDE00", 4))
        assertEquals("Rahul Mehta", Text.name("Rahul Mehta (12 messages)"))
        assertEquals("Rahul Mehta", Text.name("Rahul Mehta \u2022 2 new messages"))
        assertEquals("Family", Text.name("Family: 3 messages"))
        assertNull(Text.name("  \u200E "))
        assertEquals("line 1\nline 2", Text.body("  line 1\r\nline 2 \u200F"))
    }
}
