// src/v2/features/admin/BennyChat.tsx — the chat beside an upload: talk the file through with The
// Benny while it reads it. It answers from the upload (columns, counts, unplaced addresses) and can
// change the layout; each change it makes is listed under its reply.
import React, { useEffect, useRef, useState } from 'react';
import { Check, Send, Sparkles } from 'lucide-react';
import { Btn } from '../../ui';

const tint = (m: ChatMessage) => m.error ? 'var(--rose)' : m.role === 'user' ? 'var(--blue)' : 'var(--violet)';

export interface ChatMessage { role: 'user' | 'assistant'; text: string; changes?: string[]; hidden?: boolean; error?: boolean }

export const BennyChat: React.FC<{
  messages: ChatMessage[];
  busy: boolean;
  disabled?: boolean;
  suggestions?: string[];
  onSend: (text: string) => void;
}> = ({ messages, busy, disabled, suggestions = [], onSend }) => {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const shown = messages.filter(m => !m.hidden);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [shown.length, busy]);
  const send = (t: string) => { const v = t.trim(); if (!v || busy || disabled) return; onSend(v); setDraft(''); };

  return (
    <section className="v2-card" aria-label="Talk to The Benny" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, position: 'sticky', top: 12 }}>
      <div className="v2-row" style={{ gap: 8 }}>
        <Sparkles size={16} color="var(--violet)" />
        <b>Talk to The Benny</b>
        <span className="v2-spacer" />
        <span className="v2-small v2-mut">about this file</span>
      </div>
      <div role="log" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 300px)', minHeight: 160, overflowY: 'auto', paddingRight: 2 }}>
        {shown.length === 0 && <div className="v2-small v2-mut">The Benny is reading the file…</div>}
        {shown.map((m, k) => (
          <div key={k} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
            <div style={{
              whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.45, padding: '8px 11px', borderRadius: 12,
              background: `color-mix(in srgb, ${tint(m)} 9%, var(--card))`,
              border: `1px solid color-mix(in srgb, ${tint(m)} 32%, var(--line))`,
              color: 'var(--ink)',
            }}>{m.text}</div>
            {m.changes && m.changes.length > 0 && (
              <ul aria-label="What The Benny changed" style={{ listStyle: 'none', margin: '5px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {m.changes.map((c, i) => (
                  <li key={i} className="v2-small" style={{ display: 'flex', gap: 5, alignItems: 'flex-start', color: 'var(--green)' }}><Check size={13} style={{ flexShrink: 0, marginTop: 2 }} />{c}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="v2-small v2-mut" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Sparkles size={13} color="var(--violet)" /> The Benny is thinking…</div>}
        <div ref={end} />
      </div>
      {suggestions.length > 0 && !busy && (
        <div className="v2-row" style={{ gap: 6 }}>
          {suggestions.map(s => (
            <button key={s} type="button" className="v2-chip" disabled={disabled} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); send(draft); }} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <textarea className="v2-input" rows={2} value={draft} disabled={disabled} aria-label="Message The Benny"
          placeholder="e.g. “Column H is the 2025 price” or “Leave out the test rows at the bottom”"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          style={{ flex: 1, resize: 'vertical', minHeight: 44 }} />
        <Btn icon={Send} disabled={busy || disabled || !draft.trim()} onClick={() => send(draft)}>Send</Btn>
      </form>
    </section>
  );
};
