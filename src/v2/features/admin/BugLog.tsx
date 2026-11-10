// src/v2/features/admin/BugLog.tsx — Super Admin › Bug log: what people told the Benny, newest first.
//   Bugs: something in the app is broken (what happened, the steps, the screen, the browser, the page's recent errors).
//   Couldn't do yet: something they asked the Benny for that it has no tool for, so it's clear what to build next.
// Mark one done when it's dealt with; it moves to Done and can be reopened.
import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { listBugs, resolveBug, type BugReport } from '../../lib/benny';
import { Btn, ErrorBox, Loading, Tabs, Tag } from '../../ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TONE: Record<string, 'r' | 'a' | undefined> = { blocking: 'r', annoying: 'a', minor: undefined };
type Tab = 'bugs' | 'requests' | 'done';
const isRequest = (b: BugReport) => b.kind === 'request';

const Detail: React.FC<{ b: BugReport }> = ({ b }) => {
  const r = b.report || {};
  const row = (label: string, value: React.ReactNode) => value ? <div className="v2-bug-row"><span className="v2-mut">{label}</span><div>{value}</div></div> : null;
  const where = [r.where, b.path && `screen ${b.path}`, r.rm_manager && `RM map for ${r.rm_manager.replace(/^rm_/, '')}`].filter(Boolean).join(' · ');
  return (
    <div className="v2-bug-detail">
      {isRequest(b) ? <>
        {row('They asked', r.asked ? `“${r.asked}”${r.spoken ? ' (spoken)' : ''}` : null)}
        {row('What’s missing', r.why_not)}
        {row('Would need', r.would_need)}
        {row('The Benny said', r.reply)}
        {row('Where', where)}
        {r.auto && row('Note', 'Logged automatically: the Benny said it couldn’t, without filing it.')}
      </> : <>
        {row('What happened', r.what_happened)}
        {row('Expected', r.expected)}
        {row('Steps', r.steps?.length ? <ol>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null)}
        {row('Where', where)}
        {row('Browser', [r.diag?.ua, r.diag?.viewport, r.diag?.build && `build ${r.diag.build}`].filter(Boolean).join(' · '))}
        {row('Errors on the page', r.diag?.errors?.length ? <pre>{r.diag.errors.join('\n')}</pre> : null)}
      </>}
      {b.status === 'done' && row('Done', `${b.resolved_at ? when(b.resolved_at) : ''}${b.resolved_by ? ` by ${b.resolved_by}` : ''}`)}
    </div>
  );
};

export const BugLog: React.FC = () => {
  const [tab, setTab] = useState<Tab>('bugs');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const status = tab === 'done' ? 'done' : 'open';
  const log = useLoad(() => listBugs(status), [status]);
  const set = async (b: BugReport, done: boolean) => {
    setBusy(b.id); setError(null);
    try { await resolveBug(b.id, done); log.reload(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const all = log.data?.bugs || [];
  const bugs = tab === 'done' ? all : all.filter(b => (tab === 'requests') === isRequest(b));
  const empty = tab === 'bugs' ? 'No open bug reports. When someone tells the Benny something is broken, it shows up here.'
    : tab === 'requests' ? 'Nothing here yet. When someone asks the Benny for something it has no tool for, it shows up here.' : 'Nothing marked done yet.';
  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Bug log</span>
        <span className="v2-spacer" /><span className="v2-mut v2-small">What people told the Benny: what’s broken, and what it couldn’t do for them yet</span></div>
      <Tabs items={[{ key: 'bugs', label: 'Bugs', count: log.data?.open_bugs }, { key: 'requests', label: 'Couldn’t do yet', count: log.data?.open_requests }, { key: 'done', label: 'Done', count: log.data?.done }]}
        value={tab} onChange={t => { setTab(t); setOpenId(null); }} />
      <ErrorBox error={log.error || error} />
      {log.loading && !log.data ? <Loading /> : bugs.length === 0 ? <div className="v2-card">{empty}</div> : (
        <div className="v2-card" style={{ padding: 0 }}>
          {bugs.map(b => {
            const isOpen = openId === b.id;
            return (
              <div key={b.id} className={`v2-bug${isOpen ? ' on' : ''}`}>
                <div className="v2-bug-h">
                  <button type="button" className="v2-bug-t" onClick={() => setOpenId(isOpen ? null : b.id)} aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span><b>{b.title}</b>
                      <span className="v2-mut v2-small">{[b.by, b.center, when(b.created_at)].filter(Boolean).join(' · ')}</span></span>
                  </button>
                  {tab === 'done' && <Tag tone={isRequest(b) ? 'b' : undefined}>{isRequest(b) ? 'asked for' : 'bug'}</Tag>}
                  {b.report?.severity && <Tag tone={TONE[b.report.severity]}>{b.report.severity}</Tag>}
                  {b.status === 'open'
                    ? <Btn kind="o" size="sm" icon={Check} disabled={busy === b.id} onClick={() => void set(b, true)}>{isRequest(b) ? 'Mark done' : 'Mark fixed'}</Btn>
                    : <Btn kind="o" size="sm" icon={RotateCcw} disabled={busy === b.id} onClick={() => void set(b, false)}>Reopen</Btn>}
                </div>
                {isOpen && <Detail b={b} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
