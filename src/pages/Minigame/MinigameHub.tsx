// src/pages/Minigame/MinigameHub.tsx — propertystars.app/minigame: pick who's playing (name + 4-digit
// PIN), then pick a game. Progress saves to the player's account (minigame_* functions), so it
// follows them to any phone. Games are listed in ./games.ts; each opens at /minigame/<id>.
// Stand-alone on purpose: no company branding and no link into the work app.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listPlayers, loadProgress, me, saveProgress, signIn, signOut, type Player, type Progress } from './account';
import { GAMES, type GameInfo } from './games';

const BG = 'radial-gradient(120% 80% at 50% 0%, #4338ca 0%, #312e81 45%, #1e1b4b 100%)';
const ICON = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#312e81'/>" +
  "<rect x='12' y='3' width='8' height='4' rx='1' fill='#c8a26b'/><path d='M11 8h10v19a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z' fill='#e0e7ff' opacity='.35'/>" +
  "<rect x='11' y='22' width='10' height='5' fill='#ec4899'/><rect x='11' y='17' width='10' height='5' fill='#facc15'/><rect x='11' y='12' width='10' height='5' fill='#3b82f6'/></svg>");

/** The hub's own tab title, icon and bar colour while it's open. */
function useOwnTab() {
  useEffect(() => {
    const was = { title: document.title, icons: [] as { el: HTMLLinkElement; href: string }[], theme: '' };
    document.title = 'Minigames';
    document.querySelectorAll<HTMLLinkElement>("link[rel='icon'], link[rel='apple-touch-icon']").forEach(el => { was.icons.push({ el, href: el.href }); el.href = ICON; });
    const meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
    if (meta) { was.theme = meta.content; meta.content = '#1e1b4b'; }
    return () => { document.title = was.title; was.icons.forEach(i => { i.el.href = i.href; }); if (meta) meta.content = was.theme; };
  }, []);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const askedKey = (player: string, game: string) => `minigame.asked.${player}.${game}`;
const wasAsked = (player: string, game: string) => { try { return !!localStorage.getItem(askedKey(player, game)); } catch { return true; } };
const markAsked = (player: string, game: string) => { try { localStorage.setItem(askedKey(player, game), '1'); } catch { /* ignore */ } };
// once one player has taken this phone's old progress, nobody else is offered it
const claimedKey = (game: string) => `minigame.claimed.${game}`;
const isClaimed = (game: string) => { try { return !!localStorage.getItem(claimedKey(game)); } catch { return true; } };
const markClaimed = (game: string, player: string) => { try { localStorage.setItem(claimedKey(game), player); } catch { /* ignore */ } };

const MinigameHub: React.FC = () => {
  useOwnTab();
  const nav = useNavigate();
  const gameId = useLocation().pathname.replace(/^\/minigame\/?/, '').split('/')[0] || null;
  const [player, setPlayer] = useState<Player | null | undefined>(undefined);   // undefined = still checking
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ game: GameInfo; data: Record<string, unknown>; label: string; theirs: string | null } | null>(null);
  const pending = useRef<Record<string, Record<string, unknown>>>({});

  // who is signed in on this phone
  useEffect(() => { me().then(setPlayer).catch(e => { setError(msg(e)); setPlayer(null); }); }, []);

  // their progress, then offer to bring over anything better left on this phone from before accounts
  useEffect(() => {
    if (!player) { setProgress(null); return; }
    let live = true;
    loadProgress().then(p => {
      if (!live) return;
      setProgress(p);
      for (const g of GAMES) {
        const local = g.localProgress?.();
        if (!local || wasAsked(player.id, g.id) || isClaimed(g.id)) continue;
        const mine = p[g.id] || null;
        if (local.rank > (g.rank?.(mine) ?? 0)) { setOffer({ game: g, data: local.data, label: local.label, theirs: g.summary?.(mine) ?? null }); break; }
        markAsked(player.id, g.id);
      }
    }).catch(e => { if (live) setError(msg(e)); });
    return () => { live = false; };
  }, [player]);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3000); return () => clearTimeout(t); }, [note]);

  // Save a game's progress; if the network drops, keep it and try again every 15 seconds.
  const flush = useCallback(async () => {
    for (const [game, data] of Object.entries(pending.current)) {
      try { await saveProgress(game, data); if (pending.current[game] === data) delete pending.current[game]; }
      catch { setNote('Not saved yet. Will keep trying.'); return; }
    }
  }, []);
  useEffect(() => { const t = setInterval(() => { if (Object.keys(pending.current).length) flush(); }, 15000); return () => clearInterval(t); }, [flush]);
  const save = useCallback((game: string, data: Record<string, unknown>) => {
    setProgress(p => ({ ...(p || {}), [game]: data }));
    pending.current[game] = data;
    flush();
  }, [flush]);

  const acceptOffer = async (yes: boolean) => {
    if (!offer || !player) return;
    if (yes) { save(offer.game.id, offer.data); markClaimed(offer.game.id, player.id); setNote(`${offer.game.name}: ${offer.label} saved to ${player.name}.`); }
    markAsked(player.id, offer.game.id);
    setOffer(null);
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen w-full text-white select-none" style={{ background: BG, fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent' }}>
      {children}
      {note && <div className="fixed bottom-6 inset-x-0 flex justify-center pointer-events-none z-50"><div className="px-4 py-2 rounded-xl bg-black/60 text-sm">{note}</div></div>}
    </div>
  );

  if (player === undefined) return shell(<div className="min-h-screen flex items-center justify-center text-indigo-200 animate-pulse">Loading…</div>);
  if (!player) return shell(<SignIn onSignedIn={p => { setError(null); setPlayer(p); }} startError={error} />);

  const game = gameId ? GAMES.find(g => g.id === gameId && g.component && !g.comingSoon) : null;
  if (game && progress && !offer) {
    const Game = game.component!;
    return (
      <React.Suspense fallback={shell(<div className="min-h-screen flex items-center justify-center text-indigo-200 animate-pulse">Loading…</div>)}>
        <Game key={`${player.id}.${game.id}`} progress={progress[game.id] || null} save={d => save(game.id, d)} exit={() => nav('/minigame')} player={player.name} />
        {note && <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-50"><div className="px-4 py-2 rounded-xl bg-black/60 text-white text-sm">{note}</div></div>}
      </React.Suspense>
    );
  }

  return shell(
    <div className="max-w-lg mx-auto px-4 pb-10" style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-indigo-200">Minigames</div>
          <div className="text-2xl font-extrabold">Hi {player.name}</div>
        </div>
        <button type="button" onClick={async () => { await signOut(); setPlayer(null); nav('/minigame'); }}
          className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-semibold">Switch player</button>
      </div>
      {error && <div className="mt-4 text-sm text-red-200">{error}</div>}
      {!progress && !error && <div className="mt-8 text-indigo-200 animate-pulse">Loading your progress…</div>}
      {progress && (
        <div className="grid gap-3 mt-6">
          {GAMES.map(g => {
            const line = g.summary?.(progress[g.id] || null);
            return (
              <button key={g.id} type="button" disabled={g.comingSoon} onClick={() => nav(`/minigame/${g.id}`)}
                className="text-left rounded-3xl p-4 flex items-center gap-4 border border-white/10 disabled:opacity-60 hover:brightness-110 transition"
                style={{ background: `linear-gradient(135deg, ${g.colour}, ${g.colour}99)` }}>
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-3xl">{g.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-lg font-extrabold">{g.name}</div>
                  <div className="text-sm text-white/80">{g.blurb}</div>
                </div>
                <div className="text-sm font-bold whitespace-nowrap">{g.comingSoon ? 'Coming soon' : line || 'Play'}</div>
              </button>
            );
          })}
        </div>
      )}

      {offer && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6">
          <div className="w-full max-w-xs rounded-3xl bg-indigo-950/95 border border-white/15 p-6 text-center shadow-2xl">
            <div className="text-4xl">{offer.game.icon}</div>
            <div className="text-xl font-extrabold mt-2">Bring over your {offer.game.name} progress?</div>
            <div className="text-sm text-indigo-200 mt-2">
              This phone got to <b className="text-white">{offer.label}</b>.{' '}
              {offer.theirs ? <>{player.name}'s account is at {offer.theirs.toLowerCase()}.</> : <>{player.name}'s account hasn't played yet.</>}
            </div>
            <button type="button" onClick={() => acceptOffer(true)} className="mt-5 w-full py-3 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-indigo-950 font-extrabold">Yes, bring it over</button>
            <button type="button" onClick={() => acceptOffer(false)} className="mt-2 w-full py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-sm font-semibold">No, keep my account as it is</button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Who's playing? Tap a name, then the 4-digit PIN (chosen on the first sign-in). */
const SignIn: React.FC<{ onSignedIn: (p: Player) => void; startError: string | null }> = ({ onSignedIn, startError }) => {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(startError);
  const [who, setWho] = useState<Player | null>(null);
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);     // a new PIN, waiting to be typed again
  const [busy, setBusy] = useState(false);

  useEffect(() => { listPlayers().then(setPlayers).catch(e => setError(msg(e))); }, []);

  const choosing = who && !who.has_pin;
  const title = !who ? "Who's playing?" : choosing ? (first ? 'Type it again' : 'Choose a 4-digit PIN') : `Hi ${who.name}, your PIN`;

  const submit = async (code: string) => {
    if (!who) return;
    if (choosing && !first) { setFirst(code); setPin(''); return; }
    if (choosing && first !== code) { setError("Those didn't match. Choose your PIN again."); setFirst(null); setPin(''); return; }
    setBusy(true); setError(null);
    try {
      const r = await signIn(who.id, code);
      if (r.ok) { onSignedIn({ id: r.id, name: r.name }); return; }
      setPin('');
      setError(r.reason === 'locked' ? 'Too many wrong tries. Wait 15 minutes and try again.'
        : r.reason === 'wrong' ? `Wrong PIN. ${r.tries_left ?? 0} ${r.tries_left === 1 ? 'try' : 'tries'} left.`
        : 'Something went wrong. Try again.');
    } catch (e) { setError(msg(e)); setPin(''); } finally { setBusy(false); }
  };

  const press = (d: string) => {
    if (busy) return;
    if (d === '⌫') { setPin(p => p.slice(0, -1)); return; }
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) window.setTimeout(() => submit(next), 120);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <div className="text-xs uppercase tracking-widest text-indigo-200">Minigames</div>
      <div className="text-2xl font-extrabold mt-1 text-center">{title}</div>
      {error && <div className="mt-3 text-sm text-red-200 text-center max-w-xs">{error}</div>}

      {!who && (
        <div className="grid grid-cols-2 gap-3 mt-8 w-full max-w-xs">
          {!players && !error && <div className="col-span-2 text-center text-indigo-200 animate-pulse">Loading…</div>}
          {players?.map(p => (
            <button key={p.id} type="button" onClick={() => { setWho(p); setError(null); setPin(''); setFirst(null); }}
              className="rounded-3xl bg-white/10 hover:bg-white/20 py-6 flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full bg-yellow-400 text-indigo-950 text-2xl font-extrabold flex items-center justify-center">{p.name.slice(0, 1).toUpperCase()}</div>
              <div className="font-bold">{p.name}</div>
            </button>
          ))}
        </div>
      )}

      {who && (
        <>
          <div className="flex gap-3 mt-6">
            {[0, 1, 2, 3].map(i => <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-yellow-400' : 'bg-white/20'}`} />)}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-8">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d
              ? <button key={i} type="button" onClick={() => press(d)} disabled={busy} aria-label={d === '⌫' ? 'Delete' : d}
                  className="w-20 h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-2xl font-bold disabled:opacity-50">{d}</button>
              : <div key={i} />)}
          </div>
          <button type="button" onClick={() => { setWho(null); setPin(''); setFirst(null); setError(null); }}
            className="mt-6 text-sm text-indigo-200 underline">Not {who.name}?</button>
        </>
      )}
    </div>
  );
};

export default MinigameHub;
