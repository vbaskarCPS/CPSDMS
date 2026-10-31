// src/mainstreetai/Site.tsx — the Main Street AI public website (mainstreetai.propertystars.app).
// One page: the storefront-at-dusk logo, the mission, the team, the Taxifi.ai partnership, and a savings-quote
// request that lands in the MainstreetAI inbox as a conversation with the customer (ms-site-quote).
import React, { useEffect, useRef, useState } from 'react';
import { COMPANY, MISSION, PARTNER, PILLARS, QUOTE, TEAM, type Person } from './content';
import { supabaseAnonKey, supabaseUrl } from '../lib/supabaseConfig';

const Leaf: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg className="leaf" width={size} height={size} viewBox="-2 -10 104 98" aria-hidden="true">
    <path fill="currentColor" d="M50 -8 L55.5 13 L67 5 L59.5 34 L72.5 18 L77 25.5 L97 16 L82 40.5 L101 42 L68.5 61 L74 70 L53 65 L54 86 L46 86 L47 65 L26 70 L31.5 61 L-1 42 L18 40.5 L3 16 L23 25.5 L27.5 18 L40.5 34 L33 5 L44.5 13 Z" />
  </svg>
);

const Wordmark: React.FC = () => (
  <a href="#top" className="wordmark" aria-label="Main Street AI, back to top">
    <span className="wm-main">Main Street</span> <span className="wm-ai">AI</span><Leaf size={12} />
  </a>
);

export const Site: React.FC = () => {
  useEffect(() => { document.title = `${COMPANY.name}: ${COMPANY.tagline}`; }, []);
  return (
    <>
      <a className="skip" href="#quote">Skip to the savings quote</a>
      <header className="bar">
        <div className="wrap bar-in">
          <Wordmark />
          <nav aria-label="Sections">
            <a href="#mission">Mission</a>
            <a href="#team">Team</a>
            <a href="#taxifi">Taxifi.ai</a>
            <a href="#quote" className="nav-cta">Free savings quote</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-h">
          <h1 id="hero-h" className="sr-only">{COMPANY.name}: {COMPANY.tagline}</h1>
          <picture>
            <source srcSet="/mainstreetai/hero.webp" type="image/webp" />
            <img src="/mainstreetai/hero.jpg" width={1432} height={675}
              alt={`${COMPANY.name}: a row of Main Street storefronts at night (restaurant, retail, services, health and wellness) under the words Main Street AI. ${COMPANY.tagline} ${PILLARS.join(', ')}.`} />
          </picture>
          <div className="wrap hero-foot">
            <p className="hero-line">AI tools for the independent businesses that line Canada’s Main Streets.</p>
            <div className="hero-acts">
              <a className="btn" href="#quote">{QUOTE.button}</a>
              <a className="btn ghost" href="#team">Meet the team</a>
            </div>
          </div>
        </section>

        <section id="mission" className="mission">
          <div className="wrap">
            <h2>Our mission</h2>
            <p className="mission-text">{MISSION}</p>
            <ul className="pillars" aria-label="What we help with">{PILLARS.map(p => <li key={p}>{p}</li>)}</ul>
          </div>
        </section>

        <section id="team" className="team">
          <div className="wrap">
            <h2>Our team</h2>
            <div className="people">{TEAM.map(p => <PersonCard key={p.name} p={p} />)}</div>
          </div>
        </section>

        <section id="taxifi" className="partner">
          <div className="wrap">
            <p className="kicker">Our flagship partnership</p>
            <h2 className="partner-h"><span>Main Street AI</span> <span className="x" aria-label="and">×</span> <span>{PARTNER.name}</span></h2>
            <p className="partner-sub">{PARTNER.title}</p>
            <div className="cols">
              <div className="prose">{PARTNER.intro.map((t, i) => <p key={i}>{t}</p>)}</div>
              <div className="prose">
                <h3>{PARTNER.storyTitle}</h3>
                {PARTNER.story.map((t, i) => <p key={i}>{t}</p>)}
              </div>
            </div>

            <div className="how">
              <h3>{PARTNER.howTitle}</h3>
              <div className="prose narrow">{PARTNER.howIntro.map((t, i) => <p key={i}>{t}</p>)}</div>
              <ul className="how-list">
                {PARTNER.how.map(h => <li key={h.title}><h4>{h.title}</h4><p>{h.text}</p></li>)}
              </ul>
            </div>

            <div className="why">
              <h3>{PARTNER.whyTitle}</h3>
              <div className="prose narrow">{PARTNER.why.map((t, i) => <p key={i}>{t}</p>)}</div>
              <p className="motto">{PARTNER.motto}</p>
              <p className="motto-sub">That’s the Main Street AI philosophy in action!</p>
            </div>
          </div>
        </section>

        <section id="quote" className="quote" aria-labelledby="quote-h">
          <div className="wrap quote-in">
            <div className="quote-text">
              <h2 id="quote-h">{QUOTE.title}</h2>
              {QUOTE.text.map((t, i) => <p key={i}>{t}</p>)}
              <p className="push">{QUOTE.push}</p>
            </div>
            <QuoteForm />
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <div>
            <Wordmark />
            <p className="foot-tag">{COMPANY.tagline}</p>
          </div>
          <address>
            {COMPANY.legal}<br />
            {COMPANY.address.map(a => <React.Fragment key={a}>{a}<br /></React.Fragment>)}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
          </address>
          <p className="foot-copy">© {new Date().getFullYear()} 6260942 Canada Ltd.</p>
        </div>
      </footer>
    </>
  );
};

const PersonCard: React.FC<{ p: Person }> = ({ p }) => {
  const [open, setOpen] = useState(false);
  const id = `bio-${p.name.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <article className="person">
      <h3>{p.name}</h3>
      <p className="role">{p.role}</p>
      <p className="highlight">{p.highlight}</p>
      <p className="lead">{p.lead}</p>
      <div id={id} className="more" hidden={!open}>
        {p.bio.map((t, i) => <p key={i}>{t}</p>)}
      </div>
      <p className="close">{p.close.join(' ')}</p>
      <button type="button" className="link" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {open ? 'Show less' : `Read ${p.name.split(' ')[0]}’s story`}
      </button>
    </article>
  );
};

type Sent = 'idle' | 'sending' | 'sent' | 'error';

const QuoteForm: React.FC = () => {
  const shownAt = useRef(Date.now());
  const [state, setState] = useState<Sent>('idle');
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', business: '', email: '', phone: '', city: '', spend: '', message: '', website: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.name.trim() || !f.business.trim()) { setError('Add your name and your business name.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setError('Add an email address we can send your quote to.'); return; }
    setState('sending');
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ms-site-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ ...f, ms: Date.now() - shownAt.current }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'The request didn’t go through.');
      setState('sent');
    } catch (err) {
      setState('error');
      setError(`${err instanceof Error ? err.message : 'The request didn’t go through.'} Try again, or email ${COMPANY.email}.`);
    }
  };

  if (state === 'sent') {
    return (
      <div className="form done" role="status">
        <h3>Request sent</h3>
        <p>Thanks, {f.name.trim().split(' ')[0]}. A Main Street AI business consultant will email you at <b>{f.email.trim()}</b> to put together your savings quote.</p>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={submit} noValidate aria-describedby="quote-small">
      <div className="row2">
        <label><span className="lbl">Your name</span><input value={f.name} onChange={set('name')} autoComplete="name" required /></label>
        <label><span className="lbl">Business name</span><input value={f.business} onChange={set('business')} autoComplete="organization" required /></label>
      </div>
      <div className="row2">
        <label><span className="lbl">Email</span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></label>
        <label><span className="lbl">Phone <span className="opt">(optional)</span></span><input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
      </div>
      <div className="row2">
        <label><span className="lbl">City <span className="opt">(optional)</span></span><input value={f.city} onChange={set('city')} autoComplete="address-level2" /></label>
        <label><span className="lbl">Bookkeeping cost now</span>
          <select value={f.spend} onChange={set('spend')}>
            <option value="">Choose one (optional)</option>
            {QUOTE.spend.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <label><span className="lbl">Anything we should know <span className="opt">(optional)</span></span>
        <textarea rows={3} value={f.message} onChange={set('message')} placeholder="Your industry, how many employees, who does your books today…" />
      </label>
      <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="submit" className="btn big" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : QUOTE.button}</button>
      <p id="quote-small" className="small">{QUOTE.small} We only use your details to prepare your quote.</p>
    </form>
  );
};
