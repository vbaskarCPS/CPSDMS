// src/planner/features/look/useLook.ts — keeps the look on the page right as the person moves about: each screen
// wears the whole planner's look or its section's own (looks.ts wearing), so it is put on again at every change of
// route, before the new screen is drawn. Used once, beside the router (App.tsx).
import { useEffect, useLayoutEffect } from 'react';
import { lookAt, startLook } from './store';

/** `pathname` is the path inside the app ('/food/add'). */
export function useLook(pathname: string): void {
  // whoever is signed in: their choices, from this phone and then from their other one; off again when they sign out
  useEffect(() => startLook(), []);
  useLayoutEffect(() => { lookAt(pathname); }, [pathname]);
}
