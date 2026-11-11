// src/planner/App.tsx — routes and the sign-in gate. Each feature folder exports its routes.
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getPass, onPassChange, refreshMe, type PlannerPass } from './lib/auth';
import { isDemo, profileOf } from './lib/app';
import { Tour } from './demo/Tour';
import { setProfile } from './lib/routine';
import { Shell } from './ui/Shell';
import { UpdateReady } from './ui/UpdateReady';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { Settings } from './screens/Settings';
import { planRoutes } from './features/plan';
import { habitsRoutes } from './features/habits';
import { workoutRoutes } from './features/workout';
import { foodRoutes } from './features/food';
import { moneyRoutes } from './features/money';
import { cycleRoutes } from './features/cycle';
import { Calendar } from './features/calendar/Calendar';
import { Shopping } from './features/shop/Shopping';
import { ArvyLog } from './features/arvy/ArvyLog';
import './features/shop/shop.css';
import './features/calendar/calendar.css';

const featureRoutes = [...planRoutes, ...habitsRoutes, ...workoutRoutes, ...foodRoutes, ...moneyRoutes, ...cycleRoutes];

export function PlannerApp() {
  const [pass, setPass] = useState<PlannerPass | null>(() => getPass());
  const location = useLocation();

  useEffect(() => onPassChange(setPass), []);
  // the routine's defaults follow the signed-in person's profile (night: Vijay, morning: Rosh)
  useEffect(() => { setProfile(profileOf(pass?.user.settings)); }, [pass?.user.settings?.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  // once per open: make sure the server still knows this pass, and pick up settings changed elsewhere
  useEffect(() => { if (pass) void refreshMe(); }, [pass?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  // new page → top of it
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  if (!pass) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
        </Routes>
        <UpdateReady />
      </>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Today pass={pass} />} />
        {featureRoutes.map(r => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="/calendar" element={<Calendar pass={pass} />} />
        <Route path="/shop" element={<Shopping pass={pass} />} />
        <Route path="/settings" element={<Settings pass={pass} />} />
        <Route path="/settings/arvy-log" element={<ArvyLog />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {isDemo() && <Tour />}
      <UpdateReady />
    </Shell>
  );
}
