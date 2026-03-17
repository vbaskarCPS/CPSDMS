// src/pages/SuperAdmin/MapBuilder.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Loader, Check, X, AlertCircle,
  Zap, Plus, Map as MapIcon
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const AREAS = [
  { name: 'Aldershot', center: [-79.870, 43.320] as [number,number], zoom: 13, bbox: '43.295,-79.920,43.345,-79.820', routeCount: 21 },
  { name: 'Ancaster East', center: [-79.957, 43.230] as [number,number], zoom: 13, bbox: '43.205,-79.985,43.255,-79.930', routeCount: 16 },
  { name: 'Ancaster Meadows', center: [-79.990, 43.195] as [number,number], zoom: 13, bbox: '43.170,-80.020,43.220,-79.960', routeCount: 18 },
  { name: 'Ancaster West', center: [-80.030, 43.200] as [number,number], zoom: 13, bbox: '43.170,-80.060,43.230,-80.000', routeCount: 17 },
  { name: 'Binbrook', center: [-79.820, 43.115] as [number,number], zoom: 14, bbox: '43.090,-79.850,43.140,-79.790', routeCount: 9 },
  { name: 'Brant Hills', center: [-79.845, 43.370] as [number,number], zoom: 13, bbox: '43.345,-79.870,43.395,-79.820', routeCount: 15 },
  { name: 'Chedoke', center: [-79.900, 43.245] as [number,number], zoom: 13, bbox: '43.220,-79.930,43.270,-79.870', routeCount: 21 },
  { name: 'Dundas', center: [-79.955, 43.265] as [number,number], zoom: 13, bbox: '43.240,-79.985,43.290,-79.925', routeCount: 11 },
  { name: 'Hampton Heights', center: [-79.835, 43.230] as [number,number], zoom: 13, bbox: '43.205,-79.865,43.255,-79.805', routeCount: 29 },
  { name: 'Hill Park', center: [-79.850, 43.225] as [number,number], zoom: 13, bbox: '43.200,-79.880,43.250,-79.820', routeCount: 23 },
  { name: 'Mohawk', center: [-79.870, 43.235] as [number,number], zoom: 13, bbox: '43.210,-79.900,43.260,-79.840', routeCount: 20 },
  { name: 'Red Hill', center: [-79.790, 43.230] as [number,number], zoom: 13, bbox: '43.205,-79.820,43.255,-79.760', routeCount: 23 },
  { name: 'Rosedale', center: [-79.855, 43.205] as [number,number], zoom: 13, bbox: '43.180,-79.885,43.230,-79.825', routeCount: 17 },
  { name: 'Rushdale', center: [-79.820, 43.215] as [number,number], zoom: 13, bbox: '43.190,-79.850,43.240,-79.790', routeCount: 24 },
  { name: 'Ryckmans', center: [-79.870, 43.195] as [number,number], zoom: 13, bbox: '43.170,-79.900,43.220,-79.840', routeCount: 30 },
  { name: 'Stoney Creek', center: [-79.740, 43.225] as [number,number], zoom: 13, bbox: '43.200,-79.770,43.250,-79.710', routeCount: 24 },
  { name: 'Waterdown', center: [-79.890, 43.340] as [number,number], zoom: 13, bbox: '43.315,-79.920,43.365,-79.860', routeCount: 16 },
  { name: 'Westdale', center: [-79.910, 43.265] as [number,number], zoom: 13, bbox: '43.240,-79.940,43.290,-79.880', routeCount: 16 },
];

const ROUTE_COLORS = [
  '#ef4444','#22c55e','#06b6d4','#3b82f6','#f97316',
  '#60a5fa','#eab308','#ec4899','#a855f7','#dc2626',
  '#16a34a','#d97706','#0d9488','#f472b6','#84cc16',
  '#db2777','#7c3aed','#2563eb','#15803d','#0891b2','#6d28d9',
];

interface RouteData {
  num: number;
  color: string;
  status: 'pending' | 'approved' | 'flagged';
  selectedWayIds: Set<number>;
  streetNames: string[];
  aiNotes: string;
  confidence: number;
}

interface OsmWay {
  id: number;
  name: string;
  geometry: [number, number][];
}

function buildGeoJSON(ways: OsmWay[], selectedIds: Set<number>, color: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ways.map(w => ({
      type: 'Feature',
      id: w.id,
      properties: {
        id: w.id,
        name: w.name,
        selected: selectedIds.has(w.id),
        color,
      },
      geometry: { type: 'LineString', coordinates: w.geometry },
    })),
  };
}

const MapBuilder: React.FC = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [selectedArea, setSelectedArea] = useState(AREAS[0]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [activeRouteNum, setActiveRouteNum] = useState(1);
  const [allWays, setAllWays] = useState<OsmWay[]>([]);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addStreetInput, setAddStreetInput] = useState('');
  const [hoveredWayName, setHoveredWayName] = useState<string | null>(null);

  // Init routes when area changes
  useEffect(() => {
    setRoutes(
      Array.from({ length: selectedArea.routeCount }, (_, i) => ({
        num: i + 1,
        color: ROUTE_COLORS[i] || '#888888',
        status: 'pending' as const,
        selectedWayIds: new Set<number>(),
        streetNames: [],
        aiNotes: '',
        confidence: 0,
      }))
    );
    setActiveRouteNum(1);
    setAllWays([]);
  }, [selectedArea]);

  const activeRoute = routes.find(r => r.num === activeRouteNum);

  // Init Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: selectedArea.center,
      zoom: selectedArea.zoom,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('roads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'roads-base',
        type: 'line',
        source: 'roads',
        filter: ['==', ['get', 'selected'], false],
        paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 2 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      map.addLayer({
        id: 'roads-hover',
        type: 'line',
        source: 'roads',
        filter: ['==', ['get', 'id'], -1],
        paint: { 'line-color': '#60a5fa', 'line-width': 6, 'line-opacity': 0.85 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      map.addLayer({
        id: 'roads-selected',
        type: 'line',
        source: 'roads',
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      setMapLoaded(true);
    });

    const handleHover = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (e.features?.[0]) {
        const id = e.features[0].properties?.id;
        const name = e.features[0].properties?.name;
        map.setFilter('roads-hover', ['==', ['get', 'id'], id]);
        setHoveredWayName(name || null);
        map.getCanvas().style.cursor = 'pointer';
      }
    };

    const handleLeave = () => {
      map.setFilter('roads-hover', ['==', ['get', 'id'], -1]);
      setHoveredWayName(null);
      map.getCanvas().style.cursor = '';
    };

    map.on('mousemove', 'roads-base', handleHover);
    map.on('mousemove', 'roads-selected', handleHover);
    map.on('mouseleave', 'roads-base', handleLeave);
    map.on('mouseleave', 'roads-selected', handleLeave);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setMapLoaded(false); };
  }, []);

  // Click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['roads-base', 'roads-selected'],
      });
      if (!features.length) return;

      const wayId = features[0].properties?.id as number;
      const wayName = features[0].properties?.name as string;

      setRoutes(prev => prev.map(r => {
        if (r.num !== activeRouteNum) return r;
        const newIds = new Set(r.selectedWayIds);
        const newNames = [...r.streetNames];

        if (newIds.has(wayId)) {
          newIds.delete(wayId);
          const stillHasName = allWays.some(w => w.name === wayName && newIds.has(w.id));
          if (!stillHasName) {
            const idx = newNames.indexOf(wayName);
            if (idx > -1) newNames.splice(idx, 1);
          }
        } else {
          newIds.add(wayId);
          if (wayName && !newNames.includes(wayName)) newNames.push(wayName);
        }

        return { ...r, selectedWayIds: newIds, streetNames: newNames };
      }));
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [mapLoaded, activeRouteNum, allWays]);

  // Update map data when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || allWays.length === 0) return;
    const route = routes.find(r => r.num === activeRouteNum);
    if (!route) return;
    const geojson = buildGeoJSON(allWays, route.selectedWayIds, route.color);
    (map.getSource('roads') as mapboxgl.GeoJSONSource).setData(geojson);
  }, [routes, activeRouteNum, mapLoaded, allWays]);

  // Load roads from Overpass
  const loadRoads = useCallback(async () => {
    setLoadingRoads(true);
    setError(null);
    try {
      const query = `[out:json][timeout:30];way["highway"]["name"](${selectedArea.bbox});out geom;`;
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = await resp.json();
      const ways: OsmWay[] = data.elements
        .filter((el: any) => el.type === 'way' && el.geometry && el.tags?.name)
        .map((el: any) => ({
          id: el.id,
          name: el.tags.name,
          geometry: el.geometry.map((pt: any) => [pt.lon, pt.lat] as [number, number]),
        }));
      setAllWays(ways);
    } catch {
      setError('Failed to load roads from OpenStreetMap. Check your connection.');
    } finally {
      setLoadingRoads(false);
    }
  }, [selectedArea]);

  useEffect(() => {
    if (mapLoaded) {
      loadRoads();
      mapRef.current?.flyTo({ center: selectedArea.center, zoom: selectedArea.zoom });
    }
  }, [selectedArea, mapLoaded]);

  // AI extraction
  const handleExtract = async () => {
    if (!activeRoute) return;
    setExtracting(true);
    setError(null);
    try {
      const prompt = `You are an expert on Hamilton, Ontario, Canada street layouts.

I need to know which streets are covered by Route ${activeRoute.num} in the ${selectedArea.name} area of Hamilton.

Based on your knowledge of ${selectedArea.name} neighborhood in Hamilton, Ontario, what streets would typically make up a residential door-to-door service route numbered ${activeRoute.num} out of ${selectedArea.routeCount} total routes in that area?

The routes divide the neighborhood into roughly equal sections. Route ${activeRoute.num} is one of ${selectedArea.routeCount} routes covering ${selectedArea.name}.

Respond ONLY with this exact JSON format, no other text:
{
  "streets": ["Street Name 1", "Street Name 2", "Street Name 3"],
  "confidence": 60,
  "notes": "Brief observation about this route area"
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json();
      const text = data.content[0].text;

      let parsed: { streets: string[]; confidence: number; notes: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { streets: [], confidence: 0, notes: 'Could not parse response' };
      }

      const matchedIds = new Set<number>();
      const matchedNames: string[] = [];

      parsed.streets.forEach((streetName: string) => {
        const matching = allWays.filter(w =>
          w.name.toLowerCase().includes(streetName.toLowerCase()) ||
          streetName.toLowerCase().includes(w.name.toLowerCase())
        );
        matching.forEach(w => matchedIds.add(w.id));
        if (matching.length > 0 && !matchedNames.includes(streetName)) {
          matchedNames.push(streetName);
        }
      });

      setRoutes(prev => prev.map(r =>
        r.num !== activeRouteNum ? r : {
          ...r,
          selectedWayIds: matchedIds,
          streetNames: matchedNames,
          aiNotes: parsed.notes,
          confidence: parsed.confidence,
        }
      ));
    } catch {
      setError('AI extraction failed. Check your Anthropic API key in .env');
    } finally {
      setExtracting(false);
    }
  };

  const handleAddStreet = () => {
    const name = addStreetInput.trim();
    if (!name) return;
    const matching = allWays.filter(w => w.name.toLowerCase().includes(name.toLowerCase()));
    if (matching.length === 0) {
      setError(`No roads found matching "${name}" in this area`);
      return;
    }
    setRoutes(prev => prev.map(r => {
      if (r.num !== activeRouteNum) return r;
      const newIds = new Set(r.selectedWayIds);
      matching.forEach(w => newIds.add(w.id));
      const newNames = r.streetNames.includes(name) ? r.streetNames : [...r.streetNames, matching[0].name];
      return { ...r, selectedWayIds: newIds, streetNames: newNames };
    }));
    setAddStreetInput('');
  };

  const handleRemoveStreet = (streetName: string) => {
    setRoutes(prev => prev.map(r => {
      if (r.num !== activeRouteNum) return r;
      const newIds = new Set(r.selectedWayIds);
      allWays.filter(w => w.name === streetName).forEach(w => newIds.delete(w.id));
      return { ...r, selectedWayIds: newIds, streetNames: r.streetNames.filter(n => n !== streetName) };
    }));
  };

  const handleApprove = () => {
    setRoutes(prev => prev.map(r => r.num === activeRouteNum ? { ...r, status: 'approved' as const } : r));
    const next = routes.find(r => r.num > activeRouteNum && r.status === 'pending');
    if (next) setActiveRouteNum(next.num);
  };

  const handleFlag = () => {
    setRoutes(prev => prev.map(r => r.num === activeRouteNum ? { ...r, status: 'flagged' as const } : r));
    const next = routes.find(r => r.num > activeRouteNum && r.status === 'pending');
    if (next) setActiveRouteNum(next.num);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      const approved = routes.filter(r => r.status === 'approved' && r.selectedWayIds.size > 0);
      for (const route of approved) {
        const segments = allWays
          .filter(w => route.selectedWayIds.has(w.id))
          .map(w => ({ osmId: w.id, name: w.name, coordinates: w.geometry }));
        await supabase.from('route_maps').upsert({
          area_name: selectedArea.name,
          route_number: route.num,
          route_code: `${selectedArea.name.replace(/\s+/g, '_').toUpperCase()}_${route.num}`,
          route_color: route.color,
          segments,
          status: 'approved',
          ai_confidence: route.confidence,
          ai_notes: route.aiNotes,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'area_name,route_number' });
      }
      alert(`Saved ${approved.length} routes for ${selectedArea.name}`);
    } catch {
      setError('Failed to save to database');
    } finally {
      setSaving(false);
    }
  };

  const approvedCount = routes.filter(r => r.status === 'approved').length;
  const flaggedCount = routes.filter(r => r.status === 'flagged').length;
  const pendingCount = routes.filter(r => r.status === 'pending').length;

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
            <h1 className="text-sm font-bold">Map Builder</h1>
            <p className="text-xs text-gray-400">Digital route mapping · {selectedArea.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedArea.name}
            onChange={e => setSelectedArea(AREAS.find(a => a.name === e.target.value) || AREAS[0])}
            className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {AREAS.map(a => (
              <option key={a.name} value={a.name}>{a.name} ({a.routeCount} routes)</option>
            ))}
          </select>
          <button
            onClick={handleSaveAll}
            disabled={saving || approvedCount === 0}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2"
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
            Save {approvedCount} Approved
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border-b border-red-700 px-4 py-2 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Route list */}
        <div className="w-48 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-700 flex justify-between items-center">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Routes</span>
            <span className="text-xs text-green-400">{approvedCount}/{selectedArea.routeCount}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {routes.map(r => (
              <button
                key={r.num}
                onClick={() => setActiveRouteNum(r.num)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-700/40 hover:bg-gray-700 transition-colors ${
                  r.num === activeRouteNum ? 'bg-gray-700 border-l-2 border-l-blue-400' : ''
                }`}
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.color }} />
                <span className="text-xs text-gray-300 flex-1">Route {String(r.num).padStart(2,'0')}</span>
                <span className={`text-[10px] font-bold ${
                  r.status === 'approved' ? 'text-green-400' :
                  r.status === 'flagged' ? 'text-red-400' :
                  r.selectedWayIds.size > 0 ? 'text-blue-400' : 'text-gray-600'
                }`}>
                  {r.status === 'approved' ? '✓' : r.status === 'flagged' ? '!' : r.selectedWayIds.size > 0 ? '●' : '○'}
                </span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-700">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${(approvedCount / selectedArea.routeCount) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px]">
              <span className="text-green-400">{approvedCount} ok</span>
              <span className="text-red-400">{flaggedCount} !</span>
              <span className="text-yellow-400">{pendingCount} left</span>
            </div>
          </div>
        </div>

        {/* CENTER: Map */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {loadingRoads && (
              <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center z-10">
                <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-sm border border-gray-700">
                  <Loader size={16} className="animate-spin text-blue-400" />
                  Loading roads from OpenStreetMap...
                </div>
              </div>
            )}
            {hoveredWayName && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded px-3 py-1.5 text-sm z-10 pointer-events-none">
                {hoveredWayName}
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center gap-3 flex-shrink-0">
            {activeRoute && (
              <div className="flex items-center gap-2 mr-2">
                <div className="w-3 h-3 rounded-full" style={{ background: activeRoute.color }} />
                <span className="text-sm font-medium">Route {String(activeRouteNum).padStart(2,'0')}</span>
                {activeRoute.confidence > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    activeRoute.confidence >= 80 ? 'bg-green-900/30 text-green-400' :
                    activeRoute.confidence >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                    'bg-red-900/30 text-red-400'
                  }`}>
                    {activeRoute.confidence}% confidence
                  </span>
                )}
              </div>
            )}
            <button
              onClick={handleExtract}
              disabled={extracting || allWays.length === 0}
              className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2"
            >
              {extracting ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
              Extract with AI
            </button>
            <button
              onClick={handleApprove}
              disabled={!activeRoute || activeRoute.selectedWayIds.size === 0}
              className="bg-green-800/50 hover:bg-green-700/50 disabled:opacity-50 text-green-400 border border-green-700/50 px-3 py-1.5 rounded text-sm flex items-center gap-2"
            >
              <Check size={14} /> Approve
            </button>
            <button
              onClick={handleFlag}
              className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-3 py-1.5 rounded text-sm flex items-center gap-2"
            >
              <X size={14} /> Flag
            </button>
            <div className="ml-auto text-xs text-gray-500">
              {activeRoute?.selectedWayIds.size || 0} segments selected · click streets to toggle
            </div>
          </div>
        </div>

        {/* RIGHT: Streets panel */}
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Selected Streets</div>
            {activeRoute?.aiNotes && (
              <div className="text-[10px] text-purple-300 italic bg-purple-900/20 rounded px-2 py-1 mt-1">
                {activeRoute.aiNotes}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!activeRoute?.streetNames.length ? (
              <div className="text-xs text-gray-600 italic text-center mt-6 px-2">
                No streets selected yet.<br /><br />
                Click streets on the map, or use "Extract with AI" to auto-populate.
              </div>
            ) : (
              activeRoute.streetNames.map(name => {
                const segCount = allWays.filter(w => w.name === name && activeRoute.selectedWayIds.has(w.id)).length;
                return (
                  <div key={name} className="flex items-center justify-between px-2 py-1.5 bg-gray-900 rounded mb-1 border border-gray-700">
                    <div>
                      <div className="text-xs text-gray-200 font-mono">{name}</div>
                      <div className="text-[9px] text-gray-500">{segCount} segment{segCount !== 1 ? 's' : ''}</div>
                    </div>
                    <button onClick={() => handleRemoveStreet(name)} className="text-red-500 hover:text-red-400 p-0.5 flex-shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="p-2 border-t border-gray-700">
            <div className="flex gap-1">
              <input
                value={addStreetInput}
                onChange={e => setAddStreetInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddStreet()}
                placeholder="Add street manually..."
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <button onClick={handleAddStreet} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-1.5 rounded">
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapBuilder;