// The planner's own watch face, in Watch Face Format (no code: the watch draws it from res/raw/watchface.xml).
// Its rings and its "next" line are the planner app's spots (app/…/Spots.kt), so install the app as well.
// Set up as Google's own Watch Face Format samples are (github.com/android/wear-os-samples, WatchFaceFormat).
plugins {
    id("com.android.application")
}

android {
    namespace = "app.propertystars.planner.watch.face"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.propertystars.planner.watch.face"
        minSdk = 34              // Watch Face Format 2 needs Wear OS 5 (Android 14, API 34)
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes {
        // A Watch Face Format package must hold no code, yet even with none of ours a build puts a classes.dex in
        // (the R class): likely why the watch wouldn't apply the face. Shrinking takes it out, as Google's samples do
        // for both builds ("Adds minifyEnabled to debug builds to exclude Dex files"). Resources
        // are never shrunk: the watch looks them up by name from watchface.xml.
        debug {
            isMinifyEnabled = true
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = false
        }
    }
}
