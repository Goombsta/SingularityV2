# Singularity — Lessons Learned

Running log of what worked, what didn't, and why. Updated as the project evolves.

---

## ✅ What Worked

### Tauri 2.0 + React/TypeScript scaffold
- `npm create tauri-app@latest` with `react-ts` template worked first-try on Windows.
- Single codebase for Android + Windows via Tauri 2.0 is viable and the build targets share 100% of the React UI.

### Zustand MVI stores
- Splitting state into `playlistSlice`, `uiSlice`, `epgSlice`, `playerSlice` kept concerns clean.
- `Intent → State → View` pattern maps naturally to `create<State & Intents>()` in Zustand.
- Async intents (e.g. `fetchVod`) call `invoke()` then `set()` — straightforward and testable.

### Rust reqwest with `rustls-tls`
- Using `rustls-tls` instead of `native-tls` was required for Android cross-compilation. `native-tls` links against OpenSSL which doesn't cross-compile cleanly to Android targets.
- `default-features = false` + `features = ["json", "rustls-tls"]` is the correct combo.

### M3U + Xtream Codes parsers
- Line-by-line M3U parser using `BufReader` + regex for `#EXTINF` attributes worked well for all tested IPTV sources.
- Xtream Codes REST API (`/player_api.php?action=get_live_streams` etc.) was straightforward once the correct URL format was established.
- Series info (`get_series_info`) required a separate second call — `fetch_series` only returns the series list, not seasons/episodes.

### JSON persistence via app_data_dir
- `tauri::Manager::path().app_data_dir()` gives a reliable, platform-correct path for persisting playlists/favorites/EPG sources.
- `serde_json::from_str` with `unwrap_or_default()` handles first-run (no file) and corrupt files gracefully.
- Loading in the `.setup()` hook before the window opens means data is ready before any UI renders.

### React Router `location.state` for cross-screen pre-selection
- Navigating to `/vod` with `{ state: { preSelectedId: "..." } }` then reading it in a `useEffect` is clean.
- Avoids global state pollution — the pre-selection is ephemeral and scoped to the navigation event.
- Pattern works for Home → VOD detail and Home → Series detail.

### Frosted-glass pill sidebar
- `backdrop-filter: blur(24px)` + `background: rgba(20,14,36,0.72)` + `border-radius: 24px` gives the frosted pill effect.
- Must also set `-webkit-backdrop-filter` for WebKit compatibility.
- `border: 1px solid rgba(124,58,237,0.18)` adds subtle purple glow to the edge.

### PlaylistPicker component
- Returning `null` when there's only 1 playlist keeps the UI clean for single-playlist users.
- Dropdown triggers `setActivePlaylist` in the store which cascades to re-fetching channels/VOD/series.

### OMDb API integration
- Free tier (1,000 req/day) is sufficient for on-demand movie metadata lookups.
- Storing API key in `localStorage` (not Rust keychain) for frontend-only reads is simpler and acceptable for a non-sensitive API key.
- Graceful fallback: if OMDb fails or no key is set, the app displays whatever metadata came from the playlist (plot, rating, poster).
- `urlencoding::encode()` on the title handles names with special characters.

### HorizontalRow carousel layout
- Horizontal scrolling rows grouped by genre (Netflix-style) work much better than flat grids for large catalogs.
- Sorting by year descending (newest first) within each genre row keeps content fresh-looking.

### Rules of Hooks compliance
- All `useMemo`/`useEffect` calls must come before any early `return` — React enforces this strictly.
- Bug: `heroItems` was a plain array (not `useMemo`) defined after an early `return`. Fixed by moving all hooks above the conditional return.

---

## ❌ What Didn't Work / Pain Points

### LNK1181: cannot open input file 'mpv.lib'
- **Problem**: `libmpv-sys` build script emits `cargo:rustc-link-lib=mpv` but no search path. The linker can't find `mpv.lib` on Windows.
- **Root cause**: `libmpv-sys` expects `mpv.lib` to already be on `LIB` path or discoverable via `LIBMPV_LIB_DIR` env var.
- **Fix**:
  1. Source `libmpv-2.dll` from Stremio install (`AppData\Local\Programs\Stremio\libmpv-2.dll`) — already on machine.
  2. Generate `mpv.lib` import library using MSVC tools: `dumpbin /exports libmpv-2.dll > mpv.def` then `lib /def:mpv.def /out:mpv.lib /machine:x64`.
  3. Copy `mpv.lib` into `src-tauri/resources/`.
  4. Add `println!("cargo:rustc-link-search=native=<resources path>")` in `build.rs`.
  5. Set `LIBMPV_LIB_DIR` in `.cargo/config.toml`.
- **Lesson**: Any crate that links a native DLL needs both the `.lib` import library (for the linker) and the `.dll` (for runtime). Document where to get both.

### `libmpv-sys` MPV_FORMAT_* constant names
- **Problem**: Constants are `libmpv_sys::mpv_format_MPV_FORMAT_FLAG` (snake_case prefix + SCREAMING name), not `MPV_FORMAT_FLAG`.
- **Fix**: Always prefix with `mpv_format_` in Rust code.

### `DefWindowProcW` as fn pointer
- **Problem**: `windows` crate's `DefWindowProcW` is a generic function and can't be coerced to `WNDPROC` (fn pointer) directly.
- **Fix**: Wrap it in a concrete `unsafe extern "system" fn wnd_proc(...)` that calls `DefWindowProcW` inside.

### `Win32_Graphics_Gdi` feature missing
- **Problem**: `WNDCLASSW` struct (and `RegisterClassW`) requires the `Win32_Graphics_Gdi` feature in the `windows` crate.
- **Fix**: Added `"Win32_Graphics_Gdi"` to the feature list in `Cargo.toml`.

### Chocolatey (no admin rights)
- **Problem**: Tried to install mpv via `choco install mpv` — failed with "Access denied" because no admin privileges in the shell.
- **Fix**: Found `libmpv-2.dll` already present in Stremio's install directory. No package manager needed.

### `app.state()` — missing `use tauri::Manager`
- **Problem**: `app.state::<PlaylistStore>()` call failed to compile with "method not found" even though `tauri::Manager` exists.
- **Fix**: Add `use tauri::Manager;` import in `lib.rs`.

### `mpv_command` mutability
- **Problem**: `mpv_sys::mpv_command` requires a `*mut *const i8`, not `*const *const i8`.
- **Fix**: Use `.as_mut_ptr()` instead of `.as_ptr()` on the args Vec.

### React `Rendered more hooks than during the previous render`
- **Problem**: `useMemo` calls for `heroItems`, `moviesByGenre`, `seriesByGenre` were placed after an early `return` in `HomeScreen`.
- **Fix**: Move all hooks above the conditional early return. React hooks must always be called in the same order, regardless of conditions.

### Port 5173 already in use on restart
- **Problem**: Tauri dev server crashed (or was killed) leaving the Vite process still bound to port 5173. Next `npm run dev` fails.
- **Fix**: `taskkill /IM node.exe /F` in a Command Prompt to kill all Node processes. Or just use a different port via `vite.config.ts`.

### Category pill sidebar in VOD/Series (removed)
- **Problem**: Vertical category pill sidebar took up horizontal space and added navigation friction — user had to use two separate controls (sidebar + search).
- **Fix**: Removed entirely. Replaced with Netflix-style genre rows. Playlist picker moved inline next to the screen title. Search remains as the primary filter.

---

## 🔮 Known Limitations / Future Work

| Area | Issue | Planned fix |
|------|-------|-------------|
| Video | HTML5 `<video>` used as fallback; many IPTV streams (TS/HLS) need MPV | Phase 3/4: Kotlin MpvPlugin (Android) + libmpv HWND bridge (Windows) |
| OMDb | 1,000 req/day free tier; no caching | Cache responses in Tauri app_data_dir keyed by IMDb ID |
| EPG | XMLTV parsed but no visual grid view | EPG grid (channel × time slot) is planned |
| Android | `tauri android init` not yet run — requires Android Studio + NDK | Documented in INSTALL.md; run after SDK setup |
| Subtitles | No subtitle/audio track selection in player | Add track menu to PlayerScreen controls |
| Search | Searches only loaded content (no cross-playlist) | Extend SearchScreen to aggregate across playlists |
| IMDb deep link | OMDb returns `imdbID` but we don't open it | Add "View on IMDb" button using `tauri-plugin-shell` `open()` |
| Multiview | Auto-reconnect on stall works; no EPG overlay per cell | Add mini EPG badge to each cell |
| Persistence | Playlists persist; watch history / continue watching not tracked | Add watch position store |
