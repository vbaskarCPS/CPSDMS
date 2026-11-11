// src/planner/features/workout/format.ts — session formats: which exercises run together as a block (superset,
// circuit, EMOM, AMRAP), the shape of an exercise's sets (pyramid, countdown, drop set, intervals), and which tracker
// an exercise gets (weight × reps, reps only, left / right, a timer, a timer per side). No React, no network.
// Sessions made before formats existed carry none of the flags, so sides / no-weight are also worked out from the
// exercise's name and its written target ("8 per side", "5 each direction").
import { fmtSec, isUnilateral, type Exercise, type Format, type GroupKind, type SetLog, type SetMode } from './types';
import type { PlanExercise } from '../../lib/ai';

/** The bits of a template or session exercise these helpers read. */
export type Fx = Format & { name: string; exerciseId?: string; mode?: SetMode; targetReps?: string; note?: string; restSec?: number; targetSets?: number; targetSec?: number; sets?: SetLog[] };

const SIDES = /\b(per|each)[ -]?(side|leg|arm|hand|direction|way)\b|\/\s?side\b|\b(l\s*\/\s*r|left (and|&|\/) right|both sides)\b/i;
// a cue has to say it plainly ("30 sec per side"): "lower each arm slowly" is about a two-armed lift
const NOTE_SIDES = /\bper (side|leg|arm|hand)\b|\beach (side|direction|way)\b|\/\s?side\b/i;
// moves that are one side at a time by nature, whatever the plan wrote
const SIDED = /side plank|windmill|\bchops?\b|wood ?chop|\bhalo|suitcase|get[- ]?up|half[- ]kneeling|pallof|copenhagen|clamshell|fire hydrant|pigeon|couch stretch|hip flexor stretch|thread the needle|side[- ]lying|cossack|curtsy/i;
/** One side or direction at a time? The flag, else the written target or cue, else the exercise itself. */
export function hasSides(ex: Fx, lib?: Exercise | null): boolean {
  if (typeof ex.sides === 'boolean') return ex.sides;
  return SIDES.test(ex.targetReps || '') || SIDES.test(ex.name) || NOTE_SIDES.test((ex.note || '').slice(0, 80)) || SIDED.test(ex.name) || isUnilateral(lib) || isUnilateral(ex);
}

const DRILL = /cat[- ]?cow|90\s*\/\s*90|dead[- ]?bug|bird[- ]?dog|glute bridge|hip bridge|stretch|mobility|child'?s pose|pose\b|foam roll|thread the needle|world'?s greatest|circles?\b|leg swings?|hip (rotation|opener|cars?)|scap(ular)? (push|pull)|wall slide|inchworm|deep squat (hold|sit)|breathing/i;
const LOADED = /kettlebell|\bkb\b|dumbbell|\bdb\b|barbell|cable|band|weighted|plate|machine|goblet|ez[- ]bar|sandbag|medicine ball|slam ball/i;
/** Nothing to load? The flag; else a set that has a weight says no; else bodyweight exercises and mobility drills. */
export function isNoLoad(ex: Fx, lib?: Exercise | null): boolean {
  if (typeof ex.noLoad === 'boolean') return ex.noLoad;
  if (ex.mode === 'time') return true;
  if (ex.sets?.some(s => s.weight > 0 || (s.prev?.weight ?? 0) > 0) || ex.weightBySet?.some(w => w > 0)) return false;
  if (LOADED.test(ex.name)) return false;
  return lib?.equipment === 'bodyweight' || DRILL.test(ex.name);
}

/** Timed rounds that run themselves (work, rest, work…): asked for, or short cardio bursts with a rest between. */
export function isIntervals(ex: Fx, lib?: Exercise | null): boolean {
  if (ex.mode !== 'time') return false;
  if (ex.style === 'intervals') return true;
  const rounds = ex.sets?.length ?? ex.targetSets ?? 1;
  const sec = ex.sets?.[0]?.seconds ?? ex.targetSec ?? 0;
  return !ex.style && !ex.group && rounds >= 3 && (ex.restSec || 0) > 0 && sec > 0 && sec <= 120 && (lib?.type === 'cardio' || lib?.equipment === 'cardio');
}

export type Block =
  | { kind: 'single'; at: number[] }
  | { kind: GroupKind; at: number[]; letter: string };
/** The session as blocks: neighbours with the same group letter run together; everything else stands alone.
 *  A "block" of one is just that exercise. */
export function blocksOf(exercises: Pick<Fx, 'group' | 'groupKind'>[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < exercises.length; i++) {
    const g = exercises[i].group?.trim();
    if (!g) { out.push({ kind: 'single', at: [i] }); continue; }
    const at = [i];
    while (i + 1 < exercises.length && exercises[i + 1].group?.trim() === g) at.push(++i);
    if (at.length < 2 && !['emom', 'amrap'].includes(exercises[at[0]].groupKind || '')) { out.push({ kind: 'single', at }); continue; }
    const kind = exercises[at[0]].groupKind || (at.length === 2 ? 'superset' : 'circuit');
    out.push({ kind, at, letter: g.toUpperCase().slice(0, 2) });
  }
  return out;
}
export const BLOCK_NAME: Record<GroupKind, string> = { superset: 'Superset', circuit: 'Circuit', emom: 'EMOM', amrap: 'AMRAP' };
/** "Superset A", "EMOM · 10 min". */
export function blockTitle(b: Block, exercises: Pick<Fx, 'groupSec'>[]): string {
  if (b.kind === 'single') return '';
  const sec = exercises[b.at[0]]?.groupSec;
  return b.kind === 'emom' || b.kind === 'amrap' ? `${BLOCK_NAME[b.kind]}${sec ? ` · ${Math.round(sec / 60)} min` : ''}` : `${BLOCK_NAME[b.kind]} ${b.letter}`;
}
/** How a block is done, in a line. */
export function blockHow(b: Block, exercises: Fx[]): string {
  if (b.kind === 'single') return '';
  const rest = Math.max(0, ...b.at.map(i => exercises[i].restSec || 0));
  const rounds = Math.max(1, ...b.at.map(i => exercises[i].sets?.length ?? exercises[i].targetSets ?? 1));
  if (b.kind === 'emom') return b.at.length > 1 ? 'A new minute, the next move: do the reps, rest what’s left of the minute.' : 'Do the reps at the top of every minute; rest what’s left of it.';
  if (b.kind === 'amrap') return 'As many rounds as you can before the clock runs out. Tap +1 after each round.';
  return `${rounds} round${rounds === 1 ? '' : 's'}: one set of each, back to back${rest ? `, then rest ${rest}s` : ', no rest'}.`;
}

const STYLE_NAME = { pyramid: 'Pyramid', countdown: 'Countdown', ladder: 'Ladder', drop: 'Drop set', intervals: 'Intervals' } as const;
/** The exercise's own format in a few words, or '' for straight sets: "Pyramid 12-10-8-6", "Intervals 8 × 0:20 / rest 0:40". */
export function styleLabel(ex: Fx, lib?: Exercise | null): string {
  if (isIntervals(ex, lib)) {
    const rounds = ex.sets?.length ?? ex.targetSets ?? 1, sec = ex.sets?.[0]?.seconds ?? ex.targetSec ?? 0;
    return `Intervals ${rounds} × ${fmtSec(sec)}${ex.restSec ? ` / rest ${fmtSec(ex.restSec)}` : ''}`;
  }
  if (!ex.style || ex.style === 'intervals') return '';
  const r = ex.repsBySet || [];
  const oneWay = r.every((x, i) => i === 0 || x < r[i - 1]) || r.every((x, i) => i === 0 || x > r[i - 1]);
  return `${STYLE_NAME[ex.style]}${!r.length ? '' : r.length > 5 && oneWay ? ` ${r[0]}→${r[r.length - 1]}` : ` ${r.join('-')}`}`;
}
/** A template exercise's target as one line for lists: "3 × 8-12", "Pyramid 12-10-8-6", "2 × 0:30 per side". */
export function targetLine(ex: Fx, lib?: Exercise | null): string {
  const side = hasSides(ex, lib) && !SIDES.test(ex.targetReps || '') ? ' per side' : '';
  const style = styleLabel(ex, lib);
  if (style) return `${style}${side && !isIntervals(ex, lib) ? side : ''}`;
  const n = ex.sets?.length ?? ex.targetSets ?? 1;
  if (ex.mode === 'time') return `${n} × ${fmtSec(ex.sets?.[0]?.seconds ?? ex.targetSec ?? 60)}${side}`;
  return `${n} × ${ex.targetReps || '8-12'}${side}`;
}

/** The reps to aim for on set i: the per-set plan (pyramid, countdown), else nothing special. */
export const repsTarget = (ex: Pick<Fx, 'repsBySet'>, i: number): number | undefined => ex.repsBySet?.[i];

/** Tidy a format coming from a plan: numbers in range, lengths that agree, no group of one, no stray fields. */
export function cleanFormat(f: Format, mode: SetMode): Format {
  const out: Format = {};
  if (f.sides) out.sides = true;
  if (f.noLoad && mode === 'reps') out.noLoad = true;
  const reps = (f.repsBySet || []).map(n => Math.round(Number(n))).filter(n => n > 0 && n <= 200).slice(0, 15);
  if (mode === 'reps' && reps.length >= 2) {
    out.repsBySet = reps;
    const w = (f.weightBySet || []).map(Number).filter(n => n >= 0 && n < 2000).slice(0, reps.length);
    if (w.length === reps.length && w.some(n => n > 0)) out.weightBySet = w;
    // unnamed: reps that run down to almost nothing (10-9-…-1, 10-8-6-4-2) are a countdown; 12-10-8-6 is a pyramid
    const down = reps.every((r, i) => i === 0 || r < reps[i - 1]);
    out.style = f.style && f.style !== 'intervals' ? f.style : down && !out.weightBySet && (reps[reps.length - 1] <= 3 || reps.length >= 6) ? 'countdown' : 'pyramid';
  } else if (mode === 'time' && f.style === 'intervals') out.style = 'intervals';
  else if (mode === 'reps' && f.style === 'drop') {
    const w = (f.weightBySet || []).map(Number).filter(n => n > 0 && n < 2000).slice(0, 8);
    if (w.length >= 2) { out.style = 'drop'; out.weightBySet = w; }
  }
  const g = (f.group || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
  if (g) {
    out.group = g;
    if (f.groupKind) out.groupKind = f.groupKind;
    if ((f.groupKind === 'emom' || f.groupKind === 'amrap') && Number(f.groupSec) >= 60) out.groupSec = Math.min(3600, Math.round(Number(f.groupSec) / 60) * 60);
  }
  return out;
}
/** After every exercise is cleaned: a letter used once is dropped (unless it's a one-move EMOM), a block shares one
 *  kind and one clock, and an EMOM/AMRAP without a time gets a sensible one. */
export function settleGroups<T extends Format>(list: T[]): T[] {
  const out = list.map(e => ({ ...e }));
  for (const b of blocksOf(out)) {
    if (b.kind === 'single') { for (const i of b.at) { delete out[i].group; delete out[i].groupKind; delete out[i].groupSec; } continue; }
    const sec = b.kind === 'emom' || b.kind === 'amrap' ? (b.at.map(i => out[i].groupSec).find(Boolean) || (b.kind === 'emom' ? 600 : 480)) : undefined;
    for (const i of b.at) { out[i].group = b.letter; out[i].groupKind = b.kind; if (sec) out[i].groupSec = sec; else delete out[i].groupSec; }
  }
  return out;
}

/** A session's exercises as Arvy writes them (plan_workout and the after-workout plan: the EXERCISE shape in
 *  supabase/functions/planner-arvy/tools.ts) → the planner's own plan exercises. Anything odd is dropped or clamped. */
export function planExercisesFrom(raw: unknown): PlanExercise[] {
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const num = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : undefined; };
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n) && n >= 0) : undefined);
  const pick = <T extends string>(v: unknown, of: readonly T[]) => of.find(x => x === v);
  return (Array.isArray(raw) ? raw : []).map(x => (x && typeof x === 'object' ? x as Record<string, unknown> : {})).map(e => {
    const seconds = num(e.seconds, 5, 7200);
    const repsBySet = nums(e.reps_by_set)?.map(Math.round).filter(n => n > 0);
    const reps = typeof e.reps === 'number' ? String(e.reps) : str(e.reps, 16);
    const mode: PlanExercise['mode'] = seconds && !reps && !repsBySet?.length ? 'time' : 'reps';
    const weight = Number(e.weight) > 0 ? Math.round(Number(e.weight) * 10) / 10 : undefined;
    const out: PlanExercise = { name: str(e.name, 80), mode, sets: num(e.sets, 1, 20) ?? 1, reps: reps || undefined, seconds, restSec: num(e.rest_seconds, 0, 900) ?? (mode === 'time' ? 0 : 90), note: str(e.cue, 140) || undefined, weight };
    if (e.per_side === true) out.perSide = true;
    if (e.no_weight === true) out.noWeight = true;
    if (str(e.group, 3)) out.group = str(e.group, 3);
    const kind = pick(e.group_style, ['superset', 'circuit', 'emom', 'amrap'] as const); if (kind && out.group) out.groupKind = kind;
    const mins = num(e.group_minutes, 1, 60); if (mins && out.groupKind) out.groupMinutes = mins;
    if (repsBySet && repsBySet.length >= 2) out.repsBySet = repsBySet;
    const w = nums(e.weight_by_set); if (w && w.length >= 2) out.weightBySet = w;
    const style = pick(e.style, ['pyramid', 'countdown', 'ladder', 'drop', 'intervals'] as const); if (style) out.style = style;
    if (str(e.muscle, 20)) out.muscle = str(e.muscle, 20);
    if (str(e.equipment, 20)) out.equipment = str(e.equipment, 20);
    return out;
  }).filter(e => e.name).slice(0, 30);
}

/** A template's exercises as indented lines, block by block (the Confirm card, the after-workout panel). */
export function sessionLines(exercises: Fx[], libOf: (id?: string) => Exercise | undefined = () => undefined, max = 16): string[] {
  const out: string[] = [];
  for (const b of blocksOf(exercises)) {
    if (b.kind === 'single') { const e = exercises[b.at[0]]; out.push(`  ${e.name}: ${targetLine(e, libOf(e.exerciseId))}${e.note ? ` (${e.note})` : ''}`); continue; }
    out.push(`  ${blockTitle(b, exercises)}:`);
    for (const i of b.at) { const e = exercises[i]; out.push(`    ${e.name}: ${b.kind === 'emom' || b.kind === 'amrap' ? (e.mode === 'time' ? fmtSec(e.targetSec || 30) : `${e.targetReps} reps${hasSides(e, libOf(e.exerciseId)) && !SIDES.test(e.targetReps || '') ? ' per side' : ''}`) : targetLine(e, libOf(e.exerciseId))}`); }
  }
  return out.length > max ? [...out.slice(0, max), `  …and ${out.length - max} more lines`] : out;
}
