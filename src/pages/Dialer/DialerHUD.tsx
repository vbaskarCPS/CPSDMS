// src/pages/Dialer/DialerHUD.tsx
//
// Military sniper HUD frame for the AutoSniper dialer.
// Multiplier pills in top strip with tap-toggle tooltips.
// Cleaned bottom bar with stats, points flash, and rank badge.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GamificationSession, MultiplierSnapshot, Rank } from '../../lib/dialer/gamificationDefs';
import { getMultiplierIcon, getMultiplierTierIcon, getBadgeIcon, getBadgeCategoryColor, getMultiplierIconUrl, getBadgeIconUrl } from './BadgeIcons';

// --- Props ---

/** A booking event from another manager on the team */
export interface TeamBookingEvent {
  id: string;                     // unique event id
  name: string;                   // manager's first name
  points: number;                 // points earned on this booking
  badges?: string[];              // badge IDs earned (e.g. ['double_kill','first_blood'])
  multipliers?: string[];         // multiplier IDs active (e.g. ['op_tempo','blitz'])
  timestamp: number;              // Date.now() when received
  isPrepay?: boolean;             // was it a prepay?
}

interface HUDProps {
  session: GamificationSession | null;
  activeMultipliers: MultiplierSnapshot[];
  multipliersReceivedAt: number;
  rank: Rank | null;
  onTrophyClick: () => void;
  onPointsClick?: () => void;
  teamFeed?: TeamBookingEvent[];  // live feed of other managers' bookings
}

// --- Multiplier descriptions ---

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
};

// --- Multiplier pill theme ---

const PILL_THEME: Record<string, { color: string; glow: string }> = {
  op_tempo:       { color: '#f1c40f', glow: 'rgba(241,196,15,0.4)' },
  tracer_rounds:  { color: '#e74c3c', glow: 'rgba(231,76,60,0.4)' },
  high_ground:    { color: '#00BCD4', glow: 'rgba(0,188,212,0.4)' },
  night_vision:   { color: '#9b59b6', glow: 'rgba(155,89,182,0.4)' },
  blitz:          { color: '#e67e22', glow: 'rgba(230,126,34,0.4)' },
  enraged:        { color: '#ff0040', glow: 'rgba(255,0,64,0.5)' },
  ratio_focus:    { color: '#3498db', glow: 'rgba(52,152,219,0.4)' },
  war_machine:    { color: '#95a5a6', glow: 'rgba(149,165,166,0.4)' },
  ghost_town:     { color: '#bdc3c7', glow: 'rgba(189,195,199,0.4)' },
  cold_streak:    { color: '#85c1e9', glow: 'rgba(133,193,233,0.4)' },
  scorched_earth: { color: '#ff5722', glow: 'rgba(255,87,34,0.5)' },
};

// --- HUD Keyframes ---

const HUD_STYLES = `
  @keyframes hud-enraged-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(255,0,64,0.15), inset 0 0 12px rgba(255,0,64,0.05); }
    50% { box-shadow: 0 0 18px rgba(255,0,64,0.5), inset 0 0 16px rgba(255,0,64,0.12); }
  }
  @keyframes hud-scorched-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(255,87,34,0.15), inset 0 0 12px rgba(255,87,34,0.05); }
    50% { box-shadow: 0 0 16px rgba(255,87,34,0.45), inset 0 0 16px rgba(255,87,34,0.1); }
  }
  @keyframes hud-tile-enter {
    0% { transform: scale(0) rotateY(90deg); opacity: 0; }
    50% { transform: scale(1.1) rotateY(-5deg); }
    100% { transform: scale(1) rotateY(0deg); opacity: 1; }
  }
  @keyframes hud-tile-breathe {
    0%, 100% { box-shadow: var(--tile-shadow-rest); }
    50% { box-shadow: var(--tile-shadow-breathe); }
  }
  @keyframes hud-points-flash {
    0% { text-shadow: 0 0 12px rgba(46,204,113,0.5), 0 0 28px rgba(46,204,113,0.2); }
    50% { text-shadow: 0 0 20px rgba(46,204,113,0.9), 0 0 40px rgba(46,204,113,0.5), 0 0 60px rgba(46,204,113,0.3); }
    100% { text-shadow: 0 0 12px rgba(46,204,113,0.5), 0 0 28px rgba(46,204,113,0.2); }
  }
  @keyframes hud-streak-glow {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  @keyframes hud-tooltip-in {
    0% { opacity: 0; transform: translateY(6px) scale(0.95); pointer-events: none; }
    100% { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  }
  @keyframes hud-timer-sweep {
    from { stroke-dashoffset: 0; }
    to { stroke-dashoffset: 157; }
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

// --- Helpers ---

function formatCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

/**
 * Render multiplier icon: try game-icons.net icon first, fall back to emoji.
 */
function MultiplierIconDisplay({ multiplier, size = 14 }: { multiplier: MultiplierSnapshot; size?: number }) {
  // For tiered multipliers, try tier-specific icon
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
  // Fallback to emoji
  return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{multiplier.icon}</span>;
}

// =============================================================================
// MULTIPLIER STRIP (top of screen, below top bar) — Big icon tiles
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

  const TILE = 52;            // tile size px
  const ICON_SIZE = 30;       // icon inside tile

  return (
    <div
      className="absolute left-0 right-0 flex items-start justify-center gap-2.5 px-4 pointer-events-auto"
      style={{ top: 36, zIndex: 15 }}
    >
      {multipliers.map((m, idx) => {
        const remainingMs = m.expiresIn > 0 ? m.expiresIn - elapsed : m.expiresIn;
        if (m.expiresIn > 0 && remainingMs <= 0) return null;

        const countdown = formatCountdown(remainingMs);
        const theme = PILL_THEME[m.id] || { color: '#2ecc71', glow: 'rgba(46,204,113,0.4)' };
        const charges = (m.extra as any)?.charges;
        const isEnraged = m.id === 'enraged';
        const isScorched = m.id === 'scorched_earth';
        const isHovered = hoveredId === m.id;

        // Timer progress 0→1 (1 = full, 0 = expired)
        let timerProgress = 1;
        if (m.expiresIn > 0 && remainingMs > 0) {
          timerProgress = Math.max(0, remainingMs / m.expiresIn);
        }
        const circumference = 2 * Math.PI * 23; // ring radius=23

        const shadowRest = `0 2px 8px rgba(0,0,0,0.6), 0 0 6px ${theme.color}20, inset 0 1px 0 rgba(255,255,255,0.04)`;
        const shadowBreathe = `0 2px 12px rgba(0,0,0,0.6), 0 0 14px ${theme.color}40, inset 0 1px 0 rgba(255,255,255,0.06)`;

        return (
          <div
            key={m.id}
            className="relative"
            onMouseEnter={() => setHoveredId(m.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* === TILE === */}
            <div
              style={{
                width: TILE,
                height: TILE,
                borderRadius: 10,
                background: `linear-gradient(145deg, ${theme.color}18 0%, rgba(10,18,10,0.95) 60%)`,
                border: `1.5px solid ${theme.color}50`,
                position: 'relative',
                overflow: 'hidden',
                cursor: 'default',
                transition: 'transform 0.2s ease, border-color 0.2s ease',
                transform: isHovered ? 'scale(1.12) translateY(-2px)' : 'scale(1)',
                ['--tile-shadow-rest' as any]: shadowRest,
                ['--tile-shadow-breathe' as any]: shadowBreathe,
                animation: isEnraged
                  ? 'hud-enraged-pulse 1.2s ease-in-out infinite'
                  : isScorched
                    ? 'hud-scorched-pulse 2s ease-in-out infinite'
                    : `hud-tile-enter 0.45s cubic-bezier(0.34,1.56,0.64,1) ${idx * 0.07}s both, hud-tile-breathe 4s ease-in-out ${idx * 0.5}s infinite`,
                boxShadow: isHovered
                  ? `0 4px 20px rgba(0,0,0,0.7), 0 0 20px ${theme.color}50, inset 0 1px 0 rgba(255,255,255,0.08)`
                  : shadowRest,
                borderColor: isHovered ? `${theme.color}90` : `${theme.color}50`,
              }}
            >
              {/* Colored vignette behind icon */}
              <div style={{
                position: 'absolute',
                inset: 0,
                background: `radial-gradient(circle at 50% 40%, ${theme.color}15 0%, transparent 70%)`,
                pointerEvents: 'none',
              }} />

              {/* Icon — centered, large */}
              <div style={{
                position: 'absolute',
                top: 5,
                left: '50%',
                transform: 'translateX(-50%)',
                width: ICON_SIZE,
                height: ICON_SIZE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.7,
                filter: `drop-shadow(0 0 4px ${theme.color}60)`,
              }}>
                <MultiplierIconDisplay multiplier={m} size={ICON_SIZE} />
              </div>

              {/* Embossed multiplier value — overlaid at bottom */}
              <div style={{
                position: 'absolute',
                bottom: 2,
                left: 0,
                right: 0,
                textAlign: 'center',
                fontFamily: 'monospace',
                fontWeight: 900,
                fontSize: 15,
                lineHeight: 1,
                letterSpacing: '-0.5px',
                color: '#fff',
                textShadow: `0 0 6px ${theme.color}, 0 1px 2px rgba(0,0,0,0.8), 0 0 16px ${theme.color}60`,
                pointerEvents: 'none',
              }}>
                +{m.value}x
              </div>

              {/* Timer ring (for timed multipliers) */}
              {m.expiresIn > 0 && timerProgress > 0 && timerProgress < 1 && (
                <svg
                  style={{ position: 'absolute', inset: -1, width: TILE + 2, height: TILE + 2, pointerEvents: 'none' }}
                  viewBox={`0 0 ${TILE + 2} ${TILE + 2}`}
                >
                  <rect
                    x="1" y="1" width={TILE} height={TILE} rx="10" ry="10"
                    fill="none"
                    stroke={theme.color}
                    strokeWidth="2"
                    strokeDasharray={`${(TILE * 4) * timerProgress} ${(TILE * 4)}`}
                    opacity="0.5"
                  />
                </svg>
              )}

              {/* Charges badge */}
              {charges && charges > 0 && (
                <div style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: theme.color,
                  color: '#000',
                  fontSize: 9,
                  fontWeight: 900,
                  fontFamily: 'monospace',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 1px 4px rgba(0,0,0,0.5), 0 0 6px ${theme.color}60`,
                  border: '1.5px solid rgba(0,0,0,0.3)',
                  lineHeight: 1,
                }}>
                  {charges}
                </div>
              )}

              {/* Countdown text (small, below value if timed) */}
              {countdown && (
                <div style={{
                  position: 'absolute',
                  top: 1,
                  right: 3,
                  fontSize: 7,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: theme.color,
                  opacity: 0.7,
                  letterSpacing: '0.5px',
                  lineHeight: 1,
                }}>
                  {countdown}
                </div>
              )}
            </div>

            {/* === HOVER TOOLTIP === */}
            {isHovered && (
              <div
                className="absolute z-30"
                style={{
                  top: TILE + 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  minWidth: 200,
                  maxWidth: 240,
                  animation: 'hud-tooltip-in 0.2s ease-out both',
                }}
              >
                {/* Arrow */}
                <div style={{
                  position: 'absolute',
                  top: -5,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '7px solid transparent',
                  borderRight: '7px solid transparent',
                  borderBottom: `7px solid ${theme.color}40`,
                }} />

                <div style={{
                  background: 'rgba(6,12,6,0.97)',
                  border: `1px solid ${theme.color}40`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  boxShadow: `0 12px 36px rgba(0,0,0,0.8), 0 0 20px ${theme.glow}`,
                  backdropFilter: 'blur(12px)',
                }}>
                  {/* Header: icon + name + value */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: `${theme.color}15`,
                      border: `1px solid ${theme.color}30`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <MultiplierIconDisplay multiplier={m} size={22} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'monospace',
                        fontWeight: 900,
                        fontSize: 11,
                        color: theme.color,
                        letterSpacing: '1.5px',
                        textTransform: 'uppercase' as const,
                        lineHeight: 1.2,
                      }}>
                        {m.name}
                      </div>
                      <div style={{
                        fontFamily: 'monospace',
                        fontWeight: 900,
                        fontSize: 20,
                        color: '#fff',
                        textShadow: `0 0 12px ${theme.color}80`,
                        lineHeight: 1.1,
                        marginTop: 1,
                      }}>
                        +{m.value}x
                      </div>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div style={{
                    display: 'flex',
                    gap: 6,
                    marginBottom: 8,
                    flexWrap: 'wrap' as const,
                  }}>
                    {charges && (
                      <span style={{
                        fontSize: 8,
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: theme.color,
                        background: `${theme.color}12`,
                        border: `1px solid ${theme.color}30`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        letterSpacing: '0.5px',
                      }}>
                        {charges} CHARGES
                      </span>
                    )}
                    {countdown && (
                      <span style={{
                        fontSize: 8,
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: theme.color,
                        background: `${theme.color}12`,
                        border: `1px solid ${theme.color}30`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        letterSpacing: '0.5px',
                      }}>
                        {countdown}
                      </span>
                    )}
                    {!charges && !countdown && (
                      <span style={{
                        fontSize: 8,
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: '#2ecc71',
                        background: 'rgba(46,204,113,0.08)',
                        border: '1px solid rgba(46,204,113,0.2)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        letterSpacing: '1px',
                      }}>
                        PASSIVE
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <div style={{
                    fontSize: 10,
                    color: '#888',
                    lineHeight: 1.5,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    paddingTop: 8,
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
// TEAM FEED TOASTS (above bottom bar — other managers' bookings)
// =============================================================================

const TOAST_LIFETIME = 6000;   // ms before auto-dismiss
const MAX_VISIBLE = 4;         // max toasts shown at once

function TeamFeedToasts({ events }: { events: TeamBookingEvent[] }) {
  const [visibleToasts, setVisibleToasts] = useState<(TeamBookingEvent & { exiting?: boolean })[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Ingest new events
  useEffect(() => {
    const newOnes = events.filter(e => !seenRef.current.has(e.id));
    if (newOnes.length === 0) return;

    newOnes.forEach(e => seenRef.current.add(e.id));

    setVisibleToasts(prev => {
      const combined = [...prev.filter(t => !t.exiting), ...newOnes];
      // Keep only the most recent MAX_VISIBLE+2 to allow exit animations
      return combined.slice(-MAX_VISIBLE - 2);
    });

    // Set dismiss timers for new events
    newOnes.forEach(e => {
      const timer = setTimeout(() => {
        // Mark as exiting
        setVisibleToasts(prev =>
          prev.map(t => t.id === e.id ? { ...t, exiting: true } : t)
        );
        // Remove after exit animation
        const removeTimer = setTimeout(() => {
          setVisibleToasts(prev => prev.filter(t => t.id !== e.id));
          timersRef.current.delete(e.id);
        }, 500);
        timersRef.current.set(e.id + '_rm', removeTimer);
      }, TOAST_LIFETIME);
      timersRef.current.set(e.id, timer);
    });
  }, [events]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  const visible = visibleToasts.slice(-MAX_VISIBLE);
  if (visible.length === 0) return null;

  return (
    <div
      className="absolute right-2 pointer-events-none"
      style={{
        bottom: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 0,
        zIndex: 18,
        maxWidth: 320,
      }}
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px 6px 10px',
                borderRadius: 8,
                background: 'rgba(6,12,6,0.92)',
                border: '1px solid rgba(46,204,113,0.25)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 8px rgba(46,204,113,0.1)',
                backdropFilter: 'blur(8px)',
                minHeight: 36,
              }}
            >
              {/* Name */}
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  fontSize: 11,
                  color: '#ccc',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {evt.name}
              </span>

              {/* Points */}
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 900,
                  fontSize: 13,
                  color: evt.isPrepay ? '#f1c40f' : '#2ecc71',
                  textShadow: evt.isPrepay
                    ? '0 0 6px rgba(241,196,15,0.5)'
                    : '0 0 6px rgba(46,204,113,0.5)',
                  animation: 'hud-team-points-pop 0.4s ease-out 0.3s both',
                  whiteSpace: 'nowrap',
                }}
              >
                +{evt.points}
              </span>

              {/* Badge + Multiplier icons */}
              {(hasBadges || hasMults) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  {/* Separator dot */}
                  <span style={{
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: 'rgba(46,204,113,0.3)',
                    marginRight: 2,
                  }} />

                  {/* Badge icons */}
                  {evt.badges?.map(badgeId => {
                    const icon = getBadgeIcon(badgeId, 16);
                    const color = getBadgeCategoryColor(badgeId);
                    if (!icon) return null;
                    return (
                      <span
                        key={badgeId}
                        title={badgeId.replace(/_/g, ' ')}
                        style={{
                          display: 'inline-flex',
                          filter: `drop-shadow(0 0 3px ${color}80)`,
                          lineHeight: 1,
                        }}
                      >
                        {icon}
                      </span>
                    );
                  })}

                  {/* Multiplier icons */}
                  {evt.multipliers?.map(multId => {
                    const icon = getMultiplierIcon(multId, 14);
                    const theme = PILL_THEME[multId];
                    if (!icon) return null;
                    return (
                      <span
                        key={multId}
                        title={multId.replace(/_/g, ' ')}
                        style={{
                          display: 'inline-flex',
                          filter: theme ? `drop-shadow(0 0 3px ${theme.color}80)` : undefined,
                          lineHeight: 1,
                          opacity: 0.8,
                        }}
                      >
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
// MAIN HUD COMPONENT
// =============================================================================

export default function DialerHUD({
  session,
  activeMultipliers,
  multipliersReceivedAt,
  rank,
  onTrophyClick,
  onPointsClick,
  teamFeed,
}: HUDProps) {
  const s = session;
  const [pointsFlash, setPointsFlash] = useState(false);
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

  // Streak glow intensity
  const streak = s?.consecutiveYes ?? 0;
  const streakIntensity = Math.min(streak / 10, 1);

  return (
    <>
      <style>{HUD_STYLES}</style>

      <div className="fixed inset-0 pointer-events-none z-10">
        {/* === TOP BAR === */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 font-mono pointer-events-auto"
          style={{
            height: 30,
            background: 'rgba(10,18,10,0.95)',
            borderBottom: '1.5px solid rgba(46,204,113,0.5)',
            boxShadow: '0 2px 16px rgba(46,204,113,0.12)',
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="font-bold"
              style={{
                border: '1.5px solid rgba(46,204,113,0.6)',
                borderRadius: 3,
                padding: '1px 6px',
                background: 'rgba(46,204,113,0.06)',
                fontSize: 10,
                color: '#2ecc71',
              }}
            >
              M82
            </span>
            <span style={{ fontSize: 9, color: '#2ecc71', opacity: 0.7, fontWeight: 'bold' }}>
              Barrett M82A1
            </span>
            <span style={{ fontSize: 7, color: '#2ecc71', opacity: 0.35 }}>12.7×99mm</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="cursor-pointer transition-all duration-200 hover:scale-110"
              onClick={onTrophyClick}
              style={{
                border: '1px solid rgba(241,196,15,0.4)',
                borderRadius: 20,
                padding: '2px 10px',
                background: 'rgba(241,196,15,0.06)',
                fontSize: 12,
              }}
              title="Achievements"
            >
              🏆
            </span>
          </div>
        </div>

        {/* === MULTIPLIER STRIP (below top bar) === */}
        <MultiplierStrip multipliers={activeMultipliers} receivedAt={multipliersReceivedAt} />

        {/* === TEAM FEED TOASTS (above bottom bar) === */}
        {teamFeed && teamFeed.length > 0 && (
          <TeamFeedToasts events={teamFeed} />
        )}

        {/* === BOTTOM BAR === */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center px-3 font-mono"
          style={{
            height: 48,
            background: 'rgba(10,18,10,0.95)',
            borderTop: '1.5px solid rgba(46,204,113,0.5)',
            boxShadow: '0 -2px 16px rgba(46,204,113,0.12)',
          }}
        >
          {/* Session stats */}
          <div className="flex items-center gap-4">
            <StatBox label="PB" value={s?.pbs ?? 0} color="#2ecc71" />
            <StatBox label="PP" value={s?.pps ?? 0} color="#f1c40f" />
            <StatBox label="PP$" value={`$${s?.ppDollars ?? 0}`} color="#e67e22" />
            <StatBox label="TOTAL" value={s?.totalBookings ?? 0} color="#fff" />
            <StatBox
              label="STREAK"
              value={s?.consecutiveYes ?? 0}
              color="#e74c3c"
              glow={streakIntensity > 0 ? `0 0 ${8 + streakIntensity * 16}px rgba(231,76,60,${0.3 + streakIntensity * 0.5})` : undefined}
              pulse={streakIntensity > 0.5}
            />
          </div>

          {/* Points display */}
          <div
            className="flex flex-col items-end ml-auto px-2 pointer-events-auto"
            style={{ cursor: onPointsClick ? 'pointer' : 'default' }}
            onClick={onPointsClick}
          >
            <span
              className="font-black font-mono tracking-wider"
              style={{
                fontSize: 28,
                lineHeight: 1,
                color: '#2ecc71',
                textShadow: '0 0 12px rgba(46,204,113,0.5), 0 0 28px rgba(46,204,113,0.2)',
                animation: pointsFlash ? 'hud-points-flash 0.6s ease-out' : undefined,
                transition: 'all 0.2s ease',
              }}
            >
              {s?.totalSessionPoints ?? 0}
            </span>
            <span
              style={{
                fontSize: 7,
                color: '#2ecc71',
                fontWeight: 800,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                opacity: 0.4,
                marginTop: 1,
              }}
            >
              Points
            </span>
          </div>

          {/* Rank badge */}
          {rank && (
            <div
              className="flex flex-col items-center ml-2"
              style={{
                border: '1.5px solid rgba(241,196,15,0.35)',
                borderRadius: 8,
                padding: '4px 10px',
                background: 'rgba(241,196,15,0.04)',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{rank.icon}</span>
              <span
                style={{
                  fontSize: 7,
                  color: '#f1c40f',
                  fontWeight: 800,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginTop: 1,
                }}
              >
                {rank.label}
              </span>
            </div>
          )}
        </div>

        {/* === SIDE BORDERS === */}
        <div
          className="absolute left-0"
          style={{
            top: 96,
            bottom: 50,
            width: 4,
            background: 'linear-gradient(to right, rgba(10,18,10,0.6), transparent)',
            borderRight: '1px solid rgba(46,204,113,0.25)',
          }}
        />
        <div
          className="absolute right-0"
          style={{
            top: 96,
            bottom: 50,
            width: 4,
            background: 'linear-gradient(to left, rgba(10,18,10,0.6), transparent)',
            borderLeft: '1px solid rgba(46,204,113,0.25)',
          }}
        />

        {/* === CORNERS === */}
        <svg className="absolute" style={{ top: 94, left: 0 }} width="14" height="14">
          <path d="M0,14 L0,0 L14,0" fill="none" stroke="#2ecc71" strokeWidth="2" opacity="0.5" />
        </svg>
        <svg className="absolute" style={{ top: 94, right: 0 }} width="14" height="14">
          <path d="M14,14 L14,0 L0,0" fill="none" stroke="#2ecc71" strokeWidth="2" opacity="0.5" />
        </svg>
        <svg className="absolute" style={{ bottom: 48, left: 0 }} width="14" height="14">
          <path d="M0,0 L0,14 L14,14" fill="none" stroke="#2ecc71" strokeWidth="2" opacity="0.5" />
        </svg>
        <svg className="absolute" style={{ bottom: 48, right: 0 }} width="14" height="14">
          <path d="M14,0 L14,14 L0,14" fill="none" stroke="#2ecc71" strokeWidth="2" opacity="0.5" />
        </svg>

        {/* === SIDE TICKS (minimal) === */}
        {[35, 50, 65].map(pct => (
          <div key={`tl-${pct}`}>
            <div
              className="absolute left-0"
              style={{
                top: `${pct}%`,
                width: pct === 50 ? 10 : 6,
                height: 1,
                background: pct === 50 ? 'rgba(46,204,113,0.35)' : 'rgba(46,204,113,0.2)',
              }}
            />
            <div
              className="absolute right-0"
              style={{
                top: `${pct}%`,
                width: pct === 50 ? 10 : 6,
                height: 1,
                background: pct === 50 ? 'rgba(46,204,113,0.35)' : 'rgba(46,204,113,0.2)',
              }}
            />
          </div>
        ))}

        {/* === RETICLE (subtle) === */}
        <svg
          className="absolute pointer-events-none"
          style={{ top: '50%', left: '42%', transform: 'translate(-50%,-50%)', opacity: 0.08 }}
          width="140" height="140" viewBox="0 0 140 140"
        >
          <circle cx="70" cy="70" r="48" fill="none" stroke="#2ecc71" strokeWidth="0.8" />
          <circle cx="70" cy="70" r="28" fill="none" stroke="#2ecc71" strokeWidth="0.6" />
          <circle cx="70" cy="70" r="10" fill="none" stroke="#2ecc71" strokeWidth="0.4" />
          <circle cx="70" cy="70" r="2" fill="#2ecc71" />
          <line x1="70" y1="8" x2="70" y2="58" stroke="#2ecc71" strokeWidth="0.6" />
          <line x1="70" y1="82" x2="70" y2="132" stroke="#2ecc71" strokeWidth="0.6" />
          <line x1="8" y1="70" x2="58" y2="70" stroke="#2ecc71" strokeWidth="0.6" />
          <line x1="82" y1="70" x2="132" y2="70" stroke="#2ecc71" strokeWidth="0.6" />
        </svg>
      </div>
    </>
  );
}

// --- Stat Box ---

function StatBox({
  label,
  value,
  color,
  glow,
  pulse,
}: {
  label: string;
  value: string | number;
  color: string;
  glow?: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className="font-black tracking-wider"
        style={{
          fontSize: 17,
          color,
          lineHeight: 1,
          letterSpacing: '0.5px',
          textShadow: glow || 'none',
          animation: pulse ? 'hud-streak-glow 1s ease-in-out infinite' : undefined,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 7,
          color: '#2ecc71',
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          opacity: 0.45,
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}