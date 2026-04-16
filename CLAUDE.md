# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Singularity

IPTV/VOD streaming player app targeting Android phone/tablet and Windows Desktop from a single Tauri 2.0 codebase. UI inspired by Nyx Player / Stremio. App name: **Singularity**.

Logo source: `icon-source.png` in root.

## Build Commands

```bash
npm install                  # Install JS dependencies
npm run dev                  # Vite dev server (frontend only, port 5173)
npm run tauri dev            # Full Tauri dev with Rust (Windows)
npm run tauri android dev    # Android dev (requires device/emulator + Android SDK)
npm run tauri build          # Windows release (.exe / .msi)
npm run tauri android build  # Android release (.apk / .aab)
cargo build                  # Rust backend only (run from src-tauri/)
cargo check                  # Fast type-check Rust (run from src-tauri/)
cargo audit                  # Security audit Rust deps (run from src-tauri/)
```

Note: `cargo` must be on PATH. If not: add `C:\Users\<user>\.cargo\bin` to PATH.

Android requires: Android Studio + NDK + `rustup target add aarch64-linux-android x86_64-linux-android`

## Architecture

### Stack
- **Tauri 2.0** — app shell (Android + Windows from one codebase)
- **React 18 + TypeScript** — frontend UI (100% shared across platforms)
- **Zustand** — MVI state management (Intent → State → View)
- **Rust** — all I/O: playlist parsing, EPG, network, credentials
- **Video (Android)** — Kotlin `MpvSurfaceView` Tauri plugin
- **Video (Windows)** — `libmpv-sys` + child HWND

### Directory Structure

```
src/                        ← React frontend (100% shared)
  types/index.ts            ← All shared TypeScript types
  store/slices/             ← Zustand MVI stores
    playlistSlice.ts        ← Playlists, channels, VOD, series state + intents
    epgSlice.ts             ← EPG programs and sources
    playerSlice.ts          ← Player and multiview state
    uiSlice.ts              ← Sidebar, favorites, search
  components/
    layout/                 ← MainLayout (shell), Sidebar (nav)
    common/                 ← PosterCard, HeroBanner, HorizontalRow
  screens/                  ← One file per route
src-tauri/                  ← Rust backend
  src/
    lib.rs                  ← Entry point, all command registrations, app setup
    commands/               ← Tauri command handlers (thin wrappers)
      playlist.rs           ← add/fetch playlists
      epg.rs                ← EPG sources and program fetching
      credentials.rs        ← OS keychain (Windows) / no-op (Android)
      favorites.rs          ← In-memory favorites store
      player.rs             ← Player property stubs (Windows MPV bridge TBD)
    playlist/               ← Playlist parsers and API clients
      types.rs              ← Rust types (Channel, VodItem, Series, etc.)
      m3u.rs                ← IPTV M3U parser (tvg-id, tvg-logo, group-title)
      xtream.rs             ← Xtream Codes REST API client
      stalker.rs            ← Stalker Portal MAC auth client
    epg/
      mod.rs                ← EpgCache state
      xmltv.rs              ← XMLTV parser
```

### Data Flow (MVI)
1. **Intent** — async function in a Zustand store slice (e.g. `fetchChannels`)
2. **Rust command** — all I/O goes through `invoke()` → Tauri command → Rust
3. **State update** — Zustand `set()` after command resolves
4. **View** — React component reads from store, re-renders

### Tauri Commands Pattern
```rust
// In src-tauri/src/commands/something.rs
#[tauri::command]
pub async fn my_command(state: State<'_, MyStore>, arg: String) -> Result<Output, String> { ... }

// Register in src-tauri/src/lib.rs invoke_handler
```

```typescript
// In React
import { invoke } from '@tauri-apps/api/core'
const result = await invoke<Output>('my_command', { arg: 'value' })
```

### Playlist Support
- **Xtream Codes**: `src-tauri/src/playlist/xtream.rs` — REST API, fetches live/VOD/series
- **M3U/M3U8**: `src-tauri/src/playlist/m3u.rs` — line-by-line parser, URL or local file
- **Stalker Portal**: `src-tauri/src/playlist/stalker.rs` — MAC auth, `X-User-Agent: Model: MAG250`

### Routing
React Router v6. All main screens under `MainLayout` (sidebar + content). Player and Multiview are fullscreen routes (no sidebar).

### CSS approach
No CSS framework. Each component has a colocated `.css` file. Global design tokens in `src/styles/globals.css`. Dark navy/purple theme.

## Key Implementation Notes

### MPV Integration
- **Android**: Kotlin `MpvSurfaceView` sits below the Tauri WebView (WebView background transparent). Plugin registered in `MainActivity.kt`. Prebuilt `libmpv.so` in `jniLibs/arm64-v8a/`.
- **Windows**: `libmpv-sys` Rust crate + child HWND created under Tauri window. `mpv-1.dll` bundled in resources.

### Credential Storage
- Windows: `keyring` crate → Windows Credential Manager (`src-tauri/src/commands/credentials.rs`)
- Android: Kotlin `CredentialPlugin` using `EncryptedSharedPreferences` (to be added in Android Kotlin plugin phase)
- Fallback: if keychain causes issues, store in local JSON file in Tauri app data dir

### Multiview Auto-reconnect on stall or stream end
`MultiviewScreen.tsx` — Each panel monitors for stalls (waiting / stalled / error events); after 10 seconds of no progress the stream reconnects automatically
- When a stream ends, the panel reconnects to the same channel after 3 seconds — no daisy-chaining to the next channel
- A "Reconnecting…" badge with a spinner appears in the top-right corner while a reconnect is in progress.

### Platform Detection
```typescript
import { platform } from '@tauri-apps/plugin-os'
const isAndroid = (await platform()) === 'android'
```

## What's Not Yet Implemented
## - Playlist persistence (currently in-memory only — resets on restart)
- EPG grid view (channel × time slot layout)

