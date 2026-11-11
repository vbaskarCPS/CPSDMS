// src/planner/features/widgets/Note.tsx — a sticky note on Today: a few lines to type on, saved as they're typed, on
// lined paper in one of a few colours with a strip of tape on top. The words live in their own doc ('widgetnote' / the
// note's id) through lib/useDoc, so they're read before anything is written over them and saved on the way out of the
// page; a copy on the phone means the note isn't blank for a moment each time Today opens.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useDoc } from '../../lib/useDoc';
import { keepNoteLocal, noteLocal, NOTE_KIND } from './store';
import { NOTE_MAX, type Note } from './widgets';

export function NoteCard({ w, uid, small }: { w: Note; uid: string; small: boolean }) {
  const { data, update, loading, loadError, save } = useDoc<{ text: string }>(NOTE_KIND, w.id, { text: noteLocal(uid, w.id) }, 600);
  const text = typeof data?.text === 'string' ? data.text : '';
  useEffect(() => { if (!loading && !loadError) keepNoteLocal(uid, w.id, text); }, [uid, w.id, text, loading, loadError]);
  // the paper grows with the words
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = box.current; if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; } }, [text, small]);
  return (
    <section className={`pl-card wg-note ${small ? 'is-small' : ''}`} data-paper={w.paper}>
      <i className="wg-note__tape" aria-hidden />
      <textarea ref={box} className="wg-note__text" aria-label="Note" rows={3} maxLength={NOTE_MAX} placeholder={loading ? '…' : 'Write a note…'}
        value={text} readOnly={loading || loadError} onChange={e => update({ text: e.target.value.slice(0, NOTE_MAX) })} />
      {loadError && <small className="pl-error">Couldn’t load this note. Check the connection.</small>}
      {save === 'error' && <small className="pl-error">Not saved yet. Check the connection.</small>}
    </section>
  );
}
