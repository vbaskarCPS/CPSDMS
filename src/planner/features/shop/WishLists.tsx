// src/planner/features/shop/WishLists.tsx — /shop, the Wish lists side: a list each, with a secret "got it".
// "Mine" is your own wishes: add one (typed, or from a screenshot that's read to fill the form in), change it, take it
// off. The other list is theirs: you see what they'd love, what it comes to and what's still to get, and you can
// quietly mark a wish as got (with a note only you see). They don't see that. Only "It's been given" shows on their
// side, under Received.
//
// The secret is kept by how this screen is built, not by a lock (wish.ts explains): everything on "Mine" comes from
// myList(), which never looks at a mark that hasn't been given. Nothing on that side may read the marks any other way.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ClipboardPaste, ExternalLink, EyeOff, Gift, ImagePlus, Loader2, Lock, Plus } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Button, Card, Empty, Header, Page, Segmented, uid, useToast } from '../../ui/primitives';
import { canReadClipboard, clipboardImages, imagesFrom } from '../arvy/pics';
import { otherName } from '../us/us';
import { draftOf, emptyDraft, firstName, given, gotIt, gotWithNote, linkSite, money, myList, notGiven, safeLink, theirList, theirName, wishLine, type GotRow, type Wish, type WishBook, type WishGot } from './wish';
import { clearGot, loadWishBook, removeWish, saveGot } from './wishStore';
import { keepPicture, readShot, type KeptPic } from './wishPics';
import { Hearts, ReceivedWish, TheirWish, WishForm, dayWords, type FormStart } from './WishSheets';
import './wish.css';

const NOT_SAVED = 'That didn’t save. Check your connection and try again.';

/** One wish in a list: its picture, what it is, the price and where from, how much it's wanted. A tap opens it.
 *  `status` is an extra line (got, given, from whom); `children` are its buttons. */
function WishRow({ wish, onOpen, status, children }: { wish: Wish; onOpen: () => void; status?: ReactNode; children?: ReactNode }) {
  const link = safeLink(wish.link), line = wishLine(wish);
  return (
    <div className="wish">
      <button type="button" className="wish__open" onClick={onOpen}>
        {wish.pics[0] ? <img className="wish__pic" src={wish.pics[0].thumb} alt="" /> : <span className="wish__pic wish__pic--none" aria-hidden><Gift /></span>}
        <span className="wish__main">
          <b>{wish.what}</b>
          {line && <small>{line}</small>}
          {wish.note && <small className="wish__note">{wish.note}</small>}
          {status}
        </span>
        <Hearts n={wish.hearts} />
      </button>
      {(children || link) && (
        <div className="wish__acts">
          {children}
          {link && <a className="wish__link" href={link} target="_blank" rel="noopener noreferrer"><span>{linkSite(link)}</span> <ExternalLink aria-hidden /></a>}
        </div>
      )}
    </div>
  );
}

export function WishLists({ pass, top }: { pass: PlannerPass; top?: ReactNode }) {
  const me = pass.user.username;
  const [book, setBook] = useState<WishBook | null>(null);
  const [failed, setFailed] = useState(false);
  const [whose, setWhose] = useState<'mine' | 'theirs'>('mine');
  const [form, setForm] = useState<FormStart | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);     // one of theirs, or a gift I've received, opened
  const [reading, setReading] = useState<string | null>(null);   // the preview of the screenshot being read
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState<string | null>(null);         // the wish whose "It's been given" was tapped once
  const [toast, say] = useToast();

  // every change made on this screen counts up: a fetch that set off before one is thrown away, not drawn over it
  const edits = useRef(0);
  const load = useCallback(() => { const at = edits.current; return loadWishBook().then(b => { if (edits.current === at) setBook(b); setFailed(false); }).catch(() => setFailed(true)); }, []);
  // fresh when the screen opens and whenever the planner comes back to the front (the other one may have added a wish)
  useEffect(() => {
    void load();
    const wake = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [load]);
  useEffect(() => { if (!sure) return; const t = window.setTimeout(() => setSure(null), 5000); return () => window.clearTimeout(t); }, [sure]);

  const name = theirName(otherName(me), book || { wishes: [], gots: {} }, me);
  const mine = useMemo(() => (book ? myList(book, me) : null), [book, me]);
  const theirs = useMemo(() => (book ? theirList(book, me) : null), [book, me]);
  const change = (fn: (b: WishBook) => WishBook) => { edits.current++; setBook(b => (b ? fn(b) : b)); };
  const setGot = (g: WishGot) => change(b => ({ ...b, gots: { ...b.gots, [g.wish]: g } }));
  const dropWish = (id: string) => change(b => ({ wishes: b.wishes.filter(w => w.id !== id), gots: Object.fromEntries(Object.entries(b.gots).filter(([k]) => k !== id)) }));

  // ── my own wishes ──
  const working = useRef(false);   // a screenshot is being made ready or read: a second one waits its turn
  const openNew = () => setForm({ key: uid(), draft: emptyDraft(), pics: [] });
  /** A screenshot (picked or pasted): kept with the wish, and read to fill the form in. The form always opens, so
   *  the person checks it; when nothing could be read it has just the picture. */
  async function fromShot(file: File) {
    if (working.current || form) return;
    working.current = true;
    try {
      let pic: KeptPic;
      try { pic = await keepPicture(file, uid()); } catch { say('Couldn’t open that picture. Try another.', 'bad'); return; }
      setReading(pic.thumb);
      const fill = await readShot(file);
      setForm({ key: uid(), draft: { ...emptyDraft(), ...fill }, pics: [pic], hint: Object.keys(fill).length ? 'Filled in from your screenshot. Have a look before you add it.' : 'Nothing could be read off that one, so here’s the picture; the rest is yours to fill in.' });
    } finally { working.current = false; setReading(null); }
  }
  const shot = useRef(fromShot); shot.current = fromShot;
  async function pasteCopied() {
    try { const files = await clipboardImages(); if (files.length) void fromShot(files[0]); else say('No picture copied yet. Copy one first, then tap Paste.'); }
    catch { say('The planner can’t get at what you copied. Choose the picture instead.', 'bad'); }
  }
  async function removeReceived(w: Wish) {
    setBusy(true);
    try { await removeWish(w); dropWish(w.id); setOpenId(null); say('Taken off your list', 'good'); }
    catch { say('That didn’t go through. Check your connection and try again.', 'bad'); }
    finally { setBusy(false); }
  }

  // ── their wishes: the quiet part ──
  /** Save a mark (or take it away), showing it straight away; if it doesn't save, the lists are fetched again. */
  async function mark(next: WishGot | null, w: Wish, done: string): Promise<boolean> {
    setBusy(true); setSure(null);
    if (next) setGot(next);
    else if (w.removedAt) dropWish(w.id);
    else change(b => ({ ...b, gots: Object.fromEntries(Object.entries(b.gots).filter(([k]) => k !== w.id)) }));
    try { await (next ? saveGot(next) : clearGot(w)); say(done, 'good'); return true; }
    catch { say(NOT_SAVED, 'bad'); void load(); return false; }
    finally { setBusy(false); }
  }
  const now = () => new Date().toISOString();
  const gotThis = (w: Wish) => void mark(gotIt(w.id, me, now()), w, 'Got it. Only you can see that.');
  const notAnyMore = (r: GotRow) => { if (r.wish.removedAt) setOpenId(null); void mark(null, r.wish, r.wish.removedAt ? 'Cleared away' : 'Back on the list to get'); };
  const giveIt = (r: GotRow) => { if (sure !== r.wish.id) { setSure(r.wish.id); return; } void mark(given(r.got, now()), r.wish, 'Lovely. It shows as received now.'); };

  const openTheirs = whose === 'theirs' && theirs && openId ? { wish: theirs.toGet.find(w => w.id === openId) || theirs.got.find(r => r.wish.id === openId)?.wish || null, got: theirs.got.find(r => r.wish.id === openId)?.got || null } : null;
  const openReceived = whose === 'mine' && mine && openId ? mine.received.find(r => r.wish.id === openId) || null : null;
  const idle = whose === 'mine' && !form && !openReceived;   // my list with nothing open over it
  // a picture pasted onto the page starts a wish from it (the open form takes its own pastes)
  useEffect(() => {
    if (!idle) return;
    const onPaste = (e: ClipboardEvent) => { const files = imagesFrom(e.clipboardData); if (files.length) { e.preventDefault(); void shot.current(files[0]); } };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [idle]);

  return (
    <Page>
      <Header back="/" eyebrow="Vijay & Rosh" title="Wish lists" />
      {top}
      <div className="wish-switch"><Segmented value={whose} onChange={v => { setWhose(v); setOpenId(null); setSure(null); void load(); }} options={[{ value: 'mine', label: 'Mine' }, { value: 'theirs', label: `${name}’s` }]} /></div>

      {!mine || !theirs ? (failed
        ? <Card className="pl-stack"><p className="pl-muted">The wish lists didn’t load. Check your connection.</p><Button onClick={() => { setFailed(false); void load(); }}>Try again</Button></Card>
        : <p className="pl-muted">Loading…</p>
      ) : whose === 'mine' ? (
        <>
          <div className="wish-add">
            <Button primary block onClick={openNew}><Plus size={18} /> Add a wish</Button>
            <div className="pl-row" style={{ gap: 8 }}>
              <label className="pl-btn pl-grow wish-pick">
                <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromShot(f); }} />
                <ImagePlus size={18} aria-hidden /> Add from a screenshot
              </label>
              {canReadClipboard() && <Button onClick={() => void pasteCopied()}><ClipboardPaste size={18} aria-hidden /> Paste</Button>}
            </div>
          </div>
          {reading && (
            <div className="pl-card wish-reading" aria-live="polite">
              <img src={reading} alt="" />
              <div><b>Reading your screenshot…</b><small className="pl-muted">A few seconds. You’ll check it before it’s added.</small></div>
              <Loader2 className="pl-spin" aria-hidden />
            </div>
          )}
          {mine.wishes.length === 0 ? (
            <Card>{mine.received.length
              ? <p className="pl-muted">Nothing on your list right now. Seen something you’d love? Add it.</p>
              : <Empty icon={<Gift />} title="Start your wish list" blurb={`Add the things you’d love, with the price, where it’s from and a screenshot if you have one. ${name} can see your list, so a gift is never a guess: at Christmas, or any other time.`} />}</Card>
          ) : (
            <Card className="wish-group">
              {mine.wishes.map(w => <WishRow key={w.id} wish={w} onOpen={() => setForm({ key: w.id, wish: w, draft: draftOf(w), pics: [] })} />)}
            </Card>
          )}
          {mine.received.length > 0 && (
            <Card className="wish-group">
              <h3>Received</h3>
              {mine.received.map(r => <WishRow key={r.wish.id} wish={r.wish} onOpen={() => setOpenId(r.wish.id)} status={<small className="wish__got"><Gift aria-hidden /> From {firstName(r.from)}{dayWords(r.at) ? ` · ${dayWords(r.at)}` : ''}</small>} />)}
            </Card>
          )}
          {mine.wishes.length > 0 && <p className="pl-muted wish-foot">{name} can see this list. What’s already been got for you stays a surprise.</p>}
        </>
      ) : theirs.toGet.length + theirs.got.length === 0 ? (
        <Card><Empty icon={<Gift />} title="No wishes here yet" blurb={`${name} hasn’t added anything yet. When there’s a wish you’ll see it here with its price, and you can quietly mark what you’ve got. That part stays between you and your planner.`} /></Card>
      ) : (
        <>
          <Card className="pl-stack wish-sum">
            <p className="wish-sum__row"><span>Everything on the list comes to</span><b>{theirs.totals.all ? money(theirs.totals.all) : '–'}</b></p>
            <p className="wish-sum__row"><span>Still to get</span><b>{theirs.totals.toGet ? money(theirs.totals.toGet) : theirs.toGet.length ? '–' : '$0'}</b></p>
            {theirs.totals.allNoPrice > 0 && <p className="pl-muted wish-sum__note">{theirs.totals.allNoPrice === 1 ? 'One wish has no price, so it isn’t counted.' : `${theirs.totals.allNoPrice} wishes have no price, so they aren’t counted.`}</p>}
            <p className="pl-muted wish-quiet"><EyeOff aria-hidden /> What you mark as got shows only here. Their own list doesn’t change until you say it’s been given.</p>
          </Card>
          <Card className="wish-group">
            <h3>Still to get</h3>
            {theirs.toGet.length === 0 && <p className="pl-muted wish-none">That’s everything on the list. Nothing left to get.</p>}
            {theirs.toGet.map(w => (
              <WishRow key={w.id} wish={w} onOpen={() => setOpenId(w.id)}>
                <Button small primary disabled={busy} onClick={() => gotThis(w)}><Check size={16} /> I’ve got it</Button>
              </WishRow>
            ))}
          </Card>
          {theirs.got.length > 0 && (
            <Card className="wish-group">
              <div className="wish-group__head"><h3>Got</h3>{(theirs.totals.spent > 0 || theirs.totals.spentNoPrice > 0) && <span>{theirs.totals.spent > 0 ? `${money(theirs.totals.spent)} spent` : ''}{theirs.totals.spentNoPrice ? `${theirs.totals.spent > 0 ? ' · ' : ''}${theirs.totals.spentNoPrice} with no price` : ''}</span>}</div>
              {theirs.got.map(r => (
                <WishRow key={r.wish.id} wish={r.wish} onOpen={() => setOpenId(r.wish.id)} status={<>
                  <small className="wish__got"><Check aria-hidden /> Got {dayWords(r.got.at)}{r.got.givenAt ? ` · given ${dayWords(r.got.givenAt)}` : ''}</small>
                  {(r.got.note || r.got.paid) && <small className="wish__private"><Lock aria-hidden /> {[r.got.note, r.got.paid ? `paid ${money(r.got.paid)}` : ''].filter(Boolean).join(' · ')}</small>}
                  {r.wish.removedAt && <small className="wish__gone">Taken off the list since</small>}
                </>}>
                  {!r.got.givenAt && <Button small disabled={busy} onClick={() => giveIt(r)}><Gift size={16} /> {sure === r.wish.id ? 'Tap again: they’ll see it' : 'It’s been given'}</Button>}
                  {!r.got.givenAt && <Button small ghost disabled={busy} onClick={() => notAnyMore(r)}>{r.wish.removedAt ? 'Clear it away' : 'Not any more'}</Button>}
                </WishRow>
              ))}
            </Card>
          )}
        </>
      )}

      {form && <WishForm key={form.key} start={form} me={me} onClose={() => setForm(null)}
        onSaved={(w, isNew) => { change(b => ({ ...b, wishes: [...b.wishes.filter(x => x.id !== w.id), w] })); setForm(null); say(isNew ? 'On your list' : 'Saved', 'good'); }}
        onRemoved={w => { dropWish(w.id); setForm(null); say('Taken off your list', 'good'); }} />}
      <TheirWish wish={openTheirs?.wish || null} got={openTheirs?.got || null} busy={busy} onClose={() => setOpenId(null)}
        onGot={() => { if (openTheirs?.wish) gotThis(openTheirs.wish); }}
        onUndo={() => { if (openTheirs?.wish && openTheirs.got) notAnyMore({ wish: openTheirs.wish, got: openTheirs.got }); }}
        onNote={(note, paid) => { const next = openTheirs?.wish && openTheirs.got ? gotWithNote(openTheirs.got, note, paid) : null; if (next && openTheirs?.wish) void mark(next, openTheirs.wish, 'Note saved'); }}
        onGiven={() => { if (openTheirs?.wish && openTheirs.got) void mark(given(openTheirs.got, now()), openTheirs.wish, 'Lovely. It shows as received now.'); }}
        onNotGiven={() => { if (openTheirs?.wish && openTheirs.got) void mark(notGiven(openTheirs.got), openTheirs.wish, 'A secret again'); }} />
      <ReceivedWish row={openReceived} busy={busy} onClose={() => setOpenId(null)} onRemove={() => { if (openReceived) void removeReceived(openReceived.wish); }} />
      {toast}
    </Page>
  );
}
