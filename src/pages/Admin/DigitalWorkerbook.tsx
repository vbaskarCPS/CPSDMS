// src/pages/Admin/DigitalWorkerbook.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Bus,
  MessageSquare,
  UserX,
  UserMinus,
  UserCheck,
  Flame,
  CalendarDays,
  Home,
  Zap,
  Snowflake,
  Clock,
  Search,
  Users,
  Download,
} from 'lucide-react';
import { dialerSheetsService } from '../../lib/dialerSheetsService';
import { commandCenterService } from '../../lib/commandCenterService';
import { onboardingService, ShuttlePoint } from '../../lib/onboardingService';
import {
  WorkerbookEmailTemplate,
  WorkerbookTextTemplate,
  WorkerbookConfirmation,
  loadWorkerbookTemplates,
  loadAllTextTemplates,
  getEmailedTodaySet,
  cleanOldWorkerbookEmailLogs,
  sendWorkerbookEmail,
  getConfirmationsForDateTab,
  markConfirmationSynced,
  getTextedTodayMap,
  logTextSent,
  buildTextMessage,
  buildSmsLink,
  TextContext,
} from '../../lib/workerbookEmailService';
import {
  PhoneType,
  getNaCountsForTab,
  incrementNaCount,
  clearNaCountsForContractor,
} from '../../lib/workerbookNaService';
import { pushShuttleRoster } from '../../lib/shuttleRosterService';
import WorkerbookEmailService from './WorkerbookEmailService';
import {
  getDatedTabs,
  loadAllDayCounts,
  groupTabsByMonth,
  buildMonthGrid,
  getTodayTabName as getCalendarTodayTabName,
  MonthGroup,
  DayCount,
  CalendarProgress,
} from '../../lib/workerbookCalendarService';
import {
  loadStatusRoster,
  loadAllStatusCounts,
  StatusContractor,
  StatusTabName,
} from '../../lib/workerbookStatusRosterService';
import { moveContractorRow, isRunInFlight } from '../../lib/workerbookRunService';
import {
  ContactEntry,
  loadAllContacts,
  sortContacts,
  searchContacts,
  filterActive,
  downloadVCardBundle,
  dedupeForSave,
} from '../../lib/workerbookContactsService';

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
type WBView = 'calendar' | 'day' | 'status';
type MoveTargetContext = 'day' | 'status';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toMmmDD(dateInput: string): string {
  const parts = dateInput.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + String(d.getDate()).padStart(2, '0');
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
      confirmed: String(row[9]  ?? '').trim().toLowerCase() === 'x',
      showed:    String(row[10] ?? '').trim().toLowerCase() === 'x',
      nextDay:   String(row[11] ?? '').trim(),
      days:      parseInt(String(row[14] ?? '0'), 10) || 0,
      ns:        parseInt(String(row[15] ?? '0'), 10) || 0,
      notes:     String(row[18] ?? '').trim(),
    }))
    .filter(c => c.cnId);
}

function sortContractors(
  contractors: WBContractor[],
  emailConfirmedIds: Set<string>,
): WBContractor[] {
  return [...contractors].sort((a, b) => {
    const aConf = a.confirmed || emailConfirmedIds.has(a.cnId);
    const bConf = b.confirmed || emailConfirmedIds.has(b.cnId);
    if (aConf && !bConf) return -1;
    if (!aConf && bConf)  return 1;
    const lastCmp = a.lastName.localeCompare(b.lastName);
    if (lastCmp !== 0) return lastCmp;
    return a.firstName.localeCompare(b.firstName);
  });
}

function statusToWB(c: StatusContractor): WBContractor {
  return {
    rowNum:    c.rowNum,
    shuttle:   c.shuttle,
    cnId:      c.cnId,
    firstName: c.firstName,
    lastName:  c.lastName,
    cellPhone: c.cellPhone,
    altPhone:  c.altPhone,
    email:     c.email,
    manager:   c.manager,
    team:      c.team,
    confirmed: false,
    showed:    false,
    nextDay:   c.nextDay,
    days:      c.days,
    ns:        c.ns,
    notes:     c.notes,
  };
}

// ─── CONFIRM BUTTON ───────────────────────────────────────────────────────────

interface ConfirmButtonProps {
  confirmed: boolean;
  emailConfirmed: boolean;
  loading: boolean;
  onClick: () => void;
}

const ConfirmButton: React.FC<ConfirmButtonProps> = ({ confirmed, emailConfirmed, loading, onClick }) => {
  const isConfirmed = confirmed || emailConfirmed;

  if (loading) {
    return (
      <button disabled className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-bold bg-gray-700 text-gray-400 cursor-not-allowed w-full md:w-auto md:flex-shrink-0">
        <Loader size={12} className="animate-spin" /> Confirming...
      </button>
    );
  }

  if (isConfirmed) {
    return (
      <button
        onClick={onClick}
        className={
          'flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-bold transition-all w-full md:w-auto md:flex-shrink-0 bg-green-600 text-white hover:bg-green-500 ' +
          (emailConfirmed ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-gray-800' : '')
        }
      >
        <CheckCircle size={12} />
        {emailConfirmed ? 'Confirmed ✉️' : 'Confirmed'}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-bold transition-colors w-full md:w-auto md:flex-shrink-0 bg-blue-600 text-white hover:bg-blue-500"
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

  const [view, setView] = useState<WBView>('calendar');
  const [activeStatusTab, setActiveStatusTab] = useState<StatusTabName | null>(null);

  const [allTabs, setAllTabs]           = useState<string[]>([]);
  const [tabIndex, setTabIndex]         = useState(0);
  const selectedTab                     = allTabs[tabIndex] ?? '';

  const [contractors, setContractors]   = useState<WBContractor[]>([]);
  const [statusRoster, setStatusRoster] = useState<StatusContractor[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const [shuttlePoints, setShuttlePoints] = useState<ShuttlePoint[]>([]);

  const [emailedToday, setEmailedToday] = useState<Set<string>>(new Set());
  const [templates, setTemplates]       = useState<{ regular: WorkerbookEmailTemplate; rookie: WorkerbookEmailTemplate } | null>(null);
  const [textTemplates, setTextTemplates] = useState<{
    workerbook: WorkerbookTextTemplate;
    ns: WorkerbookTextTemplate;
    wdr: WorkerbookTextTemplate;
    snow: WorkerbookTextTemplate;
    tnb: WorkerbookTextTemplate;
  } | null>(null);
  const [textedToday, setTextedToday]   = useState<Set<string>>(new Set());
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
  const [moveTargetContext, setMoveTargetContext] = useState<MoveTargetContext>('day');
  const [moveToDate, setMoveToDate]             = useState('');
  const [moveToDestination, setMoveToDestination] = useState<string>('');
  const [movingTo, setMovingTo]                 = useState(false);
  const [confirmingFor, setConfirmingFor]       = useState<string | null>(null);

  const [naCounters, setNaCounters] = useState<Map<string, number>>(new Map());

  const [pushingToShuttles, setPushingToShuttles] = useState(false);

  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([]);
  const [calendarCounts, setCalendarCounts] = useState<Map<string, DayCount>>(new Map());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarProgress, setCalendarProgress] = useState<CalendarProgress | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<StatusTabName, number>>({
    NS: 0, WDR: 0, SNOW: 0, TNB: 0, Q: 0, F: 0,
  });

  const [runError, setRunError]         = useState<string | null>(null);
  const [runSuccess, setRunSuccess]     = useState<string | null>(null);

  // ─── CONTACTS / SEARCH STATE ───────────────────────────────────────────────

  const [allContacts, setAllContacts]       = useState<ContactEntry[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(new Set());
  const [contactsSearchQuery, setContactsSearchQuery] = useState('');

  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [calendarSearchOpen, setCalendarSearchOpen] = useState(false);

  const [scrollToCnId, setScrollToCnId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // ─── INIT ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    onboardingService.getShuttlePoints().then(setShuttlePoints).catch(() => {});
    getEmailedTodaySet().then(setEmailedToday).catch(() => {});
    loadWorkerbookTemplates().then(setTemplates).catch(() => {});
    loadAllTextTemplates().then(setTextTemplates).catch(() => {});
    getTextedTodayMap().then(setTextedToday).catch(() => {});
    cleanOldWorkerbookEmailLogs().catch(() => {});
  }, []);

  useEffect(() => {
    if (!showEmailService) {
      loadWorkerbookTemplates().then(setTemplates).catch(() => {});
      loadAllTextTemplates().then(setTextTemplates).catch(() => {});
    }
  }, [showEmailService]);

  useEffect(() => {
    if (isConnected && view === 'calendar' && currentCC) {
      loadCalendar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, view, currentCC]);

  useEffect(() => {
    if (view === 'day' && selectedTab && isConnected) {
      loadContractors();
      setCellColors(new Map());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedTab, isConnected]);

  useEffect(() => {
    if (view === 'day' && selectedTab && currentCC) {
      loadConfirmations();
      loadNaCounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedTab, currentCC]);

  useEffect(() => {
    if (view === 'status' && activeStatusTab && isConnected && currentCC) {
      loadStatusRosterData(activeStatusTab);
      loadNaCountsForStatusTab(activeStatusTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeStatusTab, isConnected, currentCC]);

  // Scroll-to-contractor after day view loads
  useEffect(() => {
    if (view !== 'day' || !scrollToCnId || loading || contractors.length === 0) return;
    const timer = setTimeout(() => {
      const node = cardRefs.current.get(scrollToCnId);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-gray-900');
        setTimeout(() => {
          node.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-gray-900');
        }, 2500);
      }
      setScrollToCnId(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [view, scrollToCnId, loading, contractors]);

  // ─── DATA LOADING ──────────────────────────────────────────────────────────

  const loadCalendar = useCallback(async () => {
    if (!currentCC) return;
    setCalendarLoading(true);
    setError(null);
    setCalendarProgress(null);
    try {
      const dated = await getDatedTabs(currentCC.workerbookSheetId);
      setAllTabs(dated);
      const todayIdx = dated.indexOf(getCalendarTodayTabName());
      setTabIndex(todayIdx >= 0 ? todayIdx : Math.max(0, dated.length - 1));

      loadAllStatusCounts(currentCC.workerbookSheetId)
        .then(setStatusCounts)
        .catch(() => {});

      const counts = await loadAllDayCounts(
        currentCC.workerbookSheetId,
        dated,
        (p) => setCalendarProgress(p),
      );
      setCalendarCounts(counts);

      const groups = groupTabsByMonth(dated, counts);
      setMonthGroups(groups);

      // Kick off background contacts load — calendar UI is already done
      loadContactsBackground(dated);
    } catch (err: any) {
      setError(err.message || 'Failed to load calendar');
    } finally {
      setCalendarLoading(false);
      setCalendarProgress(null);
    }
  }, [currentCC]);

  const loadContactsBackground = useCallback(async (datedTabs: string[]) => {
    if (!currentCC) return;
    setContactsLoading(true);
    try {
      const statusTabs: StatusTabName[] = ['NS', 'WDR', 'SNOW', 'TNB', 'Q', 'F'];
      const allTabsToScan = [...datedTabs, ...statusTabs];
      const contacts = await loadAllContacts(currentCC.workerbookSheetId, allTabsToScan);
      setAllContacts(sortContacts(contacts));
    } catch {
      // non-fatal — Contacts/Search just won't have data
    } finally {
      setContactsLoading(false);
    }
  }, [currentCC]);

  const loadContractors = useCallback(async () => {
    if (!currentCC || !selectedTab) return;
    setLoading(true); setError(null);
    try {
      const rows = await dialerSheetsService.sheetsGet(
        currentCC.workerbookSheetId, "'" + selectedTab + "'!A3:S200",
      );
      setContractors(parseContractors(rows));
    } catch (err: any) { setError(err.message || 'Failed to load contractor data'); }
    finally { setLoading(false); }
  }, [currentCC, selectedTab]);

  const loadConfirmations = useCallback(async () => {
    if (!currentCC || !selectedTab) return;
    try {
      const data = await getConfirmationsForDateTab(currentCC.id, selectedTab);
      setConfirmations(data);
    } catch { /* non-fatal */ }
  }, [currentCC, selectedTab]);

  const loadNaCounts = useCallback(async () => {
    if (!currentCC || !selectedTab) return;
    try {
      const map = await getNaCountsForTab(currentCC.id, selectedTab);
      setNaCounters(map);
    } catch { /* non-fatal */ }
  }, [currentCC, selectedTab]);

  const loadNaCountsForStatusTab = useCallback(async (tabName: StatusTabName) => {
    if (!currentCC) return;
    try {
      const map = await getNaCountsForTab(currentCC.id, tabName);
      setNaCounters(map);
    } catch { /* non-fatal */ }
  }, [currentCC]);

  const loadStatusRosterData = useCallback(async (tabName: StatusTabName) => {
    if (!currentCC) return;
    setLoading(true); setError(null);
    try {
      const roster = await loadStatusRoster(currentCC.workerbookSheetId, tabName);
      setStatusRoster(roster);
    } catch (err: any) {
      setError(err.message || 'Failed to load ' + tabName + ' roster');
    } finally {
      setLoading(false);
    }
  }, [currentCC]);

  // ─── VIEW NAVIGATION ───────────────────────────────────────────────────────

  const backToCalendar = () => {
    setView('calendar');
    setActiveStatusTab(null);
    setStatusRoster([]);
    setContractors([]);
    setEmailError(null);
    setEmailSuccess(null);
    setError(null);
    setRunError(null);
    setRunSuccess(null);
  };

  const openDayView = (tabName: string) => {
    const idx = allTabs.indexOf(tabName);
    if (idx >= 0) setTabIndex(idx);
    setView('day');
    setError(null);
  };

  const openStatusView = (tabName: StatusTabName) => {
    setActiveStatusTab(tabName);
    setView('status');
    setError(null);
  };

  // ─── SEARCH / JUMP TO CONTRACTOR (ACTIVE ONLY) ─────────────────────────────

  const calendarSearchResults = calendarSearchQuery.trim()
    ? filterActive(searchContacts(allContacts, calendarSearchQuery)).slice(0, 25)
    : [];

  const handleSearchSelect = (entry: ContactEntry) => {
    setCalendarSearchQuery('');
    setCalendarSearchOpen(false);
    // status tab vs dated tab
    const statusTabs: StatusTabName[] = ['NS', 'WDR', 'SNOW', 'TNB', 'Q', 'F'];
    if (statusTabs.includes(entry.tabName as StatusTabName)) {
      setScrollToCnId(entry.cnId);
      openStatusView(entry.tabName as StatusTabName);
    } else {
      setScrollToCnId(entry.cnId);
      openDayView(entry.tabName);
    }
  };

  // ─── CONTACTS MODAL (ACTIVE ONLY) ──────────────────────────────────────────

  const activeContacts = filterActive(allContacts);
  const contactsFiltered = contactsSearchQuery.trim()
    ? filterActive(searchContacts(allContacts, contactsSearchQuery))
    : activeContacts;

  const toggleContactSelect = (key: string) => {
    setSelectedContactKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleKeys = contactsFiltered.map(c => c.cnId + '::' + c.tabName);
    const allSelected = visibleKeys.every(k => selectedContactKeys.has(k));
    setSelectedContactKeys(prev => {
      const next = new Set(prev);
      if (allSelected) {
        visibleKeys.forEach(k => next.delete(k));
      } else {
        visibleKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const handleSaveSelectedContacts = () => {
    const selected = allContacts.filter(c => selectedContactKeys.has(c.cnId + '::' + c.tabName));
    if (!selected.length) return;
    const deduped = dedupeForSave(selected);
    const filename =
      'workerbook_' +
      (currentCC?.displayName || 'contacts').replace(/\s+/g, '_').toLowerCase() +
      '_' + deduped.length;
    downloadVCardBundle(deduped, currentCC?.displayName ?? 'Property Stars', filename);
  };

  const closeContactsModal = () => {
    setShowContactsModal(false);
    setSelectedContactKeys(new Set());
    setContactsSearchQuery('');
  };

  // ─── GOOGLE CONNECT ────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true); setError(null);
    try {
      const ok = await dialerSheetsService.authenticate();
      setIsConnected(ok);
      if (!ok) setError('Failed to connect to Google. Please try again.');
    } catch (err: any) { setError(err.message || 'Failed to connect'); }
    finally { setConnecting(false); }
  };

  // ─── CONFIRM ───────────────────────────────────────────────────────────────

  const handleToggleConfirm = async (c: WBContractor) => {
    if (!currentCC) return;
    setConfirmingFor(c.cnId);
    const newVal = c.confirmed ? '' : 'x';
    try {
      await dialerSheetsService.sheetsUpdate(
        currentCC.workerbookSheetId, "'" + selectedTab + "'!J" + c.rowNum, [[newVal]],
      );
      setContractors(prev => prev.map(p => p.rowNum === c.rowNum ? { ...p, confirmed: !c.confirmed } : p));
      if (!c.confirmed) {
        await clearNaCountsForContractor(currentCC.id, c.cnId, selectedTab);
        setNaCounters(prev => {
          const next = new Map(prev);
          next.delete(c.cnId + ':cell');
          next.delete(c.cnId + ':alt');
          return next;
        });
      }
    } catch (err: any) { setError(err.message || 'Failed to update confirm'); }
    finally { setConfirmingFor(null); }
  };

  // ─── NA PHONE DIAL ─────────────────────────────────────────────────────────

  const handlePhoneDial = async (c: WBContractor, phoneType: PhoneType, phoneNumber: string) => {
    if (!currentCC) return;
    const tabForNa = view === 'status' ? (activeStatusTab ?? '') : selectedTab;
    if (!tabForNa) {
      window.location.href = 'tel:' + phoneNumber;
      return;
    }
    const key = c.cnId + ':' + phoneType;
    setNaCounters(prev => {
      const next = new Map(prev);
      next.set(key, (prev.get(key) ?? 0) + 1);
      return next;
    });
    window.location.href = 'tel:' + phoneNumber;
    try {
      const newCount = await incrementNaCount(currentCC.id, c.cnId, tabForNa, phoneType);
      setNaCounters(prev => {
        const next = new Map(prev);
        next.set(key, newCount);
        return next;
      });
    } catch {
      setNaCounters(prev => {
        const next = new Map(prev);
        const current = prev.get(key) ?? 1;
        if (current <= 1) next.delete(key);
        else next.set(key, current - 1);
        return next;
      });
    }
  };

  // ─── TEXT MESSAGE ──────────────────────────────────────────────────────────

  const handleSendText = async (c: WBContractor, phoneType: 'cell' | 'alt', context: TextContext) => {
    if (!textTemplates) return;
    const phoneNumber = phoneType === 'cell' ? c.cellPhone : c.altPhone;
    if (!phoneNumber) return;

    const template =
      context === 'ns'   ? textTemplates.ns :
      context === 'wdr'  ? textTemplates.wdr :
      context === 'snow' ? textTemplates.snow :
      context === 'tnb'  ? textTemplates.tnb :
                           textTemplates.workerbook;

    const shuttlePt = getShuttlePoint(c.shuttle);
    const dateForMessage = view === 'day' ? selectedTab : (c.nextDay || '');

    const messageBody = buildTextMessage(
      template,
      {
        firstName:    c.firstName,
        lastName:     c.lastName,
        date:         dateForMessage,
        shuttle:      c.shuttle || undefined,
        days:         c.days,
        contractorId: c.cnId,
      },
      shuttlePt,
    );

    const smsLink = buildSmsLink(phoneNumber, messageBody);

    const key = c.cnId + ':' + phoneType + ':' + context;
    setTextedToday(prev => new Set([...prev, key]));

    window.location.href = smsLink;

    try {
      await logTextSent(c.cnId, phoneType, context);
    } catch {
      setTextedToday(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ─── SYNC CONFIRMATIONS ────────────────────────────────────────────────────

  const handleSyncConfirmations = async () => {
    if (!currentCC || !selectedTab) return;
    const unsynced = confirmations.filter(c => !c.syncedToSheets);
    if (!unsynced.length) return;
    setSyncingConfirm(true); setSyncResult(null); setError(null);
    try {
      const cnColumn = await dialerSheetsService.sheetsGet(
        currentCC.workerbookSheetId, "'" + selectedTab + "'!B3:B200",
      );
      const cnRowMap = new Map<string, number>();
      cnColumn.forEach((row, idx) => {
        const cn = String(row[0] ?? '').trim();
        if (cn) cnRowMap.set(cn, idx + 3);
      });
      let synced = 0; let notFound = 0;
      for (const conf of unsynced) {
        const rowNum = cnRowMap.get(conf.contractorId);
        if (!rowNum) { notFound++; continue; }
        await dialerSheetsService.sheetsUpdate(
          currentCC.workerbookSheetId, "'" + selectedTab + "'!J" + rowNum, [['x']],
        );
        await markConfirmationSynced(conf.id);
        setContractors(prev => prev.map(p => p.rowNum === rowNum ? { ...p, confirmed: true } : p));
        synced++;
      }
      await loadConfirmations();
      const parts = [synced + ' confirmation' + (synced !== 1 ? 's' : '') + ' synced to Sheets'];
      if (notFound > 0) parts.push(notFound + ' not found in current tab');
      setSyncResult(parts.join(' · '));
      setTimeout(() => setSyncResult(null), 5000);
    } catch (err: any) { setError(err.message || 'Failed to sync confirmations'); }
    finally { setSyncingConfirm(false); }
  };

  // ─── MOVE TO ───────────────────────────────────────────────────────────────

  const openMoveModal = (c: WBContractor, context: MoveTargetContext) => {
    setMoveTarget(c);
    setMoveTargetContext(context);
    setMoveToDate('');
    setMoveToDestination('');
    setRunError(null);
    setRunSuccess(null);
  };

  const handleMoveApply = async () => {
    if (!currentCC || !moveTarget) return;
    if (!moveToDestination) {
      setRunError('Pick a destination (a date or a status).');
      return;
    }

    const sourceTab = moveTargetContext === 'status'
      ? (activeStatusTab ?? '')
      : selectedTab;

    if (!sourceTab) {
      setRunError('Unable to determine the source tab.');
      return;
    }

    if (isRunInFlight(currentCC.id)) {
      setRunError('Another move is already running. Please wait for it to finish.');
      return;
    }

    setMovingTo(true);
    setRunError(null);
    setRunSuccess(null);

    try {
      const result = await moveContractorRow(
        currentCC.id,
        currentCC.workerbookSheetId,
        sourceTab,
        moveTarget.rowNum,
        moveToDestination,
      );

      if (!result.success) {
        setRunError(result.error || 'Move failed.');
        return;
      }

      setRunSuccess(
        'Moved ' + moveTarget.firstName + ' ' + moveTarget.lastName +
        ' → ' + moveToDestination,
      );
      setTimeout(() => setRunSuccess(null), 4000);

      setMoveTarget(null);
      setMoveToDate('');
      setMoveToDestination('');

      if (moveTargetContext === 'status' && activeStatusTab) {
        await loadStatusRosterData(activeStatusTab);
        loadAllStatusCounts(currentCC.workerbookSheetId).then(setStatusCounts).catch(() => {});
      } else {
        await loadContractors();
      }
    } catch (err: any) {
      setRunError(err.message || 'Failed to move contractor');
    } finally {
      setMovingTo(false);
    }
  };

  // ─── PUSH TO SHUTTLES ─────────────────────────────────────────────────────

  const handlePushToShuttles = async () => {
    if (!currentCC || !selectedTab || !contractors.length) return;
    setPushingToShuttles(true); setError(null);
    try {
      const emailConfIds = new Set(confirmations.map(c => c.contractorId));
      const rosterData = contractors.map(c => ({
        contractorId:  c.cnId,
        firstName:     c.firstName,
        lastName:      c.lastName,
        cellPhone:     c.cellPhone,
        shuttleNumber: c.shuttle,
        confirmed:     c.confirmed || emailConfIds.has(c.cnId),
      }));

      await pushShuttleRoster(currentCC.id, selectedTab, rosterData);

      const ccUsername = (currentCC as any).username;
      if (ccUsername) {
        window.open('/' + ccUsername + '-shuttle', '_blank');
      }

      setEmailSuccess('Pushed ' + rosterData.length + ' contractors to Shuttles page!');
      setTimeout(() => setEmailSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to push to shuttles');
    } finally {
      setPushingToShuttles(false);
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
    const result = await sendWorkerbookEmail(
      buildEmailData(c, isRookie),
      isRookie ? templates.rookie : templates.regular,
      getShuttlePoint(c.shuttle),
    );
    if (result.success) { setEmailedToday(prev => new Set([...prev, c.email.toLowerCase()])); return true; }
    return false;
  };

  const handleSendEmail = async (c: WBContractor) => {
    if (!c.email) return;
    setSendingFor(c.cnId); setEmailError(null);
    const ok = await sendToContractor(c);
    ok ? setEmailSuccess('Email sent to ' + c.firstName + '!') : setEmailError('Failed to email ' + c.firstName + '.');
    setTimeout(() => setEmailSuccess(null), 3000);
    setSendingFor(null);
  };

  const handleEmailAll = async () => {
    const toSend = contractors.filter(c => c.email && !emailedToday.has(c.email.toLowerCase()));
    if (!toSend.length) return;
    setSendingAll(true); setEmailError(null);
    let sent = 0; let failed = 0;
    for (const c of toSend) { (await sendToContractor(c)) ? sent++ : failed++; }
    setSendingAll(false);
    failed === 0
      ? setEmailSuccess('All ' + sent + ' emails sent!')
      : setEmailError(sent + ' sent, ' + failed + ' failed.');
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
    } catch (err: any) { setError(err.message || 'Failed to load colors'); }
    finally { setLoadingColors(false); }
  };

  // ─── EMAIL SERVICE ─────────────────────────────────────────────────────────

  if (showEmailService) return <WorkerbookEmailService onBack={() => setShowEmailService(false)} />;

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
              {connecting ? 'Connecting...' : 'Connect to Google'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── DERIVED STATE (for day view) ──────────────────────────────────────────

  const emailConfirmedIds = new Set(confirmations.map(c => c.contractorId));
  const unsyncedCount     = confirmations.filter(c => !c.syncedToSheets).length;
  const pendingEmailCount = contractors.filter(c => c.email && !emailedToday.has(c.email.toLowerCase())).length;

  const sorted = sortContractors(contractors, emailConfirmedIds);
  const confirmedGroup   = sorted.filter(c => c.confirmed || emailConfirmedIds.has(c.cnId));
  const unconfirmedGroup = sorted.filter(c => !c.confirmed && !emailConfirmedIds.has(c.cnId));

  const dotClass: Record<string, string> = {
    green: 'bg-green-400', silver: 'bg-gray-400', gold: 'bg-yellow-400',
  };

  const currentTextContext: TextContext =
    view === 'status' && activeStatusTab === 'NS'   ? 'ns'   :
    view === 'status' && activeStatusTab === 'WDR'  ? 'wdr'  :
    view === 'status' && activeStatusTab === 'SNOW' ? 'snow' :
    view === 'status' && activeStatusTab === 'TNB'  ? 'tnb'  :
                                                      'workerbook';

  // ─── TEXT BUTTON HELPER ────────────────────────────────────────────────────

  const renderTextButton = (c: WBContractor, phoneType: 'cell' | 'alt') => {
    const key = c.cnId + ':' + phoneType + ':' + currentTextContext;
    const texted = textedToday.has(key);
    const disabled = !textTemplates;
    return (
      <button
        onClick={() => handleSendText(c, phoneType, currentTextContext)}
        disabled={disabled}
        title={texted ? 'Texted today — tap to resend' : 'Send text message'}
        className={
          'flex items-center justify-center p-2.5 md:p-1.5 rounded-lg border transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ' +
          (texted
            ? 'bg-green-900/40 border-green-700/60 text-green-400 hover:bg-green-900/60'
            : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-blue-300 hover:border-blue-700/50')
        }
      >
        {texted ? <CheckCircle size={14} className="md:hidden" /> : <MessageSquare size={14} className="md:hidden" />}
        {texted ? <CheckCircle size={12} className="hidden md:block" /> : <MessageSquare size={12} className="hidden md:block" />}
      </button>
    );
  };

  // ─── CARD RENDERER ─────────────────────────────────────────────────────────

  const renderCard = (c: WBContractor, opts: { showEmailActions: boolean; showConfirm: boolean; moveContext: MoveTargetContext }) => {
    const dotColor       = cellColors.get(c.rowNum) ?? null;
    const shuttlePt      = getShuttlePoint(c.shuttle);
    const isEmailed      = !!(c.email && emailedToday.has(c.email.toLowerCase()));
    const isRookie       = c.days === 0;
    const isSending      = sendingFor === c.cnId;
    const isConfirming   = confirmingFor === c.cnId;
    const emailConfirmed = emailConfirmedIds.has(c.cnId);
    const isConfirmed    = c.confirmed || emailConfirmed;
    const naCell         = naCounters.get(c.cnId + ':cell') ?? 0;
    const naAlt          = naCounters.get(c.cnId + ':alt') ?? 0;

    return (
      <div
        key={c.rowNum + ':' + c.cnId}
        ref={(el) => { cardRefs.current.set(c.cnId, el); }}
        className={'bg-gray-800 rounded-xl border p-4 md:px-4 md:py-3 transition-all ' + (isConfirmed && opts.showConfirm ? 'border-green-700/50' : 'border-gray-700')}
      >
        {/* PHONE LAYOUT */}
        <div className="md:hidden space-y-3">
          <div className="flex items-center gap-2 min-w-0">
            {dotColor && <div className={'w-2.5 h-2.5 rounded-full flex-shrink-0 ' + dotClass[dotColor]} />}
            <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded font-mono flex-shrink-0">{c.cnId}</span>
            {isRookie && (
              <span className="text-[10px] bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded border border-purple-700/50 flex-shrink-0">ROOKIE</span>
            )}
            <span className="font-bold text-white text-base flex-1 min-w-0 truncate">{c.firstName + ' ' + c.lastName}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={'text-xs px-2.5 py-1 rounded ' + (isRookie ? 'bg-purple-900/30 text-purple-300 border border-purple-700/40' : 'bg-gray-700 text-gray-300')}>
              {'Days: ' + c.days}
            </span>
            {c.ns > 0 && (
              <span className="text-xs px-2.5 py-1 rounded bg-red-900/30 text-red-300 border border-red-700/40">{'NS: ' + c.ns}</span>
            )}
            {c.team && (
              <span className="text-xs px-2.5 py-1 rounded bg-gray-700 text-gray-400">{c.team}</span>
            )}
          </div>

          {(opts.showEmailActions || opts.showConfirm) && (
            <div className="flex items-center gap-2">
              {opts.showEmailActions && (
                c.email ? (
                  <button
                    onClick={() => handleSendEmail(c)}
                    disabled={isSending || sendingAll}
                    className={'flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex-1 disabled:opacity-50 ' + (isEmailed ? 'bg-green-900/30 text-green-400 border border-green-700/50 hover:bg-green-900/50' : 'bg-blue-900/30 text-blue-400 border border-blue-700/50 hover:bg-blue-900/50')}
                  >
                    {isSending ? <Loader size={14} className="animate-spin" /> : isEmailed ? <CheckCircle size={14} /> : <Mail size={14} />}
                    {isEmailed ? 'Sent' : 'Email'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-600 flex-1 text-center py-2.5">No email on file</span>
                )
              )}

              {opts.showConfirm && (
                <div className="flex-1">
                  <ConfirmButton
                    confirmed={c.confirmed}
                    emailConfirmed={emailConfirmed}
                    loading={isConfirming}
                    onClick={() => handleToggleConfirm(c)}
                  />
                </div>
              )}
            </div>
          )}

          {c.cellPhone && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePhoneDial(c, 'cell', c.cellPhone)}
                className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-blue-400 hover:text-blue-300 transition-colors flex-1 min-w-0"
              >
                <Phone size={14} className="flex-shrink-0" />
                <span className="font-medium">{c.cellPhone}</span>
                {naCell > 0 && (
                  <span className="ml-auto bg-orange-900/50 text-orange-300 border border-orange-700/50 px-2 py-0.5 rounded text-xs font-bold">{'NA x' + naCell}</span>
                )}
              </button>
              {renderTextButton(c, 'cell')}
            </div>
          )}

          {c.altPhone && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePhoneDial(c, 'alt', c.altPhone)}
                className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-blue-300 transition-colors flex-1 min-w-0"
              >
                <Phone size={14} className="text-gray-600 flex-shrink-0" />
                <span className="font-medium">{c.altPhone}</span>
                <span className="text-gray-600 text-xs">Alt</span>
                {naAlt > 0 && (
                  <span className="ml-auto bg-orange-900/50 text-orange-300 border border-orange-700/50 px-2 py-0.5 rounded text-xs font-bold">{'NA x' + naAlt}</span>
                )}
              </button>
              {renderTextButton(c, 'alt')}
            </div>
          )}

          {c.email && (
            <button
              onClick={() => { window.location.href = 'mailto:' + c.email; }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-400 transition-colors w-full min-w-0"
            >
              <Mail size={13} className="flex-shrink-0" />
              <span className="truncate">{c.email}</span>
            </button>
          )}

          {c.shuttle && (
            <div className={'flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm ' + (shuttlePt ? 'bg-blue-900/20 border border-blue-700/40 text-blue-300' : 'bg-gray-900 border border-gray-700 text-gray-500')}>
              <span className="flex-shrink-0">🚐</span>
              {shuttlePt ? (
                <div className="min-w-0">
                  <strong className="block">{shuttlePt.description}</strong>
                  {shuttlePt.pickupTime && (
                    <span className="text-xs opacity-80">Pickup: {shuttlePt.pickupTime}</span>
                  )}
                </div>
              ) : (
                'Shuttle #' + c.shuttle + ' — not configured'
              )}
            </div>
          )}

          <button
            onClick={() => openMoveModal(c, opts.moveContext)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors w-full"
          >
            <Calendar size={14} />
            {c.nextDay ? 'Next: ' + c.nextDay : 'Move / Status'}
          </button>
        </div>

        {/* TABLET LAYOUT */}
        <div className="hidden md:block">
          <div className="flex items-center gap-2 min-w-0">
            {dotColor && <div className={'w-2 h-2 rounded-full flex-shrink-0 ' + dotClass[dotColor]} />}
            <span className="text-[11px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">{c.cnId}</span>
            {isRookie && (
              <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/50 flex-shrink-0">ROOKIE</span>
            )}
            <span className="font-bold text-white text-sm truncate flex-1 min-w-0">{c.firstName + ' ' + c.lastName}</span>
            <span className={'text-[11px] px-2 py-0.5 rounded flex-shrink-0 ' + (isRookie ? 'bg-purple-900/30 text-purple-300 border border-purple-700/40' : 'bg-gray-700 text-gray-300')}>
              {'Days: ' + c.days}
            </span>
            {c.ns > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-700/40 flex-shrink-0">{'NS: ' + c.ns}</span>
            )}
            {c.team && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-400 flex-shrink-0">{c.team}</span>
            )}

            {opts.showEmailActions && (
              c.email ? (
                <button
                  onClick={() => handleSendEmail(c)}
                  disabled={isSending || sendingAll}
                  className={'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 disabled:opacity-50 ' + (isEmailed ? 'bg-green-900/30 text-green-400 border border-green-700/50 hover:bg-green-900/50' : 'bg-blue-900/30 text-blue-400 border border-blue-700/50 hover:bg-blue-900/50')}
                >
                  {isSending ? <Loader size={11} className="animate-spin" /> : isEmailed ? <CheckCircle size={11} /> : <Mail size={11} />}
                  {isEmailed ? 'Sent' : 'Email'}
                </button>
              ) : (
                <span className="text-[10px] text-gray-600 flex-shrink-0">No email</span>
              )
            )}

            {opts.showConfirm && (
              <ConfirmButton
                confirmed={c.confirmed}
                emailConfirmed={emailConfirmed}
                loading={isConfirming}
                onClick={() => handleToggleConfirm(c)}
              />
            )}
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {c.cellPhone && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handlePhoneDial(c, 'cell', c.cellPhone)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Phone size={11} />
                  {c.cellPhone}
                  {naCell > 0 && (
                    <span className="ml-1 bg-orange-900/50 text-orange-300 border border-orange-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold">{'NA x' + naCell}</span>
                  )}
                </button>
                {renderTextButton(c, 'cell')}
              </div>
            )}

            {c.altPhone && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handlePhoneDial(c, 'alt', c.altPhone)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-blue-300 transition-colors"
                >
                  <Phone size={11} className="text-gray-600" />
                  {c.altPhone}
                  <span className="text-gray-600 ml-0.5">Alt</span>
                  {naAlt > 0 && (
                    <span className="ml-1 bg-orange-900/50 text-orange-300 border border-orange-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold">{'NA x' + naAlt}</span>
                  )}
                </button>
                {renderTextButton(c, 'alt')}
              </div>
            )}

            {c.email && (
              <button
                onClick={() => { window.location.href = 'mailto:' + c.email; }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 transition-colors min-w-0 flex-1 truncate"
              >
                <Mail size={10} className="flex-shrink-0" />
                <span className="truncate">{c.email}</span>
              </button>
            )}

            {c.shuttle && (
              <div className={'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs flex-shrink-0 ' + (shuttlePt ? 'bg-blue-900/20 border border-blue-700/40 text-blue-300' : 'bg-gray-900 border border-gray-700 text-gray-500')}>
                {'🚐 '}
                {shuttlePt
                  ? <><strong>{shuttlePt.description}</strong>{shuttlePt.pickupTime && ' · ' + shuttlePt.pickupTime}</>
                  : 'Shuttle #' + c.shuttle + ' — not configured'
                }
              </div>
            )}

            <button
              onClick={() => openMoveModal(c, opts.moveContext)}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white transition-colors flex-shrink-0 ml-auto"
            >
              <Calendar size={11} /> {c.nextDay || 'Move'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── CALENDAR VIEW ─────────────────────────────────────────────────────────

  const renderCalendarView = () => {
    const todayTabName = getCalendarTodayTabName();

    return (
      <>
        {/* Search bar — TOP of calendar */}
        <div className="relative mb-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 flex items-center gap-2 px-3 py-2">
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={calendarSearchQuery}
              onChange={e => { setCalendarSearchQuery(e.target.value); setCalendarSearchOpen(true); }}
              onFocus={() => setCalendarSearchOpen(true)}
              placeholder={contactsLoading ? 'Loading contractors…' : 'Search by name or phone…'}
              disabled={contactsLoading && allContacts.length === 0}
              className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none disabled:opacity-50"
            />
            {calendarSearchQuery && (
              <button
                onClick={() => { setCalendarSearchQuery(''); setCalendarSearchOpen(false); }}
                className="text-gray-500 hover:text-white flex-shrink-0"
              >
                <X size={16} />
              </button>
            )}
            {contactsLoading && (
              <Loader size={14} className="animate-spin text-blue-400 flex-shrink-0" />
            )}
          </div>

          {calendarSearchOpen && calendarSearchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 max-h-96 overflow-y-auto">
              {calendarSearchResults.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 text-center">No active matches</div>
              ) : (
                calendarSearchResults.map((entry, idx) => (
                  <button
                    key={entry.cnId + '::' + entry.tabName + '::' + idx}
                    onClick={() => handleSearchSelect(entry)}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-700 border-b border-gray-700/50 last:border-b-0 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{entry.firstName} {entry.lastName}</span>
                      {entry.cellPhone && (
                        <span className="text-xs text-blue-300">· {entry.cellPhone}</span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono ml-auto bg-green-900/40 text-green-300 border border-green-700/40">
                        {entry.tabName}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Status tiles — 2x2 grid: NS+WDR top, SNOW+TNB bottom */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => openStatusView('NS')}
            className="bg-red-900/20 hover:bg-red-900/40 border border-red-800/60 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-red-900/60 rounded-lg flex items-center justify-center border border-red-700/60">
                <UserX className="text-red-400" size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-red-400/80 font-semibold tracking-wide uppercase">No Shows</div>
                <div className="text-2xl font-bold text-white">{statusCounts.NS}</div>
                <div className="text-xs text-gray-400">Tap to call back</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => openStatusView('WDR')}
            className="bg-amber-900/20 hover:bg-amber-900/40 border border-amber-800/60 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-amber-900/60 rounded-lg flex items-center justify-center border border-amber-700/60">
                <UserMinus className="text-amber-400" size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-amber-400/80 font-semibold tracking-wide uppercase">Worked, Didn't Rebook</div>
                <div className="text-2xl font-bold text-white">{statusCounts.WDR}</div>
                <div className="text-xs text-gray-400">Tap to call back</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => openStatusView('SNOW')}
            className="bg-sky-900/20 hover:bg-sky-900/40 border border-sky-800/60 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sky-900/60 rounded-lg flex items-center justify-center border border-sky-700/60">
                <Snowflake className="text-sky-400" size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-sky-400/80 font-semibold tracking-wide uppercase">SNOW</div>
                <div className="text-2xl font-bold text-white">{statusCounts.SNOW}</div>
                <div className="text-xs text-gray-400">Tap to call back</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => openStatusView('TNB')}
            className="bg-purple-900/20 hover:bg-purple-900/40 border border-purple-800/60 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-purple-900/60 rounded-lg flex items-center justify-center border border-purple-700/60">
                <Clock className="text-purple-400" size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-purple-400/80 font-semibold tracking-wide uppercase">TNB</div>
                <div className="text-2xl font-bold text-white">{statusCounts.TNB}</div>
                <div className="text-xs text-gray-400">Tap to call back</div>
              </div>
            </div>
          </button>
        </div>

        {/* Loading indicator */}
        {calendarLoading && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-4">
            <div className="flex items-center gap-2">
              <Loader className="animate-spin text-blue-400" size={16} />
              <span className="text-sm text-gray-300">
                {calendarProgress?.currentTab || 'Loading calendar...'}
              </span>
            </div>
          </div>
        )}

        {/* Month grids */}
        {!calendarLoading && monthGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <CalendarDays size={48} className="mb-3 opacity-20" />
            <p className="font-medium">No dated tabs found in your workbook</p>
            <p className="text-sm mt-1">Expected tabs like "Apr16", "May01", etc.</p>
          </div>
        )}

        <div className="space-y-6">
          {monthGroups.map((month) => {
            const cells = buildMonthGrid(month);
            return (
              <div key={month.year + '-' + month.monthIndex} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="bg-gray-900 px-4 py-2 border-b border-gray-700">
                  <h3 className="font-bold text-white">{month.monthName} {month.year}</h3>
                </div>

                <div className="grid grid-cols-7 gap-1 p-2 border-b border-gray-700 text-[10px] text-gray-500 font-semibold uppercase tracking-wide text-center">
                  <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                </div>

                <div className="grid grid-cols-7 gap-1 p-2">
                  {cells.map((cell, idx) => {
                    if (cell.day === 0) {
                      return <div key={idx} className="aspect-square" />;
                    }
                    const count = cell.count;
                    const tabName = count?.tabName || '';
                    const isToday = tabName === todayTabName;
                    const hasBookings = (count?.booked ?? 0) > 0;

                    const now = new Date();
                    const cellDate = new Date(month.year, month.monthIndex, cell.day);
                    const isPast = cellDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

                    const clickable = !!tabName;

                    return (
                      <button
                        key={idx}
                        onClick={() => clickable && openDayView(tabName)}
                        disabled={!clickable}
                        className={
                          'aspect-square rounded-lg border transition-colors p-1 flex flex-col items-center justify-start text-center ' +
                          (isToday ? 'border-blue-400 bg-blue-900/30 ' :
                           hasBookings ? 'border-gray-600 bg-gray-900 hover:bg-gray-700 hover:border-gray-500 ' :
                                         'border-gray-800 bg-gray-900/30 hover:bg-gray-800 ') +
                          (isPast && !hasBookings ? 'opacity-50 ' : '') +
                          (!clickable ? 'cursor-default ' : '')
                        }
                      >
                        <span className={'text-xs font-bold ' + (isToday ? 'text-blue-300' : 'text-gray-300')}>{cell.day}</span>
                        {hasBookings && (
                          <>
                            <span className="text-[9px] md:text-[10px] text-green-400 font-bold leading-tight mt-0.5">
                              Bkd: {count!.booked}
                            </span>
                            {count!.rookies > 0 && (
                              <span className="text-[9px] md:text-[10px] text-purple-400 leading-tight">
                                1st: {count!.rookies}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // ─── STATUS ROSTER VIEW ────────────────────────────────────────────────────

  const renderStatusView = () => {
    if (!activeStatusTab) return null;

    const themeMap: Record<StatusTabName, { text: string; bg: string; border: string; label: string; Icon: any }> = {
      NS:   { text: 'text-red-300',    bg: 'bg-red-900/10',    border: 'border-red-800/40',    label: 'No Shows',                   Icon: UserX },
      WDR:  { text: 'text-amber-300',  bg: 'bg-amber-900/10',  border: 'border-amber-800/40',  label: "Worked, Didn't Rebook",      Icon: UserMinus },
      SNOW: { text: 'text-sky-300',    bg: 'bg-sky-900/10',    border: 'border-sky-800/40',    label: 'SNOW',                       Icon: Snowflake },
      TNB:  { text: 'text-purple-300', bg: 'bg-purple-900/10', border: 'border-purple-800/40', label: 'TNB',                        Icon: Clock },
      Q:    { text: 'text-gray-300',   bg: 'bg-gray-900/10',   border: 'border-gray-800/40',   label: 'Quit',                       Icon: UserCheck },
      F:    { text: 'text-orange-300', bg: 'bg-orange-900/10', border: 'border-orange-800/40', label: 'Fired',                      Icon: Flame },
    };
    const theme = themeMap[activeStatusTab];
    const Icon = theme.Icon;

    return (
      <>
        <div className={'rounded-xl border p-4 mb-4 ' + theme.bg + ' ' + theme.border}>
          <div className="flex items-center gap-3">
            <Icon className={theme.text} size={24} />
            <div>
              <h2 className={'text-lg font-bold ' + theme.text}>{theme.label}</h2>
              <p className="text-xs text-gray-400">
                {statusRoster.length} contractor{statusRoster.length !== 1 ? 's' : ''} — call to get them back on the schedule
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-blue-400" size={32} />
          </div>
        ) : statusRoster.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <CheckCircle size={48} className="mb-3 opacity-20" />
            <p className="font-medium">No contractors on this tab</p>
          </div>
        ) : (
          <div className="space-y-2">
            {statusRoster.map(sc => renderCard(statusToWB(sc), {
              showEmailActions: false,
              showConfirm: false,
              moveContext: 'status',
            }))}
          </div>
        )}
      </>
    );
  };

  // ─── DAY VIEW ──────────────────────────────────────────────────────────────

  const renderDayView = () => (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader className="animate-spin text-blue-400" size={32} />
        </div>
      ) : contractors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <AlertCircle size={48} className="mb-3 opacity-20" />
          <p className="font-medium">{'No contractors on ' + (selectedTab || 'this date')}</p>
          <p className="text-sm mt-1">This tab may be empty or not yet populated.</p>
        </div>
      ) : (
        <>
          {confirmedGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-bold text-green-400 uppercase tracking-wide">
                  {'Confirmed (' + confirmedGroup.length + ')'}
                </span>
                <div className="flex-1 h-px bg-green-800/40" />
              </div>
              {confirmedGroup.map(c => renderCard(c, { showEmailActions: true, showConfirm: true, moveContext: 'day' }))}
            </div>
          )}

          {confirmedGroup.length > 0 && unconfirmedGroup.length > 0 && (
            <div className="h-3" />
          )}

          {unconfirmedGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {'Pending (' + unconfirmedGroup.length + ')'}
                </span>
                <div className="flex-1 h-px bg-gray-700/60" />
              </div>
              {unconfirmedGroup.map(c => renderCard(c, { showEmailActions: true, showConfirm: true, moveContext: 'day' }))}
            </div>
          )}
        </>
      )}
    </>
  );

  // ─── HEADER ────────────────────────────────────────────────────────────────

  const renderHeader = () => {
    if (view === 'calendar') {
      return (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <CalendarDays size={20} className="text-blue-400" />
              Digital Workerbook
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowContactsModal(true)}
              disabled={contactsLoading && allContacts.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg border border-purple-600 text-xs transition-colors disabled:opacity-50"
            >
              {contactsLoading && allContacts.length === 0
                ? <Loader size={14} className="animate-spin" />
                : <Users size={14} />}
              Contacts {activeContacts.length > 0 && '(' + activeContacts.length + ')'}
            </button>
            <button onClick={loadCalendar} disabled={calendarLoading}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors disabled:opacity-50">
              <RefreshCw size={14} className={calendarLoading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowEmailService(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors">
              <Settings size={14} /> Templates
            </button>
          </div>
        </div>
      );
    }

    if (view === 'status') {
      const headerThemeMap: Record<StatusTabName, { Icon: any; color: string }> = {
        NS:   { Icon: UserX,      color: 'text-red-400' },
        WDR:  { Icon: UserMinus,  color: 'text-amber-400' },
        SNOW: { Icon: Snowflake,  color: 'text-sky-400' },
        TNB:  { Icon: Clock,      color: 'text-purple-400' },
        Q:    { Icon: UserCheck,  color: 'text-gray-400' },
        F:    { Icon: Flame,      color: 'text-orange-400' },
      };
      const t = headerThemeMap[activeStatusTab!];
      const Icon = t.Icon;

      return (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={backToCalendar} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" title="Back to Calendar">
              <Home size={20} />
            </button>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Icon size={20} className={t.color} />
              {activeStatusTab}
              {statusRoster.length > 0 && (
                <span className="text-xs font-normal text-gray-500 ml-1">({statusRoster.length})</span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => activeStatusTab && loadStatusRosterData(activeStatusTab)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors">
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={() => setShowEmailService(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors">
              <Settings size={14} /> Templates
            </button>
          </div>
        </div>
      );
    }

    // view === 'day'
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={backToCalendar} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" title="Back to Calendar">
            <Home size={20} />
          </button>
          <div className="flex items-center gap-1 bg-gray-900 rounded-lg border border-gray-700 px-1">
            <button onClick={() => setTabIndex(i => Math.max(0, i - 1))} disabled={tabIndex === 0}
                    className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <span className="px-3 py-1 text-sm font-bold text-white min-w-[60px] text-center">
              {selectedTab || '—'}
            </span>
            <button onClick={() => setTabIndex(i => Math.min(allTabs.length - 1, i + 1))} disabled={tabIndex >= allTabs.length - 1}
                    className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>
          {contractors.length > 0 && (
            <span className="text-xs text-gray-500">{contractors.length + ' contractors'}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handlePushToShuttles} disabled={pushingToShuttles || !contractors.length}
                  className="flex items-center gap-1.5 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
            {pushingToShuttles ? <Loader size={14} className="animate-spin" /> : <Bus size={14} />}
            Push to Shuttles
          </button>
          <button onClick={handleRefreshColors} disabled={loadingColors || !contractors.length}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={loadingColors ? 'animate-spin' : ''} /> Colors
          </button>
          <button onClick={loadNaCounts} disabled={!contractors.length || !currentCC}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors disabled:opacity-50">
            <RefreshCw size={14} /> NA
          </button>
          <button onClick={() => setShowEmailService(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg border border-gray-600 text-xs transition-colors">
            <Settings size={14} /> Templates
          </button>
          {unsyncedCount > 0 && (
            <button onClick={handleSyncConfirmations} disabled={syncingConfirm}
                    className="flex items-center gap-1.5 px-3 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
              {syncingConfirm ? <Loader size={14} className="animate-spin" /> : <CloudUpload size={14} />}
              {'Sync Confirmations (' + unsyncedCount + ')'}
            </button>
          )}
          <button onClick={handleEmailAll} disabled={sendingAll || pendingEmailCount === 0 || !templates}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
            {sendingAll ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
            {'Email All' + (pendingEmailCount > 0 ? ' (' + pendingEmailCount + ')' : '')}
          </button>
        </div>
      </div>
    );
  };

  // ─── MAIN VIEW ─────────────────────────────────────────────────────────────

  const visibleSelectedCount = contactsFiltered.filter(c => selectedContactKeys.has(c.cnId + '::' + c.tabName)).length;
  const allVisibleSelected = contactsFiltered.length > 0 && visibleSelectedCount === contactsFiltered.length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3">
          {renderHeader()}
        </div>
      </div>

      {/* Alerts */}
      <div className="max-w-5xl mx-auto px-4 mt-3 space-y-2">
        {syncResult && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} /> {syncResult}
          </div>
        )}
        {runSuccess && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <Zap size={16} /> {runSuccess}
          </div>
        )}
        {emailSuccess && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} /> {emailSuccess}
          </div>
        )}
        {(error || emailError || runError) && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error || emailError || runError}
            <button onClick={() => { setError(null); setEmailError(null); setRunError(null); }} className="ml-auto"><X size={14} /></button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto p-4 space-y-2">
        {view === 'calendar' && renderCalendarView()}
        {view === 'day'      && renderDayView()}
        {view === 'status'   && renderStatusView()}
      </div>

      {/* Move-To / Status Modal */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white">Move / Set Status</h3>
                <p className="text-xs text-gray-400 mt-0.5">{moveTarget.firstName + ' ' + moveTarget.lastName + ' · ' + moveTarget.cnId}</p>
              </div>
              <button onClick={() => setMoveTarget(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-4">
              {moveTarget.nextDay && (
                <div className="text-xs text-gray-400 bg-gray-900 rounded p-2">
                  Currently: <strong className="text-white">{moveTarget.nextDay}</strong>
                </div>
              )}

              {/* Date option */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Move to a date</label>
                <input
                  type="date"
                  value={moveToDate}
                  onChange={e => {
                    const val = e.target.value;
                    setMoveToDate(val);
                    setMoveToDestination(val ? toMmmDD(val) : '');
                  }}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                />
                {moveToDate && moveToDestination && !['NS','WDR','SNOW','TNB','Q','F'].includes(moveToDestination) && (
                  <p className="text-xs text-blue-400 mt-1">Will move to tab: <strong>{moveToDestination}</strong></p>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div className="flex-1 h-px bg-gray-700" />
                <span>OR</span>
                <div className="flex-1 h-px bg-gray-700" />
              </div>

              {/* Status buttons — 2x3 grid */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Set a status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setMoveToDestination('NS'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'NS'
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-red-900/20 border-red-800/60 text-red-300 hover:bg-red-900/40')
                    }
                  >
                    <UserX size={14} /> NS (No Show)
                  </button>
                  <button
                    onClick={() => { setMoveToDestination('WDR'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'WDR'
                        ? 'bg-amber-600 border-amber-500 text-white'
                        : 'bg-amber-900/20 border-amber-800/60 text-amber-300 hover:bg-amber-900/40')
                    }
                  >
                    <UserMinus size={14} /> WDR
                  </button>
                  <button
                    onClick={() => { setMoveToDestination('SNOW'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'SNOW'
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-sky-900/20 border-sky-800/60 text-sky-300 hover:bg-sky-900/40')
                    }
                  >
                    <Snowflake size={14} /> SNOW
                  </button>
                  <button
                    onClick={() => { setMoveToDestination('TNB'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'TNB'
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'bg-purple-900/20 border-purple-800/60 text-purple-300 hover:bg-purple-900/40')
                    }
                  >
                    <Clock size={14} /> TNB
                  </button>
                  <button
                    onClick={() => { setMoveToDestination('Q'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'Q'
                        ? 'bg-gray-600 border-gray-500 text-white'
                        : 'bg-gray-900/60 border-gray-800 text-gray-300 hover:bg-gray-800')
                    }
                  >
                    <UserCheck size={14} /> Q (Quit)
                  </button>
                  <button
                    onClick={() => { setMoveToDestination('F'); setMoveToDate(''); }}
                    className={
                      'flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold transition-all border ' +
                      (moveToDestination === 'F'
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : 'bg-orange-900/20 border-orange-800/60 text-orange-300 hover:bg-orange-900/40')
                    }
                  >
                    <Flame size={14} /> F (Fired)
                  </button>
                </div>
              </div>

              {moveToDestination && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-300">
                  Will copy row to <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300 font-mono">{moveToDestination}</code> tab (with formatting preserved) and delete from source.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button onClick={() => setMoveTarget(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">Cancel</button>
              <button
                onClick={handleMoveApply}
                disabled={!moveToDestination || movingTo}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                {movingTo ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
                {movingTo ? 'Moving...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contacts Modal */}
      {showContactsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={20} className="text-purple-400" />
                <div>
                  <h3 className="font-bold text-white">Save Contacts to Phone</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{activeContacts.length} active · select and download as vCard</p>
                </div>
              </div>
              <button onClick={closeContactsModal} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            {/* Search + Select All */}
            <div className="p-3 border-b border-gray-700 space-y-2">
              <div className="bg-gray-900 rounded-lg border border-gray-700 flex items-center gap-2 px-3 py-2">
                <Search size={14} className="text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  value={contactsSearchQuery}
                  onChange={e => setContactsSearchQuery(e.target.value)}
                  placeholder="Filter by name or phone…"
                  className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
                />
                {contactsSearchQuery && (
                  <button onClick={() => setContactsSearchQuery('')} className="text-gray-500 hover:text-white">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={toggleSelectAllVisible}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {allVisibleSelected ? 'Deselect all visible' : 'Select all visible'} ({contactsFiltered.length})
                </button>
                <span className="text-xs text-gray-500">
                  {selectedContactKeys.size} selected
                </span>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {contactsLoading && allContacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Loader className="animate-spin mb-3 text-blue-400" size={32} />
                  <p className="text-sm">Loading contractors from all tabs…</p>
                </div>
              ) : contactsFiltered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                  <Users size={48} className="mb-3 opacity-20" />
                  <p className="text-sm">No active matches</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-700/60">
                  {contactsFiltered.map((entry, idx) => {
                    const key = entry.cnId + '::' + entry.tabName;
                    const checked = selectedContactKeys.has(key);
                    return (
                      <button
                        key={key + '::' + idx}
                        onClick={() => toggleContactSelect(key)}
                        className={'w-full text-left p-3 transition-colors flex items-center gap-3 ' + (checked ? 'bg-purple-900/20 hover:bg-purple-900/30' : 'hover:bg-gray-700/50')}
                      >
                        <div className={'w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ' + (checked ? 'bg-purple-600 border-purple-500' : 'border-gray-600')}>
                          {checked && <CheckCircle size={14} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-sm">{entry.firstName} {entry.lastName}</span>
                            <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono">{entry.cnId}</span>
                            <span className="text-[10px] bg-green-900/40 text-green-300 px-1.5 py-0.5 rounded border border-green-700/40">{entry.tabName}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                            {entry.cellPhone && <span>📱 {entry.cellPhone}</span>}
                            {entry.altPhone && <span className="text-gray-500">☎️ {entry.altPhone}</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-700 flex items-center justify-between gap-2">
              <div className="text-xs text-gray-400">
                {selectedContactKeys.size > 0
                  ? 'Tap Download — open the .vcf from your notification to save to Contacts'
                  : 'Select contractors to download'}
              </div>
              <div className="flex gap-2">
                <button onClick={closeContactsModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">Close</button>
                <button
                  onClick={handleSaveSelectedContacts}
                  disabled={selectedContactKeys.size === 0}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                  <Download size={14} /> Download ({selectedContactKeys.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalWorkerbook;