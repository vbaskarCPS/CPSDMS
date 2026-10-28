// src/v2/features/mail/Unsubscribe.tsx — the public "stop these emails" page (/app/unsubscribe#t=<token>).
// The token is the conversation's; ms_mail_unsubscribe records the contact's address so no rep can
// email it again through MainstreetAI.
import React, { useEffect, useState } from 'react';
import { unsubscribe } from '../../lib/mail';
import { MsLogo } from '../../ui/MsLogo';

export const Unsubscribe: React.FC = () => {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') || '';
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'bad'>(token ? 'ask' : 'bad');
  const [email, setEmail] = useState<string | undefined>();
  const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Unsubscribe · MainstreetAI'; }, []);
  const go = async () => {
    setState('busy'); setErr('');
    try { const r = await unsubscribe(token); if (r.ok) { setEmail(r.email); setState('done'); } else setState('bad'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); setState('ask'); }
  };
  return (
    <div className="v2"><div className="v2-login"><div className="v2-login-card v2-card" style={{ padding: 22, textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><MsLogo size={26} /></div>
      {state === 'done' ? (
        <><h2 style={{ margin: '0 0 8px' }}>You’re unsubscribed</h2>
          <p className="v2-mut">{email ? <>We won’t email <b>{email}</b> again.</> : 'We won’t email you again.'} If someone replies to you by email, that still reaches them.</p></>
      ) : state === 'bad' ? (
        <><h2 style={{ margin: '0 0 8px' }}>This link doesn’t work</h2>
          <p className="v2-mut">Reply to the email with the word “unsubscribe” and we’ll stop.</p></>
      ) : (
        <><h2 style={{ margin: '0 0 8px' }}>Stop emails from MainstreetAI?</h2>
          <p className="v2-mut">We’ll stop all emails to this address from MainstreetAI reps.</p>
          {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
          <button type="button" className="v2-btn" style={{ width: '100%', marginTop: 8, justifyContent: 'center' }} disabled={state === 'busy'} onClick={go}>
            {state === 'busy' ? 'One moment…' : 'Unsubscribe'}</button></>
      )}
    </div></div></div>
  );
};
