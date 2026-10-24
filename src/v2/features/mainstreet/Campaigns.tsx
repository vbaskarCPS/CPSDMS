// src/v2/features/mainstreet/Campaigns.tsx — MainstreetAI › Campaigns: what the reps are selling. A name, a
// colour (used for its zones on the map) and on/off. The first campaign is Taxifi.
import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { CAMPAIGN_COLORS, listCampaigns, listZones, saveCampaign, setCampaignActive, type Campaign } from '../../lib/mainstreet';
import { Btn, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

type Editing = { id: string | null; name: string; color: string; notes: string } | null;

export const Campaigns: React.FC = () => {
  const campaigns = useLoad(listCampaigns, []);
  const zones = useLoad(listZones, []);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const zonesOf = (id: string) => (zones.data || []).filter(z => z.status === 'active' && z.campaigns.some(c => c.campaign_id === id));
  const repsOf = (id: string) => new Set(zonesOf(id).map(z => z.campaigns.find(c => c.campaign_id === id)?.rep_id).filter(Boolean)).size;
  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try { await saveCampaign(editing); setEditing(null); campaigns.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const flip = async (c: Campaign) => {
    setBusy(true); setError(null);
    try { await setCampaignActive(c.id, !c.is_active); campaigns.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Campaigns</span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setEditing({ id: null, name: '', color: CAMPAIGN_COLORS[0], notes: '' })}>New campaign</Btn>
      </div>
      <ErrorBox error={error || campaigns.error} />
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {campaigns.loading ? <Loading /> : !campaigns.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No campaigns yet. The first one is what your reps will be selling, e.g. Taxifi.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Campaign</th><th>Zones</th><th>Reps</th><th>Notes</th><th>On</th><th /></tr></thead>
            <tbody>
              {campaigns.data.map(c => (
                <tr key={c.id}>
                  <td><span className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flexShrink: 0 }} /><b>{c.name}</b>
                    {!c.is_active && <Tag>Off</Tag>}</span></td>
                  <td>{zonesOf(c.id).length}</td>
                  <td>{repsOf(c.id)}</td>
                  <td className="v2-mut v2-small" style={{ maxWidth: 280, whiteSpace: 'pre-wrap' }}>{c.notes || '—'}</td>
                  <td><Toggle on={c.is_active} disabled={busy} onChange={() => flip(c)} label={`${c.name} on`} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <Btn kind="o" size="sm" icon={Pencil} onClick={() => setEditing({ id: c.id, name: c.name, color: c.color, notes: c.notes || '' })}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>Turning a campaign off keeps its zones and history; it just can’t be put on new zones. A campaign’s colour is how its zones show on the map once a rep has them.</div>

      {editing && (
        <Modal title={editing.id ? 'Edit campaign' : 'New campaign'} onClose={() => setEditing(null)}
          footer={<><Btn kind="o" onClick={() => setEditing(null)}>Cancel</Btn><Btn disabled={busy || !editing.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
          <Field label="Name"><input className="v2-input" autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Taxifi" /></Field>
          <Field label="Colour">
            <div className="v2-row" style={{ gap: 6 }}>
              {CAMPAIGN_COLORS.map(col => (
                <button key={col} type="button" aria-label={col} onClick={() => setEditing({ ...editing, color: col })}
                  style={{ width: 28, height: 28, borderRadius: 8, background: col, border: editing.color === col ? '3px solid #111827' : '3px solid transparent' }} />
              ))}
            </div>
          </Field>
          <Field label="Notes (optional)"><textarea className="v2-input" rows={3} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="What it is, who it's for" /></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
};
