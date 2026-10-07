// src/v2/V2App.tsx — the new app, mounted at /app/* beside the existing one.
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './ui/theme.css';
import { AuthProvider, useAuth } from './lib/auth';
import type { Permission } from './lib/permissions';
import { AppShell, Soon } from './app/AppShell';
import { Home } from './app/Home';
import { Login, ChangePassword } from './features/auth/Login';
import { Users } from './features/admin/Users';
import { Centers } from './features/admin/Centers';
import { Availability } from './features/admin/Availability';
import { RateCards } from './features/workerbook/RateCards';
import { Contractors } from './features/workerbook/Contractors';
import { Days } from './features/workerbook/Days';
import { Day } from './features/workerbook/Day';
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

const V2Routes: React.FC = () => (
  <Routes>
    <Route path="login" element={<Login />} />
    <Route path="password" element={<ChangePassword />} />
    <Route index element={<Guard><Home /></Guard>} />
    <Route path="admin/users" element={<Guard perm="sa_users"><Users /></Guard>} />
    <Route path="admin/centers" element={<Guard perm="sa_users"><Centers /></Guard>} />
    <Route path="admin/availability" element={<Guard perm="sa_users"><Availability /></Guard>} />
    <Route path="workerbook/rate-cards" element={<Guard perm="workerbook"><RateCards /></Guard>} />
    <Route path="workerbook/contractors" element={<Guard perm="workerbook"><Contractors /></Guard>} />
    <Route path="workerbook/status" element={<Guard perm="workerbook"><Contractors /></Guard>} />
    <Route path="workerbook/days" element={<Guard perm="workerbook"><Days /></Guard>} />
    <Route path="workerbook/days/:date" element={<Guard perm="workerbook"><Day /></Guard>} />
    <Route path="*" element={<Guard><Soon /></Guard>} />
  </Routes>
);

const V2App: React.FC = () => <AuthProvider><V2Routes /></AuthProvider>;
export default V2App;
