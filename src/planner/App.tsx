// src/planner/App.tsx — routes and the sign-in gate. Each feature folder exports its routes.
// A person whose set-up is still to do (lib/setup.ts: Rosh's planner, the first time) gets the set-up screens in
// place of the planner until they're done or put off; /setup runs them again from Settings.
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getPass, onPassChange, refreshMe, type PlannerPass } from './lib/auth';
import { isDemo, profileOf } from './lib/app';
import { Tour } from './demo/Tour';
import { setProfile } from './lib/routine';
import { Shell } from './ui/Shell';
import { UpdateReady } from './ui/UpdateReady';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { Settings } from './screens/Settings';
import { SetUp } from './screens/SetUp';
import { SETUP_ASK, setupDue, setupLater, setupSkipped } from './lib/setup';
import { openArvy } from './features/arvy/arvy';
import { HealthHub, LifestyleHub } from './screens/Hub';
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
  const nav = useNavigate();
  // the first-open set-up: 'checking' only while the server is asked whether it's been done (on a phone that doesn't know yet)
  const [setup, setSetup] = useState<'checking' | 'due' | 'no'>(() => (pass && !setupSkipped(pass.user) ? 'checking' : 'no'));
  const profile = profileOf(pass?.user.settings);
  useEffect(() => {
    if (!pass || setupSkipped(pass.user)) { setSetup('no'); return; }
    let on = true;
    setSetup('checking');
    void setupDue(pass.user).then(due => { if (on) setSetup(due ? 'due' : 'no'); });
    return () => { on = false; };
  }, [pass?.user.id, profile]); // eslint-disable-line react-hooks/exhaustive-deps

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
  if (setup === 'checking') return <div className="pl-login" aria-busy="true" />;
  const again = location.pathname === '/setup' && profile === 'morning';   // asked for from Settings
  if (setup === 'due' || again) {
    return (
      <>
        <SetUp pass={pass} again={setup !== 'due'}
          onDone={() => { setSetup('no'); nav('/', { replace: true }); openArvy({ ask: SETUP_ASK }); }}
          onLater={() => { if (setup === 'due') setupLater(); setSetup('no'); if (again) nav('/settings', { replace: true }); }} />
        <UpdateReady />
      </>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Today pass={pass} />} />
        {featureRoutes.map(r => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="/health" element={<HealthHub pass={pass} />} />
        <Route path="/lifestyle" element={<LifestyleHub pass={pass} />} />
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
