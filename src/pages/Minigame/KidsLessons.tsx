// src/pages/Minigame/KidsLessons.tsx — the grown-ups' page for Little Lessons (/minigame/kids): for each kid,
// the mix of lessons (percent chess / sight words / math), the pace (right answers to move up a level,
// questions per sticker, how often older levels come back), and how they're doing: the level in each
// subject, how far into the next one, and the last 7 days. A grown-up can also move a subject to a level.
// Settings save to the kid's account ("lessons_settings"); the kid's tablet picks them up next time it opens.
import React, { useEffect, useState } from 'react';
import { listKids, saveKidSettings, type Kid } from './account';
import { LEVELS, SUBJECTS, SUBJECT_LABEL, type Subject } from '../../lib/littleLessons/levels';
import { lastDays, readProgress, readSettings, type LessonSettings } from '../../lib/littleLessons/engine';

const BG = 'radial-gradient(120% 80% at 50% 0%, #0f766e 0%, #134e4a 55%, #042f2e 100%)';
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const card = 'rounded-3xl bg-white text-gray-900 p-5 shadow-xl';

const KidsLessons: React.FC<{ exit: () => void }> = ({ exit }) => {
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => listKids().then(setKids).catch(e => setError(msg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => { const was = document.title; document.title = "Kids' lessons"; return () => { document.title = was; }; }, []);
  return (
    <div className="min-h-screen w-full text-white" style={{ background: BG, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="max-w-2xl mx-auto px-4 pb-12" style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
        <button type="button" onClick={exit} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-semibold">‹ Games</button>
        {error && <div className="mt-4 text-red-200">{error}</div>}
        {!kids && !error && <div className="mt-8 text-teal-100 animate-pulse">Loading…</div>}
        {kids?.length === 0 && <div className="mt-8 text-teal-100">No kid accounts yet.</div>}
        {kids?.map(k => <KidPage key={k.id} kid={k} onSaved={load} />)}
      </div>
    </div>
  );
};

const KidPage: React.FC<{ kid: Kid; onSaved: () => void }> = ({ kid, onSaved }) => {
  const saved = readSettings(kid.settings as Partial<LessonSettings> | null);
  const [s, setS] = useState<LessonSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = readProgress(kid.lessons as never, kid.chess);
  const week = lastDays(p);
  const total = SUBJECTS.reduce((t, x) => t + (s.mix[x] || 0), 0);
  const changed = JSON.stringify({ ...s, set: undefined }) !== JSON.stringify({ ...saved, set: undefined });

  const store = async (next: LessonSettings, done: string) => {
    setBusy(true); setError(null); setNote(null);
    try { await saveKidSettings(kid.id, next as unknown as Record<string, unknown>); setS(next); setNote(done); onSaved(); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  const setMix = (x: Subject, v: number) => setS(o => ({ ...o, mix: { ...o.mix, [x]: Math.max(0, Math.min(100, Math.round(v) || 0)) } }));
  const moveTo = (x: Subject, level: number) =>
    store({ ...s, set: { ...s.set, [x]: { pos: level, at: new Date().toISOString() } } },
      `${SUBJECT_LABEL[x]} moves to level ${level + 1} next time ${kid.name} opens Little Lessons.`);

  return (
    <div className="mt-6 grid gap-4">
      <div>
        <div className="text-xs uppercase tracking-widest text-teal-200">Little Lessons</div>
        <div className="text-3xl font-extrabold">{kid.name}'s lessons</div>
        <div className="text-sm text-teal-100 mt-1">{p.stickers.length} sticker{p.stickers.length === 1 ? '' : 's'}{kid.updated_at ? ` · last played ${new Date(kid.updated_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' · not played yet'}</div>
      </div>

      <div className={card}>
        <div className="font-bold text-lg">The mix</div>
        <div className="text-sm text-gray-500">How often each kind of lesson comes up. Adds up to 100.</div>
        {SUBJECTS.map(x => (
          <div key={x} className="flex items-center gap-3 mt-4">
            <div className="w-28 font-semibold">{SUBJECT_LABEL[x]}</div>
            <input type="range" min={0} max={100} step={5} value={s.mix[x]} onChange={e => setMix(x, Number(e.target.value))} className="flex-1 accent-teal-700" />
            <input type="number" min={0} max={100} value={s.mix[x]} onChange={e => setMix(x, Number(e.target.value))}
              className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-right" style={{ background: '#fff', color: '#111827' }} />
            <span className="text-gray-500">%</span>
          </div>
        ))}
        <div className={`text-sm mt-3 font-semibold ${total === 100 ? 'text-teal-700' : 'text-red-600'}`}>Total {total}%{total !== 100 && ' — make it 100'}</div>

        <div className="font-bold text-lg mt-6">The pace</div>
        <Num label="Right answers to move up a level" hint="The next level is mixed in a little with each right answer; a miss eases it back." value={s.perLevel} min={3} max={30} onChange={v => setS(o => ({ ...o, perLevel: v }))} />
        <Num label="Questions before a sticker" value={s.session} min={3} max={30} onChange={v => setS(o => ({ ...o, session: v }))} />
        <Num label="Older levels for practice (%)" value={Math.round(s.review * 100)} min={0} max={50} onChange={v => setS(o => ({ ...o, review: v / 100 }))} />

        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
        {note && <div className="text-sm text-teal-700 mt-3">{note}</div>}
        <button type="button" disabled={busy || !changed || total !== 100} onClick={() => store(s, `Saved. ${kid.name}'s tablet uses it next time Little Lessons opens.`)}
          className="mt-5 w-full py-3 rounded-2xl bg-teal-700 text-white font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {SUBJECTS.map(x => {
        const levels = LEVELS[x], pos = p.pos[x], at = Math.floor(pos), into = Math.round((pos - at) * 100);
        const [right, missed] = week[x];
        const pending = s.set[x] && p.applied[x] !== s.set[x]!.at ? s.set[x]!.pos : null;
        return (
          <div key={x} className={card}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-bold text-lg">{SUBJECT_LABEL[x]}</div>
              <div className="text-sm text-gray-500">level {at + 1} of {levels.length}</div>
            </div>
            <div className="mt-1 font-semibold">{levels[at].title}</div>
            <div className="h-3 rounded-full bg-gray-100 mt-3 overflow-hidden"><div className="h-full bg-teal-600" style={{ width: `${(pos / Math.max(1, levels.length - 1)) * 100}%` }} /></div>
            <div className="text-sm text-gray-600 mt-2">
              {at + 1 < levels.length ? <>{into ? <><b>{into}%</b> of questions now from the next level: {levels[at + 1].title}</> : <>Next up: {levels[at + 1].title}</>}</> : <>Last level.</>}
            </div>
            <div className="text-sm text-gray-600 mt-1">Last 7 days: {right + missed ? <><b>{right}</b> right first try, {missed} with a miss ({Math.round((right / (right + missed)) * 100)}%)</> : 'not played'}</div>
            <div className="flex items-center gap-2 mt-4">
              <select defaultValue="" onChange={e => { if (e.target.value !== '') { moveTo(x, Number(e.target.value)); e.target.value = ''; } }} disabled={busy}
                className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-sm" style={{ background: '#fff', color: '#111827' }}>
                <option value="">Move to a level…</option>
                {levels.map((l, i) => <option key={l.id} value={i}>{i + 1}. {l.title}</option>)}
              </select>
            </div>
            {pending !== null && <div className="text-xs text-amber-700 mt-2">Moving to level {pending + 1} the next time he opens Little Lessons.</div>}
          </div>
        );
      })}
    </div>
  );
};

const Num: React.FC<{ label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, hint, value, min, max, onChange }) => (
  <label className="flex items-center justify-between gap-3 mt-4">
    <span><span className="font-semibold">{label}</span>{hint && <span className="block text-xs text-gray-500">{hint}</span>}</span>
    <input type="number" min={min} max={max} value={value} onChange={e => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value)) || min)))}
      className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right" style={{ background: '#fff', color: '#111827' }} />
  </label>
);

export default KidsLessons;
