// src/pages/Dialer/StatsPanel.tsx
//
// Team Stats panel — opens from HUD "TEAM STATS" menu action.
// Two tabs: FIRETEAM (current campaign, today) | GLOBAL (all campaigns, today).
// Per-member cards: collapsed summary row, expandable detail with 6 stat cards + badge log.
// Styled to match AchievementsPanel (dark military aesthetic).
//

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Users } from 'lucide-react';
import { dialerRealtimeService } from '../../lib/dialerRealtimeService';
import type { MemberStats } from '../../lib/dialerRealtimeService';
import type { GamificationSession } from '../../lib/dialer/gamificationDefs';
import { BADGE_DEFS } from '../../lib/dialer/gamificationDefs';
import { getBadgeIcon, getBadgeCategoryColor } from './BadgeIcons';

// =============================================================================
// PROPS
// =============================================================================

interface StatsPanelProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  currentUserId: string;
  currentUserName: string;
  session: GamificationSession | null;
}

// =============================================================================
// HELPERS
// =============================================================================

const RANK_ICONS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function getRankIcon(index: number): string {
  return RANK_ICONS[index] ?? `${index + 1}.`;
}

/** Build a MemberStats from the current user's local GamificationSession */
function sessionToMemberStats(
  userId: string,
  userName: string,
  session: GamificationSession
): MemberStats {
  return {
    managerId:     userId,
    managerName:   userName,
    points:        session.totalSessionPoints,
    totalBookings: session.totalBookings,
    pbs:           session.pbs,
    pps:           session.pps,
    ppDollars:     session.ppDollars,
    totalDials:    session.totalDials,
    badges:        session.badges.map(b => b.id),
  };
}

/** Merge the current user's local stats into a Supabase-sourced list */
function mergeCurrentUser(
  rows: MemberStats[],
  userId: string,
  userName: string,
  session: GamificationSession | null
): MemberStats[] {
  if (!session) return rows;
  const self = sessionToMemberStats(userId, userName, session);
  // Remove any Supabase row for this user (local is always fresher)
  const others = rows.filter(r => r.managerId !== userId);
  return [...others, self].sort((a, b) => b.points - a.points);
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function StatsPanel({
  open,
  onClose,
  campaignId,
  currentUserId,
  currentUserName,
  session,
}: StatsPanelProps) {
  const [tab, setTab] = useState<'fireteam' | 'global'>('fireteam');
  const [fireteamRows, setFireteamRows] = useState<MemberStats[]>([]);
  const [globalRows, setGlobalRows] = useState<MemberStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ft, gl] = await Promise.all([
        dialerRealtimeService.fetchFireteamStats(campaignId),
        dialerRealtimeService.fetchGlobalStats(),
      ]);
      setFireteamRows(ft);
      setGlobalRows(gl);
      setLastRefresh(Date.now());
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  // Fetch on open
  useEffect(() => {
    if (open) fetchAll();
  }, [open, fetchAll]);

  if (!open) return null;

  const rows = tab === 'fireteam'
    ? mergeCurrentUser(fireteamRows, currentUserId, currentUserName, session)
    : mergeCurrentUser(globalRows, currentUserId, currentUserName, session);

  const refreshAgo = lastRefresh
    ? Math.round((Date.now() - lastRefresh) / 1000)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @keyframes sp-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(46,204,113,0.15); }
          50% { box-shadow: 0 0 14px rgba(46,204,113,0.4); }
        }
        @keyframes sp-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
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
        {/* ── Header ── */}
        <div
          className="flex-shrink-0 px-5 pt-4 pb-3"
          style={{ borderBottom: '1px solid rgba(46,204,113,0.15)', background: 'rgba(14,24,14,0.6)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div style={{
                background: 'rgba(46,204,113,0.1)',
                border: '1px solid rgba(46,204,113,0.25)',
                borderRadius: 8,
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
              }}>
                <Users size={16} color="#2ecc71" />
              </div>
              <span className="text-sm font-black tracking-widest uppercase font-mono" style={{ color: '#2ecc71', letterSpacing: 3 }}>
                Team Stats
              </span>
              {rows.length > 0 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{
                  background: 'rgba(46,204,113,0.08)',
                  border: '1px solid rgba(46,204,113,0.2)',
                  color: '#2ecc71',
                  letterSpacing: 1,
                }}>
                  {rows.length} {rows.length === 1 ? 'member' : 'members'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Refresh button */}
              <button
                onClick={fetchAll}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:bg-white/10 active:scale-90"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  color={loading ? '#444' : '#555'}
                  style={{ animation: loading ? 'sp-spin 0.8s linear infinite' : undefined }}
                />
                {refreshAgo !== null && !loading && (
                  <span style={{ fontSize: 8, color: '#444', fontFamily: 'monospace' }}>
                    {refreshAgo}s ago
                  </span>
                )}
              </button>

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-all duration-200 hover:bg-white/10 active:scale-90"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <X size={14} color="#666" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex-shrink-0 flex px-5 pt-1" style={{ background: 'rgba(14,24,14,0.4)' }}>
          <SPTabButton label="Fireteam" active={tab === 'fireteam'} onClick={() => setTab('fireteam')} />
          <SPTabButton label="Global" active={tab === 'global'} onClick={() => setTab('global')} />
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && rows.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <div className="text-xs font-mono tracking-widest uppercase" style={{ color: '#2ecc71', opacity: 0.4 }}>
                Loading...
              </div>
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Users size={28} color="#2ecc71" style={{ opacity: 0.15 }} />
              <div className="text-xs font-mono tracking-widest uppercase" style={{ color: '#444' }}>
                No data yet today
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((member, idx) => {
                const isOwn = member.managerId === currentUserId;
                const isExpanded = expandedId === member.managerId;
                return (
                  <MemberCard
                    key={member.managerId}
                    member={member}
                    rank={idx}
                    isOwn={isOwn}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : member.managerId)}
                    showDials={isOwn}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex-shrink-0 px-5 py-2 text-center"
          style={{ borderTop: '1px solid rgba(46,204,113,0.1)', background: 'rgba(14,24,14,0.4)' }}
        >
          <span className="text-xs font-mono" style={{ color: '#2ecc71', opacity: 0.2, letterSpacing: '2px', fontSize: 9 }}>
            {tab === 'fireteam' ? 'CAMPAIGN SCOPE' : 'GLOBAL — ALL CAMPAIGNS'} — TODAY
          </span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MEMBER CARD
// =============================================================================

interface MemberCardProps {
  member: MemberStats;
  rank: number;
  isOwn: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  showDials: boolean;
}

function MemberCard({ member, rank, isOwn, isExpanded, onToggle, showDials }: MemberCardProps) {
  const badgeCount = member.badges.length;

  return (
    <div
      style={{
        border: isOwn
          ? '1px solid rgba(46,204,113,0.35)'
          : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        background: isOwn
          ? 'rgba(46,204,113,0.04)'
          : 'rgba(255,255,255,0.015)',
        animation: isOwn ? 'sp-pulse 4s ease-in-out infinite' : undefined,
        overflow: 'hidden',
      }}
    >
      {/* Collapsed row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-all duration-150 hover:bg-white/5"
      >
        {/* Rank */}
        <span style={{ fontSize: 14, minWidth: 24, textAlign: 'center' }}>
          {getRankIcon(rank)}
        </span>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-black tracking-wider" style={{
            color: isOwn ? '#2ecc71' : '#d0d0d0',
            letterSpacing: 1,
          }}>
            {member.managerName}
            {isOwn && (
              <span style={{ color: '#2ecc71', opacity: 0.5, fontSize: 9, marginLeft: 6, fontWeight: 400 }}>YOU</span>
            )}
          </span>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <CollapsedStat label="PTS" value={member.points} color="#fff" />
          <CollapsedStat label="PB" value={member.pbs} color="#2ecc71" />
          <CollapsedStat label="PP" value={member.pps} color="#f1c40f" />
          <CollapsedStat label="PP$" value={`$${member.ppDollars}`} color="#e67e22" />
          <CollapsedStat label="🏅" value={badgeCount} color="#9b59b6" />
        </div>

        {/* Expand chevron */}
        <span style={{ color: '#444', fontSize: 10, marginLeft: 4 }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(0,0,0,0.2)',
            padding: '12px 14px',
          }}
        >
          {/* 6 stat cards */}
          <div className="grid grid-cols-6 gap-1.5 mb-3">
            <ExpandedStatCard label="PB"    value={member.pbs}            color="#2ecc71" />
            <ExpandedStatCard label="PP"    value={member.pps}            color="#f1c40f" />
            <ExpandedStatCard label="PP$"   value={`$${member.ppDollars}`} color="#e67e22" />
            <ExpandedStatCard label="PTS"   value={member.points}         color="#ffffff" />
            <ExpandedStatCard label="BADGES" value={badgeCount}           color="#9b59b6" />
            {showDials
              ? <ExpandedStatCard label="DIALS" value={member.totalDials} color="#3498db" />
              : <ExpandedStatCard label="DIALS" value="—"                 color="#444"    />
            }
          </div>

          {/* Badge log */}
          <BadgeLog badges={member.badges} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// BADGE LOG
// =============================================================================

function BadgeLog({ badges }: { badges: string[] }) {
  if (badges.length === 0) {
    return (
      <div className="text-xs py-4 text-center" style={{ color: '#333' }}>
        No badges earned yet today.
      </div>
    );
  }

  // Count occurrences and dedupe for display
  const countMap = new Map<string, number>();
  for (const id of badges) countMap.set(id, (countMap.get(id) ?? 0) + 1);
  const uniqueIds = Array.from(countMap.keys());

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div style={{ width: 3, height: 10, borderRadius: 2, background: '#9b59b6' }} />
        <span className="text-xs font-black tracking-widest uppercase font-mono" style={{ color: '#9b59b6', opacity: 0.6, letterSpacing: 2, fontSize: 9 }}>
          Badges Earned
        </span>
      </div>
      <div className="space-y-1">
        {uniqueIds.map((id) => {
          const def = BADGE_DEFS[id];
          if (!def) return null;
          const icon = getBadgeIcon(id, 18);
          const catColor = getBadgeCategoryColor(id);
          const count = countMap.get(id)!;

          return (
            <div
              key={id}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg"
              style={{ background: `${catColor}06`, border: `1px solid ${catColor}15` }}
            >
              <div className="flex-shrink-0" style={{ width: 18, height: 18 }}>
                {icon || <span style={{ fontSize: 14 }}>{def.icon}</span>}
              </div>
              <span className="text-xs font-bold flex-1" style={{ color: '#bbb', fontSize: 10 }}>
                {def.name}
              </span>
              {count > 1 && (
                <span className="text-xs font-black font-mono" style={{ color: catColor, fontSize: 10 }}>
                  ×{count}
                </span>
              )}
              <span className="text-xs font-mono" style={{ color: catColor, fontSize: 9 }}>
                +{def.bonus * count}
              </span>
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

function SPTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
        }} />
      )}
    </button>
  );
}

function CollapsedStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 32 }}>
      <span className="text-xs font-black font-mono" style={{ color, fontSize: 11, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 7, color, opacity: 0.4, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' as const, marginTop: 1 }}>
        {label}
      </span>
    </div>
  );
}

function ExpandedStatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center py-2 px-1 rounded-lg" style={{
      background: `${color}06`,
      border: `1px solid ${color}15`,
    }}>
      <span className="text-sm font-black font-mono" style={{ color, lineHeight: 1 }}>{value}</span>
      <span style={{
        fontSize: 7,
        color,
        opacity: 0.4,
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase' as const,
        marginTop: 2,
      }}>
        {label}
      </span>
    </div>
  );
}