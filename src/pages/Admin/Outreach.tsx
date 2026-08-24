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
      setError(err instanceof Error ? err.message : 'Could not load that map’s clients.');
    } finally {
      setLoadingClients(false);
    }
  };

  const visibleClients = useMemo(() => {
    let list = clients;
    if (hideTexted) list = list.filter(c => !texted.has(c.key));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        `${c.houseNum} ${c.streetName}`.toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '