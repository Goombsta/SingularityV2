package com.singularity.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    this.registerPlugin(VlcPlugin::class.java)
    this.registerPlugin(UpdaterPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
