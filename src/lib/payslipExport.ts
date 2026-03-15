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

// ─── ExcelJS style helpers ────────────────────────────────────────────────────

// 11 columns (no UPSELL COMM):
// A=DATE, B=ROUTE MANAGER, C=AER STEPS, D=EQUIV, E=TOTAL PREPAY,
// F=PAYOUT RATE, G=AER COMM, H=MACH RENT, I=DEDUCTIONS, J=DAILY BONUS, K=TOTAL PAYOUT
//
// Summary layout (matching template positions, shifted -1 for removed UPSELL COMM col):
//   Left label  = col F (6)    Left value  = col H (8)
//   Right label = col I (9)    Right value = col K (11)
// ExcelJS getCell() is 1-indexed

const NCOLS = 11;

const FILL = {
  dark:      (c: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: c } }),
  none:      () => ({ type: 'pattern' as const, pattern: 'none' as const }),
};

const FONT = {
  bold:      (argb: string, sz = 10) => ({ bold: true, color: { argb }, size: sz, name: 'Arial' }),
  regular:   (argb = 'FF000000', sz = 10) => ({ color: { argb }, size: sz, name: 'Arial' }),
};

const ALIGN = {
  center:    { horizontal: 'center' as const, vertical: 'middle' as const },
  left:      { horizontal: 'left' as const,   vertical: 'middle' as const },
  right:     { horizontal: 'right' as const,  vertical: 'middle' as const },
  centerWrap:{ horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
};

const BORDER_THIN = {
  top:    { style: 'thin' as const, color: { argb: 'FF999999' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF999999' } },
  left:   { style: 'thin' as const, color: { argb: 'FF999999' } },
  right:  { style: 'thin' as const, color: { argb: 'FF999999' } },
};

const FMT_CURRENCY = '$#,##0.00';
const FMT_NUMBER   = '0.00';

function styleCell(
  cell: ExcelJS.Cell,
  opts: {
    font?: Partial<ExcelJS.Font>;
    fill?: ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    numFmt?: string;
    border?: Partial<ExcelJS.Borders>;
  }
) {
  if (opts.font)      cell.font      = opts.font as ExcelJS.Font;
  if (opts.fill)      cell.fill      = opts.fill;
  if (opts.alignment) cell.alignment = opts.alignment;
  if (opts.numFmt)    cell.numFmt    = opts.numFmt;
  if (opts.border)    cell.border    = opts.border as ExcelJS.Borders;
}

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
      manager:     String(row[PS.manager]   || '').trim(),
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
  const isLong     = totalDaysInRange > 7;
  const maxDataRows = isLong ? 16 : 8;
  const perPage    = isLong ? 2 : 3;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payslips');

  // Column widths
  ws.columns = [
    { width: 10 }, // A DATE
    { width: 20 }, // B ROUTE MANAGER
    { width: 10 }, // C AER STEPS
    { width: 9  }, // D EQUIV
    { width: 13 }, // E TOTAL PREPAY
    { width: 10 }, // F PAYOUT RATE
    { width: 12 }, // G AER COMM
    { width: 10 }, // H MACH RENT / left summary value
    { width: 20 }, // I DEDUCTIONS / right summary label
    { width: 12 }, // J DAILY BONUS
    { width: 14 }, // K TOTAL PAYOUT / right summary value
  ];

  const rowBreakIds: number[] = [];
  let rowNum = 0; // 0-based counter, ExcelJS rows are 1-based so we add 1 when referencing
  let pageCount = 0;

  workers.forEach(worker => {
    // ── Calculations ──
    const earnedComm  = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
    const daysWorked  = worker.days.length;
    const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked * 120 - earnedComm)) : 0;
    const gi          = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
    const finalPay    = r2(
      gi
      - worker.hotels
      - worker.advances
      - worker.travelPkg
      - worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
      + worker.additions.reduce((s, a) => s + a.amount, 0)
    );

    // ── ROW 1: Worker name header ──
    rowNum++;
    const nameRow = ws.addRow([`${worker.contractorId} - ${worker.firstName} ${worker.lastName}`]);
    nameRow.height = 22;
    ws.mergeCells(rowNum, 1, rowNum, NCOLS);
    for (let c = 1; c <= NCOLS; c++) {
      styleCell(nameRow.getCell(c), {
        font:      FONT.bold('FFFFFFFF', 13),
        fill:      FILL.dark('FF1A1A1A'),
        alignment: ALIGN.center,
      });
    }

    // ── ROW 2: Column headers ──
    rowNum++;
    const headerRow = ws.addRow([
      'DATE', 'ROUTE MANAGER', 'AER STEPS', 'EQUIV',
      'TOTAL\nPREPAY', 'PAYOUT\nRATE', 'AER COMM',
      'MACH RENT', 'DEDUCTIONS', 'DAILY\nBONUS', 'TOTAL PAYOUT',
    ]);
    headerRow.height = 28;
    for (let c = 1; c <= NCOLS; c++) {
      styleCell(headerRow.getCell(c), {
        font:      FONT.bold('FFFFFFFF', 9),
        fill:      FILL.dark(c === 3 ? 'FF538135' : 'FFC00000'),
        alignment: ALIGN.centerWrap,
      });
    }

    // ── DATA ROWS ──
    for (let i = 0; i < maxDataRows; i++) {
      rowNum++;
      const d = worker.days[i];
      const dataRow = ws.addRow(d ? [
        formatDate(d.date),
        d.manager,
        d.steps   || null,
        d.equiv   ? r2(d.equiv)   : null,
        d.totalPrepay ? r2(d.totalPrepay) : null,
        d.payoutRate || null,
        d.aerComm ? r2(d.aerComm) : null,
        d.machRent   || null,
        d.deductions || null,
        d.dailyBonus || null,
        r2(d.totalPayout),
      ] : Array(NCOLS).fill(null));
      dataRow.height = 16;

      if (d) {
        styleCell(dataRow.getCell(1),  { font: FONT.regular(), alignment: ALIGN.left });
        styleCell(dataRow.getCell(2),  { font: FONT.regular(), alignment: ALIGN.left });
        styleCell(dataRow.getCell(3),  { font: FONT.regular(), alignment: ALIGN.center });
        styleCell(dataRow.getCell(4),  { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_NUMBER });
        if (d.totalPrepay) styleCell(dataRow.getCell(5),  { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
        styleCell(dataRow.getCell(6),  { font: FONT.regular(), alignment: ALIGN.center });
        if (d.aerComm)    styleCell(dataRow.getCell(7),  { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
        if (d.machRent)   styleCell(dataRow.getCell(8),  { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
        if (d.deductions) styleCell(dataRow.getCell(9),  { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
        if (d.dailyBonus) styleCell(dataRow.getCell(10), { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
        styleCell(dataRow.getCell(11), { font: FONT.regular(), alignment: ALIGN.right, numFmt: FMT_CURRENCY });
      }
    }

    // ── SUMMARY ROWS ──
    // Right side: GI, Hotels, Advances, Travel Pkg, [extra deductions], [additions], Final Pay
    // Left side (120 program only): Earned Commission (row 0), Training Bump (row 1)
    const rightRows: { label: string; value: number }[] = [
      { label: 'Guaranteed Income', value: gi },
      { label: 'Hotels',            value: worker.hotels },
      { label: 'Advances',          value: worker.advances },
      { label: 'Travel Pkg',        value: worker.travelPkg },
      ...worker.extraDeductions.map(d => ({ label: d.label || 'Deduction', value: d.amount })),
      ...worker.additions.map(a =>       ({ label: a.label || 'Addition',  value: -a.amount })),
      { label: 'Final Pay:',         value: finalPay },
    ];

    const leftRows = worker.is120Program
      ? [
          { label: 'Earned Commission', value: earnedComm },
          { label: 'Training Bump',     value: trainingBump },
        ]
      : [];

    rightRows.forEach((right, i) => {
      rowNum++;
      const isFinal = right.label === 'Final Pay:';
      const summaryRowData: (string | number | null)[] = Array(NCOLS).fill(null);

      // Left summary box cols F(6) and H(8) — only for 120 program rows 0 and 1
      if (i < leftRows.length) {
        summaryRowData[5] = leftRows[i].label;  // col F (index 5)
        summaryRowData[7] = leftRows[i].value;  // col H (index 7)
      }

      // Right summary cols I(9) and K(11)
      summaryRowData[8]  = right.label;  // col I (index 8)
      summaryRowData[10] = right.value;  // col K (index 10)

      const sumRow = ws.addRow(summaryRowData);
      sumRow.height = 16;

      // Style left box
      if (i < leftRows.length) {
        styleCell(sumRow.getCell(6), {
          font:      FONT.regular(),
          fill:      FILL.dark('FFF2F2F2'),
          alignment: ALIGN.right,
          border:    BORDER_THIN,
        });
        styleCell(sumRow.getCell(8), {
          font:      FONT.bold('FF000000', 10),
          fill:      FILL.dark('FFF2F2F2'),
          alignment: ALIGN.right,
          numFmt:    FMT_CURRENCY,
          border:    BORDER_THIN,
        });
      }

      // Style right box
      styleCell(sumRow.getCell(9), {
        font:      isFinal ? FONT.bold('FF000000', 11) : FONT.regular(),
        fill:      FILL.dark(isFinal ? 'FFBFBFBF' : 'FFD9D9D9'),
        alignment: ALIGN.right,
      });
      styleCell(sumRow.getCell(11), {
        font:      isFinal ? FONT.bold('FF000000', 12) : FONT.regular(),
        fill:      FILL.dark(isFinal ? 'FFBFBFBF' : 'FFD9D9D9'),
        alignment: ALIGN.right,
        numFmt:    FMT_CURRENCY,
      });
    });

    // ── Page break after every N workers ──
    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      rowBreakIds.push(rowNum);
    }
  });

  // Apply page breaks
  if (rowBreakIds.length > 0) {
    (ws as any).pageBreaks = {
      rowBreaks: rowBreakIds.map(id => ({ id })),
      colBreaks: [],
    };
  }

  // Print setup
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  // Download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ccDisplayName} ${startDate} - ${endDate} Payslips.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}