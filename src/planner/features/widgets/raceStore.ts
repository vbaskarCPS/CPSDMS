// src/planner/features/widgets/raceStore.ts — where a race timer's times are kept, and the hook its card uses.
// Each day's result is its own doc, 'race' / `${widget id}~${day}` (race.ts says what's in it), private to the person,
// so the times are the same on every phone. For a race read from the day ("Up to first set") the card reads the last
// 30 days of the day pages and gym sessions too, and fills in any day that has no result kept yet (race.ts settle);
// today's own day comes straight from the Today screen when it's open there, so a tick shows at once.
// A race started and stopped by hand writes its doc when Start and Stop are tapped.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayKey, getDoc, getDocs, onDocsChanged, putDocs } from '../../lib/docs';
import { addDays } from '../plan/dates';
import { normalizeDay, type Day } from '../plan/types';
import type { Workout } from '../workout/types';
import { board, byHand, wordsOf, cleanResult, lapOf, msOf, raceKey, RACES, raceOn, settle, type Board, type Lap, type Moment, type RaceDay, type RaceResult } from './race';
import { clean, type Race } from './widgets';

export const RACE_KIND = 'race';
export const WINDOW = 30;
/** A race started by hand and never stopped is forgotten after this long (it doesn't count). */
const HAND_MAX = 18 * 3600_000;

/** A day with the gym planned off, or answered as a rest or a miss: no race that day. */
const restDay = (d: Day): boolean => !!d.adjust?.skip?.includes('gym') || d.gym?.answer === 'rest' || d.gym?.answer === 'missed';
export const raceDayOf = (key: string, d: Day | null | undefined, workouts: Workout[]): RaceDay => {
  const n = normalizeDay(d);
  return { key, ticks: n.ticks, workouts, rest: restDay(n) };
};

/** The last 30 days of one race: what's kept, and (for a race read from the day) what the days say, from `daysFrom`
 *  (the whole window unless asked for less). */
async function read(w: Pick<Race, 'id' | 'race'>, today: string, daysFrom?: string): Promise<{ kept: Record<string, RaceResult | null>; days: RaceDay[] }> {
  const from = addDays(today, -(WINDOW - 1));
  const fromDay = byHand(w.race);
  const [docs, dayDocs, workouts] = await Promise.all([
    getDocs<unknown>(RACE_KIND, raceKey(w.id, from), raceKey(w.id, today)),
    fromDay ? Promise.resolve([]) : getDocs<Day>('day', daysFrom || from, today),
    fromDay ? Promise.resolve([]) : getDocs<Workout>('workout', `${daysFrom || from}~`, `${today}~~`),
  ]);
  const kept: Record<string, RaceResult | null> = {};
  for (const d of docs) { const day = d.key.slice(w.id.length + 1); kept[day] = cleanResult(d.data); }
  const byDay = new Map<string, Workout[]>();
  for (const x of workouts) if (x.data) { const k = x.key.split('~')[0]; byDay.set(k, [...(byDay.get(k) || []), x.data]); }
  const days = dayDocs.map(d => raceDayOf(d.key, d.data, byDay.get(d.key) || []));
  return { kept, days };
}

export interface RaceState {
  loaded: boolean; trouble: 'load' | 'save' | null;
  /** every finished day in the window, and the board over them */
  laps: Lap[]; board: Board;
  /** today: the start and the finish, from the day or from the kept doc */
  start: Moment | null; finish: Moment | null; removed: boolean; rest: boolean;
  /** the day the race now on (or today's) is kept under: a race by hand started before 4 am is still yesterday's */
  runDay: string;
  begin: () => void; stop: () => void; cancel: () => void; remove: (day: string) => void;
}

/** One race timer's times. `live` = today's day straight from the Today screen (it may not be saved yet). */
export function useRace(w: Race, live?: { key: string; day: Day } | null): RaceState {
  const today = dayKey();
  const [kept, setKept] = useState<Record<string, RaceResult | null>>({});
  const [days, setDays] = useState<RaceDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [trouble, setTrouble] = useState<'load' | 'save' | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    try {
      const r = await read({ id: w.id, race: w.race }, dayKey());
      if (g !== gen.current) return;
      setKept(r.kept); setDays(r.days); setLoaded(true); setTrouble(t => (t === 'load' ? null : t));
    } catch { if (g === gen.current) setTrouble(t => t ?? 'load'); }
  }, [w.id, w.race]);
  useEffect(() => {
    void load();
    const onShow = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onShow);
    const off = onDocsChanged(ks => { if (ks.some(k => k === 'day' || k === 'workout' || k === RACE_KIND)) void load(); });
    return () => { document.removeEventListener('visibilitychange', onShow); off(); };
  }, [load]);

  const write = useCallback((list: { day: string; data: RaceResult | null }[]) => {
    if (!list.length) return;
    setKept(k => { const n = { ...k }; for (const x of list) n[x.day] = x.data; return n; });
    putDocs(list.map(x => ({ kind: RACE_KIND, key: raceKey(w.id, x.day), data: x.data })))
      .then(() => setTrouble(t => (t === 'save' ? null : t)), () => setTrouble('save'));
  }, [w.id]);

  // the days, with today's taken from the screen when it's there
  const all = useMemo(() => {
    if (byHand(w.race)) return [];
    const rest = days.filter(d => d.key !== today);
    const mine = live && live.key === today ? raceDayOf(today, live.day, days.find(d => d.key === today)?.workouts || []) : days.find(d => d.key === today);
    return mine ? [...rest, mine] : rest;
  }, [w.race, days, live, today]);
  const settled = useMemo(() => settle(w.race, today, kept, all), [w.race, today, kept, all]);
  // keep what the days say (only once the kept ones have been read, so nothing is written over them)
  const sig = JSON.stringify(settled.writes);
  useEffect(() => { if (loaded && settled.writes.length) write(settled.writes); }, [loaded, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const laps = useMemo(() => Object.entries(settled.results).map(([day, r]) => lapOf(day, r)).filter((l): l is Lap => !!l), [settled]);
  const b = useMemo(() => board(laps), [laps]);

  // today
  let start: Moment | null = null, finish: Moment | null = null, runDay = today;
  const removed = !!kept[today]?.removed;
  const todayDay = all.find(d => d.key === today);
  if (byHand(w.race)) {
    // the newest one started and not stopped (from before 4 am it's yesterday's), else today's
    const yest = addDays(today, -1), y = kept[yest];
    const ys = msOf(y?.start);
    if (y && !y.removed && !y.finish && ys !== null && Date.now() - ys < HAND_MAX) { runDay = yest; start = { at: ys }; }
    else {
      const t = kept[today];
      const ts = msOf(t?.start), tf = msOf(t?.finish);
      if (t && !t.removed && ts !== null && (tf !== null || Date.now() - ts < HAND_MAX)) { start = { at: ts }; finish = tf !== null ? { at: tf } : null; }
    }
  } else if (todayDay && !removed) ({ start, finish } = raceOn(w.race, todayDay));

  const begin = () => { if (!loaded || start) return; write([{ day: today, data: { v: 1, start: new Date().toISOString() } }]); };
  const stop = () => { const r = kept[runDay]; if (!loaded || !r?.start || r.finish) return; write([{ day: runDay, data: { ...r, finish: new Date().toISOString() } }]); };
  const cancel = () => { if (!loaded) return; write([{ day: runDay, data: null }]); };
  // taken off: a race read from the day remembers it (so it isn't filled in again); one by hand simply goes
  const remove = (day: string) => { if (!loaded) return; write([{ day, data: byHand(w.race) ? null : { v: 1, removed: true } }]); };

  return { loaded, trouble, laps, board: b, start, finish, removed, rest: !!todayDay?.rest && !finish, runDay, begin, stop, cancel, remove };
}

/** A race timer taken off Today: its times go too. */
export async function dropRace(id: string): Promise<void> {
  const docs = await getDocs(RACE_KIND, `${id}~`, `${id}~~`).catch(() => []);
  if (docs.length) await putDocs(docs.map(d => ({ kind: RACE_KIND, key: d.key, data: null }))).catch(() => undefined);
}

/** For Arvy: each race timer on Today, with that day's time against the best and the average over the last 30 days.
 *  A day the widget wasn't opened is worked out from the day itself, the way the widget would (nothing is written). */
export async function raceSummary(date: string): Promise<string[] | undefined> {
  const races = clean(await getDoc<unknown>('prefs', 'widgets')).added.filter((a): a is Race => a.kind === 'race');
  if (!races.length) return undefined;
  const out: string[] = [];
  for (const w of races.slice(0, 6)) {
    const r = await read(w, date, date);   // the days before are on the board already, or the widget fills them in
    const { results } = settle(w.race, date, r.kept, r.days);
    const laps = Object.entries(results).map(([day, x]) => lapOf(day, x)).filter((l): l is Lap => !!l);
    const b = board(laps), mine = laps.find(l => l.day === date);
    const t = wordsOf;
    const name = w.title === RACES[w.race].name ? w.title : `${w.title} (${RACES[w.race].name.toLowerCase()})`;
    out.push(`${name}: ${mine ? `${t(mine.ms)}${mine.approx ? ' (approximate)' : ''} on ${date}` : `not raced on ${date}`}` +
      (b.best ? `; best ${t(b.best.ms)} on ${b.best.day}, average ${t(b.average!)} over ${b.count} days` : '') + (b.streak ? `; ${b.streak} days in a row faster than average` : ''));
  }
  return out;
}
