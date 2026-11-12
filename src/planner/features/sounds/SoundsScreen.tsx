// src/planner/features/sounds/SoundsScreen.tsx — Settings › Sounds (/settings/sounds): a sound for each kind of
// notification. Three cards: the chat (named after the other one: "Rosh" on Vijay's planner), Arvy, and reminders and
// everything else. In each: the sound played while the planner is open (picked from a list, each with a play button)
// and "Sound when the planner is closed" (off = the notification still shows, but quietly). Underneath, plainly, what
// happens when the planner is closed: the phone plays its own sound, which is changed in the phone's settings.
// SoundsTile is the row that leads here from Settings.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Play, Volume2 } from 'lucide-react';
import { Header, Page, Sheet, useToast } from '../../ui/primitives';
import { otherName } from '../us/us';
import { KINDS, type SoundKind } from './choice';
import { NO_SOUND, SOUNDS, soundOf } from './sounds';
import { onSounds, playSound, refreshSounds, setChoice, soundPrefs, soundsVersion } from './store';
import './sounds.css';

const NOT_SAVED = 'Couldn’t save just now. It’s kept on this phone and will be sent later.';

/** The row in Settings that opens this screen. */
export function SoundsTile() {
  return (
    <Link className="pl-tile" to="/settings/sounds">
      <Volume2 aria-hidden />
      <div className="pl-grow"><b>Sounds</b><small>A different sound for the chat, for Arvy and for reminders</small></div>
      <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
    </Link>
  );
}

const about = (k: SoundKind, other: string): { name: string; note: string } =>
  k === 'chat' ? { name: other, note: `Messages from ${other} in your chat` }
    : k === 'arvy' ? { name: 'Arvy', note: 'Arvy’s answers in the chat, and its “tap to confirm” notifications' }
      : { name: 'Reminders and everything else', note: 'Your routine reminders, what’s new, and to-dos from email' };
const nameOf = (id: string) => (id === NO_SOUND ? 'None' : soundOf(id)?.name ?? 'None');

function PlayButton({ id, label }: { id: string; label: string }) {
  return (
    <button type="button" className="snd-play" aria-label={`Play ${label}`} onClick={() => playSound(id)}><Play aria-hidden /></button>
  );
}

/** The list to pick from: each sound with its play button. Picking one plays it too. */
function PickSheet({ kind, title, onClose, onPick }: { kind: SoundKind; title: string; onClose: () => void; onPick: (id: string) => void }) {
  const on = soundPrefs()[kind].sound;
  return (
    <Sheet open onClose={onClose} title={`Sound for ${title}`}>
      <div className="pl-list snd-pick" role="radiogroup" aria-label={`Sound for ${title}`}>
        {[...SOUNDS.map(s => ({ id: s.id, name: s.name })), { id: NO_SOUND, name: 'None' }].map(s => (
          <div className="snd-pick__row" key={s.id}>
            <button type="button" role="radio" aria-checked={on === s.id} className="snd-pick__name" onClick={() => { onPick(s.id); if (s.id !== NO_SOUND) playSound(s.id); }}>
              <i className="snd-mark" aria-hidden>{on === s.id && <Check />}</i>
              <span>{s.name}</span>
            </button>
            {s.id !== NO_SOUND && <PlayButton id={s.id} label={s.name} />}
          </div>
        ))}
      </div>
      <button type="button" className="pl-btn pl-btn--primary pl-btn--block" onClick={onClose}>Done</button>
    </Sheet>
  );
}

export function SoundsScreen() {
  useSyncExternalStore(onSounds, soundsVersion);
  const prefs = soundPrefs();
  const other = otherName();
  const [toast, say] = useToast();
  const [picking, setPicking] = useState<SoundKind | null>(null);
  useEffect(() => { void refreshSounds(); }, []);   // what was chosen on their other phone, before they choose here
  const change = (k: SoundKind, c: Parameters<typeof setChoice>[1]) => { setChoice(k, c).catch(() => say(NOT_SAVED, 'bad')); };

  return (
    <Page>
      <Header title="Sounds" back="/settings" />
      <p className="pl-muted" style={{ fontSize: 14 }}>A sound of its own for each kind of notification, so you can tell them apart without looking.</p>

      {KINDS.map(k => {
        const a = about(k, other), c = prefs[k];
        return (
          <section className="pl-card pl-stack snd-kind" key={k} aria-labelledby={`snd-${k}`}>
            <div>
              <h3 id={`snd-${k}`}>{a.name}</h3>
              <p className="pl-muted" style={{ fontSize: 13.5, marginTop: 2 }}>{a.note}</p>
            </div>
            <div className="snd-row">
              <span className="pl-grow"><b>While the planner is open</b></span>
            </div>
            <div className="snd-choose">
              <button type="button" className="pl-btn snd-choose__btn" onClick={() => setPicking(k)} aria-label={`Sound for ${a.name}: ${nameOf(c.sound)}. Change`}>
                <span className="pl-grow">{nameOf(c.sound)}</span><ChevronRight aria-hidden />
              </button>
              {c.sound !== NO_SOUND && <PlayButton id={c.sound} label={nameOf(c.sound)} />}
            </div>
            <div className="snd-row">
              <span className="pl-grow" id={`snd-closed-${k}`}><b>Sound when the planner is closed</b>
                <small>{c.closed ? 'Your phone’s own notification sound.' : 'No sound: the notification still shows, quietly.'}</small></span>
              <button type="button" role="switch" aria-checked={c.closed} aria-labelledby={`snd-closed-${k}`} className="snd-switch" onClick={() => change(k, { closed: !c.closed })} />
            </div>
          </section>
        );
      })}

      <section className="pl-card pl-stack snd-help">
        <p>When the planner is closed your phone plays its own notification sound, the same one for all of them. A planner can’t send one of these sounds with a notification. You can change that sound in your phone’s settings for the Planner app; on Android it is usually under the app’s notification settings.</p>
        <p>The sounds here play while the planner is open on screen, after you’ve touched it once.</p>
        <p>A video call still rings the way it always has.</p>
      </section>

      {picking && <PickSheet kind={picking} title={about(picking, other).name} onClose={() => setPicking(null)} onPick={id => change(picking, { sound: id })} />}
      {toast}
    </Page>
  );
}
