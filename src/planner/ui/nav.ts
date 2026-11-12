// src/planner/ui/nav.ts — the bottom bar's five buttons and which one a screen belongs to. No React here (tested in
// nav.test.ts). Left to right: Today · RV · Health · Wealth · Lifestyle.
//   RV         opens Arvy's chat (it isn't a page: see Shell.tsx)
//   Health     a menu page (screens/Hub.tsx): Train, Food, and Cycle on the morning profile
//   Wealth     Money (one section, so the button goes straight to it)
//   Lifestyle  a menu page: Plan, Habits, Calendar, Shopping
// Health and Wealth can also be dragged up: that goes straight to the camera, for a meal or a receipt (SHOTS, pull).
import type { ShotKind } from '../lib/quickShot';

export type NavGroup = 'today' | 'health' | 'wealth' | 'lifestyle';

/** Where each button goes. */
export const NAV_TO: Record<NavGroup, string> = { today: '/', health: '/health', wealth: '/money', lifestyle: '/lifestyle' };

/** The first part of each section's path → the button it sits under. */
const SECTION: Record<string, NavGroup> = {
  health: 'health', workout: 'health', food: 'health', cycle: 'health',
  money: 'wealth',
  lifestyle: 'lifestyle', plan: 'lifestyle', habits: 'lifestyle', calendar: 'lifestyle', shop: 'lifestyle',
};

/** The button to light up for a path (inside the app: '/workout/live/3'). null = none of them (Settings). */
export function groupOf(pathname: string): NavGroup | null {
  const first = pathname.split('/').filter(Boolean)[0];
  if (!first) return 'today';
  return SECTION[first] ?? null;
}

/** Drag one of these buttons up and let go: the camera opens for this kind of photo. */
export const SHOTS: Partial<Record<NavGroup, { kind: ShotKind; label: string }>> = {
  health: { kind: 'meal', label: 'Meal photo' },
  wealth: { kind: 'receipt', label: 'Receipt photo' },
};
/** How far up (px) the finger has to go before letting go takes the photo, and how far before it counts as a drag at all. */
export const PULL_ARM = 44;
export const PULL_SLOP = 10;
/** A drag `up` px above where it started: how far the bubble has risen (0 to 1), and whether letting go takes the photo. */
export function pull(up: number): { lift: number; armed: boolean } {
  const u = Math.max(0, up);
  return { lift: Math.min(1, u / PULL_ARM), armed: u >= PULL_ARM };
}

/** RV held down this long (ms) opens Arvy listening; a shorter press is a tap. The finger may wander this far (px). */
export const RV_HOLD_MS = 400;
export const RV_HOLD_SLOP = 14;
/** RV dragged up to one side and held there this long (ms): that one opens listening, to talk instead of type. */
export const RV_VOICE_MS = 2000;
