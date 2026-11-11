// supabase/functions/planner-arvy/tools.ts — Arvy (said "AR-vee"), the planner's assistant: its tools and what it's told.
// No Deno and no network here: the app imports this file too (src/planner/features/arvy), so the tool names the server
// offers Claude and the ones the app knows how to run are the same list. Tested from src/planner/features/arvy/arvy.test.ts.
//
// The planner keeps everything as documents and the code that reads and edits them lives in the app, so Arvy's tools
// run in the app (the same functions the screens use); the server only talks to Claude.
// Arvy looks things up, answers, remembers and opens screens, and makes changes (`change` tools, run by
// src/planner/features/arvy/act.ts): small everyday ones straight away with an Undo, bigger ones (calendar, removing
// anything, money, new habits, targets, a planned workout) only after a Confirm tap.
// Arvy is also the coach (what "Coach Claude" was): coaching_context is the whole planner as the coach reads it, COACHING
// is how to reason about training, and plan_workout puts a session on the Train page. Sessions aren't only straight
// sets: EXERCISE is the shape of one planned exercise (per side, no weight, superset / circuit / EMOM / AMRAP blocks,
// pyramids, countdowns, drop sets, intervals) and FORMATS is when to use which. The plan written after each workout
// (action 'dayplan': DAYPLAN_SCHEMA, dayplanSystem) uses the same shape.
// The schedule follows the conversation too: adjust_day reshapes one day (skip the gym and sauna, up at 7, a stretch
// at 7: kept on the day, src/planner/lib/routine.ts) and change_routine changes the standing routine.
// What it can't do, gets wrong or is told about the app goes in its improvements log (src/planner/features/arvy/log.ts).

export type Profile = 'night' | 'morning';
export interface ArvyCtx {
  name?: string;          // the person's first name
  username?: string;      // vijay | rosh
  profile?: Profile;      // night (Vijay) | morning (Rosh: also the cycle tracker)
  today?: string;         // the planner day, YYYY-MM-DD (starts at 4 am)
  weekday?: string;
  now?: string;           // local time, e.g. 4:05 PM
  path?: string;          // the screen they're on, e.g. /money/budget
  spoken?: boolean;       // the message was spoken (speech-to-text): words may be misheard
  units?: string;         // lb | kg
  about?: string[];       // the notes they've asked Arvy to keep about them (dated, oldest first)
  v?: number;             // which tools the app asking can run (TOOLS_VERSION as that app was built)
}
/** Goes up when a tool is added. The app sends the number it was built with along with every question (context.v):
 *  a phone still running an older version of the app is offered only the tools it can run, so Arvy never sets up a
 *  change that phone would drop. No number = an app from before this (1). */
export const TOOLS_VERSION = 2;
/** change: 'now' = done straight away with an Undo; 'confirm' = waits for them to tap Confirm. */
export interface ArvyTool { name: string; description: string; input_schema: Record<string, unknown>; morningOnly?: boolean; change?: 'now' | 'confirm';
  /** the TOOLS_VERSION this tool arrived with (1 when left out) */ since?: number }

const date = (d: string) => ({ type: 'string', description: `${d} (YYYY-MM-DD)` });
const strs = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d });
const WHO = { type: 'string', enum: ['vijay', 'rosh', 'both', 'kiaan'], description: 'whose event it is' };

/** One exercise of a session Arvy plans: plan_workout and the after-workout plan both use it, and the app reads it
 *  with planExercisesFrom (src/planner/features/workout/format.ts). */
export const EXERCISE = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'the exercise, by the name they already use when they have done it before' },
    sets: { type: 'number', description: 'working sets, or rounds of a superset / circuit / intervals (a light warm-up set is not its own exercise). 1 inside an EMOM or AMRAP.' },
    reps: { type: 'string', description: 'reps per set, e.g. "8-10" or "12" (per side when per_side); inside an EMOM / AMRAP the reps each minute / round. Leave out for timed work.' },
    seconds: { type: 'number', description: 'timed work only (a hold, a carry, cardio, a stretch): seconds per set, per side when per_side. For intervals: the work time.' },
    weight: { type: 'number', description: 'starting weight in their units, when you’re prescribing one' },
    rest_seconds: { type: 'number', description: 'rest after each set; in a superset or circuit, give it on the LAST exercise of the block (the rest after the round) and 0 on the others; for intervals, the easy time between rounds' },
    cue: { type: 'string', description: 'one short form or effort cue' },
    per_side: { type: 'boolean', description: 'done one side or one direction at a time (rows, lunges, chops, windmills, halos, carries, side planks, most stretches): logged left / right' },
    no_weight: { type: 'boolean', description: 'nothing to load (bodyweight, mobility drills): no weight box' },
    group: { type: 'string', description: 'a letter ("A", "B"): consecutive exercises with the same letter are one block done together' },
    group_style: { type: 'string', enum: ['superset', 'circuit', 'emom', 'amrap'], description: 'how the block runs; same on every exercise of the block. Default superset (2) / circuit (3+).' },
    group_minutes: { type: 'number', description: 'EMOM / AMRAP only: how long the block runs, in minutes' },
    reps_by_set: { type: 'array', items: { type: 'number' }, description: 'pyramid / countdown / ladder: the reps of each set in order, e.g. [12,10,8,6] or [10,9,8,7,6,5,4,3,2,1]. Replaces sets and reps.' },
    weight_by_set: { type: 'array', items: { type: 'number' }, description: 'the weight of each set in order (a pyramid going up, a drop set going down), when you know their numbers' },
    style: { type: 'string', enum: ['pyramid', 'countdown', 'ladder', 'drop', 'intervals'], description: 'the shape of this exercise’s sets, when it isn’t straight sets. intervals = timed rounds the app runs hands-free (seconds on, rest_seconds off).' },
    muscle: { type: 'string', enum: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio', 'full'], description: 'for an exercise they haven’t done before: the main muscle' },
    equipment: { type: 'string', enum: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'cardio'], description: 'for an exercise they haven’t done before' },
  },
  required: ['name', 'sets'],
} as const;

/** Where Arvy can take you (open_screen). */
export const SCREENS: Record<string, string> = {
  '/': 'Today', '/plan': 'Plan (today’s page)', '/plan/brief': 'the Brief', '/plan/night': 'the night review', '/plan/morning': 'the morning routine',
  '/plan/week': 'week review', '/plan/month': 'month review', '/calendar': 'Calendar', '/shop': 'Shopping list',
  '/habits': 'Habits', '/habits/new': 'new habit', '/workout': 'Train', '/workout/templates': 'workout templates', '/workout/history': 'workout history',
  '/workout/body': 'body weight', '/food': 'Food', '/food/add': 'log a meal', '/food/history': 'food history',
  '/food/targets': 'food targets', '/food/favourites': 'favourite meals', '/food/recipes': 'recipes', '/food/sway': 'the sway food guide',
  '/money': 'Money', '/money/transactions': 'transactions', '/money/budget': 'budget', '/money/accounts': 'accounts', '/money/recurring': 'recurring payments',
  '/money/receipts': 'receipts', '/money/cash': 'cash wallet', '/money/import': 'import a statement', '/settings': 'Settings', '/settings/arvy-log': 'Arvy’s improvements log',
  '/cycle': 'Cycle', '/cycle/history': 'cycle history',
};

export const TOOLS: ArvyTool[] = [
  { name: 'today_overview', description: 'One day at a glance: routine_today (that day’s blocks with their times, and what was changed for the day), the plan page (priorities, to-dos with done/not done, schedule, routine ticks like wake/gym/lights-out, Brief answers), habits due and how they were marked, meals with totals against the food targets, calendar events, and the workout (planned, in progress or done). Use this first for "how’s my day", "what’s left", "what did I do yesterday".',
    input_schema: { type: 'object', properties: { date: date('the day; default today') } } },
  { name: 'calendar', description: 'Household calendar events between two dates (repeating events expanded), with time and who they’re for (Vijay, Rosh, both, Kiaan).',
    input_schema: { type: 'object', properties: { from: date('first day'), to: date('last day; up to 92 days after from') }, required: ['from'] } },
  { name: 'shopping_list', description: 'The shared shopping list: what’s still to get (with quantity, store section, who added it and the best flyer deal) and, if asked, what was ticked off recently.',
    input_schema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'also list items ticked off in the last 7 days' } } } },
  { name: 'food_log', description: 'Meals logged between two dates (name, time, calories and protein/carbs/fat) with the total for each day and the daily targets.',
    input_schema: { type: 'object', properties: { from: date('first day; default today'), to: date('last day; default the same day') } } },
  { name: 'workouts', description: 'Training: recent workouts (date, name, minutes, exercises with the sets done, PRs), any workout in progress, the workout templates and which days they’re for, and recent body weight.',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'how far back, default 14, at most 90' } } } },
  { name: 'habits', description: 'Habits: each active habit with its days, the routine slot it’s stacked on, how it was marked each day (done, mini, skip) and the current streak.',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'how far back, default 14, at most 60' } } } },
  { name: 'money', description: 'Household money for a month: spending by category against the budget, money in and out, the biggest merchants, the latest transactions, and the accounts (names and types only). Shared with the household.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM; default this month' }, category: { type: 'string', description: 'only this spending category, e.g. Groceries' }, search: { type: 'string', description: 'only transactions whose merchant or description has this, e.g. "costco"' } } } },
  { name: 'cycle', morningOnly: true, description: 'The cycle tracker: recent periods (start, end), the predicted next period and fertile window, and recent daily logs (symptoms, mood, notes).',
    input_schema: { type: 'object', properties: {} } },
  { name: 'coaching_context', description: 'Everything a coach needs, in one go: training_state (the worked-out numbers: readiness from sleep and food, hard sets per muscle per week, RPE trend, e1RM progress per lift, pain notes), their own notes about themselves, the workout templates and what’s planned for which date, a workout in progress, recent workouts with every set (weight x reps @RPE) and their notes, recent days (brief, priorities, ticks, review, scores), habits and marks, meals, the routine, the next two weeks of calendar and body weight. Call this first for anything about training, a session plan or change, soreness or pain, recovery, progress on a lift, or "how am I doing" as a coach.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'remember', description: 'Save a short note about the person to remember for next time (a preference, a goal, an injury, something about their routine, how they want to be coached). Only when they ask you to remember something, or tell you something clearly worth keeping. Every coaching answer, session review and day reflection reads these.',
    input_schema: { type: 'object', properties: { note: { type: 'string', description: 'one sentence, in the third person, e.g. "Prefers to train in the evening."' } }, required: ['note'] } },
  { name: 'open_screen', description: 'Open a screen of the planner for them (e.g. "show me my budget"). The chat stays open.',
    input_schema: { type: 'object', properties: { path: { type: 'string', enum: Object.keys(SCREENS) } }, required: ['path'] } },
  { name: 'log_feedback', description: 'Save feedback to the improvements log so it gets fixed or built: when they say something in the planner (or about you) is broken, wrong, slow, confusing or annoying (type "bug"), or wish something worked differently or existed (type "idea"). Use their own words. Then tell them it’s logged. Not for things you can simply do or answer now.',
    input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['bug', 'idea'] }, title: { type: 'string', description: 'one line: what’s wrong or wanted' }, detail: { type: 'string', description: 'what happened, what they expected, where; in their words' }, area: { type: 'string', enum: ['plan', 'calendar', 'shopping', 'food', 'habits', 'workout', 'money', 'cycle', 'arvy', 'other'] } }, required: ['type', 'title'] } },
  { name: 'cant_do_yet', description: 'Note something they asked you to DO that none of your tools can do (for example: log sets in a workout, edit a recipe, change settings), so it gets built. Call it, then tell them it’s noted and, when there is one, open the screen where they can do it themselves.',
    input_schema: { type: 'object', properties: { request: { type: 'string', description: 'what they asked for, in a few words' }, area: { type: 'string', enum: ['plan', 'calendar', 'shopping', 'food', 'habits', 'workout', 'money', 'cycle', 'other'] } }, required: ['request', 'area'] } },

  // ── changes: done straight away, with an Undo ──
  { name: 'add_shopping_items', change: 'now', description: 'Add items to the shared shopping list (an item already on it gets the quantity merged).',
    input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'the item, e.g. "Milk"' }, qty: { type: 'string', description: 'optional, e.g. "2 L" or "x3"' } }, required: ['text'] } } }, required: ['items'] } },
  { name: 'check_off_shopping', change: 'now', description: 'Tick items off the shopping list as got (done true, the default) or put ticked items back (done false). Names as they are on the list.',
    input_schema: { type: 'object', properties: { items: strs('item names'), done: { type: 'boolean' } }, required: ['items'] } },
  { name: 'add_todos', change: 'now', description: 'Add to-dos to a day’s plan page.',
    input_schema: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, time: { type: 'string', description: 'optional, HH:MM 24-hour' }, must: { type: 'boolean', description: 'a must-do for the day' } }, required: ['text'] } }, date: date('the day; default today') }, required: ['todos'] } },
  { name: 'complete_todos', change: 'now', description: 'Mark to-dos on a day’s plan done (done true, the default) or not done (done false). Names as they are on the plan.',
    input_schema: { type: 'object', properties: { todos: strs('to-do texts'), done: { type: 'boolean' }, date: date('the day; default today') }, required: ['todos'] } },
  { name: 'log_meal', change: 'now', description: 'Log something they ate or drank: the calories and protein/carbs/fat are estimated from the description.',
    input_schema: { type: 'object', properties: { description: { type: 'string', description: 'what and how much, in their words, e.g. "2 eggs on toast and a latte"' }, name: { type: 'string', description: 'short meal name, e.g. "Breakfast"' }, time: { type: 'string', description: 'HH:MM 24-hour; default now' }, date: date('default today') }, required: ['description'] } },
  { name: 'mark_habit', change: 'now', description: 'Mark a habit for a day: done, mini (a smaller version), skip (a planned rest day) or clear (unmark).',
    input_schema: { type: 'object', properties: { habit: { type: 'string', description: 'the habit’s name' }, mark: { type: 'string', enum: ['done', 'mini', 'skip', 'clear'] }, date: date('default today') }, required: ['habit'] } },
  { name: 'set_must', change: 'now', description: 'Star to-dos as must-dos for the day (must true, the default), or unstar them (must false). The first three must-dos are the day’s priorities.',
    input_schema: { type: 'object', properties: { todos: strs('to-do texts'), must: { type: 'boolean' }, date: date('the day; default today') }, required: ['todos'] } },
  { name: 'log_favourite_meal', change: 'now', description: 'Log one of their saved favourite meals ("my usual breakfast", "the protein shake"). Look at food_log first if unsure of the names.',
    input_schema: { type: 'object', properties: { favourite: { type: 'string', description: 'the favourite’s name' }, time: { type: 'string', description: 'HH:MM 24-hour; default now' }, date: date('default today') }, required: ['favourite'] } },
  { name: 'save_favourite', change: 'now', description: 'Save a meal they logged as a favourite, so it can be logged again in one go.',
    input_schema: { type: 'object', properties: { meal: { type: 'string', description: 'the logged meal’s name' }, name: { type: 'string', description: 'the favourite’s name, if different' }, date: date('the day it was logged; default today') }, required: ['meal'] } },
  { name: 'log_cycle_day', change: 'now', morningOnly: true, description: 'Log how a day of the cycle went: flow (spotting, light, medium, heavy), symptoms (cramps, headache, bloating, tender breasts, backache, acne, fatigue, nausea, cravings), mood (calm, happy, energetic, irritable, anxious, sad, mood swings), and a note. Adds to what’s logged.',
    input_schema: { type: 'object', properties: { date: date('default today'), flow: { type: 'string', enum: ['spotting', 'light', 'medium', 'heavy'] }, symptoms: strs('symptoms'), mood: strs('moods'), notes: { type: 'string' } } } },
  { name: 'log_period', change: 'now', morningOnly: true, description: 'Her period started (the end is estimated from her usual length) or ended, on a day.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['started', 'ended'] }, date: date('default today') }, required: ['action'] } },
  { name: 'log_body_weight', change: 'now', description: 'Log their body weight for a day, in their units.',
    input_schema: { type: 'object', properties: { weight: { type: 'number' }, date: date('default today') }, required: ['weight'] } },
  { name: 'adjust_day', change: 'now', since: 2, description: 'Change the shape of ONE day of their routine (today unless a date is given; today or a day ahead): leave blocks out (skip), move times, and add blocks at a time. For a sick day, a rest day, a late night, travel, "sleep in tomorrow", "no sauna today", "gym at 5 tonight instead". The Today screen, the reminders and the streaks then follow that day’s plan (a skipped gym counts as a planned rest day). Give only what changes: it adds to changes already made to that day. reset true puts the day back to the normal routine. Things that are part of the day’s shape at a set time (a stretch session, a nap, breakfast, a walk) go in add, not in to-dos. For a change meant for every day from now on, use change_routine.',
    input_schema: { type: 'object', properties: {
      date: date('the day; default today'),
      why: { type: 'string', description: 'two or three words shown on the Today screen, e.g. "Sick day", "Rest day", "Late night"' },
      skip: { type: 'array', items: { type: 'string', enum: ['gym', 'sauna', 'brief', 'kitchen', 'dinner', 'morning_routine', 'kiaan_up', 'evening_review'] }, description: 'blocks to leave out that day (only ones their routine has; see routine_today in today_overview). kitchen = the kitchen-closed cut-off.' },
      unskip: { type: 'array', items: { type: 'string' }, description: 'blocks to put back' },
      wake: { type: 'string', description: 'up at, HH:MM 24-hour. The rest of the morning moves with it.' },
      gym: { type: 'string', description: 'gym at, HH:MM 24-hour. Much later than usual (say 17:00) = the gym moves out of the morning for the day, sauna with it.' },
      list_start: { type: 'string', description: 'when the to-do list starts, HH:MM 24-hour; only when they name a time (otherwise it follows the morning)' },
      kitchen_closes: { type: 'string', description: 'last food that day, HH:MM 24-hour' },
      dinner: { type: 'string', description: 'dinner at, HH:MM 24-hour' },
      lights_out: { type: 'string', description: 'lights out that night, HH:MM 24-hour' },
      sauna_minutes: { type: 'number', description: 'a shorter or longer sauna that day' },
      add: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', description: 'short, e.g. "Home stretch"' }, time: { type: 'string', description: 'HH:MM 24-hour' }, end_time: { type: 'string', description: 'HH:MM 24-hour' }, note: { type: 'string', description: 'one short line' } }, required: ['title', 'time'] }, description: 'blocks to add that day' },
      remove: strs('titles of blocks added earlier to take out again'),
      reset: { type: 'boolean', description: 'true = back to the normal routine for that day' },
    } } },

  // ── changes that wait for a Confirm tap ──
  { name: 'create_habit', change: 'confirm', description: 'Make a new habit. Days default to every day. Keep the name short; add the tiny two-minute version and what it’s stacked after when they said.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, days: strs('weekdays it’s due, e.g. ["mon","wed","fri"]; leave out for every day'), two_minute: { type: 'string', description: 'the tiny version, e.g. "read one page"' }, after: { type: 'string', description: 'stacked after, e.g. "pour my morning coffee"' }, why: { type: 'string' }, identity: { type: 'string', description: '"I’m the kind of person who…"' } }, required: ['name'] } },
  { name: 'pause_habit', change: 'confirm', description: 'Pause (archive) a habit, keeping its history; or bring a paused one back (resume true).',
    input_schema: { type: 'object', properties: { habit: { type: 'string' }, resume: { type: 'boolean' } }, required: ['habit'] } },
  { name: 'set_food_targets', change: 'confirm', description: 'Change their daily food targets. Give only the numbers that change.',
    input_schema: { type: 'object', properties: { kcal: { type: 'number' }, protein: { type: 'number', description: 'grams' }, carbs: { type: 'number', description: 'grams' }, fat: { type: 'number', description: 'grams' } } } },
  { name: 'set_budget', change: 'confirm', description: 'Set the monthly budget for one spending category (0 removes it). Shared with the household.',
    input_schema: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number', description: 'dollars a month' } }, required: ['category', 'amount'] } },
  { name: 'change_routine', change: 'confirm', since: 2, description: 'Change their standing routine: every day from now on (Settings, My routine). Give only what changes. Moving the wake time moves the gym and the start of the list with it unless you give those too. For one day only, use adjust_day.',
    input_schema: { type: 'object', properties: {
      wake: { type: 'string', description: 'up at, HH:MM 24-hour' }, wake_grace_minutes: { type: 'number', description: 'minutes after the wake time that still count as on time' },
      gym: { type: 'string', description: 'gym at, HH:MM 24-hour' }, sauna_minutes: { type: 'number', description: 'sauna after the gym, in minutes; 0 = none' },
      list_start: { type: 'string', description: 'out of the sauna, the to-do list starts, HH:MM 24-hour' },
      kitchen_closes: { type: 'string', description: 'last food of the day, HH:MM 24-hour; "none" = no cut-off' },
      dinner: { type: 'string', description: 'dinner (the first meal when an eating window is on), HH:MM 24-hour' }, window_closes: { type: 'string', description: 'eating window closes, HH:MM 24-hour' },
      eating_window: { type: 'boolean', description: 'follow an eating window (fasting card and streak) or not' },
      lights_out: { type: 'string', description: 'HH:MM 24-hour' }, brief_minutes: { type: 'number' },
      stretch_minutes: { type: 'number' }, meditate_minutes: { type: 'number' }, workout_minutes: { type: 'number', description: 'the morning routine’s light workout' }, kiaan_up: { type: 'string', description: 'HH:MM 24-hour' },
    } } },
  { name: 'plan_workout', change: 'confirm', description: 'Put a training session you planned on their Train page. Write the session out in your reply too (one line per exercise, blocks named). when: "today" or "tomorrow" makes it that day’s session (replacing one already planned for that day); leave it out and it goes to today, or tomorrow if today’s workout is already done or under way; "now" starts it straight away; "template" saves it as a reusable template (replace = the name of a template to overwrite). Use the exercise names they already use (see workout_templates and recent workouts) so their history carries over. Sessions can be more than straight sets: supersets, circuits, EMOMs, AMRAPs, pyramids, countdowns, drop sets and intervals each get their own tracker (see the exercise fields).',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'short session name, e.g. "Upper pull + core"' }, when: { type: 'string', enum: ['today', 'tomorrow', 'now', 'template'] }, replace: { type: 'string', description: 'with when "template": the template to overwrite' },
      exercises: { type: 'array', items: EXERCISE } }, required: ['name', 'exercises'] } },
  { name: 'remove_shopping_items', change: 'confirm', description: 'Remove items from the shopping list altogether (not ticking them off).',
    input_schema: { type: 'object', properties: { items: strs('item names') }, required: ['items'] } },
  { name: 'remove_todos', change: 'confirm', description: 'Remove to-dos from a day’s plan altogether (not marking them done).',
    input_schema: { type: 'object', properties: { todos: strs('to-do texts'), date: date('the day; default today') }, required: ['todos'] } },
  { name: 'add_event', change: 'confirm', description: 'Add an event to the household calendar. "who" is whose it is: default the person you’re talking with; "both" for the two of them; "kiaan" for their son.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, date: date('the day (the first one, if it repeats)'), time: { type: 'string', description: 'HH:MM 24-hour; leave out for all day' }, end_time: { type: 'string', description: 'HH:MM 24-hour' }, who: WHO, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'] }, until: date('last day it repeats'), notes: { type: 'string' } }, required: ['title', 'date'] } },
  { name: 'change_event', change: 'confirm', description: 'Change a calendar event: find it by the day it’s on (and its title if there are several that day), then give only what changes. A repeating event changes every time it repeats, and can’t be moved to another day here.',
    input_schema: { type: 'object', properties: { date: date('a day it’s on'), title: { type: 'string', description: 'its current title' }, new_title: { type: 'string' }, new_date: date('move it to this day'), new_time: { type: 'string', description: 'HH:MM 24-hour (the end moves with it)' }, new_end_time: { type: 'string', description: 'HH:MM 24-hour' }, all_day: { type: 'boolean' }, who: WHO, notes: { type: 'string', description: 'replaces the notes; empty to clear' } }, required: ['date'] } },
  { name: 'delete_event', change: 'confirm', description: 'Delete a calendar event, found by the day it’s on (and its title). For a repeating event, scope "this" skips just that day; "all" deletes the whole series.',
    input_schema: { type: 'object', properties: { date: date('the day it’s on'), title: { type: 'string' }, scope: { type: 'string', enum: ['this', 'all'] } }, required: ['date'] } },
  { name: 'add_cash_expense', change: 'confirm', description: 'Record something paid in cash in the cash wallet (Money). Category is one of the spending categories (e.g. Groceries, Dining, Gas, Shopping, Kids, Health).',
    input_schema: { type: 'object', properties: { amount: { type: 'number', description: 'dollars' }, what: { type: 'string', description: 'what or where, e.g. "Farmers market"' }, category: { type: 'string' }, date: date('default today') }, required: ['amount', 'category'] } },
  { name: 'recategorize', change: 'confirm', description: 'Move a month’s transactions whose merchant or description has the search words to another category (e.g. all the Costco ones to Groceries).',
    input_schema: { type: 'object', properties: { search: { type: 'string' }, category: { type: 'string' }, month: { type: 'string', description: 'YYYY-MM; default this month' } }, required: ['search', 'category'] } },
];

export const toolsFor = (profile?: Profile, v: number = TOOLS_VERSION) => TOOLS.filter(t => (!t.morningOnly || profile === 'morning') && (t.since || 1) <= v)
  .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
/** How a tool changes things: 'now', 'confirm', or undefined for a look-up. */
export const changeOf = (name: string) => TOOLS.find(t => t.name === name)?.change;

// How Arvy reasons about training: current exercise science, applied to the numbers in training_state. Added to what
// Arvy is told once it has pulled the coaching context.
export const COACHING = `
HOW TO COACH (evidence-based; apply it, don't lecture):
Read training_state first: readiness (sleep, food), load (sessions, hard sets per muscle per week, RPE trend, weeks since an
easier week), progress (e1RM per lift: up / flat / stalled / down), pain_or_niggles. Then the about_me notes (goals, age, limits).
- Readiness: under 6 h sleep last night or a 7-night average under 6.5 h → keep the session but cut hard sets ~25-30%, cap effort
  at RPE 7 (3 reps in reserve), no max attempts, keep technique work. Protein well under target yesterday/today or training
  fasted late in the day → favour moderate volume and say to get protein in within a few hours after. Good sleep and fed → push.
- Effort: most working sets at RPE 7-9 (1-3 reps in reserve); last set of an exercise may go to RPE 9. Hypertrophy works from
  ~5 to ~30 reps when close to failure; strength needs heavier sets (3-6 reps at 80-90% e1RM). Rest 2-3 min on big compound
  lifts, 60-90 s on isolation; short rest costs reps on compounds.
- Volume: count hard sets per muscle per week. ~10 is a solid starting dose, 10-20 the productive range; past ~20 recovery
  usually lags. Add sets only where progress is stalled AND recovery is good. Train each muscle about 2x a week; give a
  muscle 48-72 h before loading it hard again (see days_since_trained).
- Progression: double progression — hit the top of the rep range on all sets at the target RPE, then add the smallest
  load step (upper body ~2.5-5 lb / 1-2.5 kg, lower ~5-10 lb / 2.5-5 kg) and drop back to the bottom of the range.
  Assisted lifts progress by REMOVING counterweight. Rising RPE at the same load plus flat/stalled e1RM for 2-3 sessions =
  fatigue, not weakness.
- Deloads: after 4-8 weeks of steady hard training (weeks_since_easier_week), or when several lifts stall with RPE drifting
  up, or sleep is bad for days → one easier week: same exercises, ~half the sets, RPE 6-7.
- Conditioning: zone 2 = conversational pace (can talk in sentences, ~60-70% of max HR; 220 − age is a rough max) for
  most cardio; HIIT 1-2x a week max, short work with full-ish rest for beginners. Hard intervals or long runs right before
  heavy legs blunt the lift — put them after lifting, on upper days, or 6+ h apart.
- Pain: sharp pain, pain that changes how you move, or pain above ~3/10 that gets worse set to set → stop that lift and swap
  to a pain-free variation or range (tempo, lighter, partial range, machine). Dull muscle soreness is fine to train around
  (other muscles, or lighter). Anything that sounds like an injury, swelling, numbness or pain lasting over a week → see a
  physiotherapist or doctor; stay conservative. Use pain_or_niggles: don't load what's sore without saying how you adapted.
- Every plan says in one line why it fits today (e.g. "6 h sleep, chest trained 2 days ago → upper pull + legs, RPE 7").
  Quote the real numbers. Never invent data that isn't in the context.
COACHING ANSWERS: quote their real numbers and their own notes; never say you lack data that is in the context. These can
run longer than your usual answers, but stay phone-sized: short paragraphs, specific numbers, no fluff. A session plan is
one line per exercise (name: sets x reps, weight, one cue) with no long preamble, so even a 70-minute session fits, and
weights are in their units. When they ask you to plan, change or adjust a session, write the COMPLETE session and call
plan_workout with it in the same step (today's session is still ahead unless a recent workout is dated today or one is in
progress), then ask them to tap Confirm.`;

// Which session formats exist, when each fits, and which tracker an exercise needs. Part of coaching (the chat and
// the after-workout plan both get it).
export const FORMATS = `
SESSION FORMATS (shake the sessions up; the app has a tracker for each):
- Straight sets stay the default for the main strength lift, where steady progression matters. Around it, change the
  format from session to session. workout_templates and the recent workouts show the formats used lately: don't run
  the same one two sessions in a row, and say in the one-line why which format you chose.
- Superset: two exercises with the same group letter, done back to back, rest after the pair (rest_seconds on the last
  one, 0 on the first). Pair moves that don't compete: push + pull, lower + core, a lift + a mobility drill. Circuit:
  three or more with the same letter. Kettlebell, core and accessory work is almost always better paired or circuited
  than done as lone straight sets.
- EMOM (group_style "emom", group_minutes 6-12): one move at the top of every minute; with two or three moves they take
  the minutes in turn. Pick reps that take 20-40 seconds so there is rest in each minute. AMRAP (group_style "amrap",
  group_minutes 5-12): two to four moves, low reps each, a pace they can hold. In both: sets 1, reps = the reps each
  minute or round. Good for kettlebell swings, goblet squats, push-ups, rows, carries.
- Pyramid: reps_by_set like [12,10,8,6] with the weight going up as the reps come down (weight_by_set when you know
  their numbers), or up and back down. Countdown / ladder: reps_by_set like [10,9,8,7,6,5,4,3,2,1] or [10,8,6,4,2],
  best as a superset of two moves sharing the ladder, short or no rest. Drop set (style "drop", weight_by_set going
  down): the last set of an isolation move only, when recovery is good.
- Intervals (style "intervals"): seconds = the work, rest_seconds = the easy part, sets = the rounds; the app runs the
  clock hands-free with a beep. For the bike, treadmill, rower, or swings for time.
TRACKERS (what gets logged has to fit the move):
- per_side for anything done one side or one direction at a time: one-arm rows, lunges, split squats, step-ups, chops,
  windmills, halos (each direction), suitcase carries, side planks, most stretches. The reps or seconds are then per side.
- no_weight for bodyweight and mobility drills (cat-cow, 90/90s, dead bugs, bridges, stretches, breathing).
- seconds, not reps, for holds, carries, cardio and stretches.
- For a move they haven't done before, give muscle and equipment (a kettlebell move is "kettlebell", not "dumbbell").
KEEP IT SANE: one or two format changes a session, not everything at once. Their joints and notes come first (see
about_me and pain_or_niggles). No heavy barbell lift inside a circuit, EMOM or AMRAP. When readiness is poor, choose the
gentler formats (supersets with mobility, easy intervals) over the dense ones (AMRAP, drop sets).`;

// ── the plan written after each workout (action 'dayplan'): a review of today, two questions, tomorrow's session ──
/** What Arvy is told for the after-workout plan. */
export const dayplanSystem = () => `You are Arvy, the assistant and coach inside this planner. The person just completed today's workout (it is in the context with every set and note,
along with recent sessions, habits, meals, days and the about_me notes — read the about_me notes first: they hold the
training goals, health limits and session length). Produce:
1. review: one or two short paragraphs (120-200 words total, no lists/headings) reviewing today's session using the real
   numbers and notes, then what tomorrow's session is and why it fits the goals (everyday habit, no overtraining, strength
   a couple of days a week, beginner HIIT for the lungs, mobility, hips/knees). Speak to the person directly.
2. questions: exactly 2 short multiple-choice questions whose answers would change tomorrow's plan (e.g. how the hips/knees
   feel, energy/sleep, time available, what they feel like). 3-4 choices each, a few words per choice. When answers are
   provided in the message, return an empty questions list and fold the answers into the plan.
3. tomorrow: a complete session for tomorrow, 40-70 minutes: name (short, with the focus), focus (strength | hiit |
   mobility | mixed | active-recovery), minutes, why (one line: the numbers that decided it AND the format you chose),
   exercises in order. Use exercise names from the library list exactly when one fits, so their history carries over.
   Beginner HIIT = short work intervals with generous rest (e.g. 20s on / 40s off, 8-10 rounds) on bike/rower/walk-run;
   mobility = hip/knee-friendly flows and holds; never load painful joints. Keep the person's session length.
   Use training_state to pick tomorrow's focus: muscles with the most days_since_trained and the fewest hard sets this week
   first, respect 48-72 h recovery, and lower the dose when readiness is poor.` + COACHING + FORMATS;
export const DAYPLAN_SCHEMA = {
  type: 'object', properties: {
    review: { type: 'string' },
    questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } } }, required: ['id', 'text', 'choices'] } },
    tomorrow: { type: 'object', properties: {
      name: { type: 'string' }, focus: { type: 'string', enum: ['strength', 'hiit', 'mobility', 'mixed', 'active-recovery'] }, minutes: { type: 'integer' }, why: { type: 'string' },
      exercises: { type: 'array', items: EXERCISE },
    }, required: ['name', 'focus', 'minutes', 'why', 'exercises'] },
  }, required: ['review', 'questions', 'tomorrow'],
} as const;
/** The planner context as text, the worked-out training numbers and their notes first (long contexts are cut from the end). */
export function contextText(c: unknown, max: number): string {
  if (!c || typeof c !== 'object') return JSON.stringify(c ?? {}).slice(0, max);
  const o = c as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of ['today', 'weekday', 'now', 'units', 'training_state', 'about_me_notes_oldest_first', 'workout_in_progress', 'routine']) if (k in o) ordered[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in ordered)) ordered[k] = o[k];
  return JSON.stringify(ordered).slice(0, max);
}

/** True once the conversation has pulled the coaching context: Arvy then gets COACHING and room for a longer answer. */
export const isCoaching = (messages: Msg[]): boolean => messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' && (b.name === 'coaching_context' || b.name === 'plan_workout')));

/** What Arvy is told. `coaching` adds how to coach (once the coaching context is in the conversation). */
export function system(ctx: ArvyCtx, coaching = false): string {
  const name = ctx.name || 'there';
  const other = ctx.username === 'rosh' ? 'Vijay' : 'Rosh';
  const schedule = (ctx.v ?? TOOLS_VERSION) >= 2;   // the app can reshape a day and change the routine (adjust_day, change_routine)
  return [
    `You are Arvy (pronounced "AR-vee"), the assistant and coach inside ${name}'s personal planner app. You're helpful and upbeat: warm, quick, a little bit of energy, never cheesy or over the top. You are Arvy; don't describe yourself as an AI model.`,
    `You're talking with ${name}. Their household: ${name}, ${other}, and Kiaan (their son). The calendar, shopping list and money are shared by the household; everything else is ${name}'s own.`,
    `Today is ${ctx.weekday || ''} ${ctx.today || ''}, it's ${ctx.now || 'now'}. The planner's day starts at 4 am. Units: ${ctx.units || 'lb'}. They're on the "${ctx.path || '/'}" screen.`,
    ctx.about?.length ? `What they've told you to keep in mind about them (their own notes, oldest first):\n${ctx.about.map(n => `  · ${n}`).join('\n')}` : '',
    'How to work:',
    '- Use your tools to look things up: never guess or make up their data. Call several at once when a question needs them.',
    '- Keep it short: lead with what matters most, then two or three sentences (about 60 words) unless they ask for detail or a full list. No headings. A short list only when they asked for a list (like the shopping list). Numbers rounded, dates said naturally ("Saturday at 6").',
    '- Sound like a friend who knows their planner inside out: a quick nod to what they’ve done well, then what’s next. End with a short offer (open a screen, look at something else) only when it’s useful.',
    `- You can make changes for them: shopping list, to-dos and must-dos, meals and favourites, habit marks, body weight${schedule ? ', the shape of one day' : ''}${ctx.profile === 'morning' ? ' and the cycle log' : ''} happen straight away (they get an Undo button). Calendar events, a planned workout,${schedule ? ' the standing routine,' : ''} new or paused habits, food targets, removing anything, and money (cash, categories, budgets) wait for them to tap Confirm: when a tool says waiting_for_confirm, say what you set up in a few words and ask them to tap Confirm. Never say it’s done until it is.`,
    '- Do what they ask without double-checking first, unless something important is missing (like the day for an event): then ask one short question. If a tool says not_done, explain why in a sentence (and ask which one, if several match).',
    !schedule ? '' : '- When their day changes (sick, a rest day, slept in, a late night, travelling, “no sauna today”, “gym tonight instead”), reshape that day with adjust_day so the Today screen and the reminders match what they’ll really do: skip what’s off, move the times, add what they’re doing instead. Don’t leave the old blocks standing and don’t turn the day’s shape into to-dos. If the planned workout no longer fits, plan one that does (or say there’s none). “From now on”, “every day” or new rules for the routine: change_routine.',
    '- Earlier messages start with when they were sent, like [Tue Nov 10, 11:28 PM]: “today” and “tomorrow” in them, and in your replies to them, count from that day, not from now. A [Change: …] note under one of your earlier replies says what became of it (made, still waiting for Confirm, cancelled, undone): go by the note, not by what the reply said. Never start your own reply with a time stamp.',
    '- Anything to add, change or delete that no tool covers: call cant_do_yet, say it’s on the way, and open the screen where they can do it.',
    '- After a change, confirm it in one short sentence ("Added milk and eggs to the list!"). Don’t repeat the details shown under your reply.',
    '- When something would be easier to see on its screen, offer to open it (or just open it if they asked to see it).',
    '- Money: talk about spending and budgets; you never move money, pay anything, or see account numbers.',
    '- You are their coach too: strength and conditioning first, but also the whole day (routine, habits, food, sleep, priorities, reviews). For anything about training, a session, soreness or pain, recovery, a stuck lift, or how they’re really doing, call coaching_context first and coach from the real numbers. Planning or changing a session: write it out and call plan_workout. You make the sessions up yourself, and they needn’t be plain sets: supersets, circuits, EMOMs, AMRAPs, pyramids, countdowns and intervals all have trackers.',
    '- Food and training: encourage, don’t lecture. Health questions beyond the planner: keep it general and suggest a professional when it matters.',
    '- When they tell you something in the app is broken or could be better, or give you feedback on yourself, save it with log_feedback and say it’s in the log (Settings, Arvy’s log).',
    ctx.spoken ? '- This message was spoken and turned into text, so names and words may be misheard: go with the closest sensible meaning. Your reply will be read out loud, so keep it to two or three sentences, no lists, no symbols (for a session plan, say the gist and that the full plan is on screen).' : '',
    coaching ? COACHING + FORMATS : '',
  ].filter(Boolean).join('\n');
}

// ── what the app sends and gets back: plain Claude messages, checked and trimmed on the server ──
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export interface Msg { role: 'user' | 'assistant'; content: string | Block[] }

const MAX_TEXT = 4000, MAX_RESULT = 14000, MAX_COACH_RESULT = 37000;

/** Keep only well-formed messages: text, tool_use (known tools) and tool_result blocks, sizes capped. Starts at a user
 *  message and ends at a user message (a question or tool results); null when there's nothing to answer. */
export function cleanMessages(raw: unknown, profile?: Profile): Msg[] | null {
  if (!Array.isArray(raw)) return null;
  const names = new Set(toolsFor(profile).map(t => t.name));
  const out: Msg[] = [];
  const asked = new Map<string, string>();   // tool call id → tool name (the coaching context may be longer)
  for (const m of raw.slice(-40)) {
    const role = (m as Msg)?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const c = (m as Msg).content;
    if (typeof c === 'string') { if (c.trim()) out.push({ role, content: c.slice(0, MAX_TEXT) }); continue; }
    if (!Array.isArray(c)) continue;
    const blocks: Block[] = [];
    for (const b of c as Block[]) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) blocks.push({ type: 'text', text: b.text.slice(0, MAX_TEXT) });
      else if (b?.type === 'tool_use' && role === 'assistant' && typeof b.id === 'string' && names.has(b.name)) { asked.set(b.id.slice(0, 80), b.name); blocks.push({ type: 'tool_use', id: b.id.slice(0, 80), name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} }); }
      else if (b?.type === 'tool_result' && role === 'user' && typeof b.tool_use_id === 'string') { const id = b.tool_use_id.slice(0, 80); blocks.push({ type: 'tool_result', tool_use_id: id, content: String(b.content ?? '').slice(0, asked.get(id) === 'coaching_context' ? MAX_COACH_RESULT : MAX_RESULT), ...(b.is_error ? { is_error: true } : {}) }); }
    }
    if (blocks.length) out.push({ role, content: blocks });
  }
  while (out.length && (out[0].role !== 'user' || hasResults(out[0]))) out.shift();   // never start mid tool call
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}
const hasResults = (m: Msg) => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result');

/** Arvy's voice: a woman's for Rosh (the morning profile), a man's for Vijay. Google Chirp 3 HD voices. */
export const voiceFor = (profile?: Profile, env: { morning?: string; night?: string } = {}) =>
  profile === 'morning' ? env.morning || 'Aoede' : env.night || 'Puck';

/** What to say out loud: no markdown or lists, a few sentences at most. */
export function speakable(text: string, maxSentences = 3): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/([:;,.!?])\s*\n+\s*/g, '$1 ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]?/g) || [];
  return sentences.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
}
