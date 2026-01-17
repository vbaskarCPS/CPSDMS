// src/pages/Admin/EmailTemplates.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Plus,
  Check,
  X,
  Edit2,
  Eye,
  Loader,
  AlertCircle,
  CheckCircle,
  Package,
  Zap,
  FileText,
} from 'lucide-react';
import { commandCenterService } from '../../lib/commandCenterService';
import { emailTemplateService, EMAIL_TEMPLATE_TYPES } from '../../lib/emailTemplateService';
import { EmailTemplate, EmailTemplateType, EmailTemplateTypeInfo } from '../../types';

const EmailTemplates: React.FC = () => {
  const navigate = useNavigate();
  
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Get template types for current region
  const templateTypes = currentCC 
    ? emailTemplateService.getTemplateTypesForRegion(currentCC.region)
    : [];

  // Group template types by category
  const groupedTypes = templateTypes.reduce((acc, type) => {
    if (!acc[type.category]) acc[type.category] = [];
    acc[type.category].push(type);
    return acc;
  }, {} as Record<string, EmailTemplateTypeInfo[]>);

  useEffect(() => {
    if (!currentCC) {
      navigate('/login');
      return;
    }
    loadTemplates();
  }, [currentCC, navigate]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await emailTemplateService.getTemplates();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleInitializeDefaults = async () => {
    try {
      setInitializing(true);
      setError(null);
      const count = await emailTemplateService.initializeDefaultTemplates();
      await loadTemplates();
      setSuccessMessage(`Created ${count} default template${count !== 1 ? 's' : ''}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize templates');
    } finally {
      setInitializing(false);
    }
  };

  const handleToggleActive = async (template: EmailTemplate) => {
    try {
      await emailTemplateService.toggleTemplateActive(template.id, !template.isActive);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  const getTemplateForType = (type: EmailTemplateType): EmailTemplate | undefined => {
    return templates.find(t => t.templateType === type);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'general': return <FileText size={16} />;
      case 'upgrade': return <Zap size={16} />;
      case 'addon': return <Package size={16} />;
      default: return <Mail size={16} />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'general': return 'text-blue-400 bg-blue-900/30 border-blue-700';
      case 'upgrade': return 'text-purple-400 bg-purple-900/30 border-purple-700';
      case 'addon': return 'text-green-400 bg-green-900/30 border-green-700';
      default: return 'text-gray-400 bg-gray-900/30 border-gray-700';
    }
  };

  if (!currentCC) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin')}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Mail className="text-cps-blue" size={24} />
                Email Templates
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                {currentCC.displayName} • {currentCC.region} Region
              </p>
            </div>
          </div>
          
          <button
            onClick={handleInitializeDefaults}
            disabled={initializing}
            className="bg-cps-blue hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {initializing ? (
              <Loader className="animate-spin" size={18} />
            ) : (
              <Plus size={18} />
            )}
            Initialize Defaults
          </button>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 animate-fade-in">
            <CheckCircle size={18} />
            {successMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-400">
            <AlertCircle size={18} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-cps-blue" size={32} />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Template Categories */}
            {(['general', 'upgrade', 'addon'] as const).map(category => {
              const types = groupedTypes[category];
              if (!types || types.length === 0) return null;
              
              return (
                <div key={category} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                  <div className={`px-4 py-3 border-b border-gray-700 flex items-center gap-2 ${getCategoryColor(category)}`}>
                    {getCategoryIcon(category)}
                    <h2 className="font-bold capitalize">{category} Templates</h2>
                    <span className="text-xs opacity-75">({types.length})</span>
                  </div>
                  
                  <div className="divide-y divide-gray-700">
                    {types.map(typeInfo => {
                      const template = getTemplateForType(typeInfo.type);
                      const hasTemplate = !!template;
                      
                      return (
                        <div
                          key={typeInfo.type}
                          className="p-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-white">{typeInfo.name}</h3>
                              {hasTemplate && template.isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-700">
                                  ACTIVE
                                </span>
                              )}
                              {hasTemplate && !template.isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 border border-gray-600">
                                  INACTIVE
                                </span>
                              )}
                              {!hasTemplate && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-700">
                                  NOT CREATED
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                              {typeInfo.description}
                            </p>
                            {hasTemplate && (
                              <p className="text-xs text-gray-600 mt-1">
                                Subject: {template.subject}
                              </p>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 ml-4">
                            {hasTemplate && (
                              <>
                                <button
                                  onClick={() => handleToggleActive(template)}
                                  className={`p-2 rounded-lg transition-colors ${
                                    template.isActive
                                      ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                  }`}
                                  title={template.isActive ? 'Disable' : 'Enable'}
                                >
                                  {template.isActive ? <Check size={16} /> : <X size={16} />}
                                </button>
                                <button
                                  onClick={() => navigate(`/admin/email-templates/${typeInfo.type}`)}
                                  className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                                  title="Edit Template"
                                >
                                  <Edit2 size={16} />
                                </button>
                              </>
                            )}
                            {!hasTemplate && (
                              <button
                                onClick={() => navigate(`/admin/email-templates/${typeInfo.type}`)}
                                className="px-3 py-1.5 bg-cps-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium flex items-center gap-1"
                              >
                                <Plus size={14} /> Create
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Empty State */}
            {templates.length === 0 && (
              <div className="text-center py-12 bg-gray-800 rounded-xl border border-gray-700">
                <Mail className="mx-auto text-gray-600 mb-4" size={48} />
                <h3 className="text-lg font-medium text-gray-300 mb-2">No Templates Created</h3>
                <p className="text-gray-500 mb-4">
                  Click "Initialize Defaults" to create starter templates for your region.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailTemplates;