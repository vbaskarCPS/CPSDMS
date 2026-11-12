# Planner on Galaxy Watch (Wear OS)

The planner on your wrist: today's plan, habits and to-dos, logging sets with heart rate, and a Today tile.
It talks to the same database as the phone, so everything shows up in the planner straight away.

## One-time setup

1. Install **Android Studio** (free, developer.android.com/studio). Accept the default options.
2. On the watch: **Settings › About watch › Software information**, tap *Software version* 7 times (developer mode).
3. **Settings › Developer options**: turn on *ADB debugging* and *Wireless debugging*. Same Wi-Fi as the computer.
4. In Android Studio: **Device Manager › Pair devices using Wi-Fi**, then enter the pairing code the watch shows under
   Wireless debugging.
5. Open this `watch` folder in Android Studio (File › Open). Let it finish syncing (a few minutes the first time).

## Install or update

Pick the watch at the top of Android Studio and press **Run** (the green triangle). The app opens on the watch.

## First time on the watch

1. The app shows a 4-digit code.
2. On your phone: planner › **Settings › Watch**, enter the code.
3. Add the tile: swipe left from the watch face, scroll to the end, tap **+**, pick *Planner · Today*.

## What's in it

| Screen | What it does |
|---|---|
| Today | The block you're in and what's next, protein left, habits done |
| Habits | Today's habits and to-dos; tap to tick |
| Workout | The next set of the session started on the phone; weight and reps with the buttons or the bezel; Done |
| Rest | Counts down the rest, buzzes at the end; +30 s or Skip |
| Today tile | The same as Today, at a glance |

Heart rate is measured while the workout screen is open and saved on the session (`hr: { avg, max }`).

## How it works

- `Planner.kt`: calls the planner's database functions (`planner_get`, `planner_put` …) with the watch's own pass.
  The database address and public key are read at build time from `src/lib/supabaseConfig.ts`.
- `Pairing.kt`: the 4-digit code flow (`planner_watch_*`, migration `20261251900000_planner_watch.sql`).
- `Routine.kt`: the day's blocks, a port of `src/planner/lib/routine.ts` and `planner-push/adjust.ts`. Change them together.
- `Today.kt`, `Workout.kt`, `Heart.kt`: today's summary and ticks, sets, heart rate.
- `MainActivity.kt`: the screens (the time always in the top 30%). `TodayTileService.kt`: the tile.

Coming next: race and sauna timers, watch-face spots, the assistant (press and talk), and each day's steps, sleep and
resting heart rate.
