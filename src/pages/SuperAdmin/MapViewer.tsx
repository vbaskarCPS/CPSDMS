// src/pages/SuperAdmin/MapViewer.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Loader, AlertCircle, Tag, Map as MapIcon, FileSpreadsheet, X, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { googleSheetsService } from '../../lib/googleSheetsService';

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

// Pull the Sheet ID out of a full Google Sheets URL
const extractSheetId = (url: string): string | null => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

// Reverse geocode a coordinate to a city name via Mapbox
const geocodeCity = async (lng: number, lat: number, token: string): Promise<string> => {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place&access_token=${token}`
    );
    const data = await res.json();
    return data.features?.[0]?.text || '';
  } catch {
    return '';
  }
};

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

  // ── Write Routes modal state ──
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetUrlError, setSheetUrlError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAuthing, setIsAuthing] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [writeResult, setWriteResult] = useState<{ count: number } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // ─── Load routes from Supabase (batched to bypass 1000-row server cap) ───
  useEffect(() => {
    const loadRoutes = async () => {
      setLoading(true);
      try {
        const BATCH_SIZE = 1000;
        let all: SavedRoute[] = [];
        let from = 0;
        while (true) {
          const { data, error: dbError } = await supabase
            .from('route_maps')
            .select('*')
            .eq('status', 'approved')
            .range(from, from + BATCH_SIZE - 1);
          if (dbError) throw dbError;
          if (!data || data.length === 0) break;
          all = [...all, ...data];
          if (data.length < BATCH_SIZE) break;
          from += BATCH_SIZE;
        }
        setRoutes(all);
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

  // ─── Modal: URL input handler ───
  const handleSheetUrlChange = (val: string) => {
    setSheetUrl(val);
    setWriteResult(null);
    setWriteError(null);
    const id = extractSheetId(val);
    if (val && !id) {
      setSheetUrlError('Not a valid Google Sheets URL');
      setSheetId(null);
    } else {
      setSheetUrlError(null);
      setSheetId(id);
    }
  };

  // ─── Modal: Google auth ───
  const handleAuth = async () => {
    setIsAuthing(true);
    setWriteError(null);
    try {
      const success = await googleSheetsService.authenticate();
      setIsAuthed(success);
      if (!success) setWriteError('Google sign-in was cancelled or failed.');
    } catch (e: any) {
      setWriteError(e.message || 'Authentication failed.');
    } finally {
      setIsAuthing(false);
    }
  };

  // ─── Modal: Write routes to sheet ───
  const handleWriteRoutes = async () => {
    if (!sheetId) return;
    setIsWriting(true);
    setWriteError(null);
    setWriteResult(null);

    try {
      const token = googleSheetsService.getAccessToken();
      if (!token) throw new Error('Not authenticated.');

      // 1. Geocode one city per area (cached — only one Mapbox call per area)
      const cityCache = new Map<string, string>();
      for (const route of routes) {
        if (cityCache.has(route.area_name)) continue;
        const segs = route.segments || [];
        const midSeg = segs[Math.floor(segs.length / 2)];
        if (!midSeg?.coordinates?.length) {
          cityCache.set(route.area_name, '');
          continue;
        }
        const coords = midSeg.coordinates;
        const midCoord = coords[Math.floor(coords.length / 2)];
        const city = await geocodeCity(midCoord[0], midCoord[1], import.meta.env.VITE_MAPBOX_TOKEN);
        cityCache.set(route.area_name, city);
      }

      // 2. Build rows matching the sheet columns:
      //    A=Manager Assignment (blank), B=Region (blank), C=Master Map,
      //    D=RT #, E=Street_List, F=CITY, G=Territory (blank)
      const rows = routes.map(route => {
        const streets = (route.segments || [])
          .map(s => s.name)
          .filter(Boolean)
          .join(', ');
        return [
          '',                                    // A: Manager Assignment
          '',                                    // B: Region
          route.area_name,                       // C: Master Map
          route.route_code,                      // D: RT #
          streets,                               // E: Street_List
          cityCache.get(route.area_name) || '',  // F: CITY
          '',                                    // G: Territory
        ];
      });

      // 3. Clear existing data from row 2 downward (keeps the header row)
      const clearRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("'Routes'!A2:G")}:clear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      if (!clearRes.ok) {
        const err = await clearRes.json();
        throw new Error(err.error?.message || 'Failed to clear Routes tab. Make sure the tab is named exactly "Routes".');
      }

      // 4. Write all route rows starting at A2
      const writeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("'Routes'!A2")}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: rows }),
        }
      );
      if (!writeRes.ok) {
        const err = await writeRes.json();
        throw new Error(err.error?.message || 'Failed to write routes to sheet.');
      }

      setWriteResult({ count: rows.length });
    } catch (e: any) {
      setWriteError(e.message || 'Something went wrong.');
    } finally {
      setIsWriting(false);
    }
  };

  // ─── Modal: close + reset ───
  const handleCloseModal = () => {
    setShowWriteModal(false);
    setSheetUrl('');
    setSheetId(null);
    setSheetUrlError(null);
    setWriteResult(null);
    setWriteError(null);
    // intentionally keep isAuthed — the token persists in the service
  };

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

          <button
            onClick={() => setShowWriteModal(true)}
            disabled={loading || routes.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm border border-green-700 bg-green-900/30 text-green-300 hover:bg-green-800/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileSpreadsheet size={14} />
            Write Routes
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

      {/* ─── Write Routes Modal ─── */}
      {showWriteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md mx-4 shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-green-400" />
                <h2 className="text-sm font-bold">Write Routes to Sheet</h2>
              </div>
              <button onClick={handleCloseModal} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-5 space-y-5">

              {/* Sheet URL input */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">Google Sheet URL</label>
                <input
                  type="text"
                  value={sheetUrl}
                  onChange={e => handleSheetUrlChange(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
                />
                {sheetUrlError && (
                  <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={11} /> {sheetUrlError}
                  </p>
                )}
                {sheetId && !sheetUrlError && (
                  <p className="text-xs text-green-400 mt-1.5 flex items-center gap-1">
                    <CheckCircle size={11} /> Sheet ID detected
                  </p>
                )}
              </div>

              {/* Google auth */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">Google Account</label>
                {isAuthed ? (
                  <div className="flex items-center gap-2 text-green-400 text-sm">
                    <CheckCircle size={15} />
                    Connected
                  </div>
                ) : (
                  <button
                    onClick={handleAuth}
                    disabled={isAuthing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm disabled:opacity-50 transition-colors"
                  >
                    {isAuthing && <Loader size={13} className="animate-spin" />}
                    {isAuthing ? 'Connecting...' : 'Connect Google Account'}
                  </button>
                )}
              </div>

              {/* Summary of what will be written */}
              <div className="bg-gray-900 rounded-lg px-4 py-3 text-xs text-gray-400 space-y-1.5">
                <p className="text-gray-300 font-medium mb-2">
                  Will write to the <span className="text-green-400 font-semibold">Routes</span> tab:
                </p>
                <p>• <span className="text-gray-200">{routes.length} routes</span> across <span className="text-gray-200">{Object.keys(routesByArea).length} areas</span></p>
                <p>• Clears existing data first, then rewrites fresh</p>
                <p>• City geocoded automatically (one lookup per area)</p>
                <p>• Manager, Region, Territory left blank</p>
              </div>

              {/* Error message */}
              {writeError && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2.5">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>{writeError}</span>
                </div>
              )}

              {/* Success message */}
              {writeResult && (
                <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 border border-green-800 rounded-lg px-3 py-2.5">
                  <CheckCircle size={15} />
                  {writeResult.count} routes written successfully!
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              >
                {writeResult ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={handleWriteRoutes}
                disabled={!sheetId || !isAuthed || isWriting || !!writeResult}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isWriting
                  ? <><Loader size={13} className="animate-spin" /> Writing...</>
                  : <><FileSpreadsheet size={13} /> Write Routes</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapViewer;