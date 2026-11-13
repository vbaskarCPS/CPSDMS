# Handoff: the planner on Galaxy Watch (next batch)

For a new chat picking up the watch work. Read this, then `watch/README.md`, then the code. The goal of the next
batch is **one big build**: do everything below in one branch / one PR, so Vijay builds and installs once.

## Who and how

- Vijay builds and installs. The cloud workspace **can't compile Android** (no Android SDK / Maven Google downloads), so
  every change is first compiled in Android Studio on his Windows PC. Write plain, standard Kotlin; keep versions as they are
  (AGP 8.7.3, Kotlin 2.0.21, Gradle 8.14.3 wrapper, compileSdk 35, minSdk 30, Compose BOM 2024.12.01, wear compose 1.4.0,
  tiles 1.4.1, protolayout 1.2.1, complications data source 1.2.1, health-services-client 1.0.0-rc02).
  Gradle's bundled Kotlin compiler (`/opt/gradle/lib/kotlin-compiler-embeddable-2.0.21.jar`) can catch plain syntax
  slips, but without the Android classpath its other errors are noise.
- His Android Studio is a Canary build ("Rabbit 2") with Gradle JVM 21. Ignore its AGP upgrade prompts.
- Watch: **Galaxy Watch Ultra, SM-L705F**, paired over Wi-Fi ADB (Android Studio's pairing window doesn't work with it:
  use `adb pair` / `adb connect` in the Terminal: `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" …`).
- Standing rules (from the main project): never merge without "merge it"; additive SQL only (avoid the words drop,
  delete, truncate, cascade in migrations); run Supabase security advisors after DB changes; no passwords or keys in
  files; planner changes Vijay or Rosh will notice get a `src/planner/news.json` entry (`"for": "night"` = Vijay only).
  Open PRs with `gh api repos/vbaskarCPS/CPSDMS/pulls -f head=… -f base=main -f title=… -F body=@file`.
- Don't use personal names in user-facing watch text (the assistant is "the assistant" on the watch; the phone calls it
  Arvy).

## What exists (merged)

`watch/` is a Gradle project with two modules:

| Module | What |
|---|---|
| `app` | The watch app (Kotlin + Compose for Wear OS), the Today tile, the spots (complications), background health |
| `face` | The planner watch face, Watch Face Format 1 (`face/src/main/res/raw/watchface.xml`), no code |

App files (`app/src/main/java/app/propertystars/planner/watch/`):

- `Planner.kt`: calls the planner's database functions (`planner_get`, `planner_put`) with the watch's own token. Docs are
  `org.json` objects so unknown fields survive. `dayKey()` = the planner's day (starts 4 am). Every write reads the doc
  fresh first.
- `Pairing.kt`: the watch shows a 4-digit code; Settings › Watch on the phone claims it (`planner_watch_*`, migration
  `supabase/migrations/20261251900000_planner_watch.sql`; phone side `src/planner/features/watch/`).
- `Routine.kt`: the day's blocks, a port of `src/planner/lib/routine.ts` + `supabase/functions/planner-push/adjust.ts`.
- `Today.kt`: now / next, habits due and ticks (`habitlog`), to-dos (`day.todos` + priorities), protein (`meal` totals vs
  `foodprefs/targets`), `tickBlock`, `markAuto` (habits that tick themselves).
- `Workout.kt`: the live session (`workout` / `<date>~<id>`), `nextSet`, `logSet` (weight, reps, done, doneAt, session
  `hr` {avg,max,samples}), `todaysTemplate` + `start` (ports `store.ts` todaysTemplate/sessionToday/startFromTemplate,
  using `nextRx` and last time's numbers; the phone's `nextTarget` progression is **not** ported).
- `Heart.kt`: heart rate while the workout screen is open (Health Services MeasureClient). `take()` = since last call.
- `Timers.kt`: I'm up (`ticks.up` + `ticks.upAt`), the first race widget that runs from Up (`prefs/widgets`, results in
  `race` / `<id>~<day>`), the sauna (`day.night.saunaStart`, then `ticks.sauna` + auto habits).
- `Health.kt`: background steps + heart rate (PassiveListenerService), resting HR = lowest 10-reading average; saved to
  `health` / calendar date `{ steps, restingHr, updatedAt, from: 'watch' }`; the assistant reads it
  (`src/planner/lib/lifeContext.ts`: `watch_health_recent`). Sleep is not available to other apps on Galaxy watches.
- `Spots.kt`: complications Protein / Habits / Steps (ranged value or short text) and Next (short or long text).
- `MainActivity.kt`: the screens. **Design rule: the top 30% of every screen is the time**, the rest is the screen's own
  (`Face(scroll = …) { … }`). Screens: Pair, Today, Habits, Workout, Rest, Timers. Swipe right = back to Today.
- `TodayTileService.kt`: the tile.

Phone data shapes to know: `src/planner/features/workout/types.ts` (Workout, WorkoutExercise, SetLog with `rpe?`,
`group` / `groupKind` 'superset' | 'circuit' | 'emom' | 'amrap', `style` pyramid etc., `repsBySet`, `weightBySet`,
`mode: 'time'`, `sides` + `repsR`), `src/planner/features/workout/LiveWorkout.tsx` (how the phone runs every format:
mirror it), `src/planner/features/habits/auto.ts`, `src/planner/features/look/` (themes).

## Status and known problems

- Installed and working on the watch: pairing, Today, Habits, Workout (log set), Rest, tile; batch 2 (face, spots,
  timers, health, start workout) built and installed.
- **The Planner watch face won't apply** (Android Studio: `set-watchface failed … FavoriteOperationException: Error 0`;
  tapping it on the watch does nothing). Likely the watch rejects something in `watchface.xml`. Get Vijay to filter
  Logcat by `watchface` while picking it, and fix what it names. Suspects to check against the Watch Face Format spec:
  `Transform` on `Arc` endAngle, `Variant` inside `PartText`, `ellipsis` on `Text`, `RoundRectangle` attributes, font
  `weight` values, `[MINUTE_Z]` / `[DAY_OF_WEEK_S]` / `[MONTH_S]`, and that a third-party `primaryProvider` is allowed.
  Google's WFF validator (github.com/google/watchface) can check the file. Also try applying it from the Galaxy
  Wearable phone app.
- Not tested on the watch yet: spots on a Samsung face, background steps upload, race/sauna, starting a session.

## The next batch (Vijay's list, in his words first)

1. **Show the next set coming up**: on the log-a-set and rest screens, what's next (exercise, set n of m, weight × reps),
   so you know what's coming while resting.
2. **RPE**: a quick picker per set (the phone's `SetLog.rpe`), bezel or tap, optional.
3. **Easier logging for pyramids, supersets and other formats**: follow the session's format like
   `LiveWorkout.tsx` does: superset / circuit order across grouped exercises with rest after the round; pyramid and
   per-set reps/weights (`repsBySet` / `weightBySet` / `style`); timed holds (`mode: 'time'`) with a countdown and buzz;
   EMOM / AMRAP / intervals with their clocks; left and right (`sides`, `repsR`). The watch's `nextSet` is currently a
   simple "first undone set in order".
4. **Real-time sync between phone and watch** for set completion and rest timers: a set done on one shows on the other
   at once, and the rest timer started on one runs on both. Note: `planner_docs` is closed to direct table access
   (token-checked functions only), so Supabase Realtime `postgres_changes` won't see it. Options: a Realtime
   **broadcast** channel per session (name with a random id the session doc holds; carries `{set done, restEndsAt}`;
   the doc stays the source of truth), or polling the session doc every few seconds while a workout screen is open.
   The phone side lives in `LiveWorkout.tsx`; store `restEndsAt` on the session doc so either side can resume the timer.
5. **Heart rate per set for the assistant's advice**: save on each set its average and peak heart rate and, during the
   rest after it, the recovery (how far it falls before the next set). Feed it to the assistant's workout context
   (`lifeContext.ts` sessions / `features/workout/trainingState.ts`) so it can judge effort, rest length and readiness,
   and adjust advice and the next weights. Keep the session-level `hr` too.
6. **The watch follows the phone's Theme Studio look**: read `prefs` / `look` (see `features/look/store.ts` and
   `looks.ts`: palette `accent`, `accentInk`, `ink`, `ink2`, `amber` …, and fonts) and use its accent and text colours
   on the watch screens, tile and face rings. Keep the background black (battery, always-on); keep 4.5:1 contrast on
   black (lighten dark accents). Refresh when the look changes.
7. **Fix the watch face** (above).

Also on the earlier list, not started: the assistant on the watch (press and talk, reply with Confirm / Undo, as on the
phone's Arvy).

## How Vijay builds

Download the branch as a ZIP (or pull with GitHub Desktop), open the `watch` folder in Android Studio, let it sync,
pick the watch, press ▶ with **app** selected, then switch to **face** and press ▶ (face run configuration: Launch =
Nothing). Updates install over the old version; pairing is kept. Give him the branch ZIP link
(`https://github.com/vbaskarCPS/CPSDMS/archive/refs/heads/<branch>.zip`) and short steps, and ask for screenshots of
any red errors.
