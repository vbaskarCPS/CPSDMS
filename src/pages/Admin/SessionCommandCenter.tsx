// src/pages/Admin/SessionCommandCenter.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload,
  CheckCircle,
  AlertCircle,
  FileText,
  Users,
  Play,
  Trash2,
  Search,
  Filter,
  Download,
  Lock,
  Unlock
} from 'lucide-react';
import { parseDailySessionXLSX } from '../../lib/feedParser';
import { sessionService } from '../../lib/sessionService';
import { generateSessionExport } from '../../lib/exportService';
import { DailySessionData, SortOption } from '../../types';
import PayoutToday from '../Management/PayoutToday';

const SessionCommandCenter: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Initialize activeTab from URL query parameter, defaulting to 'lifecycle'
  const [activeTab, setActiveTab] = useState<'lifecycle' | 'payout'>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam === 'payout' ? 'payout' : 'lifecycle';
  });

  // --- STATE ---
  const [feedFile, setFeedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<DailySessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [currentSession, setCurrentSession] = useState<DailySessionData | null>(null);
  
  // End of Day State
  const [hasDownloaded, setHasDownloaded] = useState(false);

  // --- PAYOUT STATE ---
  const [payoutSearch, setPayoutSearch] = useState('');
  const [payoutSort, setPayoutSort] = useState<SortOption>('standard');

  // Load active session on mount
  useEffect(() => {
    loadSession();
  }, []);

  // Update URL when tab changes
  const handleTabChange = (tab: 'lifecycle' | 'payout') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const loadSession = async () => {
    const session = await sessionService.getDailySession();
    setCurrentSession(session);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedFile(file);
    setPreviewData(null);
    setError(null);
    setLoading(true);

    try {
      const data = await parseDailySessionXLSX(file);
      setPreviewData(data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Failed to parse Excel file.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStartSession = async () => {
    if (!previewData) return;
    if (window.confirm('This will overwrite/start the session in the cloud. Continue?')) {
      setLoading(true);
      try {
        await sessionService.uploadDailySession(previewData);
        await loadSession(); // Reload from DB
        setPreviewData(null);
        setFeedFile(null);
        alert('Session Started Successfully!');
      } catch (err) {
        console.error(err);
        alert('Failed to upload session: ' + (err as any).message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
        await generateSessionExport();
        setHasDownloaded(true);
    } catch (err) {
        alert("Export failed: " + err);
    } finally {
        setLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!currentSession) return;
    if (window.confirm("DANGER: This will delete today's session from the cloud. Are you sure?")) {
      setLoading(true);
      try {
        await sessionService.adminResetDailySession(currentSession.date);
        setCurrentSession(null);
        setHasDownloaded(false);
      } catch (err) {
        alert('Error: ' + err);
      } finally {
        setLoading(false);
      }
    }
  };

  // --- REPORT GENERATION HELPERS ---
  const generateManagerReport = (data: DailySessionData) => {
      return data.managers.map(m => {
          // 1. Count Workers
          const workerCount = data.workers.filter(w => w.assignedManagerId === m.userId).length;
          
          // 2. Count Routes
          const myRoutes = data.routes.filter(r => r.managerId === m.userId);
          const routeCount = myRoutes.length;
          
          // 3. Count Prebooks (Pending Jobs in those routes)
          const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));
          const prebookCount = data.pendingBookings.filter(b => b['Route Number'] && myRouteCodes.has(b['Route Number'])).length;

          return {
              name: m.name,
              workers: workerCount,
              routes: routeCount,
              prebooks: prebookCount
          };
      });
  };

  const activeReportData = useMemo(() => {
      if (previewData) return generateManagerReport(previewData);
      if (currentSession) return generateManagerReport(currentSession);
      return [];
  }, [previewData, currentSession]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto">
        
        {/* MINIMAL HEADER WITH TABS */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <Users className="text-cps-blue" size={20} />
            <span className="text-sm text-gray-400">
              {currentSession ? `Active: ${currentSession.date}` : "No Active Session"}
            </span>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-1 flex border border-gray-700">
            <button
              onClick={() => handleTabChange('lifecycle')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'lifecycle' ? 'bg-cps-blue text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              Session Cycle
            </button>
            <button
              onClick={() => handleTabChange('payout')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'payout' ? 'bg-green-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              Payout Today
            </button>
          </div>
        </div>

        {/* --- VIEW 1: SESSION CYCLE (Start -> Monitor -> End) --- */}
        {activeTab === 'lifecycle' && (
          <div className="space-y-8 animate-fade-in">
            
            {/* 1. UPLOAD SECTION (Only if no session) */}
            {!currentSession && (
                <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 shadow-lg text-center">
                    <div className="max-w-md mx-auto">
                        <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700">
                            <Upload className="text-cps-blue" size={32} />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Initialize New Session</h2>
                        <p className="text-gray-400 text-sm mb-6">Upload the daily Excel feed to generate assignments.</p>
                        
                        <div className="relative">
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <div className="bg-gray-900 border-2 border-dashed border-gray-600 hover:border-cps-blue rounded-lg p-4 transition-colors">
                                <span className="text-sm font-bold text-gray-300">
                                    {feedFile ? feedFile.name : "Click to Select File"}
                                </span>
                            </div>
                        </div>
                        {error && <div className="mt-4 text-red-400 text-sm bg-red-900/20 p-2 rounded border border-red-900/50">{error}</div>}
                        {loading && <div className="mt-4 text-blue-400 animate-pulse">Processing Feed...</div>}
                    </div>
                </div>
            )}

            {/* 2. REPORT SECTION (Preview OR Live) */}
            {(previewData || currentSession) && (
                <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden">
                    <div className="p-4 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <FileText size={20} className="text-green-400"/> 
                            {previewData ? "Session Preview Report" : "Live Session Report"}
                        </h3>
                        {previewData && <span className="text-xs bg-yellow-900/30 text-yellow-300 px-2 py-1 rounded border border-yellow-700/50">PREVIEW MODE</span>}
                        {currentSession && <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded border border-green-700/50">LIVE</span>}
                    </div>
                    
                    <div className="p-6">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-gray-400 text-sm border-b border-gray-700">
                                        <th className="py-3 font-medium">Route Manager</th>
                                        <th className="py-3 font-medium text-center">Workers</th>
                                        <th className="py-3 font-medium text-center">Routes</th>
                                        <th className="py-3 font-medium text-center">Pre-books</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-200">
                                    {activeReportData.map((manager, idx) => (
                                        <tr key={idx} className="border-b border-gray-800 hover:bg-gray-700/30 transition-colors">
                                            <td className="py-3 font-bold">{manager.name}</td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-blue-300 font-mono">{manager.workers}</span>
                                            </td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-purple-300 font-mono">{manager.routes}</span>
                                            </td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-yellow-300 font-mono">{manager.prebooks}</span>
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="bg-gray-900/30 font-bold">
                                        <td className="py-3 text-right pr-4 text-gray-400">TOTALS:</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.workers, 0)}</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.routes, 0)}</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.prebooks, 0)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* ACTION: START SESSION */}
                        {previewData && !currentSession && (
                            <div className="mt-8 flex justify-end">
                                <button 
                                    onClick={handleStartSession}
                                    disabled={loading}
                                    className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2 transform transition-all hover:scale-105"
                                >
                                    <Play size={20} fill="currentColor" /> Initialize Session
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 3. DOWNLOAD & CLOSE (Only Active Session) */}
            {currentSession && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-800">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col justify-between">
                        <div>
                            <h4 className="text-lg font-bold text-white mb-2">1. Download Data</h4>
                            <p className="text-sm text-gray-400 mb-4">Export all payouts, transactions, and logsheets for payroll.</p>
                        </div>
                        <button 
                            onClick={handleDownload}
                            className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                                hasDownloaded 
                                ? 'bg-green-900/30 text-green-400 border border-green-700' 
                                : 'bg-cps-blue hover:bg-blue-600 text-white'
                            }`}
                        >
                            <Download size={20} /> {hasDownloaded ? 'Download Again' : 'Download Session Data'}
                        </button>
                    </div>

                    <div className={`bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col justify-between transition-opacity ${!hasDownloaded ? 'opacity-50' : 'opacity-100'}`}>
                        <div>
                            <h4 className="text-lg font-bold text-white mb-2">2. Close Session</h4>
                            <p className="text-sm text-gray-400 mb-4">
                                {hasDownloaded 
                                    ? "Session data is secured. You may now close the session." 
                                    : "Requires data download before closing to prevent data loss."}
                            </p>
                        </div>
                        <button 
                            onClick={handleCloseSession}
                            disabled={!hasDownloaded}
                            className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                                hasDownloaded 
                                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer' 
                                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            {hasDownloaded ? <Unlock size={20} /> : <Lock size={20} />} 
                            Close & Wipe Session
                        </button>
                    </div>
                </div>
            )}

          </div>
        )}

        {/* --- VIEW 2: PAYOUT TODAY --- */}
        {activeTab === 'payout' && (
          <div className="space-y-4 animate-fade-in">
            {/* Search & Sort Controls */}
            <div className="flex flex-col sm:flex-row gap-3 bg-gray-800 p-3 rounded-lg border border-gray-700">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type="text"
                  placeholder="Search workers..."
                  value={payoutSearch}
                  onChange={(e) => setPayoutSearch(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-9 pr-4 text-sm text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 min-w-[180px]">
                <Filter className="text-gray-500" size={16} />
                <select
                  value={payoutSort}
                  onChange={(e) => setPayoutSort(e.target.value as SortOption)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-sm text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                >
                  <option value="standard">Standard (by RM)</option>
                  <option value="alpha">Alphabetical</option>
                  <option value="steps">Sort by Steps</option>
                  <option value="gross">Sort by Gross</option>
                  <option value="upsell">Sort by Upsells</option>
                  <option value="equiv">Sort by EQ</option>
                  <option value="commission">Sort by Payout</option>
                </select>
              </div>
            </div>

            {/* PayoutToday Component */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 min-h-[500px] flex flex-col overflow-hidden">
              {currentSession ? (
                <PayoutToday
                  consoleProfileId={1}
                  date={currentSession.date}
                  sortOption={payoutSort}
                  searchTerm={payoutSearch}
                  managers={currentSession.managers}
                  workers={currentSession.workers}
                />
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-500 p-10">
                  <AlertCircle size={48} className="mb-2 opacity-20" />
                  <p>No active session found.</p>
                  <p className="text-sm">
                    Upload a feed to start payout calculations.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionCommandCenter;