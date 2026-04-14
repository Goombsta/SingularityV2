use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.singularity.app";

pub fn init_mpv<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("mpv")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "MpvPlugin")?;
            Ok(())
        })
        .build()
}


pub fn init_updater<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("updater")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "UpdaterPlugin")?;
            Ok(())
        })
        .build()
}
