// supabase/functions/planner-arvy/tools.ts — Arvy (said "AR-vee"), the planner's assistant: its tools and what it's told.
// No Deno and no network here: the app imports this file too (src/planner/features/arvy), so the tool names the server
// offers Claude and the ones the app knows how to run are the same list. Tested from src/planner/features/arvy/arvy.test.ts.
//
// The planner keeps everything as documents and the code that reads and edits them lives in the app, so Arvy's tools
// run in the app (the same functions the screens use); the server only talks to Claude.
// Arvy looks things up, answers, remembers and opens screens, and makes changes (`change` tools, run by
// src/planner/features/arvy/act.ts): small everyday ones straight away with an Undo, bigger ones (calendar, removing
// anything, money) only after a Confirm tap. Anything else it's asked to do is noted (cant_do_yet) for later.

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
  '/workout/coach': 'Coach chat', '/workout/body': 'body weight', '/food': 'Food', '/food/add': 'log a meal', '/food/history': 'food history',
  '/food/targets': 'food targets', '/food/favourites': 'favourite meals', '/food/recipes': 'recipes', '/food/sway': 'the sway food guide',
  '/money': 'Money', '/money/transactions': 'transactions', '/money/budget': 'budget', '/money/accounts': 'accounts', '/money/recurring': 'recurring payments',
  '/money/receipts': 'receipts', '/money/cash': 'cash wallet', '/money/import': 'import a statement', '/settings': 'Settings',
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
  { name: 'remember', description: 'Save a short note about the person to remember for next time (a preference, a goal, something about their routine). Only when they ask you to remember something, or tell you something clearly worth keeping. Shared with Coach Claude.',
    input_schema: { type: 'object', properties: { note: { type: 'string', description: 'one sentence, in the third person, e.g. "Prefers to train in the evening."' } }, required: ['note'] } },
  { name: 'open_screen', description: 'Open a screen of the planner for them (e.g. "show me my budget"). The chat stays open.',
    input_schema: { type: 'object', properties: { path: { type: 'string', enum: Object.keys(SCREENS) } }, required: ['path'] } },
  { name: 'cant_do_yet', description: 'Note something they asked you to DO that none of your tools can do (for example: create a habit or workout, change a budget, log a period, edit a recipe), so it gets built. Call it, then tell them it’s noted and, when there is one, open the screen where they can do it themselves.',
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
  { name: 'log_body_weight', change: 'now', description: 'Log their body weight for a day, in their units.',
    input_schema: { type: 'object', properties: { weight: { type: 'number' }, date: date('default today') }, required: ['weight'] } },

  // ── changes that wait for a Confirm tap ──
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

/** What Arvy is told. */
export function system(ctx: ArvyCtx): string {
  const name = ctx.name || 'there';
  const other = ctx.username === 'rosh' ? 'Vijay' : 'Rosh';
  return [
    `You are Arvy (pronounced "AR-vee"), the assistant inside ${name}'s personal planner app. You're helpful and upbeat: warm, quick, a little bit of energy, never cheesy or over the top.`,
    `You're talking with ${name}. Their household: ${name}, ${other}, and Kiaan (their son). The calendar, shopping list and money are shared by the household; everything else is ${name}'s own.`,
    `Today is ${ctx.weekday || ''} ${ctx.today || ''}, it's ${ctx.now || 'now'}. The planner's day starts at 4 am. Units: ${ctx.units || 'lb'}. They're on the "${ctx.path || '/'}" screen.`,
    'How to work:',
    '- Use your tools to look things up: never guess or make up their data. Call several at once when a question needs them.',
    '- Keep it short: lead with what matters most, then two or three sentences (about 60 words) unless they ask for detail or a full list. No headings. A short list only when they asked for a list (like the shopping list). Numbers rounded, dates said naturally ("Saturday at 6").',
    '- Sound like a friend who knows their planner inside out: a quick nod to what they’ve done well, then what’s next. End with a short offer (open a screen, look at something else) only when it’s useful.',
    '- You can make changes for them: shopping list, to-dos, meals, habit marks and body weight happen straight away (they get an Undo button). Calendar events, removing anything, and money wait for them to tap Confirm: when a tool says waiting_for_confirm, say what you set up in a few words and ask them to tap Confirm. Never say it’s done until it is.',
    '- Do what they ask without double-checking first, unless something important is missing (like the day for an event): then ask one short question. If a tool says not_done, explain why in a sentence (and ask which one, if several match).',
    '- Anything to add, change or delete that no tool covers: call cant_do_yet, say it’s on the way, and open the screen where they can do it.',
    '- After a change, confirm it in one short sentence ("Added milk and eggs to the list!"). Don’t repeat the details shown under your reply.',
    '- When something would be easier to see on its screen, offer to open it (or just open it if they asked to see it).',
    '- Money: talk about spending and budgets; you never move money, pay anything, or see account numbers.',
    '- Food and training: encourage, don’t lecture. Health questions beyond the planner: keep it general and suggest a professional when it matters.',
    ctx.spoken ? '- This message was spoken and turned into text, so names and words may be misheard: go with the closest sensible meaning. Your reply will be read out loud, so keep it to two or three sentences, no lists, no symbols.' : '',
  ].filter(Boolean).join('\n');
}

// ── what the app sends and gets back: plain Claude messages, checked and trimmed on the server ──
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export interface Msg { role: 'user' | 'assistant'; content: string | Block[] }

const MAX_TEXT = 4000, MAX_RESULT = 14000;

/** Keep only well-formed messages: text, tool_use (known tools) and tool_result blocks, sizes capped. Starts at a user
 *  message and ends at a user message (a question or tool results); null when there's nothing to answer. */
export function cleanMessages(raw: unknown, profile?: Profile): Msg[] | null {
  if (!Array.isArray(raw)) return null;
  const names = new Set(toolsFor(profile).map(t => t.name));
  const out: Msg[] = [];
  for (const m of raw.slice(-40)) {
    const role = (m as Msg)?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const c = (m as Msg).content;
    if (typeof c === 'string') { if (c.trim()) out.push({ role, content: c.slice(0, MAX_TEXT) }); continue; }
    if (!Array.isArray(c)) continue;
    const blocks: Block[] = [];
    for (const b of c as Block[]) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) blocks.push({ type: 'text', text: b.text.slice(0, MAX_TEXT) });
      else if (b?.type === 'tool_use' && role === 'assistant' && typeof b.id === 'string' && names.has(b.name)) blocks.push({ type: 'tool_use', id: b.id.slice(0, 80), name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} });
      else if (b?.type === 'tool_result' && role === 'user' && typeof b.tool_use_id === 'string') blocks.push({ type: 'tool_result', tool_use_id: b.tool_use_id.slice(0, 80), content: String(b.content ?? '').slice(0, MAX_RESULT), ...(b.is_error ? { is_error: true } : {}) });
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
