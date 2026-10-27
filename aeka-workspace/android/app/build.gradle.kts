import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The hosted workspace the app opens and syncs with. Override for a test deployment with
// -Paeka.workspaceOrigin=https://...
val workspaceOrigin: String = providers.gradleProperty("aeka.workspaceOrigin")
    .getOrElse("https://flow-voice-workspace.amithraj123.chatgpt.site")
require(workspaceOrigin.matches(Regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$"))) { "aeka.workspaceOrigin must be an https origin" }

// CI builds count up so each APK installs over the last one.
val buildNumber: Int = providers.environmentVariable("GITHUB_RUN_NUMBER").map { it.toInt() }.getOrElse(0)

// Release signing, only when the CI secrets are present (see .github/workflows/aeka-workspace.yml).
val releaseStore: String? = providers.environmentVariable("AEKA_ANDROID_KEYSTORE_PATH").orNull
val releaseStorePassword: String? = providers.environmentVariable("AEKA_ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias: String? = providers.environmentVariable("AEKA_ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword: String? = providers.environmentVariable("AEKA_ANDROID_KEY_PASSWORD").orNull ?: releaseStorePassword
val hasReleaseKey = !releaseStore.isNullOrBlank() && !releaseStorePassword.isNullOrBlank() && !releaseKeyAlias.isNullOrBlank()

android {
    namespace = "in.aeka.workspace"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.aeka.workspace"
        minSdk = 26
        targetSdk = 35
        versionCode = 90_000 + buildNumber
        versionName = "0.9.0"
        buildConfigField("String", "WORKSPACE_ORIGIN", "\"$workspaceOrigin\"")
    }

    signingConfigs {
        // A development key checked into the repository (see README.md, "Signing"), so debug APKs from
        // any machine or CI run install over each other. It is not a release key.
        getByName("debug") {
            storeFile = rootProject.file("keystore/aeka-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(releaseStore!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
        getByName("release") {
            // No shrinking: the JavaScript bridge methods must keep their names.
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        // Errors fail the build; warnings are reported (HTML and XML, uploaded by CI) but do not.
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = false
        htmlReport = true
        xmlReport = true
        // Version-freshness checks change with every AGP release and say nothing about this code.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // The only dependency: the plain Kotlin core module. No AndroidX or third-party libraries.
    implementation(project(":core"))
}
