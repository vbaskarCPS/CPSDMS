// src/pages/SuperAdmin/MapViewer.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Loader, AlertCircle, Tag, Map as MapIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface SavedRoute {
  id: string;
  area_name: string;
  route_number: number;
  route_code: string;
  route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
  status: string;
}

const MapViewer: React.FC = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);

  // ─── Load routes from Supabase ───
  useEffect(() => {
    const loadRoutes = async () => {
      setLoading(true);
      try {
        const { data, error: dbError } = await supabase
          .from('route_maps')
          .select('*')
          .eq('status', 'approved');
        if (dbError) throw dbError;
        setRoutes(data || []);
      } catch (e) {
        setError('Failed to load routes from database.');
      } finally {
        setLoading(false);
      }
    };
    loadRoutes();
  }, []);

  // ─── Init Mapbox ───
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.270],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.resize();
      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ─── Draw routes once map and data are both ready ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || loading || routes.length === 0) return;

    // Remove any existing route layers/sources
    routes.forEach(route => {
      const lineId = `route-line-${route.id}`;
      const labelId = `route-label-${route.id}`;
      const sourceId = `route-source-${route.id}`;
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(labelId)) map.removeLayer(labelId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    });

    // Build GeoJSON for each route and add to map
    routes.forEach(route => {
      if (!route.segments || route.segments.length === 0) return;

      const sourceId = `route-source-${route.id}`;
      const lineId = `route-line-${route.id}`;
      const labelId = `route-label-${route.id}`;

      // Each segment becomes a LineString feature
      const features: GeoJSON.Feature[] = route.segments.map(seg => ({
        type: 'Feature',
        properties: {
          route_code: route.route_code,
          area_name: route.area_name,
          route_number: route.route_number,
          color: route.route_color,
          street_name: seg.name,
        },
        geometry: {
          type: 'LineString',
          coordinates: seg.coordinates,
        },
      }));

      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      // Route line — drawn at low opacity so street labels show through
      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': route.route_color,
          'line-width': 4,
          'line-opacity': 0.45,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });

      // Route code label — placed along the line, hidden by default
      map.addLayer({
        id: labelId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 200,
          'text-field': route.route_code,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-keep-upright': true,
          'visibility': showLabels ? 'visible' : 'none',
        },
        paint: {
          'text-color': route.route_color,
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });

      // Hover interaction
      map.on('mouseenter', lineId, () => {
        map.getCanvas().style.cursor = 'pointer';
        setHoveredRoute(`${route.route_code} — ${route.area_name}`);
      });
      map.on('mouseleave', lineId, () => {
        map.getCanvas().style.cursor = '';
        setHoveredRoute(null);
      });
    });

    // Fit map to show all routes
    if (routes.length > 0) {
      const allCoords: [number, number][] = routes.flatMap(r =>
        (r.segments || []).flatMap(s => s.coordinates)
      );
      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, coord) => b.extend(coord as mapboxgl.LngLatLike),
          new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
        );
        map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      }
    }
  }, [mapLoaded, loading, routes]);

  // ─── Toggle labels ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    routes.forEach(route => {
      const labelId = `route-label-${route.id}`;
      if (map.getLayer(labelId)) {
        map.setLayoutProperty(labelId, 'visibility', showLabels ? 'visible' : 'none');
      }
    });
  }, [showLabels, mapLoaded, routes]);

  // Group routes by area for the legend
  const routesByArea = routes.reduce<Record<string, SavedRoute[]>>((acc, r) => {
    if (!acc[r.area_name]) acc[r.area_name] = [];
    acc[r.area_name].push(r);
    return acc;
  }, {});

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin')} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <MapIcon size={20} className="text-purple-400" />
          <div>
            <h1 className="text-sm font-bold">Map Viewer</h1>
            <p className="text-xs text-gray-400">
              {loading ? 'Loading...' : `${routes.length} routes across ${Object.keys(routesByArea).length} areas`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLabels(s => !s)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm border transition-colors ${
              showLabels
                ? 'bg-purple-900/30 border-purple-600 text-purple-300'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Tag size={14} />
            {showLabels ? 'Hide Labels' : 'Show Labels'}
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-red-900/30 border-b border-red-700 px-4 py-2 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Legend */}
        <div className="w-52 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-700">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Areas</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader size={20} className="animate-spin text-purple-400" />
              </div>
            ) : Object.keys(routesByArea).length === 0 ? (
              <div className="text-xs text-gray-600 italic text-center mt-6 px-2">
                No approved routes yet.<br /><br />
                Use Map Builder to map and approve routes first.
              </div>
            ) : (
              Object.entries(routesByArea)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([areaName, areaRoutes]) => (
                  <div key={areaName} className="mb-3">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium px-1 mb-1">
                      {areaName}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {areaRoutes
                        .sort((a, b) => a.route_number - b.route_number)
                        .map(route => (
                          <div
                            key={route.id}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border border-gray-700 bg-gray-900"
                            title={route.route_code}
                          >
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: route.route_color }}
                            />
                            <span className="text-gray-300">{route.route_code}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* MAP */}
        <div className="flex-1 relative">
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />

          {/* Loading overlay */}
          {(loading || !mapLoaded) && (
            <div className="absolute inset-0 bg-gray-900/70 flex items-center justify-center z-10">
              <div className="bg-gray-800 rounded-lg px-5 py-4 flex items-center gap-3 border border-gray-700">
                <Loader size={18} className="animate-spin text-purple-400" />
                <span className="text-sm text-gray-300">Loading routes...</span>
              </div>
            </div>
          )}

          {/* Hovered route tooltip */}
          {hoveredRoute && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded px-3 py-1.5 text-sm z-10 pointer-events-none">
              {hoveredRoute}
            </div>
          )}

          {/* Empty state overlay */}
          {!loading && mapLoaded && routes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center bg-gray-900/80 rounded-xl px-8 py-6 border border-gray-700">
                <MapIcon size={48} className="mx-auto mb-3 text-gray-600 opacity-50" />
                <p className="text-sm text-gray-500">No approved routes to display yet.</p>
                <p className="text-xs text-gray-600 mt-1">Use Map Builder to map and approve routes first.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapViewer;