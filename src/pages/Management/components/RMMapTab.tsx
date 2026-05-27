// src/pages/Management/components/RMMapTab.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Loader, ChevronLeft, ChevronRight, X, Users, Eye, Phone, MapPin,
  AlertCircle, LayoutList, AlertTriangle, Truck, Bookmark, Shovel, Leaf,
  FileText, Check, ArrowRight, ArrowRightLeft, Shuffle, Trash2, UserPlus,
  UserMinus, Undo2, Navigation2, Compass,
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
  SessionTransaction,
} from '../../../types';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';
import ContractorJobs from './ContractorJobs';
import PendingJobModal from '../../../components/PendingJobModal';
import RMNavigation, { NavDestination } from './RMNavigation';
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
  routeCode: string; routeColor: string; assignedWorkerIds: string[];
  assignedWorkerLabel: string; prebookCount: number; prepayCount: number; totalEQ: number; isAssigned: boolean;
}

interface AssignModalData {
  routeCode: string; routeColor: string; prebookCount: number; prepayCount: number; totalEQ: number; currentWorkerIds: string[];
}

// NEW: nav-related state types.
// Active nav state — destination + label for the maneuver card.
interface NavState {
  destination: NavDestination;
  // Lightweight identifier so we can detect "is this the same target?" if user re-taps.
  targetKey: string;       // e.g. 'worker:abc123' or 'cart:sess_xyz'
}

// Switch-target confirmation popup data — shown when user taps Navigate on a
// different worker/cart while another nav is active.
interface SwitchNavConfirmation {
  newDestination: NavDestination;
  newTargetKey: string;
  currentLabel: string;
  newLabel: string;
}

// NEW: route-line-click navigation prompt (Staff mode only).
// When the RM taps a route line on the map while the Staff sidebar is open,
// we offer to navigate to whoever's working that route. If exactly one
// contractor/cart is assigned, the modal is a confirmation ("Navigate to
// John?"). If multiple distinct carts are assigned (rare), it's a picker
// with one Navigate button per cart. Unassigned routes are silently ignored
// (no popup at all) — to (re)assign a route, switch to Routes mode.
interface RouteNavPromptEntry {
  // 'worker' for aeration solo workers, 'cart' for team-season carts
  // (including multi-member carts and single-member team carts).
  type: 'worker' | 'cart';
  // Display label: "John D." or "John & Mike"
  label: string;
  // The card object — shape depends on `type`. Cast at the call site of the
  // existing handleNavigate{ToWorker,ToCart} handlers.
  card: WorkerCardData | CartCardData;
  // Whether resolveNavDestination() returns a coordinate for this contractor.
  // False means there's no geocoded transaction to navigate to — we still
  // render the entry but the Navigate button is disabled.
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

// Builds the GPS "you are here" marker. Returns an OUTER wrapper that's safe
// to hand to Mapbox (Mapbox sets `transform: translate(...)` on it for
// positioning) and an INNER rotating div that we control for heading rotation.
//
// This split matters: if we tried to rotate the same div Mapbox uses for
// positioning, Mapbox would clobber our rotate() on every map move with its
// own translate(). Two nested divs sidestep the conflict — outer gets
// translate, inner gets rotate, neither fights the other.
function createNavArrow(): { outer: HTMLDivElement; inner: HTMLDivElement } {
  const outer = document.createElement('div');
  outer.style.cssText = 'pointer-events:none;width:42px;height:42px;';

  const inner = document.createElement('div');
  // 0.15s transition smooths low-rate GPS-derived heading updates without
  // adding noticeable lag to high-rate compass events.
  inner.style.cssText = 'width:100%;height:100%;transition:transform 0.15s linear;transform-origin:50% 50%;';
  // Red arrow with black outline on a translucent black halo. Higher visual
  // weight than the original blue-on-white version — easier to spot on busy
  // map backgrounds.
  inner.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#000000" stroke="#ffffff" stroke-width="1.5" opacity="0.35"/><path d="M12 3 L18.5 19 L12 14.5 L5.5 19 Z" fill="#ef4444" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

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

// Compute great-circle bearing (degrees clockwise from north) from point 1 to point 2.
// Used to derive a heading from two successive GPS fixes when the device compass
// isn't available (Android tablets, desktop, or iOS with denied permission).
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

// --- NAV DESTINATION RESOLVER ---
//
// Walk the financialStore newest-first and find the first transaction whose
// address has a geocode. Returns null if nothing geocodable exists — the
// Navigate button is hidden in that case.
//
// Upsells (Upgrade / Add-On tx) are NOT skipped — they're valid nav targets
// when they're the most recent transaction. Their address typically matches
// the parent aeration tx at the same location, so navigating "to the upsell"
// and navigating "to the parent job" land you at the same coordinates anyway.
// What matters is that the most-recent record wins regardless of type, so
// the Navigate button always points at where the worker last logged work.
//
// Cache priority per spec:
//   1. jobIdCache (per-tx accurate — populated by Phase 2 geocoding)
//   2. geocodeCache (address-level — populated by all phases)
function resolveNavDestination(financialStore: any[]): { lat: number; lng: number; address: string } | null {
  if (!financialStore || financialStore.length === 0) return null;

  // Sort newest-first. Defensive copy — we don't mutate caller's array.
  const sorted = [...financialStore].sort((a, b) => {
    const ta = a?.timestamp || '';
    const tb = b?.timestamp || '';
    return tb.localeCompare(ta);
  });

  for (const tx of sorted) {
    if (!tx) continue;
    const address: string = tx.address || '';
    if (!address) continue;

    // Try jobIdCache first.
    if (tx.jobId) {
      const ic = jobIdCache.get(tx.jobId);
      if (ic && ic.lat != null && ic.lng != null) {
        return { lat: ic.lat, lng: ic.lng, address: ic.address || address };
      }
    }
    // Fall back to geocodeCache by normalized address.
    const key = makeCacheKey(address);
    const gc = geocodeCache.get(key);
    if (gc && gc.lat != null && gc.lng != null) {
      return { lat: gc.lat, lng: gc.lng, address };
    }
    // No hit for this tx — move on to the next-most-recent.
  }

  return null;
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
  // Upsells (Upgrade / Add-On tx) — geocoded separately so we can render
  // them with their own blue-ring style and detect overlap with completed/sale
  // pins at the same address.
  const knownUpsellPinsRef = useRef<Map<string, GeocodedPin>>(new Map());
  const [geocodedUpsellPins, setGeocodedUpsellPins] = useState<GeocodedPin[]>([]);
  const mountedRef = useRef(true);
  const centerOnLocationRef = useRef(false);
  // Last GPS position we ACTUALLY re-centered the map at. Used with a small
  // movement threshold to avoid restarting easeTo animations every GPS fix
  // when the device is stationary and GPS is jittering by a metre or two —
  // the cause of the follow-me "flicker".
  const lastCenteredAtRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const navMarkerRef = useRef<mapboxgl.Marker | null>(null);
  // The OUTER wrapper of the GPS arrow — Mapbox sets translate(...) here for
  // positioning. We never touch this transform.
  const navArrowElRef = useRef<HTMLDivElement | null>(null);
  // The INNER div nested inside navArrowElRef — we rotate this for heading.
  // Decoupled from the outer so Mapbox's positioning translate doesn't clobber
  // our rotation.
  const navArrowInnerRef = useRef<HTMLDivElement | null>(null);
  // --- COMPASS / HEADING ROTATION REFS ---
  //
  // The arrow rotation priority is:
  //   1. GPS-derived heading IF it was computed recently (i.e. you're moving).
  //      This reflects your actual direction of travel, which is what users
  //      expect to see in a navigation map. Compass measures which way the
  //      DEVICE is facing, not which way you're going — useless if you're
  //      holding a tablet vertically while walking forward.
  //   2. Compass heading as a fallback (when GPS-derived heading is stale,
  //      i.e. you've been stationary for >5s). Compass works while parked
  //      and helps orient the arrow before you start moving.
  //
  // Both update through applyArrowRotation() (defined below as a useCallback)
  // so the priority logic lives in one place and both event sources stay
  // consistent.
  const compassHeadingRef = useRef<number | null>(null);
  const gpsHeadingRef = useRef<number | null>(null);
  // Timestamp (ms epoch) when gpsHeadingRef was last set. Determines whether
  // the GPS-derived heading is "fresh" enough to win over compass.
  const gpsHeadingUpdatedAtRef = useRef<number>(0);
  // Last GPS position seen, used to compute bearingDeg() between fixes.
  const lastGpsPosRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  // The compass event handler — kept so we can remove it on unmount.
  const compassHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  // iOS Safari 13+ requires a user gesture to grant compass permission. When
  // true, we render a small "Enable compass" button in HALF 2 that calls
  // handleEnableCompass on tap.
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

  // --- NEW: NAV STATE ---
  // Active nav (null = not navigating). When set, RMNavigation overlay renders.
  const [navState, setNavState] = useState<NavState | null>(null);
  // Confirmation popup when user taps Navigate while one is already active.
  const [switchNavConfirm, setSwitchNavConfirm] = useState<SwitchNavConfirmation | null>(null);
  // Staff-mode route-line tap → "Navigate to who?" prompt. Null when closed.
  // Single-entry shows as confirmation, multi-entry shows as picker.
  const [routeNavPrompt, setRouteNavPrompt] = useState<RouteNavPrompt | null>(null);

  // --- ARROW ROTATION ---
  // Shared by the GPS watch callback, the compass listener, AND the map's
  // rotate event so all three sources route through the same priority logic.
  // GPS-derived heading wins when fresh (last computed within 5s), reflecting
  // your actual direction of travel. Compass is the fallback for stationary
  // use. The map's current bearing is SUBTRACTED so the arrow stays aligned
  // to world-true heading even when the user rotates the map — otherwise a
  // 30° map rotation would visually skew the arrow by 30°.
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
    // Map bearing: degrees clockwise from north that the map is rotated.
    // Subtract from heading so the arrow points to the world direction,
    // not the screen direction.
    const mapBearing = mapRef.current?.getBearing() ?? 0;
    navArrowInnerRef.current.style.transform = `rotate(${heading - mapBearing}deg)`;
  }, []);

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

  // Upsells live in financialStore as type='Upgrade' or 'Add-On'. They sit at
  // the same address as their parent aeration job, so their addresses are
  // typically already in geocodeCache once phase 2 has run — no new geocoding
  // phase needed. We still build a separate source list so the rendering
  // pipeline can treat them distinctly (blue ring, half-overlay at overlap
  // points, dedicated popup).
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

  // Most-recent transaction per session — drives the pulsing ring marker.
  // INCLUDES upsells now (Upgrade / Add-On) since the user asked that the
  // upsell pin be eligible as the most-recent location indicator. We look
  // across BOTH the completed/sale pin set and the upsell pin set when
  // resolving each session's latest jobId to a geocoded position.
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
      // Try completed/sale first, then upsells. Whichever has the matching
      // jobId wins. The pulsing ring uses the pin's routeColor for its
      // color, so the visual is consistent regardless of which type.
      const pin =
        geocodedPins.find(p => p.id === jobId && (p.status === 'completed' || p.status === 'new_sale'))
        ?? geocodedUpsellPins.find(p => p.id === jobId);
      if (pin) result.push(pin);
    });
    return result;
  }, [allSessions, geocodedPins, geocodedUpsellPins, isTeamSeason]);

  // Overlap detection: addresses (cache-key normalized) that have BOTH a
  // completed/sale pin AND an upsell pin. At these positions the rendering
  // logic does two things:
  //   1) excludes the upsell from the "upsell-only" circle layer (we don't
  //      want to draw two stacked full rings at the same point),
  //   2) adds the address to the half-blue overlay symbol layer (drawing
  //      a blue right-half arc on top of the existing green/yellow ring).
  // Click handler for the underlying completed/sale pin also reads from this
  // set to decide whether to show the combined popup (Q2 = B).
  const overlapInfo = useMemo(() => {
    // Map<cacheKey, { upsellPin, basePin }>
    // upsellPin: the upsell pin at this address (for popup details, overlay)
    // basePin:   the completed/sale pin at this address (for left-side color)
    const map = new Map<string, { upsellPin: GeocodedPin; basePin: GeocodedPin }>();
    if (geocodedUpsellPins.length === 0) return map;
    // Index completed/sale pins by address for fast lookup.
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

  // Route click handlers — mode-aware.
  //   - In Routes mode (sidebar shows route cards), tapping a route line on
  //     the map opens the route assignment modal as before.
  //   - In Staff mode (sidebar shows staff cards), tapping a route line opens
  //     a "Navigate to who?" prompt with one entry per assigned worker (or
  //     cart, for team seasons). Unassigned routes silently do nothing.
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    const cleanups:Array<()=>void>=[];
    routeMapData.forEach(route=>{
      if(!myRouteCodes.includes(route.route_code)) return;

      // Show pointer cursor in BOTH modes now — the click does something in
      // either case (assignment modal in Routes mode, nav prompt in Staff mode).
      const enter=()=>{ map.getCanvas().style.cursor='pointer'; };
      const leave=()=>{ map.getCanvas().style.cursor=''; };

      const click=(e:any)=>{
        e.preventDefault();
        const mode = sidebarModeRef.current;
        const rc = route.route_code;
        const cr = routesRef.current, cb = bookingsRef.current;
        const rp = cr.find(r => r.routeCode === rc);
        const assignedIds = rp?.assignedWorkerIds || [];

        if (mode === 'routes') {
          // Existing behaviour — open the assignment modal.
          const rb = cb.filter(b => b['Route Number'] === rc);
          const totalEQ = rb.reduce((sum, b) => sum + calculateBookingEQ(b), 0);
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
          setAssignModalData({
            routeCode: rc,
            routeColor: route.route_color,
            prebookCount: rb.length,
            prepayCount: rb.filter(b => b.Prepaid === 'x').length,
            totalEQ,
            currentWorkerIds: assignedIds,
          });
          return;
        }

        // STAFF MODE — build the nav prompt entries.
        if (assignedIds.length === 0) return; // silently ignore unassigned

        const entries: RouteNavPromptEntry[] = [];
        if (isTeamSeason) {
          // Group assigned workers by their cart (session). For team seasons,
          // both members of a multi-member cart share the same financialStore,
          // so they go in as a single entry. If a route happens to span two
          // distinct carts (rare), each cart gets its own entry.
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
          // Aeration — one entry per worker (each worker has their own session).
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

        if (entries.length === 0) return; // defensive — shouldn't happen
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        setRouteNavPrompt({
          routeCode: rc,
          routeColor: route.route_color,
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
  }, [routeMapData, mapLoaded, myRouteCodes, calculateBookingEQ, isTeamSeason]);

  // --- LAYER RENDERERS ---

  // Ref-mirrored overlap info, read by the completed-pins click handler when
  // deciding whether to append upsell details to its popup. We use a ref
  // (not direct state) so the click handler closure registered once on layer
  // creation always sees the current overlap data without needing to be
  // re-registered every time the data changes.
  const overlapInfoRef = useRef<Map<string, { upsellPin: GeocodedPin; basePin: GeocodedPin }>>(new Map());
  useEffect(() => { overlapInfoRef.current = overlapInfo; }, [overlapInfo]);

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

      // Combined-popup branch: if this address has an upsell at the same
      // location (i.e. is in overlapInfoRef), append upsell details to the
      // bottom of the popup with a divider above. Per Q2=B requirement.
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

  // Upsell-ONLY circles (blue ring) — feeds addresses that have an upsell tx
  // and NO completed/sale at the same point. Overlap points are drawn with a
  // half-blue overlay symbol instead (see updateOverlapHalfPins below).
  // Fill follows the route color like other pins; the stroke is the
  // distinguishing blue (#3b82f6, Tailwind blue-500).
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

  // Half-blue overlay symbols at overlap addresses (where a completed/sale
  // pin AND an upsell exist at the same lat/lng). Renders a symbol whose
  // icon is the right-half-blue arc — overlayed on top of the underlying
  // green/yellow completed-pin circle. Together they read as a single ring
  // with the left half its original color and the right half blue.
  //
  // The icon itself is created in map onload (see the icon-creation block).
  // No click handler on this layer — clicks fall through to the underlying
  // rm-completed-pins-circles layer, which knows (via overlapInfoRef) to
  // render the combined popup.
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
    // Upsell layers piggyback on the same toggle (Q3 = grouped under
    // pendingSalesAndCompleted, no separate filter).
    if (map.getLayer('rm-upsell-only-circles')) {
      map.setPaintProperty('rm-upsell-only-circles', 'circle-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-overlap-half-symbols')) {
      map.setPaintProperty('rm-overlap-half-symbols', 'icon-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-historical-symbols')) {
      map.setPaintProperty('rm-historical-symbols', 'icon-opacity', filterVisibility.historical ? 0.85 : 0);
    }
    if (map.getLayer('rm-pcl-circles')) {
      map.setPaintProperty('rm-pcl-circles', 'circle-opacity', filterVisibility.pcl ? 0.7 : 0);
    }
  }, [filterVisibility, mapLoaded]);

  // --- SERIAL GEOCODING STATE MACHINE ---

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

  // PHASE 2: Completed + new sales + pending sales
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
      if (isTeamSeason) {
        setGeocodedPendingSales(pendingSalesCached);
      }

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

      onGeocodeProgress('complete', 'pcl', total, total, true);
    })();

    return () => { cancelled = true; };
  }, [mapLoaded, geocodeCacheHydrated, geocodePhase, pclByRoute, geocodeOne, updatePclCircles, onGeocodeProgress]);

  // INCREMENTAL: mid-day pending-sales additions
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
        const stillRelevant = new Set(merged.map(b => b['Booking ID']));
        setGeocodedPendingSales(prev => {
          const next = [...prev.filter(g => stillRelevant.has(g.id)), ...additions];
          return next;
        });
      } else {
        const stillRelevant = new Set(merged.map(b => b['Booking ID']));
        setGeocodedPendingSales(prev => prev.filter(g => stillRelevant.has(g.id)));
      }
    })();
    return () => { cancelled = true; };
  }, [pendingSalesByManager, geocodePhase, isTeamSeason, mapLoaded, geocodeCacheHydrated, geocodeOne]);

  // --- UPSELL GEOCODING ---
  // Upsells (Upgrade / Add-On tx) sit at the same address as their parent
  // aeration job. Once Phase 2 has populated geocodeCache with those parent
  // addresses, the vast majority of upsell pins resolve from cache instantly
  // — no Mapbox calls needed. For the rare upsell at an address that didn't
  // get geocoded by phase 2 (shouldn't happen, but defensive), we fall
  // through to geocodeOne which itself checks the cache and only hits the
  // network if nothing is found.
  //
  // We trigger this after Phase 2 finishes (geocodePhase past 'phase2_*'),
  // and re-run incrementally whenever upsellPinSource changes (a worker
  // adds a new upsell mid-day).
  useEffect(() => {
    if (!mapLoaded || !geocodeCacheHydrated) return;
    // Only run once Phase 2 has populated cache with completed/sale addresses.
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
          additions.push({
            ...pin,
            lat: coord.lat,
            lng: coord.lng,
            routeColor: routeColorMap.get(pin.routeCode) || '#888888',
          });
        }
        // Small yield between iterations even when serving from cache — keeps
        // the main thread responsive on large upsell lists.
        await new Promise(r => setTimeout(r, 0));
      }

      if (cancelled || !mountedRef.current) return;
      const stillRelevantIds = new Set(sources.map(p => p.id));
      additions.forEach(p => knownUpsellPinsRef.current.set(p.id, p));
      // Prune any cached upsells whose source no longer lists them (rare —
      // e.g. an upsell tx was retracted).
      for (const id of Array.from(knownUpsellPinsRef.current.keys())) {
        if (!stillRelevantIds.has(id)) {
          knownUpsellPinsRef.current.delete(id);
        }
      }
      setGeocodedUpsellPins(Array.from(knownUpsellPinsRef.current.values()));
    })();
    return () => { cancelled = true; };
  }, [upsellPinSource, geocodePhase, mapLoaded, geocodeCacheHydrated, geocodeOne, routeColorMap]);

  // Drive the upsell-only and overlap-half layers. Recomputes from the
  // current overlapInfo + geocodedUpsellPins state on every change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Upsell-only: upsells whose address ISN'T in overlapInfo.
    const upsellOnly = geocodedUpsellPins.filter(
      p => !overlapInfo.has(makeCacheKey(p.address))
    );
    updateUpsellOnlyPins(map, upsellOnly);

    // Overlap points: one entry per overlap address, using the base pin's
    // coordinates (which match the upsell's, since they share an address).
    const overlapPoints: Array<{ lat: number; lng: number }> = [];
    overlapInfo.forEach(({ basePin }) => {
      overlapPoints.push({ lat: basePin.lat, lng: basePin.lng });
    });
    updateOverlapHalfPins(map, overlapPoints);
  }, [geocodedUpsellPins, overlapInfo, mapLoaded, updateUpsellOnlyPins, updateOverlapHalfPins]);

  // Render pending-sales markers
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

  // Pulsing completion dots
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
  //
  // Arrow rotation: GPS-derived heading is PREFERRED when fresh (the user is
  // moving). This watchPosition callback computes that heading from successive
  // fixes (>5m apart, above walking pace) and stamps gpsHeadingUpdatedAtRef so
  // applyArrowRotation knows it's current. Compass is the fallback for when
  // GPS-derived heading is stale (stationary >5s). Both sources route through
  // applyArrowRotation (defined in PART 1) so the priority logic lives in one
  // place.
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!navigator.geolocation) return;
    if(!navArrowElRef.current) {
      const arrow = createNavArrow();
      navArrowElRef.current = arrow.outer;
      navArrowInnerRef.current = arrow.inner;
    }
    navMarkerRef.current=new mapboxgl.Marker({element:navArrowElRef.current}).setLngLat([0,0]).addTo(map);

    const handleDragStart = (e: any) => {
      if (!e.originalEvent) return;
      if (centerOnLocationRef.current) {
        onFollowMeAutoDisable();
      }
    };
    map.on('dragstart', handleDragStart);

    // Re-apply arrow rotation whenever the map's bearing changes — keeps the
    // arrow pointing at the world heading rather than the screen heading
    // when the user rotates the map (two-finger gesture on touch, or
    // shift-drag on desktop). Without this, the arrow visibly skews by the
    // rotation angle.
    map.on('rotate', applyArrowRotation);

    watchIdRef.current=navigator.geolocation.watchPosition(pos=>{
      if(!navMarkerRef.current||!mapRef.current) return;
      const{latitude:lat,longitude:lng,heading,speed}=pos.coords;
      navMarkerRef.current.setLngLat([lng,lat]);

      // --- Heading computation ---
      // Priority 1: native pos.coords.heading (browser-reported course over
      // ground). Often null at rest or low speeds.
      // Priority 2: bearing from previous fix to current fix, but only if
      // we moved enough that GPS noise won't dominate (>5m).
      // When set, stamp gpsHeadingUpdatedAtRef so the rotation priority logic
      // knows this heading is fresh.
      let derivedHeading: number | null = null;
      if (heading != null && !isNaN(heading)) {
        derivedHeading = heading;
      } else if (lastGpsPosRef.current) {
        const prev = lastGpsPosRef.current;
        const dist = distanceMeters(prev.lat, prev.lng, lat, lng);
        // Only trust GPS-derived bearing if we've moved meaningfully and
        // speed is above walking pace (helps filter out drift while idle).
        if (dist >= 5 && (speed == null || speed > 0.5)) {
          derivedHeading = bearingDeg(prev.lat, prev.lng, lat, lng);
        }
      }
      if (derivedHeading != null) {
        gpsHeadingRef.current = derivedHeading;
        gpsHeadingUpdatedAtRef.current = Date.now();
      }
      lastGpsPosRef.current = { lat, lng, ts: Date.now() };
      applyArrowRotation();

      // Follow-me map centering — re-center on EVERY GPS fix (no movement
      // threshold). The previous threshold of 1m / 3m made follow-me feel
      // static when walking; the real cause of the original flicker was the
      // 1000ms easeTo duration creating overlapping animations. At 300ms,
      // each animation completes before the next GPS fix arrives so there's
      // no stacking and no flicker even at high GPS rates.
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
      map.off('rotate', applyArrowRotation);
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
    };
  }, [mapLoaded, isTeamSeason, managerId, onFollowMeAutoDisable, applyArrowRotation]);

  // --- COMPASS LISTENER WIRING ---
  // On mount (and after a permission grant on iOS), attach a deviceorientation
  // listener that pushes compass headings into compassHeadingRef and applies
  // rotation. Android tablets and desktop just have this work without any
  // permission flow; iOS 13+ Safari requires a user gesture, which we handle
  // by showing a small button overlay in HALF 2 that calls handleEnableCompass.
  const attachCompassListener = useCallback(() => {
    if (compassHandlerRef.current) return; // already attached
    const handler = (e: DeviceOrientationEvent) => {
      // iOS provides webkitCompassHeading directly — degrees clockwise from north.
      const webkit = (e as any).webkitCompassHeading;
      if (typeof webkit === 'number' && !isNaN(webkit)) {
        compassHeadingRef.current = webkit;
      } else if (e.alpha != null && !isNaN(e.alpha)) {
        // Android/desktop: alpha is 0 when device is pointing north and increases
        // counterclockwise. Invert to get clockwise-from-north.
        compassHeadingRef.current = (360 - e.alpha) % 360;
      }
      // Route through the shared rotation logic so the GPS-fresh-wins
      // priority is honoured. If the user is actively moving, GPS-derived
      // heading is fresh and the compass value won't be applied — even
      // though we just updated compassHeadingRef. That's intentional: when
      // moving, direction of travel matters more than device orientation.
      applyArrowRotation();
    };
    window.addEventListener('deviceorientation', handler, true);
    compassHandlerRef.current = handler;
  }, [applyArrowRotation]);

  const handleEnableCompass = useCallback(async () => {
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== 'function') {
      // Shouldn't happen — the button only renders when this exists — but
      // defensive: attach anyway and dismiss the button.
      attachCompassListener();
      setCompassNeedsPermission(false);
      return;
    }
    try {
      const result = await DOE.requestPermission();
      if (result === 'granted') {
        attachCompassListener();
      }
    } catch (err) {
      console.warn('Compass permission request failed:', err);
    }
    // Either way, dismiss the button — if denied, we silently fall back to
    // GPS-derived heading. No point pestering the user.
    setCompassNeedsPermission(false);
  }, [attachCompassListener]);

  useEffect(() => {
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (!DOE) return; // device has no orientation API at all
    if (typeof DOE.requestPermission === 'function') {
      // iOS 13+ — needs user gesture, show the enable button.
      setCompassNeedsPermission(true);
    } else {
      // Android/desktop — no permission flow, attach now.
      attachCompassListener();
    }
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
        // Seed the throttle so we don't immediately re-center again on the
        // next GPS update.
        lastCenteredAtRef.current = { lat: ll.lat, lng: ll.lng };
      }
    }
    if (!centerOnLocation) {
      // Clear the throttle so the next time follow-me turns on, the first
      // GPS update will re-center (any distance > 3m from a null reference).
      lastCenteredAtRef.current = null;
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
      const xh=['poi-label','housenum-label','road-number-shield','transit-label'];
      xh.forEach(id=>{if(map.getLayer(id)) map.setLayoutProperty(id,'visibility','none');});
      // Defensive: also hide any other layer whose id mentions transit or bus
      // — covers bus-stop icons, transit lines, transit shields, station
      // labels, etc. across any Mapbox style variant.
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

      // ---- Half-blue overlay icon (rm-upsell-half-blue) ----
      // Draws ONLY the right half of a ring (semicircle, π to 0 going through
      // 0 from the top, then back) at the same radius/stroke-width as the
      // underlying completed-pin circles. Drawn at pixelRatio 2 for crispness
      // on retina displays. The left half is transparent so the underlying
      // pin's green/yellow stroke shows through unmodified.
      const upsellCanvasSize = 16;
      const upsellCanvas = document.createElement('canvas');
      upsellCanvas.width = upsellCanvasSize;
      upsellCanvas.height = upsellCanvasSize;
      const uctx = upsellCanvas.getContext('2d');
      if (uctx) {
        const cx = upsellCanvasSize / 2;
        const cy = upsellCanvasSize / 2;
        // Underlying circle is radius 3.33 with stroke 1.67. At pixelRatio 2,
        // the icon's nominal pixel space is 2x. So our drawing radius needs
        // to match the painted ring: drawing radius ~= (3.33 + 1.67/2) * 2 ≈
        // 8.3 in canvas pixels. We use slightly larger to ensure full overlap
        // of the stroke.
        const ringRadius = 4.17;     // (3.33 + half stroke) * 2-ish, eyeballed
        const strokeWidth = 1.67 * 2; // double for hi-DPI canvas
        uctx.strokeStyle = '#3b82f6'; // Tailwind blue-500
        uctx.lineWidth = strokeWidth;
        uctx.lineCap = 'butt';
        uctx.beginPath();
        // Right half arc: from top (-π/2) clockwise to bottom (π/2)
        uctx.arc(cx, cy, ringRadius, -Math.PI / 2, Math.PI / 2, false);
        uctx.stroke();
        const upsellImgData = uctx.getImageData(0, 0, upsellCanvasSize, upsellCanvasSize);
        if (!map.hasImage('rm-upsell-half-blue')) {
          map.addImage('rm-upsell-half-blue', upsellImgData, { pixelRatio: 2 });
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

  // --- NEW: NAV ACTION HANDLERS ---
  //
  // Common flow for both worker and cart nav requests:
  //   1. Resolve destination via the fallback chain (newest geocodable transaction).
  //   2. If none found → toast/log and abort (the button shouldn't have been
  //      visible in the first place; this is just defence in depth).
  //   3. If no nav is currently active → start nav directly.
  //   4. If nav is active and same target → no-op.
  //   5. If nav is active and different target → show switch-confirmation popup.
  //
  // When nav starts, force follow-me on if it's off so the camera tracks the RM.
  // The auto-disable-on-drag still works (handleDragStart in the GPS effect),
  // so the RM can tap-pan to inspect mid-trip and follow-me silently turns off.

  const startNavToDestination = useCallback((
    dest: NavDestination,
    targetKey: string
  ) => {
    // Force follow-me on if it's off.
    if (!centerOnLocation && onForceFollowMeOn) {
      onForceFollowMeOn();
    }
    setNavState({ destination: dest, targetKey });
    // Defensive: close any overlays that would visually fight the maneuver card.
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
  }, [centerOnLocation, onForceFollowMeOn]);

  const handleNavigateToWorker = useCallback((card: WorkerCardData) => {
    const resolved = resolveNavDestination(card.financialStore);
    if (!resolved) {
      console.warn('[RMNav] No geocoded address available for', card.worker.contractorId);
      return;
    }
    const label = `${card.worker.firstName} ${card.worker.lastName.charAt(0)}.`;
    const newDest: NavDestination = { lat: resolved.lat, lng: resolved.lng, label };
    const newKey = `worker:${card.worker.contractorId}`;

    if (!navState) {
      startNavToDestination(newDest, newKey);
      return;
    }
    if (navState.targetKey === newKey) return; // tapping the same target — no-op
    setSwitchNavConfirm({
      newDestination: newDest,
      newTargetKey: newKey,
      currentLabel: navState.destination.label,
      newLabel: label,
    });
  }, [navState, startNavToDestination]);

  const handleNavigateToCart = useCallback((cart: CartCardData) => {
    const resolved = resolveNavDestination(cart.sharedFinancialStore);
    if (!resolved) {
      console.warn('[RMNav] No geocoded address available for cart', cart.sessionId);
      return;
    }
    const label = cart.members.length > 1
      ? cart.members.map(m => m.firstName).join(' & ')
      : `${cart.members[0]?.firstName || ''} ${cart.members[0]?.lastName.charAt(0) || ''}.`;
    const newDest: NavDestination = { lat: resolved.lat, lng: resolved.lng, label };
    const newKey = `cart:${cart.sessionId}`;

    if (!navState) {
      startNavToDestination(newDest, newKey);
      return;
    }
    if (navState.targetKey === newKey) return;
    setSwitchNavConfirm({
      newDestination: newDest,
      newTargetKey: newKey,
      currentLabel: navState.destination.label,
      newLabel: label,
    });
  }, [navState, startNavToDestination]);

  // Worker/cart cards expose "can navigate?" — used to hide the Navigate icon
  // when there's no geocodable address. Cheap enough to recompute per-render
  // since it's just cache lookups.
  const workerCanNavigate = useCallback((card: WorkerCardData): boolean => {
    return resolveNavDestination(card.financialStore) !== null;
  }, []);

  const cartCanNavigate = useCallback((cart: CartCardData): boolean => {
    return resolveNavDestination(cart.sharedFinancialStore) !== null;
  }, []);

  const handleNavCancel = useCallback(() => {
    setNavState(null);
  }, []);

  const handleNavArrived = useCallback(() => {
    // Silent end — drops back to regular map. No modal auto-open per spec.
    setNavState(null);
  }, []);

  const handleSwitchNavConfirm = useCallback(() => {
    if (!switchNavConfirm) return;
    startNavToDestination(switchNavConfirm.newDestination, switchNavConfirm.newTargetKey);
    setSwitchNavConfirm(null);
  }, [switchNavConfirm, startNavToDestination]);

  // Route-prompt picker → trigger the existing nav handler for the chosen
  // contractor/cart, then dismiss the prompt. Disabled entries (no
  // geocodable address) shouldn't reach this handler — the button is
  // disabled in the modal — but we defensively no-op if they do.
  const handleRouteNavPromptSelect = useCallback((entry: RouteNavPromptEntry) => {
    if (!entry.hasGeocodableAddress) return;
    setRouteNavPrompt(null);
    if (entry.type === 'cart') {
      handleNavigateToCart(entry.card as CartCardData);
    } else {
      handleNavigateToWorker(entry.card as WorkerCardData);
    }
  }, [handleNavigateToWorker, handleNavigateToCart]);

  // --- EXISTING ACTIONS ---

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

  // --- SIDEBAR RESIZE: when sidebar opens/closes, the map's container
  // changes width. Tell Mapbox to redraw at the new size. Mapbox keeps the
  // same center automatically on resize, so the view stays put.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Wait for the CSS transition to settle, then resize. A single resize
    // after ~250ms covers the 200ms slide animation plus paint.
    const t = setTimeout(() => {
      try { map.resize(); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

  // --- RENDER ---
  return (
    <>
      {/* Inline keyframes for sidebar slide animation */}
      <style>{`
        @keyframes rmSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes rmSlideOut { from { transform: translateX(0); } to { transform: translateX(-100%); } }
      `}</style>

      {/*
        OUTER WRAPPER — fills the viewport minus the RMLogbook header.
        Uses calc(100vh - 160px) as a guaranteed height so flex-1 from the
        parent doesn't race against Mapbox's initial measurement on mobile.
        If your header height differs, adjust 160px up or down by 10-20px.

        Inner layout is a flex row: sidebar on the left (when open), map on
        the right (flex-1, fills remaining space). When the sidebar opens,
        the map shrinks to fit; when it closes, the map expands back to
        full width. A useEffect above calls map.resize() on every toggle so
        Mapbox redraws cleanly at the new size.
      */}
      <div
        className="relative w-full flex flex-row"
        style={{ height: 'calc(100vh - 160px)' }}
      >

        {/* SIDEBAR — flex sibling, not an overlay. Takes up real width when
            open, so the map shrinks to fit beside it. */}
        {sidebarOpen && (
          <div
            className="flex-shrink-0 w-[min(380px,90vw)] bg-gray-900 border-r border-gray-700 z-30 shadow-2xl flex flex-col h-full"
            style={{ animation: 'rmSlideIn 0.2s ease-out forwards' }}
          >
            {/* Header */}
            <div className="flex-shrink-0 p-3 border-b border-gray-700 bg-gray-900/95">
              {/* Close button row */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">
                  {sidebarMode === 'staff' ? 'Staff' : 'Routes'}
                </span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="w-7 h-7 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"
                  title="Close sidebar"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>

              {/* Mode toggle */}
              <div className="flex bg-gray-800 rounded-lg p-0.5 mb-3">
                <button
                  onClick={() => setSidebarMode('staff')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    sidebarMode === 'staff'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Users size={12} className="inline mr-1" />
                  Staff
                </button>
                <button
                  onClick={() => setSidebarMode('routes')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    sidebarMode === 'routes'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <MapPin size={12} className="inline mr-1" />
                  Routes
                </button>
              </div>

              {/* Sort */}
              {sidebarMode === 'staff' && (
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="w-full bg-gray-800 text-white text-xs rounded-md px-2 py-1.5 border border-gray-700"
                >
                  <option value="recent">Most recent</option>
                  <option value="alpha">Alphabetical</option>
                  <option value="steps">Steps</option>
                  <option value="equiv">EQ</option>
                  <option value="upGross">Upsell $</option>
                </select>
              )}
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">

              {/* STAFF MODE: worker cards (aeration) or cart cards (team seasons) */}
              {sidebarMode === 'staff' && !isTeamSeason && sortedWorkerCards.map(card => {
                const canNav = workerCanNavigate(card);
                const { hasFlag, flags } = computeRedFlags(card.financialStore);
                return (
                  <div
                    key={card.worker.contractorId}
                    onClick={() => setSelectedWorkerForModal(card)}
                    className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-bold text-sm truncate">
                            {card.worker.firstName} {card.worker.lastName}
                          </span>
                          {hasFlag && (
                            <span title={`Red flags: ${flags.join(', ')}`} className="text-red-400">
                              <AlertTriangle size={12} />
                            </span>
                          )}
                        </div>
                        {card.lastActiveAddress && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            {card.lastActiveTime} • {card.lastActiveAddress}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-[10px] text-gray-300">
                          <span>{card.stats.steps} steps</span>
                          <span className="text-gray-600">•</span>
                          <span className={card.stats.pending > 0 ? 'text-amber-400' : ''}>{card.stats.pending} pend</span>
                          <span className="text-gray-600">•</span>
                          <span>{card.stats.eq.toFixed(1)} EQ</span>
                          <span className="text-gray-600">•</span>
                          <span>{card.stats.upsellCount} up</span>
                          <span className="text-gray-600">•</span>
                          <span>${card.stats.upsellGross.toFixed(0)}</span>
                        </div>
                      </div>

                      {/* Icon row */}
                      <div className="flex-shrink-0 flex items-center gap-1">
                        {canNav && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleNavigateToWorker(card); }}
                            className="w-7 h-7 rounded-md bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white flex items-center justify-center transition-colors"
                            title={`Navigate to ${card.worker.firstName}`}
                          >
                            <Navigation2 size={13} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewLogsheet(card.worker); }}
                          className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                          title="Open logsheet"
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {sidebarMode === 'staff' && isTeamSeason && sortedCartCards.map(cart => {
                const canNav = cartCanNavigate(cart);
                const { hasFlag, flags } = computeRedFlags(cart.sharedFinancialStore);
                const label = cart.members.length > 1
                  ? cart.members.map(m => m.firstName).join(' & ')
                  : `${cart.members[0]?.firstName || ''} ${cart.members[0]?.lastName || ''}`.trim() || cart.teamId;
                return (
                  <div
                    key={cart.sessionId}
                    onClick={() => setSelectedCartForModal(cart)}
                    className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {cart.isRcCart && <Truck size={11} className="text-orange-400 flex-shrink-0" title="Ramp Crew" />}
                          <span className="text-white font-bold text-sm truncate">{label}</span>
                          {hasFlag && (
                            <span title={`Red flags: ${flags.join(', ')}`} className="text-red-400">
                              <AlertTriangle size={12} />
                            </span>
                          )}
                        </div>
                        {cart.lastActiveAddress && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            {cart.lastActiveTime} • {cart.lastActiveAddress}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-[10px] text-gray-300">
                          <span>{cart.stats.steps} steps</span>
                          <span className="text-gray-600">•</span>
                          <span className={cart.stats.pending > 0 ? 'text-amber-400' : ''}>{cart.stats.pending} pend</span>
                          <span className="text-gray-600">•</span>
                          <span>{cart.stats.eq.toFixed(1)} EQ</span>
                          <span className="text-gray-600">•</span>
                          <span>{cart.stats.upsellCount} up</span>
                          <span className="text-gray-600">•</span>
                          <span>${cart.stats.upsellGross.toFixed(0)}</span>
                          {cart.stats.pendingSaleCount > 0 && (
                            <>
                              <span className="text-gray-600">•</span>
                              <span className="text-amber-400">{cart.stats.pendingSaleCount} sale</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0 flex items-center gap-1">
                        {canNav && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleNavigateToCart(cart); }}
                            className="w-7 h-7 rounded-md bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white flex items-center justify-center transition-colors"
                            title={`Navigate to ${label}`}
                          >
                            <Navigation2 size={13} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewLogsheet(cart.members[0], cart.members); }}
                          className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                          title="Open logsheet"
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* ROUTES MODE */}
              {sidebarMode === 'routes' && routeCardData.map(rc => (
                <div
                  key={rc.routeCode}
                  onClick={() => setSelectedRouteForBookings(rc.routeCode)}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-2.5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-8 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-[11px] flex-shrink-0 leading-none whitespace-nowrap"
                      style={{ background: rc.routeColor }}
                    >
                      {rc.routeCode}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-bold truncate">
                        {rc.assignedWorkerLabel || (
                          <span className="text-amber-400">⚠ Unassigned</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {rc.prebookCount} jobs • {rc.prepayCount} prepaid • {rc.totalEQ.toFixed(1)} EQ
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/*
          MAP AREA — flex-1 means it fills whatever width is left after the
          sidebar (full width when sidebar closed, full minus 380px when open).
          It's `relative` so everything inside (map container, sidebar toggle
          when sidebar closed, on-route card, nav maneuver card overlay) is
          positioned within the map area, not the whole viewport.
        */}
        <div className="flex-1 relative h-full min-w-0">

          {/* Map container */}
          <div ref={mapContainerRef} className="absolute inset-0 bg-gray-900" />

          {/* Routes loading overlay */}
          {routesLoading && (
            <div className="absolute top-3 left-3 z-30 bg-gray-900/90 text-white text-xs px-3 py-2 rounded-lg flex items-center gap-2 shadow-lg">
              <Loader size={14} className="animate-spin" />
              Loading routes…
            </div>
          )}

          {/* No-routes-on-map message */}
          {!routesLoading && mapLoaded && routeMapData.length === 0 && myRouteCodes.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-amber-900/90 text-amber-100 text-xs px-3 py-2 rounded-lg shadow-lg max-w-md text-center">
              <AlertCircle size={14} className="inline mr-1" />
              No approved route geometry found. Have a Senior RM approve routes.
            </div>
          )}

          {/*
            Compass enable button — iOS Safari 13+ only. iOS requires a user
            gesture to grant access to DeviceOrientationEvent, so we show this
            small pill until the user taps it. After tap (whether granted or
            denied), the button disappears for the rest of the session. If
            denied, the arrow falls back to GPS-derived heading (works while
            moving, doesn't rotate while stationary).
          */}
          {compassNeedsPermission && !navState && (
            <button
              onClick={handleEnableCompass}
              className="absolute top-3 left-1/2 -translate-x-1/2 z-[55] bg-blue-600/95 hover:bg-blue-500 text-white text-xs font-bold px-3 py-2 rounded-lg shadow-xl flex items-center gap-2 border border-blue-400 transition-colors"
              title="Enable compass for nav arrow rotation"
            >
              <Compass size={14} />
              Enable compass
            </button>
          )}

          {/* Sidebar toggle (top-left of MAP AREA) — only shown when sidebar
              is closed. When sidebar is open it has its own close button in
              its header, so this hides. */}
          {!sidebarOpen && !navState && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="absolute top-3 left-3 z-40 w-11 h-11 bg-gray-900/95 hover:bg-gray-800 text-white rounded-lg shadow-xl flex items-center justify-center transition-all border border-gray-700"
              title="Open sidebar"
            >
              <LayoutList size={20} />
            </button>
          )}

          {/* ON-ROUTE FLOATING CARD (bottom-center of MAP AREA) — UNCHANGED.
              Still opens the worker/cart detail modal on tap. */}
          {(onRouteWorkerCard || onRouteCartCard) && !navState && (
            <div
              onClick={() => {
                if (onRouteCartCard) setSelectedCartForModal(onRouteCartCard);
                else if (onRouteWorkerCard) setSelectedWorkerForModal(onRouteWorkerCard);
              }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-gray-900/95 backdrop-blur-sm border border-blue-500/60 rounded-xl shadow-2xl px-4 py-2.5 cursor-pointer hover:bg-gray-800 transition-colors flex items-center gap-3 max-w-[90%]"
            >
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <div className="min-w-0">
                <div className="text-[10px] text-blue-300 font-bold uppercase tracking-wide">On route</div>
                <div className="text-white text-sm font-bold truncate">
                  {onRouteCartCard
                    ? (onRouteCartCard.members.length > 1
                        ? onRouteCartCard.members.map(m => m.firstName).join(' & ')
                        : `${onRouteCartCard.members[0]?.firstName} ${onRouteCartCard.members[0]?.lastName.charAt(0)}.`)
                    : `${onRouteWorkerCard!.worker.firstName} ${onRouteWorkerCard!.worker.lastName.charAt(0)}.`}
                  {onRouteRedFlags.hasFlag && (
                    <AlertTriangle size={12} className="inline ml-1.5 text-red-400" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* NAV OVERLAY — renders the maneuver card + route line on top of the
              map. Because we're inside the map area's `relative` container, the
              maneuver card's `absolute top-0 left-0 right-0` naturally hugs
              just the map area — it won't overlap the sidebar. */}
          {navState && mapRef.current && (
            <RMNavigation
              map={mapRef.current}
              destination={navState.destination}
              onArrived={handleNavArrived}
              onCancel={handleNavCancel}
            />
          )}

        </div>

        {/* WORKER DETAIL MODAL (aeration) */}
        {selectedWorkerForModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelectedWorkerForModal(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header with inline action buttons */}
              <div className="flex-shrink-0 p-3 border-b border-gray-700 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-white font-bold text-base truncate">
                    {selectedWorkerForModal.worker.firstName} {selectedWorkerForModal.worker.lastName}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {selectedWorkerForModal.stats.steps} steps • {selectedWorkerForModal.stats.eq.toFixed(1)} EQ • ${selectedWorkerForModal.stats.upsellGross.toFixed(0)} upsell
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5">
                  {workerCanNavigate(selectedWorkerForModal) && (
                    <button
                      onClick={() => {
                        const card = selectedWorkerForModal;
                        setSelectedWorkerForModal(null);
                        handleNavigateToWorker(card);
                      }}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
                      title="Navigate to most recent transaction"
                    >
                      <Navigation2 size={12} />
                      Navigate
                    </button>
                  )}
                  <button
                    onClick={() => handleViewLogsheet(selectedWorkerForModal.worker)}
                    className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md flex items-center gap-1.5"
                    title="View logsheet"
                  >
                    <FileText size={12} />
                    Logsheet
                  </button>
                  <button
                    onClick={() => handleToggleUpsells(
                      selectedWorkerForModal.worker.contractorId,
                      selectedWorkerForModal.upsellsEnabled,
                    )}
                    className={`px-2.5 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${
                      selectedWorkerForModal.upsellsEnabled
                        ? 'bg-green-600/20 text-green-300 hover:bg-green-600 hover:text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title="Toggle upsells"
                  >
                    {selectedWorkerForModal.upsellsEnabled ? 'Upsells ✓' : 'Upsells ✗'}
                  </button>
                  <button
                    onClick={() => setSelectedWorkerForModal(null)}
                    className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                <ContractorJobs
                  bookings={selectedWorkerForModal.displayBookings}
                  financialStore={selectedWorkerForModal.financialStore}
                  workerName={`${selectedWorkerForModal.worker.firstName} ${selectedWorkerForModal.worker.lastName}`}
                  isReadOnly
                />
              </div>
            </div>
          </div>
        )}

        {/* CART DETAIL MODAL (team seasons) */}
        {selectedCartForModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelectedCartForModal(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex-shrink-0 p-3 border-b border-gray-700 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {selectedCartForModal.isRcCart && (
                      <Truck size={13} className="text-orange-400 flex-shrink-0" />
                    )}
                    <div className="text-white font-bold text-base truncate">
                      {selectedCartForModal.members.length > 1
                        ? selectedCartForModal.members.map(m => m.firstName).join(' & ')
                        : `${selectedCartForModal.members[0]?.firstName} ${selectedCartForModal.members[0]?.lastName}`}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {selectedCartForModal.stats.steps} steps • {selectedCartForModal.stats.eq.toFixed(1)} EQ • ${selectedCartForModal.stats.upsellGross.toFixed(0)} upsell
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5">
                  {cartCanNavigate(selectedCartForModal) && (
                    <button
                      onClick={() => {
                        const cart = selectedCartForModal;
                        setSelectedCartForModal(null);
                        handleNavigateToCart(cart);
                      }}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
                      title="Navigate to most recent transaction"
                    >
                      <Navigation2 size={12} />
                      Navigate
                    </button>
                  )}
                  <button
                    onClick={() => handleViewLogsheet(
                      selectedCartForModal.members[0],
                      selectedCartForModal.members,
                    )}
                    className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md flex items-center gap-1.5"
                    title="Open cart logsheet"
                  >
                    <FileText size={12} />
                    Logsheet
                  </button>
                  <button
                    onClick={() => setSelectedCartForModal(null)}
                    className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-3">
                {/* Cart members list */}
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">
                    Cart members
                  </div>
                  <div className="space-y-1.5">
                    {selectedCartForModal.members.map(m => (
                      <div key={m.contractorId} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                        <Users size={11} className="text-gray-400 flex-shrink-0" />
                        <span className="text-white text-xs font-medium flex-1 min-w-0 truncate">
                          {m.firstName} {m.lastName}
                        </span>
                        {isRcWorker(m.teamId) && (
                          <span className="text-[9px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-bold">RC</span>
                        )}
                        {m.cellPhone && (
                          <a
                            href={`tel:${m.cellPhone}`}
                            className="text-blue-400 hover:text-blue-300"
                            title="Call"
                          >
                            <Phone size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Asphalt sections (sealing only) */}
                {isSealing && selectedCartForModal.asphaltOwnedRows.length > 0 && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">
                      Asphalt sold by this cart
                    </div>
                    <div className="space-y-1">
                      {selectedCartForModal.asphaltOwnedRows.map(ps => (
                        <div key={ps.id} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                          <Shovel size={11} className="text-amber-400 flex-shrink-0" />
                          <span className="text-white text-xs flex-1 min-w-0 truncate">
                            {assembleAddressFromPending(ps)}
                          </span>
                          <span className="text-amber-300 text-[10px] font-bold">
                            {formatAsphaltDollars(ps.asphaltAmount)}
                          </span>
                          {ps.assignedRcSessionId && (
                            <button
                              onClick={() => handleUnassignAsphalt(ps.id, assembleAddressFromPending(ps))}
                              disabled={unassigningAsphaltId === ps.id}
                              className="text-[9px] bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white px-1.5 py-0.5 rounded font-bold transition-colors disabled:opacity-50"
                              title="Unassign asphalt"
                            >
                              {unassigningAsphaltId === ps.id ? '...' : 'Unassign'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {unassignError && (
                      <div className="text-[10px] text-red-400 mt-1">{unassignError}</div>
                    )}
                  </div>
                )}

                {isSealing && selectedCartForModal.asphaltIncomingRows.length > 0 && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">
                      Asphalt assigned to this RC
                    </div>
                    <div className="space-y-1">
                      {selectedCartForModal.asphaltIncomingRows.map(ps => (
                        <div key={ps.id} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                          <Shovel size={11} className="text-amber-400 flex-shrink-0" />
                          <span className="text-white text-xs flex-1 min-w-0 truncate">
                            {assembleAddressFromPending(ps)}
                          </span>
                          <span className="text-amber-300 text-[10px] font-bold">
                            {formatAsphaltDollars(ps.asphaltAmount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shared jobs */}
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">
                    Cart jobs ({selectedCartForModal.sharedBookings.length})
                  </div>
                  <ContractorJobs
                    bookings={selectedCartForModal.sharedBookings}
                    financialStore={selectedCartForModal.sharedFinancialStore}
                    workerName={
                      selectedCartForModal.members.length > 1
                        ? selectedCartForModal.members.map(m => m.firstName).join(' & ')
                        : `${selectedCartForModal.members[0]?.firstName || ''} ${selectedCartForModal.members[0]?.lastName || ''}`
                    }
                    isReadOnly
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROUTE PREBOOKINGS POPUP */}
        {selectedRouteForBookings && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelectedRouteForBookings(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-shrink-0 p-3 border-b border-gray-700 flex items-center justify-between">
                <div className="text-white font-bold text-sm">
                  Route {selectedRouteForBookings} • {selectedRouteBookings.length} jobs
                </div>
                <button
                  onClick={() => setSelectedRouteForBookings(null)}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                <ContractorJobs
                  bookings={selectedRouteBookings}
                  financialStore={selectedRouteFinancialStore}
                  workerName={`Route ${selectedRouteForBookings}`}
                  isReadOnly
                />
              </div>
            </div>
          </div>
        )}

        {/* PENDING JOB MODAL (clicking a pending-sale ring on the map) */}
        {pendingJobForModal && (
          <PendingJobModal
            booking={pendingJobForModal}
            onClose={() => setPendingJobForModal(null)}
            onRefresh={() => { setPendingJobForModal(null); onRefresh(); }}
          />
        )}

        {/* ROUTE ASSIGNMENT MODAL */}
        {assignModalData && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setAssignModalData(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="h-9 px-2.5 min-w-[48px] rounded-md flex items-center justify-center font-bold text-white text-xs flex-shrink-0 leading-none whitespace-nowrap"
                    style={{ background: assignModalData.routeColor }}
                  >
                    {assignModalData.routeCode}
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">Assign Route</div>
                    <div className="text-[10px] text-gray-400">
                      {assignModalData.prebookCount} jobs • {assignModalData.prepayCount} prepaid • {assignModalData.totalEQ.toFixed(1)} EQ
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setAssignModalData(null)}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                {/* Unassign */}
                {assignModalData.currentWorkerIds.length > 0 && (
                  <button
                    onClick={() => handleAssignRoute(null)}
                    disabled={assignLoading}
                    className="w-full text-left px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-md text-red-300 text-xs font-bold disabled:opacity-50"
                  >
                    {assignLoading ? <Loader size={12} className="inline animate-spin" /> : <X size={12} className="inline mr-1.5" />}
                    Unassign route
                  </button>
                )}

                {/* Workers / carts */}
                {isTeamSeason ? (
                  Array.from(contractorsByCart?.entries() || []).map(([sessionWorkerId, cartMembers]) => {
                    const cart = teamCarts.find(c => c.workerIds.includes(cartMembers[0].contractorId));
                    const sessionWorker = cartMembers[0];
                    const label = cartMembers.length > 1
                      ? cartMembers.map(m => m.firstName).join(' & ')
                      : `${sessionWorker.firstName} ${sessionWorker.lastName}`;
                    const isAssigned = cart?.workerIds.some(wid => assignModalData.currentWorkerIds.includes(wid));
                    return (
                      <button
                        key={sessionWorkerId}
                        onClick={() => handleAssignRoute(sessionWorker.contractorId)}
                        disabled={assignLoading}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between ${
                          isAssigned
                            ? 'bg-blue-900/40 border border-blue-700 text-blue-200'
                            : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                        } disabled:opacity-50`}
                      >
                        <span className="truncate">{label}</span>
                        {isAssigned && <Check size={12} className="text-blue-400" />}
                      </button>
                    );
                  })
                ) : (
                  myTeamWorkers.map(w => {
                    const isAssigned = assignModalData.currentWorkerIds.includes(w.contractorId);
                    return (
                      <button
                        key={w.contractorId}
                        onClick={() => handleAssignRoute(w.contractorId)}
                        disabled={assignLoading}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between ${
                          isAssigned
                            ? 'bg-blue-900/40 border border-blue-700 text-blue-200'
                            : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                        } disabled:opacity-50`}
                      >
                        <span className="truncate">{w.firstName} {w.lastName}</span>
                        {isAssigned && <Check size={12} className="text-blue-400" />}
                      </button>
                    );
                  })
                )}

                {/* Transfer to other manager */}
                <button
                  onClick={openTransferModal}
                  disabled={assignLoading}
                  className="w-full text-left px-3 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/50 rounded-md text-purple-300 text-xs font-bold mt-2 disabled:opacity-50"
                >
                  <ArrowRightLeft size={12} className="inline mr-1.5" />
                  Transfer to another manager…
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TRANSFER ROUTE MODAL */}
        {transferModalData && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setTransferModalData(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-bold text-sm">{transferModalData.title}</div>
                <button
                  onClick={() => setTransferModalData(null)}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-1.5">
                {availableManagers.map(mgr => (
                  <button
                    key={mgr.userId}
                    onClick={() => handleTransferConfirm(mgr.userId)}
                    className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700"
                  >
                    <ArrowRight size={12} className="inline mr-1.5 text-purple-400" />
                    {mgr.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MANAGE TEAM MODAL */}
        {showManageTeamModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={onCloseManageTeamModal}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-shrink-0 p-3 border-b border-gray-700 flex items-center justify-between">
                <div className="text-white font-bold text-sm">
                  <Shuffle size={14} className="inline mr-1.5 text-blue-400" />
                  Manage Team
                </div>
                <button
                  onClick={onCloseManageTeamModal}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                {reassignSuccess && (
                  <div className="mb-3 px-3 py-2 bg-green-900/30 border border-green-700 rounded-md text-green-300 text-xs">
                    <Check size={11} className="inline mr-1" />
                    {reassignSuccess}
                  </div>
                )}
                {reassignError && (
                  <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-300 text-xs">
                    <AlertCircle size={11} className="inline mr-1" />
                    {reassignError}
                  </div>
                )}

                {!selectedWorkerToMove ? (
                  // STEP 1: pick a worker
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1">
                      Pick a worker to move
                    </div>
                    {isTeamSeason ? (
                      cartCardData.map(cart =>
                        cart.members.map(m => (
                          <button
                            key={m.contractorId}
                            onClick={() => {
                              setSelectedWorkerToMove(m);
                              setSelectedWorkerSourceCart(cart);
                            }}
                            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 flex items-center gap-2"
                          >
                            <Users size={11} className="text-gray-400" />
                            <span className="flex-1 truncate">{m.firstName} {m.lastName}</span>
                            <span className="text-[9px] text-gray-500">
                              {cart.members.length > 1
                                ? cart.members.map(x => x.firstName).join(' & ')
                                : 'solo'}
                            </span>
                          </button>
                        ))
                      )
                    ) : (
                      myTeamWorkers.map(w => (
                        <button
                          key={w.contractorId}
                          onClick={() => {
                            setSelectedWorkerToMove(w);
                            setSelectedWorkerSourceCart(null);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium border flex items-center gap-2 ${
                            isAerationWorkerModifiable(w)
                              ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700'
                              : 'bg-gray-800/40 text-gray-500 border-gray-800 cursor-not-allowed'
                          }`}
                          disabled={!isAerationWorkerModifiable(w)}
                        >
                          <Users size={11} className="text-gray-400" />
                          <span className="flex-1 truncate">{w.firstName} {w.lastName}</span>
                          {!isAerationWorkerModifiable(w) && (
                            <span className="text-[9px] text-amber-400">has txs — locked</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  // STEP 2: pick destination
                  <div className="space-y-2.5">
                    <div className="px-3 py-2 bg-blue-900/20 border border-blue-700/40 rounded-md flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedWorkerToMove(null);
                          setSelectedWorkerSourceCart(null);
                        }}
                        className="text-blue-300 hover:text-white"
                      >
                        <Undo2 size={12} />
                      </button>
                      <div className="text-white text-xs font-bold flex-1 truncate">
                        Move {selectedWorkerToMove.firstName} {selectedWorkerToMove.lastName}
                      </div>
                    </div>

                    {isTeamSeason ? (
                      <>
                        {/* Move to existing cart */}
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">
                          Move to another cart
                        </div>
                        {cartCardData
                          .filter(c => c.sessionId !== selectedWorkerSourceCart?.sessionId)
                          .map(c => {
                            const label = c.members.length > 1
                              ? c.members.map(m => m.firstName).join(' & ')
                              : c.members[0]?.firstName;
                            return (
                              <button
                                key={c.sessionId}
                                onClick={() => handleReassignWorker({ type: 'existing_cart', targetSessionId: c.sessionId, label: label || '' })}
                                disabled={reassignLoading}
                                className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 disabled:opacity-50"
                              >
                                <UserPlus size={11} className="inline mr-1.5 text-green-400" />
                                {label}
                              </button>
                            );
                          })}

                        {/* New solo */}
                        {selectedWorkerSourceCart && selectedWorkerSourceCart.members.length > 1 && (
                          <button
                            onClick={() => handleReassignWorker({ type: 'new_solo' })}
                            disabled={reassignLoading}
                            className="w-full text-left px-3 py-2 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/50 rounded-md text-amber-300 text-xs font-bold disabled:opacity-50"
                          >
                            <UserMinus size={11} className="inline mr-1.5" />
                            Make solo cart
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">
                          Transfer to another manager
                        </div>
                        {availableManagers.map(mgr => (
                          <button
                            key={mgr.userId}
                            onClick={() => handleAerationTransfer(mgr.userId)}
                            disabled={reassignLoading}
                            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 disabled:opacity-50"
                          >
                            <ArrowRight size={11} className="inline mr-1.5 text-purple-400" />
                            {mgr.name}
                          </button>
                        ))}
                      </>
                    )}

                    {/* Move to another manager (team seasons) */}
                    {isTeamSeason && availableManagers.length > 0 && (
                      <>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mt-2">
                          Transfer to another manager
                        </div>
                        <div className="flex gap-1.5">
                          <select
                            value={reassignManagerId}
                            onChange={e => setReassignManagerId(e.target.value)}
                            className="flex-1 bg-gray-800 text-white text-xs rounded-md px-2 py-1.5 border border-gray-700"
                          >
                            <option value="">Pick a manager…</option>
                            {availableManagers.map(m => (
                              <option key={m.userId} value={m.userId}>{m.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => reassignManagerId && handleReassignWorker({ type: 'different_manager', targetManagerId: reassignManagerId })}
                            disabled={!reassignManagerId || reassignLoading}
                            className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded-md disabled:opacity-50"
                          >
                            Move
                          </button>
                        </div>
                      </>
                    )}

                    {/* Remove (no-show) */}
                    <button
                      onClick={handleRemoveWorkerNoShow}
                      disabled={reassignLoading}
                      className="w-full text-left px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-md text-red-300 text-xs font-bold mt-3 disabled:opacity-50"
                    >
                      <Trash2 size={11} className="inline mr-1.5" />
                      Remove worker (no-show)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SWITCH-NAV CONFIRMATION POPUP */}
        {switchNavConfirm && (
          <div
            className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
            onClick={() => setSwitchNavConfirm(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2">
                <Navigation2 size={16} className="text-blue-400" />
                <div className="text-white font-bold text-sm">Switch navigation?</div>
              </div>
              <div className="text-xs text-gray-300 mb-1">
                You're currently navigating to{' '}
                <span className="text-white font-bold">{switchNavConfirm.currentLabel}</span>.
              </div>
              <div className="text-xs text-gray-300 mb-3">
                Cancel current navigation and go to{' '}
                <span className="text-blue-300 font-bold">{switchNavConfirm.newLabel}</span>?
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSwitchNavConfirm(null)}
                  className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSwitchNavConfirm}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md"
                >
                  Switch navigation
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ROUTE-NAV PROMPT (Staff mode — tapped a route line on the map).
            Single-entry shows as a confirmation; multi-entry shows as a picker.
            Entries without a geocodable address render with a disabled button
            and a "no recent location" note. */}
        {routeNavPrompt && (
          <div
            className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
            onClick={() => setRouteNavPrompt(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="h-8 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-[11px] flex-shrink-0 leading-none whitespace-nowrap"
                  style={{ background: routeNavPrompt.routeColor }}
                >
                  {routeNavPrompt.routeCode}
                </div>
                <div className="text-white font-bold text-sm">
                  {routeNavPrompt.entries.length === 1
                    ? 'Navigate to…'
                    : 'Pick who to navigate to'}
                </div>
                <button
                  onClick={() => setRouteNavPrompt(null)}
                  className="ml-auto w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>

              {routeNavPrompt.entries.length === 1 ? (
                // Single-entry → confirmation
                <>
                  <div className="text-sm text-gray-200 mb-3">
                    Navigate to{' '}
                    <span className="text-blue-300 font-bold">{routeNavPrompt.entries[0].label}</span>?
                    {!routeNavPrompt.entries[0].hasGeocodableAddress && (
                      <span className="block text-[11px] text-amber-400 mt-1">
                        No recent transactions to navigate to.
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRouteNavPrompt(null)}
                      className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRouteNavPromptSelect(routeNavPrompt.entries[0])}
                      disabled={!routeNavPrompt.entries[0].hasGeocodableAddress}
                      className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Navigation2 size={12} />
                      Navigate
                    </button>
                  </div>
                </>
              ) : (
                // Multi-entry → picker
                <div className="space-y-1.5">
                  {routeNavPrompt.entries.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => handleRouteNavPromptSelect(entry)}
                      disabled={!entry.hasGeocodableAddress}
                      className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/40 disabled:cursor-not-allowed rounded-md border border-gray-700 text-xs flex items-center gap-2 transition-colors"
                    >
                      <Navigation2
                        size={12}
                        className={entry.hasGeocodableAddress ? 'text-blue-400' : 'text-gray-600'}
                      />
                      <span className={`flex-1 font-bold truncate ${entry.hasGeocodableAddress ? 'text-white' : 'text-gray-500'}`}>
                        {entry.label}
                      </span>
                      {!entry.hasGeocodableAddress && (
                        <span className="text-[10px] text-amber-400 flex-shrink-0">
                          no recent location
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  );
};

export default RMMapTab;
