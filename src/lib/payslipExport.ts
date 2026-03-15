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
  upsellComm: number;
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

// ─── Layout — exact match to template ────────────────────────────────────────
//
// 12 columns matching template exactly (col H = UPSELL COMM, hidden, width=0):
//   A=DATE  B=ROUTE MANAGER  C=AER STEPS  D=EQUIV  E=TOTAL PREPAY
//   F=PAYOUT RATE  G=AER COMM  H=UPSELL COMM(hidden)  I=MACH RENT
//   J=DEDUCTIONS  K=DAILY BONUS  L=TOTAL PAYOUT
//
// Summary column positions (exact match to template):
//   Left label  = F:G merged (cols 6-7)
//   Left value  = col I (9)
//   Right label = J:K merged (cols 10-11)
//   Right value = col L (12)
//
// Block structure: 17 rows
//   Row 1:      Name header (merged A:L)
//   Row 2:      Column headers
//   Rows 3–10:  8 data rows (padded)
//   Rows 11–15: 5 summary rows
//   Rows 16–17: 2 blank trailing rows
//
// Page breaks: every 51 rows (3×17) for short range, every 34 rows (2×17) for long

const NCOLS       = 12;
const H_NAME      = 23.6;
const H_HEADER    = 25.95;
const H_STD       = 15.9;

// Column header fill colors (exact from template)
const HDR_FILLS: Record<number, string> = {
  1:  'FFCC0000', // A  DATE            red
  2:  'FFCC0000', // B  ROUTE MANAGER   red
  3:  'FFB6D7A8', // C  AER STEPS       light green
  4:  'FF666666', // D  EQUIV           dark gray
  5:  'FF666666', // E  TOTAL PREPAY    dark gray
  6:  'FF666666', // F  PAYOUT RATE     dark gray
  7:  'FF666666', // G  AER COMM        dark gray
  8:  'FF666666', // H  UPSELL COMM     dark gray (hidden)
  9:  'FFCC0000', // I  MACH RENT       red
  10: 'FFCC0000', // J  DEDUCTIONS      red
  11: 'FFCC0000', // K  DAILY BONUS     red
  12: 'FF660000', // L  TOTAL PAYOUT    dark red
};

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

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

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

const FMT_CURRENCY = '$#,##0.00';
const FMT_NUMBER   = '0.00';

const ALIGN_CENTER      = { horizontal: 'center' as const, vertical: 'middle' as const };
const ALIGN_CENTER_WRAP = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
const ALIGN_RIGHT_WRAP  = { horizontal: 'right'  as const, vertical: 'middle' as const, wrapText: true };
const ALIGN_LEFT        = { horizontal: 'left'   as const, vertical: 'middle' as const };
const ALIGN_RIGHT       = { horizontal: 'right'  as const, vertical: 'middle' as const };

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
  const isLong      = totalDaysInRange > 7;
  const maxDataRows = isLong ? 16 : 8;
  const perPage     = isLong ? 2 : 3;
  // rows per block = 1 (name) + 1 (headers) + maxDataRows + 5 (summary) + 2 (blank)
  const rowsPerBlock = 1 + 1 + maxDataRows + 5 + 2;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payslips');

  // ─── Column definitions — exact match to template ──────────────────────────
  ws.columns = [
    { key: 'A', width: 9.14  }, // A  DATE
    { key: 'B', width: 15.14 }, // B  ROUTE MANAGER
    { key: 'C', width: 9.14  }, // C  AER STEPS
    { key: 'D', width: 13.0  }, // D  EQUIV
    { key: 'E', width: 11.0  }, // E  TOTAL PREPAY
    { key: 'F', width: 9.14  }, // F  PAYOUT RATE
    { key: 'G', width: 13.0  }, // G  AER COMM
    { key: 'H', width: 0,  hidden: true }, // H  UPSELL COMM (hidden like template)
    { key: 'I', width: 10.0  }, // I  MACH RENT
    { key: 'J', width: 9.14  }, // J  DEDUCTIONS
    { key: 'K', width: 13.0  }, // K  DAILY BONUS
    { key: 'L', width: 13.5  }, // L  TOTAL PAYOUT
  ];

  const pageBreakRows: number[] = [];
  let currentRow = 0;
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

    // ── ROW 1: Worker name header (merged A:L) ──
    currentRow++;
    const nameRow = ws.addRow([
      `${worker.contractorId} - ${worker.firstName} ${worker.lastName}`,
      null, null, null, null, null, null, null, null, null, null, null,
    ]);
    nameRow.height = H_NAME;
    ws.mergeCells(currentRow, 1, currentRow, NCOLS);
    // Style every cell in the merge so the fill covers all
    for (let c = 1; c <= NCOLS; c++) {
      sc(nameRow.getCell(c), {
        font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 18, name: 'Arial' },
        fill:      solidFill('FF1A1A1A'),
        alignment: ALIGN_CENTER,
      });
    }

    // ── ROW 2: Column headers ──
    currentRow++;
    const hdrRow = ws.addRow([
      'DATE', 'ROUTE MANAGER', 'AER STEPS', 'EQUIV',
      'TOTAL PREPAY', 'PAYOUT RATE', 'AER COMM', 'UPSELL COMM',
      'MACH RENT', 'DEDUCTIONS', 'DAILY BONUS', 'TOTAL PAYOUT',
    ]);
    hdrRow.height = H_HEADER;
    for (let c = 1; c <= NCOLS; c++) {
      const alignForCol = c === 3 ? ALIGN_RIGHT_WRAP : ALIGN_CENTER_WRAP;
      sc(hdrRow.getCell(c), {
        font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' },
        fill:      solidFill(HDR_FILLS[c]),
        alignment: alignForCol,
      });
    }

    // ── DATA ROWS (padded to maxDataRows) ──
    for (let i = 0; i < maxDataRows; i++) {
      currentRow++;
      const d = worker.days[i];
      const dataRow = ws.addRow(d ? [
        formatDate(d.date),   // A
        d.manager,            // B
        d.steps    || null,   // C
        d.equiv    ? r2(d.equiv)    : null, // D
        d.totalPrepay ? r2(d.totalPrepay) : null, // E
        d.payoutRate || null, // F
        d.aerComm  ? r2(d.aerComm)  : null, // G
        d.upsellComm ? r2(d.upsellComm) : null, // H (hidden)
        d.machRent || null,   // I
        d.deductions || null, // J
        d.dailyBonus || null, // K
        r2(d.totalPayout),    // L
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
        if (d.aerComm)     sc(dataRow.getCell(7),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        // col 8 (H) hidden — no styling needed
        if (d.machRent)    sc(dataRow.getCell(9),  { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        if (d.deductions)  sc(dataRow.getCell(10), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        if (d.dailyBonus)  sc(dataRow.getCell(11), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
        sc(dataRow.getCell(12), { font: f, alignment: ALIGN_RIGHT, numFmt: FMT_CURRENCY });
      }
    }

    // ── SUMMARY ROWS (always exactly 5) ──
    //
    // Template layout:
    //   Row 1: [F:G]=left label  [I]=left value  [J:K]=right label  [L]=right value
    //   Row 2: [F:G]=left label  [I]=left value  [J:K]=right label  [L]=right value
    //   Row 3:                                   [J:K]=right label  [L]=right value
    //   Row 4:                                   [J:K]=right label  [L]=right value
    //   Row 5:                                   [J:K]=right label  [L]=right value
    //
    // Right side fixed: GI, Hotels, Advances, Travel Pkg, Final Pay
    // Left side (120 Program): Earned Commission, Training Bump (rows 1-2)
    // Extra deductions/additions spill into left side rows 1+ if available

    const rightFixed = [
      { label: 'Guaranteed Income', value: gi },
      { label: 'Hotels',            value: worker.hotels },
      { label: 'Advances',          value: worker.advances },
      { label: 'Travel Pkg',        value: worker.travelPkg },
      { label: 'Final Pay:',        value: finalPay },
    ];

    const leftItems: { label: string; value: number }[] = [];
    if (worker.is120Program) {
      leftItems.push({ label: 'Earned Commission', value: earnedComm });
      leftItems.push({ label: 'Training Bump',     value: trainingBump });
    }
    worker.extraDeductions.forEach(d => leftItems.push({ label: d.label || 'Deduction', value: d.amount }));
    worker.additions.forEach(a       => leftItems.push({ label: a.label || 'Addition',  value: a.amount }));

    for (let i = 0; i < 5; i++) {
      currentRow++;
      const right   = rightFixed[i];
      const left    = leftItems[i];
      const isFinal = right.label === 'Final Pay:';

      const rowData: (string | number | null)[] = Array(NCOLS).fill(null);
      if (left) {
        rowData[5] = left.label;  // col F (1-indexed: 6, but array is 0-indexed)
        rowData[8] = left.value;  // col I
      }
      rowData[9]  = right.label;  // col J
      rowData[11] = right.value;  // col L

      const sumRow = ws.addRow(rowData);
      sumRow.height = H_STD;

      // Merge F:G for left label (cols 6-7)
      if (left) {
        ws.mergeCells(currentRow, 6, currentRow, 7);
        sc(sumRow.getCell(6), {
          font:      { name: 'Arial', size: 12 } as Partial<ExcelJS.Font>,
          alignment: ALIGN_RIGHT,
          border:    BORDER_THIN,
        });
        sc(sumRow.getCell(9), {
          font:      { bold: true, name: 'Arial', size: 12 } as Partial<ExcelJS.Font>,
          alignment: ALIGN_RIGHT,
          numFmt:    FMT_CURRENCY,
          border:    BORDER_THIN,
        });
      }

      // Merge J:K for right label (cols 10-11)
      ws.mergeCells(currentRow, 10, currentRow, 11);
      sc(sumRow.getCell(10), {
        font:      { bold: isFinal, name: 'Arial', size: 12 } as Partial<ExcelJS.Font>,
        alignment: ALIGN_RIGHT,
      });
      // Right value — col L (12)
      sc(sumRow.getCell(12), {
        font:      { bold: true, name: 'Arial', size: isFinal ? 16 : 12 } as Partial<ExcelJS.Font>,
        alignment: ALIGN_RIGHT,
        numFmt:    FMT_CURRENCY,
      });
    }

    // ── 2 BLANK TRAILING ROWS ──
    for (let i = 0; i < 2; i++) {
      currentRow++;
      ws.addRow(Array(NCOLS).fill(null)).height = H_STD;
    }

    // ── Page break after every N workers ──
    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      pageBreakRows.push(currentRow);
    }
  });

  // ─── Page breaks (matching template format exactly) ───────────────────────
  if (pageBreakRows.length > 0) {
    (ws as any).rowBreaks = pageBreakRows.map(id => ({
      id,
      min: 0,
      max: 16383,
      man: true,
    }));
  }

  // ─── Page setup — portrait, scale 70% (matching template) ────────────────
  ws.pageSetup = {
    paperSize:   9,          // Letter
    orientation: 'portrait',
    scale:       70,
    fitToPage:   false,
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