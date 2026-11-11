// src/v2/features/admin/AiLog.tsx — Super Admin › Bug log › AI logs: every question asked to the Benny on a day (Toronto
// time), newest first: who asked, what it answered, the tools it used (in order, and on which model), and roughly what
// it cost. Each person's count and cost for the day, and the last 30 days', sit on top. Saved by benny-assist
// (benny_ai_log); the cost is worked out there from the tokens and the models' prices, in US dollars.
import React, { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { listAiLog, roughCost, toolCounts, toolSteps, type AiLogRow } from '../../lib/benny';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';

const TZ = 'America/Toronto';
const todayHere = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const secs = (ms?: number) => (ms == null ? '' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
const tool = (name: string) => name.replace(/_/g, ' ');

const Row: React.FC<{ r: AiLogRow; open: boolean; onToggle: () => void }> = ({ r, open, onToggle }) => {
  const counts = toolCounts(r.tools);
  const line = (label: string, value: React.ReactNode) => value ? <div className="v2-bug-row"><span className="v2-mut">{label}</span><div>{value}</div></div> : null;
  return (
    <div className={`v2-bug${open ? ' on' : ''}`}>
      <div className="v2-bug-h">
        <button type="button" className="v2-bug-t" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span><b>{r.question || '(no question)'}</b>
            <span className="v2-mut v2-small">{[time(r.at), r.name, r.center].filter(Boolean).join(' · ')}</span>
            {counts.length > 0 && (
              <span className="v2-ai-tools">{counts.map(c => (
                <span key={c.name} className={`v2-ai-tool${c.failed ? ' bad' : ''}`}>{tool(c.name)}{c.n > 1 ? ` ×${c.n}` : ''}</span>
              ))}</span>
            )}
          </span>
        </button>
        {r.error && <Tag tone="r">failed</Tag>}
        {r.card && <Tag tone="b">{tool(r.card)} card</Tag>}
        {r.spoken && <Tag>spoken</Tag>}
        {r.answered_by === 'fast' && <Tag tone="g">small model</Tag>}
        <span className="v2-ai-cost" title="Roughly, in US dollars">{roughCost(r.cost)}<span className="v2-mut v2-small">{secs(r.ms)}</span></span>
      </div>
      {open && (
        <div className="v2-bug-detail">
          {line('The Benny said', r.reply ? <div className="v2-ai-reply">{r.reply}</div> : null)}
          {line('Went wrong', r.error)}
          {line('Tools, in order', r.tools?.length ? (
            <ol className="v2-ai-steps">{toolSteps(r.tools).map((t, i) => (
              <li key={i}>{tool(t.name)}{t.n > 1 ? ` ×${t.n}` : ''}<span className="v2-mut"> · {t.model === 'fast' ? 'small model' : 'main model'}{t.ok === false ? ' · failed' : ''}{t.ms != null ? ` · ${secs(t.ms)}` : ''}</span></li>
            ))}</ol>
          ) : 'none')}
          {line('Main model because', r.why)}
          {line('Screen', r.path)}
        </div>
      )}
    </div>
  );
};

export const AiLog: React.FC = () => {
  const today = todayHere();
  const [day, setDay] = useState(today);
  const [who, setWho] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const log = useLoad(() => listAiLog(day, who), [day, who]);
  const d = log.data;
  const rows = d?.rows || [];
  const go = (next: string) => { setDay(next); setWho(null); setOpenId(null); };
  return (
    <>
      <div className="v2-ai-bar">
        <Btn kind="o" size="sm" icon={ChevronLeft} onClick={() => go(shiftDay(day, -1))} aria-label="Day before" />
        <b>{day === today ? `Today · ${dayLabel(day)}` : dayLabel(day)}</b>
        <Btn kind="o" size="sm" icon={ChevronRight} disabled={day >= today} onClick={() => go(shiftDay(day, 1))} aria-label="Next day" />
        <span className="v2-spacer" />
        <Btn kind="o" size="sm" icon={RotateCw} onClick={log.reload}>Refresh</Btn>
      </div>
      <ErrorBox error={log.error} />
      {d && (
        <div className="v2-card v2-ai-sum">
          <div><b>{d.totals.questions}</b> question{d.totals.questions === 1 ? '' : 's'} · <b>{d.totals.tools}</b> tool call{d.totals.tools === 1 ? '' : 's'}
            {' · '}about <b>{roughCost(d.totals.cost)}</b>{d.totals.errors ? <> · <span className="v2-ai-bad">{d.totals.errors} failed</span></> : null}</div>
          <div className="v2-mut v2-small">Last 30 days: {d.last30.questions} questions, about {roughCost(d.last30.cost)}. Costs are rough, in US dollars, from the tokens each question used.</div>
          {d.people.length > 0 && (
            <div className="v2-ai-people">
              <button type="button" className={`v2-ai-person${who === null ? ' on' : ''}`} onClick={() => { setWho(null); setOpenId(null); }}>Everyone</button>
              {d.people.map(p => (
                <button type="button" key={p.user_id || p.name} className={`v2-ai-person${who === p.user_id ? ' on' : ''}`}
                  onClick={() => { setWho(who === p.user_id ? null : p.user_id); setOpenId(null); }}>
                  {p.name} <span className="v2-mut">{p.questions} · {roughCost(p.cost)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {log.loading && !d ? <Loading /> : rows.length === 0 ? (
        <div className="v2-card">{day === today ? 'No questions to the Benny yet today.' : 'No questions to the Benny that day.'}</div>
      ) : (
        <div className="v2-card" style={{ padding: 0 }}>
          {rows.map(r => <Row key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />)}
        </div>
      )}
    </>
  );
};
