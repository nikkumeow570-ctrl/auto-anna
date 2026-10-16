plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Same signing key for every release, so each APK installs as an update.
// CI passes these through environment variables (see .github/workflows/android.yml).
val ksFile: String? = System.getenv("KEYSTORE_FILE")

android {
    namespace = "app.autoanna"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.autoanna"
        minSdk = 26
        targetSdk = 36
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    signingConfigs {
        if (ksFile != null) {
            create("release") {
                storeFile = file(ksFile)
                storePassword = System.getenv("STORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // A real release key is required. Without it the build stops (see the workflow), so a debug-signed
            // app can never be published by mistake.
            signingConfig = if (ksFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    bundle { language { enableSplit = false } }   // keep Tamil and English in every install
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-ktx:1.15.0")
}
