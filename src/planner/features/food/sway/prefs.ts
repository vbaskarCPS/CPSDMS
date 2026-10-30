// src/planner/features/food/sway/prefs.ts — is the sway guide on? (doc kind 'foodprefs', key 'sway').
// Default: on for the morning profile (Rosh), off otherwise.
import { getPass } from '../../../lib/auth';
import { getDoc, putDoc } from '../../../lib/docs';
import { profileOf } from '../../../lib/app';
import { swayTags } from '../../../lib/ai';
import type { FoodItem } from '../model';
import { swayTag } from './tag';

export interface SwayPrefs { on: boolean }
let cached: SwayPrefs | null = null;

export const swayDefault = (): boolean => profileOf(getPass()?.user.settings as { profile?: string } | undefined) === 'morning';
export const isMorning = (): boolean => profileOf(getPass()?.user.settings as { profile?: string } | undefined) === 'morning';

export async function loadSwayPrefs(): Promise<SwayPrefs> {
  if (cached) return cached;
  const d = await getDoc<SwayPrefs>('foodprefs', 'sway').catch(() => null);
  cached = d && typeof d.on === 'boolean' ? d : { on: swayDefault() };
  return cached;
}
export const swayOnNow = (): boolean => (cached ? cached.on : swayDefault());
export async function saveSwayPrefs(p: SwayPrefs): Promise<void> { cached = p; await putDoc('foodprefs', 'sway', p); }

/** Tag a meal's items: keywords first, the AI once for whatever is still neutral. Never throws. */
export async function tagItems(items: FoodItem[]): Promise<FoodItem[]> {
  const out = items.map(i => ({ ...i, sway: i.sway || swayTag(i.name) }));
  const unknown = [...new Set(out.filter(i => i.sway === 'neutral').map(i => i.name.trim()).filter(Boolean))];
  if (unknown.length) {
    try {
      const tags = await swayTags(unknown);
      for (const i of out) { const t = tags[i.name.trim()]; if (t === 'go' || t === 'ease' || t === 'neutral') i.sway = t; }
    } catch { /* keep the keyword tags */ }
  }
  return out;
}
