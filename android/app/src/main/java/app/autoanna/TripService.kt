package app.autoanna

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import kotlin.math.max

/**
 * Foreground service that keeps GPS running during a trip, even when the screen is off or
 * the driver switches apps. Same filtering rules as the web version.
 */
class TripService : Service(), LocationListener {

    private lateinit var lm: LocationManager
    private var lastText = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        lm = getSystemService(LOCATION_SERVICE) as LocationManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.trip_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val n = buildNotification("0.00 km")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, n)
        }
        TripState.gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, this, Looper.getMainLooper())
        } catch (e: SecurityException) {
            TripState.denied = true
            TripState.active = false
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onLocationChanged(l: Location) {
        val acc = if (l.hasAccuracy()) l.accuracy else 99f
        TripState.acc = acc
        if (acc > 30f) return                                   // ignore weak fixes
        TripState.lat = l.latitude; TripState.lon = l.longitude; TripState.hasFix = true

        val last = TripState.lastLoc
        if (last == null) {
            TripState.lastLoc = l; TripState.lastTs = l.time
            return
        }
        val d = last.distanceTo(l).toDouble()
        val dt = (l.time - TripState.lastTs) / 1000.0
        if (dt <= 0) return

        if (d / dt > 45) {                                      // GPS jump (over 160 km/h): skip
            TripState.lastLoc = l; TripState.lastTs = l.time
            return
        }
        if (d < max(8.0, acc * 0.5)) {                          // stopped: count waiting, ignore drift
            TripState.waitSec += dt
            TripState.lastTs = l.time
            return
        }
        TripState.distM += d
        TripState.lastLoc = l
        TripState.lastTs = l.time

        val text = String.format("%.2f km", TripState.distM / 1000.0)
        if (text != lastText) {
            lastText = text
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, buildNotification(text))
        }
    }

    // Required on Android 8 to 10, where these were not default methods.
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) { TripState.gpsOn = true }
    override fun onProviderDisabled(provider: String) { TripState.gpsOn = false }

    override fun onDestroy() {
        try { lm.removeUpdates(this) } catch (e: Exception) {}
        TripState.active = false
        super.onDestroy()
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.trip_running))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val CHANNEL = "trip"
        private const val NOTIF_ID = 1
    }
}
