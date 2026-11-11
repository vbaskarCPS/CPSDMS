// src/planner/features/arvy/run.ts — Arvy's tools, run in the app with the same functions the screens use.
// Each returns a compact summary (what Claude reads); open_screen also asks the panel to navigate.
// The tool list itself (names, descriptions) is in supabase/functions/planner-arvy/tools.ts, shared with the server.
import { dayKey, getDoc, getDocs } from '../../lib/docs';
import { addMemory } from '../../lib/memory';
import { getPass } from '../../lib/auth';
import { lifeContext } from '../../lib/lifeContext';
import { logArvy } from './log';
import { adjustWords, blocks, cleanAdjust, clock, loadRoutine } from '../../lib/routine';
import { loadEvents } from '../calendar/store';
import { eventsOn, WHO_LABEL, type CalEvent } from '../calendar/types';
import { loadList } from '../shop/store';
import { bestDeal, storeOf } from '../shop/types';
import { DEFAULT_TARGETS, mealsBetween, type Meal, type Targets } from '../food/model';
import { currentStreak, lastDays } from '../habits/streak';
import type { Habit, HabitLog } from '../habits/types';
import { loadAccounts, loadBudget, loadMonths, monthKey, sumByCategory, totals, visibleMonths } from '../money/lib';
import { SPENDING_CATEGORIES } from '../money/categories';
import type { Period, CyclePrefs, DayLog } from '../cycle/types';
import { DEFAULT_PREFS as CYCLE_DEFAULTS } from '../cycle/types';
import { today as cycleToday } from '../cycle/predict';
import type { Template, Workout } from '../workout/types';
import { SCREENS } from '../../../../supabase/functions/planner-arvy/tools';

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface ToolOut { result: unknown; navigate?: string; error?: boolean }

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (key: string, n: number) => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const r0 = (n: unknown) => Math.round(Number(n) || 0);
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const clampN = (v: unknown, def: number, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def; };
const weekdayOf = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long' });
const evLine = (e: CalEvent) => `${e.time ? e.time + (e.endTime ? `–${e.endTime}` : '') : 'all day'} ${e.title} (${WHO_LABEL[e.who] || e.who})${e.notes ? ` — ${e.notes.slice(0, 80)}` : ''}`;

async function targets(): Promise<Targets> {
  return (await getDoc<Targets>('foodprefs', 'targets').catch(() => null)) || DEFAULT_TARGETS;
}
function dayTotals(meals: Meal[]) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const m of meals) { t.kcal += m.totals?.kcal || 0; t.protein += m.totals?.protein || 0; t.carbs += m.totals?.carbs || 0; t.fat += m.totals?.fat || 0; }
  return { kcal: r0(t.kcal), protein: r0(t.protein), carbs: r0(t.carbs), fat: r0(t.fat) };
}
const fmtSet = (s: AnyDoc) => (s.seconds && !s.reps ? `${s.seconds}s` : `${s.weight}x${s.reps}${s.repsR !== undefined ? `/${s.repsR}` : ''}`);

// ── the tools ──
async function todayOverview(input: AnyDoc) {
  const date = isDate(input.date) ? input.date : dayKey();
  const [day, habits, log, meals, tg, events, workouts, templates, routine] = await Promise.all([
    getDoc<AnyDoc>('day', date).catch(() => null),
    getDocs<Habit>('habit').catch(() => []),
    getDoc<HabitLog>('habitlog', date).catch(() => null),
    mealsBetween(date, date).catch(() => []),
    targets(),
    loadEvents(date, date).catch(() => [] as CalEvent[]),
    getDocs<Workout>('workout', `${date}~`, `${date}~￿`).catch(() => []),
    getDocs<Template>('template').catch(() => []),
    loadRoutine().catch(() => null),
  ]);
  const wd = new Date(`${date}T12:00:00`).getDay();
  const d = day || {};
  const adjust = cleanAdjust(d.adjust);   // that day's changes to the routine (adjust_day)
  const due = habits.map(h => h.data).filter(h => h && !h.archived && (h.days?.length ? h.days : [0, 1, 2, 3, 4, 5, 6]).includes(wd));
  const ms = meals.map(m => m.data).filter(Boolean);
  const ws = workouts.map(w => w.data).filter(w => w && !w.discarded);
  const planned = templates.map(t => t.data).filter(t => t && !t.archived && (t.plannedFor === date || (!t.plannedFor && t.days?.includes(wd))));
  return {
    date, weekday: weekdayOf(date),
    routine_today: routine ? {
      blocks: blocks(routine, adjust).map(b => `${clock(b.at)}${b.until ? `–${clock(b.until)}` : ''} ${b.label}${b.added ? ` (added for the day${b.added.session ? ', the day’s training session' : ''}${b.added.done ? ', done' : ''})` : ''}`),
      changed_for_the_day: adjust ? { why: adjust.why, changes: adjustWords(adjust) } : 'no: it runs as the standing routine',
    } : undefined,
    priorities: (d.priorities || []).filter((p: AnyDoc) => p?.text).map((p: AnyDoc) => `${p.done ? '✓' : '○'} ${p.text}`),
    todos: (d.todos || []).filter((t: AnyDoc) => t?.text).map((t: AnyDoc) => `${t.done ? '✓' : '○'} ${t.time ? t.time + ' ' : ''}${t.text}${t.must ? ' (must)' : ''}`),
    schedule: (d.schedule || []).filter((s: AnyDoc) => s?.text).map((s: AnyDoc) => `${s.time} ${s.text}`),
    routine_ticks: d.ticks && Object.keys(d.ticks).length ? d.ticks : undefined,
    brief: d.brief && Object.values(d.brief).some(Boolean) ? { word: d.brief.word, a_game: d.brief.aGame, stress: d.brief.stress, excited: d.brief.excited } : undefined,
    scores: d.scores || undefined,
    habits_due: due.map(h => `${h.name}: ${log?.[h.id] || 'not marked'}`),
    food: { meals: ms.map(m => `${m.time} ${m.name} ${r0(m.totals?.kcal)} kcal, ${r0(m.totals?.protein)} g protein`), total: dayTotals(ms), targets: tg },
    calendar: eventsOn(events, date).map(evLine),
    workout: ws.length ? ws.map(w => ({ name: w.name, status: w.endedAt ? 'done' : 'in progress', exercises: w.exercises.length, prs: w.prs?.length ? w.prs : undefined }))
      : planned.length ? { planned: planned.map(t => `${t.name}${t.home ? ' (at home)' : ''}`) } : 'none planned',
  };
}

async function calendar(input: AnyDoc) {
  const from = isDate(input.from) ? input.from : dayKey();
  let to = isDate(input.to) ? input.to : from;
  if (to < from) to = from;
  if (shift(from, 92) < to) to = shift(from, 92);
  const events = await loadEvents(from, to);
  const out: Record<string, string[]> = {};
  for (let k = from; k <= to; k = shift(k, 1)) { const on = eventsOn(events, k); if (on.length) out[`${k} ${weekdayOf(k)}`] = on.map(evLine); }
  return { from, to, days: out, none: !Object.keys(out).length || undefined };
}

async function shoppingList(input: AnyDoc) {
  const list = await loadList();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const open = list.filter(i => !i.done);
  return {
    to_get: open.map(i => {
      const d = bestDeal(i);
      return `${i.count && i.count > 1 ? `${i.count}× ` : ''}${i.text}${i.qty ? ` (${i.qty})` : ''}${i.section ? ` [${i.section}]` : ''}${storeOf(i) !== 'Anywhere' ? ` at ${storeOf(i)}` : ''}${d && typeof d.price === 'number' ? ` $${d.price.toFixed(2)}` : ''} — added by ${i.by}`;
    }),
    count: open.length,
    done_recently: input.include_done ? list.filter(i => i.done && (i.doneAt || '') >= weekAgo).map(i => i.text) : undefined,
  };
}

async function foodLog(input: AnyDoc) {
  const from = isDate(input.from) ? input.from : dayKey();
  let to = isDate(input.to) ? input.to : from;
  if (to < from) to = from;
  if (shift(from, 31) < to) to = shift(from, 31);
  const [meals, tg] = await Promise.all([mealsBetween(from, to), targets()]);
  const byDay: Record<string, { meals: string[]; total: ReturnType<typeof dayTotals> }> = {};
  const groups = new Map<string, Meal[]>();
  for (const m of meals.map(x => x.data).filter(Boolean)) { const g = groups.get(m.date) || []; g.push(m); groups.set(m.date, g); }
  for (const [k, ms] of [...groups.entries()].sort()) byDay[k] = { meals: ms.map(m => `${m.time} ${m.name} — ${r0(m.totals?.kcal)} kcal, P${r0(m.totals?.protein)} C${r0(m.totals?.carbs)} F${r0(m.totals?.fat)}`), total: dayTotals(ms) };
  return { from, to, targets: tg, days: byDay, nothing_logged: !groups.size || undefined };
}

async function workouts(input: AnyDoc) {
  const days = clampN(input.days, 14, 90);
  const today = dayKey();
  const [ws, tpls, weights] = await Promise.all([
    getDocs<Workout>('workout', shift(today, -days), `${today}~￿`).catch(() => []),
    getDocs<Template>('template').catch(() => []),
    getDocs<{ weight: number }>('bodyweight', shift(today, -90)).catch(() => []),
  ]);
  const list = ws.map(w => w.data).filter(w => w && !w.discarded).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    in_progress: list.filter(w => !w.endedAt).map(w => w.name),
    recent: list.filter(w => w.endedAt).slice(0, 12).map(w => ({
      date: w.date, name: w.name, minutes: w.endedAt ? r0((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60000) : undefined,
      prs: w.prs?.length ? w.prs : undefined,
      exercises: w.exercises.map(e => `${e.name}: ${e.sets.filter(s => s.done).map(fmtSet).join(', ') || 'no sets done'}`),
    })),
    templates: tpls.map(t => t.data).filter(t => t && !t.archived).map(t => `${t.name}${t.plannedFor ? ` (planned for ${t.plannedFor})` : t.days?.length ? ` (${t.days.map(d => dayName[d]).join('/')})` : ''}: ${t.exercises.length} exercises`),
    body_weight: weights.map(w => ({ date: w.key, weight: w.data?.weight })).filter(w => (w.weight || 0) > 0).slice(-8),
  };
}

async function habits(input: AnyDoc) {
  const days = clampN(input.days, 14, 60);
  const today = dayKey();
  const [hs, logs, routine] = await Promise.all([
    getDocs<Habit>('habit').catch(() => []),
    getDocs<HabitLog>('habitlog', shift(today, -84), today).catch(() => []),
    loadRoutine().catch(() => null),
  ]);
  const logMap: Record<string, HabitLog> = Object.fromEntries(logs.map(l => [l.key, l.data || {}]));
  const blockLabel = new Map((routine ? blocks(routine) : []).map(b => [b.id as string, b.label]));
  const keys = lastDays(today, days);
  const letter: Record<string, string> = { done: '✓', mini: 'm', skip: 's' };
  return {
    legend: '✓ done, m mini, s skipped, · not marked; oldest → today',
    habits: hs.map(h => h.data).filter(h => h && !h.archived).sort((a, b) => a.order - b.order).map(h => ({
      name: h.name,
      days: h.days?.length === 7 || !h.days?.length ? 'every day' : h.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join('/'),
      stacked: h.anchor ? `${h.anchor.when} ${blockLabel.get(h.anchor.block) || h.anchor.block}` : h.stack || undefined,
      streak: currentStreak(h, logMap, today),
      marks: keys.map(k => letter[logMap[k]?.[h.id] || ''] || '·').join(''),
    })),
  };
}

async function money(input: AnyDoc) {
  const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month) ? input.month : monthKey();
  const [months, accounts, budget] = await Promise.all([loadMonths(month, month), loadAccounts(), loadBudget()]);
  let rows = visibleMonths(months, accounts)[month] || [];
  const cat = typeof input.category === 'string' && input.category.trim() ? input.category.trim().toLowerCase() : null;
  const q = typeof input.search === 'string' && input.search.trim() ? input.search.trim().toLowerCase() : null;
  const t = totals(rows);
  const byCat = sumByCategory(rows);
  if (cat) rows = rows.filter(x => x.category.toLowerCase() === cat);
  if (q) rows = rows.filter(x => `${x.merchant} ${x.desc}`.toLowerCase().includes(q));
  const merchants = new Map<string, number>();
  for (const x of rows) if (x.amount < 0 && SPENDING_CATEGORIES.includes(x.category)) merchants.set(x.merchant || x.desc, (merchants.get(x.merchant || x.desc) || 0) - x.amount);
  const acct = new Map(accounts.map(a => [a.id, a.name]));
  return {
    month,
    totals: { spent: t.spent, income: t.income, net: t.net, budget_total: r2(SPENDING_CATEGORIES.reduce((s, c) => s + (Number(budget[c]) || 0), 0)) || null },
    spending_vs_budget: Object.fromEntries(SPENDING_CATEGORIES.filter(c => byCat[c] || budget[c]).map(c => [c, { spent: r2(byCat[c]), budget: budget[c] ? r2(budget[c]) : null }])),
    top_merchants: [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, v]) => `${m}: $${r2(v)}`),
    transactions: [...rows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, cat || q ? 40 : 15)
      .map(x => `${x.date} ${x.merchant || x.desc} ${x.amount < 0 ? '-' : '+'}$${r2(Math.abs(x.amount))} [${x.category}]${acct.get(x.accountId) ? ` (${acct.get(x.accountId)})` : ''}`),
    filtered: cat || q ? { category: input.category || undefined, search: input.search || undefined, count: rows.length } : undefined,
    accounts: accounts.map(a => `${a.name} (${a.type})`),
  };
}

async function cycle() {
  const today = dayKey();
  const [periods, prefs, logs] = await Promise.all([
    getDocs<Period>('period').catch(() => []),
    getDoc<CyclePrefs>('cycleprefs', 'settings').catch(() => null),
    getDocs<DayLog>('cyclelog', shift(today, -21), today).catch(() => []),
  ]);
  const ps = periods.map(p => p.data).filter(p => p && p.start).sort((a, b) => (a.start < b.start ? -1 : 1));
  const view = cycleToday(ps, { ...CYCLE_DEFAULTS, ...(prefs || {}) }, today);
  return {
    today, cycle_day: view.day, phase: view.phase, days_late: view.late || undefined,
    in_period: view.inPeriod || undefined,
    next_period: view.next ? { start: view.next.start, end: view.next.end } : undefined,
    fertile_window: view.next ? { from: view.next.fertileStart, to: view.next.fertileEnd, ovulation: view.next.ovulation } : undefined,
    recent_periods: ps.slice(-4).map(p => `${p.start} → ${p.end}`),
    recent_logs: logs.map(l => ({ date: l.key, ...l.data })).slice(-10),
  };
}

/** Run one tool. Never throws: an error comes back as the result, for Arvy to explain. */
export async function runTool(name: string, input: Record<string, unknown>, about?: { question?: string; path?: string }): Promise<ToolOut> {
  try {
    switch (name) {
      case 'today_overview': return { result: await todayOverview(input) };
      case 'calendar': return { result: await calendar(input) };
      case 'shopping_list': return { result: await shoppingList(input) };
      case 'food_log': return { result: await foodLog(input) };
      case 'workouts': return { result: await workouts(input) };
      case 'habits': return { result: await habits(input) };
      case 'money': return { result: await money(input) };
      case 'cycle': return { result: await cycle() };
      case 'remember': {
        const note = String(input.note || '').trim().slice(0, 300);
        if (!note) return { result: { error: 'empty note' }, error: true };
        await addMemory(note, 'app');
        return { result: { saved: note } };
      }
      case 'open_screen': {
        const path = String(input.path || '');
        if (!(path in SCREENS)) return { result: { error: `no screen ${path}` }, error: true };
        return { result: { opened: SCREENS[path] }, navigate: path };
      }
      case 'cant_do_yet': {
        await logArvy({ type: 'request', title: String(input.request || 'Something Arvy can’t do yet'), area: String(input.area || 'other'), question: about?.question, path: about?.path });
        return { result: { noted: true } };
      }
      case 'log_feedback': {
        const type = input.type === 'idea' ? 'idea' : 'bug';
        const title = String(input.title || '').trim();
        if (!title) return { result: { error: 'What should I note?' }, error: true };
        await logArvy({ type, title, detail: typeof input.detail === 'string' ? input.detail : undefined, area: String(input.area || 'other'), question: about?.question, path: about?.path });
        return { result: { logged: true, where: 'Settings › Arvy’s log' } };
      }
      case 'coaching_context': {
        // everything the coach reads, the worked-out training numbers and their own notes first (long contexts are cut from the end)
        const units = (getPass()?.user.settings?.units as string) === 'kg' ? 'kg' : 'lb';
        const { training_state, about_me_notes_oldest_first, workout_templates, workout_in_progress, workouts_recent_full_then_condensed, ...rest } = await lifeContext(units);
        return { result: { training_state, about_me_notes_oldest_first, workout_templates, workout_in_progress, workouts_recent_full_then_condensed, ...rest } };
      }
      default: return { result: { error: `unknown tool ${name}` }, error: true };
    }
  } catch (e) {
    return { result: { error: e instanceof Error ? e.message : String(e) }, error: true };
  }
}
