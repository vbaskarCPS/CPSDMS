// src/pages/Admin/SessionCommandCenter.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload,
  AlertCircle,
  FileText,
  Users,
  Play,
  Search,
  Filter,
  Download,
  Lock,
  Unlock,
  Mail,
  CloudUpload,
  Loader,
  CheckCircle,
  Sheet,
} from 'lucide-react';
import { parseDailySessionXLSX } from '../../lib/feedParser';
import { sessionService } from '../../lib/sessionService';
import { generateSessionExport, exportToGoogleSheets } from '../../lib/exportService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { getDateTabError } from '../../lib/googleSheetsConfig';
import { DailySessionData, SortOption, LogsheetSession } from '../../types';
import PayoutToday from '../Management/PayoutToday';

type ImportMode = 'file' | 'sheets';

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
  const [logsheetSessions, setLogsheetSessions] = useState<LogsheetSession[]>([]);
  
  // End of Day State
  const [hasDownloaded, setHasDownloaded] = useState(false);
  
  // Email Settings
  const [emailEnabled, setEmailEnabled] = useState(true);

  // --- GOOGLE SHEETS STATE ---
  const [importMode, setImportMode] = useState<ImportMode>('file');
  const [dateTab, setDateTab] = useState('');
  const [dateTabError, setDateTabError] = useState<string | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsExportResult, setSheetsExportResult] = useState<{
    bookingsUpdated: number;
    accountsAppended: number;
    logsheetsAppended: number;
    statsAppended: number;
  } | null>(null);

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
    
    // Load logsheet sessions for validation check
    if (session) {
      const sessions = await sessionService.getLogsheetSessions();
      setLogsheetSessions(sessions);
    }
  };

  // Check payout completion status
  const payoutStatus = useMemo(() => {
    if (!logsheetSessions.length) {
      return { hasValidatedPayouts: false, hasBonuses: false, totalWorkers: 0, validatedWorkers: 0 };
    }

    const validatedCount = logsheetSessions.filter(s => s.validation?.isValidated).length;
    const bonusCount = logsheetSessions.filter(s => s.bonuses && s.bonuses.length > 0).length;

    return {
      hasValidatedPayouts: validatedCount > 0,
      hasBonuses: bonusCount > 0,
      totalWorkers: logsheetSessions.length,
      validatedWorkers: validatedCount
    };
  }, [logsheetSessions]);

  // --- FILE UPLOAD HANDLER ---
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

  // --- GOOGLE SHEETS HANDLERS ---
  const handleConnectGoogle = async () => {
    setSheetsLoading(true);
    setError(null);
    
    try {
      const connected = await googleSheetsService.authenticate();
      setIsGoogleConnected(connected);
      if (!connected) {
        setError('Failed to connect to Google. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to connect to Google.');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleDateTabChange = (value: string) => {
    setDateTab(value);
    setDateTabError(getDateTabError(value));
  };

  const handleImportFromSheets = async () => {
    const tabError = getDateTabError(dateTab);
    if (tabError) {
      setDateTabError(tabError);
      return;
    }

    setSheetsLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const data = await googleSheetsService.importSessionData(dateTab);
      setPreviewData(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to import from Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleExportToSheets = async () => {
    // Safety check: Warn if payouts aren't validated or no bonuses assigned
    if (!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) {
      const warnings: string[] = [];
      
      if (!payoutStatus.hasValidatedPayouts) {
        warnings.push(`⚠️ No payouts have been validated yet (${payoutStatus.validatedWorkers}/${payoutStatus.totalWorkers} workers complete)`);
      }
      
      if (!payoutStatus.hasBonuses) {
        warnings.push(`⚠️ No bonuses have been assigned yet`);
      }

      const warningMessage = [
        "Warning: Session data may be incomplete",
        "",
        ...warnings,
        "",
        "Exporting now may result in missing payout data.",
        "",
        "Are you sure you want to export to Google Sheets?"
      ].join("\n");

      if (!window.confirm(warningMessage)) {
        return;
      }
    }

    setSheetsLoading(true);
    setError(null);
    setSheetsExportResult(null);

    try {
      const result = await exportToGoogleSheets();
      setSheetsExportResult(result);
      setHasDownloaded(true); // Allow closing session after sheets export too
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to export to Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  };

  // --- SESSION HANDLERS ---
  const handleStartSession = async () => {
    if (!previewData) return;
    if (window.confirm('This will overwrite/start the session in the cloud. Continue?')) {
      setLoading(true);
      try {
        await sessionService.uploadDailySession(previewData, emailEnabled);
        await loadSession(); // Reload from DB
        setPreviewData(null);
        setFeedFile(null);
        setDateTab('');
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
    // Safety check: Warn if payouts aren't validated or no bonuses assigned
    if (!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) {
      const warnings: string[] = [];
      
      if (!payoutStatus.hasValidatedPayouts) {
        warnings.push(`⚠️ No payouts have been validated yet (${payoutStatus.validatedWorkers}/${payoutStatus.totalWorkers} workers complete)`);
      }
      
      if (!payoutStatus.hasBonuses) {
        warnings.push(`⚠️ No bonuses have been assigned yet`);
      }

      const warningMessage = [
        "Warning: Session data may be incomplete",
        "",
        ...warnings,
        "",
        "Downloading now may result in missing payout data in the export.",
        "",
        "Are you sure you want to download?"
      ].join("\n");

      if (!window.confirm(warningMessage)) {
        return;
      }
    }

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
        setSheetsExportResult(null);
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
          const workerCount = data.workers.filter(w => w.assignedManagerId === m.userId).length;
          const myRoutes = data.routes.filter(r => r.managerId === m.userId);
          const routeCount = myRoutes.length;
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
                <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 shadow-lg">
                    <div className="max-w-lg mx-auto">
                        <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700">
                            <Upload className="text-cps-blue" size={32} />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2 text-center">Initialize New Session</h2>
                        <p className="text-gray-400 text-sm mb-6 text-center">Upload a file or import from Google Sheets to generate assignments.</p>
                        
                        {/* Import Mode Toggle */}
                        <div className="flex bg-gray-900 rounded-lg p-1 mb-6 border border-gray-700">
                          <button
                            onClick={() => { setImportMode('file'); setError(null); setPreviewData(null); }}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                              importMode === 'file' ? 'bg-cps-blue text-white shadow' : 'text-gray-400 hover:text-white'
                            }`}
                          >
                            <FileText size={16} /> Upload File
                          </button>
                          <button
                            onClick={() => { setImportMode('sheets'); setError(null); setPreviewData(null); setFeedFile(null); }}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                              importMode === 'sheets' ? 'bg-green-600 text-white shadow' : 'text-gray-400 hover:text-white'
                            }`}
                          >
                            <Sheet size={16} /> Google Sheets
                          </button>
                        </div>

                        {/* FILE UPLOAD MODE */}
                        {importMode === 'file' && (
                          <div className="relative">
                              <input
                                  type="file"
                                  accept=".xlsx, .xls"
                                  onChange={handleFileChange}
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div className="bg-gray-900 border-2 border-dashed border-gray-600 hover:border-cps-blue rounded-lg p-4 transition-colors text-center">
                                  <span className="text-sm font-bold text-gray-300">
                                      {feedFile ? feedFile.name : "Click to Select File"}
                                  </span>
                              </div>
                          </div>
                        )}

                        {/* GOOGLE SHEETS MODE */}
                        {importMode === 'sheets' && (
                          <div className="space-y-4">
                            {/* Connection Status */}
                            {!isGoogleConnected ? (
                              <button
                                onClick={handleConnectGoogle}
                                disabled={sheetsLoading}
                                className="w-full bg-white hover:bg-gray-100 text-gray-800 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
                              >
                                {sheetsLoading ? (
                                  <Loader className="animate-spin" size={20} />
                                ) : (
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
                            ) : (
                              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 flex items-center gap-2 text-green-400">
                                <CheckCircle size={18} />
                                <span className="text-sm font-medium">Connected to Google</span>
                              </div>
                            )}

                            {/* Date Tab Input */}
                            {isGoogleConnected && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Worker Tab Name (e.g., Feb01, Mar15)
                                  </label>
                                  <input
                                    type="text"
                                    value={dateTab}
                                    onChange={(e) => handleDateTabChange(e.target.value)}
                                    placeholder="Feb01"
                                    className={`w-full bg-gray-900 border rounded-lg py-3 px-4 text-white focus:ring-2 focus:outline-none ${
                                      dateTabError ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-cps-blue'
                                    }`}
                                  />
                                  {dateTabError && (
                                    <p className="text-red-400 text-xs mt-1">{dateTabError}</p>
                                  )}
                                </div>

                                <button
                                  onClick={handleImportFromSheets}
                                  disabled={sheetsLoading || !dateTab || !!dateTabError}
                                  className="w-full bg-green-600 hover:bg-green-500 text-white py-3 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {sheetsLoading ? (
                                    <Loader className="animate-spin" size={20} />
                                  ) : (
                                    <>
                                      <CloudUpload size={20} /> Import from Google Sheets
                                    </>
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {error && <div className="mt-4 text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{error}</div>}
                        {loading && <div className="mt-4 text-blue-400 animate-pulse text-center">Processing Feed...</div>}
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
                        {currentSession && !previewData && <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded border border-green-700/50">LIVE</span>}
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

                        {/* EMAIL TOGGLE + START SESSION */}
                        {previewData && !currentSession && (
                            <div className="mt-8 space-y-4">
                                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                                  <label className="flex items-start gap-3 cursor-pointer group">
                                    <input 
                                      type="checkbox" 
                                      checked={emailEnabled}
                                      onChange={(e) => setEmailEnabled(e.target.checked)}
                                      className="w-5 h-5 mt-0.5 accent-blue-500 cursor-pointer flex-shrink-0"
                                    />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 text-white font-medium mb-1">
                                        <Mail size={16} className={emailEnabled ? 'text-green-400' : 'text-gray-500'} />
                                        <span>Send Receipt Emails</span>
                                      </div>
                                      <p className="text-xs text-gray-400 leading-relaxed">
                                        Automatically email receipts to customers when jobs are completed during this session.
                                        {!emailEnabled && ' (Currently disabled - no emails will be sent)'}
                                      </p>
                                    </div>
                                  </label>
                                </div>

                                <div className="flex justify-end">
                                    <button 
                                        onClick={handleStartSession}
                                        disabled={loading}
                                        className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2 transform transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Play size={20} fill="currentColor" /> Initialize Session
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 3. DOWNLOAD & EXPORT & CLOSE (Only Active Session) */}
            {currentSession && (
                <div className="space-y-6 pt-4 border-t border-gray-800">
                    {/* Export Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Download Excel */}
                        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col justify-between">
                            <div>
                                <h4 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                                  <Download size={20} className="text-cps-blue" />
                                  Download Excel
                                </h4>
                                <p className="text-sm text-gray-400 mb-2">Export all payouts, transactions, and logsheets as an Excel file.</p>
                                
                                {(!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) && (
                                  <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3 mb-4 text-xs space-y-1">
                                    <div className="flex items-center gap-2 text-yellow-400 font-bold mb-1">
                                      <AlertCircle size={14} />
                                      <span>Incomplete Payout Data</span>
                                    </div>
                                    {!payoutStatus.hasValidatedPayouts && (
                                      <div className="text-yellow-300">
                                        • No validated payouts ({payoutStatus.validatedWorkers}/{payoutStatus.totalWorkers} workers complete)
                                      </div>
                                    )}
                                    {!payoutStatus.hasBonuses && (
                                      <div className="text-yellow-300">
                                        • No bonuses have been assigned yet
                                      </div>
                                    )}
                                  </div>
                                )}
                            </div>
                            <button 
                                onClick={handleDownload}
                                disabled={loading}
                                className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                                    hasDownloaded 
                                    ? 'bg-green-900/30 text-green-400 border border-green-700' 
                                    : 'bg-cps-blue hover:bg-blue-600 text-white'
                                }`}
                            >
                                {loading ? <Loader className="animate-spin" size={20} /> : <Download size={20} />}
                                {hasDownloaded ? 'Download Again' : 'Download Excel'}
                            </button>
                        </div>

                        {/* Export to Google Sheets */}
                        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col justify-between">
                            <div>
                                <h4 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                                  <Sheet size={20} className="text-green-400" />
                                  Export to Google Sheets
                                </h4>
                                <p className="text-sm text-gray-400 mb-2">Push data directly to Masterbookings and Workerbook sheets.</p>
                                
                                {sheetsExportResult && (
                                  <div className="bg-green-900/20 border border-green-700/50 rounded p-3 mb-4 text-xs space-y-1">
                                    <div className="flex items-center gap-2 text-green-400 font-bold mb-1">
                                      <CheckCircle size={14} />
                                      <span>Export Complete</span>
                                    </div>
                                    <div className="text-green-300">• {sheetsExportResult.bookingsUpdated} bookings updated</div>
                                    <div className="text-green-300">• {sheetsExportResult.accountsAppended} accounts added</div>
                                    <div className="text-green-300">• {sheetsExportResult.logsheetsAppended} logsheets added</div>
                                    <div className="text-green-300">• {sheetsExportResult.statsAppended} payout stats added</div>
                                  </div>
                                )}
                            </div>
                            <button 
                                onClick={handleExportToSheets}
                                disabled={sheetsLoading}
                                className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                                    sheetsExportResult 
                                    ? 'bg-green-900/30 text-green-400 border border-green-700' 
                                    : 'bg-green-600 hover:bg-green-500 text-white'
                                }`}
                            >
                                {sheetsLoading ? <Loader className="animate-spin" size={20} /> : <CloudUpload size={20} />}
                                {sheetsExportResult ? 'Export Again' : 'Export to Sheets'}
                            </button>
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                      <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-red-400 text-sm">
                        {error}
                      </div>
                    )}

                    {/* Close Session */}
                    <div className={`bg-gray-800 p-6 rounded-xl border border-gray-700 transition-opacity ${!hasDownloaded ? 'opacity-50' : 'opacity-100'}`}>
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h4 className="text-lg font-bold text-white mb-1">Close Session</h4>
                                <p className="text-sm text-gray-400">
                                    {hasDownloaded 
                                        ? "Session data is secured. You may now close the session." 
                                        : "Requires data download or export before closing to prevent data loss."}
                                </p>
                            </div>
                            <button 
                                onClick={handleCloseSession}
                                disabled={!hasDownloaded}
                                className={`py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
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
                </div>
            )}

          </div>
        )}

        {/* --- VIEW 2: PAYOUT TODAY --- */}
        {activeTab === 'payout' && (
          <div className="space-y-4 animate-fade-in">
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
                  <option value="upGross">Sort by Up Gross</option>
                  <option value="upsell">Sort by Upsells</option>
                  <option value="equiv">Sort by EQ</option>
                  <option value="commission">Sort by Payout</option>
                </select>
              </div>
            </div>

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