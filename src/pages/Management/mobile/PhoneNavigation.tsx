// src/pages/Management/mobile/PhoneNavigation.tsx
//
// State ③ of the RM phone layout: full turn-by-turn navigation, driver's-eye.
//
//   - Route from the Mapbox Directions API (driving-traffic, falls back to
//     driving) with banner instructions, voice instructions, lanes and the
//     posted speed limit along the route.
//   - The camera follows the phone: tilted 3D view, turned to the direction of
//     travel (snapped to the road when on the route), zoom easing out with
//     speed. Panning the map pauses following; "Re-centre" resumes it.
//   - Turn banner (next maneuver, distance, street, "then …", lanes) at the
//     top; ETA bar with arrival time, mute and End at the bottom.
//   - Voice prompts read aloud by the phone (Web Speech), rerouting when you
//     leave the line, arrival detection, and the screen kept awake.
//
// It owns the camera while mounted and puts it back (flat, north-up, previous
// padding) on unmount. It only adds/removes its own route layers.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, RotateCcw, MapPin, Merge,
  Volume2, VolumeX, LocateFixed, Loader, AlertTriangle,
} from 'lucide-react';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

export interface PhoneNavDestination { lat: number; lng: number; label: string; }

interface PhoneNavigationProps {
  map: mapboxgl.Map;
  destination: PhoneNavDestination;
  onArrived: () => void;
  onCancel: () => void;
  /** Keep navigating (and following) after arriving — the caller decides what's
   *  next (worker driver stops: a Continue button moves to the next stop). */
  stayOnArrival?: boolean;
  /** Extra row on top of the ETA bar; told whether we've arrived. */
  renderExtra?: (arrived: boolean) => React.ReactNode;
}

// --- tuning ---
const ARRIVAL_M = 30;
const STEP_ADVANCE_M = 22;
const OFF_ROUTE_M = 45;
const REROUTE_MIN_MS = 12000;
const SNAP_BEARING_M = 30;       // within this of the line, face along the road
const SRC = 'rm-pnav-src';
const L_CASING = 'rm-pnav-casing';
const L_LINE = 'rm-pnav-line';
const MUTE_KEY = 'rm_nav_muted';

// --- Directions API shapes (only what we use) ---
interface BannerComponent { type: string; text: string; active?: boolean; directions?: string[]; active_direction?: string; }
interface BannerText { text: string; type?: string; modifier?: string; components?: BannerComponent[]; }
interface BannerInstruction { distanceAlongGeometry: number; primary: BannerText; secondary?: BannerText | null; sub?: BannerText | null; }
interface VoiceInstruction { distanceAlongGeometry: number; announcement: string; }
interface Step {
  distance: number; duration: number; name?: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string; instruction: string; location: [number, number] };
  bannerInstructions?: BannerInstruction[];
  voiceInstructions?: VoiceInstruction[];
}
interface MaxSpeed { speed?: number; unit?: string; unknown?: boolean; none?: boolean; }
interface Leg { distance: number; duration: number; steps: Step[]; annotation?: { maxspeed?: MaxSpeed[] }; }
interface Route { distance: number; duration: number; geometry: { type: 'LineString'; coordinates: [number, number][] }; legs: Leg[]; }

// --- geometry helpers ---
function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const cos = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const dx = (lng2 - lng1) * 111320 * cos;
  const dy = (lat2 - lat1) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dl = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
/** Nearest segment of a line to a point: index, distance (m), and the snapped point. */
function nearestSegment(lat: number, lng: number, coords: [number, number][]): { idx: number; dist: number } {
  let best = { idx: 0, dist: Infinity };
  const cos = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    const px = (lng - x1) * 111320 * cos, py = (lat - y1) * 111320;
    const bx = (x2 - x1) * 111320 * cos, by = (y2 - y1) * 111320;
    const len = bx * bx + by * by;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.dist) best = { idx: i, dist: d };
  }
  return best;
}
/** Smallest signed difference between two bearings, degrees. */
function angleDiff(a: number, b: number): number { return ((b - a + 540) % 360) - 180; }

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
function fmtDur(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), mm = min % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}
function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function TurnIcon({ type, modifier, size, className = 'text-white' }: { type?: string; modifier?: string; size: number; className?: string }) {
  if (type === 'arrive') return <MapPin size={size} className={className} />;
  if (modifier === 'uturn') return <RotateCcw size={size} className={className} />;
  if (type === 'merge' || type === 'on ramp' || type === 'off ramp' || type === 'fork') {
    if (modifier?.includes('left')) return <ArrowUpLeft size={size} className={className} />;
    if (modifier?.includes('right')) return <ArrowUpRight size={size} className={className} />;
    return <Merge size={size} className={className} />;
  }
  if (modifier === 'slight right') return <ArrowUpRight size={size} className={className} />;
  if (modifier === 'slight left') return <ArrowUpLeft size={size} className={className} />;
  if (modifier?.includes('right')) return <CornerUpRight size={size} className={className} />;
  if (modifier?.includes('left')) return <CornerUpLeft size={size} className={className} />;
  return <ArrowUp size={size} className={className} />;
}

const PhoneNavigation: React.FC<PhoneNavigationProps> = ({ map, destination, onArrived, onCancel, stayOnArrival = false, renderExtra }) => {
  const [arrived, setArrived] = useState(false);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeVersion, setRouteVersion] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [gps, setGps] = useState<{ lat: number; lng: number; speed: number | null; heading: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [following, setFollowing] = useState(true);
  const [muted, setMuted] = useState<boolean>(() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } });

  const mountedRef = useRef(true);
  const lastRerouteRef = useRef(0);
  const spokenRef = useRef<Set<string>>(new Set());
  const camBearingRef = useRef<number | null>(null);
  const prevFixRef = useRef<{ lat: number; lng: number } | null>(null);
  const followingRef = useRef(true);
  const mutedRef = useRef(muted);
  const arrivedRef = useRef(false);
  useEffect(() => { followingRef.current = following; }, [following]);
  useEffect(() => { mutedRef.current = muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* */ } }, [muted]);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || !text) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      // (cancel-then-speak drops the new utterance on some iOS versions, so only
      // cancel when something is actually being said)
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-CA';
      u.rate = 1.0;
      synth.speak(u);
    } catch { /* no speech */ }
  }, []);

  // --- Directions ---
  const fetchRoute = useCallback(async (lat: number, lng: number, heading: number | null): Promise<Route | null> => {
    const coords = `${lng},${lat};${destination.lng},${destination.lat}`;
    const bearings = heading != null ? `&bearings=${Math.round(heading)},60;` : '';
    const qs = `geometries=geojson&overview=full&steps=true&banner_instructions=true&voice_instructions=true&voice_units=metric&language=en&annotations=maxspeed&alternatives=false${bearings}&access_token=${MAPBOX_TOKEN}`;
    for (const profile of ['driving-traffic', 'driving']) {
      try {
        const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${qs}`);
        if (res.status === 401 || res.status === 403) { setError('The map key can’t get directions.'); return null; }
        if (!res.ok) continue;
        const data = await res.json();
        if (data.routes?.length) { setError(null); return data.routes[0] as Route; }
        if (data.code === 'NoRoute') { setError('No driving route to there.'); return null; }
      } catch { /* try the next profile */ }
    }
    setError('Couldn’t get directions — check the connection.');
    return null;
  }, [destination.lat, destination.lng]);

  // --- route line on the map ---
  useEffect(() => {
    if (!map) return;
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getLayer(L_CASING)) map.addLayer({ id: L_CASING, type: 'line', source: SRC, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e3a8a', 'line-width': 14, 'line-opacity': 0.9 } });
      if (!map.getLayer(L_LINE)) map.addLayer({ id: L_LINE, type: 'line', source: SRC, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 9, 'line-opacity': 1 } });
    } catch { /* style not ready */ }
    return () => {
      try {
        if (map.getLayer(L_LINE)) map.removeLayer(L_LINE);
        if (map.getLayer(L_CASING)) map.removeLayer(L_CASING);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch { /* map gone */ }
    };
  }, [map]);

  useEffect(() => {
    const src = map?.getSource(SRC) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(route
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: route.geometry }] }
      : { type: 'FeatureCollection', features: [] });
  }, [map, route]);

  // --- camera ownership: tilt + padding on, restored on leave ---
  useEffect(() => {
    if (!map) return;
    const prevPadding = map.getPadding();
    const h = map.getContainer().clientHeight || window.innerHeight;
    // Put "you" about 70% of the way down the screen, above the ETA bar.
    try { map.easeTo({ padding: { top: Math.round(h * 0.42), bottom: renderExtra ? 170 : 110, left: 0, right: 0 }, pitch: 60, zoom: Math.max(map.getZoom(), 16.5), duration: 600 }); } catch { /* */ }
    const pause = (e: any) => { if (e?.originalEvent) setFollowing(false); };
    map.on('dragstart', pause);
    map.on('pitchstart', pause);
    map.on('zoomstart', pause);
    map.on('rotatestart', pause);
    return () => {
      map.off('dragstart', pause);
      map.off('pitchstart', pause);
      map.off('zoomstart', pause);
      map.off('rotatestart', pause);
      try { map.easeTo({ padding: prevPadding, pitch: 0, bearing: 0, duration: 600 }); } catch { /* map gone */ }
    };
  }, [map]);

  // --- GPS ---
  useEffect(() => {
    mountedRef.current = true;
    if (!navigator.geolocation) { setError('This phone can’t share its location.'); return; }
    // A recent cached fix gets the first route requested straight away; the
    // watch below then keeps it live.
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!mountedRef.current) return;
        const { latitude, longitude, speed, heading } = pos.coords;
        setGps(prev => prev ?? { lat: latitude, lng: longitude, speed: speed ?? null, heading: heading != null && !isNaN(heading) ? heading : null });
      },
      () => { /* the watch reports errors */ },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 },
    );
    const id = navigator.geolocation.watchPosition(
      pos => {
        if (!mountedRef.current) return;
        const { latitude, longitude, speed, heading } = pos.coords;
        setGps({ lat: latitude, lng: longitude, speed: speed ?? null, heading: heading != null && !isNaN(heading) ? heading : null });
      },
      err => { if (err.code === err.PERMISSION_DENIED) setError('Location is turned off for this site.'); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
    return () => { mountedRef.current = false; navigator.geolocation.clearWatch(id); };
  }, []);

  // --- keep the screen on ---
  useEffect(() => {
    let lock: any = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
        if (cancelled && lock) { lock.release().catch(() => {}); lock = null; }
      } catch { /* not supported / denied */ }
    };
    request();
    const onVis = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      try { lock?.release(); } catch { /* */ }
      // Let "You have arrived" finish; cut anything else off.
      if (!arrivedRef.current) { try { window.speechSynthesis?.cancel(); } catch { /* */ } }
    };
  }, []);

  // --- first route once we know where we are (retried every few seconds if it fails) ---
  const firstTryRef = useRef(0);
  const firstInFlightRef = useRef(false);
  useEffect(() => {
    if (!gps || route || firstInFlightRef.current) return;
    if (Date.now() - firstTryRef.current < 8000) return;
    firstTryRef.current = Date.now();
    firstInFlightRef.current = true;
    (async () => {
      const r = await fetchRoute(gps.lat, gps.lng, gps.heading);
      firstInFlightRef.current = false;
      if (!mountedRef.current || !r) return;
      spokenRef.current = new Set();
      setRoute(r); setStepIdx(0); setRouteVersion(v => v + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, route]);

  const steps = route?.legs[0]?.steps || [];
  const onLine = useMemo(() => (gps && route ? nearestSegment(gps.lat, gps.lng, route.geometry.coordinates) : null), [gps, route]);

  // --- every fix: arrival, step advance, voice, reroute, camera ---
  useEffect(() => {
    if (!gps || !route || (arrivedRef.current && !stayOnArrival)) return;

    // Arrival.
    if (!arrivedRef.current && distM(gps.lat, gps.lng, destination.lat, destination.lng) <= ARRIVAL_M) {
      arrivedRef.current = true;
      setArrived(true);
      speak(`You have arrived at ${destination.label}.`);
      onArrived();
      if (!stayOnArrival) return;
    }

    // Step advance: stepIdx is the NEXT maneuver.
    let idx = stepIdx;
    while (idx < steps.length - 1) {
      const [mlng, mlat] = steps[idx].maneuver.location;
      if (distM(gps.lat, gps.lng, mlat, mlng) < STEP_ADVANCE_M) idx++;
      else break;
    }
    if (idx !== stepIdx) setStepIdx(idx);

    // Voice: the step we're driving (idx-1) carries the prompts for maneuver idx.
    // (Before the first advance — idx 0 — only the opening prompt applies,
    // which the route-arrival effect below has already spoken.)
    const driving = idx > 0 ? steps[idx - 1] : null;
    const target = steps[idx];
    if (driving?.voiceInstructions?.length && target) {
      const [tlng, tlat] = target.maneuver.location;
      const toTurn = distM(gps.lat, gps.lng, tlat, tlng);
      const due = driving.voiceInstructions
        .map((v, i) => ({ v, key: `${routeVersion}:${idx - 1}:${i}` }))
        .filter(({ v, key }) => !spokenRef.current.has(key) && v.distanceAlongGeometry >= toTurn - 5);
      if (due.length) {
        due.forEach(d => spokenRef.current.add(d.key));
        // Only say the most current one if several became due at once.
        const latest = due.reduce((a, b) => (b.v.distanceAlongGeometry < a.v.distanceAlongGeometry ? b : a));
        speak(latest.v.announcement);
      }
    }

    // Off the line → reroute (throttled).
    const now = Date.now();
    if (onLine && onLine.dist > OFF_ROUTE_M && now - lastRerouteRef.current > REROUTE_MIN_MS) {
      lastRerouteRef.current = now;
      setRerouting(true);
      speak('Rerouting.');
      (async () => {
        const r = await fetchRoute(gps.lat, gps.lng, camBearingRef.current);
        if (!mountedRef.current) return;
        setRerouting(false);
        if (r) { spokenRef.current = new Set(); setRoute(r); setStepIdx(0); setRouteVersion(v => v + 1); }
      })();
    }

    // Camera bearing: along the road when on the line, else GPS heading when
    // moving, else from the last two fixes, else hold.
    let b: number | null = null;
    const coords = route.geometry.coordinates;
    if (onLine && onLine.dist <= SNAP_BEARING_M && coords.length > 1) {
      const [x1, y1] = coords[onLine.idx], [x2, y2] = coords[Math.min(onLine.idx + 1, coords.length - 1)];
      b = bearing(y1, x1, y2, x2);
    } else if (gps.heading != null && (gps.speed ?? 0) > 1.5) {
      b = gps.heading;
    } else if (prevFixRef.current && distM(prevFixRef.current.lat, prevFixRef.current.lng, gps.lat, gps.lng) > 4) {
      b = bearing(prevFixRef.current.lat, prevFixRef.current.lng, gps.lat, gps.lng);
    }
    prevFixRef.current = { lat: gps.lat, lng: gps.lng };
    if (b != null) {
      // Smooth out jitter: ignore tiny wobbles.
      const prev = camBearingRef.current;
      camBearingRef.current = prev == null || Math.abs(angleDiff(prev, b)) > 4 ? b : prev;
    }
    if (followingRef.current) {
      const kmh = Math.max(0, (gps.speed ?? 0) * 3.6);
      const zoom = kmh > 70 ? 15.6 : kmh > 45 ? 16.2 : kmh > 20 ? 16.8 : 17.3;
      try {
        map.easeTo({
          center: [gps.lng, gps.lat],
          bearing: camBearingRef.current ?? map.getBearing(),
          pitch: 60, zoom, duration: 950, easing: t => t,
        });
      } catch { /* map busy */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, route]);

  // First prompt as soon as a (new) route arrives.
  useEffect(() => {
    if (!route) return;
    const first = route.legs[0]?.steps[0]?.voiceInstructions?.[0];
    const key = `${routeVersion}:0:0`;
    if (first && !spokenRef.current.has(key)) { spokenRef.current.add(key); speak(first.announcement); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeVersion]);

  const recentre = () => {
    setFollowing(true);
    if (gps) {
      try { map.easeTo({ center: [gps.lng, gps.lat], bearing: camBearingRef.current ?? 0, pitch: 60, zoom: 17, duration: 600 }); } catch { /* */ }
    }
  };

  // --- what the banner shows ---
  const target = steps[stepIdx];
  const driving = stepIdx > 0 ? steps[stepIdx - 1] : null;
  const toTurn = target && gps ? distM(gps.lat, gps.lng, target.maneuver.location[1], target.maneuver.location[0]) : 0;
  const banner: BannerInstruction | null = useMemo(() => {
    const list = (driving || steps[0])?.bannerInstructions || [];
    if (!list.length) return null;
    // The banner meant for this distance: the closest one still ahead of us.
    const eligible = list.filter(b => b.distanceAlongGeometry >= toTurn - 5);
    return (eligible.length ? eligible.reduce((a, b) => (b.distanceAlongGeometry < a.distanceAlongGeometry ? b : a)) : list[list.length - 1]);
  }, [driving, steps, toTurn]);
  const primaryText = banner?.primary.text || target?.maneuver.instruction || 'Starting route…';
  const primaryType = banner?.primary.type || target?.maneuver.type;
  const primaryMod = banner?.primary.modifier || target?.maneuver.modifier;
  const lanes = (banner?.sub?.components || []).filter(c => c.type === 'lane');
  const then = steps[stepIdx + 1] && toTurn < 400 ? steps[stepIdx + 1] : null;

  // Remaining distance / time.
  let remainDist = toTurn, remainDur = 0;
  if (route && target) {
    const ratio = driving && driving.distance > 0 ? driving.duration / driving.distance : 1 / 13;
    remainDur = toTurn * ratio;
    for (let i = stepIdx; i < steps.length; i++) { remainDist += steps[i].distance; remainDur += steps[i].duration; }
  }
  const eta = new Date(Date.now() + remainDur * 1000);

  // Posted limit where we are.
  const maxspeed = onLine && route?.legs[0]?.annotation?.maxspeed ? route.legs[0].annotation.maxspeed[onLine.idx] : undefined;
  const limit = maxspeed && maxspeed.speed && !maxspeed.unknown && !maxspeed.none
    ? Math.round(maxspeed.unit === 'mph' ? maxspeed.speed * 1.609 : maxspeed.speed)
    : null;
  const kmh = gps?.speed != null ? Math.round(Math.max(0, gps.speed * 3.6)) : null;
  const speeding = limit != null && kmh != null && kmh > limit + 5;

  return (
    <>
      {/* TURN BANNER */}
      <div className="absolute inset-x-0 top-0 z-40 pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="m-2 rounded-2xl bg-green-800 shadow-2xl text-white pointer-events-auto overflow-hidden">
          {error ? (
            <div className="flex items-center gap-3 p-3">
              <AlertTriangle size={28} className="text-amber-300 flex-shrink-0" />
              <div className="text-sm font-bold">{error}</div>
            </div>
          ) : arrived && stayOnArrival ? (
            <div className="flex items-center gap-3 p-3">
              <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-green-900/60 flex items-center justify-center"><MapPin size={36} /></div>
              <div className="min-w-0">
                <div className="text-[22px] font-extrabold leading-none">Arrived</div>
                <div className="text-[15px] font-bold leading-snug mt-1 truncate">{destination.label}</div>
              </div>
            </div>
          ) : !route ? (
            <div className="flex items-center gap-3 p-3">
              <Loader size={24} className="animate-spin flex-shrink-0" />
              <div className="text-sm font-bold">Finding a route to {destination.label}…</div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-green-900/60 flex items-center justify-center">
                  <TurnIcon type={primaryType} modifier={primaryMod} size={40} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[26px] font-extrabold leading-none">{fmtDist(toTurn)}</div>
                  <div className="text-[15px] font-bold leading-snug mt-1 line-clamp-2">{primaryText}</div>
                  {banner?.secondary?.text && <div className="text-xs text-green-100/80 truncate">{banner.secondary.text}</div>}
                </div>
              </div>
              {lanes.length > 0 && (
                <div className="flex justify-center gap-1 px-3 pb-2">
                  {lanes.map((l, i) => {
                    const dir = (l.active && l.active_direction) || l.directions?.[0] || 'straight';
                    const mod = dir === 'straight' ? undefined : dir;
                    return (
                      <div key={i} className={`w-9 h-9 rounded-md flex items-center justify-center ${l.active ? 'bg-white/90' : 'bg-green-950/50'}`}>
                        <TurnIcon type="turn" modifier={mod} size={22} className={l.active ? 'text-green-900' : 'text-green-200/50'} />
                      </div>
                    );
                  })}
                </div>
              )}
              {then && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/70 text-xs font-bold">
                  <span className="text-green-200">Then</span>
                  <TurnIcon type={then.maneuver.type} modifier={then.maneuver.modifier} size={16} />
                  <span className="truncate">{then.name || then.maneuver.instruction}</span>
                </div>
              )}
            </>
          )}
          {rerouting && <div className="px-3 py-1.5 bg-amber-600 text-xs font-bold text-center">Rerouting…</div>}
        </div>
      </div>

      {/* SPEED / LIMIT */}
      {route && (
        <div className="absolute left-3 z-30 flex flex-col items-center gap-1.5" style={{ bottom: renderExtra ? 172 : 104 }}>
          {limit != null && (
            <div className="w-14 rounded-lg bg-[#ffffff] border-2 border-[#000000] text-[#000000] text-center leading-none py-1 shadow-lg">
              <div className="text-[8px] font-extrabold tracking-wide">MAXIMUM</div>
              <div className="text-xl font-extrabold">{limit}</div>
            </div>
          )}
          {kmh != null && (
            <div className={`w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg border-2 ${speeding ? 'bg-red-600 border-red-300 text-white' : 'bg-gray-900 border-gray-600 text-white'}`}>
              <span className="text-lg font-extrabold leading-none">{kmh}</span>
              <span className="text-[9px] font-bold opacity-70">km/h</span>
            </div>
          )}
        </div>
      )}

      {!following && (
        <button
          onClick={recentre}
          className="absolute right-3 z-30 h-12 px-4 rounded-full bg-gray-900 border border-gray-700 text-white font-bold text-sm flex items-center gap-2 shadow-xl"
          style={{ bottom: renderExtra ? 172 : 104 }}
        ><LocateFixed size={18} /> Re-centre</button>
      )}

      {/* ETA BAR */}
      <div
        className="absolute inset-x-0 bottom-0 z-30 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl px-4 pt-3"
        style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
      >
      {renderExtra && <div className="mb-3">{renderExtra(arrived)}</div>}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMuted(m => !m)}
          className="w-11 h-11 rounded-full bg-gray-800 flex items-center justify-center text-gray-200 flex-shrink-0"
          aria-label={muted ? 'Turn voice on' : 'Mute voice'}
        >{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
        <div className="min-w-0 flex-1">
          {route && !error ? (
            <>
              <div className="text-xl font-extrabold text-green-400 leading-tight">{fmtDur(remainDur)} <span className="text-white/80 text-base font-bold">· {fmtClock(eta)}</span></div>
              <div className="text-xs text-gray-400 truncate">{fmtDist(remainDist)} · to <span className="text-gray-200 font-bold">{destination.label}</span></div>
            </>
          ) : (
            <div className="text-sm text-gray-300 truncate">To <span className="font-bold text-white">{destination.label}</span></div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="h-11 px-5 rounded-full bg-red-600 active:bg-red-500 text-white font-extrabold text-sm flex-shrink-0"
        >End</button>
      </div>
      </div>
    </>
  );
};

export default PhoneNavigation;
