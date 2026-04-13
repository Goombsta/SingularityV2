package com.singularity.app

import android.graphics.Color
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import `is`.xyz.mpv.MPVLib
import `is`.xyz.mpv.MPVView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class MpvPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    private val players = mutableMapOf<String, MPVView>()

    // Called by Tauri after the WebView is ready. Make the WebView background
    // transparent so the MPVView below shows through.
    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        activity.runOnUiThread {
            webView.setBackgroundColor(Color.TRANSPARENT)
        }
    }

    @Command
    fun mpvCreate(invoke: Invoke) {
        val args = invoke.parseArgs(MpvCreateArgs::class.java)
        activity.runOnUiThread {
            try {
                val view = MPVView(activity, null)
                view.id = ViewCompat.generateViewId()

                // Always MATCH_PARENT — MPV handles aspect ratio internally.
                // CSS pixel values from window.innerWidth are logical dp and would
                // under-size the view on high-density screens if used directly as px.
                val params = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )

                // Insert MPV view BELOW the WebView so video shows through transparent WebView bg
                val rootView = activity.window.decorView.rootView as? ViewGroup
                rootView?.addView(view, 0, params)

                MPVLib.create(activity)
                MPVLib.setOptionString("vo", "gpu")
                MPVLib.setOptionString("hwdec", "mediacodec-copy")
                MPVLib.setOptionString("keep-open", "yes")
                view.attachToWindow()

                players[args.playerId] = view
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Failed to create MPV player")
            }
        }
    }

    @Command
    fun mpvLoadUrl(invoke: Invoke) {
        val args = invoke.parseArgs(MpvUrlArgs::class.java)
        val view = players[args.playerId]
        if (view == null) {
            invoke.reject("Player not found: ${args.playerId}")
            return
        }
        activity.runOnUiThread {
            MPVLib.command(arrayOf("loadfile", args.url, "replace"))
            invoke.resolve()
        }
    }

    @Command
    fun mpvPause(invoke: Invoke) {
        val args = invoke.parseArgs(MpvIdArgs::class.java)
        players[args.playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            MPVLib.setPropertyBoolean("pause", true)
            invoke.resolve()
        }
    }

    @Command
    fun mpvResume(invoke: Invoke) {
        val args = invoke.parseArgs(MpvIdArgs::class.java)
        players[args.playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            MPVLib.setPropertyBoolean("pause", false)
            invoke.resolve()
        }
    }

    @Command
    fun mpvSetVolume(invoke: Invoke) {
        val args = invoke.parseArgs(MpvVolumeArgs::class.java)
        players[args.playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.setPropertyInt("volume", args.volume.coerceIn(0, 100))
        invoke.resolve()
    }

    @Command
    fun mpvSeek(invoke: Invoke) {
        val args = invoke.parseArgs(MpvSeekArgs::class.java)
        players[args.playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.command(arrayOf("seek", args.position.toString(), "absolute"))
        invoke.resolve()
    }

    @Command
    fun mpvResize(invoke: Invoke) {
        val args = invoke.parseArgs(MpvResizeArgs::class.java)
        val view = players[args.playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            // Always MATCH_PARENT — the player is always full-screen on Android.
            val params = view.layoutParams as? FrameLayout.LayoutParams
                ?: FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            params.width = ViewGroup.LayoutParams.MATCH_PARENT
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            view.layoutParams = params
            invoke.resolve()
        }
    }

    @Command
    fun playerGetProperties(invoke: Invoke) {
        val args = invoke.parseArgs(MpvIdArgs::class.java)
        players[args.playerId] ?: run {
            val obj = JSObject()
            obj.put("duration", 0.0)
            obj.put("position", 0.0)
            obj.put("paused", true)
            obj.put("volume", 100.0)
            obj.put("idle", true)
            invoke.resolve(obj)
            return
        }
        val obj = JSObject()
        obj.put("duration", MPVLib.getPropertyDouble("duration") ?: 0.0)
        obj.put("position", MPVLib.getPropertyDouble("time-pos") ?: 0.0)
        obj.put("paused", MPVLib.getPropertyBoolean("pause") ?: true)
        obj.put("volume", MPVLib.getPropertyInt("volume") ?: 100)
        obj.put("idle", false)
        invoke.resolve(obj)
    }

    @Command
    fun mpvDestroy(invoke: Invoke) {
        val args = invoke.parseArgs(MpvIdArgs::class.java)
        val view = players.remove(args.playerId)
        activity.runOnUiThread {
            view?.let { v ->
                (v.parent as? ViewGroup)?.removeView(v)
            }
            if (players.isEmpty()) {
                MPVLib.destroy()
            }
            invoke.resolve()
        }
    }

    // ── Arg classes ────────────────────────────────────────────────────────

    data class MpvCreateArgs(
        val playerId: String = "",
        val x: Int = 0, val y: Int = 0,
        val width: Int = 0, val height: Int = 0,
        val live: Boolean = false,
    )
    data class MpvIdArgs(val playerId: String = "")
    data class MpvUrlArgs(val playerId: String = "", val url: String = "")
    data class MpvVolumeArgs(val playerId: String = "", val volume: Int = 100)
    data class MpvSeekArgs(val playerId: String = "", val position: Double = 0.0)
    data class MpvResizeArgs(
        val playerId: String = "",
        val x: Int = 0, val y: Int = 0,
        val width: Int = 0, val height: Int = 0,
    )
}
