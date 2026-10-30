// src/planner/App.tsx — routes and the sign-in gate.
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getPass, onPassChange, refreshMe, type PlannerPass } from './lib/auth';
import { Shell } from './ui/Shell';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { Settings } from './screens/Settings';
import { ComingSoon } from './screens/ComingSoon';

export function PlannerApp() {
  const [pass, setPass] = useState<PlannerPass | null>(() => getPass());
  const location = useLocation();

  useEffect(() => onPassChange(setPass), []);
  // once per open: make sure the server still knows this pass, and pick up settings changed elsewhere
  useEffect(() => { if (pass) void refreshMe(); }, [pass?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pass) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Today pass={pass} />} />
        <Route path="/plan" element={<ComingSoon title="Daily page" blurb="Morning mindset, your 3 projects, people and priorities, and the evening review." />} />
        <Route path="/habits" element={<ComingSoon title="Habits" blurb="Identity, cue, stack, 2-minute version. Never miss twice." />} />
        <Route path="/workout" element={<ComingSoon title="Workout" blurb="Log sets, rest timer, progressive overload, and your coach." />} />
        <Route path="/food" element={<ComingSoon title="Food" blurb="Snap a photo, confirm the portions, hit your protein." />} />
        <Route path="/settings" element={<Settings pass={pass} />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
