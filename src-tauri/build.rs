fn main() {
    // On Windows, add the resources directory to the linker search path so
    // the MSVC linker can find mpv.lib (generated from libmpv-2.dll).
    #[cfg(windows)]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let resources = std::path::PathBuf::from(&manifest_dir).join("resources");
        println!("cargo:rustc-link-search=native={}", resources.display());
    }

    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "mpv",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "mpv_create",
                    "mpv_load_url",
                    "mpv_pause",
                    "mpv_resume",
                    "mpv_set_volume",
                    "mpv_seek",
                    "mpv_resize",
                    "mpv_destroy",
                    "player_get_properties",
                    "mpv_get_tracks",
                    "mpv_set_audio_track",
                    "mpv_set_sub_track",
                    "mpv_set_sub_scale",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri_build");
}
