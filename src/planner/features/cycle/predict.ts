// src/planner/features/cycle/predict.ts — cycle statistics and predictions. Pure: periods + prefs + today in,
// phase / next period / fertile window out. Gaps over 60 days (pregnancy, untracked) are left out of averages.
import { addDays, diffDays } from './dates';
import { DEFAULT_PREFS, type CyclePrefs, type Period } from './types';
// (Stats is used by project())

export const MAX_GAP = 60;

export interface Cycle { start: string; periodDays: number; cycleDays: number | null; next?: string }
export interface Projection { start: string; end: string; ovulation: string; fertileStart: string; fertileEnd: string }
export type Phase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
export interface Stats {
  cycleLength: number; periodLength: number; irregular: boolean; stdDev: number;
  validCycles: number; shortest: number | null; longest: number | null; usedOverride: { cycle: boolean; period: boolean };
}
export interface TodayView {
  day: number | null;            // cycle day (1 = first day of the last period)
  phase: Phase | null;
  lastStart: string | null;
  inPeriod: Period | null;
  next: Projection | null;
  late: number;                  // days past the predicted start (0 when not late)
  projections: Projection[];
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdDev = (xs: number[]): number => { if (xs.length < 2) return 0; const mean = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length); };

/** Periods sorted by start, as cycles (cycleDays = days to the next start, null when the gap is too long or it's the last). */
export function cycles(periods: Period[]): Cycle[] {
  const ps = [...periods].filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
  return ps.map((p, i) => {
    const next = ps[i + 1]?.start;
    const gap = next ? diffDays(p.start, next) : null;
    return { start: p.start, periodDays: Math.max(1, diffDays(p.start, p.end) + 1), cycleDays: gap !== null && gap <= MAX_GAP && gap > 0 ? gap : null, next };
  });
}

export function stats(periods: Period[], prefs: Partial<CyclePrefs> = {}): Stats {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const cs = cycles(periods);
  const valid = cs.filter(c => c.cycleDays !== null).map(c => c.cycleDays as number);
  const recent = valid.slice(-p.useLast);
  const last6 = valid.slice(-6);
  const cycleLength = p.cycleLength || Math.round(median(recent) ?? 28);
  const periodLength = p.periodLength || Math.round(median(cs.slice(-6).map(c => c.periodDays)) ?? 5);
  const sd = stdDev(last6);
  return {
    cycleLength, periodLength, irregular: last6.length >= 3 && sd > 7, stdDev: Math.round(sd * 10) / 10,
    validCycles: valid.length, shortest: valid.length ? Math.min(...valid) : null, longest: valid.length ? Math.max(...valid) : null,
    usedOverride: { cycle: !!p.cycleLength, period: !!p.periodLength },
  };
}

/** A predicted period starting at `start`, with the ovulation that precedes it (start − luteal days). */
function project(start: string, s: Stats, p: CyclePrefs): Projection {
  const ovulation = addDays(start, -p.lutealDays);
  return { start, end: addDays(start, s.periodLength - 1), ovulation, fertileStart: addDays(ovulation, -p.fertileBefore), fertileEnd: addDays(ovulation, p.fertileAfter) };
}

/** The next 3 cycles after the last logged period (the first one is "next period"). */
export function projections(periods: Period[], prefs: Partial<CyclePrefs> = {}, count = 3): Projection[] {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const cs = cycles(periods);
  if (!cs.length) return [];
  const s = stats(periods, prefs);
  const out: Projection[] = [];
  let start = cs[cs.length - 1].start;
  for (let i = 0; i < count; i++) { start = addDays(start, s.cycleLength); out.push(project(start, s, p)); }
  return out;
}

export function today(periods: Period[], prefs: Partial<CyclePrefs>, todayKey: string): TodayView {
  const cs = cycles(periods);
  const proj = projections(periods, prefs);
  if (!cs.length) return { day: null, phase: null, lastStart: null, inPeriod: null, next: null, late: 0, projections: [] };
  const s = stats(periods, prefs);
  const lastStart = cs[cs.length - 1].start;
  const inPeriod = periods.find(x => x.start <= todayKey && x.end >= todayKey) || null;
  const day = diffDays(lastStart, todayKey) + 1;
  const next = proj[0] || null;
  let phase: Phase;
  if (inPeriod || day <= s.periodLength) phase = 'menstrual';
  else if (next && todayKey === next.ovulation) phase = 'ovulation';
  else if (next && todayKey < next.ovulation) phase = 'follicular';
  else phase = 'luteal';
  const late = next && todayKey > next.start ? diffDays(next.start, todayKey) : 0;
  return { day: day > 0 ? day : null, phase: day > 0 ? phase : null, lastStart, inPeriod, next, late, projections: proj };
}

export const PHASE_LABEL: Record<Phase, string> = { menstrual: 'Period', follicular: 'Follicular', ovulation: 'Ovulation', luteal: 'Luteal' };
export const PHASE_BLURB: Record<Phase, string> = {
  menstrual: 'Rest where you can; iron-rich food helps.',
  follicular: 'Energy climbs — a good stretch for hard training.',
  ovulation: 'Peak fertility today.',
  luteal: 'Slower energy, more appetite; be kind to yourself.',
};

/** What a calendar day is: period, predicted period, fertile, ovulation (several may apply). */
export interface DayMarks { period?: boolean; predicted?: boolean; fertile?: boolean; ovulation?: boolean }
export function marksFor(periods: Period[], prefs: Partial<CyclePrefs>): (key: string) => DayMarks {
  const proj = projections(periods, prefs);
  return (key: string) => {
    const m: DayMarks = {};
    if (periods.some(p => p.start <= key && p.end >= key)) m.period = true;
    for (const w of proj) {
      if (!m.period && key >= w.start && key <= w.end) m.predicted = true;
      if (key >= w.fertileStart && key <= w.fertileEnd) m.fertile = true;
      if (key === w.ovulation) m.ovulation = true;
    }
    return m;
  };
}
