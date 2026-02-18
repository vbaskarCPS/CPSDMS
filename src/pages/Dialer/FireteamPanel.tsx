// src/pages/Dialer/FireteamPanel.tsx
//
// Fireteam History Panel — scrollable log of team events.
// Shows bookings AND multiplier activations.
// Tooltip opens to the LEFT so it's not clipped by the panel edge.
//

import { useEffect, useRef, useState } from 'react';
import { getBadgeIcon, getMultiplierIcon } from './BadgeIcons';

// =============================================================================
// TYPES
// =============================================================================

export interface FireteamEvent {
  id: string;
  timestamp: number;
  name: string;
  isOwn: boolean;
  eventType?: 'booking' | 'multiplier';
  // Booking fields
  isPrepay: boolean;
  points: number;
  base: number;
  multiplier: number;
  multiplierBreakdown: Record<string, number>;
  badgeBonuses: Record<string, number>;
  badgeBonusTotal: number;
  newBadges: string[];
  price?: number;
  // Multiplier activation fields
  multiplierId?: string;
  multiplierText?: string;
  multiplierColor?: string;
  multiplierIcon?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CY = '#00e5ff';
const OR = '#f5a623';

const MULT_LABELS: Record<string, string> = {
  op_tempo: 'Op Tempo',
  tracer_rounds: 'Tracer Rounds',
  high_ground: 'High Ground',
  night_vision: 'Night Vision',
  blitz: 'Blitz',
  enraged: 'Enraged',
  ratio_focus: 'Ratio Focus',
  war_machine: 'War Machine',
  ghost_town: 'Ghost Town',
  cold_streak: 'Cold Streak',
  scorched_earth: 'Scorched Earth',
  indoctrinate: 'Indoctrinate',
};

const PANEL_STYLES = `
  @keyframes ft-row-in {
    0%   { opacity: 0; transform: translateX(8px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes ft-tooltip-in {
    0%   { opacity: 0; transform: translateY(-50%) translateX(4px) scale(0.97); }
    100% { opacity: 1; transform: translateY(-50%) translateX(0)   scale(1); }
  }
`;

// =============================================================================
// HELPERS
// =============================================================================

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  const ampm = d.getHours() >= 12 ? 'p' : 'a';
  return `${h}:${m < 10 ? '0' + m : m}${ampm}`;
}

// =============================================================================
// BOOKING TOOLTIP  (opens LEFT)
// =============================================================================

function BookingTooltip({ event }: { event: FireteamEvent }) {
  const multEntries = Object.entries(event.multiplierBreakdown || {});
  const badgeEntries = Object.entries(event.badgeBonuses || {});
  const ac = event.isPrepay ? OR : CY;

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      right: 'calc(100% + 8px)',
      transform: 'translateY(-50%)',
      zIndex: 200,
      minWidth: 220,
      maxWidth: 260,
      animation: 'ft-tooltip-in 0.15s ease-out both',
      pointerEvents: 'none',
    }}>
      {/* Arrow → points right */}
      <div style={{
        position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)',
        width: 0, height: 0,
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderLeft: `6px solid ${ac}35`,
      }} />

      <div style={{
        background: 'rgba(0,8,14,0.97)', border: `1px solid ${ac}30`,
        borderRadius: 8, padding: '10px 12px',
        boxShadow: `0 8px 32px rgba(0,0,0,0.85), 0 0 16px ${ac}10`,
        backdropFilter: 'blur(12px)', fontSize: 10, lineHeight: 1.5,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontWeight: 900, fontSize: 10, letterSpacing: '1.5px', color: ac, fontFamily: 'monospace' }}>
            {event.isPrepay ? '💳 PREPAY' : '✓ PREBOOK'}
            {event.isPrepay && event.price ? ` $${event.price}` : ''}
          </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#fff', fontSize: 12 }}>
            +{event.points}
          </span>
        </div>

        {/* Score */}
        <div style={{ marginBottom: multEntries.length > 0 || badgeEntries.length > 0 ? 6 : 0 }}>
          <div style={{ color: '#555', fontSize: 9, marginBottom: 3, letterSpacing: '1px', fontWeight: 700 }}>SCORE BREAKDOWN</div>
          <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 10 }}>
            {event.base}
            <span style={{ color: '#555', margin: '0 4px' }}>×</span>
            <span style={{ color: ac }}>{event.multiplier}x</span>
            {event.badgeBonusTotal > 0 && (
              <><span style={{ color: '#555', margin: '0 4px' }}>+</span><span style={{ color: '#9b59b6' }}>{event.badgeBonusTotal} bonus</span></>
            )}
            <span style={{ color: '#555', margin: '0 4px' }}>=</span>
            <span style={{ color: '#fff', fontWeight: 900 }}>{event.points}</span>
          </div>
        </div>

        {/* Multiplier breakdown */}
        {multEntries.length > 0 && (
          <div style={{ marginBottom: badgeEntries.length > 0 ? 6 : 0 }}>
            <div style={{ color: '#555', fontSize: 9, marginBottom: 3, letterSpacing: '1px', fontWeight: 700 }}>MULTIPLIERS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
              {multEntries.map(([id, val]) => (
                <span key={id} style={{ fontFamily: 'monospace', fontSize: 9, color: '#777' }}>
                  <span style={{ color: OR }}>+{val}x</span>{' '}
                  <span style={{ color: '#555' }}>{MULT_LABELS[id] || id}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Badges */}
        {(event.newBadges || []).length > 0 && (
          <div>
            <div style={{ color: '#555', fontSize: 9, marginBottom: 4, letterSpacing: '1px', fontWeight: 700 }}>BADGES EARNED</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {event.newBadges.map(id => {
                const icon = getBadgeIcon(id, 16);
                const label = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const bonus = badgeEntries.find(([bid]) => bid === id);
                return (
                  <span key={id} style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    background: 'rgba(155,89,182,0.12)', border: '1px solid rgba(155,89,182,0.2)',
                    borderRadius: 4, padding: '2px 6px', fontSize: 9, color: '#9b59b6', fontWeight: 700,
                  }}>
                    {icon && <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>}
                    {label}
                    {bonus && <span style={{ color: '#7d3c98', marginLeft: 2 }}>+{bonus[1]}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MULTIPLIER TOOLTIP  (opens LEFT)
// =============================================================================

function MultiplierTooltip({ event }: { event: FireteamEvent }) {
  const color = event.multiplierColor || CY;
  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      right: 'calc(100% + 8px)',
      transform: 'translateY(-50%)',
      zIndex: 200,
      minWidth: 160,
      animation: 'ft-tooltip-in 0.15s ease-out both',
      pointerEvents: 'none',
    }}>
      {/* Arrow → points right */}
      <div style={{
        position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)',
        width: 0, height: 0,
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderLeft: `6px solid ${color}30`,
      }} />
      <div style={{
        background: 'rgba(0,8,14,0.97)', border: `1px solid ${color}30`,
        borderRadius: 8, padding: '10px 14px',
        boxShadow: `0 8px 32px rgba(0,0,0,0.85), 0 0 12px ${color}12`,
        backdropFilter: 'blur(12px)', fontSize: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>{event.multiplierIcon || '⚡'}</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 11, color, letterSpacing: '1px', fontFamily: 'monospace' }}>
              {MULT_LABELS[event.multiplierId || ''] || event.multiplierId || 'Multiplier'}
            </div>
            <div style={{ color: '#555', fontSize: 9, marginTop: 2, letterSpacing: '0.5px' }}>
              {event.multiplierText || 'ACTIVATED'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// BOOKING ROW
// =============================================================================

function BookingRow({ event, index }: { event: FireteamEvent; index: number }) {
  const [hovered, setHovered] = useState(false);
  const color = event.isPrepay ? OR : CY;
  const visibleBadges = (event.newBadges || []).slice(0, 3);
  const extraBadges = (event.newBadges || []).length - 3;

  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: 5,
        background: hovered ? `${color}08` : event.isOwn ? 'rgba(255,255,255,0.025)' : 'transparent',
        border: hovered ? `1px solid ${color}20` : event.isOwn ? '1px solid rgba(255,255,255,0.04)' : '1px solid transparent',
        cursor: 'default', transition: 'background 0.15s, border-color 0.15s',
        animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
        minWidth: 0, overflow: 'visible',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && <BookingTooltip event={event} />}

      {event.isOwn && <div style={{ width: 2, height: 14, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.6 }} />}

      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>

      <span style={{
        fontSize: 10, fontWeight: event.isOwn ? 800 : 600,
        color: event.isOwn ? '#d0e8f0' : '#999',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.name}
      </span>

      <span style={{
        fontFamily: 'monospace', fontWeight: 900, fontSize: 11, color, flexShrink: 0,
        textShadow: hovered ? `0 0 8px ${color}60` : 'none', transition: 'text-shadow 0.15s',
      }}>
        +{event.points}
      </span>

      {visibleBadges.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {visibleBadges.map(id => {
            const icon = getBadgeIcon(id, 13);
            if (!icon) return null;
            return <span key={id} style={{ display: 'inline-flex', lineHeight: 1, opacity: 0.85 }}>{icon}</span>;
          })}
          {extraBadges > 0 && <span style={{ fontSize: 8, color: '#555', fontWeight: 700, marginLeft: 1 }}>+{extraBadges}</span>}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MULTIPLIER ROW
// =============================================================================

function MultiplierRow({ event, index }: { event: FireteamEvent; index: number }) {
  const [hovered, setHovered] = useState(false);
  const color = event.multiplierColor || CY;
  const multIcon = getMultiplierIcon(event.multiplierId || '', 13);

  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 5,
        background: hovered ? `${color}06` : 'transparent',
        border: `1px solid ${hovered ? `${color}18` : 'transparent'}`,
        cursor: 'default', transition: 'background 0.15s, border-color 0.15s',
        animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
        minWidth: 0, overflow: 'visible',
        opacity: hovered ? 0.9 : 0.6,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && <MultiplierTooltip event={event} />}

      {/* Dim colored bar */}
      <div style={{ width: 2, height: 12, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.35 }} />

      {/* Time */}
      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#333', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>

      {/* Name */}
      <span style={{
        fontSize: 10, fontWeight: event.isOwn ? 700 : 500,
        color: event.isOwn ? '#7a9ea8' : '#555',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.name}
      </span>

      {/* Icon */}
      <span style={{
        display: 'inline-flex', lineHeight: 1, flexShrink: 0,
        filter: `drop-shadow(0 0 3px ${color}50)`,
        fontSize: 12,
      }}>
        {multIcon || event.multiplierIcon || '⚡'}
      </span>
    </div>
  );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export default function FireteamPanel({ events }: { events: FireteamEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <>
      <style>{PANEL_STYLES}</style>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px 3px', flexShrink: 0,
          borderTop: `1px solid ${CY}08`,
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: CY, opacity: 0.35 }} />
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: CY, opacity: 0.35, textTransform: 'uppercase' }}>
            FIRETEAM
          </span>
          {events.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 8, color: '#2a3a3a', fontFamily: 'monospace' }}>
              {events.length}
            </span>
          )}
        </div>

        {/* List — overflowX visible so left-anchored tooltips aren't clipped */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'visible',
            padding: '2px 0 4px',
            scrollbarWidth: 'thin',
            scrollbarColor: `${CY}12 transparent`,
          }}
        >
          {events.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', minHeight: 60,
              color: '#2a3a3a', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px',
              textAlign: 'center', padding: '0 12px',
            }}>
              NO ACTIVITY YET
            </div>
          ) : (
            events.map((evt, i) =>
              evt.eventType === 'multiplier'
                ? <MultiplierRow key={evt.id} event={evt} index={i} />
                : <BookingRow key={evt.id} event={evt} index={i} />
            )
          )}
        </div>
      </div>
    </>
  );
}