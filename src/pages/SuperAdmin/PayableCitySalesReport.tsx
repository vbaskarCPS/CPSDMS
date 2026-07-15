// src/pages/SuperAdmin/PayableCitySalesReport.tsx
import React, { useMemo, useState } from 'react';
import { X, MapPin, TrendingUp, AlertTriangle, Check, Tag, Download, Printer } from 'lucide-react';
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

// Build & download a CSV report for a single payable city, respecting what
// is currently shown for that city (its region/season + contributor breakdown).
const downloadCityReport = (city: CitySales) => {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows: (string | number)[][] = [];
  rows.push(['Payable City Report', city.cityName]);
  rows.push(['Configured', city.isConfigured ? 'Yes' : 'No (referenced in a split)']);
  rows.push(['Total payable', Math.round(city.total)]);
  rows.push(['Gross', Math.round(city.gross)]);
  rows.push([]);

  rows.push(['Where it came from']);
  rows.push(['Source city', 'Type', 'Amount', 'Share %']);
  city.contributors.forEach((c) => {
    rows.push([
      c.fromCity,
      c.isOwn ? 'Own workers' : 'From other city',
      Math.round(c.amount),
      city.total ? ((c.amount / city.total) * 100).toFixed(0) + '%' : '0%',
    ]);
  });
  rows.push([]);

  rows.push(['By region / season']);
  rows.push(['Region', 'Season', 'Own', 'External', 'Gross', 'After tax', 'Tax rate', 'Product rate', 'Payable']);
  city.regionSeason.forEach((rs) => {
    rows.push([
      rs.region,
      SEASON_LABELS[rs.season] || rs.season,
      Math.round(rs.own),
      Math.round(rs.external),
      Math.round(rs.gross),
      Math.round(rs.afterTax),
      rs.taxRate != null ? rs.taxRate + '%' : 'varies',
      rs.productRate != null ? rs.productRate + '%' : 'varies',
      Math.round(rs.amount),
    ]);
  });

  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payable-city-${city.cityName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const printCityReport = (city: CitySales) => {
  const fmtMoney = (n: number) =>
    '$' + Math.round(n).toLocaleString('en-CA');
  const share = (a: number) =>
    city.total > 0 ? ((a / city.total) * 100).toFixed(0) + '%' : '0%';
  const esc = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const contribRows = city.contributors
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .map(
      (c) => `
        <tr>
          <td class="lbl">${esc(c.fromCity)}</td>
          <td>${c.isOwn ? 'Own workers' : 'From other city'}</td>
          <td class="num">${fmtMoney(c.amount)}</td>
          <td class="num accent">${share(c.amount)}</td>
        </tr>`
    )
    .join('');

  const rsRows = city.regionSeason
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .map(
      (rs) => `
        <tr>
          <td class="lbl">${esc(rs.region)}</td>
          <td>${esc(SEASON_LABELS[rs.season] || rs.season)}</td>
          <td class="num">${fmtMoney(rs.own)}</td>
          <td class="num">${fmtMoney(rs.external)}</td>
          <td class="num">${fmtMoney(rs.gross)}</td>
          <td class="num">${fmtMoney(rs.afterTax)}</td>
          <td class="num">${rs.taxRate != null ? rs.taxRate + '%' : 'varies'}</td>
          <td class="num accent">${fmtMoney(rs.amount)}</td>
        </tr>`
    )
    .join('');

  const dayRows = city.days
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map(
      (d) => `
        <tr>
          <td class="lbl">${esc(d.date)}</td>
          <td class="num">${fmtMoney(d.total)}</td>
        </tr>`
    )
    .join('');

  const generated = new Date().toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Payable City Report – ${esc(city.cityName)}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Open Sans', 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #252525; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .head {
    background: #252525; color: #fff; padding: 22px 26px;
    border-radius: 12px; display: flex; align-items: center; justify-content: space-between;
  }
  .head img { height: 42px; }
  .head .meta { text-align: right; font-size: 11px; color: #b8b8b8; }
  .title { margin: 22px 0 4px; font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
  .title .accent { color: #ff4f4f; }
  .sub { color: #6b6b6b; font-size: 12px; margin-bottom: 18px; }
  .cfg { display:inline-block; margin-left:8px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:#fdecec; color:#c0392b; vertical-align:middle; }
  .kpis { display: flex; gap: 14px; margin-bottom: 26px; }
  .kpi { flex: 1; border: 1px solid #e6e6e6; border-radius: 10px; padding: 14px 16px; }
  .kpi .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8a8a8a; }
  .kpi .v { font-size: 26px; font-weight: 800; margin-top: 4px; }
  .kpi.payable { background: #fff5f5; border-color: #ffd0d0; }
  .kpi.payable .v { color: #ff4f4f; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #252525;
       border-left: 4px solid #ff4f4f; padding-left: 10px; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #f4f4f4; color: #555; font-size: 10px;
       text-transform: uppercase; letter-spacing: 0.5px; padding: 7px 9px; }
  th.num, td.num { text-align: right; }
  td { padding: 7px 9px; border-bottom: 1px solid #eee; }
  td.lbl { font-weight: 700; }
  td.accent { color: #ff4f4f; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e6e6e6;
          font-size: 10px; color: #9a9a9a; display: flex; justify-content: space-between; }
  .empty { color:#9a9a9a; font-size:12px; font-style:italic; padding:6px 0; }
</style></head>
<body>
  <div class="head">
    <img src="https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png" alt="Canadian Property Stars" />
    <div class="meta">Payable City Sales<br/>Generated ${esc(generated)}</div>
  </div>
  <div class="title">${esc(city.cityName)} <span class="accent">•</span> Payable Report${
    city.isConfigured ? '' : '<span class="cfg">Referenced in a split</span>'
  }</div>
  <div class="sub">Payable dollars attributed to this city and where they came from.</div>
  <div class="kpis">
    <div class="kpi payable"><div class="k">Total payable</div><div class="v">${fmtMoney(city.total)}</div></div>
    <div class="kpi"><div class="k">Gross behind it</div><div class="v">${fmtMoney(city.gross)}</div></div>
    <div class="kpi"><div class="k">Contributing sources</div><div class="v">${city.contributors.length}</div></div>
  </div>

  <h2>Where it came from</h2>
  ${contribRows ? `<table><thead><tr><th>Source city</th><th>Type</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${contribRows}</tbody></table>` : '<div class="empty">No contributing sources.</div>'}

  <h2>By region / season</h2>
  ${rsRows ? `<table><thead><tr><th>Region</th><th>Season</th><th class="num">Own</th><th class="num">External</th><th class="num">Gross</th><th class="num">After tax</th><th class="num">Tax</th><th class="num">Payable</th></tr></thead><tbody>${rsRows}</tbody></table>` : '<div class="empty">No region / season breakdown.</div>'}

  <h2>Daily totals</h2>
  ${dayRows ? `<table><thead><tr><th>Date</th><th class="num">Payable</th></tr></thead><tbody>${dayRows}</tbody></table>` : '<div class="empty">No daily data.</div>'}

  <div class="foot"><span>Canadian Property Stars — confidential payable report</span><span>${esc(city.cityName)}</span></div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
};

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

      {/* CITY CARDS */}
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Payable sales by city</h3>
      <div className="space-y-3">
        {result.cities.map((city) => {
          const rt = regionTotals(city);
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
                onClick={(e) => { e.stopPropagation(); printCityReport(city); }}
                title={`Print PDF report for ${city.cityName}`}
                className="absolute top-3 right-12 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-rose-500 transition-colors"
              >
                <Printer size={15} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); downloadCityReport(city); }}
                title={`Download report for ${city.cityName}`}
                className="absolute top-3 right-3 p-2 rounded-lg text-gray-400 bg-gray-900/60 border border-gray-700 hover:text-white hover:border-gray-500 transition-colors"
              >
                <Download size={15} />
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
                <span className="text-gray-600 text-xs">{card.startTab}Ã¢ÂÂ{card.endTab}</span>
                <span className="text-gray-600 text-xs">ÃÂ· {card.workbook}</span>
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
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <div className="flex items-baseline gap-2">
                  <TrendingUp size={18} className="text-teal-400" />
                  <span className="text-3xl font-bold text-teal-300">{money(selected.total)}</span>
                  <span className="text-sm text-gray-500">payable sales</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 pl-7">
                  Gross {money(selected.gross)} ÃÂ· deductions {money(selected.gross - selected.total)} ÃÂ· payable {money(selected.total)}
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

                  {/* PER-DAY STACKED CHART Ã¢ÂÂ split by nickname */}
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
