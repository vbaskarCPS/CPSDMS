// src/v2/lib/bennyAddJob.ts — the Benny's "add a job to a logsheet" card: what it shows and the jobs it saves.
// The database checks the job first (benny_check_add_job). On the tap the app saves it with the logsheet's own save
// (sessionService.completeJob, the same as adding a sale on the logsheet screen), which works the cart's totals out
// again and, when there is an email, sends the client their receipt the way the logsheet does. Each add-on is its own
// line (an Add-On, paid as an upsell), tied to the sale.
import type { SessionTransaction } from '../../types';

export interface AddJobCheck {
  ok: boolean; problems?: string[]; date: string; stamp: string;
  worker: { cn: string; name: string };
  cart: { id: string; workers: string[]; names: string[] };
  job: { address: string; route?: string; client?: string; service: string; price: number; paid_by: string; add_ons: { name: string; price: number }[]; total: number };
  contact?: { phone?: string; email?: string };
  missing?: string[]; cautions?: string[];
}

const money = (n: number) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function addJobCard(c: AddJobCheck): { title: string; lines: string[]; action: string } {
  const j = c.job; const first = c.worker.name.split(' ')[0]; const team = c.cart.names.length > 1;
  return {
    title: `Add a job to ${first}’s logsheet`,
    lines: [
      [j.client, j.address].filter(Boolean).join(' · '),
      `Sale · ${j.service} · ${money(j.price)}${j.route ? ` · ${j.route}` : ''}`,
      ...j.add_ons.map(a => `Add-on · ${a.name} · ${money(a.price)}`),
      `Paid by: ${j.paid_by}${j.add_ons.length ? ` · total ${money(j.total)}` : ''}`,
      c.contact?.phone || c.contact?.email ? `Contact: ${[c.contact.phone, c.contact.email].filter(Boolean).join(' · ')}` : 'No phone or email',
      ...(c.missing?.length ? [`Not given: ${c.missing.join(', ')}.`] : []),
      ...(c.cautions || []),
      ...(c.contact?.email ? ['The client gets their receipt by email, the same as from the logsheet.'] : []),
      `${team ? `The cart’s (${c.cart.names.map(n => n.split(' ')[0]).join(' + ')})` : `${first}’s`} totals are worked out again.`,
    ].filter(Boolean),
    action: 'Add the job',
  };
}

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The logsheet lines for the card: the sale, then each add-on tied to it. Pure, so it's tested. */
export function addJobLines(c: AddJobCheck, now = new Date(), id = uid): { tx: SessionTransaction; jobId: string }[] {
  const j = c.job; const at = now.toISOString();
  const base = {
    timestamp: at, customerId: '', customerName: j.client || '', address: j.address, workerId: c.worker.cn, workerName: c.worker.name,
    routeCode: j.route || '', isPaid: true, paymentMethod: j.paid_by, serviceType: 'FP' as const,
  };
  const saleId = id();
  const sale = {
    ...base, id: saleId, jobId: `NEW-${now.getTime()}`, type: 'Sale' as const, price: j.price, displayPrice: String(j.price),
    items: [{ name: j.service, price: j.price }], paymentBreakdown: { [j.paid_by]: j.price }, itemDescription: 'New Sale',
    customerPhone: c.contact?.phone, customerEmail: c.contact?.email, isPrepaid: j.paid_by === 'Prepaid', services: {},
  } as unknown as SessionTransaction;
  const out = [{ tx: sale, jobId: sale.jobId }];
  j.add_ons.forEach((a, i) => {
    const tx = {
      ...base, id: id(), jobId: `NEW-${now.getTime()}-${i + 1}`, type: 'Add-On' as const, price: a.price, displayPrice: a.price.toFixed(2),
      items: [{ name: a.name, price: a.price }], paymentBreakdown: { [j.paid_by]: a.price }, serviceName: a.name, refId: saleId, services: {},
    } as unknown as SessionTransaction;
    out.push({ tx, jobId: tx.jobId });
  });
  return out;
}

export function addedSaid(c: AddJobCheck): string {
  const first = c.worker.name.split(' ')[0]; const j = c.job;
  return `Added to ${first}’s logsheet: ${j.address}, ${money(j.total)} ${j.paid_by.toLowerCase()}${j.add_ons.length ? ` (${j.add_ons.length + 1} lines)` : ''}. The totals are worked out again.`;
}
