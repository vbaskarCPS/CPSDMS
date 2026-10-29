// src/v2/features/bookings/MasterBookings.tsx — Master Bookings, in three levels.
//
//   Level 1  the center's master maps: outlines on the map, a card per map in the sidebar (routes,
//            bookings, past customers per service, each round's days and % of routes done).
//            Pick one or more, then Open.
//   Level 2  the picked maps, RM-map style, with one filter panel (customers by service, knocks,
//            bookings) and heat map mode: route colours off, route outlines on, every street
//            coloured by how much of it was knocked this round. Tap a route for level 3.
//   Level 3  one route: every house coloured by its knock this round; tap a house for its whole
//            knock history and its customer page.
//
// The season and round picker sits at the top of every level; everything follows it. "Current"
// shows each map's own current round. Settings (gear): default season and round, and how much of
// a route has to be knocked for it to count as done.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Map as MbMap, MapboxGeoJSONFeature } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AlertTriangle, ArrowLeft, BadgeCheck, Check, ChevronRight, Flame, Layers, List, Play, Settings, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { routeShapes, type RouteShape } from '../../lib/territory';
import {
  areaView, CLIENT_LAYERS, clientLayerOf, daysLabel, getSettings, heatColor, house as loadHouse, KNOCKS, knockOf, NEVER, NO_DOORS,
  outlines as loadOutlines, overview as loadOverview, parseRound, parseSeason, pctOf, roundName, routeView, seasonKey, seasonLabel,
  cachedFilters, DEFAULT_FILTERS, houseLook, loadFilters, saveFilters, serviceMarks, type MbFilters, shortDay, shortName, shownRound, startingSeason, startRound, type AreaView, type ClientLayer, type HouseRow, type MapCard, type RoundPick,
  type RouteView, type Season, type StreetHeat, prevCounts, serviceLabel, type Service,
} from '../../lib/masterBookings';
import { fmtDay, VISIT } from '../../lib/customers';
import { Btn, ErrorBox, Loading, Modal, Tag, Toggle } from '../../ui';
import { coordsOf, createMap, EMPTY, fc, fit, hull, middle, removeMap, routeArea, setData } from './mbMap';
import { MbSettingsModal } from './MbSettings';
import { MB_HOUSE_ZOOM, useMbHouses, type MbHouse } from './useMbHouses';
import { CustomerModal } from '../clients/Customer';
import type { SavedRouteMap } from '../../../lib/mapLogsheetService';
import { areaBookings, areaCounts, attemptLine, bookingColor, BOOKING_COLORS, lastAttempt, listFor, listLists, routeBookings, STATE_LABEL,
  type Booking, type BookingDot, type BookingList } from '../../lib/bookings';
import { BookingModal } from './BookingsPage';

type BkKey = 'open' | 'tried' | 'done' | 'cancelled';
const BK_KEYS: { key: BkKey; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'tried', label: 'Tried (next time)' }, { key: 'done', label: 'Done' }, { key: 'cancelled', label: 'Cancelled' },
];
const bkKeyOf = (d: { status: string; tried?: boolean }): BkKey => (d.status === 'done' ? 'done' : d.status === 'cancelled' ? 'cancelled' : d.tried ? 'tried' : 'open');

const splitMaps = (v: string | null) => (v ? v.split('|').map(s => s.trim()).filter(Boolean) : []);

export const MasterBookings: React.FC = () => {
  const { center, can, profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = can('bookings');
  const year = new Date().getFullYear();

  // ── the picker ──
  const settings = useLoad(() => (allowed && center ? getSettings(center.id) : Promise.resolve(null)), [allowed, center?.id]);
  const season: Season = startingSeason(parseSeason(params.get('s')), settings.data, center?.services, year);
  const round: RoundPick = params.has('r') ? parseRound(params.get('r')) : (settings.data?.round ?? 'current');
  const maps = splitMaps(params.get('maps'));
  const route = params.get('route');
  const level: 1 | 2 | 3 = route ? 3 : maps.length ? 2 : 1;
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v === null) p.delete(k); else p.set(k, v); }
    setParams(p);
  };
  const setSeason = (s: Season) => go({ s: seasonKey(s), r: 'current' });
  const setRound = (r: RoundPick) => go({ r: r === 'current' ? 'current' : String(r) });

  const ready = allowed && !!center && !settings.loading;
  const ov = useLoad(() => (ready ? loadOverview(center!.id, season, round) : Promise.resolve(null)),
    [ready, center?.id, seasonKey(season), String(round)]);
  const outl = useLoad(() => (ready ? loadOutlines(center!.id) : Promise.resolve({} as Record<string, GeoJSON.Geometry>)), [ready, center?.id]);
  const mapsKey = maps.join('|');
  const av = useLoad(() => (ready && maps.length ? areaView(maps, season, round) : Promise.resolve(null)),
    [ready, mapsKey, seasonKey(season), String(round)]);
  const shapes = useLoad(() => (maps.length ? routeShapes(maps) : Promise.resolve([] as RouteShape[])), [mapsKey]);
  const rv = useLoad(() => (ready && route ? routeView(route, season, round) : Promise.resolve(null)), [ready, route, seasonKey(season), String(round)]);
  // the season's booking list (Master Bookings › Bookings): counts per map, dots, a route's bookings
  const lists = useLoad(() => (ready ? listLists(center!.id).catch(() => [] as BookingList[]) : Promise.resolve([] as BookingList[])), [ready, center?.id]);
  const seasonList = listFor(lists.data || [], season.service, season.season);
  const bkc = useLoad(() => (ready ? areaCounts(center!.id, season.service, season.season).catch(() => ({})) : Promise.resolve({})), [ready, center?.id, seasonKey(season)]);
  const bkd = useLoad(() => (ready && maps.length ? areaBookings(center!.id, maps, season.service, season.season).catch(() => [] as BookingDot[]) : Promise.resolve([] as BookingDot[])),
    [ready, mapsKey, seasonKey(season)]);
  const rbk = useLoad(() => (ready && route ? routeBookings(center!.id, route, season.service, season.season).catch(() => [] as Booking[]) : Promise.resolve([] as Booking[])),
    [ready, route, seasonKey(season)]);
  const [bkOn, setBkOn] = useState<Set<BkKey>>(new Set(BK_KEYS.map(k => k.key)));
  const [openBooking, setOpenBooking] = useState<string | null>(null);
  const lastBookingTap = useRef(0);

  // ── level 1 selection ──
  const [picked, setPicked] = useState<Set<string>>(new Set(maps));
  useEffect(() => { if (level === 1 && maps.length === 0) return; setPicked(new Set(maps)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsKey]);
  const flipPick = (a: string) => setPicked(s => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  const openPicked = () => { const list = (ov.data?.maps || []).map(m => m.area).filter(a => picked.has(a)); if (list.length) go({ maps: list.join('|'), route: null }); };

  // ── filters ──
  // filters: remembered for each person (this device's copy at once, then their account's copy)
  const start = useMemo(() => cachedFilters(profile?.id) || DEFAULT_FILTERS, [profile?.id]);
  const [heat, setHeat] = useState(start.heat);
  const [knockOn, setKnockOn] = useState<Set<string>>(new Set(start.knocks));
  const [clientOn, setClientOn] = useState<Set<ClientLayer>>(new Set(start.clients));
  const [bookingOn, setBookingOn] = useState<Set<string>>(new Set(start.bookings));
  // every customer layer on to start: aeration and sealing customers both show (leaf / drop on the route level)
  const [filtersOpen, setFiltersOpen] = useState(() => start.open ?? (typeof window !== 'undefined' && window.innerWidth > 860));
  const filtersReady = useRef(false);
  useEffect(() => {
    if (!profile?.id) return;
    let live = true;
    loadFilters(profile.id).then(f => {
      if (!live) return;
      if (f) { setHeat(f.heat); setKnockOn(new Set(f.knocks)); setClientOn(new Set(f.clients)); setBookingOn(new Set(f.bookings)); if (f.open !== null) setFiltersOpen(f.open); }
      filtersReady.current = true;
    }).catch(() => { filtersReady.current = true; });
    return () => { live = false; };
  }, [profile?.id]);
  useEffect(() => {
    if (!profile?.id || !filtersReady.current) return;
    const f: MbFilters = { heat, knocks: [...knockOn], clients: [...clientOn], bookings: [...bookingOn] as MbFilters['bookings'], open: filtersOpen, layers: CLIENT_LAYERS.map(l => l.key) };
    const t = setTimeout(() => { saveFilters(profile.id, f).catch(() => { /* kept on this device */ }); }, 700);
    return () => clearTimeout(t);
  }, [profile?.id, heat, knockOn, clientOn, bookingOn, filtersOpen]);
  const [selHouse, setSelHouse] = useState<HouseRow | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  useEffect(() => { setSelHouse(null); }, [route, mapsKey]);
  const [starting, setStarting] = useState<MapCard | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MbMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const clickRef = useRef<{ outline: (a: string) => void; route: (c: string) => void; booking: (id: string) => void }>({ outline: () => {}, route: () => {}, booking: () => {} });
  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = createMap(box.current, m => {
      const on = (layer: string, fn: (f: MapboxGeoJSONFeature) => void) => {
        m.on('click', layer, e => { const f = e.features?.[0]; if (f) fn(f); });
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
      };
      on('mb-outline-fill', f => clickRef.current.outline(String(f.properties?.area)));
      // a booking dot opens the booking (and not the route under it)
      on('mb-bookings', f => { if (f.properties?.id) { lastBookingTap.current = Date.now(); clickRef.current.booking(String(f.properties.id)); } });
      for (const l of ['mb-area-fill', 'mb-routes', 'mb-heat', 'mb-nums']) on(l, f => {
        if (Date.now() - lastBookingTap.current < 400) return;
        if (f.properties?.code) clickRef.current.route(String(f.properties.code));
      });
      // the route under the pointer lights up: tap anywhere in it to open it
      let hover: string | null = null;
      const light = (code: string | null) => {
        if (hover === code) return;
        if (hover) m.setFeatureState({ source: 'mb-area', id: hover }, { hover: false });
        hover = code;
        if (code) m.setFeatureState({ source: 'mb-area', id: code }, { hover: true });
      };
      m.on('mousemove', 'mb-area-fill', e => light(e.features?.[0]?.properties?.code ? String(e.features[0].properties.code) : null));
      m.on('mouseleave', 'mb-area-fill', () => light(null));
      setMapReady(true);
    }, setFailed);
    return () => { removeMap(map.current); map.current = null; setMapReady(false); };
  }, []);

  const clientsShown = useMemo(() => (av.data?.clients || []).map((c, i) => ({ c, i, layer: clientLayerOf(c.flags, clientOn, season.service) })).filter(x => x.layer),
    [av.data, clientOn, season.service]);
  clickRef.current = {
    outline: a => { if (level === 1) flipPick(a); },
    route: c => { if (level === 2) go({ route: c }); },
    booking: id => setOpenBooking(id),
  };

  // bookings on the map (levels 2 and 3), as the filters say
  useEffect(() => {
    const m = map.current; if (!m || !mapReady) return;
    if (level === 1) { setData(m, 'mb-bookings', EMPTY); return; }
    const list = (bkd.data || []).filter(d => bkOn.has(bkKeyOf(d)) && (level === 2 || (d.route || '').toUpperCase() === (route || '').toUpperCase()));
    setData(m, 'mb-bookings', fc(list.map(d => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] }, properties: { id: d.id, color: bookingColor(d) } }))));
  }, [mapReady, level, bkd.data, bkOn, route]);

  // level 1: outlines
  useEffect(() => {
    const m = map.current; if (!m || !mapReady) return;
    if (level !== 1) { setData(m, 'mb-outline', EMPTY); setData(m, 'mb-outline-labels', EMPTY); return; }
    const cards = new Map((ov.data?.maps || []).map(c => [c.area, c]));
    const shown = Object.entries(outl.data || {}).filter(([a]) => cards.has(a));
    setData(m, 'mb-outline', fc(shown.map(([area, g]) => ({ type: 'Feature', geometry: g, properties: { area, sel: picked.has(area) ? 1 : 0 } }))));
    setData(m, 'mb-outline-labels', fc(shown.flatMap(([area, g]) => {
      const c = middle(coordsOf(g)); return c ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: { label: area } }] : [];
    })));
  }, [mapReady, level, outl.data, ov.data, picked]);
  useEffect(() => {
    if (level !== 1 || !mapReady || !outl.data) return;
    fit(map.current, Object.values(outl.data).flatMap(g => coordsOf(g)), 14);
  }, [mapReady, level, outl.data]);

  // level 2 and 3: routes / outlines / heat / numbers
  const routeStats = useMemo(() => new Map((av.data?.routes || []).map(r => [r.code, r])), [av.data]);
  useEffect(() => {
    const m = map.current; if (!m || !mapReady) return;
    if (level === 1) { (['mb-routes', 'mb-hull', 'mb-heat', 'mb-nums', 'mb-area'] as const).forEach(id => setData(m, id, EMPTY)); return; }
    const list = level === 3 ? (shapes.data || []).filter(s => s.code === route) : (shapes.data || []);
    const own = level === 3 && !list.length && rv.data?.line ? [{ code: route!, number: 0, color: '#6b7280', lines: rv.data.line.map(s => s.coordinates).filter(c => c?.length > 1) }] : [];
    const drawn = [...list, ...own];
    setData(m, 'mb-routes', heat ? EMPTY : fc(drawn.flatMap(s => s.lines.map(l => ({ type: 'Feature' as const, properties: { code: s.code, color: s.color || '#6b7280' }, geometry: { type: 'LineString' as const, coordinates: l } })))));
    setData(m, 'mb-hull', !heat ? EMPTY : fc(drawn.flatMap(s => {
      const h = hull(s.lines.flat()); if (h.length < 3) return [];
      return [{ type: 'Feature' as const, properties: { code: s.code }, geometry: { type: 'LineString' as const, coordinates: [...h, h[0]] } }];
    })));
    setData(m, 'mb-area', level !== 2 ? EMPTY : fc(drawn.flatMap(s => {
      const ring = routeArea(s.lines); if (!ring) return [];
      return [{ type: 'Feature' as const, properties: { code: s.code }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }];
    })));
    const streets: StreetHeat[] = level === 3 ? (rv.data?.streets || []) : (av.data?.streets || []);
    setData(m, 'mb-heat', !heat ? EMPTY : fc(streets.filter(s => s.line).map(s => ({
      type: 'Feature', geometry: s.line!, properties: { code: s.route, color: s.doors > 0 ? heatColor(pctOf(s.knocked, s.doors)) : NO_DOORS },
    }))));
    setData(m, 'mb-nums', fc(drawn.flatMap(s => {
      const c = middle(s.lines.flat()); if (!c) return [];
      const st = routeStats.get(s.code);
      return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: {
        code: s.code, num: s.number ? String(s.number) : s.code, size: level === 3 ? 20 : 24,
        color: heat ? (st && st.doors ? heatColor(st.pct) : '#334155') : (s.color || '#334155') } }];
    })));
  }, [mapReady, level, heat, shapes.data, av.data, rv.data, route, routeStats]);

  // level 2: customers and knocks
  useEffect(() => {
    const m = map.current; if (!m || !mapReady) return;
    if (level !== 2) { setData(m, 'mb-clients', EMPTY); setData(m, 'mb-knocks', EMPTY); return; }
    setData(m, 'mb-clients', fc(clientsShown.map(({ c, i, layer }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: { i, color: CLIENT_LAYERS.find(l => l.key === layer)!.color } }))));
    setData(m, 'mb-knocks', heat ? EMPTY : fc((av.data?.knocks || []).filter(k => knockOn.has(k.status)).map(k => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [k.lng, k.lat] },
      properties: { color: knockOf(k.status)?.color || '#111827', fast: k.fast ? 1 : 0 } }))));
  }, [mapReady, level, clientsShown, av.data, heat, knockOn]);
  useEffect(() => {
    if (level !== 2 || !mapReady) return;
    const pts = [...(shapes.data || []).flatMap(s => s.lines.flat()), ...(shapes.data?.length ? [] : maps.flatMap(a => coordsOf(outl.data?.[a])))];
    fit(map.current, pts, 15.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, level, mapsKey, shapes.data]);

  // level 3: houses, drawn as the RM map draws them zoomed in; customers' names over their houses
  const routeMaps = useMemo<SavedRouteMap[]>(() => {
    if (level !== 3) return [];
    const list = (shapes.data || []).filter(s => s.code === route);
    const lines = list.length ? list.flatMap(s => s.lines) : (rv.data?.line || []).map(s => s.coordinates).filter(c => c?.length > 1);
    return [{ id: route || '', route_code: route || '', route_color: list[0]?.color || '#6b7280', route_number: list[0]?.number || 0,
      segments: lines.map((coordinates, i) => ({ osmId: i, name: '', coordinates })) }];
  }, [level, shapes.data, rv.data, route]);
  // knock filters only take a knock's colour off a house: the house, its customer and PCL colours stay
  const houseItems = useMemo<MbHouse[]>(() => level !== 3 ? [] : (rv.data?.houses || []).map(h => {
    const look = houseLook(h.st && knockOn.has(h.st) ? h.st : null, h.f, clientOn, season.service);
    const marks = serviceMarks(h.f);
    const civic = h.no ?? (Number(String(h.k).match(/^\d+/)?.[0]) || 0);
    const shown = !!h.c && (h.f === 0 ? clientOn.size > 0 : !!clientLayerOf(h.f, clientOn, season.service));
    return {
      house: { routeCode: rv.data!.route, houseKey: h.k, civicNo: civic, civicSuffix: h.sx ?? null, streetName: h.s, streetNorm: h.s, unitCount: 1,
        lat: h.lat, lng: h.lng, footprint: null, source: 'nar', geoSource: null, geoTriedAt: null, unit: h.u ?? null },
      color: look.color, strong: look.strong, name: shown ? (shortName(h.n) || 'Customer') : null, leaf: shown && marks.leaf, drop: shown && marks.drop,
    };
  }), [level, rv.data, knockOn, clientOn, season.service]);
  useMbHouses({ map: map.current, ready: mapReady, items: houseItems, routeMaps, onPick: k => {
    const h = rv.data?.houses.find(x => x.k === k); if (!h) return;
    if (h.c) setCustomerId(h.c); else setSelHouse(h);
  } });
  useEffect(() => {
    const m = map.current; if (!m || !mapReady) return;
    setData(m, 'mb-sel', level === 3 && selHouse ? fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [selHouse.lng, selHouse.lat] }, properties: {} }]) : EMPTY);
  }, [mapReady, level, selHouse]);
  useEffect(() => {
    if (level !== 3 || !mapReady || !rv.data) return;
    fit(map.current, rv.data.houses.map(h => [h.lng, h.lat] as [number, number]), 17.5);
    const m = map.current;
    if (m && m.getZoom() < MB_HOUSE_ZOOM + 0.5) m.jumpTo({ zoom: MB_HOUSE_ZOOM + 0.5 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, level, route, !!rv.data]);

  if (!allowed) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to Master Bookings.</div></div>;
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card v2-mut">Pick a center in the top bar to see its master maps.</div></div>;

  const cards = ov.data?.maps || [];
  const seasons = (() => {
    const list = [...(ov.data?.seasons || [])];
    if (!list.some(s => seasonKey(s) === seasonKey(season))) list.push(season);
    return list.sort((a, b) => b.season - a.season || a.service.localeCompare(b.service));
  })();
  const maxRound = Math.max(1, ...cards.flatMap(c => c.rounds.map(r => r.no)));
  const busy = ov.loading || (level >= 2 && av.loading) || (level === 3 && rv.loading);

  return (
    <div className="v2-crm v2-mb">
      <aside className="v2-crm-side">
        <div className="v2-crm-top">
          <div className="v2-row" style={{ gap: 8 }}>
            <span className="v2-h1" style={{ fontSize: 20 }}>Master Bookings</span>
            <span className="v2-spacer" />
            <button type="button" className="v2-gbtn" style={{ width: 34, height: 34 }} onClick={() => setShowSettings(true)} aria-label="Master Bookings settings" title="Settings"><Settings size={17} /></button>
          </div>
          <div className="v2-mb-picker" role="group" aria-label="Season and round">
            <select className="v2-input" value={seasonKey(season)} onChange={e => { const s = parseSeason(e.target.value); if (s) setSeason(s); }} aria-label="Season">
              {seasons.map(s => { const l = listFor(lists.data || [], s.service, s.season); return <option key={seasonKey(s)} value={seasonKey(s)}>{l ? `${l.name} ${l.year}` : seasonLabel(s)}</option>; })}
            </select>
            <select className="v2-input" value={String(round)} onChange={e => setRound(parseRound(e.target.value))} aria-label="Round">
              <option value="current">Current</option>
              {Array.from({ length: Math.max(maxRound, typeof round === 'number' ? round : 1) }, (_, i) => i + 1).map(n => <option key={n} value={n}>Round {n}</option>)}
            </select>
          </div>
          {/* the season's booking list and the plans, one tap away */}
          <div className="v2-mb-links">
            <Link to="/app/bookings/list" className="v2-mb-listlink">
              <List size={15} />
              {seasonList
                ? <span><b>{seasonList.name} {seasonList.year}</b> · {seasonList.total} bookings · {seasonList.done} done{seasonList.waiting ? ` · ${seasonList.waiting} waiting on a map` : ''}</span>
                : <span><b>Booking lists</b></span>}
              <ChevronRight size={15} />
            </Link>
            <Link to="/app/bookings/plans" className="v2-mb-listlink sm"><BadgeCheck size={15} /><span>Plans</span><ChevronRight size={15} /></Link>
          </div>
          <Crumbs level={level} maps={maps} route={route} onMaps={() => go({ maps: null, route: null })} onRoute={() => go({ route: null })} />
          <ErrorBox error={settings.error || ov.error || av.error || rv.error || shapes.error} />
        </div>

        <div className="v2-crm-stats">
          {level === 1 && <Level1 cards={cards} bk={bkc.data || {}} loading={ov.loading && !ov.data} picked={picked} onPick={flipPick} onOpen={openPicked}
            onAll={() => setPicked(new Set(picked.size === cards.length ? [] : cards.map(c => c.area)))} centerName={center.display_name} service={season.service} />}
          {level === 2 && <Level2 cards={cards.filter(c => maps.includes(c.area))} view={av.data} loading={av.loading && !av.data} season={season} year={year}
            onRoute={c => go({ route: c })} onStart={setStarting} />}
          {level === 3 && <Level3 view={rv.data} loading={rv.loading && !rv.data} sel={selHouse} onClose={() => setSelHouse(null)} season={season}
            onCustomer={setCustomerId} bookings={rbk.data || []} onBooking={setOpenBooking} />}
        </div>
      </aside>

      <section className="v2-crm-map">
        <div ref={box} className="v2-crm-canvas" data-testid="mb-map" />
        {failed && <div className="v2-crm-over v2-island v2-err">{failed}</div>}
        {busy && <div className="v2-crm-over v2-island v2-mut v2-small">Loading…</div>}
        {level >= 2 && (
          <div className={`v2-mb-filters v2-island${filtersOpen ? ' open' : ''}`}>
            <button type="button" className="v2-mb-fhead" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}>
              <Layers size={15} /><b>Filters</b>{heat && <Tag tone="a">Heat map</Tag>}<span className="v2-spacer" /><ChevronRight size={15} className="chev" />
            </button>
            {filtersOpen && <Filters level={level} season={season} heat={heat} setHeat={setHeat} knockOn={knockOn} setKnockOn={setKnockOn}
              clientOn={clientOn} setClientOn={setClientOn} bkOn={bkOn} setBkOn={setBkOn} hasList={!!seasonList} counts={{
                clients: CLIENT_LAYERS.reduce((o, l) => ({ ...o, [l.key]: (av.data?.clients || []).filter(c => c.flags & l.bit).length }), {} as Record<ClientLayer, number>),
                knocks: level === 3
                  ? (rv.data?.houses || []).reduce((o, h) => { const k = h.st || NEVER.key; o[k] = (o[k] || 0) + 1; return o; }, {} as Record<string, number>)
                  : (av.data?.knocks || []).reduce((o, k) => { o[k.status] = (o[k.status] || 0) + 1; return o; }, {} as Record<string, number>),
                bookings: (bkd.data || []).filter(d => level === 2 || (d.route || '').toUpperCase() === (route || '').toUpperCase())
                  .reduce((o, d) => { const k = bkKeyOf(d); o[k] = (o[k] || 0) + 1; return o; }, {} as Record<BkKey, number>),
              }} />}
          </div>
        )}
      </section>

      {customerId && <CustomerModal id={customerId} onClose={() => setCustomerId(null)} />}
      {openBooking && seasonList && <BookingModal id={openBooking} list={seasonList} onClose={() => setOpenBooking(null)}
        onSaved={() => { setOpenBooking(null); bkd.reload(); rbk.reload(); bkc.reload(); }} />}
      {starting && <StartRoundModal card={starting} season={season} onClose={() => setStarting(null)}
        onDone={() => { setStarting(null); ov.reload(); av.reload(); rv.reload(); }} />}
      {showSettings && <MbSettingsModal centerId={center.id} seasons={seasons} onClose={() => setShowSettings(false)}
        onSaved={s => { setShowSettings(false); settings.reload(); if (!params.has('s') && s.service && s.season) go({ s: `${s.service}-${s.season}` }); }} />}
    </div>
  );
};

const Crumbs: React.FC<{ level: number; maps: string[]; route: string | null; onMaps: () => void; onRoute: () => void }> = ({ level, maps, route, onMaps, onRoute }) => {
  if (level === 1) return null;
  return (
    <nav className="v2-mb-crumbs" aria-label="Where you are">
      <button type="button" onClick={onMaps}><ArrowLeft size={14} />All maps</button>
      <ChevronRight size={13} className="v2-mut" />
      {level === 3 ? <button type="button" onClick={onRoute}>{maps.length === 1 ? maps[0] : `${maps.length} maps`}</button> : <b>{maps.length === 1 ? maps[0] : `${maps.length} maps`}</b>}
      {level === 3 && <><ChevronRight size={13} className="v2-mut" /><b>{route}</b></>}
    </nav>
  );
};

// ───────────── level 1 ─────────────
type AreaBk = Record<string, { total: number; done: number; open: number; cancelled: number }>;
const Level1: React.FC<{ cards: MapCard[]; bk: AreaBk; loading: boolean; picked: Set<string>; onPick: (a: string) => void; onOpen: () => void; onAll: () => void; centerName: string; service: Service }> =
  ({ cards, bk, loading, picked, onPick, onOpen, onAll, centerName, service }) => {
    if (loading) return <Loading label="Finding your master maps…" />;
    if (!cards.length) return <div className="v2-card v2-mut">No master maps are assigned to {centerName} yet. A Super Admin assigns them under Territory.</div>;
    return (
      <>
        <div className="v2-row v2-small" style={{ gap: 8 }}>
          <span className="v2-mut">{cards.length} master map{cards.length === 1 ? '' : 's'} · tap to pick</span>
          <span className="v2-spacer" />
          <button type="button" className="v2-link" onClick={onAll}>{picked.size === cards.length ? 'Clear' : 'Pick all'}</button>
        </div>
        <div className="v2-mb-cards">
          {cards.map(c => <Card key={c.area} card={c} bk={bk[c.area]} service={service} on={picked.has(c.area)} onClick={() => onPick(c.area)} />)}
        </div>
        <div className="v2-mb-open">
          <Btn onClick={onOpen} disabled={!picked.size} icon={ChevronRight}>{picked.size ? `Open ${picked.size} map${picked.size === 1 ? '' : 's'}` : 'Pick a map to open'}</Btn>
        </div>
      </>
    );
  };

const Card: React.FC<{ card: MapCard; bk?: AreaBk[string]; service: Service; on: boolean; onClick: () => void }> = ({ card: c, bk, service, on, onClick }) => {
  const shown = shownRound(c);
  return (
    <button type="button" className={`v2-card v2-mb-card${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <div className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <span className={`v2-mb-check${on ? ' on' : ''}`} aria-hidden>{on && <Check size={12} />}</span>
        <b className="v2-mb-name">{c.area}</b>
        <span className="v2-spacer" />
        <span className="v2-mut v2-small">{c.first && c.last ? `${c.first}–${c.last}` : 'No routes drawn'}</span>
      </div>
      <div className="v2-mb-nums">
        {bk ? <span title="This season’s bookings on this map"><b>{bk.done}/{bk.total}</b> bookings done</span> : <span><b>{c.bookings}</b> bookings</span>}
        {prevCounts(c, service).map(p => <span key={p.service}><b>{p.n.toLocaleString()}</b> prev {serviceLabel(p.service).toLowerCase()}</span>)}
      </div>
      {c.rounds.length === 0
        ? <div className="v2-mut v2-small">{c.loose ? `${c.loose} knocks since ${shortDay(c.loose_from || '')}, not in a round yet` : 'No rounds yet this season'}</div>
        : c.rounds.map(r => (
          <div key={r.no} className={`v2-mb-round${r.no === shown?.no ? ' shown' : ''}`}>
            <span className="n">{roundName(r.no)}{r.open && <i title="Open">•</i>}</span>
            <span className="d">{r.days.length ? daysLabel(r.days) : 'not worked yet'}</span>
            <span className="p" style={{ color: r.routes ? heatColor(pctOf(r.done, r.routes)) : undefined }}>{pctOf(r.done, c.routes)}% done</span>
            <span className="bar"><i style={{ width: `${pctOf(r.done, c.routes)}%`, background: heatColor(pctOf(r.done, c.routes)) }} /></span>
          </div>
        ))}
      {shown && shown.flagged > 0 && <div className="v2-mb-warn"><AlertTriangle size={13} />{shown.flagged} route{shown.flagged === 1 ? '' : 's'} bulk-tapped (knocks seconds apart)</div>}
      {c.suggest_new && c.last_day && <div className="v2-mb-hint"><Play size={12} />Last worked {shortDay(c.last_day)}: time for Round {(c.current || 0) + 1}?</div>}
    </button>
  );
};

// ───────────── level 2 ─────────────
const Level2: React.FC<{ cards: MapCard[]; view: AreaView | null; loading: boolean; season: Season; year: number; onRoute: (c: string) => void; onStart: (c: MapCard) => void }> =
  ({ cards, view, loading, season, year, onRoute, onStart }) => {
    if (loading) return <Loading label="Loading the maps…" />;
    if (!view) return null;
    return (
      <>
        {cards.map(c => {
          const mr = view.maps.find(m => m.area === c.area);
          const routes = view.routes.filter(r => r.area === c.area);
          const done = routes.filter(r => r.done).length;
          const canStart = season.season === year && (c.rounds.length === 0 || c.current !== null);
          const next = c.rounds.length === 0 ? 1 : (c.current || 0) + 1;
          return (
            <div key={c.area} className="v2-card v2-mb-map">
              <div className="v2-row" style={{ gap: 8 }}>
                <b>{c.area}</b>
                <Tag tone={mr?.round ? (mr.open ? 'b' : undefined) : 'a'}>{mr?.round ? `${roundName(mr.round)}${mr.open ? '' : ' · ended'}` : 'No such round'}</Tag>
                <span className="v2-spacer" />
                {canStart && <Btn size="sm" kind="o" icon={Play} onClick={() => onStart(c)}>Start Round {next}</Btn>}
              </div>
              {mr?.round ? (
                <div className="v2-mut v2-small" style={{ margin: '6px 0 8px' }}>
                  {done} of {routes.length} routes done ({pctOf(done, routes.length)}%) · {daysLabel([...new Set(routes.flatMap(r => r.days))]) || 'not worked yet'}
                </div>
              ) : <div className="v2-mut v2-small" style={{ margin: '6px 0 8px' }}>{c.loose ? `${c.loose} knocks since ${shortDay(c.loose_from || '')} aren’t in a round yet.` : 'Nothing to show for this round.'}</div>}
              <div className="v2-mb-routes">
                {routes.map(r => (
                  <button key={r.code} type="button" className="v2-mb-route" onClick={() => onRoute(r.code)}>
                    <b>{r.code}</b>
                    <span className="bar"><i style={{ width: `${Math.min(100, r.pct)}%`, background: r.doors ? heatColor(r.pct) : NO_DOORS }} /></span>
                    <span className="pct">{r.doors ? `${r.pct}%` : '—'}</span>
                    {r.done ? <Check size={14} className="ok" aria-label="Done" /> : <span style={{ width: 14 }} />}
                    {r.flagged && <AlertTriangle size={13} className="warn" aria-label="Bulk-tapped" />}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="v2-note">A route is done when {view.done_pct}% of its doors have a knock this round. Knocks tapped seconds apart don’t count.</div>
      </>
    );
  };

// ───────────── level 3 ─────────────
const Level3: React.FC<{ view: RouteView | null; loading: boolean; sel: HouseRow | null; onClose: () => void; season: Season; onCustomer: (id: string) => void;
  bookings: Booking[]; onBooking: (id: string) => void }> =
  ({ view, loading, sel, onClose, season, onCustomer, bookings, onBooking }) => {
    if (loading) return <Loading label="Loading the route…" />;
    if (!view) return null;
    if (sel) return <HousePanel route={view.route} row={sel} onClose={onClose} season={season} onCustomer={onCustomer} />;
    const pct = pctOf(view.knocked, view.doors);
    const byStreet = [...view.streets].filter(s => s.doors > 0).sort((a, b) => a.street.localeCompare(b.street));
    return (
      <>
        <div className="v2-card">
          <div className="v2-row" style={{ gap: 8 }}>
            <b style={{ fontSize: 17 }}>{view.route}</b>
            <Tag tone={view.round ? 'b' : 'a'}>{roundName(view.round)}</Tag>
            {view.done && <Tag tone="g">Done</Tag>}
            {view.flagged && <Tag tone="r">Bulk-tapped</Tag>}
          </div>
          <div className="v2-mb-big"><b style={{ color: heatColor(pct) }}>{pct}%</b><span>{view.knocked} of {view.doors} doors knocked{view.days.length ? ` · ${daysLabel(view.days)}` : ''}</span></div>
          <div className="v2-note" style={{ margin: 0 }}>Tap a house on the map for its knock history.</div>
        </div>
        <div className="v2-card" style={{ padding: 8 }}>
          <div className="v2-card-h" style={{ margin: '4px 6px 6px' }}>Streets</div>
          {byStreet.map(s => {
            const p = pctOf(s.knocked, s.doors);
            return (
              <div key={s.street} className="v2-mb-route" style={{ cursor: 'default' }}>
                <span className="st">{s.street}</span>
                <span className="bar"><i style={{ width: `${p}%`, background: heatColor(p) }} /></span>
                <span className="pct">{s.knocked}/{s.doors}</span>
              </div>
            );
          })}
        </div>
        <div className="v2-card" style={{ padding: 8 }}>
          <div className="v2-card-h" style={{ margin: '4px 6px 6px' }}>Bookings on {view.route} · {bookings.length}</div>
          {bookings.length === 0
            ? <div className="v2-mut v2-small" style={{ margin: '0 6px 6px' }}>No bookings on this route this season.</div>
            : bookings.map(b => {
              const last = lastAttempt(b.attempts);
              return (
                <button key={b.id} type="button" className="v2-mb-booking" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => onBooking(b.id)}>
                  <div className="v2-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <i className="dot" style={{ background: bookingColor(b) }} />
                    <b>{b.house_no} {b.street_name}</b><span className="v2-spacer" />
                    <span className="v2-mb-price">{b.prepaid ? 'Prepaid · ' : ''}{b.job_code}</span>
                  </div>
                  <div className="v2-mut v2-small">{[b.people?.[0] && `${b.people[0].first} ${b.people[0].last}`.trim(), b.status === 'done' ? `done ${b.done_on || ''}` : b.status, b.map_state !== 'on_map' ? STATE_LABEL[b.map_state] : null].filter(Boolean).join(' · ')}</div>
                  {last && b.status !== 'done' && <div className="v2-small" style={{ color: '#c2410c' }}>{attemptLine(last)}</div>}
                  {b.field_notes && <div className="v2-small">“{b.field_notes}”</div>}
                </button>
              );
            })}
        </div>
      </>
    );
  };

const HousePanel: React.FC<{ route: string; row: HouseRow; onClose: () => void; season: Season; onCustomer: (id: string) => void }> = ({ route, row, onClose, season, onCustomer }) => {
  const h = useLoad(() => loadHouse(route, row.k), [route, row.k]);
  const st = knockOf(row.st);
  return (
    <div className="v2-card v2-mb-house">
      <div className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <i className="dot" style={{ background: st?.color || '#fff', boxShadow: 'inset 0 0 0 1.5px #111827' }} />
        <b style={{ fontSize: 16 }}>{row.a}</b>
        <span className="v2-spacer" />
        <button type="button" className="v2-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="v2-mut v2-small" style={{ margin: '4px 0 10px' }}>
        {[st ? `${st.label} this round${row.day ? ` (${shortDay(row.day)})` : ''}` : 'Not knocked this round', row.carried ? 'invalid two rounds in a row' : null,
          row.fast ? 'tapped seconds after the last knock' : null].filter(Boolean).join(' · ')}
      </div>
      <ErrorBox error={h.error} />
      {h.loading && !h.data ? <Loading label="Loading its history…" /> : h.data && <>
        {h.data.client ? (
          <div className="v2-mb-client">
            <div className="v2-row" style={{ gap: 6 }}>
              <b>{h.data.client.name || 'Customer on file'}</b>
              {CLIENT_LAYERS.filter(l => row.f & l.bit).map(l => <span key={l.key} className="v2-mb-chip" style={{ borderColor: l.color, color: l.color }}>{l.label(season.season)}</span>)}
            </div>
            {h.data.client.jobs.length > 0 && <div className="v2-small v2-mut" style={{ marginTop: 4 }}>
              Jobs: {[...h.data.client.jobs].sort((a, b) => String(b.year || '').localeCompare(String(a.year || ''))).slice(0, 6)
                .map(j => [j.year, j.line, j.price && `$${String(j.price).replace(/[^0-9.]/g, '') || j.price}`].filter(Boolean).join(' ')).join(' · ')}
            </div>}
            <Btn size="sm" onClick={() => onCustomer(h.data!.client!.id)} style={{ marginTop: 8 }}>Open customer page</Btn>
          </div>
        ) : <div className="v2-note" style={{ margin: '0 0 8px' }}>Not a customer on file.</div>}
        <div className="v2-card-h" style={{ margin: '12px 0 4px' }}>Knock history</div>
        {h.data.visits.length === 0 ? <div className="v2-mut v2-small">Never knocked.</div> : (
          <ul className="v2-crm-tl">
            {h.data.visits.map((v, i) => {
              const s = VISIT[v.status] || { label: v.status, tone: undefined };
              return (
                <li key={i} className={`visit ${s.tone || ''}`}>
                  <span className="when">{fmtDay(v.day)}</span>
                  <span><b>{s.label}</b>{v.rounds?.length ? <span className="v2-mut"> · {v.rounds.map(r => `${serviceLabel(r.service)} ${r.season} R${r.no}`).join(', ')}</span> : null}
                    <span className="v2-mut v2-small" style={{ display: 'block' }}>{[v.worker || v.worker_id, v.first_name && `spoke to ${v.first_name}`, v.note && `“${v.note}”`].filter(Boolean).join(' · ')}</span></span>
                </li>
              );
            })}
          </ul>
        )}
        {h.data.carried.length > 0 && <div className="v2-note">Kept invalid into {h.data.carried.map(r => `${serviceLabel(r.service)} ${r.season} Round ${r.no}`).join(', ')}.</div>}
      </>}
    </div>
  );
};

// ───────────── filters ─────────────
const Filters: React.FC<{
  level: number; season: Season; heat: boolean; setHeat: (v: boolean) => void;
  knockOn: Set<string>; setKnockOn: (s: Set<string>) => void; clientOn: Set<ClientLayer>; setClientOn: (s: Set<ClientLayer>) => void;
  bkOn: Set<BkKey>; setBkOn: (s: Set<BkKey>) => void; hasList: boolean;
  counts: { clients: Record<ClientLayer, number>; knocks: Record<string, number>; bookings: Record<BkKey, number> };
}> = ({ level, season, heat, setHeat, knockOn, setKnockOn, clientOn, setClientOn, bkOn, setBkOn, hasList, counts }) => {
  const flip = <T,>(s: Set<T>, k: T) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const layers = [...CLIENT_LAYERS].sort((a, b) => (a.service === season.service ? 0 : 1) - (b.service === season.service ? 0 : 1) || b.bit - a.bit);
  const knocksHidden = level === 2 && heat;
  const knockKeys = KNOCKS.map(k => k.key);
  // a group's master switch: on while anything in it is on; switching it sets the whole group
  const Group: React.FC<{ label: string; note?: React.ReactNode; on: boolean; set: (v: boolean) => void }> = ({ label, note, on, set }) => (
    <div className="v2-mb-fgroup v2-mb-ghead"><span>{label}{note}</span><Toggle on={on} onChange={set} label={`All ${label.toLowerCase()}`} /></div>
  );
  return (
    <div className="v2-mb-fbody">
      <div className="v2-mb-frow">
        <Flame size={15} style={{ color: '#ea580c' }} /><span><b>Heat map</b><small>Streets coloured by knocks this round; route colours and knock dots off</small></span>
        <Toggle on={heat} onChange={setHeat} label="Heat map" />
      </div>
      {heat && <div className="v2-mb-scale"><span>10% or less</span><i /><span>70% or more</span></div>}
      <Group label="Knocks this round" note={knocksHidden && <small> · off in heat map</small>} on={knockKeys.some(k => knockOn.has(k))}
        set={v => setKnockOn(new Set(v ? knockKeys : []))} />
      {KNOCKS.map(k => (
        <button key={k.key} type="button" className={`v2-crm-leg${knockOn.has(k.key) ? '' : ' off'}${knocksHidden ? ' dim' : ''}`} onClick={() => setKnockOn(flip(knockOn, k.key))} aria-pressed={knockOn.has(k.key)}>
          <i style={{ background: k.color }} /><span>{k.label}</span><b>{(counts.knocks[k.key] || 0).toLocaleString()}</b>
        </button>
      ))}
      <Group label="Customers" on={clientOn.size > 0} set={v => setClientOn(new Set(v ? CLIENT_LAYERS.map(l => l.key) : []))} />
      {layers.map(l => (
        <button key={l.key} type="button" className={`v2-crm-leg${clientOn.has(l.key) ? '' : ' off'}`} onClick={() => setClientOn(flip(clientOn, l.key))} aria-pressed={clientOn.has(l.key)} title={l.hint}>
          <i style={{ background: l.color }} /><span>{l.label(season.season)}</span><b>{(counts.clients[l.key] || 0).toLocaleString()}</b>
        </button>
      ))}
      <Group label="Bookings" on={bkOn.size > 0} set={v => setBkOn(new Set(v ? BK_KEYS.map(k => k.key) : []))} />
      {BK_KEYS.map(k => (
        <button key={k.key} type="button" className={`v2-crm-leg${bkOn.has(k.key) ? '' : ' off'}`} onClick={() => setBkOn(flip(bkOn, k.key))} aria-pressed={bkOn.has(k.key)}>
          <i style={{ background: BOOKING_COLORS[k.key], boxShadow: 'inset 0 0 0 1.5px #111827' }} /><span>{k.label}</span><b>{(counts.bookings[k.key] || 0).toLocaleString()}</b>
        </button>
      ))}
      {!hasList && <div className="v2-note" style={{ margin: '4px 6px 0' }}>No booking list for {serviceLabel(season.service)} {season.season} at this center.</div>}
    </div>
  );
};

// ───────────── start a round ─────────────
const StartRoundModal: React.FC<{ card: MapCard; season: Season; onClose: () => void; onDone: () => void }> = ({ card, season, onClose, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<{ round: number; cleared: number; carried: number } | null>(null);
  const first = card.rounds.length === 0;
  const cur = card.rounds.find(r => r.open);
  const next = first ? 1 : (card.current || 0) + 1;
  const run = async () => { setBusy(true); setErr(null); try { setResult(await startRound(card.area, season)); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title={`Start ${roundName(next)} on ${card.area}?`} onClose={result ? onDone : onClose}
      footer={result ? <Btn onClick={onDone}>Done</Btn> : <><Btn kind="o" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={run} disabled={busy} icon={Play}>{busy ? 'Starting…' : `Start ${roundName(next)}`}</Btn></>}>
      {result ? (
        <p>{roundName(result.round)} has started on {card.area}.{result.cleared ? ` ${result.cleared.toLocaleString()} knocks were cleared off the workers’ maps (all kept in history).` : ''}{result.carried ? ` ${result.carried} addresses stay invalid (invalid two rounds in a row).` : ''}</p>
      ) : first ? (
        <p>{seasonLabel(season)} · {roundName(1)} starts on {card.area}{card.loose ? `, from ${shortDay(card.loose_from || '')}: the ${card.loose.toLocaleString()} knocks since then become Round 1` : ' today'}. Nothing is cleared.</p>
      ) : (
        <>
          <p>{roundName(card.current)} ends now{cur ? ` (${cur.days.length ? daysLabel(cur.days) : 'not worked'}, ${pctOf(cur.done, card.routes)}% of routes done)` : ''}, and {roundName(next)} starts.</p>
          <ul className="v2-mb-list">
            <li>Every knock on {card.area} clears off the workers’ maps, so each house gets knocked again.</li>
            <li>Nothing is lost: every knock stays in the history under {roundName(card.current)}, and a copy is kept.</li>
            <li>Addresses invalid in each of the last two rounds stay invalid.</li>
          </ul>
        </>
      )}
      <ErrorBox error={err} />
    </Modal>
  );
};
