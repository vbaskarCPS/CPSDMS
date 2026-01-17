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
  DEFAULT_SUBJECTS 
} from '../../lib/emailTemplateService';
import { EmailTemplate, EmailTemplateType } from '../../types';

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

  // Initialize content
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
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

// --- TEMPLATE STRUCTURE TYPE ---
interface TemplateContent {
  greeting: string;
  mainContent: string;
  showServiceDetails: boolean;
  showPaymentDetails: boolean;
  footerText: string;
}

// --- GENERATE HTML FROM CONTENT ---
const generateHtmlFromContent = (
  content: TemplateContent, 
  subject: string,
  companyName: string,
  templateType: EmailTemplateType
): string => {
  const isBilled = templateType === 'billed';
  const isPrepaid = templateType === 'prepaid';
  
  let paymentSection = '';
  if (content.showPaymentDetails) {
    if (isBilled) {
      paymentSection = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fef3c7; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <tr>
            <td style="font-size: 14px; color: #92400e;">
              <strong>Amount Due:</strong> {{displayPrice}}<br/>
              <strong>Payment Status:</strong> Invoice Sent
            </td>
          </tr>
        </table>
      `;
    } else if (isPrepaid) {
      paymentSection = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #dbeafe; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <tr>
            <td style="font-size: 14px; color: #1e40af;">
              <strong>Service Value:</strong> {{displayPrice}}<br/>
              <strong>Status:</strong> Prepaid - No Payment Required
            </td>
          </tr>
        </table>
      `;
    } else {
      paymentSection = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <tr>
            <td style="font-size: 14px; color: #166534;">
              <strong>Amount Paid:</strong> {{displayPrice}}<br/>
              <strong>Payment Method:</strong> {{paymentMethod}}
            </td>
          </tr>
        </table>
      `;
    }
  }

  const serviceSection = content.showServiceDetails ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <tr>
        <td style="font-size: 14px; color: #374151;">
          <strong>Service:</strong> {{serviceName}}<br/>
          <strong>Address:</strong> {{address}}<br/>
          <strong>Date:</strong> {{date}}<br/>
          <strong>Technician:</strong> {{workerName}}
        </td>
      </tr>
    </table>
  ` : '';

  // Convert rich text content - replace variable tags with actual template variables
  const processContent = (html: string): string => {
    return html.replace(/<span[^>]*class="variable-tag"[^>]*>{{(\w+)}}<\/span>/g, '{{$1}}');
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">{{companyName}}</h1>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <div style="font-size: 16px; color: #1f2937; line-height: 1.6;">
                ${processContent(content.greeting)}
              </div>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="padding: 10px 30px;">
              <div style="font-size: 16px; color: #4b5563; line-height: 1.6;">
                ${processContent(content.mainContent)}
              </div>
            </td>
          </tr>
          
          <!-- Service Details -->
          ${serviceSection ? `<tr><td style="padding: 0 30px;">${serviceSection}</td></tr>` : ''}
          
          <!-- Payment Details -->
          ${paymentSection ? `<tr><td style="padding: 0 30px;">${paymentSection}</td></tr>` : ''}
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <div style="color: #6b7280; font-size: 14px; line-height: 1.6;">
                ${processContent(content.footerText)}
              </div>
              <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px;">
                © 2026 {{companyName}}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

// --- PARSE HTML TO CONTENT ---
const parseHtmlToContent = (html: string): TemplateContent => {
  // Default content
  const defaultContent: TemplateContent = {
    greeting: '<h2 style="margin: 0 0 10px 0;">Hi {{firstName}},</h2>',
    mainContent: '<p>Thank you for choosing Property Stars! Your service has been completed.</p>',
    showServiceDetails: true,
    showPaymentDetails: true,
    footerText: '<p>Questions? Simply reply to this email and we\'ll be happy to help.</p>',
  };

  // If no HTML or it's the default, return defaults
  if (!html || html.trim() === '') {
    return defaultContent;
  }

  // Try to extract sections from existing HTML (simplified extraction)
  // This is a basic parser - for complex HTML it will use defaults
  try {
    // Check for service details section
    const hasServiceDetails = html.includes('{{serviceName}}') && html.includes('{{address}}');
    const hasPaymentDetails = html.includes('{{displayPrice}}') && html.includes('{{paymentMethod}}');
    
    return {
      ...defaultContent,
      showServiceDetails: hasServiceDetails,
      showPaymentDetails: hasPaymentDetails,
    };
  } catch {
    return defaultContent;
  }
};

// --- GET DEFAULT CONTENT FOR TEMPLATE TYPE ---
const getDefaultContent = (templateType: EmailTemplateType): TemplateContent => {
  const isUpgrade = templateType.startsWith('upgrade_');
  const isAddon = templateType.startsWith('addon_');
  const isBilled = templateType === 'billed';
  const isPrepaid = templateType === 'prepaid';
  const isSale = templateType === 'sale';

  let greeting = '<h2 style="margin: 0 0 10px 0;">Hi {{firstName}},</h2>';
  let mainContent = '<p>Thank you for choosing Property Stars! Your service has been completed.</p>';

  if (isSale) {
    mainContent = '<p>Welcome to the Property Stars family! We\'re thrilled to have you as a new customer. Your lawn is in great hands.</p>';
  } else if (isBilled) {
    mainContent = '<p>Thank you for your service! Please find your invoice details below. Payment can be made at your convenience.</p>';
  } else if (isPrepaid) {
    mainContent = '<p>Great news! Your prepaid service has been completed. Thank you for being a valued customer - we appreciate your trust in Property Stars.</p>';
  } else if (isUpgrade) {
    mainContent = '<p>Congratulations on upgrading your lawn care program! You\'ve made a great choice for your lawn\'s health and appearance.</p>';
  } else if (isAddon) {
    mainContent = '<p>Your add-on service has been confirmed and scheduled. We appreciate your continued trust in Property Stars!</p>';
  }

  return {
    greeting,
    mainContent,
    showServiceDetails: true,
    showPaymentDetails: true,
    footerText: '<p>Questions? Simply reply to this email and we\'ll be happy to help.</p>',
  };
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
  const [content, setContent] = useState<TemplateContent>(getDefaultContent('production'));
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
        setContent(parseHtmlToContent(existing.htmlContent));
      } else {
        // Initialize with defaults
        setSubject(DEFAULT_SUBJECTS[templateType as EmailTemplateType] || 'Your Service Receipt');
        setContent(getDefaultContent(templateType as EmailTemplateType));
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
      
      const htmlContent = generateHtmlFromContent(
        content, 
        subject, 
        currentCC.displayName,
        templateType as EmailTemplateType
      );
      
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
      setContent(getDefaultContent(templateType as EmailTemplateType));
    }
  };

  const getPreviewHtml = useCallback(() => {
    if (!currentCC || !templateType) return '';
    
    const html = generateHtmlFromContent(
      content, 
      subject, 
      currentCC.displayName,
      templateType as EmailTemplateType
    );
    
    return emailTemplateService.getPreviewHtml(html, currentCC.displayName);
  }, [content, subject, currentCC, templateType]);

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