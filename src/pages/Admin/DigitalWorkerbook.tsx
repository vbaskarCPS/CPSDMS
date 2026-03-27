// src/pages/Admin/DigitalWorkerbook.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader,
  AlertCircle,
  CheckCircle,
  Mail,
  Phone,
  Calendar,
  RefreshCw,
  Settings,
  Send,
  X,
  CloudUpload,
} from 'lucide-react';
import { dialerSheetsService } from '../../lib/dialerSheetsService';
import { commandCenterService } from '../../lib/commandCenterService';
import { onboardingService, ShuttlePoint } from '../../lib/onboardingService';
import {
  WorkerbookEmailTemplate,
  WorkerbookConfirmation,
  loadWorkerbookTemplates,
  getEmailedTodaySet,
  cleanOldWorkerbookEmailLogs,
  sendWorkerbookEmail,
  getConfirmationsForDateTab,
  markConfirmationSynced,
} from '../../lib/workerbookEmailService';
import WorkerbookEmailService from './WorkerbookEmailService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface WBContractor {
  rowNum: number;
  shuttle: string;
  cnId: string;
  firstName: string;
  lastName: string;
  cellPhone: string;
  altPhone: string;
  email: string;
  manager: string;
  team: string;
  confirmed: boolean;
  showed: boolean;
  nextDay: string;
  days: number;
  ns: number;
  notes: string;
}

type DotColor = 'green' | 'silver' | 'gold' | null;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const DATED_TAB_RE = /^[A-Z][a-z]{2}\d{2}$/;

function getTodayTabName(): string {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]}${String(d.getDate()).padStart(2, '0')}`;
}

function toMmmDD(dateInput: string): string {
  const [year, month, day] = dateInput.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]}${String(d.getDate()).padStart(2, '0')}`;
}

function parseContractors(rows: any[][]): WBContractor[] {
  return rows
    .map((row, idx) => ({
      rowNum:    idx + 3,
      shuttle:   String(row[0]  ?? '').trim(),
      cnId:      String(row[1]  ?? '').trim(),
      firstName: String(row[2]  ?? '').trim(),
      lastName:  String(row[3]  ?? '').trim(),
      cellPhone: String(row[4]  ?? '').trim(),
      altPhone:  String(row[16] ?? '').trim(),
      email:     String(row[17] ?? '').trim(),
      manager:   String(row[7]  ?? '').trim(),
      team:      String(row[8]  ?? '').trim(),
      // confirmed = true if col J already has an x loaded from the sheet
      confirmed: String(row[9]  ?? '').trim().toLowerCase() === 'x',
      showed:    String(row[10] ?? '').trim().toLowerCase() === 'x',
      nextDay:   String(row[11] ?? '').trim(),
      days:      parseInt(String(row[14] ?? '0'), 10) || 0,
      ns:        parseInt(String(row[15] ?? '0'), 10) || 0,
      notes:     String(row[18] ?? '').trim(),
    }))
    .filter(c => c.cnId);
}

// ─── CONFIRM BUTTON ───────────────────────────────────────────────────────────
// States:
//   unconfirmed         → solid blue  "Confirm"
//   confirmed (manual)  → solid green "Confirmed"
//   confirmed (email)   → solid green "Confirmed" + gold ring
//   confirmed (both)    → solid green "Confirmed" + gold ring

interface ConfirmButtonProps {
  confirmed: boolean;         // from sheet col J or manual click
  emailConfirmed: boolean;    // from Supabase email confirmation
  loading: boolean;
  onClick: () => void;
}

const ConfirmButton: React.FC<ConfirmButtonProps> = ({ confirmed, emailConfirmed, loading, onClick }) => {
  const isConfirmed = confirmed || emailConfirmed;
  const hasGold     = emailConfirmed;

  if (loading) {
    return (
      <button
        disabled
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-700 text-gray-400 cursor-not-allowed"
      >
        <Loader size={12} className="animate-spin" />
        Confirming…
      </button>
    );
  }

  if (isConfirmed) {
    return (
      <button
        onClick={onClick}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
          bg-green-600 text-white hover:bg-green-500
          ${hasGold ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-gray-800' : ''}`}
      >
        <CheckCircle size={12} />
        Confirmed{hasGold ? ' ✉️' : ''}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-blue-600 text-white hover:bg-blue-500"
    >
      Confirm
    </button>
  );
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

const DigitalWorkerbook: React.FC<Props> = ({ onBack }) => {
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());

  const [isConnected, setIsConnected]   = useState(() => dialerSheetsService.isAuthenticated());
  const [connecting, setConnecting]     = useState(false);

  const [allTabs, setAllTabs]           = useState<string[]>([]);
  const [tabIndex, setTabIndex]         = useState(0);
  const selectedTab                     = allTabs[tabIndex] ?? '';

  const [contractors, setContractors]   = useState<WBContractor[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const [shuttlePoints, setShuttlePoints] = useState<ShuttlePoint[]>([]);

  const [emailedToday, setEmailedToday] = useState<Set<string>>(new Set());
  const [templates, setTemplates]       = useState<{ regular: WorkerbookEmailTemplate; rookie: WorkerbookEmailTemplate } | null>(null);
  const [sendingFor, setSendingFor]     = useState<string | null>(null);
  const [sendingAll, setSendingAll]     = useState(false);
  const [emailError, setEmailError]     = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [confirmations, setConfirmations]   = useState<WorkerbookConfirmation[]>([]);
  const [syncingConfirm, setSyncingConfirm] = useState(false);
  const [syncResult, setSyncResult]         = useState<string | null>(null);

  const [cellColors, setCellColors]         = useState<Map<number, DotColor>>(new Map());
  const [loadingColors, setLoadingColors]   = useState(false);

  const [showEmailService, setShowEmailService] = useState(false);
  const [moveTarget, setMoveTarget]             = useState<WBContractor | null>(null);
  const [moveToDate, setMoveToDate]             = useState('');
  const [movingTo, setMovingTo]                 = useState(false);
  const [confirmingFor, setConfirmingFor]       = useState<string | null>(null);

  // ─── INIT ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    onboardingService.getShuttlePoints().then(setShuttlePoints).catch(() => {});
    getEmailedTodaySet().then(setEmailedToday).catch(() => {});
    loadWorkerbookTemplates().then(setTemplates).catch(() => {});
    cleanOldWorkerbookEmailLogs().catch(() => {});
  }, []);

  useEffect(() => {
    if (!showEmailService) {
      loadWorkerbookTemplates().then(setTemplates).catch(() => {});
    }
  }, [showEmailService]);

  useEffect(() => {
    if (isConnected) loadDateTabs();
  }, [isConnected]);

  useEffect(() => {
    if (selectedTab && isConnected) {
      loadContractors();
      setCellColors(new Map());
    }
  }, [selectedTab, isConnected]);

  useEffect(() => {
    if (selectedTab && currentCC) loadConfirmations();
  }, [selectedTab, currentCC]);

  // ─── DATA LOADING ──────────────────────────────────────────────────────────

  const loadDateTabs = useCallback(async () => {
    if (!currentCC) return;
    setError(null);
    try {
      const tabs = await dialerSheetsService.getSheetTabs(currentCC.workerbookSheetId);
      const dated = tabs.map(t => t.title).filter(t => DATED_TAB_RE.test(t));
      setAllTabs(dated);
      const todayIdx = dated.indexOf(getTodayTabName());
      setTabIndex(todayIdx >= 0 ? todayIdx : Math.max(0, dated.length - 1));
    } catch (err: any) {
      setError(err.message || 'Failed to load tabs');
    }
  }, [currentCC]);

  const loadContractors = useCallback(async () => {
    if (!currentCC || !selectedTab) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await dialerSheetsService.sheetsGet(
        currentCC.workerbookSheetId,
        `'${selectedTab}'!A3:S200`,
      );
      setContractors(parseContractors(rows));
    } catch (err: any) {
      setError(err.message || 'Failed to load contractor data');
    } finally {
      setLoading(false);
    }
  }, [currentCC, selectedTab]);

  const loadConfirmations = useCallback(async () => {
    if (!currentCC || !selectedTab) return;
    try {
      const data = await getConfirmationsForDateTab(currentCC.id, selectedTab);
      setConfirmations(data);
    } catch {
      // non-fatal
    }
  }, [currentCC, selectedTab]);

  // ─── GOOGLE CONNECT ────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const ok = await dialerSheetsService.authenticate();
      setIsConnected(ok);
      if (!ok) setError('Failed to connect to Google. Please try again.');
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  // ─── CONFIRM (button click) ────────────────────────────────────────────────

  const handleToggleConfirm = async (c: WBContractor) => {
    if (!currentCC) return;
    setConfirmingFor(c.cnId);
    // If already confirmed (any source), clicking toggles off only the sheet x
    const newVal = c.confirmed ? '' : 'x';
    try {
      await dialerSheetsService.sheetsUpdate(
        currentCC.workerbookSheetId,
        `'${selectedTab}'!J${c.rowNum}`,
        [[newVal]],
      );
      setContractors(prev =>
        prev.map(p => p.rowNum === c.rowNum ? { ...p, confirmed: !c.confirmed } : p),
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update confirm');
    } finally {
      setConfirmingFor(null);
    }
  };

  // ─── SYNC EMAIL CONFIRMATIONS → SHEETS ────────────────────────────────────

  const handleSyncConfirmations = async () => {
    if (!currentCC || !selectedTab) return;
    const unsynced = confirmations.filter(c => !c.syncedToSheets);
    if (!unsynced.length) return;

    setSyncingConfirm(true);
    setSyncResult(null);
    setError(null);

    try {
      const cnColumn = await dialerSheetsService.sheetsGet(
        currentCC.workerbookSheetId,
        `'${selectedTab}'!B3:B200`,
      );

      const cnRowMap = new Map<string, number>();
      cnColumn.forEach((row, idx) => {
        const cn = String(row[0] ?? '').trim();
        if (cn) cnRowMap.set(cn, idx + 3);
      });

      let synced = 0;
      let notFound = 0;

      for (const confirmation of unsynced) {
        const rowNum = cnRowMap.get(confirmation.contractorId);
        if (!rowNum) { notFound++; continue; }

        await dialerSheetsService.sheetsUpdate(
          currentCC.workerbookSheetId,
          `'${selectedTab}'!J${rowNum}`,
          [['x']],
        );
        await markConfirmationSynced(confirmation.id);
        setContractors(prev =>
          prev.map(p => p.rowNum === rowNum ? { ...p, confirmed: true } : p),
        );
        synced++;
      }

      await loadConfirmations();
      const parts = [`${synced} confirmation${synced !== 1 ? 's' : ''} synced to Sheets`];
      if (notFound > 0) parts.push(`${notFound} not found in current tab`);
      setSyncResult(parts.join(' · '));
      setTimeout(() => setSyncResult(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to sync confirmations');
    } finally {
      setSyncingConfirm(false);
    }
  };

  // ─── MOVE TO ───────────────────────────────────────────────────────────────

  const handleMoveTo = async () => {
    if (!currentCC || !moveTarget || !moveToDate) return;
    setMovingTo(true);
    const mmmdd = toMmmDD(moveToDate);
    try {
      await dialerSheetsService.sheetsUpdate(
        currentCC.workerbookSheetId,
        `'${selectedTab}'!L${moveTarget.rowNum}`,
        [[mmmdd]],
      );
      setContractors(prev =>
        prev.map(p => p.rowNum === moveTarget.rowNum ? { ...p, nextDay: mmmdd } : p),
      );
      setMoveTarget(null);
      setMoveToDate('');
    } catch (err: any) {
      setError(err.message || 'Failed to move contractor');
    } finally {
      setMovingTo(false);
    }
  };

  // ─── EMAIL ─────────────────────────────────────────────────────────────────

  const getShuttlePoint = (shuttle: string): ShuttlePoint | null =>
    shuttlePoints.find(p => p.shuttleNumber === shuttle) ?? null;

  const buildEmailData = (c: WBContractor, isRookie: boolean) => ({
    contractorId:      c.cnId,
    firstName:         c.firstName,
    lastName:          c.lastName,
    email:             c.email,
    date:              selectedTab,
    shuttle:           c.shuttle || undefined,
    days:              c.days,
    isRookie,
    commandCenterId:   currentCC?.id ?? '',
    commandCenterName: currentCC?.displayName ?? 'Property Stars',
  });

  const sendToContractor = async (c: WBContractor): Promise<boolean> => {
    if (!templates || !c.email) return false;
    const isRookie = c.days === 0;
    const template = isRookie ? templates.rookie : templates.regular;
    const result = await sendWorkerbookEmail(
      buildEmailData(c, isRookie),
      template,
      getShuttlePoint(c.shuttle),
    );
    if (result.success) {
      setEmailedToday(prev => new Set([...prev, c.email.toLowerCase()]));
      return true;
    }
    return false;
  };

  const handleSendEmail = async (c: WBContractor) => {
    if (!c.email) return;
    setSendingFor(c.cnId);
    setEmailError(null);
    const ok = await sendToContractor(c);
    if (ok) {
      setEmailSuccess(`Email sent to ${c.firstName}!`);
      setTimeout(() => setEmailSuccess(null), 3000);
    } else {
      setEmailError(`Failed to email ${c.firstName}.`);
    }
    setSendingFor(null);
  };

  const handleEmailAll = async () => {
    const toSend = contractors.filter(
      c => c.email && !emailedToday.has(c.email.toLowerCase()),
    );
    if (!toSend.length) return;
    setSendingAll(true);
    setEmailError(null);
    let sent = 0; let failed = 0;
    for (const c of toSend) { (await sendToContractor(c)) ? sent++ : failed++; }
    setSendingAll(false);
    failed === 0
      ? setEmailSuccess(`All ${sent} emails sent!`)
      : setEmailError(`${sent} sent, ${failed} failed.`);
    setTimeout(() => { setEmailSuccess(null); setEmailError(null); }, 5000);
  };

  // ─── COLORS ────────────────────────────────────────────────────────────────

  const handleRefreshColors = async () => {
    if (!currentCC || !selectedTab || !contractors.length) return;
    setLoadingColors(true);
    try {
      const colors = await dialerSheetsService.getColumnBackgroundColors(
        currentCC.workerbookSheetId, selectedTab, 3, 3 + contractors.length - 1, 'B',
      );
      const map = new Map<number, DotColor>();
      contractors.forEach((c, idx) => map.set(c.rowNum, colors[idx] ?? null));
      setCellColors(map);
    } catch (err: any) {
      setError(err.message || 'Failed to load colors');
    } finally {
      setLoadingColors(false);
    }
  };

  // ─── EMAIL SERVICE ─────────────────────────────────────────────────────────

  if (showEmailService) {
    return <WorkerbookEmailService onBack={() => setShowEmailService(false)} />;
  }

  // ─── AUTH SCREEN ───────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold">Digital Workerbook</h1>
        </div>
        <div className="flex items-center justify-center min-h-[80vh]">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-10 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700">
              <svg width="32" height="32" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">Connect to Google</h2>
            <p className="text-gray-400 text-sm mb-6">Sign in to load the live Workerbook data from Google Sheets.</p>
            {error && <p className="text-red-400 text-sm mb-4 bg-red-900/20 p-2 rounded">{error}</p>}
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-white hover:bg-gray-100 text-gray-800 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
            >
              {connecting ? <Loader className="animate-spin" size={20} /> : (
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              {connecting ? 'Connecting…' : 'Connect to Google'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── DERIVED STATE ─────────────────────────────────────────────────────────

  const emailConfirmedIds  = new Set(confirmations.map(c => c.contractorId));
  const unsyncedCount      = confirmations.filter(c => !c.syncedToSheets).length;
  const pendingEmailCount  = contractors.filter(
    c => c.email && !emailedToday.has(c.email.toLowerCase()),
  ).length;

  const dotClass: Record<string, string> = {
    green:  'bg-green-400',
    silver: 'bg-gray-400',
    gold:   'bg-yellow-400',
  };

  // ─── MAIN VIEW ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* ── Header ── */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-1 bg-gray-900 rounded-lg border border-gray-700 px-1">
                <button
                  onClick={() => setTabIndex(i => Math.max(0, i - 1))}
                  disabled={tabIndex === 0}
                  className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-3 py-1 text-sm font-bold text-white min-w-[60px] text-center">
                  {selectedTab || '—'}
                </span>
                <button
                  onClick={() => setTabIndex(i => Math.min(allTabs.length - 1, i + 1))}
                  disabled={tabIndex >= allTabs.length - 1}
                  className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              {contractors.length > 0 && (
                <span className="text-xs text-gray-500">{contractors.length} contractors</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleRefreshColors}
                disabled={loadingColors || !contractors.length}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingColors ? 'animate-spin' : ''} />
                Colors
              </button>
              <button
                onClick={() => setShowEmailService(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors"
              >
                <Settings size={14} />
                Email Service
              </button>
              {unsyncedCount > 0 && (
                <button
                  onClick={handleSyncConfirmations}
                  disabled={syncingConfirm}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {syncingConfirm ? <Loader size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                  Sync Confirmations ({unsyncedCount})
                </button>
              )}
              <button
                onClick={handleEmailAll}
                disabled={sendingAll || pendingEmailCount === 0 || !templates}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                {sendingAll ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                Email All {pendingEmailCount > 0 ? `(${pendingEmailCount})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Alerts ── */}
      <div className="max-w-7xl mx-auto px-4 mt-3 space-y-2">
        {syncResult && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} /> {syncResult}
          </div>
        )}
        {emailSuccess && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} /> {emailSuccess}
          </div>
        )}
        {(error || emailError) && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error || emailError}
            <button onClick={() => { setError(null); setEmailError(null); }} className="ml-auto">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Cards ── */}
      <div className="max-w-7xl mx-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-blue-400" size={32} />
          </div>
        ) : contractors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <AlertCircle size={48} className="mb-3 opacity-20" />
            <p className="font-medium">No contractors on {selectedTab || 'this date'}</p>
            <p className="text-sm mt-1">This tab may be empty or not yet populated.</p>
          </div>
        ) : (
          // 2-column grid, full width cards
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {contractors.map(c => {
              const dotColor       = cellColors.get(c.rowNum) ?? null;
              const shuttlePt      = getShuttlePoint(c.shuttle);
              const isEmailed      = !!(c.email && emailedToday.has(c.email.toLowerCase()));
              const isRookie       = c.days === 0;
              const isSending      = sendingFor === c.cnId;
              const isConfirming   = confirmingFor === c.cnId;
              const emailConfirmed = emailConfirmedIds.has(c.cnId);
              const isConfirmed    = c.confirmed || emailConfirmed;

              return (
                <div
                  key={c.rowNum}
                  className={`bg-gray-800 rounded-xl border p-4 transition-colors ${
                    isConfirmed ? 'border-green-700/50' : 'border-gray-700'
                  }`}
                >
                  {/* ── LINE 1: Dot · CN# · Rookie badge · Name · Email button ── */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {dotColor && (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass[dotColor]}`} />
                      )}
                      <span className="text-[11px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                        {c.cnId}
                      </span>
                      {isRookie && (
                        <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/50 flex-shrink-0">
                          ROOKIE
                        </span>
                      )}
                      <span className="font-bold text-white text-sm truncate">
                        {c.firstName} {c.lastName}
                      </span>
                    </div>

                    {/* Email send button */}
                    {c.email ? (
                      <button
                        onClick={() => handleSendEmail(c)}
                        disabled={isSending || sendingAll}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 disabled:opacity-50 ${
                          isEmailed
                            ? 'bg-green-900/30 text-green-400 border border-green-700/50 hover:bg-green-900/50'
                            : 'bg-blue-900/30 text-blue-400 border border-blue-700/50 hover:bg-blue-900/50'
                        }`}
                      >
                        {isSending
                          ? <Loader size={11} className="animate-spin" />
                          : isEmailed
                            ? <CheckCircle size={11} />
                            : <Mail size={11} />
                        }
                        {isEmailed ? 'Sent' : 'Email'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-600 flex-shrink-0">No email</span>
                    )}
                  </div>

                  {/* ── LINE 2: Confirm btn · Phone · Alt phone · Move To ── */}
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <ConfirmButton
                      confirmed={c.confirmed}
                      emailConfirmed={emailConfirmed}
                      loading={isConfirming}
                      onClick={() => handleToggleConfirm(c)}
                    />

                    {c.cellPhone && (
                      <a
                        href={`tel:${c.cellPhone}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <Phone size={11} />
                        {c.cellPhone}
                      </a>
                    )}

                    {c.altPhone && (
                      <a
                        href={`tel:${c.altPhone}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-blue-300 transition-colors"
                      >
                        <Phone size={11} className="text-gray-600" />
                        {c.altPhone}
                        <span className="text-gray-600">Alt</span>
                      </a>
                    )}

                    <button
                      onClick={() => { setMoveTarget(c); setMoveToDate(''); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      <Calendar size={11} />
                      {c.nextDay || 'Move To'}
                    </button>
                  </div>

                  {/* ── LINE 3: Email address · Days · NS · Team · Shuttle ── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 transition-colors min-w-0 flex-1"
                      >
                        <Mail size={10} className="flex-shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </a>
                    )}

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-[11px] px-2 py-0.5 rounded ${
                        isRookie
                          ? 'bg-purple-900/30 text-purple-300 border border-purple-700/40'
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        Days: {c.days}
                      </span>
                      {c.ns > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-700/40">
                          NS: {c.ns}
                        </span>
                      )}
                      {c.team && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-400">
                          {c.team}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Shuttle (only if present) ── */}
                  {c.shuttle && (
                    <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                      shuttlePt
                        ? 'bg-blue-900/20 border border-blue-700/40 text-blue-300'
                        : 'bg-gray-900 border border-gray-700 text-gray-500'
                    }`}>
                      🚐{' '}
                      {shuttlePt
                        ? <>
                            <strong>{shuttlePt.description}</strong>
                            {shuttlePt.pickupTime && ` · ${shuttlePt.pickupTime}`}
                          </>
                        : `Shuttle #${c.shuttle} — not configured`
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Move To Modal ── */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-sm">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white">Move to Next Day</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {moveTarget.firstName} {moveTarget.lastName} · {moveTarget.cnId}
                </p>
              </div>
              <button onClick={() => setMoveTarget(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {moveTarget.nextDay && (
                <div className="text-xs text-gray-400 bg-gray-900 rounded p-2">
                  Currently: <strong className="text-white">{moveTarget.nextDay}</strong>
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Select date</label>
                <input
                  type="date"
                  value={moveToDate}
                  onChange={e => setMoveToDate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                />
                {moveToDate && (
                  <p className="text-xs text-blue-400 mt-1">
                    Will write: <strong>{toMmmDD(moveToDate)}</strong>
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setMoveTarget(null)}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMoveTo}
                disabled={!moveToDate || movingTo}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                {movingTo ? <Loader size={14} className="animate-spin" /> : <Calendar size={14} />}
                Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalWorkerbook;