// Health.kt — the watch's own daily numbers, sent to the planner: today's steps and a resting heart rate. Health Services
// delivers them in the background (PassiveListenerService) a few times an hour, even with the app closed. They're kept on
// the watch and saved in the doc 'health' / <calendar date> { steps, restingHr, updatedAt, from: 'watch' }, which the
// assistant reads (src/planner/lib/lifeContext.ts). Steps reset at midnight, so the key is the calendar date.
//
// Resting heart rate here = the lowest average of 10 readings in a row that day: a stand-in for the watch's own figure,
// which Samsung doesn't share with other apps. Sleep isn't available to other apps on the watch at all.
package app.propertystars.planner.watch

import android.content.Context
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerService
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Health {
    const val STEP_GOAL = 10_000

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("health", Context.MODE_PRIVATE)
    fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /** Start (or keep) receiving steps and heart rate in the background. Safe to call every time the app opens. */
    fun register(ctx: Context, withHeart: Boolean) {
        val types = if (withHeart) setOf(DataType.STEPS_DAILY, DataType.HEART_RATE_BPM) else setOf(DataType.STEPS_DAILY)
        val config = PassiveListenerConfig.builder().setDataTypes(types).build()
        try {
            HealthServices.getClient(ctx.applicationContext).passiveMonitoringClient
                .setPassiveListenerServiceAsync(HealthListener::class.java, config)
        } catch (_: Exception) { /* no sensor permission yet: asked for when the app opens */ }
    }

    fun stepsToday(ctx: Context): Int {
        val p = prefs(ctx)
        return if (p.getString("day", "") == today()) p.getInt("steps", 0) else 0
    }

    fun restingToday(ctx: Context): Int? {
        val p = prefs(ctx)
        val r = p.getInt("rest", 0)
        return if (p.getString("day", "") == today() && r > 0) r else null
    }

    /** New readings from the sensor. */
    fun record(ctx: Context, steps: Long?, bpm: List<Double>) {
        val p = prefs(ctx)
        val day = today()
        val e = p.edit()
        if (p.getString("day", "") != day) {
            e.putString("day", day).putInt("steps", 0).putInt("rest", 0).putString("window", "")
        }
        if (steps != null && steps >= 0) e.putInt("steps", steps.toInt())
        if (bpm.isNotEmpty()) {
            val sameDay = p.getString("day", "") == day
            val window = (if (sameDay) p.getString("window", "") ?: "" else "").split(',').mapNotNull { it.toIntOrNull() }.toMutableList()
            var rest = if (sameDay) p.getInt("rest", 0) else 0
            for (b in bpm) {
                val v = b.toInt()
                if (v < 35 || v > 200) continue
                window += v
                if (window.size > 10) window.removeAt(0)
                if (window.size == 10) {
                    val avg = window.average().toInt()
                    if (rest == 0 || avg < rest) rest = avg
                }
            }
            e.putString("window", window.joinToString(",")).putInt("rest", rest)
        }
        e.apply()
    }

    /** Save today's numbers to the planner, at most every 15 minutes unless steps moved a lot. */
    suspend fun upload(ctx: Context, force: Boolean = false) {
        val planner = Planner(ctx)
        if (!planner.signedIn) return
        val p = prefs(ctx)
        val steps = stepsToday(ctx)
        val rest = restingToday(ctx)
        val last = p.getLong("sentAt", 0)
        val lastSteps = p.getInt("sentSteps", -1)
        val sentDay = p.getString("sentDay", "")
        if (!force && sentDay == today() && System.currentTimeMillis() - last < 15 * 60_000 && steps - lastSteps < 500) return
        if (steps == 0 && rest == null) return
        val day = today()
        val d = planner.doc("health", day) ?: JSONObject()
        d.put("steps", steps).put("updatedAt", Planner.isoNow()).put("from", "watch")
        if (rest != null) d.put("restingHr", rest)
        planner.put("health", day, d)
        p.edit().putLong("sentAt", System.currentTimeMillis()).putInt("sentSteps", steps).putString("sentDay", day).apply()
    }
}

/** Health Services calls this with new steps and heart rate, even when the app isn't open. */
class HealthListener : PassiveListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
        val steps = dataPoints.getData(DataType.STEPS_DAILY).lastOrNull()?.value
        val bpm = dataPoints.getData(DataType.HEART_RATE_BPM).map { it.value }
        Health.record(this, steps, bpm)
        Spots.refresh(this)
        scope.launch { try { Health.upload(this@HealthListener) } catch (_: Exception) { } }
    }
}
