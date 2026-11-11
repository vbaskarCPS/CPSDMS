// src/planner/features/us/occasions.ts — the occasions the chat's stickers are for, and which one is coming up next.
// No React here (tested in stickers.test.ts). Halloween, Diwali, Christmas, New Year, Valentine's Day and Easter have
// their dates worked out here; birthdays come from the household calendar (a yearly event with "birthday" in its
// title), so nobody's date of birth is written into the code.

export type OccasionId = 'halloween' | 'diwali' | 'christmas' | 'newyear' | 'valentine' | 'easter' | 'birthday';
/** An occasion with its next date (today counts). `id` picks the sticker set; a birthday carries whose it is. */
export interface Occasion { id: OccasionId; name: string; date: string; days: number }

// Diwali follows the lunar calendar: the main day (Lakshmi Puja) as commonly published. Regions and traditions can
// differ by a day. Years past the table fall back to no date (the stickers stay; only the countdown goes).
const DIWALI: Record<number, string> = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26', 2031: '11-14', 2032: '11-02' };
const two = (n: number) => String(n).padStart(2, '0');

/** Easter Sunday (Western churches) for a year, as MM-DD. The "anonymous Gregorian" reckoning. */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${two(month)}-${two(day)}`;
}
const daysBetween = (from: string, to: string): number => {
  const at = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((at(to) - at(from)) / 864e5);
};
/** The next time a yearly day comes round, today included. `on(year)` gives that year's MM-DD (or nothing). */
function next(today: string, on: (year: number) => string | undefined): string | null {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) { const md = on(year); if (md && `${year}-${md}` >= today) return `${year}-${md}`; }
  return null;
}

/** A birthday on the calendar: whose, and the day (MM-DD). */
export interface Birthday { name: string; day: string }
/** Birthdays from the household's calendar: yearly events with "birthday" in the title ("Rosh's birthday"). */
export function birthdaysFrom(events: { title?: string; date?: string; repeat?: string }[]): Birthday[] {
  const out: Birthday[] = [];
  for (const e of events) {
    if (!e || e.repeat !== 'yearly' || !/birthday|b-?day/i.test(e.title || '') || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
    const name = (e.title || '').replace(/[’']s\b/g, '').replace(/birthday|b-?day/ig, '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 20);
    const day = (e.date as string).slice(5);
    if (!out.some(b => b.day === day && b.name === name)) out.push({ name, day });
  }
  return out;
}

/** Every occasion with its next date, soonest first; ones with no date known come last. */
export function upcoming(today: string, birthdays: Birthday[] = []): Occasion[] {
  const fixed: [OccasionId, string, (y: number) => string | undefined][] = [
    ['halloween', 'Halloween', () => '10-31'], ['diwali', 'Diwali', y => DIWALI[y]], ['christmas', 'Christmas', () => '12-25'],
    ['newyear', 'New Year', () => '01-01'], ['valentine', 'Valentine’s Day', () => '02-14'], ['easter', 'Easter', easter],
  ];
  const list: (Occasion | { id: OccasionId; name: string; date: ''; days: number })[] = fixed.map(([id, name, on]) => {
    const date = next(today, on);
    return date ? { id, name, date, days: daysBetween(today, date) } : { id, name, date: '' as const, days: Infinity };
  });
  for (const b of birthdays) {
    const date = next(today, () => b.day);
    if (date) list.push({ id: 'birthday', name: b.name ? `${b.name}’s birthday` : 'Birthday', date, days: daysBetween(today, date) });
  }
  if (!birthdays.length) list.push({ id: 'birthday', name: 'Birthdays', date: '', days: Infinity });
  return (list as Occasion[]).sort((a, b) => a.days - b.days);
}
/** "in 44 days", "tomorrow", "today!"; nothing when the date isn't known. */
export function countdown(o: Occasion): string {
  if (!Number.isFinite(o.days)) return '';
  return o.days === 0 ? 'today!' : o.days === 1 ? 'tomorrow' : `in ${o.days} days`;
}
