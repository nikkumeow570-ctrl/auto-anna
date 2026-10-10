package app.autoanna

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Small on-device storage: voice setting, language, and the last 100 payment alerts (amount only). */
object Store {
    private fun p(c: Context) = c.applicationContext.getSharedPreferences("autoanna", Context.MODE_PRIVATE)

    fun soundOn(c: Context): Boolean = p(c).getBoolean("sound", true)
    fun setSoundOn(c: Context, v: Boolean) = p(c).edit().putBoolean("sound", v).apply()

    fun lang(c: Context): String = p(c).getString("lang", "ta") ?: "ta"
    fun setLang(c: Context, v: String) = p(c).edit().putString("lang", v).apply()

    @Synchronized
    fun addPayment(c: Context, amount: String, app: String) {
        val old = JSONArray(p(c).getString("pay", "[]"))
        val list = JSONArray()
        val start = maxOf(0, old.length() - 99)
        for (i in start until old.length()) list.put(old.get(i))
        list.put(
            JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("amt", amount.toDouble())
                .put("app", app)
        )
        p(c).edit().putString("pay", list.toString()).apply()
    }

    fun paymentsJson(c: Context): String = p(c).getString("pay", "[]") ?: "[]"
}
