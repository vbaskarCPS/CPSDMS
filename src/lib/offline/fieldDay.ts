// src/lib/offline/fieldDay.ts — when a field user's day starts and ends on this phone.
// Starting a day turns on the phone's copy (src/lib/offline/dayStore.ts); ending it wipes it.
import { beginDay, endDay } from './dayStore';

/** Today's date on this phone, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A worker opened today's logsheet on this phone. */
export const beginWorkerDay = (contractorId: string) => beginDay(localDay(), `worker:${contractorId}`);
/** A route manager opened today's map on this phone. */
export const beginManagerDay = (userId: string) => beginDay(localDay(), `rm:${userId}`);
/** The day is over here (finished, signed out): wipe the phone's copy. */
export const endFieldDay = () => endDay();
