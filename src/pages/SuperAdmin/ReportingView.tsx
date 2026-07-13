// src/pages/SuperAdmin/ReportingView.tsx
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  MapPin,
  Sheet,
  Plus,
  Play,
  Loader,
  AlertCircle,
  Layers,
} from 'lucide-react';
import {
    reportingService,
    WorkbookConfig,
    PayableCity,
  } from '../../lib/reportingService';
  import WorkbookModal from './WorkbookModal';

interface ReportingViewProps {
  onBack: () => void;
}

// The list of report types shown in the left rail. Only one exists today;
// this array is the single place to add more as the Reporting area grows.
const REPORT_TYPES = [
  { id: 'payable_city_sales', label: 'Payable City Sales', icon: MapPin },
];

const ReportingView: React.FC<ReportingViewProps> = ({ onBack }) => {
  const [activeReport, setActiveReport] = useState('payable_city_sales');

  const [workbooks, setWorkbooks] = useState<WorkbookConfig[]>([]);
  const [cities, setCities] = useState<PayableCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkbookModal, setShowWorkbookModal] = useState(false);
  const [editingWorkbook, setEditingWorkbook] = useState<WorkbookConfig | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    setError(null);
    try {
      const [wbs, cts] = await Promise.all([
        reportingService.getWorkbookConfigs(),
        reportingService.getPayableCities(),
      ]);
      setWorkbooks(wbs);
      setCities(cts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reporting configuration');
    } finally {
      setLoading(false);
    }
  };

  // Totals for the summary cards.
  const totalRanges = workbooks.reduce((sum, w) => sum + w.dateRanges.length, 0);
  const totalPrefixes = cities.reduce((sum, c) => sum + c.prefixes.length, 0);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-white transition-colors p-1"
              title="Back"
            >
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
        </div>
      </div>

      <div className="flex-1 max-w-6xl w-full mx-auto flex">
        {/* LEFT RAIL — report types */}
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

        {/* MAIN AREA */}
        <div className="flex-1 p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {activeReport === 'payable_city_sales' && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-white mb-1">Payable City Sales</h2>
                <p className="text-sm text-gray-400">
                  Reads Payout Stats from each workbook, converts production to payable
                  sales, and attributes it across cities by the region each sale was made in.
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader className="animate-spin text-teal-400" size={28} />
                </div>
              ) : (
                <>
                  {/* SETUP SUMMARY CARDS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {/* Workbooks card */}
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
                        >
                          <Plus size={14} />
                          Add
                        </button>
                      </div>

                      {workbooks.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          No workbooks yet. Add one to define which sheets to read and how their
                          date ranges map to region, season, tax, and product cost.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {workbooks.map((wb) => (
                            <button
                              key={wb.id}
                              onClick={() => { setEditingWorkbook(wb); setShowWorkbookModal(true); }}
                              className="w-full flex items-center gap-2 text-sm text-gray-300 hover:bg-gray-700/50 rounded px-1 py-1 text-left transition-colors"
                            >
                              <Layers size={14} className="text-gray-500 flex-shrink-0" />
                              <span className="font-medium">{wb.label}</span>
                              <span className="text-gray-500 text-xs">
                                {wb.dateRanges.length} range{wb.dateRanges.length === 1 ? '' : 's'}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Payable Cities card */}
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
                              <span className="text-gray-500 text-xs">
                                {city.prefixes.join(', ') || 'no prefixes'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RUN REPORT */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white mb-0.5">Run report</h3>
                      <p className="text-xs text-gray-500">
                        Totals payable sales per city, broken down by region and season.
                      </p>
                    </div>
                    <button
                      disabled
                      title="Available once setup is wired"
                      className="bg-gray-700 text-gray-500 px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 cursor-not-allowed"
                    >
                      <Play size={16} />
                      Run
                    </button>
                  </div>
                </>
              )}
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
            loadConfigs();
          }}
        />
      )}
    </div>
  );
};

export default ReportingView;
