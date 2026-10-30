import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { UpdateBanner } from './components/UpdateBanner';
import { registerAppWorker } from './lib/offline/appUpdate';
import { ready as fieldDayReady } from './lib/offline/dayStore';

// A field day kept on this phone that's past its 18 hours is wiped before anything reads it.
void fieldDayReady();
// Keep the app on the phone so it opens with no signal (production builds only).
if ((import.meta as unknown as { env: { PROD: boolean } }).env.PROD) void registerAppWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <UpdateBanner />
    </BrowserRouter>
  </StrictMode>
);
