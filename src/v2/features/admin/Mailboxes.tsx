// src/v2/features/admin/Mailboxes.tsx — Super Admin › Users › Mailboxes: everyone's firstname@propertystars.app,
// rename one (the old address keeps working), and hand one over when someone leaves. Admins never read mail:
// only addresses and how many conversations are listed.
import React, { useState } from 'react';
import { ArrowRightLeft, AtSign, Pencil } from 'lucide-react';
import { adminBoxes, adminHandover, adminRename, type AdminBox } from '../../lib/mail';
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
                <td><b>{b.address}</b></td>
                <td>{b.owner || '—'}{b.owner_id && !b.owner_active && <> <Tag tone="r">Disabled</Tag></>}</td>
                <td className="v2-mut">{b.aliases.length ? b.aliases.join(', ') : '—'}</td>
                <td style={{ textAlign: 'right' }}>{b.conversations}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Btn size="sm" kind="o" icon={Pencil} onClick={() => setRenaming(b)}>Rename</Btn>{' '}
                  <Btn size="sm" kind="o" icon={ArrowRightLeft} onClick={() => setHanding(b)}>Hand over</Btn>
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
