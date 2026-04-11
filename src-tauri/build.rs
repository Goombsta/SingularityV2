fn main() {
    // On Windows, add the resources directory to the linker search path so
    // the MSVC linker can find mpv.lib (generated from libmpv-2.dll).
    #[cfg(windows)]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let resources = std::path::PathBuf::from(&manifest_dir).join("resources");
        println!("cargo:rustc-link-search=native={}", resources.display());
    }

    tauri_build::build()
}
