// /money/accounts — the accounts: connected banks (Plaid) and the ones the CSVs come from. Each has a nickname (the
// bank link never changes it) and a colour, the line down the side of its transactions. Archiving hides one and keeps
// everything; deleting (asked twice, in the sheet) takes it and its transactions out for good: ../accounts.ts.
// /plaid-oauth lands here too, to finish a bank's own sign-in page.
import { useState } from 'react';
import { Landmark, Link2, Plus, Archive, ArchiveRestore, Check, Trash2, Wallet } from 'lucide-react';
import { Page, Header, Card, Button, Field, Input, Sheet, Empty, useToast, uid } from '../../../ui/primitives';
import { useMoney } from '../useMoney';
import { loadMonths, money, saveAccount } from '../lib';
import { ACCOUNT_COLORS, accountColor, colorName } from '../accountColor';
import { deleteAccount, isBankLinked, isCashWallet, rowsOf } from '../accounts';
import type { Account, AccountType } from '../types';
import { ConnectedBanks } from './Banks';

const blank = (order: number): Account => ({ id: uid(), name: '', type: 'chequing', order });
const txns = (n: number) => `${n.toLocaleString('en-CA')} transaction${n === 1 ? '' : 's'}`;

export function Accounts({ resume }: { resume?: boolean } = {}) {
  const { accounts, loading, reload } = useMoney('0000', '0000');
  const [edit, setEdit] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  // the "delete?" step in the sheet: whose it is and how many rows it has (null while they're counted)
  const [del, setDel] = useState<{ id: string; n: number | null } | null>(null);
  const [step, setStep] = useState('');
  const [banks, setBanks] = useState(0);   // bumped to load the connected banks again after a connected account is deleted
  const [toast, say] = useToast();
  const live = accounts.filter(a => !a.archived), gone = accounts.filter(a => a.archived);
  const saved = edit ? accounts.find(a => a.id === edit.id) : undefined;   // the account as stored (none for a new one)
  const asking = saved && del?.id === saved.id ? del : null;
  const open = (a: Account) => { setDel(null); setEdit(a); };
  const close = () => { if (busy) return; setEdit(null); setDel(null); };

  async function save(a: Account) {
    if (!a.name.trim()) return;
    setBusy(true);
    try { await saveAccount({ ...a, name: a.name.trim(), last4: a.last4?.replace(/\D/g, '').slice(-4) || undefined }); await reload(); setEdit(null); say('Saved', 'good'); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }

  /** Count its rows in the months as stored (not the screen's: those leave out a connected account's CSV rows). */
  async function askDelete(a: Account) {
    setDel({ id: a.id, n: null });
    try { const n = rowsOf(await loadMonths(), a.id); setDel(d => (d?.id === a.id ? { id: a.id, n } : d)); }
    catch (e) { setDel(d => (d?.id === a.id ? null : d)); say(e instanceof Error ? e.message : 'Could not count its transactions', 'bad'); }
  }
  async function remove(a: Account) {
    setBusy(true); setStep('');
    try {
      const r = await deleteAccount(a, s => setStep(s === 'bank' ? 'Stopping it coming in from the bank…' : 'Taking out its transactions…'));
      if (isBankLinked(a)) setBanks(n => n + 1);
      await reload(); setEdit(null); setDel(null);
      say(`Deleted ${a.name} · ${txns(r.removed)} removed`, 'good');
    } catch (e) { say(e instanceof Error ? e.message : 'Could not delete', 'bad'); }
    finally { setBusy(false); setStep(''); }
  }

  const row = (a: Account) => (
    <button key={a.id} type="button" className="mo-acct" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => open({ ...a })}>
      <div className="mo-acct__icon">{a.plaid && !a.plaid.removedAt ? <Link2 /> : a.type === 'cash' ? <Wallet /> : <Landmark />}</div>
      <div className="pl-grow"><b><span className="mo-dot mo-acct__dot" style={{ background: accountColor(a, accounts) }} aria-hidden />{a.name}</b><br /><small className="pl-muted">{a.type === 'cash' ? `cash wallet${a.cashSince ? ` · counting from ${a.cashSince}` : ''}` : a.type}{a.last4 ? ` ····${a.last4}` : ''}{a.plaid && !a.plaid.removedAt ? ` · connected${a.plaid.institution ? ` to ${a.plaid.institution}` : ''}` : ''}{a.balanceAsOf ? ` · balance as of ${a.balanceAsOf}` : ''}</small></div>
      <span className="mo-amt">{a.balance === undefined ? '—' : money(a.balance)}</span>
    </button>
  );

  return (
    <Page>
      <Header title="Accounts" eyebrow="Money" back="/money" right={<Button small primary onClick={() => open(blank(accounts.length))}><Plus style={{ width: 16, height: 16 }} /> Add</Button>} />
      <ConnectedBanks key={banks} onChange={reload} resume={resume && banks === 0} />
      <Card>
        {!loading && live.length === 0 ? <Empty icon={<Landmark />} title="No accounts yet" blurb="Connect a bank above, add one here, or it's created on your first import." /> : <div className="pl-list">{live.map(row)}</div>}
      </Card>
      {gone.length > 0 && <Card><p className="pl-eyebrow">Archived</p><div className="pl-list">{gone.map(row)}</div></Card>}

      <Sheet open={!!edit} onClose={close} title={asking ? 'Delete account' : saved ? 'Edit account' : 'New account'}>
        {edit && asking && saved ? (
          asking.n === null ? <p className="pl-muted" style={{ fontSize: 14 }}>Counting its transactions…</p> : (
            <>
              <p style={{ fontSize: 15 }}><b>Delete {saved.name}{asking.n > 0 ? ` and its ${txns(asking.n)}` : ''}?</b> This can’t be undone.</p>
              {isBankLinked(saved) && <p style={{ fontSize: 14 }}>It will also stop coming in from the bank.</p>}
              <p className="pl-muted" style={{ fontSize: 14 }}>Archive hides it and keeps everything.</p>
              <Button block disabled={busy} onClick={() => setDel(null)}>Keep it</Button>
              <Button block danger disabled={busy} onClick={() => void remove(saved)}>{busy ? 'Deleting…' : asking.n > 0 ? `Delete ${txns(asking.n)} and the account` : 'Delete the account'}</Button>
              {busy && step && <p className="pl-muted" role="status" style={{ fontSize: 13, textAlign: 'center' }}>{step}</p>}
            </>
          )
        ) : edit && (
          <>
            <Field label="Nickname" hint="Shown everywhere in the planner. The bank link keeps working whatever you call it.">
              <Input autoFocus value={edit.name} maxLength={60} placeholder="e.g. TD Chequing" onChange={e => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <div className="pl-grid-2">
              <Field label="Type">
                <select className="pl-input" value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as AccountType })}>
                  <option value="chequing">Chequing</option><option value="savings">Savings</option><option value="credit">Credit card</option>
                  {edit.type === 'cash' && <option value="cash">Cash wallet</option>}
                </select>
              </Field>
              {edit.type === 'cash' ? (
                <Field label="Counting cash from" hint="ATM withdrawals from this day on move cash into the wallet instead of counting as spending">
                  <Input type="date" value={edit.cashSince || ''} onChange={e => setEdit({ ...edit, cashSince: e.target.value || undefined })} />
                </Field>
              ) : (
                <Field label="Last 4 digits"><Input inputMode="numeric" maxLength={4} value={edit.last4 || ''} onChange={e => setEdit({ ...edit, last4: e.target.value.replace(/\D/g, '') })} /></Field>
              )}
            </div>
            <div className="pl-field">
              <span className="pl-label">Colour</span>
              <div className="mo-swatches" role="group" aria-label="Colour">
                {ACCOUNT_COLORS.map(c => {
                  const on = accountColor(edit, accounts) === c;
                  return <button key={c} type="button" className={`mo-swatch ${on ? 'is-on' : ''}`} style={{ background: c }} aria-label={colorName(c)} aria-pressed={on} onClick={() => setEdit({ ...edit, color: c })}>{on && <Check aria-hidden />}</button>;
                })}
              </div>
              <span className="pl-hint">Its transactions get a line in this colour down their left side.</span>
            </div>
            <Button primary block disabled={busy || !edit.name.trim()} onClick={() => void save(edit)}>{busy ? 'Saving…' : 'Save'}</Button>
            {saved && (
              <Button block ghost disabled={busy} onClick={() => void save({ ...edit, archived: !edit.archived })}>
                {edit.archived ? <><ArchiveRestore style={{ width: 18, height: 18 }} /> Restore</> : <><Archive style={{ width: 18, height: 18 }} /> Archive (keeps its transactions)</>}
              </Button>
            )}
            {saved && !isCashWallet(saved) && (
              <Button block ghost danger disabled={busy} onClick={() => void askDelete(saved)}><Trash2 style={{ width: 18, height: 18 }} /> Delete account…</Button>
            )}
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
