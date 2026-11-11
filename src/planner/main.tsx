// src/planner/main.tsx — the planner: one page, two installs (Vijay at /vijayplanner, Rosh at /roshplanner).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PlannerApp } from './App';
import { appBase, isDemo } from './lib/app';
import { registerAppWorker } from '../lib/offline/appUpdate';
import './planner.css';

// Keep the app's service worker (shared with the field app, scope '/') registered from the planner too,
// so an installed planner receives push reminders, and notice when a newer version has downloaded
// (ui/UpdateReady offers "Update"; the app is checked whenever it comes back to the front). Production only;
// a failure changes nothing.
if (!isDemo() && (import.meta as unknown as { env: { PROD: boolean } }).env.PROD && 'serviceWorker' in navigator) {
  void registerAppWorker();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={appBase()}>
      <PlannerApp />
    </BrowserRouter>
  </StrictMode>
);
