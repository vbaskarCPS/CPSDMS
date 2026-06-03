// src/pages/Logsheet/components/WorkerMapTab.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader, Navigation } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sessionService } from '../../../lib/sessionService';
import { Worker, RouteSplit } from '../../../types';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface SavedRoute {
  id: string;
  route_code: string;
  route_color: string;
  route_number: number;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}

// --- SPLIT BUCKET HELPERS (shared algorithm with RMMapTab) ---
// pointInCorners + bucketForPoint are copied VERBATIM from RMMapTab.tsx so the
// worker's clipped half is computed identically to the manager's coloured half.
// If you ever change the cascade in one file, change it in BOTH — silent drift
// here would put a street on the wrong worker's map.
function pointInCorners(lng: number, lat: number, corners: Array<{ lng: number; lat: number }>): boolean {
  if (!corners || corners.length < 3) return false;
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].lng, yi = corners[i].lat;
    const xj = corners[j].lng, yj = corners[j].lat;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function bucketForPoint(lng: number, lat: number, buckets: Array<{letter: string; sourceLetter: string | null; rectangles: Array<{corners: Array<{lng: number; lat: number}>}>}>): string {
  let current = 'a';
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.sourceLetter !== current) continue;
    if (!b.rectangles || b.rectangles.length === 0) continue;
    for (const r of b.rectangles) {
      if (pointInCorners(lng, lat, r.corners)) {
        current = b.letter;
        break;
      }
    }
  }
  return current;
}

function lineMidCoord(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function createNavArrow(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#4285F4" stroke="white" stroke-width="2" opacity="0.25"/><path d="M12 4 L18 18 L12 14 L6 18 Z" fill="#4285F4" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  el.style.cssText = 'transition: transform 0.3s ease;';
  return el;
}

interface WorkerMapTabProps {
  worker: Worker;
}

const LOCATION_UPLOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const WorkerMapTab: React.FC<WorkerMapTabProps> = ({ worker }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const loadedIdsRef = useRef<string[]>([]);

  const [routeMapData, setRouteMapData] = useState<SavedRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Route splits for THIS worker's routes. Used to clip drawn geometry to only
  // the bucket(s) this worker is assigned to, so a split-route worker sees just
  // their half. Fetched alongside the route load; refreshed on contractor change.
  const [routeSplits, setRouteSplits] = useState<RouteSplit[]>([]);
  const routeSplitsByCode = useMemo(() => {
    const m = new Map<string, RouteSplit>();
    for (const rs of routeSplits) m.set(rs.routeCode, rs);
    return m;
  }, [routeSplits]);

  const initialFitDoneRef = useRef(false);
  const mountedRef = useRef(true);

  // GPS
  const [centerOnLocation, setCenterOnLocation] = useState(false);
  const centerOnLocationRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);

  // Location broadcasting
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const locationUploadIntervalRef = useRef<number | null>(null);

  const suppressDuplicateLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    const HIDE = ['poi-label', 'housenum-label', 'road-number-shield'];
    const ids = style.layers
      .filter((l: any) => l.type === 'symbol' && l.id.toLowerCase().includes('label') && !l.id.includes('-point-backup') && !HIDE.includes(l.id))
      .map((l: any) => l.id);
    if (!ids.length) return;
    const names = [
      ...new Set(
        map.queryRenderedFeatures(undefined, { layers: ids })
          .map((f: any) => f.properties?.name)
          .filter(Boolean)
      ),
    ];
    style.layers.filter((l: any) => l.id.includes('-point-backup')).forEach((l: any) => {
      if (!map.getLayer(l.id)) return;
      try { map.setFilter(l.id, names.length ? ['!', ['in', ['get', 'name'], ['literal', names]]] : null); } catch {}
    });
  }, []);

  // Load assigned routes from live session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRoutesLoading(true);
      setStatusMessage(null);
      try {
        const daily = await sessionService.getDailySession();
        if (cancelled) return;
        if (!daily) {
          setStatusMessage('No active session found');
          setRoutesLoading(false);
          return;
        }

        const myRouteCodes = daily.routes
          .filter(r => r.assignedWorkerIds && r.assignedWorkerIds.includes(worker.contractorId))
          .map(r => r.routeCode);

        if (!myRouteCodes.length) {
          setStatusMessage('No routes assigned yet');
          setRoutesLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('route_maps')
          .select('*')
          .in('route_code', myRouteCodes)
          .eq('status', 'approved');

        if (cancelled) return;
        if (error) { console.error(error); setRoutesLoading(false); return; }

        if (!data || data.length === 0) {
          setStatusMessage('No map data for your routes');
        }
        setRouteMapData((data || []) as SavedRoute[]);
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setRoutesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [worker.contractorId]);

  // Load route splits for this worker's routes (display-only; clips geometry to
  // the worker's assigned bucket below). Refreshes when the contractor changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await sessionService.getRouteSplits();
        if (!cancelled) setRouteSplits(rows);
      } catch (e) {
        console.warn('[WorkerMap] route splits load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [worker.contractorId]);

  // Draw routes once map and data are both ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !routeMapData.length) return;

    loadedIdsRef.current.forEach(id => {
      if (id.startsWith('num-')) {
        const rid = id.replace('num-', '');
        if (map.getLayer(`wm-num-${rid}`)) map.removeLayer(`wm-num-${rid}`);
        if (map.getSource(`wm-num-src-${rid}`)) map.removeSource(`wm-num-src-${rid}`);
      } else {
        if (map.getLayer(`wm-line-${id}`)) map.removeLayer(`wm-line-${id}`);
        if (map.getSource(`wm-src-${id}`)) map.removeSource(`wm-src-${id}`);
      }
    });
    loadedIdsRef.current = [];

    const before =
      (map.getLayer('road-label') ? 'road-label' : map.getStyle().layers?.find((l: any) => l.type === 'symbol')?.id) ?? undefined;

    const allCoords: [number, number][] = [];

    routeMapData.forEach(route => {
      if (!route.segments?.length) return;

      // Determine if this route is split and which bucket(s) belong to THIS
      // worker. If split AND the worker owns a bucket, clip the drawn geometry
      // to only that bucket's line-pieces (same cascade the master map uses to
      // colour them). Otherwise draw the whole route as before.
      const split = routeSplitsByCode.get(route.route_code);
      const buckets = split ? split.buckets : [];
      const myLetters = new Set<string>();
      for (const b of buckets) {
        if ((b.assignedWorkers || []).includes(worker.contractorId)) myLetters.add(b.letter);
      }
      const clipToBuckets = buckets.length > 0 && myLetters.size > 0;

      const srcId = `wm-src-${route.id}`;
      const lineId = `wm-line-${route.id}`;

      // Build features. When clipping, each line-piece (a pair of consecutive
      // coords) becomes its own LineString, kept only if its midpoint falls in
      // one of the worker's buckets. labelCoords collects the kept coordinates
      // so the number label and fit-bounds frame only the worker's half.
      const features: GeoJSON.Feature[] = [];
      const labelCoords: [number, number][] = [];
      route.segments.forEach(seg => {
        const cs = seg.coordinates;
        if (!cs || cs.length === 0) return;
        if (!clipToBuckets) {
          features.push({
            type: 'Feature',
            properties: { route_code: route.route_code, color: route.route_color },
            geometry: { type: 'LineString', coordinates: cs },
          });
          cs.forEach(c => labelCoords.push(c));
          return;
        }
        if (cs.length < 2) return;
        for (let i = 0; i < cs.length - 1; i++) {
          const a = cs[i];
          const b = cs[i + 1];
          const mid = lineMidCoord(a, b);
          const letter = bucketForPoint(mid[0], mid[1], buckets);
          if (!myLetters.has(letter)) continue;
          features.push({
            type: 'Feature',
            properties: { route_code: route.route_code, color: route.route_color },
            geometry: { type: 'LineString', coordinates: [a, b] },
          });
          labelCoords.push(a, b);
        }
      });

      // Nothing of this route belongs to the worker — skip it entirely.
      if (features.length === 0) return;

      loadedIdsRef.current.push(route.id);

      labelCoords.forEach(c => allCoords.push(c));

      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer(
        {
          id: lineId, type: 'line', source: srcId,
          paint: { 'line-color': route.route_color, 'line-width': 7, 'line-opacity': 0.75 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        },
        before
      );

      // Route number label at the centroid of the kept (worker's) geometry.
      const rc: [number, number][] = labelCoords;
      if (!rc.length) return;
      const cLng = rc.reduce((s, c) => s + c[0], 0) / rc.length;
      const cLat = rc.reduce((s, c) => s + c[1], 0) / rc.length;

      const nSrc = `wm-num-src-${route.id}`;
      const nLbl = `wm-num-${route.id}`;
      loadedIdsRef.current.push(`num-${route.id}`);
      map.addSource(nSrc, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { num: String(route.route_number), color: route.route_color },
            geometry: { type: 'Point', coordinates: [cLng, cLat] },
          }],
        },
      });
      map.addLayer({
        id: nLbl, type: 'symbol', source: nSrc,
        layout: {
          'text-field': ['get', 'num'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 28,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': 'rgba(255,255,255,0.85)',
          'text-halo-width': 2,
        },
      });
    });

    if (allCoords.length && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
      setTimeout(() => {
        if (!mapRef.current) return;
        const b = allCoords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
        );
        mapRef.current.fitBounds(b, { padding: 60, maxZoom: 15, duration: 800 });
      }, 300);
    }
  }, [routeMapData, mapLoaded, routeSplitsByCode, worker.contractorId]);

  // GPS watch — stores position in lastPositionRef for DB uploads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !navigator.geolocation) return;
    if (!navArrowElRef.current) navArrowElRef.current = createNavArrow();
    navMarkerRef.current = new mapboxgl.Marker({ element: navArrowElRef.current })
      .setLngLat([0, 0])
      .addTo(map);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        if (!navMarkerRef.current || !mapRef.current) return;
        const { latitude: lat, longitude: lng, heading } = pos.coords;
        navMarkerRef.current.setLngLat([lng, lat]);
        // Always keep the latest position stored so the upload interval can use it
        lastPositionRef.current = { lat, lng };
        if (heading != null && !isNaN(heading) && navArrowElRef.current) {
          navArrowElRef.current.style.transform = `rotate(${heading}deg)`;
        }
        if (centerOnLocationRef.current) {
          mapRef.current.easeTo({ center: [lng, lat], duration: 1000 });
        }
      },
      err => console.warn('GPS:', err.code),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
    };
  }, [mapLoaded]);

  // Location broadcasting — write to worker_locations when follow-me is active
  useEffect(() => {
    // Always clear any existing interval first
    if (locationUploadIntervalRef.current !== null) {
      clearInterval(locationUploadIntervalRef.current);
      locationUploadIntervalRef.current = null;
    }

    if (!centerOnLocation || !worker.commandCenterId) return;

    const upload = async () => {
      const pos = lastPositionRef.current;
      if (!pos || !mountedRef.current) return;
      try {
        await supabase.from('worker_locations').upsert(
          {
            worker_id: worker.contractorId,
            command_center_id: worker.commandCenterId,
            lat: pos.lat,
            lng: pos.lng,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'worker_id' }
        );
      } catch (e) {
        console.error('Failed to upload location:', e);
      }
    };

    // Write immediately, then every 5 minutes
    upload();
    locationUploadIntervalRef.current = window.setInterval(upload, LOCATION_UPLOAD_INTERVAL_MS);

    return () => {
      if (locationUploadIntervalRef.current !== null) {
        clearInterval(locationUploadIntervalRef.current);
        locationUploadIntervalRef.current = null;
      }
    };
  }, [centerOnLocation, worker.contractorId, worker.commandCenterId]);

  // Force resize once map is loaded
  useEffect(() => {
    if (!mapLoaded) return;
    const t = setTimeout(() => mapRef.current?.resize(), 150);
    return () => clearTimeout(t);
  }, [mapLoaded]);

  useEffect(() => { centerOnLocationRef.current = centerOnLocation; }, [centerOnLocation]);

  const handleToggleCenter = useCallback(() => {
    setCenterOnLocation(prev => {
      const nv = !prev;
      centerOnLocationRef.current = nv;
      if (nv && navMarkerRef.current && mapRef.current) {
        const ll = navMarkerRef.current.getLngLat();
        if (ll.lng !== 0 || ll.lat !== 0) {
          mapRef.current.easeTo({ center: [ll.lng, ll.lat], duration: 800 });
        }
      }
      return nv;
    });
  }, []);

  // Map initialization
  useEffect(() => {
    mountedRef.current = true;
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-79.870, 43.320],
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.resize();

      const xh = ['poi-label', 'housenum-label', 'road-number-shield'];
      xh.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });

      map.getStyle().layers?.forEach((layer: any) => {
        const id = layer.id.toLowerCase();
        if (layer.type === 'fill' || layer.type === 'fill-extrusion') {
          if (id.includes('building') || id.includes('structure')) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
        }
        if (layer.type !== 'symbol') return;
        const ihn =
          id.includes('housenum') || id.includes('house-num') ||
          id.includes('house_num') || id.includes('address') || id.includes('housenumber');
        const tf = JSON.stringify(layer.layout?.['text-field'] ?? '');
        const fhn =
          tf.includes('housenumber') || tf.includes('house_num') ||
          tf.includes('addr') || tf.includes('ref');
        const inrl =
          !id.includes('label') && !id.includes('shield') &&
          !id.includes('motorway') && !id.includes('road') && !id.includes('street');
        if (ihn || fhn || inrl) map.setLayoutProperty(layer.id, 'visibility', 'none');
      });

      const rll = map.getStyle().layers?.filter(
        (l: any) => l.type === 'symbol' && l.id.toLowerCase().includes('label') && !xh.includes(l.id)
      ) ?? [];
      rll.forEach((layer: any) => {
        try {
          map.setLayerZoomRange(layer.id, 0, 24);
          map.setLayoutProperty(layer.id, 'text-allow-overlap', false);
          map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
          map.setLayoutProperty(layer.id, 'text-size', 13);
          map.setLayoutProperty(layer.id, 'text-font', ['DIN Pro Bold', 'Arial Unicode MS Bold']);
          map.setPaintProperty(layer.id, 'text-color', '#111111');
          map.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
          map.setPaintProperty(layer.id, 'text-halo-width', 2);
        } catch {}
        const bid = `${layer.id}-point-backup`;
        if (map.getLayer(bid)) return;
        try {
          const layerDef: any = {
            id: bid, type: 'symbol',
            source: (layer as any).source ?? 'composite',
            'source-layer': (layer as any)['source-layer'] ?? 'road',
            minzoom: 0, maxzoom: 24,
            layout: {
              ...(layer.layout ?? {}),
              'symbol-placement': 'point',
              'text-optional': true,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-padding': 5,
              'text-size': 11,
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            },
            paint: {
              ...(layer.paint ?? {}),
              'text-color': '#111111',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
            },
          };
          if ((layer as any).filter !== undefined) {
            layerDef.filter = (layer as any).filter;
          }
          map.addLayer(layerDef);
        } catch {}
      });

      map.on('idle', suppressDuplicateLabels);
      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      mountedRef.current = false;
      initialFitDoneRef.current = false;
      // Clean up location upload interval
      if (locationUploadIntervalRef.current !== null) {
        clearInterval(locationUploadIntervalRef.current);
        locationUploadIntervalRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [suppressDuplicateLabels]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Follow-me button — enabling this also broadcasts location to manager */}
      <button
        onClick={handleToggleCenter}
        className={`absolute top-3 left-3 z-20 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${
          centerOnLocation
            ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-900'
            : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
        }`}
        title={centerOnLocation ? 'Stop following (location sharing off)' : 'Follow my location (shares position with manager)'}
      >
        <Navigation size={18} className={centerOnLocation ? 'fill-current' : ''} />
      </button>

      {/* Loading spinner overlay */}
      {(!mapLoaded || routesLoading) && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
          <Loader size={24} className="animate-spin text-blue-500" />
        </div>
      )}

      {/* Routes loading indicator */}
      {routesLoading && mapLoaded && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          <Loader size={12} className="animate-spin text-blue-400" /> Loading your routes…
        </div>
      )}

      {/* Status message */}
      {!routesLoading && statusMessage && mapLoaded && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 text-yellow-300 px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          {statusMessage}
        </div>
      )}

      {/* Location sharing indicator */}
      {centerOnLocation && mapLoaded && (
        <div className="absolute bottom-6 left-3 z-20 bg-blue-900/90 text-blue-300 px-3 py-1.5 rounded-lg shadow-lg text-[10px] font-medium backdrop-blur-sm flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
          Sharing location with manager
        </div>
      )}
    </div>
  );
};

export default WorkerMapTab;