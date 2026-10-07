// src/v2/features/workerbook/StartSession.tsx — Start session from a Day: routes → roll call & teams → settings & start.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, UserPlus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { listRateCards, listSeasons, regionTax, todayISO, useLoad } from '../../lib/data';
import { cardFor, defaultRateCard, type RateCardData } from '../../lib/rateCard';
import { SERVICES, type Service } from '../../lib/permissions';
import { centerAreas, routeShapes, type Area } from '../../lib/territory';
import { getDay, listRoster, fullName, type RosterRow } from '../../lib/workerbook';
import {
  availableManagers, getSession, nextTeamName, openLegacySession, planProblems, startSession, writeLiveMapFromSession,
  type Plan, type PlanRoute, type PlanSettings, type PlanTeam,
} from '../../lib/startSession';
import { Btn, ErrorBox, Loading, Tag, Toggle } from '../../ui';
import { BookContractors } from './BookContractors';
import { TeamBoard } from './TeamBoard';
import { MapRoutePicker } from './MapRoutePicker';
import { appShowedDates, countBefore } from '../../lib/payoutEngine';
import { AddLiveRoutes } from './day/AddLiveRoutes';

type Step = 1 | 2 | 3;
const STEPS: { n: Step; label: string }[] = [{ n: 1, label: 'Routes' }, { n: 2, label: 'Roll call & teams' }, { n: 3, label: 'Settings & start' }];

export const StartSession: React.FC = () => {
  const { date = todayISO() } = useParams();
  const { center, can } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);

  // Day and roster load together, so the team pre-fill below never runs on an empty roster.
  const dayRoster = useLoad(async () => {
    if (!center) return null;
    const d = await getDay(center.id, date);
    return { day: d, roster: d ? await listRoster(d.id) : [] as RosterRow[] };
  }, [center?.id, date]);
  const day = { data: dayRoster.data?.day ?? null, loading: dayRoster.loading, error: dayRoster.error };
  const roster = { data: dayRoster.data ? dayRoster.data.roster : null, loading: dayRoster.loading, reload: dayRoster.reload };
  const managers = useLoad(() => center ? availableManagers(center.id, date) : Promise.resolve([]), [center?.id, date]);
  const areas = useLoad(() => center ? centerAreas(center.id) : Promise.resolve([] as Area[]), [center?.id]);
  const existing = useLoad(() => day.data ? getSession(day.data.id) : Promise.resolve(null), [day.data?.id]);
  const legacyOpen = useLoad(() => center ? openLegacySession(center.id) : Promise.resolve(null), [center?.id]);
  const seasonInfo = useLoad(async () => {
    if (!center) return null;
    const seasons = await listSeasons(center.id);
    const s = seasons.find(x => x.starts_on <= date && date <= x.ends_on) || null;
    const cards = s ? await listRateCards(s.id) : [];
    return { season: s, card: cardFor(cards, date)?.data || null };
  }, [center?.id, date]);

  const shapes = useLoad(() => routeShapes((areas.data || []).map(a => a.name)), [areas.data]);
  // ── plan state ──
  const [routes, setRoutes] = useState<Map<string, PlanRoute>>(new Map());
  const [activeMgr, setActiveMgr] = useState('');
  const [teams, setTeams] = useState<PlanTeam[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [showed, setShowed] = useState<Set<string>>(new Set());
  const [service, setService] = useState<Service>('sealing');
  const [settings, setSettings] = useState<Omit<PlanSettings, 'service'>>({ productCostPercent: 0, emailReceipts: true, liveCard: true, noTaxOnCash: false });
  const [prefilled, setPrefilled] = useState(false);
  const [showBook, setShowBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [legacyWritten, setLegacyWritten] = useState(false);

  const mgrs = managers.data || [];
  const firstMgr = mgrs[0]?.id || '';
  const card: RateCardData = useMemo(() => seasonInfo.data?.card
    || defaultRateCard(seasonInfo.data?.season?.service || service, regionTax(center?.region || 'East')), [seasonInfo.data, service, center?.region]);

  // Prefill once: teams, managers and attendance already on the roster; settings from the season's rate card.
  useEffect(() => {
    if (prefilled || !dayRoster.data || managers.loading || !managers.data || seasonInfo.loading) return;
    const rows = dayRoster.data.roster;
    const names = [...new Set(rows.map(r => r.team).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    setTeams(names.map(n => ({ name: n, kind: /^RC\d*$/i.test(n) ? 'ramp' : 'cart',
      managerId: dayRoster.data!.roster.find(r => r.team === n && r.manager_id)?.manager_id || firstMgr })));
    setMembers(Object.fromEntries(rows.filter(r => r.team).map(r => [r.hire_id, r.team as string])));
    setShowed(new Set(rows.filter(r => r.attendance === 'showed').map(r => r.hire_id)));
    const svc = (seasonInfo.data?.season?.service || 'sealing') as Service;
    setService(svc);
    setSettings(s => ({ ...s, productCostPercent: card.productCostPercent, noTaxOnCash: card.noTaxOnCashDefault }));
    setPrefilled(true);
  }, [prefilled, dayRoster.data, managers.loading, managers.data, seasonInfo.loading, seasonInfo.data, firstMgr, card]);

  // days each worker already showed in the app before this day (their Alumni rate counts them)
  const appDays = useLoad(async () => {
    const ids = (roster.data || []).map(r => r.hire_id);
    if (!ids.length) return {} as Record<string, number>;
    const shown = await appShowedDates(ids);
    return Object.fromEntries(ids.map(id => [id, countBefore(shown[id], date)]));
  }, [roster.data, date]);
  const plan: Plan | null = day.data && roster.data ? {
    date, seasonYear: seasonInfo.data?.season?.year || Number(date.slice(0, 4)), card,
    managers: mgrs, routes: [...routes.values()], teams, members, showed, roster: roster.data, appDaysBefore: appDays.data || {},
    settings: { service, ...settings },
  } : null;
  const problems = plan ? planProblems(plan) : [];

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (day.loading || roster.loading || managers.loading || areas.loading || existing.loading) return <div className="v2-main"><Loading /></div>;
  const pretty = new Date(date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
  const back = <Link to={`/app/workerbook/days/${date}`} className="v2-link">‹ {pretty}</Link>;

  if (!day.data || !roster.data?.length) return <div className="v2-main v2-narrow">{back}<div className="v2-card" style={{ marginTop: 12 }}>Nobody is booked on this day yet. Book contractors on the day first.</div></div>;
  if (existing.data || done) {
    const onMap = legacyOpen.data === date;
    const fixMap = async () => {
      if (!day.data || !center) return;
      setBusy(true); setError(null);
      try { await writeLiveMapFromSession(day.data.id, center.id, date, card, seasonInfo.data?.season?.year || Number(date.slice(0, 4))); }
      catch (e) { setError(e); }
      finally { setBusy(false); legacyOpen.reload(); }
    };
    return (
      <div className="v2-main">{back}
        <div className="v2-card" style={{ marginTop: 12, padding: 24 }}>
          <div className="v2-row"><Check color="#059669" /><span className="v2-h2">The session is live</span></div>
          {legacyOpen.loading ? <Loading label="Checking the live map…" /> : !onMap ? (
            <div className="v2-err" style={{ margin: '12px 0' }}>
              <b>The live map doesn’t have this session yet</b>, so managers and workers won’t see their routes or logsheets.
              {legacyOpen.data && <> The current app still has the <b>{legacyOpen.data}</b> session open; close it first.</>}
              <div style={{ marginTop: 10 }}><Btn kind="g" disabled={busy || !!legacyOpen.data} onClick={fixMap}>{busy ? 'Putting it on the map…' : 'Put this session on the live map'}</Btn></div>
            </div>
          ) : null}
          <ErrorBox error={error} />
          <ul style={{ lineHeight: 1.7 }}>
            <li><b>Managers</b> sign in at <a className="v2-link" href="/" target="_blank" rel="noreferrer">propertystars.app</a> with their username and password, then open <b>Route Manager › Map</b>.</li>
            <li><b>Workers</b> sign in there on the <b>Worker</b> tab with their <b>CN #</b> and <b>first name</b>.</li>
            <li><b>Payouts</b> and <b>Close day</b> are on the day’s page.</li>
          </ul>
          <div className="v2-row">
            <Btn kind="o" onClick={() => nav(`/app/workerbook/days/${date}`)}>Back to the day (payouts)</Btn>
          </div>
        </div>
        {onMap && <AddLiveRoutes centerId={center.id} areas={areas.data || []} shapes={shapes.data || []} canEdit={can('workerbook')} />}
      </div>
    );
  }
  if (!can('workerbook')) return <div className="v2-main v2-narrow"><div className="v2-err">You need the Workerbook permission to start a session.</div></div>;

  const painter = activeMgr && mgrs.some(m => m.id === activeMgr) ? activeMgr : firstMgr;
  const removeTeam = (name: string) => { setTeams(ts => ts.filter(t => t.name !== name)); setMembers(m => Object.fromEntries(Object.entries(m).filter(([, t]) => t !== name))); };
  const setRamp = (name: string, ramp: boolean) => {
    const t = teams.find(x => x.name === name); if (!t || (t.kind === 'ramp') === ramp) return;
    const newName = nextTeamName(teams.filter(x => x.name !== name), ramp ? 'ramp' : 'cart');
    setTeams(ts => ts.map(x => x.name === name ? { ...x, kind: ramp ? 'ramp' : 'cart', name: newName } : x));
    setMembers(m => Object.fromEntries(Object.entries(m).map(([h, tn]) => [h, tn === name ? newName : tn])));
  };
  const showedRows = roster.data.filter(r => showed.has(r.hire_id));

  const start = async () => {
    if (!plan || !day.data) return;
    setBusy(true); setError(null);
    try {
      const res = await startSession(plan, day.data.id, center.id, { legacyAlreadyWritten: legacyWritten });
      setDone(res.sessionId);
    } catch (e) {
      // If the old-app half already went through, a retry only records the session here.
      if (!legacyWritten && (await openLegacySession(center.id).catch(() => null)) === date) setLegacyWritten(true);
      setError(e);
    } finally { setBusy(false); legacyOpen.reload(); }
  };

  return (
    <div className="v2-main">
      <div className="v2-head">{back}<span className="v2-h1">Start session</span><span className="v2-spacer" />
        <span className="v2-mut v2-small">{routes.size} routes · {teams.length} teams · {showedRows.length} showed</span></div>

      <div className="v2-tabs" role="tablist">
        {STEPS.map(s => <button key={s.n} className={step === s.n ? 'on' : ''} onClick={() => setStep(s.n)}>{s.n}. {s.label}</button>)}
      </div>
      <ErrorBox error={error || areas.error || managers.error} />
      {mgrs.length === 0 && <div className="v2-err" style={{ marginBottom: 12 }}>No managers are available at {center.display_name} on this day. In Super Admin › Users give your route managers this center as their RM center, and check Availability.</div>}

      {step === 1 && (
        (areas.data || []).length === 0 ? (
          <div className="v2-card">No digital-map areas are assigned to {center.display_name} yet. {can('sa_territory')
            ? <Link className="v2-link" to="/app/admin/territory">Assign them in Super Admin › Territory.</Link> : 'Ask the Super Admin to assign them in Territory.'}</div>
        ) : (
          <MapRoutePicker areas={areas.data || []} shapes={shapes.data || []} managers={mgrs} routes={routes} active={painter}
            onActive={setActiveMgr} onChange={setRoutes}
            footer={<Btn disabled={!routes.size} onClick={() => setStep(2)} style={{ justifyContent: 'center' }}>Next: roll call &amp; teams ({routes.size} routes)</Btn>} />
        )
      )}

      {step === 2 && (
        <div className="v2-split" style={{ alignItems: 'start' }}>
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-row" style={{ padding: 12 }}>
              <b>Roll call</b><span className="v2-mut v2-small">{showedRows.length} of {roster.data.length}</span><span className="v2-spacer" />
              <Btn kind="o" size="sm" onClick={() => setShowed(new Set(roster.data!.map(r => r.hire_id)))}>Tick all</Btn>
              <Btn kind="o" size="sm" icon={UserPlus} onClick={() => setShowBook(true)}>Walk-in</Btn>
            </div>
            <div className="v2-table-wrap">
              <table className="v2-table">
                <thead><tr><th>Showed</th><th>Name</th><th>Team</th></tr></thead>
                <tbody>
                  {[...roster.data].sort((a, b) => fullName(a.hire.person).localeCompare(fullName(b.hire.person))).map(r => (
                    <tr key={r.id}>
                      <td><input type="checkbox" aria-label={`${fullName(r.hire.person)} showed`} checked={showed.has(r.hire_id)}
                        onChange={e => setShowed(s => { const n = new Set(s); if (e.target.checked) n.add(r.hire_id); else n.delete(r.hire_id); return n; })} /></td>
                      <td><b>{fullName(r.hire.person)}</b> <span className="v2-mut v2-small">{r.hire.cn}</span></td>
                      <td>
                        <select className="v2-sel" style={{ padding: '4px 6px', width: 150 }} disabled={!showed.has(r.hire_id)} aria-label="Team"
                          value={members[r.hire_id] || ''} onChange={e => setMembers(m => ({ ...m, [r.hire_id]: e.target.value }))}>
                          <option value="">—</option>
                          {teams.map(t => <option key={t.name} value={t.name}>{t.kind === 'ramp' ? t.name : `Cart ${t.name}`} · {mgrs.find(m => m.id === t.managerId)?.full_name.split(' ')[0] || '?'}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="v2-stack">
            <TeamBoard people={showedRows} teams={teams} members={members} managers={mgrs}
              onAssign={(h, t) => setMembers(m => { const n = { ...m }; if (t) n[h] = t; else delete n[h]; return n; })}
              onNewTeam={(mid, kind, h) => { const name = nextTeamName(teams, kind); setTeams(ts => [...ts, { name, kind, managerId: mid }]); if (h) setMembers(m => ({ ...m, [h]: name })); }}
              onRamp={setRamp}
              onManager={(t, mid) => setTeams(ts => ts.map(x => x.name === t ? { ...x, managerId: mid } : x))}
              onRemove={removeTeam} />
            {teams.some(t => !mgrs.some(m => m.id === t.managerId)) && (
              <div className="v2-card"><b>Teams without an available manager</b>
                {teams.filter(t => !mgrs.some(m => m.id === t.managerId)).map(t => (
                  <div key={t.name} className="v2-row" style={{ marginTop: 6 }}><Tag>{t.name}</Tag>
                    <select className="v2-sel" style={{ width: 160, padding: '3px 6px' }} value="" onChange={e => setTeams(ts => ts.map(x => x.name === t.name ? { ...x, managerId: e.target.value } : x))}>
                      <option value="">Pick a manager…</option>{mgrs.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                    </select></div>
                ))}
              </div>
            )}
            <div className="v2-row"><Btn kind="o" onClick={() => setStep(1)}>Back</Btn><span className="v2-spacer" /><Btn onClick={() => setStep(3)}>Next: settings</Btn></div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="v2-grid2" style={{ alignItems: 'start' }}>
          <div className="v2-card">
            <div className="v2-card-h">Settings</div>
            <label className="v2-field" style={{ display: 'block' }}><span className="v2-label">Season</span>
              <select className="v2-sel" value={service} disabled={!!seasonInfo.data?.season} onChange={e => setService(e.target.value as Service)}>
                {SERVICES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select></label>
            {!seasonInfo.data?.season && <div className="v2-note" style={{ marginTop: -6, marginBottom: 10 }}>No season is set up at this center for this date, so the standard {SERVICES.find(s => s.key === service)?.label} rates are used. Add the season in Super Admin › Centers & seasons.</div>}
            <label className="v2-field" style={{ display: 'block' }}><span className="v2-label">Product cost %</span>
              <input className="v2-input" type="number" min={0} max={100} value={settings.productCostPercent}
                onChange={e => setSettings(s => ({ ...s, productCostPercent: Number(e.target.value) }))} /></label>
            {([['emailReceipts', 'Email receipts to clients'], ['liveCard', 'Live card (Bambora)'], ['noTaxOnCash', 'No tax on cash']] as const).map(([k, label]) => (
              <div key={k} className="v2-check" style={{ justifyContent: 'space-between' }}><span>{label}</span>
                <Toggle on={settings[k]} onChange={v => setSettings(s => ({ ...s, [k]: v }))} label={label} /></div>
            ))}
            {!settings.liveCard && <div className="v2-note">With live card off, a typed card keeps only its last 4 digits and can’t be charged later.</div>}
          </div>
          <div className="v2-stack">
            <div className="v2-card">
              <div className="v2-card-h">Ready to start</div>
              <div className="v2-small" style={{ lineHeight: 1.8 }}>
                <div><b>{routes.size}</b> routes in {new Set([...routes.values()].map(r => r.area)).size} areas</div>
                <div><b>{teams.length}</b> teams ({teams.filter(t => t.kind === 'ramp').length} ramp crews) under {new Set(teams.map(t => t.managerId)).size} managers</div>
                <div><b>{showedRows.length}</b> workers showed · {roster.data.length - showedRows.length} not ticked</div>
              </div>
            </div>
            {legacyOpen.data && legacyOpen.data !== date && (
              <div className="v2-err">The current app still has the <b>{legacyOpen.data}</b> session open for {center.display_name}. Close it there first (Session Command Center › Close Session), then come back and start.</div>
            )}
            {legacyWritten && <div className="v2-note">The live map already has this session. Starting again only records it here.</div>}
            {problems.length > 0 && <div className="v2-err"><b>Before you can start:</b><ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{problems.map(p => <li key={p}>{p}</li>)}</ul></div>}
            <div className="v2-row"><Btn kind="o" onClick={() => setStep(2)}>Back</Btn><span className="v2-spacer" />
              <Btn kind="g" disabled={busy || appDays.loading || problems.length > 0 || (!!legacyOpen.data && legacyOpen.data !== date && !legacyWritten)} onClick={start}>{busy ? 'Starting…' : 'Start session'}</Btn></div>
            <div className="v2-note">Starting makes the day live, ticks who showed, and sets up the RM map and worker logsheets in the current app.</div>
          </div>
        </div>
      )}

      {showBook && day.data && <BookContractors centerId={center.id} date={date} bookedHireIds={new Set(roster.data.map(r => r.hire_id))}
        onClose={() => setShowBook(false)} onBooked={() => { setShowBook(false); roster.reload(); }} />}
    </div>
  );
};
