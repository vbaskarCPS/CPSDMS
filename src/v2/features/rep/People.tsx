// The people at a business: who they are, who decides and when to catch them. Add one by typing, or snap one or
// more business cards and each becomes a person (the card photo is kept with them). Also: do not knock.
import React, { useMemo, useRef, useState } from 'react';
import { Ban, Camera, Pencil, Plus, Star, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { photoUrls, shrinkPhoto } from '../../lib/rep';
import {
  DNK_REASONS, ROLES, contactsList, emptyContact, hideContact, readCards, roleFromTitle, saveContact, setDoNotKnock, setWebsite, uploadCard,
  type BizContact, type ContactInput, type DnkReason,
} from '../../lib/msField';
import { Btn, ErrorBox } from '../../ui';

export const People: React.FC<{ business: string; campaign: string; offline: boolean; tick: number; onChanged?: () => void }> =
  ({ business, campaign, offline, tick, onChanged }) => {
    const [mine, setMine] = useState(0);
    const list = useLoad(() => (offline ? Promise.resolve([] as BizContact[]) : contactsList(business, campaign)), [business, campaign, tick, mine, offline]);
    const [editing, setEditing] = useState<BizContact | 'new' | null>(null);
    const [scanned, setScanned] = useState<Scanned[] | null>(null);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const photos = useMemo(() => (list.data || []).map(c => c.card_photo).filter(Boolean) as string[], [list.data]);
    const urls = useLoad(() => (photos.length ? photoUrls(photos) : Promise.resolve({} as Record<string, string>)), [photos.join('|')]);
    const changed = () => { setMine(t => t + 1); onChanged?.(); };

    const scan = async (files: FileList | null) => {
      const fs = [...(files || [])].slice(0, 8); if (!fs.length) return;
      setReading(true); setError(null);
      try {
        const read = await readCards(fs, shrinkPhoto);
        setScanned(read.map(r => ({
          file: r.file, url: URL.createObjectURL(r.file), website: r.website || '',
          c: { ...emptyContact(), name: r.name || '', phone: r.phone || '', email: r.email || '', title: r.title || '', role: roleFromTitle(r.title) },
        })));
      } catch { setError(new Error('Couldn’t read the cards here (the reader needs signal the first time). Add the people by typing instead.')); }
      finally { setReading(false); if (fileRef.current) fileRef.current.value = ''; }
    };

    return (
      <div className="v2-people">
        <div className="v2-rep-row" style={{ margin: '16px 0 6px' }}>
          <b style={{ fontSize: 16 }}>People here</b>
          {!offline && <span style={{ display: 'flex', gap: 6 }}>
            <label className={`v2-rep-mini${reading ? ' busy' : ''}`}><Camera size={14} />{reading ? 'Reading…' : 'Scan cards'}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden disabled={reading} onChange={e => scan(e.target.files)} /></label>
            <button type="button" className="v2-rep-mini" onClick={() => setEditing('new')}><Plus size={14} />Add person</button>
          </span>}
        </div>
        {offline && <div className="v2-small v2-mut">People can be added when you have signal.</div>}
        <ErrorBox error={error || list.error} />
        {!!list.data?.length && (
          <div className="v2-people-list">
            {list.data.map(c => (
              <button key={c.id} type="button" className="p" onClick={() => setEditing(c)}>
                <span className="av">{initials(c.name)}</span>
                <span className="t">
                  <span className="n"><b>{c.name || 'No name'}</b>{c.decides && <span className="dec"><Star size={11} />Decides</span>}</span>
                  <span className="m">{[c.role, c.title && c.title !== c.role ? c.title : null, c.best_time ? `in ${c.best_time}` : null].filter(Boolean).join(' · ')}</span>
                  <span className="m">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
                </span>
                {c.card_photo && urls.data?.[c.card_photo] ? <img className="card" src={urls.data[c.card_photo]} alt="Their business card" /> : <Pencil size={15} className="ed" />}
              </button>))}
          </div>)}
        {!list.loading && !offline && !list.data?.length && <div className="v2-small v2-mut">No one yet. Scan their cards or add them by typing.</div>}
        {editing && <EditPerson business={business} campaign={campaign} person={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />}
        {scanned && <ReviewCards business={business} campaign={campaign} cards={scanned}
          onClose={() => { scanned.forEach(s => URL.revokeObjectURL(s.url)); setScanned(null); }}
          onSaved={() => { scanned.forEach(s => URL.revokeObjectURL(s.url)); setScanned(null); changed(); }} />}
      </div>
    );
  };

const initials = (n?: string) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

interface Scanned { file: File; url: string; website: string; c: ContactInput }

const PersonFields: React.FC<{ c: ContactInput; set: (c: ContactInput) => void }> = ({ c, set }) => (
  <>
    <input className="v2-input" placeholder="Name" value={c.name} onChange={e => set({ ...c, name: e.target.value })} autoComplete="off" />
    <div className="v2-rep-kinds" style={{ margin: '8px 0' }}>
      {ROLES.map(r => <button key={r} type="button" className={`v2-rep-pill${c.role === r ? ' on' : ''}`} onClick={() => set({ ...c, role: c.role === r ? '' : r })}>{r}</button>)}
    </div>
    <div className="v2-people-two">
      <input className="v2-input" type="tel" inputMode="tel" placeholder="Phone" value={c.phone} onChange={e => set({ ...c, phone: e.target.value })} autoComplete="off" />
      <input className="v2-input" type="email" inputMode="email" autoCapitalize="none" placeholder="Email" value={c.email} onChange={e => set({ ...c, email: e.target.value })} autoComplete="off" />
    </div>
    <label className="v2-people-check"><input type="checkbox" checked={c.decides} onChange={e => set({ ...c, decides: e.target.checked })} /> Makes the decision</label>
    <input className="v2-input" placeholder="Best time to catch them, e.g. after 2 PM weekdays" value={c.best_time} onChange={e => set({ ...c, best_time: e.target.value })} autoComplete="off" />
  </>
);

const EditPerson: React.FC<{ business: string; campaign: string; person: BizContact | null; onClose: () => void; onSaved: () => void }> =
  ({ business, campaign, person, onClose, onSaved }) => {
    const [c, setC] = useState<ContactInput>(person ? {
      name: person.name || '', role: person.role || '', title: person.title || '', phone: person.phone || '', email: person.email || '',
      decides: !!person.decides, best_time: person.best_time || '',
    } : emptyContact());
    const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
    const save = async () => {
      setBusy(true); setError(null);
      try { await saveContact(business, campaign, c, { id: person?.id }); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
    };
    const remove = async () => {
      if (!person) return;
      setBusy(true); setError(null);
      try { await hideContact(person.id, campaign); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
    };
    return (
      <div className="v2-rep-sheet-bg v2-rep-book" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="v2-rep-sheet" role="dialog" aria-label={person ? 'Edit person' : 'Add a person'}>
          <div className="v2-rep-row" style={{ marginTop: 0 }}><h2>{person ? 'Edit person' : 'Add a person'}</h2>
            <button type="button" className="v2-rep-x" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
          <PersonFields c={c} set={setC} />
          <ErrorBox error={error} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {person && <Btn kind="r" disabled={busy} onClick={remove}>Remove</Btn>}
            <Btn style={{ flex: 1, justifyContent: 'center' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
          </div>
        </div>
      </div>
    );
  };

const ReviewCards: React.FC<{ business: string; campaign: string; cards: Scanned[]; onClose: () => void; onSaved: () => void }> =
  ({ business, campaign, cards, onClose, onSaved }) => {
    const { session } = useAuth();
    const [rows, setRows] = useState(cards.map(x => ({ ...x, keep: true })));
    const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
    const keep = rows.filter(r => r.keep && (r.c.name.trim() || r.c.phone.trim() || r.c.email.trim()));
    const save = async () => {
      const uid = session?.user.id; if (!uid) return;
      setBusy(true); setError(null);
      try {
        for (const r of keep) {
          let path: string | null = null;
          try { path = await uploadCard(uid, await shrinkPhoto(r.file)); } catch { path = null; }   // the person is saved even if the photo isn't
          await saveContact(business, campaign, r.c, { cardPhoto: path, source: 'card' });
        }
        const site = rows.find(r => r.keep && r.website)?.website;
        if (site) await setWebsite(business, campaign, site).catch(() => {});
        onSaved();
      } catch (e) { setError(e); } finally { setBusy(false); }
    };
    return (
      <div className="v2-rep-sheet-bg v2-rep-book" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <div className="v2-rep-sheet" role="dialog" aria-label="Read from the cards">
          <div className="v2-rep-row" style={{ marginTop: 0 }}><h2>Read from {rows.length === 1 ? 'the card' : `${rows.length} cards`}</h2>
            <button type="button" className="v2-rep-x" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
          <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>Check each one: the reader isn’t perfect.</div>
          {rows.map((r, i) => (
            <div key={r.url} className={`v2-people-card${r.keep ? '' : ' off'}`}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <img src={r.url} alt={`Card ${i + 1}`} />
                <span className="v2-small v2-mut" style={{ flex: 1 }}>{r.c.title || 'Card ' + (i + 1)}{r.website ? ` · ${r.website}` : ''}</span>
                <label className="v2-people-check" style={{ margin: 0 }}><input type="checkbox" checked={r.keep} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} /> Keep</label>
              </div>
              {r.keep && <PersonFields c={r.c} set={c => setRows(rs => rs.map((x, j) => (j === i ? { ...x, c } : x)))} />}
            </div>))}
          <ErrorBox error={error} />
          <Btn style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '13px 0' }} disabled={busy || !keep.length} onClick={save}>
            {busy ? 'Saving…' : `Save ${keep.length} ${keep.length === 1 ? 'person' : 'people'}`}</Btn>
        </div>
      </div>
    );
  };

/** Do not knock: off every rep's list and map; an admin can undo it. */
export const DoNotKnock: React.FC<{ business: string; campaign: string; name: string; onDone: (reason: DnkReason) => void }> = ({ business, campaign, name, onDone }) => {
  const [pick, setPick] = useState<DnkReason | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const go = async () => {
    if (!pick) return;
    setBusy(true); setError(null);
    try { await setDoNotKnock(business, campaign, pick); onDone(pick); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="v2-people-dnk">
      <b><Ban size={14} /> Do not knock</b>
      <div className="v2-rep-kinds">
        {DNK_REASONS.map(r => <button key={r.key} type="button" className={`v2-rep-pill${pick === r.key ? ' on' : ''}`} onClick={() => setPick(pick === r.key ? null : r.key)}>{r.label}</button>)}
      </div>
      {pick ? <Btn kind="r" disabled={busy} onClick={go} style={{ marginTop: 8 }}>{busy ? 'Saving…' : `Take ${name} off every rep’s list`}</Btn>
        : <span className="v2-small v2-mut">Hides it from every rep’s list and map. An admin can undo it.</span>}
      <ErrorBox error={error} />
    </div>
  );
};
