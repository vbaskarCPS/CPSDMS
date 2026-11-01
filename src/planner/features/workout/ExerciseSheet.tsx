// src/planner/features/workout/ExerciseSheet.tsx — tap an exercise: a YouTube video of it, Coach Claude's how-to,
// one mind-muscle cue and the mistakes to avoid. Cached per exercise (doc kind 'exinfo') after the first look.
import { useEffect, useState } from 'react';
import { ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import { exerciseInfo, type ExerciseInfo } from '../../lib/ai';
import { getDoc, putDoc } from '../../lib/docs';
import { Button, Sheet } from '../../ui/primitives';
import { findExercise, isTimed } from './library';
import type { Exercise } from './types';

const kindOf = (name: string, lib?: Exercise | null): 'exercise' | 'stretch' | 'cardio' => (/stretch|mobility|flow|pigeon|cat.cow|90.90|hip opener|couch|child'?s pose|foam/i.test(name) ? 'stretch' : lib && isTimed(lib) && /walk|bike|row|run|jog|interval|hiit|elliptical|stair/i.test(name) ? 'cardio' : 'exercise');

export function ExerciseSheet({ exerciseId, name, custom = [], onClose }: { exerciseId: string | null; name: string; custom?: Exercise[]; onClose: () => void }) {
  const [info, setInfo] = useState<ExerciseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vid, setVid] = useState(0);
  const key = (exerciseId || name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const load = async (force = false) => {
    setBusy(true); setErr(null);
    try {
      if (!force) { const c = await getDoc<ExerciseInfo>('exinfo', key); if (c?.fetchedAt) { setInfo(c); return; } }
      const r = await exerciseInfo(name, kindOf(name, findExercise(exerciseId || '', custom)));
      setInfo(r); void putDoc('exinfo', key, r);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach Coach Claude"); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (exerciseId !== null || name) { setInfo(null); setVid(0); void load(); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = info?.videos[vid];
  return (
    <Sheet open={!!name} onClose={onClose} title={name}>
      {busy && !info && <p className="pl-muted" style={{ fontStyle: 'italic' }}><Sparkles size={14} aria-hidden /> Finding a video and asking Coach Claude…</p>}
      {err && <p className="pl-error">{err} <button type="button" className="pl-link" onClick={() => void load(true)}>Try again</button></p>}
      {info && (
        <div className="pl-stack wo-exinfo">
          {v ? (
            <>
              <div className="wo-video"><iframe src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1&playsinline=1`} title={v.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" /></div>
              <div className="pl-row" style={{ gap: 8 }}>
                <small className="pl-muted pl-grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</small>
                {info.videos.length > 1 && <Button small ghost onClick={() => setVid(i => (i + 1) % info.videos.length)}><RefreshCw size={13} /> Another</Button>}
                <a className="pl-btn pl-btn--small pl-btn--ghost" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> YouTube</a>
              </div>
            </>
          ) : <a className="pl-btn pl-btn--small" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${name}`)}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Search YouTube for it</a>}
          {info.description && <p style={{ fontSize: 15, lineHeight: 1.45, margin: 0 }}>{info.description}</p>}
          {info.tip && <div className="wo-tip is-ai"><Sparkles size={14} aria-hidden /> <span><b>Feel it here:</b> {info.tip}</span></div>}
          {info.setup.length > 0 && <div><p className="pl-label">How to</p><ol className="wo-exinfo__list">{info.setup.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
          {info.mistakes.length > 0 && <div><p className="pl-label">Watch out for</p><ul className="wo-exinfo__list">{info.mistakes.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          <Button block ghost onClick={onClose}>Back to the session</Button>
        </div>
      )}
    </Sheet>
  );
}
