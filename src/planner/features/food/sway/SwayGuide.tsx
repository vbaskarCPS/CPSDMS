// src/planner/features/food/sway/SwayGuide.tsx — /food/sway: the two lists, swaps, and the on/off toggle.
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, Header, Page, useToast } from '../../../ui/primitives';
import { EASE, GO, SWAPS, SWAY_NOTE } from './lists';
import { loadSwayPrefs, saveSwayPrefs } from './prefs';

export function SwayGuide() {
  const [on, setOn] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [toast, say] = useToast();
  useEffect(() => { void loadSwayPrefs().then(p => setOn(p.on)); }, []);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try { await saveSwayPrefs({ on: next }); say(next ? 'Sway guide on' : 'Sway guide off', 'good'); } catch { setOn(!next); say('Could not save', 'bad'); }
  };
  const filter = (list: string[]) => (q.trim() ? list.filter(x => x.toLowerCase().includes(q.trim().toLowerCase())) : list);
  const go = useMemo(() => filter(GO), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const ease = useMemo(() => filter(EASE), [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page>
      <Header title="Sway guide" eyebrow="Trying for a girl" back="/food" />
      <Card>
        <div className="pl-stack" style={{ gap: 10 }}>
          <label className="fd-switch"><input type="checkbox" checked={!!on} disabled={on === null} onChange={() => void toggle()} /> Tag my meals against the sway lists</label>
          <p className="pl-muted" style={{ fontSize: 13 }}>{SWAY_NOTE}</p>
        </div>
      </Card>
      <div className="pl-row" style={{ gap: 8 }}>
        <Search style={{ width: 18, height: 18, color: 'var(--ink-2)', flex: 'none' }} />
        <input className="pl-input" placeholder="Search the lists" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Card>
        <p className="pl-eyebrow" style={{ marginBottom: 8 }}><span className="fd-sway fd-sway--go" /> Go for · {go.length}</p>
        <div className="pl-chips">{go.map(x => <span key={x} className="pl-chip fd-chip--static">{x}</span>)}{go.length === 0 && <span className="pl-muted">Nothing matches.</span>}</div>
      </Card>
      <Card>
        <p className="pl-eyebrow" style={{ marginBottom: 8 }}><span className="fd-sway fd-sway--ease" /> Ease off · {ease.length}</p>
        <div className="pl-chips">{ease.map(x => <span key={x} className="pl-chip fd-chip--static">{x}</span>)}{ease.length === 0 && <span className="pl-muted">Nothing matches.</span>}</div>
      </Card>
      <Card>
        <p className="pl-eyebrow" style={{ marginBottom: 8 }}>Easy swaps</p>
        <div className="pl-list">
          {SWAPS.map(s => <div key={s.swap + String(s.match)} className="pl-item" style={{ padding: '8px 0' }}><small className="pl-grow" style={{ color: 'var(--ink)' }}>{String(s.match).replace(/^\/|\/i$/g, '').replace(/\\b/g, '').replace(/\|/g, ' / ').replace(/[()]/g, '')}</small><b style={{ fontSize: 14 }}>→ {s.swap}</b></div>)}
        </div>
      </Card>
      {toast}
    </Page>
  );
}
