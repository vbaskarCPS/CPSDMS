// src/planner/features/watch/steps.ts — today's steps from the watch, for the Steps card on Today (StepsCard.tsx).
// The watch saves them to 'health' / calendar date ({ steps, restingHr, updatedAt, from: 'watch' }: watch/…/Health.kt).
// No React here: tested in steps.test.ts.

/** The watch's daily goal (watch/…/Health.kt STEP_GOAL). */
export const STEP_GOAL = 10_000;

/** Today's calendar date, as the watch keys its health docs (not the planner's day, which starts at 4 am). */
export function calendarDate(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

export interface StepsView {
  steps: number;
  /** 0 to 100, how far to the goal (100 once reached). */
  pct: number;
  goal: number;
  restingHr: number | null;
  /** "11:29 am", when the watch last sent them; null when unknown. */
  at: string | null;
  /** "6,420 steps" and the line under it. */
  head: string;
  line: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** What the card shows, from today's health doc (or nothing yet). */
export function stepsView(doc: unknown, goal = STEP_GOAL): StepsView {
  const d = doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  const steps = Math.max(0, Math.round(num(d.steps) ?? 0));
  const rest = num(d.restingHr);
  const restingHr = rest && rest > 20 && rest < 220 ? Math.round(rest) : null;
  const t = typeof d.updatedAt === 'string' || typeof d.updatedAt === 'number' ? new Date(d.updatedAt) : null;
  const at = t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace(/\./g, '') : null;
  const pct = Math.min(100, Math.round((steps / goal) * 100));
  const head = `${steps.toLocaleString('en-CA')} step${steps === 1 ? '' : 's'}`;
  const left = goal - steps;
  const bits = [left > 0 ? `${left.toLocaleString('en-CA')} to ${goal.toLocaleString('en-CA')}` : 'Goal reached'];
  if (restingHr) bits.push(`resting ${restingHr} bpm`);
  if (!doc) return { steps: 0, pct: 0, goal, restingHr: null, at: null, head: 'Steps', line: 'Nothing from your watch yet today: open the planner on it' };
  return { steps, pct, goal, restingHr, at, head, line: bits.join(' · ') };
}
