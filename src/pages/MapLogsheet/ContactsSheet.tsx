// src/pages/MapLogsheet/ContactsSheet.tsx
//
// "Contacts" from the map logsheet menu: every route manager in this command
// centre — the worker's own assigned manager first and highlighted — plus the
// worker's cart partners today, each with Call and Text.
//
// It looks the managers up itself (straight from the users table) so it
// doesn't depend on any other file being a particular version, and any
// failure shows a message inside the sheet instead of breaking the page.

import React, { useEffect, useState } from 'react';
import { X, Phone, MessageSquare, Loader, Users, UserCog } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { commandCenterService } from '../../lib/commandCenterService';

export interface ContactPerson { id: string; name: string; phone: string | null }

interface ContactsSheetProps {
  partners: ContactPerson[];
  /** The worker — their CURRENT assigned route manager is listed first, highlighted. */
  workerId?: string | null;
  /** Fallback: the assigned manager saved at login. */
  assignedManagerId?: string | null;
  onClose: () => void;
}

/** "(905) 555-1234" for a 10-digit number; anything else as typed. */
function prettyPhone(raw: string): string {
  const d = String(raw).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}
/** Any stored phone value → trimmed text, or null when there isn't one. */
function cleanPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  return t ? t : null;
}
const telHref = (raw: string) => `tel:${raw.replace(/[^\d+]/g, '')}`;
const smsHref = (raw: string) => `sms:${raw.replace(/[^\d+]/g, '')}`;

const Row: React.FC<{ person: ContactPerson; mine?: boolean }> = ({ person, mine }) => (
  <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${mine ? 'bg-emerald-900/40 border border-emerald-500' : 'bg-gray-800'}`}>
    <div className="flex-1 min-w-0">
      {mine && <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 mb-0.5">Your manager</div>}
      <div className="text-sm font-bold text-white truncate">{person.name}</div>
      <div className="text-xs text-gray-400">{person.phone ? prettyPhone(person.phone) : 'No number on file'}</div>
    </div>
    {person.phone && (
      <>
        <a href={smsHref(person.phone)} className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center active:bg-gray-600" aria-label={`Text ${person.name}`}>
          <MessageSquare size={18} className="text-teal-300" />
        </a>
        <a href={telHref(person.phone)} className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center active:bg-green-500" aria-label={`Call ${person.name}`}>
          <Phone size={18} className="text-white" />
        </a>
      </>
    )}
  </div>
);

const ContactsSheet: React.FC<ContactsSheetProps> = ({ partners, workerId, assignedManagerId, onClose }) => {
  const [managers, setManagers] = useState<ContactPerson[] | null>(null);
  const [mineId, setMineId] = useState<string | null>(assignedManagerId || null);
  const [failed, setFailed] = useState(false);
  const mineLc = (mineId || '').toLowerCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ccId = commandCenterService.getCurrentCommandCenterId?.() || null;
        let q = supabase.from('users').select('user_id, name, metadata').eq('role', 'RouteManager');
        if (ccId) q = q.eq('command_center_id', ccId);
        const { data, error } = await q;
        if (error) throw error;
        const list: ContactPerson[] = (data || [])
          .map((u: any) => ({
            id: String(u.user_id ?? ''),
            name: String(u.name || 'Route manager'),
            phone: cleanPhone(u.metadata?.phone),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        // The worker's CURRENT assigned manager (falls back to the one saved at login).
        let mid: string | null = assignedManagerId || null;
        if (workerId) {
          try {
            const { data: me } = await supabase.from('users').select('metadata')
              .ilike('user_id', workerId).eq('role', 'Worker').limit(1);
            mid = (me as any)?.[0]?.metadata?.assignedManagerId || mid;
          } catch { /* keep the fallback */ }
        }
        if (cancelled) return;
        const midLc = (mid || '').toLowerCase();
        setMineId(mid);
        // The worker's own manager on top; everyone else stays alphabetical.
        const isMine = (m: ContactPerson) => !!midLc && m.id.toLowerCase() === midLc;
        setManagers([...list.filter(isMine), ...list.filter(m => !isMine(m))]);
      } catch (e: any) {
        console.error('[Contacts] could not load route managers', e);
        if (!cancelled) { setFailed(true); setManagers([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [workerId, assignedManagerId]);

  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl p-3 pb-5 max-h-[85%] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-sm font-bold text-white">Contacts</span>
          <button onClick={onClose} className="p-1 text-gray-400"><X size={20} /></button>
        </div>

        <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1 pb-1.5 flex items-center gap-1.5">
          <UserCog size={13} /> Route managers
        </div>
        <div className="space-y-1.5 mb-4">
          {managers === null ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 px-1 py-2"><Loader size={14} className="animate-spin" /> Loading…</div>
          ) : managers.length === 0 ? (
            <div className="text-xs text-gray-500 px-1 py-2">{failed ? "Couldn't load route managers — check your connection and try again." : 'No route managers found.'}</div>
          ) : managers.map(m => <Row key={m.id} person={m} mine={!!mineLc && m.id.toLowerCase() === mineLc} />)}
        </div>

        <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1 pb-1.5 flex items-center gap-1.5">
          <Users size={13} /> Your partners today
        </div>
        <div className="space-y-1.5">
          {(partners || []).length === 0
            ? <div className="text-xs text-gray-500 px-1 py-2">You're working solo today.</div>
            : (partners || []).map((p, i) => <Row key={p.id || i} person={{ ...p, name: String(p.name || 'Partner'), phone: cleanPhone(p.phone) }} />)}
        </div>
      </div>
    </div>
  );
};

export default ContactsSheet;
