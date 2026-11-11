// src/lib/managerPosition.ts — whose position a device may report on the RM map.
//
// A manager's row in manager_locations is where THEY are: floaters follow it, and the Benny plans drop and pickup
// orders from it. The RM map writes it from the device's GPS while the map is open. The same map can also be opened
// by someone else as that manager (the new app's "Open a manager's map"): that device is somewhere else entirely, so
// it must never write the manager's position, or remove it.
import type { ManagementUser } from '../types';

export function mayReportPosition(u: Pick<ManagementUser, 'role' | 'userId' | 'lookingIn'> | null | undefined): boolean {
  return !!u && u.role === 'RouteManager' && !!u.userId && !u.lookingIn;
}
