// Timers.kt — the race timer and the sauna, as on the phone.
//  · I'm up: ticks Up on the day (ticks.up 'HH:MM' and ticks.upAt, the exact moment) and the habits set to tick with it.
//  · Race: the phone's race timer widgets that run from Up (features/widgets/race.ts): "Up to Start workout" finishes
//    when a session is started (on the phone or the watch), "Up to first set" at the first set done. The best is read
//    from the results the phone keeps ('race' / <widget id>~<day>). A race started and stopped by hand stays on the phone.
//  · Sauna: Start writes the start on the day (night.saunaStart); when its minutes are up it's ticked (ticks.sauna) with
//    the habits set to tick with it, the same as the phone does.
//  · Habits that tick with these follow their rules (Today.kt HabitRules, from features/habits/rules.ts).
package app.propertystars.planner.watch

import org.json.JSONObject
import java.util.Date

data class RaceNow(val title: String, val startMs: Long?, val finishMs: Long?, val bestMs: Long?)
data class SaunaNow(val minutes: Int, val startMs: Long?, val done: String?)
data class TimersNow(val up: String?, val race: RaceNow?, val sauna: SaunaNow?)

class Timers(private val planner: Planner) {

    private fun ms(iso: String?): Long? = HabitRules.ms(iso)
    private fun upMs(day: String, ticks: JSONObject?): Long? = HabitRules.upMs(day, ticks)

    /** Started in time for Start workout's own rule: within 30 minutes of I'm up (habits/auto.ts startedInTime, the
     *  same check every habit rule goes through). No Up that day: no. A habit that sets its own rules ("by 6:00",
     *  "within 45 minutes") is judged by those in Today.markAuto("gymStart", startMs), which is the call that ticks. */
    fun startedInTime(day: String, ticks: JSONObject?, startMs: Long): Boolean =
        HabitRules.countsFor(HabitRules.TRIGGER_RULES.getValue("gymStart"), day, startMs, upMs(day, ticks))

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
        val at = System.currentTimeMillis()
        ticks.put("up", Planner.hhmmNow()).put("upAt", Planner.isoNow())
        d.put("ticks", ticks)
        planner.put("day", day, d)
        Today(planner).markAuto("wake", at, at)       // as auto.ts markWake: the moment is the Up itself
    }

    suspend fun startSauna() {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: JSONObject()
        val night = d.optJSONObject("night") ?: JSONObject()
        night.put("saunaStart", Planner.isoNow())
        d.put("night", night)
        planner.put("day", day, d)
    }

    /** The sauna is ticked. `at` = when it ended, for the habits' rules: the end of its minutes when it ran out (even if
     *  the watch only noticed later, as the phone does), else now ("Out"). */
    suspend fun saunaDone(at: Long = System.currentTimeMillis()) = Today(planner).tickBlock("sauna", "sauna", at)
}
