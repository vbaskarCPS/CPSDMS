// src/planner/features/shop/WishSheets.tsx — what opens over the wish lists (WishLists.tsx): the form for one of your
// own wishes (add, change, take off the list); one of the other's wishes, with "I've got it" and what follows it; a
// gift you've received; and a picture opened to its full size. A wish's full pictures are only fetched once it's
// opened: the lists themselves carry the small previews.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ClipboardPaste, ExternalLink, EyeOff, Gift, Heart, ImagePlus, Loader2, Lock, Trash2, X } from 'lucide-react';
import { Button, Field, Input, Sheet, TextArea, uid } from '../../ui/primitives';
import { canReadClipboard, clipboardImages, imagesFrom } from '../arvy/pics';
import { HEART_WORDS, MAX_WISH_PICS, draftProblem, firstName, linkSite, money, parsePrice, safeLink, wishFrom, wishLine, type GotRow, type Received, type Wish, type WishDraft, type WishPic, type WishWhen } from './wish';
import { loadWishPics, removeWish, saveWish } from './wishStore';
import { keepPicture, type KeptPic } from './wishPics';

/** "Nov 11". */
export const dayWords = (iso: string): string => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const NOT_SAVED = 'That didn’t save. Check your connection and try again.';

/** How much they want it: one to three hearts. */
export function Hearts({ n }: { n: 1 | 2 | 3 }) {
  return <span className="wish__hearts" role="img" aria-label={`${n} of 3 hearts: ${HEART_WORDS[n]}`}>{Array.from({ length: n }, (_, i) => <Heart key={i} aria-hidden />)}</span>;
}

/** A saved wish's full pictures, fetched when `wanted` first turns true (null until they're in). */
function useFullPics(wishId: string | null, wanted: boolean): Record<string, string> | null {
  const [full, setFull] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setFull(null);
    if (!wishId || !wanted) return;
    let on = true;
    loadWishPics(wishId).then(p => { if (on) setFull(p); }).catch(() => { if (on) setFull({}); });
    return () => { on = false; };
  }, [wishId, wanted]);
  return full;
}

/** A picture at its full size, over everything. A tap anywhere (or Escape) closes it. While the full one is still on
 *  its way the small preview stands in. */
function PicFull({ src, waiting, onClose }: { src: string; waiting: boolean; onClose: () => void }) {
  useEffect(() => {
    // caught before the sheet underneath hears it, so Escape closes the picture and not the sheet
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // drawn straight onto the page, not inside the sheet: a sheet scrolls, and some phones clip what's pinned inside one
  return createPortal(
    <div className="wish-full" role="dialog" aria-modal aria-label="The picture, full size" onClick={e => { e.stopPropagation(); onClose(); }}>
      <img src={src} alt="" />
      {waiting && <span className="wish-full__wait"><Loader2 className="pl-spin" aria-label="Loading the picture" /></span>}
      <button type="button" className="wish-full__x" aria-label="Close the picture"><X /></button>
    </div>,
    document.body,
  );
}

/** A wish's pictures as tiles, three across. A tap opens one full size; `onRemove` puts an ✕ on each (the form);
 *  `big` shows the full picture in the tile once it's in (a wish opened for reading). */
function PicTiles({ pics, full, big, onWant, onRemove, children }: {
  pics: (WishPic & { dataUrl?: string })[]; full: Record<string, string> | null; big?: boolean;
  onWant?: () => void; onRemove?: (id: string) => void; children?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = pics.find(p => p.id === openId);
  const best = (p: WishPic & { dataUrl?: string }) => p.dataUrl || full?.[p.id];
  if (!pics.length && !children) return null;
  return (
    <>
      <div className="wish-pics">
        {pics.map((p, i) => (
          <div key={p.id} className="wish-pics__item">
            <button type="button" aria-label={`Picture ${i + 1}: open it full size`} onClick={() => { onWant?.(); setOpenId(p.id); }}><img src={(big && best(p)) || p.thumb} alt="" /></button>
            {onRemove && <button type="button" className="wish-pics__x" aria-label={`Take picture ${i + 1} off`} onClick={() => onRemove(p.id)}><i><X /></i></button>}
          </div>
        ))}
        {children}
      </div>
      {open && <PicFull src={best(open) || open.thumb} waiting={!best(open)} onClose={() => setOpenId(null)} />}
    </>
  );
}

// ───────────── your own wish: add, change, take off ─────────────

/** How the form starts: a new wish (perhaps with a screenshot and what was read off it) or one being changed. */
export interface FormStart { key: string; wish?: Wish; draft: WishDraft; pics: KeptPic[]; hint?: string }

const WHENS: { value: WishWhen; label: string }[] = [{ value: 'anytime', label: 'Anytime' }, { value: 'christmas', label: 'Christmas' }, { value: 'birthday', label: 'Birthday' }, { value: 'other', label: 'Something else' }];

export function WishForm({ start, me, onClose, onSaved, onRemoved }: {
  start: FormStart; me: string; onClose: () => void;
  onSaved: (w: Wish, isNew: boolean) => void; onRemoved: (w: Wish) => void;
}) {
  const old = start.wish;
  const [d, setD] = useState<WishDraft>(start.draft);
  const [pics, setPics] = useState<(WishPic & { dataUrl?: string })[]>(() => [...(old?.pics || []), ...start.pics]);
  const [wantFull, setWantFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const full = useFullPics(old?.id || null, wantFull);
  const newId = useRef(uid());
  const room = MAX_WISH_PICS - pics.length;
  const set = (over: Partial<WishDraft>) => { setD(x => ({ ...x, ...over })); setError(null); };

  async function addPics(files: File[]) {
    if (!files.length) return;
    if (room <= 0) { setError('Three pictures at most. Take one off to add another.'); return; }
    setError(null);
    try {
      const added: KeptPic[] = [];
      for (const f of files.slice(0, room)) added.push(await keepPicture(f, uid()));
      setPics(p => [...p, ...added].slice(0, MAX_WISH_PICS));
      if (files.length > room) setError(`Three pictures at most; the first ${room === 1 ? 'one was' : `${room} were`} added.`);
    } catch { setError('Couldn’t open that picture. Try another.'); }
  }
  const adding = useRef(addPics); adding.current = addPics;
  // a picture pasted while the form is open goes on this wish (words pasted into a box are left alone)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const files = imagesFrom(e.clipboardData); if (files.length) { e.preventDefault(); void adding.current(files); } };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  async function pasteCopied() {
    try { const files = await clipboardImages(); if (files.length) void addPics(files); else setError('No picture copied yet. Copy one first, then tap Paste.'); }
    catch { setError('The planner can’t get at what you copied. Choose the picture instead.'); }
  }

  async function save() {
    const problem = draftProblem(d);
    if (problem) { setError(problem); return; }
    const wish = wishFrom(d, { id: old?.id || newId.current, of: old?.of || me, addedAt: old?.addedAt || new Date().toISOString(), pics });
    const kept = new Set(pics.map(p => p.id));
    setBusy(true); setError(null);
    try {
      await saveWish(wish, pics.flatMap(p => (p.dataUrl ? [{ id: p.id, dataUrl: p.dataUrl }] : [])), (old?.pics || []).filter(p => !kept.has(p.id)).map(p => p.id));
      onSaved(wish, !old);
    } catch { setError(NOT_SAVED); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!old) return;
    if (!sure) { setSure(true); return; }
    setBusy(true); setError(null);
    try { await removeWish(old); onRemoved(old); }
    catch { setError('That didn’t go through. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={onClose} title={old ? 'Your wish' : 'A new wish'}>
      <div className="pl-stack wish-form">
        {start.hint && <p className="pl-muted wish-form__hint">{start.hint}</p>}
        <PicTiles pics={pics} full={full} onWant={() => setWantFull(true)} onRemove={id => setPics(p => p.filter(x => x.id !== id))}>
          {room > 0 && (
            <label className="wish-pics__add">
              <input type="file" accept="image/*" multiple onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void addPics(files); }} />
              <ImagePlus aria-hidden /><span>{pics.length ? 'Another' : 'Add a picture'}</span>
            </label>
          )}
        </PicTiles>
        {room > 0 && canReadClipboard() && <button type="button" className="wish-form__paste" onClick={() => void pasteCopied()}><ClipboardPaste aria-hidden /> Paste a picture you’ve copied</button>}
        <Field label="What is it?"><Input value={d.what} maxLength={120} autoFocus={!old && !start.pics.length} onChange={e => set({ what: e.target.value })} placeholder="e.g. Noise-cancelling headphones" /></Field>
        <div className="pl-grid-2">
          <Field label="Price"><Input inputMode="decimal" value={d.price} maxLength={14} onChange={e => set({ price: e.target.value })} placeholder="$" /></Field>
          <Field label="From"><Input value={d.shop} maxLength={60} onChange={e => set({ shop: e.target.value })} placeholder="The shop" /></Field>
        </div>
        <Field label="Link"><Input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={d.link} maxLength={2000} onChange={e => set({ link: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Anything to know" hint="Size, colour, which one exactly."><TextArea value={d.note} maxLength={500} onChange={e => set({ note: e.target.value })} /></Field>
        <div className="pl-field">
          <span className="pl-label" id="wish-when">For when</span>
          <div className="pl-chips" role="radiogroup" aria-labelledby="wish-when">
            {WHENS.map(w => <button key={w.value} type="button" role="radio" aria-checked={d.when === w.value} className={`pl-chip ${d.when === w.value ? 'is-on' : ''}`} onClick={() => set({ when: w.value })}>{w.label}</button>)}
          </div>
          {d.when === 'other' && <Input value={d.occasion} maxLength={40} onChange={e => set({ occasion: e.target.value })} placeholder="Our anniversary, Diwali…" aria-label="Which occasion" />}
        </div>
        <div className="pl-field">
          <span className="pl-label" id="wish-hearts">How much do you want it?</span>
          <div className="wish-hearts" role="radiogroup" aria-labelledby="wish-hearts">
            {([1, 2, 3] as const).map(n => <button key={n} type="button" role="radio" aria-checked={d.hearts === n} aria-label={`${n} of 3 hearts: ${HEART_WORDS[n]}`} className={n <= d.hearts ? 'is-on' : ''} onClick={() => set({ hearts: n })}><Heart aria-hidden /></button>)}
            <span>{HEART_WORDS[d.hearts]}</span>
          </div>
        </div>
        {error && <p className="pl-error" role="alert">{error}</p>}
        <Button primary block disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : old ? 'Save' : 'Add to my list'}</Button>
        {old && <Button block ghost danger disabled={busy} onClick={() => void remove()}><Trash2 size={16} /> {sure ? 'Tap again to take it off' : 'Take it off my list'}</Button>}
      </div>
    </Sheet>
  );
}

// ───────────── looking at a wish ─────────────

/** What a wish says, for reading: how much it's wanted, the price and where from, its pictures, the note, the link. */
function WishFacts({ wish }: { wish: Wish }) {
  const full = useFullPics(wish.id, wish.pics.length > 0);
  const link = safeLink(wish.link);
  return (
    <>
      <p className="wish-facts"><Hearts n={wish.hearts} /> <span>“{HEART_WORDS[wish.hearts]}”</span>{wishLine(wish) && <b>{wishLine(wish)}</b>}</p>
      <PicTiles pics={wish.pics} full={full} big />
      {wish.note && <p className="wish-facts__note">{wish.note}</p>}
      {link && <a className="pl-btn pl-btn--block" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden /> <span className="wish-facts__site">Open it at {linkSite(link)}</span></a>}
    </>
  );
}

/** One of the OTHER one's wishes: everything about it, and the quiet part. "I've got it" (and "Not any more"), a note
 *  and what was paid that only the buyer sees, and "It's been given", which is what finally shows on the wisher's side. */
export function TheirWish({ wish, got, busy, onClose, onGot, onUndo, onNote, onGiven, onNotGiven }: {
  wish: Wish | null; got: GotRow['got'] | null; busy: boolean; onClose: () => void;
  onGot: () => void; onUndo: () => void; onNote: (note: string, paid: string) => void; onGiven: () => void; onNotGiven: () => void;
}) {
  const [note, setNote] = useState(''); const [paid, setPaid] = useState('');
  const [sure, setSure] = useState(false);
  const [bad, setBad] = useState(false);
  const paidWas = got?.paid ? String(got.paid) : '';
  // the note boxes start from what's saved, each time a wish is opened or its mark changes
  useEffect(() => { setNote(got?.note || ''); setPaid(paidWas); setSure(false); setBad(false); }, [wish?.id, got?.at, got?.note, paidWas]);
  if (!wish) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const changed = note.trim() !== (got?.note || '') || paid.trim() !== paidWas;
  return (
    <Sheet open onClose={onClose}>
      <h2 className="wish-title">{wish.what}</h2>
      <WishFacts wish={wish} />
      <hr className="pl-divider" />
      {!got ? (
        <>
          <Button primary block disabled={busy} onClick={onGot}><Check size={18} /> I’ve got it</Button>
          <p className="pl-muted wish-quiet"><EyeOff aria-hidden /> Only you will see that. Their own list stays exactly as it is.</p>
        </>
      ) : (
        <>
          <p className="wish-gotline"><Check aria-hidden /> {got.givenAt ? `You got this ${dayWords(got.at)}, and it was given ${dayWords(got.givenAt)}.` : `You got this ${dayWords(got.at)}.`}</p>
          {wish.removedAt && <p className="wish-gone">This was taken off the list after you got it.</p>}
          <Field label={<><Lock size={12} aria-hidden /> A note just for you</>}><TextArea value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Where you bought it, where it’s hidden…" /></Field>
          <Field label="What you paid"><Input inputMode="decimal" value={paid} maxLength={14} onChange={e => { setPaid(e.target.value); setBad(false); }} placeholder={wish.price ? money(wish.price) : '$'} /></Field>
          {bad && <p className="pl-error" role="alert">That doesn’t look like a number. Try 129.99, or leave it empty.</p>}
          {changed && <Button primary block disabled={busy} onClick={() => { if (parsePrice(paid) === null) setBad(true); else onNote(note, paid); }}>Save the note</Button>}
          {got.givenAt ? (
            <>
              <p className="pl-muted wish-quiet"><Gift aria-hidden /> It shows on their list now, under Received.</p>
              <Button block ghost disabled={busy} onClick={onNotGiven}>Not given yet</Button>
            </>
          ) : (
            <>
              <Button block disabled={busy} onClick={() => { if (!sure) { setSure(true); return; } onGiven(); }}><Gift size={16} /> {sure ? 'Tap again: they’ll see it now' : 'It’s been given'}</Button>
              <Button block ghost disabled={busy} onClick={onUndo}>{wish.removedAt ? 'Clear it away' : 'Not any more'}</Button>
              <p className="pl-muted wish-quiet"><EyeOff aria-hidden /> Still a secret. Nothing shows on their side until you say it’s been given.</p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** A gift you've received: what it was, who it's from, and a way to clear it off your list. */
export function ReceivedWish({ row, busy, onClose, onRemove }: { row: Received | null; busy: boolean; onClose: () => void; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { setSure(false); }, [row?.wish.id]);
  if (!row) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  return (
    <Sheet open onClose={onClose}>
      <h2 className="wish-title">{row.wish.what}</h2>
      <p className="wish-gotline"><Gift aria-hidden /> From {firstName(row.from)}{dayWords(row.at) ? `, ${dayWords(row.at)}` : ''}.</p>
      <WishFacts wish={row.wish} />
      <Button block ghost danger disabled={busy} onClick={() => { if (!sure) { setSure(true); return; } onRemove(); }}><Trash2 size={16} /> {sure ? 'Tap again to take it off' : 'Take it off my list'}</Button>
    </Sheet>
  );
}
