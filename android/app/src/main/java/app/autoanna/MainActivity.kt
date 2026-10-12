package app.autoanna

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingStart = false
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // Open WhatsApp, UPI apps and other links outside the WebView.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (e: Exception) { /* no app can open it */ }
                return true
            }
        }
        // Lets the page ask for the phone location (used by the fare estimate).
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false)
                } else {
                    geoCallback = callback
                    geoOrigin = origin
                    requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        REQ_GEO
                    )
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        moveTaskToBack(true)   // keep the app (and any running trip) alive
    }

    // ---- trip ----
    private fun beginTrip() {
        TripState.reset()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            startTripService()
            askNotificationPermission()
        } else {
            pendingStart = true
            val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
            requestPermissions(perms.toTypedArray(), REQ_LOCATION)
        }
    }

    private fun startTripService() {
        TripState.active = true
        TripState.start = System.currentTimeMillis()
        startForegroundService(Intent(this, TripService::class.java))
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (code == REQ_GEO) {
            val granted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            geoCallback?.invoke(geoOrigin ?: "", granted, false)
            geoCallback = null; geoOrigin = null
            return
        }
        if (code != REQ_LOCATION || !pendingStart) return
        pendingStart = false
        val ok = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (ok) startTripService() else TripState.denied = true
    }

    // ---- bridge used by the web page ----
    inner class Bridge {
        @JavascriptInterface fun isNative(): Boolean = true

        @JavascriptInterface fun startTrip() { runOnUiThread { beginTrip() } }
        @JavascriptInterface fun getTrip(): String = TripState.json()
        @JavascriptInterface fun endTrip(): String {
            val j = TripState.json()
            stopService(Intent(this@MainActivity, TripService::class.java))
            TripState.reset()
            return j
        }

        @JavascriptInterface fun isListenerOn(): Boolean =
            Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
                ?.contains(packageName) == true

        @JavascriptInterface fun openListenerSettings() {
            runOnUiThread { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }

        @JavascriptInterface fun openBatterySettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                } catch (e: Exception) {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
            }
        }

        @JavascriptInterface fun isSoundOn(): Boolean = Store.soundOn(this@MainActivity)
        @JavascriptInterface fun setSoundOn(on: Boolean) = Store.setSoundOn(this@MainActivity, on)
        @JavascriptInterface fun setLang(l: String) = Store.setLang(this@MainActivity, if (l == "ta") "ta" else "en")
        @JavascriptInterface fun testSpeak() = Speaker.announce(this@MainActivity, "500")
        @JavascriptInterface fun getPayments(): String = Store.paymentsJson(this@MainActivity)
        @JavascriptInterface fun speak(ta: String, en: String) = Speaker.say(this@MainActivity, ta, en)
    }

    companion object {
        private const val REQ_LOCATION = 1
        private const val REQ_NOTIF = 2
        private const val REQ_GEO = 3
    }
}
