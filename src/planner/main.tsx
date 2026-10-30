// src/planner/main.tsx — the planner: one page, two installs (Vijay at /vijayplanner, Rosh at /roshplanner).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PlannerApp } from './App';
import { appBase } from './lib/app';
import './planner.css';

// Keep the app's service worker (shared with the field app, scope '/') registered from the planner too,
// so an installed planner receives push reminders. Production only; a failure changes nothing.
if ((import.meta as unknown as { env: { PROD: boolean } }).env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={appBase()}>
      <PlannerApp />
    </BrowserRouter>
  </StrictMode>
);
