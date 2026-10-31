// src/planner/ui/MemoryCard.tsx — Settings: "Tell the coach" — the dated notes every AI call sees.
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { addMemory, loadMemory, saveMemory, type MemoryNote } from '../lib/memory';
import { Button, Card, TextArea } from './primitives';

export function MemoryCard() {
  const [notes, setNotes] = useState<MemoryNote[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadMemory().then(setNotes); }, []);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { setNotes(await addMemory(text)); setText(''); } finally { setBusy(false); }
  };
  const remove = async (i: number) => {
    if (!notes) return;
    const next = notes.filter((_, k) => k !== i);
    setNotes(next); await saveMemory(next);
  };
  return (
    <Card className="pl-stack">
      <h3 style={{ margin: 0 }}><Sparkles size={16} aria-hidden style={{ verticalAlign: -2 }} /> Tell the coach</h3>
      <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>Context the coach keeps: injuries, goals, what's going on this week, how you want to be coached. Every coaching line, session review and day reflection reads these.</p>
      {notes === null ? <p className="pl-muted">Loading…</p> : notes.length === 0 ? <p className="pl-muted" style={{ fontSize: 13 }}>Nothing yet.</p> : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {notes.map((n, i) => (
            <li key={`${n.date}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
              <span className="pl-muted" style={{ flex: 'none', fontSize: 12, marginTop: 2 }}>{n.date.slice(5)}</span>
              <span className="pl-grow">{n.text}</span>
              <button type="button" onClick={() => remove(i)} aria-label="Remove note" style={{ border: 0, background: 'none', color: 'var(--ink-2)', padding: 0 }}>×</button>
            </li>
          ))}
        </ul>
      )}
      <TextArea rows={2} placeholder="e.g. Left shoulder pinches on overhead press — keep it light. Goal: 185 bench by March." value={text} onChange={e => setText(e.target.value)} />
      <Button small primary onClick={add} disabled={busy || !text.trim()}>Add note</Button>
    </Card>
  );
}
