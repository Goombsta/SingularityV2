# Live TV .m3u8 Playback — What Worked & What Didn't

## Context

Investigating why explicit `.m3u8` streams (e.g. `https://xapi-ie.org/live/user/pass/714676.m3u8`) showed a black screen or "Stream unavailable" on both Windows desktop and Android.

---

## Root Causes Found

### 1. MPV starts from a stale HLS segment (Windows)
Live HLS playlists are a rolling window of ~3–6 segments. MPV defaulted to starting from the **first** (oldest) segment in the manifest. By the time it fetched that segment, the CDN had already rotated it out — 404, then "stream unavailable" after ~1 second.

**Fix:** `demuxer-lavf-o=live_start_index=-1` tells MPV to start from the **last** (freshest) segment.

### 2. CDN rejects browser segment requests (Android + Windows HTML5)
HLS.js fetches `.ts` segments via `XMLHttpRequest`. Chromium always attaches an `Origin` header to cross-origin XHR requests. IPTV CDNs that whitelist their own origin (or no origin at all) return 403/404 for segments that arrive with `Origin: tauri://localhost`.

- `<meta name="referrer" content="no-referrer">` — **did not help**. It suppresses `Referer`, but `Origin` is a security header that cannot be removed from JavaScript.
- Setting `fLoader` on HLS.js to proxy all streams — **broke extensionless/Xtream channels** that were already working, because those CDNs don't have the same restriction and the extra hop introduced errors.

**Fix:** Rust local HTTP proxy (`src-tauri/src/proxy.rs`) bound to `127.0.0.1:random`. The proxy fetches segments with `reqwest` (no browser headers). HLS.js `fLoader` is overridden **only** for explicit `.m3u8` URLs, routing segment requests through `http://127.0.0.1:{port}/proxy?url=ENCODED`. Manifest requests still go direct.

---

## What Was Tried and Didn't Work

| Attempt | Why It Failed |
|---|---|
| `startNative()` fallback after HLS.js fatal error | Chromium can't play `.m3u8` natively — `canPlayType('application/vnd.apple.mpegurl')` returns `""` on Chromium/WebView |
| `<meta name="referrer" content="no-referrer">` in `index.html` | Suppresses `Referer` only; CDNs reject on `Origin`, which browsers always send on cross-origin XHR |
| `stream-lavf-o=reconnect=1,...` in MPV options | Reconnect options don't fix the root cause — the segment URL itself is expired, reconnecting to the same expired URL still 404s |
| ProxyLoader applied to ALL HLS streams (extensionless + `.ts` + `.m3u8`) | Broke extensionless Xtream Codes channels that were working fine without a proxy |

---

## What Works Now

| Stream type | Platform | Player | Mechanism |
|---|---|---|---|
| Explicit `.m3u8` | Windows | MPV | `demuxer-lavf-o=live_start_index=-1` starts from freshest segment |
| Explicit `.m3u8` | Android | HLS.js + Rust proxy | Segments proxied through local reqwest server — no Origin header |
| Extensionless Xtream | Both | HLS.js (direct) | Unchanged — no proxy |
| Explicit `.ts` | Both | HLS.js → mpegts.js fallback | Unchanged |
| MP4/MKV VOD | Both | Native `<video>` | Unchanged |

---

## Files Changed

- `src-tauri/src/proxy.rs` — new minimal HTTP proxy (tokio + reqwest)
- `src-tauri/src/lib.rs` — start proxy on app launch, expose `get_proxy_port` command
- `src-tauri/src/commands/player.rs` — add `demuxer-lavf-o=live_start_index=-1` to MPV live config
- `src/screens/LiveTvScreen.tsx` — ProxyLoader wired to `isExplicitHls` branch only; `togglePlay` promise rejection fixed
- `src/screens/PlayerScreen.tsx` — ProxyLoader wired to `isHls` branch only
