// src/pages/Minigame/PourGame.tsx — propertystars.app/minigame: a water-sort puzzle for crew
// downtime. Stand-alone on purpose: no sign-in, no company branding, no database. Progress lives in
// this phone's local storage. The rules, levels and solver are in src/lib/pour/engine.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAP, canPour, hint as findHint, isDone, isWon, makeLevel, pour, topRun, type Bottle, type Move } from '../../lib/pour/engine';

const HINTS_PER_LEVEL = 3;
const EXTRA_PER_LEVEL = 1;
const STORE = 'pour.v1';

// Twelve colours that stay apart on a phone screen, each with a symbol for colour-blind players.
const COLOURS: { fill: string; mark: string }[] = [
  { fill: '#ef4444', mark: '●' }, { fill: '#f97316', mark: '▲' }, { fill: '#facc15', mark: '■' },
  { fill: '#84cc16', mark: '◆' }, { fill: '#16a34a', mark: '★' }, { fill: '#22d3ee', mark: '✚' },
  { fill: '#3b82f6', mark: '♥' }, { fill: '#1e3a8a', mark: '♣' }, { fill: '#a855f7', mark: '♠' },
  { fill: '#ec4899', mark: '✦' }, { fill: '#92400e', mark: '⬟' }, { fill: '#e5e7eb', mark: '◐' },
];

type Saved = { level: number; best: number; sound: boolean };
function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && Number.isInteger(s.level) && s.level > 0) return { level: s.level, best: Math.max(s.best || 1, s.level), sound: !!s.sound };
  } catch { /* storage blocked: start fresh */ }
  return { level: 1, best: 1, sound: false };
}
function save(s: Saved) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }

// Tiny sounds made in the browser — no files to download.
let audio: AudioContext | null = null;
function beep(freqs: number[], len = 0.09) {
  try {
    audio = audio || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      const t = audio!.currentTime + i * len;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(audio!.destination); o.start(t); o.stop(t + len + 0.02);
    });
  } catch { /* no sound available */ }
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* ignore */ } };

const BOTTLE_ICON = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#312e81'/>" +
  "<rect x='12' y='3' width='8' height='4' rx='1' fill='#c8a26b'/><path d='M11 8h10v19a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z' fill='#e0e7ff' opacity='.35'/>" +
  "<rect x='11' y='22' width='10' height='5' fill='#ec4899'/><rect x='11' y='17' width='10' height='5' fill='#facc15'/><rect x='11' y='12' width='10' height='5' fill='#3b82f6'/></svg>");

/** Swap the browser tab's title, icon and bar colour for the game's while it's open. */
function useOwnTab() {
  useEffect(() => {
    const was = { title: document.title, icons: [] as { el: HTMLLinkElement; href: string }[], theme: '' };
    document.title = 'Pour';
    document.querySelectorAll<HTMLLinkElement>("link[rel='icon'], link[rel='apple-touch-icon']").forEach(el => { was.icons.push({ el, href: el.href }); el.href = BOTTLE_ICON; });
    const meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
    if (meta) { was.theme = meta.content; meta.content = '#1e1b4b'; }
    return () => { document.title = was.title; was.icons.forEach(i => { i.el.href = i.href; }); if (meta) meta.content = was.theme; };
  }, []);
}

const PourGame: React.FC = () => {
  useOwnTab();
  const [saved, setSaved] = useState<Saved>(load);
  const [bottles, setBottles] = useState<Bottle[]>(() => makeLevel(load().level));
  const [history, setHistory] = useState<Bottle[][]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [extraLeft, setExtraLeft] = useState(EXTRA_PER_LEVEL);
  const [hintsLeft, setHintsLeft] = useState(HINTS_PER_LEVEL);
  const [shown, setShown] = useState<Move | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [pouring, setPouring] = useState<{ from: number; to: number; dx: number; dy: number; tilt: number } | null>(null);
  const [sparkle, setSparkle] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const bottlesRef = useRef(bottles);
  bottlesRef.current = bottles;
  const level = saved.level;
  const won = isWon(bottles);
  const stuck = !won && !pouring && !bottles.some((_, f) => bottles.some((__, t) => canPour(bottles, f, t)));

  const update = useCallback((s: Partial<Saved>) => setSaved(prev => { const next = { ...prev, ...s }; save(next); return next; }), []);

  const startLevel = useCallback((n: number) => {
    setBottles(makeLevel(n)); setHistory([]); setPicked(null); setExtraLeft(EXTRA_PER_LEVEL);
    setHintsLeft(HINTS_PER_LEVEL); setShown(null); setNote(null); setPouring(null);
  }, []);

  useEffect(() => {
    if (!won) return;
    if (saved.sound) beep([523, 659, 784, 1047], 0.12);
    buzz(80);
  }, [won]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 2600); return () => clearTimeout(t); }, [note]);

  const doPour = (from: number, to: number) => {
    const a = refs.current[from]?.getBoundingClientRect(), b = refs.current[to]?.getBoundingClientRect();
    const right = b && a ? b.left >= a.left : true;
    const dx = a && b ? (b.left + b.width / 2) - (a.left + a.width / 2) + (right ? -a.width * 0.55 : a.width * 0.55) : 0;
    const dy = a && b ? (b.top - a.top) - a.height * 0.45 : 0;
    setPicked(null); setShown(null);
    setPouring({ from, to, dx, dy, tilt: right ? 62 : -62 });
    if (saved.sound) beep([392, 330], 0.07);
    window.setTimeout(() => {
      const prev = bottlesRef.current;
      const next = pour(prev, from, to);
      if (!isDone(prev[to]) && isDone(next[to])) {
        setSparkle(to); window.setTimeout(() => setSparkle(s => (s === to ? null : s)), 900);
        buzz(30); if (saved.sound) beep([880, 1175], 0.08);
      }
      bottlesRef.current = next;
      setHistory(h => [...h, prev]);
      setBottles(next);
    }, 260);
    window.setTimeout(() => setPouring(null), 520);
  };

  const tap = (i: number) => {
    if (pouring || won) return;
    if (picked === null) {
      if (!bottles[i].length || isDone(bottles[i])) return;
      setPicked(i); return;
    }
    if (picked === i) { setPicked(null); return; }
    if (canPour(bottles, picked, i)) { doPour(picked, i); return; }
    // Not a legal pour: switch the pick to this bottle if it has something to pour.
    setPicked(bottles[i].length && !isDone(bottles[i]) ? i : null);
  };

  const undo = () => {
    if (!history.length || pouring) return;
    setBottles(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setPicked(null); setShown(null);
  };
  const restart = () => { if (!pouring) startLevel(level); };
  const addBottle = () => {
    if (extraLeft <= 0 || pouring || won) return;
    setBottles(b => [...b, []]); setHistory(h => h.map(s => [...s, []])); setExtraLeft(n => n - 1); setShown(null);
  };
  const askHint = () => {
    if (hintsLeft <= 0 || pouring || won || thinking) return;
    setThinking(true);
    window.setTimeout(() => {   // let the button show "thinking" before the solver runs
      const m = findHint(bottles);
      setThinking(false);
      if (!m) { setNote(extraLeft > 0 ? 'No way out from here. Try Undo, or add a bottle.' : 'No way out from here. Try Undo or Restart.'); return; }
      setHintsLeft(n => n - 1); setShown(m); setPicked(null);
    }, 30);
  };
  const next = () => { const n = level + 1; update({ level: n, best: Math.max(saved.best, n) }); startLevel(n); };

  // Lay the bottles out in even rows that fit the screen.
  const rows = useMemo(() => {
    const n = bottles.length, per = n <= 5 ? n : Math.ceil(n / Math.ceil(n / 6));
    const out: number[][] = [];
    for (let i = 0; i < n; i += per) out.push(Array.from({ length: Math.min(per, n - i) }, (_, k) => i + k));
    return out;
  }, [bottles.length]);

  return (
    <div className="min-h-screen w-full overflow-hidden select-none text-white flex flex-col" style={{ background: 'radial-gradient(120% 80% at 50% 0%, #4338ca 0%, #312e81 45%, #1e1b4b 100%)', fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <style>{`
        @keyframes pour-sparkle { 0% { transform: scale(.4); opacity: 0 } 40% { opacity: 1 } 100% { transform: scale(1.6); opacity: 0 } }
        @keyframes pour-pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(250,204,21,.9) } 50% { box-shadow: 0 0 0 7px rgba(250,204,21,.25) } }
        @keyframes pour-pop { 0% { transform: translateY(16px); opacity: 0 } 100% { transform: none; opacity: 1 } }
      `}</style>

      <header className="flex items-center justify-between px-4 pt-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <div>
          <div className="text-2xl font-extrabold tracking-tight">Pour</div>
          <div className="text-xs text-indigo-200">Best: level {saved.best}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-indigo-200">Level</div>
          <div className="text-3xl font-extrabold leading-none">{level}</div>
        </div>
        <button type="button" aria-label={saved.sound ? 'Sound on' : 'Sound off'} onClick={() => update({ sound: !saved.sound })}
          className="ml-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg">{saved.sound ? '🔊' : '🔇'}</button>
      </header>

      <main className="flex-1 flex flex-col justify-center gap-6 px-3 py-4">
        {rows.map((row, r) => (
          <div key={r} className="flex justify-center gap-3 sm:gap-5">
            {row.map(i => (
              <BottleView key={i} bottle={bottles[i]} index={i} picked={picked === i}
                hinted={shown ? (shown.from === i ? 'from' : shown.to === i ? 'to' : null) : null}
                pouring={pouring && pouring.from === i ? pouring : null} sparkle={sparkle === i}
                setRef={el => { refs.current[i] = el; }} onTap={() => tap(i)} />
            ))}
          </div>
        ))}
      </main>

      {note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm" style={{ animation: 'pour-pop .2s ease-out' }}>{note}</div>}
      {stuck && !note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm">No moves left. Undo, add a bottle, or restart.</div>}

      <nav className="grid grid-cols-4 gap-2 px-3 pb-4 w-full max-w-md mx-auto" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Tool label="Undo" icon="↶" onClick={undo} disabled={!history.length} />
        <Tool label="Restart" icon="⟲" onClick={restart} />
        <Tool label="Bottle" icon="＋" badge={extraLeft} onClick={addBottle} disabled={extraLeft <= 0 || won} />
        <Tool label={thinking ? 'Thinking…' : 'Hint'} icon="💡" badge={hintsLeft} onClick={askHint} disabled={hintsLeft <= 0 || won || thinking} />
      </nav>

      {won && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6" style={{ animation: 'pour-pop .25s ease-out' }}>
          <div className="w-full max-w-xs rounded-3xl bg-indigo-950/95 border border-white/15 p-6 text-center shadow-2xl">
            <div className="text-4xl">✨</div>
            <div className="text-2xl font-extrabold mt-2">Level {level} done!</div>
            <div className="text-sm text-indigo-200 mt-1">{history.length} pours</div>
            <button type="button" onClick={next} className="mt-5 w-full py-3 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-indigo-950 font-extrabold text-lg">Next level</button>
          </div>
        </div>
      )}
    </div>
  );
};

const Tool: React.FC<{ label: string; icon: string; onClick: () => void; disabled?: boolean; badge?: number }> = ({ label, icon, onClick, disabled, badge }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className="relative rounded-2xl bg-white/10 hover:bg-white/20 disabled:opacity-35 py-2.5 flex flex-col items-center gap-0.5">
    <span className="text-xl leading-none">{icon}</span>
    <span className="text-[11px] font-semibold">{label}</span>
    {badge !== undefined && <span className="absolute -top-1.5 -right-1 min-w-5 h-5 px-1 rounded-full bg-yellow-400 text-indigo-950 text-[11px] font-extrabold flex items-center justify-center">{badge}</span>}
  </button>
);

const BottleView: React.FC<{
  bottle: Bottle; index: number; picked: boolean; hinted: 'from' | 'to' | null; sparkle: boolean;
  pouring: { dx: number; dy: number; tilt: number } | null; setRef: (el: HTMLButtonElement | null) => void; onTap: () => void;
}> = ({ bottle, index, picked, hinted, sparkle, pouring, setRef, onTap }) => {
  const done = isDone(bottle);
  const run = topRun(bottle);
  const transform = pouring ? `translate(${pouring.dx}px, ${pouring.dy}px) rotate(${pouring.tilt}deg)` : picked ? 'translateY(-14px)' : 'none';
  return (
    <button type="button" ref={setRef} onClick={onTap} aria-label={`Bottle ${index + 1}${done ? ', finished' : ''}`}
      className="relative flex flex-col items-center focus:outline-none"
      style={{ width: 'clamp(40px, 12vw, 58px)', transform, transition: 'transform .25s ease-in-out', zIndex: pouring ? 20 : picked ? 10 : 1 }}>
      {/* cork on a finished bottle */}
      <div className="rounded-sm" style={{ width: '46%', height: 10, marginBottom: -2, background: done ? 'linear-gradient(#d6b07a,#a47a45)' : 'transparent', transition: 'background .3s' }} />
      <div className="relative w-full overflow-hidden"
        style={{
          height: 'clamp(120px, 34vw, 170px)', borderRadius: '10px 10px 22px 22px',
          background: 'linear-gradient(90deg, rgba(255,255,255,.10), rgba(255,255,255,.04) 40%, rgba(255,255,255,.12))',
          border: '2px solid rgba(224,231,255,.55)', borderTopWidth: 3,
          animation: hinted ? 'pour-pulse 1s ease-in-out infinite' : undefined,
          boxShadow: picked ? '0 0 0 3px rgba(255,255,255,.85)' : undefined,
        }}>
        <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse" style={{ top: '6%' }}>
          {bottle.map((c, k) => (
            <div key={k} className="relative flex items-center justify-center" style={{
              height: `${100 / CAP}%`, background: COLOURS[c].fill,
              boxShadow: 'inset 0 -6px 10px rgba(0,0,0,.18), inset 0 4px 6px rgba(255,255,255,.18)',
              outline: picked && k >= bottle.length - run ? '2px solid rgba(255,255,255,.6)' : undefined, outlineOffset: -2,
            }}>
              <span className="text-[11px] leading-none" style={{ color: c === 11 || c === 2 ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.55)' }}>{COLOURS[c].mark}</span>
            </div>
          ))}
        </div>
        {/* glass shine */}
        <div className="absolute pointer-events-none" style={{ left: '14%', top: '8%', width: '14%', bottom: '10%', borderRadius: 8, background: 'rgba(255,255,255,.22)' }} />
      </div>
      {hinted && <div className="absolute -top-6 text-yellow-300 text-sm font-extrabold">{hinted === 'from' ? '1' : '2'}</div>}
      {sparkle && <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-3xl" style={{ animation: 'pour-sparkle .9s ease-out forwards' }}>✨</div>}
    </button>
  );
};

export default PourGame;
