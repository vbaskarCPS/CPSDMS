// FormatsTest.kt — the order the watch takes a session in (Formats.kt, the phone's format.ts and LiveWorkout.tsx), the
// "next up" line, the RPE choices and the heart-rate sums (HeartWindow.kt). Plain JUnit: runs on a computer, no watch.
package app.propertystars.planner.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun sets(n: Int, weight: Double = 0.0, reps: Int = 8, done: Int = 0) =
    List(n) { FSet(weight = weight, reps = reps, done = it < done) }

private fun ids(exs: List<FEx>) = Formats.steps(exs).map { it.id }

class FormatsTest {

    @Test
    fun `an exercise on its own is its sets in order`() {
        val exs = listOf(FEx("Bench Press", sets = sets(3, 135.0)), FEx("Row", sets = sets(2, 60.0)))
        assertEquals(listOf("S:0:0", "S:0:1", "S:0:2", "S:1:0", "S:1:1"), ids(exs))
        assertEquals("S:0:0", Formats.current(exs)?.id)
    }

    @Test
    fun `a superset goes round by round, rest only after the round`() {
        val exs = listOf(
            FEx("Curl", restSec = 30, group = "A", sets = sets(3, 25.0)),
            FEx("Pushdown", restSec = 75, group = "A", sets = sets(3, 40.0)),
        )
        assertEquals(listOf("superset"), Formats.blocksOf(exs).map { it.kind })
        assertEquals(listOf("S:0:0", "S:1:0", "S:0:1", "S:1:1", "S:0:2", "S:1:2"), ids(exs))
        // A1 done: no rest yet, B1 is next
        val a1 = exs.mapIndexed { i, e -> if (i == 0) e.copy(sets = sets(3, 25.0, done = 1)) else e }
        assertEquals(0, Formats.restAfter(a1, 0, 0))
        assertEquals("S:1:0", Formats.current(a1)?.id)
        // B1 done too: the round is over, the block's longest rest (as the phone does)
        val round = a1.mapIndexed { i, e -> if (i == 1) e.copy(sets = sets(3, 40.0, done = 1)) else e }
        assertEquals(75, Formats.restAfter(round, 1, 0))
        assertEquals("A2", Formats.steps(round).first { it.id == "S:1:0" }.tag)
    }

    @Test
    fun `a circuit of three, one short of sets, skips the missing set`() {
        val exs = listOf(
            FEx("Squat", group = "b", sets = sets(2)),
            FEx("Lunge", group = "b", sets = sets(1)),
            FEx("Plank", group = "b", mode = "time", sets = listOf(FSet(seconds = 30), FSet(seconds = 30))),
        )
        val b = Formats.blocksOf(exs).single()
        assertEquals("circuit", b.kind)
        assertEquals("B", b.letter)
        assertEquals(listOf("S:0:0", "S:1:0", "S:2:0", "S:0:1", "S:2:1"), ids(exs))
    }

    @Test
    fun `a group letter used once is just an exercise, unless it's an EMOM`() {
        assertEquals(listOf("single", "single"), Formats.blocksOf(listOf(FEx("A", group = "A"), FEx("B", group = "B"))).map { it.kind })
        assertEquals(listOf("emom"), Formats.blocksOf(listOf(FEx("Swing", group = "E", groupKind = "emom"))).map { it.kind })
    }

    @Test
    fun `a pyramid takes each set's own reps and weight`() {
        val ex = FEx("Squat", style = "pyramid", repsBySet = listOf(12, 10, 8, 6), weightBySet = listOf(95.0, 115.0, 135.0, 155.0),
            sets = List(4) { FSet() })
        assertEquals(Target(135.0, 8, 8, 30), Formats.target(ex, 2))
        assertEquals(listOf("S:0:0", "S:0:1", "S:0:2", "S:0:3"), ids(listOf(ex)))
        assertEquals("SET 3 OF 4 · PYRAMID", Formats.eyebrow(listOf(ex), Formats.steps(listOf(ex))[2]))
        // a number already on the set (the phone changed it) wins over the plan
        val changed = ex.copy(sets = ex.sets.mapIndexed { i, s -> if (i == 2) s.copy(weight = 140.0, reps = 7) else s })
        assertEquals(Target(140.0, 7, 7, 30), Formats.target(changed, 2))
    }

    @Test
    fun `EMOM and AMRAP are one clock, and the rounds they log`() {
        val exs = listOf(
            FEx("Swing", group = "C", groupKind = "emom", groupSec = 600, sets = sets(1, 24.0, 15)),
            FEx("Goblet Squat", group = "C", groupKind = "emom", groupSec = 600, sets = sets(1, 24.0, 10)),
        )
        val st = Formats.steps(exs)
        assertEquals(listOf("C:0"), st.map { it.id })
        val b = Formats.blocksOf(exs).single()
        // 10 minutes going round two moves: 5 each; 7 minutes: 4 and 3
        assertEquals(mapOf(0 to 5, 1 to 5), Formats.clockSets(b, 10))
        assertEquals(mapOf(0 to 4, 1 to 3), Formats.clockSets(b, 7))
        val amrap = FBlock("amrap", listOf(0, 1), "D")
        assertEquals(mapOf(0 to 6, 1 to 6), Formats.clockSets(amrap, 6))
        assertEquals(0, Formats.restAfter(exs, 0, 0))
        assertEquals("EMOM · 10 min · Swing, Goblet Squat", Formats.describe(exs, st[0]))
    }

    @Test
    fun `intervals run as one step and have no rest screen`() {
        val ex = FEx("Bike", exerciseId = "bike", mode = "time", restSec = 40, sets = List(8) { FSet(seconds = 20, done = it < 3) })
        assertTrue(Formats.isIntervals(ex))
        val s = Formats.current(listOf(ex))!!
        assertEquals(StepKind.Intervals, s.kind)
        assertEquals(3, s.si)
        assertEquals(0, Formats.restAfter(listOf(ex), 0, 2))
        // not cardio and no style: plain timed sets, rest after each
        val plank = FEx("Plank", exerciseId = "plank", mode = "time", restSec = 30, sets = List(3) { FSet(seconds = 45) })
        assertFalse(Formats.isIntervals(plank))
        assertEquals(30, Formats.restAfter(listOf(plank), 0, 0))
    }

    @Test
    fun `sets of reps rest 90 s when none is set, timed ones don't`() {
        assertEquals(90, Formats.restAfter(listOf(FEx("Row", sets = sets(3, 50.0, done = 1))), 0, 0))
        assertEquals(0, Formats.restAfter(listOf(FEx("Walk", mode = "time", sets = listOf(FSet(seconds = 600, done = true)))), 0, 0))
    }

    @Test
    fun `left and right, and nothing to load`() {
        assertTrue(Formats.hasSides(FEx("Bulgarian Split Squat")))
        assertTrue(Formats.hasSides(FEx("Side Plank")))
        assertTrue(Formats.hasSides(FEx("Lateral raise", targetReps = "10 per side")))
        assertFalse(Formats.hasSides(FEx("Bulgarian Split Squat", sides = false)))
        assertFalse(Formats.hasSides(FEx("Bench Press")))
        assertTrue(Formats.isNoLoad(FEx("Push-up", exerciseId = "push-up")))
        assertTrue(Formats.isNoLoad(FEx("Cat-cow")))
        assertFalse(Formats.isNoLoad(FEx("Goblet squat")))
        assertFalse(Formats.isNoLoad(FEx("Push-up", exerciseId = "push-up", sets = sets(2, 10.0))))
    }

    @Test
    fun `next up says what's coming`() {
        val exs = listOf(
            FEx("Bench Press", sets = sets(2, 135.0)),
            FEx("Split Squat", sides = true, sets = listOf(FSet(weight = 25.0, reps = 8, repsR = 8))),
            FEx("Plank", mode = "time", sets = listOf(FSet(seconds = 45))),
            FEx("Curl", group = "A", sets = sets(2, 25.0, 12)),
            FEx("Dip", group = "A", noLoad = true, sets = sets(2, 0.0, 10)),
        )
        val st = Formats.steps(exs)
        assertEquals("Bench Press · set 2 of 2 · 135 × 8", Formats.nextUp(exs, st[0]))
        assertEquals("Split Squat · set 1 of 1 · 25 × 8 L / 8 R", Formats.nextUp(exs, st[1]))
        assertEquals("Plank · set 1 of 1 · 0:45", Formats.nextUp(exs, st[2]))
        assertEquals("A1 Curl · round 1 of 2 · 25 × 12", Formats.nextUp(exs, st[3]))
        assertEquals("A2 Dip · round 1 of 2 · 10 reps", Formats.nextUp(exs, st[4]))
        assertEquals("Last one: then complete it on your phone", Formats.nextUp(exs, st.last()))
        assertEquals("SUPERSET A · ROUND 1 OF 2", Formats.eyebrow(exs, st[4]))
    }

    @Test
    fun `next up skips what the phone already ticked`() {
        val exs = listOf(FEx("Row", sets = sets(3, 60.0, done = 0).mapIndexed { i, s -> if (i == 1) s.copy(done = true) else s }))
        val st = Formats.steps(exs)
        assertEquals("Row · set 3 of 3 · 60 × 8", Formats.nextUp(exs, st[0]))
    }

    @Test
    fun `RPE choices are the phone's, tapped or turned`() {
        assertEquals(listOf(7.0, 8.0, 9.0, 10.0), Rpe.CHOICES)
        assertEquals(7.0, Rpe.turn(null, true))
        assertNull(Rpe.turn(7.0, false))
        assertEquals(9.0, Rpe.turn(8.5, true))
        assertEquals(10.0, Rpe.turn(10.0, true))
        assertNull(Rpe.tap(8.0, 8.0))
        assertEquals(9.0, Rpe.tap(8.0, 9.0))
    }
}

class HeartWindowTest {
    private val ref = SetRef("2026-11-13~abc", 0, 1, "bench-press")

    @Test
    fun `a set's heart rate is from its start to its tick`() {
        val w = SetWindow()
        w.add(100)                      // before any set is on: not counted
        w.begin("k|S:0:1")
        listOf(120, 130, 141).forEach { w.add(it) }
        w.begin("k|S:0:1")              // the same set again (a redraw): carries on
        w.add(150)
        assertEquals(SetHeart(avg = 135, max = 150, n = 4), w.end())
        w.add(160)                      // after the tick: the recovery's, not a set's
        assertNull(w.end())
    }

    @Test
    fun `recovery is the peak minus the lowest after the tick`() {
        val r = RecoveryWindow(ref, max = 150, doneAtMs = 10_000)
        r.add(140, 15_000); r.add(118, 70_000); r.add(125, 80_000)
        assertFalse(r.due(100_000))
        assertEquals(Recovered(ref, rec = 32, recSec = 75), r.result(85_000))
    }

    @Test
    fun `recovery stops counting at 120 s`() {
        val r = RecoveryWindow(ref, max = 150, doneAtMs = 0)
        r.add(130, 60_000)
        r.add(100, 125_000)             // after the cap: left out
        assertTrue(r.due(120_000))
        assertEquals(Recovered(ref, rec = 20, recSec = 120), r.result(200_000))
    }

    @Test
    fun `no reading after the tick, no recovery, and never below zero`() {
        assertNull(RecoveryWindow(ref, 150, 0).result(60_000))
        val r = RecoveryWindow(ref, max = 120, doneAtMs = 0)
        r.add(126, 5_000)
        assertEquals(0, r.result(10_000)!!.rec)
    }
}
