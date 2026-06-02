// src/lib/managerPalette.ts
//
// Single source of truth for the Floater feature's manager colours (digital-
// mapping CCs only). Extracted here so SessionCommandCenter (config UI),
// RMLogbook, and RMMapTab can all import the SAME palette + assignment function
// without a page-component dependency edge. Keep this the ONLY definition — the
// route-split colour-drift bug is exactly what happens when two copies diverge.
//
// Colour model (locked): each of the CC's RouteManagers gets one of these eight
// hues, assigned by index into the userId-sorted manager list, so a given
// manager's colour is identical on every floater's map. Red (#ef4444) is
// deliberately EXCLUDED — it's reserved on the RM map for "whoever is currently
// looking" (the floater's own arrow + their own directly-attached workers),
// layered on top by RMMapTab at render time.

export const MANAGER_PALETTE: string[] = [
    '#3b82f6', // blue
    '#22c55e', // green
    '#a855f7', // purple
    '#f97316', // orange
    '#14b8a6', // teal
    '#eab308', // yellow
    '#ec4899', // pink
    '#8b5cf6', // violet
  ];
  
  // Given the full sorted list of manager userIds, return the palette colour for
  // one of them. The CALLER sorts (by userId) so the ordering is stable and
  // identical everywhere. Wraps with modulo if a CC ever exceeds 8 managers.
  export function getManagerColor(managerId: string, sortedManagerIds: string[]): string {
    const idx = sortedManagerIds.indexOf(managerId);
    if (idx < 0) return '#9ca3af'; // grey fallback for an unknown id
    return MANAGER_PALETTE[idx % MANAGER_PALETTE.length];
  }
  