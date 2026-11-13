// The planner's own watch face, in Watch Face Format (no code: the watch draws it from res/raw/watchface.xml).
// Its rings and its "next" line are the planner app's spots (app/…/Spots.kt), so install the app as well.
plugins {
    id("com.android.application")
}

android {
    namespace = "app.propertystars.planner.watch.face"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.propertystars.planner.watch.face"
        minSdk = 33
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}
