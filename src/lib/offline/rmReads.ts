// src/lib/offline/rmReads.ts — the route manager map's reads, through the phone's copy. On a
// manager's day (server-first) they come from the server as before; with no signal the map shows
// the latest copy instead of going blank. Off a field day they're plain pass-throughs.
import { cachedFn } from './cache';
import {
  fetchRouteHouses as _routeHouses, fetchDispositions as _dispositions, fetchRouteMaps as _routeMaps,
  fetchHistoricalForRoutes as _historical, fetchMapAccessList as _accessList,
} from '../mapLogsheetService';
import { getWorkerPCL as _pcl, getOtherServicePCL as _otherPcl } from '../pclCacheService';
import { supabase } from '../supabase';

export const fetchRouteHouses = cachedFn('rm.routeHouses', _routeHouses);
export const fetchDispositions = cachedFn('rm.dispositions', _dispositions);
export const fetchRouteMaps = cachedFn('rm.routeMaps', _routeMaps);
export const fetchHistoricalForRoutes = cachedFn('rm.historical', _historical);
export const fetchMapAccessList = cachedFn('rm.accessList', _accessList);
export const getWorkerPCL = cachedFn('rm.pcl', _pcl);
export const getOtherServicePCL = cachedFn('rm.otherPcl', _otherPcl);

/** The team's last known positions (with no signal: where they were last seen). */
export const fetchTeamLocations = cachedFn('rm.workerLocations', async (workerIds: string[]) => {
  const { data, error } = await supabase.from('worker_locations').select('*').in('worker_id', workerIds);
  if (error) throw error;
  return data || [];
});
