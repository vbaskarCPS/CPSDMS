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

## The planner watch face

The `face` module is the planner's own watch face (Watch Face Format 2, so it needs Wear OS 5 or later: the Galaxy
Watch Ultra has it). Install the **app** first: the face's rings and its "next" line come from it.

To install it, pick **face** in the box next to the green ▶ (it says *app*), and the watch, then press ▶. The first
time, Android Studio may say "Default Activity not found": open **Run › Edit Configurations… › face**, set **Launch**
to **Nothing**, OK, and press ▶ again.

To put it on:

1. On the watch: press and hold the watch face, swipe to the end, tap **+ Add**, pick **Planner**.
   (Or on the phone, in the **Galaxy Wearable** app's list of watch faces.)
2. To change what a ring shows: press and hold the face › **Customise**.

If it still won't go on (Android Studio says `set-watchface failed … FavoriteOperationException`, or tapping it
does nothing):

1. Uninstall the old face first: `adb uninstall app.propertystars.planner.watch.face`, then press ▶ again.
2. Pick it on the watch by hand (step 1 above): Android Studio's own "set the face" step doesn't always work on
   Samsung watches, even when the face is fine.
3. Still nothing: in Android Studio open **Logcat**, type `watchface` in the filter box (and try `runtime` too:
   the watch's face drawer is `com.google.wear.watchface.runtime`), pick the face on the watch again, and send a
   screenshot of the red lines.

Checking the face file after a change: Google's validator (github.com/google/watchface, `third_party/wff`):
`java -jar wff-validator.jar 2 face/src/main/res/raw/watchface.xml` must say PASSED. The newer checker in the same
repository (`tools/dwf-validator`) also checks expressions; it says the face is good for versions 2 to 4.

What was wrong before (batch 3): the build put a `classes.dex` into the face (a face must have no code: the debug
build is now shrunk, as Google's samples are), and the rings used font weight `BOLD`, which Google's newer checker
doesn't accept (now `SEMI_BOLD`). Neither could be tried on the watch from here.

Found on the watch (13 Nov, logcat `watchface`, WearServices): `IllegalArgumentException: defaultDataSourcePolicy.
systemDataSourceFallbackDefaultType EMPTY must be in the supportedTypes`. Google's validator doesn't catch it, but the
watch refuses the face. Every spot's `defaultSystemProviderType` must be one of its own `supportedTypes`, even when
`defaultSystemProvider` is `EMPTY` (now LONG_TEXT for the "next" line, RANGED_VALUE for the rings).

## First time on the watch

1. The app shows a 4-digit code.
2. On your phone: planner › **Settings › Watch**, enter the code.
3. Add the tile: swipe left from the watch face, scroll to the end, tap **+**, pick *Planner · Today*.

## What's in it

| Screen | What it does |
|---|---|
| Today | The block you're in and what's next, protein left, habits done |
| Habits | Today's habits and to-dos; tap to tick |
| Workout | Start today's session, or carry on one started on the phone; follows the session's format as the phone does (supersets and circuits round by round, pyramids, timed holds, EMOM / AMRAP, left and right); weight and reps with the buttons or the bezel; effort (RPE) if you want; what's next; Done |
| Rest | Counts down the rest, buzzes at the end; +30 s or Skip; shows what's next. A rest started on the phone runs here too, and the other way round |
| Timers | I'm up, the race timer (from Up), the sauna countdown that ticks itself |
| Today tile | The same as Today, at a glance |
| Spots | Protein left, habits done, steps, next block: on the planner face or any face with spots |

The watch wears the look chosen in the phone's **Theme Studio** (the whole planner's look): its colours for the
buttons, the words, the tile and the rings on the planner face, made light enough to read on the black background
(which stays black, for the battery). A new look shows on the watch the next time the app opens, or when the tile
refreshes.

Habits that tick themselves (I'm up, Start workout, the sauna) follow the same rules as on the phone: "only counts if
done by 5:05", "within 30 minutes of I'm up". Start workout counts within 30 minutes of I'm up unless the habit says
otherwise.

Sets and the rest timer stay the same on the phone and the watch while a workout is open on both (each checks the
session every 2 seconds and only ever changes its own part of it).

Heart rate is measured while the workout screen is open and saved on the session (`hr: { avg, max }`), and on each
set: its average and peak, and how far it fell in the rest after it (`hr: { avg, max, rec }`). The assistant reads
these with the effort (RPE) to judge effort, rest length and the next weights.
Steps and a resting heart rate are collected in the background all day and saved to the planner
(`health` / date), where the assistant sees them. Sleep isn't available to other apps on the watch.

## How it works

- `Planner.kt`: calls the planner's database functions (`planner_get`, `planner_put` …) with the watch's own pass.
  The database address and public key are read at build time from `src/lib/supabaseConfig.ts`.
- `Pairing.kt`: the 4-digit code flow (`planner_watch_*`, migration `20261251900000_planner_watch.sql`).
- `Routine.kt`: the day's blocks, a port of `src/planner/lib/routine.ts` and `planner-push/adjust.ts`. Change them together.
- `Today.kt`, `Workout.kt`, `Heart.kt`: today's summary and ticks, sets, heart rate.
- `MainActivity.kt`: the screens (the time always in the top 30%). `TodayTileService.kt`: the tile.
- `Look.kt`: the Theme Studio look (`prefs` / `look`), its colours copied from `src/planner/features/look/looks.ts`
  (change them together), made readable on black. Kept on the watch so the first frame wears the last look.
- `Today.kt` `HabitRules`: a port of `src/planner/features/habits/rules.ts` (change them together).

Tests: `app/src/test/java/…/LookTest.kt` (the colour sums) and `HabitRulesTest.kt` (the habit rules, the same cases
as the phone's `rules.test.ts`). In Android Studio: right-click the `test` folder › Run tests.

Coming next: the assistant (press and talk).
