type CmdResult<T> = Result<T, String>;

const SERVICE: &str = "singularity";

#[tauri::command]
pub async fn store_credential(key: String, value: String) -> CmdResult<()> {
    #[cfg(not(target_os = "android"))]
    {
        let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
        entry.set_password(&value).map_err(|e| e.to_string())?;
    }
    // On Android, credential storage is handled by the Kotlin CredentialPlugin
    Ok(())
}

#[tauri::command]
pub async fn get_credential(key: String) -> CmdResult<Option<String>> {
    #[cfg(not(target_os = "android"))]
    {
        let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(val) => return Ok(Some(val)),
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(e.to_string()),
        }
    }
    #[cfg(target_os = "android")]
    Ok(None)
}

#[tauri::command]
pub async fn delete_credential(key: String) -> CmdResult<()> {
    #[cfg(not(target_os = "android"))]
    {
        let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
        let _ = entry.delete_credential();
    }
    Ok(())
}
