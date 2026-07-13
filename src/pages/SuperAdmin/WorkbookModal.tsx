// src/pages/SuperAdmin/WorkbookModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Sheet, Check, Loader, Calendar, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { reportingService, WorkbookConfig } from '../../lib/reportingService';
import { extractSheetId } from '../../lib/commandCenterService';
import { googleSheetsService } from '../../lib/googleSheetsService';

interface WorkbookModalProps {
  workbook: WorkbookConfig | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

// The tab we read to find which days have payout data.
// If any workbook spells this differently, change it here.
const PAYOUT_STATS_TAB = 'Payout Stats';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Parse a "MmmDD" tab/date string into { month: 0-11, day: 1-31 }, or null.
function parseMmmDd(raw: any): { month: number; day: number } | null {
  if (raw == null) return null;
  const t = raw.toString().trim();
  if (t.length < 4) return null;
  const month = MONTHS.indexOf(t.substring(0, 3));
  const day = parseInt(t.substring(3), 10);
  if (month < 0 || !day || day < 1 || day > 31) return null;
  return { month, day };
}

const WorkbookModal: React.FC<WorkbookModalProps> = ({ workbook, onClose, onSaved }) => {
  const isEdit = !!workbook;

  const [label, setLabel] = useState(workbook?.label || '');
  const [sheetUrl, setSheetUrl] = useState(
    workbook ? `https://docs.google.com/spreadsheets/d/${workbook.sheetId}/edit` : ''
  );

  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [dataDays, setDataDays] = useState<Set<string>>(new Set()); // keys "month-day"
  const [hasLoaded, setHasLoaded] = useState(false);

  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-load the calendar when editing an existing workbook.
  useEffect(() => {
    if (isEdit) loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (!ok) {
          setCalendarError('Google sign-in was cancelled. Sign in to read the workbook.');
          setLoadingCalendar(false);
          return;
        }
      }

      const rows = await googleSheetsService.readRangeById(sheetId, `'${PAYOUT_STATS_TAB}'!A:A`);
      const days = new Set<string>();
      // Row 0 is the "Date" header; skip it.
      for (let i = 1; i < rows.length; i++) {
        const parsed = parseMmmDd(rows[i]?.[0]);
        if (parsed) days.add(`${parsed.month}-${parsed.day}`);
      }

      setDataDays(days);
      setHasLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unable to parse range')) {
        setCalendarError(`Couldn\u2019t find a "${PAYOUT_STATS_TAB}" tab in that sheet. Check the URL points to the right workbook.`);
      } else if (msg.toLowerCase().includes('permission') || msg.includes('403') || msg.toLowerCase().includes('access')) {
        setCalendarError('The signed-in Google account doesn\u2019t have access to that sheet.');
      } else {
        setCalendarError(msg);
      }
    } finally {
      setLoadingCalendar(false);
    }
  };

  const handleSave = async () => {
    const sheetId = extractSheetId(sheetUrl);
    if (!label.trim()) {
      setSaveError('Give the workbook a name.');
      return;
    }
    if (!sheetId) {
      setSaveError('Enter a valid Google Sheets URL or ID.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && workbook) {
        // Pass 1 doesn't touch date ranges — updating only label/sheetId leaves
        // the stored ranges intact (the service only writes provided fields).
        await reportingService.updateWorkbookConfig(workbook.id, { label: label.trim(), sheetId });
      } else {
        await reportingService.createWorkbookConfig({ label: label.trim(), sheetId });
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
            const isData = dataDays.has(`${monthIndex}-${d}`);
            return (
              <div
                key={`d-${i}`}
                className={`text-[10px] text-center rounded-sm leading-5 ${
                  isData
                    ? 'bg-teal-600/70 text-white font-semibold'
                    : 'text-gray-600'
                }`}
              >
                {d}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* HEADER */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? 'Edit Workbook' : 'Add Workbook'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* LABEL */}
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

          {/* SHEET URL + LOAD */}
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
            <p className="text-gray-500 text-xs mt-1">
              Reads the <code className="text-gray-400">{PAYOUT_STATS_TAB}</code> tab and highlights the days that have payout data.
            </p>
          </div>

          {calendarError && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{calendarError}</span>
            </div>
          )}

          {/* CALENDAR */}
          {loadingCalendar ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="animate-spin text-teal-400" size={28} />
            </div>
          ) : hasLoaded ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="inline-block w-3 h-3 rounded-sm bg-teal-600/70" />
                  <span>{dataDays.size} day{dataDays.size === 1 ? '' : 's'} with payout data</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setYear((y) => y - 1)} className="text-gray-400 hover:text-white p-1">
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-sm font-medium text-gray-300 w-12 text-center">{year}</span>
                  <button onClick={() => setYear((y) => y + 1)} className="text-gray-400 hover:text-white p-1">
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {MONTHS.map((_, i) => renderMonth(i))}
              </div>
              {dataDays.size === 0 && (
                <p className="text-sm text-gray-500 mt-3 text-center">
                  No payout data found in this workbook yet.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between sticky bottom-0 bg-gray-800">
          {saveError ? (
            <span className="text-red-400 text-sm">{saveError}</span>
          ) : <span />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
              {isEdit ? 'Save' : 'Add workbook'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkbookModal;
