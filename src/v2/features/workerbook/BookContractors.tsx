// src/v2/features/workerbook/BookContractors.tsx — pick contractors to book onto a day.
import React, { useMemo, useState } from 'react';
import { useLoad } from '../../lib/data';
import { book, listHires, fullName } from '../../lib/workerbook';
import { Btn, ErrorBox, Loading, Modal, Tag } from '../../ui';

export const BookContractors: React.FC<{ centerId: string; date: string; bookedHireIds: Set<string>; onClose: () => void; onBooked: () => void }> =
  ({ centerId, date, bookedHireIds, onClose, onBooked }) => {
    const year = Number(date.slice(0, 4));
    const hires = useLoad(() => listHires(year), [year]);
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [homeOnly, setHomeOnly] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const list = useMemo(() => {
      const needle = q.trim().toLowerCase();
      return (hires.data || [])
        .filter(h => !bookedHireIds.has(h.id) && (!homeOnly || h.center_id === centerId))
        .filter(h => !needle || h.cn.toLowerCase().includes(needle) || fullName(h.person).toLowerCase().includes(needle))
        .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.cn.localeCompare(b.cn));
    }, [hires.data, q, bookedHireIds, homeOnly, centerId]);

    const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const save = async () => {
      setBusy(true); setError(null);
      try { await book(centerId, date, [...picked]); onBooked(); } catch (e) { setError(e); } finally { setBusy(false); }
    };

    return (
      <Modal wide title={`Book onto ${new Date(date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}`} onClose={onClose}
        footer={<><span className="v2-mut v2-small">{picked.size} selected</span><span className="v2-spacer" />
          <Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={!picked.size || busy} onClick={save}>{busy ? 'Booking…' : `Book ${picked.size || ''}`}</Btn></>}>
        <ErrorBox error={error} />
        <div className="v2-row" style={{ marginBottom: 10 }}>
          <input className="v2-input" style={{ maxWidth: 280 }} placeholder="Name or CN #" value={q} onChange={e => setQ(e.target.value)} autoFocus aria-label="Search" />
          <label className="v2-row v2-small" style={{ gap: 6 }}><input type="checkbox" checked={homeOnly} onChange={e => setHomeOnly(e.target.checked)} /> This center’s contractors only</label>
        </div>
        {hires.loading ? <Loading /> : (
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {list.map(h => {
              const wl = h.status === 'WL';
              return (
                <label key={h.id} className="v2-check" style={{ opacity: wl ? 0.5 : 1, cursor: wl ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" disabled={wl} checked={picked.has(h.id)} onChange={() => toggle(h.id)} />
                  <b style={{ width: 70 }}>{h.cn}</b><span style={{ flex: 1 }}>{fullName(h.person)}</span>
                  {h.shuttle && <span className="v2-mut v2-small">Shuttle {h.shuttle}</span>}
                  {h.status !== 'active' && <Tag tone={wl ? 'r' : 'a'}>{wl ? 'WL · can’t book' : h.status}</Tag>}
                </label>
              );
            })}
            {list.length === 0 && <div className="v2-mut" style={{ padding: 16 }}>Nobody left to book{q ? ' matching that search' : ''}.</div>}
          </div>
        )}
      </Modal>
    );
  };
