// /money/import — a CSV from the bank → categorized transactions.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Info } from 'lucide-react';
import { Page, Header, Card, Button, Field, Input, Stat, useToast, uid } from '../../../ui/primitives';
import { useMoney } from '../useMoney';
import { importCsv } from '../importers';
import { categorizeAll, mergeTxns, saveAccount, loadMonths } from '../lib';
import type { Account, AccountType, Txn } from '../types';

type Preview = { txns: Txn[]; importer: string; from: string; to: string; counts: Record<string, number>; dupes: number; fileName: string };

export function Import() {
  const nav = useNavigate();
  const { accounts, rules, loading, reload } = useMoney('0000', '0000');   // accounts + rules only; months are loaded per import
  const live = accounts.filter(a => !a.archived);
  const [accountId, setAccountId] = useState('');
  const [newAcc, setNewAcc] = useState<{ name: string; type: AccountType; last4: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();
  const chosen = accountId || (live.length === 1 && !newAcc ? live[0].id : '');
  // the very first import: there's no account yet, so start the form
  useEffect(() => { if (!loading && live.length === 0) setNewAcc(n => n ?? { name: 'Chequing', type: 'chequing', last4: '' }); }, [loading, live.length]);

  const accountReady = useMemo(() => !!chosen || !!(newAcc && newAcc.name.trim()), [chosen, newAcc]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null); setPreview(null); setBusy('reading');
    try {
      const accId = chosen || 'pending';
      const text = await f.text();
      const r = importCsv(text, accId);
      if (!r || !r.txns.length) { setErr("Couldn't find transactions in that file. TD EasyWeb → Accounts → pick the account → Download → CSV."); return; }
      const dates = r.txns.map(t => t.date).sort();
      const existing = await loadMonths(dates[0].slice(0, 7), dates[dates.length - 1].slice(0, 7));
      const known = new Set(Object.values(existing).flat().map(t => t.id));
      const fresh = r.txns.filter(t => !known.has(t.id));
      const { counts } = await categorizeAll(fresh, rules);
      setPreview({ txns: fresh, importer: r.importer.name, from: dates[0], to: dates[dates.length - 1], counts, dupes: r.txns.length - fresh.length, fileName: f.name });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read the file'); }
    finally { setBusy(null); }
  }

  async function doImport() {
    if (!preview) return;
    setBusy('importing'); setErr(null);
    try {
      let acc: Account | undefined = live.find(a => a.id === chosen);
      if (!acc) {
        if (!newAcc?.name.trim()) throw new Error('Name the account first');
        acc = { id: uid(), name: newAcc.name.trim(), type: newAcc.type, last4: newAcc.last4.replace(/\D/g, '').slice(-4) || undefined, order: accounts.length };
      }
      // the ids were computed with a placeholder account when the account was new: redo them
      const rows = preview.txns.map(t => ({ ...t, accountId: acc!.id, id: t.accountId === acc!.id ? t.id : `${acc!.id.slice(0, 6)}-${t.id}` }));
      const existing = await loadMonths(preview.from.slice(0, 7), preview.to.slice(0, 7));
      const res = await mergeTxns(rows, existing);
      const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latest?.balance !== undefined && (!acc.balanceAsOf || latest.date >= acc.balanceAsOf)) { acc.balance = latest.balance; acc.balanceAsOf = latest.date; }
      await saveAccount(acc);
      await reload();
      say(`Imported ${res.added} transaction${res.added === 1 ? '' : 's'}`, 'good');
      window.setTimeout(() => nav('/money'), 600);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <Header title="Import" eyebrow="Money" back="/money" />
      <Card className="pl-stack">
        <p className="pl-eyebrow">1 · Account</p>
        {live.length > 0 && !newAcc && (
          <div className="pl-chips">
            {live.map(a => <button key={a.id} type="button" className={`pl-chip ${chosen === a.id ? 'is-on' : ''}`} onClick={() => setAccountId(a.id)}>{a.name}{a.last4 ? ` ····${a.last4}` : ''}</button>)}
            <button type="button" className="pl-chip" onClick={() => { setNewAcc({ name: '', type: 'chequing', last4: '' }); setAccountId(''); }}>+ New account</button>
          </div>
        )}
        {newAcc && (
          <div className="pl-stack">
            <Field label="Account name"><Input value={newAcc.name} placeholder="e.g. TD Chequing" onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} /></Field>
            <div className="pl-grid-2">
              <Field label="Type">
                <select className="pl-input" value={newAcc.type} onChange={e => setNewAcc({ ...newAcc, type: e.target.value as AccountType })}>
                  <option value="chequing">Chequing</option><option value="savings">Savings</option><option value="credit">Credit card</option>
                </select>
              </Field>
              <Field label="Last 4 digits (optional)"><Input inputMode="numeric" maxLength={4} value={newAcc.last4} onChange={e => setNewAcc({ ...newAcc, last4: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            {live.length > 0 && <Button small ghost onClick={() => setNewAcc(null)}>Use an existing account instead</Button>}
          </div>
        )}
      </Card>

      <Card className="pl-stack">
        <p className="pl-eyebrow">2 · File</p>
        <label className={`mo-file ${!accountReady ? 'pl-muted' : ''}`}>
          <input type="file" accept=".csv,text/csv" disabled={!accountReady || busy !== null} onChange={e => void onFile(e.target.files?.[0])} />
          <FileUp />
          <b>{busy === 'reading' ? 'Reading…' : preview ? preview.fileName : 'Choose a CSV'}</b>
          <small className="pl-muted">{accountReady ? 'Tap to pick the file from your phone' : 'Pick or name an account first'}</small>
        </label>
        <p className="pl-row pl-muted" style={{ fontSize: 13, alignItems: 'flex-start' }}><Info style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }} /><span>TD EasyWeb: Accounts → the account → <b>Download</b> → CSV. Credit cards export the same way.</span></p>
        {err && <p className="pl-error">{err}</p>}
      </Card>

      {preview && (
        <Card className="pl-stack">
          <p className="pl-eyebrow">3 · Preview · {preview.importer}</p>
          <div className="pl-stats">
            <Stat label="New" value={preview.txns.length} tone="good" />
            <Stat label="Already in" value={preview.dupes} />
            <Stat label="From" value={<span style={{ fontSize: 15 }}>{preview.from}</span>} />
            <Stat label="To" value={<span style={{ fontSize: 15 }}>{preview.to}</span>} />
          </div>
          <p className="pl-muted" style={{ fontSize: 13 }}>
            Categorized: {preview.counts.rule} by your rules · {preview.counts.builtin} built-in · {preview.counts.ai} by AI · {preview.counts.other} left as Other.
          </p>
          <Button primary block disabled={busy !== null || preview.txns.length === 0} onClick={() => void doImport()}>{busy === 'importing' ? 'Importing…' : preview.txns.length === 0 ? 'Nothing new to import' : `Import ${preview.txns.length}`}</Button>
        </Card>
      )}
      {toast}
    </Page>
  );
}
