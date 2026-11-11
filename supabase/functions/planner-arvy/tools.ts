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
// is how to reason about training, and plan_workout puts a session on the Train page.
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
}
/** change: 'now' = done straight away with an Undo; 'confirm' = waits for them to tap Confirm. */
export interface ArvyTool { name: string; description: string; input_schema: Record<string, unknown>; morningOnly?: boolean; change?: 'now' | 'confirm' }

const date = (d: string) => ({ type: 'string', description: `${d} (YYYY-MM-DD)` });
const strs = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d });
const WHO = { type: 'string', enum: ['vijay', 'rosh', 'both', 'kiaan'], description: 'whose event it is' };

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
  { name: 'today_overview', description: 'One day at a glance: the plan page (priorities, to-dos with done/not done, schedule, routine ticks like wake/gym/lights-out, Brief answers), habits due and how they were marked, meals with totals against the food targets, calendar events, and the workout (planned, in progress or done). Use this first for "how’s my day", "what’s left", "what did I do yesterday".',
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

  // ── changes that wait for a Confirm tap ──
  { name: 'create_habit', change: 'confirm', description: 'Make a new habit. Days default to every day. Keep the name short; add the tiny two-minute version and what it’s stacked after when they said.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, days: strs('weekdays it’s due, e.g. ["mon","wed","fri"]; leave out for every day'), two_minute: { type: 'string', description: 'the tiny version, e.g. "read one page"' }, after: { type: 'string', description: 'stacked after, e.g. "pour my morning coffee"' }, why: { type: 'string' }, identity: { type: 'string', description: '"I’m the kind of person who…"' } }, required: ['name'] } },
  { name: 'pause_habit', change: 'confirm', description: 'Pause (archive) a habit, keeping its history; or bring a paused one back (resume true).',
    input_schema: { type: 'object', properties: { habit: { type: 'string' }, resume: { type: 'boolean' } }, required: ['habit'] } },
  { name: 'set_food_targets', change: 'confirm', description: 'Change their daily food targets. Give only the numbers that change.',
    input_schema: { type: 'object', properties: { kcal: { type: 'number' }, protein: { type: 'number', description: 'grams' }, carbs: { type: 'number', description: 'grams' }, fat: { type: 'number', description: 'grams' } } } },
  { name: 'set_budget', change: 'confirm', description: 'Set the monthly budget for one spending category (0 removes it). Shared with the household.',
    input_schema: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number', description: 'dollars a month' } }, required: ['category', 'amount'] } },
  { name: 'plan_workout', change: 'confirm', description: 'Put a training session you planned on their Train page. Write the session out in your reply too (one line per exercise). when: "today" or "tomorrow" makes it that day’s session (replacing one already planned for that day); leave it out and it goes to today, or tomorrow if today’s workout is already done or under way; "now" starts it straight away; "template" saves it as a reusable template (replace = the name of a template to overwrite). Use the exercise names they already use (see workout_templates and recent workouts) so their history carries over.',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'short session name, e.g. "Upper pull + core"' }, when: { type: 'string', enum: ['today', 'tomorrow', 'now', 'template'] }, replace: { type: 'string', description: 'with when "template": the template to overwrite' },
      exercises: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sets: { type: 'number', description: 'working sets (a light warm-up set is not its own exercise)' }, reps: { type: 'string', description: 'reps per set, e.g. "8-10" or "12"; leave out for timed work' }, seconds: { type: 'number', description: 'timed work only (a plank, cardio): seconds per set' }, weight: { type: 'number', description: 'starting weight in their units, when you’re prescribing one' }, rest_seconds: { type: 'number' }, cue: { type: 'string', description: 'one short form or effort cue' } }, required: ['name', 'sets'] } } }, required: ['name', 'exercises'] } },
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

export const toolsFor = (profile?: Profile) => TOOLS.filter(t => !t.morningOnly || profile === 'morning')
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

/** True once the conversation has pulled the coaching context: Arvy then gets COACHING and room for a longer answer. */
export const isCoaching = (messages: Msg[]): boolean => messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' && (b.name === 'coaching_context' || b.name === 'plan_workout')));

/** What Arvy is told. `coaching` adds how to coach (once the coaching context is in the conversation). */
export function system(ctx: ArvyCtx, coaching = false): string {
  const name = ctx.name || 'there';
  const other = ctx.username === 'rosh' ? 'Vijay' : 'Rosh';
  return [
    `You are Arvy (pronounced "AR-vee"), the assistant and coach inside ${name}'s personal planner app. You're helpful and upbeat: warm, quick, a little bit of energy, never cheesy or over the top. You are Arvy; don't describe yourself as an AI model.`,
    `You're talking with ${name}. Their household: ${name}, ${other}, and Kiaan (their son). The calendar, shopping list and money are shared by the household; everything else is ${name}'s own.`,
    `Today is ${ctx.weekday || ''} ${ctx.today || ''}, it's ${ctx.now || 'now'}. The planner's day starts at 4 am. Units: ${ctx.units || 'lb'}. They're on the "${ctx.path || '/'}" screen.`,
    ctx.about?.length ? `What they've told you to keep in mind about them (their own notes, oldest first):\n${ctx.about.map(n => `  · ${n}`).join('\n')}` : '',
    'How to work:',
    '- Use your tools to look things up: never guess or make up their data. Call several at once when a question needs them.',
    '- Keep it short: lead with what matters most, then two or three sentences (about 60 words) unless they ask for detail or a full list. No headings. A short list only when they asked for a list (like the shopping list). Numbers rounded, dates said naturally ("Saturday at 6").',
    '- Sound like a friend who knows their planner inside out: a quick nod to what they’ve done well, then what’s next. End with a short offer (open a screen, look at something else) only when it’s useful.',
    `- You can make changes for them: shopping list, to-dos and must-dos, meals and favourites, habit marks, body weight${ctx.profile === 'morning' ? ' and the cycle log' : ''} happen straight away (they get an Undo button). Calendar events, a planned workout, new or paused habits, food targets, removing anything, and money (cash, categories, budgets) wait for them to tap Confirm: when a tool says waiting_for_confirm, say what you set up in a few words and ask them to tap Confirm. Never say it’s done until it is.`,
    '- Do what they ask without double-checking first, unless something important is missing (like the day for an event): then ask one short question. If a tool says not_done, explain why in a sentence (and ask which one, if several match).',
    '- Anything to add, change or delete that no tool covers: call cant_do_yet, say it’s on the way, and open the screen where they can do it.',
    '- After a change, confirm it in one short sentence ("Added milk and eggs to the list!"). Don’t repeat the details shown under your reply.',
    '- When something would be easier to see on its screen, offer to open it (or just open it if they asked to see it).',
    '- Money: talk about spending and budgets; you never move money, pay anything, or see account numbers.',
    '- You are their coach too: strength and conditioning first, but also the whole day (routine, habits, food, sleep, priorities, reviews). For anything about training, a session, soreness or pain, recovery, a stuck lift, or how they’re really doing, call coaching_context first and coach from the real numbers. Planning or changing a session: write it out and call plan_workout.',
    '- Food and training: encourage, don’t lecture. Health questions beyond the planner: keep it general and suggest a professional when it matters.',
    '- When they tell you something in the app is broken or could be better, or give you feedback on yourself, save it with log_feedback and say it’s in the log (Settings, Arvy’s log).',
    ctx.spoken ? '- This message was spoken and turned into text, so names and words may be misheard: go with the closest sensible meaning. Your reply will be read out loud, so keep it to two or three sentences, no lists, no symbols (for a session plan, say the gist and that the full plan is on screen).' : '',
    coaching ? COACHING : '',
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
