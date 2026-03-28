// src/lib/dmbPclService.ts
//
// Digital Master Bookings — PCL PDF Generator
//
// Generates a single landscape PDF for an area's routes.
// Each route starts with a GREYSCALE map (yellow route preserved) followed
// by client history tables in a two-column layout.
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
import mapboxgl from 'mapbox-gl';

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

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 14;
const GAP = 8;
const BORDER_W = 1.5;

const BLOCK_W = (PAGE_W - 2 * MARGIN - GAP) / 2;
const BLOCK_H = PAGE_H - 2 * MARGIN;
const BLOCK_L_X = MARGIN;
const BLOCK_R_X = MARGIN + BLOCK_W + GAP;

const TITLE_H = 30;
const BLOCK_PAD = 6;

const CLIENT_HEADER_H = 13;
const HISTORY_ROW_H = 10;
const CLIENT_GAP = 4;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  let s = String(raw ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function formatPhone(digits: string): string {
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
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
  ROUTE_CODE: number; FIRST: number; LAST: number; HOUSE: number;
  STREET: number; CITY: number; PHONE: number; FO: number;
  PRICE: number; CONTRACTOR: number; YEAR: number;
}

function resolveColumns(headers: any[]): ColumnIndices {
  const CI: ColumnIndices = {
    ROUTE_CODE: -1, FIRST: -1, LAST: -1, HOUSE: -1, STREET: -1,
    CITY: -1, PHONE: -1, FO: -1, PRICE: -1, CONTRACTOR: -1, YEAR: -1,
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
  callbookSheetId: string, routeCodes: Set<string>,
  onProgress?: (p: DmbPCLProgress) => void,
): Promise<Map<string, CallbookRow[]>> {
  const tabs = await dialerSheetsService.getCallbookTabs(callbookSheetId);
  const routeRows = new Map<string, CallbookRow[]>();
  for (let t = 0; t < tabs.length; t++) {
    const tabName = tabs[t];
    const pct = 10 + Math.round(((t + 1) / tabs.length) * 30);
    onProgress?.({ phase: 'Reading callbook', detail: `Tab "${tabName}"`, percent: pct });
    let rawData: any[][];
    try { rawData = await dialerSheetsService.sheetsGet(callbookSheetId, `'${tabName}'`); } catch { continue; }
    if (!rawData || rawData.length < 2) continue;
    const headerIdx = findHeaderRow(rawData);
    if (headerIdx === null) continue;
    const CI = resolveColumns(rawData[headerIdx]);
    if (CI.PHONE < 0 || CI.ROUTE_CODE < 0) continue;
    for (const row of rawData.slice(headerIdx + 1)) {
      if (!row || !row[0]) continue;
      const rc = cellVal(row, CI.ROUTE_CODE);
      if (!rc || !routeCodes.has(rc)) continue;
      const year = parseInt(cellVal(row, CI.YEAR), 10);
      if (isNaN(year) || year < 2000) continue;
      const cbRow: CallbookRow = {
        routeCode: rc, firstName: cellVal(row, CI.FIRST), lastName: cellVal(row, CI.LAST),
        houseNum: cellVal(row, CI.HOUSE), streetName: cellVal(row, CI.STREET), city: cellVal(row, CI.CITY),
        phone: normalizePhone(cellVal(row, CI.PHONE)), fo: cellVal(row, CI.FO),
        price: cellVal(row, CI.PRICE), contractor: cellVal(row, CI.CONTRACTOR), year,
      };
      if (!routeRows.has(rc)) routeRows.set(rc, []);
      routeRows.get(rc)!.push(cbRow);
    }
  }
  return routeRows;
}

// ─── STEP 2 — GROUP CLIENTS BY ADDRESS ───────────────────────────────────────

function groupClientsByAddress(rows: CallbookRow[]): ClientGroup[] {
  const addrMap = new Map<string, CallbookRow[]>();
  for (const row of rows) {
    const key = `${row.houseNum.toLowerCase()}|${normalizeStreet(row.streetName)}`;
    if (!addrMap.has(key)) addrMap.set(key, []);
    addrMap.get(key)!.push(row);
  }
  const groups: ClientGroup[] = [];
  for (const addrRows of addrMap.values()) {
    addrRows.sort((a, b) => b.year - a.year);
    const nameCounts = new Map<string, { count: number; year: number; first: string; last: string }>();
    for (const r of addrRows) {
      const nk = `${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`;
      const ex = nameCounts.get(nk);
      if (ex) { ex.count++; if (r.year > ex.year) { ex.year = r.year; ex.first = r.firstName; ex.last = r.lastName; } }
      else nameCounts.set(nk, { count: 1, year: r.year, first: r.firstName, last: r.lastName });
    }
    let bestName = { first: addrRows[0].firstName, last: addrRows[0].lastName };
    let bestCount = 0; let bestYear = 0;
    for (const e of nameCounts.values()) {
      if (e.count > bestCount || (e.count === bestCount && e.year > bestYear)) {
        bestCount = e.count; bestYear = e.year; bestName = { first: e.first, last: e.last };
      }
    }
    const phoneCounts = new Map<string, { count: number; year: number }>();
    for (const r of addrRows) {
      if (!r.phone) continue;
      const ex = phoneCounts.get(r.phone);
      if (ex) { ex.count++; if (r.year > ex.year) ex.year = r.year; }
      else phoneCounts.set(r.phone, { count: 1, year: r.year });
    }
    let bestPhone = ''; let bpCount = 0; let bpYear = 0;
    for (const [ph, e] of phoneCounts) {
      if (e.count > bpCount || (e.count === bpCount && e.year > bpYear)) { bpCount = e.count; bpYear = e.year; bestPhone = ph; }
    }
    groups.push({
      firstName: bestName.first, lastName: bestName.last,
      houseNum: addrRows[0].houseNum, streetName: addrRows[0].streetName,
      phone: formatPhone(bestPhone),
      history: addrRows.map((r) => ({ year: r.year, price: formatPrice(r.price), serviceType: interpretService(r.fo), contractor: r.contractor })),
    });
  }
  groups.sort((a, b) => {
    const stCmp = normalizeStreet(a.streetName).localeCompare(normalizeStreet(b.streetName));
    if (stCmp !== 0) return stCmp;
    return parseHouseNum(a.houseNum) - parseHouseNum(b.houseNum);
  });
  return groups;
}

// ─── STEP 3 — OFF-SCREEN MAPBOX GL RENDERER ─────────────────────────────────

function applyMapStyling(map: mapboxgl.Map): void {
  const HIDE_LIST = ['poi-label', 'housenum-label', 'road-number-shield'];
  HIDE_LIST.forEach((id) => {
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
      id.includes('housenum') || id.includes('house-num') ||
      id.includes('house_num') || id.includes('address') || id.includes('housenumber');
    const textField = JSON.stringify(layer.layout?.['text-field'] ?? '');
    const fieldIsHouseNum =
      textField.includes('housenumber') || textField.includes('house_num') ||
      textField.includes('addr') || textField.includes('ref');
    const isNotRoadLabel =
      !id.includes('label') && !id.includes('shield') &&
      !id.includes('motorway') && !id.includes('road') && !id.includes('street');
    if (idIsHouseNum || fieldIsHouseNum || isNotRoadLabel) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  });

  const roadLabelLayers = map.getStyle().layers?.filter((layer: any) =>
    layer.type === 'symbol' && layer.id.toLowerCase().includes('label') &&
    !HIDE_LIST.includes(layer.id)
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
        ...((layer as any).filter ? { filter: (layer as any).filter } : {}),
        minzoom: 0, maxzoom: 24,
        layout: {
          ...(layer.layout ?? {}),
          'symbol-placement': 'point',
          'text-optional': true,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-padding': 5, 'text-size': 11,
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
}

function greyscalePreservingYellow(dataUrl: string, width: number, height: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const px = imageData.data;

      for (let i = 0; i < px.length; i += 4) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const isYellow = r > 200 && g > 160 && b < 80;
        if (!isYellow) {
          const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          px[i] = grey;
          px[i + 1] = grey;
          px[i + 2] = grey;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function renderRouteMapOffscreen(
  segments: Array<{ coordinates: [number, number][] }>,
  pixelWidth: number,
  pixelHeight: number,
): Promise<string | null> {
  const allCoords: [number, number][] = [];
  segments.forEach((s) => allCoords.push(...s.coordinates));
  if (allCoords.length === 0) return null;

  return new Promise<string | null>((resolve) => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0px';
    container.style.left = '0px';
    container.style.width = `${pixelWidth}px`;
    container.style.height = `${pixelHeight}px`;
    container.style.zIndex = '-1';
    container.style.pointerEvents = 'none';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);

    let resolved = false;
    const finish = async (m: mapboxgl.Map, url: string | null) => {
      if (resolved) return;
      resolved = true;
      try { m.remove(); } catch { /* ok */ }
      try { document.body.removeChild(container); } catch { /* ok */ }
      if (url && url.length > 1000) {
        const processed = await greyscalePreservingYellow(url, pixelWidth, pixelHeight);
        resolve(processed);
      } else {
        resolve(null);
      }
    };

    mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';

    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: allCoords[0],
      zoom: 14,
      preserveDrawingBuffer: true,
      attributionControl: false,
      interactive: false,
    });

    const timeout = setTimeout(() => {
      console.warn('[DMB PCL] Map render timed out after 30s');
      try {
        map.triggerRepaint();
        setTimeout(() => {
          try { finish(map, map.getCanvas().toDataURL('image/png')); }
          catch { finish(map, null); }
        }, 200);
      } catch { finish(map, null); }
    }, 30000);

    map.on('load', () => {
      applyMapStyling(map);

      const routeInsertBefore = (
        map.getLayer('road-label') ? 'road-label' :
        map.getStyle().layers?.find((l: any) => l.type === 'symbol')?.id
      ) ?? undefined;

      const features: GeoJSON.Feature[] = segments.map((seg) => ({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: seg.coordinates },
      }));

      map.addSource('pcl-route-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: 'pcl-route-line', type: 'line', source: 'pcl-route-src',
        paint: { 'line-color': '#FFD700', 'line-width': 7, 'line-opacity': 0.9 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      }, routeInsertBefore);

      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
      );
      map.fitBounds(bounds, { padding: 40, duration: 0 });

      map.once('idle', () => {
        setTimeout(() => {
          map.triggerRepaint();
          map.once('render', () => {
            setTimeout(() => {
              clearTimeout(timeout);
              try { finish(map, map.getCanvas().toDataURL('image/png')); }
              catch (err) {
                console.error('[DMB PCL] toDataURL failed:', err);
                finish(map, null);
              }
            }, 300);
          });
        }, 2000);
      });
    });
  });
}

// ─── STEP 4 — PDF RENDERING ─────────────────────────────────────────────────

function drawBlockBorder(doc: jsPDF, side: 'left' | 'right'): void {
  const x = side === 'left' ? BLOCK_L_X : BLOCK_R_X;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER_W);
  doc.rect(x, MARGIN, BLOCK_W, BLOCK_H);
}

function drawMapBlock(doc: jsPDF, areaName: string, routeCode: string, mapImage: string | null): void {
  const x = BLOCK_L_X;
  drawBlockBorder(doc, 'left');
  const titleY = MARGIN + BORDER_W;
  const titleW = BLOCK_W - 2 * BORDER_W;
  doc.setFillColor(255, 255, 255);
  doc.rect(x + BORDER_W, titleY, titleW, TITLE_H, 'F');
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(BORDER_W);
  doc.line(x + BORDER_W, titleY + TITLE_H, x + BLOCK_W - BORDER_W, titleY + TITLE_H);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(areaName, x + BLOCK_W / 2, titleY + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(85, 85, 85);
  doc.text(`Route ${routeCode}`, x + BLOCK_W / 2, titleY + 23, { align: 'center' });
  const imgX = x + BORDER_W;
  const imgY = titleY + TITLE_H;
  const imgW = titleW;
  const imgH = BLOCK_H - 2 * BORDER_W - TITLE_H;
  if (mapImage) {
    try { doc.addImage(mapImage, 'PNG', imgX, imgY, imgW, imgH); }
    catch { drawMapPlaceholder(doc, imgX, imgY, imgW, imgH, x); }
  } else {
    drawMapPlaceholder(doc, imgX, imgY, imgW, imgH, x);
  }
  doc.setFontSize(4);
  doc.setTextColor(160, 160, 160);
  doc.text('\u00A9 Mapbox \u00A9 OpenStreetMap', x + BLOCK_W - BORDER_W - 3, MARGIN + BLOCK_H - BORDER_W - 2, { align: 'right' });
}

function drawMapPlaceholder(doc: jsPDF, imgX: number, imgY: number, imgW: number, imgH: number, blockX: number): void {
  doc.setFillColor(230, 230, 230);
  doc.rect(imgX, imgY, imgW, imgH, 'F');
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Map unavailable', blockX + BLOCK_W / 2, imgY + imgH / 2, { align: 'center' });
}

function clientGroupHeight(group: ClientGroup): number {
  return CLIENT_HEADER_H + group.history.length * HISTORY_ROW_H + CLIENT_GAP;
}

function truncate(text: string, maxWidthPt: number, fontSize: number): string {
  const glyphW = fontSize * 0.52;
  const maxChars = Math.floor(maxWidthPt / glyphW);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 1) + '\u2026';
}

function drawClientGroup(doc: jsPDF, group: ClientGroup, blockX: number, y: number): void {
  const innerX = blockX + BORDER_W + BLOCK_PAD;
  const contentW = BLOCK_W - 2 * BORDER_W - 2 * BLOCK_PAD;
  doc.setFillColor(224, 224, 224);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(innerX, y, contentW, CLIENT_HEADER_H, 'FD');
  const hCols = [contentW * 0.18, contentW * 0.18, contentW * 0.10, contentW * 0.30, contentW * 0.24];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(17, 17, 17);
  const hTextY = y + CLIENT_HEADER_H * 0.72;
  let cx = innerX + 3;
  doc.text(truncate(group.firstName, hCols[0] - 4, 6.5), cx, hTextY); cx += hCols[0];
  doc.text(truncate(group.lastName, hCols[1] - 4, 6.5), cx, hTextY); cx += hCols[1];
  doc.text(truncate(group.houseNum, hCols[2] - 4, 6.5), cx, hTextY); cx += hCols[2];
  doc.text(truncate(group.streetName, hCols[3] - 4, 6.5), cx, hTextY); cx += hCols[3];
  doc.text(truncate(group.phone, hCols[4] - 4, 6.5), cx, hTextY);
  const histCols = [contentW * 0.12, contentW * 0.18, contentW * 0.12, contentW * 0.58];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(51, 51, 51);
  let rowY = y + CLIENT_HEADER_H;
  for (const hist of group.history) {
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.rect(innerX, rowY, contentW, HISTORY_ROW_H);
    const tY = rowY + HISTORY_ROW_H * 0.72;
    let hx = innerX + 3;
    doc.text(String(hist.year), hx, tY); hx += histCols[0];
    doc.text(hist.price, hx, tY); hx += histCols[1];
    doc.text(hist.serviceType, hx, tY); hx += histCols[2];
    doc.text(truncate(hist.contractor, histCols[3] - 6, 6), hx, tY);
    rowY += HISTORY_ROW_H;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateDmbPCL(
  areaName: string, routes: SavedRouteInput[], callbookSheetId: string,
  onProgress?: (progress: DmbPCLProgress) => void,
): Promise<DmbPCLResult> {
  if (routes.length === 0) return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'No routes in this area.' };

  if (!dialerSheetsService.isAuthenticated()) {
    onProgress?.({ phase: 'Authenticating', detail: 'Connecting to Google Sheets\u2026', percent: 2 });
    try {
      const ok = await dialerSheetsService.authenticate();
      if (!ok) return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'Google Sheets auth cancelled.' };
    } catch (err: any) {
      return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'Auth failed: ' + (err.message || 'Unknown') };
    }
  }

  const routeCodeSet = new Set(routes.map((r) => r.route_code));
  onProgress?.({ phase: 'Reading callbook', detail: 'Loading tabs\u2026', percent: 5 });
  const routeRowsMap = await readCallbookForRoutes(callbookSheetId, routeCodeSet, onProgress);

  onProgress?.({ phase: 'Processing', detail: 'Grouping clients by address\u2026', percent: 45 });
  await yieldUI();

  const sortedRoutes = [...routes].sort((a, b) => a.route_number - b.route_number);
  const routeDataList: RouteData[] = [];
  let totalClients = 0;
  for (const route of sortedRoutes) {
    const rows = routeRowsMap.get(route.route_code) || [];
    const clients = rows.length > 0 ? groupClientsByAddress(rows) : [];
    totalClients += clients.length;
    routeDataList.push({ routeCode: route.route_code, routeNumber: route.route_number, segments: route.segments || [], clients });
  }
  if (routeDataList.length === 0) return { success: false, totalClients: 0, routeCount: 0, errorMessage: 'No routes found in this area.' };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  let isFirstPage = true;
  const mapPixelW = 500;
  const mapPixelH = 730;

  for (let ri = 0; ri < routeDataList.length; ri++) {
    const rd = routeDataList[ri];
    const pct = 50 + Math.round(((ri + 1) / routeDataList.length) * 40);
    onProgress?.({ phase: 'Generating PDF', detail: `Route ${rd.routeCode} \u2014 rendering map (${ri + 1}/${routeDataList.length})`, percent: pct });
    await yieldUI();
    if (ri === 0) await new Promise(r => setTimeout(r, 1000));
    const mapImage = await renderRouteMapOffscreen(rd.segments, mapPixelW, mapPixelH);
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;
    drawMapBlock(doc, areaName, rd.routeCode, mapImage);
    drawBlockBorder(doc, 'right');
    let side: 'left' | 'right' = 'right';
    let curY = contentTop();
    let ci = 0;
    while (ci < rd.clients.length) {
      const client = rd.clients[ci];
      const groupH = clientGroupHeight(client);
      if (curY + groupH > contentBottom() && curY > contentTop() + 10) {
        if (side === 'right') {
          doc.addPage();
          drawBlockBorder(doc, 'left');
          drawBlockBorder(doc, 'right');
          side = 'left';
        } else { side = 'right'; }
        curY = contentTop();
      }
      drawClientGroup(doc, client, side === 'left' ? BLOCK_L_X : BLOCK_R_X, curY);
      curY += groupH;
      ci++;
      if (ci % 20 === 0) await yieldUI();
    }
  }

  onProgress?.({ phase: 'Downloading', detail: 'Saving PDF\u2026', percent: 97 });
  await yieldUI();
  const today = new Date();
  const dateStr = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  doc.save(`DMB_PCL_${areaName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}.pdf`);
  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });
  return { success: true, totalClients, routeCount: routeDataList.length };
}

// ─── TINY UTILITIES ──────────────────────────────────────────────────────────

function contentTop(): number { return MARGIN + BORDER_W + BLOCK_PAD; }
function contentBottom(): number { return MARGIN + BLOCK_H - BORDER_W - BLOCK_PAD; }
function yieldUI(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }



// ═══════════════════════════════════════════════════════════════════════════════
// MASTERMAP — Full-area legal landscape PDF with all routes, bookings, sidebar
//
// Custom road label system:  Mapbox renders roads + routes + dots with NO text.
// We then draw street names ourselves, character-by-character along road curves.
// Three-pass approach: inline → offset → numbered legend.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── MASTERMAP TYPES ─────────────────────────────────────────────────────────

export interface MastermapBookingInput {
  lat: number;
  lng: number;
  routeColor: string;
}

export interface MastermapResult {
  success: boolean;
  routeCount: number;
  bookingCount: number;
  errorMessage?: string;
}

interface LegendEntry {
  number: number;
  streetName: string;
}

interface MastermapRenderResult {
  imageDataUrl: string;
  legendEntries: LegendEntry[];
}

interface RoadPath {
  name: string;
  roadClass: string;
  pixelPath: { x: number; y: number }[];
  pathLength: number;
}

// ─── MASTERMAP CONSTANTS ─────────────────────────────────────────────────────

const LEGAL_W = 1008;   // 14" in pt
const LEGAL_H = 612;    // 8.5" in pt
const MM_MARGIN = 12;

// ─── OPTIMAL BEARING — rotate map to minimize wasted space ───────────────────

function calculateOptimalBearing(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const cosLat = Math.cos(cy * Math.PI / 180);
  let bestBearing = 0;
  let bestArea = Infinity;
  for (let deg = 0; deg < 180; deg++) {
    const rad = deg * Math.PI / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lng, lat] of coords) {
      const dx = (lng - cx) * cosLat;
      const dy = lat - cy;
      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; bestBearing = deg; }
  }
  return bestBearing;
}

// ─── GREYSCALE BASE — recolor water/parks at Mapbox style level ──────────────

function applyGreyscaleBase(map: mapboxgl.Map): void {
  map.getStyle().layers?.forEach((layer: any) => {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === 'fill') {
        if (id.includes('water')) map.setPaintProperty(layer.id, 'fill-color', '#d0d0d0');
        else if (id.includes('landuse') || id.includes('park') || id.includes('national')) map.setPaintProperty(layer.id, 'fill-color', '#e8e8e8');
        else if (id.includes('land') && !id.includes('label')) map.setPaintProperty(layer.id, 'fill-color', '#f2f2f2');
      } else if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', '#f5f5f5');
      }
    } catch { /* skip */ }
  });
}

// ─── THICKEN ROADS for print legibility ──────────────────────────────────────

function thickenMastermapRoads(map: mapboxgl.Map): void {
  map.getStyle().layers?.forEach((layer: any) => {
    if (layer.type !== 'line') return;
    const id = layer.id.toLowerCase();
    if (id.startsWith('mm-') || id.startsWith('pcl-')) return;
    try {
      if (id.includes('motorway') || id.includes('trunk')) {
        map.setPaintProperty(layer.id, 'line-width', 28);
      } else if (id.includes('primary') || id.includes('secondary')) {
        map.setPaintProperty(layer.id, 'line-width', 20);
      } else if (id.includes('street') || id.includes('tertiary') || id.includes('minor') || id.includes('road')) {
        map.setPaintProperty(layer.id, 'line-width', 12);
      }
    } catch { /* skip */ }
  });
}

// ─── HIDE ALL MAPBOX LABELS — we draw our own ───────────────────────────────

function hideMapboxLabels(map: mapboxgl.Map): void {
  map.getStyle().layers?.forEach((layer: any) => {
    if (layer.type !== 'symbol') return;
    if (layer.id.startsWith('mm-')) return; // keep our route number labels
    try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch { /* skip */ }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM ROAD LABEL SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Occupancy grid for collision detection ──────────────────────────────────

class OccupancyGrid {
  private cells = new Set<string>();
  constructor(private cellSize: number = 8) {}

  isOccupied(x: number, y: number, w: number, h: number): boolean {
    const x1 = Math.floor(x / this.cellSize);
    const y1 = Math.floor(y / this.cellSize);
    const x2 = Math.floor((x + w) / this.cellSize);
    const y2 = Math.floor((y + h) / this.cellSize);
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++)
        if (this.cells.has(`${cx},${cy}`)) return true;
    return false;
  }

  occupy(x: number, y: number, w: number, h: number): void {
    const x1 = Math.floor(x / this.cellSize);
    const y1 = Math.floor(y / this.cellSize);
    const x2 = Math.floor((x + w) / this.cellSize);
    const y2 = Math.floor((y + h) / this.cellSize);
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++)
        this.cells.add(`${cx},${cy}`);
  }
}

// ─── Path utility functions ──────────────────────────────────────────────────

function pDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function measurePath(path: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += pDist(path[i - 1], path[i]);
  return len;
}

function getPointAtDistance(
  path: { x: number; y: number }[],
  dist: number,
): { x: number; y: number; angle: number } {
  if (path.length < 2) return { x: path[0]?.x || 0, y: path[0]?.y || 0, angle: 0 };

  let remaining = dist;
  for (let i = 1; i < path.length; i++) {
    const segLen = pDist(path[i - 1], path[i]);
    if (remaining <= segLen || i === path.length - 1) {
      const t = segLen > 0 ? Math.min(remaining / segLen, 1) : 0;
      return {
        x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
        y: path[i - 1].y + t * (path[i].y - path[i - 1].y),
        angle: Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x),
      };
    }
    remaining -= segLen;
  }

  // Extrapolate beyond path end
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  return { x: last.x + Math.cos(angle) * remaining, y: last.y + Math.sin(angle) * remaining, angle };
}

function getSubPath(
  path: { x: number; y: number }[],
  startDist: number,
  endDist: number,
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  let dist = 0;
  let started = false;

  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      const segLen = pDist(path[i - 1], path[i]);
      const newDist = dist + segLen;

      if (!started && newDist >= startDist) {
        const t = segLen > 0 ? (startDist - dist) / segLen : 0;
        result.push({
          x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
          y: path[i - 1].y + t * (path[i].y - path[i - 1].y),
        });
        started = true;
      }

      if (started) {
        if (newDist >= endDist) {
          const t = segLen > 0 ? (endDist - dist) / segLen : 0;
          result.push({
            x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
            y: path[i - 1].y + t * (path[i].y - path[i - 1].y),
          });
          break;
        }
        result.push({ x: path[i].x, y: path[i].y });
      }
      dist = newDist;
    } else if (startDist === 0) {
      result.push({ x: path[i].x, y: path[i].y });
      started = true;
    }
  }
  return result;
}

/** Ensure path goes left-to-right so text reads naturally. */
function ensureLeftToRight(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length < 2) return path;
  return path[path.length - 1].x >= path[0].x ? path : [...path].reverse();
}

// ─── Merge connected road segments by proximity ──────────────────────────────

function mergePixelSegments(
  segments: { x: number; y: number }[][],
  threshold: number,
): { x: number; y: number }[][] {
  if (segments.length === 0) return [];
  const merged: { x: number; y: number }[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let current = [...segments[i]];
    let changed = true;

    while (changed) {
      changed = false;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j];
        const cEnd = current[current.length - 1];
        const cStart = current[0];

        if (pDist(cEnd, seg[0]) < threshold) {
          current = [...current, ...seg.slice(1)];
          used.add(j); changed = true;
        } else if (pDist(cEnd, seg[seg.length - 1]) < threshold) {
          current = [...current, ...[...seg].reverse().slice(1)];
          used.add(j); changed = true;
        } else if (pDist(cStart, seg[seg.length - 1]) < threshold) {
          current = [...seg, ...current.slice(1)];
          used.add(j); changed = true;
        } else if (pDist(cStart, seg[0]) < threshold) {
          current = [...[...seg].reverse(), ...current.slice(1)];
          used.add(j); changed = true;
        }
      }
    }
    merged.push(current);
  }
  return merged;
}

// ─── Query roads from Mapbox and group by name ──────────────────────────────

function queryAndGroupRoads(map: mapboxgl.Map): RoadPath[] {
  const roadLayerIds: string[] = [];
  map.getStyle().layers?.forEach((layer: any) => {
    if (layer.type !== 'line') return;
    const id = layer.id.toLowerCase();
    if (id.startsWith('mm-') || id.startsWith('pcl-')) return;
    if (id.includes('road') || id.includes('street') || id.includes('bridge') || id.includes('tunnel')) {
      roadLayerIds.push(layer.id);
    }
  });
  if (!roadLayerIds.length) return [];

  const features = map.queryRenderedFeatures(undefined, { layers: roadLayerIds });

  // Group by name
  const byName = new Map<string, { coords: [number, number][][]; roadClass: string }>();
  for (const f of features) {
    const name = ((f.properties as any)?.name_en || (f.properties as any)?.name || '').trim();
    if (!name) continue;
    const roadClass = (f.properties as any)?.class || 'street';
    const geom = f.geometry as any;
    let lineCoords: [number, number][][] = [];
    if (geom.type === 'LineString') lineCoords = [geom.coordinates];
    else if (geom.type === 'MultiLineString') lineCoords = geom.coordinates;
    if (!byName.has(name)) byName.set(name, { coords: [], roadClass });
    byName.get(name)!.coords.push(...lineCoords);
  }

  // Convert to pixel coords, deduplicate, merge segments, build RoadPath objects
  const results: RoadPath[] = [];
  for (const [name, data] of byName) {
    const pixelSegments = data.coords.map((coords) =>
      coords.map(([lng, lat]) => {
        const p = map.project([lng, lat]);
        return { x: p.x, y: p.y };
      })
    );

    // Deduplicate: skip segments whose start+end are within 3px of an existing one
    const deduped: { x: number; y: number }[][] = [];
    for (const seg of pixelSegments) {
      if (seg.length < 2) continue;
      const isDup = deduped.some((existing) => {
        if (existing.length < 2) return false;
        const sameDir = pDist(seg[0], existing[0]) < 3 && pDist(seg[seg.length - 1], existing[existing.length - 1]) < 3;
        const reverseDir = pDist(seg[0], existing[existing.length - 1]) < 3 && pDist(seg[seg.length - 1], existing[0]) < 3;
        return sameDir || reverseDir;
      });
      if (!isDup) deduped.push(seg);
    }

    const merged = mergePixelSegments(deduped, 20);
    for (const path of merged) {
      const pl = measurePath(path);
      if (pl < 10) continue;
      results.push({
        name,
        roadClass: data.roadClass,
        pixelPath: ensureLeftToRight(path),
        pathLength: pl,
      });
    }
  }

  // Sort by path length descending — major/long roads get label priority
  results.sort((a, b) => b.pathLength - a.pathLength);
  return results;
}

// ─── Font size by road class ─────────────────────────────────────────────────

function getFontSize(roadClass: string): number {
  if (roadClass === 'motorway' || roadClass === 'trunk') return 48;
  if (roadClass === 'primary' || roadClass === 'secondary') return 38;
  return 28;
}

// ─── PASS 1: Draw text curving along road path, character by character ───────

function drawTextAlongPath(
  ctx: CanvasRenderingContext2D,
  text: string,
  path: { x: number; y: number }[],
  fontSize: number,
  grid: OccupancyGrid,
): boolean {
  ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const chars = [...text];
  const charWidths = chars.map((c) => ctx.measureText(c).width);
  const totalWidth = charWidths.reduce((a, b) => a + b, 0);
  const pathLen = measurePath(path);

  // Center text along path (text can extend beyond short paths)
  const startDist = Math.max(0, (pathLen - totalWidth) / 2);

  // Pre-calculate character positions
  const positions: { x: number; y: number; angle: number; w: number }[] = [];
  let dist = startDist;
  for (let i = 0; i < chars.length; i++) {
    const pos = getPointAtDistance(path, dist + charWidths[i] / 2);
    positions.push({ ...pos, w: charWidths[i] });
    dist += charWidths[i];
  }

  // Collision check — test each character's bounding box
  const pad = 2;
  for (const cp of positions) {
    const hw = cp.w / 2 + pad;
    const hh = fontSize / 2 + pad;
    if (grid.isOccupied(cp.x - hw, cp.y - hh, cp.w + pad * 2, fontSize + pad * 2)) {
      return false;
    }
  }

  // No collision — draw characters with halo + fill
  for (let i = 0; i < chars.length; i++) {
    const cp = positions[i];
    ctx.save();
    ctx.translate(cp.x, cp.y);

    // Normalize angle to [-π/2, π/2] so characters never render upside down
    let angle = cp.angle;
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    ctx.rotate(angle);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(4, fontSize * 0.18);
    ctx.lineJoin = 'round';
    ctx.strokeText(chars[i], 0, 0);

    ctx.fillStyle = '#111111';
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();

    // Mark occupied
    const hw = cp.w / 2 + pad;
    const hh = fontSize / 2 + pad;
    grid.occupy(cp.x - hw, cp.y - hh, cp.w + pad * 2, fontSize + pad * 2);
  }

  return true;
}

// ─── PASS 2: Offset label — shifted perpendicular to road ────────────────────

function drawOffsetLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  path: { x: number; y: number }[],
  fontSize: number,
  grid: OccupancyGrid,
  offset: number,
): boolean {
  const pathLen = measurePath(path);
  const mid = getPointAtDistance(path, pathLen / 2);

  // Ensure readable angle (not upside down)
  let angle = mid.angle;
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;

  ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
  const tw = ctx.measureText(text).width;

  // Try both sides (above and below the road)
  for (const sign of [1, -1]) {
    const perpAngle = mid.angle + (Math.PI / 2) * sign;
    const ox = mid.x + Math.cos(perpAngle) * offset;
    const oy = mid.y + Math.sin(perpAngle) * offset;

    if (grid.isOccupied(ox - tw / 2 - 2, oy - fontSize / 2 - 2, tw + 4, fontSize + 4)) {
      continue;
    }

    // Draw
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(angle);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(4, fontSize * 0.18);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = '#333333';
    ctx.fillText(text, 0, 0);
    ctx.restore();

    grid.occupy(ox - tw / 2 - 2, oy - fontSize / 2 - 2, tw + 4, fontSize + 4);
    return true;
  }

  return false;
}

// ─── PASS 3: Legend numbered marker on map ───────────────────────────────────

function drawLegendMarker(
  ctx: CanvasRenderingContext2D,
  num: number,
  x: number,
  y: number,
  grid: OccupancyGrid,
): boolean {
  const r = 14;
  // Try the point and nearby offsets
  for (const [dx, dy] of [[0, 0], [0, -20], [0, 20], [-20, 0], [20, 0]]) {
    const px = x + dx;
    const py = y + dy;
    if (grid.isOccupied(px - r, py - r, r * 2, r * 2)) continue;

    // White circle with black border
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Number inside
    ctx.font = `bold ${r}px Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    ctx.fillText(String(num), px, py);

    grid.occupy(px - r, py - r, r * 2, r * 2);
    return true;
  }
  return false;
}

// ─── MAIN 3-PASS LABELING ────────────────────────────────────────────────────

function labelRoadsThreePass(
  ctx: CanvasRenderingContext2D,
  roads: RoadPath[],
): LegendEntry[] {
  const grid = new OccupancyGrid(8);
  const legendEntries: LegendEntry[] = [];
  let legendNum = 1;

  // Track which names have been labeled (name → # of labels placed)
  const labeledNames = new Map<string, number>();
  const REPEAT_INTERVAL = 600; // label every 600px on long roads

  for (const road of roads) {
    const fontSize = getFontSize(road.roadClass);
    const currentCount = labeledNames.get(road.name) || 0;

    // Allow repeats on long roads
    const maxLabels = Math.max(1, Math.floor(road.pathLength / REPEAT_INTERVAL));
    if (currentCount >= maxLabels) continue;

    const numPlacements = Math.min(
      maxLabels - currentCount,
      Math.max(1, Math.floor(road.pathLength / REPEAT_INTERVAL)),
    );

    for (let p = 0; p < numPlacements; p++) {
      const segStart = (road.pathLength / numPlacements) * p;
      const segEnd = (road.pathLength / numPlacements) * (p + 1);
      const subPath = getSubPath(road.pixelPath, segStart, segEnd);
      if (subPath.length < 2) continue;

      // PASS 1 — Inline: text curves along road
      if (drawTextAlongPath(ctx, road.name, subPath, fontSize, grid)) {
        labeledNames.set(road.name, (labeledNames.get(road.name) || 0) + 1);
        continue;
      }

      // PASS 2 — Offset: shifted perpendicular, still aligned with road angle
      if (drawOffsetLabel(ctx, road.name, subPath, fontSize * 0.85, grid, fontSize * 1.2)) {
        labeledNames.set(road.name, (labeledNames.get(road.name) || 0) + 1);
        continue;
      }

      // PASS 3 — Legend: numbered circle on map, name in PDF legend table
      if (!labeledNames.has(road.name)) {
        const mid = getPointAtDistance(road.pixelPath, road.pathLength / 2);
        if (drawLegendMarker(ctx, legendNum, mid.x, mid.y, grid)) {
          legendEntries.push({ number: legendNum, streetName: road.name });
          legendNum++;
          labeledNames.set(road.name, 1);
        }
      }
    }
  }

  return legendEntries;
}

// ─── COMPOSITE: greyscale base + custom labels ──────────────────────────────

async function processMapWithLabels(
  rawDataUrl: string,
  roads: RoadPath[],
  width: number,
  height: number,
): Promise<MastermapRenderResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      // Draw base map
      ctx.drawImage(img, 0, 0, width, height);

      // Greyscale filter — preserve saturated pixels (route colors + booking dots)
      const imageData = ctx.getImageData(0, 0, width, height);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        if (sat < 0.18) {
          const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          px[i] = grey; px[i + 1] = grey; px[i + 2] = grey;
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Draw custom road labels on top of greyscaled map
      const legendEntries = labelRoadsThreePass(ctx, roads);

      resolve({
        imageDataUrl: canvas.toDataURL('image/png'),
        legendEntries,
      });
    };
    img.onerror = () => resolve({ imageDataUrl: rawDataUrl, legendEntries: [] });
    img.src = rawDataUrl;
  });
}

// ─── OFF-SCREEN MAP RENDERER ─────────────────────────────────────────────────

async function renderMastermapOffscreen(
  routes: SavedRouteInput[],
  bookings: MastermapBookingInput[],
  pixelW: number,
  pixelH: number,
  bearing: number,
): Promise<MastermapRenderResult | null> {
  const allCoords: [number, number][] = [];
  routes.forEach((r) => r.segments?.forEach((s) => allCoords.push(...s.coordinates)));
  bookings.forEach((b) => allCoords.push([b.lng, b.lat]));
  if (!allCoords.length) return null;

  return new Promise<MastermapRenderResult | null>((resolve) => {
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;top:0;left:0;width:${pixelW}px;height:${pixelH}px;z-index:-1;pointer-events:none;overflow:hidden`;
    document.body.appendChild(container);

    let done = false;
    const cleanup = () => {
      try { document.body.removeChild(container); } catch { /* ok */ }
    };

    mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';

    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: allCoords[0],
      zoom: 12,
      preserveDrawingBuffer: true,
      attributionControl: false,
      interactive: false,
    });

    const timeout = setTimeout(() => {
      if (done) return;
      console.warn('[DMB Mastermap] Map render timed out after 30s — capturing anyway');
      try {
        map.triggerRepaint();
        setTimeout(() => {
          if (done) return; done = true;
          try {
            const url = map.getCanvas().toDataURL('image/png');
            const roads = queryAndGroupRoads(map);
            try { map.remove(); } catch {} cleanup();
            processMapWithLabels(url, roads, pixelW, pixelH).then(resolve);
          } catch { try { map.remove(); } catch {} cleanup(); resolve(null); }
        }, 200);
      } catch { if (!done) { done = true; try { map.remove(); } catch {} cleanup(); resolve(null); } }
    }, 30000);

    map.on('load', () => {
      // Style: DMB styling + greyscale + thick roads + hide all Mapbox text
      applyMapStyling(map);
      applyGreyscaleBase(map);
      thickenMastermapRoads(map);
      hideMapboxLabels(map);

      // Insert routes below any remaining visible layers
      const routeInsertBefore = map.getStyle().layers?.find((l: any) =>
        l.type === 'symbol' && l.id.startsWith('mm-')
      )?.id ?? undefined;

      // Add each route as a colored line
      routes.forEach((route, idx) => {
        if (!route.segments?.length) return;
        map.addSource(`mm-route-${idx}`, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: route.segments.map((s) => ({
              type: 'Feature' as const, properties: {},
              geometry: { type: 'LineString' as const, coordinates: s.coordinates },
            })),
          },
        });
        map.addLayer({
          id: `mm-line-${idx}`, type: 'line', source: `mm-route-${idx}`,
          paint: { 'line-color': route.route_color, 'line-width': 10, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        }, routeInsertBefore);
      });

      // Route number labels at centroids
      const labelFeatures: GeoJSON.Feature[] = [];
      routes.forEach((route) => {
        const coords: [number, number][] = [];
        route.segments?.forEach((s) => coords.push(...s.coordinates));
        if (!coords.length) return;
        const cLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
        const cLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
        labelFeatures.push({
          type: 'Feature',
          properties: { num: String(route.route_number), color: route.route_color },
          geometry: { type: 'Point', coordinates: [cLng, cLat] },
        });
      });
      if (labelFeatures.length) {
        map.addSource('mm-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: labelFeatures } });
        map.addLayer({
          id: 'mm-route-nums', type: 'symbol', source: 'mm-labels',
          layout: { 'text-field': ['get', 'num'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 40, 'text-allow-overlap': true, 'text-ignore-placement': true },
          paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 3 },
        });
      }

      // Booking dots
      if (bookings.length) {
        map.addSource('mm-bookings', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: bookings.map((b) => ({
              type: 'Feature' as const,
              properties: { routeColor: b.routeColor },
              geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
            })),
          },
        });
        map.addLayer({
          id: 'mm-booking-dots', type: 'circle', source: 'mm-bookings',
          paint: { 'circle-color': ['get', 'routeColor'], 'circle-radius': 8, 'circle-stroke-color': '#000000', 'circle-stroke-width': 3, 'circle-opacity': 0.95 },
        });
      }

      // Fit bounds with bearing
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
      );
      map.jumpTo({ bearing, center: bounds.getCenter() });
      map.fitBounds(bounds, { padding: 20, maxZoom: 20, duration: 0 });

      // Wait for tiles to load, then capture + label
      map.once('idle', () => {
        setTimeout(() => {
          map.triggerRepaint();
          map.once('render', () => {
            setTimeout(() => {
              if (done) return; done = true;
              clearTimeout(timeout);
              try {
                const rawUrl = map.getCanvas().toDataURL('image/png');
                // Query roads BEFORE removing map (need map.project() for pixel coords)
                const roads = queryAndGroupRoads(map);
                try { map.remove(); } catch {} cleanup();
                // Composite: greyscale base + custom curving labels
                processMapWithLabels(rawUrl, roads, pixelW, pixelH).then(resolve);
              } catch (err) {
                console.error('[DMB Mastermap] capture failed:', err);
                try { map.remove(); } catch {} cleanup();
                resolve(null);
              }
            }, 300);
          });
        }, 2000);
      });
    });
  });
}

// ─── MASTERMAP PDF BUILDER ───────────────────────────────────────────────────

export async function generateMastermap(
  areaName: string,
  routes: SavedRouteInput[],
  geocodedBookings: MastermapBookingInput[],
  bookingsData: Map<string, any[]>,
  onProgress?: (p: DmbPCLProgress) => void,
): Promise<MastermapResult> {
  if (!routes.length) {
    return { success: false, routeCount: 0, bookingCount: 0, errorMessage: 'No routes in this area.' };
  }

  onProgress?.({ phase: 'Analyzing', detail: 'Calculating layout\u2026', percent: 5 });
  await yieldUI();

  // ── Collect coordinates + calculate bearing ────────────────────────────────
  const allCoords: [number, number][] = [];
  routes.forEach((r) => r.segments?.forEach((s) => allCoords.push(...s.coordinates)));

  const bearing = calculateOptimalBearing(allCoords);

  // ── Bounding box for aspect ratio ──────────────────────────────────────────
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  allCoords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  });
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const widthKm = (maxLng - minLng) * 111 * cosLat;
  const heightKm = (maxLat - minLat) * 111;
  const isLandscape = widthKm >= heightKm;

  // ── Layout ─────────────────────────────────────────────────────────────────
  const SIDEBAR_W = 80;
  const SIDEBAR_H = 45;
  let mapAreaW: number, mapAreaH: number, mapX: number, mapY: number;
  let sidebarLayout: 'left' | 'top';

  if (isLandscape) {
    sidebarLayout = 'left';
    mapX = MM_MARGIN + SIDEBAR_W;
    mapY = MM_MARGIN;
    mapAreaW = LEGAL_W - 2 * MM_MARGIN - SIDEBAR_W;
    mapAreaH = LEGAL_H - 2 * MM_MARGIN;
  } else {
    sidebarLayout = 'top';
    mapX = MM_MARGIN;
    mapY = MM_MARGIN + SIDEBAR_H;
    mapAreaW = LEGAL_W - 2 * MM_MARGIN;
    mapAreaH = LEGAL_H - 2 * MM_MARGIN - SIDEBAR_H;
  }

  // 6000px render — sweet spot for custom label legibility
  const pixelW = isLandscape ? 6000 : 5200;
  const pixelH = Math.round(pixelW * (mapAreaH / mapAreaW));

  // ── Render ─────────────────────────────────────────────────────────────────
  onProgress?.({ phase: 'Rendering map', detail: 'Capturing + labeling streets\u2026', percent: 10 });
  await yieldUI();
  await new Promise((r) => setTimeout(r, 1000));

  const renderResult = await renderMastermapOffscreen(routes, geocodedBookings, pixelW, pixelH, bearing);

  // ── Build PDF ──────────────────────────────────────────────────────────────
  onProgress?.({ phase: 'Building PDF', detail: 'Drawing layout\u2026', percent: 85 });
  await yieldUI();

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'legal' });

  // Map image
  if (renderResult?.imageDataUrl) {
    try { doc.addImage(renderResult.imageDataUrl, 'PNG', mapX, mapY, mapAreaW, mapAreaH); }
    catch { /* map unavailable */ }
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const sortedRoutes = [...routes].sort((a, b) => a.route_number - b.route_number);

  function hexToRgb(hex: string) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
  }

  if (sidebarLayout === 'left') {
    const sx = MM_MARGIN;
    let sy = MM_MARGIN;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(areaName, sx, sy + 8);
    sy += 14;
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.line(sx, sy, sx + SIDEBAR_W - 4, sy);
    sy += 6;
    doc.setFontSize(6.5);
    for (const route of sortedRoutes) {
      const count = bookingsData.get(route.route_code)?.length ?? 0;
      const rgb = hexToRgb(route.route_color);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.circle(sx + 4, sy + 2, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text(route.route_code, sx + 10, sy + 4);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`(${count})`, sx + 10 + route.route_code.length * 3.8 + 2, sy + 4);
      sy += 10;
      if (sy > LEGAL_H - MM_MARGIN - 10) break;
    }
    doc.setFontSize(3.5);
    doc.setTextColor(160, 160, 160);
    doc.text('\u00A9 Mapbox \u00A9 OpenStreetMap', sx, LEGAL_H - MM_MARGIN);
  } else {
    const sy = MM_MARGIN;
    let sx = MM_MARGIN;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(areaName, sx, sy + 9);
    sx += areaName.length * 5.5 + 10;
    doc.setFontSize(6.5);
    let rowY = sy;
    for (const route of sortedRoutes) {
      const count = bookingsData.get(route.route_code)?.length ?? 0;
      const label = `${route.route_code}(${count})`;
      const entryW = label.length * 3.8 + 14;
      if (sx + entryW > LEGAL_W - MM_MARGIN) { sx = MM_MARGIN; rowY += 14; if (rowY > MM_MARGIN + SIDEBAR_H - 8) break; }
      const rgb = hexToRgb(route.route_color);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.circle(sx + 3, rowY + 7, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text(route.route_code, sx + 8, rowY + 9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`(${count})`, sx + 8 + route.route_code.length * 3.8 + 1, rowY + 9);
      sx += entryW;
    }
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.line(MM_MARGIN, mapY - 3, LEGAL_W - MM_MARGIN, mapY - 3);
    doc.setFontSize(3.5);
    doc.setTextColor(160, 160, 160);
    doc.text('\u00A9 Mapbox \u00A9 OpenStreetMap', LEGAL_W - MM_MARGIN - 80, LEGAL_H - MM_MARGIN + 2);
  }

  // ── Legend table (for streets that got numbered markers) ────────────────────
  const legendEntries = renderResult?.legendEntries || [];
  if (legendEntries.length > 0) {
    const COLS = 2;
    const ROW_H = 7;
    const COL_W = 130;
    const rows = Math.ceil(legendEntries.length / COLS);
    const legendW = COLS * COL_W + 8;
    const legendH = rows * ROW_H + 14;

    // Position: top-right corner of map area
    const lx = mapX + mapAreaW - legendW - 4;
    const ly = mapY + 4;

    // White background with border
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.5);
    doc.rect(lx, ly, legendW, legendH, 'FD');

    // Entries in two columns
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(0, 0, 0);
    for (let i = 0; i < legendEntries.length; i++) {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const ex = lx + 4 + col * COL_W;
      const ey = ly + 9 + row * ROW_H;
      doc.text(`${legendEntries[i].number}. ${legendEntries[i].streetName}`, ex, ey);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  onProgress?.({ phase: 'Downloading', detail: 'Saving PDF\u2026', percent: 97 });
  await yieldUI();
  const today = new Date();
  const dateStr = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  doc.save(`Mastermap_${areaName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}.pdf`);
  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });
  return { success: true, routeCount: routes.length, bookingCount: geocodedBookings.length };
}