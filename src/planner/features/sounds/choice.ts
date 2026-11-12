// src/planner/features/sounds/choice.ts — which sound goes with which notification, as chosen in Settings › Sounds.
// Three kinds: the chat (messages from the other one), Arvy (its answers in the chat and its "tap to confirm"
// notifications), and everything else (reminders, news, email to-dos, the notification check). For each kind: the
// sound played while the planner is open, and whether the phone makes its own sound when the planner is closed (off =
// the notification still shows, silently). No browser here: tested in choice.test.ts.
// The notification worker (public/planner-push-sw.js) works the kind out the same way in plain JS; worker.test.ts
// checks the two agree on every tag.
import { NO_SOUND, soundOf } from './sounds';

export type SoundKind = 'chat' | 'arvy' | 'other';
export const KINDS: SoundKind[] = ['chat', 'arvy', 'other'];
export interface KindChoice { /** a sound's id, or 'none' */ sound: string; /** the phone's own sound when the planner is closed */ closed: boolean }
export type SoundPrefs = Record<SoundKind, KindChoice>;

export const PREFS_KEY = 'sounds';   // the doc ('prefs', 'sounds'): the person's own, so it follows them to their other phone
export const DEFAULT_SOUNDS: SoundPrefs = {
  chat: { sound: 'chime', closed: true },
  arvy: { sound: 'sparkle', closed: true },
  other: { sound: 'bell', closed: true },
};

/** A saved choice, whatever shape it is in: anything missing or unknown is the default for that kind. */
export function cleanSounds(raw: unknown): SoundPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as SoundPrefs;
  for (const k of KINDS) {
    const c = (r[k] && typeof r[k] === 'object' ? r[k] : {}) as { sound?: unknown; closed?: unknown };
    const sound = typeof c.sound === 'string' && (c.sound === NO_SOUND || soundOf(c.sound)) ? c.sound : DEFAULT_SOUNDS[k].sound;
    out[k] = { sound, closed: typeof c.closed === 'boolean' ? c.closed : DEFAULT_SOUNDS[k].closed };
  }
  return out;
}

/** The pushes the planner's functions send, by their tag (and title, for Arvy's answers in the chat):
 *   chat              planner-chat: a message from the other one (title = their name) … or Arvy's answer (title 'Arvy')
 *   arvy-<id>         planner-chat: one of Arvy's proposals, "tap to confirm"
 *   mail              planner-mail: to-dos from an email (title 'Arvy', but it is about email: everything else)
 *   news, test        planner-push: what's new; "Notifications are on"
 *   wake, evening, bed, sauna, gym, kitchen, window, lightsOut, x:<id>   planner-push: the routine reminders
 *   check-here        put up by the phone itself during "Check notifications"
 *  Video calls send no push: they ring in the app (us/call/ring.ts). */
export const ARVY_TITLE = 'Arvy';
export function kindOfPush(tag: string | undefined, title?: string): SoundKind {
  const t = tag || '';
  if (t === 'chat') return title === ARVY_TITLE ? 'arvy' : 'chat';
  if (t.startsWith('arvy')) return 'arvy';
  return 'other';
}
/** A chat message: Arvy's own (by 'arvy') or the other one's. */
export const kindOfMessage = (by: string): SoundKind => (by === 'arvy' ? 'arvy' : 'chat');

/** Not more than once every 3 seconds for each kind: a burst of messages is one sound. */
export const GAP_MS = 3000;
export function makeGate(gap = GAP_MS): (kind: SoundKind, now: number) => boolean {
  const last: Partial<Record<SoundKind, number>> = {};
  return (kind, now) => {
    const was = last[kind];
    if (was !== undefined && now - was < gap) return false;
    last[kind] = now;
    return true;
  };
}

/** New chat messages worth a sound: not seen before, not still on their way, not the person's own, and sent since the
 *  page was last in view (ones that came while it was hidden had the phone's notification). Marks them all as seen.
 *  `first` = the very first list after opening: nothing in it is new. */
export function freshArrivals(rows: { msg: { id: string; at: string; by: string }; sending?: boolean }[], seen: Set<string>, me: string, visibleSince: number, first: boolean): SoundKind[] {
  const out: SoundKind[] = [];
  for (const r of rows) {
    if (r.sending || seen.has(r.msg.id)) continue;
    seen.add(r.msg.id);
    if (first || r.msg.by === me) continue;
    const at = Date.parse(r.msg.at);
    if (!(at >= visibleSince - 5000)) continue;   // a few seconds' slack for the phone's clock against the server's
    out.push(kindOfMessage(r.msg.by));
  }
  return out;
}
