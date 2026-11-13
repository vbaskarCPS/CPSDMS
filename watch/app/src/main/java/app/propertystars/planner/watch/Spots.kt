// Spots.kt — the planner's watch-face spots (complications). Any watch face with spots can show them (press and hold the
// face › Customize), and the planner's own face (face/) uses them by default:
//   Protein left · Habits done · Steps · Next block
// They draw from the last Today the watch loaded (Today.kt keeps it) and the steps Health.kt keeps, fetching a fresh
// Today when there's time. Tapping one opens the app.
// The rings carry a colour from the look chosen on the phone (Look.kt): protein the accent, habits the green, steps
// the second colour. A face that doesn't read it keeps its own colours.
// ThemeSpot is not for showing: it carries the look's colours to the planner's own face (face/…/watchface.xml), which
// paints its background, words and rings with them, so the face wears the look chosen in the phone's Theme Studio.
package app.propertystars.planner.watch

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.data.ColorRamp
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

object Spots {
    private val all = listOf(ProteinSpot::class.java, HabitsSpot::class.java, StepsSpot::class.java, NextSpot::class.java, ThemeSpot::class.java)

    /** Redraw the tile and every spot (after a tick, a set, new steps). */
    fun refresh(ctx: Context) {
        try { TileService.getUpdater(ctx).requestUpdate(TodayTileService::class.java) } catch (_: Exception) { }
        for (c in all) {
            try { ComplicationDataSourceUpdateRequester.create(ctx, ComponentName(ctx, c)).requestUpdateAll() } catch (_: Exception) { }
        }
    }
}

abstract class PlannerSpot : SuspendingComplicationDataSourceService() {
    protected fun text(s: String) = PlainComplicationText.Builder(s).build()

    private fun open(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)

    /** What this spot shows, from the Today summary (null before the first load) and today's steps. */
    abstract fun make(type: ComplicationType, today: JSONObject?, steps: Int): ComplicationData?

    /** The look's colours, for the rings. */
    protected val look: WatchColors get() = Look.colorsFor(this)

    /** A ring: value of max, in `color` (one colour all the way round: the ramp is that colour twice). */
    protected fun ranged(value: Float, max: Float, short: String, title: String, says: String, color: Int): RangedValueComplicationData =
        RangedValueComplicationData.Builder(value.coerceIn(0f, maxOf(max, 1f)), 0f, maxOf(max, 1f), text(says))
            .setText(text(short)).setTitle(text(title)).setTapAction(open())
            .setColorRamp(ColorRamp(intArrayOf(color, color), true))
            .build()

    protected fun short(short: String, title: String, says: String): ShortTextComplicationData =
        ShortTextComplicationData.Builder(text(short), text(says)).setTitle(text(title)).setTapAction(open()).build()

    protected fun long(line: String, title: String): LongTextComplicationData =
        LongTextComplicationData.Builder(text(line), text(line)).setTitle(text(title)).setTapAction(open()).build()

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val planner = Planner(this)
        val fresh = if (planner.signedIn) withTimeoutOrNull(4_000) {
            try { Today(planner).load().toJson() } catch (_: Exception) { null }
        } else null
        val s = fresh ?: planner.kept("today")?.let { runCatching { JSONObject(it) }.getOrNull() }
        return make(request.complicationType, s, Health.stepsToday(this))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? = make(type, SAMPLE, 6_400)

    private companion object {
        val SAMPLE: JSONObject = JSONObject()
            .put("proteinEaten", 118).put("proteinGoal", 180).put("proteinLeft", 62)
            .put("habitsDone", 3).put("habits", 5).put("next", "Gym").put("nextAt", "11:00")
    }
}

class ProteinSpot : PlannerSpot() {
    override fun make(type: ComplicationType, today: JSONObject?, steps: Int): ComplicationData? {
        val eaten = today?.optInt("proteinEaten") ?: 0
        val goal = today?.optInt("proteinGoal", 160) ?: 160
        val left = maxOf(0, goal - eaten)
        return when (type) {
            ComplicationType.RANGED_VALUE -> ranged(eaten.toFloat(), goal.toFloat(), "${left}g", "protein", "$left grams of protein left", look.accent)
            ComplicationType.SHORT_TEXT -> short("${left}g", "protein", "$left grams of protein left")
            else -> null
        }
    }
}

class HabitsSpot : PlannerSpot() {
    override fun make(type: ComplicationType, today: JSONObject?, steps: Int): ComplicationData? {
        val done = today?.optInt("habitsDone") ?: 0
        val all = today?.optInt("habits") ?: 0
        return when (type) {
            ComplicationType.RANGED_VALUE -> ranged(done.toFloat(), all.toFloat(), "$done/$all", "habits", "$done of $all habits done", look.good)
            ComplicationType.SHORT_TEXT -> short("$done/$all", "habits", "$done of $all habits done")
            else -> null
        }
    }
}

class StepsSpot : PlannerSpot() {
    override fun make(type: ComplicationType, today: JSONObject?, steps: Int): ComplicationData? {
        val label = if (steps >= 1000) "%.1fk".format(steps / 1000f) else steps.toString()
        return when (type) {
            ComplicationType.RANGED_VALUE -> ranged(steps.toFloat(), Health.STEP_GOAL.toFloat(), label, "steps", "$steps steps today", look.second)
            ComplicationType.SHORT_TEXT -> short(label, "steps", "$steps steps today")
            else -> null
        }
    }
}

class NextSpot : PlannerSpot() {
    override fun make(type: ComplicationType, today: JSONObject?, steps: Int): ComplicationData? {
        val next = today?.optString("next").orEmpty()
        val at = today?.optString("nextAt").orEmpty()
        if (next.isEmpty()) return when (type) {
            ComplicationType.LONG_TEXT -> long("Open the planner", "Next")
            ComplicationType.SHORT_TEXT -> short("—", "next", "Nothing next")
            else -> null
        }
        val time = if (at.isNotEmpty()) clock(at) else ""
        return when (type) {
            ComplicationType.LONG_TEXT -> long("$next at $time", "Next")
            ComplicationType.SHORT_TEXT -> short(time.substringBefore(' '), next.take(10), "$next at $time")
            else -> null
        }
    }
}

/** The look's colours for the planner face: nine colours as "#rrggbb …" (Look.kt LookMath.faceColors says which is
 *  which). A hidden spot on the face that can't be swapped out, so it's always this one. It fetches the look itself every
 *  15 minutes (UPDATE_PERIOD_SECONDS), and the app and the tile redraw it when the look changes. No tap: it isn't seen. */
class ThemeSpot : SuspendingComplicationDataSourceService() {
    private fun make(colors: IntArray): ComplicationData {
        val list = LookMath.colorList(colors)
        return ShortTextComplicationData.Builder(PlainComplicationText.Builder(list).build(), PlainComplicationText.Builder("Planner colours").build())
            .setTitle(PlainComplicationText.Builder("CONFIGURED").build())
            .build()
    }

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        if (Planner(this).signedIn) withTimeoutOrNull(4_000) { try { Look.refresh(this@ThemeSpot) } catch (_: Exception) { false } }
        return make(Look.faceColorsFor(this))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) make(LookMath.faceColors(Look.FACE_PALETTES["own-night"]!!)) else null
}
