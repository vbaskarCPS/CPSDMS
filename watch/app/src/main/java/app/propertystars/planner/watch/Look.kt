// Look.kt — the watch wears the look chosen in the phone's Theme Studio (src/planner/features/look: the doc
// 'prefs' / 'look', its `all` = the whole planner's look, and the colours in looks.ts). The background stays black (it
// saves the battery, and the always-on screen is black anyway); the look gives the accent, a second colour and the
// text colours, each made light enough to read on black (at least 4.5 : 1, the usual least for small text; the accent 6 : 1).
// The choice is kept on the watch, so the first frame after opening already wears the last look; it is fetched again
// when the app opens or comes back, and when the tile asks for a fresh Today.
// The colours below are copied from looks.ts (LOOKS[…].palette and OWN_PALETTES dark): change them together.
package app.propertystars.planner.watch

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/** The colours the watch draws with, as ARGB numbers (the tile and the spots need plain numbers; the screens wrap
 *  them in Compose colours). */
data class WatchColors(
    val accent: Int,      // the main colour: the big buttons, NOW, the protein ring
    val onAccent: Int,    // words on an accent button
    val second: Int,      // the second colour: rest, what's next, the sauna, the steps ring
    val onSecond: Int,    // words on a second-colour button
    val good: Int,        // done (habits): the planner's green, which reads on black in every look
    val ink: Int,         // the main words
    val muted: Int,       // the smaller words
    val faint: Int,       // the faintest words (notes, problems)
    val card: Int,        // the boxes behind things: a little of the accent in near-black
)

/** The look's own colours, as looks.ts has them. */
data class LookPalette(val accent: Int, val accentInk: Int, val ink: Int, val ink2: Int, val amber: Int)

/** A look's full colours as looks.ts has them, for the planner watch face, which wears the look's own background
 *  (Spots.kt ThemeSpot sends them; face/…/watchface.xml paints with them). */
data class FacePalette(val bg: Int, val bg2: Int, val ink: Int, val ink2: Int, val line: Int, val accent: Int, val amber: Int, val amber2: Int)

/** The sums: contrast as the phone works it out (looks.ts `contrast`), and colours lightened until they read on black.
 *  Plain numbers only, no Android, so a plain test can check them (src/test/java/…/LookTest.kt). */
object LookMath {
    const val BLACK = 0xFF000000.toInt()
    private const val GOOD = 0xFF7EE0A8.toInt()
    private const val CARD_BASE = 0xFF161616.toInt()

    private fun ch(c: Int, shift: Int) = (c shr shift) and 0xFF
    private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)

    /** How bright a colour looks, 0 (black) to 1 (white): the WCAG sum, the same as looks.ts `lum`. */
    fun luminance(c: Int): Double {
        fun lin(v: Int): Double { val s = v / 255.0; return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(ch(c, 16)) + 0.7152 * lin(ch(c, 8)) + 0.0722 * lin(ch(c, 0))
    }

    /** How well two colours stand apart, 1 to 21 (looks.ts `contrast`). */
    fun contrast(a: Int, b: Int): Double {
        val x = luminance(a); val y = luminance(b)
        return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
    }

    /** `amount` (0 to 1) of `top` laid over `under` (looks.ts `mix`). */
    fun mix(under: Int, top: Int, amount: Double): Int {
        fun one(shift: Int) = Math.round(ch(under, shift) + (ch(top, shift) - ch(under, shift)) * amount).toInt()
        return argb(one(16), one(8), one(0))
    }

    // hue (0 to 360), saturation and lightness (0 to 1): lightening keeps the hue and the colourfulness, so a dark
    // green stays green rather than going grey the way mixing in white would
    fun toHsl(c: Int): DoubleArray {
        val r = ch(c, 16) / 255.0; val g = ch(c, 8) / 255.0; val b = ch(c, 0) / 255.0
        val max = maxOf(r, g, b); val min = minOf(r, g, b)
        val l = (max + min) / 2
        if (max == min) return doubleArrayOf(0.0, 0.0, l)
        val d = max - min
        val s = if (l > 0.5) d / (2 - max - min) else d / (max + min)
        val h = when (max) {
            r -> ((g - b) / d + (if (g < b) 6 else 0)) * 60
            g -> ((b - r) / d + 2) * 60
            else -> ((r - g) / d + 4) * 60
        }
        return doubleArrayOf(h, s, l)
    }

    fun fromHsl(h: Double, s: Double, l: Double): Int {
        if (s == 0.0) { val v = Math.round(l * 255).toInt(); return argb(v, v, v) }
        val q = if (l < 0.5) l * (1 + s) else l + s - l * s
        val p = 2 * l - q
        fun hue(t0: Double): Double {
            var t = t0
            if (t < 0) t += 1.0
            if (t > 1) t -= 1.0
            return when {
                t < 1.0 / 6 -> p + (q - p) * 6 * t
                t < 1.0 / 2 -> q
                t < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - t) * 6
                else -> p
            }
        }
        val hh = (((h % 360) + 360) % 360) / 360
        return argb(Math.round(hue(hh + 1.0 / 3) * 255).toInt(), Math.round(hue(hh) * 255).toInt(), Math.round(hue(hh - 1.0 / 3) * 255).toInt())
    }

    /** The colour, made lighter (same hue) until it stands `ratio` : 1 against black. A colour that already does is
     *  kept exactly as it is. White is the lightest there is (21 : 1), so this always ends. */
    fun lightenOnBlack(c: Int, ratio: Double = 4.5): Int {
        if (contrast(c, BLACK) >= ratio) return c or (0xFF shl 24)
        val (h, s, l0) = toHsl(c).let { Triple(it[0], it[1], it[2]) }
        var l = l0
        while (l < 1.0) {
            l = minOf(1.0, l + 0.01)
            val out = fromHsl(h, s, l)
            if (contrast(out, BLACK) >= ratio) return out
        }
        return 0xFFFFFFFF.toInt()
    }

    /** The colour made darker (same hue) as far as it can go while still standing `ratio` : 1 against black: for the
     *  fainter words, a step down from the smaller ones. Never lighter than it was. */
    fun dimOnBlack(c: Int, ratio: Double): Int {
        val start = lightenOnBlack(c, ratio)
        val (h, s, l0) = toHsl(start).let { Triple(it[0], it[1], it[2]) }
        var best = start
        var l = l0
        while (l > 0.0) {
            l = maxOf(0.0, l - 0.01)
            val out = fromHsl(h, s, l)
            if (contrast(out, BLACK) < ratio) break
            best = out
        }
        return best
    }

    /** Words on a button of colour `fill`: the look's own ink for its accent if that reads, else a very dark shade of
     *  the fill itself (as the watch had: dark brown on orange), else black. */
    fun inkOn(fill: Int, own: Int?): Int {
        if (own != null && contrast(own, fill) >= 4.5) return own or (0xFF shl 24)
        val dark = mix(fill, BLACK, 0.88)
        return if (contrast(dark, fill) >= 4.5) dark else BLACK
    }

    /** Two colours too alike to tell apart at a glance (near the same hue and brightness). */
    fun alike(a: Int, b: Int): Boolean {
        val x = toHsl(a); val y = toHsl(b)
        val dh = Math.abs(x[0] - y[0]).let { minOf(it, 360 - it) }
        val grey = x[1] < 0.15 || y[1] < 0.15
        return (grey || dh < 40) && contrast(a, b) < 1.6
    }

    /** Everything the watch draws with, from a look's colours. `custom` = an accent picked by hand, when there is one. */
    fun derive(p: LookPalette, custom: Int? = null): WatchColors {
        // 6 : 1, a little more than the least, so a button of it is bright and the dark words on it read well too
        val accent = lightenOnBlack(custom ?: p.accent, 6.0)
        // the second colour: the look's amber, unless it's the accent again (the planner's own looks, the gold ones):
        // then the colour across the wheel from the accent, as the watch always had orange and blue
        val amber = lightenOnBlack(p.amber, 6.0)
        val second = if (alike(amber, accent)) lightenOnBlack(toHsl(accent).let { fromHsl(it[0] + 180, minOf(1.0, it[1]), maxOf(0.6, it[2])) }, 6.0) else amber
        val ink = lightenOnBlack(p.ink, 15.0)                 // nearly white, with a little of the look in it
        val muted = lightenOnBlack(p.ink2, 9.0)                // the watch's grey was about 11 : 1
        val faint = dimOnBlack(muted, 5.0)                     // the faint grey was about 6.5 : 1
        val card = mix(CARD_BASE, accent, 0.10)
        return WatchColors(
            accent = accent, onAccent = inkOn(accent, if (custom == null) p.accentInk else null),
            second = second, onSecond = inkOn(second, null),
            good = GOOD, ink = ink, muted = muted, faint = faint, card = card,
        )
    }

    /** The nine colours the planner face paints with, in this order (the face reads them by place: 0, 1/8, 2/8 … 1):
     *  background, the "next" bar, the time and the main words, the date and the small words, the ring tracks,
     *  the protein ring, the habits ring, the steps ring, and the time once more (spare). On the look's own background:
     *  the second colour is whichever of the look's two ambers stands out more, and a ring colour that doesn't stand
     *  3 : 1 (the least for shapes) against the background is swapped for the look's ink. */
    fun faceColors(p: FacePalette, custom: Int? = null): IntArray {
        fun shows(c: Int) = if (contrast(c, p.bg) >= 3.0) c or (0xFF shl 24) else p.ink or (0xFF shl 24)
        val accent = shows(custom ?: p.accent)
        val second = shows(if (contrast(p.amber, p.bg) >= contrast(p.amber2, p.bg)) p.amber else p.amber2)
        val third = shows(p.ink2)
        return intArrayOf(p.bg, p.bg2, p.ink, p.ink2, p.line, accent, second, third, p.ink).map { it or (0xFF shl 24) }.toIntArray()
    }

    /** Colours as the face's colour list: "#rrggbb #rrggbb …". */
    fun colorList(cs: IntArray): String = cs.joinToString(" ") { "#%06x".format(it and 0xFFFFFF) }

    /** '#rrggbb' (or 'rrggbb') as a colour, or null. */
    fun hex(s: String?): Int? {
        val h = s?.trim()?.removePrefix("#") ?: return null
        if (!Regex("^[0-9a-fA-F]{6}$").matches(h)) return null
        return (0xFF shl 24) or h.toInt(16)
    }
}

object Look {
    private fun P(accent: Long, accentInk: Long, ink: Long, ink2: Long, amber: Long) =
        LookPalette(accent.toInt(), accentInk.toInt(), ink.toInt(), ink2.toInt(), amber.toInt())

    /** looks.ts LOOKS[id].palette (accent, accentInk, ink, ink2, amber), and the planner's own looks in their dark
     *  colours (OWN_PALETTES: navy for the night profile, plum for the morning one). */
    val PALETTES: Map<String, LookPalette> = mapOf(
        "woodland" to P(0xFF4A6741, 0xFFFBF8EE, 0xFF33261A, 0xFF5F4F3F, 0xFFE3B1AA),
        "cottagecore" to P(0xFFA14A60, 0xFFFFF8F0, 0xFF47312A, 0xFF6F574B, 0xFFF0D98A),
        "pastels" to P(0xFF7A55B0, 0xFFFFFFFF, 0xFF43345C, 0xFF6D5F88, 0xFFFFB7D0),
        "christmas" to P(0xFF9A1F2E, 0xFFFFF6E4, 0xFF213328, 0xFF4B5C50, 0xFFDCB95C),
        "autumn" to P(0xFFA8481A, 0xFFFFF5E3, 0xFF3A2212, 0xFF684A33, 0xFFE6AB55),
        "academia" to P(0xFFC9A55A, 0xFF211812, 0xFFF1E4C9, 0xFFC6B596, 0xFFD8B56A),
        "celestial" to P(0xFFE2C275, 0xFF17153A, 0xFFEFEAFF, 0xFFC4BCE4, 0xFFE9CC86),
        "minimal" to P(0xFF2F2E2B, 0xFFF8F5EF, 0xFF2A2927, 0xFF68625A, 0xFFCDBDA6),
        "french" to P(0xFF52668A, 0xFFFCF8F2, 0xFF37303D, 0xFF675D6C, 0xFFE6BCB8),
        "botanical" to P(0xFF2D6943, 0xFFF6FBF2, 0xFF1D3122, 0xFF4A614F, 0xFFE3A784),
        "countryside" to P(0xFF566A37, 0xFFFBF8EA, 0xFF2D3322, 0xFF595E46, 0xFFDCC078),
        "regency" to P(0xFF3C5C8C, 0xFFFFFFFF, 0xFF212E48, 0xFF535F78, 0xFFDAC38E),
        "coastal" to P(0xFF2B5983, 0xFFFFFFFF, 0xFF1B2D43, 0xFF4E6076, 0xFFE6CFA4),
        "spring" to P(0xFFBF386A, 0xFFFFFFFF, 0xFF24402D, 0xFF536C5C, 0xFFF6D860),
        "fairy" to P(0xFFF0B3E0, 0xFF2A1230, 0xFFF0F7E6, 0xFFB3CAB1, 0xFFF3E38A),
        "halloween" to P(0xFFF39A3D, 0xFF1B1423, 0xFFF6EAD8, 0xFFC6B6C9, 0xFFF4E3A1),
        "winter" to P(0xFF2D6C9C, 0xFFFFFFFF, 0xFF19314E, 0xFF4D6682, 0xFFCBD8E4),
        "mediterranean" to P(0xFF1C5CBB, 0xFFFFFFFF, 0xFF12305A, 0xFF486083, 0xFFF7D154),
        "retro70s" to P(0xFFDE6824, 0xFF2A1206, 0xFF3A1E0E, 0xFF6C492D, 0xFFF0B632),
        "stationery" to P(0xFFC43E2C, 0xFFFFFAF5, 0xFF32302D, 0xFF68645D, 0xFFF4CF7C),
        "coquette" to P(0xFFBD2D56, 0xFFFFFFFF, 0xFF482030, 0xFF784E5E, 0xFFF1DCC9),
        "own-night" to P(0xFFFFD166, 0xFF101C3A, 0xFFEEF2FF, 0xFFAAB4D4, 0xFFFFD166),
        "own-morning" to P(0xFFFF6FA8, 0xFF2A1545, 0xFFFDEEF7, 0xFFCDB5D9, 0xFFFF6FA8),
    )

    private fun F(bg: Long, bg2: Long, ink: Long, ink2: Long, line: Long, accent: Long, amber: Long, amber2: Long) =
        FacePalette(bg.toInt(), bg2.toInt(), ink.toInt(), ink2.toInt(), line.toInt(), accent.toInt(), amber.toInt(), amber2.toInt())

    /** looks.ts LOOKS[id].palette in full (bg, bg2, ink, ink2, line, accent, amber, amber2), and the planner's own looks
     *  in their dark colours, as above: for the planner watch face. */
    val FACE_PALETTES: Map<String, FacePalette> = mapOf(
        "woodland" to F(0xFFEEF0E1, 0xFFFCF9EF, 0xFF33261A, 0xFF5F4F3F, 0xFFD6D8BE, 0xFF4A6741, 0xFFE3B1AA, 0xFF8A4640),
        "cottagecore" to F(0xFFF6EDDA, 0xFFFFFAF0, 0xFF47312A, 0xFF6F574B, 0xFFE4D4B9, 0xFFA14A60, 0xFFF0D98A, 0xFF7A5F1C),
        "pastels" to F(0xFFFDF0F6, 0xFFFFFFFF, 0xFF43345C, 0xFF6D5F88, 0xFFF0DCEA, 0xFF7A55B0, 0xFFFFB7D0, 0xFFA8366A),
        "christmas" to F(0xFFF6EFE0, 0xFFFFFAF0, 0xFF213328, 0xFF4B5C50, 0xFFE0D4BB, 0xFF9A1F2E, 0xFFDCB95C, 0xFF775810),
        "autumn" to F(0xFFF4E8D3, 0xFFFDF6E8, 0xFF3A2212, 0xFF684A33, 0xFFE2CFAE, 0xFFA8481A, 0xFFE6AB55, 0xFF85500F),
        "academia" to F(0xFF211812, 0xFF2C2119, 0xFFF1E4C9, 0xFFC6B596, 0xFF4B3A2C, 0xFFC9A55A, 0xFFD8B56A, 0xFFE2C686),
        "celestial" to F(0xFF131230, 0xFF1D1B44, 0xFFEFEAFF, 0xFFC4BCE4, 0xFF37346A, 0xFFE2C275, 0xFFE9CC86, 0xFFF0D898),
        "minimal" to F(0xFFF3EFE8, 0xFFFBF9F5, 0xFF2A2927, 0xFF68625A, 0xFFE3DDD2, 0xFF2F2E2B, 0xFFCDBDA6, 0xFF71624C),
        "french" to F(0xFFF1EBE4, 0xFFFCF8F2, 0xFF37303D, 0xFF675D6C, 0xFFDED4C9, 0xFF52668A, 0xFFE6BCB8, 0xFF8A494E),
        "botanical" to F(0xFFECF1E4, 0xFFFCFDF8, 0xFF1D3122, 0xFF4A614F, 0xFFD3DCC8, 0xFF2D6943, 0xFFE3A784, 0xFF86481F),
        "countryside" to F(0xFFF3EEDD, 0xFFFDFAF0, 0xFF2D3322, 0xFF595E46, 0xFFDDD6BD, 0xFF566A37, 0xFFDCC078, 0xFF735618),
        "regency" to F(0xFFE7EDF4, 0xFFFBFCFD, 0xFF212E48, 0xFF535F78, 0xFFD0D9E5, 0xFF3C5C8C, 0xFFDAC38E, 0xFF6F571A),
        "coastal" to F(0xFFF4F0E6, 0xFFFFFDF8, 0xFF1B2D43, 0xFF4E6076, 0xFFDDD8C9, 0xFF2B5983, 0xFFE6CFA4, 0xFF785B25),
        "spring" to F(0xFFF3F8EB, 0xFFFFFFFF, 0xFF24402D, 0xFF536C5C, 0xFFDBE8D2, 0xFFBF386A, 0xFFF6D860, 0xFF7A5F00),
        "fairy" to F(0xFF10241E, 0xFF183228, 0xFFF0F7E6, 0xFFB3CAB1, 0xFF2D4B3E, 0xFFF0B3E0, 0xFFF3E38A, 0xFFF5EAA8),
        "halloween" to F(0xFF1B1423, 0xFF271D32, 0xFFF6EAD8, 0xFFC6B6C9, 0xFF40304F, 0xFFF39A3D, 0xFFF4E3A1, 0xFFF7C98B),
        "winter" to F(0xFFE8F1F8, 0xFFFFFFFF, 0xFF19314E, 0xFF4D6682, 0xFFCFDFEC, 0xFF2D6C9C, 0xFFCBD8E4, 0xFF46627C),
        "mediterranean" to F(0xFFF7F2E7, 0xFFFFFDF7, 0xFF12305A, 0xFF486083, 0xFFE0DAC8, 0xFF1C5CBB, 0xFFF7D154, 0xFF765900),
        "retro70s" to F(0xFFF6E7C8, 0xFFFFF6E0, 0xFF3A1E0E, 0xFF6C492D, 0xFFE6CF9F, 0xFFDE6824, 0xFFF0B632, 0xFF875800),
        "stationery" to F(0xFFF6F1E6, 0xFFFFFDF8, 0xFF32302D, 0xFF68645D, 0xFFDDD5C5, 0xFFC43E2C, 0xFFF4CF7C, 0xFF775610),
        "coquette" to F(0xFFFDEEF0, 0xFFFFFAFA, 0xFF482030, 0xFF784E5E, 0xFFF3D4DA, 0xFFBD2D56, 0xFFF1DCC9, 0xFF9F304C),
        "own-night" to F(0xFF101C3A, 0xFF182650, 0xFFEEF2FF, 0xFFAAB4D4, 0xFF26355F, 0xFFFFD166, 0xFFFFD166, 0xFFFFE08A),
        "own-morning" to F(0xFF2A1545, 0xFF382058, 0xFFFDEEF7, 0xFFCDB5D9, 0xFF4D2F6E, 0xFFFF6FA8, 0xFFFF6FA8, 0xFFFFA3C9),
    )

    /** The face's colours for the kept look (Spots.kt ThemeSpot). */
    fun faceColorsFor(context: Context): IntArray {
        val planner = Planner(context)
        val choice = kept(planner)
        val id = choice?.optString("id")?.ifEmpty { null }
        val pal = FACE_PALETTES[id ?: ""]?.takeIf { id != null && !id.startsWith("own") }
            ?: FACE_PALETTES[if (planner.profile == "morning") "own-morning" else "own-night"]!!
        return LookMath.faceColors(pal, LookMath.hex(choice?.optString("accent")))
    }

    /** The palette for a look id from prefs/look ('own' or anything unknown = the planner's own for this profile). */
    fun paletteFor(id: String?, profile: String): LookPalette =
        PALETTES[id ?: ""]?.takeIf { id != null && !id.startsWith("own") }
            ?: PALETTES[if (profile == "morning") "own-morning" else "own-night"]!!

    /** The colours for a saved choice ({ id, accent? }, as kept on the watch). */
    fun colorsOf(choice: JSONObject?, profile: String): WatchColors =
        LookMath.derive(paletteFor(choice?.optString("id")?.ifEmpty { null }, profile), LookMath.hex(choice?.optString("accent")))

    /** What the screens draw with. A Compose state: when it changes, every screen on show redraws in the new colours. */
    var colors: WatchColors by mutableStateOf(LookMath.derive(PALETTES["own-night"]!!))
        private set

    private var loaded = false

    /** Before the first frame: the look kept from last time (or the planner's own, the first time). */
    fun load(context: Context) {
        val planner = Planner(context)
        colors = colorsOf(kept(planner), planner.profile)
        loaded = true
    }

    /** For the tile and the spots, which run without the screens: the kept look's colours. */
    fun colorsFor(context: Context): WatchColors {
        if (loaded) return colors
        val planner = Planner(context)
        return colorsOf(kept(planner), planner.profile)
    }

    private fun kept(planner: Planner): JSONObject? = planner.kept("look")?.let { runCatching { JSONObject(it) }.getOrNull() }

    /** Fetch the look from the planner and keep it. True when it changed (then the tile and the spots need redrawing).
     *  Quiet when there's no connection: the kept look stays. */
    suspend fun refresh(context: Context): Boolean {
        val planner = Planner(context)
        if (!planner.signedIn) return false
        val doc = try { planner.doc("prefs", "look") } catch (_: Exception) { return false }
        // the whole planner's look ('own' when nothing has been chosen); an accent picked by hand, if one is ever saved
        val choice = JSONObject().put("id", doc?.optString("all")?.ifEmpty { null } ?: "own")
        LookMath.hex(doc?.optString("accent"))?.let { choice.put("accent", doc?.optString("accent")) }
        val before = planner.kept("look")
        val now = choice.toString()
        if (before != now) planner.keep("look", now)
        colors = colorsOf(choice, planner.profile)
        loaded = true
        return before != now
    }
}
