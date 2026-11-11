// src/planner/App.tsx — routes and the sign-in gate. Each feature folder exports its routes.
// A person whose set-up is still to do (lib/setup.ts: Rosh's planner, the first time) gets the set-up screens in
// place of the planner until they're done or put off; /setup runs them again from Settings.
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getPass, onPassChange, refreshMe, type PlannerPass } from './lib/auth';
import { appBase, isDemo, profileOf } from './lib/app';
import { movePush } from './lib/push';
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
import { openUs } from './features/us/us';
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
import { IconsScreen } from './features/icons';
import { ArrangeToday } from './features/widgets';
import './features/shop/shop.css';
import './features/calendar/calendar.css';

const featureRoutes = [...planRoutes, ...habitsRoutes, ...workoutRoutes, ...foodRoutes, ...moneyRoutes, ...cycleRoutes];

/** /us: where a notification about the chat between the two of them lands. It opens the chat over Today. */
function OpenUs() {
  useEffect(() => { openUs(); }, []);
  return <Navigate to="/" replace />;
}

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
  // notifications: a phone that turned them on before the planner had its own notification worker is moved over to
  // it (so they come from the Planner app, not from Chrome), and a tapped notification says where to go
  useEffect(() => { if (pass) void movePush(); }, [pass?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 'planner-open' || typeof e.data.url !== 'string') return;
      const path = e.data.url.startsWith(appBase()) ? e.data.url.slice(appBase().length) || '/' : '/';
      nav(path);
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, [nav]);
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
        <Route path="/settings/widgets" element={<ArrangeToday pass={pass} />} />
        <Route path="/settings/arvy-log" element={<ArvyLog />} />
        <Route path="/settings/icons" element={<IconsScreen pass={pass} />} />
        <Route path="/us" element={<OpenUs />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {isDemo() && <Tour />}
      <UpdateReady />
    </Shell>
  );
}
