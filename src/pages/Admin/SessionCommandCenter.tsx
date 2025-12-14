// src/pages/Admin/SessionCommandCenter.tsx
import React, { useState, useEffect } from 'react';
import {
  Upload,
  CheckCircle,
  AlertCircle,
  FileText,
  Users,
  Play,
  Trash2,
  RotateCcw,
  Search,
  Filter,
  Download,
} from 'lucide-react';
import { parseDailySessionXLSX } from '../../lib/feedParser';
import { sessionService } from '../../lib/sessionService';
import { generateSessionExport } from '../../lib/exportService';
import { DailySessionData, SortOption } from '../../types';
import PayoutToday from '../Management/PayoutToday';

const SessionCommandCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'create' | 'payout'>('create');

  // --- SESSION CREATION STATE ---
  const [feedFile, setFeedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<DailySessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<DailySessionData | null>(
    null
  );

  // --- PAYOUT STATE ---
  const [payoutSearch, setPayoutSearch] = useState('');
  const [payoutSort, setPayoutSort] = useState<SortOption>('steps');

  // Load active session on mount
  useEffect(() => {
    const loadSession = async () => {
      const session = await sessionService.getDailySession();
      setCurrentSession(session);
    };
    loadSession();
  }, []);

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
    if (
      window.confirm(
        'This will overwrite/start the session in the cloud. Continue?'
      )
    ) {
      setLoading(true);
      try {
        await sessionService.uploadDailySession(previewData);
        setCurrentSession(previewData);
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

  const handleClearSession = async () => {
    if (!currentSession) return;
    if (
      window.confirm(
        "DANGER: This will delete today's session from the cloud. Are you sure?"
      )
    ) {
      setLoading(true);
      try {
        await sessionService.adminResetDailySession(currentSession.date);
        setCurrentSession(null);
      } catch (err) {
        alert('Error: ' + err);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Users className="text-cps-blue" /> Session Command Center
            </h1>
            <p className="text-gray-400 mt-1">
              Daily Operations & Payout Management
            </p>
          </div>
          <div className="flex gap-4">
            {currentSession && (
              <button
                onClick={async () => {
                  setLoading(true);
                  await generateSessionExport();
                  setLoading(false);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-600 rounded-md hover:bg-gray-700 transition-colors text-green-400"
              >
                <Download size={18} /> Data Out
              </button>
            )}

            <div className="bg-gray-800 rounded-lg p-1 flex border border-gray-700">
              <button
                onClick={() => setActiveTab('create')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'create'
                    ? 'bg-cps-blue text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Session Creator
              </button>
              <button
                onClick={() => setActiveTab('payout')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'payout'
                    ? 'bg-green-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Payout Today
              </button>
            </div>
          </div>
        </div>

        {/* --- TAB 1: SESSION CREATION --- */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg relative">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Upload size={20} /> Upload Data Feed
                </h2>
              </div>

              <div className="p-8 bg-gray-900/50 rounded-lg border-2 border-dashed border-gray-600 hover:border-cps-blue transition-colors flex flex-col items-center justify-center text-center">
                <FileText size={48} className="text-gray-500 mb-4" />
                <label className="block mb-2 text-sm font-medium text-gray-300">
                  Upload 'Data Feed.xlsx'
                </label>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-400 cursor-pointer"
                />
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-900/30 text-red-300 text-sm rounded flex items-center gap-2">
                  <AlertCircle size={16} /> {error}
                </div>
              )}
              {loading && (
                <div className="mt-4 text-center text-blue-400 animate-pulse">
                  Processing...
                </div>
              )}

              {previewData && (
                <div className="mt-6">
                  <button
                    onClick={handleStartSession}
                    disabled={loading}
                    className="w-full py-4 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-transform transform hover:scale-105"
                  >
                    <Play size={24} fill="currentColor" /> Start Daily Session
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div
                className={`p-6 rounded-xl border ${
                  currentSession
                    ? 'bg-green-900/10 border-green-500/50'
                    : 'bg-gray-800 border-gray-700'
                }`}
              >
                <h3 className="text-sm font-bold text-gray-400 uppercase mb-2">
                  Active Session
                </h3>
                {currentSession ? (
                  <div>
                    <div className="text-2xl font-bold text-white flex items-center gap-2">
                      <CheckCircle className="text-green-500" /> Online
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Date:</span>{' '}
                        <span className="text-gray-200">
                          {currentSession.date}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Managers:</span>{' '}
                        <span className="text-gray-200">
                          {currentSession.managers.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Routes:</span>{' '}
                        <span className="text-gray-200">
                          {currentSession.routes.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Pending Jobs:</span>{' '}
                        <span className="text-gray-200">
                          {currentSession.pendingBookings.length}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleClearSession}
                      className="mt-4 w-full py-2 border border-red-500/30 text-red-400 hover:bg-red-900/20 rounded text-sm flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} /> Wipe Session Data
                    </button>
                  </div>
                ) : (
                  <div className="text-gray-500 italic py-4">
                    No active session. Upload feed to start.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 2: PAYOUT TODAY --- */}
        {activeTab === 'payout' && (
          <div className="space-y-6 animate-fade-in">
            {/* 2. FILTERS & SEARCH */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between bg-gray-800 p-4 rounded-lg border border-gray-700">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  size={18}
                />
                <input
                  type="text"
                  placeholder="Search workers..."
                  value={payoutSearch}
                  onChange={(e) => setPayoutSearch(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 min-w-[200px]">
                <Filter className="text-gray-500" size={18} />
                <select
                  value={payoutSort}
                  onChange={(e) => setPayoutSort(e.target.value as SortOption)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                >
                  <option value="steps">Sort by Steps</option>
                  <option value="gross">Sort by Gross</option>
                  <option value="upsell">Sort by Upsells</option>
                  <option value="equiv">Sort by EQ</option>
                  <option value="commission">Sort by Payout</option>
                  <option value="alpha">Alphabetical</option>
                </select>
              </div>
            </div>

            {/* 3. ACTUAL PAYOUT LIST COMPONENT */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 min-h-[500px] flex flex-col">
              <h3 className="text-lg font-bold text-white mb-4">
                Worker Payouts
              </h3>
              {currentSession ? (
                <PayoutToday
                  consoleProfileId={1}
                  date={currentSession.date}
                  sortOption={payoutSort}
                  searchTerm={payoutSearch}
                />
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
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
