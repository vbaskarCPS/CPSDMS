// src/v2/lib/legacy.ts — run the old app's screens (payouts) inside the new app.
// The old services find "their" center through commandCenterService; point it at the
// center picked in the new app, then load the old app's live session for that center.
import type { DailySessionData } from '../../types';

export interface LegacySession { date: string; data: DailySessionData }

/** Points the old services at this center. Must run before any old screen loads. */
export async function pointLegacyAt(centerId: string): Promise<void> {
  const { commandCenterService } = await import('../../lib/commandCenterService');
  const cc = await commandCenterService.getCommandCenterById(centerId);
  if (!cc) throw new Error('Couldn’t load this center in the current app.');
  commandCenterService.setCurrentCommandCenter(cc);
}

/** The old app's live session at this center, or null when none is open. */
export async function legacyLiveSession(centerId: string): Promise<LegacySession | null> {
  await pointLegacyAt(centerId);
  const { sessionService } = await import('../../lib/sessionService');
  const data = await sessionService.getDailySession();
  return data ? { date: data.date, data } : null;
}
