// src/pages/Admin/RouteFinderUpdater.tsx
import React, { useState } from 'react';
import {
  ArrowLeft, Navigation2, Loader, CheckCircle, AlertCircle, AlertTriangle, Play,
} from 'lucide-react';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { extractSheetId } from '../../lib/commandCenterService';
import {
  runRouteFinderUpdate, RouteFinderUpdateReport,
} from '../../lib/routeFinderUpdaterService';

interface Props {
  onBack: () => void;
}

const RouteFinderUpdater: React.FC<Props> = ({ onBack }) => {
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.isAuthenticated());
  const [connecting, setConnecting] = useState(false);

  const [masterUrl, setMasterUrl] = useState('');
  const [routeFinderUrl, setRouteFinderUrl] = useState('');
  const [startRow, setStartRow] = useState('2');
  const [endRow, setEndRow] = useState('');
  const [includeCityFyi, setIncludeCityFyi] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RouteFinderUpdateReport | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const ok = await googleSheetsService.authenticate();
      setIsGoogleConnected(ok);
      if (!ok) setError('Failed to connect to Google. Please try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Google.');
    } finally {
      setConnecting(false);
    }
  };

  const handleRun = async () => {
    setError(null);
    setReport(null);

    const masterId = extractSheetId(masterUrl);
    const rfId = extractSheetId(routeFinderUrl);
    const start = parseInt(startRow, 10);
    const end = parseInt(endRow, 10);

    if (!masterId) { setError('Master Bookings URL doesn’t look like a Google Sheet link.'); return; }
    if (!rfId) { setError('Route Finder URL doesn’t look like a Google Sheet link.'); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 2 || end < start) {
      setError('Start row must be 2 or more (row 1 is the header) and end row must be ≥ start.');
      return;
    }

    const token = googleSheetsService.getAccessToken();
    if (!token) { setError('Not connected to Google. Please connect first.'); return; }

    const confirmMsg = [
      'This will WRITE to your Master Bookings sheet.',
      '',
      `• Route Finder rows ${start}–${end} will be applied`,
      '• Matching rows on "Hamilton Callbooks" and "Bookings" will get the suggested route code + street',
      '• The previous value of every changed cell is kept as a note',
      '',
      'Continue?',
    ].join('\n');
    if (!window.confirm(confirmMsg)) return;

    setRunning(true);
    setProgress('Starting…');
    try {
      const result = await runRouteFinderUpdate({
        masterSheetId: masterId,
        routeFinderSheetId: rfId,
        startRow: start,
        endRow: end,
        accessToken: token,
        includeCityFyi,
        onProgress: (m) => setProgress(m),
      });
      setReport(result);
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setRunning(false);
    }
  };

  const totalChanged = report
    ? report.callbook.routeCodeCellsChanged + report.callbook.streetCellsChanged +
      report.bookings.routeCodeCellsChanged + report.bookings.streetCellsChanged
    : 0;

  const inputCls =
    'w-full bg-gray-900 border border-gray-600 rounded-lg py-2.5 px-3 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex items-center gap-2 ml-2">
            <Navigation2 size={20} className="text-amber-400" />
            <h1 className="text-lg font-bold">Route Finder Updater</h1>
          </div>
        </div>

        {/* Connect */}
        {!isGoogleConnected ? (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full mb-6 bg-white hover:bg-gray-100 text-gray-800 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
          >
            {connecting ? <Loader className="animate-spin" size={20} /> : <>Connect to Google</>}
          </button>
        ) : (
          <div className="mb-6 bg-green-900/20 border border-green-700/50 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={18} /> <span className="font-medium">Connected to Google</span>
          </div>
        )}

        {/* Inputs */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Master Bookings sheet URL</label>
            <input className={inputCls} value={masterUrl} onChange={(e) => setMasterUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Route Finder sheet URL</label>
            <input className={inputCls} value={routeFinderUrl} onChange={(e) => setRouteFinderUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Start row</label>
              <input type="number" min={2} className={inputCls} value={startRow}
                onChange={(e) => setStartRow(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">End row</label>
              <input type="number" min={2} className={inputCls} value={endRow}
                onChange={(e) => setEndRow(e.target.value)} placeholder="e.g. 500" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            Rows refer to the Route Finder sheet’s “Hamilton Callbooks” tab. Row 1 is the header, so the first record is row 2.
          </p>

          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 pt-1">
            <input type="checkbox" checked={includeCityFyi}
              onChange={(e) => setIncludeCityFyi(e.target.checked)}
              className="w-4 h-4 accent-amber-500" />
            List matched addresses that carry 2+ city labels (FYI only — still updated)
          </label>

          <button
            onClick={handleRun}
            disabled={running || !isGoogleConnected}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {running ? <><Loader className="animate-spin" size={20} /> {progress || 'Working…'}</>
                     : <><Play size={18} fill="currentColor" /> Run Update</>}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Report */}
        {report && (
          <div className="mt-6 bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <div className="flex items-center gap-2 text-green-400 font-bold">
              <CheckCircle size={18} /> Done — {totalChanged} cell{totalChanged === 1 ? '' : 's'} changed
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-900/60 rounded-lg p-3 border border-gray-700">
                <div className="text-gray-400 text-xs mb-1">Hamilton Callbooks</div>
                <div className="text-white">{report.callbook.rowsMatched} rows matched</div>
                <div className="text-gray-300 text-xs mt-1">
                  {report.callbook.routeCodeCellsChanged} route codes · {report.callbook.streetCellsChanged} streets
                </div>
              </div>
              <div className="bg-gray-900/60 rounded-lg p-3 border border-gray-700">
                <div className="text-gray-400 text-xs mb-1">Bookings</div>
                <div className="text-white">{report.bookings.rowsMatched} rows matched</div>
                <div className="text-gray-300 text-xs mt-1">
                  {report.bookings.routeCodeCellsChanged} route codes · {report.bookings.streetCellsChanged} streets
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-400 space-y-1">
              <div>Range rows read: {report.rangeRowsRead} · Addresses mapped: {report.addressesInMap}</div>
              {report.addressesUnmatched > 0 && (
                <div className="text-yellow-400">
                  {report.addressesUnmatched} mapped address{report.addressesUnmatched === 1 ? '' : 'es'} found no master row (drifted since the snapshot).
                </div>
              )}
            </div>

            {/* Skipped conflicts */}
            {report.skippedConflicts.length > 0 && (
              <div className="bg-yellow-900/15 border border-yellow-700/40 rounded-lg p-3">
                <div className="flex items-center gap-2 text-yellow-400 font-bold text-sm mb-2">
                  <AlertTriangle size={15} /> {report.skippedConflicts.length} address{report.skippedConflicts.length === 1 ? '' : 'es'} skipped (you left them ambiguous)
                </div>
                <div className="max-h-48 overflow-y-auto text-xs space-y-1">
                  {report.skippedConflicts.map((c, i) => (
                    <div key={i} className="text-yellow-200/90">
                      <span className="font-medium">{c.address}</span>
                      {c.suggestedRCs.length > 1 && <> — codes: {c.suggestedRCs.join(', ')}</>}
                      {c.suggestedStreets.length > 1 && <> — streets: {c.suggestedStreets.join(', ')}</>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* City FYI */}
            {report.cityFyi && report.cityFyi.length > 0 && (
              <div className="bg-blue-900/15 border border-blue-700/40 rounded-lg p-3">
                <div className="text-blue-300 font-bold text-sm mb-2">
                  {report.cityFyi.length} updated address{report.cityFyi.length === 1 ? '' : 'es'} carried 2+ city labels (spot-check)
                </div>
                <div className="max-h-48 overflow-y-auto text-xs space-y-1">
                  {report.cityFyi.map((c, i) => (
                    <div key={i} className="text-blue-200/90">
                      <span className="font-medium">{c.address}</span> — {c.cities.join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteFinderUpdater;
