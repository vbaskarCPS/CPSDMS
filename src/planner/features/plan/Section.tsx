// src/planner/features/plan/Section.tsx — a collapsible card on the day page.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Section({ title, meta, open: initial = true, done, children }: { title: ReactNode; meta?: ReactNode; open?: boolean; done?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={`pl-card plan-section ${done ? 'is-done' : ''}`}>
      <button type="button" className="plan-section__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <h2>{title}</h2>
        {meta && <span className="plan-section__meta">{meta}</span>}
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
      </button>
      {open && <div className="plan-section__body pl-fade">{children}</div>}
    </section>
  );
}
