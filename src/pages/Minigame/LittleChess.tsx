// src/pages/Minigame/LittleChess.tsx — Little Chess (/minigame/chess): first chess steps for a toddler who
// reads sight words. Every instruction is a short CAPITALS sentence; the phone's voice reads it after a
// pause (so he can try first) and lights up each word. Tap only, no wrong-answer sounds, a sticker after
// every lesson. Leaving and the grown-ups' corner need a 3-second hold. Lessons and move rules are in
// src/lib/littleChess/lessons.ts; progress saves to the player's account through the hub.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD, WORD, canMove, cheers, clipId, spokenFor, movesFrom, readProgress, LEVELS, currentLevel, levelDone, levelOpen, levelStart, lessonsOf, sentenceFor, speakerFor, stickerFor, stickerLine,
  type ChessProgress, type Lesson, type Level, type Piece, type Round, type Speaker, type Sq,
} from '../../lib/littleChess/lessons';
import type { GameProps } from './games';
import { CHARACTER_CSS, Character, type Mood } from './chessCharacters';
import { clipCount, englishVoices, hush, loadClips, onVoicesReady, say, type VoiceInfo } from './voice';

const BG = 'radial-gradient(120% 80% at 50% 0%, #0f766e 0%, #134e4a 55%, #042f2e 100%)';
const LIGHT = '#f0d9b5', DARK = '#b58863';
const FONT = "'Andika', 'Comic Sans MS', 'Trebuchet MS', system-ui, sans-serif";

// ── the voice: the tablet's most natural one, or the one a grown-up picked ──
let chosenVoice: string | null = null, useRecorded = true;
/** Say a line as `who` (the recorded clip if there is one, else the tablet's voice). */
let playerName = 'Kiaan';
const speak = (text: string, on: boolean, onWord?: (i: number) => void, who: Speaker = 'narrator') =>
  say(text, { on, voice: chosenVoice, onWord, clip: clipId(who, text), recorded: useRecorded, spoken: spokenFor(who, text, playerName) });

/** A button that only works when held for 3 seconds (so little hands can't leave by accident). */
const HoldButton: React.FC<{ onHold: () => void; label: string; children: React.ReactNode }> = ({ onHold, label, children }) => {
  const [holding, setHolding] = useState(false);
  const t = useRef<number | null>(null);
  const start = () => { setHolding(true); t.current = window.setTimeout(() => { setHolding(false); onHold(); }, 3000); };
  const stop = () => { setHolding(false); if (t.current) window.clearTimeout(t.current); };
  return (
    <button type="button" aria-label={label} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      className="relative w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-2xl text-white/70 touch-none">
      {children}
      <svg className="absolute inset-0 -rotate-90 pointer-events-none" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="26" fill="none" stroke="#fde047" strokeWidth="4" strokeDasharray="163.4"
          style={{ strokeDashoffset: holding ? 0 : 163.4, transition: holding ? 'stroke-dashoffset 3s linear' : 'none' }} />
      </svg>
    </button>
  );
};

const PieceShape: React.FC<{ piece: Piece; size: number; mood?: Mood; className?: string; style?: React.CSSProperties }> = ({ piece, size, mood, className, style }) => (
  <Character piece={piece} size={size} mood={mood} className={className} style={style} />
);

/** The sentence at the top, in big capitals, one word lit at a time while it's read. */
const Sentence: React.FC<{ text: string; lit: number; flash?: string | null }> = ({ text, lit, flash }) => (
  <div className="text-center font-black tracking-wide px-4" style={{ fontSize: 'clamp(34px, 6.5vw, 64px)', fontFamily: FONT, minHeight: '1.3em' }}>
    {flash ? <span className="text-yellow-300">{flash}</span> : text.split(' ').map((w, i) => (
      <React.Fragment key={i}>{i > 0 && ' '}
        <span className="inline-block mx-[0.1em] transition-transform" style={{ color: i === lit ? '#fde047' : '#fff', transform: i === lit ? 'scale(1.12)' : 'none' }}>{w}</span>
      </React.Fragment>
    ))}
  </div>
);


const LittleChess: React.FC<GameProps<ChessProgress>> = ({ progress, save, exit, player }) => {
  useEffect(() => { const was = document.title; document.title = 'Little Chess'; return () => { document.title = was; hush(); }; }, []);
  const [p, setP] = useState<ChessProgress>(() => readProgress(progress));
  // the level being played, and which of its lessons; a level runs all its lessons one after another
  const [run, setRun] = useState<{ level: Level; at: number; next: boolean } | null>(null);
  const playing: Lesson | null = run && !run.next ? lessonsOf(run.level)[run.at] : null;
  const [sticker, setSticker] = useState<string | null>(null);
  const [grownups, setGrownups] = useState(false);
  const update = useCallback((next: ChessProgress) => { setP(next); save(next); }, [save]);
  chosenVoice = p.voiceName; useRecorded = p.recorded; playerName = player;
  useEffect(() => { loadClips(); }, []);

  const finish = (lesson: Lesson) => {
    const got = stickerFor(p);
    update({ ...p, done: p.done.includes(lesson.id) ? p.done : [...p.done, lesson.id], stickers: [...p.stickers, got] });
    setRun(r => (r ? { ...r, next: true } : r)); setSticker(got);
    speak(stickerLine(player), p.voice);
  };
  // after the sticker: on to the level's next lesson, or home once the level is finished
  const afterSticker = () => {
    setSticker(null);
    setRun(r => (r && r.at + 1 < lessonsOf(r.level).length ? { level: r.level, at: r.at + 1, next: false } : null));
  };
  const startLevel = (level: Level) => setRun({ level, at: levelStart(p, level), next: false });

  return (
    <div className="min-h-screen w-full text-white select-none overflow-hidden" style={{ background: BG, fontFamily: FONT, WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <style>{`
        @keyframes lc-bounce { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-18%) scale(1.06) } 70% { transform: translateY(2%) } }
        @keyframes lc-wiggle { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-9deg) } 40% { transform: rotate(8deg) } 60% { transform: rotate(-6deg) } 80% { transform: rotate(4deg) } }
        @keyframes lc-glow { 0%,100% { box-shadow: inset 0 0 0 6px rgba(253,224,71,.95), 0 0 18px rgba(253,224,71,.6) } 50% { box-shadow: inset 0 0 0 10px rgba(253,224,71,.55), 0 0 6px rgba(253,224,71,.2) } }
        @keyframes lc-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes lc-gone { 0% { transform: scale(1); opacity: 1 } 100% { transform: scale(1.8); opacity: 0 } }
        @keyframes lc-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        ${CHARACTER_CSS}
      `}</style>
      {playing
        ? <Play key={playing.id} lesson={playing} name={player} voice={p.voice} onDone={() => finish(playing)} onQuit={() => { hush(); setRun(null); }} />
        : !run && <Home p={p} name={player} onPlay={startLevel} onExit={() => { hush(); exit(); }} onGrownups={() => setGrownups(true)} />}

      {sticker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={afterSticker}>
          <div className="rounded-[40px] bg-teal-950/95 border-4 border-yellow-300 px-10 py-8 text-center shadow-2xl" style={{ animation: 'lc-pop .5s ease-out' }}>
            <div style={{ fontSize: 'clamp(110px, 22vw, 200px)', lineHeight: 1, animation: 'lc-float 2s ease-in-out infinite' }}>{sticker}</div>
            <div className="font-black mt-4" style={{ fontSize: 'clamp(30px, 5vw, 52px)' }}>{player.toUpperCase()} GOT A STICKER!</div>
            <button type="button" onClick={e => { e.stopPropagation(); afterSticker(); }} className="mt-6 px-10 py-4 rounded-full bg-yellow-300 text-teal-950 font-black text-3xl">YAY!</button>
          </div>
        </div>
      )}
      {grownups && <Grownups p={p} onChange={update} onClose={() => setGrownups(false)} />}
    </div>
  );
};

// ── home: the big PLAY button, the sticker book, and the four levels ──
const Home: React.FC<{ p: ChessProgress; name: string; onPlay: (lv: Level) => void; onExit: () => void; onGrownups: () => void }> = ({ p, name, onPlay, onExit, onGrownups }) => {
  const now = currentLevel(p);
  return (
    <div className="max-w-4xl mx-auto px-4 pb-10" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between">
        <HoldButton onHold={onExit} label="Hold to leave">‹</HoldButton>
        <div className="font-black text-3xl tracking-wide">LITTLE CHESS</div>
        <HoldButton onHold={onGrownups} label="Hold for grown-ups">⚙</HoldButton>
      </div>

      <button type="button" disabled={!now} onClick={() => now && onPlay(now)}
        className="mt-6 w-full rounded-[36px] bg-yellow-300 text-teal-950 py-6 px-6 flex items-center justify-center gap-6 shadow-xl active:scale-[.98] transition disabled:opacity-60"
        style={{ animation: now ? 'lc-float 2.4s ease-in-out infinite' : undefined }}>
        <span style={{ fontSize: 'clamp(64px, 11vw, 100px)', lineHeight: 1 }}>{now ? now.icon : '🏆'}</span>
        <span className="text-left">
          <span className="block font-black" style={{ fontSize: 'clamp(48px, 9vw, 84px)', lineHeight: 1 }}>{now ? 'PLAY' : 'ALL DONE!'}</span>
          <span className="block font-bold text-xl mt-1">{now ? now.label : `${name.toUpperCase()} DID EVERYTHING!`}</span>
        </span>
      </button>

      <div className="mt-8">
        <div className="font-black text-xl text-teal-100">STICKERS</div>
        <div className="mt-2 flex flex-wrap gap-2 rounded-3xl bg-white/10 p-3 min-h-[76px]">
          {p.stickers.length ? p.stickers.map((s, i) => <span key={i} className="text-5xl leading-none">{s}</span>)
            : <span className="text-teal-100/70 text-lg self-center px-2">Finish a game to get a sticker!</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-8">
        {LEVELS.map(lv => {
          const open = levelOpen(p, lv), done = levelDone(p, lv), ls = lessonsOf(lv), got = ls.filter(l => p.done.includes(l.id)).length;
          return (
            <button key={lv.id} type="button" disabled={!open} onClick={() => onPlay(lv)} aria-label={`Level ${lv.label}`}
              className={`relative rounded-[32px] p-5 flex flex-col items-center gap-2 ${done ? 'bg-emerald-500/80' : open ? 'bg-yellow-300/90 text-teal-950' : 'bg-white/10'} disabled:opacity-50`}>
              <span style={{ fontSize: 64, lineHeight: 1 }}>{lv.icon}</span>
              <span className="font-black text-2xl tracking-wide">{lv.label}</span>
              <span className="flex flex-wrap justify-center gap-1.5 max-w-[220px]">
                {ls.map(l => <span key={l.id} className="w-3 h-3 rounded-full" style={{ background: p.done.includes(l.id) ? '#fff' : 'rgba(0,0,0,.2)' }} />)}
              </span>
              {done && <span className="absolute -top-2 -right-2 w-10 h-10 rounded-full text-emerald-600 font-black text-xl flex items-center justify-center" style={{ background: '#fff' }}>✓</span>}
              {!open && <span className="absolute top-2 right-3 text-2xl">🔒</span>}
              <span className="sr-only">{got} of {ls.length} done</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Grown-ups' corner: voice, unlock everything, start over. */
const Grownups: React.FC<{ p: ChessProgress; onChange: (p: ChessProgress) => void; onClose: () => void }> = ({ p, onChange, onClose }) => {
  const [sure, setSure] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  useEffect(() => onVoicesReady(() => setVoices(englishVoices())), []);
  const test = (name: string | null) => say('FIND THE KING.', { on: true, voice: name });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: '#fff', color: '#111827' }}>
        <div className="text-xl font-bold">Grown-ups</div>
        <label className="flex items-center justify-between mt-5 text-base">Read instructions out loud
          <input type="checkbox" className="w-6 h-6" checked={p.voice} onChange={e => onChange({ ...p, voice: e.target.checked })} />
        </label>
        {p.voice && clipCount() > 0 && (
          <label className="flex items-center justify-between mt-4 text-base">Use the recorded voices ({clipCount()} clips)
            <input type="checkbox" className="w-6 h-6" checked={p.recorded} onChange={e => onChange({ ...p, recorded: e.target.checked })} />
          </label>
        )}
        {p.voice && (
          <div className="mt-3">
            <div className="text-sm">{clipCount() > 0 && p.recorded ? 'Tablet voice (for anything not recorded)' : 'Voice'}</div>
            <div className="flex gap-2 mt-1">
              <select value={p.voiceName || ''} onChange={e => { const v = e.target.value || null; onChange({ ...p, voiceName: v }); test(v); }}
                className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-sm" style={{ background: '#fff', color: '#111827' }}>
                <option value="">Best on this tablet{voices[0] ? ` (${voices[0].name})` : ''}</option>
                {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
              <button type="button" onClick={() => test(p.voiceName)} className="px-3 rounded-lg text-sm font-semibold" style={{ background: '#ccfbf1', color: '#134e4a' }}>▶ Test</button>
            </div>
            <div className="text-xs text-gray-500 mt-1">Voices marked Natural, Neural, Enhanced or Google sound the least robotic.</div>
          </div>
        )}
        <label className="flex items-center justify-between mt-4 text-base">Open every level
          <input type="checkbox" className="w-6 h-6" checked={p.unlockAll} onChange={e => onChange({ ...p, unlockAll: e.target.checked })} />
        </label>
        <div className="text-xs text-gray-500 mt-1">Levels open one at a time as each is finished. Turn this on to let him pick any level.</div>
        <div className="mt-5 border-t pt-4">
          {!sure
            ? <button type="button" onClick={() => setSure(true)} className="text-sm text-red-600 underline">Start over (keeps stickers)</button>
            : <div className="text-sm">Start every level again?
                <button type="button" onClick={() => { onChange({ ...p, done: [] }); setSure(false); }} className="ml-3 px-3 py-1 rounded-lg bg-red-600 text-white">Yes</button>
                <button type="button" onClick={() => setSure(false)} className="ml-2 px-3 py-1 rounded-lg" style={{ background: '#e5e7eb', color: '#111827' }}>No</button></div>}
        </div>
        <button type="button" onClick={onClose} className="mt-6 w-full py-3 rounded-2xl bg-teal-700 text-white font-semibold">Done</button>
      </div>
    </div>
  );
};

// ── playing one lesson ──
const Play: React.FC<{ lesson: Lesson; name: string; voice: boolean; onDone: () => void; onQuit: () => void }> = ({ lesson, name, voice, onDone, onQuit }) => {
  const [i, setI] = useState(0);
  const [lit, setLit] = useState(-1);
  const [flash, setFlash] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [cheer, setCheer] = useState<string | null>(null);
  const round = lesson.rounds[i];
  const text = sentenceFor(round);
  const who = speakerFor(round);
  const idle = useRef<number | null>(null);

  // read the sentence after a pause (so he can read it first); if nothing happens, hint and read again
  const nudge = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => { setHint(true); speak(text, voice, setLit, who); }, 7000);
  }, [text, voice, who]);
  useEffect(() => {
    setHint(false); setLit(-1);
    const t = window.setTimeout(() => speak(text, voice, setLit, who), 2500);
    nudge();
    return () => { window.clearTimeout(t); if (idle.current) window.clearTimeout(idle.current); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const oops = () => { setFlash('TRY AGAIN.'); window.setTimeout(() => setFlash(null), 1100); nudge(); };
  const won = () => {
    if (idle.current) window.clearTimeout(idle.current);
    setFlash(null);
    const c = cheers(name)[Math.floor(Math.random() * 5)];
    setCheer(c); speak(c, voice, undefined, round.piece);   // the round's character cheers in its own voice
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
    window.setTimeout(() => { setCheer(null); if (i + 1 < lesson.rounds.length) setI(i + 1); else onDone(); }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between px-4">
        <HoldButton onHold={onQuit} label="Hold to stop">‹</HoldButton>
        <div className="flex gap-2">{lesson.rounds.map((_, k) => <span key={k} className={`w-4 h-4 rounded-full ${k < i ? 'bg-yellow-300' : k === i ? '' : 'bg-white/25'}`} style={k === i ? { background: '#fff' } : undefined} />)}</div>
        <div className="w-14" />
      </div>
      <div className="mt-4"><Sentence text={text} lit={lit} flash={flash} /></div>
      <div className="flex-1 flex items-center justify-center p-4" onPointerDown={() => nudge()}>
        {round.kind === 'hello' && <Hello key={i} round={round} onDone={won} speakIt={() => speak(text, voice, setLit, who)} />}
        {round.kind === 'find' && <Find key={i} round={round} hint={hint} onRight={won} onWrong={oops} />}
        {round.kind === 'word' && <Word key={i} round={round} hint={hint} onRight={won} onWrong={oops} />}
        {(round.kind === 'shadow' || round.kind === 'peek') && <Guess key={i} round={round} hint={hint} onRight={won} onWrong={oops} />}
        {(round.kind === 'board' || round.kind === 'show') && <BoardRound key={i} round={round} hint={hint} onDone={won} onWrong={oops} />}
      </div>
      {cheer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="font-black text-yellow-300 text-center" style={{ fontSize: 'clamp(56px, 12vw, 130px)', textShadow: '0 6px 0 #134e4a, 0 0 30px rgba(0,0,0,.4)', animation: 'lc-pop .4s ease-out' }}>
            {cheer}<div className="text-[0.6em]">✨⭐✨</div>
          </div>
        </div>
      )}
    </div>
  );
};

const Hello: React.FC<{ round: Extract<Round, { kind: 'hello' }>; onDone: () => void; speakIt: () => void }> = ({ round, onDone, speakIt }) => {
  const [tapped, setTapped] = useState(false);
  return (
    <div className="flex flex-col items-center">
      <button type="button" aria-label={WORD[round.piece]} onClick={() => { if (tapped) return; setTapped(true); speakIt(); window.setTimeout(onDone, 1600); }}
        className="rounded-[48px] bg-white/10 px-12 py-6" style={{ animation: tapped ? 'lc-bounce .7s ease-out 2' : 'lc-float 2s ease-in-out infinite' }}>
        <PieceShape piece={round.piece} size={Math.min(300, window.innerHeight * 0.34)} mood={tapped ? 'happy' : 'idle'} />
      </button>
      <WordCard word={WORD[round.piece]} big />
      {!tapped && <div className="mt-4 text-2xl font-black text-teal-100">TAP IT!</div>}
    </div>
  );
};

const WordCard: React.FC<{ word: string; big?: boolean; glow?: boolean; wiggle?: boolean; onClick?: () => void }> = ({ word, big, glow, wiggle, onClick }) => {
  const El = onClick ? 'button' : 'div';
  return (
    <El {...(onClick ? { type: 'button' as const, onClick } : {})}
      className="mt-4 rounded-3xl text-teal-950 font-black tracking-wider px-8 py-3"
      style={{ background: '#fff', fontSize: big ? 'clamp(44px, 8vw, 80px)' : 'clamp(36px, 6vw, 60px)', animation: wiggle ? 'lc-wiggle .5s' : glow ? 'lc-glow 1.1s ease-in-out infinite' : undefined }}>
      {word}
    </El>
  );
};

function useWrong() {
  const [wrong, setWrong] = useState<number | null>(null);
  const flag = (k: number) => { setWrong(k); window.setTimeout(() => setWrong(null), 520); };
  return [wrong, flag] as const;
}

const Find: React.FC<{ round: Extract<Round, { kind: 'find' }>; hint: boolean; onRight: () => void; onWrong: () => void }> = ({ round, hint, onRight, onWrong }) => {
  const [wrong, flag] = useWrong();
  const [got, setGot] = useState(false);
  const size = Math.min(200, window.innerWidth / (round.options.length + 1));
  return (
    <div className="flex flex-wrap justify-center gap-5">
      {round.options.map((piece, k) => {
        const right = piece === round.piece;
        return (
          <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => { if (got) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(); } }}
            className="rounded-[36px] bg-white/10 p-5"
            style={{ animation: wrong === k ? 'lc-wiggle .5s' : got && right ? 'lc-bounce .7s ease-out 2' : hint && right ? 'lc-glow 1.1s ease-in-out infinite' : undefined }}>
            <PieceShape piece={piece} size={size} mood={got && right ? 'happy' : 'idle'} />
          </button>
        );
      })}
    </div>
  );
};

const Word: React.FC<{ round: Extract<Round, { kind: 'word' }>; hint: boolean; onRight: () => void; onWrong: () => void }> = ({ round, hint, onRight, onWrong }) => {
  const [wrong, flag] = useWrong();
  const [got, setGot] = useState(false);
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[48px] bg-white/10 px-10 py-4"><PieceShape piece={round.piece} size={Math.min(250, window.innerHeight * 0.28)} mood={got ? 'happy' : 'idle'} /></div>
      <div className="flex flex-wrap justify-center gap-4 mt-4">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return <WordCard key={k} word={WORD[piece]} wiggle={wrong === k} glow={(hint || got) && right}
            onClick={() => { if (got) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(); } }} />;
        })}
      </div>
    </div>
  );
};

/** WHO IS HIDING? / WHO IS PEEKING? Only a shadow, or the top of the piece over a wall, until he guesses;
 *  then the piece pops out, smiling. He answers with the matching piece, or (harder) its word. */
const Guess: React.FC<{ round: Extract<Round, { kind: 'shadow' | 'peek' }>; hint: boolean; onRight: () => void; onWrong: () => void }> = ({ round, hint, onRight, onWrong }) => {
  const [wrong, flag] = useWrong();
  const [got, setGot] = useState(false);
  const big = Math.min(260, window.innerHeight * 0.3);
  const tap = (k: number, right: boolean) => { if (got) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(); } };
  const hidden = round.kind === 'shadow'
    ? <PieceShape piece={round.piece} size={big} mood={got ? 'happy' : 'idle'}
        style={{ filter: got ? 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' : 'brightness(0) opacity(.8)', transition: 'filter .5s', animation: got ? 'lc-bounce .7s ease-out 2' : undefined }} />
    : (
      // the piece rises from behind a brick wall; only its top shows until he guesses
      <div className="relative overflow-hidden" style={{ width: big * 0.95, height: big * 1.02 }}>
        <div className="absolute left-0 right-0 flex justify-center" style={{ top: got ? 0 : big * 0.2, transition: 'top .5s ease-out', animation: got ? undefined : 'lc-float 1.8s ease-in-out infinite' }}>
          <PieceShape piece={round.piece} size={big} mood={got ? 'happy' : 'idle'} />
        </div>
        {!got && <div className="absolute left-0 right-0 bottom-0 rounded-t-xl" style={{ height: big * 0.5, background: 'repeating-linear-gradient(0deg, #b45309 0 22px, #78350f 22px 25px), #b45309', boxShadow: 'inset 0 4px 0 rgba(255,255,255,.2)' }}>
          <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 46px, #78350f 46px 49px)', opacity: .7 }} />
        </div>}
      </div>
    );
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[48px] bg-white/10 px-10 py-4 flex items-end justify-center">{hidden}</div>
      <div className="flex flex-wrap justify-center gap-4 mt-5">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return round.answer === 'word'
            ? <WordCard key={k} word={WORD[piece]} wiggle={wrong === k} glow={(hint || got) && right} onClick={() => tap(k, right)} />
            : (
              <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => tap(k, right)} className="rounded-[32px] bg-white/10 p-4"
                style={{ animation: wrong === k ? 'lc-wiggle .5s' : hint && right && !got ? 'lc-glow 1.1s ease-in-out infinite' : undefined }}>
                <PieceShape piece={piece} size={Math.min(130, window.innerWidth / (round.options.length + 1.5))} />
              </button>
            );
        })}
      </div>
    </div>
  );
};

const same = (a: Sq, b: Sq) => a[0] === b[0] && a[1] === b[1];

/** A small board: the piece's squares glow; tap one to move. Stars to get, apples to eat, or (show) just practise. */
const BoardRound: React.FC<{ round: Extract<Round, { kind: 'board' | 'show' }>; hint: boolean; onDone: () => void; onWrong: () => void }> = ({ round, hint, onDone, onWrong }) => {
  const [at, setAt] = useState<Sq>(round.start);
  const [left, setLeft] = useState<Sq[]>(round.kind === 'board' ? round.targets : []);
  const [gone, setGone] = useState<Sq | null>(null);
  const [taps, setTaps] = useState(0);
  const [wiggle, setWiggle] = useState(false);
  const [finished, setFinished] = useState(false);
  const [munch, setMunch] = useState(false);
  const piece = round.piece;
  const glowOn = round.kind === 'show' || round.glow || hint;
  const legal = useMemo(() => movesFrom(piece, at), [piece, at]);
  const cell = Math.floor(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.58, 600) / BOARD);
  const myColour = (round.start[0] + round.start[1]) % 2;
  const icon = round.kind === 'board' && round.mode === 'apple' ? '🍎' : '⭐';

  const tap = (sq: Sq) => {
    if (finished || same(sq, at)) return;
    if (!canMove(piece, at, sq)) { setWiggle(true); window.setTimeout(() => setWiggle(false), 520); onWrong(); return; }
    setAt(sq);
    if (round.kind === 'show') {
      const n = taps + 1; setTaps(n);
      if (n >= round.taps) { setFinished(true); window.setTimeout(onDone, 450); }
      return;
    }
    const hit = left.find(t => same(t, sq));
    if (hit) {
      const rest = left.filter(t => !same(t, sq));
      window.setTimeout(() => { setGone(hit); setLeft(rest); setMunch(true); }, 300);
      window.setTimeout(() => setMunch(false), 1000);
      window.setTimeout(() => setGone(null), 900);
      if (!rest.length) { setFinished(true); window.setTimeout(onDone, 750); }
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ width: cell * BOARD, height: cell * BOARD, border: '6px solid #78350f' }}>
      {Array.from({ length: BOARD * BOARD }, (_, k) => {
        const sq: Sq = [Math.floor(k / BOARD), k % BOARD];
        const dark = (sq[0] + sq[1]) % 2 === 1;
        const glow = glowOn && legal.some(s => same(s, sq));
        const offColour = piece === 'bishop' && glowOn && (sq[0] + sq[1]) % 2 !== myColour;   // the bishop never leaves its colour
        return (
          <button key={k} type="button" aria-label={`Square ${sq[0] + 1}-${sq[1] + 1}`} onClick={() => tap(sq)}
            className="absolute"
            style={{ left: sq[1] * cell, top: sq[0] * cell, width: cell, height: cell, background: dark ? DARK : LIGHT, opacity: offColour ? 0.35 : 1, transition: 'opacity .3s',
              animation: glow ? 'lc-glow 1.1s ease-in-out infinite' : undefined }} />
        );
      })}
      {left.map(t => (
        <div key={t.join(',')} className="absolute flex items-center justify-center pointer-events-none"
          style={{ left: t[1] * cell, top: t[0] * cell, width: cell, height: cell, fontSize: cell * 0.6, animation: 'lc-float 1.6s ease-in-out infinite' }}>{icon}</div>
      ))}
      {gone && (
        <div className="absolute flex items-center justify-center pointer-events-none"
          style={{ left: gone[1] * cell, top: gone[0] * cell, width: cell, height: cell, fontSize: cell * 0.6, animation: 'lc-gone .6s ease-out forwards' }}>{icon === '🍎' ? '😋' : '✨'}</div>
      )}
      <div className="absolute flex items-center justify-center pointer-events-none"
        style={{ left: at[1] * cell, top: at[0] * cell, width: cell, height: cell, transition: 'left .35s ease-in-out, top .35s ease-in-out', zIndex: 5 }}>
        <PieceShape piece={piece} size={cell * 0.86} mood={munch ? 'munch' : finished ? 'happy' : 'idle'}
          style={{ animation: wiggle ? 'lc-wiggle .5s' : finished ? 'lc-bounce .7s ease-out 2' : undefined }} />
      </div>
    </div>
  );
};

export default LittleChess;
