// src/pages/Demo/DemoPage.tsx — propertystars.app/demo: the public guided tour of the Route Manager
// map and the worker's map logsheet. Start builds a private demo centre for this visitor and opens
// the Route Manager map with the coach; the tour goes manager → worker → manager.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, Map, Smartphone, Users } from 'lucide-react';
import { STEPS, demoExpired, readDemo, writeDemo } from '../../lib/demoTour';
import { becomeManager, becomeWorker, startDemo } from './demoRoles';

const DemoPage: React.FC = () => {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(() => { const s = readDemo(); return s && !demoExpired(s) ? s : null; });
  useEffect(() => { document.title = 'Property Stars — field app tour'; }, []);

  const start = async () => {
    setBusy('Setting up your demo…'); setError(null);
    try {
      await startDemo();
      window.dispatchEvent(new Event('cpsdms:demo'));
      nav('/rm-logbook');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };
  const resume = async () => {
    if (!existing) return;
    setBusy('Opening…');
    try {
      if (existing.role === 'worker') await becomeWorker(existing.sandbox); else await becomeManager(existing.sandbox);
      nav(existing.role === 'worker' ? '/map-logsheet' : '/rm-logbook');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); writeDemo(null); setExisting(null); }
  };

  const acts = ['Route Manager', 'Worker', 'Route Manager again'] as const;
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="w-full max-w-xl bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="text-xs uppercase tracking-wide text-emerald-400 font-bold">Property Stars</div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1">The field app, in ten minutes</h1>
        <p className="text-gray-300 mt-3 text-sm sm:text-base">
          A guided tour of the two screens a crew lives on: the <b>Route Manager map</b> and the worker’s <b>map logsheet</b>.
          You get a private demo day of your own, with real streets, a team of six and a partner who has already knocked a few doors.
          Nothing you do here touches a real centre.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          {acts.map((a, i) => {
            const Icon = i === 1 ? Smartphone : i === 0 ? Map : Users;
            const n = STEPS.filter(s => s.act === a).length;
            return (
              <div key={a} className="bg-gray-800/70 border border-gray-700 rounded-xl p-3">
                <Icon size={18} className="text-emerald-300" />
                <div className="text-sm font-bold text-white mt-2">{i + 1}. {a}</div>
                <div className="text-xs text-gray-400 mt-0.5">{n} steps</div>
              </div>
            );
          })}
        </div>
        <ul className="text-sm text-gray-300 mt-5 space-y-1 list-disc pl-5">
          <li>Assign a route, move a worker between carts, share your map, add a late arrival.</li>
          <li>Knock doors as the worker, mark an invalid, log a sale from pending to paid.</li>
          <li>Back as the manager: see the sale land, check the crew’s knocking.</li>
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={start} disabled={!!busy} className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold flex items-center gap-2">
            {busy ? <><Loader size={16} className="animate-spin" /> {busy}</> : 'Start the tour'}
          </button>
          {existing && !busy && (
            <button type="button" onClick={resume} className="px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-100 text-sm">
              Continue your demo (step {existing.step + 1} of {STEPS.length})
            </button>
          )}
        </div>
        {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
        <div className="mt-6 text-xs text-gray-500">Works on a phone or a laptop; the worker part is best on a phone. Each demo lasts three hours, then it’s cleared away.</div>
      </div>
    </div>
  );
};

export default DemoPage;
