// Today.kt — today on the watch: where the day is (now / next block), the habits due and the to-dos, protein so far,
// and ticking things off. Reads and writes the same docs as the phone:
//   'prefs'/'routine'          the routine           'day'/<date>          ticks, to-dos, the day's changes
//   'habit'/<id>               habits                'habitlog'/<date>     { habitId: 'done' | 'mini' | 'skip' }
//   'meal'/<date>~<id>         meals (totals)        'foodprefs'/'targets' the protein goal
//   'habitauto'/<date>         { habitId: trigger }: which ticks a trigger made (so it never takes back one made by hand)
// Every write reads the doc fresh first, so a tick on the watch never undoes something done on the phone meanwhile.
// Habits that tick themselves follow their rules ("only counts if done by 5:05", "within 30 minutes of I'm up"),
// ported from features/habits/rules.ts: HabitRules below. Change them together.
package app.propertystars.planner.watch

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** The rules a habit that ticks itself can carry (features/habits/rules.ts). */
object HabitRules {
    /** by = 'HH:MM': only counts at or before this time that planner day (which starts at 4 am, so 01:00 is after
     *  23:00). withinUpMin = only counts this many minutes after I'm up, or sooner (no I'm up that day: doesn't count). */
    data class Rules(val by: String? = null, val withinUpMin: Double? = null) {
        val any: Boolean get() = by != null || withinUpMin != null
    }

    /** A trigger's own rule when the habit doesn't set one (rules.ts TRIGGER_RULES): Start workout within 30 minutes
     *  of Up. */
    val TRIGGER_RULES: Map<String, Rules> = mapOf("gymStart" to Rules(withinUpMin = 30.0))

    private val HM = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")

    /** The rules that apply to a habit: its own, else its trigger's. Anything malformed is left out (rules.ts rulesOf). */
    fun rulesOf(h: JSONObject): Rules = rulesOf(h.optString("auto"), h.opt("by"), h.opt("withinUpMin"))

    /** The same from the habit's fields as they come out of its doc (anything: a string, a number, null). */
    fun rulesOf(auto: String?, ownBy0: Any?, ownMin0: Any?): Rules {
        val d = TRIGGER_RULES[auto ?: ""] ?: Rules()
        val ownBy = ownBy0 as? String
        val by = if (ownBy != null && HM.matches(ownBy)) ownBy else d.by
        val ownMin = (ownMin0 as? Number)?.toDouble()
        val within = if (ownMin != null && !ownMin.isNaN() && !ownMin.isInfinite() && ownMin > 0) ownMin else d.withinUpMin
        return Rules(by, within)
    }

    /** Does something that happened at `at` (ms) on planner day `day` count for these rules? `up` = the moment I'm up
     *  was ticked that day (ms), or null. No rules: always. A rule but no moment to check it by: no (rules.ts
     *  countsFor). */
    fun countsFor(r: Rules, day: String, at: Long?, up: Long?): Boolean {
        if (!r.any) return true
        if (at == null) return false
        if (r.by != null) {
            val end = momentOf(day, r.by) ?: return false
            if (at >= end + 60_000L) return false            // "by 5:05" still takes 5:05 and 40 seconds
        }
        if (r.withinUpMin != null) {
            if (up == null) return false
            if (at < up || at - up > r.withinUpMin * 60_000) return false
        }
        return true
    }

    /** A planner day's 'HH:MM' as a moment (before 4 am = the small hours after that date; race.ts momentOf). */
    fun momentOf(day: String, hm: String?): Long? {
        if (hm == null || !HM.matches(hm) || !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day)) return null
        val d = try { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day) } catch (_: Exception) { null } ?: return null
        val c = Calendar.getInstance().apply { time = d }
        val h = hm.substring(0, 2).toInt()
        if (h < 4) c.add(Calendar.DAY_OF_MONTH, 1)
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, hm.substring(3).toInt()); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /** An ISO moment ('2026-11-12T05:01:00.000+00:00', or with Z) as ms, or null. */
    fun ms(iso: String?): Long? {
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

    /** The moment Up was ticked: the exact one when it was written down, else the minute on the tick (race.ts upMoment). */
    fun upMs(day: String, ticks: JSONObject?): Long? {
        val at = ms(ticks?.optString("upAt"))
        if (at != null && Planner.dayKey(Date(at)) == day) return at
        return momentOf(day, ticks?.optString("up"))
    }
}

data class HabitItem(val id: String, val name: String, val done: Boolean, val auto: String?)
data class TodoItem(val id: String, val text: String, val done: Boolean, val must: Boolean)

data class TodaySummary(
    val day: String,
    val now: Block?,
    val next: Block?,
    val habits: List<HabitItem>,
    val todos: List<TodoItem>,
    val proteinEaten: Int,
    val proteinGoal: Int,
) {
    val habitsDone: Int get() = habits.count { it.done }
    val proteinLeft: Int get() = maxOf(0, proteinGoal - proteinEaten)

    /** What the tile shows, kept on the watch so the tile can draw without waiting for the network. */
    fun toJson(): JSONObject = JSONObject()
        .put("day", day)
        .put("now", now?.label ?: "").put("nowUntil", now?.until ?: "")
        .put("next", next?.label ?: "").put("nextAt", next?.at ?: "")
        .put("habitsDone", habitsDone).put("habits", habits.size)
        .put("proteinLeft", proteinLeft).put("proteinEaten", proteinEaten).put("proteinGoal", proteinGoal)
}

class Today(private val planner: Planner) {

    suspend fun load(): TodaySummary {
        val day = Planner.dayKey()
        val routine = Routine.from(planner.doc("prefs", "routine"), planner.profile)
        val dayDoc = planner.doc("day", day)
        val adjust = adjustFrom(dayDoc?.optJSONObject("adjust"))
        val list = blocks(routine, adjust)
        val (now, next) = nowAndNext(list, routineFor(routine, adjust), Planner.hhmmNow())

        val weekday = Planner.weekday(day)
        val marks = planner.doc("habitlog", day) ?: JSONObject()
        val habits = planner.docs("habit").map { it.data }
            .filter { !it.optBoolean("archived") && dueOn(it, weekday) }
            .sortedBy { it.optInt("order") }
            .map { h ->
                val mark = marks.optString(h.optString("id"))
                HabitItem(h.optString("id"), h.optString("name"), mark == "done" || mark == "mini", h.optString("auto").ifEmpty { null })
            }

        val todos = mutableListOf<TodoItem>()
        dayDoc?.optJSONArray("todos")?.let { a ->
            for (i in 0 until a.length()) {
                val t = a.optJSONObject(i) ?: continue
                val text = t.optString("text").trim()
                if (text.isEmpty()) continue
                todos += TodoItem(t.optString("id"), text, t.optBoolean("done"), t.optBoolean("must"))
            }
        }

        val protein = planner.dayDocs("meal", day).sumOf { it.data.optJSONObject("totals")?.optDouble("protein", 0.0) ?: 0.0 }
        val goal = planner.doc("foodprefs", "targets")?.optInt("protein", 160) ?: 160

        val s = TodaySummary(day, now, next, habits, todos.sortedBy { if (it.must) 0 else 1 }, Math.round(protein).toInt(), goal)
        planner.keep("today", s.toJson().toString())
        return s
    }

    private fun dueOn(h: JSONObject, weekday: Int): Boolean {
        val days = h.optJSONArray("days") ?: return true
        for (i in 0 until days.length()) if (days.optInt(i, -1) == weekday) return true
        return false
    }

    /** Tick a habit for today, or take the tick off. */
    suspend fun toggleHabit(id: String, done: Boolean) {
        val day = Planner.dayKey()
        val marks = planner.doc("habitlog", day) ?: JSONObject()
        if (done) marks.put(id, "done") else marks.remove(id)
        planner.put("habitlog", day, marks)
        handMarked(id, day)
    }

    /** A habit marked by hand: whatever trigger ticked it that day no longer owns the tick (auto.ts handMarked). */
    private suspend fun handMarked(id: String, day: String) {
        try {
            val mine = planner.doc("habitauto", day) ?: return
            if (!mine.has(id)) return
            mine.remove(id)
            planner.put("habitauto", day, mine)
        } catch (_: Exception) { /* at worst a later trigger takes the tick back */ }
    }

    /** Tick a to-do, or take the tick off. The day's priorities follow its must-dos (plan/types.ts syncPriorities). */
    suspend fun toggleTodo(id: String, done: Boolean) {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: return
        val todos = d.optJSONArray("todos") ?: return
        for (i in 0 until todos.length()) {
            val t = todos.optJSONObject(i) ?: continue
            if (t.optString("id") == id) t.put("done", done)
        }
        val must = JSONArray()
        for (i in 0 until todos.length()) {
            val t = todos.optJSONObject(i) ?: continue
            if (t.optBoolean("must") && must.length() < 3) must.put(JSONObject().put("text", t.optString("text").trim()).put("done", t.optBoolean("done")))
        }
        while (must.length() < 3) must.put(JSONObject().put("text", "").put("done", false))
        d.put("priorities", must)
        planner.put("day", day, d)
    }

    /** Tick one of the day's blocks (sauna, gym …) at this time, and the habits that tick themselves with it. */
    suspend fun tickBlock(tick: String, autoName: String = tick, at: Long = System.currentTimeMillis()) {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: JSONObject()
        val ticks = d.optJSONObject("ticks") ?: JSONObject()
        ticks.put(tick, Planner.hhmmNow())
        d.put("ticks", ticks)
        planner.put("day", day, d)
        markAuto(autoName, at, HabitRules.upMs(day, ticks))
    }

    /** Tick today the habits set to tick themselves on this (features/habits/auto.ts autoMark), each only if the thing
     *  happened in time for that habit's rules. `at` = when it happened (ms); `up` = when I'm up was ticked today, if
     *  the caller knows (else it is read from the day when a rule needs it). Which ticks the trigger made is written
     *  down ('habitauto'), as the phone does. */
    suspend fun markAuto(trigger: String, at: Long? = System.currentTimeMillis(), up: Long? = null) {
        val day = Planner.dayKey()
        var auto = planner.docs("habit")
            .map { d -> d.data.also { if (it.optString("id").isEmpty()) it.put("id", d.key) } }
            .filter { !it.optBoolean("archived") && it.optString("auto") == trigger }
        if (auto.isEmpty()) return
        var upAt = up
        if (upAt == null && auto.any { HabitRules.rulesOf(it).withinUpMin != null }) {
            upAt = HabitRules.upMs(day, planner.doc("day", day)?.optJSONObject("ticks"))
        }
        auto = auto.filter { HabitRules.countsFor(HabitRules.rulesOf(it), day, at, upAt) }
        if (auto.isEmpty()) return
        val marks = planner.doc("habitlog", day) ?: JSONObject()
        val mine = try { planner.doc("habitauto", day) } catch (_: Exception) { null } ?: JSONObject()
        var changed = false
        var mineChanged = false
        for (h in auto) {
            val id = h.optString("id")
            if (marks.optString(id) == "done") continue
            marks.put(id, "done"); changed = true
            if (mine.optString(id) != trigger) { mine.put(id, trigger); mineChanged = true }
        }
        if (changed) planner.put("habitlog", day, marks)
        if (mineChanged) try { planner.put("habitauto", day, mine) } catch (_: Exception) { /* the tick itself is saved */ }
    }
}
