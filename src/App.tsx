// src/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Pages
import HomePage from './pages/HomePage';
import SessionCommandCenter from './pages/Admin/SessionCommandCenter';
import CommandCenterCreator from './pages/SuperAdmin/CommandCenterCreator';

// Lazy load less frequently used pages
const RMLogbook = React.lazy(() => import('./pages/Management/RMLogbook'));
const Logsheet = React.lazy(() => import('./pages/Logsheet/Dashboard'));

// Loading fallback
const LoadingFallback = () => (
  <div className="min-h-screen bg-gray-900 flex items-center justify-center">
    <div className="text-white text-lg animate-pulse">Loading...</div>
  </div>
);

function App() {
  return (
    <React.Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<HomePage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Super Admin Route */}
        <Route path="/super-admin" element={<CommandCenterCreator />} />

        {/* Command Center Admin Route */}
        <Route path="/admin" element={<SessionCommandCenter />} />

        {/* Route Manager Routes */}
        <Route path="/rm-logbook" element={<RMLogbook />} />

        {/* Worker Routes */}
        <Route path="/logsheet" element={<Logsheet />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </React.Suspense>
  );
}

export default App;