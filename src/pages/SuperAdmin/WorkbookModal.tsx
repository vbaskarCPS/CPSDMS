// src/pages/SuperAdmin/WorkbookModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X, Sheet, Check, Loader, Calendar, ChevronLeft, ChevronRight,
  AlertCircle, Trash2, Edit2, Plus,
} from 'lucide-react';
import { reportingService, WorkbookConfig, WorkbookDateRange } from '../../lib/reportingService';
import { extractSheetId } from '../../lib/commandCenterService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { Region, SeasonType } from '../../types';

interface WorkbookModalProps {
  workbook: WorkbookConfig | null;          // config (may be synthetic, id==='') or null for a brand-new add
  preloadedDataDays?: Set<string>;          // "month-day" keys from the bulk load; when present, no sheet read
  onClose: () => void;
  onSaved: () => void;
}

// The tab we read to find which days have payout data (only used for a brand-new
// add, where there's no preloaded data). If any workbook spells this differently,
// change it here AND in reportDataLoader.ts.
const PAYOUT_STATS_TAB = 'Payout Stats';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const SEASON_OPTIONS: { value: SeasonType; label: string }[] = [
  { value: 'aeration', label: 'Aeration' },
  { value: 'lawn_rejuv', label: 'Lawn Rejuv' },
  { value: 'sealing', label: 'Sealing' },
  { value: 'cleaning', label: 'Window Cleaning' },
];

const REGIONS: Region[] = ['West', 'Central', 'East'];

// Region visual language — matches the command-center screen's blue/green/orange.
const REGION_STYLES: Record<Region, { cell: string; dot: string; text: string; btnActive: string }> = {
  West:    { cell: 'bg-blue-600/70 text-white',   dot: 'bg-blue-500',   text: 'text-blue-300',   btnActive: 'bg-blue-900/50 border-blue-500 text-blue-300' },
  Central: { cell: 'bg-green-600/70 text-white',  dot: 'bg-green-500',  text: 'text-green-300',  btnActive: 'bg-green-900/50 border-green-500 text-green-300' },
  East:    { cell: 'bg-orange-600/70 text-white', dot: 'bg-orange-500', text: 'text-orange-300', btnActive: 'bg-orange-900/50 border-orange-500 text-orange-300' },
};

interface MD { month: number; day: number; }

function parseMmmDd(raw: any): MD | null {
  if (raw == null) return null;
  const t = raw.toString().trim();
  if (t.length < 4) return null;
  const month = MONTHS.indexOf(t.substring(0, 3));
  const day = parseInt(t.substring(3), 10);
  if (month < 0 || !day || day < 1 || day > 31) return null;
  return { month, day };
}

// "MmmDD" with zero-padded day, e.g. { month:4, day:7 } -> "May07".
function fmtTab(md: MD): string {
  return MONTHS[md.month] + String(md.day).padStart(2, '0');
}

// Calendar ordinal for ordering / range membership (season stays within one year,
// so month+day compares unambiguously). Day maxes at 31, so no cross-month collision.
function ord(month: number, day: number): number {
  return month * 31 + day;
}

const seasonLabel = (s: SeasonType): string =>
  SEASON_OPTIONS.find((o) => o.value === s)?.label || s;

interface Draft {
  editIndex: number | null;  // null = new range; otherwise editing ranges[editIndex]
  start: MD;
  end: MD;
  region: Region | null;
  season: SeasonType | null;
  taxRate: string;
  productCostPercent: string;
}

const WorkbookModal: React.FC<WorkbookModalProps> = ({ workbook, preloadedDataDays, onClose, onSaved }) => {
  const isEdit = !!workbook?.id;
  const hasSheet = !!workbook?.sheetId;

  const [label, setLabel] = useState(workbook?.label || '');
  const [sheetUrl, setSheetUrl] = useState(
    workbook?.sheetId ? `https://docs.google.com/spreadsheets/d/${workbook.sheetId}/edit` : ''
  );

  const [dataDays, setDataDays] = useState<Set<string>>(preloadedDataDays ? new Set(preloadedDataDays) : new Set());
  const [hasLoaded, setHasLoaded] = useState(!!preloadedDataDays);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const [ranges, setRanges] = useState<WorkbookDateRange[]>(() =>
    sortRangesInPlace(workbook?.dateRanges ? [...workbook.dateRanges] : [])
  );
  const [selStart, setSelStart] = useState<MD | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selError, setSelError] = useState<string | null>(null);

  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Brand-new add with a sheet but no preloaded data: read once. (CC / existing
  // books arrive with preloadedDataDays and never hit Google here.)
  useEffect(() => {
    if (hasSheet && !preloadedDataDays) loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sortRangesInPlace(list: WorkbookDateRange[]): WorkbookDateRange[] {
    return list.sort((a, b) => {
      const pa = parseMmmDd(a.startTab), pb = parseMmmDd(b.startTab);
      return (pa ? ord(pa.month, pa.day) : 0) - (pb ? ord(pb.month, pb.day) : 0);
    });
  }

  function setRangesSorted(list: WorkbookDateRange[]) {
    setRanges(sortRangesInPlace([...list]));
  }

  const loadCalendar = async () => {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      setCalendarError('That doesn\u2019t look like a valid Google Sheets URL or ID.');
      return;
    }
    setLoadingCalendar(true);
    setCalendarError(null);
    try {
      if (!googleSheetsService.isAuthenticated()) {
        const ok = await googleSheetsService.authenticate();
        if (!ok) { setCalendarError('Google sign-in was cancelled.'); setLoadingCalendar(false); return; }
      }
      const rows = await googleSheetsService.readRangeById(sheetId, `'${PAYOUT_STATS_TAB}'!A:A`);
      const days = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const p = parseMmmDd(rows[i]?.[0]);
        if (p) days.add(`${p.month}-${p.day}`);
      }
      setDataDays(days);
      setHasLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unable to parse range')) {
        setCalendarError(`Couldn\u2019t find a "${PAYOUT_STATS_TAB}" tab in that sheet.`);
      } else if (msg.toLowerCase().includes('permission') || msg.includes('403') || msg.toLowerCase().includes('access')) {
        setCalendarError('The signed-in Google account doesn\u2019t have access to that sheet.');
      } else {
        setCalendarError(msg);
      }
    } finally {
      setLoadingCalendar(false);
    }
  };

  // --- Range membership / overlap helpers ---
  const regionForDay = (month: number, day: number): Region | null => {
    const o = ord(month, day);
    for (const r of ranges) {
      const s = parseMmmDd(r.startTab), e = parseMmmDd(r.endTab);
      if (!s || !e) continue;
      if (o >= ord(s.month, s.day) && o <= ord(e.month, e.day)) return r.region;
    }
    return null;
  };

  const spanOverlaps = (start: MD, end: MD, exceptIndex: number | null): boolean => {
    const lo = ord(start.month, start.day), hi = ord(end.month, end.day);
    return ranges.some((r, idx) => {
      if (idx === exceptIndex) return false;
      const s = parseMmmDd(r.startTab), e = parseMmmDd(r.endTab);
      if (!s || !e) return false;
      const rlo = ord(s.month, s.day), rhi = ord(e.month, e.day);
      return !(hi < rlo || rhi < lo);
    });
  };

  const inDraftSpan = (month: number, day: number): boolean => {
    if (!draft) return false;
    const o = ord(month, day);
    return o >= ord(draft.start.month, draft.start.day) && o <= ord(draft.end.month, draft.end.day);
  };

  // --- Day click: bracket a range by clicking start, then end (both lit days) ---
  const handleDayClick = (month: number, day: number) => {
    if (draft) return;               // finish the open range first
    const key = `${month}-${day}`;
    if (regionForDay(month, day)) return;   // already inside a saved range
    if (!dataDays.has(key)) return;         // endpoints must be data days

    setSelError(null);

    if (!selStart) {
      setSelStart({ month, day });
      return;
    }

    const a = selStart, b = { month, day };
    const [start, end] = ord(a.month, a.day) <= ord(b.month, b.day) ? [a, b] : [b, a];

    if (spanOverlaps(start, end, null)) {
      setSelError('That span crosses a range you\u2019ve already defined. Pick days that are still teal.');
      setSelStart(null);
      return;
    }

    setDraft({ editIndex: null, start, end, region: null, season: null, taxRate: '', productCostPercent: '' });
    setSelStart(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.region) { setSelError('Pick a region.'); return; }
    if (!draft.season) { setSelError('Pick a season.'); return; }
    const tax = parseFloat(draft.taxRate);
    const product = parseFloat(draft.productCostPercent);
    if (isNaN(tax) || isNaN(product)) { setSelError('Enter a tax rate and a product cost (0 is fine).'); return; }

    const newRange: WorkbookDateRange = {
      startTab: fmtTab(draft.start),
      endTab: fmtTab(draft.end),
      region: draft.region,
      season: draft.season,
      taxRate: tax,
      productCostPercent: product,
    };

    if (draft.editIndex === null) {
      setRangesSorted([...ranges, newRange]);
    } else {
      const copy = [...ranges];
      copy[draft.editIndex] = newRange;
      setRangesSorted(copy);
    }
    setDraft(null);
    setSelError(null);
  };

  const editRange = (i: number) => {
    const r = ranges[i];
    const s = parseMmmDd(r.startTab), e = parseMmmDd(r.endTab);
    if (!s || !e) return;
    setSelStart(null);
    setSelError(null);
    setDraft({
      editIndex: i, start: s, end: e,
      region: r.region, season: r.season,
      taxRate: String(r.taxRate), productCostPercent: String(r.productCostPercent),
    });
  };

  const deleteRange = (i: number) => {
    setRangesSorted(ranges.filter((_, idx) => idx !== i));
    if (draft?.editIndex === i) setDraft(null);
  };

  const handleSave = async () => {
    const sheetId = extractSheetId(sheetUrl);
    if (!label.trim()) { setSaveError('Give the workbook a name.'); return; }
    if (!sheetId) { setSaveError('Enter a valid Google Sheets URL or ID.'); return; }

    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && workbook) {
        await reportingService.updateWorkbookConfig(workbook.id, { label: label.trim(), sheetId, dateRanges: ranges });
      } else {
        await reportingService.createWorkbookConfig({ label: label.trim(), sheetId, dateRanges: ranges });
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save workbook');
      setSaving(false);
    }
  };

  const renderMonth = (monthIndex: number) => {
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <div key={monthIndex} className="bg-gray-900 rounded-lg border border-gray-700 p-2">
        <div className="text-xs font-bold text-gray-300 mb-1.5 text-center">{MONTH_NAMES[monthIndex]}</div>
        <div className="grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((w, i) => (
            <div key={`h-${i}`} className="text-[9px] text-gray-600 text-center font-medium">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e-${i}`} />;
            const key = `${monthIndex}-${d}`;
            const region = regionForDay(monthIndex, d);
            const isData = dataDays.has(key);
            const isSelStart = selStart && selStart.month === monthIndex && selStart.day === d;
            const isDraft = inDraftSpan(monthIndex, d);

            let cls = 'text-gray-600';
            if (region) cls = REGION_STYLES[region].cell;
            else if (isDraft) cls = 'bg-amber-500/80 text-white font-semibold';
            else if (isSelStart) cls = 'bg-teal-400 text-gray-900 font-bold';
            else if (isData) cls = 'bg-teal-600/70 text-white font-semibold';

            const clickable = !draft && isData && !region;

            return (
              <div
                key={`d-${i}`}
                onClick={() => handleDayClick(monthIndex, d)}
                className={`text-[10px] text-center rounded-sm leading-5 ${cls} ${clickable ? 'cursor-pointer hover:ring-1 hover:ring-teal-300' : ''}`}
              >
                {d}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const showSheetInput = !hasSheet; // hide the URL row for CC / existing books

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        {/* HEADER */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
          <h2 className="text-lg font-bold text-white">{isEdit ? 'Edit Workbook' : 'Configure Workbook'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* NAME */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Workbook name</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., CEO Workerbook"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          {/* SHEET URL (brand-new add only) */}
          {showSheetInput && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Google Sheet URL</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Sheet className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:ring-teal-500 focus:outline-none text-sm"
                  />
                </div>
                <button
                  onClick={loadCalendar}
                  disabled={loadingCalendar}
                  className="bg-teal-700 hover:bg-teal-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {loadingCalendar ? <Loader className="animate-spin" size={16} /> : <Calendar size={16} />}
                  Load calendar
                </button>
              </div>
            </div>
          )}

          {calendarError && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{calendarError}</span>
            </div>
          )}

          {loadingCalendar ? (
            <div className="flex items-center justify-center py-16"><Loader className="animate-spin text-teal-400" size={28} /></div>
          ) : hasLoaded ? (
            <>
              {/* LEGEND + SELECTION HINT + YEAR */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-teal-600/70" /> data (unassigned)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-600/70" /> West</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-600/70" /> Central</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-600/70" /> East</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setYear((y) => y - 1)} className="text-gray-400 hover:text-white p-1"><ChevronLeft size={18} /></button>
                  <span className="text-sm font-medium text-gray-300 w-12 text-center">{year}</span>
                  <button onClick={() => setYear((y) => y + 1)} className="text-gray-400 hover:text-white p-1"><ChevronRight size={18} /></button>
                </div>
              </div>

              {selStart && !draft && (
                <div className="text-sm text-teal-300 bg-teal-900/20 border border-teal-800 rounded-lg px-3 py-2 flex items-center justify-between">
                  <span>Start set to <strong>{fmtTab(selStart)}</strong> — now click the end day.</span>
                  <button onClick={() => { setSelStart(null); setSelError(null); }} className="text-gray-400 hover:text-white text-xs">Cancel</button>
                </div>
              )}
              {selError && (
                <div className="text-sm text-amber-300 bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2">{selError}</div>
              )}

              {/* CALENDAR */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {MONTHS.map((_, i) => renderMonth(i))}
              </div>
              {dataDays.size === 0 && (
                <p className="text-sm text-gray-500 text-center">No payout data found in this workbook yet.</p>
              )}

              {/* DRAFT SETTINGS STRIP */}
              {draft && (
                <div className="bg-gray-900 rounded-xl border border-amber-800/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-amber-300">
                    <Plus size={16} />
                    <span>{draft.editIndex === null ? 'New range' : 'Editing range'}: <strong>{fmtTab(draft.start)} – {fmtTab(draft.end)}</strong></span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Region</label>
                    <div className="grid grid-cols-3 gap-2">
                      {REGIONS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setDraft({ ...draft, region: r })}
                          className={`py-1.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                            draft.region === r ? REGION_STYLES[r].btnActive : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Season</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {SEASON_OPTIONS.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => setDraft({ ...draft, season: s.value })}
                          className={`py-1.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                            draft.season === s.value ? 'bg-teal-900/50 border-teal-500 text-teal-300' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Tax rate (%)</label>
                      <input
                        type="number"
                        value={draft.taxRate}
                        onChange={(e) => setDraft({ ...draft, taxRate: e.target.value })}
                        placeholder="e.g. 13"
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-teal-500 focus:outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Product cost (%)</label>
                      <input
                        type="number"
                        value={draft.productCostPercent}
                        onChange={(e) => setDraft({ ...draft, productCostPercent: e.target.value })}
                        placeholder="e.g. 20"
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-teal-500 focus:outline-none text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setDraft(null); setSelError(null); }} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">Cancel</button>
                    <button onClick={saveDraft} className="bg-teal-600 hover:bg-teal-500 text-white px-4 py-1.5 rounded-lg font-medium text-sm flex items-center gap-1.5">
                      <Check size={14} /> Save range
                    </button>
                  </div>
                </div>
              )}

              {/* RANGES LIST */}
              {ranges.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Date ranges</h4>
                  <div className="space-y-1.5">
                    {ranges.map((r, i) => (
                      <div key={`${r.startTab}-${r.endTab}-${i}`} className="flex items-center gap-3 bg-gray-900 rounded-lg border border-gray-700 px-3 py-2 text-sm">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${REGION_STYLES[r.region].dot}`} />
                        <span className="font-medium text-gray-200 w-28">{r.startTab} – {r.endTab}</span>
                        <span className={`text-xs ${REGION_STYLES[r.region].text}`}>{r.region}</span>
                        <span className="text-xs text-gray-400">{seasonLabel(r.season)}</span>
                        <span className="text-xs text-gray-500 ml-auto">tax {r.taxRate}% · prod {r.productCostPercent}%</span>
                        <button onClick={() => editRange(i)} className="text-gray-400 hover:text-white p-1" title="Edit"><Edit2 size={14} /></button>
                        <button onClick={() => deleteRange(i)} className="text-red-400 hover:text-red-300 p-1" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between sticky bottom-0 bg-gray-800">
          {saveError ? <span className="text-red-400 text-sm">{saveError}</span> : <span className="text-gray-500 text-xs">{ranges.length} range{ranges.length === 1 ? '' : 's'} defined</span>}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkbookModal;
