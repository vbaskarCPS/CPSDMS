// src/pages/DigiMaps.tsx
//
// DIGITAL MAPS VIEWER (login: digimaps / viewer)
//
// A read-only planning view of every built map. It exists so route maps and
// their callbook PCLs can be looked at well before a session exists — which is
// the whole reason the PCL cache was made global and permanent in the first
// place.
//
// Visual language deliberately mirrors RMMapTab: the same coloured route lines,
// the same oversized route-number overlay, the same small grey PCL dots. What it
// does NOT carry is everything RMMapTab needs and this does not — sessions,
// workers, bookings, pending sales, splits, GPS, navigation, realtime. Reusing
// RMMapTab here would have dragged five thousand lines and a dozen live
// subscriptions into a page that only ever reads two tables.
//
// Data sources, both global and session-free:
//   route_maps      — the drawn geometry, approved rows only
//   map_pcl_cache   — callbook clients bucketed onto routes, coordinates included
//
// The number labels live in ONE symbol layer rather than one per route. That is
// not a stylistic choice: per-route label layers are created and destroyed as a
// set, and on slower Android tablets that churn leaves the map's glyph buffers
// half-written, rendering the digits as clipped fragments. One layer, built once,
// avoids the problem entirely.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Loader, LogOut, Map as MapIcon, Users, Eye, EyeOff, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getStorageItem, removeStorageItem } from '../lib/localStorage';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Region = 'West' | 'Central' | 'East';

interface AreaCard {
  areaName: string;
  prefix: string;
  region: Region;
  routeCount: number;    // how many the area is meant to have
  routesDrawn: number;   // how many are approved in route_maps
  pclCount: number;      // callbook clients attached across those routes
}

interface MapSegment {
  osmId: number;
  name: string;
  coordinates: [number, number][]; // [lng, lat]
}

interface DrawnRoute {
  id: string;
  areaName: string;
  routeNumber: number;
  routeCode: string;
  routeColor: string;
  segments: MapSegment[];
}

interface PclDot {
  lat: number;
  lng: number;
  routeCode: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function regionStyle(region: Region): string {
  if (region === 'West') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (region === 'Central') return 'bg-green-900/40 text-green-300 border-green-700';
  return 'bg-orange-900/40 text-orange-300 border-orange-700';
}

const REGION_ORDER: Region[] = ['West', 'Central', 'East'];

// ─── COMPONENT ───────────────────────────────────────────────────────────────

const DigiMaps: React.FC = () => {
  const navigate = useNavigate();

  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [areas, setAreas] = useState<AreaCard[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentArea, setCurrentArea] = useState<AreaCard | null>(null);
  const [drawnRoutes, setDrawnRoutes] = useState<DrawnRoute[]>([]);
  const [pclDots, setPclDots] = useState<PclDot[]>([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [showPcl, setShowPcl] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Layer + source ids we've added, so a change of area tears down cleanly.
  const addedIdsRef = useRef<string[]>([]);
  const fitDoneRef = useRef(false);

  // --- ACCESS GUARD ---
  // The digimaps login sets this flag. Anyone arriving at the URL without it
  // goes back to the login screen; there is nothing sensitive rendered here,
  // but an unguarded route is an untidy route.
  useEffect(() => {
    const ok = getStorageItem<boolean>('digimaps_viewer', false);
    if (!ok) navigate('/login');
  }, [navigate]);

  const handleLogout = () => {
    removeStorageItem('digimaps_viewer');
    navigate('/login');
  };

  // --- LOAD THE AREA LIST ---
  //
  // Three reads, all paged to a thousand rows because route_maps in particular
  // runs well past Supabase's default cap and a silent truncation would make
  // built areas look empty.
  const loadAreas = useCallback(async () => {
    setLoadingAreas(true);
    setError(null);
    try {
      const { data: areaRows, error: areaErr } = await supabase
        .from('area_prefixes')
        .select('area_name, prefix, region, route_count')
        .order('area_name');
      if (areaErr) throw new Error(areaErr.message);

      const drawnByArea = new Map<string, number>();
      {
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data, error: e } = await supabase
            .from('route_maps')
            .select('area_name')
            .eq('status', 'approved')
            .range(from, from + BATCH - 1);
          if (e) throw new Error(e.message);
          if (!data || data.length === 0) break;
          data.forEach((r: any) => drawnByArea.set(r.area_name, (drawnByArea.get(r.area_name) || 0) + 1));
          if (data.length < BATCH) break;
          from += BATCH;
        }
      }

      const pclByArea = new Map<string, number>();
      {
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data, error: e } = await supabase
            .from('map_pcl_cache')
            .select('area_name, client_count')
            .range(from, from + BATCH - 1);
          // A missing PCL table shouldn't take the whole page down — the maps
          // are still worth looking at without their callbooks.
          if (e) { console.warn('[DigiMaps] PCL counts unavailable:', e.message); break; }
          if (!data || data.length === 0) break;
          data.forEach((r: any) => pclByArea.set(r.area_name, (pclByArea.get(r.area_name) || 0) + (r.client_count || 0)));
          if (data.length < BATCH) break;
          from += BATCH;
        }
      }

      setAreas((areaRows || []).map((a: any) => ({
        areaName: a.area_name,
        prefix: a.prefix,
        region: (a.region || 'East') as Region,
        routeCount: a.route_count || 0,
        routesDrawn: drawnByArea.get(a.area_name) || 0,
        pclCount: pclByArea.get(a.area_name) || 0,
      })));
    } catch (err) {
      console.error('[DigiMaps] Area load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load the map list.');
    } finally {
      setLoadingAreas(false);
    }
  }, []);

  useEffect(() => { loadAreas(); }, [loadAreas]);

  const areasByRegion = useMemo(() => {
    const out = new Map<Region, AreaCard[]>();
    REGION_ORDER.forEach(r => out.set(r, []));
    areas.forEach(a => {
      if (!out.has(a.region)) out.set(a.region, []);
      out.get(a.region)!.push(a);
    });
    return out;
  }, [areas]);

  // --- OPEN AN AREA ---
  const handleOpenArea = async (area: AreaCard) => {
    if (area.routesDrawn === 0) return;   // nothing to show
    setCurrentArea(area);
    setView('map');
    setLoadingMap(true);
    setDrawnRoutes([]);
    setPclDots([]);
    fitDoneRef.current = false;

    try {
      const { data: routeRows, error: rErr } = await supabase
        .from('route_maps')
        .select('*')
        .eq('area_name', area.areaName)
        .eq('status', 'approved');
      if (rErr) throw new Error(rErr.message);

      const routes: DrawnRoute[] = (routeRows || []).map((r: any) => ({
        id: r.id,
        areaName: r.area_name,
        routeNumber: r.route_number,
        routeCode: r.route_code,
        routeColor: r.route_color,
        segments: Array.isArray(r.segments) ? r.segments : [],
      }));
      setDrawnRoutes(routes);

      // PCL dots. Coordinates were resolved and stored at load time, so there is
      // no geocoding here at all — the dots plot instantly however many there
      // are. Clients cached before coordinates were stored simply have none and
      // are skipped rather than guessed at.
      const { data: pclRows, error: pErr } = await supabase
        .from('map_pcl_cache')
        .select('route_code, clients')
        .eq('area_name', area.areaName);
      if (pErr) {
        console.warn('[DigiMaps] PCL load failed:', pErr.message);
      } else {
        const dots: PclDot[] = [];
        (pclRows || []).forEach((row: any) => {
          (row.clients || []).forEach((c: any) => {
            if (typeof c.lat === 'number' && typeof c.lng === 'number') {
              dots.push({ lat: c.lat, lng: c.lng, routeCode: row.route_code });
            }
          });
        });
        setPclDots(dots);
      }
    } catch (err) {
      console.error('[DigiMaps] Map load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load that map.');
    } finally {
      setLoadingMap(false);
    }
  };

  const handleBackToGrid = () => {
    setView('grid');
    setCurrentArea(null);
    setDrawnRoutes([]);
    setPclDots([]);
  };

  // --- MAP LIFECYCLE ---
  useEffect(() => {
    if (view !== 'map') {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapLoaded(false);
        addedIdsRef.current = [];
      }
      return;
    }
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-79.4, 43.7],
      zoom: 10,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => setMapLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      addedIdsRef.current = [];
    };
  }, [view]);

  // --- DRAW ROUTES + NUMBER OVERLAY ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Tear down whatever the previous area left behind.
    addedIdsRef.current.forEach(id => {
      if (map.getLayer(`dm-line-${id}`)) map.removeLayer(`dm-line-${id}`);
      if (map.getSource(`dm-src-${id}`)) map.removeSource(`dm-src-${id}`);
    });
    addedIdsRef.current = [];

    if (drawnRoutes.length === 0) return;

    // Reference layer so the coloured lines sit UNDER the map's own text. We
    // ignore our own layers when hunting for one, and lift everything back above
    // the lines at the end regardless — the ordering must not depend on how far
    // the style happened to have loaded when this ran.
    const styleLayers: any[] = (map.getStyle()?.layers as any[]) || [];
    const before =
      (map.getLayer('road-label') ? 'road-label' : undefined) ??
      styleLayers.find(l => l.type === 'symbol' && !String(l.id).startsWith('dm-'))?.id ??
      undefined;

    const allCoords: [number, number][] = [];
    const labelFeatures: GeoJSON.Feature[] = [];

    drawnRoutes.forEach(route => {
      if (!route.segments?.length) return;
      const features: GeoJSON.Feature[] = [];
      const routeCoords: [number, number][] = [];

      route.segments.forEach(seg => {
        const cs = seg.coordinates;
        if (!cs || cs.length < 2) return;
        features.push({
          type: 'Feature',
          properties: { route_code: route.routeCode },
          geometry: { type: 'LineString', coordinates: cs },
        });
        cs.forEach(c => { routeCoords.push(c); allCoords.push(c); });
      });
      if (features.length === 0) return;

      const srcId = `dm-src-${route.id}`;
      const lineId = `dm-line-${route.id}`;
      addedIdsRef.current.push(route.id);

      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': route.routeColor || '#6b7280',
          'line-width': 7,
          'line-opacity': 0.75,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      }, before);

      // Number label at the route's centroid — same placement RMMapTab uses.
      const cLng = routeCoords.reduce((s, c) => s + c[0], 0) / routeCoords.length;
      const cLat = routeCoords.reduce((s, c) => s + c[1], 0) / routeCoords.length;
      labelFeatures.push({
        type: 'Feature',
        properties: { num: String(route.routeNumber), color: route.routeColor || '#6b7280' },
        geometry: { type: 'Point', coordinates: [cLng, cLat] },
      });
    });

    // ONE label layer for every route. See the note at the top of this file:
    // a layer per route is what mangles the digits on Android tablets.
    const labelGj: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: labelFeatures };
    const numSrc = map.getSource('dm-num-src') as mapboxgl.GeoJSONSource | undefined;
    if (numSrc) {
      numSrc.setData(labelGj);
    } else {
      map.addSource('dm-num-src', { type: 'geojson', data: labelGj });
      map.addLayer({
        id: 'dm-num-labels',
        type: 'symbol',
        source: 'dm-num-src',
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
    }

    // Lift every non-line layer of ours back to the top, in the order it already
    // sits. moveLayer with no second argument sends a layer to the very top, so
    // iterating in existing order keeps dots and text correctly stacked among
    // themselves while guaranteeing both clear the route lines.
    try {
      const finalLayers: any[] = (map.getStyle()?.layers as any[]) || [];
      finalLayers
        .map(l => String(l.id))
        .filter(id => id.startsWith('dm-') && !id.startsWith('dm-line-'))
        .forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
    } catch (err) {
      console.warn('[DigiMaps] Could not reorder layers:', err);
    }

    if (allCoords.length && !fitDoneRef.current) {
      fitDoneRef.current = true;
      const b = allCoords.reduce(
        (acc, c) => acc.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
      );
      setTimeout(() => mapRef.current?.fitBounds(b, { padding: 60, maxZoom: 15, duration: 700 }), 200);
    }
  }, [drawnRoutes, mapLoaded]);

  // --- DRAW PCL DOTS ---
  // Small grey circles, matching RMMapTab's callbook layer. Not interactive by
  // design: this view is for reading density and coverage, and customer details
  // have no business sitting behind a shared viewer password.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pclDots.map(d => ({
        type: 'Feature' as const,
        properties: { routeCode: d.routeCode },
        geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
      })),
    };

    const src = map.getSource('dm-pcl-src') as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(gj);
    } else {
      map.addSource('dm-pcl-src', { type: 'geojson', data: gj });
      map.addLayer({
        id: 'dm-pcl-circles',
        type: 'circle',
        source: 'dm-pcl-src',
        paint: {
          'circle-color': '#4b5563',
          'circle-radius': 3,
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 0.75,
          'circle-opacity': 0.85,
          'circle-stroke-opacity': 0.85,
        },
      });
    }
  }, [pclDots, mapLoaded]);

  // Visibility toggle, kept separate so flipping it never rebuilds the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!map.getLayer('dm-pcl-circles')) return;
    map.setPaintProperty('dm-pcl-circles', 'circle-opacity', showPcl ? 0.85 : 0);
    map.setPaintProperty('dm-pcl-circles', 'circle-stroke-opacity', showPcl ? 0.85 : 0);
  }, [showPcl, mapLoaded, pclDots]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">

      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        {view === 'map' ? (
          <button
            onClick={handleBackToGrid}
            className="flex items-center gap-1.5 text-gray-300 hover:text-white text-sm"
          >
            <ArrowLeft size={16} /> All Maps
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <MapIcon size={18} className="text-purple-400" />
            <span className="text-white font-bold">Digital Maps</span>
            <span className="text-[10px] uppercase tracking-wider bg-gray-900 border border-gray-700 text-gray-500 rounded px-1.5 py-0.5">
              View only
            </span>
          </div>
        )}

        {view === 'map' && currentArea && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white font-bold text-sm truncate">{currentArea.areaName}</span>
            <span className="font-mono text-purple-300 text-xs">{currentArea.prefix}</span>
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${regionStyle(currentArea.region)}`}>
              {currentArea.region}
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {view === 'map' && (
            <>
              <span className="text-[11px] text-gray-400 hidden sm:inline">
                {drawnRoutes.length} routes · {pclDots.length} PCL
              </span>
              <button
                onClick={() => setShowPcl(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                  showPcl
                    ? 'bg-gray-700 border-gray-600 text-white'
                    : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
                title={showPcl ? 'Hide callbook dots' : 'Show callbook dots'}
              >
                {showPcl ? <Eye size={13} /> : <EyeOff size={13} />} PCL
              </button>
            </>
          )}
          <button
            onClick={handleLogout}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 text-red-400 rounded"
            title="Log out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border-b border-red-700 px-4 py-2 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* GRID VIEW */}
      {view === 'grid' && (
        <div className="flex-1 overflow-y-auto p-6">
          {loadingAreas ? (
            <div className="flex items-center justify-center h-48">
              <Loader size={24} className="animate-spin text-purple-400" />
            </div>
          ) : areas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
              <MapIcon size={44} className="opacity-30" />
              <p className="text-sm">No maps have been built yet.</p>
            </div>
          ) : (
            REGION_ORDER.map(region => {
              const list = areasByRegion.get(region) || [];
              if (list.length === 0) return null;
              return (
                <div key={region} className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${regionStyle(region)}`}>
                      {region}
                    </span>
                    <span className="text-xs text-gray-600">{list.length} areas</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {list.map(area => {
                      const built = area.routesDrawn > 0;
                      return (
                        <div
                          key={area.areaName}
                          onClick={() => handleOpenArea(area)}
                          className={`bg-gray-800 border rounded-xl p-4 transition-all ${
                            built
                              ? 'border-gray-700 cursor-pointer hover:border-purple-500 hover:bg-gray-750'
                              : 'border-gray-800 opacity-40 cursor-not-allowed'
                          }`}
                          title={built ? 'Open map' : 'No approved routes drawn yet'}
                        >
                          <div className="text-xl font-bold font-mono text-white mb-1">{area.prefix}</div>
                          <div className="text-xs text-gray-300 mb-2 leading-tight">{area.areaName}</div>
                          <div className="text-[10px] text-gray-500">
                            <span className={built ? 'text-green-500' : 'text-gray-600'}>
                              {area.routesDrawn}
                            </span>
                            <span className="text-gray-600"> / {area.routeCount} routes drawn</span>
                          </div>
                          <div className="text-[10px] mt-0.5 flex items-center gap-1">
                            <Users size={9} className={area.pclCount > 0 ? 'text-amber-500' : 'text-gray-700'} />
                            <span className={area.pclCount > 0 ? 'text-amber-500' : 'text-gray-700'}>
                              {area.pclCount > 0 ? `${area.pclCount} PCL` : 'no PCL'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MAP VIEW */}
      <div className="flex-1 relative" style={{ display: view === 'map' ? 'block' : 'none' }}>
        <div ref={mapContainerRef} className="absolute inset-0" />
        {loadingMap && (
          <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center z-10">
            <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
              <Loader size={16} className="animate-spin text-purple-400" />
              <span className="text-sm text-gray-200">Loading map…</span>
            </div>
          </div>
        )}
        {!loadingMap && view === 'map' && drawnRoutes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-400">
              No approved routes in this area yet.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DigiMaps;