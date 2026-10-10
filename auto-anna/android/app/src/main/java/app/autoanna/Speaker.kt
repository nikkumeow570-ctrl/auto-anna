package app.autoanna

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Speaks in Tamil (default) or English. Falls back to English if Tamil voice data is missing. */
object Speaker {
    private val lock = Any()
    private var tts: TextToSpeech? = null
    private var ready = false
    private data class Line(val ta: String, val en: String, val lang: String)
    private val pending = mutableListOf<Line>()

    /** Money received alert. */
    fun announce(ctx: Context, amount: String) =
        say(ctx, "$amount ரூபா வந்துச்சு", "Rupees $amount received")

    /** Speak any line, with a Tamil and an English version. The saved language decides which is used. */
    fun say(ctx: Context, ta: String, en: String) {
        val app = ctx.applicationContext
        val lang = Store.lang(app)
        synchronized(lock) {
            pending.add(Line(ta, en, lang))
            if (tts == null) {
                tts = TextToSpeech(app) { status ->
                    synchronized(lock) {
                        ready = status == TextToSpeech.SUCCESS
                        if (ready) {
                            tts?.setAudioAttributes(
                                AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build()
                            )
                            flush()
                        } else {
                            pending.clear()
                        }
                    }
                }
            } else if (ready) {
                flush()
            }
        }
    }

    private fun flush() {
        val engine = tts ?: return
        while (pending.isNotEmpty()) {
            val line = pending.removeAt(0)
            var text = line.en
            var locale = Locale("en", "IN")
            if (line.lang == "ta") {
                val r = engine.isLanguageAvailable(Locale("ta", "IN"))
                if (r >= TextToSpeech.LANG_AVAILABLE) {
                    locale = Locale("ta", "IN")
                    text = line.ta
                }
            }
            engine.language = locale
            engine.speak(text, TextToSpeech.QUEUE_ADD, null, "say-" + System.nanoTime())
        }
    }
}
