// src/pages/Dialer/DialerToasts.tsx
//
// Badge toast notifications + point float toasts for the AutoSniper dialer.
// Features: pulse ring entry animation, custom SVG badge icons, breathing glow,
// typewriter name reveal, enhanced point floats with arc motion.
//

import { useState, useEffect, useCallback, useRef } from 'react';
import { BADGE_DEFS } from '../../lib/dialer/gamificationDefs';
import { getBadgeIcon, getBadgeCategoryColor } from './BadgeIcons';

// --- Toast color map ---
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

// --- Types ---

interface BadgeToast {
  id: string;
  badgeId: string;
  icon: string;
  name: string;
  desc: string;
  bonus: number;
  color: string;
  categoryColor: string;
  phase: 'enter' | 'pulse' | 'show' | 'exit';
}

interface PointToast {
  id: number;
  points: number;
  multiplier: number;
  phase: 'enter' | 'show' | 'exit';
}

// --- Keyframe styles (injected once) ---

const TOAST_STYLES = `
  @keyframes toast-pulse-ring {
    0% { transform: scale(0.3); opacity: 0.8; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  @keyframes toast-pulse-ring-2 {
    0% { transform: scale(0.5); opacity: 0.6; }
    100% { transform: scale(2); opacity: 0; }
  }
  @keyframes toast-icon-slam {
    0% { transform: scale(0); opacity: 0; }
    50% { transform: scale(1.3); opacity: 1; }
    70% { transform: scale(0.9); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes toast-breathe {
    0%, 100% { transform: scale(1); opacity: 0.15; }
    50% { transform: scale(1.15); opacity: 0.3; }
  }
  @keyframes toast-icon-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
  @keyframes toast-name-reveal {
    0% { clip-path: inset(0 100% 0 0); opacity: 0; }
    100% { clip-path: inset(0 0% 0 0); opacity: 1; }
  }
  @keyframes toast-desc-fade {
    0% { opacity: 0; transform: translateY(4px); }
    100% { opacity: 0.8; transform: translateY(0); }
  }
  @keyframes toast-bonus-pop {
    0% { opacity: 0; transform: scale(0.5); }
    60% { transform: scale(1.2); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes toast-exit {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(1.4); opacity: 0; }
  }
  @keyframes point-float-up {
    0% { opacity: 0; transform: translate(-50%, 0) scale(0.7); }
    15% { opacity: 1; transform: translate(-50%, -10px) scale(1.15); }
    30% { transform: translate(-50%, -20px) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -60px) scale(0.9); }
  }
  @keyframes point-mult-fade {
    0% { opacity: 0; transform: translateY(3px); }
    25% { opacity: 1; transform: translateY(0); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
`;

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
      badgeId,
      icon: def.icon,
      name: def.name,
      desc: def.desc,
      bonus: def.bonus,
      color: TOAST_COLORS[def.color] || '#2ecc71',
      categoryColor: getBadgeCategoryColor(badgeId),
      phase: 'enter',
    };

    setBadgeToasts(prev => [...prev, toast]);

    // Phase: enter → pulse (icon slams in)
    setTimeout(() => {
      setBadgeToasts(prev => prev.map(t => t.id === toast.id ? { ...t, phase: 'pulse' } : t));
    }, 50);

    // Phase: pulse → show (breathing glow)
    setTimeout(() => {
      setBadgeToasts(prev => prev.map(t => t.id === toast.id ? { ...t, phase: 'show' } : t));
    }, 600);

    // Phase: show → exit
    setTimeout(() => {
      setBadgeToasts(prev => prev.map(t => t.id === toast.id ? { ...t, phase: 'exit' } : t));
      setTimeout(() => {
        setBadgeToasts(prev => prev.filter(t => t.id !== toast.id));
        processQueue();
      }, 500);
    }, 2400);
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
      }, 600);
    }, 1500);
  }, []);

  return { badgeToasts, pointToasts, queueBadgeToast, showPointToast };
}

// --- Badge Toast Container ---

export function BadgeToastContainer({ toasts }: { toasts: BadgeToast[] }) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{TOAST_STYLES}</style>
      <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        {toasts.map(t => (
          <BadgeToastItem key={t.id} toast={t} />
        ))}
      </div>
    </>
  );
}

function BadgeToastItem({ toast: t }: { toast: BadgeToast }) {
  const svgIcon = getBadgeIcon(t.badgeId, 48);
  const isExiting = t.phase === 'exit';
  const isActive = t.phase === 'pulse' || t.phase === 'show';
  const isBreathing = t.phase === 'show';

  return (
    <div
      className="flex flex-col items-center"
      style={{
        animation: isExiting ? 'toast-exit 0.5s ease-in forwards' : undefined,
      }}
    >
      {/* Pulse rings (on entry) */}
      {isActive && (
        <div className="absolute" style={{ width: 120, height: 120 }}>
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: `2px solid ${t.color}`,
              animation: 'toast-pulse-ring 0.8s ease-out forwards',
            }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: `1.5px solid ${t.color}`,
              animation: 'toast-pulse-ring-2 0.8s ease-out 0.1s forwards',
            }}
          />
        </div>
      )}

      {/* Breathing glow halo */}
      {isBreathing && (
        <div
          className="absolute rounded-full"
          style={{
            width: 80,
            height: 80,
            background: `radial-gradient(circle, ${t.color}30 0%, transparent 70%)`,
            animation: 'toast-breathe 1.5s ease-in-out infinite',
          }}
        />
      )}

      {/* Icon container */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 64,
          height: 64,
          animation: isActive
            ? isBreathing
              ? 'toast-icon-breathe 1.5s ease-in-out infinite'
              : 'toast-icon-slam 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
            : undefined,
          opacity: isActive ? 1 : 0,
          filter: `drop-shadow(0 0 12px ${t.color}80) drop-shadow(0 0 24px ${t.color}40)`,
        }}
      >
        {svgIcon || (
          <span style={{ fontSize: 40, lineHeight: 1 }}>{t.icon}</span>
        )}
      </div>

      {/* Badge name — typewriter reveal */}
      <div
        className="mt-2 font-mono font-black tracking-[3px] uppercase text-center"
        style={{
          fontSize: 16,
          color: t.color,
          textShadow: `0 0 16px ${t.color}, 0 0 32px ${t.color}80`,
          animation: isActive ? 'toast-name-reveal 0.4s ease-out 0.3s both' : undefined,
          opacity: isActive ? undefined : 0,
          letterSpacing: '3px',
        }}
      >
        {t.name}
      </div>

      {/* Description */}
      <div
        className="mt-0.5 font-mono text-center"
        style={{
          fontSize: 11,
          color: `${t.color}cc`,
          letterSpacing: '1px',
          animation: isActive ? 'toast-desc-fade 0.3s ease-out 0.5s both' : undefined,
          opacity: isActive ? undefined : 0,
        }}
      >
        {t.desc}
      </div>

      {/* Bonus points badge */}
      {t.bonus > 0 && (
        <div
          className="mt-1.5 font-mono font-black"
          style={{
            fontSize: 12,
            color: '#fff',
            background: `${t.color}25`,
            border: `1px solid ${t.color}50`,
            borderRadius: 20,
            padding: '2px 10px',
            animation: isActive ? 'toast-bonus-pop 0.3s ease-out 0.6s both' : undefined,
            opacity: isActive ? undefined : 0,
          }}
        >
          +{t.bonus} <span style={{ fontSize: 9, opacity: 0.7 }}>PTS</span>
        </div>
      )}
    </div>
  );
}

// --- Point Toast Container ---

export function PointToastContainer({ toasts }: { toasts: PointToast[] }) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{TOAST_STYLES}</style>
      {toasts.map(t => (
        <PointToastItem key={t.id} toast={t} />
      ))}
    </>
  );
}

function PointToastItem({ toast: t }: { toast: PointToast }) {
  const isHigh = t.points >= 500;
  const isMed = t.points >= 200;
  const color = isHigh ? '#ffd700' : isMed ? '#f1c40f' : '#00BCD4';

  return (
    <div
      className="fixed z-40 pointer-events-none text-center"
      style={{
        top: '52%',
        left: '50%',
        animation: t.phase !== 'enter'
          ? 'point-float-up 1.5s ease-out forwards'
          : undefined,
        opacity: t.phase === 'enter' ? 0 : undefined,
      }}
    >
      <div
        className="font-black font-mono"
        style={{
          fontSize: isHigh ? 36 : isMed ? 30 : 26,
          color,
          textShadow: `0 0 12px ${color}80, 0 0 24px ${color}40`,
          lineHeight: 1,
        }}
      >
        +{t.points}
      </div>
      {t.multiplier > 1 && (
        <div
          className="font-mono font-bold"
          style={{
            fontSize: 10,
            color: '#f1c40f',
            letterSpacing: '1.5px',
            animation: t.phase !== 'enter' ? 'point-mult-fade 1.5s ease-out forwards' : undefined,
          }}
        >
          {t.multiplier}x MULTIPLIER
        </div>
      )}
    </div>
  );
}