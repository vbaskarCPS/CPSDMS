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
const NewJob = React.lazy(() => import('./pages/Logsheet/NewJob'));
const JobDetail = React.lazy(() => import('./pages/Logsheet/JobDetail'));
const NotFound = React.lazy(() => import('./pages/Logsheet/NotFound'));
const EmailTemplates = React.lazy(() => import('./pages/Admin/EmailTemplates'));
const EmailTemplateEditor = React.lazy(() => import('./pages/Admin/EmailTemplateEditor'));
const PayoutContractor = React.lazy(() => import('./pages/Management/PayoutContractor'));
const ApplicantForm = React.lazy(() => import('./pages/Public/ApplicantForm'));

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

        {/* 404 Not Found */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </React.Suspense>
  );
}

export default App;
```

---

# Summary - All Files Complete! 

## Files to Create/Replace:

| # | File Path | Action |
|---|-----------|--------|
| 1 | **SQL** | Run in Supabase SQL Editor |
| 2 | `src/types/index.ts` | Replace |
| 3 | `src/lib/commandCenterService.ts` | Replace |
| 4 | `src/lib/jobFairService.ts` | **Create New** |
| 5 | `src/lib/realtimeService.ts` | Replace |
| 6 | `src/lib/googleSheetsService.ts` | Replace |
| 7 | `src/components/AddressAutocomplete.tsx` | **Create New** |
| 8 | `src/pages/Public/ApplicantForm.tsx` | **Create New** |
| 9 | `src/pages/Admin/JobFairManager.tsx` | **Create New** |
| 10 | `src/pages/SuperAdmin/CommandCenterCreator.tsx` | Replace |
| 11 | `src/pages/Admin/SessionCommandCenter.tsx` | Replace |
| 12 | `src/App.tsx` | Replace |

## Implementation Order:

1. **Run SQL migration first** (creates tables and columns)
2. **Create new directories** if needed:
   - `src/pages/Public/` (for ApplicantForm)
   - `src/components/` (for AddressAutocomplete)
3. **Replace/create files** in any order
4. **Add environment variable to local dev** (if using locally):
```
   VITE_GOOGLE_PLACES_API_KEY=AIzaSyASRjsnjPrMn6VUegoYqxVXfy9aW38Y2Ko