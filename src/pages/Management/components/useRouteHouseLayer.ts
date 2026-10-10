// src/pages/Management/components/useRouteHouseLayer.ts
//
// The RM map's house layer: every house on every route on the map, always on.
//
//   Zoomed in (HOUSE_ZOOM and closer): each house as its building (or a tile
//   when it has none) in the workers' colours — not knocked, not home, no, go
//   back, invalid, pending sale, completed, PCL, done before — with its number
//   and any name. The map's own pins (prebooks, sales, X's, PCL dots) step
//   aside: the houses show the same things.
//   Zoomed out: the houses hide and the pins come back (route lines, route
//   numbers and names stay at every zoom).
//
// Nothing here can be switched off. Read only — nothing here writes. A route
// open in the route view (CartMapPanel) is left to that panel, which draws
// the same houses for its cart.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl';
import type { MasterBooking, PendingSale, HistoricalProperty } from '../../../types';
import type { PCLClientGroup } from '../../../lib/pclCacheService';
import {
  SavedRouteMap, RouteHouse, HouseDisposition,
  fetchRouteHouses, fetchDispositions, subscribeToDispositions,
  indexPendingSales, indexBookings, indexPcl, indexHistorical, buildHouseViews, seasonJobsAsHistorical,
  buildHouseTiles, houseColor, routeHouseId, houseMapNumber, tileCentre,
} from '../../../lib/mapLogsheetService';
import {
  BuildingMatch, BuildingStyle, matchHousesToBuildings, addBuildingLayers, applyBuildingStyles,
  addSliceLayers, setSliceData, removeSliceLayers, emptyBuildingMatch, buildingMatchSig, GapHouse,
} from '../../../lib/mapBuildings';

/** Where the map switches from routes-and-pins to houses. */
export const HOUSE_ZOOM = 15.5;

/** The map's own pin layers, which hand over to the houses when zoomed in. */
export const RM_PIN_LAYERS = [
  'rm-pending-pins-circles', 'rm-pending-confirmed-check', 'rm-pending-dash-ring', 'rm-confirmed-check',
  'rm-completed-pins-circles', 'rm-upsell-only-circles', 'rm-upsell-half-blue', 'rm-overlap-half-symbols',
  'rm-pending-sale-circles', 'rm-pending-sale-ring', 'rm-historical-symbols', 'rm-historical-x', 'rm-pcl-circles', 'rm-pcl2-circles',
];

const P = 'rmh';
const SRC_FP = `${P}-fp-src`;
const SRC_PT = `${P}-pt-src`;
const L_FILL = `${P}-fp-fill`;
const L_LINE = `${P}-fp-line`;
const L_NUM = `${P}-num`;
const OWN_LAYERS = [L_NUM, L_LINE, L_FILL, `${P}-bld-line`, `${P}-bld-fill`];

export interface RouteHouseLayerInput {
  map: MapboxMap | null;
  mapLoaded: boolean;
  /** Every route drawn on the map. */
  routeMaps: SavedRouteMap[];
  /** Routes another panel is drawing right now (the route view). */
  skipRoutes: string[];
  bookings: MasterBooking[];
  pendingSales: PendingSale[];
  pclByRoute: Map<string, PCLClientGroup[]>;
  historical: HistoricalProperty[];
  /** The other service's past clients (aeration in a sealing session …): lime / sky blue houses. */
  otherPcl?: { line: 'aeration' | 'sealing'; byRoute: Map<string, PCLClientGroup[]> } | null;
}

/** Read a few routes at a time (each route pages its own houses). */
async function loadHouses(codes: string[]): Promise<RouteHouse[]> {
  const out: RouteHouse[] = [];
  const queue = [...codes];
  const worker = async () => {
    for (let rc = queue.shift(); rc; rc = queue.shift()) {
      try { out.push(...await fetchRouteHouses([rc])); } catch (err) { console.warn('[RM houses] load failed for', rc, err); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, codes.length) }, worker));
  return out;
}

export function useRouteHouseLayer({ map, mapLoaded, routeMaps, skipRoutes, bookings, pendingSales, pclByRoute, historical, otherPcl = null }: RouteHouseLayerInput): void {
  const codes = useMemo(() => [...new Set(routeMaps.map(r => r.route_code))].sort(), [routeMaps]);
  const codeKey = codes.join(',');
  const [houses, setHouses] = useState<RouteHouse[]>([]);
  const [dispositions, setDispositions] = useState<Map<string, HouseDisposition>>(new Map());

  // --- LOAD + LIVE ---
  useEffect(() => {
    if (!codes.length) { setHouses([]); setDispositions(new Map()); return; }
    let cancelled = false;
    loadHouses(codes).then(hs => { if (!cancelled) setHouses(hs); });
    const refresh = () => fetchDispositions(codes).then(d => { if (!cancelled) setDispositions(d); }).catch(err => console.warn('[RM houses] knocks load failed', err));
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A busy crew taps every few seconds: gather the changes, read once.
    const unsub = subscribeToDispositions(codes, () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 800); });
    return () => { cancelled = true; if (timer) clearTimeout(timer); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey]);

  // --- DERIVED ---
  const views = useMemo(() => {
    if (!houses.length) return [];
    const ps = indexPendingSales(pendingSales, houses);
    const { pending, completed } = indexBookings(bookings, houses);
    return buildHouseViews(houses, dispositions, ps, pending, completed, indexPcl(pclByRoute, houses),
      indexHistorical([...historical, ...seasonJobsAsHistorical(pclByRoute)], houses),
      otherPcl ? { line: otherPcl.line, byHouse: indexPcl(otherPcl.byRoute, houses) } : null);
  }, [houses, dispositions, pendingSales, bookings, pclByRoute, historical, otherPcl]);

  const houseSig = useMemo(() => houses.map(h => `${routeHouseId(h.routeCode, h.houseKey)}@${h.lat.toFixed(6)},${h.lng.toFixed(6)}`).join(','), [houses]);
  const tiles = useMemo(
    () => buildHouseTiles(houses, routeMaps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig, routeMaps],
  );

  // --- Houses drawn as Mapbox's own buildings (only those near the view are matched) ---
  const matchRef = useRef<BuildingMatch>(emptyBuildingMatch());
  const [matchVer, setMatchVer] = useState(0);
  const ptsRef = useRef<GapHouse[]>([]);
  ptsRef.current = useMemo(
    () => houses.map(h => ({ id: routeHouseId(h.routeCode, h.houseKey), key: h.houseKey, lng: h.lng, lat: h.lat, street: h.streetNorm, civic: h.civicNo, suffix: h.civicSuffix, unit: h.unit })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig],
  );
  const rematchRef = useRef<() => void>(() => {});
  rematchRef.current = () => {
    if (!map || map.getZoom() < HOUSE_ZOOM - 0.5) return;
    const b = map.getBounds();
    if (!b) return;
    const padX = (b.getEast() - b.getWest()) * 0.25, padY = (b.getNorth() - b.getSouth()) * 0.25;
    const near = ptsRef.current.filter(h => h.lng >= b.getWest() - padX && h.lng <= b.getEast() + padX && h.lat >= b.getSouth() - padY && h.lat <= b.getNorth() + padY);
    if (!near.length) return;
    const m = matchHousesToBuildings(map, near, 'off');
    // Keep earlier matches for houses that have scrolled out of view.
    const prev = matchRef.current;
    const known = new Set(ptsRef.current.map(h => h.id));
    const slices = m.houseToSlice!;
    prev.houseToBuilding.forEach((bid, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(bid) && known.has(hid)) { m.houseToBuilding.set(hid, bid); m.buildingToHouse.set(bid, hid); }
    });
    prev.houseToSlice?.forEach((sl, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(sl.bid) && known.has(hid)) slices.set(hid, sl);
    });
    if (buildingMatchSig(m) !== buildingMatchSig(prev)) { matchRef.current = m; setMatchVer(v => v + 1); }
  };
  const styledRef = useRef<Set<number>>(new Set());

  // --- MAP: layers (added once) and the zoom hand-over ---
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const before = map.getLayer('rm-num-labels') ? 'rm-num-labels' : undefined;
    if (!map.getSource(SRC_FP)) map.addSource(SRC_FP, { type: 'geojson', data: empty });
    if (!map.getSource(SRC_PT)) map.addSource(SRC_PT, { type: 'geojson', data: empty });
    const bld = addBuildingLayers(map, P, before);
    const sl = addSliceLayers(map, P, before);
    [bld.fill, bld.line, sl.fill, sl.line].forEach(id => { try { if (map.getLayer(id)) map.setLayerZoomRange(id, HOUSE_ZOOM, 24); } catch { /* */ } });
    // Tiles for houses without their own building.
    if (!map.getLayer(L_FILL)) map.addLayer({ id: L_FILL, type: 'fill', source: SRC_FP, minzoom: HOUSE_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } }, before);
    if (!map.getLayer(L_LINE)) map.addLayer({ id: L_LINE, type: 'line', source: SRC_FP, minzoom: HOUSE_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 } }, before);
    if (!map.getLayer(L_NUM)) map.addLayer({
      id: L_NUM, type: 'symbol', source: SRC_PT, minzoom: HOUSE_ZOOM,
      layout: {
        'text-field': ['format', ['get', 'num'], { 'font-scale': 1 }, ['case', ['==', ['get', 'name'], ''], '', ['concat', '\n', ['get', 'name']]], { 'font-scale': 0.62 }],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], HOUSE_ZOOM, 11, 17, 14, 19, 18],
        'text-line-height': 1.05, 'text-padding': 1, 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'sort'],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 },
    }, before);

    // Pins step aside at the house zoom. Pin layers are added at different
    // times, so this re-checks whenever the style changes (only touching a
    // layer whose range isn't set yet, so it can't loop).
    const handOver = () => {
      for (const id of RM_PIN_LAYERS) {
        const l = map.getLayer(id) as { maxzoom?: number } | undefined;
        if (l && l.maxzoom !== HOUSE_ZOOM) { try { map.setLayerZoomRange(id, 0, HOUSE_ZOOM); } catch { /* */ } }
      }
    };
    handOver();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; rematchRef.current(); }, 300); };
    const onSourceData = (e: { sourceId?: string; tile?: unknown }) => { if (e.sourceId === 'composite' && e.tile) queue(); };
    map.on('styledata', handOver);
    map.on('moveend', queue);
    map.on('sourcedata', onSourceData);
    queue();
    return () => {
      map.off('styledata', handOver);
      map.off('moveend', queue);
      map.off('sourcedata', onSourceData);
      if (timer) clearTimeout(timer);
      try { styledRef.current = applyBuildingStyles(map, new Map(), styledRef.current); } catch { /* gone */ }
      try {
        OWN_LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        removeSliceLayers(map, P);
        [SRC_FP, SRC_PT].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      } catch { /* map already gone */ }
    };
  }, [map, mapLoaded]);

  // --- MAP: data ---
  const skipKey = skipRoutes.join(',');
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const skip = new Set(skipRoutes);
    const fp: GeoJSON.Feature[] = [];
    const pt: GeoJSON.Feature[] = [];
    const styles = new Map<number, BuildingStyle>();
    const byHouse = new Map<string, BuildingStyle>();
    const match = matchRef.current;
    for (const v of views) {
      if (skip.has(v.house.routeCode)) continue;
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const color = houseColor(v);
      const hasState = v.state !== 'none' || v.isHistorical;
      const tile = tiles.get(id);
      const onBuilding = match.houseToBuilding.has(id) || !!match.houseToSlice?.has(id);
      const labelAt: [number, number] = tile && !onBuilding ? tileCentre(tile) : [v.house.lng, v.house.lat];
      if (tile) fp.push({ type: 'Feature', properties: { id, color, fillOpacity: hasState ? 0.45 : 0.10, lineOpacity: hasState ? 0.9 : 0.35, b: onBuilding ? 1 : 0 }, geometry: tile });
      pt.push({ type: 'Feature', properties: { id, color, num: houseMapNumber(v.house), name: v.mapLabel || '', sort: hasState || v.isPcl || v.otherPcl ? 0 : 1 }, geometry: { type: 'Point', coordinates: labelAt } });
      const st: BuildingStyle = { color, fill: hasState ? 0.55 : 0.18, line: hasState ? 0.95 : 0.6, width: hasState ? 1.6 : 1 };
      byHouse.set(id, st);
      const bid = match.houseToBuilding.get(id);
      // Same house on two routes → one building; the knocked copy's colour wins.
      if (bid != null && !(styles.has(bid) && Number(styles.get(bid)!.fill) >= Number(st.fill))) styles.set(bid, st);
    }
    (map.getSource(SRC_FP) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fp });
    (map.getSource(SRC_PT) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pt });
    styledRef.current = applyBuildingStyles(map, styles, styledRef.current);
    setSliceData(map, P, match, id => byHouse.get(id) || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, views, tiles, matchVer, skipKey]);

  // Houses moved or changed → forget old building matches.
  useEffect(() => {
    matchRef.current = emptyBuildingMatch();
    setMatchVer(v => v + 1);
    if (map && mapLoaded) rematchRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseSig, map, mapLoaded]);
}
