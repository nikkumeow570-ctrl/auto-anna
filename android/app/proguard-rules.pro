# The app is small. Keep our own code exactly as written (the JavaScript bridge and the notification listener
# are called by name), and let R8 shrink only the libraries.
-keep class app.autoanna.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keepattributes *Annotation*
