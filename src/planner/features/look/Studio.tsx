// src/planner/features/look/Studio.tsx — the Theme Studio (Settings → Theme Studio, /settings/look): where a look is
// chosen. One look for the whole planner (each tile is that look drawn small, in its own colours, type and shapes),
// a different one for any section, the background's sliders, a picture of your own behind it all, and shapes and
// type by hand. Every change shows at once and is saved (store.ts); "Back to the planner's own look" clears it all.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, LayoutGrid, Shapes, Sticker } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { profileOf } from '../../lib/app';
import { loadTileFonts, tileFace } from './apply';
import { clearLook, flushLook, loadPicture, lookPrefs, lookVersion, onLookPrefs, pictureFor, removePicture, setLook, setPicture } from './store';
import { EDGES, FACES, LOOKS, OWN, SECTIONS, SHADOWS, bgPlan, brightnessOf, isPlain, lookList, noPrefs, overlayOf, strengthOf, tileVars, type Choice, type Edge, type FaceId, type Look, type LookPrefs, type PicSlot, type Section, type Shadow } from './looks';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
   MORE OF THE STUDIO: THE THREE TILES STILL TO COME GO IN HERE
   They are the last thing on this screen, under everything else:
       Icons     →  /settings/icons
       Stickers  →  /settings/stickers
       Widgets   →  /settings/widgets
   Put the three tiles inside the <nav> below, in that order, and take the `return null` away. A tile is whatever
   those parts export for the purpose, or a plain link drawn like the ones in Settings (the commented example).
   Until then nothing is drawn. Those three screens are not built in this folder.
   ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
function MoreOfTheStudio() {
  return (
    <nav className="lk-next" aria-label="More of the Studio">
      <Link className="pl-tile" to="/settings/icons"><Shapes aria-hidden /><div className="pl-grow"><b>Icons</b><small>Icon packs for the bar and the menu pages, or your own pictures</small></div><ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} /></Link>
      <Link className="pl-tile" to="/settings/stickers"><Sticker aria-hidden /><div className="pl-grow"><b>Stickers</b><small>Decorate your pages like a scrapbook</small></div><ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} /></Link>
      <Link className="pl-tile" to="/settings/widgets"><LayoutGrid aria-hidden /><div className="pl-grow"><b>Widgets</b><small>Arrange Today, and add a countdown, a note or a mini calendar</small></div><ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} /></Link>
    </nav>
  );
}

const OWN_NAME = 'The planner’s own';
const EDGE_NAMES: Record<Edge, string> = { hairline: 'A fine line', bold: 'A bold line', dashed: 'Dashes', double: 'A double line', stitch: 'Stitched', frame: 'Framed', none: 'No edge' };
const SHADOW_NAMES: Record<Shadow, string> = { none: 'No shadow', soft: 'Soft', lifted: 'Lifted off the page', pop: 'A hard shadow to one side', glow: 'A glow' };
const faceIds = Object.keys(FACES) as FaceId[];
const HEADING_FACES = ['fraunces', ...faceIds.filter(f => FACES[f].kind === 'display' && f !== 'fraunces'), 'quicksand', 'zenmaru'] as FaceId[];
const TEXT_FACES = faceIds.filter(f => FACES[f].kind === 'text');
/** Every letter the tiles' names use: all that is fetched of each look's heading face for them. */
const TILE_LETTERS = [...new Set([OWN_NAME, ...lookList().map(l => l.short)].join(''))].sort().join('');

/** Which of the planner's own colours this phone shows: Vijay's navy or Rosh's plum, light or dark. */
function ownColours(): { theme: 'navy' | 'plum'; dark: boolean } {
  return { theme: document.documentElement.dataset.theme === 'plum' ? 'plum' : 'navy', dark: !!window.matchMedia?.('(prefers-color-scheme: dark)').matches };
}
/** A look's variables as React wants a style. */
const asStyle = (vars: Record<string, string>): CSSProperties => { const { 'color-scheme': scheme, ...rest } = vars; return { ...rest, colorScheme: scheme } as CSSProperties; };

/** One look, drawn small: its wallpaper and strip, a card with its name in its own heading face, a button. */
function LookTile({ id, on, onPick }: { id: Choice; on: boolean; onPick: () => void }) {
  const look: Look | null = id === OWN ? null : LOOKS[id];
  const style = useMemo(() => ({ ...asStyle(tileVars(id, ownColours())), '--lk-face': look ? tileFace(look.type.display) : 'var(--serif)' } as CSSProperties), [id, look]);
  const bg = useMemo(() => (look ? bgPlan(look, noPrefs()) : null), [look]);
  return (
    <button type="button" className={`lk-tile ${on ? 'is-on' : ''}`} style={style} onClick={onPick} aria-pressed={on} aria-label={`${look ? look.name : 'The planner’s own look'}${on ? ', chosen' : ''}`}>
      {bg && (
        <span className="lk-tile__paper" style={{ background: bg.base }} aria-hidden>
          <span className="lk-tile__paper" style={{ backgroundImage: bg.paper.map(l => l.image).join(', '), backgroundSize: bg.paper.map(l => l.size).join(', '), opacity: bg.paperOpacity }} />
          {bg.top && <span className="lk-tile__paper" style={{ background: `${bg.top.image} left top / ${bg.top.size} repeat-x`, opacity: 0.92 }} />}
        </span>
      )}
      <span className="lk-tile__body">
        <span className="lk-tile__card">
          <b className="lk-tile__name" style={{ fontFamily: 'var(--lk-face)' }}>{look ? look.short : OWN_NAME}</b>
          <span className="lk-tile__line">{look ? look.blurb : 'As it has always been'}</span>
          <span className="lk-tile__btn" aria-hidden>Button</span>
        </span>
      </span>
      {on && <span className="lk-tile__mark" aria-hidden><Check /></span>}
    </button>
  );
}

function Slider({ label, hint, value, min, max, own, onChange, onOwn }: { label: string; hint?: string; value: number; min: number; max: number; own?: boolean; onChange: (v: number) => void; onOwn?: () => void }) {
  return (
    <label className="lk-slider">
      <span>{label}<b className="pl-num">{value}%</b></span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
      {(hint || (onOwn && !own)) && (
        <span className="pl-hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 400 }}>
          {hint}{onOwn && !own && <button type="button" onClick={onOwn} style={{ border: 0, background: 'none', padding: '8px 0 8px 8px', margin: '-8px 0', color: 'var(--accent)', font: 'inherit', fontWeight: 700, cursor: 'pointer', flex: 'none' }}>As the look has it</button>}
        </span>
      )}
    </label>
  );
}

function Pick<T extends string>({ label, sub, value, options, onChange }: { label: string; sub?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="lk-row">
      <span>{label}{sub && <small>{sub}</small>}</span>
      <select className="pl-input" value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** One place a picture can go (the whole planner, or a section): its picture, and choosing or removing it. */
function PictureRow({ slot, name, onError }: { slot: PicSlot; name: string; onError: (m: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = !!lookPrefs().pic.on[slot], url = pictureFor(slot);
  useEffect(() => { if (has) void loadPicture(slot); }, [has, slot]);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); onError(null);
    try { await setPicture(slot, file); }
    catch (x) { onError(x instanceof Error && x.message ? x.message : 'That picture couldn’t be saved. Check the connection and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="lk-pic">
      <span className="lk-pic__thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined} aria-hidden>{!url && <ImagePlus />}</span>
      <div className="pl-grow" style={{ minWidth: 0 }}>
        <b style={{ display: 'block', marginBottom: 6 }}>{name}</b>
        <div className="lk-pic__btns">
          <button type="button" className="pl-btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Saving…' : has ? 'Change' : 'Choose a picture'}</button>
          {has && !busy && <button type="button" className="pl-btn pl-btn--ghost" style={{ minHeight: 44 }} onClick={() => removePicture(slot)}>Take it off</button>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
    </div>
  );
}

function Block({ title, line, children }: { title: string; line?: string; children: ReactNode }) {
  return (
    <section className="pl-card pl-stack">
      <div><h3>{title}</h3>{line && <p className="pl-muted" style={{ fontSize: 13, marginTop: 2 }}>{line}</p>}</div>
      {children}
    </section>
  );
}

export function Studio({ pass }: { pass: PlannerPass }) {
  useSyncExternalStore(onLookPrefs, lookVersion);
  const p = lookPrefs();
  const morning = profileOf(pass.user.settings) === 'morning';
  const sections = SECTIONS.filter(s => !('morningOnly' in s && s.morningOnly) || morning);
  const [picError, setPicError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);   // "Back to the planner's own look": asked once before it clears
  const more = lookList('more'), moreOpen = p.all !== OWN && LOOKS[p.all].group === 'more';
  useEffect(() => { void loadTileFonts(lookList().map(l => l.type.display), TILE_LETTERS); }, []);
  useEffect(() => flushLook, []);   // leaving the screen: what was just changed is saved now

  const whole = p.all === OWN ? null : LOOKS[p.all];
  const hasPaper = !!whole && whole.bg.paper.length > 0;   // a look with no wallpaper (Minimalist) has nothing for the sliders to act on
  const set = (change: (q: LookPrefs) => LookPrefs) => setLook(change);
  const setBg = (patch: Partial<LookPrefs['bg']>) => set(q => ({ ...q, bg: { ...q.bg, ...patch } }));
  const setPic = (patch: Partial<LookPrefs['pic']>) => set(q => ({ ...q, pic: { ...q.pic, ...patch } }));
  const setShape = (patch: Partial<LookPrefs['shapes']>) => set(q => ({ ...q, shapes: { ...q.shapes, ...patch } }));
  const setType = (patch: Partial<LookPrefs['type']>) => set(q => ({ ...q, type: { ...q.type, ...patch } }));
  const setSection = (s: Section, v: Choice | 'same') => set(q => { const next = { ...q.sections }; if (v === 'same') delete next[s]; else next[s] = v; return { ...q, sections: next }; });
  const anyPicture = Object.keys(p.pic.on).length > 0;
  const lookChoices: { value: Choice | 'same'; label: string }[] = [{ value: 'same', label: 'Same as the planner' }, { value: OWN, label: 'The planner’s own look' }, ...lookList().map(l => ({ value: l.id as Choice, label: l.short }))];
  const byHand = { value: 'look' as const, label: 'As the look has it' };

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 16 }}>
      <header className="pl-row">
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Back to Settings" style={{ minHeight: 44, minWidth: 44, padding: '0 8px' }}><ChevronLeft /></Link>
        <div className="pl-grow">
          <p className="pl-eyebrow">Looks, backgrounds, shapes and type</p>
          <h1>Theme Studio</h1>
        </div>
      </header>

      <Block title="The whole planner" line="Tap a look and the planner puts it on straight away.">
        <div className="lk-grid" style={{ '--lk-on': 'var(--accent)', '--lk-on-ink': 'var(--accent-ink)' } as CSSProperties}>
          <LookTile id={OWN} on={p.all === OWN} onPick={() => set(q => ({ ...q, all: OWN }))} />
          {lookList('main').map(l => <LookTile key={l.id} id={l.id} on={p.all === l.id} onPick={() => set(q => ({ ...q, all: l.id }))} />)}
        </div>
        <details className="lk-more" open={moreOpen || undefined}>
          <summary>More looks ({more.length})<ChevronDown aria-hidden /></summary>
          <div className="lk-grid" style={{ '--lk-on': 'var(--accent)', '--lk-on-ink': 'var(--accent-ink)', marginTop: 4 } as CSSProperties}>
            {more.map(l => <LookTile key={l.id} id={l.id} on={p.all === l.id} onPick={() => set(q => ({ ...q, all: l.id }))} />)}
          </div>
        </details>
      </Block>

      <Block title="A look for each section" line="Any section can wear a look of its own. The menu pages and Settings wear the planner’s.">
        <div>
          {sections.map(s => <Pick key={s.id} label={s.name} value={(p.sections[s.id] ?? 'same') as Choice | 'same'} options={lookChoices} onChange={v => setSection(s.id, v)} />)}
        </div>
      </Block>

      <Block title="Background" line={!whole ? 'The planner’s own look has a plain background. Pick a look above for a wallpaper, or put a picture of your own behind it below.' : hasPaper ? `The wallpaper behind ${whole.short}.` : `${whole.short} keeps its background plain. A picture of your own can go behind it below.`}>
        {whole && hasPaper && (
          <>
            <Slider label="Strength" hint="How much the wallpaper shows" value={strengthOf(whole, p)} min={0} max={100} own={p.bg.strength === null} onChange={v => setBg({ strength: v })} onOwn={() => setBg({ strength: null })} />
            <Slider label="Brightness" value={brightnessOf(p)} min={50} max={150} own={p.bg.brightness === null} onChange={v => setBg({ brightness: v })} onOwn={() => setBg({ brightness: null })} />
            <Slider label="Overlay" hint="A veil of the page colour over it, for easier reading" value={overlayOf(whole, p)} min={0} max={90} own={p.bg.overlay === null} onChange={v => setBg({ overlay: v })} onOwn={() => setBg({ overlay: null })} />
          </>
        )}
        {whole && (whole.bg.corner || whole.bg.top) && (
          <div>
            {whole.bg.corner && <label className="lk-check"><input type="checkbox" checked={p.bg.corner} onChange={e => setBg({ corner: e.target.checked })} /><span>The little drawing in the corner</span></label>}
            {whole.bg.top && <label className="lk-check"><input type="checkbox" checked={p.bg.strip} onChange={e => setBg({ strip: e.target.checked })} /><span>The strip along the top</span></label>}
          </div>
        )}
        {whole && <hr className="pl-divider" />}
        <div><h3>My picture</h3><p className="pl-muted" style={{ fontSize: 13, marginTop: 2 }}>A photo of your own behind the planner, in place of the wallpaper.</p></div>
        <PictureRow slot="all" name="The whole planner" onError={setPicError} />
        {picError && <p className="pl-error" role="alert">{picError}</p>}
        {anyPicture && (
          <>
            <Pick label="Fit" value={p.pic.fit} options={[{ value: 'fill', label: 'Fill the screen' }, { value: 'repeat', label: 'Repeat, like wallpaper' }]} onChange={v => setPic({ fit: v })} />
            <Slider label="Picture strength" hint="How much the picture shows" value={p.pic.strength} min={0} max={100} onChange={v => setPic({ strength: v })} />
            <Slider label="Picture brightness" value={p.pic.brightness} min={50} max={150} onChange={v => setPic({ brightness: v })} />
            <Slider label="Picture overlay" hint="A veil of the page colour over it, for easier reading" value={p.pic.overlay} min={0} max={90} onChange={v => setPic({ overlay: v })} />
          </>
        )}
        <details className="lk-more">
          <summary>A different picture for a section<ChevronDown aria-hidden /></summary>
          <div className="pl-stack" style={{ marginTop: 6 }}>
            {sections.map(s => <PictureRow key={s.id} slot={s.id} name={s.name} onError={setPicError} />)}
          </div>
        </details>
      </Block>

      <Block title="Shapes" line="Choose these by hand, on any look and on the planner’s own.">
        <div>
          <Pick label="Cards" value={p.shapes.cards} options={[byHand, { value: 'soft', label: 'Soft corners' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} onChange={v => setShape({ cards: v })} />
          <Pick label="Buttons" value={p.shapes.buttons} options={[byHand, { value: 'pill', label: 'Pill' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} onChange={v => setShape({ buttons: v })} />
          <Pick label="Edges" sub="The line round a card" value={p.shapes.edges} options={[byHand, ...EDGES.map(e => ({ value: e, label: EDGE_NAMES[e] }))]} onChange={v => setShape({ edges: v })} />
          <Pick label="Shadows" value={p.shapes.shadows} options={[byHand, ...SHADOWS.map(s => ({ value: s, label: SHADOW_NAMES[s] }))]} onChange={v => setShape({ shadows: v })} />
        </div>
      </Block>

      <Block title="Type">
        <div>
          <Pick label="Headings" value={p.type.heading} options={[byHand, ...HEADING_FACES.map(f => ({ value: f, label: FACES[f].family }))]} onChange={v => setType({ heading: v })} />
          <Pick label="Text" value={p.type.text} options={[byHand, ...TEXT_FACES.map(f => ({ value: f, label: FACES[f].family }))]} onChange={v => setType({ text: v })} />
        </div>
      </Block>

      {!isPlain(p) && (asking
        ? (
          <section className="pl-card pl-stack" role="alertdialog" aria-label="Back to the planner’s own look">
            <p>This takes off every look, your pictures and everything chosen by hand, on all your phones.</p>
            <div className="pl-row">
              <button type="button" className="pl-btn pl-btn--primary pl-grow" onClick={() => { clearLook(); setAsking(false); window.scrollTo({ top: 0 }); }}>Yes, take it all off</button>
              <button type="button" className="pl-btn pl-grow" onClick={() => setAsking(false)}>Keep it</button>
            </div>
          </section>)
        : <button type="button" className="pl-btn pl-btn--block" onClick={() => setAsking(true)}>Back to the planner’s own look</button>)}

      {/* the rest of the Studio lives on its own screens: icons, stickers, widgets */}
      <MoreOfTheStudio />
    </main>
  );
}
