// src/planner/features/shop/Shopping.tsx — /shop: the household's shopping list, grouped by the store with the best
// flyer deal this week (or by section, in store-walk order). Add, tick, remove. Adding opens Build it (type, size,
// price per kg / each, how many); tapping an item reopens it.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Check, X, RefreshCw, Store, Map, Tag, Settings2 } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Button, Sheet, Field, Input, useToast, uid } from '../../ui/primitives';
import { BuildSheet } from './BuildSheet';
import { loadList, loadPrefs, refreshDeals, removeItem, saveItem, savePrefs } from './store';
import { useDocsChanged } from '../../lib/useDocsChanged';
import { ANYWHERE, bestDeal, DEFAULT_PREFS, isFlyer, liveDeals, perLabel, saleNote, sectionRank, storeOf, type ShopItem, type ShopPrefs } from './types';

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '');
const until = (iso?: string) => (iso ? `until ${new Date(iso).toLocaleDateString([], { weekday: 'short' })}` : '');

export function Shopping({ pass }: { pass: PlannerPass }) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [prefs, setPrefs] = useState<ShopPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<'store' | 'aisle'>('store');
  const [text, setText] = useState('');
  const [pickId, setPickId] = useState<string | null>(null);   // the item whose Build it sheet is open
  const [showPrefs, setShowPrefs] = useState(false);
  const [toast, say] = useToast();

  useEffect(() => {
    let on = true;
    Promise.all([loadList(), loadPrefs()]).then(async ([list, p]) => {
      if (!on) return;
      setItems(list); setPrefs(p); setLoading(false);
      // this week's flyers, once a day
      if (list.some(i => !i.done && i.dealsAt?.slice(0, 10) !== new Date().toISOString().slice(0, 10))) {
        setChecking(true);
        try { const next = await refreshDeals(list, p); if (on) setItems(next); } catch { /* list still works */ } finally { if (on) setChecking(false); }
      }
    }).catch(() => setLoading(false));
    return () => { on = false; };
  }, []);
  useDocsChanged(['shop'], () => { loadList().then(setItems).catch(() => undefined); });

  const add = async () => {
    const t = text.trim(); if (!t) return;
    const m = t.match(/^(\d+(?:\.\d+)?\s*(?:x|×|kg|g|lb|l|ml|pk|pack)?)\s+(.+)$/i);
    const item: ShopItem = { id: uid(), text: m ? m[2].trim() : t, qty: m ? m[1].trim() : undefined, done: false, by: pass.user.username, addedAt: new Date().toISOString() };
    setText(''); setItems(l => [...l, item]); setPickId(item.id);   // straight into Build it
    try {
      await saveItem(item);
      setChecking(true);
      const next = await refreshDeals([...items, item], prefs);
      setItems(next);
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't save", 'bad'); }
    finally { setChecking(false); }
  };
  const toggle = async (i: ShopItem) => { const n = { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString() : undefined }; setItems(l => l.map(x => (x.id === i.id ? n : x))); try { await saveItem(n); } catch { /* retry on next change */ } };
  const remove = async (i: ShopItem) => { setItems(l => l.filter(x => x.id !== i.id)); try { await removeItem(i); } catch { /* ignore */ } };
  const clearDone = async () => { const done = items.filter(i => i.done); setItems(l => l.filter(i => !i.done)); for (const i of done) await removeItem(i).catch(() => undefined); };
  const choose = async (n: ShopItem) => { setItems(l => l.map(x => (x.id === n.id ? n : x))); setPickId(null); try { await saveItem(n); } catch { /* ignore */ } };
  const pick = items.find(i => i.id === pickId) || null;
  const recheck = async () => { setChecking(true); try { setItems(await refreshDeals(items, prefs, true)); say('Flyers checked', 'good'); } catch (e) { say(e instanceof Error ? e.message : "Couldn't check the flyers", 'bad'); } finally { setChecking(false); } };

  const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  const groups = useMemo(() => {
    const g: Record<string, ShopItem[]> = {};
    for (const i of open) { const k = view === 'store' ? storeOf(i) : (i.section || 'Other'); (g[k] ||= []).push(i); }
    const keys = Object.keys(g).sort((a, b) => view === 'store'
      ? (a === ANYWHERE ? 1 : b === ANYWHERE ? -1 : g[b].length - g[a].length || a.localeCompare(b))
      : sectionRank(a) - sectionRank(b));
    return keys.map(k => ({ key: k, items: g[k].sort((x, y) => sectionRank(x.section) - sectionRank(y.section) || x.text.localeCompare(y.text)) }));
  }, [open, view]);
  const trip = groups.filter(g => g.key !== ANYWHERE && view === 'store').map(g => `${g.key}: ${g.items.length}`).join(' · ');
  // only dollar savings add up ('SAVE $1.50'); percentages and points don't
  const saving = open.reduce((s, i) => { const m = bestDeal(i)?.saleStory?.match(/save\s+\$([\d.]+)/i); return s + (m ? Number(m[1]) : 0); }, 0);

  return (
    <Page>
      <Header back="/" eyebrow="Vijay & Rosh" title="Shopping" right={<Button small ghost onClick={() => setShowPrefs(true)} aria-label="Stores"><Settings2 size={16} /></Button>} />

      <div className="shop__add">
        <Input placeholder="Add… e.g. 2 milk, AA batteries, chicken thighs" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
        <Button primary onClick={() => void add()} disabled={!text.trim()}><Plus size={18} /></Button>
      </div>

      {loading ? <p className="pl-muted">Loading…</p> : open.length === 0 ? <Card><p className="pl-muted">Nothing on the list. Add something above — either of you can.</p></Card> : (
        <>
          <div className="pl-row" style={{ gap: 8 }}>
            <div className="shop__views">
              <button type="button" className={view === 'store' ? 'is-on' : ''} onClick={() => setView('store')}><Store size={14} /> By store</button>
              <button type="button" className={view === 'aisle' ? 'is-on' : ''} onClick={() => setView('aisle')}><Map size={14} /> By section</button>
            </div>
            <Button small ghost style={{ marginLeft: 'auto' }} onClick={() => void recheck()} disabled={checking}><RefreshCw size={13} /> {checking ? 'Checking flyers…' : 'Flyers'}</Button>
          </div>
          {view === 'store' && trip && <p className="pl-muted" style={{ fontSize: 13, margin: '2px 0 0' }}><Tag size={12} aria-hidden /> Best trip — {trip}{saving > 0 ? ` · ~$${saving.toFixed(0)} in flyer savings` : ''}</p>}

          {groups.map(g => (
            <Card key={g.key} className="shop__group">
              <h3>{g.key}{view === 'store' && g.key === ANYWHERE ? <small> · no deal or price found</small> : view === 'store' && prefs.specialty.some(s => s.name === g.key) ? <small> · no flyer — likely best here</small> : null}</h3>
              {g.items.map(i => {
                const d = bestDeal(i);
                return (
                  <div key={i.id} className="shop__item">
                    <button type="button" className="pl-check" aria-label="Got it" onClick={() => void toggle(i)}><Check /></button>
                    <div className="shop__main">
                      <b>{i.count && i.count > 1 ? `${i.count} × ` : i.qty ? `${i.qty} ` : ''}{i.text}{i.pick && (i.pick.variant || i.pick.size) ? <small className="shop__built"> · {[i.pick.variant, i.pick.size].filter(Boolean).join(', ')}</small> : null}{i.for?.length ? <small className="shop__built"> · for {i.for.join(', ')}</small> : null}</b>
                      {d
                        ? <button type="button" className={`shop__deal ${isFlyer(d) ? '' : 'is-regular'}`} onClick={() => setPickId(i.id)}>{money(d.price)}{perLabel(d)} {d.name}{isFlyer(d) ? `${saleNote(d) ? ` · ${saleNote(d)}` : ''}${d.validTo ? ` · ${until(d.validTo)}` : ''}` : ' · regular price'}{liveDeals(i).length > 1 ? ` · +${liveDeals(i).length - 1} more` : ''}</button>
                        : <button type="button" className="shop__deal is-regular" onClick={() => setPickId(i.id)}>{i.suggestedStore && storeOf(i) === i.suggestedStore ? `likely best here · ${i.reason || 'no flyer'}` : checking && !i.dealsAt ? 'checking flyers…' : `${view === 'store' ? (i.section || 'no deal found') : 'no deal found'} · tap to build it`}{i.by !== pass.user.username ? ` · added by ${i.by}` : ''}</button>}
                    </div>
                    <button type="button" className="shop__x" aria-label="Remove" onClick={() => void remove(i)}><X size={14} /></button>
                  </div>
                );
              })}
            </Card>
          ))}
        </>
      )}

      {done.length > 0 && (
        <Card>
          <div className="pl-row"><h3 className="pl-grow pl-muted" style={{ fontSize: 14 }}>Got ({done.length})</h3><Button small ghost onClick={() => void clearDone()}>Clear</Button></div>
          {done.map(i => <div key={i.id} className="shop__item is-done"><button type="button" className="pl-check is-on" aria-label="Put back" onClick={() => void toggle(i)}><Check /></button><div className="shop__main"><b>{i.qty ? `${i.qty} ` : ''}{i.text}</b></div></div>)}
        </Card>
      )}
      <p className="pl-muted" style={{ fontSize: 12, textAlign: 'center' }}>One list for the house. Deals are this week's flyers near {prefs.postal}, with everyday prices where stores list them; sections are the usual store layout, not exact aisle numbers.</p>

      <BuildSheet item={pick} prefs={prefs} checking={checking} onClose={() => setPickId(null)} onSave={n => void choose(n)} />

      <Sheet open={showPrefs} onClose={() => setShowPrefs(false)} title="Your stores">
        <div className="pl-stack">
          <Field label="Postal code (first 3 is enough)"><Input value={prefs.postal} onChange={e => setPrefs({ ...prefs, postal: e.target.value.toUpperCase() })} /></Field>
          <Field label="Stores with flyers, one per line" hint="Deals from these come first; others still show when they're the best price."><textarea className="pl-input pl-textarea" rows={4} value={prefs.stores.join('\n')} onChange={e => setPrefs({ ...prefs, stores: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></Field>
          <Field label="Stores without flyers, one per line: name — what they're good for" hint="Lococo's and the Indian, Caribbean and Middle Eastern grocers. Arvy sends the right items there when no flyer beats them. Rename these to the actual shops."><textarea className="pl-input pl-textarea" rows={5} value={prefs.specialty.map(s => `${s.name}${s.note ? ` — ${s.note}` : ''}`).join('\n')} onChange={e => setPrefs({ ...prefs, specialty: e.target.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, ...rest] = l.split(/\s+[—-]\s+/); return { name: name.trim(), note: rest.join(' - ').trim() || undefined }; }) })} /></Field>
          <Button primary onClick={async () => { await savePrefs(prefs); setShowPrefs(false); void recheck(); }}>Save &amp; re-check</Button>
        </div>
      </Sheet>
      {toast}
    </Page>
  );
}
