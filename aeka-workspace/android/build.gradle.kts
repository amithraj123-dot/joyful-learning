// Plugins are declared here (not applied) so every module shares one Kotlin Gradle Plugin
// classloader with the Android Gradle Plugin. A `-PcoreOnly` build uses core-only.gradle.kts
// instead, which never resolves the Android Gradle Plugin (see settings.gradle.kts).
plugins {
    id("com.android.application") apply false
    id("org.jetbrains.kotlin.android") apply false
    id("org.jetbrains.kotlin.jvm") apply false
}
