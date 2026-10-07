// src/v2/app/AppShell.tsx — top bar (grid button, breadcrumb, center switcher, season badge, user) + the menu,
// which only switches between components (each opens at its home).
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, ChevronRight, LogOut, UserRound, Home } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useCurrentSeason } from '../lib/data';
import { serviceLabel } from '../lib/permissions';
import { Btn } from '../ui';
import { visibleComponents, findByPath, homeOf } from './nav';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, centers, center, setCenterId, can, signOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const comps = visibleComponents(can);
  const here = findByPath(loc.pathname);
  const hereComp = here ? comps.find(c => c.key === here.comp.key) || null : null;
  const season = useCurrentSeason(center?.id || null);
  const atHome = loc.pathname === '/app' || loc.pathname === '/app/';

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const tabs = hereComp?.tabs ? hereComp.subs.filter(s => s.ready) : [];

  return (
    <div className="v2">
      <header className="v2-bar">
        <button type="button" className={`v2-gbtn${open ? ' on' : ''}`} onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}>
          <LayoutGrid size={18} />
        </button>
        <Link to="/app" className="v2-brand"><img src="/icon-192.png" alt="" className="v2-logo" /><span className="v2-hide-sm">Property Stars</span></Link>
        <span className="v2-crumb">
          {here ? <>
            <Link to={homeOf(hereComp || here.comp)}><b>{here.comp.label}</b></Link>
            {!here.comp.tabs && homeOf(here.comp) !== here.sub.path && <><ChevronRight size={14} />{here.sub.label}</>}
          </> : <b>Home</b>}
        </span>
        <span className="v2-spacer" />
        {centers.length > 1 ? (
          <select className="v2-select-pill" value={center?.id || ''} onChange={e => setCenterId(e.target.value)} aria-label="Command center">
            {centers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
        ) : center ? <span className="v2-pill v2-hide-sm">{center.display_name}</span> : null}
        {season && <span className="v2-pill season v2-hide-sm">{serviceLabel(season.service)} {season.year}</span>}
        <Link to="/app/account" className="v2-pill v2-acct" title={`${profile?.full_name} · My account`} aria-label="My account">
          <UserRound size={14} /><span className="v2-hide-sm">{profile?.username}</span>
        </Link>
        <button type="button" className="v2-gbtn" onClick={() => signOut().then(() => nav('/app/login'))} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      </header>

      {open && (
        <>
          <div className="v2-overlay" onClick={() => setOpen(false)} />
          <nav className="v2-menu v2-menu-simple" aria-label="Menu">
            <button type="button" className={`v2-menu-row${atHome ? ' on' : ''}`} onClick={() => nav('/app')}>
              <span className="ic"><Home size={20} /></span><span className="tx"><b>Home</b><span>Your dashboard</span></span>
            </button>
            {comps.map(c => (
              <button key={c.key} type="button" className={`v2-menu-row${hereComp?.key === c.key ? ' on' : ''}`} onClick={() => nav(homeOf(c))}>
                <span className="ic" style={{ color: `var(--${c.color})` }}><c.icon size={20} /></span>
                <span className="tx"><b>{c.label}</b><span>{c.blurb}</span></span>
              </button>
            ))}
          </nav>
        </>
      )}
      {tabs.length > 1 && (
        <div className="v2-subtabs">
          <div className="v2-tabs" role="tablist">
            {tabs.map(s => <Link key={s.key} to={s.path} className={here?.sub.key === s.key ? 'on' : ''}>{s.label}</Link>)}
          </div>
        </div>
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
