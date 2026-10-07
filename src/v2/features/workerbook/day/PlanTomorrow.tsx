// Tomorrow: confirmations, and a rough draft of the teams (who goes with whom, under which
// manager). The draft is saved on tomorrow's roster rows (team + manager), so Start session
// tomorrow opens with these teams already filled in.
import React, { useEffect, useMemo, useState } from 'react';
import { Phone } from 'lucide-react';
import { fullName, updateRoster, type RosterRow } from '../../../lib/workerbook';
import { nextTeamName, type PlanManager, type PlanTeam } from '../../../lib/startSession';
import { ErrorBox, Tag } from '../../../ui';
import { TeamBoard } from '../TeamBoard';
import { ContractorLink } from '../ContractorCard';

const teamsFromRows = (rows: RosterRow[], fallbackMgr: string): PlanTeam[] =>
  [...new Set(rows.map(r => r.team).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(n => ({ name: n, kind: /^RC\d*$/i.test(n) ? 'ramp' as const : 'cart' as const, managerId: rows.find(r => r.team === n && r.manager_id)?.manager_id || fallbackMgr }));

export const PlanTomorrow: React.FC<{ rows: RosterRow[]; managers: PlanManager[]; canEdit: boolean; onChanged: () => void }> =
  ({ rows, managers, canEdit, onChanged }) => {
    const firstMgr = managers[0]?.id || '';
    // Teams with people come from the saved rows; new empty teams live here until someone is dropped in.
    const [extra, setExtra] = useState<PlanTeam[]>([]);
    const saved = useMemo(() => teamsFromRows(rows, firstMgr), [rows, firstMgr]);
    const teams = useMemo(() => [...saved, ...extra.filter(e => !saved.some(s => s.name === e.name))], [saved, extra]);
    useEffect(() => { setExtra(x => x.filter(e => !saved.some(s => s.name === e.name))); }, [saved]);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const members = useMemo(() => Object.fromEntries(rows.filter(r => r.team).map(r => [r.hire_id, r.team as string])), [rows]);
    const byHire = useMemo(() => new Map(rows.map(r => [r.hire_id, r])), [rows]);

    const save = async (fn: () => Promise<unknown>) => {
      setBusy(true); setError(null);
      try { await fn(); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
    };
    const assign = (hireId: string, team: string | null, list = teams) => {
      const r = byHire.get(hireId); if (!r) return Promise.resolve();
      const t = team ? list.find(x => x.name === team) : null;
      return updateRoster(r.id, { team, manager_id: t ? t.managerId : null });
    };
    const rowsOf = (team: string) => rows.filter(r => r.team === team);

    const confirmed = rows.filter(r => r.confirmed_at).length;
    const sorted = [...rows].sort((a, b) => Number(!!a.confirmed_at) - Number(!!b.confirmed_at) || fullName(a.hire.person).localeCompare(fullName(b.hire.person)));

    return (
      <div className="v2-plan">
        <section className="v2-card" style={{ padding: 0 }}>
          <div className="v2-row" style={{ padding: '12px 14px 6px' }}>
            <b>Confirmations</b><span className="v2-mut v2-small">{confirmed} of {rows.length} confirmed</span>
          </div>
          <div className="v2-confirm-list">
            {sorted.map(r => {
              const cell = r.hire.person.cell_phone;
              return (
                <div key={r.id} className={`v2-confirm${r.confirmed_at ? ' on' : ''}`}>
                  <label className="v2-row" style={{ gap: 10, flex: 1, minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={!!r.confirmed_at} disabled={!canEdit || busy}
                      onChange={e => save(() => updateRoster(r.id, { confirmed: e.target.checked }))} aria-label={`Confirmed ${fullName(r.hire.person)}`} />
                    <span style={{ minWidth: 0 }}>
                      <b><ContractorLink hireId={r.hire_id} onSaved={onChanged}>{fullName(r.hire.person)}</ContractorLink></b>{r.hire.person.lifetime_days === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}
                      <span className="v2-small v2-mut" style={{ display: 'block' }}>{r.hire.cn}{r.shuttle ? ` · ${r.shuttle}` : ''}{r.confirmed_via && r.confirmed_via !== 'staff' ? ` · by ${r.confirmed_via}` : ''}</span>
                    </span>
                  </label>
                  {cell && <a className="v2-gbtn" style={{ width: 32, height: 32 }} href={`tel:${cell.replace(/[^\d+]/g, '')}`} aria-label={`Call ${fullName(r.hire.person)}`}><Phone size={14} /></a>}
                </div>
              );
            })}
            {rows.length === 0 && <div className="v2-mut v2-small" style={{ padding: 14 }}>Nobody booked yet.</div>}
          </div>
        </section>

        <section>
          <div className="v2-row" style={{ marginBottom: 8 }}>
            <b style={{ color: 'var(--ink)' }}>Draft teams</b>
            <span className="v2-mut v2-small">A rough plan. Start session tomorrow opens with these teams filled in.</span>
          </div>
          <ErrorBox error={error} />
          {managers.length === 0 ? <div className="v2-card">No route managers at this center yet.</div> : (
            <TeamBoard
              people={rows} teams={teams} emptyPoolText="Everyone booked is on a draft team." members={members} managers={managers}
              onAssign={(h, t) => canEdit && save(() => assign(h, t))}
              onNewTeam={(mid, kind, h) => {
                if (!canEdit) return;
                const name = nextTeamName(teams, kind);
                const next = [...teams, { name, kind, managerId: mid }];
                setExtra(x => [...x, { name, kind, managerId: mid }]);
                if (h) save(() => assign(h, name, next));
              }}
              onRamp={(name, ramp) => {
                const t = teams.find(x => x.name === name); if (!canEdit || !t || (t.kind === 'ramp') === ramp) return;
                const newName = nextTeamName(teams.filter(x => x.name !== name), ramp ? 'ramp' : 'cart');
                setExtra(x => x.map(e => e.name === name ? { ...e, kind: ramp ? 'ramp' : 'cart', name: newName } : e));
                save(() => Promise.all(rowsOf(name).map(r => updateRoster(r.id, { team: newName }))));
              }}
              onManager={(name, mid) => {
                if (!canEdit) return;
                setExtra(x => x.map(e => e.name === name ? { ...e, managerId: mid } : e));
                save(() => Promise.all(rowsOf(name).map(r => updateRoster(r.id, { manager_id: mid }))));
              }}
              onRemove={name => {
                if (!canEdit) return;
                setExtra(x => x.filter(e => e.name !== name));
                save(() => Promise.all(rowsOf(name).map(r => updateRoster(r.id, { team: null, manager_id: null }))));
              }} />
          )}
        </section>
      </div>
    );
  };
