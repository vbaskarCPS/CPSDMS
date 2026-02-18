// src/pages/Dialer/FireteamPanel.tsx
//
// Fireteam History Panel — scrollable log of team booking events.
// Newest at bottom, max 25 events, hover tooltip for details.
//

import { useEffect, useRef, useState } from 'react';
import { getBadgeIcon } from './BadgeIcons';

// =============================================================================
// TYPES
// =============================================================================

export interface FireteamEvent {
  id: string;
  timestamp: number;
  name: string;
  isOwn: boolean;
  isPrepay: boolean;
  points: number;
  base: number;
  multiplier: number;
  multiplierBreakdown: Record<string, number>;
  badgeBonuses: Record<string, number>;
  badgeBonusTotal: number;
  newBadges: string[];
  price?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CY = '#00e5ff';
const OR = '#f5a623';
const MULT_LABELS: Record<string, string> = {
  op_tempo: 'Op Tempo',
  tracer_rounds: 'Tracer',
  high_ground: 'High Ground',
  night_vision: 'Night Vision',
  blitz: 'Blitz',
  enraged: 'Enraged',
  ratio_focus: 'Ratio',
  war_machine: 'War Machine',
  ghost_town: 'Ghost Town',
  cold_streak: 'Cold Streak',
  scorched_earth: 'Scorched Earth',
  indoctrinate: 'Indoctrinate',
};

const PANEL_STYLES = `
  @keyframes ft-row-in {
    0% { opacity: 0; transform: translateX(8px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes ft-tooltip-in {
    0% { opacity: 0; transform: translateY(4px) scale(0.97); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
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
// TOOLTIP
// =============================================================================

function EventTooltip({ event }: { event: FireteamEvent }) {
  const multEntries = Object.entries(event.multiplierBreakdown);
  const badgeEntries = Object.entries(event.badgeBonuses);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 4,
        zIndex: 100,
        animation: 'ft-tooltip-in 0.15s ease-out both',
        pointerEvents: 'none',
      }}
    >
      <div style={{
        background: 'rgba(0,8,14,0.97)',
        border: `1px solid ${event.isPrepay ? OR : CY}30`,
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 16px ${event.isPrepay ? OR : CY}10`,
        backdropFilter: 'blur(12px)',
        fontSize: 10,
        lineHeight: 1.5,
      }}>
        {/* Type + price */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{
            fontWeight: 900,
            fontSize: 10,
            letterSpacing: '1.5px',
            color: event.isPrepay ? OR : CY,
            fontFamily: 'monospace',
          }}>
            {event.isPrepay ? '💳 PREPAY' : '✓ PREBOOK'}
            {event.isPrepay && event.price ? ` $${event.price}` : ''}
          </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#fff', fontSize: 12 }}>
            +{event.points}
          </span>
        </div>

        {/* Score breakdown */}
        <div style={{ marginBottom: multEntries.length > 0 || badgeEntries.length > 0 ? 6 : 0 }}>
          <div style={{ color: '#555', fontSize: 9, marginBottom: 3, letterSpacing: '1px', fontWeight: 700 }}>
            SCORE BREAKDOWN
          </div>
          <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 10 }}>
            {event.base}
            <span style={{ color: '#555', margin: '0 4px' }}>×</span>
            <span style={{ color: event.isPrepay ? OR : CY }}>{event.multiplier}x</span>
            {event.badgeBonusTotal > 0 && (
              <>
                <span style={{ color: '#555', margin: '0 4px' }}>+</span>
                <span style={{ color: '#9b59b6' }}>{event.badgeBonusTotal} bonus</span>
              </>
            )}
            <span style={{ color: '#555', margin: '0 4px' }}>=</span>
            <span style={{ color: '#fff', fontWeight: 900 }}>{event.points}</span>
          </div>
        </div>

        {/* Multiplier breakdown */}
        {multEntries.length > 0 && (
          <div style={{ marginBottom: badgeEntries.length > 0 ? 6 : 0 }}>
            <div style={{ color: '#555', fontSize: 9, marginBottom: 3, letterSpacing: '1px', fontWeight: 700 }}>
              MULTIPLIERS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
              {multEntries.map(([id, val]) => (
                <span key={id} style={{ color: '#777', fontFamily: 'monospace', fontSize: 9 }}>
                  <span style={{ color: OR }}>+{val}x</span>{' '}
                  <span style={{ color: '#555' }}>{MULT_LABELS[id] || id}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Badges earned */}
        {event.newBadges.length > 0 && (
          <div>
            <div style={{ color: '#555', fontSize: 9, marginBottom: 4, letterSpacing: '1px', fontWeight: 700 }}>
              BADGES EARNED
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {event.newBadges.map(id => {
                const icon = getBadgeIcon(id, 16);
                const label = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <span
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      background: 'rgba(155,89,182,0.12)',
                      border: '1px solid rgba(155,89,182,0.2)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 9,
                      color: '#9b59b6',
                      fontWeight: 700,
                    }}
                  >
                    {icon && <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>}
                    {label}
                    {badgeEntries.find(([bid]) => bid === id) && (
                      <span style={{ color: '#7d3c98', marginLeft: 2 }}>
                        +{badgeEntries.find(([bid]) => bid === id)![1]}
                      </span>
                    )}
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
// EVENT ROW
// =============================================================================

function EventRow({ event, index }: { event: FireteamEvent; index: number }) {
  const [hovered, setHovered] = useState(false);
  const color = event.isPrepay ? OR : CY;
  const maxBadges = 3;
  const visibleBadges = event.newBadges.slice(0, maxBadges);
  const extraBadges = event.newBadges.length - maxBadges;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 5,
        background: hovered
          ? `${color}08`
          : event.isOwn
            ? 'rgba(255,255,255,0.025)'
            : 'transparent',
        border: hovered
          ? `1px solid ${color}20`
          : event.isOwn
            ? '1px solid rgba(255,255,255,0.04)'
            : '1px solid transparent',
        cursor: 'default',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
        minWidth: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip */}
      {hovered && <EventTooltip event={event} />}

      {/* Own indicator */}
      {event.isOwn && (
        <div style={{
          width: 2,
          height: 14,
          borderRadius: 1,
          background: color,
          flexShrink: 0,
          opacity: 0.6,
        }} />
      )}

      {/* Time */}
      <span style={{
        fontFamily: 'monospace',
        fontSize: 9,
        color: '#444',
        flexShrink: 0,
        minWidth: 34,
        letterSpacing: '0.3px',
      }}>
        {formatTime(event.timestamp)}
      </span>

      {/* Name */}
      <span style={{
        fontSize: 10,
        fontWeight: event.isOwn ? 800 : 600,
        color: event.isOwn ? '#d0e8f0' : '#999',
        flexShrink: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {event.name}
      </span>

      {/* Points */}
      <span style={{
        fontFamily: 'monospace',
        fontWeight: 900,
        fontSize: 11,
        color,
        flexShrink: 0,
        textShadow: hovered ? `0 0 8px ${color}60` : 'none',
        transition: 'text-shadow 0.15s ease',
      }}>
        +{event.points}
      </span>

      {/* Badge icons */}
      {visibleBadges.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {visibleBadges.map(id => {
            const icon = getBadgeIcon(id, 13);
            if (!icon) return null;
            return (
              <span key={id} style={{ display: 'inline-flex', lineHeight: 1, opacity: 0.85 }}>
                {icon}
              </span>
            );
          })}
          {extraBadges > 0 && (
            <span style={{ fontSize: 8, color: '#555', fontWeight: 700, marginLeft: 1 }}>
              +{extraBadges}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export default function FireteamPanel({ events }: { events: FireteamEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track scroll position
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  // Auto-scroll to bottom when new events arrive (only if already at bottom)
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
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px 3px',
          flexShrink: 0,
          borderTop: '1px solid rgba(0,229,255,0.08)',
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: CY, opacity: 0.4 }} />
          <span style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '2px',
            color: CY,
            opacity: 0.4,
            textTransform: 'uppercase',
          }}>
            FIRETEAM
          </span>
          {events.length > 0 && (
            <span style={{
              marginLeft: 'auto',
              fontSize: 8,
              color: '#333',
              fontFamily: 'monospace',
            }}>
              {events.length}
            </span>
          )}
        </div>

        {/* Scrollable event list */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 0 4px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,229,255,0.15) transparent',
          }}
        >
          {events.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 60,
              color: '#2a3a3a',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '1.5px',
              textAlign: 'center',
              padding: '0 12px',
            }}>
              NO ACTIVITY YET
            </div>
          ) : (
            events.map((evt, i) => (
              <EventRow key={evt.id} event={evt} index={i} />
            ))
          )}
        </div>
      </div>
    </>
  );
}