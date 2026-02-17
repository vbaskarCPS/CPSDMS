// src/pages/Dialer/DialerHUD.tsx
//
// Metroid Prime-inspired visor HUD for the AutoSniper dialer.
// Top: auto-fire toggle | multiplier tiles (centered) | total mult + menu
// Bottom: stats + big points counter with energy bar
// Visor arcs + vignette frame the viewport.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GamificationSession, MultiplierSnapshot, Rank } from '../../lib/dialer/gamificationDefs';
import { getMultiplierIcon, getMultiplierTierIcon, getBadgeIcon, getBadgeCategoryColor } from './BadgeIcons';

// =============================================================================
// TYPES & EXPORTS
// =============================================================================

/** A booking event from another manager on the team */
export interface TeamBookingEvent {
  id: string;
  name: string;
  points: number;
  badges?: string[];
  multipliers?: string[];
  timestamp: number;
  isPrepay?: boolean;
}

export type HUDMenuAction = 'campaigns' | 'team' | 'achievements' | 'logs' | 'multipliers' | 'reset';

interface HUDProps {
  session: GamificationSession | null;
  activeMultipliers: MultiplierSnapshot[];
  multipliersReceivedAt: number;
  rank: Rank | null;
  onMenuAction?: (action: HUDMenuAction) => void;
  onTrophyClick: () => void;
  onPointsClick?: () => void;
  teamFeed?: TeamBookingEvent[];
  autoFire?: boolean;
  onAutoFireChange?: (v: boolean) => void;
}

// =============================================================================
// THEME
// =============================================================================

const CY = '#00e5ff';      // cyan primary
const CY2 = '#00b8d4';     // darker cyan
const OR = '#f5a623';      // orange accent
const VISOR_BG = 'rgba(0,14,22,';

// Multiplier colors
const MULT_THEME: Record<string, { color: string; glow: string }> = {
  op_tempo:       { color: '#f5a623', glow: 'rgba(245,166,35,0.4)' },
  tracer_rounds:  { color: '#e74c3c', glow: 'rgba(231,76,60,0.4)' },
  high_ground:    { color: '#00e5ff', glow: 'rgba(0,229,255,0.4)' },
  night_vision:   { color: '#9b59b6', glow: 'rgba(155,89,182,0.4)' },
  blitz:          { color: '#ff6b35', glow: 'rgba(255,107,53,0.4)' },
  enraged:        { color: '#ff0040', glow: 'rgba(255,0,64,0.5)' },
  ratio_focus:    { color: '#3498db', glow: 'rgba(52,152,219,0.4)' },
  war_machine:    { color: '#95a5a6', glow: 'rgba(149,165,166,0.4)' },
  ghost_town:     { color: '#bdc3c7', glow: 'rgba(189,195,199,0.4)' },
  cold_streak:    { color: '#85c1e9', glow: 'rgba(133,193,233,0.4)' },
  scorched_earth: { color: '#ff5722', glow: 'rgba(255,87,34,0.5)' },
  indoctrinate:   { color: '#e056a0', glow: 'rgba(224,86,160,0.5)' },
};

const MULT_DESC: Record<string, string> = {
  op_tempo: '2+ YES streak → +0.2x, grows per level. 20min timer.',
  tracer_rounds: '2+ prepay streak → +0.2x, grows +0.2x. 20min timer.',
  high_ground: '+1.0x while on same street as last YES.',
  night_vision: '+0.2x per booking after 8pm. Stacks.',
  blitz: '5 bookings in 20/40/60min → 2.0x/1.5x/1.0x.',
  enraged: '3 rejections → tiered bonus. Consumed on YES.',
  ratio_focus: 'PP ratio ≥ 20% → ratio becomes multiplier.',
  war_machine: '+0.1x per hour at 50+ dials/hr.',
  ghost_town: '10 unreached → 0.5x (3 charges).',
  cold_streak: '20 dials without YES → +1.0x (2 charges).',
  scorched_earth: 'Clear a street → 1.1x-3.0x, 5 charges.',
  indoctrinate: 'Convert a non-app client → badge bonuses get multiplied for 2 bookings.',
};

const MENU_ITEMS: { id: HUDMenuAction; icon: string; label: string; desc: string }[] = [
  { id: 'campaigns', icon: '🗺️', label: 'CAMPAIGNS', desc: 'Back to map select' },
  { id: 'team', icon: '👥', label: 'TEAM STATS', desc: 'Live team feed' },
  { id: 'achievements', icon: '🏆', label: 'ACHIEVEMENTS', desc: 'Badges & progress' },
  { id: 'logs', icon: '📋', label: 'LOGS', desc: 'Session history' },
  { id: 'multipliers', icon: '⚡', label: 'MULTIPLIERS', desc: 'Active & available' },
  { id: 'reset', icon: '🔄', label: 'RESET SESSION', desc: 'Reset all counters' },
];

// =============================================================================
// KEYFRAMES
// =============================================================================

const HUD_STYLES = `
  @keyframes hud-tile-enter {
    0% { opacity: 0; transform: scale(0.7) rotateY(40deg); }
    60% { transform: scale(1.05) rotateY(-3deg); }
    100% { opacity: 1; transform: scale(1) rotateY(0); }
  }
  @keyframes hud-tile-breathe {
    0%, 100% { box-shadow: var(--tile-shadow-rest); }
    50% { box-shadow: var(--tile-shadow-breathe); }
  }
  @keyframes hud-enraged-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(255,0,64,0.15), inset 0 0 12px rgba(255,0,64,0.05); }
    50% { box-shadow: 0 0 18px rgba(255,0,64,0.5), inset 0 0 16px rgba(255,0,64,0.12); }
  }
  @keyframes hud-scorched-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(255,87,34,0.15); }
    50% { box-shadow: 0 0 16px rgba(255,87,34,0.45); }
  }
  @keyframes hud-tooltip-in {
    0% { opacity: 0; transform: translateY(6px) scale(0.95); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes hud-pts-burst {
    0% { text-shadow: 0 0 8px ${CY}60; }
    50% { text-shadow: 0 0 30px ${CY}, 0 0 60px ${CY}80; }
    100% { text-shadow: 0 0 8px ${CY}60; }
  }
  @keyframes hud-streak-pulse {
    0%, 100% { text-shadow: 0 0 6px ${OR}40; }
    50% { text-shadow: 0 0 16px ${OR}90, 0 0 30px ${OR}40; }
  }
  @keyframes hud-menu-slide {
    0% { opacity: 0; transform: translateX(20px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes hud-team-toast-in {
    0% { transform: translateX(120%); opacity: 0; }
    60% { transform: translateX(-4%); opacity: 1; }
    100% { transform: translateX(0); opacity: 1; }
  }
  @keyframes hud-team-toast-out {
    0% { transform: translateX(0); opacity: 1; max-height: 44px; margin-bottom: 4px; }
    50% { transform: translateX(100%); opacity: 0; max-height: 44px; margin-bottom: 4px; }
    100% { transform: translateX(100%); opacity: 0; max-height: 0; margin-bottom: 0; }
  }
  @keyframes hud-team-points-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
`;

// =============================================================================
// HELPERS
// =============================================================================

function formatCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function getTheme(id: string) {
  return MULT_THEME[id] || { color: CY, glow: `${CY}40` };
}

// =============================================================================
// MULTIPLIER ICON DISPLAY
// =============================================================================

function MultiplierIconDisplay({ multiplier, size = 14 }: { multiplier: MultiplierSnapshot; size?: number }) {
  const tier = (multiplier.extra as any)?.tier;
  let icon: React.ReactNode = null;
  if (tier !== undefined && tier > 0) {
    icon = getMultiplierTierIcon(multiplier.id, tier - 1, size);
  }
  if (!icon) {
    icon = getMultiplierIcon(multiplier.id, size);
  }
  if (icon) {
    return <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>;
  }
  return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{multiplier.icon}</span>;
}

// =============================================================================
// MULTIPLIER STRIP (below top bar row)
// =============================================================================

function MultiplierStrip({
  multipliers,
  receivedAt,
}: {
  multipliers: MultiplierSnapshot[];
  receivedAt: number;
}) {
  const [, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const hasTimed = multipliers.some(m => m.expiresIn > 0);
    if (hasTimed) {
      timerRef.current = setInterval(() => setTick(t => t + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [multipliers]);

  if (multipliers.length === 0) return null;

  const now = Date.now();
  const elapsed = now - receivedAt;
  const TILE = 48;
  const ICON_SIZE = 26;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        overflow: 'visible',
        paddingBottom: 8,
        paddingTop: 4,
      }}
    >
      {multipliers.map((m, idx) => {
        const remainingMs = m.expiresIn > 0 ? m.expiresIn - elapsed : m.expiresIn;
        if (m.expiresIn > 0 && remainingMs <= 0) return null;

        const countdown = formatCountdown(remainingMs);
        const theme = getTheme(m.id);
        const charges = (m.extra as any)?.charges;
        const isEnraged = m.id === 'enraged';
        const isScorched = m.id === 'scorched_earth';
        const isHovered = hoveredId === m.id;

        let timerProgress = 1;
        if (m.expiresIn > 0 && remainingMs > 0) {
          timerProgress = Math.max(0, remainingMs / m.expiresIn);
        }

        const shadowRest = `0 2px 8px rgba(0,0,0,0.6), 0 0 6px ${theme.color}20`;
        const shadowBreathe = `0 2px 12px rgba(0,0,0,0.6), 0 0 14px ${theme.color}40`;

        return (
          <div
            key={m.id}
            className="relative"
            onMouseEnter={() => setHoveredId(m.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ flexShrink: 0 }}
          >
            <div
              style={{
                width: TILE,
                height: TILE,
                borderRadius: 8,
                background: `radial-gradient(ellipse at 30% 30%, ${theme.color}15, rgba(0,14,22,0.95) 70%)`,
                border: `1.5px solid ${theme.color}${isHovered ? '90' : '40'}`,
                position: 'relative',
                overflow: 'hidden',
                cursor: 'default',
                transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                transform: isHovered ? 'scale(1.12) translateY(-2px)' : 'scale(1)',
                ['--tile-shadow-rest' as any]: shadowRest,
                ['--tile-shadow-breathe' as any]: shadowBreathe,
                animation: isEnraged
                  ? 'hud-enraged-pulse 1.2s ease-in-out infinite'
                  : isScorched
                    ? 'hud-scorched-pulse 2s ease-in-out infinite'
                    : `hud-tile-enter 0.45s cubic-bezier(0.34,1.56,0.64,1) ${idx * 0.07}s both, hud-tile-breathe 4s ease-in-out ${idx * 0.5}s infinite`,
                boxShadow: isHovered
                  ? `0 4px 20px rgba(0,0,0,0.7), 0 0 20px ${theme.color}50`
                  : shadowRest,
              }}
            >
              {/* Glow bar at bottom */}
              <div style={{
                position: 'absolute',
                bottom: 0, left: '10%', right: '10%', height: 2,
                background: `linear-gradient(to right, transparent, ${theme.color}60, transparent)`,
                borderRadius: 1,
              }} />

              {/* Icon */}
              <div style={{
                position: 'absolute',
                top: 4, left: '50%', transform: 'translateX(-50%)',
                width: ICON_SIZE, height: ICON_SIZE,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0.75,
                filter: `drop-shadow(0 0 4px ${theme.color}60)`,
              }}>
                <MultiplierIconDisplay multiplier={m} size={ICON_SIZE} />
              </div>

              {/* Value overlay */}
              {!m.extra?.modifiesScoring && <div style={{
                position: 'absolute',
                bottom: 2, left: 0, right: 0,
                textAlign: 'center',
                fontFamily: 'monospace',
                fontWeight: 900,
                fontSize: 13,
                lineHeight: 1,
                color: '#fff',
                textShadow: `0 0 6px ${theme.color}, 0 1px 2px rgba(0,0,0,0.8), 0 0 14px ${theme.color}60`,
                pointerEvents: 'none',
              }}>
                +{m.value}x
              </div>}
              {/* Indoctrinate shows ALL× instead of +value */}
              {m.extra?.modifiesScoring && <div style={{
                position: 'absolute',
                bottom: 2, left: 0, right: 0,
                textAlign: 'center',
                fontFamily: 'monospace',
                fontWeight: 900,
                fontSize: 11,
                lineHeight: 1,
                color: '#fff',
                textShadow: `0 0 6px ${theme.color}, 0 1px 2px rgba(0,0,0,0.8), 0 0 14px ${theme.color}60`,
                pointerEvents: 'none',
              }}>
                ALL×
              </div>}

              {/* Timer ring */}
              {m.expiresIn > 0 && timerProgress > 0 && timerProgress < 1 && (
                <svg
                  style={{ position: 'absolute', inset: -1, width: TILE + 2, height: TILE + 2, pointerEvents: 'none' }}
                  viewBox={`0 0 ${TILE + 2} ${TILE + 2}`}
                >
                  <rect
                    x="1" y="1" width={TILE} height={TILE} rx="8" ry="8"
                    fill="none" stroke={theme.color} strokeWidth="2"
                    strokeDasharray={`${(TILE * 4) * timerProgress} ${(TILE * 4)}`}
                    opacity="0.5"
                  />
                </svg>
              )}

              {/* Charges badge */}
              {charges && charges > 0 && (
                <div style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: theme.color, color: '#000',
                  fontSize: 9, fontWeight: 900, fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 1px 4px rgba(0,0,0,0.5), 0 0 6px ${theme.color}60`,
                  border: '1.5px solid rgba(0,0,0,0.3)', lineHeight: 1,
                }}>
                  {charges}
                </div>
              )}

              {/* Countdown */}
              {countdown && (
                <div style={{
                  position: 'absolute', top: 1, right: 3,
                  fontSize: 7, fontFamily: 'monospace', fontWeight: 700,
                  color: theme.color, opacity: 0.7, letterSpacing: '0.5px', lineHeight: 1,
                }}>
                  {countdown}
                </div>
              )}
            </div>

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="absolute z-30"
                style={{
                  top: TILE + 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  minWidth: 200, maxWidth: 240,
                  animation: 'hud-tooltip-in 0.2s ease-out both',
                }}
              >
                <div style={{
                  position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%)',
                  width: 0, height: 0,
                  borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
                  borderBottom: `7px solid ${theme.color}40`,
                }} />
                <div style={{
                  background: `${VISOR_BG}0.97)`,
                  border: `1px solid ${theme.color}40`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  boxShadow: `0 12px 36px rgba(0,0,0,0.8), 0 0 20px ${theme.glow}`,
                  backdropFilter: 'blur(12px)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 6,
                      background: `${theme.color}15`,
                      border: `1px solid ${theme.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <MultiplierIconDisplay multiplier={m} size={22} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'monospace', fontWeight: 900, fontSize: 11,
                        color: theme.color, letterSpacing: '1.5px',
                        textTransform: 'uppercase' as const, lineHeight: 1.2,
                      }}>
                        {m.name}
                      </div>
                      <div style={{
                        fontFamily: 'monospace', fontWeight: 900, fontSize: 20,
                        color: '#fff', textShadow: `0 0 12px ${theme.color}80`,
                        lineHeight: 1.1, marginTop: 1,
                      }}>
                        {m.extra?.modifiesScoring ? 'ALL×' : `+${m.value}x`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' as const }}>
                    {charges && (
                      <span style={{
                        fontSize: 8, fontFamily: 'monospace', fontWeight: 800,
                        color: theme.color, background: `${theme.color}12`,
                        border: `1px solid ${theme.color}30`, borderRadius: 4,
                        padding: '2px 6px', letterSpacing: '0.5px',
                      }}>{charges} CHARGES</span>
                    )}
                    {countdown && (
                      <span style={{
                        fontSize: 8, fontFamily: 'monospace', fontWeight: 800,
                        color: theme.color, background: `${theme.color}12`,
                        border: `1px solid ${theme.color}30`, borderRadius: 4,
                        padding: '2px 6px', letterSpacing: '0.5px',
                      }}>{countdown}</span>
                    )}
                    {!charges && !countdown && (
                      <span style={{
                        fontSize: 8, fontFamily: 'monospace', fontWeight: 800,
                        color: CY, background: `${CY}08`,
                        border: `1px solid ${CY}20`, borderRadius: 4,
                        padding: '2px 6px', letterSpacing: '1px',
                      }}>PASSIVE</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, color: '#888', lineHeight: 1.5,
                    borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8,
                  }}>
                    {MULT_DESC[m.id] || ''}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// TEAM FEED TOASTS
// =============================================================================

const TOAST_LIFETIME = 6000;
const MAX_VISIBLE = 4;

function TeamFeedToasts({ events }: { events: TeamBookingEvent[] }) {
  const [visibleToasts, setVisibleToasts] = useState<(TeamBookingEvent & { exiting?: boolean })[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const newOnes = events.filter(e => !seenRef.current.has(e.id));
    if (newOnes.length === 0) return;
    newOnes.forEach(e => seenRef.current.add(e.id));

    setVisibleToasts(prev => {
      const combined = [...prev.filter(t => !t.exiting), ...newOnes];
      return combined.slice(-MAX_VISIBLE - 2);
    });

    newOnes.forEach(e => {
      const timer = setTimeout(() => {
        setVisibleToasts(prev => prev.map(t => t.id === e.id ? { ...t, exiting: true } : t));
        const removeTimer = setTimeout(() => {
          setVisibleToasts(prev => prev.filter(t => t.id !== e.id));
          timersRef.current.delete(e.id);
        }, 500);
        timersRef.current.set(e.id + '_rm', removeTimer);
      }, TOAST_LIFETIME);
      timersRef.current.set(e.id, timer);
    });
  }, [events]);

  useEffect(() => {
    return () => { timersRef.current.forEach(t => clearTimeout(t)); };
  }, []);

  const visible = visibleToasts.slice(-MAX_VISIBLE);
  if (visible.length === 0) return null;

  return (
    <div
      className="absolute right-2 pointer-events-none"
      style={{ bottom: 62, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0, zIndex: 18, maxWidth: 320 }}
    >
      {visible.map((evt) => {
        const hasBadges = evt.badges && evt.badges.length > 0;
        const hasMults = evt.multipliers && evt.multipliers.length > 0;

        return (
          <div
            key={evt.id}
            style={{
              animation: evt.exiting
                ? 'hud-team-toast-out 0.5s ease-in forwards'
                : 'hud-team-toast-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
              marginBottom: 4,
              pointerEvents: 'auto',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px 6px 10px', borderRadius: 8,
              background: `${VISOR_BG}0.92)`,
              border: `1px solid ${CY}25`,
              boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 8px ${CY}10`,
              backdropFilter: 'blur(8px)',
              minHeight: 36,
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 11, color: '#ccc', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                {evt.name}
              </span>
              <span style={{
                fontFamily: 'monospace', fontWeight: 900, fontSize: 13,
                color: evt.isPrepay ? OR : CY,
                textShadow: evt.isPrepay ? `0 0 6px ${OR}50` : `0 0 6px ${CY}50`,
                animation: 'hud-team-points-pop 0.4s ease-out 0.3s both',
                whiteSpace: 'nowrap',
              }}>
                +{evt.points}
              </span>
              {(hasBadges || hasMults) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: `${CY}30`, marginRight: 2 }} />
                  {evt.badges?.map(badgeId => {
                    const icon = getBadgeIcon(badgeId, 16);
                    const color = getBadgeCategoryColor(badgeId);
                    if (!icon) return null;
                    return (
                      <span key={badgeId} title={badgeId.replace(/_/g, ' ')} style={{ display: 'inline-flex', filter: `drop-shadow(0 0 3px ${color}80)`, lineHeight: 1 }}>
                        {icon}
                      </span>
                    );
                  })}
                  {evt.multipliers?.map(multId => {
                    const icon = getMultiplierIcon(multId, 14);
                    const th = MULT_THEME[multId];
                    if (!icon) return null;
                    return (
                      <span key={multId} title={multId.replace(/_/g, ' ')} style={{ display: 'inline-flex', filter: th ? `drop-shadow(0 0 3px ${th.color}80)` : undefined, lineHeight: 1, opacity: 0.8 }}>
                        {icon}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// MENU PANEL
// =============================================================================

function MenuPanel({
  open,
  onClose,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: HUDMenuAction) => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
          onClick={onClose}
        />
      )}
      <div
        className="fixed top-0 right-0 bottom-0 z-50"
        style={{
          width: open ? 230 : 0,
          overflow: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{
          width: 230, height: '100%',
          background: `${VISOR_BG}0.96)`,
          borderLeft: `1px solid ${CY}30`,
          display: 'flex', flexDirection: 'column',
          padding: '20px 0',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{
            padding: '0 16px 14px',
            borderBottom: `1px solid ${CY}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '3px', color: CY, opacity: 0.5 }}>OPERATIONS</span>
            <button
              onClick={onClose}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                border: `1px solid ${CY}30`, background: `${CY}08`,
                color: CY, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {MENU_ITEMS.map((item, i) => (
              <button
                key={item.id}
                onClick={() => { onAction(item.id); onClose(); }}
                className="transition-all duration-150"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 14px', borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit',
                  animation: open ? `hud-menu-slide 0.3s ease-out ${i * 0.05}s both` : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${CY}0a`;
                  e.currentTarget.style.borderColor = `${CY}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: '#d0e8f0' }}>{item.label}</div>
                  <div style={{ fontSize: 8, color: `${CY}60`, fontWeight: 500, marginTop: 2 }}>{item.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <div style={{ padding: '12px 16px 0', borderTop: `1px solid ${CY}10`, textAlign: 'center' }}>
            <span style={{ fontSize: 7, color: `${CY}25`, letterSpacing: '3px', fontWeight: 700 }}>AUTOSNIPER M82</span>
          </div>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// STAT BOX
// =============================================================================

function StatBox({ label, value, color, pulse }: { label: string; value: string | number; color: string; pulse?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: 20, fontWeight: 900, color, lineHeight: 1,
        fontFamily: 'monospace',
        textShadow: `0 0 4px ${color}25`,
        animation: pulse ? 'hud-streak-pulse 2s ease-in-out infinite' : undefined,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 6, color, opacity: 0.3, letterSpacing: '2px', fontWeight: 700, marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN HUD COMPONENT
// =============================================================================

export default function DialerHUD({
  session,
  activeMultipliers,
  multipliersReceivedAt,
  rank,
  onMenuAction,
  onTrophyClick,
  onPointsClick,
  teamFeed,
  autoFire,
  onAutoFireChange,
}: HUDProps) {
  const s = session;
  const [pointsFlash, setPointsFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const prevPoints = useRef(s?.totalSessionPoints ?? 0);

  // Flash points when they change
  useEffect(() => {
    const curr = s?.totalSessionPoints ?? 0;
    if (curr > prevPoints.current) {
      setPointsFlash(true);
      const t = setTimeout(() => setPointsFlash(false), 600);
      prevPoints.current = curr;
      return () => clearTimeout(t);
    }
    prevPoints.current = curr;
  }, [s?.totalSessionPoints]);

  const streak = s?.consecutiveYes ?? 0;
  const points = s?.totalSessionPoints ?? 0;
  const totalMult = activeMultipliers.reduce((sum, m) => m.extra?.modifiesScoring ? sum : sum + m.value, 1.0);

  const handleMenuAction = useCallback((action: HUDMenuAction) => {
    if (action === 'achievements') {
      onTrophyClick();
    }
    onMenuAction?.(action);
  }, [onMenuAction, onTrophyClick]);

  return (
    <>
      <style>{HUD_STYLES}</style>

      <div className="fixed inset-0 pointer-events-none z-10">

        {/* === VISOR ARCS === */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          viewBox="0 0 1000 600" preserveAspectRatio="none"
        >
          <path d="M 80,0 Q 500,-12 920,0" fill="none" stroke={CY} strokeWidth="0.8" opacity="0.15" />
          <path d="M 80,600 Q 500,612 920,600" fill="none" stroke={CY} strokeWidth="0.8" opacity="0.15" />
          <path d="M 0,50 Q -8,300 0,550" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.08" />
          <path d="M 1000,50 Q 1008,300 1000,550" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.08" />
          <path d="M 0,50 L 35,12 L 80,0" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.15" />
          <path d="M 1000,50 L 965,12 L 920,0" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.15" />
          <path d="M 0,550 L 35,588 L 80,600" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.15" />
          <path d="M 1000,550 L 965,588 L 920,600" fill="none" stroke={CY} strokeWidth="0.6" opacity="0.15" />
        </svg>

        {/* === VIGNETTE === */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 78% 72% at 50% 50%, transparent 55%, rgba(0,6,12,0.25) 80%, rgba(0,3,8,0.6) 100%)',
        }} />

        {/* === TOP BAR === */}
        <div
          className="absolute top-0 left-0 right-0 pointer-events-auto"
          style={{
            padding: '8px 14px',
          }}
        >
          {/* Single row: Auto-fire | Multiplier tiles (centered) | Total + menu */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Left: Auto-fire toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '2px 10px', borderRadius: 16,
                  border: `1px solid ${autoFire ? '#ff4444' : CY}40`,
                  background: autoFire ? 'rgba(255,40,40,0.12)' : `${CY}08`,
                  cursor: 'pointer',
                  transition: 'all 0.25s ease',
                }}
              >
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '2px', fontFamily: 'monospace',
                  color: autoFire ? '#ff6666' : CY,
                  opacity: autoFire ? 1 : 0.5,
                }}>
                  AUTO-FIRE
                </span>
                <div style={{
                  position: 'relative', width: 28, height: 14, borderRadius: 7,
                  background: autoFire ? '#cc2222' : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.25s ease',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, width: 10, height: 10, borderRadius: '50%',
                    background: autoFire ? '#fff' : '#666',
                    left: autoFire ? 16 : 2,
                    transition: 'left 0.2s ease, background 0.2s ease',
                    boxShadow: autoFire ? '0 0 6px rgba(255,40,40,0.6)' : 'none',
                  }} />
                </div>
                <input
                  type="checkbox"
                  checked={autoFire ?? false}
                  onChange={(e) => onAutoFireChange?.(e.target.checked)}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {/* Center: Multiplier tiles */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0, overflow: 'visible' }}>
              <MultiplierStrip multipliers={activeMultipliers} receivedAt={multipliersReceivedAt} />
            </div>

            {/* Right: Total mult + menu */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {activeMultipliers.length > 0 && (
                <div style={{ padding: '3px 10px', borderRadius: 12, background: `${OR}10`, border: `1px solid ${OR}25` }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: OR, letterSpacing: '1px', fontFamily: 'monospace' }}>
                    TOTAL {totalMult.toFixed(1)}×
                  </span>
                </div>
              )}
              <button
                onClick={() => setMenuOpen(true)}
                style={{
                  width: 30, height: 30, borderRadius: '50%',
                  border: `1.5px solid ${CY}40`, background: `${CY}08`,
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 3, padding: 0,
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
              >
                <div style={{ width: 11, height: 1.5, background: CY, borderRadius: 1, opacity: 0.8 }} />
                <div style={{ width: 7, height: 1.5, background: CY, borderRadius: 1, opacity: 0.5 }} />
                <div style={{ width: 11, height: 1.5, background: CY, borderRadius: 1, opacity: 0.8 }} />
              </button>
            </div>
          </div>
        </div>

        {/* === TEAM FEED TOASTS === */}
        {teamFeed && teamFeed.length > 0 && (
          <TeamFeedToasts events={teamFeed} />
        )}

        {/* === BOTTOM BAR === */}
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-auto"
          style={{
            background: `linear-gradient(to top, ${VISOR_BG}0.94) 0%, ${VISOR_BG}0.65) 85%, transparent 100%)`,
            display: 'flex',
            alignItems: 'flex-end',
            padding: '16px 16px 10px',
          }}
        >
          {/* Stats */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
            <StatBox label="PB" value={s?.pbs ?? 0} color={CY} />
            <StatBox label="PP" value={s?.pps ?? 0} color={OR} />
            <StatBox label="PP$" value={`$${s?.ppDollars ?? 0}`} color="#ff6b35" />
            <StatBox label="TOTAL" value={s?.totalBookings ?? 0} color="#d0e8f0" />
            <StatBox label="STREAK" value={streak} color={OR} pulse={streak > 0} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Points */}
          <div
            style={{ textAlign: 'right', cursor: onPointsClick ? 'pointer' : 'default' }}
            onClick={onPointsClick}
          >
            <div style={{
              fontSize: 38, fontWeight: 900, color: CY, lineHeight: 1,
              fontFamily: 'monospace',
              letterSpacing: '2px',
              textShadow: pointsFlash
                ? `0 0 20px ${CY}, 0 0 50px ${CY}80, 0 0 80px ${CY}40`
                : `0 0 8px ${CY}50`,
              animation: pointsFlash ? 'hud-pts-burst 0.5s ease-out' : undefined,
              transition: 'text-shadow 0.3s ease',
            }}>
              {points.toLocaleString()}
            </div>
            {/* Energy bar */}
            <div style={{
              width: 140, height: 4, borderRadius: 2, marginTop: 5, marginLeft: 'auto',
              background: `${CY}12`, border: `1px solid ${CY}15`, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.min((points / 5000) * 100, 100)}%`,
                background: `linear-gradient(to right, ${CY2}, ${CY})`,
                boxShadow: `0 0 6px ${CY}40`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: 6, color: CY, opacity: 0.3, letterSpacing: '3px', fontWeight: 700, marginTop: 3 }}>
              SESSION POINTS
            </div>
          </div>
        </div>
      </div>

      {/* === MENU === */}
      <MenuPanel open={menuOpen} onClose={() => setMenuOpen(false)} onAction={handleMenuAction} />
    </>
  );
}