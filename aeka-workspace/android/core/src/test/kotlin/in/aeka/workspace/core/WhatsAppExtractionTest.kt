package `in`.aeka.workspace.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppExtractionTest {
    private val rahulJid = "919812345678@s.whatsapp.net"
    private val t0 = 1_793_080_000_000L

    private fun oneToOne(vararg messages: RawMessage, title: String = "Rahul Mehta") = RawNotification(
        packageName = "com.whatsapp",
        postTime = t0 + 60_000,
        whenTime = messages.last().time,
        key = "0|com.whatsapp|1|$rahulJid|10123",
        tag = rahulJid,
        shortcutId = rahulJid,
        category = "msg",
        channelId = "individual_chat_defaults_3",
        title = title,
        text = messages.last().text,
        isGroupConversation = false,
        selfName = "You",
        messages = messages.toList(),
        hasReplyAction = true,
    )

    private fun messages(e: Extraction): Extraction.Messages {
        assertTrue("expected messages, got $e", e is Extraction.Messages)
        return e as Extraction.Messages
    }

    @Test
    fun oneToOneMessagingStyle() {
        val n = oneToOne(
            RawMessage("Can you send the revised valuation note today?", t0, "Rahul Mehta", "rahul"),
        )
        val r = messages(Extractor.extract(n, Apps.WHATSAPP))
        assertEquals("whatsapp:$rahulJid", r.chat.chat)
        assertEquals("919812345678", r.chat.address)
        assertFalse(r.chat.group)
        val m = r.messages.single()
        assertEquals("b1eeaba2871e3df1e507cf43f9c53cf5", m.id)
        assertEquals("Rahul Mehta", m.sender)
        assertEquals("Rahul Mehta", m.title)
        assertEquals(t0, m.at)
        assertFalse(m.fromMe)
        assertEquals(
            """{"type":"message","id":"b1eeaba2871e3df1e507cf43f9c53cf5","app":"whatsapp",""" +
                """"chat":"whatsapp:919812345678@s.whatsapp.net","title":"Rahul Mehta","group":false,""" +
                """"sender":"Rahul Mehta","fromMe":false,"text":"Can you send the revised valuation note today?",""" +
                """"at":1793080000000,"address":"919812345678"}""",
            m.toJson(),
        )
    }

    @Test
    fun repeatedHistoryKeepsTheSameIds() {
        val m1 = RawMessage("Are you free at 4?", t0, "Rahul Mehta", "rahul")
        val m2 = RawMessage("Need to discuss the SPA", t0 + 30_000, "Rahul Mehta", "rahul")
        val m3 = RawMessage("Calling you in 10 minutes", t0 + 90_000, "Rahul Mehta", "rahul")
        val first = messages(Extractor.extract(oneToOne(m1, m2, title = "Rahul Mehta (2 messages)"), Apps.WHATSAPP))
        val second = messages(Extractor.extract(oneToOne(m1, m2, m3, title = "Rahul Mehta (3 messages)"), Apps.WHATSAPP))
        assertEquals(2, first.messages.size)
        assertEquals(3, second.messages.size)
        assertEquals(first.messages.map { it.id }, second.messages.take(2).map { it.id })
        assertEquals("Rahul Mehta", second.chat.title)
        assertEquals(3, second.messages.map { it.id }.toSet().size)
    }

    @Test
    fun identicalMessagesInOneNotificationCollapse() {
        val m = RawMessage("ok", t0, "Rahul Mehta")
        val r = messages(Extractor.extract(oneToOne(m, m), Apps.WHATSAPP))
        assertEquals(1, r.messages.size)
    }

    @Test
    fun groupMessagingStyle() {
        val gid = "120363025512345678@g.us"
        val n = RawNotification(
            packageName = "com.whatsapp",
            postTime = t0,
            shortcutId = gid,
            tag = gid,
            category = "msg",
            title = "Vista Earth deal",
            conversationTitle = "Vista Earth deal (3 messages)",
            isGroupConversation = true,
            selfName = "You",
            messages = listOf(
                RawMessage("Draft term sheet is in the folder", t0, "Priya Shah", "p1"),
                RawMessage("\uD83D\uDCF7 Photo", t0 + 1000, "Karan Rao", "p2"),
                RawMessage("Thanks, will review tonight", t0 + 2000, null, null),
            ),
            hasReplyAction = true,
        )
        val r = messages(Extractor.extract(n, Apps.WHATSAPP))
        assertEquals("whatsapp:$gid", r.chat.chat)
        assertTrue(r.chat.group)
        assertNull(r.chat.address)
        assertEquals("Vista Earth deal", r.chat.title)
        assertEquals(listOf("Priya Shah", "Karan Rao", "You"), r.messages.map { it.sender })
        assertEquals(listOf(false, false, true), r.messages.map { it.fromMe })
        assertEquals("\uD83D\uDCF7 Photo", r.messages[1].text)
    }

    @Test
    fun ownMessageWithoutSelfName() {
        val n = oneToOne(
            RawMessage("Will send by 6", t0, null),
        ).copy(selfName = null)
        val m = messages(Extractor.extract(n, Apps.WHATSAPP)).messages.single()
        assertTrue(m.fromMe)
        assertEquals(Extractor.ME, m.sender)
    }

    @Test
    fun ownMessageMarkedBySelfKey() {
        val n = oneToOne(RawMessage("Done", t0, "Amith Raj", "me-key")).copy(selfKey = "me-key", selfName = "Amith Raj")
        val m = messages(Extractor.extract(n, Apps.WHATSAPP)).messages.single()
        assertTrue(m.fromMe)
        assertEquals("Amith Raj", m.sender)
    }

    @Test
    fun missedVoiceAndVideoCalls() {
        val base = RawNotification(
            packageName = "com.whatsapp",
            postTime = t0 + 5000,
            whenTime = t0,
            tag = "missed_call",
            category = "missed_call",
            channelId = "missed_calls",
            title = "Rahul Mehta",
            text = "Missed voice call",
        )
        val voice = messages(Extractor.extract(base, Apps.WHATSAPP))
        assertEquals("whatsapp:rahul mehta", voice.chat.chat)
        assertEquals("Missed voice call", voice.messages.single().text)
        assertEquals("Rahul Mehta", voice.messages.single().sender)
        assertEquals(t0, voice.messages.single().at)

        val video = messages(Extractor.extract(base.copy(text = "2 missed video calls", category = null), Apps.WHATSAPP))
        assertEquals("Missed video call", video.messages.single().text)

        val swapped = messages(Extractor.extract(base.copy(title = "Missed voice call", text = "Rahul Mehta"), Apps.WHATSAPP))
        assertEquals("Rahul Mehta", swapped.messages.single().sender)

        val withJid = messages(Extractor.extract(base.copy(shortcutId = rahulJid), Apps.WHATSAPP))
        assertEquals("whatsapp:$rahulJid", withJid.chat.chat)
        assertEquals("919812345678", withJid.chat.address)

        val several = Extractor.extract(base.copy(title = "WhatsApp", text = "3 missed calls"), Apps.WHATSAPP)
        assertEquals(Extraction.Dropped(DropReason.EMPTY), several)
    }

    @Test
    fun callsInProgressAreDropped() {
        val ringing = RawNotification(
            packageName = "com.whatsapp",
            postTime = t0,
            category = "call",
            title = "Rahul Mehta",
            text = "Incoming voice call",
        )
        assertEquals(Extraction.Dropped(DropReason.CALL), Extractor.extract(ringing, Apps.WHATSAPP))
        assertEquals(
            Extraction.Dropped(DropReason.ONGOING),
            Extractor.extract(ringing.copy(isOngoing = true, text = "Ongoing voice call"), Apps.WHATSAPP),
        )
        assertEquals(
            Extraction.Dropped(DropReason.CALL),
            Extractor.extract(ringing.copy(category = null, text = "Incoming video call"), Apps.WHATSAPP),
        )
    }

    @Test
    fun summariesAndStatusNoticesAreDropped() {
        val summary = RawNotification(
            packageName = "com.whatsapp",
            postTime = t0,
            isGroupSummary = true,
            title = "WhatsApp",
            text = "5 messages from 3 chats",
        )
        assertEquals(Extraction.Dropped(DropReason.SUMMARY), Extractor.extract(summary, Apps.WHATSAPP))
        assertEquals(
            Extraction.Dropped(DropReason.STATUS),
            Extractor.extract(summary.copy(isGroupSummary = false), Apps.WHATSAPP),
        )
        for (text in listOf("Checking for new messages", "WhatsApp Web is currently active", "Backup in progress", "Backing up messages")) {
            assertEquals(
                text,
                Extraction.Dropped(DropReason.STATUS),
                Extractor.extract(summary.copy(isGroupSummary = false, text = text), Apps.WHATSAPP),
            )
        }
        assertEquals(
            Extraction.Dropped(DropReason.ONGOING),
            Extractor.extract(summary.copy(isGroupSummary = false, isOngoing = true, text = "Backup in progress"), Apps.WHATSAPP),
        )
        assertEquals(
            Extraction.Dropped(DropReason.ONGOING),
            Extractor.extract(summary.copy(isGroupSummary = false, isForegroundService = true, text = "Sending 1 message"), Apps.WHATSAPP),
        )
    }

    @Test
    fun aMessageThatMentionsBackupIsKept() {
        val n = oneToOne(RawMessage("Backup in progress at our end, will share by 5", t0, "Rahul Mehta"))
        assertEquals(1, messages(Extractor.extract(n, Apps.WHATSAPP)).messages.size)
    }

    @Test
    fun previewsHidden() {
        val plain = RawNotification(packageName = "com.whatsapp", postTime = t0, title = "WhatsApp", text = "3 new messages")
        assertEquals(Extraction.PreviewsHidden(Apps.WHATSAPP), Extractor.extract(plain, Apps.WHATSAPP))
        assertEquals(
            Extraction.PreviewsHidden(Apps.WHATSAPP),
            Extractor.extract(plain.copy(title = "Rahul Mehta", text = "New message"), Apps.WHATSAPP),
        )
        val styled = oneToOne(RawMessage("New message", t0, "Rahul Mehta"))
        assertEquals(Extraction.PreviewsHidden(Apps.WHATSAPP), Extractor.extract(styled, Apps.WHATSAPP))
    }

    @Test
    fun whatsAppBusinessAndPrivacyIds() {
        val lid = "123456789012345@lid"
        val n = oneToOne(RawMessage("Please confirm the fee", t0, "Client")).copy(
            packageName = "com.whatsapp.w4b",
            shortcutId = lid,
            tag = lid,
            title = "Client",
        )
        val r = messages(Extractor.extract(n, Apps.WHATSAPP_BUSINESS))
        assertEquals("whatsapp_business:$lid", r.chat.chat)
        assertNull(r.chat.address)
    }

    @Test
    fun unsavedNumberTitleIsCleaned() {
        val n = oneToOne(RawMessage("Hello, this is Suresh from the bank", t0, "\u202A+91 98200 12345\u202C"))
            .copy(title = "\u202A+91 98200 12345\u202C", shortcutId = "919820012345@s.whatsapp.net", tag = null)
        val r = messages(Extractor.extract(n, Apps.WHATSAPP))
        assertEquals("+91 98200 12345", r.chat.title)
        assertEquals("919820012345", r.chat.address)
        assertEquals("+91 98200 12345", r.messages.single().sender)
    }

    @Test
    fun fallsBackToTagThenTitle() {
        val n = oneToOne(RawMessage("Hi", t0, "Rahul Mehta")).copy(shortcutId = null, tag = null, title = "Rahul  MEHTA")
        assertEquals("whatsapp:rahul mehta", messages(Extractor.extract(n, Apps.WHATSAPP)).chat.chat)
        val tagged = n.copy(tag = "some-tag")
        assertEquals("whatsapp:some-tag", messages(Extractor.extract(tagged, Apps.WHATSAPP)).chat.chat)
    }

    @Test
    fun legacyGroupWithoutMessagingStyle() {
        val n = RawNotification(
            packageName = "com.whatsapp",
            postTime = t0,
            whenTime = t0,
            title = "Priya Shah @ Vista Earth deal",
            text = "Draft is ready",
        )
        val r = messages(Extractor.extract(n, Apps.WHATSAPP))
        assertEquals("whatsapp:vista earth deal", r.chat.chat)
        assertTrue(r.chat.group)
        assertEquals("Priya Shah", r.messages.single().sender)
        assertEquals("Draft is ready", r.messages.single().text)
    }

    @Test
    fun limitsAreApplied() {
        val long = "x".repeat(5000)
        val n = oneToOne(RawMessage(long, t0, "S".repeat(300))).copy(
            isGroupConversation = true,
            conversationTitle = "G".repeat(300),
        )
        val m = messages(Extractor.extract(n, Apps.WHATSAPP)).messages.single()
        assertEquals(Text.MAX_TEXT, m.text.length)
        assertEquals(Text.MAX_SENDER, m.sender.length)
        assertEquals(Text.MAX_TITLE, m.title.length)
        assertEquals(ChatKeys.messageId(m.chat, m.sender, m.at, m.text), m.id)
    }

    @Test
    fun otpOverWhatsAppIsDropped() {
        val n = oneToOne(RawMessage("483920 is your verification code. For your security, do not share this code.", t0, "Bank"))
        assertEquals(Extraction.Dropped(DropReason.OTP), Extractor.extract(n, Apps.WHATSAPP))
    }

    @Test
    fun replySentFromAekaIsRecognisedInWhatsAppsUpdate() {
        val replies = RecentReplies(clock = { t0 + 120_000 })
        replies.record("whatsapp:$rahulJid", "Will send it by 6 pm.", t0 + 120_000)
        val updated = oneToOne(
            RawMessage("Can you send the revised valuation note today?", t0, "Rahul Mehta", "rahul"),
            RawMessage("Will send it by 6 pm.", t0 + 121_500, null),
        )
        val r = messages(Extractor.extract(updated, Apps.WHATSAPP))
        val mine = r.messages.single { it.fromMe }
        assertEquals("You", mine.sender)
        assertTrue(replies.isEcho(mine.chat, mine.text, mine.at))
        assertFalse(replies.isEcho(r.messages.first().chat, r.messages.first().text, r.messages.first().at))
    }
}
