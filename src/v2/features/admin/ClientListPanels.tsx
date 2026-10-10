// src/v2/features/admin/ClientListPanels.tsx — the safety panels of Client lists:
//   ChecksCard     what must be right before an import (a STOP blocks it; there is no override)
//   PreviewPanel   exactly what saving will change, worked out by the server
//   HealthCard     the nightly data-health report and its fixes
//   LessonsCard    The Benny's lessons: what the office confirmed it should remember
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, BookOpen, HeartPulse, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ImportCheck } from '../../lib/clientImport';
import { lineLabel } from '../../lib/clientImport';
import {
  checkHealthNow, latestHealth, listLessons, rebuildRoutes, saveLesson,
  type Health, type ImportPreview, type Lesson,
} from '../../lib/clients';
import { Btn, Loading, Tag } from '../../ui';

const LEVEL = {
  stop: { icon: Ban, color: 'var(--rose)', label: 'Stop' },
  warn: { icon: AlertTriangle, color: 'var(--amber)', label: 'Check' },
  info: { icon: Info, color: 'var(--slate, #475569)', label: '' },
} as const;

export const ChecksCard: React.FC<{ checks: ImportCheck[]; onAuditAgain?: () => void; compact?: boolean }> = ({ checks, onAuditAgain, compact }) => {
  const stops = checks.filter(c => c.level === 'stop');
  const order = [...stops, ...checks.filter(c => c.level === 'warn'), ...checks.filter(c => c.level === 'info')];
  const shown = compact ? order.filter(c => c.level !== 'info') : order;
  if (!shown.length && compact) return null;
  return (
    <section className="v2-card" aria-label="Import checks" style={{ borderColor: stops.length ? 'var(--rose)' : undefined }}>
      <div className="v2-card-h" style={{ gap: 6 }}>
        {stops.length ? <Ban size={14} color="var(--rose)" /> : <ShieldCheck size={14} color="var(--green)" />}
        {stops.length ? `Can't import yet: ${stops.length === 1 ? 'one thing' : `${stops.length} things`} to fix` : 'Checks'}
        <span className="v2-spacer" />
        {onAuditAgain && checks.some(c => /couldn't double-check/.test(c.text)) && <Btn size="sm" kind="o" onClick={onAuditAgain}>Ask The Benny again</Btn>}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((c, k) => {
          const L = LEVEL[c.level]; const Icon = L.icon;
          return (
            <li key={k} className="v2-small" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', color: c.level === 'info' ? 'var(--muted, #64748b)' : 'var(--ink)' }}>
              <Icon size={14} color={L.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{L.label && <b style={{ color: L.color }}>{L.label}: </b>}{c.text}</span>
            </li>
          );
        })}
      </ul>
      {stops.length > 0 && <div className="v2-note" style={{ marginBottom: 0 }}>Fix the layout (or the file) and the checks run again. An import with a stop can't be saved.</div>}
    </section>
  );
};

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
const lineYear = (k: string) => { const [l, y] = k.split('|'); return { line: l === '—' ? 'No service' : lineLabel(l), year: y }; };
const describe = (j: unknown) => {
  const h = (j || {}) as Record<string, unknown>;
  return [h.year, h.service, h.price && `$${h.price}`, h.date, h.contractor && `by ${h.contractor}`].filter(Boolean).join(' · ');
};

export const PreviewPanel: React.FC<{ preview: ImportPreview; rows: number; busy: boolean; progress: string | null; onSave: () => void; onCancel: () => void }> =
  ({ preview: p, rows, busy, progress, onSave, onCancel }) => {
    const added = Object.entries(p.jobs_added).sort((a, b) => a[0].localeCompare(b[0]));
    const filled = Object.entries(p.jobs_filled).sort((a, b) => a[0].localeCompare(b[0]));
    const totalAdded = added.reduce((t, [, n]) => t + n, 0);
    return (
      <section className="v2-card" aria-label="What saving will change" style={{ borderColor: 'var(--green)' }}>
        <div className="v2-card-h"><ShieldCheck size={14} color="var(--green)" /> Exactly what saving will change</div>
        <p className="v2-small v2-mut" style={{ marginTop: 0 }}>Worked out by saving the {rows.toLocaleString()} rows and rolling it back, so this is what will happen. Nothing is saved until you press Save.
          {rows > 300 && ' (Worked out 300 rows at a time: a customer listed twice under two spellings far apart in the list can be counted twice.)'}</p>
        <div className="v2-grid4">
          {[['New customers', p.inserted], ['Existing customers updated', p.merged - p.nothing_new], ['Already had everything', p.nothing_new], ['Jobs added', totalAdded]].map(([l, n]) => (
            <div key={String(l)} className="v2-card" style={{ padding: 10 }}><div className="v2-card-h">{l}</div><div className="v2-kpi">{Number(n).toLocaleString()}</div></div>
          ))}
        </div>
        <div className="v2-grid2" style={{ marginTop: 10, alignItems: 'start' }}>
          <div>
            <b className="v2-small">Jobs added, by service and year</b>
            <table className="v2-table" style={{ marginTop: 4 }}><tbody>
              {added.map(([k, n]) => { const x = lineYear(k); return <tr key={k}><td>{x.line}</td><td><b>{x.year}</b></td><td style={{ textAlign: 'right' }}>{n.toLocaleString()}</td></tr>; })}
              {added.length === 0 && <tr><td className="v2-mut">None</td></tr>}
            </tbody></table>
            {filled.length > 0 && <>
              <b className="v2-small" style={{ display: 'block', marginTop: 8 }}>Saved jobs that get missing details filled in</b>
              <table className="v2-table" style={{ marginTop: 4 }}><tbody>
                {filled.map(([k, n]) => { const x = lineYear(k); return <tr key={k}><td>{x.line}</td><td><b>{x.year}</b></td><td style={{ textAlign: 'right' }}>{n.toLocaleString()}</td></tr>; })}
              </tbody></table></>}
            <div className="v2-small v2-mut" style={{ marginTop: 6 }}>
              {[p.phones_added && plural(p.phones_added, 'phone number') + ' added', p.people_added && plural(p.people_added, 'name') + ' added',
                p.routes_set && plural(p.routes_set, 'customer') + ' placed on a route'].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div>
            <b className="v2-small">Examples from existing customers</b>
            <ul className="v2-small" style={{ margin: '4px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {p.examples.map((e, k) => (
                <li key={k}><b>{e.address}</b>{e.city && `, ${e.city}`}
                  {(e.added || []).map((j, i) => <div key={`a${i}`} style={{ color: 'var(--green)' }}>+ {describe(j)}</div>)}
                  {(e.filled || []).map((f, i) => <div key={`f${i}`} className="v2-mut">fills in {describe(f.now)}</div>)}
                </li>
              ))}
              {p.examples.length === 0 && <li className="v2-mut">No existing customers change.</li>}
            </ul>
          </div>
        </div>
        <div className="v2-row" style={{ marginTop: 12 }}>
          <span className="v2-small v2-mut">Undo removes only what this import adds, even after later changes.</span>
          <span className="v2-spacer" />
          <Btn kind="o" disabled={busy} onClick={onCancel}>Don't save</Btn>
          <Btn kind="g" disabled={busy} onClick={onSave}>{busy && progress ? progress : 'Save these changes'}</Btn>
        </div>
      </section>
    );
  };

// ───────────── data health ─────────────
export const HealthCard: React.FC = () => {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<'bad' | 'dup' | null>(null);
  const load = () => latestHealth().then(x => { setH(x); setErr(null); }).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  // a check asked for runs on the server within a minute
  useEffect(() => {
    if (!h?.pending_since) return;
    const t = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(t);
  }, [h?.pending_since]);
  const r = h?.report;
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  return (
    <section className="v2-card" aria-label="Data health">
      <div className="v2-card-h"><HeartPulse size={14} /> Data health<span className="v2-spacer" />
        {h?.pending_since ? <span className="v2-small v2-mut">Checking… (about a minute)</span>
          : <Btn size="sm" kind="o" icon={RefreshCw} disabled={!!busy} onClick={() => run('Asking…', async () => { setH(await checkHealthNow()); })}>Check now</Btn>}
      </div>
      {err && <div className="v2-small" style={{ color: 'var(--rose)' }}>{err}</div>}
      {!h && !err && <Loading />}
      {h && !r && !h.pending_since && <div className="v2-small v2-mut">No check has run yet. It runs every night at 3:15.</div>}
      {r && (
        <div className="v2-stack" style={{ gap: 8 }}>
          <div className="v2-small v2-mut">Checked {h!.ran_at ? new Date(h!.ran_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''} · {r.clients.toLocaleString()} customers, {r.jobs.toLocaleString()} jobs</div>
          <div className="v2-row" style={{ gap: 8 }}>
            {r.bad_jobs.count === 0 ? <Tag tone="g">No impossible years or dates</Tag>
              : <button type="button" className="v2-chip" onClick={() => setOpen(open === 'bad' ? null : 'bad')}><Tag tone="r">{r.bad_jobs.count.toLocaleString()} jobs with an impossible year or date</Tag></button>}
            {r.duplicate_jobs.count === 0 ? <Tag tone="g">No job saved twice</Tag>
              : <button type="button" className="v2-chip" onClick={() => setOpen(open === 'dup' ? null : 'dup')}><Tag tone="a">{r.duplicate_jobs.count.toLocaleString()} jobs that look saved twice</Tag></button>}
            {r.routes_behind.count === 0 ? <Tag tone="g">Every route's map list is up to date</Tag> : <Tag tone="a">{r.routes_behind.count.toLocaleString()} routes' map lists are behind</Tag>}
          </div>
          {r.routes_behind.count > 0 && (
            <div className="v2-row" style={{ gap: 8 }}>
              <span className="v2-small v2-mut">{r.routes_behind.routes.slice(0, 12).join(', ')}{r.routes_behind.routes.length > 12 ? '…' : ''}</span>
              <span className="v2-spacer" />
              <Btn size="sm" disabled={!!busy} onClick={() => run('Rebuilding…', async () => {
                await rebuildRoutes(r.routes_behind.routes, n => setBusy(`Rebuilding… ${n} of ${r.routes_behind.routes.length}`));
                setH(await checkHealthNow());
              })}>{busy?.startsWith('Rebuilding') ? busy : `Rebuild ${r.routes_behind.count.toLocaleString()} map lists`}</Btn>
            </div>
          )}
          {open && (
            <ul className="v2-small" style={{ margin: 0, paddingLeft: 16, maxHeight: 220, overflow: 'auto' }}>
              {(open === 'bad' ? r.bad_jobs.examples : r.duplicate_jobs.examples).map((x, k) => (
                <li key={k}><Link className="v2-link" to={`/app/clients/c/${x.id}`}>{x.address}{x.city ? `, ${x.city}` : ''}</Link> — {describe(x.job)}
                  {x.why && <span className="v2-mut"> ({x.why})</span>}{x.same_as && <span className="v2-mut"> = {describe(x.same_as)}</span>}</li>
              ))}
              <li className="v2-mut" style={{ listStyle: 'none' }}>Open a customer to fix their jobs.</li>
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

// ───────────── The Benny's lessons ─────────────
export const LessonsCard: React.FC = () => {
  const [list, setList] = useState<Lesson[] | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = () => listLessons().then(setList).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const save = async (p: Parameters<typeof saveLesson>[0]) => { try { await saveLesson(p); setErr(null); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <section className="v2-card" aria-label="The Benny's lessons">
      <div className="v2-card-h"><BookOpen size={14} /> The Benny's lessons</div>
      <p className="v2-small v2-mut" style={{ marginTop: 0 }}>What The Benny has been told to remember. It reads these every time it looks at a file. It suggests new ones in the chat; they're kept only when you save them.</p>
      {err && <div className="v2-small" style={{ color: 'var(--rose)' }}>{err}</div>}
      {!list ? <Loading /> : (
        <table className="v2-table"><tbody>
          {list.map(l => (
            <tr key={l.id} style={{ opacity: l.active ? 1 : 0.55 }}>
              <td><input className="v2-input" style={{ padding: '5px 8px' }} defaultValue={l.text} aria-label="Lesson"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== l.text) void save({ id: l.id, text: v }); }} /></td>
              <td className="v2-small v2-mut" style={{ whiteSpace: 'nowrap' }}>{l.fingerprint ? (l.layout_name || 'One layout') : 'Every list'}</td>
              <td style={{ textAlign: 'right' }}><Btn size="sm" kind="o" onClick={() => void save({ id: l.id, active: !l.active })}>{l.active ? 'Retire' : 'Restore'}</Btn></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td className="v2-mut v2-small">No lessons yet.</td></tr>}
        </tbody></table>
      )}
      <form className="v2-row" style={{ marginTop: 8, flexWrap: 'nowrap' }} onSubmit={e => { e.preventDefault(); const v = draft.trim(); if (v.length >= 3) { void save({ text: v }).then(() => setDraft('')); } }}>
        <input className="v2-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. In aeration callbooks, FO means front only" aria-label="New lesson" />
        <Btn disabled={draft.trim().length < 3} onClick={() => { const v = draft.trim(); void save({ text: v }).then(() => setDraft('')); }}>Add</Btn>
      </form>
    </section>
  );
};
