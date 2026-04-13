package com.singularity.app

import android.graphics.Color
import android.net.Uri
import android.widget.FrameLayout
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

// Android native video player using libVLC.
// Implements the same command interface as the Windows Rust MPV player so
// PlayerScreen.tsx can route commands transparently (plugin:vlc|mpv_create, etc.).
// The VLCVideoLayout sits below the transparent Tauri WebView — UI controls remain
// in the WebView layer on top.

@TauriPlugin
class VlcPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    private data class Session(
        val libVLC: LibVLC,
        val player: MediaPlayer,
        val layout: VLCVideoLayout
    )

    private val sessions = mutableMapOf<String, Session>()

    // Called by Tauri after the WebView is ready — make it transparent so the
    // native video layer below shows through.
    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        activity.runOnUiThread {
            webView.setBackgroundColor(Color.TRANSPARENT)
        }
    }

    @Command
    fun mpvCreate(invoke: Invoke) {
        val args = invoke.parseArgs(CreateArgs::class.java)
        activity.runOnUiThread {
            try {
                val libVLC = LibVLC(activity, arrayListOf(
                    "--network-caching=3000",
                    "--file-caching=3000",
                    "--live-caching=3000",
                    "--no-drop-late-frames",
                    "--no-skip-frames",
                    "--rtsp-tcp"
                ))

                val player = MediaPlayer(libVLC)
                val layout = VLCVideoLayout(activity)

                // Insert video layout at z-index 0 (below the WebView)
                val contentFrame = activity.findViewById<FrameLayout>(android.R.id.content)
                val params = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
                contentFrame?.addView(layout, 0, params)

                // Attach VLC renderer to the surface — SurfaceView mode (textureView=false)
                player.attachViews(layout, null, false, false)

                sessions[args.playerId] = Session(libVLC, player, layout)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "VLC create failed")
            }
        }
    }

    @Command
    fun mpvLoadUrl(invoke: Invoke) {
        val args = invoke.parseArgs(LoadUrlArgs::class.java)
        val session = sessions[args.playerId] ?: return invoke.reject("Player not found")
        activity.runOnUiThread {
            try {
                val media = Media(session.libVLC, Uri.parse(args.url))
                media.addOption(":network-caching=3000")
                session.player.media = media
                media.release()
                session.player.play()
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Load URL failed")
            }
        }
    }

    @Command
    fun mpvPause(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerIdArgs::class.java)
        activity.runOnUiThread { sessions[args.playerId]?.player?.pause() }
        invoke.resolve()
    }

    @Command
    fun mpvResume(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerIdArgs::class.java)
        activity.runOnUiThread { sessions[args.playerId]?.player?.play() }
        invoke.resolve()
    }

    @Command
    fun mpvSeek(invoke: Invoke) {
        val args = invoke.parseArgs(SeekArgs::class.java)
        activity.runOnUiThread {
            sessions[args.playerId]?.player?.let { p ->
                val dur = p.length
                if (dur > 0) p.time = (args.position * 1000).toLong()
            }
        }
        invoke.resolve()
    }

    @Command
    fun mpvSetVolume(invoke: Invoke) {
        val args = invoke.parseArgs(VolumeArgs::class.java)
        activity.runOnUiThread {
            sessions[args.playerId]?.player?.volume = args.volume.toInt().coerceIn(0, 200)
        }
        invoke.resolve()
    }

    @Command
    fun playerGetProperties(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerIdArgs::class.java)
        val player = sessions[args.playerId]?.player
        val pos = maxOf(0L, player?.time ?: 0L)
        val dur = maxOf(0L, player?.length ?: 0L)
        val playing = player?.isPlaying ?: false

        val result = JSObject()
        result.put("position", pos / 1000.0)
        result.put("duration", dur / 1000.0)
        result.put("paused", !playing)
        result.put("volume", (player?.volume ?: 100).toDouble())
        result.put("idle", player == null || (!playing && pos == 0L && dur == 0L))
        invoke.resolve(result)
    }

    @Command
    fun mpvDestroy(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerIdArgs::class.java)
        val session = sessions.remove(args.playerId) ?: return invoke.resolve()
        activity.runOnUiThread {
            try {
                session.player.stop()
                session.player.detachViews()
                session.player.release()
                session.libVLC.release()
                val contentFrame = activity.findViewById<FrameLayout>(android.R.id.content)
                contentFrame?.removeView(session.layout)
            } catch (_: Exception) { /* always clean up */ }
            invoke.resolve()
        }
    }

    @Command
    fun mpvResize(invoke: Invoke) {
        // VLC fills MATCH_PARENT automatically — no manual resize needed
        invoke.resolve()
    }

    // ── Arg data classes ─────────────────────────────────────────────────────
    data class CreateArgs(
        val playerId: String = "", val live: Boolean = false,
        val x: Int = 0, val y: Int = 0, val width: Int = 0, val height: Int = 0
    )
    data class LoadUrlArgs(val playerId: String = "", val url: String = "")
    data class PlayerIdArgs(val playerId: String = "")
    data class SeekArgs(val playerId: String = "", val position: Double = 0.0)
    data class VolumeArgs(val playerId: String = "", val volume: Double = 100.0)
}
