// src/lib/mapLogsheetStats.ts
//
// Today / Pace / Coverage maths for the map logsheet. Shared by the worker's
// map (MapLogsheetPage) and the manager's cart panel (RMMapTab → CartMapPanel)
// so both always show the same numbers. Pure functions — no React, no I/O.

import { format } from 'date-fns';
import { PendingSale, SessionTransaction } from '../types';
import { HouseDisposition, HouseView, RouteHouse, HouseLocator, routeHouseId } from './mapLogsheetService';

/** Does this timestamp fall on the session's day (local time)? `ymd` is the
 *  daily session's date ("YYYY-MM-DD"); when it's unknown, today's date is used. */
export const isOnDay = (iso: string, ymd: string | null) => {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return day === (ymd || format(new Date(), 'yyyy-MM-dd'));
};

/** Who counts as "this cart" for Today and Pace. */
export interface CartScope {
  workerIds: Set<string>;
  sessionIds: Set<string>;
}

/** A knock belongs to the cart if it was made by someone on the cart or in
 *  the cart's session. Rows with neither (very old) still count. */
export const isCartKnock = (d: HouseDisposition, cart: CartScope) =>
  (!d.workerId && !d.sessionId)
  || (!!d.workerId && cart.workerIds.has(d.workerId))
  || (!!d.sessionId && cart.sessionIds.has(d.sessionId));

// ---------------------------------------------------------------------------
// TODAY
// ---------------------------------------------------------------------------
export interface KnockCounts {
  no: number; notHome: number; goBack: number; invalid: number;
  pending: number; completed: number;
  knocks: number; answered: number; sales: number;
  answerRate: number; closingRate: number;
}

export function computeCounts(
  dispositions: Map<string, HouseDisposition>,
  houseViews: HouseView[],
  sessionDate: string | null,
  cart: CartScope,
): KnockCounts {
  let no = 0, notHome = 0, goBack = 0, invalid = 0;
  dispositions.forEach(d => {
    if (!isOnDay(d.updatedAt, sessionDate) || !isCartKnock(d, cart)) return;
    if (d.status === 'no') no++;
    else if (d.status === 'not_home') notHome++;
    else if (d.status === 'invalid') invalid++;
    else goBack++;
  });
  const pending = houseViews.filter(v => v.state === 'pending').length;
  const completed = houseViews.filter(v => v.state === 'completed').length;
  // Knocks    = No + Not Home + Go Back + Invalid + Pending + Done
  // Answered  = Knocks − Not Home − Invalid   (a door that opened AND could buy; Go Back counts)
  // Answer %  = Answered ÷ Knocks
  // Closing % = (Pending + Done) ÷ Answered
  const knocks = no + notHome + goBack + invalid + pending + completed;
  const answered = knocks - notHome - invalid;
  const sales = pending + completed;
  const answerRate = knocks > 0 ? answered / knocks : 0;
  const closingRate = answered > 0 ? sales / answered : 0;
  return { no, notHome, goBack, invalid, pending, completed, knocks, answered, sales, answerRate, closingRate };
}

/** Average charge (today): total price of completed sales ÷ number of them.
 *  Upgrades/add-ons are excluded so the figure reads as "what a door is worth". */
export function computeAvgCharge(transactions: SessionTransaction[], sessionDate: string | null) {
  const sales = transactions.filter(tx => tx.timestamp && isOnDay(tx.timestamp, sessionDate) && (tx.type === 'Sale' || tx.type === 'Production'));
  const total = sales.reduce((sum, tx) => sum + (Number(tx.price) || 0), 0);
  return { count: sales.length, total, avg: sales.length ? total / sales.length : 0 };
}

// ---------------------------------------------------------------------------
// PACE (today) — one event per knocked house, timed by its latest state
// ---------------------------------------------------------------------------
export type KnockEvent = { t: number; kind: 'no' | 'not_home' | 'go_back' | 'invalid' | 'pending' | 'sale'; id: string };

export function computeKnockEvents(
  dispositions: Map<string, HouseDisposition>,
  pendingSales: PendingSale[],
  transactions: SessionTransaction[],
  houses: RouteHouse[],
  sessionDate: string | null,
  cart: CartScope,
): KnockEvent[] {
  const byHouse = new Map<string, KnockEvent>();
  const loc = new HouseLocator(houses);
  // Dispositions marked today by this cart
  dispositions.forEach(d => {
    if (!isOnDay(d.updatedAt, sessionDate) || !isCartKnock(d, cart)) return;
    const id = routeHouseId(d.routeCode, d.houseKey);
    byHouse.set(id, { t: new Date(d.updatedAt).getTime(), kind: d.status, id });
  });
  // Pending sales parked today (override a disposition at the same house)
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt' && ps.parentId) continue;
    if (!ps.createdAt || !isOnDay(ps.createdAt, sessionDate)) continue;
    const id = loc.idForAddress(ps.routeCode || '', ps.houseNumber, ps.streetName);
    if (!id) continue;
    byHouse.set(id, { t: new Date(ps.createdAt).getTime(), kind: 'pending', id });
  }
  // Completed transactions today (override everything)
  for (const tx of transactions) {
    if (!tx.timestamp || !isOnDay(tx.timestamp, sessionDate)) continue;
    const id = loc.idForFullAddress(tx.routeCode || '', tx.address);
    if (!id) continue;
    byHouse.set(id, { t: new Date(tx.timestamp).getTime(), kind: 'sale', id });
  }
  return [...byHouse.values()].sort((a, b) => a.t - b.t);
}

export interface Pace {
  n: number; first: number; last: number; spanHrs: number; doorsPerHour: number;
  longestGapMs: number; gapAt: number;
  minsToFirstSale: number | null; avgMinsBetweenSales: number | null;
  hours: Array<{ hour: number; knocks: number; sales: number }>;
}

export function computePace(knockEvents: KnockEvent[]): Pace | null {
  const n = knockEvents.length;
  if (n === 0) return null;
  const first = knockEvents[0].t;
  const last = knockEvents[n - 1].t;
  const spanHrs = Math.max((last - first) / 3600000, 1 / 60); // never divide by zero
  const doorsPerHour = n / spanHrs;
  let longestGapMs = 0, gapAt = first;
  for (let i = 1; i < n; i++) {
    const g = knockEvents[i].t - knockEvents[i - 1].t;
    if (g > longestGapMs) { longestGapMs = g; gapAt = knockEvents[i - 1].t; }
  }
  const saleTimes = knockEvents.filter(e => e.kind === 'sale' || e.kind === 'pending').map(e => e.t);
  const minsToFirstSale = saleTimes.length ? (saleTimes[0] - first) / 60000 : null;
  let avgMinsBetweenSales: number | null = null;
  if (saleTimes.length >= 2) avgMinsBetweenSales = (saleTimes[saleTimes.length - 1] - saleTimes[0]) / 60000 / (saleTimes.length - 1);
  // Knocks by hour, from the first knock's hour to the current hour
  const startHour = new Date(first).getHours();
  const endHour = Math.max(new Date().getHours(), new Date(last).getHours());
  const hours: Array<{ hour: number; knocks: number; sales: number }> = [];
  for (let h = startHour; h <= endHour; h++) hours.push({ hour: h, knocks: 0, sales: 0 });
  for (const e of knockEvents) {
    const h = new Date(e.t).getHours() - startHour;
    if (h >= 0 && h < hours.length) { hours[h].knocks++; if (e.kind === 'sale' || e.kind === 'pending') hours[h].sales++; }
  }
  return { n, first, last, spanHrs, doorsPerHour, longestGapMs, gapAt, minsToFirstSale, avgMinsBetweenSales, hours };
}

export function computeGoBackQueue(houseViews: HouseView[], sessionDate: string | null): HouseView[] {
  return houseViews
    .filter(v => v.state === 'go_back' && v.disposition && isOnDay(v.disposition.updatedAt, sessionDate))
    .sort((a, b) => new Date(a.disposition!.updatedAt).getTime() - new Date(b.disposition!.updatedAt).getTime());
}

// ---------------------------------------------------------------------------
// COVERAGE (all time) — knocked = any disposition, pending sale or completed
// job at the house, from any date. Coverage belongs to the route, so coming
// back to it on a later session still shows what's been done.
// ---------------------------------------------------------------------------
export interface CoverageStreet {
  key: string; name: string; routeCode: string;
  total: number; knocked: number; sales: number; skipped: number;
  lng: number; lat: number;
}
export interface Coverage {
  total: number; knocked: number; untouched: number; skipped: number;
  pctKnocked: number; streets: CoverageStreet[];
}

export function computeCoverage(houseViews: HouseView[]): Coverage {
  const knockedIds = new Set(
    houseViews
      .filter(v => v.disposition || v.state === 'pending' || v.state === 'completed')
      .map(v => routeHouseId(v.house.routeCode, v.house.houseKey)),
  );
  const total = houseViews.length;
  const knocked = houseViews.filter(v => knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey))).length;
  // Per street, per side (odd/even), sorted by number: an untouched house
  // with a knocked house before AND after it on the same side is "skipped".
  const streets = new Map<string, CoverageStreet>();
  const groups = new Map<string, HouseView[]>();
  for (const v of houseViews) {
    const k = `${v.house.routeCode}|${v.house.streetNorm}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  let skippedTotal = 0;
  groups.forEach((list, k) => {
    const first = list[0];
    const st: CoverageStreet = { key: k, name: first.house.streetName, routeCode: first.house.routeCode, total: list.length, knocked: 0, sales: 0, skipped: 0, lng: 0, lat: 0 };
    let sLng = 0, sLat = 0;
    for (const v of list) {
      sLng += v.house.lng; sLat += v.house.lat;
      if (knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey))) st.knocked++;
      if (v.state === 'pending' || v.state === 'completed') st.sales++;
    }
    st.lng = sLng / list.length; st.lat = sLat / list.length;
    for (const parity of [0, 1]) {
      const side = list.filter(v => v.house.civicNo % 2 === parity).sort((a, b) => a.house.civicNo - b.house.civicNo);
      const flags = side.map(v => knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey)));
      let seenKnocked = false;
      let pendingGap = 0;
      for (const f of flags) {
        if (f) { if (seenKnocked) st.skipped += pendingGap; seenKnocked = true; pendingGap = 0; }
        else if (seenKnocked) pendingGap++;
      }
    }
    skippedTotal += st.skipped;
    streets.set(k, st);
  });
  const streetList = [...streets.values()].sort((a, b) => (b.total - b.knocked) - (a.total - a.knocked) || a.name.localeCompare(b.name));
  return { total, knocked, untouched: total - knocked, skipped: skippedTotal, pctKnocked: total > 0 ? knocked / total : 0, streets: streetList };
}
