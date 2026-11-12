// MainActivity.kt — the watch app's screens. On every screen the top 30% is the time and the rest is the screen's own:
//   Pair       the 4-digit code to type into Settings › Watch on the phone
//   Today      now / next, protein left, habits done; buttons to Workout and Habits
//   Habits     today's habits and to-dos, ticked with a tap
//   Workout    the next set of the session that's on: weight and reps (buttons or the bezel), Done
//   Rest       the rest countdown, which buzzes at the end, then back to Workout
// Swiping right goes back to Today.
package app.propertystars.planner.watch

import android.Manifest
import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Text
import androidx.wear.tiles.TileService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

private val Orange = Color(0xFFFF9A4D)
private val Blue = Color(0xFF8FC1FF)
private val Green = Color(0xFF7EE0A8)
private val Card = Color(0xFF1C1C1C)
private val Muted = Color(0xFFBDBDBD)
private val Faint = Color(0xFF8E8E8E)

private enum class Screen { Pair, Today, Habits, Workout, Rest }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val planner = Planner(this)
        setContent { App(planner) }
    }
}

/** Ask the Today tile to draw itself again (after a tick or a set). */
private fun refreshTile(context: Context) {
    try { TileService.getUpdater(context).requestUpdate(TodayTileService::class.java) } catch (_: Exception) { }
}

private fun buzz(context: Context) {
    val v = context.getSystemService(Vibrator::class.java) ?: return
    v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300, 150, 500), -1))
}

@Composable
private fun App(planner: Planner) {
    var screen by remember { mutableStateOf(if (planner.signedIn) Screen.Today else Screen.Pair) }
    var restSec by remember { mutableIntStateOf(90) }
    var restNote by remember { mutableStateOf("") }
    if (screen != Screen.Today && screen != Screen.Pair) BackHandler { screen = Screen.Today }
    val signedOut = { screen = Screen.Pair }
    when (screen) {
        Screen.Pair -> PairScreen(planner) { screen = Screen.Today }
        Screen.Today -> TodayScreen(planner, onSignedOut = signedOut, open = { screen = it })
        Screen.Habits -> HabitsScreen(planner, onSignedOut = signedOut)
        Screen.Workout -> WorkoutScreen(planner, onSignedOut = signedOut) { sec, note ->
            restSec = sec; restNote = note
            screen = if (sec > 0) Screen.Rest else Screen.Workout
        }
        Screen.Rest -> RestScreen(restSec, restNote) { screen = Screen.Workout }
    }
}

// ───────────────────────── layout: the time on top, the screen below ─────────────────────────

@Composable
private fun Face(content: @Composable ColumnScope.() -> Unit) {
    val time by produceState(initialValue = clockNow()) {
        while (true) { value = clockNow(); delay(5_000) }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val top = maxHeight * 0.3f
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(top), contentAlignment = Alignment.BottomCenter) {
                Text(time, fontSize = 30.sp, color = Color.White, modifier = Modifier.padding(bottom = 6.dp))
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 36.dp).height(1.dp).background(Color(0xFF222222)))
            Column(
                Modifier.fillMaxWidth().weight(1f).padding(start = 22.dp, end = 22.dp, top = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
                content = content,
            )
        }
    }
}

private fun clockNow(): String = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())

@Composable
private fun Pill(label: String, fill: Color, ink: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(40.dp).clip(RoundedCornerShape(20.dp)).background(fill).clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = ink, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(
        Modifier.width(54.dp).clip(RoundedCornerShape(14.dp)).background(Card).padding(vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(label, color = Muted, fontSize = 9.sp, maxLines = 1)
    }
}

@Composable
private fun Message(text: String, color: Color = Muted) {
    Text(text, color = color, fontSize = 13.sp, textAlign = TextAlign.Center)
}

// ───────────────────────── Pair ─────────────────────────

@Composable
private fun PairScreen(planner: Planner, onDone: () -> Unit) {
    val pairing = remember { Pairing(planner) }
    var state by remember { mutableStateOf<PairState>(PairState.Starting) }
    LaunchedEffect(Unit) {
        state = try { pairing.start() } catch (_: Exception) { PairState.Problem("No connection. Check Wi-Fi or Bluetooth.") }
        while (state !is PairState.Done) {
            delay(4_000)
            try { pairing.poll()?.let { state = it } } catch (_: Exception) { /* try again on the next round */ }
        }
        onDone()
    }
    Face {
        Text("Connect to your planner", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        when (val s = state) {
            is PairState.Showing -> {
                Message("On your phone: Settings › Watch, then enter")
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    s.code.forEach { c ->
                        Box(Modifier.size(width = 28.dp, height = 36.dp).clip(RoundedCornerShape(8.dp)).background(Card), contentAlignment = Alignment.Center) {
                            Text(c.toString(), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                Message("A new code comes after 5 minutes", Faint)
            }
            is PairState.Problem -> Message(s.message, Orange)
            else -> Message("Getting a code…")
        }
    }
}

// ───────────────────────── Today ─────────────────────────

@Composable
private fun TodayScreen(planner: Planner, onSignedOut: () -> Unit, open: (Screen) -> Unit) {
    val today = remember { Today(planner) }
    val context = LocalContext.current
    var summary by remember { mutableStateOf<TodaySummary?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        while (true) {
            try { summary = today.load(); problem = null; refreshTile(context) }
            catch (_: SignedOut) { onSignedOut(); return@LaunchedEffect }
            catch (_: Exception) { problem = "No connection" }
            delay(60_000)
        }
    }
    Face {
        val s = summary
        if (s == null) { Message(problem ?: "Loading…"); return@Face }
        Text("NOW", color = Orange, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text(s.now?.label ?: "—", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        s.now?.until?.let { Text("until ${clock(it)}", color = Muted, fontSize = 11.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Stat("${s.proteinLeft} g", "protein left")
            Stat("${s.habitsDone} / ${s.habits.size}", "habits")
        }
        s.next?.let { Text("Next · ${it.label} ${clock(it.at)}", color = Blue, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("Workout", Orange, Color(0xFF1A0E00)) { open(Screen.Workout) }
            Pill("Habits", Card, Color.White) { open(Screen.Habits) }
        }
        problem?.let { Message(it, Faint) }
    }
}

// ───────────────────────── Habits and to-dos ─────────────────────────

private data class CheckRow(val id: String, val text: String, val done: Boolean, val habit: Boolean)

@Composable
private fun HabitsScreen(planner: Planner, onSignedOut: () -> Unit) {
    val today = remember { Today(planner) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var rows by remember { mutableStateOf<List<CheckRow>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    suspend fun reload() {
        try {
            val s = today.load()
            rows = s.habits.map { CheckRow(it.id, it.name, it.done, true) } + s.todos.map { CheckRow(it.id, it.text, it.done, false) }
            problem = null
        } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { problem = "No connection" }
    }
    LaunchedEffect(Unit) { reload() }
    Face {
        val list = rows
        val done = list?.count { it.done } ?: 0
        Text("TODAY · $done OF ${list?.size ?: 0}", color = Green, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        if (list == null) { Message(problem ?: "Loading…"); return@Face }
        if (list.isEmpty()) { Message("Nothing due today"); return@Face }
        ScalingLazyColumn(Modifier.fillMaxWidth().weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(list) { r ->
                Row(
                    Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(20.dp)).background(Card)
                        .clickable {
                            rows = list.map { if (it.id == r.id && it.habit == r.habit) it.copy(done = !r.done) else it }
                            scope.launch {
                                try {
                                    if (r.habit) today.toggleHabit(r.id, !r.done) else today.toggleTodo(r.id, !r.done)
                                    refreshTile(context)
                                } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { problem = "Couldn't save. Try again."; reload() }
                            }
                        }
                        .padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        Modifier.size(16.dp).clip(CircleShape)
                            .then(if (r.done) Modifier.background(Green) else Modifier.border(1.5.dp, Color(0xFF6E6E6E), CircleShape)),
                    )
                    Text(r.text, color = Color.White, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(if (r.habit) "habit" else "to-do", color = Muted, fontSize = 9.sp)
                }
            }
        }
        problem?.let { Message(it, Faint) }
    }
}

// ───────────────────────── Workout ─────────────────────────

@Composable
private fun WorkoutScreen(planner: Planner, onSignedOut: () -> Unit, onRest: (Int, String) -> Unit) {
    val workout = remember { Workout(planner) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var next by remember { mutableStateOf<NextSet?>(null) }
    var status by remember { mutableStateOf("Loading…") }
    var weight by remember { mutableStateOf(0.0) }
    var reps by remember { mutableIntStateOf(0) }
    var bpm by remember { mutableIntStateOf(0) }
    var saving by remember { mutableStateOf(false) }
    val heart = remember { Heart(context) { bpm = it } }
    val focus = remember { FocusRequester() }
    var turned by remember { mutableStateOf(0f) }

    // heart rate needs the sensor permission once
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) heart.start() }
    DisposableEffect(Unit) {
        val perm = Manifest.permission.BODY_SENSORS
        if (context.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED) heart.start() else ask.launch(perm)
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { heart.stop(); window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    LaunchedEffect(Unit) {
        try {
            val live = workout.live()
            if (live == null) { status = "No session on. Start one on your phone: Training › Start workout."; return@LaunchedEffect }
            val n = workout.nextSet(live.first, live.second)
            if (n == null) { status = "Every set is done. Complete the workout on your phone."; return@LaunchedEffect }
            next = n; weight = n.weight; reps = n.reps
        } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "No connection" }
    }
    LaunchedEffect(next) { if (next != null) try { focus.requestFocus() } catch (_: Exception) { } }

    val step = Workout.step(planner.units)
    Face {
        val n = next
        if (n == null) { Message(status); return@Face }
        Text(n.exercise, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(
            "Set ${n.setIndex + 1} of ${n.setCount} · ${n.targetReps}${if (bpm > 0) "  ♥ $bpm" else ""}",
            color = Orange, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        )
        if (n.timed) {
            Text("${n.seconds} s", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        } else {
            Column(
                Modifier
                    .onRotaryScrollEvent { e ->
                        turned += e.verticalScrollPixels
                        if (abs(turned) > 48f && !n.noLoad) {
                            weight = maxOf(0.0, weight + if (turned > 0) step else -step)
                            turned = 0f
                        }
                        true
                    }
                    .focusRequester(focus)
                    .focusable(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                if (!n.noLoad) Stepper("${Workout.fmtW(weight)} ${planner.units}", { weight = maxOf(0.0, weight - step) }, { weight += step })
                Stepper("$reps reps", { reps = maxOf(0, reps - 1) }, { reps += 1 })
            }
        }
        Pill(if (saving) "Saving…" else "Done", Orange, Color(0xFF1A0E00), Modifier.width(96.dp)) {
            if (saving) return@Pill
            saving = true
            scope.launch {
                try {
                    workout.logSet(n, weight, reps, heart.take())
                    refreshTile(context)
                    val last = if (n.timed) "${n.seconds} s" else "${Workout.fmtW(weight)} × $reps"
                    onRest(n.restSec, "Last: $last")
                } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't save. Try again." }
                saving = false
            }
        }
    }
}

@Composable
private fun Stepper(value: String, minus: () -> Unit, plus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        RoundButton("−", minus)
        Text(value, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.width(78.dp))
        RoundButton("+", plus)
    }
}

@Composable
private fun RoundButton(label: String, onClick: () -> Unit) {
    Box(Modifier.size(30.dp).clip(CircleShape).background(Card).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, color = Color.White, fontSize = 16.sp)
    }
}

// ───────────────────────── Rest ─────────────────────────

@Composable
private fun RestScreen(seconds: Int, note: String, onDone: () -> Unit) {
    val context = LocalContext.current
    var endsAt by remember { mutableStateOf(System.currentTimeMillis() + seconds * 1000L) }
    var left by remember { mutableIntStateOf(seconds) }
    LaunchedEffect(endsAt) {
        while (true) {
            left = ((endsAt - System.currentTimeMillis() + 999) / 1000).toInt()
            if (left <= 0) { buzz(context); onDone(); return@LaunchedEffect }
            delay(250)
        }
    }
    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    Face {
        Text("REST", color = Blue, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text("%d:%02d".format(maxOf(0, left) / 60, maxOf(0, left) % 60), color = Color.White, fontSize = 38.sp, fontWeight = FontWeight.Light)
        Text(note, color = Muted, fontSize = 11.sp)
        Spacer(Modifier.height(2.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("+30 s", Card, Color.White) { endsAt += 30_000L }
            Pill("Skip", Blue, Color(0xFF001A33)) { onDone() }
        }
    }
}
