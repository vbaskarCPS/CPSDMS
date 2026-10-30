// src/lib/offline/fieldWrites.ts — the saves a worker makes in the field, wired to the outbox
// (src/lib/offline/outbox.ts): writing a sale (cash, cheque, e-transfer; a card is charged online
// first), parking and editing pending sales, booking updates, and house outcomes on the map.
// Each one says what the screen shows while it's waiting, and how to make it safe to keep on the
// phone. Route managers and office desktops are untouched (their saves go straight to the server).
import { sessionService } from '../sessionService';
import { clearDisposition, routeHouseId, setDisposition, type HouseDisposition } from '../mapLogsheetService';
import { safeCardFields } from '../cardSafety';
import { defineSave, save } from './outbox';
import type { LogsheetSession, MasterBooking, PendingSale, PendingSaleInput, PendingSaleUpdate, SessionTransaction } from '../../types';

/** The arguments in a phone's-copy key, e.g. session.getPendingSalesForSession:["abc"] → ["abc"]. */
const keyArgs = (key: string): unknown[] => { try { return JSON.parse(key.slice(key.indexOf(':') + 1)); } catch { return []; } };
const is = (key: string, name: string) => key.startsWith(`${name}:`);

const PENDING_LISTS = ['session.getPendingSalesForSession', 'session.getPendingSalesForManager', 'session.getAllPendingSalesForToday'];
const editPendingLists = (key: string, value: unknown, fn: (list: PendingSale[]) => PendingSale[]) =>
  PENDING_LISTS.some(n => is(key, n)) && Array.isArray(value) ? fn(value as PendingSale[]) : value;

/** What a pending sale looks like on the screen before the server has it. */
function pendingFromInput(input: PendingSaleInput): PendingSale {
  const now = new Date().toISOString();
  return {
    id: input.clientId!, sessionId: input.sessionId, workerId: input.workerId, commandCenterId: '', sessionDate: now.slice(0, 10),
    routeCode: input.routeCode, houseNumber: input.houseNumber, streetName: input.streetName, price: input.price, propertyType: input.propertyType,
    services: input.services, notes: input.notes, firstName: input.firstName, lastName: input.lastName, phone: input.phone, email: input.email,
    createdAt: now, updatedAt: now, saleType: input.saleType, parentId: input.parentId, assignedRcSessionId: input.assignedRcSessionId,
    asphaltAmount: input.asphaltAmount, upsoldAsphaltAmount: input.upsoldAsphaltAmount,
  };
}

// ── pending sales ──
defineSave<[PendingSaleInput], PendingSale>('session.createPendingSale', {
  send: sessionService.createPendingSale.bind(sessionService),
  optimistic: ([input]) => pendingFromInput(input),
  overlay: (key, value, [input]) => {
    if (is(key, 'session.getPendingSaleById') && keyArgs(key)[0] === input.clientId && !value) return pendingFromInput(input);
    return editPendingLists(key, value, list => (list.some(p => p.id === input.clientId) || (is(key, 'session.getPendingSalesForSession') && keyArgs(key)[0] !== input.sessionId))
      ? list : [pendingFromInput(input), ...list]);
  },
  touches: ['session.pending'],
});
defineSave<[string, PendingSaleUpdate], void>('session.updatePendingSale', {
  send: sessionService.updatePendingSale.bind(sessionService),
  overlay: (key, value, [id, updates]) => {
    if (is(key, 'session.getPendingSaleById') && value && (value as PendingSale).id === id) return { ...(value as PendingSale), ...updates };
    return editPendingLists(key, value, list => list.map(p => (p.id === id ? { ...p, ...(updates as Partial<PendingSale>) } : p)));
  },
  touches: ['session.pending'],
});
defineSave<[string], void>('session.deletePendingSale', {
  send: sessionService.deletePendingSale.bind(sessionService),
  overlay: (key, value, [id]) => {
    if (is(key, 'session.getPendingSaleById') && keyArgs(key)[0] === id) return null;
    return editPendingLists(key, value, list => list.filter(p => p.id !== id));
  },
  touches: ['session.pending'],
});

// ── writing a sale ──
type CompleteArgs = Parameters<typeof sessionService.completeJob>;
defineSave<CompleteArgs, void>('session.completeJob', {
  send: sessionService.completeJob.bind(sessionService),
  // card numbers never go on the phone: only a Bambora reference or the last 4 (as the server keeps)
  sanitize: ([tx, ...rest]) => {
    const t = { ...(tx as SessionTransaction & { ccFullNumber?: string; ccExpiry?: string; ccCVC?: string }) };
    const c = safeCardFields(t.ccFullNumber, t.ccExpiry, t.ccCVC);
    if (t.ccFullNumber !== undefined) t.ccFullNumber = c.number ?? undefined;
    if (t.ccExpiry !== undefined) t.ccExpiry = c.expiry ?? undefined;
    if (t.ccCVC !== undefined) t.ccCVC = c.cvc ?? undefined;
    return [t, ...rest] as CompleteArgs;
  },
  beforeRetry: ([tx]) => { sessionService.noReceiptFor.add(tx.id); },   // the receipt may already have gone
  overlay: (key, value, [tx, jobId, , , pendingSaleId, asphalt]) => {
    if (is(key, 'session.getActiveLogsheetSession') && value) {
      const s = value as LogsheetSession;
      if ((s.financialStore || []).some(t => t.id === tx.id)) return s;
      return { ...s, financialStore: [...(s.financialStore || []), tx] };
    }
    if (is(key, 'session.getWorkerAssignments') && Array.isArray(value)) {
      return (value as MasterBooking[]).map(b => (b['Booking ID'] === jobId ? { ...b, Status: 'completed' } : b));
    }
    const a = asphalt as { parentSaleId?: string; childSaleId?: string } | undefined;
    const gone = new Set([pendingSaleId, a?.parentSaleId, a?.childSaleId].filter(Boolean) as string[]);
    return gone.size ? editPendingLists(key, value, list => list.filter(p => !gone.has(p.id))) : value;
  },
  touches: ['session.job'],
});

// ── bookings ──
defineSave<Parameters<typeof sessionService.updateBookingStatus>, void>('session.updateBookingStatus', {
  send: sessionService.updateBookingStatus.bind(sessionService),
  overlay: (key, value, [bookingId, status]) => (is(key, 'session.getWorkerAssignments') && Array.isArray(value)
    ? (value as MasterBooking[]).map(b => (b['Booking ID'] === bookingId ? { ...b, Status: status } : b)) : value),
  touches: ['session.booking'],
});
defineSave<Parameters<typeof sessionService.updateBookingNotes>, void>('session.updateBookingNotes', {
  send: sessionService.updateBookingNotes.bind(sessionService),
  overlay: (key, value, [bookingId, notes]) => (is(key, 'session.getWorkerAssignments') && Array.isArray(value)
    ? (value as MasterBooking[]).map(b => (b['Booking ID'] === bookingId ? { ...b, 'Log Sheet Notes': notes } : b)) : value),
  touches: ['session.booking'],
});

// The worker screens call these through sessionService as always; on a worker's field day they go
// through the outbox. A pending sale gets its id here, so a repeat send can't make two.
const svc = sessionService as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
svc.createPendingSale = (input: unknown) => {
  const i = input as PendingSaleInput;
  return save('session.createPendingSale', [{ ...i, clientId: i.clientId || `pend_${i.workerId}_${Date.now()}` }]);
};
for (const name of ['updatePendingSale', 'deletePendingSale', 'completeJob', 'updateBookingStatus', 'updateBookingNotes']) {
  svc[name] = (...args: unknown[]) => save(`session.${name}`, args);
}

// ── house outcomes on the map ──
type DispositionInput = Parameters<typeof setDisposition>[0];
const dispositionFrom = (i: DispositionInput): HouseDisposition => ({
  routeCode: i.routeCode, houseKey: i.houseKey, status: i.status, note: i.note?.trim() ? i.note.trim() : null,
  firstName: i.firstName?.trim() ? i.firstName.trim() : null, workerId: i.workerId, sessionId: i.sessionId ?? null,
  updatedAt: i.updatedAt || new Date().toISOString(),
});
defineSave<[DispositionInput], HouseDisposition>('ml.setDisposition', {
  send: setDisposition,
  optimistic: ([i]) => dispositionFrom(i),
  overlay: (key, value, [i]) => {
    if (!is(key, 'ml.dispositions') || !(value instanceof Map)) return value;
    const m = new Map(value); m.set(routeHouseId(i.routeCode, i.houseKey), dispositionFrom(i)); return m;
  },
  touches: ['ml.dispositions'],
});
defineSave<[string, string], void>('ml.clearDisposition', {
  send: clearDisposition,
  overlay: (key, value, [routeCode, houseKey]) => {
    if (!is(key, 'ml.dispositions') || !(value instanceof Map)) return value;
    const m = new Map(value); m.delete(routeHouseId(routeCode, houseKey)); return m;
  },
  touches: ['ml.dispositions'],
});

/** Mark a house (Not Home, No, Go Back…): instant, and sent when there's signal. */
export const saveDisposition = (input: DispositionInput) => save<HouseDisposition>('ml.setDisposition', [{ ...input, updatedAt: input.updatedAt || new Date().toISOString() }]);
export const saveClearDisposition = (routeCode: string, houseKey: string) => save<void>('ml.clearDisposition', [routeCode, houseKey]);
