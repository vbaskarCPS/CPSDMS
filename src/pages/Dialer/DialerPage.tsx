// src/pages/Dialer/DialerPage.tsx
//
// AutoSniper Dialer — full calling interface.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, ArrowDown, ArrowUp, Crosshair, Phone, ChevronRight, ChevronLeft, Settings } from 'lucide-react';
import { campaignService, getTodayEST } from '../../lib/campaignService';
import type { SniperConfig, ResumeData, CampaignType, CampaignBook } from '../../lib/campaignService';
import { dialerSheetsService } from '../../lib/dialerSheetsService';
import {
  initialize,
  applyDisposition,
  stageCardData,
  finalizePrepay,
  cancelPrepay,
  hasPendingPrepay,
  invalidateCache,
  getNextState,
  discoverAvailableYears,
  discoverCities,
  discoverRoutePrefixes,
  formatPhoneDisplay,
  getActiveMultipliers,
  getCurrentRank,
  createFreshSession,
  setResumePosition,
  getAvailableGroupPhones,
} from '../../lib/dialer';
import type {
  EngineConfig,
  EngineSnapshot,
  DialerState,
  DialerStateResult,
  Direction,
  DispositionType,
  DispositionExtra,
  GamificationSession,
  MultiplierSnapshot,
  CityInfo,
  RoutePrefixInfo,
  UpsellType,
} from '../../lib/dialer';
import type { Rank, StagedCard } from '../../lib/dialer';
import DialerHUD from './DialerHUD';
import type { TeamBookingEvent, HUDMenuAction, MultiplierActivationEvent } from './DialerHUD';
import AchievementsPanel from './AchievementsPanel';
import StatsPanel from './StatsPanel';
import { useToasts, BadgeToastContainer, PointToastContainer } from './DialerToasts';
import CampaignSelect from './CampaignSelect';
import type { Campaign as CampaignCard } from './CampaignSelect';
import SniperSettings from './SniperSettings';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';
import type { PublishMultiplierPayload } from '../../lib/dialerRealtimeService';
import FireteamPanel from './FireteamPanel';
import { detectNewlyActivated } from './multiplierActivations';
// ── NA COOLDOWN ──────────────────────────────────────────────────────────────
import { logDisposition, fetchCooldownList, isOnCooldown } from '../../lib/naCooldownService';
import type { NACooldownList } from '../../lib/naCooldownService';
// ────────────────────────────────────────────────────────────────────────────

// =============================================================================
// STYLES
// =============================================================================

const CY = '#00e5ff';
const OR = '#f5a623';

const S = {
  body: { background: '#000e16', color: '#e0e0e0', fontFamily: '"Segoe UI", Arial, sans-serif' } as React.CSSProperties,
  topBar: { background: 'rgba(0,14,22,0.9)', borderBottom: `1px solid ${CY}15` } as React.CSSProperties,
  clientHeader: { background: 'rgba(0,14,22,0.85)', borderBottom: `1px solid ${CY}12` } as React.CSSProperties,
  phoneBar: { background: 'rgba(0,10,18,0.9)', borderBottom: `1px solid ${CY}12` } as React.CSSProperties,
  contentArea: { background: 'rgba(0,12,20,0.95)' } as React.CSSProperties,
  sidePanel: { background: 'rgba(0,14,22,0.9)', borderLeft: `1px solid ${CY}20` } as React.CSSProperties,
  historyRow: { background: 'rgba(0,14,22,0.7)', border: `1px solid ${CY}10` } as React.CSSProperties,
  linkShot: { background: 'rgba(0,20,30,0.8)', border: `1px solid ${CY}18` } as React.CSSProperties,
  yesInput: { background: 'rgba(0,10,18,0.9)', color: '#fff', border: `1px solid ${CY}20` } as React.CSSProperties,
};

const FO_COLORS: Record<string, { bg: string; color: string }> = {
  FO: { bg: 'rgba(231,76,60,0.2)', color: '#e74c3c' },
  BO: { bg: 'rgba(243,156,18,0.2)', color: '#f39c12' },
  FP: { bg: `rgba(0,229,255,0.15)`, color: CY },
};

const STRATEGY_COLORS: Record<string, { bg: string; border: string; color: string; label: string }> = {
  single:   { bg: `rgba(0,229,255,0.12)`,  border: CY, color: CY, label: 'SINGLE' },
  dominant: { bg: 'rgba(243,156,18,0.15)',   border: '#f39c12', color: '#f39c12', label: 'DOMINANT' },
  even:     { bg: 'rgba(231,76,60,0.15)',    border: '#e74c3c', color: '#e74c3c', label: 'EVEN' },
};

// =============================================================================
// HOTKEY CONFIG
// =============================================================================

type HotkeyTarget = 'NA' | 'CTS' | 'WN/NIS' | 'NO' | 'REMOVE' | 'YES';

const HOTKEY_MAP: Record<string, HotkeyTarget> = {
  z: 'NA',
  x: 'CTS',
  c: 'WN/NIS',
  v: 'NO',
  b: 'REMOVE',
  a: 'YES',
};

// =============================================================================
// HELPERS — tabs → CampaignSelect cards
// =============================================================================

const CODENAMES = [
  'OP IRON GATE', 'OP THUNDER RUN', 'OP NIGHTHAWK', 'OP SILENT HILL',
  'OP STEEL RAIN', 'OP GREEN ZONE', 'OP HARVEST', 'OP BLACKOUT',
  'OP CROSSFIRE', 'OP VANGUARD', 'OP FIRESTORM', 'OP SENTINEL',
  'OP PHANTOM', 'OP WARPATH', 'OP OVERWATCH', 'OP ECLIPSE',
  'OP DEADSHOT', 'OP FROSTBITE', 'OP SHOCKWAVE', 'OP MIDNIGHT',
];
const TERRAINS: Array<'residential' | 'commercial' | 'industrial' | 'mixed' | 'rural'> = [
  'residential', 'commercial', 'industrial', 'mixed', 'rural',
];

function tabNameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function tabsToPlaceholderCards(tabs: string[], campaignName: string): CampaignCard[] {
  return tabs.map((tabName, idx) => {
    const a = tabNameHash(tabName);
    return {
      id: tabName,
      name: tabName,
      codename: CODENAMES[a % CODENAMES.length],
      description: `Callbook tab "${tabName}" from ${campaignName}. Deploy here to start dialing this section.`,
      totalRows: 0,
      bookings: 0,
      reachedPct: 0,
      avgAttempts: 0,
      zone: ['North', 'South', 'East', 'West', 'Central', 'Downtown'][(a >> 4) % 6],
      terrain: TERRAINS[(a >> 2) % TERRAINS.length],
      hot: idx === 0,
    };
  });
}

function booksToCards(books: CampaignBook[]): CampaignCard[] {
  return books.map((book, idx) => {
    const a = tabNameHash(book.id);
    return {
      id: book.id,
      name: book.displayName,
      codename: CODENAMES[a % CODENAMES.length],
      description: `${book.campaignType === 'bc' ? 'BC' : 'Standard'} callbook. Deploy to start dialing.`,
      totalRows: 0,
      bookings: 0,
      reachedPct: 0,
      avgAttempts: 0,
      zone: ['North', 'South', 'East', 'West', 'Central', 'Downtown'][(a >> 4) % 6],
      terrain: TERRAINS[(a >> 2) % TERRAINS.length],
      hot: idx === 0,
      campaignType: book.campaignType,
    };
  });
}

function formatLastSeen(isoTimestamp: string | null): string {
  if (!isoTimestamp) return '';
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// =============================================================================
// HELPER — run city scan, then route scan sequentially to avoid API quota errors
// =============================================================================

function runScansSequentially(
  spreadsheetId: string,
  tabs: string[],
  setCityProgress: (p: { current: number; total: number; tabName: string } | null) => void,
  setCityCards: (c: CityInfo[]) => void,
  setRouteProgress: (p: { current: number; total: number; tabName: string } | null) => void,
  setRoutePrefixCards: (r: RoutePrefixInfo[]) => void,
): void {
  if (tabs.length === 0) return;

  setCityProgress({ current: 0, total: tabs.length, tabName: tabs[0] });

  discoverCities(
    spreadsheetId,
    tabs,
    (scanned, total, tabName) => setCityProgress({ current: scanned, total, tabName })
  )
    .then(cities => { setCityCards(cities); })
    .catch(() => { /* non-critical */ })
    .finally(() => {
      setCityProgress(null);
      // Only start route scan after city scan fully completes — avoids flooding the quota
      setRouteProgress({ current: 0, total: tabs.length, tabName: tabs[0] });
      discoverRoutePrefixes(
        spreadsheetId,
        tabs,
        (scanned, total, tabName) => setRouteProgress({ current: scanned, total, tabName })
      )
        .then(prefixes => { setRoutePrefixCards(prefixes); })
        .catch(() => { /* non-critical */ })
        .finally(() => { setRouteProgress(null); });
    });
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function DialerPage() {
  const navigate = useNavigate();

  const [manager, setManager] = useState<any>(null);
  const [campaign, setCampaign] = useState<any>(null);
  const [mode, setMode] = useState<'campaign-select' | 'dialer'>('campaign-select');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [campaignCards, setCampaignCards] = useState<CampaignCard[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');
  const [cityCards, setCityCards] = useState<CityInfo[]>([]);
  const [cityProgress, setCityProgress] = useState<{ current: number; total: number; tabName: string } | null>(null);
  // Route prefix state
  const [routePrefixCards, setRoutePrefixCards] = useState<RoutePrefixInfo[]>([]);
  const [routeProgress, setRouteProgress] = useState<{ current: number; total: number; tabName: string } | null>(null);
  const [pendingRouteDeploy, setPendingRouteDeploy] = useState<RoutePrefixInfo[] | null>(null);
  const [books, setBooks] = useState<CampaignBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [activeBook, setActiveBook] = useState<CampaignBook | null>(null);
  const [selectedTab, setSelectedTab] = useState('');
  const [direction, setDirection] = useState<Direction>('ambush');
  const [startBookingId, setStartBookingId] = useState('');
  const [deployError, setDeployError] = useState('');
  const [showDeployConfig, setShowDeployConfig] = useState(false);
  const [deployingTab, setDeployingTab] = useState('');
  const [pendingCityDeploy, setPendingCityDeploy] = useState<CityInfo | null>(null);
  const [sniperSettingsOpen, setSniperSettingsOpen] = useState(false);
  const [sniperConfig, setSniperConfig] = useState<SniperConfig>(
    () => campaign?.sniperConfig || { years: [2025], ppOnly: false, minEntries: 1, linkShot: false, hideCTS: true, maxNA: 0, teamCooldownEnabled: true, teamCooldownDays: 2, selfCooldownDays: 4 }
  );
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentState, setCurrentState] = useState<DialerState | null>(null);
  const [emptyMessage, setEmptyMessage] = useState('');
  const [logMessage, setLogMessage] = useState('');
  const [showYesPanel, setShowYesPanel] = useState(false);
  const [autoFire, setAutoFire] = useState(false);
  const [pendingDial, setPendingDial] = useState(false);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  // --- Net available count (available groups minus cooldown) ---
  const [netAvailableCount, setNetAvailableCount] = useState(0);

  const [flashingKey, setFlashingKey] = useState<HotkeyTarget | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [yName, setYName] = useState('');
  const [yLastName, setYLastName] = useState('');
  const [yHouseNum, setYHouseNum] = useState('');
  const [yStreetName, setYStreetName] = useState('');
  const [yPrice, setYPrice] = useState('');
  const [yEmail, setYEmail] = useState('');
  const [yGate, setYGate] = useState(false);
  const [ySprink, setYSprink] = useState(false);
  const [yFO, setYFO] = useState('FP');
  const [yNotes, setYNotes] = useState('');
  const [yUpsellType, setYUpsellType] = useState<UpsellType>('none');
  const [yDtPrice, setYDtPrice] = useState('');
  const [yDtPrepaid, setYDtPrepaid] = useState(false);
  const [ySkipAeration, setYSkipAeration] = useState(false);
  const [yRejuvPrice, setYRejuvPrice] = useState('');
  const [ccNum, setCcNum] = useState('');
  const [ccExp, setCcExp] = useState('');
  const [ccCvv, setCcCvv] = useState('');
  const [ccAmt, setCcAmt] = useState('');
  const [ccType, setCcType] = useState('');
  const [cardStaging, setCardStaging] = useState(false);
  const [cardStatus, setCardStatus] = useState('');
  const [session, setSession] = useState<GamificationSession | null>(null);
  const [multipliers, setMultipliers] = useState<MultiplierSnapshot[]>([]);
  const [multipliersAt, setMultipliersAt] = useState(0);
  const [rank, setRank] = useState<Rank | null>(null);
  const [lastDispType, setLastDispType] = useState<string | undefined>(undefined);
  const [calmConsecutiveYes, setCalmConsecutiveYes] = useState(0);
  const [calmConsecutiveNos, setCalmConsecutiveNos] = useState(0);
  const [teamFeed, setTeamFeed] = useState<TeamBookingEvent[]>([]);
  const [multActivations, setMultActivations] = useState<MultiplierActivationEvent[]>([]);
  const prevOwnMultipliersRef = useRef<MultiplierSnapshot[]>([]);
  const [activeDialTab, setActiveDialTab] = useState('');
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef<EngineConfig | null>(null);
  const yesStartTimeRef = useRef(0);
  const dispositionedKeysRef = useRef<Set<string>>(new Set());
  const cooldownListRef = useRef<NACooldownList>({ entries: [], fetchedAt: 0 });
  const { badgeToasts, pointToasts, queueBadgeToast, showPointToast } = useToasts();
  const isBCCampaign = (activeBook?.campaignType ?? campaign?.campaignType) === 'bc';

  // =======================================================================
  // COMPUTE NET AVAILABLE — groups that aren't on cooldown
  // =======================================================================

  const computeNetAvailable = useCallback(() => {
    const config = configRef.current;
    if (!config) return;
    const sc = config.sniperConfig || sniperConfig;
    const teamDays = sc.teamCooldownEnabled ? sc.teamCooldownDays : 0;
    const groupPhones = getAvailableGroupPhones();
    let count = 0;
    for (const phones of groupPhones) {
      if (phones.length === 0) { count++; continue; }
      const anyAvailable = phones.some(phone =>
        !isOnCooldown(phone, manager?.id || '', cooldownListRef.current, teamDays, sc.selfCooldownDays)
      );
      if (anyAvailable) count++;
    }
    setNetAvailableCount(count);
  }, [sniperConfig, manager?.id]);

  // =======================================================================
  // ADVANCE TO NEXT VALID — skip groups where all phones are on cooldown
  // =======================================================================

  const advanceToNextValid = useCallback(async (
    initialState: DialerState
  ): Promise<DialerStateResult> => {
    const config = configRef.current;
    if (!config) return { found: false, message: 'No config.' };
    const sc = config.sniperConfig || sniperConfig;
    const teamDays = sc.teamCooldownEnabled ? sc.teamCooldownDays : 0;

    const isGroupOnCooldown = (state: DialerState): boolean => {
      const dialablePhones = [state.phone, state.alternatePhone].filter(Boolean);
      if (dialablePhones.length === 0) return false;
      return dialablePhones.every(phone =>
        isOnCooldown(phone, manager?.id || '', cooldownListRef.current, teamDays, sc.selfCooldownDays)
      );
    };

    let current: DialerStateResult = initialState;
    const MAX_SKIPS = 200;
    let skips = 0;

    while (current.found && skips < MAX_SKIPS) {
      const state = current as DialerState;
      if (!isGroupOnCooldown(state)) return current;
      skips++;
      const afterRow = Math.max(...state.rows) + 1;
      current = await getNextState(config, afterRow);
    }

    if (skips >= MAX_SKIPS) {
      return { found: false, message: 'All remaining groups recently reached by team.' };
    }
    return current;
  }, [sniperConfig, manager?.id]);

  // =======================================================================
  // AUTH CHECK + LOAD USER PREFERENCES
  // =======================================================================

  useEffect(() => {
    const mgr = campaignService.getCurrentManager();
    const cmp = campaignService.getCurrentCampaign();
    if (!mgr || !cmp) {
      navigate('/login');
      return;
    }
    setManager(mgr);
    setCampaign(cmp);

    campaignService.getUserPreferences(mgr.id).then((prefs) => {
      setSniperConfig(prefs.sniperConfig);
      setDirection(prefs.lastDirection);
    }).catch(() => {
      if (cmp.sniperConfig) setSniperConfig(cmp.sniperConfig);
    });

    setBooksLoading(true);
    campaignService.getBooksByCampaign(cmp.id).then((bks) => {
      setBooks(bks);
      if (bks.length > 0) {
        setCampaignCards(booksToCards(bks));
      }
    }).catch(() => {}).finally(() => setBooksLoading(false));
  }, [navigate]);

  useEffect(() => {
    if (!manager?.id) return;
    setResumeLoading(true);
    campaignService.getResumeData(manager.id)
      .then(data => { setResumeData(data); })
      .catch(() => {})
      .finally(() => setResumeLoading(false));
  }, [manager?.id]);

  useEffect(() => {
    if (!campaign || connected || connecting) return;
    if (booksLoading) return;
    handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, booksLoading, books.length]);

  // =======================================================================
  // PRESENCE HEARTBEAT
  // =======================================================================

  const startHeartbeat = useCallback((managerId: string, managerName: string, tabCampaignId: string) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    dialerRealtimeService.publishPresence({ managerId, managerName, campaignId: tabCampaignId }).catch(() => {});
    heartbeatRef.current = setInterval(() => {
      dialerRealtimeService.publishPresence({ managerId, managerName, campaignId: tabCampaignId }).catch(() => {});
    }, 30_000);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      if (manager?.id) {
        dialerRealtimeService.clearPresence(manager.id).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager?.id]);

  useEffect(() => {
    if (mode !== 'dialer' || !manager?.id || !activeDialTab) return;
    startHeartbeat(manager.id, manager.name || manager.repCode || 'Unknown', activeDialTab);
    return () => stopHeartbeat();
  }, [mode, activeDialTab, manager?.id, manager?.name, manager?.repCode, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    if (mode === 'campaign-select' && manager?.id) {
      stopHeartbeat();
      dialerRealtimeService.clearPresence(manager.id).catch(() => {});
    }
  }, [mode, manager?.id, stopHeartbeat]);

  useEffect(() => {
    if (!campaign?.id || !manager?.id) return;
    const unsubscribe = dialerRealtimeService.subscribeToTeamFeed(
      campaign.id, manager.id,
      (event) => { setTeamFeed(prev => [...prev, event]); }
    );
    return () => { unsubscribe(); };
  }, [campaign?.id, manager?.id]);

  useEffect(() => {
    const prev = prevOwnMultipliersRef.current;
    const activations = detectNewlyActivated(
      prev, multipliers,
      manager?.name || manager?.repCode || 'You',
      true,
    );
    if (activations.length > 0) {
      setMultActivations(p => [...p, ...activations]);
      if (campaign?.id && manager?.id) {
        for (const activation of activations) {
          const payload: PublishMultiplierPayload = {
            campaignId:     campaign.id,
            managerId:      manager.id,
            managerName:    manager.name || manager.repCode || 'Unknown',
            multiplierId:   activation.multiplierId,
            multiplierText: activation.text,
          };
          dialerRealtimeService.publishMultiplierEvent(payload).catch(() => {});
        }
      }
    }
    prevOwnMultipliersRef.current = multipliers;
  }, [multipliers, manager?.name, manager?.repCode, manager?.id, campaign?.id]);

  // =======================================================================
  // 30-SECOND COOLDOWN REFRESH
  // =======================================================================

  useEffect(() => {
    if (mode !== 'dialer' || !campaign?.id) return;
    const interval = setInterval(async () => {
      try {
        const list = await fetchCooldownList(campaign.id);
        cooldownListRef.current = list;
        computeNetAvailable();
      } catch { /* silent fail */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [mode, campaign?.id, computeNetAvailable]);

  // =======================================================================
  // HOTKEYS
  // =======================================================================

  const triggerFlash = useCallback((target: HotkeyTarget) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashingKey(target);
    flashTimerRef.current = setTimeout(() => {
      setFlashingKey(null);
      flashTimerRef.current = null;
    }, 300);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode !== 'dialer' || !currentState) return;
      if (showYesPanel || cardModalOpen || achievementsOpen || statsOpen || sniperSettingsOpen || showDeployConfig) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const target = HOTKEY_MAP[key];
      if (!target) return;
      e.preventDefault();
      triggerFlash(target);
      if (target === 'YES') { setShowYesPanel(true); } else { doDisp(target as DispositionType); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, currentState, showYesPanel, cardModalOpen, achievementsOpen, statsOpen, sniperSettingsOpen, showDeployConfig, triggerFlash]);

  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, []);

  // =======================================================================
  // CONNECT TO SHEETS
  // =======================================================================

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await dialerSheetsService.authenticate();
      setConnected(true);

      if (books.length > 0) {
        books.forEach(async (book) => {
          try {
            const bookTabs = await dialerSheetsService.getCallbookTabs(book.spreadsheetId);
            if (bookTabs.length === 0) return;
            const stats = await dialerSheetsService.computeTabStats(book.spreadsheetId, bookTabs[0]);
            setCampaignCards(prev => prev.map(card =>
              card.id === book.id
                ? { ...card, totalRows: stats.totalRows, bookings: stats.bookings, reachedPct: stats.reachedPct, avgAttempts: stats.avgAttempts, lastDeployed: stats.lastUsed ?? undefined }
                : card
            ));
          } catch { /* Non-critical */ }
        });
        return;
      }

      const legacySpreadsheetId = campaign?.spreadsheetId;
      if (legacySpreadsheetId && legacySpreadsheetId !== 'placeholder') {
        setTabsLoading(true);
        setTabsError('');
        try {
          const callbookTabs = await dialerSheetsService.getCallbookTabs(campaign.spreadsheetId);
          setTabs(callbookTabs);
          const placeholders = tabsToPlaceholderCards(callbookTabs, campaign.displayName || 'Campaign');
          setCampaignCards(placeholders);
          setTabsLoading(false);

          callbookTabs.forEach(async (tabName) => {
            try {
              const stats = await dialerSheetsService.computeTabStats(campaign.spreadsheetId, tabName);
              setCampaignCards(prev => prev.map(card =>
                card.id === tabName
                  ? { ...card, totalRows: stats.totalRows, bookings: stats.bookings, reachedPct: stats.reachedPct, avgAttempts: stats.avgAttempts, lastDeployed: stats.lastUsed ?? undefined }
                  : card
              ));
            } catch { /* Non-critical */ }
          });

          // City scan first, then route scan — sequential to avoid flooding the Sheets API quota
          if (callbookTabs.length > 0) {
            runScansSequentially(
              campaign.spreadsheetId, callbookTabs,
              setCityProgress, setCityCards,
              setRouteProgress, setRoutePrefixCards,
            );
          }

        } catch (err: any) {
          setTabsError(err.message || 'Failed to load tabs');
          setTabsLoading(false);
        }
      }
    } catch (err: any) {
      setTabsError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  // =======================================================================
  // CAMPAIGN SELECT → DEPLOY CONFIG → DEPLOY
  // =======================================================================

  const handleCampaignDeploy = async (cardId: string) => {
    setPendingCityDeploy(null);
    setPendingRouteDeploy(null);
    setStartBookingId('');
    setDeployError('');

    if (activeBook) {
      setDeployingTab(cardId);
      setSelectedTab(cardId);
      setShowDeployConfig(true);
      try {
        const years = await discoverAvailableYears(activeBook.spreadsheetId, cardId);
        setAvailableYears(years);
      } catch { /* Non-critical */ }
      return;
    }

    const book = books.find(b => b.id === cardId);
    if (book) {
      setActiveBook(book);
      setCityCards([]);
      setRoutePrefixCards([]);

      if (!connected) {
        try {
          await dialerSheetsService.authenticate();
          setConnected(true);
        } catch (err: any) {
          setTabsError('Failed to connect: ' + (err.message || ''));
          setActiveBook(null);
          return;
        }
      }

      try {
        const bookTabs = await dialerSheetsService.getCallbookTabs(book.spreadsheetId);
        setTabs(bookTabs);
        const tabCards = tabsToPlaceholderCards(bookTabs, book.displayName);
        setCampaignCards(tabCards);

        bookTabs.forEach(async (tabName) => {
          try {
            const stats = await dialerSheetsService.computeTabStats(book.spreadsheetId, tabName);
            setCampaignCards(prev => prev.map(card =>
              card.id === tabName
                ? { ...card, totalRows: stats.totalRows, bookings: stats.bookings, reachedPct: stats.reachedPct, avgAttempts: stats.avgAttempts, lastDeployed: stats.lastUsed ?? undefined }
                : card
            ));
          } catch { /* Non-critical */ }
        });

        // City scan first, then route scan — sequential to avoid flooding the Sheets API quota
        if (bookTabs.length > 0) {
          runScansSequentially(
            book.spreadsheetId, bookTabs,
            setCityProgress, setCityCards,
            setRouteProgress, setRoutePrefixCards,
          );
        }
      } catch (err: any) {
        setTabsError('Failed to load tabs: ' + (err.message || ''));
      }
      return;
    }

    setActiveBook(null);
    setDeployingTab(cardId);
    setSelectedTab(cardId);
    setShowDeployConfig(true);

    if (campaign?.spreadsheetId) {
      try {
        const years = await discoverAvailableYears(campaign.spreadsheetId, cardId);
        setAvailableYears(years);
      } catch { /* Non-critical */ }
    }
  };

  const handleBackToBooks = useCallback(() => {
    setActiveBook(null);
    setCampaignCards(booksToCards(books));
    setCityCards([]);
    setRoutePrefixCards([]);
    setCityProgress(null);
    setRouteProgress(null);
    setTabs([]);
  }, [books]);

  const handleCityDeploy = useCallback((city: CityInfo) => {
    setPendingCityDeploy(city);
    setPendingRouteDeploy(null);
    setDeployingTab('');
    setSelectedTab(city.cityName);
    setStartBookingId('');
    setDeployError('');
    if (direction === 'ambush') setDirection('infiltrate');
    setShowDeployConfig(true);
  }, [direction]);

  const handleRoutePrefixDeploy = useCallback((prefixes: RoutePrefixInfo[]) => {
    if (!prefixes || prefixes.length === 0) return;
    setPendingRouteDeploy(prefixes);
    setPendingCityDeploy(null);
    const displayName = prefixes.map(p => p.prefixName).join(' + ');
    setDeployingTab('');
    setSelectedTab(displayName);
    setStartBookingId('');
    setDeployError('');
    if (direction === 'ambush') setDirection('infiltrate');
    setShowDeployConfig(true);
  }, [direction]);

  // =======================================================================
  // CONFIRM DEPLOY
  // =======================================================================

  const handleConfirmDeploy = async () => {
    const isCityMode = pendingCityDeploy !== null;
    const isRoutePrefixMode = pendingRouteDeploy !== null && pendingRouteDeploy.length > 0;

    if (!campaign) return;
    if (!isCityMode && !isRoutePrefixMode && !selectedTab) return;

    if (!isCityMode && !isRoutePrefixMode && direction === 'ambush' && !startBookingId.trim()) {
      setDeployError('AMBUSH requires a Booking ID. Please enter one above.');
      return;
    }

    setDeployError('');
    setShowDeployConfig(false);
    setLoading(true);
    setLogMessage('Acquiring target...');

    if (manager?.id) {
      campaignService.saveUserPreferences(manager.id, { lastDirection: direction, sniperConfig }).catch(() => {});
    }

    const deploySpreadsheetId = activeBook?.spreadsheetId || campaign.spreadsheetId;
    const deployCampaignType = activeBook?.campaignType || campaign?.campaignType || 'standard';

    let config: EngineConfig;

    if (isCityMode) {
      config = {
        spreadsheetId: deploySpreadsheetId,
        sheetName: pendingCityDeploy!.cityName,
        direction,
        startRow: 2,
        repCode: manager?.repCode || '',
        managerId: manager?.id || '',
        campaignId: campaign?.id || '',
        sniperConfig,
        cityName: pendingCityDeploy!.cityName,
        cityTabs: pendingCityDeploy!.tabs,
        campaignType: deployCampaignType,
      };
    } else if (isRoutePrefixMode) {
      const allTabsSet = new Set<string>();
      for (const p of pendingRouteDeploy!) {
        for (const t of p.tabs) allTabsSet.add(t);
      }
      const displayName = pendingRouteDeploy!.map(p => p.prefixName).join(' + ');
      config = {
        spreadsheetId: deploySpreadsheetId,
        sheetName: displayName,
        direction,
        startRow: 2,
        repCode: manager?.repCode || '',
        managerId: manager?.id || '',
        campaignId: campaign?.id || '',
        sniperConfig,
        routePrefixes: pendingRouteDeploy!.map(p => p.prefixName),
        routeTabs: Array.from(allTabsSet),
        campaignType: deployCampaignType,
      };
    } else {
      config = {
        spreadsheetId: deploySpreadsheetId,
        sheetName: selectedTab,
        direction,
        startRow: 2,
        repCode: manager?.repCode || '',
        managerId: manager?.id || '',
        campaignId: campaign?.id || '',
        sniperConfig,
        startBookingId: startBookingId.trim() || undefined,
        campaignType: deployCampaignType,
      };
    }

    configRef.current = config;

    try {
      const snapshot = await initialize(config);
      if (!snapshot) {
        setEmptyMessage(
          isRoutePrefixMode
            ? `No available groups found for routes "${config.sheetName}".`
            : isCityMode
              ? `No available groups found in city "${pendingCityDeploy!.cityName}".`
              : 'No available groups found in this tab.'
        );
        setMode('dialer');
        setLoading(false);
        return;
      }

      // ── Fetch cooldown list BEFORE checking the first group ──
      if (campaign?.id) {
        try {
          const list = await fetchCooldownList(campaign.id);
          cooldownListRef.current = list;
        } catch { /* silent fail */ }
      }

      // ── Skip forward if first group is on cooldown ──
      const firstValidResult = await advanceToNextValid(snapshot.state);
      if (!firstValidResult.found) {
        setEmptyMessage((firstValidResult as any).message || 'No available groups found — all recently reached.');
        setMode('dialer');
        setLoading(false);
        return;
      }
      const firstState = firstValidResult as DialerState;

      setCurrentState(firstState);
      setSession(snapshot.session);
      const newMults = getActiveMultipliers(snapshot.session);
      setMultipliers(newMults);
      setMultipliersAt(Date.now());
      setRank(getCurrentRank(snapshot.session));
      prevOwnMultipliersRef.current = newMults;
      prefillYesForm(firstState);

      const displayTab = isRoutePrefixMode
        ? pendingRouteDeploy!.map(p => p.prefixName).join(' + ')
        : isCityMode ? pendingCityDeploy!.cityName : selectedTab;

      setResumePosition(displayTab, '', firstState.firstRow, activeBook?.id);
      setActiveDialTab(displayTab);
      setMode('dialer');
      setPendingCityDeploy(null);
      setPendingRouteDeploy(null);
      computeNetAvailable();
    } catch (err: any) {
      setShowDeployConfig(true);
      setDeployError(err.message || 'Failed to initialize dialer.');
    } finally {
      setLoading(false);
    }
  };

  // =======================================================================
  // RESUME DEPLOY
  // =======================================================================

  const handleResumeDeploy = async () => {
    if (!resumeData || !campaign) return;

    const tab       = resumeData.tab;
    const position  = resumeData.position;
    const isToday   = resumeData.sessionDate === getTodayEST();

    const resumeBookId = (resumeData.gamificationState as any)?._resumeBookId;
    let resumeBook: CampaignBook | null = null;
    if (resumeBookId) {
      resumeBook = books.find(b => b.id === resumeBookId) || null;
    }
    if (!resumeBook && books.length > 0) {
      resumeBook = books[0];
    }
    if (resumeBook) setActiveBook(resumeBook);

    const resumeSpreadsheetId = resumeBook?.spreadsheetId || campaign.spreadsheetId;
    const resumeCampaignType = resumeBook?.campaignType || campaign?.campaignType || 'standard';

    let startBookingIdResume: string | undefined;
    let startRowResume = 2;
    if (position.startsWith('ROW:')) {
      const rowNum = parseInt(position.slice(4), 10);
      if (!isNaN(rowNum)) startRowResume = rowNum;
    } else {
      startBookingIdResume = position;
    }

    setLoading(true);
    setLogMessage('Resuming last operation...');

    const config: EngineConfig = {
      spreadsheetId: resumeSpreadsheetId,
      sheetName: tab,
      direction: 'ambush',
      startRow: startRowResume,
      repCode: manager?.repCode || '',
      managerId: manager?.id || '',
      campaignId: campaign?.id || '',
      sniperConfig,
      startBookingId: startBookingIdResume,
      campaignType: resumeCampaignType,
    };
    configRef.current = config;
    setSelectedTab(tab);

    try {
      const snapshot = await initialize(config);
      if (!snapshot) {
        setEmptyMessage('No available groups found — the last position may have been worked.');
        setMode('dialer');
        setLoading(false);
        return;
      }

      // ── Fetch cooldown list BEFORE checking the first group ──
      if (campaign?.id) {
        try {
          const list = await fetchCooldownList(campaign.id);
          cooldownListRef.current = list;
        } catch { /* silent fail */ }
      }

      // ── Skip forward if first group is on cooldown ──
      const firstValidResult = await advanceToNextValid(snapshot.state);
      if (!firstValidResult.found) {
        setEmptyMessage('No available groups found — all recently reached.');
        setMode('dialer');
        setLoading(false);
        return;
      }
      const firstState = firstValidResult as DialerState;

      if (isToday) {
        setSession(snapshot.session);
        const newMults = getActiveMultipliers(snapshot.session);
        setMultipliers(newMults);
        setMultipliersAt(Date.now());
        setRank(getCurrentRank(snapshot.session));
        prevOwnMultipliersRef.current = newMults;
      } else {
        setSession(snapshot.session);
        setMultipliers([]);
        setMultipliersAt(Date.now());
        setRank(null);
        prevOwnMultipliersRef.current = [];
      }

      setCurrentState(firstState);
      prefillYesForm(firstState);
      setResumePosition(tab, '', firstState.firstRow, resumeBook?.id);
      setActiveDialTab(tab);
      setMode('dialer');
      setLogMessage('Operation resumed.');
      computeNetAvailable();
    } catch (err: any) {
      setEmptyMessage(err.message || 'Failed to resume.');
      setMode('dialer');
    } finally {
      setLoading(false);
    }
  };

  // =======================================================================
  // SNIPER SETTINGS
  // =======================================================================

  const handleSniperConfigSaved = useCallback((config: SniperConfig) => {
    setSniperConfig(config);
    if (configRef.current) configRef.current.sniperConfig = config;
    invalidateCache();
    if (manager?.id) {
      campaignService.saveUserPreferences(manager.id, { sniperConfig: config }).catch(() => {});
    }
  }, [manager?.id]);

  // =======================================================================
  // PREFILL YES FORM
  // =======================================================================

  const prefillYesForm = (state: DialerState) => {
    setYName(state.client.firstName || '');
    setYLastName(state.client.lastName || '');
    setYHouseNum(state.client.houseNum || '');
    setYStreetName(state.client.streetName || '');
    setYPrice(state.previousPrice || '');
    setYEmail(state.client.email || '');
    setYGate(false);
    setYSprink(false);
    setYFO(state.currentFO || 'FP');
    setYNotes('');
    setShowYesPanel(false);
    yesStartTimeRef.current = Date.now();
    setYUpsellType('none');
    setYDtPrice('');
    setYDtPrepaid(false);
    setYSkipAeration(false);
    setYRejuvPrice('');
  };

  // =======================================================================
  // RENDER STATE
  // =======================================================================

  const renderNewState = useCallback((state: DialerState | null, message?: string) => {
    if (!state) {
      setCurrentState(null);
      setEmptyMessage(message || 'No more groups.');
      return;
    }
    setCurrentState(state);
    setEmptyMessage('');
    prefillYesForm(state);
    setLogMessage(`Group loaded: row ${state.firstRow}`);
    if (configRef.current?.sheetName) {
      setResumePosition(configRef.current.sheetName, '', state.firstRow, activeBook?.id);
    }
  }, []);

  // =======================================================================
  // PUBLISH DIAL TICK
  // =======================================================================

  const publishDialTick = useCallback(() => {
    if (!campaign?.id || !manager?.id) return;
    dialerRealtimeService.publishDialEvent({
      campaignId:  campaign.id,
      managerId:   manager.id,
      managerName: manager.name || manager.repCode || 'Unknown',
    });
  }, [campaign?.id, manager?.id, manager?.name, manager?.repCode]);

  // =======================================================================
  // HANDLE GAMIFICATION RESULT
  // =======================================================================

  const handleGamResult = useCallback((result: any, isBooking = false, isPrepay = false, bookingPrice?: string) => {
    if (!result) return;
    if (result.session) setSession(result.session);
    if (result.rank) setRank(result.rank);
    if (result.activeMultipliers) { setMultipliers(result.activeMultipliers); setMultipliersAt(Date.now()); }

    if (result.dispType !== undefined) setLastDispType(result.dispType);
    if (result.consecutiveYes !== undefined) setCalmConsecutiveYes(result.consecutiveYes);
    if (result.consecutiveNos !== undefined) setCalmConsecutiveNos(result.consecutiveNos);

    if (result.newBadges?.length > 0) {
      for (const id of result.newBadges) queueBadgeToast(id);
      if (manager?.id) {
        campaignService.updateLifetimeBadges(manager.id, result.newBadges).catch(() => {});
      }
    }

    if (result.pointBreakdown) { showPointToast(result.pointBreakdown.grandTotal, result.pointBreakdown.multiplier); }
    else if (!isBooking && result.badgeBonusTotal > 0) { showPointToast(result.badgeBonusTotal, 1); }

    if (isBooking && result.pointBreakdown?.grandTotal > 0 && campaign?.id && manager?.id) {
      const ppDollars = isPrepay && bookingPrice ? parseFloat(bookingPrice) || 0 : 0;
      dialerRealtimeService.publishBookingEvent({
        campaignId:  campaign.id,
        managerId:   manager.id,
        managerName: manager.name || manager.repCode || 'Unknown',
        points:      result.pointBreakdown.grandTotal,
        ppDollars,
        badges:      result.newBadges || [],
        multipliers: result.activeMultipliers?.map((m: any) => m.id) || [],
        isPrepay,
      });
    }
  }, [queueBadgeToast, showPointToast, campaign?.id, manager?.id, manager?.name, manager?.repCode]);

  // =======================================================================
  // HUD MENU ACTIONS
  // =======================================================================

  const handleMenuAction = useCallback((action: HUDMenuAction) => {
    switch (action) {
      case 'achievements': setAchievementsOpen(true); break;
      case 'team': setStatsOpen(true); break;
      case 'scope': setSniperSettingsOpen(true); break;
      case 'campaigns':
        if (manager?.id) {
          campaignService.getResumeData(manager.id).then(setResumeData).catch(() => {});
        }
        setActiveBook(null);
        if (books.length > 0) setCampaignCards(booksToCards(books));
        setCityCards([]);
        setRoutePrefixCards([]);
        setMode('campaign-select' as any);
        break;
      case 'reset': {
        if (!confirm('Reset session? All points, badges, multipliers and streaks will be cleared.')) return;
        const repCode = session?.repCode || manager?.repCode || '';
        const dateStr = new Date().toLocaleDateString();
        const fresh = createFreshSession(repCode, dateStr);
        fresh.sessionStartTime = Date.now();
        setSession(fresh);
        setMultipliers([]);
        prevOwnMultipliersRef.current = [];
        setMultipliersAt(Date.now());
        setRank(null);
        setMultActivations([]);
        setLogMessage('Session reset.');
        break;
      }
      default: break;
    }
  }, [session?.repCode, manager?.repCode, manager?.id]);

  // =======================================================================
  // DISPOSITION HANDLERS
  // =======================================================================

  const doDisp = async (disp: DispositionType) => {
    if (!currentState || !configRef.current || pendingDial) return;
    const key = currentState.groupKey;
    if (dispositionedKeysRef.current.has(key)) return;
    dispositionedKeysRef.current.add(key);
    setPendingDial(true);
    setLogMessage(`Sending ${disp}...`);

    publishDialTick();

    try {
      const result = await applyDisposition(
        configRef.current, currentState, disp, currentState.phone, session!, {}, yesStartTimeRef.current
      );

      // ── Log disposition for all types (fire-and-forget) ──
      if (campaign?.id && manager?.id) {
        logDisposition(currentState.phone, campaign.id, manager.id).catch(() => {});
        cooldownListRef.current = {
          entries: [
            { phone: currentState.phone, repId: manager.id, createdAt: new Date().toISOString() },
            ...cooldownListRef.current.entries,
          ],
          fetchedAt: cooldownListRef.current.fetchedAt,
        };
      }

      handleGamResult(result.gamification, false);

      if (result.redialPhone) {
        dispositionedKeysRef.current.delete(key);
        setCurrentState(prev => prev ? { ...prev, phone: result.redialPhone!, alternatePhone: '' } : null);
        setLogMessage('Redial: alternate phone');
        if (autoFire) dialPhone(result.redialPhone);
        setPendingDial(false);
        return;
      }

      if (result.nextState.found) {
        const validResult = await advanceToNextValid(result.nextState as DialerState);
        if (validResult.found) {
          renderNewState(validResult as DialerState);
          if (autoFire) dialPhone((validResult as DialerState).phone);
        } else {
          renderNewState(null, (validResult as any).message);
        }
      } else {
        renderNewState(null, (result.nextState as any).message);
      }
      computeNetAvailable();
    } catch (err: any) {
      dispositionedKeysRef.current.delete(key);
      setLogMessage(`Error: ${err.message}`);
    } finally {
      setPendingDial(false);
    }
  };

  const doYes = async (subType: 'COMPLETE' | 'PREPAY') => {
    if (!currentState || !configRef.current || pendingDial) return;
    const key = currentState.groupKey;
    if (dispositionedKeysRef.current.has(key)) return;
    dispositionedKeysRef.current.add(key);
    setPendingDial(true);
    setLogMessage(`Booking ${subType}...`);

    publishDialTick();

    const extra: DispositionExtra = {
      name: yName.trim(), lastName: yLastName.trim(), houseNum: yHouseNum.trim(),
      streetName: yStreetName.trim(), price: yPrice.trim(), email: yEmail.trim(),
      gate: yGate, sprinkler: ySprink, foValue: yFO, notes: yNotes.trim(),
    };

    if (isBCCampaign && yUpsellType !== 'none') {
      extra.upsellType = yUpsellType;
      if (yUpsellType === 'dethatch') {
        extra.dtPrice = yDtPrice.trim();
        extra.dtPrepaid = yDtPrepaid;
        extra.skipAeration = ySkipAeration;
      }
      if (yUpsellType === 'rejuv') {
        extra.rejuvPrice = yRejuvPrice.trim();
        extra.price = yRejuvPrice.trim();
      }
    }

    try {
      if (subType === 'PREPAY') {
        await applyDisposition(
          configRef.current, currentState, 'PREPAY', currentState.phone, session!, extra, yesStartTimeRef.current
        );
        // ── Log disposition (fire-and-forget) ──
        if (campaign?.id && manager?.id) {
          logDisposition(currentState.phone, campaign.id, manager.id).catch(() => {});
          cooldownListRef.current = {
            entries: [
              { phone: currentState.phone, repId: manager.id, createdAt: new Date().toISOString() },
              ...cooldownListRef.current.entries,
            ],
            fetchedAt: cooldownListRef.current.fetchedAt,
          };
        }
        const cardAmount = (isBCCampaign && yUpsellType === 'rejuv') ? yRejuvPrice.trim() : yPrice.trim();
        setCcAmt(cardAmount);
        setCcNum(''); setCcExp(''); setCcCvv(''); setCcType(''); setCardStatus(''); setCardStaging(false);
        setCardModalOpen(true);
        setPendingDial(false);
      } else {
        const result = await applyDisposition(
          configRef.current, currentState, 'COMPLETE', currentState.phone, session!, extra, yesStartTimeRef.current
        );
        // ── Log disposition (fire-and-forget) ──
        if (campaign?.id && manager?.id) {
          logDisposition(currentState.phone, campaign.id, manager.id).catch(() => {});
          cooldownListRef.current = {
            entries: [
              { phone: currentState.phone, repId: manager.id, createdAt: new Date().toISOString() },
              ...cooldownListRef.current.entries,
            ],
            fetchedAt: cooldownListRef.current.fetchedAt,
          };
        }
        const isDtOnly = isBCCampaign && yUpsellType === 'dethatch' && ySkipAeration;
        handleGamResult(result.gamification, !isDtOnly, false);
        if (result.nextState.found) {
          const validResult = await advanceToNextValid(result.nextState as DialerState);
          if (validResult.found) {
            renderNewState(validResult as DialerState);
            if (autoFire) dialPhone((validResult as DialerState).phone);
          } else {
            renderNewState(null, (validResult as any).message);
          }
        } else {
          renderNewState(null, (result.nextState as any).message);
        }
        computeNetAvailable();
        setPendingDial(false);
      }
    } catch (err: any) {
      dispositionedKeysRef.current.delete(key);
      setLogMessage(`Error: ${err.message}`);
      setPendingDial(false);
    }
  };

  // =======================================================================
  // CARD ENTRY
  // =======================================================================

  const detectCardType = (num: string) => {
    const v = num.replace(/\D/g, '');
    if (v.length < 1) { setCcType(''); return; }
    const f1 = v.charAt(0);
    const f2 = v.length >= 2 ? parseInt(v.substring(0, 2), 10) : 0;
    const f4 = v.length >= 4 ? parseInt(v.substring(0, 4), 10) : 0;
    if (f1 === '4') setCcType('VISA');
    else if ((f2 >= 51 && f2 <= 55) || (f4 >= 2221 && f4 <= 2720)) setCcType('MC');
    else if (f1 === '3') setCcType('AMEX');
    else setCcType('OTHER');
  };

  const handleChamber = async () => {
    const num = ccNum.replace(/\D/g, '');
    if (!num || num.length < 13) { setCardStatus('Enter a valid card number.'); return; }
    if (!ccExp.trim()) { setCardStatus('Enter expiry date.'); return; }
    if (!ccCvv.trim()) { setCardStatus('Enter CVV.'); return; }
    setCardStaging(true); setCardStatus('Staging card...');
    try {
      const cardData = stageCardData(num, ccExp.trim(), ccCvv.trim(), ccAmt.trim());
      const result = await finalizePrepay(configRef.current!, cardData, session!);
      handleGamResult(result.gamification, true, true, ccAmt.trim());
      setCardStatus('✓ Card staged');
      setTimeout(async () => {
        setCardModalOpen(false);
        if (result.nextState.found) {
          const validResult = await advanceToNextValid(result.nextState as DialerState);
          if (validResult.found) {
            renderNewState(validResult as DialerState);
            if (autoFire) dialPhone((validResult as DialerState).phone);
          } else {
            renderNewState(null, (validResult as any).message);
          }
        } else {
          renderNewState(null, (result.nextState as any).message);
        }
        computeNetAvailable();
      }, 800);
    } catch (err: any) {
      setCardStatus(`Error: ${err.message}`);
      setCardStaging(false);
    }
  };

  const handleEject = () => {
    cancelPrepay();
    setCardModalOpen(false);
    if (currentState) dispositionedKeysRef.current.delete(currentState.groupKey);
    setPendingDial(false);
    setShowYesPanel(true);
    setLogMessage('Prepay cancelled — select a disposition.');
  };

  // =======================================================================
  // PHONE DIALING
  // =======================================================================

  const dialPhone = (phone?: string) => {
    const ph = phone || currentState?.phone;
    if (ph) window.open(`tel:${ph}`);
  };

  // =======================================================================
  // RENDER: CAMPAIGN SELECT MODE
  // =======================================================================

  if (mode === 'campaign-select') {
    if (connecting || tabsLoading || booksLoading) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center" style={S.body}>
          <Crosshair className="mb-4 animate-pulse" size={40} color="#00e5ff" />
          <div className="text-sm font-bold tracking-widest uppercase" style={{ color: '#00e5ff', opacity: 0.6, letterSpacing: '4px' }}>
            {connecting ? 'CONNECTING TO GOOGLE SHEETS...' : booksLoading ? 'LOADING BOOKS...' : 'LOADING CALLBOOKS...'}
          </div>
          <div className="text-xs mt-2" style={{ color: '#555' }}>
            {campaign?.displayName || ''} — {manager?.name || manager?.repCode || ''}
          </div>
        </div>
      );
    }

    if (!connected && !connecting && books.length === 0) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6" style={S.body}>
          <WifiOff className="mb-4" size={40} color="#e74c3c" />
          <div className="text-sm font-bold tracking-widest uppercase mb-2" style={{ color: '#e74c3c' }}>
            CONNECTION REQUIRED
          </div>
          {tabsError && <div className="text-xs mb-4" style={{ color: '#888' }}>{tabsError}</div>}
          <button
            onClick={handleConnect}
            className="px-6 py-3 rounded font-bold text-sm tracking-wider uppercase transition-all"
            style={{ background: '#2ecc71', color: '#000' }}
          >
            Connect to Google Sheets
          </button>
        </div>
      );
    }

    if (tabsError && tabs.length === 0 && books.length === 0) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6" style={S.body}>
          <div className="text-sm font-bold tracking-widest uppercase mb-2" style={{ color: '#e74c3c' }}>FAILED TO LOAD TABS</div>
          <div className="text-xs mb-4" style={{ color: '#888' }}>{tabsError}</div>
          <button onClick={handleConnect} className="px-6 py-3 rounded font-bold text-sm tracking-wider uppercase"
            style={{ background: 'rgba(0,20,30,0.8)', color: '#00e5ff', border: '1px solid rgba(0,229,255,0.20)' }}>
            Retry
          </button>
        </div>
      );
    }

    return (
      <>
        <CampaignSelect
          campaigns={campaignCards}
          onDeploy={handleCampaignDeploy}
          cityCards={books.length > 0 && !activeBook ? undefined : cityCards}
          onCityDeploy={books.length > 0 && !activeBook ? undefined : handleCityDeploy}
          routePrefixCards={books.length > 0 && !activeBook ? undefined : routePrefixCards}
          onRoutePrefixDeploy={books.length > 0 && !activeBook ? undefined : handleRoutePrefixDeploy}
          onSettingsClick={() => {
            const ssId = activeBook?.spreadsheetId || campaign?.spreadsheetId;
            if (availableYears.length === 0 && ssId && tabs.length > 0) {
              discoverAvailableYears(ssId, tabs[0]).then(setAvailableYears).catch(() => {});
            }
            setSniperSettingsOpen(true);
          }}
          filterSummary={activeBook && books.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <button
                onClick={handleBackToBooks}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 6,
                  border: '1px solid rgba(0,229,255,0.20)',
                  background: 'rgba(0,229,255,0.06)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 9, fontWeight: 800, letterSpacing: '1.5px',
                  color: '#00e5ff', textTransform: 'uppercase' as const,
                }}
              >
                ← BOOKS
              </button>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#fff', letterSpacing: '0.5px' }}>
                {activeBook.displayName}
              </span>
              {activeBook.campaignType === 'bc' ? (
                <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 7px', borderRadius: 3, background: 'rgba(241,196,15,0.15)', border: '1px solid rgba(241,196,15,0.35)', color: '#f1c40f' }}>BC</span>
              ) : (
                <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 7px', borderRadius: 3, background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.35)', color: '#2ecc71' }}>STD</span>
              )}
            </div>
          ) : undefined}
          campaignId={campaign?.id}
          managerId={manager?.id}
          managerName={manager?.name || manager?.repCode || ''}
          resumeData={!activeBook ? resumeData : undefined}
          resumeLoading={!activeBook ? resumeLoading : false}
          onResume={!activeBook ? handleResumeDeploy : undefined}
          session={session}
        />

        {/* City scan progress bar */}
        {cityProgress && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
            background: 'rgba(0,8,14,0.97)', borderTop: '1px solid rgba(46,204,113,0.25)',
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '2px', color: '#2ecc71', opacity: 0.6, textTransform: 'uppercase', flexShrink: 0 }}>
              🏙 CITY SCAN
            </span>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${cityProgress.total > 0 ? Math.round((cityProgress.current / cityProgress.total) * 100) : 0}%`,
                background: 'linear-gradient(90deg, #2ecc71, #27ae60)',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#2ecc71', opacity: 0.5, fontFamily: 'monospace', flexShrink: 0, minWidth: 120, textAlign: 'right' }}>
              Scanning {cityProgress.current} of {cityProgress.total} tabs...
            </span>
          </div>
        )}

        {/* Route scan progress bar — only shown after city scan completes */}
        {!cityProgress && routeProgress && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
            background: 'rgba(0,8,14,0.97)', borderTop: '1px solid rgba(52,152,219,0.25)',
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '2px', color: '#3498db', opacity: 0.6, textTransform: 'uppercase', flexShrink: 0 }}>
              🗺 ROUTE SCAN
            </span>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${routeProgress.total > 0 ? Math.round((routeProgress.current / routeProgress.total) * 100) : 0}%`,
                background: 'linear-gradient(90deg, #3498db, #2980b9)',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#3498db', opacity: 0.5, fontFamily: 'monospace', flexShrink: 0, minWidth: 120, textAlign: 'right' }}>
              Scanning {routeProgress.current} of {routeProgress.total} tabs...
            </span>
          </div>
        )}

        {campaign?.id && (
          <SniperSettings
            open={sniperSettingsOpen}
            onClose={() => setSniperSettingsOpen(false)}
            campaignId={campaign.id}
            currentConfig={sniperConfig}
            availableYears={availableYears}
            onConfigSaved={handleSniperConfigSaved}
          />
        )}

        {showDeployConfig && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
            onClick={() => { setShowDeployConfig(false); setPendingCityDeploy(null); setPendingRouteDeploy(null); }}
          >
            <div
              className="rounded-lg p-6 w-full max-w-sm"
              style={{ background: 'rgba(0,14,22,0.96)', border: `1.5px solid rgba(0,229,255,0.3)`, boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,255,0.10)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-4">
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '3px', color: '#00e5ff', opacity: 0.5, textTransform: 'uppercase' }}>
                  {pendingRouteDeploy ? '🗺 ROUTE MISSION PARAMETERS' : pendingCityDeploy ? '🏙 CITY MISSION PARAMETERS' : 'MISSION PARAMETERS'}
                </div>
                <div className="text-base font-black tracking-wider uppercase mt-1" style={{ color: '#fff' }}>
                  {pendingRouteDeploy
                    ? pendingRouteDeploy.map(p => p.prefixName).join(' + ')
                    : pendingCityDeploy ? pendingCityDeploy.cityName : deployingTab}
                </div>
                {pendingRouteDeploy && (
                  <div style={{ fontSize: 8, color: '#3498db', opacity: 0.6, marginTop: 4, fontFamily: 'monospace' }}>
                    {pendingRouteDeploy.length} route{pendingRouteDeploy.length !== 1 ? 's' : ''} · {pendingRouteDeploy.reduce((s, p) => s + p.totalRows, 0).toLocaleString()} rows
                  </div>
                )}
                {pendingCityDeploy && (
                  <div style={{ fontSize: 8, color: '#3498db', opacity: 0.6, marginTop: 4, fontFamily: 'monospace' }}>
                    {pendingCityDeploy.tabs.length} tab{pendingCityDeploy.tabs.length !== 1 ? 's' : ''} · {pendingCityDeploy.totalRows.toLocaleString()} rows
                  </div>
                )}
                {activeBook && !pendingCityDeploy && !pendingRouteDeploy && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 8, color: '#888', marginBottom: 3, fontFamily: 'monospace' }}>{activeBook.displayName}</div>
                    {activeBook.campaignType === 'bc' ? (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 3, background: 'rgba(241,196,15,0.15)', border: '1px solid rgba(241,196,15,0.35)', color: '#f1c40f' }}>BC</span>
                    ) : (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 3, background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.35)', color: '#2ecc71' }}>STANDARD</span>
                    )}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>APPROACH VECTOR</div>
                <div className="flex gap-2">
                  {([
                    { dir: 'ambush',     label: 'AMBUSH',     icon: 'lorc/hidden',       bg: '#0f3460', tip: 'Start at a specific Booking ID and call down. Wraps back to the top and completes a full loop.' },
                    { dir: 'infiltrate', label: 'INFILTRATE', icon: 'lorc/deadly-strike', bg: '#533483', tip: 'Scans the sheet in 20-row windows and strikes the zone with the lowest NA count.' },
                    { dir: 'siege',      label: 'SIEGE',      icon: 'lorc/tower-fall',   bg: '#7b1a1a', tip: 'Works every group in NA order — blanks first, then 1s, then 2s. No wrap. Mission complete when exhausted.' },
                  ] as const).filter(({ dir }) => !((pendingCityDeploy || pendingRouteDeploy) && dir === 'ambush')).map(({ dir, label, icon, bg, tip }) => {
                    const isSelected = direction === dir;
                    return (
                      <div key={dir} className="flex-1 relative group">
                        <button
                          onClick={() => { setDirection(dir as Direction); setDeployError(''); if (dir !== 'ambush') setStartBookingId(''); }}
                          className="w-full rounded transition-all"
                          style={{
                            position: 'relative', overflow: 'hidden', padding: '10px 4px 8px',
                            background: isSelected ? bg : '#1a2e1a', color: isSelected ? '#fff' : '#666',
                            border: isSelected ? `1.5px solid ${bg}` : '1.5px solid rgba(0,229,255,0.15)',
                            fontFamily: 'inherit', minHeight: 64, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'flex-end', gap: 4, cursor: 'pointer',
                          }}
                        >
                          <img src={`https://game-icons.net/icons/ffffff/transparent/1x1/${icon}.svg`} alt=""
                            style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                              width: 52, height: 52, opacity: isSelected ? 0.18 : 0.07, pointerEvents: 'none',
                              filter: isSelected ? 'none' : 'grayscale(100%)', transition: 'opacity 0.2s ease' }} />
                          <span style={{ position: 'relative', zIndex: 1, fontSize: 9, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase' }}>{label}</span>
                        </button>
                        <div className="absolute left-1/2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ bottom: 'calc(100% + 8px)', transform: 'translateX(-50%)', width: 180,
                            background: 'rgba(0,8,14,0.97)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: 6,
                            padding: '8px 10px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)', color: '#aaa',
                            fontSize: 10, lineHeight: 1.5, fontWeight: 400, letterSpacing: '0.3px', textAlign: 'left' }}>
                          <div style={{ color: '#00e5ff', fontWeight: 800, fontSize: 9, letterSpacing: '1.5px', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
                          {tip}
                          <div style={{ position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
                            width: 8, height: 8, background: 'rgba(0,8,14,0.97)', border: '1px solid rgba(0,229,255,0.25)',
                            borderTop: 'none', borderLeft: 'none' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {!pendingCityDeploy && !pendingRouteDeploy && direction === 'ambush' && (
                <div className="mb-4">
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    STARTING BOOKING ID <span style={{ color: '#e74c3c', opacity: 0.9 }}>REQUIRED</span>
                  </div>
                  <input type="text" value={startBookingId}
                    onChange={(e) => { setStartBookingId(e.target.value); setDeployError(''); }}
                    placeholder="e.g. ACE01-042" className="w-full px-3 py-2 rounded text-sm font-mono" style={S.yesInput} />
                </div>
              )}

              <div className="mb-5">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>SNIPER SCOPE</div>
                <button onClick={() => setSniperSettingsOpen(true)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded transition-all"
                  style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.15)', cursor: 'pointer' }}>
                  <div className="flex flex-wrap gap-1.5">
                    {sniperConfig.years.map(yr => (
                      <span key={yr} style={{ fontSize: 9, fontWeight: 800, color: '#00e5ff', background: 'rgba(0,229,255,0.12)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: 3, padding: '1px 6px' }}>{yr}</span>
                    ))}
                    {sniperConfig.ppOnly && <span style={{ fontSize: 8, fontWeight: 800, color: '#f1c40f', background: 'rgba(241,196,15,0.12)', border: '1px solid rgba(241,196,15,0.25)', borderRadius: 3, padding: '1px 6px' }}>PP</span>}
                    {sniperConfig.minEntries > 1 && <span style={{ fontSize: 8, fontWeight: 800, color: '#f5a623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 3, padding: '1px 6px' }}>MIN:{sniperConfig.minEntries}</span>}
                    {sniperConfig.linkShot && <span style={{ fontSize: 8, fontWeight: 800, color: '#2ecc71', background: 'rgba(46,204,113,0.12)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 3, padding: '1px 6px' }}>LINK</span>}
                    {sniperConfig.hideCTS && <span style={{ fontSize: 8, fontWeight: 800, color: '#e74c3c', background: 'rgba(231,76,60,0.10)', border: '1px solid rgba(231,76,60,0.20)', borderRadius: 3, padding: '1px 6px' }}>-CTS</span>}
                    {(sniperConfig.maxNA ?? 0) > 0 && <span style={{ fontSize: 8, fontWeight: 800, color: '#ff4444', background: 'rgba(255,68,68,0.10)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: 3, padding: '1px 6px' }}>☠ NA{sniperConfig.maxNA >= 10 ? '10+' : sniperConfig.maxNA}+</span>}
                    {sniperConfig.teamCooldownEnabled && <span style={{ fontSize: 8, fontWeight: 800, color: '#f5a623', background: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 3, padding: '1px 6px' }}>⏱ {sniperConfig.teamCooldownDays}d</span>}
                  </div>
                  <Settings size={14} color="#00e5ff" style={{ opacity: 0.4, flexShrink: 0, marginLeft: 8 }} />
                </button>
              </div>

              {deployError && (
                <div className="mb-3 px-3 py-2 rounded text-xs font-bold"
                  style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.35)', color: '#e74c3c', letterSpacing: '0.5px' }}>
                  ⚠ {deployError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDeployConfig(false); setPendingCityDeploy(null); setPendingRouteDeploy(null); }}
                  className="flex-shrink-0 px-4 py-3 rounded text-xs font-bold tracking-wider uppercase"
                  style={{ background: '#222', color: '#666', border: '1px solid #333', fontFamily: 'inherit' }}>
                  ABORT
                </button>
                <button onClick={handleConfirmDeploy} disabled={loading}
                  className="flex-1 py-3 rounded font-black text-sm tracking-widest uppercase transition-all"
                  style={{ background: loading ? '#333' : 'linear-gradient(135deg, #27ae60, #2ecc71)', color: loading ? '#888' : '#fff', border: 'none', fontFamily: 'inherit', letterSpacing: '3px' }}>
                  {loading ? 'DEPLOYING...' : '🎯 CONFIRM DEPLOY'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // =======================================================================
  // RENDER: DIALER MODE — Empty State
  // =======================================================================

  if (!currentState) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={S.body}>
        <DialerHUD
          session={session} activeMultipliers={multipliers} multipliersReceivedAt={multipliersAt}
          rank={rank} onTrophyClick={() => setAchievementsOpen(true)} onMenuAction={handleMenuAction}
          teamFeed={teamFeed} multiplierActivations={multActivations} autoFire={autoFire} onAutoFireChange={setAutoFire}
          managerId={manager?.repCode} lastDispType={lastDispType}
          consecutiveYes={calmConsecutiveYes} consecutiveNos={calmConsecutiveNos}
        />
        <BadgeToastContainer toasts={badgeToasts} />
        <PointToastContainer toasts={pointToasts} />
        {session && <AchievementsPanel session={session} open={achievementsOpen} onClose={() => setAchievementsOpen(false)} />}
        {campaign?.id && (
          <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} campaignId={campaign.id}
            currentUserId={manager?.id || ''} currentUserName={manager?.name || manager?.repCode || 'You'} session={session} />
        )}
        {loading ? (
          <div className="text-center" style={{ color: '#888', letterSpacing: '2px', fontSize: 12 }}>ACQUIRING TARGET...</div>
        ) : (
          <div className="text-center">
            <div className="text-4xl mb-3">🎯</div>
            <div className="text-sm font-black tracking-widest uppercase" style={{ color: '#555' }}>Mission Complete</div>
            <div className="text-xs mt-2" style={{ color: '#444', maxWidth: 300 }}>{emptyMessage}</div>
            <button
              onClick={() => {
                setMode('campaign-select');
                setActiveBook(null);
                if (books.length > 0) setCampaignCards(booksToCards(books));
                setCityCards([]);
                setRoutePrefixCards([]);
                invalidateCache();
              }}
              className="mt-4 px-4 py-2 rounded text-xs font-bold tracking-wider uppercase"
              style={{ background: 'rgba(0,20,30,0.8)', color: '#00e5ff', border: '1px solid rgba(0,229,255,0.20)' }}
            >
              Back to Campaign Select
            </button>
          </div>
        )}
      </div>
    );
  }

  // =======================================================================
  // RENDER: DIALER MODE — Active
  // =======================================================================

  const cs = currentState;
  const cl = cs.client;
  const strat = STRATEGY_COLORS[cs.phoneStrategy] || STRATEGY_COLORS.single;
  const altNames = cl.allNames.filter(n => n !== `${cl.firstName} ${cl.lastName}`.trim());
  const isDtOnly = isBCCampaign && yUpsellType === 'dethatch' && ySkipAeration;
  const isRejuv = isBCCampaign && yUpsellType === 'rejuv';

  return (
    <div className="relative h-screen overflow-hidden" style={S.body}>
      <DialerHUD
        session={session} activeMultipliers={multipliers} multipliersReceivedAt={multipliersAt}
        rank={rank} onTrophyClick={() => setAchievementsOpen(true)} onMenuAction={handleMenuAction}
        teamFeed={teamFeed} multiplierActivations={multActivations} autoFire={autoFire} onAutoFireChange={setAutoFire}
        managerId={manager?.repCode} lastDispType={lastDispType}
        consecutiveYes={calmConsecutiveYes} consecutiveNos={calmConsecutiveNos}
      />
      <BadgeToastContainer toasts={badgeToasts} />
      <PointToastContainer toasts={pointToasts} />
      {session && <AchievementsPanel session={session} open={achievementsOpen} onClose={() => setAchievementsOpen(false)} />}
      {campaign?.id && (
        <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} campaignId={campaign.id}
          currentUserId={manager?.id || ''} currentUserName={manager?.name || manager?.repCode || 'You'} session={session} />
      )}

      {cardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-lg p-5 w-80" style={{ background: '#2a2a2a', border: '1.5px solid rgba(241,196,15,0.5)', boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}>
            <div className="text-center mb-1 text-sm font-black tracking-widest uppercase" style={{ color: '#f1c40f' }}>💳 Load Magazine</div>
            <div className="text-center text-xs mb-3" style={{ color: '#888', letterSpacing: '1px' }}>{cl.firstName} {cl.lastName}</div>
            <div className="mb-2.5">
              <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontWeight: 600, fontSize: 9 }}>Card Number</label>
              <input type="text" value={ccNum} onChange={(e) => { setCcNum(e.target.value); detectCardType(e.target.value); }}
                placeholder="0000 0000 0000 0000" maxLength={19}
                className="w-full px-2.5 py-2 rounded font-mono text-base font-semibold tracking-widest"
                style={{ background: '#383838', color: '#fff', border: '1px solid #555', letterSpacing: '3px' }} />
              <div className="inline-block mt-1 px-2.5 py-0.5 rounded text-xs font-black tracking-wider" style={{
                background: ccType === 'VISA' ? 'rgba(26,35,126,0.3)' : ccType === 'MC' ? 'rgba(192,57,43,0.2)' : ccType === 'AMEX' ? 'rgba(39,174,96,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${ccType === 'VISA' ? '#1a237e' : ccType === 'MC' ? '#c0392b' : ccType === 'AMEX' ? '#27ae60' : '#555'}`,
                color: ccType === 'VISA' ? '#5c6bc0' : ccType === 'MC' ? '#e74c3c' : ccType === 'AMEX' ? '#2ecc71' : '#888',
              }}>{ccType || 'Enter card #'}</div>
            </div>
            <div className="flex gap-2.5 mb-2.5">
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontWeight: 600, fontSize: 9 }}>Expiry</label>
                <input value={ccExp} onChange={(e) => setCcExp(e.target.value)} placeholder="MM/YY" maxLength={5}
                  className="w-full px-2.5 py-2 rounded text-sm font-semibold tracking-wider" style={{ background: '#383838', color: '#fff', border: '1px solid #555' }} />
              </div>
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontWeight: 600, fontSize: 9 }}>CVV</label>
                <input value={ccCvv} onChange={(e) => setCcCvv(e.target.value)} placeholder="000" maxLength={4}
                  className="w-full px-2.5 py-2 rounded text-sm font-semibold tracking-wider" style={{ background: '#383838', color: '#fff', border: '1px solid #555' }} />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontWeight: 600, fontSize: 9 }}>Amount</label>
              <input value={ccAmt} onChange={(e) => setCcAmt(e.target.value)} placeholder="0.00"
                className="w-full px-2.5 py-2 rounded text-sm font-semibold tracking-wider" style={{ background: '#383838', color: '#fff', border: '1px solid #555' }} />
            </div>
            <div className="flex gap-2.5 pt-2.5" style={{ borderTop: '1px solid #444' }}>
              <button onClick={handleEject} className="flex-1 py-2.5 rounded text-xs font-bold tracking-wider uppercase" style={{ background: '#444', color: '#aaa' }}>Eject</button>
              <button onClick={handleChamber} disabled={cardStaging} className="flex-1 py-2.5 rounded text-xs font-bold tracking-wider uppercase"
                style={{ background: cardStaging ? '#555' : '#f1c40f', color: cardStaging ? '#888' : '#1a1a1a' }}>
                {cardStaging ? 'Staging...' : '⚡ Chamber'}
              </button>
            </div>
            {cardStatus && (
              <div className="text-center text-xs mt-2" style={{ color: cardStatus.startsWith('✓') ? '#2ecc71' : cardStatus.startsWith('Error') ? '#e74c3c' : '#888' }}>
                {cardStatus}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative z-1 flex h-full" style={{ padding: '32px 8px 50px 8px' }}>

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-2.5 py-1 flex-shrink-0" style={S.topBar}>
            <span className="text-xs uppercase tracking-wider" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 9 }}>{cs.sheetName}</span>
            <span className="font-black font-mono" style={{ color: '#00e5ff', fontSize: 15, letterSpacing: '1px' }}>
              {netAvailableCount}
            </span>
          </div>

          <div className="flex justify-between items-baseline gap-3 px-2.5 py-1.5 flex-shrink-0" style={S.clientHeader}>
            <div>
              <div className="flex items-center gap-2">
                <div className="text-base font-black tracking-wider uppercase text-white">{cl.firstName} {cl.lastName}</div>
                {cs.serviceFlags && (
                  <span className="text-xs font-black tracking-wider px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(241,196,15,0.15)', border: '1px solid rgba(241,196,15,0.35)', color: '#f1c40f', fontSize: 9 }}>
                    {cs.serviceFlags}
                  </span>
                )}
              </div>
              {altNames.length > 0 && <div className="text-xs mt-0.5" style={{ color: '#80d0d0', opacity: 0.7, fontWeight: 400 }}>aka {altNames.join(', ')}</div>}
              {cl.routeCode && <div className="text-xs font-semibold tracking-wider" style={{ color: '#00e5ff', opacity: 0.4 }}>Route: {cl.routeCode}</div>}
            </div>
            <div className="text-base font-bold tracking-wider text-right" style={{ color: '#80d0d0' }}>
              {cl.houseNum} {cl.streetName}
            </div>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1.5 flex-shrink-0" style={S.phoneBar}>
            <a href={`tel:${cs.phone}`} onClick={(e) => { e.preventDefault(); dialPhone(); }}
              className="font-mono text-lg font-black tracking-wider text-white hover:text-cyan-400 cursor-pointer no-underline">
              {formatPhoneDisplay(cs.phone)}
            </a>
            <span className="text-xs px-1.5 py-0.5 rounded font-bold tracking-wider uppercase"
              style={{ background: strat.bg, border: `1px solid ${strat.border}`, color: strat.color, fontSize: 8 }}>
              {strat.label}
            </span>
            {cs.currentNA > 0 && <span className="text-xs font-bold" style={{ color: '#e67e22', fontSize: 10 }}>NA: {cs.currentNA}</span>}
            {cs.alternatePhone && (
              <span className="text-xs font-mono cursor-pointer hover:text-cyan-400" style={{ color: '#666', fontSize: 9 }}
                onClick={() => dialPhone(cs.alternatePhone)}>
                alt: {formatPhoneDisplay(cs.alternatePhone)}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5" style={S.contentArea}>
            {showYesPanel ? (
              <div>
                <div className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 9 }}>Booking Details</div>
                <div className="flex gap-2 mb-1.5">
                  <div className="flex-1"><YesField label="First Name" value={yName} onChange={setYName} /></div>
                  <div className="flex-1"><YesField label="Last Name" value={yLastName} onChange={setYLastName} /></div>
                </div>
                <div className="flex gap-2 mb-1.5">
                  <div style={{ width: 80 }}><YesField label="House #" value={yHouseNum} onChange={setYHouseNum} /></div>
                  <div className="flex-1"><YesField label="Street Name" value={yStreetName} onChange={setYStreetName} /></div>
                </div>
                <div className="flex gap-2 mb-1.5">
                  <div style={{ width: 100 }}><YesField label="Price" value={yPrice} onChange={yPrice => setYPrice(yPrice)} /></div>
                  <div className="flex-1"><YesField label="Email" value={yEmail} onChange={setYEmail} /></div>
                </div>
                <div className="flex items-end gap-4 mb-1.5">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#ccc' }}>
                      <input type="checkbox" checked={yGate} onChange={(e) => setYGate(e.target.checked)} style={{ accentColor: '#00e5ff', width: 14, height: 14 }} /> Gate
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#ccc' }}>
                      <input type="checkbox" checked={ySprink} onChange={(e) => setYSprink(e.target.checked)} style={{ accentColor: '#00e5ff', width: 14, height: 14 }} /> Sprinkler
                    </label>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 8, letterSpacing: '1px' }}>FO / BO / FP</div>
                    <div className="flex gap-3">
                      {(['FO', 'BO', 'FP'] as const).map(val => (
                        <label key={val} className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="foRadio" checked={yFO === val} onChange={() => setYFO(val)} style={{ accentColor: '#00e5ff', width: 14, height: 14 }} />
                          <span className="text-xs font-bold" style={{ color: FO_COLORS[val].color }}>{val}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mb-2"><YesField label="Notes" value={yNotes} onChange={setYNotes} /></div>

                {isBCCampaign && (
                  <div className="mb-2 p-2 rounded" style={{ background: 'rgba(241,196,15,0.04)', border: '1px solid rgba(241,196,15,0.15)' }}>
                    <div className="text-xs uppercase tracking-widest font-bold mb-1.5" style={{ color: '#f1c40f', opacity: 0.7, fontSize: 8 }}>⚡ UPSELL</div>
                    <div className="flex gap-1.5 mb-1.5">
                      {([
                        { val: 'none' as UpsellType, label: 'No Upsell' },
                        { val: 'dethatch' as UpsellType, label: 'Dethatching' },
                        { val: 'rejuv' as UpsellType, label: 'Lawn Rejuv' },
                      ]).map(({ val, label }) => (
                        <button key={val}
                          onClick={() => { setYUpsellType(val); if (val !== 'dethatch') { setYDtPrice(''); setYDtPrepaid(false); setYSkipAeration(false); } if (val !== 'rejuv') { setYRejuvPrice(''); } }}
                          className="flex-1 py-1.5 rounded text-xs font-bold tracking-wider uppercase cursor-pointer transition-all"
                          style={{ background: yUpsellType === val ? 'rgba(241,196,15,0.15)' : 'rgba(0,10,18,0.6)', border: `1px solid ${yUpsellType === val ? 'rgba(241,196,15,0.5)' : 'rgba(255,255,255,0.08)'}`, color: yUpsellType === val ? '#f1c40f' : '#555', fontSize: 9 }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {yUpsellType === 'dethatch' && (
                      <div className="flex items-end gap-2">
                        <div style={{ width: 90 }}><YesField label="DT Price" value={yDtPrice} onChange={setYDtPrice} /></div>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer pb-1" style={{ color: '#ccc' }}>
                          <input type="checkbox" checked={yDtPrepaid} onChange={(e) => setYDtPrepaid(e.target.checked)} style={{ accentColor: '#f1c40f', width: 14, height: 14 }} />
                          <span style={{ fontSize: 9 }}>DT Prepaid</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer pb-1" style={{ color: '#ccc' }}>
                          <input type="checkbox" checked={ySkipAeration} onChange={(e) => setYSkipAeration(e.target.checked)} style={{ accentColor: '#e74c3c', width: 14, height: 14 }} />
                          <span style={{ fontSize: 9, color: ySkipAeration ? '#e74c3c' : '#ccc' }}>Skip Aeration</span>
                        </label>
                      </div>
                    )}
                    {yUpsellType === 'rejuv' && (
                      <div>
                        <div className="flex items-end gap-2">
                          <div style={{ width: 120 }}><YesField label="Rejuv Total Price" value={yRejuvPrice} onChange={setYRejuvPrice} /></div>
                        </div>
                        <div className="text-xs mt-1" style={{ color: '#f1c40f', opacity: 0.5, fontSize: 8 }}>
                          ⚠ Lawn Rejuv must be prepaid. This replaces aeration price.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setShowYesPanel(false)} className="px-3 py-2 rounded text-xs font-bold cursor-pointer" style={{ background: '#333', color: '#888', border: '1px solid #555' }}>✖ Cancel</button>
                  {isDtOnly ? (
                    <button onClick={() => doYes('COMPLETE')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer"
                      style={{ background: '#f1c40f', color: '#1a1a1a', border: 'none', letterSpacing: '2px' }}>
                      ⚡ DT Upsell Only
                    </button>
                  ) : isRejuv ? (
                    <button onClick={() => doYes('PREPAY')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer"
                      style={{ background: '#f1c40f', color: '#1a1a1a', border: 'none', letterSpacing: '2px' }}>
                      💳 Prepay (Rejuv)
                    </button>
                  ) : (
                    <>
                      <button onClick={() => doYes('COMPLETE')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer" style={{ background: '#2ecc71', color: '#fff', border: 'none', letterSpacing: '2px' }}>✔ Complete</button>
                      <button onClick={() => doYes('PREPAY')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer" style={{ background: '#f1c40f', color: '#1a1a1a', border: 'none', letterSpacing: '2px' }}>💳 Prepay</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 9 }}>Service History</div>
                {cs.serviceHistory.map((h, i) => {
                  const foC = FO_COLORS[h.fo] || FO_COLORS.FP;
                  return (
                    <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 rounded mb-1 text-xs" style={S.historyRow}>
                      <span className="font-black text-white" style={{ minWidth: 36 }}>{h.year}</span>
                      <span className="font-bold" style={{ color: '#00e5ff', minWidth: 50 }}>{h.price || '-'}</span>
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: '#888' }}>{h.contractor}</span>
                      <span className="font-bold rounded px-1.5 py-0.5" style={{ background: foC.bg, color: foC.color, fontSize: 9 }}>{h.fo || 'FP'}</span>
                      {h.pmtType && <span style={{ color: '#555', fontSize: 9 }}>{h.pmtType}</span>}
                    </div>
                  );
                })}
                {cs.nearbyAER.length > 0 && (
                  <div className="mt-1 p-2 rounded" style={S.linkShot}>
                    <div className="text-xs uppercase tracking-widest font-bold mb-0.5" style={{ color: '#00e5ff', fontSize: 9 }}>🔗 Nearby AER ({cs.nearbyAER.length})</div>
                    {cs.nearbyAER.slice(0, 10).map((a, i) => (
                      <div key={i} className="text-xs mb-0.5" style={{ color: '#aaa' }}>
                        <span className="font-bold" style={{ color: '#00e5ff' }}>{a.house}</span> {a.name}
                      </div>
                    ))}
                    {cs.nearbyAER.length > 10 && <div className="text-xs" style={{ color: '#555' }}>+{cs.nearbyAER.length - 10} more</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col" style={{ ...S.sidePanel, width: 250, minWidth: 250, maxWidth: 250 }}>
          <div className="p-2 flex-shrink-0">
            <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 8 }}>Disposition</div>
            <DispButton label="📞 NA [Z]"     onClick={() => doDisp('NA')}     flashing={flashingKey === 'NA'}     flashColor="#e67e22" style={{ background: '#333', color: '#e67e22', border: '1px solid #555' }} />
            <DispButton label="🌱 CTS [X]"    onClick={() => doDisp('CTS')}    flashing={flashingKey === 'CTS'}    flashColor="#27ae60" style={{ background: '#333', color: '#27ae60', border: '1px solid #555' }} />
            <DispButton label="🚫 WN/NIS [C]" onClick={() => doDisp('WN/NIS')} flashing={flashingKey === 'WN/NIS'} flashColor="#9b59b6" style={{ background: '#333', color: '#9b59b6', border: '1px solid #555' }} />
            <DispButton label="✖ NO [V]"      onClick={() => doDisp('NO')}     flashing={flashingKey === 'NO'}     flashColor="#e74c3c" style={{ background: '#333', color: '#e74c3c', border: '1px solid #555' }} />
            <DispButton label="🗑 REMOVE [B]"  onClick={() => doDisp('REMOVE')} flashing={flashingKey === 'REMOVE'} flashColor="#95a5a6" style={{ background: '#333', color: '#95a5a6', border: '1px solid #555' }} />
            <DispButton
              label={showYesPanel ? "✔ YES [A] ●" : "✔ YES [A]"}
              onClick={() => setShowYesPanel(true)}
              flashing={flashingKey === 'YES'}
              flashColor="#2ecc71"
              style={{ background: showYesPanel ? 'rgba(0,60,80,0.5)' : 'linear-gradient(135deg, #27ae60, #2ecc71)', color: '#fff', border: showYesPanel ? '2px solid #00e5ff' : 'none' }}
            />
          </div>

          {campaign?.id && manager?.id && manager?.repCode !== 'ROBA' && (
            <FireteamPanel
              campaignId={campaign.id}
              managerId={manager.id}
              managerName={manager.name || manager.repCode || 'You'}
              liveMultiplierEvents={multActivations}
            />
          )}

          <div className="text-center px-2 py-1 flex-shrink-0 text-xs" style={{
            color: '#00e5ff', opacity: 0.4, letterSpacing: '1px', fontSize: 8,
            borderTop: '1px solid rgba(0,229,255,0.10)', minHeight: 14,
          }}>
            {logMessage}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const DISP_FLASH_STYLES = `
  @keyframes disp-flash-glow {
    0%   { box-shadow: 0 0 0px var(--flash-color-transparent); border-color: var(--flash-color-mid); }
    40%  { box-shadow: 0 0 10px var(--flash-color-full), 0 0 20px var(--flash-color-mid); border-color: var(--flash-color-full); }
    100% { box-shadow: 0 0 0px var(--flash-color-transparent); border-color: var(--flash-color-mid); }
  }
`;

let dispStylesInjected = false;

function DispButton({
  label, onClick, style, flashing = false, flashColor = '#00e5ff',
}: {
  label: string; onClick: () => void; style: React.CSSProperties; flashing?: boolean; flashColor?: string;
}) {
  if (!dispStylesInjected && typeof document !== 'undefined') {
    const tag = document.createElement('style');
    tag.textContent = DISP_FLASH_STYLES;
    document.head.appendChild(tag);
    dispStylesInjected = true;
  }

  const flashFull = flashColor + 'cc';
  const flashMid  = flashColor + '80';
  const flashNone = flashColor + '00';

  return (
    <button
      onClick={onClick}
      className="w-full py-1.5 text-xs font-bold tracking-widest uppercase rounded mb-1 cursor-pointer transition-all"
      style={{
        ...style, letterSpacing: '2px', fontSize: 10,
        ['--flash-color-full' as any]: flashFull,
        ['--flash-color-mid' as any]: flashMid,
        ['--flash-color-transparent' as any]: flashNone,
        animation: flashing ? 'disp-flash-glow 0.3s ease-out forwards' : undefined,
      }}
    >
      {label}
    </button>
  );
}

function YesField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-1">
      <div className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 8, letterSpacing: '1px' }}>{label}</div>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-1.5 py-1 rounded text-xs"
        style={{ background: 'rgba(0,10,18,0.9)', color: '#fff', border: '1px solid rgba(0,229,255,0.15)', fontSize: 10 }} />
    </div>
  );
}