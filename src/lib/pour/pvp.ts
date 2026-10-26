// src/lib/pour/pvp.ts — Pour head-to-head: the match as the server sends it, the helper time
// penalties, and the points. The server (supabase minigame_match_* functions) keeps the board and
// times the finishes; points are worked out here so there's one rule for both phones and the record.
//
// Each round, both players get the same puzzle. Points per round:
//   finished it +1 · faster (time plus helper penalties) +3 · fewer moves +2 (a tie: +1 each).
// Only players who finished compare speed and moves. Most points after the last round wins;
// a tie goes to the lower total time.

/** Helper time added to your round (ms). */
export const PENALTY = { undo: 2000, hint: 5000, bottle: 10000 } as const;
export type Helper = keyof typeof PENALTY;
/** After the first player finishes, the other has this long. */
export const CUTOFF_MS = 60_000;
/** A round closes after this long even if nobody finishes. */
export const ROUND_MAX_MS = 5 * 60_000;
export const POINTS = { finish: 1, faster: 3, fewer: 2, fewerTie: 1 } as const;

export type RoundEntry = { sorted: number; total: number; moves: number; penalty_ms: number; finished_ms: number | null; gave_up: boolean };
export type MatchPlayer = { id: string; name: string };
export type MatchStatus = 'waiting' | 'playing' | 'done' | 'left' | 'expired';
export type Match = {
  id: string; code: string; status: MatchStatus; levels: number[]; seeds: number[];
  round: number; round_start: string | null; round_end: string | null;
  board: Record<string, Record<string, RoundEntry | undefined> | undefined>;
  host: MatchPlayer; guest: MatchPlayer | null; left_by: string | null; next_match: string | null;
  finished_at: string | null; now: string;
};

export type RoundResult = {
  finished: boolean; gaveUp: boolean;
  /** time plus helper penalties (ms); null if not finished */
  time: number | null; moves: number | null; penalty: number;
  faster: boolean; fewer: boolean; points: number;
};

const done = (e?: RoundEntry) => !!e && e.finished_ms != null;
const adjusted = (e: RoundEntry) => (e.finished_ms as number) + (e.penalty_ms || 0);

/** Points for one round, for two players' entries (either may be missing). */
export function scoreRound(a?: RoundEntry, b?: RoundEntry): [RoundResult, RoundResult] {
  const one = (me?: RoundEntry, other?: RoundEntry): RoundResult => {
    const fin = done(me);
    const r: RoundResult = { finished: fin, gaveUp: !!me?.gave_up, time: fin ? adjusted(me!) : null, moves: fin ? me!.moves : null,
      penalty: me?.penalty_ms || 0, faster: false, fewer: false, points: 0 };
    if (!fin) return r;
    r.points += POINTS.finish;
    const otherFin = done(other);
    if (!otherFin || adjusted(me!) <= adjusted(other!)) { r.faster = true; r.points += POINTS.faster; }
    if (!otherFin || me!.moves < other!.moves) { r.fewer = true; r.points += POINTS.fewer; }
    else if (me!.moves === other!.moves) { r.fewer = true; r.points += POINTS.fewerTie; }
    return r;
  };
  return [one(a, b), one(b, a)];
}

/** Time a round counts for in the tie-break: your time if you finished; otherwise when the round
 *  closed (60 s after the other finished, or the 5-minute limit), plus your helper time. */
function tieTime(me: RoundResult, otherEntry?: RoundEntry): number {
  if (me.time != null) return me.time;
  const closed = otherEntry && otherEntry.finished_ms != null ? otherEntry.finished_ms + CUTOFF_MS : ROUND_MAX_MS;
  return closed + me.penalty;
}

export type Score = {
  rounds: [RoundResult, RoundResult][];
  points: [number, number]; time: [number, number];
  /** 0 = first player ahead, 1 = second, null = level */
  leader: 0 | 1 | null;
};

/** The score so far between players a and b, counting only rounds that are over (`upTo` rounds). */
export function scoreMatch(m: Pick<Match, 'board' | 'levels'>, a: string, b: string, upTo = m.levels.length): Score {
  const rounds: [RoundResult, RoundResult][] = [];
  const points: [number, number] = [0, 0], time: [number, number] = [0, 0];
  for (let i = 0; i < upTo; i++) {
    const ea = m.board[a]?.[String(i)], eb = m.board[b]?.[String(i)];
    const rr = scoreRound(ea, eb);
    rounds.push(rr);
    points[0] += rr[0].points; points[1] += rr[1].points;
    time[0] += tieTime(rr[0], eb); time[1] += tieTime(rr[1], ea);
  }
  const leader = points[0] !== points[1] ? (points[0] > points[1] ? 0 : 1) : time[0] !== time[1] ? (time[0] < time[1] ? 0 : 1) : null;
  return { rounds, points, time, leader };
}

/** How many rounds are over (and can be scored): all of them once the match is done. */
export const roundsOver = (m: Pick<Match, 'status' | 'round' | 'levels'>) => (m.status === 'done' ? m.levels.length : m.round);

/** Wins and losses against each opponent, from finished matches (newest first). */
export function headToHead(history: Match[], me: string): { id: string; name: string; won: number; lost: number; drawn: number }[] {
  const out = new Map<string, { id: string; name: string; won: number; lost: number; drawn: number }>();
  for (const m of history) {
    if (m.status !== 'done' || !m.guest) continue;
    const them = m.host.id === me ? m.guest : m.host;
    if (them.id === me) continue;
    const s = scoreMatch(m, me, them.id);
    const row = out.get(them.id) || { id: them.id, name: them.name, won: 0, lost: 0, drawn: 0 };
    if (s.leader === 0) row.won++; else if (s.leader === 1) row.lost++; else row.drawn++;
    out.set(them.id, row);
  }
  return [...out.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** "1:07.4" */
export function clock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100)) / 10;
  const min = Math.floor(t / 60), sec = t - min * 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
}
