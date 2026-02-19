// src/pages/Dialer/FireteamPanel.tsx
//
// Fireteam History Panel — scrollable log of team events.
// Toggle between GLOBAL (all campaigns) and FIRETEAM (current campaign).
//
// CHANGES:
// - Multiplier events now shown for ALL teammates (not just own)
//   Received via Supabase realtime (is_multiplier=true rows) and historical fetch.
// - Booking row format: Name +PTS | badges in WHITE | multiplier icons in GREEN
// - Tooltip rendered via ReactDOM.createPortal to avoid scroll container clipping
// - PortalTooltip now accepts `visible` prop so position is recalculated each time
//   hover starts (fixes tooltip clipping at bottom of screen)
// - liveMultiplierEvents prop still accepted for own activations (instant feedback
//   before the DB round-trip completes)
//
// SUBSCRIPTION STRATEGY:
// Uses createIsolatedChannel() — does NOT touch shared fireteamChannel/globalChannel
// slots reserved for DialerPage HUD toast subscriptions.
//

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
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
const GREEN = '#2ecc71';

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

const MULT_COLORS: Record<string, string> = {
  op_tempo: '#f5a623',
  tracer_rounds: '#e74c3c',
  high_ground: '#00e5ff',
  night_vision: '#9b59b6',
  blitz: '#ff6b35',
  enraged: '#ff0040',
  ratio_focus: '#3498db',
  war_machine: '#95a5a6',
  ghost_town: '#bdc3c7',
  cold_streak: '#85c1e9',
  scorched_earth: '#ff5722',
  indoctrinate: '#e056a0',
};

const MULT_ICONS_EMOJI: Record<string, string> = {
  op_tempo: '🔥',
  tracer_rounds: '💥',
  high_ground: '🏔️',
  night_vision: '🌙',
  blitz: '⚡',
  enraged: '💢',
  ratio_focus: '📊',
  war_machine: '⚙️',
  ghost_town: '👻',
  cold_streak: '❄️',
  scorched_earth: '🌋',
  indoctrinate: '🧠',
};

// Verb phrases for reconstructing multiplier text from just multiplierId + name
const MULT_VERBS: Record<string, string> = {
  op_tempo:       'is On Fire',
  tracer_rounds:  'has Tracer Rounds',
  high_ground:    'has High Ground',
  night_vision:   'has Night Vision',
  blitz:          'triggered Blitz',
  enraged:        'is Enraged',
  ratio_focus:    'has Ratio Focus',
  war_machine:    'is a War Machine',
  ghost_town:     'is in a Ghost Town',
  cold_streak:    'hit a Cold Streak',
  scorched_earth: 'scorched the earth',
  indoctrinate:   'is Indoctrinating',
};

function buildMultiplierText(name: string, multiplierId: string, isOwn: boolean): string {
  const verb = MULT_VERBS[multiplierId] || `activated ${multiplierId.replace(/_/g, ' ')}`;
  if (!isOwn) return `${name} ${verb}`;
  // Own: convert to second person
  const ownVerb = verb
    .replace(/^is a /, 'are a ')
    .replace(/^is /, 'are ')
    .replace(/^has /, 'have ')
    .replace(/^triggered /, 'triggered ')
    .replace(/^scorched /, 'scorched ')
    .replace(/^hit /, 'hit ');
  return `${name} ${ownVerb}`;
}

const PANEL_STYLES = `
  @keyframes ft-row-in {
    0%   { opacity: 0; transform: translateX(8px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes ft-tooltip-in {
    0%   { opacity: 0; transform: scale(0.97); }
    100% { opacity: 1; transform: scale(1); }
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
  evt: TeamBookingEvent & { managerId?: string; isLogin?: boolean; isMultiplier?: boolean; multiplierId?: string },
  currentManagerId: string
): FireteamEvent {
  const isOwn = evt.managerId === currentManagerId;
  const displayName = isOwn ? 'You' : evt.name;

  if (evt.isLogin) {
    return {
      id: evt.id, timestamp: evt.timestamp, name: displayName, isOwn,
      eventType: 'login',
      isPrepay: false, points: 0, base: 0, multiplier: 1,
      multiplierBreakdown: {}, badgeBonuses: {}, badgeBonusTotal: 0, newBadges: [],
    };
  }

  if (evt.isMultiplier && evt.multiplierId) {
    const mid = evt.multiplierId;
    return {
      id: evt.id, timestamp: evt.timestamp, name: displayName, isOwn,
      eventType: 'multiplier',
      isPrepay: false, points: 0, base: 0, multiplier: 1,
      multiplierBreakdown: {}, badgeBonuses: {}, badgeBonusTotal: 0, newBadges: [],
      multiplierId: mid,
      multiplierText: buildMultiplierText(displayName, mid, isOwn),
      multiplierColor: MULT_COLORS[mid] || CY,
      multiplierIcon: MULT_ICONS_EMOJI[mid] || '⚡',
    };
  }

  return {
    id: evt.id, timestamp: evt.timestamp, name: displayName, isOwn,
    eventType: 'booking',
    isPrepay: evt.isPrepay ?? false,
    points: evt.points, base: evt.points, multiplier: 1,
    multiplierBreakdown: {}, badgeBonuses: {}, badgeBonusTotal: 0,
    newBadges: evt.badges ?? [],
  };
}

function multActivationToFireteam(evt: MultiplierActivationEvent): FireteamEvent {
  return {
    id: evt.id, timestamp: evt.timestamp, name: evt.name, isOwn: true,
    eventType: 'multiplier',
    isPrepay: false, points: 0, base: 0, multiplier: 1,
    multiplierBreakdown: {}, badgeBonuses: {}, badgeBonusTotal: 0, newBadges: [],
    multiplierId: evt.multiplierId,
    multiplierText: evt.text,
    multiplierColor: evt.color,
    multiplierIcon: evt.icon,
  };
}

// =============================================================================
// PORTAL TOOLTIP WRAPPER
// Positions tooltip at a fixed screen position to avoid scroll container clipping.
//
// KEY FIX: accepts `visible` prop. The position useEffect re-runs whenever
// `visible` flips true, so getBoundingClientRect() is fresh for every hover —
// bottom-of-screen rows correctly pin the tooltip upward instead of clipping.
// =============================================================================

const TOOLTIP_ESTIMATED_HEIGHT = 240;

function PortalTooltip({ anchorRef, children, visible, forceUp = false }: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  visible: boolean;
  forceUp?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; transformY: string } | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();

    const top        = forceUp ? rect.top        : rect.top + rect.height / 2;
    const transformY = forceUp ? '-100%'         : '-50%';

    setPos({ top, left: rect.left - 8, transformY });
  }, [visible, forceUp, anchorRef]);

  if (!pos || !visible) return null;

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: `translate(-100%, ${pos.transformY})`,
        zIndex: 9999,
        pointerEvents: 'none',
        animation: 'ft-tooltip-in 0.15s ease-out both',
      }}
    >
      {children}
    </div>,
    document.body
  );
}

// =============================================================================
// BOOKING TOOLTIP CONTENT
// =============================================================================

function BookingTooltipContent({ event }: { event: FireteamEvent }) {
  const multEntries = Object.entries(event.multiplierBreakdown || {});
  const badgeEntries = Object.entries(event.badgeBonuses || {});
  const ac = event.isPrepay ? OR : CY;

  return (
    <div style={{
      background: 'rgba(0,8,14,0.97)', border: `1px solid ${ac}30`,
      borderRadius: 8, padding: '10px 12px',
      boxShadow: `0 8px 32px rgba(0,0,0,0.85), 0 0 16px ${ac}10`,
      backdropFilter: 'blur(12px)', fontSize: 10, lineHeight: 1.5,
      minWidth: 220, maxWidth: 260,
    }}>
      {/* caret pointing right */}
      <div style={{
        position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)',
        width: 0, height: 0,
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderLeft: `6px solid ${ac}35`,
      }} />
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
  );
}

// =============================================================================
// MULTIPLIER TOOLTIP CONTENT
// =============================================================================

function MultiplierTooltipContent({ event }: { event: FireteamEvent }) {
  const color = event.multiplierColor || CY;
  return (
    <div style={{
      background: 'rgba(0,8,14,0.97)', border: `1px solid ${color}30`,
      borderRadius: 8, padding: '10px 14px',
      boxShadow: `0 8px 32px rgba(0,0,0,0.85), 0 0 12px ${color}12`,
      backdropFilter: 'blur(12px)', fontSize: 10,
      minWidth: 160,
    }}>
      {/* caret pointing right */}
      <div style={{
        position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)',
        width: 0, height: 0,
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderLeft: `6px solid ${color}30`,
      }} />
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
  );
}

// =============================================================================
// BOOKING ROW
// Format: [bar] [time] [Name] [+PTS] [badge icons WHITE] [mult icons GREEN]
// =============================================================================

function BookingRow({ event, index, totalCount }: { event: FireteamEvent; index: number; totalCount: number }) {
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const color = event.isPrepay ? OR : CY;
  const visibleBadges = (event.newBadges || []).slice(0, 3);
  const extraBadges = (event.newBadges || []).length - 3;

  // Multiplier icons from the event's multiplierBreakdown keys
  const multIds = Object.keys(event.multiplierBreakdown || {});

  return (
    <div
      ref={rowRef}
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
      <PortalTooltip anchorRef={rowRef} visible={hovered} forceUp={totalCount - index <= 5}>
        <BookingTooltipContent event={event} />
      </PortalTooltip>

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

      {/* Points */}
      <span style={{
        fontFamily: 'monospace', fontWeight: 900, fontSize: 11, color, flexShrink: 0,
        textShadow: hovered ? `0 0 8px ${color}60` : 'none', transition: 'text-shadow 0.15s',
      }}>
        +{event.points}
      </span>

      {/* Badge icons — WHITE */}
      {visibleBadges.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {visibleBadges.map(id => {
            const icon = getBadgeIcon(id, 13);
            if (!icon) return null;
            return (
              <span
                key={id}
                style={{
                  display: 'inline-flex', lineHeight: 1,
                  filter: 'brightness(0) invert(1)',
                  opacity: 0.9,
                }}
              >
                {icon}
              </span>
            );
          })}
          {extraBadges > 0 && (
            <span style={{ fontSize: 8, color: '#555', fontWeight: 700, marginLeft: 1 }}>+{extraBadges}</span>
          )}
        </div>
      )}

      {/* Multiplier icons — GREEN */}
      {multIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {multIds.slice(0, 3).map(id => {
            const icon = getMultiplierIcon(id, 13);
            if (!icon) return null;
            return (
              <span
                key={id}
                style={{
                  display: 'inline-flex', lineHeight: 1,
                  filter: `drop-shadow(0 0 3px ${GREEN}80) sepia(1) saturate(4) hue-rotate(100deg)`,
                }}
              >
                {icon}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MULTIPLIER ROW
// Shows for ALL teammates, not just own.
// Full text: "Justice N is in a Ghost Town"
// =============================================================================

function MultiplierRow({ event, index, totalCount }: { event: FireteamEvent; index: number; totalCount: number }) {
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const color = event.multiplierColor || CY;
  const multIcon = getMultiplierIcon(event.multiplierId || '', 13);

  return (
    <div
      ref={rowRef}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 5,
        background: hovered ? `${color}06` : 'transparent',
        border: `1px solid ${hovered ? `${color}18` : 'transparent'}`,
        cursor: 'default', transition: 'background 0.15s, border-color 0.15s',
        animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
        minWidth: 0, overflow: 'visible',
        opacity: hovered ? 1 : 0.75,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <PortalTooltip anchorRef={rowRef} visible={hovered} forceUp={totalCount - index <= 5}>
        <MultiplierTooltipContent event={event} />
      </PortalTooltip>

      <div style={{ width: 2, height: 12, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.4 }} />

      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#333', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>

      {/* Full text: "Justice N is in a Ghost Town" */}
      <span style={{
        fontSize: 10,
        color: event.isOwn ? '#7a9ea8' : '#666',
        fontWeight: event.isOwn ? 600 : 400,
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontStyle: 'italic',
      }}>
        {event.multiplierText || `${event.name} activated multiplier`}
      </span>

      {/* Multiplier icon — green tint */}
      <span style={{
        display: 'inline-flex', lineHeight: 1, flexShrink: 0,
        filter: `drop-shadow(0 0 4px ${GREEN}80) sepia(1) saturate(4) hue-rotate(100deg)`,
        fontSize: 12,
      }}>
        {multIcon || <span style={{ filter: 'none' }}>{event.multiplierIcon || '⚡'}</span>}
      </span>
    </div>
  );
}

// =============================================================================
// LOGIN ROW
// =============================================================================

function LoginRow({ event, index }: { event: FireteamEvent; index: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 5,
      background: 'transparent', border: '1px solid transparent',
      animation: `ft-row-in 0.25s ease-out ${Math.min(index * 0.03, 0.3)}s both`,
      minWidth: 0, opacity: 0.45,
    }}>
      <span style={{ fontSize: 7, flexShrink: 0 }}>🟢</span>
      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#333', flexShrink: 0, minWidth: 34 }}>
        {formatTime(event.timestamp)}
      </span>
      <span style={{
        fontSize: 10, fontStyle: 'italic', fontWeight: 500, color: '#3a6a4a',
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

  // Track live multiplier event IDs already inserted so we don't double-render
  // when the Supabase INSERT echoes back the same event we published.
  const liveMultIdSetRef = useRef<Set<string>>(new Set());

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

      const toFE = (evt: any) => teamEventToFireteam(evt, managerId);
      upsertEvents(setGlobalEvents, globalRaw.map(toFE));
      upsertEvents(setFireteamEvents, fireteamRaw.map(toFE));
      setLoading(false);

      // ── GLOBAL channel: all campaigns, all event types ────────────────────
      globalUnsubRef.current = dialerRealtimeService.createIsolatedChannel(
        `ft_panel_global_${campaignId}_${managerId}`,
        { event: 'INSERT', schema: 'public', table: 'dialer_team_events' },
        (row) => {
          // Accept bookings, logins, and multiplier events
          if (!row.is_booking && !row.is_login && !row.is_multiplier) return;

          // Dedupe: if this is a multiplier event from ourselves, it's already
          // in the panel via liveMultiplierEvents; skip to avoid double entry.
          if (row.is_multiplier && row.manager_id === managerId) return;

          const evt = {
            id:           row.id,
            name:         row.manager_name,
            points:       row.points,
            badges:       row.badges || [],
            multipliers:  row.multipliers || [],
            isPrepay:     row.is_prepay || false,
            isLogin:      row.is_login || false,
            isMultiplier: row.is_multiplier || false,
            multiplierId: row.multiplier_id || undefined,
            timestamp:    new Date(row.created_at).getTime(),
            managerId:    row.manager_id,
          };
          upsertEvents(setGlobalEvents, [teamEventToFireteam(evt, managerId)]);
        }
      );

      // ── FIRETEAM channel: current campaign only ───────────────────────────
      fireteamUnsubRef.current = dialerRealtimeService.createIsolatedChannel(
        `ft_panel_fireteam_${campaignId}_${managerId}`,
        {
          event: 'INSERT', schema: 'public', table: 'dialer_team_events',
          filter: `campaign_id=eq.${campaignId}`,
        },
        (row) => {
          // Show bookings from others + multiplier events from everyone (incl own but own is deduped below)
          if (!row.is_booking && !row.is_multiplier) return;

          // For bookings: skip own
          if (row.is_booking && row.manager_id === managerId) return;

          // For multiplier events from ourselves: skip (already in panel via liveMultiplierEvents)
          if (row.is_multiplier && row.manager_id === managerId) return;

          const evt = {
            id:           row.id,
            name:         row.manager_name,
            points:       row.points,
            badges:       row.badges || [],
            multipliers:  row.multipliers || [],
            isPrepay:     row.is_prepay || false,
            isLogin:      false,
            isMultiplier: row.is_multiplier || false,
            multiplierId: row.multiplier_id || undefined,
            timestamp:    new Date(row.created_at).getTime(),
            managerId:    row.manager_id,
          };
          upsertEvents(setFireteamEvents, [teamEventToFireteam(evt, managerId)]);
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

    const filtered = activeTab === 'fireteam'
      ? bookings.filter(e => e.eventType !== 'login')
      : bookings;

    // liveMultiplierEvents = own activations shown instantly (before DB round-trip)
    const liveMultFEs = liveMultiplierEvents.map(multActivationToFireteam);

    // Merge: live events go in keyed by their id; DB channel skips own multipliers
    const allEvents = new Map<string, FireteamEvent>();
    for (const e of filtered) allEvents.set(e.id, e);
    for (const e of liveMultFEs) allEvents.set(e.id, e);

    return Array.from(allEvents.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  const displayEvents = buildDisplayEvents();

  return (
    <>
      <style>{PANEL_STYLES}</style>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'visible' }}>

        {/* Tab header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '3px 8px 0', flexShrink: 0,
          borderTop: `1px solid ${CY}08`,
        }}>
          {(['global', 'fireteam'] as FeedTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, background: 'transparent', border: 'none',
                borderBottom: activeTab === tab ? `1.5px solid ${CY}` : '1.5px solid transparent',
                padding: '3px 4px 4px', cursor: 'pointer', transition: 'border-color 0.2s ease',
              }}
            >
              <span style={{
                fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: CY,
                opacity: activeTab === tab ? 0.8 : 0.25,
                textTransform: 'uppercase' as const, fontFamily: 'monospace',
                transition: 'opacity 0.2s ease',
              }}>
                {tab.toUpperCase()}
              </span>
            </button>
          ))}

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
              if (evt.eventType === 'multiplier') return <MultiplierRow key={evt.id} event={evt} index={i} totalCount={displayEvents.length} />;
              return <BookingRow key={evt.id} event={evt} index={i} totalCount={displayEvents.length} />;
            })
          )}
        </div>
      </div>
    </>
  );
}