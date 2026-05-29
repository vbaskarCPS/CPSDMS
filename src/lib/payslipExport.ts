// src/lib/payslipExport.ts
import jsPDF from 'jspdf';

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

export interface HiddenFields {
  hotels: boolean;
  advances: boolean;
  travelPkg: boolean;
}

// ─── Payout Stats column indices (0-based) ───────────────────────────────────

const PS = {
  date: 0, contractorId: 1, firstName: 2, lastName: 3, manager: 4,
  stepCount: 5, totalEQ: 17, totalPrepay: 25, payoutRate: 26,
  aerComm: 27, upsellComm: 28, machRent: 30, deductions: 31,
  dailyBonus: 32, totalPayout: 33,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortKey(s: string): number {
  const m: Record<string, number> = {
    Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
  };
  return (m[s.slice(0, 3)] || 0) * 100 + parseInt(s.slice(3), 10);
}

function fmtDate(s: string): string {
  return `${parseInt(s.slice(3), 10)}-${s.slice(0, 3)}`;
}

function r2(v: number): number { return Math.round(v * 100) / 100; }

function curr(v: number): string {
  const abs = Math.abs(v);
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${str}` : `$${str}`;
}

function num2(v: number): string {
  return v.toFixed(2);
}

// ─── Parse Payout Stats (unchanged) ──────────────────────────────────────────

export function parsePayoutStatsRows(
  rows: any[][], startDate: string, endDate: string
): WorkerPayslipUI[] {
  const sk = sortKey(startDate), ek = sortKey(endDate);
  const map = new Map<string, WorkerPayslipUI>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[PS.date] || !row[PS.contractorId]) continue;
    const ds = String(row[PS.date]).trim();
    const dk = sortKey(ds);
    if (dk < sk || dk > ek) continue;
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
      date:        ds,
      manager:     String(row[PS.manager]     || '').trim(),
      steps:       Number(row[PS.stepCount])  || 0,
      equiv:       Number(row[PS.totalEQ])    || 0,
      totalPrepay: Number(row[PS.totalPrepay])|| 0,
      payoutRate:  Number(row[PS.payoutRate]) || 0,
      aerComm:     Number(row[PS.aerComm])    || 0,
      upsellComm:  Number(row[PS.upsellComm])|| 0,
      machRent:    Number(row[PS.machRent])   || 0,
      deductions:  Number(row[PS.deductions]) || 0,
      dailyBonus:  Number(row[PS.dailyBonus]) || 0,
      totalPayout: Number(row[PS.totalPayout])|| 0,
    });
  }

  map.forEach(w => w.days.sort((a, b) => sortKey(a.date) - sortKey(b.date)));
  return Array.from(map.values()).sort((a, b) => a.contractorId.localeCompare(b.contractorId));
}

// ─── PDF Layout Constants ─────────────────────────────────────────────────────

const PW = 612;               // Letter/Legal share the same width in pt
const PH = 792;               // Letter height in pt (default; Legal handled per-tier)
const ML = 18;                 // Margin left
const MR = 18;                 // Margin right
const MT = 18;                 // Margin top
const MB = 18;                 // Margin bottom
const CW = PW - ML - MR;      // Content width = 576

// Payslip row heights
const H_NAME = 20;
const H_HDR  = 26;
const H_DATA = 15;
const H_SUM  = 16;
const H_GAP  = 4;

// Manual-item colours on the printed summary block.
const COLOR_ADDITION  = '#1A7F37';   // green — manual additions (+)
const COLOR_DEDUCTION = '#CC0000';   // red   — manual extra deductions (−)

// Payslip columns (11 visible — UPSELL COMM hidden, same as Excel)
interface ColDef {
  label: string;
  w: number;
  color: string;        // header fill hex
  align: 'left' | 'center' | 'right';
}

const COLS: ColDef[] = [
  { label: 'DATE',           w: 45,  color: '#CC0000', align: 'left'   },
  { label: 'ROUTE\nMANAGER', w: 75,  color: '#CC0000', align: 'center' },
  { label: 'AER\nSTEPS',     w: 45,  color: '#B6D7A8', align: 'right'  },
  { label: 'EQUIV',          w: 45,  color: '#666666', align: 'right'  },
  { label: 'TOTAL\nPREPAY',  w: 55,  color: '#666666', align: 'center' },
  { label: 'PAYOUT\nRATE',   w: 45,  color: '#666666', align: 'center' },
  { label: 'AER\nCOMM',      w: 45,  color: '#666666', align: 'right'  },
  { label: 'MACH\nRENT',     w: 50,  color: '#CC0000', align: 'right'  },
  { label: 'LABOR\nCOST',    w: 45,  color: '#CC0000', align: 'right'  },
  { label: 'DAILY\nBONUS',   w: 45,  color: '#CC0000', align: 'right'  },
  { label: 'TOTAL\nPAYOUT',  w: 81,  color: '#660000', align: 'right'  },
];

// ─── PDF drawing helpers ──────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function drawRect(doc: jsPDF, x: number, y: number, w: number, h: number, color: string) {
  const [r, g, b] = hexToRGB(color);
  doc.setFillColor(r, g, b);
  doc.rect(x, y, w, h, 'F');
}

function drawText(
  doc: jsPDF, text: string,
  x: number, y: number, w: number, h: number,
  opts: {
    align?: 'left' | 'center' | 'right';
    color?: string;
    size?: number;
    bold?: boolean;
    wrap?: boolean;
  } = {}
) {
  const { align = 'left', color = '#000000', size = 8, bold = false, wrap = false } = opts;
  const [r, g, b] = hexToRGB(color);
  doc.setTextColor(r, g, b);
  doc.setFontSize(size);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');

  const lines = wrap ? text.split('\n') : [text];
  const lineH = size * 1.15;
  const totalTextH = lines.length * lineH;
  const startY = y + (h - totalTextH) / 2 + size * 0.8;

  const pad = 3;
  lines.forEach((line, i) => {
    const ly = startY + i * lineH;
    let lx: number;
    if (align === 'center') lx = x + w / 2;
    else if (align === 'right') lx = x + w - pad;
    else lx = x + pad;
    doc.text(line, lx, ly, { align });
  });
}

function drawBorder(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  lineWidth: number = 1.5
) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h, 'S');
}

function drawLine(
  doc: jsPDF, x1: number, y1: number, x2: number, y2: number,
  lineWidth: number = 0.5
) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(lineWidth);
  doc.line(x1, y1, x2, y2);
}

// ─── Sign-Out List ────────────────────────────────────────────────────────────

function renderSignOutList(
  doc: jsPDF,
  workers: WorkerPayslipData[],
  startDate: string,
  endDate: string,
  hiddenFields: HiddenFields,
  batchName?: string,
  pageHeight: number = PH,
) {
  const sorted = [...workers].sort((a, b) => {
    const last = a.lastName.localeCompare(b.lastName);
    return last !== 0 ? last : a.firstName.localeCompare(b.firstName);
  });

  const ROWS_PER_PAGE = 25;
  const pages = Math.ceil(sorted.length / ROWS_PER_PAGE);

  // Column layout for sign-out
  const soColX = ML;
  const soCols = [
    { label: '#',              w: 28  },
    { label: 'CONTRACTOR ID',  w: 80  },
    { label: 'NAME',           w: 155 },
    { label: 'AMOUNT',         w: 75  },
    { label: 'DATE',           w: 95  },
    { label: 'SIGNATURE',      w: 143 },
  ];

  const TITLE_H = 36;
  const SUB_H = 18;
  const SO_HDR_H = 22;
  const availH = pageHeight - MT - MB - TITLE_H - SUB_H - SO_HDR_H;
  const SO_ROW_H = Math.min(Math.floor(availH / ROWS_PER_PAGE), 27);

  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.addPage();

    let y = MT;

    // Title
    const title = batchName
      ? `Sign-Out Sheet — ${batchName} — ${startDate} → ${endDate}`
      : `Sign-Out Sheet — ${startDate} → ${endDate}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(title, PW / 2, y + 20, { align: 'center' });
    y += TITLE_H;

    // Subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${page + 1} of ${pages}`, PW / 2, y + 11, { align: 'center' });
    y += SUB_H;

    // Header row
    let hx = soColX;
    drawRect(doc, ML, y, CW, SO_HDR_H, '#1A1A1A');
    soCols.forEach(col => {
      drawText(doc, col.label, hx, y, col.w, SO_HDR_H, {
        align: 'center', color: '#FFFFFF', size: 8, bold: true,
      });
      hx += col.w;
    });
    y += SO_HDR_H;

    // Data rows
    const startIdx = page * ROWS_PER_PAGE;
    const endIdx = Math.min(startIdx + ROWS_PER_PAGE, sorted.length);

    for (let i = startIdx; i < endIdx; i++) {
      const w = sorted[i];
      const rowNum = i + 1;
      const bgColor = (i - startIdx) % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
      drawRect(doc, ML, y, CW, SO_ROW_H, bgColor);

      // Compute final pay for this worker
      const earnedComm = r2(w.days.reduce((s, d) => s + d.totalPayout, 0));
      const daysWorked = w.days.length;
      const gi = w.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
      const hotelsVal = hiddenFields.hotels ? 0 : w.hotels;
      const advancesVal = hiddenFields.advances ? 0 : w.advances;
      const travelVal = hiddenFields.travelPkg ? 0 : w.travelPkg;
      const finalPay = r2(
        gi - hotelsVal - advancesVal - travelVal
        - w.extraDeductions.reduce((s, d) => s + d.amount, 0)
        + w.additions.reduce((s, a) => s + a.amount, 0)
      );

      let cx = soColX;
      // #
      drawText(doc, String(rowNum), cx, y, soCols[0].w, SO_ROW_H, { align: 'center', size: 8 });
      cx += soCols[0].w;
      // Contractor ID
      drawText(doc, w.contractorId, cx, y, soCols[1].w, SO_ROW_H, { align: 'center', size: 8 });
      cx += soCols[1].w;
      // Name (Last, First)
      drawText(doc, `${w.lastName}, ${w.firstName}`, cx, y, soCols[2].w, SO_ROW_H, { align: 'left', size: 8 });
      cx += soCols[2].w;
      // Amount
      drawText(doc, curr(finalPay), cx, y, soCols[3].w, SO_ROW_H, { align: 'right', size: 8, bold: true });
      cx += soCols[3].w;
      // Date — blank line
      const dateLineY = y + SO_ROW_H - 6;
      drawLine(doc, cx + 8, dateLineY, cx + soCols[4].w - 8, dateLineY, 0.5);
      cx += soCols[4].w;
      // Signature — blank line
      drawLine(doc, cx + 8, dateLineY, cx + soCols[5].w - 8, dateLineY, 0.5);

      // Row border
      drawLine(doc, ML, y + SO_ROW_H, ML + CW, y + SO_ROW_H, 0.25);
      y += SO_ROW_H;
    }

    // Outer border around table
    const tableTop = MT + TITLE_H + SUB_H;
    const tableH = SO_HDR_H + (endIdx - startIdx) * SO_ROW_H;
    drawBorder(doc, ML, tableTop, CW, tableH, 1);
  }
}

// ─── Payslip Rendering ───────────────────────────────────────────────────────

function drawPayslip(
  doc: jsPDF,
  worker: WorkerPayslipData,
  y: number,
  maxData: number,
  hiddenFields: HiddenFields,
) {
  const x = ML;

  // ── Compute financials ──
  const earnedComm   = r2(worker.days.reduce((s, d) => s + d.totalPayout, 0));
  const daysWorked   = worker.days.length;
  const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked * 120 - earnedComm)) : 0;
  const gi           = worker.is120Program ? r2(Math.max(earnedComm, daysWorked * 120)) : earnedComm;
  const hotelsVal    = hiddenFields.hotels ? 0 : worker.hotels;
  const advancesVal  = hiddenFields.advances ? 0 : worker.advances;
  const travelVal    = hiddenFields.travelPkg ? 0 : worker.travelPkg;
  const finalPay     = r2(
    gi - hotelsVal - advancesVal - travelVal
    - worker.extraDeductions.reduce((s, d) => s + d.amount, 0)
    + worker.additions.reduce((s, a) => s + a.amount, 0)
  );

  // ── Row 1: Name banner ──
  drawRect(doc, x, y, CW, H_NAME, '#1A1A1A');
  drawText(
    doc,
    `${worker.contractorId} - ${worker.firstName} ${worker.lastName}`,
    x, y, CW, H_NAME,
    { align: 'center', color: '#FFFFFF', size: 14, bold: true }
  );
  // Thick border top + sides
  drawLine(doc, x, y, x + CW, y, 2);
  drawLine(doc, x, y, x, y + H_NAME, 2);
  drawLine(doc, x + CW, y, x + CW, y + H_NAME, 2);
  y += H_NAME;

  // ── Row 2: Column headers ──
  let cx = x;
  COLS.forEach(col => {
    drawRect(doc, cx, y, col.w, H_HDR, col.color);
    // Header text color: white for all except green bg gets dark text
    const textColor = col.color === '#B6D7A8' ? '#000000' : '#FFFFFF';
    drawText(doc, col.label, cx, y, col.w, H_HDR, {
      align: 'center', color: textColor, size: 7, bold: true, wrap: true,
    });
    cx += col.w;
  });
  // Side borders
  drawLine(doc, x, y, x, y + H_HDR, 2);
  drawLine(doc, x + CW, y, x + CW, y + H_HDR, 2);
  y += H_HDR;

  // ── Data rows ──
  for (let i = 0; i < maxData; i++) {
    const d = worker.days[i];

    // Alternating subtle background
    if (i % 2 === 1) {
      drawRect(doc, x, y, CW, H_DATA, '#F9F9F9');
    }

    if (d) {
      const vals: { text: string; align: 'left' | 'center' | 'right' }[] = [
        { text: fmtDate(d.date),     align: 'left'   },
        { text: d.manager,           align: 'left'   },
        { text: String(d.steps),     align: 'center' },
        { text: num2(d.equiv),       align: 'right'  },
        { text: d.totalPrepay ? curr(r2(d.totalPrepay)) : '', align: 'right' },
        { text: String(d.payoutRate),align: 'center' },
        { text: curr(r2(d.aerComm)), align: 'right'  },
        { text: d.machRent ? curr(d.machRent) : '',     align: 'right' },
        { text: d.deductions ? curr(d.deductions) : '', align: 'right' },
        { text: d.dailyBonus ? curr(d.dailyBonus) : '', align: 'right' },
        { text: curr(r2(d.totalPayout)), align: 'right' },
      ];

      let dx = x;
      vals.forEach((v, ci) => {
        drawText(doc, v.text, dx, y, COLS[ci].w, H_DATA, {
          align: v.align, size: 7, color: '#000000',
        });
        dx += COLS[ci].w;
      });
    }

    // Side borders
    drawLine(doc, x, y, x, y + H_DATA, 2);
    drawLine(doc, x + CW, y, x + CW, y + H_DATA, 2);

    // Thin bottom line
    drawLine(doc, x, y + H_DATA, x + CW, y + H_DATA, 0.15);
    y += H_DATA;
  }

  // ── Summary section ──
  // Build right-side rows (always visible: Earned Income, Final Pay; conditionally others)
  const rightRows: { label: string; value: number; isFinal: boolean }[] = [];
  rightRows.push({ label: 'Earned Income', value: gi, isFinal: false });
  if (!hiddenFields.hotels)   rightRows.push({ label: 'Hotels',     value: hotelsVal,    isFinal: false });
  if (!hiddenFields.advances) rightRows.push({ label: 'Advances',   value: advancesVal,  isFinal: false });
  if (!hiddenFields.travelPkg)rightRows.push({ label: 'Travel Pkg', value: travelVal,    isFinal: false });
  rightRows.push({ label: 'Final Pay:', value: finalPay, isFinal: true });

  // Build left-side items. `kind` drives the printed colour + sign:
  //   info      → black, plain (120-program lines)
  //   addition  → green, prefixed +
  //   deduction → red,   prefixed −
  const leftItems: { label: string; value: number; kind: 'info' | 'addition' | 'deduction' }[] = [];
  if (worker.is120Program) {
    leftItems.push({ label: 'Earned Commission', value: earnedComm,  kind: 'info' });
    leftItems.push({ label: 'Training Bump',     value: trainingBump, kind: 'info' });
  }
  worker.extraDeductions.forEach(d => leftItems.push({ label: d.label || 'Deduction', value: d.amount, kind: 'deduction' }));
  worker.additions.forEach(a       => leftItems.push({ label: a.label || 'Addition',  value: a.amount, kind: 'addition' }));

  const nSummary = rightRows.length;

  // Summary x positions — right half of table
  // COLS indices: 0=DATE 1=MGR 2=STEPS 3=EQUIV 4=PREPAY 5=RATE 6=AER 7=MACH 8=LABOR 9=BONUS 10=TOTAL
  let sumStartX = x;
  for (let c = 0; c < 5; c++) sumStartX += COLS[c].w;
  // sumStartX is now at RATE column

  const leftLabelX = sumStartX;                           // RATE col start
  const leftLabelW = COLS[5].w + COLS[6].w;               // RATE + AER width
  const leftValueX = leftLabelX + leftLabelW;             // MACH col start
  const leftValueW = COLS[7].w;                           // MACH width
  const rightLabelX = leftValueX + leftValueW;            // LABOR col start
  const rightLabelW = COLS[8].w + COLS[9].w;              // LABOR + BONUS width
  const rightValueX = rightLabelX + rightLabelW;          // TOTAL col start
  const rightValueW = COLS[10].w;                         // TOTAL width
  const sumTotalW = leftLabelW + leftValueW + rightLabelW + rightValueW;

  for (let i = 0; i < nSummary; i++) {
    const right = rightRows[i];
    const left  = leftItems[i];
    const isFinal = right.isFinal;
    const sumBg = isFinal ? '#BFBFBF' : '#D9D9D9';

    // Fill summary area
    drawRect(doc, sumStartX, y, sumTotalW, H_SUM, sumBg);

    // Left side items (lighter bg) — colour + sign by kind
    if (left) {
      drawRect(doc, leftLabelX, y, leftLabelW, H_SUM, '#F2F2F2');
      drawRect(doc, leftValueX, y, leftValueW, H_SUM, '#F2F2F2');

      const leftColor =
        left.kind === 'addition'  ? COLOR_ADDITION :
        left.kind === 'deduction' ? COLOR_DEDUCTION : '#000000';
      const leftValueText =
        left.kind === 'addition'  ? `+${curr(left.value)}` :
        left.kind === 'deduction' ? `-${curr(left.value)}` :
        curr(left.value);

      drawText(doc, left.label, leftLabelX, y, leftLabelW, H_SUM, {
        align: 'right', size: 8, color: leftColor,
      });
      drawText(doc, leftValueText, leftValueX, y, leftValueW, H_SUM, {
        align: 'right', size: 8, bold: true, color: leftColor,
      });
    }

    // Right side — Final Pay prints red when negative; everything else black.
    const rightColor = (isFinal && right.value < 0) ? COLOR_DEDUCTION : '#000000';
    drawText(doc, right.label, rightLabelX, y, rightLabelW, H_SUM, {
      align: 'right', size: isFinal ? 9 : 8, bold: isFinal, color: rightColor,
    });
    drawText(doc, curr(right.value), rightValueX, y, rightValueW, H_SUM, {
      align: 'right', size: isFinal ? 10 : 9, bold: true, color: rightColor,
    });

    // Side borders on left + right of payslip
    drawLine(doc, x, y, x, y + H_SUM, 2);
    drawLine(doc, x + CW, y, x + CW, y + H_SUM, 2);

    // Summary block borders (medium weight)
    if (i === 0)           drawLine(doc, sumStartX, y, sumStartX + sumTotalW, y, 1);
    if (i === nSummary - 1) drawLine(doc, sumStartX, y + H_SUM, sumStartX + sumTotalW, y + H_SUM, 1);
    drawLine(doc, sumStartX, y, sumStartX, y + H_SUM, 1);
    drawLine(doc, sumStartX + sumTotalW, y, sumStartX + sumTotalW, y + H_SUM, 1);

    y += H_SUM;
  }

  // Bottom border of entire payslip
  drawLine(doc, x, y, x + CW, y, 2);
}

// ─── Payslip block height calculation ─────────────────────────────────────────

function payslipBlockHeight(maxData: number, nSummaryRows: number): number {
  return H_NAME + H_HDR + maxData * H_DATA + nSummaryRows * H_SUM + H_GAP;
}

// ─── Paper tier selection ──────────────────────────────────────────────────────
//
// Four tiers, driven by the number of calendar days in the selected range:
//   ≤ 7    → 8 rows,  3 per Letter page   (unchanged)
//   8–16   → 16 rows, 2 per Letter page   (unchanged)
//   17–21  → one row per day, 2 per Legal page (15pt rows, no squeezing)
//   22+    → one row per day, 1 per page; Letter while a single slip fits,
//            Legal once it can't (≈42+ rows).
//
// maxData is the number of day-row slots a slip draws. For tiers 3 & 4 this equals
// the range length, so a worker can never have more worked days than row slots —
// nothing truncates.
function chooseLayout(totalDaysInRange: number, nSummary: number): {
  maxData: number;
  format: 'letter' | 'legal';
  pageHeight: number;
} {
  const LETTER_H = 792;
  const LEGAL_H  = 1008;

  if (totalDaysInRange <= 7)  return { maxData: 8,  format: 'letter', pageHeight: LETTER_H };
  if (totalDaysInRange <= 16) return { maxData: 16, format: 'letter', pageHeight: LETTER_H };

  const maxData = totalDaysInRange;

  // Tier 3 (17–21): two slips per Legal page.
  if (totalDaysInRange <= 21) {
    return { maxData, format: 'legal', pageHeight: LEGAL_H };
  }

  // Tier 4 (22+): one per page. Stay on Letter while one slip fits; else Legal.
  const blockH = payslipBlockHeight(maxData, nSummary);
  if (blockH <= LETTER_H - MT - MB) {
    return { maxData, format: 'letter', pageHeight: LETTER_H };
  }
  return { maxData, format: 'legal', pageHeight: LEGAL_H };
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function generatePayslipsPDF(
  workers: WorkerPayslipData[],
  startDate: string,
  endDate: string,
  ccDisplayName: string,
  totalDaysInRange: number,
  hiddenFields: HiddenFields,
  batchName?: string,
): Promise<void> {
  // Count summary rows (drives both block height and the per-page math).
  let nSummary = 2; // Earned Income + Final Pay always present
  if (!hiddenFields.hotels)    nSummary++;
  if (!hiddenFields.advances)  nSummary++;
  if (!hiddenFields.travelPkg) nSummary++;

  // Pick rows-per-slip + paper size from the date-range tier.
  const { maxData, format, pageHeight } = chooseLayout(totalDaysInRange, nSummary);

  const blockH  = payslipBlockHeight(maxData, nSummary);
  const usableH = pageHeight - MT - MB;
  const perPage = Math.max(1, Math.floor(usableH / blockH));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format });

  // ── Sign-out list (first pages) ──
  renderSignOutList(doc, workers, startDate, endDate, hiddenFields, batchName, pageHeight);

  // ── Payslips ──
  let y = MT;
  let onPage = 0;

  workers.forEach((worker, wi) => {
    if (onPage >= perPage || wi === 0) {
      doc.addPage();
      y = MT;
      onPage = 0;
    }

    drawPayslip(doc, worker, y, maxData, hiddenFields);
    y += blockH;
    onPage++;
  });

  // ── Save / download ──
  const filePrefix = batchName ? `${batchName}_` : '';
  doc.save(`${filePrefix}${ccDisplayName} ${startDate} - ${endDate} Payslips.pdf`);
}
