// src/pages/Dialer/DialerPage.tsx
//
// AutoSniper Dialer — full calling interface.
// Three modes:
//   1. Campaign Select — video-game-style map/tab picker
//   2. Dialer — active calling UI
//   3. Empty — mission complete / no groups
//
// Presence heartbeat: publishes every 30s while in dialer mode.
// Tab switches update the heartbeat campaign_id in real time.
// clearPresence fires on unmount and when returning to campaign select.
//
// Resume Game: on mount, reads the manager's most recent dialer_sessions row
// from Supabase and offers a "LAST OPERATION DETECTED — RESUME" banner on
// the Campaign Select screen. Clicking Resume skips the deploy config modal
// and jumps straight back in with position + gamification restored.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, ArrowDown, ArrowUp, Crosshair, Phone, ChevronRight, ChevronLeft, Settings } from 'lucide-react';
import { campaignService, getTodayEST } from '../../lib/campaignService';
import type { SniperConfig, ResumeData } from '../../lib/campaignService';
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
  formatPhoneDisplay,
  getActiveMultipliers,
  getCurrentRank,
  createFreshSession,
  setResumePosition,
} from '../../lib/dialer';
import type {
  EngineConfig,
  EngineSnapshot,
  DialerState,
  Direction,
  DispositionType,
  DispositionExtra,
  GamificationSession,
  MultiplierSnapshot,
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

// =============================================================================
// RESUME HELPERS
// =============================================================================

/**
 * Formats a "last seen" string for the resume banner.
 * e.g. "2h ago", "Yesterday", "3d ago"
 */
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
// COMPONENT
// =============================================================================

export default function DialerPage() {
  const navigate = useNavigate();

  // --- Auth ---
  const [manager, setManager] = useState<any>(null);
  const [campaign, setCampaign] = useState<any>(null);

  // --- Mode ---
  const [mode, setMode] = useState<'campaign-select' | 'dialer'>('campaign-select');

  // --- Resume ---
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);

  // --- Campaign Select state ---
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [campaignCards, setCampaignCards] = useState<CampaignCard[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');

  // --- Launcher config ---
  const [selectedTab, setSelectedTab] = useState('');
  const [direction, setDirection] = useState<Direction>('down');
  const [startBookingId, setStartBookingId] = useState('');
  const [showDeployConfig, setShowDeployConfig] = useState(false);
  const [deployingTab, setDeployingTab] = useState('');

  // --- Sniper Settings ---
  const [sniperSettingsOpen, setSniperSettingsOpen] = useState(false);
  const [sniperConfig, setSniperConfig] = useState<SniperConfig>(
    () => campaign?.sniperConfig || { years: [2025], ppOnly: false, minEntries: 1, linkShot: false, hideCTS: true, maxNA: 0 }
  );
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  // --- Dialer state ---
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

  // --- Hotkey flash ---
  const [flashingKey, setFlashingKey] = useState<HotkeyTarget | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- YES form fields ---
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

  // --- Card entry ---
  const [ccNum, setCcNum] = useState('');
  const [ccExp, setCcExp] = useState('');
  const [ccCvv, setCcCvv] = useState('');
  const [ccAmt, setCcAmt] = useState('');
  const [ccType, setCcType] = useState('');
  const [cardStaging, setCardStaging] = useState(false);
  const [cardStatus, setCardStatus] = useState('');

  // --- Gamification ---
  const [session, setSession] = useState<GamificationSession | null>(null);
  const [multipliers, setMultipliers] = useState<MultiplierSnapshot[]>([]);
  const [multipliersAt, setMultipliersAt] = useState(0);
  const [rank, setRank] = useState<Rank | null>(null);

  // --- HUD team feed toasts (other managers' bookings) ---
  const [teamFeed, setTeamFeed] = useState<TeamBookingEvent[]>([]);

  // --- Multiplier activation toasts + live panel events ---
  const [multActivations, setMultActivations] = useState<MultiplierActivationEvent[]>([]);
  const prevOwnMultipliersRef = useRef<MultiplierSnapshot[]>([]);

  // --- Active tab being dialed (for presence heartbeat) ---
  const [activeDialTab, setActiveDialTab] = useState('');

  // --- Presence heartbeat ref ---
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Engine config ---
  const configRef = useRef<EngineConfig | null>(null);
  const yesStartTimeRef = useRef(0);
  const dispositionedKeysRef = useRef<Set<string>>(new Set());

  // --- Toasts ---
  const { badgeToasts, pointToasts, queueBadgeToast, showPointToast } = useToasts();

  // =======================================================================
  // AUTH CHECK
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
    if (cmp.sniperConfig) {
      setSniperConfig(cmp.sniperConfig);
    }
  }, [navigate]);

  // =======================================================================
  // RESUME DATA — load on mount once manager is known
  // =======================================================================

  useEffect(() => {
    if (!manager?.id) return;
    setResumeLoading(true);
    campaignService.getResumeData(manager.id)
      .then(data => {
        setResumeData(data);
      })
      .catch(() => {
        // Non-critical — just don't show the banner
      })
      .finally(() => setResumeLoading(false));
  }, [manager?.id]);

  // =======================================================================
  // AUTO-CONNECT
  // =======================================================================

  useEffect(() => {
    if (!campaign || connected || connecting) return;
    handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);

  // =======================================================================
  // PRESENCE HEARTBEAT — publishes every 30s while in dialer mode
  // Clears on unmount, or when returning to campaign-select
  // =======================================================================

  const startHeartbeat = useCallback((managerId: string, managerName: string, tabCampaignId: string) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);

    // Fire immediately
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

  // Clear presence and stop heartbeat on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
      if (manager?.id) {
        dialerRealtimeService.clearPresence(manager.id).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager?.id]);

  // When tab being dialed changes, restart heartbeat with new campaign ID
  useEffect(() => {
    if (mode !== 'dialer' || !manager?.id || !activeDialTab) return;
    startHeartbeat(
      manager.id,
      manager.name || manager.repCode || 'Unknown',
      activeDialTab,
    );
    return () => stopHeartbeat();
  }, [mode, activeDialTab, manager?.id, manager?.name, manager?.repCode, startHeartbeat, stopHeartbeat]);

  // When returning to campaign select, clear presence
  useEffect(() => {
    if (mode === 'campaign-select' && manager?.id) {
      stopHeartbeat();
      dialerRealtimeService.clearPresence(manager.id).catch(() => {});
    }
  }, [mode, manager?.id, stopHeartbeat]);

  // =======================================================================
  // TEAM FEED — HUD toasts only (FireteamPanel handles its own data)
  // =======================================================================

  useEffect(() => {
    if (!campaign?.id || !manager?.id) return;

    const unsubscribe = dialerRealtimeService.subscribeToTeamFeed(
      campaign.id,
      manager.id,
      (event) => {
        setTeamFeed(prev => [...prev, event]);
      }
    );

    return () => { unsubscribe(); };
  }, [campaign?.id, manager?.id]);

  // =======================================================================
  // OWN MULTIPLIER ACTIVATION DETECTION + PUBLISH TO SUPABASE
  // =======================================================================

  useEffect(() => {
    const prev = prevOwnMultipliersRef.current;
    const activations = detectNewlyActivated(
      prev,
      multipliers,
      manager?.name || manager?.repCode || 'You',
      true,
    );
    if (activations.length > 0) {
      setMultActivations(p => [...p, ...activations]);

      // Publish each activation to Supabase so teammates see it in FireteamPanel
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

      if (target === 'YES') {
        setShowYesPanel(true);
      } else {
        doDisp(target as DispositionType);
      }
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
      if (campaign?.spreadsheetId) {
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
                  ? {
                      ...card,
                      totalRows:    stats.totalRows,
                      bookings:     stats.bookings,
                      reachedPct:   stats.reachedPct,
                      avgAttempts:  stats.avgAttempts,
                      lastDeployed: stats.lastUsed ?? undefined,
                    }
                  : card
              ));
            } catch {
              // Non-critical
            }
          });
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

  const handleCampaignDeploy = async (tabId: string) => {
    setDeployingTab(tabId);
    setSelectedTab(tabId);
    setDirection('down');
    setStartBookingId('');
    setShowDeployConfig(true);

    if (campaign?.spreadsheetId) {
      try {
        const years = await discoverAvailableYears(campaign.spreadsheetId, tabId);
        setAvailableYears(years);
      } catch {
        // Non-critical
      }
    }
  };

  const handleConfirmDeploy = async () => {
    if (!selectedTab || !campaign) return;
    setShowDeployConfig(false);
    setLoading(true);
    setLogMessage('Acquiring target...');

    const config: EngineConfig = {
      spreadsheetId: campaign.spreadsheetId,
      sheetName: selectedTab,
      direction,
      startRow: 2,
      repCode: manager?.repCode || '',
      managerId: manager?.id || '',
      campaignId: campaign?.id || '',
      sniperConfig,
      startBookingId: startBookingId.trim() || undefined,
    };
    configRef.current = config;

    try {
      const snapshot = await initialize(config);
      if (!snapshot) {
        setEmptyMessage('No available groups found in this tab.');
        setMode('dialer');
        setLoading(false);
        return;
      }
      setCurrentState(snapshot.state);
      setSession(snapshot.session);
      const newMults = getActiveMultipliers(snapshot.session);
      setMultipliers(newMults);
      setMultipliersAt(Date.now());
      setRank(getCurrentRank(snapshot.session));
      prevOwnMultipliersRef.current = newMults;
      prefillYesForm(snapshot.state);

      // Track resume position immediately
      const bookingId = snapshot.state.bookingId || '';
      setResumePosition(selectedTab, bookingId, snapshot.state.firstRow);

      // Start presence heartbeat
      setActiveDialTab(selectedTab);
      setMode('dialer');
    } catch (err: any) {
      setEmptyMessage(err.message || 'Failed to initialize dialer.');
      setMode('dialer');
    } finally {
      setLoading(false);
    }
  };

  // =======================================================================
  // RESUME DEPLOY — skips deploy config, jumps straight into last position
  // =======================================================================

  const handleResumeDeploy = async () => {
    if (!resumeData || !campaign) return;

    const tab       = resumeData.tab;
    const position  = resumeData.position;
    const isToday   = resumeData.sessionDate === getTodayEST();

    // Parse position: either a booking ID or "ROW:N"
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
      spreadsheetId: campaign.spreadsheetId,
      sheetName: tab,
      direction: 'down',
      startRow: startRowResume,
      repCode: manager?.repCode || '',
      managerId: manager?.id || '',
      campaignId: campaign?.id || '',
      sniperConfig,
      startBookingId: startBookingIdResume,
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

      setCurrentState(snapshot.state);

      // Restore gamification only if same day
      if (isToday) {
        setSession(snapshot.session);
        const newMults = getActiveMultipliers(snapshot.session);
        setMultipliers(newMults);
        setMultipliersAt(Date.now());
        setRank(getCurrentRank(snapshot.session));
        prevOwnMultipliersRef.current = newMults;
      } else {
        // New day — fresh gamification, keep position
        setSession(snapshot.session);
        setMultipliers([]);
        setMultipliersAt(Date.now());
        setRank(null);
        prevOwnMultipliersRef.current = [];
      }

      prefillYesForm(snapshot.state);

      // Update resume position to where we landed
      const newBookingId = snapshot.state.bookingId || '';
      setResumePosition(tab, newBookingId, snapshot.state.firstRow);

      setActiveDialTab(tab);
      setMode('dialer');
      setLogMessage('Operation resumed.');
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
  }, []);

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

    // Update resume position every time we advance to a new group
    const bookingId = state.bookingId || '';
    if (configRef.current?.sheetName) {
      setResumePosition(configRef.current.sheetName, bookingId, state.firstRow);
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
    if (result.newBadges?.length > 0) { for (const id of result.newBadges) queueBadgeToast(id); }
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
        // Refresh resume data when returning to campaign select,
        // so the banner reflects the most recent position
        if (manager?.id) {
          campaignService.getResumeData(manager.id).then(setResumeData).catch(() => {});
        }
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
        renderNewState(result.nextState as DialerState);
        if (autoFire) dialPhone((result.nextState as DialerState).phone);
      } else {
        renderNewState(null, (result.nextState as any).message);
      }
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

    try {
      if (subType === 'PREPAY') {
        // Just store everything in the engine — no sheet writes, no gamification yet.
        // All of that fires in handleChamber after the rep enters card details.
        await applyDisposition(
          configRef.current, currentState, 'PREPAY', currentState.phone, session!, extra, yesStartTimeRef.current
        );
        // Pre-fill the amount field in the card modal from what was entered in the YES form
        setCcAmt(yPrice.trim());
        setCcNum(''); setCcExp(''); setCcCvv(''); setCcType(''); setCardStatus(''); setCardStaging(false);
        setCardModalOpen(true);
        setPendingDial(false);
      } else {
        const result = await applyDisposition(
          configRef.current, currentState, 'COMPLETE', currentState.phone, session!, extra, yesStartTimeRef.current
        );
        handleGamResult(result.gamification, true, false);
        if (result.nextState.found) { renderNewState(result.nextState as DialerState); if (autoFire) dialPhone((result.nextState as DialerState).phone); }
        else { renderNewState(null, (result.nextState as any).message); }
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
      // finalizePrepay now handles sheet writes + gamification + CCD
      const result = await finalizePrepay(configRef.current!, cardData, session!);
      // Fire gamification result now that everything has been written
      handleGamResult(result.gamification, true, true, ccAmt.trim());
      setCardStatus('✓ Card staged');
      setTimeout(() => {
        setCardModalOpen(false);
        if (result.nextState.found) { renderNewState(result.nextState as DialerState); if (autoFire) dialPhone((result.nextState as DialerState).phone); }
        else { renderNewState(null, (result.nextState as any).message); }
      }, 800);
    } catch (err: any) {
      setCardStatus(`Error: ${err.message}`);
      setCardStaging(false);
    }
  };

  const handleEject = () => {
    // Cancel the pending prepay — no sheet writes have happened yet, so the
    // group is completely clean. Remove the group key lock so the rep can
    // re-disposition (e.g. book as COMPLETE instead).
    cancelPrepay();
    setCardModalOpen(false);
    if (currentState) dispositionedKeysRef.current.delete(currentState.groupKey);
    setPendingDial(false);
    // Return to YES form so rep can choose COMPLETE or try prepay again
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
    if (connecting || tabsLoading) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center" style={S.body}>
          <Crosshair className="mb-4 animate-pulse" size={40} color="#00e5ff" />
          <div className="text-sm font-bold tracking-widest uppercase" style={{ color: '#00e5ff', opacity: 0.6, letterSpacing: '4px' }}>
            {connecting ? 'CONNECTING TO GOOGLE SHEETS...' : 'LOADING CALLBOOKS...'}
          </div>
          <div className="text-xs mt-2" style={{ color: '#555' }}>
            {campaign?.displayName || ''} — {manager?.name || manager?.repCode || ''}
          </div>
        </div>
      );
    }

    if (!connected && !connecting) {
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

    if (tabsError && tabs.length === 0) {
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
          onSettingsClick={() => {
            if (availableYears.length === 0 && campaign?.spreadsheetId && tabs.length > 0) {
              discoverAvailableYears(campaign.spreadsheetId, tabs[0]).then(setAvailableYears).catch(() => {});
            }
            setSniperSettingsOpen(true);
          }}
          campaignId={campaign?.id}
          managerId={manager?.id}
          managerName={manager?.name || manager?.repCode || ''}
          resumeData={resumeData}
          resumeLoading={resumeLoading}
          onResume={handleResumeDeploy}
        />

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
            onClick={() => setShowDeployConfig(false)}
          >
            <div
              className="rounded-lg p-6 w-full max-w-sm"
              style={{
                background: 'rgba(0,14,22,0.96)',
                border: `1.5px solid rgba(0,229,255,0.3)`,
                boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,255,0.10)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-4">
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '3px', color: '#00e5ff', opacity: 0.5, textTransform: 'uppercase' }}>
                  MISSION PARAMETERS
                </div>
                <div className="text-base font-black tracking-wider uppercase mt-1" style={{ color: '#fff' }}>
                  {deployingTab}
                </div>
              </div>

              <div className="mb-4">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  APPROACH VECTOR
                </div>
                <div className="flex gap-2">
                  {([
                    ['down', '⬇️ Down', '#0f3460'],
                    ['up', '⬆️ Up', '#533483'],
                    ['scatter', '🎯 Scatter', '#e94560'],
                  ] as const).map(([dir, label, bg]) => (
                    <button
                      key={dir}
                      onClick={() => setDirection(dir as Direction)}
                      className="flex-1 py-2.5 rounded text-xs font-bold tracking-wider uppercase transition-all"
                      style={{
                        background: direction === dir ? bg : '#1a2e1a',
                        color: direction === dir ? '#fff' : '#666',
                        border: direction === dir ? `1.5px solid ${bg}` : '1.5px solid rgba(0,229,255,0.15)',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
                  STARTING BOOKING ID <span style={{ opacity: 0.4 }}>(OPTIONAL)</span>
                </div>
                <input
                  type="text"
                  value={startBookingId}
                  onChange={(e) => setStartBookingId(e.target.value)}
                  placeholder="e.g. ACE01-042"
                  className="w-full px-3 py-2 rounded text-sm font-mono"
                  style={S.yesInput}
                />
              </div>

              <div className="mb-5">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#00e5ff', opacity: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
                  SNIPER SCOPE
                </div>
                <button
                  onClick={() => setSniperSettingsOpen(true)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded transition-all"
                  style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.15)', cursor: 'pointer' }}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {sniperConfig.years.map(yr => (
                      <span key={yr} style={{
                        fontSize: 9, fontWeight: 800, color: '#00e5ff',
                        background: 'rgba(0,229,255,0.12)', border: '1px solid rgba(0,229,255,0.25)',
                        borderRadius: 3, padding: '1px 6px', letterSpacing: '0.5px',
                      }}>{yr}</span>
                    ))}
                    {sniperConfig.ppOnly && <span style={{ fontSize: 8, fontWeight: 800, color: '#f1c40f', background: 'rgba(241,196,15,0.12)', border: '1px solid rgba(241,196,15,0.25)', borderRadius: 3, padding: '1px 6px' }}>PP</span>}
                    {sniperConfig.minEntries > 1 && <span style={{ fontSize: 8, fontWeight: 800, color: '#f5a623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 3, padding: '1px 6px' }}>MIN:{sniperConfig.minEntries}</span>}
                    {sniperConfig.linkShot && <span style={{ fontSize: 8, fontWeight: 800, color: '#2ecc71', background: 'rgba(46,204,113,0.12)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 3, padding: '1px 6px' }}>LINK</span>}
                    {sniperConfig.hideCTS && <span style={{ fontSize: 8, fontWeight: 800, color: '#e74c3c', background: 'rgba(231,76,60,0.10)', border: '1px solid rgba(231,76,60,0.20)', borderRadius: 3, padding: '1px 6px' }}>-CTS</span>}
                    {(sniperConfig.maxNA ?? 0) > 0 && <span style={{ fontSize: 8, fontWeight: 800, color: '#ff4444', background: 'rgba(255,68,68,0.10)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: 3, padding: '1px 6px' }}>☠ NA{sniperConfig.maxNA >= 10 ? '10+' : sniperConfig.maxNA}+</span>}
                  </div>
                  <Settings size={14} color="#00e5ff" style={{ opacity: 0.4, flexShrink: 0, marginLeft: 8 }} />
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeployConfig(false)}
                  className="flex-shrink-0 px-4 py-3 rounded text-xs font-bold tracking-wider uppercase"
                  style={{ background: '#222', color: '#666', border: '1px solid #333', fontFamily: 'inherit' }}
                >
                  ABORT
                </button>
                <button
                  onClick={handleConfirmDeploy}
                  disabled={loading}
                  className="flex-1 py-3 rounded font-black text-sm tracking-widest uppercase transition-all"
                  style={{
                    background: loading ? '#333' : 'linear-gradient(135deg, #27ae60, #2ecc71)',
                    color: loading ? '#888' : '#fff',
                    border: 'none', fontFamily: 'inherit', letterSpacing: '3px',
                  }}
                >
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
              onClick={() => { setMode('campaign-select'); invalidateCache(); }}
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

  return (
    <div className="relative h-screen overflow-hidden" style={S.body}>
      <DialerHUD
        session={session} activeMultipliers={multipliers} multipliersReceivedAt={multipliersAt}
        rank={rank} onTrophyClick={() => setAchievementsOpen(true)} onMenuAction={handleMenuAction}
        teamFeed={teamFeed} multiplierActivations={multActivations} autoFire={autoFire} onAutoFireChange={setAutoFire}
      />
      <BadgeToastContainer toasts={badgeToasts} />
      <PointToastContainer toasts={pointToasts} />
      {session && <AchievementsPanel session={session} open={achievementsOpen} onClose={() => setAchievementsOpen(false)} />}
      {campaign?.id && (
        <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} campaignId={campaign.id}
          currentUserId={manager?.id || ''} currentUserName={manager?.name || manager?.repCode || 'You'} session={session} />
      )}

      {/* Card entry modal */}
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

      {/* Main dialer layout */}
      <div className="relative z-1 flex h-full" style={{ padding: '32px 8px 50px 8px' }}>

        {/* LEFT: Main column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-2.5 py-1 flex-shrink-0" style={S.topBar}>
            <span className="text-xs uppercase tracking-wider" style={{ color: '#00e5ff', opacity: 0.5, fontSize: 9 }}>{cs.sheetName}</span>
            <span className="text-xs font-bold tracking-wider" style={{ color: '#00e5ff', fontSize: 9 }}>{cs.currentGroupIndex} / {cs.totalGroups}</span>
          </div>

          <div className="flex justify-between items-baseline gap-3 px-2.5 py-1.5 flex-shrink-0" style={S.clientHeader}>
            <div>
              <div className="text-base font-black tracking-wider uppercase text-white">{cl.firstName} {cl.lastName}</div>
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
                  <div style={{ width: 100 }}><YesField label="Price" value={yPrice} onChange={setYPrice} /></div>
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
                <div className="flex gap-2">
                  <button onClick={() => setShowYesPanel(false)} className="px-3 py-2 rounded text-xs font-bold cursor-pointer" style={{ background: '#333', color: '#888', border: '1px solid #555' }}>✖ Cancel</button>
                  <button onClick={() => doYes('COMPLETE')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer" style={{ background: '#2ecc71', color: '#fff', border: 'none', letterSpacing: '2px' }}>✔ Complete</button>
                  <button onClick={() => doYes('PREPAY')} className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer" style={{ background: '#f1c40f', color: '#1a1a1a', border: 'none', letterSpacing: '2px' }}>💳 Prepay</button>
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

        {/* RIGHT: Side panel */}
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
              style={{
                background: showYesPanel ? 'rgba(0,60,80,0.5)' : 'linear-gradient(135deg, #27ae60, #2ecc71)',
                color: '#fff',
                border: showYesPanel ? '2px solid #00e5ff' : 'none',
              }}
            />
          </div>

          {campaign?.id && manager?.id && (
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