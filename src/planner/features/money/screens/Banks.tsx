// The "Connected banks" card on Money → Accounts: connect a bank through Plaid, choose which planner
// account each of its accounts fills, sync, reconnect, disconnect. See ../plaid.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw, Unplug, AlertTriangle } from 'lucide-react';
import { Card, Button, Sheet, useToast } from '../../../ui/primitives';
import { isDemo } from '../../../lib/app';
import { listBanks, mapAccounts, openLink, removeBank, resumeLink, syncBanks, syncedLabel, type BankItem, type Exchanged, type LinkOutcome, type SyncResult } from '../plaid';

const kind = (a: { type: string; subtype: string | null }) => a.type === 'credit' ? 'credit card' : a.subtype || a.type;
const syncSummary = (r: SyncResult[]) => {
  const bad = r.find(x => !x.ok);
  if (bad) return { msg: bad.reconnect ? 'The bank needs you to sign in again' : bad.error || 'Sync failed', tone: 'bad' as const };
  const n = r.reduce((s, x) => s + (x.added || 0), 0);
  return { msg: n ? `${n} new transaction${n === 1 ? '' : 's'}` : 'Up to date', tone: 'good' as const };
};

export function ConnectedBanks({ onChange, resume }: { onChange: () => void; resume?: boolean }) {
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [env, setEnv] = useState<'sandbox' | 'production'>('production');
  const [busy, setBusy] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Exchanged | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BankItem | null>(null);
  const [toast, toastSay] = useToast();
  const sayRef = useRef(toastSay); sayRef.current = toastSay;
  const say = useCallback((msg: string, tone?: 'good' | 'bad') => sayRef.current(msg, tone), []);   // stable, so the effects below run once
  const resumed = useRef(false);

  const load = useCallback(async () => {
    try { const r = await listBanks(); setItems(r.items); setEnv(r.env); }
    catch (e) { setItems([]); say(e instanceof Error ? e.message : 'Couldn’t load banks', 'bad'); }
  }, [say]);
  useEffect(() => { if (!isDemo()) void load(); }, [load]);

  const after = useCallback(async (o: LinkOutcome) => {
    if (o.kind === 'new') setMapping(o.exchanged);
    else if (o.kind === 'reconnected') {
      const r = await syncBanks(o.itemId);
      const s = syncSummary(r.results); say(s.tone === 'good' ? `Reconnected · ${s.msg}` : s.msg, s.tone);
      await load(); onChange();
    } else if (o.message) say(o.message, 'bad');
  }, [load, onChange, say]);

  // back from a bank's own sign-in page (/plaid-oauth)
  useEffect(() => {
    if (!resume || resumed.current || isDemo()) return;
    resumed.current = true;
    setBusy('link');
    resumeLink().then(after).catch(e => say(e instanceof Error ? e.message : 'Couldn’t finish connecting', 'bad')).finally(() => setBusy(null));
  }, [resume, after, say]);

  async function connect(itemId?: string) {
    setBusy(itemId || 'link');
    try { await after(await openLink(itemId)); }
    catch (e) { say(e instanceof Error ? e.message : 'Couldn’t open Plaid', 'bad'); }
    finally { setBusy(null); }
  }
  async function sync(itemId?: string) {
    setBusy(itemId || 'sync');
    try { const r = await syncBanks(itemId); const s = syncSummary(r.results); say(s.msg, s.tone); await load(); onChange(); }
    catch (e) { say(e instanceof Error ? e.message : 'Sync failed', 'bad'); }
    finally { setBusy(null); }
  }
  async function remove(it: BankItem) {
    setBusy(it.itemId);
    try { await removeBank(it.itemId); setConfirmRemove(null); say(`${it.institution} disconnected`, 'good'); await load(); onChange(); }
    catch (e) { say(e instanceof Error ? e.message : 'Couldn’t disconnect', 'bad'); }
    finally { setBusy(null); }
  }

  if (isDemo()) return null;
  return (
    <>
      <Card>
        <div className="pl-row" style={{ justifyContent: 'space-between' }}>
          <p className="pl-eyebrow" style={{ margin: 0 }}>Connected banks{env === 'sandbox' ? ' · test mode' : ''}</p>
          {!!items?.length && <Button small ghost disabled={!!busy} onClick={() => void sync()}><RefreshCw style={{ width: 16, height: 16 }} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>}
        </div>
        {items === null ? <p className="pl-muted" style={{ fontSize: 14 }}>Loading…</p> : (
          <div className="pl-list">
            {items.map(it => (
              <div key={it.itemId} className="mo-acct" style={{ alignItems: 'flex-start' }}>
                <div className="mo-acct__icon">{it.status === 'active' ? <Link2 /> : <AlertTriangle style={{ color: 'var(--bad, #c0392b)' }} />}</div>
                <div className="pl-grow">
                  <b>{it.institution}</b><br />
                  <small className="pl-muted">
                    {it.status === 'active' ? syncedLabel(it.lastSyncAt) : it.status === 'login_required' ? 'Sign in again to keep syncing' : `Last sync failed${it.error ? `: ${it.error}` : ''}`}
                    {' · '}{it.accounts.filter(a => a.plannerId).length} of {it.accounts.length} account{it.accounts.length === 1 ? '' : 's'} tracked
                  </small>
                  <div className="pl-row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {it.status !== 'active' && <Button small primary disabled={!!busy} onClick={() => void connect(it.itemId)}>{busy === it.itemId ? 'Opening…' : 'Reconnect'}</Button>}
                    {it.status === 'active' && <Button small ghost disabled={!!busy} onClick={() => void sync(it.itemId)}>{busy === it.itemId ? 'Syncing…' : 'Sync'}</Button>}
                    <Button small ghost disabled={!!busy} onClick={() => setMapping({ itemId: it.itemId, institution: it.institution, accounts: it.accounts.map(a => ({ ...a, suggest: a.plannerId || 'skip' })), plannerAccounts: [] })}>Accounts</Button>
                    <Button small ghost disabled={!!busy} onClick={() => setConfirmRemove(it)}><Unplug style={{ width: 16, height: 16 }} /> Disconnect</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button block primary={!items?.length} disabled={!!busy} onClick={() => void connect()}>
          <Link2 style={{ width: 18, height: 18 }} /> {busy === 'link' ? 'Opening Plaid…' : items?.length ? 'Connect another bank' : 'Connect a bank'}
        </Button>
        <p className="pl-muted" style={{ fontSize: 12, marginBottom: 0 }}>
          You sign in to your bank inside Plaid’s window; the planner never sees your bank password. New transactions come in on their own once they post.
          For a connected account, the bank’s transactions replace its CSV imports (the imports are kept, just hidden).
        </p>
      </Card>

      <MapSheet data={mapping} onClose={() => setMapping(null)} onDone={async (msg, tone) => { setMapping(null); say(msg, tone); await load(); onChange(); }} />

      <Sheet open={!!confirmRemove} onClose={() => setConfirmRemove(null)} title={confirmRemove ? `Disconnect ${confirmRemove.institution}?` : ''}>
        {confirmRemove && (
          <>
            <p style={{ fontSize: 14 }}>Plaid stops reading this bank and the connection is revoked. The transactions already here stay. To bring it back later, connect it again.</p>
            <Button block danger disabled={!!busy} onClick={() => void remove(confirmRemove)}>{busy === confirmRemove.itemId ? 'Disconnecting…' : 'Disconnect'}</Button>
            <Button block ghost onClick={() => setConfirmRemove(null)}>Keep it</Button>
          </>
        )}
      </Sheet>
      {toast}
    </>
  );
}

/** Which planner account each bank account fills: an existing one (same last 4 suggested), a new one, or not tracked. */
function MapSheet({ data, onClose, onDone }: { data: Exchanged | null; onClose: () => void; onDone: (msg: string, tone: 'good' | 'bad') => void }) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [planner, setPlanner] = useState<Exchanged['plannerAccounts']>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setChoice(Object.fromEntries(data.accounts.map(a => [a.plaidId, a.suggest])));
    if (data.plannerAccounts.length) { setPlanner(data.plannerAccounts); return; }
    // opened from "Accounts" on a connected bank: the planner's accounts come from the docs
    import('../lib').then(({ loadAccounts }) => loadAccounts()).then(list => setPlanner(list.filter(a => !a.archived).map(a => ({
      id: a.id, name: a.name, type: a.type, last4: a.last4 || null, linked: !!(a.plaid && !a.plaid.removedAt && a.plaid.itemId !== data.itemId),
    })))).catch(() => setPlanner([]));
  }, [data]);

  if (!data) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const taken = (plaidId: string) => new Set(Object.entries(choice).filter(([k, v]) => k !== plaidId && v !== 'new' && v !== 'skip').map(([, v]) => v));

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      const r = await mapAccounts(data.itemId, choice);
      const s = r.sync;
      if (!s.ok) onDone(s.reconnect ? 'Connected. The bank needs you to sign in again before it syncs.' : `Connected. First sync: ${s.error || 'failed'}; it retries on its own.`, 'bad');
      else onDone(`${r.linked} account${r.linked === 1 ? '' : 's'} connected${s.added ? ` · ${s.added} transactions` : ' · transactions arrive in a few minutes'}`, 'good');
    } catch (e) { onDone(e instanceof Error ? e.message : 'Couldn’t save', 'bad'); }
    finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={busy ? () => undefined : onClose} title={data.institution || 'Your bank'}>
      <p className="pl-muted" style={{ fontSize: 13 }}>Pick where each account’s transactions go. Choosing an account you already import by CSV replaces those imports with the bank’s own (the CSV rows are kept, just hidden).</p>
      {data.accounts.map(a => {
        const used = taken(a.plaidId);
        return (
          <div key={a.plaidId} style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 15 }}>{a.name}{a.mask ? ` ····${a.mask}` : ''}</b> <small className="pl-muted">{kind(a)}</small>
            <select className="pl-input" style={{ marginTop: 4 }} value={choice[a.plaidId] || 'skip'} onChange={e => setChoice({ ...choice, [a.plaidId]: e.target.value })}>
              <option value="new">New account in the planner</option>
              {planner.filter(p => !p.linked && !used.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.last4 ? ` ····${p.last4}` : ''}</option>)}
              <option value="skip">Don’t track this account</option>
            </select>
          </div>
        );
      })}
      <Button primary block disabled={busy} onClick={() => void save()}>{busy ? 'Connecting and syncing…' : 'Save'}</Button>
    </Sheet>
  );
}
