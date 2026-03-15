// src/lib/payslipExport.ts
import ExcelJS from 'exceljs';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayslipDayRow {
  date: string;
  manager: string;
  steps: number;
  equiv: number;
  totalPrepay: number;
  payoutRate: number;
  aerComm: number;
  upsellComm: number; // stored but not shown on payslip
  machRent: number;
  deductions: number;
  dailyBonus: number;
  totalPayout: number;
}

export interface ExtraItem {
  id: string;
  label: string;
  amount: number;
}

export interface WorkerPayslipData {
  contractorId: string;
  firstName: string;
  lastName: string;
  is120Program: boolean;
  days: PayslipDayRow[];
  hotels: number;
  advances: number;
  travelPkg: number;
  extraDeductions: ExtraItem[];
  additions: ExtraItem[];
}

export interface WorkerPayslipUI {
  contractorId: string;
  firstName: string;
  lastName: string;
  days: PayslipDayRow[];
}

// ─── Payout Stats column indices (0-based) ───────────────────────────────────

const PS = {
  date: 0,
  contractorId: 1,
  firstName: 2,
  lastName: 3,
  manager: 4,
  stepCount: 5,
  totalEQ: 17,
  totalPrepay: 25,
  payoutRate: 26,
  aerComm: 27,
  upsellComm: 28,
  machRent: 30,
  deductions: 31,
  dailyBonus: 32,
  totalPayout: 33,
};

// ─── Layout constants (matching template exactly) ────────────────────────────
//
// 11 columns (UPSELL COMM removed):
//   A=DATE  B=ROUTE MANAGER  C=AER STEPS  D=EQUIV  E=TOTAL PREPAY
//   F=PAYOUT RATE  G=AER COMM  H=MACH RENT  I=DEDUCTIONS  J=DAILY BONUS  K=TOTAL PAYOUT
//
// Summary column positions (shifted -1 vs template due to removed col H):
//   Left label  = col F (6)    Left value  = col H (8)
//   Right label = col I (9)    Right value = col K (11)
//
// Block structure per payslip = 17 rows:
//   Row 1:        Name header
//   Row 2:        Column headers
//   Rows 3–10:    Up to 8 data rows (padded with blanks)
//   Rows 11–15:   5 summary rows (GI, Hotels, Advances, Travel Pkg, Final Pay)
//                 + Earned Comm / Training Bump on left if 120 Program
//   Rows 16–17:   2 blank trailing rows (spacing between payslips)
//
// Page breaks (3 per page, short range) every 51 rows = 3 × 17
// Page breaks (2 per page, long range)  every 34 rows = 2 × 17
//
// Row heights: name=23.6, headers=25.95, all others=15.9
// Page setup:  portrait, scale=70

const NCOLS       = 11;
const ROWS_PER_BLOCK = 17; // always fixed: 1+1+8+5+2 (with padding/blank rows)
const H_NAME      = 23.6;
const H_HEADER    = 25.95;
const H_STD       = 15.9;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function formatDate(s: string): string {
  const day = parseInt(s.slice(3), 10);
  return `${day}-${s.slice(0, 3)}`;
}

function sortKey(s: string): number {
  const m: Record<string, number> = {
    Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
    Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
  };
  return (m[s.slice(0, 3)] || 0) * 100 + parseInt(s.slice(3), 10);
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const FMT_CURRENCY = '$#,##0.00';
const FMT_NUMBER   = '0.00';

function sc(
  cell: ExcelJS.Cell,
  opts: {
    font?:      Partial<ExcelJS.Font>;
    fill?:      ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    numFmt?:    string;
    border?:    Partial<ExcelJS.Borders>;
  }
) {
  if (opts.font)      cell.font      = opts.font as ExcelJS.Font;
  if (opts.fill)      cell.fill      = opts.fill;
  if (opts.alignment) cell.alignment = opts.alignment;
  if (opts.numFmt)    cell.numFmt    = opts.numFmt;
  if (opts.border)    cell.border    = opts.border as ExcelJS.Borders;
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const ALIGN_CENTER = { horizontal: 'center' as const, vertical: 'middle' as const };
const ALIGN_LEFT   = { horizontal: 'left'   as const, vertical: 'middle' as const };
const ALIGN_RIGHT  = { horizontal: 'right'  as const, vertical: 'middle' as const };
const ALIGN_CENTER_WRAP = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  left:   { style: 'thin', color: { argb: 'FF999999' } },
  right:  { style: 'thin', color: { argb: 'FF999999' } },
};

// ─── Parse Payout Stats rows ──────────────────────────────────────────────────

export function parsePayoutStatsRows(
  rows: any[][],
  startDate: string,
  endDate: string
): WorkerPayslipUI[] {
  const startKey = sortKey(startDate);
  const endKey   = sortKey(endDate);
  const map = new Map<string, WorkerPayslipUI>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[PS.date] || !row[PS.contractorId]) continue;
    const dateStr = String(row[PS.date]).trim();
    const dk = sortKey(dateStr);
    if (dk < startKey || dk > endKey) continue;

    const id = String(row[PS.contractorId]).trim();
    if (!map.has(id)) {
      map.set(id, {
        contractorId: id,
        firstName: String(row[PS.firstName] || '').trim(),
        lastName:  String(row[PS.lastName]  || '').trim(),
        days: [],
      });
    }
    map.get(id)!.days.push({
      date:        dateStr,
      manager:     String(row[PS.manager]    || '').trim(),
      steps:       Number(row[PS.stepCount]) || 0,
      equiv:       Number(row[PS.totalEQ])   || 0,
      totalPrepay: Number(row[PS.totalPrepay])|| 0,
      payoutRate:  Number(row[PS.payoutRate]) || 0,
      aerComm:     Number(row[PS.aerComm])   || 0,
      upsellComm:  Number(row[PS.upsellComm])|| 0,
      machRent:    Number(row[PS.machRent])  || 0,
      deductions:  Number(row[PS.deductions])|| 0,
      dailyBonus:  Number(row[PS.dailyBonus])|| 0,
      totalPayout: Number(row[PS.totalPayout])|| 0,
    });
  }

  map.forEach(w => w.days.sort((a, b) => sortKey(a.date) - sortKey(b.date)));
  return Array.from(map.values()).sort((a, b) => a.contractorId.localeCompare(b.contractorId));
}

// ─── Excel generation ─────────────────────────────────────────────────────────

export async function generatePayslipsXLSX(
  workers: WorkerPayslipData[],
  startDate: string,
  endDate: string,
  ccDisplayName: string,
  totalDaysInRange: number
): Promise<void> {
  const isLong  = totalDaysInRange > 7;
  const perPage = isLong ? 2 : 3;

  // For long ranges we use 16 data rows; for short 8.
  // But block height is always 17 rows (the fixed summary+blank padding never changes).
  // Only the data section changes; we still pad/blank to fill the 8 or 16 slots.
  const maxDataRows = isLong ? 16 : 8;
  // Long range: 1+1+16+5+2 = 25 rows per block, 2 per page → break every 50
  // Short range: 1+1+8+5+2  = 17 rows per block, 3 per page → break every 51
  const rowsPerBlock = 1 + 1 + maxDataRows + 5 + 2;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payslips');

  // Column widths — matched to template (adjusted for removed UPSELL COMM col)
  ws.columns = [
    { key: 'A', width: 9.14  }, // A DATE
    { key: 'B', width: 15.14 }, // B ROUTE MANAGER
    { key: 'C', width: 9.14  }, // C AER STEPS
    { key: 'D', width: 9.14  }, // D EQUIV
    { key: 'E', width: 11.0  }, // E TOTAL PREPAY
    { key: 'F', width: 9.14  }, // F PAYOUT RATE / left summary label
    { key: 'G', width: 9.14  }, // G AER COMM
    { key: 'H', width: 10.0  }, // H MACH RENT / left summary value
    { key: 'I', width: 9.14  }, // I DEDUCTIONS / right summary label
    { key: 'J', width: 13.0  }, // J DAILY BONUS
    { key: 'K', width: 13.5  }, // K TOTAL PAYOUT / right summary value
  ];

  const pageBreakRows: number[] = [];
  let currentRow = 0; // 0-based; ExcelJS rows are 1-based so we use currentRow+1
  let pageCount  = 0;

  workers.forEach(worker => {
    // ── Calculations ──
    const earnedComm   = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
    const daysWorked   = worker.days.length;
    const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked * 120 - earnedComm)) : 0;
    const gi           = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
    const finalPay     = r2(
      gi
      - worker.hotels
      - worker.advances
      - worker.travelPkg
      - worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
      + worker.additions.reduce((s, a)       => s + a.amount, 0)
    );

    // ── ROW 1: Worker name header (merged A:K) ──
    currentRow++;
    const nameRow = ws.addRow([`${worker.contractorId} - ${worker.firstName} ${worker.lastName}`]);
    nameRow.height = H_NAME;
    ws.mergeCells(currentRow, 1, currentRow, NCOLS);
    for (let c = 1; c <= NCOLS; c++) {
      sc(nameRow.getCell(c), {
        font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 13, name: 'Arial' },
        fill:      solidFill('FF1A1A1A'),
        alignment: ALIGN_CENTER,
      });
    }

    // ── ROW 2: Column headers ──
    currentRow++;
    const hdrRow = ws.addRow([
      'DATE', 'ROUTE\nMANAGER', 'AER\nSTEPS', 'EQUIV',
      'TOTAL\nPREPAY', 'PAYOUT\nRATE', 'AER COMM',
      'MACH\nRENT', 'DEDUCTIONS', 'DAILY\nBONUS', 'TOTAL\nPAYOUT',
    ]);
    hdrRow.height = H_HEADER;
    for (let c = 1; c <= NCOLS; c++) {
      sc(hdrRow.getCell(c), {
        font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 9, name: 'Arial' },
        fill:      solidFill(c === 3 ? 'FF538135' : 'FFC00000'),
        alignment: ALIGN_CENTER_WRAP,
      });
    }

    // ── DATA ROWS (padded to maxDataRows) ──
    for (let i = 0; i < maxDataRows; i++) {
      currentRow++;
      const d = worker.days[i];
      const dataRow = ws.addRow(d ? [
        formatDate(d.date),
        d.manager,
        d.steps      || null,
        d.equiv      ? r2(d.equiv)      : null,
        d.totalPrepay? r2(d.totalPrepay): null,
        d.payoutRate || null,
        d.aerComm    ? r2(d.aerComm)    : null,
        d.machRent   || null,
        d.deductions || null,
        d.dailyBonus || null,
        r2(d.totalPayout),
      ] : Array(NCOLS).fill(null));
      dataRow.height = H_STD;

      if (d) {
        const f = { name: 'Arial', size: 10 } as Partial<ExcelJS.Font>;
        sc(dataRow.getCell(1),  { font: f, alignment: ALIGN_LEFT });
        sc(dataRow.getCell(2),  { font: f, alignment: ALIGN_LEFT });
        sc(dataRow.getCell(3),  { font: f, alignment: ALIGN_CENTER });
        sc(dataRow.getCell(4),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_NUMBER });
        if (d.totalPrepay) sc(dataRow.getCell(5), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        sc(dataRow.getCell(6),  { font: f, alignment: ALIGN_CENTER });
        if (d.aerComm)    sc(dataRow.getCell(7),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        if (d.machRent)   sc(dataRow.getCell(8),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        if (d.deductions) sc(dataRow.getCell(9),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        if (d.dailyBonus) sc(dataRow.getCell(10), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        sc(dataRow.getCell(11), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
      }
    }

    // ── SUMMARY ROWS (always exactly 5 to keep block height fixed) ──
    // Right side: GI, Hotels, Advances, Travel Pkg, Final Pay (fixed 5 rows)
    // Left side (120 program only): Earned Comm (row 0), Training Bump (row 1)
    // Extra deductions/additions overflow onto left side cols to avoid expanding block height
    const rightFixed = [
      { label: 'Guaranteed Income', value: gi },
      { label: 'Hotels',            value: worker.hotels },
      { label: 'Advances',          value: worker.advances },
      { label: 'Travel Pkg',        value: worker.travelPkg },
      { label: 'Final Pay:',        value: finalPay },
    ];

    // Build left side items
    const leftItems: { label: string; value: number }[] = [];
    if (worker.is120Program) {
      leftItems.push({ label: 'Earned Commission', value: earnedComm });
      leftItems.push({ label: 'Training Bump',     value: trainingBump });
    }
    // Extra deductions and additions go into left side overflow rows
    worker.extraDeductions.forEach(d => leftItems.push({ label: d.label || 'Deduction', value: d.amount }));
    worker.additions.forEach(a       => leftItems.push({ label: a.label || 'Addition',  value: a.amount }));

    for (let i = 0; i < 5; i++) {
      currentRow++;
      const right = rightFixed[i];
      const left  = leftItems[i];
      const isFinal = right.label === 'Final Pay:';

      const rowData: (string | number | null)[] = Array(NCOLS).fill(null);
      if (left) {
        rowData[5] = left.label;  // col F
        rowData[7] = left.value;  // col H
      }
      rowData[8]  = right.label;  // col I
      rowData[10] = right.value;  // col K

      const sumRow = ws.addRow(rowData);
      sumRow.height = H_STD;

      const fReg  = { name: 'Arial', size: 10 } as Partial<ExcelJS.Font>;
      const fBold = { bold: true, name: 'Arial', size: isFinal ? 12 : 10 } as Partial<ExcelJS.Font>;

      // Left box (only when content present)
      if (left) {
        sc(sumRow.getCell(6), {
          font:      fReg,
          fill:      solidFill('FFF2F2F2'),
          alignment: ALIGN_RIGHT,
          border:    BORDER_THIN,
        });
        sc(sumRow.getCell(8), {
          font:      { bold: true, name: 'Arial', size: 10 } as Partial<ExcelJS.Font>,
          fill:      solidFill('FFF2F2F2'),
          alignment: ALIGN_RIGHT,
          numFmt:    FMT_CURRENCY,
          border:    BORDER_THIN,
        });
      }

      // Right box
      sc(sumRow.getCell(9), {
        font:      isFinal ? { bold: true, name: 'Arial', size: 11 } as Partial<ExcelJS.Font> : fReg,
        fill:      solidFill(isFinal ? 'FFBFBFBF' : 'FFD9D9D9'),
        alignment: ALIGN_RIGHT,
      });
      sc(sumRow.getCell(11), {
        font:      fBold,
        fill:      solidFill(isFinal ? 'FFBFBFBF' : 'FFD9D9D9'),
        alignment: ALIGN_RIGHT,
        numFmt:    FMT_CURRENCY,
      });
    }

    // ── 2 BLANK TRAILING ROWS (spacing between payslips) ──
    for (let i = 0; i < 2; i++) {
      currentRow++;
      const blankRow = ws.addRow(Array(NCOLS).fill(null));
      blankRow.height = H_STD;
    }

    // ── Page break after every N workers ──
    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      pageBreakRows.push(currentRow);
    }
  });

  // ─── Page breaks ──────────────────────────────────────────────────────────
  if (pageBreakRows.length > 0) {
    (ws as any).rowBreaks = pageBreakRows.map(id => ({
      id,
      min: 0,
      max: 16383,
      man: true,
    }));
  }

  // ─── Page setup (portrait, 70% scale — matching template) ────────────────
  ws.pageSetup = {
    paperSize:    9,          // Letter
    orientation:  'portrait',
    scale:        70,
    fitToPage:    false,
  };

  // ─── Download ─────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `${ccDisplayName} ${startDate} - ${endDate} Payslips.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}