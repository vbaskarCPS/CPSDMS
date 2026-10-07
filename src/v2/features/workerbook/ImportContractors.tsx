// src/v2/features/workerbook/ImportContractors.tsx — load the Workerbook Contractors tab from a downloaded file.
import React, { useState } from 'react';
import { parseContractorSheet, readSheetFile, importContractors, type ImportRow, type ImportResult } from '../../lib/workerbook';
import { Btn, ErrorBox, Modal, Tag } from '../../ui';

const CHUNK = 400;

export const ImportContractors: React.FC<{ centerId: string; centerName: string; year: number; onClose: () => void; onDone: () => void }> =
  ({ centerId, centerName, year, onClose, onDone }) => {
    const [parsed, setParsed] = useState<{ rows: ImportRow[]; columns: string[]; ignored: string[]; sheet: string; file: string } | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const pick = async (file: File | undefined) => {
      if (!file) return;
      setError(null); setParsed(null); setResult(null); setBusy(true);
      try {
        const { grid, sheet } = await readSheetFile(file);
        const p = parseContractorSheet(grid);
        if (!p.rows.length) throw new Error('No contractor rows found under the header.');
        setParsed({ ...p, sheet, file: file.name });
      } catch (e) { setError(e); } finally { setBusy(false); }
    };

    const run = async () => {
      if (!parsed) return;
      setBusy(true); setError(null);
      try {
        const total: ImportResult = { read: 0, new_people: 0, new_hires: 0, updated: 0, skipped: [] };
        for (let i = 0; i < parsed.rows.length; i += CHUNK) {
          const r = await importContractors(centerId, year, parsed.rows.slice(i, i + CHUNK));
          total.read += r.read; total.new_people += r.new_people; total.new_hires += r.new_hires; total.updated += r.updated;
          total.skipped.push(...r.skipped.map(s => ({ ...s, row: s.row + i })));
        }
        setResult(total); onDone();
      } catch (e) { setError(e); } finally { setBusy(false); }
    };

    return (
      <Modal wide title={`Import contractors · ${centerName} · ${year}`} onClose={onClose}
        footer={result ? <Btn onClick={onClose}>Done</Btn> : <>
          <Btn kind="o" onClick={onClose}>Cancel</Btn>
          <Btn disabled={!parsed || busy} onClick={run}>{busy && parsed ? 'Importing…' : parsed ? `Import ${parsed.rows.length} rows` : 'Import'}</Btn>
        </>}>
        <ErrorBox error={error} />
        {!result && (
          <>
            <p style={{ marginTop: 0 }}>In the Workerbook sheet choose <b>File › Download › Microsoft Excel (.xlsx)</b>, then pick that file here.
              The <b>Contractors</b> tab is read. Running it again later updates people instead of adding them twice.</p>
            <label className="v2-btn o" style={{ cursor: 'pointer' }}>
              Choose file…
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0])} />
            </label>
            {busy && !parsed && <span className="v2-mut" style={{ marginLeft: 10 }}>Reading…</span>}
          </>
        )}
        {parsed && !result && (
          <div style={{ marginTop: 16 }}>
            <div className="v2-row" style={{ marginBottom: 8 }}>
              <b>{parsed.file}</b><span className="v2-mut">· tab “{parsed.sheet}” · {parsed.rows.length} rows</span>
            </div>
            <div className="v2-small" style={{ marginBottom: 6 }}>Reading: {parsed.columns.map(c => <Tag key={c} tone="b">{c}</Tag>)}</div>
            {parsed.ignored.length > 0 && <div className="v2-small v2-mut" style={{ marginBottom: 10 }}>Not imported: {parsed.ignored.join(', ')}</div>}
            <div className="v2-table-wrap" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <table className="v2-table">
                <thead><tr><th>CN #</th><th>Name</th><th>Cell</th><th>Email</th><th>Shuttle</th><th>Status</th><th>Days</th><th>NS</th><th>Hats</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td><b>{r.cn || <span style={{ color: '#b91c1c' }}>missing</span>}</b></td>
                      <td>{r.first} {r.last}</td><td>{r.cell || '—'}</td><td>{r.email || '—'}</td><td>{r.shuttle || '—'}</td>
                      <td>{r.status || 'Active'}</td><td>{r.days ?? '—'}</td><td>{r.ns ?? '—'}</td>
                      <td className="v2-small">{r.hats ? Object.entries(r.hats).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > 50 && <div className="v2-note">Showing the first 50 of {parsed.rows.length}.</div>}
          </div>
        )}
        {result && (
          <div>
            <div className="v2-ok" style={{ marginBottom: 12 }}>
              Read {result.read} rows · {result.new_hires} new contractors ({result.new_people} new people) · {result.updated} updated · {result.skipped.length} skipped
            </div>
            {result.skipped.length > 0 && (
              <div className="v2-table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
                <table className="v2-table">
                  <thead><tr><th>Row</th><th>CN #</th><th>Why it was skipped</th></tr></thead>
                  <tbody>{result.skipped.map((s, i) => <tr key={i}><td>{s.row}</td><td>{s.cn || '—'}</td><td>{s.reason}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    );
  };
