// src/pages/Dialer/CampaignSelect.tsx
//
// Video-game-style campaign / map selection screen for AutoSniper.
// Think: Call of Duty map selection meets military command center.
// Each campaign = a route/area to dial. Rendered as terrain cards
// with satellite-style imagery, tactical stats, and a deploy button.

import { useState, useEffect, useRef, useCallback } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface Campaign {
  id: string;
  name: string;                   // Tab / route name
  codename?: string;              // "OP IRON GATE", "OP THUNDER RUN" — auto-generated if not set
  description?: string;           // Mission briefing text
  totalRows: number;              // Total client rows in the tab
  bookings: number;               // How many bookings are in the tab
  reachedPct: number;             // What % of clients have been reached (0-100)
  avgAttempts: number;            // Average attempts through all rows
  zone?: string;                  // City zone: "North", "East", "Downtown", etc.
  terrain?: 'residential' | 'commercial' | 'industrial' | 'mixed' | 'rural';
  lastDeployed?: string;          // ISO date of last run
  locked?: boolean;               // If true, campaign is not available
  lockedReason?: string;          // "Assigned to Marcus T."
  hot?: boolean;                  // Trending/high-opportunity flag
}

interface CampaignSelectProps {
  campaigns: Campaign[];
  onDeploy: (campaignId: string) => void;
  currentUserId?: string;
}

// =============================================================================
// CONSTANTS & HELPERS
// =============================================================================

const TERRAIN_ICON: Record<string, string> = {
  residential: '🏘️',
  commercial: '🏢',
  industrial: '🏭',
  mixed: '🌆',
  rural: '🌾',
};

const TERRAIN_LABEL: Record<string, string> = {
  residential: 'RESIDENTIAL',
  commercial: 'COMMERCIAL',
  industrial: 'INDUSTRIAL',
  mixed: 'MIXED OPS',
  rural: 'RURAL',
};

// Procedural terrain gradient based on terrain type
function terrainGradient(terrain?: string, hot?: boolean): string {
  if (hot) {
    return 'linear-gradient(135deg, rgba(255,60,20,0.18) 0%, rgba(180,40,0,0.12) 40%, rgba(30,10,5,0.95) 100%)';
  }
  switch (terrain) {
    case 'residential':
      return 'linear-gradient(135deg, rgba(46,204,113,0.12) 0%, rgba(20,60,30,0.1) 40%, rgba(8,16,8,0.95) 100%)';
    case 'commercial':
      return 'linear-gradient(135deg, rgba(52,152,219,0.12) 0%, rgba(15,40,70,0.1) 40%, rgba(8,12,20,0.95) 100%)';
    case 'industrial':
      return 'linear-gradient(135deg, rgba(149,165,166,0.15) 0%, rgba(50,50,50,0.1) 40%, rgba(12,12,12,0.95) 100%)';
    case 'mixed':
      return 'linear-gradient(135deg, rgba(241,196,15,0.1) 0%, rgba(60,50,10,0.08) 40%, rgba(12,14,8,0.95) 100%)';
    case 'rural':
      return 'linear-gradient(135deg, rgba(139,195,74,0.12) 0%, rgba(40,60,20,0.1) 40%, rgba(10,16,8,0.95) 100%)';
    default:
      return 'linear-gradient(135deg, rgba(46,204,113,0.08) 0%, rgba(10,18,10,0.95) 100%)';
  }
}

function terrainAccent(terrain?: string, hot?: boolean): string {
  if (hot) return '#ff4422';
  switch (terrain) {
    case 'residential': return '#2ecc71';
    case 'commercial': return '#3498db';
    case 'industrial': return '#95a5a6';
    case 'mixed': return '#f1c40f';
    case 'rural': return '#8bc34a';
    default: return '#2ecc71';
  }
}

function threatColor(level: number): string {
  if (level <= 1) return '#2ecc71';
  if (level === 2) return '#f1c40f';
  if (level === 3) return '#e67e22';
  if (level === 4) return '#e74c3c';
  return '#ff0040';
}

/** Derive difficulty 1-5 from reached% and avg attempts. High reached + high attempts = harder. */
function deriveThreat(reachedPct: number, avgAttempts: number): 1 | 2 | 3 | 4 | 5 {
  // Score: high reached% = more worked over, high avgAttempts = harder to convert
  const score = (reachedPct / 100) * 0.4 + Math.min(avgAttempts / 6, 1) * 0.6;
  if (score < 0.2) return 1;
  if (score < 0.4) return 2;
  if (score < 0.6) return 3;
  if (score < 0.8) return 4;
  return 5;
}

/** Reach status label */
function reachStatus(pct: number): { label: string; color: string } {
  if (pct < 20) return { label: 'FRESH', color: '#2ecc71' };
  if (pct < 50) return { label: 'ACTIVE', color: '#f1c40f' };
  if (pct < 80) return { label: 'WORKED', color: '#e67e22' };
  return { label: 'SATURATED', color: '#e74c3c' };
}

function formatDate(iso?: string): string {
  if (!iso) return 'NEVER';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays < 7) return `${diffDays}d AGO`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

// Procedural topo-map pattern SVG (unique per campaign based on id hash)
function topoPattern(id: string, accent: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const abs = Math.abs(hash);
  const r1 = 30 + (abs % 40);
  const r2 = 50 + ((abs >> 4) % 30);
  const r3 = 70 + ((abs >> 8) % 25);
  const cx = 40 + (abs % 20);
  const cy = 35 + ((abs >> 3) % 30);

  return `<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'>
    <ellipse cx='${cx}' cy='${cy}' rx='${r1}' ry='${r1 - 8}' fill='none' stroke='${accent}' stroke-width='0.3' opacity='0.15'/>
    <ellipse cx='${cx}' cy='${cy}' rx='${r2}' ry='${r2 - 12}' fill='none' stroke='${accent}' stroke-width='0.25' opacity='0.1'/>
    <ellipse cx='${cx}' cy='${cy}' rx='${r3}' ry='${r3 - 15}' fill='none' stroke='${accent}' stroke-width='0.2' opacity='0.07'/>
    <line x1='${10 + abs % 20}' y1='0' x2='${60 + abs % 30}' y2='100' stroke='${accent}' stroke-width='0.2' opacity='0.08'/>
    <line x1='${30 + (abs >> 2) % 20}' y1='0' x2='${40 + (abs >> 2) % 30}' y2='100' stroke='${accent}' stroke-width='0.15' opacity='0.06'/>
    <circle cx='${20 + abs % 60}' cy='${20 + (abs >> 1) % 60}' r='2' fill='${accent}' opacity='0.12'/>
    <circle cx='${50 + (abs >> 3) % 30}' cy='${50 + (abs >> 5) % 30}' r='1.5' fill='${accent}' opacity='0.1'/>
  </svg>`;
}

// Grid overlay SVG
function gridOverlay(accent: string): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>
    <line x1='0' y1='40' x2='40' y2='40' stroke='${accent}' stroke-width='0.3' opacity='0.06'/>
    <line x1='40' y1='0' x2='40' y2='40' stroke='${accent}' stroke-width='0.3' opacity='0.06'/>
  </svg>`;
}

// =============================================================================
// STYLES
// =============================================================================

const CAMPAIGN_STYLES = `
  @keyframes cs-scan-line {
    0% { top: -2px; }
    100% { top: 100%; }
  }
  @keyframes cs-card-enter {
    0% { transform: translateY(20px) scale(0.97); opacity: 0; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  @keyframes cs-hot-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255,68,34,0.15), inset 0 0 20px rgba(255,68,34,0.04); }
    50% { box-shadow: 0 0 24px rgba(255,68,34,0.35), inset 0 0 30px rgba(255,68,34,0.08); }
  }
  @keyframes cs-deploy-glow {
    0%, 100% { box-shadow: 0 0 12px rgba(46,204,113,0.3), 0 0 40px rgba(46,204,113,0.1); }
    50% { box-shadow: 0 0 20px rgba(46,204,113,0.6), 0 0 60px rgba(46,204,113,0.25); }
  }
  @keyframes cs-deploy-confirm {
    0% { transform: scale(1); }
    30% { transform: scale(0.95); }
    60% { transform: scale(1.04); }
    100% { transform: scale(1); }
  }
  @keyframes cs-header-slide {
    0% { transform: translateY(-30px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes cs-noise {
    0% { background-position: 0 0; }
    100% { background-position: 100px 100px; }
  }
  @keyframes cs-threat-fill {
    0% { width: 0; }
    100% { width: var(--threat-width); }
  }
`;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CampaignSelect({ campaigns, onDeploy }: CampaignSelectProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [filter, setFilter] = useState<'all' | 'residential' | 'commercial' | 'industrial' | 'mixed' | 'rural'>('all');
  const detailRef = useRef<HTMLDivElement>(null);

  const selected = campaigns.find(c => c.id === selectedId) ?? null;

  const filtered = filter === 'all'
    ? campaigns
    : campaigns.filter(c => c.terrain === filter);

  // Sort: hot first, then unlocked, then by name
  const sorted = [...filtered].sort((a, b) => {
    if (a.hot && !b.hot) return -1;
    if (!a.hot && b.hot) return 1;
    if (a.locked && !b.locked) return 1;
    if (!a.locked && b.locked) return -1;
    return a.name.localeCompare(b.name);
  });

  const handleDeploy = useCallback(() => {
    if (!selected || selected.locked || deploying) return;
    setDeploying(true);
    // Brief animation, then fire callback
    setTimeout(() => {
      onDeploy(selected.id);
    }, 600);
  }, [selected, deploying, onDeploy]);

  // Scroll detail panel into view on mobile when selection changes
  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  return (
    <>
      <style>{CAMPAIGN_STYLES}</style>

      <div
        style={{
          minHeight: '100vh',
          background: '#060a06',
          color: '#ddd',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* === NOISE OVERLAY === */}
        <div style={{
          position: 'fixed',
          inset: 0,
          opacity: 0.03,
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>`)}")`,
          backgroundSize: '200px 200px',
          pointerEvents: 'none',
          zIndex: 0,
        }} />

        {/* === HEADER === */}
        <div
          style={{
            padding: '24px 24px 0',
            position: 'relative',
            zIndex: 2,
            animation: 'cs-header-slide 0.5s ease-out both',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 8 }}>
            <div>
              <div style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '4px',
                color: '#2ecc71',
                opacity: 0.5,
                textTransform: 'uppercase',
                marginBottom: 4,
              }}>
                AUTOSNIPER M82 // TACTICAL OPERATIONS
              </div>
              <h1 style={{
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: '3px',
                color: '#fff',
                textTransform: 'uppercase',
                margin: 0,
                lineHeight: 1,
                textShadow: '0 0 30px rgba(46,204,113,0.15)',
              }}>
                SELECT CAMPAIGN
              </h1>
            </div>
            <div style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 9,
              color: '#2ecc71',
              opacity: 0.4,
              fontWeight: 700,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#2ecc71',
                display: 'inline-block',
                animation: 'cs-hot-pulse 2s ease-in-out infinite',
              }} />
              {campaigns.filter(c => !c.locked).length} CAMPAIGNS AVAILABLE
            </div>
          </div>

          {/* Divider */}
          <div style={{
            height: 1,
            background: 'linear-gradient(to right, rgba(46,204,113,0.5) 0%, rgba(46,204,113,0.1) 60%, transparent 100%)',
            marginBottom: 16,
          }} />

          {/* === TERRAIN FILTER TABS === */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
            {(['all', 'residential', 'commercial', 'industrial', 'mixed', 'rural'] as const).map(t => {
              const isActive = filter === t;
              const count = t === 'all' ? campaigns.length : campaigns.filter(c => c.terrain === t).length;
              if (t !== 'all' && count === 0) return null;
              return (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 4,
                    border: `1px solid ${isActive ? '#2ecc71' : 'rgba(255,255,255,0.08)'}`,
                    background: isActive
                      ? 'rgba(46,204,113,0.12)'
                      : 'rgba(255,255,255,0.02)',
                    color: isActive ? '#2ecc71' : '#666',
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: 'inherit',
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {t === 'all' ? 'ALL OPS' : TERRAIN_LABEL[t] || t.toUpperCase()}
                  <span style={{ marginLeft: 6, opacity: 0.5, fontSize: 8 }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* === MAIN GRID: Cards + Detail Panel === */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selected ? '1fr 380px' : '1fr',
            gap: 0,
            minHeight: 'calc(100vh - 160px)',
            position: 'relative',
            zIndex: 2,
            transition: 'grid-template-columns 0.3s ease',
          }}
        >
          {/* --- Campaign Cards --- */}
          <div
            style={{
              padding: '0 24px 24px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {sorted.map((c, idx) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                isSelected={c.id === selectedId}
                index={idx}
                onSelect={() => {
                  setSelectedId(c.id === selectedId ? null : c.id);
                  setDeploying(false);
                }}
              />
            ))}

            {sorted.length === 0 && (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '60px 20px',
                color: '#444',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '2px',
              }}>
                NO CAMPAIGNS MATCH THIS FILTER
              </div>
            )}
          </div>

          {/* --- Detail Panel (right sidebar) --- */}
          {selected && (
            <DetailPanel
              ref={detailRef}
              campaign={selected}
              deploying={deploying}
              onDeploy={handleDeploy}
              onClose={() => { setSelectedId(null); setDeploying(false); }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// =============================================================================
// CAMPAIGN CARD
// =============================================================================

function CampaignCard({
  campaign: c,
  isSelected,
  index,
  onSelect,
}: {
  campaign: Campaign;
  isSelected: boolean;
  index: number;
  onSelect: () => void;
}) {
  // Defensive defaults for numeric fields
  c = { ...c, totalRows: c.totalRows ?? 0, bookings: c.bookings ?? 0, reachedPct: c.reachedPct ?? 0, avgAttempts: c.avgAttempts ?? 0 };
  const accent = terrainAccent(c.terrain, c.hot);
  const bg = terrainGradient(c.terrain, c.hot);
  const grid = gridOverlay(accent);
  const topo = topoPattern(c.id, accent);

  return (
    <div
      onClick={c.locked ? undefined : onSelect}
      style={{
        position: 'relative',
        borderRadius: 8,
        border: `1.5px solid ${isSelected ? accent : c.locked ? 'rgba(255,255,255,0.04)' : `${accent}25`}`,
        background: bg,
        cursor: c.locked ? 'not-allowed' : 'pointer',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        transform: isSelected ? 'scale(1.01)' : 'scale(1)',
        boxShadow: isSelected
          ? `0 4px 24px rgba(0,0,0,0.5), 0 0 20px ${accent}30`
          : '0 2px 8px rgba(0,0,0,0.3)',
        opacity: c.locked ? 0.45 : 1,
        animation: `cs-card-enter 0.4s ease-out ${index * 0.04}s both`,
        ...(c.hot && !c.locked ? {
          animation: `cs-card-enter 0.4s ease-out ${index * 0.04}s both, cs-hot-pulse 3s ease-in-out infinite`,
        } : {}),
      }}
    >
      {/* Topo map background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(topo)}")`,
        backgroundSize: 'cover',
        pointerEvents: 'none',
      }} />

      {/* Grid overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(grid)}")`,
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      {/* Scan line effect on selected */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(to right, transparent, ${accent}40, transparent)`,
          animation: 'cs-scan-line 2s linear infinite',
          pointerEvents: 'none',
          zIndex: 5,
        }} />
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px' }}>
        {/* Top row: codename + terrain badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          {c.codename && (
            <span style={{
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '2.5px',
              color: accent,
              opacity: 0.6,
              textTransform: 'uppercase',
            }}>
              {c.codename}
            </span>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {c.hot && (
              <span style={{
                fontSize: 7,
                fontWeight: 900,
                letterSpacing: '1.5px',
                color: '#ff4422',
                background: 'rgba(255,68,34,0.12)',
                border: '1px solid rgba(255,68,34,0.3)',
                borderRadius: 3,
                padding: '2px 6px',
              }}>
                🔥 HOT
              </span>
            )}
            {c.terrain && (
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                color: accent,
                opacity: 0.5,
              }}>
                {TERRAIN_ICON[c.terrain]}
              </span>
            )}
          </div>
        </div>

        {/* Campaign name */}
        <h3 style={{
          fontSize: 16,
          fontWeight: 900,
          color: '#fff',
          margin: '0 0 8px 0',
          letterSpacing: '0.5px',
          lineHeight: 1.2,
          textShadow: isSelected ? `0 0 12px ${accent}40` : 'none',
        }}>
          {c.name}
        </h3>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <MiniStat label="ROWS" value={(c.totalRows ?? 0).toLocaleString()} color={accent} />
          <MiniStat label="BOOKINGS" value={c.bookings ?? 0} color={(c.bookings ?? 0) > 0 ? '#f1c40f' : '#555'} />
          <MiniStat label="REACHED" value={`${Math.round(c.reachedPct ?? 0)}%`} color={reachStatus(c.reachedPct ?? 0).color} />
          <MiniStat label="AVG ATT" value={(c.avgAttempts ?? 0).toFixed(1)} color={accent} />
        </div>

        {/* Reached progress bar */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            height: 3,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(c.reachedPct, 100)}%`,
              borderRadius: 2,
              background: `linear-gradient(to right, ${reachStatus(c.reachedPct).color}80, ${reachStatus(c.reachedPct).color})`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Bottom row: threat level + last deployed */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Threat bars (derived from data) */}
          {(() => {
            const threat = deriveThreat(c.reachedPct, c.avgAttempts);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 7, fontWeight: 700, color: '#555', letterSpacing: '1px' }}>DIFF</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div
                      key={i}
                      style={{
                        width: 12,
                        height: 4,
                        borderRadius: 1,
                        background: i <= threat
                          ? threatColor(threat)
                          : 'rgba(255,255,255,0.06)',
                        transition: 'background 0.3s ease',
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          <span style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px' }}>
            {c.locked ? `🔒 ${c.lockedReason || 'LOCKED'}` : `LAST: ${formatDate(c.lastDeployed)}`}
          </span>
        </div>
      </div>

      {/* Selected indicator bar */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
        }} />
      )}
    </div>
  );
}

// =============================================================================
// DETAIL PANEL (right sidebar)
// =============================================================================

const DetailPanel = ({ campaign: c, deploying, onDeploy, onClose, ref }: {
  campaign: Campaign;
  deploying: boolean;
  onDeploy: () => void;
  onClose: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) => {
  // Defensive defaults for numeric fields
  c = { ...c, totalRows: c.totalRows ?? 0, bookings: c.bookings ?? 0, reachedPct: c.reachedPct ?? 0, avgAttempts: c.avgAttempts ?? 0 };
  const accent = terrainAccent(c.terrain, c.hot);
  const topo = topoPattern(c.id + '_detail', accent);

  return (
    <div
      ref={ref}
      style={{
        borderLeft: `1px solid ${accent}30`,
        background: 'rgba(6,10,6,0.98)',
        height: 'calc(100vh - 160px)',
        overflowY: 'auto',
        position: 'sticky',
        top: 160,
        animation: 'cs-card-enter 0.3s ease-out both',
      }}
    >
      {/* Topo bg */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(topo)}")`,
        backgroundSize: 'cover',
        pointerEvents: 'none',
        opacity: 0.6,
      }} />

      <div style={{ position: 'relative', zIndex: 2, padding: '20px 20px 24px' }}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.03)',
            color: '#666',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Mission briefing header */}
        <div style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: '3px',
          color: accent,
          opacity: 0.5,
          marginBottom: 4,
        }}>
          MISSION BRIEFING
        </div>

        {c.codename && (
          <div style={{
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: '3px',
            color: accent,
            marginBottom: 6,
          }}>
            {c.codename}
          </div>
        )}

        <h2 style={{
          fontSize: 22,
          fontWeight: 900,
          color: '#fff',
          margin: '0 0 6px 0',
          letterSpacing: '1px',
          lineHeight: 1.15,
        }}>
          {c.name}
        </h2>

        {/* Terrain + Zone badge */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {c.terrain && (
            <span style={{
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '1.5px',
              color: accent,
              background: `${accent}12`,
              border: `1px solid ${accent}30`,
              borderRadius: 4,
              padding: '3px 8px',
            }}>
              {TERRAIN_ICON[c.terrain]} {TERRAIN_LABEL[c.terrain]}
            </span>
          )}
          {c.zone && (
            <span style={{
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '1.5px',
              color: '#999',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 4,
              padding: '3px 8px',
            }}>
              📍 {c.zone}
            </span>
          )}
        </div>

        {/* Description */}
        {c.description && (
          <p style={{
            fontSize: 11,
            color: '#777',
            lineHeight: 1.6,
            margin: '0 0 20px 0',
            borderLeft: `2px solid ${accent}30`,
            paddingLeft: 12,
          }}>
            {c.description}
          </p>
        )}

        {/* Divider */}
        <div style={{
          height: 1,
          background: `linear-gradient(to right, ${accent}30, transparent)`,
          marginBottom: 16,
        }} />

        {/* Operational Data */}
        <div style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: '3px',
          color: '#555',
          marginBottom: 10,
        }}>
          OPERATIONAL DATA
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <DataBlock label="TOTAL ROWS" value={(c.totalRows ?? 0).toLocaleString()} accent={accent} />
          <DataBlock label="BOOKINGS" value={c.bookings ?? 0} accent={(c.bookings ?? 0) > 0 ? '#f1c40f' : '#555'} />
          <DataBlock
            label="DIFFICULTY"
            value={<ThreatBar level={deriveThreat(c.reachedPct, c.avgAttempts)} />}
            accent={accent}
          />
          <DataBlock
            label="LAST DEPLOYED"
            value={formatDate(c.lastDeployed)}
            accent={accent}
          />
        </div>

        {/* Reached % gauge */}
        <div style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: '3px',
          color: '#555',
          marginBottom: 10,
        }}>
          TERRITORY COVERAGE
        </div>

        <div style={{
          padding: '14px 14px',
          borderRadius: 6,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          marginBottom: 12,
        }}>
          {/* Reached % big number */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <span style={{
                fontSize: 28,
                fontWeight: 900,
                color: reachStatus(c.reachedPct).color,
                lineHeight: 1,
              }}>
                {Math.round(c.reachedPct)}
              </span>
              <span style={{
                fontSize: 12,
                fontWeight: 800,
                color: reachStatus(c.reachedPct).color,
                opacity: 0.6,
                marginLeft: 2,
              }}>
                %
              </span>
            </div>
            <span style={{
              fontSize: 8,
              fontWeight: 900,
              letterSpacing: '1.5px',
              color: reachStatus(c.reachedPct).color,
              background: `${reachStatus(c.reachedPct).color}12`,
              border: `1px solid ${reachStatus(c.reachedPct).color}30`,
              borderRadius: 3,
              padding: '2px 8px',
            }}>
              {reachStatus(c.reachedPct).label}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            height: 6,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(c.reachedPct, 100)}%`,
              borderRadius: 3,
              background: `linear-gradient(to right, ${reachStatus(c.reachedPct).color}60, ${reachStatus(c.reachedPct).color})`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{
            fontSize: 8,
            color: '#555',
            marginTop: 6,
            fontWeight: 600,
          }}>
            {Math.round((c.totalRows ?? 0) * (c.reachedPct ?? 0) / 100)} of {(c.totalRows ?? 0).toLocaleString()} clients reached
          </div>
        </div>

        {/* Avg Attempts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          <DataBlock
            label="AVG ATTEMPTS"
            value={(c.avgAttempts ?? 0).toFixed(1)}
            accent={accent}
          />
          <DataBlock
            label="UNREACHED"
            value={Math.round((c.totalRows ?? 0) * (1 - (c.reachedPct ?? 0) / 100)).toLocaleString()}
            accent={(c.reachedPct ?? 0) < 80 ? '#2ecc71' : '#e74c3c'}
          />
        </div>

        {/* === DEPLOY BUTTON === */}
        <button
          onClick={onDeploy}
          disabled={c.locked || deploying}
          style={{
            width: '100%',
            padding: '16px 20px',
            borderRadius: 8,
            border: c.locked
              ? '1.5px solid rgba(255,255,255,0.06)'
              : `1.5px solid ${deploying ? accent : `${accent}80`}`,
            background: c.locked
              ? 'rgba(255,255,255,0.02)'
              : deploying
                ? `${accent}25`
                : `linear-gradient(135deg, ${accent}15 0%, ${accent}08 100%)`,
            color: c.locked ? '#444' : deploying ? '#fff' : accent,
            fontSize: 14,
            fontWeight: 900,
            fontFamily: 'inherit',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            cursor: c.locked ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            animation: !c.locked && !deploying ? 'cs-deploy-glow 3s ease-in-out infinite' : deploying ? 'cs-deploy-confirm 0.5s ease-out both' : 'none',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Sweep animation on deploy */}
          {deploying && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(90deg, transparent 0%, ${accent}30 50%, transparent 100%)`,
              animation: 'cs-scan-line 0.6s linear forwards',
            }} />
          )}
          <span style={{ position: 'relative', zIndex: 1 }}>
            {c.locked ? '🔒 LOCKED' : deploying ? '⚡ DEPLOYING...' : '🎯 DEPLOY'}
          </span>
        </button>

        {c.locked && c.lockedReason && (
          <div style={{
            textAlign: 'center',
            fontSize: 9,
            color: '#555',
            marginTop: 8,
            fontWeight: 600,
          }}>
            {c.lockedReason}
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 7, fontWeight: 700, color: '#444', letterSpacing: '1px', marginBottom: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function DataBlock({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ fontSize: 7, fontWeight: 700, color: '#555', letterSpacing: '1.5px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, color: accent, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function ThreatBar({ level }: { level: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          style={{
            width: 16,
            height: 6,
            borderRadius: 2,
            background: i <= level ? threatColor(level) : 'rgba(255,255,255,0.06)',
          }}
        />
      ))}
      <span style={{ fontSize: 9, fontWeight: 800, color: threatColor(level), marginLeft: 4 }}>
        {level}/5
      </span>
    </div>
  );
}