// src/pages/Minigame/LittleLessons.tsx — Little Lessons (/minigame/lessons), Kiaan's game: chess, sight words
// and numbers, a little at a time. There are no levels to pick: he presses PLAY and the game chooses each
// question from the grown-ups' mix and how he's doing (src/lib/littleLessons/engine.ts), mixing in the next
// level as he gets the current one right and phasing out the one before. The first time a level shows up,
// its character tells a little story.
//   Every instruction is a short CAPITALS sentence that the voice reads (lighting up each word). While it's
// being read the answers aren't on screen at all, so he listens first. A wrong tap turns red with a ✗, says
// what he tapped, and everything waits while he thinks; two quick misses get a calm "SLOW DOWN" pause, and
// after two misses the right answer glows. A sticker after every few questions. Leaving and the grown-ups'
// corner need a 3-second hold.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD, WORD, canMove, cheers, notThereLine, oopsLine, slowLine, clipId, spokenFor, movesFrom, sentenceFor, speakerFor,
  type Piece, type Round, type Speaker, type Sq,
} from '../../lib/littleChess/lessons';
import { castName, levelById, lessonLine, lessonOops, answerOf, type Cast, type Question, type Level } from '../../lib/littleLessons/levels';
import { applySettings, nextQuestion, readProgress, readSettings, recordAnswer, stickerFor, type LessonProgress, type LessonSettings } from '../../lib/littleLessons/engine';
import type { GameProps } from './games';
import { CHARACTER_CSS, Character, type Mood } from './chessCharacters';
import { CastShape, LESSON_CHARACTER_CSS } from './lessonCharacters';
import { clipCount, englishVoices, hush, loadClips, onVoicesReady, say, type VoiceInfo } from './voice';

const BG = 'radial-gradient(120% 80% at 50% 0%, #0f766e 0%, #134e4a 55%, #042f2e 100%)';
const LIGHT = '#f0d9b5', DARK = '#b58863';
const FONT = "'Andika', 'Comic Sans MS', 'Trebuchet MS', system-ui, sans-serif";

// ── the voice: the recorded clip if there is one, else the tablet's most natural voice (or the one a grown-up picked) ──
let chosenVoice: string | null = null, useRecorded = true, playerName = 'Kiaan';
type Line = { text: string; who?: Speaker; said?: string };
/** Say a line: chess lines use their recorded clips; lesson lines are read by the tablet from `said`. */
const talk = (line: Line, on: boolean, onWord?: (i: number) => void, onEnd?: () => void) => {
  const who = line.who || 'narrator';
  say(line.text, line.said
    ? { on, voice: chosenVoice, onWord, spoken: line.said, onEnd }
    : { on, voice: chosenVoice, onWord, clip: clipId(who, line.text), recorded: useRecorded, spoken: spokenFor(who, line.text, playerName), onEnd });
};
const isPiece = (c: Cast): c is Piece => ['rook', 'knight', 'king', 'queen', 'bishop', 'pawn'].includes(c);

// how long things wait (ms)
const READ_AFTER = 1200;      // the sentence is read this long after a question starts
const LISTEN_QUIET = 3000;    // with the voice off, the answers come out after this long
const THINK = 2500;           // after a wrong tap, everything waits at least this long (and until the oops is said)
const SLOW = 4000;            // the "SLOW DOWN" pause
const QUICK_MISS = 1500;      // missing again this soon after the answers come back counts as mashing
const VOICE_MAX = 9000;       // never wait longer than this for the voice to finish
const STORY_MAX = 25000;      // (a story is longer)

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

/** The sentence at the top, in big capitals, one word lit at a time while it's read. */
const Sentence: React.FC<{ text: string; lit: number; flash?: string | null }> = ({ text, lit, flash }) => (
  <div className="text-center font-black tracking-wide px-4" style={{ fontSize: 'clamp(34px, 6.5vw, 64px)', fontFamily: FONT, minHeight: '1.3em' }}>
    {flash ? <span style={{ color: '#fca5a5', display: 'inline-block', animation: 'lc-pop .35s ease-out' }}>{flash}</span> : text.split(' ').map((w, i) => (
      <React.Fragment key={i}>{i > 0 && ' '}
        <span className="inline-block mx-[0.1em] transition-transform" style={{ color: i === lit ? '#fde047' : '#fff', transform: i === lit ? 'scale(1.12)' : 'none' }}>{w}</span>
      </React.Fragment>
    ))}
  </div>
);

const CSS = `
  @keyframes lc-bounce { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-18%) scale(1.06) } 70% { transform: translateY(2%) } }
  @keyframes lc-wiggle { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-9deg) } 40% { transform: rotate(8deg) } 60% { transform: rotate(-6deg) } 80% { transform: rotate(4deg) } }
  @keyframes lc-glow { 0%,100% { box-shadow: inset 0 0 0 6px rgba(253,224,71,.95), 0 0 18px rgba(253,224,71,.6) } 50% { box-shadow: inset 0 0 0 10px rgba(253,224,71,.55), 0 0 6px rgba(253,224,71,.2) } }
  @keyframes lc-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
  @keyframes lc-gone { 0% { transform: scale(1); opacity: 1 } 100% { transform: scale(1.8); opacity: 0 } }
  @keyframes lc-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
  @keyframes lc-red { 0%,100% { background: rgba(239,68,68,.75) } 50% { background: rgba(239,68,68,.35) } }
  @keyframes lc-breathe { 0%,100% { transform: scale(.75) } 50% { transform: scale(1.15) } }
  @keyframes lc-think { 0%,100% { transform: translateY(0) rotate(-4deg) } 50% { transform: translateY(-8px) rotate(4deg) } }
  @keyframes ll-flyaway { 0% { transform: translate(0,0) rotate(0); opacity: 1 } 100% { transform: translate(60px,-140px) rotate(25deg); opacity: 0 } }
  @keyframes ll-in { 0% { transform: translateY(24px); opacity: 0 } 100% { transform: none; opacity: 1 } }
  ${CHARACTER_CSS}
  ${LESSON_CHARACTER_CSS}
`;

type Run = { left: number; total: number; q: Question; index: number; story: boolean };

const LittleLessons: React.FC<GameProps<Partial<LessonProgress>>> = ({ progress, save, exit, player, allProgress }) => {
  useEffect(() => { const was = document.title; document.title = 'Little Lessons'; return () => { document.title = was; hush(); }; }, []);
  const settings: LessonSettings = useMemo(() => readSettings(allProgress?.lessons_settings as Partial<LessonSettings> | undefined), [allProgress?.lessons_settings]);
  const [p, setP] = useState<LessonProgress>(() => applySettings(readProgress(progress as LessonProgress | null, (allProgress?.chess as Record<string, unknown>) || null), settings));
  const pRef = useRef(p); pRef.current = p;
  const [run, setRun] = useState<Run | null>(null);
  const [sticker, setSticker] = useState<string | null>(null);
  const [grownups, setGrownups] = useState(false);
  const update = useCallback((next: LessonProgress) => { pRef.current = next; setP(next); save(next); }, [save]);
  chosenVoice = p.voiceName; useRecorded = p.recorded; playerName = player;
  useEffect(() => { loadClips(); }, []);
  // a grown-up changed a level while this was open (saved settings arrive with the next sign-in or reload)
  useEffect(() => { const n = applySettings(pRef.current, settings); if (n !== pRef.current) update(n); }, [settings, update]);

  const ask = (left: number, total: number): Run => {
    const { q, index } = nextQuestion(pRef.current, settings);
    return { left, total, q, index, story: !pRef.current.told.includes(q.level) };
  };
  const start = () => setRun(ask(settings.session, settings.session));
  const heardStory = () => {
    if (!run) return;
    if (!pRef.current.told.includes(run.q.level)) update({ ...pRef.current, told: [...pRef.current.told, run.q.level] });
    setRun({ ...run, story: false });
  };
  const answered = (right: boolean) => {
    if (!run) return;
    const next = recordAnswer(pRef.current, settings, run.q.subject, run.index, right, run.q.level);
    if (run.left <= 1) {
      const got = stickerFor(next);
      update({ ...next, stickers: [...next.stickers, got] });
      setRun(null); setSticker(got);
      talk({ text: `${player.toUpperCase()} GOT A STICKER!` }, next.voice);
      return;
    }
    update(next);
    pRef.current = next;
    setRun(ask(run.left - 1, run.total));
  };

  const level = run ? levelById(run.q.level) : null;
  return (
    <div className="min-h-screen w-full text-white select-none overflow-hidden" style={{ background: BG, fontFamily: FONT, WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <style>{CSS}</style>
      {run && level && run.story
        ? <StoryCard key={`story-${level.id}`} level={level} voice={p.voice} onDone={heardStory} onQuit={() => { hush(); setRun(null); }} />
        : run
          ? <Play key={`${run.left}-${run.q.level}`} q={run.q} at={run.total - run.left} total={run.total} name={player} voice={p.voice} onDone={answered} onQuit={() => { hush(); setRun(null); }} />
          : <Home p={p} name={player} onPlay={start} onExit={() => { hush(); exit(); }} onGrownups={() => setGrownups(true)} />}

      {sticker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setSticker(null)}>
          <div className="rounded-[40px] bg-teal-950/95 border-4 border-yellow-300 px-10 py-8 text-center shadow-2xl" style={{ animation: 'lc-pop .5s ease-out' }}>
            <div style={{ fontSize: 'clamp(110px, 22vw, 200px)', lineHeight: 1, animation: 'lc-float 2s ease-in-out infinite' }}>{sticker}</div>
            <div className="font-black mt-4" style={{ fontSize: 'clamp(30px, 5vw, 52px)' }}>{player.toUpperCase()} GOT A STICKER!</div>
            <button type="button" onClick={e => { e.stopPropagation(); setSticker(null); }} className="mt-6 px-10 py-4 rounded-full bg-yellow-300 text-teal-950 font-black text-3xl">YAY!</button>
          </div>
        </div>
      )}
      {grownups && <Grownups p={p} onChange={update} onClose={() => setGrownups(false)} />}
    </div>
  );
};

// ── home: the big PLAY button, his friends, and the sticker book ──
const Home: React.FC<{ p: LessonProgress; name: string; onPlay: () => void; onExit: () => void; onGrownups: () => void }> = ({ p, name, onPlay, onExit, onGrownups }) => (
  <div className="max-w-4xl mx-auto px-4 pb-10" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
    <div className="flex items-center justify-between">
      <HoldButton onHold={onExit} label="Hold to leave">‹</HoldButton>
      <div className="font-black text-3xl tracking-wide">LITTLE LESSONS</div>
      <HoldButton onHold={onGrownups} label="Hold for grown-ups">⚙</HoldButton>
    </div>
    <div className="flex items-end justify-center gap-2 mt-6" aria-hidden="true">
      <CastShape who="ollie" size={110} style={{ animation: 'lc-float 2.6s ease-in-out infinite' }} />
      <Character piece="knight" size={120} style={{ animation: 'lc-float 2.2s ease-in-out infinite' }} />
      <CastShape who="benny" size={110} style={{ animation: 'lc-float 2.9s ease-in-out infinite' }} />
      <CastShape who="zip" size={104} style={{ animation: 'lc-float 2.4s ease-in-out infinite' }} />
    </div>
    <button type="button" onClick={onPlay}
      className="mt-4 w-full rounded-[36px] bg-yellow-300 text-teal-950 py-6 px-6 flex items-center justify-center gap-6 shadow-xl active:scale-[.98] transition"
      style={{ animation: 'lc-float 2.4s ease-in-out infinite' }}>
      <span style={{ fontSize: 'clamp(64px, 11vw, 100px)', lineHeight: 1 }}>▶</span>
      <span className="block font-black" style={{ fontSize: 'clamp(48px, 9vw, 84px)', lineHeight: 1 }}>PLAY</span>
    </button>
    <div className="mt-8">
      <div className="font-black text-xl text-teal-100">{name.toUpperCase()}'S STICKERS</div>
      <div className="mt-2 flex flex-wrap gap-2 rounded-3xl bg-white/10 p-3 min-h-[76px]">
        {p.stickers.length ? p.stickers.map((s, i) => <span key={i} className="text-5xl leading-none">{s}</span>)
          : <span className="text-teal-100/70 text-lg self-center px-2">Play to get a sticker!</span>}
      </div>
    </div>
  </div>
);

/** Grown-ups' corner on the tablet: the voice. (His lesson mix is on the grown-ups' "Kiaan's lessons" page.) */
const Grownups: React.FC<{ p: LessonProgress; onChange: (p: LessonProgress) => void; onClose: () => void }> = ({ p, onChange, onClose }) => {
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
            <div className="text-sm">Tablet voice</div>
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
        <div className="text-sm text-gray-600 mt-5 border-t pt-4">The lesson mix and his progress are on the grown-ups' <b>Kiaan's lessons</b> page: sign in as a grown-up on the Minigames page.</div>
        <button type="button" onClick={onClose} className="mt-6 w-full py-3 rounded-2xl bg-teal-700 text-white font-semibold">Done</button>
      </div>
    </div>
  );
};

// ── a level's little story, the first time it shows up ──
const StoryCard: React.FC<{ level: Level; voice: boolean; onDone: () => void; onQuit: () => void }> = ({ level, voice, onDone, onQuit }) => {
  const [ready, setReady] = useState(false);
  const [lit, setLit] = useState(-1);
  useEffect(() => {
    let done = false;
    const go = () => { if (!done) { done = true; setReady(true); } };
    const t1 = window.setTimeout(() => talk({ text: level.story.lines.join(' '), said: level.story.said }, voice, undefined, go), 600);
    const t2 = window.setTimeout(go, voice ? STORY_MAX : 4000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); hush(); };
  }, [level, voice]);
  useEffect(() => { if (ready) return; const t = window.setInterval(() => setLit(n => (n + 1) % 6), 700); return () => window.clearInterval(t); }, [ready]);
  return (
    <div className="min-h-screen flex flex-col" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between px-4"><HoldButton onHold={onQuit} label="Hold to stop">‹</HoldButton><div className="w-14" /></div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="rounded-[48px] bg-white/10 px-12 py-6" style={{ animation: 'lc-pop .5s ease-out' }}>
          <CastShape who={level.cast} size={Math.min(280, window.innerHeight * 0.34)} mood={lit % 2 ? 'happy' : 'idle'} style={{ animation: 'lc-bounce 1.4s ease-in-out infinite' }} />
        </div>
        <div className="mt-2 font-black text-yellow-300 text-2xl tracking-widest">{castName(level.cast)}</div>
        {level.story.lines.map((l, i) => (
          <div key={i} className="font-black mt-3" style={{ fontSize: i === 0 ? 'clamp(34px, 6vw, 60px)' : 'clamp(26px, 4.5vw, 44px)', animation: `ll-in .5s ease-out ${0.3 + i * 0.6}s both` }}>{l}</div>
        ))}
        <div className="mt-8 min-h-[96px] flex items-center">
          {ready
            ? <button type="button" onClick={onDone} className="px-14 py-5 rounded-full bg-yellow-300 text-teal-950 font-black text-4xl shadow-xl" style={{ animation: 'lc-pop .4s ease-out' }}>GO!</button>
            : <div className="rounded-full px-5 py-2 font-black flex items-center gap-2" style={{ background: 'rgba(255,255,255,.92)', color: '#134e4a', fontSize: 30 }}>
                <span style={{ fontSize: 40, display: 'inline-block', animation: 'lc-think 1.6s ease-in-out infinite' }}>👂</span>LISTEN.</div>}
        </div>
      </div>
    </div>
  );
};

// ── one question ──
type Lock = 'listen' | 'think' | 'slow' | null;
const LOCK_ICON: Record<Exclude<Lock, null>, string> = { listen: '👂', think: '💭', slow: '🐢' };
const isChess = (q: Question): q is Round & Question => !['sight', 'count', 'countAdd', 'countSub', 'add', 'sub'].includes(q.kind);

const Play: React.FC<{ q: Question; at: number; total: number; name: string; voice: boolean; onDone: (right: boolean) => void; onQuit: () => void }> = ({ q, at, total, name, voice, onDone, onQuit }) => {
  const [lit, setLit] = useState(-1);
  const [flash, setFlash] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [cheer, setCheer] = useState<string | null>(null);
  const [lock, setLockState] = useState<Lock>(null);
  const [poke, setPoke] = useState(0);
  const line: Line = isChess(q) ? { text: sentenceFor(q), who: speakerFor(q) } : (() => { const l = lessonLine(q)!; return { text: l.text, said: l.said }; })();
  const idle = useRef<number | null>(null);
  const lockRef = useRef<Lock>(null);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const misses = useRef<number[]>([]);
  const woke = useRef(0);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const setLock = (l: Lock) => { lockRef.current = l; setLockState(l); };

  // if nothing happens for a while, hint and read again (never while he's waiting)
  const nudge = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current);
    if (lockRef.current) return;
    idle.current = window.setTimeout(() => { setHint(true); talk(line, voice, setLit); }, 9000);
  }, [line.text, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Wait (answers away) for at least `ms`, and until `say` has been said; then bring them back. */
  const wait = (kind: Exclude<Lock, null>, ms: number, sayIt?: Line & { words?: boolean }, delay = 0) => {
    const id = ++seq.current;
    if (idle.current) window.clearTimeout(idle.current);
    setLock(kind);
    let said = !sayIt || !voice, waited = false;
    const wake = () => {
      if (seq.current !== id || !said || !waited) return;
      if (kind !== 'listen') woke.current = Date.now();
      setLock(null); setFlash(null); nudge();
    };
    later(() => { waited = true; wake(); }, ms);
    if (sayIt && voice) {
      later(() => { if (seq.current === id) talk(sayIt, voice, sayIt.words ? setLit : undefined, () => { said = true; wake(); }); }, delay);
      later(() => { said = true; wake(); }, delay + VOICE_MAX);
    }
  };

  useEffect(() => {
    wait('listen', voice ? READ_AFTER : LISTEN_QUIET, { ...line, words: true }, READ_AFTER);
    return () => { seq.current++; timers.current.forEach(t => window.clearTimeout(t)); timers.current = []; if (idle.current) window.clearTimeout(idle.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** A wrong tap: say what he tapped, then wait while he thinks (or the calm SLOW DOWN if he's mashing). */
  const oops = (tapped?: Piece | number | string) => {
    const now = Date.now();
    const quick = misses.current.length > 0 && now - woke.current < QUICK_MISS;
    misses.current.push(now);
    if (misses.current.length >= 2) setHint(true);
    try { navigator.vibrate?.([30, 60, 30]); } catch { /* ignore */ }
    if (quick) { const l = slowLine(name); setFlash(l); wait('slow', SLOW, { text: l }); return; }
    const l: Line = isChess(q)
      ? { text: typeof tapped === 'string' && tapped in WORD ? oopsLine(tapped as Piece) : notThereLine(q.piece) }
      : (() => { const o = lessonOops(q, tapped as number | string); return { text: o.text, said: o.said }; })();
    setFlash(l.text);
    wait('think', THINK, l);
  };
  const won = () => {
    seq.current++; setLock(null);
    if (idle.current) window.clearTimeout(idle.current);
    setFlash(null);
    const c = cheers(name)[Math.floor(Math.random() * 5)];
    setCheer(c); talk({ text: c, who: isPiece(q.cast) ? q.cast : 'narrator' }, voice);
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
    const right = misses.current.length === 0;
    window.setTimeout(() => { setCheer(null); onDone(right); }, 1500);
  };
  const listening = lock === 'listen';
  const replay = () => { if (!lockRef.current) talk(line, voice, setLit); };

  return (
    <div className="min-h-screen flex flex-col" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between px-4">
        <HoldButton onHold={onQuit} label="Hold to stop">‹</HoldButton>
        <div className="flex gap-2">{Array.from({ length: total }, (_, k) => <span key={k} className={`w-4 h-4 rounded-full ${k < at ? 'bg-yellow-300' : k === at ? '' : 'bg-white/25'}`} style={k === at ? { background: '#fff' } : undefined} />)}</div>
        <button type="button" onClick={replay} aria-label="Say it again" className="w-14 h-14 rounded-full bg-white/10 text-3xl" disabled={!voice}>🔊</button>
      </div>
      <div className="mt-4"><Sentence text={line.text} lit={lit} flash={flash} /></div>
      <div className="relative flex-1 flex items-center justify-center p-4" onPointerDown={() => nudge()}>
        <div className="flex items-center justify-center">
          {q.kind === 'find' && <Find round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'word' && <Word round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'shadow' || q.kind === 'peek') && <Guess round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'board' || q.kind === 'show') && <BoardRound round={q} hint={hint} listening={listening} onDone={won} onWrong={() => oops()} />}
          {q.kind === 'sight' && <Sight q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'count' || q.kind === 'countAdd' || q.kind === 'countSub' || q.kind === 'add' || q.kind === 'sub') &&
            <Numbers q={q} hint={hint} listening={listening} voice={voice} onRight={won} onWrong={oops} />}
        </div>
        {/* while he thinks, taps land here and do nothing (the icon just wiggles); while listening the answers aren't out yet */}
        {lock && lock !== 'slow' && (
          <div data-testid="lc-wait" aria-label={lock === 'listen' ? 'Listen first' : 'Think about it'} className="absolute inset-0 z-20 flex items-start justify-center pt-2"
            onPointerDown={e => { e.stopPropagation(); setPoke(n => n + 1); }}>
            <div key={poke} className="rounded-full px-5 py-2 font-black flex items-center gap-2" style={{ background: 'rgba(255,255,255,.92)', color: '#134e4a', fontSize: 30, animation: poke ? 'lc-wiggle .5s' : 'lc-pop .3s ease-out' }}>
              <span style={{ fontSize: 40, display: 'inline-block', animation: 'lc-think 1.6s ease-in-out infinite' }}>{LOCK_ICON[lock]}</span>
              {lock === 'listen' ? 'LISTEN.' : 'THINK.'}
            </div>
          </div>
        )}
      </div>
      {lock === 'slow' && (
        <div data-testid="lc-slow" className="fixed inset-0 z-30 flex flex-col items-center justify-center" style={{ background: 'rgba(4,47,46,.82)' }} onPointerDown={e => e.stopPropagation()}>
          <div className="rounded-full flex items-center justify-center" style={{ width: 220, height: 220, background: 'radial-gradient(circle, #5eead4 0%, #0d9488 70%)', boxShadow: '0 0 60px rgba(94,234,212,.5)', animation: 'lc-breathe 4s ease-in-out infinite' }}>
            <span style={{ fontSize: 110, lineHeight: 1 }}>🐢</span>
          </div>
          <div className="font-black text-center mt-8 px-4" style={{ fontSize: 'clamp(40px, 8vw, 72px)', color: '#fff' }}>{slowLine(name)}</div>
          <div className="font-black text-teal-100 mt-2" style={{ fontSize: 'clamp(26px, 5vw, 40px)' }}>BIG BREATH.</div>
        </div>
      )}
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

// ── answer pieces shared by the rounds ──
const WordCard: React.FC<{ word: string; big?: boolean; glow?: boolean; wiggle?: boolean; crossed?: boolean; onClick?: () => void; lower?: boolean }> = ({ word, big, glow, wiggle, crossed, onClick, lower }) => {
  const El = onClick ? 'button' : 'div';
  return (
    <El {...(onClick ? { type: 'button' as const, onClick } : {})}
      className="relative mt-4 rounded-3xl font-black tracking-wider px-8 py-3"
      style={{ background: crossed ? '#fecaca' : '#fff', color: crossed ? '#b91c1c' : '#042f2e', fontSize: big ? 'clamp(44px, 8vw, 80px)' : 'clamp(36px, 6vw, 60px)',
        boxShadow: crossed ? 'inset 0 0 0 5px #ef4444' : undefined, opacity: crossed && !wiggle ? 0.6 : 1, textDecoration: crossed ? 'line-through' : undefined,
        textTransform: lower ? 'none' : undefined, animation: wiggle ? 'lc-wiggle .5s' : glow ? 'lc-glow 1.1s ease-in-out infinite' : 'll-in .35s ease-out' }}>
      {word}
      {crossed && <Cross />}
    </El>
  );
};
const Cross: React.FC = () => (
  <span className="absolute -top-3 -right-3 w-11 h-11 rounded-full flex items-center justify-center font-black text-2xl pointer-events-none"
    style={{ background: '#ef4444', color: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.3)', animation: 'lc-pop .35s ease-out' }}>✗</span>
);
const wrongTile = (crossed: boolean, wiggling: boolean): React.CSSProperties => crossed
  ? { background: 'rgba(239,68,68,.25)', boxShadow: 'inset 0 0 0 5px #ef4444', opacity: wiggling ? 1 : 0.6, animation: wiggling ? 'lc-wiggle .5s' : undefined, transform: wiggling ? undefined : 'scale(.86)', transition: 'transform .4s, opacity .4s' }
  : {};
const NameTag: React.FC<{ piece: Piece }> = ({ piece }) => (
  <span className="absolute left-1/2 -bottom-4 -translate-x-1/2 rounded-full px-3 py-0.5 font-black text-lg whitespace-nowrap pointer-events-none"
    style={{ background: '#ef4444', color: '#fff', animation: 'lc-pop .35s ease-out' }}>{WORD[piece]}</span>
);
function useWrong() {
  const [wrong, setWrong] = useState<number | null>(null);
  const [crossed, setCrossed] = useState<number[]>([]);
  const flag = (k: number) => { setWrong(k); setCrossed(c => (c.includes(k) ? c : [...c, k])); window.setTimeout(() => setWrong(null), 520); };
  return [wrong, flag, crossed] as const;
}
const PieceShape: React.FC<{ piece: Piece; size: number; mood?: Mood; style?: React.CSSProperties }> = ({ piece, size, mood, style }) => <Character piece={piece} size={size} mood={mood} style={style} />;
/** Where the answers go: empty (with an ear) while he listens. */
const Answers: React.FC<{ listening: boolean; children: React.ReactNode; className?: string }> = ({ listening, children, className }) =>
  listening ? <div className="min-h-[120px]" aria-hidden="true" /> : <div className={className}>{children}</div>;

// ── chess rounds ──
const Find: React.FC<{ round: Extract<Round, { kind: 'find' }>; hint: boolean; listening: boolean; onRight: () => void; onWrong: (tapped: Piece) => void }> = ({ round, hint, listening, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  const size = Math.min(200, window.innerWidth / (round.options.length + 1));
  if (listening) return <div className="rounded-[48px] bg-white/10 px-12 py-10 text-[120px] leading-none" aria-hidden="true">🔎</div>;
  return (
    <div className="flex flex-wrap justify-center gap-5">
      {round.options.map((piece, k) => {
        const right = piece === round.piece;
        return (
          <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(piece); } }}
            className="relative rounded-[36px] bg-white/10 p-5"
            style={{ animation: got && right ? 'lc-bounce .7s ease-out 2' : hint && right ? 'lc-glow 1.1s ease-in-out infinite' : 'll-in .35s ease-out', ...wrongTile(crossed.includes(k), wrong === k) }}>
            <PieceShape piece={piece} size={size} mood={got && right ? 'happy' : 'idle'} />
            {crossed.includes(k) && <><Cross /><NameTag piece={piece} /></>}
          </button>
        );
      })}
    </div>
  );
};

const Word: React.FC<{ round: Extract<Round, { kind: 'word' }>; hint: boolean; listening: boolean; onRight: () => void; onWrong: (tapped: Piece) => void }> = ({ round, hint, listening, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[48px] bg-white/10 px-10 py-4"><PieceShape piece={round.piece} size={Math.min(250, window.innerHeight * 0.28)} mood={got ? 'happy' : 'idle'} /></div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-4">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return <WordCard key={k} word={WORD[piece]} wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right}
            onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(piece); } }} />;
        })}
      </Answers>
    </div>
  );
};

const Guess: React.FC<{ round: Extract<Round, { kind: 'shadow' | 'peek' }>; hint: boolean; listening: boolean; onRight: () => void; onWrong: (tapped: Piece) => void }> = ({ round, hint, listening, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  const big = Math.min(260, window.innerHeight * 0.3);
  const tap = (k: number, right: boolean) => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(round.options[k]); } };
  const hidden = round.kind === 'shadow'
    ? <PieceShape piece={round.piece} size={big} mood={got ? 'happy' : 'idle'}
        style={{ filter: got ? 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' : 'brightness(0) opacity(.8)', transition: 'filter .5s', animation: got ? 'lc-bounce .7s ease-out 2' : undefined }} />
    : (
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
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-5">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return round.answer === 'word'
            ? <WordCard key={k} word={WORD[piece]} wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right} onClick={() => tap(k, right)} />
            : (
              <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => tap(k, right)} className="relative rounded-[32px] bg-white/10 p-4"
                style={{ animation: hint && right && !got ? 'lc-glow 1.1s ease-in-out infinite' : 'll-in .35s ease-out', ...wrongTile(crossed.includes(k), wrong === k) }}>
                <PieceShape piece={piece} size={Math.min(130, window.innerWidth / (round.options.length + 1.5))} />
                {crossed.includes(k) && <><Cross /><NameTag piece={piece} /></>}
              </button>
            );
        })}
      </Answers>
    </div>
  );
};

const same = (a: Sq, b: Sq) => a[0] === b[0] && a[1] === b[1];

/** A small board: the piece's squares glow; tap one to move. Stars to get, apples to eat, or (show) just practise.
 *  While he listens only the piece is out; the board comes after. */
const BoardRound: React.FC<{ round: Extract<Round, { kind: 'board' | 'show' }>; hint: boolean; listening: boolean; onDone: () => void; onWrong: () => void }> = ({ round, hint, listening, onDone, onWrong }) => {
  const [at, setAt] = useState<Sq>(round.start);
  const [left, setLeft] = useState<Sq[]>(round.kind === 'board' ? round.targets : []);
  const [gone, setGone] = useState<Sq | null>(null);
  const [taps, setTaps] = useState(0);
  const [wiggle, setWiggle] = useState(false);
  const [finished, setFinished] = useState(false);
  const [munch, setMunch] = useState(false);
  const [bad, setBad] = useState<Sq | null>(null);
  const piece = round.piece;
  const glowOn = round.kind === 'show' || round.glow || hint;
  const legal = useMemo(() => movesFrom(piece, at), [piece, at]);
  const cell = Math.floor(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.58, 600) / BOARD);
  const myColour = (round.start[0] + round.start[1]) % 2;
  const icon = round.kind === 'board' && round.mode === 'apple' ? '🍎' : '⭐';
  if (listening) return <div className="rounded-[48px] bg-white/10 px-12 py-6"><PieceShape piece={piece} size={Math.min(260, window.innerHeight * 0.32)} style={{ animation: 'lc-float 2s ease-in-out infinite' }} /></div>;

  const tap = (sq: Sq) => {
    if (finished || same(sq, at)) return;
    if (!canMove(piece, at, sq)) {
      setWiggle(true); window.setTimeout(() => setWiggle(false), 520);
      setBad(sq); window.setTimeout(() => setBad(b => (b === sq ? null : b)), 2200);
      onWrong(); return;
    }
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
    <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ width: cell * BOARD, height: cell * BOARD, border: '6px solid #78350f', animation: 'll-in .35s ease-out' }}>
      {Array.from({ length: BOARD * BOARD }, (_, k) => {
        const sq: Sq = [Math.floor(k / BOARD), k % BOARD];
        const dark = (sq[0] + sq[1]) % 2 === 1;
        const glow = glowOn && legal.some(s => same(s, sq));
        const offColour = piece === 'bishop' && glowOn && (sq[0] + sq[1]) % 2 !== myColour;
        return (
          <button key={k} type="button" aria-label={`Square ${sq[0] + 1}-${sq[1] + 1}`} onClick={() => tap(sq)} className="absolute"
            style={{ left: sq[1] * cell, top: sq[0] * cell, width: cell, height: cell, background: dark ? DARK : LIGHT, opacity: offColour ? 0.35 : 1, transition: 'opacity .3s',
              animation: glow ? 'lc-glow 1.1s ease-in-out infinite' : undefined }} />
        );
      })}
      {left.map(t => (
        <div key={t.join(',')} className="absolute flex items-center justify-center pointer-events-none"
          style={{ left: t[1] * cell, top: t[0] * cell, width: cell, height: cell, fontSize: cell * 0.6, animation: 'lc-float 1.6s ease-in-out infinite' }}>{icon}</div>
      ))}
      {bad && (
        <div data-testid="lc-bad" className="absolute flex items-center justify-center pointer-events-none font-black"
          style={{ left: bad[1] * cell, top: bad[0] * cell, width: cell, height: cell, fontSize: cell * 0.55, color: '#fff', zIndex: 4, animation: 'lc-red .6s ease-in-out 3', background: 'rgba(239,68,68,.6)', boxShadow: 'inset 0 0 0 5px #ef4444' }}>✗</div>
      )}
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

// ── sight words with Ollie: hear the word, then find its card ──
const Sight: React.FC<{ q: Extract<Question, { kind: 'sight' }>; hint: boolean; listening: boolean; onRight: () => void; onWrong: (tapped: string) => void }> = ({ q, hint, listening, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-[48px] bg-white/10 px-10 py-4">
        <CastShape who="ollie" size={Math.min(230, window.innerHeight * 0.27)} mood={got ? 'happy' : 'idle'} style={{ animation: got ? 'lc-bounce .7s ease-out 2' : 'lc-float 2.2s ease-in-out infinite' }} />
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-2">
        {q.options.map((w, k) => {
          const right = w === q.word;
          return <WordCard key={k} word={w} big lower wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right}
            onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(w); } }} />;
        })}
      </Answers>
    </div>
  );
};

// ── numbers with Benny and Zip: count the things (tap each one to count it), or work out the sum ──
type NumQ = Extract<Question, { kind: 'count' | 'countAdd' | 'countSub' | 'add' | 'sub' }>;
const Things: React.FC<{ n: number; thing: string; size: number; gone?: number; counting?: boolean; voice: boolean }> = ({ n, thing, size, gone = 0, counting, voice }) => {
  const [tapped, setTapped] = useState<number[]>([]);
  const left = n - gone;
  const tap = (i: number) => {
    if (!counting || i >= left || tapped.includes(i)) return;
    const next = [...tapped, i];
    setTapped(next);
    talk({ text: String(next.length), said: String(next.length) }, voice);
  };
  // rows of five, with a gap after each ten
  return (
    <div className="flex flex-col items-center gap-1">
      {Array.from({ length: Math.ceil(n / 5) }, (_, row) => (
        <div key={row} className="flex gap-1" style={{ marginTop: row && row % 2 === 0 ? 10 : 0 }}>
          {Array.from({ length: Math.min(5, n - row * 5) }, (_, c) => {
            const i = row * 5 + c, away = i >= left, mark = tapped.indexOf(i);
            return (
              <button key={i} type="button" onClick={() => tap(i)} aria-label={away ? 'gone' : 'count it'} className="relative leading-none"
                style={{ fontSize: size, width: size * 1.2, height: size * 1.2, animation: away ? 'll-flyaway 1.2s ease-in 1.4s forwards' : 'll-in .4s ease-out both', animationDelay: away ? undefined : `${i * 0.05}s` }}>
                {thing}
                {mark >= 0 && <span className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-yellow-300 text-teal-950 text-base font-black flex items-center justify-center">{mark + 1}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const Numbers: React.FC<{ q: NumQ; hint: boolean; listening: boolean; voice: boolean; onRight: () => void; onWrong: (tapped: number) => void }> = ({ q, hint, listening, voice, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  const answer = answerOf(q) as number;
  const most = q.kind === 'count' ? q.n : q.kind === 'countAdd' ? Math.max(q.a, q.b) : q.kind === 'countSub' ? q.a : 0;
  const size = Math.max(30, Math.min(most <= 5 ? 92 : 64, (window.innerWidth * 0.8) / (most > 10 ? 7 : most <= 5 ? 5 : 6.5)));
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-4">
        <CastShape who={q.cast} size={Math.min(190, window.innerHeight * 0.24)} mood={got ? 'happy' : 'idle'} style={{ animation: got ? 'lc-bounce .7s ease-out 2' : 'lc-float 2.2s ease-in-out infinite' }} />
        <div className="rounded-[36px] bg-white/10 px-5 py-4">
          {q.kind === 'count' && <Things n={q.n} thing={q.thing} size={size} counting={!listening} voice={voice} />}
          {q.kind === 'countAdd' && (
            <div className="flex items-center gap-3">
              <Things n={q.a} thing={q.thing} size={size * 0.85} voice={voice} />
              <span className="font-black text-5xl text-yellow-300">+</span>
              <Things n={q.b} thing={q.thing} size={size * 0.85} voice={voice} />
            </div>)}
          {q.kind === 'countSub' && <Things n={q.a} thing={q.thing} size={size} gone={q.b} voice={voice} />}
          {(q.kind === 'add' || q.kind === 'sub') && (
            <div className="font-black text-center" style={{ fontSize: 'clamp(64px, 14vw, 140px)', lineHeight: 1 }}>
              {q.a} <span className="text-yellow-300">{q.kind === 'add' ? '+' : '−'}</span> {q.b} <span className="text-teal-200">=</span> <span className="text-yellow-300">{got ? answer : '?'}</span>
            </div>)}
        </div>
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-5 mt-6">
        {q.options.map((n, k) => {
          const right = n === answer;
          return (
            <button key={k} type="button" aria-label={String(n)} onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(n); } }}
              className="relative rounded-full font-black flex flex-col items-center justify-center"
              style={{ width: 'clamp(96px, 18vw, 150px)', height: 'clamp(96px, 18vw, 150px)', background: crossed.includes(k) ? '#fecaca' : '#fff', color: crossed.includes(k) ? '#b91c1c' : '#042f2e',
                fontSize: 'clamp(48px, 9vw, 80px)', lineHeight: 1, opacity: crossed.includes(k) && wrong !== k ? 0.6 : 1,
                animation: wrong === k ? 'lc-wiggle .5s' : (hint || got) && right ? 'lc-glow 1.1s ease-in-out infinite' : 'll-in .35s ease-out' }}>
              {n}
              {q.kind === 'count' && q.dots && <span className="text-sm tracking-tighter" style={{ color: '#0d9488' }}>{'●'.repeat(n)}</span>}
              {crossed.includes(k) && <Cross />}
            </button>
          );
        })}
      </Answers>
    </div>
  );
};

export default LittleLessons;
