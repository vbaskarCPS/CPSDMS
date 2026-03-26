// src/pages/Admin/DigitalMasterBookings.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Loader, AlertCircle, Map as MapIcon, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface AreaItem {
  area_name: string;
  prefix: string;
  route_count: number;
  route_start: number;
}

interface SavedRoute {
  id: string;
  area_name: string;
  route_number: number;
  route_code: string;
  route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}

interface Props {
  onBack: () => void;
}

const DigitalMasterBookings: React.FC<Props> = ({ onBack }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [currentRoutes, setCurrentRoutes] = useState<SavedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadedIdsRef = useRef<string[]>([]);

  // Load all areas on mount
  useEffect(() => {
    const loadAreas = async () => {
      try {
        const { data, error: dbErr } = await supabase
          .from('area_prefixes')
          .select('area_name, prefix, route_count, route_start')
          .order('area_name');
        if (dbErr) throw dbErr;
        setAreas(data || []);
      } catch {
        setError('Failed to load areas.');
      } finally {
        setLoadingAreas(false);
      }
    };
    loadAreas();
  }, []);

  // Initialize Mapbox with light street style
  useEffect(() => {
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

      // Hide POI, place, transit, and water labels — keep only road/street name labels.
      // Also force road label layers to show at all zoom levels (Mapbox hides them below ~z13 by default).
      map.getStyle().layers?.forEach((layer: any) => {
        if (layer.type !== 'symbol') return;
        const id = layer.id.toLowerCase();

        const shouldHide =
          id.includes('poi') ||
          id.includes('transit') ||
          id.includes('airport') ||
          id.includes('park-label') ||
          id.includes('place') ||
          id.includes('settlement') ||
          id.includes('country') ||
          id.includes('state') ||
          id.includes('water-label') ||
          id.includes('waterway') ||
          id.includes('natural') ||
          id.includes('continent');

        if (shouldHide) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
          return;
        }

        // For road/street label layers, remove the minzoom gate so names
        // are always visible regardless of how far out the user is zoomed.
        // For every remaining symbol layer (road names, street labels etc.)
        // force them visible at all zooms, larger, bold, and with no collision suppression
        // so cul-de-sacs and short courts always show their names.
        map.setLayerZoomRange(layer.id, 0, 24);
        map.setLayoutProperty(layer.id, 'text-allow-overlap', true);
        map.setLayoutProperty(layer.id, 'text-ignore-placement', true);
        map.setLayoutProperty(layer.id, 'text-optional', true);

        // Make text larger and bold so it's readable at any zoom
        try {
          map.setLayoutProperty(layer.id, 'text-size', 13);
          map.setLayoutProperty(layer.id, 'text-font', ['DIN Pro Bold', 'Arial Unicode MS Bold']);
        } catch { /* some layers may not support these — safe to skip */ }
      });

      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Clear all drawn route layers/sources from the map
  const clearAllRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    loadedIdsRef.current.forEach(id => {
      const lineId = `dmb-line-${id}`;
      const srcId = `dmb-src-${id}`;
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    });
    loadedIdsRef.current = [];
  }, []);

  // Load and draw all approved routes for a selected area
  const handleSelectArea = useCallback(async (areaName: string) => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    clearAllRoutes();
    setSelectedArea(areaName);
    setLoadingRoutes(true);
    setCurrentRoutes([]);
    setError(null);

    try {
      const { data, error: dbErr } = await supabase
        .from('route_maps')
        .select('*')
        .eq('area_name', areaName)
        .eq('status', 'approved');

      if (dbErr) throw dbErr;

      const routes = (data || []) as SavedRoute[];
      setCurrentRoutes(routes);

      if (routes.length === 0) {
        setError(`No approved routes found for "${areaName}".`);
        return;
      }

      // Use 'road-label' as a stable insertion point in streets-v12.
      // This keeps route lines above road fills but below all text labels at every zoom level.
      const routeInsertBefore = map.getLayer('road-label') ? 'road-label' : undefined;

      const allCoords: [number, number][] = [];

      routes.forEach(route => {
        if (!route.segments || route.segments.length === 0) return;

        const srcId = `dmb-src-${route.id}`;
        const lineId = `dmb-line-${route.id}`;
        loadedIdsRef.current.push(route.id);

        const features: GeoJSON.Feature[] = route.segments.map(seg => ({
          type: 'Feature',
          properties: { route_code: route.route_code, color: route.route_color },
          geometry: { type: 'LineString', coordinates: seg.coordinates },
        }));

        // Collect all coords for bounds fitting
        features.forEach(f => {
          const coords = (f.geometry as GeoJSON.LineString).coordinates as [number, number][];
          allCoords.push(...coords);
        });

        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });

        // Insert BEFORE the first symbol layer so street name labels render on top
        map.addLayer({
          id: lineId,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': route.route_color,
            'line-width': 7,
            'line-opacity': 0.65,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        }, routeInsertBefore);
      });

      // Fly map to fit all routes
      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 });
      }
    } catch {
      setError('Failed to load routes. Please try again.');
    } finally {
      setLoadingRoutes(false);
    }
  }, [mapLoaded, clearAllRoutes]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="w-px h-5 bg-gray-700" />
        <MapPin size={18} className="text-blue-400" />
        <div className="flex-1">
          <h1 className="text-sm font-bold text-white">Digital Master Bookings</h1>
          <p className="text-xs text-gray-400">
            {selectedArea || 'Select an area from the left panel'}
          </p>
        </div>
        {loadingRoutes && (
          <div className="flex items-center gap-2 text-blue-400 text-xs">
            <Loader size={14} className="animate-spin" />
            Loading routes…
          </div>
        )}
        {!loadingRoutes && selectedArea && currentRoutes.length > 0 && (
          <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded border border-gray-700">
            {currentRoutes.length} routes
          </span>
        )}
      </div>

      {/* Error / warning bar */}
      {error && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2 text-sm text-yellow-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-yellow-400 hover:text-white text-lg leading-none">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL — one card per area */}
        <div className="w-60 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Areas</span>
            {!loadingAreas && (
              <span className="text-xs text-gray-600">{areas.length}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingAreas ? (
              <div className="flex items-center justify-center py-10">
                <Loader size={20} className="animate-spin text-blue-400" />
              </div>
            ) : areas.length === 0 ? (
              <div className="text-xs text-gray-600 italic text-center mt-8 px-3">
                No areas found in the database.
              </div>
            ) : (
              areas.map(area => {
                const isSelected = selectedArea === area.area_name;
                return (
                  <button
                    key={area.area_name}
                    onClick={() => handleSelectArea(area.area_name)}
                    disabled={loadingRoutes}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all disabled:opacity-60 ${
                      isSelected
                        ? 'bg-blue-900/50 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-700/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs font-mono tracking-wide">
                        {area.prefix}
                      </span>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">
                        {area.route_count} routes
                      </span>
                    </div>
                    <div className={`text-[11px] mt-0.5 leading-tight ${isSelected ? 'text-blue-300' : 'text-gray-400'}`}>
                      {area.area_name}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* MAP */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />

          {/* Map loading overlay */}
          {!mapLoaded && (
            <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
              <Loader size={24} className="animate-spin text-blue-500" />
            </div>
          )}

          {/* Empty state before any area is selected */}
          {mapLoaded && !selectedArea && !loadingRoutes && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center bg-white/95 rounded-2xl px-10 py-8 border border-gray-200 shadow-lg">
                <MapIcon size={52} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-semibold text-gray-600">No area selected</p>
                <p className="text-xs text-gray-400 mt-1">Pick an area from the panel on the left</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DigitalMasterBookings;