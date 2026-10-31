// src/planner/features/calendar/store.ts — reading and writing events. Repeating events are keyed by their
// first date, so a load reaches back a year to catch them; one-offs come from the visible range.
import { getDocs, putDoc } from '../../lib/docs';
import { addDays, eventKey, type CalEvent } from './types';

export async function loadEvents(from: string, to: string): Promise<CalEvent[]> {
  const docs = await getDocs<CalEvent>('event', `${addDays(from, -366)}~`, `${to}~￿`);
  return docs.map(d => d.data).filter(e => e && e.id && e.title).filter(e => (e.repeat && e.repeat !== 'none') ? true : e.date >= from && e.date <= to);
}
export const saveEvent = (e: CalEvent) => putDoc('event', eventKey(e), e);
/** Soft-remove: a JSON null, never a DELETE. */
export const removeEvent = (e: CalEvent) => putDoc('event', eventKey(e), null);
