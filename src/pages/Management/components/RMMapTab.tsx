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
  SessionTransaction, RouteSplit, ManagerLocation,
} from '../../../types';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';
import ContractorJobs from './ContractorJobs';
import PendingJobModal from '../../../components/PendingJobModal';
import RMNavigation, { NavDestination } from './RMNavigation';
import RouteSplitModal from '../../../components/RouteSplitModal';
import { getManagerColor } from '../../../lib/managerPalette';
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
  confirmed?: boolean;   // notes contain "conf"/"Confirmed" → green check on the dot
}
interface GeocodedPin extends PinData { lat: number; lng: number; routeColor: string; }
interface GeocodedHistorical extends HistoricalProperty { lat: number; lng: number; }

interface GeocodedPendingSale {
  id: string;
  lat: number;
  lng: number;
  booking: MasterBooking;
  routeCode: string;   // for split-bucket colouring of the marker
  sessionId: string;   // for pulse: which cart this sale belongs to
  createdAt: string;   // for pulse: recency vs the cart's latest completed tx
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
  navActivity: any[];   // tx + pending-sale stand-ins, newest wins for nav
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

// RouteCardData extended for recursive split awareness.
//
// For a route with NO splits, one card is generated with:
//   isSplit = false, letter = undefined, displayRouteCode = baseRouteCode = "BIN09"
//
// For a route that HAS splits, N cards are generated (one per bucket):
//   - { isSplit: true, letter: 'a', baseRouteCode: 'BIN09', displayRouteCode: 'BIN09a', routeColor: <original> }
//   - { isSplit: true, letter: 'b', baseRouteCode: 'BIN09', displayRouteCode: 'BIN09b', routeColor: <60° rotated> }
//   - { isSplit: true, letter: 'c', baseRouteCode: 'BIN09', displayRouteCode: 'BIN09c', routeColor: <120° rotated> }
//   - ...
//
// Each card's prebookCount, prepayCount, totalEQ, assignedWorkerIds are scoped
// to that bucket. The Split button is no longer on these cards — it lives
// inside the assignment modal that opens when a card is tapped.
interface RouteCardData {
  routeCode: string;          // baseRouteCode for split cards; full code for non-split
  displayRouteCode: string;   // what to show in UI ("BIN09" or "BIN09a"/"BIN09b"/...)
  routeColor: string;
  assignedWorkerIds: string[];
  assignedWorkerLabel: string;
  prebookCount: number;
  prepayCount: number;
  totalEQ: number;
  isAssigned: boolean;
  isSplit: boolean;
  letter?: string;            // the bucket letter for split cards; undefined for whole-route
  baseRouteCode: string;      // always the underlying DB route_code
}

// AssignModalData extended for recursive splits.
// letter=undefined → regular full-route assignment (unchanged behaviour).
// letter is set → assigning that bucket of a split route; handleAssignRoute
// calls updateRouteSplitAssignment(routeCode, letter, workerIds).
//
// canSplit is true iff the current bucket has zero assigned workers. When
// true, the Split button at the TOP of the modal is enabled.
interface AssignModalData {
  routeCode: string;          // base route code
  displayRouteCode: string;   // header display ("BIN09" or "BIN09a"/"BIN09b"/...)
  routeColor: string;         // colour for this specific bucket
  prebookCount: number;
  prepayCount: number;
  totalEQ: number;
  currentWorkerIds: string[];
  letter?: string;            // bucket letter, undefined for whole-route
  canSplit: boolean;          // controls Split button enabled state
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
// Normalises an address into a stable cache key so the SAME house always
// resolves to ONE cached coordinate — no matter which spelling asked for it.
// This is what makes a pending-sale ring land exactly on its completed pin:
// the booking's "275 Hodge Crt" and the transaction's "275 Hodge Court" now
// collapse to the identical key, hit one cache entry, and plot at one point.
//
// Moderate strength on purpose:
//   - lowercases, strips punctuation, collapses whitespace
//   - folds common street-type abbreviations (crt→court, st→street, …)
//   - PRESERVES any trailing city/province text, so "14 main st acton" and
//     "14 main st georgetown" stay DISTINCT — we never merge two real houses
//     in two different towns just because they share a street name.
const STREET_TYPE_ALIASES: Record<string, string> = {
  st: 'street', str: 'street',
  rd: 'road',
  ave: 'avenue', av: 'avenue',
  dr: 'drive',
  crt: 'court', ct: 'court',
  cres: 'crescent', cr: 'crescent',
  blvd: 'boulevard',
  pl: 'place',
  ln: 'lane',
  ter: 'terrace',
  pkwy: 'parkway',
  hwy: 'highway',
  sq: 'square',
  trl: 'trail',
  cir: 'circle',
};
const makeCacheKey = (a: string) =>
  String(a || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')          // punctuation that varies between spellings
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(tok => STREET_TYPE_ALIASES[tok] || tok)  // fold St→street, Crt→court, …
    .join(' ');
const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// A prebook is "confirmed" when its notes contain "conf"/"Confirmed". We scan
// every property whose KEY contains "note" (case-insensitive) so this works
// regardless of the exact notes column name on the office booking — this
// reliably covers 'Log Sheet Notes'. If confirmed prebooks aren't getting a
// check, their confirmation text lives in a field whose key lacks "note":
// add that key to the loop below.
const isConfirmedBooking = (b: any): boolean => {
  if (!b) return false;
  let text = '';
  for (const k of Object.keys(b)) {
    if (/note/i.test(k) && typeof b[k] === 'string') text += ' ' + b[k];
  }
  return /conf/i.test(text);
};

const RC_TEAM_PATTERN = /^RC\d*$/;
const isRcWorker = (teamId: string | null | undefined): boolean => {
  return !!teamId && RC_TEAM_PATTERN.test(teamId);
};

// --- colorForBucket: HSL hue rotation by 60° per bucket letter index. ---
//
// Same algorithm as RouteSplitModal.tsx — keep the two in sync. 'a' returns
// baseColor unchanged; each subsequent letter rotates hue +60° from 'a'.
// Supports up to 'f' (6 buckets total = full 360° wheel); 'g'..'z' would
// land on a duplicate hue but we cap splits at 26 buckets in the service
// and visually they'd be indistinguishable anyway.
//
// If you ever want to factor this into a shared util, both files need to
// import the same function so they stay in sync — silent colour drift
// between the modal preview and the master map render would be a nasty
// bug to chase.
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

// --- bucketForPoint: cascade algorithm shared with RouteSplitModal.
//
// Determines which bucket a (lng, lat) point belongs to given the buckets
// array. Identical algorithm to RouteSplitModal so master map render and
// modal preview agree pixel-for-pixel.
//
// Process buckets in chronological order (skipping index 0, which is 'a'
// and has no rectangles). For each non-'a' bucket B:
//   if currentBucket == B.sourceLetter AND point inside any B.rectangle →
//   currentBucket = B.letter
// Ray-casting point-in-polygon over a rectangle's 4 geographic corners.
// Mirrors RouteSplitModal's pointInPolygon so the master map renders the
// same buckets the modal previewed — including rectangles drawn while the
// map was rotated (which are NOT axis-aligned in lng/lat, so the old
// west/east/south/north test silently matched nothing).
function pointInCorners(lng: number, lat: number, corners: Array<{ lng: number; lat: number }>): boolean {
  if (!corners || corners.length < 3) return false;
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].lng, yi = corners[i].lat;
    const xj = corners[j].lng, yj = corners[j].lat;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function bucketForPoint(lng: number, lat: number, buckets: Array<{letter: string; sourceLetter: string | null; rectangles: Array<{corners: Array<{lng: number; lat: number}>}>}>): string {
  let current = 'a';
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.sourceLetter !== current) continue;
    if (!b.rectangles || b.rectangles.length === 0) continue;
    for (const r of b.rectangles) {
      if (pointInCorners(lng, lat, r.corners)) {
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
    // Carried through so the geocoded pending-sale record can be tied back to
    // its session and compared by recency against completed transactions.
    sessionId: ps.sessionId,
    createdAt: ps.createdAt,
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

async function geocodeAddress(
  addr: string,
  pLat?: number,
  pLng?: number,
  bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  const q = encodeURIComponent([addr,'Ontario','Canada'].join(', '));
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${token}&limit=1&country=ca&types=address`;
  if (pLat !== undefined && pLng !== undefined) url += `&proximity=${pLng},${pLat}`;
  // bbox HARD-constrains results to the route area. proximity only biases;
  // bbox actually rejects anything outside the box, so a garbled address can't
  // fling a pin into another city. Mapbox expects minLng,minLat,maxLng,maxLat.
  if (bbox) url += `&bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  try {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features?.length > 0) { const [lng, lat] = data.features[0].center; return { lat, lng }; }
    return null;
  } catch { return null; }
}

// Helper: distance in meters between two lat/lng points using the simple
// equirectangular approximation. Plenty accurate at city-block scale and
// orders of magnitude cheaper than haversine. Used by the GPS watcher to
// decide whether the user has moved far enough to derive a heading.
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const cosLat = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const dy = (lat2 - lat1) * mPerDegLat;
  const dx = (lng2 - lng1) * mPerDegLng;
  return Math.sqrt(dx * dx + dy * dy);
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
  outer.style.cssText = 'pointer-events:none;width:29px;height:29px;';

  const inner = document.createElement('div');
  // 0.15s transition smooths low-rate GPS-derived heading updates without
  // adding noticeable lag to high-rate compass events.
  inner.style.cssText = 'width:100%;height:100%;transition:transform 0.15s linear;transform-origin:50% 50%;';
  // Red arrow with black outline on a translucent black halo. Higher visual
  // weight than the original blue-on-white version — easier to spot on busy
  // map backgrounds.
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

// Manager-location dot (floater feature). A filled circle, palette-hued so it
// matches the manager's route casing, with a thin dark stroke for contrast on
// light map and the manager's initials centred in white. No heading/arrow — a
// plain labelled dot, per spec. Colour + label are passed in (label drives both
// the tooltip and the initials) so this helper stays dumb.
function createManagerMarkerEl(fillColor: string, label: string): HTMLDivElement {
  const initials = (label || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w.charAt(0))
    .join('')
    .toUpperCase();
  const el = document.createElement('div');
  el.style.cssText = [
    'width:20px',
    'height:20px',
    'border-radius:50%',
    `background:${fillColor}`,
    'border:1.5px solid rgba(0,0,0,0.55)',
    'box-shadow:0 1px 3px rgba(0,0,0,0.4)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:9px',
    'font-weight:700',
    'color:#ffffff',
    'font-family:system-ui,sans-serif',
    'text-shadow:0 1px 1px rgba(0,0,0,0.5)',
    'cursor:default',
    'user-select:none',
    'pointer-events:none',
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

// Pending-sale marker: a filled circle matching a pending-prebook pin (same
// radius 3.33 / stroke 1.67 / black outline, fill = the sale's bucket colour),
// wrapped in a black, thicker rotating dashed ring so it still reads as
// "in progress". fillColor is the route or split-bucket colour, computed by
// the caller via bucketForPoint so a pending sale picks up the same colour as
// every other pin in its split.
function createDashedRotatingRing(fillColor: string): HTMLDivElement {
  let spinStyle = document.getElementById('rm-spin-keyframes') as HTMLStyleElement | null;
  if (!spinStyle) {
    spinStyle = document.createElement('style');
    spinStyle.id = 'rm-spin-keyframes';
    document.head.appendChild(spinStyle);
  }
  spinStyle.textContent = `@keyframes rmDashedSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;
  // A real, fixed 16px box. Mapbox anchors this marker on the box's centre, and
  // BOTH children fill the box exactly (top/left/right/bottom = 0), so they
  // share one centre with no translate math to drift. The fill is a 10px circle
  // (matching a completed pin) centred by flexbox. The SVG is the full 16px box;
  // its circle (r=5, stroke 2.5) puts the dashes right on the fill's 5px rim —
  // they ARE the border, so the fill carries no stroke. The animation spins the
  // whole SVG around its own centre.
  // OUTER wrapper: this is the element Mapbox positions (it writes its own
  // transform:translate(...) here to anchor the marker at the sale's lng/lat).
  // We put NO transform of our own on it — that's the whole point. A 16px box
  // with anchor:'center' means Mapbox offsets it by half its size, landing the
  // box centre exactly on the coordinate.
  const el = document.createElement('div');
  el.style.cssText = 'width:16px;height:16px;pointer-events:auto;cursor:pointer;';

  // INNER spinner: fills the wrapper and owns the rotation. Because the spin
  // transform lives here — NOT on the element Mapbox translates, and NOT on a
  // child that shares the wrapper's positioning context — the two transforms
  // never compose against each other. This is the same outer/inner split the
  // GPS nav arrow uses to stop Mapbox's translate from clobbering a rotate;
  // without it, the spinning SVG's rendered centre sat a hair off the anchor
  // and that offset magnified in screen space as you zoomed out (the drift).
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;width:100%;height:100%;animation:rmDashedSpin 3s linear infinite;transform-origin:50% 50%;';
  inner.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" style="position:absolute;top:0;left:0;">
      <circle cx="8" cy="8" r="5" fill="none" stroke="#000000" stroke-width="2.5" stroke-dasharray="3,2.5" opacity="0.9"/>
    </svg>
  `;

  // FILL: a static 10px dot, centred in the wrapper, OUTSIDE the spinner so it
  // never moves. Sits on top of the ring; both share the wrapper's centre.
  const fill = document.createElement('div');
  fill.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  fill.innerHTML = `<div style="width:10px;height:10px;border-radius:50%;background:${fillColor};"></div>`;

  el.style.position = 'relative';
  el.appendChild(inner);
  el.appendChild(fill);
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

// --- SPLIT BUCKETING HELPERS ---
//
// In v2 recursive splits, the master map bucket-paints each line PIECE (not
// each segment as a whole). A piece is a pair of consecutive coords in a
// segment. The bucket for each piece is computed by bucketForPoint() using
// the buckets array's stored rectangles. This gives sharp half-segment edges.
//
// For bookings, we use the cached bookingIds on each bucket — those were
// precomputed at split time so we don't recompute closest-line-piece every
// render. To look up a pin's bucket: iterate the route's buckets, find the
// one whose bookingIds contains the booking ID. Default to 'a' (the original
// bucket) when the route isn't split or the booking isn't in any bucket.

// Line-piece midpoint = average of the two endpoints.
function lineMidCoord(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Compute the centroid of all pieces in a given bucket on a given route.
// Returns null if the bucket has no pieces (e.g. all of 'a' got carved away).
// Used for placing the route's letter label on the master map.
function bucketCentroid(
  segments: Array<{ coordinates: [number, number][] }>,
  buckets: Array<{ letter: string; sourceLetter: string | null; rectangles: Array<{corners: Array<{lng: number; lat: number}>}> }>,
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

  // --- ROUTE SPLITS state ---
  //
  // routeSplits is the canonical list from the DB. routeSplitsByCode is the
  // memoized map for fast lookup. splitModalData drives the split modal —
  // includes the source bucket being carved and the new letter to assign.
  //
  // Flow: assignment modal open → user taps Split → assignment modal closes
  // → splitModalData populated → RouteSplitModal renders → user confirms →
  // handleSplitConfirm persists and immediately reopens the assignment modal
  // for the NEW LETTER. There is no longer a postSplitFlow state because the
  // flow is naturally recursive: from inside the picker for the new letter,
  // the user can Split again, etc.
  const [routeSplits, setRouteSplits] = useState<RouteSplit[]>([]);
  const [splitModalData, setSplitModalData] = useState<{
    routeCode: string;
    baseRouteColor: string;        // original 'a' colour for HSL derivation
    segments: SavedRoute['segments'];
    prebookings: { bookingId: string; lat: number; lng: number }[];
    existingBuckets: RouteSplit['buckets'] | null;
    splittingFromLetter: string;
    newLetter: string;
    // We stash the full booking-id list so handleSplitConfirm can pass it
    // to splitBucket for the FIRST-split case (bootstraps bucket 'a').
    allBookingIdsOnRoute: string[];
  } | null>(null);

  const [workerLocations, setWorkerLocations] = useState<WorkerLocation[]>([]);
  const workerLocationMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // MANAGER LOCATIONS (floater feature). managerLocations holds every reporting
  // manager's last position for the CC; the marker effect filters to the covered
  // set (minus self) at render time. lastSelfPosRef caches our own last GPS fix so
  // the 8s timer can re-push it (keeping a parked manager fresh on others' maps).
  const [managerLocations, setManagerLocations] = useState<ManagerLocation[]>([]);
  const managerLocationMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const lastSelfPosRef = useRef<{ lat: number; lng: number } | null>(null);

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
  // Current geocoded pending sales, mirrored into a ref so the once-registered
  // layer click handler can resolve a clicked feature (carrying only psId) back
  // to its full booking for the PendingJobModal.
  const geocodedPendingSalesRef = useRef<GeocodedPendingSale[]>([]);

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
  const [navState, setNavState] = useState<NavState | null>(null);
  const [switchNavConfirm, setSwitchNavConfirm] = useState<SwitchNavConfirmation | null>(null);
  const [routeNavPrompt, setRouteNavPrompt] = useState<RouteNavPrompt | null>(null);

  // --- ARROW ROTATION ---
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

  // FLOATER SCOPE: the set of manager ids this user covers — their own id plus
  // everyone in currentUser.floatingFor. A non-floater's set is just [own id],
  // so all the membership checks below collapse to the original behaviour.
  const coveredManagerIds = useMemo(() => {
    const s = new Set<string>([managerId]);
    const ff = (currentUser as any)?.floatingFor;
    if (Array.isArray(ff)) ff.forEach((id: string) => { if (id) s.add(id); });
    return s;
  }, [managerId, currentUser]);

  // Stable-identity route-code list. routes gets a fresh array identity on every
  // realtime fire even when contents are unchanged; without stabilising here,
  // pendingBookingPinSource churns and Phase 1's geocode loop restarts each
  // refresh (the "geocodes one more every refresh" creep). We compute a content
  // signature and only return a NEW array when the actual set of codes changes —
  // same technique as RMLogbook's reconcilePendingBookings (Fix 1), one level down.
  const myRouteCodesSignature = useMemo(
    () => routes.filter(r => coveredManagerIds.has(r.managerId)).map(r => r.routeCode).sort().join('|'),
    [routes, coveredManagerIds]
  );
  const myRouteCodes = useMemo(
    () => (myRouteCodesSignature ? myRouteCodesSignature.split('|') : []),
    [myRouteCodesSignature]
  );

  // FLOATER PALETTE: CC-wide manager id list, userId-sorted, so each manager's
  // hue is identical on every floater's map (matches managerPalette's contract).
  // We sort ALL managers in the CC — not just the covered set — so colours don't
  // reshuffle as the covered set changes between floaters.
  const sortedManagerIds = useMemo(
    () => allManagers.map(m => m.userId).sort(),
    [allManagers]
  );

  // Whether floater colouring is active at all. A non-floater (covers only their
  // own id) keeps the original route-map colours untouched — we only switch to
  // per-manager hues when the user is actually floating for others.
  const floaterColouringActive = useMemo(
    () => coveredManagerIds.size > 1,
    [coveredManagerIds]
  );

  // Resolve the OWNING manager of a route, or of one bucket within it.
  // Bucket ownership (bucket.managerId) wins when present; otherwise fall back to
  // the route's manager_id. This is the single question every render site asks.
  const ownerOf = useCallback(
    (routeManagerId: string, bucketManagerId?: string): string =>
      (bucketManagerId && bucketManagerId.trim()) ? bucketManagerId : routeManagerId,
    []
  );

  // The hue for an owning manager: the floater's OWN routes stay on the route-map
  // colour (red is reserved for self per the palette comment, and self-routes
  // already read naturally); covered OTHER managers get their palette hue. When
  // floater colouring is inactive, callers should not use this (they keep route_color).
  const colorForOwner = useCallback(
    (ownerManagerId: string, fallbackRouteColor: string): string => {
      if (ownerManagerId === managerId) return fallbackRouteColor;
      return getManagerColor(ownerManagerId, sortedManagerIds);
    },
    [managerId, sortedManagerIds]
  );
  const myTeamIds = useMemo(() => new Set(workers.filter(w => coveredManagerIds.has(w.assignedManagerId as string)).map(w => w.contractorId)), [workers, coveredManagerIds]);
  const myTeamWorkers = useMemo(() => workers.filter(w => coveredManagerIds.has(w.assignedManagerId as string)), [workers, coveredManagerIds]);
  const routeColorMap = useMemo(() => { const m = new Map<string,string>(); routeMapData.forEach(r => m.set(r.route_code, r.route_color)); return m; }, [routeMapData]);
  const availableManagers = useMemo(() => allManagers.filter(m => m.userId !== managerId && m.role === 'RouteManager'), [allManagers, managerId]);

  // Fast lookup: route code → its split row (if any). One source of truth used
  // by routeCardData, the master map renderer, click handlers, and the
  // assignment modal.
  const routeSplitsByCode = useMemo(() => {
    const m = new Map<string, RouteSplit>();
    for (const rs of routeSplits) m.set(rs.routeCode, rs);
    return m;
  }, [routeSplits]);

  // Fetch route splits on mount and whenever a refresh is triggered. Cheap
  // table (one row per split, only digital-mapping CCs have it), so no
  // pagination needed.
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
    return workers.filter(w => coveredManagerIds.has(w.assignedManagerId as string)).map(worker => {
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
  }, [workers, coveredManagerIds, allSessions, bookings, isTeamSeason]);

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

        // TORCH: a pending sale newer than the latest completed tx takes over
        // as the cart's "most recent" — the in-progress job is where the cart
        // actually is right now. Uses createdAt (the sale's own timestamp).
        if (pendingSales.length > 0) {
          const sortedPS = [...pendingSales].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          const newestPS = sortedPS[0];
          if (newestPS?.createdAt && (!lastTimestamp || newestPS.createdAt > lastTimestamp)) {
            lastAddr = assembleAddressFromPending(newestPS);
            lastTimestamp = newestPS.createdAt;
            lastTime = formatTimeShort(newestPS.createdAt);
          }
        }

        // NAV TORCH: real transactions plus a stand-in per pending sale
        // (timestamp = createdAt, address = house+street). resolveNavDestination
        // walks this newest-first, so the Navigate button aims at the most
        // recent activity — pending sale or completed job, whichever is later.
        const navActivity: any[] = [
          ...sharedFinancialStore,
          ...pendingSales.map(ps => ({
            timestamp: ps.createdAt || '',
            address: `${ps.houseNumber || ''} ${ps.streetName || ''}`.trim(),
          })),
        ];

        return {
          sessionId: session.id,
          teamId: sessionWorkerIds[0] || session.workerId,
          members: teamWorkers,
          sharedBookings,
          sharedFinancialStore,
          navActivity,
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

  // routeCardData — V2 RECURSIVE SPLIT-AWARE.
  //
  // For each route managed by this RM:
  //   - If NO split row exists: emit a single RouteCardData with isSplit=false,
  //     letter=undefined, baseRouteCode=routeCode. (Same as before.)
  //   - If a split row exists: emit N RouteCardData entries, one per bucket
  //     in the buckets array. Each card's colour is colorForBucket(baseColor,
  //     bucket.letter). Job counts, prepay counts, EQ, and assigned workers
  //     are scoped to that bucket via the cached bookingIds and assignedWorkers.
  //
  // The Split button has been moved into the assignment modal (header), so
  // it no longer appears on these cards. Whether a bucket is splittable
  // (zero assigned workers) is computed at modal-open time.
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
      if (!coveredManagerIds.has(r.managerId)) continue;
      const rmi = routeMapData.find(rm => rm.route_code === r.routeCode);
      const baseColor = rmi?.route_color || '#6b7280';
      const split = routeSplitsByCode.get(r.routeCode);
      const rb = bookings.filter(b => b['Route Number'] === r.routeCode);

      if (!split || split.buckets.length === 0) {
        // No split — single card.
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

      // Split exists — emit N cards (one per bucket).
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

    // Sort: unassigned cards first, then by displayRouteCode alphabetically.
    return result.sort((a, b) => {
      if (a.isAssigned !== b.isAssigned) return a.isAssigned ? 1 : -1;
      return a.displayRouteCode.localeCompare(b.displayRouteCode);
    });
  }, [routes, coveredManagerIds, routeMapData, workers, bookings, calculateBookingEQ, routeSplitsByCode]);

  // Stable signature of every completed jobId across all sessions (Upgrade /
  // Add-On excluded — same filter as before). allSessions gets a fresh array
  // identity on every realtime / 30s refresh even when its contents are
  // unchanged; depending on it directly is what made pendingBookingPinSource
  // churn and re-fire Phase 1's geocode loop on every refresh (the "geocodes
  // one more each refresh" creep). This collapses allSessions down to a sorted,
  // joined string of done jobIds — a primitive that only changes VALUE when the
  // actual SET of completed jobs changes, so any memo depending on it stays
  // stable across content-identical refreshes. Mirror of RMLogbook's
  // pendingBookingsSignature, one level down.
  const completedJobIdsKey = useMemo(() => {
    const done = new Set<string>();
    allSessions.forEach(s => {
      (s.financialStore || []).forEach((tx: any) => {
        if (tx.type === 'Upgrade' || tx.type === 'Add-On') return;
        if (tx.jobId) done.add(tx.jobId);
      });
    });
    return Array.from(done).sort().join('|');
  }, [allSessions]);

  // Split pins into pending-only and completed/new-sale-only — driven by the
  // new filter system. Each set is also visibility-gated separately downstream.
  //
  // Depends on completedJobIdsKey (a stable string), NOT allSessions directly,
  // so this only produces a new array when the set of completed jobs, the
  // bookings, or the route codes actually change — never on a content-identical
  // refresh. That's what lets Phase 1 run to completion uninterrupted.
  const pendingBookingPinSource = useMemo<PinData[]>(() => {
    const result: PinData[] = [];
    const myRS = new Set(myRouteCodes);
    const done = new Set<string>(completedJobIdsKey ? completedJobIdsKey.split('|') : []);
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
        confirmed: isConfirmedBooking(b),
      });
    });
    return result;
  }, [bookings, completedJobIdsKey, myRouteCodes]);

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

  const mostRecentCompletionPins = useMemo<Array<{ lat: number; lng: number; routeColor: string }>>(() => {
    // Newest completed/sale tx per owner (session id for team seasons, worker
    // id for aeration).
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

    // Newest pending sale per session id (team seasons only — the only place
    // pending-sale dots exist). createdAt + sessionId now ride along on the
    // geocoded record so we can compare recency directly.
    const latestPSByKey = new Map<string, GeocodedPendingSale>();
    if (isTeamSeason) {
      geocodedPendingSales.forEach(ps => {
        if (!ps.sessionId || !ps.createdAt) return;
        const ex = latestPSByKey.get(ps.sessionId);
        if (!ex || ps.createdAt > ex.createdAt) latestPSByKey.set(ps.sessionId, ps);
      });
    }

    // For each owner, pulse whichever is newer: their latest completed tx, or
    // their latest pending sale (the torch). A pending sale with no competing
    // tx still earns the pulse.
    const result: Array<{ lat: number; lng: number; routeColor: string }> = [];
    const ownerKeys = new Set<string>([...latestByOwner.keys(), ...latestPSByKey.keys()]);
    ownerKeys.forEach(ownerKey => {
      const tx = latestByOwner.get(ownerKey);
      const ps = latestPSByKey.get(ownerKey);
      const psWins = ps && (!tx || ps.createdAt > tx.timestamp);
      if (psWins && ps) {
        result.push({ lat: ps.lat, lng: ps.lng, routeColor: routeColorMap.get(ps.routeCode) || '#22c55e' });
        return;
      }
      if (tx) {
        const pin =
          geocodedPins.find(p => p.id === tx.jobId && (p.status === 'completed' || p.status === 'new_sale'))
          ?? geocodedUpsellPins.find(p => p.id === tx.jobId);
        if (pin) result.push({ lat: pin.lat, lng: pin.lng, routeColor: pin.routeColor });
      }
    });
    return result;
  }, [allSessions, geocodedPins, geocodedUpsellPins, geocodedPendingSales, isTeamSeason, routeColorMap]);

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

  // Worker location fetch
  const fetchWorkerLocations = useCallback(async () => {
    const teamIds = workers
      .filter(w => coveredManagerIds.has(w.assignedManagerId as string))
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
  }, [workers, coveredManagerIds]);

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

  // MANAGER LOCATION poll (floater only). Fetches every reporting manager's
  // position every 8s; the marker effect filters to the covered set. Only runs
  // when floater colouring is active — a non-floater never polls, so their map is
  // unchanged. CC-wide fetch is fine; the filter happens at render.
  useEffect(() => {
    if (!mapLoaded || !floaterColouringActive) return;
    let cancelled = false;
    const fetchManagerLocations = async () => {
      try {
        const rows = await sessionService.getManagerLocations();
        if (!cancelled && mountedRef.current) setManagerLocations(rows);
      } catch (e) {
        console.warn('[ManagerLoc] fetch failed:', e);
      }
    };
    fetchManagerLocations();
    const interval = setInterval(fetchManagerLocations, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapLoaded, floaterColouringActive]);

  // MANAGER LOCATION markers (floater only). Renders a palette-hued dot per
  // covered manager (own id excluded — we're the red GPS arrow already). Hue via
  // getManagerColor so the dot matches that manager's route casing. Reconciled
  // like the worker-location markers: move existing, add new, remove gone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // When floater colouring is inactive, ensure no stray manager dots linger.
    if (!floaterColouringActive) {
      managerLocationMarkersRef.current.forEach(m => m.remove());
      managerLocationMarkersRef.current.clear();
      return;
    }

    const existingIds = new Set(managerLocationMarkersRef.current.keys());

    managerLocations.forEach(loc => {
      // Only covered managers, and never our own dot (we're the red arrow).
      if (loc.managerId === managerId) return;
      if (!coveredManagerIds.has(loc.managerId)) return;

      const mgr = allManagers.find(m => m.userId === loc.managerId);
      const label = mgr?.name || loc.managerId;
      const fill = colorForOwner(loc.managerId, '#9ca3af');

      const existing = managerLocationMarkersRef.current.get(loc.managerId);
      if (existing) {
        existing.setLngLat([loc.lng, loc.lat]);
        const el = existing.getElement();
        el.style.background = fill;
        el.title = label;
        existingIds.delete(loc.managerId);
      } else {
        const el = createManagerMarkerEl(fill, label);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
        managerLocationMarkersRef.current.set(loc.managerId, marker);
      }
    });

    existingIds.forEach(id => {
      managerLocationMarkersRef.current.get(id)?.remove();
      managerLocationMarkersRef.current.delete(id);
    });
  }, [managerLocations, mapLoaded, floaterColouringActive, coveredManagerIds, managerId, allManagers, colorForOwner]);

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

  // Draw routes — V2 RECURSIVE-SPLIT-AWARE with per-line-piece bucketing.
  //
  // For each route, we no longer render one feature per SEGMENT. Instead, each
  // pair of consecutive coords within a segment becomes its own LineString
  // feature. The bucket for each piece is determined at render time by
  // bucketForPoint() against the buckets array — sharp half-segment edges.
  //
  // The line layer uses a 'match' colour expression keyed off the piece's
  // bucket property: each letter maps to colorForBucket(baseColor, letter).
  // Default colour = baseColor (so anything unaccounted for shows as 'a').
  //
  // Centroid labels: N labels per split route (one per bucket with non-zero
  // piece count), positioned at the centroid of the bucket's pieces and
  // coloured with that bucket's colour. Non-split routes get one label as
  // before. Labels use route_number-derived text suffixed with the letter
  // (e.g. "11" → "11a"/"11b"/"11c"/...).
  useEffect(() => {
    const map=mapRef.current; if(!map||!mapLoaded||!routeMapData.length) return;
    loadedIdsRef.current.forEach(id=>{
      if(id.startsWith('num-')){const rid=id.replace('num-','');if(map.getLayer(`rm-num-${rid}`))map.removeLayer(`rm-num-${rid}`);if(map.getSource(`rm-num-src-${rid}`))map.removeSource(`rm-num-src-${rid}`);}
      else if(id.startsWith('casing-')){const rid=id.replace('casing-','');if(map.getLayer(`rm-line-casing-${rid}`))map.removeLayer(`rm-line-casing-${rid}`);if(map.getSource(`rm-line-casing-src-${rid}`))map.removeSource(`rm-line-casing-src-${rid}`);}
      else{if(map.getLayer(`rm-line-${id}`))map.removeLayer(`rm-line-${id}`);if(map.getSource(`rm-src-${id}`))map.removeSource(`rm-src-${id}`);}
    });
    loadedIdsRef.current=[];
    const before=(map.getLayer('road-label')?'road-label':map.getStyle().layers?.find((l:any)=>l.type==='symbol')?.id)??undefined;
    const allCoords:[number,number][]=[];

    // Letters we'll honour in the match expression. Up to 'f' is the
    // documented palette (60° rotations covering the full 360° wheel).
    const PALETTE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

    routeMapData.forEach(route=>{
      if(!route.segments?.length) return;
      const srcId=`rm-src-${route.id}`, lineId=`rm-line-${route.id}`;
      loadedIdsRef.current.push(route.id);

      const split = routeSplitsByCode.get(route.route_code);
      const buckets = split ? split.buckets : [];

      // Resolve the route-level owner once (used for unsplit routes and as the
      // fallback for buckets with no managerId stamp).
      const routeRow = routes.find(r => r.routeCode === route.route_code);
      const routeOwner = routeRow?.managerId || managerId;

      // Build per-line-piece features. Colour is purely the route's own colour
      // (and its split-bucket hues) — floater mode shows routes exactly as a
      // regular manager sees them, with no manager-owner casing.
      const features: GeoJSON.Feature[] = [];
      route.segments.forEach(seg => {
        const cs = seg.coordinates;
        if (!cs || cs.length < 2) return;
        for (let i = 0; i < cs.length - 1; i++) {
          const a = cs[i];
          const b = cs[i + 1];
          const mid = lineMidCoord(a, b);
          const bucketLetter = buckets.length > 0 ? bucketForPoint(mid[0], mid[1], buckets) : 'a';
          features.push({
            type: 'Feature',
            properties: {
              route_code: route.route_code,
              color: route.route_color,
              bucket: bucketLetter,
              osmId: seg.osmId,
            },
            geometry: { type: 'LineString', coordinates: [a, b] },
          });
          allCoords.push(a, b);
        }
      });

      // Build colour match expression from the palette letters (route FILL —
      // unchanged from the original; manager hue lives on the casing below, NOT
      // the fill, so routes stay distinguishable by their own colour).
      const lineColorExpr: any = ['match', ['get', 'bucket']];
      for (const L of PALETTE_LETTERS) {
        lineColorExpr.push(L);
        lineColorExpr.push(colorForBucket(route.route_color, L));
      }
      lineColorExpr.push(route.route_color); // default

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

      // Centroid labels.
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
  }, [routeMapData, mapLoaded, routeSplitsByCode, routes, managerId]);

  // Worker name overlay — V2 RECURSIVE-SPLIT-AWARE.
  // Unsplit routes get one label at the route centroid showing assigned workers.
  // Split routes get N labels, each at the bucket's centroid (per the cascade
  // algorithm), coloured with that bucket's colour, showing only that bucket's
  // assignedWorkers.
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
      // Split — emit one label per bucket (with non-empty pieces).
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

  // Route opacity — V2 SPLIT-AWARE.
  // For unsplit routes, behaviour is unchanged. For split routes, "any bucket
  // assigned" is the OR across all buckets' assignedWorkers. Since all buckets
  // share one line layer, we can't paint different opacities per bucket — the
  // RM uses the sidebar's N cards (one per bucket) to see exactly which
  // bucket is assigned.
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

  // Route click handlers — V2 RECURSIVE-SPLIT-AWARE.
  //
  // The line layer's features carry a `bucket` property (set at draw time by
  // bucketForPoint). When the user taps a line piece, e.features[0].properties
  // .bucket gives us the bucket letter directly — no recomputation needed.
  //
  // In Routes mode (sidebar shows route cards):
  //   - Non-split route → opens the assignment modal for the whole route.
  //   - Split route → identifies which bucket was clicked and opens the modal
  //     scoped to that bucket (e.g. "BIN09c"). canSplit is true iff that
  //     bucket has zero assigned workers.
  //
  // In Staff mode (sidebar shows staff cards):
  //   - Non-split route → "Navigate to who?" prompt as before.
  //   - Split route → only that bucket's assignedWorkers populate the prompt.
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

        // Determine clicked bucket from the feature's `bucket` property.
        let clickedLetter: string | undefined = undefined;
        if (split && split.buckets.length > 0 && e.features && e.features.length > 0) {
          const fb = e.features[0].properties?.bucket;
          if (typeof fb === 'string') clickedLetter = fb;
        }

        if (mode === 'routes') {
          if (split && clickedLetter) {
            // Bucket-scoped assignment modal.
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

          // Non-split — whole-route assignment.
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

        // STAFF MODE — nav prompt. Only clicked bucket's workers in the prompt.
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
              hasGeocodableAddress: resolveNavDestination(cart.navActivity) !== null,
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

  // Pending bookings circles — SPLIT-AWARE COLOURING.
  //
  // For a pending booking on a split route, the pin's stroke colour follows
  // its bucket: 'a' → original route colour, 'b' → complementary colour. For
  // unsplit routes the colour is the route colour as before.
  //
  // The data-driven colour is encoded as `pinColor` in the feature's
  // properties so the layer paint expression can read it directly (no need
  // for a separate layer per bucket). When a split is added/removed mid-day,
  // re-running this updater with the same geocoded pins refreshes the colours
  // immediately.
  const updatePendingBookingPins = useCallback((map: mapboxgl.Map, geocoded: GeocodedPin[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geocoded.map(pin => {
        // Find which bucket this booking belongs to (if route is split).
        // The bucket's bookingIds is the cached membership list. Default to
        // the route's base colour for unsplit routes or unfound bookings.
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
            confirmed: !!pin.confirmed,
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
    // Green check on confirmed prebooks only (filter on the confirmed property).
    // Shares the pending-pins source, so it tracks the dots exactly and updates
    // whenever the source data refreshes. icon-offset nudges it up-right so the
    // long stroke clears the dot edge — bump these two numbers to taste.
    map.addLayer({
      id: 'rm-pending-confirmed-check',
      type: 'symbol',
      source: 'rm-pending-pins-src',
      filter: ['==', ['get', 'confirmed'], true],
      layout: {
        'icon-image': 'rm-confirmed-check',
        'icon-size': 1.0,
        'icon-offset': [2, -2],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.95 },
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

  // Pending-sale pins as GPU LAYERS (not HTML markers) — same mechanism as the
  // completed pins, so they re-project on zoom/pan exactly like every reliable
  // pin and cannot drift. Bucket-coloured fill circle + static black dashed-ring
  // icon on top. Click opens the PendingJobModal via the geocodedPendingSalesRef
  // lookup (the feature only carries psId).
  const updatePendingSalePins = useCallback((map: mapboxgl.Map, sales: GeocodedPendingSale[]) => {
    const gj: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sales.map(ps => {
        const baseColor = routeColorMap.get(ps.routeCode) || '#888888';
        const split = routeSplitsByCode.get(ps.routeCode);
        let pinColor = baseColor;
        if (split && split.buckets.length > 0) {
          const letter = bucketForPoint(ps.lng, ps.lat, split.buckets);
          pinColor = colorForBucket(baseColor, letter);
        }
        return {
          type: 'Feature' as const,
          properties: { psId: ps.id, pinColor },
          geometry: { type: 'Point' as const, coordinates: [ps.lng, ps.lat] },
        };
      }),
    };
    const src = map.getSource('rm-pending-sale-src') as mapboxgl.GeoJSONSource;
    if (src) { src.setData(gj); return; }
    map.addSource('rm-pending-sale-src', { type: 'geojson', data: gj });
    // Fill circle — matches the completed-pin fill radius for visual consistency.
    map.addLayer({
      id: 'rm-pending-sale-circles',
      type: 'circle',
      source: 'rm-pending-sale-src',
      paint: {
        'circle-color': ['get', 'pinColor'],
        'circle-radius': 3.33,
        'circle-opacity': 0.95,
      },
    });
    // Dashed ring icon on top.
    map.addLayer({
      id: 'rm-pending-sale-ring',
      type: 'symbol',
      source: 'rm-pending-sale-src',
      layout: {
        'icon-image': 'rm-pending-dash-ring',
        'icon-size': 1.0,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.95 },
    });
    const openPs = (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const id = f.properties?.psId;
      const ps = geocodedPendingSalesRef.current.find(g => g.id === id);
      if (ps) setPendingJobForModal(ps.booking);
    };
    map.on('mouseenter', 'rm-pending-sale-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rm-pending-sale-circles', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'rm-pending-sale-circles', openPs);
    map.on('click', 'rm-pending-sale-ring', openPs);
  }, [routeSplitsByCode, routeColorMap]);

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

  // Re-render pending booking pins whenever the splits change, so when a split
  // is freshly created the colours update without waiting for a geocode pass.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (geocodedPins.length === 0) return;
    const pendingOnly = geocodedPins.filter(p => p.status === 'pending');
    if (pendingOnly.length > 0) {
      updatePendingBookingPins(map, pendingOnly);
    }
  }, [routeSplitsByCode, mapLoaded, geocodedPins, updatePendingBookingPins]);

  // FILTER-DRIVEN VISIBILITY
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (map.getLayer('rm-pending-pins-circles')) {
      map.setPaintProperty('rm-pending-pins-circles', 'circle-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
      map.setPaintProperty('rm-pending-pins-circles', 'circle-stroke-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
    }
    if (map.getLayer('rm-pending-confirmed-check')) {
      map.setPaintProperty('rm-pending-confirmed-check', 'icon-opacity', filterVisibility.pendingBookings ? 0.95 : 0);
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
    if (map.getLayer('rm-pending-sale-circles')) {
      map.setPaintProperty('rm-pending-sale-circles', 'circle-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-pending-sale-ring')) {
      map.setPaintProperty('rm-pending-sale-ring', 'icon-opacity', filterVisibility.pendingSalesAndCompleted ? 0.95 : 0);
    }
    if (map.getLayer('rm-historical-symbols')) {
      map.setPaintProperty('rm-historical-symbols', 'icon-opacity', filterVisibility.historical ? 0.85 : 0);
    }
    if (map.getLayer('rm-pcl-circles')) {
      map.setPaintProperty('rm-pcl-circles', 'circle-opacity', filterVisibility.pcl ? 0.7 : 0);
      map.setPaintProperty('rm-pcl-circles', 'circle-stroke-opacity', filterVisibility.pcl ? 0.7 : 0);
    }
  }, [filterVisibility, mapLoaded]);

  // --- SERIAL GEOCODING STATE MACHINE ---

  const geocodeOne = useCallback(async (address: string): Promise<{ lat: number; lng: number } | null> => {
    const addrKey = makeCacheKey(address);
    const cached = geocodeCache.get(addrKey);
    if (cached) return cached;
    // Constrain the geocoder to a box around the route centroid. ~0.18° is
    // roughly a 20km half-span at this latitude — wide enough to cover a CC's
    // routes, tight enough to keep a bad address from resolving in another
    // town. Falls back to proximity-only (no box) until the centroid exists.
    const bbox = routeCentroid
      ? {
          minLng: routeCentroid.lng - 0.18,
          minLat: routeCentroid.lat - 0.18,
          maxLng: routeCentroid.lng + 0.18,
          maxLat: routeCentroid.lat + 0.18,
        }
      : undefined;
    const coord = await geocodeAddress(address, routeCentroid?.lat, routeCentroid?.lng, bbox);
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
    // NOTE: geocodePhase is deliberately NOT in this dependency array, and must
    // stay out. The loop's FIRST progress report calls onGeocodeProgress with
    // phase 'phase1_pending_bookings', which flips geocodePhase away from 'idle'.
    // If geocodePhase were a dependency, that flip would re-run this effect and
    // its cleanup would cancel the loop after ~1 geocode — the one-at-a-time
    // creep. The guard above reads geocodePhase from the render where the effect
    // first became eligible (it's 'idle' then), which is all it needs; the phase
    // only ever moves forward, never back to 'idle', so this never needs to
    // re-fire on a phase change. (Phases 2-4 don't have this problem: their
    // in-loop progress phase EQUALS their guard phase, so they never self-flip.)
  }, [mapLoaded, geocodeCacheHydrated, pendingBookingPinSource, routeColorMap, geocodeOne, updatePendingBookingPins, onGeocodeProgress]);

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
            pendingSalesCached.push({ id: booking['Booking ID'], lat: cached.lat, lng: cached.lng, booking, routeCode: booking['Route Number'] || '', sessionId: (booking as any).sessionId || '', createdAt: (booking as any).createdAt || '' });
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
        if (coord) newPSResults.push({ id, lat: coord.lat, lng: coord.lng, booking, routeCode: booking['Route Number'] || '', sessionId: (booking as any).sessionId || '', createdAt: (booking as any).createdAt || '' });
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
        if (coord) additions.push({ id: booking['Booking ID'], lat: coord.lat, lng: coord.lng, booking, routeCode: booking['Route Number'] || '', sessionId: (booking as any).sessionId || '', createdAt: (booking as any).createdAt || '' });
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

  // Upsell geocoding
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

  // Drive upsell-only and overlap-half layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const upsellOnly = geocodedUpsellPins.filter(p => !overlapInfo.has(makeCacheKey(p.address)));
    updateUpsellOnlyPins(map, upsellOnly);
    const overlapPoints: Array<{ lat: number; lng: number }> = [];
    overlapInfo.forEach(({ basePin }) => { overlapPoints.push({ lat: basePin.lat, lng: basePin.lng }); });
    updateOverlapHalfPins(map, overlapPoints);
  }, [geocodedUpsellPins, overlapInfo, mapLoaded, updateUpsellOnlyPins, updateOverlapHalfPins]);

  // Pending sales — now driven as GPU layers (see updatePendingSalePins) rather
  // than HTML markers. We always feed the data and gate VISIBILITY via opacity
  // in the FILTER-DRIVEN VISIBILITY effect, exactly like the completed pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    geocodedPendingSalesRef.current = geocodedPendingSales;
    updatePendingSalePins(map, geocodedPendingSales);
  }, [geocodedPendingSales, mapLoaded, updatePendingSalePins]);

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
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([pin.lng, pin.lat]).addTo(map);
      pulsingMarkersRef.current.push(marker);
    });
    return () => {
      pulsingMarkersRef.current.forEach(m => m.remove());
      pulsingMarkersRef.current = [];
    };
  }, [mostRecentCompletionPins, mapLoaded, filterVisibility.pendingSalesAndCompleted]);

  // GPS + drag-to-disable-follow-me + cart-aware on-route
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
    // Re-push our last-known position every 8s so a parked manager (whose GPS
    // watch isn't firing because they're stationary) stays fresh on others' maps
    // rather than going stale. No-op until the first fix populates lastSelfPosRef.
    const selfPushInterval = setInterval(() => {
      const p = lastSelfPosRef.current;
      if (p) sessionService.upsertManagerLocation(p.lat, p.lng).catch(() => {});
    }, 8000);
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
      // MANAGER LOCATION write (Option A — every RM with the map open reports its
      // own position). Self-resolved in the service from current_user, so this only
      // ever writes our own row. Heading omitted per spec (dots, not arrows).
      lastSelfPosRef.current = { lat, lng };
      sessionService.upsertManagerLocation(lat, lng).catch(() => {});
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
      clearInterval(selfPushInterval);
      if(watchIdRef.current!==null){navigator.geolocation.clearWatch(watchIdRef.current);watchIdRef.current=null;}
      navMarkerRef.current?.remove();navMarkerRef.current=null;
    };
  }, [mapLoaded, isTeamSeason, managerId, onFollowMeAutoDisable, applyArrowRotation]);

  // Compass
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

      // Static dashed ring for pending-sale pins. Baked once into an icon so the
      // pin can be a GPU layer (re-projected every frame, never drifts) instead
      // of an HTML marker. No spin — the dashed border is the "in progress" cue.
      // 20px canvas @ pixelRatio 2 → ~10px on screen, wrapping the 3.33-radius
      // fill with a small gap. Tune radius/lineWidth here if the ring sits too
      // tight or loose around the fill.
      const dashCanvasSize = 20;
      const dashCanvas = document.createElement('canvas');
      dashCanvas.width = dashCanvasSize; dashCanvas.height = dashCanvasSize;
      const dctx = dashCanvas.getContext('2d');
      if (dctx) {
        dctx.strokeStyle = '#000000';
        dctx.lineWidth = 2.5;
        dctx.setLineDash([3, 2.5]);
        dctx.beginPath();
        dctx.arc(dashCanvasSize / 2, dashCanvasSize / 2, 8, 0, Math.PI * 2);
        dctx.stroke();
        const dashImg = dctx.getImageData(0, 0, dashCanvasSize, dashCanvasSize);
        if (!map.hasImage('rm-pending-dash-ring')) map.addImage('rm-pending-dash-ring', dashImg, { pixelRatio: 2 });
      }

      // Green confirmation check, baked once so it can ride the pending-pins
      // source as a GPU symbol layer (no drift, same as every reliable pin). A
      // thin white underlay keeps it legible on any bucket/route dot colour. The
      // long up-right stroke runs near the canvas edge so it extends past the
      // ~6.7px dot — the "tail outside the circle" look you asked for. Tune the
      // on-screen size with icon-size, and the dot overlap with icon-offset, in
      // the symbol layer (Block E); the stroke shape lives here.
      const checkSize = 18;
      const checkCanvas = document.createElement('canvas');
      checkCanvas.width = checkSize; checkCanvas.height = checkSize;
      const kctx = checkCanvas.getContext('2d');
      if (kctx) {
        kctx.lineCap = 'round';
        kctx.lineJoin = 'round';
        const drawCheck = (color: string, w: number) => {
          kctx.strokeStyle = color; kctx.lineWidth = w;
          kctx.beginPath();
          kctx.moveTo(4, 9);
          kctx.lineTo(7.5, 13);
          kctx.lineTo(15, 3);
          kctx.stroke();
        };
        drawCheck('#ffffff', 4);    // white halo underlay for contrast
        drawCheck('#16a34a', 2.5);  // green check on top
        const checkImg = kctx.getImageData(0, 0, checkSize, checkSize);
        if (!map.hasImage('rm-confirmed-check')) map.addImage('rm-confirmed-check', checkImg, { pixelRatio: 2 });
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
      managerLocationMarkersRef.current.forEach(m => m.remove());
      managerLocationMarkersRef.current.clear();
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

  // --- NAV ACTION HANDLERS ---
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
    const resolved = resolveNavDestination(cart.navActivity);
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
  const cartCanNavigate = useCallback((cart: CartCardData): boolean => resolveNavDestination(cart.navActivity) !== null, []);

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

  // --- ROUTE SPLIT HANDLERS (V2 RECURSIVE) ---
  //
  // handleOpenSplitModal: invoked from the Split button at the TOP of the
  // assignment modal. Takes the assignModalData snapshot, builds the split
  // modal payload (segments, prebookings, current buckets, source letter,
  // next available letter), and opens RouteSplitModal.
  //
  // handleSplitConfirm: RouteSplitModal called back with the new rectangles
  // and the list of bookings moving from source → new bucket. Persists via
  // sessionService.splitBucket, then reopens the assignment modal scoped to
  // the NEW LETTER so the RM can assign it immediately. From inside that
  // re-opened modal they can choose to assign or to split further (recursive).
  //
  // handleSplitCancel: closes the split modal. The assignment modal is NOT
  // automatically re-opened — the user dismissed the split intentionally,
  // so we leave them in a clean state where they can tap the route again
  // if they want.

  const handleOpenSplitModal = useCallback(() => {
    if (!assignModalData) return;
    const { routeCode, routeColor, letter } = assignModalData;
    const rmd = routeMapData.find(r => r.route_code === routeCode);
    if (!rmd || !rmd.segments?.length) {
      console.warn('[Split] No segment geometry for route', routeCode);
      return;
    }

    // Read the current split row (if any) so the modal can render existing
    // buckets and so we know the next available letter.
    const existingSplit = routeSplitsByCode.get(routeCode);
    const existingBuckets = existingSplit?.buckets || null;
    const splittingFromLetter = letter || 'a';

    // Compute the next available letter. If no split exists yet, the next
    // letter is 'b' (since 'a' is implicit).
    const newLetter = existingBuckets
      ? sessionService.nextAvailableLetter(existingBuckets)
      : 'b';

    // baseRouteColor: always the 'a' bucket's colour, derived from the route
    // map record (not assignModalData.routeColor — that could be the bucket-
    // specific colour).
    const baseRouteColor = rmd.route_color;

    // All prebookings on this route (regardless of bucket) — modal renders all.
    const prebookings = geocodedPins
      .filter(p => p.status === 'pending' && p.routeCode === routeCode)
      .map(p => ({ bookingId: p.id, lat: p.lat, lng: p.lng }));

    // For the first-split case, splitBucket needs the full list of booking
    // IDs to initialize bucket 'a'. We compute it from the current bookings.
    const allBookingIdsOnRoute = bookings
      .filter(b => b['Route Number'] === routeCode)
      .map(b => b['Booking ID']);

    // Close the assignment modal before opening split.
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
    rectangles: Array<{ corners: Array<{ lng: number; lat: number }> }>,
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
    // Refresh splits so routeCardData re-renders with N cards.
    await reloadRouteSplits();

    // Compute new-bucket stats for the assignment modal we're about to open.
    const movingSet = new Set(bookingsMovingToNew);
    const newBucketBookings = bookings.filter(b =>
      b['Route Number'] === routeCode && movingSet.has(b['Booking ID'])
    );
    const totalEQ = newBucketBookings.reduce((sum, b) => sum + calculateBookingEQ(b), 0);

    setSplitModalData(null);

    // Open the assignment picker for the NEW LETTER. canSplit is true since
    // it has zero assigned workers.
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

  // --- ASSIGN ROUTE ---
  // Branches by letter:
  //   - assignModalData.letter undefined: whole-route assignment flow.
  //   - assignModalData.letter set: writes to route_splits via
  //     updateRouteSplitAssignment, which handles the buckets array and the
  //     routes.assigned_worker_ids union AND the per-booking assignment for
  //     the affected bucket's bookings.
  const handleAssignRoute = async (workerId: string | null) => {
    if (!assignModalData) return;
    setAssignLoading(true);
    try {
      const { routeCode, letter } = assignModalData;

      if (letter) {
        // Bucket-scoped assignment.
        const workerIds = workerId === null ? [] : [workerId];
        // For team seasons, cart members need to be included on the route's
        // assigned_worker_ids union so the existing per-booking session logic
        // still works. updateRouteSplitAssignment handles the union math.
        let bucketWorkerIds = workerIds;
        if (isTeamSeason && workerId !== null) {
          const worker = myTeamWorkers.find(w => w.contractorId === workerId);
          const teamId = worker?.teamId || workerId;
          const cart = teamCarts.find(c => c.teamId === teamId);
          if (cart && cart.workerIds.length > 1) bucketWorkerIds = cart.workerIds;
        }
        // OWNERSHIP TRANSFER (per-bucket). When a floater assigns this bucket to a
        // worker who belongs to a DIFFERENT manager than the route's current owner,
        // stamp that manager onto the bucket so it re-homes (and recolours via the
        // casing) without moving the rest of the route. On unassign (workerId null)
        // we pass no 4th arg, leaving the existing stamp as-is — once a bucket is
        // given to a manager it stays theirs until reassigned to someone else's worker.
        const assignedManagerId =
          workerId === null
            ? undefined
            : myTeamWorkers.find(w => w.contractorId === workerId)?.assignedManagerId as string | undefined;
        await sessionService.updateRouteSplitAssignment(routeCode, letter, bucketWorkerIds, assignedManagerId);

        // For team seasons, also push session_id onto this bucket's bookings
        // so the worker logsheet routes them correctly.
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
        // Reload the split/bucket data so the sidebar cards and the assignment
        // modal reflect the just-written bucket.assignedWorkers. onRefresh()
        // only reloads routes + sessions, not the route_splits state the bucket
        // display reads from — without this the assignment persists to the DB
        // but the screen keeps showing the bucket as unassigned.
        await reloadRouteSplits();
        onRefresh();
        return;
      }

      // Whole-route (non-split) assignment — unchanged behaviour.
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
        // OWNERSHIP TRANSFER (whole route). If this worker belongs to a different
        // manager than the route's current owner, move the route's manager_id so
        // it re-homes to that manager (two-tone not applicable — unsplit route).
        const newOwner = worker?.assignedManagerId as string | undefined;
        const currentOwner = routes.find(r => r.routeCode === routeCode)?.managerId;
        if (newOwner && newOwner !== currentOwner) {
          await sessionService.transferRouteToManager(routeCode, newOwner);
        }
      } else {
        await sessionService.assignRouteToWorkers(routeCode, [workerId]);
        await Promise.all(pendingItems.map(job => sessionService.assignBookingToWorker(job['Booking ID'], workerId)));
        // OWNERSHIP TRANSFER (whole route, aeration). Same rule: assigning to a
        // worker under another manager re-homes the route to that manager.
        const aerWorker = myTeamWorkers.find(w => w.contractorId === workerId);
        const newOwner = aerWorker?.assignedManagerId as string | undefined;
        const currentOwner = routes.find(r => r.routeCode === routeCode)?.managerId;
        if (newOwner && newOwner !== currentOwner) {
          await sessionService.transferRouteToManager(routeCode, newOwner);
        }
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

  // Resize map when sidebar opens/closes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => { try { map.resize(); } catch {} }, 250);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

  // --- ROUTE ASSIGNMENT MODAL HELPERS (sort + route-badge data) ---
  //
  // For the new wider assignment modal, each worker/cart button shows route
  // badges underneath. We need:
  //   - For each worker: the list of routes they're currently on (with their colours)
  //   - For each cart: same, but routes shared by the cart
  // And we sort by fewest current route assignments (ascending), with
  // alphabetical tiebreaker.

  // Map workerId -> list of {routeCode, color} they're currently assigned to.
  // For split routes, one entry per bucket the worker is in (e.g. a worker
  // assigned to BIN09c shows up as "BIN09c" with the c-bucket colour).
  const workerRouteBadges = useMemo(() => {
    const m = new Map<string, Array<{ code: string; color: string }>>();
    for (const r of routes) {
      if (!coveredManagerIds.has(r.managerId)) continue;
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
  }, [routes, coveredManagerIds, routeSplitsByCode, routeColorMap]);

  // Sorted worker list (aeration): fewest routes first, alphabetical tiebreaker.
  const sortedAerationAssignList = useMemo(() => {
    return [...myTeamWorkers].sort((a, b) => {
      const ar = (workerRouteBadges.get(a.contractorId) || []).length;
      const br = (workerRouteBadges.get(b.contractorId) || []).length;
      if (ar !== br) return ar - br;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
  }, [myTeamWorkers, workerRouteBadges]);

  // Sorted cart list (team seasons): fewest routes per cart, alphabetical tiebreaker.
  // Each "cart" here is keyed by session worker_id (the cart's primary worker).
  const sortedTeamAssignList = useMemo(() => {
    if (!contractorsByCart) return [];
    const entries = Array.from(contractorsByCart.entries());
    return entries.sort(([, aMembers], [, bMembers]) => {
      // A cart's "route count" is the number of routes ANY member is on. Take
      // the max member's count as the proxy (since cart members share routes
      // via the union).
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
    <>
      <style>{`
        @keyframes rmSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes rmSlideOut { from { transform: translateX(0); } to { transform: translateX(-100%); } }
      `}</style>

      <div
        className="relative w-full flex flex-row"
        style={{ height: 'calc(100vh - 160px)' }}
      >

        {/* SIDEBAR */}
        {sidebarOpen && (
          <div
            className="flex-shrink-0 w-[min(380px,90vw)] bg-gray-900 border-r border-gray-700 z-30 shadow-2xl flex flex-col h-full"
            style={{ animation: 'rmSlideIn 0.2s ease-out forwards' }}
          >
            {/* Header */}
            <div className="flex-shrink-0 p-3 border-b border-gray-700 bg-gray-900/95">
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

              <div className="flex bg-gray-800 rounded-lg p-0.5 mb-3">
                <button
                  onClick={() => setSidebarMode('staff')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    sidebarMode === 'staff' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Users size={12} className="inline mr-1" />
                  Staff
                </button>
                <button
                  onClick={() => setSidebarMode('routes')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    sidebarMode === 'routes' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <MapPin size={12} className="inline mr-1" />
                  Routes
                </button>
              </div>

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

              {/* STAFF MODE — workers (aeration) */}
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
                          {hasFlag && (<span title={`Red flags: ${flags.join(', ')}`} className="text-red-400"><AlertTriangle size={12} /></span>)}
                        </div>
                        {card.lastActiveAddress && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            {card.lastActiveTime} • {card.lastActiveAddress}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-[10px] text-gray-300">
                          <span>{card.stats.steps} steps</span><span className="text-gray-600">•</span>
                          <span className={card.stats.pending > 0 ? 'text-amber-400' : ''}>{card.stats.pending} pend</span><span className="text-gray-600">•</span>
                          <span>{card.stats.eq.toFixed(1)} EQ</span><span className="text-gray-600">•</span>
                          <span>{card.stats.upsellCount} up</span><span className="text-gray-600">•</span>
                          <span>${card.stats.upsellGross.toFixed(0)}</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        {canNav && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleNavigateToWorker(card); }}
                            className="w-7 h-7 rounded-md bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white flex items-center justify-center transition-colors"
                            title={`Navigate to ${card.worker.firstName}`}
                          ><Navigation2 size={13} /></button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewLogsheet(card.worker); }}
                          className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                          title="Open logsheet"
                        ><Eye size={13} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* STAFF MODE — carts (team seasons) */}
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
                          {hasFlag && (<span title={`Red flags: ${flags.join(', ')}`} className="text-red-400"><AlertTriangle size={12} /></span>)}
                        </div>
                        {cart.lastActiveAddress && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">{cart.lastActiveTime} • {cart.lastActiveAddress}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-[10px] text-gray-300">
                          <span>{cart.stats.steps} steps</span><span className="text-gray-600">•</span>
                          <span className={cart.stats.pending > 0 ? 'text-amber-400' : ''}>{cart.stats.pending} pend</span><span className="text-gray-600">•</span>
                          <span>{cart.stats.eq.toFixed(1)} EQ</span><span className="text-gray-600">•</span>
                          <span>{cart.stats.upsellCount} up</span><span className="text-gray-600">•</span>
                          <span>${cart.stats.upsellGross.toFixed(0)}</span>
                          {cart.stats.pendingSaleCount > 0 && (<><span className="text-gray-600">•</span><span className="text-amber-400">{cart.stats.pendingSaleCount} sale</span></>)}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        {canNav && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleNavigateToCart(cart); }}
                            className="w-7 h-7 rounded-md bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white flex items-center justify-center transition-colors"
                            title={`Navigate to ${label}`}
                          ><Navigation2 size={13} /></button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewLogsheet(cart.members[0], cart.members); }}
                          className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                          title="Open logsheet"
                        ><Eye size={13} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* ROUTES MODE — SPLIT-AWARE.
                  Each card shows its display code (e.g. "BIN09a" for split halves).
                  Split button appears only on cards that are: not split AND not assigned. */}
              {sidebarMode === 'routes' && routeCardData.map(rc => (
                <div
                  key={`${rc.baseRouteCode}-${rc.letter || 'whole'}`}
                  onClick={() => {
                    // V2 design: sidebar card tap opens the assignment modal
                    // (matching the route-line tap on the map). The Split
                    // button is inside the modal, so this is the entry point
                    // for both assignment and split flows.
                    setAssignModalData({
                      routeCode: rc.baseRouteCode,
                      displayRouteCode: rc.displayRouteCode,
                      routeColor: rc.routeColor,
                      prebookCount: rc.prebookCount,
                      prepayCount: rc.prepayCount,
                      totalEQ: rc.totalEQ,
                      currentWorkerIds: rc.assignedWorkerIds,
                      letter: rc.letter,
                      canSplit: rc.assignedWorkerIds.length === 0,
                    });
                  }}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-2.5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-8 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-[11px] flex-shrink-0 leading-none whitespace-nowrap"
                      style={{ background: rc.routeColor }}
                    >
                      {rc.displayRouteCode}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-bold truncate">
                        {rc.assignedWorkerLabel || <span className="text-amber-400">⚠ Unassigned</span>}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {rc.prebookCount} jobs • {rc.prepayCount} prepaid • {rc.totalEQ.toFixed(1)} EQ
                      </div>
                    </div>
                    {/* SPLIT BUTTON removed in v2 — Split now lives inside the
                        assignment modal (opens when the card or line is tapped),
                        which is also how the user splits buckets recursively. */}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAP AREA */}
        <div className="flex-1 relative h-full min-w-0">
          <div ref={mapContainerRef} className="absolute inset-0 bg-gray-900" />

          {routesLoading && (
            <div className="absolute top-3 left-3 z-30 bg-gray-900/90 text-white text-xs px-3 py-2 rounded-lg flex items-center gap-2 shadow-lg">
              <Loader size={14} className="animate-spin" />
              Loading routes…
            </div>
          )}

          {!routesLoading && mapLoaded && routeMapData.length === 0 && myRouteCodes.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-amber-900/90 text-amber-100 text-xs px-3 py-2 rounded-lg shadow-lg max-w-md text-center">
              <AlertCircle size={14} className="inline mr-1" />
              No approved route geometry found. Have a Senior RM approve routes.
            </div>
          )}

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

          {!sidebarOpen && !navState && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="absolute top-3 left-3 z-40 w-11 h-11 bg-gray-900/95 hover:bg-gray-800 text-white rounded-lg shadow-xl flex items-center justify-center transition-all border border-gray-700"
              title="Open sidebar"
            ><LayoutList size={20} /></button>
          )}

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
                  {onRouteRedFlags.hasFlag && (<AlertTriangle size={12} className="inline ml-1.5 text-red-400" />)}
                </div>
              </div>
            </div>
          )}

          {navState && mapRef.current && (
            <RMNavigation
              map={mapRef.current}
              destination={navState.destination}
              onArrived={handleNavArrived}
              onCancel={handleNavCancel}
              initialHeading={
                gpsHeadingRef.current != null
                  && (Date.now() - gpsHeadingUpdatedAtRef.current) < 300000
                  ? gpsHeadingRef.current
                  : null
              }
            />
          )}
        </div>

        {/* WORKER DETAIL MODAL — WIDENED to max-w-3xl */}
        {selectedWorkerForModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelectedWorkerForModal(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
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
                      onClick={() => { const card = selectedWorkerForModal; setSelectedWorkerForModal(null); handleNavigateToWorker(card); }}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
                      title="Navigate to most recent transaction"
                    ><Navigation2 size={12} />Navigate</button>
                  )}
                  <button
                    onClick={() => handleViewLogsheet(selectedWorkerForModal.worker)}
                    className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md flex items-center gap-1.5"
                    title="View logsheet"
                  ><FileText size={12} />Logsheet</button>
                  <button
                    onClick={() => handleToggleUpsells(selectedWorkerForModal.worker.contractorId, selectedWorkerForModal.upsellsEnabled)}
                    className={`px-2.5 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${
                      selectedWorkerForModal.upsellsEnabled
                        ? 'bg-green-600/20 text-green-300 hover:bg-green-600 hover:text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title="Toggle upsells"
                  >{selectedWorkerForModal.upsellsEnabled ? 'Upsells ✓' : 'Upsells ✗'}</button>
                  <button
                    onClick={() => setSelectedWorkerForModal(null)}
                    className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  ><X size={14} /></button>
                </div>
              </div>
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

        {/* CART DETAIL MODAL — WIDENED to max-w-3xl */}
        {selectedCartForModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelectedCartForModal(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-shrink-0 p-3 border-b border-gray-700 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {selectedCartForModal.isRcCart && (<Truck size={13} className="text-orange-400 flex-shrink-0" />)}
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
                      onClick={() => { const cart = selectedCartForModal; setSelectedCartForModal(null); handleNavigateToCart(cart); }}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
                      title="Navigate to most recent transaction"
                    ><Navigation2 size={12} />Navigate</button>
                  )}
                  <button
                    onClick={() => handleViewLogsheet(selectedCartForModal.members[0], selectedCartForModal.members)}
                    className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md flex items-center gap-1.5"
                    title="Open cart logsheet"
                  ><FileText size={12} />Logsheet</button>
                  <button
                    onClick={() => setSelectedCartForModal(null)}
                    className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  ><X size={14} /></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-3">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">Cart members</div>
                  <div className="space-y-1.5">
                    {selectedCartForModal.members.map(m => (
                      <div key={m.contractorId} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                        <Users size={11} className="text-gray-400 flex-shrink-0" />
                        <span className="text-white text-xs font-medium flex-1 min-w-0 truncate">{m.firstName} {m.lastName}</span>
                        {isRcWorker(m.teamId) && (<span className="text-[9px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-bold">RC</span>)}
                        {m.cellPhone && (<a href={`tel:${m.cellPhone}`} className="text-blue-400 hover:text-blue-300" title="Call"><Phone size={11} /></a>)}
                      </div>
                    ))}
                  </div>
                </div>

                {isSealing && selectedCartForModal.asphaltOwnedRows.length > 0 && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">Asphalt sold by this cart</div>
                    <div className="space-y-1">
                      {selectedCartForModal.asphaltOwnedRows.map(ps => (
                        <div key={ps.id} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                          <Shovel size={11} className="text-amber-400 flex-shrink-0" />
                          <span className="text-white text-xs flex-1 min-w-0 truncate">{assembleAddressFromPending(ps)}</span>
                          <span className="text-amber-300 text-[10px] font-bold">{formatAsphaltDollars(ps.asphaltAmount)}</span>
                          {ps.assignedRcSessionId && (
                            <button
                              onClick={() => handleUnassignAsphalt(ps.id, assembleAddressFromPending(ps))}
                              disabled={unassigningAsphaltId === ps.id}
                              className="text-[9px] bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white px-1.5 py-0.5 rounded font-bold transition-colors disabled:opacity-50"
                              title="Unassign asphalt"
                            >{unassigningAsphaltId === ps.id ? '...' : 'Unassign'}</button>
                          )}
                        </div>
                      ))}
                    </div>
                    {unassignError && (<div className="text-[10px] text-red-400 mt-1">{unassignError}</div>)}
                  </div>
                )}

                {isSealing && selectedCartForModal.asphaltIncomingRows.length > 0 && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1.5">Asphalt assigned to this RC</div>
                    <div className="space-y-1">
                      {selectedCartForModal.asphaltIncomingRows.map(ps => (
                        <div key={ps.id} className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
                          <Shovel size={11} className="text-amber-400 flex-shrink-0" />
                          <span className="text-white text-xs flex-1 min-w-0 truncate">{assembleAddressFromPending(ps)}</span>
                          <span className="text-amber-300 text-[10px] font-bold">{formatAsphaltDollars(ps.asphaltAmount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

        {/* ROUTE PREBOOKINGS POPUP — unchanged width (max-w-md) */}
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
                <div className="text-white font-bold text-sm">Route {selectedRouteForBookings} • {selectedRouteBookings.length} jobs</div>
                <button
                  onClick={() => setSelectedRouteForBookings(null)}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                ><X size={14} /></button>
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

        {pendingJobForModal && (
          <PendingJobModal
            booking={pendingJobForModal}
            onClose={() => setPendingJobForModal(null)}
            onRefresh={() => { setPendingJobForModal(null); onRefresh(); }}
          />
        )}

        {/* ROUTE ASSIGNMENT MODAL — V2: max-w-3xl, route badges, fewest-routes sort,
            Split button at the TOP (enabled when bucket has zero assigned workers). */}
        {assignModalData && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setAssignModalData(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-shrink-0 p-4 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-9 px-2.5 min-w-[48px] rounded-md flex items-center justify-center font-bold text-white text-xs flex-shrink-0 leading-none whitespace-nowrap"
                    style={{ background: assignModalData.routeColor }}
                  >
                    {assignModalData.displayRouteCode}
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">Assign Route</div>
                    <div className="text-[10px] text-gray-400">
                      {assignModalData.prebookCount} jobs • {assignModalData.prepayCount} prepaid • {assignModalData.totalEQ.toFixed(1)} EQ
                    </div>
                    <div className="text-[10px] text-amber-400 font-mono">
                      DIAG letter={String(assignModalData.letter)} | split buckets=[
                      {(routeSplitsByCode.get(assignModalData.routeCode)?.buckets || []).map(b => `${b.letter}:${(b.assignedWorkers||[]).length}`).join(', ')}]
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setAssignModalData(null)}
                  className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                ><X size={14} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-0">
                {/* Split button at TOP — enabled iff this bucket/route has zero
                    assigned workers. Title explains the disabled reason. */}
                <button
                  onClick={handleOpenSplitModal}
                  disabled={!assignModalData.canSplit || assignLoading}
                  title={assignModalData.canSplit
                    ? 'Carve a new sub-bucket out of this route'
                    : 'Unassign workers first before splitting'}
                  className="w-full text-left px-3 py-2 bg-amber-600/20 hover:bg-amber-600 border border-amber-600/50 hover:border-amber-500 rounded-md text-amber-300 hover:text-white text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-600/20 disabled:hover:text-amber-300"
                >
                  <Scissors size={13} />
                  Split this {assignModalData.letter ? `bucket (${assignModalData.displayRouteCode})` : 'route'}
                </button>

                {/* Divider */}
                <div className="border-t border-gray-700 my-2"></div>

                {/* Unassign — only shown if there's a current assignment */}
                {assignModalData.currentWorkerIds.length > 0 && (
                  <button
                    onClick={() => handleAssignRoute(null)}
                    disabled={assignLoading}
                    className="w-full text-left px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-md text-red-300 text-xs font-bold disabled:opacity-50"
                  >
                    {assignLoading ? <Loader size={12} className="inline animate-spin" /> : <X size={12} className="inline mr-1.5" />}
                    Unassign {assignModalData.letter ? `bucket ${assignModalData.letter}` : 'route'}
                  </button>
                )}

                {/* Worker / cart list — sorted by fewest current routes first */}
                {isTeamSeason ? (
                  sortedTeamAssignList.map(([sessionWorkerId, cartMembers]) => {
                    const cart = teamCarts.find(c => c.workerIds.includes(cartMembers[0].contractorId));
                    const sessionWorker = cartMembers[0];
                    const label = cartMembers.length > 1
                      ? cartMembers.map(m => m.firstName).join(' & ')
                      : `${sessionWorker.firstName} ${sessionWorker.lastName}`;
                    const isAssigned = cart?.workerIds.some(wid => assignModalData.currentWorkerIds.includes(wid));
                    // Combine route badges across cart members (deduped by code).
                    const badgeMap = new Map<string, string>();
                    for (const m of cartMembers) {
                      const badges = workerRouteBadges.get(m.contractorId) || [];
                      for (const b of badges) badgeMap.set(b.code, b.color);
                    }
                    const badges = Array.from(badgeMap.entries()).map(([code, color]) => ({ code, color }));
                    return (
                      <button
                        key={sessionWorkerId}
                        onClick={() => handleAssignRoute(sessionWorker.contractorId)}
                        disabled={assignLoading}
                        className={`w-full text-left px-3 py-2.5 rounded-md text-xs font-medium border ${
                          isAssigned ? 'bg-blue-900/40 border-blue-700 text-blue-200' : 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold">{label}</span>
                          {isAssigned && <Check size={12} className="text-blue-400 flex-shrink-0" />}
                        </div>
                        {badges.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {badges.map(b => (
                              <span
                                key={b.code}
                                className="h-5 px-1.5 rounded text-[9px] font-bold text-white leading-none flex items-center"
                                style={{ background: b.color }}
                              >{b.code}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                ) : (
                  sortedAerationAssignList.map(w => {
                    const isAssigned = assignModalData.currentWorkerIds.includes(w.contractorId);
                    const badges = workerRouteBadges.get(w.contractorId) || [];
                    return (
                      <button
                        key={w.contractorId}
                        onClick={() => handleAssignRoute(w.contractorId)}
                        disabled={assignLoading}
                        className={`w-full text-left px-3 py-2.5 rounded-md text-xs font-medium border ${
                          isAssigned ? 'bg-blue-900/40 border-blue-700 text-blue-200' : 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold">{w.firstName} {w.lastName}</span>
                          {isAssigned && <Check size={12} className="text-blue-400 flex-shrink-0" />}
                        </div>
                        {badges.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {badges.map(b => (
                              <span
                                key={b.code}
                                className="h-5 px-1.5 rounded text-[9px] font-bold text-white leading-none flex items-center"
                                style={{ background: b.color }}
                              >{b.code}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}

                {/* Transfer to other manager — only on non-split (whole-route) assignment */}
                {!assignModalData.letter && (
                  <button
                    onClick={openTransferModal}
                    disabled={assignLoading}
                    className="w-full text-left px-3 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/50 rounded-md text-purple-300 text-xs font-bold mt-2 disabled:opacity-50"
                  >
                    <ArrowRightLeft size={12} className="inline mr-1.5" />
                    Transfer to another manager…
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

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
                ><X size={14} /></button>
              </div>
              <div className="space-y-1.5">
                {availableManagers.map(mgr => (
                  <button
                    key={mgr.userId}
                    onClick={() => handleTransferConfirm(mgr.userId)}
                    className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700"
                  ><ArrowRight size={12} className="inline mr-1.5 text-purple-400" />{mgr.name}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MANAGE TEAM MODAL — unchanged width (max-w-lg) */}
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
                ><X size={14} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                {reassignSuccess && (
                  <div className="mb-3 px-3 py-2 bg-green-900/30 border border-green-700 rounded-md text-green-300 text-xs">
                    <Check size={11} className="inline mr-1" />{reassignSuccess}
                  </div>
                )}
                {reassignError && (
                  <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-300 text-xs">
                    <AlertCircle size={11} className="inline mr-1" />{reassignError}
                  </div>
                )}

                {!selectedWorkerToMove ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-1">Pick a worker to move</div>
                    {isTeamSeason ? (
                      cartCardData.map(cart =>
                        cart.members.map(m => (
                          <button
                            key={m.contractorId}
                            onClick={() => { setSelectedWorkerToMove(m); setSelectedWorkerSourceCart(cart); }}
                            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 flex items-center gap-2"
                          >
                            <Users size={11} className="text-gray-400" />
                            <span className="flex-1 truncate">{m.firstName} {m.lastName}</span>
                            <span className="text-[9px] text-gray-500">
                              {cart.members.length > 1 ? cart.members.map(x => x.firstName).join(' & ') : 'solo'}
                            </span>
                          </button>
                        ))
                      )
                    ) : (
                      myTeamWorkers.map(w => (
                        <button
                          key={w.contractorId}
                          onClick={() => { setSelectedWorkerToMove(w); setSelectedWorkerSourceCart(null); }}
                          className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium border flex items-center gap-2 ${
                            isAerationWorkerModifiable(w) ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700' : 'bg-gray-800/40 text-gray-500 border-gray-800 cursor-not-allowed'
                          }`}
                          disabled={!isAerationWorkerModifiable(w)}
                        >
                          <Users size={11} className="text-gray-400" />
                          <span className="flex-1 truncate">{w.firstName} {w.lastName}</span>
                          {!isAerationWorkerModifiable(w) && (<span className="text-[9px] text-amber-400">has txs — locked</span>)}
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="px-3 py-2 bg-blue-900/20 border border-blue-700/40 rounded-md flex items-center gap-2">
                      <button
                        onClick={() => { setSelectedWorkerToMove(null); setSelectedWorkerSourceCart(null); }}
                        className="text-blue-300 hover:text-white"
                      ><Undo2 size={12} /></button>
                      <div className="text-white text-xs font-bold flex-1 truncate">
                        Move {selectedWorkerToMove.firstName} {selectedWorkerToMove.lastName}
                      </div>
                    </div>

                    {isTeamSeason ? (
                      <>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">Move to another cart</div>
                        {cartCardData
                          .filter(c => c.sessionId !== selectedWorkerSourceCart?.sessionId)
                          .map(c => {
                            const label = c.members.length > 1 ? c.members.map(m => m.firstName).join(' & ') : c.members[0]?.firstName;
                            return (
                              <button
                                key={c.sessionId}
                                onClick={() => handleReassignWorker({ type: 'existing_cart', targetSessionId: c.sessionId, label: label || '' })}
                                disabled={reassignLoading}
                                className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 disabled:opacity-50"
                              ><UserPlus size={11} className="inline mr-1.5 text-green-400" />{label}</button>
                            );
                          })}
                        {selectedWorkerSourceCart && selectedWorkerSourceCart.members.length > 1 && (
                          <button
                            onClick={() => handleReassignWorker({ type: 'new_solo' })}
                            disabled={reassignLoading}
                            className="w-full text-left px-3 py-2 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/50 rounded-md text-amber-300 text-xs font-bold disabled:opacity-50"
                          ><UserMinus size={11} className="inline mr-1.5" />Make solo cart</button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">Transfer to another manager</div>
                        {availableManagers.map(mgr => (
                          <button
                            key={mgr.userId}
                            onClick={() => handleAerationTransfer(mgr.userId)}
                            disabled={reassignLoading}
                            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-white text-xs font-medium border border-gray-700 disabled:opacity-50"
                          ><ArrowRight size={11} className="inline mr-1.5 text-purple-400" />{mgr.name}</button>
                        ))}
                      </>
                    )}

                    {isTeamSeason && availableManagers.length > 0 && (
                      <>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mt-2">Transfer to another manager</div>
                        <div className="flex gap-1.5">
                          <select
                            value={reassignManagerId}
                            onChange={e => setReassignManagerId(e.target.value)}
                            className="flex-1 bg-gray-800 text-white text-xs rounded-md px-2 py-1.5 border border-gray-700"
                          >
                            <option value="">Pick a manager…</option>
                            {availableManagers.map(m => (<option key={m.userId} value={m.userId}>{m.name}</option>))}
                          </select>
                          <button
                            onClick={() => reassignManagerId && handleReassignWorker({ type: 'different_manager', targetManagerId: reassignManagerId })}
                            disabled={!reassignManagerId || reassignLoading}
                            className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded-md disabled:opacity-50"
                          >Move</button>
                        </div>
                      </>
                    )}

                    <button
                      onClick={handleRemoveWorkerNoShow}
                      disabled={reassignLoading}
                      className="w-full text-left px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-md text-red-300 text-xs font-bold mt-3 disabled:opacity-50"
                    ><Trash2 size={11} className="inline mr-1.5" />Remove worker (no-show)</button>
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
                You're currently navigating to <span className="text-white font-bold">{switchNavConfirm.currentLabel}</span>.
              </div>
              <div className="text-xs text-gray-300 mb-3">
                Cancel current navigation and go to <span className="text-blue-300 font-bold">{switchNavConfirm.newLabel}</span>?
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSwitchNavConfirm(null)}
                  className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md"
                >Cancel</button>
                <button
                  onClick={handleSwitchNavConfirm}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md"
                >Switch navigation</button>
              </div>
            </div>
          </div>
        )}

        {/* ROUTE-NAV PROMPT */}
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
                >{routeNavPrompt.routeCode}</div>
                <div className="text-white font-bold text-sm">
                  {routeNavPrompt.entries.length === 1 ? 'Navigate to…' : 'Pick who to navigate to'}
                </div>
                <button
                  onClick={() => setRouteNavPrompt(null)}
                  className="ml-auto w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
                  title="Cancel"
                ><X size={14} /></button>
              </div>

              {routeNavPrompt.entries.length === 1 ? (
                <>
                  <div className="text-sm text-gray-200 mb-3">
                    Navigate to <span className="text-blue-300 font-bold">{routeNavPrompt.entries[0].label}</span>?
                    {!routeNavPrompt.entries[0].hasGeocodableAddress && (
                      <span className="block text-[11px] text-amber-400 mt-1">No recent transactions to navigate to.</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRouteNavPrompt(null)}
                      className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md"
                    >Cancel</button>
                    <button
                      onClick={() => handleRouteNavPromptSelect(routeNavPrompt.entries[0])}
                      disabled={!routeNavPrompt.entries[0].hasGeocodableAddress}
                      className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition-colors"
                    ><Navigation2 size={12} />Navigate</button>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  {routeNavPrompt.entries.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => handleRouteNavPromptSelect(entry)}
                      disabled={!entry.hasGeocodableAddress}
                      className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/40 disabled:cursor-not-allowed rounded-md border border-gray-700 text-xs flex items-center gap-2 transition-colors"
                    >
                      <Navigation2 size={12} className={entry.hasGeocodableAddress ? 'text-blue-400' : 'text-gray-600'} />
                      <span className={`flex-1 font-bold truncate ${entry.hasGeocodableAddress ? 'text-white' : 'text-gray-500'}`}>{entry.label}</span>
                      {!entry.hasGeocodableAddress && (<span className="text-[10px] text-amber-400 flex-shrink-0">no recent location</span>)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ROUTE SPLIT MODAL — V2 RECURSIVE.
            Opened from the Split button at the top of the assignment modal.
            Hands segments, prebookings, current buckets, source letter, and
            next available letter to RouteSplitModal. On Confirm, handleSplit-
            Confirm persists the split and reopens the assignment modal for
            the NEW LETTER. */}
        {splitModalData && (
          <RouteSplitModal
            isOpen={!!splitModalData}
            onClose={handleSplitCancel}
            routeCode={splitModalData.routeCode}
            baseRouteColor={splitModalData.baseRouteColor}
            segments={splitModalData.segments}
            prebookings={splitModalData.prebookings}
            existingBuckets={splitModalData.existingBuckets}
            splittingFromLetter={splitModalData.splittingFromLetter}
            newLetter={splitModalData.newLetter}
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN as string}
            onConfirm={handleSplitConfirm}
          />
        )}

      </div>
    </>
  );
};

export default RMMapTab;
