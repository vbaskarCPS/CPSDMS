// Workout.kt — the session that's on today (started on the phone: Training › Start workout), one set at a time.
// The session is the phone's own doc ('workout' / <date>~<id>); the watch marks sets done in it exactly as the phone's
// live screen does (weight, reps, repsR, rpe, done, doneAt) and adds the heart rate it measured (per set and for the
// session), so the phone shows the set at once and finishes the session as usual (Complete workout, the coach's review).
// The order sets come in (supersets, circuits, EMOM / AMRAP …) is Formats.kt; the writes and the shared rest are Sync.kt.
// A session can also be started on the watch: today's template (store.ts todaysTemplate / sessionToday), with the
// coach's prescription from last time when there is one (nextRx), else last time's numbers, else the plan's.
// (The phone's progression rule, nextTarget, isn't ported: started on the watch, a move with no prescription repeats
// last time.)
package app.propertystars.planner.watch

import org.json.JSONArray
import org.json.JSONObject
import java.util.Date
import java.util.UUID

class Workout(private val planner: Planner) {

    /** Today's session that's still going: started and not completed or thrown away. null = none. */
    suspend fun live(): Pair<String, JSONObject>? {
        val day = Planner.dayKey()
        return planner.dayDocs("workout", day)
            .filter { !it.data.has("endedAt") && !it.data.optBoolean("discarded") }
            .maxByOrNull { it.data.optString("startedAt") }
            ?.let { it.key to it.data }
    }

    /** Completed and running sessions of the last 60 days, newest first (thrown-away ones left out). */
    private suspend fun history(): List<JSONObject> {
        val today = Planner.dayKey()
        val from = Planner.dayKey(Date(System.currentTimeMillis() - 60L * 86_400_000))
        return planner.docs("workout", from, Planner.dayAfter(today)).map { it.data }
            .filter { !it.optBoolean("discarded") && it.optString("id").isNotEmpty() }
            .sortedByDescending { it.optString("startedAt") }
    }

    /** The session to offer today: planned for today, else on today's weekday, else the one done longest ago. On a day
     *  with no gym (skipped for the day) only what was planned for that day, the home session first. */
    suspend fun todaysTemplate(): JSONObject? {
        val day = Planner.dayKey()
        val noGym = planner.doc("day", day)?.optJSONObject("adjust")?.optJSONArray("skip")?.let { a -> (0 until a.length()).any { a.optString(it) == "gym" } } ?: false
        val templates = planner.docs("template").map { it.data }.filter { !it.optBoolean("archived") && (it.optString("plannedFor").isEmpty() || it.optString("plannedFor") == day) }
        if (templates.isEmpty()) return null
        val onDate = templates.filter { it.optString("plannedFor") == day }
        if (noGym) return onDate.firstOrNull { it.optBoolean("home") } ?: onDate.firstOrNull()
        onDate.firstOrNull { !it.optBoolean("home") }?.let { return it }
        onDate.firstOrNull()?.let { return it }
        val dow = Planner.weekday(day)
        templates.firstOrNull { t -> t.optJSONArray("days")?.let { a -> (0 until a.length()).any { a.optInt(it, -1) == dow } } == true }?.let { return it }
        val hist = history()
        fun lastDone(t: JSONObject) = hist.firstOrNull { it.optString("templateId") == t.optString("id") && it.has("endedAt") }?.optString("startedAt") ?: ""
        return templates.minByOrNull { lastDone(it) }
    }

    /** Start today's session from a template. Returns its key. */
    suspend fun start(tpl: JSONObject): String {
        val hist = history()
        val day = Planner.dayKey()
        fun lastSets(exId: String): List<JSONObject> {
            for (w in hist) {
                if (!w.has("endedAt")) continue
                val exs = w.optJSONArray("exercises") ?: continue
                for (i in 0 until exs.length()) {
                    val e = exs.optJSONObject(i) ?: continue
                    if (e.optString("exerciseId") != exId) continue
                    val sets = e.optJSONArray("sets") ?: JSONArray()
                    return (0 until sets.length()).mapNotNull { sets.optJSONObject(it) }.filter { it.optBoolean("done") && (it.optInt("reps") > 0 || it.optInt("seconds") > 0) }
                }
            }
            return emptyList()
        }
        fun rxOf(exId: String): JSONObject? {
            val cutoff = Planner.dayKey(Date(System.currentTimeMillis() - 45L * 86_400_000))
            for (w in hist) {
                if (!w.has("endedAt") || w.optString("date") < cutoff) continue
                w.optJSONObject("next")?.optJSONObject(exId)?.let { return it }
                val exs = w.optJSONArray("exercises") ?: continue
                if ((0 until exs.length()).any { exs.optJSONObject(it)?.optString("exerciseId") == exId }) return null
            }
            return null
        }
        fun ints(a: JSONArray?) = a?.let { x -> (0 until x.length()).map { x.optDouble(it) } } ?: emptyList()

        val out = JSONArray()
        val list = tpl.optJSONArray("exercises") ?: JSONArray()
        for (i in 0 until list.length()) {
            val t = list.optJSONObject(i) ?: continue
            val exId = t.optString("exerciseId")
            val rx = rxOf(exId)
            val last = lastSets(exId)
            val ex = JSONObject().put("exerciseId", exId).put("name", t.optString("name"))
            for (k in listOf("sides", "noLoad", "style", "repsBySet", "weightBySet", "group", "groupKind", "groupSec", "note")) if (t.has(k)) ex.put(k, t.get(k))
            rx?.optString("cue")?.trim()?.takeIf { it.isNotEmpty() }?.let { ex.put("coachCue", it) }
            val sets = JSONArray()
            if (t.optString("mode") == "time") {
                val n = maxOf(1, rx?.optInt("sets")?.takeIf { it > 0 } ?: t.optInt("targetSets", 1))
                val sec = rx?.optInt("seconds")?.takeIf { it > 0 } ?: t.optInt("targetSec").takeIf { it > 0 } ?: 60
                repeat(n) { sets.put(JSONObject().put("weight", 0).put("reps", 0).put("seconds", sec).put("done", false)) }
                ex.put("mode", "time").put("restSec", rx?.optInt("restSec")?.takeIf { it > 0 } ?: t.optInt("restSec", 0))
            } else {
                val repsBy = ints(t.optJSONArray("repsBySet")); val weightBy = ints(t.optJSONArray("weightBySet"))
                val lowReps = Regex("\\d+").find(t.optString("targetReps", "8"))?.value?.toIntOrNull() ?: 8
                val planned = if (t.has("startWeight") && (tpl.optString("plannedFor").isNotEmpty() || last.isEmpty())) t.optDouble("startWeight") else null
                val base = if (t.optBoolean("noLoad") && last.none { it.optDouble("weight", 0.0) > 0 }) 0.0
                    else planned ?: rx?.optDouble("weight")?.takeIf { !it.isNaN() && (repsBy.isEmpty() && weightBy.isEmpty()) }
                        ?: last.maxOfOrNull { it.optDouble("weight", 0.0) } ?: 0.0
                val n = if (repsBy.isNotEmpty() || weightBy.isNotEmpty()) maxOf(repsBy.size, weightBy.size)
                    else maxOf(1, rx?.optInt("sets")?.takeIf { it > 0 } ?: t.optInt("targetSets", 3))
                val reps = rx?.optInt("reps")?.takeIf { it > 0 && repsBy.isEmpty() } ?: last.firstOrNull()?.optInt("reps")?.takeIf { it > 0 } ?: lowReps
                for (si in 0 until n) {
                    val r = repsBy.getOrNull(si)?.toInt() ?: repsBy.lastOrNull()?.toInt() ?: reps
                    val s = JSONObject().put("weight", weightBy.getOrNull(si) ?: base).put("reps", r).put("done", false)
                    if (t.optBoolean("sides")) s.put("repsR", r)
                    last.getOrNull(si)?.let { p -> s.put("prev", JSONObject().put("weight", p.optDouble("weight", 0.0)).put("reps", p.optInt("reps")).also { o -> if (p.has("repsR")) o.put("repsR", p.optInt("repsR")) }) }
                    sets.put(s)
                }
                ex.put("restSec", rx?.optInt("restSec")?.takeIf { it > 0 && repsBy.isEmpty() } ?: t.optInt("restSec", 90))
                ex.put("targetReps", rx?.optInt("reps")?.takeIf { it > 0 && repsBy.isEmpty() }?.toString() ?: if (repsBy.isNotEmpty()) repsBy.joinToString("-") { it.toInt().toString() } else t.optString("targetReps"))
            }
            ex.put("sets", sets)
            out.put(ex)
        }
        val id = UUID.randomUUID().toString().replace("-", "").take(12)
        val startedAt = Planner.isoNow()
        val w = JSONObject().put("id", id).put("date", day).put("startedAt", startedAt).put("templateId", tpl.optString("id"))
            .put("name", tpl.optString("name")).put("exercises", out).put("startedOn", "watch")
        if (tpl.optBoolean("home")) w.put("kind", "home")
        val key = "$day~$id"
        val startedMs = System.currentTimeMillis()
        planner.put("workout", key, w)
        // Start workout ticks the habits set to that, each by its own rules ("by" a time, "within N minutes of I'm up"):
        // Today.markAuto checks them against the moment the session started (habits/auto.ts markGymStart)
        if (!tpl.optBoolean("home")) Today(planner).markAuto("gymStart", startedMs)
        return key
    }

    companion object {
        /** The session's exercises as Formats.kt reads them (the doc itself stays as it is, for writing back). */
        fun parse(w: JSONObject): List<FEx> {
            val exs = w.optJSONArray("exercises") ?: return emptyList()
            return (0 until exs.length()).mapNotNull { i ->
                val e = exs.optJSONObject(i) ?: return@mapNotNull null
                val sets = e.optJSONArray("sets") ?: JSONArray()
                FEx(
                    name = e.optString("name"),
                    exerciseId = e.optString("exerciseId"),
                    mode = if (e.optString("mode") == "time") "time" else "reps",
                    targetReps = e.optString("targetReps"),
                    note = e.optString("note"),
                    restSec = e.optInt("restSec", 0),
                    sets = (0 until sets.length()).map { j ->
                        val s = sets.optJSONObject(j) ?: JSONObject()
                        FSet(
                            weight = s.optDouble("weight", 0.0).takeIf { !it.isNaN() } ?: 0.0,
                            reps = s.optInt("reps", 0),
                            repsR = if (s.has("repsR") && !s.isNull("repsR")) s.optInt("repsR") else null,
                            seconds = s.optInt("seconds", 0),
                            done = s.optBoolean("done"),
                            doneAt = s.optString("doneAt"),
                            rpe = if (s.has("rpe") && !s.isNull("rpe")) s.optDouble("rpe").takeIf { !it.isNaN() } else null,
                            prevWeight = s.optJSONObject("prev")?.optDouble("weight", 0.0)?.takeIf { !it.isNaN() } ?: 0.0,
                        )
                    },
                    sides = if (e.has("sides") && !e.isNull("sides")) e.optBoolean("sides") else null,
                    noLoad = if (e.has("noLoad") && !e.isNull("noLoad")) e.optBoolean("noLoad") else null,
                    style = e.optString("style"),
                    repsBySet = e.optJSONArray("repsBySet")?.let { a -> (0 until a.length()).map { a.optDouble(it).toInt() }.filter { it > 0 } } ?: emptyList(),
                    weightBySet = e.optJSONArray("weightBySet")?.let { a -> (0 until a.length()).map { a.optDouble(it) }.filter { !it.isNaN() } } ?: emptyList(),
                    group = e.optString("group"),
                    groupKind = e.optString("groupKind"),
                    groupSec = e.optInt("groupSec", 0),
                )
            }
        }

        fun fmtW(w: Double): String = Formats.fmtW(w)
        /** How much one press (or one bezel click) changes the weight. */
        fun step(units: String): Double = if (units == "kg") 2.5 else 5.0
    }
}
