// Routine.kt — the shape of the day, as the phone works it out: the same blocks (Up, Gym, Sauna, Brief, the list,
// Kitchen closed, Lights out … or the morning profile's), with that day's changes (skipped blocks, moved times, added
// blocks). A port of src/planner/lib/routine.ts (blocks, nightBlocks, morningBlocks) and
// supabase/functions/planner-push/adjust.ts (routineFor, lateGym): change those and this together.
package app.propertystars.planner.watch

import org.json.JSONObject

data class Routine(
    val profile: String,
    val stretchMin: Int, val meditateMin: Int, val workoutMin: Int,
    val kiaanUp: String, val fast: Boolean, val wake: String, val wakeGrace: Int, val briefMinutes: Int,
    val eatOpen: String, val eatClose: String, val gym: String, val saunaMin: Int, val review: String,
    val windDown: String, val lightsOut: String, val kitchenClose: String,
) {
    companion object {
        private val NIGHT = Routine("night", 0, 0, 0, "07:30", true, "05:00", 15, 10, "18:00", "20:30", "05:15", 25, "06:45", "21:30", "21:30", "14:00")
        private val MORNING = Routine("morning", 10, 10, 20, "08:00", false, "05:30", 30, 10, "18:00", "20:00", "06:00", 0, "20:30", "20:45", "21:00", "")

        /** The saved routine (doc 'prefs' / 'routine'), over the defaults of its profile. */
        fun from(j: JSONObject?, fallbackProfile: String): Routine {
            val p = j?.optString("profile")?.takeIf { it == "night" || it == "morning" } ?: fallbackProfile
            val d = if (p == "morning") MORNING else NIGHT
            if (j == null) return d
            fun s(k: String, def: String) = j.optString(k, def).let { if (k == "kitchenClose") it else it.ifEmpty { def } }
            fun i(k: String, def: Int) = if (j.has(k)) j.optInt(k, def) else def
            return Routine(
                p, i("stretchMin", d.stretchMin), i("meditateMin", d.meditateMin), i("workoutMin", d.workoutMin),
                s("kiaanUp", d.kiaanUp), j.optBoolean("fast", d.fast), s("wake", d.wake), i("wakeGrace", d.wakeGrace),
                i("briefMinutes", d.briefMinutes), s("eatOpen", d.eatOpen), s("eatClose", d.eatClose), s("gym", d.gym),
                i("saunaMin", d.saunaMin), s("review", d.review), s("windDown", d.windDown), s("lightsOut", d.lightsOut),
                if (j.has("kitchenClose")) j.optString("kitchenClose") else d.kitchenClose,
            )
        }
    }
}

data class Added(val id: String, val at: String, val until: String?, val label: String, val note: String)
data class DayAdjust(val skip: Set<String>, val times: Map<String, String>, val saunaMin: Int?, val added: List<Added>)
data class Block(val id: String, val label: String, val at: String, val until: String?)

private fun isHM(s: String?) = s != null && Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(s)
fun mins(t: String): Int { val p = t.split(":"); return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0) }
fun hm(n: Int): String { val m = ((n % 1440) + 1440) % 1440; return "%02d:%02d".format(m / 60, m % 60) }
/** Minutes on the planner's clock, which starts at 4 am. */
fun routineMin(t: String): Int = (mins(t) - 240 + 1440) % 1440

/** "5:15 am" */
fun clock(t: String): String {
    val m = mins(t); val h = m / 60; val mm = m % 60
    val h12 = if (h % 12 == 0) 12 else h % 12
    return "$h12:%02d ${if (h < 12) "am" else "pm"}".format(mm)
}

/** A day's changes as stored on the day doc (Day.adjust), checked the way cleanAdjust does. */
fun adjustFrom(j: JSONObject?): DayAdjust? {
    if (j == null) return null
    val anySkip = setOf("gym", "sauna", "brief", "kitchen", "dinner", "morning", "kiaanUp", "evening")
    val skip = mutableSetOf<String>()
    j.optJSONArray("skip")?.let { a -> for (i in 0 until a.length()) a.optString(i).takeIf { it in anySkip }?.let { skip.add(it) } }
    val times = mutableMapOf<String, String>()
    j.optJSONObject("times")?.let { t ->
        for (k in listOf("wake", "gym", "review", "lightsOut", "kitchenClose", "eatOpen", "kiaanUp")) {
            if (!t.has(k)) continue
            val v = t.optString(k)
            if (isHM(v) || (k == "kitchenClose" && v == "")) times[k] = v
        }
    }
    val sauna = if (j.has("saunaMin") && !j.isNull("saunaMin")) j.optInt("saunaMin").coerceIn(0, 90) else null
    val added = mutableListOf<Added>()
    j.optJSONArray("added")?.let { a ->
        for (i in 0 until a.length()) {
            val x = a.optJSONObject(i) ?: continue
            val at = x.optString("at"); val label = x.optString("label").trim()
            if (!isHM(at) || label.isEmpty() || x.optString("id").isEmpty()) continue
            added.add(Added(x.optString("id"), at, x.optString("until").takeIf { isHM(it) }, label.take(60), x.optString("note")))
        }
    }
    if (skip.isEmpty() && times.isEmpty() && sauna == null && added.isEmpty()) return null
    return DayAdjust(skip, times, sauna, added)
}

private const val LATE_GYM = 120
private fun gymLen(r: Routine) = maxOf(0, mins(r.review) - r.saunaMin - mins(r.gym))
private fun saunaOf(r: Routine, a: DayAdjust) = if ("sauna" in a.skip) 0 else a.saunaMin ?: r.saunaMin

private data class LateGym(val at: String, val until: String, val saunaUntil: String?)

private fun lateGym(r: Routine, a: DayAdjust?): LateGym? {
    if (r.profile != "night" || a == null || "gym" in a.skip) return null
    val g = a.times["gym"]?.takeIf { isHM(it) } ?: return null
    val shift = a.times["wake"]?.takeIf { isHM(it) }?.let { mins(it) - mins(r.wake) } ?: 0
    if (mins(g) - (mins(r.gym) + shift) < LATE_GYM) return null
    val end = mins(g) + (gymLen(r).takeIf { it > 0 } ?: 75)
    val sauna = saunaOf(r, a)
    return LateGym(g, hm(end), if (sauna > 0) hm(end + sauna) else null)
}

/** The routine as it runs on a changed day (adjust.ts routineFor). */
fun routineFor(r: Routine, a: DayAdjust?): Routine {
    if (a == null) return r
    val t = a.times; val skip = a.skip
    val shift = t["wake"]?.takeIf { isHM(it) }?.let { mins(it) - mins(r.wake) } ?: 0
    var out = r
    t["wake"]?.takeIf { isHM(it) }?.let { out = out.copy(wake = it) }
    t["lightsOut"]?.takeIf { isHM(it) }?.let { out = out.copy(windDown = hm(mins(r.windDown) + mins(it) - mins(r.lightsOut)), lightsOut = it) }
    t["kitchenClose"]?.let { if (it == "" || isHM(it)) out = out.copy(kitchenClose = it) }
    if ("kitchen" in skip) out = out.copy(kitchenClose = "")
    t["eatOpen"]?.takeIf { isHM(it) }?.let { out = out.copy(eatOpen = it) }
    t["kiaanUp"]?.takeIf { isHM(it) }?.let { out = out.copy(kiaanUp = it) }
    if (r.profile == "morning") {
        if ("morning" in skip) out = out.copy(stretchMin = 0, meditateMin = 0, workoutMin = 0)
        return out
    }
    val late = lateGym(r, a)
    val sauna = if (late != null) 0 else saunaOf(r, a)
    val gymAt = late?.let { mins(it.at) } ?: t["gym"]?.takeIf { isHM(it) }?.let { mins(it) } ?: (mins(r.gym) + shift)
    val from = if (late != null || "gym" in skip) mins(r.gym) + shift else gymAt + gymLen(r)
    return out.copy(gym = hm(gymAt), saunaMin = sauna, review = t["review"]?.takeIf { isHM(it) } ?: hm(from + sauna))
}

private fun planAt(r: Routine) = if (r.saunaMin > 0) hm(mins(r.review) - r.saunaMin) else r.review

private fun nightBlocks(r: Routine, noMorningGym: Boolean): List<Block> {
    val list = mutableListOf<Block>()
    list += Block("wake", if (noMorningGym) "Up" else "Up — straight to the gym", r.wake, null)
    list += Block("gym", "Gym", r.gym, planAt(r))
    if (r.saunaMin > 0) list += Block("sauna", "Sauna", hm(mins(r.review) - r.saunaMin), r.review)
    list += Block("brief", "Today's Brief", planAt(r), if (planAt(r) != r.review) r.review else null)
    list += Block("work", "Tackle the list", r.review, null)
    list += if (r.kitchenClose.isNotEmpty()) Block("kitchen", "Kitchen closed", r.kitchenClose, null)
    else Block("dinner", if (r.fast) "Dinner — first meal" else "Dinner", r.eatOpen, null)
    list += Block("lightsOut", "Lights out", r.lightsOut, null)
    return list
}

private fun morningBlocks(r: Routine): List<Block> {
    val routineMins = r.stretchMin + r.meditateMin + r.workoutMin
    val routineEnd = hm(mins(r.wake) + routineMins)
    val briefEnd = hm(mins(routineEnd) + r.briefMinutes)
    val list = mutableListOf(Block("wake", "Up", r.wake, null))
    if (routineMins > 0) list += Block("morning", "Miracle Morning", r.wake, routineEnd)
    list += Block("brief", "Morning Brief", routineEnd, briefEnd)
    list += Block("kiaanUp", "Kiaan up", r.kiaanUp, null)
    list += Block("work", "Tackle the list", r.kiaanUp, r.eatOpen)
    list += Block("dinner", "Dinner", r.eatOpen, null)
    list += Block("evening", "Evening review", hm(mins(r.lightsOut) - 30), r.lightsOut)
    list += Block("lightsOut", "Bed", r.lightsOut, null)
    return list
}

/** The day as an ordered list of blocks (routine.ts blocks). */
fun blocks(r: Routine, a: DayAdjust?): List<Block> {
    if (a == null) return if (r.profile == "morning") morningBlocks(r) else nightBlocks(r, false)
    val e = routineFor(r, a)
    val skip = a.skip.toMutableSet()
    val late = lateGym(r, a)
    if (e.profile == "night" && "kitchen" in skip) skip += "dinner"
    var list = (if (e.profile == "morning") morningBlocks(e) else nightBlocks(e, "gym" in skip || late != null)).filter { it.id !in skip }
    if (late != null) {
        list = list.filter { it.id != "gym" } + Block("gym", "Gym", late.at, late.until) +
            (late.saunaUntil?.let { listOf(Block("sauna", "Sauna", late.until, it)) } ?: emptyList())
    }
    list = list + a.added.map { Block("x:${it.id}", it.label, it.at, it.until) }
    return list.withIndex().sortedWith(compareBy({ routineMin(it.value.at) }, { it.index })).map { it.value }
}

/** Where the clock is: the block we're in and the one after it. Before getting up, it's still last night. */
fun nowAndNext(list: List<Block>, r: Routine, nowHHMM: String): Pair<Block?, Block?> {
    val now = routineMin(nowHHMM)
    if (now < routineMin(r.wake)) return Pair(list.lastOrNull(), list.firstOrNull())
    var cur: Block? = null
    var next: Block? = null
    for (b in list) {
        if (routineMin(b.at) <= now) cur = b else if (next == null) next = b
    }
    return Pair(cur, next)
}
