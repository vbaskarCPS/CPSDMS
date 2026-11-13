// src/v2/features/benny/DraftCard.tsx — the live crew draft, in the Benny's chat (for whoever started it) and on its own
// page (/app/draft/:id, which the "your pick" notification opens). Updates every few seconds while it's open.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { draftCancel, draftCrews, draftPick, draftUndo, draftView, leftToPick, teamFirst, type Draft } from '../../lib/bennyDraft';

const EVERY_MS = 3000;
const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

export const DraftCard: React.FC<{ id: string; initial?: Draft | null; onDone?: (d: Draft) => void; doneLabel?: string }> = ({ id, initial, onDone, doneLabel }) => {
  const [d, setD] = useState<Draft | null>(initial || null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const gone = useRef(false);
  const load = useCallback(async () => {
    try { const v = await draftView(id); if (!gone.current) { setD(v); setErr(null); } }
    catch (e) { if (!gone.current) setErr(e instanceof Error ? e.message : 'Couldn’t load the draft'); }
  }, [id]);
  useEffect(() => {
    gone.current = false;
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, EVERY_MS);
    return () => { gone.current = true; window.clearInterval(t); };
  }, [load]);

  const act = async (key: string, fn: () => Promise<Draft>) => {
    setBusy(key); setErr(null);
    try { setD(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : 'That didn’t work'); void load(); } finally { setBusy(null); }
  };

  if (!d) return <div className="benny-draft">{err ? <p className="benny-err">{err}</p> : <Loader2 size={16} className="spin" />}</div>;
  const left = leftToPick(d);
  const turnTeam = d.teams.find(t => t.key === d.turn);
  const first = d.teams.find(t => t.key === d.first_team);
  const crews = draftCrews(d);
  const mineTurn = d.state === 'open' && d.mine && d.mine === d.turn;
  return (
    <div className="benny-draft" role="group" aria-label="Crew draft">
      <div className="benny-draft-h">
        <b>Crew draft · {pretty(d.day)}</b>
        <span className="benny-mut">Coin toss: {first ? teamFirst(first) : '?'} picked first · snake order</span>
      </div>
      {d.rules && <p className="benny-draft-rules">Keep in mind: {d.rules}</p>}
      <div className={`benny-draft-turn${mineTurn ? ' mine' : ''}`} role="status">
        {d.state === 'done' ? 'Everyone’s picked.' : d.state === 'cancelled' ? 'This draft was called off.'
          : mineTurn ? 'Your pick.' : turnTeam ? `${teamFirst(turnTeam)}’s pick${d.can_pick ? ' (you can pick for them)' : ''}.` : ''}
        {d.state === 'open' && <span className="benny-mut"> {left.length} left</span>}
      </div>
      <div className="benny-draft-teams">
        {d.teams.map((t, i) => (
          <div key={t.key} className={`benny-draft-team${t.key === d.turn ? ' on' : ''}`}>
            <span className="benny-sub">{teamFirst(t)} · {t.picks.length}</span>
            <ol>{crews[i].map((n, j) => <li key={j}>{n}</li>)}</ol>
          </div>))}
      </div>
      {d.state === 'open' && <div className="benny-draft-pool">
        {left.map(w => (
          <div key={w.hire_id} className="benny-draft-w">
            <span className="benny-draft-wn">{w.name}</span>
            <span className="benny-mut">{w.avg != null ? `${w.avg.toFixed(1)} equiv · ${w.days} day${w.days === 1 ? '' : 's'}` : 'no days yet'}</span>
            {d.can_pick && <button type="button" className="benny-go" disabled={!!busy} onClick={() => void act(w.hire_id, () => draftPick(d.id, w.hire_id))}>
              {busy === w.hire_id ? <Loader2 size={14} className="spin" /> : 'Pick'}</button>}
          </div>))}
      </div>}
      {err && <p className="benny-err" role="alert">{err}</p>}
      {d.is_owner && <div className="benny-card-b">
        {d.state === 'done' && onDone && <button type="button" className="benny-go" onClick={() => onDone(d)}>{doneLabel || 'Make the Start the day card'}</button>}
        {d.state !== 'cancelled' && d.picks.length > 0 && <button type="button" className="benny-alt" disabled={!!busy} onClick={() => void act('undo', () => draftUndo(d.id))}><Undo2 size={14} /> Undo last pick</button>}
        {d.state === 'open' && <button type="button" className="benny-alt" disabled={!!busy} onClick={() => void act('cancel', () => draftCancel(d.id))}>Call it off</button>}
      </div>}
      {!d.is_owner && d.state === 'done' && <p className="benny-mut">{d.owner.split(' ')[0]} starts the day from here.</p>}
    </div>
  );
};
