# Singularity v0.6.4

## Android release packaging

- Corrected Android packaging so the Windows `libmpv-2.dll` is not included in APKs.
- Restored the tested MPV/FFmpeg native libraries to clean GitHub Actions builds.
- Published architecture-specific `arm64-v8a` and `x86_64` APKs with native-library and signature verification.

## What's new

- Added independent volume sliders and mute controls to every Multiview panel.
- Added Windows volume boost up to 300% for Multiview using the Live TV gain and limiter path.
- Preserved the v0.6.2 interactive Help Center and guided setup flows.

## Downloads

| Platform | File |
| --- | --- |
| Windows installer | `Singularity Setup_0.6.4_x64-setup.exe` |
| Windows MSI | `Singularity Setup_0.6.4_x64.msi` |
| Android (ARM64) | `SingularityV2-arm64-v8a.apk` |
| Android (x86_64) | `SingularityV2-x86_64.apk` |

## Install

- **Windows:** Run the `.exe` installer or `.msi` package.
- **Android:** Enable installation from unknown sources, then install the APK.

## Previous release

See the v0.6.2 release history for the interactive Help Center, guided setup, and navigation tours.
