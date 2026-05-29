// src/pages/Admin/PayslipGenerator.tsx
import React, { useState, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, Download,
  Loader, AlertCircle, Plus, Trash2, CheckCircle,
  Users, FileSpreadsheet, RotateCcw,
} from 'lucide-react';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { commandCenterService } from '../../lib/commandCenterService';
import {
  generatePayslipsPDF,
  parsePayoutStatsRows,
  WorkerPayslipUI,
  PayslipDayRow,
  ExtraItem,
  HiddenFields,
} from '../../lib/payslipExport';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkerSettings {
  is120Program: boolean;
  hotels: number;
  advances: number;
  travelPkg: number;
  extraDeductions: ExtraItem[];
  additions: ExtraItem[];
  batchId: string;   // empty string = unassigned
}

interface Batch {
  id: string;
  name: string;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function sortKey(s: string): number {
  const months: Record<string, number> = {
    Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
    Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
  };
  return (months[s.slice(0, 3)] || 0) * 100 + parseInt(s.slice(3), 10);
}

function mmmdd(month: number, day: number): string {
  return `${MONTH_ABBR[month]}${String(day).padStart(2, '0')}`;
}

function calendarDays(start: string, end: string): number {
  const year = new Date().getFullYear();
  const sm = MONTH_ABBR.indexOf(start.slice(0, 3));
  const em = MONTH_ABBR.indexOf(end.slice(0, 3));
  const a = new Date(year, sm, parseInt(start.slice(3), 10));
  const b = new Date(year, em, parseInt(end.slice(3), 10));
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

// Compact hint for the payslip layout tier, matching payslipExport.chooseLayout:
//   ≤7 → 8-row / 3 per page · 8–16 → 16-row / 2 per page ·
//   17–21 → N-row / 2 per page (Legal) · 22+ → N-row / 1 per page
function tierHint(days: number): string {
  if (days <= 7)  return '8-row / 3 per page';
  if (days <= 16) return '16-row / 2 per page';
  if (days <= 21) return `${days}-row / 2 per page · Legal`;
  return `${days}-row / 1 per page`;
}

function defaultSettings(): WorkerSettings {
  return { is120Program: false, hotels: 0, advances: 0, travelPkg: 0, extraDeductions: [], additions: [], batchId: '' };
}

function makeBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function r2(v: number): number { return Math.round(v * 100) / 100; }

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { onBack: () => void; }

const PayslipGenerator: React.FC<Props> = ({ onBack }) => {
  const cc = commandCenterService.getCurrentCommandCenter();

  const [step, setStep] = useState<'setup' | 'workers'>('setup');
  const [isGoogleConnected, setIsGoogleConnected] = useState(() => googleSheetsService.isAuthenticated());
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [allRows, setAllRows] = useState<any[][]>([]);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Calendar
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  // Workers
  const [workerList, setWorkerList] = useState<WorkerPayslipUI[]>([]);
  const [workerSettings, setWorkerSettings] = useState<Map<string, WorkerSettings>>(new Map());
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // Original (sheet-loaded) day snapshots, for rate-edit highlighting + reset.
  // Keyed by contractorId. Captured at load; never mutated.
  const [originalDays, setOriginalDays] = useState<Map<string, PayslipDayRow[]>>(new Map());
  // "Set all rates" input value (string while typing; applied on the button).
  const [bulkRate, setBulkRate] = useState<string>('');

  // Global defaults
  const [stdHotels, setStdHotels] = useState<number>(0);
  const [stdAdvances, setStdAdvances] = useState<number>(0);

  // Hidden field toggles
  const [hiddenFields, setHiddenFields] = useState<HiddenFields>({
    hotels: false,
    advances: false,
    travelPkg: false,
  });

  // Batches — start with 2
  const [batches, setBatches] = useState<Batch[]>([
    { id: makeBatchId(), name: 'Batch 1' },
    { id: makeBatchId(), name: 'Batch 2' },
  ]);

  useEffect(() => {
    if (isGoogleConnected && allRows.length === 0) loadPayoutStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoogleConnected]);

  // ─── Auto-assign when only 1 batch ──────────────────────────────────────

  useEffect(() => {
    if (batches.length === 1) {
      const batchId = batches[0].id;
      setWorkerSettings(prev => {
        const next = new Map(prev);
        next.forEach((s, wid) => {
          if (s.batchId !== batchId) {
            next.set(wid, { ...s, batchId });
          }
        });
        return next;
      });
    }
  }, [batches, workerList]);

  // ─── When a field is hidden, zero it out for all workers ────────────────

  useEffect(() => {
    setWorkerSettings(prev => {
      const next = new Map(prev);
      next.forEach((s, id) => {
        const updated = { ...s };
        if (hiddenFields.hotels)    updated.hotels = 0;
        if (hiddenFields.advances)  updated.advances = 0;
        if (hiddenFields.travelPkg) updated.travelPkg = 0;
        next.set(id, updated);
      });
      return next;
    });
  }, [hiddenFields]);

  // ─── Batch helpers ────────────────────────────────────────────────────────

  const addBatch = () => {
    setBatches(prev => [...prev, { id: makeBatchId(), name: `Batch ${prev.length + 1}` }]);
  };

  const removeBatch = (id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id));
    // Unassign any worker that was in this batch
    setWorkerSettings(prev => {
      const next = new Map(prev);
      next.forEach((s, wid) => {
        if (s.batchId === id) next.set(wid, { ...s, batchId: '' });
      });
      return next;
    });
  };

  const renameBatch = (id: string, name: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, name } : b));
  };

  // Workers with no batchId assigned
  const unassignedCount = workerList.filter(w => !(workerSettings.get(w.contractorId)?.batchId)).length;
  const canExport = unassignedCount === 0 && workerList.length > 0;

  // ─── Google / data loading ────────────────────────────────────────────────

  const handleConnectGoogle = async () => {
    setSheetsLoading(true);
    setError(null);
    try {
      const ok = await googleSheetsService.authenticate();
      setIsGoogleConnected(ok);
      if (!ok) setError('Failed to connect to Google.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.');
    } finally { setSheetsLoading(false); }
  };

  const loadPayoutStats = async () => {
    setStatsLoading(true);
    setError(null);
    try {
      const rows = await googleSheetsService.readWorkerbookRange("'Payout Stats'!A:AH");
      setAllRows(rows);
      const dates = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const v = rows[i]?.[0];
        if (v) {
          const d = String(v).trim();
          if (/^[A-Z][a-z]{2}\d{2}$/.test(d)) dates.add(d);
        }
      }
      setAvailableDates(dates);
      if (dates.size > 0) {
        const sorted = Array.from(dates).sort((a, b) => sortKey(a) - sortKey(b));
        const m = MONTH_ABBR.indexOf(sorted[0].slice(0, 3));
        if (m >= 0) setViewMonth(m);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Payout Stats.');
    } finally { setStatsLoading(false); }
  };

  const handleDateClick = (d: string) => {
    if (!availableDates.has(d)) return;
    if (!startDate || (startDate && endDate)) {
      setStartDate(d); setEndDate(null);
    } else {
      const dk = sortKey(d);
      const sk = sortKey(startDate);
      if (dk < sk) { setEndDate(startDate); setStartDate(d); }
      else { setEndDate(d); }
    }
  };

  const handleLoadWorkers = () => {
    if (!startDate || !endDate) return;
    const workers = parsePayoutStatsRows(allRows, startDate, endDate);
    workers.sort((a, b) => {
      const last = a.lastName.localeCompare(b.lastName);
      return last !== 0 ? last : a.firstName.localeCompare(b.firstName);
    });
    setWorkerList(workers);
    // Snapshot originals (deep copy of days) for rate-edit reset + highlight.
    setOriginalDays(new Map(workers.map(w => [w.contractorId, w.days.map(d => ({ ...d }))])));
    setBulkRate('');
    const s = new Map<string, WorkerSettings>();
    // If only 1 batch, auto-assign
    const autoBatchId = batches.length === 1 ? batches[0].id : '';
    workers.forEach(w => s.set(w.contractorId, {
      ...defaultSettings(),
      hotels: hiddenFields.hotels ? 0 : stdHotels,
      advances: hiddenFields.advances ? 0 : stdAdvances,
      batchId: autoBatchId,
    }));
    setWorkerSettings(s);
    setStep('workers');
  };

  // ─── Rate editing ───────────────────────────────────────────────────────────
  // Commission = EQ × Rate. A day's Total contains its AER Comm as the commission
  // piece, so editing the rate recomputes Comm (EQ × newRate) and shifts Total by
  // the difference (Total − oldComm + newComm), leaving bonus / mach / labor cost
  // untouched. Everything is in-memory and print-only — no write-back to the Sheet.

  const recalcDayForRate = (d: PayslipDayRow, rate: number): PayslipDayRow => {
    const newComm = r2(d.equiv * rate);
    const newTotal = r2(d.totalPayout - d.aerComm + newComm);
    return { ...d, payoutRate: rate, aerComm: newComm, totalPayout: newTotal };
  };

  const updateDayRate = (id: string, dayIndex: number, value: string) => {
    const parsed = parseFloat(value);
    const rate = isNaN(parsed) ? 0 : parsed;
    setWorkerList(prev => prev.map(worker => {
      if (worker.contractorId !== id) return worker;
      return {
        ...worker,
        days: worker.days.map((d, idx) => idx === dayIndex ? recalcDayForRate(d, rate) : d),
      };
    }));
  };

  const resetDayRate = (id: string, dayIndex: number) => {
    const orig = originalDays.get(id)?.[dayIndex];
    if (!orig) return;
    setWorkerList(prev => prev.map(worker => {
      if (worker.contractorId !== id) return worker;
      return {
        ...worker,
        days: worker.days.map((d, idx) => idx === dayIndex ? { ...orig } : d),
      };
    }));
  };

  // Stamp one rate onto every day of every worker — overwrites all individual edits.
  const applyRateToAll = () => {
    const parsed = parseFloat(bulkRate);
    if (isNaN(parsed)) return;
    setWorkerList(prev => prev.map(worker => ({
      ...worker,
      days: worker.days.map(d => recalcDayForRate(d, parsed)),
    })));
  };

  // ─── Worker settings helpers ──────────────────────────────────────────────

  const updateSetting = <K extends keyof WorkerSettings>(id: string, field: K, value: WorkerSettings[K]) => {
    setWorkerSettings(prev => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) || defaultSettings()), [field]: value });
      return next;
    });
  };

  const addItem = (id: string, type: 'extraDeductions' | 'additions') => {
    setWorkerSettings(prev => {
      const next = new Map(prev);
      const cur = next.get(id) || defaultSettings();
      next.set(id, { ...cur, [type]: [...cur[type], { id: `${Date.now()}`, label: '', amount: 0 }] });
      return next;
    });
  };

  const updateItem = (id: string, type: 'extraDeductions' | 'additions', itemId: string, field: 'label' | 'amount', value: string | number) => {
    setWorkerSettings(prev => {
      const next = new Map(prev);
      const cur = next.get(id) || defaultSettings();
      next.set(id, { ...cur, [type]: cur[type].map(x => x.id === itemId ? { ...x, [field]: value } : x) });
      return next;
    });
  };

  const removeItem = (id: string, type: 'extraDeductions' | 'additions', itemId: string) => {
    setWorkerSettings(prev => {
      const next = new Map(prev);
      const cur = next.get(id) || defaultSettings();
      next.set(id, { ...cur, [type]: cur[type].filter(x => x.id !== itemId) });
      return next;
    });
  };

  // ─── Toggle a hidden field ────────────────────────────────────────────────

  const toggleField = (field: keyof HiddenFields) => {
    setHiddenFields(prev => ({ ...prev, [field]: !prev[field] }));
  };

  // ─── Export ───────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!startDate || !endDate || !cc || !canExport) return;
    setIsExporting(true);
    setError(null);
    try {
      const daysInRange = calendarDays(startDate, endDate);

      // Fire one PDF download per batch
      for (const batch of batches) {
        const batchWorkers = workerList
          .filter(w => workerSettings.get(w.contractorId)?.batchId === batch.id)
          .map(w => ({ ...w, ...(workerSettings.get(w.contractorId) || defaultSettings()) }));

        if (batchWorkers.length === 0) continue;

        await generatePayslipsPDF(
          batchWorkers,
          startDate,
          endDate,
          cc.displayName,
          daysInRange,
          hiddenFields,
          batch.name,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally { setIsExporting(false); }
  };

  // ─── Calendar ────────────────────────────────────────────────────────────

  const renderCalendar = () => {
    const year = new Date().getFullYear();
    const daysInMonth = new Date(year, viewMonth + 1, 0).getDate();
    const firstDow = new Date(year, viewMonth, 1).getDay();
    const sk = startDate ? sortKey(startDate) : null;
    const ek = endDate ? sortKey(endDate) : null;

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} />);

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = mmmdd(viewMonth, day);
      const has = availableDates.has(ds);
      const dk = sortKey(ds);
      const isStart = startDate === ds;
      const isEnd = endDate === ds;
      const inRange = sk !== null && ek !== null && dk >= sk && dk <= ek;

      let cls = 'flex items-center justify-center h-8 w-8 text-sm select-none transition-colors rounded ';
      if (!has) cls += 'text-gray-600 cursor-default';
      else if (isStart || isEnd) cls += 'bg-green-600 text-white font-bold cursor-pointer rounded-full';
      else if (inRange) cls += 'bg-green-900/40 text-green-300 cursor-pointer';
      else cls += 'text-white hover:bg-gray-700 cursor-pointer';

      cells.push(
        <div key={day} onClick={() => has && handleDateClick(ds)} className={cls}>{day}</div>
      );
    }

    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 w-full max-w-sm mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setViewMonth(m => m === 0 ? 11 : m - 1)} className="p-1.5 hover:bg-gray-700 rounded transition-colors">
            <ChevronLeft size={18} className="text-gray-400" />
          </button>
          <span className="font-bold text-white text-sm">{MONTH_NAMES[viewMonth]} {year}</span>
          <button onClick={() => setViewMonth(m => m === 11 ? 0 : m + 1)} className="p-1.5 hover:bg-gray-700 rounded transition-colors">
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} className="text-center text-xs text-gray-500 font-medium">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">{cells}</div>
        <div className="mt-3 flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600 inline-block" />Has data</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-gray-600 inline-block" />No data</span>
        </div>
        <div className="mt-3 p-2.5 bg-gray-900/60 rounded-lg min-h-[36px] text-center text-xs">
          {startDate && endDate ? (
            <span className="text-green-400 font-medium">
              {startDate} → {endDate}
              <span className="text-gray-400 ml-2">
                ({calendarDays(startDate, endDate)} days · {tierHint(calendarDays(startDate, endDate))})
              </span>
            </span>
          ) : startDate ? (
            <span className="text-yellow-400">Click end date to complete range</span>
          ) : (
            <span className="text-gray-500">Click a date to start selection</span>
          )}
        </div>
      </div>
    );
  };

  // ─── Worker row ───────────────────────────────────────────────────────────

  const calcFinalPay = (w: WorkerPayslipUI, s: WorkerSettings): number => {
    const earnedComm = w.days.reduce((sum, d) => sum + d.totalPayout, 0);
    const daysWorked = w.days.length;
    const gi = s.is120Program ? Math.max(earnedComm, daysWorked * 120) : earnedComm;
    const hotelsVal = hiddenFields.hotels ? 0 : s.hotels;
    const advancesVal = hiddenFields.advances ? 0 : s.advances;
    const travelVal = hiddenFields.travelPkg ? 0 : s.travelPkg;
    const totalDeductions = hotelsVal + advancesVal + travelVal +
      s.extraDeductions.reduce((sum, d) => sum + d.amount, 0);
    const totalAdditions = s.additions.reduce((sum, a) => sum + a.amount, 0);
    return Math.round((gi - totalDeductions + totalAdditions) * 100) / 100;
  };

  const toggleExpanded = (id: string) => {
    setExpandedWorkers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderWorker = (w: WorkerPayslipUI) => {
    const s = workerSettings.get(w.contractorId) || defaultSettings();
    const isExpanded = expandedWorkers.has(w.contractorId);
    const finalPay = calcFinalPay(w, s);
    const totalEquiv = w.days.reduce((sum, d) => sum + d.equiv, 0);
    const isUnassigned = !s.batchId;
    const origDaysForWorker = originalDays.get(w.contractorId);
    const iCls = "bg-gray-900 border border-gray-600 rounded py-0.5 pl-4 pr-1 text-xs text-white w-16 focus:ring-1 focus:ring-blue-500 focus:outline-none";
    const $ = "absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none";

    return (
      <div key={w.contractorId} className={`rounded-lg border overflow-hidden ${isUnassigned ? 'bg-gray-800 border-red-700/60' : 'bg-gray-800 border-gray-700'}`}>

        {/* LINE 1: Name + days + EQ + final pay */}
        <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
          onClick={() => toggleExpanded(w.contractorId)}>
          <ChevronDown size={13} className={`text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          <span className="font-bold text-white text-xs">{w.contractorId} — {w.firstName} {w.lastName}</span>
          <span className="text-xs text-gray-500 bg-gray-700/60 px-1.5 rounded flex-shrink-0">{w.days.length}d</span>
          {s.is120Program && <span className="text-xs text-green-400 bg-green-900/20 border border-green-700/40 px-1.5 rounded flex-shrink-0">$120</span>}
          <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{totalEquiv.toFixed(2)}EQ</span>
          <span className={`font-bold text-sm flex-shrink-0 ${finalPay >= 0 ? 'text-green-400' : 'text-red-400'}`}>${finalPay.toFixed(2)}</span>
        </div>

        {/* LINE 2: All inputs + batch dropdown */}
        <div className="flex items-center gap-2 px-3 pb-1.5 flex-wrap">
          {/* $120 checkbox */}
          <label className="flex items-center gap-1 cursor-pointer select-none flex-shrink-0">
            <input type="checkbox" checked={s.is120Program}
              onChange={e => updateSetting(w.contractorId, 'is120Program', e.target.checked)}
              className="w-3 h-3 accent-green-500" />
            <span className={`text-xs ${s.is120Program ? 'text-green-400' : 'text-gray-500'}`}>$120</span>
          </label>
          <span className="text-gray-700 text-xs">|</span>

          {/* Hotels — only shown if not hidden */}
          {!hiddenFields.hotels && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-xs text-gray-500">Hotels</span>
              <div className="relative"><span className={$}>$</span><input type="number" min="0" placeholder="0" value={s.hotels||''} onChange={e=>updateSetting(w.contractorId,'hotels',parseFloat(e.target.value)||0)} className={iCls}/></div>
            </div>
          )}
          {/* Advances — only shown if not hidden */}
          {!hiddenFields.advances && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-xs text-gray-500">Adv</span>
              <div className="relative"><span className={$}>$</span><input type="number" min="0" placeholder="0" value={s.advances||''} onChange={e=>updateSetting(w.contractorId,'advances',parseFloat(e.target.value)||0)} className={iCls}/></div>
            </div>
          )}
          {/* Travel — only shown if not hidden */}
          {!hiddenFields.travelPkg && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-xs text-gray-500">Travel</span>
              <div className="relative"><span className={$}>$</span><input type="number" min="0" placeholder="0" value={s.travelPkg||''} onChange={e=>updateSetting(w.contractorId,'travelPkg',parseFloat(e.target.value)||0)} className={iCls}/></div>
            </div>
          )}

          {/* Batch dropdown */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-xs text-gray-500">Batch</span>
            <select
              value={s.batchId}
              onChange={e => updateSetting(w.contractorId, 'batchId', e.target.value)}
              className={`bg-gray-900 border rounded py-0.5 px-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none ${
                isUnassigned ? 'border-red-600 text-red-400' : 'border-gray-600 text-white'
              }`}
            >
              <option value="">— Assign —</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Extra deductions inline */}
          {s.extraDeductions.map(item => (
            <div key={item.id} className="flex items-center gap-1 flex-shrink-0">
              <input type="text" placeholder="Label" value={item.label} onChange={e=>updateItem(w.contractorId,'extraDeductions',item.id,'label',e.target.value)}
                className="w-16 bg-gray-900 border border-red-900/50 rounded py-0.5 px-1.5 text-xs text-white focus:ring-1 focus:ring-red-500 focus:outline-none"/>
              <div className="relative"><span className={$}>$</span><input type="number" min="0" placeholder="0" value={item.amount||''} onChange={e=>updateItem(w.contractorId,'extraDeductions',item.id,'amount',parseFloat(e.target.value)||0)} className={iCls}/></div>
              <button onClick={()=>removeItem(w.contractorId,'extraDeductions',item.id)} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={11}/></button>
            </div>
          ))}
          {/* Additions inline */}
          {s.additions.map(item => (
            <div key={item.id} className="flex items-center gap-1 flex-shrink-0">
              <input type="text" placeholder="Label" value={item.label} onChange={e=>updateItem(w.contractorId,'additions',item.id,'label',e.target.value)}
                className="w-16 bg-gray-900 border border-green-900/50 rounded py-0.5 px-1.5 text-xs text-white focus:ring-1 focus:ring-green-500 focus:outline-none"/>
              <div className="relative"><span className={$}>$</span><input type="number" min="0" placeholder="0" value={item.amount||''} onChange={e=>updateItem(w.contractorId,'additions',item.id,'amount',parseFloat(e.target.value)||0)} className={iCls}/></div>
              <button onClick={()=>removeItem(w.contractorId,'additions',item.id)} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={11}/></button>
            </div>
          ))}
          <button onClick={()=>addItem(w.contractorId,'extraDeductions')} className="flex items-center gap-0.5 text-xs text-red-400 hover:text-red-300 flex-shrink-0 ml-auto"><Plus size={11}/>Ded</button>
          <button onClick={()=>addItem(w.contractorId,'additions')} className="flex items-center gap-0.5 text-xs text-green-400 hover:text-green-300 flex-shrink-0"><Plus size={11}/>Add</button>
        </div>

        {/* Expanded: daily breakdown table */}
        {isExpanded && (
          <div className="border-t border-gray-700 px-3 pt-2 pb-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1 pr-3 font-medium">Date</th>
                    <th className="text-left py-1 pr-3 font-medium">Manager</th>
                    <th className="text-right py-1 pr-3 font-medium">Steps</th>
                    <th className="text-right py-1 pr-3 font-medium">EQ</th>
                    <th className="text-right py-1 pr-3 font-medium">Prepay</th>
                    <th className="text-right py-1 pr-3 font-medium">Rate</th>
                    <th className="text-right py-1 pr-3 font-medium">Comm</th>
                    <th className="text-right py-1 pr-3 font-medium">Mach</th>
                    <th className="text-right py-1 pr-3 font-medium">Labor Cost</th>
                    <th className="text-right py-1 font-medium">Bonus</th>
                    <th className="text-right py-1 pl-3 font-medium text-white">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {w.days.map((d, i) => {
                    const origRate = origDaysForWorker?.[i]?.payoutRate;
                    const rateEdited = origRate !== undefined && r2(origRate) !== r2(d.payoutRate);
                    return (
                      <tr key={i} className="border-b border-gray-700/50 last:border-0">
                        <td className="py-1 pr-3">{d.date}</td>
                        <td className="py-1 pr-3">{d.manager}</td>
                        <td className="py-1 pr-3 text-right">{d.steps}</td>
                        <td className="py-1 pr-3 text-right">{d.equiv.toFixed(2)}</td>
                        <td className="py-1 pr-3 text-right">{d.totalPrepay ? `$${d.totalPrepay.toFixed(2)}` : '—'}</td>
                        <td className="py-1 pr-3 text-right">
                          <div className="inline-flex items-center gap-1 justify-end">
                            {rateEdited && (
                              <button onClick={() => resetDayRate(w.contractorId, i)} title="Reset to loaded rate"
                                className="text-gray-500 hover:text-blue-400 flex-shrink-0"><RotateCcw size={10}/></button>
                            )}
                            <span className="text-gray-500">$</span>
                            <input type="number" min="0" step="0.01" value={d.payoutRate}
                              onChange={e => updateDayRate(w.contractorId, i, e.target.value)}
                              className={`w-14 bg-gray-900 border rounded py-0.5 px-1 text-xs text-right focus:ring-1 focus:ring-blue-500 focus:outline-none ${
                                rateEdited ? 'border-blue-500 text-blue-300' : 'border-gray-600 text-white'
                              }`}/>
                          </div>
                        </td>
                        <td className="py-1 pr-3 text-right">${d.aerComm.toFixed(2)}</td>
                        <td className="py-1 pr-3 text-right">{d.machRent ? `$${d.machRent}` : '—'}</td>
                        <td className="py-1 pr-3 text-right">{d.deductions ? `$${d.deductions}` : '—'}</td>
                        <td className="py-1 text-right">{d.dailyBonus ? `$${d.dailyBonus}` : '—'}</td>
                        <td className="py-1 pl-3 text-right font-bold text-white">${d.totalPayout.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={step === 'workers' ? () => setStep('setup') : onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
          <ArrowLeft size={16} />
          {step === 'workers' ? 'Back to Calendar' : 'Back to Session'}
        </button>
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-green-400" />
          <span className="font-bold text-white">Generate Payslips</span>
          {startDate && endDate && (
            <span className="text-xs bg-green-900/30 text-green-400 border border-green-700/50 px-2 py-0.5 rounded ml-1">
              {startDate} → {endDate}
            </span>
          )}
        </div>
        {step === 'workers' ? (
          <button
            onClick={handleExport}
            disabled={isExporting || !canExport}
            title={!canExport ? `${unassignedCount} worker(s) not yet assigned to a batch` : ''}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
            {isExporting ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
            Export PDF
          </button>
        ) : <div className="w-28" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />{error}
        </div>
      )}

      {/* ── STEP 1: SETUP ── */}
      {step === 'setup' && (
        <div className="space-y-6">
          {!isGoogleConnected ? (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-sm mx-auto text-center">
              <p className="text-gray-400 text-sm mb-4">Connect to Google Sheets to load Payout Stats data.</p>
              <button onClick={handleConnectGoogle} disabled={sheetsLoading}
                className="w-full bg-white hover:bg-gray-100 text-gray-800 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50">
                {sheetsLoading ? <Loader className="animate-spin" size={20} /> : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Connect to Google
                  </>
                )}
              </button>
            </div>
          ) : statsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
              <Loader className="animate-spin" size={28} />
              <span className="text-sm">Loading Payout Stats…</span>
            </div>
          ) : availableDates.size === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
              <AlertCircle size={28} className="opacity-40" />
              <span className="text-sm">No data found in Payout Stats.</span>
              <button onClick={loadPayoutStats} className="text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-green-400 text-xs">
                <CheckCircle size={14} />
                <span>Connected · {availableDates.size} dates loaded from Payout Stats</span>
              </div>
              {renderCalendar()}
              <div className="flex justify-center">
                <button onClick={handleLoadWorkers} disabled={!startDate || !endDate}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors">
                  <Users size={18} /> Load Workers
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 2: WORKERS ── */}
      {step === 'workers' && (
        <div className="space-y-2">

          {/* Summary bar */}
          <div className="flex items-center justify-between bg-gray-800 rounded-lg border border-gray-700 px-4 py-2.5">
            <span className="text-sm text-gray-400">
              <span className="text-white font-bold">{workerList.length}</span> workers ·{' '}
              {startDate && endDate && tierHint(calendarDays(startDate, endDate))}
            </span>
            <span className="text-xs text-gray-500 truncate ml-4">
              {cc?.displayName} {startDate} - {endDate} Payslips.pdf
            </span>
          </div>

          {/* Global defaults + field toggles bar */}
          <div className="flex items-center gap-4 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2 flex-wrap">
            <span className="text-xs text-gray-400 font-medium flex-shrink-0">Defaults:</span>

            {/* Hotels toggle + input */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => toggleField('hotels')} className="flex items-center gap-1 text-xs transition-colors"
                title={hiddenFields.hotels ? 'Show Hotels field' : 'Hide Hotels field'}>
                <input type="checkbox" checked={!hiddenFields.hotels} readOnly className="w-3 h-3 accent-blue-500" />
                <span className={hiddenFields.hotels ? 'text-gray-600 line-through' : 'text-gray-400'}>Hotels</span>
              </button>
              {!hiddenFields.hotels && (
                <div className="relative">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                  <input type="number" min="0" placeholder="0" value={stdHotels || ''}
                    onChange={e => {
                      const val = parseFloat(e.target.value) || 0;
                      setStdHotels(val);
                      setWorkerSettings(prev => {
                        const next = new Map(prev);
                        next.forEach((s, id) => next.set(id, { ...s, hotels: val }));
                        return next;
                      });
                    }}
                    className="w-20 bg-gray-900 border border-gray-600 rounded py-1 pl-4 pr-1 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}
            </div>

            {/* Advances toggle + input */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => toggleField('advances')} className="flex items-center gap-1 text-xs transition-colors"
                title={hiddenFields.advances ? 'Show Advances field' : 'Hide Advances field'}>
                <input type="checkbox" checked={!hiddenFields.advances} readOnly className="w-3 h-3 accent-blue-500" />
                <span className={hiddenFields.advances ? 'text-gray-600 line-through' : 'text-gray-400'}>Advances</span>
              </button>
              {!hiddenFields.advances && (
                <div className="relative">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                  <input type="number" min="0" placeholder="0" value={stdAdvances || ''}
                    onChange={e => {
                      const val = parseFloat(e.target.value) || 0;
                      setStdAdvances(val);
                      setWorkerSettings(prev => {
                        const next = new Map(prev);
                        next.forEach((s, id) => next.set(id, { ...s, advances: val }));
                        return next;
                      });
                    }}
                    className="w-20 bg-gray-900 border border-gray-600 rounded py-1 pl-4 pr-1 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}
            </div>

            {/* Travel Pkg toggle (no global default input — was never in defaults bar) */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => toggleField('travelPkg')} className="flex items-center gap-1 text-xs transition-colors"
                title={hiddenFields.travelPkg ? 'Show Travel Pkg field' : 'Hide Travel Pkg field'}>
                <input type="checkbox" checked={!hiddenFields.travelPkg} readOnly className="w-3 h-3 accent-blue-500" />
                <span className={hiddenFields.travelPkg ? 'text-gray-600 line-through' : 'text-gray-400'}>Travel Pkg</span>
              </button>
            </div>

            <span className="text-gray-700 text-xs">|</span>

            {/* Set all rates — stamps one payout rate onto every day of every worker */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs text-gray-400">Set all rates</span>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                <input type="number" min="0" step="0.01" placeholder="0" value={bulkRate}
                  onChange={e => setBulkRate(e.target.value)}
                  className="w-20 bg-gray-900 border border-gray-600 rounded py-1 pl-4 pr-1 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
              </div>
              <button onClick={applyRateToAll}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors flex-shrink-0">
                Apply
              </button>
            </div>

            <span className="text-xs text-gray-600 ml-1">— eye toggles fields · "Apply" overwrites every day's rate</span>
          </div>

          {/* Batch setup bar */}
          <div className="flex items-center gap-3 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2 flex-wrap">
            <span className="text-xs text-gray-400 font-medium flex-shrink-0">Batches:</span>
            {batches.map((batch, idx) => (
              <div key={batch.id} className="flex items-center gap-1 flex-shrink-0">
                <input
                  type="text"
                  value={batch.name}
                  onChange={e => renameBatch(batch.id, e.target.value)}
                  className="w-24 bg-gray-900 border border-gray-600 rounded py-0.5 px-2 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder={`Batch ${idx + 1}`}
                />
                {batches.length > 1 && (
                  <button onClick={() => removeBatch(batch.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addBatch}
              className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 flex-shrink-0 transition-colors">
              <Plus size={11} /> Add Batch
            </button>
            <span className="text-xs text-gray-600 ml-1">— one file exported per batch</span>
          </div>

          {/* Unassigned warning banner */}
          {workerList.length > 0 && unassignedCount > 0 && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-2.5 text-red-400 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" />
              <span>
                <span className="font-bold">{unassignedCount} worker{unassignedCount !== 1 ? 's' : ''}</span> not assigned to a batch — assign all workers before exporting.
              </span>
            </div>
          )}

          {workerList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-2">
              <AlertCircle size={32} className="opacity-30" />
              <p className="text-sm">No workers found for this date range.</p>
            </div>
          ) : (
            workerList.map(w => renderWorker(w))
          )}

          {workerList.length > 0 && (
            <div className="flex justify-center pt-2 pb-4">
              <button
                onClick={handleExport}
                disabled={isExporting || !canExport}
                title={!canExport ? `${unassignedCount} worker(s) not yet assigned to a batch` : ''}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-bold transition-colors">
                {isExporting ? <Loader size={18} className="animate-spin" /> : <Download size={18} />}
                Export PDF
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PayslipGenerator;
