// src/lib/pclService.ts
//
// PCL (Previous Client List) PDF Generator.
// Reads all tabs from one or more callbook spreadsheets, collects every row,
// sorts by Route Code → Street → House # → Year, and generates
// a downloadable PDF with page breaks between route codes.
//
// Supports multiple campaign types:
//   standard/bc — FIRST NAME, LAST NAME, STREET NAME, PHONE, FO→FO/BO/FP, Previous Price
//   sealing     — FIRST, LAST, STREET, AREA+PHONE combined, SERVICE (SS/SSP/RAMP, blank→SSP), PRICE
//
// Uses jsPDF + jspdf-autotable for client-side PDF generation.
// Uses SheetJS (xlsx) for reading uploaded Excel files — run: npm install xlsx
//

import { dialerSheetsService } from './dialerSheetsService';
import type { CampaignBook } from './campaignService';
import type { CampaignType } from './campaignService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// =============================================================================
// TYPES
// =============================================================================

export interface PCLProgress {
  phase: string;
  detail: string;
  percent: number;
}

export interface PCLResult {
  success: boolean;
  totalRows: number;
  routeCodes: number;
  tabsScanned: number;
  booksScanned: number;
  errorMessage?: string;
}

// =============================================================================
// STANDARD/BC HEADER RESOLUTION
// =============================================================================

interface StandardColumnIndices {
  ROUTE_CODE: number;
  FIRST_NAME: number;
  LAST_NAME: number;
  HOUSE_NUM: number;
  STREET_NAME: number;
  AREA_CODE: number;   // AC column in BC books (area code separate from phone)
  PHONE: number;
  CITY: number;
  FO: number;
  PRICE: number;
  CONTRACTOR: number;
  DATE: number;
  YEAR: number;
  FLAG_A: number;      // BC flag columns A/D/F/S/L
  FLAG_D: number;
  FLAG_F: number;
  FLAG_S: number;
  FLAG_L: number;
}

function resolveStandardHeaders(headers: any[]): StandardColumnIndices {
  const CI: StandardColumnIndices = {
    ROUTE_CODE: -1, FIRST_NAME: -1, LAST_NAME: -1, HOUSE_NUM: -1,
    STREET_NAME: -1, AREA_CODE: -1, PHONE: -1, CITY: -1, FO: -1, PRICE: -1,
    CONTRACTOR: -1, DATE: -1, YEAR: -1,
    FLAG_A: -1, FLAG_D: -1, FLAG_F: -1, FLAG_S: -1, FLAG_L: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;

    if ((h === 'ROUTE CODE' || h === 'ROUTE_CODE' || h === 'ROUTECODE') && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if ((h === 'FIRST NAME' || h === 'FIRST_NAME' || h === 'FIRSTNAME') && CI.FIRST_NAME < 0) CI.FIRST_NAME = i;
    else if ((h === 'LAST NAME' || h === 'LAST_NAME' || h === 'LASTNAME') && CI.LAST_NAME < 0) CI.LAST_NAME = i;
    else if ((h === 'HOUSE #' || h === 'HOUSE#' || h === 'HOUSE NUM' || h === 'HOUSE_NUM' || h === 'PREFIX' || h === 'HOUSE') && CI.HOUSE_NUM < 0) CI.HOUSE_NUM = i;
    else if ((h === 'STREET NAME' || h === 'STREET_NAME' || h === 'STREETNAME' || h === 'STREET') && CI.STREET_NAME < 0) CI.STREET_NAME = i;
    else if ((h === 'AC' || h === 'AREA CODE' || h === 'AREA_CODE' || h === 'AREACODE') && CI.AREA_CODE < 0) CI.AREA_CODE = i;
    else if ((h === 'PHONE' || h === 'PHONE #' || h === 'PHONE#') && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'CITY' && CI.CITY < 0) CI.CITY = i;
    else if (h === 'FO' && CI.FO < 0) CI.FO = i;
    else if ((h === 'PREVIOUS PRICE' || h === 'PREVIOUS_PRICE' || h === 'PREV PRICE' || h === 'PRICE' || h === 'SERVICE AMT' || h === 'SERVICE_AMT') && CI.PRICE < 0) CI.PRICE = i;
    else if ((h === 'CONTRACTOR NAME' || h === 'CONTRACTOR_NAME' || h === 'CONTRACTORNAME' || h === 'CONTRACTOR') && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'DATE' && CI.DATE < 0) CI.DATE = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
    // Single-letter flag columns for BC books (must come after all other assignments)
    else if (h === 'A' && CI.FLAG_A < 0) CI.FLAG_A = i;
    else if (h === 'D' && CI.FLAG_D < 0) CI.FLAG_D = i;
    else if (h === 'F' && CI.FLAG_F < 0) CI.FLAG_F = i;
    else if (h === 'S' && CI.FLAG_S < 0) CI.FLAG_S = i;
    else if (h === 'L' && CI.FLAG_L < 0) CI.FLAG_L = i;
  }

  return CI;
}

// =============================================================================
// SEALING HEADER RESOLUTION
// =============================================================================

interface SealingColumnIndices {
  ROUTE_CODE: number;
  FIRST: number;
  LAST: number;
  HOUSE_NUM: number;
  STREET: number;
  AREA: number;
  PHONE: number;
  CITY: number;
  SERVICE: number;
  PRICE: number;
  CONTRACTOR: number;
  DATE: number;
  YEAR: number;
}

function resolveSealingHeaders(headers: any[]): SealingColumnIndices {
  const CI: SealingColumnIndices = {
    ROUTE_CODE: -1, FIRST: -1, LAST: -1, HOUSE_NUM: -1,
    STREET: -1, AREA: -1, PHONE: -1, CITY: -1, SERVICE: -1,
    PRICE: -1, CONTRACTOR: -1, DATE: -1, YEAR: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;

    if ((h === 'ROUTE CODE' || h === 'ROUTE_CODE' || h === 'ROUTECODE') && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if ((h === 'FIRST' || h === 'FIRST NAME' || h === 'FIRSTNAME' || h === 'FIRST_NAME') && CI.FIRST < 0) CI.FIRST = i;
    else if ((h === 'LAST' || h === 'LAST NAME' || h === 'LASTNAME' || h === 'LAST_NAME') && CI.LAST < 0) CI.LAST = i;
    else if ((h === 'HOUSE #' || h === 'HOUSE#' || h === 'HOUSE NUM' || h === 'HOUSE') && CI.HOUSE_NUM < 0) CI.HOUSE_NUM = i;
    else if ((h === 'STREET' || h === 'STREET NAME' || h === 'STREET_NAME') && CI.STREET < 0) CI.STREET = i;
    else if ((h === 'AREA' || h === 'AC' || h === 'AREA CODE') && CI.AREA < 0) CI.AREA = i;
    else if ((h === 'PHONE' || h === 'PHONE #' || h === 'PHONE#') && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'CITY' && CI.CITY < 0) CI.CITY = i;
    else if (h === 'SERVICE' && CI.SERVICE < 0) CI.SERVICE = i;
    else if (h === 'PRICE' && CI.PRICE < 0) CI.PRICE = i;
    else if ((h === 'CONTRACTOR' || h === 'CONTRACTOR NAME' || h === 'CONTRACTOR_NAME') && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'DATE' && CI.DATE < 0) CI.DATE = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
  }

  return CI;
}

// =============================================================================
// FIND HEADER ROW — looks for PHONE or PHONE # column
// =============================================================================

function findHeaderRow(rawData: any[][]): number | null {
  const scanLimit = Math.min(10, rawData.length);
  for (let r = 0; r < scanLimit; r++) {
    for (let c = 0; c < (rawData[r]?.length || 0); c++) {
      const h = String(rawData[r][c] ?? '').trim().toUpperCase();
      if (h === 'PHONE' || h === 'PHONE #' || h === 'PHONE#') return r;
    }
  }
  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

function cell(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  return s;
}

function formatPhone10(digits: string): string {
  if (digits.length === 10) {
    return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
  }
  return digits;
}

function cleanPhoneDigits(raw: string): string {
  let s = raw;
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function formatPhoneStandard(raw: string): string {
  return formatPhone10(cleanPhoneDigits(raw));
}

function formatPhoneSealing(area: string, phone: string): string {
  const areaDigits = cleanPhoneDigits(area);
  const phoneDigits = cleanPhoneDigits(phone);
  const combined = areaDigits + phoneDigits;
  const final = combined.length > 10 ? combined.slice(-10) : combined;
  return formatPhone10(final);
}

function interpretFOService(row: any[], foCol: number): string {
  const v = cell(row, foCol).toUpperCase();
  if (v === 'X' || v === 'FO') return 'FO';
  if (v === 'BO') return 'BO';
  return 'FP';
}

function interpretSealingService(row: any[], serviceCol: number): string {
  const v = cell(row, serviceCol).toUpperCase();
  if (v === 'SS' || v === 'SSP' || v === 'RAMP') return v;
  if (v) return v;
  return 'SSP';
}

function formatDate(raw: string): string {
  if (!raw) return '';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    return `${d}-${months[m] || isoMatch[2]}`;
  }
  return raw;
}

function parseYear(val: string): number {
  const n = parseInt(val, 10);
  return !isNaN(n) && n >= 2000 && n <= 2100 ? n : 0;
}

function parseHouseNum(val: string): number {
  const n = parseInt(val.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function formatPrice(raw: string): string {
  if (!raw) return '';
  const n = parseFloat(raw.replace(/[,$]/g, ''));
  if (isNaN(n)) return raw;
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Reads a cell value as a flag: any non-empty value → 'X', empty → ''
function readFlag(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v === null || v === undefined) return '';
  return String(v).trim() ? 'X' : '';
}

// =============================================================================
// PCL ROW TYPE
// =============================================================================

export interface PCLRow {
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  phone: string;
  city: string;
  service: string;
  price: string;
  contractor: string;
  date: string;
  year: string;
  sourceType: 'standard' | 'bc' | 'sealing';
  flagA: string;   // BC flag columns — empty string for non-BC rows
  flagD: string;
  flagF: string;
  flagS: string;
  flagL: string;
}

// =============================================================================
// ROW EXTRACTORS
// =============================================================================

function extractStandardRows(rawData: any[][], headerRowIndex: number, CI: StandardColumnIndices, sourceType: 'standard' | 'bc'): PCLRow[] {
  const rows: PCLRow[] = [];
  const dataRows = rawData.slice(headerRowIndex + 1);

  for (const row of dataRows) {
    if (!row[0]) continue;

    // BC books may have a separate area code column (AC); combine with phone number
    const phone = (sourceType === 'bc' && CI.AREA_CODE >= 0)
      ? formatPhoneSealing(cell(row, CI.AREA_CODE), cell(row, CI.PHONE))
      : formatPhoneStandard(cell(row, CI.PHONE));

    rows.push({
      routeCode: cell(row, CI.ROUTE_CODE),
      firstName: cell(row, CI.FIRST_NAME),
      lastName: cell(row, CI.LAST_NAME),
      houseNum: cell(row, CI.HOUSE_NUM),
      streetName: cell(row, CI.STREET_NAME),
      phone,
      city: cell(row, CI.CITY),
      service: interpretFOService(row, CI.FO),
      price: formatPrice(cell(row, CI.PRICE)),
      contractor: cell(row, CI.CONTRACTOR),
      date: formatDate(cell(row, CI.DATE)),
      year: cell(row, CI.YEAR),
      sourceType,
      flagA: sourceType === 'bc' ? readFlag(row, CI.FLAG_A) : '',
      flagD: sourceType === 'bc' ? readFlag(row, CI.FLAG_D) : '',
      flagF: sourceType === 'bc' ? readFlag(row, CI.FLAG_F) : '',
      flagS: sourceType === 'bc' ? readFlag(row, CI.FLAG_S) : '',
      flagL: sourceType === 'bc' ? readFlag(row, CI.FLAG_L) : '',
    });
  }

  return rows;
}

function extractSealingRows(rawData: any[][], headerRowIndex: number, CI: SealingColumnIndices): PCLRow[] {
  const rows: PCLRow[] = [];
  const dataRows = rawData.slice(headerRowIndex + 1);

  for (const row of dataRows) {
    if (!row[0]) continue;

    rows.push({
      routeCode: cell(row, CI.ROUTE_CODE),
      firstName: cell(row, CI.FIRST),
      lastName: cell(row, CI.LAST),
      houseNum: cell(row, CI.HOUSE_NUM),
      streetName: cell(row, CI.STREET),
      phone: formatPhoneSealing(cell(row, CI.AREA), cell(row, CI.PHONE)),
      city: cell(row, CI.CITY),
      service: interpretSealingService(row, CI.SERVICE),
      price: formatPrice(cell(row, CI.PRICE)),
      contractor: cell(row, CI.CONTRACTOR),
      date: formatDate(cell(row, CI.DATE)),
      year: cell(row, CI.YEAR),
      sourceType: 'sealing',
      flagA: '', flagD: '', flagF: '', flagS: '', flagL: '',
    });
  }

  return rows;
}

// =============================================================================
// MAIN PCL FUNCTION (Google Sheets path — unchanged)
// =============================================================================

export async function generatePCL(
  books: CampaignBook[],
  onProgress?: (progress: PCLProgress) => void
): Promise<PCLResult> {
  if (books.length === 0) {
    return {
      success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0, booksScanned: 0,
      errorMessage: 'No books selected.',
    };
  }

  // --- Ensure Google Sheets authentication ---
  if (!dialerSheetsService.isAuthenticated()) {
    onProgress?.({ phase: 'Authenticating', detail: 'Connecting to Google Sheets...', percent: 2 });
    try {
      const authed = await dialerSheetsService.authenticate();
      if (!authed) {
        return {
          success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0, booksScanned: 0,
          errorMessage: 'Google Sheets authentication was cancelled or failed. Please try again.',
        };
      }
    } catch (err: any) {
      return {
        success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0, booksScanned: 0,
        errorMessage: 'Google Sheets authentication failed: ' + (err.message || 'Unknown error'),
      };
    }
  }

  // --- Process each book ---
  const allRows: PCLRow[] = [];
  let totalTabsScanned = 0;

  for (let b = 0; b < books.length; b++) {
    const book = books[b];
    const isSealing = book.campaignType === 'sealing';
    const bookPctStart = 5 + Math.round((b / books.length) * 55);

    onProgress?.({ phase: 'Loading', detail: `Book "${book.displayName}" — fetching tabs...`, percent: bookPctStart });

    let tabs: string[];
    try {
      tabs = await dialerSheetsService.getCallbookTabs(book.spreadsheetId);
    } catch {
      continue;
    }

    if (tabs.length === 0) continue;

    for (let t = 0; t < tabs.length; t++) {
      const tabName = tabs[t];
      const pct = bookPctStart + Math.round(((t + 1) / tabs.length) * (55 / books.length));
      onProgress?.({ phase: 'Scanning', detail: `"${book.displayName}" → "${tabName}"`, percent: pct });

      let rawData: any[][];
      try {
        rawData = await dialerSheetsService.sheetsGet(book.spreadsheetId, `'${tabName}'`);
      } catch {
        continue;
      }

      if (!rawData || rawData.length < 2) continue;

      const headerRowIndex = findHeaderRow(rawData);
      if (headerRowIndex === null) continue;

      totalTabsScanned++;

      if (isSealing) {
        const CI = resolveSealingHeaders(rawData[headerRowIndex]);
        if (CI.PHONE < 0) continue;
        const rows = extractSealingRows(rawData, headerRowIndex, CI);
        allRows.push(...rows);
      } else {
        const CI = resolveStandardHeaders(rawData[headerRowIndex]);
        if (CI.PHONE < 0) continue;
        const stdType = book.campaignType === 'bc' ? 'bc' as const : 'standard' as const;
        const rows = extractStandardRows(rawData, headerRowIndex, CI, stdType);
        allRows.push(...rows);
      }
    }
  }

  if (allRows.length === 0) {
    return {
      success: false, totalRows: 0, routeCodes: 0, tabsScanned: totalTabsScanned, booksScanned: books.length,
      errorMessage: 'No data rows found across all books/tabs.',
    };
  }

  // --- Sort rows ---
  onProgress?.({ phase: 'Sorting', detail: `Organizing ${allRows.length.toLocaleString()} rows...`, percent: 65 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  allRows.sort((a, b) => {
    const rcA = a.routeCode || '\uffff';
    const rcB = b.routeCode || '\uffff';
    if (rcA !== rcB) return rcA.localeCompare(rcB);

    // City sort within route code — splits same RC across different cities
    const cityA = a.city.toLowerCase();
    const cityB = b.city.toLowerCase();
    if (cityA !== cityB) return cityA.localeCompare(cityB);

    const stA = a.streetName.toLowerCase();
    const stB = b.streetName.toLowerCase();
    if (stA !== stB) return stA.localeCompare(stB);

    const hnA = parseHouseNum(a.houseNum);
    const hnB = parseHouseNum(b.houseNum);
    if (hnA !== hnB) return hnA - hnB;

    const yrA = parseYear(a.year);
    const yrB = parseYear(b.year);
    return yrA - yrB;
  });

  // --- Group by Route Code + City (page break when either changes) ---
  onProgress?.({ phase: 'Grouping', detail: `Grouping ${allRows.length.toLocaleString()} rows by route code + city...`, percent: 68 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const routeGroups: { routeCode: string; rows: PCLRow[] }[] = [];
  let currentGroupKey = '';
  let currentGroup: PCLRow[] = [];

  for (const row of allRows) {
    const rc = row.routeCode || '(No Route)';
    const city = row.city || '';
    const groupKey = rc + '|' + city;
    if (groupKey !== currentGroupKey) {
      if (currentGroup.length > 0) {
        routeGroups.push({ routeCode: currentGroupKey.split('|')[0], rows: currentGroup });
      }
      currentGroupKey = groupKey;
      currentGroup = [];
    }
    currentGroup.push(row);
  }
  if (currentGroup.length > 0) {
    routeGroups.push({ routeCode: currentGroupKey.split('|')[0], rows: currentGroup });
  }

  // --- Generate PDF ---
  onProgress?.({ phase: 'Generating', detail: 'Building PDF...', percent: 70 });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });

  const headerLabels = ['RC', 'FIRSTNAME', 'LASTNAME', 'HOUSE #', 'STREET NAME', 'PHONE #', 'City', 'Service', 'Price', 'Contractor', 'Date', 'Year'];

  const colWidths = [42, 68, 68, 42, 90, 78, 58, 40, 52, 110, 48, 36];

  for (let g = 0; g < routeGroups.length; g++) {
    const group = routeGroups[g];

    if (g > 0) {
      doc.addPage();
    }

    const pct = 70 + Math.round(((g + 1) / routeGroups.length) * 25);
    onProgress?.({ phase: 'Generating', detail: `Route ${group.routeCode} (${g + 1}/${routeGroups.length})...`, percent: pct });

    // Yield to browser every 5 groups so UI stays responsive with large datasets
    if (g % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const tableRows = group.rows.map((r) => [
      r.routeCode,
      r.firstName,
      r.lastName,
      r.houseNum,
      r.streetName,
      r.phone,
      r.city,
      r.service,
      r.price,
      r.contractor,
      r.date,
      r.year,
    ]);

    // Track which rows are sealing for background coloring
    const rowIsSealing = group.rows.map((r) => r.sourceType === 'sealing');

    autoTable(doc, {
      head: [headerLabels],
      body: tableRows,
      startY: 20,
      margin: { left: 14, right: 14, top: 20, bottom: 20 },
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 3,
        overflow: 'hidden',
        lineColor: [200, 200, 200],
        lineWidth: 0.5,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [50, 50, 50],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'left',
      },
      bodyStyles: {
        textColor: [30, 30, 30],
      },
      columnStyles: {
        0: { cellWidth: colWidths[0] },
        1: { cellWidth: colWidths[1] },
        2: { cellWidth: colWidths[2] },
        3: { cellWidth: colWidths[3], halign: 'left' },
        4: { cellWidth: colWidths[4] },
        5: { cellWidth: colWidths[5] },
        6: { cellWidth: colWidths[6] },
        7: { cellWidth: colWidths[7], halign: 'center' },
        8: { cellWidth: colWidths[8], halign: 'right' },
        9: { cellWidth: colWidths[9], overflow: 'hidden' },
        10: { cellWidth: colWidths[10] },
        11: { cellWidth: colWidths[11], halign: 'center' },
      },
      didParseCell: function (data: any) {
        if (data.section !== 'body') return;

        // Background color: grey for sealing rows, white for standard/bc
        const rowIdx = data.row.index;
        if (rowIdx >= 0 && rowIdx < rowIsSealing.length && rowIsSealing[rowIdx]) {
          data.cell.styles.fillColor = [230, 230, 230];
        } else {
          data.cell.styles.fillColor = [255, 255, 255];
        }

        // Shrink-to-fit: reduce font size if text is too wide for column
        const cellText = String(data.cell.text?.join?.('') || data.cell.text || '');
        const colW = colWidths[data.column.index] || 60;
        const estimatedWidth = cellText.length * 3.5;
        if (estimatedWidth > colW) {
          const ratio = colW / estimatedWidth;
          const newSize = Math.max(4, Math.round(7 * ratio * 10) / 10);
          data.cell.styles.fontSize = newSize;
        }
      },
    });
  }

  // --- Download ---
  onProgress?.({ phase: 'Downloading', detail: 'Saving PDF...', percent: 97 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const today = new Date();
  const dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  let fileLabel: string;
  if (books.length === 1) {
    fileLabel = books[0].displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
  } else {
    fileLabel = books.map(b => b.displayName.replace(/[^a-zA-Z0-9_-]/g, '_')).join('+');
    if (fileLabel.length > 80) fileLabel = fileLabel.substring(0, 80);
  }
  const filename = `PCL_${fileLabel}_${dateStr}.pdf`;

  doc.save(filename);

  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });

  return {
    success: true,
    totalRows: allRows.length,
    routeCodes: routeGroups.length,
    tabsScanned: totalTabsScanned,
    booksScanned: books.length,
  };
}

// =============================================================================
// FILE UPLOAD PATH — TYPES
// =============================================================================

export interface PCLScanResult {
  rows: PCLRow[];
  cities: string[];
}

export interface CityGroup {
  name: string;
  cities: string[];
}

// =============================================================================
// FILE UPLOAD PATH — SHARED HELPERS
// =============================================================================

// Sorts rows the same way generatePCL does: RC → city → street → house# → year
function sortPCLRows(rows: PCLRow[]): PCLRow[] {
  return [...rows].sort((a, b) => {
    const rcA = a.routeCode || '\uffff';
    const rcB = b.routeCode || '\uffff';
    if (rcA !== rcB) return rcA.localeCompare(rcB);
    const cityA = a.city.toLowerCase();
    const cityB = b.city.toLowerCase();
    if (cityA !== cityB) return cityA.localeCompare(cityB);
    const stA = a.streetName.toLowerCase();
    const stB = b.streetName.toLowerCase();
    if (stA !== stB) return stA.localeCompare(stB);
    const hnA = parseHouseNum(a.houseNum);
    const hnB = parseHouseNum(b.houseNum);
    if (hnA !== hnB) return hnA - hnB;
    return parseYear(a.year) - parseYear(b.year);
  });
}

// Groups sorted rows by RC + city, same logic as generatePCL
function buildRouteGroups(rows: PCLRow[]): { routeCode: string; rows: PCLRow[] }[] {
  const groups: { routeCode: string; rows: PCLRow[] }[] = [];
  let currentKey = '';
  let currentRows: PCLRow[] = [];

  for (const row of rows) {
    const rc = row.routeCode || '(No Route)';
    const city = row.city || '';
    const key = rc + '|' + city;
    if (key !== currentKey) {
      if (currentRows.length > 0) {
        groups.push({ routeCode: currentKey.split('|')[0], rows: currentRows });
      }
      currentKey = key;
      currentRows = [];
    }
    currentRows.push(row);
  }
  if (currentRows.length > 0) {
    groups.push({ routeCode: currentKey.split('|')[0], rows: currentRows });
  }
  return groups;
}

// Builds a jsPDF document for a set of route groups.
// showFlags=true adds the 5 BC flag columns (A/D/F/S/L) right after Price.
// Column layout (764pt total for showFlags, 732pt for standard):
//   showFlags: RC(42) FIRST(62) LAST(62) HOUSE(42) STREET(80) PHONE(72) CITY(58)
//              SVC(40) PRICE(52) A(16) D(16) F(16) S(16) L(16) CONTRACTOR(90) DATE(48) YEAR(36)
//   standard:  RC(42) FIRST(68) LAST(68) HOUSE(42) STREET(90) PHONE(78) CITY(58)
//              SVC(40) PRICE(52) CONTRACTOR(110) DATE(48) YEAR(36)
function buildPDF(
  routeGroups: { routeCode: string; rows: PCLRow[] }[],
  showFlags: boolean
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });

  const headerLabels = showFlags
    ? ['RC', 'FIRST', 'LAST', 'HOUSE #', 'STREET NAME', 'PHONE #', 'CITY', 'SVC', 'PRICE', 'A', 'D', 'F', 'S', 'L', 'CONTRACTOR', 'DATE', 'YEAR']
    : ['RC', 'FIRSTNAME', 'LASTNAME', 'HOUSE #', 'STREET NAME', 'PHONE #', 'CITY', 'SERVICE', 'PRICE', 'CONTRACTOR', 'DATE', 'YEAR'];

  const colWidths = showFlags
    ? [42, 62, 62, 42, 80, 72, 58, 40, 52, 16, 16, 16, 16, 16, 90, 48, 36]  // total 764pt
    : [42, 68, 68, 42, 90, 78, 58, 40, 52, 110, 48, 36];                     // total 732pt

  const columnStyles: Record<number, any> = showFlags
    ? {
        0:  { cellWidth: colWidths[0] },
        1:  { cellWidth: colWidths[1] },
        2:  { cellWidth: colWidths[2] },
        3:  { cellWidth: colWidths[3], halign: 'left' },
        4:  { cellWidth: colWidths[4] },
        5:  { cellWidth: colWidths[5] },
        6:  { cellWidth: colWidths[6] },
        7:  { cellWidth: colWidths[7],  halign: 'center' },
        8:  { cellWidth: colWidths[8],  halign: 'right' },
        9:  { cellWidth: colWidths[9],  halign: 'center' },
        10: { cellWidth: colWidths[10], halign: 'center' },
        11: { cellWidth: colWidths[11], halign: 'center' },
        12: { cellWidth: colWidths[12], halign: 'center' },
        13: { cellWidth: colWidths[13], halign: 'center' },
        14: { cellWidth: colWidths[14], overflow: 'hidden' },
        15: { cellWidth: colWidths[15] },
        16: { cellWidth: colWidths[16], halign: 'center' },
      }
    : {
        0:  { cellWidth: colWidths[0] },
        1:  { cellWidth: colWidths[1] },
        2:  { cellWidth: colWidths[2] },
        3:  { cellWidth: colWidths[3], halign: 'left' },
        4:  { cellWidth: colWidths[4] },
        5:  { cellWidth: colWidths[5] },
        6:  { cellWidth: colWidths[6] },
        7:  { cellWidth: colWidths[7], halign: 'center' },
        8:  { cellWidth: colWidths[8], halign: 'right' },
        9:  { cellWidth: colWidths[9], overflow: 'hidden' },
        10: { cellWidth: colWidths[10] },
        11: { cellWidth: colWidths[11], halign: 'center' },
      };

  for (let g = 0; g < routeGroups.length; g++) {
    const group = routeGroups[g];
    if (g > 0) doc.addPage();

    // Yield every 5 groups to keep UI responsive on large files
    if (g % 5 === 0) {
      // Note: this is a sync loop so we can't truly await here —
      // callers should yield before calling buildPDF for large sets
    }

    const tableRows = group.rows.map((r) =>
      showFlags
        ? [r.routeCode, r.firstName, r.lastName, r.houseNum, r.streetName, r.phone, r.city, r.service, r.price, r.flagA, r.flagD, r.flagF, r.flagS, r.flagL, r.contractor, r.date, r.year]
        : [r.routeCode, r.firstName, r.lastName, r.houseNum, r.streetName, r.phone, r.city, r.service, r.price, r.contractor, r.date, r.year]
    );

    const rowIsSealing = group.rows.map((r) => r.sourceType === 'sealing');

    autoTable(doc, {
      head: [headerLabels],
      body: tableRows,
      startY: 20,
      margin: { left: 14, right: 14, top: 20, bottom: 20 },
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 3,
        overflow: 'hidden',
        lineColor: [200, 200, 200],
        lineWidth: 0.5,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [50, 50, 50],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'left',
      },
      bodyStyles: {
        textColor: [30, 30, 30],
      },
      columnStyles,
      didParseCell: function (data: any) {
        if (data.section !== 'body') return;

        const rowIdx = data.row.index;
        if (rowIdx >= 0 && rowIdx < rowIsSealing.length && rowIsSealing[rowIdx]) {
          data.cell.styles.fillColor = [230, 230, 230];
        } else {
          data.cell.styles.fillColor = [255, 255, 255];
        }

        // Shrink-to-fit for wide cells
        const cellText = String(data.cell.text?.join?.('') || data.cell.text || '');
        const colW = colWidths[data.column.index] || 60;
        const estimatedWidth = cellText.length * 3.5;
        if (estimatedWidth > colW) {
          const ratio = colW / estimatedWidth;
          const newSize = Math.max(4, Math.round(7 * ratio * 10) / 10);
          data.cell.styles.fontSize = newSize;
        }
      },
    });
  }

  return doc;
}

// =============================================================================
// FILE UPLOAD PATH — SCAN
// =============================================================================

/**
 * Reads an uploaded Excel file and returns all parsed PCL rows plus a
 * sorted list of unique city names. Does NOT generate any PDF.
 * Call generatePCLFromGroups() next.
 *
 * Requires SheetJS: npm install xlsx
 */
export async function scanPCLFromFile(
  file: File,
  campaignType: CampaignType,
  onProgress?: (progress: PCLProgress) => void
): Promise<PCLScanResult> {
  onProgress?.({ phase: 'Reading', detail: 'Reading Excel file...', percent: 10 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  onProgress?.({ phase: 'Parsing', detail: 'Parsing rows...', percent: 30 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // header:1 gives array-of-arrays; defval:null preserves empty cells
  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

  if (!rawData || rawData.length < 2) {
    return { rows: [], cities: [] };
  }

  // Pre-process: SheetJS with cellDates:true delivers Date objects for date cells.
  // Convert them to ISO strings so the existing formatDate() handles them correctly.
  const processedData = rawData.map((row) =>
    row.map((v) => (v instanceof Date ? v.toISOString() : v))
  );

  const headerRowIndex = findHeaderRow(processedData);
  if (headerRowIndex === null) {
    return { rows: [], cities: [] };
  }

  onProgress?.({ phase: 'Extracting', detail: 'Extracting rows...', percent: 55 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  let rows: PCLRow[] = [];

  if (campaignType === 'sealing') {
    const CI = resolveSealingHeaders(processedData[headerRowIndex]);
    if (CI.PHONE >= 0) {
      rows = extractSealingRows(processedData, headerRowIndex, CI);
    }
  } else {
    const CI = resolveStandardHeaders(processedData[headerRowIndex]);
    if (CI.PHONE >= 0) {
      const srcType: 'standard' | 'bc' = campaignType === 'bc' ? 'bc' : 'standard';
      rows = extractStandardRows(processedData, headerRowIndex, CI, srcType);
    }
  }

  onProgress?.({ phase: 'Scanning', detail: `Found ${rows.length.toLocaleString()} rows`, percent: 85 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Collect unique city names (sorted alphabetically)
  const citySet = new Set<string>();
  for (const r of rows) {
    if (r.city) citySet.add(r.city);
  }
  const cities = Array.from(citySet).sort();

  onProgress?.({ phase: 'Done', detail: 'Scan complete', percent: 100 });

  return { rows, cities };
}

// =============================================================================
// FILE UPLOAD PATH — GENERATE
// =============================================================================

/**
 * Generates one PDF per city group from previously scanned rows and downloads
 * each file automatically. City groups are user-defined. Any cities not assigned
 * to a named group are automatically placed in an "Other" catch-all group.
 */
export async function generatePCLFromGroups(
  rows: PCLRow[],
  groups: CityGroup[],
  fileLabel: string,
  onProgress?: (progress: PCLProgress) => void
): Promise<PCLResult> {
  if (rows.length === 0) {
    return { success: false, totalRows: 0, routeCodes: 0, tabsScanned: 1, booksScanned: 1, errorMessage: 'No rows to generate.' };
  }

  // Show the BC flag columns if any row is a BC type row
  const showFlags = rows.some((r) => r.sourceType === 'bc');

  onProgress?.({ phase: 'Sorting', detail: `Sorting ${rows.length.toLocaleString()} rows...`, percent: 5 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sorted = sortPCLRows(rows);

  const today = new Date();
  const dateStr =
    today.getFullYear() +
    '-' + String(today.getMonth() + 1).padStart(2, '0') +
    '-' + String(today.getDate()).padStart(2, '0');

  // Filter to groups that have cities assigned; add catch-all for unassigned cities
  const assignedCities = new Set(groups.flatMap((g) => g.cities));
  const unassignedCities = [...new Set(rows.map((r) => r.city).filter(Boolean))].filter((c) => !assignedCities.has(c));

  const activeGroups: CityGroup[] = [
    ...groups.filter((g) => g.cities.length > 0),
    ...(unassignedCities.length > 0 ? [{ name: 'Other', cities: unassignedCities }] : []),
  ];

  if (activeGroups.length === 0) {
    return { success: false, totalRows: 0, routeCodes: 0, tabsScanned: 1, booksScanned: 1, errorMessage: 'No city groups to generate.' };
  }

  let totalRouteGroups = 0;

  for (let g = 0; g < activeGroups.length; g++) {
    const group = activeGroups[g];
    const pct = 10 + Math.round(((g + 1) / activeGroups.length) * 85);
    onProgress?.({ phase: 'Generating', detail: `PDF ${g + 1}/${activeGroups.length}: "${group.name}"...`, percent: pct });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const citySet = new Set(group.cities);
    const groupRows = sorted.filter((r) => citySet.has(r.city));
    if (groupRows.length === 0) continue;

    const routeGroups = buildRouteGroups(groupRows);
    totalRouteGroups += routeGroups.length;

    const doc = buildPDF(routeGroups, showFlags);
    const safeName = group.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeLabel = fileLabel.length > 60 ? fileLabel.substring(0, 60) : fileLabel;
    doc.save(`PCL_${safeLabel}_${safeName}_${dateStr}.pdf`);
  }

  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });

  return {
    success: true,
    totalRows: rows.length,
    routeCodes: totalRouteGroups,
    tabsScanned: 1,
    booksScanned: 1,
  };
}