// src/pages/Minigame/LittleLessons.tsx — Little Lessons (/minigame/lessons), Kiaan's game: chess, sight words
// and numbers, a little at a time. There are no levels to pick: he presses PLAY and the game deals lessons —
// a short run of 3–5 questions of one little game — from the grown-ups' mix and how he's doing
// (src/lib/littleLessons/engine.ts), mixing in the next level as he gets the current one right and phasing
// out the one before. Each level has a deck of different games, so it keeps changing. The first time a
// level shows up its character tells a little story (and each chess piece says hello as it joins).
//   Every instruction is a short CAPITALS sentence that the voice reads (lighting up each word). While it's
// being read the answers aren't on screen at all, so he listens first. A wrong tap turns red with a ✗, says
// what he tapped, and everything waits while he thinks; two quick misses get a calm "SLOW DOWN" pause, and
// after two misses the right answer glows. A sticker after every few questions. Leaving and the grown-ups'
// corner need a 3-second hold.
//   The characters act it out: whoever asks the question walks in, says it with a moving mouth, sways while
// he thinks, jumps for joy when he gets it, and looks worried (then encourages him) after a miss. The
// answers pop in one by one; counted things hop; word cards flip in.
import { createPortal } from 'react-dom';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD, WORD, canMove, cheers, notThereLine, oopsLine, slowLine, clipId, spokenFor, movesFrom, sentenceFor,
  type Piece, type Round, type Speaker, type Sq,
} from '../../lib/littleChess/lessons';
import { castName, chessHost, countAloud, lessonLine, lessonOops, storyLine, answerOf, type Cast, type Question, type Intro, type ChessRound } from '../../lib/littleLessons/levels';
import { applySettings, lessonQuestion, lessonStarted, nextLesson, readProgress, readSettings, recordAnswer, stickerFor, type LessonPlan, type LessonProgress, type LessonSettings } from '../../lib/littleLessons/engine';
import type { GameProps } from './games';
import { CHARACTER_CSS, Character, type Mood } from './chessCharacters';
import { CastShape, LESSON_CHARACTER_CSS } from './lessonCharacters';
import { clipCount, englishVoices, hush, loadClips, onSpeaking, onVoicesReady, say, type VoiceInfo } from './voice';

const BG = 'radial-gradient(120% 80% at 50% 0%, #0f766e 0%, #134e4a 55%, #042f2e 100%)';
const LIGHT = '#f0d9b5', DARK = '#b58863';
const FONT = "'Andika', 'Comic Sans MS', 'Trebuchet MS', system-ui, sans-serif";

// ── the voice: the recorded clip if there is one, else the tablet's most natural voice (or the one a grown-up picked) ──
let chosenVoice: string | null = null, useRecorded = true, playerName = 'Kiaan';
type Line = { text: string; who?: Speaker | Cast; said?: string; key?: string };
/** Say a line: its recorded clip (chess lines are named by their text, lesson lines by `key`), or the
 *  tablet reads the full sentence. */
const talk = (line: Line, on: boolean, onWord?: (i: number) => void, onEnd?: () => void) => {
  const who = (line.who || 'narrator') as Speaker;
  say(line.text, {
    on, voice: chosenVoice, onWord, onEnd, recorded: useRecorded,
    clip: clipId(who, line.key || line.text),
    spoken: line.said || spokenFor(who, line.text, playerName),
  });
};

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
  @keyframes ll-enter { 0% { transform: translateX(-70vw) rotate(-12deg) } 60% { transform: translateX(4vw) rotate(4deg) } 80% { transform: translateX(-1vw) } 100% { transform: none } }
  @keyframes ll-sway { 0%,100% { transform: rotate(-3deg) } 50% { transform: rotate(3deg) translateY(-3px) } }
  @keyframes ll-talkbob { 0%,100% { transform: translateY(0) scale(1) } 50% { transform: translateY(-5px) scale(1.03, .98) } }
  @keyframes ll-jump { 0%,100% { transform: translateY(0) scale(1) } 30% { transform: translateY(-30%) scale(.95, 1.08) rotate(-8deg) } 55% { transform: translateY(0) scale(1.1, .9) } 75% { transform: translateY(-10%) rotate(6deg) } }
  @keyframes ll-shake { 0%,100% { transform: rotate(0) } 15% { transform: rotate(-10deg) } 35% { transform: rotate(9deg) } 55% { transform: rotate(-6deg) } 75% { transform: rotate(4deg) } }
  @keyframes ll-ponder { 0%,100% { transform: rotate(-7deg) } 50% { transform: rotate(-4deg) translateY(-4px) } }
  @keyframes ll-flip { 0% { transform: perspective(400px) rotateY(90deg) scale(.6); opacity: 0 } 70% { transform: perspective(400px) rotateY(-12deg) scale(1.05); opacity: 1 } 100% { transform: none } }
  @keyframes ll-boing { 0% { transform: scale(0) } 50% { transform: scale(1.25) } 70% { transform: scale(.9) } 100% { transform: scale(1) } }
  @keyframes ll-hop { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-35%) scale(1.15) } }
  @keyframes ll-spark { 0% { transform: translate(0,0) scale(.4); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(1.1) rotate(160deg); opacity: 0 } }
  ${CHARACTER_CSS}
  ${LESSON_CHARACTER_CSS}
`;

/** `k`: which question of the lesson this is; `left`: questions to go before the sticker. */
type Run = { left: number; total: number; plan: LessonPlan; k: number; q: Question; intros: Intro[] };

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

  /** A new lesson (one game, a few questions), with `left` questions to go before the sticker. */
  const lesson = (left: number, total: number): Run => {
    const plan = nextLesson(pRef.current, settings, left);
    update(lessonStarted(pRef.current, plan));
    return { left, total, plan, k: 0, q: lessonQuestion(plan), intros: plan.intros };
  };
  const start = () => setRun(lesson(settings.session, settings.session));
  const heardStory = () => {
    if (!run) return;
    const [seen, ...rest] = run.intros;
    if (seen && !pRef.current.told.includes(seen.id)) update({ ...pRef.current, told: [...pRef.current.told, seen.id] });
    setRun({ ...run, intros: rest });
  };
  const answered = (right: boolean) => {
    if (!run) return;
    const next = recordAnswer(pRef.current, settings, run.q.subject, run.plan.index, right, run.q.level);
    const left = run.left - 1;
    if (left <= 0) {
      const got = stickerFor(next);
      update({ ...next, stickers: [...next.stickers, got] });
      setRun(null); setSticker(got);
      talk({ text: `${player.toUpperCase()} GOT A STICKER!` }, next.voice);
      return;
    }
    update(next);
    // the same game until the lesson's done, then a new lesson
    setRun(run.k + 1 < run.plan.length ? { ...run, left, k: run.k + 1, q: lessonQuestion(run.plan), intros: [] } : lesson(left, run.total));
  };

  const intro = run?.intros[0];
  return (
    <div className="min-h-screen w-full text-white select-none overflow-hidden" style={{ background: BG, fontFamily: FONT, WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <style>{CSS}</style>
      {run && intro
        ? <StoryCard key={`story-${intro.id}`} level={intro} voice={p.voice} onDone={heardStory} onQuit={() => { hush(); setRun(null); }} />
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
const StoryCard: React.FC<{ level: Intro; voice: boolean; onDone: () => void; onQuit: () => void }> = ({ level, voice, onDone, onQuit }) => {
  const [ready, setReady] = useState(false);
  const [lit, setLit] = useState(-1);
  const talking = useTalking();
  useEffect(() => {
    let done = false;
    const go = () => { if (!done) { done = true; setReady(true); } };
    const t1 = window.setTimeout(() => talk(storyLine(level), voice, undefined, go), 600);
    const t2 = window.setTimeout(go, voice ? STORY_MAX : 4000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); hush(); };
  }, [level, voice]);
  useEffect(() => { if (ready) return; const t = window.setInterval(() => setLit(n => (n + 1) % 6), 700); return () => window.clearInterval(t); }, [ready]);
  return (
    <div className="min-h-screen flex flex-col" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between px-4"><HoldButton onHold={onQuit} label="Hold to stop">‹</HoldButton><div className="w-14" /></div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="rounded-[48px] bg-white/10 px-12 py-6" style={{ animation: 'lc-pop .5s ease-out' }}>
          <div style={{ animation: 'll-enter .9s cubic-bezier(.3,1.4,.5,1) both' }}>
            <CastShape who={level.cast} size={Math.min(280, window.innerHeight * 0.34)} mood={talking ? 'talk' : ready ? 'happy' : lit % 3 ? 'idle' : 'wow'}
              style={{ animation: talking ? 'll-talkbob .45s ease-in-out infinite' : 'lc-bounce 1.4s ease-in-out infinite', transformOrigin: '50% 100%' }} />
          </div>
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

// ── the character on stage: talks while a line is said, reacts to his answers ──
type Act = { talking: boolean; reaction: 'right' | 'wrong' | null; thinking: boolean };
const ActCtx = createContext<Act>({ talking: false, reaction: null, thinking: false });
/** true while a line is being said (the characters move their mouths) */
function useTalking(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => onSpeaking(setOn), []);
  return on;
}
const SPARKS = ['⭐', '✨', '💛', '🌟', '✨', '⭐'];
/** The character asking: walks in, talks with a moving mouth, sways while he thinks, jumps for joy
 *  (with sparkles) when he gets it, and looks worried after a miss. */
const Host: React.FC<{ who: Cast; size: number; enter?: boolean }> = ({ who, size, enter = true }) => {
  const a = useContext(ActCtx);
  const mood: Mood = a.reaction === 'right' ? 'happy' : a.reaction === 'wrong' ? 'oops' : a.talking ? 'talk' : 'idle';
  const move = a.reaction === 'right' ? 'll-jump .8s ease-out 2' : a.reaction === 'wrong' ? 'll-shake .7s ease-in-out'
    : a.talking ? 'll-talkbob .45s ease-in-out infinite' : a.thinking ? 'll-ponder 2.4s ease-in-out infinite' : 'll-sway 3.2s ease-in-out infinite';
  return (
    <div className="relative inline-block" style={{ animation: enter ? 'll-enter .9s cubic-bezier(.3,1.4,.5,1) both' : undefined }}>
      <div style={{ animation: move, transformOrigin: '50% 100%' }}><CastShape who={who} size={size} mood={mood} /></div>
      {a.reaction === 'right' && SPARKS.map((s, i) => (
        <span key={i} className="absolute left-1/2 top-1/3 pointer-events-none" aria-hidden="true"
          style={{ fontSize: size * 0.18, ['--dx' as string]: `${Math.cos((i / SPARKS.length) * Math.PI * 2) * size * 0.7}px`,
            ['--dy' as string]: `${Math.sin((i / SPARKS.length) * Math.PI * 2) * size * 0.6}px`, animation: `ll-spark .9s ease-out ${i * 0.04}s both` }}>{s}</span>
      ))}
    </div>
  );
};

// ── one question ──
type Lock = 'listen' | 'think' | 'slow' | null;
const LOCK_ICON: Record<Exclude<Lock, null>, string> = { listen: '👂', think: '💭', slow: '🐢' };
/** Little Chess's own rounds (their sentences and voices come from Little Chess); every other game's come from Little Lessons. */
const isChess = (q: Question): q is Exclude<Round, { kind: 'hello' }> & Question => ['find', 'word', 'shadow', 'peek', 'board', 'show'].includes(q.kind);
type ChessQ = Question & ChessRound;

const Play: React.FC<{ q: Question; at: number; total: number; name: string; voice: boolean; onDone: (right: boolean) => void; onQuit: () => void }> = ({ q, at, total, name, voice, onDone, onQuit }) => {
  const [lit, setLit] = useState(-1);
  const [flash, setFlash] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [cheer, setCheer] = useState<string | null>(null);
  const [lock, setLockState] = useState<Lock>(null);
  const [poke, setPoke] = useState(0);
  const host: Cast = q.subject === 'chess' ? chessHost(q as ChessQ) : q.cast;
  const line: Line = isChess(q) ? { text: sentenceFor(q), who: host } : lessonLine(q)!;
  const [reaction, setReaction] = useState<'right' | 'wrong' | null>(null);
  const talking = useTalking();
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
    const l: Line = q.subject === 'chess'
      ? (typeof tapped === 'string' && tapped in WORD ? { text: oopsLine(tapped as Piece), who: host } : { text: notThereLine((q as ChessQ).piece), who: (q as ChessQ).piece })
      : lessonOops(q, tapped as number | string);
    setFlash(l.text);
    setReaction('wrong'); later(() => setReaction(r => (r === 'wrong' ? null : r)), 1300);
    wait('think', THINK, l);
  };
  const won = () => {
    seq.current++; setLock(null);
    if (idle.current) window.clearTimeout(idle.current);
    setFlash(null);
    const c = cheers(name)[Math.floor(Math.random() * 5)];
    setCheer(c); setReaction('right');
    talk({ text: c, who: q.cast }, voice);   // the question's character cheers in its own voice
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
    const right = misses.current.length === 0;
    window.setTimeout(() => { setCheer(null); onDone(right); }, 1500);
  };
  const listening = lock === 'listen';
  const act: Act = { talking, reaction, thinking: lock === 'think' };
  const replay = () => { if (!lockRef.current) talk(line, voice, setLit); };

  return (
    <ActCtx.Provider value={act}>
    <div className="min-h-screen flex flex-col" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between px-4">
        <HoldButton onHold={onQuit} label="Hold to stop">‹</HoldButton>
        <div className="flex gap-2">{Array.from({ length: total }, (_, k) => <span key={k} className={`w-4 h-4 rounded-full ${k < at ? 'bg-yellow-300' : k === at ? '' : 'bg-white/25'}`} style={k === at ? { background: '#fff' } : undefined} />)}</div>
        <button type="button" onClick={replay} aria-label="Say it again" className="w-14 h-14 rounded-full bg-white/10 text-3xl" disabled={!voice}>🔊</button>
      </div>
      <div className="mt-4">{cheer
        ? <div className="text-center font-black text-yellow-300" style={{ fontSize: 'clamp(40px, 7.5vw, 76px)', minHeight: '1.3em', lineHeight: 1.1, textShadow: '0 5px 0 #134e4a', animation: 'lc-pop .4s ease-out' }}>{cheer}</div>
        : <Sentence text={line.text} lit={lit} flash={flash} />}</div>
      <div className="relative flex-1 flex items-center justify-center p-4" onPointerDown={() => nudge()}>
        <div className="flex items-center justify-center">
          {q.kind === 'find' && <Find round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'word' && <Word round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'shadow' || q.kind === 'peek') && <Guess round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'board' || q.kind === 'show') && <BoardRound round={q} hint={hint} listening={listening} onDone={won} onWrong={() => oops()} />}
          {q.kind === 'pieceMatch' && <PieceMatch round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'gone' && <Gone round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'where' && <WhereRound round={q} hint={hint} listening={listening} onDone={won} onWrong={() => oops()} />}
          {q.kind === 'who' && <WhoRound round={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'sight' && <Sight q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'wordMatch' && <WordMatch q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'pop' && <Pop q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'sentence' && <SentenceRound q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {(q.kind === 'count' || q.kind === 'countAdd' || q.kind === 'countSub' || q.kind === 'add' || q.kind === 'sub' || q.kind === 'dots' || q.kind === 'dotsAdd' || q.kind === 'gap') &&
            <Numbers q={q} hint={hint} listening={listening} voice={voice} onRight={won} onWrong={oops} />}
          {q.kind === 'more' && <More q={q} hint={hint} listening={listening} onRight={won} onWrong={oops} />}
          {q.kind === 'feed' && <Feed q={q} hint={hint} listening={listening} voice={voice} onRight={won} onWrong={oops} />}
          {q.kind === 'hop' && <Hop q={q} hint={hint} listening={listening} voice={voice} onRight={won} onWrong={oops} />}
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
    </div>
    </ActCtx.Provider>
  );
};

// ── answer pieces shared by the rounds ──
const WordCard: React.FC<{ word: string; big?: boolean; glow?: boolean; wiggle?: boolean; crossed?: boolean; onClick?: () => void; lower?: boolean; i?: number }> = ({ word, big, glow, wiggle, crossed, onClick, lower, i = 0 }) => {
  const El = onClick ? 'button' : 'div';
  return (
    <El {...(onClick ? { type: 'button' as const, onClick } : {})}
      className="relative mt-4 rounded-3xl font-black tracking-wider px-8 py-3"
      style={{ background: crossed ? '#fecaca' : '#fff', color: crossed ? '#b91c1c' : '#042f2e', fontSize: big ? 'clamp(44px, 8vw, 80px)' : 'clamp(36px, 6vw, 60px)',
        boxShadow: crossed ? 'inset 0 0 0 5px #ef4444' : undefined, opacity: crossed && !wiggle ? 0.6 : 1, textDecoration: crossed ? 'line-through' : undefined,
        textTransform: lower ? 'none' : undefined, animation: wiggle ? 'lc-wiggle .5s' : glow ? 'lc-glow 1.1s ease-in-out infinite' : `ll-flip .55s ease-out ${i * 0.15}s both` }}>
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
  const host = chessHost(round);
  if (listening) return <Host who={host} size={Math.min(280, window.innerHeight * 0.34)} />;
  return (
    <div className="flex flex-wrap items-end justify-center gap-5">
      <Host who={host} size={Math.min(150, window.innerHeight * 0.2)} enter={false} />
      {round.options.map((piece, k) => {
        const right = piece === round.piece;
        return (
          <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(piece); } }}
            className="relative rounded-[36px] bg-white/10 p-5"
            style={{ animation: got && right ? 'lc-bounce .7s ease-out 2' : hint && right ? 'lc-glow 1.1s ease-in-out infinite' : `ll-boing .5s ease-out ${k * 0.12}s both`, ...wrongTile(crossed.includes(k), wrong === k) }}>
            <PieceShape piece={piece} size={size} mood={got && right ? 'happy' : crossed.includes(k) ? 'oops' : 'idle'} />
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
      <div className="rounded-[48px] bg-white/10 px-10 py-4"><Host who={round.piece} size={Math.min(250, window.innerHeight * 0.28)} /></div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-4">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return <WordCard key={k} i={k} word={WORD[piece]} wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right}
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
      <div className="flex items-end gap-4">
        <Host who={chessHost(round)} size={Math.min(170, window.innerHeight * 0.2)} />
        <div className="rounded-[48px] bg-white/10 px-10 py-4 flex items-end justify-center">{hidden}</div>
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-5">
        {round.options.map((piece, k) => {
          const right = piece === round.piece;
          return round.answer === 'word'
            ? <WordCard key={k} i={k} word={WORD[piece]} wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right} onClick={() => tap(k, right)} />
            : (
              <button key={k} type="button" aria-label={`Piece ${k + 1}`} onClick={() => tap(k, right)} className="relative rounded-[32px] bg-white/10 p-4"
                style={{ animation: hint && right && !got ? 'lc-glow 1.1s ease-in-out infinite' : `ll-boing .5s ease-out ${k * 0.12}s both`, ...wrongTile(crossed.includes(k), wrong === k) }}>
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

// ── picking a piece up: press on it, it lifts and follows the finger, let go over a square ──
/** `onDrop` gets where it was let go, and whether it was really carried (not just pressed). */
function useDrag<T>(onDrop: (x: number, y: number, item: T, moved: boolean) => void) {
  const [drag, setDrag] = useState<{ item: T; x: number; y: number } | null>(null);
  const held = useRef<{ item: T; x0: number; y0: number } | null>(null);
  const drop = useRef(onDrop); drop.current = onDrop;
  const bind = (item: T, enabled = true) => (enabled ? {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      held.current = { item, x0: e.clientX, y0: e.clientY }; setDrag({ item, x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent) => { if (held.current) setDrag({ item: held.current.item, x: e.clientX, y: e.clientY }); },
    onPointerUp: (e: React.PointerEvent) => {
      const h = held.current; held.current = null; setDrag(null);
      if (h) drop.current(e.clientX, e.clientY, h.item, Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > 14);
    },
    onPointerCancel: () => { held.current = null; setDrag(null); },
    style: { touchAction: 'none' as const, cursor: 'grab', pointerEvents: 'auto' as const },
  } : {});
  return { drag, bind };
}
/** The square of a board (its bordered element) under a point on the screen. */
function squareAt(el: HTMLElement | null, x: number, y: number, cell: number): Sq | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const row = Math.floor((y - r.top - 6) / cell), col = Math.floor((x - r.left - 6) / cell);
  return row >= 0 && row < BOARD && col >= 0 && col < BOARD ? [row, col] : null;
}
/** The piece in his hand: a little bigger, with a shadow, just above his finger so he can see where it goes. */
const Lifted: React.FC<{ piece: Piece; x: number; y: number; size: number }> = ({ piece, x, y, size }) => createPortal(
  <div className="fixed pointer-events-none" style={{ left: x - size * 0.6, top: y - size * 1.05, zIndex: 60 }}>
    <PieceShape piece={piece} size={size * 1.2} mood="wow" style={{ filter: 'drop-shadow(0 16px 10px rgba(0,0,0,.45))' }} />
  </div>, document.body);

/** A small board: pick the piece up and drop it on a square to move (its squares glow while there's a hint).
 *  Stars to get, apples to eat, or (show) just practise. A wrong square: it goes back, and says its rule.
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
  const act = useContext(ActCtx);
  const boardEl = useRef<HTMLDivElement>(null);
  const { drag, bind } = useDrag<Piece>((x, y, _p, moved) => { const sq = squareAt(boardEl.current, x, y, cell); if (moved && sq) tap(sq); });
  if (listening) return <Host who={piece} size={Math.min(280, window.innerHeight * 0.34)} />;

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
    <div ref={boardEl} className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ width: cell * BOARD, height: cell * BOARD, border: '6px solid #78350f', animation: 'll-in .35s ease-out' }}>
      {Array.from({ length: BOARD * BOARD }, (_, k) => {
        const sq: Sq = [Math.floor(k / BOARD), k % BOARD];
        const dark = (sq[0] + sq[1]) % 2 === 1;
        const glow = glowOn && legal.some(s => same(s, sq));
        const offColour = piece === 'bishop' && glowOn && (sq[0] + sq[1]) % 2 !== myColour;
        return (
          <div key={k} aria-label={`Square ${sq[0] + 1}-${sq[1] + 1}`} className="absolute"
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
      <div aria-label={`Pick up the ${piece}`} className="absolute flex items-center justify-center pointer-events-none" {...bind(piece, !finished)}
        style={{ left: at[1] * cell, top: at[0] * cell, width: cell, height: cell, transition: 'left .35s ease-in-out, top .35s ease-in-out', zIndex: 5, ...bind(piece, !finished).style }}>
        <PieceShape piece={piece} size={cell * 0.86} mood={munch ? 'munch' : finished ? 'happy' : wiggle ? 'oops' : act.talking ? 'talk' : 'idle'}
          style={{ opacity: drag ? 0.25 : 1, animation: wiggle ? 'lc-wiggle .5s' : finished ? 'lc-bounce .7s ease-out 2' : drag ? undefined : 'lc-float 2s ease-in-out infinite' }} />
      </div>
      {drag && <Lifted piece={piece} x={drag.x} y={drag.y} size={cell * 0.86} />}
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
        <Host who="ollie" size={Math.min(230, window.innerHeight * 0.27)} />
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-2">
        {q.options.map((w, k) => {
          const right = w === q.word;
          return <WordCard key={k} i={k} word={w} big lower wiggle={wrong === k} crossed={crossed.includes(k)} glow={(hint || got) && right}
            onClick={() => { if (got || crossed.includes(k)) return; if (right) { setGot(true); onRight(); } else { flag(k); onWrong(w); } }} />;
        })}
      </Answers>
    </div>
  );
};

// ── numbers with Benny and Zip: count the things (tap each one to count it), or work out the sum ──
type NumQ = Extract<Question, { kind: 'count' | 'countAdd' | 'countSub' | 'add' | 'sub' | 'dots' | 'dotsAdd' | 'gap' }>;
const Things: React.FC<{ n: number; thing: string; size: number; gone?: number; counting?: boolean; voice: boolean }> = ({ n, thing, size, gone = 0, counting, voice }) => {
  const [tapped, setTapped] = useState<number[]>([]);
  const left = n - gone;
  const tap = (i: number) => {
    if (!counting || i >= left || tapped.includes(i)) return;
    const next = [...tapped, i];
    setTapped(next);
    talk(countAloud(next.length), voice);
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
                style={{ fontSize: size, width: size * 1.2, height: size * 1.2, animation: away ? 'll-flyaway 1.2s ease-in 1.4s forwards' : mark >= 0 ? 'll-hop .45s ease-out' : `ll-boing .45s ease-out ${i * 0.08}s both` }}>
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
  const die = Math.min(170, window.innerHeight * 0.22, window.innerWidth * 0.3);
  const size = Math.max(30, Math.min(most <= 5 ? 92 : 64, (window.innerWidth * 0.8) / (most > 10 ? 7 : most <= 5 ? 5 : 6.5)));
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-4">
        <Host who={q.cast} size={Math.min(190, window.innerHeight * 0.24)} />
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
          {q.kind === 'gap' && (
            <div className="font-black text-center" style={{ fontSize: 'clamp(56px, 12vw, 120px)', lineHeight: 1 }}>
              {q.a} <span className="text-yellow-300">{q.op === 'add' ? '+' : '−'}</span> <span className="inline-block rounded-2xl px-3" style={{ background: got ? 'transparent' : 'rgba(253,224,71,.25)', color: '#fde047' }}>{got ? q.b : '?'}</span> <span className="text-teal-200">=</span> {q.op === 'add' ? q.a + q.b : q.a - q.b}
            </div>)}
          {q.kind === 'dots' && <Dice n={q.n} size={die} />}
          {q.kind === 'dotsAdd' && (
            <div className="flex items-center gap-3"><Dice n={q.a} size={die * 0.8} /><span className="font-black text-5xl text-yellow-300">+</span><Dice n={q.b} size={die * 0.8} /></div>)}
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
                animation: wrong === k ? 'lc-wiggle .5s' : (hint || got) && right ? 'lc-glow 1.1s ease-in-out infinite' : `ll-boing .5s ease-out ${k * 0.15}s both` }}>
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

// ── more games: each is a lesson in a level's deck ──
type Pick<T> = { hint: boolean; listening: boolean; onRight: () => void; onWrong: (tapped: T) => void };
/** Tapping choices: the right one wins once; a wrong one is crossed out (and says what it was). */
function useChoice<T>(answer: T, onRight: () => void, onWrong: (t: T) => void) {
  const [wrong, flag, crossed] = useWrong();
  const [got, setGot] = useState(false);
  const pick = (k: number, v: T) => { if (got || crossed.includes(k)) return; if (v === answer) { setGot(true); onRight(); } else { flag(k); onWrong(v); } };
  return { wrong, crossed, got, pick };
}
const PieceButton: React.FC<{ piece: Piece; k: number; size: number; right: boolean; hint: boolean; got: boolean; crossed: boolean; wiggling: boolean; onClick?: () => void;
  /** pick it up instead of tapping it (from useDrag's bind) */ drag?: ReturnType<ReturnType<typeof useDrag<number>>['bind']>; held?: boolean }> = ({ piece, k, size, right, hint, got, crossed, wiggling, onClick, drag, held }) => (
  <button type="button" aria-label={`Piece ${k + 1}`} onClick={onClick} className="relative rounded-[32px] bg-white/10 p-4" {...drag}
    style={{ animation: got && right ? 'lc-bounce .7s ease-out 2' : hint && right ? 'lc-glow 1.1s ease-in-out infinite' : `ll-boing .5s ease-out ${k * 0.12}s both`, ...wrongTile(crossed, wiggling), ...drag?.style }}>
    <PieceShape piece={piece} size={size} mood={got && right ? 'happy' : crossed ? 'oops' : 'idle'} style={{ opacity: held ? 0.25 : 1 }} />
    {crossed && <><Cross /><NameTag piece={piece} /></>}
  </button>
);

/** Chess: find the same piece as the one in the golden frame. */
const PieceMatch: React.FC<Pick<Piece> & { round: Extract<ChessRound, { kind: 'pieceMatch' }> }> = ({ round, hint, listening, onRight, onWrong }) => {
  const c = useChoice(round.piece, onRight, onWrong);
  const size = Math.min(140, window.innerWidth / (round.options.length + 1.5));
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-4">
        <Host who={chessHost(round)} size={Math.min(150, window.innerHeight * 0.2)} />
        <div className="rounded-[40px] px-8 py-3" style={{ background: 'rgba(253,224,71,.15)', boxShadow: 'inset 0 0 0 6px #fde047' }}>
          <PieceShape piece={round.piece} size={Math.min(200, window.innerHeight * 0.24)} mood={c.got ? 'happy' : 'idle'} />
        </div>
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-5">
        {round.options.map((piece, k) => <PieceButton key={k} piece={piece} k={k} size={size} right={piece === round.piece} hint={hint} got={c.got}
          crossed={c.crossed.includes(k)} wiggling={c.wrong === k} onClick={() => c.pick(k, piece)} />)}
      </Answers>
    </div>
  );
};

/** Chess: the friends line up; one goes away. Who is missing? */
const Gone: React.FC<Pick<Piece> & { round: Extract<ChessRound, { kind: 'gone' }> }> = ({ round, hint, listening, onRight, onWrong }) => {
  const c = useChoice(round.piece, onRight, onWrong);
  const [away, setAway] = useState(false);
  useEffect(() => { if (listening || away) return; const t = window.setTimeout(() => setAway(true), 700); return () => window.clearTimeout(t); }, [listening, away]);
  const size = Math.min(150, (window.innerWidth * 0.85) / (round.row.length + 0.5));
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end justify-center gap-3 rounded-[40px] bg-white/10 px-6 py-4">
        {round.row.map((piece, k) => piece === round.piece && away && !c.got
          ? <div key={k} className="relative" style={{ width: size, height: size }}>
              <div className="absolute inset-0" style={{ animation: 'll-flyaway 1.1s ease-in forwards' }}><PieceShape piece={piece} size={size} /></div>
              <div className="absolute inset-0 flex items-center justify-center font-black rounded-3xl" style={{ fontSize: size * 0.6, color: '#fde047', border: '5px dashed rgba(253,224,71,.7)', animation: 'lc-pop .4s ease-out 1s both' }}>?</div>
            </div>
          : <div key={k} style={{ animation: piece === round.piece && c.got ? 'lc-bounce .7s ease-out 2' : `ll-boing .5s ease-out ${k * 0.15}s both` }}><PieceShape piece={piece} size={size} mood={piece === round.piece && c.got ? 'happy' : 'idle'} /></div>)}
      </div>
      <Answers listening={listening || !away} className="flex flex-wrap justify-center gap-4 mt-5">
        {round.options.map((piece, k) => <PieceButton key={k} piece={piece} k={k} size={Math.min(120, size)} right={piece === round.piece} hint={hint} got={c.got}
          crossed={c.crossed.includes(k)} wiggling={c.wrong === k} onClick={() => c.pick(k, piece)} />)}
      </Answers>
    </div>
  );
};

/** A plain 4×4 board for the chess games that don't move a piece. */
const MiniBoard: React.FC<{ cell: number; children?: React.ReactNode; onTap?: (sq: Sq) => void; glow?: (sq: Sq) => boolean; mark?: (sq: Sq) => React.ReactNode; boardRef?: React.Ref<HTMLDivElement> }> = ({ cell, children, onTap, glow, mark, boardRef }) => (
  <div ref={boardRef} className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ width: cell * BOARD, height: cell * BOARD, border: '6px solid #78350f', animation: 'll-in .35s ease-out' }}>
    {Array.from({ length: BOARD * BOARD }, (_, k) => {
      const sq: Sq = [Math.floor(k / BOARD), k % BOARD];
      return (
        <button key={k} type="button" aria-label={`Square ${sq[0] + 1}-${sq[1] + 1}`} onClick={() => onTap?.(sq)} className="absolute flex items-center justify-center"
          style={{ left: sq[1] * cell, top: sq[0] * cell, width: cell, height: cell, background: (sq[0] + sq[1]) % 2 ? DARK : LIGHT, animation: glow?.(sq) ? 'lc-glow 1.1s ease-in-out infinite' : undefined }}>
          {mark?.(sq)}
        </button>
      );
    })}
    {children}
  </div>
);
const OnSquare: React.FC<{ sq: Sq; cell: number; children: React.ReactNode; z?: number }> = ({ sq, cell, children, z = 5 }) => (
  <div className="absolute flex items-center justify-center pointer-events-none" style={{ left: sq[1] * cell, top: sq[0] * cell, width: cell, height: cell, zIndex: z, transition: 'left .35s, top .35s' }}>{children}</div>
);

/** Chess: carry the piece to every square it can go to (each one gets a green tick; the piece hops back home). */
const WhereRound: React.FC<{ round: Extract<ChessRound, { kind: 'where' }>; hint: boolean; listening: boolean; onDone: () => void; onWrong: () => void }> = ({ round, hint, listening, onDone, onWrong }) => {
  const legal = useMemo(() => movesFrom(round.piece, round.start), [round]);
  const [found, setFound] = useState<Sq[]>([]);
  const [bad, setBad] = useState<Sq | null>(null);
  const [wiggle, setWiggle] = useState(false);
  const act = useContext(ActCtx);
  const boardEl = useRef<HTMLDivElement>(null);
  const cell = Math.floor(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.55, 560) / BOARD);
  const { drag, bind } = useDrag<Piece>((x, y, _p, moved) => { const sq = squareAt(boardEl.current, x, y, cell); if (moved && sq) tap(sq); });
  if (listening) return <Host who={round.piece} size={Math.min(280, window.innerHeight * 0.34)} />;
  const done = found.length === legal.length;
  const tap = (sq: Sq) => {
    if (done || same(sq, round.start) || found.some(f => same(f, sq))) return;
    if (!legal.some(l => same(l, sq))) {
      setWiggle(true); window.setTimeout(() => setWiggle(false), 520);
      setBad(sq); window.setTimeout(() => setBad(b => (b === sq ? null : b)), 2000);
      onWrong(); return;
    }
    const next = [...found, sq];
    setFound(next);
    if (next.length === legal.length) window.setTimeout(onDone, 500);
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-black text-2xl text-teal-100">{found.length} / {legal.length}</div>
      <MiniBoard cell={cell} boardRef={boardEl} glow={sq => hint && legal.some(l => same(l, sq)) && !found.some(f => same(f, sq))}
        mark={sq => found.some(f => same(f, sq)) ? <span className="font-black" style={{ fontSize: cell * 0.55, color: '#16a34a', animation: 'll-boing .4s ease-out' }}>✓</span>
          : bad && same(bad, sq) ? <span className="font-black" style={{ fontSize: cell * 0.5, color: '#ef4444' }}>✗</span> : null}>
        <OnSquare sq={round.start} cell={cell}>
          <div aria-label={`Pick up the ${round.piece}`} {...bind(round.piece, !done)}>
            <PieceShape piece={round.piece} size={cell * 0.86} mood={done ? 'happy' : wiggle ? 'oops' : act.talking ? 'talk' : 'idle'}
              style={{ opacity: drag ? 0.25 : 1, animation: wiggle ? 'lc-wiggle .5s' : done ? 'lc-bounce .7s ease-out 2' : drag ? undefined : 'lc-float 2s ease-in-out infinite' }} />
          </div>
        </OnSquare>
        {drag && <Lifted piece={round.piece} x={drag.x} y={drag.y} size={cell * 0.86} />}
      </MiniBoard>
    </div>
  );
};

/** Chess: a star (or apple) and a ? on the board — which friend can get there in one move? Carry that one onto the ?. */
const WhoRound: React.FC<Pick<Piece> & { round: Extract<ChessRound, { kind: 'who' }> }> = ({ round, hint, listening, onRight, onWrong }) => {
  const c = useChoice(round.piece, onRight, onWrong);
  const cell = Math.floor(Math.min(window.innerWidth * 0.7, window.innerHeight * 0.36, 400) / BOARD);
  const icon = round.mode === 'apple' ? '🍎' : '⭐';
  const boardEl = useRef<HTMLDivElement>(null);
  const [showMe, setShowMe] = useState(0);
  const { drag, bind } = useDrag<number>((x, y, k, moved) => {
    const sq = squareAt(boardEl.current, x, y, cell);
    if (moved && sq && same(sq, round.start)) c.pick(k, round.options[k]);
    else setShowMe(n => n + 1);   // just pressed, or let go somewhere else: the ? bounces to show where it goes
  });
  return (
    <div className="flex flex-col items-center">
      <MiniBoard cell={cell} boardRef={boardEl}>
        {!c.got && <OnSquare sq={round.target} cell={cell} z={4}><span style={{ fontSize: cell * 0.6, animation: 'lc-float 1.6s ease-in-out infinite' }}>{icon}</span></OnSquare>}
        <OnSquare sq={c.got ? round.target : round.start} cell={cell}>
          {c.got ? <PieceShape piece={round.piece} size={cell * 0.86} mood="happy" style={{ animation: 'lc-bounce .7s ease-out 2' }} />
            : <span key={showMe} className="font-black rounded-full flex items-center justify-center" style={{ width: cell * 0.7, height: cell * 0.7, fontSize: cell * 0.5, background: '#fde047', color: '#134e4a',
                animation: drag ? 'lc-glow 1.1s ease-in-out infinite' : showMe ? 'lc-bounce .6s ease-out 2' : undefined }}>?</span>}
        </OnSquare>
      </MiniBoard>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-4">
        {round.options.map((piece, k) => <PieceButton key={k} piece={piece} k={k} size={Math.min(110, window.innerHeight * 0.13)} right={piece === round.piece} hint={hint} got={c.got}
          crossed={c.crossed.includes(k)} wiggling={c.wrong === k} drag={bind(k, !c.got && !c.crossed.includes(k))} held={drag?.item === k} />)}
      </Answers>
      {drag && <Lifted piece={round.options[drag.item]} x={drag.x} y={drag.y} size={cell * 0.86} />}
    </div>
  );
};

/** Words: find the card that looks just like Ollie's. */
const WordMatch: React.FC<Pick<string> & { q: Extract<Question, { kind: 'wordMatch' }> }> = ({ q, hint, listening, onRight, onWrong }) => {
  const c = useChoice(q.word, onRight, onWrong);
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-4">
        <Host who="ollie" size={Math.min(160, window.innerHeight * 0.2)} />
        <div className="rounded-3xl px-10 py-3 font-black" style={{ background: '#fef9c3', color: '#042f2e', fontSize: 'clamp(48px, 9vw, 88px)', boxShadow: 'inset 0 0 0 6px #fde047', animation: 'll-flip .55s ease-out both' }}>{q.word}</div>
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-3">
        {q.options.map((w, k) => <WordCard key={k} i={k} word={w} big lower wiggle={c.wrong === k} crossed={c.crossed.includes(k)} glow={(hint || c.got) && w === q.word} onClick={() => c.pick(k, w)} />)}
      </Answers>
    </div>
  );
};

/** Words: bubbles float up; pop every one that says the word. */
const Pop: React.FC<Pick<string> & { q: Extract<Question, { kind: 'pop' }> }> = ({ q, hint, listening, onRight, onWrong }) => {
  const [wrong, flag, crossed] = useWrong();
  const [popped, setPopped] = useState<number[]>([]);
  const need = q.bubbles.filter(b => b === q.word).length;
  const done = popped.length === need;
  const size = Math.min(170, (window.innerWidth * 0.86) / 3.3, window.innerHeight * 0.2);
  const tap = (k: number) => {
    if (done || popped.includes(k) || crossed.includes(k)) return;
    if (q.bubbles[k] === q.word) { const next = [...popped, k]; setPopped(next); if (next.length === need) window.setTimeout(onRight, 500); }
    else { flag(k); onWrong(q.bubbles[k]); }
  };
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3"><Host who="ollie" size={Math.min(120, window.innerHeight * 0.15)} />
        <div className="font-black text-3xl text-teal-100">{popped.length} / {need}</div></div>
      <Answers listening={listening} className="grid grid-cols-3 gap-4 mt-3">
        {q.bubbles.map((w, k) => {
          const isPopped = popped.includes(k), x = crossed.includes(k);
          return (
            <button key={k} type="button" aria-label={w} onClick={() => tap(k)} className="relative rounded-full font-black flex items-center justify-center"
              style={{ width: size, height: size, fontSize: size * (w.length > 4 ? 0.24 : 0.32), color: x ? '#b91c1c' : '#042f2e',
                background: x ? 'radial-gradient(circle at 30% 30%, #fff, #fecaca)' : 'radial-gradient(circle at 30% 30%, #fff 0%, #bae6fd 55%, #7dd3fc 100%)',
                boxShadow: hint && w === q.word && !isPopped ? '0 0 0 6px #fde047' : 'inset -6px -8px 16px rgba(14,116,144,.35)', opacity: x && wrong !== k ? 0.55 : 1,
                animation: isPopped ? 'lc-gone .45s ease-out forwards' : wrong === k ? 'lc-wiggle .5s' : `ll-boing .5s ease-out ${k * 0.1}s both, lc-float ${2 + (k % 3) * 0.4}s ease-in-out ${k * 0.2}s infinite` }}>
              {w}
              {x && <Cross />}
            </button>
          );
        })}
      </Answers>
    </div>
  );
};

/** Words: Ollie reads a sentence with a word missing; find it. */
const SentenceRound: React.FC<Pick<string> & { q: Extract<Question, { kind: 'sentence' }> }> = ({ q, hint, listening, onRight, onWrong }) => {
  const c = useChoice(q.word, onRight, onWrong);
  const [before, after] = q.sentence.split('_');
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-4"><Host who="ollie" size={Math.min(150, window.innerHeight * 0.18)} /></div>
      <div className="mt-2 rounded-3xl bg-white/10 px-6 py-4 font-black text-center" style={{ fontSize: 'clamp(36px, 7vw, 68px)', lineHeight: 1.3 }}>
        {before}<span className="inline-block rounded-2xl mx-1 px-4" style={{ minWidth: '2.2em', background: c.got ? '#fde047' : 'rgba(253,224,71,.2)', color: c.got ? '#134e4a' : '#fde047',
          borderBottom: c.got ? undefined : '5px solid #fde047', animation: c.got ? 'll-boing .4s ease-out' : undefined }}>{c.got ? q.word : ' '}</span>{after}
      </div>
      <Answers listening={listening} className="flex flex-wrap justify-center gap-4 mt-2">
        {q.options.map((w, k) => <WordCard key={k} i={k} word={w} big lower wiggle={c.wrong === k} crossed={c.crossed.includes(k)} glow={(hint || c.got) && w === q.word} onClick={() => c.pick(k, w)} />)}
      </Answers>
    </div>
  );
};

/** Dice dots: a die's pattern up to 6, rows of five after that. */
const PIPS: Record<number, [number, number][]> = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]] };
const Dice: React.FC<{ n: number; size: number }> = ({ n, size }) => {
  if (n <= 6) return (
    <div className="relative rounded-[22%] shadow-xl" style={{ width: size, height: size, background: '#fff', animation: 'll-boing .5s ease-out both' }}>
      {(PIPS[n] || []).map(([r, c], k) => <span key={k} className="absolute rounded-full" style={{ width: size * 0.2, height: size * 0.2, background: '#134e4a', left: size * (0.15 + c * 0.25), top: size * (0.15 + r * 0.25) }} />)}
    </div>
  );
  const dot = Math.min(size * 0.17, 34);
  return (
    <div className="rounded-3xl p-3 shadow-xl flex flex-col gap-2" style={{ background: '#fff', animation: 'll-boing .5s ease-out both' }}>
      {Array.from({ length: Math.ceil(n / 5) }, (_, row) => (
        <div key={row} className="flex gap-2" style={{ marginTop: row && row % 2 === 0 ? 8 : 0 }}>
          {Array.from({ length: 5 }, (_, c) => <span key={c} className="rounded-full" style={{ width: dot, height: dot, background: row * 5 + c < n ? '#134e4a' : '#e5e7eb' }} />)}
        </div>
      ))}
    </div>
  );
};

/** Math: two groups — tap the one with more. */
const More: React.FC<Pick<number> & { q: Extract<Question, { kind: 'more' }> }> = ({ q, hint, listening, onRight, onWrong }) => {
  const right = q.a > q.b ? 0 : 1;
  const c = useChoice(right, onRight, k => onWrong(k === 0 ? q.a : q.b));
  const most = Math.max(q.a, q.b);
  const size = Math.max(26, Math.min(64, (window.innerWidth * 0.36) / Math.min(5, most) / 1.25));
  return (
    <div className="flex flex-col items-center">
      <Host who="benny" size={Math.min(150, window.innerHeight * 0.18)} />
      <Answers listening={listening} className="flex flex-wrap justify-center gap-5 mt-3">
        {[q.a, q.b].map((n, k) => (
          <div key={k} role="button" tabIndex={0} aria-label={k === 0 ? 'Left side' : 'Right side'} onClick={() => c.pick(k, k)}
            className="relative rounded-[36px] px-4 py-5 flex items-center justify-center cursor-pointer"
            style={{ minWidth: Math.min(300, window.innerWidth * 0.42), minHeight: 160, background: c.crossed.includes(k) ? 'rgba(239,68,68,.25)' : 'rgba(255,255,255,.12)',
              boxShadow: c.crossed.includes(k) ? 'inset 0 0 0 5px #ef4444' : (hint || c.got) && k === right ? '0 0 0 6px #fde047' : undefined,
              animation: c.wrong === k ? 'lc-wiggle .5s' : c.got && k === right ? 'lc-bounce .7s ease-out 2' : `ll-boing .5s ease-out ${k * 0.2}s both` }}>
            <Things n={n} thing={q.thing} size={size} voice={false} />
            {c.crossed.includes(k) && <Cross />}
          </div>
        ))}
      </Answers>
    </div>
  );
};

/** A big round green "check" button (feeding Benny, hopping the frog). */
const CheckButton: React.FC<{ onClick: () => void; glow?: boolean }> = ({ onClick, glow }) => (
  <button type="button" aria-label="Check" onClick={onClick} className="rounded-full font-black flex items-center justify-center shadow-xl"
    style={{ width: 110, height: 110, fontSize: 64, background: '#22c55e', color: '#fff', animation: glow ? 'lc-glow 1.1s ease-in-out infinite' : 'll-boing .4s ease-out both' }}>✓</button>
);

/** Math: give Benny exactly n — tap things into his basket (tap one in the basket to take it back), then ✓. */
const Feed: React.FC<{ q: Extract<Question, { kind: 'feed' }>; hint: boolean; listening: boolean; voice: boolean; onRight: () => void; onWrong: (n: number) => void }> = ({ q, hint, listening, voice, onRight, onWrong }) => {
  const [given, setGiven] = useState<number[]>([]);
  const [got, setGot] = useState(false);
  const size = Math.max(36, Math.min(76, (window.innerWidth * 0.8) / 6.5));
  const give = (i: number) => { if (got || given.includes(i)) return; const next = [...given, i]; setGiven(next); talk(countAloud(next.length), voice); };
  const back = (i: number) => { if (!got) setGiven(given.filter(x => x !== i)); };
  const check = () => {
    if (got) return;
    if (given.length === q.n) { setGot(true); onRight(); } else { onWrong(given.length); setGiven([]); }
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-end gap-3">
        <Host who="benny" size={Math.min(160, window.innerHeight * 0.2)} />
        <div className="rounded-[32px] px-4 py-3 flex flex-wrap items-center justify-center gap-1" style={{ minWidth: Math.min(360, window.innerWidth * 0.5), minHeight: size * 1.5,
          background: 'linear-gradient(#a16207, #78350f)', boxShadow: 'inset 0 6px 0 rgba(255,255,255,.2)' }}>
          {given.length ? given.map((i, k) => (
            <button key={i} type="button" onClick={() => back(i)} aria-label="take it back" className="relative leading-none" style={{ fontSize: size * 0.8, animation: 'll-hop .45s ease-out' }}>
              {q.thing}<span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-yellow-300 text-teal-950 text-sm font-black flex items-center justify-center">{k + 1}</span>
            </button>)) : <span className="text-yellow-100/80 font-black text-2xl px-3">🧺</span>}
        </div>
      </div>
      <Answers listening={listening} className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-1 max-w-[680px]">
          {Array.from({ length: q.pile }, (_, i) => (
            <button key={i} type="button" onClick={() => give(i)} aria-label="give it" className="leading-none"
              style={{ fontSize: size, width: size * 1.2, height: size * 1.2, opacity: given.includes(i) ? 0.15 : 1, animation: `ll-boing .45s ease-out ${i * 0.05}s both` }}>{q.thing}</button>
          ))}
        </div>
        {given.length > 0 && <CheckButton onClick={check} glow={hint && given.length === q.n} />}
      </Answers>
    </div>
  );
};

/** Math: the frog on the number line — tap HOP to hop (counting each hop), then ✓ where it should land. */
const Hop: React.FC<{ q: Extract<Question, { kind: 'hop' }>; hint: boolean; listening: boolean; voice: boolean; onRight: () => void; onWrong: (n: number) => void }> = ({ q, hint, listening, voice, onRight, onWrong }) => {
  const [at, setAt] = useState(q.from);
  const [hops, setHops] = useState(0);
  const [got, setGot] = useState(false);
  const dir = q.by >= 0 ? 1 : -1, goal = q.from + q.by;
  const perRow = q.max > 10 ? 11 : q.max + 1;
  const stone = Math.max(20, Math.min(70, (window.innerWidth * 0.94) / perRow - 7));
  const hop = () => {
    if (got) return;
    const next = at + dir;
    if (next < 0 || next > q.max) return;
    setAt(next); setHops(hops + 1); talk(countAloud(hops + 1, q.cast === 'zip' ? 'zip' : 'benny'), voice);
  };
  const check = () => {
    if (got) return;
    if (at === goal) { setGot(true); onRight(); } else { onWrong(at); setAt(q.from); setHops(0); }
  };
  const rows = Array.from({ length: Math.ceil((q.max + 1) / perRow) }, (_, r) => Array.from({ length: Math.min(perRow, q.max + 1 - r * perRow) }, (_, c) => r * perRow + c));
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-4">
        <Host who={q.cast} size={Math.min(140, window.innerHeight * 0.17)} />
        {q.from > 0 && <div className="font-black" style={{ fontSize: 'clamp(44px, 9vw, 84px)' }}>{q.from} <span className="text-yellow-300">{dir > 0 ? '+' : '−'}</span> {Math.abs(q.by)}</div>}
        <div className="font-black text-3xl text-teal-100">{hops ? `${hops} 🐸` : ''}</div>
      </div>
      <div className="flex flex-col gap-6 mt-6">
        {rows.map((row, r) => (
          <div key={r} className="flex gap-1.5">
            {row.map(n => (
              <div key={n} className="relative flex flex-col items-center">
                <div className="absolute flex justify-center" style={{ bottom: stone * 0.85, width: stone, fontSize: stone * 0.8, lineHeight: 1 }}>
                  {n === at && <span style={{ animation: got ? 'lc-bounce .7s ease-out 2' : 'll-hop .45s ease-out' }} key={`${at}-${hops}`}>🐸</span>}
                </div>
                <div className="rounded-full font-black flex items-center justify-center" style={{ width: stone, height: stone * 0.8, fontSize: stone * 0.42,
                  background: n === at ? '#fde047' : hint && n === goal ? '#bbf7d0' : 'rgba(255,255,255,.85)', color: '#134e4a', boxShadow: hint && n === goal ? '0 0 0 4px #22c55e' : undefined }}>{n}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Answers listening={listening} className="flex items-center gap-6 mt-1">
        <button type="button" onClick={hop} aria-label="Hop" className="rounded-full font-black flex items-center justify-center gap-2 shadow-xl px-8"
          style={{ height: 110, fontSize: 44, background: '#fff', color: '#166534', animation: 'll-boing .4s ease-out both' }}><span style={{ fontSize: 60 }}>🐸</span>HOP</button>
        {hops > 0 && <CheckButton onClick={check} glow={hint && at === goal} />}
      </Answers>
    </div>
  );
};

export default LittleLessons;
