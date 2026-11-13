// Sync.kt — the watch and the phone on the same session at once. The planner's docs can't be watched live, so while the
// workout or rest screen is showing the watch reads the session doc every 2 s (planner_get, from = to = its key) and
// takes the newer copy when its updated_at changed. Every write reads the doc fresh, changes only its own bit (one set's
// fields, the `rest`, one block's sets) and writes it back, so what the phone did meanwhile stays. A set already done
// is never un-done except by an explicit Undo.
// The running rest is on the session doc for both sides (phone types.ts Workout.rest):
//   rest: { endsAt: ISO, total: seconds, after: { ei, si }, by: 'watch' | 'phone' } | null
// Either side writes it when a rest starts, moves endsAt for +30 s, and writes null on Skip or when it's over. Every
// write also sets syncAt (now).
package app.propertystars.planner.watch

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.abs

/** The session doc as last read, with the server's updated_at (what changes when either side writes). */
data class Live(val key: String, val doc: JSONObject, val updatedAt: String) {
    val finished: Boolean get() = doc.has("endedAt") || doc.optBoolean("discarded")
}

/** The running rest, in the watch's clock. afterEi / afterSi = the set it follows (-1 = not said). */
data class RestNow(val endsAtMs: Long, val total: Int, val afterEi: Int, val afterSi: Int, val by: String) {
    fun leftSec(nowMs: Long = System.currentTimeMillis()): Int = ((endsAtMs - nowMs + 999) / 1000).toInt()
    fun running(nowMs: Long = System.currentTimeMillis()): Boolean = endsAtMs > nowMs
}

/** What the person set on a set before ticking it. */
data class SetInput(val weight: Double, val reps: Int, val repsR: Int?, val seconds: Int?, val rpe: Double?)

class Sync(private val planner: Planner) {

    /** The session doc now, or null when it's gone. */
    suspend fun read(key: String): Live? {
        val r = planner.call("planner_get", JSONObject().put("p_kind", "workout").put("p_from", key).put("p_to", key))
        val list = r.optJSONArray("docs") ?: JSONArray()
        for (i in 0 until list.length()) {
            val d = list.optJSONObject(i) ?: continue
            if (d.optString("key") != key) continue
            val data = d.optJSONObject("data") ?: return null
            return Live(key, data, d.optString("updated_at")).also { memo = it }
        }
        return null
    }

    /** Read fresh, let `change` change the doc (false = nothing to write), write it back with syncAt. The doc as written,
     *  or null when nothing was written. updatedAt is left as read: the next poll sees the server's new one and takes it
     *  (it's the same doc). */
    suspend fun patch(key: String, change: (JSONObject) -> Boolean): Live? {
        writing++
        try {
            val fresh = read(key) ?: return null
            if (!change(fresh.doc)) return null
            fresh.doc.put("syncAt", Planner.isoNow())
            planner.put("workout", key, fresh.doc)
            return fresh.also { memo = it }
        } finally {
            writing--
        }
    }

    companion object {
        /** Writes going on: a poll is skipped while one is (it would bring back the doc from before it). */
        @Volatile var writing = 0
        /** The last copy either screen saw, so the rest screen starts from it at once. */
        @Volatile var memo: Live? = null
        /** A rest this watch skipped or finished: not shown again while the doc still has it (the write is on its way). */
        @Volatile var dismissed: Long = 0L
        /** The set this watch ticked last: the rest screen rates it (RPE) or un-does it. */
        @Volatile var lastDone: SetRef? = null
        /** Writes that should finish even when the screen that started them has gone (a recovery, a rest cleared). */
        val background = CoroutineScope(SupervisorJob() + Dispatchers.Main)

        fun later(block: suspend () -> Unit) {
            background.launch { try { block() } catch (_: Exception) { } }
        }

        fun parseMs(iso: String): Long? = try {
            OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        } catch (_: Exception) {
            try { Instant.parse(iso).toEpochMilli() } catch (_: Exception) { null }
        }

        fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

        /** The doc's rest, or null when none is set. */
        fun restOf(doc: JSONObject): RestNow? {
            val r = doc.optJSONObject("rest") ?: return null
            val ends = parseMs(r.optString("endsAt")) ?: return null
            val after = r.optJSONObject("after")
            return RestNow(ends, r.optInt("total", 0), after?.optInt("ei", -1) ?: -1, after?.optInt("si", -1) ?: -1, r.optString("by"))
        }

        fun restJson(r: RestNow?): Any {
            if (r == null) return JSONObject.NULL
            val o = JSONObject().put("endsAt", iso(r.endsAtMs)).put("total", r.total).put("by", r.by)
            if (r.afterEi >= 0 && r.afterSi >= 0) o.put("after", JSONObject().put("ei", r.afterEi).put("si", r.afterSi))
            return o
        }

        /** Where the exercise the watch means is now, as the phone's sync.ts finds it: at ei when the exerciseId there
         *  matches, else the first exercise with that exerciseId (it moved on the phone), else -1 (it's gone: do nothing). */
        fun exIndex(doc: JSONObject, ei: Int, exerciseId: String): Int {
            val exs = doc.optJSONArray("exercises") ?: return -1
            val there = exs.optJSONObject(ei)
            if (there != null && (exerciseId.isEmpty() || there.optString("exerciseId") == exerciseId)) return ei
            if (exerciseId.isEmpty()) return -1
            for (i in 0 until exs.length()) if (exs.optJSONObject(i)?.optString("exerciseId") == exerciseId) return i
            return -1
        }

        /** The set si of the exercise the watch means (see exIndex), or null. */
        fun setAt(doc: JSONObject, ei: Int, si: Int, exerciseId: String): JSONObject? {
            val at = exIndex(doc, ei, exerciseId)
            if (at < 0) return null
            return doc.optJSONArray("exercises")?.optJSONObject(at)?.optJSONArray("sets")?.optJSONObject(si)
        }

        /** An RPE as the phone keeps it: a whole number when it is one. */
        fun rpeJson(rpe: Double): Any = if (rpe % 1.0 == 0.0) rpe.toInt() else rpe

        // ── the changes each write makes (all on a doc just read) ──

        /** Weight, reps, RPE changed before ticking (the done flag is never touched here). */
        fun applyEdit(doc: JSONObject, ei: Int, si: Int, exerciseId: String, input: SetInput): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            putInput(s, input)
            return true
        }

        private fun putInput(s: JSONObject, input: SetInput) {
            if (input.seconds != null) s.put("seconds", input.seconds)
            else {
                s.put("weight", input.weight).put("reps", input.reps)
                if (input.repsR != null) s.put("repsR", input.repsR)
            }
            if (input.rpe != null) s.put("rpe", rpeJson(input.rpe)) else s.remove("rpe")
        }

        /** The RPE of one set (null = cleared), e.g. rated during the rest after it. */
        fun applyRpe(doc: JSONObject, ei: Int, si: Int, exerciseId: String, rpe: Double?): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            if (rpe != null) s.put("rpe", rpeJson(rpe)) else s.remove("rpe")
            return true
        }

        /** Tick a set: its numbers, done, doneAt, its heart rate, the session's heart rate. Already done on the doc (the
         *  phone ticked it first): it keeps its first doneAt. */
        fun applyDone(doc: JSONObject, ei: Int, si: Int, exerciseId: String, input: SetInput, setHr: SetHeart?, session: HeartSummary?, nowIso: String): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            putInput(s, input)
            markDone(s, nowIso)
            setHr?.let { putSetHr(s, it) }
            session?.let { addSessionHr(doc, it) }
            return true
        }

        /** Heart rate on a set the phone ticked while the watch was measuring it (only when it has none). */
        fun applySetHr(doc: JSONObject, ei: Int, si: Int, exerciseId: String, setHr: SetHeart): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            if (!s.optBoolean("done") || s.has("hr")) return false
            putSetHr(s, setHr)
            return true
        }

        private fun markDone(s: JSONObject, nowIso: String) {
            val first = s.optBoolean("done") && s.optString("doneAt").isNotEmpty()
            s.put("done", true)
            if (!first) s.put("doneAt", nowIso)
        }

        /** The rest after ticking set (ei, si), by the phone's rules: a rest already running after that very set keeps its
         *  clock; else `rest` starts (or, with none, the rest is cleared). The rest that's on the doc after this, or null. */
        fun applyRestAfterTick(doc: JSONObject, ei: Int, si: Int, rest: RestNow?): RestNow? {
            val cur = restOf(doc)
            if (cur != null && cur.running() && cur.afterEi == ei && cur.afterSi == si) return cur
            doc.put("rest", restJson(rest))
            return rest
        }

        private fun putSetHr(s: JSONObject, h: SetHeart) {
            val o = s.optJSONObject("hr") ?: JSONObject()
            o.put("avg", h.avg).put("max", h.max).put("n", h.n)
            s.put("hr", o)
        }

        /** The session's own average and peak, as Workout.logSet always did. */
        fun addSessionHr(doc: JSONObject, h: HeartSummary) {
            val old = doc.optJSONObject("hr")
            val n0 = old?.optInt("samples", 0) ?: 0
            val n = n0 + h.samples
            val avg = if (n0 == 0 || old == null) h.avg else ((old.optInt("avg") * n0 + h.avg * h.samples) / n)
            val max = maxOf(old?.optInt("max", 0) ?: 0, h.max)
            doc.put("hr", JSONObject().put("avg", avg).put("max", max).put("samples", n))
        }

        /** The recovery after a set, on that set's hr. */
        fun applyRecovery(doc: JSONObject, r: Recovered): Boolean {
            val s = setAt(doc, r.target.ei, r.target.si, r.target.exerciseId) ?: return false
            val hr = s.optJSONObject("hr") ?: return false
            hr.put("rec", r.rec).put("recSec", r.recSec)
            return true
        }

        /** Undo: the set isn't done any more (and a rest after it stops). */
        fun applyUndo(doc: JSONObject, ei: Int, si: Int, exerciseId: String): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            s.put("done", false)
            s.remove("doneAt")
            val r = restOf(doc)
            if (r != null && r.afterEi == exIndex(doc, ei, exerciseId) && r.afterSi == si) doc.put("rest", JSONObject.NULL)
            return true
        }

        /** Start or stop the rest. */
        fun applyRest(doc: JSONObject, rest: RestNow?): Boolean {
            doc.put("rest", restJson(rest))
            return true
        }

        /** +30 s on the rest that's on the doc (none = the other side ended it: nothing to add to). */
        fun applyExtend(doc: JSONObject, sec: Int): Boolean {
            val r = restOf(doc) ?: return false
            doc.put("rest", restJson(r.copy(endsAtMs = r.endsAtMs + sec * 1000L, total = r.total + sec)))
            return true
        }

        /** The rest ran out: clear only that rest (the same clock, or the same set it follows and no longer running), not
         *  a newer one the other side started. Skip clears whatever is running (applyRest null). */
        fun applyRestOver(doc: JSONObject, endsAtMs: Long, afterEi: Int, afterSi: Int): Boolean {
            val r = restOf(doc) ?: return false
            val same = abs(r.endsAtMs - endsAtMs) <= 1_000 || (afterEi >= 0 && r.afterEi == afterEi && r.afterSi == afterSi && !r.running())
            if (!same) return false
            doc.put("rest", JSONObject.NULL)
            return true
        }

        /** A timed set or one round of intervals finished. */
        fun applyTimed(doc: JSONObject, ei: Int, si: Int, exerciseId: String, seconds: Int, setHr: SetHeart?, session: HeartSummary?, nowIso: String): Boolean {
            val s = setAt(doc, ei, si, exerciseId) ?: return false
            if (s.optBoolean("done")) return false
            s.put("seconds", seconds)
            markDone(s, nowIso)
            setHr?.let { putSetHr(s, it) }
            session?.let { addSessionHr(doc, it) }
            return true
        }

        /** An EMOM / AMRAP clock stopped: each exercise of the block gets `counts[ei]` done copies of its first set
         *  (LiveWorkout.tsx clockDone). Each exercise is found by its id (exIndex); one that already has done sets on the
         *  doc (the phone logged the block meanwhile) is left as it is, so no done set is ever removed. */
        fun applyClock(doc: JSONObject, counts: Map<Int, Int>, exerciseIds: Map<Int, String>, session: HeartSummary?, nowIso: String): Boolean {
            val exs = doc.optJSONArray("exercises") ?: return false
            var any = false
            for ((ei0, n) in counts) {
                if (n <= 0) continue
                val ei = exIndex(doc, ei0, exerciseIds[ei0] ?: "")
                if (ei < 0) continue
                val ex = exs.optJSONObject(ei) ?: continue
                val old = ex.optJSONArray("sets") ?: JSONArray()
                if ((0 until old.length()).any { old.optJSONObject(it)?.optBoolean("done") == true }) continue
                val first = old.optJSONObject(0) ?: JSONObject().put("weight", 0).put("reps", 0)
                val sets = JSONArray()
                repeat(n) { sets.put(JSONObject(first.toString()).put("done", true).put("doneAt", nowIso)) }
                ex.put("sets", sets)
                any = true
            }
            if (any) session?.let { addSessionHr(doc, it) }
            return any
        }
    }
}
