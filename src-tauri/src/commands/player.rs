/// Player commands — platform-dispatched.
/// On Windows: real libmpv + child HWND embedding.
/// On Android: commands are no-ops here; the Kotlin MpvPlugin handles them directly.

type CmdResult<T> = Result<T, String>;

#[derive(serde::Serialize)]
pub struct PlayerProperties {
    pub duration: f64,
    pub position: f64,
    pub paused: bool,
    pub volume: f64,
    pub idle: bool,
}

#[derive(serde::Serialize)]
pub struct TechStats {
    pub width: i64,
    pub height: i64,
    pub video_codec: String,
    pub fps: f64,
    pub video_bitrate: i64,
    pub pixel_format: String,
    pub hwdec_active: String,
    pub audio_codec: String,
    pub audio_bitrate: i64,
    pub audio_channels: i64,
    pub demuxer_cache_duration: f64,
    pub dropped_frames: i64,
}

#[derive(serde::Serialize)]
pub struct TrackInfo {
    pub id: i64,
    pub track_type: String,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub selected: bool,
}

#[cfg(not(target_os = "android"))]
pub use windows_impl::*;

#[cfg(not(target_os = "android"))]
mod windows_impl {
    use super::{CmdResult, PlayerProperties, TechStats, TrackInfo};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager, State, WebviewWindow};

    // ── State ────────────────────────────────────────────────────────────────

    pub struct MpvStore {
        pub players: Mutex<HashMap<String, MpvPlayer>>,
    }

    impl MpvStore {
        pub fn new() -> Self {
            Self {
                players: Mutex::new(HashMap::new()),
            }
        }
    }

    /// One MPV instance + its child HWND.
    pub struct MpvPlayer {
        pub ctx: MpvCtx,
        pub hwnd: isize,
    }

    // ── Safe wrapper around raw mpv_handle ───────────────────────────────────

    pub struct MpvCtx(pub *mut libmpv_sys::mpv_handle);

    // Safety: mpv_handle is designed to be used from a single thread at a time,
    // and we protect access with the Mutex in MpvStore.
    unsafe impl Send for MpvCtx {}
    unsafe impl Sync for MpvCtx {}

    impl Drop for MpvCtx {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { libmpv_sys::mpv_terminate_destroy(self.0) };
            }
        }
    }

    // ── Win32 child-window helpers ───────────────────────────────────────────

    #[cfg(windows)]
    fn create_mpv_child(parent: isize, x: i32, y: i32, w: i32, h: i32) -> CmdResult<isize> {
        use windows::Win32::Foundation::{HWND, LRESULT, LPARAM, WPARAM};
        use windows::Win32::Graphics::Gdi::HBRUSH;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, ShowWindow, CS_HREDRAW, CS_VREDRAW,
            SW_SHOW, WNDCLASSW, WS_CHILD, WS_VISIBLE, RegisterClassW,
            WINDOW_EX_STYLE,
        };
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::core::PCWSTR;
        use std::sync::Once;

        // Concrete extern "system" fn matching the WNDPROC signature
        unsafe extern "system" fn wnd_proc(
            hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM,
        ) -> LRESULT {
            windows::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        static REGISTER: Once = Once::new();
        const CLASS: &[u16] = &[
            b'S' as u16, b'i' as u16, b'n' as u16, b'g' as u16,
            b'M' as u16, b'p' as u16, b'v' as u16, 0u16,
        ];

        REGISTER.call_once(|| unsafe {
            let hinstance = GetModuleHandleW(PCWSTR::null()).unwrap();
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR(CLASS.as_ptr()),
                hbrBackground: HBRUSH(std::ptr::null_mut()),
                ..Default::default()
            };
            RegisterClassW(&wc);
        });

        let hwnd = unsafe {
            let hinstance = GetModuleHandleW(PCWSTR::null())
                .map_err(|e| format!("GetModuleHandle failed: {e}"))?;
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR(CLASS.as_ptr()),
                PCWSTR::null(),
                WS_CHILD | WS_VISIBLE,
                x, y, w, h,
                HWND(parent as *mut _),
                None,
                hinstance,
                None,
            ).map_err(|e| format!("CreateWindowExW failed: {e}"))?
        };

        unsafe { let _ = ShowWindow(hwnd, SW_SHOW); };

        // Bug 2: push MPV child below WebView2 in the sibling z-order so it
        // shows through the transparent WebView region rather than occludes it.
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, HWND_BOTTOM, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE,
            };
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE).ok();
        }

        Ok(hwnd.0 as isize)
    }

    #[cfg(not(windows))]
    fn create_mpv_child(_parent: isize, _x: i32, _y: i32, _w: i32, _h: i32) -> CmdResult<isize> {
        Err("MPV HWND bridge is Windows-only".into())
    }

    // ── MPV helpers ──────────────────────────────────────────────────────────

    fn mpv_set_str(ctx: *mut libmpv_sys::mpv_handle, name: &str, value: &str) -> CmdResult<()> {
        use std::ffi::CString;
        let name_c = CString::new(name).map_err(|e| e.to_string())?;
        let val_c = CString::new(value).map_err(|e| e.to_string())?;
        let rc = unsafe {
            libmpv_sys::mpv_set_option_string(ctx, name_c.as_ptr(), val_c.as_ptr())
        };
        if rc < 0 { Err(format!("mpv_set_option_string({name}) failed: {rc}")) } else { Ok(()) }
    }

    fn mpv_set_i64(ctx: *mut libmpv_sys::mpv_handle, name: &str, value: i64) -> CmdResult<()> {
        use std::ffi::CString;
        let name_c = CString::new(name).map_err(|e| e.to_string())?;
        let rc = unsafe {
            libmpv_sys::mpv_set_option(
                ctx, name_c.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_INT64,
                &value as *const i64 as *mut _,
            )
        };
        if rc < 0 { Err(format!("mpv_set_option({name}) failed: {rc}")) } else { Ok(()) }
    }

    fn mpv_command_str(ctx: *mut libmpv_sys::mpv_handle, args: &[&str]) -> CmdResult<()> {
        use std::ffi::CString;
        let cstrings: Vec<CString> = args.iter()
            .map(|s| CString::new(*s).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let mut ptrs: Vec<*const std::os::raw::c_char> = cstrings.iter()
            .map(|s| s.as_ptr())
            .collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { libmpv_sys::mpv_command(ctx, ptrs.as_mut_ptr()) };
        if rc < 0 { Err(format!("mpv_command failed: {rc}")) } else { Ok(()) }
    }

    fn mpv_get_f64(ctx: *mut libmpv_sys::mpv_handle, name: &str) -> f64 {
        use std::ffi::CString;
        let Ok(name_c) = CString::new(name) else { return 0.0 };
        let mut val: f64 = 0.0;
        unsafe {
            libmpv_sys::mpv_get_property(
                ctx, name_c.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_DOUBLE,
                &mut val as *mut f64 as *mut _,
            );
        }
        val
    }

    fn mpv_get_i64(ctx: *mut libmpv_sys::mpv_handle, name: &str) -> i64 {
        use std::ffi::CString;
        let Ok(name_c) = CString::new(name) else { return 0 };
        let mut val: i64 = 0;
        unsafe {
            libmpv_sys::mpv_get_property(
                ctx, name_c.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_INT64,
                &mut val as *mut i64 as *mut _,
            );
        }
        val
    }

    fn mpv_get_bool(ctx: *mut libmpv_sys::mpv_handle, name: &str) -> bool {
        use std::ffi::CString;
        let Ok(name_c) = CString::new(name) else { return false };
        let mut val: i64 = 0;
        unsafe {
            libmpv_sys::mpv_get_property(
                ctx, name_c.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_FLAG,
                &mut val as *mut i64 as *mut _,
            );
        }
        val != 0
    }

    fn mpv_get_str(ctx: *mut libmpv_sys::mpv_handle, name: &str) -> Option<String> {
        use std::ffi::{CString, CStr};
        let name_c = CString::new(name).ok()?;
        let ptr = unsafe { libmpv_sys::mpv_get_property_string(ctx, name_c.as_ptr()) };
        if ptr.is_null() { return None; }
        let s = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        unsafe { libmpv_sys::mpv_free(ptr as *mut _) };
        Some(s)
    }

    fn mpv_set_property_f64(ctx: *mut libmpv_sys::mpv_handle, name: &str, value: f64) {
        use std::ffi::CString;
        let Ok(name_c) = CString::new(name) else { return };
        unsafe {
            libmpv_sys::mpv_set_property(
                ctx, name_c.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_DOUBLE,
                &value as *const f64 as *mut _,
            );
        }
    }

    // ── Tauri commands ───────────────────────────────────────────────────────

    /// Create a new MPV player instance embedded at the given position/size in the window.
    #[tauri::command]
    pub async fn mpv_create(
        state: State<'_, MpvStore>,
        window: WebviewWindow,
        player_id: String,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        live: bool,
    ) -> CmdResult<()> {
        let parent_hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;

        // IMPORTANT: create the child HWND on the main thread.
        // Every HWND belongs to the thread that called CreateWindowExW.
        // MPV's render thread uses SendMessage to talk to this window — if the
        // owning thread is a tokio worker (no message loop), SendMessage blocks
        // forever, freezing the entire app. The main thread's Win32 loop handles
        // the message and unblocks MPV's render thread.
        let (hwnd_tx, hwnd_rx) = tokio::sync::oneshot::channel::<CmdResult<isize>>();
        window.app_handle().run_on_main_thread(move || {
            let _ = hwnd_tx.send(create_mpv_child(parent_hwnd, x, y, width, height));
        }).map_err(|e| e.to_string())?;
        let child_hwnd = hwnd_rx.await.map_err(|_| "HWND channel closed".to_string())??;

        let ctx = unsafe { libmpv_sys::mpv_create() };
        if ctx.is_null() {
            // Clean up the HWND we already created on the main thread.
            window.app_handle().run_on_main_thread(move || {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;
                    let _ = DestroyWindow(HWND(child_hwnd as *mut _));
                }
            }).ok();
            return Err("mpv_create returned null (is libmpv-2.dll present?)".into());
        }

        // ── Critical options (fail fast if these don't work) ────────────────
        mpv_set_i64(ctx, "wid", child_hwnd as i64)?;
        mpv_set_str(ctx, "vo", "gpu")?;
        mpv_set_str(ctx, "keep-open", "yes")?;
        mpv_set_str(ctx, "user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")?;

        // ── Best-effort options (ignore failures — older libmpv may not support all) ──
        let _ = mpv_set_str(ctx, "gpu-api", "d3d11");
        let _ = mpv_set_str(ctx, "hwdec", "auto");
        let _ = mpv_set_str(ctx, "hwdec-codecs", "all");
        // Disable SPDIF/HDMI passthrough and always decode to PCM.
        // Without this, MPV attempts passthrough for AC3/EAC3/DTS/TrueHD.
        // If the output device doesn't support the codec, the result is silence.
        // Forcing software decode produces audio on any output device.
        let _ = mpv_set_str(ctx, "audio-spdif", "");
        let _ = mpv_set_str(ctx, "volume-max", "150");
        let _ = mpv_set_str(ctx, "network-timeout", "30");
        let _ = mpv_set_str(ctx, "cache", "yes");
        let _ = mpv_set_str(ctx, "cache-pause", "no");
        // Keep probescore low so libav doesn't stall reading IPTV streams while
        // trying to identify the container. The correct container is already known
        // from the URL extension (supplied by the Xtream container_extension field),
        // so aggressive probing is unnecessary and causes hangs on certain providers.
        let _ = mpv_set_str(ctx, "demuxer-lavf-probescore", "10");
        // For live HLS: start from the last (freshest) segment instead of the first.
        // Without this, MPV starts at the beginning of the rolling CDN window where
        // early segments may already have expired, causing immediate 404 failures.
        let _ = mpv_set_str(ctx, "demuxer-lavf-o", "live_start_index=-1");

        if live {
            // Live streams: small forward buffer to keep latency low.
            // A large buffer causes MPV to chase the stream head, building
            // latency until it stalls and has to resync — the "buffering" symptom.
            let _ = mpv_set_i64(ctx, "demuxer-max-bytes", 2_097_152);       // 2 MB
            let _ = mpv_set_i64(ctx, "demuxer-max-back-bytes", 0);           // no back-buffer
            let _ = mpv_set_str(ctx, "cache-secs", "8");                     // stay ≤8s ahead
        } else {
            // VOD: large buffer enables smooth seeking and handles slow servers.
            let _ = mpv_set_i64(ctx, "demuxer-max-bytes", 52_428_800);       // 50 MB
            let _ = mpv_set_i64(ctx, "demuxer-max-back-bytes", 26_214_400);  // 25 MB back
        }

        let rc = unsafe { libmpv_sys::mpv_initialize(ctx) };
        if rc < 0 {
            unsafe { libmpv_sys::mpv_terminate_destroy(ctx) };
            return Err(format!("mpv_initialize failed: {rc}"));
        }

        state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?.insert(
            player_id,
            MpvPlayer { ctx: MpvCtx(ctx), hwnd: child_hwnd },
        );
        Ok(())
    }

    /// Load and play a URL in the given player.
    #[tauri::command]
    pub async fn mpv_load_url(
        state: State<'_, MpvStore>,
        player_id: String,
        url: String,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        mpv_command_str(player.ctx.0, &["loadfile", &url, "replace"])
    }

    /// Pause playback.
    #[tauri::command]
    pub async fn mpv_pause(
        state: State<'_, MpvStore>,
        player_id: String,
    ) -> CmdResult<()> {
        use std::ffi::CString;
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        let name = CString::new("pause").map_err(|e| e.to_string())?;
        let val: i64 = 1;
        unsafe {
            libmpv_sys::mpv_set_property(
                player.ctx.0, name.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_FLAG,
                &val as *const i64 as *mut _,
            );
        }
        Ok(())
    }

    /// Resume playback.
    #[tauri::command]
    pub async fn mpv_resume(
        state: State<'_, MpvStore>,
        player_id: String,
    ) -> CmdResult<()> {
        use std::ffi::CString;
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        let name = CString::new("pause").map_err(|e| e.to_string())?;
        let val: i64 = 0;
        unsafe {
            libmpv_sys::mpv_set_property(
                player.ctx.0, name.as_ptr(),
                libmpv_sys::mpv_format_MPV_FORMAT_FLAG,
                &val as *const i64 as *mut _,
            );
        }
        Ok(())
    }

    /// Set volume (0–150, values above 100 use software amplification).
    #[tauri::command]
    pub async fn mpv_set_volume(
        state: State<'_, MpvStore>,
        player_id: String,
        volume: f64,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        mpv_set_property_f64(player.ctx.0, "volume", volume.clamp(0.0, 150.0));
        Ok(())
    }

    /// Seek to an absolute position in seconds.
    #[tauri::command]
    pub async fn mpv_seek(
        state: State<'_, MpvStore>,
        player_id: String,
        position: f64,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        mpv_command_str(player.ctx.0, &["seek", &position.to_string(), "absolute"])
    }

    /// Move/resize the player's child window (call when layout changes).
    #[tauri::command]
    pub async fn mpv_resize(
        state: State<'_, MpvStore>,
        player_id: String,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;

        #[cfg(windows)]
        unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOZORDER, SWP_NOACTIVATE};
            SetWindowPos(
                HWND(player.hwnd as *mut _),
                None,
                x, y, width, height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            ).ok();
        }
        Ok(())
    }

    /// Get current playback properties.
    #[tauri::command]
    pub async fn player_get_properties(
        state: State<'_, MpvStore>,
        player_id: Option<String>,
    ) -> CmdResult<PlayerProperties> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        if let Some(id) = player_id {
            if let Some(player) = guard.get(&id) {
                return Ok(PlayerProperties {
                    duration: mpv_get_f64(player.ctx.0, "duration"),
                    position: mpv_get_f64(player.ctx.0, "time-pos"),
                    paused: mpv_get_bool(player.ctx.0, "pause"),
                    volume: mpv_get_f64(player.ctx.0, "volume"),
                    idle: mpv_get_bool(player.ctx.0, "idle-active"),
                });
            }
        }
        Ok(PlayerProperties { duration: 0.0, position: 0.0, paused: true, volume: 100.0, idle: false })
    }

    /// Get tech stats for the current player (video/audio/network properties).
    #[tauri::command]
    pub async fn player_get_tech_stats(
        state: State<'_, MpvStore>,
        player_id: Option<String>,
    ) -> CmdResult<TechStats> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let ctx = match player_id.as_deref().and_then(|id| guard.get(id)) {
            Some(p) => p.ctx.0,
            None => return Ok(TechStats {
                width: 0, height: 0, video_codec: String::new(), fps: 0.0,
                video_bitrate: 0, pixel_format: String::new(), hwdec_active: String::new(),
                audio_codec: String::new(), audio_bitrate: 0, audio_channels: 0,
                demuxer_cache_duration: 0.0, dropped_frames: 0,
            }),
        };
        Ok(TechStats {
            width:                   mpv_get_i64(ctx, "width"),
            height:                  mpv_get_i64(ctx, "height"),
            video_codec:             mpv_get_str(ctx, "video-codec").unwrap_or_default(),
            fps:                     mpv_get_f64(ctx, "estimated-vf-fps"),
            video_bitrate:           mpv_get_i64(ctx, "video-bitrate"),
            pixel_format:            mpv_get_str(ctx, "video-params/pixelformat").unwrap_or_default(),
            hwdec_active:            mpv_get_str(ctx, "hwdec-current").unwrap_or_default(),
            audio_codec:             mpv_get_str(ctx, "audio-codec-name").unwrap_or_default(),
            audio_bitrate:           mpv_get_i64(ctx, "audio-bitrate"),
            audio_channels:          mpv_get_i64(ctx, "audio-params/channel-count"),
            demuxer_cache_duration:  mpv_get_f64(ctx, "demuxer-cache-duration"),
            dropped_frames:          mpv_get_i64(ctx, "vo-delayed-frame-count"),
        })
    }

    /// Get all tracks (video/audio/subtitle) for the current file.
    #[tauri::command]
    pub async fn mpv_get_tracks(
        state: State<'_, MpvStore>,
        player_id: String,
    ) -> CmdResult<Vec<TrackInfo>> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let Some(player) = guard.get(&player_id) else { return Ok(vec![]) };
        let ctx = player.ctx.0;
        // Cap at 64 to guard against garbage values from MPV before file is demuxed
        let raw_count = mpv_get_i64(ctx, "track-list/count");
        if raw_count <= 0 { return Ok(vec![]) }
        let count = (raw_count as usize).min(64);
        let mut tracks = Vec::with_capacity(count);
        for i in 0..count {
            let track_type = mpv_get_str(ctx, &format!("track-list/{i}/type")).unwrap_or_default();
            if track_type.is_empty() { continue } // MPV returned no type; skip
            let id = mpv_get_i64(ctx, &format!("track-list/{i}/id"));
            let title = mpv_get_str(ctx, &format!("track-list/{i}/title"));
            let lang = mpv_get_str(ctx, &format!("track-list/{i}/lang"));
            let selected = mpv_get_bool(ctx, &format!("track-list/{i}/selected"));
            tracks.push(TrackInfo { id, track_type, title, lang, selected });
        }
        Ok(tracks)
    }

    /// Select an audio track by id (0 = auto/default).
    #[tauri::command]
    pub async fn mpv_set_audio_track(
        state: State<'_, MpvStore>,
        player_id: String,
        track_id: i64,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        let aid = if track_id == 0 { "auto".to_string() } else { track_id.to_string() };
        mpv_command_str(player.ctx.0, &["set", "aid", &aid])
    }

    /// Select a subtitle track by id (0 = disable subtitles).
    #[tauri::command]
    pub async fn mpv_set_sub_track(
        state: State<'_, MpvStore>,
        player_id: String,
        track_id: i64,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        let sid = if track_id == 0 { "no".to_string() } else { track_id.to_string() };
        // Use mpv_command "set" to set the runtime property (not mpv_set_option_string which is pre-init only)
        mpv_command_str(player.ctx.0, &["set", "sid", &sid])
    }

    /// Set subtitle scale (1.0 = normal; maps to MPV sub-scale property).
    #[tauri::command]
    pub async fn mpv_set_sub_scale(
        state: State<'_, MpvStore>,
        player_id: String,
        scale: f64,
    ) -> CmdResult<()> {
        let guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
        let player = guard.get(&player_id).ok_or("player not found")?;
        mpv_command_str(player.ctx.0, &["set", "sub-scale", &scale.to_string()])
    }

    /// Destroy a player instance and its child window.
    #[tauri::command]
    pub async fn mpv_destroy(
        state: State<'_, MpvStore>,
        app_handle: AppHandle,
        player_id: String,
    ) -> CmdResult<()> {
        // Remove from state first, releasing the lock before any blocking work.
        // mpv_terminate_destroy (called by MpvCtx::drop) can block while waiting
        // for MPV's internal threads to stop — holding the mutex during that would
        // prevent every other player command from running.
        let player = {
            let mut guard = state.players.lock().map_err(|e| format!("player state lock poisoned: {e}"))?;
            guard.remove(&player_id)
        };
        if let Some(player) = player {
            let hwnd = player.hwnd;
            drop(player); // MpvCtx::drop → mpv_terminate_destroy (blocks until MPV stops)
            // Destroy the child window on the main thread — it was created there
            // and DestroyWindow must be called from the owning thread on Windows.
            app_handle.run_on_main_thread(move || {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;
                    let _ = DestroyWindow(HWND(hwnd as *mut _));
                }
            }).ok();
        }
        Ok(())
    }
}
