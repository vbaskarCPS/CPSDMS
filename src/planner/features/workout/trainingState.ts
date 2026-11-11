// src/planner/features/workout/trainingState.ts — the numbers a strength coach works out before prescribing anything,
// computed from the planner so Arvy reasons from facts instead of guessing: how recovered you are (sleep,
// food, how hard the last sessions were), how much each muscle has been trained this week and how long ago, whether
// lifts are progressing or stalling, pain mentioned in notes, and how long since an easier week. Pure, so it's tested.
import { e1rm, isAssisted, type Exercise, type Muscle, type Workout } from './types';

type Ticks = { up?: string; lightsOut?: string };
export interface DayLite { date: string; ticks?: Ticks }
export interface MealLite { date: string; time: string; totals?: { kcal?: number; protein?: number } }

const MS_DAY = 86400000;
const toDate = (k: string) => new Date(`${k}T12:00:00`);
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_DAY);
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const PAIN = /\b(pain|painful|hurt|hurts|tweak|tweaked|strain|pinch|sharp|ache|aching|sore|injur|swollen|click|knee|hip|back|shoulder|elbow|wrist)\w*/i;
/** A logged set that counts as a working ("hard") set: done, real load or reps, not an obvious warm-up. */
const hard = (s: { done: boolean; reps: number; weight: number; seconds?: number; rpe?: number }) => s.done && (s.reps > 0 || (s.seconds || 0) > 0) && (s.rpe === undefined || s.rpe >= 6);

/** Hours slept the night after day `d`: lights out on d (after midnight still counts as d), up on the next day. */
export function sleepHours(d: DayLite, next?: DayLite): number | null {
  const lo = d.ticks?.lightsOut, up = next?.ticks?.up;
  if (!lo || !up) return null;
  let a = mins(lo); if (a < 12 * 60) a += 1440;   // 00:30 is the same night, later
  const b = mins(up) + 1440;
  const h = (b - a) / 60;
  return h >= 2 && h <= 14 ? Math.round(h * 10) / 10 : null;
}

/** Muscles from an exercise's name, for custom moves saved without real muscle tags. Stretches and mobility count as none. */
const NAME_MUSCLES: [RegExp, Muscle[]][] = [
  [/stretch|mobility|foam roll|cat[- ]cow|child'?s pose|90\/90|knees[- ]to[- ]chest|thoracic|dead hang|breath/i, []],
  [/run|sprint|bike|cycle|rower|rowing|walk|treadmill|elliptical|stair|jump rope|interval|hiit|cardio/i, ['cardio']],
  [/pull[- ]?up|chin[- ]?up|pulldown|row\b|rows\b|face pull|lat /i, ['back', 'biceps']],
  [/bench|push[- ]?up|chest press|fly|dip/i, ['chest', 'triceps']],
  [/overhead|shoulder press|military|lateral raise|halo|arnold/i, ['shoulders']],
  [/curl/i, ['biceps']], [/tricep|skull|pushdown|kickback/i, ['triceps']],
  [/deadlift|rdl|good morning|hinge|swing|hip thrust|glute bridge|bridge/i, ['glutes', 'hamstrings']],
  [/squat|lunge|split|step[- ]up|leg press|leg extension/i, ['quads', 'glutes']],
  [/leg curl|hamstring|nordic/i, ['hamstrings']], [/calf/i, ['calves']],
  [/plank|crunch|chop|windmill|rotation|twist|pallof|dead bug|bird dog|carry|ab |abs|core|sit[- ]?up|hollow|raise/i, ['core']],
];
export function inferMuscles(name: string): Muscle[] {
  for (const [re, m] of NAME_MUSCLES) if (re.test(name)) return m;
  return [];
}

export function trainingState(o: {
  today: string; workouts: Workout[]; exercises: Exercise[]; days: DayLite[]; meals: MealLite[]; proteinTarget?: number; kcalTarget?: number;
  bodyWeight?: number; units: string;
}) {
  const { today } = o;
  const ws = o.workouts.filter(w => w.endedAt && !w.discarded).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byId = new Map(o.exercises.map(e => [e.id, e]));
  const musclesOf = (id: string, name: string): Muscle[] => {
    const known = byId.get(id)?.muscles || [];
    const specific = known.filter(m => m !== 'full' && m !== 'cardio');
    if (specific.length) return specific;
    const guess = inferMuscles(name);   // custom moves are often saved as "full" or "cardio": read the name instead
    return guess.length ? guess : known.filter(m => m === 'cardio');
  };

  // ── recovery inputs ──
  const days = [...o.days].sort((a, b) => a.date.localeCompare(b.date));
  const nights = days.map((d, i) => ({ night_of: d.date, hours: sleepHours(d, days[i + 1]) })).filter(n => n.hours !== null && daysBetween(n.night_of, today) <= 7);
  const last = nights.find(n => daysBetween(n.night_of, today) === 1);
  const avg = nights.length ? Math.round(nights.reduce((t, n) => t + (n.hours || 0), 0) / nights.length * 10) / 10 : null;
  const sumDay = (date: string) => o.meals.filter(m => m.date === date).reduce((t, m) => ({ kcal: t.kcal + (m.totals?.kcal || 0), protein: t.protein + (m.totals?.protein || 0), n: t.n + 1 }), { kcal: 0, protein: 0, n: 0 });
  const yest = new Date(toDate(today).getTime() - MS_DAY).toISOString().slice(0, 10);
  const todayFood = sumDay(today), yFood = sumDay(yest);
  const lastMeal = o.meals.filter(m => m.date === today).map(m => m.time).sort().pop();

  // ── load: sessions, hard sets per muscle (7 days), days since each muscle ──
  const inLast = (n: number) => ws.filter(w => daysBetween(w.date, today) < n && daysBetween(w.date, today) >= 0);
  const sets7: Partial<Record<Muscle, number>> = {};
  const lastHit: Partial<Record<Muscle, string>> = {};
  for (const w of ws) for (const e of w.exercises) {
    const n = e.sets.filter(hard).length; if (!n) continue;
    for (const m of musclesOf(e.exerciseId, e.name)) {
      if (daysBetween(w.date, today) < 7) sets7[m] = (sets7[m] || 0) + n;
      if (!lastHit[m] || w.date > lastHit[m]!) lastHit[m] = w.date;
    }
  }
  const muscles = (Object.keys({ ...sets7, ...lastHit }) as Muscle[]).filter(m => m !== 'full').map(m => ({
    muscle: m, hard_sets_last_7_days: sets7[m] || 0, days_since_trained: lastHit[m] ? daysBetween(lastHit[m]!, today) : null,
  })).sort((a, b) => (a.days_since_trained ?? 99) - (b.days_since_trained ?? 99));
  const trainedDates = [...new Set(ws.map(w => w.date))].sort();
  let streak = 0; for (let i = 0; ; i++) { const d = new Date(toDate(today).getTime() - (i + (trainedDates.includes(today) ? 0 : 1)) * MS_DAY).toISOString().slice(0, 10); if (trainedDates.includes(d)) streak++; else break; }
  const rpes = (list: Workout[]) => list.flatMap(w => w.exercises.flatMap(e => e.sets.filter(s => s.done && s.rpe).map(s => s.rpe!)));
  const avgOf = (a: number[]) => (a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length * 10) / 10 : null);

  // ── progress per lift: best e1RM per session, first vs latest in the window, plus RPE drift ──
  const lifts = new Map<string, { name: string; pts: { date: string; e1: number; rpe?: number }[]; assisted: boolean }>();
  for (const w of ws) for (const e of w.exercises) {
    if (e.mode === 'time') continue;
    const done = e.sets.filter(s => s.done && s.reps > 0 && s.weight > 0); if (!done.length) continue;
    const assisted = isAssisted(byId.get(e.exerciseId) || e);
    const best = done.reduce((b, s) => { const v = e1rm(s.weight, Math.min(s.reps, s.repsR ?? s.reps)); return assisted ? (v < b.e1 ? { e1: v, rpe: s.rpe } : b) : (v > b.e1 ? { e1: v, rpe: s.rpe } : b); }, { e1: assisted ? Infinity : 0, rpe: undefined as number | undefined });
    const k = e.exerciseId || e.name;
    const cur = lifts.get(k) || { name: e.name, pts: [], assisted };
    cur.pts.push({ date: w.date, e1: best.e1, rpe: best.rpe }); lifts.set(k, cur);
  }
  const progress = [...lifts.values()].filter(l => l.pts.length >= 2).map(l => {
    const first = l.pts[0], lastP = l.pts[l.pts.length - 1];
    const change = l.assisted ? first.e1 - lastP.e1 : lastP.e1 - first.e1;   // assisted: less counterweight = stronger
    const pct = Math.round(change / Math.max(1, first.e1) * 1000) / 10;
    const recent = l.pts.slice(-3);
    const stalled = recent.length === 3 && (l.assisted ? recent[2].e1 >= recent[0].e1 : recent[2].e1 <= recent[0].e1);
    return { lift: l.name, sessions: l.pts.length, e1rm_first: first.e1, e1rm_latest: lastP.e1, change_pct: pct, trend: pct > 1 ? 'up' : stalled ? 'stalled' : pct < -3 ? 'down' : 'flat', ...(l.assisted ? { note: 'assisted: e1rm here is the counterweight, lower = stronger' } : {}) };
  });

  // ── pain / niggles mentioned in the last 14 days ──
  const pain = ws.filter(w => daysBetween(w.date, today) < 14).flatMap(w => [
    ...(w.notes && PAIN.test(w.notes) ? [{ date: w.date, where: 'session', note: w.notes }] : []),
    ...w.exercises.filter(e => e.comment && PAIN.test(e.comment)).map(e => ({ date: w.date, where: e.name, note: e.comment! })),
  ]).slice(-8);

  // ── weeks of steady training without an easier week (a deload is any week with under half the usual sets) ──
  const weekSets = (k: number) => ws.filter(w => { const d = daysBetween(w.date, today); return d >= k * 7 && d < (k + 1) * 7; }).reduce((t, w) => t + w.exercises.reduce((s, e) => s + e.sets.filter(hard).length, 0), 0);
  const weeks = Array.from({ length: 8 }, (_, k) => weekSets(k));
  const usual = [...weeks].sort((a, b) => b - a)[2] || weeks[0];
  let since = 0; for (const s of weeks.slice(1)) { if (usual && s < usual * 0.5) break; since++; }

  return {
    readiness: {
      sleep_last_night_h: last?.hours ?? null, sleep_avg_7_nights_h: avg, nights_logged: nights.length,
      protein_today_g: todayFood.protein, protein_yesterday_g: yFood.protein, protein_target_g: o.proteinTarget ?? null,
      kcal_today: todayFood.kcal, kcal_yesterday: yFood.kcal, kcal_target: o.kcalTarget ?? null, last_meal_today: lastMeal ?? null,
      body_weight: o.bodyWeight ?? null, units: o.units,
    },
    load: {
      sessions_last_7_days: inLast(7).length, sessions_last_28_days: inLast(28).length,
      training_days_in_a_row: streak, trained_today: trainedDates.includes(today),
      avg_rpe_last_7_days: avgOf(rpes(inLast(7))), avg_rpe_prior_3_weeks: avgOf(rpes(ws.filter(w => { const d = daysBetween(w.date, today); return d >= 7 && d < 28; }))),
      hard_sets_by_week_newest_first: weeks, weeks_since_easier_week: since,
    },
    muscles, progress, pain_or_niggles_last_14_days: pain,
  };
}
