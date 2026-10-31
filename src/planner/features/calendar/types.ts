// src/planner/features/calendar/types.ts — the shared household calendar (doc kind 'event', shared by the
// household: Vijay and Rosh see and edit the same events). Key = `${date}~${id}` so a month loads in one range.
export type Who = 'vijay' | 'rosh' | 'both' | 'kiaan';
export type Repeat = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface CalEvent {
  id: string;
  title: string;
  date: string;        // YYYY-MM-DD (the first date for repeating events)
  time?: string;       // HH:MM; absent = all day
  endTime?: string;
  who: Who;
  notes?: string;
  repeat?: Repeat;
  until?: string;      // last date for a repeating event
  skip?: string[];     // dates of a repeating event that were removed
  createdBy?: string;  // username
  createdAt: string;
}

export const WHO_LABEL: Record<Who, string> = { vijay: 'Vijay', rosh: 'Rosh', both: 'Both of us', kiaan: 'Kiaan' };
export const eventKey = (e: { date: string; id: string }) => `${e.date}~${e.id}`;

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x.toISOString().slice(0, 10); };

/** Does this event (or one of its repeats) land on `date`? */
export function occursOn(e: CalEvent, date: string): boolean {
  if (e.skip?.includes(date)) return false;
  if (date < e.date) return false;
  if (!e.repeat || e.repeat === 'none') return e.date === date;
  if (e.until && date > e.until) return false;
  const a = new Date(`${e.date}T12:00:00`), b = new Date(`${date}T12:00:00`);
  const days = Math.round((b.getTime() - a.getTime()) / 864e5);
  switch (e.repeat) {
    case 'daily': return true;
    case 'weekly': return days % 7 === 0;
    case 'biweekly': return days % 14 === 0;
    case 'monthly': return a.getDate() === b.getDate() || (b.getDate() === new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate() && a.getDate() > b.getDate());
    case 'yearly': return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  return false;
}

/** The events on `date`, timed ones first by time. */
export function eventsOn(all: CalEvent[], date: string): CalEvent[] {
  return all.filter(e => occursOn(e, date)).sort((x, y) => (x.time && y.time ? x.time.localeCompare(y.time) : x.time ? 1 : y.time ? -1 : x.title.localeCompare(y.title)));
}
export { addDays, addMonths };
