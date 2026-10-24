// src/v2/features/mainstreet/Reps.tsx — MainstreetAI › Reps: the people who knock. A rep is added by name
// and email, then emailed a link to choose their password (the same setup flow managers use).
import React, { useState } from 'react';
import { Mail, Pencil, Plus } from 'lucide-react';
import { sendSetupEmail, useLoad } from '../../lib/data';
import { createRep, listReps, updateRep, type Rep } from '../../lib/mainstreet';
import { Btn, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

type Editing = { id: string | null; full_name: string; email: string; phone: string; is_active: boolean } | null;

const when = (s: string | null) => s ? new Date(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';

export const Reps: React.FC = () => {
  const reps = useLoad(listReps, []);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      if (editing.id) await updateRep(editing.id, editing);
      else {
        const made = await createRep(editing);
        try { await sendSetupEmail(made.id); setSent(`Setup email sent to ${editing.email}. Their username is ${made.username}.`); }
        catch (e) { setSent(`${editing.full_name} was added (username ${made.username}) but the setup email didn’t go: ${e instanceof Error ? e.message : String(e)}`); }
      }
      setEditing(null); reps.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const resend = async (r: Rep) => {
    setBusy(true); setError(null); setSent(null);
    try { const x = await sendSetupEmail(r.id); setSent(`Setup email sent to ${x.email}.`); reps.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const setupState = (r: Rep) => {
    if (!r.must_change_password || r.setup_used_at) return <Tag tone="g">Signed in</Tag>;
    if (r.setup_error) return <Tag tone="r">Email failed</Tag>;
    if (r.setup_sent_at) return <Tag tone="a">Link sent {when(r.setup_sent_at)}</Tag>;
    return <Tag>Not set up</Tag>;
  };

  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Reps</span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setEditing({ id: null, full_name: '', email: '', phone: '', is_active: true })}>Add a rep</Btn>
      </div>
      <ErrorBox error={error || reps.error} />
      {sent && <div className="v2-card" style={{ marginBottom: 10, borderLeft: '4px solid var(--green)' }}>{sent}</div>}
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {reps.loading ? <Loading /> : !reps.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No reps yet. Add one and they’ll get an email to set up their account.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Rep</th><th>Username</th><th>Contact</th><th>Zones</th><th>Account</th><th /></tr></thead>
            <tbody>
              {reps.data.map(r => (
                <tr key={r.id} style={r.is_active ? undefined : { opacity: 0.55 }}>
                  <td><b>{r.full_name}</b>{!r.is_active && <> <Tag>Off</Tag></>}</td>
                  <td><code>{r.username}</code></td>
                  <td className="v2-small">{r.email || <span className="v2-mut">no email</span>}{r.phone && <div className="v2-mut">{r.phone}</div>}</td>
                  <td>{r.zones}</td>
                  <td>{setupState(r)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.is_active && r.must_change_password && r.email && <Btn kind="o" size="sm" icon={Mail} disabled={busy} onClick={() => resend(r)}>{r.setup_sent_at ? 'Resend' : 'Send setup'}</Btn>}{' '}
                    <Btn kind="o" size="sm" icon={Pencil} onClick={() => setEditing({ id: r.id, full_name: r.full_name, email: r.email || '', phone: r.phone || '', is_active: r.is_active })}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>Reps sign in at the same login page with their username and the password they choose from the email. They only see the zones they’re assigned.</div>

      {editing && (
        <Modal title={editing.id ? 'Edit rep' : 'Add a rep'} onClose={() => setEditing(null)}
          footer={<><Btn kind="o" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn disabled={busy || !editing.full_name.trim() || (!editing.id && !/^\S+@\S+\.\S+$/.test(editing.email))} onClick={save}>{busy ? 'Saving…' : editing.id ? 'Save' : 'Add and send setup email'}</Btn></>}>
          <Field label="Full name"><input className="v2-input" autoFocus value={editing.full_name} onChange={e => setEditing({ ...editing, full_name: e.target.value })} /></Field>
          <Field label="Email" hint={editing.id ? undefined : 'They’ll get a link here to choose their password.'}>
            <input className="v2-input" type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></Field>
          <Field label="Phone (optional)"><input className="v2-input" type="tel" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></Field>
          {editing.id && <div className="v2-row" style={{ marginTop: 6 }}><Toggle on={editing.is_active} onChange={v => setEditing({ ...editing, is_active: v })} label="Active" /><span>{editing.is_active ? 'Active' : 'Off: can’t sign in'}</span></div>}
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
};

export const Dashboard: React.FC = () => (
  <div className="v2-main v2-narrow v2-ms">
    <div className="v2-head"><span className="v2-h1">Dashboard</span></div>
    <div className="v2-card" style={{ textAlign: 'center', padding: 40 }}>
      <div className="v2-h2">Nothing to show yet</div>
      <div className="v2-note">Walk-ins, owners reached and the pipeline will land here once reps start logging in the field.</div>
    </div>
  </div>
);
