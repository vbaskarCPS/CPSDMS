// src/pages/Management/components/CartMapPanel.tsx
//
// Manager view of one cart on the map logsheet (RMMapTab, map-logsheet
// command centres only). Takes the place of the Staff/Routes sidebar at ~40%
// of the screen:
//
//   - Header + members/jobs: the same content as the old cart pop-up, passed
//     in by RMMapTab so the two never drift apart.
//   - Today / Pace / Coverage: the same tabs and maths the workers see
//     (MapStatsTabs + lib/mapLogsheetStats), scoped to this cart.
//   - A read-only card for a house tapped on the map.
//
// While open it draws the cart's houses as tiles on the manager's map, in the
// workers' colours, zooms to the cart's routes, and pulses the house the cart
// knocked most recently. Live: dispositions and
// pending sales refresh on the same realtime feeds the worker map uses; jobs
// and transactions come in with RMMapTab's own refresh of the cart.
//
// Read only — nothing here writes.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { format } from 'date-fns';
import { Loader, MapPin, X } from 'lucide-react';
import { Worker, MasterBooking, PendingSale, HistoricalProperty, SessionTransaction } from '../../../types';
import { sessionService } from '../../../lib/sessionService';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';
import {
  SavedRouteMap, RouteHouse, HouseDisposition, HouseView,
  fetchRouteMaps, fetchRouteHouses, fetchDispositions, fetchHistoricalForRoutes,
  subscribeToDispositions, subscribeToPendingSales,
  indexPendingSales, indexBookings, indexPcl, indexHistorical, buildHouseViews,
  buildHouseTiles, houseColor, routeHouseId, historicalSummary, HOUSE_COLORS, placeRouteOnRoofs, tileCentre, cleanupRouteGhosts,
  fillRouteGaps, fetchStreetChecks, StreetCheck, streetBase,
  houseMapNumber, houseAddressLabel,
} from '../../../lib/mapLogsheetService';
import {
  CartScope, computeCounts, computeKnockEvents, computePace, computeAvgCharge, computeGoBackQueue, computeCoverage,
} from '../../../lib/mapLogsheetStats';
import MapStatsTabs, { StatsTab } from '../../MapLogsheet/MapStatsTabs';
import {
  BUILDING_MIN_ZOOM, BuildingMatch, BuildingStyle, matchHousesToBuildings, addBuildingLayers, applyBuildingStyles,
  addSliceLayers, setSliceData, removeSliceLayers, emptyBuildingMatch, buildingMatchSig, buildingShape,
  gapFillMode, gapFillHeldTotal, GapHouse,
} from '../../../lib/mapBuildings';

export interface CartMapPanelCart {
  sessionId: string;
  members: Worker[];
  sharedBookings: MasterBooking[];
  sharedFinancialStore: any[];
  assignedRoutes: string[];
  stats: { steps: number; eq: number; upsellCount: number; upsellGross: number };
}

interface CartMapPanelProps {
  cart: CartMapPanelCart;
  /** Base route codes for the cart (split letters already stripped). */
  routeCodes: string[];
  sessionDate: string | null;
  commandCenterId: string | null;
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  /** The old pop-up's header row (names, buttons, close). */
  header: React.ReactNode;
  /** The old pop-up's body (members, asphalt, jobs). */
  details: React.ReactNode;
  /** Padding when zooming to the routes (the phone layout keeps them clear of its drawer). Default 50. */
  fitPadding?: number | { top: number; bottom: number; left: number; right: number };
  /** Don't zoom to the routes — the caller frames the map itself (phone layout). */
  skipFit?: boolean;
}

const SRC_FP = 'cmp-fp-src';
const SRC_PT = 'cmp-pt-src';
const L_FILL = 'cmp-fp-fill';
const L_LINE = 'cmp-fp-line';
const L_HIT = 'cmp-hit';
const L_SEL = 'cmp-sel';
const L_NUM = 'cmp-num';
const SRC_PULSE = 'cmp-pulse-src';   // the shape of the last-knock house (building, slice or tile)
const L_PULSE_FILL = 'cmp-pulse-fill';
const L_PULSE_LINE = 'cmp-pulse-line';
const L_PULSE_EDGE = 'cmp-pulse-edge';
const L_PULSE_RING = 'cmp-pulse-ring';
const L_PULSE_RING2 = 'cmp-pulse-ring2';
const L_FILL_Z = 'cmp-fp-fill-z';   // zoomed in: only houses without their own Mapbox building
const L_LINE_Z = 'cmp-fp-line-z';
const BLD_PREFIX = 'cmp';
const CMP_LAYERS = [L_NUM, L_SEL, L_HIT, L_PULSE_RING2, L_PULSE_RING, L_PULSE_EDGE, L_PULSE_LINE, L_PULSE_FILL, L_LINE_Z, L_FILL_Z, L_LINE, L_FILL, `${BLD_PREFIX}-bld-line`, `${BLD_PREFIX}-bld-fill`];

const STATE_LABEL: Record<HouseView['state'], string> = {
  none: 'Not knocked', not_home: 'Not home', no: 'No', go_back: 'Go back',
  invalid: 'Invalid', pending: 'Pending sale', completed: 'Completed',
};

const CartMapPanel: React.FC<CartMapPanelProps> = ({
  cart, routeCodes, sessionDate, commandCenterId, map, mapLoaded, header, details, fitPadding = 50, skipFit = false,
}) => {
  const [routeMaps, setRouteMaps] = useState<SavedRouteMap[]>([]);
  const [houses, setHouses] = useState<RouteHouse[]>([]);
  const [dispositions, setDispositions] = useState<Map<string, HouseDisposition>>(new Map());
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);
  const [pclByRoute, setPclByRoute] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [historicalRows, setHistoricalRows] = useState<HistoricalProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<StatsTab>('today');
  const [placingMsg, setPlacingMsg] = useState<string | null>(null);
  const [streetChecks, setStreetChecks] = useState<StreetCheck[]>([]);

  const routeKey = routeCodes.join(',');

  // --- LOAD (houses are read here; a route with no house list yet is built by the worker map) ---
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    (async () => {
      try {
        const [maps, hs, dispos, pcl, hist] = await Promise.all([
          fetchRouteMaps(routeCodes),
          fetchRouteHouses(routeCodes),
          fetchDispositions(routeCodes),
          commandCenterId ? getWorkerPCL(routeCodes, commandCenterId).catch(() => new Map<string, PCLClientGroup[]>()) : Promise.resolve(new Map<string, PCLClientGroup[]>()),
          commandCenterId ? fetchHistoricalForRoutes(commandCenterId, routeCodes).catch(() => [] as HistoricalProperty[]) : Promise.resolve([] as HistoricalProperty[]),
        ]);
        if (cancelled) return;
        setRouteMaps(maps); setHouses(hs); setDispositions(dispos); setPclByRoute(pcl); setHistoricalRows(hist);
      } catch (err) {
        console.warn('[CartMapPanel] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, commandCenterId]);

  // Once per route: if a route's houses haven't been placed with Mapbox yet,
  // do it now in the background (whoever opens the route first pays for it —
  // a manager here or a worker on their map). Houses move into place when done.
  useEffect(() => {
    if (loading || !routeCodes.length) return;
    let cancelled = false;
    (async () => {
      for (const rc of routeCodes) {
        if (cancelled) return;
        try {
          let fresh = await placeRouteOnRoofs(rc, msg => { if (!cancelled) setPlacingMsg(msg); });
          if (cancelled) return;
          // Then clear out ghost houses and houses on another route's stretch.
          if (await cleanupRouteGhosts(rc)) {
            fresh = await fetchRouteHouses([rc]);
            fetchDispositions(routeCodes).then(d => { if (!cancelled) setDispositions(d); }).catch(() => {});
          }
          if (cancelled) return;
          // Then fill streets on the route map that have no houses.
          const rm = routeMaps.find(m => m.route_code === rc);
          if (rm) {
            const filled = await fillRouteGaps(rm, fresh || undefined, msg => { if (!cancelled) setPlacingMsg(msg); });
            if (filled) fresh = filled;
          }
          if (cancelled) return;
          if (fresh) setHouses(prev => [...prev.filter(h => h.routeCode !== rc), ...fresh!]);
        } catch (err) {
          console.warn('[CartMapPanel] placing houses failed for', rc, err);
        }
      }
      if (!cancelled) setPlacingMsg(null);
      if (!cancelled) fetchStreetChecks(routeCodes).then(c => { if (!cancelled) setStreetChecks(c); }).catch(() => {});
    })();
    return () => { cancelled = true; setPlacingMsg(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, routeKey]);

  // Pending sales for the cart's session (own + asphalt assigned to it).
  const loadPending = useMemo(() => async () => {
    try {
      const [own, assigned] = await Promise.all([
        sessionService.getPendingSalesForSession(cart.sessionId),
        sessionService.getAsphaltAssignmentsForSession(cart.sessionId),
      ]);
      const ownIds = new Set(own.map(ps => ps.id));
      setPendingSales([...assigned.filter(ps => !ownIds.has(ps.id)), ...own]);
    } catch (err) {
      console.warn('[CartMapPanel] pending sales load failed', err);
    }
  }, [cart.sessionId]);
  useEffect(() => { loadPending(); }, [loadPending]);

  // --- LIVE ---
  useEffect(() => {
    if (!routeCodes.length) return;
    return subscribeToDispositions(routeCodes, () => { fetchDispositions(routeCodes).then(setDispositions).catch(() => {}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  useEffect(() => {
    if (!commandCenterId) return;
    return subscribeToPendingSales(commandCenterId, () => { loadPending(); });
  }, [commandCenterId, loadPending]);

  // --- DERIVED ---
  const transactions = (cart.sharedFinancialStore || []) as SessionTransaction[];
  const houseViews: HouseView[] = useMemo(() => {
    const ps = indexPendingSales(pendingSales, houses);
    const { pending, completed } = indexBookings(cart.sharedBookings || [], houses);
    return buildHouseViews(houses, dispositions, ps, pending, completed, indexPcl(pclByRoute, houses), indexHistorical(historicalRows, houses));
  }, [houses, dispositions, pendingSales, cart.sharedBookings, pclByRoute, historicalRows]);

  const scope: CartScope = useMemo(() => ({
    workerIds: new Set(cart.members.map(m => m.contractorId)),
    sessionIds: new Set([cart.sessionId]),
  }), [cart.members, cart.sessionId]);

  const counts = useMemo(() => computeCounts(dispositions, houseViews, sessionDate, scope), [dispositions, houseViews, sessionDate, scope]);
  const knockEvents = useMemo(
    () => computeKnockEvents(dispositions, pendingSales, transactions, houses, sessionDate, scope),
    [dispositions, pendingSales, transactions, houses, sessionDate, scope],
  );
  const pace = useMemo(() => computePace(knockEvents), [knockEvents]);
  const avgCharge = useMemo(() => computeAvgCharge(transactions, sessionDate), [transactions, sessionDate]);
  const goBackQueue = useMemo(() => computeGoBackQueue(houseViews, sessionDate), [houseViews, sessionDate]);
  const coverage = useMemo(() => computeCoverage(houseViews), [houseViews]);

  const selectedView = useMemo(
    () => (selectedId ? houseViews.find(v => routeHouseId(v.house.routeCode, v.house.houseKey) === selectedId) || null : null),
    [selectedId, houseViews],
  );

  // Tiles depend only on where the houses are.
  // Includes positions, so tiles and building matches redraw when houses are re-placed.
  const houseSig = useMemo(() => houses.map(h => `${routeHouseId(h.routeCode, h.houseKey)}@${h.lat.toFixed(6)},${h.lng.toFixed(6)}`).join(','), [houses]);
  const tiles = useMemo(
    () => buildHouseTiles(houses, routeMaps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig, routeMaps],
  );

  // --- Houses drawn as Mapbox's own buildings (lib/mapBuildings) ---
  const bldMatchRef = useRef<BuildingMatch>(emptyBuildingMatch());
  const [bldMatchVer, setBldMatchVer] = useState(0);
  const housePtsRef = useRef<GapHouse[]>([]);
  const gapModeRef = useRef(gapFillMode());
  housePtsRef.current = useMemo(
    () => houses.map(h => ({
      id: routeHouseId(h.routeCode, h.houseKey), key: h.houseKey, lng: h.lng, lat: h.lat,
      street: h.streetNorm, civic: h.civicNo, suffix: h.civicSuffix, unit: h.unit,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig],
  );
  const rematchRef = useRef<() => void>(() => {});
  rematchRef.current = () => {
    if (!map || map.getZoom() < BUILDING_MIN_ZOOM - 0.5) return;
    const m = matchHousesToBuildings(map, housePtsRef.current, gapModeRef.current);
    const prev = bldMatchRef.current;
    const known = new Set(housePtsRef.current.map(h => h.id));
    const slices = m.houseToSlice!;
    prev.houseToBuilding.forEach((bid, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(bid) && known.has(hid)) {
        m.houseToBuilding.set(hid, bid); m.buildingToHouse.set(bid, hid);
      }
    });
    prev.houseToSlice?.forEach((sl, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(sl.bid) && known.has(hid)) slices.set(hid, sl);
    });
    if (buildingMatchSig(m) !== buildingMatchSig(prev)) { bldMatchRef.current = m; setBldMatchVer(v => v + 1); }
  };
  const styledBuildingsRef = useRef<Set<number>>(new Set());

  // --- MAP: layers (added once, removed on close) ---
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!map.getSource(SRC_FP)) map.addSource(SRC_FP, { type: 'geojson', data: empty });
    if (!map.getSource(SRC_PT)) map.addSource(SRC_PT, { type: 'geojson', data: empty });
    // Mapbox buildings (coloured per house), then tiles: every house while
    // zoomed out; zoomed in, only houses without their own building.
    addBuildingLayers(map, BLD_PREFIX);
    addSliceLayers(map, BLD_PREFIX);   // slices of shared buildings (2–10 houses, rows up to 12)
    if (!map.getLayer(L_FILL)) map.addLayer({ id: L_FILL, type: 'fill', source: SRC_FP, minzoom: 13, maxzoom: BUILDING_MIN_ZOOM, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } });
    if (!map.getLayer(L_LINE)) map.addLayer({ id: L_LINE, type: 'line', source: SRC_FP, minzoom: 13, maxzoom: BUILDING_MIN_ZOOM, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 } });
    if (!map.getLayer(L_FILL_Z)) map.addLayer({ id: L_FILL_Z, type: 'fill', source: SRC_FP, minzoom: BUILDING_MIN_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } });
    if (!map.getLayer(L_LINE_Z)) map.addLayer({ id: L_LINE_Z, type: 'line', source: SRC_FP, minzoom: BUILDING_MIN_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 } });
    // "Last knock" pulse: the shape of the cart's most recent knock — its own
    // Mapbox building, its slice of a shared building, or its tile when it has
    // no building — animated below (replaces the round pulse on the manager map).
    const none: any = ['==', ['get', 'id'], '__none__'];
    if (!map.getSource(SRC_PULSE)) map.addSource(SRC_PULSE, { type: 'geojson', data: empty });
    // Solid flashing tile, a wide glowing halo, a crisp dark edge so it reads
    // on any colour, and two big rings radiating out from the house.
    if (!map.getLayer(L_PULSE_FILL)) map.addLayer({ id: L_PULSE_FILL, type: 'fill', source: SRC_PULSE, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.9 } });
    if (!map.getLayer(L_PULSE_LINE)) map.addLayer({ id: L_PULSE_LINE, type: 'line', source: SRC_PULSE, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 1, 'line-blur': 4 } });
    if (!map.getLayer(L_PULSE_EDGE)) map.addLayer({ id: L_PULSE_EDGE, type: 'line', source: SRC_PULSE, paint: { 'line-color': '#111827', 'line-width': 2.5, 'line-opacity': 1 } });
    if (!map.getLayer(L_PULSE_RING)) map.addLayer({ id: L_PULSE_RING, type: 'circle', source: SRC_PT, filter: none, paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 12, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 5, 'circle-stroke-opacity': 1, 'circle-pitch-alignment': 'map' } });
    if (!map.getLayer(L_PULSE_RING2)) map.addLayer({ id: L_PULSE_RING2, type: 'circle', source: SRC_PT, filter: none, paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 12, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 4, 'circle-stroke-opacity': 1, 'circle-pitch-alignment': 'map' } });
    if (!map.getLayer(L_HIT)) map.addLayer({ id: L_HIT, type: 'circle', source: SRC_PT, minzoom: 13, paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 18, 19, 26] } });
    if (!map.getLayer(L_SEL)) map.addLayer({
      id: L_SEL, type: 'circle', source: SRC_PT, minzoom: 13, filter: ['==', ['get', 'id'], '__none__'],
      paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 18, 19, 26], 'circle-stroke-color': '#111827', 'circle-stroke-width': 3 },
    });
    if (!map.getLayer(L_NUM)) map.addLayer({
      id: L_NUM, type: 'symbol', source: SRC_PT, minzoom: 15.5,
      layout: {
        'text-field': ['format', ['get', 'num'], { 'font-scale': 1 }, ['case', ['==', ['get', 'name'], ''], '', ['concat', '\n', ['get', 'name']]], { 'font-scale': 0.62 }],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 11, 17, 14, 19, 18],
        'text-line-height': 1.05, 'text-padding': 1, 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'sort'],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 },
    });

    const onClick = (e: any) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) setSelectedId(String(id));
    };
    const onBuildingClick = (e: any) => {
      const bid = e.features?.[0]?.id;
      const hid = bid != null ? bldMatchRef.current.buildingToHouse.get(Number(bid)) : undefined;
      if (hid) setSelectedId(hid);
    };
    // Re-match houses to buildings after the map moves or building tiles
    // arrive. (Not on 'idle': the last-knock pulse redraws every frame, so
    // this map never goes idle while the panel is open.)
    let rematchTimer: ReturnType<typeof setTimeout> | null = null;
    const queueRematch = () => {
      if (rematchTimer) clearTimeout(rematchTimer);
      rematchTimer = setTimeout(() => { rematchTimer = null; rematchRef.current(); }, 300);
    };
    const onSourceData = (e: any) => { if (e.sourceId === 'composite' && e.tile) queueRematch(); };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    const bldFill = `${BLD_PREFIX}-bld-fill`;
    map.on('click', L_HIT, onClick);
    map.on('click', L_FILL, onClick);
    map.on('click', L_FILL_Z, onClick);
    map.on('click', `${BLD_PREFIX}-slice-fill`, onClick);
    if (map.getLayer(bldFill)) map.on('click', bldFill, onBuildingClick);
    map.on('moveend', queueRematch);
    map.on('sourcedata', onSourceData);
    queueRematch();
    map.on('mouseenter', L_HIT, enter);
    map.on('mouseleave', L_HIT, leave);
    return () => {
      map.off('click', L_HIT, onClick);
      map.off('click', L_FILL, onClick);
      map.off('click', L_FILL_Z, onClick);
      map.off('click', `${BLD_PREFIX}-slice-fill`, onClick);
      map.off('click', bldFill, onBuildingClick);
      map.off('moveend', queueRematch);
      map.off('sourcedata', onSourceData);
      if (rematchTimer) clearTimeout(rematchTimer);
      map.off('mouseenter', L_HIT, enter);
      map.off('mouseleave', L_HIT, leave);
      try { styledBuildingsRef.current = applyBuildingStyles(map, new Map(), styledBuildingsRef.current); } catch { /* gone */ }
      try {
        CMP_LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        removeSliceLayers(map, BLD_PREFIX);
        [SRC_FP, SRC_PT, SRC_PULSE].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      } catch { /* map already gone */ }
    };
  }, [map, mapLoaded]);

  // --- MAP: data ---
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const fp: GeoJSON.Feature[] = [];
    const pt: GeoJSON.Feature[] = [];
    for (const v of houseViews) {
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const color = houseColor(v);
      const hasState = v.state !== 'none' || v.isHistorical;
      const tile = tiles.get(id);
      const onBuilding = bldMatchRef.current.houseToBuilding.has(id) || !!bldMatchRef.current.houseToSlice?.has(id);
      // Number on the building when it has one, else in the middle of its tile.
      const labelAt: [number, number] = tile && !onBuilding ? tileCentre(tile) : [v.house.lng, v.house.lat];
      if (tile) fp.push({ type: 'Feature', properties: { id, color, fillOpacity: hasState ? 0.45 : 0.10, lineOpacity: hasState ? 0.9 : 0.35, b: onBuilding ? 1 : 0 }, geometry: tile });
      pt.push({
        type: 'Feature',
        properties: { id, color, num: houseMapNumber(v.house), name: v.mapLabel || '', sort: hasState || v.isPcl ? 0 : 1 },
        geometry: { type: 'Point', coordinates: labelAt },
      });
    }
    (map.getSource(SRC_FP) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fp });
    (map.getSource(SRC_PT) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pt });
    // Colour each matched Mapbox building with its house's colour.
    const styles = new Map<number, BuildingStyle>();
    const byHouse = new Map<string, BuildingStyle>();
    for (const v of houseViews) {
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const hasState = v.state !== 'none' || v.isHistorical;
      const st: BuildingStyle = { color: houseColor(v), fill: hasState ? 0.55 : 0.18, line: hasState ? 0.95 : 0.6, width: hasState ? 1.6 : 1 };
      byHouse.set(id, st);
      const bid = bldMatchRef.current.houseToBuilding.get(id);
      // Same house on two routes → one building; the knocked copy's colour wins.
      if (bid != null && !(styles.has(bid) && Number(styles.get(bid)!.fill) >= Number(st.fill))) styles.set(bid, st);
    }
    styledBuildingsRef.current = applyBuildingStyles(map, styles, styledBuildingsRef.current);
    setSliceData(map, BLD_PREFIX, bldMatchRef.current, id => byHouse.get(id) || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, houseViews, tiles, bldMatchVer]);

  // House list changed → re-match to buildings.
  useEffect(() => {
    // Houses changed or moved: forget old matches (they may point at the wrong building).
    bldMatchRef.current = emptyBuildingMatch();
    setBldMatchVer(v => v + 1);
    if (map && mapLoaded) rematchRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseSig, map, mapLoaded]);

  useEffect(() => {
    if (!map || !mapLoaded || !map.getLayer(L_SEL)) return;
    map.setFilter(L_SEL, ['==', ['get', 'id'], selectedId || '__none__']);
  }, [map, mapLoaded, selectedId]);

  // --- MAP: pulse the house of the cart's most recent knock today ---
  // (No / Not home / Go back / Invalid / pending / completed — whichever is
  // latest.) The tile flashes with a glowing halo and a dark edge, and two
  // rings radiate out from it every 1.6 s — visible at any zoom.
  const lastKnockId = knockEvents.length ? knockEvents[knockEvents.length - 1].id : null;

  // The shape to pulse: the house's own building, else its slice, else its tile.
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const src = map.getSource(SRC_PULSE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const v = lastKnockId ? houseViews.find(x => routeHouseId(x.house.routeCode, x.house.houseKey) === lastKnockId) : undefined;
    let shape: GeoJSON.Polygon | null = null;
    if (v && lastKnockId) {
      const bid = bldMatchRef.current.houseToBuilding.get(lastKnockId);
      const slice = bldMatchRef.current.houseToSlice?.get(lastKnockId);
      if (bid != null) shape = buildingShape(map, bid);
      if (!shape && slice) shape = { type: 'Polygon', coordinates: [slice.ring] };
      if (!shape) shape = tiles.get(lastKnockId) || null;
    }
    src.setData({
      type: 'FeatureCollection',
      features: shape && v ? [{ type: 'Feature', properties: { id: lastKnockId, color: houseColor(v) }, geometry: shape }] : [],
    });
  }, [map, mapLoaded, lastKnockId, houseViews, tiles, bldMatchVer]);

  useEffect(() => {
    if (!map || !mapLoaded || !map.getLayer(L_PULSE_FILL)) return;
    const filter: any = ['==', ['get', 'id'], lastKnockId || '__none__'];
    [L_PULSE_RING, L_PULSE_RING2].forEach(id => { if (map.getLayer(id)) map.setFilter(id, filter); });
    if (!lastKnockId) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % 1600) / 1600;          // 0 → 1 every 1.6 s
      try {
        if (!map.getLayer(L_PULSE_LINE)) return;
        // Scale with zoom so the rings stay big whether zoomed in or out.
        const z = map.getZoom();
        const base = Math.max(14, Math.min(60, (z - 12) * 9));
        const t2 = (t + 0.5) % 1;                         // second ring, half a beat behind
        const beat = 0.5 + 0.5 * Math.cos(t * Math.PI * 2); // 1 → 0 → 1
        map.setPaintProperty(L_PULSE_FILL, 'fill-opacity', 0.45 + 0.5 * beat);
        map.setPaintProperty(L_PULSE_LINE, 'line-width', 6 + 14 * (1 - beat));
        map.setPaintProperty(L_PULSE_LINE, 'line-opacity', 0.35 + 0.65 * beat);
        map.setPaintProperty(L_PULSE_RING, 'circle-radius', base * (0.4 + 2.2 * t));
        map.setPaintProperty(L_PULSE_RING, 'circle-stroke-opacity', 1 - t);
        map.setPaintProperty(L_PULSE_RING2, 'circle-radius', base * (0.4 + 2.2 * t2));
        map.setPaintProperty(L_PULSE_RING2, 'circle-stroke-opacity', 1 - t2);
      } catch { return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, mapLoaded, lastKnockId]);

  // --- MAP: zoom to the cart's routes (once per cart) ---
  const fittedFor = useRef('');
  useEffect(() => {
    if (skipFit || !map || !mapLoaded || !routeMaps.length) return;
    const key = `${cart.sessionId}|${routeKey}`;
    if (fittedFor.current === key) return;
    const coords: [number, number][] = [];
    routeMaps.forEach(rm => rm.segments?.forEach(s => s.coordinates?.forEach(c => coords.push(c as [number, number]))));
    if (!coords.length) return;
    fittedFor.current = key;
    const b = coords.reduce((bb, c) => bb.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    // Let the map finish resizing for the wider panel first. Pass the current
    // rotation/tilt — fitBounds otherwise turns the map back to north-up.
    setTimeout(() => {
      try {
        map.resize();
        map.fitBounds(b, { padding: fitPadding, maxZoom: 17, duration: 700, bearing: map.getBearing(), pitch: map.getPitch() });
      } catch { /* map gone */ }
    }, 250);
  }, [map, mapLoaded, routeMaps, cart.sessionId, routeKey]);

  const flyTo = (lng: number, lat: number, zoom: number) => { map?.flyTo({ center: [lng, lat], zoom, duration: 700 }); };

  // --- READ-ONLY HOUSE CARD ---
  const memberName = (id: string | null | undefined) => {
    if (!id) return null;
    const m = cart.members.find(w => w.contractorId === id);
    return m ? `${m.firstName} ${m.lastName ? m.lastName[0] + '.' : ''}`.trim() : id;
  };

  const houseCard = selectedView && (() => {
    const v = selectedView;
    const color = houseColor(v);
    const hist = v.isHistorical ? historicalSummary(v.historical) : null;
    const d = v.disposition;
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-white font-bold text-sm truncate">{houseAddressLabel(v.house)}</div>
            <div className="text-[11px] font-bold" style={{ color: color === '#e5e7eb' ? '#9ca3af' : color }}>
              {STATE_LABEL[v.state]}{v.isPcl ? ' · PCL' : ''}{v.isHistorical ? ' · Historical' : ''}
            </div>
          </div>
          <button onClick={() => setSelectedId(null)} className="p-1 text-gray-400 hover:text-white" title="Close"><X size={14} /></button>
        </div>
        {d && (
          <div className="text-[11px] text-gray-400">
            Marked{memberName(d.workerId) ? <> by <span className="text-gray-200 font-bold">{memberName(d.workerId)}</span></> : null}
            {' · '}{format(new Date(d.updatedAt), 'MMM d, h:mm a')}
          </div>
        )}
        {(d?.firstName || d?.note) && (
          <div className="text-xs text-gray-200">
            {d?.firstName && <span className="font-bold">{d.firstName}</span>}
            {d?.firstName && d?.note ? ' — ' : ''}
            {d?.note}
          </div>
        )}
        {v.pendingSale && (
          <div className="text-xs text-yellow-300">
            Pending sale{v.pendingSale.price ? ` · $${v.pendingSale.price}` : ''}{v.pendingSale.firstName ? ` · ${v.pendingSale.firstName} ${v.pendingSale.lastName || ''}` : ''}
          </div>
        )}
        {v.officeBooking && !v.pendingSale && (
          <div className="text-xs text-yellow-300">Office booking{v.officeBooking.Price ? ` · $${v.officeBooking.Price}` : ''}</div>
        )}
        {v.completed && (
          <div className="text-xs text-green-300">Completed{v.completed.Price ? ` · $${v.completed.Price}` : ''}</div>
        )}
        {v.pclName && <div className="text-xs" style={{ color: HOUSE_COLORS.pcl }}>PCL client · {v.pclName}</div>}
        {hist && <div className="text-xs" style={{ color: HOUSE_COLORS.historical }}>Previously serviced · {hist.name}</div>}
      </div>
    );
  })();

  return (
    <div className="flex flex-col h-full min-h-0">
      {header != null && <div className="flex-shrink-0 border-b border-gray-700">{header}</div>}
      <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-3 custom-scrollbar">
        {(() => {
          // Gap-fill test counter (only when ?gapfill=dry|on was set on this device).
          const g = bldMatchVer >= 0 ? bldMatchRef.current.gapFill : undefined;
          if (!g) return null;
          const h = g.held, held = gapFillHeldTotal(g);
          return (
            <div className="rounded-lg px-2.5 py-1.5 text-[11px] text-white" style={{ background: 'rgba(74,4,78,0.6)', border: '1px solid #e879f9' }}>
              <b>Gap-fill {g.mode === 'dry' ? '(dry run)' : '(on)'}: {g.filled} {g.mode === 'dry' ? 'would fill' : 'filled'} · {held} held</b>
              {held > 0 && (
                <div className="text-fuchsia-200">
                  {[h.noAnchor && `${h.noAnchor} one-sided`, h.countMismatch && `${h.countMismatch} count≠`, h.contested && `${h.contested} contested`, h.tooFar && `${h.tooFar} too far`, h.noAddress && `${h.noAddress} no number`].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="text-fuchsia-300/80 text-[10px]">Counts the houses in view at zoom 15+.</div>
            </div>
          );
        })()}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader size={14} className="animate-spin" /> Loading the cart's houses…</div>
        ) : routeCodes.length === 0 ? (
          <div className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 flex items-center gap-2">
            <MapPin size={14} /> No routes are assigned to this cart today.
          </div>
        ) : houses.length === 0 ? (
          <div className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 flex items-center gap-2">
            <MapPin size={14} /> No houses on {routeCodes.join(', ')} yet — they appear once a worker on the cart opens the map.
          </div>
        ) : null}

        {(() => {
          // Streets on the route map where no houses could be found (checked once).
          const empty = streetChecks.filter(c => c.checkedAt && !c.found
            && !houses.some(h => h.routeCode === c.routeCode
              && (h.streetNorm === c.streetNorm || streetBase(h.streetNorm) === streetBase(c.streetNorm))));
          if (!empty.length || loading) return null;
          return (
            <div className="text-xs text-gray-400 bg-gray-800 rounded-lg p-2 flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 flex-shrink-0" />
              <span>No houses found on: {empty.map(c => `${c.streetName || c.streetNorm}${routeCodes.length > 1 ? ` (${c.routeCode})` : ''}`).join(', ')}</span>
            </div>
          );
        })()}

        {placingMsg && !loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400"><Loader size={14} className="animate-spin" /> {placingMsg}</div>
        )}

        {houseCard}

        <MapStatsTabs
          tab={tab}
          onTab={setTab}
          counts={counts}
          avgCharge={avgCharge}
          pace={pace}
          goBackQueue={goBackQueue}
          coverage={coverage}
          equiv={cart.stats.eq}
          footer={<>
            <span>Up gross ${cart.stats.upsellGross.toFixed(0)}</span>
            <span>Upsells {cart.stats.upsellCount}</span>
            <span>Steps {cart.stats.steps}</span>
          </>}
          showRouteCodes={routeCodes.length > 1}
          onGoBackHouse={v => { flyTo(v.house.lng, v.house.lat, 18); setSelectedId(routeHouseId(v.house.routeCode, v.house.houseKey)); }}
          onStreet={st => flyTo(st.lng, st.lat, 17)}
        />

        {details}
      </div>
    </div>
  );
};

export default CartMapPanel;
