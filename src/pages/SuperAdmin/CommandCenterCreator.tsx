// src/pages/SuperAdmin/CommandCenterCreator.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Edit2,
  LogIn,
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
} from 'lucide-react';
import {
  commandCenterService,
  CommandCenter,
  Region,
  extractSheetId,
} from '../../lib/commandCenterService';
import { removeStorageItem } from '../../lib/localStorage';

const REGIONS: Region[] = ['West', 'Central', 'East'];

const CommandCenterCreator: React.FC = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [commandCenters, setCommandCenters] = useState<CommandCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingCC, setEditingCC] = useState<CommandCenter | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    displayName: '',
    username: '',
    password: '',
    region: 'West' as Region,
    workerbookUrl: '',
    masterbookingsUrl: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // --- LOAD DATA ---
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

  // --- FORM HANDLERS ---
  const resetForm = () => {
    setFormData({
      displayName: '',
      username: '',
      password: '',
      region: 'West',
      workerbookUrl: '',
      masterbookingsUrl: '',
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
    setFormData({
      displayName: cc.displayName,
      username: cc.username,
      password: '', // Don't pre-fill password for security
      region: cc.region,
      workerbookUrl: `https://docs.google.com/spreadsheets/d/${cc.workerbookSheetId}/edit`,
      masterbookingsUrl: `https://docs.google.com/spreadsheets/d/${cc.masterbookingsSheetId}/edit`,
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

    // Password only required for new CC
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
        // Update existing
        const updates: any = {
          displayName: formData.displayName,
          username: formData.username,
          region: formData.region,
          workerbookSheetId,
          masterbookingsSheetId,
        };
        
        // Only update password if provided
        if (formData.password.trim()) {
          updates.password = formData.password;
        }

        await commandCenterService.updateCommandCenter(editingCC.id, updates);
      } else {
        // Create new
        await commandCenterService.createCommandCenter({
          displayName: formData.displayName,
          username: formData.username,
          password: formData.password,
          region: formData.region,
          workerbookSheetId,
          masterbookingsSheetId,
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

  // --- ACTIONS ---
  const handleDelete = async (cc: CommandCenter) => {
    if (!window.confirm(
      `⚠️ DELETE "${cc.displayName}"?\n\n` +
      `This will permanently delete:\n` +
      `• All workers and route managers\n` +
      `• All sessions and transactions\n` +
      `• All bookings and routes\n\n` +
      `This action cannot be undone!`
    )) {
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
    // Set super admin mode and enter this CC
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

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* HEADER */}
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

      {/* CONTENT */}
      <div className="max-w-6xl mx-auto p-6">
        {/* ERROR DISPLAY */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={16} />
            </button>
          </div>
        )}

        {/* CREATE BUTTON */}
        <div className="mb-6">
          <button
            onClick={openCreateModal}
            className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-lg"
          >
            <Plus size={20} />
            Create Command Center
          </button>
        </div>

        {/* COMMAND CENTERS LIST */}
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
            {commandCenters.map((cc) => (
              <div
                key={cc.id}
                className="bg-gray-800 rounded-xl border border-gray-700 p-5 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  {/* INFO */}
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
                      </div>
                    </div>
                  </div>

                  {/* ACTIONS */}
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

                {/* SHEET INFO */}
                <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4 text-xs">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Sheet size={14} />
                    <span>Workerbook: <code className="text-gray-400">{cc.workerbookSheetId.substring(0, 20)}...</code></span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <Sheet size={14} />
                    <span>Masterbookings: <code className="text-gray-400">{cc.masterbookingsSheetId.substring(0, 20)}...</code></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CREATE/EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingCC ? 'Edit Command Center' : 'Create Command Center'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* Display Name */}
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

              {/* Username */}
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

              {/* Password */}
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

              {/* Region */}
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

              {/* Workerbook URL */}
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
                {formData.workerbookUrl && extractSheetId(formData.workerbookUrl) && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    ID: {extractSheetId(formData.workerbookUrl)!.substring(0, 30)}...
                  </p>
                )}
              </div>

              {/* Masterbookings URL */}
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
                {formData.masterbookingsUrl && extractSheetId(formData.masterbookingsUrl) && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    ID: {extractSheetId(formData.masterbookingsUrl)!.substring(0, 30)}...
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
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
    </div>
  );
};

export default CommandCenterCreator;