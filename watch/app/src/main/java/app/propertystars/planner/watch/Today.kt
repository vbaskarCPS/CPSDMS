// Today.kt — today on the watch: where the day is (now / next block), the habits due and the to-dos, protein so far,
// and ticking things off. Reads and writes the same docs as the phone:
//   'prefs'/'routine'          the routine           'day'/<date>          ticks, to-dos, the day's changes
//   'habit'/<id>               habits                'habitlog'/<date>     { habitId: 'done' | 'mini' | 'skip' }
//   'meal'/<date>~<id>         meals (totals)        'foodprefs'/'targets' the protein goal
// Every write reads the doc fresh first, so a tick on the watch never undoes something done on the phone meanwhile.
package app.propertystars.planner.watch

import org.json.JSONArray
import org.json.JSONObject

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
        .put("proteinLeft", proteinLeft)
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
    suspend fun tickBlock(tick: String, autoName: String = tick) {
        val day = Planner.dayKey()
        val d = planner.doc("day", day) ?: JSONObject()
        val ticks = d.optJSONObject("ticks") ?: JSONObject()
        ticks.put(tick, Planner.hhmmNow())
        d.put("ticks", ticks)
        planner.put("day", day, d)
        val auto = planner.docs("habit").map { it.data }.filter { !it.optBoolean("archived") && it.optString("auto") == autoName }
        if (auto.isNotEmpty()) {
            val marks = planner.doc("habitlog", day) ?: JSONObject()
            for (h in auto) marks.put(h.optString("id"), "done")
            planner.put("habitlog", day, marks)
        }
    }
}
