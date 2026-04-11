# Fix VOD Playback Across All Containers

## Summary

Four confirmed bugs prevent VOD and series content from playing correctly:

1. Xtream VOD and episode URLs are hardcoded to `.mp4`, breaking non-MP4 assets before playback starts.
2. `PlayerScreen` unconditionally routes non-Windows to HTML5, so Android never reaches native MPV.
3. The HTML5 `isNativeFormat` branch creates an `mpegts.js` player with `type: 'mp4'` — mpegts.js is a MPEG-TS/FLV demuxer, not a general container player. MKV/AVI/MP4 files fed through it will fail.
4. M3U VOD detection only checks `.mp4`, `.mkv`, `.avi`, `/movie/`, `/series/` — misses `.ts`, `.mov`, `.webm`, and several other containers.

Additionally: `demuxer-lavf-probescore = 10` in the Windows MPV init sets probe confidence to 10/100, which disables reliable container detection for mixed VOD formats.

This work is split into two phases. **Phase A** fixes the four bugs and the probe score — all changes are in existing files, testable today. **Phase B** adds the Android native MPV path, which requires building the Kotlin plugin first and is a separate, larger effort.

---

## Phase A — Backend Fixes + HTML5 Corrections (implement now)

### A1. Xtream URL generation — preserve `container_extension`

**File:** `src-tauri/src/playlist/xtream.rs`

The Xtream `get_vod_streams` and `get_series_info` list responses include a `container_extension` field (e.g. `"mkv"`, `"avi"`, `"ts"`). Read it and use it in the URL. Default to `"mp4"` when absent.

Changes:
- Add `container_extension: Option<String>` to the local `XtreamVod` and `XtreamEpisode` deserialise structs.
- In `get_vod_streams`, replace the hardcoded `.mp4` suffix with the resolved extension:
  ```
  {url}/movie/{username}/{password}/{stream_id}.{ext}
  ```
- In `get_series_info`, replace the hardcoded `.mp4` suffix on episode URLs:
  ```
  {url}/series/{username}/{password}/{ep_id}.{ext}
  ```
- Add `container_extension: Option<String>` to the `VodItem` and `Episode` Rust types in `src-tauri/src/playlist/types.rs` (marked `skip_serializing_if = "Option::is_none"`).
- Add `containerExtension?: string` to the matching TypeScript types in `src/types/index.ts`.

Note: `container_extension` is present in the list response on most Xtream providers but is not guaranteed. Always default to `"mp4"` when absent or empty. Verify the field name against a real provider response before finalising — some providers use `container_extension`, others omit it entirely.

### A2. M3U VOD detection — broaden file extension list

**File:** `src-tauri/src/playlist/m3u.rs` (lines 48–52)

Replace the current narrow check with:

```rust
let ext = stream_url.split('?').next().unwrap_or("").to_lowercase();
let is_vod = ext.ends_with(".mp4")
    || ext.ends_with(".mkv")
    || ext.ends_with(".avi")
    || ext.ends_with(".ts")
    || ext.ends_with(".m2ts")
    || ext.ends_with(".mpegts")
    || ext.ends_with(".mpg")
    || ext.ends_with(".mpeg")
    || ext.ends_with(".mov")
    || ext.ends_with(".m4v")
    || ext.ends_with(".webm")
    || ext.ends_with(".flv")
    || ext.ends_with(".wmv")
    || stream_url.contains("/movie/")
    || stream_url.contains("/series/");
```

The extension check must be applied to the path-only portion (before `?`) to handle URLs with query strings. The original URL is preserved unchanged in `stream_url`.

### A3. HTML5 fallback — remove mpegts.js for native file formats

**File:** `src/screens/PlayerScreen.tsx` (lines 217–226)

The `isNativeFormat` branch currently creates an mpegts.js player with `type: 'mp4'`. This is wrong — mpegts.js cannot demux arbitrary MP4/MKV/AVI/WebM containers. Remove that branch entirely.

Replacement logic for the HTML5 path:

```
if isHls && Hls.isSupported()         → hls.js (unchanged)
else if isNativeFormat                → video.src = url directly; video.play()
else if isMpegTs or unknown live      → mpegts.js with type 'mpegts' (unchanged)
```

If the browser cannot play the format natively (no `canPlayType` support), show a clear "Unsupported format" message rather than a blank player.

### A4. Windows MPV — document and keep probe score override

**File:** `src-tauri/src/commands/player.rs`

The `demuxer-lavf-probescore = 10` option is intentionally kept. Without it, FFmpeg/libav attempts aggressive probing — reading more stream data to identify the container — which causes the MPV thread to stall indefinitely on many IPTV providers. That stall freezes the entire Tauri app window, which Windows then force-closes.

The tradeoff: with probescore=10, libav relies primarily on the URL file extension to select a demuxer. This is acceptable because the Xtream backend now supplies the correct extension via `container_extension`, so the extension in the URL is reliable. Add a comment in the code explaining this so the setting is not removed again.

---

## Phase A Test Plan

**Rust unit tests:**
- Xtream VOD URL generation: given `container_extension = "mkv"`, URL ends with `.mkv`, not `.mp4`.
- Xtream VOD URL generation: given absent `container_extension`, URL ends with `.mp4`.
- Xtream series episode URL generation: episode-specific extension is preserved.
- M3U classification: `.mkv`, `.avi`, `.ts`, `.mpegts`, `.mov`, `.webm`, `.flv` URLs classify as VOD.
- M3U classification: URL with query string (e.g. `stream.ts?token=abc`) classifies correctly.
- M3U classification: plain HLS channel URL does not classify as VOD.

**Manual tests on Windows:**
- Xtream VOD: `mp4`, `mkv`, `avi`, `ts` assets all play with video and audio.
- Xtream series: episodes with non-MP4 containers play correctly.
- Live HLS channel: still plays.
- Live MPEG-TS channel: still plays.
- Audio/subtitle track menus still work when tracks are present.
- Bad URL or 404: stream-error badge appears rather than silent idle.

**Manual tests on Android (HTML5 path — Phase A only):**
- `.mp4` VOD plays via HTML5 `<video>` directly (no mpegts.js).
- `.ts` live stream still plays via mpegts.js.
- Unsupported format (e.g. `.mkv` on Android HTML5): shows unsupported-format message, not blank screen.

---

## Phase B — Android Native MPV (implement after Kotlin plugin is built)

> **Prerequisite:** The `MpvSurfaceView` Kotlin Tauri plugin is listed in CLAUDE.md as Phase 3 — not yet implemented. Phase B is blocked until that plugin is written and checked in. Do not attempt Phase B steps until the plugin exists in the repo.

### B1. Android build setup

- Run `tauri android init` only if `src-tauri/gen/android/` does not exist. **This is a destructive operation** — if the directory already contains manual edits, regenerating it will overwrite them. Check first.
- Copy and register the Kotlin MPV and Credential plugins into the generated Android app.
- Add `mpv-android` and `security-crypto` Gradle dependencies as documented in the plugin.
- Set the Tauri WebView background to transparent so the MPV surface renders underneath.

### B2. Frontend — platform-dispatched player adapter

**Why:** On Android, the Kotlin MPV plugin exposes its own Tauri command surface (not the Rust commands in `player.rs`, which are `#[cfg(not(target_os = "android"))]` and do not exist on that target). The frontend needs to route `invoke()` calls to the correct command names per platform. A thin adapter is the right place to own that branching.

Create `src/lib/nativePlayer.ts` that exposes:

```typescript
create(playerId, x, y, width, height): Promise<void>
loadUrl(playerId, url): Promise<void>
pause(playerId): Promise<void>
resume(playerId): Promise<void>
seek(playerId, position): Promise<void>
setVolume(playerId, volume): Promise<void>
resize(playerId, x, y, width, height): Promise<void>
destroy(playerId): Promise<void>
getProperties(playerId): Promise<PlayerProperties>
getTracks(playerId): Promise<TrackInfo[]>
setAudioTrack(playerId, trackId): Promise<void>
setSubTrack(playerId, trackId): Promise<void>
```

Internally, the adapter detects the platform once at module load time and maps each method to the correct Tauri command name (Rust commands on Windows, Kotlin plugin commands on Android).

`PlayerScreen.tsx` replaces all direct `invoke('mpv_*', ...)` calls with the adapter. The `isWindows()` check in the startup effect is replaced by `nativePlayer.isAvailable()`.

### B3. Android MPV routing in PlayerScreen

Replace the `if (!win) { setPlayerMode('html5'); return }` guard with:

```typescript
const nativeAvailable = await nativePlayer.isAvailable()
if (!nativeAvailable) {
  setPlayerMode('html5')
  return
}
```

This routes Android to native MPV via the adapter when the plugin is present, and keeps HTML5 as the fallback if it isn't.

### B4. Extend Android Kotlin plugin command surface

The Android plugin must expose the same command surface as the Windows Rust implementation to be usable through the adapter:

- `playerGetProperties` returning `{ duration, position, paused, volume, idle }`
- `mpvGetTracks` returning track list
- `mpvSetAudioTrack`
- `mpvSetSubTrack`

The `idle` property is required for stream-failure detection (the 10-consecutive-idle-poll logic in `PlayerScreen`).

---

## Phase B Test Plan

**Android — native MPV path:**
- Native MPV is used for VOD, not HTML5.
- MPV surface is visible through the transparent WebView.
- `mp4`, `mkv`, `avi`, `ts` VOD assets play with audio and video.
- Pause, seek, volume, resize/orientation change, and destroy lifecycle all work cleanly.
- Audio and subtitle track menus appear and function.
- Stream error badge appears after 10 idle polls on a bad URL.

**Failure paths:**
- If `mpv_create` (or Android equivalent) throws, `playerMode` falls back to `html5` and the error badge is shown.
- If the Kotlin plugin is not registered, `nativePlayer.isAvailable()` returns false and HTML5 is used silently.

---

## Out of Scope

- **MultiviewScreen:** Currently uses HTML5 video for all panels on all platforms. Native MPV for multiview is a separate concern and is not addressed here. If the decision is to keep multiview on HTML5 permanently (reasonable given multi-panel layout complexity), document that explicitly.
- **Playlist persistence:** In-memory only, resets on restart — pre-existing limitation, not touched here.
- **EPG grid view, watch history, subtitle/audio selection in HTML5 path:** Pre-existing gaps, not in scope.

---

## Assumptions

- Xtream `container_extension` field name should be verified against a real provider before the Rust deserialise struct is finalised.
- "All formats" means MPV handles container diversity; HTML5 is not expected to decode every container.
- The existing TypeScript error in `src/utils/genreMap.ts` should be cleared before validating Phase A frontend changes.
- The Rust build was previously blocked by locked files in `src-tauri/target/`; rerun `cargo check` in a clean state after Phase A implementation.
