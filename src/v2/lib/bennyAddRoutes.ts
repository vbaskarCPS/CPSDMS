// src/v2/lib/bennyAddRoutes.ts — the Benny's "add maps or routes to a manager on the live day" card. The database checks
// it (benny_check_add_routes): which routes are new for that manager, which they already have, which another manager
// holds (left off, never moved). On the tap the app adds them with Session details' own save (addLiveRoutes): add only.
export interface AddRoutesCheck {
  ok: boolean; problems?: string[]; date: string; stamp: string;
  manager: { id: string; name: string; me?: boolean };
  maps: { map: string; total: number; new: number }[];
  new: { code: string; area: string; number: number }[];
  mine: string[];
  other: { code: string; manager: string }[];
  open_prebooks?: number;
}

/** "SWS34–SWS59" for a run of routes, else the codes (a few, then "and N more"). */
export function routeSpan(codes: string[]): string {
  if (!codes.length) return '';
  if (codes.length === 1) return codes[0];
  const split = (c: string) => { const m = /^([A-Z]+)(\d+)$/i.exec(c); return m ? { p: m[1].toUpperCase(), n: Number(m[2]) } : null; };
  const parts = codes.map(split);
  const run = parts.every((x, i) => x && parts[0] && x.p === parts[0].p && (i === 0 || x.n === parts[i - 1]!.n + 1));
  if (run) return `${codes[0]}–${codes[codes.length - 1]}`;
  return codes.length <= 6 ? codes.join(', ') : `${codes.slice(0, 5).join(', ')} and ${codes.length - 5} more`;
}

export function addRoutesCard(c: AddRoutesCheck): { title: string; lines: string[]; action: string } {
  const first = c.manager.me ? 'your' : `${c.manager.name.split(' ')[0]}’s`;
  const n = c.new.length;
  const byMap = c.maps.map(m => {
    const codes = c.new.filter(r => r.area === m.map).map(r => r.code);
    return `${m.map}: ${m.new} new route${m.new === 1 ? '' : 's'}${codes.length ? ` (${routeSpan(codes)})` : ''}${m.new < m.total ? ` of ${m.total}` : ''}`;
  });
  return {
    title: `Add ${n} route${n === 1 ? '' : 's'} to ${first} live map`,
    lines: [
      ...byMap,
      ...(c.mine.length ? [`Already on ${first} map: ${routeSpan(c.mine)}`] : []),
      ...(c.other.length ? [`Left off, another manager has them: ${routeSpan(c.other.map(o => o.code))} (${[...new Set(c.other.map(o => o.manager))].join(', ')})`] : []),
      `${c.open_prebooks || 0} open prebook${c.open_prebooks === 1 ? '' : 's'} come${c.open_prebooks === 1 ? 's' : ''} with them`,
      'Mid-day, routes can only be added, not taken off again.',
      `${c.manager.me ? 'You see' : `${c.manager.name.split(' ')[0]} sees`} them after reloading the route manager map.`,
    ],
    action: 'Add the routes',
  };
}

export const addedRoutesSaid = (c: AddRoutesCheck, n: number) =>
  `Added ${n} route${n === 1 ? '' : 's'} to ${c.manager.me ? 'your' : `${c.manager.name}’s`} live map${c.maps.length ? ` (${c.maps.map(m => m.map).join(', ')})` : ''}. Reload the route manager map to see them.`;
