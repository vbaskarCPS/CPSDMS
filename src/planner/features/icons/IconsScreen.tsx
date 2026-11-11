// src/planner/features/icons/IconsScreen.tsx — /settings/icons: which icons the bottom bar and the Health and
// Lifestyle pages show. At the top, the packs: "Match my look" (the pack that goes with the look that is on) and then
// each pack with all its drawings in the colours on screen; a tap picks one and the bar changes at once.
// Below, "Your own icons": any one place can carry a picture of theirs instead. They pick it, slide and pinch it into
// the square (picture.ts), and a small copy is kept. Taking it off brings the pack's drawing back.
// IconsTile is the row that leads here from Settings.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Shapes } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { profileOf } from '../../lib/app';
import { Header, Page, Sheet, useToast } from '../../ui/primitives';
import { packFor, placesFor, type IconPrefs, type PackId, type Place } from './choice';
import { PACKS, PackIcon, packOf } from './packs';
import { CENTRED, drag, makeIcon, MAX_ZOOM, openPicture, place as placeIn, settle, type Fit, type Opened } from './picture';
import { PlaceIcon } from './PlaceIcon';
import { choosePack, clearPicture, iconPrefs, iconsStamp, lookNow, onIcons, refreshIcons, setPicture } from './store';

type Shown = ReturnType<typeof placesFor>;
const NOT_SAVED = 'Couldn’t save just now. It’s kept on this phone and will be sent later.';

/** The row in Settings that opens this screen. */
export function IconsTile() {
  return (
    <Link className="pl-tile" to="/settings/icons">
      <Shapes aria-hidden />
      <div className="pl-grow"><b>Icons</b><small>Themed icons for the bar and the menus, or your own pictures</small></div>
      <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
    </Link>
  );
}

/** One choice: its name, a few words, and every drawing of the pack it stands for. */
function PackCard({ on, name, note, pack, places, onPick }: { on: boolean; name: string; note: string; pack: PackId; places: Shown; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`ic-pack ${on ? 'is-on' : ''}`} onClick={onPick}>
      <span className="ic-pack__head">
        <span><b>{name}</b><small>{note}</small></span>
        <i className="ic-pack__mark" aria-hidden>{on && <Check />}</i>
      </span>
      <span className="ic-pack__icons" aria-hidden>
        {places.map(p => <span key={p.id} title={p.name}><PackIcon pack={pack} place={p.id} /></span>)}
      </span>
    </button>
  );
}

/** The picture they picked, in a square frame: drag to move it, pinch or use the slider to come closer. */
function FitSheet({ name, pic, onUse, onClose }: { name: string; pic: Opened; onUse: (fit: Fit) => void; onClose: () => void }) {
  const [fit, setFit] = useState<Fit>(CENTRED);
  const frame = Math.max(180, Math.min(280, (typeof window === 'undefined' ? 390 : window.innerWidth) - 96));
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const apart = () => { const [a, b] = [...fingers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = fingers.current.get(e.pointerId);
    if (!was) return;
    const before = apart();
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size >= 2) {   // two fingers: closer or further
      const now = apart();
      if (before > 0 && now > 0) setFit(f => settle(pic.w, pic.h, { ...f, zoom: f.zoom * (now / before) }));
    } else setFit(f => drag(pic.w, pic.h, f, e.clientX - was.x, e.clientY - was.y, frame));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => { fingers.current.delete(e.pointerId); };
  const at = (size: number) => { const p = placeIn(pic.w, pic.h, fit, size); return { width: p.width, height: p.height, left: p.left, top: p.top }; };
  return (
    <Sheet open onClose={onClose} title={`Your picture for ${name}`}>
      <p className="pl-muted" style={{ fontSize: 14 }}>Drag it so the part you want sits in the square.</p>
      <div className="ic-fit" style={{ width: frame, height: frame }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={e => setFit(f => settle(pic.w, pic.h, { ...f, zoom: f.zoom * (e.deltaY < 0 ? 1.08 : 0.92) }))}>
        <img src={pic.url} alt="" draggable={false} style={at(frame)} />
      </div>
      <label className="pl-field">
        <span className="pl-label">Closer</span>
        <input className="ic-zoom" type="range" min={1} max={MAX_ZOOM} step={0.01} value={fit.zoom} aria-label="Closer"
          onChange={e => setFit(f => settle(pic.w, pic.h, { ...f, zoom: Number(e.target.value) }))} />
      </label>
      <div className="ic-sizes" aria-hidden>
        <span><i style={{ width: 26, height: 26 }}><img src={pic.url} alt="" style={at(26)} /></i>On the bar</span>
        <span><i style={{ width: 40, height: 40 }}><img src={pic.url} alt="" style={at(40)} /></i>On a page</span>
      </div>
      <div className="pl-row">
        <button type="button" className="pl-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="pl-btn pl-btn--primary pl-grow" onClick={() => onUse(fit)}>Use this picture</button>
      </div>
    </Sheet>
  );
}

export function IconsScreen({ pass }: { pass: PlannerPass }) {
  useSyncExternalStore(onIcons, iconsStamp);
  const prefs = iconPrefs(), look = lookNow();
  const places = placesFor(profileOf(pass.user.settings));
  const [toast, say] = useToast();
  const [fitting, setFitting] = useState<{ place: Place; pic: Opened } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickingFor = useRef<Place | null>(null);
  useEffect(() => { void refreshIcons(true); }, []);   // what was chosen on their other phone, before they choose here
  // the picked photo is let go of when it has been used or put aside (and if the screen is left with it open)
  const open = useRef(fitting); open.current = fitting;
  useEffect(() => () => { open.current?.pic.close(); }, []);
  const putAside = () => { fitting?.pic.close(); setFitting(null); };

  const pick = (pack: IconPrefs['pack']) => { if (pack !== prefs.pack) choosePack(pack).catch(() => say(NOT_SAVED, 'bad')); };
  const add = (place: Place) => { pickingFor.current = place; picker.current?.click(); };
  const picked = async (file: File | undefined) => {
    const place = pickingFor.current;
    if (!file || !place) return;
    try { setFitting({ place, pic: await openPicture(file) }); }
    catch { say('This phone can’t open that as a picture. Try another one.', 'bad'); }
  };
  const use = (fit: Fit) => {
    if (!fitting) return;
    let src: string;
    try { src = makeIcon(fitting.pic, fit); } catch { say('That picture couldn’t be used. Try another one.', 'bad'); putAside(); return; }
    setPicture(fitting.place, src).catch(() => say(NOT_SAVED, 'bad'));
    putAside();
  };
  const matched = packFor('match', look);
  const nameOf = (id: Place) => places.find(p => p.id === id)?.name ?? '';

  return (
    <Page>
      <Header title="Icons" back="/settings" />
      <p className="pl-muted" style={{ fontSize: 14 }}>The little drawings on the bar at the bottom and on the Health and Lifestyle pages.</p>

      <div className="ic-packs" role="radiogroup" aria-label="Icon pack">
        <PackCard on={prefs.pack === 'match'} name="Match my look" pack={matched} places={places} onPick={() => pick('match')}
          note={`Changes with your look. Right now: ${matched === 'line' ? 'the planner’s own' : packOf(matched).name}`} />
        {PACKS.map(p => <PackCard key={p.id} on={prefs.pack === p.id} name={p.name} note={p.note} pack={p.id} places={places} onPick={() => pick(p.id)} />)}
      </div>

      <section className="pl-card pl-stack">
        <div>
          <h3>Your own icons</h3>
          <p className="pl-muted" style={{ fontSize: 14, marginTop: 4 }}>Put a picture of yours on any of them. It keeps its own colours, whichever pack is on.</p>
        </div>
        <div className="pl-list">
          {places.map(p => {
            const mine = Boolean(prefs.own[p.id]);
            return (
              <div className="ic-row" key={p.id}>
                <button type="button" className="ic-row__icon" onClick={() => add(p.id)} aria-label={`${mine ? 'Change the picture' : 'Add a picture'} for ${p.name}`}><PlaceIcon place={p.id} /></button>
                <span className="pl-grow"><b>{p.name}</b><small>{mine ? 'Your picture' : p.where}</small></span>
                {mine
                  ? <button type="button" className="pl-btn pl-btn--small" onClick={() => { clearPicture(p.id).catch(() => say(NOT_SAVED, 'bad')); }}>Take it off</button>
                  : <button type="button" className="pl-btn pl-btn--small" onClick={() => add(p.id)}>Add a picture</button>}
              </div>
            );
          })}
        </div>
      </section>

      <input ref={picker} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void picked(f); }} />
      {fitting && <FitSheet name={nameOf(fitting.place)} pic={fitting.pic} onUse={use} onClose={putAside} />}
      {toast}
    </Page>
  );
}
