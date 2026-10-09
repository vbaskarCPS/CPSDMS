// src/lib/areaNumbers.ts — which route numbers belong to which map (area), shared by the
// Territory list and the map builder.
//
// A map has a prefix (AN) and a span of numbers (route_start … route_start + route_count − 1).
// Maps with the same name and a different # ("AJAX NORTH #1", "AJAX NORTH #2") share a prefix
// and follow on from each other. When a map grows past a number another map already has, it
// takes the first free number instead, so a map's numbers can have a gap (AN01–AN22 · AN87).
//
//   A number a map has DRAWN is that map's.
//   An undrawn number in a map's span is that map's unless a tighter span (another map whose
//   own span is smaller) also covers it — so a map that jumped ahead doesn't swallow the
//   numbers of the maps it jumped over.

export interface AreaSpan { area_name: string; prefix: string; route_start: number | null; route_count: number }
/** Area name → the route numbers it has drawn (approved or not). */
export type Drawn = Map<string, Set<number>>;

const up = (s: string) => (s || '').trim().toUpperCase();
const tidy = (name: string) => up(name).replace(/[`'".,]+$/, '').replace(/\s+/g, ' ').trim();
/** The map's number, if its name ends in one: "AJAX NORTH #2" / "LINDSAY 2" → 2. */
export const mapNumber = (name: string): number | null => { const m = tidy(name).match(/#?\s*(\d+)$/); return m ? Number(m[1]) : null; };
/** "AJAX NORTH #2" / "LINDSAY 2" → the run's name ("AJAX NORTH", "LINDSAY"). */
export const baseName = (name: string) => tidy(name).replace(/\s*#?\s*\d+$/, '').trim();
const span = (a: AreaSpan): [number, number] => { const s = a.route_start ?? 1; return [s, s + Math.max(0, a.route_count) - 1]; };
export const routeCode = (prefix: string, n: number) => `${up(prefix)}${String(n).padStart(2, '0')}`;

/** The numbers this map uses (drawn, plus its span less what tighter maps hold), ascending. */
export function ownedNumbers(area: AreaSpan, all: AreaSpan[], drawn: Drawn): number[] {
  const p = up(area.prefix);
  const others = all.filter(o => o.area_name !== area.area_name && up(o.prefix) === p);
  const otherDrawn = new Set<number>();
  for (const o of others) drawn.get(o.area_name)?.forEach(n => otherDrawn.add(n));
  const mine = new Set<number>(drawn.get(area.area_name) || []);
  const [s, e] = span(area);
  const size = e - s + 1;
  for (let n = s; n <= e; n++) {
    if (mine.has(n) || otherDrawn.has(n)) continue;
    const tighter = others.some(o => {
      const [os, oe] = span(o);
      const osize = oe - os + 1;
      return n >= os && n <= oe && (osize < size || (osize === size && o.area_name < area.area_name));
    });
    if (!tighter) mine.add(n);
  }
  return [...mine].sort((a, b) => a - b);
}

/** Every number with this prefix that some other map has drawn or spans. */
export function takenNumbers(prefix: string, all: AreaSpan[], drawn: Drawn, except?: string): Set<number> {
  const p = up(prefix);
  const out = new Set<number>();
  for (const o of all) {
    if (o.area_name === except || up(o.prefix) !== p) continue;
    const [s, e] = span(o);
    for (let n = s; n <= e; n++) out.add(n);
    drawn.get(o.area_name)?.forEach(n => out.add(n));
  }
  return out;
}

/** The first number at or after `from` that isn't taken. */
export function firstFree(taken: Set<number>, from = 1): number {
  let n = Math.max(1, from);
  while (taken.has(n)) n++;
  return n;
}

export type PrefixCheck =
  | { kind: 'empty' }
  | { kind: 'new'; start: number }
  | { kind: 'continue'; start: number; maps: string[]; label: string }
  | { kind: 'clash'; maps: string[]; label: string; suggest: string };

/**
 * Is this prefix free for a map with this name? Free when nobody uses it, or when every map
 * using it has the same name apart from its # (a #2, #3 … continues the run). `editing` is the
 * map being edited (it doesn't clash with itself).
 */
export function checkPrefix(name: string, prefix: string, all: AreaSpan[], drawn: Drawn, editing: string | null = null): PrefixCheck {
  const p = up(prefix);
  if (!p) return { kind: 'empty' };
  const users = all.filter(o => o.area_name !== editing && up(o.prefix) === p).sort((a, b) => a.area_name.localeCompare(b.area_name, undefined, { numeric: true }));
  const taken = takenNumbers(p, all, drawn, editing ?? undefined);
  if (!users.length) return { kind: 'new', start: firstFree(taken, 1) };
  const nums = [...taken].sort((a, b) => a - b);
  const label = runsLabel(p, nums);
  const base = baseName(name);
  // A numbered map of the same name (#2, #3 … or 2, 3 …) continues the run.
  if (base && mapNumber(name) != null && users.some(u => baseName(u.area_name) === base)) {
    return { kind: 'continue', start: firstFree(taken, 1), maps: users.map(u => u.area_name), label };
  }
  const ub = baseName(users[0].area_name);
  const top = Math.max(0, ...users.filter(u => baseName(u.area_name) === ub).map(u => mapNumber(u.area_name) ?? 1));
  return { kind: 'clash', maps: users.map(u => u.area_name), label, suggest: `${ub} #${top + 1}` };
}

/** [1,2,3,5,9,10] → "AN01–AN03 · AN05 · AN09–AN10". */
export function runsLabel(prefix: string, nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? routeCode(prefix, s[i]) : `${routeCode(prefix, s[i])}–${routeCode(prefix, s[j])}`);
    i = j + 1;
  }
  return out.join(' · ');
}

/** "AJAX NORTH #1–#4" style list of map names for messages. */
export function mapsLabel(maps: string[]): string {
  if (maps.length <= 1) return maps[0] || '';
  const bases = new Set(maps.map(baseName));
  if (bases.size === 1) {
    const ns = maps.map(mapNumber).filter((n): n is number => n != null).sort((a, b) => a - b);
    if (ns.length === maps.length) return `${[...bases][0]} #${ns[0]}${ns.length > 1 ? `–#${ns[ns.length - 1]}` : ''}`;
  }
  return maps.join(', ');
}
