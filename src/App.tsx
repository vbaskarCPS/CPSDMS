// src/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Pages
import HomePage from './pages/HomePage';
import SessionCommandCenter from './pages/Admin/SessionCommandCenter';
import CommandCenterCreator from './pages/SuperAdmin/CommandCenterCreator';

// Admin pages - regular imports for reliability (avoid chunk loading issues)
import EmailTemplates from './pages/Admin/EmailTemplates';
import EmailTemplateEditor from './pages/Admin/EmailTemplateEditor';

// Lazy load less frequently used pages
const RMLogbook = React.lazy(() => import('./pages/Management/RMLogbook'));
const Logsheet = React.lazy(() => import('./pages/Logsheet/Dashboard'));
const NewJob = React.lazy(() => import('./pages/Logsheet/NewJob'));
const JobDetail = React.lazy(() => import('./pages/Logsheet/JobDetail'));
const NotFound = React.lazy(() => import('./pages/Logsheet/NotFound'));
const PayoutContractor = React.lazy(() => import('./pages/Management/PayoutContractor'));
const ApplicantForm = React.lazy(() => import('./pages/Public/ApplicantForm'));

// Campaign / Dialer pages
const CampaignCreator = React.lazy(() => import('./pages/SuperAdmin/CampaignCreator'));
const DialerPage = React.lazy(() => import('./pages/Dialer/DialerPage'));

// Training pages
const TrainingPortal = React.lazy(() => import('./pages/Training/TrainingPortal'));
const TrainingModulePage = React.lazy(() => import('./pages/Training/TrainingModulePage'));

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

        {/* Public Job Fair Application Form */}
        <Route path="/:slug" element={<ApplicantForm />} />

        {/* Super Admin Route */}
        <Route path="/super-admin" element={<CommandCenterCreator />} />
        <Route path="/super-admin/campaigns" element={<CampaignCreator />} />

        {/* Command Center Admin Routes */}
        <Route path="/admin" element={<SessionCommandCenter />} />
        <Route path="/admin/command-center" element={<SessionCommandCenter />} />
        <Route path="/admin/payout/:contractorId" element={<PayoutContractor />} />
        <Route path="/admin/email-templates" element={<EmailTemplates />} />
        <Route path="/admin/email-templates/:templateType" element={<EmailTemplateEditor />} />

        {/* Route Manager Routes */}
        <Route path="/rm-logbook" element={<RMLogbook />} />

        {/* Worker Routes */}
        <Route path="/logsheet" element={<Logsheet />} />
        <Route path="/logsheet/new" element={<NewJob />} />
        <Route path="/job-detail/:jobId" element={<JobDetail />} />

        {/* Training Routes (contractors with no active session) */}
        <Route path="/training" element={<TrainingPortal />} />
        <Route path="/training/:moduleId" element={<TrainingModulePage />} />

        {/* Dialer Route (Campaign Managers land here after login) */}
        <Route path="/dialer" element={<DialerPage />} />

        {/* 404 Not Found */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </React.Suspense>
  );
}

export default App;