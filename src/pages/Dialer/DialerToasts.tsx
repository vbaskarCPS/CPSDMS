// src/pages/Dialer/DialerToasts.tsx
//
// Badge toast notifications + point float toasts for the AutoSniper dialer.
// Ported from PreviewDialerSidebar toast system.
//

import { useState, useEffect, useCallback, useRef } from 'react';
import { BADGE_DEFS } from '../../lib/dialer/gamificationDefs';

// --- Toast color map (matches sidebar CSS classes) ---
const TOAST_COLORS: Record<string, string> = {
  'toast-double': '#f39c12', 'toast-triple': '#e74c3c', 'toast-unstoppable': '#ff0040',
  'toast-ace': '#9b59b6', 'toast-rampage': '#ff6b35', 'toast-godlike': '#00ffff',
  'toast-legendary': '#ffd700', 'toast-nuke': '#ff0000', 'toast-beyondgodlike': '#ff00ff',
  'toast-firstblood': '#e74c3c', 'toast-domination': '#f1c40f',
  'toast-doubletap': '#e67e22', 'toast-hattrick': '#9b59b6', 'toast-grandslam': '#3498db',
  'toast-royalflush': '#f1c40f',
  'toast-linkshot': '#2ecc71', 'toast-ducks': '#4fc3f7', 'toast-ducksplosion': '#ff9800',
  'toast-noscope': '#00BCD4', 'toast-earlybird': '#f39c12', 'toast-buzzerbeater': '#e74c3c',
  'toast-headhunter': '#9b59b6', 'toast-trophyhunter': '#e67e22', 'toast-apexpredator': '#e74c3c',
  'toast-faststart': '#1abc9c',
  'toast-gravedigger': '#888', 'toast-necromancer': '#9b59b6', 'toast-lichking': '#f1c40f', 'toast-resurrection': '#ff00ff',
  'toast-killingspree': '#ff5722', 'toast-warpath': '#ff3d00', 'toast-onslaught': '#d50000',
  'toast-massacre': '#b71c1c', 'toast-annihilation': '#ff00ff',
  'toast-ironman': '#e67e22', 'toast-machine': '#e74c3c', 'toast-terminator': '#ff0000',
  'toast-rank': '#f1c40f', 'toast-milestone': '#3498db',
};

// --- Badge Toast ---

interface BadgeToast {
  id: string;
  icon: string;
  name: string;
  desc: string;
  color: string;
  phase: 'enter' | 'show' | 'exit';
}

interface PointToast {
  id: number;
  points: number;
  multiplier: number;
  phase: 'enter' | 'show' | 'exit';
}

// --- Hook ---

export function useToasts() {
  const [badgeToasts, setBadgeToasts] = useState<BadgeToast[]>([]);
  const [pointToasts, setPointToasts] = useState<PointToast[]>([]);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const pointIdRef = useRef(0);

  const processQueue = useCallback(() => {
    if (queueRef.current.length === 0) {
      processingRef.current = false;
      return;
    }
    processingRef.current = true;
    const badgeId = queueRef.current.shift()!;
    const def = BADGE_DEFS[badgeId];
    if (!def) { processQueue(); return; }

    const toast: BadgeToast = {
      id: badgeId + '_' + Date.now(),
      icon: def.icon,
      name: def.name,
      desc: def.desc,
      color: TOAST_COLORS[def.color] || '#2ecc71',
      phase: 'enter',
    };

    setBadgeToasts(prev => [...prev, toast]);

    setTimeout(() => {
      setBadgeToasts(prev => prev.map(t => t.id === toast.id ? { ...t, phase: 'show' } : t));
    }, 50);

    setTimeout(() => {
      setBadgeToasts(prev => prev.map(t => t.id === toast.id ? { ...t, phase: 'exit' } : t));
      setTimeout(() => {
        setBadgeToasts(prev => prev.filter(t => t.id !== toast.id));
        processQueue();
      }, 400);
    }, 1800);
  }, []);

  const queueBadgeToast = useCallback((badgeId: string) => {
    queueRef.current.push(badgeId);
    if (!processingRef.current) processQueue();
  }, [processQueue]);

  const showPointToast = useCallback((points: number, multiplier: number) => {
    if (!points || points <= 0) return;
    const id = ++pointIdRef.current;
    const toast: PointToast = { id, points, multiplier, phase: 'enter' };
    setPointToasts(prev => [...prev, toast]);

    setTimeout(() => {
      setPointToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'show' } : t));
    }, 50);

    setTimeout(() => {
      setPointToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'exit' } : t));
      setTimeout(() => {
        setPointToasts(prev => prev.filter(t => t.id !== id));
      }, 500);
    }, 1200);
  }, []);

  return { badgeToasts, pointToasts, queueBadgeToast, showPointToast };
}

// --- Components ---

export function BadgeToastContainer({ toasts }: { toasts: BadgeToast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none flex flex-col items-center gap-1.5">
      {toasts.map(t => (
        <div
          key={t.id}
          className="text-center transition-all duration-300 ease-out"
          style={{
            opacity: t.phase === 'show' ? 1 : t.phase === 'exit' ? 0 : 0,
            transform: t.phase === 'show' ? 'scale(1)' : t.phase === 'exit' ? 'scale(1.5)' : 'scale(0.3)',
          }}
        >
          <div
            className="text-2xl font-black tracking-widest uppercase font-mono"
            style={{ color: t.color, textShadow: `0 0 20px ${t.color}, 0 0 40px ${t.color}` }}
          >
            {t.icon} {t.name}
          </div>
          <div className="text-xs font-bold tracking-wider mt-0.5 opacity-80" style={{ color: t.color }}>
            {t.desc}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PointToastContainer({ toasts }: { toasts: PointToast[] }) {
  if (toasts.length === 0) return null;

  return (
    <>
      {toasts.map(t => (
        <div
          key={t.id}
          className="fixed left-1/2 z-40 pointer-events-none text-center transition-all duration-400 ease-out"
          style={{
            top: '55%',
            opacity: t.phase === 'show' ? 1 : t.phase === 'exit' ? 0 : 0,
            transform: t.phase === 'show'
              ? 'translate(-50%, -60%)'
              : t.phase === 'exit'
                ? 'translate(-50%, -80%)'
                : 'translate(-50%, -50%)',
          }}
        >
          <div
            className="text-3xl font-black font-mono"
            style={{ color: '#00BCD4', textShadow: '0 0 15px rgba(0,188,212,0.5)' }}
          >
            +{t.points}
          </div>
          {t.multiplier > 1 && (
            <div className="text-xs font-bold tracking-wider" style={{ color: '#f1c40f' }}>
              {t.multiplier}x MULTIPLIER
            </div>
          )}
        </div>
      ))}
    </>
  );
}