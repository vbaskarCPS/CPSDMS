// src/pages/SuperAdmin/PayableCitySalesReport.tsx
import React, { useMemo, useState } from 'react';
import { X, MapPin, TrendingUp, AlertTriangle, Check } from 'lucide-react';
import { LoadedWorkbook } from '../../lib/reportDataLoader';
import { PayableCity } from '../../lib/reportingService';
import { computePayableCitySales, CitySales } from '../../lib/payableCitySales';
import { SeasonType } from '../../types';

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

// Stable palette for workbook segments in the chart.
const PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];

const money = (n: number) => '$' + Math.round(n).toLocaleString();

const PayableCitySalesReport: React.FC<Props> = ({ workbooks, cities }) => {
  const result = useMemo(() => computePayableCitySales(workbooks, cities), [workbooks, cities]);
  const [selected, setSelected] = useState<CitySales | null>(null);

  // Stable workbook -> colour map so a workbook is the same colour across every city.
  const colorFor = useMemo(() => {
    const m = new Map<string, string>();
    result.workbookLabels.forEach((label, i) => m.set(label, PALETTE[i % PALETTE.length]));
    return (label: string) => m.get(label) || '#6b7280';
  }, [result.workbookLabels]);

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
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Payable sales by city</h3>

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

      {/* CITY CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {result.cities.map((city) => (
          <button
            key={city.cityName}
            onClick={() => setSelected(city)}
            className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-left hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <MapPin size={14} className="text-purple-400 flex-shrink-0" />
              <span className="font-bold text-white truncate">{city.cityName}</span>
              {!city.isConfigured && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 flex-shrink-0" title="Referenced in a split but not a configured city">unlisted</span>
              )}
            </div>
            <div className="text-2xl font-bold text-teal-300">{money(city.total)}</div>
            <div className="text-[11px] text-gray-500 mt-1">tap for breakdown</div>
          </button>
        ))}
      </div>

      {/* BREAKDOWN MODAL */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-purple-400" />
                <h2 className="text-lg font-bold text-white">{selected.cityName}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* TOTAL */}
              <div className="flex items-baseline gap-2">
                <TrendingUp size={18} className="text-teal-400" />
                <span className="text-3xl font-bold text-teal-300">{money(selected.total)}</span>
                <span className="text-sm text-gray-500">payable sales</span>
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

                  {/* REGION / SEASON */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">By region &amp; season</h4>
                    <div className="space-y-1">
                      {selected.regionSeason.map((rs) => (
                        <div key={`${rs.region}-${rs.season}`} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-200">{rs.region}</span>
                          <span className="text-gray-500 text-xs">{SEASON_LABELS[rs.season] || rs.season}</span>
                          <span className="ml-auto text-gray-400">{money(rs.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* PER-DAY STACKED CHART */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">By day, split by workbook</h4>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                      {Array.from(new Set(selected.days.flatMap((d) => d.byWorkbook.map((w) => w.label)))).map((label) => (
                        <span key={label} className="flex items-center gap-1 text-[11px] text-gray-400">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorFor(label) }} />
                          {label}
                        </span>
                      ))}
                    </div>

                    <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
                      {selected.days.map((day) => (
                        <div key={day.date} className="flex items-center gap-2">
                          <span className="w-12 text-[11px] text-gray-500 flex-shrink-0">{day.date}</span>
                          <div className="flex-1 h-5 rounded overflow-hidden flex bg-gray-900">
                            {day.byWorkbook.map((seg) => (
                              <div
                                key={seg.label}
                                style={{ width: `${day.total ? (seg.amount / day.total) * 100 : 0}%`, backgroundColor: colorFor(seg.label) }}
                                title={`${seg.label}: ${money(seg.amount)} (${day.total ? (seg.amount / day.total * 100).toFixed(0) : 0}%)`}
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
