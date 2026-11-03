// Pieces the host app and MainstreetAI › Meetings share: a call's card (with how it went) and the weekly-hours editor.
import React, { useState } from 'react';
import { ChevronDown, ClipboardList, Plus, Video, X } from 'lucide-react';
import {
  hasAnswers, DAYS, STATUS_LABEL, STATUS_TONE, TIMEZONES, setMeetingFollowUp, setOutcome, timeLabel, dayLabel, toHHMM, toMin, type DeckAnswers, type Hours, type Meeting, type MeetingStatus,
} from '../../lib/meetings';
import { Btn, ErrorBox, Tag } from '../../ui';

const OUTCOMES: { key: Exclude<MeetingStatus, 'cancelled' | 'booked'>; label: string; kind?: 'o' | 'g' | 'r' }[] = [
  { key: 'closed', label: 'Closed', kind: 'g' }, { key: 'no_show', label: 'No-show', kind: 'o' }, { key: 'not_fit', label: 'Not a fit', kind: 'o' },
];

/** What the owner answered on the deck, and the proposal it made: a clear button to open before the call, for prep. */
export const AnswersPanel: React.FC<{ a: DeckAnswers | null | undefined; open?: boolean; label?: string; quiet?: boolean }> = ({ a, open, label = 'Prep: their answers', quiet }) => {
  if (!hasAnswers(a)) return quiet ? null : <div className="v2-answers-none">No answers from the deck for this one.</div>;
  const p = a.proposal;
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
  const n = (a.summary || []).length;
  return (
    <details className="v2-answers" open={open}>
      <summary>
        <ClipboardList size={17} aria-hidden />
        <span className="t"><b>{label}</b>
          <small>{n} answer{n === 1 ? '' : 's'}{p ? ` · proposal about ${money(p.yearly)} a year${p.quoted ? ' plus Core (quoted)' : ''}` : ''}</small></span>
        <ChevronDown size={18} className="chev" aria-hidden />
      </summary>
      <div className="body">
        <dl>{(a.summary || []).map(([q, v]) => <React.Fragment key={q}><dt>{q}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        {p && <div className="prop">
          {p.lines.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          <div className="tot"><span>About a year</span><b>{money(p.yearly)}</b></div>
          {p.today_yearly != null && <div className="v2-small v2-mut">Pays about {money(p.today_yearly)} a year now{p.savings != null && p.savings > 0 ? `: saves about ${money(p.savings)}` : ''}</div>}
        </div>}
      </div>
    </details>
  );
};

/** "2026-11-03T14:30" for a datetime-local input, in this browser's time. */
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** One call: when, the business and owner, who booked it, the Zoom link, and how it went. */
export const MeetingCard: React.FC<{
  m: Meeting; tz?: string; showHost?: boolean; onChanged: (m: Meeting) => void; actions?: React.ReactNode;
}> = ({ m, tz, showHost, onChanged, actions }) => {
  const [note, setNote] = useState(m.outcome_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [fuOpen, setFuOpen] = useState(false);
  const [fuAt, setFuAt] = useState(() => (m.follow_up_at ? toLocalInput(m.follow_up_at) : ''));
  const followUp = async (clear = false) => {
    if (!clear && !fuAt) { setError(new Error('When should you follow up?')); return; }
    setBusy(true); setError(null);
    try { onChanged(await setMeetingFollowUp(m.id, clear ? null : new Date(fuAt).toISOString(), note)); setFuOpen(false); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const zone = tz || m.timezone;
  const started = new Date(m.starts_at).getTime() <= Date.now();
  const mark = async (s: Exclude<MeetingStatus, 'cancelled'>) => {
    setBusy(true); setError(null);
    try { onChanged(await setOutcome(m.id, s, note)); setEditing(false); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const open = m.status === 'booked' || editing;
  return (
    <div className={`v2-meet${m.status === 'cancelled' ? ' off' : ''}`}>
      <div className="h">
        <div className="t"><b>{timeLabel(m.starts_at, zone)}</b><span>{dayLabel(m.starts_at, zone)} · {m.length_min} min</span></div>
        <div className="n">
          <b>{m.business.name}</b>
          <span>{m.owner_name}{m.owner_phone ? ` · ` : ''}{m.owner_phone && <a href={`tel:${m.owner_phone.replace(/[^0-9+]/g, '')}`}>{m.owner_phone}</a>}{m.owner_email ? ` · ${m.owner_email}` : ''}</span>
          {m.business.address && <span>{m.business.address}</span>}
        </div>
        <Tag tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Tag>
      </div>
      <div className="v2-small v2-mut">
        {showHost && <>Host {m.host.name} · </>}{m.rep ? <>Booked by {m.rep.name}{m.rep.phone ? <> · <a href={`tel:${m.rep.phone.replace(/[^0-9+]/g, '')}`}>{m.rep.phone}</a></> : ''}</> : 'Booked by an admin'} · {m.campaign.name}
      </div>
      {m.notes && <div className="v2-small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.notes}</div>}
      {m.status === 'booked' && m.follow_up_at && (
        <div className="v2-small" style={{ marginTop: 4, color: new Date(m.follow_up_at).getTime() < Date.now() ? '#b91c1c' : '#b45309', fontWeight: 700 }}>
          Follow up {dayLabel(m.follow_up_at, zone)} at {timeLabel(m.follow_up_at, zone)}{m.outcome_note ? `: ${m.outcome_note}` : ''}
          {' '}<button type="button" className="v2-linkbtn" disabled={busy} onClick={() => followUp(true)}>Clear</button>
        </div>)}
      <AnswersPanel a={m.answers} />
      {m.status !== 'booked' && m.status !== 'cancelled' && !editing && (
        <div className="v2-small" style={{ marginTop: 4 }}>
          {m.outcome_by ? `${m.outcome_by} marked it ${STATUS_LABEL[m.status].toLowerCase()}` : STATUS_LABEL[m.status]}{m.outcome_note ? `: ${m.outcome_note}` : ''}
          {' '}<button type="button" className="v2-linkbtn" onClick={() => setEditing(true)}>Change</button>
        </div>)}
      <div className="v2-meet-acts">
        {m.host.zoom_url && m.status === 'booked' && <a className="v2-btn" href={m.host.zoom_url} target="_blank" rel="noreferrer"><Video size={15} />Zoom</a>}
        {open && m.status !== 'cancelled' && (started || editing) && <>
          <input className="v2-input" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          {OUTCOMES.map(o => <Btn key={o.key} kind={o.kind} size="sm" disabled={busy} onClick={() => mark(o.key)}>{o.label}</Btn>)}
          {(m.status === 'booked' || m.status === 'no_show') && <Btn kind="o" size="sm" disabled={busy} onClick={() => setFuOpen(v => !v)}>Follow up</Btn>}
          {fuOpen && <>
            <input className="v2-input" type="datetime-local" value={fuAt} onChange={e => setFuAt(e.target.value)} aria-label="Follow up on" style={{ maxWidth: 230 }} />
            <Btn size="sm" disabled={busy} onClick={() => followUp()}>Save follow-up</Btn>
          </>}
          {editing && <Btn kind="o" size="sm" disabled={busy} onClick={() => mark('booked')}>Back to booked</Btn>}
        </>}
        {actions}
      </div>
      <ErrorBox error={error} />
    </div>
  );
};

/** Weekly hours: each day on or off, with one or more blocks of time. */
export const HoursEditor: React.FC<{ hours: Hours; onChange: (h: Hours) => void }> = ({ hours, onChange }) => {
  const set = (day: number, blocks: [number, number][]) => {
    const next = { ...hours };
    if (blocks.length) next[String(day)] = blocks; else delete next[String(day)];
    onChange(next);
  };
  return (
    <div className="v2-hours">
      {[1, 2, 3, 4, 5, 6, 0].map(i => {
        const blocks = hours[String(i)] || [];
        return (
          <div key={i} className="row">
            <label className="d"><input type="checkbox" checked={blocks.length > 0} onChange={e => set(i, e.target.checked ? [[540, 1020]] : [])} /> {DAYS[i].slice(0, 3)}</label>
            <div className="b">
              {!blocks.length && <span className="v2-mut v2-small">Off</span>}
              {blocks.map(([a, b], k) => (
                <span key={k} className="blk">
                  <input type="time" step={1800} value={toHHMM(a)} onChange={e => set(i, blocks.map((x, j) => (j === k ? [toMin(e.target.value), x[1]] : x)))} />
                  –
                  <input type="time" step={1800} value={toHHMM(Math.min(b, 1439))} onChange={e => set(i, blocks.map((x, j) => (j === k ? [x[0], toMin(e.target.value)] : x)))} />
                  {blocks.length > 1 && <button type="button" className="v2-rep-x" aria-label="Remove these hours" onClick={() => set(i, blocks.filter((_, j) => j !== k))}><X size={14} /></button>}
                </span>))}
              {!!blocks.length && <button type="button" className="v2-linkbtn" onClick={() => set(i, [...blocks, [Math.min(blocks[blocks.length - 1][1] + 60, 1380), Math.min(blocks[blocks.length - 1][1] + 180, 1440)]])}><Plus size={12} /> hours</button>}
            </div>
          </div>);
      })}
    </div>
  );
};

/** Days off: dates with no calls. */
export const DaysOff: React.FC<{ days: string[]; onChange: (d: string[]) => void }> = ({ days, onChange }) => {
  const [add, setAdd] = useState('');
  const today = new Date().toLocaleDateString('en-CA');
  const shown = [...days].filter(d => d >= today).sort();
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="v2-input" type="date" min={today} value={add} onChange={e => setAdd(e.target.value)} style={{ width: 180 }} />
        <Btn kind="o" disabled={!add || days.includes(add)} onClick={() => { onChange([...days, add]); setAdd(''); }}>Add day off</Btn>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {!shown.length && <span className="v2-small v2-mut">None coming up.</span>}
        {shown.map(d => <span key={d} className="v2-chipx">{new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
          <button type="button" aria-label="Remove" onClick={() => onChange(days.filter(x => x !== d))}><X size={12} /></button></span>)}
      </div>
    </div>
  );
};

export const TimezoneSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <select className="v2-sel" value={value} onChange={e => onChange(e.target.value)}>
    {[...new Set([value, ...TIMEZONES])].map(z => <option key={z} value={z}>{z.replace('America/', '').replace('_', ' ')}</option>)}
  </select>
);
