// src/pages/SuperAdmin/MapAccessModal.tsx
//
// Super Admin → Map Logsheet Access. Two ways onto the map-based logsheet:
//   - Command centres: every worker logged into an opened centre
//     (public.map_logsheet_cc_access).
//   - Contractors: individual contractor ids, any centre
//     (public.map_logsheet_access).
// Either one is enough. A worker still needs a team season with digital
// mapping on; otherwise they get the ordinary logsheet.

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader, AlertCircle, MapPinned, Building2, User } from 'lucide-react';
import {
  MapAccessEntry, fetchMapAccessList, addMapAccess, removeMapAccess,
  MapCcAccessEntry, fetchMapCcAccessList, addMapCcAccess, removeMapCcAccess,
} from '../../lib/mapLogsheetService';
import { commandCenterService, CommandCenter } from '../../lib/commandCenterService';

interface MapAccessModalProps {
  onClose: () => void;
}

type Tab = 'centres' | 'contractors';

const MapAccessModal: React.FC<MapAccessModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>('centres');
  const [error, setError] = useState<string | null>(null);

  // --- contractors ---
  const [entries, setEntries] = useState<MapAccessEntry[]>([]);
  const [loadingIds, setLoadingIds] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newNote, setNewNote] = useState('');

  // --- command centres ---
  const [centres, setCentres] = useState<CommandCenter[]>([]);
  const [ccEntries, setCcEntries] = useState<MapCcAccessEntry[]>([]);
  const [loadingCcs, setLoadingCcs] = useState(true);
  const [ccBusy, setCcBusy] = useState<string | null>(null);
  const [ccNotes, setCcNotes] = useState<Record<string, string>>({});

  const loadIds = async () => {
    setLoadingIds(true);
    try {
      setEntries(await fetchMapAccessList());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the contractor list');
    } finally {
      setLoadingIds(false);
    }
  };

  const loadCcs = async () => {
    setLoadingCcs(true);
    try {
      const [all, opened] = await Promise.all([commandCenterService.getAllCommandCenters(), fetchMapCcAccessList()]);
      setCentres(all);
      setCcEntries(opened);
      setCcNotes(Object.fromEntries(opened.map(e => [e.commandCenterId, e.note || ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load command centres');
    } finally {
      setLoadingCcs(false);
    }
  };

  useEffect(() => { loadIds(); loadCcs(); }, []);

  // --- contractor handlers ---
  const handleAdd = async () => {
    const id = newId.trim().toUpperCase();
    if (!id) { setError('Enter a contractor id.'); return; }
    setSaving(true); setError(null);
    try {
      await addMapAccess(id, newNote);
      setNewId(''); setNewNote('');
      await loadIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that id');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(`Remove ${id} from the map logsheet? They'll get the ordinary logsheet at next login (unless their command centre is opened).`)) return;
    setRemoving(id); setError(null);
    try {
      await removeMapAccess(id);
      await loadIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that id');
    } finally {
      setRemoving(null);
    }
  };

  // --- command centre handlers ---
  const openedIds = new Set(ccEntries.map(e => e.commandCenterId));

  const toggleCc = async (cc: CommandCenter) => {
    const isOpen = openedIds.has(cc.id);
    if (isOpen && !window.confirm(`Close the map logsheet for ${cc.displayName || cc.username}? Its workers get the ordinary logsheet at next login (unless they're on the contractor list).`)) return;
    setCcBusy(cc.id); setError(null);
    try {
      if (isOpen) await removeMapCcAccess(cc.id);
      else await addMapCcAccess(cc.id, ccNotes[cc.id] || '');
      await loadCcs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that command centre');
    } finally {
      setCcBusy(null);
    }
  };

  const saveCcNote = async (cc: CommandCenter) => {
    if (!openedIds.has(cc.id)) return;
    const current = ccEntries.find(e => e.commandCenterId === cc.id)?.note || '';
    if ((ccNotes[cc.id] || '') === current) return;
    setCcBusy(cc.id); setError(null);
    try {
      await addMapCcAccess(cc.id, ccNotes[cc.id] || '');
      await loadCcs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note');
    } finally {
      setCcBusy(null);
    }
  };

  const tabBtn = (t: Tab, label: string, Icon: typeof Building2, count: number) => (
    <button
      onClick={() => setTab(t)}
      className={`flex-1 px-3 py-2 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 ${tab === t ? 'bg-yellow-600 text-black' : 'text-gray-400 hover:text-white'}`}
    >
      <Icon size={14} /> {label} <span className={`px-1.5 rounded-full text-[10px] ${tab === t ? 'bg-black/20' : 'bg-gray-700'}`}>{count}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg max-h-[90vh] flex flex-col border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <MapPinned size={18} className="text-yellow-400" />
            <h2 className="text-lg font-bold text-white">Map Logsheet Access</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={22} /></button>
        </div>

        <div className="px-4 pt-3 text-[11px] text-gray-400 italic">
          A worker gets the map-based logsheet if their command centre is opened OR their contractor id is listed. They still need a team season with digital mapping on.
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700 gap-1">
            {tabBtn('centres', 'Command centres', Building2, ccEntries.length)}
            {tabBtn('contractors', 'Contractors', User, entries.length)}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* ── COMMAND CENTRES ── */}
        {tab === 'centres' && (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {loadingCcs ? (
              <div className="flex items-center justify-center py-8 text-gray-500"><Loader size={20} className="animate-spin" /></div>
            ) : centres.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No command centres found.</p>
            ) : (
              <div className="border border-gray-700 rounded-lg divide-y divide-gray-700">
                {centres.map(cc => {
                  const isOpen = openedIds.has(cc.id);
                  const busy = ccBusy === cc.id;
                  const entry = ccEntries.find(e => e.commandCenterId === cc.id);
                  return (
                    <div key={cc.id} className="px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-white truncate">{cc.displayName || cc.username}</div>
                          <div className="text-[10px] text-gray-500 flex items-center gap-2">
                            <span className="font-mono">{cc.username}</span>
                            {!cc.digitalMappingEnabled && <span className="text-gray-600">· CC mapping off (manager maps only)</span>}
                            {entry && <span>· opened {new Date(entry.createdAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => toggleCc(cc)}
                          disabled={busy}
                          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${isOpen ? 'bg-yellow-500' : 'bg-gray-600'}`}
                          title={isOpen ? 'Opened — tap to close' : 'Closed — tap to open'}
                          aria-label={isOpen ? 'Close' : 'Open'}
                        >
                          {busy
                            ? <Loader size={12} className="animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
                            : <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${isOpen ? 'left-[22px]' : 'left-0.5'}`} />}
                        </button>
                      </div>
                      {isOpen && (
                        <input
                          value={ccNotes[cc.id] ?? ''}
                          onChange={e => setCcNotes(prev => ({ ...prev, [cc.id]: e.target.value }))}
                          onBlur={() => saveCcNote(cc)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          placeholder="Note (optional)"
                          disabled={busy}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-yellow-500"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CONTRACTORS ── */}
        {tab === 'contractors' && (
          <>
            <div className="p-4 grid grid-cols-[7rem_1fr_auto] gap-2 items-end">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Contractor id</label>
                <input
                  value={newId}
                  onChange={e => setNewId(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                  placeholder="H01"
                  disabled={saving}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white font-mono text-sm focus:outline-none focus:border-yellow-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Note <span className="text-gray-600 font-normal">— optional</span></label>
                <input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                  placeholder="e.g. Vijay's tablet"
                  disabled={saving}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm focus:outline-none focus:border-yellow-500"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !newId.trim()}
                className="h-[38px] px-3 rounded bg-yellow-600 hover:bg-yellow-500 text-black font-bold text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
              {loadingIds ? (
                <div className="flex items-center justify-center py-8 text-gray-500"><Loader size={20} className="animate-spin" /></div>
              ) : entries.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No individual contractors listed.</p>
              ) : (
                <div className="border border-gray-700 rounded-lg divide-y divide-gray-700">
                  {entries.map(e => (
                    <div key={e.contractorId} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-mono font-bold text-white bg-gray-900 border border-gray-700 px-2 py-0.5 rounded text-sm">{e.contractorId}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 truncate">{e.note || <span className="text-gray-600">—</span>}</div>
                        <div className="text-[10px] text-gray-500">added {new Date(e.createdAt).toLocaleDateString()}</div>
                      </div>
                      <button
                        onClick={() => handleRemove(e.contractorId)}
                        disabled={removing === e.contractorId}
                        className="p-1.5 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                        title="Remove"
                      >
                        {removing === e.contractorId ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MapAccessModal;
