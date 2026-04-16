// src/pages/Admin/WorkerbookEmailService.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Loader,
  CheckCircle,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Mail,
  Baby,
  Users,
  MessageSquare,
  Smartphone,
  UserX,
  UserMinus,
} from 'lucide-react';
import {
  WorkerbookEmailTemplate,
  WorkerbookTextTemplate,
  DEFAULT_REGULAR_TEMPLATE,
  DEFAULT_ROOKIE_TEMPLATE,
  DEFAULT_TEXT_TEMPLATE,
  DEFAULT_NS_TEXT_TEMPLATE,
  DEFAULT_WDR_TEXT_TEMPLATE,
  loadWorkerbookTemplates,
  loadAllTextTemplates,
  saveWorkerbookTemplate,
  saveStatusTextTemplate,
  buildWorkerbookEmailHtml,
  buildTextMessage,
} from '../../lib/workerbookEmailService';
import { commandCenterService } from '../../lib/commandCenterService';

interface Props {
  onBack: () => void;
}

type TemplateTab = 'regular' | 'rookie' | 'text' | 'text_ns' | 'text_wdr';

const SAMPLE_DATA = {
  contractorId: 'H1001',
  firstName: 'John',
  lastName: 'Smith',
  email: 'john@example.com',
  date: 'Mar27',
  shuttle: '5',
  days: 3,
  commandCenterId: '',
  commandCenterName: 'Property Stars Hamilton',
};

const SAMPLE_SHUTTLE = {
  id: 'sample',
  commandCenterId: '',
  shuttleNumber: '5',
  description: 'Tim Hortons – Main & Kenilworth',
  pickupTime: '7:30 AM',
  googleMapsUrl: 'https://maps.google.com',
};

// Variable reference shown in the email editor
const BODY_VARS = [
  { placeholder: '{{firstName}}',     description: 'Contractor first name' },
  { placeholder: '{{lastName}}',      description: 'Last name' },
  { placeholder: '{{fullName}}',      description: 'Full name' },
  { placeholder: '{{date}}',          description: 'Date tab (e.g. Mar27)' },
  { placeholder: '{{contractorId}}',  description: 'CN# (e.g. H1001)' },
  { placeholder: '{{days}}',          description: 'Days worked count' },
  { placeholder: '{{shuttlePoint}}',  description: 'Shuttle location + time (or fallback address if no shuttle)' },
  { placeholder: '{{confirmButton}}', description: 'Green "Confirm My Shift" button — links to confirmation page' },
];

// Variable reference shown in text editors
const TEXT_VARS = [
  { placeholder: '{{firstName}}',          description: 'Contractor first name' },
  { placeholder: '{{lastName}}',           description: 'Last name' },
  { placeholder: '{{fullName}}',           description: 'Full name' },
  { placeholder: '{{date}}',               description: 'Date tab (e.g. Mar27)' },
  { placeholder: '{{dateFriendly}}',       description: 'Friendly date (e.g. Saturday, March 27th)' },
  { placeholder: '{{contractorId}}',       description: 'CN# (e.g. H1001)' },
  { placeholder: '{{days}}',               description: 'Days worked count' },
  { placeholder: '{{shuttle}}',            description: 'Shuttle number (e.g. 5)' },
  { placeholder: '{{shuttleDescription}}', description: 'Shuttle location name (e.g. Tim Hortons - Main & Kenilworth)' },
  { placeholder: '{{pickupTime}}',         description: 'Pickup time (e.g. 7:30 AM)' },
];

const WorkerbookEmailService: React.FC<Props> = ({ onBack }) => {
  const [currentCC] = useState(() => commandCenterService.getCurrentCommandCenter());
  const [activeTab, setActiveTab] = useState<TemplateTab>('regular');

  const [regular, setRegular]   = useState<WorkerbookEmailTemplate>({ ...DEFAULT_REGULAR_TEMPLATE });
  const [rookie,  setRookie]    = useState<WorkerbookEmailTemplate>({ ...DEFAULT_ROOKIE_TEMPLATE });
  const [textWorkerbook, setTextWorkerbook] = useState<WorkerbookTextTemplate>({ ...DEFAULT_TEXT_TEMPLATE });
  const [textNs,  setTextNs]    = useState<WorkerbookTextTemplate>({ ...DEFAULT_NS_TEXT_TEMPLATE });
  const [textWdr, setTextWdr]   = useState<WorkerbookTextTemplate>({ ...DEFAULT_WDR_TEXT_TEMPLATE });

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    Promise.all([
      loadWorkerbookTemplates(),
      loadAllTextTemplates(),
    ])
      .then(([emails, texts]) => {
        setRegular(emails.regular);
        setRookie(emails.rookie);
        setTextWorkerbook(texts.workerbook);
        setTextNs(texts.ns);
        setTextWdr(texts.wdr);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const isTextTab = activeTab === 'text' || activeTab === 'text_ns' || activeTab === 'text_wdr';

  const currentEmailTemplate = activeTab === 'regular' ? regular : rookie;

  const currentTextTemplate =
    activeTab === 'text_ns'  ? textNs  :
    activeTab === 'text_wdr' ? textWdr :
                               textWorkerbook;

  const updateEmail = (patch: Partial<WorkerbookEmailTemplate>) => {
    if (activeTab === 'regular') setRegular({ ...regular, ...patch });
    else if (activeTab === 'rookie') setRookie({ ...rookie, ...patch });
  };

  const updateText = (patch: Partial<WorkerbookTextTemplate>) => {
    if (activeTab === 'text')      setTextWorkerbook({ ...textWorkerbook, ...patch });
    else if (activeTab === 'text_ns')  setTextNs({ ...textNs, ...patch });
    else if (activeTab === 'text_wdr') setTextWdr({ ...textWdr, ...patch });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveWorkerbookTemplate('workerbook_regular', regular);
      await saveWorkerbookTemplate('workerbook_rookie', rookie);
      await saveStatusTextTemplate('workerbook_text', textWorkerbook);
      await saveStatusTextTemplate('workerbook_text_ns', textNs);
      await saveStatusTextTemplate('workerbook_text_wdr', textWdr);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const previewHtml = useCallback(() => {
    const isRookie = activeTab === 'rookie';
    return buildWorkerbookEmailHtml(
      currentEmailTemplate,
      { ...SAMPLE_DATA, isRookie },
      SAMPLE_SHUTTLE,
    );
  }, [currentEmailTemplate, activeTab]);

  const previewText = useCallback(() => {
    return buildTextMessage(
      currentTextTemplate,
      SAMPLE_DATA,
      SAMPLE_SHUTTLE,
    );
  }, [currentTextTemplate]);

  const inputClass =
    'w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm ' +
    'focus:ring-2 focus:ring-blue-500 focus:outline-none';

  // Colour themes per tab — for subtle visual cue in the header & preview
  const textTabTheme =
    activeTab === 'text_ns'  ? { text: 'text-red-400',   bg: 'bg-red-900/20',   border: 'border-red-700/40',   bubble: 'bg-red-600' } :
    activeTab === 'text_wdr' ? { text: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-700/40', bubble: 'bg-amber-600' } :
                               { text: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-700/40', bubble: 'bg-green-600' };

  const textTabLabel =
    activeTab === 'text_ns'  ? 'NS Callback Text' :
    activeTab === 'text_wdr' ? 'WDR Callback Text' :
                               'Workerbook Day-Of Text';

  const textTabHint =
    activeTab === 'text_ns'  ? 'Sent when calling back contractors on the NS (no-show) tab.' :
    activeTab === 'text_wdr' ? 'Sent when calling back contractors on the WDR (worked didn\'t rebook) tab.' :
                               'Sent from the workerbook day view for day-of shift reminders.';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader className="animate-spin text-blue-400" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold">Workerbook Templates</h1>
              <p className="text-xs text-gray-400">{currentCC?.displayName} — Emails &amp; text messages</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(p => !p)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
                showPreview ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 flex items-center gap-2 text-sm disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
              Save All Templates
            </button>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="max-w-7xl mx-auto px-4 mt-3 space-y-2">
        {saved && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} /> Templates saved!
          </div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* LEFT: Editor */}
          <div className={showPreview ? 'hidden lg:block' : ''}>
            {/* Template tab switcher */}
            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                onClick={() => setActiveTab('regular')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'regular'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <Users size={14} />
                Regular Email
              </button>
              <button
                onClick={() => setActiveTab('rookie')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'rookie'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <Baby size={14} />
                Rookie Email
              </button>
              <button
                onClick={() => setActiveTab('text')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'text'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <MessageSquare size={14} />
                Workerbook Text
              </button>
              <button
                onClick={() => setActiveTab('text_ns')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'text_ns'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <UserX size={14} />
                NS Text
              </button>
              <button
                onClick={() => setActiveTab('text_wdr')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'text_wdr'
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <UserMinus size={14} />
                WDR Text
              </button>
            </div>

            {/* EMAIL EDITOR — shown for regular/rookie tabs */}
            {!isTextTab && (
              <div className="space-y-4">
                {/* Subject */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <h3 className="font-bold text-sm text-gray-300 mb-2 flex items-center gap-2">
                    <Mail size={14} className="text-blue-400" /> Subject Line
                  </h3>
                  <input
                    type="text"
                    value={currentEmailTemplate.subject}
                    onChange={e => updateEmail({ subject: e.target.value })}
                    placeholder="e.g., Your Shift Confirmation – {{date}}"
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Variables: <code className="text-gray-400">{'{{firstName}}'}</code>, <code className="text-gray-400">{'{{date}}'}</code>, <code className="text-gray-400">{'{{contractorId}}'}</code>
                  </p>
                </div>

                {/* Body */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <h3 className="font-bold text-sm text-gray-300 mb-2">Email Body</h3>
                  <textarea
                    rows={10}
                    value={currentEmailTemplate.bodyIntro}
                    onChange={e => updateEmail({ bodyIntro: e.target.value })}
                    className={inputClass + ' resize-y font-mono text-xs leading-relaxed'}
                    placeholder="Write the email body here..."
                  />

                  {/* Variable reference table */}
                  <div className="mt-3 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="px-3 py-2 bg-gray-700/50 text-xs font-bold text-gray-400 uppercase tracking-wide">
                      Available Placeholders
                    </div>
                    <div className="divide-y divide-gray-800">
                      {BODY_VARS.map(v => (
                        <div key={v.placeholder} className="flex items-start gap-3 px-3 py-2">
                          <code
                            className="text-[11px] bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded border border-gray-700 flex-shrink-0 cursor-pointer hover:bg-blue-900/30 hover:border-blue-700 transition-colors"
                            title="Click to copy"
                            onClick={() => navigator.clipboard?.writeText(v.placeholder)}
                          >
                            {v.placeholder}
                          </code>
                          <span className="text-xs text-gray-400 leading-relaxed">{v.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {activeTab === 'rookie' && (
                    <div className="mt-2 text-xs text-purple-300 bg-purple-900/20 border border-purple-700/40 rounded p-2">
                      🎓 Rookie emails automatically include the online training login section below the body.
                    </div>
                  )}
                </div>

                {/* Reply-To */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <h3 className="font-bold text-sm text-gray-300 mb-2">Reply-To Address</h3>
                  <input
                    type="email"
                    value={currentEmailTemplate.replyTo}
                    onChange={e => updateEmail({ replyTo: e.target.value })}
                    placeholder="manager@propertystars.app (optional)"
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Emails send from <code className="text-gray-400">staff@propertystars.app</code>.
                    Leave blank to use the default.
                  </p>
                </div>

                {/* Signature */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <h3 className="font-bold text-sm text-gray-300 mb-3">Signature</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input
                        type="text"
                        value={currentEmailTemplate.signatureName}
                        onChange={e => updateEmail({ signatureName: e.target.value })}
                        placeholder="e.g., Vijay Baskaran"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Title</label>
                      <input
                        type="text"
                        value={currentEmailTemplate.signatureTitle}
                        onChange={e => updateEmail({ signatureTitle: e.target.value })}
                        placeholder="e.g., Operations Manager"
                        className={inputClass}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Phone</label>
                        <input
                          type="text"
                          value={currentEmailTemplate.signaturePhone}
                          onChange={e => updateEmail({ signaturePhone: e.target.value })}
                          placeholder="905 555 1234"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Email</label>
                        <input
                          type="email"
                          value={currentEmailTemplate.signatureEmail}
                          onChange={e => updateEmail({ signatureEmail: e.target.value })}
                          placeholder="you@propertystars.app"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TEXT EDITOR — shown for text/text_ns/text_wdr tabs */}
            {isTextTab && (
              <div className="space-y-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <h3 className={`font-bold text-sm text-gray-300 mb-2 flex items-center gap-2`}>
                    <MessageSquare size={14} className={textTabTheme.text} />
                    {textTabLabel}
                  </h3>
                  <textarea
                    rows={8}
                    value={currentTextTemplate.bodyText}
                    onChange={e => updateText({ bodyText: e.target.value })}
                    className={inputClass + ' resize-y font-mono text-xs leading-relaxed'}
                    placeholder="Write the text message body here..."
                  />
                  {/* Character counter */}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      {currentTextTemplate.bodyText.length} characters
                      {currentTextTemplate.bodyText.length > 160 && (
                        <span className="text-amber-400 ml-1">
                          · may split into {Math.ceil(currentTextTemplate.bodyText.length / 160)} messages
                        </span>
                      )}
                    </span>
                    <span className="text-gray-600">
                      SMS limit is ~160 chars per message
                    </span>
                  </div>

                  {/* Variable reference table */}
                  <div className="mt-3 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="px-3 py-2 bg-gray-700/50 text-xs font-bold text-gray-400 uppercase tracking-wide">
                      Available Placeholders
                    </div>
                    <div className="divide-y divide-gray-800">
                      {TEXT_VARS.map(v => (
                        <div key={v.placeholder} className="flex items-start gap-3 px-3 py-2">
                          <code
                            className="text-[11px] bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded border border-gray-700 flex-shrink-0 cursor-pointer hover:bg-blue-900/30 hover:border-blue-700 transition-colors"
                            title="Click to copy"
                            onClick={() => navigator.clipboard?.writeText(v.placeholder)}
                          >
                            {v.placeholder}
                          </code>
                          <span className="text-xs text-gray-400 leading-relaxed">{v.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`mt-2 text-xs border rounded p-2 ${textTabTheme.text} ${textTabTheme.bg} ${textTabTheme.border}`}>
                    💬 {textTabHint} Same message is used for both cell and alt phones.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Preview */}
          <div className={showPreview ? '' : 'hidden lg:block'}>
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden sticky top-20">
              <div className="bg-gray-900 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-400">
                  {activeTab === 'regular'  && 'Regular Email Preview'}
                  {activeTab === 'rookie'   && 'Rookie Email Preview'}
                  {activeTab === 'text'     && 'Workerbook Text Preview'}
                  {activeTab === 'text_ns'  && 'NS Callback Text Preview'}
                  {activeTab === 'text_wdr' && 'WDR Callback Text Preview'}
                </span>
                <span className="text-xs text-gray-500">Sample data shown</span>
              </div>

              {/* Email preview iframe */}
              {!isTextTab && (
                <div className="bg-white" style={{ height: '700px', overflow: 'auto' }}>
                  <iframe
                    srcDoc={previewHtml()}
                    className="w-full h-full border-0"
                    title="Email Preview"
                  />
                </div>
              )}

              {/* Text preview — phone-style bubble */}
              {isTextTab && (
                <div className="bg-gray-950 p-6" style={{ minHeight: '500px' }}>
                  <div className="max-w-sm mx-auto">
                    <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                      <Smartphone size={14} />
                      <span>To: {SAMPLE_DATA.firstName} {SAMPLE_DATA.lastName}</span>
                    </div>
                    <div className={`${textTabTheme.bubble} text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-lg`}>
                      {previewText()}
                    </div>
                    <div className="text-right text-[11px] text-gray-500 mt-1 mr-2">Delivered</div>

                    <div className="mt-6 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-3">
                      <div className="font-bold text-gray-400 mb-1">Sample contractor data:</div>
                      <div>Name: {SAMPLE_DATA.firstName} {SAMPLE_DATA.lastName}</div>
                      <div>CN: {SAMPLE_DATA.contractorId}</div>
                      <div>Date: {SAMPLE_DATA.date}</div>
                      <div>Shuttle: #{SAMPLE_SHUTTLE.shuttleNumber} — {SAMPLE_SHUTTLE.description}</div>
                      <div>Pickup: {SAMPLE_SHUTTLE.pickupTime}</div>
                      <div>Days: {SAMPLE_DATA.days}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkerbookEmailService;