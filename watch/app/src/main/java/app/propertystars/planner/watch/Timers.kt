// Timers.kt — the race timer and the sauna, as on the phone.
//  · I'm up: ticks Up on the day (ticks.up 'HH:MM' and ticks.upAt, the exact moment) and the habits set to tick with it.
//  · Race: the phone's race timer widgets that run from Up (features/widgets/race.ts): "Up to Start workout" finishes
//    when a session is started (on the phone or the watch), "Up to first set" at the first set done. The best is read
//    from the results the phone keeps ('race' / <widget id>~<day>). A race started and stopped by hand stays on the phone.
//  · Sauna: Start writes the start on the day (night.saunaStart); when its minutes are up it's ticked (ticks.sauna) with
//    the habits set to tick with it, the same as the phone does.
package app.propertystars.planner.watch

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class RaceNow(val title: String, val startMs: Long?, val finishMs: Long?, val bestMs: Long?)
data class SaunaNow(val minutes: Int, val startMs: Long?, val done: String?)
data class TimersNow(val up: String?, val race: RaceNow?, val sauna: SaunaNow?)

class Timers(private val planner: Planner) {

    private fun ms(iso: String?): Long? {
        if (iso.isNullOrEmpty() || !Regex("^\\d{4}-\\d{2}-\\d{2}T").containsMatchIn(iso)) return null
        for (f in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            try {
                val p = SimpleDateFormat(f, Locale.US)
                if (f.endsWith("'Z'")) p.timeZone = java.util.TimeZone.getTimeZone("UTC")
                return p.parse(iso)?.time
            } catch (_: Exception) { }
        }
        return null
    }

    /** A planner day's 'HH:MM' as a moment (before 4 am = the small hours after that date). */
    private fun momentOf(day: String, hm: String?): Long? {
        if (hm == null || !Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(hm)) return null
        val d = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day) ?: return null
        val c = Calendar.getInstance().apply { time = d }
        val h = hm.substring(0, 2).toInt()
        if (h < 4) c.add(Calendar.DAY_OF_MONTH, 1)
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, hm.substring(3).toInt()); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    private fun upMs(day: String, ticks: JSONObject?): Long? {
        val at = ms(ticks?.optString("upAt"))
        if (at != null && Planner.dayKey(Date(at)) == day) return at
        return momentOf(day, ticks?.optString("up"))
    }

    /** Started within 30 minutes of I'm up (habits/auto.ts GYM_START_WITHIN_MIN)? No Up that day: no. */
    fun startedInTime(day: String, ticks: JSONObject?, startMs: Long): Boolean {
        val up = upMs(day, ticks) ?: return false
        return startMs >= up && startMs - up <= 30 * 60_000L
    }

    private fun finishMs(kind: String, workouts: List<JSONObject>, from: Long): Long? {
        var best: Long? = null
        for (w in workouts) {
            if (w.optBoolean("discarded") || w.optString("kind") == "home") continue
            if (kind == "gym") {
                val at = ms(w.optString("startedAt")) ?: continue
                if (at >= from && (best == null || at < best)) best = at
            } else {
                val exs = w.optJSONArray("exercises") ?: continue
                for (i in 0 until exs.length()) {
                    val sets = exs.optJSONObject(i)?.optJSONArray("sets") ?: continue
                    for (j in 0 until sets.length()) {
                        val s = sets.optJSONObject(j) ?: continue
                        if (!s.optBoolean("done")) continue
                        val at = ms(s.optString("doneAt")) ?: continue
                        if (at >= from && (best == null || at < best)) best = at
                    }
                }
            }
        }
        return best
    }

    suspend fun load(): TimersNow {
        val day = Planner.dayKey()
        val d = planner.doc("day", day)
        val ticks = d?.optJSONObject("ticks")
        val up = ticks?.optString("up")?.takeIf { it.isNotEmpty() }

        // the first race timer on Today that runs from Up
        var race: RaceNow? = null
        val added = planner.doc("prefs", "widgets")?.optJSONArray("added")
        var raceId: String? = null; var raceKind = ""; var raceTitle = ""
        if (added != null) for (i in 0 until added.length()) {
            val a = added.optJSONObject(i) ?: continue
            if (a.optString("kind") == "race" && a.optString("race") in setOf("gym", "firstset")) {
                raceId = a.optString("id"); raceKind = a.optString("race")
                raceTitle = a.optString("title").ifEmpty { if (raceKind == "gym") "Up to Start workout" else "Up to first set" }
                break
            }
        }
        if (raceId != null) {
            val start = upMs(day, ticks)
            val workouts = planner.dayDocs("workout", day).map { it.data }
            val finish = start?.let { finishMs(raceKind, workouts, it) }
            var best: Long? = null
            val from = Planner.dayKey(Date(System.currentTimeMillis() - 30L * 86_400_000))
            for (r in planner.docs("race", "$raceId~$from", "$raceId~$day")) {
                if (r.data.optBoolean("removed")) continue
                val s = ms(r.data.optString("start")) ?: continue
                val f = ms(r.data.optString("finish")) ?: continue
                if (f > s && (best == null || f - s < best)) best = f - s
            }
            race = RaceNow(raceTitle, start, finish, best)
        }

        // the sauna, on days that have one (the night profile)
        val routine = routineFor(Routine.from(planner.doc("prefs", "routine"), planner.profile), adjustFrom(d?.optJSONObject("adjust")))
        val sauna = if (routine.saunaMin > 0) SaunaNow(
            routine.saunaMin,
            ms(d?.optJSONObject("night")?.optString("saunaStart")),
            ticks?.optString("sauna")?.takeIf { it.isNotEmpty() },
        ) else null
        return TimersNow(up, race, sauna)
    }

    /** I'm up: the tick, its exact moment, and the habits that tick with it. */
    suspend fun imUp() {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: JSONObject()
        val ticks = d.optJSONObject("ticks") ?: JSONObject()
        if (ticks.optString("up").isNotEmpty()) return
        ticks.put("up", Planner.hhmmNow()).put("upAt", Planner.isoNow())
        d.put("ticks", ticks)
        planner.put("day", day, d)
        Today(planner).markAuto("wake")
    }

    suspend fun startSauna() {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: JSONObject()
        val night = d.optJSONObject("night") ?: JSONObject()
        night.put("saunaStart", Planner.isoNow())
        d.put("night", night)
        planner.put("day", day, d)
    }

    suspend fun saunaDone() = Today(planner).tickBlock("sauna")
}
