// src/pages/SuperAdmin/ReportingView.tsx
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  MapPin,
  Sheet,
  Plus,
  Loader,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  Cloud,
} from 'lucide-react';
import { PayableCity, WorkbookConfig } from '../../lib/reportingService';
import {
  loadReportData,
  LoadedWorkbook,
  GoogleAuthCancelledError,
} from '../../lib/reportDataLoader';
import WorkbookModal from './WorkbookModal';

interface ReportingViewProps {
  onBack: () => void;
}

// Report types shown in the left rail. Only one today; add more here as the
// Reporting area grows.
const REPORT_TYPES = [
  { id: 'payable_city_sales', label: 'Payable City Sales', icon: MapPin },
];

type LoadStatus = 'loading' | 'ready' | 'auth_error' | 'error';

const ReportingView: React.FC<ReportingViewProps> = ({ onBack }) => {
  const [activeReport, setActiveReport] = useState('payable_city_sales');

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [workbooks, setWorkbooks] = useState<LoadedWorkbook[]>([]);
  const [cities, setCities] = useState<PayableCity[]>([]);

  const [showWorkbookModal, setShowWorkbookModal] = useState(false);
  const [editingWorkbook, setEditingWorkbook] = useState<WorkbookConfig | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const data = await loadReportData();
      setWorkbooks(data.workbooks);
      setCities(data.cities);
      setStatus('ready');
    } catch (err) {
      if (err instanceof GoogleAuthCancelledError) {
        setStatus('auth_error');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load reporting data');
        setStatus('error');
      }
    }
  };

  // Open the workbook editor. For a command-center book with no saved config yet,
  // hand the modal a synthetic config (no id) so it prefills the sheet + label and
  // saves as a new config on first use.
  const openWorkbook = (wb: LoadedWorkbook) => {
    setEditingWorkbook(
      wb.config || { id: '', label: wb.label, sheetId: wb.sheetId, dateRanges: [] }
    );
    setShowWorkbookModal(true);
  };

  const totalRanges = workbooks.reduce((sum, w) => sum + (w.config?.dateRanges.length || 0), 0);
  const totalPrefixes = cities.reduce((sum, c) => sum + c.prefixes.length, 0);

  // --- LOADING / ERROR GATES (Reporting needs Google to open) ---
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-4">
        <Loader className="animate-spin text-teal-400" size={36} />
        <div className="text-center">
          <p className="text-gray-300 font-medium">Connecting to Google and reading workbooks…</p>
          <p className="text-gray-500 text-sm mt-1">Pulling Payout Stats from every command center.</p>
        </div>
      </div>
    );
  }

  if (status === 'auth_error' || status === 'error') {
    const isAuth = status === 'auth_error';
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-14 h-14 bg-red-900/40 rounded-xl flex items-center justify-center border border-red-800">
          {isAuth ? <Cloud className="text-red-400" size={26} /> : <AlertTriangle className="text-red-400" size={26} />}
        </div>
        <div className="text-center max-w-md">
          <p className="text-gray-200 font-bold mb-1">
            {isAuth ? 'Google sign-in needed' : 'Couldn’t load reporting data'}
          </p>
          <p className="text-gray-400 text-sm">
            {isAuth
              ? 'Reporting reads Payout Stats live from Google Sheets, so it needs a connected Google account to open.'
              : errorMsg}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Back
          </button>
          <button
            onClick={load}
            className="bg-teal-600 hover:bg-teal-500 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={16} />
            {isAuth ? 'Connect to Google' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // --- READY ---
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors p-1" title="Back">
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 bg-teal-900/50 rounded-lg flex items-center justify-center border border-teal-700">
              <BarChart3 className="text-teal-400" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Reporting</h1>
              <p className="text-xs text-gray-400">Business reports across all command centers</p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            title="Re-read all workbooks"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-6xl w-full mx-auto flex">
        {/* LEFT RAIL */}
        <div className="w-56 flex-shrink-0 border-r border-gray-800 p-4 space-y-1">
          {REPORT_TYPES.map((rt) => {
            const Icon = rt.icon;
            const isActive = rt.id === activeReport;
            return (
              <button
                key={rt.id}
                onClick={() => setActiveReport(rt.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? 'bg-teal-900/40 text-teal-300 border border-teal-800'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent'
                }`}
              >
                <Icon size={16} />
                {rt.label}
              </button>
            );
          })}
        </div>

        {/* MAIN */}
        <div className="flex-1 p-6">
          {activeReport === 'payable_city_sales' && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-white mb-1">Payable City Sales</h2>
                <p className="text-sm text-gray-400">
                  Reads Payout Stats from each workbook, converts production to payable
                  sales, and attributes it across cities by the region each sale was made in.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* WORKBOOKS CARD */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-900/30 rounded-lg flex items-center justify-center border border-blue-800">
                        <Sheet className="text-blue-400" size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">Workbooks &amp; Date Ranges</h3>
                        <p className="text-xs text-gray-500">
                          {workbooks.length} workbook{workbooks.length === 1 ? '' : 's'} · {totalRanges} date range{totalRanges === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setEditingWorkbook(null); setShowWorkbookModal(true); }}
                      className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
                      title="Add a standalone workbook (e.g. the CEO book)"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </div>

                  {workbooks.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No workbooks found. Add one, or attach workerbooks to your command centers.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {workbooks.map((wb) => (
                        <button
                          key={wb.sheetId}
                          onClick={() => openWorkbook(wb)}
                          className="w-full flex items-center gap-2 text-sm rounded px-2 py-1.5 text-left hover:bg-gray-700/50 transition-colors"
                        >
                          <Layers size={14} className="text-gray-500 flex-shrink-0" />
                          <span className="font-medium text-gray-200">{wb.label}</span>
                          {wb.source === 'standalone' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">added</span>
                          )}
                          {wb.readError ? (
                            <span className="text-red-400 text-xs ml-auto flex items-center gap-1">
                              <AlertCircle size={12} />
                              error
                            </span>
                          ) : (
                            <span className="text-gray-500 text-xs ml-auto">
                              {wb.dataDays.size} data day{wb.dataDays.size === 1 ? '' : 's'} · {wb.config?.dateRanges.length || 0} range{(wb.config?.dateRanges.length || 0) === 1 ? '' : 's'}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* PAYABLE CITIES CARD */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-900/30 rounded-lg flex items-center justify-center border border-purple-800">
                        <Building2 className="text-purple-400" size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">Payable Cities</h3>
                        <p className="text-xs text-gray-500">
                          {cities.length} cit{cities.length === 1 ? 'y' : 'ies'} · {totalPrefixes} prefix{totalPrefixes === 1 ? '' : 'es'}
                        </p>
                      </div>
                    </div>
                    <button
                      disabled
                      title="Wired in the next step"
                      className="bg-gray-700 text-gray-500 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 cursor-not-allowed"
                    >
                      <Plus size={14} />
                      Manage
                    </button>
                  </div>

                  {cities.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No cities yet. Add one to map contractor prefixes to a city and set how
                      its sales split across regions.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {cities.map((city) => (
                        <div key={city.id} className="flex items-center gap-2 text-sm text-gray-300">
                          <MapPin size={14} className="text-gray-500 flex-shrink-0" />
                          <span className="font-medium">{city.name}</span>
                          <span className="text-gray-500 text-xs">{city.prefixes.join(', ') || 'no prefixes'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showWorkbookModal && (
        <WorkbookModal
          workbook={editingWorkbook}
          onClose={() => setShowWorkbookModal(false)}
          onSaved={() => {
            setShowWorkbookModal(false);
            load();
          }}
        />
      )}
    </div>
  );
};

export default ReportingView;
