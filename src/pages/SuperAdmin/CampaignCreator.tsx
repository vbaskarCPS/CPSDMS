// src/pages/SuperAdmin/CampaignCreator.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Edit2,
  X,
  Check,
  AlertCircle,
  Crosshair,
  Sheet,
  Key,
  User,
  Loader,
  ArrowLeft,
  Users,
  RefreshCw,
  Link,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  campaignService,
  Campaign,
  CampaignManager,
  extractSheetId,
} from '../../lib/campaignService';
import type { CampaignType } from '../../lib/campaignService';

const CAMPAIGN_TYPE_OPTIONS: { value: CampaignType; label: string; desc: string }[] = [
  { value: 'standard', label: 'Standard', desc: 'Standard aeration callbook' },
  { value: 'bc', label: 'BC Type', desc: 'BC book with service flags (ADFSL) and upsells' },
];

const CampaignCreator: React.FC = () => {
  const navigate = useNavigate();

  // --- State ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Campaign modal
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    spreadsheetUrl: '',
    appsScriptUrl: '',
    campaignType: 'standard' as CampaignType,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Expanded campaign (show managers)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [managers, setManagers] = useState<CampaignManager[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);

  // Manager modal
  const [showManagerModal, setShowManagerModal] = useState(false);
  const [editingManager, setEditingManager] = useState<CampaignManager | null>(null);
  const [managerForm, setManagerForm] = useState({ name: '', repCode: '', password: 'callofduty' });
  const [managerFormErrors, setManagerFormErrors] = useState<Record<string, string>>({});
  const [savingManager, setSavingManager] = useState(false);
  const [managerCampaignId, setManagerCampaignId] = useState<string | null>(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const data = await campaignService.getAllCampaigns();
      setCampaigns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const loadManagers = async (campaignId: string) => {
    setManagersLoading(true);
    try {
      const data = await campaignService.getManagersByCampaign(campaignId);
      setManagers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load managers');
    } finally {
      setManagersLoading(false);
    }
  };

  // --- Campaign CRUD ---

  const resetForm = () => {
    setFormData({ displayName: '', spreadsheetUrl: '', appsScriptUrl: '', campaignType: 'standard' });
    setFormErrors({});
    setEditingCampaign(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (c: Campaign) => {
    setEditingCampaign(c);
    setFormData({
      displayName: c.displayName,
      spreadsheetUrl: c.spreadsheetUrl || ('https://docs.google.com/spreadsheets/d/' + c.spreadsheetId + '/edit'),
      appsScriptUrl: c.appsScriptUrl || '',
      campaignType: c.campaignType || 'standard',
    });
    setFormErrors({});
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.displayName.trim()) errors.displayName = 'Display name is required';
    const sheetId = extractSheetId(formData.spreadsheetUrl);
    if (!sheetId) errors.spreadsheetUrl = 'Invalid Google Sheets URL or ID';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    setError(null);

    try {
      const spreadsheetId = extractSheetId(formData.spreadsheetUrl)!;
      if (editingCampaign) {
        await campaignService.updateCampaign(editingCampaign.id, {
          displayName: formData.displayName,
          spreadsheetId,
          spreadsheetUrl: formData.spreadsheetUrl,
          appsScriptUrl: formData.appsScriptUrl || undefined,
          campaignType: formData.campaignType,
        });
      } else {
        await campaignService.createCampaign({
          displayName: formData.displayName,
          spreadsheetId,
          spreadsheetUrl: formData.spreadsheetUrl,
          appsScriptUrl: formData.appsScriptUrl || undefined,
          campaignType: formData.campaignType,
        });
      }
      await loadCampaigns();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Campaign) => {
    const msg = '⚠️ DELETE "' + c.displayName + '"?\n\nThis will permanently delete:\n• All campaign managers\n• All dialer sessions & gamification data\n\nThis action cannot be undone!';
    if (!window.confirm(msg)) return;

    try {
      await campaignService.deleteCampaign(c.id);
      if (expandedId === c.id) setExpandedId(null);
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  // --- Toggle expand / collapse managers ---
  const toggleExpand = async (campaignId: string) => {
    if (expandedId === campaignId) {
      setExpandedId(null);
      setManagers([]);
    } else {
      setExpandedId(campaignId);
      await loadManagers(campaignId);
    }
  };

  // --- Manager CRUD ---

  const openAddManagerModal = (campaignId: string) => {
    setManagerCampaignId(campaignId);
    setEditingManager(null);
    setManagerForm({ name: '', repCode: '', password: 'callofduty' });
    setManagerFormErrors({});
    setShowManagerModal(true);
  };

  const openEditManagerModal = (mgr: CampaignManager) => {
    setManagerCampaignId(mgr.campaignId);
    setEditingManager(mgr);
    setManagerForm({ name: mgr.name, repCode: mgr.repCode, password: '' });
    setManagerFormErrors({});
    setShowManagerModal(true);
  };

  const closeManagerModal = () => {
    setShowManagerModal(false);
    setEditingManager(null);
    setManagerCampaignId(null);
  };

  const validateManagerForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!managerForm.name.trim()) errors.name = 'Name is required';
    if (!managerForm.repCode.trim()) errors.repCode = 'Rep code is required';
    else if (managerForm.repCode.includes(' ')) errors.repCode = 'Rep code cannot contain spaces';
    if (!editingManager && !managerForm.password.trim()) errors.password = 'Password is required';
    setManagerFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveManager = async () => {
    if (!validateManagerForm() || !managerCampaignId) return;
    setSavingManager(true);
    setError(null);

    try {
      if (editingManager) {
        const updates: any = { name: managerForm.name, repCode: managerForm.repCode };
        if (managerForm.password.trim()) updates.password = managerForm.password;
        await campaignService.updateManager(editingManager.id, updates);
      } else {
        await campaignService.createManager({
          campaignId: managerCampaignId,
          name: managerForm.name,
          repCode: managerForm.repCode,
          password: managerForm.password || 'callofduty',
        });
      }
      await loadManagers(managerCampaignId);
      closeManagerModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save manager');
    } finally {
      setSavingManager(false);
    }
  };

  const handleDeleteManager = async (mgr: CampaignManager) => {
    if (!window.confirm('Delete manager "' + mgr.name + '" (' + mgr.repCode + ')?')) return;
    try {
      await campaignService.deleteManager(mgr.id);
      await loadManagers(mgr.campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete manager');
    }
  };

  // --- Helpers ---

  const getSheetIdPreview = (url: string): string => {
    const id = extractSheetId(url);
    if (!id) return '';
    return 'ID: ' + id.substring(0, 30) + '...';
  };

  const sheetIdPreview = getSheetIdPreview(formData.spreadsheetUrl);

  const getCampaignTypeBadge = (type: CampaignType) => {
    if (type === 'bc') {
      return (
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(241,196,15,0.15)', border: '1px solid rgba(241,196,15,0.35)', color: '#f1c40f' }}>
          BC
        </span>
      );
    }
    return null;
  };

  // --- Render ---

  const renderCampaignCard = (c: Campaign) => {
    const isExpanded = expandedId === c.id;
    const sheetPreview = c.spreadsheetId.substring(0, 24) + '...';

    return (
      <div key={c.id} className="bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors">
        {/* Campaign Header */}
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center border bg-green-900/30 border-green-700">
                <Crosshair className="text-green-400" size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{c.displayName}</h3>
                  {getCampaignTypeBadge(c.campaignType)}
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <span className="flex items-center gap-1">
                    <Sheet size={12} />
                    <code className="text-xs">{sheetPreview}</code>
                  </span>
                  {c.appsScriptUrl && (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <Link size={10} />
                      Bridge
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleExpand(c.id)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
              >
                <Users size={16} />
                Managers
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button
                onClick={() => openEditModal(c)}
                className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={18} />
              </button>
              <button
                onClick={() => handleDelete(c)}
                className="bg-red-900/30 hover:bg-red-900/50 text-red-400 p-2 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Managers Panel (expanded) */}
        {isExpanded && (
          <div className="border-t border-gray-700 px-5 py-4 bg-gray-850">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                <Users size={14} />
                Campaign Managers
              </h4>
              <button
                onClick={() => openAddManagerModal(c.id)}
                className="bg-green-900/50 hover:bg-green-900 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors border border-green-800"
              >
                <Plus size={12} />
                Add Manager
              </button>
            </div>

            {managersLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader className="animate-spin text-gray-500" size={20} />
              </div>
            ) : managers.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">
                No managers yet. Add managers manually or sync from the Managers tab.
              </p>
            ) : (
              <div className="space-y-2">
                {managers.map((mgr) => (
                  <div
                    key={mgr.id}
                    className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3 border border-gray-700"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-900/30 border border-green-800 flex items-center justify-center">
                        <User size={14} className="text-green-400" />
                      </div>
                      <div>
                        <span className="text-white text-sm font-medium">{mgr.name}</span>
                        <span className="text-gray-500 text-xs ml-2">({mgr.repCode})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditManagerModal(mgr)}
                        className="text-gray-500 hover:text-white p-1 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteManager(mgr)}
                        className="text-gray-500 hover:text-red-400 p-1 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/super-admin')}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 bg-green-900/50 rounded-lg flex items-center justify-center border border-green-700">
              <Crosshair className="text-green-400" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Campaign Manager</h1>
              <p className="text-xs text-gray-400">AutoSniper Dialer Campaigns</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X size={16} /></button>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-green-900/30 border border-green-700 rounded-lg flex items-center gap-3 text-green-300">
            <Check size={20} />
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="ml-auto"><X size={16} /></button>
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={openCreateModal}
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-lg"
          >
            <Plus size={20} />
            Create Campaign
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-green-400" size={32} />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
            <Crosshair className="mx-auto text-gray-600 mb-4" size={48} />
            <h3 className="text-lg font-bold text-gray-400 mb-2">No Campaigns</h3>
            <p className="text-gray-500 text-sm">Create your first campaign to start dialing.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map(renderCampaignCard)}
          </div>
        )}
      </div>

      {/* Campaign Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingCampaign ? 'Edit Campaign' : 'Create Campaign'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Display Name</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., Hamilton Summer 2026"
                  className={'w-full bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none ' +
                    (formErrors.displayName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                />
                {formErrors.displayName && <p className="text-red-400 text-xs mt-1">{formErrors.displayName}</p>}
              </div>

              {/* Campaign Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Campaign Type</label>
                <div className="flex gap-3">
                  {CAMPAIGN_TYPE_OPTIONS.map((opt) => {
                    const isSelected = formData.campaignType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, campaignType: opt.value })}
                        className={'flex-1 rounded-lg py-3 px-4 text-left transition-all border ' +
                          (isSelected
                            ? 'bg-green-900/30 border-green-600 ring-2 ring-green-500'
                            : 'bg-gray-900 border-gray-600 hover:border-gray-500')}
                      >
                        <div className={'text-sm font-bold ' + (isSelected ? 'text-green-400' : 'text-gray-300')}>
                          {opt.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Spreadsheet URL */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Callbook Spreadsheet URL</label>
                <div className="relative">
                  <Sheet className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={formData.spreadsheetUrl}
                    onChange={(e) => setFormData({ ...formData, spreadsheetUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className={'w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none text-sm ' +
                      (formErrors.spreadsheetUrl ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                  />
                </div>
                {formErrors.spreadsheetUrl && <p className="text-red-400 text-xs mt-1">{formErrors.spreadsheetUrl}</p>}
                {sheetIdPreview && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    <span>{sheetIdPreview}</span>
                  </p>
                )}
              </div>

              {/* Apps Script Bridge URL */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Apps Script Bridge URL <span className="text-gray-500">(optional)</span>
                </label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={formData.appsScriptUrl}
                    onChange={(e) => setFormData({ ...formData, appsScriptUrl: e.target.value })}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:ring-green-500 focus:outline-none text-sm"
                  />
                </div>
                <p className="text-gray-500 text-xs mt-1">Used for row highlighting and hidden rows. Can be added later.</p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
                {editingCampaign ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager Create/Edit Modal */}
      {showManagerModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingManager ? 'Edit Manager' : 'Add Manager'}
              </h2>
              <button onClick={closeManagerModal} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={managerForm.name}
                  onChange={(e) => setManagerForm({ ...managerForm, name: e.target.value })}
                  placeholder="e.g., John Smith"
                  className={'w-full bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none ' +
                    (managerFormErrors.name ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                />
                {managerFormErrors.name && <p className="text-red-400 text-xs mt-1">{managerFormErrors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Rep Code (username)</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={managerForm.repCode}
                    onChange={(e) => setManagerForm({ ...managerForm, repCode: e.target.value.replace(/\s/g, '') })}
                    placeholder="e.g., jsmith"
                    className={'w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none ' +
                      (managerFormErrors.repCode ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                  />
                </div>
                {managerFormErrors.repCode && <p className="text-red-400 text-xs mt-1">{managerFormErrors.repCode}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Password {editingManager && <span className="text-gray-500">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="password"
                    value={managerForm.password}
                    onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })}
                    placeholder={editingManager ? '••••••••' : 'callofduty'}
                    className={'w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none ' +
                      (managerFormErrors.password ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                  />
                </div>
                {managerFormErrors.password && <p className="text-red-400 text-xs mt-1">{managerFormErrors.password}</p>}
                {!editingManager && (
                  <p className="text-gray-500 text-xs mt-1">Default: callofduty</p>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button onClick={closeManagerModal} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSaveManager}
                disabled={savingManager}
                className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {savingManager ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
                {editingManager ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CampaignCreator;