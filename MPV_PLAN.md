# Plan: Splash Copy, Android MPV Migration, and Resume Playback

## Summary
1. Change the splash eyebrow text from `Now Entering the` to `Now Entering` in [MainLayout.tsx](src/components/layout/MainLayout.tsx).
2. Replace the active Android libVLC bridge with an MPV-backed native path, vendoring prebuilt `libmpv` binaries from the upstream `mpv-android` release APK and using the existing [MpvPlugin.kt](src-tauri/android-plugin/MpvPlugin.kt) as the starting point.
3. Add resume playback for all on-demand media, prompt-based, persisted locally per device, keyed by stable content identity rather than raw stream URL.

## Non-goals
- No continue-watching shelf in this phase (resume state is forward-compatible for one later).
- No cloud sync — resume data is local per device/app install.
- No live-TV resume — live HLS/mpegts stays on the existing HTML5 path, untouched.
- No Windows player changes — the Windows `mpv_*` Rust command surface is frozen.
- No custom libmpv/FFmpeg build in this phase — only prebuilt binaries (custom build is the documented fallback).

---

## Section 1 — Splash copy

**File:** [MainLayout.tsx:91](src/components/layout/MainLayout.tsx#L91)

Change the single line:
```jsx
<span className="splash-eyebrow">Now Entering the</span>
```
to:
```jsx
<span className="splash-eyebrow">Now Entering</span>
```

**Acceptance:** splash renders `Now Entering` above `SINGULARITY DEUX`, and the existing fade/dismiss behavior (0ms min on Android, 12s on desktop) is unchanged on both platforms.

---

## Section 2 — Android MPV migration (Option 1: vendor upstream `mpv-android` binaries)

### 2.1 Source the binaries
- Download the latest stable release APK from `github.com/mpv-android/mpv-android/releases`.
- Record the exact release tag in a new file `src-tauri/gen/android/app/src/main/jniLibs/MPV_ANDROID_VERSION.txt` so future bumps are auditable.
- Extract native libraries from the APK:
  - `lib/arm64-v8a/*.so` → [src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/](src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/)
  - `lib/x86_64/*.so` → [src-tauri/gen/android/app/src/main/jniLibs/x86_64/](src-tauri/gen/android/app/src/main/jniLibs/x86_64/) (emulator support)
  - Expect: `libmpv.so`, `libplayer.so`, FFmpeg family (`libavcodec.so`, `libavformat.so`, `libavutil.so`, `libswscale.so`, `libswresample.so`, `libavfilter.so`), `libass.so`.
- Vendor the upstream `MPVLib.java` (package `is.xyz.mpv`) from `mpv-android/app/src/main/java/is/xyz/mpv/MPVLib.java` into `src-tauri/android-plugin/MPVLib.java`, preserving the package path so [MpvPlugin.kt](src-tauri/android-plugin/MpvPlugin.kt) imports resolve unchanged.
- Confirm GPLv2+/LGPL license compatibility and add a `THIRDPARTY_NOTICES.md` entry for mpv, FFmpeg, and libass.

### 2.2 Wire the plugin
- Register `MpvPlugin` in [android_plugins.rs](src-tauri/src/android_plugins.rs) alongside `VlcPlugin` (keep both during migration; flip frontend first, remove VLC after smoke tests pass).
- In [build.gradle.kts](src-tauri/gen/android/app/build.gradle.kts):
  - Remove `implementation("org.videolan.android:libvlc-all:3.6.0")`.
  - Add `packagingOptions { jniLibs { useLegacyPackaging = true } }` if needed so vendored `.so` files are not stripped/compressed.

### 2.3 Achieve command parity with Windows [player.rs](src-tauri/src/commands/player.rs)
Extend [MpvPlugin.kt](src-tauri/android-plugin/MpvPlugin.kt) so it exposes every command the existing Windows surface does. Current plugin has: `mpvCreate`, `mpvLoadUrl`, `mpvPause`, `mpvResume`, `mpvSetVolume`, `mpvSeek`, `mpvResize`, `playerGetProperties`, `mpvDestroy`. **Add:**
- `mpvGetTracks` — enumerate audio/subtitle tracks via `MPVLib.getPropertyString("track-list")`.
- `mpvSetAudioTrack` — `MPVLib.setPropertyInt("aid", id)`.
- `mpvSetSubTrack` — `MPVLib.setPropertyInt("sid", id)`.
- `mpvSetSubScale` — `MPVLib.setPropertyDouble("sub-scale", scale)`.

### 2.4 Frontend routing
- In [PlayerScreen.tsx](src/screens/PlayerScreen.tsx), introduce a single constant at top of the file:
  ```ts
  const ANDROID_PLAYER_PLUGIN = 'mpv'  // was 'vlc'
  ```
  and replace all `plugin:vlc|...` literals with `` `plugin:${ANDROID_PLAYER_PLUGIN}|...` ``. Windows `mpv_*` calls stay exactly as they are.
- Keep the WebView transparent (already configured for VLC path); the MPV `SurfaceView` sits in the same view-hierarchy slot as the current VLC `SurfaceView`.
- Keep live HLS and MPEG-TS on the existing HTML5 path; route only on-demand media (VOD + series episodes) through native MPV.

### 2.5 Go / no-go gates (required before removing `VlcPlugin`)
All must pass on at least one Android phone and one Android TV / tablet:
- H.264 MP4 (baseline sanity)
- HEVC/H.265 MKV
- AVI container
- MPEG-TS VOD file
- DTS audio track plays without silence/static
- TrueHD audio track plays without silence/static
- Embedded subtitle track (SRT/PGS) renders and toggles
- Alternate audio track switches without restart
- Large forward seek (>30min) completes within 3s

If any gate fails after 1-2 days of investigation, **pivot to Option 2 (build libmpv/FFmpeg from source with custom flags)** — do not attempt to repair libVLC.

### 2.6 Cleanup (only after 2.5 passes)
- Delete `src-tauri/android-plugin/VlcPlugin.kt`.
- Remove `VlcPlugin` registration from [android_plugins.rs](src-tauri/src/android_plugins.rs).
- Drop the `ANDROID_PLAYER_PLUGIN` fallback branch if any; keep the constant for readability.

---

## Section 3 — Resume playback

### 3.1 Type extension
In [types/index.ts](src/types/index.ts), extend `PlayerState`:
```ts
export interface PlayerState {
  url: string
  title: string
  live?: boolean
  channelId?: string
  playlistId?: string
  returnTo?: string
  resumeKey?: string   // new — populated for on-demand only
}
```

### 3.2 Key format (stable, URL-independent)
- VOD: `playlist:{playlistId}:vod:{vodId}`
- Series episode: `playlist:{playlistId}:series:{seriesId}:episode:{episodeId}`
- If Xtream `episode_id` proves unstable across catalog refreshes (verify in [xtream.rs](src-tauri/src/playlist/xtream.rs)), fall back to `playlist:{playlistId}:series:{seriesId}:s{season}e{episode_num}`.
- URL fallback `url:{stream_url}` only when no stable IDs are available.
- Never set `resumeKey` when `live === true`.

### 3.3 Rust persistence (mirror [favorites.rs](src-tauri/src/commands/favorites.rs) exactly)
Create `src-tauri/src/commands/resume.rs`:
```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ResumeEntry {
    pub key: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub title: String,
    pub poster_url: Option<String>,
    pub stream_url: String,   // survives Xtream token rotation on re-launch
    pub updated_at: i64,      // unix seconds
}

pub struct ResumeStore(pub Mutex<HashMap<String, ResumeEntry>>);
```
- Commands: `get_resume_position(key) -> Option<ResumeEntry>`, `save_resume_position(entry) -> ()`, `clear_resume_position(key) -> ()`, `list_resume_entries() -> Vec<ResumeEntry>` (for forward-compat; unused in UI this phase).
- Persistence: `persist::save(&app, "resume.json", &*map)` / `persist::load(&app, "resume.json")` from [persist.rs](src-tauri/src/persist.rs).
- Missing file → empty map, never error.
- Register store + commands in [lib.rs](src-tauri/src/lib.rs).

### 3.4 Wire `resumeKey` at every on-demand navigation entrypoint
- [VodScreen.tsx:360](src/screens/VodScreen.tsx#L360) — VOD launch: `resumeKey: \`playlist:${playlistId}:vod:${vodId}\``
- [SeriesScreen.tsx:196](src/screens/SeriesScreen.tsx#L196) — Episode launch: `resumeKey: \`playlist:${playlistId}:series:${seriesId}:episode:${episodeId}\``
- [EpgScreen.tsx:415](src/screens/EpgScreen.tsx#L415) — live; **do not** set `resumeKey`.
- Grep `navigate('/player'` and any `<Link to="/player"` across [src/](src/) to catch hero/banner and generic poster-card callers; wire each one.

### 3.5 Player-side behavior ([PlayerScreen.tsx](src/screens/PlayerScreen.tsx))
**On mount (before `mpv_load_url` / `plugin:mpv|mpv_load_url`):**
- If `resumeKey` is set and `get_resume_position(resumeKey)` returns an entry with `position_sec > 30`, show a blocking modal overlay with two buttons: `Resume at MM:SS` / `Start Over`.
  - `Resume`: load URL, seek to `position_sec` after first `duration` property event.
  - `Start Over`: call `clear_resume_position(resumeKey)`, load URL from 0.
- If no entry or `position_sec <= 30`, load from 0 with no modal.

**During playback (only when `resumeKey` is set):**
- Throttled save: every 5s of media playback **or** every 30s of wall-clock, whichever is less frequent.
- Flush on: `pause`, `beforeunload`, `visibilitychange` (WebView background), back button, explicit destroy.

**Auto-clear on near-complete:**
- Clear when `position_sec >= 0.9 * duration_sec AND (duration_sec - position_sec) < 120`, **or** when `(duration_sec - position_sec) < 30` — whichever triggers first. This handles both feature-length (>90min) and short-episode (<10min) cases without the original 60s floor being too aggressive.

### 3.6 Acceptance tests
- Prompt appears for saved on-demand content; `Resume` seeks correctly; `Start Over` clears the saved position.
- Progress survives app restart (verify `resume.json` on disk).
- Near-complete playback removes the entry.
- Different episodes in the same series do not overwrite each other.
- Switching playlists does not collide resume state (distinct `playlistId` prefix).
- Live TV shows no prompt and writes no entry.

---

## Execution strategy

**Branch:** `feature/android-mpv-migration` off `main`.

**Commit cadence — one phase per commit** so `git bisect` isolates codec regressions:
1. `feat(splash): shorten eyebrow copy to "Now Entering"` — Section 1 only.
2. `chore(android): vendor mpv-android prebuilt .so files + MPVLib.java` — Section 2.1 only (binaries + license notices, no code changes).
3. `feat(android): register MpvPlugin and expand command parity with Windows` — Section 2.2–2.3.
4. `feat(player): route Android on-demand through MPV plugin` — Section 2.4 (frontend flip; VLC still registered).
5. `chore(android): remove VlcPlugin after MPV codec matrix passes` — Section 2.6, contingent on 2.5 gates.
6. `feat(resume): add Rust-backed resume store and commands` — Section 3.1, 3.3.
7. `feat(resume): wire resumeKey at navigation entrypoints` — Section 3.2, 3.4.
8. `feat(resume): prompt, throttled save, auto-clear in PlayerScreen` — Section 3.5.

**Verification commands:**
- Windows: `npm run tauri dev` — confirm zero behavior change.
- Android dev: `npm run tauri android dev` on a connected device for each codec-matrix gate in 2.5.
- Rust: `cargo check` and `cargo build` from [src-tauri/](src-tauri/) after each commit that touches Rust.
- Resume smoke: play a VOD for 2 min, force-kill the app, relaunch, verify prompt appears with correct position.

**Rollback:** Steps 2–5 can be reverted individually thanks to phase-per-commit. If 2.5 gates fail irrecoverably, revert 4 (frontend flip) — VLC remains registered and functional throughout steps 2–4.
