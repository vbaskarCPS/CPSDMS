// src/v2/features/bookings/useMbHouses.ts — the route level's houses, drawn the way the RM map draws
// them zoomed in: each house as its building (or a house tile facing its street when it has none),
// in its colour, with its number on it. A customer on file also gets their name, big, over the house,
// and under the name a leaf (aeration customer) and/or a black drop (sealing customer).
//
// Colours follow the RM map: knocks (no, go back, invalid, not home), this season's job (purple),
// the season's past clients (blue), the other service's past clients (lime / sky), never knocked
// (black outline). Tapping a house (or its name) calls onPick with its house key.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl';
import { buildHouseTiles, houseMapNumber, routeHouseId, tileCentre, type RouteHouse, type SavedRouteMap } from '../../../lib/mapLogsheetService';
import {
  addBuildingLayers, addSliceLayers, applyBuildingStyles, buildingMatchSig, emptyBuildingMatch, matchHousesToBuildings,
  removeSliceLayers, setSliceData, type BuildingMatch, type BuildingStyle, type GapHouse,
} from '../../../lib/mapBuildings';

export const MB_HOUSE_ZOOM = 14.5;
const P = 'mbh';
const SRC_FP = `${P}-fp-src`, SRC_PT = `${P}-pt-src`, SRC_HIT = `${P}-hit-src`, SRC_NAME = `${P}-name-src`;
const L_FILL = `${P}-fp-fill`, L_LINE = `${P}-fp-line`, L_NUM = `${P}-num`, L_HIT = `${P}-hit`, L_NAME = `${P}-name`;
const OWN = [L_NAME, L_HIT, L_NUM, L_LINE, L_FILL];

export interface MbHouse {
  house: RouteHouse;
  color: string;
  /** knocked this round or done this season: drawn strong; otherwise faint */
  strong: boolean;
  /** a customer on file: their name over the house */
  name: string | null;
  leaf: boolean;
  drop: boolean;
}

/** A leaf (aeration) and a black drop (sealing), drawn once at 2× for the name labels. */
function iconImage(kinds: ('leaf' | 'drop')[]): ImageData | null {
  const s = 44, gap = 8, w = kinds.length * s + (kinds.length - 1) * gap;
  const c = document.createElement('canvas'); c.width = w; c.height = s;
  const g = c.getContext('2d'); if (!g) return null;
  kinds.forEach((k, i) => {
    const x = i * (s + gap);
    g.save(); g.translate(x + s / 2, s / 2);
    g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#ffffff';
    if (k === 'leaf') {
      g.rotate(-Math.PI / 4);
      g.beginPath(); g.moveTo(0, -18); g.bezierCurveTo(14, -10, 14, 10, 0, 18); g.bezierCurveTo(-14, 10, -14, -10, 0, -18); g.closePath();
      g.stroke(); g.fillStyle = '#16a34a'; g.fill();
      g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 16); g.lineWidth = 2; g.strokeStyle = '#dcfce7'; g.stroke();
    } else {
      g.beginPath(); g.moveTo(0, -19); g.bezierCurveTo(6, -9, 14, -1, 14, 7); g.arc(0, 7, 14, 0, Math.PI, false); g.bezierCurveTo(-14, -1, -6, -9, 0, -19); g.closePath();
      g.stroke(); g.fillStyle = '#111111'; g.fill();
      g.beginPath(); g.arc(-5, 8, 3.5, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
    }
    g.restore();
  });
  return g.getImageData(0, 0, w, s);
}
export const iconName = (leaf: boolean, drop: boolean) => (leaf && drop ? 'mb-ic-as' : leaf ? 'mb-ic-a' : drop ? 'mb-ic-s' : null);

export function useMbHouses({ map, ready, items, routeMaps, onPick }: {
  map: MapboxMap | null; ready: boolean; items: MbHouse[]; routeMaps: SavedRouteMap[]; onPick: (houseKey: string) => void;
}): void {
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const houses = useMemo(() => items.map(i => i.house), [items]);
  const houseSig = useMemo(() => houses.map(h => `${routeHouseId(h.routeCode, h.houseKey)}@${h.lat.toFixed(6)},${h.lng.toFixed(6)}`).join(','), [houses]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => buildHouseTiles(houses, routeMaps), [houseSig, routeMaps]);

  // houses on Mapbox's own buildings (matched near the view, as the RM map does)
  const matchRef = useRef<BuildingMatch>(emptyBuildingMatch());
  const [matchVer, setMatchVer] = useState(0);
  const ptsRef = useRef<GapHouse[]>([]);
  ptsRef.current = useMemo(() => houses.map(h => ({ id: routeHouseId(h.routeCode, h.houseKey), key: h.houseKey, lng: h.lng, lat: h.lat, street: h.streetNorm, civic: h.civicNo, suffix: h.civicSuffix, unit: h.unit })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseSig]);
  const rematch = useRef<() => void>(() => {});
  rematch.current = () => {
    if (!map || map.getZoom() < MB_HOUSE_ZOOM || !ptsRef.current.length) return;
    const b = map.getBounds(); if (!b) return;
    const px = (b.getEast() - b.getWest()) * 0.25, py = (b.getNorth() - b.getSouth()) * 0.25;
    const near = ptsRef.current.filter(h => h.lng >= b.getWest() - px && h.lng <= b.getEast() + px && h.lat >= b.getSouth() - py && h.lat <= b.getNorth() + py);
    if (!near.length) return;
    const m = matchHousesToBuildings(map, near, 'off');
    const prev = matchRef.current, known = new Set(ptsRef.current.map(h => h.id)), slices = m.houseToSlice!;
    prev.houseToBuilding.forEach((bid, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(bid) && known.has(hid)) { m.houseToBuilding.set(hid, bid); m.buildingToHouse.set(bid, hid); }
    });
    prev.houseToSlice?.forEach((sl, hid) => {
      if (!m.houseToBuilding.has(hid) && !slices.has(hid) && !m.buildingToHouse.has(sl.bid) && known.has(hid)) slices.set(hid, sl);
    });
    if (buildingMatchSig(m) !== buildingMatchSig(prev)) { matchRef.current = m; setMatchVer(v => v + 1); }
  };
  const styledRef = useRef<Set<number>>(new Set());

  // layers, icons and clicks (once)
  useEffect(() => {
    if (!map || !ready) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const before = map.getLayer('mb-sel') ? 'mb-sel' : undefined;
    for (const [n, kinds] of [['mb-ic-a', ['leaf']], ['mb-ic-s', ['drop']], ['mb-ic-as', ['leaf', 'drop']]] as const) {
      if (!map.hasImage(n)) { const img = iconImage([...kinds]); if (img) map.addImage(n, img, { pixelRatio: 2 }); }
    }
    for (const id of [SRC_FP, SRC_PT, SRC_HIT, SRC_NAME]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
    const bld = addBuildingLayers(map, P, before);
    const sl = addSliceLayers(map, P, before);
    [bld.fill, bld.line, sl.fill, sl.line].forEach(id => { try { if (map.getLayer(id)) map.setLayerZoomRange(id, MB_HOUSE_ZOOM, 24); } catch { /* */ } });
    if (!map.getLayer(L_FILL)) map.addLayer({ id: L_FILL, type: 'fill', source: SRC_FP, minzoom: MB_HOUSE_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } }, before);
    if (!map.getLayer(L_LINE)) map.addLayer({ id: L_LINE, type: 'line', source: SRC_FP, minzoom: MB_HOUSE_ZOOM, filter: ['!=', ['get', 'b'], 1], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'lineOpacity'], 'line-width': 1.2 } }, before);
    // an invisible dot on every house, so any house (on a building or a tile) can be tapped
    if (!map.getLayer(L_HIT)) map.addLayer({ id: L_HIT, type: 'circle', source: SRC_HIT, minzoom: MB_HOUSE_ZOOM, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], MB_HOUSE_ZOOM, 6, 18, 14], 'circle-color': '#000000', 'circle-opacity': 0.01 } }, before);
    if (!map.getLayer(L_NUM)) map.addLayer({ id: L_NUM, type: 'symbol', source: SRC_PT, minzoom: MB_HOUSE_ZOOM, layout: {
      'text-field': ['get', 'num'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], MB_HOUSE_ZOOM, 10, 17, 14, 19, 18], 'text-padding': 1, 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'sort'] },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 } }, before);
    if (!map.getLayer(L_NAME)) map.addLayer({ id: L_NAME, type: 'symbol', source: SRC_NAME, minzoom: MB_HOUSE_ZOOM, layout: {
      'text-field': ['get', 'name'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], MB_HOUSE_ZOOM, 13, 17, 18, 19, 23],
      'text-anchor': 'bottom', 'text-offset': ['case', ['has', 'icon'], ['literal', [0, -2.2]], ['literal', [0, -0.9]]], 'text-max-width': 9,
      'icon-image': ['coalesce', ['get', 'icon'], ''], 'icon-anchor': 'bottom', 'icon-offset': [0, -10], 'icon-size': ['interpolate', ['linear'], ['zoom'], MB_HOUSE_ZOOM, 0.75, 18, 1.1],
      'text-allow-overlap': false, 'icon-allow-overlap': false, 'symbol-sort-key': 0 },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 } });

    const click = (e: { features?: { properties?: Record<string, unknown> | null }[] }) => { const k = e.features?.[0]?.properties?.k; if (k) pickRef.current(String(k)); };
    const on = () => { map.getCanvas().style.cursor = 'pointer'; };
    const off = () => { map.getCanvas().style.cursor = ''; };
    for (const l of [L_HIT, L_NAME]) { map.on('click', l, click); map.on('mouseenter', l, on); map.on('mouseleave', l, off); }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; rematch.current(); }, 300); };
    const onSourceData = (e: { sourceId?: string; tile?: unknown }) => { if (e.sourceId === 'composite' && e.tile) queue(); };
    map.on('moveend', queue); map.on('sourcedata', onSourceData);
    queue();
    return () => {
      for (const l of [L_HIT, L_NAME]) { map.off('click', l, click); map.off('mouseenter', l, on); map.off('mouseleave', l, off); }
      map.off('moveend', queue); map.off('sourcedata', onSourceData);
      if (timer) clearTimeout(timer);
      try { styledRef.current = applyBuildingStyles(map, new Map(), styledRef.current); } catch { /* gone */ }
      try {
        OWN.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        [`${P}-bld-line`, `${P}-bld-fill`].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        removeSliceLayers(map, P);
        [SRC_FP, SRC_PT, SRC_HIT, SRC_NAME].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      } catch { /* map gone */ }
    };
  }, [map, ready]);

  // data
  useEffect(() => {
    if (!map || !ready) return;
    const fp: GeoJSON.Feature[] = [], pt: GeoJSON.Feature[] = [], hit: GeoJSON.Feature[] = [], names: GeoJSON.Feature[] = [];
    const styles = new Map<number, BuildingStyle>(), byHouse = new Map<string, BuildingStyle>();
    const match = matchRef.current;
    for (const it of items) {
      const h = it.house, id = routeHouseId(h.routeCode, h.houseKey);
      const tile = tiles.get(id);
      const onBuilding = match.houseToBuilding.has(id) || !!match.houseToSlice?.has(id);
      const at: [number, number] = tile && !onBuilding ? tileCentre(tile) : [h.lng, h.lat];
      if (tile) fp.push({ type: 'Feature', properties: { id, color: it.color, fillOpacity: it.strong ? 0.45 : 0.10, lineOpacity: it.strong ? 0.9 : 0.35, b: onBuilding ? 1 : 0 }, geometry: tile });
      pt.push({ type: 'Feature', properties: { k: h.houseKey, color: it.color, num: houseMapNumber(h), sort: it.strong || it.name ? 0 : 1 }, geometry: { type: 'Point', coordinates: at } });
      hit.push({ type: 'Feature', properties: { k: h.houseKey }, geometry: { type: 'Point', coordinates: at } });
      if (it.name) {
        const icon = iconName(it.leaf, it.drop);
        names.push({ type: 'Feature', properties: { k: h.houseKey, name: it.name, color: it.color, ...(icon ? { icon } : {}) }, geometry: { type: 'Point', coordinates: at } });
      }
      const st: BuildingStyle = { color: it.color, fill: it.strong ? 0.55 : 0.18, line: it.strong ? 0.95 : 0.6, width: it.strong ? 1.6 : 1 };
      byHouse.set(id, st);
      const bid = match.houseToBuilding.get(id);
      if (bid != null && !(styles.has(bid) && Number(styles.get(bid)!.fill) >= Number(st.fill))) styles.set(bid, st);
    }
    const set = (src: string, f: GeoJSON.Feature[]) => (map.getSource(src) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: f });
    set(SRC_FP, fp); set(SRC_PT, pt); set(SRC_HIT, hit); set(SRC_NAME, names);
    styledRef.current = applyBuildingStyles(map, styles, styledRef.current);
    setSliceData(map, P, match, id => byHouse.get(id) || null);
  }, [map, ready, items, tiles, matchVer]);

  // houses moved → forget old building matches
  useEffect(() => {
    matchRef.current = emptyBuildingMatch(); setMatchVer(v => v + 1);
    if (map && ready) rematch.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseSig, map, ready]);
}
