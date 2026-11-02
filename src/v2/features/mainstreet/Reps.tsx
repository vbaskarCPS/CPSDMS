// src/v2/features/mainstreet/Reps.tsx — MainstreetAI › Users: the two kinds of MainstreetAI user. Reps knock;
// hosts take the onboarding calls reps book from the deck. Either is added by name and email, then emailed a
// link to choose their password (the same setup flow managers use). A host's hours and Zoom are edited in
// Meetings › Hosts. (The server keeps the two apart: a rep can't also be a host.)
import React, { useState } from 'react';
import { CalendarClock, Mail, Pencil, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { sendSetupEmail, useLoad } from '../../lib/data';
import { createRep, listCampaigns, listReps, setRepCode, updateRep, type Rep } from '../../lib/mainstreet';
import { addHost, hostsList, hoursSummary, type HostRow } from '../../lib/meetings';
import { getGoals, repsToday, saveGoals } from '../../lib/rep';
import { Btn, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

type Kind = 'rep' | 'host';
type Editing = { kind: Kind; id: string | null; full_name: string; email: string; phone: string; is_active: boolean; code: string; oldCode: string; campaign: string; zoom: string } | null;

const when = (s: string | null) => s ? new Date(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';

export const Reps: React.FC = () => {
  const reps = useLoad(listReps, []);
  const hosts = useLoad(hostsList, []);
  const campaigns = useLoad(listCampaigns, []);
  const nav = useNavigate();
  const [editing, setEditing] = useState<Editing>(null);
  const blank = (kind: Kind): Editing => ({ kind, id: null, full_name: '', email: '', phone: '', is_active: true, code: '', oldCode: '',
    campaign: (campaigns.data || []).find(c => c.is_active)?.id || '', zoom: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      if (editing.kind === 'host') {
        const r = await addHost({ name: editing.full_name, email: editing.email, phone: editing.phone, campaign: editing.campaign, zoom: editing.zoom });
        if (r.new_account) {
          try { const x = await sendSetupEmail(r.id); setSent(`${editing.full_name.trim()} is a host. A setup email went to ${x.email}: they choose a password, then sign in at propertystars.app/app/host to see their calls and set their hours.`); }
          catch (e) { setSent(`${editing.full_name.trim()} is a host, but the setup email didn’t go: ${e instanceof Error ? e.message : String(e)}`); }
        } else setSent(`${editing.full_name.trim() || editing.email} already had an account and is now a host. They see their calls at propertystars.app/app/host.`);
      } else if (editing.id) {
        await updateRep(editing.id, editing);
        if (editing.code.trim() && editing.code.trim().toUpperCase() !== editing.oldCode) await setRepCode(editing.id, editing.code);
      } else {
        const made = await createRep(editing);
        try { await sendSetupEmail(made.id); setSent(`Setup email sent to ${editing.email}. They sign in with that email.`); }
        catch (e) { setSent(`${editing.full_name} was added but the setup email didn’t go: ${e instanceof Error ? e.message : String(e)}`); }
      }
      setEditing(null); reps.reload(); hosts.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const resend = async (r: Rep) => {
    setBusy(true); setError(null); setSent(null);
    try { const x = await sendSetupEmail(r.id); setSent(`Setup email sent to ${x.email}.`); reps.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const resendHost = async (h: HostRow) => {
    setBusy(true); setError(null); setSent(null);
    try { const x = await sendSetupEmail(h.id); setSent(`Setup email sent to ${x.email}.`); hosts.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const hostState = (h: HostRow) => {
    if (h.staff || h.setup_used_at) return <Tag tone="g">Signed in</Tag>;
    if (h.setup_sent_at) return <Tag tone="a">Link sent {when(h.setup_sent_at)}</Tag>;
    return <Tag>Not set up</Tag>;
  };
  const hostRows = hosts.data || [];
  const setupState = (r: Rep) => {
    if (!r.must_change_password || r.setup_used_at) return <Tag tone="g">Signed in</Tag>;
    if (r.setup_error) return <Tag tone="r">Email failed</Tag>;
    if (r.setup_sent_at) return <Tag tone="a">Link sent {when(r.setup_sent_at)}</Tag>;
    return <Tag>Not set up</Tag>;
  };

  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Users</span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setEditing(blank('rep'))}>Add a user</Btn>
      </div>
      <ErrorBox error={error || reps.error || hosts.error} />
      {sent && <div className="v2-card" style={{ marginBottom: 10, borderLeft: '4px solid var(--green)' }}>{sent}</div>}
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="v2-label" style={{ padding: '12px 14px 0' }}>Reps <span className="v2-mut">· knock doors and book onboarding calls</span></div>
        {reps.loading ? <Loading /> : !reps.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No reps yet. Add one and they’ll get an email to set up their account.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Rep</th><th>Rep code</th><th>Sign-in email</th><th>Zones</th><th>Account</th><th /></tr></thead>
            <tbody>
              {reps.data.map(r => (
                <tr key={r.id} style={r.is_active ? undefined : { opacity: 0.55 }}>
                  <td><b>{r.full_name}</b>{!r.is_active && <> <Tag>Off</Tag></>}</td>
                  <td><code>{r.rep_code || '—'}</code></td>
                  <td className="v2-small">{r.email || <span className="v2-mut">no email</span>}{r.phone && <div className="v2-mut">{r.phone}</div>}</td>
                  <td>{r.zones}</td>
                  <td>{setupState(r)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.is_active && r.must_change_password && r.email && <Btn kind="o" size="sm" icon={Mail} disabled={busy} onClick={() => resend(r)}>{r.setup_sent_at ? 'Resend' : 'Send setup'}</Btn>}{' '}
                    <Btn kind="o" size="sm" icon={Pencil} onClick={() => setEditing({ kind: 'rep', id: r.id, full_name: r.full_name, email: r.email || '', phone: r.phone || '', is_active: r.is_active, code: r.rep_code || '', oldCode: r.rep_code || '', campaign: '', zoom: '' })}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="v2-label" style={{ padding: '12px 14px 0' }}>Hosts <span className="v2-mut">· take the onboarding calls reps book</span></div>
        {hosts.loading && !hosts.data ? <Loading /> : !hostRows.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No hosts yet. Until there’s one with hours, reps can’t book onboarding calls from the deck.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Host</th><th>Campaign</th><th>Sign-in email</th><th>Hours</th><th>Account</th><th /></tr></thead>
            <tbody>
              {hostRows.map(h => (
                <tr key={h.id} style={h.active ? undefined : { opacity: 0.55 }}>
                  <td><b>{h.name}</b>{!h.active && <> <Tag>Off</Tag></>}{!h.zoom_url && <div><Tag tone="a">No Zoom link</Tag></div>}</td>
                  <td className="v2-small">{h.campaign || '—'}</td>
                  <td className="v2-small">{h.email || h.username}{h.phone && <div className="v2-mut">{h.phone}</div>}</td>
                  <td className="v2-small">{hoursSummary(h.hours)}<div className="v2-mut">{h.upcoming} coming up</div></td>
                  <td>{hostState(h)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!h.staff && !h.setup_used_at && h.email && <Btn kind="o" size="sm" icon={Mail} disabled={busy} onClick={() => resendHost(h)}>{h.setup_sent_at ? 'Resend' : 'Send setup'}</Btn>}{' '}
                    <Btn kind="o" size="sm" icon={CalendarClock} onClick={() => nav('/app/mainstreet/meetings?view=hosts')}>Hours & Zoom</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>Reps sign in at propertystars.app/mainstreet; hosts at propertystars.app/app/host. Both use their email and the password they choose from the setup email. Reps only see the zones they’re assigned. A rep can’t also be a host.</div>

      {editing && (
        <Modal title={editing.id ? 'Edit rep' : 'Add a user'} onClose={() => setEditing(null)}
          footer={<><Btn kind="o" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn disabled={busy || !editing.full_name.trim() || (!editing.id && !/^\S+@\S+\.\S+$/.test(editing.email)) || (editing.kind === 'host' && !editing.campaign)} onClick={save}>{busy ? 'Saving…' : editing.id ? 'Save' : 'Add and send setup email'}</Btn></>}>
          {!editing.id && <Field label="Type of user">
            <div role="group" aria-label="Type of user" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([['rep', 'Rep', 'Knocks doors, books onboarding calls'], ['host', 'Host', 'Takes the onboarding calls']] as const).map(([k, l, d]) => {
                const on = editing.kind === k;
                return <button key={k} type="button" aria-pressed={on} onClick={() => setEditing({ ...editing, kind: k })}
                  style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', font: 'inherit',
                    border: `2px solid ${on ? 'var(--blue, #2563eb)' : 'var(--line, #e5e7eb)'}`, background: on ? 'rgba(37,99,235,.08)' : 'transparent', color: 'inherit' }}>
                  <b>{l}</b><span className="v2-small v2-mut" style={{ display: 'block' }}>{d}</span></button>;
              })}
            </div></Field>}
          <Field label="Full name"><input className="v2-input" autoFocus value={editing.full_name} onChange={e => setEditing({ ...editing, full_name: e.target.value })} /></Field>
          <Field label="Email" hint={editing.id ? 'They sign in with this email.' : 'They sign in with this email, and get a link here to choose their password.'}>
            <input className="v2-input" type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></Field>
          <Field label="Phone (optional)"><input className="v2-input" type="tel" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></Field>
          {editing.kind === 'host' && <>
            {(campaigns.data || []).filter(c => c.is_active).length > 1 && <Field label="Campaign" hint="The campaign they take calls for.">
              <select className="v2-sel" value={editing.campaign} onChange={e => setEditing({ ...editing, campaign: e.target.value })}>
                {(campaigns.data || []).filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="Zoom link (they can add it later)"><input className="v2-input" value={editing.zoom} onChange={e => setEditing({ ...editing, zoom: e.target.value })} placeholder="https://zoom.us/j/…" autoCapitalize="none" /></Field>
            <div className="v2-small v2-mut">They start with Monday to Friday, 9 to 5 (Toronto time); they or you change it in Meetings › Hosts.</div>
          </>}
          {editing.id && <Field label="Rep code" hint="On their send-info links (?ref=CODE), so sign-ups are credited to them. 2 to 12 letters or numbers.">
            <input className="v2-input" value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={12} /></Field>}
          {editing.id && <div className="v2-row" style={{ marginTop: 6 }}><Toggle on={editing.is_active} onChange={v => setEditing({ ...editing, is_active: v })} label="Active" /><span>{editing.is_active ? 'Active' : 'Off: can’t sign in'}</span></div>}
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
};

// ───────────── the dashboard: who's out today, and the daily goals ─────────────
export const Dashboard: React.FC = () => {
  const [tick, setTick] = useState(0);
  const today = useLoad(() => repsToday(), [tick]);
  const goals = useLoad(() => getGoals(), []);
  const [g, setG] = useState<{ v: string; d: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  React.useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 120000); return () => clearInterval(t); }, []);
  const list = today.data || [];
  const out = list.filter(r => r.started_at && !r.ended_at);
  const saveGoals_ = async () => {
    if (!g) return;
    setBusy(true); setError(null);
    try { await saveGoals(Number(g.v), Number(g.d)); setG(null); goals.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const ago = (s: string | null) => { if (!s) return ''; const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; };
  const hm = (s: string | null) => (s ? new Date(s).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head"><span className="v2-h1">Dashboard</span><span className="v2-spacer" /><Btn kind="o" size="sm" onClick={() => setTick(x => x + 1)}>Refresh</Btn></div>
      <ErrorBox error={error || today.error} />
      <div className="v2-row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="v2-card" style={{ flex: 1, minWidth: 140 }}><div className="v2-note">Out now</div><div style={{ fontSize: 26, fontWeight: 800 }}>{out.length}</div></div>
        <div className="v2-card" style={{ flex: 1, minWidth: 140 }}><div className="v2-note">Visits today</div><div style={{ fontSize: 26, fontWeight: 800 }}>{list.reduce((a, r) => a + r.visits, 0)}</div></div>
        <div className="v2-card" style={{ flex: 1, minWidth: 140 }}><div className="v2-note">Deals today</div><div style={{ fontSize: 26, fontWeight: 800 }}>{list.reduce((a, r) => a + r.deals, 0)}</div></div>
        <div className="v2-card" style={{ flex: 1, minWidth: 180 }}>
          <div className="v2-note">Daily goal per rep (a rep can set their own visits goal)</div>
          {g ? (
            <div className="v2-row" style={{ gap: 6, marginTop: 4 }}>
              <input className="v2-input" style={{ width: 64 }} inputMode="numeric" value={g.v} onChange={e => setG({ ...g, v: e.target.value.replace(/\D/g, '') })} aria-label="Visits a day" />visits
              <input className="v2-input" style={{ width: 52 }} inputMode="numeric" value={g.d} onChange={e => setG({ ...g, d: e.target.value.replace(/\D/g, '') })} aria-label="Onboardings a day" />onboardings
              <Btn size="sm" disabled={busy || !g.v} onClick={saveGoals_}>Save</Btn>
            </div>
          ) : (
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 4 }}>{goals.data ? `${goals.data.visits_per_day} visits · ${goals.data.deals_per_day} onboardings` : '…'}
              {goals.data && <> <Btn kind="o" size="sm" icon={Pencil} onClick={() => setG({ v: String(goals.data!.visits_per_day), d: String(goals.data!.deals_per_day) })}>Edit</Btn></>}</div>)}
        </div>
      </div>
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {today.loading && !today.data ? <Loading /> : !list.length ? <div className="v2-note" style={{ padding: 16 }}>No reps yet.</div> : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Rep</th><th>Today</th><th>Visits</th><th>Deals</th><th>Walked</th><th>Last seen</th></tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.rep_id}>
                <td><b>{r.name}</b><div className="v2-small v2-mut">{r.zones} zone{r.zones === 1 ? '' : 's'}</div></td>
                <td>{!r.started_at ? <Tag>Not started</Tag> : r.ended_at ? <Tag tone="b">Done {hm(r.started_at)}–{hm(r.ended_at)}</Tag> : <Tag tone="g">Out since {hm(r.started_at)}</Tag>}</td>
                <td>{r.visits}</td><td>{r.deals}</td>
                <td>{r.distance_m ? (r.distance_m < 1000 ? `${r.distance_m} m` : `${(r.distance_m / 1000).toFixed(1)} km`) : '—'}</td>
                <td className="v2-small">{r.last_at ? <>{ago(r.last_at)}{r.lat != null && <> · <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">map</a></>}</> : '—'}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>A rep starts and ends their day in the app. While it’s on, their phone sends its location every couple of minutes (for distance walked and last seen).</div>
    </div>
  );
};
