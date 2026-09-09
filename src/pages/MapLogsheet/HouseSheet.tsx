// src/pages/MapLogsheet/HouseSheet.tsx
//
// Bottom sheet shown when a house is tapped. Phone-first: never taller than
// roughly the lower third of a Galaxy S26 screen, big thumb buttons.
//
// Also exports AddHouseSheet — the tiny form used when the worker places a
// missing house by hand.

import React, { useState, useEffect, useRef } from 'react';
import { X, Ban, DoorClosed, RotateCcw, DollarSign, Clock, Phone, StickyNote, Trash2, Loader, CheckCircle2, MapPin, Plus, Pencil, CircleSlash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HouseView, HouseDispositionStatus, HOUSE_COLORS } from '../../lib/mapLogsheetService';

interface HouseSheetProps {
  view: HouseView;
  saving: boolean;
  onDispose: (status: HouseDispositionStatus, note: string) => void;
  onClearDisposition: () => void;
  onSale: () => void;
  onOpenPending: () => void;
  onOpenBooking: () => void;
  onClose: () => void;
}

const STATE_LABEL: Record<HouseView['state'], string> = {
  none: 'Not knocked',
  not_home: 'Not home',
  no: 'No',
  go_back: 'Go back',
  invalid: 'Invalid',
  pending: 'Pending sale',
  completed: 'Completed',
};

// Seconds before an untouched, un-dispositioned house is marked Not Home.
const AUTO_NOT_HOME_SECONDS = 5;

const HouseSheet: React.FC<HouseSheetProps> = ({
  view, saving, onDispose, onClearDisposition, onSale, onOpenPending, onOpenBooking, onClose,
}) => {
  const { house, state, isPcl, pcl, disposition, pendingSale, officeBooking, completed } = view;
  const [note, setNote] = useState(disposition?.note || '');
  const [showNote, setShowNote] = useState(!!disposition?.note);
  const [showHistory, setShowHistory] = useState(false);
  // Once a disposition exists the four buttons collapse to a summary row;
  // "Change" expands them again.
  const [expanded, setExpanded] = useState(false);

  // --- AUTO NOT-HOME COUNTDOWN ---
  // A fresh house (no disposition, not pending/completed) starts a countdown
  // on open; if nothing is tapped before it hits zero, it's marked Not Home.
  // Any tap on a button, the note, or closing the sheet cancels it.
  const houseId = `${house.routeCode}::${house.houseKey}`;
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const onDisposeRef = useRef(onDispose);
  useEffect(() => { onDisposeRef.current = onDispose; }, [onDispose]);

  const cancelCountdown = () => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
    setCountdown(null);
  };

  useEffect(() => {
    // Reset local edits when the selected house changes.
    setNote(disposition?.note || '');
    setShowNote(!!disposition?.note);
    setShowHistory(false);
    setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, disposition?.note]);

  useEffect(() => {
    cancelCountdown();
    const fresh = !disposition && state === 'none';
    if (!fresh) return;
    let remaining = AUTO_NOT_HOME_SECONDS;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        cancelCountdown();
        onDisposeRef.current('not_home', '');
      } else {
        setCountdown(remaining);
      }
    }, 1000);
    return cancelCountdown;
    // Only re-arm when the house changes — not on every disposition/state tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId]);

  // Disposition arrived (from a tap or the timer) → stop counting, collapse.
  useEffect(() => {
    if (disposition) { cancelCountdown(); setExpanded(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disposition?.status, disposition?.updatedAt]);

  const address = `${house.civicNo}${(house.civicSuffix || '').toUpperCase()} ${house.streetName}`;
  const stateColor =
    state === 'completed' ? HOUSE_COLORS.completed :
    state === 'pending' ? HOUSE_COLORS.pending :
    state === 'no' ? HOUSE_COLORS.no :
    state === 'go_back' ? HOUSE_COLORS.go_back :
    state === 'invalid' ? HOUSE_COLORS.invalid :
    state === 'not_home' ? (isPcl ? HOUSE_COLORS.pclNotHome : HOUSE_COLORS.not_home) :
    isPcl ? HOUSE_COLORS.pcl : '#e5e7eb';

    const dispoBtn = (status: HouseDispositionStatus, label: string, Icon: LucideIcon, color: string) => {
      const active = disposition?.status === status && state !== 'pending' && state !== 'completed';
      const showCount = status === 'not_home' && countdown !== null && !disposition;
      return (
        <button
          type="button"
          disabled={saving}
          onClick={() => { cancelCountdown(); onDispose(status, note); }}
        className={`flex-1 min-w-0 py-3 rounded-lg border-2 font-bold text-xs flex flex-col items-center gap-1 transition-colors disabled:opacity-50 ${
          active ? 'text-white' : 'bg-gray-800 text-gray-200 border-gray-700 active:bg-gray-700'
        }`}
        style={active ? { backgroundColor: color, borderColor: color } : undefined}
      >
        <Icon size={18} />
        {showCount ? `${label} ${countdown}` : label}
      </button>
    );
  };

  const STATUS_META: Record<HouseDispositionStatus, { label: string; color: string; Icon: LucideIcon }> = {
    not_home: { label: 'Not home', color: isPcl ? HOUSE_COLORS.pclNotHome : HOUSE_COLORS.not_home, Icon: DoorClosed },
    no: { label: 'No', color: HOUSE_COLORS.no, Icon: Ban },
    go_back: { label: 'Go back', color: HOUSE_COLORS.go_back, Icon: RotateCcw },
    invalid: { label: 'Invalid', color: HOUSE_COLORS.invalid, Icon: CircleSlash },
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl max-h-[45vh] flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stateColor }} />
            <h3 className="text-white font-bold text-base truncate">{address}</h3>
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="font-mono bg-gray-800 border border-gray-700 px-1.5 rounded">{house.routeCode}</span>
            <span>{STATE_LABEL[state]}</span>
            {house.unitCount > 1 && <span>· {house.unitCount} units</span>}
            {house.source === 'manual' && <span className="text-yellow-500">· added by hand</span>}
          </div>
        </div>
        <button onClick={() => { cancelCountdown(); onClose(); }} className="p-1.5 text-gray-400 hover:text-white shrink-0"><X size={20} /></button>
      </div>

      <div className="px-4 pb-4 overflow-y-auto custom-scrollbar space-y-3">
        {/* PCL block */}
        {isPcl && pcl && (
          <button
            type="button"
            onClick={() => setShowHistory(s => !s)}
            className="w-full text-left bg-blue-950/50 border border-blue-800 rounded-lg px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-blue-200 font-bold text-sm truncate">{pcl.firstName} {pcl.lastName}</div>
                <div className="text-[11px] text-blue-300/80 flex items-center gap-2">
                  {pcl.phone && <span className="flex items-center gap-1"><Phone size={10} />{pcl.phone}</span>}
                  <span className="flex items-center gap-1"><Clock size={10} />{pcl.history.length}x</span>
                  {pcl.history[0] && <span>last {pcl.history[0].year} · {pcl.history[0].price}</span>}
                </div>
              </div>
              <span className="text-[10px] text-blue-300">{showHistory ? 'hide' : 'history'}</span>
            </div>
            {showHistory && (
              <div className="mt-2 border-t border-blue-900 pt-1">
                {pcl.history.map((h, i) => (
                  <div key={i} className="grid grid-cols-4 text-[11px] py-0.5 text-blue-100/90">
                    <span className="font-mono">{h.year}</span>
                    <span className="font-mono">{h.price}</span>
                    <span>{h.serviceType}</span>
                    <span className="truncate text-blue-300/70">{h.contractor || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </button>
        )}

        {/* Completed — nothing else to do here */}
        {state === 'completed' && completed && (
          <div className="bg-green-950/50 border border-green-800 rounded-lg px-3 py-2 text-sm text-green-200 flex items-center gap-2">
            <CheckCircle2 size={16} /> Sale completed{completed.Price ? ` · $${completed.Price}` : ''}
          </div>
        )}

        {/* Pending — tap to complete */}
        {state === 'pending' && (pendingSale || officeBooking) && (
          <button
            type="button"
            disabled={saving}
            onClick={pendingSale ? onOpenPending : onOpenBooking}
            className="w-full bg-yellow-600 active:bg-yellow-500 text-black font-bold rounded-lg py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <DollarSign size={18} />
            {pendingSale
              ? `Complete pending sale${pendingSale.price ? ` · $${pendingSale.price}` : ''}`
              : `Open booking${officeBooking?.Price ? ` · $${officeBooking.Price}` : ''}`}
          </button>
        )}

        {/* Dispositions + Sale */}
        {state !== 'completed' && state !== 'pending' && (
          <>
            {disposition && !expanded ? (
              // Collapsed: what it's marked as, a Change button, and Sale.
              <div className="flex gap-2 items-stretch">
                {(() => {
                  const m = STATUS_META[disposition.status];
                  return (
                    <div
                      className="flex-1 min-w-0 rounded-lg border-2 px-3 py-2 flex items-center gap-2 text-white font-bold text-sm"
                      style={{ backgroundColor: m.color, borderColor: m.color }}
                    >
                      <m.Icon size={18} /> {m.label}
                    </div>
                  );
                })()}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setExpanded(true)}
                  className="px-3 rounded-lg border-2 border-gray-700 bg-gray-800 text-gray-200 font-bold text-xs flex flex-col items-center justify-center gap-1 active:bg-gray-700 disabled:opacity-50"
                >
                  <Pencil size={16} />
                  Change
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { cancelCountdown(); onSale(); }}
                  className="px-4 rounded-lg border-2 border-yellow-500 bg-yellow-600 text-black font-bold text-xs flex flex-col items-center justify-center gap-1 active:bg-yellow-500 disabled:opacity-50"
                >
                  <DollarSign size={18} />
                  Sale
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {dispoBtn('not_home', 'Not home', DoorClosed, isPcl ? HOUSE_COLORS.pclNotHome : HOUSE_COLORS.not_home)}
                {dispoBtn('no', 'No', Ban, HOUSE_COLORS.no)}
                {dispoBtn('go_back', 'Go back', RotateCcw, HOUSE_COLORS.go_back)}
                {dispoBtn('invalid', 'Invalid', CircleSlash, HOUSE_COLORS.invalid)}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { cancelCountdown(); onSale(); }}
                  className="flex-1 min-w-0 py-3 rounded-lg border-2 border-yellow-500 bg-yellow-600 text-black font-bold text-xs flex flex-col items-center gap-1 active:bg-yellow-500 disabled:opacity-50"
                >
                  <DollarSign size={18} />
                  Sale
                </button>
              </div>
            )}

            {/* Note */}
            {showNote ? (
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Note (e.g. try after 6, dog at side door)"
                  disabled={saving}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cps-blue"
                />
                {disposition && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onDispose(disposition.status, note)}
                    className="px-3 rounded-lg bg-gray-700 text-white text-xs font-bold disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => { cancelCountdown(); setShowNote(true); }} className="text-[11px] text-gray-400 flex items-center gap-1">
                <StickyNote size={12} /> Add a note
              </button>
            )}

            {disposition && (
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>Marked {new Date(disposition.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <button type="button" disabled={saving} onClick={onClearDisposition} className="flex items-center gap-1 text-red-400 disabled:opacity-50">
                  <Trash2 size={12} /> Clear
                </button>
              </div>
            )}
          </>
        )}

        {saving && (
          <div className="flex items-center gap-2 text-xs text-gray-400"><Loader size={12} className="animate-spin" /> Saving…</div>
        )}
      </div>
    </div>
  );
};

export default HouseSheet;

// ---------------------------------------------------------------------------
// ADD HOUSE SHEET
// ---------------------------------------------------------------------------
interface AddHouseSheetProps {
  routeCode: string;
  streetOptions: string[];   // route's street names, nearest first
  lng: number;
  lat: number;
  saving: boolean;
  onSave: (civicNo: number, suffix: string, street: string) => void;
  onCancel: () => void;
}

export const AddHouseSheet: React.FC<AddHouseSheetProps> = ({ routeCode, streetOptions, lng, lat, saving, onSave, onCancel }) => {
  const [num, setNum] = useState('');
  const [street, setStreet] = useState(streetOptions[0] || '');
  const [custom, setCustom] = useState(streetOptions.length === 0);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const m = num.trim().match(/^(\d+)\s*([a-zA-Z]?)$/);
    if (!m) { setErr('Enter a house number like 42 or 42A.'); return; }
    if (!street.trim()) { setErr('Enter a street name.'); return; }
    setErr(null);
    onSave(parseInt(m[1], 10), m[2].toLowerCase(), street.trim());
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3 className="text-white font-bold text-base flex items-center gap-2"><Plus size={16} className="text-yellow-400" /> Add missing house</h3>
        <button onClick={onCancel} className="p-1.5 text-gray-400 hover:text-white"><X size={20} /></button>
      </div>
      <div className="px-4 pb-4 space-y-3">
        <div className="text-[11px] text-gray-400 flex items-center gap-1">
          <MapPin size={11} /> {routeCode} · {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
        <div className="flex gap-2">
          <input
            value={num}
            onChange={e => setNum(e.target.value)}
            placeholder="House #"
            inputMode="numeric"
            autoFocus
            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cps-blue"
          />
          {custom ? (
            <input
              value={street}
              onChange={e => setStreet(e.target.value)}
              placeholder="Street name"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cps-blue"
            />
          ) : (
            <select
              value={street}
              onChange={e => { if (e.target.value === '__custom__') { setCustom(true); setStreet(''); } else setStreet(e.target.value); }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cps-blue"
            >
              {streetOptions.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="__custom__">+ Other…</option>
            </select>
          )}
        </div>
        {err && <div className="text-xs text-red-400">{err}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="flex-1 py-3 rounded-lg bg-gray-800 text-gray-300 font-bold text-sm disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="flex-1 py-3 rounded-lg bg-cps-blue text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} Add house
          </button>
        </div>
      </div>
    </div>
  );
};