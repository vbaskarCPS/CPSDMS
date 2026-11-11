// src/v2/features/benny/BennyTexts.tsx — the Benny's texts card: one row per worker, each with a Text button.
//
// Nothing is sent from here. A Text button is an ordinary sms: link: it opens the phone's Messages to that worker with
// the text written, and the person presses send there. Tapping a text changes it first. A tapped button is marked
// Opened (the app can't know it was sent) and the app keeps what was written (BennyPanel calls textOpened).
import React, { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { BennyMsg } from '../../lib/benny';
import { personSub, textHref, textOf, textsCopy, textsFoot, textsSaid, textsTitle, TEXT_MAX, type TextPerson, type TextsCheck, type TextsState } from '../../lib/bennyTexts';

export const TextsCard: React.FC<{
  check: TextsCheck; state?: TextsState | null; outcome: BennyMsg['outcome'];
  /** the card's state changed: a button was tapped (opened = that worker, to keep their text) or a text was changed */
  onState: (next: TextsState, opened?: TextPerson) => void;
  onClose: (outcome: NonNullable<BennyMsg['outcome']>) => void;
}> = ({ check, state, outcome, onState, onClose }) => {
  const [edit, setEdit] = useState<{ cn: string; value: string } | null>(null);
  const [copied, setCopied] = useState<null | 'yes' | 'no'>(null);
  const closed = !!outcome;
  const anyOpened = check.people.some(p => state?.opened?.[p.cn]);

  const tapped = (p: TextPerson) => onState({ ...state, opened: { ...(state?.opened || {}), [p.cn]: Date.now() } }, p);
  const saveEdit = (p: TextPerson) => {
    const value = (edit?.value || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
    setEdit(null);
    if (!value || value === textOf(p, state)) return;
    // a changed text hasn't been opened yet: its button is the one to tap again
    const opened = { ...(state?.opened || {}) }; delete opened[p.cn];
    const edits = { ...(state?.edits || {}) }; if (value === p.text) delete edits[p.cn]; else edits[p.cn] = value;
    onState({ ...state, opened, edits });
  };
  const copy = async () => {
    const ok = await Promise.resolve().then(() => navigator.clipboard.writeText(textsCopy(check, state))).then(() => true, () => false);
    setCopied(ok ? 'yes' : 'no'); window.setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className={`benny-card${outcome ? ` ${outcome.state}` : ''}`}>
      <b className="benny-card-t">{textsTitle(check)}</b>
      <div className="benny-texts">
        {check.people.map(p => {
          const body = textOf(p, state); const opened = !!state?.opened?.[p.cn]; const editing = !closed && edit?.cn === p.cn;
          return (
            <div key={p.cn} className={`benny-text${opened ? ' opened' : ''}`}>
              <div className="benny-text-main">
                <div className="benny-text-who"><b>{p.name}</b><span>{personSub(p, check.date)}</span></div>
                {editing ? (
                  <>
                    <textarea className="benny-text-edit" value={edit!.value} maxLength={TEXT_MAX} rows={3} autoFocus aria-label={`The text to ${p.name}`}
                      onChange={e => setEdit({ cn: p.cn, value: e.target.value })} />
                    <div className="benny-text-editb">
                      <button type="button" className="benny-alt" onClick={() => saveEdit(p)}>Use this</button>
                      <button type="button" className="benny-alt" onClick={() => setEdit(null)}>Cancel</button>
                      {state?.edits?.[p.cn] && <button type="button" className="benny-alt" onClick={() => setEdit({ cn: p.cn, value: p.text })}>Put it back</button>}
                    </div>
                  </>
                ) : closed ? <div className="benny-text-body">“{body}”</div> : (
                  <button type="button" className="benny-text-body" onClick={() => setEdit({ cn: p.cn, value: body })} aria-label={`Change the text to ${p.name}`}>
                    “{body}” <span className="benny-text-change"><Pencil size={11} /> Change</span>
                  </button>
                )}
              </div>
              {!editing && (
                <div className="benny-text-act">
                  {opened && <span className="benny-text-ok"><Check size={13} /> Opened</span>}
                  {closed ? null : !p.phone ? <span className="benny-text-none">No cell number</span>
                    : opened ? <a className="benny-text-again" href={textHref(p.phone, body)} onClick={() => tapped(p)} aria-label={`Text ${p.name} again`}>again</a>
                    : <a className="benny-go benny-text-go" href={textHref(p.phone, body)} onClick={() => tapped(p)} aria-label={`Text ${p.name}`}>Text</a>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="v2-small benny-text-foot">{textsFoot(check)}</div>
      {outcome && <div className={`benny-card-out ${outcome.state}`} role="status">{outcome.state === 'done' && <Check size={15} />}{outcome.text}</div>}
      {!closed && (
        <div className="benny-card-b">
          <button type="button" className="benny-alt" onClick={() => void copy()}>{copied === 'yes' ? 'Copied' : copied === 'no' ? 'Couldn’t copy' : 'Copy all'}</button>
          {anyOpened
            ? <button type="button" className="benny-alt" onClick={() => onClose({ state: 'done', text: `${textsSaid(check.people, state)} You press send in Messages.` })}>Done</button>
            : <button type="button" className="benny-alt" onClick={() => onClose({ state: 'dismissed', text: 'No text opened.' })}>Not now</button>}
        </div>
      )}
    </div>
  );
};
