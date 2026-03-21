// src/lib/pclService.ts
//
// PCL (Previous Client List) PDF Generator.
// Reads all tabs from a callbook spreadsheet, collects every row,
// sorts by Route Code → Street → House # → Year, and generates
// a downloadable PDF with page breaks between route codes.
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
  errorMessage?: string;
}

// =============================================================================
// HEADER RESOLUTION (lightweight — only what PCL needs)
// =============================================================================

interface PCLColumnIndices {
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

function resolvePCLHeaders(headers: any[]): PCLColumnIndices {
  const CI: PCLColumnIndices = {
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

function findPCLHeaderRow(rawData: any[][]): { headerRowIndex: number; CI: PCLColumnIndices } | null {
  const scanLimit = Math.min(10, rawData.length);
  for (let r = 0; r < scanLimit; r++) {
    const CI = resolvePCLHeaders(rawData[r]);
    if (CI.PHONE >= 0) {
      return { headerRowIndex: r, CI };
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

/** Format a raw phone value as "000 000 0000". */
function formatPhone(raw: string): string {
  let s = raw;
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  const digits = d.length > 10 ? d.slice(-10) : d;
  if (digits.length === 10) {
    return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
  }
  // If not 10 digits, return cleaned version as-is
  return digits || raw;
}

/** Interpret the FO column into service type. */
function interpretService(row: any[], foCol: number): string {
  const v = cell(row, foCol).toUpperCase();
  if (v === 'X' || v === 'FO') return 'FO';
  if (v === 'BO') return 'BO';
  return 'FP';
}

/** Format a date value for display. */
function formatDate(raw: string): string {
  if (!raw) return '';
  // If it looks like an ISO date (2025-04-13 00:00:00), format it short
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    return `${d}-${months[m] || isoMatch[2]}`;
  }
  return raw;
}

/** Parse a year value. */
function parseYear(val: string): number {
  const n = parseInt(val, 10);
  return !isNaN(n) && n >= 2000 && n <= 2100 ? n : 0;
}

/** Parse a house number for numeric sorting. */
function parseHouseNum(val: string): number {
  const n = parseInt(val.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/** Format price for display. */
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
// MAIN PCL FUNCTION
// =============================================================================

export async function generatePCL(
  book: CampaignBook,
  onProgress?: (progress: PCLProgress) => void
): Promise<PCLResult> {
  // --- Ensure Google Sheets authentication ---
  if (!dialerSheetsService.isAuthenticated()) {
    onProgress?.({ phase: 'Authenticating', detail: 'Connecting to Google Sheets...', percent: 2 });
    try {
      const authed = await dialerSheetsService.authenticate();
      if (!authed) {
        return {
          success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0,
          errorMessage: 'Google Sheets authentication was cancelled or failed. Please try again.',
        };
      }
    } catch (err: any) {
      return {
        success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0,
        errorMessage: 'Google Sheets authentication failed: ' + (err.message || 'Unknown error'),
      };
    }
  }

  const callbookId = book.spreadsheetId;

  // --- Step 1: Get tab list ---
  onProgress?.({ phase: 'Loading', detail: 'Fetching tab list...', percent: 5 });

  let tabs: string[];
  try {
    tabs = await dialerSheetsService.getCallbookTabs(callbookId);
  } catch (err: any) {
    return {
      success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0,
      errorMessage: 'Failed to read callbook tabs: ' + (err.message || 'Unknown error'),
    };
  }

  if (tabs.length === 0) {
    return {
      success: false, totalRows: 0, routeCodes: 0, tabsScanned: 0,
      errorMessage: 'No data tabs found in the callbook spreadsheet.',
    };
  }

  // --- Step 2: Scan all tabs and collect rows ---
  const allRows: PCLRow[] = [];

  for (let t = 0; t < tabs.length; t++) {
    const tabName = tabs[t];
    const pct = 10 + Math.round((t / tabs.length) * 50);
    onProgress?.({ phase: 'Scanning', detail: `Reading "${tabName}"...`, percent: pct });

    let rawData: any[][];
    try {
      rawData = await dialerSheetsService.sheetsGet(callbookId, `'${tabName}'`);
    } catch {
      continue;
    }

    if (!rawData || rawData.length < 2) continue;

    const headerResult = findPCLHeaderRow(rawData);
    if (!headerResult) continue;

    const { headerRowIndex, CI } = headerResult;
    const dataRows = rawData.slice(headerRowIndex + 1);

    for (const row of dataRows) {
      // Skip truly empty rows (no data in first cell)
      if (!row[0]) continue;

      const phone = cell(row, CI.PHONE);
      // Must have some identifying data to be worth including
      const firstName = cell(row, CI.FIRST_NAME);
      const lastName = cell(row, CI.LAST_NAME);
      const streetName = cell(row, CI.STREET_NAME);

      allRows.push({
        routeCode: cell(row, CI.ROUTE_CODE),
        firstName,
        lastName,
        houseNum: cell(row, CI.HOUSE_NUM),
        streetName,
        phone: formatPhone(phone),
        city: cell(row, CI.CITY),
        service: interpretService(row, CI.FO),
        price: formatPrice(cell(row, CI.PRICE)),
        contractor: cell(row, CI.CONTRACTOR),
        date: formatDate(cell(row, CI.DATE)),
        year: cell(row, CI.YEAR),
      });
    }
  }

  if (allRows.length === 0) {
    return {
      success: false, totalRows: 0, routeCodes: 0, tabsScanned: tabs.length,
      errorMessage: 'No data rows found across all tabs.',
    };
  }

  // --- Step 3: Sort rows ---
  onProgress?.({ phase: 'Sorting', detail: 'Organizing data...', percent: 65 });

  allRows.sort((a, b) => {
    // 1. Route Code — empty routes go to the end
    const rcA = a.routeCode || '\uffff';
    const rcB = b.routeCode || '\uffff';
    if (rcA !== rcB) return rcA.localeCompare(rcB);

    // 2. Street Name
    const stA = a.streetName.toLowerCase();
    const stB = b.streetName.toLowerCase();
    if (stA !== stB) return stA.localeCompare(stB);

    // 3. House # (numeric)
    const hnA = parseHouseNum(a.houseNum);
    const hnB = parseHouseNum(b.houseNum);
    if (hnA !== hnB) return hnA - hnB;

    // 4. Year
    const yrA = parseYear(a.year);
    const yrB = parseYear(b.year);
    return yrA - yrB;
  });

  // --- Step 4: Group by Route Code ---
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

  // --- Step 5: Generate PDF ---
  onProgress?.({ phase: 'Generating', detail: 'Building PDF...', percent: 70 });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });

  const headerLabels = ['RC', 'FIRSTNAME', 'LASTNAME', 'HOUSE #', 'STREET NAME', 'PHONE #', 'City', 'Service', 'Price', 'Contractor', 'Date', 'Year'];

  // Column widths (proportional — landscape letter = ~792pt usable)
  const colWidths = [42, 68, 68, 42, 90, 78, 58, 40, 52, 110, 48, 36];

  for (let g = 0; g < routeGroups.length; g++) {
    const group = routeGroups[g];

    if (g > 0) {
      doc.addPage();
    }

    const pct = 70 + Math.round(((g + 1) / routeGroups.length) * 25);
    onProgress?.({ phase: 'Generating', detail: `Route ${group.routeCode} (${g + 1}/${routeGroups.length})...`, percent: pct });

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
        // Shrink-to-fit: if content is too long, reduce font size
        const cellText = String(data.cell.text?.join?.('') || data.cell.text || '');
        const colW = colWidths[data.column.index] || 60;
        // Rough heuristic: if text width exceeds cell, shrink
        const estimatedWidth = cellText.length * 3.5; // ~3.5pt per char at 7pt font
        if (estimatedWidth > colW && data.section === 'body') {
          const ratio = colW / estimatedWidth;
          const newSize = Math.max(5, Math.round(7 * ratio * 10) / 10);
          data.cell.styles.fontSize = newSize;
        }
      },
    });
  }

  // --- Step 6: Download ---
  onProgress?.({ phase: 'Downloading', detail: 'Saving PDF...', percent: 97 });

  const today = new Date();
  const dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  const safeName = book.displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `PCL_${safeName}_${dateStr}.pdf`;

  doc.save(filename);

  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });

  return {
    success: true,
    totalRows: allRows.length,
    routeCodes: routeGroups.length,
    tabsScanned: tabs.length,
  };
}