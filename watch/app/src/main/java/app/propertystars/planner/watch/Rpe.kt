// Rpe.kt — how hard a set felt (RPE), the same choices as the phone's live workout (LiveWorkout.tsx RPES): tap one, tap
// it again to clear it, or turn the bezel through them. Optional: a set with none just has no rpe.
package app.propertystars.planner.watch

object Rpe {
    /** The phone's picker. Change together with RPES in src/planner/features/workout/LiveWorkout.tsx. */
    val CHOICES: List<Double> = listOf(7.0, 8.0, 9.0, 10.0)

    /** The next choice one bezel click away: none → 7 → 8 → 9 → 10 (and back the other way). A value the phone wrote
     *  between two choices moves to the nearest one in that direction. */
    fun turn(current: Double?, up: Boolean): Double? {
        if (current == null) return if (up) CHOICES.first() else null
        return if (up) CHOICES.firstOrNull { it > current } ?: CHOICES.last()
        else CHOICES.lastOrNull { it < current }
    }

    /** Tapping a choice: on, or off when it was already on. */
    fun tap(current: Double?, choice: Double): Double? = if (current == choice) null else choice

    fun label(rpe: Double): String = if (rpe % 1.0 == 0.0) rpe.toInt().toString() else rpe.toString()
}
