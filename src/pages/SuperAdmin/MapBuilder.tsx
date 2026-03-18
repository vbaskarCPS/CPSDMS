// src/pages/SuperAdmin/MapBuilder.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Loader, Check, X, AlertCircle,
  Plus, Map as MapIcon, Scissors, RefreshCw, Pencil, Eye, EyeOff, Edit2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const ROUTE_COLORS = [
  '#ef4444','#22c55e','#06b6d4','#3b82f6','#f97316',
  '#60a5fa','#eab308','#ec4899','#a855f7','#dc2626',
  '#16a34a','#d97706','#0d9488','#f472b6','#84cc16',
  '#db2777','#7c3aed','#2563eb','#15803d','#0891b2','#6d28d9',
  '#854d0e','#166534','#1e40af','#6b21a8','#9f1239',
  '#134e4a','#78350f','#1e3a5f','#4a044e','#7f1d1d',
  '#14532d','#1a365d','#553c9a','#97266d','#c05621',
  '#2d3748','#276749','#2a4365','#6b2737','#285e61',
  '#744210','#2c5282','#702459','#1a202c','#4a5568',
];

type Region = 'West' | 'Central' | 'East';

interface AreaPrefix {
  area_name: string;
  prefix: string;
  region: Region;
  pdf_page: number;
  route_count: number;
  route_start: number;
}

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
  rootId?: number;
  name: string;
  unnamed?: boolean;
  geometry: [number, number][];
}

interface BoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mode: 'add' | 'remove';
}

interface SplitUndoEntry {
  originalWay: OsmWay;
  subWayIds: number[];
}

interface ContextMenu {
  x: number;
  y: number;
  wayId: number;
  currentName: string;
}

// ─── Area modal state ────────────────────────────────────────────────────────
interface AreaModalState {
  open: boolean;
  editing: AreaPrefix | null; // null = new area
  areaName: string;
  prefix: string;
  region: Region;
  routeStart: number;
  routeEnd: number;
}

const EMPTY_MODAL: AreaModalState = {
  open: false,
  editing: null,
  areaName: '',
  prefix: '',
  region: 'West',
  routeStart: 1,
  routeEnd: 1,
};

// ─── Route code formatter ────────────────────────────────────────────────────
function formatRouteCode(prefix: string, num: number): string {
  return `${prefix}${String(num).padStart(2, '0')}`;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): { x: number; y: number; t: number } {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy, t };
}

function splitGeometryAtPoint(
  geometry: [number, number][],
  clickLng: number,
  clickLat: number
): [[number, number][], [number, number][]] | null {
  let bestDist = Infinity;
  let bestSegIndex = 0;
  let bestCoord: [number, number] = geometry[0];

  for (let i = 0; i < geometry.length - 1; i++) {
    const [ax, ay] = geometry[i];
    const [bx, by] = geometry[i + 1];
    const { x, y } = closestPointOnSegment(clickLng, clickLat, ax, ay, bx, by);
    const dist = Math.sqrt((x - clickLng) ** 2 + (y - clickLat) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestSegIndex = i;
      bestCoord = [x, y];
    }
  }

  const firstHalf: [number, number][] = [...geometry.slice(0, bestSegIndex + 1), bestCoord];
  const secondHalf: [number, number][] = [bestCoord, ...geometry.slice(bestSegIndex + 1)];

  const valid = (seg: [number, number][]) => {
    if (seg.length < 2) return false;
    const [fx, fy] = seg[0];
    return seg.some(([x, y]) => x !== fx || y !== fy);
  };

  if (!valid(firstHalf) || !valid(secondHalf)) return null;
  return [firstHalf, secondHalf];
}

function buildGeoJSON(ways: OsmWay[], selectedIds: Set<number>, color: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ways.map(w => ({
      type: 'Feature',
      id: w.id,
      properties: { id: w.id, name: w.name, unnamed: w.unnamed ? 1 : 0, selected: selectedIds.has(w.id) ? 1 : 0, color },
      geometry: { type: 'LineString', coordinates: w.geometry },
    })),
  };
}

function buildGhostGeoJSON(
  ways: OsmWay[],
  routes: RouteData[],
  activeRouteNum: number
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const wayMap = new Map<number, OsmWay>();
  ways.forEach(w => wayMap.set(w.id, w));

  routes.forEach(route => {
    if (route.num === activeRouteNum) return;
    if (route.selectedWayIds.size === 0) return;
    route.selectedWayIds.forEach(wayId => {
      const way = wayMap.get(wayId);
      if (!way) return;
      features.push({
        type: 'Feature',
        id: wayId,
        properties: { id: wayId, color: route.color, routeNum: route.num },
        geometry: { type: 'LineString', coordinates: way.geometry },
      });
    });
  });

  return { type: 'FeatureCollection', features };
}

// ─── Overpass fetch ──────────────────────────────────────────────────────────
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

async function fetchOverpass(bbox: string): Promise<OsmWay[]> {
  const query = `data=${encodeURIComponent(
    `[out:json][timeout:60];(way["highway"]["name"](${bbox});way["highway"]["highway"~"residential|service|unclassified|living_street"][!"name"](${bbox}););out geom;`
  )}`;

  const tryEndpoint = (url: string): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18000);
    return fetch(url, {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  };

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await tryEndpoint(endpoint);
      if (r.ok) {
        const data = await r.json();
        return data.elements
          .filter((el: any) => el.type === 'way' && el.geometry)
          .map((el: any) => ({
            id: el.id,
            name: el.tags?.name || '',
            unnamed: !el.tags?.name,
            geometry: el.geometry.map((pt: any) => [pt.lon, pt.lat] as [number, number]),
          }));
      }
    } catch { /* try next mirror */ }
  }
  throw new Error('All Overpass mirrors failed — try again in a moment');
}

// ─── Region badge color ──────────────────────────────────────────────────────
function regionStyle(region: Region) {
  if (region === 'West') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (region === 'Central') return 'bg-green-900/40 text-green-300 border-green-700';
  return 'bg-orange-900/40 text-orange-300 border-orange-700';
}

// ─── Component ───────────────────────────────────────────────────────────────

const MapBuilder: React.FC = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // View: 'grid' = area card grid, 'map' = map editor
  const [view, setView] = useState<'grid' | 'map'>('grid');

  // Areas
  const [areas, setAreas] = useState<AreaPrefix[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [currentArea, setCurrentArea] = useState<AreaPrefix | null>(null);

  // Area modal (add / edit)
  const [modal, setModal] = useState<AreaModalState>(EMPTY_MODAL);
  const [savingArea, setSavingArea] = useState(false);

  // Routes
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [activeRouteNum, setActiveRouteNum] = useState(1);
  const [allWays, setAllWays] = useState<OsmWay[]>([]);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addStreetInput, setAddStreetInput] = useState('');
  const [hoveredWayName, setHoveredWayName] = useState<string | null>(null);

  // Ghost routes toggle
  const [showGhostRoutes, setShowGhostRoutes] = useState(false);

  // Split
  const [wayOverrides, setWayOverrides] = useState<Map<number, OsmWay[]>>(new Map());
  const [splitUndoStack, setSplitUndoStack] = useState<SplitUndoEntry[]>([]);
  const [xKeyHeld, setXKeyHeld] = useState(false);
  const xKeyHeldRef = useRef(false);
  const splitCounterRef = useRef(2_000_000);

  // Road rename
  const [wayNameOverrides, setWayNameOverrides] = useState<Map<number, string>>(new Map());
  const wayNameOverridesRef = useRef<Map<number, string>>(new Map());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [contextMenuInput, setContextMenuInput] = useState('');
  const contextMenuInputRef = useRef<HTMLInputElement>(null);

  // Box selection
  const [boxState, setBoxState] = useState<BoxState | null>(null);
  const boxStateRef = useRef<BoxState | null>(null);
  const isDraggingRef = useRef(false);

  // Stable refs
  const activeRouteNumRef = useRef(activeRouteNum);
  const allWaysRef = useRef<OsmWay[]>([]);
  const wayOverridesRef = useRef<Map<number, OsmWay[]>>(new Map());

  useEffect(() => { activeRouteNumRef.current = activeRouteNum; }, [activeRouteNum]);
  useEffect(() => { allWaysRef.current = allWays; }, [allWays]);
  useEffect(() => { wayOverridesRef.current = wayOverrides; }, [wayOverrides]);
  useEffect(() => { wayNameOverridesRef.current = wayNameOverrides; }, [wayNameOverrides]);
  useEffect(() => { boxStateRef.current = boxState; }, [boxState]);

  const effectiveWays = useMemo<OsmWay[]>(() => {
    const expand = (way: OsmWay): OsmWay[] => {
      const subs = wayOverrides.get(way.id);
      if (!subs) {
        const nameOverride = wayNameOverrides.get(way.id);
        if (nameOverride) return [{ ...way, name: nameOverride, unnamed: false }];
        return [way];
      }
      return subs.flatMap(expand);
    };
    return allWays.flatMap(expand);
  }, [allWays, wayOverrides, wayNameOverrides]);

  const activeRoute = routes.find(r => r.num === activeRouteNum);
  const approvedCount = routes.filter(r => r.status === 'approved').length;
  const flaggedCount = routes.filter(r => r.status === 'flagged').length;
  const pendingCount = routes.filter(r => r.status === 'pending').length;

  // ─── Load areas ───
  useEffect(() => { loadAreas(); }, []);

  const loadAreas = async () => {
    setLoadingAreas(true);
    const { data } = await supabase.from('area_prefixes').select('*').order('area_name');
    if (data) setAreas(data as AreaPrefix[]);
    setLoadingAreas(false);
  };

  // ─── Open area modal (new) ───
  const openNewAreaModal = () => {
    setModal({ ...EMPTY_MODAL, open: true });
  };

  // ─── Open area modal (edit) ───
  const openEditAreaModal = (area: AreaPrefix, e: React.MouseEvent) => {
    e.stopPropagation(); // don't open the map
    setModal({
      open: true,
      editing: area,
      areaName: area.area_name,
      prefix: area.prefix,
      region: area.region,
      routeStart: area.route_start ?? 1,
      routeEnd: (area.route_start ?? 1) + area.route_count - 1,
    });
  };

  // ─── Save area (new or edit) ───
  const handleSaveArea = async () => {
    const { areaName, prefix, region, routeStart, routeEnd } = modal;
    if (!areaName.trim() || !prefix.trim() || routeEnd < routeStart) return;
    setSavingArea(true);
    try {
      const route_count = routeEnd - routeStart + 1;
      const record: AreaPrefix = {
        area_name: areaName.trim(),
        prefix: prefix.toUpperCase(),
        region,
        pdf_page: modal.editing?.pdf_page ?? 0,
        route_count,
        route_start: routeStart,
      };
      await supabase.from('area_prefixes').upsert(record, { onConflict: 'area_name' });
      await loadAreas();
      setModal(EMPTY_MODAL);
    } catch { setError('Failed to save area.'); }
    finally { setSavingArea(false); }
  };

  // ─── Open area in map ───
  const handleOpenArea = (area: AreaPrefix) => {
    setCurrentArea(area);
    initRoutesForArea(area);
    setView('map');
    setTimeout(() => mapRef.current?.resize(), 100);
  };

  // ─── Back to grid ───
  const handleBackToGrid = () => {
    setView('grid');
    setCurrentArea(null);
    setTimeout(() => mapRef.current?.resize(), 100);
  };

  // ─── Init routes ───
  const initRoutesForArea = (area: AreaPrefix) => {
    const start = area.route_start ?? 1;
    setRoutes(Array.from({ length: area.route_count }, (_, i) => ({
      num: start + i,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      status: 'pending' as const,
      selectedWayIds: new Set<number>(),
      streetNames: [],
      aiNotes: '',
      confidence: 0,
    })));
    setActiveRouteNum(start);
    setAllWays([]);
    setWayOverrides(new Map());
    setWayNameOverrides(new Map());
    setSplitUndoStack([]);
    setContextMenu(null);
    isDraggingRef.current = false;
    mapRef.current?.dragPan.enable();
  };

  // ─── Insert Route ───
  const handleInsertRoute = useCallback(async (afterRouteNum: number) => {
    if (!currentArea) return;

    const { data: saved } = await supabase
      .from('route_maps')
      .select('route_number')
      .eq('area_name', currentArea.area_name)
      .limit(1);

    if (saved && saved.length > 0) {
      setError('Cannot insert a route — routes for this area are already saved. Inserting would renumber saved data.');
      return;
    }

    setRoutes(prev => {
      const totalRoutes = prev.length + 1;
      const shifted = prev.map(r => r.num <= afterRouteNum ? r : { ...r, num: r.num + 1 });
      const newRoute: RouteData = {
        num: afterRouteNum + 1,
        color: ROUTE_COLORS[(totalRoutes - 1) % ROUTE_COLORS.length],
        status: 'pending',
        selectedWayIds: new Set<number>(),
        streetNames: [],
        aiNotes: '',
        confidence: 0,
      };
      return [...shifted, newRoute].sort((a, b) => a.num - b.num);
    });

    setActiveRouteNum(afterRouteNum + 1);
  }, [currentArea]);

  // ─── X key tracking ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'x' || e.key === 'X') {
        xKeyHeldRef.current = true; setXKeyHeld(true);
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'crosshair';
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSplitUndo(); }
      if (e.key === 'Escape') setContextMenu(null);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'x' || e.key === 'X') {
        xKeyHeldRef.current = false; setXKeyHeld(false);
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [splitUndoStack]);

  // ─── Split undo ───
  const handleSplitUndo = useCallback(() => {
    setSplitUndoStack(prev => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setWayOverrides(o => { const n = new Map(o); n.delete(last.originalWay.id); return n; });
      setRoutes(rs => rs.map(r => {
        const newIds = new Set(r.selectedWayIds);
        last.subWayIds.forEach(id => newIds.delete(id));
        return { ...r, selectedWayIds: newIds };
      }));
      return prev.slice(0, -1);
    });
  }, []);

  // ─── Execute split ───
  const executeSplit = useCallback((way: OsmWay, clickLng: number, clickLat: number) => {
    const result = splitGeometryAtPoint(way.geometry, clickLng, clickLat);
    if (!result) { setError('Could not split here — click closer to the centre of a segment.'); return; }
    const [geomA, geomB] = result;
    const rootId = way.rootId ?? way.id;
    const subA: OsmWay = { id: splitCounterRef.current++, rootId, name: way.name, unnamed: way.unnamed, geometry: geomA };
    const subB: OsmWay = { id: splitCounterRef.current++, rootId, name: way.name, unnamed: way.unnamed, geometry: geomB };

    const existingNameOverride = wayNameOverridesRef.current.get(way.id);
    if (existingNameOverride) {
      setWayNameOverrides(prev => {
        const next = new Map(prev);
        next.set(subA.id, existingNameOverride);
        next.set(subB.id, existingNameOverride);
        return next;
      });
    }

    setRoutes(prev => prev.map(r => {
      if (!r.selectedWayIds.has(way.id)) return r;
      const newIds = new Set(r.selectedWayIds);
      newIds.delete(way.id); newIds.add(subA.id); newIds.add(subB.id);
      return { ...r, selectedWayIds: newIds };
    }));
    setSplitUndoStack(prev => [...prev, { originalWay: way, subWayIds: [subA.id, subB.id] }]);
    setWayOverrides(prev => { const next = new Map(prev); next.set(way.id, [subA, subB]); return next; });
  }, []);

  // ─── Rename confirm ───
  const handleRenameConfirm = useCallback(() => {
    if (!contextMenu) return;
    const name = contextMenuInput.trim();
    if (!name) { setContextMenu(null); return; }

    setWayNameOverrides(prev => { const next = new Map(prev); next.set(contextMenu.wayId, name); return next; });

    setRoutes(prev => prev.map(r => {
      if (!r.selectedWayIds.has(contextMenu.wayId)) return r;
      const newNames = [...r.streetNames];
      const oldName = contextMenu.currentName;
      if (oldName && newNames.includes(oldName)) {
        newNames.splice(newNames.indexOf(oldName), 1, name);
      } else if (!newNames.includes(name)) {
        newNames.push(name);
      }
      return { ...r, streetNames: newNames };
    }));

    setContextMenu(null);
    setContextMenuInput('');
  }, [contextMenu, contextMenuInput]);

  // ─── Init Mapbox ───
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.320],
      zoom: 13,
    });

    map.boxZoom.disable();
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.resize();

      map.addSource('roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('roads-ghost', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'roads-ghost-layer',
        type: 'line',
        source: 'roads-ghost',
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      map.addLayer({ id: 'roads-base', type: 'line', source: 'roads', filter: ['all', ['==', ['get', 'selected'], 0], ['==', ['get', 'unnamed'], 0]], paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 2 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'roads-unnamed', type: 'line', source: 'roads', filter: ['all', ['==', ['get', 'selected'], 0], ['==', ['get', 'unnamed'], 1]], paint: { 'line-color': 'rgba(255,255,255,0.09)', 'line-width': 2, 'line-dasharray': [2, 3] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'roads-hover', type: 'line', source: 'roads', filter: ['==', ['get', 'id'], -1], paint: { 'line-color': '#60a5fa', 'line-width': 6, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'roads-selected', type: 'line', source: 'roads', filter: ['==', ['get', 'selected'], 1], paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });

      const ALL_ROAD_LAYERS = ['roads-base', 'roads-unnamed', 'roads-selected'];

      const handleHover = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
        if (e.features?.[0]) {
          map.setFilter('roads-hover', ['==', ['get', 'id'], e.features[0].properties?.id]);
          const name = e.features[0].properties?.name as string;
          const isUnnamed = e.features[0].properties?.unnamed === 1 || e.features[0].properties?.unnamed === '1';
          setHoveredWayName(name || (isUnnamed ? '(unnamed — right-click to name)' : null));
          if (!xKeyHeldRef.current) map.getCanvas().style.cursor = 'pointer';
        }
      };
      const handleLeave = () => {
        map.setFilter('roads-hover', ['==', ['get', 'id'], -1]);
        setHoveredWayName(null);
        if (!xKeyHeldRef.current) map.getCanvas().style.cursor = '';
      };
      ALL_ROAD_LAYERS.forEach(layer => { map.on('mousemove', layer, handleHover); map.on('mouseleave', layer, handleLeave); });

      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ─── Right-click context menu ───
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas || !mapLoaded) return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const map = mapRef.current;
      if (!map || !currentArea) return;
      const rect = canvas.getBoundingClientRect();
      const features = map.queryRenderedFeatures(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        { layers: ['roads-base', 'roads-unnamed', 'roads-selected'] },
      );
      if (!features.length) return;
      const wayId = features[0].properties?.id as number;
      const currentName = features[0].properties?.name as string || '';
      const menuX = Math.min(e.clientX, window.innerWidth - 264);
      const menuY = Math.min(e.clientY, window.innerHeight - 130);
      setContextMenu({ x: menuX, y: menuY, wayId, currentName });
      setContextMenuInput(currentName);
    };

    canvas.addEventListener('contextmenu', onContextMenu);
    return () => canvas.removeEventListener('contextmenu', onContextMenu);
  }, [mapLoaded, currentArea]);

  useEffect(() => {
    if (contextMenu && contextMenuInputRef.current) {
      setTimeout(() => { contextMenuInputRef.current?.focus(); contextMenuInputRef.current?.select(); }, 30);
    }
  }, [contextMenu]);

  // ─── Box selection ───
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey && !e.altKey) return;
      if (!currentArea) return;
      setContextMenu(null);
      e.preventDefault(); e.stopPropagation();
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const mode = e.shiftKey ? 'add' : 'remove';
      const newBox: BoxState = { startX: x, startY: y, currentX: x, currentY: y, mode };
      boxStateRef.current = newBox; setBoxState(newBox);
      mapRef.current?.dragPan.disable();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !boxStateRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const updated = { ...boxStateRef.current, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top };
      boxStateRef.current = updated; setBoxState({ ...updated });
    };

    const onMouseUp = () => {
      if (!isDraggingRef.current || !boxStateRef.current) return;
      isDraggingRef.current = false;
      mapRef.current?.dragPan.enable();
      const box = boxStateRef.current;
      const minX = Math.min(box.startX, box.currentX), minY = Math.min(box.startY, box.currentY);
      const maxX = Math.max(box.startX, box.currentX), maxY = Math.max(box.startY, box.currentY);
      if (maxX - minX > 5 && maxY - minY > 5) {
        const map = mapRef.current;
        if (map) {
          const features = map.queryRenderedFeatures([{ x: minX, y: minY }, { x: maxX, y: maxY }], { layers: ['roads-base', 'roads-unnamed', 'roads-selected'] });
          const hitIds = new Set<number>(features.map(f => f.properties?.id as number).filter(Boolean));
          const hitNames = new Set<string>(features.map(f => f.properties?.name as string).filter(Boolean));
          const routeNum = activeRouteNumRef.current;
          const mode = box.mode;
          const overrides = wayOverridesRef.current;
          const nameOverrides = wayNameOverridesRef.current;
          const effWays = allWaysRef.current.flatMap(w => {
            const expand = (way: OsmWay): OsmWay[] => {
              const s = overrides.get(way.id);
              if (!s) { const no = nameOverrides.get(way.id); return [no ? { ...way, name: no, unnamed: false } : way]; }
              return s.flatMap(expand);
            };
            return expand(w);
          });
          setRoutes(prev => prev.map(r => {
            if (r.num !== routeNum) return r;
            const newIds = new Set(r.selectedWayIds);
            let newNames = [...r.streetNames];
            if (mode === 'add') {
              hitIds.forEach(id => newIds.add(id));
              hitNames.forEach(name => { if (name && !newNames.includes(name)) newNames.push(name); });
            } else {
              hitIds.forEach(id => newIds.delete(id));
              newNames = newNames.filter(name => effWays.some(w => w.name === name && newIds.has(w.id)));
            }
            return { ...r, selectedWayIds: newIds, streetNames: newNames };
          }));
        }
      }
      boxStateRef.current = null; setBoxState(null);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      mapRef.current?.dragPan.enable(); isDraggingRef.current = false;
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [mapLoaded, currentArea]);

  // ─── Click handler ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      if (isDraggingRef.current) return;
      setContextMenu(null);
      const features = map.queryRenderedFeatures(e.point, { layers: ['roads-base', 'roads-unnamed', 'roads-selected'] });
      if (!features.length) return;
      const wayId = features[0].properties?.id as number;
      const wayName = features[0].properties?.name as string;
      const isSelected = features[0].properties?.selected === 1 || features[0].properties?.selected === '1';

      if (xKeyHeldRef.current) {
        const way = effectiveWays.find(w => w.id === wayId);
        if (!way) return;
        const lngLat = map.unproject(e.point);
        executeSplit(way, lngLat.lng, lngLat.lat);
        return;
      }

      setRoutes(prev => prev.map(r => {
        if (r.num !== activeRouteNum) return r;
        const newIds = new Set(r.selectedWayIds);
        let newNames = [...r.streetNames];
        if (isSelected) {
          newIds.delete(wayId);
          if (!effectiveWays.some(w => w.name === wayName && newIds.has(w.id)))
            newNames = newNames.filter(n => n !== wayName);
        } else {
          newIds.add(wayId);
          if (wayName && !newNames.includes(wayName)) newNames.push(wayName);
        }
        return { ...r, selectedWayIds: newIds, streetNames: newNames };
      }));
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [mapLoaded, activeRouteNum, effectiveWays, executeSplit]);

  // ─── Update roads GeoJSON ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('roads') as mapboxgl.GeoJSONSource;
    if (!source) return;
    const route = routes.find(r => r.num === activeRouteNum);
    const selectedIds = route?.selectedWayIds ?? new Set<number>();
    const color = route?.color ?? '#888888';
    source.setData(buildGeoJSON(effectiveWays, selectedIds, color));
  }, [routes, activeRouteNum, mapLoaded, effectiveWays]);

  // ─── Update ghost routes ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const ghostSource = map.getSource('roads-ghost') as mapboxgl.GeoJSONSource;
    if (ghostSource) ghostSource.setData(buildGhostGeoJSON(effectiveWays, routes, activeRouteNum));
    if (map.getLayer('roads-ghost-layer')) {
      map.setPaintProperty('roads-ghost-layer', 'line-opacity', showGhostRoutes ? 0.28 : 0);
    }
  }, [routes, activeRouteNum, mapLoaded, effectiveWays, showGhostRoutes]);

  // ─── Load roads ───
  const loadRoads = useCallback(async (area: AreaPrefix) => {
    setLoadingRoads(true); setError(null);
    try {
      const fullName = area.area_name.toLowerCase().replace(/#\d+/g, '').trim();
      let center: [number, number] = [-79.870, 43.270];
      const searchCandidates = [fullName, fullName.split(' ')[0], fullName.split(' ').slice(0, 2).join(' ')].filter((v, i, a) => a.indexOf(v) === i);

      for (const candidate of searchCandidates) {
        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(candidate + ', Hamilton, Ontario, Canada')}&format=json&limit=1`, { headers: { 'User-Agent': 'CPSDMS-MapBuilder/1.0' } });
          const data = await resp.json();
          if (data.length > 0) { center = [parseFloat(data[0].lon), parseFloat(data[0].lat)]; break; }
        } catch { /* try next */ }
      }

      await new Promise<void>(resolve => {
        const map = mapRef.current;
        if (!map) { resolve(); return; }
        const timer = setTimeout(resolve, 3000);
        map.once('moveend', () => { clearTimeout(timer); resolve(); });
        map.flyTo({ center, zoom: 14 });
      });

      const map = mapRef.current;
      if (!map) throw new Error('Map not available');
      const b = map.getBounds();
      const latPad = (b.getNorth() - b.getSouth()) * 0.1;
      const lngPad = (b.getEast() - b.getWest()) * 0.1;
      const bbox = `${b.getSouth() - latPad},${b.getWest() - lngPad},${b.getNorth() + latPad},${b.getEast() + lngPad}`;
      const ways = await fetchOverpass(bbox);
      setAllWays(ways);
    } catch { setError('Failed to load roads — click "Load More Roads" to retry.'); }
    finally { setLoadingRoads(false); }
  }, []);

  useEffect(() => { if (mapLoaded && currentArea && view === 'map') loadRoads(currentArea); }, [currentArea, mapLoaded, view]);

  // ─── Restore saved routes ───
  useEffect(() => {
    if (!currentArea || allWays.length === 0) return;
    const restore = async () => {
      try {
        const { data, error: dbErr } = await supabase.from('route_maps').select('*').eq('area_name', currentArea.area_name);
        if (dbErr || !data || data.length === 0) return;
        const osmIdToWay = new Map<number, OsmWay>();
        allWays.forEach(w => osmIdToWay.set(w.id, w));
        setRoutes(prev => prev.map(route => {
          if (route.selectedWayIds.size > 0 || route.status !== 'pending') return route;
          const saved = data.find((d: any) => d.route_number === route.num);
          if (!saved) return route;
          const selectedWayIds = new Set<number>();
          const streetNames: string[] = [];
          (saved.segments || []).forEach((seg: any) => {
            const way = osmIdToWay.get(seg.osmId);
            if (way) { selectedWayIds.add(way.id); if (seg.name && !streetNames.includes(seg.name)) streetNames.push(seg.name); }
          });
          if (selectedWayIds.size === 0) return route;
          return { ...route, selectedWayIds, streetNames, status: saved.status as 'pending' | 'approved' | 'flagged', aiNotes: saved.ai_notes || '', confidence: saved.ai_confidence || 0 };
        }));
      } catch { /* silent */ }
    };
    restore();
  }, [allWays, currentArea]);

  // ─── Load more roads ───
  const loadRoadsFromViewport = useCallback(async () => {
    const map = mapRef.current;
    if (!map || loadingRoads) return;
    setLoadingRoads(true); setError(null);
    try {
      const b = map.getBounds();
      const latPad = (b.getNorth() - b.getSouth()) * 0.1;
      const lngPad = (b.getEast() - b.getWest()) * 0.1;
      const bbox = `${b.getSouth() - latPad},${b.getWest() - lngPad},${b.getNorth() + latPad},${b.getEast() + lngPad}`;
      const newWays = await fetchOverpass(bbox);
      setAllWays(prev => { const existingIds = new Set(prev.map(w => w.id)); return [...prev, ...newWays.filter(w => !existingIds.has(w.id))]; });
    } catch { setError('All Overpass mirrors are unavailable — please try again in a moment.'); }
    finally { setLoadingRoads(false); }
  }, [loadingRoads]);

  const handleAddStreet = () => {
    const name = addStreetInput.trim();
    if (!name) return;
    const matching = effectiveWays.filter(w => w.name.toLowerCase().includes(name.toLowerCase()));
    if (!matching.length) { setError(`No roads found matching "${name}"`); return; }
    setRoutes(prev => prev.map(r => {
      if (r.num !== activeRouteNum) return r;
      const newIds = new Set(r.selectedWayIds);
      matching.forEach(w => newIds.add(w.id));
      const newNames = r.streetNames.includes(matching[0].name) ? r.streetNames : [...r.streetNames, matching[0].name];
      return { ...r, selectedWayIds: newIds, streetNames: newNames };
    }));
    setAddStreetInput('');
  };

  const handleRemoveStreet = (streetName: string) => {
    setRoutes(prev => prev.map(r => {
      if (r.num !== activeRouteNum) return r;
      const newIds = new Set(r.selectedWayIds);
      effectiveWays.filter(w => w.name === streetName).forEach(w => newIds.delete(w.id));
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
    if (!currentArea) return;
    setSaving(true); setError(null);
    try {
      const approved = routes.filter(r => r.status === 'approved' && r.selectedWayIds.size > 0);
      for (const route of approved) {
        const segments = effectiveWays.filter(w => route.selectedWayIds.has(w.id)).map(w => ({ osmId: w.rootId ?? w.id, name: w.name, coordinates: w.geometry }));
        const routeCode = formatRouteCode(currentArea.prefix, route.num);
        await supabase.from('route_maps').upsert({ area_name: currentArea.area_name, route_number: route.num, route_code: routeCode, route_color: route.color, segments, status: 'approved', ai_confidence: route.confidence, ai_notes: route.aiNotes, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'area_name,route_number' });
      }
      alert(`Saved ${approved.length} routes for ${currentArea.area_name}`);
    } catch { setError('Failed to save.'); }
    finally { setSaving(false); }
  };

  const boxRect = boxState ? {
    left: Math.min(boxState.startX, boxState.currentX),
    top: Math.min(boxState.startY, boxState.currentY),
    width: Math.abs(boxState.currentX - boxState.startX),
    height: Math.abs(boxState.currentY - boxState.startY),
    mode: boxState.mode,
  } : null;

  const modalRouteCount = modal.routeEnd >= modal.routeStart ? modal.routeEnd - modal.routeStart + 1 : 0;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {view === 'map' ? (
            <button onClick={handleBackToGrid} className="text-gray-400 hover:text-white flex items-center gap-1.5 text-sm">
              <ArrowLeft size={16} />Areas
            </button>
          ) : (
            <button onClick={() => navigate('/super-admin')} className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></button>
          )}
          <MapIcon size={20} className="text-purple-400" />
          <div>
            <h1 className="text-sm font-bold">Map Builder</h1>
            <p className="text-xs text-gray-400">
              {view === 'map' && currentArea
                ? `${currentArea.area_name} · ${currentArea.prefix} · ${currentArea.region} · ${formatRouteCode(currentArea.prefix, currentArea.route_start ?? 1)}–${formatRouteCode(currentArea.prefix, routes[routes.length - 1]?.num ?? (currentArea.route_start ?? 1))}`
                : `${areas.length} areas`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {view === 'map' && (
            <>
              {splitUndoStack.length > 0 && (
                <button onClick={handleSplitUndo} className="flex items-center gap-2 px-3 py-1.5 rounded text-sm border border-yellow-700 bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40">
                  <Scissors size={14} />Undo Split ({splitUndoStack.length})
                </button>
              )}
              <button onClick={handleSaveAll} disabled={saving || approvedCount === 0} className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2">
                {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}Save {approvedCount} Approved
              </button>
            </>
          )}
          {view === 'grid' && (
            <button onClick={openNewAreaModal} className="bg-purple-700 hover:bg-purple-600 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2">
              <Plus size={14} />New Area
            </button>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-red-900/30 border-b border-red-700 px-4 py-2 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />{error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Split mode banner */}
      {xKeyHeld && currentArea && (
        <div className="bg-yellow-900/40 border-b border-yellow-700 px-4 py-2 text-sm text-yellow-300 flex items-center gap-3 flex-shrink-0">
          <Scissors size={14} className="flex-shrink-0" />
          <span>Split mode — click anywhere on a segment to split it in two</span>
          <span className="ml-auto text-xs text-yellow-500">Release X to exit · Ctrl+Z to undo</span>
        </div>
      )}

      {/* ── GRID VIEW ── */}
      {view === 'grid' && (
        <div className="flex-1 overflow-y-auto p-6">
          {loadingAreas ? (
            <div className="flex items-center justify-center h-48">
              <Loader size={24} className="animate-spin text-purple-400" />
            </div>
          ) : areas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-4">
              <MapIcon size={48} className="text-gray-600 opacity-40" />
              <p className="text-gray-500 text-sm">No areas yet — click "New Area" to add your first one</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {areas.map(area => {
                const start = area.route_start ?? 1;
                const end = start + area.route_count - 1;
                return (
                  <div
                    key={area.area_name}
                    onClick={() => handleOpenArea(area)}
                    className="relative bg-gray-800 border border-gray-700 rounded-xl p-4 cursor-pointer hover:border-purple-500 hover:bg-gray-750 transition-all group"
                  >
                    {/* Edit button */}
                    <button
                      onClick={e => openEditAreaModal(area, e)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-white bg-gray-700 hover:bg-gray-600 rounded p-1"
                      title="Edit area"
                    >
                      <Edit2 size={11} />
                    </button>

                    {/* Prefix badge */}
                    <div className="text-xl font-bold font-mono text-white mb-1">{area.prefix}</div>

                    {/* Area name */}
                    <div className="text-xs text-gray-300 mb-2 leading-tight">{area.area_name}</div>

                    {/* Region badge */}
                    <div className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded border mb-2 ${regionStyle(area.region)}`}>
                      {area.region}
                    </div>

                    {/* Route range */}
                    <div className="text-[10px] text-gray-500 font-mono">
                      {formatRouteCode(area.prefix, start)}–{formatRouteCode(area.prefix, end)}
                    </div>
                    <div className="text-[9px] text-gray-600 mt-0.5">{area.route_count} routes</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MAP VIEW ── always rendered so Mapbox can initialise on mount */}
      <div className="flex flex-1 overflow-hidden" style={{ display: view === 'map' ? 'flex' : 'none' }}>

          {/* LEFT: Route list */}
          {currentArea && (
            <div className="w-48 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
              <div className="px-3 py-2 border-b border-gray-700 flex justify-between items-center">
                <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Routes</span>
                <span className="text-xs text-green-400">{approvedCount}/{routes.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {routes.map((r) => (
                  <React.Fragment key={r.num}>
                    <button
                      onClick={() => setActiveRouteNum(r.num)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-700/40 hover:bg-gray-700 transition-colors ${r.num === activeRouteNum ? 'bg-gray-700 border-l-2 border-l-blue-400' : ''}`}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.color }} />
                      <span className="text-xs text-gray-300 flex-1 font-mono">{formatRouteCode(currentArea.prefix, r.num)}</span>
                      <span className={`text-[10px] font-bold ${r.status === 'approved' ? 'text-green-400' : r.status === 'flagged' ? 'text-red-400' : r.selectedWayIds.size > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                        {r.status === 'approved' ? '✓' : r.status === 'flagged' ? '!' : r.selectedWayIds.size > 0 ? '●' : '○'}
                      </span>
                    </button>

                    {/* Insert between rows */}
                    <div className="group relative flex items-center justify-center h-0 overflow-visible z-10">
                      <button
                        onClick={() => handleInsertRoute(r.num)}
                        title={`Insert new route after ${formatRouteCode(currentArea.prefix, r.num)}`}
                        className="absolute opacity-0 group-hover:opacity-100 transition-opacity bg-blue-700 hover:bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg border border-blue-500"
                        style={{ top: '-8px' }}
                      >
                        <Plus size={9} />
                      </button>
                    </div>
                  </React.Fragment>
                ))}

                {/* Insert after last route */}
                {routes.length > 0 && (
                  <div className="group relative flex items-center justify-center h-0 overflow-visible z-10">
                    <button
                      onClick={() => handleInsertRoute(routes[routes.length - 1].num)}
                      title={`Add new route after ${formatRouteCode(currentArea.prefix, routes[routes.length - 1].num)}`}
                      className="absolute opacity-0 group-hover:opacity-100 transition-opacity bg-blue-700 hover:bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg border border-blue-500"
                      style={{ top: '-8px' }}
                    >
                      <Plus size={9} />
                    </button>
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-gray-700">
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${routes.length > 0 ? (approvedCount / routes.length) * 100 : 0}%` }} />
                </div>
                <div className="flex justify-between text-[9px]">
                  <span className="text-green-400">{approvedCount} ok</span>
                  <span className="text-red-400">{flaggedCount} !</span>
                  <span className="text-yellow-400">{pendingCount} left</span>
                </div>
              </div>
            </div>
          )}

          {/* CENTER: Map */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <div ref={mapContainerRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }} />

              {/* Box selection overlay */}
              {boxRect && (
                <div style={{ position: 'absolute', left: boxRect.left, top: boxRect.top, width: boxRect.width, height: boxRect.height, border: `2px dashed ${boxRect.mode === 'add' ? '#60a5fa' : '#f87171'}`, background: boxRect.mode === 'add' ? 'rgba(96,165,250,0.08)' : 'rgba(248,113,113,0.08)', pointerEvents: 'none', zIndex: 20 }} />
              )}

              {/* Right-click rename popover */}
              {contextMenu && (
                <div
                  style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50 }}
                  className="bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 w-56"
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Pencil size={12} className="text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 font-medium">Name this road</span>
                    <button onClick={() => setContextMenu(null)} className="ml-auto text-gray-500 hover:text-white"><X size={12} /></button>
                  </div>
                  <input
                    ref={contextMenuInputRef}
                    value={contextMenuInput}
                    onChange={e => setContextMenuInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setContextMenu(null); }}
                    placeholder="e.g. Private Road"
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 mb-2"
                  />
                  <div className="flex gap-1.5">
                    <button onClick={handleRenameConfirm} disabled={!contextMenuInput.trim()} className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs py-1.5 rounded flex items-center justify-center gap-1">
                      <Check size={11} />Apply
                    </button>
                    <button onClick={() => setContextMenu(null)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs py-1.5 rounded">Cancel</button>
                  </div>
                  <div className="text-[9px] text-gray-600 mt-1.5 text-center">Local alias · won't change OpenStreetMap</div>
                </div>
              )}

              {loadingRoads && (
                <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center z-10">
                  <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-sm border border-gray-700">
                    <Loader size={16} className="animate-spin text-blue-400" />Loading roads…
                  </div>
                </div>
              )}

              {hoveredWayName && currentArea && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded px-3 py-1.5 text-sm z-10 pointer-events-none">{hoveredWayName}</div>
              )}

              {currentArea && !loadingRoads && (
                <div className="absolute bottom-3 left-3 bg-gray-900/80 border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-500 z-10 pointer-events-none space-y-0.5">
                  <div><span className="text-blue-400 font-mono">Shift+drag</span> — box add</div>
                  <div><span className="text-red-400 font-mono">Alt+drag</span> — box remove</div>
                  <div><span className="text-gray-400 font-mono">Click</span> — toggle segment</div>
                  <div><span className="text-yellow-400 font-mono">Hold X + click</span> — split segment</div>
                  <div><span className="text-gray-400 font-mono">Right-click</span> — name a road</div>
                  <div><span className="text-gray-400 font-mono">Ctrl+Z</span> — undo split</div>
                  <div className="mt-1 pt-1 border-t border-gray-700/50 text-gray-600">Dashed = unnamed connector</div>
                </div>
              )}
            </div>

            {/* Action bar */}
            {currentArea && (
              <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center gap-3 flex-shrink-0">
                {activeRoute && (
                  <div className="flex items-center gap-2 mr-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: activeRoute.color }} />
                    <span className="text-sm font-medium font-mono">{formatRouteCode(currentArea.prefix, activeRouteNum)}</span>
                  </div>
                )}
                <button onClick={loadRoadsFromViewport} disabled={loadingRoads} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 border border-gray-600 px-3 py-1.5 rounded text-sm flex items-center gap-2">
                  {loadingRoads ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}Load More Roads
                </button>
                <button
                  onClick={() => setShowGhostRoutes(v => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm border transition-colors ${showGhostRoutes ? 'bg-indigo-900/40 border-indigo-500 text-indigo-300' : 'bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600'}`}
                >
                  {showGhostRoutes ? <Eye size={14} /> : <EyeOff size={14} />}
                  {showGhostRoutes ? 'Routes On' : 'Routes Off'}
                </button>
                <button onClick={handleApprove} disabled={!activeRoute || activeRoute.selectedWayIds.size === 0} className="bg-green-800/50 hover:bg-green-700/50 disabled:opacity-50 text-green-400 border border-green-700/50 px-3 py-1.5 rounded text-sm flex items-center gap-2">
                  <Check size={14} />Approve
                </button>
                <button onClick={handleFlag} className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-3 py-1.5 rounded text-sm flex items-center gap-2">
                  <X size={14} />Flag
                </button>
                <div className="ml-auto text-xs text-gray-500">
                  {effectiveWays.length > 0 ? <span className="text-gray-600 mr-2">{effectiveWays.length} roads</span> : <span className="text-red-500 mr-2">no roads loaded</span>}
                  {activeRoute?.selectedWayIds.size || 0} segments · {activeRoute?.streetNames.length || 0} streets
                  {splitUndoStack.length > 0 && <span className="ml-2 text-yellow-600">{splitUndoStack.length} split{splitUndoStack.length !== 1 ? 's' : ''}</span>}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Streets panel */}
          {currentArea && (
            <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
              <div className="px-3 py-2 border-b border-gray-700">
                <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Selected Streets</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {!activeRoute?.streetNames.length ? (
                  <div className="text-xs text-gray-600 italic text-center mt-6 px-2">
                    No streets selected yet.<br /><br />
                    Shift+drag to box-select, click to toggle, right-click any segment to name it.
                  </div>
                ) : (
                  activeRoute.streetNames.map(name => {
                    const segs = effectiveWays.filter(w => w.name === name && activeRoute.selectedWayIds.has(w.id)).length;
                    const total = effectiveWays.filter(w => w.name === name).length;
                    return (
                      <div key={name} className="flex items-center justify-between px-2 py-1.5 bg-gray-900 rounded mb-1 border border-gray-700">
                        <div>
                          <div className="text-xs text-gray-200 font-mono">{name}</div>
                          <div className="text-[9px] text-gray-500">{segs} of {total} segments</div>
                        </div>
                        <button onClick={() => handleRemoveStreet(name)} className="text-red-500 hover:text-red-400 p-0.5 flex-shrink-0"><X size={12} /></button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="p-2 border-t border-gray-700">
                <div className="flex gap-1">
                  <input value={addStreetInput} onChange={e => setAddStreetInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddStreet()} placeholder="Add entire street..." className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500" />
                  <button onClick={handleAddStreet} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-1.5 rounded"><Plus size={12} /></button>
                </div>
                <div className="text-[9px] text-gray-600 mt-1">Adds all segments of that street</div>
              </div>
            </div>
          )}
        </div>
      {/* ── AREA MODAL (add / edit) ── */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <MapIcon size={16} className="text-purple-400" />
                {modal.editing ? 'Edit Area' : 'New Area'}
              </h2>
              <button onClick={() => setModal(EMPTY_MODAL)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Area Name</label>
                <input
                  value={modal.areaName}
                  onChange={e => setModal(m => ({ ...m, areaName: e.target.value }))}
                  placeholder="e.g. BURLINGTON SOUTH 2"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Route Prefix</label>
                <input
                  value={modal.prefix}
                  onChange={e => setModal(m => ({ ...m, prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))}
                  placeholder="e.g. BS"
                  maxLength={6}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono uppercase focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Route Start</label>
                  <input
                    type="number"
                    min={1}
                    value={modal.routeStart}
                    onChange={e => setModal(m => ({ ...m, routeStart: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Route End</label>
                  <input
                    type="number"
                    min={modal.routeStart}
                    value={modal.routeEnd}
                    onChange={e => setModal(m => ({ ...m, routeEnd: Math.max(m.routeStart, parseInt(e.target.value) || m.routeStart) }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              {modal.prefix && modalRouteCount > 0 && (
                <div className="text-[10px] text-gray-400 font-mono bg-gray-800 rounded px-3 py-2 border border-gray-700">
                  {formatRouteCode(modal.prefix, modal.routeStart)} · {formatRouteCode(modal.prefix, modal.routeStart + 1)} · … · {formatRouteCode(modal.prefix, modal.routeEnd)}
                  <span className="text-gray-500 ml-2">({modalRouteCount} routes)</span>
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Region</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['West', 'Central', 'East'] as Region[]).map(r => (
                    <button key={r} onClick={() => setModal(m => ({ ...m, region: r }))} className={`py-2 rounded border text-sm font-medium transition-colors ${modal.region === r ? r === 'West' ? 'bg-blue-900/50 border-blue-500 text-blue-300' : r === 'Central' ? 'bg-green-900/50 border-green-500 text-green-300' : 'bg-orange-900/50 border-orange-500 text-orange-300' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}>{r}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button onClick={() => setModal(EMPTY_MODAL)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
              <button
                onClick={handleSaveArea}
                disabled={savingArea || !modal.areaName.trim() || !modal.prefix.trim() || modalRouteCount === 0}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-5 py-2 rounded font-medium text-sm flex items-center gap-2"
              >
                {savingArea ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                {modal.editing ? 'Save Changes' : 'Create Area'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapBuilder;