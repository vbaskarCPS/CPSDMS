// src/pages/Management/components/RMMapTab.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader, Navigation } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { RouteData, MasterBooking, LogsheetSession, Worker } from '../../../types';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── INTERFACES ───────────────────────────────────────────────────────────────

interface SavedRoute {
  id: string;
  area_name: string;
  route_number: number;
  route_code: string;
  route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}

interface PinData {
  id: string;
  address: string;
  routeCode: string;
  name: string;
  status: 'pending' | 'completed' | 'new_sale';
}

interface GeocodedPin extends PinData {
  lat: number;
  lng: number;
  routeColor: string;
}

interface RMMapTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  allSessions: LogsheetSession[];
  workers: Worker[];
}

// ─── MODULE-LEVEL CACHES (survive tab switches, cleared on page reload) ──────

/** Primary cache: address string → coordinates */
const geocodeCache = new Map<string, { lat: number; lng: number }>();

/** Secondary cache: job/booking ID → coordinates (handles status transitions) */
const jobIdCache = new Map<string, { lat: number; lng: number }>();

function makeCacheKey(address: string): string {
  return address.trim().toLowerCase();
}

// ─── GEOCODING HELPER ─────────────────────────────────────────────────────────

async function geocodeAddress(
  fullAddress: string,
  proximityLat?: number,
  proximityLng?: number
): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  const parts = [fullAddress, 'Ontario', 'Canada'].filter(Boolean);
  const query = encodeURIComponent(parts.join(', '));
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1&country=ca&types=address`;

  if (proximityLat !== undefined && proximityLng !== undefined) {
    url += `&proximity=${proximityLng},${proximityLat}`;
  }

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

// ─── NAVIGATION ARROW ─────────────────────────────────────────────────────────

function createNavigationArrowElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L20 20 L12 15 L4 20 Z" fill="#4285F4" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
  `;
  el.style.cssText = 'transition: transform 0.3s ease;';
  return el;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const RMMapTab: React.FC<RMMapTabProps> = ({
  managerId,
  routes,
  bookings,
  allSessions,
  workers,
}) => {
  // --- Map refs ---
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const loadedIdsRef = useRef<string[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const pinClickHandlerRef = useRef<((e: any) => void) | null>(null);

  // --- Route data from route_maps table ---
  const [routeMapData, setRouteMapData] = useState<SavedRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const prevRouteCodesKeyRef = useRef<string>('');
  const routeDataLoadedRef = useRef(false);
  const initialFitDoneRef = useRef(false);

  // --- Geocoding state ---
  const [geocodedPins, setGeocodedPins] = useState<GeocodedPin[]>([]);
  const [geocodingProgress, setGeocodingProgress] = useState<{ current: number; total: number } | null>(null);
  const geocodeBatchRef = useRef(0);
  const mountedRef = useRef(true);

  // --- Location mode ---
  const [locationMode, setLocationMode] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const lastHeadingRef = useRef<number>(0);

  // ─── COMPUTED: My route codes ──────────────────────────────────────────────

  const myRouteCodes = useMemo(() => {
    return routes
      .filter(r => r.managerId === managerId)
      .map(r => r.routeCode);
  }, [routes, managerId]);

  // ─── COMPUTED: My team worker IDs ──────────────────────────────────────────

  const myTeamIds = useMemo(() => {
    return new Set(
      workers
        .filter(w => w.assignedManagerId === managerId)
        .map(w => w.contractorId)
    );
  }, [workers, managerId]);

  // ─── COMPUTED: Route color map ─────────────────────────────────────────────

  const routeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    routeMapData.forEach(r => map.set(r.route_code, r.route_color));
    return map;
  }, [routeMapData]);

  // ─── COMPUTED: Pin list from bookings + sessions ───────────────────────────

  const pins = useMemo<PinData[]>(() => {
    const result: PinData[] = [];
    const completedJobIds = new Set<string>();
    const myRouteSet = new Set(myRouteCodes);

    // 1. Completed transactions from my team's sessions
    allSessions.forEach(session => {
      const sessionWorkerIds = session.teamWorkerIds || [session.workerId];
      const isMyTeam = sessionWorkerIds.some(wid => myTeamIds.has(wid));
      if (!isMyTeam) return;

      (session.financialStore || []).forEach((tx: any) => {
        // Skip upsells and add-ons — only aeration production/sales
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (!tx.address) return;

        completedJobIds.add(tx.jobId);

        const isNewSale = tx.jobId?.startsWith('NEW-');

        result.push({
          id: tx.jobId || tx.id,
          address: tx.address,
          routeCode: tx.routeCode || '',
          name: tx.customerName || 'Unknown',
          status: isNewSale ? 'new_sale' : 'completed',
        });
      });
    });

    // 2. Pending bookings on my routes (not already completed)
    bookings.forEach(b => {
      const routeNum = b['Route Number'];
      if (!routeNum || !myRouteSet.has(routeNum)) return;
      if (completedJobIds.has(b['Booking ID'])) return;

      const address = b['Full Address'];
      if (!address) return;

      result.push({
        id: b['Booking ID'],
        address,
        routeCode: routeNum,
        name: `${b['First Name'] || ''} ${b['Last Name'] || ''}`.trim() || 'Unknown',
        status: 'pending',
      });
    });

    return result;
  }, [bookings, allSessions, myRouteCodes, myTeamIds]);

  // ─── COMPUTED: Route centroid for geocoding proximity bias ─────────────────

  const routeCentroid = useMemo<{ lat: number; lng: number } | null>(() => {
    if (routeMapData.length === 0) return null;
    let sumLat = 0, sumLng = 0, count = 0;
    routeMapData.forEach(route => {
      route.segments?.forEach(seg => {
        if (!seg.coordinates || seg.coordinates.length === 0) return;
        const midIdx = Math.floor(seg.coordinates.length / 2);
        const [lng, lat] = seg.coordinates[midIdx];
        sumLat += lat;
        sumLng += lng;
        count++;
      });
    });
    if (count === 0) return null;
    return { lat: sumLat / count, lng: sumLng / count };
  }, [routeMapData]);

  // ─── SUPPRESS DUPLICATE LABELS (identical to DMB) ─────────────────────────

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

  // ─── LOAD ROUTE GEOMETRY FROM route_maps ──────────────────────────────────
  // FIX #3: Only re-fetch if actual route codes changed (not just array reference)

  useEffect(() => {
    if (myRouteCodes.length === 0) {
      setRouteMapData([]);
      setRoutesLoading(false);
      routeDataLoadedRef.current = false;
      prevRouteCodesKeyRef.current = '';
      return;
    }

    // Compare sorted route codes to detect actual changes
    const codesKey = [...myRouteCodes].sort().join(',');
    if (codesKey === prevRouteCodesKeyRef.current && routeDataLoadedRef.current) {
      // Route codes unchanged and data already loaded — skip fetch
      return;
    }
    prevRouteCodesKeyRef.current = codesKey;

    let cancelled = false;

    const load = async () => {
      setRoutesLoading(true);
      try {
        const { data, error } = await supabase
          .from('route_maps')
          .select('*')
          .in('route_code', myRouteCodes)
          .eq('status', 'approved');

        if (cancelled) return;
        if (error) {
          console.error('Failed to load route maps:', error);
          return;
        }
        setRouteMapData((data || []) as SavedRoute[]);
        routeDataLoadedRef.current = true;
      } catch (err) {
        if (!cancelled) console.error('Route map load error:', err);
      } finally {
        if (!cancelled) setRoutesLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [myRouteCodes]);

  // ─── DRAW ROUTES ON MAP ───────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || routeMapData.length === 0) return;

    // Clear existing route layers
    loadedIdsRef.current.forEach(id => {
      if (id.startsWith('num-')) {
        const routeId = id.replace('num-', '');
        if (map.getLayer(`rm-num-${routeId}`)) map.removeLayer(`rm-num-${routeId}`);
        if (map.getSource(`rm-num-src-${routeId}`)) map.removeSource(`rm-num-src-${routeId}`);
      } else {
        if (map.getLayer(`rm-line-${id}`)) map.removeLayer(`rm-line-${id}`);
        if (map.getSource(`rm-src-${id}`)) map.removeSource(`rm-src-${id}`);
      }
    });
    loadedIdsRef.current = [];

    const routeInsertBefore = (
      map.getLayer('road-label') ? 'road-label' :
      map.getStyle().layers?.find((l: any) => l.type === 'symbol')?.id
    ) ?? undefined;

    const allCoords: [number, number][] = [];

    routeMapData.forEach(route => {
      if (!route.segments || route.segments.length === 0) return;

      const srcId = `rm-src-${route.id}`;
      const lineId = `rm-line-${route.id}`;
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

      // Route number label at centroid
      const allRouteCoords: [number, number][] = [];
      route.segments.forEach(seg => seg.coordinates.forEach(c => allRouteCoords.push(c)));
      if (allRouteCoords.length === 0) return;

      const centroidLng = allRouteCoords.reduce((s, c) => s + c[0], 0) / allRouteCoords.length;
      const centroidLat = allRouteCoords.reduce((s, c) => s + c[1], 0) / allRouteCoords.length;

      const numSrcId = `rm-num-src-${route.id}`;
      const numLabelId = `rm-num-${route.id}`;
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

    // FIX #2: Delayed fitBounds so the map is ready, and only on first load
    if (allCoords.length > 0 && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
      setTimeout(() => {
        if (!mapRef.current) return;
        const bounds = allCoords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
        );
        mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 });
      }, 300);
    }
  }, [routeMapData, mapLoaded]);

  // ─── UPDATE MAP PIN LAYER ─────────────────────────────────────────────────

  const updateMapPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    // Remove old click handler
    if (pinClickHandlerRef.current) {
      map.off('click', 'rm-pins-circles', pinClickHandlerRef.current);
      pinClickHandlerRef.current = null;
    }
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => ({
        type: 'Feature' as const,
        properties: {
          name: pin.name,
          address: pin.address,
          routeCode: pin.routeCode,
          routeColor: pin.routeColor,
          status: pin.status,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [pin.lng, pin.lat],
        },
      })),
    };

    // Update or create source + layer
    const source = map.getSource('rm-pins-src') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojsonData);
    } else {
      map.addSource('rm-pins-src', { type: 'geojson', data: geojsonData });

      map.addLayer({
        id: 'rm-pins-circles',
        type: 'circle',
        source: 'rm-pins-src',
        paint: {
          'circle-color': ['get', 'routeColor'],
          'circle-radius': 5,
          'circle-stroke-color': [
            'match', ['get', 'status'],
            'completed', '#22c55e',
            'new_sale', '#eab308',
            '#000000',
          ],
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.95,
        },
      });

      map.on('mouseenter', 'rm-pins-circles', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'rm-pins-circles', () => {
        map.getCanvas().style.cursor = '';
      });
    }

    // Click handler for popups
    const clickHandler = (e: any) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const { name, address, routeCode, routeColor, status } = feature.properties;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      if (popupRef.current) popupRef.current.remove();

      const statusLabel = status === 'completed' ? '✅ Completed' : status === 'new_sale' ? '🆕 New Sale' : '⏳ Pending';
      const statusColor = status === 'completed' ? '#22c55e' : status === 'new_sale' ? '#eab308' : '#9ca3af';

      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(`
          <div style="font-family:system-ui,sans-serif;font-size:13px;min-width:170px;line-height:1.4;">
            <div style="font-weight:700;margin-bottom:4px;">${name}</div>
            <div style="color:#555;">${address}</div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${routeCode}</span>
              <span style="color:${statusColor};font-size:11px;font-weight:600;">${statusLabel}</span>
            </div>
          </div>
        `)
        .addTo(map);
    };

    pinClickHandlerRef.current = clickHandler;
    map.on('click', 'rm-pins-circles', clickHandler);
  }, []);

  // ─── GEOCODE AND RENDER PINS ──────────────────────────────────────────────
  // FIX #1: Uses both address cache AND job ID cache for status transitions

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || routeMapData.length === 0) return;

    const currentBatch = ++geocodeBatchRef.current;

    const run = async () => {
      const toGeocode: PinData[] = [];
      const alreadyCached: GeocodedPin[] = [];

      pins.forEach(pin => {
        // Check address cache first, then job ID cache (handles status transitions
        // where the address string might differ slightly between booking and transaction)
        const addrCached = geocodeCache.get(makeCacheKey(pin.address));
        const idCached = jobIdCache.get(pin.id);
        const cached = addrCached || idCached;

        if (cached) {
          // Backfill both caches for future lookups
          if (!addrCached) geocodeCache.set(makeCacheKey(pin.address), cached);
          if (!idCached) jobIdCache.set(pin.id, cached);

          alreadyCached.push({
            ...pin,
            lat: cached.lat,
            lng: cached.lng,
            routeColor: routeColorMap.get(pin.routeCode) || '#888888',
          });
        } else {
          toGeocode.push(pin);
        }
      });

      // Render cached pins immediately (includes status changes from realtime)
      updateMapPins(map, alreadyCached);
      setGeocodedPins(alreadyCached);

      if (toGeocode.length === 0) {
        setGeocodingProgress(null);
        return;
      }

      setGeocodingProgress({ current: 0, total: toGeocode.length });

      const newlyGeocoded: GeocodedPin[] = [];

      for (let i = 0; i < toGeocode.length; i++) {
        if (geocodeBatchRef.current !== currentBatch || !mountedRef.current) return;

        const pin = toGeocode[i];
        const coord = await geocodeAddress(
          pin.address,
          routeCentroid?.lat,
          routeCentroid?.lng
        );

        if (coord) {
          // Store in BOTH caches
          geocodeCache.set(makeCacheKey(pin.address), coord);
          jobIdCache.set(pin.id, coord);

          newlyGeocoded.push({
            ...pin,
            lat: coord.lat,
            lng: coord.lng,
            routeColor: routeColorMap.get(pin.routeCode) || '#888888',
          });
        }

        if (geocodeBatchRef.current !== currentBatch || !mountedRef.current) return;
        setGeocodingProgress({ current: i + 1, total: toGeocode.length });

        // Throttle requests
        if (i < toGeocode.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 80));
        }
      }

      if (geocodeBatchRef.current !== currentBatch || !mountedRef.current) return;

      const allPins = [...alreadyCached, ...newlyGeocoded];
      setGeocodedPins(allPins);
      updateMapPins(map, allPins);
      setGeocodingProgress(null);
    };

    run();
  }, [pins, routeMapData, mapLoaded, routeColorMap, routeCentroid, updateMapPins]);

  // ─── LOCATION MODE ────────────────────────────────────────────────────────
  // FIX #4: No forced zoom, getCurrentPosition for fast first fix, robust heading

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (locationMode) {
      if (!navigator.geolocation) {
        console.error('Geolocation not supported by this browser');
        setLocationMode(false);
        return;
      }

      // Create navigation arrow
      if (!navArrowElRef.current) {
        navArrowElRef.current = createNavigationArrowElement();
      }

      navMarkerRef.current = new mapboxgl.Marker({
        element: navArrowElRef.current,
        pitchAlignment: 'map',
        rotationAlignment: 'map',
      })
        .setLngLat([0, 0])
        .addTo(map);

      // Get an immediate first position so the map responds right away
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mapRef.current || !navMarkerRef.current) return;
          const { latitude, longitude } = pos.coords;
          navMarkerRef.current.setLngLat([longitude, latitude]);
          mapRef.current.flyTo({
            center: [longitude, latitude],
            pitch: 60,
            zoom: 15,
            duration: 1200,
          });
        },
        () => { /* non-fatal — watchPosition will handle it */ },
        { enableHighAccuracy: true, timeout: 8000 }
      );

      // Start continuous tracking
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (!mapRef.current || !navMarkerRef.current) return;
          const { latitude, longitude, heading } = position.coords;

          navMarkerRef.current.setLngLat([longitude, latitude]);

          // Heading is null when stationary or unavailable
          const hasHeading = heading !== null && heading !== undefined && !isNaN(heading);
          if (hasHeading) {
            lastHeadingRef.current = heading;
            if (navArrowElRef.current) {
              navArrowElRef.current.style.transform = `rotate(${heading}deg)`;
            }
          }

          // Center and tilt — NO zoom change (user controls zoom manually)
          mapRef.current.easeTo({
            center: [longitude, latitude],
            pitch: 60,
            bearing: hasHeading ? heading : mapRef.current.getBearing(),
            duration: 1000,
          });
        },
        (err) => {
          console.error('Geolocation watch error:', err.code, err.message);
          setLocationMode(false);
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    } else {
      // Stop watching
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      navMarkerRef.current?.remove();
      navMarkerRef.current = null;

      // Reset to top-down view
      map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
    };
  }, [locationMode, mapLoaded]);

  // ─── MAP INITIALIZATION ───────────────────────────────────────────────────

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

      // ── Hide unwanted labels & buildings (identical to DMB) ──
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
          id.includes('housenum') || id.includes('house-num') || id.includes('house_num') ||
          id.includes('address') || id.includes('housenumber');
        const textField = JSON.stringify(layer.layout?.['text-field'] ?? '');
        const fieldIsHouseNum =
          textField.includes('housenumber') || textField.includes('house_num') ||
          textField.includes('addr') || textField.includes('ref');
        const isNotRoadLabel =
          !id.includes('label') && !id.includes('shield') && !id.includes('motorway') &&
          !id.includes('road') && !id.includes('street');

        if (idIsHouseNum || fieldIsHouseNum || isNotRoadLabel) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });

      // ── Bold road labels ──
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
      mountedRef.current = false;
      initialFitDoneRef.current = false;
      routeDataLoadedRef.current = false;
      prevRouteCodesKeyRef.current = '';
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [suppressDuplicateLabels]);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const pendingCount = geocodedPins.filter(p => p.status === 'pending').length;
  const completedCount = geocodedPins.filter(p => p.status === 'completed').length;
  const newSaleCount = geocodedPins.filter(p => p.status === 'new_sale').length;

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Map container */}
      <div ref={mapContainerRef} className="flex-1" />

      {/* Geocoding progress */}
      {geocodingProgress && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          <Loader size={12} className="animate-spin text-blue-400" />
          Geocoding {geocodingProgress.current}/{geocodingProgress.total}…
        </div>
      )}

      {/* Route loading */}
      {routesLoading && !geocodingProgress && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          <Loader size={12} className="animate-spin text-blue-400" />
          Loading routes…
        </div>
      )}

      {/* No route map data warning */}
      {!routesLoading && routeMapData.length === 0 && myRouteCodes.length > 0 && mapLoaded && !geocodingProgress && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 text-yellow-300 px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">
          No map data found for your routes
        </div>
      )}

      {/* Location mode toggle */}
      <button
        onClick={() => setLocationMode(prev => !prev)}
        className={`absolute bottom-6 right-3 z-20 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          locationMode
            ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900'
            : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
        }`}
        title={locationMode ? 'Disable navigation mode' : 'Enable navigation mode'}
      >
        <Navigation size={22} className={locationMode ? 'fill-current' : ''} />
      </button>

      {/* Pin legend */}
      {geocodedPins.length > 0 && !geocodingProgress && (
        <div className="absolute bottom-6 left-3 z-20 bg-gray-900/90 text-white px-3 py-2 rounded-lg shadow-lg text-[10px] space-y-1 backdrop-blur-sm">
          {pendingCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-black inline-block flex-shrink-0" />
              <span>Pending ({pendingCount})</span>
            </div>
          )}
          {completedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-green-500 inline-block flex-shrink-0" />
              <span>Completed ({completedCount})</span>
            </div>
          )}
          {newSaleCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-yellow-500 inline-block flex-shrink-0" />
              <span>New Sale ({newSaleCount})</span>
            </div>
          )}
        </div>
      )}

      {/* Map loading overlay */}
      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
          <Loader size={24} className="animate-spin text-blue-500" />
        </div>
      )}
    </div>
  );
};

export default RMMapTab;