// src/planner/features/money/importers/index.ts — where bank data comes from. Today: CSV files
// (TD EasyWeb, or any CSV with a header row). A Plaid importer would slot in here later.
import Papa from 'papaparse';
import type { Txn } from '../types';
import { tdImporter } from './td';
import { genericImporter } from './generic';

export interface Importer {
  name: string;
  /** Does this importer recognize these rows? */
  detect(rows: string[][]): boolean;
  parse(rows: string[][], accountId: string): Txn[];
}

export const importers: Importer[] = [tdImporter, genericImporter];

export function parseCsv(text: string): string[][] {
  const { data } = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return (data as string[][]).map(r => r.map(c => (c ?? '').toString().trim()));
}

export function importCsv(text: string, accountId: string): { importer: Importer; txns: Txn[] } | null {
  const rows = parseCsv(text);
  if (!rows.length) return null;
  const imp = importers.find(i => i.detect(rows));
  if (!imp) return null;
  return { importer: imp, txns: imp.parse(rows, accountId) };
}

/** "10/30/2026" | "2026-10-30" | "30/10/2026" (when the first part can't be a month) → YYYY-MM-DD */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (a > 12 && b <= 12) [a, b] = [b, a];   // DD/MM/YYYY
    if (a < 1 || a > 12 || b < 1 || b > 31) return null;
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  const d = new Date(t);
  if (!isNaN(d.getTime()) && /[A-Za-z]/.test(t)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return null;
}
export function parseAmount(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace('−', '-');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
}
