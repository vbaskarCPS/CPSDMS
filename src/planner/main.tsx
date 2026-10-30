// src/planner/main.tsx — Vijay Planner, a second app in this repo, served at /vijayplanner (planner.html).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PlannerApp } from './App';
import './planner.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/vijayplanner">
      <PlannerApp />
    </BrowserRouter>
  </StrictMode>
);
