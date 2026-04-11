# Lessons Learned — Singularity Development

_Last updated: 2026-04-10_

---

## Feature 1: EPG Guide — Purple Theme

### Goal
Change the EPG grid from a blue accent to purple to match the app's dark navy/purple design language.

### What Worked
- Targeted only the dynamic/interactive color values in `EpgScreen.css`: hover state, "now" program highlight, selected block border, and progress bar fill.
- Replaced `rgba(26, 159, 255, …)` (blue) with `rgba(139, 92, 246, …)` (purple) and `#8b5cf6` for solid borders.
- Static structural colors (borders, backgrounds, text) were left untouched — only accent-driven colors changed.
- One-file change, no cascading breakage.

### What Did Not Work / Watch Out For
- The `--accent` CSS variable is used in some EPG elements (e.g. `.epg-now-line-header`, `.epg-preview-progress-fill`, `.epg-cat-item .cat-dot`). These were **not** changed here because `--accent` is a global token. If the intent is a full purple theme, `--accent` itself should be updated in `src/styles/globals.css` — changing it per-component with hardcoded values creates inconsistency.

---

## Feature 2: Tech Stats Panel (Player)

### Goal
Add a floating "Tech Stats" overlay to the player (matching the reference image) showing video, audio, and network diagnostics. No DNS row needed.

### Architecture Decision
Split into three layers:
1. **Rust command** (`player_get_tech_stats`) — reads MPV properties directly
2. **React state + polling effect** — polls every 1.5s when panel is open
3. **UI overlay** — fixed-position panel, top-right, color-coded values

---

### 2a. Rust Command — `player_get_tech_stats`

#### What Worked
- Reused all existing helper functions (`mpv_get_i64`, `mpv_get_f64`, `mpv_get_str`) — no new FFI boilerplate needed.
- `TechStats` struct defined in the outer module (alongside `PlayerProperties`, `TrackInfo`) and imported into `windows_impl` via `use super::TechStats`.
- MPV property names used:
  - `width` / `height` — video resolution
  - `video-codec` — codec string
  - `estimated-vf-fps` — displayed FPS (post-filter, more accurate than `fps`)
  - `video-bitrate` — raw bitrate in bps
  - `video-params/pixelformat` — pixel format string (e.g. `d3d11`, `yuv420p`)
  - `hwdec-current` — active hwdec decoder name (e.g. `d3d11va`, `none`)
  - `audio-codec-name` — short codec name (e.g. `aac`, `ac3`)
  - `audio-bitrate` — raw bitrate in bps
  - `audio-params/channel-count` — integer channel count
  - `demuxer-cache-duration` — forward buffer in seconds
  - `vo-delayed-frame-count` — dropped/delayed frames counter
- Registered under `#[cfg(not(target_os = "android"))]` in `lib.rs` — consistent with all other MPV commands.
- Returns zeroed/empty struct gracefully when no player_id matches (panel opens before stream is ready).

#### Failure — Scope Error (compile error)
- **Problem:** `TechStats` was placed in the outer module but the command function lives inside `windows_impl`. Rust couldn't find it.
- **Fix:** Added `TechStats` to the existing `use super::{…}` import line in `windows_impl`.
- **Lesson:** Any new public struct added to the outer module that is used inside `windows_impl` must be explicitly imported via `use super::`.

---

### 2b. React Polling Effect

#### What Worked
- Polling only starts when `showTechStats === true` — no wasted invocations when panel is closed.
- Dual-path: MPV path calls `player_get_tech_stats`; HTML5 fallback reads `videoRef.current` properties directly (no Rust needed).
- HTML5 fallback uses `getVideoPlaybackQuality()` for dropped frame count and `video.buffered` for buffer duration.
- `cancelled` flag in the effect cleanup prevents stale state updates after unmount.

#### Watch Out For
- `player_get_tech_stats` is `#[cfg(not(target_os = "android"))]` — on Android the invoke will fail. The `try/catch` in the poll function silently ignores failures, so the panel will show `—` for all values on Android rather than crashing. This is acceptable for now but should be revisited when the Android MPV Kotlin plugin is implemented.
- `video-bitrate` and `audio-bitrate` from MPV return 0 for many IPTV streams (container doesn't carry bitrate metadata). This is expected — displayed as `N/A`.

---

### 2c. Tech Stats UI Panel

#### What Worked
- Panel positioned `position: absolute; top: 70px; right: 20px` — sits below the top bar, clear of controls.
- Color coding matches the reference image:
  - Orange (`#f97316`) — resolution, audio bitrate (informational highlights)
  - Green (`#22c55e`) — hw decode active, dropped frames = 0
  - Red (`#ef4444`) — buffer < 2s, dropped frames > 0
  - Default white/muted — codec, fps, channels, pixel format
- Section labels (`VIDEO`, `AUDIO`, `NETWORK`) in purple (`#8b5cf6`) matching app theme.
- `backdrop-filter: blur(18px)` keeps it readable over video content.
- Panel is excluded from the click-to-play overlay's click zone via `e.stopPropagation()`.

#### Watch Out For
- The panel stays visible when controls auto-hide (it has its own close button + the seekbar icon toggle). This is intentional — useful for monitoring stats without keeping controls on screen.
- `vo-delayed-frame-count` resets when a new file loads. For live streams this counter reflects session-level drops only.

---

## Feature 3: Tech Stats Seekbar Icon Button

### Goal
Add an icon button to the player seekbar/controls area to toggle the Tech Stats panel.

### What Worked
- Used an SVG activity/waveform icon (`polyline points="22 12 18 12 15 21 9 3 6 12 2 12"`) — matches the diagnostic/signal theme without needing an icon library.
- Button placed in `controls-right`, left of the existing tracks button — consistent with control grouping.
- Active state highlights the icon in `var(--accent-light, #a78bfa)` (purple) matching the tracks button active style.
- `e.stopPropagation()` prevents the click-overlay from intercepting the toggle.

### What Did Not Work / Watch Out For
- None — straightforward addition. The only consideration: on mobile (Android touch), the controls-right area is small. If button crowding becomes an issue, the tech stats button could be moved to the top bar instead.

---

## General Lessons — This Session

| Area | Lesson |
|---|---|
| Rust module scoping | Structs in the outer `player.rs` module must be explicitly re-imported inside `windows_impl` with `use super::StructName` |
| MPV property names | `video-codec` gives the full codec string; `audio-codec-name` gives the short name (use the short one for display) |
| MPV bitrate properties | Often return 0 for IPTV streams — not a bug, just missing container metadata |
| CSS accent colors | Hardcoding purple per-component while `--accent` stays blue creates drift; ideally update the global token |
| React effect cleanup | Always set a `cancelled` flag before returning from a polling effect to guard against stale `setState` after unmount |
| Android guard | All MPV Tauri commands must be gated `#[cfg(not(target_os = "android"))]` both in implementation and registration |

---

## Session 2 — EPG Virtualization, Multiview Playback, Live TV Buffering

_Date: 2026-04-10_

---

## Feature 4: Live TV — HLS/mpegts Buffer Tuning

### Goal
Reduce buffering and rebuffering on IPTV HLS and MPEG-TS streams in `LiveTvScreen.tsx`.

### What Worked
- Increased `maxBufferLength` from 30s → 60s and `maxMaxBufferLength` from 60s → 120s. Larger forward buffer means more tolerance for network jitter before a stall occurs.
- Added `maxBufferHole: 0.5` to allow hls.js to skip small gaps rather than stalling.
- Added `startLevel: -1` (auto ABR) so hls.js picks the best quality level automatically instead of starting at the highest.
- Added `abrEwmaDefaultEstimate: 500000` (500kbps seed) to give the ABR estimator a conservative starting point, avoiding an initial high-quality overshoot on slow connections.
- Increased fragment/manifest/level load timeouts to 20s/10s/10s — IPTV servers are often slow to respond.
- Changed fatal HLS error handler: `NETWORK_ERROR` now calls `hls.startLoad()` (retry) instead of immediately falling back to mpegts. `MEDIA_ERROR` calls `hls.recoverMediaError()`. Only truly unrecoverable errors fall back to mpegts.
- Increased mpegts `stashInitialSize` from 512KB → 1MB — larger read-ahead buffer absorbs more network jitter.
- Increased mpegts `liveBufferLatencyMaxLatency` from 30s → 45s and `liveBufferLatencyMinRemain` from 8s → 10s.

### What Did Not Work / Watch Out For
- The original code had `new Hls()` with no config at all in the version the Explore agent returned, but the actual file already had a partial config (`maxBufferLength: 30`). Always read the actual file rather than relying on agent summaries.
- Do not set `lowLatencyMode: true` for IPTV — these streams are not true LL-HLS and the mode thins the buffer aggressively, causing more stalls.

---

## Feature 5: Multiview — Fix Playback (Stale Closure Bug)

### Goal
Make Multiview panels actually play streams after channel selection.

### Root Cause
`assignChannel` called `triggerReconnect(targetCell)` synchronously before `setCells` had committed. Inside the 2-second `setTimeout`, `triggerReconnect` read `cells[cellId].url` from a stale closure — the state hadn't updated yet, so `url` was still `null`. Nothing loaded.

### What Worked
- Introduced a `loadedUrls` ref (`useRef<string[]>(['', '', '', ''])`) to track which URL is currently loaded in each video element independently of React state.
- Added a `loadStream(cellId, url, video)` helper that handles HLS/mpegts/native detection and player instantiation imperatively.
- `assignChannel` now only: (1) resets `loadedUrls.current[cellId] = ''`, (2) calls `setCells`. No direct video manipulation.
- A `useEffect` on `cells` fires after React commits the DOM (so `<video>` is mounted for the first time on empty→has-URL transitions) and calls `loadStream` for any cell whose URL differs from `loadedUrls`.
- `triggerReconnect` reads from `loadedUrls.current` (always fresh, not from stale closure) and calls `loadStream` directly after the 3s delay.
- Applied same HLS/mpegts buffer config as LiveTV for consistency.

### What Did Not Work / Watch Out For
- **Attempt 1 (previous session):** Used `useEffect` with `v.play().catch(() => {})` driven purely by `cells` state and compared `v.src !== cell.url`. Failed because `v.src` is the resolved absolute URL, not the relative/original URL — the comparison always mismatched.
- **Attempt 2 (previous session):** Used `setTimeout(..., 50)` inside `assignChannel` to wait for DOM commit. Failed on first-time assignment (empty cell → has URL) because 50ms was not enough for React to mount the `<video>` element.
- **Key lesson:** Never read React state inside a `setTimeout` callback — use a ref to track the value you need.
- **Key lesson:** `v.src` (DOM property) is the absolute resolved URL; comparing it against a relative or stream URL will always fail. Use a separate tracking ref instead.

---

## Feature 6: EPG Guide — React.memo + gridProps Memoization

### Goal
Reduce re-renders of the EPG grid caused by the 30-second `nowLinePx` interval and user interactions.

### What Worked
- Wrapped `EpgGrid` in `React.memo` — bails out when props haven't changed.
- Memoized `timeSlots` with `useMemo([base])` — `base` never changes so this is computed once.
- Memoized `gridProps` with `useMemo` listing all dependencies — prevents new object identity on every render.
- Removed `channelColRef`, `timeHeaderRef`, and `onScroll` from props entirely (scroll sync moved inside `EpgGrid`).

### What Did Not Work / Watch Out For
- Memoization alone was insufficient. Even with `React.memo`, the grid still re-rendered because `gridProps` was a new object reference on every render (object literals are never referentially equal). Both `React.memo` AND `useMemo` on the props object are required together.
- `openPreview` must be `useCallback` with stable deps, otherwise it causes `gridProps` to be a new object on every render defeating the memoization.

---

## Feature 7: EPG Guide — Row Virtualization

### Goal
Fix severe lag when viewing EPG with 1000+ channels. The original implementation rendered every channel row in the DOM simultaneously.

### Root Cause
With 1000+ channels × ~10 program buttons each = 10,000+ DOM nodes. React rendering, layout, and paint all become extremely slow. `React.memo` and memoization do not help when the DOM itself is the bottleneck.

### What Worked
- Implemented custom row virtualization without any external library (no react-window/react-virtualized).
- Single scroll source (`epg-rows-scroll`) drives both axes. `scrollTop` state inside `EpgGrid` computes `visibleStart`/`visibleEnd` with a 3-row overscan buffer.
- Both channel column and program rows render only the visible slice, positioned with `position: absolute; top: absIndex * ROW_HEIGHT`.
- A full-height spacer div (`height: totalRows * ROW_HEIGHT`) maintains correct scrollbar geometry.
- `ResizeObserver` on the scroll container measures `containerHeight` for accurate `visibleEnd` calculation, including on fullscreen toggle and window resize.
- Time header syncs horizontally via a separate ref on the `epg-time-header-scroll` container — driven by the same `onScroll` handler.
- Removed separate `channelColRef` vertical sync — channel column is `overflow: hidden` and driven purely by the computed visible slice.
- Result: 1000+ channel playlist renders ~20 DOM rows regardless of total count. Scrolling is instant.

### What Did Not Work / Watch Out For
- **`v.src` comparison trap (also applies here):** The time header inner div initially used `width: totalWidthPx` (fixed). When the EPG panel is narrower than `totalWidthPx`, this was fine, but when the panel is wider (no preview panel open), it left a blank gap on the right. Fixed by using `minWidth: totalWidthPx; width: 100%`.
- **`epg-channel-col` must be `overflow: hidden`**, not `overflow-y: auto`. If it scrolls independently it will drift from the rows. The virtual slice drives position, not scrollTop.
- **`epg-row` had `overflow: hidden`** which clipped absolutely-positioned program buttons that start before `left: 0` (programs starting before the window). This is fine since program positions are clamped, but watch for it if extending the time window.
- The `isSelected` check previously compared `prog.channel_id` (a field that doesn't exist on `EpgProgram`) against `selectedProgram.program.channel_id`. Fixed to compare `selectedProgram.channel.id === ch.id` instead.

---

## Feature 8: EPG Guide — Inline Preview Panel with Live Stream

### Goal
Replace the bottom-sheet modal preview with an inline right-side panel that plays the stream immediately when a program is clicked.

### What Worked
- New `EpgPreviewPanel` component: 320px fixed-width column at the right of the EPG layout. Renders a `<video>` element with the same HLS/mpegts config used in LiveTV and Multiview.
- Stream starts playing as soon as the panel mounts — `useEffect` on `channel.stream_url` triggers player initialization.
- Panel contains: 16:9 video area, channel logo + name + LIVE badge, program title, time + duration + category, progress bar (for currently-airing programs), description, and "Watch Fullscreen" button.
- "Watch Fullscreen" navigates to `/player` with `returnTo: '/epg'`.
- Removed the bottom-sheet modal, backdrop overlay, and fullscreen EPG overlay entirely — simpler, fewer states.
- `previewFullscreen` state removed — no longer needed.

### What Did Not Work / Watch Out For
- **Bottom-sheet "Fullscreen EPG" button appeared to do nothing.** Root cause: clicking a program inside the fullscreen overlay called `openPreview` which set `previewFullscreen(false)` — the overlay closed immediately. This entire pattern was removed in favor of the simpler inline panel.
- **Old `isSelected` highlighting:** Used `prog.channel_id` which doesn't exist on the `EpgProgram` type. Replaced with `selectedProgram.channel.id === ch.id`.
- Always clean up HLS/mpegts instances in the `useEffect` return function — forgetting this leaks media players when the user clicks a different channel before the stream finishes loading.

---

## Feature 9: MainLayout Splash Screen — Remount on Navigation

### Goal
Prevent the splash screen from re-showing when navigating back to the main layout from the fullscreen player.

### Root Cause
`/player` is a top-level route outside `MainLayout`. Navigating to it unmounts `MainLayout`; navigating back (via `returnTo: '/epg'`) remounts it. The 12-second splash timer restarted on every remount.

### What Worked
- Module-level `let splashDismissed = false` flag outside the component. Persists across remounts within the same JS session (page is never hard-reloaded in Tauri).
- `useState(splashGone)` initialized to `splashDismissed` — if already dismissed, splash is skipped instantly.
- Set `splashDismissed = true` when the fade-out completes.

### What Did Not Work / Watch Out For
- Do not use `localStorage` or Zustand for this — it would persist across app restarts and the user would never see the splash again. Module-level variable resets on app restart (process restart) which is the correct behavior.
- The 12-second `MIN_SPLASH_MS` is intentionally long. Do not reduce it — it covers the time for Tauri/Rust to initialize and load playlists on cold start.

---

## Session 3 — LiveTV Panel Collapse, Buffer Tuning, Transparent Overlays

_Date: 2026-04-10_

---

## Feature 10: LiveTV — Collapsible Left Panels with Overlay

### Goal
During playback, collapse the categories sidebar and channel grid into the left edge so the player expands to full width. Desktop: hover near left edge to bring panels back. Android: hardware back button re-expands panels. Fullscreen: panels slide back in as a transparent overlay over the stream.

### Architecture
- `panelsCollapsed: boolean` — true as soon as a channel starts playing
- `panelsOverlay: boolean` — true while the overlay is visible (hover or back button)
- `overlayHideRef` — debounce ref (400ms) for auto-hiding the overlay on mouse leave
- `history.pushState({ liveTvPanels: 'collapsed' }, '')` called when collapsing — provides a history entry for Android back to pop
- `window.addEventListener('popstate', ...)` — catches the hardware back button press (Android WebView fires popstate when back is pressed and there is history to pop)
- A 24px invisible trigger strip (`livetv-panels-trigger`) sits at `z-index: 19`, below the panels at `z-index: 20` — mouse events reach the trigger when panels are off-screen, but panels catch them when overlaid

### CSS approach
- `.livetv-left-panels` always has `transform: translateX(0)` + CSS transition defined so animation is always ready
- `.panels-collapsed .livetv-left-panels` → `position: absolute; top/left/bottom: 0; transform: translateX(-100%); pointer-events: none` — removes panels from flow instantly, player takes full width, panels animate out
- `.panels-collapsed.panels-overlay .livetv-left-panels` → `transform: translateX(0); pointer-events: auto; box-shadow: …` — panels slide back in over the player
- `.livetv-root` gets `position: relative` as the absolute anchor

### What Worked
- The CSS `transform` approach: panels animate out smoothly because `transform: translateX(0)` is always defined, so the browser has a valid start value to transition from when `panels-collapsed` is added
- `position: absolute; left: 0; top: 0; bottom: 0` on the panels matches their natural flex position exactly — no visible jump when they become absolute before animating out
- The `history.pushState` + `popstate` pattern for Android back button interception works without any external Tauri plugin
- Debounced auto-hide (400ms) on mouse leave prevents the overlay from closing when the cursor briefly leaves the panels

### What Did Not Work / Watch Out For
- **Android back button without `history.pushState`:** `popstate` only fires if there is history to pop. Without first calling `pushState` on collapse, pressing back navigates the React Router away from LiveTV entirely. Always push state before collapsing.
- **`panelsCollapsed` guard in `playChannel`:** Without the `if (!panelsCollapsed)` check, switching channels while already collapsed pushes a new history entry every time. Only push state on the first collapse.
- **Fullscreen scope:** Changed the fullscreen button target from `.livetv-video-wrap` to `.livetv-root` so that panels can overlay a fullscreen stream. If fullscreen targets only the video wrap, the panels live outside the fullscreen element and are invisible.
- **z-index layering:** Trigger zone must be `z-index: 19`, panels `z-index: 20`. If trigger is on top of panels, it intercepts mouse events when the overlay is showing, causing a hover loop.

---

## Feature 11: Live TV & Player — HLS/mpegts Buffer Tuning

### Goal
Reduce buffering and stalling on IPTV live streams. The previous config was tuned for low-latency (sports streams) which caused constant rebuffers on standard IPTV.

### Root Cause Analysis
- **`lowLatencyMode: true` (HLS.js):** Intended for true LL-HLS streams. On standard IPTV, it reduces the forward buffer to ~6s and aggressively discards buffered segments, making any network hiccup a visible stall.
- **`liveBufferLatencyChasing: true` with `maxLatency: 10, minRemain: 2` (mpegts.js):** Forces the player to seek forward whenever live drift exceeds 10s. This manifests as the stream skipping/jumping, which users experience as "buffering" even when data is present.
- **`enableStashBuffer: false` for live (mpegts.js):** Disabling the IO stash buffer removes the read-ahead cushion, so network jitter hits the decoder directly.

### What Worked
- **HLS.js changes (`LiveTvScreen` + `PlayerScreen`):**
  - `lowLatencyMode: false` — stops thinning the buffer to chase latency
  - `maxBufferLength: 30` — explicit 30s forward buffer target
  - `maxMaxBufferLength: 60` — allows up to 60s if bandwidth permits
  - `backBufferLength: 30` (was already set, kept)
- **mpegts.js changes (both screens):**
  - `liveBufferLatencyChasing: false` — eliminates forced seeks; no more artificial stalls
  - `liveBufferLatencyMaxLatency: 30` — allows up to 30s drift before any chasing kicks in
  - `liveBufferLatencyMinRemain: 8` — keeps a comfortable cushion if chasing does engage
  - `enableStashBuffer: true` — restores the IO cushion
  - `stashInitialSize: 512 * 1024` — 512 KB read-ahead on startup for faster initial fill

### Tradeoff
The user is watching ~20–30s behind "live" instead of ~5–10s. For IPTV this is irrelevant — channels are not time-critical.

### What Did Not Work / Watch Out For
- Do not set `lowLatencyMode: true` for any IPTV source. These streams do not implement the LL-HLS spec (part-requests, blocking playlist reload). The mode only hurts.
- `enableStashBuffer: false` was previously justified with "reduces latency for live" — this is only true for sports/news where sub-second latency matters. Remove that justification for IPTV.

---

## Feature 12: LiveTV Player — Transparent Gradient Overlays

### Goal
Make the channel title bar (top) and playback controls (bottom) transparent overlays over the video instead of opaque dark bars that block the stream.

### Architecture Change
Previous layout: `livetv-player-panel` was a flex column — video wrap took `flex: 1` between the topbar and controls, pushing them apart vertically. All three consumed vertical space.

New layout:
- `livetv-video-wrap` → `position: absolute; inset: 0` — fills the entire player panel, behind everything
- `livetv-player-topbar` → `position: absolute; top: 0; left: 0; right: 0; z-index: 2` with `linear-gradient(to bottom, rgba(0,0,0,0.72), transparent)`
- `livetv-controls` → `position: absolute; bottom: 0; left: 0; right: 0; z-index: 2` with `linear-gradient(to top, rgba(0,0,0,0.80), transparent)` and `padding-top: 32px` to give the gradient room to fade
- EPG bar moved inside `.livetv-controls` so it sits on the same bottom gradient — one cohesive overlay instead of two separate bars

### What Worked
- `position: absolute; inset: 0` on the video wrap is the cleanest way to make it fill the container without flex gymnastics
- Moving the EPG title inside the controls div eliminates the `livetv-epg-bar` as a separate absolutely-positioned element — simpler stacking context
- `padding-top: 32px` on controls gives the gradient scrim enough height to fade naturally without the text sitting on a hard edge

### What Did Not Work / Watch Out For
- **`flex: 1` on video wrap must be removed** when switching to `position: absolute`. If both are set, `flex: 1` pushes the video out of the absolute stacking context, causing it to render below the controls.
- **`border-bottom`/`border-top` on the bars** must be removed — they look out of place with transparent backgrounds and create a hairline artifact over the video.

---

## Feature 13: LiveTV — "Infinity NaN" Duration Fix for Live Streams

### Goal
Live HLS streams report `duration = Infinity` (no known end). The time display showed `0:35 / Infinity NaN` and the seek bar divided `position / Infinity = 0` (always empty).

### What Worked
- Guard the seek bar render: `{isFinite(duration) && duration > 0 && <div className="livetv-seek-wrap">…</div>}` — seek bar is hidden entirely for live streams
- Replace the time label with a `LIVE` pill badge when `!isFinite(duration)`: a red `#e50914` badge styled like a broadcast indicator
- `formatTime` itself left unchanged — the guard above prevents it from ever receiving `Infinity`

### What Did Not Work / Watch Out For
- `duration > 0` alone is insufficient — `Infinity > 0` is `true`. Always use `isFinite(duration)` as the guard.
- The `progress` calculation `(position / duration) * 100` yields `NaN` when `duration === Infinity` (not `0` as you might expect). `NaN` in a `style={{ width }}` prop silently renders as `width: 0` in some browsers and throws a warning in others — always guard before the division.

---

## Session 4 — TMDB Integration, Hero Banner, Splash Screen, Responsive Cards

_Date: 2026-04-10_

---

## Feature 14: HomeScreen — `heroItems` Temporal Dead Zone (TDZ) Fix

### Goal
Hero banner pulled its items from `trendingMovies.slice(0, 5)` but the app crashed on load.

### Root Cause
`heroItems` was declared as a `useMemo` at line ~74, but `trendingMovies` and `trendingSeries` were declared at lines ~92 and ~110 respectively. JavaScript `const` bindings inside the same scope are subject to the Temporal Dead Zone — accessing them before their declaration causes a `ReferenceError` even though all three are `useMemo` hooks.

### What Worked
- Moved the `heroItems` useMemo block to immediately after the `trendingSeries` useMemo declaration.
- No other code changes required — the error was purely a declaration-order problem.

### What Did Not Work / Watch Out For
- **`useMemo` does not escape the TDZ.** Even though the computation runs lazily, the `const` binding is referenced at declaration time. If memo A references memo B but is declared first, React will throw during the render that declares A.
- **Rule:** Always declare derived memos after the memos they depend on. The order of `useMemo`/`useState` declarations in a component body must respect the dependency graph.

---

## Feature 15: Splash / Boot Screen

### Goal
Show a branded loading screen while Tauri initializes and loads playlists, so the user never sees a blank or partially-loaded home screen.

### Architecture
- Added `playlistsLoaded: boolean` to `playlistSlice` state, set to `true` after `loadPlaylists()` resolves.
- `MainLayout` reads `playlistsLoaded` and starts an 8-second minimum timer. When both conditions are met (data loaded AND minimum time elapsed), it fades the splash out (400ms) then removes it from the DOM.
- Module-level `let splashDismissed = false` flag prevents the splash from re-appearing when navigating back to `MainLayout` from the fullscreen player (which unmounts/remounts the layout).

### What Worked
- `useState(() => Date.now())[0]` as mount-time capture — avoids a separate `useRef` for the start timestamp.
- `Math.max(0, MIN_SPLASH_MS - elapsed)` correctly handles both cases: data loads in 2s (wait 6 more seconds) and data loads in 10s (show for 0 additional ms).
- `splashDismissed` module-level variable survives React remounts within the same Tauri process session — resets on full app restart, which is the correct behavior.
- CSS: `animation: splash-out 400ms ease forwards` with `pointer-events: none` prevents clicks from landing on the hidden overlay during fade.

### What Did Not Work / Watch Out For
- **Do not use `localStorage` or Zustand for `splashDismissed`** — those persist across restarts, so the user would never see the splash again after the first launch.
- **Do not use a `useRef` for mount time** — refs initialize to `null` and require a guard; `useState(() => Date.now())[0]` is cleaner and guaranteed non-null.
- Splash minimum was iterated: 5s → 8s. 5s was not enough on cold starts for the playlist data to load from the Rust backend.

---

## Feature 16: Hero Banner — Image Fitting & Crossfade

### Goal
Show as much of the TMDB backdrop as possible in the hero section. Previously `object-fit: cover` on an ultra-wide container (e.g. 2560×540) showed only ~33% of a 16:9 backdrop image vertically.

### Root Cause
`object-fit: cover` fills the container. When the container is far wider than the image's aspect ratio, the image is scaled to fill the width, and the height is massively cropped. At 2560px wide and 540px tall (4.7:1 container aspect vs 1.78:1 image), only 33% of image height is visible.

### What Worked
- **Two-class approach** based on image type:
  - `.hero-bg-img.backdrop` — TMDB landscape image: `height: 100%; width: auto; right: 0; top: 0; max-width: 80%`. The image renders at its natural aspect ratio sized to the container height. At 540px height, a 1280×720 backdrop renders at 960×540 — **100% of the image is visible**. Anchored to the right edge.
  - `.hero-bg-img.poster` — portrait fallback: `object-fit: cover; object-position: center top`. Shows the top of the poster (usually the character face).
- `isLandscape` flag computed in the render: `!!(tmdbData?.backdropUrl || item.backdrop)` for the active slide; `!!item.backdrop` for inactive slides.
- Extended the left gradient from 18% to 22% solid coverage to fill the space between the text content and the right-anchored image at ultra-wide resolutions.

### What Did Not Work / Watch Out For
- **`object-fit: cover` cannot show 80%+ of a 16:9 image in a banner wider than 16:9.** The math is immutable: visible fraction = container_height / (container_width / image_aspect). At 2560×540, this is 33%. No `object-position` value fixes this — only changing `object-fit` or reducing container width helps.
- **`object-position: right center`** (previous default) showed only the right third of the backdrop. `center 20%` showed slightly more but still cropped heavily. Neither solved the fundamental aspect-ratio mismatch.
- **`max-width: 80%`** on the backdrop prevents it from overrunning the text area on narrow windows where the image would otherwise be wider than the container.

### Crossfade Restoration
- Stacking all 5 hero items as `<img>` elements with `opacity: 0` and adding `active` class to the current index restores the CSS crossfade. Previously only one image was rendered (`key` change caused unmount/remount, no fade).
- The `fetchingFor` ref in `HeroBanner` prevents duplicate TMDB requests when the slide auto-advances faster than the first request resolves.

---

## Feature 17: Hero/Content Seam — Harsh Line Fix

### Goal
Eliminate the visible hard edge between the bottom of the hero banner and the trending-now rows below it.

### Root Cause
Two color mismatches:
1. The hero gradient faded to the hardcoded `#080b12` (a blue-black) but `--bg-primary` is `#0f0f0f` (neutral black). The mismatch was visible as a color-shifted band.
2. The `.content-area` inherited its background from the `.app-shell` gradient (`linear-gradient(135deg, #0a0a0a, #2e2e2e)`). At the junction point (~50% down the viewport), this was `#181818`, lighter than the hero fade target.

### What Worked
- Added `background: var(--bg-primary)` to `.content-area` — overrides the inherited gradient with the exact solid color the hero fades to.
- Replaced all hardcoded `#080b12` / `rgba(8,11,18,…)` values in `HeroBanner.css` with `rgba(15,15,15,…)` matching `--bg-primary: #0f0f0f`. Single source of truth for the fade color.
- Extended the bottom gradient from 60% to 70% height for a smoother transition.

### What Did Not Work / Watch Out For
- **Never hardcode the fade-to color in the hero gradient.** Always use `var(--bg-primary)` or a matching `rgba()` value. If the theme color changes, hardcoded values will immediately produce a visible seam.
- **Checking the gradient stop order matters.** `linear-gradient(to top, solid 0%, solid 6%, …)` means the bottom 6% is fully opaque. If this stop is too small, the very bottom edge of the hero fades to transparent (showing the content area color) before the solid region starts — creating a thin lighter stripe.

---

## Feature 18: TMDB Trending Now in VodScreen & SeriesScreen

### Goal
The Trending Now carousel in the Movies and Series tabs was using IMDb RSS titles to match against the playlist library. Switch it to use TMDB weekly trending (same as the Home screen).

### What Worked
- Added `tmdbTrendingMovies` / `tmdbTrendingTv` state (type `{ title: string }[]`).
- On mount: check `localStorage.getItem('tmdb_api_key')`. If present, call `fetch_tmdb_trending`. If not, fall back to `fetch_imdb_trending` (existing path).
- `byGenreWithTrending` useMemo prefers TMDB titles; falls back to IMDb list if TMDB is empty.
- `extractBaseTitle()` applied to both the TMDB title AND the playlist item name before comparison — strips IPTV prefixes like `EN - `, `FR | `, `[US] ` before matching.
- Matching logic: exact equality first (`n === t`), then substring (`n.includes(t) || t.includes(n)`) — catches cases where TMDB title is shorter/longer than the IPTV-formatted name.

### What Did Not Work / Watch Out For
- **Raw `v.name` comparison against TMDB titles always fails for IPTV content.** IPTV providers prefix everything with region/language codes. `extractBaseTitle()` is mandatory before any TMDB title comparison.
- **IMDb RSS is a fallback, not a replacement.** IMDb titles are formatted differently (sometimes include year, sometimes have foreign-language variants). TMDB is consistently `en` and matches TMDB search results exactly.

---

## Feature 19: Responsive Card Sizing

### Goal
Cards should scale with the app window. Target: ~6 cards visible per row at 1920×1080, ~8 at 2560×1440. Cards should grow/shrink as the window is resized.

### Math
- Content area width ≈ `100vw - 84px` (sidebar offset)
- Row usable width ≈ content - 48px padding = `100vw - 132px`
- For 6 cards at 1920px: `(1788 - 5×12) / 6 = 288px` per card
- For 8 cards at 2560px: `(2344 / 8) = 293px` per card (with 7 gaps)
- Both targets converge on ~288–293px → `15vw` = 288px at 1920, 384px at 2560 (capped at 295px)

### What Worked
- `width: clamp(180px, 15vw, 295px)` applied to card, img-wrap in HomeScreen, VodScreen, and SeriesScreen.
- `aspect-ratio: 2 / 3` on the img-wrap replaces the fixed `height: Npx` — height scales automatically with width, maintaining the poster ratio at all sizes.
- `width: 100%; height: 100%` on the `<img>` and placeholder divs inside the wrap — they fill whatever the wrap computes to.
- Applied consistently across all three screens so carousel behavior is uniform.

### What Did Not Work / Watch Out For
- **Fixed `height` on the img-wrap breaks `aspect-ratio`.** Both cannot coexist — `height` wins and `aspect-ratio` is ignored. Remove the fixed height entirely.
- **`flex-shrink: 0` must be kept on the card.** Without it, flex layout compresses the card below `clamp`'s minimum, defeating the responsive sizing.
- **`clamp(min, vw, max)` does not account for the sidebar width.** `15vw` at 1920px = 288px assumes the full viewport. Since the sidebar takes 84px, the effective content width is 1836px, so 6 cards × 288px + 5 × 12px = 1788px fits. The math works out correctly because the sidebar offset is smaller than the `vw` rounding margin.

---

## Session 1 (from LESSONS_LEARNED.md root file)

_Foundational project setup and architecture decisions._

---

## ✅ What Worked

### Tauri 2.0 + React/TypeScript scaffold
- `npm create tauri-app@latest` with `react-ts` template worked first-try on Windows.
- Single codebase for Android + Windows via Tauri 2.0 is viable; build targets share 100% of the React UI.

### Zustand MVI stores
- Splitting state into `playlistSlice`, `uiSlice`, `epgSlice`, `playerSlice` kept concerns clean.
- `Intent → State → View` pattern maps naturally to `create<State & Intents>()` in Zustand.
- Async intents (e.g. `fetchVod`) call `invoke()` then `set()` — straightforward and testable.

### Rust reqwest with `rustls-tls`
- `rustls-tls` required for Android cross-compilation; `native-tls` doesn't cross-compile cleanly.
- `default-features = false` + `features = ["json", "rustls-tls"]` is the correct combo.

### M3U + Xtream Codes parsers
- Line-by-line M3U parser using `BufReader` + regex for `#EXTINF` attributes worked for all tested sources.
- Xtream series info (`get_series_info`) requires a separate second call — `fetch_series` only returns the list.

### JSON persistence via `app_data_dir`
- `tauri::Manager::path().app_data_dir()` gives a reliable, platform-correct path.
- `serde_json::from_str` with `unwrap_or_default()` handles first-run and corrupt files gracefully.

### React Router `location.state` for cross-screen pre-selection
- Navigating to `/vod` with `{ state: { preSelectedId: "..." } }` is clean; avoids global state pollution.

### Frosted-glass pill sidebar
- `backdrop-filter: blur(24px)` + `background: rgba(20,14,36,0.72)` + `border-radius: 24px`.
- Must also set `-webkit-backdrop-filter` for WebKit compatibility.

### OMDb API integration
- Storing API key in `localStorage` (not Rust keychain) acceptable for non-sensitive keys.
- Graceful fallback: display playlist metadata if OMDb fails or no key is set.

### HorizontalRow carousel layout
- Genre rows (Netflix-style) work much better than flat grids for large catalogs.
- Sorting by year descending (newest first) within each genre row keeps content fresh.

### Rules of Hooks compliance
- All `useMemo`/`useEffect` calls must precede any early `return`.
- `heroItems` was a plain array defined after an early return — fixed by converting to `useMemo` and moving above the return.

---

## ❌ What Didn't Work / Pain Points

### LNK1181: cannot open input file `mpv.lib`
- `libmpv-sys` expects `mpv.lib` on `LIB` path or via `LIBMPV_LIB_DIR` env var.
- **Fix:** Source `libmpv-2.dll` from Stremio, generate `mpv.lib` with MSVC `dumpbin`/`lib` tools, copy to `src-tauri/resources/`, add `rustc-link-search` in `build.rs`.
- **Lesson:** Any native DLL crate needs both `.lib` (linker) and `.dll` (runtime). Document both.

### `libmpv-sys` constant naming
- Constants are `mpv_format_MPV_FORMAT_FLAG` (not `MPV_FORMAT_FLAG`). Always prefix with `mpv_format_`.

### `DefWindowProcW` as fn pointer
- Generic function; can't be coerced to `WNDPROC` directly. Wrap in a concrete `unsafe extern "system" fn`.

### `Win32_Graphics_Gdi` feature missing
- `WNDCLASSW` requires this feature in the `windows` crate — add to `Cargo.toml` features.

### `app.state()` — missing `use tauri::Manager`
- Add `use tauri::Manager;` in `lib.rs` whenever `.state::<T>()` is called on an `AppHandle`.

### React `Rendered more hooks than during the previous render`
- Hooks placed after an early `return`. Move all hooks above any conditional returns.

### Category pill sidebar (removed)
- Vertical sidebar took horizontal space and added friction. Replaced with Netflix-style genre rows; search remains the primary filter.

---

## General Lessons — Session 4

| Area | Lesson |
|---|---|
| `useMemo` declaration order | Memos that reference other memos must be declared after them — TDZ applies inside component bodies |
| Splash screen persistence | Use a module-level variable (not localStorage/Zustand) to skip the splash on layout remounts within the same process |
| Hero image at ultra-wide | `object-fit: cover` cannot show >40% of a 16:9 image in a 4:1+ container — switch to `height: 100%; width: auto` anchored to the right |
| Theme color consistency | Never hardcode the hero fade color — use `var(--bg-primary)` so theme changes propagate automatically |
| IPTV title matching | Always apply `extractBaseTitle()` before comparing playlist names against TMDB/IMDb titles — raw IPTV names always have prefixes |
| Responsive cards | `clamp(min, vw, max)` + `aspect-ratio` is the correct CSS pattern — never pair `aspect-ratio` with a fixed `height` |
| CSS crossfade | To crossfade between hero images, stack all items in the DOM with `opacity: 0` and add `active` class — do not key-swap a single element (that causes remount, not fade) |
