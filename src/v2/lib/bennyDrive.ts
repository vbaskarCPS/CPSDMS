// src/v2/lib/bennyDrive.ts — a planned order (drop / pickup / check) put in driving order by the road's own times.
//
// The server plans the stops and orders them in straight lines, which can't see a river or a bridge. Here, in the app
// (the map token only works from the app's pages), the stops are re-ordered by Mapbox's driving times between every
// pair, and the road line is fetched for the map. Straight lines stay as the fallback: a card never waits on this for
// long, and never fails because of it.
import type { Stop, StopKind, StopsCheck } from './bennyActions';
import type { BennyMap } from './benny';

export const STOP_WORD: Record<StopKind, string> = { drop: 'Drop', pickup: 'Pickup', check: 'Check' };
const MAX_POINTS = 25;          // Mapbox: 25 coordinates per matrix or directions request
const WAIT_MS = 6000;
const NO_ROAD = 1e9;            // a pair Mapbox finds no road between

const token = () => (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';

/** What a visiting order costs: cost[a][b] = from a to b; start = where the drive begins (null = at the first stop). */
export function orderCost(cost: number[][], order: number[], start: number | null): number {
  let sum = start != null && order.length ? cost[start][order[0]] : 0;
  for (let i = 0; i + 1 < order.length; i++) sum += cost[order[i]][order[i + 1]];
  return sum;
}

/** The cheapest order to visit `stops` in. Up to 8 stops every order is tried (so it is the best one); beyond that,
 *  nearest-next, then reversing stretches and moving single stops until nothing gets cheaper. Costs may differ by
 *  direction (one-way streets), so every candidate is costed whole. */
export function bestOrder(cost: number[][], stops: number[], start: number | null): number[] {
  if (stops.length < 2) return [...stops];
  if (stops.length <= 8) {
    let best = [...stops], bestCost = Infinity;
    const walk = (done: number[], left: number[], soFar: number) => {
      if (soFar >= bestCost) return;
      if (!left.length) { best = done; bestCost = soFar; return; }
      for (let i = 0; i < left.length; i++) {
        const next = left[i]; const from = done.length ? done[done.length - 1] : start;
        walk([...done, next], [...left.slice(0, i), ...left.slice(i + 1)], soFar + (from == null ? 0 : cost[from][next]));
      }
    };
    walk([], stops, 0);
    return best;
  }
  const nearestFrom = (first: number | null): number[] => {
    const left = new Set(stops); const out: number[] = [];
    let at = first;
    if (at != null && left.has(at)) { out.push(at); left.delete(at); }
    while (left.size) {
      let pick = -1, d = Infinity;
      for (const s of left) { const c = at == null ? 0 : cost[at][s]; if (c < d) { d = c; pick = s; } }
      out.push(pick); left.delete(pick); at = pick;
    }
    return out;
  };
  // from the start when there is one; else the best of starting at each stop
  let order = start != null ? nearestFrom(start) : stops.map(s => nearestFrom(s)).sort((a, b) => orderCost(cost, a, null) - orderCost(cost, b, null))[0];
  let now = orderCost(cost, order, start);
  for (let pass = 0, better = true; better && pass < 40; pass++) {
    better = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const tries = [
        [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)],                              // reverse a stretch
        (() => { const t = [...order]; const [x] = t.splice(i, 1); t.splice(j, 0, x); return t; })(),                    // move one stop later
        (() => { const t = [...order]; const [x] = t.splice(j, 1); t.splice(i, 0, x); return t; })(),                    // or earlier
      ];
      for (const t of tries) { const c = orderCost(cost, t, start); if (c < now - 1e-6) { order = t; now = c; better = true; } }
    }
  }
  return order;
}

async function get<T>(url: string, fetcher: typeof fetch): Promise<T | null> {
  const stop = new AbortController(); const timer = setTimeout(() => stop.abort(), WAIT_MS);
  try { const res = await fetcher(url, { signal: stop.signal }); return res.ok ? await res.json() as T : null; }
  catch { return null; }
  finally { clearTimeout(timer); }
}

export interface ByRoad { check: StopsCheck; line: [number, number][] | null }

/** The same plan with its stops in driving order, the drive's minutes and kilometres, and the road line for the map.
 *  null = leave the plan as it came (no token, too many stops, or the roads couldn't be read). */
export async function byRoad(c: StopsCheck, fetcher: typeof fetch = fetch, key: string = token()): Promise<ByRoad | null> {
  if (!key || key === 'pk.test' || !c.stops.length) return null;
  const pts = [...(c.start ? [c.start] : []), ...c.stops];
  if (pts.length < 2 || pts.length > MAX_POINTS) return null;
  const coords = (list: { lat: number; lng: number }[]) => list.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const m = await get<{ code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] }>(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords(pts)}?annotations=duration,distance&access_token=${key}`, fetcher);
  if (!m || m.code !== 'Ok' || !m.durations || m.durations.length !== pts.length) return null;
  const secs = m.durations.map(row => row.map(v => (typeof v === 'number' ? v : NO_ROAD)));
  const off = c.start ? 1 : 0;
  const order = bestOrder(secs, c.stops.map((_, i) => i + off), c.start ? 0 : null);
  const total = orderCost(secs, order, c.start ? 0 : null);
  if (total >= NO_ROAD) return null;   // a stop no road reaches: keep the straight-line plan
  const metres = (() => { let d = 0; const chain = [...(c.start ? [0] : []), ...order]; for (let i = 0; i + 1 < chain.length; i++) d += m.distances?.[chain[i]]?.[chain[i + 1]] || 0; return d; })();
  const stops: Stop[] = order.map((ix, i) => { const s = c.stops[ix - off]; return { ...s, n: i + 1, label: `${STOP_WORD[c.kind]} ${i + 1} · ${s.who}` }; });
  // the road itself, for the map (the plan stands without it)
  const r = await get<{ code?: string; routes?: { geometry?: { coordinates?: [number, number][] }; duration?: number; distance?: number }[] }>(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords([...(c.start ? [c.start] : []), ...stops])}?geometries=geojson&overview=full&access_token=${key}`, fetcher);
  const route = r?.code === 'Ok' ? r.routes?.[0] : null;
  const line = route?.geometry?.coordinates?.length ? route.geometry.coordinates : null;
  return {
    check: { ...c, stops, by_road: true, minutes: Math.max(1, Math.round((route?.duration ?? total) / 60)), km: Math.round(((route?.distance ?? metres) / 1000) * 10) / 10 },
    line,
  };
}

/** The order in words, for the answer (and for the voice): "Nathan, then Kyle + David, then Favour: about 31 min of driving (24 km)." */
export function orderInWords(c: StopsCheck): string {
  const names = c.stops.map(s => s.who);
  const list = names.length > 1 ? `${names[0]}, then ${names.slice(1).join(', then ')}` : names[0] || '';
  return `${list}: ${c.by_road ? `about ${c.minutes} min of driving (${c.km} km)` : `about ${c.km} km in a straight line`}.`;
}

/** The Benny's answer for an order, with the order as it will be dropped: in words under the answer, numbered on the
 *  map, and along the road when the road is known. */
export function withOrder<A extends { reply: string; map: BennyMap | null }>(a: A, plan: StopsCheck, road: ByRoad | null): A & { proposal: { kind: 'stops'; check: StopsCheck } } {
  const check = road?.check || plan;
  const map = a.map ? { ...a.map, pins: check.stops.map(s => ({ lat: s.lat, lng: s.lng, label: s.label, route: s.route || null, n: s.n })), ...(road?.line ? { path: road.line } : {}) } : a.map;
  return { ...a, reply: `${a.reply}\n\n**Order:** ${orderInWords(check)}`.trim(), map, proposal: { kind: 'stops', check } };
}
