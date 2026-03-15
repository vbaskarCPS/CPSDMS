// src/lib/payslipExport.ts
import * as XLSX from 'xlsx';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayslipDayRow {
  date: string;
  manager: string;
  steps: number;
  equiv: number;
  totalPrepay: number;
  payoutRate: number;
  aerComm: number;
  upsellComm: number; // kept in data, not shown on payslip
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
  const months: Record<string, number> = {
    Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
    Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
  };
  return (months[s.slice(0, 3)] || 0) * 100 + parseInt(s.slice(3), 10);
}

// ─── Style definitions ────────────────────────────────────────────────────────
// 11 columns (no UPSELL COMM):
// A=DATE, B=ROUTE MANAGER, C=AER STEPS, D=EQUIV, E=TOTAL PREPAY,
// F=PAYOUT RATE, G=AER COMM, H=MACH RENT, I=DEDUCTIONS, J=DAILY BONUS, K=TOTAL PAYOUT
// Summary: col 4(E)=left label, col 6(G)=left value, col 8(I)=right label, col 10(K)=right value

const NCOLS = 11;

const S: Record<string, any> = {
  workerHeader: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 13, name: 'Arial' },
    fill: { patternType: 'solid', fgColor: { rgb: '1A1A1A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  colHeader: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 9, name: 'Arial' },
    fill: { patternType: 'solid', fgColor: { rgb: 'C00000' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  },
  colHeaderSteps: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 9, name: 'Arial' },
    fill: { patternType: 'solid', fgColor: { rgb: '538135' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  dataText: {
    font: { name: 'Arial', sz: 10 },
    alignment: { horizontal: 'left', vertical: 'center' },
  },
  dataCenter: {
    font: { name: 'Arial', sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  dataCurrency: {
    font: { name: 'Arial', sz: 10 },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '$#,##0.00',
  },
  dataNumber: {
    font: { name: 'Arial', sz: 10 },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '0.00',
  },
  summaryLabel: {
    font: { name: 'Arial', sz: 10 },
    fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
    alignment: { horizontal: 'right', vertical: 'center' },
  },
  summaryValue: {
    font: { name: 'Arial', sz: 10 },
    fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '$#,##0.00',
  },
  finalPayLabel: {
    font: { bold: true, name: 'Arial', sz: 11 },
    fill: { patternType: 'solid', fgColor: { rgb: 'BFBFBF' } },
    alignment: { horizontal: 'right', vertical: 'center' },
  },
  finalPayValue: {
    font: { bold: true, name: 'Arial', sz: 12 },
    fill: { patternType: 'solid', fgColor: { rgb: 'BFBFBF' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '$#,##0.00',
  },
  leftLabel: {
    font: { name: 'Arial', sz: 10 },
    fill: { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top:    { style: 'thin', color: { rgb: '999999' } },
      bottom: { style: 'thin', color: { rgb: '999999' } },
      left:   { style: 'thin', color: { rgb: '999999' } },
      right:  { style: 'thin', color: { rgb: '999999' } },
    },
  },
  leftValue: {
    font: { bold: true, name: 'Arial', sz: 10 },
    fill: { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '$#,##0.00',
    border: {
      top:    { style: 'thin', color: { rgb: '999999' } },
      bottom: { style: 'thin', color: { rgb: '999999' } },
      left:   { style: 'thin', color: { rgb: '999999' } },
      right:  { style: 'thin', color: { rgb: '999999' } },
    },
  },
};

function applyStyle(ws: XLSX.WorkSheet, r: number, c: number, style: any) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: 'z', v: undefined };
  ws[addr].s = style;
}

// ─── Parse Payout Stats rows ──────────────────────────────────────────────────

export function parsePayoutStatsRows(
  rows: any[][],
  startDate: string,
  endDate: string
): WorkerPayslipUI[] {
  const startKey = sortKey(startDate);
  const endKey = sortKey(endDate);
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
        lastName: String(row[PS.lastName] || '').trim(),
        days: [],
      });
    }
    map.get(id)!.days.push({
      date: dateStr,
      manager: String(row[PS.manager] || '').trim(),
      steps: Number(row[PS.stepCount]) || 0,
      equiv: Number(row[PS.totalEQ]) || 0,
      totalPrepay: Number(row[PS.totalPrepay]) || 0,
      payoutRate: Number(row[PS.payoutRate]) || 0,
      aerComm: Number(row[PS.aerComm]) || 0,
      upsellComm: Number(row[PS.upsellComm]) || 0,
      machRent: Number(row[PS.machRent]) || 0,
      deductions: Number(row[PS.deductions]) || 0,
      dailyBonus: Number(row[PS.dailyBonus]) || 0,
      totalPayout: Number(row[PS.totalPayout]) || 0,
    });
  }

  map.forEach(w => w.days.sort((a, b) => sortKey(a.date) - sortKey(b.date)));
  return Array.from(map.values()).sort((a, b) => a.contractorId.localeCompare(b.contractorId));
}

// ─── Excel generation ─────────────────────────────────────────────────────────

export function generatePayslipsXLSX(
  workers: WorkerPayslipData[],
  startDate: string,
  endDate: string,
  ccDisplayName: string,
  totalDaysInRange: number
): void {
  const isLong = totalDaysInRange > 7;
  const maxDataRows = isLong ? 16 : 8;
  const perPage = isLong ? 2 : 3;

  const aoa: (string | number | null)[][] = [];
  const merges: XLSX.Range[] = [];
  const rowBreaks: number[] = [];
  const rowHeights: { hpt?: number }[] = [];

  let currentRow = 0;
  let pageCount = 0;

  workers.forEach(worker => {
    // ── Summary calculations ──
    const earnedComm = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
    const daysWorked = worker.days.length;
    const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked * 120 - earnedComm)) : 0;
    const gi = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
    const finalPay = r2(
      gi
      - worker.hotels
      - worker.advances
      - worker.travelPkg
      - worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
      + worker.additions.reduce((s, a) => s + a.amount, 0)
    );

    // ── ROW 1: Worker name header ──
    const nameRow: (string | number | null)[] = Array(NCOLS).fill(null);
    nameRow[0] = `${worker.contractorId} - ${worker.firstName} ${worker.lastName}`;
    aoa.push(nameRow);
    merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: NCOLS - 1 } });
    rowHeights[currentRow] = { hpt: 22 };
    currentRow++;

    // ── ROW 2: Column headers (11 cols, no UPSELL COMM) ──
    aoa.push([
      'DATE', 'ROUTE MANAGER', 'AER STEPS', 'EQUIV',
      'TOTAL PREPAY', 'PAYOUT RATE', 'AER COMM',
      'MACH RENT', 'DEDUCTIONS', 'DAILY BONUS', 'TOTAL PAYOUT',
    ]);
    rowHeights[currentRow] = { hpt: 28 };
    currentRow++;

    // ── DATA ROWS ──
    for (let i = 0; i < maxDataRows; i++) {
      const d = worker.days[i];
      aoa.push(d ? [
        formatDate(d.date),
        d.manager,
        d.steps || null,
        d.equiv ? r2(d.equiv) : null,
        d.totalPrepay ? r2(d.totalPrepay) : null,
        d.payoutRate || null,
        d.aerComm ? r2(d.aerComm) : null,
        d.machRent || null,
        d.deductions || null,
        d.dailyBonus || null,
        r2(d.totalPayout),
      ] : Array(NCOLS).fill(null));
      rowHeights[currentRow] = { hpt: 16 };
      currentRow++;
    }

    // ── SUMMARY ROWS ──
    // Right side always: GI, Hotels, Advances, Travel Pkg, [extras], Final Pay
    // Left side (120 program): Earned Commission (row 0), Training Bump (row 1)
    const rightRows: { label: string; value: number }[] = [
      { label: 'Guaranteed Income', value: gi },
      { label: 'Hotels', value: worker.hotels },
      { label: 'Advances', value: worker.advances },
      { label: 'Travel Pkg', value: worker.travelPkg },
      ...worker.extraDeductions.map(d => ({ label: d.label || 'Deduction', value: d.amount })),
      ...worker.additions.map(a => ({ label: a.label || 'Addition', value: -a.amount })),
      { label: 'Final Pay:', value: finalPay },
    ];

    const leftRows = worker.is120Program
      ? [
          { label: 'Earned Commission', value: earnedComm },
          { label: 'Training Bump', value: trainingBump },
        ]
      : [];

    rightRows.forEach((right, i) => {
      const row: (string | number | null)[] = Array(NCOLS).fill(null);
      row[8] = right.label;   // col I
      row[10] = right.value;  // col K
      if (i < leftRows.length) {
        row[4] = leftRows[i].label;  // col E
        row[6] = leftRows[i].value;  // col G
      }
      aoa.push(row);
      rowHeights[currentRow] = { hpt: 16 };
      currentRow++;
    });

    // ── Page break ──
    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      rowBreaks.push(currentRow - 1);
    }
  });

  // ─── Build worksheet ──────────────────────────────────────────────────────

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 10 }, // A DATE
    { wch: 20 }, // B ROUTE MANAGER
    { wch: 10 }, // C AER STEPS
    { wch: 9  }, // D EQUIV
    { wch: 18 }, // E TOTAL PREPAY / left summary label
    { wch: 10 }, // F PAYOUT RATE
    { wch: 13 }, // G AER COMM / left summary value
    { wch: 10 }, // H MACH RENT
    { wch: 20 }, // I DEDUCTIONS / right summary label
    { wch: 12 }, // J DAILY BONUS
    { wch: 14 }, // K TOTAL PAYOUT / right summary value
  ];
  ws['!rows'] = rowHeights;
  if (rowBreaks.length > 0) {
    (ws as any)['!rowbreaks'] = rowBreaks.map(r => ({ r }));
  }

  // ─── Apply styles ──────────────────────────────────────────────────────────

  let sr = 0; // style row counter

  workers.forEach(worker => {
    const earnedComm = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
    const daysWorked = worker.days.length;
    const gi = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
    const finalPay = r2(
      gi
      - worker.hotels
      - worker.advances
      - worker.travelPkg
      - worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
      + worker.additions.reduce((s, a) => s + a.amount, 0)
    );

    // Worker name header row
    for (let c = 0; c < NCOLS; c++) applyStyle(ws, sr, c, S.workerHeader);
    sr++;

    // Column header row
    for (let c = 0; c < NCOLS; c++) {
      applyStyle(ws, sr, c, c === 2 ? S.colHeaderSteps : S.colHeader);
    }
    sr++;

    // Data rows
    for (let i = 0; i < maxDataRows; i++) {
      const d = worker.days[i];
      if (d) {
        applyStyle(ws, sr, 0, S.dataText);
        applyStyle(ws, sr, 1, S.dataText);
        applyStyle(ws, sr, 2, S.dataCenter);
        applyStyle(ws, sr, 3, S.dataNumber);
        if (d.totalPrepay) applyStyle(ws, sr, 4, S.dataCurrency);
        applyStyle(ws, sr, 5, S.dataCenter);
        if (d.aerComm)    applyStyle(ws, sr, 6, S.dataCurrency);
        if (d.machRent)   applyStyle(ws, sr, 7, S.dataCurrency);
        if (d.deductions) applyStyle(ws, sr, 8, S.dataCurrency);
        if (d.dailyBonus) applyStyle(ws, sr, 9, S.dataCurrency);
        applyStyle(ws, sr, 10, S.dataCurrency);
      }
      sr++;
    }

    // Summary rows
    const rightRows: { label: string }[] = [
      { label: 'Guaranteed Income' },
      { label: 'Hotels' },
      { label: 'Advances' },
      { label: 'Travel Pkg' },
      ...worker.extraDeductions.map(d => ({ label: d.label || 'Deduction' })),
      ...worker.additions.map(a => ({ label: a.label || 'Addition' })),
      { label: 'Final Pay:' },
    ];

    const leftCount = worker.is120Program ? 2 : 0;

    rightRows.forEach((right, i) => {
      const isFinal = right.label === 'Final Pay:';
      applyStyle(ws, sr, 8,  isFinal ? S.finalPayLabel : S.summaryLabel);
      applyStyle(ws, sr, 10, isFinal ? S.finalPayValue : S.summaryValue);
      if (i < leftCount) {
        applyStyle(ws, sr, 4, S.leftLabel);
        applyStyle(ws, sr, 6, S.leftValue);
      }
      sr++;
    });
  });

  // ─── Write file ────────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payslips');
  XLSX.writeFile(wb, `${ccDisplayName} ${startDate} - ${endDate} Payslips.xlsx`);
}