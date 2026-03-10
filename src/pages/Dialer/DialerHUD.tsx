// src/pages/Dialer/DialerHUD.tsx
//
// Metroid Prime-inspired visor HUD for the AutoSniper dialer.
// Top: auto-fire toggle | multiplier tiles (centered) | total mult + menu
// Bottom: stats + big points counter with energy bar
//
// CALM MODE (managerId === 'ROBA'):
// - No multiplier tiles, no points counter, no streak, no total mult badge
// - No team feed toasts, no multiplier activation toasts
// - Bottom bar shows PB / PP / PP$ in pink only
// - A motivational panel replaces the right side — dark bg, soft pink glow border
// - Messages react to each disposition and stay until the next
// - Messages use "Rosh", 100+ unique messages, no consecutive repeats
//

import { useState, useEffect, useRef } from 'react';
import type { GamificationSession, MultiplierSnapshot, Rank } from '../../lib/dialer/gamificationDefs';
import { getMultiplierIcon, getMultiplierTierIcon, getBadgeIcon } from './BadgeIcons';

// =============================================================================
// CALM MODE
// =============================================================================

const CALM_MODE_USER = 'ROBA';
const CALM_PINK = '#ff6eb4';

// =============================================================================
// EXPORTED TYPES
// =============================================================================

export interface TeamBookingEvent {
  id: string;
  name: string;
  points: number;
  badges?: string[];
  multipliers?: string[];
  timestamp: number;
  isPrepay?: boolean;
}

export interface MultiplierActivationEvent {
  id: string;
  multiplierId: string;
  name: string;
  text: string;
  icon: string;
  color: string;
  timestamp: number;
}

export type HUDMenuAction = 'campaigns' | 'team' | 'achievements' | 'scope' | 'reset';

interface HUDProps {
  session: GamificationSession | null;
  activeMultipliers: MultiplierSnapshot[];
  multipliersReceivedAt: number;
  rank: Rank | null;
  onMenuAction?: (action: HUDMenuAction) => void;
  onTrophyClick: () => void;
  onPointsClick?: () => void;
  teamFeed?: TeamBookingEvent[];
  multiplierActivations?: MultiplierActivationEvent[];
  autoFire?: boolean;
  onAutoFireChange?: (v: boolean) => void;
  /** Manager's repCode — 'ROBA' triggers calm mode */
  managerId?: string;
  /** Last disposition type — drives motivational panel context */
  lastDispType?: string;
  /** Consecutive YES from last disposition result */
  consecutiveYes?: number;
  /** Consecutive NOs from last disposition result */
  consecutiveNos?: number;
}

// =============================================================================
// THEME
// =============================================================================

const CY = '#00e5ff';
const OR = '#f5a623';

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
  exhumer:        { color: '#6c3483', glow: 'rgba(108,52,131,0.5)' },
};

const MULT_DESC: Record<string, string> = {
  op_tempo: '2+ YES streak → +0.2x, grows per level. 20min timer.',
  tracer_rounds: '2+ prepay streak → +0.2x, grows +0.2x. 20min timer.',
  high_ground: '+1.0x while on same street as last YES.',
  night_vision: '+0.2x per booking after 8pm. Stacks.',
  blitz: '5 bookings in 20/40/60min → 2.0x/1.5x/1.0x.',
  enraged: '3 rejections → tiered bonus. Consumed on YES.',
  ratio_focus: 'PP ratio ≥ 20% → ratio becomes multiplier.',
  war_machine: '50+ dials/hr sustained → +0.5x.',
  ghost_town: '10 unreached → 0.5x (3 charges).',
  cold_streak: '20 dials without YES → +1.0x (2 charges).',
  scorched_earth: 'Clear a street → 1.1x-3.0x, 5 charges.',
  indoctrinate: 'Convert a non-app client → badge bonuses get multiplied for 2 bookings.',
  exhumer: '20 WN/NIS, NO, or REMOVE on 2020–2022 clients → next booking doubles final total.',
};

const MENU_ITEMS: { id: HUDMenuAction; icon: string; label: string; desc: string }[] = [
  { id: 'campaigns',    icon: '🗺️', label: 'CAMPAIGNS',    desc: 'Back to map select' },
  { id: 'team',         icon: '👥', label: 'TEAM STATS',    desc: 'Live team feed' },
  { id: 'achievements', icon: '🏆', label: 'ACHIEVEMENTS',  desc: 'Badges & progress' },
  { id: 'scope',        icon: '🎯', label: 'ADJUST SCOPE',  desc: 'Sniper filter config' },
  { id: 'reset',        icon: '🔄', label: 'RESET SESSION', desc: 'Reset all counters' },
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
  @keyframes hud-exhumer-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(108,52,131,0.2), inset 0 0 12px rgba(108,52,131,0.05); }
    50% { box-shadow: 0 0 22px rgba(108,52,131,0.6), inset 0 0 16px rgba(108,52,131,0.15); }
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
  @keyframes hud-mult-toast-in {
    0% { transform: translateX(110%); opacity: 0; }
    65% { transform: translateX(-3%); opacity: 1; }
    100% { transform: translateX(0); opacity: 1; }
  }
  @keyframes hud-mult-toast-out {
    0% { transform: translateX(0); opacity: 1; max-height: 40px; margin-bottom: 4px; }
    100% { transform: translateX(110%); opacity: 0; max-height: 0; margin-bottom: 0; }
  }
  @keyframes calm-msg-in {
    0% { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes calm-glow-pulse {
    0%, 100% { box-shadow: 0 0 12px rgba(255,110,180,0.08), inset 0 0 24px rgba(255,110,180,0.03); }
    50% { box-shadow: 0 0 26px rgba(255,110,180,0.20), inset 0 0 32px rgba(255,110,180,0.07); }
  }
`;

// =============================================================================
// MOTIVATIONAL MESSAGES — 100+ across 10 contexts
// =============================================================================

const CALM_MESSAGES: Record<string, string[]> = {
  idle: [
    "You've got this, Rosh. One call at a time.",
    "Ready when you are, Rosh. Let's have a great day.",
    "Every dial is a chance, Rosh. Make it count.",
    "Start strong, Rosh. The first yes is closer than you think.",
    "Take a breath. You're exactly where you need to be, Rosh.",
    "The phone's warm, Rosh. Let's go find some yeses.",
    "Good things happen to people who keep dialing, Rosh.",
    "You've done this before, Rosh. You know how to find the yes.",
    "Today is a fresh start, Rosh. Let's make it a good one.",
    "Calm, focused, ready. That's you, Rosh.",
  ],
  yes_generic: [
    "Yes! That's what we're here for, Rosh! 🌸",
    "There it is! Keep that energy going, Rosh!",
    "Booking confirmed, Rosh. That client is lucky to have you.",
    "Beautiful work, Rosh. One more for the team.",
    "That's the one! You made someone's lawn look amazing today.",
    "Yes! You did that, Rosh. Now let's get another.",
    "Rosh, that booking was all skill. Keep going!",
    "That's how it's done. One yes at a time, Rosh.",
    "Locked in! You're on a roll, Rosh.",
    "Another booking in the books. You're doing great, Rosh.",
    "That client said yes because you were confident, Rosh. Keep it up.",
    "Look at you go, Rosh! That's another win.",
    "Yes! The work pays off, Rosh. Keep dialing.",
    "You turned that call into a booking. That takes talent, Rosh.",
    "Rosh, that was smooth. Let's find the next one.",
  ],
  yes_prepay: [
    "Prepay! That's the gold standard, Rosh! 💛",
    "They paid upfront, Rosh. That's trust. You earned that.",
    "Prepay secured! You're doing incredible, Rosh.",
    "Cash in hand before the job even starts. That's Rosh magic! ✨",
    "Prepay! They loved what you said, Rosh. Keep talking like that.",
    "That prepay means they believe in you, Rosh. And they should.",
    "Gold star booking, Rosh. Prepay on the board!",
    "Prepay! You made that sound so easy, Rosh.",
    "They trusted you enough to pay today. That's not nothing, Rosh.",
    "Another prepay! Rosh, you're building something real today.",
    "Prepay in the bag. You're the real deal, Rosh.",
    "That prepay is all confidence, Rosh. They heard it in your voice.",
    "Locked in with prepay! You're on fire today, Rosh.",
    "Prepay! Rosh, you should feel proud of that one.",
    "They paid today because of you, Rosh. Remember that.",
  ],
  yes_headhunter: [
    "New street, new booking! You're a pioneer, Rosh! 🗺️",
    "Rosh, you just opened a street we hadn't touched. That's huge.",
    "Brand new territory, brand new yes. That's all you, Rosh!",
    "You're doing great on a street where we didn't have a booking before, Rosh!",
    "First booking on this street! Rosh, you're breaking new ground.",
    "That was a cold call on a fresh street and you made it happen, Rosh.",
    "New street booking! You're expanding the map, Rosh.",
    "Rosh, that client probably never heard our pitch before. And they said yes.",
    "Headhunter! You found a yes where there wasn't one before, Rosh.",
    "That booking put us on a street we hadn't been on. Rosh, that's meaningful.",
    "One more yes on a street where we didn't have a booking before! 🌸",
    "New street, new win. You're doing amazing, Rosh.",
  ],
  yes_raise_dead: [
    "You brought a dormant client back to life, Rosh! That's something special. 🌱",
    "They hadn't booked in years and you changed that. Only Rosh can do that.",
    "Old client, fresh booking. You have a gift, Rosh.",
    "That client was inactive for a long time. You made the difference today, Rosh.",
    "Rosh, you just revived someone who had given up on lawn care. That's special.",
    "Dormant client is dormant no more. Rosh, you're amazing at this.",
    "They hadn't called in years and you got the yes. Don't underestimate yourself, Rosh.",
    "That was a tough one — they'd been gone a long time. And you made it happen, Rosh.",
    "Old clients are hard. You made it look easy, Rosh.",
    "Rosh, that booking came from a client who was long gone. You brought them back.",
    "Some reps walk past those old clients. You dialed and got the yes. That's you, Rosh.",
  ],
  yes_streak: [
    "Rosh, you're on a streak! They can't stop you right now! 🔥",
    "Back to back yeses! You're locked in, Rosh.",
    "Two in a row! Rosh, something special is happening today.",
    "Streak! Your confidence is through the roof right now, Rosh.",
    "You're stringing them together, Rosh. This is your moment.",
    "Multiple yeses in a row — Rosh, this is what it looks like when you're in your zone.",
    "Rosh, you're rolling! Keep the energy, keep dialing.",
    "The streak continues! You're unstoppable right now, Rosh.",
    "Back to back! Rosh, this is incredible.",
    "You've found your rhythm, Rosh. Don't break it — keep dialing.",
    "Rosh, this is what a great session looks like. Keep going.",
    "You're on a run, Rosh. Ride this wave as long as you can.",
  ],
  no_single: [
    "No's are part of the job, Rosh. The next call could be the yes.",
    "One no just means the yes is closer. Keep dialing, Rosh.",
    "They said no, but you showed up. That's what matters, Rosh.",
    "Not every call is a yes — and that's okay, Rosh. On to the next.",
    "Shake it off, Rosh. The next number is waiting for you.",
    "A no just means not yet. Keep going, Rosh.",
    "Everyone gets no's, Rosh. It's what you do after that counts.",
    "One no in the books. You're still in this, Rosh.",
    "That one didn't land, but you're still dialing. That's the mindset, Rosh.",
    "No's don't count. Only yeses do. Keep building, Rosh.",
    "Rosh, every great session has no's in it. You're still on track.",
    "Put that one behind you. The next call is fresh, Rosh.",
    "Don't carry it. One call at a time, Rosh.",
    "That's okay, Rosh. Next number, fresh energy.",
    "The no is gone. The next yes is still out there, Rosh.",
  ],
  no_streak: [
    "I know you're in a patch of no's right now, but keep dialing — you'll find your yes! 💕",
    "It's a rough stretch, Rosh, but this is exactly when the yes is coming. Keep going.",
    "Rosh, no streaks end with another no. They end with a yes. You're close.",
    "I know this part is hard, Rosh. But every one of those no's is bringing you closer.",
    "Don't let it get to you, Rosh. You've broken through patches like this before.",
    "Tough stretch, Rosh. But you're still here, still dialing. That's everything.",
    "The next call doesn't know about the last few. Start fresh, Rosh.",
    "Rosh, you're doing exactly what you're supposed to do. Keep pushing through.",
    "These streaks happen to everyone. The reps who break through don't stop — like you, Rosh.",
    "You're in the dip, Rosh. The other side is a yes. Don't quit now.",
    "I believe in you, Rosh. This stretch won't last forever.",
    "Keep your head up. The next yes could be one dial away, Rosh.",
    "Rosh, you have a yes in you. Let's find it together.",
    "This is the hard part. You've handled hard before, Rosh.",
    "Don't measure yourself by the no's, Rosh. Measure by the fact that you kept going.",
  ],
  wn_nis: [
    "Wrong number — onto the next one, Rosh. The real number is out there.",
    "Not in service — no worries, Rosh. Next!",
    "That one wasn't meant to be. The next call is, Rosh.",
    "NIS — you can't control the list, Rosh. Just keep dialing.",
    "Wrong number, fresh dial. You're still moving forward, Rosh.",
    "Not every number works out. Yours are coming, Rosh.",
    "WN/NIS — just clear the deck and move on, Rosh.",
    "That one's out of your hands. On to the ones that aren't, Rosh.",
    "Sometimes the list just does that. Keep going, Rosh.",
    "Disconnected line, but you're not disconnecting. Good, Rosh.",
    "That number was never going to be a yes. Next one might be, Rosh.",
    "Quick clear, fresh start. That's the rhythm, Rosh.",
  ],
  remove: [
    "Cleared that one — keeping the list clean, Rosh. Good call.",
    "Remove done. You made the right call, Rosh.",
    "That client's off the list. Next one might be the yes, Rosh.",
    "Sometimes remove is the right move. Onto the next, Rosh.",
    "Clear the dead weight, Rosh. The good calls are still out there.",
    "Remove — you read that right, Rosh. On to better numbers.",
    "Gone. The list is cleaner now, and so is your focus, Rosh.",
    "That one's behind you now. The next number is your chance, Rosh.",
    "Rosh, knowing when to remove is a skill. You've got it.",
    "Clean it up and keep moving. That's the way, Rosh.",
  ],
};

const lastMsgIndex: Record<string, number> = {};

function getCalmMessage(context: string): string {
  const pool = CALM_MESSAGES[context] || CALM_MESSAGES.idle;
  const last = lastMsgIndex[context] ?? -1;
  let idx = Math.floor(Math.random() * pool.length);
  if (pool.length > 2 && idx === last) idx = (idx + 1) % pool.length;
  lastMsgIndex[context] = idx;
  return pool[idx];
}

function dispToContext(
  disp: string,
  consecutiveYes: number,
  consecutiveNos: number,
  isPrepay: boolean,
): string {
  if (!disp) return 'idle';
  if (disp === 'COMPLETE' || disp === 'PREPAY') {
    if (isPrepay) return 'yes_prepay';
    if (consecutiveYes >= 2) return 'yes_streak';
    return 'yes_generic';
  }
  if (disp === 'REMOVE') return 'remove';
  if (disp === 'NO') return consecutiveNos >= 3 ? 'no_streak' : 'no_single';
  if (disp === 'WN/NIS') return 'wn_nis';
  if (disp === 'NA' || disp === 'CTS') return 'no_single';
  return 'idle';
}

// =============================================================================
// CALM MOTIVATIONAL PANEL
// =============================================================================

function MotivationalPanel({
  lastDispType,
  consecutiveYes,
  consecutiveNos,
}: {
  lastDispType?: string;
  consecutiveYes: number;
  consecutiveNos: number;
}) {
  const [message, setMessage] = useState(() => getCalmMessage('idle'));
  const [msgKey, setMsgKey] = useState(0);
  const prevDisp = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!lastDispType || lastDispType === prevDisp.current) return;
    prevDisp.current = lastDispType;
    const ctx = dispToContext(lastDispType, consecutiveYes, consecutiveNos, lastDispType === 'PREPAY');
    setMessage(getCalmMessage(ctx));
    setMsgKey(k => k + 1);
  }, [lastDispType, consecutiveYes, consecutiveNos]);

  return (
    <div style={{
      position: 'relative',
      width: 260,
      minHeight: 52,
      borderRadius: 10,
      background: 'rgba(10, 4, 10, 0.90)',
      border: `1px solid rgba(255,110,180,0.22)`,
      padding: '10px 14px 10px 18px',
      display: 'flex',
      alignItems: 'center',
      animation: 'calm-glow-pulse 4s ease-in-out infinite',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute',
        left: 0, top: '15%', bottom: '15%',
        width: 3, borderRadius: 2,
        background: `linear-gradient(to bottom, transparent, ${CALM_PINK}, transparent)`,
        opacity: 0.65,
      }} />
      <p
        key={msgKey}
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 500,
          color: '#f0d0e0',
          lineHeight: 1.6,
          letterSpacing: '0.2px',
          fontFamily: '"Segoe UI", Arial, sans-serif',
          animation: 'calm-msg-in 0.5s ease-out both',
        }}
      >
        {message}
      </p>
      <div style={{
        position: 'absolute', bottom: -8, right: -8,
        width: 50, height: 50, borderRadius: '50%',
        background: `radial-gradient(circle, ${CALM_PINK}15, transparent 70%)`,
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function formatCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function getTheme(id: string) {
  return MULT_THEME[id] || { color: CY, glow: `${CY}40` };
}

function MultiplierIconDisplay({ m, size = 14 }: { m: MultiplierSnapshot; size?: number }) {
  const tier = (m.extra as any)?.tier;
  let icon = null as React.ReactNode;
  if (tier !== undefined && tier > 0) icon = getMultiplierTierIcon(m.id, tier - 1, size);
  if (!icon) icon = getMultiplierIcon(m.id, size);
  if (icon) return <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>;
  return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{(m as any).icon}</span>;
}

// =============================================================================
// MULTIPLIER STRIP
// =============================================================================

function MultiplierStrip({ multipliers, receivedAt }: { multipliers: MultiplierSnapshot[]; receivedAt: number }) {
  const [, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const hasTimed = multipliers.some(m => m.expiresIn > 0);
    if (hasTimed) timerRef.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [multipliers]);

  if (!multipliers.length) return null;

  const now = Date.now();
  const elapsed = now - receivedAt;
  const TILE = 48;

  return (
    <div style={{ display: 'flex', gap: 6, overflow: 'visible', paddingBottom: 8, paddingTop: 4 }}>
      {multipliers.map((m, idx) => {
        const remainingMs = m.expiresIn > 0 ? m.expiresIn - elapsed : m.expiresIn;
        if (m.expiresIn > 0 && remainingMs <= 0) return null;
        const countdown = formatCountdown(remainingMs);
        const theme = getTheme(m.id);
        const charges = (m.extra as any)?.charges;
        const isEnraged = m.id === 'enraged';
        const isScorched = m.id === 'scorched_earth';
        const isExhumer = m.id === 'exhumer';
        const isHovered = hoveredId === m.id;
        const shadowRest = `0 2px 8px rgba(0,0,0,0.6), 0 0 6px ${theme.color}20`;
        const shadowBreathe = `0 2px 12px rgba(0,0,0,0.6), 0 0 14px ${theme.color}40`;

        return (
          <div
            key={m.id}
            onMouseEnter={() => setHoveredId(m.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ flexShrink: 0, position: 'relative' }}
          >
            <div style={{
              width: TILE, height: TILE, borderRadius: 8,
              background: `radial-gradient(ellipse at 30% 30%, ${theme.color}15, rgba(0,14,22,0.95) 70%)`,
              border: `1.5px solid ${theme.color}${isHovered ? '90' : '40'}`,
              position: 'relative', overflow: 'hidden', cursor: 'default',
              transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
              transform: isHovered ? 'scale(1.12) translateY(-2px)' : 'scale(1)',
              ['--tile-shadow-rest' as any]: shadowRest,
              ['--tile-shadow-breathe' as any]: shadowBreathe,
              animation: isEnraged
                ? 'hud-enraged-pulse 1.2s ease-in-out infinite'
                : isScorched ? 'hud-scorched-pulse 2s ease-in-out infinite'
                : isExhumer ? 'hud-exhumer-pulse 1.8s ease-in-out infinite'
                : `hud-tile-enter 0.45s cubic-bezier(0.34,1.56,0.64,1) ${idx * 0.07}s both, hud-tile-breathe 4s ease-in-out ${idx * 0.5}s infinite`,
              boxShadow: isHovered ? `0 4px 20px rgba(0,0,0,0.7), 0 0 20px ${theme.color}50` : shadowRest,
            }}>
              <div style={{
                position: 'absolute', bottom: 0, left: '10%', right: '10%', height: 2,
                background: `linear-gradient(to right, transparent, ${theme.color}60, transparent)`,
                borderRadius: 1,
              }} />
              <div style={{
                position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
                width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0.75,
              }}>
                <MultiplierIconDisplay m={m} size={20} />
              </div>
              {countdown ? (
                <div style={{
                  position: 'absolute', bottom: 3, left: 0, right: 0,
                  textAlign: 'center', fontSize: 7, fontWeight: 800,
                  color: theme.color, opacity: 0.8, fontFamily: 'monospace',
                  letterSpacing: '0.5px',
                }}>
                  {countdown}
                </div>
              ) : charges !== undefined ? (
                <div style={{
                  position: 'absolute', bottom: 3, left: 0, right: 0,
                  textAlign: 'center', fontSize: 8, fontWeight: 900,
                  color: theme.color, opacity: 0.9, fontFamily: 'monospace',
                }}>
                  ×{charges}
                </div>
              ) : (
                <div style={{
                  position: 'absolute', bottom: 3, left: 0, right: 0,
                  textAlign: 'center', fontSize: 8, fontWeight: 900,
                  color: theme.color, opacity: 0.9, fontFamily: 'monospace',
                  letterSpacing: '0.5px',
                }}>
                  +{m.value}x
                </div>
              )}
            </div>

            {isHovered && (
              <div style={{
                position: 'absolute', bottom: '110%', left: '50%',
                transform: 'translateX(-50%)',
                width: 160, zIndex: 100,
                background: 'rgba(0,8,14,0.97)',
                border: `1px solid ${theme.color}40`,
                borderRadius: 8,
                padding: '10px 12px',
                boxShadow: `0 4px 24px rgba(0,0,0,0.9), 0 0 12px ${theme.color}20`,
                animation: 'hud-tooltip-in 0.2s ease-out both',
                pointerEvents: 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <MultiplierIconDisplay m={m} size={12} />
                  <span style={{ fontSize: 9, fontWeight: 900, color: theme.color, letterSpacing: '1px', textTransform: 'uppercase' }}>
                    {m.name}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: '#888', lineHeight: 1.5 }}>
                  {MULT_DESC[m.id] || ''}
                </div>
                {(m.extra as any)?.doublesFinalScore && (
                  <div style={{ marginTop: 6, fontSize: 9, fontWeight: 900, color: '#c39', letterSpacing: '0.5px' }}>
                    ⚡ DOUBLES FINAL TOTAL
                  </div>
                )}
                <div style={{
                  position: 'absolute', bottom: -5, left: '50%',
                  transform: 'translateX(-50%) rotate(45deg)',
                  width: 8, height: 8,
                  background: 'rgba(0,8,14,0.97)',
                  border: `1px solid ${theme.color}40`,
                  borderTop: 'none', borderLeft: 'none',
                }} />
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

interface TeamToastItem extends TeamBookingEvent {
  exiting?: boolean;
}

function TeamFeedToasts({ events }: { events: TeamBookingEvent[] }) {
  const [toasts, setToasts] = useState<TeamToastItem[]>([]);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    for (const ev of events) {
      if (seenRef.current.has(ev.id)) continue;
      seenRef.current.add(ev.id);
      setToasts(prev => [...prev.slice(-4), { ...ev }]);
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === ev.id ? { ...t, exiting: true } : t));
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== ev.id));
        }, 400);
      }, 5000);
    }
  }, [events]);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', right: 12, top: 46,
      zIndex: 90, display: 'flex', flexDirection: 'column', gap: 4,
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: 'rgba(0,14,22,0.95)',
          border: `1px solid ${toast.isPrepay ? 'rgba(241,196,15,0.5)' : 'rgba(46,204,113,0.4)'}`,
          borderRadius: 8, maxHeight: 44,
          boxShadow: `0 4px 16px rgba(0,0,0,0.7), 0 0 10px ${toast.isPrepay ? 'rgba(241,196,15,0.2)' : 'rgba(46,204,113,0.2)'}`,
          animation: toast.exiting ? 'hud-team-toast-out 0.4s ease-in both' : 'hud-team-toast-in 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 12 }}>{toast.isPrepay ? '💳' : '📋'}</span>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.5px' }}>
              {toast.name}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: toast.isPrepay ? '#f1c40f' : '#2ecc71',
              marginLeft: 6,
              animation: 'hud-team-points-pop 0.4s ease-out both',
              display: 'inline-block',
            }}>
              +{toast.points}
            </span>
          </div>
          {toast.badges && toast.badges.length > 0 && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              {toast.badges.slice(0, 3).map(b => {
                const icon = getBadgeIcon(b, 12);
                return icon ? (
                  <span key={b} style={{ display: 'inline-flex' }}>{icon}</span>
                ) : null;
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MULTIPLIER ACTIVATION TOASTS
// =============================================================================

interface MultToastItem extends MultiplierActivationEvent {
  exiting?: boolean;
}

function MultiplierActivationToasts({ events }: { events: MultiplierActivationEvent[] }) {
  const [toasts, setToasts] = useState<MultToastItem[]>([]);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    for (const ev of events) {
      if (seenRef.current.has(ev.id)) continue;
      seenRef.current.add(ev.id);
      setToasts(prev => [...prev.slice(-3), { ...ev }]);
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === ev.id ? { ...t, exiting: true } : t));
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== ev.id));
        }, 500);
      }, 4000);
    }
  }, [events]);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', right: 12, bottom: 60,
      zIndex: 89, display: 'flex', flexDirection: 'column', gap: 4,
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: 'rgba(0,10,18,0.96)',
          border: `1px solid ${toast.color}50`,
          borderRadius: 8, maxHeight: 40,
          boxShadow: `0 4px 16px rgba(0,0,0,0.7), 0 0 8px ${toast.color}25`,
          animation: toast.exiting ? 'hud-mult-toast-out 0.5s ease-in both' : 'hud-mult-toast-in 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 14, animation: 'hud-mult-icon-pop 0.4s ease-out both' }}>{toast.icon}</span>
          <div style={{ fontSize: 10, fontWeight: 800, color: toast.color, letterSpacing: '0.5px' }}>
            {toast.name}
          </div>
          <div style={{ fontSize: 8, color: '#666', fontWeight: 600 }}>{toast.text}</div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN HUD
// =============================================================================

export default function DialerHUD({
  session,
  activeMultipliers,
  multipliersReceivedAt,
  rank,
  onMenuAction,
  onTrophyClick,
  onPointsClick,
  teamFeed = [],
  multiplierActivations = [],
  autoFire = false,
  onAutoFireChange,
  managerId,
  lastDispType,
  consecutiveYes = 0,
  consecutiveNos = 0,
}: HUDProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredMenu, setHoveredMenu] = useState<HUDMenuAction | null>(null);
  const [ptsBurst, setPtsBurst] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const prevPtsRef = useRef(0);

  const isCalm = managerId === CALM_MODE_USER;

  // Burst animation when points change
  useEffect(() => {
    if (isCalm) return;
    const pts = session?.totalSessionPoints || 0;
    if (pts !== prevPtsRef.current && pts > 0) {
      prevPtsRef.current = pts;
      setPtsBurst(true);
      setTimeout(() => setPtsBurst(false), 700);
    }
  }, [session?.totalSessionPoints, isCalm]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const pts = session?.totalSessionPoints || 0;
  const streak = session?.consecutiveYes || 0;
  const pbs = session?.pbs || 0;
  const pps = session?.pps || 0;
  const ppd = session?.ppDollars || 0;
  const dials = session?.totalDials || 0;
  const upsells = session?.upsells || 0;
  const totalMult = activeMultipliers.reduce((s, m) => s + m.value, 0) + 1;

  return (
    <>
      <style>{HUD_STYLES}</style>

      {/* ===== TOP HUD BAR ===== */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 38,
        background: 'rgba(0,14,22,0.92)',
        borderBottom: `1px solid rgba(0,229,255,0.12)`,
        display: 'flex', alignItems: 'center',
        padding: '0 10px',
        zIndex: 80,
        backdropFilter: 'blur(8px)',
      }}>
        {/* Left: auto-fire toggle */}
        <div style={{ flexShrink: 0 }}>
          <button
            onClick={() => onAutoFireChange?.(!autoFire)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 8px', borderRadius: 5,
              background: autoFire ? 'rgba(231,76,60,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${autoFire ? 'rgba(231,76,60,0.5)' : 'rgba(255,255,255,0.08)'}`,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 10 }}>📞</span>
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '1.5px',
              color: autoFire ? '#e74c3c' : '#444', textTransform: 'uppercase',
            }}>
              AUTO
            </span>
          </button>
        </div>

        {/* Center: multiplier tiles (hidden for ROBA) */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          {!isCalm && (
            <MultiplierStrip multipliers={activeMultipliers} receivedAt={multipliersReceivedAt} />
          )}
        </div>

        {/* Right: total multiplier + menu */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }} ref={menuRef}>
          {/* Total mult badge — hidden for ROBA */}
          {!isCalm && activeMultipliers.length > 0 && (
            <div style={{
              padding: '3px 10px', borderRadius: 5,
              background: 'rgba(0,229,255,0.06)',
              border: `1px solid rgba(0,229,255,0.25)`,
              fontSize: 10, fontWeight: 900,
              color: CY, letterSpacing: '0.5px', fontFamily: 'monospace',
            }}>
              {totalMult.toFixed(2)}×
            </div>
          )}

          {/* Menu button */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: menuOpen ? 'rgba(0,229,255,0.10)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${menuOpen ? 'rgba(0,229,255,0.40)' : 'rgba(255,255,255,0.08)'}`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3, cursor: 'pointer', padding: 0,
              transition: 'all 0.15s ease',
            }}
          >
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 12, height: 1.5, borderRadius: 1,
                background: menuOpen ? CY : '#555',
                transition: 'background 0.15s ease',
              }} />
            ))}
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 42, right: 10, zIndex: 200,
              background: 'rgba(0,8,16,0.98)',
              border: `1px solid rgba(0,229,255,0.20)`,
              borderRadius: 10,
              padding: '6px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,255,0.06)',
              minWidth: 190,
              animation: 'hud-menu-slide 0.2s ease-out both',
            }}>
              {MENU_ITEMS.map((item, idx) => (
                <button
                  key={item.id}
                  onMouseEnter={() => setHoveredMenu(item.id)}
                  onMouseLeave={() => setHoveredMenu(null)}
                  onClick={() => {
                    setMenuOpen(false);
                    onMenuAction?.(item.id);
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 7,
                    background: hoveredMenu === item.id ? 'rgba(0,229,255,0.07)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    transition: 'background 0.1s ease',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                  <div>
                    <div style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '1.5px',
                      color: hoveredMenu === item.id ? CY : '#bbb',
                      textTransform: 'uppercase',
                    }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 8, color: '#444', marginTop: 1 }}>{item.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== BOTTOM HUD BAR ===== */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 48,
        background: 'rgba(0,10,18,0.93)',
        borderTop: `1px solid rgba(0,229,255,0.10)`,
        display: 'flex', alignItems: 'center',
        padding: '0 12px',
        zIndex: 80,
        backdropFilter: 'blur(8px)',
        gap: 12,
      }}>
        {isCalm ? (
          /* ---- CALM MODE BOTTOM BAR ---- */
          <>
            {/* PB / PP / PP$ in pink */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              <CalmStat label="PB"  value={pbs} />
              <CalmStat label="PP"  value={pps} />
              <CalmStat label="PP$" value={`$${ppd}`} />
              {upsells > 0 && <CalmStat label="UPS" value={upsells} />}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Motivational panel on the right */}
            <MotivationalPanel
              lastDispType={lastDispType}
              consecutiveYes={consecutiveYes}
              consecutiveNos={consecutiveNos}
            />
          </>
        ) : (
          /* ---- NORMAL MODE BOTTOM BAR ---- */
          <>
            {/* Rank badge */}
            {rank && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                flexShrink: 0, cursor: 'pointer',
              }} onClick={onTrophyClick}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{rank.icon}</span>
                <span style={{
                  fontSize: 6, fontWeight: 800, letterSpacing: '1.5px',
                  color: rank.color, textTransform: 'uppercase', marginTop: 1,
                }}>
                  {rank.name}
                </span>
              </div>
            )}

            {/* Divider */}
            {rank && <div style={{ width: 1, height: 24, background: `rgba(0,229,255,0.12)`, flexShrink: 0 }} />}

            {/* Stats */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <StatPill label="PB"    value={pbs}  color="#2ecc71" />
              <StatPill label="PP"    value={pps}  color="#f1c40f" />
              <StatPill label="PP$"   value={`$${ppd}`} color="#e67e22" />
              <StatPill label="DIALS" value={dials} color="#3498db" />
              {upsells > 0 && <StatPill label="UPS" value={upsells} color="#f1c40f" />}
            </div>

            <div style={{ width: 1, height: 24, background: `rgba(0,229,255,0.08)`, flexShrink: 0 }} />

            {/* Streak */}
            {streak >= 2 && (
              <div style={{ flexShrink: 0 }}>
                <span style={{
                  fontSize: 11, fontWeight: 900, color: OR,
                  fontFamily: 'monospace', letterSpacing: '1px',
                  animation: 'hud-streak-pulse 1.5s ease-in-out infinite',
                  display: 'inline-block',
                }}>
                  🔥×{streak}
                </span>
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Points counter */}
            <div
              onClick={onPointsClick}
              style={{ cursor: onPointsClick ? 'pointer' : 'default', flexShrink: 0 }}
            >
              <span style={{
                fontSize: 20, fontWeight: 900, color: CY,
                fontFamily: 'monospace', letterSpacing: '2px',
                animation: ptsBurst ? 'hud-pts-burst 0.7s ease-out' : undefined,
                display: 'inline-block',
              }}>
                {pts.toLocaleString()}
              </span>
              <span style={{ fontSize: 8, color: CY, opacity: 0.4, letterSpacing: '1.5px', marginLeft: 4 }}>
                PTS
              </span>
            </div>
          </>
        )}
      </div>

      {/* Team feed toasts — only for normal users */}
      {!isCalm && <TeamFeedToasts events={teamFeed} />}

      {/* Multiplier activation toasts — only for normal users */}
      {!isCalm && <MultiplierActivationToasts events={multiplierActivations} />}
    </>
  );
}

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 28 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>
        {value}
      </span>
      <span style={{
        fontSize: 6, fontWeight: 800, color, opacity: 0.45,
        letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1,
      }}>
        {label}
      </span>
    </div>
  );
}

function CalmStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
      <span style={{ fontSize: 14, fontWeight: 900, color: CALM_PINK, lineHeight: 1, fontFamily: 'monospace' }}>
        {value}
      </span>
      <span style={{
        fontSize: 6, fontWeight: 800, color: CALM_PINK, opacity: 0.55,
        letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1,
      }}>
        {label}
      </span>
    </div>
  );
}