plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    id("com.google.gms.google-services")
}

android {
    namespace = "dev.meuquerido.cellsignalmapper"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.comsinal"
        minSdk = 30
        targetSdk = 36
        // The release workflow passes -PversionCode; local and CI builds use 1.
        versionCode = providers.gradleProperty("versionCode").orNull?.toInt() ?: 1
        versionName = "1.0.$versionCode"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}

// Robolectric runs on the Android jar Gradle downloads and verifies, instead of fetching it itself.
val robolectricAndroidAll: Configuration by configurations.creating { isTransitive = false }
tasks.withType<Test>().configureEach {
    inputs.files(robolectricAndroidAll)
    // GsonKeepRulesTest reads the R8 rules and the sources' text, so a change to either reruns it.
    inputs.file("proguard-rules.pro")
    inputs.dir("src/main/java")
    systemProperty("robolectric.offline", "true")
    doFirst { systemProperty("robolectric.dependency.dir", robolectricAndroidAll.singleFile.parent) }
    // StoreScreensTest writes the store screenshots' app screens here when it's set.
    providers.gradleProperty("storeScreens").orNull?.let { systemProperty("storeScreens", it) }
}

dependencies {
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.appcheck.playintegrity)
    implementation(libs.firebase.auth)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.play.services.location)
    implementation (libs.gson)
    implementation(libs.androidx.work.runtime.ktx)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.ui.test.junit4)
    robolectricAndroidAll(libs.robolectric.android.all)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)
}