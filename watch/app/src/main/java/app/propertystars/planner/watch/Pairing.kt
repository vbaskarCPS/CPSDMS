// Pairing.kt — connecting the watch to someone's planner without typing a PIN on it. The watch keeps a long random
// secret, asks for a 4-digit code and shows it; the person types the code in Settings › Watch on their phone; the watch
// asks every few seconds whether that has happened and then collects a pass of its own
// (supabase/migrations/20261251900000_planner_watch.sql).
package app.propertystars.planner.watch

import org.json.JSONObject
import java.security.SecureRandom

sealed class PairState {
    object Starting : PairState()
    data class Showing(val code: String, val expiresAtMillis: Long) : PairState()
    object Done : PairState()
    data class Problem(val message: String) : PairState()
}

class Pairing(private val planner: Planner) {
    private fun newSecret(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private var expiresAt = 0L

    /** Ask for a code (a fresh secret each time a code has run out or been used). */
    suspend fun start(): PairState {
        var secret = planner.kept("secret") ?: newSecret().also { planner.keep("secret", it) }
        var r = Api.rpc("planner_watch_start", JSONObject().put("p_secret", secret))
        if (!r.optBoolean("ok") && r.optString("reason") == "used") {
            secret = newSecret().also { planner.keep("secret", it) }
            r = Api.rpc("planner_watch_start", JSONObject().put("p_secret", secret))
        }
        if (!r.optBoolean("ok")) return PairState.Problem("Couldn't get a code. Try again.")
        expiresAt = System.currentTimeMillis() + 5 * 60_000L
        return PairState.Showing(r.optString("code"), expiresAt)
    }

    /** Has the phone taken the code? Done = the watch is signed in. null = still waiting. */
    suspend fun poll(): PairState? {
        val secret = planner.kept("secret") ?: return PairState.Problem("Start again.")
        val r = Api.rpc("planner_watch_poll", JSONObject().put("p_secret", secret))
        if (r.optBoolean("ok") && r.has("token")) {
            planner.saveUser(r.getString("token"), r.optJSONObject("user") ?: JSONObject())
            planner.keep("secret", null)
            return PairState.Done
        }
        if (r.optBoolean("ok")) return null
        return when (r.optString("reason")) {
            "expired" -> start()
            "used", "unknown" -> { planner.keep("secret", null); start() }
            else -> null
        }
    }
}
