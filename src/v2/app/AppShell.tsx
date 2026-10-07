// src/v2/app/AppShell.tsx — top bar (grid button, breadcrumb, center switcher, season badge, user) + grid menu.
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, ChevronRight, LogOut, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useCurrentSeason } from '../lib/data';
import { serviceLabel } from '../lib/permissions';
import { Tile, Btn } from '../ui';
import { visibleComponents, findByPath, type Component } from './nav';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, centers, center, setCenterId, can, signOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const comps = visibleComponents(can);
  const here = findByPath(loc.pathname);
  const [menuComp, setMenuComp] = useState<Component | null>(null);
  const season = useCurrentSeason(center?.id || null);

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (open) setMenuComp(comps.find(c => c.key === here?.comp.key) || comps[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shownComp = menuComp ? comps.find(c => c.key === menuComp.key) || null : null;

  return (
    <div className="v2">
      <header className="v2-bar">
        <button type="button" className={`v2-gbtn${open ? ' on' : ''}`} onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}>
          <LayoutGrid size={18} />
        </button>
        <Link to="/app" className="v2-brand">CPSDMS</Link>
        <span className="v2-crumb">
          {here ? <><b>{here.comp.label}</b><ChevronRight size={14} />{here.sub.label}</> : <b>Home</b>}
        </span>
        <span className="v2-spacer" />
        {centers.length > 1 ? (
          <select className="v2-select-pill" value={center?.id || ''} onChange={e => setCenterId(e.target.value)} aria-label="Command center">
            {centers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
        ) : center ? <span className="v2-pill v2-hide-sm">{center.display_name}</span> : null}
        {season && <span className="v2-pill season v2-hide-sm">{serviceLabel(season.service)} {season.year}</span>}
        <span className="v2-pill v2-hide-sm" title={profile?.full_name}>{profile?.username}</span>
        <button type="button" className="v2-gbtn" onClick={() => signOut().then(() => nav('/app/login'))} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      </header>

      {open && (
        <>
          <div className="v2-overlay" onClick={() => setOpen(false)} />
          <div className="v2-menu" role="dialog" aria-label="Menu">
            <div className="v2-menu-side">
              <div className="v2-card-h v2-hide-sm">Components</div>
              {comps.map(c => (
                <button key={c.key} type="button" className={`v2-menu-item${shownComp?.key === c.key ? ' on' : ''}`} onClick={() => setMenuComp(c)}>
                  <c.icon size={18} color={`var(--${c.color})`} />{c.label}
                </button>
              ))}
            </div>
            <div className="v2-menu-body">
              <div className="v2-card-h">{shownComp?.label}<span className="v2-spacer" />
                <button type="button" className="v2-link" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} color="#6b7280" /></button></div>
              <div className="v2-tiles">
                {shownComp?.subs.map(s => (
                  <Tile key={s.key} icon={s.icon} label={s.label} color={s.color} soon={!s.ready}
                    on={here?.sub.key === s.key && here.comp.key === shownComp.key} onClick={() => nav(s.path)} />
                ))}
              </div>
              {shownComp?.subs.some(s => !s.ready) && <div className="v2-note">Tiles marked Soon arrive in later phases.</div>}
            </div>
          </div>
        </>
      )}
      <main>{children}</main>
    </div>
  );
};

export const Soon: React.FC = () => {
  const loc = useLocation();
  const here = findByPath(loc.pathname);
  return (
    <div className="v2-main v2-narrow">
      <div className="v2-card" style={{ textAlign: 'center', padding: 40 }}>
        <div className="v2-h2">{here ? `${here.comp.label} › ${here.sub.label}` : 'This screen'} is coming in a later phase</div>
        <div className="v2-note">Until then, keep using the current app for this.</div>
        <div style={{ marginTop: 16 }}><Link to="/app"><Btn kind="o">Back to Home</Btn></Link></div>
      </div>
    </div>
  );
};
