# Android Plugin Installation

These Kotlin files must be placed **after** running `npm run tauri android init`,
which generates the `src-tauri/gen/android/` directory.

## Steps

### 1. Run Android init (requires Android SDK + NDK configured)
```bash
npm run tauri android init
```

### 2. Copy plugin files
```bash
DEST=src-tauri/gen/android/app/src/main/java/com/singularity/app
cp src-tauri/android-plugin/MpvPlugin.kt $DEST/
cp src-tauri/android-plugin/CredentialPlugin.kt $DEST/
```

### 3. Register plugins in MainActivity.kt
Edit `$DEST/MainActivity.kt`:
```kotlin
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MpvPlugin::class.java)
        registerPlugin(CredentialPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

### 4. Add dependencies to app/build.gradle
```groovy
dependencies {
    // MPV for Android (mpv-android prebuilt)
    implementation 'is.xyz.mpv:mpv-android:0.38.0'
    // Encrypted credentials
    implementation 'androidx.security:security-crypto:1.1.0-alpha06'
}

android {
    defaultConfig {
        ndk { abiFilters "arm64-v8a", "x86_64" }
    }
}
```

### 5. Make WebView background transparent
In `MainActivity.kt` or a custom TauriWebViewClient, call:
```kotlin
webView.setBackgroundColor(Color.TRANSPARENT)
```
This lets the MPV SurfaceView below show through.

### 6. Android SDK setup (one-time)
```bash
rustup target add aarch64-linux-android x86_64-linux-android
```
Install NDK via Android Studio → SDK Manager → SDK Tools → NDK.

### 7. Run on device/emulator
```bash
npm run tauri android dev
```
