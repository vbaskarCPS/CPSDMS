// Formats.kt — how a session runs, the watch's copy of the phone's src/planner/features/workout/format.ts and the
// order LiveWorkout.tsx logs sets in. Change them together.
//   blocks     neighbours with the same group letter run together: superset (2), circuit (3+), or an EMOM / AMRAP
//   order      an exercise on its own: its sets in order; a superset or circuit: round by round (set 1 of each, then
//              set 2 …), rest only after the round; intervals and EMOM / AMRAP: one clock that runs itself
//   targets    the reps and weight a set starts at (repsBySet / weightBySet for pyramids, countdowns, drop sets)
//   next up    what comes after the current set, in one line
// Plain Kotlin with no Android in it, so the tests in src/test run on a computer. Workout.kt turns the session doc into
// these classes.
package app.propertystars.planner.watch

/** One set of a session exercise (the phone's SetLog, the bits the watch needs). */
data class FSet(
    val weight: Double = 0.0,
    val reps: Int = 0,
    val repsR: Int? = null,
    val seconds: Int = 0,
    val done: Boolean = false,
    val doneAt: String = "",
    val rpe: Double? = null,
    val prevWeight: Double = 0.0,
)

/** One session exercise (the phone's WorkoutExercise + Format). Empty strings and nulls = not set. */
data class FEx(
    val name: String,
    val exerciseId: String = "",
    val mode: String = "reps",
    val targetReps: String = "",
    val note: String = "",
    val restSec: Int = 0,
    val sets: List<FSet> = emptyList(),
    val sides: Boolean? = null,
    val noLoad: Boolean? = null,
    val style: String = "",
    val repsBySet: List<Int> = emptyList(),
    val weightBySet: List<Double> = emptyList(),
    val group: String = "",
    val groupKind: String = "",
    val groupSec: Int = 0,
) {
    val timed: Boolean get() = mode == "time"
}

/** A block: kind is "single", "superset", "circuit", "emom" or "amrap"; at = the exercises' places in the session. */
data class FBlock(val kind: String, val at: List<Int>, val letter: String = "") {
    val clocked: Boolean get() = kind == "emom" || kind == "amrap"
    val rounds: Boolean get() = kind != "single" && !clocked
}

enum class StepKind { Set, Intervals, Clock }

/** One thing to do next, in the session's order. Set = one set (ei, si); Intervals = the self-running rounds of one
 *  exercise; Clock = a whole EMOM / AMRAP block (ei = its first exercise). round / rounds count from 1 for people. */
data class Step(
    val kind: StepKind,
    val block: Int,
    val ei: Int,
    val si: Int,
    val round: Int,
    val rounds: Int,
    val tag: String = "",
) {
    /** Stays the same while the same thing is on screen (an interval runner's round changes, it doesn't). */
    val id: String get() = when (kind) {
        StepKind.Set -> "S:$ei:$si"
        StepKind.Intervals -> "I:$ei"
        StepKind.Clock -> "C:$ei"
    }
}

/** What a set starts at in the editor. repsR is the right side, for left-and-right exercises. */
data class Target(val weight: Double, val reps: Int, val repsR: Int, val seconds: Int)

object Formats {
    private val SIDES = Regex("""\b(per|each)[ -]?(side|leg|arm|hand|direction|way)\b|/\s?side\b|\b(l\s*/\s*r|left (and|&|/) right|both sides)\b""", RegexOption.IGNORE_CASE)
    private val NOTE_SIDES = Regex("""\bper (side|leg|arm|hand)\b|\beach (side|direction|way)\b|/\s?side\b""", RegexOption.IGNORE_CASE)
    private val SIDED = Regex("""side plank|windmill|\bchops?\b|wood ?chop|\bhalo|suitcase|get[- ]?up|half[- ]kneeling|pallof|copenhagen|clamshell|fire hydrant|pigeon|couch stretch|hip flexor stretch|thread the needle|side[- ]lying|cossack|curtsy""", RegexOption.IGNORE_CASE)
    // types.ts isUnilateral (from the name: the watch has no exercise list)
    private val UNILATERAL = Regex("""one[- ]arm|single[- ](arm|leg)|bulgarian|split squat|lunge|step[- ]up|pistol|one[- ]leg|unilateral|per side""", RegexOption.IGNORE_CASE)
    private val DRILL = Regex("""cat[- ]?cow|90\s*/\s*90|dead[- ]?bug|bird[- ]?dog|glute bridge|hip bridge|stretch|mobility|child'?s pose|pose\b|foam roll|thread the needle|world'?s greatest|circles?\b|leg swings?|hip (rotation|opener|cars?)|scap(ular)? (push|pull)|wall slide|inchworm|deep squat (hold|sit)|breathing""", RegexOption.IGNORE_CASE)
    private val LOADED = Regex("""kettlebell|\bkb\b|dumbbell|\bdb\b|barbell|cable|band|weighted|plate|machine|goblet|ez[- ]bar|sandbag|medicine ball|slam ball""", RegexOption.IGNORE_CASE)

    // The phone's built-in exercise list (library.ts), the two facts format.ts asks it. Change together.
    private val BODYWEIGHT_IDS = setOf(
        "push-up", "dip", "pull-up", "chin-up", "back-extension", "bench-dip", "diamond-pushup", "bodyweight-squat",
        "sissy-squat", "box-jump", "nordic-curl", "glute-bridge", "plank", "side-plank", "dead-hang", "wall-sit",
        "hanging-leg-raise", "hanging-knee-raise", "ab-wheel", "crunch", "reverse-crunch", "russian-twist", "dead-bug",
        "bird-dog", "mountain-climber", "decline-situp", "burpee", "jumping-jack", "wall-ball", "battle-ropes", "stretch", "mobility",
    )
    private val CARDIO_IDS = setOf(
        "jumping-jack", "walk", "brisk-walk", "bike", "rower", "jump-rope", "stretch", "mobility", "treadmill", "incline-walk",
        "running", "cycling", "rowing", "elliptical", "stair-climber", "assault-bike", "swimming", "walking", "hiit",
    )

    /** One side or direction at a time? The flag, else the written target or cue, else the exercise's name. */
    fun hasSides(ex: FEx): Boolean {
        ex.sides?.let { return it }
        return SIDES.containsMatchIn(ex.targetReps) || SIDES.containsMatchIn(ex.name) || NOTE_SIDES.containsMatchIn(ex.note.take(80)) ||
            SIDED.containsMatchIn(ex.name) || UNILATERAL.containsMatchIn(ex.name)
    }

    /** Nothing to load? The flag; a timed one; else a set that has a weight says no; else bodyweight moves and drills. */
    fun isNoLoad(ex: FEx): Boolean {
        ex.noLoad?.let { return it }
        if (ex.timed) return true
        if (ex.sets.any { it.weight > 0 || it.prevWeight > 0 } || ex.weightBySet.any { it > 0 }) return false
        if (LOADED.containsMatchIn(ex.name)) return false
        return ex.exerciseId in BODYWEIGHT_IDS || DRILL.containsMatchIn(ex.name)
    }

    /** Timed rounds that run themselves (work, rest, work…): asked for, or short cardio bursts with a rest between. */
    fun isIntervals(ex: FEx): Boolean {
        if (!ex.timed) return false
        if (ex.style == "intervals") return true
        val rounds = ex.sets.size
        val sec = ex.sets.firstOrNull()?.seconds ?: 0
        return ex.style.isEmpty() && ex.group.isBlank() && rounds >= 3 && ex.restSec > 0 && sec in 1..120 && ex.exerciseId in CARDIO_IDS
    }

    /** The session as blocks: neighbours with the same group letter run together; everything else stands alone. */
    fun blocksOf(exs: List<FEx>): List<FBlock> {
        val out = mutableListOf<FBlock>()
        var i = 0
        while (i < exs.size) {
            val g = exs[i].group.trim()
            if (g.isEmpty()) { out.add(FBlock("single", listOf(i))); i++; continue }
            val at = mutableListOf(i)
            while (i + 1 < exs.size && exs[i + 1].group.trim() == g) { i++; at.add(i) }
            i++
            val first = exs[at[0]].groupKind
            if (at.size < 2 && first != "emom" && first != "amrap") { out.add(FBlock("single", at)); continue }
            val kind = first.ifEmpty { if (at.size == 2) "superset" else "circuit" }
            out.add(FBlock(kind, at, g.uppercase().take(2)))
        }
        return out
    }

    /** Every step of the session in the order it's done (done ones included). */
    fun steps(exs: List<FEx>): List<Step> {
        val out = mutableListOf<Step>()
        blocksOf(exs).forEachIndexed { bi, b ->
            when {
                b.clocked -> out.add(Step(StepKind.Clock, bi, b.at[0], 0, 1, 1))
                b.rounds -> {
                    val rounds = b.at.maxOf { exs[it].sets.size }
                    for (r in 0 until rounds) b.at.forEachIndexed { k, ei ->
                        if (r < exs[ei].sets.size) out.add(Step(StepKind.Set, bi, ei, r, r + 1, rounds, "${b.letter}${k + 1}"))
                    }
                }
                else -> {
                    val ei = b.at[0]
                    val ex = exs[ei]
                    if (isIntervals(ex)) {
                        val first = ex.sets.indexOfFirst { !it.done }.let { if (it < 0) ex.sets.size else it }
                        out.add(Step(StepKind.Intervals, bi, ei, first, minOf(first + 1, ex.sets.size), ex.sets.size))
                    } else {
                        for (si in ex.sets.indices) out.add(Step(StepKind.Set, bi, ei, si, si + 1, ex.sets.size))
                    }
                }
            }
        }
        return out
    }

    /** Done? A set by its tick; intervals when every round is; an EMOM / AMRAP when every exercise has its rounds logged. */
    fun isDone(exs: List<FEx>, s: Step): Boolean = when (s.kind) {
        StepKind.Set -> exs.getOrNull(s.ei)?.sets?.getOrNull(s.si)?.done ?: true
        StepKind.Intervals -> exs.getOrNull(s.ei)?.sets?.all { it.done } ?: true
        StepKind.Clock -> blocksOf(exs).getOrNull(s.block)?.at?.all { i -> exs[i].sets.isNotEmpty() && exs[i].sets.all { it.done } } ?: true
    }

    /** The first step not done yet. null = everything is done (complete it on the phone). */
    fun current(exs: List<FEx>): Step? = steps(exs).firstOrNull { !isDone(exs, it) }

    /** The step that comes after this one (the next not done), or null when this is the last. */
    fun after(exs: List<FEx>, s: Step): Step? {
        val all = steps(exs)
        val at = all.indexOfFirst { it.id == s.id }
        return all.drop(at + 1).firstOrNull { !isDone(exs, it) && it.id != s.id }
    }

    /** The rest after set (ei, si) was just ticked done (exs = the session with it done), as LiveWorkout.tsx afterDone:
     *  on its own, its rest (90 s when a set of reps has none); in a superset or circuit, only when the round is
     *  finished, and then the block's longest rest. Intervals and clocks keep their own time: none. 0 = no rest. */
    fun restAfter(exs: List<FEx>, ei: Int, si: Int): Int {
        val b = blocksOf(exs).firstOrNull { ei in it.at } ?: return 0
        val ex = exs[ei]
        if (b.clocked) return 0
        if (b.kind == "single") {
            if (isIntervals(ex)) return 0
            return if (ex.timed) maxOf(0, ex.restSec) else ex.restSec.takeIf { it > 0 } ?: 90
        }
        val roundDone = b.at.all { i -> exs[i].sets.getOrNull(si)?.done ?: true }
        return if (roundDone) maxOf(0, b.at.maxOf { exs[it].restSec }) else 0
    }

    /** The reps and weight a set starts at: what's on the set (the phone fills it in), else the per-set plan, else the
     *  written target. */
    fun target(ex: FEx, si: Int): Target {
        val s = ex.sets.getOrNull(si) ?: FSet()
        val planned = ex.repsBySet.getOrNull(si)
        val written = Regex("\\d+").find(ex.targetReps)?.value?.toIntOrNull()
        val reps = s.reps.takeIf { it > 0 } ?: planned ?: written ?: 8
        val weight = if (s.weight > 0) s.weight else ex.weightBySet.getOrNull(si) ?: 0.0
        return Target(weight, reps, s.repsR ?: reps, s.seconds.takeIf { it > 0 } ?: 30)
    }

    /** How many sets an EMOM / AMRAP leaves each exercise when its clock stops after `count` minutes (EMOM: the minutes
     *  go round the exercises in turn) or rounds (AMRAP: every exercise did them all). As LiveWorkout.tsx clockDone. */
    fun clockSets(b: FBlock, count: Int): Map<Int, Int> =
        b.at.mapIndexed { k, ei ->
            val n = if (b.kind == "emom") ceilDiv(count - k, b.at.size) else count
            ei to minOf(maxOf(0, n), 60)
        }.toMap()

    private fun ceilDiv(a: Int, b: Int): Int = if (a <= 0) 0 else (a + b - 1) / b

    /** The minutes an EMOM / AMRAP runs (the phone's default when the plan gave none). */
    fun clockSec(exs: List<FEx>, b: FBlock): Int = exs[b.at[0]].groupSec.takeIf { it > 0 } ?: if (b.kind == "emom") 600 else 480

    fun blockName(kind: String): String = when (kind) {
        "superset" -> "Superset"
        "circuit" -> "Circuit"
        "emom" -> "EMOM"
        "amrap" -> "AMRAP"
        else -> ""
    }

    fun styleName(style: String): String = when (style) {
        "pyramid" -> "Pyramid"
        "countdown" -> "Countdown"
        "ladder" -> "Ladder"
        "drop" -> "Drop set"
        "intervals" -> "Intervals"
        else -> ""
    }

    fun fmtSec(sec: Int): String = "%d:%02d".format(sec / 60, sec % 60)
    fun fmtW(w: Double): String = if (w % 1.0 == 0.0) w.toInt().toString() else "%.1f".format(java.util.Locale.US, w)

    /** "set 2 of 4" or, in a superset or circuit, "round 2 of 3". */
    fun countLine(exs: List<FEx>, s: Step): String {
        val b = blocksOf(exs).getOrNull(s.block)
        return when (s.kind) {
            StepKind.Set -> if (b?.rounds == true) "round ${s.round} of ${s.rounds}" else "set ${s.round} of ${s.rounds}"
            StepKind.Intervals -> "round ${s.round} of ${s.rounds}"
            StepKind.Clock -> ""
        }
    }

    /** What a set is, in a few words: "135 × 8", "12 reps", "25 × 8 L / 8 R", "0:45", "0:30 each side". */
    fun whatLine(ex: FEx, si: Int): String {
        val t = target(ex, si)
        if (ex.timed) return fmtSec(t.seconds) + if (hasSides(ex)) " each side" else ""
        val reps = if (hasSides(ex)) "${t.reps} L / ${t.repsR} R" else "${t.reps}"
        return if (isNoLoad(ex)) (if (hasSides(ex)) reps else "$reps reps") else "${fmtW(t.weight)} × $reps"
    }

    /** One step in a line, for "Next up": "Bench Press · set 2 of 4 · 135 × 8", "A2 Row · round 2 of 3 · 60 × 10",
     *  "Bike · 8 intervals of 0:20", "EMOM · 10 min · Swing, Squat". */
    fun describe(exs: List<FEx>, s: Step): String {
        val ex = exs.getOrNull(s.ei) ?: return ""
        return when (s.kind) {
            StepKind.Set -> listOf("${if (s.tag.isNotEmpty()) "${s.tag} " else ""}${ex.name}", countLine(exs, s), whatLine(ex, s.si)).joinToString(" · ")
            StepKind.Intervals -> "${ex.name} · ${ex.sets.size} intervals of ${fmtSec(ex.sets.firstOrNull()?.seconds ?: 20)}"
            StepKind.Clock -> {
                val b = blocksOf(exs).getOrNull(s.block) ?: return ex.name
                "${blockName(b.kind)} · ${clockSec(exs, b) / 60} min · ${b.at.joinToString(", ") { exs[it].name }}"
            }
        }
    }

    /** The "Next up" line after step s: what comes next, or that this is the last one. */
    fun nextUp(exs: List<FEx>, s: Step?): String {
        if (s == null) return ""
        val n = after(exs, s) ?: return "Last one: then complete it on your phone"
        return describe(exs, n)
    }

    /** The line above the exercise's name: "SET 2 OF 4 · PYRAMID", "SUPERSET A · ROUND 2 OF 3", "EMOM · 10 MIN". */
    fun eyebrow(exs: List<FEx>, s: Step): String {
        val b = blocksOf(exs).getOrNull(s.block)
        val ex = exs.getOrNull(s.ei)
        val parts = mutableListOf<String>()
        when {
            s.kind == StepKind.Clock && b != null -> { parts.add(blockName(b.kind)); parts.add("${clockSec(exs, b) / 60} min") }
            b?.rounds == true -> { parts.add("${blockName(b.kind)} ${b.letter}"); parts.add(countLine(exs, s)) }
            s.kind == StepKind.Intervals -> parts.add("Intervals")
            else -> { parts.add(countLine(exs, s)); ex?.let { styleName(it.style) }?.takeIf { it.isNotEmpty() && it != "Intervals" }?.let { parts.add(it) } }
        }
        return parts.filter { it.isNotEmpty() }.joinToString(" · ").uppercase()
    }
}
