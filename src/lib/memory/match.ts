// src/lib/memory/match.ts — the Match card game as the server sends it (minigame_memory_* functions),
// and who's winning. A match is best of 3 boards: whoever found more pairs wins the board; a tie board
// is nobody's. Most boards wins the match; level on boards → more pairs in total; then it's a tie.

export type MemPlayer = { id: string; name: string };
export type MemCard = { face: number | null; owner: 0 | 1 | 2 };
export type BoardResult = { host: number; guest: number };
export type MemLast = { a?: number; b?: number; fa?: number; fb?: number; match?: boolean; by?: string; timeout?: boolean } | null;
export type MemMatch = {
  id: string; code: string; status: 'waiting' | 'playing' | 'done' | 'left' | 'expired';
  sizes: number[]; board_no: number; cards: MemCard[];
  turn: string | null; first_pick: number | null; second_pick: number | null;
  reveal_until: string | null; pause_until: string | null; turn_deadline: string | null;
  boards: BoardResult[]; last: MemLast; version: number;
  host: MemPlayer; guest: MemPlayer | null; left_by: string | null; next_match: string | null; finished_at: string | null; now: string;
};
export type MemHistory = { id: string; host: MemPlayer; guest: MemPlayer; boards: BoardResult[]; finished_at: string }[];

export const TURN_SECONDS = 20;

/** Pairs found on the board so far: [host, guest]. */
export const pairsNow = (cards: MemCard[]): [number, number] =>
  [cards.filter(c => c.owner === 1).length / 2, cards.filter(c => c.owner === 2).length / 2];

/** Boards won and pairs found, [host, guest], and who's ahead (0 host, 1 guest, null level). */
export function standing(boards: BoardResult[]) {
  const wins: [number, number] = [0, 0], pairs: [number, number] = [0, 0];
  for (const b of boards) {
    if (b.host > b.guest) wins[0]++; else if (b.guest > b.host) wins[1]++;
    pairs[0] += b.host; pairs[1] += b.guest;
  }
  const leader: 0 | 1 | null = wins[0] !== wins[1] ? (wins[0] > wins[1] ? 0 : 1) : pairs[0] !== pairs[1] ? (pairs[0] > pairs[1] ? 0 : 1) : null;
  return { wins, pairs, leader };
}

/** From one player's side: [mine, theirs] instead of [host, guest]. */
export const mine = <T,>(pair: [T, T], iAmHost: boolean): [T, T] => (iAmHost ? pair : [pair[1], pair[0]]);

/** Wins, losses and ties against each opponent. */
export function memRecord(history: MemHistory, me: string) {
  const out = new Map<string, { id: string; name: string; won: number; lost: number; drawn: number }>();
  for (const m of history) {
    const host = m.host.id === me, them = host ? m.guest : m.host;
    if (them.id === me) continue;
    const { leader } = standing(m.boards);
    const row = out.get(them.id) || { id: them.id, name: them.name, won: 0, lost: 0, drawn: 0 };
    if (leader === null) row.drawn++; else if ((leader === 0) === host) row.won++; else row.lost++;
    out.set(them.id, row);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** How many columns to lay a board out in (portrait phone). */
export const columnsFor = (cards: number) => (cards <= 16 ? 4 : cards <= 24 ? 4 : 5);
