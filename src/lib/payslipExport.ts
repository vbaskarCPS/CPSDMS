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
  date: 0, contractorId: 1, firstName: 2, lastName: 3, manager: 4,
  stepCount: 5, totalEQ: 17, totalPrepay: 25, payoutRate: 26,
  aerComm: 27, upsellComm: 28, machRent: 30, deductions: 31,
  dailyBonus: 32, totalPayout: 33,
};

// ─── Layout ───────────────────────────────────────────────────────────────────

const NCOLS   = 12;
const H_NAME  = 40;
const H_HDR   = 56;
const H_STD   = 30;

const HDR_FILL: Record<number, string> = {
  1: 'FFCC0000', 2: 'FFCC0000', 3: 'FFB6D7A8',
  4: 'FF666666', 5: 'FF666666', 6: 'FF666666',
  7: 'FF666666', 8: 'FF666666',
  9: 'FFCC0000', 10: 'FFCC0000', 11: 'FFCC0000', 12: 'FF660000',
};

const FMT_CURR = '$#,##0.00';
const FMT_NUM  = '0.00';

// ─── Style helpers ────────────────────────────────────────────────────────────

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

type CellOpts = {
  font?: Partial<ExcelJS.Font>;
  fill?: ExcelJS.Fill;
  align?: Partial<ExcelJS.Alignment>;
  fmt?: string;
  border?: Partial<ExcelJS.Borders>;
};

function style(cell: ExcelJS.Cell, o: CellOpts) {
  if (o.font)   cell.font      = o.font as ExcelJS.Font;
  if (o.fill)   cell.fill      = o.fill;
  if (o.align)  cell.alignment = o.align;
  if (o.fmt)    cell.numFmt    = o.fmt;
  if (o.border) cell.border    = o.border as ExcelJS.Borders;
}

const aC  = { horizontal: 'center' as const, vertical: 'middle' as const };
const aCW = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
const aRW = { horizontal: 'right'  as const, vertical: 'middle' as const, wrapText: true };
const aL  = { horizontal: 'left'   as const, vertical: 'middle' as const };
const aR  = { horizontal: 'right'  as const, vertical: 'middle' as const };

const THICK: Partial<ExcelJS.Border> = { style: 'thick' };
const MED:   Partial<ExcelJS.Border> = { style: 'medium' };

// ─── Parse Payout Stats ──────────────────────────────────────────────────────

function sortKey(s: string): number {
  const m: Record<string,number> = {
    Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
  };
  return (m[s.slice(0,3)]||0)*100 + parseInt(s.slice(3),10);
}

function fmtDate(s: string): string {
  return `${parseInt(s.slice(3),10)}-${s.slice(0,3)}`;
}

function r2(v: number): number { return Math.round(v*100)/100; }

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
        firstName: String(row[PS.firstName]||'').trim(),
        lastName:  String(row[PS.lastName] ||'').trim(),
        days: [],
      });
    }
    map.get(id)!.days.push({
      date:        ds,
      manager:     String(row[PS.manager]    ||'').trim(),
      steps:       Number(row[PS.stepCount]  )||0,
      equiv:       Number(row[PS.totalEQ]    )||0,
      totalPrepay: Number(row[PS.totalPrepay])||0,
      payoutRate:  Number(row[PS.payoutRate] )||0,
      aerComm:     Number(row[PS.aerComm]    )||0,
      upsellComm:  Number(row[PS.upsellComm] )||0,
      machRent:    Number(row[PS.machRent]   )||0,
      deductions:  Number(row[PS.deductions] )||0,
      dailyBonus:  Number(row[PS.dailyBonus] )||0,
      totalPayout: Number(row[PS.totalPayout])||0,
    });
  }

  map.forEach(w => w.days.sort((a,b) => sortKey(a.date)-sortKey(b.date)));
  return Array.from(map.values()).sort((a,b) => a.contractorId.localeCompare(b.contractorId));
}

// ─── Excel generation ─────────────────────────────────────────────────────────

export async function generatePayslipsXLSX(
  workers: WorkerPayslipData[],
  startDate: string, endDate: string,
  ccDisplayName: string,
  totalDaysInRange: number,
  batchName?: string,           // optional — prefixes the filename when provided
): Promise<void> {
  const isLong  = totalDaysInRange > 7;
  const maxData = isLong ? 16 : 8;
  const perPage = isLong ? 2 : 3;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payslips');

  ws.columns = [
    { key:'A', width: 9.14  },
    { key:'B', width: 15.14 },
    { key:'C', width: 9.14  },
    { key:'D', width: 9.14  },
    { key:'E', width: 11.0  },
    { key:'F', width: 9.14  },
    { key:'G', width: 9.14  },
    { key:'H', width: 0, hidden: true },
    { key:'I', width: 10.0  },
    { key:'J', width: 9.14  },
    { key:'K', width: 9.14  },
    { key:'L', width: 16.0  },
  ];

  const pageBreakRows: number[] = [];
  let rn = 0;
  let pageCount = 0;

  workers.forEach(worker => {
    const earnedComm   = r2(worker.days.reduce((s,d) => s+d.totalPayout, 0));
    const daysWorked   = worker.days.length;
    const trainingBump = worker.is120Program ? r2(Math.max(0, daysWorked*120 - earnedComm)) : 0;
    const gi           = worker.is120Program ? r2(Math.max(earnedComm, daysWorked*120)) : earnedComm;
    const finalPay     = r2(
      gi - worker.hotels - worker.advances - worker.travelPkg
      - worker.extraDeductions.reduce((s,d) => s+d.amount, 0)
      + worker.additions.reduce((s,a) => s+a.amount, 0)
    );

    // ROW 1: Name header
    rn++;
    const nameRow = ws.addRow(
      [`${worker.contractorId} - ${worker.firstName} ${worker.lastName}`,
       ...Array(NCOLS-1).fill(null)]
    );
    nameRow.height = H_NAME;
    ws.mergeCells(rn, 1, rn, NCOLS);
    for (let c = 1; c <= NCOLS; c++) {
      style(nameRow.getCell(c), {
        font:  { bold:true, color:{argb:'FFFFFFFF'}, size:18, name:'Arial' },
        fill:  fill('FF1A1A1A'),
        align: aC,
        border: {
          top:   c===1 ? THICK : { style:'thick' },
          left:  c===1 ? THICK : undefined,
          right: c===NCOLS ? THICK : undefined,
        },
      });
    }

    // ROW 2: Column headers
    rn++;
    const hdrRow = ws.addRow([
      'DATE','ROUTE MANAGER','AER STEPS','EQUIV',
      'TOTAL PREPAY','PAYOUT RATE','AER COMM','UPSELL COMM',
      'MACH RENT','DEDUCTIONS','DAILY BONUS','TOTAL PAYOUT',
    ]);
    hdrRow.height = H_HDR;
    for (let c = 1; c <= NCOLS; c++) {
      style(hdrRow.getCell(c), {
        font:  { bold:true, color:{argb:'FFFFFFFF'}, size:10, name:'Arial' },
        fill:  fill(HDR_FILL[c]),
        align: c===3 ? aRW : aCW,
        border: {
          left:  c===1 ? THICK : undefined,
          right: c===NCOLS ? THICK : undefined,
        },
      });
    }

    // DATA ROWS
    for (let i = 0; i < maxData; i++) {
      rn++;
      const d = worker.days[i];
      const dataRow = ws.addRow(d ? [
        fmtDate(d.date), d.manager, d.steps, r2(d.equiv),
        r2(d.totalPrepay), d.payoutRate, r2(d.aerComm), r2(d.upsellComm),
        d.machRent, d.deductions, d.dailyBonus, r2(d.totalPayout),
      ] : Array(NCOLS).fill(null));
      dataRow.height = H_STD;

      style(dataRow.getCell(1),     { border: { left: THICK } });
      style(dataRow.getCell(NCOLS), { border: { right: THICK } });

      if (d) {
        const f = { name:'Arial', size:10 } as Partial<ExcelJS.Font>;
        style(dataRow.getCell(1),  { font:f, align:aL, border:{ left:THICK } });
        style(dataRow.getCell(2),  { font:f, align:aL });
        style(dataRow.getCell(3),  { font:f, align:aC });
        style(dataRow.getCell(4),  { font:f, align:aR, fmt:FMT_NUM });
        style(dataRow.getCell(5),  { font:f, align:aR, fmt:FMT_CURR });
        style(dataRow.getCell(6),  { font:f, align:aC });
        style(dataRow.getCell(7),  { font:f, align:aR, fmt:FMT_CURR });
        style(dataRow.getCell(9),  { font:f, align:aR, fmt:FMT_CURR });
        style(dataRow.getCell(10), { font:f, align:aR, fmt:FMT_CURR });
        style(dataRow.getCell(11), { font:f, align:aR, fmt:FMT_CURR });
        style(dataRow.getCell(12), { font:f, align:aR, fmt:FMT_CURR, border:{ right:THICK } });
      }
    }

    // SUMMARY ROWS
    const rightRows = [
      { label:'Earned Income', value:gi },
      { label:'Hotels',        value:worker.hotels },
      { label:'Advances',      value:worker.advances },
      { label:'Travel Pkg',    value:worker.travelPkg },
      { label:'Final Pay:',    value:finalPay },
    ];

    const leftItems: { label:string; value:number }[] = [];
    if (worker.is120Program) {
      leftItems.push({ label:'Earned Commission', value:earnedComm });
      leftItems.push({ label:'Training Bump',     value:trainingBump });
    }
    worker.extraDeductions.forEach(d => leftItems.push({ label:d.label||'Deduction', value:d.amount }));
    worker.additions.forEach(a       => leftItems.push({ label:a.label||'Addition',  value:a.amount }));

    const SUMMARY_ROWS = 5;

    for (let i = 0; i < SUMMARY_ROWS; i++) {
      rn++;
      const right   = rightRows[i];
      const left    = leftItems[i];
      const isFinal = right.label === 'Final Pay:';
      const isFirst = i === 0;
      const isLast  = i === SUMMARY_ROWS - 1;

      const rowData: (string|number|null)[] = Array(NCOLS).fill(null);
      if (left) { rowData[5] = left.label; rowData[8] = left.value; }
      rowData[9]  = right.label;
      rowData[11] = right.value;

      const sumRow = ws.addRow(rowData);
      sumRow.height = H_STD;

      const summaryFill = fill(isFinal ? 'FFBFBFBF' : 'FFD9D9D9');

      for (let c = 6; c <= NCOLS; c++) {
        const b: Partial<ExcelJS.Borders> = {};
        if (isFirst) b.top    = MED;
        if (isLast)  b.bottom = MED;
        if (c === 6) b.left   = MED;
        if (c === NCOLS) b.right = MED;
        style(sumRow.getCell(c), { fill: summaryFill, border: b });
      }

      style(sumRow.getCell(1),    { border: { left: THICK } });
      style(sumRow.getCell(NCOLS),{ fill: summaryFill, border: {
        right:  MED,
        top:    isFirst ? MED : undefined,
        bottom: isLast  ? MED : undefined,
      }});

      ws.mergeCells(rn, 6, rn, 7);
      ws.mergeCells(rn, 10, rn, 11);

      const fReg   = { name:'Arial', size:12 } as Partial<ExcelJS.Font>;
      const fBold  = { bold:true, name:'Arial', size:12 } as Partial<ExcelJS.Font>;
      const fFinal = { bold:true, name:'Arial', size:14 } as Partial<ExcelJS.Font>;
      const aRShrink = { horizontal: 'right' as const, vertical: 'middle' as const, shrinkToFit: true };

      if (left) {
        style(sumRow.getCell(6), { font:fReg,  fill:fill('FFF2F2F2'), align:aRShrink });
        style(sumRow.getCell(9), { font:fBold, fill:fill('FFF2F2F2'), align:aRShrink, fmt:FMT_CURR });
      }
      style(sumRow.getCell(10), { font:isFinal ? fBold  : fReg,  fill:summaryFill, align:aRShrink });
      style(sumRow.getCell(12), { font:isFinal ? fFinal : fBold, fill:summaryFill, align:aRShrink, fmt:FMT_CURR });
    }

    // 2 BLANK TRAILING ROWS
    for (let i = 0; i < 2; i++) {
      rn++;
      const blankRow = ws.addRow(['',...Array(NCOLS-1).fill(null)]);
      blankRow.height = H_STD;
      (blankRow as any).customHeight = true;
    }

    pageCount++;
    if (pageCount % perPage === 0 && pageCount < workers.length) {
      pageBreakRows.push(rn);
    }
  });

  if (pageBreakRows.length > 0) {
    (ws as any).rowBreaks = pageBreakRows.map(id => ({ id, min:0, max:16383, man:true }));
  }

  ws.pageSetup = {
    paperSize:   9,
    orientation: 'portrait',
    fitToPage:   true,
    fitToWidth:  1,
    fitToHeight: 0,
  };
  ws.pageMargins = {
    left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0, footer: 0,
  };

  // Prefix filename with batch name if provided
  const filePrefix = batchName ? `${batchName}_` : '';
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `${filePrefix}${ccDisplayName} ${startDate} - ${endDate} Payslips.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}