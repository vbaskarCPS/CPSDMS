// src/pages/Dialer/DialerHUD.tsx
//
// Military sniper HUD frame for the AutoSniper dialer.
// Ported from PreviewDialerSidebar HUD elements.
//

import { useState, useEffect, useRef } from 'react';
import type { GamificationSession, MultiplierSnapshot, Rank } from '../../lib/dialer/gamificationDefs';

// --- Props ---

interface HUDProps {
  session: GamificationSession | null;
  activeMultipliers: MultiplierSnapshot[];
  multipliersReceivedAt: number;
  rank: Rank | null;
  onTrophyClick: () => void;
  onPointsClick?: () => void;
}

// --- Helpers ---

function formatCountdown(ms: number): string | null {
  if (ms < 0) return null;
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// Multiplier pill color map
const PILL_STYLES: Record<string, { border: string; bg: string; color: string; pulse?: string }> = {
  op_tempo:       { border: 'rgba(241,196,15,0.5)', bg: 'rgba(241,196,15,0.08)', color: '#f1c40f' },
  tracer_rounds:  { border: 'rgba(231,76,60,0.5)',  bg: 'rgba(231,76,60,0.08)',  color: '#e74c3c' },
  high_ground:    { border: 'rgba(0,188,212,0.5)',   bg: 'rgba(0,188,212,0.08)',  color: '#00BCD4' },
  night_vision:   { border: 'rgba(155,89,182,0.5)',  bg: 'rgba(155,89,182,0.08)', color: '#9b59b6' },
  blitz:          { border: 'rgba(230,126,34,0.5)',  bg: 'rgba(230,126,34,0.08)', color: '#e67e22' },
  enraged:        { border: 'rgba(255,0,64,0.6)',    bg: 'rgba(255,0,64,0.1)',    color: '#ff0040', pulse: 'enraged' },
  ratio_focus:    { border: 'rgba(52,152,219,0.5)',  bg: 'rgba(52,152,219,0.08)', color: '#3498db' },
  war_machine:    { border: 'rgba(149,165,166,0.5)', bg: 'rgba(149,165,166,0.08)',color: '#95a5a6' },
  ghost_town:     { border: 'rgba(189,195,199,0.5)', bg: 'rgba(189,195,199,0.08)',color: '#bdc3c7' },
  cold_streak:    { border: 'rgba(133,193,233,0.5)', bg: 'rgba(133,193,233,0.08)',color: '#85c1e9' },
  scorched_earth: { border: 'rgba(255,87,34,0.6)',   bg: 'rgba(255,87,34,0.1)',   color: '#ff5722', pulse: 'scorched' },
};

// --- Multiplier Pills ---

function MultiplierPills({
  multipliers,
  receivedAt,
}: {
  multipliers: MultiplierSnapshot[];
  receivedAt: number;
}) {
  const [, setTick] = useState(0);
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

  return (
    <div className="flex items-center gap-1 flex-wrap" style={{ marginLeft: 14 }}>
      {multipliers.map(m => {
        const remainingMs = m.expiresIn > 0 ? m.expiresIn - elapsed : m.expiresIn;
        if (m.expiresIn > 0 && remainingMs <= 0) return null;

        const countdown = formatCountdown(remainingMs);
        const ps = PILL_STYLES[m.id] || { border: 'rgba(255,255,255,0.15)', bg: 'rgba(255,255,255,0.04)', color: '#fff' };
        const charges = (m.extra as any)?.charges;

        return (
          <div
            key={m.id}
            className="relative flex items-center gap-1 rounded font-mono font-extrabold cursor-default transition-all duration-150 group"
            style={{
              padding: '2px 7px',
              fontSize: 10,
              letterSpacing: '0.5px',
              border: `1px solid ${ps.border}`,
              background: ps.bg,
              color: ps.color,
              animation: ps.pulse === 'enraged'
                ? 'enraged-pulse 1.2s ease-in-out infinite'
                : ps.pulse === 'scorched'
                  ? 'scorched-pulse 2s ease-in-out infinite'
                  : undefined,
            }}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>{m.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 900 }}>+{m.value}x</span>
            {countdown && <span style={{ fontSize: 7, opacity: 0.6, fontWeight: 600, marginLeft: 1 }}>{countdown}</span>}
            {charges && <span style={{ fontSize: 7, opacity: 0.7, fontWeight: 600, marginLeft: 1, color: '#f1c40f' }}>x{charges}</span>}

            {/* Tooltip */}
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-30"
              style={{
                background: 'rgba(10,18,10,0.97)',
                border: '1px solid rgba(46,204,113,0.4)',
                borderRadius: 4,
                padding: '6px 10px',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                minWidth: 130,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff', marginBottom: 2 }}>
                {m.name}
              </div>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#2ecc71', marginBottom: 2 }}>+{m.value}x bonus</div>
              {charges ? (
                <div style={{ fontSize: 8, color: '#f1c40f', fontWeight: 600, letterSpacing: '0.5px' }}>x{charges} charges</div>
              ) : (
                <div style={{ fontSize: 8, color: countdown ? '#f1c40f' : '#555', fontWeight: 600, letterSpacing: '0.5px' }}>
                  {countdown || 'ALWAYS ACTIVE'}
                </div>
              )}
              {/* Arrow */}
              <div
                className="absolute top-full left-1/2 -translate-x-1/2"
                style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid rgba(46,204,113,0.4)' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Main HUD Component ---

export default function DialerHUD({ session, activeMultipliers, multipliersReceivedAt, rank, onTrophyClick, onPointsClick }: HUDProps) {
  const s = session;

  return (
    <>
      {/* Keyframe animations */}
      <style>{`
        @keyframes enraged-pulse { 0%,100% { box-shadow: 0 0 4px rgba(255,0,64,0.15); } 50% { box-shadow: 0 0 14px rgba(255,0,64,0.45); } }
        @keyframes scorched-pulse { 0%,100% { box-shadow: 0 0 4px rgba(255,87,34,0.15); } 50% { box-shadow: 0 0 12px rgba(255,87,34,0.4); } }
      `}</style>

      <div className="fixed inset-0 pointer-events-none z-10">
        {/* === TOP BAR === */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 font-mono"
          style={{
            height: 30,
            background: 'rgba(14,24,14,0.95)',
            borderBottom: '2px solid rgba(46,204,113,0.6)',
            boxShadow: '0 2px 12px rgba(46,204,113,0.15)',
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="font-bold"
              style={{ border: '1.5px solid rgba(46,204,113,0.7)', borderRadius: 3, padding: '1px 6px', background: 'rgba(46,204,113,0.06)', fontSize: 10, color: '#2ecc71' }}
            >
              M82
            </span>
            <span style={{ fontSize: 9, color: '#2ecc71', opacity: 0.8, fontWeight: 'bold' }}>Barrett M82A1</span>
            <span style={{ fontSize: 7, color: '#2ecc71', opacity: 0.4 }}>12.7x99mm</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="pointer-events-auto cursor-pointer transition-all duration-200"
              onClick={onTrophyClick}
              style={{
                border: '1px solid rgba(241,196,15,0.5)',
                borderRadius: 3,
                padding: '2px 8px',
                background: 'rgba(241,196,15,0.08)',
                fontSize: 12,
              }}
              title="Achievements"
            >
              🏆
            </span>
          </div>
        </div>

        {/* === BOTTOM BAR === */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center px-3 font-mono"
          style={{
            height: 48,
            background: 'rgba(14,24,14,0.95)',
            borderTop: '2px solid rgba(46,204,113,0.6)',
            boxShadow: '0 -2px 12px rgba(46,204,113,0.15)',
          }}
        >
          {/* Session stats */}
          <div className="flex items-center gap-3.5">
            <StatBox label="Prebooks" value={s?.pbs ?? 0} color="#2ecc71" />
            <StatBox label="Prepays" value={s?.pps ?? 0} color="#f1c40f" />
            <StatBox label="PP$" value={`$${s?.ppDollars ?? 0}`} color="#e67e22" />
            <StatBox label="Total" value={s?.totalBookings ?? 0} color="#fff" />
            <StatBox label="Streak" value={s?.consecutiveYes ?? 0} color="#e74c3c" />
          </div>

          {/* Multiplier pills */}
          <MultiplierPills multipliers={activeMultipliers} receivedAt={multipliersReceivedAt} />

          {/* Points display */}
          <div
            className="flex flex-col items-end ml-auto px-2 pointer-events-auto"
            style={{ cursor: onPointsClick ? 'pointer' : 'default' }}
            onClick={onPointsClick}
          >
            <span
              className="font-black font-mono tracking-wider"
              style={{
                fontSize: 30,
                lineHeight: 1,
                color: '#2ecc71',
                textShadow: '0 0 12px rgba(46,204,113,0.5), 0 0 28px rgba(46,204,113,0.2), 0 0 4px rgba(46,204,113,0.8)',
              }}
            >
              {s?.totalSessionPoints ?? 0}
            </span>
            <span style={{ fontSize: 7, color: '#2ecc71', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', opacity: 0.5, marginTop: 1, textAlign: 'right' }}>
              Points
            </span>
          </div>

          {/* Rank badge */}
          {rank && (
            <div
              className="flex flex-col items-center"
              style={{
                border: '1.5px solid rgba(241,196,15,0.4)',
                borderRadius: 4,
                padding: '3px 10px',
                background: 'rgba(241,196,15,0.06)',
                marginLeft: 8,
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{rank.icon}</span>
              <span style={{ fontSize: 7, color: '#f1c40f', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1 }}>
                {rank.label}
              </span>
            </div>
          )}
        </div>

        {/* === SIDE BORDERS === */}
        <div
          className="absolute left-0"
          style={{ top: 32, bottom: 50, width: 6, background: 'linear-gradient(to right, rgba(14,24,14,0.8), transparent)', borderRight: '1.5px solid rgba(46,204,113,0.35)' }}
        />
        <div
          className="absolute right-0"
          style={{ top: 32, bottom: 50, width: 6, background: 'linear-gradient(to left, rgba(14,24,14,0.8), transparent)', borderLeft: '1.5px solid rgba(46,204,113,0.35)' }}
        />

        {/* === CORNERS === */}
        <svg className="absolute" style={{ top: 30, left: 0 }} width="18" height="18">
          <path d="M0,18 L0,0 L18,0" fill="none" stroke="#2ecc71" strokeWidth="2.5" opacity="0.7" />
        </svg>
        <svg className="absolute" style={{ top: 30, right: 0 }} width="18" height="18">
          <path d="M18,18 L18,0 L0,0" fill="none" stroke="#2ecc71" strokeWidth="2.5" opacity="0.7" />
        </svg>
        <svg className="absolute" style={{ bottom: 48, left: 0 }} width="18" height="18">
          <path d="M0,0 L0,18 L18,18" fill="none" stroke="#2ecc71" strokeWidth="2.5" opacity="0.7" />
        </svg>
        <svg className="absolute" style={{ bottom: 48, right: 0 }} width="18" height="18">
          <path d="M18,0 L18,18 L0,18" fill="none" stroke="#2ecc71" strokeWidth="2.5" opacity="0.7" />
        </svg>

        {/* === SIDE TICKS === */}
        {[30, 40, 50, 60, 70].map(pct => (
          <div key={`tl-${pct}`}>
            <div
              className="absolute left-0"
              style={{ top: `${pct}%`, width: pct === 50 ? 12 : 8, height: pct === 50 ? 2 : 1.5, background: pct === 50 ? 'rgba(46,204,113,0.5)' : 'rgba(46,204,113,0.4)' }}
            />
            <div
              className="absolute right-0"
              style={{ top: `${pct}%`, width: pct === 50 ? 12 : 8, height: pct === 50 ? 2 : 1.5, background: pct === 50 ? 'rgba(46,204,113,0.5)' : 'rgba(46,204,113,0.4)' }}
            />
          </div>
        ))}

        {/* === RETICLE === */}
        <svg
          className="absolute pointer-events-none"
          style={{ top: '50%', left: '42%', transform: 'translate(-50%,-50%)', opacity: 0.12 }}
          width="160" height="160" viewBox="0 0 160 160"
        >
          <circle cx="80" cy="80" r="55" fill="none" stroke="#2ecc71" strokeWidth="1.2" />
          <circle cx="80" cy="80" r="32" fill="none" stroke="#2ecc71" strokeWidth="0.8" />
          <circle cx="80" cy="80" r="12" fill="none" stroke="#2ecc71" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="2.5" fill="#2ecc71" />
          <line x1="80" y1="10" x2="80" y2="65" stroke="#2ecc71" strokeWidth="0.8" />
          <line x1="80" y1="95" x2="80" y2="150" stroke="#2ecc71" strokeWidth="0.8" />
          <line x1="10" y1="80" x2="65" y2="80" stroke="#2ecc71" strokeWidth="0.8" />
          <line x1="95" y1="80" x2="150" y2="80" stroke="#2ecc71" strokeWidth="0.8" />
        </svg>
      </div>
    </>
  );
}

// --- Stat Box Sub-component ---

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-black tracking-wider" style={{ fontSize: 18, color, lineHeight: 1, letterSpacing: '1px' }}>
        {value}
      </span>
      <span style={{ fontSize: 7, color: '#2ecc71', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', opacity: 0.6, marginTop: 2 }}>
        {label}
      </span>
    </div>
  );
}