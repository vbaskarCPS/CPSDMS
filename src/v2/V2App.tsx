// src/v2/V2App.tsx — the new app, mounted at /app/* beside the existing one.
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './ui/theme.css';
import { AuthProvider, useAuth } from './lib/auth';
import type { Permission } from './lib/permissions';
import { AppShell, Soon } from './app/AppShell';
import { Home } from './app/Home';
import { Login, ChangePassword, AccountSetup } from './features/auth/Login';
import { Users } from './features/admin/Users';
import { Centers } from './features/admin/Centers';
import { Availability } from './features/admin/Availability';
import { RateCards } from './features/workerbook/RateCards';
import { Contractors } from './features/workerbook/Contractors';
import { Crew } from './features/workerbook/Crew';
import { Payslips } from './features/workerbook/Payslips';
import { Days } from './features/workerbook/Days';
import { Day } from './features/workerbook/Day';
import { StartSession } from './features/workerbook/StartSession';
import { Payouts, PayoutsLive, PayoutWorker } from './features/workerbook/Payouts';
import { Territory } from './features/admin/Territory';
import { MapBuilderPage } from './features/admin/MapBuilderPage';
import { MapViewerPage } from './features/admin/MapViewerPage';
import { RMMap } from './features/rm/RMMap';
import { FloaterMap, FloaterPicker } from './features/rm/Floater';
import { ClientLists } from './features/admin/ClientLists';
import { Clients } from './features/clients/Clients';
import { CustomerMap } from './features/clients/CustomerMap';
import { Customer } from './features/clients/Customer';
import { MyAccount } from './features/account/MyAccount';
import { WorkerHome } from './features/worker/WorkerHome';
import { Loading } from './ui';

const Guard: React.FC<{ perm?: Permission; children: React.ReactNode }> = ({ perm, children }) => {
  const { loading, session, profile, can } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="v2"><Loading /></div>;
  if (!session || !profile) return <Navigate to="/app/login" replace state={{ from: loc.pathname }} />;
  if (profile.must_change_password) return <Navigate to="/app/password" replace />;
  if (perm && !can(perm)) return <AppShell><div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to this screen.</div></div></AppShell>;
  return <AppShell>{children}</AppShell>;
};

/** Like Guard, but full screen (no top bar): for the RM map, which has its own header on phone and desktop. */
const BareGuard: React.FC<{ perm?: Permission; children: React.ReactNode }> = ({ perm, children }) => {
  const { loading, session, profile, can } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="v2"><Loading /></div>;
  if (!session || !profile) return <Navigate to="/app/login" replace state={{ from: loc.pathname }} />;
  if (profile.must_change_password) return <Navigate to="/app/password" replace />;
  if (perm && !can(perm)) return <AppShell><div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to this screen.</div></div></AppShell>;
  return <>{children}</>;
};

/** Route Manager opens the floater view for Floater Route Managers (their own map is one tap away). */
const RMGate: React.FC = () => {
  const { can, loading, profile } = useAuth();
  const loc = useLocation();
  const ownMap = new URLSearchParams(loc.search).has('own');
  if (!loading && profile && can('rm_floater') && !ownMap) return <Navigate to="/app/rm/floater" replace />;
  return <BareGuard perm={!loading && profile && can('rm_floater') ? 'rm_floater' : 'route_manager'}><RMMap /></BareGuard>;
};

const V2Routes: React.FC = () => (
  <Routes>
    <Route path="login" element={<Login />} />
    <Route path="password" element={<ChangePassword />} />
    <Route path="setup" element={<AccountSetup />} />
    {/* the worker dashboard: workers have no app account, so it has its own sign-in (a pass) */}
    <Route path="worker/*" element={<WorkerHome />} />
    <Route index element={<Guard><Home /></Guard>} />
    <Route path="admin/users" element={<Guard perm="sa_users"><Users /></Guard>} />
    <Route path="admin/centers" element={<Guard perm="sa_users"><Centers /></Guard>} />
    <Route path="admin/availability" element={<Guard perm="sa_users"><Availability /></Guard>} />
    <Route path="workerbook/rate-cards" element={<Guard perm="workerbook"><RateCards /></Guard>} />
    <Route path="workerbook/contractors" element={<Guard perm="workerbook"><Contractors /></Guard>} />
    <Route path="workerbook/status" element={<Guard perm="workerbook"><Contractors /></Guard>} />
    <Route path="workerbook/crew" element={<Guard perm="workerbook"><Crew /></Guard>} />
    <Route path="workerbook/payslips" element={<Guard perm="workerbook"><Payslips /></Guard>} />
    <Route path="workerbook" element={<Navigate to="/app/workerbook/days" replace />} />
    <Route path="workerbook/days" element={<Guard perm="workerbook"><Days /></Guard>} />
    <Route path="workerbook/days/:date" element={<Guard perm="workerbook"><Day /></Guard>} />
    <Route path="workerbook/days/:date/start" element={<Guard perm="workerbook"><StartSession /></Guard>} />
    <Route path="workerbook/payouts" element={<Guard perm="workerbook"><PayoutsLive /></Guard>} />
    <Route path="workerbook/days/:date/payouts" element={<Guard perm="workerbook"><Payouts /></Guard>} />
    <Route path="workerbook/days/:date/payouts/:contractorId" element={<Guard perm="workerbook"><PayoutWorker /></Guard>} />
    <Route path="admin/territory" element={<Guard perm="sa_territory"><Territory /></Guard>} />
    <Route path="rm" element={<RMGate />} />
    <Route path="rm/floater" element={<Guard perm="rm_floater"><FloaterPicker /></Guard>} />
    <Route path="rm/floater/map" element={<BareGuard perm="rm_floater"><FloaterMap /></BareGuard>} />
    <Route path="admin/territory/clients" element={<Guard perm="sa_territory"><ClientLists /></Guard>} />
    <Route path="admin/territory/builder/:area" element={<BareGuard perm="sa_territory"><MapBuilderPage /></BareGuard>} />
    <Route path="admin/territory/view" element={<BareGuard perm="sa_territory"><MapViewerPage /></BareGuard>} />
    <Route path="clients" element={<Guard><CustomerMap /></Guard>} />
    <Route path="bookings/customers" element={<Guard><CustomerMap /></Guard>} />
    <Route path="clients/list" element={<Guard><Clients /></Guard>} />
    <Route path="clients/c/:id" element={<Guard><Customer /></Guard>} />
    <Route path="account" element={<Guard><MyAccount /></Guard>} />
    <Route path="*" element={<Guard><Soon /></Guard>} />
  </Routes>
);

const V2App: React.FC = () => <AuthProvider><V2Routes /></AuthProvider>;
export default V2App;
