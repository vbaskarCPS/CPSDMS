// Someone turned up after the session started: put them on the live map under a manager, so
// they can sign in and their manager can put them on a cart. Lists today's roster people who
// aren't on the live map yet; anyone not on today's list is booked first ("Book someone").
import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { useLoad } from '../../../lib/data';
import { legacyLiveSession } from '../../../lib/legacy';
import { fullName, updateRoster, type RosterRow } from '../../../lib/workerbook';
import { addLateArrival, type PlanManager } from '../../../lib/startSession';
import { Btn, ErrorBox, Loading, Modal } from '../../../ui';
import { dayContext } from '../../../lib/dayContext';
import { appShowedDates, countBefore } from '../../../lib/payoutEngine';

export const LateArrivals: React.FC<{
  centerId: string; region: string; date: string; rows: RosterRow[]; managers: PlanManager[];
  onClose: () => void; onBook: () => void; onAdded: () => void;
}> = ({ centerId, region, date, rows, managers, onClose, onBook, onAdded }) => {
  const live = useLoad(() => legacyLiveSession(centerId), [centerId]);
  const onMap = useMemo(() => new Set((live.data?.data.workers || []).map(w => w.contractorId.toUpperCase())), [live.data]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<RosterRow | null>(null);
  const [mgr, setMgr] = useState(managers[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const t = q.trim().toLowerCase();
  const off = rows.filter(r => !onMap.has(r.hire.cn.toUpperCase()))
    .filter(r => !t || fullName(r.hire.person).toLowerCase().includes(t) || r.hire.cn.toLowerCase().startsWith(t))
    .sort((a, b) => fullName(a.hire.person).localeCompare(fullName(b.hire.person)));

  const add = async () => {
    const m = managers.find(x => x.id === mgr);
    if (!pick || !m) return;
    setBusy(true); setError(null);
    try {
      const ctx = await dayContext(centerId, date, region);
      const shown = await appShowedDates([pick.hire_id]);
      await addLateArrival(centerId, pick, m, ctx.card, ctx.seasonYear, ctx.service, countBefore(shown[pick.hire_id], date));
      if (pick.attendance !== 'showed') await updateRoster(pick.id, { attendance: 'showed' });
      onAdded();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title="Late arrival" onClose={onClose}
      footer={<><Btn kind="o" icon={UserPlus} onClick={onBook}>Book someone</Btn><span className="v2-spacer" />
        <Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !pick || !mgr} onClick={add}>{busy ? 'Adding…' : 'Put on the live map'}</Btn></>}>
      <p style={{ marginTop: 0 }} className="v2-small v2-mut">Puts them on the live map so they can sign in; their manager then puts them on a cart (Manage Team on the RM map).</p>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
        <input className="v2-input" style={{ paddingLeft: 30 }} placeholder="Name or CN #" value={q} onChange={e => setQ(e.target.value)} aria-label="Search today’s list" autoFocus />
      </div>
      {live.loading ? <Loading /> : (
        <div className="v2-confirm-list" style={{ maxHeight: 280, border: '1px solid var(--line)', borderRadius: 10, padding: 4 }}>
          {off.map(r => (
            <label key={r.id} className={`v2-confirm${pick?.id === r.id ? ' on' : ''}`} style={{ cursor: 'pointer' }}>
              <input type="radio" name="late" checked={pick?.id === r.id} onChange={() => { setPick(r); if (r.manager_id) setMgr(r.manager_id); }} />
              <span><b>{fullName(r.hire.person)}</b> <span className="v2-small v2-mut">{r.hire.cn}</span></span>
            </label>
          ))}
          {off.length === 0 && <div className="v2-mut v2-small" style={{ padding: 10 }}>
            {t ? 'Nobody on today’s list matches.' : 'Everyone on today’s list is on the live map.'} Use “Book someone” for anyone else.</div>}
        </div>
      )}
      <label className="v2-label" htmlFor="late-mgr" style={{ marginTop: 12 }}>Manager</label>
      <select id="late-mgr" className="v2-sel" value={mgr} onChange={e => setMgr(e.target.value)}>
        {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
      </select>
      <ErrorBox error={error || live.error} />
    </Modal>
  );
};
