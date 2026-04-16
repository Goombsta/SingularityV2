package com.singularity.app

import android.graphics.Color
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import `is`.xyz.mpv.MPVLib
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

@TauriPlugin
class MpvPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    // Wraps a SurfaceView and handles the Surface lifecycle for libmpv.
    // Using a plain SurfaceView + MPVLib directly avoids the need to vendor
    // MPVView's complex preference/options wiring from the mpv-android app.
    private inner class PlayerSurface(val surfaceView: SurfaceView) : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            MPVLib.attachSurface(holder.surface)
            MPVLib.setOptionString("force-window", "yes")
            MPVLib.setOptionString("vo", "gpu")
        }
        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            // mpv handles aspect ratio internally
        }
        override fun surfaceDestroyed(holder: SurfaceHolder) {
            MPVLib.detachSurface()
        }
    }

    private val players = mutableMapOf<String, PlayerSurface>()

    // Make the WebView background transparent so the MPV SurfaceView below shows through.
    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        activity.runOnUiThread {
            webView.setBackgroundColor(Color.TRANSPARENT)
        }
    }

    @Command
    fun mpvCreate(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        activity.runOnUiThread {
            var surfaceView: SurfaceView? = null
            try {
                surfaceView = SurfaceView(activity)
                surfaceView.id = android.view.View.generateViewId()

                // Always MATCH_PARENT — MPV handles aspect ratio internally.
                val params = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )

                // Insert MPV surface BELOW the WebView so video shows through transparent bg.
                val rootView = activity.window.decorView.rootView as? ViewGroup
                rootView?.addView(surfaceView, 0, params)

                MPVLib.create(activity)
                MPVLib.setOptionString("vo", "gpu")
                MPVLib.setOptionString("hwdec", "mediacodec-copy")
                MPVLib.setOptionString("keep-open", "yes")
                MPVLib.init()

                val ps = PlayerSurface(surfaceView)
                surfaceView.holder.addCallback(ps)

                players[playerId] = ps
                invoke.resolve()
            } catch (e: Throwable) {
                // Remove the SurfaceView from the hierarchy if it was added before the failure,
                // otherwise it leaks and occludes the WebView (grey screen visible through
                // the transparent WebView background).
                surfaceView?.let { sv ->
                    (sv.parent as? ViewGroup)?.removeView(sv)
                }
                invoke.reject(e.message ?: "Failed to create MPV player")
            }
        }
    }

    @Command
    fun mpvLoadUrl(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val url = args.getString("url")
        if (players[playerId] == null) {
            invoke.reject("Player not found: $playerId")
            return
        }
        activity.runOnUiThread {
            MPVLib.command(arrayOf("loadfile", url, "replace"))
            invoke.resolve()
        }
    }

    @Command
    fun mpvPause(invoke: Invoke) {
        val playerId = invoke.getArgs().getString("playerId")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            MPVLib.setPropertyBoolean("pause", true)
            invoke.resolve()
        }
    }

    @Command
    fun mpvResume(invoke: Invoke) {
        val playerId = invoke.getArgs().getString("playerId")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            MPVLib.setPropertyBoolean("pause", false)
            invoke.resolve()
        }
    }

    @Command
    fun mpvSetVolume(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val volume = args.getInt("volume")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.setPropertyInt("volume", volume.coerceIn(0, 100))
        invoke.resolve()
    }

    @Command
    fun mpvSeek(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val position = args.getDouble("position")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.command(arrayOf("seek", position.toString(), "absolute"))
        invoke.resolve()
    }

    @Command
    fun mpvResize(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val ps = players[playerId] ?: run { invoke.reject("Player not found"); return }
        activity.runOnUiThread {
            // Always MATCH_PARENT — the player is always full-screen on Android.
            val params = ps.surfaceView.layoutParams as? FrameLayout.LayoutParams
                ?: FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            params.width = ViewGroup.LayoutParams.MATCH_PARENT
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            ps.surfaceView.layoutParams = params
            invoke.resolve()
        }
    }

    @Command
    fun playerGetProperties(invoke: Invoke) {
        val playerId = invoke.getArgs().getString("playerId")
        if (players[playerId] == null) {
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
    fun mpvGetTracks(invoke: Invoke) {
        val playerId = invoke.getArgs().getString("playerId")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        val trackListJson = MPVLib.getPropertyString("track-list") ?: "[]"
        val arr = JSONArray(trackListJson)
        val audio = JSArray()
        val subs = JSArray()
        for (i in 0 until arr.length()) {
            val t = arr.getJSONObject(i)
            val track = JSObject()
            track.put("id", t.optInt("id"))
            track.put("title", t.optString("title", ""))
            track.put("lang", t.optString("lang", ""))
            track.put("selected", t.optBoolean("selected", false))
            when (t.optString("type")) {
                "audio" -> audio.put(track)
                "sub"   -> subs.put(track)
            }
        }
        val result = JSObject()
        result.put("audio", audio)
        result.put("sub", subs)
        invoke.resolve(result)
    }

    @Command
    fun mpvSetAudioTrack(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val trackId = args.getInt("trackId")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.setPropertyInt("aid", trackId)
        invoke.resolve()
    }

    @Command
    fun mpvSetSubTrack(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val trackId = args.getInt("trackId")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.setPropertyInt("sid", trackId)
        invoke.resolve()
    }

    @Command
    fun mpvSetSubScale(invoke: Invoke) {
        val args = invoke.getArgs()
        val playerId = args.getString("playerId")
        val scale = args.getDouble("scale")
        players[playerId] ?: run { invoke.reject("Player not found"); return }
        MPVLib.setPropertyDouble("sub-scale", scale)
        invoke.resolve()
    }

    @Command
    fun mpvDestroy(invoke: Invoke) {
        val playerId = invoke.getArgs().getString("playerId")
        val ps = players.remove(playerId)
        activity.runOnUiThread {
            ps?.let { p ->
                p.surfaceView.holder.removeCallback(p)
                (p.surfaceView.parent as? ViewGroup)?.removeView(p.surfaceView)
            }
            if (players.isEmpty()) {
                MPVLib.destroy()
            }
            invoke.resolve()
        }
    }
}
