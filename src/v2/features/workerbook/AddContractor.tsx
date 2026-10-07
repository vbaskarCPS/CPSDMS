// src/v2/features/workerbook/AddContractor.tsx — add one contractor by hand with the next CN # for this center.
import React, { useEffect, useState } from 'react';
import { addContractor, nextCn } from '../../lib/workerbook';
import { Btn, ErrorBox, Field, Modal } from '../../ui';

export const AddContractor: React.FC<{ centerId: string; year: number; onClose: () => void; onSaved: () => void }> = ({ centerId, year, onClose, onSaved }) => {
  const [f, setF] = useState({ cn: '', first: '', last: '', cell: '', email: '', shuttle: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { nextCn(centerId, year).then(cn => setF(x => (x.cn ? x : { ...x, cn }))).catch(setError); }, [centerId, year]);
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (!f.first.trim()) throw new Error('First name is required');
      await addContractor({ centerId, year, ...f, cn: f.cn.trim().toUpperCase() });
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Add contractor · ${year}`} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy} onClick={save}>{busy ? 'Adding…' : 'Add'}</Btn></>}>
      <ErrorBox error={error} />
      <div className="v2-grid2" style={{ gap: 10, marginTop: error ? 12 : 0 }}>
        <Field label="CN #" hint="Next free number for this center; change it if needed."><input className="v2-input" value={f.cn} onChange={e => set('cn', e.target.value)} /></Field>
        <Field label="Shuttle"><input className="v2-input" value={f.shuttle} onChange={e => set('shuttle', e.target.value)} /></Field>
        <Field label="First name"><input className="v2-input" value={f.first} onChange={e => set('first', e.target.value)} /></Field>
        <Field label="Last name"><input className="v2-input" value={f.last} onChange={e => set('last', e.target.value)} /></Field>
        <Field label="Cell"><input className="v2-input" inputMode="tel" value={f.cell} onChange={e => set('cell', e.target.value)} /></Field>
        <Field label="Email"><input className="v2-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
      </div>
      <div className="v2-note">If this phone number belongs to someone from an earlier year, their history (days, Silver Hats) carries over.</div>
    </Modal>
  );
};
