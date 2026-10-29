// src/v2/features/admin/Mailboxes.tsx — Super Admin › Users › Mailboxes: everyone's firstname@propertystars.app,
// rename one (the old address keeps working), and hand one over when someone leaves. Also a centre's shared
// mailboxes (CenterMail, on Centers) and a person's access to them (UserMailboxes, on a user). Admins never read mail:
// only addresses and how many conversations are listed.
import React, { useState } from 'react';
import { ArrowRightLeft, AtSign, Pencil } from 'lucide-react';
import { adminBoxes, adminHandover, adminRename, centerBoxes, setBoxMember, setCenterBox, userBoxes, type AdminBox, type CenterBox, type UserBox } from '../../lib/mail';
import { useLoad, type UserRow } from '../../lib/data';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

export const Mailboxes: React.FC<{ users: UserRow[] }> = ({ users }) => {
  const boxes = useLoad(adminBoxes, []);
  const [renaming, setRenaming] = useState<AdminBox | null>(null);
  const [handing, setHanding] = useState<AdminBox | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (msg: string) => { setRenaming(null); setHanding(null); setNotice(msg); boxes.reload(); };
  const live = (boxes.data || []).filter(b => b.active);
  const needs = live.filter(b => b.owner_id && !b.owner_active);

  return (
    <Card style={{ marginTop: 16, padding: '4px 10px 10px' }} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AtSign size={16} />Mailboxes</span>}
      right={<span className="v2-note">Private: only the owner can read a mailbox.</span>}>
      {notice && <div className="v2-ok" style={{ margin: '6px 0 10px' }}>{notice}</div>}
      {needs.length > 0 && <div className="v2-err" style={{ margin: '6px 0 10px' }}>
        {needs.map(b => b.owner).join(', ')} {needs.length === 1 ? 'is' : 'are'} disabled but still {needs.length === 1 ? 'has a mailbox' : 'have mailboxes'}. Hand {needs.length === 1 ? 'it' : 'them'} over so mail keeps reaching someone.</div>}
      <ErrorBox error={boxes.error} />
      {boxes.loading && !boxes.data ? <Loading /> : (
        <div className="v2-table-wrap"><table className="v2-table">
          <thead><tr><th>Address</th><th>Owner</th><th>Also receives</th><th style={{ textAlign: 'right' }}>Conversations</th><th /></tr></thead>
          <tbody>
            {live.map(b => (
              <tr key={b.id}>
                <td><b>{b.address}</b>{b.label && <div className="v2-mut v2-small">{b.label}</div>}</td>
                <td>{b.owner || (b.members?.length ? b.members.map(m => m.name).join(', ') : '—')}{b.owner_id && !b.owner_active && <> <Tag tone="r">Disabled</Tag></>}</td>
                <td className="v2-mut">{b.aliases.length ? b.aliases.join(', ') : '—'}</td>
                <td style={{ textAlign: 'right' }}>{b.conversations}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Btn size="sm" kind="o" icon={Pencil} onClick={() => setRenaming(b)}>Rename</Btn>{' '}
                  {!b.role && <Btn size="sm" kind="o" icon={ArrowRightLeft} onClick={() => setHanding(b)}>Hand over</Btn>}
                </td>
              </tr>))}
            {!live.length && <tr><td colSpan={5} className="v2-mut">No mailboxes yet.</td></tr>}
          </tbody>
        </table></div>)}
      {renaming && <Rename box={renaming} onClose={() => setRenaming(null)} onDone={done} />}
      {handing && <Handover box={handing} users={users} onClose={() => setHanding(null)} onDone={done} />}
    </Card>
  );
};

const Rename: React.FC<{ box: AdminBox; onClose: () => void; onDone: (m: string) => void }> = ({ box, onClose, onDone }) => {
  const [local, setLocal] = useState(box.local);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await adminRename(box.id, local); onDone(`${box.address} is now ${local.trim().toLowerCase()}@propertystars.app. Mail to the old address still arrives.`); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Rename ${box.address}`} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || !local.trim() || local.trim().toLowerCase() === box.local}>{busy ? 'Saving…' : 'Rename'}</Btn></>}>
      <Field label="New address" hint="Letters, numbers, dots or dashes. The old address keeps delivering to this mailbox.">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input className="v2-input" value={local} onChange={e => setLocal(e.target.value.replace(/@.*$/, ''))} autoFocus style={{ flex: 1 }} />
          <span className="v2-mut">@propertystars.app</span></span>
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
};

const Handover: React.FC<{ box: AdminBox; users: UserRow[]; onClose: () => void; onDone: (m: string) => void }> = ({ box, users, onClose, onDone }) => {
  const people = users.filter(u => u.is_active && u.id !== box.owner_id && !(u.permissions.length === 1 && u.permissions[0] === 'mainstreet_rep'))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'merge' | 'move'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const who = people.find(p => p.id === to)?.full_name;
  const go = async () => {
    setBusy(true); setError(null);
    try {
      await adminHandover(box.id, to, mode);
      onDone(mode === 'merge' ? `${box.address}’s conversations are now in ${who}’s inbox, and mail to ${box.address} reaches them.`
        : `${box.address} now belongs to ${who}. It shows as a second mailbox in their Email.`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Hand over ${box.address}`} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn onClick={go} disabled={busy || !to}>{busy ? 'Handing over…' : 'Hand over'}</Btn></>}>
      <Field label="To">
        <select className="v2-input" value={to} onChange={e => setTo(e.target.value)} autoFocus>
          <option value="">Pick a person…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <label className="v2-choice" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} style={{ marginTop: 3 }} />
          <span><b>Merge into their inbox</b><br /><span className="v2-mut">The conversations join their mailbox, and mail to {box.address} goes to them from now on. Best when someone leaves.</span></span>
        </label>
        <label className="v2-choice" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="radio" name="mode" checked={mode === 'move'} onChange={() => setMode('move')} style={{ marginTop: 3 }} />
          <span><b>Give them the whole mailbox</b><br /><span className="v2-mut">{box.address} stays separate and shows as a second mailbox in their Email.</span></span>
        </label>
      </div>
      <p className="v2-note" style={{ marginTop: 12 }}>Nothing is deleted. You won’t see any of the mail.</p>
      <ErrorBox error={error} />
    </Modal>
  );
};

// ───────────── a centre's shared mailboxes (RUN_69) ─────────────
// Centers › a centre › Email: the client mailbox (receipts and booking emails go out from it, and customers'
// replies land in it) and the staff one, and who works each. People are also added from Users › a person.
export const CenterMail: React.FC<{ center: { id: string; display_name: string }; users: UserRow[] }> = ({ center, users }) => {
  const boxes = useLoad(() => centerBoxes(center.id), [center.id]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const roles: { role: 'client' | 'staff'; name: string; hint: string; eg: string }[] = [
    { role: 'client', name: 'Customers', hint: 'Receipts and booking emails go out from here; customers’ replies come back here.', eg: `${slug(center.display_name)}clients` },
    { role: 'staff', name: 'Staff', hint: 'For crews and staff of this centre.', eg: `${slug(center.display_name)}staff` },
  ];
  const member = async (box: string, user: string, on: boolean) => {
    setError(null);
    try { await setBoxMember(box, user, on); boxes.reload(); } catch (e) { setError(e); }
  };
  return (
    <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AtSign size={16} />Email</span>}>
      {notice && <div className="v2-ok" style={{ marginBottom: 8 }}>{notice}</div>}
      <ErrorBox error={boxes.error || error} />
      {boxes.loading && !boxes.data ? <Loading /> : roles.map(r => {
        const b = boxes.data?.[r.role];
        const people = users.filter(u => u.is_active && !b?.members.some(m => m.id === u.id) && !(u.permissions.length === 1 && u.permissions[0] === 'mainstreet_rep'))
          .sort((x, y) => x.full_name.localeCompare(y.full_name));
        return (
          <div key={r.role} style={{ padding: '8px 0', borderTop: r.role === 'staff' ? '1px solid var(--v2-line, #e5e7eb)' : undefined }}>
            <SlugRow center={center} role={r.role} name={r.name} hint={r.hint} eg={r.eg} box={b}
              onSaved={m => { setNotice(m); boxes.reload(); }} />
            {b && <div style={{ marginTop: 6 }}>
              <div className="v2-label" style={{ marginBottom: 4 }}>Who works it</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {b.members.map(m => <span key={m.id} className="v2-tag" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{m.name}
                  <button type="button" className="v2-link" onClick={() => member(b.id, m.id, false)} aria-label={`Take ${m.name} off`} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}>×</button></span>)}
                {!b.members.length && <span className="v2-mut">Nobody yet.</span>}
                <select className="v2-sel" style={{ width: 'auto' }} value={adding[r.role] || ''}
                  onChange={e => { const v = e.target.value; setAdding(a => ({ ...a, [r.role]: '' })); if (v) member(b.id, v, true); }}>
                  <option value="">Add a person…</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
            </div>}
          </div>);
      })}
      <p className="v2-note">Members see it as another mailbox in their Email and can send from it. It sends as “Property Stars · {center.display_name}”.</p>
    </Card>
  );
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

const SlugRow: React.FC<{ center: { id: string }; role: 'client' | 'staff'; name: string; hint: string; eg: string; box?: CenterBox; onSaved: (m: string) => void }> =
  ({ center, role, name, hint, eg, box, onSaved }) => {
    const [editing, setEditing] = useState(false);
    const [local, setLocal] = useState(box?.address.split('@')[0] || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const save = async () => {
      setBusy(true); setError(null);
      try {
        const r = await setCenterBox(center.id, role, local);
        setEditing(false);
        onSaved(box ? `${box.address} is now ${r.address}. Mail to the old address still arrives.` : `${r.address} is set up. Add the people who work it.`);
      } catch (e) { setError(e); } finally { setBusy(false); }
    };
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>{name}</b>
          {box && !editing && <><span>{box.address}</span><Btn size="sm" kind="o" icon={Pencil} onClick={() => { setLocal(box.address.split('@')[0]); setEditing(true); }}>Rename</Btn></>}
          {!box && !editing && <Btn size="sm" onClick={() => { setLocal(eg); setEditing(true); }}>Set up</Btn>}
        </div>
        <div className="v2-mut v2-small">{hint}</div>
        {editing && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <input className="v2-input" style={{ flex: '1 1 160px', maxWidth: 260 }} value={local} autoFocus onChange={e => setLocal(e.target.value.replace(/@.*$/, '').toLowerCase())} />
          <span className="v2-mut">@propertystars.app</span>
          <Btn size="sm" onClick={save} disabled={busy || !local.trim()}>{busy ? 'Saving…' : 'Save'}</Btn>
          <Btn size="sm" kind="o" onClick={() => setEditing(false)}>Cancel</Btn>
        </div>}
        <ErrorBox error={error} />
      </div>
    );
  };

/** Users › a person: the centres' shared mailboxes they work (on or off straight away). */
export const UserMailboxes: React.FC<{ userId: string }> = ({ userId }) => {
  const boxes = useLoad(() => userBoxes(userId), [userId]);
  const [error, setError] = useState<unknown>(null);
  const flip = async (b: UserBox) => {
    setError(null);
    try { await setBoxMember(b.id, userId, !b.on); boxes.reload(); } catch (e) { setError(e); }
  };
  if (!boxes.data?.length && !boxes.error) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="v2-label">Shared mailboxes</div>
      <ErrorBox error={boxes.error || error} />
      {(boxes.data || []).map(b => (
        <label key={b.id} className="v2-check">
          <input type="checkbox" checked={b.on} onChange={() => flip(b)} />
          <span><b style={{ fontWeight: 600 }}>{b.label || b.address}</b><br /><span className="v2-mut v2-small">{b.address}{b.role ? ` · ${b.role === 'client' ? 'customers' : 'staff'}` : ''}</span></span>
        </label>))}
      <div className="v2-note">Changes here save straight away.</div>
    </div>
  );
};
