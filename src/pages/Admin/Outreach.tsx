// src/pages/Admin/Outreach.tsx
//
// OUTREACH — text past customers from the map PCL cache.
//
// The callbook clients loaded in Map Builder already carry everything a warm
// outreach message needs: who lived there, what was done, when, and for how
// much. This page picks a master map, lists that map's clients who have a phone
// number, and hands each one to the phone's own SMS app with the message
// pre-filled — the same trick the Digital Workerbook uses (an `sms:` URL), which
// is what lets the text come from YOUR number rather than a service.
//
// Nothing is sent from the browser. Tapping a row opens Messages with the body
// written; you still press send. The page marks the client as texted at that
// point, which is a small lie — you might back out — but the alternative is no
// record at all, and re-texting the same homeowner is worse than the occasional
// false positive.
//
// Scope is the MASTER MAP, per Vijay: pick a map, work its list. Areas are
// grouped by region purely so one can be found among the couple of hundred.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Loader, Search, MessageSquare, Check, AlertCircle,
  Map as MapIcon, Settings, Save, Eye, EyeOff, Smartphone, Users, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { commandCenterService } from '../../lib/commandCenterService';
import {
  WorkerbookTextTemplate,
  DEFAULT_OUTREACH_TEXT_TEMPLATE,
  loadOutreachTextTemplate,
  saveStatusTextTemplate,
  buildOutreachTextMessage,
  buildSmsLink,
  outreachClientKey,
  getOutreachTextedSet,
  logOutreachText,
} from '../../lib/workerbookEmailService';

interface Props {
  onBack: () => void;
}

type Region = 'West' | 'Central' | 'East';

interface MapCard {
  areaName: string;
  prefix: string;
  region: Region;
  clientCount: number;
}

interface OutreachClient {
  key: string;             // routeCode | normalised address
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city?: string;
  phone: string;
  year?: number;
  price?: string;
  serviceType?: string;
  contractor?: string;
}

const REGION_ORDER: Region[] = ['West', 'Central', 'East'];

function regionStyle(region: Region): string {
  if (region === 'West') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (region === 'Central') return 'bg-green-900/40 text-green-300 border-green-700';
  return 'bg-orange-900/40 text-orange-300 border-orange-700';
}

const PLACEHOLDERS = [
  { p: '{{firstName}}', d: 'Customer first name (falls back to "there" if blank)' },
  { p: '{{lastName}}',  d: 'Last name' },
  { p: '{{fullName}}',  d: 'First and last together' },
  { p: '{{address}}',   d: 'House number and street, e.g. 49 Addley Cr' },
  { p: '{{city}}',      d: 'Town, where the callbook recorded one' },
  { p: '{{year}}',      d: 'Most recent year on record' },
  { p: '{{price}}',     d: 'Most recent price, e.g. $179.00' },
  { p: '{{service}}',   d: 'Most recent service code, e.g. SS' },
];

const SAMPLE: any = {
  firstName: 'Mark', lastName: 'Baxter',
  houseNum: '49', streetName: 'Addley Cr', city: 'Ajax',
  year: 2022, price: '$199.00', serviceType: 'SSP',
};

const Outreach: React.FC<Props> = ({ onBack }) => {
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());

  const [maps, setMaps] = useState<MapCard[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openMap, setOpenMap] = useState<MapCard | null>(null);
  const [clients, setClients] = useState<OutreachClient[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [texted, setTexted] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [hideTexted, setHideTexted] = useState(true);

  const [template, setTemplate] = useState<WorkerbookTextTemplate>({ ...DEFAULT_OUTREACH_TEXT_TEMPLATE });
  const [showTemplate, setShowTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // --- LOAD: maps, template, texted history ---
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Areas and their prefixes/regions.
        const { data: areaRows, error: areaErr } = await supabase
          .from('area_prefixes')
          .select('area_name, prefix, region')
          .order('area_name');
        if (areaErr) throw new Error(areaErr.message);

        // Client counts, paged — map_pcl_cache holds a row per route.
        const countByArea = new Map<string, number>();
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data, error: e } = await supabase
            .from('map_pcl_cache')
            .select('area_name, client_count')
            .range(from, from + BATCH - 1);
          if (e) { console.warn('[Outreach] PCL counts unavailable:', e.message); break; }
          if (!data || data.length === 0) break;
          data.forEach((r: any) =>
            countByArea.set(r.area_name, (countByArea.get(r.area_name) || 0) + (r.client_count || 0)));
          if (data.length < BATCH) break;
          from += BATCH;
        }

        if (cancelled) return;
        setMaps((areaRows || [])
          .map((a: any) => ({
            areaName: a.area_name,
            prefix: a.prefix,
            region: (a.region || 'East') as Region,
            clientCount: countByArea.get(a.area_name) || 0,
          }))
          // Maps with nothing cached can't be worked, so they're not offered.
          .filter(m => m.clientCount > 0));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load maps.');
      } finally {
        if (!cancelled) setLoadingMaps(false);
      }
    })();

    loadOutreachTextTemplate().then(t => { if (!cancelled) setTemplate(t); }).catch(() => {});
    getOutreachTextedSet().then(s => { if (!cancelled) setTexted(s); }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const mapsByRegion = useMemo(() => {
    const out = new Map<Region, MapCard[]>();
    REGION_ORDER.forEach(r => out.set(r, []));
    maps.forEach(m => {
      if (!out.has(m.region)) out.set(m.region, []);
      out.get(m.region)!.push(m);
    });
    return out;
  }, [maps]);

  // --- OPEN A MAP ---
  const handleOpenMap = async (card: MapCard) => {
    setOpenMap(card);
    setLoadingClients(true);
    setClients([]);
    setSearch('');
    try {
      const { data, error: e } = await supabase
        .from('map_pcl_cache')
        .select('route_code, clients')
        .eq('area_name', card.areaName);
      if (e) throw new Error(e.message);

      const list: OutreachClient[] = [];
      (data || []).forEach((row: any) => {
        (row.clients || []).forEach((c: any) => {
          const phone = String(c.phone || '').trim();
          if (!phone) return;                    // no number, no outreach
          // history is stored newest-first by the grouping, so [0] is the most
          // recent year, price and service.
          const recent = Array.isArray(c.history) && c.history.length > 0 ? c.history[0] : null;
          list.push({
            key: outreachClientKey(row.route_code, c.houseNum, c.streetName),
            routeCode: row.route_code,
            firstName: c.firstName || '',
            lastName: c.lastName || '',
            houseNum: c.houseNum || '',
            streetName: c.streetName || '',
            city: c.city || undefined,
            phone,
            year: recent?.year,
            price: recent?.price,
            serviceType: recent?.serviceType,
            contractor: recent?.contractor,
          });
        });
      });

      // Newest customers first — a 2025 client is a warmer call than a 2019 one.
      list.sort((a, b) => (b.year || 0) - (a.year || 0));
      setClients(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that map's clients.");
    } finally {
      setLoadingClients(false);
    }
  };

  const visibleClients = useMemo(() => {
    let list = clients;
    if (hideTexted) list = list.filter(c => !texted.has(c.key));
    const q = search.trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/\D/g, '');
      const phoneHit = (c: OutreachClient) =>
        qDigits.length > 0 && c.phone.replace(/\D/g, '').indexOf(qDigits) >= 0;
      list = list.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        `${c.houseNum} ${c.streetName}`.toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        phoneHit(c) ||
        c.routeCode.toLowerCase().includes(q)
      );
    }
    return list;
  }, [clients, texted, hideTexted, search]);

  // --- SEND ---
  const handleText = (c: OutreachClient) => {
    const body = buildOutreachTextMessage(template, {
      firstName: c.firstName,
      lastName: c.lastName,
      houseNum: c.houseNum,
      streetName: c.streetName,
      city: c.city,
      year: c.year,
      price: c.price,
      serviceType: c.serviceType,
    });
    // Mark before navigating — once the SMS app takes over we get no callback.
    setTexted(prev => new Set([...prev, c.key]));
    logOutreachText(c.key).catch(() => {});
    window.location.href = buildSmsLink(c.phone, body);
  };

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    setError(null);
    try {
      await saveStatusTextTemplate('outreach_text', template);
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the template.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const previewBody = useMemo(
    () => buildOutreachTextMessage(template, SAMPLE),
    [template],
  );

  const untextedCount = useMemo(
    () => clients.filter(c => !texted.has(c.key)).length,
    [clients, texted],
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => (openMap ? setOpenMap(null) : onBack())}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <MessageSquare size={18} className="text-teal-400" />
              {openMap ? openMap.areaName : 'Outreach'}
            </h1>
            <p className="text-xs text-gray-400 truncate">
              {openMap
                ? `${openMap.prefix} · ${clients.length} with a phone · ${untextedCount} not yet texted`
                : `${currentCC?.displayName || ''} — past customers from the digital maps`}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowTemplate(v => !v)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
                showTemplate ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Settings size={15} /> Template
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* TEMPLATE EDITOR */}
      {showTemplate && (
        <div className="max-w-6xl mx-auto px-4 mt-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={15} className="text-teal-400" />
              <h3 className="font-bold text-sm text-gray-200">Outreach message</h3>
              <button
                onClick={() => setShowPreview(v => !v)}
                className="ml-auto px-2.5 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 flex items-center gap-1.5"
              >
                {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                {showPreview ? 'Edit' : 'Preview'}
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                className="px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-50 text-xs font-bold flex items-center gap-1.5"
              >
                {savingTemplate ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </button>
            </div>

            {templateSaved && (
              <div className="mb-3 text-xs text-green-300 bg-green-900/20 border border-green-800 rounded px-3 py-2 flex items-center gap-2">
                <Check size={13} /> Template saved.
              </div>
            )}

            {!showPreview ? (
              <>
                <textarea
                  rows={5}
                  value={template.bodyText}
                  onChange={e => setTemplate({ bodyText: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-xs font-mono leading-relaxed resize-y focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    {template.bodyText.length} characters
                    {template.bodyText.length > 160 && (
                      <span className="text-amber-400 ml-1">
                        · may split into {Math.ceil(template.bodyText.length / 160)} messages
                      </span>
                    )}
                  </span>
                  <span className="text-gray-600">SMS limit is ~160 chars per message</span>
                </div>

                <div className="mt-3 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-700/50 text-xs font-bold text-gray-400 uppercase tracking-wide">
                    Available placeholders
                  </div>
                  <div className="divide-y divide-gray-800">
                    {PLACEHOLDERS.map(v => (
                      <div key={v.p} className="flex items-start gap-3 px-3 py-2">
                        <code
                          className="text-[11px] bg-gray-800 text-teal-300 px-1.5 py-0.5 rounded border border-gray-700 flex-shrink-0 cursor-pointer hover:bg-teal-900/30 hover:border-teal-700 transition-colors"
                          title="Click to copy"
                          onClick={() => navigator.clipboard?.writeText(v.p)}
                        >{v.p}</code>
                        <span className="text-xs text-gray-400 leading-relaxed">{v.d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-950 rounded-lg p-5">
                <div className="max-w-sm mx-auto">
                  <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                    <Smartphone size={13} /> To: {SAMPLE.firstName} {SAMPLE.lastName}
                  </div>
                  <div className="bg-teal-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-lg">
                    {previewBody}
                  </div>
                  <div className="text-right text-[11px] text-gray-500 mt-1 mr-2">Delivered</div>
                  <div className="mt-4 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-3">
                    <div className="font-bold text-gray-400 mb-1">Sample customer:</div>
                    <div>{SAMPLE.houseNum} {SAMPLE.streetName}, {SAMPLE.city}</div>
                    <div>Last done {SAMPLE.year} · {SAMPLE.price} · {SAMPLE.serviceType}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAP PICKER */}
      {!openMap && (
        <div className="max-w-6xl mx-auto p-4">
          {loadingMaps ? (
            <div className="flex items-center justify-center h-48">
              <Loader size={24} className="animate-spin text-teal-400" />
            </div>
          ) : maps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
              <MapIcon size={44} className="opacity-30" />
              <p className="text-sm">No maps have PCLs loaded yet.</p>
              <p className="text-xs text-gray-600">Load them in Map Builder first.</p>
            </div>
          ) : (
            REGION_ORDER.map(region => {
              const list = mapsByRegion.get(region) || [];
              if (list.length === 0) return null;
              return (
                <div key={region} className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${regionStyle(region)}`}>
                      {region}
                    </span>
                    <span className="text-xs text-gray-600">{list.length} maps with PCLs</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {list.map(m => (
                      <button
                        key={m.areaName}
                        onClick={() => handleOpenMap(m)}
                        className="text-left bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-teal-500 hover:bg-gray-750 transition-all"
                      >
                        <div className="text-lg font-bold font-mono text-white">{m.prefix}</div>
                        <div className="text-xs text-gray-300 leading-tight mb-2">{m.areaName}</div>
                        <div className="text-[10px] flex items-center gap-1 text-amber-500">
                          <Users size={9} /> {m.clientCount} clients
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* CLIENT LIST */}
      {openMap && (
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
              <Search size={15} className="text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Name, street, town, phone or route..."
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
              />
            </div>
            <button
              onClick={() => setHideTexted(v => !v)}
              className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                hideTexted
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {hideTexted ? 'Hiding texted' : 'Showing all'}
            </button>
          </div>

          {loadingClients ? (
            <div className="flex items-center justify-center h-40">
              <Loader size={22} className="animate-spin text-teal-400" />
            </div>
          ) : visibleClients.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-12">
              {clients.length === 0
                ? 'No clients on this map have a phone number on record.'
                : hideTexted
                  ? 'Everyone on this map has been texted. Switch to "Showing all" to see them.'
                  : 'Nothing matches that search.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {visibleClients.map(c => {
                const done = texted.has(c.key);
                return (
                  <div
                    key={c.key}
                    className={`flex items-center gap-3 bg-gray-800 border rounded-lg px-3 py-2.5 ${
                      done ? 'border-gray-800 opacity-50' : 'border-gray-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">
                          {`${c.firstName} ${c.lastName}`.trim() || '(no name on record)'}
                        </span>
                        <span className="text-[10px] font-mono bg-gray-900 border border-gray-700 text-gray-400 rounded px-1.5 py-0.5 flex-shrink-0">
                          {c.routeCode}
                        </span>
                        {done && (
                          <span className="text-[10px] text-green-400 flex items-center gap-1 flex-shrink-0">
                            <Check size={10} /> texted
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {c.houseNum} {c.streetName}{c.city ? `, ${c.city}` : ''}
                      </div>
                      <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                        <span className="font-mono">{c.phone}</span>
                        {c.year && <><span className="text-gray-700">·</span><span>{c.year}</span></>}
                        {c.price && <><span className="text-gray-700">·</span><span className="text-green-500">{c.price}</span></>}
                        {c.serviceType && <><span className="text-gray-700">·</span><span>{c.serviceType}</span></>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleText(c)}
                      className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 flex-shrink-0"
                    >
                      <MessageSquare size={13} /> Text
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Outreach;