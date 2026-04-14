// src/pages/Management/components/RMMapTab.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader, Navigation, ChevronLeft, ChevronRight, X, Users, Eye, Phone, MapPin, AlertCircle, LayoutList, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sessionService } from '../../../lib/sessionService';
import { getSeasonConfig, EQ_DIVISOR } from '../../../lib/commandCenterService';
import { setStorageItem } from '../../../lib/localStorage';
import { RouteData, MasterBooking, LogsheetSession, Worker, ManagementUser } from '../../../types';
import ContractorJobs from './ContractorJobs';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// --- INTERFACES ---

interface SavedRoute {
  id: string; area_name: string; route_number: number; route_code: string; route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}
interface PinData {
  id: string; address: string; routeCode: string; name: string;
  status: 'pending' | 'completed' | 'new_sale';
  phone?: string; email?: string; price?: string; paymentMethod?: string;
}
interface GeocodedPin extends PinData { lat: number; lng: number; routeColor: string; }

// Worker live location from worker_locations table
interface WorkerLocation {
  worker_id: string;
  command_center_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}

interface RMMapTabProps {
  managerId: string; routes: RouteData[]; bookings: MasterBooking[];
  allSessions: LogsheetSession[]; workers: Worker[];
  currentUser: ManagementUser; onRefresh: () => void;
}
interface WorkerCardData {
  worker: Worker; displayBookings: MasterBooking[]; financialStore: any[];
  assignedRoutes: string[]; lastActiveTimestamp: string | null;
  stats: { steps: number; pending: number; eq: number; upsellCount: number; upsellGross: number; };
}
interface RouteCardData {
  routeCode: string; routeColor: string; assignedWorkerIds: string[];
  assignedWorkerLabel: string; prebookCount: number; prepayCount: number; totalEQ: number; isAssigned: boolean;
}
interface AssignModalData {
  routeCode: string; routeColor: string; prebookCount: number; prepayCount: number; totalEQ: number; currentWorkerIds: string[];
}
type SidebarMode = 'staff' | 'routes';
type SortOption = 'recent' | 'alpha' | 'steps' | 'equiv' | 'upGross';

// --- HELPERS ---

const geocodeCache = new Map<string, { lat: number; lng: number }>();
const jobIdCache = new Map<string, { lat: number; lng: number }>();
const makeCacheKey = (a: string) => a.trim().toLowerCase();
const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

async function geocodeAddress(addr: string, pLat?: number, pLng?: number): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  const q = encodeURIComponent([addr,'Ontario','Canada'].join(', '));
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${token}&limit=1&country=ca&types=address`;
  if (pLat !== undefined && pLng !== undefined) url += `&proximity=${pLng},${pLat}`;
  try {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features?.length > 0) { const [lng, lat] = data.features[0].center; return { lat, lng }; }
    return null;
  } catch { return null; }
}

function createNavArrow(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#4285F4" stroke="white" stroke-width="2" opacity="0.25"/><path d="M12 4 L18 18 L12 14 L6 18 Z" fill="#4285F4" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  el.style.cssText = 'transition: transform 0.3s ease;';
  return el;
}

/**
 * Border color based on how stale the location data is:
 * green  = within 10 minutes
 * yellow = within 1 hour
 * orange = within 2 hours
 * red    = 2+ hours
 */
function getStalenessColor(updatedAt: string): string {
  const ageMin = (Date.now() - new Date(updatedAt).getTime()) / 60000;
  if (ageMin <= 10)  return '#22c55e'; // green
  if (ageMin <= 60)  return '#eab308'; // yellow
  if (ageMin <= 120) return '#f97316'; // orange
  return '#ef4444';                    // red
}

/**
 * Create the HTML element for a worker location dot.
 * Light grey fill, initials centered, colored border = staleness.
 * Larger than prebook pins (which are ~10px diameter circles).
 */
function createWorkerMarkerEl(initials: string, borderColor: string, label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'width:32px',
    'height:32px',
    'border-radius:50%',
    'background:#d1d5db',
    `border:3px solid ${borderColor}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:11px',
    'font-weight:700',
    'color:#374151',
    'font-family:system-ui,sans-serif',
    'box-shadow:0 2px 6px rgba(0,0,0,0.35)',
    'cursor:default',
    'user-select:none',
  ].join(';');
  el.textContent = initials;
  el.title = label; // browser tooltip shows full worker name
  return el;
}

// --- NEW HELPERS: On-route detection, red flags, pulsing dot ---

/**
 * Perpendicular distance in meters from a point to a line segment.
 * Projects lat/lng to local flat-earth meters (accurate at short range).
 * This detects you even if you're BETWEEN two coordinate points on a road.
 */
function distToSegmentMeters(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  // Convert to local meters relative to segment start
  const px = (lng - lng1) * mPerDegLng;
  const py = (lat - lat1) * mPerDegLat;
  const bx = (lng2 - lng1) * mPerDegLng;
  const by = (lat2 - lat1) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.sqrt(px * px + py * py); // zero-length segment
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const cx = t * bx;
  const cy = t * by;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/**
 * Find the nearest route segment that has exactly 1 assigned worker.
 * Uses point-to-line-segment distance so you're detected anywhere along
 * the road, not just near individual coordinate dots.
 * Returns { routeCode, workerId } or null if none within threshold.
 */
function findNearestAssignedRoute(
  lat: number, lng: number,
  routeMapData: SavedRoute[],
  routes: RouteData[],
  managerId: string,
  threshold: number = 50
): { routeCode: string; workerId: string } | null {
  let best: { routeCode: string; workerId: string; dist: number } | null = null;

  for (const rmd of routeMapData) {
    const rd = routes.find(r => r.routeCode === rmd.route_code && r.managerId === managerId);
    if (!rd) continue;
    if (!rd.assignedWorkerIds || rd.assignedWorkerIds.length !== 1) continue;
    const workerId = rd.assignedWorkerIds[0];

    for (const seg of rmd.segments || []) {
      const coords = seg.coordinates || [];
      // Check distance to each line segment between consecutive points
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const dist = distToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { routeCode: rmd.route_code, workerId, dist };
        }
      }
      // Handle single-point segments
      if (coords.length === 1) {
        const [cLng, cLat] = coords[0];
        const dist = distToSegmentMeters(lat, lng, cLat, cLng, cLat, cLng);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { routeCode: rmd.route_code, workerId, dist };
        }
      }
    }
  }

  return best ? { routeCode: best.routeCode, workerId: best.workerId } : null;
}

/**
 * Compute red flag conditions for a contractor:
 * 1. < 50% contact details on first 5 new sales
 * 2. < 70% contact details on sales #6+
 * 3. Any pricing under minimums (FO/BO < $50, FP < $60)
 */
function computeRedFlags(financialStore: any[]): { hasFlag: boolean; flags: string[] } {
  const flags: string[] = [];

  // "Sales" = new door sales only (type 'Sale'), not prebooks ('Production')
  const sales = financialStore.filter((tx: any) => tx.type === 'Sale');

  if (sales.length > 0) {
    const first5 = sales.slice(0, 5);
    const after5 = sales.slice(5);

    // First 5 sales: need >= 50% contact fill
    const first5Filled = first5.reduce((n: number, tx: any) => {
      if (tx.customerPhone?.trim()) n++;
      if (tx.customerEmail?.trim()) n++;
      return n;
    }, 0);
    if (first5Filled / (first5.length * 2) < 0.5) {
      flags.push('contacts_first5');
    }

    // Sales #6+: need >= 70% contact fill
    if (after5.length > 0) {
      const after5Filled = after5.reduce((n: number, tx: any) => {
        if (tx.customerPhone?.trim()) n++;
        if (tx.customerEmail?.trim()) n++;
        return n;
      }, 0);
      if (after5Filled / (after5.length * 2) < 0.7) {
        flags.push('contacts_after5');
      }
    }
  }

  // Pricing check on all completed regular jobs (Production + Sale)
  const completedJobs = financialStore.filter((tx: any) => tx.type === 'Production' || tx.type === 'Sale');
  for (const tx of completedJobs) {
    const st = tx.serviceType;
    const price = typeof tx.price === 'number' ? tx.price : parseFloat(String(tx.price || '0'));
    if (!st || !price) continue;
    if ((st === 'FO' || st === 'BO') && price < 50) { flags.push('pricing'); break; }
    if (st === 'FP' && price < 60) { flags.push('pricing'); break; }
  }

  return { hasFlag: flags.length > 0, flags };
}

/**
 * Create ONLY a pulsing ring overlay — no inner dot.
 * Single flat div (no nesting) so Mapbox anchor:'center' aligns it perfectly
 * on top of the underlying map circle-layer pin.
 */
function createPulsingRing(color: string): HTMLDivElement {
  if (!document.getElementById('rm-pulse-keyframes')) {
    const style = document.createElement('style');
    style.id = 'rm-pulse-keyframes';
    style.textContent = `@keyframes rmPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.5);opacity:0}}`;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.style.cssText = 'width:15px;height:15px;border-radius:50%;border:2.5px solid ' + color + ';animation:rmPulse 1.8s ease-out infinite;pointer-events:none;box-sizing:border-box;margin:0;padding:0;';
  return el;
}

const WORKER_LOCATION_POLL_MS = 5 * 60 * 1000; // 5 minutes

// --- COMPONENT ---

const RMMapTab: React.FC<RMMapTabProps> = ({ managerId, routes, bookings, allSessions, workers, currentUser, onRefresh }) => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const loadedIdsRef = useRef<string[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const pinClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const [routeMapData, setRouteMapData] = useState<SavedRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const prevRouteCodesKeyRef = useRef('');
  const routeDataLoadedRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const knownPinsRef = useRef<Map<string, GeocodedPin>>(new Map());
  const [geocodedPins, setGeocodedPins] = useState<GeocodedPin[]>([]);
  const [geocodingProgress, setGeocodingProgress] = useState<{ current: number; total: number } | null>(null);
  const geocodeBatchRef = useRef(0);
  const mountedRef = useRef(true);
  const [centerOnLocation, setCenterOnLocation] = useState(false);
  const centerOnLocationRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('staff');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedWorkerForModal, setSelectedWorkerForModal] = useState<WorkerCardData | null>(null);
  const [selectedRouteForBookings, setSelectedRouteForBookings] = useState<string | null>(null);
  const [assignModalData, setAssignModalData] = useState<AssignModalData | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const sidebarModeRef = useRef<SidebarMode>('staff');
  const routesRef = useRef(routes);
  const bookingsRef = useRef(bookings);

  // Worker location state — tracks live dots from worker_locations table
  const [workerLocations, setWorkerLocations] = useState<WorkerLocation[]>([]);
  const workerLocationMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // --- NEW STATE: On-route button + pulsing dot ---
  const [onRouteWorkerCard, setOnRouteWorkerCard] = useState<WorkerCardData | null>(null);
  const onRouteWorkerIdRef = useRef<string | null>(null);
  const pulsingMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const routeMapDataRef = useRef<SavedRoute[]>([]);
  const workerCardDataRef = useRef<WorkerCardData[]>([]);

  useEffect(() => { sidebarModeRef.current = sidebarMode; }, [sidebarMode]);
  useEffect(() => { routesRef.current = routes; }, [routes]);
  useEffect(() => { bookingsRef.current = bookings; }, [bookings]);
  useEffect(() => { routeMapDataRef.current = routeMapData; }, [routeMapData]);

  const myRouteCodes = useMemo(() => routes.filter(r => r.managerId === managerId).map(r => r.routeCode), [routes, managerId]);
  const myTeamIds = useMemo(() => new Set(workers.filter(w => w.assignedManagerId === managerId).map(w => w.contractorId)), [workers, managerId]);
  const routeColorMap = useMemo(() => { const m = new Map<string,string>(); routeMapData.forEach(r => m.set(r.route_code, r.route_color)); return m; }, [routeMapData]);
  const isAerationSeason = useMemo(() => !allSessions.some(s => s.teamWorkerIds && s.teamWorkerIds.length > 1), [allSessions]);

  const workerLastActive = useMemo(() => {
    const m = new Map<string,string>();
    allSessions.forEach(s => (s.financialStore||[]).forEach((tx:any) => {
      if (!tx.timestamp || !tx.workerId) return;
      const ex = m.get(tx.workerId);
      if (!ex || tx.timestamp > ex) m.set(tx.workerId, tx.timestamp);
    }));
    return m;
  }, [allSessions]);

  const workerCardData = useMemo<WorkerCardData[]>(() => {
    if (!isAerationSeason) return [];
    return workers.filter(w => w.assignedManagerId === managerId).map(worker => {
      const session = allSessions.find(s => s.workerId === worker.contractorId);
      const st = session?.stats; const fs = session?.financialStore || [];
      const wb = bookings.filter(b => b['Contractor Number'] === worker.contractorId);
      const ar = Array.from(new Set(wb.map(b => b['Route Number']).filter((r):r is string => !!r && r.trim()!=='')));
      const pending = wb.filter(b => b.Completed!=='x' && b.Status!=='completed' && b.Status!=='cancelled' && b.Status!=='next_time').length;
      return { worker, displayBookings: wb, financialStore: fs, assignedRoutes: ar, lastActiveTimestamp: workerLastActive.get(worker.contractorId)||null,
        stats: { steps: st?.stepCount||0, pending, eq: st?.totalEQ||0, upsellCount: st?.upsellCount||0, upsellGross: st?.upsellGross||0 } };
    });
  }, [workers, managerId, allSessions, bookings, isAerationSeason, workerLastActive]);

  // Keep workerCardData ref fresh for use in GPS callback
  useEffect(() => { workerCardDataRef.current = workerCardData; }, [workerCardData]);

  // Keep on-route card data fresh when sessions refresh
  useEffect(() => {
    if (!onRouteWorkerIdRef.current) return;
    const updated = workerCardData.find(c => c.worker.contractorId === onRouteWorkerIdRef.current);
    if (updated) setOnRouteWorkerCard(updated);
  }, [workerCardData]);

  const sortedWorkerCards = useMemo<WorkerCardData[]>(() => {
    const c = [...workerCardData];
    switch(sortBy) {
      case 'recent': return c.sort((a,b) => { if(!a.lastActiveTimestamp&&!b.lastActiveTimestamp) return 0; if(!a.lastActiveTimestamp) return 1; if(!b.lastActiveTimestamp) return -1; return b.lastActiveTimestamp.localeCompare(a.lastActiveTimestamp); });
      case 'alpha': return c.sort((a,b) => a.worker.lastName.localeCompare(b.worker.lastName));
      case 'steps': return c.sort((a,b) => b.stats.steps-a.stats.steps);
      case 'equiv': return c.sort((a,b) => b.stats.eq-a.stats.eq);
      case 'upGross': return c.sort((a,b) => b.stats.upsellGross-a.stats.upsellGross);
      default: return c;
    }
  }, [workerCardData, sortBy]);

  const routeCardData = useMemo<RouteCardData[]>(() => {
    const config = getSeasonConfig('aeration');
    return routes.filter(r => r.managerId===managerId).map(r => {
      const rmi = routeMapData.find(rm => rm.route_code===r.routeCode);
      const routeColor = rmi?.route_color||'#6b7280';
      const assignedIds = r.assignedWorkerIds||[];
      let label = '';
      if (assignedIds.length===1) { const w=workers.find(wk=>wk.contractorId===assignedIds[0]); if(w) label=`${w.firstName} ${w.lastName.charAt(0)}.`; }
      else if (assignedIds.length>1) { label=assignedIds.map(id=>{const w=workers.find(wk=>wk.contractorId===id);return w?`${w.firstName.charAt(0)}${w.lastName.charAt(0)}`:''}).filter(Boolean).join(' '); }
      const rb = bookings.filter(b=>b['Route Number']===r.routeCode);
      const totalEQ = rb.reduce((sum,b)=>{
        const ps=String(b.Price||'');
        for(const flat of config.officeFlats){if(ps.startsWith(flat.code)) return sum+flat.value/EQ_DIVISOR;}
        const price=parseFloat(ps.replace(/[^0-9.]/g,''))||0; if(!price) return sum;
        return sum+(price*(b.Prepaid==='x'?0.9:1.0))/1.05/EQ_DIVISOR;
      },0);
      return { routeCode:r.routeCode, routeColor, assignedWorkerIds:assignedIds, assignedWorkerLabel:label, prebookCount:rb.length, prepayCount:rb.filter(b=>b.Prepaid==='x').length, totalEQ, isAssigned:assignedIds.length>0 };
    }).sort((a,b)=>{ if(a.isAssigned!==b.isAssigned) return a.isAssigned?1:-1; return a.routeCode.localeCompare(b.routeCode); });
  }, [routes, managerId, routeMapData, workers, bookings]);

  const pins = useMemo<PinData[]>(() => {
    const result:PinData[]=[], done=new Set<string>(), myRS=new Set(myRouteCodes);
    allSessions.forEach(s => {
      const sids=(s.teamWorkerIds||[s.workerId]);
      const isMe=sids.some(wid=>myTeamIds.has(wid));
      (s.financialStore||[]).forEach((tx:any)=>{
        if(tx.type==='Upgrade'||tx.type==='Add-On') return;
        if(!isMe && !(tx.routeCode&&myRS.has(tx.routeCode))) return;
        const addr=tx.address||tx.itemDescription||''; if(!addr) return;
        done.add(tx.jobId);
        result.push({ id:tx.jobId||tx.id, address:addr, routeCode:tx.routeCode||'', name:tx.customerName||'Unknown',
          status:tx.jobId?.startsWith('NEW-')?'new_sale':'completed',
          phone:tx.customerPhone||'', email:tx.customerEmail||'',
          price:tx.displayPrice||(tx.price?`$${Number(tx.price).toFixed(2)}`:''), paymentMethod:tx.paymentMethod||'' });
      });
    });
    bookings.forEach(b=>{
      const rn=b['Route Number']; if(!rn||!myRS.has(rn)) return;
      if(done.has(b['Booking ID'])) return;
      const addr=b['Full Address']; if(!addr) return;
      result.push({ id:b['Booking ID'], address:addr, routeCode:rn, name:`${b['First Name']||''} ${b['Last Name']||''}`.trim()||'Unknown',
        status:'pending', phone:(b['Cell Phone']||b['Home Phone']||'') as string, email:(b['Email Address']||'') as string, price:b.Price?String(b.Price):'', paymentMethod:'' });
    });
    return result;
  }, [bookings, allSessions, myRouteCodes, myTeamIds]);

  const routeCentroid = useMemo(() => {
    if(!routeMapData.length) return null;
    let sLat=0,sLng=0,n=0;
    routeMapData.forEach(r=>r.segments?.forEach(seg=>{if(!seg.coordinates?.length) return; const mi=Math.floor(seg.coordinates.length/2); const [lng,lat]=seg.coordinates[mi]; sLat+=lat;sLng+=lng;n++;}));
    return n?{lat:sLat/n,lng:sLng/n}:null;
  }, [routeMapData]);

  // --- NEW MEMO: Most recent completion pin (for pulsing dot) ---
  // --- NEW MEMO: Most recent completion pin PER WORKER (for pulsing dots) ---
  const mostRecentCompletionPins = useMemo<GeocodedPin[]>(() => {
    // Find the latest transaction per worker/session
    const latestByWorker = new Map<string, { jobId: string; timestamp: string }>();

    allSessions.forEach(s => {
      const wid = s.workerId;
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (!tx.timestamp || !tx.jobId) return;
        const existing = latestByWorker.get(wid);
        if (!existing || tx.timestamp > existing.timestamp) {
          latestByWorker.set(wid, { jobId: tx.jobId, timestamp: tx.timestamp });
        }
      });
    });

    const result: GeocodedPin[] = [];
    latestByWorker.forEach(({ jobId }) => {
      const pin = geocodedPins.find(p => p.id === jobId && (p.status === 'completed' || p.status === 'new_sale'));
      if (pin) result.push(pin);
    });
    return result;
  }, [allSessions, geocodedPins]);

  // --- NEW MEMO: Red flags for on-route worker ---
  const onRouteRedFlags = useMemo(() => {
    if (!onRouteWorkerCard) return { hasFlag: false, flags: [] as string[] };
    return computeRedFlags(onRouteWorkerCard.financialStore);
  }, [onRouteWorkerCard]);

  const suppressDuplicateLabels = useCallback(() => {
    const map=mapRef.current; if(!map) return;
    const style=map.getStyle(); if(!style?.layers) return;
    const HIDE=['poi-label','housenum-label','road-number-shield'];
    const ids=style.layers.filter((l:any)=>l.type==='symbol'&&l.id.toLowerCase().includes('label')&&!l.id.includes('-point-backup')&&!HIDE.includes(l.id)).map((l:any)=>l.id);
    if(!ids.length) return;
    const names=[...new Set(map.queryRenderedFeatures(undefined,{layers:ids}).map((f:any)=>f.properties?.name).filter(Boolean))];
    style.layers.filter((l:any)=>l.id.includes('-point-backup')).forEach((l:any)=>{
      if(!map.getLayer(l.id)) return;
      try { map.setFilter(l.id,names.length?['!',['in',['get','name'],['literal',names]]]:null); } catch{}
    });
  }, []);

  // --- WORKER LOCATION FETCH ---

  const fetchWorkerLocations = useCallback(async () => {
    const teamIds = workers
      .filter(w => w.assignedManagerId === managerId)
      .map(w => w.contractorId);
    if (!teamIds.length) return;
    try {
      const { data } = await supabase
        .from('worker_locations')
        .select('*')
        .in('worker_id', teamIds);
      if (mountedRef.current) {
        setWorkerLocations((data || []) as WorkerLocation[]);
      }
    } catch (e) {
      console.error('Failed to fetch worker locations:', e);
    }
  }, [workers, managerId]);

  // Poll worker locations every 5 minutes once the map is loaded
  useEffect(() => {
    if (!mapLoaded) return;
    fetchWorkerLocations();
    const interval = setInterval(fetchWorkerLocations, WORKER_LOCATION_POLL_MS);
    return () => clearInterval(interval);
  }, [mapLoaded, fetchWorkerLocations]);

  // --- WORKER LOCATION MARKERS ---

  // Render / update / remove HTML markers whenever worker locations data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Track which worker IDs are currently displayed so we can remove stale ones
    const existingIds = new Set(workerLocationMarkersRef.current.keys());

    workerLocations.forEach(loc => {
      const worker = workers.find(w => w.contractorId === loc.worker_id);
      if (!worker) return;

      const initials = `${worker.firstName.charAt(0)}${worker.lastName.charAt(0)}`.toUpperCase();
      const fullName = `${worker.firstName} ${worker.lastName}`;
      const borderColor = getStalenessColor(loc.updated_at);

      const existing = workerLocationMarkersRef.current.get(loc.worker_id);
      if (existing) {
        // Update position and border color in-place — no flicker
        existing.setLngLat([loc.lng, loc.lat]);
        const el = existing.getElement();
        el.style.borderColor = borderColor;
        el.title = fullName;
        existingIds.delete(loc.worker_id);
      } else {
        // Create new marker
        const el = createWorkerMarkerEl(initials, borderColor, fullName);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
        workerLocationMarkersRef.current.set(loc.worker_id, marker);
      }
    });

    // Remove markers for workers no longer in the fetched data
    existingIds.forEach(id => {
      workerLocationMarkersRef.current.get(id)?.remove();
      workerLocationMarkersRef.current.delete(id);
    });
  }, [workerLocations, mapLoaded, workers]);

  // Load route geometry
  useEffect(() => {
    if(!myRouteCodes.length){setRouteMapData([]);setRoutesLoading(false);routeDataLoadedRef.current=false;prevRouteCodesKeyRef.current='';return;}
    const key=[...myRouteCodes].sort().join(',');
    if(key===prevRouteCodesKeyRef.current&&routeDataLoadedRef.current) return;
    prevRouteCodesKeyRef.current=key;
    let cancelled=false;
    (async()=>{
      setRoutesLoading(true);
      try{
        const{data,error}=await supabase.from('route_maps').select('*').in('route_code',myRouteCodes).eq('status','approved');
        if(cancelled) return; if(error){console.error(error);return;}
        setRouteMapData((data||[]) as SavedRoute[]); routeDataLoadedRef.current=true;
      }catch(e){if(!cancelled)console.error(e);}
      finally{if(!cancelled)setRoutesLoading(false);}
    })();
    return()=>{cancelled=true;};
  }, [myRouteCodes]);

  // Draw routes
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    loadedIdsRef.current.forEach(id=>{
      if(id.startsWith('num-')){const rid=id.replace('num-','');if(map.getLayer(`rm-num-${rid}`))map.removeLayer(`rm-num-${rid}`);if(map.getSource(`rm-num-src-${rid}`))map.removeSource(`rm-num-src-${rid}`);}
      else{if(map.getLayer(`rm-line-${id}`))map.removeLayer(`rm-line-${id}`);if(map.getSource(`rm-src-${id}`))map.removeSource(`rm-src-${id}`);}
    });
    loadedIdsRef.current=[];
    const before=(map.getLayer('road-label')?'road-label':map.getStyle().layers?.find((l:any)=>l.type==='symbol')?.id)??undefined;
    const allCoords:[number,number][]=[];
    routeMapData.forEach(route=>{
      if(!route.segments?.length) return;
      const srcId=`rm-src-${route.id}`, lineId=`rm-line-${route.id}`;
      loadedIdsRef.current.push(route.id);
      const features:GeoJSON.Feature[]=route.segments.map(seg=>({type:'Feature',properties:{route_code:route.route_code,color:route.route_color},geometry:{type:'LineString',coordinates:seg.coordinates}}));
      features.forEach(f=>allCoords.push(...((f.geometry as GeoJSON.LineString).coordinates as [number,number][])));
      map.addSource(srcId,{type:'geojson',data:{type:'FeatureCollection',features}});
      map.addLayer({id:lineId,type:'line',source:srcId,minzoom:0,maxzoom:24,paint:{'line-color':route.route_color,'line-width':7,'line-opacity':0.75},layout:{'line-cap':'round','line-join':'round'}},before);
      const rc:[number,number][]=[];route.segments.forEach(s=>s.coordinates.forEach(c=>rc.push(c)));if(!rc.length) return;
      const cLng=rc.reduce((s,c)=>s+c[0],0)/rc.length, cLat=rc.reduce((s,c)=>s+c[1],0)/rc.length;
      const nSrc=`rm-num-src-${route.id}`, nLbl=`rm-num-${route.id}`;
      loadedIdsRef.current.push(`num-${route.id}`);
      map.addSource(nSrc,{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{num:String(route.route_number),color:route.route_color,route_code:route.route_code},geometry:{type:'Point',coordinates:[cLng,cLat]}}]}});
      map.addLayer({id:nLbl,type:'symbol',source:nSrc,layout:{'text-field':['get','num'],'text-font':['DIN Pro Bold','Arial Unicode MS Bold'],'text-size':28,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':['get','color'],'text-halo-color':'rgba(255,255,255,0.85)','text-halo-width':2}});
    });
    if(allCoords.length&&!initialFitDoneRef.current){
      initialFitDoneRef.current=true;
      setTimeout(()=>{if(!mapRef.current) return; const b=allCoords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(allCoords[0],allCoords[0]));mapRef.current.fitBounds(b,{padding:80,maxZoom:15,duration:800});},300);
    }
  }, [routeMapData, mapLoaded]);

  // Worker name overlay
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const myRS=new Set(myRouteCodes);
    const features:GeoJSON.Feature[]=routeMapData.filter(r=>myRS.has(r.route_code)).map(route=>{
      const rc:[number,number][]=[];route.segments.forEach(s=>s.coordinates.forEach(c=>rc.push(c)));if(!rc.length) return null;
      const cLng=rc.reduce((s,c)=>s+c[0],0)/rc.length, cLat=rc.reduce((s,c)=>s+c[1],0)/rc.length;
      const rp=routes.find(r=>r.routeCode===route.route_code), aids=rp?.assignedWorkerIds||[];
      let label='';
      if(aids.length===1){const w=workers.find(wk=>wk.contractorId===aids[0]);if(w) label=`${w.firstName} ${w.lastName.charAt(0)}.`;}
      else if(aids.length>1){label=aids.map(id=>{const w=workers.find(wk=>wk.contractorId===id);return w?`${w.firstName.charAt(0)}${w.lastName.charAt(0)}`:''}).filter(Boolean).join(' ');}
      return{type:'Feature' as const,properties:{label,color:route.route_color},geometry:{type:'Point' as const,coordinates:[cLng,cLat]}};
    }).filter((f):f is GeoJSON.Feature=>f!==null);
    const gj:GeoJSON.FeatureCollection={type:'FeatureCollection',features};
    const src=map.getSource('rm-worker-overlay-src') as mapboxgl.GeoJSONSource;
    if(src){src.setData(gj);}
    else{
      map.addSource('rm-worker-overlay-src',{type:'geojson',data:gj});
      map.addLayer({id:'rm-worker-overlay',type:'symbol',source:'rm-worker-overlay-src',layout:{'text-field':['get','label'],'text-font':['DIN Pro Medium','Arial Unicode MS Regular'],'text-size':11,'text-offset':[0,2.3],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':['get','color'],'text-halo-color':'rgba(255,255,255,0.9)','text-halo-width':1.5}});
    }
  }, [routeMapData, routes, workers, mapLoaded, myRouteCodes]);

  // Route opacity
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    routeMapData.forEach(route=>{
      const lid=`rm-line-${route.id}`; if(!map.getLayer(lid)) return;
      if(sidebarMode==='routes'&&myRouteCodes.includes(route.route_code)){
        const rp=routes.find(r=>r.routeCode===route.route_code);
        map.setPaintProperty(lid,'line-opacity',rp?.assignedWorkerIds?.length?0.9:0.3);
      } else { map.setPaintProperty(lid,'line-opacity',0.75); }
    });
  }, [sidebarMode, routeMapData, routes, mapLoaded, myRouteCodes]);

  // Route click handlers (stable via refs)
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const cleanups:Array<()=>void>=[];
    routeMapData.forEach(route=>{
      if(!myRouteCodes.includes(route.route_code)) return;
      const enter=()=>{if(sidebarModeRef.current==='routes') map.getCanvas().style.cursor='pointer';};
      const leave=()=>{map.getCanvas().style.cursor='';};
      const click=(e:any)=>{
        if(sidebarModeRef.current!=='routes') return; e.preventDefault();
        const rc=route.route_code, cr=routesRef.current, cb=bookingsRef.current;
        const rp=cr.find(r=>r.routeCode===rc);
        const config=getSeasonConfig('aeration'); const rb=cb.filter(b=>b['Route Number']===rc);
        const totalEQ=rb.reduce((sum,b)=>{const ps=String(b.Price||'');for(const f of config.officeFlats){if(ps.startsWith(f.code)) return sum+f.value/EQ_DIVISOR;}const p=parseFloat(ps.replace(/[^0-9.]/g,''))||0;return p?sum+(p*(b.Prepaid==='x'?0.9:1.0))/1.05/EQ_DIVISOR:sum;},0);
        if(popupRef.current){popupRef.current.remove();popupRef.current=null;}
        setAssignModalData({routeCode:rc,routeColor:route.route_color,prebookCount:rb.length,prepayCount:rb.filter(b=>b.Prepaid==='x').length,totalEQ,currentWorkerIds:rp?.assignedWorkerIds||[]});
      };
      [`rm-line-${route.id}`,`rm-num-${route.id}`].forEach(lid=>{
        if(!map.getLayer(lid)) return;
        map.on('mouseenter',lid,enter);map.on('mouseleave',lid,leave);map.on('click',lid,click);
        cleanups.push(()=>{if(!map.getLayer(lid)) return;map.off('mouseenter',lid,enter);map.off('mouseleave',lid,leave);map.off('click',lid,click);});
      });
    });
    return()=>cleanups.forEach(fn=>fn());
  }, [routeMapData, mapLoaded, myRouteCodes]);

  // Update map pins (prebook/completed dots)
  const updateMapPins = useCallback((map:mapboxgl.Map, geocoded:GeocodedPin[]) => {
    if(pinClickHandlerRef.current){map.off('click','rm-pins-circles',pinClickHandlerRef.current);pinClickHandlerRef.current=null;}
    if(popupRef.current){popupRef.current.remove();popupRef.current=null;}
    const gj:GeoJSON.FeatureCollection={type:'FeatureCollection',features:geocoded.map(pin=>({type:'Feature' as const,properties:{name:pin.name,address:pin.address,routeCode:pin.routeCode,routeColor:pin.routeColor,status:pin.status,phone:pin.phone||'',email:pin.email||'',price:pin.price||'',paymentMethod:pin.paymentMethod||''},geometry:{type:'Point' as const,coordinates:[pin.lng,pin.lat]}}))};
    const src=map.getSource('rm-pins-src') as mapboxgl.GeoJSONSource;
    if(src){src.setData(gj);}
    else{
      map.addSource('rm-pins-src',{type:'geojson',data:gj});
      map.addLayer({id:'rm-pins-circles',type:'circle',source:'rm-pins-src',paint:{'circle-color':['get','routeColor'],'circle-radius':5,'circle-stroke-color':['match',['get','status'],'completed','#22c55e','new_sale','#eab308','#000000'],'circle-stroke-width':2.5,'circle-opacity':0.95}});
      map.on('mouseenter','rm-pins-circles',()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave','rm-pins-circles',()=>{map.getCanvas().style.cursor='';});
    }
    const clickHandler=(e:any)=>{
      const f=e.features?.[0]; if(!f) return;
      const{name,address,routeCode,routeColor,status,phone,email,price,paymentMethod}=f.properties;
      const coords=(f.geometry as GeoJSON.Point).coordinates as [number,number];
      if(popupRef.current) popupRef.current.remove();
      const sl=status==='completed'?'✅ Done':status==='new_sale'?'🆕 Sale':'⏳ Pending';
      const sc=status==='completed'?'#22c55e':status==='new_sale'?'#eab308':'#9ca3af';
      const sn=esc(name),sa=esc(address),sp=esc(phone),se=esc(email),spr=esc(price),sm=esc(paymentMethod),src2=esc(routeCode);
      const pRow=sp?`<div style="margin-top:5px;"><a href="tel:${sp}" style="color:#60a5fa;font-size:12px;text-decoration:none;">📞 ${sp}</a></div>`:'';
      const eRow=se?`<div style="color:#9ca3af;font-size:11px;margin-top:2px;">✉️ ${se}</div>`:'';
      const prTag=spr?`<span style="background:#16a34a22;color:#4ade80;border:1px solid #16a34a66;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${spr}</span>`:'';
      const mTag=sm?`<span style="background:#37415122;color:#9ca3af;border:1px solid #37415166;border-radius:4px;padding:2px 7px;font-size:11px;">${sm}</span>`:'';
      popupRef.current=new mapboxgl.Popup({offset:12,closeButton:true}).setLngLat(coords).setHTML(`<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:190px;line-height:1.4;"><div style="font-weight:700;margin-bottom:3px;">${sn}</div><div style="color:#555;font-size:11px;">${sa}</div>${pRow}${eRow}<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;"><span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${src2}</span><span style="color:${sc};font-size:11px;font-weight:600;">${sl}</span>${prTag}${mTag}</div></div>`).addTo(map);
    };
    pinClickHandlerRef.current=clickHandler;
    map.on('click','rm-pins-circles',clickHandler);
  }, []);

  // Geocode and render prebook/completed pins
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const batch=++geocodeBatchRef.current, curIds=new Set(pins.map(p=>p.id)), toGeo:PinData[]=[];
    pins.forEach(pin=>{
      const ac=geocodeCache.get(makeCacheKey(pin.address)), ic=jobIdCache.get(pin.id), cached=ac||ic;
      if(cached){if(!ac)geocodeCache.set(makeCacheKey(pin.address),cached);if(!ic)jobIdCache.set(pin.id,cached);knownPinsRef.current.set(pin.id,{...pin,lat:cached.lat,lng:cached.lng,routeColor:routeColorMap.get(pin.routeCode)||'#888888'});}
      else toGeo.push(pin);
    });
    knownPinsRef.current.forEach((ep,id)=>{if(!curIds.has(id)&&ep.status==='pending') knownPinsRef.current.set(id,{...ep,status:'completed'});});
    const snap=Array.from(knownPinsRef.current.values());updateMapPins(map,snap);setGeocodedPins(snap);
    if(!toGeo.length){setGeocodingProgress(null);return;}
    setGeocodingProgress({current:0,total:toGeo.length});
    (async()=>{
      for(let i=0;i<toGeo.length;i++){
        if(geocodeBatchRef.current!==batch||!mountedRef.current) return;
        const pin=toGeo[i], coord=await geocodeAddress(pin.address,routeCentroid?.lat,routeCentroid?.lng);
        if(coord){geocodeCache.set(makeCacheKey(pin.address),coord);jobIdCache.set(pin.id,coord);knownPinsRef.current.set(pin.id,{...pin,lat:coord.lat,lng:coord.lng,routeColor:routeColorMap.get(pin.routeCode)||'#888888'});}
        if(geocodeBatchRef.current!==batch||!mountedRef.current) return;
        setGeocodingProgress({current:i+1,total:toGeo.length});
        if(i<toGeo.length-1) await new Promise(r=>setTimeout(r,80));
      }
      if(geocodeBatchRef.current!==batch||!mountedRef.current) return;
      const fp=Array.from(knownPinsRef.current.values());setGeocodedPins(fp);updateMapPins(map,fp);setGeocodingProgress(null);
    })();
  }, [pins, routeMapData, mapLoaded, routeColorMap, routeCentroid, updateMapPins]);

  // --- NEW EFFECT: Pulsing dot on each contractor's most recent completion ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove old pulsing markers
    pulsingMarkersRef.current.forEach(m => m.remove());
    pulsingMarkersRef.current = [];

    mostRecentCompletionPins.forEach(pin => {
      const color = pin.routeColor || '#22c55e';
      const el = createPulsingRing(color);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      pulsingMarkersRef.current.push(marker);
    });

    return () => {
      pulsingMarkersRef.current.forEach(m => m.remove());
      pulsingMarkersRef.current = [];
    };
  }, [mostRecentCompletionPins, mapLoaded]);

  // GPS (RM's own location) — MODIFIED to include on-route detection
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!navigator.geolocation) return;
    if(!navArrowElRef.current) navArrowElRef.current=createNavArrow();
    navMarkerRef.current=new mapboxgl.Marker({element:navArrowElRef.current}).setLngLat([0,0]).addTo(map);
    watchIdRef.current=navigator.geolocation.watchPosition(pos=>{
      if(!navMarkerRef.current||!mapRef.current) return;
      const{latitude:lat,longitude:lng,heading}=pos.coords;
      console.log(`[GPS] Fix: ${lat.toFixed(5)},${lng.toFixed(5)} accuracy=${pos.coords.accuracy?.toFixed(0)}m follow=${centerOnLocationRef.current}`);
      navMarkerRef.current.setLngLat([lng,lat]);
      if(heading!=null&&!isNaN(heading)&&navArrowElRef.current) navArrowElRef.current.style.transform=`rotate(${heading}deg)`;
      if(centerOnLocationRef.current) mapRef.current.easeTo({center:[lng,lat],duration:1000});

      // --- On-route detection (only when follow-me is ON) ---
      if (centerOnLocationRef.current) {
        const rmd = routeMapDataRef.current;
        const rts = routesRef.current;
        const wcd = workerCardDataRef.current;
        const nearest = findNearestAssignedRoute(lat, lng, rmd, rts, managerId, 100);
        const card = nearest ? wcd.find(c => c.worker.contractorId === nearest.workerId) : null;
        console.log(`[OnRoute] pos=${lat.toFixed(5)},${lng.toFixed(5)} routeMapData=${rmd.length} routes=${rts.length} cards=${wcd.length}`, nearest ? `HIT route=${nearest.routeCode} worker=${nearest.workerId} cardFound=${!!card}` : 'NO_MATCH');
        if (nearest) {
          if (onRouteWorkerIdRef.current !== nearest.workerId) {
            onRouteWorkerIdRef.current = nearest.workerId;
            const card = workerCardDataRef.current.find(c => c.worker.contractorId === nearest.workerId);
            setOnRouteWorkerCard(card || null);
          }
        } else {
          if (onRouteWorkerIdRef.current !== null) {
            onRouteWorkerIdRef.current = null;
            setOnRouteWorkerCard(null);
          }
        }
      } else if (onRouteWorkerIdRef.current !== null) {
        // Follow-me turned off mid-watch — clear on-route state
        onRouteWorkerIdRef.current = null;
        setOnRouteWorkerCard(null);
      }
    },err=>{
      // Code 1=DENIED, 2=UNAVAILABLE, 3=TIMEOUT
      if(err.code===3) console.log('[GPS] Timeout — retrying (normal on mobile)');
      else console.warn('GPS error:',err.code,err.message);
    },{enableHighAccuracy:true,maximumAge:15000,timeout:30000});
    return()=>{if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}navMarkerRef.current?.remove();navMarkerRef.current=null;};
  }, [mapLoaded]);

  useEffect(()=>{centerOnLocationRef.current=centerOnLocation;},[centerOnLocation]);

  // MODIFIED: Also clears on-route state when follow-me is turned off
  const handleToggleCenter=useCallback(()=>{
    setCenterOnLocation(prev=>{const nv=!prev;centerOnLocationRef.current=nv;
      if(nv&&navMarkerRef.current&&mapRef.current){const ll=navMarkerRef.current.getLngLat();if(ll.lng!==0||ll.lat!==0) mapRef.current.easeTo({center:[ll.lng,ll.lat],duration:800});}
      if(!nv){ onRouteWorkerIdRef.current=null; setOnRouteWorkerCard(null); }
      return nv;});
  },[]);

  // Map init
  useEffect(() => {
    mountedRef.current=true;
    if(!mapContainerRef.current||mapRef.current) return;
    const map=new mapboxgl.Map({container:mapContainerRef.current,style:'mapbox://styles/mapbox/streets-v12',center:[-79.870,43.320],zoom:13});
    map.addControl(new mapboxgl.NavigationControl(),'top-right');
    map.on('load',()=>{
      map.resize();
      const xh=['poi-label','housenum-label','road-number-shield'];
      xh.forEach(id=>{if(map.getLayer(id)) map.setLayoutProperty(id,'visibility','none');});
      map.getStyle().layers?.forEach((layer:any)=>{
        const id=layer.id.toLowerCase();
        if(layer.type==='fill'||layer.type==='fill-extrusion'){if(id.includes('building')||id.includes('structure')) map.setLayoutProperty(layer.id,'visibility','none');}
        if(layer.type!=='symbol') return;
        const ihn=id.includes('housenum')||id.includes('house-num')||id.includes('house_num')||id.includes('address')||id.includes('housenumber');
        const tf=JSON.stringify(layer.layout?.['text-field']??'');
        const fhn=tf.includes('housenumber')||tf.includes('house_num')||tf.includes('addr')||tf.includes('ref');
        const inrl=!id.includes('label')&&!id.includes('shield')&&!id.includes('motorway')&&!id.includes('road')&&!id.includes('street');
        if(ihn||fhn||inrl) map.setLayoutProperty(layer.id,'visibility','none');
      });
      const rll=map.getStyle().layers?.filter((l:any)=>l.type==='symbol'&&l.id.toLowerCase().includes('label')&&!xh.includes(l.id))??[];
      rll.forEach((layer:any)=>{
        try{map.setLayerZoomRange(layer.id,0,24);map.setLayoutProperty(layer.id,'text-allow-overlap',false);map.setLayoutProperty(layer.id,'text-ignore-placement',false);map.setLayoutProperty(layer.id,'text-size',13);map.setLayoutProperty(layer.id,'text-font',['DIN Pro Bold','Arial Unicode MS Bold']);map.setPaintProperty(layer.id,'text-color','#111111');map.setPaintProperty(layer.id,'text-halo-color','#ffffff');map.setPaintProperty(layer.id,'text-halo-width',2);}catch{}
        const bid=`${layer.id}-point-backup`; if(map.getLayer(bid)) return;
        try{map.addLayer({id:bid,type:'symbol',source:(layer as any).source??'composite','source-layer':(layer as any)['source-layer']??'road',...((layer as any).filter?{filter:(layer as any).filter}:{}),minzoom:0,maxzoom:24,layout:{...(layer.layout??{}),'symbol-placement':'point','text-optional':true,'text-allow-overlap':false,'text-ignore-placement':false,'text-padding':5,'text-size':11,'text-font':['DIN Pro Medium','Arial Unicode MS Regular']},paint:{...(layer.paint??{}),'text-color':'#111111','text-halo-color':'#ffffff','text-halo-width':2}});}catch{}
      });
      map.on('idle',suppressDuplicateLabels);
      setMapLoaded(true);
    });
    mapRef.current=map;
    return()=>{
      mountedRef.current=false;initialFitDoneRef.current=false;routeDataLoadedRef.current=false;prevRouteCodesKeyRef.current='';
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
      if(popupRef.current){popupRef.current.remove();popupRef.current=null;}
      // Remove pulsing marker
      pulsingMarkersRef.current.forEach(m => m.remove());pulsingMarkersRef.current=[];
      // Remove all worker location markers
      workerLocationMarkersRef.current.forEach(m => m.remove());
      workerLocationMarkersRef.current.clear();
      map.remove();mapRef.current=null;setMapLoaded(false);
    };
  }, [suppressDuplicateLabels]);

  const handleViewLogsheet=(worker:Worker)=>{
    setStorageItem('rm_original_user',currentUser);setStorageItem('rm_view_mode',true);setStorageItem('rm_view_cart_names',null);setStorageItem('current_user',worker);navigate('/logsheet');
  };

  const handleAssignRoute=async(workerId:string|null)=>{
    if(!assignModalData) return; setAssignLoading(true);
    try{
      const{routeCode}=assignModalData;
      if(workerId===null){
        await sessionService.assignRouteToWorkers(routeCode,[]);
        const rb=bookings.filter(b=>b['Route Number']===routeCode&&b.Status!=='completed'&&b.Completed!=='x');
        await Promise.all(rb.map(b=>sessionService.assignBookingToWorker(b['Booking ID'],null)));
      } else {
        await sessionService.assignRouteToWorkers(routeCode,[workerId]);
        const rb=bookings.filter(b=>b['Route Number']===routeCode&&b.Status!=='completed'&&b.Completed!=='x');
        await Promise.all(rb.map(b=>sessionService.assignBookingToWorker(b['Booking ID'],workerId)));
      }
      setAssignModalData(null); onRefresh();
    }catch(e){console.error(e);}
    finally{setAssignLoading(false);}
  };

  const selectedRouteBookings=useMemo(()=>selectedRouteForBookings?bookings.filter(b=>b['Route Number']===selectedRouteForBookings):[], [selectedRouteForBookings,bookings]);
  const selectedRouteFinancialStore=useMemo(()=>selectedRouteForBookings?allSessions.flatMap(s=>(s.financialStore||[]).filter((tx:any)=>tx.routeCode===selectedRouteForBookings)):[], [selectedRouteForBookings,allSessions]);
  const pendingCount=geocodedPins.filter(p=>p.status==='pending').length;
  const completedCount=geocodedPins.filter(p=>p.status==='completed').length;
  const newSaleCount=geocodedPins.filter(p=>p.status==='new_sale').length;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={mapContainerRef} className="flex-1" />

      {/* Follow-me button */}
      <button onClick={handleToggleCenter}
        style={{left:sidebarOpen?'calc(20% + 8px)':'28px'}}
        className={`absolute top-3 z-20 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${centerOnLocation?'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-900':'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
        title={centerOnLocation?'Stop following':'Follow my location'}>
        <Navigation size={18} className={centerOnLocation?'fill-current':''} />
      </button>

      {/* Sidebar (aeration only) */}
      {isAerationSeason && (
        <div className="absolute left-0 top-0 bottom-0 z-20 transition-all duration-300" style={{width:sidebarOpen?'20%':'20px'}}>
          <div className="absolute left-0 top-0 bottom-0 bg-gray-900/95 backdrop-blur-sm transition-all duration-300 overflow-hidden" style={{width:sidebarOpen?'calc(100% - 20px)':'0px'}}>
            {sidebarOpen && (
              <div className="h-full flex flex-col">
                <div className="p-2 border-b border-gray-700 flex-shrink-0 bg-gray-800/80">
                  <div className="flex gap-1 bg-gray-900/60 rounded-lg p-0.5">
                    <button onClick={()=>setSidebarMode('staff')} className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-bold transition-all ${sidebarMode==='staff'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                      <Users size={10}/> Staff
                    </button>
                    <button onClick={()=>setSidebarMode('routes')} className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-bold transition-all ${sidebarMode==='routes'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                      <LayoutList size={10}/> Routes
                    </button>
                  </div>
                </div>
                {sidebarMode==='staff' && (
                  <div className="px-2 pt-1.5 pb-1 border-b border-gray-800 flex-shrink-0">
                    <select value={sortBy} onChange={e=>setSortBy(e.target.value as SortOption)} className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[10px] text-white focus:outline-none">
                      <option value="recent">Most Recent</option>
                      <option value="alpha">A–Z</option>
                      <option value="steps">Highest Steps</option>
                      <option value="equiv">Highest EQ</option>
                      <option value="upGross">Highest Upsell</option>
                    </select>
                  </div>
                )}
                {sidebarMode==='routes' && (
                  <div className="px-2 pt-1.5 pb-1 border-b border-gray-800 flex-shrink-0">
                    <p className="text-[8px] text-gray-600 text-center italic">Card → jobs · Route on map → assign</p>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-2" style={{scrollbarWidth:'thin'}}>
                  {sidebarMode==='staff' && (
                    sortedWorkerCards.length===0
                      ? <div className="text-center text-gray-500 text-xs py-6 italic">No workers found.</div>
                      : sortedWorkerCards.map(card => (
                          <div key={card.worker.contractorId} className="bg-gray-800 border border-gray-700 rounded-lg p-2 mb-1.5 hover:border-blue-500 transition-all">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${card.stats.pending>0?'bg-yellow-500 animate-pulse':'bg-green-500'}`}/>
                                <div className="flex flex-col min-w-0">
                                  <span className="font-bold text-white text-xs truncate cursor-pointer hover:text-blue-300" onClick={()=>setSelectedWorkerForModal(card)}>
                                    {card.worker.firstName} {card.worker.lastName}
                                  </span>
                                  <span className="text-[9px] text-gray-500 font-mono">#{card.worker.contractorId}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={()=>handleViewLogsheet(card.worker)} className="p-1 rounded hover:bg-gray-700 text-cyan-400 hover:text-cyan-300" title="View logsheet"><Eye size={11}/></button>
                                {card.worker.cellPhone && <a href={`tel:${card.worker.cellPhone}`} onClick={e=>e.stopPropagation()} className="p-1 rounded hover:bg-gray-700 text-green-400 hover:text-green-300" title={card.worker.cellPhone}><Phone size={11}/></a>}
                              </div>
                            </div>
                            {card.assignedRoutes.length>0 && (
                              <div className="flex flex-wrap gap-0.5 mb-1.5 pl-3">
                                {card.assignedRoutes.slice(0,4).map((route,idx)=>{const color=routeColorMap.get(route)||'#6b7280';return(<span key={idx} style={{backgroundColor:`${color}22`,color,borderColor:`${color}88`}} className="px-1 py-0.5 rounded text-[8px] font-bold border font-mono">{route}</span>);})}
                                {card.assignedRoutes.length>4 && <span className="px-1 py-0.5 rounded text-[8px] bg-gray-700 text-gray-400">+{card.assignedRoutes.length-4}</span>}
                              </div>
                            )}
                            <div className="grid grid-cols-4 gap-0.5 text-center bg-gray-900/50 rounded p-1 cursor-pointer" onClick={()=>setSelectedWorkerForModal(card)}>
                              {[['Steps',card.stats.steps,'text-white'],['Pend',card.stats.pending,'text-yellow-400'],['EQ',card.stats.eq.toFixed(1),'text-blue-300'],['Up',card.stats.upsellCount,'text-purple-400']].map(([l,v,c])=>(
                                <div key={l as string}><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">{l}</div><div className={`text-[10px] font-bold ${c}`}>{v}</div></div>
                              ))}
                            </div>
                          </div>
                        ))
                  )}
                  {sidebarMode==='routes' && (
                    routeCardData.length===0
                      ? <div className="text-center text-gray-500 text-xs py-6 italic">No routes found.</div>
                      : routeCardData.map(card => (
                          <div key={card.routeCode} onClick={()=>setSelectedRouteForBookings(card.routeCode)} style={{borderColor:`${card.routeColor}66`,backgroundColor:`${card.routeColor}12`}} className={`rounded-lg p-2 mb-1.5 border cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all ${!card.isAssigned?'opacity-50':''}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span style={{color:card.routeColor}} className="font-mono font-black text-base leading-none flex-shrink-0">{card.routeCode}</span>
                                {card.assignedWorkerLabel?<span className="text-[10px] text-white font-medium truncate">{card.assignedWorkerLabel}</span>:<span className="text-[9px] text-gray-500 italic">Unassigned</span>}
                              </div>
                              <span style={{color:card.routeColor}} className="text-xs font-bold font-mono flex-shrink-0">{card.totalEQ.toFixed(1)} EQ</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[9px] text-gray-400">{card.prebookCount} jobs</span>
                              {card.prepayCount>0 && <span className="text-[9px] text-green-400 font-bold">{card.prepayCount} prepaid</span>}
                            </div>
                          </div>
                        ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={()=>setSidebarOpen(p=>!p)} className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-12 bg-gray-800/90 border border-gray-600 rounded-r-md flex items-center justify-center hover:bg-gray-700 transition-colors cursor-pointer shadow-md">
            {sidebarOpen?<ChevronLeft size={12} className="text-gray-300"/>:<ChevronRight size={12} className="text-gray-300"/>}
          </button>
        </div>
      )}

      {/* Status overlays */}
      {geocodingProgress && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm"><Loader size={12} className="animate-spin text-blue-400"/>Geocoding {geocodingProgress.current}/{geocodingProgress.total}…</div>}
      {routesLoading&&!geocodingProgress && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm"><Loader size={12} className="animate-spin text-blue-400"/>Loading routes…</div>}
      {!routesLoading&&!routeMapData.length&&myRouteCodes.length>0&&mapLoaded&&!geocodingProgress && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 text-yellow-300 px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">No map data for your routes</div>}

      {/* Pin legend + worker dot staleness legend */}
      {!geocodingProgress && !sidebarOpen && (geocodedPins.length > 0 || workerLocations.length > 0) && (
        <div className="absolute bottom-6 left-3 z-20 bg-gray-900/90 text-white px-3 py-2 rounded-lg shadow-lg text-[10px] space-y-1 backdrop-blur-sm">
          {pendingCount>0&&<div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-black inline-block flex-shrink-0"/>Pending ({pendingCount})</div>}
          {completedCount>0&&<div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-green-500 inline-block flex-shrink-0"/>Completed ({completedCount})</div>}
          {newSaleCount>0&&<div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-400 border-2 border-yellow-500 inline-block flex-shrink-0"/>New Sale ({newSaleCount})</div>}
          {workerLocations.length > 0 && (
            <>
              {(pendingCount > 0 || completedCount > 0 || newSaleCount > 0) && <div className="border-t border-gray-700 my-1" />}
              <div className="text-gray-500 text-[9px] uppercase tracking-wider mb-0.5">Workers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-300 border-2 border-green-500 inline-block flex-shrink-0"/>≤ 10 min</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-300 border-2 border-yellow-500 inline-block flex-shrink-0"/>≤ 1 hr</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-300 border-2 border-orange-500 inline-block flex-shrink-0"/>≤ 2 hr</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-300 border-2 border-red-500 inline-block flex-shrink-0"/>2+ hr</div>
            </>
          )}
        </div>
      )}

      {!mapLoaded && <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10"><Loader size={24} className="animate-spin text-blue-500"/></div>}

      {/* --- NEW: On-route contractor button (bottom right) --- */}
      {onRouteWorkerCard && (
        <button
          onClick={() => setSelectedWorkerForModal(onRouteWorkerCard)}
          className="absolute bottom-6 right-3 z-20 bg-gray-900/95 backdrop-blur-sm text-white rounded-lg shadow-2xl border border-gray-600 px-3 py-2.5 flex items-center gap-3 hover:border-blue-500 active:scale-[0.97] transition-all max-w-[280px]"
        >
          {/* Red flag icon — shown on far left if any flag triggered */}
          {onRouteRedFlags.hasFlag && (
            <AlertTriangle size={20} className="text-red-500 flex-shrink-0 animate-pulse" />
          )}
          <div className="flex flex-col items-start min-w-0">
            <span className="font-bold text-sm leading-tight truncate w-full">
              {onRouteWorkerCard.worker.firstName} {onRouteWorkerCard.worker.lastName}
            </span>
            <div className="flex items-center gap-2 text-[10px] mt-0.5">
              <span className="text-gray-400">Steps: <span className="text-white font-bold">{onRouteWorkerCard.stats.steps}</span></span>
              <span className="text-gray-400">Pend: <span className="text-yellow-400 font-bold">{onRouteWorkerCard.stats.pending}</span></span>
              <span className="text-gray-400">EQ: <span className="text-blue-300 font-bold">{onRouteWorkerCard.stats.eq.toFixed(1)}</span></span>
              <span className="text-gray-400">Up: <span className="text-purple-400 font-bold">{onRouteWorkerCard.stats.upsellCount}</span></span>
            </div>
          </div>
        </button>
      )}

      {/* Worker jobs modal */}
      {selectedWorkerForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.75)'}} onClick={e=>{if(e.target===e.currentTarget) setSelectedWorkerForModal(null);}}>
          <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'80vh'}}>
            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-white">{selectedWorkerForModal.worker.firstName} {selectedWorkerForModal.worker.lastName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">#{selectedWorkerForModal.worker.contractorId}{selectedWorkerForModal.assignedRoutes.length>0&&<span className="ml-2">· Routes: {selectedWorkerForModal.assignedRoutes.join(', ')}</span>}</p>
              </div>
              <button onClick={()=>setSelectedWorkerForModal(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
              <ContractorJobs bookings={selectedWorkerForModal.displayBookings} financialStore={selectedWorkerForModal.financialStore} onRefresh={()=>{}} seasonType="aeration"/>
            </div>
          </div>
        </div>
      )}

      {/* Route prebook popup */}
      {selectedRouteForBookings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.75)'}} onClick={e=>{if(e.target===e.currentTarget) setSelectedRouteForBookings(null);}}>
          <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'80vh'}}>
            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span style={{color:routeColorMap.get(selectedRouteForBookings)||'#6b7280'}} className="font-mono font-black text-xl">Route {selectedRouteForBookings}</span>
                <span className="text-white font-bold text-xs">{selectedRouteBookings.length} jobs</span>
                <span className="text-green-400 font-bold text-xs">{selectedRouteBookings.filter(b=>b.Prepaid==='x').length} prepaid</span>
              </div>
              <button onClick={()=>setSelectedRouteForBookings(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
              <ContractorJobs bookings={selectedRouteBookings} financialStore={selectedRouteFinancialStore} onRefresh={onRefresh} seasonType="aeration"/>
            </div>
          </div>
        </div>
      )}

      {/* Route assignment modal */}
      {assignModalData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.85)'}} onClick={e=>{if(e.target===e.currentTarget) setAssignModalData(null);}}>
          <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-2xl w-full max-w-md flex flex-col" style={{maxHeight:'80vh'}}>
            <div className="p-4 border-b border-gray-700 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <MapPin size={15} style={{color:assignModalData.routeColor}}/>
                  Assign Route <span style={{color:assignModalData.routeColor}} className="font-mono font-black">{assignModalData.routeCode}</span>
                </h3>
                <button onClick={()=>setAssignModalData(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={16}/></button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center bg-gray-800/60 rounded-lg p-2 border border-gray-700">
                {[['Prebooks',assignModalData.prebookCount,'text-white'],['Prepaid',assignModalData.prepayCount,'text-green-400'],['Total EQ',assignModalData.totalEQ.toFixed(2),'text-blue-300']].map(([l,v,c])=>(
                  <div key={l as string}><div className="text-[9px] text-gray-500 uppercase mb-0.5">{l}</div><div className={`text-sm font-bold ${c}`}>{v}</div></div>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1" style={{scrollbarWidth:'thin'}}>
              <button onClick={()=>handleAssignRoute(null)} disabled={assignLoading} className="w-full text-left px-3 py-2.5 text-red-400 hover:bg-red-900/10 rounded flex items-center gap-2 text-sm border border-transparent hover:border-red-900/30 transition-all">
                <AlertCircle size={14}/> Unassign Route
              </button>
              {workers.filter(w=>w.assignedManagerId===managerId).sort((a,b)=>a.firstName.localeCompare(b.firstName)).map(worker=>{
                const isSel=assignModalData.currentWorkerIds.includes(worker.contractorId);
                const wr=routes.filter(r=>r.managerId===managerId&&r.assignedWorkerIds?.includes(worker.contractorId)).map(r=>r.routeCode);
                return (
                  <button key={worker.contractorId} onClick={()=>handleAssignRoute(worker.contractorId)} disabled={assignLoading}
                    className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center justify-between gap-3 transition-colors ${isSel?'bg-blue-900/20 border border-blue-700/50 text-white':'text-gray-300 hover:bg-gray-800 border border-transparent'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${isSel?'bg-blue-600':'bg-gray-600'}`}>{worker.firstName.charAt(0)}{worker.lastName.charAt(0)}</div>
                      <div className="flex flex-col">
                        <span className="font-medium">{worker.firstName} {worker.lastName}</span>
                        {wr.length>0&&<span className="text-[10px] text-gray-500">Routes: {wr.join(', ')}</span>}
                      </div>
                    </div>
                    {isSel&&<span className="text-[9px] text-blue-400 font-bold">ASSIGNED</span>}
                  </button>
                );
              })}
            </div>
            {assignLoading&&<div className="p-3 border-t border-gray-700 flex items-center justify-center gap-2 text-gray-400 text-sm flex-shrink-0"><Loader size={14} className="animate-spin"/>Saving…</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default RMMapTab;