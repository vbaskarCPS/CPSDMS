// src/lib/offline/basemap.ts — the field maps with no signal. Mapbox's streets need signal; the app's
// own layers (routes, houses and their colours, pins, the team's dots, your position) don't. So when
// the streets can't be fetched, the map switches to a plain background and still draws all of ours.
// (Street names and house numbers are drawn with Mapbox's fonts, which also need signal, so those
// may be missing until it's back.)
import type { Map as MapboxMap, StyleSpecification } from 'mapbox-gl';
import { isNetworkError, isOffline } from './net';

export const NO_SIGNAL_STYLE: StyleSpecification = {
  version: 8, name: 'No signal', sources: {}, glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [{ id: 'no-signal-bg', type: 'background', paint: { 'background-color': '#e9ecef' } }],
};

/** How long the streets get to arrive before the map goes plain. */
export const STREETS_WAIT_MS = 12_000;

const token = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_MAPBOX_TOKEN;

/** The style to open a field map with: the streets, or the plain one when there's no signal (or no real token, as in tests). */
export const fieldMapStyle = (streets: string): string | StyleSpecification =>
  (isOffline() || !token || token === 'pk.test' ? NO_SIGNAL_STYLE : streets);

/** If the streets can't be fetched (or take too long), switch the map to the plain style so it still
 *  loads and the app's layers draw. Does nothing once the map has loaded. */
export function plainMapWithoutSignal(map: MapboxMap): void {
  let done = false;
  const finish = () => { done = true; clearTimeout(timer); map.off('error', onError); };
  const plain = () => {
    if (done) return;
    finish();
    try { map.setStyle(NO_SIGNAL_STYLE); } catch { /* map gone */ }
  };
  const onError = (e: { error?: unknown }) => {
    const err = e?.error as { status?: number } | undefined;
    if (isOffline() || isNetworkError(err) || err?.status === 0) plain();
  };
  const timer = setTimeout(() => { if (!map.isStyleLoaded()) plain(); }, STREETS_WAIT_MS);
  map.on('error', onError);
  map.once('load', finish);
}
