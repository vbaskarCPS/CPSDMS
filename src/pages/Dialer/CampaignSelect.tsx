// src/pages/Dialer/CampaignSelect.tsx
//
// Video-game-style campaign / map selection screen for AutoSniper.
// Think: Call of Duty map selection meets military command center.
//
// Heat scale based on avgAttempts (call-through rate):
//   ≤ 1.1  → green  (#2ecc71) — barely touched
//   1.1–2  → yellow (#f1c40f)
//   2–3    → orange (#e67e22)
//   3–4    → red    (#e74c3c)
//   4–5    → purple (#9b59b6)
//   5+     → brown  (#8B6914)
//
// HOT badge: driven by live presence — a teammate is currently deployed
//            in this campaign (last heartbeat within 90 seconds).
//
// Layout: card grid (left, flex-1) | FireteamPanel (right, 300px fixed)
// Deploy flow: click card → arms it (scan line, accent glow) → DEPLOY
//              button appears on card → click DEPLOY → modal opens
//
// Resume banner: shown at top of card area when resumeData is present.
//   Clicking RESUME OPERATION calls onResume() which bypasses deploy config.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings } from 'lucide-react';
import FireteamPanel from './FireteamPanel';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';
import type { PresenceRecord } from '../../lib/dialerRealtimeService';
import type { ResumeData } from '../../lib/campaignService';
import { getTodayEST } from '../../lib/campaignService';

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
  hot?: boolean; // manual override — forces HOT regardless of presence
}

interface CampaignSelectProps {
  campaigns: Campaign[];
  onDeploy: (campaignId: string) => void;
  onSettingsClick?: () => void;
  filterSummary?: React.ReactNode;
  // Passed through to FireteamPanel
  campaignId?: string;
  managerId?: string;
  managerName?: string;
  // Resume Game
  resumeData?: ResumeData | null;
  resumeLoading?: boolean;
  onResume?: () => void;
}

// =============================================================================
// HEAT SCALE
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

// =============================================================================
// HELPERS
// =============================================================================

function reachStatus(pct: number): { label: string; color: string } {
  if (pct < 20) return { label: 'FRESH', color: '#2ecc71' };
  if (pct < 50) return { label: 'ACTIVE', color: '#f1c40f' };
  if (pct < 80) return { label: 'WORKED', color: '#e67e22' };
  return { label: 'SATURATED', color: '#e74c3c' };
}

function formatDate(iso?: string): string {
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

// Procedural topo-map pattern SVG (unique per campaign based on id hash)
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
`;

// =============================================================================
// RESUME BANNER
// =============================================================================

function ResumeBanner({
  resumeData,
  onResume,
}: {
  resumeData: ResumeData;
  onResume: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isToday = resumeData.sessionDate === getTodayEST();
  const lastSeen = formatLastSeen(resumeData.lastUpdatedAt);

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
        overflow: 'hidden',
      }}
    >
      {/* Subtle animated shimmer */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0, width: '40%',
        background: 'linear-gradient(90deg, transparent, rgba(245,166,35,0.05), transparent)',
        animation: 'cs-resume-sweep 4s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Left: signal icon + label */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 18, lineHeight: 1, marginBottom: 2 }}>📡</div>
        </div>

        {/* Center: text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 8, fontWeight: 800, letterSpacing: '3px',
            color: '#f5a623', opacity: 0.7, textTransform: 'uppercase',
            marginBottom: 3,
          }}>
            LAST OPERATION DETECTED
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 12, fontWeight: 900, color: '#fff',
              letterSpacing: '0.5px',
            }}>
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
              <span style={{ fontSize: 9, color: '#666', fontWeight: 600 }}>
                {lastSeen}
              </span>
            )}
          </div>
          <div style={{ fontSize: 9, color: '#555', marginTop: 2, fontFamily: 'monospace' }}>
            Position: {resumeData.position.startsWith('ROW:') ? `Row ${resumeData.position.slice(4)}` : resumeData.position}
            {!isToday && (
              <span style={{ color: '#444', marginLeft: 8 }}>
                · Gamification resets (new day)
              </span>
            )}
          </div>
        </div>

        {/* Right: Resume button */}
        <button
          onClick={onResume}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            flexShrink: 0,
            padding: '10px 20px',
            borderRadius: 6,
            border: `1.5px solid ${hovered ? '#f5a623' : 'rgba(245,166,35,0.5)'}`,
            background: hovered
              ? 'rgba(245,166,35,0.18)'
              : 'rgba(245,166,35,0.08)',
            color: '#f5a623',
            fontSize: 11,
            fontWeight: 900,
            fontFamily: 'monospace',
            letterSpacing: '2.5px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          ⚡ RESUME
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
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
}: CampaignSelectProps) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [presence, setPresence] = useState<PresenceRecord[]>([]);

  // ---- Fetch and subscribe to presence ----
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    dialerRealtimeService.fetchActivePresence().then(setPresence);

    unsubscribe = dialerRealtimeService.subscribeToPresence((records) => {
      setPresence(records);
    });

    return () => { unsubscribe?.(); };
  }, []);

  // Set of campaign IDs that have a teammate actively deployed
  const hotCampaignIds = new Set(presence.map(p => p.campaignId));

  // Sort: presence-hot first, auto-hot next, then unlocked, then locked
  const sorted = [...campaigns].sort((a, b) => {
    const aHot = hotCampaignIds.has(a.id) || a.hot || isAutoHot(a.avgAttempts);
    const bHot = hotCampaignIds.has(b.id) || b.hot || isAutoHot(b.avgAttempts);
    if (aHot && !bHot) return -1;
    if (!aHot && bHot) return 1;
    if (a.locked && !b.locked) return 1;
    if (!a.locked && b.locked) return -1;
    return a.name.localeCompare(b.name);
  });

  const handleArm = useCallback((id: string) => {
    setArmedId(prev => prev === id ? null : id);
    setDeploying(false);
  }, []);

  const handleDeploy = useCallback((id: string) => {
    setDeploying(true);
    setTimeout(() => {
      onDeploy(id);
    }, 600);
  }, [onDeploy]);

  return (
    <>
      <style>{CAMPAIGN_STYLES}</style>

      {/* === NOISE OVERLAY === */}
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>`)}")`,
        backgroundSize: '200px 200px',
      }} />

      <div style={{
        minHeight: '100vh',
        background: '#060a06',
        color: '#ddd',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* === HEADER === */}
        <div style={{
          padding: '24px 24px 0',
          position: 'relative',
          zIndex: 2,
          animation: 'cs-header-slide 0.5s ease-out both',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 8 }}>
            <div>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '4px',
                color: '#2ecc71', opacity: 0.5, textTransform: 'uppercase', marginBottom: 4,
              }}>
                AUTOSNIPER M82 // TACTICAL OPERATIONS
              </div>
              <h1 style={{
                fontSize: 28, fontWeight: 900, letterSpacing: '3px', color: '#fff',
                textTransform: 'uppercase', margin: 0, lineHeight: 1,
                textShadow: '0 0 30px rgba(46,204,113,0.15)',
              }}>
                SELECT CAMPAIGN
              </h1>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {onSettingsClick && (
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#2ecc71', opacity: 0.4, fontWeight: 700 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#2ecc71', display: 'inline-block',
                  animation: 'cs-hot-pulse 2s ease-in-out infinite',
                }} />
                {campaigns.filter(c => !c.locked).length} CAMPAIGNS AVAILABLE
              </div>
            </div>
          </div>

          {filterSummary && <div style={{ marginBottom: 8 }}>{filterSummary}</div>}

          <div style={{
            height: 1,
            background: 'linear-gradient(to right, rgba(46,204,113,0.5) 0%, rgba(46,204,113,0.1) 60%, transparent 100%)',
            marginBottom: 16,
          }} />
        </div>

        {/* === MAIN BODY: card grid + fireteam panel === */}
        <div style={{
          flex: 1,
          display: 'flex',
          position: 'relative',
          zIndex: 2,
          minHeight: 0,
        }}>

          {/* --- Campaign Cards Grid --- */}
          <div style={{
            flex: 1,
            padding: '0 16px 24px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Resume Banner — shown above cards when a last position exists */}
            {!resumeLoading && resumeData && onResume && (
              <ResumeBanner resumeData={resumeData} onResume={onResume} />
            )}

            {/* Cards grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
              alignContent: 'start',
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
          </div>

          {/* --- Permanent Fireteam Panel --- */}
          <div style={{
            width: 300,
            flexShrink: 0,
            borderLeft: '1px solid rgba(0,229,255,0.10)',
            background: 'rgba(4,8,4,0.98)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Live Ops header */}
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

            {/* FireteamPanel — only renders if we have IDs */}
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
        </div>
      </div>
    </>
  );
}

// =============================================================================
// CAMPAIGN CARD
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
    : isHot
      ? `${glow}`
      : '0 2px 8px rgba(0,0,0,0.3)';

  return (
    <div
      onClick={c.locked ? undefined : onArm}
      style={{
        position: 'relative',
        borderRadius: 8,
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
      {/* Topo pattern bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(topo)}")`,
        backgroundSize: 'cover', pointerEvents: 'none',
      }} />

      {/* Grid overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(grid)}")`,
        backgroundSize: '40px 40px', pointerEvents: 'none',
      }} />

      {/* Scan line — only when armed */}
      {isArmed && (
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: `linear-gradient(to right, transparent, ${accent}50, transparent)`,
          animation: 'cs-scan-line 2s linear infinite',
          pointerEvents: 'none', zIndex: 5,
        }} />
      )}

      {/* Card content */}
      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px' }}>

        {/* Top row: codename + HOT badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          {c.codename ? (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '2.5px',
              color: accent, opacity: 0.6, textTransform: 'uppercase',
            }}>
              {c.codename}
            </span>
          ) : <span />}

          {isHot && (
            <span style={{
              fontSize: 7, fontWeight: 900, letterSpacing: '1.5px',
              color: '#ff4422',
              background: 'rgba(255,68,34,0.12)',
              border: '1px solid rgba(255,68,34,0.35)',
              borderRadius: 3, padding: '2px 6px',
              animation: 'cs-badge-pulse 2s ease-in-out infinite',
            }}>
              🔥 HOT
            </span>
          )}
        </div>

        {/* Campaign name */}
        <h3 style={{
          fontSize: 16, fontWeight: 900, color: '#fff',
          margin: '0 0 8px 0', letterSpacing: '0.5px', lineHeight: 1.2,
          textShadow: isArmed ? `0 0 12px ${accent}50` : 'none',
        }}>
          {c.name}
        </h3>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <MiniStat label="ROWS"     value={(c.totalRows).toLocaleString()} color={accent} />
          <MiniStat label="BOOKINGS" value={c.bookings}                     color={c.bookings > 0 ? '#f1c40f' : '#555'} />
          <MiniStat label="REACHED"  value={`${Math.round(c.reachedPct)}%`} color={reach.color} />
          <MiniStat label="AVG ATT"  value={c.avgAttempts.toFixed(1)}       color={accent} />
        </div>

        {/* Reached progress bar */}
        <div style={{ marginBottom: isArmed ? 10 : 8 }}>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(c.reachedPct, 100)}%`,
              borderRadius: 2,
              background: `linear-gradient(to right, ${reach.color}80, ${reach.color})`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Bottom row: last deployed */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px' }}>
            {c.locked
              ? `🔒 ${c.lockedReason || 'LOCKED'}`
              : `LAST: ${formatDate(c.lastDeployed)}`}
          </span>

          {/* Heat indicator dot */}
          {!c.locked && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: accent,
              boxShadow: `0 0 6px ${accent}80`,
              opacity: 0.7,
            }} />
          )}
        </div>

        {/* === DEPLOY BUTTON — slides in when armed === */}
        {isArmed && !c.locked && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDeploy(); }}
              disabled={isDeploying}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 7,
                border: `1.5px solid ${isDeploying ? accent : `${accent}90`}`,
                background: isDeploying
                  ? `${accent}30`
                  : `linear-gradient(135deg, ${accent}20 0%, ${accent}0a 100%)`,
                color: isDeploying ? '#fff' : accent,
                fontSize: 13,
                fontWeight: 900,
                fontFamily: 'inherit',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                cursor: isDeploying ? 'not-allowed' : 'pointer',
                position: 'relative',
                overflow: 'hidden',
                animation: isDeploying
                  ? 'cs-deploy-confirm 0.5s ease-out both'
                  : 'cs-deploy-glow 3s ease-in-out infinite',
              }}
            >
              {/* Sweep shimmer */}
              {!isDeploying && (
                <div style={{
                  position: 'absolute',
                  top: 0, bottom: 0, width: '60%',
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

      {/* Armed accent bar at bottom */}
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
// MINI STAT
// =============================================================================

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px', marginBottom: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}