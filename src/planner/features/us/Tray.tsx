// src/planner/features/us/Tray.tsx — the chat's emoji tray, above the box you type in (Us.tsx). One theme at a time:
// it opens on the occasion coming up next (occasions.ts), with its name and countdown as the heading and only that
// theme's emoji below, smileys first and then things. Under the heading a row of small chips, one for each theme and
// drawn with a thing from it (a tree, a pumpkin, a cake), switches to another. Closing the tray and opening it again
// goes back to the one coming up.
import { useState } from 'react';
import { Emoji, emblemOf, packOf, type EmojiDef } from './emoji';
import { countdown, themeShown, themesOf, type Occasion, type OccasionId } from './occasions';

export function Tray({ occasions, noBirthdays, onPick }: {
  occasions: Occasion[];
  /** the calendar has answered, and has no birthdays on it */ noBirthdays: boolean;
  onPick: (e: EmojiDef) => void;
}) {
  // the theme chosen here: tapped on a chip, or the one an emoji was first taken from. Nothing chosen = the one coming
  // up next. Taking an emoji settles it, so that the calendar answering late with a nearer birthday can't change the
  // emoji under a finger
  const [picked, setPicked] = useState<OccasionId | null>(null);
  const themes = themesOf(occasions), shown = themeShown(themes, picked);
  return (
    <div className="us-tray">
      <h4>{shown.next ? 'Coming up: ' : ''}{shown.name}{countdown(shown) && <em>{countdown(shown)}</em>}</h4>
      <div className="us-themes" role="group" aria-label="Emoji for">
        {themes.map(t => (
          <button key={t.id} type="button" className={t.id === shown.id ? 'is-on' : ''} onClick={() => setPicked(t.id)} aria-label={t.label} aria-pressed={t.id === shown.id} title={t.label}>
            <Emoji e={emblemOf(t.id)} size={22} still />
          </button>))}
      </div>
      {/* a new list for each theme, so it starts from its top */}
      <div key={shown.id} className={`us-pack${shown.next ? ' is-next' : ''}`}>
        {packOf(shown.id).map(e => <button key={e.id} type="button" onClick={() => { setPicked(shown.id); onPick(e); }} aria-label={`Add ${e.name}`} title={e.name}><Emoji e={e} size={38} still /></button>)}
      </div>
      {shown.also.map(o => <p key={`${o.name}:${o.date}`} className="us-meta">{o.name} {countdown(o)}</p>)}
      {shown.id === 'birthday' && noBirthdays && <p className="us-meta">Put your birthdays on the calendar as yearly events (“Rosh’s birthday”) and they count down here too.</p>}
    </div>
  );
}
