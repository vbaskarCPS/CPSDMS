// src/v2/features/clients/Clients.tsx — Clients & Dialer › Clients: one record per property address,
// organized by city › route map › route › clients (or as one list, or searched), filtered by service.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { clientTree, listClients, type Client, type TreeCity } from '../../lib/clients';
import { RegionTag } from '../admin/Territory';
import type { Region } from '../../lib/territory';
import { formatPhone, lineLabel, SERVICE_LINES } from '../../lib/clientImport';
import { Btn, ErrorBox, Loading, Modal, Tag } from '../../ui';

const HOW: Record<string, string> = { map: 'on the digital map’s client list', house: 'house on the route', address_point: 'official address point', geocode: 'map search', street: 'only route on the street', given: 'the list’s route code', manual: 'set by hand',
  house_benny: 'house on the route, address fixed by The Benny', address_point_benny: 'official address point, address fixed by The Benny',
  geocode_benny: 'map search, address fixed by The Benny', street_benny: 'only route on the street, address fixed by The Benny', given_benny: 'the list’s route code' };
const name = (c: Client) => c.people.map(p => `${p.first} ${p.last}`.trim()).filter(Boolean).join(', ');

export const Clients: React.FC = () => {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<'tree' | 'all' | 'none'>('tree');
  const [service, setService] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Client | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const grouped = filter === 'tree' && !debounced.trim();
  const list = useLoad(() => grouped ? Promise.resolve(null) : listClients({ q: debounced, noRoute: filter === 'none', service, page }), [grouped, debounced, filter, service, page]);
  const tree = useLoad(() => grouped ? clientTree(service) : Promise.resolve(null), [grouped, service]);

  if (!can('dialer') && !can('sa_territory')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to clients.</div></div>;
  const total = grouped ? (tree.data || []).reduce((a, c) => a + c.n, 0) : list.data?.total || 0;
  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Clients</span>
        <span className="v2-mut v2-small">{total.toLocaleString()} {filter === 'none' && !grouped ? 'without a route' : 'properties'}{service ? ` · ${lineLabel(service)}` : ''}</span>
        <span className="v2-spacer" />
        {can('sa_territory') && <Link className="v2-btn o" to="/app/admin/territory/clients">Import a client list</Link>}
      </div>
      <div className="v2-row" style={{ marginBottom: 12 }}>
        <button className={`v2-chip${filter === 'tree' ? ' on' : ''}`} onClick={() => { setFilter('tree'); setPage(0); }}>By city & route</button>
        <button className={`v2-chip${filter === 'all' ? ' on' : ''}`} onClick={() => { setFilter('all'); setPage(0); }}>All as a list</button>
        <button className={`v2-chip${filter === 'none' ? ' on' : ''}`} onClick={() => { setFilter('none'); setPage(0); }}>Needs attention · no route</button>
        <select className="v2-sel" style={{ width: 190 }} value={service} onChange={e => { setService(e.target.value); setPage(0); }} aria-label="Service">
          <option value="">Every service</option>
          {SERVICE_LINES.map(l => <option key={l.key} value={l.key}>{l.label} clients</option>)}
        </select>
        <span className="v2-spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30, width: 280 }} placeholder="Address, street, last name, phone or route" value={q} onChange={e => setQ(e.target.value)} aria-label="Search clients" />
        </div>
      </div>
      {filter === 'tree' && debounced.trim() && <div className="v2-note" style={{ marginTop: 0 }}>Showing search results as a list. Clear the search to go back to cities and routes.</div>}
      <ErrorBox error={list.error || tree.error} />
      {grouped ? (tree.loading && !tree.data ? <Loading label="Counting clients by city and route…" /> : <ClientTree cities={tree.data || []} service={service} onOpen={setOpen} />)
      : list.loading && !list.data ? <Loading /> : (
        <div className="v2-card" style={{ padding: 0 }}>
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr><th>Address</th><th>Route</th><th>Name</th><th>Phone</th><th>Services</th><th>Last service</th><th>Flags</th></tr></thead>
              <tbody>
                {(list.data?.rows || []).map(c => <ClientRow key={c.id} c={c} onOpen={setOpen} />)}
                {(list.data?.rows || []).length === 0 && <tr><td colSpan={7} className="v2-mut" style={{ textAlign: 'center', padding: 24 }}>No clients{debounced ? ' match that search' : ' yet'}.</td></tr>}
              </tbody>
            </table>
          </div>
          {total > 100 && (
            <div className="v2-row" style={{ padding: 10 }}>
              <span className="v2-mut v2-small">{page * 100 + 1}–{Math.min(total, (page + 1) * 100)} of {total.toLocaleString()}</span>
              <span className="v2-spacer" />
              <Btn size="sm" kind="o" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Btn>
              <Btn size="sm" kind="o" disabled={(page + 1) * 100 >= total} onClick={() => setPage(p => p + 1)}>Next</Btn>
            </div>
          )}
        </div>
      )}
      {open && <ClientCard c={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const ClientRow: React.FC<{ c: Client; onOpen: (c: Client) => void; hideRoute?: boolean }> = ({ c, onOpen, hideRoute }) => {
  const last = c.history[0];
  return (
    <tr className="click" onClick={() => onOpen(c)}>
      <td><b>{c.house_no} {c.street_name}</b>{c.unit && ` Unit ${c.unit}`}<div className="v2-small v2-mut">{c.city || ''}</div></td>
      {!hideRoute && <td>{c.route_code ? <b>{c.route_code}</b> : <Tag tone="a">No route</Tag>}</td>}
      <td>{name(c) || '—'}</td>
      <td className="v2-small">{c.phones[0] ? formatPhone(c.phones[0]) : '—'}{c.phones.length > 1 && <span className="v2-mut"> +{c.phones.length - 1}</span>}</td>
      <td>{(c.services || []).map(l => <span key={l} style={{ marginRight: 4 }}><Tag tone="b">{lineLabel(l)}</Tag></span>)}</td>
      <td className="v2-small">{last ? [last.year, last.service, last.price && (/^\d/.test(last.price) ? `$${last.price}` : last.price)].filter(Boolean).join(' ') : '—'}</td>
      <td>{c.do_not_call && <Tag tone="r">DNC</Tag>} {c.do_not_text && <Tag tone="r">No text</Tag>} {c.call_first && <Tag tone="a">Call first</Tag>}</td>
    </tr>
  );
};

const n0 = (v: number) => v.toLocaleString();
const Chev: React.FC<{ open: boolean }> = ({ open }) => open ? <ChevronDown size={15} /> : <ChevronRight size={15} />;

/** Cities › route maps › routes, each opening to the next; a route opens to its clients. */
const ClientTree: React.FC<{ cities: TreeCity[]; service: string; onOpen: (c: Client) => void }> = ({ cities, service, onOpen }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (k: string) => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (!cities.length) return <div className="v2-card v2-mut" style={{ textAlign: 'center', padding: 24 }}>No clients{service ? ` with ${lineLabel(service)} history` : ' yet'}.</div>;
  return (
    <>
      <div className="v2-row" style={{ marginBottom: 8 }}>
        <span className="v2-mut v2-small">{cities.length} cit{cities.length === 1 ? 'y' : 'ies'} · {n0(cities.reduce((a, c) => a + c.areas.length, 0))} route maps · {n0(cities.reduce((a, c) => a + c.areas.reduce((b, x) => b + x.routes.length, 0), 0))} routes</span>
        <span className="v2-spacer" />
        <Btn size="sm" kind="o" onClick={() => setOpen(new Set(cities.map(c => `c|${c.city}`)))}>Open all cities</Btn>
        <Btn size="sm" kind="o" onClick={() => setOpen(new Set())}>Close all</Btn>
      </div>
      <div className="v2-card v2-tree" style={{ padding: 0 }}>
        {cities.map(c => {
          const ck = `c|${c.city}`; const cOpen = open.has(ck);
          return (
            <div key={ck} className="v2-tree-city">
              <button type="button" className="v2-tree-row l0" onClick={() => flip(ck)} aria-expanded={cOpen}>
                <Chev open={cOpen} /><b>{c.city || 'No city'}</b>
                <span className="v2-mut v2-small">{c.areas.length} route map{c.areas.length === 1 ? '' : 's'}{c.noRoute ? ` · ${n0(c.noRoute)} without a route` : ''}</span>
                <span className="v2-spacer" /><span className="v2-tree-n">{n0(c.n)}</span>
              </button>
              {cOpen && <>
                {c.areas.map(a => {
                  const ak = `a|${c.city}|${a.name ?? ''}`; const aOpen = open.has(ak);
                  return (
                    <div key={ak}>
                      <button type="button" className="v2-tree-row l1" onClick={() => flip(ak)} aria-expanded={aOpen}>
                        <Chev open={aOpen} /><b>{a.name || 'Routes without a map'}</b>{a.name && <RegionTag r={(a.region as Region) || null} />}
                        <span className="v2-mut v2-small">{a.routes.length} route{a.routes.length === 1 ? '' : 's'}</span>
                        <span className="v2-spacer" /><span className="v2-tree-n">{n0(a.n)}</span>
                      </button>
                      {aOpen && a.routes.map(r => {
                        const rk = `r|${r.code}`; const rOpen = open.has(rk);
                        return (
                          <div key={rk}>
                            <button type="button" className="v2-tree-row l2" onClick={() => flip(rk)} aria-expanded={rOpen}>
                              <Chev open={rOpen} /><b>{r.code}</b><span className="v2-spacer" /><span className="v2-tree-n">{n0(r.n)}</span>
                            </button>
                            {rOpen && <TreeClients route={r.code} service={service} onOpen={onOpen} total={r.n} />}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {c.noRoute > 0 && (() => {
                  const nk = `n|${c.city}`; const nOpen = open.has(nk);
                  return (
                    <div>
                      <button type="button" className="v2-tree-row l1" onClick={() => flip(nk)} aria-expanded={nOpen}>
                        <Chev open={nOpen} /><Tag tone="a">No route</Tag><span className="v2-mut v2-small">needs attention</span>
                        <span className="v2-spacer" /><span className="v2-tree-n">{n0(c.noRoute)}</span>
                      </button>
                      {nOpen && <TreeClients city={c.city} service={service} onOpen={onOpen} total={c.noRoute} />}
                    </div>
                  );
                })()}
              </>}
            </div>
          );
        })}
      </div>
    </>
  );
};

/** One route's clients (or a city's clients without a route), 200 at a time. */
const TreeClients: React.FC<{ route?: string; city?: string; service: string; total: number; onOpen: (c: Client) => void }> = ({ route, city, service, total, onOpen }) => {
  const [pages, setPages] = useState(1);
  const list = useLoad(async () => {
    const out: Client[] = [];
    for (let p = 0; p < pages; p++) out.push(...(await listClients({ route, noRoute: !route, city: route ? undefined : city, service, page: p, pageSize: 200 })).rows);
    return out;
  }, [route, city, service, pages]);
  return (
    <div className="v2-tree-clients">
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div className="v2-table-wrap">
          <table className="v2-table">
            <thead><tr><th>Address</th>{!route && <th>Route</th>}<th>Name</th><th>Phone</th><th>Services</th><th>Last service</th><th>Flags</th></tr></thead>
            <tbody>{(list.data || []).map(c => <ClientRow key={c.id} c={c} onOpen={onOpen} hideRoute={!!route} />)}</tbody>
          </table>
          {(list.data || []).length < total && <div style={{ padding: 8 }}><Btn size="sm" kind="o" disabled={list.loading} onClick={() => setPages(p => p + 1)}>
            {list.loading ? 'Loading…' : `Show more (${n0(total - (list.data || []).length)} more)`}</Btn></div>}
        </div>
      )}
    </div>
  );
};

const ClientCard: React.FC<{ c: Client; onClose: () => void }> = ({ c, onClose }) => (
  <Modal title={`${c.house_no} ${c.street_name}${c.unit ? ` Unit ${c.unit}` : ''}`} onClose={onClose} wide>
    <div className="v2-mut" style={{ marginTop: -6, marginBottom: 12 }}>
      {[c.city, c.province, c.postal_code].filter(Boolean).join(', ')}
      {c.route_code ? <> · route <b style={{ color: '#111827' }}>{c.route_code}</b>{c.match_how && ` (${HOW[c.match_how] || c.match_how})`}</> : ' · no route yet'}
    </div>
    <div className="v2-row" style={{ marginBottom: 12, gap: 6 }}>
      {c.do_not_call && <Tag tone="r">Do not call</Tag>}{c.do_not_text && <Tag tone="r">Do not text</Tag>}
      {c.tags.map(t => <Tag key={t}>{t}</Tag>)}
    </div>
    <div className="v2-grid2">
      <div>
        <div className="v2-card-h">People</div>
        {c.people.length ? c.people.map((p, i) => <div key={i}>{p.first} {p.last}</div>) : <div className="v2-mut">—</div>}
        <div className="v2-card-h" style={{ marginTop: 14 }}>Phones & email</div>
        {c.phones.map(p => <div key={p}><a className="v2-link" href={`tel:${p}`}>{formatPhone(p)}</a></div>)}
        {c.emails.map(e => <div key={e}><a className="v2-link" href={`mailto:${e}`}>{e}</a></div>)}
        {!c.phones.length && !c.emails.length && <div className="v2-mut">—</div>}
        {c.call_first && <><div className="v2-card-h" style={{ marginTop: 14 }}>Call first</div><div>{c.call_first}</div></>}
        {c.notes && <><div className="v2-card-h" style={{ marginTop: 14 }}>Notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div></>}
      </div>
      <div>
        <div className="v2-card-h">Service history</div>
        {c.history.length ? (
          <table className="v2-table"><thead><tr><th>Year</th><th>Line</th><th>Service</th><th>Price</th><th>Contractor</th><th>Paid</th></tr></thead>
            <tbody>{c.history.map((h, i) => <tr key={i}><td>{h.year || '—'}</td><td>{h.line ? lineLabel(h.line) : '—'}</td><td>{h.service || '—'}</td><td>{h.price ? (/^\d/.test(h.price) ? `$${h.price}` : h.price) : '—'}</td><td>{h.contractor || '—'}</td><td>{h.payment || '—'}</td></tr>)}</tbody>
          </table>
        ) : <div className="v2-mut">No history yet.</div>}
      </div>
    </div>
  </Modal>
);
