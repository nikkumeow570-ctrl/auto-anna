package app.autoanna

import android.location.Location
import org.json.JSONObject

/** Trip numbers shared between the GPS service and the web page (same process). */
object TripState {
    @Volatile var active = false
    @Volatile var denied = false
    @Volatile var gpsOn = true
    @Volatile var distM = 0.0
    @Volatile var waitSec = 0.0
    @Volatile var acc = -1f
    @Volatile var start = 0L
    @Volatile var lastLoc: Location? = null
    @Volatile var lastTs = 0L
    @Volatile var hasFix = false
    @Volatile var lat = 0.0
    @Volatile var lon = 0.0

    fun reset() {
        active = false; denied = false; gpsOn = true
        distM = 0.0; waitSec = 0.0; acc = -1f; start = 0L
        lastLoc = null; lastTs = 0L
        hasFix = false; lat = 0.0; lon = 0.0
    }

    fun json(): String {
        val o = JSONObject()
            .put("active", active)
            .put("denied", denied)
            .put("gpsOn", gpsOn)
            .put("km", distM / 1000.0)
            .put("waitSec", waitSec)
            .put("acc", acc.toDouble())
            .put("start", start)
            .put("hasFix", hasFix)
        if (hasFix) o.put("lat", lat).put("lon", lon)
        return o.toString()
    }
}
