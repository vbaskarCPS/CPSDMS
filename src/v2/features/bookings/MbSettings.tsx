// src/v2/features/bookings/MbSettings.tsx — Master Bookings settings for the center: the season and
// round the picker opens on, and how much of a route has to be knocked for it to count as done.
// More settings will join these.
import React, { useEffect, useState } from 'react';
import { useLoad } from '../../lib/data';
import { getSettings, saveSettings, seasonKey, seasonLabel, parseSeason, type MbSettings, type Season } from '../../lib/masterBookings';
import { Btn, ErrorBox, Field, Loading, Modal } from '../../ui';

export const MbSettingsModal: React.FC<{ centerId: string; seasons: Season[]; onClose: () => void; onSaved: (s: MbSettings) => void }> = ({ centerId, seasons, onClose, onSaved }) => {
  const cur = useLoad(() => getSettings(centerId), [centerId]);
  const [s, setS] = useState<MbSettings | null>(null);
  const [pct, setPct] = useState('50');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (cur.data) { setS(cur.data); setPct(String(cur.data.done_pct)); } }, [cur.data]);

  const pctN = Number(pct);
  const pctOk = Number.isInteger(pctN) && pctN >= 1 && pctN <= 100;
  const save = async () => {
    if (!s) return;
    if (!pctOk) { setErr(new Error('Enter a whole percentage from 1 to 100.')); return; }
    setBusy(true); setErr(null);
    try { onSaved(await saveSettings(centerId, { ...s, done_pct: pctN })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const seasonValue = s?.service && s.season ? `${s.service}-${s.season}` : '';
  const options = [...seasons];
  if (seasonValue && !options.some(o => seasonKey(o) === seasonValue)) options.push({ service: s!.service!, season: s!.season! });

  return (
    <Modal title="Master Bookings settings" onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={save} disabled={busy || !s}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <ErrorBox error={cur.error} />
      {!s ? <Loading /> : (
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Default season" hint="What Master Bookings opens on. The picker can still change it any time.">
            <select className="v2-input" value={seasonValue} onChange={e => { const p = parseSeason(e.target.value); setS({ ...s, service: p?.service || null, season: p?.season || null }); }} aria-label="Default season">
              <option value="">This year’s season for the center</option>
              {options.map(o => <option key={seasonKey(o)} value={seasonKey(o)}>{seasonLabel(o)}</option>)}
            </select>
          </Field>
          <Field label="Default round">
            <select className="v2-input" value={s.round ? String(s.round) : 'current'} onChange={e => setS({ ...s, round: e.target.value === 'current' ? null : Number(e.target.value) })} aria-label="Default round">
              <option value="current">Current round (each map’s own)</option>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Round {n}</option>)}
            </select>
          </Field>
          <Field label="A route is done at" hint="The share of a route’s doors that need a knock this round. Knocks tapped seconds apart don’t count.">
            <div className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input className="v2-input" style={{ width: 90 }} inputMode="numeric" value={pct} onChange={e => { setPct(e.target.value.replace(/[^0-9]/g, '')); setErr(null); }} aria-label="Done threshold (%)" />
              <span>% of its doors knocked</span>
            </div>
            {!pctOk && <span className="v2-note" style={{ color: '#b91c1c', display: 'block' }}>Enter a whole percentage from 1 to 100.</span>}
          </Field>
        </div>
      )}
      <ErrorBox error={err} />
    </Modal>
  );
};
