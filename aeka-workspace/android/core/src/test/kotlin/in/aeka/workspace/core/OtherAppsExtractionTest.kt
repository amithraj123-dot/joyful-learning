package `in`.aeka.workspace.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OtherAppsExtractionTest {
    private val t0 = 1_793_080_000_000L

    private fun messages(e: Extraction): Extraction.Messages {
        assertTrue("expected messages, got $e", e is Extraction.Messages)
        return e as Extraction.Messages
    }

    // Gmail

    private val gmail = RawNotification(
        packageName = "com.google.android.gm",
        postTime = t0 + 2000,
        whenTime = t0,
        tag = "gig:-1234567:thread-f:1780000000000000000",
        category = "email",
        channelId = "^sq^amith@aeka.in^all",
        title = "Rahul Mehta",
        text = "Revised valuation note",
        bigText = "Revised valuation note\nPlease find attached the revised note. Could you review it before the call?",
        subText = "amith@aeka.in",
    )

    @Test
    fun gmailSenderSubjectAndSnippet() {
        val r = messages(Extractor.extract(gmail, Apps.GMAIL))
        assertEquals("gmail:rahul mehta", r.chat.chat)
        assertFalse(r.chat.group)
        assertNull(r.chat.address)
        val m = r.messages.single()
        assertEquals("Rahul Mehta", m.sender)
        assertEquals(
            "Revised valuation note\nPlease find attached the revised note. Could you review it before the call?",
            m.text,
        )
        assertEquals(t0, m.at)
    }

    @Test
    fun gmailSnippetWithoutSubjectPrefixGetsTheSubject() {
        val r = messages(Extractor.extract(gmail.copy(bigText = "Please find attached."), Apps.GMAIL))
        assertEquals("Revised valuation note\nPlease find attached.", r.messages.single().text)
        val subjectOnly = messages(Extractor.extract(gmail.copy(bigText = null), Apps.GMAIL))
        assertEquals("Revised valuation note", subjectOnly.messages.single().text)
    }

    @Test
    fun gmailSummaryAndCodesAreDropped() {
        assertEquals(
            Extraction.Dropped(DropReason.SUMMARY),
            Extractor.extract(gmail.copy(isGroupSummary = true, title = "3 new emails"), Apps.GMAIL),
        )
        assertEquals(
            Extraction.Dropped(DropReason.STATUS),
            Extractor.extract(gmail.copy(title = "amith@aeka.in", text = "3 new emails", bigText = null), Apps.GMAIL),
        )
        assertEquals(
            Extraction.Dropped(DropReason.OTP),
            Extractor.extract(
                gmail.copy(title = "Microsoft account team", text = "Your security code", bigText = "Your security code\nSecurity code: 482913"),
                Apps.GMAIL,
            ),
        )
    }

    @Test
    fun gmailCountTitleIsNotASender() {
        assertEquals(
            Extraction.Dropped(DropReason.STATUS),
            Extractor.extract(gmail.copy(title = "3 new messages", text = "Rahul Mehta, Priya Shah"), Apps.GMAIL),
        )
    }

    @Test
    fun gmailSenderCountIsRemoved() {
        val r = messages(Extractor.extract(gmail.copy(title = "Rahul Mehta (2)"), Apps.GMAIL))
        assertEquals("gmail:rahul mehta", r.chat.chat)
    }

    // LinkedIn

    @Test
    fun linkedInMessage() {
        val n = RawNotification(
            packageName = "com.linkedin.android",
            postTime = t0,
            shortcutId = "2-ZjQ1NGE3",
            category = "msg",
            title = "Neha Kapoor",
            text = "Thanks for connecting. Could we speak tomorrow about the merger?",
            messages = listOf(RawMessage("Thanks for connecting. Could we speak tomorrow about the merger?", t0, "Neha Kapoor")),
            hasReplyAction = true,
        )
        val r = messages(Extractor.extract(n, Apps.LINKEDIN))
        assertEquals("linkedin:2-ZjQ1NGE3", r.chat.chat)
        assertEquals("Neha Kapoor", r.messages.single().sender)
    }

    @Test
    fun linkedInPlainMessageIsKeptAndNoiseIsDropped() {
        val plain = RawNotification(
            packageName = "com.linkedin.android",
            postTime = t0,
            title = "Neha Kapoor",
            text = "Hello Amith, are you available for a short call on Friday?",
        )
        assertEquals(1, messages(Extractor.extract(plain, Apps.LINKEDIN)).messages.size)
        for (text in listOf(
            "Neha Kapoor viewed your profile",
            "You appeared in 14 searches this week",
            "Neha Kapoor commented on your post",
            "Congratulate Rahul Mehta on a work anniversary",
            "Aeka Advisors is hiring: Senior Manager, Tax",
        )) {
            assertEquals(text, Extraction.Dropped(DropReason.NOISE), Extractor.extract(plain.copy(title = "LinkedIn", text = text), Apps.LINKEDIN))
        }
    }

    // SMS

    private val sms = RawNotification(
        packageName = "com.google.android.apps.messaging",
        postTime = t0,
        shortcutId = "42",
        category = "msg",
        title = "+91 98123 45678",
        isGroupConversation = false,
        messages = listOf(RawMessage("Sir, documents couriered today", t0, "+91 98123 45678")),
        hasReplyAction = true,
    )

    @Test
    fun smsFromANumber() {
        val r = messages(Extractor.extract(sms, Apps.SMS))
        assertEquals("sms:42", r.chat.chat)
        assertEquals("919812345678", r.chat.address)
        assertEquals("+91 98123 45678", r.messages.single().sender)
    }

    @Test
    fun smsOneTimePasswordsAreDropped() {
        for (text in listOf(
            "123456 is your OTP for login to NetBanking. Do not share it with anyone.",
            "Your Amazon verification code is 482913.",
            "G-482913 is your Google verification code.",
            "Use 8841 as one time password (OTP) to complete the transaction of Rs 5,000.00",
            "Dear customer, your login code is 302 118. Valid for 10 minutes.",
        )) {
            val n = sms.copy(title = "VM-HDFCBK", messages = listOf(RawMessage(text, t0, "VM-HDFCBK")))
            assertEquals(text, Extraction.Dropped(DropReason.OTP), Extractor.extract(n, Apps.SMS))
        }
    }

    @Test
    fun smsThatMerelyMentionsCodesIsKept() {
        for (text in listOf(
            "Can you share the OTP once you get it?",
            "Rs 45,000 debited from your account on 27-10-26. Avl bal Rs 1,20,000.",
            "Meeting moved to 4 pm, room 2104",
        )) {
            val n = sms.copy(title = "AX-ICICIT", shortcutId = "7", messages = listOf(RawMessage(text, t0, "AX-ICICIT")))
            val r = messages(Extractor.extract(n, Apps.SMS))
            assertNull(r.chat.address)
            assertEquals(text, r.messages.single().text)
        }
    }

    @Test
    fun smsPlainNotificationFromSamsungMessages() {
        val n = RawNotification(
            packageName = "com.samsung.android.messaging",
            postTime = t0,
            whenTime = t0,
            title = "098200 12345",
            text = "Reached the office",
        )
        val r = messages(Extractor.extract(n, Apps.SMS))
        assertEquals("sms:098200 12345", r.chat.chat)
        assertEquals("09820012345", r.chat.address)
    }

    // Teams and Slack

    @Test
    fun teamsGroupChat() {
        val n = RawNotification(
            packageName = "com.microsoft.teams",
            postTime = t0,
            shortcutId = "19:meeting_abc@thread.v2",
            category = "msg",
            title = "Rahul Mehta",
            conversationTitle = "Project Orion",
            isGroupConversation = true,
            messages = listOf(
                RawMessage("Can we move the call to 4 pm?", t0, "Rahul Mehta"),
                RawMessage("Fine by me", t0 + 1000, "Priya Shah"),
            ),
        )
        val r = messages(Extractor.extract(n, Apps.TEAMS))
        assertEquals("teams:19:meeting_abc@thread.v2", r.chat.chat)
        assertTrue(r.chat.group)
        assertEquals("Project Orion", r.chat.title)
        assertEquals(listOf("Rahul Mehta", "Priya Shah"), r.messages.map { it.sender })
    }

    @Test
    fun teamsPlainOneToOne() {
        val n = RawNotification(
            packageName = "com.microsoft.teams",
            postTime = t0,
            whenTime = t0,
            title = "Rahul Mehta",
            text = "Can we move the call to 4 pm?",
        )
        val r = messages(Extractor.extract(n, Apps.TEAMS))
        assertEquals("teams:rahul mehta", r.chat.chat)
        assertFalse(r.chat.group)
    }

    @Test
    fun slackChannelAndDirectMessage() {
        val channel = RawNotification(
            packageName = "com.Slack",
            postTime = t0,
            shortcutId = "T01ABC:C02DEF",
            title = "#deal-team",
            conversationTitle = "#deal-team",
            isGroupConversation = true,
            messages = listOf(RawMessage("Signing moved to Monday", t0, "Karan Rao")),
        )
        val c = messages(Extractor.extract(channel, Apps.SLACK))
        assertTrue(c.chat.group)
        assertEquals("Karan Rao", c.messages.single().sender)

        val dm = RawNotification(
            packageName = "com.Slack",
            postTime = t0,
            shortcutId = "T01ABC:D03GHI",
            title = "Karan Rao",
            messages = listOf(RawMessage("Got a minute?", t0, "Karan Rao")),
        )
        val d = messages(Extractor.extract(dm, Apps.SLACK))
        assertFalse(d.chat.group)
        assertEquals("slack:T01ABC:D03GHI", d.chat.chat)
    }

    @Test
    fun appTitledNoticeIsNotAChat() {
        val n = RawNotification(packageName = "com.Slack", postTime = t0, title = "Slack", text = "You have unread activity")
        assertEquals(Extraction.Dropped(DropReason.STATUS), Extractor.extract(n, Apps.SLACK))
    }

    @Test
    fun systemCategoriesAreDropped() {
        val n = RawNotification(packageName = "com.microsoft.teams", postTime = t0, category = "service", title = "Teams", text = "Signing in")
        assertEquals(Extraction.Dropped(DropReason.STATUS), Extractor.extract(n, Apps.TEAMS))
    }

    @Test
    fun emptyNotificationIsDropped() {
        val n = RawNotification(packageName = "com.Slack", postTime = t0)
        assertEquals(Extraction.Dropped(DropReason.EMPTY), Extractor.extract(n, Apps.SLACK))
    }
}
