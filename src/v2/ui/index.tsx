// src/v2/ui/index.tsx — small light-theme kit for the new app shell.
import React, { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

export const COLORS = {
  blue: '#2563eb', green: '#059669', amber: '#d97706', violet: '#7c3aed',
  rose: '#e11d48', sky: '#0284c7', teal: '#0d9488', slate: '#475569',
} as const;
export type ColorName = keyof typeof COLORS;

export const Tile: React.FC<{
  icon: LucideIcon; label: string; color: ColorName; sub?: string; badge?: string | number | null;
  on?: boolean; disabled?: boolean; soon?: boolean; onClick?: () => void;
}> = ({ icon: Icon, label, color, sub, badge, on, disabled, soon, onClick }) => {
  const c = COLORS[color];
  const off = disabled || soon;
  return (
    <button type="button" className={`v2-tile${on ? ' on' : ''}${off ? ' off' : ''}`} onClick={off ? undefined : onClick} aria-disabled={off}>
      {soon ? <span className="v2-badge" style={{ background: '#94a3b8' }}>Soon</span>
        : badge ? <span className="v2-badge" style={{ background: c }}>{badge}</span> : null}
      <span className="ib" style={{ background: `${c}1a` }}><Icon size={26} color={c} /></span>
      <b>{label}</b>
      {sub && <span className="sub">{sub}</span>}
    </button>
  );
};

export const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; className?: string }> =
  ({ title, right, children, style, className }) => (
    <div className={`v2-card ${className || ''}`} style={style}>
      {(title || right) && <div className="v2-card-h">{title}<span className="v2-spacer" />{right}</div>}
      {children}
    </div>
  );

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'o' | 'g' | 'r'; size?: 'sm'; icon?: LucideIcon }> =
  ({ kind, size, icon: Icon, className, children, ...rest }) => (
    <button type="button" {...rest} className={`v2-btn ${kind || ''} ${size || ''} ${className || ''}`}>
      {Icon && <Icon size={size === 'sm' ? 13 : 15} />}{children}
    </button>
  );

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="v2-field" style={{ display: 'block' }}>
    <span className="v2-label">{label}</span>
    {children}
    {hint && <span className="v2-note" style={{ display: 'block', marginTop: 4 }}>{hint}</span>}
  </label>
);

export const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    className={`v2-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
);

export const Tag: React.FC<{ tone?: 'g' | 'a' | 'b' | 'v' | 'r'; children: React.ReactNode }> = ({ tone, children }) =>
  <span className={`v2-tag ${tone || ''}`}>{children}</span>;

export function Tabs<T extends string>({ items, value, onChange }: { items: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="v2-tabs" role="tablist">
      {items.map(i => (
        <button key={i.key} role="tab" aria-selected={value === i.key} className={value === i.key ? 'on' : ''} onClick={() => onChange(i.key)}>
          {i.label}{i.count !== undefined && <span className="v2-mut" style={{ marginLeft: 6, fontSize: 11 }}>{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Modal: React.FC<{ title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }> =
  ({ title, onClose, children, footer, wide }) => {
    useEffect(() => {
      const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', k);
      return () => window.removeEventListener('keydown', k);
    }, [onClose]);
    return (
      <div className="v2-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="v2-modal" style={wide ? { maxWidth: 960 } : undefined} role="dialog" aria-modal="true">
          <div className="v2-modal-h"><b style={{ fontSize: 16 }}>{title}</b><span className="v2-spacer" />
            <button type="button" className="v2-gbtn" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close"><X size={16} /></button></div>
          <div className="v2-modal-b">{children}</div>
          {footer && <div className="v2-modal-f">{footer}</div>}
        </div>
      </div>
    );
  };

export const ErrorBox: React.FC<{ error: unknown }> = ({ error }) =>
  error ? <div className="v2-err">{error instanceof Error ? error.message : String((error as { message?: string })?.message || error)}</div> : null;

export const Loading: React.FC<{ label?: string }> = ({ label }) => <div className="v2-mut" style={{ padding: 20 }}>{label || 'Loading…'}</div>;
