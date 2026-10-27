package `in`.aeka.workspace.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** House style: no em dashes or en dashes anywhere in the Android project, British spelling in copy. */
class CopyStyleTest {
    private val androidRoot: File = File(System.getProperty("user.dir")).let { if (it.name == "core") it.parentFile else it }

    @Test
    fun noEmOrEnDashesInTheProject() {
        val exts = setOf("kt", "kts", "xml", "md", "properties", "yml", "json", "pro")
        val offenders = androidRoot.walkTopDown()
            .onEnter { it.name !in setOf("build", ".gradle", ".kotlin", ".idea") }
            .filter { it.isFile && it.extension in exts }
            .filter { f -> f.readText().any { it == '\u2013' || it == '\u2014' } }
            .map { it.relativeTo(androidRoot).path }
            .toList()
        assertTrue("checked the Android project at $androidRoot", File(androidRoot, "settings.gradle.kts").isFile)
        assertEquals(emptyList<String>(), offenders)
    }

    @Test
    fun userFacingTextUsesBritishSpelling() {
        val all = listOf(
            Texts.NUDGE_CHANNEL, Texts.NUDGE_CHANNEL_DESCRIPTION, Texts.OFFLINE_TITLE, Texts.OFFLINE_BODY, Texts.RETRY,
            Texts.NOT_PAIRED, Texts.DISCONNECTED, Texts.NO_CODE, Texts.NETWORK, Texts.SIGN_IN, Texts.SERVER,
            Texts.PAIR_FAILED, Texts.NO_SETTINGS,
        ).joinToString("\n")
        for (us in listOf("authoriz", "organiz", "recogniz", "color", "center", "canceled", "license ")) {
            assertTrue("American spelling \"$us\" in: $all", !all.contains(us, ignoreCase = true))
        }
    }
}
