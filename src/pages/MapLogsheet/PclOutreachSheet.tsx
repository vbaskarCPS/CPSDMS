// src/pages/MapLogsheet/PclOutreachSheet.tsx
//
// PCL OUTREACH — bottom sheet on the map logsheet. Lists the past customers on
// the worker's routes who have a phone number, with the same search and
// filters the office Outreach page had, and hands each one to the phone's
// Messages app with the worker's own template filled in.
//
// The client list comes straight from the map's house views: no extra fetch,
// and the houses already marked No / Invalid / Pending / Done today are left
// out, since texting someone you've just spoken to is odd.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Search, SlidersHorizontal, MessageSquare, Check, Settings, Save, Loader, Eye, EyeOff, Smartphone, ArrowLeft,
} from 'lucide-react';
import { Worker } from '../../types';
import { HouseView } from '../../lib/mapLogsheetService';
import { buildSmsLink } from '../../lib/workerbookEmailService';
import {
  DEFAULT_PCL_OUTREACH_TEMPLATE, PCL_OUTREACH_PLACEHOLDERS,
  buildPclOutreachMessage, pclClientKey,
  loadWorkerPclTemplate, saveWorkerPclTemplate, logPclText,
} from '../../lib/pclOutreachService';

export interface PclOutreachClient {
  key: string;
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
  maxPrice?: number;
  maxPriceYear?: number;
  repeatCount: number;
}

function parsePrice(raw: any): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : undefined;
}

/** Houses that are candidates for a text: a PCL with a phone, not already dealt with today. */
export function pclOutreachClients(views: HouseView[]): PclOutreachClient[] {
  const list: PclOutreachClient[] = [];
  for (const v of views) {
    const c = v.pcl;
    if (!c) continue;
    if (v.state === 'no' || v.state === 'invalid' || v.state === 'pending' || v.state === 'completed') continue;
    const phone = String(c.phone || '').trim();
    if (!phone) continue;
    const history: any[] = Array.isArray(c.history) ? c.history : [];
    const recent = history.length > 0 ? history[0] : null;
    let maxPrice: number | undefined;
    let maxPriceYear: number | undefined;
    history.forEach(h => {
      const p = parsePrice(h?.price);
      if (p !== undefined && (maxPrice === undefined || p > maxPrice)) { maxPrice = p; maxPriceYear = h?.year; }
    });
    const distinctYears = new Set(history.map(h => h?.year).filter(y => y !== null && y !== undefined));
    list.push({
      key: pclClientKey(v.house.routeCode, c.houseNum, c.streetName),
      routeCode: v.house.routeCode,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      houseNum: c.houseNum || '',
      streetName: c.streetName || '',
      city: c.city || undefined,
      phone,
      year: recent?.year,
      price: recent?.price,
      serviceType: recent?.serviceType,
      maxPrice,
      maxPriceYear,
      repeatCount: distinctYears.size,
    });
  }
  list.sort((a, b) => (b.year || 0) - (a.year || 0));
  return list;
}

interface Props {
  worker: Worker;
  commandCenterId: string | null;
  clients: PclOutreachClient[];
  texted: Set<string>;
  onTexted: (key: string) => void;
  onClose: () => void;
}

const PclOutreachSheet: React.FC<Props> = ({ worker, commandCenterId, clients, texted, onTexted, onClose }) => {
  const [search, setSearch] = useState('');
  const [hideTexted, setHideTexted] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [minRepeats, setMinRepeats] = useState('');

  // Template editing
  const [mode, setMode] = useState<'list' | 'template'>('list');
  const [template, setTemplate] = useState<string>(DEFAULT_PCL_OUTREACH_TEMPLATE);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWorkerPclTemplate(worker.contractorId)
      .then(t => { if (!cancelled) setTemplate(t); })
      .finally(() => { if (!cancelled) setTemplateLoaded(true); });
    return () => { cancelled = true; };
  }, [worker.contractorId]);

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    clients.forEach(c => { if (c.year) set.add(c.year); });
    return Array.from(set).sort((a, b) => b - a);
  }, [clients]);

  const clearFilters = useCallback(() => {
    setYearFrom(''); setYearTo(''); setMinPrice(''); setMinRepeats('');
  }, []);

  const activeFilterCount = (yearFrom ? 1 : 0) + (yearTo ? 1 : 0) + (minPrice ? 1 : 0) + (minRepeats ? 1 : 0);

  const visible = useMemo(() => {
    let list = clients;
    if (hideTexted) list = list.filter(c => !texted.has(c.key));
    const from = yearFrom ? parseInt(yearFrom, 10) : null;
    const to = yearTo ? parseInt(yearTo, 10) : null;
    if (from !== null) list = list.filter(c => (c.year || 0) >= from);
    if (to !== null) list = list.filter(c => (c.year || 0) <= to);
    const floor = minPrice ? parseFloat(minPrice.replace(/[^0-9.]/g, '')) : null;
    if (floor !== null && isFinite(floor)) list = list.filter(c => c.maxPrice !== undefined && c.maxPrice >= floor);
    const reps = minRepeats ? parseInt(minRepeats, 10) : null;
    if (reps !== null && isFinite(reps)) list = list.filter(c => c.repeatCount >= reps);
    const q = search.trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/\D/g, '');
      list = list.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        `${c.houseNum} ${c.streetName}`.toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (qDigits.length > 0 && c.phone.replace(/\D/g, '').indexOf(qDigits) >= 0) ||
        c.routeCode.toLowerCase().includes(q));
    }
    return list;
  }, [clients, texted, hideTexted, yearFrom, yearTo, minPrice, minRepeats, search]);

  const messageFor = (c: PclOutreachClient) => buildPclOutreachMessage(template, {
    firstName: c.firstName, lastName: c.lastName, houseNum: c.houseNum, streetName: c.streetName,
    city: c.city, year: c.year, price: c.price, serviceType: c.serviceType, routeCode: c.routeCode,
    workerFirstName: worker.firstName, workerLastName: worker.lastName,
  });

  const handleText = (c: PclOutreachClient) => {
    const body = messageFor(c);
    // Mark before navigating — once Messages takes over there is no callback.
    onTexted(c.key);
    logPclText(c.key).catch(() => {});
    window.location.href = buildSmsLink(c.phone, body);
  };

  const handleSaveTemplate = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveWorkerPclTemplate(worker.contractorId, commandCenterId, template.trim() || DEFAULT_PCL_OUTREACH_TEMPLATE);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  // Preview against the first client in the list, or a stand-in when the list is empty.
  const previewClient: PclOutreachClient = visible[0] || clients[0] || {
    key: '', routeCode: 'AJ-12', firstName: 'Sarah', lastName: 'Mitchell', houseNum: '49', streetName: 'Addley Cr',
    city: 'Ajax', phone: '905 555 0123', year: 2024, price: '$179.00', serviceType: 'SS', repeatCount: 2,
  };

  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 bg-gray-950 border-t border-gray-700 rounded-t-2xl shadow-2xl max-h-[85%] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
          {mode === 'template' ? (
            <button onClick={() => setMode('list')} className="p-1.5 text-gray-400"><ArrowLeft size={20} /></button>
          ) : (
            <MessageSquare size={18} className="text-teal-400 ml-1" />
          )}
          <span className="text-white font-bold text-sm">
            {mode === 'template' ? 'My PCL text' : 'PCL Outreach'}
          </span>
          {mode === 'list' && (
            <span className="text-xs text-gray-500">
              <span className="text-white font-bold">{visible.length}</span> of {clients.length}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {mode === 'list' && (
              <button
                onClick={() => setMode('template')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-800 border border-gray-700 text-gray-300 flex items-center gap-1.5"
              >
                <Settings size={13} /> Template
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400"><X size={20} /></button>
          </div>
        </div>

        {mode === 'template' ? (
          <div className="flex-1 overflow-y-auto px-3 pb-5 space-y-3 custom-scrollbar">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPreview(v => !v)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-800 border border-gray-700 text-gray-300 flex items-center gap-1.5"
              >
                {showPreview ? <EyeOff size={13} /> : <Eye size={13} />} {showPreview ? 'Edit' : 'Preview'}
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={saving || !templateLoaded}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 text-white flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
            </div>
            {saved && <div className="text-xs text-green-400 flex items-center gap-1"><Check size={13} /> Template saved.</div>}
            {saveError && <div className="text-xs text-red-400">{saveError}</div>}

            {!showPreview ? (
              <>
                <textarea
                  rows={6}
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                  disabled={!templateLoaded}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm leading-relaxed resize-y focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>
                    {template.length} characters
                    {template.length > 160 && (
                      <span className="text-amber-400 ml-1">· may split into {Math.ceil(template.length / 160)} messages</span>
                    )}
                  </span>
                  <button onClick={() => setTemplate(DEFAULT_PCL_OUTREACH_TEMPLATE)} className="text-gray-400 underline">Reset to default</button>
                </div>
                <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-800/60 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Tap a placeholder to add it
                  </div>
                  <div className="divide-y divide-gray-800">
                    {PCL_OUTREACH_PLACEHOLDERS.map(v => (
                      <button
                        key={v.p}
                        onClick={() => setTemplate(t => `${t}${t.endsWith(' ') || t.length === 0 ? '' : ' '}${v.p}`)}
                        className="w-full flex items-start gap-3 px-3 py-2 text-left active:bg-gray-800"
                      >
                        <code className="text-[11px] bg-gray-800 text-teal-300 px-1.5 py-0.5 rounded border border-gray-700 flex-shrink-0">{v.p}</code>
                        <span className="text-xs text-gray-400 leading-relaxed">{v.d}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                  <Smartphone size={13} /> To: {previewClient.firstName} {previewClient.lastName}
                </div>
                <div className="bg-teal-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-lg">
                  {messageFor(previewClient)}
                </div>
                <div className="text-right text-[11px] text-gray-500 mt-1 mr-2">Delivered</div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Search + toggles */}
            <div className="px-3 pb-2 shrink-0 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                  <Search size={15} className="text-gray-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Name, street, phone…"
                    className="flex-1 min-w-0 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-bold border flex items-center gap-1 ${
                    activeFilterCount > 0 ? 'bg-teal-600 border-teal-500 text-white'
                      : showFilters ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'
                  }`}
                >
                  <SlidersHorizontal size={13} />
                  {activeFilterCount > 0 && <span className="bg-white/25 rounded-full px-1.5 text-[10px]">{activeFilterCount}</span>}
                </button>
                <button
                  onClick={() => setHideTexted(v => !v)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-bold border ${
                    hideTexted ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'
                  }`}
                >
                  {hideTexted ? 'Hiding texted' : 'Showing all'}
                </button>
              </div>

              {showFilters && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Last done between</label>
                    <div className="flex items-center gap-2">
                      <select value={yearFrom} onChange={e => setYearFrom(e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-white text-xs focus:outline-none">
                        <option value="">Any</option>
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <span className="text-gray-600 text-xs">to</span>
                      <select value={yearTo} onChange={e => setYearTo(e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-white text-xs focus:outline-none">
                        <option value="">Any</option>
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Best price at least</label>
                      <div className="flex items-center bg-gray-900 border border-gray-600 rounded-md px-2">
                        <span className="text-gray-500 text-xs">$</span>
                        <input
                          type="number" inputMode="decimal" min="0" value={minPrice}
                          onChange={e => setMinPrice(e.target.value)} placeholder="any"
                          className="w-full bg-transparent py-1.5 px-1 text-white text-xs placeholder-gray-600 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Repeat years</label>
                      <select value={minRepeats} onChange={e => setMinRepeats(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-white text-xs focus:outline-none">
                        <option value="">Any</option>
                        <option value="2">2 or more</option>
                        <option value="3">3 or more</option>
                        <option value="4">4 or more</option>
                        <option value="5">5 or more</option>
                      </select>
                    </div>
                  </div>
                  {activeFilterCount > 0 && (
                    <button onClick={clearFilters} className="text-xs text-gray-400 flex items-center gap-1"><X size={12} /> Clear filters</button>
                  )}
                </div>
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-3 pb-5 space-y-1.5 custom-scrollbar">
              {visible.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-10">
                  {clients.length === 0
                    ? 'No PCLs with a phone number on your routes.'
                    : activeFilterCount > 0
                      ? 'No PCLs match those filters.'
                      : hideTexted
                        ? 'Everyone has been texted. Tap "Hiding texted" to see them.'
                        : 'Nothing matches that search.'}
                </div>
              ) : visible.map(c => {
                const done = texted.has(c.key);
                return (
                  <div
                    key={c.key}
                    className={`flex items-center gap-3 bg-gray-800 border rounded-lg px-3 py-2.5 ${done ? 'border-gray-800 opacity-50' : 'border-gray-700'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">
                          {`${c.firstName} ${c.lastName}`.trim() || '(no name on record)'}
                        </span>
                        {done && <span className="text-[10px] text-green-400 flex items-center gap-1 flex-shrink-0"><Check size={10} /> texted</span>}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{c.houseNum} {c.streetName}{c.city ? `, ${c.city}` : ''}</div>
                      <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="font-mono">{c.phone}</span>
                        {c.year && <><span className="text-gray-700">·</span><span>{c.year}</span></>}
                        {c.price && <><span className="text-gray-700">·</span><span className="text-green-500">{c.price}</span></>}
                        {c.serviceType && <><span className="text-gray-700">·</span><span>{c.serviceType}</span></>}
                        {c.repeatCount > 1 && <><span className="text-gray-700">·</span><span className="text-amber-500">{c.repeatCount}x</span></>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleText(c)}
                      className="px-3 py-2 rounded-lg bg-teal-600 active:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 flex-shrink-0"
                    >
                      <MessageSquare size={13} /> Text
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PclOutreachSheet;