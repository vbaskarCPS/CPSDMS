// src/pages/Dialer/DialerHUD.tsx
//
// Military sniper HUD frame for the AutoSniper dialer.
// Multiplier pills in top strip with tap-toggle tooltips.
// Cleaned bottom bar with stats, points flash, and rank badge.
//

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GamificationSession, MultiplierSnapshot, Rank } from '../../lib/dialer/gamificationDefs';
import { getMultiplierIcon, getMultiplierTierIcon } from './BadgeIcons';

// --- Props ---

interface HUDProps {
  session: GamificationSession | null;
  activeMultipliers: MultiplierSnapshot[];
  multipliersReceivedAt: number;
  rank: Rank | null;
  onTrophyClick: () => void;
  onPointsClick?: () => void;
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
    0%, 100% { box-shadow: 0 0 4px rgba(255,0,64,0.2); }
    50% { box-shadow: 0 0 12px rgba(255,0,64,0.6); }
  }
  @keyframes hud-scorched-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(255,87,34,0.2); }
    50% { box-shadow: 0 0 10px rgba(255,87,34,0.5); }
  }
  @keyframes hud-pill-enter {
    0% { transform: scale(0); opacity: 0; }
    60% { transform: scale(1.2); }
    100% { transform: scale(1); opacity: 1; }
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
    0% { opacity: 0; transform: translateY(-4px); }
    100% { opacity: 1; transform: translateY(0); }
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
// MULTIPLIER STRIP (top of screen, below top bar)
// =============================================================================

function MultiplierStrip({
  multipliers,
  receivedAt,
}: {
  multipliers: MultiplierSnapshot[];
  receivedAt: number;
}) {
  const [, setTick] = useState(0);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const hasTimed = multipliers.some(m => m.expiresIn > 0);
    if (hasTimed) {
      timerRef.current = setInterval(() => setTick(t => t + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [multipliers]);

  // Close tooltip on outside click
  useEffect(() => {
    if (!openTooltip) return;
    const handler = () => setOpenTooltip(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 10);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [openTooltip]);

  if (multipliers.length === 0) return null;

  const now = Date.now();
  const elapsed = now - receivedAt;

  return (
    <div
      className="absolute left-0 right-0 flex items-center justify-center gap-1.5 px-3 pointer-events-auto"
      style={{ top: 32, height: 28, zIndex: 15 }}
    >
      {multipliers.map((m, idx) => {
        const remainingMs = m.expiresIn > 0 ? m.expiresIn - elapsed : m.expiresIn;
        if (m.expiresIn > 0 && remainingMs <= 0) return null;

        const countdown = formatCountdown(remainingMs);
        const theme = PILL_THEME[m.id] || { color: '#2ecc71', glow: 'rgba(46,204,113,0.4)' };
        const charges = (m.extra as any)?.charges;
        const isEnraged = m.id === 'enraged';
        const isScorched = m.id === 'scorched_earth';
        const isOpen = openTooltip === m.id;

        // Countdown progress (0 to 1)
        let progress = 1;
        if (m.expiresIn > 0 && countdown) {
          progress = Math.max(0, remainingMs / m.expiresIn);
        }

        return (
          <div key={m.id} className="relative">
            {/* Pill */}
            <div
              className="flex items-center gap-1 cursor-pointer transition-all duration-150"
              onClick={(e) => { e.stopPropagation(); setOpenTooltip(isOpen ? null : m.id); }}
              style={{
                padding: '3px 8px',
                borderRadius: 20,
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                letterSpacing: '0.5px',
                border: `1px solid ${theme.color}60`,
                background: `${theme.color}10`,
                color: theme.color,
                boxShadow: `0 0 8px ${theme.glow}`,
                animation: isEnraged
                  ? 'hud-enraged-pulse 1.2s ease-in-out infinite'
                  : isScorched
                    ? 'hud-scorched-pulse 2s ease-in-out infinite'
                    : `hud-pill-enter 0.4s ease-out ${idx * 0.05}s both`,
              }}
            >
              <MultiplierIconDisplay multiplier={m} size={14} />
              <span style={{ fontSize: 10, fontWeight: 900 }}>+{m.value}x</span>
              {countdown && (
                <span style={{ fontSize: 8, opacity: 0.6, fontWeight: 600 }}>{countdown}</span>
              )}
              {charges && (
                <span style={{ fontSize: 8, fontWeight: 700, color: '#f1c40f' }}>×{charges}</span>
              )}

              {/* Countdown arc */}
              {m.expiresIn > 0 && progress < 1 && progress > 0 && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  style={{ width: '100%', height: '100%', overflow: 'visible' }}
                >
                  <rect
                    x="0" y="0"
                    width="100%" height="100%"
                    rx="20" ry="20"
                    fill="none"
                    stroke={theme.color}
                    strokeWidth="1.5"
                    strokeDasharray={`${progress * 100} ${(1 - progress) * 100}`}
                    strokeDashoffset="0"
                    opacity="0.4"
                  />
                </svg>
              )}
            </div>

            {/* Tooltip (tap to toggle) */}
            {isOpen && (
              <div
                className="absolute left-1/2 -translate-x-1/2 z-30"
                style={{
                  top: 'calc(100% + 8px)',
                  minWidth: 180,
                  maxWidth: 220,
                  animation: 'hud-tooltip-in 0.2s ease-out',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    background: 'rgba(8,16,8,0.96)',
                    border: `1px solid ${theme.color}50`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    boxShadow: `0 8px 24px rgba(0,0,0,0.6), 0 0 12px ${theme.glow}`,
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  {/* Arrow */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2"
                    style={{
                      top: -5,
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderBottom: `6px solid ${theme.color}50`,
                    }}
                  />

                  {/* Icon + Name */}
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <MultiplierIconDisplay multiplier={m} size={20} />
                    <span
                      className="font-mono font-black tracking-widest uppercase"
                      style={{ fontSize: 10, color: theme.color }}
                    >
                      {m.name}
                    </span>
                  </div>

                  {/* Value */}
                  <div
                    className="font-mono font-black text-center"
                    style={{
                      fontSize: 18,
                      color: '#fff',
                      textShadow: `0 0 8px ${theme.glow}`,
                      lineHeight: 1.2,
                    }}
                  >
                    +{m.value}x
                  </div>

                  {/* Status line */}
                  <div
                    className="font-mono text-center"
                    style={{ fontSize: 9, color: theme.color, opacity: 0.8, marginTop: 3 }}
                  >
                    {charges ? `${charges} charges remaining` : countdown ? `${countdown} remaining` : 'ALWAYS ACTIVE'}
                  </div>

                  {/* Description */}
                  <div
                    className="text-center"
                    style={{
                      fontSize: 9,
                      color: '#666',
                      marginTop: 6,
                      lineHeight: 1.4,
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      paddingTop: 6,
                    }}
                  >
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
// MAIN HUD COMPONENT
// =============================================================================

export default function DialerHUD({
  session,
  activeMultipliers,
  multipliersReceivedAt,
  rank,
  onTrophyClick,
  onPointsClick,
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
            top: 32,
            bottom: 50,
            width: 4,
            background: 'linear-gradient(to right, rgba(10,18,10,0.6), transparent)',
            borderRight: '1px solid rgba(46,204,113,0.25)',
          }}
        />
        <div
          className="absolute right-0"
          style={{
            top: 32,
            bottom: 50,
            width: 4,
            background: 'linear-gradient(to left, rgba(10,18,10,0.6), transparent)',
            borderLeft: '1px solid rgba(46,204,113,0.25)',
          }}
        />

        {/* === CORNERS === */}
        <svg className="absolute" style={{ top: 30, left: 0 }} width="14" height="14">
          <path d="M0,14 L0,0 L14,0" fill="none" stroke="#2ecc71" strokeWidth="2" opacity="0.5" />
        </svg>
        <svg className="absolute" style={{ top: 30, right: 0 }} width="14" height="14">
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