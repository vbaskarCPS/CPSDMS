// src/lib/offline/fieldDay.ts — when a field user's day starts and ends on this phone.
// Starting a day turns on the phone's copy (src/lib/offline/dayStore.ts); ending it wipes it.
import { beginDay, endDay } from './dayStore';
import { setReadMode } from './cache';

/** Today's date on this phone, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A worker opened today's logsheet on this phone. Their screens are phone-first (instant). */
export const beginWorkerDay = async (contractorId: string) => { setReadMode('phoneFirst'); await beginDay(localDay(), `worker:${contractorId}`); };
/** A route manager opened today's map on this phone. Server-first: they see what they just changed. */
export const beginManagerDay = async (userId: string) => { setReadMode('serverFirst'); await beginDay(localDay(), `rm:${userId}`); };
/** The day is over here (finished, signed out): wipe the phone's copy. */
export const endFieldDay = async () => { setReadMode('serverFirst'); await endDay(); };
