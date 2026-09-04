// src/pages/SuperAdmin/PayableCitySalesReport.tsx
import React, { useMemo, useState } from 'react';
import { X, MapPin, TrendingUp, AlertTriangle, Check, Tag, FileText, FileSpreadsheet, Wallet, Loader } from 'lucide-react';
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
    'Own vs import revenue, tax and product-cost deductions, and a day-by-day breakdown of gross and payable.',
    M, y + 16
  );

  // ---- KPI tiles ----
  y += 32;
  const tiles: { k: string; v: string; accent?: boolean }[] = [
    { k: 'TOTAL PAYABLE', v: fmtMoney(city.total), accent: true },
    { k: 'OWN PAYABLE', v: fmtMoney(city.own) },
    { k: 'IMPORT PAYABLE', v: fmtMoney(city.external) },
    { k: 'GROSS BEHIND IT', v: fmtMoney(city.gross) },
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C_GREY);
  doc.text(
    `${city.contributors.length} contributing source${city.contributors.length === 1 ? '' : 's'}   |   ${city.days.length} active day${city.days.length === 1 ? '' : 's'}`,
    M, y + 14
  );
  y += 6;

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

  // ---- Own vs import ----
  const pctOf = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) + '%' : '0%');
  y = heading('Own vs import revenue', y + 30);
  autoTable(doc, {
    startY: y,
    head: [['', 'Gross', 'Share of gross', 'Payable', 'Share of payable']],
    body: [
      ['Own workers', fmtMoney(city.grossOwn), pctOf(city.grossOwn, city.gross), fmtMoney(city.own), pctOf(city.own, city.total)],
      ['Imported', fmtMoney(city.grossExternal), pctOf(city.grossExternal, city.gross), fmtMoney(city.external), pctOf(city.external, city.total)],
    ],
    foot: [['Total', fmtMoney(city.gross), '100%', fmtMoney(city.total), '100%']],
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
      1: { halign: 'right' },
      2: { halign: 'right', textColor: C_GREY },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right', textColor: C_RED, fontStyle: 'bold' },
    },
    margin,
  });
  y = (doc as any).lastAutoTable.finalY;

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
          c.isOwn ? 'Own workers' : 'Import',
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
  y = heading('Day by day, by nickname - own vs import', y + 30);
  const days = city.days.slice().sort((a, b) => a.ord - b.ord);
  if (days.length) {
    const rows: RowInput[] = [];
    const dots: (string | null)[] = [];   // null marks a day-subtotal row
    days.forEach((d) => {
      const segs = d.segments.slice().sort((a, b) => b.amount - a.amount);
      segs.forEach((sg, i) => {
        rows.push([
          i === 0 ? d.date : '',
          segLabelOf(sg),
          fmtMoney(sg.grossOwn), fmtMoney(sg.grossExternal), fmtMoney(sg.gross),
          fmtMoney(sg.own), fmtMoney(sg.external), fmtMoney(sg.amount),
        ]);
        dots.push(segColor.get(sg.key) || '#6b7280');
      });
      if (segs.length > 1) {
        rows.push([
          '', 'Day total',
          fmtMoney(d.grossOwn), fmtMoney(d.grossExternal), fmtMoney(d.gross),
          fmtMoney(d.own), fmtMoney(d.external), fmtMoney(d.total),
        ]);
        dots.push(null);
      }
    });
    const dTot = days.reduce(
      (t, d) => {
        t.grossOwn += d.grossOwn; t.grossExternal += d.grossExternal; t.gross += d.gross;
        t.own += d.own; t.external += d.external; t.total += d.total;
        return t;
      },
      { grossOwn: 0, grossExternal: 0, gross: 0, own: 0, external: 0, total: 0 }
    );

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Source', 'Own gross', 'Import gross', 'Gross', 'Own pay', 'Import pay', 'Payable']],
      body: rows,
      foot: [[
        'Total', '',
        fmtMoney(dTot.grossOwn), fmtMoney(dTot.grossExternal), fmtMoney(dTot.gross),
        fmtMoney(dTot.own), fmtMoney(dTot.external), fmtMoney(dTot.total),
      ]],
      theme: 'grid',
      styles: { ...baseStyles, fontSize: 6.2, cellPadding: 2.5 },
      headStyles: { ...baseHead, fontSize: 5.8 },
      footStyles: {
        fillColor: [255, 255, 255],
        textColor: C_DARK,
        fontStyle: 'bold',
        fontSize: 6.2,
        lineColor: C_DARK,
        lineWidth: { top: 1.2, right: 0.4, bottom: 0.4, left: 0.4 },
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40, halign: 'left' },
        1: { cellWidth: 96, cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 11 } },
        2: { halign: 'right', cellWidth: 66 },
        3: { halign: 'right', cellWidth: 66, textColor: [59, 130, 246] },
        4: { halign: 'right', cellWidth: 66, fontStyle: 'bold' },
        5: { halign: 'right', cellWidth: 66 },
        6: { halign: 'right', cellWidth: 66, textColor: [59, 130, 246] },
        7: { halign: 'right', cellWidth: 66, fontStyle: 'bold', textColor: C_RED },
      },
      rowPageBreak: 'avoid',
      margin,
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        if (dots[data.row.index] === null) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [238, 238, 238];
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 1) return;
        const colour = dots[data.row.index];
        if (!colour) return;
        doc.setFillColor(colour);
        doc.rect(data.cell.x + 3, data.cell.y + data.cell.height / 2 - 2, 4.5, 4.5, 'F');
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
  const rOwnPay = s1.addRow({ k: 'Own payable', v: city.own });
  const rImpPay = s1.addRow({ k: 'Import payable', v: city.external });
  const rGross = s1.addRow({ k: 'Gross behind it', v: city.gross });
  const rOwnGross = s1.addRow({ k: 'Own gross', v: city.grossOwn });
  const rImpGross = s1.addRow({ k: 'Import gross', v: city.grossExternal });
  s1.addRow({ k: 'Contributing sources', v: city.contributors.length });
  s1.addRow({ k: 'Active days', v: city.days.length });
  [rTotal, rOwnPay, rImpPay, rGross, rOwnGross, rImpGross].forEach((r) => { r.getCell('v').numFmt = MONEY; });
  rTotal.font = { bold: true };
  rGross.font = { bold: true };

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
        type: c.isOwn ? 'Own workers' : 'Import',
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
    { header: 'Own gross', key: 'grossown', width: 16, style: { numFmt: MONEY } },
    { header: 'Import gross', key: 'grossext', width: 16, style: { numFmt: MONEY } },
    { header: 'Own payable', key: 'own', width: 16, style: { numFmt: MONEY } },
    { header: 'Import payable', key: 'ext', width: 16, style: { numFmt: MONEY } },
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
      grossown: r.grossOwn,
      grossext: r.grossExternal,
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
        acc.grossown += r.grossOwn;
        acc.grossext += r.grossExternal;
        acc.own += r.own;
        acc.ext += r.external;
        acc.payable += r.amount;
        return acc;
      },
      { gross: 0, tax: 0, after: 0, prod: 0, grossown: 0, grossext: 0, own: 0, ext: 0, payable: 0 }
    );
    const tot = s3.addRow({
      region: 'Total', season: '',
      gross: t.gross, taxpct: '', tax: t.tax, after: t.after,
      prodpct: '', prod: t.prod,
      grossown: t.grossown, grossext: t.grossext,
      own: t.own, ext: t.ext, payable: t.payable,
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
    { header: 'Own gross', key: 'grossown', width: 15, style: { numFmt: MONEY } },
    { header: 'Import gross', key: 'grossext', width: 15, style: { numFmt: MONEY } },
    { header: 'Gross', key: 'gross', width: 15, style: { numFmt: MONEY } },
    { header: 'Own payable', key: 'own', width: 15, style: { numFmt: MONEY } },
    { header: 'Import payable', key: 'ext', width: 15, style: { numFmt: MONEY } },
    { header: 'Payable', key: 'amt', width: 15, style: { numFmt: MONEY } },
    { header: 'Day payable', key: 'daytotal', width: 15, style: { numFmt: MONEY } },
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
            grossown: seg.grossOwn,
            grossext: seg.grossExternal,
            gross: seg.gross,
            own: seg.own,
            ext: seg.external,
            amt: seg.amount,
            daytotal: i === 0 ? d.total : null,
          });
        });
    });
  s4.autoFilter = { from: 'A1', to: 'L1' };

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `payable-city-${slug(city.cityName)}-${fileStamp(now)}.xlsx`
  );
};


// ============================================================================
// PAYOUT EXPORT - manager payout workbook (Rates / Daily Sales / Manager Payout)
// ----------------------------------------------------------------------------
// The payout sheet shows the full gross -> payable ladder for every region and
// season, then a commission block that sits on whichever of the two the
// "Commission basis" cell names.
// ============================================================================

const PAYOUT_REGIONS: Region[] = ['West', 'Central', 'East'];
const PAYOUT_SEASONS: SeasonType[] = ['aeration', 'lawn_rejuv', 'sealing', 'cleaning'];

const exportCityPayout = async (city: CitySales) => {
  const now = new Date();
  const generated = now.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Canadian Property Stars';
  wb.created = now;

  const MONEY = '"$"#,##0.00;("$"#,##0.00);-';
  const PCT = '0.0%';
  const ARGB_DARK = 'FF252525';
  const ARGB_YELLOW = 'FFFFFF00';
  const ARGB_GREY = 'FFF4F4F4';
  const BLUE = { argb: 'FF0000FF' };
  const GREEN = { argb: 'FF008000' };
  const RED = { argb: 'FFFF4F4F' };
  const GREYTXT = { argb: 'FF808080' };
  const DEDRED = { argb: 'FFC0392B' };

  const headerRow = (ws: ExcelJS.Worksheet, rowNo: number, labels: string[]) => {
    const row = ws.getRow(rowNo);
    labels.forEach((l, i) => {
      const c = row.getCell(i + 1);
      c.value = l;
      c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_DARK } };
    });
    row.height = 18;
  };
  const asInput = (c: ExcelJS.Cell, fmt?: string) => {
    c.font = { name: 'Arial', size: 10, color: BLUE };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_YELLOW } };
    if (fmt) c.numFmt = fmt;
  };
  const asCalc = (c: ExcelJS.Cell, fmt?: string, bold = false) => {
    c.font = { name: 'Arial', size: 10, bold };
    if (fmt) c.numFmt = fmt;
  };
  const asLink = (c: ExcelJS.Cell, fmt?: string) => {
    c.font = { name: 'Arial', size: 10, color: GREEN };
    if (fmt) c.numFmt = fmt;
  };
  const asDed = (c: ExcelJS.Cell) => {
    c.font = { name: 'Arial', size: 10, color: DEDRED };
    c.numFmt = MONEY;
  };
  const noteCell = (ws: ExcelJS.Worksheet, addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: 'Arial', size: 9, italic: true, color: GREYTXT };
  };
  const topRule = { top: { style: 'medium' as const, color: { argb: ARGB_DARK } } };

  const pairs: { region: Region; season: SeasonType }[] = [];
  PAYOUT_REGIONS.forEach((region) => PAYOUT_SEASONS.forEach((season) => pairs.push({ region, season })));

  // ------------------------------------------------------------ RATES
  const rates = wb.addWorksheet('Rates');
  rates.columns = [
    { width: 14 }, { width: 20 }, { width: 11 }, { width: 14 },
    { width: 16 }, { width: 11 }, { width: 26 },
  ];
  headerRow(rates, 1, [
    'Region', 'Season', 'Tax %', 'Product cost %', 'Commission rate', 'Payable?', 'Key (do not edit)',
  ]);
  rates.views = [{ state: 'frozen', ySplit: 1 }];
  pairs.forEach((p, i) => {
    const r = i + 2;
    const row = rates.getRow(r);
    const found = city.regionSeason.find((x) => x.region === p.region && x.season === p.season);
    row.getCell(1).value = p.region;
    row.getCell(2).value = SEASON_LABELS[p.season] || p.season;
    const tax = row.getCell(3);
    tax.value = found && found.taxRate != null ? found.taxRate / 100 : 0;
    asInput(tax, PCT);
    const prod = row.getCell(4);
    prod.value = found && found.productRate != null ? found.productRate / 100 : 0;
    asInput(prod, PCT);
    const comm = row.getCell(5);
    comm.value = 0.035;
    asInput(comm, PCT);
    const pay = row.getCell(6);
    pay.value = 'Yes';
    asInput(pay);
    pay.dataValidation = { type: 'list', allowBlank: false, formulae: ['"Yes,No"'] };
    const key = row.getCell(7);
    key.value = { formula: `A${r}&"|"&B${r}` } as ExcelJS.CellFormulaValue;
    key.font = { name: 'Arial', size: 9, italic: true, color: GREYTXT };
  });
  const rFirst = 2;
  const rLast = pairs.length + 1;
  noteCell(rates, `A${rLast + 2}`,
    'Tax and product-cost rates were read from the report where the city had sales in that combination; blank ones default to zero. Commission rate starts at 3.5% everywhere - change it per row. Payable? No zeroes a row out without deleting it.');

  // ------------------------------------------------------------ DAILY SALES
  const daily = wb.addWorksheet('Daily Sales');
  daily.columns = [
    { width: 12 }, { width: 12 }, { width: 18 }, { width: 28 },
    { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 },
  ];
  headerRow(daily, 1, [
    'Date', 'Region', 'Season', 'Source / nickname',
    'Own gross', 'Import gross', 'Own payable', 'Import payable',
  ]);
  daily.views = [{ state: 'frozen', ySplit: 1 }];
  let dr = 2;
  city.days
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .forEach((d) => {
      d.segments
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .forEach((seg) => {
          const row = daily.getRow(dr);
          row.getCell(1).value = d.date;
          row.getCell(2).value = seg.region;
          row.getCell(3).value = SEASON_LABELS[seg.season] || seg.season;
          row.getCell(4).value = segLabelOf(seg);
          ([[5, seg.grossOwn], [6, seg.grossExternal], [7, seg.own], [8, seg.external]] as [number, number][])
            .forEach(([col, val]) => {
              const c = row.getCell(col);
              c.value = val;
              asCalc(c, MONEY);
            });
          dr += 1;
        });
    });
  const dFirst = 2;
  const dLast = Math.max(dr - 1, dFirst);
  const dTot = daily.getRow(dLast + 1);
  dTot.getCell(4).value = 'TOTAL';
  dTot.getCell(4).font = { name: 'Arial', size: 10, bold: true };
  (['E', 'F', 'G', 'H'] as const).forEach((col, i) => {
    const c = dTot.getCell(5 + i);
    c.value = { formula: `SUM(${col}${dFirst}:${col}${dLast})` } as ExcelJS.CellFormulaValue;
    asCalc(c, MONEY, true);
    c.border = topRule;
  });
  daily.autoFilter = { from: 'A1', to: 'H1' };

  const DR = (col: string) => `'Daily Sales'!$${col}$${dFirst}:$${col}$${dLast}`;
  const RT = (col: string) => `Rates!$${col}$${rFirst}:$${col}$${rLast}`;
  const lookup = (col: string, r: number) =>
    `IFERROR(INDEX(${RT(col)},MATCH($B${r}&"|"&$C${r},${RT('G')},0)),0)`;

  // ------------------------------------------------------------ MANAGER PAYOUT
  const ws = wb.addWorksheet('Manager Payout');
  ws.columns = [
    { width: 3 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 9 }, { width: 13 }, { width: 14 }, { width: 10 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 52 },
  ];

  const LASTCOL = 14;
  const section = (r: number, text: string) => {
    const row = ws.getRow(r);
    for (let c = 2; c <= LASTCOL; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_DARK } };
    }
    const c = row.getCell(2);
    c.value = text;
    c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    return r + 1;
  };
  const label = (r: number, text: string, bold = false) => {
    const c = ws.getRow(r).getCell(2);
    c.value = text;
    c.font = { name: 'Arial', size: 10, bold };
  };
  const colHeads = (r: number, labels: string[]) => {
    const row = ws.getRow(r);
    labels.forEach((h, i) => {
      const c = row.getCell(2 + i);
      c.value = h;
      c.font = { name: 'Arial', size: 9, bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_GREY } };
      c.alignment = { horizontal: 'center', wrapText: true };
    });
  };

  ws.getCell('B1').value = 'MANAGEMENT PAYOUT';
  ws.getCell('B1').font = { name: 'Arial', size: 16, bold: true, color: { argb: ARGB_DARK } };
  noteCell(ws, 'B2', 'Yellow = type here.  Green = pulled from another tab.  Black = calculated, do not overtype.');

  let r = 4;
  label(r, 'City');
  ws.getRow(r).getCell(3).value = city.cityName;
  asCalc(ws.getRow(r).getCell(3)); r += 1;
  label(r, 'Team'); asInput(ws.getRow(r).getCell(3)); r += 1;
  label(r, 'Manager'); asInput(ws.getRow(r).getCell(3)); r += 1;
  label(r, 'Generated'); ws.getRow(r).getCell(3).value = generated; r += 2;

  r = section(r, 'BASIS');
  const basisRow = r;
  label(r, 'Commission basis');
  const bc = ws.getRow(r).getCell(3);
  bc.value = 'Gross';
  asInput(bc);
  bc.dataValidation = { type: 'list', allowBlank: false, formulae: ['"Gross,Payable"'] };
  noteCell(ws, `O${r}`, 'Gross or Payable. The commission block below sits on whichever you name here.');
  r += 1;
  label(r, 'City deduction rate');
  asInput(ws.getRow(r).getCell(3), PCT);
  ws.getRow(r).getCell(3).value = 0;
  const RC = `$C$${r}`;
  noteCell(ws, `O${r}`, 'Applied to the city deductions total at the bottom of this sheet.');
  r += 2;

  // ---- LADDER: gross -> payable, per region / season ----
  r = section(r, 'GROSS TO PAYABLE BY REGION / SEASON');
  colHeads(r, [
    'Region', 'Season', 'Own gross', 'Import gross', 'Gross',
    'Tax %', 'less tax', 'After tax', 'Product %', 'less product cost',
    'Payable', 'Payable (from daily)', 'Difference',
  ]);
  r += 1;
  const lFirst = r;
  const ladderRowOf = new Map<string, number>();
  pairs.forEach((p) => {
    const row = ws.getRow(r);
    ladderRowOf.set(`${p.region}|${p.season}`, r);
    row.getCell(2).value = p.region;
    row.getCell(3).value = SEASON_LABELS[p.season] || p.season;
    asCalc(row.getCell(2));
    asCalc(row.getCell(3));

    const ownG = row.getCell(4);
    ownG.value = { formula: `SUMIFS(${DR('E')},${DR('B')},$B${r},${DR('C')},$C${r})` } as ExcelJS.CellFormulaValue;
    asLink(ownG, MONEY);
    const impG = row.getCell(5);
    impG.value = { formula: `SUMIFS(${DR('F')},${DR('B')},$B${r},${DR('C')},$C${r})` } as ExcelJS.CellFormulaValue;
    asLink(impG, MONEY);

    const gross = row.getCell(6);
    gross.value = { formula: `D${r}+E${r}` } as ExcelJS.CellFormulaValue;
    asCalc(gross, MONEY, true);

    const taxPct = row.getCell(7);
    taxPct.value = { formula: lookup('C', r) } as ExcelJS.CellFormulaValue;
    asLink(taxPct, PCT);

    const tax = row.getCell(8);
    tax.value = { formula: `-(F${r}-F${r}/(1+G${r}))` } as ExcelJS.CellFormulaValue;
    asDed(tax);

    const afterTax = row.getCell(9);
    afterTax.value = { formula: `F${r}/(1+G${r})` } as ExcelJS.CellFormulaValue;
    asCalc(afterTax, MONEY);

    const prodPct = row.getCell(10);
    prodPct.value = { formula: lookup('D', r) } as ExcelJS.CellFormulaValue;
    asLink(prodPct, PCT);

    const prodCost = row.getCell(11);
    prodCost.value = { formula: `-(I${r}*J${r})` } as ExcelJS.CellFormulaValue;
    asDed(prodCost);

    const payable = row.getCell(12);
    payable.value = { formula: `I${r}+K${r}` } as ExcelJS.CellFormulaValue;
    payable.font = { name: 'Arial', size: 10, bold: true, color: RED };
    payable.numFmt = MONEY;

    const fromDaily = row.getCell(13);
    fromDaily.value = {
      formula:
        `SUMIFS(${DR('G')},${DR('B')},$B${r},${DR('C')},$C${r})+` +
        `SUMIFS(${DR('H')},${DR('B')},$B${r},${DR('C')},$C${r})`,
    } as ExcelJS.CellFormulaValue;
    asLink(fromDaily, MONEY);

    const diff = row.getCell(14);
    diff.value = { formula: `L${r}-M${r}` } as ExcelJS.CellFormulaValue;
    asCalc(diff, MONEY);
    r += 1;
  });
  const lLast = r - 1;
  const lTot = ws.getRow(r);
  lTot.getCell(3).value = 'TOTAL';
  lTot.getCell(3).font = { name: 'Arial', size: 10, bold: true };
  lTot.getCell(3).border = topRule;
  (['D', 'E', 'F', 'H', 'I', 'K', 'L', 'M', 'N'] as const).forEach((col) => {
    const cn = col.charCodeAt(0) - 64;
    const c = lTot.getCell(cn);
    c.value = { formula: `SUM(${col}${lFirst}:${col}${lLast})` } as ExcelJS.CellFormulaValue;
    asCalc(c, MONEY, true);
    c.border = topRule;
  });
  (['G', 'J'] as const).forEach((col) => {
    lTot.getCell(col.charCodeAt(0) - 64).border = topRule;
  });
  noteCell(ws, `O${r}`,
    'Difference should be zero on every row. Anything else means the tax or product rate on the Rates tab does not match what the report used.');
  r += 2;

  // ---- COMMISSION ----
  r = section(r, 'COMMISSION BY REGION / SEASON');
  colHeads(r, [
    'Region', 'Season', 'Basis amount', 'Imports (lump)', 'Removals', 'Base', 'Rate', 'Commission',
  ]);
  r += 1;
  const cFirst = r;
  pairs.forEach((p) => {
    const row = ws.getRow(r);
    const lr = ladderRowOf.get(`${p.region}|${p.season}`) as number;
    row.getCell(2).value = p.region;
    row.getCell(3).value = SEASON_LABELS[p.season] || p.season;
    asCalc(row.getCell(2));
    asCalc(row.getCell(3));

    const basis = row.getCell(4);
    basis.value = { formula: `IF($C$${basisRow}="Gross",F${lr},L${lr})` } as ExcelJS.CellFormulaValue;
    asLink(basis, MONEY);

    const lump = row.getCell(5); lump.value = 0; asInput(lump, MONEY);
    const rem = row.getCell(6); rem.value = 0; asInput(rem, MONEY);

    const base = row.getCell(7);
    base.value = { formula: `D${r}+E${r}-F${r}` } as ExcelJS.CellFormulaValue;
    asCalc(base, MONEY, true);

    const rate = row.getCell(8);
    rate.value = {
      formula: `IF(${lookup('F', r)}="Yes",${lookup('E', r)},0)`,
    } as ExcelJS.CellFormulaValue;
    asLink(rate, PCT);

    const comm = row.getCell(9);
    comm.value = { formula: `G${r}*H${r}` } as ExcelJS.CellFormulaValue;
    asCalc(comm, MONEY, true);
    r += 1;
  });
  const cLast = r - 1;
  const cTot = ws.getRow(r);
  cTot.getCell(3).value = 'TOTAL';
  cTot.getCell(3).font = { name: 'Arial', size: 10, bold: true };
  cTot.getCell(3).border = topRule;
  (['D', 'E', 'F', 'G', 'I'] as const).forEach((col) => {
    const cn = col.charCodeAt(0) - 64;
    const c = cTot.getCell(cn);
    c.value = { formula: `SUM(${col}${cFirst}:${col}${cLast})` } as ExcelJS.CellFormulaValue;
    asCalc(c, MONEY, true);
    c.border = topRule;
  });
  cTot.getCell(8).border = topRule;
  const COMM_SALES = `I${r}`;
  r += 2;

  r = section(r, 'COMMISSION EARNED');
  label(r, 'Commission from sales');
  const cs = ws.getRow(r).getCell(4);
  cs.value = { formula: COMM_SALES } as ExcelJS.CellFormulaValue;
  asLink(cs, MONEY);
  const CSALES = `D${r}`; r += 1;
  const bonusCells: string[] = [];
  (['Bonus - individual', 'Bonus - team', 'Bonus - phone'] as const).forEach((lbl) => {
    label(r, lbl);
    const c = ws.getRow(r).getCell(4); c.value = 0; asInput(c, MONEY);
    bonusCells.push(`D${r}`); r += 1;
  });
  label(r, 'TOTAL COMMISSION', true);
  const tc = ws.getRow(r).getCell(4);
  tc.value = { formula: `${CSALES}+${bonusCells.join('+')}` } as ExcelJS.CellFormulaValue;
  asCalc(tc, MONEY, true);
  tc.border = topRule;
  const TC = `D${r}`; r += 2;

  r = section(r, 'ALREADY PAID AND DEDUCTIONS');
  const paidCells: string[] = [];
  (['Season payroll already received', 'Advance', 'Personal deductions', 'Pre-paid benefits'] as const)
    .forEach((lbl) => {
      label(r, lbl);
      const c = ws.getRow(r).getCell(4); c.value = 0; asInput(c, MONEY);
      paidCells.push(`D${r}`); r += 1;
    });
  const cityRow = r;
  label(r, 'City deductions'); r += 1;
  label(r, 'Total already paid and deducted', true);
  const to = ws.getRow(r).getCell(4);
  to.value = { formula: `${paidCells.join('+')}+D${cityRow}` } as ExcelJS.CellFormulaValue;
  asCalc(to, MONEY, true);
  to.border = topRule;
  const TO = `D${r}`; r += 2;

  r = section(r, 'RESULT');
  label(r, 'COMMISSION OWING', true);
  const owing = ws.getRow(r).getCell(4);
  owing.value = { formula: `${TC}-${TO}` } as ExcelJS.CellFormulaValue;
  owing.numFmt = MONEY;
  owing.font = { name: 'Arial', size: 14, bold: true, color: RED };
  noteCell(ws, `O${r}`, 'Negative means the manager has already been paid more than the commission earned.');
  r += 2;

  r = section(r, 'PAYROLL REFERENCE (not part of the commission maths)');
  (['Salary', 'RRSP contribution', 'RESP contribution', 'Payroll cash', 'Pre-paid benefits paid'] as const)
    .forEach((lbl) => {
      label(r, lbl);
      asInput(ws.getRow(r).getCell(4), MONEY); r += 1;
    });
  r += 1;

  r = section(r, 'CITY DEDUCTIONS');
  const cdFirst = r;
  ([
    'Spring billed', 'Summer billed', "Redo's (not done)", 'NSF cheques', 'DNB',
    'Refunds', 'Damages', 'Bank fees', 'Unprocessed CCD', 'E-transfers not received',
  ] as const).forEach((lbl) => {
    label(r, lbl);
    asInput(ws.getRow(r).getCell(4), MONEY); r += 1;
  });
  const cdLast = r - 1;
  label(r, 'TOTAL', true);
  const cdt = ws.getRow(r).getCell(4);
  cdt.value = { formula: `SUM(D${cdFirst}:D${cdLast})` } as ExcelJS.CellFormulaValue;
  asCalc(cdt, MONEY, true);
  cdt.border = topRule;
  const CDT = `D${r}`; r += 1;
  label(r, 'Charged at the city deduction rate', true);
  const cdc = ws.getRow(r).getCell(4);
  cdc.value = { formula: `${CDT}*${RC}` } as ExcelJS.CellFormulaValue;
  asCalc(cdc, MONEY, true);
  const CDC = `D${r}`;

  const cityDed = ws.getRow(cityRow).getCell(4);
  cityDed.value = { formula: CDC } as ExcelJS.CellFormulaValue;
  asLink(cityDed, MONEY);
  noteCell(ws, `O${cityRow}`, 'Pulled from the City Deductions block below.');

  ws.views = [{ state: 'frozen', ySplit: 3 }];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `payout-${slug(city.cityName)}-${fileStamp(now)}.xlsx`
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
  const runExport = async (city: CitySales, kind: 'pdf' | 'xlsx' | 'payout') => {
    const tag = `${city.cityName}|${kind}`;
    if (busy) return;
    setBusy(tag);
    setExportError(null);
    try {
      if (kind === 'pdf') await exportCityPdf(city);
      else if (kind === 'payout') await exportCityPayout(city);
      else await exportCityXlsx(city);
    } catch (err) {
      setExportError(
        `Couldn't build the ${kind === 'payout' ? 'payout workbook' : kind.toUpperCase()} for ${city.cityName}: ` +
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
          const payBusy = busy === `${city.cityName}|payout`;
          return (
            <div key={city.cityName} className="relative">
              <button
                onClick={() => setSelected(city)}
                className="w-full bg-gray-800 rounded-xl border border-gray-700 p-5 pr-28 text-left hover:border-gray-600 transition-colors flex flex-col sm:flex-row sm:items-center gap-5"
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
                  <div className="text-[11px] mt-1">
                    <span className="text-gray-400">own {money(city.own)}</span>
                    <span className="text-gray-600"> / </span>
                    <span className="text-blue-300/80">import {money(city.external)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">tap for full breakdown</div>
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
                className="absolute top-3 right-[5.25rem] p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-rose-500 transition-colors disabled:opacity-40"
              >
                {pdfBusy ? <Loader size={15} className="animate-spin" /> : <FileText size={15} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); runExport(city, 'xlsx'); }}
                disabled={busy !== null}
                title={`Download Excel workbook for ${city.cityName}`}
                className="absolute top-3 right-12 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-emerald-500 transition-colors disabled:opacity-40"
              >
                {xlsBusy ? <Loader size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); runExport(city, 'payout'); }}
                disabled={busy !== null}
                title={`Download payout workbook for ${city.cityName}`}
                className="absolute top-3 right-3 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-amber-500 transition-colors disabled:opacity-40"
              >
                {payBusy ? <Loader size={15} className="animate-spin" /> : <Wallet size={15} />}
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
                <button
                  onClick={() => runExport(selected, 'payout')}
                  disabled={busy !== null}
                  title="Download payout workbook"
                  className="p-2 rounded-lg text-gray-400 border border-gray-700 hover:text-white hover:border-amber-500 transition-colors disabled:opacity-40"
                >
                  {busy === `${selected.cityName}|payout` ? <Loader size={16} className="animate-spin" /> : <Wallet size={16} />}
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
                  {/* OWN VS IMPORT */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Own vs import revenue</h4>
                    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                        <span />
                        <span className="text-right">Gross</span>
                        <span className="text-right">Payable</span>
                        <span className="text-right">Share</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-sm">
                        <span className="text-teal-300">Own workers</span>
                        <span className="text-right text-gray-300">{money(selected.grossOwn)}</span>
                        <span className="text-right text-gray-200 font-medium">{money(selected.own)}</span>
                        <span className="text-right text-gray-500 text-xs">{(selected.own / selected.total * 100).toFixed(1)}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-sm border-t border-gray-800">
                        <span className="text-blue-300">Imported</span>
                        <span className="text-right text-gray-300">{money(selected.grossExternal)}</span>
                        <span className="text-right text-gray-200 font-medium">{money(selected.external)}</span>
                        <span className="text-right text-gray-500 text-xs">{(selected.external / selected.total * 100).toFixed(1)}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-sm border-t-2 border-gray-700 bg-gray-950/40">
                        <span className="text-gray-300 font-semibold">Total</span>
                        <span className="text-right text-gray-200 font-semibold">{money(selected.gross)}</span>
                        <span className="text-right text-teal-300 font-bold">{money(selected.total)}</span>
                        <span className="text-right text-gray-500 text-xs">100%</span>
                      </div>
                    </div>
                  </div>

                  {/* CONTRIBUTORS */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Where it came from</h4>
                    <div className="space-y-1">
                      {selected.contributors.map((c) => (
                        <div key={c.fromCity} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-200">{c.fromCity}</span>
                          {c.isOwn
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-900/40 text-teal-300">own workers</span>
                            : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">import</span>}
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
                            <span className="text-blue-300">Import {money(rs.external)}</span>
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

                  {/* PER-DAY, PER-NICKNAME, OWN VS IMPORT */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">By day and nickname, own vs import</h4>
                    <div className="grid grid-cols-8 gap-1 px-2 pb-1 text-[9px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                      <span>Date</span>
                      <span>Source</span>
                      <span className="text-right">Own gross</span>
                      <span className="text-right">Imp gross</span>
                      <span className="text-right">Gross</span>
                      <span className="text-right">Own pay</span>
                      <span className="text-right">Imp pay</span>
                      <span className="text-right">Payable</span>
                    </div>
                    <div className="max-h-96 overflow-y-auto pr-1">
                      {selected.days.map((day) => (
                        <React.Fragment key={day.date}>
                          {day.segments.map((seg, i) => (
                            <div key={`${day.date}-${seg.key}`} className="grid grid-cols-8 gap-1 px-2 py-1 text-[10px] border-b border-gray-800/40">
                              <span className="text-gray-400">{i === 0 ? day.date : ''}</span>
                              <span className="flex items-center gap-1 min-w-0">
                                <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: colorFor(seg.key) }} />
                                <span className="truncate text-gray-300" title={rangeLabel(seg.nickname, seg.region, seg.season)}>
                                  {rangeLabel(seg.nickname, seg.region, seg.season)}
                                </span>
                              </span>
                              <span className="text-right text-gray-400">{money(seg.grossOwn)}</span>
                              <span className="text-right text-blue-300/80">{money(seg.grossExternal)}</span>
                              <span className="text-right text-gray-300">{money(seg.gross)}</span>
                              <span className="text-right text-gray-400">{money(seg.own)}</span>
                              <span className="text-right text-blue-300/80">{money(seg.external)}</span>
                              <span className="text-right text-teal-300 font-medium">{money(seg.amount)}</span>
                            </div>
                          ))}
                          {day.segments.length > 1 && (
                            <div className="grid grid-cols-8 gap-1 px-2 py-1 text-[10px] bg-gray-950/60 border-b border-gray-800 font-semibold">
                              <span />
                              <span className="text-gray-400">Day total</span>
                              <span className="text-right text-gray-300">{money(day.grossOwn)}</span>
                              <span className="text-right text-blue-300">{money(day.grossExternal)}</span>
                              <span className="text-right text-gray-200">{money(day.gross)}</span>
                              <span className="text-right text-gray-300">{money(day.own)}</span>
                              <span className="text-right text-blue-300">{money(day.external)}</span>
                              <span className="text-right text-teal-300">{money(day.total)}</span>
                            </div>
                          )}
                        </React.Fragment>
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