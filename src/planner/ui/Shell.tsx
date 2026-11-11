// src/planner/ui/Shell.tsx — the bottom bar around every signed-in screen: Today · RV · Health · Wealth · Lifestyle
// (ui/nav.ts says which screens sit under which button). RV is Arvy: the one button that stands out, and the only one
// with no word under it: its circle carries the planner's mark, RV with a sparkle (RvMark). A tap opens
// the chat panel and closes it again; held down, it opens the chat already listening, so you can just talk.
// Dragged up, RV offers two things: let go to the left for Arvy, to the right for the chat between the two of them
// (features/us). A dot on RV says the other one has written.
// Health and Lifestyle open their menu pages (screens/Hub.tsx).
// Health and Wealth also take a drag: press, drag up and let go, and the camera opens: for a meal (Health) or a
// receipt (Wealth). The photo lands on Add a meal / Add a receipt as if its own "Take a photo" had been tapped
// (lib/quickShot.ts). A tap still opens the page.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Camera, ChevronsUp, Compass, HeartPulse, MessagesSquare, Mic, Sparkles, Sunrise, Wallet, X, type LucideIcon } from 'lucide-react';
import { Arvy } from '../features/arvy/Arvy';
import { arvyHasNews, arvyIsHearing, arvyIsOpen, onArvyChange, openArvy, primeVoice, toggleArvy } from '../features/arvy/arvy';
import { Us } from '../features/us/Us';
import { onUs, openUs, otherName, setUsOpen, startUs, usIsOpen, usUnread, usVersion } from '../features/us/us';
import { PlaceIcon } from '../features/icons';
import { giveShot, SHOT_TO, type ShotKind } from '../lib/quickShot';
import { groupOf, NAV_TO, pull, PULL_SLOP, RV_HOLD_MS, RV_HOLD_SLOP, SHOTS, type NavGroup } from './nav';
import { RvMark } from './RvMark';

interface Tab { group: NavGroup; label: string; Icon: LucideIcon }
const TABS: Tab[] = [
  { group: 'today', label: 'Today', Icon: Sunrise },
  { group: 'health', label: 'Health', Icon: HeartPulse },
  { group: 'wealth', label: 'Wealth', Icon: Wallet },
  { group: 'lifestyle', label: 'Lifestyle', Icon: Compass },
];
/** Held still this long (ms), a button that takes a drag shows its bubble, so the drag can be found. */
const HOLD_MS = 280;

/** A bar button that can also be dragged up to take a photo. A bubble rises with the finger and fills in once it's
 *  far enough: letting go there calls `onShoot`; anywhere lower, nothing happens. */
function ShotTab({ t, active, shot, onShoot }: { t: Tab; active: boolean; shot: { kind: ShotKind; label: string }; onShoot: (kind: ShotKind) => void }) {
  const [up, setUp] = useState<number | null>(null);   // how far it's been dragged up (px); null = no bubble
  const from = useRef<{ id: number; y: number } | null>(null);
  const dragged = useRef(false);   // it turned into a drag: a click that follows is not a tap
  const armed = useRef(false);
  const hold = useRef(0);
  const stop = () => { from.current = null; window.clearTimeout(hold.current); setUp(null); };
  const p = up === null ? null : pull(up);
  return (
    <Link to={NAV_TO[t.group]} className={`pl-nav__shot ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} draggable={false}
      onPointerDown={e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        from.current = { id: e.pointerId, y: e.clientY }; dragged.current = false; armed.current = false;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
        window.clearTimeout(hold.current);
        hold.current = window.setTimeout(() => setUp(u => u ?? 0), HOLD_MS);
      }}
      onPointerMove={e => {
        const s = from.current;
        if (!s || s.id !== e.pointerId) return;
        const dy = s.y - e.clientY;
        if (dy > PULL_SLOP) dragged.current = true;
        if (!dragged.current) return;
        window.clearTimeout(hold.current);
        setUp(dy);
        const a = pull(dy).armed;
        if (a && !armed.current) { try { navigator.vibrate?.(12); } catch { /* no buzz on this phone */ } }
        armed.current = a;
      }}
      onPointerUp={e => {
        const s = from.current;
        if (!s || s.id !== e.pointerId) return;
        const fire = dragged.current && pull(s.y - e.clientY).armed;
        stop();
        if (fire) onShoot(shot.kind);   // straight from the finger lifting: the browser only opens the camera from a touch
      }}
      onPointerCancel={stop}
      onClick={e => { if (dragged.current) { e.preventDefault(); dragged.current = false; } }}
      onContextMenu={e => e.preventDefault()}>
      <PlaceIcon place={t.group} line={t.Icon} /> {t.label}
      {p && (
        <span className={`pl-nav__pull ${p.armed ? 'is-armed' : ''}`} style={{ '--lift': p.lift } as CSSProperties} aria-hidden>
          {p.armed ? <Camera /> : <ChevronsUp />}{shot.label}
        </span>)}
    </Link>
  );
}

/** RV, Arvy's button. A tap opens the chat and closes it; held down (RV_HOLD_MS) it opens the chat listening.
 *  While Arvy listens it shows a mic. */
function RvButton() {
  const arvyOpen = useSyncExternalStore(onArvyChange, arvyIsOpen);
  const hearing = useSyncExternalStore(onArvyChange, arvyIsHearing);
  const news = useSyncExternalStore(onArvyChange, arvyHasNews);   // Arvy has posted what's new
  useSyncExternalStore(onUs, usVersion);
  const usOpen = usIsOpen(), unread = usUnread();
  const open = arvyOpen || usOpen;
  const other = otherName();
  const from = useRef<{ id: number; x: number; y: number } | null>(null);
  const timer = useRef(0);
  const held = useRef(false);       // this press turned into a hold or a drag: the click that may follow is not a tap
  const dragging = useRef(false);
  const side = useRef<'arvy' | 'us' | null>(null);   // which one letting go would open
  const [drag, setDrag] = useState<{ up: number; right: boolean } | null>(null);
  const stop = () => { window.clearTimeout(timer.current); from.current = null; dragging.current = false; side.current = null; setDrag(null); };
  const p = drag ? pull(drag.up) : null;
  return (
    <button type="button" className={`pl-nav__rv ${open ? 'is-open' : ''} ${hearing ? 'is-hearing' : ''}`} aria-expanded={open}
      aria-label={hearing ? 'Arvy is listening. Close Arvy' : usOpen ? `Close the chat with ${other}` : arvyOpen ? 'Close Arvy' : `Ask Arvy. Hold to talk. Drag up and right for the chat with ${other}${unread ? `: ${unread} new` : ''}`}
      onPointerDown={e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        held.current = false; dragging.current = false; side.current = null;
        from.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          held.current = true; from.current = null;
          try { navigator.vibrate?.(12); } catch { /* no buzz on this phone */ }
          openArvy({ mic: true });
        }, RV_HOLD_MS);
      }}
      onPointerMove={e => {
        const s = from.current;
        if (!s || s.id !== e.pointerId) return;
        const up = s.y - e.clientY, across = e.clientX - s.x;
        if (!dragging.current) {
          if (up > PULL_SLOP) dragging.current = true;                                              // dragged up: choosing between Arvy and the chat
          if (dragging.current || Math.hypot(across, up) > RV_HOLD_SLOP) window.clearTimeout(timer.current);   // slid off: not a hold
          if (!dragging.current) return;
        }
        const to = pull(up).armed ? (across < 0 ? 'arvy' as const : 'us' as const) : null;
        if (to && to !== side.current) { try { navigator.vibrate?.(12); } catch { /* no buzz on this phone */ } }
        side.current = to;
        setDrag({ up, right: across >= 0 });
      }}
      onPointerUp={() => {
        const to = dragging.current ? side.current : null, wasDrag = dragging.current;
        stop();
        if (wasDrag) {
          held.current = true;
          if (to === 'us') openUs(); else if (to === 'arvy') openArvy();
        } else if (held.current) primeVoice();   // the finger lifting is what lets a phone play Arvy's spoken answer
      }}
      onPointerCancel={stop}
      onClick={() => { if (held.current) { held.current = false; return; } if (usOpen) setUsOpen(false); else toggleArvy(); }}
      onContextMenu={e => e.preventDefault()}>
      <i aria-hidden>{hearing ? <Mic /> : open ? <X /> : <RvMark />}{(unread > 0 || news) && !open && <b className="pl-nav__dot" />}</i>
      {p && drag && (
        <span className="pl-nav__picks" style={{ '--lift': p.lift } as CSSProperties} aria-hidden>
          <span className={p.armed && !drag.right ? 'is-armed' : ''}><Sparkles /> Arvy</span>
          <span className={p.armed && drag.right ? 'is-armed' : ''}><MessagesSquare /> {other}</span>
        </span>)}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const here = groupOf(useLocation().pathname);
  const nav = useNavigate();
  useEffect(() => startUs(), []);   // the chat between the two of them is kept fresh while someone is signed in
  // the bar's own camera: one hidden picker, opened by a drag; the screen it then goes to picks the photo up
  const camRef = useRef<HTMLInputElement>(null);
  const shooting = useRef<ShotKind>('meal');
  const shoot = (kind: ShotKind) => {
    shooting.current = kind;
    camRef.current?.click();   // first: it only works while the touch is still "live"
    nav(SHOT_TO[kind]);        // the screen under the camera: if the camera didn't open, its own button is right there
  };
  const tab = (t: Tab) => {
    const shot = SHOTS[t.group];
    if (shot) return <ShotTab key={t.group} t={t} active={here === t.group} shot={shot} onShoot={shoot} />;
    return (
      <Link key={t.group} to={NAV_TO[t.group]} className={here === t.group ? 'active' : ''} aria-current={here === t.group ? 'page' : undefined}>
        <PlaceIcon place={t.group} line={t.Icon} /> {t.label}
      </Link>
    );
  };
  return (
    <>
      {children}
      <Arvy />
      <Us />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} aria-hidden
        onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; giveShot(shooting.current, files); }} />
      <nav className="pl-nav" aria-label="Planner">
        {tab(TABS[0])}
        <RvButton />
        {TABS.slice(1).map(tab)}
      </nav>
    </>
  );
}
