// src/pages/Admin/DigitalMasterBookings.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft,
  Loader,
  AlertCircle,
  Map as MapIcon,
  MapPin,
  MapPinned,
  CheckCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { googleSheetsService } from '../../lib/googleSheetsService';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── INTERFACES ───────────────────────────────────────────────────────────────

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

interface BookingRecord {
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  serviceType: string;
  price: string;
}

interface GeocodedBooking extends BookingRecord {
  lat: number;
  lng: number;
}

interface Props {
  onBack: () => void;
}

// ─── LOCAL GEOCODE HELPER ─────────────────────────────────────────────────────

async function geocodeAddress(
  houseNum: string,
  streetName: string,
  city: string,
  proximityLat: number,
  proximityLng: number
): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  const parts = [houseNum, streetName, city, 'Ontario', 'Canada'].filter(Boolean);
  const query = encodeURIComponent(parts.join(' '));
  const url = [
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json`,
    `?access_token=${token}`,
    `&limit=1&country=ca&types=address`,
    `&proximity=${proximityLng},${proximityLat}`,
  ].join('');
  try {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].center as [number, number];
      return { lat, lng };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const DigitalMasterBookings: React.FC<Props> = ({ onBack }) => {
  // ── Map refs ────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const loadedIdsRef = useRef<string[]>([]);

  // ── Area / route state ──────────────────────────────────────────────────────
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [currentRoutes, setCurrentRoutes] = useState<SavedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ── Bookings / geocoding state ──────────────────────────────────────────────
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [bookingsData, setBookingsData] = useState<Map<string, BookingRecord[]>>(new Map());
  const [geocodedBookings, setGeocodedBookings] = useState<GeocodedBooking[]>([]);
  const [geocodingProgress, setGeocodingProgress] = useState<{ current: number; total: number } | null>(null);
  const [isPlotted, setIsPlotted] = useState(false);

  // ── Popup / handler refs ────────────────────────────────────────────────────
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const bookingClickHandlerRef = useRef<((e: any) => void) | null>(null);

  // ─── SUPPRESS DUPLICATE LABELS ─────────────────────────────────────────────
  // Unchanged from original — prevents double street name labels.
  const suppressDuplicateLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = map.getStyle();
    if (!style?.layers) return;

    const HIDE_LIST = ['poi-label', 'housenum-label', 'road-number-shield'];

    const originalIds = style.layers
      .filter((l: any) =>
        l.type === 'symbol' &&
        l.id.toLowerCase().includes('label') &&
        !l.id.includes('-point-backup') &&
        !HIDE_LIST.includes(l.id)
      )
      .map((l: any) => l.id);

    if (originalIds.length === 0) return;

    const lineFeatures = map.queryRenderedFeatures(undefined, { layers: originalIds });
    const renderedNames = [...new Set(
      lineFeatures.map((f: any) => f.properties?.name).filter(Boolean)
    )];

    style.layers
      .filter((l: any) => l.id.includes('-point-backup'))
      .forEach((l: any) => {
        if (!map.getLayer(l.id)) return;
        try {
          if (renderedNames.length > 0) {
            map.setFilter(l.id, ['!', ['in', ['get', 'name'], ['literal', renderedNames]]]);
          } else {
            map.setFilter(l.id, null);
          }
        } catch { /* skip */ }
      });
  }, []);

  // ─── CLEAR BOOKING LAYERS ──────────────────────────────────────────────────
  const clearBookingLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove the click handler we stored
    if (bookingClickHandlerRef.current) {
      map.off('click', 'dmb-bookings-circles', bookingClickHandlerRef.current);
      bookingClickHandlerRef.current = null;
    }
    // Remove any open popup
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    // Remove layer then source (order matters in Mapbox)
    if (map.getLayer('dmb-bookings-circles')) map.removeLayer('dmb-bookings-circles');
    if (map.getSource('dmb-bookings-src')) map.removeSource('dmb-bookings-src');
  }, []);

  // ─── CLEAR ALL ROUTE LAYERS ────────────────────────────────────────────────
  // Unchanged from original.
  const clearAllRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    loadedIdsRef.current.forEach(id => {
      if (id.startsWith('num-')) {
        const routeId = id.replace('num-', '');
        const numLabelId = `dmb-num-${routeId}`;
        const numSrcId = `dmb-num-src-${routeId}`;
        if (map.getLayer(numLabelId)) map.removeLayer(numLabelId);
        if (map.getSource(numSrcId)) map.removeSource(numSrcId);
      } else {
        const lineId = `dmb-line-${id}`;
        const srcId = `dmb-src-${id}`;
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    });
    loadedIdsRef.current = [];
  }, []);

  // ─── SELECT AREA ───────────────────────────────────────────────────────────
  // Extended to clear booking dots whenever a new area is chosen.
  const handleSelectArea = useCallback(async (areaName: string) => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Clear everything before loading new area
    clearAllRoutes();
    clearBookingLayers();
    setGeocodedBookings([]);
    setIsPlotted(false);
    setGeocodingProgress(null);

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

      // Insert routes just below road labels so text stays on top
      const routeInsertBefore = (
        map.getLayer('road-label') ? 'road-label' :
        map.getStyle().layers?.find((l: any) => l.type === 'symbol')?.id
      ) ?? undefined;

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

        features.forEach(f => {
          const coords = (f.geometry as GeoJSON.LineString).coordinates as [number, number][];
          allCoords.push(...coords);
        });

        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });

        map.addLayer({
          id: lineId,
          type: 'line',
          source: srcId,
          minzoom: 0,
          maxzoom: 24,
          paint: {
            'line-color': route.route_color,
            'line-width': 7,
            'line-opacity': 0.75,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        }, routeInsertBefore);

        // Floating route number label at segment centroid
        const allRoutCoords: [number, number][] = [];
        route.segments.forEach((seg: any) => {
          seg.coordinates.forEach((c: [number, number]) => allRoutCoords.push(c));
        });
        const centroidLng = allRoutCoords.reduce((s, c) => s + c[0], 0) / allRoutCoords.length;
        const centroidLat = allRoutCoords.reduce((s, c) => s + c[1], 0) / allRoutCoords.length;

        const numSrcId = `dmb-num-src-${route.id}`;
        const numLabelId = `dmb-num-${route.id}`;
        loadedIdsRef.current.push(`num-${route.id}`);

        map.addSource(numSrcId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { num: String(route.route_number), color: route.route_color },
              geometry: { type: 'Point', coordinates: [centroidLng, centroidLat] },
            }],
          },
        });

        map.addLayer({
          id: numLabelId,
          type: 'symbol',
          source: numSrcId,
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
  }, [mapLoaded, clearAllRoutes, clearBookingLayers]);

  // ─── GOOGLE CONNECT + LOAD BOOKINGS ────────────────────────────────────────
  // Authenticates once, then reads the entire Bookings tab and builds a
  // Map<routeCode → BookingRecord[]> for instant lookups.
  const handleConnectGoogle = useCallback(async () => {
    setSheetsLoading(true);
    setError(null);
    try {
      const connected = await googleSheetsService.authenticate();
      if (!connected) {
        setError('Failed to connect to Google. Please try again.');
        return;
      }

      // Columns A–P: A=BookedBy B=Date C=Time D=Route# E=First F=Last
      //              G=House# H=Street I=Call1st J=Phone K=Email
      //              L=ServiceType M=PP N=Price O=City P=Notes
      const rows = await googleSheetsService.readMasterbookingsRange("'Bookings'!A:P");

      const map = new Map<string, BookingRecord[]>();
      // Row 0 = formula banner, Row 1 = header, Row 2+ = data
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        const routeCode = row[3]?.toString().trim();
        if (!routeCode) continue;

        const booking: BookingRecord = {
          routeCode,
          firstName:   row[4]?.toString().trim()  || '',
          lastName:    row[5]?.toString().trim()  || '',
          houseNum:    row[6]?.toString().trim()  || '',
          streetName:  row[7]?.toString().trim()  || '',
          city:        row[14]?.toString().trim() || '',
          serviceType: row[11]?.toString().trim() || '',
          price:       row[13]?.toString().trim() || '',
        };

        if (!map.has(routeCode)) map.set(routeCode, []);
        map.get(routeCode)!.push(booking);
      }

      setBookingsData(map);
      setIsGoogleConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings from Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  }, []);

  // ─── PLOT BOOKINGS ─────────────────────────────────────────────────────────
  // Geocodes every booking in the selected area's routes using Mapbox,
  // then draws yellow circle markers on the map with click popups.
  const handlePlotBookings = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !selectedArea || loadingRoutes) return;

    // Reset any previous plot
    clearBookingLayers();
    setGeocodedBookings([]);
    setIsPlotted(false);

    // Collect bookings only for routes that are actually drawn on the map
    const areaRouteCodes = new Set(currentRoutes.map(r => r.route_code));
    const areaBookings: BookingRecord[] = [];
    bookingsData.forEach((bookings, routeCode) => {
      if (areaRouteCodes.has(routeCode)) areaBookings.push(...bookings);
    });

    if (areaBookings.length === 0) {
      setError(`No bookings found for routes in "${selectedArea}".`);
      return;
    }

    // Compute geographic centre of all route segments for Mapbox proximity bias
    const allCoords: [number, number][] = [];
    currentRoutes.forEach(r =>
      r.segments?.forEach(s => s.coordinates.forEach(c => allCoords.push(c)))
    );
    const centerLng = allCoords.length > 0
      ? allCoords.reduce((s, c) => s + c[0], 0) / allCoords.length
      : -79.87;
    const centerLat = allCoords.length > 0
      ? allCoords.reduce((s, c) => s + c[1], 0) / allCoords.length
      : 43.32;

    setGeocodingProgress({ current: 0, total: areaBookings.length });

    const results: GeocodedBooking[] = [];
    for (let i = 0; i < areaBookings.length; i++) {
      const b = areaBookings[i];
      if (b.houseNum && b.streetName) {
        const coord = await geocodeAddress(b.houseNum, b.streetName, b.city, centerLat, centerLng);
        if (coord) results.push({ ...b, lat: coord.lat, lng: coord.lng });
      }
      setGeocodingProgress({ current: i + 1, total: areaBookings.length });
      // Small delay to respect Mapbox rate limits
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    setGeocodedBookings(results);
    setGeocodingProgress(null);
    setIsPlotted(true);

    if (results.length === 0) {
      setError('None of the bookings could be geocoded. Check address data.');
      return;
    }

    // ── Draw yellow circle layer ──────────────────────────────────────────────
    map.addSource('dmb-bookings-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: results.map(b => ({
          type: 'Feature' as const,
          properties: {
            name:        `${b.firstName} ${b.lastName}`,
            address:     `${b.houseNum} ${b.streetName}`,
            city:        b.city,
            serviceType: b.serviceType,
            price:       b.price,
            routeCode:   b.routeCode,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [b.lng, b.lat],
          },
        })),
      },
    });

    map.addLayer({
      id: 'dmb-bookings-circles',
      type: 'circle',
      source: 'dmb-bookings-src',
      paint: {
        'circle-color':        '#FFD700',
        'circle-radius':       7,
        'circle-stroke-color': '#333333',
        'circle-stroke-width': 1.5,
        'circle-opacity':      0.92,
      },
    });

    // Pointer cursor on hover
    map.on('mouseenter', 'dmb-bookings-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'dmb-bookings-circles', () => {
      map.getCanvas().style.cursor = '';
    });

    // Click → popup with booking details
    const clickHandler = (e: any) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const { name, address, city, serviceType, price, routeCode } = feature.properties;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      if (popupRef.current) popupRef.current.remove();

      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(`
          <div style="font-family:system-ui,sans-serif;font-size:13px;min-width:170px;line-height:1.4;">
            <div style="font-weight:700;margin-bottom:4px;">${name}</div>
            <div style="color:#555;">${address}</div>
            <div style="color:#777;font-size:11px;">${city}</div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span style="background:#e0e7ff;color:#3730a3;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">${routeCode}</span>
              ${serviceType ? `<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:2px 7px;font-size:11px;">${serviceType}</span>` : ''}
            </div>
            ${price ? `<div style="margin-top:6px;color:#166534;font-weight:700;font-size:13px;">$${price}</div>` : ''}
          </div>
        `)
        .addTo(map);
    };

    bookingClickHandlerRef.current = clickHandler;
    map.on('click', 'dmb-bookings-circles', clickHandler);

  }, [selectedArea, currentRoutes, bookingsData, clearBookingLayers, loadingRoutes]);

  // ─── BOOKING COUNT HELPERS ─────────────────────────────────────────────────

  /** Total bookings for an area prefix (all routes starting with that prefix) */
  const getAreaBookingCount = useCallback((prefix: string): number => {
    if (!isGoogleConnected) return 0;
    let total = 0;
    bookingsData.forEach((bookings, routeCode) => {
      if (routeCode.toUpperCase().startsWith(prefix.toUpperCase())) total += bookings.length;
    });
    return total;
  }, [isGoogleConnected, bookingsData]);

  /** Total bookings loaded across ALL routes */
  const totalBookingsLoaded = Array.from(bookingsData.values()).reduce((s, b) => s + b.length, 0);

  // ─── LOAD AREAS ────────────────────────────────────────────────────────────
  // Unchanged from original.
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

  // ─── MAP INIT ──────────────────────────────────────────────────────────────
  // Completely unchanged from original — every line is identical.
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

      const exactHide = ['poi-label', 'housenum-label', 'road-number-shield'];
      exactHide.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      });

      map.getStyle().layers?.forEach((layer: any) => {
        const id = layer.id.toLowerCase();

        if (layer.type === 'fill' || layer.type === 'fill-extrusion') {
          if (id.includes('building') || id.includes('structure')) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
        }

        if (layer.type !== 'symbol') return;

        const idIsHouseNum =
          id.includes('housenum') ||
          id.includes('house-num') ||
          id.includes('house_num') ||
          id.includes('address') ||
          id.includes('housenumber');

        const textField = JSON.stringify(layer.layout?.['text-field'] ?? '');
        const fieldIsHouseNum =
          textField.includes('housenumber') ||
          textField.includes('house_num') ||
          textField.includes('addr') ||
          textField.includes('ref');

        const isNotRoadLabel =
          !id.includes('label') &&
          !id.includes('shield') &&
          !id.includes('motorway') &&
          !id.includes('road') &&
          !id.includes('street');

        if (idIsHouseNum || fieldIsHouseNum || isNotRoadLabel) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });

      const roadLabelLayers = map.getStyle().layers?.filter((layer: any) =>
        layer.type === 'symbol' &&
        layer.id.toLowerCase().includes('label') &&
        !exactHide.includes(layer.id)
      ) ?? [];

      roadLabelLayers.forEach((layer: any) => {
        try {
          map.setLayerZoomRange(layer.id, 0, 24);
          map.setLayoutProperty(layer.id, 'text-allow-overlap', false);
          map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
          map.setLayoutProperty(layer.id, 'text-size', 13);
          map.setLayoutProperty(layer.id, 'text-font', ['DIN Pro Bold', 'Arial Unicode MS Bold']);
          map.setPaintProperty(layer.id, 'text-color', '#111111');
          map.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
          map.setPaintProperty(layer.id, 'text-halo-width', 2);
        } catch { /* skip */ }

        const backupId = `${layer.id}-point-backup`;
        if (map.getLayer(backupId)) return;
        try {
          map.addLayer({
            id: backupId,
            type: 'symbol',
            source: (layer as any).source ?? 'composite',
            'source-layer': (layer as any)['source-layer'] ?? 'road',
            filter: (layer as any).filter,
            minzoom: 0,
            maxzoom: 24,
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
        } catch { /* skip */ }
      });

      map.on('idle', suppressDuplicateLabels);
      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
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

        {/* Geocoding progress indicator */}
        {geocodingProgress && (
          <div className="flex items-center gap-2 text-yellow-400 text-xs font-medium">
            <Loader size={14} className="animate-spin" />
            Geocoding {geocodingProgress.current}/{geocodingProgress.total}…
          </div>
        )}

        {/* Plot Bookings button — visible once an area is selected */}
        {selectedArea && !geocodingProgress && (
          <button
            onClick={handlePlotBookings}
            disabled={!isGoogleConnected || loadingRoutes}
            title={!isGoogleConnected ? 'Connect to Google first using the sidebar button' : ''}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              !isGoogleConnected || loadingRoutes
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : isPlotted
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                  : 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
            }`}
          >
            <MapPinned size={14} />
            {isPlotted
              ? `Re-plot (${geocodedBookings.length} pinned)`
              : 'Plot Bookings'}
          </button>
        )}

        {/* Route loading spinner */}
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

      {/* ── Error / warning bar ─────────────────────────────────────────────── */}
      {error && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2 text-sm text-yellow-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-yellow-400 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL ──────────────────────────────────────────────────────── */}
        <div className="w-64 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden flex-shrink-0">

          {/* Google Connect button */}
          <div className="px-3 py-2 border-b border-gray-700">
            {!isGoogleConnected ? (
              <button
                onClick={handleConnectGoogle}
                disabled={sheetsLoading}
                className="w-full flex items-center justify-center gap-2 py-2 bg-white hover:bg-gray-100 text-gray-800 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                {sheetsLoading ? (
                  <Loader size={14} className="animate-spin text-gray-600" />
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" className="flex-shrink-0">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Connect for Bookings
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-green-400 text-xs py-1 px-1">
                <CheckCircle size={13} className="flex-shrink-0" />
                <span className="font-medium">
                  {totalBookingsLoaded > 0
                    ? `${totalBookingsLoaded} bookings loaded`
                    : 'Connected'}
                </span>
              </div>
            )}
          </div>

          {/* Areas label row */}
          <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Areas</span>
            {!loadingAreas && (
              <span className="text-xs text-gray-600">{areas.length}</span>
            )}
          </div>

          {/* Area list with accordion */}
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
                const bookingCount = getAreaBookingCount(area.prefix);

                return (
                  <div key={area.area_name}>

                    {/* Area card button */}
                    <button
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
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Yellow booking count badge — only when connected */}
                          {isGoogleConnected && bookingCount > 0 && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 px-1.5 py-0.5 rounded font-bold leading-none">
                              {bookingCount}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-500">
                            {area.route_count}r
                          </span>
                        </div>
                      </div>
                      <div className={`text-[11px] mt-0.5 leading-tight ${isSelected ? 'text-blue-300' : 'text-gray-400'}`}>
                        {area.area_name}
                      </div>
                    </button>

                    {/* Accordion: route breakdown for selected area */}
                    {isSelected && (
                      <div className="mt-1 ml-2 mb-1 border-l-2 border-blue-700/40 pl-2 space-y-0.5">
                        {loadingRoutes ? (
                          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 px-2 py-1.5">
                            <Loader size={10} className="animate-spin" />
                            Loading routes…
                          </div>
                        ) : currentRoutes.length === 0 ? (
                          <div className="text-[10px] text-gray-600 px-2 py-1 italic">
                            No approved routes
                          </div>
                        ) : (
                          [...currentRoutes]
                            .sort((a, b) => a.route_number - b.route_number)
                            .map(route => {
                              const count = bookingsData.get(route.route_code)?.length ?? 0;
                              return (
                                <div
                                  key={route.id}
                                  className="flex items-center justify-between px-2 py-1 rounded bg-gray-800/60"
                                >
                                  <div className="flex items-center gap-1.5">
                                    {/* Route colour dot */}
                                    <span
                                      className="w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: route.route_color }}
                                    />
                                    <span className="text-[11px] text-gray-300 font-mono">
                                      {route.route_code}
                                    </span>
                                  </div>
                                  {isGoogleConnected && (
                                    <span className={`text-[11px] font-bold ${
                                      count > 0 ? 'text-yellow-400' : 'text-gray-600'
                                    }`}>
                                      {count}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                        )}
                      </div>
                    )}

                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── MAP ──────────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />

          {/* Map loading overlay */}
          {!mapLoaded && (
            <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
              <Loader size={24} className="animate-spin text-blue-500" />
            </div>
          )}

          {/* Empty state — no area selected yet */}
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