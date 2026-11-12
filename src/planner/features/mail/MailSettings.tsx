// src/planner/features/mail/MailSettings.tsx — Settings › Email (/settings/mail): connect a Gmail mailbox, see the
// ones connected, switch "turn what comes in into to-dos" on or off for each, disconnect one. Each person connects
// their own, as many as they have, and only ever sees their own.
// Connect opens Google's own sign-in page in this tab (the planner never asks for an email password). Google sends
// the browser back here with a code after the # of the address. finish.ts has already taken it out of the address
// by the time this screen is drawn; this screen hands it to the server once ("Finishing…") and shows what came of
// it: the mailbox that is now connected, or why not. Only the person who tapped Connect, signed in to this planner,
// gets a mailbox out of it. When the sign-in at Google wasn't finished, the address says so (?problem=…), shown once.
// The page also says exactly what Arvy can and can't do with a connected mailbox, and what Google's "hasn't verified
// this app" screen is about (this is a private app for two people).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import { ago, cameBack, connectStart, disconnect, mailboxes, MailProblem, setWatch, type Mailbox } from './mail';
import { finishReturn, returnWaiting } from './finish';

/** The tile on the Settings screen. */
export function MailTile() {
  return (
    <Link className="pl-tile" to="/settings/mail">
      <Mail aria-hidden />
      <div className="pl-grow"><b>Email</b><small>Connect your Gmail. Arvy reads it when you ask, writes replies for you to check, and offers to-dos from what comes in.</small></div>
      <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
    </Link>
  );
}

export function MailSettings() {
  const [params, setParams] = useSearchParams();
  // what became of a sign-in at Google: the mailbox now connected, or why not (from the address when Google sent no
  // code, else from the finish below)
  const [came, setCame] = useState<{ connected?: string; problem?: string }>(() => cameBack(params));
  const [finishing, setFinishing] = useState(() => returnWaiting());   // Google's code is being handed to the server
  const [boxes, setBoxes] = useState<Mailbox[] | null>(null);
  const [ready, setReady] = useState(true);                    // false = email isn't set up on the server yet
  const [loadErr, setLoadErr] = useState(false);
  const [opening, setOpening] = useState(false);               // Google's page is being opened
  const [working, setWorking] = useState<string | null>(null); // the mailbox being changed
  const [asking, setAsking] = useState<string | null>(null);   // "Disconnect this one?" is showing for it
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const now = Date.now();

  const load = useCallback(async () => {
    try { const r = await mailboxes(); setBoxes(r.mailboxes); setReady(r.ready); setLoadErr(false); }
    catch { setLoadErr(true); }
  }, []);
  useEffect(() => {
    // back from Google's page with a code: hand it over. finishReturn makes the call once however often this runs
    // (the same answer is given to a screen that is drawn twice), and its answer has the list in it.
    const finishNow = (): boolean => {
      const finish = finishReturn();
      if (!finish) return false;
      setFinishing(true);
      void finish.then(r => {
        setFinishing(false);
        if ('connected' in r) { setCame({ connected: r.connected }); setBoxes(r.mailboxes); setLoadErr(false); }
        else { setCame({ problem: r.problem }); void load(); }
      });
      return true;
    };
    if (!finishNow()) { setFinishing(false); void load(); }
    // the code arrived while this screen was already open (only the part after the # changed, so nothing reloaded):
    // finish.ts, which listens first, has taken it out of the address; hand it over the same way
    const arrived = () => { finishNow(); };
    window.addEventListener('hashchange', arrived);
    return () => window.removeEventListener('hashchange', arrived);
  }, [load]);
  // the result is in the page now: take it out of the address, so going back or reloading doesn't show it again
  useEffect(() => { if (params.has('problem')) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setMsg(null); setOpening(true);
    try { window.location.assign(await connectStart()); }   // Google's sign-in page, in this tab
    catch (e) { setOpening(false); setMsg({ text: e instanceof Error ? e.message : 'The sign-in page couldn’t be opened. Try again.', bad: !(e instanceof MailProblem && e.code === 'demo') }); }
  };
  const run = async (id: string, fn: () => Promise<string | void>) => {
    setWorking(id); setMsg(null);
    try { const said = await fn(); if (said) setMsg({ text: said }); await load(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'That didn’t work. Try again.', bad: true }); }
    finally { setWorking(null); }
  };
  const flip = (m: Mailbox) => {
    setBoxes(cur => (cur || []).map(x => (x.id === m.id ? { ...x, todos: !m.todos } : x)));   // shows at once
    void run(m.id, () => setWatch(m.id, !m.todos));
  };
  const remove = (m: Mailbox) => {
    setAsking(null);
    void run(m.id, async () => ((await disconnect(m.id)).revoked ? `${m.address} is disconnected.`
      : `${m.address} is disconnected here. Google couldn’t be told just now: to remove the planner there too, open your Google Account, Security, “Your connections to third-party apps”.`));
  };

  return (
    <main className="pl-page pl-stack pl-fade mail-page" style={{ gap: 16 }}>
      <header className="pl-row">
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Back" style={{ minHeight: 44, minWidth: 44, padding: 0, justifyContent: 'center' }}><ChevronLeft /></Link>
        <h1>Email</h1>
      </header>

      {finishing && <div className="pl-card mail-result" role="status" aria-busy="true"><b>Finishing…</b> Connecting the mailbox you just signed in to.</div>}
      {!finishing && came.connected && <div className="pl-card mail-result is-good" role="status"><b>{came.connected} is connected.</b> Ask Arvy “anything important in my email?” to try it.</div>}
      {!finishing && came.problem && <div className="pl-card mail-result is-bad" role="alert"><b>Not connected.</b> {came.problem}</div>}

      <section className="pl-card pl-stack">
        <p>Connect your own mailboxes here. You sign in on Google’s page: the planner never sees your email password.</p>
        {ready
          ? <button type="button" className="pl-btn pl-btn--primary" disabled={opening || finishing} onClick={() => void connect()}><Mail aria-hidden />{opening ? 'Opening Google…' : boxes?.length ? 'Connect another Gmail' : 'Connect Gmail'}</button>
          : <p className="pl-muted" role="status">Email isn’t set up yet. A mailbox can be connected once the set-up on the server is finished.</p>}
        {msg && <p className={msg.bad ? 'pl-error' : 'pl-muted'} role={msg.bad ? 'alert' : 'status'} style={{ fontSize: 14 }}>{msg.text}</p>}
      </section>

      {loadErr && <p className="pl-error" role="alert">Couldn’t load your mailboxes. Check the connection. <button type="button" className="pl-btn pl-btn--small" onClick={() => void load()}>Try again</button></p>}
      {boxes === null && !loadErr && !finishing && <p className="pl-muted" aria-busy="true">Loading…</p>}
      {boxes?.length === 0 && <p className="pl-muted">No mailbox connected yet.</p>}

      {boxes?.map(m => (
        <section key={m.id} className="pl-card pl-stack mail-box" aria-label={m.address}>
          <div className="pl-row" style={{ alignItems: 'flex-start' }}>
            <Mail aria-hidden className="mail-box__icon" />
            <div className="pl-grow mail-box__who"><b>{m.address}</b><small>Gmail{m.since ? ` · connected ${new Date(m.since).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</small></div>
          </div>
          {m.problem && <p className="pl-error" role="alert" style={{ fontSize: 14 }}>{m.problem}</p>}
          {m.needsSignIn
            ? <button type="button" className="pl-btn pl-btn--primary" disabled={opening} onClick={() => void connect()}>Connect it again</button>
            : (
              <div className="pl-row mail-box__todos">
                <div className="pl-grow" id={`mail-todos-${m.id}`}>
                  <b>Turn what comes in into to-dos</b>
                  <small>{m.todos
                    ? `Checked every half hour${m.checkedAt ? ` · last ${ago(m.checkedAt, now)}` : ''}. What it finds is offered on Today: nothing goes on your list until you tap Add.`
                    : 'Off. Arvy only looks at this mailbox when you ask.'}</small>
                </div>
                <button type="button" role="switch" aria-checked={m.todos} aria-labelledby={`mail-todos-${m.id}`} className="mail-switch" disabled={working === m.id} onClick={() => flip(m)} />
              </div>)}
          {!m.needsSignIn && !m.canSend && <p className="pl-muted" style={{ fontSize: 13 }}>This one can be read but not sent from: the box for sending wasn’t ticked on Google’s page. Disconnect it and connect it again to change that.</p>}
          {asking === m.id
            ? (
              <div className="mail-box__ask" role="group" aria-label={`Disconnect ${m.address}?`}>
                <p>Disconnect {m.address}? Arvy stops reading it, and what it was still offering from it goes.</p>
                <div className="pl-row" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="pl-btn pl-btn--danger" disabled={working === m.id} onClick={() => remove(m)}>Disconnect</button>
                  <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setAsking(null)}>Keep it</button>
                </div>
              </div>)
            : <button type="button" className="pl-btn pl-btn--ghost mail-box__off" disabled={working === m.id} onClick={() => setAsking(m.id)}>{working === m.id ? 'Working…' : 'Disconnect'}</button>}
        </section>
      ))}

      <section className="pl-card pl-stack mail-about">
        <h3>What Arvy can do with a connected mailbox</h3>
        <ul>
          <li>Read your email when you ask (“anything important in my email?”), and tell you what matters.</li>
          <li>Write a reply or a new email for you. Nothing is sent until you’ve seen every word of it and tapped Confirm.</li>
          <li>Offer to-dos from what comes into your main inbox. You choose which ones go on your list.</li>
        </ul>
        <h3>What it can’t do</h3>
        <ul>
          <li>Send anything without your Confirm tap.</li>
          <li>Delete, move or mark an email, or change anything about the mailbox.</li>
          <li>See your email password, or show your mail to anyone else. Each of you connects your own.</li>
        </ul>
      </section>

      <section className="pl-card pl-stack mail-about">
        <h3>The first time: “Google hasn’t verified this app”</h3>
        <p>Google shows that warning because this is a private app for the two of you, so Google hasn’t reviewed it. It’s expected. To carry on:</p>
        <ol>
          <li>Tap <b>Advanced</b>.</li>
          <li>Tap the <b>Go to … (unsafe)</b> link under it.</li>
          <li>Tick both boxes (see your email, and send email for you), or <b>Select all</b>, then <b>Continue</b>.</li>
        </ol>
        <p className="pl-muted" style={{ fontSize: 13 }}>You can take the permission back at any time: Disconnect here, or in your Google Account under Security.</p>
      </section>
    </main>
  );
}
