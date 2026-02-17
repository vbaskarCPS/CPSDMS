// src/pages/Dialer/AchievementsPanel.tsx
//
// Full-screen achievements overlay — trophy button opens this.
// Shows session stats, badge grid (earned/locked), multiplier guide, recent bookings.
//

import { useState } from 'react';
import { X, Phone, Target, DollarSign, Zap, Award, Trophy, Crosshair } from 'lucide-react';
import { BADGE_DEFS, MULTIPLIER_DEFS, type GamificationSession } from '../../lib/dialer/gamificationDefs';
import { getCurrentRank } from '../../lib/dialer/gamificationDefs';

// --- Props ---

interface AchievementsPanelProps {
  session: GamificationSession;
  open: boolean;
  onClose: () => void;
}

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
  'Ranks': '#f1c40f',
  'Milestones': '#3498db',
  'Workhorse': '#95a5a6',
};

// --- Multiplier descriptions for the reference guide ---

const MULT_DESCRIPTIONS: Record<string, string> = {
  op_tempo: '2+ YES streak starts +0.2x, grows +0.1x per level. 20min timer resets on each YES.',
  tracer_rounds: '2+ prepay streak starts +0.2x, grows +0.2x per level. 20min timer.',
  high_ground: '+1.0x flat while dialing on the same street as your last YES.',
  night_vision: '+0.2x per booking after 8pm. Stacks infinitely.',
  blitz: '5 bookings within 20/40/60min of session start → 2.0x/1.5x/1.0x, decays over 3hrs.',
  enraged: '3 rejections → tiered bonus (1.0x → 2.0x → 2.0x). Consumed on YES.',
  ratio_focus: 'PP ratio ≥ 20% → your ratio becomes a multiplier.',
  war_machine: '+0.1x per consecutive hour at 50+ dials/hr.',
  ghost_town: '10 unreached → 0.5x (3 charges). Tiers up: 1.0x → 2.0x.',
  cold_streak: '20 dials without YES → +1.0x (2 charges).',
  scorched_earth: 'Clear an entire street → tiered bonus (1.1x-3.0x), 5 charges per trigger.',
};

// =============================================================================
// COMPONENT
// =============================================================================

export default function AchievementsPanel({ session, open, onClose }: AchievementsPanelProps) {
  const [activeTab, setActiveTab] = useState<'badges' | 'multipliers' | 'feed'>('badges');

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

  // PP ratio
  const ppRatio = s.totalBookings > 0 ? Math.round((s.pps / s.totalBookings) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg overflow-hidden"
        style={{ background: '#0a120a', border: '2px solid rgba(46,204,113,0.5)', boxShadow: '0 0 60px rgba(46,204,113,0.15), 0 12px 40px rgba(0,0,0,0.8)' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3" style={{ borderBottom: '2px solid rgba(46,204,113,0.3)', background: 'rgba(14,24,14,0.95)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy size={18} color="#f1c40f" />
              <span className="text-sm font-black tracking-widest uppercase font-mono" style={{ color: '#f1c40f' }}>
                War Room
              </span>
              {rank && (
                <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(241,196,15,0.1)', border: '1px solid rgba(241,196,15,0.3)', color: '#f1c40f' }}>
                  {rank.icon} {rank.label}
                </span>
              )}
            </div>
            <button onClick={onClose} className="p-1 rounded transition-colors hover:bg-white/10">
              <X size={16} color="#888" />
            </button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-6 gap-2">
            <StatCard icon={<Target size={12} color="#2ecc71" />} label="Prebooks" value={s.pbs} color="#2ecc71" />
            <StatCard icon={<DollarSign size={12} color="#f1c40f" />} label="Prepays" value={s.pps} color="#f1c40f" />
            <StatCard icon={<DollarSign size={12} color="#e67e22" />} label="PP$" value={`$${s.ppDollars}`} color="#e67e22" />
            <StatCard icon={<Zap size={12} color="#fff" />} label="Points" value={s.totalSessionPoints} color="#fff" />
            <StatCard icon={<Award size={12} color="#9b59b6" />} label="Badges" value={totalBadgesEarned} color="#9b59b6" />
            <StatCard icon={<Phone size={12} color="#3498db" />} label="Dials" value={s.totalDials} color="#3498db" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 flex px-5 pt-2" style={{ background: 'rgba(14,24,14,0.6)' }}>
          <TabButton label="Badges" count={`${uniqueBadgesEarned}/${totalBadgesDefined}`} active={activeTab === 'badges'} onClick={() => setActiveTab('badges')} />
          <TabButton label="Multipliers" count={String(Object.keys(MULTIPLIER_DEFS).length)} active={activeTab === 'multipliers'} onClick={() => setActiveTab('multipliers')} />
          <TabButton label="Feed" count={String(s.recentBookings.length)} active={activeTab === 'feed'} onClick={() => setActiveTab('feed')} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ background: '#0a120a' }}>
          {activeTab === 'badges' && (
            <BadgesTab badgesBySection={badgesBySection} />
          )}
          {activeTab === 'multipliers' && (
            <MultipliersTab session={s} />
          )}
          {activeTab === 'feed' && (
            <FeedTab session={s} />
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-2 text-center" style={{ borderTop: '1px solid rgba(46,204,113,0.15)', background: 'rgba(14,24,14,0.6)' }}>
          <span className="text-xs font-mono" style={{ color: '#2ecc71', opacity: 0.3, letterSpacing: '2px' }}>
            {s.repCode} — {s.date} — PP Ratio: {ppRatio}% — Streak: {s.consecutiveYes}
          </span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// BADGES TAB
// =============================================================================

function BadgesTab({ badgesBySection }: { badgesBySection: Record<string, { id: string; def: any; earned: boolean; count: number }[]> }) {
  return (
    <div className="space-y-4">
      {SECTION_ORDER.map(section => {
        const badges = badgesBySection[section];
        if (!badges || badges.length === 0) return null;
        const earnedCount = badges.filter(b => b.earned).length;
        const accent = SECTION_COLORS[section] || '#2ecc71';

        return (
          <div key={section}>
            {/* Section header */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-black tracking-widest uppercase font-mono" style={{ color: accent }}>
                {section}
              </span>
              <span className="text-xs font-bold px-1.5 py-0.5 rounded font-mono" style={{ background: `${accent}15`, color: accent, fontSize: 9 }}>
                {earnedCount}/{badges.length}
              </span>
              <div className="flex-1 h-px" style={{ background: `${accent}30` }} />
            </div>
            <div className="text-xs mb-2" style={{ color: '#555', fontSize: 9 }}>{SECTION_DESC[section]}</div>

            {/* Badge grid */}
            <div className="grid grid-cols-3 gap-1.5">
              {badges.map(({ id, def, earned, count }) => (
                <div
                  key={id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded transition-all"
                  style={{
                    background: earned ? `${accent}10` : 'rgba(255,255,255,0.02)',
                    border: earned ? `1px solid ${accent}40` : '1px solid rgba(255,255,255,0.06)',
                    opacity: earned ? 1 : 0.4,
                  }}
                >
                  <span className="text-base flex-shrink-0" style={{ filter: earned ? 'none' : 'grayscale(1)' }}>
                    {def.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate" style={{ color: earned ? '#fff' : '#666', fontSize: 10 }}>
                      {def.name}
                    </div>
                    <div className="text-xs truncate" style={{ color: earned ? '#888' : '#444', fontSize: 8 }}>
                      {def.desc}
                    </div>
                  </div>
                  {earned && count > 0 && (
                    <div className="flex flex-col items-end flex-shrink-0">
                      {count > 1 && (
                        <span className="text-xs font-black font-mono" style={{ color: accent, fontSize: 10 }}>
                          x{count}
                        </span>
                      )}
                      <span className="text-xs font-mono" style={{ color: '#555', fontSize: 7 }}>
                        +{def.bonus}
                      </span>
                    </div>
                  )}
                  {!earned && (
                    <span className="text-xs font-mono flex-shrink-0" style={{ color: '#333', fontSize: 8 }}>
                      🔒
                    </span>
                  )}
                </div>
              ))}
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
      <div className="text-xs mb-2" style={{ color: '#555' }}>
        Multipliers stack on top of 1.0x base. Your final score = base points × total multiplier + badge bonuses.
      </div>
      {multEntries.map(([id, def]) => {
        // Check if active
        const ms = (session.multipliers as any)[id];
        let isActive = false;
        let currentVal = '';

        if (id === 'op_tempo' && ms?.expiresAt > Date.now() && ms?.streakCount >= (def as any).activationThreshold) {
          isActive = true;
          const v = (def as any).baseMultiplier + (ms.streakCount - (def as any).activationThreshold) * (def as any).perLevelBonus;
          currentVal = `+${Math.round(v * 100) / 100}x`;
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
        if (id === 'ghost_town' && ms?.chargesRemaining > 0) { isActive = true; currentVal = `tier ${ms.tier} (${ms.chargesRemaining} charges)`; }
        if (id === 'cold_streak' && ms?.chargesRemaining > 0) { isActive = true; currentVal = `${ms.chargesRemaining} charges`; }
        if (id === 'scorched_earth' && ms?.bonusStack?.length > 0) { isActive = true; currentVal = `${ms.bonusStack.length} stacks`; }

        return (
          <div
            key={id}
            className="flex items-start gap-3 px-3 py-2.5 rounded"
            style={{
              background: isActive ? 'rgba(46,204,113,0.06)' : 'rgba(255,255,255,0.02)',
              border: isActive ? '1px solid rgba(46,204,113,0.25)' : '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <span className="text-lg flex-shrink-0 mt-0.5">{(def as any).icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider uppercase" style={{ color: isActive ? '#2ecc71' : '#888' }}>
                  {(def as any).name}
                </span>
                {isActive && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(46,204,113,0.15)', color: '#2ecc71', fontSize: 9 }}>
                    ACTIVE — {currentVal}
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#666', fontSize: 10, lineHeight: '1.4' }}>
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
    <div className="space-y-4">
      {/* Recent bookings */}
      <div>
        <div className="text-xs font-black tracking-widest uppercase mb-1.5 font-mono" style={{ color: '#2ecc71', opacity: 0.5 }}>
          Recent Bookings
        </div>
        {bookings.length === 0 && (
          <div className="text-xs py-4 text-center" style={{ color: '#444' }}>No bookings yet this session.</div>
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
              className="flex items-center gap-2 px-2.5 py-1.5 rounded mb-1"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span className="text-xs font-mono" style={{ color: '#555', minWidth: 42 }}>{timeStr}</span>
              <span
                className="text-xs font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: isPP ? 'rgba(241,196,15,0.15)' : 'rgba(46,204,113,0.15)',
                  color: isPP ? '#f1c40f' : '#2ecc71',
                  fontSize: 9,
                }}
              >
                {b.type}
              </span>
              <span className="text-xs font-mono font-bold" style={{ color: '#fff' }}>+{b.grandTotal}</span>
              <span className="text-xs font-mono" style={{ color: '#555' }}>
                ({b.base} × {b.multiplier}x
                {b.badgeBonusTotal > 0 && <> + {b.badgeBonusTotal} badges</>})
              </span>
              {Object.keys(b.multiplierBreakdown || {}).length > 0 && (
                <span className="text-xs" style={{ color: '#444', fontSize: 8 }}>
                  [{Object.entries(b.multiplierBreakdown).map(([k, v]) => `${k}:${v}`).join(', ')}]
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Badge log */}
      <div>
        <div className="text-xs font-black tracking-widest uppercase mb-1.5 font-mono" style={{ color: '#9b59b6', opacity: 0.5 }}>
          Badge Log
        </div>
        {badges.length === 0 && (
          <div className="text-xs py-4 text-center" style={{ color: '#444' }}>No badges earned yet.</div>
        )}
        {badges.map((b, i) => {
          const def = BADGE_DEFS[b.id];
          if (!def) return null;
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-2.5 py-1 rounded mb-1"
              style={{ background: 'rgba(155,89,182,0.04)', border: '1px solid rgba(155,89,182,0.1)' }}
            >
              <span className="text-xs font-mono" style={{ color: '#555', minWidth: 42 }}>{b.time}</span>
              <span className="text-sm">{def.icon}</span>
              <span className="text-xs font-bold" style={{ color: '#ccc' }}>{def.name}</span>
              {b.points > 0 && <span className="text-xs font-mono" style={{ color: '#9b59b6' }}>+{b.points}</span>}
              {b.sheet && <span className="text-xs" style={{ color: '#444', fontSize: 8 }}>{b.sheet}</span>}
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
    <div className="flex flex-col items-center py-1.5 px-1 rounded" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
      <div className="mb-0.5">{icon}</div>
      <span className="text-sm font-black font-mono" style={{ color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 7, color, opacity: 0.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginTop: 2 }}>{label}</span>
    </div>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-all mr-1 rounded-t"
      style={{
        background: active ? 'rgba(46,204,113,0.1)' : 'transparent',
        color: active ? '#2ecc71' : '#555',
        borderBottom: active ? '2px solid #2ecc71' : '2px solid transparent',
        letterSpacing: '1.5px',
      }}
    >
      {label}
      <span className="ml-1 font-mono" style={{ fontSize: 9, opacity: 0.6 }}>({count})</span>
    </button>
  );
}