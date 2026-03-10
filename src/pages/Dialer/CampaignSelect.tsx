// src/pages/Dialer/CampaignSelect.tsx
//
// CALM MODE: When managerId === 'ROBA', only the Campaigns tab is shown.
// Stats and Achievements tabs are hidden. The Fireteam panel on the right
// is also hidden. Everything else is identical for all other users.
//
// CITY VIEW: A BY TAB / BY CITY toggle on the Campaigns tab lets the user
// switch between tab-based cards (default) and city-grouped cards.
// City cards aggregate stats across all tabs that contain that city.
// City deploys support Infiltrate and Siege only (no Ambush).
//
import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, RefreshCw } from 'lucide-react';
import FireteamPanel from './FireteamPanel';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';
import type { PresenceRecord, MemberStats } from '../../lib/dialerRealtimeService';
import type { ResumeData } from '../../lib/campaignService';
import { getTodayEST, campaignService } from '../../lib/campaignService';
import { BADGE_DEFS } from '../../lib/dialer/gamificationDefs';
import { getBadgeIcon, getBadgeCategoryColor } from './BadgeIcons';
import type { GamificationSession } from '../../lib/dialer/gamificationDefs';
import type { CityInfo } from '../../lib/dialer/dialerEngine';

// =============================================================================
// CALM MODE CONSTANT
// =============================================================================

const CALM_MODE_USER = 'ROBA';

// Section display order — must match AchievementsPanel
const SECTION_ORDER: string[] = [
  'Streaks', 'Prepay Streak', 'Street', 'Time', 'Spree',
  'Special', 'Headhunter', 'Raise the Dead', 'Graveyard', 'Conversion',
  'Ranks', 'Milestones', 'Workhorse',
];

const SECTION_DESC: Record<string, string> = {
  Streaks: 'Consecutive YES dispositions without a break',
  'Prepay Streak': 'Consecutive prepay bookings back-to-back',
  Street: 'Multiple sales on the same street',
  Time: 'Bookings at unusual hours',
  Spree: 'Booking volume within a 1-hour window',
  Special: 'Unique one-time achievements',
  Headhunter: 'Booking on streets with no prior AER',
  'Raise the Dead': 'Reviving clients last serviced in 2020, 2021, or 2022',
  'Graveyard': 'Bonus points per booking based on how long a client has been inactive',
  Conversion: 'Converting non-app clients to prepay',
  Ranks: 'Prepay dollar milestones',
  Milestones: 'Total booking count achievements',
  Workhorse: 'Sustained high dial volume',
};

const SECTION_COLORS: Record<string, string> = {
  Streaks: '#e74c3c',
  'Prepay Streak': '#f1c40f',
  Street: '#2ecc71',
  Time: '#e67e22',
  Spree: '#ff5722',
  Special: '#00BCD4',
  Headhunter: '#9b59b6',
  'Raise the Dead': '#8e44ad',
  'Graveyard': '#6c3483',
  Conversion: '#e056a0',
  Ranks: '#f1c40f',
  Milestones: '#3498db',
  Workhorse: '#95a5a6',
};

const SECTION_ICONS: Record<string, string> = {
  Streaks: '🔥',
  'Prepay Streak': '💰',
  Street: '🗺️',
  Time: '⏰',
  Spree: '⚡',
  Special: '✦',
  Headhunter: '🎯',
  'Raise the Dead': '💀',
  'Graveyard': '⚰️',
  Conversion: '🧠',
  Ranks: '⭐',
  Milestones: '🏅',
  Workhorse: '⚙️',
};

const RANK_ICONS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// =============================================================================
// TYPES
// =============================================================================

export interface Campaign {
  id: string;
  name: string;
  codename?: string;
  description?: string;
  totalRows: number;
  bookings: number;
  reachedPct: number;
  avgAttempts: number;
  zone?: string;
  terrain?: 'residential' | 'commercial' | 'industrial' | 'mixed' | 'rural';
  lastDeployed?: string;
  locked?: boolean;
  lockedReason?: string;
  hot?: boolean;
  /** Book type — 'standard' or 'bc'. Used to show type badge on card. */
  campaignType?: string;
}

interface CampaignSelectProps {
  campaigns: Campaign[];
  onDeploy: (campaignId: string) => void;
  onSettingsClick?: () => void;
  filterSummary?: React.ReactNode;
  campaignId?: string;
  managerId?: string;
  managerName?: string;
  resumeData?: ResumeData | null;
  resumeLoading?: boolean;
  onResume?: () => void;
  /** Today's gamification session — used for the Today achievements sub-tab */
  session?: GamificationSession | null;
  /** City cards — populated after city scan on connect */
  cityCards?: CityInfo[];
  /** Called when user deploys a city card */
  onCityDeploy?: (city: CityInfo) => void;
}

type MainTab = 'campaigns' | 'stats' | 'achievements';
type AchievementsSubTab = 'today' | 'lifetime';
type ViewMode = 'tab' | 'city';

// =============================================================================
// HELPERS
// =============================================================================

function heatColor(avgAttempts: number): string {
  if (avgAttempts <= 1.1) return '#2ecc71';
  if (avgAttempts <= 2)   return '#f1c40f';
  if (avgAttempts <= 3)   return '#e67e22';
  if (avgAttempts <= 4)   return '#e74c3c';
  if (avgAttempts <= 5)   return '#9b59b6';
  return '#8B6914';
}

function heatGlow(avgAttempts: number): string {
  const c = heatColor(avgAttempts);
  if (avgAttempts <= 1.1) return `0 0 16px ${c}18`;
  if (avgAttempts <= 2)   return `0 0 20px ${c}25`;
  if (avgAttempts <= 3)   return `0 0 24px ${c}35`;
  if (avgAttempts <= 4)   return `0 0 28px ${c}45`;
  if (avgAttempts <= 5)   return `0 0 32px ${c}55, 0 0 60px ${c}20`;
  return `0 0 36px ${c}65, 0 0 70px ${c}28`;
}

function heatGradient(avgAttempts: number): string {
  const c = heatColor(avgAttempts);
  const intensity = Math.min((avgAttempts / 5), 1);
  return `linear-gradient(135deg, ${c}${Math.round(intensity * 20).toString(16).padStart(2,'0')} 0%, ${c}08 40%, rgba(8,12,8,0.96) 100%)`;
}

function isAutoHot(avgAttempts: number): boolean {
  return avgAttempts >= 4;
}

function reachStatus(pct: number): { label: string; color: string } {
  if (pct < 20) return { label: 'FRESH', color: '#2ecc71' };
  if (pct < 50) return { label: 'ACTIVE', color: '#f1c40f' };
  if (pct < 80) return { label: 'WORKED', color: '#e67e22' };
  return { label: 'SATURATED', color: '#e74c3c' };
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'NEVER';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays < 7) return `${diffDays}d AGO`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
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

function topoPattern(id: string, accent: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const abs = Math.abs(hash);
  const r1 = 30 + (abs % 40);
  const r2 = 50 + ((abs >> 4) % 30);
  const r3 = 70 + ((abs >> 8) % 25);
  const cx = 40 + (abs % 20);
  const cy = 35 + ((abs >> 3) % 30);
  return `<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'>
    <ellipse cx='${cx}' cy='${cy}' rx='${r1}' ry='${r1 - 8}' fill='none' stroke='${accent}' stroke-width='0.3' opacity='0.15'/>
    <ellipse cx='${cx}' cy='${cy}' rx='${r2}' ry='${r2 - 12}' fill='none' stroke='${accent}' stroke-width='0.25' opacity='0.10'/>
    <ellipse cx='${cx}' cy='${cy}' rx='${r3}' ry='${r3 - 15}' fill='none' stroke='${accent}' stroke-width='0.2' opacity='0.07'/>
    <line x1='${10 + abs % 20}' y1='0' x2='${60 + abs % 30}' y2='100' stroke='${accent}' stroke-width='0.2' opacity='0.08'/>
    <line x1='${30 + (abs >> 2) % 20}' y1='0' x2='${40 + (abs >> 2) % 30}' y2='100' stroke='${accent}' stroke-width='0.15' opacity='0.06'/>
    <circle cx='${20 + abs % 60}' cy='${20 + (abs >> 1) % 60}' r='2' fill='${accent}' opacity='0.12'/>
    <circle cx='${50 + (abs >> 3) % 30}' cy='${50 + (abs >> 5) % 30}' r='1.5' fill='${accent}' opacity='0.10'/>
  </svg>`;
}

function gridOverlay(accent: string): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>
    <line x1='0' y1='40' x2='40' y2='40' stroke='${accent}' stroke-width='0.3' opacity='0.06'/>
    <line x1='40' y1='0' x2='40' y2='40' stroke='${accent}' stroke-width='0.3' opacity='0.06'/>
  </svg>`;
}

// =============================================================================
// STYLES
// =============================================================================

const CAMPAIGN_STYLES = `
  @keyframes cs-scan-line {
    0%   { top: -2px; }
    100% { top: 100%; }
  }
  @keyframes cs-card-enter {
    0%   { transform: translateY(20px) scale(0.97); opacity: 0; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  @keyframes cs-hot-pulse {
    0%, 100% { opacity: 0.7; }
    50%       { opacity: 1; }
  }
  @keyframes cs-deploy-glow {
    0%, 100% {
      box-shadow: 0 0 12px rgba(46,204,113,0.3), 0 0 40px rgba(46,204,113,0.1);
    }
    50% {
      box-shadow: 0 0 20px rgba(46,204,113,0.6), 0 0 60px rgba(46,204,113,0.25);
    }
  }
  @keyframes cs-deploy-sweep {
    0%   { left: -100%; }
    100% { left: 100%; }
  }
  @keyframes cs-deploy-confirm {
    0%   { transform: scale(1); }
    30%  { transform: scale(0.95); }
    60%  { transform: scale(1.04); }
    100% { transform: scale(1); }
  }
  @keyframes cs-header-slide {
    0%   { transform: translateY(-30px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes cs-badge-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(255,68,34,0.4); }
    50%       { box-shadow: 0 0 14px rgba(255,68,34,0.8); }
  }
  @keyframes cs-arm-border {
    0%, 100% { opacity: 0.6; }
    50%       { opacity: 1; }
  }
  @keyframes cs-resume-pulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(245,166,35,0.3), 0 0 20px rgba(245,166,35,0.08); }
    50%       { box-shadow: 0 0 0 1px rgba(245,166,35,0.6), 0 0 30px rgba(245,166,35,0.18); }
  }
  @keyframes cs-resume-enter {
    0%   { transform: translateY(-10px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes cs-resume-sweep {
    0%   { left: -100%; }
    100% { left: 200%; }
  }
  @keyframes badge-pulse {
    0%, 100% { box-shadow: 0 0 4px var(--pulse-color, rgba(46,204,113,0.2)); }
    50% { box-shadow: 0 0 12px var(--pulse-color, rgba(46,204,113,0.5)); }
  }
  @keyframes badge-glow-idle {
    0%, 100% { opacity: 0.15; }
    50% { opacity: 0.35; }
  }
  @keyframes sp-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(46,204,113,0.15); }
    50% { box-shadow: 0 0 14px rgba(46,204,113,0.4); }
  }
  @keyframes sp-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

// =============================================================================
// RESUME BANNER
// =============================================================================

function ResumeBanner({
  resumeData,
  onResume,
  managerId,
  session,
}: {
  resumeData: ResumeData;
  onResume: () => void;
  managerId?: string;
  session?: GamificationSession | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [myStats, setMyStats] = useState<MemberStats | null>(null);
  const isCalm = managerId === CALM_MODE_USER;

  useEffect(() => {
    if (!managerId || isCalm) return;
    dialerRealtimeService.fetchGlobalStatsFromSessions().then(rows => {
      const mine = rows.find(r => r.managerId === managerId) ?? null;
      setMyStats(mine);
    }).catch(() => {});
  }, [managerId, isCalm]);

  const isToday = resumeData.sessionDate === getTodayEST();
  const lastSeen = formatLastSeen(resumeData.lastUpdatedAt);
  const badgeCount = session?.badges?.length ?? myStats?.badges?.length ?? 0;

  // For calm mode, only show PB / PP / PP$ (no PTS, no DIALS, no BDGS)
  const calmStats = isCalm ? [
    { label: 'PB',  value: session?.pbs ?? '—',                                  color: '#ff6eb4' },
    { label: 'PP',  value: session?.pps ?? '—',                                  color: '#ff6eb4' },
    { label: 'PP$', value: session ? `$${session.ppDollars}` : '—',              color: '#ff6eb4' },
  ] : [
    { label: 'PTS',   value: myStats?.points    ?? '—',                    color: '#ffffff' },
    { label: 'PB',    value: myStats?.pbs        ?? '—',                    color: '#2ecc71' },
    { label: 'PP',    value: myStats?.pps        ?? '—',                    color: '#f1c40f' },
    { label: 'PP$',   value: myStats ? `$${myStats.ppDollars}` : '—',       color: '#e67e22' },
    { label: 'DIALS', value: myStats?.totalDials ?? '—',                    color: '#3498db' },
    { label: 'BDGS',  value: badgeCount || '—',                             color: '#9b59b6' },
  ];

  return (
    <div
      style={{
        marginBottom: 12,
        borderRadius: 8,
        border: `1px solid rgba(245,166,35,0.35)`,
        background: 'rgba(245,166,35,0.04)',
        padding: '10px 14px',
        animation: 'cs-resume-enter 0.4s ease-out both, cs-resume-pulse 3s ease-in-out 0.5s infinite',
        position: 'relative',
      }}
    >
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0, width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(245,166,35,0.05), transparent)',
          animation: 'cs-resume-sweep 4s ease-in-out infinite',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>

        {/* Radar icon */}
        <div style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={`${GAME_ICON_BASE}/lorc/radar-sweep.svg`}
            width={24}
            height={24}
            draggable={false}
            style={{ opacity: 0.65, filter: 'sepia(1) saturate(3) hue-rotate(5deg)' }}
          />
        </div>

        {/* Left: operation info */}
        <div style={{ minWidth: 0, flexShrink: 0 }}>
          <div style={{
            fontSize: 8, fontWeight: 800, letterSpacing: '3px',
            color: '#f5a623', opacity: 0.7, textTransform: 'uppercase', marginBottom: 3,
          }}>
            LAST OPERATION DETECTED
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: '#fff', letterSpacing: '0.5px' }}>
              {resumeData.tab}
            </span>
            <span style={{
              fontSize: 8, fontWeight: 700, color: '#f5a623',
              background: 'rgba(245,166,35,0.12)',
              border: '1px solid rgba(245,166,35,0.25)',
              borderRadius: 3, padding: '1px 6px', letterSpacing: '1px',
              textTransform: 'uppercase',
            }}>
              {isToday ? '🟢 TODAY' : '🟡 PREV SESSION'}
            </span>
            {lastSeen && (
              <span style={{ fontSize: 9, color: '#666', fontWeight: 600 }}>{lastSeen}</span>
            )}
          </div>
          <div style={{ fontSize: 9, color: '#555', marginTop: 2, fontFamily: 'monospace' }}>
            Position: {resumeData.position.startsWith('ROW:') ? `Row ${resumeData.position.slice(4)}` : resumeData.position}
            {!isToday && <span style={{ color: '#444', marginLeft: 8 }}>· Gamification resets (new day)</span>}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(245,166,35,0.12)', flexShrink: 0, margin: '0 4px' }} />

        {/* Center: stat strip */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          {calmStats.map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '6px 4px', borderRadius: 6,
              background: `${color}07`,
              border: `1px solid ${color}18`,
            }}>
              <span style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>
                {value}
              </span>
              <span style={{ fontSize: 7, color, opacity: 0.45, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 2 }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(245,166,35,0.12)', flexShrink: 0, margin: '0 4px' }} />

        {/* Right: resume button */}
        <div style={{ flexShrink: 0 }}>
          <button
            onClick={onResume}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: `1.5px solid ${hovered ? '#f5a623' : 'rgba(245,166,35,0.5)'}`,
              background: hovered ? 'rgba(245,166,35,0.18)' : 'rgba(245,166,35,0.08)',
              color: '#f5a623',
              fontSize: 11,
              fontWeight: 900,
              fontFamily: 'monospace',
              letterSpacing: '2.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            <img
              src={`${GAME_ICON_BASE}/lorc/return-arrow.svg`}
              width={52}
              height={52}
              draggable={false}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                transform: 'translate(-50%, -50%)',
                opacity: hovered ? 0.13 : 0.07,
                transition: 'opacity 0.15s ease',
                pointerEvents: 'none',
                filter: 'sepia(1) saturate(3) hue-rotate(5deg)',
              }}
            />
            <span style={{ position: 'relative', zIndex: 1 }}>⚡ RESUME</span>
          </button>
        </div>

      </div>
    </div>
  );
}

// =============================================================================
// MAIN TAB BAR
// =============================================================================

const GAME_ICON_BASE = 'https://game-icons.net/icons/ffffff/transparent/1x1';

function GameIcon({
  path,
  size = 16,
  opacity = 1,
  style: extraStyle,
}: {
  path: string;
  size?: number;
  opacity?: number;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={`${GAME_ICON_BASE}/${path}.svg`}
      width={size}
      height={size}
      style={{ opacity, display: 'block', flexShrink: 0, ...extraStyle }}
      draggable={false}
    />
  );
}

function MainTabBar({
  active,
  onChange,
  isCalm,
}: {
  active: MainTab;
  onChange: (t: MainTab) => void;
  isCalm?: boolean;
}) {
  const allTabs: { id: MainTab; label: string; iconPath: string }[] = [
    { id: 'campaigns',    label: 'CAMPAIGNS',    iconPath: 'lorc/compass' },
    { id: 'stats',        label: 'STATS',        iconPath: 'lorc/podium' },
    { id: 'achievements', label: 'ACHIEVEMENTS', iconPath: 'delapouite/trophy-cup' },
  ];

  // ROBA only sees Campaigns
  const tabs = isCalm ? allTabs.filter(t => t.id === 'campaigns') : allTabs;

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '0 24px',
      borderBottom: '1px solid rgba(46,204,113,0.15)',
      marginBottom: 0,
    }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              position: 'relative',
              padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '2px',
              color: isActive ? '#2ecc71' : '#444',
              textTransform: 'uppercase',
              transition: 'color 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            <img
              src={`${GAME_ICON_BASE}/${t.iconPath}.svg`}
              width={44}
              height={44}
              draggable={false}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                opacity: isActive ? 0.10 : 0.04,
                transition: 'opacity 0.25s ease',
                pointerEvents: 'none',
                filter: isActive ? 'none' : 'grayscale(1)',
              }}
            />
            <span style={{ position: 'relative', zIndex: 1 }}>{t.label}</span>
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: '10%',
                right: '10%',
                height: 2,
                borderRadius: 1,
                background: '#2ecc71',
                boxShadow: '0 0 8px rgba(46,204,113,0.6)',
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// VIEW MODE TOGGLE  (BY TAB / BY CITY)
// =============================================================================

function ViewModeToggle({
  mode,
  onChange,
  hasCityCards,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  hasCityCards: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      padding: '8px 0 4px',
      marginBottom: 4,
    }}>
      {(['tab', 'city'] as ViewMode[]).map((m) => {
        const isActive = mode === m;
        const label = m === 'tab' ? '⊞ BY TAB' : '🏙 BY CITY';
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            disabled={m === 'city' && !hasCityCards}
            style={{
              padding: '5px 16px',
              border: `1px solid ${isActive ? 'rgba(46,204,113,0.5)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: m === 'tab' ? '6px 0 0 6px' : '0 6px 6px 0',
              background: isActive ? 'rgba(46,204,113,0.10)' : 'rgba(255,255,255,0.02)',
              color: isActive ? '#2ecc71' : (m === 'city' && !hasCityCards ? '#333' : '#555'),
              fontFamily: 'inherit',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor: (m === 'city' && !hasCityCards) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {label}
            {m === 'city' && !hasCityCards && (
              <span style={{ marginLeft: 6, fontSize: 7, color: '#444', opacity: 0.7 }}>scanning...</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// STATS VIEW
// =============================================================================

function StatsView({ campaignId, managerId }: { campaignId?: string; managerId?: string }) {
  const [tab, setTab] = useState<'fireteam' | 'global'>('global');
  const [fireteamRows, setFireteamRows] = useState<MemberStats[]>([]);
  const [globalRows, setGlobalRows] = useState<MemberStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ft, gl] = await Promise.all([
        campaignId
          ? dialerRealtimeService.fetchFireteamStatsFromSessions(campaignId)
          : Promise.resolve([]),
        dialerRealtimeService.fetchGlobalStatsFromSessions(),
      ]);
      setFireteamRows(ft);
      setGlobalRows(gl);
      setLastRefresh(Date.now());
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const rows = tab === 'fireteam' ? fireteamRows : globalRows;
  const refreshAgo = lastRefresh ? Math.round((Date.now() - lastRefresh) / 1000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px 24px 8px',
        borderBottom: '1px solid rgba(46,204,113,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['global', 'fireteam'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                border: `1px solid ${tab === t ? 'rgba(46,204,113,0.4)' : 'rgba(255,255,255,0.06)'}`,
                background: tab === t ? 'rgba(46,204,113,0.08)' : 'transparent',
                color: tab === t ? '#2ecc71' : '#444',
                fontFamily: 'inherit',
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {t === 'global' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <img src={`${GAME_ICON_BASE}/lorc/world.svg`} width={11} height={11} draggable={false} style={{ opacity: tab === t ? 0.8 : 0.3 }} />
                  WORLD
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <img src={`${GAME_ICON_BASE}/lorc/rally-the-troops.svg`} width={11} height={11} draggable={false} style={{ opacity: tab === t ? 0.8 : 0.3 }} />
                  FIRETEAM
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {refreshAgo !== null && !loading && (
            <span style={{ fontSize: 8, color: '#444', fontFamily: 'monospace' }}>{refreshAgo}s ago</span>
          )}
          <button
            onClick={fetchAll}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent', cursor: 'pointer',
            }}
          >
            <RefreshCw
              size={11}
              color={loading ? '#333' : '#555'}
              style={{ animation: loading ? 'sp-spin 0.8s linear infinite' : undefined }}
            />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#2ecc71', opacity: 0.3, fontSize: 11, letterSpacing: '2px' }}>
            LOADING...
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#333', fontSize: 11, letterSpacing: '2px' }}>
            NO DATA YET TODAY
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((member, idx) => {
            const isOwn = member.managerId === managerId;
            const isExpanded = expandedId === member.managerId;
            return (
              <MemberCard
                key={member.managerId}
                member={member}
                rank={idx}
                isOwn={isOwn}
                isExpanded={isExpanded}
                onToggle={() => setExpandedId(isExpanded ? null : member.managerId)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MemberCard({
  member,
  rank,
  isOwn,
  isExpanded,
  onToggle,
}: {
  member: MemberStats;
  rank: number;
  isOwn: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const badgeCount = member.badges.length;

  return (
    <div style={{
      border: isOwn ? '1px solid rgba(46,204,113,0.35)' : '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10,
      background: isOwn ? 'rgba(46,204,113,0.04)' : 'rgba(255,255,255,0.015)',
      animation: isOwn ? 'sp-pulse 4s ease-in-out infinite' : undefined,
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, minWidth: 24, textAlign: 'center' }}>
          {RANK_ICONS[rank] ?? `${rank + 1}.`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: isOwn ? '#2ecc71' : '#d0d0d0', letterSpacing: 1 }}>
            {member.managerName}
            {isOwn && <span style={{ color: '#2ecc71', opacity: 0.5, fontSize: 8, marginLeft: 6, fontWeight: 400 }}>YOU</span>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <CollapsedStat label="PTS" value={member.points}           color="#fff" />
          <CollapsedStat label="PB"  value={member.pbs}             color="#2ecc71" />
          <CollapsedStat label="PP"  value={member.pps}             color="#f1c40f" />
          <CollapsedStat label="PP$" value={`$${member.ppDollars}`} color="#e67e22" />
          <CollapsedStat label="🏅"  value={badgeCount}             color="#9b59b6" />
        </div>
        <span style={{ color: '#444', fontSize: 10, marginLeft: 4 }}>{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(0,0,0,0.2)',
          padding: '12px 14px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 12 }}>
            <ExpandedStatCard label="PB"     value={member.pbs}             color="#2ecc71" />
            <ExpandedStatCard label="PP"     value={member.pps}             color="#f1c40f" />
            <ExpandedStatCard label="PP$"    value={`$${member.ppDollars}`} color="#e67e22" />
            <ExpandedStatCard label="PTS"    value={member.points}          color="#ffffff" />
            <ExpandedStatCard label="BADGES" value={badgeCount}             color="#9b59b6" />
            <ExpandedStatCard label="DIALS"  value={member.totalDials}      color="#3498db" />
          </div>
          <BadgeLog badges={member.badges} />
        </div>
      )}
    </div>
  );
}

function CollapsedStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 32 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 7, color, opacity: 0.4, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 1 }}>{label}</div>
    </div>
  );
}

function ExpandedStatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 4px', borderRadius: 8,
      background: `${color}06`, border: `1px solid ${color}15`,
    }}>
      <span style={{ fontSize: 14, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</span>
      <span style={{ fontSize: 7, color, opacity: 0.4, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 2 }}>{label}</span>
    </div>
  );
}

function BadgeLog({ badges }: { badges: string[] }) {
  if (badges.length === 0) {
    return <div style={{ fontSize: 10, color: '#333', textAlign: 'center', padding: '12px 0' }}>No badges earned yet today.</div>;
  }

  const countMap = new Map<string, number>();
  for (const id of badges) countMap.set(id, (countMap.get(id) ?? 0) + 1);
  const uniqueIds = Array.from(countMap.keys());

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 3, height: 10, borderRadius: 2, background: '#9b59b6' }} />
        <span style={{ fontSize: 8, fontWeight: 800, color: '#9b59b6', opacity: 0.6, letterSpacing: '2px', textTransform: 'uppercase' }}>
          Badges Earned
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {uniqueIds.map(id => {
          const def = BADGE_DEFS[id];
          if (!def) return null;
          const icon = getBadgeIcon(id, 16);
          const catColor = getBadgeCategoryColor(id);
          const count = countMap.get(id)!;
          return (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: `${catColor}06`, border: `1px solid ${catColor}15`,
            }}>
              <div style={{ width: 16, height: 16, flexShrink: 0 }}>
                {icon || <span style={{ fontSize: 12 }}>{def.icon}</span>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, flex: 1, color: '#bbb' }}>{def.name}</span>
              {count > 1 && <span style={{ fontSize: 9, fontWeight: 900, color: catColor, fontFamily: 'monospace' }}>×{count}</span>}
              <span style={{ fontSize: 8, color: catColor, fontFamily: 'monospace' }}>+{def.bonus * count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// ACHIEVEMENTS VIEW
// =============================================================================

function AchievementsView({
  managerId,
  session,
}: {
  managerId?: string;
  session?: GamificationSession | null;
}) {
  const [subTab, setSubTab] = useState<AchievementsSubTab>('today');
  const [lifetimeBadges, setLifetimeBadges] = useState<Record<string, number>>({});
  const [lifetimeLoading, setLifetimeLoading] = useState(false);

  useEffect(() => {
    if (subTab !== 'lifetime' || !managerId) return;
    setLifetimeLoading(true);
    campaignService.getLifetimeBadges(managerId)
      .then(setLifetimeBadges)
      .catch(() => setLifetimeBadges({}))
      .finally(() => setLifetimeLoading(false));
  }, [subTab, managerId]);

  const todayBadgeCounts: Record<string, number> = {};
  if (session?.badges) {
    for (const b of session.badges) {
      todayBadgeCounts[b.id] = (todayBadgeCounts[b.id] || 0) + 1;
    }
  }

  const badgeCounts = subTab === 'today' ? todayBadgeCounts : lifetimeBadges;
  const earnedSet = new Set(Object.keys(badgeCounts));

  const totalBadgesDefined = Object.keys(BADGE_DEFS).length;
  const uniqueEarned = earnedSet.size;
  const totalEarned = Object.values(badgeCounts).reduce((s, c) => s + c, 0);
  const progressPct = Math.round((uniqueEarned / totalBadgesDefined) * 100);

  const badgesBySection: Record<string, { id: string; def: any; earned: boolean; count: number }[]> = {};
  for (const section of SECTION_ORDER) {
    badgesBySection[section] = [];
  }
  for (const [id, def] of Object.entries(BADGE_DEFS)) {
    const section = (def as any).section || 'Special';
    if (!badgesBySection[section]) badgesBySection[section] = [];
    const count = badgeCounts[id] || 0;
    badgesBySection[section].push({ id, def, earned: earnedSet.has(id), count });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 24px 8px',
        borderBottom: '1px solid rgba(46,204,113,0.1)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['today', 'lifetime'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSubTab(t)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: `1px solid ${subTab === t ? 'rgba(46,204,113,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  background: subTab === t ? 'rgba(46,204,113,0.08)' : 'transparent',
                  color: subTab === t ? '#2ecc71' : '#444',
                  fontFamily: 'inherit',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {t === 'today' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <img src={`${GAME_ICON_BASE}/lorc/sunrise.svg`} width={11} height={11} draggable={false} style={{ opacity: subTab === t ? 0.8 : 0.3 }} />
                    TODAY
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <img src={`${GAME_ICON_BASE}/lorc/open-book.svg`} width={11} height={11} draggable={false} style={{ opacity: subTab === t ? 0.8 : 0.3 }} />
                    LIFETIME
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, color: '#2ecc71', opacity: 0.5, fontFamily: 'monospace' }}>
              {uniqueEarned}/{totalBadgesDefined} unique
            </span>
            {subTab === 'lifetime' && totalEarned > uniqueEarned && (
              <span style={{ fontSize: 9, color: '#9b59b6', opacity: 0.6, fontFamily: 'monospace' }}>
                {totalEarned} total
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, #2ecc71, #f1c40f)',
              boxShadow: '0 0 8px rgba(46,204,113,0.4)',
              transition: 'width 0.6s ease-out',
            }} />
          </div>
          <span style={{ fontSize: 8, color: '#2ecc71', opacity: 0.4, fontFamily: 'monospace', fontWeight: 800 }}>
            {progressPct}%
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {lifetimeLoading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#2ecc71', opacity: 0.3, fontSize: 11, letterSpacing: '2px' }}>
            LOADING LIFETIME RECORDS...
          </div>
        )}

        {!lifetimeLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {SECTION_ORDER.map(section => {
              const badges = badgesBySection[section];
              if (!badges || badges.length === 0) return null;
              const earnedCount = badges.filter(b => b.earned).length;
              const accent = SECTION_COLORS[section] || '#2ecc71';
              const sectionIcon = SECTION_ICONS[section] || '•';

              return (
                <div key={section}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12 }}>{sectionIcon}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 900, letterSpacing: '2px',
                      textTransform: 'uppercase', color: accent, fontFamily: 'monospace',
                    }}>
                      {section}
                    </span>
                    <span style={{
                      fontSize: 8, fontWeight: 700, color: accent,
                      background: `${accent}12`, border: `1px solid ${accent}25`,
                      borderRadius: 3, padding: '1px 6px',
                    }}>
                      {earnedCount}/{badges.length}
                    </span>
                    <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, ${accent}30, transparent)` }} />
                  </div>
                  <div style={{ fontSize: 8, color: '#444', marginBottom: 8, letterSpacing: '0.5px' }}>
                    {SECTION_DESC[section]}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {badges.map(({ id, def, earned, count }) => {
                      const icon = getBadgeIcon(id, 26);
                      const catColor = getBadgeCategoryColor(id);

                      return (
                        <div
                          key={id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 8,
                            background: earned ? `${catColor}0a` : 'rgba(255,255,255,0.015)',
                            border: earned ? `1px solid ${catColor}30` : '1px solid rgba(255,255,255,0.04)',
                            opacity: earned ? 1 : 0.35,
                            animation: earned ? 'badge-pulse 3s ease-in-out infinite' : undefined,
                            ['--pulse-color' as any]: earned ? `${catColor}30` : undefined,
                            position: 'relative',
                            overflow: 'hidden',
                          }}
                        >
                          {earned && (
                            <div style={{
                              position: 'absolute', inset: 0, borderRadius: 8, pointerEvents: 'none',
                              background: `radial-gradient(ellipse at 20% 50%, ${catColor}15 0%, transparent 70%)`,
                              animation: 'badge-glow-idle 4s ease-in-out infinite',
                            }} />
                          )}

                          <div style={{
                            width: 30, height: 30, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            filter: earned ? 'none' : 'grayscale(1) brightness(0.4)',
                          }}>
                            {icon || <span style={{ fontSize: 18 }}>{def.icon}</span>}
                          </div>

                          <div style={{ minWidth: 0, flex: 1, position: 'relative' }}>
                            <div style={{
                              fontSize: 10, fontWeight: 700, color: earned ? '#e0e0e0' : '#555',
                              letterSpacing: '0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {def.name}
                            </div>
                            <div style={{ fontSize: 8, color: earned ? '#777' : '#333', marginTop: 1 }}>
                              {def.desc}
                            </div>
                          </div>

                          {earned && (
                            <div style={{ flexShrink: 0, position: 'relative', textAlign: 'right' }}>
                              {count > 1 && (
                                <div style={{ fontSize: 11, fontWeight: 900, color: catColor, fontFamily: 'monospace' }}>
                                  ×{count}
                                </div>
                              )}
                              <div style={{ fontSize: 7, color: '#555', fontFamily: 'monospace' }}>+{def.bonus}</div>
                            </div>
                          )}
                          {!earned && (
                            <div style={{
                              flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
                              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <svg width="7" height="9" viewBox="0 0 8 10" fill="none">
                                <rect x="1" y="4" width="6" height="5" rx="1" stroke="#333" strokeWidth="0.8" />
                                <path d="M2.5 4V2.5C2.5 1.7 3.2 1 4 1C4.8 1 5.5 1.7 5.5 2.5V4" stroke="#333" strokeWidth="0.8" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export default function CampaignSelect({
  campaigns,
  onDeploy,
  onSettingsClick,
  filterSummary,
  campaignId,
  managerId,
  managerName,
  resumeData,
  resumeLoading,
  onResume,
  session,
  cityCards,
  onCityDeploy,
}: CampaignSelectProps) {
  const isCalm = managerId === CALM_MODE_USER;

  const [activeTab, setActiveTab] = useState<MainTab>('campaigns');
  const [viewMode, setViewMode] = useState<ViewMode>('tab');
  const [armedId, setArmedId] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [presence, setPresence] = useState<PresenceRecord[]>([]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    dialerRealtimeService.fetchActivePresence().then(setPresence);
    unsubscribe = dialerRealtimeService.subscribeToPresence((records) => {
      setPresence(records);
    });
    return () => { unsubscribe?.(); };
  }, []);

  // If calm mode user somehow navigated to stats/achievements, reset to campaigns
  useEffect(() => {
    if (isCalm && activeTab !== 'campaigns') {
      setActiveTab('campaigns');
    }
  }, [isCalm, activeTab]);

  // Reset armed state when switching view modes
  useEffect(() => {
    setArmedId(null);
    setDeploying(false);
  }, [viewMode]);

  const hotCampaignIds = new Set(presence.map(p => p.campaignId));

  const sorted = [...campaigns].sort((a, b) => {
    const aHot = hotCampaignIds.has(a.id) || a.hot || isAutoHot(a.avgAttempts);
    const bHot = hotCampaignIds.has(b.id) || b.hot || isAutoHot(b.avgAttempts);
    if (aHot && !bHot) return -1;
    if (!aHot && bHot) return 1;
    if (a.locked && !b.locked) return 1;
    if (!a.locked && b.locked) return -1;
    return a.name.localeCompare(b.name);
  });

  const sortedCities = [...(cityCards ?? [])].sort((a, b) => a.cityName.localeCompare(b.cityName));

  const handleArm = useCallback((id: string) => {
    setArmedId(prev => prev === id ? null : id);
    setDeploying(false);
  }, []);

  const handleDeploy = useCallback((id: string) => {
    setDeploying(true);
    setTimeout(() => { onDeploy(id); }, 600);
  }, [onDeploy]);

  const handleCityDeploy = useCallback((city: CityInfo) => {
    setDeploying(true);
    setTimeout(() => { onCityDeploy?.(city); }, 600);
  }, [onCityDeploy]);

  const headerTitle =
    activeTab === 'stats' ? 'TEAM STATS' :
    activeTab === 'achievements' ? 'ACHIEVEMENTS' :
    'SELECT CAMPAIGN';

  const headerSubtitle =
    activeTab === 'stats' ? 'GLOBAL LEADERBOARD // TODAY' :
    activeTab === 'achievements' ? 'BADGES & RECORDS' :
    'AUTOSNIPER M82 // TACTICAL OPERATIONS';

  const availableCount = viewMode === 'city'
    ? (cityCards?.length ?? 0)
    : campaigns.filter(c => !c.locked).length;

  return (
    <>
      <style>{CAMPAIGN_STYLES}</style>

      <div style={{
        position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>`)}")`,
        backgroundSize: '200px 200px',
      }} />

      <div style={{
        height: '100vh',
        overflow: 'hidden',
        background: '#060a06',
        color: '#ddd',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* ── HEADER ── */}
        <div style={{
          padding: '20px 24px 0',
          position: 'relative',
          zIndex: 2,
          animation: 'cs-header-slide 0.5s ease-out both',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 10 }}>
            <div>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '4px',
                color: '#2ecc71', opacity: 0.5, textTransform: 'uppercase', marginBottom: 4,
                transition: 'opacity 0.3s ease',
              }}>
                {headerSubtitle}
              </div>
              <h1 style={{
                fontSize: 26, fontWeight: 900, letterSpacing: '3px', color: '#fff',
                textTransform: 'uppercase', margin: 0, lineHeight: 1,
                textShadow: '0 0 30px rgba(46,204,113,0.15)',
                transition: 'all 0.2s ease',
              }}>
                {headerTitle}
              </h1>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {onSettingsClick && activeTab === 'campaigns' && (
                <button
                  onClick={onSettingsClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 6,
                    border: '1px solid rgba(0,229,255,0.20)',
                    background: 'rgba(0,229,255,0.06)',
                    cursor: 'pointer', transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(0,229,255,0.45)';
                    e.currentTarget.style.background = 'rgba(0,229,255,0.12)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(0,229,255,0.20)';
                    e.currentTarget.style.background = 'rgba(0,229,255,0.06)';
                  }}
                >
                  <Settings size={13} color="#00e5ff" style={{ opacity: 0.7 }} />
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '1.5px',
                    color: '#00e5ff', opacity: 0.7, textTransform: 'uppercase',
                  }}>
                    SCOPE
                  </span>
                </button>
              )}

              {activeTab === 'campaigns' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#2ecc71', opacity: 0.4, fontWeight: 700 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#2ecc71', display: 'inline-block',
                    animation: 'cs-hot-pulse 2s ease-in-out infinite',
                  }} />
                  {availableCount} {viewMode === 'city' ? 'CITIES' : 'CAMPAIGNS'} AVAILABLE
                </div>
              )}
            </div>
          </div>

          {filterSummary && activeTab === 'campaigns' && <div style={{ marginBottom: 8 }}>{filterSummary}</div>}

          <div style={{
            height: 1,
            background: 'linear-gradient(to right, rgba(46,204,113,0.5) 0%, rgba(46,204,113,0.1) 60%, transparent 100%)',
            marginBottom: 0,
          }} />

          <MainTabBar active={activeTab} onChange={setActiveTab} isCalm={isCalm} />
        </div>

        {/* ── MAIN BODY ── */}
        <div style={{
          flex: 1,
          display: 'flex',
          position: 'relative',
          zIndex: 2,
          minHeight: 0,
        }}>

          {/* LEFT: Content area */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* CAMPAIGNS TAB */}
            {activeTab === 'campaigns' && (
              <div style={{
                flex: 1, overflowY: 'auto',
                padding: '12px 16px 24px 24px',
                display: 'flex', flexDirection: 'column',
              }}>
                {!resumeLoading && resumeData && onResume && (
                  <ResumeBanner resumeData={resumeData} onResume={onResume} managerId={managerId} session={session} />
                )}

                {/* View mode toggle */}
                <ViewModeToggle
                  mode={viewMode}
                  onChange={setViewMode}
                  hasCityCards={!!cityCards && cityCards.length > 0}
                />

                {/* Tab View */}
                {viewMode === 'tab' && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 12,
                    alignContent: 'start',
                    marginTop: 8,
                  }}>
                    {sorted.map((c, idx) => (
                      <CampaignCard
                        key={c.id}
                        campaign={c}
                        isHot={hotCampaignIds.has(c.id) || !!c.hot || isAutoHot(c.avgAttempts)}
                        isArmed={c.id === armedId}
                        isDeploying={c.id === armedId && deploying}
                        index={idx}
                        onArm={() => handleArm(c.id)}
                        onDeploy={() => handleDeploy(c.id)}
                      />
                    ))}
                    {sorted.length === 0 && (
                      <div style={{
                        gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px',
                        color: '#444', fontSize: 12, fontWeight: 700, letterSpacing: '2px',
                      }}>
                        NO CAMPAIGNS AVAILABLE
                      </div>
                    )}
                  </div>
                )}

                {/* City View */}
                {viewMode === 'city' && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 12,
                    alignContent: 'start',
                    marginTop: 8,
                  }}>
                    {sortedCities.map((city, idx) => (
                      <CityCard
                        key={city.cityName}
                        city={city}
                        isArmed={city.cityName === armedId}
                        isDeploying={city.cityName === armedId && deploying}
                        index={idx}
                        onArm={() => handleArm(city.cityName)}
                        onDeploy={() => handleCityDeploy(city)}
                      />
                    ))}
                    {sortedCities.length === 0 && (
                      <div style={{
                        gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px',
                        color: '#444', fontSize: 12, fontWeight: 700, letterSpacing: '2px',
                      }}>
                        NO CITIES FOUND
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STATS TAB — not shown to ROBA */}
            {activeTab === 'stats' && !isCalm && (
              <StatsView campaignId={campaignId} managerId={managerId} />
            )}

            {/* ACHIEVEMENTS TAB — not shown to ROBA */}
            {activeTab === 'achievements' && !isCalm && (
              <AchievementsView managerId={managerId} session={session} />
            )}
          </div>

          {/* RIGHT: Fireteam panel — hidden for ROBA */}
          {!isCalm && (
            <div style={{
              width: 250,
              flexShrink: 0,
              borderLeft: '1px solid rgba(0,229,255,0.10)',
              background: 'rgba(4,8,4,0.98)',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                padding: '14px 12px 8px',
                borderBottom: '1px solid rgba(0,229,255,0.08)',
                flexShrink: 0,
              }}>
                <div style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '3px',
                  color: '#00e5ff', opacity: 0.35, textTransform: 'uppercase',
                }}>
                  LIVE OPS INTEL
                </div>
                {presence.length > 0 && (
                  <div style={{
                    fontSize: 8, color: '#2ecc71', opacity: 0.5,
                    fontWeight: 700, letterSpacing: '1px', marginTop: 3,
                  }}>
                    <span style={{ marginRight: 4 }}>●</span>
                    {presence.length} OPERATIVE{presence.length !== 1 ? 'S' : ''} DEPLOYED
                  </div>
                )}
              </div>

              {campaignId && managerId && managerName ? (
                <FireteamPanel
                  campaignId={campaignId}
                  managerId={managerId}
                  managerName={managerName}
                  liveMultiplierEvents={[]}
                />
              ) : (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#1a2a1a', fontSize: 9, fontWeight: 700, letterSpacing: '2px',
                  textAlign: 'center', padding: '20px',
                }}>
                  AWAITING<br />DEPLOYMENT
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// =============================================================================
// CAMPAIGN CARD — now shows BC/STD type badge
// =============================================================================

function CampaignCard({
  campaign: c,
  isHot,
  isArmed,
  isDeploying,
  index,
  onArm,
  onDeploy,
}: {
  campaign: Campaign;
  isHot: boolean;
  isArmed: boolean;
  isDeploying: boolean;
  index: number;
  onArm: () => void;
  onDeploy: () => void;
}) {
  c = {
    ...c,
    totalRows: c.totalRows ?? 0,
    bookings: c.bookings ?? 0,
    reachedPct: c.reachedPct ?? 0,
    avgAttempts: c.avgAttempts ?? 0,
  };

  const accent = heatColor(c.avgAttempts);
  const bg = heatGradient(c.avgAttempts);
  const glow = heatGlow(c.avgAttempts);
  const topo = topoPattern(c.id, accent);
  const grid = gridOverlay(accent);
  const reach = reachStatus(c.reachedPct);

  const cardBoxShadow = isArmed
    ? `${glow}, 0 0 0 1.5px ${accent}60`
    : isHot ? `${glow}` : '0 2px 8px rgba(0,0,0,0.3)';

  const isBC = c.campaignType === 'bc';

  return (
    <div
      onClick={c.locked ? undefined : onArm}
      style={{
        position: 'relative', borderRadius: 8,
        border: `1.5px solid ${isArmed ? accent : c.locked ? 'rgba(255,255,255,0.04)' : `${accent}28`}`,
        background: bg,
        cursor: c.locked ? 'not-allowed' : 'pointer',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        transform: isArmed ? 'scale(1.01)' : 'scale(1)',
        boxShadow: cardBoxShadow,
        opacity: c.locked ? 0.45 : 1,
        animation: `cs-card-enter 0.4s ease-out ${index * 0.04}s both`,
      }}
    >
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(topo)}")`,
        backgroundSize: 'cover', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(grid)}")`,
        backgroundSize: '40px 40px', pointerEvents: 'none',
      }} />

      {isArmed && (
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: `linear-gradient(to right, transparent, ${accent}50, transparent)`,
          animation: 'cs-scan-line 2s linear infinite',
          pointerEvents: 'none', zIndex: 5,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {c.codename && (
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2.5px', color: accent, opacity: 0.6, textTransform: 'uppercase' }}>
                {c.codename}
              </span>
            )}
            {/* Book type badge */}
            {c.campaignType && (
              <span style={{
                fontSize: 7,
                fontWeight: 900,
                letterSpacing: '1px',
                color: isBC ? '#f1c40f' : '#2ecc71',
                background: isBC ? 'rgba(241,196,15,0.12)' : 'rgba(46,204,113,0.10)',
                border: `1px solid ${isBC ? 'rgba(241,196,15,0.30)' : 'rgba(46,204,113,0.25)'}`,
                borderRadius: 3,
                padding: '2px 5px',
                textTransform: 'uppercase',
              }}>
                {isBC ? 'BC' : 'STD'}
              </span>
            )}
          </div>
          {isHot && (
            <span style={{
              fontSize: 7, fontWeight: 900, letterSpacing: '1.5px', color: '#ff4422',
              background: 'rgba(255,68,34,0.12)', border: '1px solid rgba(255,68,34,0.35)',
              borderRadius: 3, padding: '2px 6px',
              animation: 'cs-badge-pulse 2s ease-in-out infinite',
            }}>
              🔥 HOT
            </span>
          )}
        </div>

        <h3 style={{
          fontSize: 16, fontWeight: 900, color: '#fff',
          margin: '0 0 8px 0', letterSpacing: '0.5px', lineHeight: 1.2,
          textShadow: isArmed ? `0 0 12px ${accent}50` : 'none',
        }}>
          {c.name}
        </h3>

        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <MiniStat label="ROWS"     value={(c.totalRows).toLocaleString()} color={accent} />
          <MiniStat label="BOOKINGS" value={c.bookings}                     color={c.bookings > 0 ? '#f1c40f' : '#555'} />
          <MiniStat label="REACHED"  value={`${Math.round(c.reachedPct)}%`} color={reach.color} />
          <MiniStat label="AVG ATT"  value={c.avgAttempts.toFixed(1)}       color={accent} />
        </div>

        <div style={{ marginBottom: isArmed ? 10 : 8 }}>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(c.reachedPct, 100)}%`, borderRadius: 2,
              background: `linear-gradient(to right, ${reach.color}80, ${reach.color})`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px' }}>
            {c.locked ? `🔒 ${c.lockedReason || 'LOCKED'}` : `LAST: ${formatDate(c.lastDeployed)}`}
          </span>
          {!c.locked && (
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}80`, opacity: 0.7 }} />
          )}
        </div>

        {isArmed && !c.locked && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDeploy(); }}
              disabled={isDeploying}
              style={{
                width: '100%', padding: '14px 20px', borderRadius: 7,
                border: `1.5px solid ${isDeploying ? accent : `${accent}90`}`,
                background: isDeploying ? `${accent}30` : `linear-gradient(135deg, ${accent}20 0%, ${accent}0a 100%)`,
                color: isDeploying ? '#fff' : accent,
                fontSize: 13, fontWeight: 900, fontFamily: 'inherit',
                letterSpacing: '4px', textTransform: 'uppercase',
                cursor: isDeploying ? 'not-allowed' : 'pointer',
                position: 'relative', overflow: 'hidden',
                animation: isDeploying ? 'cs-deploy-confirm 0.5s ease-out both' : 'cs-deploy-glow 3s ease-in-out infinite',
              }}
            >
              {!isDeploying && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: '60%',
                  background: `linear-gradient(90deg, transparent, ${accent}18, transparent)`,
                  animation: 'cs-deploy-sweep 2.5s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>
                {isDeploying ? '⚡ DEPLOYING...' : '🎯 DEPLOY'}
              </span>
            </button>
          </div>
        )}
      </div>

      {isArmed && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
          animation: 'cs-arm-border 1.5s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

// =============================================================================
// CITY CARD
// =============================================================================

function CityCard({
  city,
  isArmed,
  isDeploying,
  index,
  onArm,
  onDeploy,
}: {
  city: CityInfo;
  isArmed: boolean;
  isDeploying: boolean;
  index: number;
  onArm: () => void;
  onDeploy: () => void;
}) {
  const avgAttempts = city.avgAttempts ?? 0;
  const accent = heatColor(avgAttempts);
  const bg = heatGradient(avgAttempts);
  const glow = heatGlow(avgAttempts);
  const topo = topoPattern(city.cityName, accent);
  const grid = gridOverlay(accent);
  const reach = reachStatus(city.reachedPct);

  const cardBoxShadow = isArmed
    ? `${glow}, 0 0 0 1.5px ${accent}60`
    : '0 2px 8px rgba(0,0,0,0.3)';

  return (
    <div
      onClick={onArm}
      style={{
        position: 'relative', borderRadius: 8,
        border: `1.5px solid ${isArmed ? accent : `${accent}28`}`,
        background: bg,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        transform: isArmed ? 'scale(1.01)' : 'scale(1)',
        boxShadow: cardBoxShadow,
        animation: `cs-card-enter 0.4s ease-out ${index * 0.04}s both`,
      }}
    >
      {/* Background textures */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(topo)}")`,
        backgroundSize: 'cover', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(grid)}")`,
        backgroundSize: '40px 40px', pointerEvents: 'none',
      }} />

      {isArmed && (
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: `linear-gradient(to right, transparent, ${accent}50, transparent)`,
          animation: 'cs-scan-line 2s linear infinite',
          pointerEvents: 'none', zIndex: 5,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px' }}>
        {/* Top row: CITY label + tab count badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2.5px', color: accent, opacity: 0.6, textTransform: 'uppercase' }}>
            🏙 CITY OPS
          </span>
          <span style={{
            fontSize: 7, fontWeight: 800, color: '#3498db',
            background: 'rgba(52,152,219,0.10)', border: '1px solid rgba(52,152,219,0.25)',
            borderRadius: 3, padding: '2px 6px', letterSpacing: '1px',
          }}>
            {city.tabs.length} TAB{city.tabs.length !== 1 ? 'S' : ''}
          </span>
        </div>

        {/* City name */}
        <h3 style={{
          fontSize: 16, fontWeight: 900, color: '#fff',
          margin: '0 0 8px 0', letterSpacing: '0.5px', lineHeight: 1.2,
          textShadow: isArmed ? `0 0 12px ${accent}50` : 'none',
        }}>
          {city.cityName}
        </h3>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <MiniStat label="ROWS"     value={city.totalRows.toLocaleString()} color={accent} />
          <MiniStat label="BOOKINGS" value={city.bookings}                   color={city.bookings > 0 ? '#f1c40f' : '#555'} />
          <MiniStat label="REACHED"  value={`${Math.round(city.reachedPct)}%`} color={reach.color} />
          <MiniStat label="AVG ATT"  value={avgAttempts.toFixed(1)}          color={accent} />
        </div>

        {/* Reach progress bar */}
        <div style={{ marginBottom: isArmed ? 10 : 8 }}>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(city.reachedPct, 100)}%`, borderRadius: 2,
              background: `linear-gradient(to right, ${reach.color}80, ${reach.color})`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Tab source badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: isArmed ? 8 : 0 }}>
          {city.tabs.slice(0, 6).map(tab => (
            <span key={tab} style={{
              fontSize: 7, fontWeight: 700, color: '#3498db',
              background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.18)',
              borderRadius: 3, padding: '1px 5px', letterSpacing: '0.5px',
            }}>
              {tab}
            </span>
          ))}
          {city.tabs.length > 6 && (
            <span style={{ fontSize: 7, fontWeight: 700, color: '#555' }}>+{city.tabs.length - 6}</span>
          )}
        </div>

        {/* Last used */}
        {!isArmed && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px' }}>
              LAST: {formatDate(city.lastUsed)}
            </span>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}80`, opacity: 0.7 }} />
          </div>
        )}

        {/* Deploy button */}
        {isArmed && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDeploy(); }}
              disabled={isDeploying}
              style={{
                width: '100%', padding: '14px 20px', borderRadius: 7,
                border: `1.5px solid ${isDeploying ? accent : `${accent}90`}`,
                background: isDeploying ? `${accent}30` : `linear-gradient(135deg, ${accent}20 0%, ${accent}0a 100%)`,
                color: isDeploying ? '#fff' : accent,
                fontSize: 13, fontWeight: 900, fontFamily: 'inherit',
                letterSpacing: '4px', textTransform: 'uppercase',
                cursor: isDeploying ? 'not-allowed' : 'pointer',
                position: 'relative', overflow: 'hidden',
                animation: isDeploying ? 'cs-deploy-confirm 0.5s ease-out both' : 'cs-deploy-glow 3s ease-in-out infinite',
              }}
            >
              {!isDeploying && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: '60%',
                  background: `linear-gradient(90deg, transparent, ${accent}18, transparent)`,
                  animation: 'cs-deploy-sweep 2.5s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>
                {isDeploying ? '⚡ DEPLOYING...' : '🏙 DEPLOY CITY'}
              </span>
            </button>
          </div>
        )}
      </div>

      {isArmed && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
          animation: 'cs-arm-border 1.5s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

// =============================================================================
// MINI STAT (shared)
// =============================================================================

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}