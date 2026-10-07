// src/v2/features/workerbook/CloseDay.tsx — close a day: check, then close. Days close one at a
// time, whenever you get to them. If the old app's session still holds this day, closing saves its
// carts, keeps a copy of the session and clears it; a day handed off to a newer one closes from its
// saved carts once every cart with sales is paid out. In-city no-shows go onto the NS list.
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { closeDay, closeDayCheck, type DaySummaryStored } from '../../lib/workerbook';
import { saveLines } from '../../lib/payslips';
import { liveDayForClose, saveDay } from '../../lib/payoutCarts';
import { Btn, ErrorBox, Loading, Modal } from '../../ui';

const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`;

const Line: React.FC<{ ok: boolean; warn?: boolean; title: React.ReactNode; children?: React.ReactNode }> = ({ ok, warn, title, children }) => (
  <div className="v2-close-line">
    {ok ? <CheckCircle2 size={18} color="var(--green)" /> : <AlertTriangle size={18} color={warn ? 'var(--amber)' : 'var(--rose)'} />}
    <div style={{ minWidth: 0 }}><b>{title}</b>{children && <div className="v2-small v2-mut" style={{ marginTop: 2 }}>{children}</div>}</div>
  </div>
);

export const CloseDay: React.FC<{ centerId: string; date: string; pretty: string; onClose: () => void; onClosed: (s: DaySummaryStored) => void }> =
  ({ centerId, date, pretty, onClose, onClosed }) => {
    const check = useLoad(() => closeDayCheck(centerId, date), [centerId, date]);
    const [busy, setBusy] = useState<'close' | null>(null);
    const [error, setError] = useState<unknown>(null);
    const c = check.data;

    const close = async () => {
      setBusy('close'); setError(null);
      try {
        // Save the day's carts, sales and payout lines first, while the session still exists, so the
        // day can still be edited until a payslip is generated.
        if (c?.has_session) {
          const live = await liveDayForClose(centerId, Number(date.slice(0, 4)));
          if (live.date !== date) throw new Error(`The open session is for ${live.date}, not ${date}`);
          try { await saveDay(centerId, date, live.carts, live.lines); }
          catch (e) {
            // before the carts SQL is run, keep saving the lines alone
            if (!/app_save_payout_day|payout_carts|schema cache/i.test(String((e as Error)?.message || e))) throw e;
            await saveLines(centerId, date, live.lines);
          }
        }
        onClosed(await closeDay(centerId, date));
      } catch (e) { setError(e); check.reload(); } finally { setBusy(null); }
    };

    const ready = !!c?.can_close;
    const unfinalized = c?.unfinalized || [];
    return (
      <Modal title={`Close ${pretty}`} onClose={onClose} footer={
        <div className="v2-row" style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Btn kind="o" onClick={onClose}>Cancel</Btn>
          <Btn kind="r" icon={Lock} disabled={!ready || !!busy} onClick={close}>{busy === 'close' ? 'Closing…' : 'Close day'}</Btn>
        </div>}>
        {check.loading && !c ? <Loading /> : !c ? <ErrorBox error={check.error} /> : (
          <div className="v2-stack" style={{ gap: 12 }}>
            <div className="v2-kpis">
              <div className="v2-kpi-box"><span className="l">Carts</span><span className="n">{c.carts}</span><span className="s">{c.paid} paid</span></div>
              <div className="v2-kpi-box"><span className="l">Steps</span><span className="n">{c.steps}</span></div>
              <div className="v2-kpi-box"><span className="l">Gross</span><span className="n green">{money(Number(c.gross))}</span></div>
            </div>

            <Line ok={c.unpaid.length + unfinalized.length === 0} title={c.unpaid.length + unfinalized.length === 0 ? 'Every cart with sales is paid out'
              : `${c.unpaid.length + unfinalized.length} cart${c.unpaid.length + unfinalized.length === 1 ? '' : 's'} with sales not paid out yet`}>
              {c.unpaid.length > 0 && <>
                {c.unpaid.map(u => `${u.names || u.worker_id} (${u.sales} sale${u.sales === 1 ? '' : 's'})`).join(' · ')}{' — pay them out on the day page first.'}
              </>}
              {unfinalized.length > 0 && <>
                {unfinalized.length} cart{unfinalized.length === 1 ? '' : 's'} saved when the day was handed off still {unfinalized.length === 1 ? 'needs' : 'need'} paying out: {unfinalized.map(u => `${u.label} (${u.sales} sale${u.sales === 1 ? '' : 's'})`).join(' · ')}.
                {' '}Open a worker on the day page, check the cart and tick Paid out.
              </>}
            </Line>
            {c.road_trip ? (
              <Line ok title="Road trip: no attendance to mark">Whoever has a finalized payout worked today; nobody goes onto the NS list.</Line>
            ) : <>
              <Line ok={c.unmarked.length === 0} title={c.unmarked.length === 0 ? `Attendance marked (${c.showed} showed of ${c.booked} booked)` : `${c.unmarked.length} not marked Showed or No-show`}>
                {c.unmarked.length > 0 && <>{c.unmarked.map(u => `${u.name} ${u.cn}`).join(' · ')} — mark them on this page first.</>}
              </Line>
              <Line ok warn={c.no_shows.length > 0} title={c.no_shows.length === 0 ? 'No no-shows' : `${c.no_shows.length} no-show${c.no_shows.length === 1 ? '' : 's'} will go onto the NS list`}>
                {c.no_shows.length > 0 && c.no_shows.map(n => `${n.name} ${n.cn} (${n.ns_count + 1} NS)`).join(' · ')}
              </Line>
            </>}
            <div className="v2-note">{c.has_session
              ? 'Closing saves each worker’s finalized day for payslips, keeps a copy of the session, then clears it from the RM map and worker logsheets. It can’t be undone from the app. (You don’t have to close a day before starting the next one: starting a newer day moves worker sign-ins to it and leaves this one open.)'
              : c.handed_off
                ? 'A newer day has the RM map and worker sign-ins, so closing only locks in this day’s numbers from its saved carts. Payouts stay editable until a payslip is generated.'
                : `There’s no live session to clear for this day; closing records ${c.road_trip ? 'the day’s numbers' : 'attendance and moves no-shows'}.`}</div>
            <ErrorBox error={error} />
          </div>
        )}
      </Modal>
    );
  };
