// src/pages/SuperAdmin/MapBuilder.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ArrowLeft, Loader, Check, X, AlertCircle,
  Zap, Plus, Map as MapIcon, Upload,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
  name: string;
  geometry: [number, number][];
}

interface Thumbnail {
  pageNum: number;
  dataUrl: string | null;
  loading: boolean;
}

interface BoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mode: 'add' | 'remove';
}

function buildGeoJSON(
  ways: OsmWay[],
  selectedIds: Set<number>,
  color: string,
): GeoJSON.FeatureCollection {
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

async function renderPageToBase64(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  scale: number = 1.5
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

const MapBuilder: React.FC = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const renderedUpTo = useRef<number>(0);

  // PDF State
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [showStrip, setShowStrip] = useState(true);

  // Area / Page State
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [areaInfoMap, setAreaInfoMap] = useState<Map<number, AreaPrefix>>(new Map());
  const [currentArea, setCurrentArea] = useState<AreaPrefix | null>(null);

  // Prefix Modal State
  const [showPrefixModal, setShowPrefixModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedAreaName, setScannedAreaName] = useState('');
  const [scannedRouteCount, setScannedRouteCount] = useState(0);
  const [prefixInput, setPrefixInput] = useState('');
  const [regionInput, setRegionInput] = useState<Region>('West');
  const [pendingPage, setPendingPage] = useState<number | null>(null);

  // Map / Route State
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [activeRouteNum, setActiveRouteNum] = useState(1);
  const [allWays, setAllWays] = useState<OsmWay[]>([]);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addStreetInput, setAddStreetInput] = useState('');
  const [hoveredWayName, setHoveredWayName] = useState<string | null>(null);

  // Box selection state
  const [boxState, setBoxState] = useState<BoxState | null>(null);
  const boxStateRef = useRef<BoxState | null>(null);
  const isDraggingRef = useRef(false);
  const activeRouteNumRef = useRef(activeRouteNum);
  const allWaysRef = useRef<OsmWay[]>([]);

  // Keep refs in sync
  useEffect(() => { activeRouteNumRef.current = activeRouteNum; }, [activeRouteNum]);
  useEffect(() => { allWaysRef.current = allWays; }, [allWays]);
  useEffect(() => { boxStateRef.current = boxState; }, [boxState]);

  const activeRoute = routes.find(r => r.num === activeRouteNum);
  const approvedCount = routes.filter(r => r.status === 'approved').length;
  const flaggedCount = routes.filter(r => r.status === 'flagged').length;
  const pendingCount = routes.filter(r => r.status === 'pending').length;

  // ─── Load on mount ───
  useEffect(() => {
    loadExistingPdf();
    loadAreaPrefixes();
  }, []);

  const loadAreaPrefixes = async () => {
    const { data } = await supabase.from('area_prefixes').select('*');
    if (data) {
      const map = new Map<number, AreaPrefix>();
      data.forEach((a: AreaPrefix) => { if (a.pdf_page) map.set(a.pdf_page, a); });
      setAreaInfoMap(map);
    }
  };

  const loadExistingPdf = async () => {
    try {
      const { data } = await supabase.storage.from('master-maps').list('');
      if (data && data.length > 0) {
        const pdfFile = data.find(f => f.name.endsWith('.pdf'));
        if (pdfFile) {
          const { data: urlData } = supabase.storage.from('master-maps').getPublicUrl(pdfFile.name);
          await loadPdfFromUrl(urlData.publicUrl);
        }
      }
    } catch { /* No PDF yet */ }
  };

  const loadPdfFromUrl = async (url: string) => {
    try {
      const pdf = await pdfjsLib.getDocument({ url, withCredentials: false }).promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      renderedUpTo.current = 0;
      setThumbnails(Array.from({ length: pdf.numPages }, (_, i) => ({
        pageNum: i + 1, dataUrl: null, loading: false,
      })));
    } catch {
      setError('Failed to load PDF. Please try uploading again.');
    }
  };

  // ─── Thumbnails ───
  const renderThumbnailBatch = useCallback(async (
    pdf: pdfjsLib.PDFDocumentProxy, start: number, count: number
  ) => {
    const end = Math.min(start + count - 1, pdf.numPages);
    for (let i = start; i <= end; i++) {
      setThumbnails(prev => prev.map(t => t.pageNum === i ? { ...t, loading: true } : t));
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.18 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        setThumbnails(prev => prev.map(t => t.pageNum === i ? { ...t, dataUrl, loading: false } : t));
      } catch {
        setThumbnails(prev => prev.map(t => t.pageNum === i ? { ...t, loading: false } : t));
      }
    }
    renderedUpTo.current = end;
  }, []);

  useEffect(() => { if (pdfDoc) renderThumbnailBatch(pdfDoc, 1, 12); }, [pdfDoc]);

  const handleThumbnailScroll = () => {
    if (!thumbnailStripRef.current || !pdfDoc) return;
    const strip = thumbnailStripRef.current;
    const pctScrolled = (strip.scrollLeft + strip.clientWidth) / strip.scrollWidth;
    const pagesVisible = Math.ceil(pctScrolled * totalPages);
    if (pagesVisible >= renderedUpTo.current - 3 && renderedUpTo.current < totalPages) {
      renderThumbnailBatch(pdfDoc, renderedUpTo.current + 1, 10);
    }
  };

  // ─── Upload PDF ───
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPdf(true);
    setError(null);
    try {
      const { data: existing } = await supabase.storage.from('master-maps').list('');
      if (existing) {
        const old = existing.filter(f => f.name.endsWith('.pdf'));
        if (old.length > 0) await supabase.storage.from('master-maps').remove(old.map(p => p.name));
      }
      const fileName = `master-maps-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from('master-maps').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('master-maps').getPublicUrl(fileName);
      await loadPdfFromUrl(urlData.publicUrl);
      setShowStrip(true);
    } catch {
      setError('Failed to upload PDF. Please try again.');
    } finally {
      setUploadingPdf(false);
    }
  };

  // ─── Thumbnail click ───
  const handleThumbnailClick = async (pageNum: number) => {
    const existing = areaInfoMap.get(pageNum);
    if (existing) {
      setCurrentArea(existing);
      setSelectedPage(pageNum);
      initRoutesForArea(existing);
    } else {
      setPendingPage(pageNum);
      setShowPrefixModal(true);
      await scanPageWithClaude(pageNum);
    }
  };

  // ─── Scan page ───
  const scanPageWithClaude = async (pageNum: number) => {
    if (!pdfDoc) return;
    setScanning(true);
    try {
      const base64 = await renderPageToBase64(pdfDoc, pageNum, 1.0);
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
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: `This is a page from a master route map book for Hamilton, Ontario.\n\nLook at the bold title at the top (e.g. "Master Map – ALDERSHOT") and the route number table below it.\n\nRespond ONLY with this exact JSON — no other text:\n{\n  "area_name": "ALDERSHOT",\n  "route_count": 21\n}\n\narea_name = the area name from the title in ALL CAPS.\nroute_count = the highest route number shown in the table at the top of the page.` },
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content[0].text;
      let parsed: { area_name: string; route_count: number };
      try { parsed = JSON.parse(text); }
      catch {
        const match = text.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { area_name: `Area ${pageNum}`, route_count: 10 };
      }
      setScannedAreaName(parsed.area_name);
      setScannedRouteCount(parsed.route_count);
    } catch {
      setScannedAreaName(`Area ${pageNum}`);
      setScannedRouteCount(10);
      setError('Could not auto-read area name — you can edit it manually.');
    } finally {
      setScanning(false);
    }
  };

  // ─── Prefix confirm ───
  const handlePrefixConfirm = async () => {
    if (!prefixInput.trim() || !pendingPage) return;
    const areaInfo: AreaPrefix = {
      area_name: scannedAreaName,
      prefix: prefixInput.toUpperCase(),
      region: regionInput,
      pdf_page: pendingPage,
      route_count: scannedRouteCount,
    };
    await supabase.from('area_prefixes').upsert(areaInfo, { onConflict: 'area_name' });
    const newMap = new Map(areaInfoMap);
    newMap.set(pendingPage, areaInfo);
    setAreaInfoMap(newMap);
    setCurrentArea(areaInfo);
    setSelectedPage(pendingPage);
    initRoutesForArea(areaInfo);
    setShowPrefixModal(false);
    setPrefixInput('');
    setPendingPage(null);
    setScannedAreaName('');
    setScannedRouteCount(0);
  };

  const initRoutesForArea = (area: AreaPrefix) => {
    setRoutes(
      Array.from({ length: area.route_count }, (_, i) => ({
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
    setShowStrip(false);
    setTimeout(() => mapRef.current?.resize(), 100);
  };

  // ─── Init Mapbox — always mounted ───
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.320],
      zoom: 13,
    });

    // Disable built-in box zoom so Shift+drag is ours
    map.boxZoom.disable();

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.resize();

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
        map.setFilter('roads-hover', ['==', ['get', 'id'], e.features[0].properties?.id]);
        setHoveredWayName(e.features[0].properties?.name || null);
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
  }, []);

  // Resize when strip toggles
  useEffect(() => { setTimeout(() => mapRef.current?.resize(), 50); }, [showStrip]);

  // ─── Box selection mouse handlers ───
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey && !e.altKey) return;
      if (!currentArea) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const mode = e.shiftKey ? 'add' : 'remove';
      const newBox: BoxState = { startX: x, startY: y, currentX: x, currentY: y, mode };
      boxStateRef.current = newBox;
      setBoxState(newBox);
      mapRef.current?.dragPan.disable();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !boxStateRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const updated = {
        ...boxStateRef.current,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      };
      boxStateRef.current = updated;
      setBoxState({ ...updated });
    };

    const onMouseUp = () => {
      if (!isDraggingRef.current || !boxStateRef.current) return;
      isDraggingRef.current = false;
      mapRef.current?.dragPan.enable();

      const box = boxStateRef.current;
      const minX = Math.min(box.startX, box.currentX);
      const minY = Math.min(box.startY, box.currentY);
      const maxX = Math.max(box.startX, box.currentX);
      const maxY = Math.max(box.startY, box.currentY);

      if (maxX - minX > 5 && maxY - minY > 5) {
        const map = mapRef.current;
        if (map) {
          const features = map.queryRenderedFeatures(
            [{ x: minX, y: minY }, { x: maxX, y: maxY }],
            { layers: ['roads-base', 'roads-selected'] }
          );

          const hitIds = new Set<number>(
            features.map(f => f.properties?.id as number).filter(Boolean)
          );
          const hitNames = new Set<string>(
            features.map(f => f.properties?.name as string).filter(Boolean)
          );

          const routeNum = activeRouteNumRef.current;
          const mode = box.mode;
          const ways = allWaysRef.current;

          setRoutes(prev => prev.map(r => {
            if (r.num !== routeNum) return r;
            const newIds = new Set(r.selectedWayIds);
            let newNames = [...r.streetNames];

            if (mode === 'add') {
              hitIds.forEach(id => newIds.add(id));
              hitNames.forEach(name => { if (!newNames.includes(name)) newNames.push(name); });
            } else {
              hitIds.forEach(id => newIds.delete(id));
              // Clean up names with no remaining segments
              newNames = newNames.filter(name =>
                ways.some(w => w.name === name && newIds.has(w.id))
              );
            }

            return { ...r, selectedWayIds: newIds, streetNames: newNames };
          }));
        }
      }

      boxStateRef.current = null;
      setBoxState(null);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [mapLoaded, currentArea]);

  // ─── Click handler — toggle individual segment ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      // Skip if we just finished a box drag
      if (isDraggingRef.current) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: ['roads-base', 'roads-selected'],
      });
      if (!features.length) return;

      const wayId = features[0].properties?.id as number;
      const wayName = features[0].properties?.name as string;
      const isSelected = features[0].properties?.selected as boolean;

      setRoutes(prev => prev.map(r => {
        if (r.num !== activeRouteNum) return r;
        const newIds = new Set(r.selectedWayIds);
        let newNames = [...r.streetNames];

        if (isSelected) {
          // Remove just this one segment
          newIds.delete(wayId);
          // Remove street name if no segments remain for it
          const stillHasSegments = allWays.some(w => w.name === wayName && newIds.has(w.id));
          if (!stillHasSegments) {
            newNames = newNames.filter(n => n !== wayName);
          }
        } else {
          // Add just this one segment
          newIds.add(wayId);
          if (wayName && !newNames.includes(wayName)) {
            newNames.push(wayName);
          }
        }

        return { ...r, selectedWayIds: newIds, streetNames: newNames };
      }));
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [mapLoaded, activeRouteNum, allWays]);

  // ─── Update map GeoJSON ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || allWays.length === 0) return;
    const route = routes.find(r => r.num === activeRouteNum);
    if (!route) return;
    const geojson = buildGeoJSON(allWays, route.selectedWayIds, route.color);
    (map.getSource('roads') as mapboxgl.GeoJSONSource).setData(geojson);
  }, [routes, activeRouteNum, mapLoaded, allWays]);

  // ─── Load roads ───
  const loadRoads = useCallback(async (area: AreaPrefix) => {
    setLoadingRoads(true);
    setError(null);
    try {
      const searchName = area.area_name.toLowerCase().replace(/#\d+/g, '').trim();
      const nominatimResp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchName + ', Hamilton, Ontario, Canada')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'CPSDMS-MapBuilder/1.0' } }
      );
      const nominatimData = await nominatimResp.json();

      let bbox: string;
      let center: [number, number];

      if (nominatimData.length > 0) {
        const b = nominatimData[0].boundingbox;
        bbox = `${b[0]},${b[2]},${b[1]},${b[3]}`;
        center = [(parseFloat(b[2]) + parseFloat(b[3])) / 2, (parseFloat(b[0]) + parseFloat(b[1])) / 2];
      } else {
        bbox = '43.200,-79.950,43.350,-79.750';
        center = [-79.870, 43.270];
      }

      mapRef.current?.flyTo({ center, zoom: 13 });

      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(`[out:json][timeout:30];way["highway"]["name"](${bbox});out geom;`)}`,
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
      setError('Failed to load roads from OpenStreetMap. Please check your connection.');
    } finally {
      setLoadingRoads(false);
    }
  }, []);

  useEffect(() => { if (mapLoaded && currentArea) loadRoads(currentArea); }, [currentArea, mapLoaded]);

  // ─── AI Extraction ───
  const handleExtract = async () => {
    if (!activeRoute || !pdfDoc || !currentArea || !selectedPage) return;
    setExtracting(true);
    setError(null);
    try {
      const base64 = await renderPageToBase64(pdfDoc, selectedPage, 2.0);
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
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: `This is the master route map for ${currentArea.area_name}.\n\nFind Route ${activeRoute.num} on this map. It is drawn in the color ${activeRoute.color} and the number "${activeRoute.num}" is written on the map in that same color.\n\nList every street name that has a line segment drawn in that color as part of Route ${activeRoute.num}.\n\nRespond ONLY with this exact JSON — no other text:\n{\n  "streets": ["Street Name 1", "Street Name 2", "Street Name 3"],\n  "confidence": 75,\n  "notes": "Brief note about what you found or any uncertainty"\n}` },
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content[0].text;
      let parsed: { streets: string[]; confidence: number; notes: string };
      try { parsed = JSON.parse(text); }
      catch {
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
        if (matching.length > 0 && !matchedNames.includes(streetName)) matchedNames.push(streetName);
      });
      setRoutes(prev => prev.map(r => r.num !== activeRouteNum ? r : {
        ...r, selectedWayIds: matchedIds, streetNames: matchedNames,
        aiNotes: parsed.notes, confidence: parsed.confidence,
      }));
    } catch {
      setError('AI extraction failed. Check your Anthropic API key.');
    } finally {
      setExtracting(false);
    }
  };

  const handleAddStreet = () => {
    const name = addStreetInput.trim();
    if (!name) return;
    const matching = allWays.filter(w => w.name.toLowerCase().includes(name.toLowerCase()));
    if (matching.length === 0) { setError(`No roads found matching "${name}" in this area`); return; }
    setRoutes(prev => prev.map(r => {
      if (r.num !== activeRouteNum) return r;
      const newIds = new Set(r.selectedWayIds);
      matching.forEach(w => newIds.add(w.id));
      const newNames = r.streetNames.includes(matching[0].name)
        ? r.streetNames : [...r.streetNames, matching[0].name];
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
    if (!currentArea) return;
    setSaving(true);
    setError(null);
    try {
      const approved = routes.filter(r => r.status === 'approved' && r.selectedWayIds.size > 0);
      for (const route of approved) {
        const segments = allWays.filter(w => route.selectedWayIds.has(w.id))
          .map(w => ({ osmId: w.id, name: w.name, coordinates: w.geometry }));
        const routeCode = `${currentArea.prefix}${String(route.num).padStart(2, '0')}`;
        await supabase.from('route_maps').upsert({
          area_name: currentArea.area_name,
          route_number: route.num,
          route_code: routeCode,
          route_color: route.color,
          segments,
          status: 'approved',
          ai_confidence: route.confidence,
          ai_notes: route.aiNotes,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'area_name,route_number' });
      }
      alert(`Saved ${approved.length} routes for ${currentArea.area_name}`);
    } catch {
      setError('Failed to save to database');
    } finally {
      setSaving(false);
    }
  };

  // Box rectangle for rendering
  const boxRect = boxState ? {
    left: Math.min(boxState.startX, boxState.currentX),
    top: Math.min(boxState.startY, boxState.currentY),
    width: Math.abs(boxState.currentX - boxState.startX),
    height: Math.abs(boxState.currentY - boxState.startY),
    mode: boxState.mode,
  } : null;

  // ─── RENDER ───
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
            <p className="text-xs text-gray-400">
              {currentArea
                ? `${currentArea.area_name} · ${currentArea.prefix} · ${currentArea.region}`
                : 'Select a page from the strip below'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {currentArea && (
            <button
              onClick={() => setShowStrip(s => !s)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm border transition-colors ${
                showStrip
                  ? 'bg-blue-900/30 border-blue-600 text-blue-300'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <MapIcon size={14} />
              {showStrip ? 'Hide Pages' : 'Switch Area'}
            </button>
          )}
          <label className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm cursor-pointer border transition-colors ${
            pdfDoc
              ? 'bg-green-900/30 border-green-700 text-green-400'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          }`}>
            {uploadingPdf ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
            {pdfDoc ? 'PDF Loaded ✓' : 'Upload PDF'}
            <input type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} disabled={uploadingPdf} />
          </label>
          {currentArea && (
            <button
              onClick={handleSaveAll}
              disabled={saving || approvedCount === 0}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              Save {approvedCount} Approved
            </button>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-red-900/30 border-b border-red-700 px-4 py-2 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Thumbnail Strip */}
      {showStrip && (
        pdfDoc ? (
          <div
            ref={thumbnailStripRef}
            onScroll={handleThumbnailScroll}
            className="flex gap-2 px-3 py-2 bg-gray-950 border-b border-gray-700 overflow-x-auto flex-shrink-0"
            style={{ height: '108px' }}
          >
            {thumbnails.map(thumb => {
              const areaInfo = areaInfoMap.get(thumb.pageNum);
              const isActive = selectedPage === thumb.pageNum;
              return (
                <div
                  key={thumb.pageNum}
                  onClick={() => handleThumbnailClick(thumb.pageNum)}
                  title={areaInfo ? `${areaInfo.area_name} (${areaInfo.prefix})` : `Page ${thumb.pageNum} — click to set up`}
                  className={`flex-shrink-0 cursor-pointer rounded overflow-hidden border-2 transition-all relative ${
                    isActive ? 'border-blue-500 ring-1 ring-blue-400' :
                    areaInfo ? 'border-green-600 hover:border-green-400' :
                    'border-gray-700 hover:border-gray-500'
                  }`}
                  style={{ width: '68px', height: '88px' }}
                >
                  {thumb.loading ? (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                      <Loader size={10} className="animate-spin text-gray-500" />
                    </div>
                  ) : thumb.dataUrl ? (
                    <img src={thumb.dataUrl} alt={`Page ${thumb.pageNum}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-500">
                      {thumb.pageNum}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/75 px-1 py-0.5">
                    <div className="text-[8px] text-gray-300 truncate font-mono">
                      {areaInfo ? areaInfo.prefix : `p${thumb.pageNum}`}
                    </div>
                  </div>
                  {areaInfo && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-shrink-0 bg-gray-950 border-b border-gray-700 px-4 py-5 flex items-center justify-center">
            <div className="text-center">
              <Upload size={28} className="mx-auto text-gray-600 mb-1" />
              <p className="text-xs text-gray-500">Upload your master maps PDF to see all pages here</p>
            </div>
          </div>
        )
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Route list */}
        {currentArea && (
          <div className="w-48 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-3 py-2 border-b border-gray-700 flex justify-between items-center">
              <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Routes</span>
              <span className="text-xs text-green-400">{approvedCount}/{currentArea.route_count}</span>
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
                  <span className="text-xs text-gray-300 flex-1 font-mono">
                    {currentArea.prefix}{String(r.num).padStart(2, '0')}
                  </span>
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
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${(approvedCount / currentArea.route_count) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-green-400">{approvedCount} ok</span>
                <span className="text-red-400">{flaggedCount} !</span>
                <span className="text-yellow-400">{pendingCount} left</span>
              </div>
            </div>
          </div>
        )}

        {/* CENTER: Map — always in DOM */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>

            {/* Map container */}
            <div
              ref={mapContainerRef}
              style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }}
            />

            {/* Box selection rectangle */}
            {boxRect && (
              <div style={{
                position: 'absolute',
                left: boxRect.left,
                top: boxRect.top,
                width: boxRect.width,
                height: boxRect.height,
                border: `2px dashed ${boxRect.mode === 'add' ? '#60a5fa' : '#f87171'}`,
                background: boxRect.mode === 'add' ? 'rgba(96,165,250,0.08)' : 'rgba(248,113,113,0.08)',
                pointerEvents: 'none',
                zIndex: 20,
              }} />
            )}

            {/* No area overlay */}
            {!currentArea && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="text-center bg-gray-900/80 rounded-xl px-8 py-6 border border-gray-700">
                  <MapIcon size={48} className="mx-auto mb-3 text-gray-600 opacity-50" />
                  <p className="text-sm text-gray-500">
                    {pdfDoc ? 'Click a page thumbnail above to start mapping' : 'Upload your master maps PDF to begin'}
                  </p>
                </div>
              </div>
            )}

            {loadingRoads && (
              <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center z-10">
                <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-sm border border-gray-700">
                  <Loader size={16} className="animate-spin text-blue-400" />
                  Loading roads from OpenStreetMap...
                </div>
              </div>
            )}

            {hoveredWayName && currentArea && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded px-3 py-1.5 text-sm z-10 pointer-events-none">
                {hoveredWayName}
              </div>
            )}

            {/* Controls hint */}
            {currentArea && !loadingRoads && (
              <div className="absolute bottom-3 left-3 bg-gray-900/80 border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-500 z-10 pointer-events-none space-y-0.5">
                <div><span className="text-blue-400 font-mono">Shift+drag</span> — box add segments</div>
                <div><span className="text-red-400 font-mono">Alt+drag</span> — box remove segments</div>
                <div><span className="text-gray-400 font-mono">Click</span> — toggle single segment</div>
                <div><span className="text-gray-400 font-mono">Right-drag</span> — rotate map</div>
              </div>
            )}
          </div>

          {/* Action bar */}
          {currentArea && (
            <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center gap-3 flex-shrink-0">
              {activeRoute && (
                <div className="flex items-center gap-2 mr-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: activeRoute.color }} />
                  <span className="text-sm font-medium font-mono">
                    {currentArea.prefix}{String(activeRouteNum).padStart(2, '0')}
                  </span>
                  {activeRoute.confidence > 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      activeRoute.confidence >= 80 ? 'bg-green-900/30 text-green-400' :
                      activeRoute.confidence >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                      'bg-red-900/30 text-red-400'
                    }`}>
                      {activeRoute.confidence}% AI confidence
                    </span>
                  )}
                </div>
              )}
              <button
                onClick={handleExtract}
                disabled={extracting || allWays.length === 0 || !pdfDoc}
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
                {activeRoute?.selectedWayIds.size || 0} segments · {activeRoute?.streetNames.length || 0} streets
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Streets panel */}
        {currentArea && (
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
                  Use Shift+drag to box-select, or click individual segments to toggle them.
                </div>
              ) : (
                activeRoute.streetNames.map(name => {
                  const segCount = allWays.filter(
                    w => w.name === name && activeRoute.selectedWayIds.has(w.id)
                  ).length;
                  const totalSegs = allWays.filter(w => w.name === name).length;
                  return (
                    <div key={name} className="flex items-center justify-between px-2 py-1.5 bg-gray-900 rounded mb-1 border border-gray-700">
                      <div>
                        <div className="text-xs text-gray-200 font-mono">{name}</div>
                        <div className="text-[9px] text-gray-500">
                          {segCount} of {totalSegs} segment{totalSegs !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveStreet(name)}
                        className="text-red-500 hover:text-red-400 p-0.5 flex-shrink-0"
                        title="Remove all segments of this street"
                      >
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
                  placeholder="Add entire street..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
                <button onClick={handleAddStreet} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-1.5 rounded">
                  <Plus size={12} />
                </button>
              </div>
              <div className="text-[9px] text-gray-600 mt-1">Adds all segments of that street</div>
            </div>
          </div>
        )}
      </div>

      {/* PREFIX + REGION MODAL */}
      {showPrefixModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <MapIcon size={16} className="text-purple-400" />
                Set Up Area
              </h2>
              <button onClick={() => { setShowPrefixModal(false); setPendingPage(null); }} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {scanning ? (
                <div className="flex flex-col items-center gap-3 text-sm text-gray-400 py-6">
                  <Loader size={24} className="animate-spin text-purple-400" />
                  <span>Claude is reading this map page...</span>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Area Name</label>
                    <input value={scannedAreaName} onChange={e => setScannedAreaName(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500" />
                    <div className="text-[10px] text-gray-500 mt-1">Auto-detected by AI — edit if incorrect</div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Route Count</label>
                    <input type="number" value={scannedRouteCount} onChange={e => setScannedRouteCount(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500" />
                    <div className="text-[10px] text-gray-500 mt-1">Auto-detected by AI — edit if incorrect</div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Route Prefix</label>
                    <input value={prefixInput}
                      onChange={e => setPrefixInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                      placeholder="e.g. ALD" maxLength={6}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono uppercase focus:outline-none focus:border-purple-500" />
                    {prefixInput && (
                      <div className="text-[10px] text-gray-400 mt-1 font-mono">
                        Routes will be: {prefixInput}01 · {prefixInput}02 · {prefixInput}03...
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Region</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['West', 'Central', 'East'] as Region[]).map(r => (
                        <button key={r} onClick={() => setRegionInput(r)}
                          className={`py-2 rounded border text-sm font-medium transition-colors ${
                            regionInput === r
                              ? r === 'West' ? 'bg-blue-900/50 border-blue-500 text-blue-300'
                              : r === 'Central' ? 'bg-green-900/50 border-green-500 text-green-300'
                              : 'bg-orange-900/50 border-orange-500 text-orange-300'
                              : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                          }`}
                        >{r}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            {!scanning && (
              <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
                <button onClick={() => { setShowPrefixModal(false); setPendingPage(null); }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
                <button onClick={handlePrefixConfirm}
                  disabled={!prefixInput.trim() || !scannedAreaName.trim() || scannedRouteCount === 0}
                  className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-5 py-2 rounded font-medium text-sm flex items-center gap-2">
                  <Check size={14} />
                  Confirm & Start Mapping
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapBuilder;