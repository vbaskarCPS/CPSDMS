// src/lib/offline/fieldDay.ts — when a field user's day starts and ends on this phone.
// Starting a day turns on the phone's copy (src/lib/offline/dayStore.ts); ending it wipes it.
import { beginDay, endDay } from './dayStore';
import { setReadMode } from './cache';
import { setViewOnlyWhenOffline } from './net';

/** Today's date on this phone, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A worker opened today's logsheet on this phone. Their screens are phone-first (instant). */
export const beginWorkerDay = async (contractorId: string) => {
  await import('./fieldWrites');   // their saves go through the outbox (src/lib/offline/outbox.ts)
  setReadMode('phoneFirst'); setViewOnlyWhenOffline(false);
  await beginDay(localDay(), `worker:${contractorId}`);
};
/** A route manager opened today's map on this phone. Server-first: they see what they just changed.
 *  With no signal they're view only: changes are refused until it's back (src/lib/offline/net.ts). */
export const beginManagerDay = async (userId: string) => { setReadMode('serverFirst'); setViewOnlyWhenOffline(true); await beginDay(localDay(), `rm:${userId}`); };
/** The day is over here (finished, signed out): wipe the phone's copy. */
export const endFieldDay = async () => { setReadMode('serverFirst'); setViewOnlyWhenOffline(false); await endDay(); };
