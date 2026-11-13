// HabitRulesTest.kt — the habit rules on the watch (Today.kt HabitRules) give the same answers as the phone's
// (src/planner/features/habits/rules.test.ts, the same cases). Plain JUnit, no watch needed.
package app.propertystars.planner.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class HabitRulesTest {
    private val day = "2026-11-12"
    private val next = "2026-11-13"
    private fun at(d: String, hm: String, sec: Int = 0): Long {
        val (y, mo, dd) = d.split("-").map { it.toInt() }
        val (h, m) = hm.split(":").map { it.toInt() }
        return Calendar.getInstance().apply { clear(); set(y, mo - 1, dd, h, m, sec) }.timeInMillis
    }
    private fun counts(r: HabitRules.Rules, a: Long?, up: Long? = null, d: String = day) = HabitRules.countsFor(r, d, a, up)

    @Test
    fun noRulesAlwaysCounts() {
        assertTrue(counts(HabitRules.Rules(), at(day, "23:59")))
        assertTrue(counts(HabitRules.Rules(), null))
    }

    @Test
    fun by505TakesTheWholeMinute() {
        val r = HabitRules.Rules(by = "05:05")
        assertTrue(counts(r, at(day, "05:04")))
        assertTrue(counts(r, at(day, "05:05", 40)))
        assertFalse(counts(r, at(day, "05:06")))
    }

    @Test
    fun theDayStartsAt4am() {
        val r = HabitRules.Rules(by = "01:00")
        assertTrue(counts(r, at(day, "23:00")))
        assertTrue(counts(r, at(next, "00:30")))
        assertFalse(counts(r, at(next, "01:30")))
        assertFalse(counts(HabitRules.Rules(by = "23:00"), at(next, "00:30")))
    }

    @Test
    fun within30MinutesOfUp() {
        val r = HabitRules.Rules(withinUpMin = 30.0)
        val up = at(day, "05:20")
        assertTrue(counts(r, at(day, "05:50"), up))
        assertFalse(counts(r, at(day, "05:51"), up))
        assertFalse(counts(r, at(day, "05:10"), up))      // before Up
        assertFalse(counts(r, at(day, "05:30"), null))    // no Up that day
    }

    @Test
    fun bothRulesHaveToHold() {
        val r = HabitRules.Rules(by = "06:00", withinUpMin = 30.0)
        assertTrue(counts(r, at(day, "05:40"), at(day, "05:20")))
        assertFalse(counts(r, at(day, "06:10"), at(day, "05:50")))
        assertFalse(counts(r, at(day, "05:55"), at(day, "05:00")))
    }

    @Test
    fun aRuleButNoMomentDoesNotCount() {
        assertFalse(counts(HabitRules.Rules(by = "15:00"), null))
    }

    @Test
    fun itsOwnRulesElseItsTriggers() {
        assertEquals(HabitRules.Rules(withinUpMin = 30.0), HabitRules.rulesOf("gymStart", null, null))
        assertEquals(HabitRules.Rules(withinUpMin = 45.0), HabitRules.rulesOf("gymStart", null, 45))
        assertEquals(HabitRules.Rules(by = "05:05"), HabitRules.rulesOf("wake", "05:05", null))
        assertEquals(HabitRules.Rules(), HabitRules.rulesOf("wake", null, null))
        // malformed ones are left out
        assertEquals(HabitRules.Rules(), HabitRules.rulesOf("wake", "5:05", -3))
        assertEquals(HabitRules.Rules(), HabitRules.rulesOf("wake", "25:00", Double.NaN))
    }

    @Test
    fun startWorkoutsOwnRuleIsThirtyMinutes() {
        val r = HabitRules.TRIGGER_RULES.getValue("gymStart")
        assertTrue(counts(r, at(day, "05:49"), at(day, "05:20")))
        assertFalse(counts(r, at(day, "05:51"), at(day, "05:20")))
    }
}
