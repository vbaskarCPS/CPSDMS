// src/pages/Management/components/RMMapTab.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Loader, ChevronLeft, ChevronRight, X, Users, Eye, Phone, MapPin,
  AlertCircle, LayoutList, AlertTriangle, Truck, Bookmark, Shovel, Leaf,
  FileText, Check, ArrowRight, ArrowRightLeft, Shuffle, Trash2, UserPlus,
  UserMinus, Undo2, Navigation2, Compass, Scissors,
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
  SessionTransaction, RouteSplit,
} from '../../../types';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';
import ContractorJobs from './ContractorJobs';
import PendingJobModal from '../../../components/PendingJobModal';
import RMNavigation, { NavDestination } from './RMNavigation';
import RouteSplitModal from '../../../components/RouteSplitModal';
import type { GeocodePhase, GeocodeProgress, FilterVisibility } from '../RMLogbook';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// --- INTERFACES ---

interface SavedRoute {
  id: string; area_name: string; route_number: number; route_code: string; route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}
interface PinData {
  id: string; address: string; routeCode: string; name: string;
  status: 'pending' | 'completed' | 'new_sale' | 'upsell';
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
  // NEW: nav-related — RMMapTab owns nav state, but follow-me lives in RMLogbook.
  // When nav starts, we ask RMLogbook to turn on follow-me if it's off.
  onForceFollowMeOn?: () => void;
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
  routeCode: string;
  displayRouteCode: string;
  routeColor: string;
  assignedWorkerIds: string[];
  assignedWorkerLabel: string;
  prebookCount: number;
  prepayCount: number;
  totalEQ: number;
  isAssigned: boolean;
  isSplit: boolean;
  letter?: string;
  baseRouteCode: string;
}

interface AssignModalData {
  routeCode: string;
  displayRouteCode: string;
  routeColor: string;
  prebookCount: number;
  prepayCount: number;
  totalEQ: number;
  currentWorkerIds: string[];
  letter?: string;
  canSplit: boolean;
}

interface NavState {
  destination: NavDestination;
  targetKey: string;
}

interface SwitchNavConfirmation {
  newDestination: NavDestination;
  newTargetKey: string;
  currentLabel: string;
  newLabel: string;
}

interface RouteNavPromptEntry {
  type: 'worker' | 'cart';
  label: string;
  card: WorkerCardData | CartCardData;
  hasGeocodableAddress: boolean;
}

interface RouteNavPrompt {
  routeCode: string;
  routeColor: string;
  entries: RouteNavPromptEntry[];
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

function colorForBucket(baseHex: string, letter: string | undefined): string {
  if (!letter || letter === 'a') return baseHex;
  const idx = letter.charCodeAt(0) - 'a'.charCodeAt(0);
  if (idx <= 0) return baseHex;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(baseHex || '');
  if (!m) return '#facc15';
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else h = ((r - g) / d + 4);
    h *= 60;
  }
  const newH = ((h + idx * 60) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((newH / 60) % 2) - 1));
  const mm = l - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (newH < 60) { rr = c; gg = x; bb = 0; }
  else if (newH < 120) { rr = x; gg = c; bb = 0; }
  else if (newH < 180) { rr = 0; gg = c; bb = x; }
  else if (newH < 240) { rr = 0; gg = x; bb = c; }
  else if (newH < 300) { rr = x; gg = 0; bb = c; }
  else { rr = c; gg = 0; bb = x; }
  const to = (v: number) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

function bucketForPoint(lng: number, lat: number, buckets: Array<{letter: string; sourceLetter: string | null; rectangles: Array<{west: number; east: number; south: number; north: number}>}>): string {
  let current = 'a';
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.sourceLetter !== current) continue;
    if (!b.rectangles || b.rectangles.length === 0) continue;
    for (const r of b.rectangles) {
      if (lng >= r.west && lng <= r.east && lat >= r.south && lat <= r.north) {
        current = b.letter;
        break;
      }
    }
  }
  return current;
}

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

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const cosLat = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const dy = (lat2 - lat1) * mPerDegLat;
  const dx = (lng2 - lng1) * mPerDegLng;
  return Math.sqrt(dx * dx + dy * dy);
}

function createNavArrow(): { outer: HTMLDivElement; inner: HTMLDivElement } {
  const outer = document.createElement('div');
  outer.style.cssText = 'pointer-events:none;width:29px;height:29px;';

  const inner = document.createElement('div');
  inner.style.cssText = 'width:100%;height:100%;transition:transform 0.15s linear;transform-origin:50% 50%;';
  inner.innerHTML = `<svg width="29" height="29" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#000000" stroke="#ffffff" stroke-width="1.5" opacity="0.35"/><path d="M12 3 L18.5 19 L12 14.5 L5.5 19 Z" fill="#ef4444" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  outer.appendChild(inner);
  return { outer, inner };
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

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return ((theta * 180 / Math.PI) + 360) % 360;
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

// --- createDashedRotatingRing — RING RESTYLE (Item 2) ---
//
// Marker used for pending-sale dots. RESTYLED per request:
//   - dashes are now BLACK (#000000) instead of grey
//   - dash stroke is a little THICKER (1.5 -> 2.2)
//   - the ring still SPINS (rmDashedSpin animation unchanged)
//   - the centre dot is now painted the ROUTE COLOUR (passed in), matching the
//     colour the completed-transaction pins use for that route. Falls back to
//     the previous grey (#6b7280) when no colour is supplied, so any other
//     caller (or a sale with an unknown route) degrades gracefully.
//
// routeColor: hex string for this pending sale's route. The call site looks it
// up from routeColorMap by the sale's route code.
function createDashedRotatingRing(routeColor?: string): HTMLDivElement {
  let spinStyle = document.getElementById('rm-spin-keyframes') as HTMLStyleElement | null;
  if (!spinStyle) {
    spinStyle = document.createElement('style');
    spinStyle.id = 'rm-spin-keyframes';
    document.head.appendChild(spinStyle);
  }
  spinStyle.textContent = `@keyframes rmDashedSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;
  const centreColor = routeColor || '#6b7280';
  const el = document.createElement('div');
  el.style.cssText = 'width:0;height:0;overflow:visible;pointer-events:auto;cursor:pointer;';
  el.innerHTML = `
    <div style="position:relative;width:12px;height:12px;margin-left:-6px;margin-top:-6px;">
      <svg width="12" height="12" viewBox="0 0 12 12" style="position:absolute;top:0;left:0;animation:rmDashedSpin 3s linear infinite;">
        <circle cx="6" cy="6" r="5" fill="none" stroke="#000000" stroke-width="2.2" stroke-dasharray="2.5,2" opacity="0.95"/>
      </svg>
      <div style="position:absolute;top:4px;left:4px;width:4px;height:4px;border-radius:50%;background:${centreColor};"></div>
    </div>
  `;
  return el;
}

const WORKER_LOCATION_POLL_MS = 5 * 60 * 1000;

function resolveNavDestination(financialStore: any[]): { lat: number; lng: number; address: string } | null {
  if (!financialStore || financialStore.length === 0) return null;
  const sorted = [...financialStore].sort((a, b) => {
    const ta = a?.timestamp || '';
    const tb = b?.timestamp || '';
    return tb.localeCompare(ta);
  });
  for (const tx of sorted) {
    if (!tx) continue;
    const address: string = tx.address || '';
    if (!address) continue;
    if (tx.jobId) {
      const ic = jobIdCache.get(tx.jobId);
      if (ic && ic.lat != null && ic.lng != null) {
        return { lat: ic.lat, lng: ic.lng, address: ic.address || address };
      }
    }
    const key = makeCacheKey(address);
    const gc = geocodeCache.get(key);
    if (gc && gc.lat != null && gc.lng != null) {
      return { lat: gc.lat, lng: gc.lng, address };
    }
  }
  return null;
}

function lineMidCoord(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function bucketCentroid(
  segments: Array<{ coordinates: [number, number][] }>,
  buckets: Array<{ letter: string; sourceLetter: string | null; rectangles: Array<{west: number; east: number; south: number; north: number}> }>,
  targetLetter: string
): { lng: number; lat: number } | null {
  let sumLng = 0, sumLat = 0, count = 0;
  for (const seg of segments) {
    const cs = seg.coordinates;
    if (!cs || cs.length < 2) continue;
    for (let i = 0; i < cs.length - 1; i++) {
      const a = cs[i];
      const b = cs[i + 1];
      const mid = lineMidCoord(a, b);
      if (bucketForPoint(mid[0], mid[1], buckets) === targetLetter) {
        sumLng += mid[0];
        sumLat += mid[1];
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { lng: sumLng / count, lat: sumLat / count };
}

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
  onForceFollowMeOn,
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
  const knownUpsellPinsRef = useRef<Map<string, GeocodedPin>>(new Map());
  const [geocodedUpsellPins, setGeocodedUpsellPins] = useState<GeocodedPin[]>([]);
  const mountedRef = useRef(true);
  const centerOnLocationRef = useRef(false);
  const lastCenteredAtRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  const navArrowInnerRef = useRef<HTMLDivElement | null>(null);
  const compassHeadingRef = useRef<number | null>(null);
  const gpsHeadingRef = useRef<number | null>(null);
  const gpsHeadingUpdatedAtRef = useRef<number>(0);
  const lastGpsPosRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const compassHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  const [compassNeedsPermission, setCompassNeedsPermission] = useState(false);
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

  const [routeSplits, setRouteSplits] = useState<RouteSplit[]>([]);
  const [splitModalData, setSplitModalData] = useState<{
    routeCode: string;
    baseRouteColor: string;
    segments: SavedRoute['segments'];
    prebookings: { bookingId: string; lat: number; lng: number }[];
    existingBuckets: RouteSplit['buckets'] | null;
    splittingFromLetter: string;
    newLetter: string;
    allBookingIdsOnRoute: string[];
  } | null>(null);

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

  const [historicalProps, setHistoricalProps] = useState<HistoricalProperty[]>([]);
  const [geocodedHistorical, setGeocodedHistorical] = useState<GeocodedHistorical[]>([]);
  const knownHistoricalRef = useRef<Map<string, GeocodedHistorical>>(new Map());
  const [geocodeCacheHydrated, setGeocodeCacheHydrated] = useState(false);

  const [geocodedPendingSales, setGeocodedPendingSales] = useState<GeocodedPendingSale[]>([]);
  const pendingSaleMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [pclByRoute, setPclByRoute] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [geocodedPCL, setGeocodedPCL] = useState<GeocodedPCLEntry[]>([]);

  const [cartCardData, setCartCardData] = useState<CartCardData[]>([]);

  const [taxRate, setTaxRate] = useState<number>(5);
  const [productCostPercent, setProductCostPercent] = useState<number>(0);

  const [pendingJobForModal, setPendingJobForModal] = useState<MasterBooking | null>(null);
  const [transferModalData, setTransferModalData] = useState<{
    type: 'ROUTE' | 'JOB';
    targetId: string;
    routeCode: string;
    title: string;
  } | null>(null);

  const [selectedWorkerToMove, setSelectedWorkerToMove] = useState<Worker | null>(null);
  const [selectedWorkerSourceCart, setSelectedWorkerSourceCart] = useState<CartCardData | null>(null);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignSuccess, setReassignSuccess] = useState<string | null>(null);
  const [reassignManagerId, setReassignManagerId] = useState('');

  const [unassigningAsphaltId, setUnassigningAsphaltId] = useState<string | null>(null);
  const [unassignError, setUnassignError] = useState<string | null>(null);

  const [navState, setNavState] = useState<NavState | null>(null);
  const [switchNavConfirm, setSwitchNavConfirm] = useState<SwitchNavConfirmation | null>(null);
  const [routeNavPrompt, setRouteNavPrompt] = useState<RouteNavPrompt | null>(null);

  const HEADING_FRESHNESS_MS = 5000;
  const applyArrowRotation = useCallback(() => {
    if (!navArrowInnerRef.current) return;
    let heading: number | null = null;
    const now = Date.now();
    if (
      gpsHeadingRef.current != null &&
      !isNaN(gpsHeadingRef.current) &&
      now - gpsHeadingUpdatedAtRef.current < HEADING_FRESHNESS_MS
    ) {
      heading = gpsHeadingRef.current;
    } else if (compassHeadingRef.current != null && !isNaN(compassHeadingRef.current)) {
      heading = compassHeadingRef.current;
    }
    if (heading == null) return;
    const mapBearing = mapRef.current?.getBearing() ?? 0;
    navArrowInnerRef.current.style.transform = `rotate(${heading - mapBearing}deg)`;
  }, []);

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

  const routeSplitsByCode = useMemo(() => {
    const m = new Map<string, RouteSplit>();
    for (const rs of routeSplits) m.set(rs.routeCode, rs);
    return m;
  }, [routeSplits]);

  const reloadRouteSplits = useCallback(async () => {
    try {
      const rows = await sessionService.getRouteSplits();
      if (mountedRef.current) setRouteSplits(rows);
    } catch (err) {
      console.warn('[RouteSplit] reload failed:', err);
    }
  }, []);

  useEffect(() => { reloadRouteSplits(); }, [reloadRouteSplits]);

  const workerLastActive = useMemo(() => {
    const m = new Map<string,string>();
    allSessions.forEach(s => (s.financialStore||[]).forEach((tx:any) => {
      if (!tx.timestamp || !tx.workerId) return;
      const ex = m.get(tx.workerId);
      if (!ex || tx.timestamp > ex) m.set(tx.workerId, tx.timestamp);
    }));
    return m;
  }, [allSessions]);

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
    const result: RouteCardData[] = [];

    const buildLabel = (ids: string[]): string => {
      if (ids.length === 0) return '';
      if (ids.length === 1) {
        const w = workers.find(wk => wk.contractorId === ids[0]);
        return w ? `${w.firstName} ${w.lastName.charAt(0)}.` : '';
      }
      return ids.map(id => {
        const w = workers.find(wk => wk.contractorId === id);
        return w ? `${w.firstName.charAt(0)}${w.lastName.charAt(0)}` : '';
      }).filter(Boolean).join(' ');
    };

    for (const r of routes) {
      if (r.managerId !== managerId) continue;
      const rmi = routeMapData.find(rm => rm.route_code === r.routeCode);
      const baseColor = rmi?.route_color || '#6b7280';
      const split = routeSplitsByCode.get(r.routeCode);
      const rb = bookings.filter(b => b['Route Number'] === r.routeCode);

      if (!split || split.buckets.length === 0) {
        const assignedIds = r.assignedWorkerIds || [];
        const totalEQ = rb.reduce((sum, b) => sum + calculateBookingEQ(b), 0);
        result.push({
          routeCode: r.routeCode,
          displayRouteCode: r.routeCode,
          routeColor: baseColor,
          assignedWorkerIds: assignedIds,
          assignedWorkerLabel: buildLabel(assignedIds),
          prebookCount: rb.length,
          prepayCount: rb.filter(b => b.Prepaid === 'x').length,
          totalEQ,
          isAssigned: assignedIds.length > 0,
          isSplit: false,
          baseRouteCode: r.routeCode,
        });
        continue;
      }

      for (const bucket of split.buckets) {
        const bookingIdSet = new Set(bucket.bookingIds);
        const bucketBookings = rb.filter(b => bookingIdSet.has(b['Booking ID']));
        const bucketColor = colorForBucket(baseColor, bucket.letter);
        const assignedIds = bucket.assignedWorkers || [];
        result.push({
          routeCode: r.routeCode,
          displayRouteCode: `${r.routeCode}${bucket.letter}`,
          routeColor: bucketColor,
          assignedWorkerIds: assignedIds,
          assignedWorkerLabel: buildLabel(assignedIds),
          prebookCount: bucketBookings.length,
          prepayCount: bucketBookings.filter(b => b.Prepaid === 'x').length,
          totalEQ: bucketBookings.reduce((sum, b) => sum + calculateBookingEQ(b), 0),
          isAssigned: assignedIds.length > 0,
          isSplit: true,
          letter: bucket.letter,
          baseRouteCode: r.routeCode,
        });
      }
    }

    return result.sort((a, b) => {
      if (a.isAssigned !== b.isAssigned) return a.isAssigned ? 1 : -1;
      return a.displayRouteCode.localeCompare(b.displayRouteCode);
    });
  }, [routes, managerId, routeMapData, workers, bookings, calculateBookingEQ, routeSplitsByCode]);

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

  const upsellPinSource = useMemo<PinData[]>(() => {
    const result: PinData[] = [];
    const myRS = new Set(myRouteCodes);
    allSessions.forEach(s => {
      const sids = s.teamWorkerIds || [s.workerId];
      const isMe = sids.some(wid => myTeamIds.has(wid));
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type !== 'Upgrade' && tx.type !== 'Add-On') return;
        if (!isMe && !(tx.routeCode && myRS.has(tx.routeCode))) return;
        const addr = tx.address || tx.itemDescription || '';
        if (!addr) return;
        result.push({
          id: tx.jobId || tx.id,
          address: addr,
          routeCode: tx.routeCode || '',
          name: tx.customerName || 'Unknown',
          status: 'upsell',
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
        if (!tx.timestamp || !tx.jobId) return;
        const existing = latestByOwner.get(ownerKey);
        if (!existing || tx.timestamp > existing.timestamp) {
          latestByOwner.set(ownerKey, { jobId: tx.jobId, timestamp: tx.timestamp });
        }
      });
    });

    const result: GeocodedPin[] = [];
    latestByOwner.forEach(({ jobId }) => {
      const pin =
        geocodedPins.find(p => p.id === jobId && (p.status === 'completed' || p.status === 'new_sale'))
        ?? geocodedUpsellPins.find(p => p.id === jobId);
      if (pin) result.push(pin);
    });
    return result;
  }, [allSessions, geocodedPins, geocodedUpsellPins, isTeamSeason]);

  const overlapInfo = useMemo(() => {
    const map = new Map<string, { upsellPin: GeocodedPin; basePin: GeocodedPin }>();
    if (geocodedUpsellPins.length === 0) return map;
    const baseByKey = new Map<string, GeocodedPin>();
    for (const p of geocodedPins) {
      if (p.status === 'completed' || p.status === 'new_sale') {
        baseByKey.set(makeCacheKey(p.address), p);
      }
    }
    for (const u of geocodedUpsellPins) {
      const key = makeCacheKey(u.address);
      const base = baseByKey.get(key);
      if (base) {
        map.set(key, { upsellPin: u, basePin: base });
      }
    }
    return map;
  }, [geocodedPins, geocodedUpsellPins]);

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

  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    loadedIdsRef.current.forEach(id=>{
      if(id.startsWith('num-')){const rid=id.replace('num-','');if(map.getLayer(`rm-num-${rid}`))map.removeLayer(`rm-num-${rid}`);if(map.getSource(`rm-num-src-${rid}`))map.removeSource(`rm-num-src-${rid}`);}
      else{if(map.getLayer(`rm-line-${id}`))map.removeLayer(`rm-line-${id}`);if(map.getSource(`rm-src-${id}`))map.removeSource(`rm-src-${id}`);}
    });
    loadedIdsRef.current=[];
    const before=(map.getLayer('road-label')?'road-label':map.getStyle().layers?.find((l:any)=>l.type==='symbol')?.id)??undefined;
    const allCoords:[number,number][]=[];

    const PALETTE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

    routeMapData.forEach(route=>{
      if(!route.segments?.length) return;
      const srcId=`rm-src-${route.id}`, lineId=`rm-line-${route.id}`;
      loadedIdsRef.current.push(route.id);

      const split = routeSplitsByCode.get(route.route_code);
      const buckets = split ? split.buckets : [];

      const features: GeoJSON.Feature[] = [];
      route.segments.forEach(seg => {
        const cs = seg.coordinates;
        if (!cs || cs.length < 2) return;
        for (let i = 0; i < cs.length - 1; i++) {
          const a = cs[i];
          const b = cs[i + 1];
          const mid = lineMidCoord(a, b);
          const bucket = buckets.length > 0 ? bucketForPoint(mid[0], mid[1], buckets) : 'a';
          features.push({
            type: 'Feature',
            properties: {
              route_code: route.route_code,
              color: route.route_color,
              bucket,
              osmId: seg.osmId,
            },
            geometry: { type: 'LineString', coordinates: [a, b] },
          });
          allCoords.push(a, b);
        }
      });

      const lineColorExpr: any = ['match', ['get', 'bucket']];
      for (const L of PALETTE_LETTERS) {
        lineColorExpr.push(L);
        lineColorExpr.push(colorForBucket(route.route_color, L));
      }
      lineColorExpr.push(route.route_color);

      map.addSource(srcId,{type:'geojson',data:{type:'FeatureCollection',features}});
      map.addLayer({
        id:lineId,
        type:'line',
        source:srcId,
        minzoom:0,maxzoom:24,
        paint:{
          'line-color': lineColorExpr,
          'line-width':7,
          'line-opacity':0.75,
        },
        layout:{'line-cap':'round','line-join':'round'},
      },before);

      const nSrc=`rm-num-src-${route.id}`, nLbl=`rm-num-${route.id}`;
      loadedIdsRef.current.push(`num-${route.id}`);

      const labelFeatures: GeoJSON.Feature[] = [];
      if (!split || buckets.length === 0) {
        const rc:[number,number][]=[];route.segments.forEach(s=>s.coordinates.forEach(c=>rc.push(c)));
        if (rc.length) {
          const cLng=rc.reduce((s,c)=>s+c[0],0)/rc.length, cLat=rc.reduce((s,c)=>s+c[1],0)/rc.length;
          labelFeatures.push({type:'Feature',properties:{num:String(route.route_number),color:route.route_color,route_code:route.route_code,letter:''},geometry:{type:'Point',coordinates:[cLng,cLat]}});
        }
      } else {
        for (const bucket of buckets) {
          const c = bucketCentroid(route.segments, buckets, bucket.letter);
          if (!c) continue;
          const bucketColor = colorForBucket(route.route_color, bucket.letter);
          labelFeatures.push({type:'Feature',properties:{num:`${route.route_number}${bucket.letter}`,color:bucketColor,route_code:route.route_code,letter:bucket.letter},geometry:{type:'Point',coordinates:[c.lng,c.lat]}});
        }
      }
      if (labelFeatures.length > 0) {
        map.addSource(nSrc,{type:'geojson',data:{type:'FeatureCollection',features:labelFeatures}});
        map.addLayer({id:nLbl,type:'symbol',source:nSrc,layout:{'text-field':['get','num'],'text-font':['DIN Pro Bold','Arial Unicode MS Bold'],'text-size':28,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':['get','color'],'text-halo-color':'rgba(255,255,255,0.85)','text-halo-width':2}});
      }
    });

    if(allCoords.length&&!initialFitDoneRef.current){
      initialFitDoneRef.current=true;
      setTimeout(()=>{if(!mapRef.current) return; const b=allCoords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(allCoords[0],allCoords[0]));mapRef.current.fitBounds(b,{padding:80,maxZoom:15,duration:800});},300);
    }
  }, [routeMapData, mapLoaded, routeSplitsByCode]);

  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const myRS=new Set(myRouteCodes);
    const features:GeoJSON.Feature[]=[];

    const labelForWorkerIds = (aids: string[]): string => {
      if (aids.length === 1) {
        const w = workers.find(wk => wk.contractorId === aids[0]);
        return w ? `${w.firstName} ${w.lastName.charAt(0)}.` : '';
      }
      if (aids.length > 1) {
        return aids.map(id => {
          const w = workers.find(wk => wk.contractorId === id);
          return w ? `${w.firstName.charAt(0)}${w.lastName.charAt(0)}` : '';
        }).filter(Boolean).join(' ');
      }
      return '';
    };

    routeMapData.filter(r => myRS.has(r.route_code)).forEach(route => {
      const split = routeSplitsByCode.get(route.route_code);
      if (!split || split.buckets.length === 0) {
        const rc:[number,number][]=[];route.segments.forEach(s=>s.coordinates.forEach(c=>rc.push(c)));if(!rc.length) return;
        const cLng=rc.reduce((s,c)=>s+c[0],0)/rc.length, cLat=rc.reduce((s,c)=>s+c[1],0)/rc.length;
        const rp=routes.find(r=>r.routeCode===route.route_code), aids=rp?.assignedWorkerIds||[];
        const label = labelForWorkerIds(aids);
        features.push({type:'Feature',properties:{label,color:route.route_color},geometry:{type:'Point',coordinates:[cLng,cLat]}});
        return;
      }
      for (const bucket of split.buckets) {
        const c = bucketCentroid(route.segments, split.buckets, bucket.letter);
        if (!c) continue;
        const bucketColor = colorForBucket(route.route_color, bucket.letter);
        const label = labelForWorkerIds(bucket.assignedWorkers || []);
        features.push({type:'Feature',properties:{label,color:bucketColor},geometry:{type:'Point',coordinates:[c.lng,c.lat]}});
      }
    });

    const gj:GeoJSON.FeatureCollection={type:'FeatureCollection',features};
    const src=map.getSource('rm-worker-overlay-src') as mapboxgl.GeoJSONSource;
    if(src){src.setData(gj);}
    else{
      map.addSource('rm-worker-overlay-src',{type:'geojson',data:gj});
      map.addLayer({id:'rm-worker-overlay',type:'symbol',source:'rm-worker-overlay-src',layout:{'text-field':['get','label'],'text-font':['DIN Pro Medium','Arial Unicode MS Regular'],'text-size':11,'text-offset':[0,2.3],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':['get','color'],'text-halo-color':'rgba(255,255,255,0.9)','text-halo-width':1.5}});
    }
  }, [routeMapData, routes, workers, mapLoaded, myRouteCodes, routeSplitsByCode]);

  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    routeMapData.forEach(route=>{
      const lid=`rm-line-${route.id}`; if(!map.getLayer(lid)) return;
      const split = routeSplitsByCode.get(route.route_code);
      const rp=routes.find(r=>r.routeCode===route.route_code);
      const baseAssigned = !!rp?.assignedWorkerIds?.length;
      const splitAssigned = !!split && split.buckets.some(b => (b.assignedWorkers?.length || 0) > 0);
      const isAssigned = baseAssigned || splitAssigned;

      if (sidebarMode === 'routes' && myRouteCodes.includes(route.route_code)) {
        map.setPaintProperty(lid, 'line-opacity', isAssigned ? 0.9 : 0.3);
      } else {
        map.setPaintProperty(lid, 'line-opacity', isAssigned ? 0.75 : 0.4);
      }
    });
  }, [sidebarMode, routeMapData, routes, mapLoaded, myRouteCodes, routeSplitsByCode]);

  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const cleanups:Array<()=>void>=[];
    routeMapData.forEach(route=>{
      if(!myRouteCodes.includes(route.route_code)) return;

      const enter=()=>{ map.getCanvas().style.cursor='pointer'; };
      const leave=()=>{ map.getCanvas().style.cursor=''; };

      const click=(e:any)=>{
        e.preventDefault();
        const mode = sidebarModeRef.current;
        const rc = route.route_code;
        const cr = routesRef.current, cb = bookingsRef.current;
        const rp = cr.find(r => r.routeCode === rc);
        const split = routeSplitsByCode.get(rc);

        let clickedLetter: string | undefined = undefined;
        if (split && split.buckets.length > 0 && e.features && e.features.length > 0) {
          const fb = e.features[0].properties?.bucket;
          if (typeof fb === 'string') clickedLetter = fb;
        }

        if (mode === 'routes') {
          if (split && clickedLetter) {
            const bucket = split.buckets.find(b => b.letter === clickedLetter);
            if (!bucket) return;
            const bucketBookingSet = new Set(bucket.bookingIds);
            const rb = cb.filter(b => b['Route Number'] === rc);
            const bucketBookings = rb.filter(b => bucketBookingSet.has(b['Booking ID']));
            const totalEQ = bucketBookings.reduce((sum, b) => sum + calculateBookingEQ(b), 0);
            const bucketColor = colorForBucket(route.route_color, clickedLetter);
            const bucketAssigned = bucket.assignedWorkers || [];
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
            setAssignModalData({
              routeCode: rc,
              displayRouteCode: `${rc}${clickedLetter}`,
              routeColor: bucketColor,
              prebookCount: bucketBookings.length,
              prepayCount: bucketBookings.filter(b => b.Prepaid === 'x').length,
              totalEQ,
              currentWorkerIds: bucketAssigned,
              letter: clickedLetter,
              canSplit: bucketAssigned.length === 0,
            });
            return;
          }

          const assignedIds = rp?.assignedWorkerIds || [];
          const rb = cb.filter(b => b['Route Number'] === rc);
          const totalEQ = rb.reduce((sum, b) => sum + calculateBookingEQ(b), 0);
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
          setAssignModalData({
            routeCode: rc,
            displayRouteCode: rc,
            routeColor: route.route_color,
            prebookCount: rb.length,
            prepayCount: rb.filter(b => b.Prepaid === 'x').length,
            totalEQ,
            currentWorkerIds: assignedIds,
            canSplit: assignedIds.length === 0,
          });
          return;
        }

        let assignedIds: string[];
        if (split && clickedLetter) {
          const bucket = split.buckets.find(b => b.letter === clickedLetter);
          assignedIds = bucket?.assignedWorkers || [];
        } else {
          assignedIds = rp?.assignedWorkerIds || [];
        }
        if (assignedIds.length === 0) return;

        const entries: RouteNavPromptEntry[] = [];
        if (isTeamSeason) {
          const seenSessions = new Set<string>();
          for (const wid of assignedIds) {
            const cart = cartCardDataRef.current.find(c =>
              c.members.some(m => m.contractorId === wid)
            );
            if (!cart || seenSessions.has(cart.sessionId)) continue;
            seenSessions.add(cart.sessionId);
            const label = cart.members.length > 1
              ? cart.members.map(m => m.firstName).join(' & ')
              : `${cart.members[0]?.firstName || ''} ${cart.members[0]?.lastName?.charAt(0) || ''}.`.trim();
            entries.push({
              type: 'cart',
              label: label || cart.teamId,
              card: cart,
              hasGeocodableAddress: resolveNavDestination(cart.sharedFinancialStore) !== null,
            });
          }
        } else {
          for (const wid of assignedIds) {
            const card = workerCardDataRef.current.find(c => c.worker.contractorId === wid);
            if (!card) continue;
            entries.push({
              type: 'worker',
              label: `${card.worker.firstName} ${card.worker.lastName.charAt(0)}.`,
              card,
              hasGeocodableAddress: resolveNavDestination(card.financialStore) !== null,
            });
          }
        }

        if (entries.length === 0) return;
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        const displayRC = split && clickedLetter ? `${rc}${clickedLetter}` : rc;
        const bucketColor = split && clickedLetter
          ? colorForBucket(route.route_color, clickedLetter)
          : route.route_color;
        setRouteNavPrompt({
          routeCode: displayRC,
          routeColor: bucketColor,
          entries,
        });
      };

      [`rm-line-${route.id}`,`rm-num-${route.id}`].forEach(lid=>{
        if(!map.getLayer(lid)) return;
        map.on('mouseenter',lid,enter);map.on('mouseleave',lid,leave);map.on('click',lid,click);
        cleanups.push(()=>{if(!map.getLayer(lid)) return;map.off('mouseenter',lid,enter);map.off('mouseleave',lid,leave);map.off('click',lid,click);});
      });
    });
    return()=>cleanups.forEach(fn=>fn());
  }, [routeMapData, mapLoaded, myRouteCodes, calculateBookingEQ, isTeamSeason, routeSplitsByCode]);

  // --- LAYER RENDERERS ---

  const overlapInfoRef = useRef<Map<string, { upsellPin: GeocodedPin; basePin: GeocodedPin }>>(new Map());
  useEffect(() => { overlapInfoRef.current = overlapInfo; }, [overlapInfo]);

  const updatePendingBookingPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => {
        const split = routeSplitsByCode.get(pin.routeCode);
        let pinColor = pin.routeColor;
        if (split) {
          for (const bucket of split.buckets) {
            if (bucket.bookingIds.includes(pin.id)) {
              pinColor = colorForBucket(pin.routeColor, bucket.letter);
              break;
            }
          }
        }
        return {
          type: 'Feature' as const,
          properties: {
            name: pin.name, address: pin.address, routeCode: pin.routeCode,
            routeColor: pin.routeColor, pinColor,
            phone: pin.phone || '', email: pin.email || '',
            price: pin.price || '',
          },
          geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
        };
      }),
    };
    const src = map.getSource('rm-pending-pins-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-pending-pins-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-pending-pins-circles',
      type: 'circle',
      source: 'rm-pending-pins-src',
      paint: {
        'circle-color': ['get', 'pinColor'],
        'circle-radius': 3.33,
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1.67,
        'circle-opacity': 0.95,
        'circle-stroke-opacity': 0.95,
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
  }, [routeSplitsByCode]);

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
        'circle-stroke-opacity': 0.95,
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

      const overlapEntry = overlapInfoRef.current.get(makeCacheKey(address));
      let upsellBlock = '';
      if (overlapEntry) {
        const u = overlapEntry.upsellPin;
        const uName = esc(u.name);
        const uPrice = esc(u.price || '');
        const uPriceTag = uPrice
          ? `<span style="background:#3b82f622;color:#93c5fd;border:1px solid #3b82f666;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${uPrice}</span>`
          : '';
        upsellBlock = `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid #444;">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
              <span style="background:#3b82f622;color:#60a5fa;border:1px solid #3b82f666;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">⬆ Upsell</span>
              ${uPriceTag}
            </div>
            <div style="color:#9ca3af;font-size:11px;">${uName}</div>
          </div>
        `;
      }

      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true }).setLngLat(coords).setHTML(
        `<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:190px;line-height:1.4;"><div style="font-weight:700;margin-bottom:3px;">${sn}</div><div style="color:#555;font-size:11px;">${sa}</div>${pRow}${eRow}<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;"><span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${src2}</span><span style="color:${sc};font-size:11px;font-weight:600;">${sl}</span>${prTag}${mTag}</div>${upsellBlock}</div>`
      ).addTo(map);
    });
  }, []);

  const updateUpsellOnlyPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => ({
        type: 'Feature' as const,
        properties: {
          name: pin.name, address: pin.address, routeCode: pin.routeCode,
          routeColor: pin.routeColor, phone: pin.phone || '',
          email: pin.email || '', price: pin.price || '',
        },
        geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
      })),
    };
    const src = map.getSource('rm-upsell-only-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-upsell-only-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-upsell-only-circles',
      type: 'circle',
      source: 'rm-upsell-only-src',
      paint: {
        'circle-color': ['get', 'routeColor'],
        'circle-radius': 3.33,
        'circle-stroke-color': '#3b82f6',
        'circle-stroke-width': 1.67,
        'circle-opacity': 0.95,
        'circle-stroke-opacity': 0.95,
      },
    });
    map.on('mouseenter', 'rm-upsell-only-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rm-upsell-only-circles', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'rm-upsell-only-circles', (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const { name, address, routeCode, routeColor, phone, email, price } = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      if (popupRef.current) popupRef.current.remove();
      const sn=esc(name),sa=esc(address),sp=esc(phone),se=esc(email),spr=esc(price),src2=esc(routeCode);
      const pRow=sp?`<div style="margin-top:5px;"><a href="tel:${sp}" style="color:#60a5fa;font-size:12px;text-decoration:none;">📞 ${sp}</a></div>`:'';
      const eRow=se?`<div style="color:#9ca3af;font-size:11px;margin-top:2px;">✉️ ${se}</div>`:'';
      const prTag=spr?`<span style="background:#3b82f622;color:#93c5fd;border:1px solid #3b82f666;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${spr}</span>`:'';
      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true }).setLngLat(coords).setHTML(
        `<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:190px;line-height:1.4;"><div style="font-weight:700;margin-bottom:3px;">${sn}</div><div style="color:#555;font-size:11px;">${sa}</div>${pRow}${eRow}<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;"><span style="background:${routeColor}22;color:${routeColor};border:1px solid ${routeColor}88;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${src2}</span><span style="background:#3b82f622;color:#60a5fa;border:1px solid #3b82f666;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">⬆ Upsell</span>${prTag}</div></div>`
      ).addTo(map);
    });
  }, []);

  const updateOverlapHalfPins = useCallback((map: mapboxgl.Map, points: Array<{ lat: number; lng: number }>) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: points.map(p => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    };
    const src = map.getSource('rm-overlap-half-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-overlap-half-src', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'rm-overlap-half-symbols',
      type: 'symbol',
      source: 'rm-overlap-half-src',
      layout: {
        'icon-image': 'rm-upsell-half-blue',
        'icon-size': 1.0,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.95 },
    });
  }, []);

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
        'circle-stroke-opacity': 0,
      },
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (geocodedPins.length === 0) return;
    const pendingOnly = geocodedPins.filter(p => p.status === 'pending');
    if (pendingOnly.length > 0) {
      updatePendingBookingPins(map, pendingOnly);
    }
  }, [routeSplitsByCode, mapLoaded, geocodedPins, updatePendingBookingPins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (map.getLayer('rm-pending-pins-circles')) {
      map.setPaintProperty('rm-pending-pins-circles', 'circle-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
      map.setPaintProperty('rm-pending-pins-circles', 'circle-stroke-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
    }
    if (map.getLayer('rm-completed-pins-circles')) {
      map.setPaintProperty('rm-completed-pins-circles', 'circle-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
      map.setPaintProperty('rm-completed-pins-circles', 'circle-stroke-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-upsell-only-circles')) {
      map.setPaintProperty('rm-upsell-only-circles', 'circle-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
      map.setPaintProperty('rm-upsell-only-circles', 'circle-stroke-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-overlap-half-symbols')) {
      map.setPaintProperty('rm-overlap-half-symbols', 'icon-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-historical-symbols')) {
      map.setPaintProperty('rm-historical-symbols', 'icon-opacity', filterVisibility.historical ? 0.85 : 0);
    }
    if (map.getLayer('rm-pcl-circles')) {
      map.setPaintProperty('rm-pcl-circles', 'circle-opacity', filterVisibility.pcl ? 0.7 : 0);
      map.setPaintProperty('rm-pcl-circles', 'circle-stroke-opacity', filterVisibility.pcl ? 0.7 : 0);
    }
  }, [filterVisibility, mapLoaded]);

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
      enriched.forEach(p => knownPinsRef.current.set(p.id, p));
      const allKnown = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'pending');
      updatePendingBookingPins(map, allKnown);
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
      onGeocodeProgress('phase2_completed_and_sales', 'pendingBookings', total, total, true);
    })();
    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, pendingBookingPinSource, routeColorMap, geocodeOne, updatePendingBookingPins, onGeocodeProgress]);

  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase !== 'phase2_completed_and_sales') return;
    const map = mapRef.current; if (!map) return;
    let cancelled = false;
    (async () => {
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
      enriched.forEach(p => knownPinsRef.current.set(p.id, p));
      const allCompleted = Array.from(knownPinsRef.current.values()).filter(p => p.status === 'completed' || p.status === 'new_sale');
      updateCompletedPins(map, allCompleted);
      if (isTeamSeason) setGeocodedPendingSales(pendingSalesCached);
      let progressDone = 0;
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
      const newPSResults: GeocodedPendingSale[] = [...pendingSalesCached];
      for (let i = 0; i < pendingSalesNeedsGeocoding.length; i++) {
        if (cancelled || !mountedRef.current) return;
        const { booking, address, id } = pendingSalesNeedsGeocoding[i];
        const coord = await geocodeOne(address);
        if (coord) newPSResults.push({ id, lat: coord.lat, lng: coord.lng, booking });
        if (cancelled || !mountedRef.current) return;
        progressDone++;
        onGeocodeProgress('phase2_completed_and_sales', 'pendingSalesAndCompleted', progressDone, totalToGeocode, false);
        if (i < pendingSalesNeedsGeocoding.length - 1) await new Promise(r => setTimeout(r, 80));
      }
      if (cancelled || !mountedRef.current) return;
      if (isTeamSeason) setGeocodedPendingSales(newPSResults);
      setGeocodedPins(Array.from(knownPinsRef.current.values()));
      onGeocodeProgress('phase3_historical', 'pendingSalesAndCompleted', totalToGeocode, totalToGeocode, true);
    })();
    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, completedAndNewSalePinSource, pendingSalesByManager, isTeamSeason, routeColorMap, geocodeOne, updateCompletedPins, onGeocodeProgress]);

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
      onGeocodeProgress('phase4_pcl', 'historical', total, total, true);
    })();
    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, historicalProps, geocodeOne, updateHistoricalPins, onGeocodeProgress]);

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
        if (coord) known.set(key, { key, lat: coord.lat, lng: coord.lng });
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
      onGeocodeProgress('complete', 'pcl', total, total, true);
    })();
    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, pclByRoute, geocodeOne, updatePclCircles, onGeocodeProgress]);

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
        if (coord) additions.push({ id: booking['Booking ID'], lat: coord.lat, lng: coord.lng, booking });
        await new Promise(r => setTimeout(r, 80));
      }
      if (cancelled || !mountedRef.current) return;
      const stillRelevant = new Set(merged.map(b => b['Booking ID']));
      if (additions.length > 0) {
        setGeocodedPendingSales(prev => [...prev.filter(g => stillRelevant.has(g.id)), ...additions]);
      } else {
        setGeocodedPendingSales(prev => prev.filter(g => stillRelevant.has(g.id)));
      }
    })();
    return () => { cancelled = true; };
  }, [pendingSalesByManager, geocodePhase, isTeamSeason, mapLoaded, geocodeCacheHydrated, geocodeOne]);

  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    if (geocodePhase === 'idle' || geocodePhase === 'phase1_pending_bookings') return;
    let cancelled = false;
    (async () => {
      const sources = upsellPinSource;
      const additions: GeocodedPin[] = [];
      for (const pin of sources) {
        if (cancelled) return;
        if (knownUpsellPinsRef.current.has(pin.id)) continue;
        const coord = await geocodeOne(pin.address);
        if (coord) {
          additions.push({ ...pin, lat: coord.lat, lng: coord.lng, routeColor: routeColorMap.get(pin.routeCode) || '#888888' });
        }
        await new Promise(r => setTimeout(r, 0));
      }
      if (cancelled || !mountedRef.current) return;
      const stillRelevantIds = new Set(sources.map(p => p.id));
      additions.forEach(p => knownUpsellPinsRef.current.set(p.id, p));
      for (const id of Array.from(knownUpsellPinsRef.current.keys())) {
        if (!stillRelevantIds.has(id)) knownUpsellPinsRef.current.delete(id);
      }
      setGeocodedUpsellPins(Array.from(knownUpsellPinsRef.current.values()));
    })();
    return () => { cancelled = true; };
  }, [upsellPinSource, geocodePhase, mapLoaded, geocodeCacheHydrated, geocodeOne, routeColorMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const upsellOnly = geocodedUpsellPins.filter(p => !overlapInfo.has(makeCacheKey(p.address)));
    updateUpsellOnlyPins(map, upsellOnly);
    const overlapPoints: Array<{ lat: number; lng: number }> = [];
    overlapInfo.forEach(({ basePin }) => { overlapPoints.push({ lat: basePin.lat, lng: basePin.lng }); });
    updateOverlapHalfPins(map, overlapPoints);
  }, [geocodedUpsellPins, overlapInfo, mapLoaded, updateUpsellOnlyPins, updateOverlapHalfPins]);

  // Pending sales markers — RING RESTYLE (Item 2) call site.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const existingIds = new Set(pendingSaleMarkersRef.current.keys());
    const showThem = filterVisibility.pendingSalesAndCompleted;
    if (!showThem) {
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
        // RING RESTYLE (Item 2): pull this sale's route colour from
        // routeColorMap (same source completed pins use) and hand it to
        // createDashedRotatingRing so the centre dot matches the route.
        const psRouteCode = ps.booking['Route Number'] || '';
        const psRouteColor = routeColorMap.get(psRouteCode) || '#6b7280';
        const el = createDashedRotatingRing(psRouteColor);
        el.addEventListener('click', (e) => { e.stopPropagation(); setPendingJobForModal(ps.booking); });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([ps.lng, ps.lat]).addTo(map);
        pendingSaleMarkersRef.current.set(ps.id, marker);
      }
    });
    existingIds.forEach(id => {
      pendingSaleMarkersRef.current.get(id)?.remove();
      pendingSaleMarkersRef.current.delete(id);
    });
  }, [geocodedPendingSales, mapLoaded, filterVisibility.pendingSalesAndCompleted, routeColorMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    pulsingMarkersRef.current.forEach(m => m.remove());
    pulsingMarkersRef.current = [];
    if (!filterVisibility.pendingSalesAndCompleted) return;
    mostRecentCompletionPins.forEach(pin => {
      const color = pin.routeColor || '#22c55e';
      const el = createPulsingRing(color);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([pin.lng, pin.lat]).addTo(map);
      pulsingMarkersRef.current.push(marker);
    });
    return () => {
      pulsingMarkersRef.current.forEach(m => m.remove());
      pulsingMarkersRef.current = [];
    };
  }, [mostRecentCompletionPins, mapLoaded, filterVisibility.pendingSalesAndCompleted]);

  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!navigator.geolocation) return;
    if(!navArrowElRef.current) {
      const arrow = createNavArrow();
      navArrowElRef.current = arrow.outer;
      navArrowInnerRef.current = arrow.inner;
    }
    navMarkerRef.current=new mapboxgl.Marker({element:navArrowElRef.current}).setLngLat([0,0]).addTo(map);
    const handleDragStart = (e: any) => { if (!e.originalEvent) return; if (centerOnLocationRef.current) onFollowMeAutoDisable(); };
    map.on('dragstart', handleDragStart);
    map.on('rotate', applyArrowRotation);
    watchIdRef.current=navigator.geolocation.watchPosition(pos=>{
      if(!navMarkerRef.current||!mapRef.current) return;
      const{latitude:lat,longitude:lng,heading,speed}=pos.coords;
      navMarkerRef.current.setLngLat([lng,lat]);
      let derivedHeading: number | null = null;
      if (heading != null && !isNaN(heading)) {
        derivedHeading = heading;
      } else if (lastGpsPosRef.current) {
        const prev = lastGpsPosRef.current;
        const dist = distanceMeters(prev.lat, prev.lng, lat, lng);
        if (dist >= 5) derivedHeading = bearingDeg(prev.lat, prev.lng, lat, lng);
      }
      if (derivedHeading != null) {
        gpsHeadingRef.current = derivedHeading;
        gpsHeadingUpdatedAtRef.current = Date.now();
      }
      lastGpsPosRef.current = { lat, lng, ts: Date.now() };
      applyArrowRotation();
      if (centerOnLocationRef.current) {
        mapRef.current.easeTo({ center: [lng, lat], duration: 300 });
        lastCenteredAtRef.current = { lat, lng };
      }
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
              onRouteCartIdRef.current = null; onRouteWorkerIdRef.current = null;
              setOnRouteCartCard(null); setOnRouteWorkerCard(null);
            }
          } else {
            const card = workerCardDataRef.current.find(c => c.worker.contractorId === nearest.workerId) || null;
            onRouteWorkerIdRef.current = nearest.workerId;
            onRouteCartIdRef.current = null;
            setOnRouteWorkerCard(card);
            setOnRouteCartCard(null);
          }
        } else {
          onRouteWorkerIdRef.current = null; onRouteCartIdRef.current = null;
          setOnRouteWorkerCard(null); setOnRouteCartCard(null);
        }
      } else {
        onRouteWorkerIdRef.current = null; onRouteCartIdRef.current = null;
        setOnRouteWorkerCard(null); setOnRouteCartCard(null);
      }
    },()=>{},{enableHighAccuracy:true,maximumAge:15000,timeout:30000});
    return()=>{
      map.off('dragstart', handleDragStart);
      map.off('rotate', applyArrowRotation);
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
    };
  }, [mapLoaded, isTeamSeason, managerId, onFollowMeAutoDisable, applyArrowRotation]);

  const attachCompassListener = useCallback(() => {
    if (compassHandlerRef.current) return;
    const handler = (e: DeviceOrientationEvent) => {
      const webkit = (e as any).webkitCompassHeading;
      if (typeof webkit === 'number' && !isNaN(webkit)) compassHeadingRef.current = webkit;
      else if (e.alpha != null && !isNaN(e.alpha)) compassHeadingRef.current = (360 - e.alpha) % 360;
      applyArrowRotation();
    };
    window.addEventListener('deviceorientation', handler, true);
    compassHandlerRef.current = handler;
  }, [applyArrowRotation]);

  const handleEnableCompass = useCallback(async () => {
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== 'function') {
      attachCompassListener();
      setCompassNeedsPermission(false);
      return;
    }
    try {
      const result = await DOE.requestPermission();
      if (result === 'granted') attachCompassListener();
    } catch (err) {
      console.warn('Compass permission request failed:', err);
    }
    setCompassNeedsPermission(false);
  }, [attachCompassListener]);

  useEffect(() => {
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (!DOE) return;
    if (typeof DOE.requestPermission === 'function') setCompassNeedsPermission(true);
    else attachCompassListener();
    return () => {
      if (compassHandlerRef.current) {
        window.removeEventListener('deviceorientation', compassHandlerRef.current, true);
        compassHandlerRef.current = null;
      }
    };
  }, [attachCompassListener]);

  useEffect(() => {
    if (centerOnLocation && navMarkerRef.current && mapRef.current) {
      const ll = navMarkerRef.current.getLngLat();
      if (ll.lng !== 0 || ll.lat !== 0) {
        mapRef.current.easeTo({ center: [ll.lng, ll.lat], duration: 800 });
        lastCenteredAtRef.current = { lat: ll.lat, lng: ll.lng };
      }
    }
    if (!centerOnLocation) {
      lastCenteredAtRef.current = null;
      onRouteWorkerIdRef.current = null; onRouteCartIdRef.current = null;
      setOnRouteWorkerCard(null); setOnRouteCartCard(null);
    }
  }, [centerOnLocation]);

  useEffect(() => {
    mountedRef.current=true;
    if(!mapContainerRef.current||mapRef.current) return;
    const map=new mapboxgl.Map({container:mapContainerRef.current,style:'mapbox://styles/mapbox/streets-v12',center:[-79.870,43.320],zoom:13});
    map.addControl(new mapboxgl.NavigationControl(),'top-right');
    map.on('load',()=>{
      map.resize();
      const xh=['poi-label','housenum-label','road-number-shield','transit-label'];
      xh.forEach(id=>{if(map.getLayer(id)) map.setLayoutProperty(id,'visibility','none');});
      map.getStyle().layers?.forEach((layer:any)=>{
        const id=layer.id.toLowerCase();
        if(id.includes('transit')||id.includes('bus-stop')||id.includes('busstop')) {
          try { map.setLayoutProperty(layer.id,'visibility','none'); } catch {}
        }
      });
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
      xCanvas.width = xCanvasSize; xCanvas.height = xCanvasSize;
      const ctx = xCanvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        const pad = 3;
        ctx.beginPath();
        ctx.moveTo(pad, pad); ctx.lineTo(xCanvasSize - pad, xCanvasSize - pad);
        ctx.moveTo(xCanvasSize - pad, pad); ctx.lineTo(pad, xCanvasSize - pad);
        ctx.stroke();
        const imgData = ctx.getImageData(0, 0, xCanvasSize, xCanvasSize);
        if (!map.hasImage('rm-historical-x')) map.addImage('rm-historical-x', imgData, { pixelRatio: 2 });
      }
      const upsellCanvasSize = 16;
      const upsellCanvas = document.createElement('canvas');
      upsellCanvas.width = upsellCanvasSize; upsellCanvas.height = upsellCanvasSize;
      const uctx = upsellCanvas.getContext('2d');
      if (uctx) {
        const cx = upsellCanvasSize / 2; const cy = upsellCanvasSize / 2;
        const ringRadius = 4.17; const strokeWidth = 1.67 * 2;
        uctx.strokeStyle = '#3b82f6'; uctx.lineWidth = strokeWidth; uctx.lineCap = 'butt';
        uctx.beginPath();
        uctx.arc(cx, cy, ringRadius, -Math.PI / 2, Math.PI / 2, false);
        uctx.stroke();
        const upsellImgData = uctx.getImageData(0, 0, upsellCanvasSize, upsellCanvasSize);
        if (!map.hasImage('rm-upsell-half-blue')) map.addImage('rm-upsell-half-blue', upsellImgData, { pixelRatio: 2 });
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

  const startNavToDestination = useCallback((dest: NavDestination, targetKey: string) => {
    if (!centerOnLocation && onForceFollowMeOn) onForceFollowMeOn();
    setNavState({ destination: dest, targetKey });
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
  }, [centerOnLocation, onForceFollowMeOn]);

  const handleNavigateToWorker = useCallback((card: WorkerCardData) => {
    const resolved = resolveNavDestination(card.financialStore);
    if (!resolved) { console.warn('[RMNav] No geocoded address for', card.worker.contractorId); return; }
    const label = `${card.worker.firstName} ${card.worker.lastName.charAt(0)}.`;
    const newDest: NavDestination = { lat: resolved.lat, lng: resolved.lng, label };
    const newKey = `worker:${card.worker.contractorId}`;
    if (!navState) { startNavToDestination(newDest, newKey); return; }
    if (navState.targetKey === newKey) return;
    setSwitchNavConfirm({ newDestination: newDest, newTargetKey: newKey, currentLabel: navState.destination.label, newLabel: label });
  }, [navState, startNavToDestination]);

  const handleNavigateToCart = useCallback((cart: CartCardData) => {
    const resolved = resolveNavDestination(cart.sharedFinancialStore);
    if (!resolved) { console.warn('[RMNav] No geocoded address for cart', cart.sessionId); return; }
    const label = cart.members.length > 1
      ? cart.members.map(m => m.firstName).join(' & ')
      : `${cart.members[0]?.firstName || ''} ${cart.members[0]?.lastName.charAt(0) || ''}.`;
    const newDest: NavDestination = { lat: resolved.lat, lng: resolved.lng, label };
    const newKey = `cart:${cart.sessionId}`;
    if (!navState) { startNavToDestination(newDest, newKey); return; }
    if (navState.targetKey === newKey) return;
    setSwitchNavConfirm({ newDestination: newDest, newTargetKey: newKey, currentLabel: navState.destination.label, newLabel: label });
  }, [navState, startNavToDestination]);

  const workerCanNavigate = useCallback((card: WorkerCardData): boolean => resolveNavDestination(card.financialStore) !== null, []);
  const cartCanNavigate = useCallback((cart: CartCardData): boolean => resolveNavDestination(cart.sharedFinancialStore) !== null, []);

  const handleNavCancel = useCallback(() => { setNavState(null); }, []);
  const handleNavArrived = useCallback(() => { setNavState(null); }, []);

  const handleSwitchNavConfirm = useCallback(() => {
    if (!switchNavConfirm) return;
    startNavToDestination(switchNavConfirm.newDestination, switchNavConfirm.newTargetKey);
    setSwitchNavConfirm(null);
  }, [switchNavConfirm, startNavToDestination]);

  const handleRouteNavPromptSelect = useCallback((entry: RouteNavPromptEntry) => {
    if (!entry.hasGeocodableAddress) return;
    setRouteNavPrompt(null);
    if (entry.type === 'cart') handleNavigateToCart(entry.card as CartCardData);
    else handleNavigateToWorker(entry.card as WorkerCardData);
  }, [handleNavigateToWorker, handleNavigateToCart]);

  const handleOpenSplitModal = useCallback(() => {
    if (!assignModalData) return;
    const { routeCode, routeColor, letter } = assignModalData;
    const rmd = routeMapData.find(r => r.route_code === routeCode);
    if (!rmd || !rmd.segments?.length) {
      console.warn('[Split] No segment geometry for route', routeCode);
      return;
    }

    const existingSplit = routeSplitsByCode.get(routeCode);
    const existingBuckets = existingSplit?.buckets || null;
    const splittingFromLetter = letter || 'a';

    const newLetter = existingBuckets
      ? sessionService.nextAvailableLetter(existingBuckets)
      : 'b';

    const baseRouteColor = rmd.route_color;

    const prebookings = geocodedPins
      .filter(p => p.status === 'pending' && p.routeCode === routeCode)
      .map(p => ({ bookingId: p.id, lat: p.lat, lng: p.lng }));

    const allBookingIdsOnRoute = bookings
      .filter(b => b['Route Number'] === routeCode)
      .map(b => b['Booking ID']);

    setAssignModalData(null);

    setSplitModalData({
      routeCode,
      baseRouteColor,
      segments: rmd.segments,
      prebookings,
      existingBuckets,
      splittingFromLetter,
      newLetter,
      allBookingIdsOnRoute,
    });
  }, [assignModalData, routeMapData, routeSplitsByCode, geocodedPins, bookings]);

  const handleSplitConfirm = useCallback(async (
    rectangles: Array<{ west: number; east: number; south: number; north: number }>,
    bookingsMovingToNew: string[]
  ) => {
    if (!splitModalData) return;
    const { routeCode, baseRouteColor, splittingFromLetter, newLetter, allBookingIdsOnRoute } = splitModalData;
    try {
      await sessionService.splitBucket({
        routeCode,
        sourceLetter: splittingFromLetter,
        rectangles,
        bookingsMovingToNew,
        allBookingIdsOnRoute,
      });
    } catch (err) {
      console.error('[Split] splitBucket failed:', err);
      setSplitModalData(null);
      return;
    }
    await reloadRouteSplits();

    const movingSet = new Set(bookingsMovingToNew);
    const newBucketBookings = bookings.filter(b =>
      b['Route Number'] === routeCode && movingSet.has(b['Booking ID'])
    );
    const totalEQ = newBucketBookings.reduce((sum, b) => sum + calculateBookingEQ(b), 0);

    setSplitModalData(null);

    setAssignModalData({
      routeCode,
      displayRouteCode: `${routeCode}${newLetter}`,
      routeColor: colorForBucket(baseRouteColor, newLetter),
      prebookCount: newBucketBookings.length,
      prepayCount: newBucketBookings.filter(b => b.Prepaid === 'x').length,
      totalEQ,
      currentWorkerIds: [],
      letter: newLetter,
      canSplit: true,
    });
  }, [splitModalData, reloadRouteSplits, bookings, calculateBookingEQ]);

  const handleSplitCancel = useCallback(() => {
    setSplitModalData(null);
  }, []);

  const handleAssignRoute = async (workerId: string | null) => {
    if (!assignModalData) return;
    setAssignLoading(true);
    try {
      const { routeCode, letter } = assignModalData;

      if (letter) {
        const workerIds = workerId === null ? [] : [workerId];
        let bucketWorkerIds = workerIds;
        if (isTeamSeason && workerId !== null) {
          const worker = myTeamWorkers.find(w => w.contractorId === workerId);
          const teamId = worker?.teamId || workerId;
          const cart = teamCarts.find(c => c.teamId === teamId);
          if (cart && cart.workerIds.length > 1) bucketWorkerIds = cart.workerIds;
        }
        await sessionService.updateRouteSplitAssignment(routeCode, letter, bucketWorkerIds);

        if (isTeamSeason && workerId !== null) {
          const session = await sessionService.getWorkerLogsheetSession(workerId);
          const sessionId = session?.id;
          if (sessionId) {
            const split = await sessionService.getRouteSplitForRoute(routeCode);
            if (split) {
              const bucket = split.buckets.find(b => b.letter === letter);
              if (bucket && bucket.bookingIds.length > 0) {
                await sessionService.assignBookingsToSession(bucket.bookingIds, sessionId);
              }
            }
          }
        }

        setAssignModalData(null);
        onRefresh();
        return;
      }

      const routeBookings = bookings.filter(b => b['Route Number'] === routeCode);
      const pendingItems = routeBookings.filter(b => b.Status !== 'completed' && b.Completed !== 'x');
      const pendingBookingIds = pendingItems.map(j => j['Booking ID']);

      if (workerId === null) {
        await sessionService.assignRouteToWorkers(routeCode, []);
        if (isTeamSeason) {
          await Promise.all(pendingItems.map(job => sessionService.assignBookingToSession(job['Booking ID'], null)));
        } else {
          await Promise.all(pendingItems.map(job => sessionService.assignBookingToWorker(job['Booking ID'], null)));
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
        await Promise.all(pendingItems.map(job => sessionService.assignBookingToWorker(job['Booking ID'], workerId)));
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
        await sessionService.transferBookingToManager(transferModalData.targetId, transferModalData.routeCode, newManagerId);
      }
      setTransferModalData(null);
      onRefresh();
    } catch (e) { console.error(e); }
  };

  const openTransferModal = () => {
    if (!assignModalData) return;
    setTransferModalData({
      type: 'ROUTE',
      targetId: assignModalData.routeCode,
      routeCode: assignModalData.routeCode,
      title: `Transfer Route ${assignModalData.displayRouteCode}`,
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
    setReassignLoading(true); setReassignError(null); setReassignSuccess(null);
    try {
      await sessionService.reassignWorker(selectedWorkerToMove.contractorId, destination);
      let msg = '';
      if (destination.type === 'existing_cart') msg = `${selectedWorkerToMove.firstName} moved to ${destination.label}`;
      else if (destination.type === 'new_solo') msg = `${selectedWorkerToMove.firstName} is now a solo cart`;
      else { const mgr = allManagers.find(m => m.userId === destination.targetManagerId); msg = `${selectedWorkerToMove.firstName} moved to ${mgr?.name || 'new manager'}`; }
      setReassignSuccess(msg);
      setSelectedWorkerToMove(null); setSelectedWorkerSourceCart(null);
      onRefresh();
    } catch (err: any) {
      console.error('Reassign failed:', err);
      setReassignError(err.message || 'Failed to reassign worker. Please try again.');
    } finally { setReassignLoading(false); }
  };

  const handleAerationTransfer = async (targetManagerId: string) => {
    if (!selectedWorkerToMove) return;
    setReassignLoading(true); setReassignError(null); setReassignSuccess(null);
    try {
      await sessionService.transferWorker(selectedWorkerToMove.contractorId, targetManagerId);
      const mgr = allManagers.find(m => m.userId === targetManagerId);
      setReassignSuccess(`${selectedWorkerToMove.firstName} moved to ${mgr?.name || 'new manager'}`);
      setSelectedWorkerToMove(null);
      onRefresh();
    } catch (err: any) {
      console.error('Transfer failed:', err);
      setReassignError(err.message || 'Failed to transfer worker.');
    } finally { setReassignLoading(false); }
  };

  const handleRemoveWorkerNoShow = async () => {
    if (!selectedWorkerToMove) return;
    if (!window.confirm(
      `Remove ${selectedWorkerToMove.firstName} ${selectedWorkerToMove.lastName} completely?\n\nThis removes them from the session and all stats. Use this for no-shows only.`
    )) return;
    setReassignLoading(true); setReassignError(null); setReassignSuccess(null);
    try {
      if (isTeamSeason && selectedWorkerSourceCart && selectedWorkerSourceCart.members.length > 1) {
        await sessionService.reassignWorker(selectedWorkerToMove.contractorId, { type: 'new_solo' });
      }
      await sessionService.deleteWorker(selectedWorkerToMove.contractorId);
      setReassignSuccess(`${selectedWorkerToMove.firstName} removed from session`);
      setSelectedWorkerToMove(null); setSelectedWorkerSourceCart(null);
      onRefresh();
    } catch (err: any) {
      console.error('Remove failed:', err);
      setReassignError(err.message || 'Failed to remove worker. Please try again.');
    } finally { setReassignLoading(false); }
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
    } finally { setUnassigningAsphaltId(null); }
  };

  const isAerationWorkerModifiable = (worker: Worker): boolean => {
    if (isTeamSeason) return false;
    const card = workerCardData.find(c => c.worker.contractorId === worker.contractorId);
    return !card || card.financialStore.length === 0;
  };

  const selectedRouteBookings=useMemo(()=>selectedRouteForBookings?bookings.filter(b=>b['Route Number']===selectedRouteForBookings):[], [selectedRouteForBookings,bookings]);
  const selectedRouteFinancialStore=useMemo(()=>selectedRouteForBookings?allSessions.flatMap(s=>(s.financialStore||[]).filter((tx:any)=>tx.routeCode===selectedRouteForBookings)):[], [selectedRouteForBookings,allSessions]);

  const handleCopyPhone = (phone: string, id: string) => { navigator.clipboard.writeText(phone); };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => { try { map.resize(); } catch {} }, 250);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

  const workerRouteBadges = useMemo(() => {
    const m = new Map<string, Array<{ code: string; color: string }>>();
    for (const r of routes) {
      if (r.managerId !== managerId) continue;
      const split = routeSplitsByCode.get(r.routeCode);
      const baseColor = routeColorMap.get(r.routeCode) || '#6b7280';
      if (!split || split.buckets.length === 0) {
        const ids = r.assignedWorkerIds || [];
        for (const id of ids) {
          if (!m.has(id)) m.set(id, []);
          m.get(id)!.push({ code: r.routeCode, color: baseColor });
        }
      } else {
        for (const bucket of split.buckets) {
          const bucketColor = colorForBucket(baseColor, bucket.letter);
          for (const id of bucket.assignedWorkers || []) {
            if (!m.has(id)) m.set(id, []);
            m.get(id)!.push({ code: `${r.routeCode}${bucket.letter}`, color: bucketColor });
          }
        }
      }
    }
    return m;
  }, [routes, managerId, routeSplitsByCode, routeColorMap]);

  const sortedAerationAssignList = useMemo(() => {
    return [...myTeamWorkers].sort((a, b) => {
      const ar = (workerRouteBadges.get(a.contractorId) || []).length;
      const br = (workerRouteBadges.get(b.contractorId) || []).length;
      if (ar !== br) return ar - br;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
  }, [myTeamWorkers, workerRouteBadges]);

  const sortedTeamAssignList = useMemo(() => {
    if (!contractorsByCart) return [];
    const entries = Array.from(contractorsByCart.entries());
    return entries.sort(([, aMembers], [, bMembers]) => {
      const aRouteCount = Math.max(...aMembers.map(m => (workerRouteBadges.get(m.contractorId) || []).length), 0);
      const bRouteCount = Math.max(...bMembers.map(m => (workerRouteBadges.get(m.contractorId) || []).length), 0);
      if (aRouteCount !== bRouteCount) return aRouteCount - bRouteCount;
      const aName = aMembers[0]?.lastName || '';
      const bName = bMembers[0]?.lastName || '';
      return aName.localeCompare(bName);
    });
  }, [contractorsByCart, workerRouteBadges]);

  // --- RENDER ---

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {(!mapLoaded || routesLoading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/40 pointer-events-none z-10">
          <Loader className="animate-spin text-white" size={28} />
        </div>
      )}

      {/* Compass enable prompt (iOS permission) */}
      {compassNeedsPermission && (
        <button
          onClick={handleEnableCompass}
          className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800/90 text-white text-xs font-medium shadow-lg border border-gray-700 hover:bg-gray-700"
        >
          <Compass size={14} /> Enable compass
        </button>
      )}

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(o => !o)}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-2 rounded-full bg-gray-800/90 text-white text-xs font-semibold shadow-lg border border-gray-700 hover:bg-gray-700"
      >
        {sidebarOpen ? <ChevronLeft size={14} /> : <LayoutList size={14} />}
        {sidebarOpen ? 'Hide' : (isTeamSeason ? 'Carts & Routes' : 'Staff & Routes')}
      </button>

      {/* SIDEBAR */}
      <div
        className={`absolute top-0 left-0 h-full z-30 bg-gray-900/95 backdrop-blur-sm border-r border-gray-700 shadow-2xl transition-transform duration-200 flex flex-col ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: 'min(370px, 88vw)' }}
      >
        <div className="flex items-center justify-between p-2 border-b border-gray-700 flex-shrink-0">
          <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
            <button
              onClick={() => setSidebarMode('staff')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                sidebarMode === 'staff' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              {isTeamSeason ? 'Carts' : 'Staff'}
            </button>
            <button
              onClick={() => setSidebarMode('routes')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                sidebarMode === 'routes' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              Routes
            </button>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        {sidebarMode === 'staff' && (
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-700 flex-shrink-0 overflow-x-auto">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mr-1 flex-shrink-0">Sort</span>
            {([['recent','Recent'],['alpha','A-Z'],['steps','Steps'],['equiv','EQ'],['upGross','Up$']] as Array<[SortOption,string]>).map(([k,label])=>(
              <button
                key={k}
                onClick={()=>setSortBy(k)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all ${
                  sortBy===k ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          {sidebarMode === 'staff' && !isTeamSeason && sortedWorkerCards.map(card => (
            <button
              key={card.worker.contractorId}
              onClick={() => setSelectedWorkerForModal(card)}
              className="w-full text-left p-2.5 rounded-lg bg-gray-800 hover:bg-gray-750 border border-gray-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-sm">{card.worker.firstName} {card.worker.lastName}</span>
                {card.lastActiveTime && <span className="text-[10px] text-gray-500">{card.lastActiveTime}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                <span>{card.stats.steps} steps</span>
                <span>·</span>
                <span>EQ {card.stats.eq.toFixed(1)}</span>
                {card.assignedRoutes.length > 0 && (<><span>·</span><span className="truncate">{card.assignedRoutes.join(', ')}</span></>)}
              </div>
              {card.lastActiveAddress && (
                <div className="text-[10px] text-gray-500 mt-0.5 truncate">📍 {card.lastActiveAddress}</div>
              )}
            </button>
          ))}

          {sidebarMode === 'staff' && isTeamSeason && sortedCartCards.map(card => (
            <button
              key={card.sessionId}
              onClick={() => setSelectedCartForModal(card)}
              className="w-full text-left p-2.5 rounded-lg bg-gray-800 hover:bg-gray-750 border border-gray-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-sm flex items-center gap-1.5">
                  {card.members.length > 1 ? <Truck size={13} className="opacity-70" /> : null}
                  {card.members.map(m => m.firstName).join(' & ') || card.teamId}
                  {card.isRcCart && <Shovel size={11} className="text-amber-400" />}
                </span>
                {card.lastActiveTime && <span className="text-[10px] text-gray-500">{card.lastActiveTime}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                <span>{card.stats.steps} steps</span>
                <span>·</span>
                <span>EQ {card.stats.eq.toFixed(1)}</span>
                {card.stats.pendingSaleCount > 0 && (
                  <><span>·</span><span className="text-yellow-400 flex items-center gap-0.5"><Bookmark size={9} />{card.stats.pendingSaleCount}</span></>
                )}
                {card.assignedRoutes.length > 0 && (<><span>·</span><span className="truncate">{card.assignedRoutes.join(', ')}</span></>)}
              </div>
              {card.lastActiveAddress && (
                <div className="text-[10px] text-gray-500 mt-0.5 truncate">📍 {card.lastActiveAddress}</div>
              )}
            </button>
          ))}

          {sidebarMode === 'routes' && routeCardData.map(card => (
            <button
              key={card.displayRouteCode}
              onClick={() => {
                setAssignModalData({
                  routeCode: card.routeCode,
                  displayRouteCode: card.displayRouteCode,
                  routeColor: card.routeColor,
                  prebookCount: card.prebookCount,
                  prepayCount: card.prepayCount,
                  totalEQ: card.totalEQ,
                  currentWorkerIds: card.assignedWorkerIds,
                  letter: card.isSplit ? card.letter : undefined,
                  canSplit: card.assignedWorkerIds.length === 0,
                });
              }}
              className="w-full text-left p-2.5 rounded-lg bg-gray-800 hover:bg-gray-750 border border-gray-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: card.routeColor }} />
                  <span className="text-white">{card.displayRouteCode}</span>
                </span>
                {card.isAssigned
                  ? <span className="text-[10px] text-green-400 font-medium truncate max-w-[160px]">{card.assignedWorkerLabel}</span>
                  : <span className="text-[10px] text-amber-400 font-medium">Unassigned</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                <span>{card.prebookCount} jobs</span>
                <span>·</span>
                <span>{card.prepayCount} prepay</span>
                <span>·</span>
                <span>EQ {card.totalEQ.toFixed(1)}</span>
              </div>
            </button>
          ))}

          {sidebarMode === 'staff' && !isTeamSeason && sortedWorkerCards.length === 0 && (
            <div className="text-center text-gray-500 text-xs py-8">No staff to show.</div>
          )}
          {sidebarMode === 'staff' && isTeamSeason && sortedCartCards.length === 0 && (
            <div className="text-center text-gray-500 text-xs py-8">No carts to show.</div>
          )}
          {sidebarMode === 'routes' && routeCardData.length === 0 && (
            <div className="text-center text-gray-500 text-xs py-8">No routes to show.</div>
          )}
        </div>
      </div>

      {/* ON-ROUTE FLOATER CARD */}
      {(onRouteWorkerCard || onRouteCartCard) && !navState && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(340px,90vw)]">
          <div className="bg-gray-900/95 backdrop-blur-sm rounded-xl border border-gray-700 shadow-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-white text-sm flex items-center gap-1.5">
                <MapPin size={14} className="text-blue-400" />
                {onRouteCartCard
                  ? (onRouteCartCard.members.map(m => m.firstName).join(' & ') || onRouteCartCard.teamId)
                  : `${onRouteWorkerCard!.worker.firstName} ${onRouteWorkerCard!.worker.lastName}`}
              </span>
              {onRouteRedFlags.hasFlag && <AlertTriangle size={15} className="text-amber-400" />}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              {onRouteCartCard ? (
                <>
                  <span>{onRouteCartCard.stats.steps} steps</span>
                  <span>·</span>
                  <span>EQ {onRouteCartCard.stats.eq.toFixed(1)}</span>
                </>
              ) : (
                <>
                  <span>{onRouteWorkerCard!.stats.steps} steps</span>
                  <span>·</span>
                  <span>EQ {onRouteWorkerCard!.stats.eq.toFixed(1)}</span>
                </>
              )}
            </div>
            <button
              onClick={() => onRouteCartCard ? handleNavigateToCart(onRouteCartCard) : handleNavigateToWorker(onRouteWorkerCard!)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              <Navigation2 size={13} /> Navigate
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE NAVIGATION */}
      {navState && (
        <RMNavigation
          destination={navState.destination}
          onCancel={handleNavCancel}
          onArrived={handleNavArrived}
        />
      )}

      {/* WORKER DETAIL MODAL (aeration) */}
      {selectedWorkerForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedWorkerForModal(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white">{selectedWorkerForModal.worker.firstName} {selectedWorkerForModal.worker.lastName}</span>
              <button onClick={() => setSelectedWorkerForModal(null)} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">Steps</div>
                  <div className="text-white font-bold">{selectedWorkerForModal.stats.steps}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">EQ</div>
                  <div className="text-white font-bold">{selectedWorkerForModal.stats.eq.toFixed(1)}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">Up $</div>
                  <div className="text-white font-bold">{selectedWorkerForModal.stats.upsellGross.toFixed(0)}</div>
                </div>
              </div>

              <div className="flex gap-2">
                {workerCanNavigate(selectedWorkerForModal) && (
                  <button
                    onClick={() => { handleNavigateToWorker(selectedWorkerForModal); setSelectedWorkerForModal(null); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
                  >
                    <Navigation2 size={14} /> Navigate
                  </button>
                )}
                <button
                  onClick={() => handleViewLogsheet(selectedWorkerForModal.worker)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold"
                >
                  <Eye size={14} /> Logsheet
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-300">Upsells</span>
                  <button
                    onClick={() => handleToggleUpsells(selectedWorkerForModal.worker.contractorId, selectedWorkerForModal.upsellsEnabled)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium ${
                      selectedWorkerForModal.upsellsEnabled ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {selectedWorkerForModal.upsellsEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              <ContractorJobs
                bookings={selectedWorkerForModal.displayBookings}
                financialStore={selectedWorkerForModal.financialStore}
                seasonType={seasonType}
              />
            </div>
          </div>
        </div>
      )}

      {/* CART DETAIL MODAL (team) */}
      {selectedCartForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedCartForModal(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white flex items-center gap-1.5">
                {selectedCartForModal.members.length > 1 ? <Truck size={15} className="opacity-70" /> : null}
                {selectedCartForModal.members.map(m => m.firstName).join(' & ') || selectedCartForModal.teamId}
                {selectedCartForModal.isRcCart && <Shovel size={13} className="text-amber-400" />}
              </span>
              <button onClick={() => setSelectedCartForModal(null)} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">Steps</div>
                  <div className="text-white font-bold">{selectedCartForModal.stats.steps}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">EQ</div>
                  <div className="text-white font-bold">{selectedCartForModal.stats.eq.toFixed(1)}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">Pend</div>
                  <div className="text-white font-bold">{selectedCartForModal.stats.pending}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-2">
                  <div className="text-[9px] uppercase text-gray-500 font-bold">Up $</div>
                  <div className="text-white font-bold">{selectedCartForModal.stats.upsellGross.toFixed(0)}</div>
                </div>
              </div>

              {selectedCartForModal.asphaltOwnedRows.length > 0 && (
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-2">
                  <div className="text-[11px] font-semibold text-amber-300 mb-1 flex items-center gap-1">
                    <Shovel size={12} /> Asphalt rows
                  </div>
                  {selectedCartForModal.asphaltOwnedRows.map(row => (
                    <div key={row.id} className="flex items-center justify-between text-[11px] text-gray-300 py-0.5">
                      <span className="truncate">{assembleAddressFromPending(row)} · {formatAsphaltDollars(row.asphaltAmount)}</span>
                      {row.assignedRcSessionId && (
                        <button
                          onClick={() => handleUnassignAsphalt(row.id, assembleAddressFromPending(row))}
                          disabled={unassigningAsphaltId === row.id}
                          className="ml-2 px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-[10px] flex items-center gap-1"
                        >
                          {unassigningAsphaltId === row.id ? <Loader size={10} className="animate-spin" /> : <Undo2 size={10} />}
                          Unassign
                        </button>
                      )}
                    </div>
                  ))}
                  {unassignError && <div className="text-[10px] text-red-400 mt-1">{unassignError}</div>}
                </div>
              )}

              <div className="flex gap-2">
                {cartCanNavigate(selectedCartForModal) && (
                  <button
                    onClick={() => { handleNavigateToCart(selectedCartForModal); setSelectedCartForModal(null); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
                  >
                    <Navigation2 size={14} /> Navigate
                  </button>
                )}
                <button
                  onClick={() => handleViewLogsheet(selectedCartForModal.members[0], selectedCartForModal.members)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold"
                >
                  <Eye size={14} /> Logsheet
                </button>
              </div>

              <ContractorJobs
                bookings={selectedCartForModal.sharedBookings}
                financialStore={selectedCartForModal.sharedFinancialStore}
                seasonType={seasonType}
              />
            </div>
          </div>
        </div>
      )}

      {/* ROUTE PREBOOKINGS POPUP */}
      {selectedRouteForBookings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedRouteForBookings(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white">Route {selectedRouteForBookings}</span>
              <button onClick={() => setSelectedRouteForBookings(null)} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
              <ContractorJobs
                bookings={selectedRouteBookings}
                financialStore={selectedRouteFinancialStore}
                seasonType={seasonType}
              />
            </div>
          </div>
        </div>
      )}

      {/* PENDING JOB MODAL */}
      {pendingJobForModal && (
        <PendingJobModal
          booking={pendingJobForModal}
          seasonType={seasonType}
          onClose={() => setPendingJobForModal(null)}
        />
      )}

      {/* ASSIGNMENT MODAL */}
      {assignModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAssignModalData(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full" style={{ background: assignModalData.routeColor }} />
                Route {assignModalData.displayRouteCode}
              </span>
              <button onClick={() => setAssignModalData(null)} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-3 text-[11px] text-gray-400">
                <span>{assignModalData.prebookCount} jobs</span>
                <span>·</span>
                <span>{assignModalData.prepayCount} prepay</span>
                <span>·</span>
                <span>EQ {assignModalData.totalEQ.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {assignModalData.canSplit && (
                  <button
                    onClick={handleOpenSplitModal}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 text-[11px] font-medium"
                  >
                    <Scissors size={12} /> Split
                  </button>
                )}
                <button
                  onClick={openTransferModal}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 text-[11px] font-medium"
                >
                  <ArrowRightLeft size={12} /> Transfer
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {assignModalData.currentWorkerIds.length > 0 && (
                <button
                  onClick={() => handleAssignRoute(null)}
                  disabled={assignLoading}
                  className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-700/40 text-red-300 text-sm font-medium"
                >
                  <UserMinus size={15} /> Unassign
                </button>
              )}

              {!isTeamSeason && sortedAerationAssignList.map(worker => {
                const badges = workerRouteBadges.get(worker.contractorId) || [];
                const isCurrent = assignModalData.currentWorkerIds.includes(worker.contractorId);
                return (
                  <button
                    key={worker.contractorId}
                    onClick={() => handleAssignRoute(worker.contractorId)}
                    disabled={assignLoading || isCurrent}
                    className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-sm transition-all ${
                      isCurrent
                        ? 'bg-green-900/30 border-green-700/40 text-green-300'
                        : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {isCurrent ? <Check size={14} /> : <UserPlus size={14} className="opacity-60" />}
                      {worker.firstName} {worker.lastName}
                    </span>
                    {badges.length > 0 && (
                      <span className="flex items-center gap-1">
                        {badges.map(b => (
                          <span key={b.code} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: b.color }} title={b.code} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}

              {isTeamSeason && sortedTeamAssignList.map(([sessionWorkerId, members]) => {
                const repId = members[0]?.contractorId;
                const badges = repId ? (workerRouteBadges.get(repId) || []) : [];
                const isCurrent = members.some(m => assignModalData.currentWorkerIds.includes(m.contractorId));
                return (
                  <button
                    key={sessionWorkerId}
                    onClick={() => repId && handleAssignRoute(repId)}
                    disabled={assignLoading || isCurrent}
                    className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-sm transition-all ${
                      isCurrent
                        ? 'bg-green-900/30 border-green-700/40 text-green-300'
                        : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {isCurrent ? <Check size={14} /> : (members.length > 1 ? <Truck size={14} className="opacity-60" /> : <UserPlus size={14} className="opacity-60" />)}
                      {members.map(m => m.firstName).join(' & ')}
                    </span>
                    {badges.length > 0 && (
                      <span className="flex items-center gap-1">
                        {badges.map(b => (
                          <span key={b.code} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: b.color }} title={b.code} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TRANSFER MODAL */}
      {transferModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setTransferModalData(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-sm overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white">{transferModalData.title}</span>
              <button onClick={() => setTransferModalData(null)} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-2 space-y-1 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {availableManagers.length === 0 && (
                <div className="text-center text-gray-500 text-xs py-6">No other managers available.</div>
              )}
              {availableManagers.map(mgr => (
                <button
                  key={mgr.userId}
                  onClick={() => handleTransferConfirm(mgr.userId)}
                  className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm"
                >
                  <ArrowRight size={14} className="opacity-60" /> {mgr.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MANAGE TEAM MODAL */}
      {showManageTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCloseManageTeamModal}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white flex items-center gap-1.5"><Users size={16} /> Manage Team</span>
              <button onClick={onCloseManageTeamModal} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
              {reassignSuccess && (
                <div className="text-[11px] text-green-400 bg-green-900/20 border border-green-700/40 rounded-lg p-2">{reassignSuccess}</div>
              )}
              {reassignError && (
                <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg p-2">{reassignError}</div>
              )}

              {!selectedWorkerToMove && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold px-1 py-1">Tap a worker to move them</div>
                  {isTeamSeason && contractorsByCart
                    ? Array.from(contractorsByCart.entries()).map(([sid, members]) => (
                        <div key={sid} className="bg-gray-800 rounded-lg border border-gray-700 p-2">
                          <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                            {members.length > 1 ? <Truck size={11} /> : null}
                            {members.map(m => m.firstName).join(' & ')}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {members.map(m => {
                              const cartCard = cartCardData.find(c => c.members.some(mm => mm.contractorId === m.contractorId)) || null;
                              return (
                                <button
                                  key={m.contractorId}
                                  onClick={() => { setSelectedWorkerToMove(m); setSelectedWorkerSourceCart(cartCard); }}
                                  className="px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-white text-[11px]"
                                >
                                  {m.firstName} {m.lastName.charAt(0)}.
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    : myTeamWorkers.map(w => (
                        <button
                          key={w.contractorId}
                          onClick={() => { setSelectedWorkerToMove(w); setSelectedWorkerSourceCart(null); }}
                          className="w-full text-left p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm"
                        >
                          {w.firstName} {w.lastName}
                        </button>
                      ))}
                </>
              )}

              {selectedWorkerToMove && (
                <>
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg border border-gray-700 p-2">
                    <span className="text-white text-sm font-semibold">{selectedWorkerToMove.firstName} {selectedWorkerToMove.lastName}</span>
                    <button onClick={() => { setSelectedWorkerToMove(null); setSelectedWorkerSourceCart(null); }} className="text-[11px] text-gray-400 hover:text-white">Back</button>
                  </div>

                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold px-1 py-1">Move to</div>

                  {isTeamSeason && (
                    <>
                      {contractorsByCart && Array.from(contractorsByCart.entries())
                        .filter(([sid]) => sid !== selectedWorkerSourceCart?.sessionId)
                        .map(([sid, members]) => (
                          <button
                            key={sid}
                            onClick={() => handleReassignWorker({ type: 'existing_cart', targetSessionId: sid, label: members.map(m => m.firstName).join(' & ') })}
                            disabled={reassignLoading}
                            className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm"
                          >
                            <Truck size={14} className="opacity-60" /> {members.map(m => m.firstName).join(' & ')}
                          </button>
                        ))}
                      <button
                        onClick={() => handleReassignWorker({ type: 'new_solo' })}
                        disabled={reassignLoading}
                        className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm"
                      >
                        <Shuffle size={14} className="opacity-60" /> New solo cart
                      </button>
                    </>
                  )}

                  {availableManagers.map(mgr => (
                    <button
                      key={mgr.userId}
                      onClick={() => isTeamSeason
                        ? handleReassignWorker({ type: 'different_manager', targetManagerId: mgr.userId })
                        : handleAerationTransfer(mgr.userId)}
                      disabled={reassignLoading}
                      className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm"
                    >
                      <ArrowRight size={14} className="opacity-60" /> {mgr.name}
                    </button>
                  ))}

                  <button
                    onClick={handleRemoveWorkerNoShow}
                    disabled={reassignLoading}
                    className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-700/40 text-red-300 text-sm font-medium mt-2"
                  >
                    <Trash2 size={14} /> Remove (no-show)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SWITCH NAV CONFIRMATION */}
      {switchNavConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSwitchNavConfirm(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-xs p-4" onClick={e => e.stopPropagation()}>
            <div className="text-white text-sm font-semibold mb-1">Switch navigation?</div>
            <div className="text-gray-400 text-xs mb-3">
              You're currently navigating to {switchNavConfirm.currentLabel}. Switch to {switchNavConfirm.newLabel}?
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSwitchNavConfirm(null)} className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium">Keep current</button>
              <button onClick={handleSwitchNavConfirm} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">Switch</button>
            </div>
          </div>
        </div>
      )}

      {/* ROUTE NAV PROMPT (staff-mode route line tap) */}
      {routeNavPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRouteNavPrompt(null)}>
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-xs overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-bold text-white flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: routeNavPrompt.routeColor }} />
                Route {routeNavPrompt.routeCode}
              </span>
              <button onClick={() => setRouteNavPrompt(null)} className="p-1 text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-2 space-y-1">
              {routeNavPrompt.entries.map((entry, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRouteNavPromptSelect(entry)}
                  disabled={!entry.hasGeocodableAddress}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-sm ${
                    entry.hasGeocodableAddress
                      ? 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-white'
                      : 'bg-gray-850 border-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {entry.type === 'cart' ? <Truck size={14} className="opacity-60" /> : <MapPin size={14} className="opacity-60" />}
                    {entry.label}
                  </span>
                  {entry.hasGeocodableAddress
                    ? <Navigation2 size={14} className="text-blue-400" />
                    : <span className="text-[10px]">No location</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ROUTE SPLIT MODAL */}
      {splitModalData && (
        <RouteSplitModal
          routeCode={splitModalData.routeCode}
          baseRouteColor={splitModalData.baseRouteColor}
          segments={splitModalData.segments}
          prebookings={splitModalData.prebookings}
          existingBuckets={splitModalData.existingBuckets}
          splittingFromLetter={splitModalData.splittingFromLetter}
          newLetter={splitModalData.newLetter}
          onConfirm={handleSplitConfirm}
          onCancel={handleSplitCancel}
        />
      )}
    </div>
  );
};

export default RMMapTab;
