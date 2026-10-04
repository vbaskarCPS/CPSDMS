// src/pages/MapLogsheet/MapLogsheetView.tsx
//
// The Mapbox canvas for the map logsheet. Draws the worker's route lines
// (same look as WorkerMapTab), then every house as:
//   - a tinted house tile (a rectangle drawn per house, facing its street —
//     see buildHouseTiles; real building outlines are no longer used),
//   - the house number in the state colour, with the PCL name beneath it.
// Tapping a house reports its id to the parent; the parent owns all state.
//
// Also carries the follow-me GPS arrow + 5-minute location upload, copied
// from WorkerMapTab so the manager's map keeps seeing H01.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Navigation, Loader, Crosshair } from 'lucide-react';
import { Worker } from '../../types';
import { SavedRouteMap, HouseView, StreetSegmentPick, houseColor, routeHouseId, buildHouseTiles, normStreet, BaseRoadLines } from '../../lib/mapLogsheetService';
import {
  BUILDING_MIN_ZOOM, BuildingMatch, BuildingStyle, matchHousesToBuildings, addBuildingLayers, applyBuildingStyles, buildingIdAt,
} from '../../lib/mapBuildings';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;


// Mapbox draws its canvas at full device resolution: CSS size × devicePixelRatio.
// On a dense fullscreen Android display that can exceed what the GPU will
// render (commonly 4096px a side). The browser then hands back a smaller
// drawing buffer, Mapbox paints the top-left of it, and the rest of the map is
// a black band. Mapbox offers no pixel-ratio setting, but it reads
// window.devicePixelRatio live, so while the map is mounted we cap that value
// to the largest ratio the GPU can actually draw at this screen size. On most
// tablets the cap never bites and nothing changes.
function installPixelRatioCap(): () => void {
  const real = window.devicePixelRatio || 1;
  let limit = 0;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      limit = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL info — leave the ratio alone */ }
  if (!limit) return () => {};

  const longest = Math.max(
    window.screen?.width || 0, window.screen?.height || 0,
    window.innerWidth || 0, window.innerHeight || 0,
  );
  if (!longest) return () => {};
  // Small margin so we never land exactly on the ceiling.
  const cap = Math.floor(((limit - 64) / longest) * 100) / 100;
  if (cap >= real || cap < 1) return () => {};

  const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  try {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => cap, configurable: true });
  } catch { return () => {}; }
  console.info(`[MapLogsheet] pixel ratio capped ${real} → ${cap} (GPU limit ${limit}px, screen ${longest}px)`);
  return () => {
    try {
      if (original) Object.defineProperty(window, 'devicePixelRatio', original);
      else delete (window as any).devicePixelRatio;
    } catch { /* ignore */ }
  };
}

const SRC_FP = 'ml-fp-src';
const SRC_PT = 'ml-pt-src';
const L_FP_FILL = 'ml-fp-fill';        // tiles, zoomed out (every house)
const L_FP_LINE = 'ml-fp-line';
const L_FP_FILL_Z = 'ml-fp-fill-z';    // tiles, zoomed in (only houses without their own Mapbox building)
const L_FP_LINE_Z = 'ml-fp-line-z';
const L_DISC = 'ml-disc';
const L_HIT = 'ml-hit';
const L_SEL = 'ml-sel';
const L_NUM = 'ml-num';
const HOUSE_LAYERS = [L_FP_FILL, L_FP_LINE, L_FP_FILL_Z, L_FP_LINE_Z, L_DISC, L_HIT, L_SEL, L_NUM];

/** Street under the finger: the named road nearest the tap, plus every other
 *  visible piece of road with the same name (Mapbox splits roads per tile and
 *  per block). Returns null when the tap isn't on a named road. */
function pickStreetAt(map: mapboxgl.Map, point: mapboxgl.Point): StreetSegmentPick | null {
  const PAD = 10; // px either side of the finger
  const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [[point.x - PAD, point.y - PAD], [point.x + PAD, point.y + PAD]];
  const isRoad = (f: mapboxgl.MapboxGeoJSONFeature) =>
    f.sourceLayer === 'road' && !!f.properties?.name &&
    (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
  const hit = map.queryRenderedFeatures(box).find(isRoad);
  if (!hit) return null;
  const name = String(hit.properties!.name);
  const lines: [number, number][][] = [];
  const pushGeom = (g: GeoJSON.Geometry) => {
    if (g.type === 'LineString') lines.push(g.coordinates as [number, number][]);
    else if (g.type === 'MultiLineString') (g.coordinates as [number, number][][]).forEach(l => lines.push(l));
  };
  map.queryRenderedFeatures().filter(isRoad).filter(f => String(f.properties!.name) === name).forEach(f => pushGeom(f.geometry));
  if (!lines.length) pushGeom(hit.geometry);
  return { name, lines };
}

/** Adds every named road in the base map's loaded tiles to `store`, keyed by
 *  normStreet(name). Returns true when anything new was added. Only runs from
 *  zoom 14 up, where residential streets are present and not simplified. */
const BASE_ROAD_MIN_ZOOM = 14;
function harvestBaseRoads(map: mapboxgl.Map, store: BaseRoadLines, seen: Set<string>): boolean {
  if (map.getZoom() < BASE_ROAD_MIN_ZOOM || !map.getSource('composite')) return false;
  let added = false;
  let feats: mapboxgl.MapboxGeoJSONFeature[] = [];
  try { feats = map.querySourceFeatures('composite', { sourceLayer: 'road' }); } catch { return false; }
  const push = (sn: string, line: [number, number][]) => {
    if (line.length < 2) return;
    const a = line[0], b = line[line.length - 1];
    const key = `${sn}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}|${line.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!store.has(sn)) store.set(sn, []);
    store.get(sn)!.push(line);
    added = true;
  };
  for (const f of feats) {
    const name = f.properties?.name;
    if (!name) continue;
    const sn = normStreet(String(name));
    if (!sn) continue;
    const g = f.geometry;
    if (g.type === 'LineString') push(sn, g.coordinates as [number, number][]);
    else if (g.type === 'MultiLineString') (g.coordinates as [number, number][][]).forEach(l => push(sn, l));
  }
  return added;
}

function createNavArrow(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#4285F4" stroke="white" stroke-width="2" opacity="0.25"/><path d="M12 4 L18 18 L12 14 L6 18 Z" fill="#4285F4" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  el.style.cssText = 'transition: transform 0.3s ease;';
  return el;
}

export interface MapLogsheetViewProps {
  worker: Worker;
  routeMaps: SavedRouteMap[];
  houses: HouseView[];
  selectedId: string | null;
  loadingMessage: string | null;
  /** When true, the next tap on empty map reports a coordinate instead of a house. */
  placingHouse: boolean;
  /** When true, the next tap on a road reports that street (every visible
   *  piece with the same name) instead of a house. */
  pickingStreet: boolean;
  /** Bump `nonce` to pan/zoom the map somewhere (e.g. a street from the Coverage tab). */
  flyTo?: { lng: number; lat: number; zoom?: number; nonce: number } | null;
  onSelectHouse: (id: string | null) => void;
  onPlaceHouse: (lng: number, lat: number) => void;
  /** null = the tap didn't land on a named road. */
  onPickStreet: (pick: StreetSegmentPick | null) => void;
}

const MapLogsheetView: React.FC<MapLogsheetViewProps> = ({
  routeMaps, houses, selectedId, loadingMessage, placingHouse, pickingStreet, flyTo, onSelectHouse, onPlaceHouse, onPickStreet,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const routeLayerIdsRef = useRef<string[]>([]);
  const initialFitDoneRef = useRef(false);
  const mountedRef = useRef(true);

  // Latest callbacks/flags for the map's click handler (registered once).
  const onSelectRef = useRef(onSelectHouse);
  const onPlaceRef = useRef(onPlaceHouse);
  const placingRef = useRef(placingHouse);
  const onPickStreetRef = useRef(onPickStreet);
  const pickingRef = useRef(pickingStreet);
  useEffect(() => { onSelectRef.current = onSelectHouse; }, [onSelectHouse]);
  useEffect(() => { onPlaceRef.current = onPlaceHouse; }, [onPlaceHouse]);
  useEffect(() => { placingRef.current = placingHouse; }, [placingHouse]);
  useEffect(() => { onPickStreetRef.current = onPickStreet; }, [onPickStreet]);
  useEffect(() => { pickingRef.current = pickingStreet; }, [pickingStreet]);

  // GPS
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  // ---------------------------------------------------------------------
  // GeoJSON built from the house views
  // ---------------------------------------------------------------------
  // House tiles depend only on WHERE the houses are, not on their state, so
  // they're rebuilt when the house list or route lines change — not on every
  // knock. The signature keeps that cheap.
  // Named roads from the base map, so houses on streets that aren't part of a
  // route still face their own street. Grows as the map loads more area;
  // baseRoadsVer bumps when something new arrives.
  const baseRoadsRef = useRef<BaseRoadLines>(new Map());
  const baseRoadSeenRef = useRef<Set<string>>(new Set());
  const [baseRoadsVer, setBaseRoadsVer] = useState(0);

  const houseListSig = useMemo(
    () => houses.map(v => routeHouseId(v.house.routeCode, v.house.houseKey)).join(','),
    [houses],
  );
  const tiles = useMemo(
    () => buildHouseTiles(houses.map(v => v.house), routeMaps, baseRoadsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseListSig, routeMaps, baseRoadsVer],
  );

  // Houses drawn as Mapbox's own building (see lib/mapBuildings). Re-matched
  // whenever the map finishes loading tiles or the house list changes.
  const BLD_PREFIX = 'ml';
  const bldMatchRef = useRef<BuildingMatch>({ houseToBuilding: new Map(), buildingToHouse: new Map() });
  const [bldMatchVer, setBldMatchVer] = useState(0);
  const housePtsRef = useRef<Array<{ id: string; lng: number; lat: number }>>([]);
  housePtsRef.current = useMemo(
    () => houses.map(v => ({ id: routeHouseId(v.house.routeCode, v.house.houseKey), lng: v.house.lng, lat: v.house.lat })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseListSig],
  );
  const rematchBuildings = useCallback(() => {
    const map = mapRef.current;
    if (!map || map.getZoom() < BUILDING_MIN_ZOOM - 0.5) return;
    const m = matchHousesToBuildings(map, housePtsRef.current);
    const prev = bldMatchRef.current;
    // Keep earlier matches for buildings that scrolled off (tiles unloaded).
    prev.houseToBuilding.forEach((bid, hid) => {
      if (!m.houseToBuilding.has(hid) && !m.buildingToHouse.has(bid) && housePtsRef.current.some(h => h.id === hid)) {
        m.houseToBuilding.set(hid, bid); m.buildingToHouse.set(bid, hid);
      }
    });
    const sig = (x: BuildingMatch) => [...x.houseToBuilding].map(([h, b]) => `${h}:${b}`).sort().join(',');
    if (sig(m) !== sig(prev)) { bldMatchRef.current = m; setBldMatchVer(v => v + 1); }
  }, []);
  const rematchRef = useRef(rematchBuildings);
  rematchRef.current = rematchBuildings;

  const { fpCollection, ptCollection } = useMemo(() => {
    const fp: GeoJSON.Feature[] = [];
    const pt: GeoJSON.Feature[] = [];
    for (const v of houses) {
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const color = houseColor(v);
      const hasState = v.state !== 'none' || v.isHistorical;
      const num = `${v.house.civicNo}${(v.house.civicSuffix || '').toUpperCase()}`;
      const tile = tiles.get(id);
      const hasFp = !!tile;
      if (tile) {
        fp.push({
          type: 'Feature',
          properties: {
            id, color,
            fillOpacity: hasState ? 0.45 : 0.10,
            lineOpacity: hasState ? 0.9 : 0.35,
            // 1 = this house is drawn as its Mapbox building when zoomed in
            b: bldMatchRef.current.houseToBuilding.has(id) ? 1 : 0,
          },
          geometry: tile,
        });
      }
      pt.push({
        type: 'Feature',
        properties: {
          id, color, num,
          name: v.mapLabel || '',
          hasFp: hasFp ? 1 : 0,
          hasState: hasState ? 1 : 0,
          // coloured houses win label placement fights
          sort: hasState || v.isPcl ? 0 : 1,
        },
        geometry: { type: 'Point', coordinates: [v.house.lng, v.house.lat] },
      });
    }
    return {
      fpCollection: { type: 'FeatureCollection', features: fp } as GeoJSON.FeatureCollection,
      ptCollection: { type: 'FeatureCollection', features: pt } as GeoJSON.FeatureCollection,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houses, tiles, bldMatchVer]);

  // ---------------------------------------------------------------------
  // Map init (once)
  // ---------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    if (!containerRef.current || mapRef.current) return;

    // index.css shrinks the whole page (html { zoom }) on screens 360px wide
    // and under, for the small Orbic handsets. A zoomed page is fine for
    // forms, but the map canvas ends up drawn at 92% of its box and leaves a
    // black band on two sides. Opt this page out for as long as the map is up.
    document.documentElement.classList.add('map-fullbleed');
    const restorePixelRatio = installPixelRatioCap();
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-79.870, 43.320],
      zoom: 13,
      attributionControl: false,
    });

    map.on('load', () => {
      map.resize();

      // Hide Mapbox's own house numbers, POIs and buildings — we draw our own.
      const hide = ['poi-label', 'housenum-label', 'road-number-shield', 'transit-label'];
      map.getStyle().layers?.forEach((layer: any) => {
        const id = layer.id.toLowerCase();
        if (hide.includes(layer.id)) { map.setLayoutProperty(layer.id, 'visibility', 'none'); return; }
        if ((layer.type === 'fill' || layer.type === 'fill-extrusion') && (id.includes('building') || id.includes('structure'))) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
          return;
        }
        if (layer.type === 'symbol' && (id.includes('housenum') || id.includes('address') || id.includes('poi'))) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });

      // --- house sources + layers ---
      map.addSource(SRC_FP, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(SRC_PT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      const before = map.getLayer('road-label') ? 'road-label' : undefined;

      // Mapbox's buildings, coloured per house where a building holds one house.
      addBuildingLayers(map, BLD_PREFIX, before);
      // Tiles: every house while zoomed out; zoomed in, only houses that
      // don't have their own Mapbox building.
      map.addLayer({
        id: L_FP_FILL, type: 'fill', source: SRC_FP, minzoom: 14, maxzoom: BUILDING_MIN_ZOOM,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] },
      }, before);
      map.addLayer({
        id: L_FP_LINE, type: 'line', source: SRC_FP, minzoom: 14, maxzoom: BUILDING_MIN_ZOOM,
        paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 },
      }, before);
      map.addLayer({
        id: L_FP_FILL_Z, type: 'fill', source: SRC_FP, minzoom: BUILDING_MIN_ZOOM, filter: ['!=', ['get', 'b'], 1],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] },
      }, before);
      map.addLayer({
        id: L_FP_LINE_Z, type: 'line', source: SRC_FP, minzoom: BUILDING_MIN_ZOOM, filter: ['!=', ['get', 'b'], 1],
        paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 },
      }, before);
      // Soft disc for houses with no footprint and a state
      map.addLayer({
        id: L_DISC, type: 'circle', source: SRC_PT, minzoom: 14,
        filter: ['all', ['==', ['get', 'hasFp'], 0], ['==', ['get', 'hasState'], 1]],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.35,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 6, 17, 14, 19, 22],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.8,
        },
      }, before);
      // Invisible, generous tap target
      map.addLayer({
        id: L_HIT, type: 'circle', source: SRC_PT, minzoom: 14,
        paint: {
          'circle-color': '#000',
          'circle-opacity': 0,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 18, 19, 26],
        },
      });
      // Selection ring
      map.addLayer({
        id: L_SEL, type: 'circle', source: SRC_PT, minzoom: 14,
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'circle-color': '#000',
          'circle-opacity': 0,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 18, 19, 26],
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 3,
        },
      });
      // Number (+ PCL name) — ONE symbol layer for all houses (per-route symbol
      // layers corrupt glyph buffers on Android tablets; see DigiMaps).
      map.addLayer({
        id: L_NUM, type: 'symbol', source: SRC_PT, minzoom: 15.5,
        layout: {
          'text-field': [
            'format',
            ['get', 'num'], { 'font-scale': 1 },
            ['case', ['==', ['get', 'name'], ''], '', ['concat', '\n', ['get', 'name']]], { 'font-scale': 0.62 },
          ],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 11, 17, 14, 19, 18],
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-line-height': 1.05,
          'text-padding': 1,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-sort-key': ['get', 'sort'],
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': 'rgba(255,255,255,0.95)',
          'text-halo-width': 1.6,
        },
      });

      // Tap handling — one listener; resolves house under the finger first.
      map.on('click', (e) => {
        if (pickingRef.current) {
          onPickStreetRef.current(pickStreetAt(map, e.point));
          return;
        }
        const feats = map.queryRenderedFeatures(e.point, { layers: [L_HIT, L_NUM, L_FP_FILL, L_FP_FILL_Z] });
        const hit = feats.find(f => f.properties && f.properties.id);
        if (hit) {
          onSelectRef.current(String(hit.properties!.id));
          return;
        }
        // Tapped a house's Mapbox building?
        const bid = buildingIdAt(map, e.point, `${BLD_PREFIX}-bld-fill`);
        const bHouse = bid != null ? bldMatchRef.current.buildingToHouse.get(bid) : undefined;
        if (bHouse) {
          onSelectRef.current(bHouse);
          return;
        }
        if (placingRef.current) {
          onPlaceRef.current(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        onSelectRef.current(null);
      });

      // Collect base-map roads whenever the map settles after loading tiles.
      map.on('idle', () => {
        if (harvestBaseRoads(map, baseRoadsRef.current, baseRoadSeenRef.current)) {
          setBaseRoadsVer(v => v + 1);
        }
        rematchRef.current();
      });

      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      mountedRef.current = false;
      initialFitDoneRef.current = false;
      if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      restorePixelRatio();
      document.documentElement.classList.remove('map-fullbleed');
      setMapLoaded(false);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Route lines
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    routeLayerIdsRef.current.forEach(id => {
      if (map.getLayer(`ml-route-line-${id}`)) map.removeLayer(`ml-route-line-${id}`);
      if (map.getSource(`ml-route-src-${id}`)) map.removeSource(`ml-route-src-${id}`);
    });
    routeLayerIdsRef.current = [];

    const before = map.getLayer(L_FP_FILL) ? L_FP_FILL : undefined;
    const allCoords: [number, number][] = [];

    routeMaps.forEach(route => {
      if (!route.segments?.length) return;
      const features: GeoJSON.Feature[] = route.segments
        .filter(s => s.coordinates && s.coordinates.length >= 2)
        .map(s => ({
          type: 'Feature',
          properties: { route_code: route.route_code },
          geometry: { type: 'LineString', coordinates: s.coordinates },
        }));
      if (!features.length) return;
      route.segments.forEach(s => s.coordinates?.forEach(c => allCoords.push(c)));
      routeLayerIdsRef.current.push(route.id);
      map.addSource(`ml-route-src-${route.id}`, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: `ml-route-line-${route.id}`, type: 'line', source: `ml-route-src-${route.id}`,
        paint: { 'line-color': route.route_color, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 10], 'line-opacity': 0.45 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      }, before);
    });

    if (allCoords.length && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
      setTimeout(() => {
        if (!mapRef.current) return;
        const b = allCoords.reduce((bb, c) => bb.extend(c), new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]));
        mapRef.current.fitBounds(b, { padding: 50, maxZoom: 16.5, duration: 700 });
      }, 250);
    }
  }, [routeMaps, mapLoaded]);

  // ---------------------------------------------------------------------
  // House data → sources
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource(SRC_FP) as mapboxgl.GeoJSONSource | undefined)?.setData(fpCollection);
    (map.getSource(SRC_PT) as mapboxgl.GeoJSONSource | undefined)?.setData(ptCollection);
  }, [fpCollection, ptCollection, mapLoaded]);

  // House list changed → re-match to buildings.
  useEffect(() => {
    if (mapLoaded) rematchBuildings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseListSig, mapLoaded]);

  // Colour each matched Mapbox building with its house's colour.
  const styledBuildingsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const styles = new Map<number, BuildingStyle>();
    for (const v of houses) {
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const bid = bldMatchRef.current.houseToBuilding.get(id);
      if (bid == null) continue;
      const hasState = v.state !== 'none' || v.isHistorical;
      styles.set(bid, { color: houseColor(v), fill: hasState ? 0.55 : 0.18, line: hasState ? 0.95 : 0.6, width: hasState ? 1.6 : 1 });
    }
    styledBuildingsRef.current = applyBuildingStyles(map, styles, styledBuildingsRef.current);
  }, [houses, bldMatchVer, mapLoaded]);

  // Selection ring
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer(L_SEL)) return;
    map.setFilter(L_SEL, ['==', ['get', 'id'], selectedId || '__none__']);
  }, [selectedId, mapLoaded]);

  // Fly-to requests from the parent (Coverage tab street rows)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? Math.max(map.getZoom(), 17), duration: 900 });
  }, [flyTo?.nonce, mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Placing / picking mode cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = (placingHouse || pickingStreet) ? 'crosshair' : '';
  }, [placingHouse, pickingStreet]);

  // ---------------------------------------------------------------------
  // GPS watch + follow-me + location upload (mirrors WorkerMapTab)
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !navigator.geolocation) return;
    if (!navArrowElRef.current) navArrowElRef.current = createNavArrow();
    navMarkerRef.current = new mapboxgl.Marker({ element: navArrowElRef.current }).setLngLat([0, 0]).addTo(map);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        if (!navMarkerRef.current || !mapRef.current) return;
        const { latitude: lat, longitude: lng, heading } = pos.coords;
        navMarkerRef.current.setLngLat([lng, lat]);
        lastPositionRef.current = { lat, lng };
        if (heading != null && !isNaN(heading) && navArrowElRef.current) {
          navArrowElRef.current.style.transform = `rotate(${heading}deg)`;
        }
        if (followingRef.current) mapRef.current.easeTo({ center: [lng, lat], duration: 1000 });
      },
      err => console.warn('GPS:', err.code),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    return () => {
      if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
    };
  }, [mapLoaded]);

  // Location is sent to the manager by WorkerLocationTracker (app-wide,
  // every 2 min while location is allowed) — Follow Me only centres the map.

  useEffect(() => { followingRef.current = following; }, [following]);

  const toggleFollow = useCallback(() => {
    setFollowing(prev => {
      const nv = !prev;
      followingRef.current = nv;
      if (nv && navMarkerRef.current && mapRef.current) {
        const ll = navMarkerRef.current.getLngLat();
        if (ll.lng !== 0 || ll.lat !== 0) mapRef.current.easeTo({ center: [ll.lng, ll.lat], zoom: Math.max(mapRef.current.getZoom(), 17), duration: 800 });
      }
      return nv;
    });
  }, []);

  // Keep the canvas the same size as its box. Mapbox only re-measures on a
  // window resize, so a container that settles after the map starts (phone
  // browser chrome, the stats strip) leaves a stale canvas with black bands.
  useEffect(() => {
    if (!mapLoaded || !containerRef.current) return;
    const el = containerRef.current;
    const t = setTimeout(() => mapRef.current?.resize(), 150);
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    const onVis = () => mapRef.current?.resize();
    window.addEventListener('orientationchange', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('orientationchange', onVis);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [mapLoaded]);

  // Keep house layers above route lines if the style reorders anything.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    HOUSE_LAYERS.forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
  }, [routeMaps, mapLoaded]);

  return (
    <div className="relative w-full h-full">
      <style>{`.mapboxgl-ctrl-logo { transform: scale(0.7); transform-origin: bottom left; }`}</style>
      <div ref={containerRef} className="absolute inset-0" />

      <button
        onClick={toggleFollow}
        className={`absolute top-3 left-3 z-20 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all ${
          following ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-white text-gray-700 border border-gray-300'
        }`}
        title={following ? 'Stop following' : 'Follow my location'}
      >
        <Navigation size={18} className={following ? 'fill-current' : ''} />
      </button>

      {placingHouse && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium flex items-center gap-1.5">
          <Crosshair size={12} className="text-yellow-300" /> Tap the map where the house is
        </div>
      )}
      {pickingStreet && !placingHouse && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium flex items-center gap-1.5">
          <Crosshair size={12} className="text-yellow-300" /> Tap the road you want houses for
        </div>
      )}

      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
          <Loader size={24} className="animate-spin text-blue-500" />
        </div>
      )}

      {mapLoaded && loadingMessage && !placingHouse && !pickingStreet && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium max-w-[80%] truncate">
          <Loader size={12} className="animate-spin text-blue-400 shrink-0" /> {loadingMessage}
        </div>
      )}

    </div>
  );
};

export default MapLogsheetView;