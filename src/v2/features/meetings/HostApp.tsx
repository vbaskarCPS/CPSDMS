// /app/host — an onboarding host's own screen: their calls (Zoom, and how each went: Closed, No-show, Not a fit),
// and their Zoom link, weekly hours and days off, which decide the open times reps see on the deck.
import React, { useEffect, useMemo, useState } from 'react';
import { useLoad } from '../../lib/data';
import { dayKey, hostMe, hoursSummary, longDay, meetingsList, saveMyHours, type Hours, type HostMe, type Meeting } from '../../lib/meetings';
import { Btn, Card, ErrorBox, Field, Loading, Tabs } from '../../ui';
import { DaysOff, HoursEditor, MeetingCard, TimezoneSelect } from './shared';
import './meetings.css';

export const HostApp: React.FC = () => {
  const me = useLoad(hostMe, []);
  const [tab, setTab] = useState<'calls' | 'hours'>('calls');
  if (me.loading && !me.data) return <div className="v2-main v2-narrow"><Loading /></div>;
  if (me.error) return <div className="v2-main v2-narrow"><ErrorBox error={me.error} /></div>;
  if (!me.data) return <div className="v2-main v2-narrow"><div className="v2-card">You aren’t set up to take onboarding calls. A MainstreetAI admin adds hosts under MainstreetAI › Meetings.</div></div>;
  const h = me.data;
  return (
    <div className="v2-main v2-narrow">
      <div className="v2-h1" style={{ margin: '6px 0 2px' }}>Onboarding calls</div>
      <div className="v2-mut v2-small" style={{ marginBottom: 12 }}>{h.campaign ? `${h.campaign.name} · ` : ''}{h.active ? hoursSummary(h.hours) : 'Turned off: no new calls are booked with you'}</div>
      {!h.zoom_url && <div className="v2-note" style={{ marginBottom: 10 }}>Add your Zoom link under My hours: it goes in every booking email.</div>}
      <Tabs items={[{ key: 'calls', label: 'My calls' }, { key: 'hours', label: 'My hours' }]} value={tab} onChange={setTab} />
      {tab === 'calls' ? <MyCalls tz={h.timezone} /> : <MyHours me={h} onSaved={me.reload} />}
    </div>
  );
};

const MyCalls: React.FC<{ tz: string }> = ({ tz }) => {
  const range = useMemo(() => { const n = Date.now(); return { from: new Date(n - 14 * 864e5).toISOString(), to: new Date(n + 60 * 864e5).toISOString() }; }, []);
  const list = useLoad(() => meetingsList(range.from, range.to), [range]);
  const [rows, setRows] = useState<Meeting[]>([]);
  useEffect(() => { if (list.data) setRows(list.data); }, [list.data]);
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  const now = Date.now();
  const due = rows.filter(m => m.status === 'booked' && new Date(m.starts_at).getTime() <= now);
  const next = rows.filter(m => m.status === 'booked' && new Date(m.starts_at).getTime() > now);
  const done = rows.filter(m => m.status !== 'booked').reverse();
  const put = (m: Meeting) => setRows(r => r.map(x => (x.id === m.id ? m : x)));
  const byDay = (ms: Meeting[]) => {
    const out: { day: string; label: string; items: Meeting[] }[] = [];
    for (const m of ms) { const k = dayKey(m.starts_at, tz); const g = out[out.length - 1]; if (g && g.day === k) g.items.push(m); else out.push({ day: k, label: longDay(m.starts_at, tz), items: [m] }); }
    return out;
  };
  return (
    <>
      {!!due.length && <><div className="v2-meet-day" style={{ color: '#b45309' }}>How did it go?</div>{due.map(m => <MeetingCard key={m.id} m={m} tz={tz} onChanged={put} />)}</>}
      {!next.length && !due.length && <div className="v2-card v2-mut" style={{ marginTop: 10 }}>No calls coming up.</div>}
      {byDay(next).map(g => <React.Fragment key={g.day}><div className="v2-meet-day">{g.label}</div>{g.items.map(m => <MeetingCard key={m.id} m={m} tz={tz} onChanged={put} />)}</React.Fragment>)}
      {!!done.length && <><div className="v2-meet-day">Last two weeks</div>{done.map(m => <MeetingCard key={m.id} m={m} tz={tz} onChanged={put} />)}</>}
    </>
  );
};

const MyHours: React.FC<{ me: HostMe; onSaved: () => void }> = ({ me, onSaved }) => {
  const [zoom, setZoom] = useState(me.zoom_url || '');
  const [tz, setTz] = useState(me.timezone);
  const [hours, setHours] = useState<Hours>(me.hours || {});
  const [off, setOff] = useState<string[]>(me.days_off || []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try { await saveMyHours(zoom.trim(), tz, hours, off); setSaved(true); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <>
      <Card title="Zoom link">
        <Field label="Your Zoom meeting link" hint="Owners get this in their booking email."><input className="v2-input" value={zoom} onChange={e => setZoom(e.target.value)} placeholder="https://zoom.us/j/…" inputMode="url" autoCapitalize="none" /></Field>
        <Field label="Your time zone"><TimezoneSelect value={tz} onChange={setTz} /></Field>
      </Card>
      <Card title="Weekly hours" right={<span className="v2-small v2-mut">{me.rules.length_min}-minute calls</span>}>
        <HoursEditor hours={hours} onChange={setHours} />
      </Card>
      <Card title="Days off"><DaysOff days={off} onChange={setOff} /></Card>
      <ErrorBox error={error} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 30px' }}>
        <Btn disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
        {saved && <span className="v2-small" style={{ color: '#15803d' }}>Saved. Calls already booked stay as they are.</span>}
      </div>
    </>
  );
};
