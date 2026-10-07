// src/v2/features/workerbook/CloseDay.tsx — close a day: check, download the day's Excel, close.
// Closing keeps a copy of the old app's session, clears it so the next day can start, moves
// the day's no-shows onto the NS list and records the day's numbers (app_close_day).
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Download, Lock } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { closeDay, closeDayCheck, type DaySummaryStored } from '../../lib/workerbook';
import { pointLegacyAt } from '../../lib/legacy';
import { linesFromLiveSession, saveLines } from '../../lib/payslips';
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
    const [downloaded, setDownloaded] = useState(false);
    const [busy, setBusy] = useState<'export' | 'close' | null>(null);
    const [error, setError] = useState<unknown>(null);
    const c = check.data;

    const download = async () => {
      setBusy('export'); setError(null);
      try {
        await pointLegacyAt(centerId);
        const { generateSessionExport } = await import('../../../lib/exportService');
        await generateSessionExport();
        setDownloaded(true);
      } catch (e) { setError(e); } finally { setBusy(null); }
    };
    const close = async () => {
      setBusy('close'); setError(null);
      try {
        // Save the day's payout lines for payslips first, while the session still exists.
        if (c?.has_session) {
          const live = await linesFromLiveSession(centerId);
          if (live.date !== date) throw new Error(`The open session is for ${live.date}, not ${date}`);
          await saveLines(centerId, date, live.lines);
        }
        onClosed(await closeDay(centerId, date));
      } catch (e) { setError(e); check.reload(); } finally { setBusy(null); }
    };

    const needsExport = !!c?.has_session;
    const ready = !!c?.can_close && (!needsExport || downloaded);
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

            <Line ok={c.unpaid.length === 0} title={c.unpaid.length === 0 ? 'Every cart with sales is paid out' : `${c.unpaid.length} cart${c.unpaid.length === 1 ? '' : 's'} with sales not paid out yet`}>
              {c.unpaid.length > 0 && <>
                {c.unpaid.map(u => `${u.names || u.worker_id} (${u.sales} sale${u.sales === 1 ? '' : 's'})`).join(' · ')}{' — pay them out on the day page first.'}
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
            {needsExport && (
              <Line ok={downloaded} warn title={downloaded ? 'Day’s Excel downloaded' : 'Download the day’s Excel first'}>
                The same export the old command center made before closing.{' '}
                <Btn size="sm" kind="o" icon={Download} disabled={!!busy} onClick={download}>{busy === 'export' ? 'Preparing…' : downloaded ? 'Download again' : 'Download Excel'}</Btn>
              </Line>
            )}
            <div className="v2-note">{c.has_session
              ? 'Closing saves each worker’s finalized day for payslips, keeps a copy of the session, then clears it from the RM map and worker logsheets so the next day can start. It can’t be undone from the app.'
              : 'There’s no live session to clear for this day; closing records attendance and moves no-shows.'}</div>
            <ErrorBox error={error} />
          </div>
        )}
      </Modal>
    );
  };
