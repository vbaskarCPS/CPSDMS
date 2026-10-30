// src/planner/features/workout/progression.ts — what to lift next time (progressive overload, pure).
//
// Looks at the last 1–3 sessions of one exercise against its target ("3 × 8-12" → top of range 12):
//   • every target set hit the top of the range at RPE ≤ 8 (or no RPE logged) → add a step
//   • reps missed on 2+ sets in each of the last two sessions → take 10% off (deload)
//   • otherwise → same weight, chase the reps
import type { SetLog, Units } from './types';

export interface SessionSets { sets: SetLog[] }
export interface Suggestion { weight: number; reps: number; reason: string }

export function parseReps(target: string): { lo: number; hi: number } {
  const m = String(target || '').match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
  if (m) return { lo: Math.min(+m[1], +m[2]), hi: Math.max(+m[1], +m[2]) };
  const n = parseInt(String(target || ''), 10);
  return isFinite(n) && n > 0 ? { lo: n, hi: n } : { lo: 8, hi: 12 };
}

export function stepFor(opts: { units: Units; lower: boolean; defaultStep?: number }): number {
  if (opts.defaultStep) return opts.units === 'kg' ? Math.max(1, Math.round(opts.defaultStep / 2)) : opts.defaultStep;
  if (opts.units === 'kg') return opts.lower ? 5 : 2.5;
  return opts.lower ? 10 : 5;
}

export function roundTo(n: number, step: number): number {
  const s = step <= 0 ? 1 : step;
  return Math.round(n / s) * s;
}

export function suggest(opts: {
  history: SessionSets[];          // most recent first; done sets only matter
  targetReps: string;
  targetSets: number;
  units: Units;
  lower: boolean;
  defaultStep?: number;
}): Suggestion {
  const { lo, hi } = parseReps(opts.targetReps);
  const step = stepFor(opts);
  const sessions = opts.history.map(h => h.sets.filter(s => s.done && s.reps > 0)).filter(s => s.length > 0);
  if (!sessions.length) return { weight: 0, reps: lo, reason: 'First time — pick a weight you can do for the low end with 2 reps in reserve.' };

  const last = sessions[0];
  const top = Math.max(...last.map(s => s.weight));
  const working = last.filter(s => s.weight === top);
  const setsAtTop = working.length;
  const allHitTop = setsAtTop >= Math.max(1, Math.min(opts.targetSets, working.length)) && working.every(s => s.reps >= hi && (s.rpe === undefined || s.rpe <= 8)) && setsAtTop >= opts.targetSets;

  if (allHitTop) {
    return { weight: roundTo(top + step, step), reps: lo, reason: `Hit ${opts.targetSets} × ${hi} at ${top} — add ${step}.` };
  }

  const missed = (sets: SetLog[]) => sets.filter(s => s.reps < lo).length >= 2;
  if (sessions.length >= 2 && missed(sessions[0]) && missed(sessions[1])) {
    const w = Math.max(0, roundTo(top * 0.9, step));
    return { weight: w, reps: lo, reason: `Missed reps two sessions running — deload 10% to ${w} and build back.` };
  }

  const best = Math.max(...working.map(s => s.reps));
  return { weight: top, reps: Math.min(hi, Math.max(lo, best + 1)), reason: best >= hi ? `Repeat ${top} and make every set reach ${hi}.` : `Stay at ${top} — aim for ${Math.min(hi, best + 1)}+ reps on each set.` };
}
