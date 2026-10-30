// /cycle/settings — overrides for the predictions, and removing a period logged by mistake.
import { useEffect, useState, type FormEvent } from 'react';
import { Page, Header, Card, Button, Field, Input, useToast } from '../../ui/primitives';
import { useCycle } from './useCycle';
import { fmtDay } from './dates';
import type { CyclePrefs } from './types';

export function CycleSettings() {
  const c = useCycle();
  const [p, setP] = useState<CyclePrefs>(c.prefs);
  const [saving, setSaving] = useState(false);
  const [toast, say] = useToast();
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => { setP(c.prefs); }, [c.prefs]);
  const num = (v: string) => (v === '' ? undefined : Math.max(1, Number(v) || 0));

  const save = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await c.savePrefs({ ...p, lutealDays: p.lutealDays || 14, fertileBefore: 5, fertileAfter: 1, useLast: p.useLast || 6 }); say('Saved', 'good'); }
    catch { say('Could not save', 'bad'); } finally { setSaving(false); }
  };

  return (
    <Page>
      <Header back="/cycle" eyebrow="Cycle" title="Settings" />
      <form className="pl-card pl-stack" onSubmit={save}>
        <p className="pl-muted" style={{ fontSize: 13 }}>Leave the lengths blank to use your own history (currently ~{c.stats.cycleLength}-day cycles, ~{c.stats.periodLength}-day periods).</p>
        <div className="pl-grid-2">
          <Field label="Cycle length (days)"><Input type="number" inputMode="numeric" min={15} max={90} value={p.cycleLength ?? ''} placeholder="auto" onChange={e => setP({ ...p, cycleLength: num(e.target.value) })} /></Field>
          <Field label="Period length (days)"><Input type="number" inputMode="numeric" min={1} max={14} value={p.periodLength ?? ''} placeholder="auto" onChange={e => setP({ ...p, periodLength: num(e.target.value) })} /></Field>
          <Field label="Luteal phase (days)" hint="ovulation = next period − this"><Input type="number" inputMode="numeric" min={9} max={18} value={p.lutealDays} onChange={e => setP({ ...p, lutealDays: Number(e.target.value) || 14 })} /></Field>
          <Field label="Average over last" hint="cycles"><Input type="number" inputMode="numeric" min={2} max={24} value={p.useLast} onChange={e => setP({ ...p, useLast: Number(e.target.value) || 6 })} /></Field>
        </div>
        <Button primary disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </form>

      <Card className="pl-stack">
        <h3>Remove a period</h3>
        <p className="pl-muted" style={{ fontSize: 13 }}>Logged by mistake? Tap it twice.</p>
        <div className="pl-list">
          {[...c.periods].reverse().slice(0, 24).map(x => (
            <div key={x.start} className="pl-item">
              <div className="pl-grow"><b>{fmtDay(x.start, { day: 'numeric', month: 'short', year: 'numeric' })}</b><small>to {fmtDay(x.end, { day: 'numeric', month: 'short' })}{x.source === 'flo' ? ' · from Flo' : ''}</small></div>
              <Button small danger={confirm === x.start} ghost={confirm !== x.start} onClick={async () => {
                if (confirm !== x.start) { setConfirm(x.start); return; }
                try { await c.removePeriod(x.start); say('Removed'); } catch { say('Could not save', 'bad'); } finally { setConfirm(null); }
              }}>{confirm === x.start ? 'Confirm' : 'Remove'}</Button>
            </div>
          ))}
        </div>
      </Card>
      {toast}
    </Page>
  );
}
