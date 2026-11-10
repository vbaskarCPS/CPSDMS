import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { UpdateBanner } from './components/UpdateBanner';
import { MaintenanceLock, lockMessage, watchLock } from './components/MaintenanceLock';
import { registerAppWorker, watchForStaleBuild } from './lib/offline/appUpdate';
import { ready as fieldDayReady } from './lib/offline/dayStore';
import { msDemo } from './lib/msDemoFlag';

// A field day kept on this phone that's past its 18 hours is wiped before anything reads it.
void fieldDayReady();
// Keep the app on the phone so it opens with no signal (production builds only).
if ((import.meta as unknown as { env: { PROD: boolean } }).env.PROD) { watchForStaleBuild(); void registerAppWorker(); }

const root = createRoot(document.getElementById('root')!);
if (msDemo) {
  // propertystars.app/mainstreetaidemo: the MainstreetAI rep and host apps on sample data, its own little world
  // (no Property Stars routes, location tracking or coach). The network goes to the demo's pretend server first.
  void Promise.all([import('./msdemo/install'), import('./msdemo/MsDemo')]).then(([net, demo]) => {
    net.installDemoNetwork();
    const Demo = demo.default;
    root.render(<StrictMode><Demo /></StrictMode>);
  });
} else {
  const showLock = (message: string) => root.render(<StrictMode><MaintenanceLock message={message} /></StrictMode>);
  // closed for maintenance? (src/components/MaintenanceLock.tsx — no signal or no answer: open as usual)
  void lockMessage().then(message => {
    if (message) { showLock(message); watchLock(true, showLock); return; }
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
          <UpdateBanner />
        </BrowserRouter>
      </StrictMode>
    );
    watchLock(false, showLock);
  });
}
