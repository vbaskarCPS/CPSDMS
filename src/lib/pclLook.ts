// src/lib/pclLook.ts — how past clients (PCL) look on the maps.
//
// Ontario: the session's own service is blue (lighter when not home). West: aeration and lawn rejuv
// are one lawn list, always lime green (lighter lime when not home); blue is never used there.
// getWorkerPCL sets this when it loads a center's past clients, so every map that draws them agrees.
export const PCL_BLUE = { pcl: '#1d4ed8', pclNotHome: '#93b4f5' } as const;
export const PCL_LIME = { pcl: '#84cc16', pclNotHome: '#c3e88d' } as const;
let west = false;
export function setWestPcl(on: boolean): void { west = on; }
export function isWestPcl(): boolean { return west; }
export function pclLook(): { pcl: string; pclNotHome: string } { return west ? PCL_LIME : PCL_BLUE; }
