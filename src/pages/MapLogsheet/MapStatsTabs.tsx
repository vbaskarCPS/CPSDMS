// src/pages/MapLogsheet/MapStatsTabs.tsx
//
// The Today / Pace / Coverage tabs. Shared by the worker's stats sheet
// (MapLogsheetPage) and the manager's cart panel (CartMapPanel) so both show
// the same figures the same way. Numbers come from lib/mapLogsheetStats.

import React from 'react';
import { format } from 'date-fns';
import { Clock, RotateCcw, MapPinned } from 'lucide-react';
import { HOUSE_COLORS, HouseView, routeHouseId } from '../../lib/mapLogsheetService';
import { KnockCounts, Pace, Coverage, CoverageStreet } from '../../lib/mapLogsheetStats';

export type StatsTab = 'today' | 'pace' | 'coverage';

interface MapStatsTabsProps {
  tab: StatsTab;
  onTab: (t: StatsTab) => void;
  counts: KnockCounts;
  avgCharge: { count: number; total: number; avg: number };
  pace: Pace | null;
  goBackQueue: HouseView[];
  coverage: Coverage;
  /** EQ for the Equiv tile; null hides it. */
  equiv: number | null;
  /** Small line under Today (upsells, steps). */
  footer?: React.ReactNode;
  /** Show the route code beside street names (more than one route). */
  showRouteCodes: boolean;
  onGoBackHouse: (v: HouseView) => void;
  onStreet: (st: CoverageStreet) => void;
  /** Anything to put at the right of the tab row (e.g. a close button). */
  headerRight?: React.ReactNode;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

const MapStatsTabs: React.FC<MapStatsTabsProps> = ({
  tab, onTab, counts, avgCharge, pace, goBackQueue, coverage, equiv, footer, showRouteCodes, onGoBackHouse, onStreet, headerRight,
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
        {([['today', 'Today'], ['pace', 'Pace'], ['coverage', 'Coverage']] as const).map(([k, label]) => (
          <button key={k} onClick={() => onTab(k)} className={`px-3 py-1.5 rounded-md text-xs font-bold ${tab === k ? 'bg-cps-blue text-white' : 'text-gray-400'}`}>{label}</button>
        ))}
      </div>
      {headerRight}
    </div>

    {tab === 'today' && (
      <>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Knocks', value: counts.knocks, color: '#e5e7eb' },
            { label: 'No', value: counts.no, color: HOUSE_COLORS.no },
            { label: 'Not home', value: counts.notHome, color: '#c4c8d0' },
            { label: 'Go back', value: counts.goBack, color: HOUSE_COLORS.go_back },
            { label: 'Invalid', value: counts.invalid, color: HOUSE_COLORS.invalid },
            { label: 'Pending', value: counts.pending, color: '#facc15' },
            { label: 'Done', value: counts.completed, color: '#4ade80' },
            { label: 'Answered', value: counts.answered, color: '#93c5fd' },
            ...(equiv != null ? [{ label: 'Equiv', value: equiv.toFixed(1), color: '#ffffff' }] : []),
          ].map(t => (
            <div key={t.label} className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">{t.label}</span>
              <span className="text-lg font-bold" style={{ color: t.color }}>{t.value}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-800 rounded-lg py-2 px-2">
            <div className="text-[9px] uppercase font-bold text-gray-500">Answer rate</div>
            <div className="text-2xl font-bold text-blue-300">{pct(counts.answerRate)}</div>
            <div className="text-[10px] text-gray-500">{counts.answered} ÷ {counts.knocks} knocks</div>
          </div>
          <div className="bg-gray-800 rounded-lg py-2 px-2">
            <div className="text-[9px] uppercase font-bold text-gray-500">Closing rate</div>
            <div className="text-2xl font-bold text-green-300">{pct(counts.closingRate)}</div>
            <div className="text-[10px] text-gray-500">{counts.sales} ÷ {counts.answered} answered</div>
          </div>
          <div className="bg-gray-800 rounded-lg py-2 px-2">
            <div className="text-[9px] uppercase font-bold text-gray-500">Avg charge</div>
            <div className="text-2xl font-bold text-yellow-300">{avgCharge.count ? `$${Math.round(avgCharge.avg)}` : '—'}</div>
            <div className="text-[10px] text-gray-500">${Math.round(avgCharge.total)} ÷ {avgCharge.count} done</div>
          </div>
        </div>
        {footer && <div className="text-[10px] text-gray-500 flex flex-wrap gap-x-3">{footer}</div>}
      </>
    )}

    {tab === 'pace' && (
      !pace ? (
        <div className="text-sm text-gray-500 py-6 text-center">No knocks yet today.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">Doors / hr</span>
              <span className="text-2xl font-bold text-white">{pace.doorsPerHour.toFixed(1)}</span>
              <span className="text-[10px] text-gray-500">{pace.n} ÷ {pace.spanHrs.toFixed(1)} h</span>
            </div>
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">First knock</span>
              <span className="text-lg font-bold text-white">{format(pace.first, 'h:mm a')}</span>
            </div>
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">Last knock</span>
              <span className="text-lg font-bold text-white">{format(pace.last, 'h:mm a')}</span>
            </div>
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">Longest gap</span>
              <span className="text-lg font-bold text-orange-300">{Math.round(pace.longestGapMs / 60000)} min</span>
              <span className="text-[10px] text-gray-500">after {format(pace.gapAt, 'h:mm a')}</span>
            </div>
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">To 1st sale</span>
              <span className="text-lg font-bold text-green-300">{pace.minsToFirstSale == null ? '—' : `${Math.round(pace.minsToFirstSale)} min`}</span>
            </div>
            <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-gray-500">Between sales</span>
              <span className="text-lg font-bold text-green-300">{pace.avgMinsBetweenSales == null ? '—' : `${Math.round(pace.avgMinsBetweenSales)} min`}</span>
            </div>
          </div>

          {/* Knocks by hour */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><Clock size={10} /> Knocks by hour <span className="text-green-400 normal-case font-normal">· green = sales</span></div>
            {(() => {
              const max = Math.max(1, ...pace.hours.map(h => h.knocks));
              return (
                <div className="flex items-end gap-1 h-20">
                  {pace.hours.map(h => (
                    <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[9px] text-gray-400 mb-0.5">{h.knocks || ''}</span>
                      <div className="w-full rounded-t bg-gray-600 relative" style={{ height: `${(h.knocks / max) * 100}%`, minHeight: h.knocks ? 3 : 0 }}>
                        {h.sales > 0 && <div className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-t" style={{ height: `${(h.sales / Math.max(h.knocks, 1)) * 100}%` }} />}
                      </div>
                      <span className="text-[9px] text-gray-500 mt-1">{format(new Date().setHours(h.hour, 0, 0, 0), 'ha').toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Go back queue */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><RotateCcw size={10} /> Go back queue ({goBackQueue.length})</div>
            {goBackQueue.length === 0 ? (
              <div className="text-xs text-gray-500">Nothing to go back to.</div>
            ) : (
              <div className="space-y-1">
                {goBackQueue.map(v => (
                  <button
                    key={routeHouseId(v.house.routeCode, v.house.houseKey)}
                    onClick={() => onGoBackHouse(v)}
                    className="w-full text-left flex items-center gap-2 py-1.5 border-b border-gray-700/60 last:border-0"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: HOUSE_COLORS.go_back }} />
                    <span className="text-sm text-white font-bold shrink-0">{v.house.civicNo}{(v.house.civicSuffix || '').toUpperCase()} {v.house.streetName}</span>
                    <span className="text-xs text-gray-400 truncate">{v.disposition?.note || ''}</span>
                    <span className="ml-auto text-[10px] text-gray-500 shrink-0">{format(new Date(v.disposition!.updatedAt), 'h:mm a')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )
    )}

    {tab === 'coverage' && (
      <>
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
            <span className="text-[9px] uppercase font-bold text-gray-500">Knocked</span>
            <span className="text-2xl font-bold text-white">{pct(coverage.pctKnocked)}</span>
            <span className="text-[10px] text-gray-500">{coverage.knocked} of {coverage.total}</span>
          </div>
          <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
            <span className="text-[9px] uppercase font-bold text-gray-500">Untouched</span>
            <span className="text-2xl font-bold text-gray-300">{coverage.untouched}</span>
          </div>
          <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
            <span className="text-[9px] uppercase font-bold text-gray-500">Skipped</span>
            <span className="text-2xl font-bold text-orange-300">{coverage.skipped}</span>
            <span className="text-[10px] text-gray-500">between knocks</span>
          </div>
          <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
            <span className="text-[9px] uppercase font-bold text-gray-500">Streets</span>
            <span className="text-2xl font-bold text-white">{coverage.streets.length}</span>
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><MapPinned size={10} /> By street <span className="normal-case font-normal">· most left to do first · tap to go there</span></div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[9px] uppercase font-bold text-gray-500 pb-1 border-b border-gray-700">
            <span>Street</span><span>Knocked</span><span>Sales</span><span>Skip</span>
          </div>
          {coverage.streets.map(st => (
            <button
              key={st.key}
              onClick={() => onStreet(st)}
              className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-left py-1.5 border-b border-gray-700/60 last:border-0"
            >
              <span className="text-sm text-white truncate">{st.name} <span className="text-[10px] text-gray-500 font-mono">{showRouteCodes ? st.routeCode : ''}</span></span>
              <span className={`text-sm font-mono ${st.knocked === st.total ? 'text-green-300' : 'text-gray-200'}`}>{st.knocked}/{st.total}</span>
              <span className="text-sm font-mono text-green-300">{st.sales || ''}</span>
              <span className="text-sm font-mono text-orange-300">{st.skipped || ''}</span>
            </button>
          ))}
        </div>
      </>
    )}
  </div>
);

export default MapStatsTabs;
