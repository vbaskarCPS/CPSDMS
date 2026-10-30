// src/planner/main.tsx — Vijay Planner, a second app in this repo, served at /vijayplanner (planner.html).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PlannerApp } from './App';
import './planner.css';

// Keep the app's service worker (shared with the field app, scope '/') registered from the planner too,
// so an installed planner receives push reminders. Production only; a failure changes nothing.
if ((import.meta as unknown as { env: { PROD: boolean } }).env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/vijayplanner">
      <PlannerApp />
    </BrowserRouter>
  </StrictMode>
);
