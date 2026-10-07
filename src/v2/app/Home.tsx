// src/v2/app/Home.tsx — one tile per component the user may open.
import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Tile, Card } from '../ui';
import { visibleComponents, type Component } from './nav';

export const Home: React.FC = () => {
  const { profile, can, center } = useAuth();
  const nav = useNavigate();
  const comps = visibleComponents(can);
  const [openComp, setOpenComp] = useState<Component | null>(null);
  const d = new Date();
  const hour = d.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = profile?.full_name.split(' ')[0] || '';
  // Route managers who only have the map go straight to it, as the old login did.
  if (profile && !profile.is_super_admin && comps.length === 1 && comps[0].key === 'rm') return <Navigate to="/app/rm" replace />;

  return (
    <div className="v2-main v2-narrow">
      <div style={{ margin: '6px 0 18px' }}>
        <div className="v2-mut">{d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}{center ? ` · ${center.display_name}` : ''}</div>
        <div className="v2-h1">{greet}, {first}</div>
      </div>
      {!openComp ? (
        <div className="v2-tiles">
          {comps.map(c => (
            <Tile key={c.key} icon={c.icon} label={c.label} color={c.color}
              sub={`${c.subs.filter(s => s.ready).length} of ${c.subs.length} ready`}
              onClick={() => setOpenComp(c)} />
          ))}
        </div>
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
