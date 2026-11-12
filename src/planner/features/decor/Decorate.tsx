// src/planner/features/decor/Decorate.tsx — decorating a page: the page is shown as usual, but every touch goes to the
// stickers. A tray of the library slides up over the bottom bar (the groups across its top, "Mine" for the person's
// own pictures); tap a sticker there and it lands in the middle of what is on the screen. On the page: drag a sticker
// to move it; the chosen one shows a frame with a handle on each corner (drag to resize) and one below (drag to turn);
// a second finger put down while one holds a sticker pinches and twists it. The tray's buttons step it forward or
// back among the stickers it overlaps, copy it, tuck it behind the page's cards, and take it off. Done ends it.
//
// Scrolling while decorating: a finger on a sticker or a handle moves that sticker and never scrolls (touch-action:
// none on those); a finger anywhere else scrolls the page up and down as usual (touch-action: pan-y on the rest), and
// a tap there lets go of the chosen sticker. A sticker dragged near the top of the screen or the top of the tray
// scrolls the page under it, so it can be carried further than one screen. The bottom bar is hidden for as long as
// this is open, so its own drags (RV, Health, Wealth) can't start.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, Layers, Plus, RotateCw, Trash2, Undo2, X } from 'lucide-react';
import { GROUPS, artOf, inGroup, srcOf, type GroupId } from './library';
import {
  MAX_ON_PAGE, OWN_MAX, canRestack, change, copy, edgeScroll, layers, middle, mineArt, mineKey, newId, overlap, pinch, place, placeAt, remove, restack,
  sectionById, sizeFromDrag, tuck, turnFromDrag, type Placed, type Point, type SectionId,
} from './decor';
import { addOwn, flushPage, loadAllOwn, loadOwn, loadPage, ownGone, ownList, pageFailed, pageLoaded, removeOwn, setPage } from './store';
import { measure, pictureOf, spot, type Host } from './parts';
import { shrinkPicture } from './picture';

/** A touch that moves less than this (px) is a tap, not a drag. */
const SLOP = 4;
/** The frame around the chosen sticker stands this far off it, and is never smaller than a fingertip can work. */
const FRAME_GROW = 12, FRAME_LEAST = 56;

type Gesture =
  | { kind: 'move'; id: string; pid: number; grab: Point; from: Point; last: Point; moved: boolean }
  | { kind: 'size'; id: string; pid: number; mid: Point; from: Point; s0: number; moved: boolean }
  | { kind: 'turn'; id: string; pid: number; mid: Point; from: Point; r0: number; moved: boolean }
  | { kind: 'pinch'; id: string; a: number; b: number; a0: Point; b0: Point; was: { s: number; r: number; at: Point } }
  | { kind: 'tap'; pid: number; from: Point };

export function Decorate({ section, items, host }: { section: SectionId; items: Placed[]; host: Host }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const name = sectionById(section)?.name || 'this page';
  const loaded = pageLoaded(section);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<GroupId | 'mine'>('woodland');
  const [small, setSmall] = useState(false);          // the tray folded down to its top row, to see more of the page
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'adding' | 'saving' | null>(null);
  const [, redraw] = useState(0);
  const past = useRef<Placed[][]>([]);                // what the page held before each change, for Undo
  const live = useRef(items); live.current = items;
  const g = useRef<Gesture | null>(null);
  const fingers = useRef(new Map<number, Point>());   // every finger down on the page, where it is on the screen
  const tray = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const triedDone = useRef(false);
  const chosen = items.find(p => p.id === sel) || null;

  const shapeOf = useCallback((art: string) => pictureOf(art)?.shape || { w: 1, h: 1 }, []);
  const say = (msg: string) => { setNote(msg); window.setTimeout(() => setNote(n => (n === msg ? null : n)), 4000); };
  const apply = useCallback((next: Placed[]) => setPage(section, next), [section]);
  /** Remember the page as it is, before changing it. */
  const remember = useCallback(() => { past.current.push(live.current); if (past.current.length > 50) past.current.shift(); redraw(n => n + 1); }, []);
  const undo = () => { const was = past.current.pop(); if (!was) return; apply(was); if (sel && !was.some(p => p.id === sel)) setSel(null); redraw(n => n + 1); };

  // the bottom bar goes and the page gets room to scroll clear of the tray, for as long as this is open
  useEffect(() => {
    document.body.classList.add('dk-on');
    return () => { document.body.classList.remove('dk-on'); document.body.style.removeProperty('--dk-tray'); };
  }, []);
  useLayoutEffect(() => {
    const el = tray.current;
    if (!el) return;
    const fit = () => document.body.style.setProperty('--dk-tray', `${Math.round(el.getBoundingClientRect().height)}px`);
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the page's stickers haven't arrived (no connection): keep asking; nothing is put on a page that couldn't be read
  useEffect(() => {
    if (loaded) return;
    const id = window.setInterval(() => { void loadPage(section); }, 4000);
    return () => window.clearInterval(id);
  }, [loaded, section]);
  // leaving (Done, the back button, another page): save what is waiting
  useEffect(() => () => { void flushPage(section); }, [section]);
  // stickers that can't be drawn any more (an own picture that was deleted, a drawing gone from the library) come off
  useEffect(() => {
    if (!loaded) return;
    void loadOwn(items).then(() => {
      const keep = live.current.filter(p => { const k = mineKey(p.art); return k ? !ownGone(k) : !!artOf(p.art); });
      if (keep.length !== live.current.length) apply(keep);
    });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'mine') void loadAllOwn(); }, [tab]);

  // ── touches on the page ──
  /** A point on the screen as a point on the page's content (px from its top left). */
  const onPage = (pt: Point): Point => { const m = measure(host.main); return { x: pt.x - m.left, y: pt.y - m.top }; };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const at = { x: e.clientX, y: e.clientY }, t = e.target as HTMLElement;
    // a mouse can't press twice: a drag still open here lost its ending (the window lost the mouse), so it is over
    if (g.current && e.pointerType === 'mouse') { g.current = null; fingers.current.clear(); }
    const cur = g.current;
    fingers.current.set(e.pointerId, at);
    // a second finger while one holds a sticker: pinch and twist it
    if (cur && (cur.kind === 'move' || cur.kind === 'pinch')) {
      if (cur.kind === 'pinch') return;
      const p = live.current.find(q => q.id === cur.id), a0 = fingers.current.get(cur.pid);
      if (!p || !a0) return;
      e.preventDefault();
      const m = measure(host.main);
      if (!cur.moved) remember();
      g.current = { kind: 'pinch', id: cur.id, a: cur.pid, b: e.pointerId, a0: onPage(a0), b0: onPage(at), was: { s: p.s, r: p.r, at: middle(p, m.width, m.floor) } };
      return;
    }
    if (cur) return;
    const handle = t.closest<HTMLElement>('[data-handle]'), grip = t.closest<HTMLElement>('[data-id]');
    if (handle && chosen) {
      e.preventDefault();
      const m = measure(host.main), mid = middle(chosen, m.width, m.floor), from = onPage(at);
      g.current = handle.dataset.handle === 'turn' ? { kind: 'turn', id: chosen.id, pid: e.pointerId, mid, from, r0: chosen.r, moved: false } : { kind: 'size', id: chosen.id, pid: e.pointerId, mid, from, s0: chosen.s, moved: false };
    } else if (grip?.dataset.id) {
      const p = live.current.find(q => q.id === grip.dataset.id);
      if (!p) return;
      const m = measure(host.main), mid = middle(p, m.width, m.floor), from = onPage(at);
      setSel(p.id);
      g.current = { kind: 'move', id: p.id, pid: e.pointerId, grab: { x: from.x - mid.x, y: from.y - mid.y }, from: at, last: at, moved: false };
    } else g.current = { kind: 'tap', pid: e.pointerId, from: at };
  };
  /** The sticker being dragged follows the finger (called on every move, and while the page scrolls under it). */
  const carry = useCallback((cur: Extract<Gesture, { kind: 'move' }>) => {
    const m = measure(host.main), pt = { x: cur.last.x - m.left - cur.grab.x, y: cur.last.y - m.top - cur.grab.y };
    apply(change(live.current, cur.id, placeAt(pt, m.width), m.floor));
  }, [apply, host.main]);
  useEffect(() => {
    let frame = 0;
    const move = (e: PointerEvent) => {
      const cur = g.current, at = { x: e.clientX, y: e.clientY };
      if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, at);
      if (!cur) return;
      if (cur.kind === 'pinch') {
        const a = fingers.current.get(cur.a), b = fingers.current.get(cur.b);
        if (!a || !b || (e.pointerId !== cur.a && e.pointerId !== cur.b)) return;
        const m = measure(host.main), now = pinch(cur.was, cur.a0, cur.b0, { x: a.x - m.left, y: a.y - m.top }, { x: b.x - m.left, y: b.y - m.top });
        apply(change(live.current, cur.id, { ...placeAt(now.at, m.width), s: now.s, r: now.r }, m.floor));
        return;
      }
      if (e.pointerId !== cur.pid) return;
      if (cur.kind === 'tap') return;
      if (cur.kind === 'move') {
        if (!cur.moved && Math.hypot(at.x - cur.from.x, at.y - cur.from.y) < SLOP) return;
        if (!cur.moved) { cur.moved = true; remember(); }
        cur.last = at;
        carry(cur);
        return;
      }
      const pt = onPage(at);
      if (!cur.moved) { if (Math.hypot(pt.x - cur.from.x, pt.y - cur.from.y) < SLOP) return; cur.moved = true; remember(); }
      apply(change(live.current, cur.id, cur.kind === 'size' ? { s: sizeFromDrag(cur.s0, cur.mid, cur.from, pt) } : { r: turnFromDrag(cur.r0, cur.mid, cur.from, pt) }));
    };
    const up = (e: PointerEvent) => {
      const cur = g.current;
      fingers.current.delete(e.pointerId);
      if (!cur) return;
      if (cur.kind === 'pinch') {
        if (e.pointerId !== cur.a && e.pointerId !== cur.b) return;
        // one finger lifted: the other carries on moving the sticker from where it is now
        const stay = e.pointerId === cur.a ? cur.b : cur.a, at = fingers.current.get(stay), p = live.current.find(q => q.id === cur.id);
        if (!at || !p) { g.current = null; return; }
        const m = measure(host.main), mid = middle(p, m.width, m.floor);
        g.current = { kind: 'move', id: cur.id, pid: stay, grab: { x: at.x - m.left - mid.x, y: at.y - m.top - mid.y }, from: at, last: at, moved: true };
        return;
      }
      if (e.pointerId !== cur.pid) return;
      g.current = null;
      if (cur.kind === 'tap' && e.type === 'pointerup' && Math.hypot(e.clientX - cur.from.x, e.clientY - cur.from.y) < SLOP * 2) setSel(null);   // a tap on the page lets go of the sticker
    };
    // a sticker held near the top of the screen or the top of the tray: the page scrolls under it
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const cur = g.current;
      if (!cur || cur.kind !== 'move' || !cur.moved) return;
      const by = edgeScroll(cur.last.y, 0, tray.current?.getBoundingClientRect().top ?? window.innerHeight);
      if (!by) return;
      const before = window.scrollY;
      window.scrollBy(0, by);
      if (window.scrollY !== before) carry(cur);
    };
    // the planner went to the background mid-drag: whatever was being dragged is let go where it is
    const drop = () => { g.current = null; fingers.current.clear(); };
    // a press outside the page and the tray (the empty sides of a wide window) lets go of the chosen sticker too
    const outside = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.dk-stage, .dk-tray')) setSel(null); };
    frame = requestAnimationFrame(tick);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('blur', drop);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', drop); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [apply, carry, host.main, remember]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the tray's buttons ──
  const pageWidth = measure(host.main).width;   // read once for this drawing: "what overlaps what" is asked many times
  const overlaps = (a: Placed, b: Placed) => overlap(a, b, shapeOf, pageWidth);
  const step = (dir: 'forward' | 'back') => { if (!sel) return; const next = restack(items, sel, dir, overlaps); if (next !== items) { remember(); apply(next); } };
  const addCopy = () => {
    if (!sel) return;
    const m = measure(host.main), id = newId(), next = copy(items, sel, m.width, id, m.floor);
    if (!next) { say(`A page holds ${MAX_ON_PAGE} stickers. Take one off to add another.`); return; }
    remember(); apply(next); setSel(id);
  };
  const takeOff = () => { if (!sel) return; remember(); apply(remove(items, sel)); setSel(null); };
  const tuckIt = () => { if (!sel) return; remember(); apply(tuck(items, sel)); };
  const takeAllOff = () => { if (!items.length) return; remember(); apply([]); setSel(null); };
  /** A sticker from the tray lands in the middle of what can be seen of the page, on top. */
  const add = (art: string, size: number) => {
    if (!loaded) return;
    const m = measure(host.main), top = tray.current?.getBoundingClientRect().top ?? window.innerHeight, n = items.length;
    // a little off the last one, so three in a row don't hide each other
    const at = placeAt({ x: m.width / 2 + ((n % 5) - 2) * 16, y: top / 2 - m.top + ((n % 3) - 1) * 14 }, m.width);
    const id = newId(), next = place(items, art, at, size, id, m.floor);
    if (!next) { say(`A page holds ${MAX_ON_PAGE} stickers. Take one off to add another.`); return; }
    remember(); apply(next); setSel(id);
  };
  const key = (e: ReactKeyboardEvent, p: Placed) => {
    const by = e.shiftKey ? 10 : 2, m = measure(host.main), mid = middle(p, m.width, m.floor);
    const to = e.key === 'ArrowLeft' ? { x: mid.x - by, y: mid.y } : e.key === 'ArrowRight' ? { x: mid.x + by, y: mid.y } : e.key === 'ArrowUp' ? { x: mid.x, y: mid.y - by } : e.key === 'ArrowDown' ? { x: mid.x, y: mid.y + by } : null;
    if (to) { e.preventDefault(); remember(); apply(change(items, p.id, placeAt(to, m.width), m.floor)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remember(); apply(remove(items, p.id)); setSel(null); }
    else if (e.key === 'Escape') setSel(null);
  };
  const done = async () => {
    setBusy('saving');
    const ok = await flushPage(section);
    setBusy(null);
    // no connection: say so once; a second tap leaves anyway (the stickers are kept and saved when the connection is back)
    if (!ok && !triedDone.current) { triedDone.current = true; say('Couldn’t save just now. Check your connection, then tap Done again.'); return; }
    nav(pathname, { replace: true });
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy('adding');
    try { await addOwn(await shrinkPicture(file)); }
    catch (x) { say(x instanceof Error && x.message === 'full' ? `You can keep ${OWN_MAX} of your own. Delete one to add another.` : x instanceof Error && x.message === 'not a picture' ? 'That file isn’t a picture.' : 'Couldn’t save that picture. Try again.'); }
    finally { setBusy(null); }
  };
  const deleteOwn = async (k: string) => {
    if (!window.confirm('Delete this sticker of yours? It comes off every page it is on.')) return;
    try { await removeOwn(k); const keep = live.current.filter(p => mineKey(p.art) !== k); if (keep.length !== live.current.length) apply(keep); }
    catch { say('Couldn’t delete it. Try again.'); }
  };

  const { under, over } = layers(items);
  const grip = (p: Placed) => {
    const pic = pictureOf(p.art);
    if (!pic) return null;
    return (
      <button key={p.id} type="button" data-id={p.id} className={`dk-at dk-grip${p.under ? ' is-under' : ''}${p.id === sel ? ' is-on' : ''}`} style={spot(p, pic.shape)}
        aria-label={`${pic.name} sticker${p.under ? ', behind the cards' : ''}`} aria-pressed={p.id === sel} onFocus={() => setSel(p.id)} onKeyDown={e => key(e, p)}>
        {/* a sticker tucked behind the cards is drawn under them by the page's lower sheet; here, a faint copy to grab it by */}
        <img src={pic.src} alt="" draggable={false} />
      </button>
    );
  };
  const chosenPic = chosen ? pictureOf(chosen.art) : null;
  const mine = ownList();
  const full = items.length >= MAX_ON_PAGE;
  return (
    <>
      {createPortal(
        <div className="dk-stage" onPointerDown={down} onContextMenu={e => e.preventDefault()}>
          {under.map(grip)}
          {over.map(grip)}
          {chosen && chosenPic && (
            <div className="dk-at dk-frame" style={spot(chosen, chosenPic.shape, FRAME_GROW, FRAME_LEAST)}>
              {(['nw', 'ne', 'se', 'sw'] as const).map(c => <i key={c} className={`dk-handle dk-handle--${c}`} data-handle="size" />)}
              <i className="dk-handle dk-handle--turn" data-handle="turn"><RotateCw aria-hidden /></i>
            </div>)}
        </div>, host.over)}
      <section className={`dk-tray${small ? ' is-small' : ''}`} ref={tray} aria-label={`Decorating ${name}`}>
        <header className="dk-tray__head">
          <button type="button" className="dk-icon" onClick={undo} disabled={!past.current.length} aria-label="Undo"><Undo2 aria-hidden /></button>
          <div className="dk-tray__title"><b>{name}</b><small>{loaded ? `${items.length} of ${MAX_ON_PAGE} stickers` : 'Loading…'}</small></div>
          <button type="button" className="dk-icon" onClick={() => setSmall(s => !s)} aria-label={small ? 'Show the stickers' : 'Hide the stickers'} aria-expanded={!small}>{small ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}</button>
          <button type="button" className="pl-btn pl-btn--primary dk-done" onClick={() => void done()} disabled={busy === 'saving'}>{busy === 'saving' ? 'Saving…' : 'Done'}</button>
        </header>
        {(note || pageFailed(section)) && <p className="dk-note" role="status">{note || 'Not saved yet: no connection.'}</p>}
        {chosen ? (
          <div className="dk-acts" role="toolbar" aria-label="The chosen sticker">
            <button type="button" onClick={() => step('forward')} disabled={!canRestack(items, chosen.id, 'forward', overlaps)}><ArrowUpToLine aria-hidden />Forward</button>
            <button type="button" onClick={() => step('back')} disabled={!canRestack(items, chosen.id, 'back', overlaps)}><ArrowDownToLine aria-hidden />Back</button>
            <button type="button" onClick={addCopy} disabled={full}><Copy aria-hidden />Copy</button>
            <button type="button" onClick={tuckIt} aria-pressed={!!chosen.under}><Layers aria-hidden />{chosen.under ? 'Bring out' : 'Tuck behind'}</button>
            <button type="button" className="is-bad" onClick={takeOff}><Trash2 aria-hidden />Remove</button>
          </div>
        ) : !small && (
          <p className="dk-hint">{items.length ? 'Drag a sticker to move it. Tap one for more.' : 'Tap a sticker to put it on the page.'}{items.length > 1 && <button type="button" onClick={takeAllOff}>Take all off</button>}</p>
        )}
        {!small && <>
          <div className="dk-tabs" role="tablist" aria-label="Sticker groups">
            <button type="button" role="tab" aria-selected={tab === 'mine'} className={`pl-chip${tab === 'mine' ? ' is-on' : ''}`} onClick={() => setTab('mine')}>Mine</button>
            {GROUPS.map(gr => <button key={gr.id} type="button" role="tab" aria-selected={tab === gr.id} className={`pl-chip${tab === gr.id ? ' is-on' : ''}`} onClick={() => setTab(gr.id)}>{gr.name}</button>)}
          </div>
          <div className="dk-grid" role="tabpanel">
            {tab === 'mine' ? <>
              <button type="button" className="dk-cell dk-cell--add" onClick={() => picker.current?.click()} disabled={busy === 'adding'}><Plus aria-hidden /><span>{busy === 'adding' ? 'Adding…' : 'Add your own'}</span></button>
              {mine.map(({ key: k, pic }) => (
                <span key={k} className="dk-cell dk-cell--mine">
                  <button type="button" className="dk-cell__pick" onClick={() => add(mineArt(k), 96)} disabled={full} aria-label="Put my sticker on the page"><img src={pic.url} alt="" draggable={false} /></button>
                  <button type="button" className="dk-cell__x" onClick={() => void deleteOwn(k)} aria-label="Delete my sticker"><X aria-hidden /></button>
                </span>))}
              {!mine.length && <p className="dk-mine-hint">Pick a picture from your phone. A PNG with a see-through background makes the best sticker.</p>}
            </> : inGroup(tab).map(s => (
              <button key={s.id} type="button" className={`dk-cell${s.w > s.h * 1.8 ? ' is-wide' : ''}`} onClick={() => add(s.id, s.size)} disabled={full} title={s.name} aria-label={`${s.name}: put it on the page`}>
                <img src={srcOf(s)} alt="" draggable={false} loading="lazy" />
              </button>))}
          </div>
        </>}
        <input ref={picker} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void pick(file); }} />
      </section>
    </>
  );
}
