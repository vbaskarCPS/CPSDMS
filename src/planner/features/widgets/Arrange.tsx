// src/planner/features/widgets/Arrange.tsx — /settings/widgets, "Arrange Today": the list of what's on the Today page,
// top to bottom. Drag a row by its handle, or use its arrows (easier to be exact on a phone); switch one of the
// planner's blocks off or back on; pick a size where there are two; add a countdown, a note, the mini calendar or the
// habit tracker, and take them off again. "Put it back as it was" restores the original page. Every change shows on
// Today straight away and is saved by store.ts. The day's plan can't be switched off: the whole planner runs on it.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, GripVertical, Hourglass, LayoutGrid, Lock, Pencil, Plus, Repeat, RotateCcw, StickyNote, Trash2, type LucideIcon } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { profileOf } from '../../lib/app';
import { calendarKey, getDocs } from '../../lib/docs';
import { useDocs } from '../../lib/useDoc';
import { Button, Field, Header, Input, Page, Sheet, useToast } from '../../ui/primitives';
import { birthdaysFrom, upcoming, type Birthday } from '../us/occasions';
import { dayWords } from './Countdown';
import { dropNote, NOTE_KIND, useWidgets } from './store';
import { add, ADDED, arrange, canAdd, change, countdownView, isAsItWas, isDay, move, moveTo, newId, PAPERS, putBack, remove, setOn, setSize, TITLE_MAX, type AddedKind, type Countdown, type Item, type Paper, type Size } from './widgets';

const GAP = 10;   // between rows (widgets.css .wg-list)
const ICON: Record<AddedKind, LucideIcon> = { countdown: Hourglass, note: StickyNote, month: CalendarDays, habitweek: Repeat };
const PAPER_WORD: Record<Paper, string> = { plain: 'Plain paper', bright: 'Bright paper', tint: 'Tinted paper', fresh: 'Green paper', warm: 'Warm paper' };

/** The way in from Settings (and from anywhere else that wants to link here). */
export function ArrangeTile() {
  return (
    <Link className="pl-tile" to="/settings/widgets">
      <LayoutGrid aria-hidden />
      <div className="pl-grow"><b>Arrange Today</b><small>Move, resize or switch off what’s on Today. Add a countdown, a note, a mini calendar.</small></div>
      <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
    </Link>
  );
}

/** What a drag is doing: the row held, how far the finger has taken it, and where it would land. */
interface Drag { id: string; dy: number; from: number; to: number; step: number }
interface Hold { id: string; pointer: number; startY: number; startScroll: number; y: number; from: number; tops: number[]; heights: number[]; frame: number; stop: () => void }

export function ArrangeToday({ pass }: { pass: PlannerPass }) {
  const uid = pass.user.id, profile = profileOf(pass.user.settings);
  const { prefs, loaded, trouble, change: save } = useWidgets(uid);
  const items = useMemo(() => arrange(prefs, profile), [prefs, profile]);
  const today = calendarKey();
  const [toast, say] = useToast();
  const [said, setSaid] = useState('');                        // read out after a move, for someone not looking
  const [fresh, setFresh] = useState<string | null>(null);     // the one just added: marked and scrolled to
  const [asking, setAsking] = useState<string | null>(null);   // the row asking "take this off?"; 'back' = "put it back?"
  const [form, setForm] = useState<{ w: Countdown; isNew: boolean } | null>(null);
  const notes = useDocs<{ text?: string }>(NOTE_KIND);          // what's written on each note, to tell them apart here
  const words = (id: string) => (notes.docs.find(d => d.key === id)?.data?.text || '').replace(/\s+/g, ' ').trim();

  const els = useRef(new Map<string, HTMLLIElement>());
  const list = useRef(items); list.current = items;
  const place = (id: string, by: -1 | 1) => {
    const i = items.findIndex(x => x.id === id), to = i + by;
    if (i < 0 || to < 0 || to >= items.length || !save(p => move(p, profile, id, by))) return;
    setSaid(`${items[i].name}: now ${to + 1} of ${items.length}`);
  };

  // ── dragging a row by its handle. Nothing in the list really moves until the finger lets go: the held row follows the
  //    finger and the rows it passes step aside, so the touch is never lost half-way. Near the top or bottom of the
  //    screen the page scrolls along. ──
  const [drag, setDrag] = useState<Drag | null>(null);
  const hold = useRef<Hold | null>(null);
  const where = (h: Hold): Drag => {
    const n = h.tops.length, i = h.from, last = h.tops[n - 1] + h.heights[n - 1];
    const dy = Math.max(h.tops[0] - h.tops[i], Math.min(last - h.heights[i] - h.tops[i], h.y - h.startY + window.scrollY - h.startScroll));
    const top = h.tops[i] + dy, bottom = top + h.heights[i];
    let to = i;
    for (let j = i + 1; j < n && bottom > h.tops[j] + h.heights[j] / 2; j++) to = j;      // its lower edge is past the middle of the next one
    if (to === i) for (let j = i - 1; j >= 0 && top < h.tops[j] + h.heights[j] / 2; j--) to = j;
    return { id: h.id, dy, from: i, to, step: h.heights[i] + GAP };
  };
  const drop = (cancel = false) => {
    const h = hold.current;
    if (!h) return;
    h.stop(); hold.current = null;
    const d = where(h), it = list.current[d.from];
    setDrag(null);
    if (cancel || d.to === d.from || !it) return;
    if (save(p => moveTo(p, profile, h.id, d.to))) setSaid(`${it.name}: now ${d.to + 1} of ${h.tops.length}`);
  };
  const grab = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (!loaded || hold.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const rows = list.current.map(it => els.current.get(it.id)), from = list.current.findIndex(it => it.id === id);
    if (from < 0 || rows.some(r => !r)) return;
    e.preventDefault();
    setAsking(null);
    const onMove = (ev: PointerEvent) => { const h = hold.current; if (!h || ev.pointerId !== h.pointer) return; ev.preventDefault(); h.y = ev.clientY; setDrag(where(h)); };
    const onUp = (ev: PointerEvent) => { if (hold.current && ev.pointerId === hold.current.pointer) drop(ev.type === 'pointercancel'); };
    // the page follows a row held near the top or bottom edge (the bar covers the last of the screen)
    const edge = () => {
      const h = hold.current;
      if (!h) return;
      const low = window.innerHeight - 110, push = h.y < 70 ? -Math.ceil((70 - h.y) / 6) : h.y > low ? Math.ceil((h.y - low) / 6) : 0;
      if (push) { const was = window.scrollY; window.scrollBy(0, push); if (window.scrollY !== was) setDrag(where(h)); }
      h.frame = requestAnimationFrame(edge);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      if (hold.current) cancelAnimationFrame(hold.current.frame);
    };
    window.addEventListener('pointermove', onMove, { passive: false }); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    const h: Hold = { id, pointer: e.pointerId, startY: e.clientY, startScroll: window.scrollY, y: e.clientY, from, tops: rows.map(r => r!.offsetTop), heights: rows.map(r => r!.offsetHeight), frame: 0, stop };
    hold.current = h;
    h.frame = requestAnimationFrame(edge);
    setDrag(where(h));
  };
  useEffect(() => () => { hold.current?.stop(); hold.current = null; }, []);

  // the one just added: bring its row into view
  useEffect(() => {
    if (!fresh) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    els.current.get(fresh)?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    const t = window.setTimeout(() => setFresh(null), 2600);
    return () => window.clearTimeout(t);
  }, [fresh]);

  const addOne = (kind: AddedKind) => {
    if (kind === 'countdown') { setForm({ w: { id: newId(), kind: 'countdown', title: '', date: '' }, isNew: true }); return; }
    const id = newId();
    if (!save(p => add(p, profile, kind === 'note' ? { id, kind, paper: 'bright' } : { id, kind }))) return;
    setFresh(id);
    say(kind === 'note' ? 'Added at the top of Today. Type on it there.' : 'Added at the top of Today', 'good');
  };
  const saveCountdown = (w: Countdown) => {
    if (!form) return;
    if (!save(p => (form.isNew ? add(p, profile, w) : change(p, w)))) return;
    if (form.isNew) { setFresh(w.id); say('Added at the top of Today', 'good'); }
    setForm(null);
  };
  // "put it back?" is asked at the foot of a long page: bring the question into view
  const backQ = useRef<HTMLDivElement>(null);
  useEffect(() => { if (asking === 'back') backQ.current?.scrollIntoView({ block: 'center' }); }, [asking]);
  const takeOff = (it: Item) => {
    if (!save(p => remove(p, it.id))) return;
    if (it.added?.kind === 'note') { void dropNote(uid, it.id); notes.setDocs(ds => ds.filter(d => d.key !== it.id)); }
    setAsking(null);
  };

  /** The line under a row's name. */
  const about = (it: Item): string => {
    if (it.block) return it.block.always ? `Always shown · ${it.block.about}` : it.on ? it.block.about : 'Off';
    const w = it.added!;
    if (w.kind === 'countdown') { const v = countdownView(w.date, today); return `Countdown · ${v.state === 'coming' ? `${v.big} ${v.small.replace(' · tomorrow', '')}` : v.state === 'today' ? 'today!' : v.small} · ${dayWords(w.date, today)}${w.yearly ? ' · every year' : ''}`; }
    if (w.kind === 'note') { const t = words(w.id); return t ? `“${t.length > 44 ? `${t.slice(0, 42)}…` : t}”` : 'Nothing written on it yet'; }
    return ADDED[w.kind].about;
  };
  const sizeWord = (it: Item, s: Size) => (it.block ? (s === 'full' ? 'Full' : 'Compact') : s === 'full' ? 'Wide' : 'Small');
  const asItWas = isAsItWas(prefs, profile);

  return (
    <Page>
      <Header back="/settings" eyebrow="Settings" title="Arrange Today" right={<Link to="/" className="pl-btn pl-btn--small wg-tap">See Today</Link>} />
      <p className="pl-muted" style={{ fontSize: 14 }}>Top to bottom, as Today shows it. Drag a row by its handle or use the arrows. What you change shows on Today straight away.</p>
      {trouble === 'load' && <p className="pl-error" role="alert">Couldn’t load how you’ve arranged Today. Check the connection. Nothing can be changed until it loads.</p>}
      {trouble === 'save' && <p className="pl-error" role="alert">Not saved yet. Check the connection; it will keep trying.</p>}

      <ol className={`wg-list ${drag ? 'is-sorting' : ''}`} aria-label="What’s on Today, top to bottom">
        {items.map((it, k) => {
          const held = drag?.id === it.id;
          const aside = !drag || held ? 0 : drag.from < drag.to && k > drag.from && k <= drag.to ? -drag.step : drag.to < drag.from && k >= drag.to && k < drag.from ? drag.step : 0;
          const note = it.added?.kind === 'note' ? it.added : null;
          return (
            <li key={it.id} ref={el => { if (el) els.current.set(it.id, el); else els.current.delete(it.id); }}
              className={`pl-card wg-row ${it.on ? '' : 'is-off'} ${held ? 'is-held' : ''} ${fresh === it.id ? 'is-new' : ''}`}
              style={held ? { transform: `translateY(${drag.dy}px)` } : aside ? { transform: `translateY(${aside}px)` } : undefined}>
              <div className="wg-row__top">
                <button type="button" className="wg-row__grip" aria-label={`Move ${it.name}: drag, or press the up and down arrow keys`} disabled={!loaded}
                  onPointerDown={e => grab(e, it.id)}
                  onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); place(it.id, e.key === 'ArrowUp' ? -1 : 1); } }}><GripVertical aria-hidden /></button>
                <div className="wg-row__name"><b>{it.name}</b><small>{about(it)}</small></div>
                <button type="button" className="wg-row__arrow" aria-label={`Move ${it.name} up`} disabled={!loaded || k === 0} onClick={() => place(it.id, -1)}><ChevronUp aria-hidden /></button>
                <button type="button" className="wg-row__arrow" aria-label={`Move ${it.name} down`} disabled={!loaded || k === items.length - 1} onClick={() => place(it.id, 1)}><ChevronDown aria-hidden /></button>
                {it.block?.always ? <span className="wg-row__end" role="img" aria-label="Always shown"><Lock aria-hidden /></span>
                  : it.block ? <button type="button" role="switch" aria-checked={it.on} aria-label={`Show ${it.name} on Today`} className="wg-switch" disabled={!loaded} onClick={() => save(p => setOn(p, it.id, !it.on))} />
                  : <button type="button" className="wg-row__end wg-row__bin" aria-label={`Take ${it.name} off Today`} disabled={!loaded} onClick={() => setAsking(a => (a === it.id ? null : it.id))}><Trash2 aria-hidden /></button>}
              </div>
              {asking === it.id ? (
                <div className="wg-row__more" role="group" aria-label="Take it off Today?">
                  <small className="wg-row__hint">Take this off Today?{note && words(it.id) ? ' What’s written on it goes too.' : ''}</small>
                  <button type="button" className="pl-btn pl-btn--small pl-btn--danger wg-tap" onClick={() => takeOff(it)}>Take it off</button>
                  <button type="button" className="pl-btn pl-btn--small pl-btn--ghost wg-tap" onClick={() => setAsking(null)}>Keep it</button>
                </div>
              ) : it.on && (it.resizable || it.added?.kind === 'countdown' || note) ? (
                <div className="wg-row__more">
                  {it.resizable && (
                    <div className="pl-seg wg-seg" role="group" aria-label={`Size of ${it.name}`}>
                      {(['full', 'compact'] as Size[]).map(s => <button key={s} type="button" className={it.size === s ? 'is-on' : ''} aria-pressed={it.size === s} disabled={!loaded} onClick={() => save(p => setSize(p, it.id, s))}>{sizeWord(it, s)}</button>)}
                    </div>
                  )}
                  {it.added?.kind === 'countdown' && <button type="button" className="pl-btn pl-btn--small wg-tap" disabled={!loaded} onClick={() => setForm({ w: it.added as Countdown, isNew: false })}><Pencil aria-hidden /> Change</button>}
                  {note && (
                    <div className="wg-papers" role="group" aria-label="Paper">
                      {PAPERS.map(paper => <button key={paper} type="button" className={`wg-paper ${note.paper === paper ? 'is-on' : ''}`} data-paper={paper} aria-label={PAPER_WORD[paper]} aria-pressed={note.paper === paper} disabled={!loaded} onClick={() => save(p => change(p, { ...note, paper }))}><i /></button>)}
                    </div>
                  )}
                  {it.block?.sizes && <small className="wg-row__hint">{it.block.sizes[it.size]}</small>}
                  {it.added && it.size === 'compact' && <small className="wg-row__hint">Two small ones next to each other share a row</small>}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="pl-muted" style={{ fontSize: 13 }}>The greeting, and anything the planner needs to ask you, stay at the very top.</p>
      <p className="wg-said" role="status" aria-live="polite">{said}</p>

      <section className="pl-stack" style={{ gap: 10 }} aria-label="Add to Today">
        <h2>Add to Today</h2>
        {(Object.keys(ADDED) as AddedKind[]).map(kind => {
          const Icon = ICON[kind], room = canAdd(prefs, kind);
          return (
            <button key={kind} type="button" className="pl-tile wg-add" disabled={!loaded || !room} onClick={() => addOne(kind)}>
              <Icon aria-hidden />
              <div className="pl-grow"><b>{ADDED[kind].name}</b><small>{room ? ADDED[kind].about : ADDED[kind].max === 1 ? 'Already on Today' : 'That’s as many as fit'}</small></div>
              <Plus aria-hidden className="wg-add__plus" />
            </button>
          );
        })}
      </section>

      {asking === 'back' ? (
        <div ref={backQ} className="pl-card pl-stack" role="group" aria-label="Put it back as it was?">
          <b>Put Today back as it was?</b>
          <p className="pl-muted" style={{ fontSize: 14 }}>The planner’s own blocks go back to their usual order and size, all showing.{prefs.added.length ? ' What you added stays, below them.' : ''}</p>
          <div className="pl-row">
            <Button primary onClick={() => { if (save(p => putBack(p, profile))) { setAsking(null); say('Back as it was', 'good'); } }}>Put it back</Button>
            <Button ghost onClick={() => setAsking(null)}>Leave it</Button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="pl-btn pl-btn--block" disabled={!loaded || asItWas} onClick={() => setAsking('back')}><RotateCcw aria-hidden style={{ width: 18, height: 18 }} /> Put it back as it was</button>
          {loaded && asItWas && <p className="pl-muted" style={{ fontSize: 13, textAlign: 'center' }}>Today is as it was.</p>}
        </>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.isNew ? 'New countdown' : 'Change the countdown'}>
        {form && <CountdownForm key={form.w.id} start={form.w} isNew={form.isNew} today={today} onSave={saveCountdown} />}
      </Sheet>
      {toast}
    </Page>
  );
}

/** Setting a countdown up: one of the coming occasions in a tap, or any title and day. */
function CountdownForm({ start, isNew, today, onSave }: { start: Countdown; isNew: boolean; today: string; onSave: (w: Countdown) => void }) {
  const [w, setW] = useState<Countdown>(start);
  // birthdays come from the household calendar, the way the chat's stickers find them (features/us)
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  useEffect(() => { getDocs<{ title?: string; date?: string; repeat?: string }>('event').then(d => setBirthdays(birthdaysFrom(d.map(x => x.data).filter(Boolean)))).catch(() => undefined); }, []);
  const coming = useMemo(() => upcoming(today, birthdays).filter(o => o.date).slice(0, 8), [today, birthdays]);
  const title = w.title.trim();
  const dayOk = isDay(w.date) && w.date >= today;
  return (
    <div className="pl-stack">
      <div className="pl-chips wg-coming" role="group" aria-label="Coming up">
        {coming.map(o => {
          const on = w.occasion === o.id && w.date === o.date && w.title === o.name;
          return <button key={`${o.id}${o.name}`} type="button" className={`pl-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setW({ ...w, title: o.name.slice(0, TITLE_MAX), date: o.date, yearly: true, occasion: o.id })}>{o.name} · {o.days === 0 ? 'today' : `${o.days} ${o.days === 1 ? 'day' : 'days'}`}</button>;
        })}
      </div>
      <Field label="What for"><Input value={w.title} maxLength={TITLE_MAX} placeholder="Trip to Goa · Our anniversary" onChange={e => setW({ ...w, title: e.target.value })} /></Field>
      {/* a day picked by hand is no longer the occasion's own day, so it stops following it */}
      <Field label="The day" hint={w.date && !dayOk ? 'Pick a day that’s still to come.' : undefined}><Input type="date" min={today} value={w.date} onChange={e => setW({ ...w, date: e.target.value, occasion: undefined })} /></Field>
      <label className="pl-row wg-yearly">
        <input type="checkbox" checked={!!w.yearly} onChange={e => setW({ ...w, yearly: e.target.checked || undefined })} />
        <span><b>Every year</b><br /><span className="pl-muted" style={{ fontSize: 13 }}>A birthday, an anniversary: once it has passed, it offers next year’s.</span></span>
      </label>
      <Button block primary disabled={!title || !dayOk} onClick={() => onSave({ ...w, title })}>{isNew ? 'Add to Today' : 'Save'}</Button>
    </div>
  );
}
