// src/pages/Dialer/DialerPage.tsx
//
// AutoSniper Dialer — full calling interface.
// Three modes:
//   1. Campaign Select — video-game-style map/tab picker (replaces old launcher)
//   2. Dialer — active calling UI
//   3. Empty — mission complete / no groups
//
// Consumes the Stage 3 engine for all data operations.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, ArrowDown, ArrowUp, Crosshair, Phone, ChevronRight, ChevronLeft } from 'lucide-react';
import { campaignService } from '../../lib/campaignService';
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
  formatPhoneDisplay,
  getActiveMultipliers,
  getCurrentRank,
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
import type { TeamBookingEvent } from './DialerHUD';
import AchievementsPanel from './AchievementsPanel';
import { useToasts, BadgeToastContainer, PointToastContainer } from './DialerToasts';
import CampaignSelect from './CampaignSelect';
import type { Campaign as CampaignCard } from './CampaignSelect';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';

// =============================================================================
// STYLES (inline style objects for elements not easily done in Tailwind)
// =============================================================================

const S = {
  body: { background: '#0a120a', color: '#e0e0e0', fontFamily: '"Segoe UI", Arial, sans-serif' } as React.CSSProperties,
  topBar: { background: '#0f1a0f', borderBottom: '1px solid rgba(46,204,113,0.15)' } as React.CSSProperties,
  clientHeader: { background: '#0f1a0f', borderBottom: '1px solid rgba(46,204,113,0.12)' } as React.CSSProperties,
  phoneBar: { background: '#0d170d', borderBottom: '1px solid rgba(46,204,113,0.12)' } as React.CSSProperties,
  contentArea: { background: '#0d1a0d' } as React.CSSProperties,
  sidePanel: { background: '#0f1a0f', borderLeft: '1px solid rgba(46,204,113,0.2)' } as React.CSSProperties,
  historyRow: { background: '#0f1a0f', border: '1px solid rgba(46,204,113,0.1)' } as React.CSSProperties,
  linkShot: { background: '#1e2d1e', border: '1px solid #2d4a2d' } as React.CSSProperties,
  yesInput: { background: '#0d170d', color: '#fff', border: '1px solid rgba(46,204,113,0.2)' } as React.CSSProperties,
};

// FO badge colors
const FO_COLORS: Record<string, { bg: string; color: string }> = {
  FO: { bg: 'rgba(231,76,60,0.2)', color: '#e74c3c' },
  BO: { bg: 'rgba(243,156,18,0.2)', color: '#f39c12' },
  FP: { bg: 'rgba(46,204,113,0.2)', color: '#2ecc71' },
};

// Phone strategy badge colors
const STRATEGY_COLORS: Record<string, { bg: string; border: string; color: string; label: string }> = {
  single:   { bg: 'rgba(46,204,113,0.15)',  border: '#2ecc71', color: '#2ecc71', label: 'SINGLE' },
  dominant: { bg: 'rgba(243,156,18,0.15)',   border: '#f39c12', color: '#f39c12', label: 'DOMINANT' },
  even:     { bg: 'rgba(231,76,60,0.15)',    border: '#e74c3c', color: '#e74c3c', label: 'EVEN' },
};

// =============================================================================
// HELPERS — convert spreadsheet tabs into CampaignSelect-compatible cards
// =============================================================================

/**
 * Convert a list of callbook tab names into CampaignCard objects
 * for the video-game style selector. We generate codenames, terrain
 * types, and threat levels procedurally from the tab name hash.
 */
function tabsToCampaignCards(tabs: string[], campaignName: string): CampaignCard[] {
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

  return tabs.map((tabName, idx) => {
    // Simple hash from tab name for procedural variety
    let h = 0;
    for (let i = 0; i < tabName.length; i++) h = ((h << 5) - h + tabName.charCodeAt(i)) | 0;
    const a = Math.abs(h);

    return {
      id: tabName,
      name: tabName,
      codename: CODENAMES[a % CODENAMES.length],
      description: `Callbook tab "${tabName}" from ${campaignName}. Deploy here to start dialing this section.`,
      totalRows: 400 + (a % 2400),
      bookings: 10 + (a % 80),
      reachedPct: 15 + (a % 60),
      avgAttempts: 1 + (a % 4),
      zone: ['North', 'South', 'East', 'West', 'Central', 'Downtown'][(a >> 4) % 6],
      terrain: TERRAINS[(a >> 2) % TERRAINS.length],
      hot: idx === 0, // First tab is "hot" / featured
    };
  });
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

  // --- Campaign Select state ---
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [campaignCards, setCampaignCards] = useState<CampaignCard[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');

  // --- Launcher config (set during deploy) ---
  const [selectedTab, setSelectedTab] = useState('');
  const [direction, setDirection] = useState<Direction>('down');
  const [startBookingId, setStartBookingId] = useState('');
  const [showDeployConfig, setShowDeployConfig] = useState(false);
  const [deployingTab, setDeployingTab] = useState('');

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

  // --- Card entry fields ---
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

  // --- Team feed (other managers' bookings) ---
  const [teamFeed, setTeamFeed] = useState<TeamBookingEvent[]>([]);

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
  }, [navigate]);

  // =======================================================================
  // AUTO-CONNECT on mount (so tabs load immediately for Campaign Select)
  // =======================================================================

  useEffect(() => {
    if (!campaign || connected || connecting) return;
    handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);

  // =======================================================================
  // TEAM FEED — Supabase Realtime subscription
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

    return () => {
      unsubscribe();
    };
  }, [campaign?.id, manager?.id]);

  // =======================================================================
  // CONNECT TO SHEETS
  // =======================================================================

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await dialerSheetsService.authenticate();
      setConnected(true);
      // Auto-load tabs
      if (campaign?.spreadsheetId) {
        setTabsLoading(true);
        setTabsError('');
        try {
          const callbookTabs = await dialerSheetsService.getCallbookTabs(campaign.spreadsheetId);
          setTabs(callbookTabs);
          setCampaignCards(tabsToCampaignCards(callbookTabs, campaign.displayName || 'Campaign'));
        } catch (err: any) {
          setTabsError(err.message || 'Failed to load tabs');
        } finally {
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

  /** User clicks Deploy on a campaign card — show direction picker overlay */
  const handleCampaignDeploy = (tabId: string) => {
    setDeployingTab(tabId);
    setSelectedTab(tabId);
    setDirection('down');
    setStartBookingId('');
    setShowDeployConfig(true);
  };

  /** User confirms direction and deploys */
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
      appsScriptUrl: campaign.appsScriptUrl || '',
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
      setMultipliers(getActiveMultipliers(snapshot.session));
      setMultipliersAt(Date.now());
      setRank(getCurrentRank(snapshot.session));
      prefillYesForm(snapshot.state);
      setMode('dialer');
    } catch (err: any) {
      setEmptyMessage(err.message || 'Failed to initialize dialer.');
      setMode('dialer');
    } finally {
      setLoading(false);
    }
  };

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
  }, []);

  // =======================================================================
  // HANDLE GAMIFICATION RESULT
  // =======================================================================

  const handleGamResult = useCallback((result: any) => {
    if (!result) return;
    if (result.session) {
      setSession(result.session);
    }
    if (result.rank) setRank(result.rank);
    if (result.activeMultipliers) {
      setMultipliers(result.activeMultipliers);
      setMultipliersAt(Date.now());
    }
    if (result.newBadges?.length > 0) {
      for (const id of result.newBadges) queueBadgeToast(id);
    }
    if (result.pointBreakdown) {
      showPointToast(result.pointBreakdown.grandTotal, result.pointBreakdown.multiplier);

      // Publish to team feed so other managers see this booking
      if (campaign?.id && manager?.id && result.pointBreakdown.grandTotal > 0) {
        dialerRealtimeService.publishBookingEvent({
          campaignId: campaign.id,
          managerId: manager.id,
          managerName: manager.name || manager.repCode || 'Unknown',
          points: result.pointBreakdown.grandTotal,
          badges: result.newBadges || [],
          multipliers: result.activeMultipliers?.map((m: any) => m.id) || [],
          isPrepay: result.pointBreakdown.isPrepay || false,
        });
      }
    }
  }, [queueBadgeToast, showPointToast, campaign?.id, manager?.id, manager?.name, manager?.repCode]);

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

    try {
      const result = await applyDisposition(
        configRef.current,
        currentState,
        disp,
        currentState.phone,
        session!,
        {},
        yesStartTimeRef.current
      );

      handleGamResult(result.gamification);

      // WN/NIS redial
      if (result.redialPhone) {
        dispositionedKeysRef.current.delete(key);
        setCurrentState(prev => prev ? { ...prev, phone: result.redialPhone!, alternatePhone: '' } : null);
        setLogMessage('Redial: alternate phone');
        if (autoFire) dialPhone(result.redialPhone);
        setPendingDial(false);
        return;
      }

      // Advance
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

    const extra: DispositionExtra = {
      name: yName.trim(),
      lastName: yLastName.trim(),
      houseNum: yHouseNum.trim(),
      streetName: yStreetName.trim(),
      price: yPrice.trim(),
      email: yEmail.trim(),
      gate: yGate,
      sprinkler: ySprink,
      foValue: yFO,
      notes: yNotes.trim(),
    };

    try {
      if (subType === 'PREPAY') {
        const result = await applyDisposition(
          configRef.current,
          currentState,
          'PREPAY',
          currentState.phone,
          session!,
          extra,
          yesStartTimeRef.current
        );
        handleGamResult(result.gamification);

        setCcAmt(yPrice.trim());
        setCcNum('');
        setCcExp('');
        setCcCvv('');
        setCcType('');
        setCardStatus('');
        setCardStaging(false);
        setCardModalOpen(true);
        setPendingDial(false);
      } else {
        const result = await applyDisposition(
          configRef.current,
          currentState,
          'COMPLETE',
          currentState.phone,
          session!,
          extra,
          yesStartTimeRef.current
        );
        handleGamResult(result.gamification);

        if (result.nextState.found) {
          renderNewState(result.nextState as DialerState);
          if (autoFire) dialPhone((result.nextState as DialerState).phone);
        } else {
          renderNewState(null, (result.nextState as any).message);
        }
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

    setCardStaging(true);
    setCardStatus('Staging card...');

    try {
      const cardData = stageCardData(num, ccExp.trim(), ccCvv.trim(), ccAmt.trim());
      const result = await finalizePrepay(configRef.current!, cardData, session!);

      handleGamResult(result.gamification);
      setCardStatus('✓ Card staged');
      setTimeout(() => {
        setCardModalOpen(false);
        if (result.nextState.found) {
          renderNewState(result.nextState as DialerState);
          if (autoFire) dialPhone((result.nextState as DialerState).phone);
        } else {
          renderNewState(null, (result.nextState as any).message);
        }
      }, 800);
    } catch (err: any) {
      setCardStatus(`Error: ${err.message}`);
      setCardStaging(false);
    }
  };

  const handleEject = () => {
    cancelPrepay();
    setCardModalOpen(false);
    if (currentState) {
      dispositionedKeysRef.current.delete(currentState.groupKey);
    }
    setPendingDial(false);
    setLogMessage('Prepay cancelled — re-disposition available.');
  };

  // =======================================================================
  // PHONE DIALING
  // =======================================================================

  const dialPhone = (phone?: string) => {
    const ph = phone || currentState?.phone;
    if (ph) window.open(`tel:${ph}`, '_self');
  };

  // =======================================================================
  // RENDER: CAMPAIGN SELECT MODE
  // =======================================================================

  if (mode === 'campaign-select') {
    // Loading / connecting state
    if (connecting || tabsLoading) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center" style={S.body}>
          <Crosshair className="mb-4 animate-pulse" size={40} color="#2ecc71" />
          <div className="text-sm font-bold tracking-widest uppercase" style={{ color: '#2ecc71', opacity: 0.6, letterSpacing: '4px' }}>
            {connecting ? 'CONNECTING TO GOOGLE SHEETS...' : 'LOADING CALLBOOKS...'}
          </div>
          <div className="text-xs mt-2" style={{ color: '#555' }}>
            {campaign?.displayName || ''} — {manager?.name || manager?.repCode || ''}
          </div>
        </div>
      );
    }

    // Connection failed
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

    // Error loading tabs
    if (tabsError && tabs.length === 0) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6" style={S.body}>
          <div className="text-sm font-bold tracking-widest uppercase mb-2" style={{ color: '#e74c3c' }}>
            FAILED TO LOAD TABS
          </div>
          <div className="text-xs mb-4" style={{ color: '#888' }}>{tabsError}</div>
          <button
            onClick={handleConnect}
            className="px-6 py-3 rounded font-bold text-sm tracking-wider uppercase"
            style={{ background: '#1a2e1a', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)' }}
          >
            Retry
          </button>
        </div>
      );
    }

    // Campaign Select screen with deploy config overlay
    return (
      <>
        <CampaignSelect
          campaigns={campaignCards}
          onDeploy={handleCampaignDeploy}
        />

        {/* Deploy Config Overlay — direction + optional booking ID */}
        {showDeployConfig && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowDeployConfig(false)}
          >
            <div
              className="rounded-lg p-6 w-full max-w-sm"
              style={{
                background: '#0f1a0f',
                border: '1.5px solid rgba(46,204,113,0.4)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 30px rgba(46,204,113,0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="text-center mb-4">
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '3px', color: '#2ecc71', opacity: 0.5, textTransform: 'uppercase' }}>
                  MISSION PARAMETERS
                </div>
                <div className="text-base font-black tracking-wider uppercase mt-1" style={{ color: '#fff' }}>
                  {deployingTab}
                </div>
              </div>

              {/* Direction */}
              <div className="mb-4">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#2ecc71', opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
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
                        border: direction === dir ? `1.5px solid ${bg}` : '1.5px solid rgba(46,204,113,0.15)',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional booking ID */}
              <div className="mb-5">
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: '#2ecc71', opacity: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
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

              {/* Action buttons */}
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
                    border: 'none',
                    fontFamily: 'inherit',
                    letterSpacing: '3px',
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
        <DialerHUD session={session} activeMultipliers={multipliers} multipliersReceivedAt={multipliersAt} rank={rank} onTrophyClick={() => setAchievementsOpen(true)} teamFeed={teamFeed} />
        <BadgeToastContainer toasts={badgeToasts} />
        <PointToastContainer toasts={pointToasts} />
        {session && <AchievementsPanel session={session} open={achievementsOpen} onClose={() => setAchievementsOpen(false)} />}
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
              style={{ background: '#1a2e1a', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)' }}
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
      <DialerHUD session={session} activeMultipliers={multipliers} multipliersReceivedAt={multipliersAt} rank={rank} onTrophyClick={() => setAchievementsOpen(true)} teamFeed={teamFeed} />
      <BadgeToastContainer toasts={badgeToasts} />
      <PointToastContainer toasts={pointToasts} />
      {session && <AchievementsPanel session={session} open={achievementsOpen} onClose={() => setAchievementsOpen(false)} />}

      {/* Card entry modal */}
      {cardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-lg p-5 w-80" style={{ background: '#2a2a2a', border: '1.5px solid rgba(241,196,15,0.5)', boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}>
            <div className="text-center mb-1 text-sm font-black tracking-widest uppercase" style={{ color: '#f1c40f' }}>💳 Load Magazine</div>
            <div className="text-center text-xs mb-3" style={{ color: '#888', letterSpacing: '1px' }}>
              {cl.firstName} {cl.lastName}
            </div>

            <div className="mb-2.5">
              <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontWeight: 600, fontSize: 9 }}>Card Number</label>
              <input
                type="text"
                value={ccNum}
                onChange={(e) => { setCcNum(e.target.value); detectCardType(e.target.value); }}
                placeholder="0000 0000 0000 0000"
                maxLength={19}
                className="w-full px-2.5 py-2 rounded font-mono text-base font-semibold tracking-widest"
                style={{ background: '#383838', color: '#fff', border: '1px solid #555', letterSpacing: '3px' }}
              />
              <div
                className="inline-block mt-1 px-2.5 py-0.5 rounded text-xs font-black tracking-wider"
                style={{
                  background: ccType === 'VISA' ? 'rgba(26,35,126,0.3)' : ccType === 'MC' ? 'rgba(192,57,43,0.2)' : ccType === 'AMEX' ? 'rgba(39,174,96,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${ccType === 'VISA' ? '#1a237e' : ccType === 'MC' ? '#c0392b' : ccType === 'AMEX' ? '#27ae60' : '#555'}`,
                  color: ccType === 'VISA' ? '#5c6bc0' : ccType === 'MC' ? '#e74c3c' : ccType === 'AMEX' ? '#2ecc71' : '#888',
                }}
              >
                {ccType || 'Enter card #'}
              </div>
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
            {cardStatus && <div className="text-center text-xs mt-2" style={{ color: cardStatus.startsWith('✓') ? '#2ecc71' : cardStatus.startsWith('Error') ? '#e74c3c' : '#888' }}>{cardStatus}</div>}
          </div>
        </div>
      )}

      {/* Main dialer layout */}
      <div className="relative z-1 flex h-full" style={{ padding: '32px 8px 50px 8px' }}>
        {/* LEFT: Main column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <div className="flex items-center justify-between px-2.5 py-1 flex-shrink-0" style={S.topBar}>
            <span className="text-xs uppercase tracking-wider" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 9 }}>{cs.sheetName}</span>
            <span className="text-xs font-bold tracking-wider" style={{ color: '#2ecc71', fontSize: 9 }}>{cs.currentGroupIndex} / {cs.totalGroups}</span>
          </div>

          {/* Client header */}
          <div className="flex justify-between items-baseline gap-3 px-2.5 py-1.5 flex-shrink-0" style={S.clientHeader}>
            <div>
              <div className="text-base font-black tracking-wider uppercase text-white">{cl.firstName} {cl.lastName}</div>
              {altNames.length > 0 && <div className="text-xs mt-0.5" style={{ color: '#8fbc8f', opacity: 0.7, fontWeight: 400 }}>aka {altNames.join(', ')}</div>}
              {cl.routeCode && <div className="text-xs font-semibold tracking-wider" style={{ color: '#2ecc71', opacity: 0.4 }}>Route: {cl.routeCode}</div>}
            </div>
            <div className="text-base font-bold tracking-wider text-right" style={{ color: '#8fbc8f' }}>
              {cl.houseNum} {cl.streetName}
            </div>
          </div>

          {/* Phone bar */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 flex-shrink-0" style={S.phoneBar}>
            <a
              href={`tel:${cs.phone}`}
              onClick={(e) => { e.preventDefault(); dialPhone(); }}
              className="font-mono text-lg font-black tracking-wider text-white hover:text-cyan-400 cursor-pointer no-underline"
            >
              {formatPhoneDisplay(cs.phone)}
            </a>
            <span
              className="text-xs px-1.5 py-0.5 rounded font-bold tracking-wider uppercase"
              style={{ background: strat.bg, border: `1px solid ${strat.border}`, color: strat.color, fontSize: 8 }}
            >
              {strat.label}
            </span>
            {cs.currentNA > 0 && <span className="text-xs font-bold" style={{ color: '#e67e22', fontSize: 10 }}>NA: {cs.currentNA}</span>}
            {cs.alternatePhone && (
              <span
                className="text-xs font-mono cursor-pointer hover:text-cyan-400"
                style={{ color: '#666', fontSize: 9 }}
                onClick={() => dialPhone(cs.alternatePhone)}
              >
                alt: {formatPhoneDisplay(cs.alternatePhone)}
              </span>
            )}
          </div>

          {/* Content area: service history + AER — OR — YES booking form */}
          <div className="flex-1 overflow-y-auto p-2.5" style={S.contentArea}>
            {showYesPanel ? (
              /* ═══════════ YES BOOKING FORM ═══════════ */
              <div>
                <div className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 9 }}>Booking Details</div>

                {/* Row 1: First Name + Last Name */}
                <div className="flex gap-2 mb-1.5">
                  <div className="flex-1">
                    <YesField label="First Name" value={yName} onChange={setYName} />
                  </div>
                  <div className="flex-1">
                    <YesField label="Last Name" value={yLastName} onChange={setYLastName} />
                  </div>
                </div>

                {/* Row 2: Address — House # + Street */}
                <div className="flex gap-2 mb-1.5">
                  <div style={{ width: 80 }}>
                    <YesField label="House #" value={yHouseNum} onChange={setYHouseNum} />
                  </div>
                  <div className="flex-1">
                    <YesField label="Street Name" value={yStreetName} onChange={setYStreetName} />
                  </div>
                </div>

                {/* Row 3: Price + Email */}
                <div className="flex gap-2 mb-1.5">
                  <div style={{ width: 100 }}>
                    <YesField label="Price" value={yPrice} onChange={setYPrice} />
                  </div>
                  <div className="flex-1">
                    <YesField label="Email" value={yEmail} onChange={setYEmail} />
                  </div>
                </div>

                {/* Row 4: Gate / Sprinkler + FO selection */}
                <div className="flex items-end gap-4 mb-1.5">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#ccc' }}>
                      <input type="checkbox" checked={yGate} onChange={(e) => setYGate(e.target.checked)} style={{ accentColor: '#2ecc71', width: 14, height: 14 }} /> Gate
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#ccc' }}>
                      <input type="checkbox" checked={ySprink} onChange={(e) => setYSprink(e.target.checked)} style={{ accentColor: '#2ecc71', width: 14, height: 14 }} /> Sprinkler
                    </label>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 8, letterSpacing: '1px' }}>FO / BO / FP</div>
                    <div className="flex gap-3">
                      {(['FO', 'BO', 'FP'] as const).map(val => (
                        <label key={val} className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="foRadio" checked={yFO === val} onChange={() => setYFO(val)} style={{ accentColor: '#2ecc71', width: 14, height: 14 }} />
                          <span className="text-xs font-bold" style={{ color: FO_COLORS[val].color }}>{val}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Row 5: Notes (full width) */}
                <div className="mb-2">
                  <YesField label="Notes" value={yNotes} onChange={setYNotes} />
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowYesPanel(false)}
                    className="px-3 py-2 rounded text-xs font-bold cursor-pointer"
                    style={{ background: '#333', color: '#888', border: '1px solid #555' }}
                  >
                    ✖ Cancel
                  </button>
                  <button
                    onClick={() => doYes('COMPLETE')}
                    className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer"
                    style={{ background: '#2ecc71', color: '#fff', border: 'none', letterSpacing: '2px' }}
                  >
                    ✔ Complete
                  </button>
                  <button
                    onClick={() => doYes('PREPAY')}
                    className="flex-1 py-2 rounded text-sm font-bold tracking-wider uppercase cursor-pointer"
                    style={{ background: '#f1c40f', color: '#1a1a1a', border: 'none', letterSpacing: '2px' }}
                  >
                    💳 Prepay
                  </button>
                </div>
              </div>
            ) : (
              /* ═══════════ SERVICE HISTORY + AER ═══════════ */
              <>
                <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 9 }}>Service History</div>
                {cs.serviceHistory.map((h, i) => {
                  const foC = FO_COLORS[h.fo] || FO_COLORS.FP;
                  return (
                    <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 rounded mb-1 text-xs" style={S.historyRow}>
                      <span className="font-black text-white" style={{ minWidth: 36 }}>{h.year}</span>
                      <span className="font-bold" style={{ color: '#2ecc71', minWidth: 50 }}>{h.price || '-'}</span>
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: '#888' }}>{h.contractor}</span>
                      <span className="font-bold rounded px-1.5 py-0.5" style={{ background: foC.bg, color: foC.color, fontSize: 9 }}>{h.fo || 'FP'}</span>
                      {h.pmtType && <span style={{ color: '#555', fontSize: 9 }}>{h.pmtType}</span>}
                    </div>
                  );
                })}

                {/* Nearby AER */}
                {cs.nearbyAER.length > 0 && (
                  <div className="mt-1 p-2 rounded" style={S.linkShot}>
                    <div className="text-xs uppercase tracking-widest font-bold mb-0.5" style={{ color: '#2ecc71', fontSize: 9 }}>
                      🔗 Nearby AER ({cs.nearbyAER.length})
                    </div>
                    {cs.nearbyAER.slice(0, 10).map((a, i) => (
                      <div key={i} className="text-xs mb-0.5" style={{ color: '#aaa' }}>
                        <span className="font-bold" style={{ color: '#2ecc71' }}>{a.house}</span> {a.name}
                      </div>
                    ))}
                    {cs.nearbyAER.length > 10 && <div className="text-xs" style={{ color: '#555' }}>+{cs.nearbyAER.length - 10} more</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Side panel — disposition buttons always visible */}
        <div className="flex flex-col overflow-hidden" style={{ ...S.sidePanel, width: 210, minWidth: 210 }}>
          <div className="p-2 flex-shrink-0">
            <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 8 }}>Disposition</div>
            <DispButton label="📞 NA" onClick={() => doDisp('NA')} style={{ background: '#333', color: '#e67e22', border: '1px solid #555' }} />
            <DispButton label="🌱 CTS" onClick={() => doDisp('CTS')} style={{ background: '#333', color: '#27ae60', border: '1px solid #555' }} />
            <DispButton label="🚫 WN / NIS" onClick={() => doDisp('WN/NIS')} style={{ background: '#333', color: '#9b59b6', border: '1px solid #555' }} />
            <DispButton label="✖ NO" onClick={() => doDisp('NO')} style={{ background: '#333', color: '#e74c3c', border: '1px solid #555' }} />
            <DispButton label="🗑 REMOVE" onClick={() => doDisp('REMOVE')} style={{ background: '#333', color: '#95a5a6', border: '1px solid #555' }} />
            <DispButton
              label={showYesPanel ? "✔ YES ●" : "✔ YES"}
              onClick={() => setShowYesPanel(true)}
              style={{
                background: showYesPanel ? '#1a6b3a' : 'linear-gradient(135deg, #27ae60, #2ecc71)',
                color: '#fff',
                border: showYesPanel ? '2px solid #2ecc71' : 'none',
              }}
            />
          </div>

          {/* Auto-fire + log */}
          <div className="mt-auto flex items-center gap-2 px-2 py-1 flex-shrink-0" style={{ borderTop: '1px solid rgba(46,204,113,0.12)' }}>
            <span className="text-xs uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 8 }}>Auto-Fire</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={autoFire} onChange={(e) => setAutoFire(e.target.checked)} className="sr-only" />
              <div className={`w-9 h-5 rounded-full transition-colors ${autoFire ? 'bg-red-700' : 'bg-gray-600'}`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${autoFire ? 'translate-x-4 bg-white' : 'bg-gray-300'}`} />
              </div>
            </label>
          </div>
          <div className="text-center px-2 py-0.5 flex-shrink-0 text-xs" style={{ color: '#2ecc71', opacity: 0.5, letterSpacing: '1px', fontSize: 8, borderTop: '1px solid rgba(46,204,113,0.1)', minHeight: 14 }}>
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

function DispButton({ label, onClick, style }: { label: string; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-1.5 text-xs font-bold tracking-widest uppercase rounded mb-1 cursor-pointer transition-all"
      style={{ ...style, letterSpacing: '2px', fontSize: 10 }}
    >
      {label}
    </button>
  );
}

function YesField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-1">
      <div className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#2ecc71', opacity: 0.5, fontSize: 8, letterSpacing: '1px' }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-1.5 py-1 rounded text-xs"
        style={{ background: '#0d170d', color: '#fff', border: '1px solid rgba(46,204,113,0.2)', fontSize: 10 }}
      />
    </div>
  );
}