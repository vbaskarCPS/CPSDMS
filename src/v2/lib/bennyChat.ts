// src/v2/lib/bennyChat.ts — the upload chat: what The Benny is told about an upload, and how the
// changes it asks for are applied to the layout. The Benny never edits data directly: it can only
// say what a column means, change the list's settings, or leave rows out; each change is checked
// here, applied to the layout, and listed under its reply so the person sees exactly what moved.
import { cleanProvince, FIELDS, SERVICE_LINES, type ColumnRule, type Field, type Mapping, type ServiceLine } from './clientImport';
import type { ChatAction } from './clients';

const FIELD_KEYS = new Set<string>(FIELDS.map(f => f.key));
const LINE_KEYS = new Set<string>(SERVICE_LINES.map(l => l.key));
const fieldLabel = (f: Field) => FIELDS.find(x => x.key === f)?.label || f;
const year = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null; };
const text = (v: unknown, n = 40) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;

/** Apply The Benny's changes to a layout. Returns the new layout and one plain line per change. */
export function applyChatActions(mapping: Mapping, actions: ChatAction[], headers: string[]): { mapping: Mapping; changes: string[] } {
  let m: Mapping = { ...mapping, columns: { ...mapping.columns } };
  const changes: string[] = [];
  const colName = (i: number) => `“${headers[i] || `column ${i + 1}`}”`;
  for (const a of actions) {
    const input = (a.input || {}) as Record<string, unknown>;
    if (a.tool === 'set_columns') {
      for (const c of (Array.isArray(input.changes) ? input.changes : []) as Record<string, unknown>[]) {
        const i = Number(c.index);
        if (!Number.isInteger(i) || i < 0 || i >= headers.length) continue;
        if (typeof c.field !== 'string' || !FIELD_KEYS.has(c.field)) continue;
        const rule: ColumnRule = { field: c.field as Field };
        const y = year(c.year); if (y) rule.year = y;
        const t = text(c.tag); if (t && rule.field === 'tag') rule.tag = t;
        const sv = text(c.service, 20); if (sv && rule.field === 'serviced') rule.service = sv;
        m.columns[String(i)] = rule;
        changes.push(`${colName(i)} → ${fieldLabel(rule.field)}${rule.year ? ` (${rule.year})` : ''}${rule.tag ? ` “${rule.tag}”` : ''}`);
      }
    } else if (a.tool === 'set_list_settings') {
      if ('headerRow' in input) {
        const r = Number(input.headerRow);
        if (Number.isInteger(r) && r >= 1 && r <= 50) { m = { ...m, headerRow: r - 1 }; changes.push(`Titles are on row ${r}`); }
      }
      if ('defaultYear' in input) { const y = year(input.defaultYear); m = { ...m, defaultYear: y }; changes.push(y ? `Year when the list has none: ${y}` : 'No default year'); }
      if ('defaultService' in input) { const v = text(input.defaultService, 20); m = { ...m, defaultService: v }; changes.push(v ? `Service when the list has none: ${v}` : 'No default service'); }
      if (typeof input.serviceLine === 'string' && LINE_KEYS.has(input.serviceLine)) {
        m = { ...m, serviceLine: input.serviceLine as ServiceLine };
        changes.push(`Past clients of ${SERVICE_LINES.find(l => l.key === input.serviceLine)?.label}`);
      }
      if ('defaultCity' in input) { const v = text(input.defaultCity); m = { ...m, defaultCity: v }; changes.push(v ? `City when the list has none: ${v}` : 'No default city'); }
      if ('defaultProvince' in input) { const v = text(input.defaultProvince, 20); const p = v ? cleanProvince(v) || null : null; m = { ...m, defaultProvince: p }; changes.push(p ? `Province: ${p}` : 'No default province'); }
      if (Array.isArray(input.yesValues)) {
        const ys = input.yesValues.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().slice(0, 20)).slice(0, 20);
        m = { ...m, yesValues: ys }; changes.push(`Values that mean yes: ${ys.join(', ') || 'the usual ones'}`);
      }
    } else if (a.tool === 'skip_rows') {
      const rows = (Array.isArray(input.rows) ? input.rows : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5000);
      if (!rows.length) continue;
      const set = new Set(m.skipRows || []);
      for (const r of rows) { if (input.skip === false) set.delete(r); else set.add(r); }
      m = { ...m, skipRows: [...set].sort((x, y) => x - y) };
      const list = rows.length > 8 ? `${rows.slice(0, 8).join(', ')} and ${rows.length - 8} more` : rows.join(', ');
      changes.push(`${input.skip === false ? 'Brought back' : 'Left out'} row${rows.length === 1 ? '' : 's'} ${list}${text(input.reason, 80) ? ` (${text(input.reason, 80)})` : ''}`);
    }
  }
  return { mapping: m, changes };
}

/** What The Benny opens the chat with, after reading the layout. */
export function openingMessage(questions: string[], fromRecipe: boolean): string {
  if (questions.length) {
    return `I’ve read the file. ${questions.length === 1 ? 'One thing' : 'A few things'} I couldn’t tell from it:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
  }
  return fromRecipe
    ? 'This file has the same layout as one you’ve imported before, so I used that. Ask me anything about it, or tell me what to change.'
    : 'I’ve read the file. Ask me anything about it, or tell me what to change: what a column means, the year, the service, or rows to leave out.';
}

/** The question the app asks for The Benny once the addresses are matched to routes. */
export const REVIEW_PROMPT = 'I’ve matched the addresses to routes. In a few lines: what stands out in these results, and is there anything you need me to decide before I approve the import?';
