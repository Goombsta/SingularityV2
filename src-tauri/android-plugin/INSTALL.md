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

### 4. Provide the MPV native libraries

`MPVLib.kt` loads the native libraries named `mpv` and `player`. A clean checkout must copy the pinned Android `jniLibs` bundle into:

```text
src-tauri/gen/android/app/src/main/jniLibs/
```

Do not rely on a previously generated `src-tauri/gen/android` directory. `tauri android init` regenerates it, and the release workflow must populate `jniLibs` on every run. Do not add `is.xyz.mpv:mpv-android` as a normal Gradle dependency without verifying the exact artifact; the [upstream mpv-android project](https://github.com/mpv-android/mpv-android) is an application rather than an importable AAR.

The complete CI/release contract, including resource exclusion, LFS hydration, ABI selection, signing, and APK verification, is documented in [`docs/ANDROID-RELEASE.md`](../../docs/ANDROID-RELEASE.md).

Keep the Android build limited to the ABIs for which both Rust and MPV libraries are present:

```groovy
android {
    defaultConfig {
        ndk { abiFilters "arm64-v8a", "x86_64" }
    }
}
```

If `CredentialPlugin.kt` is enabled for a local build, keep its AndroidX security dependency as well:

```groovy
implementation 'androidx.security:security-crypto:1.1.0-alpha06'
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
