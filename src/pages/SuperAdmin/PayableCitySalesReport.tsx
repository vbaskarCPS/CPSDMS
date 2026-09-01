// src/pages/SuperAdmin/PayableCitySalesReport.tsx
import React, { useMemo, useState } from 'react';
import { X, MapPin, TrendingUp, AlertTriangle, Check, Tag, FileText, FileSpreadsheet, Loader } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { LoadedWorkbook } from '../../lib/reportDataLoader';
import { PayableCity } from '../../lib/reportingService';
import { computePayableCitySales, CitySales } from '../../lib/payableCitySales';
import { SeasonType, Region } from '../../types';

interface Props {
  workbooks: LoadedWorkbook[];
  cities: PayableCity[];
}

const SEASON_LABELS: Record<SeasonType, string> = {
  aeration: 'Aeration',
  lawn_rejuv: 'Lawn Rejuv',
  sealing: 'Sealing',
  cleaning: 'Window Cleaning',
};

const REGIONS: Region[] = ['West', 'Central', 'East'];
const REGION_DOT: Record<Region, string> = { West: 'bg-blue-500', Central: 'bg-green-500', East: 'bg-orange-500' };

// Stable palette for chart segments.
const PALETTE = ['#3b82f6', '#f97316', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e', '#8b5cf6', '#14b8a6'];

const money = (n: number) => '$' + Math.round(n).toLocaleString();

// ============================================================================
// EXPORT HELPERS - shared by the PDF and XLSX builders
// ============================================================================

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

// Brand colours as RGB triples for jsPDF.
const C_DARK: [number, number, number] = [37, 37, 37];
const C_RED: [number, number, number] = [255, 79, 79];
const C_GREY: [number, number, number] = [154, 154, 154];
const C_BORDER: [number, number, number] = [230, 230, 230];
const C_HEADFILL: [number, number, number] = [244, 244, 244];
const C_ZEBRA: [number, number, number] = [250, 250, 250];

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-CA');

const fileStamp = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');

const segLabelOf = (s: { nickname?: string; region: Region; season: SeasonType }) =>
  s.nickname && s.nickname.trim() ? s.nickname : `${s.region} ${SEASON_LABELS[s.season] || s.season}`;

// Consistent colour per segment key within one exported document.
const segColorsFor = (city: CitySales) => {
  const keys = Array.from(new Set(city.days.flatMap((d) => d.segments.map((s) => s.key)))).sort();
  const m = new Map<string, string>();
  keys.forEach((k, i) => m.set(k, PALETTE[i % PALETTE.length]));
  return m;
};

// Push a blob at the browser as a download.
const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Fetch the brand logo and hand back a data URL plus its natural size.
// Returns null on any failure - the PDF then falls back to a typeset wordmark.
const loadLogo = async (): Promise<{ dataUrl: string; w: number; h: number } | null> => {
  try {
    const res = await fetch(LOGO_URL, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
};

// ============================================================================
// PDF EXPORT
// ============================================================================

const exportCityPdf = async (city: CitySales) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const M = 40;                       // page margin
  const PW = doc.internal.pageSize.getWidth();
  const W = PW - M * 2;               // content width

  const now = new Date();
  const generated = now.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const segColor = segColorsFor(city);

  // ---- Header banner ----
  doc.setFillColor(...C_DARK);
  doc.roundedRect(M, 36, W, 58, 8, 8, 'F');

  const logo = await loadLogo();
  if (logo) {
    const h = 26;
    const w = (logo.w / logo.h) * h;
    doc.addImage(logo.dataUrl, 'PNG', M + 16, 52, w, h);
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('CANADIAN PROPERTY STARS', M + 16, 70);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(184, 184, 184);
  doc.text('Payable City Sales', PW - M - 16, 60, { align: 'right' });
  doc.text(`Generated ${generated}`, PW - M - 16, 74, { align: 'right' });

  // ---- Title ----
  let y = 128;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C_DARK);
  doc.text(city.cityName, M, y);
  const nameW = doc.getTextWidth(city.cityName);
  doc.setFillColor(...C_RED);
  doc.circle(M + nameW + 12, y - 6, 3.5, 'F');
  doc.text('Payable Report', M + nameW + 24, y);

  if (!city.isConfigured) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(192, 57, 43);
    doc.text('REFERENCED IN A SPLIT', M + nameW + 24 + doc.getTextWidth('Payable Report') * 0.62 + 12, y - 8);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(107, 107, 107);
  doc.text(
    'Full breakdown of payable dollars: where they came from, tax and product-cost deductions, and daily sales by source.',
    M, y + 16
  );

  // ---- KPI tiles ----
  y += 32;
  const tiles: { k: string; v: string; accent?: boolean }[] = [
    { k: 'TOTAL PAYABLE', v: fmtMoney(city.total), accent: true },
    { k: 'GROSS BEHIND IT', v: fmtMoney(city.gross) },
    { k: 'CONTRIBUTING SOURCES', v: String(city.contributors.length) },
    { k: 'ACTIVE DAYS', v: String(city.days.length) },
  ];
  const gap = 10;
  const tw = (W - gap * 3) / 4;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + gap);
    if (t.accent) {
      doc.setFillColor(255, 245, 245);
      doc.setDrawColor(255, 208, 208);
    } else {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...C_BORDER);
    }
    doc.setLineWidth(0.7);
    doc.roundedRect(x, y, tw, 50, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(138, 138, 138);
    doc.text(t.k, x + 10, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    if (t.accent) doc.setTextColor(...C_RED); else doc.setTextColor(...C_DARK);
    doc.text(t.v, x + 10, y + 38);
  });
  y += 50;

  // ---- Section heading helper ----
  const heading = (label: string, atY: number) => {
    doc.setFillColor(...C_RED);
    doc.rect(M, atY - 8, 3, 11, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C_DARK);
    doc.text(label.toUpperCase(), M + 9, atY);
    return atY + 8;
  };

  const baseStyles = {
    font: 'helvetica' as const,
    fontSize: 7.5,
    cellPadding: 4,
    lineColor: C_BORDER,
    lineWidth: 0.4,
    textColor: C_DARK,
  };
  const baseHead = {
    fillColor: C_HEADFILL,
    textColor: [85, 85, 85] as [number, number, number],
    fontStyle: 'bold' as const,
    fontSize: 6.6,
  };
  const margin = { left: M, right: M, bottom: 54 };

  // ---- Where it came from ----
  y = heading('Where it came from', y + 30);
  if (city.contributors.length) {
    autoTable(doc, {
      startY: y,
      head: [['Source city', 'Type', 'Amount', 'Share']],
      body: city.contributors
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .map((c) => [
          c.fromCity,
          c.isOwn ? 'Own workers' : 'From another city',
          fmtMoney(c.amount),
          city.total > 0 ? ((c.amount / city.total) * 100).toFixed(1) + '%' : '0%',
        ]),
      theme: 'grid',
      styles: baseStyles,
      headStyles: baseHead,
      alternateRowStyles: { fillColor: C_ZEBRA },
      columnStyles: {
        0: { fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right', textColor: C_RED, fontStyle: 'bold' },
      },
      margin,
    });
    y = (doc as any).lastAutoTable.finalY;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C_GREY);
    doc.text('No contributing sources.', M, y + 12);
    y += 16;
  }

  // ---- By region / season ----
  const rs = city.regionSeason.slice().sort((a, b) => b.amount - a.amount);
  y = heading('By region / season', y + 30);
  if (rs.length) {
    const totals = rs.reduce(
      (t, r) => {
        t.gross += r.gross;
        t.tax += r.gross - r.afterTax;
        t.afterTax += r.afterTax;
        t.prod += r.afterTax - r.amount;
        t.amount += r.amount;
        return t;
      },
      { gross: 0, tax: 0, afterTax: 0, prod: 0, amount: 0 }
    );
    autoTable(doc, {
      startY: y,
      head: [['Region', 'Season', 'Gross', 'Tax %', 'Tax', 'After tax', 'Prod %', 'Product cost', 'Payable']],
      body: rs.map((r) => [
        r.region,
        SEASON_LABELS[r.season] || r.season,
        fmtMoney(r.gross),
        r.taxRate != null ? r.taxRate + '%' : 'varies',
        '-' + fmtMoney(r.gross - r.afterTax),
        fmtMoney(r.afterTax),
        r.productRate != null ? r.productRate + '%' : 'varies',
        '-' + fmtMoney(r.afterTax - r.amount),
        fmtMoney(r.amount),
      ]),
      foot: [[
        'Total', '',
        fmtMoney(totals.gross), '',
        '-' + fmtMoney(totals.tax),
        fmtMoney(totals.afterTax), '',
        '-' + fmtMoney(totals.prod),
        fmtMoney(totals.amount),
      ]],
      theme: 'grid',
      styles: baseStyles,
      headStyles: baseHead,
      footStyles: {
        fillColor: [255, 255, 255],
        textColor: C_DARK,
        fontStyle: 'bold',
        fontSize: 7.5,
        lineColor: C_DARK,
        lineWidth: { top: 1.2, right: 0.4, bottom: 0.4, left: 0.4 },
      },
      alternateRowStyles: { fillColor: C_ZEBRA },
      columnStyles: {
        0: { fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right', textColor: C_GREY },
        4: { halign: 'right', textColor: [192, 57, 43] },
        5: { halign: 'right' },
        6: { halign: 'right', textColor: C_GREY },
        7: { halign: 'right', textColor: [192, 57, 43] },
        8: { halign: 'right', textColor: C_RED, fontStyle: 'bold' },
      },
      margin,
    });
    y = (doc as any).lastAutoTable.finalY;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C_GREY);
    doc.text('No region / season breakdown.', M, y + 12);
    y += 16;
  }

  // ---- Daily sales by source ----
  y = heading('Daily sales by source', y + 30);
  const days = city.days.slice().sort((a, b) => a.ord - b.ord);
  if (days.length) {
    const rows: RowInput[] = [];
    const dots: string[] = [];
    days.forEach((d) => {
      const segs = d.segments.slice().sort((a, b) => b.amount - a.amount);
      segs.forEach((s, i) => {
        rows.push([
          i === 0 ? d.date : '',
          segLabelOf(s),
          d.total > 0 ? ((s.amount / d.total) * 100).toFixed(0) + '%' : '0%',
          fmtMoney(s.amount),
          i === 0 ? fmtMoney(d.total) : '',
        ]);
        dots.push(segColor.get(s.key) || '#6b7280');
      });
    });

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Source', 'Share', 'Amount', 'Day total']],
      body: rows,
      theme: 'grid',
      styles: baseStyles,
      headStyles: baseHead,
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 52 },
        1: { cellPadding: { top: 4, right: 4, bottom: 4, left: 15 } },
        2: { halign: 'right', textColor: C_GREY, cellWidth: 42 },
        3: { halign: 'right', cellWidth: 70 },
        4: { halign: 'right', fontStyle: 'bold', textColor: C_RED, cellWidth: 70 },
      },
      rowPageBreak: 'avoid',
      margin,
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 1) return;
        const colour = dots[data.row.index];
        if (!colour) return;
        doc.setFillColor(colour);
        doc.rect(data.cell.x + 5, data.cell.y + data.cell.height / 2 - 2.5, 5, 5, 'F');
      },
    });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C_GREY);
    doc.text('No daily data.', M, y + 12);
  }

  // ---- Footers on every page ----
  const pages = doc.getNumberOfPages();
  const PH = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C_BORDER);
    doc.setLineWidth(0.5);
    doc.line(M, PH - 40, PW - M, PH - 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_GREY);
    doc.text(`Canadian Property Stars - confidential payable report - ${city.cityName}`, M, PH - 28);
    doc.text(`${generated}    Page ${p} of ${pages}`, PW - M, PH - 28, { align: 'right' });
  }

  doc.save(`payable-city-${slug(city.cityName)}-${fileStamp(now)}.pdf`);
};

// ============================================================================
// XLSX EXPORT
// ============================================================================

const exportCityXlsx = async (city: CitySales) => {
  const now = new Date();
  const generated = now.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Canadian Property Stars';
  wb.created = now;

  const MONEY = '"$"#,##0.00';
  const PCT = '0.0"%"';

  // Style the first row of a sheet as a header and freeze it.
  const dressHeader = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FF555555' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F4' } };
    row.alignment = { vertical: 'middle' };
    row.height = 18;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // ---- Summary ----
  const s1 = wb.addWorksheet('Summary');
  s1.columns = [
    { header: 'Item', key: 'k', width: 28 },
    { header: 'Value', key: 'v', width: 26 },
  ];
  dressHeader(s1);
  s1.addRow({ k: 'City', v: city.cityName });
  s1.addRow({ k: 'Configured', v: city.isConfigured ? 'Yes' : 'No (referenced in a split)' });
  s1.addRow({ k: 'Generated', v: generated });
  s1.addRow({ k: '', v: '' });
  const rTotal = s1.addRow({ k: 'Total payable', v: city.total });
  const rGross = s1.addRow({ k: 'Gross behind it', v: city.gross });
  s1.addRow({ k: 'Contributing sources', v: city.contributors.length });
  s1.addRow({ k: 'Active days', v: city.days.length });
  [rTotal, rGross].forEach((r) => { r.getCell('v').numFmt = MONEY; });
  rTotal.font = { bold: true };

  // ---- Where it came from ----
  const s2 = wb.addWorksheet('Where it came from');
  s2.columns = [
    { header: 'Source city', key: 'city', width: 26 },
    { header: 'Type', key: 'type', width: 20 },
    { header: 'Amount', key: 'amt', width: 16, style: { numFmt: MONEY } },
    { header: 'Share %', key: 'share', width: 12, style: { numFmt: PCT } },
  ];
  dressHeader(s2);
  city.contributors
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .forEach((c) => {
      s2.addRow({
        city: c.fromCity,
        type: c.isOwn ? 'Own workers' : 'From another city',
        amt: c.amount,
        share: city.total > 0 ? (c.amount / city.total) * 100 : 0,
      });
    });

  // ---- Region & season ----
  const s3 = wb.addWorksheet('Region & Season');
  s3.columns = [
    { header: 'Region', key: 'region', width: 12 },
    { header: 'Season', key: 'season', width: 18 },
    { header: 'Gross', key: 'gross', width: 16, style: { numFmt: MONEY } },
    { header: 'Tax %', key: 'taxpct', width: 10 },
    { header: 'Tax', key: 'tax', width: 16, style: { numFmt: MONEY } },
    { header: 'After tax', key: 'after', width: 16, style: { numFmt: MONEY } },
    { header: 'Product %', key: 'prodpct', width: 11 },
    { header: 'Product cost', key: 'prod', width: 16, style: { numFmt: MONEY } },
    { header: 'Own workers', key: 'own', width: 16, style: { numFmt: MONEY } },
    { header: 'External', key: 'ext', width: 16, style: { numFmt: MONEY } },
    { header: 'Payable', key: 'payable', width: 16, style: { numFmt: MONEY } },
  ];
  dressHeader(s3);
  const rsSorted = city.regionSeason.slice().sort((a, b) => b.amount - a.amount);
  rsSorted.forEach((r) => {
    s3.addRow({
      region: r.region,
      season: SEASON_LABELS[r.season] || r.season,
      gross: r.gross,
      taxpct: r.taxRate != null ? r.taxRate / 100 : 'varies',
      tax: r.gross - r.afterTax,
      after: r.afterTax,
      prodpct: r.productRate != null ? r.productRate / 100 : 'varies',
      prod: r.afterTax - r.amount,
      own: r.own,
      ext: r.external,
      payable: r.amount,
    });
  });
  rsSorted.forEach((r, i) => {
    const row = s3.getRow(i + 2);
    if (r.taxRate != null) row.getCell('taxpct').numFmt = '0%';
    if (r.productRate != null) row.getCell('prodpct').numFmt = '0%';
  });
  if (rsSorted.length) {
    const t = rsSorted.reduce(
      (acc, r) => {
        acc.gross += r.gross;
        acc.tax += r.gross - r.afterTax;
        acc.after += r.afterTax;
        acc.prod += r.afterTax - r.amount;
        acc.own += r.own;
        acc.ext += r.external;
        acc.payable += r.amount;
        return acc;
      },
      { gross: 0, tax: 0, after: 0, prod: 0, own: 0, ext: 0, payable: 0 }
    );
    const tot = s3.addRow({
      region: 'Total', season: '',
      gross: t.gross, taxpct: '', tax: t.tax, after: t.after,
      prodpct: '', prod: t.prod, own: t.own, ext: t.ext, payable: t.payable,
    });
    tot.font = { bold: true };
    tot.border = { top: { style: 'medium', color: { argb: 'FF252525' } } };
  }

  // ---- Daily ----
  const s4 = wb.addWorksheet('Daily');
  s4.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Source', key: 'source', width: 30 },
    { header: 'Region', key: 'region', width: 12 },
    { header: 'Season', key: 'season', width: 18 },
    { header: 'Share %', key: 'share', width: 11, style: { numFmt: PCT } },
    { header: 'Amount', key: 'amt', width: 16, style: { numFmt: MONEY } },
    { header: 'Day total', key: 'daytotal', width: 16, style: { numFmt: MONEY } },
  ];
  dressHeader(s4);
  city.days
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .forEach((d) => {
      d.segments
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .forEach((seg, i) => {
          s4.addRow({
            date: d.date,
            source: segLabelOf(seg),
            region: seg.region,
            season: SEASON_LABELS[seg.season] || seg.season,
            share: d.total > 0 ? (seg.amount / d.total) * 100 : 0,
            amt: seg.amount,
            daytotal: i === 0 ? d.total : null,
          });
        });
    });
  s4.autoFilter = { from: 'A1', to: 'G1' };

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `payable-city-${slug(city.cityName)}-${fileStamp(now)}.xlsx`
  );
};

// ============================================================================

const regionTotals = (city: CitySales): Record<Region, number> => {
  const m: Record<Region, number> = { West: 0, Central: 0, East: 0 };
  city.regionSeason.forEach((rs) => { m[rs.region] = (m[rs.region] || 0) + rs.amount; });
  return m;
};

// Display label for a nickname/range: the nickname, or "Region Season".
const rangeLabel = (nickname: string | undefined, region: Region, season: SeasonType) =>
  nickname || `${region} ${SEASON_LABELS[season] || season}`;

const PayableCitySalesReport: React.FC<Props> = ({ workbooks, cities }) => {
  const result = useMemo(() => computePayableCitySales(workbooks, cities), [workbooks, cities]);
  const [selected, setSelected] = useState<CitySales | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Run one export, guarding against double-clicks and surfacing failures.
  const runExport = async (city: CitySales, kind: 'pdf' | 'xlsx') => {
    const tag = `${city.cityName}|${kind}`;
    if (busy) return;
    setBusy(tag);
    setExportError(null);
    try {
      if (kind === 'pdf') await exportCityPdf(city);
      else await exportCityXlsx(city);
    } catch (err) {
      setExportError(
        `Couldn't build the ${kind.toUpperCase()} for ${city.cityName}: ` +
        (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setBusy(null);
    }
  };

  // Flatten every range across workbooks into one card each (nicknames are individual).
  const nicknameCards = useMemo(() => {
    const cards = result.workbookBreakdown.flatMap((wb) =>
      wb.ranges.map((r) => ({ ...r, workbook: wb.label }))
    );
    return cards.sort((a, b) => b.payable - a.payable);
  }, [result]);

  // Stable colour per day-chart segment key (nickname / region-season), across all cities.
  const colorFor = useMemo(() => {
    const keys = new Set<string>();
    result.cities.forEach((c) => c.days.forEach((d) => d.segments.forEach((s) => keys.add(s.key))));
    const m = new Map<string, string>();
    Array.from(keys).sort().forEach((k, i) => m.set(k, PALETTE[i % PALETTE.length]));
    return (key: string) => m.get(key) || '#6b7280';
  }, [result]);

  const un = result.unattributed;

  if (cities.length === 0) {
    return (
      <div className="mt-6 bg-gray-800/40 rounded-xl border border-gray-700 border-dashed p-8 text-center">
        <p className="text-sm text-gray-400">Add payable cities and assign their prefixes to see sales here.</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* SLIM TOTALS */}
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Total production</h3>
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Payable</div>
          <div className="text-2xl font-bold text-teal-300">{money(result.summary.totalPayable)}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Gross</div>
          <div className="text-2xl font-bold text-gray-200">{money(result.summary.totalGross)}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Tax</div>
          <div className="text-2xl font-bold text-gray-400">{money(result.summary.totalTax)}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Product cost</div>
          <div className="text-2xl font-bold text-gray-400">{money(result.summary.totalProduct)}</div>
        </div>
      </div>

      {exportError && (
        <div className="mb-4 bg-red-950/40 border border-red-900/60 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span className="flex-1">{exportError}</span>
          <button onClick={() => setExportError(null)} className="text-red-400 hover:text-red-200"><X size={15} /></button>
        </div>
      )}

      {/* CITY CARDS */}
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Payable sales by city</h3>
      <div className="space-y-3">
        {result.cities.map((city) => {
          const rt = regionTotals(city);
          const pdfBusy = busy === `${city.cityName}|pdf`;
          const xlsBusy = busy === `${city.cityName}|xlsx`;
          return (
            <div key={city.cityName} className="relative">
              <button
                onClick={() => setSelected(city)}
                className="w-full bg-gray-800 rounded-xl border border-gray-700 p-5 pr-14 text-left hover:border-gray-600 transition-colors flex flex-col sm:flex-row sm:items-center gap-5"
              >
                <div className="sm:w-56 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin size={16} className="text-purple-400 flex-shrink-0" />
                    <span className="font-bold text-white text-lg truncate">{city.cityName}</span>
                    {!city.isConfigured && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 flex-shrink-0" title="Referenced in a split but not a configured city">unlisted</span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-teal-300">{money(city.total)}</div>
                  <div className="text-[11px] text-gray-500 mt-1">tap for full breakdown</div>
                </div>

                <div className="flex-1 grid grid-cols-3 gap-3">
                  {REGIONS.map((r) => (
                    <div key={r} className="bg-gray-900 rounded-lg border border-gray-700 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${REGION_DOT[r]}`} />
                        <span className="text-xs text-gray-400">{r}</span>
                      </div>
                      <div className="text-lg font-semibold text-gray-200">{money(rt[r])}</div>
                    </div>
                  ))}
                </div>
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); runExport(city, 'pdf'); }}
                disabled={busy !== null}
                title={`Download PDF report for ${city.cityName}`}
                className="absolute top-3 right-12 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-rose-500 transition-colors disabled:opacity-40"
              >
                {pdfBusy ? <Loader size={15} className="animate-spin" /> : <FileText size={15} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); runExport(city, 'xlsx'); }}
                disabled={busy !== null}
                title={`Download Excel workbook for ${city.cityName}`}
                className="absolute top-3 right-3 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-emerald-500 transition-colors disabled:opacity-40"
              >
                {xlsBusy ? <Loader size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* BREAKDOWN BY NICKNAME */}
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Breakdown by nickname</h3>
      <div className="space-y-4 mb-10">
        {nicknameCards.map((card) => (
          <div key={`${card.workbook}-${card.startTab}-${card.endTab}`} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Tag size={16} className="text-teal-400 flex-shrink-0" />
                <span className="font-bold text-white text-lg">{rangeLabel(card.nickname, card.region, card.season)}</span>
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${REGION_DOT[card.region]}`} />
                <span className="text-gray-400 text-sm">{card.region}</span>
                <span className="text-gray-500 text-xs">{SEASON_LABELS[card.season] || card.season}</span>
                <span className="text-gray-600 text-xs">{card.startTab}{'\u2013'}{card.endTab}</span>
                <span className="text-gray-600 text-xs">{'\u00b7'} {card.workbook}</span>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-teal-300">{money(card.payable)}</div>
                <div className="text-[11px] text-gray-500">gross {money(card.gross)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {card.cities.map((c) => (
                <div key={c.cityName} className="bg-gray-900 rounded-lg border border-gray-700 px-3 py-2 flex items-center gap-2">
                  <MapPin size={12} className="text-purple-400 flex-shrink-0" />
                  <span className="text-sm text-gray-200 truncate">{c.cityName}</span>
                  <div className="ml-auto text-right">
                    <div className="text-sm font-semibold text-teal-300">{money(c.payable)}</div>
                    <div className="text-[10px] text-gray-500">gross {money(c.gross)}</div>
                  </div>
                </div>
              ))}
              {card.unattributed > 0.5 && (
                <div className="bg-amber-950/20 rounded-lg border border-amber-900/40 px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                  <span className="text-sm text-amber-300">unattributed</span>
                  <span className="ml-auto text-sm font-semibold text-amber-300">{money(card.unattributed)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* UNATTRIBUTED */}
      {un.total > 0.5 ? (
        <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <span className="text-sm font-bold text-amber-300">Unattributed</span>
            <span className="ml-auto text-sm font-bold text-amber-200">{money(un.total)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-400">
            <div>No matching date range: <span className="text-gray-300">{money(un.noRange)}</span> <span className="text-gray-600">(gross)</span></div>
            <div>No city for prefix: <span className="text-gray-300">{money(un.noCity)}</span></div>
            <div>Region not configured: <span className="text-gray-300">{money(un.regionUnconfigured)}</span></div>
          </div>
        </div>
      ) : (
        <div className="bg-green-950/20 border border-green-900/40 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-green-300">
          <Check size={16} /> Every dollar of sales was attributed to a city.
        </div>
      )}

      {/* BREAKDOWN MODAL */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-purple-400" />
                <h2 className="text-lg font-bold text-white">{selected.cityName}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => runExport(selected, 'pdf')}
                  disabled={busy !== null}
                  title="Download PDF report"
                  className="p-2 rounded-lg text-gray-400 border border-gray-700 hover:text-white hover:border-rose-500 transition-colors disabled:opacity-40"
                >
                  {busy === `${selected.cityName}|pdf` ? <Loader size={16} className="animate-spin" /> : <FileText size={16} />}
                </button>
                <button
                  onClick={() => runExport(selected, 'xlsx')}
                  disabled={busy !== null}
                  title="Download Excel workbook"
                  className="p-2 rounded-lg text-gray-400 border border-gray-700 hover:text-white hover:border-emerald-500 transition-colors disabled:opacity-40"
                >
                  {busy === `${selected.cityName}|xlsx` ? <Loader size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                </button>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white ml-1"><X size={20} /></button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <div className="flex items-baseline gap-2">
                  <TrendingUp size={18} className="text-teal-400" />
                  <span className="text-3xl font-bold text-teal-300">{money(selected.total)}</span>
                  <span className="text-sm text-gray-500">payable sales</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 pl-7">
                  Gross {money(selected.gross)} {'\u00b7'} deductions {money(selected.gross - selected.total)} {'\u00b7'} payable {money(selected.total)}
                </div>
              </div>

              {selected.total < 0.5 ? (
                <p className="text-sm text-gray-500">No sales attributed to this city yet.</p>
              ) : (
                <>
                  {/* CONTRIBUTORS */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Where it came from</h4>
                    <div className="space-y-1">
                      {selected.contributors.map((c) => (
                        <div key={c.fromCity} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-200">{c.fromCity}</span>
                          {c.isOwn
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-900/40 text-teal-300">own workers</span>
                            : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">from other city</span>}
                          <span className="ml-auto text-gray-400">{money(c.amount)}</span>
                          <span className="text-gray-600 text-xs w-12 text-right">{(c.amount / selected.total * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* REGION / SEASON with step-by-step */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">By region &amp; season</h4>
                    <div className="space-y-1.5">
                      {selected.regionSeason.map((rs) => (
                        <div key={`${rs.region}-${rs.season}`} className="bg-gray-900 rounded-lg border border-gray-700 px-3 py-2">
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${REGION_DOT[rs.region]}`} />
                            <span className="text-gray-200 font-medium">{rs.region}</span>
                            <span className="text-gray-500 text-xs">{SEASON_LABELS[rs.season] || rs.season}</span>
                            <span className="ml-auto font-semibold text-gray-200">{money(rs.amount)}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs pl-4">
                            <span className="text-teal-300">Own workers {money(rs.own)}</span>
                            <span className="text-blue-300">External {money(rs.external)}</span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-gray-800 text-[11px] space-y-0.5 pl-4">
                            <div className="flex justify-between text-gray-500"><span>Gross</span><span>{money(rs.gross)}</span></div>
                            <div className="flex justify-between text-gray-500">
                              <span>less {rs.taxRate != null ? `${rs.taxRate}% tax` : 'tax (rate varies)'}</span>
                              <span>-{money(rs.gross - rs.afterTax)}</span>
                            </div>
                            <div className="flex justify-between text-gray-400"><span>after tax</span><span>{money(rs.afterTax)}</span></div>
                            <div className="flex justify-between text-gray-500">
                              <span>less {rs.productRate != null ? `${rs.productRate}% product cost` : 'product cost (rate varies)'}</span>
                              <span>-{money(rs.afterTax - rs.amount)}</span>
                            </div>
                            <div className="flex justify-between text-teal-300 font-medium"><span>payable</span><span>{money(rs.amount)}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* PER-DAY STACKED CHART - split by nickname */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">By day, split by nickname</h4>

                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                      {Array.from(new Map(selected.days.flatMap((d) => d.segments.map((s) => [s.key, s] as const))).values()).map((s) => (
                        <span key={s.key} className="flex items-center gap-1 text-[11px] text-gray-400">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorFor(s.key) }} />
                          {rangeLabel(s.nickname, s.region, s.season)}
                        </span>
                      ))}
                    </div>

                    <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
                      {selected.days.map((day) => (
                        <div key={day.date} className="flex items-center gap-2">
                          <span className="w-12 text-[11px] text-gray-500 flex-shrink-0">{day.date}</span>
                          <div className="flex-1 h-5 rounded overflow-hidden flex bg-gray-900">
                            {day.segments.map((seg) => (
                              <div
                                key={seg.key}
                                style={{ width: `${day.total ? (seg.amount / day.total) * 100 : 0}%`, backgroundColor: colorFor(seg.key) }}
                                title={`${rangeLabel(seg.nickname, seg.region, seg.season)}: ${money(seg.amount)} (${day.total ? (seg.amount / day.total * 100).toFixed(0) : 0}%)`}
                              />
                            ))}
                          </div>
                          <span className="w-16 text-right text-[11px] text-gray-500 flex-shrink-0">{money(day.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayableCitySalesReport;