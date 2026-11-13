// HeartWindow.kt — the sums behind heart rate per set, kept apart from the sensor (Heart.kt) so the tests in src/test run
// on a computer. What's saved on each set (the session doc's sets[i].hr):
//   avg, max, n   during the set: from when it became the one to do (the rest before it ended, or the set before it was
//                 ticked) to when it's ticked done. Whole bpm; n = how many readings.
//   rec, recSec   the recovery after it: max minus the lowest bpm seen from its tick to the next set's start (the next
//                 set ticked or the rest ending, whichever is first), at most 120 s; recSec = the seconds that covered.
package app.propertystars.planner.watch

import kotlin.math.roundToInt

/** Heart rate during one set. */
data class SetHeart(val avg: Int, val max: Int, val n: Int)

/** One set of one session (the exercise's id too, so a set moved on the phone meanwhile isn't written over). */
data class SetRef(val key: String, val ei: Int, val si: Int, val exerciseId: String)

/** A finished recovery: how far heart rate fell (bpm) and over how many seconds. */
data class Recovered(val target: SetRef, val rec: Int, val recSec: Int)

/** The readings of the set that's on. Closed (id = null) between a tick and the next set's start: those readings are
 *  the recovery, not a set. */
class SetWindow {
    var id: String? = null
        private set
    private var sum = 0L
    private var n = 0
    private var max = 0

    /** The set `id` is the one to do now. The same id again carries on (the screen redraws, a poll comes in). */
    fun begin(id: String) {
        if (this.id == id) return
        this.id = id
        sum = 0; n = 0; max = 0
    }

    fun add(bpm: Int) {
        if (id == null) return
        sum += bpm; n++; if (bpm > max) max = bpm
    }

    /** The set was ticked: what it measured (null = no readings), and the window closes. */
    fun end(): SetHeart? {
        val r = if (n == 0) null else SetHeart((sum.toDouble() / n).roundToInt(), max, n)
        id = null; sum = 0; n = 0; max = 0
        return r
    }
}

/** The lowest heart rate after a set, for its recovery. */
class RecoveryWindow(val target: SetRef, private val max: Int, private val doneAtMs: Long) {
    private var low = Int.MAX_VALUE

    fun add(bpm: Int, atMs: Long) {
        if (atMs - doneAtMs in 0..CAP_MS && bpm < low) low = bpm
    }

    /** 120 s have passed since the tick: write it now. */
    fun due(nowMs: Long): Boolean = nowMs - doneAtMs >= CAP_MS

    /** The recovery as it stands at `nowMs` (null = no reading came in after the tick). */
    fun result(nowMs: Long): Recovered? {
        if (low == Int.MAX_VALUE) return null
        val sec = ((minOf(nowMs, doneAtMs + CAP_MS) - doneAtMs) / 1000).toInt()
        return Recovered(target, maxOf(0, max - low), maxOf(0, sec))
    }

    companion object {
        const val CAP_MS = 120_000L
    }
}
