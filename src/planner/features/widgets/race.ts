// src/planner/features/widgets/race.ts — the race timer's sums: how long it took, day by day, from one moment to
// another ("Up to Start workout": from ticking Up to pressing Start workout in Training), the best, the average, the
// streak, and what the live clock says while a race is on. Plain functions with no React (tested in race.test.ts).
// The results are kept per person in the doc 'race' / `${widget id}~${day}` (raceStore.ts); RaceCard.tsx draws them.
//
// A kind of race is a start and a finish, each read from what the planner already records that day. A new kind is one
// more entry in RACES. A kind with neither is started and stopped by hand on the widget ("Start and stop yourself").
// Times are always worked out from the moments stored, never counted up, so a phone that sleeps loses nothing.
import { DAY_START_HOUR, dayKey } from '../../lib/docs';
import type { Ticks } from '../plan/types';
import type { Workout } from '../workout/types';

/** One moment: when, in milliseconds. `approx` = not known to the second (an older app didn't write the moment down). */
export interface Moment { at: number; approx?: boolean }
/** What the planner recorded on one planner day (which starts at 4 am), as far as a race needs it. */
export interface RaceDay { key: string; ticks?: Ticks; workouts?: Workout[]; rest?: boolean }
export interface RaceDef {
  name: string; about: string;
  /** read from the day; left out = started and stopped by hand on the widget */
  start?: (d: RaceDay) => Moment | null;
  finish?: (d: RaceDay, from: number) => Moment | null;
  /** what the widget says before the start */
  waiting?: string;
}

const two = (n: number) => String(n).padStart(2, '0');
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** A real moment written as an ISO date, in milliseconds; null for anything else. */
export const msOf = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
/** A planner day's 'HH:MM' as a moment on the phone's clock. Before 4 am is the small hours after that day's date. */
export function momentOf(day: string, hm: string | undefined): number | null {
  const m = hm ? HM.exec(hm) : null;
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, mo, d] = day.split('-').map(Number), h = Number(m[1]);
  return new Date(y, mo - 1, d + (h < DAY_START_HOUR ? 1 : 0), h, Number(m[2])).getTime();
}

/** The moment Up was ticked: the exact one when it was written down, else the minute on the tick. */
export function upMoment(d: RaceDay): Moment | null {
  const at = msOf(d.ticks?.upAt);
  if (at !== null && dayKey(new Date(at)) === d.key) return { at };
  const hm = momentOf(d.key, d.ticks?.up);
  return hm === null ? null : { at: hm };
}

/** The first set ticked done in the gym that day, at or after `from`. A session done at home (the back-on-track
 *  challenge) or thrown away doesn't count. A session from an older app has no moment on its sets: then its start is
 *  used, marked approximate. */
export function firstSet(d: RaceDay, from: number): Moment | null {
  let best: Moment | null = null;
  const take = (m: Moment) => { if (m.at >= from && (!best || m.at < best.at)) best = m; };
  for (const w of d.workouts || []) {
    if (!w || w.discarded || w.kind === 'home' || !Array.isArray(w.exercises)) continue;
    const sets = w.exercises.flatMap(e => (Array.isArray(e?.sets) ? e.sets : [])).filter(s => s && s.done);
    if (!sets.length) continue;
    const times = sets.map(s => msOf(s.doneAt)).filter((n): n is number => n !== null);
    if (times.length) times.forEach(at => take({ at }));
    else { const at = msOf(w.startedAt); if (at !== null) take({ at, approx: true }); }
  }
  return best;
}

/** Start workout pressed in Training that day, at or after `from`: the earliest session started then. A session done at
 *  home (the back-on-track challenge) or thrown away doesn't count. */
export function workoutStart(d: RaceDay, from: number): Moment | null {
  let best: Moment | null = null;
  for (const w of d.workouts || []) {
    if (!w || w.discarded || w.kind === 'home') continue;
    const at = msOf(w.startedAt);
    if (at !== null && at >= from && (!best || at < best.at)) best = { at };
  }
  return best;
}

/** 'gym' finishes when Start workout is pressed (Vijay, 12 Nov). It was the first set until then: results kept for it
 *  before carry no `rule` and are worked out again (see settle). */
export type RaceKind = 'gym' | 'firstset' | 'manual';
export const RACES: Record<RaceKind, RaceDef> = {
  gym: { name: 'Up to Start workout', about: 'From ticking Up to pressing Start workout in Training', start: upMoment, finish: workoutStart, waiting: 'Starts when you tick I’m up' },
  firstset: { name: 'Up to first set', about: 'From ticking Up to your first set done in the gym', start: upMoment, finish: firstSet, waiting: 'Starts when you tick I’m up' },
  manual: { name: 'Start and stop yourself', about: 'For anything: tap Start, then Stop. You name it' },
};
export const RACE_KINDS = Object.keys(RACES) as RaceKind[];
export const isRaceKind = (v: unknown): v is RaceKind => typeof v === 'string' && v in RACES;
export const byHand = (k: RaceKind): boolean => !RACES[k].start;
/** Which version of a kind's start and finish a kept result was worked out with. A kept day from an older version is
 *  worked out again when the day still gives a time (a day taken off stays off). */
export const RULE: Record<RaceKind, number> = { gym: 2, firstset: 1, manual: 1 };
const ruleOf = (r: RaceResult | null): number => r?.rule ?? 1;

/** One day's race, read from the day. `finish` is null while it's still on, or on a day it was never finished. */
export function raceOn(kind: RaceKind, d: RaceDay): { start: Moment | null; finish: Moment | null } {
  const def = RACES[kind];
  const start = def.start?.(d) ?? null;
  const finish = start && def.finish ? def.finish(d, start.at) : null;
  return { start, finish };
}

// ── the stored result ──
/** What's kept for one day. `removed` = taken off by the person (a forgotten tick): it isn't worked out again. */
export interface RaceResult { v: 1; start?: string; finish?: string; approx?: true; removed?: true; rule?: number }
/** Whatever was saved, made safe; null when there's nothing usable. A finish before its start is no finish. */
export function cleanResult(raw: unknown): RaceResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.removed === true) return { v: 1, removed: true };
  const s = msOf(r.start), f = msOf(r.finish);
  if (s === null) return null;
  const rule = typeof r.rule === 'number' && Number.isInteger(r.rule) && r.rule > 1 && r.rule < 100 ? { rule: r.rule } : {};
  return { v: 1, start: r.start as string, ...(f !== null && f >= s ? { finish: r.finish as string } : {}), ...(r.approx === true ? { approx: true } : {}), ...rule };
}
/** A day's race as it's kept. */
export const resultOf = (start: Moment, finish: Moment | null, rule = 1): RaceResult => ({
  v: 1, start: new Date(start.at).toISOString(), ...(finish ? { finish: new Date(finish.at).toISOString() } : {}), ...(start.approx || finish?.approx ? { approx: true } : {}),
  ...(rule > 1 ? { rule } : {}),
});
export const sameResult = (a: RaceResult | null, b: RaceResult | null): boolean => JSON.stringify(a) === JSON.stringify(b);
export const raceKey = (id: string, day: string): string => `${id}~${day}`;

/** One finished day: how long it took. */
export interface Lap { day: string; ms: number; approx?: boolean }
export function lapOf(day: string, r: RaceResult | null): Lap | null {
  if (!r || r.removed || !r.start || !r.finish) return null;
  const ms = Date.parse(r.finish) - Date.parse(r.start);
  return ms >= 0 ? { day, ms, ...(r.approx ? { approx: true } : {}) } : null;
}

// ── best, average, streak ──
export interface Board { best: Lap | null; average: number | null; streak: number; count: number }
/** Over the finished days given (any order). The streak: finished days in a row, newest first, each faster than the
 *  average of the days before it (at least three of them, so one good first day isn't a target). Beating your own
 *  average is something a good morning can do every day; beating your best can't be, so a streak of it would never
 *  grow. A day not raced (no gym) is skipped: it neither counts nor breaks the streak. */
export function board(laps: Lap[]): Board {
  const list = [...laps].sort((a, b) => a.day.localeCompare(b.day));
  if (!list.length) return { best: null, average: null, streak: 0, count: 0 };
  const best = list.reduce((b, l) => (l.ms < b.ms ? l : b));
  const average = Math.round(list.reduce((s, l) => s + l.ms, 0) / list.length);
  let streak = 0;
  for (let i = list.length - 1; i >= 3; i--) {
    const before = list.slice(0, i), avg = before.reduce((s, l) => s + l.ms, 0) / before.length;
    if (list[i].ms < avg) streak++; else break;
  }
  return { best, average, streak, count: list.length };
}
/** Is this day's time a new best, beating every day before it? The very first race isn't a "new" best. */
export function isNewBest(laps: Lap[], day: string): boolean {
  const mine = laps.find(l => l.day === day), before = laps.filter(l => l.day < day);
  return !!mine && before.length > 0 && before.every(l => mine.ms < l.ms);
}

// ── the clock ──
/** "4:05", "23:40", "1:02:09". */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
/** The same in words, to be read out or told: "23 min 40 s", "1 h 2 min". */
export function wordsOf(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : m ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}
/** Longer than this and it's not a race any more (Up ticked, then no gym that day): the clock stops showing. */
export const LIVE_MAX = 4 * 3600_000;
/** While a race is on: the time so far, and against the best, how far ahead or behind (`fill` = the share of the best
 *  used up, 0 to 1). */
export function liveView(start: number, now: number, best: number | null): { ms: number; text: string; ahead: number | null; word: string; fill: number } {
  const ms = Math.max(0, now - start);
  if (best === null) return { ms, text: clockOf(ms), ahead: null, word: '', fill: 0 };
  const ahead = best - ms;
  return { ms, text: clockOf(ms), ahead, word: ahead >= 0 ? `${clockOf(ahead)} ahead` : `${clockOf(-ahead)} behind`, fill: best > 0 ? Math.min(1, ms / best) : 1 };
}

// ── keeping the results ──
/** For a race read from the days (not by hand): what each day's result is, and which docs need writing so the kept
 *  results match. A day taken off stays off. A day gone by is only filled in when nothing is kept for it yet (so the
 *  first time the widget is added, the last weeks are on the board at once); today follows what the day says, and
 *  goes again when the tick it came from is undone. Days with no finish (no gym) are simply not raced. */
export function settle(kind: RaceKind, today: string, kept: Record<string, RaceResult | null>, days: RaceDay[]): { results: Record<string, RaceResult>; writes: { day: string; data: RaceResult | null }[] } {
  const results: Record<string, RaceResult> = {}, writes: { day: string; data: RaceResult | null }[] = [];
  for (const [day, r] of Object.entries(kept)) if (r) results[day] = r;
  if (byHand(kind)) return { results, writes };
  for (const d of days) {
    if (d.key > today) continue;
    const had = kept[d.key] ?? null;
    if (had?.removed) continue;
    const { start, finish } = raceOn(kind, d);
    const now = start && finish ? resultOf(start, finish, RULE[kind]) : null;
    const stale = !!had && ruleOf(had) !== RULE[kind];
    if (d.key === today) {
      if (now && !sameResult(had, now)) { writes.push({ day: d.key, data: now }); results[d.key] = now; }
      else if (!now && had) { writes.push({ day: d.key, data: null }); delete results[d.key]; }
    } else if (now && (!had || (stale && !sameResult(had, now)))) { writes.push({ day: d.key, data: now }); results[d.key] = now; }
    else if (!now && stale) { writes.push({ day: d.key, data: null }); delete results[d.key]; }
  }
  return { results, writes };
}
