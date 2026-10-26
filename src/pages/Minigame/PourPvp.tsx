// src/pages/Minigame/PourPvp.tsx — Pour head-to-head (⚔️ PvP on the Pour screen). Two players, each
// on their own phone, race through the same 5 puzzles. One creates a match and reads out the
// 4-letter code; the other joins with it. The server (minigame_match_* functions) keeps the board
// and times the finishes; this phone checks in about once a second to show the other player's
// progress. Points and the record are worked out in src/lib/pour/pvp.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeDeal } from '../../lib/pour/engine';
import { PENALTY, clock, headToHead, roundsOver, scoreMatch, type Match, type MatchPlayer, type RoundEntry, type RoundResult } from '../../lib/pour/pvp';
import { matchCreate, matchHistory, matchJoin, matchLeave, matchRematch, matchReport, matchState } from './account';
import { POUR_BG, POUR_CSS, Tool, usePourPlay, type PourAction } from './pourPlay';

const POLL_MS = 1000;
const KEEP = 'pour.pvp.match';   // the match this phone is in, so a reload picks it up again
const keep = (id: string | null) => { try { if (id) sessionStorage.setItem(KEEP, id); else sessionStorage.removeItem(KEEP); } catch { /* ignore */ } };
const kept = () => { try { return sessionStorage.getItem(KEEP); } catch { return null; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const shell = (children: React.ReactNode) => (
  <div className="min-h-screen w-full overflow-hidden select-none text-white flex flex-col" style={{ background: POUR_BG, fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
    <style>{POUR_CSS}</style>
    {children}
  </div>
);
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`w-full max-w-sm rounded-3xl bg-indigo-950/90 border border-white/15 p-6 text-center shadow-2xl ${className || ''}`} style={{ animation: 'pour-pop .25s ease-out' }}>{children}</div>
);
const Big: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; light?: boolean; label?: string }> = ({ onClick, children, disabled, light, label }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
    className={`w-full py-3 rounded-2xl font-extrabold text-lg disabled:opacity-50 ${light ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-yellow-400 hover:bg-yellow-300 text-indigo-950'}`}>{children}</button>
);

const PourPvp: React.FC<{ me: MatchPlayer; sound: boolean; exit: () => void }> = ({ me, sound, exit }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);   // server clock minus this phone's clock
  const current = useRef<string | null>(null);   // the match this phone is in now

  /** Take a match from the server, and keep this phone's clock in step with the server's. A late
   *  answer about a match we've already moved on from (e.g. the old one, just after a rematch) is dropped. */
  const take = useCallback((m: Match, sentAt: number, poll = false) => {
    if (poll && m.id !== current.current) return;
    current.current = m.id;
    const back = Date.now();
    offset.current = Date.parse(m.now) - (sentAt + back) / 2;
    setMatch(m);
    keep(m.status === 'waiting' || m.status === 'playing' ? m.id : null);
  }, []);
  const call = useCallback(async (f: () => Promise<Match>, poll = false) => { const t = Date.now(); const m = await f(); take(m, t, poll); return m; }, [take]);

  // a reload in the middle of a match picks it up again
  useEffect(() => {
    const id = kept();
    if (id) call(() => matchState(id)).catch(() => keep(null));
  }, [call]);

  // check in about once a second while in a match
  const id = match?.id, live = match && match.status !== 'expired' && match.status !== 'left';
  useEffect(() => {
    if (!id || !live) return;
    let stop = false;
    const t = window.setInterval(() => { if (!stop) call(() => matchState(id), true).catch(e => setError(msg(e))); }, POLL_MS);
    return () => { stop = true; window.clearInterval(t); };
  }, [id, live, call]);

  const leaveToLobby = () => { keep(null); current.current = null; setMatch(null); setError(null); };

  if (!match) return <Lobby me={me} error={error} setError={setError} exit={exit} onMatch={m => call(async () => m)} />;
  const them = match.host.id === me.id ? match.guest : match.host;

  if (match.status === 'expired') return shell(
    <div className="flex-1 flex items-center justify-center p-6"><Card>
      <div className="text-4xl">⌛</div><div className="text-xl font-extrabold mt-2">That match ran out of time</div>
      <div className="text-sm text-indigo-200 mt-1">Codes last 15 minutes. Make a new one.</div>
      <div className="mt-5"><Big onClick={leaveToLobby}>OK</Big></div>
    </Card></div>);

  if (match.status === 'waiting') return shell(
    <div className="flex-1 flex items-center justify-center p-6"><Card>
      {match.guest && match.guest.id !== me.id ? (
        <><div className="text-4xl">🔁</div><div className="text-xl font-extrabold mt-2">Waiting for {match.guest.name}</div>
          <div className="text-sm text-indigo-200 mt-1">They need to tap <b>Rematch</b> too.</div></>
      ) : (
        <><div className="text-sm uppercase tracking-widest text-indigo-200">Your code</div>
          <div className="text-6xl font-black tracking-[.2em] mt-2 text-yellow-300" aria-label="Match code">{match.code}</div>
          <div className="text-sm text-indigo-200 mt-3">The other player taps <b>Join</b> and types this in.</div>
          <div className="mt-4 text-indigo-200 animate-pulse">Waiting for someone to join…</div></>
      )}
      <div className="mt-5"><Big light onClick={async () => { await matchLeave(match.id).catch(() => undefined); leaveToLobby(); }}>Cancel</Big></div>
    </Card></div>);

  if (match.status === 'left') return shell(
    <div className="flex-1 flex items-center justify-center p-6"><Card>
      <div className="text-4xl">🚪</div>
      <div className="text-xl font-extrabold mt-2">{match.left_by === me.id ? 'You left the match' : `${them?.name || 'They'} left the match`}</div>
      <div className="mt-5"><Big onClick={leaveToLobby}>OK</Big></div>
    </Card></div>);

  if (match.status === 'done' && them) return (
    <Results match={match} me={me} them={them} onBack={leaveToLobby}
      onRematch={async () => {
        try { const r = await matchRematch(match.id); if (r.ok) await call(async () => r.match); else setError('That match isn’t finished yet.'); }
        catch (e) { setError(msg(e)); }
      }} />);

  if (!them) return null;
  return <Race key={match.id} match={match} me={me} them={them} sound={sound} serverNow={() => Date.now() + offset.current}
    report={r => call(() => matchReport(match.id, r), true).then(() => undefined).catch(e => setError(msg(e)))}
    leave={async () => { await matchLeave(match.id).catch(() => undefined); leaveToLobby(); }} />;
};

// ── the lobby: make a match, join one, and the head-to-head record ──
const Lobby: React.FC<{ me: MatchPlayer; error: string | null; setError: (e: string | null) => void; exit: () => void; onMatch: (m: Match) => void }> = ({ me, error, setError, exit, onMatch }) => {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<ReturnType<typeof headToHead> | null>(null);
  useEffect(() => { matchHistory().then(h => setRecord(headToHead(h, me.id))).catch(() => setRecord([])); }, [me.id]);

  const create = async () => { setBusy(true); setError(null); try { onMatch(await matchCreate()); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  const join = async () => {
    if (code.length !== 4) return;
    setBusy(true); setError(null);
    try {
      const r = await matchJoin(code);
      if (r.ok) onMatch(r.match);
      else setError(r.reason === 'own_match' ? 'That’s your own code. The other player types it in.' : 'No match with that code. Check the letters.');
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  return shell(
    <>
      <header className="flex items-center gap-2 px-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <button type="button" aria-label="Back to Pour" onClick={exit} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl">‹</button>
        <div className="text-2xl font-extrabold tracking-tight">Pour ⚔️ PvP</div>
      </header>
      <div className="flex-1 flex flex-col items-center px-6 py-6 gap-4 max-w-sm w-full mx-auto">
        <div className="text-sm text-indigo-200 text-center">Same 5 puzzles for both of you. Points for finishing (+1), being faster (+3) and using fewer moves (+2). Helpers cost time: Undo +2s, Hint +5s, Bottle +10s.</div>
        {!joining ? (
          <>
            <Big onClick={create} disabled={busy}>Create a match</Big>
            <Big light onClick={() => { setJoining(true); setError(null); }}>Join with a code</Big>
          </>
        ) : (
          <>
            <input value={code} autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} aria-label="Code"
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') join(); }}
              placeholder="ABCD" className="w-full text-center text-5xl font-black tracking-[.25em] rounded-2xl py-3 bg-white/10 border border-white/20 outline-none focus:border-yellow-300 placeholder:text-white/20" />
            <Big onClick={join} disabled={busy || code.length !== 4}>Join</Big>
            <button type="button" onClick={() => { setJoining(false); setCode(''); setError(null); }} className="text-sm text-indigo-200 underline">Back</button>
          </>
        )}
        {error && <div className="text-sm text-red-200 text-center">{error}</div>}
        <div className="w-full mt-4">
          <div className="text-xs uppercase tracking-widest text-indigo-200">Head to head</div>
          <div className="mt-2 rounded-2xl bg-white/10 divide-y divide-white/10">
            {record === null && <div className="p-3 text-indigo-200 animate-pulse text-sm">Loading…</div>}
            {record?.length === 0 && <div className="p-3 text-indigo-200 text-sm">No matches yet.</div>}
            {record?.map(r => (
              <div key={r.id} className="p-3 flex items-center justify-between">
                <div className="font-bold">{me.name} vs {r.name}</div>
                <div className="font-extrabold text-lg" aria-label={`Record against ${r.name}`}>{r.won} – {r.lost}{r.drawn ? <span className="text-sm text-indigo-200"> ({r.drawn} tied)</span> : null}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

type Report = { round: number; sorted: number; total: number; moves: number; penalty: number; finished: boolean; gaveUp: boolean };

// ── a match being played ──
const Race: React.FC<{ match: Match; me: MatchPlayer; them: MatchPlayer; sound: boolean; serverNow: () => number; report: (r: Report) => Promise<void>; leave: () => void }> = ({ match, me, them, sound, serverNow, report, leave }) => {
  const r = match.round;
  const puzzle = useMemo(() => makeDeal(match.levels[r], match.seeds[r]), [match.levels, match.seeds, r]);
  const moves = useRef(0), penalty = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [askGiveUp, setAskGiveUp] = useState(false);
  const [mine, setMine] = useState<string | null>(null);   // "+5s" over my clock
  const [, setTick] = useState(0);
  const onAction = (a: PourAction) => {
    if (a === 'pour') moves.current++;
    const add = a === 'undo' ? PENALTY.undo : a === 'hint' ? PENALTY.hint : a === 'bottle' ? PENALTY.bottle : 0;
    if (add) { penalty.current += add; setMine(`+${add / 1000}s`); window.setTimeout(() => setMine(null), 1400); }
    setTick(t => t + 1);
  };
  // helpers are open in a match: they cost time instead
  const play = usePourPlay(puzzle, { sound, extras: 1, hints: 99, onAction });
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = window.setInterval(() => setNow(serverNow()), 100); return () => window.clearInterval(t); }, [serverNow]);

  // a new round: a new puzzle, and counters back to zero
  useEffect(() => { play.load(puzzle); moves.current = 0; penalty.current = 0; setGaveUp(false); setAskGiveUp(false); }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = match.round_start ? Date.parse(match.round_start) : now, end = match.round_end ? Date.parse(match.round_end) : now;
  const mineE = match.board[me.id]?.[String(r)], theirE = match.board[them.id]?.[String(r)];
  const iFinished = mineE?.finished_ms != null, over = now >= end;
  const before = now < start;

  // tell the server how it's going whenever something changes (one call at a time, the latest wins)
  const sending = useRef(false), queued = useRef<Report | null>(null), last = useRef('');
  const send = useCallback(async (rep: Report) => {
    const key = JSON.stringify(rep);
    if (key === last.current) return;
    if (sending.current) { queued.current = rep; return; }
    sending.current = true; last.current = key;
    await report(rep);
    sending.current = false;
    if (queued.current) { const q = queued.current; queued.current = null; send(q); }
  }, [report]);
  useEffect(() => {
    if (before || iFinished || over) return;
    send({ round: r, sorted: play.sorted, total: play.colours, moves: moves.current, penalty: penalty.current, finished: play.won, gaveUp });
  });

  const score = scoreMatch(match, me.id, them.id, roundsOver(match));
  const prev = r > 0 ? score.rounds[r - 1] : null;
  const myClock = iFinished ? (mineE!.finished_ms as number) + (mineE!.penalty_ms || 0) : before ? 0 : Math.min(now, end) - start + penalty.current;

  return shell(
    <>
      {/* the scoreboard: me, round, them */}
      <header className="px-3" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Leave match" onClick={() => setAskLeave(true)} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg shrink-0">‹</button>
          <div className="flex-1 grid grid-cols-3 items-center text-center">
            <div><div className="text-xs text-indigo-200 truncate">{me.name}</div><div className="text-2xl font-black" aria-label="My points">{score.points[0]}</div></div>
            <div><div className="text-[11px] uppercase tracking-widest text-indigo-200">Round</div><div className="text-lg font-extrabold" data-testid="pvp-round" data-round={r} data-live={!before ? '1' : '0'}>{r + 1} / {match.levels.length}</div></div>
            <div><div className="text-xs text-indigo-200 truncate">{them.name}</div><div className="text-2xl font-black" aria-label="Their points">{score.points[1]}</div></div>
          </div>
          <button type="button" onClick={() => setAskGiveUp(true)} disabled={before || iFinished || gaveUp || over}
            className="px-2.5 h-9 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold disabled:opacity-30 shrink-0">Give up</button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="relative font-mono text-xl font-bold tabular-nums" aria-label="My time">
            {clock(myClock)}
            {mine && <span className="absolute -top-4 left-full ml-1 text-sm font-extrabold text-red-300" style={{ animation: 'pour-pop .2s ease-out' }}>{mine}</span>}
          </div>
          <div className="text-xs text-indigo-200">{moves.current} moves</div>
          <div className="flex-1" />
        </div>
        <Rival name={them.name} e={theirE} total={play.colours} />
      </header>

      {play.board}

      {play.note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm">{play.note}</div>}
      {play.stuck && !play.note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm">No moves left. Undo, add a bottle, or restart.</div>}

      <nav className="grid grid-cols-4 gap-2 px-3 pb-4 w-full max-w-md mx-auto" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Tool label="Undo" icon="↶" badge="+2s" onClick={play.undo} disabled={!play.history.length || iFinished} />
        <Tool label="Restart" icon="⟲" onClick={play.restart} disabled={iFinished} />
        <Tool label="Bottle" icon="＋" badge={play.extraLeft ? '+10s' : 0} onClick={play.addBottle} disabled={play.extraLeft <= 0 || play.won} />
        <Tool label={play.thinking ? 'Thinking…' : 'Hint'} icon="💡" badge="+5s" onClick={play.askHint} disabled={play.won || play.thinking} />
      </nav>

      {/* between rounds: who won the last one, then 3-2-1 (the puzzle stays hidden until GO) */}
      {before && (
        <Overlay solid>
          {prev && start - now > 3500
            ? <RoundCard n={r} mine={prev[0]} theirs={prev[1]} them={them.name} />
            : <div className="text-center">
                <div className="text-indigo-200 font-bold">Round {r + 1} of {match.levels.length}</div>
                <div className="text-8xl font-black text-yellow-300 mt-2" style={{ animation: 'pour-pop .3s ease-out' }} key={Math.ceil((start - now) / 1000)}>{Math.max(1, Math.ceil((start - now) / 1000))}</div>
              </div>}
        </Overlay>
      )}
      {!before && (iFinished || play.won || gaveUp || over) && (
        <Overlay>
          <Card>
            {iFinished || play.won ? (
              <><div className="text-4xl">✨</div><div className="text-2xl font-extrabold mt-1">Done!</div>
                <div className="text-sm text-indigo-200 mt-1">{iFinished ? clock((mineE!.finished_ms as number) + (mineE!.penalty_ms || 0)) : '…'} · {moves.current} moves</div></>
            ) : gaveUp ? (
              <><div className="text-4xl">🏳️</div><div className="text-xl font-extrabold mt-1">You gave up this round</div></>
            ) : (
              <><div className="text-4xl">⏰</div><div className="text-xl font-extrabold mt-1">Time’s up</div></>
            )}
            <div className="mt-3 text-indigo-200">
              {theirE?.finished_ms != null ? `${them.name} finished.` : theirE?.gave_up ? `${them.name} gave up.` : over ? 'Next round coming…' : `${them.name} has ${Math.max(0, Math.ceil((end - now) / 1000))}s left…`}
            </div>
          </Card>
        </Overlay>
      )}
      {askGiveUp && (
        <Overlay>
          <Card>
            <div className="text-xl font-extrabold">Give up this round?</div>
            <div className="text-sm text-indigo-200 mt-1">No points for it. The next round still counts.</div>
            <div className="mt-5 grid gap-2">
              <Big onClick={() => { setAskGiveUp(false); setGaveUp(true); send({ round: r, sorted: play.sorted, total: play.colours, moves: moves.current, penalty: penalty.current, finished: false, gaveUp: true }); }}>Give up</Big>
              <Big light onClick={() => setAskGiveUp(false)}>Keep going</Big>
            </div>
          </Card>
        </Overlay>
      )}
      {askLeave && (
        <Overlay>
          <Card>
            <div className="text-xl font-extrabold">Leave the match?</div>
            <div className="text-sm text-indigo-200 mt-1">It ends for both of you and doesn’t count.</div>
            <div className="mt-5 grid gap-2">
              <Big onClick={leave}>Leave</Big>
              <Big light onClick={() => setAskLeave(false)}>Stay</Big>
            </div>
          </Card>
        </Overlay>
      )}
    </>
  );
};

const Overlay: React.FC<{ children: React.ReactNode; solid?: boolean }> = ({ children, solid }) => (
  <div data-testid="pvp-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: solid ? POUR_BG : 'rgba(0,0,0,.6)' }}>{children}</div>
);

/** The other player's progress: corked bottles, moves, and the helper time they just took. */
const Rival: React.FC<{ name: string; e?: RoundEntry; total: number }> = ({ name, e, total }) => {
  const [flash, setFlash] = useState<string | null>(null);
  const was = useRef(e?.penalty_ms || 0);
  useEffect(() => {
    const p = e?.penalty_ms || 0;
    if (p > was.current) { setFlash(`+${(p - was.current) / 1000}s`); const t = window.setTimeout(() => setFlash(null), 1500); was.current = p; return () => window.clearTimeout(t); }
    was.current = p;
  }, [e?.penalty_ms]);
  const n = e?.sorted || 0, of = e?.total || total || 1;
  const done = e?.finished_ms != null;
  return (
    <div className="mt-2 rounded-xl bg-black/25 px-3 py-2" aria-label={`${name}'s progress`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold">{name}</span>
        <span className="text-indigo-200">
          {done ? <b className="text-emerald-300">✓ DONE {clock((e!.finished_ms as number) + (e!.penalty_ms || 0))}</b> : e?.gave_up ? 'gave up' : `${n} / ${of} sorted`} · {e?.moves || 0} moves
          {flash && <b className="ml-2 text-red-300" style={{ animation: 'pour-pop .2s ease-out' }}>{flash}</b>}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${done ? 100 : (100 * n) / of}%`, background: done ? '#34d399' : '#facc15' }} />
      </div>
    </div>
  );
};

const line = (x: RoundResult) => (x.finished ? `${clock(x.time as number)} · ${x.moves} moves` : x.gaveUp ? 'gave up' : 'didn’t finish');

const RoundCard: React.FC<{ n: number; mine: RoundResult; theirs: RoundResult; them: string }> = ({ n, mine, theirs, them }) => (
  <Card>
    <div className="text-xs uppercase tracking-widest text-indigo-200">Round {n} result</div>
    <div className="grid grid-cols-2 gap-3 mt-3">
      <div className={`rounded-2xl p-3 ${mine.points > theirs.points ? 'bg-yellow-400/20 ring-2 ring-yellow-300' : 'bg-white/5'}`}>
        <div className="font-bold">You</div><div className="text-3xl font-black">+{mine.points}</div><div className="text-xs text-indigo-200 mt-1">{line(mine)}</div>
      </div>
      <div className={`rounded-2xl p-3 ${theirs.points > mine.points ? 'bg-yellow-400/20 ring-2 ring-yellow-300' : 'bg-white/5'}`}>
        <div className="font-bold">{them}</div><div className="text-3xl font-black">+{theirs.points}</div><div className="text-xs text-indigo-200 mt-1">{line(theirs)}</div>
      </div>
    </div>
  </Card>
);

// ── the end: who won, round by round, and a rematch ──
const Results: React.FC<{ match: Match; me: MatchPlayer; them: MatchPlayer; onBack: () => void; onRematch: () => void }> = ({ match, me, them, onBack, onRematch }) => {
  const s = scoreMatch(match, me.id, them.id);
  const won = s.leader === 0, lost = s.leader === 1;
  const theyAsked = !!match.next_match;
  const cell = (x: RoundResult) => (
    <td className="py-1.5 px-2">
      <div className="font-bold">{x.points ? `+${x.points}` : '0'}</div>
      <div className="text-[11px] text-indigo-200">{line(x)}{x.penalty ? ` (incl. +${x.penalty / 1000}s)` : ''}</div>
    </td>
  );
  return shell(
    <div className="flex-1 flex flex-col items-center px-4 py-6 max-w-md w-full mx-auto" style={{ paddingTop: 'max(24px, env(safe-area-inset-top))' }}>
      <div className="text-6xl">{won ? '🏆' : lost ? '🥈' : '🤝'}</div>
      <div className="text-3xl font-black mt-2" aria-label="Winner">{won ? 'You win!' : lost ? `${them.name} wins` : 'A tie!'}</div>
      <div className="text-xl font-extrabold mt-1">{me.name} {s.points[0]} – {s.points[1]} {them.name}</div>
      {s.points[0] === s.points[1] && s.leader !== null && <div className="text-xs text-indigo-200">Level on points; total time decides ({clock(s.time[0])} vs {clock(s.time[1])}).</div>}
      <table className="w-full mt-5 text-sm text-left rounded-2xl overflow-hidden bg-white/5">
        <thead><tr className="text-xs text-indigo-200"><th className="py-1.5 px-2">Round</th><th className="py-1.5 px-2">{me.name}</th><th className="py-1.5 px-2">{them.name}</th></tr></thead>
        <tbody>
          {s.rounds.map(([a, b], i) => (
            <tr key={i} className="border-t border-white/10"><td className="py-1.5 px-2 font-bold">{i + 1}</td>{cell(a)}{cell(b)}</tr>
          ))}
        </tbody>
      </table>
      <div className="w-full grid gap-2 mt-6">
        <Big onClick={onRematch}>{theyAsked ? 'Rematch! (they’re ready)' : 'Rematch'}</Big>
        <Big light onClick={onBack}>Done</Big>
      </div>
    </div>
  );
};

export default PourPvp;
