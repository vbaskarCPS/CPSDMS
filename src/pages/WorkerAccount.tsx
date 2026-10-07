// src/pages/WorkerAccount.tsx — the worker's own account, opened from the map logsheet menu
// (and the logsheet header): confirm it's them, then update phones and email and create or
// change the PIN they sign in with. Styled like the rest of the worker app (dark, phone-first).
//
// Every call re-checks who they are on the server (PIN, or first name until they have a PIN),
// so nothing here trusts the browser. Five wrong PINs lock the worker for 15 minutes.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Phone, Mail, ShieldCheck, Loader } from 'lucide-react';
import { getStorageItem } from '../lib/localStorage';
import { commandCenterService } from '../lib/commandCenterService';
import { supabase } from '../lib/supabase';

interface Account {
  cn: string; name: string; has_record: boolean; has_pin: boolean; pin_set_at: string | null;
  cell_phone: string | null; alt_phone: string | null; email: string | null;
}
type Result = { ok: true } | { ok: false; reason: string; until?: string };

const REASONS: Record<string, string> = {
  wrong: 'That doesn’t match. Check it and try again.',
  locked: 'Too many wrong PINs. Try again in 15 minutes, or ask your manager to reset your PIN.',
  not_found: 'You’re not on today’s session at this center.',
  bad_phone: 'Enter phone numbers as 10 digits, e.g. 905-555-0123.',
  bad_email: 'That email address doesn’t look right.',
  bad_pin: 'A PIN is 4 to 6 numbers.',
  no_record: 'Your contractor record isn’t set up yet. Ask your manager.',
};
const reasonText = (r: Result | { reason?: string }) => REASONS[(r as { reason?: string }).reason || ''] || 'Something went wrong. Try again.';

/** 10 digits (a leading 1 is dropped) → 905-555-0123; anything else is left as typed. */
export function tidyPhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : v.trim();
}

const input = 'w-full h-12 rounded-xl bg-gray-900 border border-gray-700 px-3 text-white text-base focus:outline-none focus:border-blue-500';

const WorkerAccount: React.FC = () => {
  const navigate = useNavigate();
  const me = getStorageItem<{ contractorId?: string; firstName?: string; lastName?: string } | null>('current_user', null);
  const centerId = commandCenterService.getCurrentCommandCenterId();
  const cn = me?.contractorId || '';

  const [secret, setSecret] = useState('');
  const [acct, setAcct] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [cell, setCell] = useState(''); const [alt, setAlt] = useState(''); const [email, setEmail] = useState('');
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState('');

  const back = () => navigate(-1);
  if (!cn || !centerId) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-5">
        <p className="text-gray-300">Sign in first, then open My Account from the menu.</p>
        <button onClick={() => navigate('/app/login')} className="mt-4 h-12 px-5 rounded-xl bg-blue-600 font-bold">Sign in</button>
      </div>
    );
  }

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const { data, error: err } = await supabase.rpc('app_worker_account', { p_contractor_id: cn, p_center: centerId, p_secret: secret.trim() });
      if (err) throw err;
      if (!data?.ok) { setError(reasonText(data)); return; }
      const a = data as Account;
      setAcct(a); setCell(a.cell_phone || ''); setAlt(a.alt_phone || ''); setEmail(a.email || '');
    } catch { setError('Couldn’t reach the server. Check your signal and try again.'); }
    finally { setBusy(false); }
  };

  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSaved(null); setBusy(true);
    try {
      const c = tidyPhone(cell), a = tidyPhone(alt);
      const { data, error: err } = await supabase.rpc('app_worker_save_account', {
        p_contractor_id: cn, p_center: centerId, p_secret: secret.trim(), p_cell: c, p_alt: a, p_email: email.trim(),
      });
      if (err) throw err;
      if (!data?.ok) { setError(reasonText(data)); return; }
      setCell(c); setAlt(a); setSaved('Contact details saved.');
    } catch { setError('Couldn’t save. Check your signal and try again.'); }
    finally { setBusy(false); }
  };

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSaved(null);
    if (!/^\d{4,6}$/.test(pin)) { setError(REASONS.bad_pin); return; }
    if (pin !== pin2) { setError('The two PINs don’t match.'); return; }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.rpc('app_worker_set_pin', { p_contractor_id: cn, p_center: centerId, p_secret: secret.trim(), p_new_pin: pin });
      if (err) throw err;
      if (!data?.ok) { setError(reasonText(data)); return; }
      setSecret(pin); // the PIN is what proves it's them from now on
      setAcct(a => a ? { ...a, has_pin: true, pin_set_at: new Date().toISOString() } : a);
      setPin(''); setPin2('');
      setSaved(`PIN saved. Next time, sign in with ${cn} and your PIN.`);
    } catch { setError('Couldn’t save. Check your signal and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-3 h-14 flex items-center gap-2">
        <button onClick={back} className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center" aria-label="Back"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold leading-tight">My account</div>
          <div className="text-[11px] text-gray-400 truncate">{acct?.name || [me?.firstName, me?.lastName].filter(Boolean).join(' ')} · <span className="font-mono">#{cn}</span></div>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {error && <div className="rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm p-3">{error}</div>}
        {saved && <div className="rounded-xl bg-emerald-950/60 border border-emerald-700 text-emerald-200 text-sm p-3">{saved}</div>}

        {!acct ? (
          <form onSubmit={confirm} className="rounded-2xl bg-gray-900 border border-gray-800 p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold"><ShieldCheck size={18} className="text-blue-300" />Confirm it’s you</div>
            <p className="text-sm text-gray-400">Enter your PIN. If you haven’t made one yet, enter your first name.</p>
            <input className={input} type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)}
              placeholder="PIN or first name" aria-label="PIN or first name" autoFocus />
            <button type="submit" disabled={busy || !secret.trim()} className="w-full h-12 rounded-xl bg-blue-600 font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader size={16} className="animate-spin" />}Continue
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={savePin} className="rounded-2xl bg-gray-900 border border-gray-800 p-4 space-y-3">
              <div className="flex items-center gap-2 font-bold"><KeyRound size={18} className="text-amber-300" />{acct.has_pin ? 'Change your PIN' : 'Create a PIN'}</div>
              <p className="text-sm text-gray-400">
                {acct.has_pin
                  ? `You sign in with your CN # and PIN${acct.pin_set_at ? ` (set ${new Date(acct.pin_set_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })})` : ''}.`
                  : 'Right now you sign in with your first name. Make a 4 to 6 number PIN so only you can sign in as you.'}
              </p>
              <input className={input} type="password" inputMode="numeric" pattern="\d*" maxLength={6} autoComplete="new-password"
                value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="New PIN (4–6 numbers)" aria-label="New PIN" />
              <input className={input} type="password" inputMode="numeric" pattern="\d*" maxLength={6} autoComplete="new-password"
                value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="Type it again" aria-label="Type the PIN again" />
              <button type="submit" disabled={busy || !pin || !pin2 || !acct.has_record} className="w-full h-12 rounded-xl bg-amber-500 text-black font-bold disabled:opacity-50">
                {acct.has_pin ? 'Change PIN' : 'Save PIN'}
              </button>
              {!acct.has_record && <p className="text-xs text-gray-500">{REASONS.no_record}</p>}
            </form>

            <form onSubmit={saveContact} className="rounded-2xl bg-gray-900 border border-gray-800 p-4 space-y-3">
              <div className="flex items-center gap-2 font-bold"><Phone size={18} className="text-emerald-300" />Contact details</div>
              <label className="block text-xs text-gray-400">Cell phone
                <input className={`${input} mt-1`} type="tel" inputMode="tel" autoComplete="tel" value={cell} onChange={e => setCell(e.target.value)} placeholder="905-555-0123" />
              </label>
              <label className="block text-xs text-gray-400">Other phone (optional)
                <input className={`${input} mt-1`} type="tel" inputMode="tel" value={alt} onChange={e => setAlt(e.target.value)} />
              </label>
              <label className="block text-xs text-gray-400"><span className="inline-flex items-center gap-1"><Mail size={12} />Email (optional)</span>
                <input className={`${input} mt-1`} type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
              </label>
              <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-emerald-600 font-bold disabled:opacity-50">Save contact details</button>
              <p className="text-xs text-gray-500">Your manager sees your new number straight away. Your name can only be changed by the office.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default WorkerAccount;
