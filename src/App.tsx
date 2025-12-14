// src/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// --- Auth ---
import HomePage from './pages/HomePage';

// --- Staff Portal ---
import Dashboard from './pages/Logsheet/Dashboard';
import JobDetail from './pages/Logsheet/JobDetail';
import NewJob from './pages/Logsheet/NewJob';
import NotFound from './pages/Logsheet/NotFound';

// --- Management Portal ---
import RMLogbook from './pages/Management/RMLogbook';

// --- Admin ---
import SessionCommandCenter from './pages/Admin/SessionCommandCenter'; 
import PayoutContractor from './pages/Management/PayoutContractor'; // <--- IMPORT THIS

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      
      {/* --- STAFF ROUTES --- */}
      <Route path="/logsheet" element={<Dashboard />} />
      <Route path="/job-detail/:jobId" element={<JobDetail />} />
      <Route path="/logsheet/new" element={<NewJob />} />

      {/* --- MANAGEMENT ROUTES --- */}
      <Route path="/rm-logbook" element={<RMLogbook />} />

      {/* --- ADMIN ROUTES --- */}
      <Route path="/admin/command-center" element={<SessionCommandCenter />} />
      <Route path="/admin" element={<Navigate to="/admin/command-center" replace />} />
      
      {/* NEW ROUTE FOR PAYOUT CONTRACTOR */}
      <Route path="/admin/payout/:contractorId" element={<PayoutContractor />} />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default App;