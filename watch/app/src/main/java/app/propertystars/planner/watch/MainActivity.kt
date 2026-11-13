// MainActivity.kt — the watch app's screens. On every screen the top 30% is the time and the rest is the screen's own:
//   Pair       the 4-digit code to type into Settings › Watch on the phone
//   Today      now / next, protein left, habits done; buttons to Workout and Habits
//   Habits     today's habits and to-dos, ticked with a tap
//   Workout    the next step of the session in its order (Formats.kt): a set (weight, reps or left / right, RPE,
//              Done), a timed set, intervals, an EMOM / AMRAP clock; what's next; Undo
//   Rest       the rest countdown shared with the phone (Sync.kt), which buzzes at the end; RPE of the last set,
//              what's next, Undo; then back to Workout
//   Timers     I'm up, the race timer, the sauna
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.key
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Text
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

private enum class Screen { Pair, Today, Habits, Workout, Rest, Timers }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val planner = Planner(this)
        setContent { App(planner) }
    }
}

/** Ask the Today tile and the watch-face spots to draw themselves again (after a tick or a set). */
private fun refreshTile(context: Context) = Spots.refresh(context)

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
    if (screen != Screen.Pair) AskForSensors()
    val signedOut = { screen = Screen.Pair }
    when (screen) {
        Screen.Pair -> PairScreen(planner) { screen = Screen.Today }
        Screen.Today -> TodayScreen(planner, onSignedOut = signedOut, open = { screen = it })
        Screen.Habits -> HabitsScreen(planner, onSignedOut = signedOut)
        Screen.Workout -> WorkoutScreen(planner, onSignedOut = signedOut) { sec, note ->
            restSec = sec; restNote = note
            screen = if (sec > 0) Screen.Rest else Screen.Workout
        }
        Screen.Rest -> RestScreen(planner, restSec, restNote) { screen = Screen.Workout }
        Screen.Timers -> TimersScreen(planner, onSignedOut = signedOut)
    }
}

/** Once: steps (activity) and heart rate (body sensors), then heart rate in the background. Then daily health starts. */
@Composable
private fun AskForSensors() {
    val context = LocalContext.current
    val granted = { p: String -> context.checkSelfPermission(p) == android.content.pm.PackageManager.PERMISSION_GRANTED }
    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { Health.register(context, granted(Manifest.permission.BODY_SENSORS)) }
    val first = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val body = r[Manifest.permission.BODY_SENSORS] == true || granted(Manifest.permission.BODY_SENSORS)
        Health.register(context, body)
        if (body && android.os.Build.VERSION.SDK_INT >= 33 && !granted("android.permission.BODY_SENSORS_BACKGROUND")) background.launch("android.permission.BODY_SENSORS_BACKGROUND")
    }
    LaunchedEffect(Unit) {
        val need = listOf(Manifest.permission.ACTIVITY_RECOGNITION, Manifest.permission.BODY_SENSORS).filter { !granted(it) }
        if (need.isEmpty()) Health.register(context, true) else first.launch(need.toTypedArray())
    }
}

// ───────────────────────── layout: the time on top, the screen below ─────────────────────────

@Composable
private fun Face(scroll: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
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
                Modifier.fillMaxWidth().weight(1f)
                    .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = if (scroll) 24.dp else 0.dp),
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
            try { summary = today.load(); problem = null; refreshTile(context); try { Health.upload(context) } catch (_: Exception) { } }
            catch (_: SignedOut) { onSignedOut(); return@LaunchedEffect }
            catch (_: Exception) { problem = "No connection" }
            delay(60_000)
        }
    }
    Face(scroll = true) {
        val s = summary
        if (s == null) { Message(problem ?: "Loading…"); return@Face }
        Text("NOW", color = Orange, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text(s.now?.label ?: "—", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        s.now?.until?.let { Text("until ${clock(it)}", color = Muted, fontSize = 11.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Stat("${s.proteinLeft} g", "protein left")
            Stat("${s.habitsDone} / ${s.habits.size}", "habits")
            val steps = Health.stepsToday(context)
            Stat(if (steps >= 1000) "%.1fk".format(steps / 1000f) else "$steps", "steps")
        }
        s.next?.let { Text("Next · ${it.label} ${clock(it.at)}", color = Blue, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("Workout", Orange, Color(0xFF1A0E00)) { open(Screen.Workout) }
            Pill("Habits", Card, Color.White) { open(Screen.Habits) }
        }
        Pill("Timers", Card, Color.White) { open(Screen.Timers) }
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
// The step that's next in the session's order (Formats.kt): one set (weight, reps or left / right, RPE, Done), a timed
// set (a countdown that buzzes at 3-2-1 and at the end), intervals that run themselves, or an EMOM / AMRAP clock.
// Below it: what comes next. The session is read every 2 s while this is on screen, so a set ticked on the phone or a
// rest started there shows here too.

/** Which number the bezel turns: tap a number to pick it. */
private enum class WorkoutDial { Weight, Reps, RepsR, Rpe, Seconds }

/** Runs `each` every `ms` while the app is on screen (never in the background); `each` returning false stops it. */
private suspend fun workoutWhileVisible(context: Context, ms: Long, each: suspend () -> Boolean) {
    var going = true
    val owner = context as? LifecycleOwner
    if (owner == null) {
        while (going) { delay(ms); going = each() }
        return
    }
    owner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
        while (going) { delay(ms); going = each() }
    }
}

/** A short buzz (3-2-1, a new minute) or a long one (time's up). */
private fun workoutBuzz(context: Context, ms: Long) {
    val v = context.getSystemService(Vibrator::class.java) ?: return
    try { v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)) } catch (_: Exception) { }
}

/** "Last: 135 × 8" for the rest screen, from the set just done. */
private fun workoutLastLine(exs: List<FEx>, ei: Int, si: Int): String {
    val ex = exs.getOrNull(ei) ?: return ""
    if (si !in ex.sets.indices) return ""
    return "Last: ${Formats.whatLine(ex, si)}"
}

/** The newest set ticked in the session (one of a superset, or on its own), for Undo. Clocks and intervals are left out. */
private fun workoutLastDone(exs: List<FEx>): Step? =
    Formats.steps(exs).filter { it.kind == StepKind.Set && Formats.isDone(exs, it) }
        .maxByOrNull { Sync.parseMs(exs[it.ei].sets[it.si].doneAt) ?: 0L }

/** After 4 s with no workout or rest screen showing, write the recovery that was going (the watch left the workout). */
private fun workoutFlushLater(heart: Heart, sync: Sync) {
    Sync.later {
        delay(4_000)
        if (!heart.inUse) heart.endRecovery()?.let { r -> sync.patch(r.target.key) { d -> Sync.applyRecovery(d, r) } }
    }
}

@Composable
private fun WorkoutScreen(planner: Planner, onSignedOut: () -> Unit, onRest: (Int, String) -> Unit) {
    val workout = remember { Workout(planner) }
    val sync = remember { Sync(planner) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val heart = remember { Heart.get(context) }
    var live by remember { mutableStateOf<Live?>(null) }
    var status by remember { mutableStateOf("Loading…") }
    var saving by remember { mutableStateOf(false) }
    var offer by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    // the set being edited: its numbers, how many changes aren't written yet, and which step they belong to
    var weight by remember { mutableStateOf(0.0) }
    var reps by remember { mutableIntStateOf(0) }
    var repsR by remember { mutableIntStateOf(0) }
    var seconds by remember { mutableIntStateOf(30) }
    var rpe by remember { mutableStateOf<Double?>(null) }
    var edits by remember { mutableIntStateOf(0) }
    var editorFor by remember { mutableStateOf("") }
    var dial by remember { mutableStateOf(WorkoutDial.Weight) }
    var measuring by remember { mutableStateOf<Step?>(null) }
    var bpm by remember { mutableIntStateOf(0) }
    val focus = remember { FocusRequester() }
    var turned by remember { mutableStateOf(0f) }

    val exs = remember(live) { live?.doc?.let { Workout.parse(it) } ?: emptyList() }
    val step = remember(live) { if (live?.finished == true) null else Formats.current(exs) }
    val lastDone = remember(live) { workoutLastDone(exs) }

    /** The editor takes the doc's numbers for the current step: always when the step changed, else only when nothing
     *  typed here is still waiting to be written. */
    fun fill(l: Live) {
        val e = Workout.parse(l.doc)
        val s = Formats.current(e) ?: return
        if (editorFor == s.id && edits > 0) return
        val ex = e[s.ei]
        val t = Formats.target(ex, s.si)
        weight = t.weight; reps = t.reps; repsR = t.repsR; seconds = t.seconds
        rpe = ex.sets.getOrNull(s.si)?.rpe
        if (editorFor != s.id) {
            dial = when { ex.timed -> WorkoutDial.Seconds; Formats.isNoLoad(ex) -> WorkoutDial.Reps; else -> WorkoutDial.Weight }
            edits = 0
        }
        editorFor = s.id
    }

    /** A copy of the session came in (first load, a poll, our own write). */
    fun take(l: Live) {
        // a set ticked on the phone while the watch was measuring it: the watch puts its heart rate on it
        val m = measuring
        if (m != null) {
            val e = Workout.parse(l.doc)
            val ex = e.getOrNull(m.ei)
            if (ex?.sets?.getOrNull(m.si)?.done == true && heart.openSet() == "${l.key}|${m.id}") {
                measuring = null
                val h = heart.endSet()
                if (h != null) {
                    val nowMs = System.currentTimeMillis()
                    heart.endRecovery(nowMs)?.let { r -> Sync.later { sync.patch(r.target.key) { d -> Sync.applyRecovery(d, r) } } }
                    heart.startRecovery(SetRef(l.key, m.ei, m.si, ex.exerciseId), h.max, nowMs)
                    Sync.later { sync.patch(l.key) { d -> Sync.applySetHr(d, m.ei, m.si, ex.exerciseId, h) } }
                }
            }
        }
        live = l
        Sync.memo = l
        if (l.finished) { status = "This session is finished."; return }
        fill(l)
        // a rest started on the phone runs here too
        val r = Sync.restOf(l.doc)
        if (r != null && r.running() && abs(r.endsAtMs - Sync.dismissed) > 1_500 && !saving) {
            onRest(maxOf(1, r.leftSec()), workoutLastLine(Workout.parse(l.doc), r.afterEi, r.afterSi))
        }
    }

    suspend fun load() {
        val found = workout.live()
        if (found == null) {
            live = null
            offer = workout.todaysTemplate()
            status = if (offer == null) "No session planned. Set one up in Training on your phone." else ""
            return
        }
        offer = null
        // updated_at isn't known yet: the first poll fills it in
        take(Live(found.first, found.second, ""))
    }

    // heart rate needs the sensor permission once
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) heart.start() }
    DisposableEffect(Unit) {
        heart.acquire()
        val perm = Manifest.permission.BODY_SENSORS
        if (context.checkSelfPermission(perm) != android.content.pm.PackageManager.PERMISSION_GRANTED) ask.launch(perm)
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            heart.release()
            workoutFlushLater(heart, sync)
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    LaunchedEffect(reload) {
        try { load() } catch (_: SignedOut) { onSignedOut(); return@LaunchedEffect } catch (_: Exception) { status = "No connection" }
        workoutWhileVisible(context, 2_000) {
            val cur = live
            if (cur?.finished == true) return@workoutWhileVisible false
            if (Sync.writing > 0 || saving || edits > 0) return@workoutWhileVisible true
            try {
                // no session yet: one started on the phone shows up here
                if (cur == null) {
                    val found = workout.live()
                    if (found != null) { offer = null; take(Live(found.first, found.second, "")) }
                    return@workoutWhileVisible true
                }
                val l = sync.read(cur.key)
                if (l == null) { live = null; status = "This session is gone."; return@workoutWhileVisible false }
                if (l.updatedAt != cur.updatedAt) take(l)
                true
            } catch (_: SignedOut) { onSignedOut(); false } catch (_: Exception) { true }
        }
    }
    // the heart rate shown, and the recovery after the last set (written once 120 s have passed)
    LaunchedEffect(Unit) {
        while (true) {
            bpm = heart.bpmNow()
            heart.recoveryDue()?.let { r -> Sync.later { sync.patch(r.target.key) { d -> Sync.applyRecovery(d, r) } } }
            delay(1_000)
        }
    }
    // a new set is the one to do: its heart rate starts now (not during a rest: that's the last set's recovery)
    LaunchedEffect(live?.key, step?.id) {
        val s = step ?: return@LaunchedEffect
        val l = live ?: return@LaunchedEffect
        if (s.kind == StepKind.Set && Sync.restOf(l.doc)?.running() != true) {
            heart.beginSet("${l.key}|${s.id}")
            measuring = s
        }
    }
    // numbers changed on the watch: written 1.5 s after the last change, so the phone shows them too
    LaunchedEffect(edits) {
        if (edits == 0) return@LaunchedEffect
        delay(1_500)
        val l = live ?: return@LaunchedEffect
        val s = step ?: return@LaunchedEffect
        val ex = exs.getOrNull(s.ei) ?: return@LaunchedEffect
        val input = SetInput(weight, reps, if (Formats.hasSides(ex)) repsR else null, if (ex.timed) seconds else null, rpe)
        edits = 0
        Sync.later { sync.patch(l.key) { d -> Sync.applyEdit(d, s.ei, s.si, ex.exerciseId, input) } }
    }
    LaunchedEffect(step?.id) { if (step != null) try { focus.requestFocus() } catch (_: Exception) { } }

    /** Tick the set: its numbers, its heart rate, the recovery of the one before, and the rest after it, in one write. */
    fun done(s: Step, ex: FEx, input: SetInput) {
        if (saving) return
        val l = live ?: return
        saving = true
        edits = 0
        val nowMs = System.currentTimeMillis()
        val setHr = heart.endSet()
        measuring = null
        val before = heart.endRecovery(nowMs)
        val session = heart.take()
        var rest: RestNow? = null
        var at = s.ei
        scope.launch {
            try {
                val written = sync.patch(l.key) { d ->
                    if (!Sync.applyDone(d, s.ei, s.si, ex.exerciseId, input, setHr, session, Planner.isoNow())) return@patch false
                    if (before != null && before.target.key == l.key) Sync.applyRecovery(d, before)
                    // the exercise may have moved on the phone: the rest follows it where it is now
                    at = Sync.exIndex(d, s.ei, ex.exerciseId)
                    val sec = Formats.restAfter(Workout.parse(d), at, s.si)
                    rest = Sync.applyRestAfterTick(d, at, s.si, if (sec > 0) RestNow(nowMs + sec * 1000L, sec, at, s.si, "watch") else null)
                    true
                }
                if (written == null) {
                    status = "That set changed on your phone."
                    sync.read(l.key)?.let { take(it) }
                } else {
                    val ref = SetRef(l.key, at, s.si, ex.exerciseId)
                    Sync.lastDone = ref
                    if (setHr != null) heart.startRecovery(ref, setHr.max, nowMs)
                    if (before != null && before.target.key != l.key) Sync.later { sync.patch(before.target.key) { d -> Sync.applyRecovery(d, before) } }
                    refreshTile(context)
                    status = ""
                    val r = rest
                    if (r != null && r.running()) {
                        live = written; Sync.memo = written
                        onRest(maxOf(1, r.leftSec()), workoutLastLine(Workout.parse(written.doc), at, s.si))
                    } else take(written)
                }
            } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't save. Try again." }
            saving = false
        }
    }

    /** One round of intervals ended (they run on by themselves: no rest screen). */
    fun intervalRound(s: Step, ex: FEx, index: Int, sec: Int) {
        val l = live ?: return
        val session = heart.take()
        scope.launch {
            try { sync.patch(l.key) { d -> Sync.applyTimed(d, s.ei, index, ex.exerciseId, sec, null, session, Planner.isoNow()) }?.let { take(it) } }
            catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't save that round." }
        }
    }

    /** The EMOM / AMRAP clock stopped: the rounds go on as done sets. */
    fun clockDone(s: Step, count: Int) {
        val l = live ?: return
        val b = Formats.blocksOf(exs).getOrNull(s.block) ?: return
        if (count <= 0) return
        val counts = Formats.clockSets(b, count)
        val ids = b.at.associateWith { exs[it].exerciseId }
        val session = heart.take()
        saving = true
        scope.launch {
            try {
                val w = sync.patch(l.key) { d -> Sync.applyClock(d, counts, ids, session, Planner.isoNow()) }
                if (w == null) status = "That block changed on your phone." else { refreshTile(context); take(w) }
            } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't save. Try again." }
            saving = false
        }
    }

    fun undo(s: Step) {
        val l = live ?: return
        val ex = exs.getOrNull(s.ei) ?: return
        if (saving) return
        saving = true
        heart.cancelRecovery(l.key, s.ei, s.si)
        scope.launch {
            try { sync.patch(l.key) { d -> Sync.applyUndo(d, s.ei, s.si, ex.exerciseId) }?.let { editorFor = ""; take(it) }; refreshTile(context) }
            catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't save. Try again." }
            saving = false
        }
    }

    val step5 = Workout.step(planner.units)
    Face(scroll = true) {
        val o = offer
        if (live == null && o != null) {
            Text("TODAY'S SESSION", color = Orange, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Text(o.optString("name"), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2)
            Text("${o.optJSONArray("exercises")?.length() ?: 0} exercises", color = Muted, fontSize = 11.sp)
            Pill(if (saving) "Starting…" else "Start workout", Orange, Color(0xFF1A0E00), Modifier.width(130.dp)) {
                if (saving) return@Pill
                saving = true
                scope.launch {
                    try { workout.start(o); refreshTile(context); reload++ }
                    catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { status = "Couldn't start. Try again." }
                    saving = false
                }
            }
            if (status.isNotEmpty()) Message(status, Faint)
            return@Face
        }
        val l = live
        val s = step
        if (l == null) { Message(status); return@Face }
        if (s == null) {
            Message(if (l.finished) "This session is finished." else "Every set is done. Complete the workout on your phone.")
            if (!l.finished) lastDone?.let { d -> WorkoutUndo(saving) { undo(d) } }
            return@Face
        }
        val ex = exs[s.ei]
        val sides = Formats.hasSides(ex)
        val noLoad = Formats.isNoLoad(ex)
        Text(
            Formats.eyebrow(exs, s) + if (bpm > 0) "  ♥ $bpm" else "",
            color = Orange, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (s.kind == StepKind.Clock) Formats.blocksOf(exs).getOrNull(s.block)?.at?.joinToString(" + ") { exs[it].name } ?: ex.name
            else (if (s.tag.isNotEmpty()) "${s.tag}  " else "") + ex.name,
            color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
        ex.repsBySet.getOrNull(s.si)?.takeIf { s.kind == StepKind.Set && !ex.timed }?.let { Text("aim $it reps", color = Muted, fontSize = 10.sp) }

        when (s.kind) {
            StepKind.Clock -> {
                val b = Formats.blocksOf(exs)[s.block]
                key(s.id) {
                    WorkoutClock(
                        kind = b.kind, totalSec = Formats.clockSec(exs, b),
                        moves = b.at.map { i -> Formats.whatLine(exs[i], 0) + " " + exs[i].name },
                        saving = saving,
                    ) { count -> clockDone(s, count) }
                }
            }
            StepKind.Intervals -> key(s.id) {
                WorkoutIntervals(
                    rounds = ex.sets.size, work = ex.sets.firstOrNull()?.seconds?.takeIf { it > 0 } ?: 20, rest = ex.restSec,
                    doneCount = ex.sets.count { it.done },
                ) { index, sec -> intervalRound(s, ex, index, sec) }
            }
            StepKind.Set -> if (ex.timed) {
                key(s.id) {
                    WorkoutTimedSet(seconds, sides, saving, onTarget = { seconds = maxOf(5, it); edits++ }) { sec ->
                        done(s, ex, SetInput(0.0, 0, null, sec, rpe))
                    }
                }
            } else {
                Column(
                    Modifier
                        .onRotaryScrollEvent { e ->
                            turned += e.verticalScrollPixels
                            if (abs(turned) > 48f) {
                                val up = turned > 0
                                when (dial) {
                                    WorkoutDial.Weight -> if (!noLoad) weight = maxOf(0.0, weight + if (up) step5 else -step5)
                                    WorkoutDial.Reps -> reps = maxOf(0, reps + if (up) 1 else -1)
                                    WorkoutDial.RepsR -> repsR = maxOf(0, repsR + if (up) 1 else -1)
                                    WorkoutDial.Rpe -> rpe = Rpe.turn(rpe, up)
                                    WorkoutDial.Seconds -> {}
                                }
                                edits++
                                turned = 0f
                            }
                            true
                        }
                        .focusRequester(focus)
                        .focusable(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (!noLoad) WorkoutStepper("${Workout.fmtW(weight)} ${planner.units}", dial == WorkoutDial.Weight, { dial = WorkoutDial.Weight },
                        { weight = maxOf(0.0, weight - step5); edits++ }, { weight += step5; edits++ })
                    if (sides) {
                        WorkoutStepper("$reps left", dial == WorkoutDial.Reps, { dial = WorkoutDial.Reps }, { reps = maxOf(0, reps - 1); edits++ }, { reps += 1; edits++ })
                        WorkoutStepper("$repsR right", dial == WorkoutDial.RepsR, { dial = WorkoutDial.RepsR }, { repsR = maxOf(0, repsR - 1); edits++ }, { repsR += 1; edits++ })
                    } else {
                        WorkoutStepper("$reps reps", dial == WorkoutDial.Reps, { dial = WorkoutDial.Reps }, { reps = maxOf(0, reps - 1); edits++ }, { reps += 1; edits++ })
                    }
                    WorkoutRpeRow(rpe, dial == WorkoutDial.Rpe) { v -> rpe = v; dial = WorkoutDial.Rpe; edits++ }
                }
                WorkoutDone(if (saving) "Saving…" else "Done") {
                    done(s, ex, SetInput(if (noLoad) 0.0 else weight, reps, if (sides) repsR else null, null, rpe))
                }
            }
        }
        WorkoutNextUp(Formats.nextUp(exs, s))
        lastDone?.let { d -> WorkoutUndo(saving) { undo(d) } }
        if (status.isNotEmpty() && status != "Loading…") Message(status, Faint)
    }
}

/** − value +. Tapping the value makes it the one the bezel turns (it shows in orange). */
@Composable
private fun WorkoutStepper(value: String, dialed: Boolean, pick: () -> Unit, minus: () -> Unit, plus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        WorkoutRound("−", minus)
        Text(
            value, color = if (dialed) Orange else Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 1,
            modifier = Modifier.width(84.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = pick).padding(vertical = 6.dp),
        )
        WorkoutRound("+", plus)
    }
}

@Composable
private fun WorkoutRound(label: String, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(CircleShape).background(Card).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, color = Color.White, fontSize = 18.sp)
    }
}

/** How hard it was: 7 8 9 10 (the phone's choices). Tap one; tap it again to clear. */
@Composable
private fun WorkoutRpeRow(rpe: Double?, dialed: Boolean, onPick: (Double?) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("RPE", color = if (dialed) Orange else Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
        Rpe.CHOICES.forEach { c ->
            val on = rpe == c
            Box(
                Modifier.size(width = 34.dp, height = 40.dp).clip(RoundedCornerShape(12.dp)).background(if (on) Orange else Card)
                    .clickable { onPick(Rpe.tap(rpe, c)) },
                contentAlignment = Alignment.Center,
            ) { Text(Rpe.label(c), color = if (on) Color(0xFF1A0E00) else Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
        }
    }
    // a value the phone wrote between the choices (8.5) still shows
    if (rpe != null && rpe !in Rpe.CHOICES) Text("RPE ${Rpe.label(rpe)}", color = Muted, fontSize = 10.sp)
}

/** The big Done button. */
@Composable
private fun WorkoutDone(label: String, onClick: () -> Unit) {
    Box(
        Modifier.width(120.dp).height(48.dp).clip(RoundedCornerShape(24.dp)).background(Orange).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color(0xFF1A0E00), fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
}

/** "NEXT · Row · round 2 of 3 · 60 × 10". */
@Composable
private fun WorkoutNextUp(line: String) {
    if (line.isEmpty()) return
    Spacer(Modifier.height(2.dp))
    Text("NEXT", color = Blue, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
    Text(line, color = Blue, fontSize = 12.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun WorkoutUndo(saving: Boolean, onClick: () -> Unit) {
    Spacer(Modifier.height(2.dp))
    Pill(if (saving) "Saving…" else "Undo last set", Card, Color.White, Modifier.width(140.dp)) { if (!saving) onClick() }
}

/** A timed set: Start, then the countdown (each side in turn, 5 s to switch), a buzz at 3-2-1 and at the end.
 *  Done stops it early with the seconds done. Before it starts, − / + change the time by 5 s. */
@Composable
private fun WorkoutTimedSet(target: Int, sides: Boolean, saving: Boolean, onTarget: (Int) -> Unit, onDone: (Int) -> Unit) {
    val context = LocalContext.current
    var endsAt by remember { mutableStateOf(0L) }
    var stage by remember { mutableIntStateOf(0) }   // 0 = the (first) side, 1 = switching sides, 2 = the second side
    var total by remember { mutableIntStateOf(target) }
    var left by remember { mutableIntStateOf(target) }
    var beeped by remember { mutableIntStateOf(-1) }
    LaunchedEffect(endsAt, stage) {
        if (endsAt == 0L) return@LaunchedEffect
        while (true) {
            val now = System.currentTimeMillis()
            left = maxOf(0, ((endsAt - now + 999) / 1000).toInt())
            if (left in 1..3 && left != beeped) { beeped = left; workoutBuzz(context, 80) }
            if (now >= endsAt) {
                workoutBuzz(context, 450)
                beeped = -1
                when {
                    sides && stage == 0 -> { stage = 1; endsAt = now + 5_000L }
                    sides && stage == 1 -> { stage = 2; endsAt = now + total * 1000L }
                    else -> { endsAt = 0L; stage = 0; onDone(total) }
                }
                return@LaunchedEffect
            }
            delay(200)
        }
    }
    if (endsAt == 0L) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkoutRound("−") { onTarget(target - 5) }
            Text(Formats.fmtSec(target), color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.width(84.dp))
            WorkoutRound("+") { onTarget(target + 5) }
        }
        if (sides) Text("each side", color = Muted, fontSize = 10.sp)
        WorkoutDone(if (saving) "Saving…" else "Start") {
            if (saving) return@WorkoutDone
            total = target; left = target; stage = 0; beeped = -1
            endsAt = System.currentTimeMillis() + target * 1000L
        }
        return
    }
    Text(Formats.fmtSec(left), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
    if (sides) Text(if (stage == 0) "Left" else if (stage == 1) "Switch sides" else "Right", color = Orange, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    WorkoutDone("Done") {
        val spent = if (stage == 1) total else total - left
        endsAt = 0L; stage = 0
        onDone(maxOf(1, spent))
    }
}

/** Intervals that run themselves: Start, 5 s to get ready, then work, rest, work … with a buzz at every change.
 *  Each round is saved as it ends, so stopping part-way keeps what was done. */
@Composable
private fun WorkoutIntervals(rounds: Int, work: Int, rest: Int, doneCount: Int, onRound: (Int, Int) -> Unit) {
    val context = LocalContext.current
    var phase by remember { mutableStateOf("idle") }   // idle, ready, work, rest
    var endsAt by remember { mutableStateOf(0L) }
    var round by remember { mutableIntStateOf(doneCount) }
    var left by remember { mutableIntStateOf(0) }
    var beeped by remember { mutableIntStateOf(-1) }
    LaunchedEffect(phase, endsAt) {
        if (phase == "idle") return@LaunchedEffect
        while (true) {
            val now = System.currentTimeMillis()
            left = maxOf(0, ((endsAt - now + 999) / 1000).toInt())
            if (left in 1..3 && left != beeped) { beeped = left; workoutBuzz(context, 80) }
            if (now >= endsAt) {
                workoutBuzz(context, 400)
                beeped = -1
                when (phase) {
                    "work" -> {
                        onRound(round, work)
                        round += 1
                        when {
                            round >= rounds -> { phase = "idle"; endsAt = 0L }
                            rest > 0 -> { phase = "rest"; endsAt = now + rest * 1000L }
                            else -> endsAt = now + work * 1000L
                        }
                    }
                    else -> { phase = "work"; endsAt = now + work * 1000L }
                }
                return@LaunchedEffect
            }
            delay(200)
        }
    }
    if (phase == "idle") {
        Text("$rounds × ${Formats.fmtSec(work)}" + if (rest > 0) " · rest ${Formats.fmtSec(rest)}" else "", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        if (doneCount > 0) Text("$doneCount done", color = Muted, fontSize = 10.sp)
        WorkoutDone(if (doneCount > 0) "Carry on" else "Start") {
            round = doneCount; beeped = -1
            phase = "ready"; endsAt = System.currentTimeMillis() + 5_000L
        }
        return
    }
    Text(
        when (phase) { "ready" -> "Get ready"; "work" -> "Go"; else -> "Rest" } + " · round ${minOf(rounds, round + 1)} of $rounds",
        color = if (phase == "work") Orange else Blue, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
    )
    Text(Formats.fmtSec(left), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
    Pill("Stop", Card, Color.White, Modifier.width(96.dp)) { phase = "idle"; endsAt = 0L }
}

/** An EMOM or AMRAP clock: Start, 5 s to get ready, then the block's minutes. EMOM: a buzz every minute and the move
 *  for that minute. AMRAP: +1 after each round. Finish (or the clock running out) saves the rounds. */
@Composable
private fun WorkoutClock(kind: String, totalSec: Int, moves: List<String>, saving: Boolean, onFinish: (Int) -> Unit) {
    val context = LocalContext.current
    var phase by remember { mutableStateOf("idle") }   // idle, ready, run
    var endsAt by remember { mutableStateOf(0L) }
    var left by remember { mutableIntStateOf(totalSec) }
    var rounds by remember { mutableIntStateOf(0) }
    var minuteSeen by remember { mutableIntStateOf(0) }
    val emom = kind == "emom"
    val minutes = maxOf(1, (totalSec + 59) / 60)
    LaunchedEffect(phase, endsAt) {
        if (phase == "idle") return@LaunchedEffect
        while (true) {
            val now = System.currentTimeMillis()
            left = maxOf(0, ((endsAt - now + 999) / 1000).toInt())
            if (now >= endsAt) {
                workoutBuzz(context, 450)
                if (phase == "ready") { phase = "run"; minuteSeen = 0; endsAt = now + totalSec * 1000L }
                else { phase = "idle"; endsAt = 0L; onFinish(if (emom) minutes else rounds) }
                return@LaunchedEffect
            }
            if (phase == "run" && emom) {
                val minute = minOf(minutes - 1, (totalSec - left) / 60)
                if (minute > minuteSeen) { minuteSeen = minute; workoutBuzz(context, 250) }
            }
            delay(200)
        }
    }
    when (phase) {
        "idle" -> {
            Text("${Formats.fmtSec(totalSec)} on the clock", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            moves.take(4).forEach { Text(it, color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            WorkoutDone(if (saving) "Saving…" else "Start") {
                if (saving) return@WorkoutDone
                rounds = 0; minuteSeen = 0
                phase = "ready"; endsAt = System.currentTimeMillis() + 5_000L
            }
        }
        "ready" -> {
            Text("Get ready", color = Blue, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(Formats.fmtSec(left), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
            Pill("Cancel", Card, Color.White, Modifier.width(96.dp)) { phase = "idle"; endsAt = 0L }
        }
        else -> {
            val elapsed = totalSec - left
            if (emom) {
                val minute = minOf(minutes - 1, elapsed / 60)
                Text("Minute ${minute + 1} of $minutes", color = Orange, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(moves.getOrNull(minute % maxOf(1, moves.size)) ?: "", color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(Formats.fmtSec(if (left % 60 == 0) 60 else left % 60), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
            } else {
                Text("Round ${rounds + 1} · $rounds done", color = Orange, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(Formats.fmtSec(left), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
                WorkoutDone("+1 round") { rounds += 1 }
                if (rounds > 0) Pill("−1", Card, Color.White, Modifier.width(64.dp)) { rounds = maxOf(0, rounds - 1) }
            }
            Pill("Finish", Card, Color.White, Modifier.width(96.dp)) {
                val count = if (emom) elapsed / 60 else rounds
                phase = "idle"; endsAt = 0L
                onFinish(count)
            }
        }
    }
}

// ───────────────────────── Rest ─────────────────────────
// The rest is on the session doc (Sync.kt), so it runs on the watch and the phone at once: +30 s or Skip on either one
// shows on the other. At the end each one buzzes on its own. During the rest: how hard the last set was (RPE, tap or
// the bezel), what's next, and Undo.

@Composable
private fun RestScreen(planner: Planner, seconds: Int, note: String, onDone: () -> Unit) {
    val context = LocalContext.current
    val sync = remember { Sync(planner) }
    val heart = remember { Heart.get(context) }
    val scope = rememberCoroutineScope()
    val first = remember { Sync.memo?.let { Sync.restOf(it.doc) }?.takeIf { it.running() } }
    var endsAt by remember { mutableStateOf(first?.endsAtMs ?: (System.currentTimeMillis() + seconds * 1000L)) }
    var live by remember { mutableStateOf(Sync.memo) }
    var left by remember { mutableIntStateOf(seconds) }
    var over by remember { mutableStateOf(false) }
    var bpm by remember { mutableIntStateOf(0) }
    var rpeEdits by remember { mutableIntStateOf(0) }
    var rpeShown by remember { mutableStateOf<Double?>(null) }
    val focus = remember { FocusRequester() }
    var turned by remember { mutableStateOf(0f) }
    var addedAt by remember { mutableStateOf(0L) }   // +30 s pressed here: a poll just after it still has the old time

    val exs = remember(live) { live?.doc?.let { Workout.parse(it) } ?: emptyList() }
    // the set this rest follows: the doc says (either side), else the one this watch ticked last
    val after: SetRef? = remember(live) {
        val l = live
        val r = l?.let { Sync.restOf(it.doc) }
        if (l != null && r != null && r.afterEi >= 0 && r.afterSi >= 0) SetRef(l.key, r.afterEi, r.afterSi, exs.getOrNull(r.afterEi)?.exerciseId ?: "")
        else Sync.lastDone?.takeIf { it.key == l?.key }
    }
    LaunchedEffect(after) { rpeShown = after?.let { a -> exs.getOrNull(a.ei)?.sets?.getOrNull(a.si)?.rpe } }

    /** Leave the rest. clear = write that it's over (unless the other side started a newer one); the recovery of the
     *  last set ends here (the next set starts). */
    fun leave(clear: Boolean, buzzIt: Boolean) {
        if (over) return
        over = true
        if (buzzIt) buzz(context)
        Sync.dismissed = endsAt
        val key = live?.key
        val rec = heart.endRecovery()
        val ends = endsAt
        val a = after
        if (key != null && (clear || rec != null)) Sync.later {
            sync.patch(key) { d ->
                var changed = false
                // ran out: only that rest; Skip: whatever rest is running
                if (clear) changed = if (buzzIt) Sync.applyRestOver(d, ends, a?.ei ?: -1, a?.si ?: -1) else Sync.applyRest(d, null)
                if (rec != null && rec.target.key == key) changed = Sync.applyRecovery(d, rec) || changed
                changed
            }
        }
        onDone()
    }

    LaunchedEffect(endsAt) {
        while (!over) {
            val now = System.currentTimeMillis()
            left = ((endsAt - now + 999) / 1000).toInt()
            bpm = heart.bpmNow(now)
            heart.recoveryDue(now)?.let { r -> Sync.later { sync.patch(r.target.key) { d -> Sync.applyRecovery(d, r) } } }
            if (left <= 0) { leave(clear = true, buzzIt = true); return@LaunchedEffect }
            delay(250)
        }
    }
    // the phone may add 30 s, skip, or the session may end: read it every 2 s
    LaunchedEffect(Unit) {
        workoutWhileVisible(context, 2_000) {
            if (over) return@workoutWhileVisible false
            val key = live?.key ?: return@workoutWhileVisible true
            if (Sync.writing > 0 || rpeEdits > 0 || System.currentTimeMillis() - addedAt < 3_000) return@workoutWhileVisible true
            try {
                val l = sync.read(key)
                if (l == null || l.finished) { leave(clear = false, buzzIt = false); return@workoutWhileVisible false }
                live = l
                val r = Sync.restOf(l.doc)
                when {
                    // skipped on the phone (or it ended there a moment sooner): stop here too, buzzing if it was the end
                    r == null -> { leave(clear = false, buzzIt = left <= 3); false }
                    r.endsAtMs != endsAt && r.running() -> { endsAt = r.endsAtMs; true }
                    else -> true
                }
            } catch (_: SignedOut) { false } catch (_: Exception) { true }
        }
    }
    // RPE turned with the bezel: written a moment after the last click
    LaunchedEffect(rpeEdits) {
        if (rpeEdits == 0) return@LaunchedEffect
        delay(800)
        val a = after ?: return@LaunchedEffect
        val v = rpeShown
        rpeEdits = 0
        Sync.later { sync.patch(a.key) { d -> Sync.applyRpe(d, a.ei, a.si, a.exerciseId, v) } }
    }
    DisposableEffect(Unit) {
        heart.acquire()
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            heart.release()
            workoutFlushLater(heart, sync)
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    LaunchedEffect(after != null) { if (after != null) try { focus.requestFocus() } catch (_: Exception) { } }

    Face(scroll = true) {
        Text("REST" + if (bpm > 0) "  ♥ $bpm" else "", color = Blue, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text("%d:%02d".format(maxOf(0, left) / 60, maxOf(0, left) % 60), color = Color.White, fontSize = 38.sp, fontWeight = FontWeight.Light)
        if (note.isNotEmpty()) Text(note, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(2.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("+30 s", Card, Color.White, Modifier.width(72.dp)) {
                if (over) return@Pill
                endsAt += 30_000L
                addedAt = System.currentTimeMillis()
                live?.key?.let { k -> Sync.later { sync.patch(k) { d -> Sync.applyExtend(d, 30) } } }
            }
            Pill("Skip", Blue, Color(0xFF001A33), Modifier.width(72.dp)) { leave(clear = true, buzzIt = false) }
        }
        after?.let { a ->
            Column(
                Modifier
                    .onRotaryScrollEvent { e ->
                        turned += e.verticalScrollPixels
                        if (abs(turned) > 48f) { rpeShown = Rpe.turn(rpeShown, turned > 0); rpeEdits++; turned = 0f }
                        true
                    }
                    .focusRequester(focus)
                    .focusable(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("HOW HARD WAS IT?", color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                WorkoutRpeRow(rpeShown, false) { v -> rpeShown = v; rpeEdits++ }
            }
        }
        val nextStep = Formats.current(exs)
        WorkoutNextUp(nextStep?.let { Formats.describe(exs, it) } ?: if (exs.isNotEmpty()) "Every set is done: complete it on your phone" else "")
        after?.let { a ->
            WorkoutUndo(false) {
                if (over) return@WorkoutUndo
                over = true
                Sync.dismissed = endsAt
                heart.cancelRecovery(a.key, a.ei, a.si)
                scope.launch {
                    try { sync.patch(a.key) { d -> Sync.applyUndo(d, a.ei, a.si, a.exerciseId) } } catch (_: Exception) { }
                    onDone()
                }
            }
        }
    }
}

// ───────────────────────── Timers ─────────────────────────

private fun mmss(ms: Long): String {
    val t = maxOf(0L, ms / 1000)
    return if (t >= 3600) "%d:%02d:%02d".format(t / 3600, (t % 3600) / 60, t % 60) else "%d:%02d".format(t / 60, t % 60)
}

@Composable
private fun TimersScreen(planner: Planner, onSignedOut: () -> Unit) {
    val timers = remember { Timers(planner) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf<TimersNow?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(System.currentTimeMillis()) }
    var reload by remember { mutableIntStateOf(0) }
    var buzzed by remember { mutableStateOf(false) }
    LaunchedEffect(reload) {
        try { now = timers.load(); problem = null } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { problem = "No connection" }
    }
    LaunchedEffect(Unit) { while (true) { tick = System.currentTimeMillis(); delay(500) } }
    val act: (suspend () -> Unit) -> Unit = { f ->
        scope.launch {
            try { f(); refreshTile(context); reload++ } catch (_: SignedOut) { onSignedOut() } catch (_: Exception) { problem = "Couldn't save. Try again." }
        }
    }
    // the sauna: when its minutes are up, buzz and tick it
    val sauna = now?.sauna
    LaunchedEffect(sauna, tick / 1000) {
        val st = sauna?.startMs ?: return@LaunchedEffect
        if (sauna.done == null && !buzzed && tick >= st + sauna.minutes * 60_000L) {
            buzzed = true
            buzz(context)
            act { timers.saunaDone() }
        }
    }
    Face(scroll = true) {
        val n = now
        if (n == null) { Message(problem ?: "Loading…"); return@Face }
        if (n.up == null) Pill("I'm up", Orange, Color(0xFF1A0E00), Modifier.width(110.dp)) { act { timers.imUp() } }
        n.race?.let { r ->
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Card).padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(r.title.uppercase(), color = Orange, fontSize = 8.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, maxLines = 1)
                val shown = when {
                    r.startMs == null -> "—"
                    r.finishMs != null -> mmss(r.finishMs - r.startMs)
                    else -> mmss(tick - r.startMs)
                }
                Text(shown, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Light)
                Text(
                    when {
                        r.startMs == null -> "Starts when you tick I'm up"
                        r.finishMs != null -> r.bestMs?.let { "Done · best ${mmss(it)}" } ?: "Done"
                        else -> r.bestMs?.let { "Best ${mmss(it)}" } ?: "Running"
                    },
                    color = Muted, fontSize = 10.sp,
                )
            }
        }
        sauna?.let { s ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Card).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("SAUNA", color = Blue, fontSize = 8.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    val left = s.startMs?.let { it + s.minutes * 60_000L - tick }
                    Text(
                        when {
                            s.done != null -> "Done ${clock(s.done)}"
                            left != null -> mmss(left)
                            else -> "${s.minutes}:00"
                        },
                        color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
                when {
                    s.done != null -> {}
                    s.startMs == null -> Pill("Start", Blue, Color(0xFF001A33)) { act { timers.startSauna() } }
                    else -> Pill("Out", Card, Color.White) { act { timers.saunaDone() } }
                }
            }
        }
        if (n.race == null && sauna == null && n.up != null) Message("No race timer or sauna today. Add a race timer on Today in the planner.")
        problem?.let { Message(it, Faint) }
    }
}
