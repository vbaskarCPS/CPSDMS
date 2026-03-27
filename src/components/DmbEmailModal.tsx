// src/components/DmbEmailModal.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader, Mail, X, Send } from 'lucide-react';
import { googleSheetsService } from '../lib/googleSheetsService';
import {
  DmbEmailTemplate,
  DEFAULT_DMB_TEMPLATE,
  buildDmbEmailHtml,
  loadDmbTemplate,
  saveDmbTemplate,
  sendDmbConfirmationEmail,
} from '../lib/dmbEmailService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface BookingRecord {
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  serviceType: string;
  price: string;
  isPrepaid: boolean;
  email: string;
  rowIndex: number;
}

interface SavedRoute {
  id: string;
  route_code: string;
  [key: string]: any;
}

interface Props {
  currentRoutes: SavedRoute[];
  bookingsData: Map<string, BookingRecord[]>;
  isGoogleConnected: boolean;
  onClose: () => void;
}

// ─── SAMPLE BOOKING FOR PREVIEW ──────────────────────────────────────────────

const PREVIEW_BOOKING = {
  firstName: 'John', lastName: 'Smith', houseNum: '123', streetName: 'Maple Avenue',
  city: 'Burlington', price: '56.50', serviceType: 'FP', routeCode: 'BS01',
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const DmbEmailModal: React.FC<Props> = ({ currentRoutes, bookingsData, isGoogleConnected, onClose }) => {
  const [dmbTemplate, setDmbTemplate] = useState<DmbEmailTemplate>(DEFAULT_DMB_TEMPLATE);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailProgress, setEmailProgress] = useState<{ current: number; total: number } | null>(null);
  const [emailResults, setEmailResults] = useState<{ sent: number; failed: number } | null>(null);

  // ── Load saved template on mount ────────────────────────────────────────────
  useEffect(() => {
    if (templateLoaded) return;
    loadDmbTemplate()
      .then(saved => setDmbTemplate(saved))
      .catch(() => setDmbTemplate({ ...DEFAULT_DMB_TEMPLATE }))
      .finally(() => setTemplateLoaded(true));
  }, [templateLoaded]);

  // ── All bookings for current routes with a valid email ──────────────────────
  const emailableBookings = useMemo<BookingRecord[]>(() => {
    const result: BookingRecord[] = [];
    currentRoutes.forEach(r => {
      (bookingsData.get(r.route_code) || []).forEach(b => {
        if (b.email?.trim() && b.email.includes('@')) result.push(b);
      });
    });
    return result;
  }, [currentRoutes, bookingsData]);

  // ── Live preview ────────────────────────────────────────────────────────────
  const previewHtml = useMemo(
    () => buildDmbEmailHtml(dmbTemplate, PREVIEW_BOOKING),
    [dmbTemplate]
  );

  // ── Send ────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (emailableBookings.length === 0) return;
    setEmailSending(true);
    setEmailResults(null);

    try { await saveDmbTemplate(dmbTemplate); } catch { /* non-fatal */ }

    let bookingsSheetId: number | null = null;
    try { bookingsSheetId = await googleSheetsService.getMasterbookingsTabSheetId('Bookings'); } catch { /* non-fatal */ }

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < emailableBookings.length; i++) {
      const booking = emailableBookings[i];
      setEmailProgress({ current: i + 1, total: emailableBookings.length });

      const result = await sendDmbConfirmationEmail(booking, dmbTemplate);
      if (result.success) {
        sent++;
      } else {
        failed++;
        if (bookingsSheetId !== null && booking.rowIndex) {
          try { await googleSheetsService.highlightFailedEmailCell(bookingsSheetId, booking.rowIndex); } catch { /* non-fatal */ }
        }
      }

      await new Promise(r => setTimeout(r, 100));
    }

    setEmailSending(false);
    setEmailProgress(null);
    setEmailResults({ sent, failed });
  }, [emailableBookings, dmbTemplate]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Mail size={18} className="text-green-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Confirm Emails</h2>
              <p className="text-xs text-gray-400">{emailableBookings.length} recipients with valid emails</p>
            </div>
          </div>
          <button
            onClick={() => { if (!emailSending) onClose(); }}
            disabled={emailSending}
            className="text-gray-500 hover:text-white transition-colors disabled:opacity-30"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        {emailResults ? (
          // ── Results ──
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="flex items-center justify-center gap-8 mb-6">
                <div>
                  <div className="text-4xl font-bold text-green-400 mb-1">{emailResults.sent}</div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Sent</div>
                </div>
                {emailResults.failed > 0 && (
                  <div>
                    <div className="text-4xl font-bold text-red-400 mb-1">{emailResults.failed}</div>
                    <div className="text-xs text-gray-400 uppercase tracking-wider">Failed</div>
                  </div>
                )}
              </div>
              {emailResults.failed > 0 && (
                <p className="text-xs text-gray-500 mb-6">
                  Failed rows have been highlighted red in the Bookings tab of your Masterbookings sheet.
                </p>
              )}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => setEmailResults(null)}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Edit & Resend
                </button>
              </div>
            </div>
          </div>
        ) : (
          // ── Editor + preview ──
          <div className="flex flex-1 overflow-hidden">

            {/* Left — form */}
            <div className="w-80 flex-shrink-0 border-r border-gray-700 flex flex-col overflow-y-auto p-5 gap-4">

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={dmbTemplate.subject}
                  onChange={e => setDmbTemplate(t => ({ ...t, subject: e.target.value }))}
                  disabled={emailSending}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-sm text-white focus:ring-2 focus:ring-green-500 focus:outline-none disabled:opacity-50"
                />
              </div>

              {/* Body */}
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Email Body</label>
                <textarea
                  value={dmbTemplate.bodyIntro}
                  onChange={e => setDmbTemplate(t => ({ ...t, bodyIntro: e.target.value }))}
                  disabled={emailSending}
                  rows={8}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-sm text-white focus:ring-2 focus:ring-green-500 focus:outline-none resize-none disabled:opacity-50"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {[
                    ['{{firstName}}',  'First name'],
                    ['{{fullName}}',   'Full name'],
                    ['{{address}}',    'Address'],
                    ['{{totalPrice}}', 'Total'],
                  ].map(([tag, label]) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setDmbTemplate(t => ({ ...t, bodyIntro: t.bodyIntro + tag }))}
                      disabled={emailSending}
                      title={label}
                      className="text-[10px] bg-gray-700 hover:bg-gray-600 text-blue-300 border border-gray-600 px-1.5 py-0.5 rounded font-mono transition-colors disabled:opacity-40"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                  Price breakdown and service details are auto-appended below your message.
                </p>
              </div>

              {/* Reply-to */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Reply-To Email</label>
                <input
                  type="email"
                  value={dmbTemplate.replyTo}
                  onChange={e => setDmbTemplate(t => ({ ...t, replyTo: e.target.value }))}
                  disabled={emailSending}
                  placeholder="e.g. manager@propertystars.app"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-3 text-sm text-white focus:ring-2 focus:ring-green-500 focus:outline-none disabled:opacity-50"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Optional. Customers who reply will reach this address.
                </p>
              </div>
            </div>

            {/* Right — live preview */}
            <div className="flex-1 flex flex-col overflow-hidden bg-gray-800">
              <div className="px-4 py-2 border-b border-gray-700 flex-shrink-0">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Live Preview</span>
                <span className="text-[10px] text-gray-600 ml-2">(sample data)</span>
              </div>
              <div className="flex-1 overflow-auto">
                <iframe
                  srcDoc={previewHtml}
                  title="Email preview"
                  className="w-full h-full border-0"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!emailResults && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700 flex-shrink-0 bg-gray-900/80">
            <div className="text-xs text-gray-500">
              Sending from <span className="text-gray-300 font-mono">clientcare@propertystars.app</span>
            </div>
            <div className="flex items-center gap-3">
              {emailProgress && (
                <div className="flex items-center gap-2 text-blue-400 text-xs font-medium">
                  <Loader size={13} className="animate-spin" />
                  Sending {emailProgress.current}/{emailProgress.total}…
                </div>
              )}
              <button
                onClick={() => { if (!emailSending) onClose(); }}
                disabled={emailSending}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={emailSending || emailableBookings.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {emailSending ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
                Send to {emailableBookings.length} recipients
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default DmbEmailModal;