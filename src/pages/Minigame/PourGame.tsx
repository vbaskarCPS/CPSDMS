// src/pages/Minigame/PourGame.tsx — the Pour water-sort puzzle (minigame hub, /minigame/pour).
// Progress (level, best, sound) is saved to the player's account through the hub's save().
// The board is in ./pourPlay.tsx (shared with the head-to-head mode, ./PourPvp.tsx); the rules,
// levels and solver are in src/lib/pour/engine.ts.
import React, { useCallback, useEffect, useState } from 'react';
import { makeLevel } from '../../lib/pour/engine';
import type { GameProps } from './games';
import { POUR_BG, POUR_CSS, Tool, usePourPlay } from './pourPlay';

const PourPvp = React.lazy(() => import('./PourPvp'));

const HINTS_PER_LEVEL = 3;
const EXTRA_PER_LEVEL = 1;

export type PourProgress = { level: number; best: number; sound: boolean };
function fromSaved(p: Partial<PourProgress> | null): PourProgress {
  const level = Number.isInteger(p?.level) && (p!.level as number) > 0 ? (p!.level as number) : 1;
  return { level, best: Math.max(Number(p?.best) || 1, level), sound: !!p?.sound };
}

const PourGame: React.FC<GameProps<PourProgress>> = props => {
  const [pvp, setPvp] = useState(false);
  useEffect(() => { const was = document.title; document.title = 'Pour'; return () => { document.title = was; }; }, []);
  if (pvp) {
    return (
      <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-indigo-200 animate-pulse" style={{ background: POUR_BG }}>Loading…</div>}>
        <PourPvp me={{ id: props.playerId || '', name: props.player }} sound={fromSaved(props.progress).sound} exit={() => setPvp(false)} />
      </React.Suspense>
    );
  }
  return <Solo {...props} onPvp={props.playerId ? () => setPvp(true) : undefined} />;
};

const Solo: React.FC<GameProps<PourProgress> & { onPvp?: () => void }> = ({ progress, save, exit, onPvp }) => {
  const [saved, setSaved] = useState<PourProgress>(() => fromSaved(progress));
  const [start] = useState(() => makeLevel(fromSaved(progress).level));
  const play = usePourPlay(start, { sound: saved.sound, extras: EXTRA_PER_LEVEL, hints: HINTS_PER_LEVEL });
  const level = saved.level;

  const update = useCallback((s: Partial<PourProgress>) => {
    const next = { ...saved, ...s };
    setSaved(next);
    save(next);
  }, [saved, save]);

  const next = () => { const n = level + 1; update({ level: n, best: Math.max(saved.best, n) }); play.load(makeLevel(n)); };

  return (
    <div className="min-h-screen w-full overflow-hidden select-none text-white flex flex-col" style={{ background: POUR_BG, fontFamily: 'system-ui, -apple-system, sans-serif', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <style>{POUR_CSS}</style>

      <header className="flex items-center justify-between px-4 pt-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back to games" onClick={exit}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl">‹</button>
          <div>
          <div className="text-2xl font-extrabold tracking-tight">Pour</div>
          <div className="text-xs text-indigo-200">Best: level {saved.best}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-indigo-200">Level</div>
          <div className="text-3xl font-extrabold leading-none">{level}</div>
        </div>
        <div className="flex items-center gap-2 ml-3">
          {onPvp && <button type="button" aria-label="Play against someone" onClick={onPvp}
            className="h-10 px-3 rounded-full bg-yellow-400 hover:bg-yellow-300 text-indigo-950 font-extrabold text-sm flex items-center gap-1">⚔️ PvP</button>}
          <button type="button" aria-label={saved.sound ? 'Sound on' : 'Sound off'} onClick={() => update({ sound: !saved.sound })}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg">{saved.sound ? '🔊' : '🔇'}</button>
        </div>
      </header>

      {play.board}

      {play.note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm" style={{ animation: 'pour-pop .2s ease-out' }}>{play.note}</div>}
      {play.stuck && !play.note && <div className="mx-auto mb-2 px-4 py-2 rounded-xl bg-black/50 text-sm">No moves left. Undo, add a bottle, or restart.</div>}

      <nav className="grid grid-cols-4 gap-2 px-3 pb-4 w-full max-w-md mx-auto" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Tool label="Undo" icon="↶" onClick={play.undo} disabled={!play.history.length} />
        <Tool label="Restart" icon="⟲" onClick={play.restart} />
        <Tool label="Bottle" icon="＋" badge={play.extraLeft} onClick={play.addBottle} disabled={play.extraLeft <= 0 || play.won} />
        <Tool label={play.thinking ? 'Thinking…' : 'Hint'} icon="💡" badge={play.hintsLeft} onClick={play.askHint} disabled={play.hintsLeft <= 0 || play.won || play.thinking} />
      </nav>

      {play.won && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6" style={{ animation: 'pour-pop .25s ease-out' }}>
          <div className="w-full max-w-xs rounded-3xl bg-indigo-950/95 border border-white/15 p-6 text-center shadow-2xl">
            <div className="text-4xl">✨</div>
            <div className="text-2xl font-extrabold mt-2">Level {level} done!</div>
            <div className="text-sm text-indigo-200 mt-1">{play.history.length} pours</div>
            <button type="button" onClick={next} className="mt-5 w-full py-3 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-indigo-950 font-extrabold text-lg">Next level</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PourGame;
