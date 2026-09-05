# Singularity Features

## Cross-Platform Streaming
Stream IPTV and VOD content seamlessly on **Android** and **Windows Desktop** from a unified codebase. Built with **Tauri 2.0** for native performance on both platforms.

## Playlist Support
Add your favorite streams through multiple formats:
- **Xtream Codes** — Full REST API support for live channels, VOD, and series
- **M3U / M3U8** — Parse local or remote playlist files with TVG metadata
- **Stalker Portal** — MAC authentication compatible with legacy IPTV platforms

## Native Video Playback
- **Android** — Native MPV player via custom Kotlin plugin (Phase 3)
- **Windows** — Native MPV video bridge with dedicated graphics pipeline
- **Fallback** — HTML5 video player for supported formats (MP4, HLS)

## Live TV Features
- **Favorites** — Star your favorite channels for quick access
- **Auto-Reconnect** — Streams automatically reconnect on interruption (10-second stall detection)
- **Multiview** — Watch up to 4 channels simultaneously with independent stream management
- **HLS Proxy** — URL rewriting, header forwarding, and codec optimization for streaming stability

## VOD & Series
- **VOD Catalog** — Browse movies and individual episodes
- **Series Management** — Episode grouping, series metadata, and playback tracking
- **Detail Pages** — Nyx-style UI with TMDB integration for similar content recommendations
- **Resume Positions** — Continue watching where you left off

## EPG Guide 
- Electronic Program Guide for upcoming content
- Channel × time-slot grid layout

## Security
- **Secure Credential Storage** — Windows Credential Manager integration
- **Encrypted Preferences** — Android EncryptedSharedPreferences support
- **HTTP/HTTPS Warnings** — Alert users to insecure connection risks

## In-App Updates
- Automatic APK download and installation for Android
- Version management with GitHub release integration

## Modern UI
- Stremio-inspired design
- Responsive layout for phone and tablet
- Smooth navigation and transitions

## Performance
- Rust backend for fast I/O and playlist parsing
- Zustand state management with MVI (Model-View-Intent) architecture
- Vite + React 18 frontend for instant feedback
- Optimized bundle size and startup time

## v0.6.3 Multiview Audio Controls
- **Per-panel volume** — Each Multiview panel now has an independent volume slider and mute state.
- **Windows boost** — Windows desktop panels support volume from 0% through 300% using the Live TV gain and limiter path.

## v0.6.2 Interactive Help Center
- **Guided setup** â€” A new Help destination provides step-by-step Xtream, M3U, playlist removal, and XMLTV EPG guidance with safe example values.
- **First-run assistance** â€” When no playlists are active, the Xtream setup guide opens directly on the Login screen and highlights the required fields.
- **App navigation guides** â€” Interactive tours cover Home, Live TV, Movies, Series, Multiview, the EPG Guide, and player language, subtitle, and technical-stat controls.
- **Safe by design** â€” Guides can navigate to the relevant screen and select a setup type, but never read, enter, submit, or remove user data.

## v0.6.1 Player Updates
- **Desktop volume boost** — Live TV and native MPV playback now support boosted volume up to 300%.
- **Limiter for Live TV boost** — Live TV uses a Web Audio compressor after gain to reduce harsh clipping at high boost levels.
- **Auto-hiding Live TV controls** — Seekbar and playback controls now hide after inactivity and reappear on pointer, touch, or keyboard input.
- **Android fullscreen fix** — The Android MPV plugin now exposes a native fullscreen command that hides system bars in immersive mode.

## 🔄 Data Persistence
- Favorites saved locally
- EPG source persistence
- Stream position tracking for resume functionality

---

**Current Version:** 0.6.3
**Platforms:** Android 7.0+, Windows 10+  
**Built with:** Tauri 2.0 | React 18 | Rust | TypeScript
