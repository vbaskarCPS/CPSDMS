// src/v2/app/Home.tsx — the dashboard: a large stat card per component the user may open;
// "Open" on a card shows that component's screens.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasLiveRouteManagerSeat } from '../lib/legacy';
import { legacyManagerId } from '../lib/startSession';
import { useAuth } from '../lib/auth';
import { Tile, Card } from '../ui';
import { visibleComponents, type Component } from './nav';
import { StatCards } from './StatCards';

export const Home: React.FC = () => {
  const { profile, can, center } = useAuth();
  const nav = useNavigate();
  const comps = visibleComponents(can);
  const [openComp, setOpenComp] = useState<Component | null>(null);
  const d = new Date();
  const hour = d.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = profile?.full_name.split(' ')[0] || '';
  // Right after signing in, a manager with a seat on today's live session goes straight to
  // their RM map. The dashboard (this page) stays one tap away from the map's menu.
  const loc = useLocation() as { state?: { fromLogin?: boolean } };
  const fromLogin = !!loc.state?.fromLogin;
  const [checking, setChecking] = useState(fromLogin);
  useEffect(() => {
    if (!fromLogin || !profile) { setChecking(false); return; }
    const centerId = profile.rm_center_id;
    if (!centerId || !can('route_manager')) { setChecking(false); return; }
    let live = true;
    hasLiveRouteManagerSeat(centerId, legacyManagerId(profile.full_name))
      .then(ok => { if (!live) return; if (ok) nav('/app/rm', { replace: true }); else { setChecking(false); nav('/app', { replace: true, state: {} }); } })
      .catch(() => live && setChecking(false));
    return () => { live = false; };
  }, [fromLogin, profile, can, nav]);
  if (checking) return <div className="v2-main v2-narrow"><div className="v2-mut" style={{ padding: 20 }}>Opening…</div></div>;

  return (
    <div className="v2-main v2-narrow">
      <div style={{ margin: '6px 0 18px' }}>
        <div className="v2-mut">{d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}{center ? ` · ${center.display_name}` : ''}</div>
        <div className="v2-h1">{greet}, {first}</div>
      </div>
      {!openComp ? (
        <StatCards comps={comps} onOpen={setOpenComp} />
      ) : (
        <Card title={openComp.label} right={<button className="v2-link" onClick={() => setOpenComp(null)}>‹ All components</button>}>
          <div className="v2-tiles">
            {openComp.subs.map(s => <Tile key={s.key} icon={s.icon} label={s.label} color={s.color} soon={!s.ready} onClick={() => nav(s.path)} />)}
          </div>
        </Card>
      )}
      {comps.length === 0 && <div className="v2-card">Your account has no permissions yet. Ask the Super Admin to set them in User Management.</div>}
      {!center && comps.length > 0 && <div className="v2-note">You aren’t linked to a command center yet.</div>}
    </div>
  );
};
