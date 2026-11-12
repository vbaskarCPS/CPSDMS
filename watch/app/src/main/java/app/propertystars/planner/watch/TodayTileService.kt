// TodayTileService.kt — the Today tile (swipe left from the watch face): the block you're in, what's next, protein left
// and habits done. Tap it to open the app. It draws from the last Today the watch loaded, then fetches a fresh one
// (a few seconds at most) so it's right when you look; the app asks it to redraw after every tick or set.
package app.propertystars.planner.watch

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

class TodayTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> = scope.future {
        val planner = Planner(this@TodayTileService)
        val fresh = if (planner.signedIn) withTimeoutOrNull(6_000) {
            try { Today(planner).load().toJson() } catch (_: Exception) { null }
        } else null
        val s = fresh ?: planner.kept("today")?.let { runCatching { JSONObject(it) }.getOrNull() }
        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES)
            .setFreshnessIntervalMillis(15 * 60 * 1000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout(planner.signedIn, s)))
            .build()
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        scope.future { ResourceBuilders.Resources.Builder().setVersion(RESOURCES).build() }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    private fun text(s: String, size: Float, color: Int, bold: Boolean = false, lines: Int = 1): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(s)
            .setMaxLines(lines)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(sp(size))
                    .setColor(argb(color))
                    .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                    .build(),
            )
            .build()

    private fun gap(h: Float) = LayoutElementBuilders.Spacer.Builder().setHeight(dp(h)).build()

    private fun layout(signedIn: Boolean, s: JSONObject?): LayoutElementBuilders.LayoutElement {
        val col = LayoutElementBuilders.Column.Builder()
            .setWidth(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        when {
            !signedIn -> {
                col.addContent(text("Planner", 16f, WHITE, bold = true))
                col.addContent(gap(4f))
                col.addContent(text("Tap to connect your planner", 12f, MUTED, lines = 2))
            }
            s == null -> col.addContent(text("Tap to open the planner", 12f, MUTED, lines = 2))
            else -> {
                col.addContent(text("NOW", 10f, ORANGE, bold = true))
                col.addContent(text(s.optString("now").ifEmpty { "—" }, 17f, WHITE, bold = true))
                s.optString("nowUntil").takeIf { it.isNotEmpty() }?.let { col.addContent(text("until ${clock(it)}", 12f, MUTED)) }
                col.addContent(gap(6f))
                col.addContent(text("${s.optInt("proteinLeft")} g protein left · ${s.optInt("habitsDone")}/${s.optInt("habits")} habits", 12f, WHITE, lines = 2))
                col.addContent(gap(6f))
                val next = s.optString("next")
                if (next.isNotEmpty()) col.addContent(text("Next · $next ${clock(s.optString("nextAt").ifEmpty { "00:00" })}", 12f, BLUE))
            }
        }
        val open = ModifiersBuilders.Clickable.Builder()
            .setId("open")
            .setOnClick(
                ActionBuilders.LaunchAction.Builder()
                    .setAndroidActivity(
                        ActionBuilders.AndroidActivity.Builder()
                            .setPackageName(packageName)
                            .setClassName(MainActivity::class.java.name)
                            .build(),
                    )
                    .build(),
            )
            .build()
        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())
            .addContent(col.build())
            .build()
    }

    private companion object {
        const val RESOURCES = "1"
        val WHITE = 0xFFFFFFFF.toInt()
        val MUTED = 0xFFBDBDBD.toInt()
        val ORANGE = 0xFFFF9A4D.toInt()
        val BLUE = 0xFF8FC1FF.toInt()
    }
}
