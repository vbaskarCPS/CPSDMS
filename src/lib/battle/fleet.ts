// src/lib/battle/fleet.ts — Battleship rules for the page: the board, the fleet, placing ships
// (the same checks the server makes in minigame_battle_fleet_ok), a random fleet, the game as the
// server sends it, the record, and the holiday look of the sea (it follows src/lib/memory/themes.ts).
import type { ThemeId } from '../memory/themes';

export const SIZE = 10;
export const FLEET = [
  { name: 'Carrier', len: 5 }, { name: 'Battleship', len: 4 }, { name: 'Cruiser', len: 3 }, { name: 'Submarine', len: 3 }, { name: 'Destroyer', len: 2 },
] as const;
export const TURN_SECONDS = 30;

/** A ship on the board: where its first cell is and which way it runs. */
export type Placed = { start: number; across: boolean };
export type Fleet = (Placed | null)[];   // one per FLEET entry; null = not on the board yet

export const rowOf = (c: number) => Math.floor(c / SIZE), colOf = (c: number) => c % SIZE;

/** The cells a ship covers, or null if it would run off the board. */
export function cellsOf(p: Placed, len: number): number[] | null {
  const r = rowOf(p.start), c = colOf(p.start);
  if (p.start < 0 || p.start >= SIZE * SIZE) return null;
  if (p.across ? c + len > SIZE : r + len > SIZE) return null;
  return Array.from({ length: len }, (_, k) => p.start + k * (p.across ? 1 : SIZE));
}

/** Can ship i go here without leaving the board or overlapping another ship? */
export function fits(fleet: Fleet, i: number, p: Placed): boolean {
  const mine = cellsOf(p, FLEET[i].len);
  if (!mine) return false;
  const taken = new Set(fleet.flatMap((q, j) => (j === i || !q ? [] : cellsOf(q, FLEET[j].len) || [])));
  return mine.every(c => !taken.has(c));
}

/** The fleet as the server wants it: [[Carrier cells], [Battleship cells], …], or null if incomplete. */
export function toShips(fleet: Fleet): number[][] | null {
  if (fleet.length !== FLEET.length || fleet.some(p => !p)) return null;
  const ships = fleet.map((p, i) => cellsOf(p as Placed, FLEET[i].len));
  return ships.every(Boolean) ? (ships as number[][]) : null;
}

/** The same check the server makes: five straight ships of 5, 4, 3, 3, 2, on the board, no overlap. */
export function fleetOk(ships: unknown): boolean {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  const all = new Set<number>();
  for (const [i, s] of ships.entries()) {
    if (!Array.isArray(s) || s.length !== FLEET[i].len || !s.every(x => Number.isInteger(x) && x >= 0 && x < SIZE * SIZE)) return false;
    const cells = [...s].sort((a, b) => a - b), step = cells[1] - cells[0];
    if (step !== 1 && step !== SIZE) return false;
    for (let k = 1; k < cells.length; k++) {
      if (cells[k] - cells[k - 1] !== step) return false;
      if (step === 1 && rowOf(cells[k]) !== rowOf(cells[0])) return false;
    }
    cells.forEach(c => all.add(c));
  }
  return all.size === 17;
}

/** A random fleet (Shuffle). */
export function randomFleet(rand: () => number = Math.random): Fleet {
  for (;;) {
    const fleet: Fleet = FLEET.map(() => null);
    let ok = true;
    for (let i = 0; i < FLEET.length && ok; i++) {
      ok = false;
      for (let t = 0; t < 200; t++) {
        const p = { start: Math.floor(rand() * SIZE * SIZE), across: rand() < 0.5 };
        if (fits(fleet, i, p)) { fleet[i] = p; ok = true; break; }
      }
    }
    if (ok) return fleet;
  }
}

/** Where a ship should start so that the cell under the finger is its k-th cell (dragging). */
export function anchor(cell: number, k: number, across: boolean): number {
  return across ? cell - k : cell - k * SIZE;
}

// ── the game as the server sends it (minigame_battle_view) ──
export type BPlayer = { id: string; name: string };
export type Shot = { c: number; hit: boolean };
export type Sunk = { i: number; cells: number[] };
export type Battle = {
  id: string; code: string; status: 'waiting' | 'placing' | 'playing' | 'done' | 'left' | 'expired';
  turn: string | null; turn_deadline: string | null; winner: string | null;
  my_ships: number[][] | null; me_ready: boolean; them_ready: boolean;
  my_shots: Shot[]; their_shots: Shot[]; their_sunk: Sunk[]; my_sunk: Sunk[]; their_ships: number[][] | null;
  last: { by?: string; c?: number; hit?: boolean; sunk?: Sunk | null; timeout?: boolean } | null; version: number;
  host: BPlayer; guest: BPlayer | null; left_by: string | null; next_match: string | null; finished_at: string | null; now: string;
};
export type BattleHistory = { id: string; host: BPlayer; guest: BPlayer; winner: string; host_shots: number; guest_shots: number; finished_at: string }[];

export function battleRecord(history: BattleHistory, me: string) {
  const out = new Map<string, { id: string; name: string; won: number; lost: number }>();
  for (const m of history) {
    const them = m.host.id === me ? m.guest : m.host;
    if (them.id === me) continue;
    const row = out.get(them.id) || { id: them.id, name: them.name, won: 0, lost: 0 };
    if (m.winner === me) row.won++; else row.lost++;
    out.set(them.id, row);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Hits and accuracy from a list of shots. */
export const accuracy = (shots: Shot[]) => ({ shots: shots.length, hits: shots.filter(s => s.hit).length, pct: shots.length ? Math.round((100 * shots.filter(s => s.hit).length) / shots.length) : 0 });

// ── the holiday look of the sea ──
export type Sea = { title: string; water: string; line: string; hull: string; hit: string; miss: string; sunk: string };
export const SEAS: Record<ThemeId, Sea> = {
  halloween: { title: 'Ghost Fleet', water: '#1e1b4b', line: 'rgba(167,139,250,.25)', hull: '#a78bfa', hit: '🎃', miss: '👻', sunk: '☠️' },
  christmas: { title: 'Sleigh Fleet', water: '#0c4a6e', line: 'rgba(186,230,253,.25)', hull: '#ef4444', hit: '🎁', miss: '❄️', sunk: '🎄' },
  newyear: { title: 'Fireworks Fleet', water: '#0f172a', line: 'rgba(253,224,71,.2)', hull: '#facc15', hit: '🎆', miss: '✨', sunk: '🎇' },
  valentines: { title: 'Love Boats', water: '#500724', line: 'rgba(251,207,232,.25)', hull: '#f472b6', hit: '💘', miss: '💧', sunk: '💔' },
  stpatricks: { title: 'Lucky Fleet', water: '#052e16', line: 'rgba(134,239,172,.22)', hull: '#22c55e', hit: '☘️', miss: '💧', sunk: '🪙' },
  easter: { title: 'Egg Fleet', water: '#2e1065', line: 'rgba(221,214,254,.25)', hull: '#a5f3fc', hit: '🥚', miss: '💧', sunk: '🐣' },
  canada: { title: 'True North Navy', water: '#082f49', line: 'rgba(254,202,202,.25)', hull: '#ef4444', hit: '🍁', miss: '💧', sunk: '🦫' },
  thanksgiving: { title: 'Harvest Armada', water: '#271201', line: 'rgba(253,230,138,.22)', hull: '#f59e0b', hit: '🌽', miss: '🍂', sunk: '🦃' },
};
