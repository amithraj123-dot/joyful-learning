// A compile check for the app's Kotlin sources without the Android SDK: they are compiled as plain
// Kotlin/JVM against Robolectric's android-all jar (the Android 15 framework, API 35) with stub R and
// BuildConfig classes. It only proves the sources compile; the real build is the Android Gradle
// Plugin in CI. Run from android/: gradle -p compile-check compileKotlin
pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        id("org.jetbrains.kotlin.jvm") version "2.1.21"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "aeka-android-compile-check"
