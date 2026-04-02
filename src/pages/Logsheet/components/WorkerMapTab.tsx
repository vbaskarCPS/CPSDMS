// src/pages/Logsheet/components/WorkerMapTab.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader, Navigation } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sessionService } from '../../../lib/sessionService';
import { Worker } from '../../../types';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface SavedRoute {
  id: string;
  route_code: string;
  route_color: string;
  route_number: number;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
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

const WorkerMapTab: React.FC<WorkerMapTabProps> = ({ worker }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const loadedIdsRef = useRef<string[]>([]);

  const [routeMapData, setRouteMapData] = useState<SavedRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const initialFitDoneRef = useRef(false);
  const mountedRef = useRef(true);

  // GPS
  const [centerOnLocation, setCenterOnLocation] = useState(false);
  const centerOnLocationRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);

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

  // Draw routes once map and data are both ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !routeMapData.length) return;

    // Remove any previously drawn layers
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

      const srcId = `wm-src-${route.id}`;
      const lineId = `wm-line-${route.id}`;
      loadedIdsRef.current.push(route.id);

      const features: GeoJSON.Feature[] = route.segments.map(seg => ({
        type: 'Feature',
        properties: { route_code: route.route_code, color: route.route_color },
        geometry: { type: 'LineString', coordinates: seg.coordinates },
      }));

      features.forEach(f =>
        allCoords.push(...((f.geometry as GeoJSON.LineString).coordinates as [number, number][]))
      );

      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer(
        {
          id: lineId, type: 'line', source: srcId,
          paint: { 'line-color': route.route_color, 'line-width': 7, 'line-opacity': 0.75 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        },
        before
      );

      // Route number label at centroid
      const rc: [number, number][] = [];
      route.segments.forEach(s => s.coordinates.forEach(c => rc.push(c)));
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

    // Fit map to show all routes (only on first load)
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
  }, [routeMapData, mapLoaded]);

  // GPS watch
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

      // Hide noisy labels
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

      // Enhance road labels
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
          map.addLayer({
            id: bid, type: 'symbol',
            source: (layer as any).source ?? 'composite',
            'source-layer': (layer as any)['source-layer'] ?? 'road',
            filter: (layer as any).filter,
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
          });
        } catch {}
      });

      map.on('idle', suppressDuplicateLabels);
      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      mountedRef.current = false;
      initialFitDoneRef.current = false;
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

      {/* Follow-me button */}
      <button
        onClick={handleToggleCenter}
        className={`absolute top-3 left-3 z-20 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${
          centerOnLocation
            ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-900'
            : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
        }`}
        title={centerOnLocation ? 'Stop following' : 'Follow my location'}
      >
        <Navigation size={18} className={centerOnLocation ? 'fill-current' : ''} />
      </button>

      {/* Loading spinner overlay */}
      {(!mapLoaded || routesLoading) && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
          <Loader size={24} className="animate-spin text-blue-500" />
        </div>
      )}

      {/* Routes loading indicator (map already visible) */}
      {routesLoading && mapLoaded && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          <Loader size={12} className="animate-spin text-blue-400" /> Loading your routes…
        </div>
      )}

      {/* Status message (no routes / no map data) */}
      {!routesLoading && statusMessage && mapLoaded && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 text-yellow-300 px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default WorkerMapTab;