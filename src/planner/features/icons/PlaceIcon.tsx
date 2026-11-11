// src/planner/features/icons/PlaceIcon.tsx — the icon for one place (a bar button, a menu tile): the person's own
// picture if they put one there, else the drawing from the pack that is on (store.ts knows which). It draws again by
// itself when the choice or the look changes. With nothing chosen and no look on, it is the planner's own icon:
// the very element the bar and the tiles have always shown.
import { useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Place } from './choice';
import { LINE, PackIcon } from './packs';
import { iconAt, iconsStamp, onIcons } from './store';
import './icons.css';

/** `place` = which one (null: a spot we have no drawings for). `line` = the planner's own icon for it, when the
 *  caller has it to hand: it is used as it is, so the bar and the tiles stay the ones who say what theirs are. */
export function PlaceIcon({ place, line }: { place: Place | null; line?: LucideIcon }) {
  useSyncExternalStore(onIcons, iconsStamp);
  const d = place ? iconAt(place) : null;
  if (d && 'own' in d) return <img className="pi-own" src={d.own} alt="" aria-hidden draggable={false} />;
  if (!place || !d || d.pack === 'line') {
    const Line = line ?? (place ? LINE[place] : null);
    return Line ? <Line aria-hidden /> : null;
  }
  return <PackIcon pack={d.pack} place={place} />;
}
