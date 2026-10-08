package app.autoanna

import android.content.ComponentName
import android.app.Notification
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Soundbox: listens to notifications from UPI apps on this phone only.
 * When one says money was received, it speaks the amount and saves the amount (not names or numbers).
 */
class PaymentListener : NotificationListenerService() {

    private val recent = HashMap<String, Long>()

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val label = APPS[sbn.packageName] ?: return
        if (!Store.soundOn(this)) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

        val ex = n.extras ?: return
        val text = listOfNotNull(
            ex.getCharSequence(Notification.EXTRA_TITLE),
            ex.getCharSequence(Notification.EXTRA_TEXT),
            ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
        ).joinToString(" ")

        val amount = Parser.incomingAmount(text) ?: return

        // The same alert is often posted twice. Ignore repeats within 60 seconds.
        val key = "${sbn.packageName}|$amount"
        val now = SystemClock.elapsedRealtime()
        val prev = recent[key]
        if (prev != null && now - prev < 60_000) return
        recent[key] = now

        Store.addPayment(this, amount, label)
        Speaker.announce(this, amount)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        requestRebind(ComponentName(this, PaymentListener::class.java))
    }

    companion object {
        val APPS = mapOf(
            "com.google.android.apps.nbu.paisa.user" to "GPay",
            "com.phonepe.app" to "PhonePe",
            "net.one97.paytm" to "Paytm",
            "in.org.npci.upiapp" to "BHIM"
        )
    }
}

/** Reads English notification text. Only "money in" messages are accepted. */
object Parser {
    private val amountRe = Regex("""(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)
    private val inRe = Regex("""received|credited|paid you|sent you|payment from""", RegexOption.IGNORE_CASE)
    private val outRe = Regex(
        """request|you paid|you sent|paid to|sent to|debited|failed|declined|reminder|cashback|reward|offer""",
        RegexOption.IGNORE_CASE
    )

    fun incomingAmount(text: String): String? {
        if (!inRe.containsMatchIn(text) || outRe.containsMatchIn(text)) return null
        val raw = amountRe.find(text)?.groupValues?.get(1)?.replace(",", "") ?: return null
        val v = raw.toDoubleOrNull() ?: return null
        if (v <= 0.0 || v > 1_000_000.0) return null
        return if (v % 1.0 == 0.0) v.toLong().toString() else String.format("%.2f", v)
    }
}
