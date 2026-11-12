// Planner.kt — the watch's connection to the planner: the same database functions the phone uses (planner_get,
// planner_put …), called with the watch's own pass. The pass comes from pairing (Pairing.kt) and is kept in this app's
// private storage. Docs are JSON: kept as org.json objects so fields the watch doesn't know about are written back
// untouched.
package app.propertystars.planner.watch

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class SignedOut : Exception("Signed out")

/** One planner document. */
data class Doc(val key: String, val data: JSONObject)

/** A call to one of the database's functions (POST /rest/v1/rpc/<name>). */
object Api {
    suspend fun rpc(fn: String, args: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val c = URL("${BuildConfig.SUPABASE_URL}/rest/v1/rpc/$fn").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15_000
            c.readTimeout = 20_000
            c.doOutput = true
            c.setRequestProperty("apikey", BuildConfig.SUPABASE_KEY)
            c.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_KEY}")
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(args.toString().toByteArray()) }
            val code = c.responseCode
            val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IOException("The planner answered $code")
            JSONObject(body)
        } finally {
            c.disconnect()
        }
    }
}

class Planner(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("planner", Context.MODE_PRIVATE)

    val token: String? get() = prefs.getString("token", null)
    val signedIn: Boolean get() = token != null
    /** "lb" or "kg": the units the person's weights are kept in (their planner setting). */
    val units: String get() = prefs.getString("units", "lb") ?: "lb"
    /** 'night' (the 5 am club) or 'morning'. */
    val profile: String get() = prefs.getString("profile", "night") ?: "night"

    fun saveUser(token: String, user: JSONObject) {
        val settings = user.optJSONObject("settings") ?: JSONObject()
        prefs.edit()
            .putString("token", token)
            .putString("units", if (settings.optString("units") == "kg") "kg" else "lb")
            .putString("profile", if (settings.optString("profile") == "morning") "morning" else "night")
            .putString("name", user.optString("display_name"))
            .apply()
    }

    fun signOut() {
        prefs.edit().remove("token").remove("secret").apply()
    }

    /** Something kept on the watch between opens (the Today summary for the tile, the pairing secret). */
    fun keep(key: String, value: String?) { prefs.edit().putString(key, value).apply() }
    fun kept(key: String): String? = prefs.getString(key, null)

    /** Call a planner function with the watch's pass. A pass the server no longer knows signs the watch out. */
    suspend fun call(fn: String, args: JSONObject = JSONObject()): JSONObject {
        val t = token ?: throw SignedOut()
        args.put("p_token", t)
        val r = Api.rpc(fn, args)
        if (!r.optBoolean("ok") && r.optString("reason") == "signed_out") {
            signOut()
            throw SignedOut()
        }
        return r
    }

    /** The docs of one kind, between two keys (both included). */
    suspend fun docs(kind: String, from: String? = null, to: String? = null): List<Doc> {
        val args = JSONObject().put("p_kind", kind).put("p_from", from ?: JSONObject.NULL).put("p_to", to ?: JSONObject.NULL)
        val r = call("planner_get", args)
        val list = r.optJSONArray("docs") ?: JSONArray()
        return (0 until list.length()).mapNotNull { i ->
            val d = list.optJSONObject(i) ?: return@mapNotNull null
            val data = d.optJSONObject("data") ?: return@mapNotNull null
            Doc(d.optString("key"), data)
        }
    }

    /** Docs keyed by a day and an id ('2026-11-12~abc'), for one day. Ends at the next day's bare date (see docs.ts). */
    suspend fun dayDocs(kind: String, day: String): List<Doc> =
        docs(kind, day, dayAfter(day)).filter { it.key.startsWith("$day~") || it.key == day }

    suspend fun doc(kind: String, key: String): JSONObject? = docs(kind, key, key).firstOrNull()?.data

    suspend fun put(kind: String, key: String, data: JSONObject) {
        val r = call("planner_put", JSONObject().put("p_kind", kind).put("p_key", key).put("p_data", data))
        if (!r.optBoolean("ok")) throw IOException(r.optString("reason", "Couldn't save"))
    }

    companion object {
        /** The planner's day starts at 4 am: a 1 am set still belongs to the day that's ending (docs.ts dayKey). */
        fun dayKey(now: Date = Date()): String {
            val c = Calendar.getInstance().apply { time = now; add(Calendar.HOUR_OF_DAY, -4) }
            return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.time)
        }

        fun dayAfter(day: String): String {
            val f = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val c = Calendar.getInstance().apply { time = f.parse(day)!!; add(Calendar.DAY_OF_MONTH, 1) }
            return f.format(c.time)
        }

        /** Day of the week of a day key: 0 = Sunday … 6 = Saturday (as the planner's habits count them). */
        fun weekday(day: String): Int {
            val c = Calendar.getInstance().apply { time = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day)!! }
            return c.get(Calendar.DAY_OF_WEEK) - 1
        }

        fun isoNow(): String {
            val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
            return f.format(Date())
        }

        fun hhmmNow(): String = SimpleDateFormat("HH:mm", Locale.US).format(Date())
    }
}
