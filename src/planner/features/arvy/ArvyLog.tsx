// src/planner/features/arvy/ArvyLog.tsx — Settings › Arvy's log: what Arvy couldn't do, got wrong or was told about
// the planner, and what's being done about each one. Entries are saved by the chat (log.ts); a scheduled check looks
// into new ones and writes back what it found and the fix that's ready for review.
import { useEffect, useState } from 'react';
import { Bug, CircleHelp, Lightbulb, SearchX, ThumbsDown, TriangleAlert, Undo2 } from 'lucide-react';
import { Page, Header, Card, Chip, Empty, Button } from '../../ui/primitives';
import { loadLog, LOG_LABEL, stageOf, type LogEntry, type LogType } from './log';
import { openArvy } from './arvy';
import './arvy.css';

const ICON: Record<LogType, typeof Bug> = { request: CircleHelp, error: TriangleAlert, miss: SearchX, undo: Undo2, feedback: ThumbsDown, bug: Bug, idea: Lightbulb };
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Entry({ e }: { e: LogEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[e.type] || CircleHelp;
  const stage = stageOf(e);
  const f = e.findings;
  return (
    <Card className="arvy-log-entry" onClick={() => setOpen(o => !o)}>
      <div className="arvy-log-top">
        <Icon aria-hidden />
        <div className="pl-grow">
          <b>{e.title}</b>
          <small className="pl-muted">{LOG_LABEL[e.type]} · {when(e.at)}</small>
        </div>
        <span className={`arvy-log-stage ${stage.tone}`}>{stage.label}</span>
      </div>
      {f?.summary && <p className="arvy-log-sum">{f.summary}</p>}
      {open && (
        <div className="arvy-log-more">
          {e.question && <p><span>You asked</span>{e.question}</p>}
          {e.reply && <p><span>Arvy said</span>{e.reply}</p>}
          {e.detail && <p><span>Details</span>{e.detail}</p>}
          {f?.cause && <p><span>Why</span>{f.cause}</p>}
          {f?.fix && <p><span>The fix</span>{f.fix}</p>}
          {f?.needs && <p><span>Needs from you</span>{f.needs}</p>}
          {e.pr && <p><span>Ready for review</span><a href={e.pr} target="_blank" rel="noreferrer" onClick={x => x.stopPropagation()}>{e.pr.replace(/^https?:\/\/github\.com\//, '')}</a></p>}
        </div>)}
    </Card>
  );
}

export function ArvyLog() {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'open' | 'done'>('open');
  useEffect(() => { loadLog().then(setLog).catch(e => setErr(e instanceof Error ? e.message : 'Couldn’t load the log')); }, []);
  const open = (log || []).filter(e => e.status !== 'done');
  const done = (log || []).filter(e => e.status === 'done');
  const list = show === 'open' ? open : done;
  return (
    <Page>
      <Header back="/settings" eyebrow="Settings" title="Arvy’s log" />
      <p className="pl-muted" style={{ fontSize: 14, marginTop: 0 }}>Everything Arvy couldn’t do, got wrong, or that you told it should be better. Each one gets looked into and a fix prepared for review. To add one, just tell Arvy: “the shopping list should sort by aisle”.</p>
      <div className="pl-chips">
        <Chip on={show === 'open'} onClick={() => setShow('open')}>Open · {open.length}</Chip>
        <Chip on={show === 'done'} onClick={() => setShow('done')}>Done · {done.length}</Chip>
      </div>
      {err && <p className="pl-error">{err}</p>}
      {log === null && !err ? <p className="pl-muted">Loading…</p>
        : list.length === 0 ? <Empty icon={<Lightbulb />} title={show === 'open' ? 'Nothing open' : 'Nothing done yet'} blurb={show === 'open' ? 'When Arvy falls short, or you tell it something could be better, it shows up here.' : 'Fixed and shipped entries land here.'} action={show === 'open' ? <Button primary onClick={() => openArvy({ suggest: ['I have an idea for the planner', 'Something isn’t working right'] })}>Tell Arvy something</Button> : undefined} />
        : list.map(e => <Entry key={`${e.at}~${e.id}`} e={e} />)}
    </Page>
  );
}
