// src/lib/workerbookContactsService.ts
import { dialerSheetsService } from './dialerSheetsService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ContactEntry {
  cnId:      string;
  firstName: string;
  lastName:  string;
  cellPhone: string;
  altPhone:  string;
  email:     string;
  shuttle:   string;
  team:      string;
  tabName:   string;   // which tab this row was found on
  isActive:  boolean;  // true if nextDay does NOT start with "To:"
  nextDay:   string;
}

export interface LoadProgress {
  current: number;
  total:   number;
  tabName: string;
}

// ─── FETCH ALL CONTRACTORS ACROSS ALL TABS ───────────────────────────────────

export async function loadAllContacts(
  sheetId: string,
  tabs: string[],
  onProgress?: (p: LoadProgress) => void,
): Promise<ContactEntry[]> {
  const results: ContactEntry[] = [];

  for (let i = 0; i < tabs.length; i++) {
    const tabName = tabs[i];
    onProgress?.({ current: i + 1, total: tabs.length, tabName });

    try {
      const rows = await dialerSheetsService.sheetsGet(
        sheetId, "'" + tabName + "'!A3:S200",
      );

      rows.forEach(row => {
        const cnId = String(row[1] ?? '').trim();
        if (!cnId) return;

        const nextDay = String(row[11] ?? '').trim();
        const isActive = !nextDay.toLowerCase().startsWith('to:');

        results.push({
          cnId,
          firstName: String(row[2]  ?? '').trim(),
          lastName:  String(row[3]  ?? '').trim(),
          cellPhone: String(row[4]  ?? '').trim(),
          altPhone:  String(row[16] ?? '').trim(),
          email:     String(row[17] ?? '').trim(),
          shuttle:   String(row[0]  ?? '').trim(),
          team:      String(row[8]  ?? '').trim(),
          tabName,
          isActive,
          nextDay,
        });
      });
    } catch {
      // skip tabs that fail — don't break the whole load
    }
  }

  return results;
}

// ─── SORT ALPHABETICALLY BY LAST NAME ────────────────────────────────────────

export function sortContacts(contacts: ContactEntry[]): ContactEntry[] {
  return [...contacts].sort((a, b) => {
    const lastCmp = a.lastName.localeCompare(b.lastName);
    if (lastCmp !== 0) return lastCmp;
    return a.firstName.localeCompare(b.firstName);
  });
}

// ─── SEARCH FILTER (NAME OR PHONE) ───────────────────────────────────────────

export function searchContacts(
  contacts: ContactEntry[],
  query: string,
): ContactEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const digitsOnly = q.replace(/\D/g, '');

  return contacts.filter(c => {
    const fullName = (c.firstName + ' ' + c.lastName).toLowerCase();
    if (fullName.includes(q)) return true;
    if (c.firstName.toLowerCase().includes(q)) return true;
    if (c.lastName.toLowerCase().includes(q)) return true;
    if (digitsOnly.length >= 3) {
      const cellDigits = c.cellPhone.replace(/\D/g, '');
      if (cellDigits.includes(digitsOnly)) return true;
    }
    return false;
  });
}

// ─── VCARD GENERATION ────────────────────────────────────────────────────────

function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function buildSingleVCard(c: ContactEntry, ccName: string): string {
  const fn = (c.firstName + ' ' + c.lastName).trim();
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:' + escapeVCardValue(c.lastName) + ';' + escapeVCardValue(c.firstName) + ';;;',
    'FN:' + escapeVCardValue(fn),
    ccName ? 'ORG:' + escapeVCardValue(ccName) : '',
    c.cellPhone ? 'TEL;TYPE=CELL:' + c.cellPhone : '',
    c.altPhone  ? 'TEL;TYPE=HOME:' + c.altPhone  : '',
    c.email     ? 'EMAIL;TYPE=INTERNET:' + escapeVCardValue(c.email) : '',
    'NOTE:' + escapeVCardValue(
      'CN ' + c.cnId +
      (c.shuttle ? ' · Shuttle ' + c.shuttle : '') +
      (c.team ? ' · ' + c.team : '')
    ),
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export function downloadVCardBundle(
  contacts: ContactEntry[],
  ccName: string,
  filename: string = 'workerbook_contacts',
): void {
  if (!contacts.length) return;
  const vcf = contacts.map(c => buildSingleVCard(c, ccName)).join('\r\n');
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\s+/g, '_') + '.vcf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ─── DEDUPE FOR BULK SAVE ────────────────────────────────────────────────────

export function dedupeForSave(contacts: ContactEntry[]): ContactEntry[] {
  const map = new Map<string, ContactEntry>();
  for (const c of contacts) {
    const existing = map.get(c.cnId);
    if (!existing) { map.set(c.cnId, c); continue; }
    if (!existing.isActive && c.isActive) map.set(c.cnId, c);
  }
  return Array.from(map.values());
}