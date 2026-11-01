// src/planner/features/workout/ExerciseSheet.tsx — tap an exercise: a YouTube video of it, Coach Claude's how-to,
// one mind-muscle cue and the mistakes to avoid. A flow ("Mobility flow", "Stretching") is broken into its moves,
// each with its own video. Cached per exercise + plan note (doc kind 'exinfo') after the first look.
import { useEffect, useState } from 'react';
import { ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import { exerciseInfo, type ExerciseInfo, type ExVideo } from '../../lib/ai';
import { getDoc, putDoc } from '../../lib/docs';
import { Button, Sheet } from '../../ui/primitives';
import { findExercise, isTimed } from './library';
import type { Exercise } from './types';

const kindOf = (name: string, lib?: Exercise | null): 'exercise' | 'stretch' | 'cardio' => (/stretch|mobility|flow|pigeon|cat.cow|90.90|hip opener|couch|child'?s pose|foam/i.test(name) ? 'stretch' : lib && isTimed(lib) && /walk|bike|row|run|jog|interval|hiit|elliptical|stair/i.test(name) ? 'cardio' : 'exercise');
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

function Video({ videos, onEmpty }: { videos: ExVideo[]; onEmpty: string }) {
  const [i, setI] = useState(0);
  const v = videos[i % Math.max(1, videos.length)];
  if (!v) return <a className="pl-btn pl-btn--small" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${onEmpty}`)}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Search YouTube for it</a>;
  return (
    <>
      <div className="wo-video"><iframe key={v.id} src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1&playsinline=1`} title={v.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" /></div>
      <div className="pl-row" style={{ gap: 8 }}>
        <small className="pl-muted pl-grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.seconds ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')} · ` : ''}{v.title}</small>
        {videos.length > 1 && <Button small ghost onClick={() => setI(x => x + 1)}><RefreshCw size={13} /> Another ({(i % videos.length) + 1}/{videos.length})</Button>}
        <a className="pl-btn pl-btn--small pl-btn--ghost" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> YouTube</a>
      </div>
    </>
  );
}

export function ExerciseSheet({ exerciseId, name, note, custom = [], onClose }: { exerciseId: string | null; name: string; note?: string; custom?: Exercise[]; onClose: () => void }) {
  const [info, setInfo] = useState<ExerciseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [part, setPart] = useState(0);
  const key = `${(exerciseId || name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}${note ? `~${hash(note)}` : ''}`;

  const load = async (force = false) => {
    setBusy(true); setErr(null);
    try {
      if (!force) { const c = await getDoc<ExerciseInfo>('exinfo', key); if (c?.fetchedAt && Array.isArray(c.parts)) { setInfo(c); return; } }
      const r = await exerciseInfo(name, kindOf(name, findExercise(exerciseId || '', custom)), note);
      setInfo(r); void putDoc('exinfo', key, r);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach Coach Claude"); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (name) { setInfo(null); setPart(0); void load(); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const parts = info?.parts || [];
  const cur = parts[part];
  return (
    <Sheet open={!!name} onClose={onClose} title={name}>
      {busy && !info && <p className="pl-muted" style={{ fontStyle: 'italic' }}><Sparkles size={14} aria-hidden /> Finding videos and asking Coach Claude…</p>}
      {err && <p className="pl-error">{err} <button type="button" className="pl-link" onClick={() => void load(true)}>Try again</button></p>}
      {info && (
        <div className="pl-stack wo-exinfo">
          {info.description && <p style={{ fontSize: 15, lineHeight: 1.45, margin: 0 }}>{info.description}</p>}
          {parts.length > 0 ? (
            <>
              <p className="pl-label">The moves — tap one</p>
              <div className="wo-parts">{parts.map((p, i) => <button key={i} type="button" className={i === part ? 'is-on' : ''} onClick={() => setPart(i)}><b>{i + 1}</b> {p.name}<small>{p.dose}</small></button>)}</div>
              {cur && (
                <div className="pl-stack wo-part" key={part}>
                  <Video videos={cur.videos} onEmpty={cur.name} />
                  {cur.cue && <div className="wo-tip is-ai"><Sparkles size={14} aria-hidden /> <span><b>{cur.name}:</b> {cur.cue}</span></div>}
                  {parts.length > 1 && <div className="pl-row" style={{ gap: 8 }}>
                    <Button small ghost disabled={part === 0} onClick={() => setPart(p => p - 1)}>← Previous</Button>
                    <Button small ghost disabled={part >= parts.length - 1} onClick={() => setPart(p => p + 1)} style={{ marginLeft: 'auto' }}>Next move →</Button>
                  </div>}
                </div>
              )}
            </>
          ) : <Video videos={info.videos} onEmpty={name} />}
          {info.tip && <div className="wo-tip is-ai"><Sparkles size={14} aria-hidden /> <span><b>Feel it here:</b> {info.tip}</span></div>}
          {info.setup.length > 0 && <div><p className="pl-label">How to</p><ol className="wo-exinfo__list">{info.setup.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
          {info.mistakes.length > 0 && <div><p className="pl-label">Watch out for</p><ul className="wo-exinfo__list">{info.mistakes.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          <div className="pl-row" style={{ gap: 8 }}>
            <Button small ghost onClick={() => void load(true)} disabled={busy}><RefreshCw size={13} /> {busy ? 'Refreshing…' : 'Refresh'}</Button>
            <Button ghost style={{ marginLeft: 'auto' }} onClick={onClose}>Back to the session</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
