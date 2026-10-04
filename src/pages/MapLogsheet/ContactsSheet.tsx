// src/pages/MapLogsheet/ContactsSheet.tsx
//
// "Contacts" from the map logsheet menu: every route manager in this command
// centre, plus the worker's cart partners today, each with Call and Text.

import React, { useEffect, useState } from 'react';
import { X, Phone, MessageSquare, Loader, Users, UserCog } from 'lucide-react';
import { sessionService } from '../../lib/sessionService';

export interface ContactPerson { id: string; name: string; phone: string | null }

interface ContactsSheetProps {
  partners: ContactPerson[];
  onClose: () => void;
}

/** "(905) 555-1234" for a 10-digit number; anything else as typed. */
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}
const telHref = (raw: string) => `tel:${raw.replace(/[^\d+]/g, '')}`;
const smsHref = (raw: string) => `sms:${raw.replace(/[^\d+]/g, '')}`;

const Row: React.FC<{ person: ContactPerson }> = ({ person }) => (
  <div className="flex items-center gap-3 bg-gray-800 rounded-xl px-3 py-2.5">
    <div className="flex-1 min-w-0">
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

const ContactsSheet: React.FC<ContactsSheetProps> = ({ partners, onClose }) => {
  const [managers, setManagers] = useState<ContactPerson[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionService.getCommandCenterManagerContacts()
      .then(list => { if (!cancelled) setManagers(list); })
      .catch(() => { if (!cancelled) setManagers([]); });
    return () => { cancelled = true; };
  }, []);

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
            <div className="text-xs text-gray-500 px-1 py-2">No route managers found.</div>
          ) : managers.map(m => <Row key={m.id} person={m} />)}
        </div>

        <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1 pb-1.5 flex items-center gap-1.5">
          <Users size={13} /> Your partners today
        </div>
        <div className="space-y-1.5">
          {partners.length === 0
            ? <div className="text-xs text-gray-500 px-1 py-2">You're working solo today.</div>
            : partners.map(p => <Row key={p.id} person={p} />)}
        </div>
      </div>
    </div>
  );
};

export default ContactsSheet;
