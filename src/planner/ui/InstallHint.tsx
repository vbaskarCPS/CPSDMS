// src/planner/ui/InstallHint.tsx — "add to home screen", so the planner sits next to the field app.
// Android/desktop Chrome: the install prompt. iPhone: the share-sheet steps. Hidden once installed.
import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { app, appId } from '../lib/app';

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const DISMISSED = `${appId()}-install-dismissed`;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;

export function InstallHint() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => { try { return isStandalone() || sessionStorage.getItem(DISMISSED) === '1'; } catch { return isStandalone(); } });
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (hidden) return null;
  if (!prompt && !isIOS()) return null;

  const dismiss = () => { setHidden(true); try { sessionStorage.setItem(DISMISSED, '1'); } catch { /* fine */ } };
  const install = async () => {
    if (prompt) { await prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === 'accepted') setHidden(true); }
    else setShowIOS(true);
  };

  return (
    <>
      <div className="pl-card pl-row pl-fade">
        <Download aria-hidden style={{ color: 'var(--accent)' }} />
        <div className="pl-grow">
          <b>Add to your home screen</b>
          <p className="pl-muted" style={{ fontSize: 13 }}>{appId() === 'vijayplanner' ? 'Opens as its own app, next to the CPS app.' : 'Opens as its own app.'}</p>
        </div>
        <button className="pl-btn pl-btn--primary" style={{ minHeight: 40 }} onClick={install}>Install</button>
        <button className="pl-btn pl-btn--ghost" style={{ minHeight: 40, padding: '0 8px', border: 0 }} aria-label="Not now" onClick={dismiss}><X /></button>
      </div>
      {showIOS && (
        <div className="pl-sheet" onClick={() => setShowIOS(false)}>
          <div onClick={e => e.stopPropagation()} className="pl-stack">
            <h2>On iPhone</h2>
            <p>1. Tap the <Share aria-label="Share" style={{ verticalAlign: 'middle', width: 18, height: 18 }} /> <b>Share</b> button at the bottom of Safari.</p>
            <p>2. Scroll and tap <b>Add to Home Screen</b>.</p>
            <p>3. Tap <b>Add</b>. "{app().short}" appears next to your other apps.</p>
            <button className="pl-btn pl-btn--block" onClick={() => setShowIOS(false)}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}
