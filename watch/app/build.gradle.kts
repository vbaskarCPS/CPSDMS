plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The database's address and its public key are the ones the web app ships with (src/lib/supabaseConfig.ts):
// read from there at build time so they're written in one place only.
val webConfig = rootProject.file("../src/lib/supabaseConfig.ts").readText()
fun webValue(name: String): String =
    Regex("$name = '([^']+)'").find(webConfig)?.groupValues?.get(1)
        ?: error("Couldn't find $name in src/lib/supabaseConfig.ts")

android {
    namespace = "app.propertystars.planner.watch"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.propertystars.planner.watch"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
        buildConfigField("String", "SUPABASE_URL", "\"${webValue("supabaseUrl")}\"")
        buildConfigField("String", "SUPABASE_KEY", "\"${webValue("supabaseAnonKey")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    // the Today tile
    implementation("androidx.wear.tiles:tiles:1.4.1")
    implementation("androidx.wear.protolayout:protolayout:1.2.1")
    implementation("com.google.guava:guava:33.3.1-android")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.9.0")

    // the watch-face spots (complications)
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")

    // heart rate from the watch's sensor
    implementation("androidx.health:health-services-client:1.0.0-rc02")

    // the plain tests in src/test (session order, next up, heart-rate sums): run on the computer, no watch needed
    testImplementation("junit:junit:4.13.2")
}
