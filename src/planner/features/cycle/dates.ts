// src/planner/features/cycle/dates.ts — calendar-day arithmetic on YYYY-MM-DD keys (no 4 am shift here).
export const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (k: string): Date => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k: string, n: number): string => { const d = parse(k); d.setDate(d.getDate() + n); return toKey(d); };
export const diffDays = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
export const monthKey = (k: string): string => k.slice(0, 7);
export const daysInMonth = (ym: string): number => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const shiftMonth = (ym: string, by: number): string => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const fmtDay = (k: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string => parse(k).toLocaleDateString([], opts);
export const fmtMonth = (ym: string): string => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
export const fmtShortMonth = (ym: string): string => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'short' });
