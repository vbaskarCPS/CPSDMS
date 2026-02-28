// src/pages/Admin/OnboardingSetup.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Loader,
  AlertCircle,
  CheckCircle,
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  MapPin,
  AtSign,
  Share2,
  Pen,
  Bus,
} from 'lucide-react';
import { commandCenterService } from '../../lib/commandCenterService';
import {
  onboardingService,
  OnboardingConfig,
  ShuttlePoint,
} from '../../lib/onboardingService';

const OnboardingSetup: React.FC = () => {
  const navigate = useNavigate();
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());

  // --- STATE ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Config state
  const [config, setConfig] = useState<Partial<OnboardingConfig>>({
    replyToEmail: '',
    facebookGroupUrl: '',
    facebookPageUrl: '',
    instagramUrl: '',
    instagramHandle: '',
    signatureName: '',
    signatureTitle: '',
    signaturePhone: '',
    signatureEmail: '',
  });

  // Shuttle points state
  const [shuttlePoints, setShuttlePoints] = useState<ShuttlePoint[]>([]);
  const [newShuttle, setNewShuttle] = useState({
    shuttleNumber: '',
    description: '',
    pickupTime: '',
    googleMapsUrl: '',
  });
  const [editingShuttleId, setEditingShuttleId] = useState<string | null>(null);
  const [editShuttle, setEditShuttle] = useState({
    shuttleNumber: '',
    description: '',
    pickupTime: '',
    googleMapsUrl: '',
  });
  const [savingShuttle, setSavingShuttle] = useState(false);
  const [deletingShuttleId, setDeletingShuttleId] = useState<string | null>(null);

  // --- LOAD ---
  useEffect(() => {
    if (!currentCC) {
      navigate('/login');
      return;
    }
    loadData();
  }, [currentCC, navigate]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [existingConfig, points] = await Promise.all([
        onboardingService.getConfig(),
        onboardingService.getShuttlePoints(),
      ]);
      if (existingConfig) {
        setConfig(existingConfig);
      }
      setShuttlePoints(points);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // --- SAVE CONFIG ---
  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      await onboardingService.saveConfig(config);
      setSuccess('Settings saved!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // --- SHUTTLE CRUD ---
  const handleAddShuttle = async () => {
    if (!newShuttle.shuttleNumber.trim()) return;
    setSavingShuttle(true);
    setError(null);
    try {
      await onboardingService.saveShuttlePoint(newShuttle);
      setNewShuttle({ shuttleNumber: '', description: '', pickupTime: '', googleMapsUrl: '' });
      const points = await onboardingService.getShuttlePoints();
      setShuttlePoints(points);
      setSuccess('Shuttle point added!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shuttle point');
    } finally {
      setSavingShuttle(false);
    }
  };

  const handleStartEdit = (point: ShuttlePoint) => {
    setEditingShuttleId(point.id);
    setEditShuttle({
      shuttleNumber: point.shuttleNumber,
      description: point.description,
      pickupTime: point.pickupTime,
      googleMapsUrl: point.googleMapsUrl,
    });
  };

  const handleSaveEdit = async () => {
    if (!editShuttle.shuttleNumber.trim()) return;
    setSavingShuttle(true);
    setError(null);
    try {
      await onboardingService.saveShuttlePoint(editShuttle);
      setEditingShuttleId(null);
      const points = await onboardingService.getShuttlePoints();
      setShuttlePoints(points);
      setSuccess('Shuttle point updated!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shuttle point');
    } finally {
      setSavingShuttle(false);
    }
  };

  const handleDeleteShuttle = async (id: string) => {
    if (!window.confirm('Delete this shuttle point?')) return;
    setDeletingShuttleId(id);
    try {
      await onboardingService.deleteShuttlePoint(id);
      setShuttlePoints((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete shuttle point');
    } finally {
      setDeletingShuttleId(null);
    }
  };

  // --- PREVIEW ---
  const getPreviewHtml = useCallback(() => {
    if (!currentCC) return '';
    return onboardingService.buildPreviewHtml(
      config as OnboardingConfig,
      shuttlePoints,
      currentCC.displayName
    );
  }, [config, shuttlePoints, currentCC]);

  if (!currentCC) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin')}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold">Onboarding Email Setup</h1>
              <p className="text-xs text-gray-400">{currentCC.displayName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                showPreview
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {success && (
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400">
            <CheckCircle size={18} />
            {success}
          </div>
        </div>
      )}
      {error && (
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-400">
            <AlertCircle size={18} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader className="animate-spin text-blue-400" size={32} />
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT: Settings */}
            <div className={`space-y-4 ${showPreview ? 'hidden lg:block' : ''}`}>
              {/* Reply-To Email */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 className="font-bold text-white flex items-center gap-2 mb-3">
                  <AtSign size={16} className="text-blue-400" />
                  Reply-To Email
                </h3>
                <p className="text-xs text-gray-500 mb-2">
                  When new hires reply to the onboarding email, it goes to this address.
                </p>
                <input
                  type="email"
                  value={config.replyToEmail || ''}
                  onChange={(e) => setConfig({ ...config, replyToEmail: e.target.value })}
                  placeholder="e.g., manager@yourcompany.com"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                />
              </div>

              {/* Signature */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 className="font-bold text-white flex items-center gap-2 mb-3">
                  <Pen size={16} className="text-purple-400" />
                  Email Signature
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                    <input
                      type="text"
                      value={config.signatureName || ''}
                      onChange={(e) => setConfig({ ...config, signatureName: e.target.value })}
                      placeholder="e.g., Vijay Baskaran"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Title</label>
                    <input
                      type="text"
                      value={config.signatureTitle || ''}
                      onChange={(e) => setConfig({ ...config, signatureTitle: e.target.value })}
                      placeholder="e.g., Operations Manager"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Phone</label>
                      <input
                        type="text"
                        value={config.signaturePhone || ''}
                        onChange={(e) => setConfig({ ...config, signaturePhone: e.target.value })}
                        placeholder="905 555 1234"
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Email</label>
                      <input
                        type="email"
                        value={config.signatureEmail || ''}
                        onChange={(e) => setConfig({ ...config, signatureEmail: e.target.value })}
                        placeholder="you@company.com"
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Social Media Links */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 className="font-bold text-white flex items-center gap-2 mb-3">
                  <Share2 size={16} className="text-green-400" />
                  Social Media Links
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  These will appear in the email so new hires can join your community.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Facebook Group URL</label>
                    <input
                      type="url"
                      value={config.facebookGroupUrl || ''}
                      onChange={(e) => setConfig({ ...config, facebookGroupUrl: e.target.value })}
                      placeholder="https://facebook.com/groups/..."
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Facebook Page URL</label>
                    <input
                      type="url"
                      value={config.facebookPageUrl || ''}
                      onChange={(e) => setConfig({ ...config, facebookPageUrl: e.target.value })}
                      placeholder="https://facebook.com/..."
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Instagram URL</label>
                      <input
                        type="url"
                        value={config.instagramUrl || ''}
                        onChange={(e) => setConfig({ ...config, instagramUrl: e.target.value })}
                        placeholder="https://instagram.com/..."
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Instagram Handle</label>
                      <input
                        type="text"
                        value={config.instagramHandle || ''}
                        onChange={(e) => setConfig({ ...config, instagramHandle: e.target.value })}
                        placeholder="cps_hamilton"
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Shuttle Point Mapping */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 className="font-bold text-white flex items-center gap-2 mb-3">
                  <Bus size={16} className="text-yellow-400" />
                  Shuttle Point Mapping
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Map shuttle numbers from the Workerbook to a location, pickup time, and Google Maps link.
                </p>

                {/* Existing shuttle points */}
                {shuttlePoints.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {shuttlePoints.map((point) => {
                      const isEditing = editingShuttleId === point.id;
                      const isDeleting = deletingShuttleId === point.id;

                      if (isEditing) {
                        return (
                          <div
                            key={point.id}
                            className="bg-gray-900 rounded-lg border border-blue-600 p-3 space-y-2"
                          >
                            <div className="grid grid-cols-4 gap-2">
                              <input
                                type="text"
                                value={editShuttle.shuttleNumber}
                                onChange={(e) =>
                                  setEditShuttle({ ...editShuttle, shuttleNumber: e.target.value })
                                }
                                placeholder="#"
                                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editShuttle.pickupTime}
                                onChange={(e) =>
                                  setEditShuttle({ ...editShuttle, pickupTime: e.target.value })
                                }
                                placeholder="7:30 AM"
                                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editShuttle.description}
                                onChange={(e) =>
                                  setEditShuttle({ ...editShuttle, description: e.target.value })
                                }
                                placeholder="Location description"
                                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm col-span-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                            </div>
                            <input
                              type="url"
                              value={editShuttle.googleMapsUrl}
                              onChange={(e) =>
                                setEditShuttle({ ...editShuttle, googleMapsUrl: e.target.value })
                              }
                              placeholder="Google Maps URL"
                              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setEditingShuttleId(null)}
                                className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                disabled={savingShuttle}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1"
                              >
                                {savingShuttle ? (
                                  <Loader className="animate-spin" size={12} />
                                ) : (
                                  <Save size={12} />
                                )}
                                Save
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={point.id}
                          className={`bg-gray-900 rounded-lg border border-gray-700 p-3 flex items-center justify-between transition-opacity ${
                            isDeleting ? 'opacity-40' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-yellow-900/30 border border-yellow-700 flex items-center justify-center flex-shrink-0">
                              <span className="text-yellow-400 font-bold text-sm">
                                {point.shuttleNumber}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-white text-sm font-medium truncate">
                                {point.description || 'No description'}
                              </p>
                              <p className="text-gray-500 text-xs">
                                {point.pickupTime || 'No time set'}
                                {point.googleMapsUrl && (
                                  <>
                                    {' • '}
                                    <a
                                      href={point.googleMapsUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-400 hover:underline"
                                    >
                                      Maps ↗
                                    </a>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleStartEdit(point)}
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            >
                              <Pen size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteShuttle(point.id)}
                              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add new shuttle point */}
                <div className="bg-gray-900 rounded-lg border border-dashed border-gray-600 p-3 space-y-2">
                  <p className="text-xs text-gray-500 font-medium">Add Shuttle Point</p>
                  <div className="grid grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={newShuttle.shuttleNumber}
                      onChange={(e) =>
                        setNewShuttle({ ...newShuttle, shuttleNumber: e.target.value })
                      }
                      placeholder="# (e.g. 5)"
                      className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newShuttle.pickupTime}
                      onChange={(e) =>
                        setNewShuttle({ ...newShuttle, pickupTime: e.target.value })
                      }
                      placeholder="7:30 AM"
                      className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newShuttle.description}
                      onChange={(e) =>
                        setNewShuttle({ ...newShuttle, description: e.target.value })
                      }
                      placeholder="Location description"
                      className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm col-span-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={newShuttle.googleMapsUrl}
                      onChange={(e) =>
                        setNewShuttle({ ...newShuttle, googleMapsUrl: e.target.value })
                      }
                      placeholder="Google Maps URL (optional)"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button
                      onClick={handleAddShuttle}
                      disabled={!newShuttle.shuttleNumber.trim() || savingShuttle}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1"
                    >
                      {savingShuttle ? (
                        <Loader className="animate-spin" size={14} />
                      ) : (
                        <Plus size={14} />
                      )}
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Preview */}
            <div className={`${showPreview ? '' : 'hidden lg:block'}`}>
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden sticky top-20">
                <div className="bg-gray-900 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-400">Email Preview</span>
                  <span className="text-xs text-gray-500">Sample data shown</span>
                </div>
                <div className="bg-white" style={{ height: '700px', overflow: 'auto' }}>
                  <iframe
                    srcDoc={getPreviewHtml()}
                    className="w-full h-full border-0"
                    title="Onboarding Email Preview"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingSetup;