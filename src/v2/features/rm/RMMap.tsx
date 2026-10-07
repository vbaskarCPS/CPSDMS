// src/v2/features/rm/RMMap.tsx — Route Manager › Map: the RM map (desktop and phone), unchanged,
// opened from the new app. The signed-in manager sees their own map for the live session;
// someone with Workerbook can open any of today's managers' maps.
import React, { Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { actAsLegacyRouteManager, legacyLiveSession, legacyRouteManagers } from '../../lib/legacy';
import { legacyManagerId } from '../../lib/startSession';
import { Btn, ErrorBox, Loading } from '../../ui';

const RMLogbook = React.lazy(() => import('../../../pages/Management/RMLogbook'));

export const RMMap: React.FC = () => {
  const { profile, center, can } = useAuth();
  const centerId = profile?.rm_center_id || center?.id || null;
  const [viewing, setViewing] = useState<string | null>(null);
  const own = profile ? legacyManagerId(profile.full_name) : null;
  const who = viewing || own;

  const state = useLoad(async () => {
    if (!centerId || !who) return { kind: 'nocenter' as const };
    const live = await legacyLiveSession(centerId);
    if (!live) return { kind: 'nosession' as const, managers: [] };
    const ok = await actAsLegacyRouteManager(centerId, who);
    if (ok) return { kind: 'ok' as const };
    return { kind: 'notmanager' as const, managers: can('workerbook') || profile?.is_super_admin ? await legacyRouteManagers(centerId) : [] };
  }, [centerId, who]);

  if (state.loading) return <div className="v2"><Loading label="Opening the map…" /></div>;
  if (state.error) return <div className="v2"><div className="v2-main v2-narrow"><ErrorBox error={state.error} /></div></div>;
  const s = state.data;
  if (s?.kind === 'ok') return <Suspense fallback={<div className="v2"><Loading label="Opening the map…" /></div>}><RMLogbook key={who || ''} /></Suspense>;

  return (
    <div className="v2"><div className="v2-main v2-narrow">
      <div className="v2-head"><Link to="/app" className="v2-link">‹ Home</Link><span className="v2-h1">Route Manager map</span></div>
      <div className="v2-card" style={{ padding: 24 }}>
        {s?.kind === 'nocenter' && <>Your account isn’t linked to a command center yet. Ask the Super Admin to set your RM center in User Management.</>}
        {s?.kind === 'nosession' && <>No session is live at {center?.display_name || 'your center'} yet. Your map opens here once today’s session has been started.</>}
        {s?.kind === 'notmanager' && <>
          <div style={{ marginBottom: 12 }}>You aren’t a route manager on today’s session{center ? ` at ${center.display_name}` : ''}.</div>
          {s.managers.length > 0 && <>
            <div className="v2-card-h">Open a manager’s map</div>
            <div className="v2-row">{s.managers.map(m => <Btn key={m.user_id} kind="o" onClick={() => setViewing(m.user_id)}>{m.name}</Btn>)}</div>
          </>}
        </>}
      </div>
    </div></div>
  );
};
