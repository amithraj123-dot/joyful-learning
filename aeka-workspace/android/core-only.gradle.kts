// Root build file for `-PcoreOnly` builds: only the Kotlin/JVM plugin, so no Android SDK or
// Android Gradle Plugin is needed.
plugins {
    id("org.jetbrains.kotlin.jvm") apply false
}
