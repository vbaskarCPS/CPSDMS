// Pieces the host app and MainstreetAI › Meetings share: a call's card (with how it went) and the weekly-hours editor.
import React, { useState } from 'react';
import { Plus, Video, X } from 'lucide-react';
import {
  DAYS, STATUS_LABEL, STATUS_TONE, TIMEZONES, setOutcome, timeLabel, dayLabel, toHHMM, toMin, type Hours, type Meeting, type MeetingStatus,
} from '../../lib/meetings';
import { Btn, ErrorBox, Tag } from '../../ui';

const OUTCOMES: { key: Exclude<MeetingStatus, 'cancelled' | 'booked'>; label: string; kind?: 'o' | 'g' | 'r' }[] = [
  { key: 'closed', label: 'Closed', kind: 'g' }, { key: 'no_show', label: 'No-show', kind: 'o' }, { key: 'not_fit', label: 'Not a fit', kind: 'o' },
];

/** One call: when, the business and owner, who booked it, the Zoom link, and how it went. */
export const MeetingCard: React.FC<{
  m: Meeting; tz?: string; showHost?: boolean; onChanged: (m: Meeting) => void; actions?: React.ReactNode;
}> = ({ m, tz, showHost, onChanged, actions }) => {
  const [note, setNote] = useState(m.outcome_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
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
