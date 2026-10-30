// src/planner/ui/primitives.tsx — small building blocks every planner screen uses. Styles: planner.css.
import { useEffect, useState, type ReactNode, type TextareaHTMLAttributes, type InputHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Check, Loader2, AlertCircle } from 'lucide-react';
import type { SaveState } from '../lib/useDoc';

export function Page({ children, bare, className = '' }: { children: ReactNode; bare?: boolean; className?: string }) {
  return <main className={`pl-page pl-stack pl-fade ${bare ? 'pl-page--bare' : ''} ${className}`} style={{ gap: 16 }}>{children}</main>;
}

export function Header({ title, eyebrow, back, right, save }: { title: ReactNode; eyebrow?: ReactNode; back?: string; right?: ReactNode; save?: SaveState }) {
  return (
    <header className="pl-row" style={{ alignItems: 'flex-start' }}>
      {back && <Link to={back} className="pl-btn pl-btn--ghost" aria-label="Back" style={{ minHeight: 40, padding: '0 6px', border: 0, marginLeft: -8 }}><ChevronLeft /></Link>}
      <div className="pl-grow">
        {eyebrow && <p className="pl-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {save && <SaveDot state={save} />}
      {right}
    </header>
  );
}

export function SaveDot({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const Icon = state === 'saving' ? Loader2 : state === 'saved' ? Check : AlertCircle;
  return <span className={`pl-savedot pl-savedot--${state}`} title={state}><Icon className={state === 'saving' ? 'pl-spin' : ''} /></span>;
}

export function Card({ children, accent, className = '', onClick, style }: { children: ReactNode; accent?: boolean; className?: string; onClick?: () => void; style?: React.CSSProperties }) {
  return <section className={`pl-card ${accent ? 'pl-card--accent' : ''} ${className}`} onClick={onClick} style={style}>{children}</section>;
}

export function Button({ children, primary, block, ghost, danger, small, ...rest }: { children: ReactNode; primary?: boolean; block?: boolean; ghost?: boolean; danger?: boolean; small?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} className={`pl-btn ${primary ? 'pl-btn--primary' : ''} ${block ? 'pl-btn--block' : ''} ${ghost ? 'pl-btn--ghost' : ''} ${danger ? 'pl-btn--danger' : ''} ${small ? 'pl-btn--small' : ''} ${rest.className || ''}`}>{children}</button>;
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <label className="pl-field"><span className="pl-label">{label}</span>{children}{hint && <span className="pl-hint">{hint}</span>}</label>;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`pl-input ${props.className || ''}`} />; }
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={2} {...props} className={`pl-input pl-textarea ${props.className || ''}`} />; }

/** A prompt with a free-text answer, as on a planner page. */
export function Prompt({ q, value, onChange, placeholder, rows = 2 }: { q: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="pl-prompt">
      <span className="pl-prompt__q">{q}</span>
      <textarea className="pl-input pl-textarea" rows={rows} value={value} placeholder={placeholder || 'Write a line…'} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

/** 1..n score picker (HPP scorecards use 1–5, life areas 1–10). */
export function Score({ value, max = 5, onChange, label }: { value: number | undefined; max?: number; onChange: (v: number) => void; label?: ReactNode }) {
  return (
    <div className="pl-score">
      {label && <span className="pl-score__label">{label}</span>}
      <div className="pl-score__btns" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={`pl-score__btn ${value === n ? 'is-on' : ''} ${value !== undefined && n < value ? 'is-under' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="pl-seg" role="tablist">
      {options.map(o => <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Chip({ children, on, onClick, tone }: { children: ReactNode; on?: boolean; onClick?: () => void; tone?: 'good' | 'bad' | 'amber' }) {
  return <button type="button" className={`pl-chip ${on ? 'is-on' : ''} ${tone ? `pl-chip--${tone}` : ''}`} onClick={onClick}>{children}</button>;
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'bad' | 'amber' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="pl-progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}><div className={`pl-progress__bar ${tone ? `is-${tone}` : ''}`} style={{ width: `${pct}%` }} /></div>;
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'amber' }) {
  return <div className={`pl-stat ${tone ? `pl-stat--${tone}` : ''}`}><span className="pl-stat__label">{label}</span><span className="pl-stat__value">{value}</span>{sub && <span className="pl-stat__sub">{sub}</span>}</div>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pl-sheet" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="pl-stack pl-fade" role="dialog" aria-modal>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, blurb, action }: { icon?: ReactNode; title: ReactNode; blurb?: ReactNode; action?: ReactNode }) {
  return <div className="pl-empty">{icon}<h3>{title}</h3>{blurb && <p className="pl-muted">{blurb}</p>}{action}</div>;
}

export function useToast(): [ReactNode, (msg: string, tone?: 'good' | 'bad') => void] {
  const [t, setT] = useState<{ msg: string; tone?: 'good' | 'bad' } | null>(null);
  useEffect(() => { if (!t) return; const id = window.setTimeout(() => setT(null), 2500); return () => window.clearTimeout(id); }, [t]);
  const node = t ? <div className={`pl-toast ${t.tone ? `pl-toast--${t.tone}` : ''}`} role="status">{t.msg}</div> : null;
  return [node, (msg, tone) => setT({ msg, tone })];
}

/** The little inline SVG charts: bars for weeks, a ring for a target, a line for a trend. */
export function Bars({ values, labels, max, height = 72, tone }: { values: number[]; labels?: string[]; max?: number; height?: number; tone?: 'good' | 'amber' }) {
  const m = max ?? Math.max(1, ...values);
  const w = 100, gap = 2, bw = (w - gap * (values.length - 1)) / Math.max(1, values.length);
  return (
    <div className="pl-bars">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden>
        {values.map((v, i) => { const h = Math.max(v > 0 ? 2 : 0, (v / m) * (height - 2)); return <rect key={i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={1.5} className={`pl-bars__bar ${tone ? `is-${tone}` : ''}`} />; })}
      </svg>
      {labels && <div className="pl-bars__labels">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </div>
  );
}

export function Ring({ value, max, size = 84, label, sub }: { value: number; max: number; size?: number; label?: ReactNode; sub?: ReactNode }) {
  const r = 40, c = 2 * Math.PI * r, pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="pl-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="pl-ring__track" />
        <circle cx="50" cy="50" r={r} className={`pl-ring__arc ${pct >= 1 ? 'is-full' : ''}`} strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="pl-ring__text"><b>{label}</b>{sub && <small>{sub}</small>}</div>
    </div>
  );
}

export function Line({ values, height = 60, min, max }: { values: number[]; height?: number; min?: number; max?: number }) {
  if (values.length < 2) return <div className="pl-muted" style={{ fontSize: 12 }}>Not enough points yet.</div>;
  const lo = min ?? Math.min(...values), hi = max ?? Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${height - 4 - ((v - lo) / span) * (height - 8)}`).join(' ');
  return <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden><polyline points={pts} className="pl-line" /></svg>;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
