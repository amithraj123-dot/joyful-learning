import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
    sourceSets {
        main {
            kotlin.srcDirs("../core/src/main/kotlin", "../app/src/main/kotlin", "stubs")
        }
    }
}

dependencies {
    // Android 15 (API 35), the app's compileSdk.
    compileOnly("org.robolectric:android-all:15-robolectric-13954326")
}
