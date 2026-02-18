// src/pages/Dialer/AchievementsPanel.tsx
//
// Full-screen achievements overlay — trophy button opens this.
// Shows session stats, badge grid (earned/locked), multiplier guide, recent bookings.
// War Room 2.0 — game-icons.net SVG icons with pulse glow effects.
//

import { useState } from 'react';
import { X, Phone, Target, DollarSign, Zap, Award, Trophy } from 'lucide-react';
import { BADGE_DEFS, MULTIPLIER_DEFS, type GamificationSession } from '../../lib/dialer/gamificationDefs';
import { getCurrentRank } from '../../lib/dialer/gamificationDefs';
import { getBadgeIcon, getBadgeCategoryColor, getMultiplierIcon } from './BadgeIcons';

// --- Section order for badge grid ---

const SECTION_ORDER = [
  'Streaks',
  'Prepay Streak',
  'Street',
  'Time',
  'Spree',
  'Special',
  'Headhunter',
  'Raise the Dead',
  'Conversion',
  'Ranks',
  'Milestones',
  'Workhorse',
];

// --- Section descriptions ---

const SECTION_DESC: Record<string, string> = {
  'Streaks': 'Consecutive YES dispositions without a break',
  'Prepay Streak': 'Consecutive prepay bookings back-to-back',
  'Street': 'Multiple sales on the same street',
  'Time': 'Bookings at unusual hours',
  'Spree': 'Booking volume within a 1-hour window',
  'Special': 'Unique one-time achievements',
  'Headhunter': 'Booking on streets with no prior AER',
  'Raise the Dead': 'Reviving clients with last service in 2021',
  'Conversion': 'Converting non-app clients to prepay',
  'Ranks': 'Prepay dollar milestones',
  'Milestones': 'Total booking count achievements',
  'Workhorse': 'Sustained high dial volume',
};

// --- Section accent colors ---

const SECTION_COLORS: Record<string, string> = {
  'Streaks': '#e74c3c',
  'Prepay Streak': '#f1c40f',
  'Street': '#2ecc71',
  'Time': '#e67e22',
  'Spree': '#ff5722',
  'Special': '#00BCD4',
  'Headhunter': '#9b59b6',
  'Raise the Dead': '#8e44ad',
  'Conversion': '#e056a0',
  'Ranks': '#f1c40f',
  'Milestones': '#3498db',
  'Workhorse': '#95a5a6',
};

// --- Section icons ---

const SECTION_ICONS: Record<string, string> = {
  'Streaks': '🔥',
  'Prepay Streak': '💰',
  'Street': '🗺️',
  'Time': '⏰',
  'Spree': '⚡',
  'Special': '✦',
  'Headhunter': '🎯',
  'Raise the Dead': '💀',
  'Conversion': '🧠',
  'Ranks': '⭐',
  'Milestones': '🏅',
  'Workhorse': '⚙️',
};

// --- Multiplier descriptions ---

const MULT_DESCRIPTIONS: Record<string, string> = {
  op_tempo: '5+ bookings in rolling 1hr window → +0.5x base, +0.1x per additional booking. Drops when window falls below 5.',
  tracer_rounds: '2+ prepay streak starts +0.2x, grows +0.2x per level. 20min timer.',
  high_ground: '+1.0x flat while dialing on the same street as your last YES.',
  night_vision: '+0.2x per booking after 8pm. Stacks infinitely.',
  blitz: '5 bookings within 20/40/60min of session start → 2.0x/1.5x/1.0x, decays over 3hrs.',
  enraged: '3 rejections → tiered bonus (1.0x → 2.0x → 2.0x). Consumed on YES.',
  ratio_focus: 'PP ratio ≥ 20% → your ratio becomes a multiplier.',
  war_machine: 'Dial 50 times → +0.5x flat. Drops if no disposition for 10 minutes. Reset to 0 and re-earn at next 50.',
  ghost_town: '10 unreached → 0.5x (3 charges). Tiers up: 1.0x → 2.0x.',
  cold_streak: '20 dials without YES → +1.0x (2 charges).',
  scorched_earth: 'Clear an entire street → tiered bonus (0.1x–2.0x), 2 charges per trigger.',
  indoctrinate: 'Convert a non-app client to prepay → badge bonuses get multiplied by ALL active multipliers for 2 bookings.',
};

// --- Props ---

interface AchievementsPanelProps {
  session: GamificationSession;
  open: boolean;
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function AchievementsPanel({ session, open, onClose }: AchievementsPanelProps) {
  const [activeTab, setActiveTab] = useState<'badges' | 'multipliers' | 'feed'>('badges');
  const [hoveredBadge, setHoveredBadge] = useState<string | null>(null);

  if (!open) return null;

  const s = session;
  const rank = getCurrentRank(s);
  const earnedSet = new Set(s.badges.map(b => b.id));
  const totalBadgesEarned = s.badges.length;
  const uniqueBadgesEarned = earnedSet.size;
  const totalBadgesDefined = Object.keys(BADGE_DEFS).length;

  // Group badges by section
  const badgesBySection: Record<string, { id: string; def: any; earned: boolean; count: number }[]> = {};
  for (const section of SECTION_ORDER) {
    badgesBySection[section] = [];
  }
  for (const [id, def] of Object.entries(BADGE_DEFS)) {
    const section = def.section || 'Special';
    if (!badgesBySection[section]) badgesBySection[section] = [];
    const count = s.badges.filter(b => b.id === id).length;
    badgesBySection[section].push({ id, def, earned: earnedSet.has(id), count });
  }

  const ppRatio = s.totalBookings > 0 ? Math.round((s.pps / s.totalBookings) * 100) : 0;
  const progressPct = Math.round((uniqueBadgesEarned / totalBadgesDefined) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Keyframe animations */}
      <style>{`
        @keyframes badge-pulse {
          0%, 100% { box-shadow: 0 0 4px var(--pulse-color, rgba(46,204,113,0.2)); }
          50% { box-shadow: 0 0 12px var(--pulse-color, rgba(46,204,113,0.5)); }
        }
        @keyframes badge-glow-idle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.35; }
        }
        @keyframes tab-underline {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @keyframes mult-active-pulse {
          0%, 100% { box-shadow: 0 0 6px var(--mult-color, rgba(46,204,113,0.2)); }
          50% { box-shadow: 0 0 16px var(--mult-color, rgba(46,204,113,0.5)); }
        }
      `}</style>

      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #0d1a0d 0%, #080f08 50%, #0a120a 100%)',
          border: '1px solid rgba(46,204,113,0.3)',
          borderRadius: 12,
          boxShadow: '0 0 80px rgba(46,204,113,0.1), 0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(46,204,113,0.15)',
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(46,204,113,0.15)', background: 'rgba(14,24,14,0.6)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div style={{
                background: 'rgba(241,196,15,0.1)',
                border: '1px solid rgba(241,196,15,0.25)',
                borderRadius: 8,
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
              }}>
                <Trophy size={16} color="#f1c40f" />
              </div>
              <span className="text-sm font-black tracking-widest uppercase font-mono" style={{ color: '#f1c40f', letterSpacing: 3 }}>
                War Room
              </span>
              {rank && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{
                  background: 'rgba(241,196,15,0.08)',
                  border: '1px solid rgba(241,196,15,0.2)',
                  color: '#f1c40f',
                  letterSpacing: 1,
                }}>
                  {rank.icon} {rank.label}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-all duration-200 hover:bg-white/10 active:scale-90"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <X size={14} color="#666" />
            </button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-6 gap-1.5">
            <StatCard icon={<Target size={11} />} label="PB" value={s.pbs} color="#2ecc71" />
            <StatCard icon={<DollarSign size={11} />} label="PP" value={s.pps} color="#f1c40f" />
            <StatCard icon={<DollarSign size={11} />} label="PP$" value={`$${s.ppDollars}`} color="#e67e22" />
            <StatCard icon={<Zap size={11} />} label="PTS" value={s.totalSessionPoints} color="#fff" />
            <StatCard icon={<Award size={11} />} label="BADGES" value={totalBadgesEarned} color="#9b59b6" />
            <StatCard icon={<Phone size={11} />} label="DIALS" value={s.totalDials} color="#3498db" />
          </div>

          {/* Progress bar */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #2ecc71, #f1c40f)',
                  boxShadow: '0 0 8px rgba(46,204,113,0.4)',
                  transition: 'width 0.8s ease-out',
                }}
              />
            </div>
            <span className="text-xs font-mono font-bold" style={{ color: '#2ecc71', opacity: 0.6, fontSize: 9 }}>
              {uniqueBadgesEarned}/{totalBadgesDefined}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 flex px-5 pt-1" style={{ background: 'rgba(14,24,14,0.4)' }}>
          <TabButton label="Badges" count={`${uniqueBadgesEarned}/${totalBadgesDefined}`} active={activeTab === 'badges'} onClick={() => setActiveTab('badges')} />
          <TabButton label="Multipliers" count={String(Object.keys(MULTIPLIER_DEFS).length)} active={activeTab === 'multipliers'} onClick={() => setActiveTab('multipliers')} />
          <TabButton label="Feed" count={String(s.recentBookings.length)} active={activeTab === 'feed'} onClick={() => setActiveTab('feed')} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ background: 'transparent' }}>
          {activeTab === 'badges' && (
            <BadgesTab badgesBySection={badgesBySection} hoveredBadge={hoveredBadge} setHoveredBadge={setHoveredBadge} />
          )}
          {activeTab === 'multipliers' && (
            <MultipliersTab session={s} />
          )}
          {activeTab === 'feed' && (
            <FeedTab session={s} />
          )}
        </div>

        {/* Footer — attribution */}
        <div className="flex-shrink-0 px-5 py-2 text-center" style={{ borderTop: '1px solid rgba(46,204,113,0.1)', background: 'rgba(14,24,14,0.4)' }}>
          <span className="text-xs font-mono" style={{ color: '#2ecc71', opacity: 0.2, letterSpacing: '2px', fontSize: 9 }}>
            {s.repCode} — {s.date} — PP%: {ppRatio} — STREAK: {s.consecutiveYes}
          </span>
          <div style={{ fontSize: 7, color: '#2ecc71', opacity: 0.15, marginTop: 2, letterSpacing: '0.5px' }}>
            Icons by <a href="https://game-icons.net" target="_blank" rel="noopener noreferrer" style={{ color: '#2ecc71', textDecoration: 'none' }}>game-icons.net</a> — CC BY 3.0 — Lorc, Delapouite, Skoll, Sbed, Caro Asercion
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// BADGES TAB
// =============================================================================

function BadgesTab({
  badgesBySection,
  hoveredBadge,
  setHoveredBadge,
}: {
  badgesBySection: Record<string, { id: string; def: any; earned: boolean; count: number }[]>;
  hoveredBadge: string | null;
  setHoveredBadge: (id: string | null) => void;
}) {
  return (
    <div className="space-y-5">
      {SECTION_ORDER.map(section => {
        const badges = badgesBySection[section];
        if (!badges || badges.length === 0) return null;
        const earnedCount = badges.filter(b => b.earned).length;
        const accent = SECTION_COLORS[section] || '#2ecc71';
        const sectionIcon = SECTION_ICONS[section] || '•';

        return (
          <div key={section}>
            {/* Section header */}
            <div className="flex items-center gap-2 mb-2">
              <span style={{ fontSize: 12 }}>{sectionIcon}</span>
              <span className="text-xs font-black tracking-widest uppercase font-mono" style={{ color: accent, letterSpacing: 2 }}>
                {section}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full font-mono" style={{
                background: `${accent}12`,
                color: accent,
                fontSize: 9,
                border: `1px solid ${accent}25`,
              }}>
                {earnedCount}/{badges.length}
              </span>
              <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${accent}30, transparent)` }} />
            </div>
            <div className="text-xs mb-2.5" style={{ color: '#444', fontSize: 9, letterSpacing: 0.5 }}>{SECTION_DESC[section]}</div>

            {/* Badge grid */}
            <div className="grid grid-cols-3 gap-2">
              {badges.map(({ id, def, earned, count }) => {
                const icon = getBadgeIcon(id, 28);
                const catColor = getBadgeCategoryColor(id);
                const isHovered = hoveredBadge === id;

                return (
                  <div
                    key={id}
                    className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-default"
                    style={{
                      background: earned
                        ? isHovered ? `${catColor}18` : `${catColor}0a`
                        : 'rgba(255,255,255,0.015)',
                      border: earned
                        ? `1px solid ${catColor}30`
                        : '1px solid rgba(255,255,255,0.04)',
                      opacity: earned ? 1 : 0.35,
                      animation: earned ? 'badge-pulse 3s ease-in-out infinite' : undefined,
                      ['--pulse-color' as any]: earned ? `${catColor}30` : undefined,
                      transform: isHovered && earned ? 'scale(1.02)' : 'scale(1)',
                    }}
                    onMouseEnter={() => setHoveredBadge(id)}
                    onMouseLeave={() => setHoveredBadge(null)}
                  >
                    {/* Glow background for earned badges */}
                    {earned && (
                      <div
                        className="absolute inset-0 rounded-lg pointer-events-none"
                        style={{
                          background: `radial-gradient(ellipse at 20% 50%, ${catColor}15 0%, transparent 70%)`,
                          animation: 'badge-glow-idle 4s ease-in-out infinite',
                        }}
                      />
                    )}

                    {/* Icon */}
                    <div className="relative flex-shrink-0 flex items-center justify-center" style={{
                      width: 32,
                      height: 32,
                      filter: earned ? 'none' : 'grayscale(1) brightness(0.4)',
                    }}>
                      {icon || <span className="text-lg">{def.icon}</span>}
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1 relative">
                      <div className="text-xs font-bold truncate" style={{
                        color: earned ? '#e0e0e0' : '#555',
                        fontSize: 10,
                        letterSpacing: 0.3,
                      }}>
                        {def.name}
                      </div>
                      <div className="text-xs truncate" style={{
                        color: earned ? '#777' : '#333',
                        fontSize: 8,
                        marginTop: 1,
                      }}>
                        {def.desc}
                      </div>
                    </div>

                    {/* Count / bonus / lock */}
                    {earned && count > 0 && (
                      <div className="flex flex-col items-end flex-shrink-0 relative">
                        {count > 1 && (
                          <span className="text-xs font-black font-mono" style={{ color: catColor, fontSize: 11 }}>
                            x{count}
                          </span>
                        )}
                        <span className="text-xs font-mono" style={{ color: '#555', fontSize: 7 }}>
                          +{def.bonus}
                        </span>
                      </div>
                    )}
                    {!earned && (
                      <div className="flex-shrink-0 relative" style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
                          <rect x="1" y="4" width="6" height="5" rx="1" stroke="#333" strokeWidth="0.8" />
                          <path d="M2.5 4V2.5C2.5 1.7 3.2 1 4 1C4.8 1 5.5 1.7 5.5 2.5V4" stroke="#333" strokeWidth="0.8" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// MULTIPLIERS TAB
// =============================================================================

function MultipliersTab({ session }: { session: GamificationSession }) {
  const multEntries = Object.entries(MULTIPLIER_DEFS);

  return (
    <div className="space-y-2">
      <div className="text-xs mb-3 px-1" style={{ color: '#555', fontSize: 10, lineHeight: 1.5 }}>
        Multipliers stack on 1.0x base. Score = base × total multiplier + badge bonuses.
      </div>
      {multEntries.map(([id, def]) => {
        const ms = (session.multipliers as any)[id];
        let isActive = false;
        let currentVal = '';

        // Op Tempo — rolling 60-min window
        if (id === 'op_tempo') {
          const cutoff = Date.now() - 3600000;
          const wc = (session.bookingTimestamps || []).filter((t: number) => t >= cutoff).length;
          if (wc >= ((def as any).activationThreshold || 5)) {
            isActive = true;
            currentVal = `+${Math.round(wc * ((def as any).perLevelBonus || 0.1) * 100) / 100}x (${wc} in window)`;
          }
        }

        if (id === 'tracer_rounds' && ms?.expiresAt > Date.now() && ms?.prepayCount >= (def as any).activationThreshold) {
          isActive = true;
          const v = (def as any).baseMultiplier + (ms.prepayCount - (def as any).activationThreshold) * (def as any).perLevelBonus;
          currentVal = `+${Math.round(v * 100) / 100}x`;
        }
        if (id === 'high_ground' && ms?.active) { isActive = true; currentVal = `+${(def as any).flatMultiplier}x`; }
        if (id === 'night_vision' && ms?.bookingsAfter8 > 0) { isActive = true; currentVal = `+${Math.round(ms.bookingsAfter8 * (def as any).perBookingBonus * 100) / 100}x`; }
        if (id === 'blitz' && ms?.triggered) { isActive = true; currentVal = 'decaying'; }
        if (id === 'enraged' && ms?.tier > 0 && ms?.chargesRemaining > 0) { isActive = true; currentVal = `tier ${ms.tier}`; }
        if (id === 'ratio_focus' && session.totalBookings > 0) {
          const r = session.pps / session.totalBookings;
          if (r >= (def as any).minimumRatio) { isActive = true; currentVal = `+${Math.round(r * 100) / 100}x`; }
        }

        // War Machine — inactivity countdown
        if (id === 'war_machine') {
          if (ms?.active) {
            isActive = true;
            const elapsed = ms.lastDialAt > 0 ? Date.now() - ms.lastDialAt : 0;
            const remaining = Math.max(0, 600000 - elapsed);
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            currentVal = `+0.5x (drops in ${mins}:${secs < 10 ? '0' + secs : secs})`;
          }
        }

        if (id === 'ghost_town' && ms?.chargesRemaining > 0) { isActive = true; currentVal = `tier ${ms.tier} (${ms.chargesRemaining}ch)`; }
        if (id === 'cold_streak' && ms?.chargesRemaining > 0) { isActive = true; currentVal = `${ms.chargesRemaining}ch`; }
        if (id === 'scorched_earth' && ms?.bonusStack?.length > 0) { isActive = true; currentVal = `${ms.bonusStack.length} stacks`; }

        // Get game-icons.net multiplier icon, fall back to emoji
        const multIcon = getMultiplierIcon(id, 18);

        return (
          <div
            key={id}
            className="flex items-start gap-3 px-3.5 py-3 rounded-lg transition-all duration-200"
            style={{
              background: isActive ? 'rgba(46,204,113,0.04)' : 'rgba(255,255,255,0.015)',
              border: isActive ? '1px solid rgba(46,204,113,0.2)' : '1px solid rgba(255,255,255,0.04)',
              animation: isActive ? 'mult-active-pulse 3s ease-in-out infinite' : undefined,
              ['--mult-color' as any]: isActive ? 'rgba(46,204,113,0.3)' : undefined,
            }}
          >
            <div className="flex-shrink-0 mt-0.5" style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: isActive ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isActive ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.05)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}>
              {multIcon || (def as any).icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider uppercase" style={{
                  color: isActive ? '#2ecc71' : '#555',
                  letterSpacing: 1.5,
                  fontSize: 10,
                }}>
                  {(def as any).name}
                </span>
                {isActive && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full font-mono" style={{
                    background: 'rgba(46,204,113,0.1)',
                    color: '#2ecc71',
                    fontSize: 8,
                    border: '1px solid rgba(46,204,113,0.2)',
                    letterSpacing: 1,
                  }}>
                    ACTIVE — {currentVal}
                  </span>
                )}
              </div>
              <div className="text-xs mt-1" style={{ color: '#555', fontSize: 9, lineHeight: '1.5' }}>
                {MULT_DESCRIPTIONS[id] || ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// FEED TAB
// =============================================================================

function FeedTab({ session }: { session: GamificationSession }) {
  const bookings = [...session.recentBookings].reverse();
  const badges = [...session.badges].reverse().slice(0, 30);

  return (
    <div className="space-y-5">
      {/* Recent bookings */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div style={{ width: 3, height: 12, borderRadius: 2, background: '#2ecc71' }} />
          <span className="text-xs font-black tracking-widest uppercase font-mono" style={{ color: '#2ecc71', opacity: 0.6, letterSpacing: 2, fontSize: 9 }}>
            Recent Bookings
          </span>
        </div>
        {bookings.length === 0 && (
          <div className="text-xs py-6 text-center" style={{ color: '#333' }}>No bookings yet this session.</div>
        )}
        {bookings.map((b, i) => {
          const time = new Date(b.time);
          const h = time.getHours() % 12 || 12;
          const m = time.getMinutes();
          const ampm = time.getHours() >= 12 ? 'p' : 'a';
          const timeStr = `${h}:${m < 10 ? '0' + m : m}${ampm}`;
          const isPP = b.type === 'PREPAY';

          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1"
              style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              <span className="text-xs font-mono" style={{ color: '#444', minWidth: 42, fontSize: 9 }}>{timeStr}</span>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: isPP ? 'rgba(241,196,15,0.1)' : 'rgba(46,204,113,0.1)',
                  color: isPP ? '#f1c40f' : '#2ecc71',
                  fontSize: 8,
                  border: `1px solid ${isPP ? 'rgba(241,196,15,0.2)' : 'rgba(46,204,113,0.2)'}`,
                  letterSpacing: 1,
                }}
              >
                {b.type}
              </span>
              <span className="text-xs font-mono font-bold" style={{ color: '#e0e0e0' }}>+{b.grandTotal}</span>
              <span className="text-xs font-mono" style={{ color: '#555', fontSize: 8 }}>
                ({b.base} × {b.multiplier}x
                {b.badgeBonusTotal > 0 && <> + {b.badgeBonusTotal}</>})
              </span>
            </div>
          );
        })}
      </div>

      {/* Badge log */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div style={{ width: 3, height: 12, borderRadius: 2, background: '#9b59b6' }} />
          <span className="text-xs font-black tracking-widest uppercase font-mono" style={{ color: '#9b59b6', opacity: 0.6, letterSpacing: 2, fontSize: 9 }}>
            Badge Log
          </span>
        </div>
        {badges.length === 0 && (
          <div className="text-xs py-6 text-center" style={{ color: '#333' }}>No badges earned yet.</div>
        )}
        {badges.map((b, i) => {
          const def = BADGE_DEFS[b.id];
          if (!def) return null;
          const icon = getBadgeIcon(b.id, 20);
          const catColor = getBadgeCategoryColor(b.id);

          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg mb-1"
              style={{ background: `${catColor}06`, border: `1px solid ${catColor}15` }}
            >
              <span className="text-xs font-mono" style={{ color: '#444', minWidth: 42, fontSize: 9 }}>{b.time}</span>
              <div className="flex-shrink-0" style={{ width: 20, height: 20 }}>
                {icon || <span className="text-sm">{def.icon}</span>}
              </div>
              <span className="text-xs font-bold" style={{ color: '#bbb', fontSize: 10 }}>{def.name}</span>
              {b.points > 0 && <span className="text-xs font-mono font-bold" style={{ color: catColor, fontSize: 9 }}>+{b.points}</span>}
              {b.sheet && <span className="text-xs font-mono" style={{ color: '#333', fontSize: 7 }}>{b.sheet}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center py-2 px-1 rounded-lg" style={{
      background: `${color}06`,
      border: `1px solid ${color}15`,
    }}>
      <div className="mb-0.5" style={{ color, opacity: 0.6 }}>{icon}</div>
      <span className="text-sm font-black font-mono" style={{ color, lineHeight: 1 }}>{value}</span>
      <span style={{
        fontSize: 7,
        color,
        opacity: 0.4,
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase' as const,
        marginTop: 2,
      }}>{label}</span>
    </div>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200 mr-1"
      style={{
        background: 'transparent',
        color: active ? '#2ecc71' : '#444',
        letterSpacing: '1.5px',
        borderRadius: '8px 8px 0 0',
      }}
    >
      {label}
      <span className="ml-1 font-mono" style={{ fontSize: 8, opacity: 0.5 }}>({count})</span>
      {active && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: '15%',
          right: '15%',
          height: 2,
          borderRadius: 1,
          background: '#2ecc71',
          boxShadow: '0 0 8px rgba(46,204,113,0.5)',
          animation: 'tab-underline 0.2s ease-out',
        }} />
      )}
    </button>
  );
}