// src/pages/Minigame/games.ts — the list of minigames on the hub. To add a game: give it a folder
// under src/pages/Minigame, then add one entry here. Each game stores whatever it likes as its
// progress (a small JSON object); no database change is needed for a new game.
import React from 'react';

/** What every game gets from the hub. */
export type GameProps<T> = {
  /** This player's saved progress for the game, or null the first time. */
  progress: T | null;
  /** Save progress to the player's account (call after each level, or when a setting changes). */
  save: (data: T) => void;
  /** Back to the game list. */
  exit: () => void;
};

export type GameInfo = {
  id: string;                         // the progress key and the address: /minigame/<id>
  name: string;
  blurb: string;
  icon: string;
  colour: string;                     // card colour on the hub
  comingSoon?: boolean;
  component?: React.LazyExoticComponent<React.ComponentType<GameProps<any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** One line for the hub card, from saved progress (e.g. "Level 19"). */
  summary?: (progress: Record<string, unknown> | null) => string | null;
  /** Progress left on this phone from before accounts, if any, and how far it got. */
  localProgress?: () => { data: Record<string, unknown>; rank: number; label: string } | null;
  /** How far saved progress got, to compare with the phone's (higher wins). */
  rank?: (progress: Record<string, unknown> | null) => number;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const GAMES: GameInfo[] = [
  {
    id: 'pour', name: 'Pour', icon: '🧪', colour: '#7c3aed',
    blurb: 'Sort the colours so each bottle holds just one.',
    component: React.lazy(() => import('./PourGame')),
    summary: p => (p ? `Level ${num(p.level) || 1}` : null),
    rank: p => num(p?.level),
    localProgress: () => {
      try {
        const s = JSON.parse(localStorage.getItem('pour.v1') || 'null');
        if (!s || !Number.isInteger(s.level) || s.level <= 1) return null;
        return { data: { level: s.level, best: Math.max(num(s.best), s.level), sound: !!s.sound }, rank: s.level, label: `level ${s.level}` };
      } catch { return null; }
    },
  },
  {
    id: 'chess', name: 'Little Chess', icon: '♞', colour: '#0f766e', comingSoon: true,
    blurb: 'First steps in chess, made for little hands.',
  },
];
