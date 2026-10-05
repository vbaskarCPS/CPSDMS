// src/pages/Management/components/rmMapShared.tsx
//
// Small pieces shared by the Route Manager map's desktop layout (RMMapTab) and
// its phone layout (mobile/RMPhoneLayout). Moved here unchanged from RMMapTab
// so both layouts show exactly the same badge and flags.

import React from 'react';
import { Clock } from 'lucide-react';

// --- SIDEBAR "LAST ACTIVE" BADGE ---
// Green dot = a knock or sale in the last 3 minutes. After that an orange
// clock with how long they've been quiet: 3m (3-5 min), then 5-minute steps
// (5m, 10m, ... 55m), then half-hour steps from an hour (1h, 1.5h, 2h ...).
export function activityBadge(lastMs: number | null, nowMs: number): { live: true } | { live: false; label: string } | null {
  if (!lastMs || !isFinite(lastMs)) return null;
  const mins = Math.max(0, (nowMs - lastMs) / 60000);
  if (mins < 3) return { live: true };
  if (mins < 5) return { live: false, label: '3m' };
  if (mins < 60) return { live: false, label: `${Math.floor(mins / 5) * 5}m` };
  const halfHours = Math.floor(mins / 30) / 2;
  return { live: false, label: `${halfHours}h` };
}

export const ActivityBadge: React.FC<{ lastMs: number | null; nowMs: number }> = ({ lastMs, nowMs }) => {
  const b = activityBadge(lastMs, nowMs);
  if (!b) return null;
  const at = lastMs ? new Date(lastMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  if (b.live) {
    return <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 animate-pulse" title={`Active — last knock ${at}`} />;
  }
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-bold text-orange-400 flex-shrink-0" title={`Away — last knock ${at}`}>
      <Clock size={11} /> {b.label}
    </span>
  );
};

/** Latest of several timestamps (ms or ISO text); null if none. */
export function latestMs(...vals: Array<number | string | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const ms = typeof v === 'number' ? v : new Date(v).getTime();
    if (isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}

export function computeRedFlags(financialStore: any[]): { hasFlag: boolean; flags: string[] } {
  const flags: string[] = [];
  const sales = financialStore.filter((tx: any) => tx.type === 'Sale');

  if (sales.length > 0) {
    const first5 = sales.slice(0, 5);
    const after5 = sales.slice(5);

    const first5Filled = first5.reduce((n: number, tx: any) => {
      if (tx.customerPhone?.trim()) n++;
      if (tx.customerEmail?.trim()) n++;
      return n;
    }, 0);
    if (first5Filled / (first5.length * 2) < 0.5) {
      flags.push('contacts_first5');
    }

    if (after5.length > 0) {
      const after5Filled = after5.reduce((n: number, tx: any) => {
        if (tx.customerPhone?.trim()) n++;
        if (tx.customerEmail?.trim()) n++;
        return n;
      }, 0);
      if (after5Filled / (after5.length * 2) < 0.7) {
        flags.push('contacts_after5');
      }
    }
  }

  const completedJobs = financialStore.filter((tx: any) => tx.type === 'Production' || tx.type === 'Sale');
  for (const tx of completedJobs) {
    const st = tx.serviceType;
    const price = typeof tx.price === 'number' ? tx.price : parseFloat(String(tx.price || '0'));
    if (!st || !price) continue;
    if ((st === 'FO' || st === 'BO') && price < 50) { flags.push('pricing'); break; }
    if (st === 'FP' && price < 60) { flags.push('pricing'); break; }
  }

  return { hasFlag: flags.length > 0, flags };
}
