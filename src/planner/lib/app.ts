// src/planner/lib/app.ts — which planner this is: Vijay's at /vijayplanner or Rosh's at /roshplanner.
// Same code, two installs: the path prefix picks the manifest, name, colours and router base. The
// signed-in person's profile ('night' | 'morning') picks the routine shape (lib/routine.ts).
export type AppId = 'vijayplanner' | 'roshplanner';
export type Profile = 'night' | 'morning';

export const APPS: Record<AppId, { name: string; short: string; owner: string; profile: Profile; tagline: string; theme: string }> = {
  vijayplanner: { name: 'Vijay Planner', short: 'Planner', owner: 'vijay', profile: 'night', tagline: 'Own the night.', theme: 'navy' },
  roshplanner: { name: 'Rosh Planner', short: 'Rosh', owner: 'rosh', profile: 'morning', tagline: 'Own the morning.', theme: 'plum' },
};

/** The app from the URL (default: Vijay's). */
export function appId(pathname = typeof location !== 'undefined' ? location.pathname : '/'): AppId {
  return /^\/roshplanner(\/|$)/.test(pathname) ? 'roshplanner' : 'vijayplanner';
}
export const app = () => APPS[appId()];
export const appBase = (): string => `/${appId()}`;

/** The profile for a signed-in person: their setting first, else the app they opened. */
export function profileOf(settings?: Record<string, unknown> | null): Profile {
  const p = settings?.profile;
  return p === 'morning' || p === 'night' ? p : app().profile;
}
