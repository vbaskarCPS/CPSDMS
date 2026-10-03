// src/components/WorkerLocationTracker.tsx
//
// Sends a logged-in worker's position to worker_locations (what the manager
// map reads) from ANYWHERE in the worker app — logsheet, map, sale form, job
// detail — as long as the phone allows location for the app. No Follow Me
// needed, no on-screen badge. Mounted once in App, renders nothing.
//
//   - Who: current_user is a worker (has a contractorId, no manager role).
//     Skipped in training mode and when a manager is viewing a worker's
//     logsheet (rm_view_mode), so a manager's phone never reports as a worker.
//   - When: writes as soon as a first position arrives, then every 2 minutes
//     with the latest position. Re-checked on every screen change, so logging
//     out or switching user stops it straight away.
//   - Permission: if the browser says location is already allowed, tracking
//     starts silently. If it can't tell (older iPhones), it asks once, which
//     the maps already did anyway. If location is blocked, it does nothing.
//
// Phones pause web pages that are in the background or locked, so positions
// only flow while the app is open on screen.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getStorageItem } from '../lib/localStorage';
import { trainingService } from '../lib/trainingService';
import { commandCenterService } from '../lib/commandCenterService';

const UPLOAD_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

interface TrackedWorker { contractorId: string; commandCenterId: string }

/** The logged-in worker to report for, or null when nobody should be tracked. */
function currentTrackedWorker(): TrackedWorker | null {
  try {
    if (trainingService.isTrainingMode()) return null;
    if (getStorageItem<boolean>('rm_view_mode', false)) return null;
    const u = getStorageItem<any>('current_user', null);
    if (!u || !u.contractorId || u.role) return null; // managers carry a role; workers don't
    const cc = u.commandCenterId || commandCenterService.getCurrentCommandCenterId();
    if (!cc) return null;
    return { contractorId: String(u.contractorId), commandCenterId: String(cc) };
  } catch {
    return null;
  }
}

const WorkerLocationTracker: React.FC = () => {
  const location = useLocation();
  const workerRef = useRef<TrackedWorker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const sentFirstRef = useRef(false);

  const upload = async () => {
    const w = workerRef.current;
    const pos = lastPosRef.current;
    if (!w || !pos) return;
    try {
      await supabase.from('worker_locations').upsert(
        {
          worker_id: w.contractorId,
          command_center_id: w.commandCenterId,
          lat: pos.lat,
          lng: pos.lng,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'worker_id' },
      );
    } catch (e) {
      console.warn('[WorkerLocation] upload failed', e);
    }
  };

  const stop = () => {
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null; }
    workerRef.current = null;
    lastPosRef.current = null;
    sentFirstRef.current = false;
  };

  const start = (w: TrackedWorker) => {
    workerRef.current = w;
    if (watchIdRef.current === null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        pos => {
          lastPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (!sentFirstRef.current) { sentFirstRef.current = true; upload(); }
        },
        err => {
          // Blocked → stop quietly; other errors (timeout, no signal) keep trying.
          if (err.code === err.PERMISSION_DENIED) stop();
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
      );
    }
    if (intervalRef.current === null) intervalRef.current = window.setInterval(upload, UPLOAD_INTERVAL_MS);
  };

  // Re-evaluate on every screen change (login, logout, mode switches).
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const w = currentTrackedWorker();
    if (!w) { stop(); return; }
    const same = workerRef.current
      && workerRef.current.contractorId === w.contractorId
      && workerRef.current.commandCenterId === w.commandCenterId;
    if (same && watchIdRef.current !== null) return;
    if (!same) stop();

    let cancelled = false;
    const perms: any = (navigator as any).permissions;
    if (perms?.query) {
      perms.query({ name: 'geolocation' }).then((status: any) => {
        if (cancelled) return;
        const apply = () => {
          const now = currentTrackedWorker();
          if (status.state === 'granted' && now) start(now);
          else if (status.state === 'denied') stop();
        };
        apply();
        try { status.onchange = apply; } catch { /* some browsers don't allow it */ }
      }).catch(() => { if (!cancelled) start(w); });
    } else {
      start(w);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Stop everything if the app itself unmounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), []);

  return null;
};

export default WorkerLocationTracker;
