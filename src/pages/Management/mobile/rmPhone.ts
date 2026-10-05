// src/pages/Management/mobile/rmPhone.ts
//
// Phone-layout plumbing for the Route Manager logbook:
//   - deciding whether this device gets the phone layout
//   - the remembered "Desktop view" / "Phone view" choice
//   - small helpers shared by the phone screens

import { useCallback, useState } from 'react';
import { SEASON_CONFIGS, SeasonType } from '../../../types';

export type RMLayout = 'phone' | 'desktop';

const LAYOUT_KEY = 'rm_layout_override';

/**
 * A phone = a touch screen whose SHORT side is under 600px. Uses the screen,
 * not the window, so turning the phone sideways never flips the layout, and
 * tablets (short side 600px+) keep the desktop layout they're tuned for.
 */
export function isPhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const w = window.screen?.width || window.innerWidth || 0;
  const h = window.screen?.height || window.innerHeight || 0;
  const shortSide = Math.min(w, h);
  return coarse && shortSide > 0 && shortSide < 600;
}

function readOverride(): RMLayout | null {
  // ?layout=phone / ?layout=desktop wins and is remembered — handy for
  // trying the phone layout from a desktop browser.
  try {
    const q = new URLSearchParams(window.location.search).get('layout');
    if (q === 'phone' || q === 'desktop') {
      localStorage.setItem(LAYOUT_KEY, q);
      return q;
    }
  } catch { /* ignore */ }
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === 'phone' || v === 'desktop' ? v : null;
  } catch {
    return null;
  }
}

export function resolveLayout(): RMLayout {
  const o = readOverride();
  if (o) return o;
  return isPhoneDevice() ? 'phone' : 'desktop';
}

/** [layout, setLayout] — setLayout remembers the choice on this device. */
export function useRMLayout(): [RMLayout, (l: RMLayout) => void] {
  const [layout, setLayoutState] = useState<RMLayout>(() => resolveLayout());
  const setLayout = useCallback((l: RMLayout) => {
    try {
      // Picking the device's natural layout clears the override.
      const natural: RMLayout = isPhoneDevice() ? 'phone' : 'desktop';
      if (l === natural) localStorage.removeItem(LAYOUT_KEY);
      else localStorage.setItem(LAYOUT_KEY, l);
    } catch { /* ignore */ }
    setLayoutState(l);
  }, []);
  return [layout, setLayout];
}

/** Dollar value of a price field: a flat code ("FP") or a number ("$120"). */
export function pendingDollarValue(priceStr: string | undefined | null, seasonType: SeasonType): number {
  if (!priceStr) return 0;
  const trimmed = String(priceStr).trim();
  if (!trimmed) return 0;
  if (/^[A-Za-z]+$/.test(trimmed)) {
    const flat = SEASON_CONFIGS[seasonType]?.officeFlats.find(f => f.code === trimmed.toUpperCase());
    return flat ? flat.value : 0;
  }
  const parsed = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

/** "$1,240" / "$1.6k" style money for tight phone headers. */
export function money(n: number, compact = false): string {
  const v = Math.round(n || 0);
  if (compact && Math.abs(v) >= 10000) return `$${(v / 1000).toFixed(0)}k`;
  if (compact && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toLocaleString()}`;
}

/**
 * iOS only lets a page speak after a tap. Call this inside the tap that starts
 * navigation so the voice prompts that follow are allowed to play.
 */
export function primeSpeech(): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch { /* no speech on this device */ }
}

/** Height of the notch / status bar area (env(safe-area-inset-top)) in px. */
export function safeAreaTop(): number {
  try {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top);';
    document.body.appendChild(el);
    const v = parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.remove();
    return v;
  } catch {
    return 0;
  }
}
