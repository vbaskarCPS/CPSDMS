// src/v2/features/account/MyAccount.tsx — a manager's own settings: phone, email and password.
// Name, username, center and permissions are set by a Super Admin (Users), so they're shown, not edited.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, UserRound } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { updateMyContact } from '../../lib/data';
import { PERMISSIONS } from '../../lib/permissions';
import { Btn, Card, ErrorBox, Field, Tag } from '../../ui';

/** 10 digits (a leading 1 is dropped) → 905-555-0123; anything else is left as typed. */
export function tidyPhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : v.trim();
}

export const MyAccount: React.FC = () => {
  const { profile, permissions, centers, reload } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!profile) return null;
  const rmCenter = centers.find(c => c.id === profile.rm_center_id)?.display_name;
  const dirty = (phone.trim() || '') !== (profile.phone || '') || (email.trim().toLowerCase() || '') !== (profile.email || '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      const p = tidyPhone(phone);
      await updateMyContact(p, email.trim());
      setPhone(p); setEmail(email.trim().toLowerCase());
      await reload();
      setSaved(true);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="v2-main v2-narrow" style={{ maxWidth: 760 }}>
      <div className="v2-head"><span className="v2-h1">My account</span></div>
      <Card style={{ marginBottom: 14 }} title={<span className="v2-row" style={{ gap: 8 }}><UserRound size={16} />{profile.full_name}</span>}>
        <div className="v2-grid2" style={{ gap: 10 }}>
          <Field label="Username"><input className="v2-input" value={profile.username} disabled /></Field>
          <Field label="Route manager at"><input className="v2-input" value={rmCenter || '—'} disabled /></Field>
        </div>
        <div className="v2-row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {profile.is_super_admin && <Tag tone="r">Super Admin</Tag>}
          {PERMISSIONS.filter(p => permissions.has(p.key)).map(p => <Tag key={p.key} tone="b">{p.label}</Tag>)}
        </div>
        <div className="v2-note" style={{ marginTop: 10 }}>Your name, center and permissions are set by a Super Admin in Users.</div>
      </Card>

      <Card style={{ marginBottom: 14 }} title="Contact details">
        <form onSubmit={save}>
          <div className="v2-grid2" style={{ gap: 10 }}>
            <Field label="Phone" hint="Workers see this number in Contacts on the map.">
              <input className="v2-input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => { setPhone(e.target.value); setSaved(false); }} placeholder="905-555-0123" />
            </Field>
            <Field label="Email">
              <input className="v2-input" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setSaved(false); }} />
            </Field>
          </div>
          <ErrorBox error={error} />
          <div className="v2-row">
            <Btn type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Btn>
            {saved && <span className="v2-small" style={{ color: 'var(--green)', fontWeight: 700 }}>Saved</span>}
          </div>
        </form>
      </Card>

      <Card title={<span className="v2-row" style={{ gap: 8 }}><KeyRound size={16} />Password</span>}>
        <div className="v2-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="v2-mut">Used here and on the RM map. At least 8 characters.</span>
          <Btn kind="o" onClick={() => nav('/app/password')}>Change password</Btn>
        </div>
      </Card>
    </div>
  );
};
