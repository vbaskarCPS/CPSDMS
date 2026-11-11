// src/v2/lib/bennyTexts.ts — the texts the Benny sets up for workers: the pure parts of its card.
//
// The card sends nothing. Each worker has a Text button that is an ordinary sms: link: it opens the phone's Messages
// with the text written, and the person presses send. The person can change a text first. A tapped button is marked
// Opened (not "sent": only the phone knows that), and the app keeps the text it opened for that worker.
// No database here: tested in bennyTexts.test.ts. BennyTexts.tsx draws the card; bennyActions.ts records an open.

/** One worker on the card, as the database checked it (benny_check_texts). phone is only there for the link. */
export interface TextPerson {
  hire_id: string; cn: string; name: string; first: string; phone?: string; text: string;
  days_worked?: number; days_on_list?: number; last_worked?: string; earlier?: number;
}
export interface TextsCheck {
  ok: boolean; problems?: string[]; date: string; who: 'no_shows' | 'showed' | 'booked' | 'named';
  /** the tone asked for, when the Benny wrote the texts; own_words when it is the person's wording with the name filled in */
  tone?: string; own_words?: boolean; people: TextPerson[]; no_cell?: string[];
}
/** What the person did on the card: which buttons they tapped (when), and the texts they changed. Keyed by CN. */
export interface TextsState { opened?: Record<string, number>; edits?: Record<string, string> }

export const TEXT_MAX = 480;
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00').toLocaleDateString('en-CA', opts);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Text 5 who didn't show · Wed, Nov 11" */
export function textsTitle(c: Pick<TextsCheck, 'who' | 'date' | 'people'>): string {
  const n = c.people.length; const when = day(c.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const who = c.who === 'no_shows' ? `${n} who didn’t show` : c.who === 'showed' ? `${n} who showed` : c.who === 'booked' ? `everyone on the list (${n})`
    : n <= 2 ? c.people.map(p => p.first).join(' and ') : plural(n, 'worker');
  return `Text ${who} · ${when}`;
}

/** What the app knows about a worker, under their name: "worked 3 of 10 days · last Nov 4 · 1 earlier text" (earlier = texts
 *  opened for them from here before; the database counts the latest three). */
export function personSub(p: Pick<TextPerson, 'days_worked' | 'days_on_list' | 'last_worked' | 'earlier'>, date: string): string {
  const worked = p.days_worked || 0; const listed = Math.max(p.days_on_list || 0, worked);
  const earlier = !p.earlier ? '' : ` · ${p.earlier >= 3 ? '3 or more earlier texts' : plural(p.earlier, 'earlier text')}`;
  if (!listed) return `first day on the list${earlier}`;
  if (!worked) return `never worked · ${plural(listed, 'day')} on the list${earlier}`;
  const before = new Date(date + 'T12:00'); before.setDate(before.getDate() - 1);
  const yesterday = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}-${String(before.getDate()).padStart(2, '0')}`;
  const last = !p.last_worked ? '' : p.last_worked === yesterday ? ' · last yesterday' : p.last_worked === date ? ' · last today' : ` · last ${day(p.last_worked, { month: 'short', day: 'numeric' })}`;
  return `worked ${worked} of ${plural(listed, 'day')}${last}${earlier}`;
}

/** The text as it stands: the person's change if they made one, else what the card came with. */
export function textOf(p: Pick<TextPerson, 'cn' | 'text'>, state?: TextsState | null): string {
  const edit = state?.edits?.[p.cn];
  return typeof edit === 'string' && edit.trim() ? edit.trim().slice(0, TEXT_MAX) : p.text;
}

/** The link under a Text button: opens Messages to that number with the text written (the form iPhone and Android both take). */
export function textHref(phone: string, body: string): string {
  return `sms:${phone.replace(/[^0-9+]/g, '')}?&body=${encodeURIComponent(body)}`;
}

/** Everything on the card as plain lines, for Copy all (names and texts; no numbers). */
export function textsCopy(c: Pick<TextsCheck, 'people'>, state?: TextsState | null): string {
  return c.people.map(p => `${p.name}: ${textOf(p, state)}`).join('\n');
}

/** The line under the rows: whose words these are, and that nothing is sent from here. */
export function textsFoot(c: Pick<TextsCheck, 'tone' | 'own_words' | 'no_cell'>): string {
  const whose = c.own_words ? 'Your wording, with each name filled in. ' : `${c.tone ? `Tone: ${c.tone}. ` : ''}Written by the Benny: tap a text to change it. `;
  const none = c.no_cell?.length ? ` No cell number: ${c.no_cell.join(', ')}.` : '';
  return `${whose}Each button opens Messages with the text written. You press send; nothing is sent from here.${none}`;
}

/** What happened on a texts card, for the Benny and for the card's last line: whose Messages was opened (opened is not sent). */
export function textsSaid(people: { cn: string; name: string }[], state?: TextsState | null): string {
  const opened = people.filter(p => state?.opened?.[p.cn]); const first = (n: string) => n.split(' ')[0];
  if (!opened.length) return 'No text opened yet.';
  if (opened.length === people.length) return people.length === 1 ? `Opened Messages for ${people[0].name}.` : `Opened Messages for all ${people.length}.`;
  return `Opened Messages for ${opened.length} of ${people.length} (not ${people.filter(p => !state?.opened?.[p.cn]).map(p => first(p.name)).join(', ')}).`;
}
