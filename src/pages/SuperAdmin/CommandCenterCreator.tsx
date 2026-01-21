// src/pages/SuperAdmin/CommandCenterCreator.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Edit2,
  X,
  Check,
  AlertCircle,
  Building2,
  Globe,
  Sheet,
  Key,
  User,
  Loader,
  LogOut,
  ChevronRight,
  AlertTriangle,
  Skull,
  UserPlus,
  ExternalLink,
} from 'lucide-react';
import {
  commandCenterService,
  CommandCenter,
  Region,
  extractSheetId,
  getJobFairSlugError,
} from '../../lib/commandCenterService';
import { removeStorageItem } from '../../lib/localStorage';

const REGIONS: Region[] = ['West', 'Central', 'East'];

const CommandCenterCreator: React.FC = () => {
  const navigate = useNavigate();
  
  const [commandCenters, setCommandCenters] = useState<CommandCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showModal, setShowModal] = useState(false);
  const [editingCC, setEditingCC] = useState<CommandCenter | null>(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: '',
    username: '',
    password: '',
    region: 'West' as Region,
    workerbookUrl: '',
    masterbookingsUrl: '',
    jobFairsEnabled: false,
    jobFairsSlug: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wiping, setWiping] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    loadCommandCenters();
  }, []);

  const loadCommandCenters = async () => {
    setLoading(true);
    try {
      const ccs = await commandCenterService.getAllCommandCenters();
      setCommandCenters(ccs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load command centers');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      displayName: '',
      username: '',
      password: '',
      region: 'West',
      workerbookUrl: '',
      masterbookingsUrl: '',
      jobFairsEnabled: false,
      jobFairsSlug: '',
    });
    setFormErrors({});
    setEditingCC(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (cc: CommandCenter) => {
    setEditingCC(cc);
    const wbUrl = 'https://docs.google.com/spreadsheets/d/' + cc.workerbookSheetId + '/edit';
    const mbUrl = 'https://docs.google.com/spreadsheets/d/' + cc.masterbookingsSheetId + '/edit';
    setFormData({
      displayName: cc.displayName,
      username: cc.username,
      password: '',
      region: cc.region,
      workerbookUrl: wbUrl,
      masterbookingsUrl: mbUrl,
      jobFairsEnabled: cc.jobFairsEnabled || false,
      jobFairsSlug: cc.jobFairsSlug || '',
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

    if (!formData.displayName.trim()) {
      errors.displayName = 'Display name is required';
    }

    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    } else if (formData.username.includes(' ')) {
      errors.username = 'Username cannot contain spaces';
    }

    if (!editingCC && !formData.password.trim()) {
      errors.password = 'Password is required';
    }

    const workerbookId = extractSheetId(formData.workerbookUrl);
    if (!workerbookId) {
      errors.workerbookUrl = 'Invalid Google Sheets URL or ID';
    }

    const masterbookingsId = extractSheetId(formData.masterbookingsUrl);
    if (!masterbookingsId) {
      errors.masterbookingsUrl = 'Invalid Google Sheets URL or ID';
    }

    if (formData.jobFairsEnabled) {
      const slugError = getJobFairSlugError(formData.jobFairsSlug);
      if (slugError) {
        errors.jobFairsSlug = slugError;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setError(null);

    try {
      const workerbookSheetId = extractSheetId(formData.workerbookUrl)!;
      const masterbookingsSheetId = extractSheetId(formData.masterbookingsUrl)!;

      if (editingCC) {
        const updates: any = {
          displayName: formData.displayName,
          username: formData.username,
          region: formData.region,
          workerbookSheetId,
          masterbookingsSheetId,
          jobFairsEnabled: formData.jobFairsEnabled,
          jobFairsSlug: formData.jobFairsEnabled ? formData.jobFairsSlug : '',
        };
        
        if (formData.password.trim()) {
          updates.password = formData.password;
        }

        await commandCenterService.updateCommandCenter(editingCC.id, updates);
      } else {
        await commandCenterService.createCommandCenter({
          displayName: formData.displayName,
          username: formData.username,
          password: formData.password,
          region: formData.region,
          workerbookSheetId,
          masterbookingsSheetId,
          jobFairsEnabled: formData.jobFairsEnabled,
          jobFairsSlug: formData.jobFairsEnabled ? formData.jobFairsSlug : '',
        });
      }

      await loadCommandCenters();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save command center');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cc: CommandCenter) => {
    const confirmMsg = '⚠️ DELETE "' + cc.displayName + '"?\n\nThis will permanently delete:\n• All workers and route managers\n• All sessions and transactions\n• All bookings and routes\n\nThis action cannot be undone!';
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      await commandCenterService.deleteCommandCenter(cc.id);
      await loadCommandCenters();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete command center');
    }
  };

  const handleEnter = (cc: CommandCenter) => {
    commandCenterService.setSuperAdminMode(true);
    commandCenterService.setCurrentCommandCenter(cc);
    navigate('/admin');
  };

  const handleLogout = () => {
    removeStorageItem('current_user');
    commandCenterService.clearCurrentCommandCenter();
    commandCenterService.setSuperAdminMode(false);
    navigate('/login');
  };

  const openWipeModal = () => {
    setWipeConfirmText('');
    setShowWipeModal(true);
  };

  const closeWipeModal = () => {
    setShowWipeModal(false);
    setWipeConfirmText('');
  };

  const handleUniversalWipe = async () => {
    if (wipeConfirmText !== 'DELETE ALL') return;

    setWiping(true);
    setError(null);

    try {
      await commandCenterService.universalWipe();
      
      removeStorageItem('current_user');
      commandCenterService.clearCurrentCommandCenter();
      commandCenterService.setSuperAdminMode(true);
      
      await loadCommandCenters();
      closeWipeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to wipe data');
      setWiping(false);
    }
  };

  const isWipeConfirmed = wipeConfirmText === 'DELETE ALL';

  const getJobFairUrl = (slug: string): string => {
    return baseUrl + '/' + slug;
  };

  const getSheetIdPreview = (url: string): string => {
    const id = extractSheetId(url);
    if (!id) return '';
    return 'ID: ' + id.substring(0, 30) + '...';
  };

  const renderCommandCenterCard = (cc: CommandCenter) => {
    const jobFairUrl = cc.jobFairsSlug ? getJobFairUrl(cc.jobFairsSlug) : '';
    const wbPreview = cc.workerbookSheetId.substring(0, 20) + '...';
    const mbPreview = cc.masterbookingsSheetId.substring(0, 20) + '...';

    return (
      <div
        key={cc.id}
        className="bg-gray-800 rounded-xl border border-gray-700 p-5 hover:border-gray-600 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center border ${
              cc.region === 'West' ? 'bg-blue-900/30 border-blue-700' :
              cc.region === 'Central' ? 'bg-green-900/30 border-green-700' :
              'bg-orange-900/30 border-orange-700'
            }`}>
              <Globe className={
                cc.region === 'West' ? 'text-blue-400' :
                cc.region === 'Central' ? 'text-green-400' :
                'text-orange-400'
              } size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{cc.displayName}</h3>
              <div className="flex items-center gap-3 text-sm text-gray-400">
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {cc.username}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  cc.region === 'West' ? 'bg-blue-900/50 text-blue-300' :
                  cc.region === 'Central' ? 'bg-green-900/50 text-green-300' :
                  'bg-orange-900/50 text-orange-300'
                }`}>
                  {cc.region}
                </span>
                {cc.jobFairsEnabled && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-900/50 text-purple-300 flex items-center gap-1">
                    <UserPlus size={10} />
                    Job Fairs
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleEnter(cc)}
              className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              Enter
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => openEditModal(cc)}
              className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit2 size={18} />
            </button>
            <button
              onClick={() => handleDelete(cc)}
              className="bg-red-900/30 hover:bg-red-900/50 text-red-400 p-2 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4 text-xs">
          <div className="flex items-center gap-2 text-gray-500">
            <Sheet size={14} />
            <span>Workerbook: <code className="text-gray-400">{wbPreview}</code></span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <Sheet size={14} />
            <span>Masterbookings: <code className="text-gray-400">{mbPreview}</code></span>
          </div>
        </div>

        {cc.jobFairsEnabled && cc.jobFairsSlug && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <div className="flex items-center gap-2 text-xs">
              <UserPlus size={14} className="text-purple-400" />
              <span className="text-gray-500">Job Fair URL:</span>
              <a
                href={jobFairUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <span>{jobFairUrl}</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        )}
      </div>
    );
  };

  const formJobFairUrl = formData.jobFairsSlug ? getJobFairUrl(formData.jobFairsSlug) : '';
  const formBaseUrlDisplay = baseUrl + '/';
  const workerbookIdPreview = getSheetIdPreview(formData.workerbookUrl);
  const masterbookingsIdPreview = getSheetIdPreview(formData.masterbookingsUrl);
  const ccCountText = '• All command centers (' + commandCenters.length + ')';

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-900/50 rounded-lg flex items-center justify-center border border-purple-700">
              <Building2 className="text-purple-400" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Super Admin</h1>
              <p className="text-xs text-gray-400">Command Center Management</p>
            </div>
          </div>
          
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={openCreateModal}
            className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-lg"
          >
            <Plus size={20} />
            Create Command Center
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-purple-400" size={32} />
          </div>
        ) : commandCenters.length === 0 ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
            <Building2 className="mx-auto text-gray-600 mb-4" size={48} />
            <h3 className="text-lg font-bold text-gray-400 mb-2">No Command Centers</h3>
            <p className="text-gray-500 text-sm">Create your first command center to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {commandCenters.map(renderCommandCenterCard)}
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="bg-red-950/30 rounded-xl border border-red-900/50 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-red-900/50 rounded-lg flex items-center justify-center border border-red-700 flex-shrink-0">
                <Skull className="text-red-400" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-400 mb-2">Danger Zone</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Universal wipe will permanently delete <strong className="text-red-300">ALL data</strong> from the 
                  entire application including all command centers, users, sessions, transactions, bookings, 
                  and email logs. This action cannot be undone.
                </p>
                <button
                  onClick={openWipeModal}
                  className="bg-red-900/50 hover:bg-red-900 text-red-300 hover:text-red-200 px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors border border-red-800"
                >
                  <AlertTriangle size={18} />
                  Universal Wipe
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingCC ? 'Edit Command Center' : 'Create Command Center'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., Toronto East"
                  className={`w-full bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none ${
                    formErrors.displayName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                  }`}
                />
                {formErrors.displayName && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.displayName}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                    placeholder="e.g., torontoeast"
                    className={`w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none ${
                      formErrors.username ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                    }`}
                  />
                </div>
                {formErrors.username && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.username}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Password {editingCC && <span className="text-gray-500">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={editingCC ? '••••••••' : 'Enter password'}
                    className={`w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none ${
                      formErrors.password ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                    }`}
                  />
                </div>
                {formErrors.password && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.password}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Region
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {REGIONS.map((region) => (
                    <button
                      key={region}
                      type="button"
                      onClick={() => setFormData({ ...formData, region })}
                      className={`py-2 px-4 rounded-lg border font-medium transition-colors ${
                        formData.region === region
                          ? region === 'West' ? 'bg-blue-900/50 border-blue-500 text-blue-300' :
                            region === 'Central' ? 'bg-green-900/50 border-green-500 text-green-300' :
                            'bg-orange-900/50 border-orange-500 text-orange-300'
                          : 'bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {region}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Workerbook Google Sheet URL
                </label>
                <div className="relative">
                  <Sheet className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={formData.workerbookUrl}
                    onChange={(e) => setFormData({ ...formData, workerbookUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className={`w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none text-sm ${
                      formErrors.workerbookUrl ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                    }`}
                  />
                </div>
                {formErrors.workerbookUrl && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.workerbookUrl}</p>
                )}
                {workerbookIdPreview && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    <span>{workerbookIdPreview}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Masterbookings Google Sheet URL
                </label>
                <div className="relative">
                  <Sheet className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={formData.masterbookingsUrl}
                    onChange={(e) => setFormData({ ...formData, masterbookingsUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className={`w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none text-sm ${
                      formErrors.masterbookingsUrl ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                    }`}
                  />
                </div>
                {formErrors.masterbookingsUrl && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.masterbookingsUrl}</p>
                )}
                {masterbookingsIdPreview && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    <span>{masterbookingsIdPreview}</span>
                  </p>
                )}
              </div>

              <div className="pt-4 border-t border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <UserPlus className="text-purple-400" size={18} />
                    <label className="text-sm font-medium text-gray-300">
                      Enable Job Fairs
                    </label>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, jobFairsEnabled: !formData.jobFairsEnabled })}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      formData.jobFairsEnabled ? 'bg-purple-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        formData.jobFairsEnabled ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {formData.jobFairsEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        Job Fair URL Slug
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-sm whitespace-nowrap">{formBaseUrlDisplay}</span>
                        <input
                          type="text"
                          value={formData.jobFairsSlug}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            jobFairsSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') 
                          })}
                          placeholder="hamilton"
                          className={`flex-1 bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none text-sm ${
                            formErrors.jobFairsSlug ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500'
                          }`}
                        />
                      </div>
                      {formErrors.jobFairsSlug && (
                        <p className="text-red-400 text-xs mt-1">{formErrors.jobFairsSlug}</p>
                      )}
                      {formData.jobFairsSlug && !formErrors.jobFairsSlug && !getJobFairSlugError(formData.jobFairsSlug) && (
                        <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                          <Check size={12} />
                          <span>Valid slug</span>
                        </p>
                      )}
                    </div>

                    {formData.jobFairsSlug && !getJobFairSlugError(formData.jobFairsSlug) && (
                      <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                        <p className="text-xs text-gray-400 mb-1">Public application URL:</p>
                        <p className="text-sm text-purple-400 flex items-center gap-2">
                          <span>{formJobFairUrl}</span>
                          <ExternalLink size={12} />
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-gray-500">
                      Applicants will use this URL to submit their applications during job fairs.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader className="animate-spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {editingCC ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWipeModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-xl border border-red-900 w-full max-w-md">
            <div className="p-4 border-b border-red-900/50 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-900/50 rounded-lg flex items-center justify-center">
                <Skull className="text-red-400" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-400">Universal Wipe</h2>
                <p className="text-xs text-gray-500">This action cannot be undone</p>
              </div>
              <button onClick={closeWipeModal} className="ml-auto text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="bg-red-950/50 border border-red-900/50 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-red-300 mb-2 flex items-center gap-2">
                  <AlertTriangle size={16} />
                  This will permanently delete:
                </h3>
                <ul className="text-sm text-gray-400 space-y-1 ml-6">
                  <li>{ccCountText}</li>
                  <li>• All workers and route managers</li>
                  <li>• All daily sessions</li>
                  <li>• All logsheet sessions</li>
                  <li>• All transactions</li>
                  <li>• All bookings and routes</li>
                  <li>• All email logs</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Type <code className="bg-gray-800 px-2 py-0.5 rounded text-red-400 font-mono">DELETE ALL</code> to confirm
                </label>
                <input
                  type="text"
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  placeholder="DELETE ALL"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white font-mono text-center focus:ring-2 focus:ring-red-500 focus:outline-none focus:border-red-500"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-800 flex justify-end gap-3">
              <button
                onClick={closeWipeModal}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUniversalWipe}
                disabled={!isWipeConfirmed || wiping}
                className={`px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all ${
                  isWipeConfirmed
                    ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {wiping ? (
                  <Loader className="animate-spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                Wipe Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommandCenterCreator;