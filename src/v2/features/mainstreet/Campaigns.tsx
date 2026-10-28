// src/v2/features/mainstreet/Campaigns.tsx — MainstreetAI › Campaigns: what the reps are selling. A name, a
// colour (used for its zones on the map) and on/off. The first campaign is Taxifi.
import React, { useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { CAMPAIGN_COLORS, listCampaigns, listZones, saveCampaign, setCampaignActive, type Campaign } from '../../lib/mainstreet';
import { BUSINESS_KINDS, kindLabel, listCampaignCategories, setCampaignCategories, TAXIFI_KINDS } from '../../lib/msCity';
import { repKit, saveCampaignKit, type KitInput } from '../../lib/rep';
import { DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT, DEFAULT_SMS } from '../../lib/repField';
import { Btn, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

type Editing = { id: string | null; name: string; color: string; notes: string; kinds: string[] } | null;

export const Campaigns: React.FC = () => {
  const campaigns = useLoad(listCampaigns, []);
  const zones = useLoad(listZones, []);
  const cats = useLoad(listCampaignCategories, []);
  const kindsOf = (id: string) => (cats.data || []).filter(c => c.campaign_id === id).map(c => c.category);
  const [editing, setEditing] = useState<Editing>(null);
  const [kitFor, setKitFor] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const zonesOf = (id: string) => (zones.data || []).filter(z => z.status === 'active' && z.campaigns.some(c => c.campaign_id === id));
  const repsOf = (id: string) => new Set(zonesOf(id).map(z => z.campaigns.find(c => c.campaign_id === id)?.rep_id).filter(Boolean)).size;
  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const id = await saveCampaign(editing);
      await setCampaignCategories(id, editing.kinds);
      setEditing(null); campaigns.reload(); cats.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
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
        <Btn icon={Plus} onClick={() => setEditing({ id: null, name: '', color: CAMPAIGN_COLORS[0], notes: '', kinds: [...TAXIFI_KINDS] })}>New campaign</Btn>
      </div>
      <ErrorBox error={error || campaigns.error} />
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {campaigns.loading ? <Loading /> : !campaigns.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No campaigns yet. The first one is what your reps will be selling, e.g. Taxifi.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Campaign</th><th>Zones</th><th>Reps</th><th>Business categories</th><th>Notes</th><th>On</th><th /></tr></thead>
            <tbody>
              {campaigns.data.map(c => (
                <tr key={c.id}>
                  <td><span className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flexShrink: 0 }} /><b>{c.name}</b>
                    {!c.is_active && <Tag>Off</Tag>}</span></td>
                  <td>{zonesOf(c.id).length}</td>
                  <td>{repsOf(c.id)}</td>
                  <td className="v2-small" style={{ maxWidth: 260 }}>{kindsOf(c.id).length ? kindsOf(c.id).map(kindLabel).join(', ') : <span style={{ color: 'var(--rose)' }}>None yet</span>}</td>
                  <td className="v2-mut v2-small" style={{ maxWidth: 220, whiteSpace: 'pre-wrap' }}>{c.notes || '—'}</td>
                  <td><Toggle on={c.is_active} disabled={busy} onChange={() => flip(c)} label={`${c.name} on`} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Btn kind="o" size="sm" icon={BookOpen} onClick={() => setKitFor(c)}>Rep kit</Btn>{' '}
                    <Btn kind="o" size="sm" icon={Pencil} onClick={() => setEditing({ id: c.id, name: c.name, color: c.color, notes: c.notes || '', kinds: kindsOf(c.id) })}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>Turning a campaign off keeps its zones and history; it just can’t be put on new zones. A campaign’s colour is how its zones show on the map once a rep has them.</div>

      {kitFor && <KitEditor campaign={kitFor} onClose={() => setKitFor(null)} />}

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
          <Field label="Business categories that count" hint="Zones for this campaign are sized by these. Chains and closed places never count.">
            <div className="v2-row" style={{ gap: 6 }}>
              {BUSINESS_KINDS.map(k => {
                const on = editing.kinds.includes(k.key);
                return <button key={k.key} type="button" className={`v2-chip sm${on ? ' on' : ''}`}
                  onClick={() => setEditing({ ...editing, kinds: on ? editing.kinds.filter(x => x !== k.key) : [...editing.kinds, k.key] })}>{k.label}</button>;
              })}
            </div>
          </Field>
          <Field label="Notes (optional)"><textarea className="v2-input" rows={3} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="What it is, who it's for" /></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
};

// ───────────── the reps' kit for a campaign: pay, retry, send-info texts, pitch, objections ─────────────
const KitEditor: React.FC<{ campaign: Campaign; onClose: () => void }> = ({ campaign, onClose }) => {
  const [k, setK] = useState<KitInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  React.useEffect(() => {
    repKit(campaign.id).then(x => setK({
      pay_per_deal: x.pay_per_deal != null ? String(x.pay_per_deal) : '', retry_days: String(x.retry_days ?? 90),
      info_url: x.info_url || '', info_sms: x.info_sms || '', info_email_subject: x.info_email_subject || '', info_email_body: x.info_email_body || '',
      pitch: x.pitch || '', objections: x.objections.length ? x.objections : [{ q: '', a: '' }], onepager_url: x.onepager_url || '', present_url: x.present_url || '',
    })).catch(setError);
  }, [campaign.id]);
  const set = (p: Partial<KitInput>) => setK(cur => (cur ? { ...cur, ...p } : cur));
  const save = async () => {
    if (!k) return;
    setBusy(true); setError(null);
    try { await saveCampaignKit(campaign.id, k); onClose(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Rep kit: ${campaign.name}`} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !k} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      {!k ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Pay per approved deal ($)" hint="Shows reps what they’ve earned. Leave empty if not set."><input className="v2-input" inputMode="decimal" value={k.pay_per_deal} onChange={e => set({ pay_per_deal: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
            <Field label="Try “not interested” again after (days)" hint="It comes back on the rep’s list after this."><input className="v2-input" inputMode="numeric" value={k.retry_days} onChange={e => set({ retry_days: e.target.value.replace(/[^0-9]/g, '') })} /></Field>
          </div>
          <div className="v2-h2" style={{ margin: '8px 0 4px' }}>Send info</div>
          <Field label="Information link" hint="The rep’s code is added to it (?ref=CODE), so sign-ups are credited to them."><input className="v2-input" placeholder="https://" value={k.info_url} onChange={e => set({ info_url: e.target.value })} /></Field>
          <Field label="Text message" hint="{business}, {contact}, {link} and {rep} are filled in.">
            <textarea className="v2-input" rows={2} placeholder={DEFAULT_SMS} value={k.info_sms} onChange={e => set({ info_sms: e.target.value })} /></Field>
          <Field label="Email subject"><input className="v2-input" placeholder={DEFAULT_EMAIL_SUBJECT} value={k.info_email_subject} onChange={e => set({ info_email_subject: e.target.value })} /></Field>
          <Field label="Email"><textarea className="v2-input" rows={4} placeholder={DEFAULT_EMAIL_BODY} value={k.info_email_body} onChange={e => set({ info_email_body: e.target.value })} /></Field>
          <div className="v2-h2" style={{ margin: '8px 0 4px' }}>Pitch kit</div>
          <Field label="The pitch"><textarea className="v2-input" rows={4} value={k.pitch} onChange={e => set({ pitch: e.target.value })} placeholder="What to say at the door, in a few lines" /></Field>
          <Field label="Objections and answers">
            <div>
              {k.objections.map((o, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr auto', gap: 6, marginBottom: 6 }}>
                  <input className="v2-input" placeholder="“We already have an accountant”" value={o.q} onChange={e => set({ objections: k.objections.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                  <input className="v2-input" placeholder="What to say back" value={o.a} onChange={e => set({ objections: k.objections.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
                  <Btn kind="o" size="sm" icon={Trash2} aria-label="Remove" onClick={() => set({ objections: k.objections.filter((_, j) => j !== i) })} />
                </div>))}
              <Btn kind="o" size="sm" icon={Plus} onClick={() => set({ objections: [...k.objections, { q: '', a: '' }] })}>Add an objection</Btn>
            </div>
          </Field>
          <Field label="Presentation (optional)" hint="What reps open with Present at the door: a page in the app, e.g. /present/taxifi.html, or an https:// link.">
            <input className="v2-input" placeholder="/present/…" value={k.present_url} onChange={e => set({ present_url: e.target.value })} /></Field>
          <Field label="One-pager link (optional)"><input className="v2-input" placeholder="https://" value={k.onepager_url} onChange={e => set({ onepager_url: e.target.value })} /></Field>
          <ErrorBox error={error} />
        </>)}
    </Modal>
  );
};
