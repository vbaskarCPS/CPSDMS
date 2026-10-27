// src/pages/Minigame/MatchGame.tsx — Match (/minigame/match): the memory card game, two players
// taking turns on one shared board, each on their own phone. Flip two cards a turn: a pair is
// yours and you go again; a miss flips back and it's their turn. Best of 3 boards (8, 12, 15 pairs).
// The server (minigame_memory_* functions) holds the cards and only shows a picture once it's
// flipped; this phone checks in about twice a second to show the other player's flips.
// It dresses up for the next big holiday (src/lib/memory/themes.ts); a grown-up can pick another.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { columnsFor, memRecord, mine, pairsNow, standing, TURN_SECONDS, type MemCard, type MemMatch, type MemPlayer } from '../../lib/memory/match';
import { currentTheme, THEMES, type Theme, type ThemeId } from '../../lib/memory/themes';
import { memCreate, memFlip, memHistory, memJoin, memLeave, memRematch, memState } from './account';
import type { GameProps } from './games';

const POLL_MS = 500;
const KEEP = 'match.current';
const keep = (id: string | null) => { try { if (id) sessionStorage.setItem(KEEP, id); else sessionStorage.removeItem(KEEP); } catch { /* ignore */ } };
const kept = () => { try { return sessionStorage.getItem(KEEP); } catch { return null; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* ignore */ } };
const ME_COLOUR = '#38bdf8', THEM_COLOUR = '#fb923c';

type MatchProgress = { theme?: ThemeId | 'auto' };

const CSS = `
  @keyframes mg-float { 0% { transform: translateY(110vh) translateX(0) rotate(0) } 50% { transform: translateY(50vh) translateX(30px) rotate(12deg) } 100% { transform: translateY(-15vh) translateX(-10px) rotate(-8deg) } }
  @keyframes mg-pop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }
  @keyframes mg-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
  @keyframes mg-glow { 0%,100% { box-shadow: 0 0 0 0 var(--glow) } 50% { box-shadow: 0 0 22px 4px var(--glow) } }
  @keyframes mg-in { 0% { transform: translateY(14px); opacity: 0 } 100% { transform: none; opacity: 1 } }
  .mg-card { perspective: 700px; }
  .mg-inner { position: relative; width: 100%; height: 100%; transition: transform .35s ease; transform-style: preserve-3d; }
  .mg-up .mg-inner { transform: rotateY(180deg); }
  .mg-side { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 14px; display: flex; align-items: center; justify-content: center; }
  .mg-face { transform: rotateY(180deg); }
`;

/** Things drifting up the background: bats for Halloween, snow for Christmas, and so on. */
const Floaters: React.FC<{ theme: Theme }> = ({ theme }) => {
  const items = useMemo(() => Array.from({ length: 10 }, (_, i) => ({
    ch: theme.floaters[i % theme.floaters.length], left: (i * 37) % 100, size: 18 + ((i * 13) % 22), dur: 14 + ((i * 7) % 12), delay: -((i * 5) % 20),
  })), [theme]);
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {items.map((f, i) => (
        <span key={i} className="absolute" style={{ left: `${f.left}%`, top: 0, fontSize: f.size, opacity: 0.22, animation: `mg-float ${f.dur}s linear ${f.delay}s infinite` }}>{f.ch}</span>
      ))}
    </div>
  );
};

const Shell: React.FC<{ theme: Theme; children: React.ReactNode }> = ({ theme, children }) => (
  <div className="min-h-screen w-full overflow-hidden select-none text-white flex flex-col relative" style={{ background: theme.bg, fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
    <style>{CSS}</style>
    <Floaters theme={theme} />
    <div className="relative flex-1 flex flex-col">{children}</div>
  </div>
);
const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full max-w-sm rounded-3xl bg-black/55 backdrop-blur border border-white/15 p-6 text-center shadow-2xl" style={{ animation: 'mg-in .25s ease-out' }}>{children}</div>
);
const Big: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; light?: boolean; theme: Theme }> = ({ onClick, children, disabled, light, theme }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className="w-full py-3 rounded-2xl font-extrabold text-lg disabled:opacity-50 hover:brightness-110"
    style={light ? { background: 'rgba(255,255,255,.12)', color: '#fff' } : { background: theme.accent, color: '#1a0b02' }}>{children}</button>
);

const MatchGame: React.FC<GameProps<MatchProgress>> = ({ progress, save, exit, player, playerId }) => {
  const [themeChoice, setThemeChoice] = useState<ThemeId | 'auto'>(progress?.theme || 'auto');
  const theme = themeChoice === 'auto' ? currentTheme() : THEMES[themeChoice];
  useEffect(() => { const was = document.title; document.title = theme.title; return () => { document.title = was; }; }, [theme.title]);
  const me: MemPlayer = { id: playerId || '', name: player };

  const [match, setMatch] = useState<MemMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const current = useRef<{ id: string; version: number } | null>(null);

  /** Take the match from the server. A late answer about an older match, or an older version of
   *  this one (a check-in that crossed with a flip), is dropped. */
  const take = useCallback((m: MemMatch, sentAt: number, poll = false) => {
    const cur = current.current;
    if (poll && (!cur || m.id !== cur.id)) return;
    if (cur && m.id === cur.id && m.version < cur.version) return;
    current.current = { id: m.id, version: m.version };
    offset.current = Date.parse(m.now) - (sentAt + Date.now()) / 2;
    setMatch(m);
    keep(m.status === 'waiting' || m.status === 'playing' ? m.id : null);
  }, []);
  const call = useCallback(async (f: () => Promise<MemMatch>, poll = false) => { const t = Date.now(); const m = await f(); take(m, t, poll); return m; }, [take]);

  useEffect(() => { const id = kept(); if (id) call(() => memState(id)).catch(() => keep(null)); }, [call]);

  const id = match?.id, live = match && match.status !== 'expired' && match.status !== 'left';
  useEffect(() => {
    if (!id || !live) return;
    const t = window.setInterval(() => { call(() => memState(id), true).catch(e => setError(msg(e))); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [id, live, call]);

  const toLobby = () => { keep(null); current.current = null; setMatch(null); setError(null); };
  const pickTheme = (t: ThemeId | 'auto') => { setThemeChoice(t); save({ ...(progress || {}), theme: t }); };

  if (!playerId) return <Shell theme={theme}><div className="m-auto p-6">Sign in to play.</div></Shell>;
  if (!match) return <Lobby theme={theme} themeChoice={themeChoice} pickTheme={pickTheme} me={me} error={error} setError={setError} exit={exit} onMatch={m => call(async () => m)} />;
  const them = match.host.id === me.id ? match.guest : match.host;

  if (match.status === 'expired') return (
    <Shell theme={theme}><div className="flex-1 flex items-center justify-center p-6"><Card>
      <div className="text-4xl">⌛</div><div className="text-xl font-extrabold mt-2">That code ran out of time</div>
      <div className="text-sm text-white/70 mt-1">Codes last 15 minutes. Make a new one.</div>
      <div className="mt-5"><Big theme={theme} onClick={toLobby}>OK</Big></div>
    </Card></div></Shell>);
  if (match.status === 'waiting') return (
    <Shell theme={theme}><div className="flex-1 flex items-center justify-center p-6"><Card>
      {match.guest && match.guest.id !== me.id ? (
        <><div className="text-4xl">🔁</div><div className="text-xl font-extrabold mt-2">Waiting for {match.guest.name}</div>
          <div className="text-sm text-white/70 mt-1">They need to tap <b>Rematch</b> too.</div></>
      ) : (
        <><div className="text-sm uppercase tracking-widest text-white/70">Your code</div>
          <div className="text-6xl font-black tracking-[.2em] mt-2" style={{ color: theme.accent }} aria-label="Match code">{match.code}</div>
          <div className="text-sm text-white/70 mt-3">The other player taps <b>Join</b> and types this in.</div>
          <div className="mt-4 text-white/70 animate-pulse">Waiting for someone to join…</div></>
      )}
      <div className="mt-5"><Big theme={theme} light onClick={async () => { await memLeave(match.id).catch(() => undefined); toLobby(); }}>Cancel</Big></div>
    </Card></div></Shell>);
  if (match.status === 'left') return (
    <Shell theme={theme}><div className="flex-1 flex items-center justify-center p-6"><Card>
      <div className="text-4xl">🚪</div>
      <div className="text-xl font-extrabold mt-2">{match.left_by === me.id ? 'You left the match' : `${them?.name || 'They'} left the match`}</div>
      <div className="mt-5"><Big theme={theme} onClick={toLobby}>OK</Big></div>
    </Card></div></Shell>);
  if (!them) return null;
  return (
    <Table theme={theme} match={match} me={me} them={them} serverNow={() => Date.now() + offset.current} error={error}
      flip={card => call(() => memFlip(match.id, card)).then(() => undefined).catch(e => setError(msg(e)))}
      leave={async () => { await memLeave(match.id).catch(() => undefined); toLobby(); }}
      rematch={async () => {
        try { const r = await memRematch(match.id); if (r.ok) await call(async () => r.match); } catch (e) { setError(msg(e)); }
      }}
      done={toLobby} />
  );
};

// ── the lobby ──
const Lobby: React.FC<{ theme: Theme; themeChoice: ThemeId | 'auto'; pickTheme: (t: ThemeId | 'auto') => void; me: MemPlayer; error: string | null;
  setError: (e: string | null) => void; exit: () => void; onMatch: (m: MemMatch) => void }> = ({ theme, themeChoice, pickTheme, me, error, setError, exit, onMatch }) => {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<ReturnType<typeof memRecord> | null>(null);
  useEffect(() => { memHistory().then(h => setRecord(memRecord(h, me.id))).catch(() => setRecord([])); }, [me.id]);

  const create = async () => { setBusy(true); setError(null); try { onMatch(await memCreate()); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  const join = async () => {
    if (code.length !== 4) return;
    setBusy(true); setError(null);
    try {
      const r = await memJoin(code);
      if (r.ok) onMatch(r.match);
      else setError(r.reason === 'own_match' ? 'That’s your own code. The other player types it in.' : 'No match with that code. Check the letters.');
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Shell theme={theme}>
      <header className="flex items-center gap-2 px-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <button type="button" aria-label="Back to games" onClick={exit} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl">‹</button>
        <div className="text-2xl font-extrabold tracking-tight">{theme.icon} {theme.title}</div>
      </header>
      <div className="flex-1 flex flex-col items-center px-6 py-6 gap-4 max-w-sm w-full mx-auto">
        <div className="grid grid-cols-4 gap-2 w-40" aria-hidden>
          {theme.pics.slice(0, 4).map((p, i) => (
            <div key={i} className="aspect-[3/4] rounded-xl flex items-center justify-center text-2xl" style={{ background: i % 2 ? theme.back : 'rgba(255,255,255,.92)', animation: `mg-pop .4s ease-out ${i * 0.08}s both` }}>{i % 2 ? theme.backIcon : p}</div>
          ))}
        </div>
        <div className="text-sm text-white/75 text-center">Take turns flipping two cards. Find a pair and it’s yours, and you go again. Miss and it’s their turn. Best of 3 boards.</div>
        {!joining ? (
          <>
            <Big theme={theme} onClick={create} disabled={busy}>Create a match</Big>
            <Big theme={theme} light onClick={() => { setJoining(true); setError(null); }}>Join with a code</Big>
          </>
        ) : (
          <>
            <input value={code} autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} aria-label="Code"
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') join(); }}
              placeholder="ABCD" className="w-full text-center text-5xl font-black tracking-[.25em] rounded-2xl py-3 bg-white/10 border border-white/20 outline-none placeholder:text-white/20" />
            <Big theme={theme} onClick={join} disabled={busy || code.length !== 4}>Join</Big>
            <button type="button" onClick={() => { setJoining(false); setCode(''); setError(null); }} className="text-sm text-white/70 underline">Back</button>
          </>
        )}
        {error && <div className="text-sm text-red-200 text-center">{error}</div>}
        <div className="w-full mt-2">
          <div className="text-xs uppercase tracking-widest text-white/60">Head to head</div>
          <div className="mt-2 rounded-2xl bg-white/10 divide-y divide-white/10">
            {record === null && <div className="p-3 text-white/60 animate-pulse text-sm">Loading…</div>}
            {record?.length === 0 && <div className="p-3 text-white/60 text-sm">No matches yet.</div>}
            {record?.map(r => (
              <div key={r.id} className="p-3 flex items-center justify-between">
                <div className="font-bold">{me.name} vs {r.name}</div>
                <div className="font-extrabold text-lg" aria-label={`Record against ${r.name}`}>{r.won} – {r.lost}{r.drawn ? <span className="text-sm text-white/60"> ({r.drawn} tied)</span> : null}</div>
              </div>
            ))}
          </div>
        </div>
        <label className="w-full flex items-center justify-between text-sm text-white/70 mt-2">Theme
          <select value={themeChoice} onChange={e => pickTheme(e.target.value as ThemeId | 'auto')} aria-label="Theme"
            className="rounded-lg px-2 py-1.5 text-sm" style={{ background: '#fff', color: '#111827' }}>
            <option value="auto">Next holiday ({currentTheme().name})</option>
            {Object.values(THEMES).map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
          </select>
        </label>
      </div>
    </Shell>
  );
};

// ── the board ──
const Table: React.FC<{ theme: Theme; match: MemMatch; me: MemPlayer; them: MemPlayer; serverNow: () => number; error: string | null;
  flip: (card: number) => Promise<void>; leave: () => void; rematch: () => void; done: () => void }> = ({ theme, match, me, them, serverNow, error, flip, leave, rematch, done }) => {
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = window.setInterval(() => setNow(serverNow()), 200); return () => window.clearInterval(t); }, [serverNow]);
  const [busy, setBusy] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const iAmHost = match.host.id === me.id;
  const mySide = iAmHost ? 1 : 2;
  const myTurn = match.status === 'playing' && match.turn === me.id;
  const pause = match.pause_until ? Date.parse(match.pause_until) : 0;
  const counting = match.status === 'playing' && now < pause;
  const deadline = match.turn_deadline ? Date.parse(match.turn_deadline) : now;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const missing = match.second_pick != null;
  const canFlip = myTurn && !counting && !missing && !busy;

  // a little buzz and a pop when a pair is found (by either player), a wobble on a miss
  const [popped, setPopped] = useState<number[]>([]);
  const lastSeen = useRef(match.version);
  useEffect(() => {
    if (match.version === lastSeen.current) return;
    lastSeen.current = match.version;
    const l = match.last;
    if (l && l.match && l.a != null && l.b != null) { setPopped([l.a, l.b]); buzz(l.by === me.id ? 50 : 20); window.setTimeout(() => setPopped([]), 700); }
    else if (l && l.match === false && l.by === me.id) buzz([20, 40, 20]);
  }, [match.version, match.last, me.id]);

  const tap = async (k: number, c: MemCard) => {
    if (!canFlip || c.owner !== 0 || k === match.first_pick) return;
    setBusy(true);
    await flip(k);
    setBusy(false);
  };

  const [pm, pt] = mine(pairsNow(match.cards), iAmHost);
  const st = standing(match.boards);
  const [wm, wt] = mine(st.wins, iAmHost);
  const cols = columnsFor(match.cards.length), rows = Math.ceil(match.cards.length / cols);
  // fit the grid on screen: about 250px of header above, a little room below
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400, vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardW = Math.floor(Math.min((Math.min(vw, 560) - 24 - (cols - 1) * 8) / cols, ((vh - 250) / rows - 8) * 0.75));
  const prevBoard = match.boards[match.board_no - 1];

  if (match.status === 'done') {
    const [pairsM, pairsT] = mine(st.pairs, iAmHost);
    const won = st.leader !== null && (st.leader === 0) === iAmHost, lost = st.leader !== null && !won;
    return (
      <Shell theme={theme}>
        <div className="flex-1 flex flex-col items-center px-4 py-6 max-w-md w-full mx-auto" style={{ paddingTop: 'max(24px, env(safe-area-inset-top))' }}>
          <div className="text-6xl">{won ? '🏆' : lost ? theme.icon : '🤝'}</div>
          <div className="text-3xl font-black mt-2" aria-label="Winner">{won ? 'You win!' : lost ? `${them.name} wins` : 'A tie!'}</div>
          <div className="text-xl font-extrabold mt-1">{me.name} {wm} – {wt} {them.name} <span className="text-sm text-white/60">boards</span></div>
          {wm === wt && st.leader !== null && <div className="text-xs text-white/70">Level on boards; more pairs wins ({pairsM} vs {pairsT}).</div>}
          <table className="w-full mt-5 text-sm text-left rounded-2xl overflow-hidden bg-black/30">
            <thead><tr className="text-xs text-white/60"><th className="py-1.5 px-3">Board</th><th className="py-1.5 px-3">{me.name}</th><th className="py-1.5 px-3">{them.name}</th></tr></thead>
            <tbody>{match.boards.map((b, i) => { const [a, c] = mine([b.host, b.guest], iAmHost); return (
              <tr key={i} className="border-t border-white/10"><td className="py-1.5 px-3 font-bold">{i + 1} <span className="text-white/50 font-normal">({match.sizes[i]} pairs)</span></td>
                <td className="py-1.5 px-3" style={{ fontWeight: a > c ? 900 : 400 }}>{a}{a > c ? ' ✓' : ''}</td><td className="py-1.5 px-3" style={{ fontWeight: c > a ? 900 : 400 }}>{c}{c > a ? ' ✓' : ''}</td></tr>); })}</tbody>
          </table>
          <div className="w-full grid gap-2 mt-6">
            <Big theme={theme} onClick={rematch}>{match.next_match ? 'Rematch! (they’re ready)' : 'Rematch'}</Big>
            <Big theme={theme} light onClick={done}>Done</Big>
          </div>
          {error && <div className="text-sm text-red-200 mt-2">{error}</div>}
        </div>
      </Shell>
    );
  }

  return (
    <Shell theme={theme}>
      <header className="px-3" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Leave match" onClick={() => setAskLeave(true)} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg shrink-0">‹</button>
          <div className="flex-1 text-center">
            <div className="text-[11px] uppercase tracking-widest text-white/60">{theme.title}</div>
            <div className="font-extrabold" data-testid="mg-board" data-board={match.board_no}>Board {match.board_no + 1} of {match.sizes.length}</div>
          </div>
          <div className="w-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Side name="You" colour={ME_COLOUR} pairs={pm} boards={wm} active={myTurn && !counting} secs={myTurn && !counting && !missing ? left : null} testid="mg-me" />
          <Side name={them.name} colour={THEM_COLOUR} pairs={pt} boards={wt} active={!myTurn && !counting} secs={!myTurn && !counting && !missing ? left : null} testid="mg-them" />
        </div>
        <div className="text-center mt-2 h-7 font-extrabold text-lg" aria-live="polite" data-testid="mg-turn" data-mine={myTurn && !counting && !missing ? '1' : '0'}>
          {counting ? '' : missing ? (match.last?.by === me.id ? 'No match…' : `${them.name} missed!`) : myTurn ? <span style={{ color: ME_COLOUR }}>Your turn: flip {match.first_pick == null ? 'a card' : 'another'}</span> : <span style={{ color: THEM_COLOUR }}>{them.name}’s turn…</span>}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-3 pb-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, ${cardW}px)` }}>
          {match.cards.map((c, k) => {
            const up = c.face != null;
            const ownerColour = c.owner === mySide ? ME_COLOUR : c.owner ? THEM_COLOUR : null;
            const isMiss = missing && (k === match.first_pick || k === match.second_pick);
            return (
              <button key={`${match.board_no}-${k}`} type="button" aria-label={`Card ${k + 1}${up ? `, ${theme.pics[c.face as number]}` : ''}`} onClick={() => tap(k, c)}
                className={`mg-card ${up ? 'mg-up' : ''}`} style={{ width: cardW, height: Math.round(cardW * 4 / 3), cursor: canFlip && !up ? 'pointer' : 'default',
                  animation: popped.includes(k) ? 'mg-pop .5s ease-out' : isMiss ? 'mg-shake .4s ease-in-out .35s' : undefined }}>
                <div className="mg-inner">
                  <div className="mg-side" style={{ background: theme.back, boxShadow: 'inset 0 0 0 3px rgba(255,255,255,.25), 0 3px 8px rgba(0,0,0,.35)', fontSize: cardW * 0.42, opacity: canFlip ? 1 : 0.85 }}>{theme.backIcon}</div>
                  <div className="mg-side mg-face" style={{ background: c.owner ? 'rgba(255,255,255,.88)' : '#fff', fontSize: cardW * 0.55,
                    boxShadow: ownerColour ? `inset 0 0 0 4px ${ownerColour}` : isMiss ? 'inset 0 0 0 4px #ef4444' : '0 3px 8px rgba(0,0,0,.35)', opacity: c.owner ? 0.9 : 1 }}>
                    {up ? theme.pics[c.face as number] : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </main>

      {counting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.55)' }}>
          <Card>
            {prevBoard && (() => { const [a, c] = mine([prevBoard.host, prevBoard.guest], iAmHost); return (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-widest text-white/60">Board {match.board_no} result</div>
                <div className="text-2xl font-black mt-1">{a > c ? 'You won it!' : c > a ? `${them.name} won it` : 'A tie board'}</div>
                <div className="text-lg font-extrabold">You {a} – {c} {them.name}</div>
              </div>); })()}
            <div className="text-white/70 font-bold">Board {match.board_no + 1} · {match.sizes[match.board_no]} pairs</div>
            <div className="text-xl font-extrabold mt-1" style={{ color: myTurn ? ME_COLOUR : THEM_COLOUR }}>{myTurn ? 'You go first' : `${them.name} goes first`}</div>
            <div className="text-7xl font-black mt-2" style={{ color: theme.accent }}>{Math.max(1, Math.ceil((pause - now) / 1000))}</div>
          </Card>
        </div>
      )}
      {askLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.6)' }}>
          <Card>
            <div className="text-xl font-extrabold">Leave the match?</div>
            <div className="text-sm text-white/70 mt-1">It ends for both of you and doesn’t count.</div>
            <div className="mt-5 grid gap-2">
              <Big theme={theme} onClick={leave}>Leave</Big>
              <Big theme={theme} light onClick={() => setAskLeave(false)}>Stay</Big>
            </div>
          </Card>
        </div>
      )}
      {error && <div className="fixed bottom-3 inset-x-0 text-center text-sm text-red-200">{error}</div>}
    </Shell>
  );
};

/** One player's corner: pairs on this board, boards won, and the turn clock when it's theirs. */
const Side: React.FC<{ name: string; colour: string; pairs: number; boards: number; active: boolean; secs: number | null; testid: string }> = ({ name, colour, pairs, boards, active, secs, testid }) => (
  <div className="rounded-2xl px-3 py-2 flex items-center gap-3 transition-all" data-testid={testid}
    style={{ background: active ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.25)', ['--glow' as string]: colour + '88', animation: active ? 'mg-glow 1.6s ease-in-out infinite' : undefined, border: `2px solid ${active ? colour : 'transparent'}` }}>
    <div className="relative w-10 h-10 shrink-0">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="4" />
        {secs != null && <circle cx="20" cy="20" r="17" fill="none" stroke={secs <= 5 ? '#ef4444' : colour} strokeWidth="4" strokeDasharray="106.8" style={{ strokeDashoffset: 106.8 * (1 - secs / TURN_SECONDS), transition: 'stroke-dashoffset .3s linear' }} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-black" style={{ color: colour }}>{secs != null ? secs : name.slice(0, 1).toUpperCase()}</div>
    </div>
    <div className="min-w-0">
      <div className="text-sm font-bold truncate" style={{ color: colour }}>{name}</div>
      <div className="text-xs text-white/75"><b className="text-lg text-white" aria-label={`${name} pairs`}>{pairs}</b> pairs · {'●'.repeat(boards)}{'○'.repeat(Math.max(0, 2 - boards))}</div>
    </div>
  </div>
);

export default MatchGame;
