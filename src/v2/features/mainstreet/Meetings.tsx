// src/v2/features/mainstreet/Meetings.tsx — MainstreetAI › Meetings: the onboarding calls reps book from the deck's
// last slide. Calendar (day, week, list: move, reassign or cancel a call), Hosts (who takes the calls, their Zoom
// link and hours), and Booking rules (call length, gaps, notice, how far ahead, a cap per day).
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Mail, Plus, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLoad, sendSetupEmail } from '../../lib/data';
import { listCampaigns } from '../../lib/mainstreet';
import {
  addHost, changeMeeting, dayKey, getRules, hostsList, hoursSummary, longDay, meetingsList, notifyMeeting, saveHost, saveRules, timeLabel,
  STATUS_LABEL, type HostRow, type Meeting, type Rules,
} from '../../lib/meetings';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tabs, Tag, Toggle } from '../../ui';
import { DaysOff, HoursEditor, MeetingCard, TimezoneSelect } from '../meetings/shared';
import { CalendarLink } from '../meetings/CalendarLink';
import '../meetings/meetings.css';

type View = 'calendar' | 'hosts' | 'rules';

export const Meetings: React.FC = () => {
  const campaigns = useLoad(listCampaigns, []);
  const active = useMemo(() => (campaigns.data || []).filter(c => c.is_active), [campaigns.data]);
  const [campaign, setCampaign] = useState<string>('');
  useEffect(() => { if (!campaign && active.length) setCampaign(active[0].id); }, [active, campaign]);
  const [view, setView] = useState<View>(() => (['calendar', 'hosts', 'rules'] as View[]).find(v => v === new URLSearchParams(window.location.search).get('view')) || 'calendar');
  return (
    <div className="v2-main v2-ms">
      <div className="v2-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="v2-h1">Meetings</span>
        {active.length > 1 && <select className="v2-sel" style={{ width: 'auto' }} value={campaign} onChange={e => setCampaign(e.target.value)}>
          {active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <Link to="/app/host" className="v2-small" style={{ marginLeft: 'auto' }}>My own calls</Link>
      </div>
      <Tabs<View> value={view} onChange={setView} items={[{ key: 'calendar', label: 'Calendar' }, { key: 'hosts', label: 'Hosts' }, { key: 'rules', label: 'Booking rules' }]} />
      <ErrorBox error={campaigns.error} />
      {!campaign ? (campaigns.loading ? <Loading /> : <div className="v2-card">Add a campaign first (MainstreetAI › Campaigns).</div>)
        : view === 'calendar' ? <Calendar campaign={campaign} />
        : view === 'hosts' ? <Hosts campaign={campaign} />
        : <RulesForm campaign={campaign} />}
    </div>
  );
};

// ───────────── calendar ─────────────
type CalView = 'day' | 'week' | 'list';
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

const Calendar: React.FC<{ campaign: string }> = ({ campaign }) => {
  const [cv, setCv] = useState<CalView>(() => (typeof window !== 'undefined' && window.innerWidth < 760 ? 'list' : 'week'));
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [host, setHost] = useState('');
  const [tick, setTick] = useState(0);
  const range = useMemo(() => {
    if (cv === 'day') return { from: anchor, to: addDays(anchor, 1) };
    if (cv === 'week') { const m = monday(anchor); return { from: m, to: addDays(m, 7) }; }
    return { from: anchor, to: addDays(anchor, 30) };
  }, [cv, anchor]);
  const list = useLoad(() => meetingsList(range.from.toISOString(), range.to.toISOString(), host || null, campaign), [range, host, campaign, tick]);
  const hosts = useLoad(hostsList, [campaign]);
  const campHosts = (hosts.data || []).filter(h => h.campaign_id === campaign);
  const [open, setOpen] = useState<Meeting | null>(null);
  const step = cv === 'day' ? 1 : cv === 'week' ? 7 : 30;
  const title = cv === 'day' ? longDay(range.from.toISOString())
    : `${range.from.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} – ${addDays(range.to, -1).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
  const rows = list.data || [];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const counts = rows.reduce<Record<string, number>>((a, m) => ({ ...a, [m.status]: (a[m.status] || 0) + 1 }), {});
  return (
    <>
      <div className="v2-meet-bar">
        <div className="v2-rep-seg" style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 9, padding: 2 }}>
          {(['day', 'week', 'list'] as CalView[]).map(k => <button key={k} type="button" className={`v2-btn sm ${cv === k ? '' : 'o'}`} style={{ border: 0 }} onClick={() => setCv(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
        <Btn kind="o" size="sm" icon={ChevronLeft} aria-label="Earlier" onClick={() => setAnchor(a => addDays(a, -step))} />
        <Btn kind="o" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>Today</Btn>
        <Btn kind="o" size="sm" icon={ChevronRight} aria-label="Later" onClick={() => setAnchor(a => addDays(a, step))} />
        <b>{title}</b>
        <select className="v2-sel" value={host} onChange={e => setHost(e.target.value)} style={{ marginLeft: 'auto' }}>
          <option value="">All hosts</option>{campHosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      </div>
      <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>
        {rows.length} call{rows.length === 1 ? '' : 's'}{Object.entries(counts).map(([k, n]) => ` · ${n} ${STATUS_LABEL[k as Meeting['status']].toLowerCase()}`).join('')} · times in your time zone
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : cv === 'week' ? (
        <div className="v2-cal">
          {[0, 1, 2, 3, 4, 5, 6].map(i => {
            const d = addDays(range.from, i); const k = dayKey(d.toISOString(), tz);
            const evs = rows.filter(m => dayKey(m.starts_at, tz) === k);
            return (
              <div key={k} className={`col${k === dayKey(new Date().toISOString(), tz) ? ' today' : ''}`}>
                <b>{d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' })}</b>
                {evs.map(m => <button key={m.id} type="button" className={`ev ${m.status}`} onClick={() => setOpen(m)}>
                  <b>{timeLabel(m.starts_at)}</b> {m.business.name}<span>{m.host.name}</span></button>)}
              </div>);
          })}
        </div>
      ) : !rows.length ? <div className="v2-card v2-mut">No calls {cv === 'day' ? 'this day' : 'in the next 30 days'}.</div>
        : groupByDay(rows, tz).map(g => (
          <React.Fragment key={g.day}>
            {cv === 'list' && <div className="v2-meet-day">{g.label}</div>}
            {g.items.map(m => <MeetingCard key={m.id} m={m} tz={tz} showHost onChanged={() => setTick(t => t + 1)}
              actions={<Btn kind="o" size="sm" onClick={() => setOpen(m)}>Move, reassign or cancel</Btn>} />)}
          </React.Fragment>))}
      {open && <ChangeMeeting m={open} hosts={campHosts} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setTick(t => t + 1); }} />}
    </>
  );
};

function groupByDay(ms: Meeting[], tz: string) {
  const out: { day: string; label: string; items: Meeting[] }[] = [];
  for (const m of ms) { const k = dayKey(m.starts_at, tz); const g = out[out.length - 1]; if (g && g.day === k) g.items.push(m); else out.push({ day: k, label: longDay(m.starts_at, tz), items: [m] }); }
  return out;
}

const localInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

const ChangeMeeting: React.FC<{ m: Meeting; hosts: HostRow[]; onClose: () => void; onDone: () => void }> = ({ m, hosts, onClose, onDone }) => {
  const [when, setWhen] = useState(localInput(m.starts_at));
  const [host, setHost] = useState(m.host.id);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [note, setNote] = useState('');
  const run = async (cancel: boolean) => {
    setBusy(true); setError(null); setNote('');
    try {
      const moved = !cancel && new Date(when).toISOString() !== new Date(m.starts_at).toISOString();
      if (!cancel && !moved && host === m.host.id) { onClose(); return; }
      const r = await changeMeeting(m.id, cancel ? { cancel: true } : { start: moved ? new Date(when).toISOString() : null, host: host !== m.host.id ? host : null });
      const mail = await notifyMeeting(r.id, cancel ? 'cancelled' : 'changed');
      if ('error' in mail) { setNote(`Saved, but the emails didn’t go out: ${mail.error}`); setBusy(false); return; }
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setNote('');
    const r = await notifyMeeting(m.id, m.status === 'cancelled' ? 'cancelled' : 'booked');
    setNote('error' in r ? `Couldn’t send: ${r.error}` : `Sent to ${r.sent.join(' and ') || 'no one'}${r.skipped.length ? ` (no email for ${r.skipped.join(', ')})` : ''}.`);
    setBusy(false);
  };
  return (
    <Modal title={m.business.name} onClose={onClose} footer={<>
      {m.status !== 'cancelled' && <Btn kind="r" disabled={busy} onClick={() => run(true)}>Cancel the call</Btn>}
      <Btn kind="o" icon={Mail} disabled={busy} onClick={resend}>Resend emails</Btn>
      <Btn disabled={busy} onClick={() => run(false)}>{m.status === 'cancelled' ? 'Book it again' : 'Save'}</Btn>
    </>}>
      <div className="v2-small" style={{ marginBottom: 10 }}>
        <Tag>{STATUS_LABEL[m.status]}</Tag> {m.owner_name}{m.owner_phone ? ` · ${m.owner_phone}` : ''}{m.owner_email ? ` · ${m.owner_email}` : ''}
        {m.rep && <> · booked by {m.rep.name}</>}
      </div>
      <Field label="Time (your time zone)"><input className="v2-input" type="datetime-local" step={1800} value={when} onChange={e => setWhen(e.target.value)} /></Field>
      <Field label="Host" hint="If the host isn’t free at a new time, someone free is picked.">
        <select className="v2-sel" value={host} onChange={e => setHost(e.target.value)}>
          {!hosts.some(h => h.id === m.host.id) && <option value={m.host.id}>{m.host.name}</option>}
          {hosts.filter(h => h.active).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      </Field>
      <div className="v2-small v2-mut">The owner and host are emailed the change with an updated calendar invite.</div>
      {note && <div className="v2-note" style={{ marginTop: 8 }}>{note}</div>}
      <ErrorBox error={error} />
    </Modal>
  );
};

// ───────────── hosts ─────────────
const Hosts: React.FC<{ campaign: string }> = ({ campaign }) => {
  const [tick, setTick] = useState(0);
  const list = useLoad(hostsList, [tick]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HostRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const rows = (list.data || []).filter(h => h.campaign_id === campaign);
  const others = (list.data || []).filter(h => h.campaign_id !== campaign);
  const setup = async (h: HostRow) => {
    setErr(null); setMsg(null);
    try { const r = await sendSetupEmail(h.id); setMsg(`Setup email sent to ${r.email}.`); setTick(t => t + 1); } catch (e) { setErr(e); }
  };
  return (
    <>
      <div className="v2-meet-bar">
        <span className="v2-small v2-mut">Hosts take this campaign’s onboarding calls. Calls are shared out evenly between hosts who are free.</span>
        <Btn icon={Plus} style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>Add a host</Btn>
      </div>
      {msg && <div className="v2-note" style={{ marginBottom: 8 }}>{msg}</div>}
      <ErrorBox error={err || list.error} />
      {list.loading && !list.data ? <Loading /> : !rows.length ? <div className="v2-card v2-mut">No hosts yet. Add the people who take onboarding calls: until then reps can’t book from the deck.</div> : (
        <div className="v2-card" style={{ padding: 0 }}>
          <table className="v2-table">
            <thead><tr><th>Host</th><th>Hours</th><th>Zoom</th><th>Coming up</th><th /></tr></thead>
            <tbody>{rows.map(h => (
              <tr key={h.id} style={{ opacity: h.active ? 1 : 0.55 }}>
                <td className="lead" data-label="Host"><b>{h.name}</b>{!h.active && <> <Tag>Off</Tag></>}<div className="v2-small v2-mut">{h.email || h.username}{h.staff ? '' : !h.setup_used_at ? ' · hasn’t set up their account' : ''}</div></td>
                <td data-label="Hours" className="v2-small">{hoursSummary(h.hours)}<div className="v2-mut">{h.timezone.replace('America/', '')}{h.days_off.length ? ` · ${h.days_off.filter(d => d >= new Date().toLocaleDateString('en-CA')).length} days off` : ''}</div></td>
                <td data-label="Zoom" className="v2-small">{h.zoom_url ? <a href={h.zoom_url} target="_blank" rel="noreferrer">Link</a> : <Tag tone="a">Missing</Tag>}</td>
                <td data-label="Coming up">{h.upcoming}</td>
                <td className="full" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {!h.staff && !h.setup_used_at && h.email && <Btn kind="o" size="sm" icon={Send} onClick={() => setup(h)}>{h.setup_sent_at ? 'Resend setup' : 'Send setup email'}</Btn>}{' '}
                  <Btn kind="o" size="sm" onClick={() => setEditing(h)}>Edit</Btn>
                </td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {!!others.length && <div className="v2-small v2-mut" style={{ marginTop: 8 }}>Hosts on other campaigns: {others.map(h => `${h.name} (${h.campaign || 'none'})`).join(', ')}</div>}
      {adding && <AddHost campaign={campaign} onClose={() => setAdding(false)} onDone={m => { setAdding(false); setMsg(m); setTick(t => t + 1); }} />}
      {editing && <EditHost h={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); setTick(t => t + 1); }} />}
    </>
  );
};

const AddHost: React.FC<{ campaign: string; onClose: () => void; onDone: (msg: string) => void }> = ({ campaign, onClose, onDone }) => {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [zoom, setZoom] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const r = await addHost({ name, email, phone, zoom, campaign });
      if (r.new_account) {
        try { const s = await sendSetupEmail(r.id); onDone(`${name.trim()} is a host. A setup email went to ${s.email}: they choose a password, then sign in to see their calls and set their hours.`); }
        catch (e) { onDone(`${name.trim()} is a host, but the setup email didn’t send (${e instanceof Error ? e.message : String(e)}). Use “Send setup email”.`); }
      } else onDone(`${name.trim() || email} already has an account and is now a host. They see their calls at /app/host.`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a host" onClose={onClose} footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !name.trim() || !email.trim()} onClick={add}>{busy ? 'Adding…' : 'Add host'}</Btn></>}>
      <Field label="Name"><input className="v2-input" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Email" hint="If they already have an account with this email, it’s used. Otherwise they get a setup email."><input className="v2-input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoCapitalize="none" /></Field>
      <Field label="Phone (optional)"><input className="v2-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      <Field label="Zoom link (they can add it later)"><input className="v2-input" value={zoom} onChange={e => setZoom(e.target.value)} placeholder="https://zoom.us/j/…" autoCapitalize="none" /></Field>
      <div className="v2-small v2-mut">They start with Monday to Friday, 9 to 5 (Toronto time). They or you can change it.</div>
      <ErrorBox error={error} />
    </Modal>
  );
};

const EditHost: React.FC<{ h: HostRow; onClose: () => void; onDone: () => void }> = ({ h, onClose, onDone }) => {
  const campaigns = useLoad(listCampaigns, []);
  const [camp, setCamp] = useState(h.campaign_id || '');
  const [zoom, setZoom] = useState(h.zoom_url || ''); const [tz, setTz] = useState(h.timezone);
  const [hours, setHours] = useState(h.hours || {}); const [off, setOff] = useState(h.days_off || []); const [on, setOn] = useState(h.active);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await saveHost({ id: h.id, campaign: camp || null, zoom: zoom.trim(), timezone: tz, hours, daysOff: off, active: on }); onDone(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={h.name} onClose={onClose} footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <Toggle on={on} onChange={setOn} label="Taking calls" /><span>{on ? 'Taking calls' : 'Turned off: no new calls are booked with them'}</span>
      </div>
      <Field label="Campaign"><select className="v2-sel" value={camp} onChange={e => setCamp(e.target.value)}>
        {(campaigns.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Zoom link"><input className="v2-input" value={zoom} onChange={e => setZoom(e.target.value)} placeholder="https://zoom.us/j/…" autoCapitalize="none" /></Field>
      <Field label="Time zone"><TimezoneSelect value={tz} onChange={setTz} /></Field>
      <CalendarLink host={h.id} />
      <div className="v2-label" style={{ marginTop: 6 }}>Weekly hours</div>
      <HoursEditor hours={hours} onChange={setHours} />
      <div className="v2-label" style={{ marginTop: 10 }}>Days off</div>
      <DaysOff days={off} onChange={setOff} />
      <ErrorBox error={error} />
    </Modal>
  );
};

// ───────────── booking rules ─────────────
const RulesForm: React.FC<{ campaign: string }> = ({ campaign }) => {
  const rules = useLoad(() => getRules(campaign), [campaign]);
  const [r, setR] = useState<Rules | null>(null);
  useEffect(() => { if (rules.data) setR(rules.data); }, [rules.data]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  if (rules.loading && !r) return <Loading />;
  if (!r) return <ErrorBox error={rules.error} />;
  const num = (k: keyof Rules) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setSaved(false); setR({ ...r, [k]: e.target.value === '' ? null : Number(e.target.value) }); };
  const save = async () => {
    setBusy(true); setError(null);
    try { setR(await saveRules(r)); setSaved(true); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card>
      <div className="v2-cards-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        <Field label="Call length"><select className="v2-sel" value={r.length_min} onChange={num('length_min')}>
          {[30, 45, 60].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></Field>
        <Field label="Gap between a host’s calls"><select className="v2-sel" value={r.buffer_min} onChange={num('buffer_min')}>
          {[0, 5, 10, 15, 30].map(n => <option key={n} value={n}>{n ? `${n} minutes` : 'None'}</option>)}</select></Field>
        <Field label="Earliest booking" hint="How soon after the door a call can be"><select className="v2-sel" value={r.notice_min} onChange={num('notice_min')}>
          {[30, 60, 120, 240, 1440].map(n => <option key={n} value={n}>{n < 60 ? `${n} minutes` : n === 1440 ? 'Next day' : `${n / 60} hour${n > 60 ? 's' : ''}`} from now</option>)}</select></Field>
        <Field label="How far ahead"><select className="v2-sel" value={r.days_ahead} onChange={num('days_ahead')}>
          {[3, 7, 14, 21, 30].map(n => <option key={n} value={n}>{n} days</option>)}</select></Field>
        <Field label="Most calls per host per day" hint="Blank: no cap"><input className="v2-input" type="number" min={1} max={20} value={r.max_per_day ?? ''} onChange={num('max_per_day')} /></Field>
        <Field label="Time zone shown to reps and owners"><TimezoneSelect value={r.timezone} onChange={v => { setSaved(false); setR({ ...r, timezone: v }); }} /></Field>
      </div>
      <div className="v2-small v2-mut" style={{ margin: '4px 0 10px' }}>Calls start on the hour or half hour. Each call goes to the free host with the fewest calls in the last 30 days and ahead, so they’re shared out evenly.</div>
      <ErrorBox error={error} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</Btn>
        {saved && <span className="v2-small" style={{ color: '#15803d' }}>Saved.</span>}
      </div>
    </Card>
  );
};
