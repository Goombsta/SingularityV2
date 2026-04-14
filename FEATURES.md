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

## 🔄 Data Persistence
- Favorites saved locally
- EPG source persistence
- Stream position tracking for resume functionality

---

**Current Version:** 0.4.3  
**Platforms:** Android 7.0+, Windows 10+  
**Built with:** Tauri 2.0 | React 18 | Rust | TypeScript
