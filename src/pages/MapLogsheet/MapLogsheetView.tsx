// src/pages/MapLogsheet/MapLogsheetView.tsx
//
// The Mapbox canvas for the map logsheet. Draws the worker's route lines
// (same look as WorkerMapTab), then every house as:
//   - a tinted building footprint (or a soft disc when no footprint exists),
//   - the house number in the state colour, with the PCL name beneath it.
// Tapping a house reports its id to the parent; the parent owns all state.
//
// Also carries the follow-me GPS arrow + 5-minute location upload, copied
// from WorkerMapTab so the manager's map keeps seeing H01.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Navigation, Loader, Crosshair } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Worker } from '../../types';
import { SavedRouteMap, HouseView, houseColor, routeHouseId } from '../../lib/mapLogsheetService';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const LOCATION_UPLOAD_INTERVAL_MS = 5 * 60 * 1000;

const SRC_FP = 'ml-fp-src';
const SRC_PT = 'ml-pt-src';
const L_FP_FILL = 'ml-fp-fill';
const L_FP_LINE = 'ml-fp-line';
const L_DISC = 'ml-disc';
const L_HIT = 'ml-hit';
const L_SEL = 'ml-sel';
const L_NUM = 'ml-num';
const HOUSE_LAYERS = [L_FP_FILL, L_FP_LINE, L_DISC, L_HIT, L_SEL, L_NUM];

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
  onSelectHouse: (id: string | null) => void;
  onPlaceHouse: (lng: number, lat: number) => void;
}

const MapLogsheetView: React.FC<MapLogsheetViewProps> = ({
  worker, routeMaps, houses, selectedId, loadingMessage, placingHouse, onSelectHouse, onPlaceHouse,
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
  useEffect(() => { onSelectRef.current = onSelectHouse; }, [onSelectHouse]);
  useEffect(() => { onPlaceRef.current = onPlaceHouse; }, [onPlaceHouse]);
  useEffect(() => { placingRef.current = placingHouse; }, [placingHouse]);

  // GPS
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const uploadIntervalRef = useRef<number | null>(null);

  // ---------------------------------------------------------------------
  // GeoJSON built from the house views
  // ---------------------------------------------------------------------
  const { fpCollection, ptCollection } = useMemo(() => {
    const fp: GeoJSON.Feature[] = [];
    const pt: GeoJSON.Feature[] = [];
    for (const v of houses) {
      const id = routeHouseId(v.house.routeCode, v.house.houseKey);
      const color = houseColor(v);
      const hasState = v.state !== 'none';
      const num = `${v.house.civicNo}${(v.house.civicSuffix || '').toUpperCase()}`;
      const hasFp = !!v.house.footprint;
      if (hasFp) {
        fp.push({
          type: 'Feature',
          properties: {
            id, color,
            fillOpacity: hasState ? 0.45 : 0.10,
            lineOpacity: hasState ? 0.9 : 0.35,
          },
          geometry: v.house.footprint as GeoJSON.Geometry,
        });
      }
      pt.push({
        type: 'Feature',
        properties: {
          id, color, num,
          name: v.isPcl && v.pclName ? v.pclName : '',
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
  }, [houses]);

  // ---------------------------------------------------------------------
  // Map init (once)
  // ---------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-79.870, 43.320],
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

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

      map.addLayer({
        id: L_FP_FILL, type: 'fill', source: SRC_FP, minzoom: 14,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] },
      }, before);
      map.addLayer({
        id: L_FP_LINE, type: 'line', source: SRC_FP, minzoom: 14,
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
        const feats = map.queryRenderedFeatures(e.point, { layers: [L_HIT, L_NUM, L_FP_FILL] });
        const hit = feats.find(f => f.properties && f.properties.id);
        if (hit) {
          onSelectRef.current(String(hit.properties!.id));
          return;
        }
        if (placingRef.current) {
          onPlaceRef.current(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        onSelectRef.current(null);
      });

      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      mountedRef.current = false;
      initialFitDoneRef.current = false;
      if (uploadIntervalRef.current !== null) { clearInterval(uploadIntervalRef.current); uploadIntervalRef.current = null; }
      if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
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

  // Selection ring
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer(L_SEL)) return;
    map.setFilter(L_SEL, ['==', ['get', 'id'], selectedId || '__none__']);
  }, [selectedId, mapLoaded]);

  // Placing mode cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placingHouse ? 'crosshair' : '';
  }, [placingHouse]);

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

  useEffect(() => {
    if (uploadIntervalRef.current !== null) { clearInterval(uploadIntervalRef.current); uploadIntervalRef.current = null; }
    if (!following || !worker.commandCenterId) return;
    const upload = async () => {
      const pos = lastPositionRef.current;
      if (!pos || !mountedRef.current) return;
      try {
        await supabase.from('worker_locations').upsert(
          { worker_id: worker.contractorId, command_center_id: worker.commandCenterId, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() },
          { onConflict: 'worker_id' },
        );
      } catch (e) { console.error('Failed to upload location:', e); }
    };
    upload();
    uploadIntervalRef.current = window.setInterval(upload, LOCATION_UPLOAD_INTERVAL_MS);
    return () => {
      if (uploadIntervalRef.current !== null) { clearInterval(uploadIntervalRef.current); uploadIntervalRef.current = null; }
    };
  }, [following, worker.contractorId, worker.commandCenterId]);

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

  useEffect(() => {
    if (!mapLoaded) return;
    const t = setTimeout(() => mapRef.current?.resize(), 150);
    return () => clearTimeout(t);
  }, [mapLoaded]);

  // Keep house layers above route lines if the style reorders anything.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    HOUSE_LAYERS.forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
  }, [routeMaps, mapLoaded]);

  return (
    <div className="relative w-full h-full">
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

      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
          <Loader size={24} className="animate-spin text-blue-500" />
        </div>
      )}

      {mapLoaded && loadingMessage && !placingHouse && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium max-w-[80%] truncate">
          <Loader size={12} className="animate-spin text-blue-400 shrink-0" /> {loadingMessage}
        </div>
      )}

      {following && mapLoaded && (
        <div className="absolute bottom-2 left-3 z-20 bg-blue-900/90 text-blue-200 px-2 py-1 rounded text-[10px] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" /> Sharing location
        </div>
      )}
    </div>
  );
};

export default MapLogsheetView;