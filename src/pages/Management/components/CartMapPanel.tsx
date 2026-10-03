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
// workers' colours, and zooms to the cart's routes. Live: dispositions and
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
  buildHouseTiles, houseColor, routeHouseId, historicalSummary, HOUSE_COLORS,
} from '../../../lib/mapLogsheetService';
import {
  CartScope, computeCounts, computeKnockEvents, computePace, computeAvgCharge, computeGoBackQueue, computeCoverage,
} from '../../../lib/mapLogsheetStats';
import MapStatsTabs, { StatsTab } from '../../MapLogsheet/MapStatsTabs';

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
}

const SRC_FP = 'cmp-fp-src';
const SRC_PT = 'cmp-pt-src';
const L_FILL = 'cmp-fp-fill';
const L_LINE = 'cmp-fp-line';
const L_HIT = 'cmp-hit';
const L_SEL = 'cmp-sel';
const L_NUM = 'cmp-num';
const CMP_LAYERS = [L_NUM, L_SEL, L_HIT, L_LINE, L_FILL];

const STATE_LABEL: Record<HouseView['state'], string> = {
  none: 'Not knocked', not_home: 'Not home', no: 'No', go_back: 'Go back',
  invalid: 'Invalid', pending: 'Pending sale', completed: 'Completed',
};

const CartMapPanel: React.FC<CartMapPanelProps> = ({
  cart, routeCodes, sessionDate, commandCenterId, map, mapLoaded, header, details,
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

  const routeKey = routeCodes.join(',');

  // --- LOAD (houses are only read here; building them is the worker map's job) ---
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
    return buildHouseViews(houses, dispositions, ps, pending, completed, indexPcl(pclByRoute), indexHistorical(historicalRows));
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
  const houseSig = useMemo(() => houses.map(h => routeHouseId(h.routeCode, h.houseKey)).join(','), [houses]);
  const tiles = useMemo(
    () => buildHouseTiles(houses, routeMaps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig, routeMaps],
  );

  // --- MAP: layers (added once, removed on close) ---
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!map.getSource(SRC_FP)) map.addSource(SRC_FP, { type: 'geojson', data: empty });
    if (!map.getSource(SRC_PT)) map.addSource(SRC_PT, { type: 'geojson', data: empty });
    if (!map.getLayer(L_FILL)) map.addLayer({ id: L_FILL, type: 'fill', source: SRC_FP, minzoom: 13, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } });
    if (!map.getLayer(L_LINE)) map.addLayer({ id: L_LINE, type: 'line', source: SRC_FP, minzoom: 13, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 } });
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
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', L_HIT, onClick);
    map.on('click', L_FILL, onClick);
    map.on('mouseenter', L_HIT, enter);
    map.on('mouseleave', L_HIT, leave);
    return () => {
      map.off('click', L_HIT, onClick);
      map.off('click', L_FILL, onClick);
      map.off('mouseenter', L_HIT, enter);
      map.off('mouseleave', L_HIT, leave);
      try {
        CMP_LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        [SRC_FP, SRC_PT].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
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
      if (tile) fp.push({ type: 'Feature', properties: { id, color, fillOpacity: hasState ? 0.45 : 0.10, lineOpacity: hasState ? 0.9 : 0.35 }, geometry: tile });
      pt.push({
        type: 'Feature',
        properties: { id, color, num: `${v.house.civicNo}${(v.house.civicSuffix || '').toUpperCase()}`, name: v.mapLabel || '', sort: hasState || v.isPcl ? 0 : 1 },
        geometry: { type: 'Point', coordinates: [v.house.lng, v.house.lat] },
      });
    }
    (map.getSource(SRC_FP) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fp });
    (map.getSource(SRC_PT) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pt });
  }, [map, mapLoaded, houseViews, tiles]);

  useEffect(() => {
    if (!map || !mapLoaded || !map.getLayer(L_SEL)) return;
    map.setFilter(L_SEL, ['==', ['get', 'id'], selectedId || '__none__']);
  }, [map, mapLoaded, selectedId]);

  // --- MAP: zoom to the cart's routes (once per cart) ---
  const fittedFor = useRef('');
  useEffect(() => {
    if (!map || !mapLoaded || !routeMaps.length) return;
    const key = `${cart.sessionId}|${routeKey}`;
    if (fittedFor.current === key) return;
    const coords: [number, number][] = [];
    routeMaps.forEach(rm => rm.segments?.forEach(s => s.coordinates?.forEach(c => coords.push(c as [number, number]))));
    if (!coords.length) return;
    fittedFor.current = key;
    const b = coords.reduce((bb, c) => bb.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    // Let the map finish resizing for the wider panel first.
    setTimeout(() => { map.resize(); map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 700 }); }, 250);
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
            <div className="text-white font-bold text-sm truncate">{v.house.civicNo}{(v.house.civicSuffix || '').toUpperCase()} {v.house.streetName}</div>
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
      <div className="flex-shrink-0 border-b border-gray-700">{header}</div>
      <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-3 custom-scrollbar">
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
