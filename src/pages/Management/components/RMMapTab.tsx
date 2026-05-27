// src/pages/Management/components/RMMapTab.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Loader, ChevronLeft, ChevronRight, X, Users, Eye, Phone, MapPin,
  AlertCircle, LayoutList, AlertTriangle, Truck, Bookmark, Shovel, Leaf,
  FileText, Check, ArrowRight, ArrowRightLeft, Shuffle, Trash2, UserPlus,
  UserMinus, Undo2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sessionService } from '../../../lib/sessionService';
import {
  getSeasonConfig,
  seasonHasTeams,
  getPrepaidWeight,
  commandCenterService,
  EQ_DIVISOR,
} from '../../../lib/commandCenterService';
import { setStorageItem } from '../../../lib/localStorage';
import {
  RouteData, MasterBooking, LogsheetSession, Worker, ManagementUser,
  HistoricalProperty, SeasonType, TeamCart, PendingSale, SEASON_CONFIGS,
} from '../../../types';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';
import ContractorJobs from './ContractorJobs';
import PendingJobModal from '../../../components/PendingJobModal';
import type { GeocodePhase, GeocodeProgress, FilterVisibility } from '../RMLogbook';

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
interface GeocodedHistorical extends HistoricalProperty { lat: number; lng: number; }

interface GeocodedPendingSale {
  id: string;
  lat: number;
  lng: number;
  booking: MasterBooking;
}

interface GeocodedPCLEntry {
  key: string;
  lat: number;
  lng: number;
}

interface WorkerLocation {
  worker_id: string;
  command_center_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}

interface RMMapTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  allSessions: LogsheetSession[];
  workers: Worker[];
  currentUser: ManagementUser;
  allManagers?: ManagementUser[];
  seasonType?: SeasonType;
  teamCarts?: TeamCart[];
  pendingSalesByManager?: PendingSale[];
  onRefresh: () => void;
  // NEW: lifted state from RMLogbook
  filterVisibility: FilterVisibility;
  geocodePhase: GeocodePhase;
  geocodeProgress: GeocodeProgress;
  onGeocodeProgress: (
    phase: GeocodePhase,
    layerKey: keyof GeocodeProgress | null,
    current: number,
    total: number,
    done: boolean,
  ) => void;
  centerOnLocation: boolean;
  onFollowMeAutoDisable: () => void;
  showManageTeamModal: boolean;
  onCloseManageTeamModal: () => void;
}

interface WorkerCardData {
  worker: Worker;
  displayBookings: MasterBooking[];
  financialStore: any[];
  assignedRoutes: string[];
  lastActiveTimestamp: string | null;
  lastActiveAddress: string | null;
  lastActiveTime: string | null;
  upsellsEnabled: boolean;
  stats: { steps: number; pending: number; eq: number; upsellCount: number; upsellGross: number; gross: number; };
}

interface CartCardData {
  sessionId: string;
  teamId: string;
  members: Worker[];
  sharedBookings: MasterBooking[];
  sharedFinancialStore: any[];
  assignedRoutes: string[];
  lastActiveTimestamp: string | null;
  lastActiveAddress: string | null;
  lastActiveTime: string | null;
  asphaltOwnedRows: PendingSale[];
  asphaltIncomingRows: PendingSale[];
  isRcCart: boolean;
  stats: {
    steps: number;
    pending: number;
    pendingSaleCount: number;
    eq: number;
    upsellCount: number;
    upsellGross: number;
    gross: number;
  };
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
const jobIdCache = new Map<string, { address: string; lat: number; lng: number }>();
const makeCacheKey = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ');
const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const RC_TEAM_PATTERN = /^RC\d*$/;
const isRcWorker = (teamId: string | null | undefined): boolean => {
  return !!teamId && RC_TEAM_PATTERN.test(teamId);
};

const formatAsphaltDollars = (n: number | undefined | null): string => {
  if (!n || n <= 0) return '$0';
  const rounded = Math.round(n * 100) / 100;
  if (rounded === Math.floor(rounded)) return `$${Math.floor(rounded)}`;
  return `$${rounded.toFixed(2)}`;
};

const assembleAddressFromPending = (ps: PendingSale): string => {
  const hn = (ps.houseNumber || '').trim();
  const sn = (ps.streetName || '').trim();
  if (hn && sn) return `${hn} ${sn}`;
  return hn || sn || '— address pending —';
};

const formatTimeShort = (timestamp: string): string => {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minutesStr}${ampm}`;
};

const convertPendingSaleToBooking = (ps: PendingSale): MasterBooking => {
  const fullAddress = `${ps.houseNumber || ''} ${ps.streetName || ''}`.trim();
  return {
    'Booking ID': ps.id,
    'First Name': '',
    'Last Name': '',
    'Full Address': fullAddress,
    'House Number': ps.houseNumber,
    'Street Name': ps.streetName,
    'Route Number': ps.routeCode,
    'Price': ps.price || '',
    'Log Sheet Notes': ps.notes,
    'FO/BO/FP': ps.propertyType as any,
    Status: 'pending',
    services: ps.services,
    isPendingSale: true,
    pendingSaleId: ps.id,
    asphaltAmount: ps.asphaltAmount,
    upsoldAsphaltAmount: ps.upsoldAsphaltAmount,
    saleType: ps.saleType,
    sharedJobKey: ps.sharedJobKey,
    assignedRcSessionId: ps.assignedRcSessionId,
  } as MasterBooking;
};

const mergePendingSalesForDisplay = (pendingSales: PendingSale[]): MasterBooking[] => {
  const allIds = new Set(pendingSales.map(ps => ps.id));
  const asphaltChildByParentId = new Map<string, PendingSale>();
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt' && ps.parentId) {
      asphaltChildByParentId.set(ps.parentId, ps);
    }
  }
  const result: MasterBooking[] = [];
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt') {
      if (ps.parentId && allIds.has(ps.parentId)) continue;
      result.push(convertPendingSaleToBooking(ps));
    } else {
      const booking = convertPendingSaleToBooking(ps);
      const child = asphaltChildByParentId.get(ps.id);
      if (child) {
        (booking as any).asphaltAmount = child.asphaltAmount;
        (booking as any).upsoldAsphaltAmount = child.upsoldAsphaltAmount;
        (booking as any).sharedJobKey = child.sharedJobKey;
        (booking as any).assignedRcSessionId = child.assignedRcSessionId;
      }
      result.push(booking);
    }
  }
  return result;
};

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

function getStalenessColor(updatedAt: string): string {
  const ageMin = (Date.now() - new Date(updatedAt).getTime()) / 60000;
  if (ageMin <= 10)  return '#22c55e';
  if (ageMin <= 60)  return '#eab308';
  if (ageMin <= 120) return '#f97316';
  return '#ef4444';
}

function createWorkerMarkerEl(initials: string, borderColor: string, label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'width:16px',
    'height:16px',
    'border-radius:50%',
    'background:#d1d5db',
    `border:2px solid ${borderColor}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:7px',
    'font-weight:700',
    'color:#374151',
    'font-family:system-ui,sans-serif',
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
    'cursor:default',
    'user-select:none',
  ].join(';');
  el.textContent = initials;
  el.title = label;
  return el;
}

function distToSegmentMeters(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const px = (lng - lng1) * mPerDegLng;
  const py = (lat - lat1) * mPerDegLat;
  const bx = (lng2 - lng1) * mPerDegLng;
  const by = (lat2 - lat1) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const cx = t * bx;
  const cy = t * by;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

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
    if (!rd.assignedWorkerIds || rd.assignedWorkerIds.length < 1) continue;
    const workerId = rd.assignedWorkerIds[0];

    for (const seg of rmd.segments || []) {
      const coords = seg.coordinates || [];
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const dist = distToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { routeCode: rmd.route_code, workerId, dist };
        }
      }
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

function computeRedFlags(financialStore: any[]): { hasFlag: boolean; flags: string[] } {
  const flags: string[] = [];
  const sales = financialStore.filter((tx: any) => tx.type === 'Sale');

  if (sales.length > 0) {
    const first5 = sales.slice(0, 5);
    const after5 = sales.slice(5);

    const first5Filled = first5.reduce((n: number, tx: any) => {
      if (tx.customerPhone?.trim()) n++;
      if (tx.customerEmail?.trim()) n++;
      return n;
    }, 0);
    if (first5Filled / (first5.length * 2) < 0.5) {
      flags.push('contacts_first5');
    }

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

function createPulsingRing(color: string): HTMLDivElement {
  let pulseStyle = document.getElementById('rm-pulse-keyframes') as HTMLStyleElement | null;
  if (!pulseStyle) {
    pulseStyle = document.createElement('style');
    pulseStyle.id = 'rm-pulse-keyframes';
    document.head.appendChild(pulseStyle);
  }
  pulseStyle.textContent = `@keyframes rmPulse{0%{transform:scale(1);opacity:.5}100%{transform:scale(2.5);opacity:0}}`;
  const el = document.createElement('div');
  el.style.cssText = 'width:0;height:0;overflow:visible;pointer-events:none;';
  el.innerHTML = `<div style="width:15px;height:15px;margin-left:-7.5px;margin-top:-7.5px;border-radius:50%;background:${color};animation:rmPulse 1.8s ease-out infinite;"></div>`;
  return el;
}

function createDashedRotatingRing(): HTMLDivElement {
  let spinStyle = document.getElementById('rm-spin-keyframes') as HTMLStyleElement | null;
  if (!spinStyle) {
    spinStyle = document.createElement('style');
    spinStyle.id = 'rm-spin-keyframes';
    document.head.appendChild(spinStyle);
  }
  spinStyle.textContent = `@keyframes rmDashedSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;
  const el = document.createElement('div');
  el.style.cssText = 'width:0;height:0;overflow:visible;pointer-events:auto;cursor:pointer;';
  el.innerHTML = `
    <div style="position:relative;width:12px;height:12px;margin-left:-6px;margin-top:-6px;">
      <svg width="12" height="12" viewBox="0 0 12 12" style="position:absolute;top:0;left:0;animation:rmDashedSpin 3s linear infinite;">
        <circle cx="6" cy="6" r="5" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="2.5,2" opacity="0.85"/>
      </svg>
      <div style="position:absolute;top:4px;left:4px;width:4px;height:4px;border-radius:50%;background:#6b7280;"></div>
    </div>
  `;
  return el;
}

const WORKER_LOCATION_POLL_MS = 5 * 60 * 1000;

// --- COMPONENT ---

const RMMapTab: React.FC<RMMapTabProps> = ({
  managerId,
  routes,
  bookings,
  allSessions,
  workers,
  currentUser,
  allManagers = [],
  seasonType = 'aeration',
  teamCarts = [],
  pendingSalesByManager = [],
  onRefresh,
  filterVisibility,
  geocodePhase,
  geocodeProgress,
  onGeocodeProgress,
  centerOnLocation,
  onFollowMeAutoDisable,
  showManageTeamModal,
  onCloseManageTeamModal,
}) => {
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
  const mountedRef = useRef(true);
  const centerOnLocationRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('staff');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedWorkerForModal, setSelectedWorkerForModal] = useState<WorkerCardData | null>(null);
  const [selectedCartForModal, setSelectedCartForModal] = useState<CartCardData | null>(null);
  const [selectedRouteForBookings, setSelectedRouteForBookings] = useState<string | null>(null);
  const [assignModalData, setAssignModalData] = useState<AssignModalData | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const sidebarModeRef = useRef<SidebarMode>('staff');
  const routesRef = useRef(routes);
  const bookingsRef = useRef(bookings);

  const [workerLocations, setWorkerLocations] = useState<WorkerLocation[]>([]);
  const workerLocationMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [onRouteWorkerCard, setOnRouteWorkerCard] = useState<WorkerCardData | null>(null);
  const [onRouteCartCard, setOnRouteCartCard] = useState<CartCardData | null>(null);
  const onRouteWorkerIdRef = useRef<string | null>(null);
  const onRouteCartIdRef = useRef<string | null>(null);
  const pulsingMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const routeMapDataRef = useRef<SavedRoute[]>([]);
  const workerCardDataRef = useRef<WorkerCardData[]>([]);
  const cartCardDataRef = useRef<CartCardData[]>([]);

  // Historical properties
  const [historicalProps, setHistoricalProps] = useState<HistoricalProperty[]>([]);
  const [geocodedHistorical, setGeocodedHistorical] = useState<GeocodedHistorical[]>([]);
  const knownHistoricalRef = useRef<Map<string, GeocodedHistorical>>(new Map());
  const [geocodeCacheHydrated, setGeocodeCacheHydrated] = useState(false);

  // Pending sales (geocoded for team seasons)
  const [geocodedPendingSales, setGeocodedPendingSales] = useState<GeocodedPendingSale[]>([]);
  const pendingSaleMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // PCL reference circles
  const [pclByRoute, setPclByRoute] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [geocodedPCL, setGeocodedPCL] = useState<GeocodedPCLEntry[]>([]);

  // Team-season cart data
  const [cartCardData, setCartCardData] = useState<CartCardData[]>([]);

  // EQ math fix
  const [taxRate, setTaxRate] = useState<number>(5);
  const [productCostPercent, setProductCostPercent] = useState<number>(0);

  // Routes-side overhaul
  const [pendingJobForModal, setPendingJobForModal] = useState<MasterBooking | null>(null);
  const [transferModalData, setTransferModalData] = useState<{
    type: 'ROUTE' | 'JOB';
    targetId: string;
    routeCode: string;
    title: string;
  } | null>(null);

  // Manage Team modal sub-state (modal itself controlled by parent prop)
  const [selectedWorkerToMove, setSelectedWorkerToMove] = useState<Worker | null>(null);
  const [selectedWorkerSourceCart, setSelectedWorkerSourceCart] = useState<CartCardData | null>(null);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignSuccess, setReassignSuccess] = useState<string | null>(null);
  const [reassignManagerId, setReassignManagerId] = useState('');

  const [unassigningAsphaltId, setUnassigningAsphaltId] = useState<string | null>(null);
  const [unassignError, setUnassignError] = useState<string | null>(null);

  // Reset Manage Team sub-state when modal closes
  useEffect(() => {
    if (!showManageTeamModal) {
      setSelectedWorkerToMove(null);
      setSelectedWorkerSourceCart(null);
      setReassignError(null);
      setReassignSuccess(null);
      setReassignManagerId('');
    }
  }, [showManageTeamModal]);

  useEffect(() => { sidebarModeRef.current = sidebarMode; }, [sidebarMode]);
  useEffect(() => { routesRef.current = routes; }, [routes]);
  useEffect(() => { bookingsRef.current = bookings; }, [bookings]);
  useEffect(() => { routeMapDataRef.current = routeMapData; }, [routeMapData]);
  useEffect(() => { cartCardDataRef.current = cartCardData; }, [cartCardData]);
  useEffect(() => { centerOnLocationRef.current = centerOnLocation; }, [centerOnLocation]);

  const isTeamSeason = useMemo(() => seasonHasTeams(seasonType), [seasonType]);
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isSealing = seasonType === 'sealing';

  const myRouteCodes = useMemo(() => routes.filter(r => r.managerId === managerId).map(r => r.routeCode), [routes, managerId]);
  const myTeamIds = useMemo(() => new Set(workers.filter(w => w.assignedManagerId === managerId).map(w => w.contractorId)), [workers, managerId]);
  const myTeamWorkers = useMemo(() => workers.filter(w => w.assignedManagerId === managerId), [workers, managerId]);
  const routeColorMap = useMemo(() => { const m = new Map<string,string>(); routeMapData.forEach(r => m.set(r.route_code, r.route_color)); return m; }, [routeMapData]);
  const availableManagers = useMemo(() => allManagers.filter(m => m.userId !== managerId && m.role === 'RouteManager'), [allManagers, managerId]);

  const workerLastActive = useMemo(() => {
    const m = new Map<string,string>();
    allSessions.forEach(s => (s.financialStore||[]).forEach((tx:any) => {
      if (!tx.timestamp || !tx.workerId) return;
      const ex = m.get(tx.workerId);
      if (!ex || tx.timestamp > ex) m.set(tx.workerId, tx.timestamp);
    }));
    return m;
  }, [allSessions]);

  // EQ math fix
  useEffect(() => {
    const loadRates = async () => {
      try {
        const currentTaxRate = commandCenterService.getCurrentTaxRate();
        setTaxRate(currentTaxRate);
        const prodCost = await sessionService.getProductCostPercent();
        setProductCostPercent(prodCost);
      } catch (err) {
        console.warn('RMMapTab: failed to load tax/product cost, using defaults', err);
      }
    };
    loadRates();
  }, [seasonType]);

  // Worker card data (aeration only)
  const workerCardData = useMemo<WorkerCardData[]>(() => {
    if (isTeamSeason) return [];
    return workers.filter(w => w.assignedManagerId === managerId).map(worker => {
      const session = allSessions.find(s => s.workerId === worker.contractorId);
      const st = session?.stats; const fs = session?.financialStore || [];
      const wb = bookings.filter(b => b['Contractor Number'] === worker.contractorId);
      const ar = Array.from(new Set(wb.map(b => b['Route Number']).filter((r):r is string => !!r && r.trim()!=='')));
      const pending = wb.filter(b => b.Completed!=='x' && b.Status!=='completed' && b.Status!=='cancelled' && b.Status!=='next_time').length;

      let lastAddr: string | null = null;
      let lastTimestamp: string | null = null;
      let lastTime: string | null = null;
      if (fs.length > 0) {
        const sorted = [...fs].sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        lastAddr = sorted[0].address;
        lastTimestamp = sorted[0].timestamp;
        lastTime = formatTimeShort(sorted[0].timestamp);
      }

      return {
        worker,
        displayBookings: wb,
        financialStore: fs,
        assignedRoutes: ar,
        lastActiveTimestamp: lastTimestamp,
        lastActiveAddress: lastAddr,
        lastActiveTime: lastTime,
        upsellsEnabled: (worker as any).upsellsEnabled !== false,
        stats: {
          steps: st?.stepCount||0,
          pending,
          eq: st?.totalEQ||0,
          upsellCount: st?.upsellCount||0,
          upsellGross: st?.upsellGross||0,
          gross: st?.upsellGross||0,
        }
      };
    });
  }, [workers, managerId, allSessions, bookings, isTeamSeason]);

  useEffect(() => { workerCardDataRef.current = workerCardData; }, [workerCardData]);

  useEffect(() => {
    if (!onRouteWorkerIdRef.current) return;
    const updated = workerCardData.find(c => c.worker.contractorId === onRouteWorkerIdRef.current);
    if (updated) setOnRouteWorkerCard(updated);
  }, [workerCardData]);

  // Cart card data
  useEffect(() => {
    if (!isTeamSeason) { setCartCardData([]); return; }
    let cancelled = false;

    (async () => {
      const workerMap = new Map(myTeamWorkers.map(w => [w.contractorId, w]));
      const mySessions = allSessions.filter(session => {
        const ids = session.teamWorkerIds || [session.workerId];
        return ids.some(id => myTeamIds.has(id));
      });

      const cartFetches = await Promise.all(
        mySessions.map(async (session) => {
          const sessionWorkerIds = (session.teamWorkerIds || [session.workerId]).filter(id => myTeamIds.has(id));
          const teamWorkers = sessionWorkerIds
            .map(id => workerMap.get(id))
            .filter(Boolean) as Worker[];

          let officeBookings: MasterBooking[] = [];
          let pendingSales: PendingSale[] = [];
          if (session.id) {
            try {
              const [bookingsRes, pendingSalesRes] = await Promise.all([
                sessionService.getSessionAssignments(session.id),
                sessionService.getPendingSalesForSession(session.id),
              ]);
              officeBookings = bookingsRes;
              pendingSales = pendingSalesRes;
            } catch (err) {
              console.warn('Failed to load cart data for session', session.id, err);
            }
          }

          return { session, sessionWorkerIds, teamWorkers, officeBookings, pendingSales };
        })
      );

      if (cancelled) return;

      const allTeamPendingSales = cartFetches.flatMap(c => c.pendingSales);

      const cardData: CartCardData[] = cartFetches.map(({ session, sessionWorkerIds, teamWorkers, officeBookings, pendingSales }) => {
        const sharedFinancialStore = session.financialStore || [];
        const stats = session.stats || sessionService.getEmptyStats();

        const mergedPendingBookings = mergePendingSalesForDisplay(pendingSales);
        const sharedBookings: MasterBooking[] = [...mergedPendingBookings, ...officeBookings];

        const asphaltOwnedRows = pendingSales.filter(ps => ps.saleType === 'asphalt');
        const asphaltIncomingRows = allTeamPendingSales.filter(ps =>
          ps.assignedRcSessionId === session.id && ps.saleType === 'asphalt'
        );
        const isRcCart = teamWorkers.some(w => isRcWorker(w.teamId));

        const pending = officeBookings.filter(b =>
          b.Completed !== 'x' &&
          b.Status !== 'completed' &&
          b.Status !== 'cancelled' &&
          b.Status !== 'next_time'
        );

        const uniqueRoutes = Array.from(new Set(
          officeBookings
            .map(b => b['Route Number'])
            .filter(r => r && r !== 'x' && r.trim() !== '')
        )) as string[];

        let lastAddr: string | null = null;
        let lastTimestamp: string | null = null;
        let lastTime: string | null = null;
        if (sharedFinancialStore.length > 0) {
          const sorted = [...sharedFinancialStore].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          lastAddr = sorted[0].address;
          lastTimestamp = sorted[0].timestamp;
          lastTime = formatTimeShort(sorted[0].timestamp);
        }

        return {
          sessionId: session.id,
          teamId: sessionWorkerIds[0] || session.workerId,
          members: teamWorkers,
          sharedBookings,
          sharedFinancialStore,
          assignedRoutes: uniqueRoutes,
          lastActiveTimestamp: lastTimestamp,
          lastActiveAddress: lastAddr,
          lastActiveTime: lastTime,
          asphaltOwnedRows,
          asphaltIncomingRows,
          isRcCart,
          stats: {
            steps: stats.stepCount,
            pending: pending.length,
            pendingSaleCount: mergedPendingBookings.length,
            eq: stats.totalEQ,
            upsellCount: stats.upsellCount,
            upsellGross: stats.upsellGross,
            gross: stats.upsellGross,
          },
        };
      });

      setCartCardData(cardData);
    })();

    return () => { cancelled = true; };
  }, [isTeamSeason, allSessions, myTeamWorkers, myTeamIds]);

  useEffect(() => {
    if (!selectedCartForModal) return;
    const updated = cartCardData.find(c => c.sessionId === selectedCartForModal.sessionId);
    if (updated) setSelectedCartForModal(updated);
  }, [cartCardData]);

  useEffect(() => {
    if (!onRouteCartIdRef.current) return;
    const updated = cartCardData.find(c => c.sessionId === onRouteCartIdRef.current);
    if (updated) setOnRouteCartCard(updated);
  }, [cartCardData]);

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

  const sortedCartCards = useMemo<CartCardData[]>(() => {
    const c = [...cartCardData];
    switch(sortBy) {
      case 'recent': return c.sort((a,b) => {
        if(!a.lastActiveTimestamp&&!b.lastActiveTimestamp) return 0;
        if(!a.lastActiveTimestamp) return 1;
        if(!b.lastActiveTimestamp) return -1;
        return b.lastActiveTimestamp.localeCompare(a.lastActiveTimestamp);
      });
      case 'alpha': return c.sort((a,b) => {
        const an = a.members[0]?.lastName || a.teamId;
        const bn = b.members[0]?.lastName || b.teamId;
        return an.localeCompare(bn);
      });
      case 'steps': return c.sort((a,b) => b.stats.steps-a.stats.steps);
      case 'equiv': return c.sort((a,b) => b.stats.eq-a.stats.eq);
      case 'upGross': return c.sort((a,b) => b.stats.upsellGross-a.stats.upsellGross);
      default: return c;
    }
  }, [cartCardData, sortBy]);

  const cartByWorkerId = useMemo(() => {
    const map = new Map<string, TeamCart>();
    teamCarts.forEach(cart => {
      cart.workerIds.forEach(wid => {
        map.set(wid, cart);
      });
    });
    return map;
  }, [teamCarts]);

  const contractorsByCart = useMemo(() => {
    if (!isTeamSeason) return null;
    const workerMap = new Map(myTeamWorkers.map(w => [w.contractorId, w]));
    const cartMap = new Map<string, Worker[]>();
    allSessions.forEach(session => {
      const sessionWorkerIds = (session.teamWorkerIds || [session.workerId])
        .filter(id => myTeamIds.has(id));
      if (sessionWorkerIds.length === 0) return;
      const sessionWorkers = sessionWorkerIds
        .map(id => workerMap.get(id))
        .filter(Boolean) as Worker[];
      if (sessionWorkers.length === 0) return;
      cartMap.set(session.workerId, sessionWorkers);
    });
    return cartMap;
  }, [isTeamSeason, allSessions, myTeamWorkers, myTeamIds]);

  const calculateBookingEQ = useCallback((booking: MasterBooking): number => {
    const priceStr = String(booking.Price || '');
    const config = getSeasonConfig(seasonType);

    for (const flat of config.officeFlats) {
      if (priceStr.startsWith(flat.code)) {
        return flat.value / EQ_DIVISOR;
      }
    }

    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
    if (price === 0) return 0;

    const isPrepaid = booking.Prepaid === 'x';
    const weight = isPrepaid ? getPrepaidWeight(seasonType) : 1.0;

    const taxDivisor = 1 + (taxRate / 100);
    const productCostMultiplier = 1 - (productCostPercent / 100);
    const eq = (price * weight * productCostMultiplier) / taxDivisor / EQ_DIVISOR;

    return eq;
  }, [seasonType, taxRate, productCostPercent]);

  const routeCardData = useMemo<RouteCardData[]>(() => {
    return routes.filter(r => r.managerId===managerId).map(r => {
      const rmi = routeMapData.find(rm => rm.route_code===r.routeCode);
      const routeColor = rmi?.route_color||'#6b7280';
      const assignedIds = r.assignedWorkerIds||[];
      let label = '';
      if (assignedIds.length===1) { const w=workers.find(wk=>wk.contractorId===assignedIds[0]); if(w) label=`${w.firstName} ${w.lastName.charAt(0)}.`; }
      else if (assignedIds.length>1) { label=assignedIds.map(id=>{const w=workers.find(wk=>wk.contractorId===id);return w?`${w.firstName.charAt(0)}${w.lastName.charAt(0)}`:''}).filter(Boolean).join(' '); }
      const rb = bookings.filter(b=>b['Route Number']===r.routeCode);
      const totalEQ = rb.reduce((sum, b) => sum + calculateBookingEQ(b), 0);
      return { routeCode:r.routeCode, routeColor, assignedWorkerIds:assignedIds, assignedWorkerLabel:label, prebookCount:rb.length, prepayCount:rb.filter(b=>b.Prepaid==='x').length, totalEQ, isAssigned:assignedIds.length>0 };
    }).sort((a,b)=>{ if(a.isAssigned!==b.isAssigned) return a.isAssigned?1:-1; return a.routeCode.localeCompare(b.routeCode); });
  }, [routes, managerId, routeMapData, workers, bookings, calculateBookingEQ]);

  // Split pins into pending-only and completed/new-sale-only — driven by the
  // new filter system. Each set is also visibility-gated separately downstream.
  const pendingBookingPinSource = useMemo<PinData[]>(() => {
    const result: PinData[] = [];
    const myRS = new Set(myRouteCodes);
    const done = new Set<string>();
    allSessions.forEach(s => {
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (tx.jobId) done.add(tx.jobId);
      });
    });
    bookings.forEach(b => {
      const rn = b['Route Number'];
      if (!rn || !myRS.has(rn)) return;
      if (done.has(b['Booking ID'])) return;
      const addr = b['Full Address'];
      if (!addr) return;
      result.push({
        id: b['Booking ID'],
        address: addr,
        routeCode: rn,
        name: `${b['First Name'] || ''} ${b['Last Name'] || ''}`.trim() || 'Unknown',
        status: 'pending',
        phone: (b['Cell Phone'] || b['Home Phone'] || '') as string,
        email: (b['Email Address'] || '') as string,
        price: b.Price ? String(b.Price) : '',
        paymentMethod: '',
      });
    });
    return result;
  }, [bookings, allSessions, myRouteCodes]);

  const completedAndNewSalePinSource = useMemo<PinData[]>(() => {
    const result: PinData[] = [];
    const myRS = new Set(myRouteCodes);
    allSessions.forEach(s => {
      const sids = s.teamWorkerIds || [s.workerId];
      const isMe = sids.some(wid => myTeamIds.has(wid));
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (!isMe && !(tx.routeCode && myRS.has(tx.routeCode))) return;
        const addr = tx.address || tx.itemDescription || '';
        if (!addr) return;
        result.push({
          id: tx.jobId || tx.id,
          address: addr,
          routeCode: tx.routeCode || '',
          name: tx.customerName || 'Unknown',
          status: tx.jobId?.startsWith('NEW-') ? 'new_sale' : 'completed',
          phone: tx.customerPhone || '',
          email: tx.customerEmail || '',
          price: tx.displayPrice || (tx.price ? `$${Number(tx.price).toFixed(2)}` : ''),
          paymentMethod: tx.paymentMethod || '',
        });
      });
    });
    return result;
  }, [allSessions, myRouteCodes, myTeamIds]);

  const routeCentroid = useMemo(() => {
    if(!routeMapData.length) return null;
    let sLat=0,sLng=0,n=0;
    routeMapData.forEach(r=>r.segments?.forEach(seg=>{if(!seg.coordinates?.length) return; const mi=Math.floor(seg.coordinates.length/2); const [lng,lat]=seg.coordinates[mi]; sLat+=lat;sLng+=lng;n++;}));
    return n?{lat:sLat/n,lng:sLng/n}:null;
  }, [routeMapData]);

  const mostRecentCompletionPins = useMemo<GeocodedPin[]>(() => {
    const latestByOwner = new Map<string, { jobId: string; timestamp: string }>();
    allSessions.forEach(s => {
      const ownerKey = isTeamSeason ? s.id : s.workerId;
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (!tx.timestamp || !tx.jobId) return;
        const existing = latestByOwner.get(ownerKey);
        if (!existing || tx.timestamp > existing.timestamp) {
          latestByOwner.set(ownerKey, { jobId: tx.jobId, timestamp: tx.timestamp });
        }
      });
    });

    const result: GeocodedPin[] = [];
    latestByOwner.forEach(({ jobId }) => {
      const pin = geocodedPins.find(p => p.id === jobId && (p.status === 'completed' || p.status === 'new_sale'));
      if (pin) result.push(pin);
    });
    return result;
  }, [allSessions, geocodedPins, isTeamSeason]);

  const onRouteRedFlags = useMemo(() => {
    if (onRouteCartCard) return computeRedFlags(onRouteCartCard.sharedFinancialStore);
    if (onRouteWorkerCard) return computeRedFlags(onRouteWorkerCard.financialStore);
    return { hasFlag: false, flags: [] as string[] };
  }, [onRouteCartCard, onRouteWorkerCard]);

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

  // Worker location fetch
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

  useEffect(() => {
    if (!mapLoaded) return;
    fetchWorkerLocations();
    const interval = setInterval(fetchWorkerLocations, WORKER_LOCATION_POLL_MS);
    return () => clearInterval(interval);
  }, [mapLoaded, fetchWorkerLocations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const existingIds = new Set(workerLocationMarkersRef.current.keys());

    workerLocations.forEach(loc => {
      const worker = workers.find(w => w.contractorId === loc.worker_id);
      if (!worker) return;

      const initials = `${worker.firstName.charAt(0)}${worker.lastName.charAt(0)}`.toUpperCase();
      const fullName = `${worker.firstName} ${worker.lastName}`;
      const borderColor = getStalenessColor(loc.updated_at);

      const existing = workerLocationMarkersRef.current.get(loc.worker_id);
      if (existing) {
        existing.setLngLat([loc.lng, loc.lat]);
        const el = existing.getElement();
        el.style.borderColor = borderColor;
        el.title = fullName;
        existingIds.delete(loc.worker_id);
      } else {
        const el = createWorkerMarkerEl(initials, borderColor, fullName);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
        workerLocationMarkersRef.current.set(loc.worker_id, marker);
      }
    });

    existingIds.forEach(id => {
      workerLocationMarkersRef.current.get(id)?.remove();
      workerLocationMarkersRef.current.delete(id);
    });
  }, [workerLocations, mapLoaded, workers]);

  // Geocode cache hydration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cache = await sessionService.getAllGeocodeCache();
        if (cancelled) return;
        cache.forEach((coords, key) => {
          if (!geocodeCache.has(key)) {
            geocodeCache.set(key, coords);
          }
        });
        console.log(`[Geocode] Hydrated ${cache.size} cached entries from Supabase`);
      } catch (err) {
        console.warn('[Geocode] Hydration failed (continuing without):', err);
      } finally {
        if (!cancelled) setGeocodeCacheHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Historical fetch
  useEffect(() => {
    if (!myRouteCodes.length) { setHistoricalProps([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const props = await sessionService.getHistoricalPropertiesForRoutes(myRouteCodes);
        if (cancelled) return;
        setHistoricalProps(props);
        console.log(`[HistoricalProps] Loaded ${props.length} properties for ${myRouteCodes.length} routes`);
      } catch (err) {
        console.warn('[HistoricalProps] Fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [myRouteCodes.join(',')]);

  // PCL fetch
  useEffect(() => {
    if (!myRouteCodes.length) { setPclByRoute(new Map()); return; }
    const ccId = commandCenterService.getCurrentCommandCenterId();
    if (!ccId) { setPclByRoute(new Map()); return; }
    let cancelled = false;
    (async () => {
      try {
        const map = await getWorkerPCL(myRouteCodes, ccId);
        if (cancelled) return;
        setPclByRoute(map);
        let count = 0;
        map.forEach(arr => { count += arr.length; });
        console.log(`[PCL] Loaded ${count} historical clients across ${map.size} routes`);
      } catch (err) {
        console.warn('[PCL] Fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [myRouteCodes.join(',')]);

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

  // === PART 2 START ===

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
      const rp=routes.find(r=>r.routeCode===route.route_code);
      const isAssigned = !!rp?.assignedWorkerIds?.length;

      if (sidebarMode === 'routes' && myRouteCodes.includes(route.route_code)) {
        map.setPaintProperty(lid, 'line-opacity', isAssigned ? 0.9 : 0.3);
      } else {
        map.setPaintProperty(lid, 'line-opacity', isAssigned ? 0.75 : 0.4);
      }
    });
  }, [sidebarMode, routeMapData, routes, mapLoaded, myRouteCodes]);

  // Route click handlers
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
        const rb=cb.filter(b=>b['Route Number']===rc);
        const totalEQ=rb.reduce((sum,b) => sum + calculateBookingEQ(b), 0);
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
  }, [routeMapData, mapLoaded, myRouteCodes, calculateBookingEQ]);

  // --- LAYER RENDERERS ---

  // Pending bookings circles — separate layer from completed so they can be
  // filter-toggled independently.
  const updatePendingBookingPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => ({
        type: 'Feature' as const,
        properties: {
          name: pin.name, address: pin.address, routeCode: pin.routeCode,
          routeColor: pin.routeColor, phone: pin.phone || '', email: pin.email || '',
          price: pin.price || '',
        },
        geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
      })),
    };
    const src = map.getSource('rm-pending-pins-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-pending-pins-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-pending-pins-circles',
      type: 'circle',
      source: 'rm-pending-pins-src',
      paint: {
        'circle-color': ['get', 'routeColor'],
        'circle-radius': 3.33,
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1.67,
        'circle-opacity': 0.95,
      },
    });
    map.on('mouseenter', 'rm-pending-pins-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rm-pending-pins-circles', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'rm-pending-pins-circles', (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const { name, address, routeCode, routeColor, phone, email, price } = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      if (popupRef.current) popupRef.current.remove();
      const sn=esc(name),sa=esc(address),sp=esc(phone),se=esc(email),spr=esc(price),src2=esc(routeCode);
      const pRow=sp?`<div style="margin-top:5px;"><a href="tel:${sp}" style="color:#60a5fa;font-size:12px;text-decoration:none;">📞 ${sp}</a></div>`:'';
      const eRow=se?`<div style="color:#9ca3af;font-size:11px;margin-top:2px;">✉️ ${se}</div>`:'';
      const prTag=spr?`<span style="background:#16a34a22;color:#4ade80;border:1px solid #16a34a66;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${spr}</span>`:'';
      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true }).setLngLat(coords).setHTML(
        `<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:190px;line-height:1.4;"><div style="font-weight:700;margin-bottom:3px;">${sn}</div><div style="color:#555;font-size:11px;">${sa}</div>${pRow}${eRow}<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;"><span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${src2}</span><span style="color:#9ca3af;font-size:11px;font-weight:600;">⏳ Pending</span>${prTag}</div></div>`
      ).addTo(map);
    });
  }, []);

  // Completed + new-sale circles
  const updateCompletedPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => ({
        type: 'Feature' as const,
        properties: {
          name: pin.name, address: pin.address, routeCode: pin.routeCode,
          routeColor: pin.routeColor, status: pin.status, phone: pin.phone || '',
          email: pin.email || '', price: pin.price || '', paymentMethod: pin.paymentMethod || '',
        },
        geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
      })),
    };
    const src = map.getSource('rm-completed-pins-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-completed-pins-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-completed-pins-circles',
      type: 'circle',
      source: 'rm-completed-pins-src',
      paint: {
        'circle-color': ['get', 'routeColor'],
        'circle-radius': 3.33,
        'circle-stroke-color': ['match', ['get', 'status'], 'completed', '#22c55e', 'new_sale', '#eab308', '#000000'],
        'circle-stroke-width': 1.67,
        'circle-opacity': 0.95,
      },
    });
    map.on('mouseenter', 'rm-completed-pins-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rm-completed-pins-circles', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'rm-completed-pins-circles', (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const { name, address, routeCode, routeColor, status, phone, email, price, paymentMethod } = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      if (popupRef.current) popupRef.current.remove();
      const sl = status === 'completed' ? '✅ Done' : '🆕 Sale';
      const sc = status === 'completed' ? '#22c55e' : '#eab308';
      const sn=esc(name),sa=esc(address),sp=esc(phone),se=esc(email),spr=esc(price),sm=esc(paymentMethod),src2=esc(routeCode);
      const pRow=sp?`<div style="margin-top:5px;"><a href="tel:${sp}" style="color:#60a5fa;font-size:12px;text-decoration:none;">📞 ${sp}</a></div>`:'';
      const eRow=se?`<div style="color:#9ca3af;font-size:11px;margin-top:2px;">✉️ ${se}</div>`:'';
      const prTag=spr?`<span style="background:#16a34a22;color:#4ade80;border:1px solid #16a34a66;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${spr}</span>`:'';
      const mTag=sm?`<span style="background:#37415122;color:#9ca3af;border:1px solid #37415166;border-radius:4px;padding:2px 7px;font-size:11px;">${sm}</span>`:'';
      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true }).setLngLat(coords).setHTML(
        `<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:190px;line-height:1.4;"><div style="font-weight:700;margin-bottom:3px;">${sn}</div><div style="color:#555;font-size:11px;">${sa}</div>${pRow}${eRow}<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;"><span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${src2}</span><span style="color:${sc};font-size:11px;font-weight:600;">${sl}</span>${prTag}${mTag}</div></div>`
      ).addTo(map);
    });
  }, []);

  // Historical X markers
  const updateHistoricalPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedHistorical[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(h => ({
        type: 'Feature' as const,
        properties: { routeCode: h.routeCode },
        geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] }
      }))
    };
    const src = map.getSource('rm-historical-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-historical-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-historical-symbols',
      type: 'symbol',
      source: 'rm-historical-src',
      layout: {
        'icon-image': 'rm-historical-x',
        'icon-size': 1.0,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0 },
    });
  }, []);

  // PCL grey circles — HALVED per spec. radius 1.75, stroke 0.5.
  const updatePclCircles = useCallback((map: mapboxgl.Map, entries: GeocodedPCLEntry[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: entries.map(e => ({
        type: 'Feature' as const,
        properties: { key: e.key },
        geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] }
      }))
    };
    const src = map.getSource('rm-pcl-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-pcl-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-pcl-circles',
      type: 'circle',
      source: 'rm-pcl-src',
      paint: {
        'circle-color': '#6b7280',
        'circle-radius': 1.75,
        'circle-stroke-color': '#374151',
        'circle-stroke-width': 0.5,
        'circle-opacity': 0,
      },
    });
  }, []);

  // FILTER-DRIVEN VISIBILITY — each layer reads its boolean from filterVisibility.
  // The dashed-ring pending-sales markers, the pulsing completion markers, and
  // the worker location markers are HTML element-based (not Mapbox layers) so
  // they're handled separately in their own effects below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (map.getLayer('rm-pending-pins-circles')) {
      map.setPaintProperty('rm-pending-pins-circles', 'circle-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
    }
    if (map.getLayer('rm-completed-pins-circles')) {
      map.setPaintProperty('rm-completed-pins-circles', 'circle-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-historical-symbols')) {
      map.setPaintProperty('rm-historical-symbols', 'icon-opacity', filterVisibility.historical ? 0.85 : 0);
    }
    if (map.getLayer('rm-pcl-circles')) {
      map.setPaintProperty('rm-pcl-circles', 'circle-opacity', filterVisibility.pcl ? 0.7 : 0);
    }
  }, [filterVisibility, mapLoaded]);

  // --- SERIAL GEOCODING STATE MACHINE ---
  //
  // Drives the four-phase geocoding pipeline in strict order. Each phase:
  //  1. Splits inputs into cached vs needs-geocoding
  //  2. Reports its total to RMLogbook so the filter badge knows the denominator
  //  3. Renders cached entries immediately
  //  4. Geocodes the remainder one address at a time with 80ms throttle
  //  5. Reports done:true when finished, advancing to the next phase
  //
  // Mid-day additions (new pending sales, new completed jobs) bypass the phase
  // machine and geocode immediately — see the "incremental" effect lower down.

  // Helper that geocodes a single address with cache write-through.
  const geocodeOne = useCallback(async (address: string): Promise<{ lat: number; lng: number } | null> => {
    const addrKey = makeCacheKey(address);
    const cached = geocodeCache.get(addrKey);
    if (cached) return cached;
    const coord = await geocodeAddress(address, routeCentroid?.lat, routeCentroid?.lng);
    if (coord) {
      geocodeCache.set(addrKey, coord);
      sessionService.saveGeocode(address, coord.lat, coord.lng).catch(() => {});
    }
    return coord;
  }, [routeCentroid]);

  // Phase machine — fires when its prerequisites are met. Each phase signals
  // completion via onGeocodeProgress and advances geocodePhase implicitly by
  // each subsequent phase having `geocodePhase === <previous_done>` checks.
  // Since RMLogbook owns the phase state, we just call onGeocodeProgress with
  // the next phase name when transitioning.

  // PHASE 1: Pending Prebooks
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'idle') return;

    const map = mapRef.current; if (!map) return;
    let cancelled = false;

    (async () => {
      const sources = pendingBookingPinSource;
      const enriched: GeocodedPin[] = [];
      const needsGeocoding: PinData[] = [];

      sources.forEach(pin => {
        const addrKey = makeCacheKey(pin.address);
        const cached = geocodeCache.get(addrKey);
        if (cached) {
          enriched.push({ ...pin, lat: cached.lat, lng: cached.lng, routeColor: routeColorMap.get(pin.routeCode) || '#888888' });
        } else {
          needsGeocoding.push(pin);
        }
      });

      const total = needsGeocoding.length;
      onGeocodeProgress('phase1_pending_bookings', 'pendingBookings', 0, total, false);

      // Render cached immediately
      const merged = [...enriched];
      enriched.forEach(p => knownPinsRef.current.set(p.id, p));
      const allKnown = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'pending');
      updatePendingBookingPins(map, allKnown);

      // Geocode the rest
      for (let i = 0; i < needsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const pin = needsGeocoding[i];
        const coord = await geocodeOne(pin.address);
        if (coord) {
          const enrichedPin: GeocodedPin = { ...pin, lat: coord.lat, lng: coord.lng, routeColor: routeColorMap.get(pin.routeCode) || '#888888' };
          knownPinsRef.current.set(pin.id, enrichedPin);
        }
        if (cancelled || !mountedRef.current) return;
        onGeocodeProgress('phase1_pending_bookings', 'pendingBookings', i + 1, total, false);
        // Re-render every few to give visual feedback
        if ((i + 1) % 5 === 0 || i === needsGeocoding.length - 1) {
          const live = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'pending');
          updatePendingBookingPins(map, live);
        }
        if (i < needsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }

      if (cancelled || !mountedRef.current) return;
      const final = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'pending');
      updatePendingBookingPins(map, final);
      setGeocodedPins(Array.from(knownPinsRef.current.values()));

      // Phase 1 done — advance to phase 2
      onGeocodeProgress('phase2_completed_and_sales', 'pendingBookings', total, total, true);
    })();

    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, pendingBookingPinSource, routeColorMap, geocodeOne, updatePendingBookingPins, onGeocodeProgress]);

  // PHASE 2: Completed + new sales + pending sales (combined visual filter)
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'phase2_completed_and_sales') return;

    const map = mapRef.current; if (!map) return;
    let cancelled = false;

    (async () => {
      // Completed + new-sale pins
      const sources = completedAndNewSalePinSource;
      const enriched: GeocodedPin[] = [];
      const needsGeocoding: PinData[] = [];

      sources.forEach(pin => {
        const addrKey = makeCacheKey(pin.address);
        const cached = geocodeCache.get(addrKey);
        const ic = jobIdCache.get(pin.id);
        const icValid = ic && makeCacheKey(ic.address) === addrKey;
        const resolved = cached || (icValid ? { lat: ic!.lat, lng: ic!.lng } : undefined);
        if (resolved) {
          if (!cached) geocodeCache.set(addrKey, resolved);
          jobIdCache.set(pin.id, { address: pin.address, lat: resolved.lat, lng: resolved.lng });
          enriched.push({ ...pin, lat: resolved.lat, lng: resolved.lng, routeColor: routeColorMap.get(pin.routeCode) || '#888888' });
        } else {
          needsGeocoding.push(pin);
        }
      });

      // Pending sales (team seasons only) — fold into the same phase
      const pendingSalesNeedsGeocoding: Array<{ booking: MasterBooking; address: string; id: string }> = [];
      const pendingSalesCached: GeocodedPendingSale[] = [];

      if (isTeamSeason) {
        const merged = mergePendingSalesForDisplay(pendingSalesByManager);
        merged.forEach(booking => {
          const address = booking['Full Address'] || '';
          if (!address) return;
          const addrKey = makeCacheKey(address);
          const cached = geocodeCache.get(addrKey);
          if (cached) {
            pendingSalesCached.push({ id: booking['Booking ID'], lat: cached.lat, lng: cached.lng, booking });
          } else {
            pendingSalesNeedsGeocoding.push({ booking, address, id: booking['Booking ID'] });
          }
        });
      }

      const totalToGeocode = needsGeocoding.length + pendingSalesNeedsGeocoding.length;
      onGeocodeProgress('phase2_completed_and_sales', 'pendingSalesAndCompleted', 0, totalToGeocode, false);

      // Render cached immediately
      enriched.forEach(p => knownPinsRef.current.set(p.id, p));
      const allCompleted = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'completed' || p.status === 'new_sale');
      updateCompletedPins(map, allCompleted);
      if (isTeamSeason) {
        setGeocodedPendingSales(pendingSalesCached);
      }

      let progressDone = 0;

      // Geocode completed/new-sale first
      for (let i = 0; i < needsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const pin = needsGeocoding[i];
        const coord = await geocodeOne(pin.address);
        if (coord) {
          jobIdCache.set(pin.id, { address: pin.address, lat: coord.lat, lng: coord.lng });
          knownPinsRef.current.set(pin.id, { ...pin, lat: coord.lat, lng: coord.lng, routeColor: routeColorMap.get(pin.routeCode) || '#888888' });
        }
        if (cancelled || !mountedRef.current) return;
        progressDone++;
        onGeocodeProgress('phase2_completed_and_sales', 'pendingSalesAndCompleted', progressDone, totalToGeocode, false);
        if (progressDone % 5 === 0 || i === needsGeocoding.length - 1) {
          const live = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'completed' || p.status === 'new_sale');
          updateCompletedPins(map, live);
        }
        if (i < needsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }

      // Then pending sales
      const newPSResults: GeocodedPendingSale[] = [...pendingSalesCached];
      for (let i = 0; i < pendingSalesNeedsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const { booking, address, id } = pendingSalesNeedsGeocoding[i];
        const coord = await geocodeOne(address);
        if (coord) {
          newPSResults.push({ id, lat: coord.lat, lng: coord.lng, booking });
        }
        if (cancelled || !mountedRef.current) return;
        progressDone++;
        onGeocodeProgress('phase2_completed_and_sales', 'pendingSalesAndCompleted', progressDone, totalToGeocode, false);
        if (i < pendingSalesNeedsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }

      if (cancelled || !mountedRef.current) return;
      if (isTeamSeason) {
        setGeocodedPendingSales(newPSResults);
      }
      setGeocodedPins(Array.from(knownPinsRef.current.values()));

      // Phase 2 done — advance to phase 3
      onGeocodeProgress('phase3_historical', 'pendingSalesAndCompleted', totalToGeocode, totalToGeocode, true);
    })();

    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, completedAndNewSalePinSource, pendingSalesByManager, isTeamSeason, routeColorMap, geocodeOne, updateCompletedPins, onGeocodeProgress]);

  // PHASE 3: Historical
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'phase3_historical') return;

    const map = mapRef.current; if (!map) return;
    let cancelled = false;

    (async () => {
      const enriched: GeocodedHistorical[] = [];
      const needsGeocoding: HistoricalProperty[] = [];

      historicalProps.forEach(h => {
        const addrKey = makeCacheKey(h.address);
        const uniqueKey = `${h.routeCode}::${addrKey}`;
        const cached = geocodeCache.get(addrKey);
        if (cached) {
          knownHistoricalRef.current.set(uniqueKey, { ...h, lat: cached.lat, lng: cached.lng });
        } else {
          needsGeocoding.push(h);
        }
      });

      const total = needsGeocoding.length;
      onGeocodeProgress('phase3_historical', 'historical', 0, total, false);

      // Render cached
      const snap = Array.from(knownHistoricalRef.current.values());
      setGeocodedHistorical(snap);
      updateHistoricalPins(map, snap);

      for (let i = 0; i < needsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const h = needsGeocoding[i];
        const coord = await geocodeOne(h.address);
        if (coord) {
          const addrKey = makeCacheKey(h.address);
          const uniqueKey = `${h.routeCode}::${addrKey}`;
          knownHistoricalRef.current.set(uniqueKey, { ...h, lat: coord.lat, lng: coord.lng });
        }
        if (cancelled || !mountedRef.current) return;
        onGeocodeProgress('phase3_historical', 'historical', i + 1, total, false);
        if ((i + 1) % 10 === 0 || i === needsGeocoding.length - 1) {
          const live = Array.from(knownHistoricalRef.current.values());
          setGeocodedHistorical(live);
          updateHistoricalPins(map, live);
        }
        if (i < needsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }

      if (cancelled || !mountedRef.current) return;
      const final = Array.from(knownHistoricalRef.current.values());
      setGeocodedHistorical(final);
      updateHistoricalPins(map, final);

      // Phase 3 done — advance to phase 4
      onGeocodeProgress('phase4_pcl', 'historical', total, total, true);
    })();

    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, historicalProps, geocodeOne, updateHistoricalPins, onGeocodeProgress]);

  // PHASE 4: PCL
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'phase4_pcl') return;

    const map = mapRef.current; if (!map) return;
    let cancelled = false;

    (async () => {
      const known = new Map<string, GeocodedPCLEntry>();
      const needsGeocoding: Array<{ key: string; address: string }> = [];

      pclByRoute.forEach((clients, routeCode) => {
        clients.forEach(c => {
          const address = `${c.houseNum} ${c.streetName}`.trim();
          if (!address) return;
          const addrKey = makeCacheKey(address);
          const uniqueKey = `${routeCode}::${addrKey}`;
          const cached = geocodeCache.get(addrKey);
          if (cached) {
            known.set(uniqueKey, { key: uniqueKey, lat: cached.lat, lng: cached.lng });
          } else {
            needsGeocoding.push({ key: uniqueKey, address });
          }
        });
      });

      const total = needsGeocoding.length;
      onGeocodeProgress('phase4_pcl', 'pcl', 0, total, false);

      const snap = Array.from(known.values());
      setGeocodedPCL(snap);
      updatePclCircles(map, snap);

      for (let i = 0; i < needsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const { key, address } = needsGeocoding[i];
        const coord = await geocodeOne(address);
        if (coord) {
          known.set(key, { key, lat: coord.lat, lng: coord.lng });
        }
        if (cancelled || !mountedRef.current) return;
        onGeocodeProgress('phase4_pcl', 'pcl', i + 1, total, false);
        if ((i + 1) % 20 === 0 || i === needsGeocoding.length - 1) {
          const live = Array.from(known.values());
          setGeocodedPCL(live);
          updatePclCircles(map, live);
        }
        if (i < needsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }

      if (cancelled || !mountedRef.current) return;
      const final = Array.from(known.values());
      setGeocodedPCL(final);
      updatePclCircles(map, final);

      // Phase 4 done — mark complete
      onGeocodeProgress('complete', 'pcl', total, total, true);
    })();

    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, pclByRoute, geocodeOne, updatePclCircles, onGeocodeProgress]);

  // INCREMENTAL: mid-day pending-sales additions. Once phase machine is complete,
  // new pending sales appearing in pendingSalesByManager prop get geocoded
  // immediately without waiting for any phase.
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'complete') return;
    if (!isTeamSeason) return;

    let cancelled = false;
    (async () => {
      const merged = mergePendingSalesForDisplay(pendingSalesByManager);
      const knownIds = new Set(geocodedPendingSales.map(g => g.id));
      const additions: GeocodedPendingSale[] = [];

      for (const booking of merged) {
        if (cancelled) return;
        if (knownIds.has(booking['Booking ID'])) continue;
        const address = booking['Full Address'] || '';
        if (!address) continue;
        const coord = await geocodeOne(address);
        if (coord) {
          additions.push({ id: booking['Booking ID'], lat: coord.lat, lng: coord.lng, booking });
        }
        await new Promise(r => setTimeout(r, 80));
      }

      if (cancelled || !mountedRef.current) return;
      if (additions.length > 0) {
        // Filter out any that have disappeared from current pending sales
        const stillRelevant = new Set(merged.map(b => b['Booking ID']));
        setGeocodedPendingSales(prev => {
          const next = [...prev.filter(g => stillRelevant.has(g.id)), ...additions];
          return next;
        });
      } else {
        // Even with no additions, prune ones that have been resolved/removed
        const stillRelevant = new Set(merged.map(b => b['Booking ID']));
        setGeocodedPendingSales(prev => prev.filter(g => stillRelevant.has(g.id)));
      }
    })();
    return () => { cancelled = true; };
  }, [pendingSalesByManager, geocodePhase, isTeamSeason, mapLoaded, geocodeCacheHydrated, geocodeOne]);

  // Render pending-sales markers (dashed rotating rings)
  // Honors filterVisibility.pendingSalesAndCompleted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const existingIds = new Set(pendingSaleMarkersRef.current.keys());
    const showThem = filterVisibility.pendingSalesAndCompleted;

    if (!showThem) {
      // Hide all
      pendingSaleMarkersRef.current.forEach(m => m.remove());
      pendingSaleMarkersRef.current.clear();
      return;
    }

    geocodedPendingSales.forEach(ps => {
      const existing = pendingSaleMarkersRef.current.get(ps.id);
      if (existing) {
        existing.setLngLat([ps.lng, ps.lat]);
        existingIds.delete(ps.id);
      } else {
        const el = createDashedRotatingRing();
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setPendingJobForModal(ps.booking);
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([ps.lng, ps.lat])
          .addTo(map);
        pendingSaleMarkersRef.current.set(ps.id, marker);
      }
    });

    existingIds.forEach(id => {
      pendingSaleMarkersRef.current.get(id)?.remove();
      pendingSaleMarkersRef.current.delete(id);
    });
  }, [geocodedPendingSales, mapLoaded, filterVisibility.pendingSalesAndCompleted]);

  // Pulsing completion dots — honor filterVisibility.pendingSalesAndCompleted
  // since they're conceptually completion markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    pulsingMarkersRef.current.forEach(m => m.remove());
    pulsingMarkersRef.current = [];

    if (!filterVisibility.pendingSalesAndCompleted) return;

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
  }, [mostRecentCompletionPins, mapLoaded, filterVisibility.pendingSalesAndCompleted]);

  // GPS (RM's own location) + drag-to-disable-follow-me + cart-aware on-route
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!navigator.geolocation) return;
    if(!navArrowElRef.current) navArrowElRef.current=createNavArrow();
    navMarkerRef.current=new mapboxgl.Marker({element:navArrowElRef.current}).setLngLat([0,0]).addTo(map);

    // Google-Maps-style: user drag disables follow-me. Programmatic moves
    // (easeTo from GPS updates) don't have an originalEvent.
    const handleDragStart = (e: any) => {
      if (!e.originalEvent) return; // programmatic, ignore
      if (centerOnLocationRef.current) {
        onFollowMeAutoDisable();
      }
    };
    map.on('dragstart', handleDragStart);

    watchIdRef.current=navigator.geolocation.watchPosition(pos=>{
      if(!navMarkerRef.current||!mapRef.current) return;
      const{latitude:lat,longitude:lng,heading}=pos.coords;
      navMarkerRef.current.setLngLat([lng,lat]);
      if(heading!=null&&!isNaN(heading)&&navArrowElRef.current) navArrowElRef.current.style.transform=`rotate(${heading}deg)`;
      if(centerOnLocationRef.current) mapRef.current.easeTo({center:[lng,lat],duration:1000});

      if (centerOnLocationRef.current) {
        const nearest = findNearestAssignedRoute(lat, lng, routeMapDataRef.current, routesRef.current, managerId, 100);
        if (nearest) {
          if (isTeamSeason) {
            const cart = cartCardDataRef.current.find(c => c.members.some(m => m.contractorId === nearest.workerId));
            if (cart) {
              onRouteCartIdRef.current = cart.sessionId;
              onRouteWorkerIdRef.current = null;
              setOnRouteCartCard(cart);
              setOnRouteWorkerCard(null);
            } else {
              onRouteCartIdRef.current = null;
              onRouteWorkerIdRef.current = null;
              setOnRouteCartCard(null);
              setOnRouteWorkerCard(null);
            }
          } else {
            const card = workerCardDataRef.current.find(c => c.worker.contractorId === nearest.workerId) || null;
            onRouteWorkerIdRef.current = nearest.workerId;
            onRouteCartIdRef.current = null;
            setOnRouteWorkerCard(card);
            setOnRouteCartCard(null);
          }
        } else {
          onRouteWorkerIdRef.current = null;
          onRouteCartIdRef.current = null;
          setOnRouteWorkerCard(null);
          setOnRouteCartCard(null);
        }
      } else {
        onRouteWorkerIdRef.current = null;
        onRouteCartIdRef.current = null;
        setOnRouteWorkerCard(null);
        setOnRouteCartCard(null);
      }
    },()=>{},{enableHighAccuracy:true,maximumAge:15000,timeout:30000});
    return()=>{
      map.off('dragstart', handleDragStart);
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
    };
  }, [mapLoaded, isTeamSeason, managerId, onFollowMeAutoDisable]);

  // When follow-me activates externally (header button), recenter immediately.
  useEffect(() => {
    if (centerOnLocation && navMarkerRef.current && mapRef.current) {
      const ll = navMarkerRef.current.getLngLat();
      if (ll.lng !== 0 || ll.lat !== 0) {
        mapRef.current.easeTo({ center: [ll.lng, ll.lat], duration: 800 });
      }
    }
    if (!centerOnLocation) {
      onRouteWorkerIdRef.current = null;
      onRouteCartIdRef.current = null;
      setOnRouteWorkerCard(null);
      setOnRouteCartCard(null);
    }
  }, [centerOnLocation]);

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

      const xCanvasSize = 16;
      const xCanvas = document.createElement('canvas');
      xCanvas.width = xCanvasSize;
      xCanvas.height = xCanvasSize;
      const ctx = xCanvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const pad = 3;
        ctx.beginPath();
        ctx.moveTo(pad, pad);
        ctx.lineTo(xCanvasSize - pad, xCanvasSize - pad);
        ctx.moveTo(xCanvasSize - pad, pad);
        ctx.lineTo(pad, xCanvasSize - pad);
        ctx.stroke();

        const imgData = ctx.getImageData(0, 0, xCanvasSize, xCanvasSize);
        if (!map.hasImage('rm-historical-x')) {
          map.addImage('rm-historical-x', imgData, { pixelRatio: 2 });
        }
      }

      setMapLoaded(true);
    });
    mapRef.current=map;
    return()=>{
      mountedRef.current=false;initialFitDoneRef.current=false;routeDataLoadedRef.current=false;prevRouteCodesKeyRef.current='';
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
      if(popupRef.current){popupRef.current.remove();popupRef.current=null;}
      pulsingMarkersRef.current.forEach(m => m.remove());pulsingMarkersRef.current=[];
      pendingSaleMarkersRef.current.forEach(m => m.remove());
      pendingSaleMarkersRef.current.clear();
      workerLocationMarkersRef.current.forEach(m => m.remove());
      workerLocationMarkersRef.current.clear();
      map.remove();mapRef.current=null;setMapLoaded(false);
    };
  }, [suppressDuplicateLabels]);

  // --- ACTIONS ---

  const handleViewLogsheet=(worker:Worker, cartMembers?:Worker[])=>{
    setStorageItem('rm_original_user',currentUser);setStorageItem('rm_view_mode',true);
    if (cartMembers && cartMembers.length > 1) {
      const cartNames = cartMembers.map(m => m.firstName).join(' & ');
      setStorageItem('rm_view_cart_names', cartNames);
    } else {
      setStorageItem('rm_view_cart_names', null);
    }
    setStorageItem('current_user',worker);
    navigate('/logsheet');
  };

  const handleToggleUpsells = async (contractorId: string, currentValue: boolean) => {
    try {
      await sessionService.toggleWorkerUpsells(contractorId, !currentValue);
      onRefresh();
    } catch (error) {
      console.error("Failed to toggle upsells:", error);
    }
  };

  const handleAssignRoute=async(workerId:string|null)=>{
    if(!assignModalData) return; setAssignLoading(true);
    try{
      const { routeCode } = assignModalData;
      const routeBookings = bookings.filter(b => b['Route Number'] === routeCode);
      const pendingItems = routeBookings.filter(b => b.Status !== 'completed' && b.Completed !== 'x');
      const pendingBookingIds = pendingItems.map(j => j['Booking ID']);

      if (workerId === null) {
        await sessionService.assignRouteToWorkers(routeCode, []);
        if (isTeamSeason) {
          await Promise.all(pendingItems.map(job =>
            sessionService.assignBookingToSession(job['Booking ID'], null)
          ));
        } else {
          await Promise.all(pendingItems.map(job =>
            sessionService.assignBookingToWorker(job['Booking ID'], null)
          ));
        }
      } else if (isTeamSeason) {
        const worker = myTeamWorkers.find(w => w.contractorId === workerId);
        const teamId = worker?.teamId || workerId;
        const cart = teamCarts.find(c => c.teamId === teamId);
        const session = await sessionService.getWorkerLogsheetSession(workerId);
        const sessionId = session?.id;

        if (cart && cart.workerIds.length > 1) {
          await sessionService.assignRouteToWorkers(routeCode, cart.workerIds);
        } else {
          await sessionService.assignRouteToWorkers(routeCode, [workerId]);
        }

        if (sessionId && pendingBookingIds.length > 0) {
          await sessionService.assignBookingsToSession(pendingBookingIds, sessionId);
        }
      } else {
        await sessionService.assignRouteToWorkers(routeCode, [workerId]);
        await Promise.all(pendingItems.map(job =>
          sessionService.assignBookingToWorker(job['Booking ID'], workerId)
        ));
      }
      setAssignModalData(null);
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setAssignLoading(false);
    }
  };

  const handleTransferConfirm = async (newManagerId: string) => {
    if (!transferModalData) return;
    try {
      if (transferModalData.type === 'ROUTE') {
        await sessionService.transferRouteToManager(transferModalData.routeCode, newManagerId);
      } else {
        await sessionService.transferBookingToManager(
          transferModalData.targetId,
          transferModalData.routeCode,
          newManagerId
        );
      }
      setTransferModalData(null);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const openTransferModal = () => {
    if (!assignModalData) return;
    setTransferModalData({
      type: 'ROUTE',
      targetId: assignModalData.routeCode,
      routeCode: assignModalData.routeCode,
      title: `Transfer Route ${assignModalData.routeCode}`,
    });
    setAssignModalData(null);
  };

  const handleReassignWorker = async (
    destination:
      | { type: 'existing_cart'; targetSessionId: string; label: string }
      | { type: 'new_solo' }
      | { type: 'different_manager'; targetManagerId: string }
  ) => {
    if (!selectedWorkerToMove) return;
    setReassignLoading(true);
    setReassignError(null);
    setReassignSuccess(null);

    try {
      await sessionService.reassignWorker(selectedWorkerToMove.contractorId, destination);

      let msg = '';
      if (destination.type === 'existing_cart') {
        msg = `${selectedWorkerToMove.firstName} moved to ${destination.label}`;
      } else if (destination.type === 'new_solo') {
        msg = `${selectedWorkerToMove.firstName} is now a solo cart`;
      } else {
        const mgr = allManagers.find(m => m.userId === destination.targetManagerId);
        msg = `${selectedWorkerToMove.firstName} moved to ${mgr?.name || 'new manager'}`;
      }

      setReassignSuccess(msg);
      setSelectedWorkerToMove(null);
      setSelectedWorkerSourceCart(null);
      onRefresh();
    } catch (err: any) {
      console.error('Reassign failed:', err);
      setReassignError(err.message || 'Failed to reassign worker. Please try again.');
    } finally {
      setReassignLoading(false);
    }
  };

  const handleAerationTransfer = async (targetManagerId: string) => {
    if (!selectedWorkerToMove) return;
    setReassignLoading(true);
    setReassignError(null);
    setReassignSuccess(null);
    try {
      await sessionService.transferWorker(selectedWorkerToMove.contractorId, targetManagerId);
      const mgr = allManagers.find(m => m.userId === targetManagerId);
      setReassignSuccess(`${selectedWorkerToMove.firstName} moved to ${mgr?.name || 'new manager'}`);
      setSelectedWorkerToMove(null);
      onRefresh();
    } catch (err: any) {
      console.error('Transfer failed:', err);
      setReassignError(err.message || 'Failed to transfer worker.');
    } finally {
      setReassignLoading(false);
    }
  };

  const handleRemoveWorkerNoShow = async () => {
    if (!selectedWorkerToMove) return;
    if (!window.confirm(
      `Remove ${selectedWorkerToMove.firstName} ${selectedWorkerToMove.lastName} completely?\n\nThis removes them from the session and all stats. Use this for no-shows only.`
    )) return;

    setReassignLoading(true);
    setReassignError(null);
    setReassignSuccess(null);

    try {
      if (isTeamSeason && selectedWorkerSourceCart && selectedWorkerSourceCart.members.length > 1) {
        await sessionService.reassignWorker(
          selectedWorkerToMove.contractorId,
          { type: 'new_solo' }
        );
      }
      await sessionService.deleteWorker(selectedWorkerToMove.contractorId);

      setReassignSuccess(`${selectedWorkerToMove.firstName} removed from session`);
      setSelectedWorkerToMove(null);
      setSelectedWorkerSourceCart(null);
      onRefresh();
    } catch (err: any) {
      console.error('Remove failed:', err);
      setReassignError(err.message || 'Failed to remove worker. Please try again.');
    } finally {
      setReassignLoading(false);
    }
  };

  const handleUnassignAsphalt = async (asphaltRowId: string, addressLabel: string) => {
    if (!window.confirm(
      `Unassign asphalt at ${addressLabel}?\n\nThe assigned RC will no longer see it. ` +
      `The row returns to the asphalt queue for reassignment. The driveway sale is unaffected.`
    )) return;

    setUnassigningAsphaltId(asphaltRowId);
    setUnassignError(null);
    try {
      await sessionService.unassignAsphalt(asphaltRowId);
      onRefresh();
    } catch (err: any) {
      console.error('Unassign asphalt failed:', err);
      setUnassignError(err?.message || 'Failed to unassign asphalt. Please try again.');
    } finally {
      setUnassigningAsphaltId(null);
    }
  };

  const isAerationWorkerModifiable = (worker: Worker): boolean => {
    if (isTeamSeason) return false;
    const card = workerCardData.find(c => c.worker.contractorId === worker.contractorId);
    return !card || card.financialStore.length === 0;
  };

  const selectedRouteBookings=useMemo(()=>selectedRouteForBookings?bookings.filter(b=>b['Route Number']===selectedRouteForBookings):[], [selectedRouteForBookings,bookings]);
  const selectedRouteFinancialStore=useMemo(()=>selectedRouteForBookings?allSessions.flatMap(s=>(s.financialStore||[]).filter((tx:any)=>tx.routeCode===selectedRouteForBookings)):[], [selectedRouteForBookings,allSessions]);

  const handleCopyPhone = (phone: string, id: string) => {
    navigator.clipboard.writeText(phone);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={mapContainerRef} className="flex-1" />

      {/* Sidebar — always renders */}
      <div className="absolute left-0 top-0 bottom-0 z-20 transition-all duration-300" style={{width:sidebarOpen?'20%':'20px'}}>
        <div className="absolute left-0 top-0 bottom-0 bg-gray-900/95 backdrop-blur-sm transition-all duration-300 overflow-hidden" style={{width:sidebarOpen?'calc(100% - 20px)':'0px'}}>
          {sidebarOpen && (
            <div className="h-full flex flex-col">
              <div className="p-2 border-b border-gray-700 flex-shrink-0 bg-gray-800/80">
                <div className="flex gap-1 bg-gray-900/60 rounded-lg p-0.5">
                  <button onClick={()=>setSidebarMode('staff')} className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-bold transition-all ${sidebarMode==='staff'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                    {isTeamSeason ? <Truck size={10}/> : <Users size={10}/>}
                    {isTeamSeason ? 'Carts' : 'Staff'}
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
                {sidebarMode==='staff' && !isTeamSeason && (
                  sortedWorkerCards.length===0
                    ? <div className="text-center text-gray-500 text-xs py-6 italic">No workers found.</div>
                    : sortedWorkerCards.map(card => (
                        <div key={card.worker.contractorId} className="bg-gray-800 border border-gray-700 rounded-lg p-2 mb-1.5 hover:border-blue-500 transition-all cursor-pointer" onClick={()=>setSelectedWorkerForModal(card)}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${card.stats.pending>0?'bg-yellow-500 animate-pulse':'bg-green-500'}`}/>
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-white text-xs truncate hover:text-blue-300">
                                  {card.worker.firstName} {card.worker.lastName}
                                </span>
                                <span className="text-[9px] text-gray-500 font-mono">#{card.worker.contractorId}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
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
                          {card.lastActiveAddress && (
                            <div className="flex items-center gap-1 text-[9px] text-gray-400 mb-1 pl-3 truncate">
                              <MapPin size={8} className="text-emerald-500 shrink-0" />
                              <span className="truncate">{card.lastActiveAddress}{card.lastActiveTime && <span className="text-gray-500"> • {card.lastActiveTime}</span>}</span>
                            </div>
                          )}
                          <div className="grid grid-cols-5 gap-0.5 text-center bg-gray-900/50 rounded p-1">
                            {[['Steps',card.stats.steps,'text-white'],['Pend',card.stats.pending,'text-yellow-400'],['Up$',`$${card.stats.upsellGross.toFixed(0)}`,'text-green-400'],['Up',card.stats.upsellCount,'text-purple-400'],['EQ',card.stats.eq.toFixed(1),'text-blue-300']].map(([l,v,c])=>(
                              <div key={l as string}><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">{l}</div><div className={`text-[10px] font-bold ${c}`}>{v}</div></div>
                            ))}
                          </div>
                        </div>
                      ))
                )}
                {sidebarMode==='staff' && isTeamSeason && (
                  sortedCartCards.length===0
                    ? <div className="text-center text-gray-500 text-xs py-6 italic">No carts found.</div>
                    : sortedCartCards.map(cart => {
                        const isSoloCart = cart.members.length === 1;
                        const primaryWorker = cart.members[0];
                        const incomingCount = cart.asphaltIncomingRows.length;
                        const showAsphaltBadge = isSealing && incomingCount > 0;
                        const combinedName = isSoloCart
                          ? `${primaryWorker?.firstName || ''} ${primaryWorker?.lastName || ''}`
                          : cart.members.map(m => m.firstName).join(' & ');
                        return (
                          <div key={cart.sessionId} className="bg-gray-800 border border-gray-700 rounded-lg p-2 mb-1.5 hover:border-blue-500 transition-all cursor-pointer" onClick={()=>setSelectedCartForModal(cart)}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cart.stats.pending>0?'bg-yellow-500 animate-pulse':'bg-green-500'}`}/>
                                {!isSoloCart && (
                                  <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-green-900/30 border border-green-700/50 flex-shrink-0">
                                    <Truck size={9} className="text-green-400" />
                                    <span className="text-green-300 text-[9px] font-bold">{cart.members.length}</span>
                                  </div>
                                )}
                                <span className="font-bold text-white text-xs truncate">{combinedName}</span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>handleViewLogsheet(primaryWorker, cart.members)} className="p-1 rounded hover:bg-gray-700 text-cyan-400 hover:text-cyan-300" title="View cart logsheet"><Eye size={11}/></button>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-0.5 mb-1.5 pl-3">
                              {cart.assignedRoutes.slice(0,3).map((route,idx)=>{const color=routeColorMap.get(route)||'#6b7280';return(<span key={idx} style={{backgroundColor:`${color}22`,color,borderColor:`${color}88`}} className="px-1 py-0.5 rounded text-[8px] font-bold border font-mono">{route}</span>);})}
                              {cart.assignedRoutes.length>3 && <span className="px-1 py-0.5 rounded text-[8px] bg-gray-700 text-gray-400">+{cart.assignedRoutes.length-3}</span>}
                              {showAsphaltBadge && (
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] bg-amber-900/40 text-amber-300 border border-amber-700 font-bold" title={`${incomingCount} asphalt row(s) assigned`}>
                                  <Shovel size={8}/> {incomingCount}
                                </span>
                              )}
                            </div>
                            {cart.lastActiveAddress && (
                              <div className="flex items-center gap-1 text-[9px] text-gray-400 mb-1 pl-3 truncate">
                                <MapPin size={8} className="text-emerald-500 shrink-0" />
                                <span className="truncate">{cart.lastActiveAddress}{cart.lastActiveTime && <span className="text-gray-500"> • {cart.lastActiveTime}</span>}</span>
                              </div>
                            )}
                            <div className="grid grid-cols-5 gap-0.5 text-center bg-gray-900/50 rounded p-1">
                              <div><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">Steps</div><div className="text-[10px] font-bold text-white">{cart.stats.steps}</div></div>
                              <div>
                                <div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">Pend</div>
                                <div className="text-[10px] font-bold flex items-center justify-center gap-0.5">
                                  <span className="text-green-400">{cart.stats.pending}</span>
                                  {cart.stats.pendingSaleCount > 0 && (
                                    <>
                                      <span className="text-gray-600 text-[8px]">+</span>
                                      <span className="text-yellow-400 flex items-center gap-0.5"><Bookmark size={7}/>{cart.stats.pendingSaleCount}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">Up$</div><div className="text-[10px] font-bold text-green-400">${cart.stats.upsellGross.toFixed(0)}</div></div>
                              <div><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">Up</div><div className="text-[10px] font-bold text-purple-400">{cart.stats.upsellCount}</div></div>
                              <div><div className="text-[7px] text-gray-500 uppercase leading-none mb-0.5">EQ</div><div className="text-[10px] font-bold text-blue-300">{cart.stats.eq.toFixed(1)}</div></div>
                            </div>
                          </div>
                        );
                      })
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

      {/* Status overlays — keep loading routes message but drop the legacy
          "geocoding X/Y" overlay (filter-button badges show that now). */}
      {routesLoading && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/90 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm"><Loader size={12} className="animate-spin text-blue-400"/>Loading routes…</div>}
      {!routesLoading&&!routeMapData.length&&myRouteCodes.length>0&&mapLoaded && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 text-yellow-300 px-3 py-1.5 rounded-full shadow-lg text-xs font-medium backdrop-blur-sm">No map data for your routes</div>}

      {!mapLoaded && <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10"><Loader size={24} className="animate-spin text-blue-500"/></div>}

      {/* On-route contractor/cart button */}
      {(onRouteCartCard || onRouteWorkerCard) && (
        <button
          onClick={() => {
            if (onRouteCartCard) setSelectedCartForModal(onRouteCartCard);
            else if (onRouteWorkerCard) setSelectedWorkerForModal(onRouteWorkerCard);
          }}
          className="absolute bottom-20 right-3 z-40 bg-gray-900/95 backdrop-blur-sm text-white rounded-xl shadow-2xl border border-gray-600 px-6 py-5 flex items-center gap-4 hover:border-blue-500 active:scale-[0.97] transition-all max-w-[420px]"
        >
          {onRouteRedFlags.hasFlag && (
            <AlertTriangle size={32} className="text-red-500 flex-shrink-0 animate-pulse" />
          )}
          <div className="flex flex-col items-start min-w-0">
            <span className="font-bold text-xl leading-tight truncate w-full">
              {onRouteCartCard
                ? onRouteCartCard.members.map(m => m.firstName).join(' & ')
                : `${onRouteWorkerCard?.worker.firstName} ${onRouteWorkerCard?.worker.lastName}`}
            </span>
            <div className="flex items-center gap-3 text-sm mt-1">
              <span className="text-gray-400">Steps: <span className="text-white font-bold">{onRouteCartCard ? onRouteCartCard.stats.steps : onRouteWorkerCard?.stats.steps}</span></span>
              <span className="text-gray-400">Pend: <span className="text-yellow-400 font-bold">{onRouteCartCard ? onRouteCartCard.stats.pending : onRouteWorkerCard?.stats.pending}</span></span>
              <span className="text-gray-400">EQ: <span className="text-blue-300 font-bold">{(onRouteCartCard ? onRouteCartCard.stats.eq : onRouteWorkerCard?.stats.eq || 0).toFixed(1)}</span></span>
              <span className="text-gray-400">Up: <span className="text-purple-400 font-bold">{onRouteCartCard ? onRouteCartCard.stats.upsellCount : onRouteWorkerCard?.stats.upsellCount}</span></span>
            </div>
          </div>
        </button>
      )}

      {/* Worker detail modal */}
      {selectedWorkerForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.75)'}} onClick={e=>{if(e.target===e.currentTarget) setSelectedWorkerForModal(null);}}>
          <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'85vh'}}>
            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-white truncate">{selectedWorkerForModal.worker.firstName} {selectedWorkerForModal.worker.lastName}</h3>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                  <span className="font-mono">#{selectedWorkerForModal.worker.contractorId}</span>
                  {selectedWorkerForModal.worker.cellPhone && (
                    <button onClick={()=>handleCopyPhone(selectedWorkerForModal.worker.cellPhone!, selectedWorkerForModal.worker.contractorId)} className="flex items-center gap-1 text-blue-400 hover:underline">
                      <Phone size={10}/> {selectedWorkerForModal.worker.cellPhone}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                <button onClick={()=>handleViewLogsheet(selectedWorkerForModal.worker)} className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 text-xs">
                  <Eye size={12}/> Logsheet
                </button>
                <button onClick={()=>handleToggleUpsells(selectedWorkerForModal.worker.contractorId, selectedWorkerForModal.upsellsEnabled)} className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${selectedWorkerForModal.upsellsEnabled ? 'bg-purple-900/30 text-purple-300 border-purple-700/50' : 'bg-gray-700 text-gray-400 border-gray-600'}`} title="Toggle upsells">
                  Upsells {selectedWorkerForModal.upsellsEnabled ? 'ON' : 'OFF'}
                </button>
                <button onClick={()=>setSelectedWorkerForModal(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={18}/></button>
              </div>
            </div>
            <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0">
              <div className="grid grid-cols-5 gap-1 text-center bg-gray-900/50 rounded p-2 mb-2">
                {[['Steps',selectedWorkerForModal.stats.steps,'text-white'],['Pend',selectedWorkerForModal.stats.pending,'text-yellow-400'],['Up Gross',`$${selectedWorkerForModal.stats.upsellGross.toFixed(0)}`,'text-green-400'],['Upsells',selectedWorkerForModal.stats.upsellCount,'text-purple-400'],['EQ',selectedWorkerForModal.stats.eq.toFixed(2),'text-blue-300']].map(([l,v,c])=>(
                  <div key={l as string}><div className="text-[8px] text-gray-500 uppercase mb-0.5">{l}</div><div className={`text-sm font-bold ${c}`}>{v}</div></div>
                ))}
              </div>
              {selectedWorkerForModal.assignedRoutes.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedWorkerForModal.assignedRoutes.map((route, idx) => {
                    const color = routeColorMap.get(route) || '#6b7280';
                    return <span key={idx} style={{backgroundColor:`${color}22`,color,borderColor:`${color}88`}} className="px-1.5 py-0.5 rounded text-[10px] font-bold border font-mono">{route}</span>;
                  })}
                </div>
              )}
              {selectedWorkerForModal.lastActiveAddress && (
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <MapPin size={10} className="text-emerald-500" />
                  <span>{selectedWorkerForModal.lastActiveAddress}{selectedWorkerForModal.lastActiveTime && <span className="text-gray-500"> • {selectedWorkerForModal.lastActiveTime}</span>}</span>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
              <ContractorJobs bookings={selectedWorkerForModal.displayBookings} financialStore={selectedWorkerForModal.financialStore} onRefresh={onRefresh} seasonType={seasonType}/>
            </div>
          </div>
        </div>
      )}

      {/* Cart detail modal */}
      {selectedCartForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.75)'}} onClick={e=>{if(e.target===e.currentTarget) setSelectedCartForModal(null);}}>
          <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'85vh'}}>
            <div className="p-4 border-b border-gray-700 flex items-start justify-between flex-shrink-0 gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {selectedCartForModal.members.length > 1 ? (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/30 border border-green-700/50">
                      <Truck size={12} className="text-green-400"/>
                      <span className="text-green-300 text-xs font-bold">{selectedCartForModal.members.length}</span>
                    </div>
                  ) : null}
                  <h3 className="text-base font-bold text-white truncate">
                    {selectedCartForModal.members.map(m => m.firstName).join(' & ')}
                  </h3>
                  {selectedCartForModal.isRcCart && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-700 text-slate-200 border border-slate-500 font-bold">RC</span>
                  )}
                </div>
                {selectedCartForModal.assignedRoutes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {selectedCartForModal.assignedRoutes.map((route, idx) => {
                      const color = routeColorMap.get(route) || '#6b7280';
                      return <span key={idx} style={{backgroundColor:`${color}22`,color,borderColor:`${color}88`}} className="px-1.5 py-0.5 rounded text-[10px] font-bold border font-mono">{route}</span>;
                    })}
                  </div>
                )}
                {selectedCartForModal.lastActiveAddress && (
                  <div className="flex items-center gap-1 text-[11px] text-gray-400">
                    <MapPin size={10} className="text-emerald-500"/>
                    <span>{selectedCartForModal.lastActiveAddress}{selectedCartForModal.lastActiveTime && <span className="text-gray-500"> • {selectedCartForModal.lastActiveTime}</span>}</span>
                  </div>
                )}
              </div>
              <button onClick={()=>setSelectedCartForModal(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white flex-shrink-0"><X size={18}/></button>
            </div>
            <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0">
              <div className="grid grid-cols-5 gap-1 text-center bg-gray-900/50 rounded p-2 mb-3">
                <div><div className="text-[8px] text-gray-500 uppercase mb-0.5">Steps</div><div className="text-sm font-bold text-white">{selectedCartForModal.stats.steps}</div></div>
                <div>
                  <div className="text-[8px] text-gray-500 uppercase mb-0.5">Pend</div>
                  <div className="text-sm font-bold flex items-center justify-center gap-1">
                    <span className="text-green-400">{selectedCartForModal.stats.pending}</span>
                    {selectedCartForModal.stats.pendingSaleCount > 0 && (
                      <>
                        <span className="text-gray-600 text-[9px]">+</span>
                        <span className="text-yellow-400 flex items-center gap-0.5"><Bookmark size={8}/>{selectedCartForModal.stats.pendingSaleCount}</span>
                      </>
                    )}
                  </div>
                </div>
                <div><div className="text-[8px] text-gray-500 uppercase mb-0.5">Up Gross</div><div className="text-sm font-bold text-green-400">${selectedCartForModal.stats.upsellGross.toFixed(0)}</div></div>
                <div><div className="text-[8px] text-gray-500 uppercase mb-0.5">Upsells</div><div className="text-sm font-bold text-purple-400">{selectedCartForModal.stats.upsellCount}</div></div>
                <div><div className="text-[8px] text-gray-500 uppercase mb-0.5">EQ</div><div className="text-sm font-bold text-blue-300">{selectedCartForModal.stats.eq.toFixed(2)}</div></div>
              </div>
              <div className="space-y-1">
                {selectedCartForModal.members.map(member => (
                  <div key={member.contractorId} className="flex items-center justify-between gap-2 p-1.5 bg-gray-900/50 rounded border border-gray-700/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-cps-blue flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-white truncate">{member.firstName} {member.lastName}</span>
                        <span className="text-[9px] text-gray-500 font-mono">#{member.contractorId}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {member.cellPhone && (
                        <button onClick={()=>handleCopyPhone(member.cellPhone!, member.contractorId)} className="flex items-center gap-1 text-[10px] text-blue-400 hover:underline">
                          <Phone size={10}/> {member.cellPhone}
                        </button>
                      )}
                      <button onClick={()=>handleViewLogsheet(member, selectedCartForModal.members)} className="p-1 rounded hover:bg-gray-700 text-cyan-400 hover:text-cyan-300" title="View this member's logsheet"><Eye size={11}/></button>
                      <button onClick={()=>handleToggleUpsells(member.contractorId, (member as any).upsellsEnabled !== false)} className={`px-1.5 py-0.5 rounded text-[9px] border ${(member as any).upsellsEnabled !== false ? 'bg-purple-900/30 text-purple-300 border-purple-700/50' : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                        UP {(member as any).upsellsEnabled !== false ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
              {isSealing && selectedCartForModal.asphaltIncomingRows.length > 0 && (
                <div className="m-3 p-2 bg-amber-900/10 border border-amber-700/30 rounded">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Shovel size={12} className="text-amber-400" />
                    <h4 className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
                      Asphalt Assigned to this Cart ({selectedCartForModal.asphaltIncomingRows.length})
                    </h4>
                  </div>
                  {unassignError && (
                    <div className="mb-2 p-1.5 bg-red-900/30 border border-red-700 rounded text-[10px] text-red-300 flex items-center gap-1.5">
                      <AlertCircle size={11} className="shrink-0"/> {unassignError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {selectedCartForModal.asphaltIncomingRows.map(asphalt => {
                      const isUnassigning = unassigningAsphaltId === asphalt.id;
                      const address = assembleAddressFromPending(asphalt);
                      const isDeferred = typeof asphalt.sharedJobKey === 'string' && asphalt.sharedJobKey.length > 0;
                      return (
                        <div key={asphalt.id} className="flex items-center justify-between gap-2 p-2 bg-amber-900/15 border border-amber-700/40 rounded">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="bg-gray-700 text-gray-300 text-[9px] font-mono px-1.5 py-0.5 rounded border border-gray-600">{asphalt.routeCode || '--'}</span>
                              {isDeferred && <span className="text-[9px] font-bold bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700">DEFERRED</span>}
                            </div>
                            <div className="flex items-center gap-1 text-gray-200 text-xs truncate"><MapPin size={10} className="text-gray-500 shrink-0"/><span className="truncate">{address}</span></div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-amber-200 font-mono font-bold text-sm flex items-center gap-1"><Shovel size={11} className="text-amber-400"/>{formatAsphaltDollars(asphalt.asphaltAmount)}</span>
                            <button onClick={()=>handleUnassignAsphalt(asphalt.id, address)} disabled={isUnassigning} title="Unassign — returns this row to the unassigned queue" className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 hover:text-red-300 border border-gray-600 hover:border-red-700 rounded text-[10px] font-bold transition-colors">
                              {isUnassigning ? <Loader size={10} className="animate-spin"/> : <Undo2 size={10}/>}
                              Unassign
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <ContractorJobs bookings={selectedCartForModal.sharedBookings} financialStore={selectedCartForModal.sharedFinancialStore} onRefresh={onRefresh} seasonType={seasonType}/>
            </div>
          </div>
        </div>
      )}

      {/* Route prebookings popup */}
      {selectedRouteForBookings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.75)'}} onClick={e=>{if(e.target===e.currentTarget) setSelectedRouteForBookings(null);}}>
          <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'85vh'}}>
            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span style={{color:routeColorMap.get(selectedRouteForBookings)||'#6b7280'}} className="font-mono font-black text-xl">Route {selectedRouteForBookings}</span>
                <span className="text-white font-bold text-xs">{selectedRouteBookings.length} jobs</span>
                <span className="text-green-400 font-bold text-xs">{selectedRouteBookings.filter(b=>b.Prepaid==='x').length} prepaid</span>
              </div>
              <button onClick={()=>setSelectedRouteForBookings(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{scrollbarWidth:'thin'}}>
              {selectedRouteBookings.map(job => {
                const isCompleted = job.Status === 'completed' || job.Completed === 'x';
                const isNextTime = job.Status === 'next_time';
                const isCancelled = job.Status === 'cancelled';
                const notes = job['Log Sheet Notes'] || '';
                const services = job.services;
                const jobWorker = job['Contractor Number'] ? myTeamWorkers.find(w => w.contractorId === job['Contractor Number']) : null;
                let statusBadge = null;
                if (isNextTime) statusBadge = <span className="text-[9px] bg-orange-900/30 text-orange-400 px-1 py-0.5 rounded border border-orange-800 font-bold">NEXT TIME</span>;
                else if (isCancelled) statusBadge = <span className="text-[9px] bg-red-900/30 text-red-400 px-1 py-0.5 rounded border border-red-800 font-bold">CANCELLED</span>;
                return (
                  <div key={job['Booking ID']} onClick={()=>{ if(!isCompleted) setPendingJobForModal(job); }}
                    className={`p-2 rounded border flex flex-col gap-2 transition-colors ${isCompleted ? 'bg-green-900/10 border-green-900/30 opacity-75' : isCancelled ? 'bg-red-900/10 border-red-900/30 cursor-pointer hover:border-red-700' : isNextTime ? 'bg-orange-900/10 border-orange-900/30 cursor-pointer hover:border-orange-700' : 'bg-gray-800 border-gray-700 cursor-pointer hover:border-cps-blue'}`}>
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-gray-200 text-sm truncate flex items-center gap-2 flex-wrap">
                          <span className={isCancelled ? 'line-through text-gray-500' : ''}>{job['First Name']} {job['Last Name']}</span>
                          {statusBadge}
                          {isLawnRejuv && services && (
                            <div className="flex gap-0.5">
                              {services.aeration && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-900/50 text-blue-300 font-bold">A</span>}
                              {services.dethatch && <span className="text-[8px] px-1 py-0.5 rounded bg-orange-900/50 text-orange-300 font-bold">D</span>}
                              {services.fertilizer && <span className="text-[8px] px-1 py-0.5 rounded bg-green-900/50 text-green-300 font-bold">F</span>}
                              {services.seed && <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-900/50 text-yellow-300 font-bold">S</span>}
                              {services.lime && <span className="text-[8px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold">L</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 truncate"><MapPin size={10}/> {job['Full Address']}</div>
                        {job['Home Phone'] && (
                          <button onClick={e=>{e.stopPropagation(); handleCopyPhone(job['Home Phone']!, `ph-${job['Booking ID']}`);}} className="text-blue-400 text-xs flex items-center gap-1 hover:underline mt-1 w-fit">
                            <Phone size={10}/> {job['Home Phone']}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {job.Prepaid === 'x' && <span className="text-[9px] bg-green-900/30 text-green-400 px-1 py-0.5 rounded border border-green-800 font-bold">PP</span>}
                          <span className={`font-mono text-sm font-bold ${isCancelled ? 'text-gray-500 line-through' : 'text-gray-300'}`}>{job.Price}</span>
                        </div>
                        {!isCompleted && (
                          <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${jobWorker ? 'bg-gray-700 border-green-900/50 text-green-400' : 'bg-gray-700 border-gray-600 text-gray-400'}`}>
                            <Users size={10}/> <span className="truncate max-w-[60px]">{jobWorker ? jobWorker.firstName : 'Unassigned'}</span>
                          </span>
                        )}
                        {isCompleted && <span className="flex items-center gap-1 text-[10px] text-green-500 font-bold bg-green-900/20 px-1.5 py-0.5 rounded border border-green-900/30"><Check size={10}/> Done</span>}
                      </div>
                    </div>
                    {notes && (
                      <div className="flex items-center gap-1.5 bg-gray-900/50 border border-gray-700/50 rounded px-2 py-1.5 text-[10px] text-gray-400 font-mono italic">
                        <FileText size={10} className="flex-shrink-0 text-gray-600"/>
                        <span className="truncate">{notes}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* PendingJobModal */}
      {pendingJobForModal && (
        <PendingJobModal
          job={pendingJobForModal}
          onClose={()=>setPendingJobForModal(null)}
          onUpdate={()=>{ setPendingJobForModal(null); onRefresh(); }}
          seasonType={seasonType}
        />
      )}

      {/* Route assignment modal */}
      {assignModalData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.85)'}} onClick={e=>{if(e.target===e.currentTarget) setAssignModalData(null);}}>
          <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-2xl w-full max-w-md flex flex-col" style={{maxHeight:'85vh'}}>
            <div className="p-4 border-b border-gray-700 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <MapPin size={15} style={{color:assignModalData.routeColor}}/>
                  Assign Route <span style={{color:assignModalData.routeColor}} className="font-mono font-black">{assignModalData.routeCode}</span>
                  {isTeamSeason && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ml-2 ${isSealing ? 'bg-slate-800 text-slate-300 border-slate-600' : 'bg-green-900/30 text-green-400 border-green-700/50'}`}>Cart Mode</span>
                  )}
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
              {isTeamSeason && contractorsByCart ? (
                Array.from(contractorsByCart.entries()).map(([cartId, cartWorkers]) => {
                  const isSoloCart = cartWorkers.length === 1;
                  const primaryWorker = cartWorkers[0];
                  const isSelected = cartWorkers.some(w => assignModalData.currentWorkerIds.includes(w.contractorId));
                  const cartLabel = isSoloCart
                    ? `${primaryWorker.firstName} ${primaryWorker.lastName}`
                    : cartWorkers.map(w => w.firstName).join(' & ');
                  return (
                    <button key={cartId} onClick={()=>handleAssignRoute(primaryWorker.contractorId)} disabled={assignLoading}
                      className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center justify-between gap-3 transition-colors ${isSelected ? 'bg-blue-900/20 border border-blue-700/50 text-white' : 'text-gray-300 hover:bg-gray-800 border border-transparent'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isSoloCart ? (isSelected ? 'bg-cps-blue text-white' : 'bg-gray-700 text-gray-300') : (isSealing ? 'bg-slate-700 text-slate-100' : 'bg-green-900/40 text-green-300 border border-green-700/50')}`}>
                          {isSoloCart ? `${primaryWorker.firstName.charAt(0)}${primaryWorker.lastName.charAt(0)}` : (
                            <div className="flex flex-col items-center"><Truck size={12}/><span className="text-[8px]">{cartWorkers.length}</span></div>
                          )}
                        </div>
                        <span className="font-medium truncate">{cartLabel}</span>
                      </div>
                      {isSelected && <span className="text-[9px] text-blue-400 font-bold">ASSIGNED</span>}
                    </button>
                  );
                })
              ) : (
                myTeamWorkers.sort((a,b)=>a.firstName.localeCompare(b.firstName)).map(worker=>{
                  const isSel=assignModalData.currentWorkerIds.includes(worker.contractorId);
                  return (
                    <button key={worker.contractorId} onClick={()=>handleAssignRoute(worker.contractorId)} disabled={assignLoading}
                      className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center justify-between gap-3 transition-colors ${isSel?'bg-blue-900/20 border border-blue-700/50 text-white':'text-gray-300 hover:bg-gray-800 border border-transparent'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${isSel?'bg-blue-600':'bg-gray-600'}`}>{worker.firstName.charAt(0)}{worker.lastName.charAt(0)}</div>
                        <span className="font-medium">{worker.firstName} {worker.lastName}</span>
                      </div>
                      {isSel&&<span className="text-[9px] text-blue-400 font-bold">ASSIGNED</span>}
                    </button>
                  );
                })
              )}
            </div>
            {availableManagers.length > 0 && assignModalData.currentWorkerIds.length === 0 && (
              <div className="p-3 border-t border-gray-700 flex-shrink-0">
                <button onClick={openTransferModal} className="w-full px-3 py-2.5 text-blue-400 hover:bg-blue-900/10 rounded flex items-center gap-2 text-sm border border-transparent hover:border-blue-900/30 transition-all">
                  <Shuffle size={14}/> Transfer Route to Another Manager
                </button>
              </div>
            )}
            {assignLoading&&<div className="p-3 border-t border-gray-700 flex items-center justify-center gap-2 text-gray-400 text-sm flex-shrink-0"><Loader size={14} className="animate-spin"/>Saving…</div>}
          </div>
        </div>
      )}

      {/* Transfer route modal */}
      {transferModalData && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.85)'}} onClick={e=>{if(e.target===e.currentTarget) setTransferModalData(null);}}>
          <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-2xl w-full max-w-sm flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-white flex items-center gap-2"><Shuffle size={16} className="text-blue-400"/>{transferModalData.title}</h3>
              <button onClick={()=>setTransferModalData(null)} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={16}/></button>
            </div>
            <div className="p-3 space-y-1 max-h-64 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
              {availableManagers.map(manager => (
                <button key={manager.userId} onClick={()=>handleTransferConfirm(manager.userId)} className="w-full text-left px-3 py-2.5 rounded text-sm flex items-center gap-3 transition-colors text-gray-300 hover:bg-gray-800 border border-transparent hover:border-blue-900/30">
                  <div className="w-7 h-7 rounded-full bg-blue-900/30 border border-blue-700 flex items-center justify-center text-blue-300 font-bold text-[10px]">{manager.name.split(' ').map(n=>n[0]).join('')}</div>
                  <span className="font-medium">{manager.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Manage Team modal — controlled by parent prop */}
      {showManageTeamModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.85)'}} onClick={e=>{if(e.target===e.currentTarget) onCloseManageTeamModal();}}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-orange-400"/>
                <h3 className="text-lg font-bold text-white">Manage Team</h3>
                {isTeamSeason && (
                  <span className="text-xs bg-orange-900/30 text-orange-400 border border-orange-700/50 px-2 py-0.5 rounded">Transactions stay with original cart</span>
                )}
              </div>
              <button onClick={onCloseManageTeamModal} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><X size={18}/></button>
            </div>
            {reassignSuccess && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2 text-green-300 text-sm">
                <Check size={16}/>{reassignSuccess}
              </div>
            )}
            {reassignError && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertCircle size={16}/>{reassignError}
              </div>
            )}
            <div className="flex flex-1 overflow-hidden">
              <div className="w-1/2 border-r border-gray-700 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50 flex-shrink-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{selectedWorkerToMove ? '✓ Worker selected' : '1. Select worker'}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {isTeamSeason ? (
                    sortedCartCards.map(cart => (
                      <div key={cart.sessionId} className={`rounded-lg border overflow-hidden ${selectedWorkerSourceCart?.sessionId === cart.sessionId ? 'border-orange-600/50 bg-orange-900/10' : 'border-gray-700 bg-gray-800/50'}`}>
                        <div className="px-3 py-1.5 bg-gray-800/80 border-b border-gray-700/50 flex items-center gap-2">
                          {cart.members.length > 1 ? (
                            <><Truck size={11} className="text-green-400"/><span className="text-[10px] text-green-400 font-bold">Cart ({cart.members.length})</span></>
                          ) : (<span className="text-[10px] text-gray-500 font-bold">Solo</span>)}
                          <span className="text-[10px] text-gray-600 font-mono ml-auto">{cart.stats.eq.toFixed(1)} EQ</span>
                        </div>
                        {cart.members.map(member => {
                          const isSelected = selectedWorkerToMove?.contractorId === member.contractorId;
                          return (
                            <button key={member.contractorId} onClick={()=>{setSelectedWorkerToMove(member); setSelectedWorkerSourceCart(cart); setReassignError(null); setReassignSuccess(null); setReassignManagerId('');}}
                              className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-sm ${isSelected ? 'bg-orange-900/30 text-orange-200' : 'hover:bg-gray-700/50 text-gray-300'}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isSelected ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                                {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate">{member.firstName} {member.lastName}</div>
                                <div className="text-[10px] text-gray-500 font-mono">#{member.contractorId}</div>
                              </div>
                              {isSelected && <Check size={14} className="text-orange-400 ml-auto flex-shrink-0"/>}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    myTeamWorkers.map(worker => {
                      const isModifiable = isAerationWorkerModifiable(worker);
                      const isSelected = selectedWorkerToMove?.contractorId === worker.contractorId;
                      return (
                        <button key={worker.contractorId} disabled={!isModifiable} onClick={()=>{if(!isModifiable) return; setSelectedWorkerToMove(worker); setSelectedWorkerSourceCart(null); setReassignError(null); setReassignSuccess(null); setReassignManagerId('');}}
                          className={`w-full text-left px-3 py-2 flex items-center gap-2 rounded transition-colors text-sm ${!isModifiable ? 'opacity-40 cursor-not-allowed bg-gray-800/30' : isSelected ? 'bg-orange-900/30 text-orange-200 border border-orange-700/50' : 'hover:bg-gray-700/50 text-gray-300 border border-transparent'}`}
                          title={!isModifiable ? 'Worker has transactions — cannot be reassigned' : ''}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isSelected ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                            {worker.firstName.charAt(0)}{worker.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{worker.firstName} {worker.lastName}</div>
                            <div className="text-[10px] text-gray-500 font-mono">#{worker.contractorId}</div>
                          </div>
                          {!isModifiable && <span className="text-[9px] text-gray-500 italic">has txns</span>}
                          {isSelected && <Check size={14} className="text-orange-400 flex-shrink-0"/>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="w-1/2 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50 flex-shrink-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">2. Move to…</p>
                </div>
                {!selectedWorkerToMove ? (
                  <div className="flex-1 flex items-center justify-center text-gray-600 text-sm italic p-4 text-center">
                    Select a worker on the left to see move options
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div className="flex items-center gap-2 bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2">
                      <div className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                        {selectedWorkerToMove.firstName.charAt(0)}{selectedWorkerToMove.lastName.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{selectedWorkerToMove.firstName} {selectedWorkerToMove.lastName}</div>
                        {selectedWorkerSourceCart && (
                          <div className="text-[10px] text-orange-400">From: {selectedWorkerSourceCart.members.map(m => m.firstName).join(' & ')}</div>
                        )}
                      </div>
                    </div>

                    {isTeamSeason && (
                      <>
                        {sortedCartCards.filter(c => c.sessionId !== selectedWorkerSourceCart?.sessionId).length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Join existing cart</p>
                            <div className="space-y-1">
                              {sortedCartCards.filter(c => c.sessionId !== selectedWorkerSourceCart?.sessionId).map(targetCart => {
                                const label = targetCart.members.map(m => m.firstName).join(' & ');
                                const newSize = targetCart.members.length + 1;
                                const newRate = newSize >= 2 ? `$${SEASON_CONFIGS[seasonType].payoutRateTeam}/EQ` : `$${SEASON_CONFIGS[seasonType].payoutRateSolo}/EQ`;
                                return (
                                  <button key={targetCart.sessionId} disabled={reassignLoading} onClick={()=>handleReassignWorker({type:'existing_cart', targetSessionId: targetCart.sessionId, label})}
                                    className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-blue-500 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {targetCart.members.length > 1 ? <Truck size={14} className="text-green-400 flex-shrink-0"/> : <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{targetCart.members[0]?.firstName.charAt(0)}</div>}
                                      <div className="min-w-0">
                                        <div className="font-medium text-gray-200 truncate">{label}</div>
                                        <div className="text-[10px] text-gray-500">{targetCart.stats.eq.toFixed(1)} EQ</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <span className="text-[10px] text-blue-400 bg-blue-900/30 border border-blue-700/50 px-1.5 py-0.5 rounded">→ {newRate}</span>
                                      {reassignLoading ? <Loader size={12} className="animate-spin text-gray-400"/> : <ArrowRight size={14} className="text-gray-500"/>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Split off</p>
                          <button disabled={reassignLoading || selectedWorkerSourceCart?.members.length === 1} onClick={()=>handleReassignWorker({type:'new_solo'})}
                            className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-yellow-500 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                            <div className="flex items-center gap-2">
                              <UserPlus size={14} className="text-yellow-400 flex-shrink-0"/>
                              <div>
                                <div className="font-medium text-gray-200">Create solo cart</div>
                                <div className="text-[10px] text-gray-500">New cart, fresh start</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-yellow-400 bg-yellow-900/30 border border-yellow-700/50 px-1.5 py-0.5 rounded">${SEASON_CONFIGS[seasonType].payoutRateSolo}/EQ</span>
                              {reassignLoading ? <Loader size={12} className="animate-spin text-gray-400"/> : <ArrowRight size={14} className="text-gray-500"/>}
                            </div>
                          </button>
                          {selectedWorkerSourceCart?.members.length === 1 && (
                            <p className="text-[10px] text-gray-600 italic mt-1 pl-1">Already solo — join a cart instead</p>
                          )}
                        </div>
                      </>
                    )}

                    {availableManagers.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Move to different manager</p>
                        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 space-y-2">
                          <select value={reassignManagerId} onChange={e=>setReassignManagerId(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">Select manager...</option>
                            {availableManagers.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                          </select>
                          <button disabled={reassignLoading || !reassignManagerId} onClick={()=>{
                            if (isTeamSeason) handleReassignWorker({type:'different_manager', targetManagerId: reassignManagerId});
                            else handleAerationTransfer(reassignManagerId);
                          }} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-bold transition-colors disabled:cursor-not-allowed">
                            {reassignLoading ? <Loader size={14} className="animate-spin"/> : <Shuffle size={14}/>}
                            Transfer to Manager
                          </button>
                          {isTeamSeason && (
                            <p className="text-[10px] text-gray-600 italic">Worker gets a new solo cart under the new manager</p>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">No-show</p>
                      <button disabled={reassignLoading} onClick={handleRemoveWorkerNoShow}
                        className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-red-900/20 border border-gray-600 hover:border-red-700 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                        <div className="flex items-center gap-2">
                          <UserMinus size={14} className="text-red-400 flex-shrink-0"/>
                          <div>
                            <div className="font-medium text-red-300">Remove from session</div>
                            <div className="text-[10px] text-gray-500">Removes worker & stats entirely</div>
                          </div>
                        </div>
                        {reassignLoading ? <Loader size={12} className="animate-spin text-gray-400"/> : <Trash2 size={14} className="text-red-500 flex-shrink-0"/>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="p-3 border-t border-gray-700 flex justify-end flex-shrink-0">
              <button onClick={onCloseManageTeamModal} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RMMapTab;