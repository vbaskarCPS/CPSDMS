// /money/accounts — the accounts the CSVs come from. Archiving hides one; nothing is ever removed.
import { useState } from 'react';
import { Landmark, Plus, Archive, ArchiveRestore } from 'lucide-react';
import { Page, Header, Card, Button, Field, Input, Sheet, Empty, useToast, uid } from '../../../ui/primitives';
import { useMoney } from '../useMoney';
import { money, saveAccount } from '../lib';
import type { Account, AccountType } from '../types';

const blank = (order: number): Account => ({ id: uid(), name: '', type: 'chequing', order });

export function Accounts() {
  const { accounts, loading, reload } = useMoney('0000', '0000');
  const [edit, setEdit] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const live = accounts.filter(a => !a.archived), gone = accounts.filter(a => a.archived);

  async function save(a: Account) {
    if (!a.name.trim()) return;
    setBusy(true);
    try { await saveAccount({ ...a, name: a.name.trim(), last4: a.last4?.replace(/\D/g, '').slice(-4) || undefined }); await reload(); setEdit(null); say('Saved', 'good'); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }

  const row = (a: Account) => (
    <button key={a.id} type="button" className="mo-acct" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit({ ...a })}>
      <div className="mo-acct__icon"><Landmark /></div>
      <div className="pl-grow"><b>{a.name}</b><br /><small className="pl-muted">{a.type}{a.last4 ? ` ····${a.last4}` : ''}{a.balanceAsOf ? ` · balance as of ${a.balanceAsOf}` : ''}</small></div>
      <span className="mo-amt">{a.balance === undefined ? '—' : money(a.balance)}</span>
    </button>
  );

  return (
    <Page>
      <Header title="Accounts" eyebrow="Money" back="/money" right={<Button small primary onClick={() => setEdit(blank(accounts.length))}><Plus style={{ width: 16, height: 16 }} /> Add</Button>} />
      <Card>
        {!loading && live.length === 0 ? <Empty icon={<Landmark />} title="No accounts yet" blurb="Add one here, or it's created on your first import." /> : <div className="pl-list">{live.map(row)}</div>}
      </Card>
      {gone.length > 0 && <Card><p className="pl-eyebrow">Archived</p><div className="pl-list">{gone.map(row)}</div></Card>}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit && accounts.some(a => a.id === edit.id) ? 'Edit account' : 'New account'}>
        {edit && (
          <>
            <Field label="Name"><Input autoFocus value={edit.name} placeholder="e.g. TD Chequing" onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="pl-grid-2">
              <Field label="Type">
                <select className="pl-input" value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as AccountType })}>
                  <option value="chequing">Chequing</option><option value="savings">Savings</option><option value="credit">Credit card</option>
                </select>
              </Field>
              <Field label="Last 4 digits"><Input inputMode="numeric" maxLength={4} value={edit.last4 || ''} onChange={e => setEdit({ ...edit, last4: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            <Button primary block disabled={busy || !edit.name.trim()} onClick={() => void save(edit)}>{busy ? 'Saving…' : 'Save'}</Button>
            {accounts.some(a => a.id === edit.id) && (
              <Button block ghost disabled={busy} onClick={() => void save({ ...edit, archived: !edit.archived })}>
                {edit.archived ? <><ArchiveRestore style={{ width: 18, height: 18 }} /> Restore</> : <><Archive style={{ width: 18, height: 18 }} /> Archive (keeps its transactions)</>}
              </Button>
            )}
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
