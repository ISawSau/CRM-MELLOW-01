import java.util.Properties

plugins {
    id("com.android.application")
}

// Versión: la de package.json (una sola fuente, como en escritorio).
val pkg = groovy.json.JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val appVersion = pkg["version"] as String
val (major, minor, patch) = appVersion.split(".").map { it.toInt() }

// Firma: la clave vive fuera del repositorio (secreto de GitHub o archivo local, D-101).
val keystoreFile = System.getenv("ANDROID_KEYSTORE_FILE")?.let { file(it) }

android {
    namespace = "cc.yellowmellow.crm"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "cc.yellowmellow.crm"
        minSdk = 29
        targetSdk = 36
        versionCode = major * 10000 + minor * 100 + patch
        versionName = appVersion
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
    }

    signingConfigs {
        if (keystoreFile != null && keystoreFile.exists()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    // Un APK por arquitectura: arm64 para el móvil (GrapheneOS solo funciona en Pixel) y
    // x86_64 para el emulador de los tests.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    sourceSets {
        getByName("main") {
            // libnode.so (nodejs-mobile) y libbetter_sqlite3.so, preparados por el script.
            jniLibs.directories.add("libnode/jniLibs")
        }
    }

    packaging {
        // Las librerías nativas se extraen al instalar: Node carga SQLite con dlopen desde ahí.
        jniLibs { useLegacyPackaging = true }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { buildConfig = true }
}
