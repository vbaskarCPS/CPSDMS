// src/v2/features/clients/Customer.tsx — one customer: who lives there, what they've paid and owe,
// every job (by year), and every touch at the house (jobs, knocks at the door, texts sent).
import React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Phone } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { customer, fmtDay, fmtMoney, jobsByYear, money, moneySummary, PAID, timeline, type Job } from '../../lib/customers';
import { formatPhone, lineLabel } from '../../lib/clientImport';
import { ErrorBox, Loading, Tag } from '../../ui';
import { canReadCustomers } from './CustomerMap';

export const Customer: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { can } = useAuth();
  const allowed = canReadCustomers(can);
  const res = useLoad(() => allowed ? customer(id) : Promise.resolve(null), [id, allowed]);
  const back = params.get('area') ? `/app/clients?area=${encodeURIComponent(params.get('area')!)}` : '/app/clients';

  if (!allowed) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to customers.</div></div>;
  if (res.loading && !res.data) return <div className="v2-main v2-narrow"><Loading /></div>;
  if (!res.data) return <div className="v2-main v2-narrow"><Link to={back} className="v2-crm-back"><ChevronLeft size={16} />Customers</Link><ErrorBox error={res.error || 'That customer isn’t on file.'} /></div>;

  const { client: c, area } = res.data;
  const year = new Date().getFullYear();
  const m = moneySummary(c.history, year);
  const years = jobsByYear(c.history);
  const items = timeline(res.data);
  const doneNow = c.history.some(j => String(j.year) === String(year));
  const before = c.history.some(j => Number(j.year) && Number(j.year) < year);
  const phoneOf = (i: number) => c.people[i]?.phone;
  const looseNumbers = c.phones.filter(p => !c.people.some(x => x.phone === p));

  return (
    <div className="v2-main v2-narrow">
      <Link to={back} className="v2-crm-back"><ChevronLeft size={16} />{area || 'Customers'}</Link>
      <div className="v2-head" style={{ marginBottom: 6 }}>
        <span className="v2-h1">{c.house_no} {c.street_name}{c.unit ? ` Unit ${c.unit}` : ''}</span>
        {doneNow && <Tag tone="g">{before ? 'Back again' : 'New'} · done {year}</Tag>}
        {!doneNow && before && <Tag>Past customer</Tag>}
        {m.owed > 0 && <Tag tone="r">Owes {fmtMoney(m.owed)}</Tag>}
        {c.do_not_call && <Tag tone="r">Do not call</Tag>}
        {c.do_not_text && <Tag tone="r">Do not text</Tag>}
        {(c.tags || []).map(t => <Tag key={t}>{t}</Tag>)}
      </div>
      <div className="v2-mut" style={{ marginBottom: 16 }}>
        {[c.city, c.province, c.postal_code].filter(Boolean).join(', ')}
        {c.route_code ? <> · route <b style={{ color: 'var(--ink)' }}>{c.route_code}</b></> : ' · no route yet'}
        {area && <> · {area}</>}
      </div>

      <div className="v2-crm-cols">
        <div className="v2-stack">
          <div className="v2-card">
            <div className="v2-card-h">People</div>
            {c.people.length ? c.people.map((p, i) => (
              <div key={i} className="v2-crm-person">
                <b>{`${p.first} ${p.last}`.trim() || '—'}</b>
                {phoneOf(i) && <PhoneLinks n={phoneOf(i)!} />}
              </div>
            )) : <div className="v2-mut">No names on file.</div>}
            {looseNumbers.length > 0 && <>
              <div className="v2-card-h" style={{ marginTop: 12 }}>Other numbers</div>
              {looseNumbers.map(p => <div key={p} className="v2-crm-person"><PhoneLinks n={p} /></div>)}
            </>}
            {c.emails.length > 0 && <>
              <div className="v2-card-h" style={{ marginTop: 12 }}>Email</div>
              {c.emails.map(e => <div key={e}><a className="v2-link" href={`mailto:${e}`}>{e}</a></div>)}
            </>}
            {c.call_first && <><div className="v2-card-h" style={{ marginTop: 12 }}>Call first</div><div>{c.call_first}</div></>}
          </div>

          <div className="v2-card">
            <div className="v2-card-h">Money</div>
            <div className="v2-crm-money">
              <div><span>Paid, all time</span><b>{fmtMoney(m.lifetime)}</b></div>
              <div><span>Paid in {year}</span><b>{fmtMoney(m.season)}</b></div>
              <div className={m.owed ? 'owed' : ''}><span>Owed</span><b>{fmtMoney(m.owed)}</b></div>
              <div><span>Jobs</span><b>{m.jobs}<small> over {m.years} year{m.years === 1 ? '' : 's'}</small></b></div>
            </div>
          </div>

          {c.notes && <div className="v2-card"><div className="v2-card-h">Notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div></div>}
        </div>

        <div className="v2-stack" style={{ minWidth: 0 }}>
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-card-h" style={{ padding: '14px 14px 0' }}>Jobs</div>
            {years.length ? (
              <div className="v2-table-wrap">
                <table className="v2-table">
                  <thead><tr><th>Date</th><th>What</th><th>How</th><th>Price</th><th>Payment</th><th>Crew</th></tr></thead>
                  <tbody>
                    {years.map(y => (
                      <React.Fragment key={y.year}>
                        <tr className="v2-crm-year"><td colSpan={6}><b>{y.year}</b> <span className="v2-mut v2-small">{y.jobs.length} job{y.jobs.length === 1 ? '' : 's'}</span></td></tr>
                        {y.jobs.map((j, i) => <JobRow key={i} j={j} />)}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="v2-mut" style={{ padding: 14 }}>No jobs yet.</div>}
          </div>

          <div className="v2-card">
            <div className="v2-card-h">At the house</div>
            {items.length ? (
              <ol className="v2-crm-tl">
                {items.map((it, i) => (
                  <li key={i} className={`${it.kind} ${it.tone || ''}`}>
                    <span className="when">{fmtDay(it.at)}</span>
                    <div><b>{it.title}</b>{it.detail && <div className="v2-mut v2-small">{it.detail}</div>}</div>
                  </li>
                ))}
              </ol>
            ) : <div className="v2-mut">No knocks, dated jobs or texts yet. Knocks are kept from {fmtDay('2026-09-15')} on.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

const PhoneLinks: React.FC<{ n: string }> = ({ n }) => (
  <span className="v2-crm-phone">
    <a className="v2-link" href={`tel:${n}`}><Phone size={13} />{formatPhone(n)}</a>
    <a className="v2-link" href={`sms:${n}`} aria-label={`Text ${formatPhone(n)}`}><MessageSquare size={13} /></a>
  </span>
);

const JobRow: React.FC<{ j: Job }> = ({ j }) => {
  const paid = j.paid ? PAID[j.paid] : null;
  const crew = (j.crew || []).map(x => x.name).filter(Boolean).join(', ') || j.contractor || '';
  const what = j.product && j.service && j.product !== j.service ? `${j.product} (${j.service})` : j.product || j.service || '—';
  return (
    <tr>
      <td className="v2-small" style={{ whiteSpace: 'nowrap' }}>{j.date ? fmtDay(j.date) : '—'}</td>
      <td><b>{what}</b>{j.line && <div className="v2-small v2-mut">{lineLabel(j.line)}</div>}</td>
      <td className="v2-small">{j.source || '—'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{j.price ? (/^\d|^\$/.test(j.price) ? fmtMoney(money(j.price)) : j.price) : '—'}</td>
      <td className="v2-small">{[j.payment, j.payment_detail].filter(Boolean).join(' · ') || '—'} {paid && <Tag tone={paid.tone}>{paid.label}</Tag>}</td>
      <td className="v2-small">{crew || '—'}</td>
    </tr>
  );
};
