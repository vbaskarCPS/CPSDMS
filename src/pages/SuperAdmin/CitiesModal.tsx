// src/pages/SuperAdmin/CitiesModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, Edit2, Check, Loader, MapPin, AlertCircle,
} from 'lucide-react';
import {
  reportingService, PayableCity, CitySplitShare, RegionSplits,
  validateRegionSplitTotal,
} from '../../lib/reportingService';
import { Region } from '../../types';

interface CitiesModalProps {
  onClose: () => void;
  onChanged: () => void;   // tell ReportingView to refresh its city list
}

const REGIONS: Region[] = ['West', 'Central', 'East'];

const REGION_STYLES: Record<Region, { dot: string; text: string }> = {
  West:    { dot: 'bg-blue-500',   text: 'text-blue-300' },
  Central: { dot: 'bg-green-500',  text: 'text-green-300' },
  East:    { dot: 'bg-orange-500', text: 'text-orange-300' },
};

type EditSplits = Record<Region, CitySplitShare[]>;

const emptySplits = (): EditSplits => ({ West: [], Central: [], East: [] });

const CitiesModal: React.FC<CitiesModalProps> = ({ onClose, onChanged }) => {
  const [cities, setCities] = useState<PayableCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');   // '' = new city
  const [editName, setEditName] = useState('');
  const [editPrefixes, setEditPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState('');
  const [editSplits, setEditSplits] = useState<EditSplits>(emptySplits());

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { loadCities(); }, []);

  const loadCities = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCities(await reportingService.getPayableCities());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load cities');
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (city?: PayableCity) => {
    setFormError(null);
    setPrefixInput('');
    if (city) {
      setEditingId(city.id);
      setEditName(city.name);
      setEditPrefixes([...city.prefixes]);
      setEditSplits({
        West: city.regionSplits.West ? city.regionSplits.West.map((s) => ({ ...s })) : [],
        Central: city.regionSplits.Central ? city.regionSplits.Central.map((s) => ({ ...s })) : [],
        East: city.regionSplits.East ? city.regionSplits.East.map((s) => ({ ...s })) : [],
      });
    } else {
      setEditingId('');
      setEditName('');
      setEditPrefixes([]);
      setEditSplits(emptySplits());
    }
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setFormError(null);
  };

  // --- Prefix editing ---
  const addPrefix = () => {
    const p = prefixInput.trim().toUpperCase();
    setPrefixInput('');
    if (!p) return;
    if (editPrefixes.some((x) => x.toUpperCase() === p)) return;
    setEditPrefixes([...editPrefixes, p]);
  };

  const removePrefix = (p: string) => setEditPrefixes(editPrefixes.filter((x) => x !== p));

  // --- Share row editing ---
  const addShareRow = (region: Region) => {
    setEditSplits({ ...editSplits, [region]: [...editSplits[region], { city: '', percent: 0 }] });
  };

  const updateShareRow = (region: Region, idx: number, field: 'city' | 'percent', value: string) => {
    const rows = editSplits[region].map((r, i) => {
      if (i !== idx) return r;
      return field === 'city' ? { ...r, city: value } : { ...r, percent: parseFloat(value) || 0 };
    });
    setEditSplits({ ...editSplits, [region]: rows });
  };

  const removeShareRow = (region: Region, idx: number) => {
    setEditSplits({ ...editSplits, [region]: editSplits[region].filter((_, i) => i !== idx) });
  };

  const regionTotal = (region: Region): number =>
    editSplits[region].reduce((sum, r) => sum + (Number(r.percent) || 0), 0);

  // City names available to reference in a share row (all payable cities + this one).
  const cityNameOptions = Array.from(
    new Set([...cities.map((c) => c.name), editName].filter(Boolean))
  );

  const saveCity = async () => {
    setFormError(null);

    const name = editName.trim();
    if (!name) { setFormError('Give the city a name.'); return; }

    // Prefix uniqueness across other cities.
    const owners = new Map<string, string>();
    cities.forEach((c) => {
      if (c.id === editingId) return;
      c.prefixes.forEach((p) => owners.set(p.toUpperCase(), c.name));
    });
    for (const p of editPrefixes) {
      const owner = owners.get(p.toUpperCase());
      if (owner) { setFormError(`Prefix "${p}" already belongs to ${owner}.`); return; }
    }

    // Validate each configured region (empty regions are allowed = unattributed).
    for (const region of REGIONS) {
      const rows = editSplits[region];
      if (rows.length === 0) continue;
      if (rows.some((r) => !r.city)) { setFormError(`${region}: every share row needs a city selected.`); return; }
      if (!validateRegionSplitTotal(rows)) {
        setFormError(`${region}: shares must total 100% (currently ${regionTotal(region)}%).`);
        return;
      }
    }

    // Build regionSplits, omitting empty regions.
    const regionSplits: RegionSplits = {};
    for (const region of REGIONS) {
      if (editSplits[region].length > 0) {
        regionSplits[region] = editSplits[region].map((r) => ({ city: r.city, percent: Number(r.percent) || 0 }));
      }
    }

    setSaving(true);
    try {
      if (editingId) {
        await reportingService.updatePayableCity(editingId, { name, prefixes: editPrefixes, regionSplits });
      } else {
        await reportingService.createPayableCity({ name, prefixes: editPrefixes, regionSplits });
      }
      await loadCities();
      onChanged();
      closeEditor();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save city');
    } finally {
      setSaving(false);
    }
  };

  const deleteCity = async (city: PayableCity) => {
    if (!window.confirm(`Delete "${city.name}"? Any other city that points at it in a split will need fixing.`)) return;
    try {
      await reportingService.deletePayableCity(city.id);
      await loadCities();
      onChanged();
      if (editingId === city.id) closeEditor();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete city');
    }
  };

  // Compact summary of which regions a city has configured.
  const regionSummary = (city: PayableCity) => (
    <div className="flex items-center gap-2">
      {REGIONS.map((r) => {
        const rows = city.regionSplits[r];
        const set = rows && rows.length > 0;
        return (
          <span key={r} className={`text-[10px] ${set ? REGION_STYLES[r].text : 'text-gray-600'}`}>
            {r[0]}{set ? '\u2713' : '\u2013'}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* HEADER */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
          <h2 className="text-lg font-bold text-white">Payable Cities</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          {loadError && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle size={16} /> <span>{loadError}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader className="animate-spin text-purple-400" size={26} /></div>
          ) : (
            <>
              {/* CITY LIST */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">
                  {cities.length === 0
                    ? 'Create your cities first, then open each to set its region shares.'
                    : 'Open a city to set how its sales split across regions.'}
                </p>
                <button
                  onClick={() => openEditor()}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Plus size={14} /> Add city
                </button>
              </div>

              {cities.length > 0 && (
                <div className="space-y-1.5">
                  {cities.map((city) => (
                    <div key={city.id} className="flex items-center gap-3 bg-gray-900 rounded-lg border border-gray-700 px-3 py-2">
                      <MapPin size={14} className="text-purple-400 flex-shrink-0" />
                      <span className="font-medium text-gray-200 text-sm">{city.name}</span>
                      <span className="text-xs text-gray-500">
                        {city.prefixes.length ? city.prefixes.join(', ') : 'no prefixes'}
                      </span>
                      <div className="ml-auto flex items-center gap-3">
                        {regionSummary(city)}
                        <button onClick={() => openEditor(city)} className="text-gray-400 hover:text-white p-1" title="Edit"><Edit2 size={14} /></button>
                        <button onClick={() => deleteCity(city)} className="text-red-400 hover:text-red-300 p-1" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* EDITOR */}
              {editorOpen && (
                <div className="bg-gray-900 rounded-xl border border-purple-800/50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{editingId ? 'Edit city' : 'New city'}</h3>
                    <button onClick={closeEditor} className="text-gray-500 hover:text-white text-xs">Cancel</button>
                  </div>

                  {/* NAME */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">City name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g., Hamilton"
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none text-sm"
                    />
                  </div>

                  {/* PREFIXES */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Contractor prefixes <span className="text-gray-600">(e.g. H, or E and EDM)</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {editPrefixes.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 bg-gray-700 text-gray-200 text-xs rounded px-2 py-1">
                          {p}
                          <button onClick={() => removePrefix(p)} className="text-gray-400 hover:text-white"><X size={11} /></button>
                        </span>
                      ))}
                      {editPrefixes.length === 0 && <span className="text-xs text-gray-600">No prefixes yet.</span>}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={prefixInput}
                        onChange={(e) => setPrefixInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrefix(); } }}
                        placeholder="Type a prefix, press Enter"
                        className="flex-1 bg-gray-800 border border-gray-600 rounded-lg py-1.5 px-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none text-sm uppercase"
                      />
                      <button onClick={addPrefix} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"><Plus size={14} /> Add</button>
                    </div>
                  </div>

                  {/* REGION SHARES */}
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-gray-400">Region shares</label>
                    {REGIONS.map((region) => {
                      const rows = editSplits[region];
                      const total = regionTotal(region);
                      const valid = rows.length === 0 || Math.abs(total - 100) < 0.01;
                      return (
                        <div key={region} className="bg-gray-800/60 rounded-lg border border-gray-700 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${REGION_STYLES[region].dot}`} />
                              {region}
                            </span>
                            {rows.length === 0 ? (
                              <span className="text-[11px] text-gray-500">unconfigured → unattributed</span>
                            ) : (
                              <span className={`text-[11px] ${valid ? 'text-green-400' : 'text-amber-400'}`}>total {total}%</span>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            {rows.map((row, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <select
                                  value={row.city}
                                  onChange={(e) => updateShareRow(region, idx, 'city', e.target.value)}
                                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg py-1.5 px-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                >
                                  <option value="">Select city…</option>
                                  {cityNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                                <input
                                  type="number"
                                  value={row.percent === 0 ? '' : row.percent}
                                  onChange={(e) => updateShareRow(region, idx, 'percent', e.target.value)}
                                  placeholder="%"
                                  className="w-20 bg-gray-900 border border-gray-600 rounded-lg py-1.5 px-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                />
                                <button onClick={() => removeShareRow(region, idx)} className="text-red-400 hover:text-red-300 p-1"><Trash2 size={13} /></button>
                              </div>
                            ))}
                          </div>

                          <button onClick={() => addShareRow(region)} className="mt-2 text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1">
                            <Plus size={12} /> Add share
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {formError && (
                    <div className="p-2.5 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm flex items-center gap-2">
                      <AlertCircle size={15} /> <span>{formError}</span>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button onClick={closeEditor} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
                    <button
                      onClick={saveCity}
                      disabled={saving}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {saving ? <Loader className="animate-spin" size={15} /> : <Check size={15} />}
                      Save city
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end sticky bottom-0 bg-gray-800">
          <button onClick={onClose} className="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg font-medium transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
};

export default CitiesModal;
