// src/v2/features/admin/Users.tsx — Super Admin › User Management › Users.
import React, { useMemo, useState } from 'react';
import { Plus, Search, KeyRound, Mail } from 'lucide-react';
import { useAuth, type Center } from '../../lib/auth';
import { PERMISSIONS, SUPER_ADMIN_PERMISSIONS, usernameBase, type Permission } from '../../lib/permissions';
import { listUsers, listCenters, createUser, updateUser, resetPassword, sendSetupEmail, setupStatus, useLoad, type SetupStatus, type UserRow, type UserInput } from '../../lib/data';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

const blank = (): UserInput => ({ full_name: '', phone: '', email: '', permissions: [], center_ids: [], rm_center_id: null, is_active: true });

export const Users: React.FC = () => {
  const { profile } = useAuth();
  const users = useLoad(listUsers, []);
  const centers = useLoad(listCenters, []);
  const setups = useLoad(setupStatus, []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => (users.data || []).filter(u =>
    !q || `${u.full_name} ${u.username} ${u.phone || ''}`.toLowerCase().includes(q.toLowerCase())), [users.data, q]);
  const centerName = (id: string) => centers.data?.find(c => c.id === id)?.display_name || '—';

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Users</span>
        <span className="v2-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /><input aria-label="Search users" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or username"
            style={{ border: 0, background: 'transparent', outline: 'none', width: 170 }} /></span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setEditing('new')}>New user</Btn>
      </div>
      {notice && <div className="v2-ok" style={{ marginBottom: 12 }}>{notice}</div>}
      <ErrorBox error={users.error || centers.error} />
      {users.loading ? <Loading /> : (
        <Card style={{ padding: '4px 10px' }}>
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Name</th><th>Username</th><th>Centers</th><th>RM center</th>
              {PERMISSIONS.map(p => <th key={p.key} title={p.unlocks}>{p.label.replace('SA · ', 'SA ').replace('Master ', '').replace('Clients & ', '').replace(' & Client Data', '')}</th>)}
              <th>Status</th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} className="click" onClick={() => setEditing(u)}>
                  <td><b>{u.full_name}</b>{u.is_super_admin && <> <Tag tone="r">Super Admin</Tag></>}</td>
                  <td><code>{u.username}</code></td>
                  <td>{u.is_super_admin ? 'All' : u.center_ids.map(centerName).join(', ') || '—'}</td>
                  <td>{u.rm_center_id ? centerName(u.rm_center_id) : '—'}</td>
                  {PERMISSIONS.map(p => <td key={p.key} style={{ textAlign: 'center' }}>{(u.is_super_admin || u.permissions.includes(p.key)) ? '✓' : ''}</td>)}
                  <td>{u.is_active ? <Tag tone="g">Active</Tag> : <Tag>Disabled</Tag>}{u.must_change_password && u.is_active && <> <SetupTag s={setups.data?.get(u.id)} /></>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5 + PERMISSIONS.length} className="v2-mut">No users{q ? ' match' : ' yet'}.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {editing && centers.data && (
        <UserEditor user={editing === 'new' ? null : editing} centers={centers.data} isSuperAdmin={!!profile?.is_super_admin}
          setup={editing === 'new' ? undefined : setups.data?.get(editing.id)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); users.reload(); setups.reload(); }} />
      )}
    </div>
  );
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

/** Where a new user is with setting up their account. */
const SetupTag: React.FC<{ s?: SetupStatus }> = ({ s }) => {
  if (!s || s.used_at) return <Tag tone="a">New password pending</Tag>;
  if (s.send_error) return <span title={s.send_error}><Tag tone="r">Setup email failed</Tag></span>;
  if (new Date(s.expires_at) < new Date()) return <Tag tone="r">Setup link expired</Tag>;
  return s.sent_at ? <span title={`Sent to ${s.email}; the link works until ${day(s.expires_at)}`}><Tag tone="b">Setup emailed {day(s.sent_at)}</Tag></span> : <Tag tone="a">New password pending</Tag>;
};

const UserEditor: React.FC<{ user: UserRow | null; centers: Center[]; isSuperAdmin: boolean; setup?: SetupStatus; onClose: () => void; onSaved: (msg: string) => void }> =
  ({ user, centers, isSuperAdmin, setup, onClose, onSaved }) => {
    const [form, setForm] = useState<UserInput>(() => user ? {
      full_name: user.full_name, phone: user.phone || '', email: user.email || '', permissions: user.permissions,
      center_ids: user.center_ids, rm_center_id: user.rm_center_id, is_active: user.is_active,
    } : blank());
    const [password, setPassword] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const [showReset, setShowReset] = useState(false);
    const [emailSetup, setEmailSetup] = useState(true);
    const locked = !!user?.is_super_admin && !isSuperAdmin;
    const hasEmail = /\S+@\S+\.\S+/.test(form.email.trim());
    const sendLink = !user && hasEmail && emailSetup;

    const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setForm(f => ({ ...f, [k]: v }));
    const togglePerm = (p: Permission) => set('permissions', form.permissions.includes(p) ? form.permissions.filter(x => x !== p) : [...form.permissions, p]);
    const toggleCenter = (id: string) => {
      const next = form.center_ids.includes(id) ? form.center_ids.filter(x => x !== id) : [...form.center_ids, id];
      setForm(f => ({ ...f, center_ids: next, rm_center_id: f.rm_center_id && next.includes(f.rm_center_id) ? f.rm_center_id : null }));
    };

    const save = async () => {
      setError(null);
      if (form.full_name.trim().replace(/[^a-z]/gi, '').length < 2) { setError('Enter the person’s name'); return; }
      if (!user && !sendLink && password.length < 8) { setError(hasEmail ? 'Starting password needs at least 8 characters' : 'Add their email to send an account setup link, or give them a starting password'); return; }
      setBusy(true);
      try {
        if (user) { await updateUser(user.id, form); onSaved(`Saved ${form.full_name}.`); }
        else {
          const r = await createUser(form, sendLink ? null : password);
          if (!sendLink) { onSaved(`Created ${form.full_name} — username ${r.username}. They’ll choose their own password at first sign-in.`); return; }
          try {
            const sent = await sendSetupEmail(r.id);
            onSaved(`Created ${form.full_name} — username ${r.username}. An account setup link went to ${sent.email}; it works for 7 days.`);
          } catch (e) {
            onSaved(`Created ${form.full_name} — username ${r.username}, but the setup email didn’t send (${e instanceof Error ? e.message : String(e)}). Open them and press Send setup email to try again.`);
          }
        }
      } catch (e) { setError(e); } finally { setBusy(false); }
    };

    const doSendSetup = async () => {
      if (!user) return;
      setError(null); setBusy(true);
      try {
        if (form.email.trim() !== (user.email || '')) await updateUser(user.id, form);   // the email just typed is the one it goes to
        const sent = await sendSetupEmail(user.id);
        onSaved(`Account setup link sent to ${sent.email} for ${user.username}. It works once, for 7 days; any earlier link stops working.`);
      } catch (e) { setError(e); } finally { setBusy(false); }
    };

    const doReset = async () => {
      if (!user) return;
      setError(null);
      if (password.length < 8) { setError('Temporary password needs at least 8 characters'); return; }
      setBusy(true);
      try { await resetPassword(user.id, password); onSaved(`Password reset for ${user.username}. They’ll choose a new one at next sign-in.`); }
      catch (e) { setError(e); } finally { setBusy(false); }
    };

    return (
      <Modal title={user ? `${user.full_name} · ${user.username}` : 'New user'} onClose={onClose} wide
        footer={<>
          {user && !locked && <Btn kind="o" icon={KeyRound} onClick={() => setShowReset(s => !s)}>Reset password</Btn>}
          {user && !locked && user.is_active && hasEmail && <Btn kind="o" icon={Mail} disabled={busy} onClick={doSendSetup}
            title="Email them a link to choose their own password">{setup && !setup.used_at ? 'Resend setup email' : 'Send setup email'}</Btn>}
          <span className="v2-spacer" />
          <Btn kind="o" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} disabled={busy || locked}>{busy ? 'Saving…' : user ? 'Save' : 'Create user'}</Btn>
        </>}>
        {locked && <div className="v2-err" style={{ marginBottom: 12 }}>Only the Super Admin can change this account.</div>}
        <div className="v2-grid2">
          <div>
            <Field label="Full name" hint={!user && form.full_name.trim() ? `Username will be ${usernameBase(form.full_name)} (a number is added if taken)` : undefined}>
              <input className="v2-input" value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="First Last" />
            </Field>
            <Field label="Phone"><input className="v2-input" value={form.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" /></Field>
            <Field label="Email"><input className="v2-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></Field>
            {!user && hasEmail && <label className="v2-check" style={{ border: 0 }}>
              <input type="checkbox" checked={emailSetup} onChange={e => setEmailSetup(e.target.checked)} />
              <span><b style={{ fontWeight: 600 }}>Email them an account setup link</b><br /><span className="v2-mut v2-small">They choose their own password from the email. The link works once, for 7 days.</span></span>
            </label>}
            {!user && !sendLink && <Field label="Starting password" hint={hasEmail ? 'They must change it at first sign-in.' : 'They must change it at first sign-in. Add an email to send a setup link instead.'}>
              <input className="v2-input" type="text" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" /></Field>}
            {user && setup && !setup.used_at && <div className="v2-note" style={{ marginTop: 0 }}>{setup.send_error
              ? <>The last setup email to {setup.email} didn’t send: {setup.send_error}</>
              : setup.sent_at ? <>Setup link emailed to {setup.email} on {day(setup.sent_at)}; it works until {day(setup.expires_at)}.</> : null}</div>}
            {user && showReset && <div className="v2-card" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <Field label="Temporary password"><input className="v2-input" type="text" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" /></Field>
              <Btn size="sm" onClick={doReset} disabled={busy}>Set temporary password</Btn></div>}
            {user && <div className="v2-check" style={{ border: 0 }}><Toggle on={form.is_active} onChange={v => set('is_active', v)} label="Active" /><span>{form.is_active ? 'Active — can sign in' : 'Disabled — cannot sign in'}</span></div>}
          </div>
          <div>
            <div className="v2-label">Permissions</div>
            {user?.is_super_admin ? <div className="v2-note">Super Admin has every permission.</div> : PERMISSIONS.map(p => {
              const saOnly = SUPER_ADMIN_PERMISSIONS.includes(p.key as Permission) && !isSuperAdmin;
              return (
                <label key={p.key} className="v2-check" title={p.unlocks} style={saOnly ? { opacity: .5 } : undefined}>
                  <input type="checkbox" checked={form.permissions.includes(p.key)} disabled={saOnly} onChange={() => togglePerm(p.key)} />
                  <span><b style={{ fontWeight: 600 }}>{p.label}</b><br /><span className="v2-mut v2-small">{p.unlocks}</span></span>
                </label>
              );
            })}
            <div className="v2-label" style={{ marginTop: 14 }}>Command centers</div>
            {user?.is_super_admin ? <div className="v2-note">Super Admin sees every center.</div> : centers.filter(c => c.is_active || form.center_ids.includes(c.id)).map(c => (
              <label key={c.id} className="v2-check"><input type="checkbox" checked={form.center_ids.includes(c.id)} onChange={() => toggleCenter(c.id)} />{c.display_name}</label>
            ))}
            {form.permissions.includes('route_manager') && !user?.is_super_admin && (
              <Field label="Route Manager center (one at a time)">
                <select className="v2-sel" value={form.rm_center_id || ''} onChange={e => set('rm_center_id', e.target.value || null)}>
                  <option value="">— none —</option>
                  {centers.filter(c => form.center_ids.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                </select>
              </Field>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12 }}><ErrorBox error={error} /></div>
      </Modal>
    );
  };
