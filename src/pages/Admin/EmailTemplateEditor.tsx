// src/pages/Admin/EmailTemplateEditor.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Underline,
  AlignLeft,
  AlignCenter,
  List,
  RotateCcw,
  Type,
} from 'lucide-react';
import { commandCenterService } from '../../lib/commandCenterService';
import { 
  emailTemplateService, 
  TEMPLATE_VARIABLES, 
  DEFAULT_SUBJECTS,
  getDefaultContentStructure,
  generateHtmlFromContentStructure,
} from '../../lib/emailTemplateService';
import { EmailTemplate, EmailTemplateType, EmailTemplateContentStructure } from '../../types';

// --- RICH TEXT EDITOR COMPONENT ---
interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Start typing...',
  minHeight = '200px'
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const isInternalChange = useRef(false);

  // Initialize and sync content when value prop changes
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      // Only update if the content is actually different
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
    isInternalChange.current = false;
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, commandValue?: string) => {
    document.execCommand(command, false, commandValue);
    editorRef.current?.focus();
    handleInput();
  };

  const insertVariable = (variable: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const span = document.createElement('span');
      span.className = 'variable-tag';
      span.contentEditable = 'false';
      span.style.cssText = 'background-color: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin: 0 2px; display: inline-block;';
      span.textContent = `{{${variable}}}`;
      range.deleteContents();
      range.insertNode(span);
      
      // Move cursor after the inserted span
      range.setStartAfter(span);
      range.setEndAfter(span);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      // If no selection, append to end
      if (editorRef.current) {
        editorRef.current.innerHTML += `<span class="variable-tag" contenteditable="false" style="background-color: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin: 0 2px; display: inline-block;">{{${variable}}}</span>`;
      }
    }
    editorRef.current?.focus();
    handleInput();
  };

  return (
    <div className="border border-gray-600 rounded-lg overflow-hidden bg-gray-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <button
          type="button"
          onClick={() => execCommand('bold')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Bold"
        >
          <Bold size={16} className="text-gray-300" />
        </button>
        <button
          type="button"
          onClick={() => execCommand('italic')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Italic"
        >
          <Italic size={16} className="text-gray-300" />
        </button>
        <button
          type="button"
          onClick={() => execCommand('underline')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Underline"
        >
          <Underline size={16} className="text-gray-300" />
        </button>
        
        <div className="w-px h-6 bg-gray-700 mx-1" />
        
        <button
          type="button"
          onClick={() => execCommand('justifyLeft')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Align Left"
        >
          <AlignLeft size={16} className="text-gray-300" />
        </button>
        <button
          type="button"
          onClick={() => execCommand('justifyCenter')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Align Center"
        >
          <AlignCenter size={16} className="text-gray-300" />
        </button>
        <button
          type="button"
          onClick={() => execCommand('insertUnorderedList')}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Bullet List"
        >
          <List size={16} className="text-gray-300" />
        </button>
        
        <div className="w-px h-6 bg-gray-700 mx-1" />
        
        <select
          onChange={(e) => {
            if (e.target.value) {
              execCommand('fontSize', e.target.value);
              e.target.value = '';
            }
          }}
          className="bg-gray-700 text-gray-300 text-sm rounded px-2 py-1 border-none outline-none"
          defaultValue=""
        >
          <option value="" disabled>Size</option>
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="7">Huge</option>
        </select>
        
        <div className="w-px h-6 bg-gray-700 mx-1" />
        
        {/* Variable Dropdown */}
        <select
          onChange={(e) => {
            if (e.target.value) {
              insertVariable(e.target.value);
              e.target.value = '';
            }
          }}
          className="bg-blue-600 text-white text-sm rounded px-2 py-1 border-none outline-none cursor-pointer"
          defaultValue=""
        >
          <option value="" disabled>+ Insert Variable</option>
          {TEMPLATE_VARIABLES.map(v => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>
      
      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="p-4 text-white outline-none overflow-auto"
        style={{ minHeight, lineHeight: '1.6' }}
        data-placeholder={placeholder}
      />
      
      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #6b7280;
          pointer-events: none;
        }
        [contenteditable] .variable-tag {
          background-color: #3b82f6 !important;
          color: white !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          font-size: 12px !important;
          margin: 0 2px !important;
          display: inline-block !important;
        }
      `}</style>
    </div>
  );
};

// --- MAIN COMPONENT ---
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
  const [content, setContent] = useState<EmailTemplateContentStructure>(
    getDefaultContentStructure('production')
  );
  const [showPreview, setShowPreview] = useState(false);
  
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
        
        // Use saved contentStructure if available, otherwise use defaults
        if (existing.contentStructure) {
          setContent(existing.contentStructure);
        } else {
          // Fallback to defaults for templates saved before contentStructure existed
          setContent(getDefaultContentStructure(templateType as EmailTemplateType));
        }
      } else {
        // Initialize with defaults for new template
        setSubject(DEFAULT_SUBJECTS[templateType as EmailTemplateType] || 'Your Service Receipt');
        setContent(getDefaultContentStructure(templateType as EmailTemplateType));
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
        contentStructure: content,
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
      setContent(getDefaultContentStructure(templateType as EmailTemplateType));
    }
  };

  const getPreviewHtml = useCallback(() => {
    if (!currentCC || !templateType) return '';
    
    const html = generateHtmlFromContentStructure(content, templateType as EmailTemplateType);
    return emailTemplateService.getPreviewHtml(html, currentCC.displayName);
  }, [content, currentCC, templateType]);

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
                <p className="text-xs text-gray-500 mt-2">
                  Tip: You can use variables like {'{{firstName}}'} in the subject line
                </p>
              </div>

              {/* Greeting Section */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Greeting
                </label>
                <RichTextEditor
                  value={content.greeting}
                  onChange={(v) => setContent({ ...content, greeting: v })}
                  placeholder="Hi {{firstName}},"
                  minHeight="80px"
                />
              </div>

              {/* Main Content Section */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Main Message
                </label>
                <RichTextEditor
                  value={content.mainContent}
                  onChange={(v) => setContent({ ...content, mainContent: v })}
                  placeholder="Thank you for choosing Property Stars..."
                  minHeight="150px"
                />
              </div>

              {/* Toggle Sections */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-3">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Include Sections
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={content.showServiceDetails}
                    onChange={(e) => setContent({ ...content, showServiceDetails: e.target.checked })}
                    className="w-5 h-5 accent-blue-500"
                  />
                  <span className="text-gray-300">Service Details</span>
                  <span className="text-xs text-gray-500">(Service name, address, date, technician)</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={content.showPaymentDetails}
                    onChange={(e) => setContent({ ...content, showPaymentDetails: e.target.checked })}
                    className="w-5 h-5 accent-blue-500"
                  />
                  <span className="text-gray-300">Payment Details</span>
                  <span className="text-xs text-gray-500">(Amount, payment method)</span>
                </label>
              </div>

              {/* Footer Section */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Footer Message
                </label>
                <RichTextEditor
                  value={content.footerText}
                  onChange={(v) => setContent({ ...content, footerText: v })}
                  placeholder="Questions? Reply to this email..."
                  minHeight="80px"
                />
              </div>

              {/* Variable Reference */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                  <Type size={14} />
                  Available Variables
                </h3>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <div 
                      key={v.key} 
                      className="bg-gray-900 rounded px-2 py-1 border border-gray-700 text-xs"
                      title={`Example: ${v.example}`}
                    >
                      <span className="text-blue-400 font-mono">{`{{${v.key}}}`}</span>
                      <span className="text-gray-500 ml-1">- {v.label}</span>
                    </div>
                  ))}
                </div>
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
        </div>
      )}
    </div>
  );
};

export default EmailTemplateEditor;