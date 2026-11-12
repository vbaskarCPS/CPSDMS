// Workout.kt — the session that's on today (started on the phone: Training › Start workout), one set at a time.
// The session is the phone's own doc ('workout' / <date>~<id>); the watch marks sets done in it exactly as the phone's
// live screen does (weight, reps, done, doneAt) and adds the heart rate it measured ("hr": { avg, max }), so the phone
// shows the set at once and finishes the session as usual (Complete workout, the coach's review).
package app.propertystars.planner.watch

import org.json.JSONObject

/** The next set to do. weight and reps start at what the phone filled in (last time's numbers, or the coach's). */
data class NextSet(
    val workoutKey: String,
    val exerciseIndex: Int,
    val setIndex: Int,
    val exercise: String,
    val setCount: Int,
    val targetReps: String,
    val weight: Double,
    val reps: Int,
    val timed: Boolean,
    val seconds: Int,
    val noLoad: Boolean,
    val restSec: Int,
    val lastDone: String?,
)

class Workout(private val planner: Planner) {

    /** Today's session that's still going: started and not completed or thrown away. null = none. */
    suspend fun live(): Pair<String, JSONObject>? {
        val day = Planner.dayKey()
        return planner.dayDocs("workout", day)
            .filter { !it.data.has("endedAt") && !it.data.optBoolean("discarded") }
            .maxByOrNull { it.data.optString("startedAt") }
            ?.let { it.key to it.data }
    }

    /** The first set not yet done, in order. null = every set is done (complete it on the phone). */
    fun nextSet(key: String, w: JSONObject): NextSet? {
        val exs = w.optJSONArray("exercises") ?: return null
        var lastDone: String? = null
        for (ei in 0 until exs.length()) {
            val ex = exs.optJSONObject(ei) ?: continue
            val sets = ex.optJSONArray("sets") ?: continue
            for (si in 0 until sets.length()) {
                val s = sets.optJSONObject(si) ?: continue
                if (s.optBoolean("done")) {
                    lastDone = if (ex.optString("mode") == "time") "${s.optInt("seconds")} s" else "${fmtW(s.optDouble("weight", 0.0))} × ${s.optInt("reps")}"
                    continue
                }
                val timed = ex.optString("mode") == "time"
                val target = ex.optString("targetReps", "8-12")
                val reps = s.optInt("reps").takeIf { it > 0 } ?: Regex("\\d+").find(target)?.value?.toIntOrNull() ?: 8
                return NextSet(
                    workoutKey = key, exerciseIndex = ei, setIndex = si,
                    exercise = ex.optString("name"), setCount = sets.length(), targetReps = target,
                    weight = s.optDouble("weight", 0.0), reps = reps,
                    timed = timed, seconds = s.optInt("seconds").takeIf { it > 0 } ?: 30,
                    noLoad = ex.optBoolean("noLoad"),
                    restSec = if (timed) ex.optInt("restSec", 0) else ex.optInt("restSec", 0).takeIf { it > 0 } ?: 90,
                    lastDone = lastDone,
                )
            }
        }
        return null
    }

    /** Mark a set done, read fresh so a set ticked on the phone meanwhile isn't undone. */
    suspend fun logSet(next: NextSet, weight: Double, reps: Int, heart: HeartSummary?) {
        val w = planner.doc("workout", next.workoutKey) ?: return
        val ex = w.optJSONArray("exercises")?.optJSONObject(next.exerciseIndex) ?: return
        val s = ex.optJSONArray("sets")?.optJSONObject(next.setIndex) ?: return
        if (next.timed) {
            s.put("seconds", next.seconds)
        } else {
            s.put("weight", weight).put("reps", reps)
            if (ex.optBoolean("sides")) s.put("repsR", reps)
        }
        s.put("done", true).put("doneAt", Planner.isoNow())
        heart?.let { h ->
            val old = w.optJSONObject("hr")
            val n0 = old?.optInt("samples", 0) ?: 0
            val n = n0 + h.samples
            val avg = if (n0 == 0) h.avg else ((old!!.optInt("avg") * n0 + h.avg * h.samples) / n)
            val max = maxOf(old?.optInt("max", 0) ?: 0, h.max)
            w.put("hr", JSONObject().put("avg", avg).put("max", max).put("samples", n))
        }
        planner.put("workout", next.workoutKey, w)
    }

    companion object {
        fun fmtW(w: Double): String = if (w % 1.0 == 0.0) w.toInt().toString() else "%.1f".format(w)
        /** How much one press (or one bezel click) changes the weight. */
        fun step(units: String): Double = if (units == "kg") 2.5 else 5.0
    }
}
