// src/planner/features/decor/Layer.tsx — the stickers a person has put on a planner page (decor.ts), drawn on it.
// Mounted once, next to the routes (App.tsx); it works out which page is showing from the path. The page's own screen
// knows nothing about it: the stickers are drawn in two sheets slipped into the page's <main class="pl-page">, one
// under its cards (for stickers tucked behind them) and one over, so they scroll with the page and sit where they were
// put. Outside decorating they never take a tap: the sheets let every touch through to the page.
// A page nobody has decorated gets nothing at all: no sheets, no mark, no styles of ours on it.
// With ?decorate=1 on the address the page is being decorated: Decorate.tsx takes over the sheet on top.
// (What the two share, a sticker as it is drawn and where the page is on the screen, is in parts.tsx.)
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { DECORATE_PARAM, layers, sectionOf } from './decor';
import { decorVersion, flushAll, loadPage, onDecor, pageItems } from './store';
import { Decorate } from './Decorate';
import { Sticker, measure, type Host } from './parts';
import './decor.css';

/** Put on a page's <main> while it has our sheets in it ('under' when some stickers are tucked behind its cards).
 *  An attribute of our own, because the page's screen owns its class names. */
const MARK = 'data-dk';
/** The page on the screen, with our two sheets in it, while `on`. The page's screen may swap its <main> for another
 *  (while it loads, or going from one page to the next): the sheets follow. */
function useHost(on: boolean, pathname: string): Host | null {
  const [host, setHost] = useState<Host | null>(null);
  useLayoutEffect(() => {
    if (!on) { setHost(null); return; }
    let cur: Host | null = null;
    const leave = () => { cur?.under.remove(); cur?.over.remove(); cur?.main.removeAttribute(MARK); };
    const sheet = (name: string) => { const el = document.createElement('div'); el.className = `dk-layer dk-layer--${name}`; el.setAttribute('aria-hidden', 'true'); return el; };
    // the sheets place things from the page's own padding, so a sticker keeps its place whatever the padding is
    const fit = () => {
      if (!cur) return;
      const { pad } = measure(cur.main);
      for (const el of [cur.under, cur.over]) { el.style.setProperty('--dk-pl', `${pad.l}px`); el.style.setProperty('--dk-pr', `${pad.r}px`); el.style.setProperty('--dk-pt', `${pad.t}px`); el.style.setProperty('--dk-pb', `${pad.b}px`); }
    };
    const attach = () => {
      const main = document.querySelector<HTMLElement>('main.pl-page');
      if (cur && cur.main === main && cur.over.parentNode === main && cur.under.parentNode === main) return;
      leave();
      if (!main) { cur = null; setHost(null); return; }
      cur = { main, under: sheet('under'), over: sheet('over') };
      main.setAttribute(MARK, '');   // decor.css: the page is now what the sheets are placed from
      main.prepend(cur.under);       // first in the page: what comes after it is drawn over it
      main.append(cur.over);
      fit();
      setHost(cur);
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    const later = window.setTimeout(fit, 0);   // the demo changes the page's padding as it starts
    window.addEventListener('resize', fit);
    return () => { mo.disconnect(); window.clearTimeout(later); window.removeEventListener('resize', fit); leave(); };
  }, [on, pathname]);
  return on ? host : null;
}

export function DecorLayer() {
  const { pathname, search } = useLocation();
  const section = sectionOf(pathname);
  const decorating = !!section && new URLSearchParams(search).has(DECORATE_PARAM);
  useSyncExternalStore(onDecor, decorVersion);
  // the page's stickers are asked for as it opens; the page itself never waits for them
  useEffect(() => { if (section) void loadPage(section); }, [section]);
  // going to the background saves what is waiting; coming back picks up what another phone changed
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'hidden') flushAll(); else if (section && !decorating) void loadPage(section); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('pagehide', flushAll);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('pagehide', flushAll); };
  }, [section, decorating]);
  const items = section ? pageItems(section) : [];
  const host = useHost(!!section && (items.length > 0 || decorating), pathname);
  const tucked = items.some(p => p.under);
  useLayoutEffect(() => { host?.main.setAttribute(MARK, tucked ? 'under' : ''); }, [host, tucked]);
  if (!section || !host) return null;
  const { under, over } = layers(items);
  const onTop = createPortal(over.map(p => <Sticker key={p.id} p={p} />), host.over);
  return (
    <>
      {createPortal(under.map(p => <Sticker key={p.id} p={p} />), host.under)}
      {decorating ? <Decorate section={section} items={items} host={host} /> : onTop}
    </>
  );
}
