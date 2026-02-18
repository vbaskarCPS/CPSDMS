// src/pages/Dialer/FireteamPanel.tsx
//
// Fireteam History Panel — scrollable log of team events.
// Toggle between GLOBAL (all campaigns) and FIRETEAM (current campaign).
// Historical data loaded on mount and on tab switch.
// Live events appended via Supabase Realtime.
// Multiplier activation rows are client-side only (passed as liveMultiplierEvents).
// Login events ("X on the field") show in GLOBAL tab only.
// Tooltips open to the LEFT so they're not clipped by the panel edge.
//

import { useEffect, useRef, useState, useCallback } from 'react';
import { getBadgeIcon, getMultiplierIcon } from './BadgeIcons';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';
import type { TeamBookingEvent } from './DialerHUD';
import type { MultiplierActivationEvent } from './DialerHUD';

// =============================================================================
// TYPES
// =============================================================================

export interface FireteamEvent {
  id: string;
  timestamp: number;
  name: string;
  isOwn: boolean;
  eventType?: 'booking' | 'multiplier' | 'login';
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

type FeedTab = 'global' | 'fireteam';

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

function teamEventToFireteam(
  evt: TeamBookingEvent & { managerId?: string; isLogin?: boolean },
  currentManagerId: string
): FireteamEvent {
  const isOwn = evt.managerId === currentManagerId;

  if (evt.isLogin) {
    return {
      id: evt.id,
      timestamp: evt.timestamp,
      name: isOwn ? 'You' : evt.name,
      isOwn,
      eventType: 'login',
      isPrepay: false,
      points: 0,
      base: 0,
      multiplier: 1,
      multiplierBreakdown: {},
      badgeBonuses: {},
      badgeBonusTotal: 0,
      newBadges: [],
    };
  }

  return {
    id: evt.id,
    timestamp: evt.timestamp,
    name: isOwn ? 'You' : evt.name,
    isOwn,
    eventType: 'booking',
    isPrepay: evt.isPrepay ?? false,
    points: evt.points,
    base: evt.points,
    multiplier: 1,
    multiplierBreakdown: {},
    badgeBonuses: {},
    badgeBonusTotal: 0,
    newBadges: evt.badges ?? [],
  };
}

function multActivationToFireteam(evt: MultiplierActivationEvent): FireteamEvent {
  return {
    id: evt.id,
    timestamp: evt.timestamp,
    name: evt.name,
    isOwn: true,
    eventType: 'multiplier',
    isPrepay: false,
    points: 0,
    base: 0,
    multiplier: 1,
    multiplierBreakdown: {},
    badgeBonuses: {},
    badgeBonusTotal: 0,
    newBadges: [],
    multiplierId: evt.multiplierId,
    multiplierText: evt.text,
    multiplierColor: evt.color,
    multiplierIcon: evt.icon,
  };
}

// =============================================================================
// BOOKING TOOLTIP (opens LEFT)
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

        <div style={{ marginBottom: multEntries.length > 0 || badgeEntries.length > 0 ? 6 : 0 }}>
          <div style={{ color: '#555', fontSize: 9, marginBottom: 3, letterSpacing: '1px', fontWeight: 700 }}>SCORE</div>
          <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 10 }}>
            {event.multiplier > 1 ? (
              <>
                {event.base}
                <span style={{ color: '#555', margin: '0 4px' }}>×</span>
                <span style={{ color: ac }}>{event.multiplier}x</span>
                {event.badgeBonusTotal > 0 && (
                  <><span style={{ color: '#555', margin: '0 4px' }}>+</span><span style={{ color: '#9b59b6' }}>{event.badgeBonusTotal} bonus</span></>
                )}
                <span style={{ color: '#555', margin: '0 4px' }}>=</span>
                <span style={{ color: '#fff', fontWeight: 900 }}>{event.points}</span>
              </>
            ) : (
              <span style={{ color: '#fff', fontWeight: 900 }}>+{event.points} pts</span>
            )}
          </div>
        </div>

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
// MULTIPLIER TOOLTIP (opens LEFT)
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

      {event.isOwn && (
        <div style={{ width: 2, height: 14, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.6 }} />
      )}

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
          {extraBadges > 0 && (
            <span style={{ fontSize: 8, color: '#555', fontWeight: 700, marginLeft: 1 }}>+{extraBadges}</span>
          )}
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

      <div style={{ width: 2, height: 12, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.35 }} />

      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#333', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>

      <span style={{
        fontSize: 10, fontWeight: event.isOwn ? 700 : 500,
        color: event.isOwn ? '#7a9ea8' : '#555',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.name}
      </span>

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
// LOGIN ROW — "Vijay on the field" — Global tab only
// =============================================================================

function LoginRow({ event, index }: { event: FireteamEvent; index: number }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 5,
        background: 'transparent',
        border: '1px solid transparent',
        animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
        minWidth: 0, opacity: 0.45,
      }}
    >
      <span style={{ fontSize: 7, flexShrink: 0 }}>🟢</span>

      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#333', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>

      <span style={{
        fontSize: 10, fontStyle: 'italic', fontWeight: 500,
        color: '#3a6a4a',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.name} on the field
      </span>
    </div>
  );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

interface FireteamPanelProps {
  campaignId: string;
  managerId: string;
  managerName: string;
  liveMultiplierEvents?: MultiplierActivationEvent[];
}

export default function FireteamPanel({
  campaignId,
  managerId,
  managerName,
  liveMultiplierEvents = [],
}: FireteamPanelProps) {
  const [activeTab, setActiveTab] = useState<FeedTab>('global');
  const [globalEvents, setGlobalEvents] = useState<Map<string, FireteamEvent>>(new Map());
  const [fireteamEvents, setFireteamEvents] = useState<Map<string, FireteamEvent>>(new Map());
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const globalUnsubRef = useRef<(() => void) | null>(null);
  const fireteamUnsubRef = useRef<(() => void) | null>(null);

  const upsertEvents = useCallback((
    setter: React.Dispatch<React.SetStateAction<Map<string, FireteamEvent>>>,
    incoming: FireteamEvent[]
  ) => {
    setter(prev => {
      const next = new Map(prev);
      for (const evt of incoming) next.set(evt.id, evt);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!campaignId || !managerId) return;
    let cancelled = false;

    const setup = async () => {
      setLoading(true);

      const [globalRaw, fireteamRaw] = await Promise.all([
        dialerRealtimeService.fetchTodayEvents(),
        dialerRealtimeService.fetchTodayEvents(campaignId),
      ]);

      if (cancelled) return;

      const toFE = (evt: TeamBookingEvent & { managerId?: string; isLogin?: boolean }) =>
        teamEventToFireteam(evt, managerId);

      upsertEvents(setGlobalEvents, globalRaw.map(toFE));
      upsertEvents(setFireteamEvents, fireteamRaw.map(toFE));
      setLoading(false);

      // Global: all campaigns, own events included, logins included
      globalUnsubRef.current = dialerRealtimeService.subscribeToGlobalFeed(
        managerId,
        (evt) => {
          const fe = teamEventToFireteam(evt as any, managerId);
          upsertEvents(setGlobalEvents, [fe]);
        }
      );

      // Fireteam: current campaign only, skip own, no logins
      fireteamUnsubRef.current = dialerRealtimeService.subscribeToTeamFeed(
        campaignId,
        managerId,
        (evt) => {
          const fe = teamEventToFireteam(evt as any, managerId);
          upsertEvents(setFireteamEvents, [fe]);
        }
      );
    };

    setup();

    return () => {
      cancelled = true;
      globalUnsubRef.current?.();
      fireteamUnsubRef.current?.();
      globalUnsubRef.current = null;
      fireteamUnsubRef.current = null;
    };
  }, [campaignId, managerId, upsertEvents]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const activeCount = activeTab === 'global' ? globalEvents.size : fireteamEvents.size;

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeCount, liveMultiplierEvents.length]);

  const buildDisplayEvents = (): FireteamEvent[] => {
    const bookingMap = activeTab === 'global' ? globalEvents : fireteamEvents;
    const bookings = Array.from(bookingMap.values());

    // On fireteam tab: strip login events (global-only)
    const filtered = activeTab === 'fireteam'
      ? bookings.filter(e => e.eventType !== 'login')
      : bookings;

    const multEvents = liveMultiplierEvents.map(multActivationToFireteam);
    return [...filtered, ...multEvents].sort((a, b) => a.timestamp - b.timestamp);
  };

  const displayEvents = buildDisplayEvents();

  return (
    <>
      <style>{PANEL_STYLES}</style>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Header with tab toggle */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '3px 8px 0', flexShrink: 0,
          borderTop: `1px solid ${CY}08`,
          gap: 0,
        }}>
          <button
            onClick={() => setActiveTab('global')}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              borderBottom: activeTab === 'global' ? `1.5px solid ${CY}` : '1.5px solid transparent',
              padding: '3px 4px 4px', cursor: 'pointer', transition: 'border-color 0.2s ease',
            }}
          >
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: CY,
              opacity: activeTab === 'global' ? 0.8 : 0.25,
              textTransform: 'uppercase' as const, fontFamily: 'monospace',
              transition: 'opacity 0.2s ease',
            }}>
              GLOBAL
            </span>
          </button>

          <button
            onClick={() => setActiveTab('fireteam')}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              borderBottom: activeTab === 'fireteam' ? `1.5px solid ${CY}` : '1.5px solid transparent',
              padding: '3px 4px 4px', cursor: 'pointer', transition: 'border-color 0.2s ease',
            }}
          >
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: CY,
              opacity: activeTab === 'fireteam' ? 0.8 : 0.25,
              textTransform: 'uppercase' as const, fontFamily: 'monospace',
              transition: 'opacity 0.2s ease',
            }}>
              FIRETEAM
            </span>
          </button>

          {displayEvents.length > 0 && (
            <span style={{ fontSize: 8, color: '#2a3a3a', fontFamily: 'monospace', paddingLeft: 6, flexShrink: 0 }}>
              {displayEvents.length}
            </span>
          )}
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0', flexShrink: 0 }}>
            <span style={{ fontSize: 8, color: `${CY}30`, letterSpacing: '2px', fontWeight: 700 }}>LOADING...</span>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: 'auto', overflowX: 'visible',
            padding: '2px 0 4px',
            scrollbarWidth: 'thin', scrollbarColor: `${CY}12 transparent`,
          }}
        >
          {!loading && displayEvents.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', minHeight: 60,
              color: '#2a3a3a', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px',
              textAlign: 'center', padding: '0 12px',
            }}>
              NO ACTIVITY YET
            </div>
          ) : (
            displayEvents.map((evt, i) => {
              if (evt.eventType === 'login')      return <LoginRow      key={evt.id} event={evt} index={i} />;
              if (evt.eventType === 'multiplier') return <MultiplierRow key={evt.id} event={evt} index={i} />;
              return <BookingRow key={evt.id} event={evt} index={i} />;
            })
          )}
        </div>
      </div>
    </>
  );
}