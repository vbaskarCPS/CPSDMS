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
//

import { dialerSheetsService } from './dialerSheetsService';
import type { CampaignBook } from './campaignService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  PHONE: number;
  CITY: number;
  FO: number;
  PRICE: number;
  CONTRACTOR: number;
  DATE: number;
  YEAR: number;
}

function resolveStandardHeaders(headers: any[]): StandardColumnIndices {
  const CI: StandardColumnIndices = {
    ROUTE_CODE: -1, FIRST_NAME: -1, LAST_NAME: -1, HOUSE_NUM: -1,
    STREET_NAME: -1, PHONE: -1, CITY: -1, FO: -1, PRICE: -1,
    CONTRACTOR: -1, DATE: -1, YEAR: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;

    if ((h === 'ROUTE CODE' || h === 'ROUTE_CODE' || h === 'ROUTECODE') && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if ((h === 'FIRST NAME' || h === 'FIRST_NAME' || h === 'FIRSTNAME') && CI.FIRST_NAME < 0) CI.FIRST_NAME = i;
    else if ((h === 'LAST NAME' || h === 'LAST_NAME' || h === 'LASTNAME') && CI.LAST_NAME < 0) CI.LAST_NAME = i;
    else if ((h === 'HOUSE #' || h === 'HOUSE#' || h === 'HOUSE NUM' || h === 'HOUSE_NUM' || h === 'PREFIX' || h === 'HOUSE') && CI.HOUSE_NUM < 0) CI.HOUSE_NUM = i;
    else if ((h === 'STREET NAME' || h === 'STREET_NAME' || h === 'STREETNAME' || h === 'STREET') && CI.STREET_NAME < 0) CI.STREET_NAME = i;
    else if (h === 'PHONE' && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'CITY' && CI.CITY < 0) CI.CITY = i;
    else if (h === 'FO' && CI.FO < 0) CI.FO = i;
    else if ((h === 'PREVIOUS PRICE' || h === 'PREVIOUS_PRICE' || h === 'PREV PRICE' || h === 'PRICE') && CI.PRICE < 0) CI.PRICE = i;
    else if ((h === 'CONTRACTOR NAME' || h === 'CONTRACTOR_NAME' || h === 'CONTRACTORNAME' || h === 'CONTRACTOR') && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'DATE' && CI.DATE < 0) CI.DATE = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
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
    else if (h === 'PHONE' && CI.PHONE < 0) CI.PHONE = i;
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
// FIND HEADER ROW (shared — looks for PHONE column)
// =============================================================================

function findHeaderRow(rawData: any[][]): number | null {
  const scanLimit = Math.min(10, rawData.length);
  for (let r = 0; r < scanLimit; r++) {
    for (let c = 0; c < (rawData[r]?.length || 0); c++) {
      const h = String(rawData[r][c] ?? '').trim().toUpperCase();
      if (h === 'PHONE') return r;
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

// =============================================================================
// PCL ROW TYPE
// =============================================================================

interface PCLRow {
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
}

// =============================================================================
// ROW EXTRACTORS
// =============================================================================

function extractStandardRows(rawData: any[][], headerRowIndex: number, CI: StandardColumnIndices): PCLRow[] {
  const rows: PCLRow[] = [];
  const dataRows = rawData.slice(headerRowIndex + 1);

  for (const row of dataRows) {
    if (!row[0]) continue;

    rows.push({
      routeCode: cell(row, CI.ROUTE_CODE),
      firstName: cell(row, CI.FIRST_NAME),
      lastName: cell(row, CI.LAST_NAME),
      houseNum: cell(row, CI.HOUSE_NUM),
      streetName: cell(row, CI.STREET_NAME),
      phone: formatPhoneStandard(cell(row, CI.PHONE)),
      city: cell(row, CI.CITY),
      service: interpretFOService(row, CI.FO),
      price: formatPrice(cell(row, CI.PRICE)),
      contractor: cell(row, CI.CONTRACTOR),
      date: formatDate(cell(row, CI.DATE)),
      year: cell(row, CI.YEAR),
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
    });
  }

  return rows;
}

// =============================================================================
// MAIN PCL FUNCTION
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
        const rows = extractStandardRows(rawData, headerRowIndex, CI);
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

  // --- Group by Route Code ---
  onProgress?.({ phase: 'Grouping', detail: `Grouping ${allRows.length.toLocaleString()} rows by route code...`, percent: 68 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const routeGroups: { routeCode: string; rows: PCLRow[] }[] = [];
  let currentRC = '';
  let currentGroup: PCLRow[] = [];

  for (const row of allRows) {
    const rc = row.routeCode || '(No Route)';
    if (rc !== currentRC) {
      if (currentGroup.length > 0) {
        routeGroups.push({ routeCode: currentRC, rows: currentGroup });
      }
      currentRC = rc;
      currentGroup = [];
    }
    currentGroup.push(row);
  }
  if (currentGroup.length > 0) {
    routeGroups.push({ routeCode: currentRC, rows: currentGroup });
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

    autoTable(doc, {
      head: [headerLabels],
      body: tableRows,
      startY: 20,
      margin: { left: 14, right: 14, top: 20, bottom: 20 },
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 3,
        overflow: 'linebreak',
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
      alternateRowStyles: {
        fillColor: [245, 245, 245],
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
        9: { cellWidth: colWidths[9], overflow: 'linebreak' },
        10: { cellWidth: colWidths[10] },
        11: { cellWidth: colWidths[11], halign: 'center' },
      },
      didParseCell: function (data: any) {
        const cellText = String(data.cell.text?.join?.('') || data.cell.text || '');
        const colW = colWidths[data.column.index] || 60;
        const estimatedWidth = cellText.length * 3.5;
        if (estimatedWidth > colW && data.section === 'body') {
          const ratio = colW / estimatedWidth;
          const newSize = Math.max(5, Math.round(7 * ratio * 10) / 10);
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