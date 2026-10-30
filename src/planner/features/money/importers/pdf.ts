// src/planner/features/money/importers/pdf.ts — a bank statement PDF → transactions, with AI.
// The text is pulled out of the PDF on the phone (pdf.js), account and card numbers are masked, and
// planner-ai ('statement') turns the lines into rows. The original file never leaves the phone.
import { parseStatement } from '../../../lib/ai';
import { maskNumbers, normalizeMerchant, txnId } from '../lib';
import type { Txn } from '../types';

/** The statement's text, page by page, lines rebuilt from the glyph positions. */
export async function pdfText(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;   // same visual line → same bucket
      const x = it.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, s: it.str });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map(c => c.s.trim()).join('  '));
    pages.push(lines.join('\n'));
  }
  return pages;
}

/** Hide anything that looks like an account, card or phone number before the text goes anywhere. */
export function maskStatement(text: string): string {
  return maskNumbers(text)
    .replace(/\b\d{7,}\b/g, m => `#${'#'.repeat(Math.max(0, m.length - 5))}${m.slice(-4)}`)
    .replace(/\b(\d{3,5})[- ](\d{5,9})\b/g, (_, a, b) => `${'#'.repeat(a.length)}-${'#'.repeat(Math.max(0, b.length - 4))}${b.slice(-4)}`)
    .replace(/\b\d{3}[- .]\d{3}[- .]\d{4}\b/g, '###-###-####');
}

export interface PdfResult { txns: Txn[]; period?: { from: string; to: string }; accountType?: string; pages: number }

export async function importPdf(file: File, accountId: string): Promise<PdfResult> {
  const pages = await pdfText(file);
  const text = maskStatement(pages.join('\n\n--- page ---\n\n'));
  if (text.replace(/\s/g, '').length < 40) throw new Error("That PDF has no readable text (a scan?). Download the statement from EasyWeb instead.");
  const r = await parseStatement(text, `File name: ${file.name}`);
  const out: Txn[] = [];
  const seen = new Map<string, number>();
  for (const row of r.rows) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : null;
    const amount = typeof row.amount === 'number' && isFinite(row.amount) ? Math.round(row.amount * 100) / 100 : null;
    if (!date || amount === null || !row.desc) continue;
    const desc = maskNumbers(String(row.desc).trim());
    const balance = typeof row.balance === 'number' && isFinite(row.balance) ? Math.round(row.balance * 100) / 100 : undefined;
    const base = `${date}|${desc}|${amount}|${balance}`;
    const n = seen.get(base) || 0; seen.set(base, n + 1);
    out.push({ id: txnId(accountId, date, desc, amount, balance, n), date, desc, merchant: normalizeMerchant(desc), amount, balance, accountId, category: 'Other', source: 'ai' });
  }
  return { txns: out, period: r.period, accountType: r.account_type, pages: pages.length };
}
