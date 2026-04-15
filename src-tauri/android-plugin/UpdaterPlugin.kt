package com.singularity.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@TauriPlugin
class UpdaterPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(InstallArgs::class.java)
        val file = File(args.path)

        if (!file.exists()) {
            invoke.reject("APK not found at: ${args.path}")
            return
        }

        activity.runOnUiThread {
            try {
                // On Android 8+ check whether the app is allowed to install unknown packages.
                // If not, redirect to the system settings screen. The user can tap Install
                // after granting — no need to keep the app in a special state.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!activity.packageManager.canRequestPackageInstalls()) {
                        val settingsIntent = Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${activity.packageName}")
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        activity.startActivity(settingsIntent)
                        val result = JSObject()
                        result.put("needsPermission", true)
                        invoke.resolve(result)
                        return@runOnUiThread
                    }
                }

                val uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.fileprovider",
                    file
                )

                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                activity.startActivity(intent)
                val result = JSObject()
                result.put("needsPermission", false)
                invoke.resolve(result)
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Failed to launch installer")
            }
        }
    }

    data class InstallArgs(val path: String = "")
}
