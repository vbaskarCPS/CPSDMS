// src/components/UpdateBanner.tsx — "Update ready" when a new version of the app has downloaded.
// Nothing reloads by itself, so nobody loses a half-written sale; tap Update when it suits.
import React, { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady, updateReady } from '../lib/offline/appUpdate';

export const UpdateBanner: React.FC = () => {
  const [show, setShow] = useState(updateReady());
  useEffect(() => onUpdateReady(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div role="status" style={{ position: 'fixed', left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 2147483000, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: '#111827', color: '#fff', borderRadius: 14, padding: '10px 12px 10px 16px', boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
        <span>Update ready</span>
        <button type="button" onClick={applyUpdate} style={{ background: '#22c55e', color: '#052e16', border: 0, borderRadius: 10, padding: '6px 12px', fontWeight: 700 }}>Update</button>
        <button type="button" aria-label="Later" onClick={() => setShow(false)} style={{ background: 'transparent', color: '#9ca3af', border: 0, fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
};
