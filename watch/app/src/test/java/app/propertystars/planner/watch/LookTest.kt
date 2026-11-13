// LookTest.kt — the watch's colour sums (Look.kt LookMath): every look the phone has ends up readable on the watch's
// black, and a look that already reads is left as it is. Plain JUnit, no watch needed (Android Studio: right-click › Run).
package app.propertystars.planner.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LookTest {
    private val black = LookMath.BLACK

    @Test
    fun contrastIsTheUsualSum() {
        assertEquals(21.0, LookMath.contrast(0xFFFFFFFF.toInt(), black), 0.01)
        assertEquals(1.0, LookMath.contrast(black, black), 0.0001)
        // the same numbers the phone's looks.ts contrast() gives for these pairs
        assertEquals(4.6895, LookMath.contrast(0xFF777777.toInt(), black), 0.0001)
        assertEquals(3.3076, LookMath.contrast(0xFF4A6741.toInt(), black), 0.0001)
    }

    @Test
    fun aDarkAccentIsLightenedUntilItReads() {
        val woodland = 0xFF4A6741.toInt()
        assertTrue(LookMath.contrast(woodland, black) < 4.5)
        val out = LookMath.lightenOnBlack(woodland, 4.5)
        assertTrue(LookMath.contrast(out, black) >= 4.5)
        // still green: the hue hardly moves
        assertEquals(LookMath.toHsl(woodland)[0], LookMath.toHsl(out)[0], 4.0)
    }

    @Test
    fun aLightAccentIsLeftAlone() {
        val gold = 0xFFFFD166.toInt()
        assertEquals(gold, LookMath.lightenOnBlack(gold, 4.5))
    }

    @Test
    fun everyLookReadsOnBlack() {
        for ((id, p) in Look.PALETTES) {
            val w = LookMath.derive(p)
            assertTrue("$id accent", LookMath.contrast(w.accent, black) >= 4.5)
            assertTrue("$id second", LookMath.contrast(w.second, black) >= 4.5)
            assertTrue("$id words on accent", LookMath.contrast(w.onAccent, w.accent) >= 4.5)
            assertTrue("$id words on second", LookMath.contrast(w.onSecond, w.second) >= 4.5)
            assertTrue("$id ink", LookMath.contrast(w.ink, black) >= 4.5)
            assertTrue("$id muted", LookMath.contrast(w.muted, black) >= 4.5)
            assertTrue("$id faint", LookMath.contrast(w.faint, black) >= 4.5)
            assertTrue("$id muted on a card", LookMath.contrast(w.muted, w.card) >= 4.5)
        }
    }

    @Test
    fun theSecondColourIsNotTheAccentAgain() {
        // the planner's own night look has gold for both: the watch picks the colour across the wheel instead
        val w = LookMath.derive(Look.PALETTES.getValue("own-night"))
        assertTrue(!LookMath.alike(w.accent, w.second))
    }

    @Test
    fun anAccentPickedByHandWins() {
        // a bright one is used as it is; a dark one is lightened like any other
        assertEquals(0xFF00FF00.toInt(), LookMath.derive(Look.PALETTES.getValue("woodland"), LookMath.hex("#00ff00")).accent)
        assertTrue(LookMath.contrast(LookMath.derive(Look.PALETTES.getValue("woodland"), LookMath.hex("#000080")).accent, black) >= 6.0)
        assertEquals(null, LookMath.hex("red"))
    }

    @Test
    fun anUnknownLookIsThePlannersOwn() {
        assertEquals(Look.PALETTES.getValue("own-morning"), Look.paletteFor("nope", "morning"))
        assertEquals(Look.PALETTES.getValue("own-night"), Look.paletteFor("own", "night"))
        assertEquals(Look.PALETTES.getValue("woodland"), Look.paletteFor("woodland", "night"))
    }
}
