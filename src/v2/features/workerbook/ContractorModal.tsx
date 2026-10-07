// src/v2/features/workerbook/ContractorModal.tsx — one contractor: contact details, status list, history.
import React, { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { db, must } from '../../lib/client';
import {
  updatePerson, updateHire, statusHistory, bookedDays, STATUS_LISTS, statusLabel, fullName, HAT_CODES,
  type Hire, type StatusCode,
} from '../../lib/workerbook';
import { Btn, ErrorBox, Field, Modal, Tag } from '../../ui';

export const ContractorModal: React.FC<{ hire: Hire; year: number; onClose: () => void; onSaved: () => void }> = ({ hire, onClose, onSaved }) => {
  const { center, centers } = useAuth();
  const p = hire.person;
  const [f, setF] = useState({
    first_name: p.first_name, last_name: p.last_name, cell_phone: p.cell_phone || '', alt_phone: p.alt_phone || '',
    email: p.email || '', address: p.address || '', notes: p.notes || '', shuttle: hire.shuttle || '', status: hire.status as StatusCode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pinSetAt, setPinSetAt] = useState(hire.pin_set_at);
  // A forgotten PIN: clearing it puts the worker back on their first name until they make a new one.
  const resetPin = async () => {
    setBusy(true); setError(null);
    try { must(await db.rpc('app_reset_worker_pin', { p_hire: hire.id })); setPinSetAt(null); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const history = useLoad(() => statusHistory(hire.id), [hire.id]);
  const days = useLoad(() => bookedDays(hire.id), [hire.id]);
  const isHome = !center || center.id === hire.center_id;
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));

  const save = async (statusOverride?: StatusCode) => {
    setBusy(true); setError(null);
    try {
      if (!f.first_name.trim()) throw new Error('First name is required');
      await updatePerson(p.id, {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(), cell_phone: f.cell_phone.trim() || null,
        alt_phone: f.alt_phone.trim() || null, email: f.email.trim().toLowerCase() || null, address: f.address.trim() || null, notes: f.notes.trim() || null,
      });
      if (isHome) await updateHire(hire.id, { shuttle: f.shuttle.trim() || null, status: statusOverride || f.status });
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const showedHere = (days.data || []).filter(d => d.attendance === 'showed').length;
  const homeName = centers.find(c => c.id === hire.center_id)?.display_name || 'another center';

  return (
    <Modal wide title={<>{fullName(p)} <span className="v2-mut" style={{ fontWeight: 600 }}>· {hire.cn}</span></>} onClose={onClose}
      footer={<>
        {hire.status !== 'active' && isHome && <Btn kind="o" disabled={busy} onClick={() => save('active')}>Move back to Active</Btn>}
        <span className="v2-spacer" />
        <Btn kind="o" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}>
      <ErrorBox error={error} />
      <div className="v2-grid4" style={{ marginBottom: 14, marginTop: error ? 12 : 0 }}>
        <div className="v2-card"><div className="v2-card-h">Lifetime days</div><div className="v2-kpi">{p.lifetime_days + showedHere}</div>
          <div className="v2-note">{p.lifetime_days} before this app · {showedHere} in the app</div></div>
        <div className="v2-card"><div className="v2-card-h">No-shows</div><div className="v2-kpi">{hire.ns_count + (days.data || []).filter(d => d.attendance === 'no_show').length}</div></div>
        <div className="v2-card"><div className="v2-card-h">Silver Hats</div>
          <div className="v2-row" style={{ gap: 6 }}>{HAT_CODES.map(c => <Tag key={c} tone={(p.hats?.[c] || 0) > 0 ? 'b' : undefined}>{c} {p.hats?.[c] || 0}</Tag>)}</div></div>
        <div className="v2-card"><div className="v2-card-h">Rates from sheet</div>
          <div className="v2-small">Alumni {hire.alumni_rate != null ? `+$${Number(hire.alumni_rate).toFixed(2)}` : '—'} · Silver {hire.silver_rate != null ? `+$${Number(hire.silver_rate).toFixed(2)}` : '—'}</div>
          <div className="v2-note">First season {p.first_year || '—'}</div></div>
      </div>

      <div className="v2-grid2">
        <div>
          <div className="v2-grid2" style={{ gap: 10 }}>
            <Field label="First name"><input className="v2-input" value={f.first_name} onChange={e => set('first_name', e.target.value)} /></Field>
            <Field label="Last name"><input className="v2-input" value={f.last_name} onChange={e => set('last_name', e.target.value)} /></Field>
            <Field label="Cell"><input className="v2-input" inputMode="tel" value={f.cell_phone} onChange={e => set('cell_phone', e.target.value)} /></Field>
            <Field label="Alternate phone"><input className="v2-input" inputMode="tel" value={f.alt_phone} onChange={e => set('alt_phone', e.target.value)} /></Field>
          </div>
          <Field label="Email"><input className="v2-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
          <Field label="Address"><input className="v2-input" value={f.address} onChange={e => set('address', e.target.value)} /></Field>
          <div className="v2-grid2" style={{ gap: 10 }}>
            <Field label="Shuttle"><input className="v2-input" value={f.shuttle} disabled={!isHome} onChange={e => set('shuttle', e.target.value)} /></Field>
            <Field label="Status">
              <select className="v2-sel" value={f.status} disabled={!isHome} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                {STATUS_LISTS.map(s => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
              </select>
            </Field>
          </div>
          {!isHome && <div className="v2-note">Home center is {homeName}; only it can change shuttle and status.</div>}
          <Field label="Notes"><textarea className="v2-input" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
          <div className="v2-note v2-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Sign-in PIN: {pinSetAt ? `set ${new Date(pinSetAt).toLocaleDateString('en-CA')}` : 'not set yet — signs in with first name'}. Workers make their own under My Account. ID numbers are kept in the sheet, not here.</span>
            {pinSetAt && <Btn size="sm" kind="o" disabled={busy} onClick={resetPin}>Reset PIN</Btn>}
          </div>
        </div>
        <div className="v2-stack">
          <div className="v2-card">
            <div className="v2-card-h">Days booked</div>
            {days.loading ? <div className="v2-mut v2-small">Loading…</div> : (days.data || []).length === 0 ? <div className="v2-mut v2-small">Not booked yet in the app.</div> : (
              <div className="v2-stack" style={{ gap: 4, maxHeight: 180, overflow: 'auto' }}>
                {(days.data || []).slice(0, 40).map(d => (
                  <div key={d.day + d.center_id} className="v2-row v2-small" style={{ justifyContent: 'space-between' }}>
                    <span>{new Date(d.day + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    {d.attendance === 'showed' ? <Tag tone="g">Showed</Tag> : d.attendance === 'no_show' ? <Tag tone="r">No-show</Tag> : <Tag>Booked</Tag>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="v2-card">
            <div className="v2-card-h">Status history</div>
            {(history.data || []).map((s, i) => (
              <div key={i} className="v2-row v2-small" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
                <span>{statusLabel(s.status as StatusCode)}</span><span className="v2-mut">since {s.since}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
