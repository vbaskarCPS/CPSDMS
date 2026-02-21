// src/pages/Dialer/SniperSettings.tsx
//
// Sniper filter configuration modal for AutoSniper.
// Tactical HUD aesthetic matching the rest of the dialer UI.
// Configures: years, ppOnly, minEntries, linkShot, hideCTS, maxNA (BLACKLIST),
//             teamCooldownEnabled, teamCooldownDays, selfCooldownDays (NA COOLDOWN).
//
// Layout: 2-column grid for compact controls — no scrolling needed.
//

import { useState, useEffect, useCallback } from 'react';
import { campaignService } from '../../lib/campaignService';
import type { SniperConfig } from '../../lib/campaignService';
import { DEFAULT_SNIPER_CONFIG } from '../../lib/campaignService';

// =============================================================================
// TYPES
// =============================================================================

interface SniperSettingsProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  currentConfig: SniperConfig;
  availableYears: number[];
  onConfigSaved: (config: SniperConfig) => void;
}

// =============================================================================
// STYLES (keyframes)
// =============================================================================

const SETTINGS_KEYFRAMES = `
  @keyframes ss-fade-in {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }
  @keyframes ss-slide-up {
    0% { transform: translateY(24px) scale(0.97); opacity: 0; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
`;

const CY = '#00e5ff';
const GR = '#2ecc71';
const YL = '#f1c40f';
const RD = '#e74c3c';
const BL = '#ff4444';
const OR = '#f5a623';

// =============================================================================
// COMPONENT
// =============================================================================

export default function SniperSettings({
  open,
  onClose,
  campaignId,
  currentConfig,
  availableYears,
  onConfigSaved,
}: SniperSettingsProps) {
  const [years, setYears] = useState<number[]>(currentConfig.years);
  const [ppOnly, setPpOnly] = useState(currentConfig.ppOnly);
  const [minEntries, setMinEntries] = useState(currentConfig.minEntries);
  const [linkShot, setLinkShot] = useState(currentConfig.linkShot);
  const [hideCTS, setHideCTS] = useState(currentConfig.hideCTS);
  const [maxNA, setMaxNA] = useState(currentConfig.maxNA ?? 0);
  const [teamCooldownEnabled, setTeamCooldownEnabled] = useState(currentConfig.teamCooldownEnabled ?? true);
  const [teamCooldownDays, setTeamCooldownDays] = useState(currentConfig.teamCooldownDays ?? 2);
  const [selfCooldownDays, setSelfCooldownDays] = useState(currentConfig.selfCooldownDays ?? 4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setYears([...currentConfig.years]);
      setPpOnly(currentConfig.ppOnly);
      setMinEntries(currentConfig.minEntries);
      setLinkShot(currentConfig.linkShot);
      setHideCTS(currentConfig.hideCTS);
      setMaxNA(currentConfig.maxNA ?? 0);
      setTeamCooldownEnabled(currentConfig.teamCooldownEnabled ?? true);
      setTeamCooldownDays(currentConfig.teamCooldownDays ?? 2);
      setSelfCooldownDays(currentConfig.selfCooldownDays ?? 4);
      setError('');
      setSaving(false);
    }
  }, [open, currentConfig]);

  const toggleYear = useCallback((yr: number) => {
    setYears(prev => {
      if (prev.includes(yr)) {
        if (prev.length <= 1) return prev;
        return prev.filter(y => y !== yr);
      }
      return [...prev, yr].sort((a, b) => b - a);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const config: SniperConfig = {
      years,
      ppOnly,
      minEntries: Math.max(1, minEntries),
      linkShot,
      hideCTS,
      maxNA,
      teamCooldownEnabled,
      teamCooldownDays: Math.min(7, Math.max(1, teamCooldownDays)),
      selfCooldownDays: Math.min(7, Math.max(1, selfCooldownDays)),
    };
    try {
      await campaignService.updateSniperConfig(campaignId, config);
      onConfigSaved(config);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setYears([...DEFAULT_SNIPER_CONFIG.years]);
    setPpOnly(DEFAULT_SNIPER_CONFIG.ppOnly);
    setMinEntries(DEFAULT_SNIPER_CONFIG.minEntries);
    setLinkShot(DEFAULT_SNIPER_CONFIG.linkShot);
    setHideCTS(DEFAULT_SNIPER_CONFIG.hideCTS);
    setMaxNA(DEFAULT_SNIPER_CONFIG.maxNA ?? 0);
    setTeamCooldownEnabled(DEFAULT_SNIPER_CONFIG.teamCooldownEnabled);
    setTeamCooldownDays(DEFAULT_SNIPER_CONFIG.teamCooldownDays);
    setSelfCooldownDays(DEFAULT_SNIPER_CONFIG.selfCooldownDays);
  };

  if (!open) return null;

  const yearOptions = Array.from(new Set([...availableYears, ...years])).sort((a, b) => b - a);
  const maxNALabel = maxNA === 0 ? 'OFF' : maxNA >= 10 ? 'NA 10+' : `NA ${maxNA}+`;

  return (
    <>
      <style>{SETTINGS_KEYFRAMES}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          animation: 'ss-fade-in 0.15s ease-out both',
        }}
      />

      {/* Modal — vertically centered, no scroll */}
      <div
        style={{
          position: 'fixed',
          top: '16px', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 61,
          width: 'calc(100vw - 32px)',
          maxWidth: 600,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          borderRadius: 12,
          borderTop: `2px solid ${CY}50`,
          background: 'rgba(0,14,22,0.97)',
          border: `1.5px solid ${CY}30`,
          boxShadow: `0 12px 60px rgba(0,0,0,0.8), 0 0 40px ${CY}08`,
          fontFamily: '"Segoe UI", Arial, sans-serif',
          animation: 'ss-slide-up 0.25s ease-out both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '14px 18px 18px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '3px', color: CY, opacity: 0.45, textTransform: 'uppercase', marginBottom: 3 }}>
                SCOPE CONFIGURATION
              </div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                Sniper Filters
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 6,
                border: `1px solid ${CY}20`, background: `${CY}08`,
                color: '#666', fontSize: 15, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>

          {/* ── TARGET YEARS — full width ── */}
          <Cell label="TARGET YEARS" hint="Groups must have ≥1 row matching a selected year" fullWidth>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {yearOptions.map(yr => {
                const active = years.includes(yr);
                const inSheet = availableYears.includes(yr);
                return (
                  <button
                    key={yr}
                    onClick={() => toggleYear(yr)}
                    style={{
                      padding: '5px 14px', borderRadius: 5,
                      border: `1.5px solid ${active ? CY : 'rgba(255,255,255,0.08)'}`,
                      background: active ? `${CY}15` : 'rgba(255,255,255,0.02)',
                      color: active ? CY : inSheet ? '#555' : '#333',
                      fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      transition: 'all 0.15s ease', letterSpacing: '0.5px',
                      opacity: inSheet ? 1 : 0.5,
                    }}
                  >{yr}</button>
                );
              })}
              {yearOptions.length === 0 && (
                <span style={{ fontSize: 10, color: '#444' }}>No year data found in sheet</span>
              )}
            </div>
          </Cell>

          {/* ── 2-COLUMN GRID ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>

            {/* PREPAID ONLY + MINIMUM ENTRIES */}
            <Cell label="PREPAID ONLY" hint="Only show groups with ≥1 prepaid row">
              <Toggle active={ppOnly} onToggle={() => setPpOnly(!ppOnly)} labelOn="ACTIVE" labelOff="OFF" color={YL} />
            </Cell>

            <Cell label="MINIMUM ENTRIES" hint="Groups must have at least this many rows">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setMinEntries(prev => Math.max(1, prev - 1))} style={stepBtnStyle}>−</button>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', minWidth: 28, textAlign: 'center' }}>
                  {minEntries}
                </span>
                <button onClick={() => setMinEntries(prev => Math.min(20, prev + 1))} style={stepBtnStyle}>+</button>
              </div>
            </Cell>

            {/* LINK SHOT + HIDE CTS */}
            <Cell label="LINK SHOT" hint="Only show groups on streets with AER bookings">
              <Toggle active={linkShot} onToggle={() => setLinkShot(!linkShot)} labelOn="ACTIVE" labelOff="OFF" color={GR} />
            </Cell>

            <Cell label="HIDE CTS" hint="Skip groups where any row has a CTS disposition">
              <Toggle active={hideCTS} onToggle={() => setHideCTS(!hideCTS)} labelOn="HIDING" labelOff="SHOWING" color={RD} />
            </Cell>

            {/* BLACKLIST + NA COOLDOWN */}
            <Cell label="☠ BLACKLIST" hint={maxNA === 0 ? 'No NA filter — all groups pass through' : `Groups with any NA ≥ ${maxNA} are eliminated`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setMaxNA(prev => Math.max(0, prev - 1))}
                  style={{ ...stepBtnStyle, borderColor: `${BL}25`, background: `${BL}08`, color: BL }}
                >−</button>
                <span style={{ fontSize: 15, fontWeight: 900, minWidth: 46, textAlign: 'center', color: maxNA === 0 ? '#444' : BL }}>
                  {maxNALabel}
                </span>
                <button
                  onClick={() => setMaxNA(prev => Math.min(10, prev + 1))}
                  style={{ ...stepBtnStyle, borderColor: `${BL}25`, background: `${BL}08`, color: BL }}
                >+</button>
              </div>
              {maxNA > 0 && (
                <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <div key={i} style={{
                      flex: 1, height: 3, borderRadius: 2,
                      background: i < maxNA ? BL : 'rgba(255,68,68,0.12)',
                      transition: 'background 0.15s ease',
                    }} />
                  ))}
                </div>
              )}
            </Cell>

            <Cell label="⏱ NA COOLDOWN" hint="Silently skip clients recently marked NA">
              {/* Team toggle + days */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: teamCooldownEnabled ? 5 : 0 }}>
                <Toggle
                  active={teamCooldownEnabled}
                  onToggle={() => setTeamCooldownEnabled(prev => !prev)}
                  labelOn="ACTIVE" labelOff="OFF" color={OR} compact
                />
                {teamCooldownEnabled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => setTeamCooldownDays(prev => Math.max(1, prev - 1))}
                      style={{ ...stepBtnStyle, borderColor: `${OR}25`, background: `${OR}08`, color: OR, width: 22, height: 22, fontSize: 13 }}
                    >−</button>
                    <span style={{ fontSize: 13, fontWeight: 900, color: OR, minWidth: 26, textAlign: 'center' }}>
                      {teamCooldownDays}d
                    </span>
                    <button
                      onClick={() => setTeamCooldownDays(prev => Math.min(7, prev + 1))}
                      style={{ ...stepBtnStyle, borderColor: `${OR}25`, background: `${OR}08`, color: OR, width: 22, height: 22, fontSize: 13 }}
                    >+</button>
                  </div>
                )}
              </div>
              {teamCooldownEnabled && (
                <>
                  {/* Team progress bar */}
                  <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                    {Array.from({ length: 7 }, (_, i) => (
                      <div key={i} style={{
                        flex: 1, height: 2, borderRadius: 1,
                        background: i < teamCooldownDays ? OR : `${OR}18`,
                        transition: 'background 0.15s ease',
                      }} />
                    ))}
                  </div>
                  {/* Self cooldown */}
                  <div style={{ fontSize: 8, color: OR, opacity: 0.45, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                    SELF
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <button
                      onClick={() => setSelfCooldownDays(prev => Math.max(1, prev - 1))}
                      style={{ ...stepBtnStyle, borderColor: `${OR}20`, background: `${OR}06`, color: `${OR}99`, width: 22, height: 22, fontSize: 13 }}
                    >−</button>
                    <span style={{ fontSize: 13, fontWeight: 900, color: `${OR}aa`, minWidth: 26, textAlign: 'center' }}>
                      {selfCooldownDays}d
                    </span>
                    <button
                      onClick={() => setSelfCooldownDays(prev => Math.min(7, prev + 1))}
                      style={{ ...stepBtnStyle, borderColor: `${OR}20`, background: `${OR}06`, color: `${OR}99`, width: 22, height: 22, fontSize: 13 }}
                    >+</button>
                  </div>
                  {/* Self progress bar */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {Array.from({ length: 7 }, (_, i) => (
                      <div key={i} style={{
                        flex: 1, height: 2, borderRadius: 1,
                        background: i < selfCooldownDays ? `${OR}99` : `${OR}12`,
                        transition: 'background 0.15s ease',
                      }} />
                    ))}
                  </div>
                </>
              )}
            </Cell>

          </div>{/* end 2-col grid */}

          {/* Divider */}
          <div style={{ height: 1, background: `linear-gradient(to right, ${CY}25, transparent)`, margin: '14px 0' }} />

          {/* Error */}
          {error && (
            <div style={{ fontSize: 10, color: RD, textAlign: 'center', marginBottom: 10, fontWeight: 600 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleReset}
              style={{
                padding: '10px 14px', borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#666', fontSize: 10, fontWeight: 800,
                letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >Reset</button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: '10px 20px', borderRadius: 6,
                border: `1.5px solid ${saving ? '#333' : `${GR}80`}`,
                background: saving ? '#222' : `linear-gradient(135deg, ${GR}18 0%, ${GR}08 100%)`,
                color: saving ? '#666' : GR,
                fontSize: 12, fontWeight: 900, letterSpacing: '3px',
                textTransform: 'uppercase', cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
              }}
            >{saving ? 'SAVING...' : '✓ SAVE CONFIG'}</button>
          </div>

        </div>
      </div>
    </>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function Cell({
  label,
  hint,
  children,
  fullWidth,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div style={{
      gridColumn: fullWidth ? '1 / -1' : undefined,
      background: 'rgba(0,229,255,0.02)',
      border: `1px solid ${CY}10`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{
        fontSize: 8, fontWeight: 800, letterSpacing: '2px',
        color: CY, opacity: 0.5, textTransform: 'uppercase', marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 8, color: '#3a5060', marginBottom: 7, fontWeight: 500, lineHeight: 1.4 }}>
        {hint}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  active,
  onToggle,
  labelOn,
  labelOff,
  color,
  compact,
}: {
  active: boolean;
  onToggle: () => void;
  labelOn: string;
  labelOff: string;
  color: string;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center',
        gap: compact ? 7 : 10,
        padding: compact ? '6px 11px' : '8px 16px',
        borderRadius: 6,
        border: `1.5px solid ${active ? color + '60' : 'rgba(255,255,255,0.08)'}`,
        background: active ? color + '12' : 'rgba(255,255,255,0.02)',
        cursor: 'pointer', transition: 'all 0.15s ease',
      }}
    >
      <div style={{
        width: compact ? 28 : 34,
        height: compact ? 15 : 18,
        borderRadius: compact ? 7.5 : 9,
        background: active ? color + '40' : 'rgba(255,255,255,0.08)',
        position: 'relative', transition: 'background 0.15s ease', flexShrink: 0,
      }}>
        <div style={{
          width: compact ? 11 : 14,
          height: compact ? 11 : 14,
          borderRadius: '50%',
          background: active ? color : '#555',
          position: 'absolute', top: 2,
          left: active ? (compact ? 15 : 18) : 2,
          transition: 'all 0.15s ease',
          boxShadow: active ? `0 0 8px ${color}50` : 'none',
        }} />
      </div>
      <span style={{ fontSize: compact ? 9 : 10, fontWeight: 800, letterSpacing: '1.5px', color: active ? color : '#555' }}>
        {active ? labelOn : labelOff}
      </span>
    </button>
  );
}

const stepBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 6,
  border: `1.5px solid ${CY}25`,
  background: `${CY}08`,
  color: CY, fontSize: 16, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};