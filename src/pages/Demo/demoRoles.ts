// src/pages/Demo/demoRoles.ts — starting a demo sandbox and signing the visitor in as its manager
// or its worker, the same way the old login does (current_user in local storage, the centre set).
import { supabase } from '../../lib/supabase';
import { commandCenterService } from '../../lib/commandCenterService';
import { sessionService } from '../../lib/sessionService';
import { setStorageItem } from '../../lib/localStorage';
import { trainingService } from '../../lib/trainingService';
import { readDemo, writeDemo, type DemoSandbox, type DemoState } from '../../lib/demoTour';

export async function startDemo(): Promise<DemoState> {
  const { data, error } = await supabase.rpc('app_demo_start');
  if (error) throw new Error(error.message);
  const sb = data as DemoSandbox;
  const state: DemoState = { sandbox: sb, step: 0, role: 'manager', startedAt: Date.now(), done: [] };
  writeDemo(state);
  await becomeManager(sb);
  return state;
}

async function pointAt(sb: DemoSandbox) {
  const cc = await commandCenterService.getCommandCenterById(sb.center_id);
  if (!cc) throw new Error('This demo has ended — start it again');
  commandCenterService.setCurrentCommandCenter(cc);
  commandCenterService.setSuperAdminMode(false);
  trainingService.disableTrainingMode();
}

/** Sign in as Alex, the demo's route manager. */
export async function becomeManager(sb: DemoSandbox): Promise<void> {
  await pointAt(sb);
  const { data, error } = await supabase.from('users').select('user_id, name, username, metadata, command_center_id')
    .eq('user_id', sb.manager).eq('command_center_id', sb.center_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This demo has ended — start it again');
  const meta = (data.metadata || {}) as Record<string, unknown>;
  setStorageItem('current_user', {
    userId: data.user_id, name: data.name, username: data.username, phone: (meta.phone as string) || '',
    role: 'RouteManager', commandCenterId: data.command_center_id,
    floatingFor: Array.isArray(meta.floatingFor) ? meta.floatingFor : [],
    digitalMapping: meta.digitalMapping || undefined,
    digitalMappings: Array.isArray(meta.digitalMappings) ? meta.digitalMappings : (meta.digitalMapping ? [meta.digitalMapping] : []),
  });
  const s = readDemo(); if (s) writeDemo({ ...s, role: 'manager' });
}

/** Sign in as Jordan, the demo's worker, on their cart. */
export async function becomeWorker(sb: DemoSandbox): Promise<void> {
  await pointAt(sb);
  const day = await sessionService.getDailySession();
  const w = day?.workers.find(x => x.contractorId === sb.worker);
  if (!w) throw new Error('This demo has ended — start it again');
  setStorageItem('current_user', w);
  await sessionService.startLogsheetSession(w.contractorId);
  const s = readDemo(); if (s) writeDemo({ ...s, role: 'worker' });
}
