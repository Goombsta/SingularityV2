import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    signingConfigs {
        create("release") {
            val kPath = System.getenv("KEYSTORE_PATH")
                ?: System.getenv("TAURI_ANDROID_KEYSTORE_PATH")
                ?: "C:/All Code/apk key/Singularitydeux/Singularitydeux"
            val kPass = System.getenv("ANDROID_STORE_PASSWORD")
                ?: System.getenv("TAURI_ANDROID_KEYSTORE_PASSWORD")
                ?: "Flam3boy!!"
            val kAlias = System.getenv("ANDROID_KEY_ALIAS")
                ?: System.getenv("TAURI_ANDROID_KEY_ALIAS")
                ?: "singularitydeux"
            val kKeyPass = System.getenv("ANDROID_KEY_PASSWORD")
                ?: System.getenv("TAURI_ANDROID_KEY_PASSWORD")
                ?: "Flam3boy!!"
            storeFile = file(kPath)
            storePassword = kPass
            keyAlias = kAlias
            keyPassword = kKeyPass
        }
    }
    compileSdk = 36
    namespace = "com.singularity.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.singularity.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    // MPV native libraries are vendored in jniLibs/ (extracted from mpv-android 2026-03-22 release)
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")