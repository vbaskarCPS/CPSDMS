// src/pages/Minigame/BattleGame.tsx — Battleship (/minigame/battle), two players each on their own
// phone. Place your fleet (drag a ship to move it, tap it to turn it, or Shuffle), tap Ready, then
// take turns firing at the other's waters: a hit fires again, a miss passes the turn, 30 s a turn.
// Sink all five to win. Fleets stay on the server (minigame_battle_* functions); this phone only
// learns hits, misses and sunk ships. Dressed for the next holiday, like Match (👻 Ghost Fleet now).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FLEET, SEAS, SIZE, TURN_SECONDS, accuracy, anchor, battleRecord, cellsOf, colOf, fits, randomFleet, rowOf, toShips,
  type Battle, type BPlayer, type Fleet, type Placed, type Sea,
} from '../../lib/battle/fleet';
import type { Theme, ThemeId } from '../../lib/memory/themes';
import { batCreate, batFire, batHistory, batJoin, batLeave, batPlace, batRematch, batState } from './account';
import type { GameProps } from './games';
import { Big, Card, Lobby, matchMemory, ME_COLOUR, msg, Notice, Ring, Shell, THEM_COLOUR, themeOf, Waiting, buzz } from './holidayUi';

const POLL_MS = 700;
const { keep, kept } = matchMemory('battle.current');
type BattleProgress = { theme?: ThemeId | 'auto' };

const vw = () => (typeof window !== 'undefined' ? Math.min(window.innerWidth, 520) : 400);

const BattleGame: React.FC<GameProps<BattleProgress>> = ({ progress, save, exit, player, playerId }) => {
  const [themeChoice, setThemeChoice] = useState<ThemeId | 'auto'>(progress?.theme || 'auto');
  const theme = themeOf(themeChoice), sea = SEAS[theme.id];
  useEffect(() => { const was = document.title; document.title = sea.title; return () => { document.title = was; }; }, [sea.title]);
  const me: BPlayer = { id: playerId || '', name: player };

  const [match, setMatch] = useState<Battle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const current = useRef<{ id: string; version: number } | null>(null);

  /** Take the game from the server; drop a late answer about an older game, or an older version of this one. */
  const take = useCallback((m: Battle, sentAt: number, poll = false) => {
    const cur = current.current;
    if (poll && (!cur || m.id !== cur.id)) return;
    if (cur && m.id === cur.id && m.version < cur.version) return;
    current.current = { id: m.id, version: m.version };
    offset.current = Date.parse(m.now) - (sentAt + Date.now()) / 2;
    setMatch(m);
    keep(['waiting', 'placing', 'playing'].includes(m.status) ? m.id : null);
  }, []);
  const call = useCallback(async (f: () => Promise<Battle>, poll = false) => { const t = Date.now(); const m = await f(); take(m, t, poll); return m; }, [take]);

  useEffect(() => { const id = kept(); if (id) call(() => batState(id)).catch(() => keep(null)); }, [call]);
  const id = match?.id, live = match && match.status !== 'expired' && match.status !== 'left';
  useEffect(() => {
    if (!id || !live) return;
    const t = window.setInterval(() => { call(() => batState(id), true).catch(e => setError(msg(e))); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [id, live, call]);

  const toLobby = () => { keep(null); current.current = null; setMatch(null); setError(null); };
  const pickTheme = (t: ThemeId | 'auto') => { setThemeChoice(t); save({ ...(progress || {}), theme: t }); };
  const loadRecord = useCallback(async () => battleRecord(await batHistory(), me.id), [me.id]);
  const leave = async () => { if (match) await batLeave(match.id).catch(() => undefined); toLobby(); };

  if (!playerId) return <Shell theme={theme}><div className="m-auto p-6">Sign in to play.</div></Shell>;
  if (!match) return (
    <Lobby theme={theme} title={sea.title} me={me} themeChoice={themeChoice} pickTheme={pickTheme} error={error} setError={setError} exit={exit}
      blurb="Hide your fleet, then take turns firing at theirs. A hit fires again; a miss is their turn. Sink all five ships to win."
      preview={<MiniPreview sea={sea} />}
      create={async () => { await call(batCreate); }}
      join={async code => { const r = await batJoin(code); if (!r.ok) return r.reason; await call(async () => r.match); return 'ok'; }}
      loadRecord={loadRecord} />
  );
  const them = match.host.id === me.id ? match.guest : match.host;
  if (match.status === 'expired') return <Notice theme={theme} icon="⌛" title="That game ran out of time" sub="Codes last 15 minutes, and fleets have 30 minutes to be placed."><Big theme={theme} onClick={toLobby}>OK</Big></Notice>;
  if (match.status === 'waiting') return <Waiting theme={theme} code={match.code} rematchWith={match.guest && match.guest.id !== me.id ? match.guest.name : null} cancel={leave} />;
  if (match.status === 'left') return <Notice theme={theme} icon="🚪" title={match.left_by === me.id ? 'You left the game' : `${them?.name || 'They'} left the game`}><Big theme={theme} onClick={toLobby}>OK</Big></Notice>;
  if (!them) return null;
  if (match.status === 'placing') return (
    <Placing key={match.id} theme={theme} sea={sea} match={match} them={them} error={error} leave={leave}
      ready={async ships => {
        setError(null);
        try { const r = await batPlace(match.id, ships); await call(async () => r.match); if (!r.ok && r.reason === 'bad_fleet') setError('That fleet isn’t allowed. Try Shuffle.'); }
        catch (e) { setError(msg(e)); }
      }} />
  );
  return (
    <War theme={theme} sea={sea} match={match} me={me} them={them} serverNow={() => Date.now() + offset.current} error={error}
      fire={cell => call(() => batFire(match.id, cell)).then(() => undefined).catch(e => setError(msg(e)))}
      leave={leave} done={toLobby}
      rematch={async () => { try { const r = await batRematch(match.id); if (r.ok) await call(async () => r.match); } catch (e) { setError(msg(e)); } }} />
  );
};

const MiniPreview: React.FC<{ sea: Sea }> = ({ sea }) => (
  <div className="grid grid-cols-5 gap-1 p-2 rounded-xl" style={{ background: sea.water }} aria-hidden>
    {Array.from({ length: 15 }, (_, i) => (
      <div key={i} className="w-7 h-7 rounded flex items-center justify-center text-base"
        style={{ background: [6, 7, 8].includes(i) ? sea.hull : 'rgba(255,255,255,.06)', animation: `mg-pop .3s ease-out ${i * 0.03}s both` }}>
        {i === 7 ? sea.hit : i === 2 || i === 12 ? sea.miss : ''}
      </div>
    ))}
  </div>
);

/** One cell of a grid. */
const Cell: React.FC<{ size: number; sea: Sea; hull?: 'mine' | 'sunk' | 'ghost' | 'preview' | 'bad' | null; mark?: 'hit' | 'miss' | null;
  pop?: boolean; onClick?: () => void; label?: string; active?: boolean; round?: string }> = ({ size, sea, hull, mark, pop, onClick, label, active, round }) => {
  const bg = hull === 'mine' ? sea.hull : hull === 'sunk' ? sea.hull + 'aa' : hull === 'ghost' ? sea.hull + '55' : hull === 'preview' ? '#22c55eaa' : hull === 'bad' ? '#ef4444aa' : 'transparent';
  return (
    <button type="button" onClick={onClick} aria-label={label} tabIndex={onClick ? 0 : -1}
      className="flex items-center justify-center select-none" data-mark={mark || undefined}
      style={{ width: size, height: size, background: bg, borderRadius: round || 0, fontSize: size * 0.62, lineHeight: 1,
        boxShadow: `inset 0 0 0 0.5px ${sea.line}`, cursor: active ? 'crosshair' : 'default', animation: pop ? 'mg-pop .45s ease-out' : undefined }}>
      {mark === 'hit' ? sea.hit : mark === 'miss' ? <span style={{ opacity: 0.55, fontSize: size * 0.45 }}>{sea.miss}</span> : ''}
    </button>
  );
};

/** Which corners of a ship cell are rounded (so ships look like hulls, not squares). */
function hullRound(cell: number, cells: number[]): string {
  const across = cells.length > 1 && cells[1] - cells[0] === 1;
  const first = cell === Math.min(...cells), last = cell === Math.max(...cells);
  const r = '40%';
  if (across) return `${first ? r : 0} ${last ? r : 0} ${last ? r : 0} ${first ? r : 0}`;
  return `${first ? r : 0} ${first ? r : 0} ${last ? r : 0} ${last ? r : 0}`;
}

// ── placing the fleet ──
const Placing: React.FC<{ theme: Theme; sea: Sea; match: Battle; them: BPlayer; error: string | null; leave: () => void; ready: (ships: number[][]) => Promise<void> }> = ({ theme, sea, match, them, error, leave, ready }) => {
  const [fleet, setFleet] = useState<Fleet>(() => randomFleet());
  const [drag, setDrag] = useState<{ i: number; k: number; moved: boolean; at: Placed | null } | null>(null);
  const [nope, setNope] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const grid = useRef<HTMLDivElement | null>(null);
  const size = Math.floor((vw() - 32) / SIZE);
  const locked = match.me_ready;
  const shown: Fleet = locked && match.my_ships ? match.my_ships.map(cells => ({ start: Math.min(...cells), across: cells[1] - cells[0] === 1 })) : fleet;

  const owner = (cell: number) => shown.findIndex((p, i) => p && (cellsOf(p, FLEET[i].len) || []).includes(cell));
  const cellAt = (x: number, y: number) => {
    const r = grid.current?.getBoundingClientRect();
    if (!r) return null;
    const c = Math.floor((x - r.left) / size), rr = Math.floor((y - r.top) / size);
    return c < 0 || rr < 0 || c >= SIZE || rr >= SIZE ? null : rr * SIZE + c;
  };
  const down = (e: React.PointerEvent) => {
    if (locked) return;
    const cell = cellAt(e.clientX, e.clientY); if (cell == null) return;
    const i = owner(cell); if (i < 0) return;
    const p = fleet[i]!;
    const k = (cellsOf(p, FLEET[i].len) || []).indexOf(cell);
    setDrag({ i, k, moved: false, at: null });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const cell = cellAt(e.clientX, e.clientY); if (cell == null) return;
    const p = fleet[drag.i]!;
    const at = { start: anchor(cell, drag.k, p.across), across: p.across };
    if (at.start === p.start && !drag.moved) return;
    setDrag({ ...drag, moved: true, at });
  };
  const up = () => {
    if (!drag) return;
    const { i, moved, at } = drag;
    setDrag(null);
    const p = fleet[i]!;
    if (moved) { if (at && fits(fleet, i, at)) setFleet(f => f.map((q, j) => (j === i ? at : q))); else { setNope(i); window.setTimeout(() => setNope(null), 500); } return; }
    // a tap turns the ship around its first cell
    const turned = { start: p.start, across: !p.across };
    if (fits(fleet, i, turned)) setFleet(f => f.map((q, j) => (j === i ? turned : q))); else { setNope(i); window.setTimeout(() => setNope(null), 500); buzz(30); }
  };

  const preview = drag?.at ? cellsOf(drag.at, FLEET[drag.i].len) : null;
  const previewOk = drag?.at ? fits(fleet, drag.i, drag.at) : false;

  return (
    <Shell theme={theme}>
      <header className="flex items-center gap-2 px-4" style={{ paddingTop: 'max(14px, env(safe-area-inset-top))' }}>
        <button type="button" aria-label="Leave game" onClick={leave} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg">‹</button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-widest text-white/60">{theme.icon} {sea.title}</div>
          <div className="text-xl font-extrabold">{locked ? 'Fleet ready!' : 'Place your fleet'}</div>
        </div>
        <div className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: match.them_ready ? '#16a34a' : 'rgba(255,255,255,.12)' }} data-testid="bt-them-ready">
          {them.name} {match.them_ready ? 'is ready ✓' : 'is placing…'}
        </div>
      </header>
      <div className="px-4 mt-2 text-sm text-white/70">{locked ? `Waiting for ${them.name}…` : 'Drag a ship to move it. Tap it to turn it.'}</div>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-3">
        <div ref={grid} className="grid rounded-lg overflow-hidden" data-testid="bt-place-grid"
          style={{ gridTemplateColumns: `repeat(${SIZE}, ${size}px)`, background: sea.water, touchAction: 'none', boxShadow: `0 0 0 2px ${sea.line}` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          {Array.from({ length: SIZE * SIZE }, (_, c) => {
            const i = owner(c);
            const cells = i >= 0 ? cellsOf(shown[i]!, FLEET[i].len)! : [];
            const inPreview = preview?.includes(c);
            const hull = inPreview ? (previewOk ? 'preview' : 'bad') : i >= 0 && !(drag?.moved && drag.i === i) ? (nope === i ? 'bad' : 'mine') : null;
            return <Cell key={c} size={size} sea={sea} hull={hull} round={i >= 0 && !inPreview ? hullRound(c, cells) : undefined} label={`Square ${rowOf(c) + 1}-${colOf(c) + 1}`} />;
          })}
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs text-white/80">
          {FLEET.map(s => <span key={s.name} className="px-2 py-1 rounded-full bg-white/10">{s.name} {'■'.repeat(s.len)}</span>)}
        </div>
        {!locked && (
          <div className="w-full max-w-sm grid grid-cols-2 gap-2">
            <Big theme={theme} light onClick={() => setFleet(randomFleet())}>🎲 Shuffle</Big>
            <Big theme={theme} disabled={sending || !toShips(fleet)} onClick={async () => { const s = toShips(fleet); if (!s) return; setSending(true); await ready(s); setSending(false); }}>Ready</Big>
          </div>
        )}
        {error && <div className="text-sm text-red-200">{error}</div>}
      </div>
    </Shell>
  );
};

// ── the battle ──
const War: React.FC<{ theme: Theme; sea: Sea; match: Battle; me: BPlayer; them: BPlayer; serverNow: () => number; error: string | null;
  fire: (cell: number) => Promise<void>; leave: () => void; done: () => void; rematch: () => void }> = ({ theme, sea, match, me, them, serverNow, error, fire, leave, done, rematch }) => {
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = window.setInterval(() => setNow(serverNow()), 250); return () => window.clearInterval(t); }, [serverNow]);
  const [busy, setBusy] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const over = match.status === 'done';
  const myTurn = match.status === 'playing' && match.turn === me.id;
  const secs = match.turn_deadline ? Math.max(0, Math.ceil((Date.parse(match.turn_deadline) - now) / 1000)) : null;

  // buzz and a message for the latest shot
  const seen = useRef(match.version);
  const [news, setNews] = useState<string | null>(null);
  useEffect(() => {
    if (match.version === seen.current) return;
    seen.current = match.version;
    const l = match.last; if (!l) return;
    const mine = l.by === me.id;
    if (l.timeout) { setNews(mine ? 'Out of time! Their turn.' : `${them.name} ran out of time. Your turn!`); return; }
    if (l.sunk) { const name = FLEET[l.sunk.i].name; setNews(mine ? `${sea.sunk} You sank ${them.name}’s ${name}!` : `${sea.sunk} ${them.name} sank your ${name}!`); buzz(mine ? [60, 40, 120] : [150, 60, 150]); return; }
    if (l.hit) { setNews(mine ? `${sea.hit} Hit! Fire again.` : `${sea.hit} ${them.name} hit you!`); buzz(mine ? 60 : [80, 40, 80]); return; }
    setNews(mine ? `${sea.miss} Miss. ${them.name}’s turn.` : `${sea.miss} ${them.name} missed. Your turn!`);
  }, [match.version, match.last, me.id, them.name, sea]);

  const shoot = async (c: number) => {
    if (!myTurn || busy || match.my_shots.some(s => s.c === c)) return;
    setBusy(true); await fire(c); setBusy(false);
  };

  const big = Math.floor((vw() - 24) / SIZE), small = Math.max(14, Math.floor(big * 0.5));
  const myShot = new Map(match.my_shots.map(s => [s.c, s.hit]));
  const theirShot = new Map(match.their_shots.map(s => [s.c, s.hit]));
  const theirSunkCells = new Map<number, number[]>(); match.their_sunk.forEach(s => s.cells.forEach(c => theirSunkCells.set(c, s.cells)));
  const theirAll = new Map<number, number[]>(); (match.their_ships || []).forEach(cells => cells.forEach(c => theirAll.set(c, cells)));
  const myCells = new Map<number, number[]>(); (match.my_ships || []).forEach(cells => cells.forEach(c => myCells.set(c, cells)));
  const lastC = match.last?.c, lastMine = match.last?.by === me.id;
  const mySunk = new Set(match.my_sunk.map(s => s.i)), theirSunk = new Set(match.their_sunk.map(s => s.i));
  const iWon = match.winner === me.id;
  const a = accuracy(match.my_shots), b = accuracy(match.their_shots);

  return (
    <Shell theme={theme}>
      <header className="px-3" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Leave game" onClick={() => (over ? done() : setAskLeave(true))} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg shrink-0">‹</button>
          <div className="flex-1 text-center">
            <div className="text-[11px] uppercase tracking-widest text-white/60">{theme.icon} {sea.title}</div>
            <div className="text-sm font-extrabold" data-testid="bt-turn" data-mine={myTurn ? '1' : '0'} aria-live="polite">
              {over ? (iWon ? 'Victory!' : 'Defeated') : myTurn ? <span style={{ color: ME_COLOUR }}>Your turn: fire!</span> : <span style={{ color: THEM_COLOUR }}>{them.name} is aiming…</span>}
            </div>
          </div>
          {!over ? <Ring secs={secs} of={TURN_SECONDS} colour={myTurn ? ME_COLOUR : THEM_COLOUR} label="" /> : <div className="w-10" />}
        </div>
        <div className="flex items-center justify-between mt-1 text-xs">
          <Fleetline label="You" colour={ME_COLOUR} sunk={mySunk} />
          <Fleetline label={them.name} colour={THEM_COLOUR} sunk={theirSunk} right />
        </div>
        <div className="h-6 text-center text-sm font-bold mt-1" data-testid="bt-news">{news}</div>
      </header>

      <main className="flex-1 flex flex-col items-center gap-2 px-3 pb-3">
        <div className="text-[11px] uppercase tracking-widest text-white/60 self-start ml-1">{them.name}’s waters</div>
        <div className="grid rounded-lg overflow-hidden" data-testid="bt-target"
          style={{ gridTemplateColumns: `repeat(${SIZE}, ${big}px)`, background: sea.water, boxShadow: myTurn ? `0 0 0 3px ${ME_COLOUR}, 0 0 24px ${ME_COLOUR}55` : `0 0 0 2px ${sea.line}`, transition: 'box-shadow .3s' }}>
          {Array.from({ length: SIZE * SIZE }, (_, c) => {
            const shot = myShot.get(c);
            const sunk = theirSunkCells.get(c), revealed = theirAll.get(c);
            return <Cell key={c} size={big} sea={sea} mark={shot === undefined ? null : shot ? 'hit' : 'miss'} pop={lastMine && lastC === c}
              hull={sunk ? 'sunk' : revealed ? 'ghost' : null} round={sunk ? hullRound(c, sunk) : revealed ? hullRound(c, revealed) : undefined}
              active={myTurn && shot === undefined} onClick={myTurn && shot === undefined ? () => shoot(c) : undefined}
              label={`Target ${rowOf(c) + 1}-${colOf(c) + 1}${shot === undefined ? '' : shot ? ', hit' : ', miss'}`} />;
          })}
        </div>
        <div className="flex items-end gap-3 w-full justify-center">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/60 mb-1">Your fleet</div>
            <div className="grid rounded-md overflow-hidden" data-testid="bt-mine" style={{ gridTemplateColumns: `repeat(${SIZE}, ${small}px)`, background: sea.water, boxShadow: `0 0 0 1px ${sea.line}` }}>
              {Array.from({ length: SIZE * SIZE }, (_, c) => {
                const shot = theirShot.get(c), cells = myCells.get(c);
                return <Cell key={c} size={small} sea={sea} hull={cells ? 'mine' : null} round={cells ? hullRound(c, cells) : undefined}
                  mark={shot === undefined ? null : shot ? 'hit' : 'miss'} pop={!lastMine && lastC === c} />;
              })}
            </div>
          </div>
          <div className="text-xs text-white/75 space-y-1 pb-1">
            <div><b className="text-white">{a.hits}</b>/{a.shots} hits ({a.pct}%)</div>
            <div style={{ color: THEM_COLOUR }}>{them.name}: <b>{b.hits}</b>/{b.shots}</div>
          </div>
        </div>
        {error && <div className="text-sm text-red-200">{error}</div>}
      </main>

      {over && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-4" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.85) 30%)' }}>
          <div className="max-w-sm mx-auto text-center">
            <div className="text-5xl">{iWon ? '🏆' : sea.sunk}</div>
            <div className="text-3xl font-black" aria-label="Winner">{iWon ? 'You win!' : `${them.name} wins`}</div>
            <div className="text-sm text-white/75">You hit {a.hits} of {a.shots} ({a.pct}%) · {them.name} hit {b.hits} of {b.shots} ({b.pct}%)</div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Big theme={theme} onClick={rematch}>{match.next_match ? 'Rematch! (they’re ready)' : 'Rematch'}</Big>
              <Big theme={theme} light onClick={done}>Done</Big>
            </div>
          </div>
        </div>
      )}
      {askLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.6)' }}>
          <Card>
            <div className="text-xl font-extrabold">Leave the game?</div>
            <div className="text-sm text-white/70 mt-1">It ends for both of you and doesn’t count.</div>
            <div className="mt-5 grid gap-2">
              <Big theme={theme} onClick={leave}>Leave</Big>
              <Big theme={theme} light onClick={() => setAskLeave(false)}>Stay</Big>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
};

/** Ships still afloat, as little hull bars (crossed out once sunk). */
const Fleetline: React.FC<{ label: string; colour: string; sunk: Set<number>; right?: boolean }> = ({ label, colour, sunk, right }) => (
  <div className={`flex items-center gap-1.5 ${right ? 'flex-row-reverse' : ''}`} aria-label={`${label}: ${5 - sunk.size} ships left`}>
    <b style={{ color: colour }}>{label}</b>
    {FLEET.map((s, i) => (
      <span key={i} title={s.name} className="relative inline-block rounded-full" style={{ width: s.len * 5, height: 6, background: sunk.has(i) ? 'rgba(255,255,255,.18)' : colour }} />
    ))}
  </div>
);

export default BattleGame;
