// /money/receipt — photos of a receipt, or a screenshot of a payment → what the AI read (store, date, total, how it was
// paid, the lines by category) → check it → save. Paid by card: matched to the bank's charge, which takes the receipt's
// category; if the charge isn't in yet, it matches later by itself. Paid cash: it goes in the cash wallet.
// ?pay=cash starts it as a cash receipt.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, Camera, Check, Image, Link2, Loader2, X } from 'lucide-react';
import { Button, Card, Field, Header, Input, Page, Segmented, TextArea, uid } from '../../../ui/primitives';
import { keeperImage, readReceipt, shrinkImage, type ReceiptRead } from '../../../lib/ai';
import { SPENDING_CATEGORIES } from '../categories';
import { CategoryIcon } from '../CategoryIcon';
import { dayLabel, money, niceName, round2, todayIso } from '../lib';
import { useMoney } from '../useMoney';
import { addCashRow, candidatesFor, linkReceipt, loadReceipts, saveReceipt, saveReceiptPhotos, splitByCategory, type Candidate } from '../receipts';
import { autoPick, shiftDay } from '../receiptMatch';
import type { Receipt, ReceiptItem } from '../types';

const MAX_PHOTOS = 4;
interface Draft {
  kind: 'receipt' | 'transaction';
  merchant: string; date: string; time: string; total: string;
  tax: number; tip: number; payment: 'card' | 'cash'; cardLast4: string;
  items: ReceiptItem[]; category: string; note: string;
  confidence: ReceiptRead['confidence']; confidenceNote: string;
}

export function AddReceipt() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { accounts } = useMoney('0000', '0000');
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ id: string; file: File; thumb: string }[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [done, setDone] = useState<{ receipt: Receipt; matched?: Candidate; cands: Candidate[] } | null>(null);
  const accName = (id: string) => accounts.find(a => a.id === id)?.name || 'Bank';
  const total = Number((draft?.total || '').replace(/[^\d.]/g, ''));
  const split = useMemo(() => (draft ? splitByCategory({ items: draft.items, total: total || 0, category: draft.category }) : []), [draft, total]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    try {
      const added = await Promise.all(files.slice(0, room).map(async file => ({ id: uid(), file, thumb: (await shrinkImage(file, 240, 0.6)).dataUrl })));
      setPhotos(p => [...p, ...added].slice(0, MAX_PHOTOS));
      if (files.length > room) setError(`Up to ${MAX_PHOTOS} photos a receipt; the first ${room} were added.`);
    } catch { setError("Couldn't read that photo. Try another."); }
  }

  async function read() {
    if (!photos.length) return;
    setBusy(photos.length > 1 ? `Reading your ${photos.length} photos…` : 'Reading the receipt…'); setError(null);
    try {
      // receipts need the detail: a bigger image than a meal photo
      const big = await Promise.all(photos.map(p => shrinkImage(p.file, photos.length > 1 ? 1400 : 1800, 0.85)));
      const r = await readReceipt(big.map(b => ({ base64: b.base64, mediaType: b.mediaType })), SPENDING_CATEGORIES, todayIso(), note);
      if (r.kind === 'other' && !r.total) { setError("That doesn't look like a receipt or a payment. Try a clearer photo of the whole receipt."); return; }
      const category = r.items.length ? splitByCategory({ items: r.items, total: r.total, category: r.category })[0]?.category || r.category : r.category;
      setDraft({
        kind: r.kind === 'transaction' ? 'transaction' : 'receipt',
        merchant: r.merchant, date: r.date && r.date <= todayIso() ? r.date : todayIso(), time: r.time, total: r.total ? r.total.toFixed(2) : '',
        tax: r.tax, tip: r.tip, payment: params.get('pay') === 'cash' || r.payment === 'cash' ? 'cash' : 'card', cardLast4: r.cardLast4,
        items: r.items, category, note, confidence: r.confidence, confidenceNote: r.confidenceNote,
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read it'); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!draft || !(total > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return;
    setBusy('Saving…'); setError(null);
    try {
      const id = uid();
      const keep = await Promise.all(photos.map(p => keeperImage(p.file)));
      let receipt: Receipt = {
        id, date: draft.date, merchant: draft.merchant.trim() || 'Receipt', total: round2(total), payment: draft.payment,
        items: draft.items, category: draft.category, photos: keep.length, kind: draft.kind, addedAt: new Date().toISOString(),
        ...(draft.time ? { time: draft.time } : {}), ...(draft.tax ? { tax: draft.tax } : {}), ...(draft.tip ? { tip: draft.tip } : {}),
        ...(draft.cardLast4 ? { cardLast4: draft.cardLast4 } : {}), ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      };
      await saveReceiptPhotos(id, keep);
      if (receipt.payment === 'cash') {
        const row = await addCashRow({ date: receipt.date, desc: receipt.merchant, amount: receipt.total, category: receipt.category, note: receipt.note });
        receipt = { ...receipt, txnId: row.id, txnMonth: row.date.slice(0, 7), matchedAt: new Date().toISOString(), matchedBy: 'cash' };
        await saveReceipt(receipt);
        setDone({ receipt, cands: [] });
        return;
      }
      await saveReceipt(receipt);
      const others = await loadReceipts(shiftDay(receipt.date, -45));
      const cands = await candidatesFor(receipt, others);
      const pick = autoPick(cands, receipt.total);
      if (pick) receipt = await linkReceipt(receipt, pick.txn, 'auto');
      setDone({ receipt, matched: pick || undefined, cands });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(null); }
  }

  async function choose(c: Candidate) {
    if (!done) return;
    setBusy('Matching…');
    try { const receipt = await linkReceipt(done.receipt, c.txn, 'hand'); setDone({ ...done, receipt, matched: c }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(null); }
  }
  const again = () => { setDone(null); setDraft(null); setPhotos([]); setNote(''); setError(null); };

  // ── after saving ──
  if (done) {
    const r = done.receipt;
    return (
      <Page>
        <Header title="Receipt saved" back="/money/receipts" />
        <Card>
          <div className="pl-row"><CategoryIcon name={r.category} size={22} /><div className="pl-grow"><b>{niceName(r.merchant.toUpperCase())}</b><br /><small className="pl-muted">{dayLabel(r.date)} · {r.category}</small></div><span className="mo-amt">{money(r.total)}</span></div>
        </Card>
        {r.payment === 'cash' ? (
          <Card><p className="mo-rcpt-result"><Banknote /> Logged in the cash wallet as {r.category}.</p></Card>
        ) : done.matched ? (
          <Card><p className="mo-rcpt-result"><Link2 /> Matched to {accName(done.matched.txn.accountId)} · {dayLabel(done.matched.txn.date)} · {money(Math.abs(done.matched.txn.amount))}. That charge now counts as {r.category}.</p></Card>
        ) : done.cands.length ? (
          <Card>
            <p><b>Which charge is it?</b></p>
            <div className="pl-list">
              {done.cands.slice(0, 5).map(c => (
                <div key={c.txn.id} className="mo-txn">
                  <div className="mo-txn__main"><b>{niceName(c.txn.merchant)}</b><small>{accName(c.txn.accountId)} · {dayLabel(c.txn.date)}{c.exact ? '' : ' · with a tip'}</small></div>
                  <span className="mo-amt">{money(c.txn.amount)}</span>
                  <Button small primary disabled={!!busy} onClick={() => void choose(c)}>This one</Button>
                </div>
              ))}
            </div>
            <p className="pl-muted" style={{ fontSize: 13 }}>None of these? Leave it: it matches by itself when the charge comes in.</p>
          </Card>
        ) : (
          <Card><p className="mo-rcpt-result"><Check /> Saved. The charge isn't in from the bank yet; when it comes in, it's matched and counted as {r.category}.</p></Card>
        )}
        {error && <p className="pl-error">{error}</p>}
        <div className="pl-grid-2">
          <Button block onClick={again}><Camera style={{ width: 18, height: 18 }} /> Another</Button>
          <Button block primary onClick={() => nav('/money/receipts')}>Done</Button>
        </div>
      </Page>
    );
  }

  // ── check what was read ──
  if (draft) {
    const okToSave = total > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !busy;
    return (
      <Page>
        <Header title={draft.kind === 'transaction' ? 'Payment' : 'Receipt'} back="/money" />
        {photos[0] && <img className="fd-preview" src={photos[0].thumb} alt="" style={{ maxHeight: 140, objectFit: 'contain', background: 'var(--bg-2)' }} />}
        {(draft.confidence === 'low' || draft.confidenceNote) && <p className="mo-rcpt-warn">{draft.confidenceNote || 'Hard to read: check the total and date.'}</p>}
        <Card className="pl-stack">
          <Field label="Store"><Input value={draft.merchant} onChange={e => setDraft({ ...draft, merchant: e.target.value })} placeholder="e.g. Costco" /></Field>
          <div className="pl-grid-2">
            <Field label="Total"><Input inputMode="decimal" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Date"><Input type="date" value={draft.date} max={todayIso()} onChange={e => setDraft({ ...draft, date: e.target.value })} /></Field>
          </div>
          <Field label="Paid with">
            <Segmented value={draft.payment} onChange={v => setDraft({ ...draft, payment: v })} options={[{ value: 'card', label: 'Card / online' }, { value: 'cash', label: 'Cash' }]} />
          </Field>
          <Field label="Category" hint={split.length > 1 ? `From the lines: ${split.map(s => `${s.category} ${money(s.amount)}`).join(' · ')}` : undefined}>
            <select className="pl-input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
              {SPENDING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {draft.items.length > 0 && (
            <details className="mo-rcpt-lines">
              <summary>{draft.items.length} line{draft.items.length === 1 ? '' : 's'}{draft.tax ? ` · tax ${money(draft.tax)}` : ''}{draft.tip ? ` · tip ${money(draft.tip)}` : ''}</summary>
              {draft.items.map((i, n) => (
                <div key={n} className="mo-rcpt-line">
                  <span className="pl-grow">{i.name}</span>
                  <select aria-label={`Category for ${i.name}`} value={i.category} onChange={e => setDraft({ ...draft, items: draft.items.map((x, k) => (k === n ? { ...x, category: e.target.value } : x)) })}>
                    {SPENDING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="mo-amt">{money(i.amount)}</span>
                </div>
              ))}
            </details>
          )}
          <Field label="Note (optional)"><Input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. Diwali sweets for the office" /></Field>
        </Card>
        {error && <p className="pl-error">{error}</p>}
        <Button primary block disabled={!okToSave} onClick={() => void save()}>{busy || (draft.payment === 'cash' ? 'Save to the cash wallet' : 'Save and match to the card')}</Button>
        <Button block ghost disabled={!!busy} onClick={() => setDraft(null)}>Back to the photos</Button>
      </Page>
    );
  }

  // ── photos ──
  return (
    <Page>
      <Header title="Add a receipt" eyebrow="Money" back="/money" />
      {busy ? (
        <Card><div className="fd-spinner"><Loader2 className="pl-spin" />{photos[0] && <img className="fd-preview" src={photos[0].thumb} alt="" style={{ maxHeight: 180, objectFit: 'contain' }} />}<b>{busy}</b><small className="pl-muted">A few seconds.</small></div></Card>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="fd-photos" aria-label="This receipt's photos">
              {photos.map((p, i) => (
                <div key={p.id} className="fd-photos__item">
                  <img src={p.thumb} alt={`Photo ${i + 1}`} />
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(ps => ps.filter(x => x.id !== p.id))}><X /></button>
                </div>
              ))}
            </div>
          )}
          {photos.length < MAX_PHOTOS && (photos.length === 0 ? (
            <label className="fd-bigbtn">
              <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={e => void onPick(e)} />
              <Camera /><span>Take a photo of the receipt</span>
              <small className="pl-muted" style={{ fontWeight: 400 }}>Flat, the whole receipt in the frame · a long one can take up to {MAX_PHOTOS} photos</small>
            </label>
          ) : (
            <label className="pl-btn pl-btn--block" style={{ cursor: 'pointer' }}>
              <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={e => void onPick(e)} style={{ display: 'none' }} />
              <Camera style={{ width: 18, height: 18 }} /> Add the next part ({photos.length}/{MAX_PHOTOS})
            </label>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="pl-btn pl-btn--block" style={{ cursor: 'pointer' }}>
              <input ref={libRef} type="file" accept="image/*" multiple onChange={e => void onPick(e)} style={{ display: 'none' }} />
              <Image style={{ width: 18, height: 18 }} /> {photos.length ? 'Add from photos' : 'A screenshot or saved photo'}
            </label>
          )}
          <Field label="Anything to add (optional)" hint="e.g. “paid cash”, “half of this was for work”, “the tip was $8”">
            <TextArea value={note} onChange={e => setNote(e.target.value)} />
          </Field>
          {error && <p className="pl-error">{error}</p>}
          <Button primary block disabled={!photos.length} onClick={() => void read()}>Read it</Button>
          <Link to="/money/cash" className="pl-btn pl-btn--block pl-btn--ghost"><Banknote style={{ width: 18, height: 18 }} /> No receipt: log cash</Link>
        </>
      )}
    </Page>
  );
}
