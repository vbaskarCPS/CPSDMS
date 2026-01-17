// src/pages/Admin/EmailTemplateEditor.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Eye,
  EyeOff,
  Loader,
  AlertCircle,
  CheckCircle,
  X,
  Bold,
  Italic,
  Link,
  Type,
  RotateCcw,
} from 'lucide-react';
import { commandCenterService } from '../../lib/commandCenterService';
import { 
  emailTemplateService, 
  TEMPLATE_VARIABLES, 
  getDefaultTemplateHtml,
  DEFAULT_SUBJECTS 
} from '../../lib/emailTemplateService';
import { EmailTemplate, EmailTemplateType } from '../../types';

const EmailTemplateEditor: React.FC = () => {
  const navigate = useNavigate();
  const { templateType } = useParams<{ templateType: string }>();
  
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  
  const editorRef = useRef<HTMLTextAreaElement>(null);
  
  const typeInfo = templateType 
    ? emailTemplateService.getTemplateTypeInfo(templateType as EmailTemplateType)
    : null;

  useEffect(() => {
    if (!currentCC) {
      navigate('/login');
      return;
    }
    if (!templateType || !typeInfo) {
      navigate('/admin/email-templates');
      return;
    }
    loadTemplate();
  }, [currentCC, templateType, navigate]);

  const loadTemplate = async () => {
    if (!templateType || !currentCC) return;
    
    try {
      setLoading(true);
      const existing = await emailTemplateService.getTemplateByType(templateType as EmailTemplateType);
      
      if (existing) {
        setTemplate(existing);
        setSubject(existing.subject);
        setHtmlContent(existing.htmlContent);
      } else {
        // Initialize with defaults
        setSubject(DEFAULT_SUBJECTS[templateType as EmailTemplateType] || 'Your Service Receipt');
        setHtmlContent(getDefaultTemplateHtml(templateType as EmailTemplateType, currentCC.displayName));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!templateType || !currentCC) return;
    
    try {
      setSaving(true);
      setError(null);
      
      await emailTemplateService.saveTemplate({
        templateType: templateType as EmailTemplateType,
        templateName: typeInfo?.name || templateType,
        subject,
        htmlContent,
        isActive: template?.isActive ?? true,
      });
      
      setSuccessMessage('Template saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
      
      // Reload to get updated data
      await loadTemplate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = () => {
    if (!currentCC || !templateType) return;
    
    if (window.confirm('Reset template to default? This will overwrite your current changes.')) {
      setSubject(DEFAULT_SUBJECTS[templateType as EmailTemplateType] || 'Your Service Receipt');
      setHtmlContent(getDefaultTemplateHtml(templateType as EmailTemplateType, currentCC.displayName));
    }
  };

  const insertVariable = (variable: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = htmlContent;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const newText = `${before}{{${variable}}}${after}`;
    
    setHtmlContent(newText);
    
    // Restore focus and cursor position
    setTimeout(() => {
      editor.focus();
      const newPos = start + variable.length + 4;
      editor.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const getPreviewHtml = () => {
    if (!currentCC) return htmlContent;
    return emailTemplateService.getPreviewHtml(htmlContent, currentCC.displayName);
  };

  if (!currentCC || !typeInfo) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/email-templates')}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold">{typeInfo.name}</h1>
              <p className="text-xs text-gray-400 capitalize">{typeInfo.category} Template</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                showPreview 
                  ? 'bg-cps-blue text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            
            <button
              onClick={handleResetToDefault}
              className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <RotateCcw size={16} /> Reset
            </button>
            
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 animate-fade-in">
            <CheckCircle size={18} />
            {successMessage}
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

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader className="animate-spin text-cps-blue" size={32} />
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Editor Panel */}
            <div className={`space-y-4 ${showPreview ? 'hidden lg:block' : ''}`}>
              {/* Subject Line */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Email Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                  placeholder="Your Service Receipt"
                />
              </div>

              {/* Variable Buttons */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Insert Variable
                </label>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => insertVariable(v.key)}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 rounded border border-gray-600 transition-colors"
                      title={`Example: ${v.example}`}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* HTML Editor */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  HTML Content
                </label>
                <textarea
                  ref={editorRef}
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  className="w-full h-[500px] bg-gray-900 border border-gray-600 rounded-lg py-3 px-4 text-white font-mono text-sm focus:ring-2 focus:ring-cps-blue focus:outline-none resize-none custom-scrollbar"
                  placeholder="Enter HTML content..."
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Preview Panel */}
            <div className={`${showPreview ? '' : 'hidden lg:block'}`}>
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden sticky top-20">
                <div className="bg-gray-900 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-400">Preview</span>
                  <span className="text-xs text-gray-500">Sample data shown</span>
                </div>
                
                {/* Subject Preview */}
                <div className="px-4 py-2 bg-gray-850 border-b border-gray-700">
                  <div className="text-xs text-gray-500 mb-1">Subject:</div>
                  <div className="text-sm text-white font-medium">
                    {emailTemplateService.getPreviewHtml(subject, currentCC.displayName)}
                  </div>
                </div>
                
                {/* Email Preview */}
                <div className="bg-white" style={{ height: '600px', overflow: 'auto' }}>
                  <iframe
                    srcDoc={getPreviewHtml()}
                    className="w-full h-full border-0"
                    title="Email Preview"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Variable Reference */}
          <div className="mt-6 bg-gray-800 rounded-xl border border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Variable Reference</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {TEMPLATE_VARIABLES.map((v) => (
                <div key={v.key} className="bg-gray-900 rounded-lg p-2 border border-gray-700">
                  <div className="text-xs font-mono text-cps-blue mb-1">{`{{${v.key}}}`}</div>
                  <div className="text-xs text-gray-400">{v.label}</div>
                  <div className="text-xs text-gray-600">e.g., {v.example}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailTemplateEditor;