// src/planner/ui/nav.ts — the bottom bar's five buttons and which one a screen belongs to. No React here (tested in
// nav.test.ts). Left to right: Today · RV · Health · Wealth · Lifestyle.
//   RV         opens Arvy's chat (it isn't a page: see Shell.tsx)
//   Health     a menu page (screens/Hub.tsx): Train, Food, and Cycle on the morning profile
//   Wealth     Money (one section, so the button goes straight to it)
//   Lifestyle  a menu page: Plan, Habits, Calendar, Shopping
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
