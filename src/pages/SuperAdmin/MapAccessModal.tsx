// src/pages/SuperAdmin/MapAccessModal.tsx
//
// Super Admin → Map Logsheet Access. The global list of contractor ids that
// get the map-based logsheet (public.map_logsheet_access). A worker on this
// list still needs a team season with digital mapping, exactly as H01 did.

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader, AlertCircle, MapPinned } from 'lucide-react';
import { MapAccessEntry, fetchMapAccessList, addMapAccess, removeMapAccess } from '../../lib/mapLogsheetService';

interface MapAccessModalProps {
  onClose: () => void;
}

const MapAccessModal: React.FC<MapAccessModalProps> = ({ onClose }) => {
  const [entries, setEntries] = useState<MapAccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newNote, setNewNote] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setEntries(await fetchMapAccessList());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the access list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const id = newId.trim().toUpperCase();
    if (!id) { setError('Enter a contractor id.'); return; }
    setSaving(true); setError(null);
    try {
      await addMapAccess(id, newNote);
      setNewId(''); setNewNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that id');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(`Remove ${id} from the map logsheet? They'll get the ordinary logsheet at next login.`)) return;
    setRemoving(id); setError(null);
    try {
      await removeMapAccess(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that id');
    } finally {
      setRemoving(null);
    }
  };

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
          Contractor ids on this list get the map-based logsheet instead of the ordinary one. They still need a team season with digital mapping on.
        </div>

        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Add form */}
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

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500"><Loader size={20} className="animate-spin" /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">Nobody on the list — every worker gets the ordinary logsheet.</p>
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
      </div>
    </div>
  );
};

export default MapAccessModal;
