package com.singularity.app

import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class CredentialPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            activity,
            "singularity_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Command
    fun storeCredential(invoke: Invoke) {
        val args = invoke.parseArgs(CredArgs::class.java)
        prefs.edit().putString("${args.service}::${args.key}", args.value).apply()
        invoke.resolve()
    }

    @Command
    fun getCredential(invoke: Invoke) {
        val args = invoke.parseArgs(CredKeyArgs::class.java)
        val value = prefs.getString("${args.service}::${args.key}", null)
        if (value != null) {
            val obj = JSObject()
            obj.put("value", value)
            invoke.resolve(obj)
        } else {
            invoke.reject("Credential not found")
        }
    }

    @Command
    fun deleteCredential(invoke: Invoke) {
        val args = invoke.parseArgs(CredKeyArgs::class.java)
        prefs.edit().remove("${args.service}::${args.key}").apply()
        invoke.resolve()
    }

    data class CredArgs(val service: String = "", val key: String = "", val value: String = "")
    data class CredKeyArgs(val service: String = "", val key: String = "")
}
