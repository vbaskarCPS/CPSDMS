// src/v2/features/mail/Composer.tsx — writing an email: To / Cc chips, subject, a rich-text body (bold,
// italic, underline, lists, links), attachments, and Claude: write it from a sentence, or rewrite the
// draft (shorter, friendlier, more formal, fix grammar). The draft is kept on this device until sent.
// Phone: full screen. Desktop: a panel in the corner, like Gmail. Ctrl/⌘ + Enter sends.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, ChevronDown, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Paperclip, Redo2, RemoveFormatting,
  Send, Sparkles, Trash2, Underline as UnderlineIcon, Undo2, Wand2, X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { aiWrite, fileSize, htmlToText, isEmail, sendMail, splitAddresses, uploadAttachment, type Attachment, type Draft } from '../../lib/mail';
import './mail.css';

export interface ComposeInit {
  key: string;                       // where the draft is kept: "new", "thread:<id>", "biz:<id>"
  title?: string;                    // "New message", "Reply"
  thread_id?: string | null; business_id?: string | null; campaign_id?: string | null;
  to?: string[]; cc?: string[]; subject?: string; html?: string;
  context?: string;                  // a line under the title: "Ace Plumbing · Taxify"
  quick?: string[];                  // suggested AI asks
}

const DRAFTS = 'ms-mail-drafts';
function loadDraft(key: string): Partial<Draft> | null {
  try { return (JSON.parse(localStorage.getItem(DRAFTS) || '{}') as Record<string, Partial<Draft>>)[key] || null; } catch { return null; }
}
function saveDraft(key: string, d: Partial<Draft> | null) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS) || '{}') as Record<string, Partial<Draft>>;
    if (d) all[key] = d; else delete all[key];
    localStorage.setItem(DRAFTS, JSON.stringify(all));
  } catch { /* storage off: drafts just aren't kept */ }
}

const REWRITES: { label: string; how: string }[] = [
  { label: 'Shorter', how: 'make it shorter and tighter' },
  { label: 'Friendlier', how: 'make it warmer and friendlier, still professional' },
  { label: 'More formal', how: 'make it more formal and polished' },
  { label: 'Fix grammar', how: 'fix spelling, grammar and punctuation only; change nothing else' },
  { label: 'Add a call to book', how: 'end with a clear, low-pressure ask to book a short call this week' },
];

export const Composer: React.FC<{ init: ComposeInit; docked?: boolean; onClose: () => void; onSent: (threadId: string) => void }> = ({ init, docked, onClose, onSent }) => {
  const { session } = useAuth();
  const saved = useMemo(() => loadDraft(init.key), [init.key]);
  const [to, setTo] = useState<string[]>(saved?.to || init.to || []);
  const [cc, setCc] = useState<string[]>(saved?.cc || init.cc || []);
  const [showCc, setShowCc] = useState((saved?.cc || init.cc || []).length > 0);
  const [subject, setSubject] = useState(saved?.subject ?? init.subject ?? '');
  const [files, setFiles] = useState<Attachment[]>(saved?.attachments || []);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState<null | 'send' | 'ai'>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [undoAi, setUndoAi] = useState<{ subject: string; html: string } | null>(null);
  const [big, setBig] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: 'Write your message, or ask AI to write it' }),
    ],
    content: saved?.html ?? init.html ?? '',
    editorProps: { attributes: { class: 'v2-mail-body', 'aria-label': 'Message' } },
  });

  // keep the draft on this device as it changes
  const persist = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const empty = editor.isEmpty && !subject.trim() && !files.length;
    saveDraft(init.key, empty ? null : { to, cc, subject, html, attachments: files });
  }, [editor, to, cc, subject, files, init.key]);
  useEffect(() => { const t = setTimeout(persist, 400); return () => clearTimeout(t); }, [persist]);
  useEffect(() => { if (!editor) return; const h = () => persist(); editor.on('update', h); return () => { editor.off('update', h); }; }, [editor, persist]);

  const addFiles = async (list: FileList | null) => {
    if (!list || !session) return;
    setError(null);
    for (const f of Array.from(list)) {
      setUploading(n => n + 1);
      try { const a = await uploadAttachment(session.user.id, f); setFiles(x => [...x, a]); }
      catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t attach the file'); }
      finally { setUploading(n => n - 1); }
    }
  };

  const send = useCallback(async () => {
    if (!editor || busy) return;
    const html = editor.getHTML();
    const text = htmlToText(html);
    const bad = [...to, ...cc].filter(a => !isEmail(a));
    if (!to.length) { setError('Add who it’s to.'); return; }
    if (bad.length) { setError(`${bad[0]} isn’t an email address.`); return; }
    if (!subject.trim()) { setError('Add a subject.'); return; }
    if (!text.trim()) { setError('The message is empty.'); return; }
    if (uploading) { setError('Wait for the attachment to finish.'); return; }
    setBusy('send'); setError(null);
    try {
      const r = await sendMail({ thread_id: init.thread_id, business_id: init.business_id, campaign_id: init.campaign_id, to, cc, subject: subject.trim(), html, text, attachments: files });
      saveDraft(init.key, null);
      onSent(r.thread_id);
    } catch (e) { setError(e instanceof Error ? e.message : 'The email didn’t send.'); }
    finally { setBusy(null); }
  }, [editor, busy, to, cc, subject, files, uploading, init, onSent]);

  const write = async (instruction: string) => {
    if (!editor) return;
    setBusy('ai'); setError(null);
    const before = { subject, html: editor.getHTML() };
    try {
      const r = await aiWrite({ mode: 'write', thread_id: init.thread_id, business_id: init.business_id, campaign_id: init.campaign_id, instruction });
      editor.commands.setContent(r.html, true);
      if (r.subject && (!subject.trim() || !init.thread_id)) setSubject(r.subject);
      setUndoAi(before); setAiOpen(false); setAsk('');
    } catch (e) { setError(e instanceof Error ? e.message : 'AI couldn’t write it.'); }
    finally { setBusy(null); }
  };
  const rewrite = async (how: string) => {
    if (!editor || editor.isEmpty) { setError('Write something first, or use Write with AI.'); return; }
    setBusy('ai'); setError(null); setRewriteOpen(false);
    const before = { subject, html: editor.getHTML() };
    try {
      const r = await aiWrite({ mode: 'rewrite', thread_id: init.thread_id, business_id: init.business_id, campaign_id: init.campaign_id, how, subject, html: before.html });
      editor.commands.setContent(r.html, true);
      setUndoAi(before);
    } catch (e) { setError(e instanceof Error ? e.message : 'AI couldn’t rewrite it.'); }
    finally { setBusy(null); }
  };

  const setLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:\/\//i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false); setLinkUrl('');
  };

  const discard = () => { saveDraft(init.key, null); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Escape' && !aiOpen && !linkOpen && !rewriteOpen) onClose();
  };
  const tb = (on: boolean) => `v2-mail-tb${on ? ' on' : ''}`;

  return (
    <div className={`v2-mail v2-mail-compose${docked ? ' docked' : ''}${big ? ' big' : ''}`} role="dialog" aria-label={init.title || 'New message'} onKeyDown={onKey}>
      <div className="head">
        <div className="t"><b>{init.title || 'New message'}</b>{init.context && <span>{init.context}</span>}</div>
        {!docked && <button type="button" className="icon hide-sm" onClick={() => setBig(b => !b)} aria-label={big ? 'Smaller' : 'Bigger'}>{big ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
        <button type="button" className="icon" onClick={onClose} aria-label="Close (the draft is kept)"><X size={18} /></button>
      </div>

      <div className="fields">
        <Chips label="To" values={to} onChange={setTo} autoFocus={!to.length} right={!showCc ? <button type="button" className="link" onClick={() => setShowCc(true)}>Cc</button> : null} />
        {showCc && <Chips label="Cc" values={cc} onChange={setCc} />}
        <div className="row">
          <input className="subject" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject" maxLength={200} />
        </div>
      </div>

      <div className="ai-bar">
        <button type="button" className={`ai${aiOpen ? ' on' : ''}`} onClick={() => { setAiOpen(o => !o); setRewriteOpen(false); }} disabled={busy === 'send'}>
          <Sparkles size={15} />Write with AI</button>
        <div className="rw">
          <button type="button" className={`ai ghost${rewriteOpen ? ' on' : ''}`} onClick={() => { setRewriteOpen(o => !o); setAiOpen(false); }} disabled={!!busy}>
            <Wand2 size={15} />Rewrite<ChevronDown size={14} /></button>
          {rewriteOpen && (
            <div className="menu" role="menu">{REWRITES.map(r => <button key={r.label} type="button" role="menuitem" onClick={() => rewrite(r.how)}>{r.label}</button>)}</div>)}
        </div>
        {busy === 'ai' && <span className="working"><Loader2 size={14} className="spin" />Writing…</span>}
        {undoAi && busy !== 'ai' && <button type="button" className="link" onClick={() => { editor?.commands.setContent(undoAi.html, true); setSubject(undoAi.subject); setUndoAi(null); }}>Undo AI</button>}
      </div>
      {aiOpen && (
        <div className="ai-ask">
          <div className="ask-row">
            <input autoFocus placeholder={init.thread_id ? 'What should the reply say?' : 'What should the email say?'} value={ask}
              onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ask.trim()) { e.preventDefault(); write(ask.trim()); } }} aria-label="Ask AI" />
            <button type="button" className="go" disabled={!ask.trim() || busy === 'ai'} onClick={() => write(ask.trim())}>Write</button>
          </div>
          {!!init.quick?.length && <div className="quick">{init.quick.map(q => <button key={q} type="button" onClick={() => write(q)} disabled={busy === 'ai'}>{q}</button>)}</div>}
          <div className="note">AI uses this business, your visits and the campaign’s pitch. Read it before sending.</div>
        </div>)}

      {editor && (
        <div className="toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" className={tb(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold" aria-pressed={editor.isActive('bold')}><Bold size={16} /></button>
          <button type="button" className={tb(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic" aria-pressed={editor.isActive('italic')}><Italic size={16} /></button>
          <button type="button" className={tb(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline" aria-pressed={editor.isActive('underline')}><UnderlineIcon size={16} /></button>
          <span className="sep" />
          <button type="button" className={tb(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bulleted list"><List size={16} /></button>
          <button type="button" className={tb(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list"><ListOrdered size={16} /></button>
          <button type="button" className={tb(editor.isActive('link'))} onClick={() => { setLinkUrl(editor.getAttributes('link').href || ''); setLinkOpen(o => !o); }} aria-label="Link"><Link2 size={16} /></button>
          <button type="button" className="v2-mail-tb" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} aria-label="Clear formatting"><RemoveFormatting size={16} /></button>
          <span className="sep" />
          <button type="button" className="v2-mail-tb" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="Undo"><Undo2 size={16} /></button>
          <button type="button" className="v2-mail-tb" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="Redo"><Redo2 size={16} /></button>
        </div>)}
      {linkOpen && (
        <div className="linkbar">
          <input autoFocus placeholder="https://" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setLink(); } }} aria-label="Link address" />
          <button type="button" className="go" onClick={setLink}>{linkUrl.trim() ? 'Apply' : 'Remove link'}</button>
        </div>)}

      <div className="editor"><EditorContent editor={editor} /></div>

      {(files.length > 0 || uploading > 0) && (
        <div className="files">
          {files.map(f => (
            <span key={f.path} className="file"><Paperclip size={13} /><span className="n">{f.name}</span><span className="s">{fileSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(x => x.filter(y => y.path !== f.path))}><X size={13} /></button></span>))}
          {uploading > 0 && <span className="file up"><Loader2 size={13} className="spin" />Attaching…</span>}
        </div>)}

      {error && <div className="err" role="alert">{error}</div>}
      <div className="foot">
        <button type="button" className="send" onClick={send} disabled={!!busy || uploading > 0}>
          {busy === 'send' ? <><Loader2 size={16} className="spin" />Sending…</> : <>Send<Send size={15} /></>}</button>
        <button type="button" className="icon" onClick={() => fileInput.current?.click()} aria-label="Attach files"><Paperclip size={18} /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        <span className="hint">Your signature is added. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon" onClick={discard} aria-label="Discard draft"><Trash2 size={17} /></button>
      </div>
    </div>
  );
};

// ───────────── To / Cc: addresses as chips ─────────────
const Chips: React.FC<{ label: string; values: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; right?: React.ReactNode }> = ({ label, values, onChange, autoFocus, right }) => {
  const [text, setText] = useState('');
  const commit = (raw: string) => {
    const found = splitAddresses(raw);
    const rest = raw.trim() && !found.length ? [raw.trim().toLowerCase()] : [];
    const next = [...values, ...found, ...rest].filter((v, i, a) => v && a.indexOf(v) === i);
    if (next.length !== values.length) onChange(next);
    setText('');
  };
  return (
    <label className="row chips">
      <span className="lab">{label}</span>
      <span className="wrap">
        {values.map(v => (
          <span key={v} className={`chip${isEmail(v) ? '' : ' bad'}`} title={isEmail(v) ? v : 'Not an email address'}>{v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter(x => x !== v))}><X size={12} /></button></span>))}
        <input value={text} autoFocus={autoFocus} type="email" inputMode="email" autoComplete="off" aria-label={label}
          onChange={e => { const v = e.target.value; if (/[,;\s]$/.test(v)) commit(v); else setText(v); }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) { e.preventDefault(); commit(text); }
            if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
          onPaste={e => { const t = e.clipboardData.getData('text'); if (/[,;\s]/.test(t)) { e.preventDefault(); commit(text + t); } }}
          onBlur={() => text.trim() && commit(text)} />
      </span>
      {right}
    </label>
  );
};
