// src/lib/dmbPclService.ts
//
// Digital Master Bookings — PCL PDF Generator
//
// Generates a single landscape PDF for an area's routes.
// Each route starts with a greyscale map (yellow-highlighted route)
// followed by client history tables in a two-column layout.
//
// Data source: callbook spreadsheet (aeration type), read via dialerSheetsService.
// Clients are grouped by address; the most common name/phone is shown
// (ties broken by most recent year).
//
// Layout: Landscape letter (11×8.5"), two portrait blocks per page.
//   Page 1 per route → left block = route map, right block = PCL start
//   Subsequent pages  → both blocks = PCL continuation
//

import { dialerSheetsService } from './dialerSheetsService';
import jsPDF from 'jspdf';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface SavedRouteInput {
  id: string;
  area_name: string;
  route_number: number;
  route_code: string;
  route_color: string;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}

interface CallbookRow {
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  phone: string;
  fo: string;
  price: string;
  contractor: string;
  year: number;
}

interface ClientGroup {
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  phone: string;
  history: Array<{
    year: number;
    price: string;
    serviceType: string;
    contractor: string;
  }>;
}

interface RouteData {
  routeCode: string;
  routeNumber: number;
  segments: Array<{ coordinates: [number, number][] }>;
  clients: ClientGroup[];
}

export interface DmbPCLProgress {
  phase: string;
  detail: string;
  percent: number;
}

export interface DmbPCLResult {
  success: boolean;
  totalClients: number;
  routeCount: number;
  errorMessage?: string;
}

// ─── PDF LAYOUT CONSTANTS ────────────────────────────────────────────────────
// All values in points (1pt = 1/72 inch).
// Landscape letter = 792 × 612 pt.

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 14;
const GAP = 8;                                          // gap between left & right blocks
const BORDER_W = 1.5;                                   // black border stroke width

const BLOCK_W = (PAGE_W - 2 * MARGIN - GAP) / 2;       // ≈ 378 pt
const BLOCK_H = PAGE_H - 2 * MARGIN;                    // ≈ 584 pt
const BLOCK_L_X = MARGIN;                               // left block origin x
const BLOCK_R_X = MARGIN + BLOCK_W + GAP;               // right block origin x

const TITLE_H = 30;                                     // map title bar height
const BLOCK_PAD = 6;                                    // inner padding

const CLIENT_HEADER_H = 13;                             // grey client header row
const HISTORY_ROW_H = 10;                               // each year of history
const CLIENT_GAP = 4;                                   // vertical space between groups

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  let s = String(raw ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function formatPhone(digits: string): string {
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return digits;
}

function cellVal(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  return s;
}

function interpretService(foVal: string): string {
  const v = foVal.toUpperCase();
  if (v === 'X' || v === 'FO') return 'FO';
  if (v === 'BO') return 'BO';
  return 'FP';
}

function formatPrice(raw: string): string {
  if (!raw) return '';
  const n = parseFloat(raw.replace(/[,$]/g, ''));
  if (isNaN(n)) return raw;
  return '$' + n.toFixed(2);
}

function parseHouseNum(val: string): number {
  const n = parseInt(val.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function normalizeStreet(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── HEADER RESOLUTION ──────────────────────────────────────────────────────

function findHeaderRow(rawData: any[][]): number | null {
  const limit = Math.min(10, rawData.length);
  for (let r = 0; r < limit; r++) {
    for (let c = 0; c < (rawData[r]?.length || 0); c++) {
      const h = String(rawData[r][c] ?? '').trim().toUpperCase();
      if (h === 'PHONE' || h === 'PHONE #' || h === 'PHONE#') return r;
    }
  }
  return null;
}

interface ColumnIndices {
  ROUTE_CODE: number;
  FIRST: number;
  LAST: number;
  HOUSE: number;
  STREET: number;
  CITY: number;
  PHONE: number;
  FO: number;
  PRICE: number;
  CONTRACTOR: number;
  YEAR: number;
}

function resolveColumns(headers: any[]): ColumnIndices {
  const CI: ColumnIndices = {
    ROUTE_CODE: -1, FIRST: -1, LAST: -1, HOUSE: -1,
    STREET: -1, CITY: -1, PHONE: -1, FO: -1,
    PRICE: -1, CONTRACTOR: -1, YEAR: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;

    if (['ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE'].includes(h) && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if (['FIRST NAME', 'FIRST_NAME', 'FIRSTNAME', 'FIRST'].includes(h) && CI.FIRST < 0) CI.FIRST = i;
    else if (['LAST NAME', 'LAST_NAME', 'LASTNAME', 'LAST'].includes(h) && CI.LAST < 0) CI.LAST = i;
    else if (['HOUSE #', 'HOUSE#', 'HOUSE NUM', 'HOUSE_NUM', 'PREFIX', 'HOUSE'].includes(h) && CI.HOUSE < 0) CI.HOUSE = i;
    else if (['STREET NAME', 'STREET_NAME', 'STREETNAME', 'STREET'].includes(h) && CI.STREET < 0) CI.STREET = i;
    else if (h === 'CITY' && CI.CITY < 0) CI.CITY = i;
    else if (['PHONE', 'PHONE #', 'PHONE#'].includes(h) && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'FO' && CI.FO < 0) CI.FO = i;
    else if (['PREVIOUS PRICE', 'PREVIOUS_PRICE', 'PREV PRICE', 'PRICE', 'SERVICE AMT', 'SERVICE_AMT'].includes(h) && CI.PRICE < 0) CI.PRICE = i;
    else if (['CONTRACTOR NAME', 'CONTRACTOR_NAME', 'CONTRACTORNAME', 'CONTRACTOR'].includes(h) && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
  }

  return CI;
}

// ─── STEP 1 — READ CALLBOOK ─────────────────────────────────────────────────

async function readCallbookForRoutes(
  callbookSheetId: string,
  routeCodes: Set<string>,
  onProgress?: (p: DmbPCLProgress) => void,
): Promise<Map<string, CallbookRow[]>> {
  const tabs = await dialerSheetsService.getCallbookTabs(callbookSheetId);
  const routeRows = new Map<string, CallbookRow[]>();

  for (let t = 0; t < tabs.length; t++) {
    const tabName = tabs[t];
    const pct = 10 + Math.round(((t + 1) / tabs.length) * 30);
    onProgress?.({ phase: 'Reading callbook', detail: `Tab "${tabName}"`, percent: pct });

    let rawData: any[][];
    try {
      rawData = await dialerSheetsService.sheetsGet(callbookSheetId, `'${tabName}'`);
    } catch {
      continue;
    }
    if (!rawData || rawData.length < 2) continue;

    const headerIdx = findHeaderRow(rawData);
    if (headerIdx === null) continue;

    const CI = resolveColumns(rawData[headerIdx]);
    if (CI.PHONE < 0 || CI.ROUTE_CODE < 0) continue;

    for (const row of rawData.slice(headerIdx + 1)) {
      if (!row || !row[0]) continue;

      const rc = cellVal(row, CI.ROUTE_CODE);
      if (!rc || !routeCodes.has(rc)) continue;

      const yearRaw = cellVal(row, CI.YEAR);
      const year = parseInt(yearRaw, 10);
      if (isNaN(year) || year < 2000) continue;

      const phone = normalizePhone(cellVal(row, CI.PHONE));

      const cbRow: CallbookRow = {
        routeCode: rc,
        firstName: cellVal(row, CI.FIRST),
        lastName: cellVal(row, CI.LAST),
        houseNum: cellVal(row, CI.HOUSE),
        streetName: cellVal(row, CI.STREET),
        city: cellVal(row, CI.CITY),
        phone,
        fo: cellVal(row, CI.FO),
        price: cellVal(row, CI.PRICE),
        contractor: cellVal(row, CI.CONTRACTOR),
        year,
      };

      if (!routeRows.has(rc)) routeRows.set(rc, []);
      routeRows.get(rc)!.push(cbRow);
    }
  }

  return routeRows;
}

// ─── STEP 2 — GROUP CLIENTS BY ADDRESS ───────────────────────────────────────

function groupClientsByAddress(rows: CallbookRow[]): ClientGroup[] {
  // Key = normalized houseNum|street
  const addrMap = new Map<string, CallbookRow[]>();

  for (const row of rows) {
    const key = `${row.houseNum.toLowerCase()}|${normalizeStreet(row.streetName)}`;
    if (!addrMap.has(key)) addrMap.set(key, []);
    addrMap.get(key)!.push(row);
  }

  const groups: ClientGroup[] = [];

  for (const addrRows of addrMap.values()) {
    // Most recent first
    addrRows.sort((a, b) => b.year - a.year);

    // ── Most common name (tie → most recent year) ──
    const nameCounts = new Map<string, { count: number; year: number; first: string; last: string }>();
    for (const r of addrRows) {
      const nk = `${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`;
      const ex = nameCounts.get(nk);
      if (ex) {
        ex.count++;
        if (r.year > ex.year) { ex.year = r.year; ex.first = r.firstName; ex.last = r.lastName; }
      } else {
        nameCounts.set(nk, { count: 1, year: r.year, first: r.firstName, last: r.lastName });
      }
    }
    let bestName = { first: addrRows[0].firstName, last: addrRows[0].lastName };
    let bestCount = 0;
    let bestYear = 0;
    for (const e of nameCounts.values()) {
      if (e.count > bestCount || (e.count === bestCount && e.year > bestYear)) {
        bestCount = e.count; bestYear = e.year;
        bestName = { first: e.first, last: e.last };
      }
    }

    // ── Most common phone (tie → most recent year) ──
    const phoneCounts = new Map<string, { count: number; year: number }>();
    for (const r of addrRows) {
      if (!r.phone) continue;
      const ex = phoneCounts.get(r.phone);
      if (ex) { ex.count++; if (r.year > ex.year) ex.year = r.year; }
      else phoneCounts.set(r.phone, { count: 1, year: r.year });
    }
    let bestPhone = '';
    let bpCount = 0;
    let bpYear = 0;
    for (const [ph, e] of phoneCounts) {
      if (e.count > bpCount || (e.count === bpCount && e.year > bpYear)) {
        bpCount = e.count; bpYear = e.year; bestPhone = ph;
      }
    }

    groups.push({
      firstName: bestName.first,
      lastName: bestName.last,
      houseNum: addrRows[0].houseNum,
      streetName: addrRows[0].streetName,
      phone: formatPhone(bestPhone),
      history: addrRows.map((r) => ({
        year: r.year,
        price: formatPrice(r.price),
        serviceType: interpretService(r.fo),
        contractor: r.contractor,
      })),
    });
  }

  // Sort: street → house number
  groups.sort((a, b) => {
    const stCmp = normalizeStreet(a.streetName).localeCompare(normalizeStreet(b.streetName));
    if (stCmp !== 0) return stCmp;
    return parseHouseNum(a.houseNum) - parseHouseNum(b.houseNum);
  });

  return groups;
}

// ─── STEP 3 — MAPBOX STATIC IMAGE ───────────────────────────────────────────

function simplifyCoords(
  segments: Array<{ coordinates: [number, number][] }>,
  maxTotal: number,
): [number, number][][] {
  let total = 0;
  segments.forEach((s) => (total += s.coordinates.length));

  if (total <= maxTotal) {
    return segments.map((s) => [...s.coordinates]);
  }

  const ratio = maxTotal / total;
  return segments.map((seg) => {
    const keep = Math.max(2, Math.round(seg.coordinates.length * ratio));
    const step = Math.max(1, Math.floor(seg.coordinates.length / keep));
    const out: [number, number][] = [];
    for (let i = 0; i < seg.coordinates.length; i += step) out.push(seg.coordinates[i]);
    const last = seg.coordinates[seg.coordinates.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  });
}

async function fetchRouteMapImage(
  segments: Array<{ coordinates: [number, number][] }>,
  mapboxToken: string,
  width: number,
  height: number,
): Promise<string | null> {
  let allCoords: [number, number][] = [];
  segments.forEach((s) => allCoords.push(...s.coordinates));
  if (allCoords.length === 0) return null;

  // Start with up to 200 points
  let simplified = simplifyCoords(segments, 200);

  const buildUrl = (segs: [number, number][][]): string => {
    const geojson = {
      type: 'FeatureCollection',
      features: segs.map((coords) => ({
        type: 'Feature',
        properties: { stroke: '#FFD700', 'stroke-width': 5, 'stroke-opacity': 0.9 },
        geometry: { type: 'LineString', coordinates: coords },
      })),
    };
    const encoded = encodeURIComponent(JSON.stringify(geojson));
    return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/geojson(${encoded})/auto/${width}x${height}@2x?padding=50&access_token=${mapboxToken}`;
  };

  let url = buildUrl(simplified);

  // If URL too long, simplify further
  if (url.length > 7500) {
    simplified = simplifyCoords(segments, 80);
    url = buildUrl(simplified);
  }
  if (url.length > 7500) {
    simplified = simplifyCoords(segments, 30);
    url = buildUrl(simplified);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToBase64(blob);
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── STEP 4 — PDF RENDERING ─────────────────────────────────────────────────

function drawBlockBorder(doc: jsPDF, side: 'left' | 'right'): void {
  const x = side === 'left' ? BLOCK_L_X : BLOCK_R_X;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER_W);
  doc.rect(x, MARGIN, BLOCK_W, BLOCK_H);
}

function drawMapBlock(
  doc: jsPDF,
  areaName: string,
  routeCode: string,
  mapImage: string | null,
): void {
  const x = BLOCK_L_X;

  // Outer border
  drawBlockBorder(doc, 'left');

  // ── Title bar ──
  const titleY = MARGIN + BORDER_W;
  const titleW = BLOCK_W - 2 * BORDER_W;

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(x + BORDER_W, titleY, titleW, TITLE_H, 'F');

  // Divider line below title
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER_W);
  doc.line(x + BORDER_W, titleY + TITLE_H, x + BLOCK_W - BORDER_W, titleY + TITLE_H);

  // Area name (bold, centered)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(areaName, x + BLOCK_W / 2, titleY + 12, { align: 'center' });

  // Route code (smaller, grey)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(85, 85, 85);
  doc.text(`Route ${routeCode}`, x + BLOCK_W / 2, titleY + 23, { align: 'center' });

  // ── Map image ──
  const imgX = x + BORDER_W;
  const imgY = titleY + TITLE_H;
  const imgW = titleW;
  const imgH = BLOCK_H - 2 * BORDER_W - TITLE_H;

  if (mapImage) {
    try {
      doc.addImage(mapImage, 'PNG', imgX, imgY, imgW, imgH);
    } catch {
      drawMapPlaceholder(doc, imgX, imgY, imgW, imgH, x);
    }
  } else {
    drawMapPlaceholder(doc, imgX, imgY, imgW, imgH, x);
  }
}

function drawMapPlaceholder(
  doc: jsPDF,
  imgX: number,
  imgY: number,
  imgW: number,
  imgH: number,
  blockX: number,
): void {
  doc.setFillColor(230, 230, 230);
  doc.rect(imgX, imgY, imgW, imgH, 'F');
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Map unavailable', blockX + BLOCK_W / 2, imgY + imgH / 2, { align: 'center' });
}

/** Height of one client group (header + history rows + gap). */
function clientGroupHeight(group: ClientGroup): number {
  return CLIENT_HEADER_H + group.history.length * HISTORY_ROW_H + CLIENT_GAP;
}

/**
 * Truncate text to fit within a pixel width estimate.
 * Rough glyph width: fontSize × 0.52 per character.
 */
function truncate(text: string, maxWidthPt: number, fontSize: number): string {
  const glyphW = fontSize * 0.52;
  const maxChars = Math.floor(maxWidthPt / glyphW);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 1) + '…';
}

function drawClientGroup(
  doc: jsPDF,
  group: ClientGroup,
  blockX: number,
  y: number,
): void {
  const innerX = blockX + BORDER_W + BLOCK_PAD;
  const contentW = BLOCK_W - 2 * BORDER_W - 2 * BLOCK_PAD;

  // ── Client header (grey row) ──
  doc.setFillColor(224, 224, 224);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(innerX, y, contentW, CLIENT_HEADER_H, 'FD');

  // Column proportions for the header
  const hCols = [
    contentW * 0.18,   // First
    contentW * 0.18,   // Last
    contentW * 0.10,   // House#
    contentW * 0.30,   // Street
    contentW * 0.24,   // Phone
  ];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(17, 17, 17);

  const hTextY = y + CLIENT_HEADER_H * 0.72;
  let cx = innerX + 3;

  doc.text(truncate(group.firstName, hCols[0] - 4, 6.5), cx, hTextY);
  cx += hCols[0];
  doc.text(truncate(group.lastName, hCols[1] - 4, 6.5), cx, hTextY);
  cx += hCols[1];
  doc.text(truncate(group.houseNum, hCols[2] - 4, 6.5), cx, hTextY);
  cx += hCols[2];
  doc.text(truncate(group.streetName, hCols[3] - 4, 6.5), cx, hTextY);
  cx += hCols[3];
  doc.text(truncate(group.phone, hCols[4] - 4, 6.5), cx, hTextY);

  // ── History rows (no sub-headers) ──
  const histCols = [
    contentW * 0.12,   // Year
    contentW * 0.18,   // Price
    contentW * 0.12,   // Service type
    contentW * 0.58,   // Contractor
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(51, 51, 51);

  let rowY = y + CLIENT_HEADER_H;

  for (const hist of group.history) {
    // Thin border
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.rect(innerX, rowY, contentW, HISTORY_ROW_H);

    const tY = rowY + HISTORY_ROW_H * 0.72;
    let hx = innerX + 3;

    doc.text(String(hist.year), hx, tY);
    hx += histCols[0];
    doc.text(hist.price, hx, tY);
    hx += histCols[1];
    doc.text(hist.serviceType, hx, tY);
    hx += histCols[2];
    doc.text(truncate(hist.contractor, histCols[3] - 6, 6), hx, tY);

    rowY += HISTORY_ROW_H;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateDmbPCL(
  areaName: string,
  routes: SavedRouteInput[],
  callbookSheetId: string,
  onProgress?: (progress: DmbPCLProgress) => void,
): Promise<DmbPCLResult> {
  if (routes.length === 0) {
    return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'No routes in this area.' };
  }

  const mapboxToken = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
  if (!mapboxToken) {
    return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'Mapbox token not configured.' };
  }

  // ── Auth ──
  if (!dialerSheetsService.isAuthenticated()) {
    onProgress?.({ phase: 'Authenticating', detail: 'Connecting to Google Sheets…', percent: 2 });
    try {
      const ok = await dialerSheetsService.authenticate();
      if (!ok) return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'Google Sheets auth cancelled.' };
    } catch (err: any) {
      return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'Auth failed: ' + (err.message || 'Unknown') };
    }
  }

  // ── Read callbook ──
  const routeCodeSet = new Set(routes.map((r) => r.route_code));
  onProgress?.({ phase: 'Reading callbook', detail: 'Loading tabs…', percent: 5 });

  const routeRowsMap = await readCallbookForRoutes(callbookSheetId, routeCodeSet, onProgress);

  // ── Group clients per route ──
  onProgress?.({ phase: 'Processing', detail: 'Grouping clients by address…', percent: 45 });
  await yieldUI();

  const sortedRoutes = [...routes].sort((a, b) => a.route_number - b.route_number);
  const routeDataList: RouteData[] = [];
  let totalClients = 0;

  for (const route of sortedRoutes) {
    const rows = routeRowsMap.get(route.route_code) || [];
    if (rows.length === 0) continue;

    const clients = groupClientsByAddress(rows);
    totalClients += clients.length;

    routeDataList.push({
      routeCode: route.route_code,
      routeNumber: route.route_number,
      segments: route.segments || [],
      clients,
    });
  }

  if (routeDataList.length === 0) {
    return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'No callbook data found for any routes in this area.' };
  }

  // ── Build PDF ──
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  let isFirstPage = true;

  // Mapbox image dimensions (request at half-block size; @2x doubles it)
  const mapReqW = Math.round((BLOCK_W - 2 * BORDER_W) / 2);
  const mapReqH = Math.round((BLOCK_H - 2 * BORDER_W - TITLE_H) / 2);

  for (let ri = 0; ri < routeDataList.length; ri++) {
    const rd = routeDataList[ri];
    const pct = 50 + Math.round(((ri + 1) / routeDataList.length) * 40);
    onProgress?.({ phase: 'Generating PDF', detail: `Route ${rd.routeCode} (${ri + 1}/${routeDataList.length})`, percent: pct });
    await yieldUI();

    // Fetch static map image
    const mapImage = await fetchRouteMapImage(rd.segments, mapboxToken, mapReqW, mapReqH);

    // ── First page for this route: map left, PCL right ──
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    drawMapBlock(doc, areaName, rd.routeCode, mapImage);
    drawBlockBorder(doc, 'right');

    // ── Render client groups, flowing across blocks / pages ──
    let side: 'left' | 'right' = 'right';
    let curY = contentTop();
    let ci = 0;

    while (ci < rd.clients.length) {
      const client = rd.clients[ci];
      const groupH = clientGroupHeight(client);

      // Does this group fit in the current block?
      if (curY + groupH > contentBottom() && curY > contentTop() + 10) {
        // Advance to next block
        if (side === 'right') {
          // New page — both blocks available
          doc.addPage();
          drawBlockBorder(doc, 'left');
          drawBlockBorder(doc, 'right');
          side = 'left';
        } else {
          side = 'right';
        }
        curY = contentTop();
      }

      drawClientGroup(doc, client, side === 'left' ? BLOCK_L_X : BLOCK_R_X, curY);
      curY += groupH;
      ci++;

      // Yield every 20 clients to keep the UI alive
      if (ci % 20 === 0) await yieldUI();
    }
  }

  // ── Download ──
  onProgress?.({ phase: 'Downloading', detail: 'Saving PDF…', percent: 97 });
  await yieldUI();

  const today = new Date();
  const dateStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const safeName = areaName.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`DMB_PCL_${safeName}_${dateStr}.pdf`);

  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });

  return { success: true, totalClients, routeCount: routeDataList.length };
}

// ─── TINY UTILITIES ──────────────────────────────────────────────────────────

function contentTop(): number {
  return MARGIN + BORDER_W + BLOCK_PAD;
}

function contentBottom(): number {
  return MARGIN + BLOCK_H - BORDER_W - BLOCK_PAD;
}

/** Let the browser paint / keep the tab responsive. */
function yieldUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}