// src/pages/Minigame/holidayUi.tsx — the pieces the two-player holiday games share (Match, Battleship):
// the themed background with things drifting up it, cards and buttons, the lobby (create a match,
// join with a code, the head-to-head record, the theme picker) and small helpers.
import React, { useEffect, useMemo, useState } from 'react';
import { currentTheme, THEMES, type Theme, type ThemeId } from '../../lib/memory/themes';

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* ignore */ } };
export const ME_COLOUR = '#38bdf8', THEM_COLOUR = '#fb923c';

/** Remember (for this tab) which match we're in, so a reload picks it up again. */
export function matchMemory(key: string) {
  return {
    keep: (id: string | null) => { try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* ignore */ } },
    kept: () => { try { return sessionStorage.getItem(key); } catch { return null; } },
  };
}

/** The theme a player picked, or the next holiday's. */
export const themeOf = (choice: ThemeId | 'auto' | undefined) => (!choice || choice === 'auto' ? currentTheme() : THEMES[choice]);

const BASE_CSS = `
  @keyframes mg-float { 0% { transform: translateY(110vh) translateX(0) rotate(0) } 50% { transform: translateY(50vh) translateX(30px) rotate(12deg) } 100% { transform: translateY(-15vh) translateX(-10px) rotate(-8deg) } }
  @keyframes mg-pop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }
  @keyframes mg-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
  @keyframes mg-glow { 0%,100% { box-shadow: 0 0 0 0 var(--glow) } 50% { box-shadow: 0 0 22px 4px var(--glow) } }
  @keyframes mg-in { 0% { transform: translateY(14px); opacity: 0 } 100% { transform: none; opacity: 1 } }
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

export const Shell: React.FC<{ theme: Theme; css?: string; children: React.ReactNode }> = ({ theme, css, children }) => (
  <div className="min-h-screen w-full overflow-hidden select-none text-white flex flex-col relative" style={{ background: theme.bg, fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
    <style>{BASE_CSS + (css || '')}</style>
    <Floaters theme={theme} />
    <div className="relative flex-1 flex flex-col">{children}</div>
  </div>
);
export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full max-w-sm rounded-3xl bg-black/55 backdrop-blur border border-white/15 p-6 text-center shadow-2xl" style={{ animation: 'mg-in .25s ease-out' }}>{children}</div>
);
export const Big: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; light?: boolean; theme: Theme }> = ({ onClick, children, disabled, light, theme }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className="w-full py-3 rounded-2xl font-extrabold text-lg disabled:opacity-50 hover:brightness-110"
    style={light ? { background: 'rgba(255,255,255,.12)', color: '#fff' } : { background: theme.accent, color: '#1a0b02' }}>{children}</button>
);
/** A full-screen message with one or two buttons. */
export const Notice: React.FC<{ theme: Theme; icon: string; title: string; sub?: React.ReactNode; children?: React.ReactNode }> = ({ theme, icon, title, sub, children }) => (
  <Shell theme={theme}><div className="flex-1 flex items-center justify-center p-6"><Card>
    <div className="text-4xl">{icon}</div><div className="text-xl font-extrabold mt-2">{title}</div>
    {sub && <div className="text-sm text-white/70 mt-1">{sub}</div>}
    <div className="mt-5 grid gap-2">{children}</div>
  </Card></div></Shell>
);

/** The countdown ring for whoever's turn it is. */
export const Ring: React.FC<{ secs: number | null; of: number; colour: string; label: string }> = ({ secs, of, colour, label }) => (
  <div className="relative w-10 h-10 shrink-0">
    <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
      <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="4" />
      {secs != null && <circle cx="20" cy="20" r="17" fill="none" stroke={secs <= 5 ? '#ef4444' : colour} strokeWidth="4" strokeDasharray="106.8" style={{ strokeDashoffset: 106.8 * (1 - secs / of), transition: 'stroke-dashoffset .3s linear' }} />}
    </svg>
    <div className="absolute inset-0 flex items-center justify-center text-sm font-black" style={{ color: colour }}>{secs != null ? secs : label}</div>
  </div>
);

export type RecordRow = { id: string; name: string; won: number; lost: number; drawn?: number };

/** The lobby: make a match, join one with a code, the head-to-head record, and the theme picker. */
export const Lobby: React.FC<{
  theme: Theme; title: string; blurb: string; preview?: React.ReactNode; me: { id: string; name: string };
  themeChoice: ThemeId | 'auto'; pickTheme: (t: ThemeId | 'auto') => void; error: string | null; setError: (e: string | null) => void;
  exit: () => void; create: () => Promise<void>; join: (code: string) => Promise<'ok' | 'own_match' | 'no_match'>; loadRecord: () => Promise<RecordRow[]>;
}> = ({ theme, title, blurb, preview, me, themeChoice, pickTheme, error, setError, exit, create, join, loadRecord }) => {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<RecordRow[] | null>(null);
  useEffect(() => { loadRecord().then(setRecord).catch(() => setRecord([])); }, [loadRecord]);

  const doCreate = async () => { setBusy(true); setError(null); try { await create(); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  const doJoin = async () => {
    if (code.length !== 4) return;
    setBusy(true); setError(null);
    try {
      const r = await join(code);
      if (r !== 'ok') setError(r === 'own_match' ? 'That’s your own code. The other player types it in.' : 'No match with that code. Check the letters.');
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Shell theme={theme}>
      <header className="flex items-center gap-2 px-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <button type="button" aria-label="Back to games" onClick={exit} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl">‹</button>
        <div className="text-2xl font-extrabold tracking-tight">{theme.icon} {title}</div>
      </header>
      <div className="flex-1 flex flex-col items-center px-6 py-6 gap-4 max-w-sm w-full mx-auto">
        {preview}
        <div className="text-sm text-white/75 text-center">{blurb}</div>
        {!joining ? (
          <>
            <Big theme={theme} onClick={doCreate} disabled={busy}>Create a match</Big>
            <Big theme={theme} light onClick={() => { setJoining(true); setError(null); }}>Join with a code</Big>
          </>
        ) : (
          <>
            <input value={code} autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} aria-label="Code"
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') doJoin(); }}
              placeholder="ABCD" className="w-full text-center text-5xl font-black tracking-[.25em] rounded-2xl py-3 bg-white/10 border border-white/20 outline-none placeholder:text-white/20" />
            <Big theme={theme} onClick={doJoin} disabled={busy || code.length !== 4}>Join</Big>
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

/** Waiting for the second player (or for them to say yes to a rematch). */
export const Waiting: React.FC<{ theme: Theme; code: string; rematchWith: string | null; cancel: () => void }> = ({ theme, code, rematchWith, cancel }) => (
  <Shell theme={theme}><div className="flex-1 flex items-center justify-center p-6"><Card>
    {rematchWith ? (
      <><div className="text-4xl">🔁</div><div className="text-xl font-extrabold mt-2">Waiting for {rematchWith}</div>
        <div className="text-sm text-white/70 mt-1">They need to tap <b>Rematch</b> too.</div></>
    ) : (
      <><div className="text-sm uppercase tracking-widest text-white/70">Your code</div>
        <div className="text-6xl font-black tracking-[.2em] mt-2" style={{ color: theme.accent }} aria-label="Match code">{code}</div>
        <div className="text-sm text-white/70 mt-3">The other player taps <b>Join</b> and types this in.</div>
        <div className="mt-4 text-white/70 animate-pulse">Waiting for someone to join…</div></>
    )}
    <div className="mt-5"><Big theme={theme} light onClick={cancel}>Cancel</Big></div>
  </Card></div></Shell>
);
