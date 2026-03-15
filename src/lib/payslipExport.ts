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
  totalPrepay: 25,   // upsellPayable → TOTAL PREPAY column on payslip
  payoutRate: 26,
  aerComm: 27,       // Production Comm → AER COMM
  upsellComm: 28,    // Upsell Commission → UPSELL COMM
  machRent: 30,
  deductions: 31,
  dailyBonus: 32,    // Bonuses → DAILY BONUS
  totalPayout: 33,   // Final Pay → TOTAL PAYOUT
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function formatDate(s: string): string {
  // "Mar02" → "2-Mar"
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

  let currentRow = 0;
  let pageCount = 0;

  workers.forEach(worker => {
    // ── Summary calculations (summary block only — daily rows are direct from data) ──
    const earnedComm = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
    const daysWorked = worker.days.length;
    const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked * 120 - earnedComm)) : 0;
    const gi = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
    const totalDeductions = r2(
      worker.hotels + worker.advances + worker.travelPkg +
      worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
    );
    const totalAdditions = r2(worker.additions.reduce((s, a) => s + a.amount, 0));
    const finalPay = r2(gi - totalDeductions + totalAdditions);

    // Right-side summary rows
    const right: { label: string; value: number }[] = [];
    if (worker.is120Program) {
      right.push({ label: 'Earned Commission', value: earnedComm });
      right.push({ label: 'Training Bump', value: trainingBump });
    }
    right.push({ label: 'Guaranteed Income', value: gi });
    right.push({ label: 'Hotels', value: worker.hotels });
    right.push({ label: 'Advances', value: worker.advances });
    right.push({ label: 'Travel Pkg', value: worker.travelPkg });
    // Extra deductions listed on right side after Travel Pkg
    worker.extraDeductions.forEach(d => right.push({ label: d.label || 'Deduction', value: d.amount }));
    worker.additions.forEach(a => right.push({ label: a.label || 'Addition', value: -a.amount }));
    right.push({ label: 'Final Pay:', value: finalPay });

    const summaryRows = right.length;

    // ── Row 1: Worker header (merged A:L) ──
    const headerRow: (string | number | null)[] = Array(12).fill(null);
    headerRow[0] = `${worker.contractorId} - ${worker.firstName} ${worker.lastName}`;
    aoa.push(headerRow);
    merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
    currentRow++;

    // ── Row 2: Column headers ──
    aoa.push([
      'DATE', 'ROUTE MANAGER', 'AER STEPS', 'EQUIV',
      'TOTAL PREPAY', 'PAYOUT RATE', 'AER COMM', 'UPSELL COMM',
      'MACH RENT', 'DEDUCTIONS', 'DAILY BONUS', 'TOTAL PAYOUT',
    ]);
    currentRow++;

    // ── Data rows (padded to maxDataRows) ──
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
        d.upsellComm ? r2(d.upsellComm) : null,
        d.machRent || null,
        d.deductions || null,
        d.dailyBonus || null,
        r2(d.totalPayout),
      ] : Array(12).fill(null));
      currentRow++;
    }

    // ── Summary rows (right side only — I=label col, L=value col) ──
    for (let i = 0; i < summaryRows; i++) {
      const row: (string | number | null)[] = Array(12).fill(null);
      row[8] = right[i].label;
      row[11] = right[i].value;
      aoa.push(row);
      currentRow++;
    }

    // ── Page break after every N workers ──
    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      rowBreaks.push(currentRow - 1);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 10 }, // A DATE
    { wch: 20 }, // B ROUTE MANAGER
    { wch: 10 }, // C AER STEPS
    { wch: 10 }, // D EQUIV
    { wch: 14 }, // E TOTAL PREPAY
    { wch: 12 }, // F PAYOUT RATE
    { wch: 13 }, // G AER COMM
    { wch: 13 }, // H UPSELL COMM
    { wch: 22 }, // I MACH RENT / right labels
    { wch: 12 }, // J DEDUCTIONS
    { wch: 13 }, // K DAILY BONUS
    { wch: 14 }, // L TOTAL PAYOUT / right values
  ];
  if (rowBreaks.length > 0) (ws as any)['!rowbreaks'] = rowBreaks;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payslips');
  XLSX.writeFile(wb, `${ccDisplayName} ${startDate} - ${endDate} Payslips.xlsx`);
}