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
  BookOpen,
  Scissors,
  FileText,
} from 'lucide-react';
import {
  campaignService,
  Campaign,
  CampaignManager,
  CampaignBook,
  extractSheetId,
} from '../../lib/campaignService';
import type { CampaignType } from '../../lib/campaignService';
import { executeCut, CutProgress, CutResult } from '../../lib/cutService';
import { generatePCL, PCLProgress, PCLResult } from '../../lib/pclService';

const CAMPAIGN_TYPE_OPTIONS: { value: CampaignType; label: string; desc: string }[] = [
  { value: 'standard', label: 'Standard', desc: 'Standard aeration callbook' },
  { value: 'bc', label: 'BC Type', desc: 'BC book with service flags (ADFSL) and upsells' },
  { value: 'sealing', label: 'Sealing', desc: 'Sealing callbook with SS/SSP/RAMP services' },
];

const CampaignCreator: React.FC = () => {
  const navigate = useNavigate();

  // --- State ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Campaign (team) modal
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Expanded campaign (show books + managers)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<'books' | 'managers'>('books');
  const [managers, setManagers] = useState<CampaignManager[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [books, setBooks] = useState<CampaignBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);

  // Manager modal
  const [showManagerModal, setShowManagerModal] = useState(false);
  const [editingManager, setEditingManager] = useState<CampaignManager | null>(null);
  const [managerForm, setManagerForm] = useState({ name: '', repCode: '', password: 'callofduty' });
  const [managerFormErrors, setManagerFormErrors] = useState<Record<string, string>>({});
  const [savingManager, setSavingManager] = useState(false);
  const [managerCampaignId, setManagerCampaignId] = useState<string | null>(null);

  // Book modal
  const [showBookModal, setShowBookModal] = useState(false);
  const [editingBook, setEditingBook] = useState<CampaignBook | null>(null);
  const [bookForm, setBookForm] = useState({
    displayName: '',
    spreadsheetUrl: '',
    appsScriptUrl: '',
    campaignType: 'standard' as CampaignType,
    masterSpreadsheetUrl: '',
  });
  const [bookFormErrors, setBookFormErrors] = useState<Record<string, string>>({});
  const [savingBook, setSavingBook] = useState(false);
  const [bookCampaignId, setBookCampaignId] = useState<string | null>(null);

  // CUT state
  const [cuttingBookId, setCuttingBookId] = useState<string | null>(null);
  const [cutProgress, setCutProgress] = useState<CutProgress | null>(null);
  const [cutResult, setCutResult] = useState<CutResult | null>(null);

  // PCL state
  const [pclSelectMode, setPclSelectMode] = useState(false);
  const [pclSelectedBookIds, setPclSelectedBookIds] = useState<Set<string>>(new Set());
  const [pclBookId, setPclBookId] = useState<string | null>(null);
  const [pclProgress, setPclProgress] = useState<PCLProgress | null>(null);

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

  const loadBooks = async (campaignId: string) => {
    setBooksLoading(true);
    try {
      const data = await campaignService.getBooksByCampaign(campaignId);
      setBooks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load books');
    } finally {
      setBooksLoading(false);
    }
  };

  // --- Campaign (Team) CRUD ---

  const resetForm = () => {
    setFormData({ displayName: '' });
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
    if (!formData.displayName.trim()) errors.displayName = 'Team name is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    setError(null);

    try {
      if (editingCampaign) {
        await campaignService.updateCampaign(editingCampaign.id, {
          displayName: formData.displayName,
        });
      } else {
        await campaignService.createCampaign({
          displayName: formData.displayName,
          spreadsheetId: 'placeholder',
        });
      }
      await loadCampaigns();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Campaign) => {
    const msg = '⚠️ DELETE "' + c.displayName + '"?\n\nThis will permanently delete:\n• All books (spreadsheets)\n• All campaign managers\n• All dialer sessions & gamification data\n\nThis action cannot be undone!';
    if (!window.confirm(msg)) return;

    try {
      await campaignService.deleteCampaign(c.id);
      if (expandedId === c.id) setExpandedId(null);
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete team');
    }
  };

  // --- Toggle expand / collapse ---
  const toggleExpand = async (campaignId: string) => {
    if (expandedId === campaignId) {
      setExpandedId(null);
      setManagers([]);
      setBooks([]);
    } else {
      setExpandedId(campaignId);
      setExpandedSection('books');
      await loadBooks(campaignId);
    }
  };

  const switchSection = async (section: 'books' | 'managers') => {
    setExpandedSection(section);
    if (section === 'managers' && expandedId) {
      await loadManagers(expandedId);
    } else if (section === 'books' && expandedId) {
      await loadBooks(expandedId);
    }
  };

  // --- Book CRUD ---

  const openAddBookModal = (campaignId: string) => {
    setBookCampaignId(campaignId);
    setEditingBook(null);
    setBookForm({ displayName: '', spreadsheetUrl: '', appsScriptUrl: '', campaignType: 'standard', masterSpreadsheetUrl: '' });
    setBookFormErrors({});
    setShowBookModal(true);
  };

  const openEditBookModal = (book: CampaignBook) => {
    setBookCampaignId(book.campaignId);
    setEditingBook(book);
    setBookForm({
      displayName: book.displayName,
      spreadsheetUrl: book.spreadsheetUrl || ('https://docs.google.com/spreadsheets/d/' + book.spreadsheetId + '/edit'),
      appsScriptUrl: book.appsScriptUrl || '',
      campaignType: book.campaignType || 'standard',
      masterSpreadsheetUrl: book.masterSpreadsheetUrl || '',
    });
    setBookFormErrors({});
    setShowBookModal(true);
  };

  const closeBookModal = () => {
    setShowBookModal(false);
    setEditingBook(null);
    setBookCampaignId(null);
  };

  const validateBookForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!bookForm.displayName.trim()) errors.displayName = 'Book name is required';
    const sheetId = extractSheetId(bookForm.spreadsheetUrl);
    if (!sheetId) errors.spreadsheetUrl = 'Invalid Google Sheets URL or ID';
    // Master URL is optional, but if provided it must be valid
    if (bookForm.masterSpreadsheetUrl.trim()) {
      const masterId = extractSheetId(bookForm.masterSpreadsheetUrl);
      if (!masterId) errors.masterSpreadsheetUrl = 'Invalid Google Sheets URL or ID';
    }
    setBookFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveBook = async () => {
    if (!validateBookForm() || !bookCampaignId) return;
    setSavingBook(true);
    setError(null);

    try {
      const spreadsheetId = extractSheetId(bookForm.spreadsheetUrl)!;
      const masterSpreadsheetId = bookForm.masterSpreadsheetUrl.trim()
        ? extractSheetId(bookForm.masterSpreadsheetUrl) || undefined
        : undefined;

      if (editingBook) {
        await campaignService.updateBook(editingBook.id, {
          displayName: bookForm.displayName,
          spreadsheetId,
          spreadsheetUrl: bookForm.spreadsheetUrl,
          appsScriptUrl: bookForm.appsScriptUrl || undefined,
          campaignType: bookForm.campaignType,
          masterSpreadsheetUrl: bookForm.masterSpreadsheetUrl || '',
          masterSpreadsheetId: masterSpreadsheetId || '',
        });
      } else {
        await campaignService.createBook({
          campaignId: bookCampaignId,
          displayName: bookForm.displayName,
          spreadsheetId,
          spreadsheetUrl: bookForm.spreadsheetUrl,
          appsScriptUrl: bookForm.appsScriptUrl || undefined,
          campaignType: bookForm.campaignType,
          masterSpreadsheetUrl: bookForm.masterSpreadsheetUrl || undefined,
          masterSpreadsheetId: masterSpreadsheetId,
        });
      }
      await loadBooks(bookCampaignId);
      closeBookModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save book');
    } finally {
      setSavingBook(false);
    }
  };

  const handleDeleteBook = async (book: CampaignBook) => {
    if (!window.confirm('Delete book "' + book.displayName + '"? This cannot be undone.')) return;
    try {
      await campaignService.deleteBook(book.id);
      if (expandedId) await loadBooks(expandedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete book');
    }
  };

  // --- CUT ---

  const handleCutBook = async (book: CampaignBook) => {
    if (!book.masterSpreadsheetId) {
      setError('No master bookings URL set for "' + book.displayName + '". Edit the book and add one first.');
      return;
    }

    const msg = '✂️ CUT Bookings from "' + book.displayName + '"?\n\nThis will scan all tabs for AER bookings and append new ones to the master bookings spreadsheet.\n\nAlready-cut bookings will be skipped (no duplicates).';
    if (!window.confirm(msg)) return;

    setCuttingBookId(book.id);
    setCutProgress({ phase: 'Starting', detail: 'Initializing...', percent: 0 });
    setCutResult(null);
    setError(null);

    try {
      const result = await executeCut(book, (progress) => {
        setCutProgress(progress);
      });

      setCutResult(result);

      // Diagnostic: log per-tab breakdown to console
      if (result.tabCounts) {
        console.log('✂️ CUT — Per-tab AER counts:');
        for (const [tab, count] of Object.entries(result.tabCounts)) {
          if (count === -1) console.log(`  ${tab}: FAILED TO LOAD`);
          else if (count === -2) console.log(`  ${tab}: NO DATA`);
          else if (count === -3) console.log(`  ${tab}: NO HEADERS FOUND`);
          else if (count === -4) console.log(`  ${tab}: MISSING AER/BOOKING_ID COLUMN`);
          else console.log(`  ${tab}: ${count} bookings`);
        }
        console.log(`  TOTAL SCANNED: ${result.totalScanned} | NEW: ${result.newBookings} | SKIPPED: ${result.skippedBookings}`);
      }
      if (result.success) {
        if (result.newBookings > 0) {
          setSuccessMsg(
            '✂️ CUT complete: ' + result.newBookings + ' new booking' + (result.newBookings !== 1 ? 's' : '') +
            ' added to master' +
            (result.skippedBookings > 0 ? ' (' + result.skippedBookings + ' already cut, skipped)' : '') +
            ' — scanned ' + result.tabsScanned + ' tab' + (result.tabsScanned !== 1 ? 's' : '')
          );
        } else {
          setSuccessMsg(
            '✂️ CUT complete: No new bookings to add.' +
            (result.skippedBookings > 0 ? ' All ' + result.skippedBookings + ' booking' + (result.skippedBookings !== 1 ? 's' : '') + ' were already cut.' : ' No AER bookings found.') +
            ' Scanned ' + result.tabsScanned + ' tab' + (result.tabsScanned !== 1 ? 's' : '') + '.'
          );
        }
      } else {
        setError('CUT failed: ' + (result.errorMessage || 'Unknown error'));
      }
    } catch (err) {
      setError('CUT failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setCuttingBookId(null);
      setCutProgress(null);
    }
  };

  // --- PCL ---

  const togglePclSelectMode = () => {
    if (pclSelectMode) {
      // Exiting select mode — cancel
      setPclSelectMode(false);
      setPclSelectedBookIds(new Set());
    } else {
      // Entering select mode
      setPclSelectMode(true);
      setPclSelectedBookIds(new Set());
    }
  };

  const togglePclBookSelection = (bookId: string) => {
    setPclSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const handleGeneratePCL = async () => {
    const selectedBooks = books.filter((b) => pclSelectedBookIds.has(b.id));
    if (selectedBooks.length === 0) {
      setError('No books selected for PCL. Check at least one book.');
      return;
    }

    setPclBookId('generating');
    setPclProgress({ phase: 'Starting', detail: 'Initializing...', percent: 0 });
    setError(null);

    try {
      const result = await generatePCL(selectedBooks, (progress) => {
        setPclProgress(progress);
      });

      if (result.success) {
        setSuccessMsg(
          '📄 PCL generated: ' + result.totalRows + ' row' + (result.totalRows !== 1 ? 's' : '') +
          ' across ' + result.routeCodes + ' route code' + (result.routeCodes !== 1 ? 's' : '') +
          ' from ' + result.booksScanned + ' book' + (result.booksScanned !== 1 ? 's' : '') +
          ' — scanned ' + result.tabsScanned + ' tab' + (result.tabsScanned !== 1 ? 's' : '')
        );
      } else {
        setError('PCL failed: ' + (result.errorMessage || 'Unknown error'));
      }
    } catch (err) {
      setError('PCL failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setPclBookId(null);
      setPclProgress(null);
      setPclSelectMode(false);
      setPclSelectedBookIds(new Set());
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

  const bookSheetIdPreview = getSheetIdPreview(bookForm.spreadsheetUrl);
  const masterSheetIdPreview = getSheetIdPreview(bookForm.masterSpreadsheetUrl);

  const getTypeBadge = (type: CampaignType) => {
    if (type === 'bc') {
      return (
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(241,196,15,0.15)', border: '1px solid rgba(241,196,15,0.35)', color: '#f1c40f' }}>
          BC
        </span>
      );
    }
    if (type === 'sealing') {
      return (
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(52,152,219,0.15)', border: '1px solid rgba(52,152,219,0.35)', color: '#3498db' }}>
          SEAL
        </span>
      );
    }
    return (
      <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.35)', color: '#2ecc71' }}>
        STD
      </span>
    );
  };

  // --- Render ---

  const renderCampaignCard = (c: Campaign) => {
    const isExpanded = expandedId === c.id;

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
                <h3 className="text-lg font-bold text-white">{c.displayName}</h3>
                <div className="text-xs text-gray-500">Call Team</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleExpand(c.id)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
              <button
                onClick={() => openEditModal(c)}
                className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                title="Edit Team Name"
              >
                <Edit2 size={18} />
              </button>
              <button
                onClick={() => handleDelete(c)}
                className="bg-red-900/30 hover:bg-red-900/50 text-red-400 p-2 rounded-lg transition-colors"
                title="Delete Team"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Expanded Panel */}
        {isExpanded && (
          <div className="border-t border-gray-700">
            {/* Section Tabs */}
            <div className="flex border-b border-gray-700">
              <button
                onClick={() => switchSection('books')}
                className={'flex-1 px-4 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ' +
                  (expandedSection === 'books' ? 'text-green-400 border-b-2 border-green-400 bg-gray-800' : 'text-gray-500 hover:text-gray-300')}
              >
                <BookOpen size={14} />
                Books
                {!booksLoading && <span className="text-xs opacity-60">({books.length})</span>}
              </button>
              <button
                onClick={() => switchSection('managers')}
                className={'flex-1 px-4 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ' +
                  (expandedSection === 'managers' ? 'text-green-400 border-b-2 border-green-400 bg-gray-800' : 'text-gray-500 hover:text-gray-300')}
              >
                <Users size={14} />
                Managers
                {!managersLoading && expandedSection === 'managers' && <span className="text-xs opacity-60">({managers.length})</span>}
              </button>
            </div>

            {/* Books Section */}
            {expandedSection === 'books' && (
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                    <BookOpen size={14} />
                    Campaign Books
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* PCL Button — toggles select mode or generates */}
                    {books.length > 0 && (
                      <>
                        {pclSelectMode && (
                          <button
                            onClick={togglePclSelectMode}
                            className="text-gray-400 hover:text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                          >
                            <X size={12} />
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={pclSelectMode ? handleGeneratePCL : togglePclSelectMode}
                          disabled={pclBookId === 'generating'}
                          className={
                            'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors border ' +
                            (pclBookId === 'generating'
                              ? 'bg-blue-900/30 border-blue-700 text-blue-400 opacity-70 cursor-not-allowed'
                              : pclSelectMode && pclSelectedBookIds.size > 0
                                ? 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white'
                                : 'bg-blue-900/30 hover:bg-blue-900/60 border-blue-700 text-blue-400')
                          }
                        >
                          {pclBookId === 'generating' ? (
                            <Loader className="animate-spin" size={12} />
                          ) : (
                            <FileText size={12} />
                          )}
                          {pclSelectMode
                            ? (pclSelectedBookIds.size > 0
                                ? `Generate PCL (${pclSelectedBookIds.size})`
                                : 'Select Books')
                            : 'PCL'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => openAddBookModal(c.id)}
                      className="bg-green-900/50 hover:bg-green-900 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors border border-green-800"
                    >
                      <Plus size={12} />
                      Add Book
                    </button>
                  </div>
                </div>

                {/* PCL Progress Bar (shown during generation) */}
                {pclBookId === 'generating' && pclProgress && (
                  <div className="mb-3 p-3 bg-gray-800 rounded-lg border border-blue-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-blue-400 font-medium">{pclProgress.phase}</span>
                      <span className="text-xs text-gray-500">{pclProgress.percent}%</span>
                    </div>
                    <div className="w-full bg-gray-900 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: pclProgress.percent + '%' }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{pclProgress.detail}</p>
                  </div>
                )}

                {booksLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader className="animate-spin text-gray-500" size={20} />
                  </div>
                ) : books.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 text-center">
                    No books yet. Add a spreadsheet to get started.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {books.map((book) => {
                      const isCutting = cuttingBookId === book.id;
                      const hasMaster = !!book.masterSpreadsheetId;
                      const isPclSelected = pclSelectedBookIds.has(book.id);

                      return (
                        <div
                          key={book.id}
                          className={'bg-gray-900 rounded-lg px-4 py-3 border transition-colors ' +
                            (pclSelectMode && isPclSelected
                              ? 'border-blue-500 bg-blue-900/10'
                              : 'border-gray-700')}
                          onClick={pclSelectMode ? () => togglePclBookSelection(book.id) : undefined}
                          style={pclSelectMode ? { cursor: 'pointer' } : undefined}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {/* Checkbox in PCL select mode */}
                              {pclSelectMode && (
                                <div className={'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ' +
                                  (isPclSelected
                                    ? 'bg-blue-600 border-blue-500'
                                    : 'border-gray-600 bg-gray-800')}
                                >
                                  {isPclSelected && <Check size={12} className="text-white" />}
                                </div>
                              )}
                              <div className="w-8 h-8 rounded-full bg-blue-900/30 border border-blue-800 flex items-center justify-center">
                                <Sheet size={14} className="text-blue-400" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white text-sm font-medium">{book.displayName}</span>
                                  {getTypeBadge(book.campaignType)}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <code className="text-gray-500 text-xs">{book.spreadsheetId.substring(0, 20)}...</code>
                                  {book.appsScriptUrl && (
                                    <span className="flex items-center gap-1 text-xs text-blue-400">
                                      <Link size={8} />
                                      Bridge
                                    </span>
                                  )}
                                  {hasMaster && (
                                    <span className="flex items-center gap-1 text-xs text-purple-400">
                                      <Scissors size={8} />
                                      Master
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {/* Action buttons — hidden in PCL select mode */}
                            {!pclSelectMode && (
                              <div className="flex items-center gap-2">
                                {/* CUT Button */}
                                <button
                                  onClick={() => handleCutBook(book)}
                                  disabled={isCutting}
                                  className={
                                    'px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors border ' +
                                    (isCutting
                                      ? 'bg-purple-900/30 border-purple-700 text-purple-400 opacity-70 cursor-not-allowed'
                                      : hasMaster
                                        ? 'bg-purple-900/30 hover:bg-purple-900/60 border-purple-700 text-purple-400'
                                        : 'bg-gray-800 border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-500')
                                  }
                                  title={hasMaster ? 'Cut bookings to master' : 'Set master bookings URL first'}
                                >
                                  {isCutting ? (
                                    <Loader className="animate-spin" size={12} />
                                  ) : (
                                    <Scissors size={12} />
                                  )}
                                  CUT
                                </button>
                                <button
                                  onClick={() => openEditBookModal(book)}
                                  className="text-gray-500 hover:text-white p-1 transition-colors"
                                  title="Edit Book"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteBook(book)}
                                  className="text-gray-500 hover:text-red-400 p-1 transition-colors"
                                  title="Delete Book"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* CUT Progress Bar */}
                          {isCutting && cutProgress && (
                            <div className="mt-3 pt-3 border-t border-gray-700">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-purple-400 font-medium">{cutProgress.phase}</span>
                                <span className="text-xs text-gray-500">{cutProgress.percent}%</span>
                              </div>
                              <div className="w-full bg-gray-800 rounded-full h-1.5">
                                <div
                                  className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: cutProgress.percent + '%' }}
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{cutProgress.detail}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Managers Section */}
            {expandedSection === 'managers' && (
              <div className="px-5 py-4">
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
                    No managers yet. Add managers to give them access to this team's books.
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
              <p className="text-xs text-gray-400">AutoSniper Dialer — Teams & Books</p>
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
            Create Team
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-green-400" size={32} />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
            <Crosshair className="mx-auto text-gray-600 mb-4" size={48} />
            <h3 className="text-lg font-bold text-gray-400 mb-2">No Teams</h3>
            <p className="text-gray-500 text-sm">Create your first call team to start adding books and managers.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map(renderCampaignCard)}
          </div>
        )}
      </div>

      {/* Team Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingCampaign ? 'Edit Team' : 'Create Team'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Team Name</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., Hamilton"
                  className={'w-full bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none ' +
                    (formErrors.displayName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                />
                {formErrors.displayName && <p className="text-red-400 text-xs mt-1">{formErrors.displayName}</p>}
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
                {editingCampaign ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Book Create/Edit Modal */}
      {showBookModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingBook ? 'Edit Book' : 'Add Book'}
              </h2>
              <button onClick={closeBookModal} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Book Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Book Name</label>
                <input
                  type="text"
                  value={bookForm.displayName}
                  onChange={(e) => setBookForm({ ...bookForm, displayName: e.target.value })}
                  placeholder="e.g., Aeration Book, BC Interior"
                  className={'w-full bg-gray-900 border rounded-lg py-2 px-3 text-white focus:ring-2 focus:outline-none ' +
                    (bookFormErrors.displayName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                />
                {bookFormErrors.displayName && <p className="text-red-400 text-xs mt-1">{bookFormErrors.displayName}</p>}
              </div>

              {/* Campaign Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Book Type</label>
                <div className="flex gap-3">
                  {CAMPAIGN_TYPE_OPTIONS.map((opt) => {
                    const isSelected = bookForm.campaignType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setBookForm({ ...bookForm, campaignType: opt.value })}
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
                <label className="block text-sm font-medium text-gray-300 mb-1">Spreadsheet URL</label>
                <div className="relative">
                  <Sheet className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={bookForm.spreadsheetUrl}
                    onChange={(e) => setBookForm({ ...bookForm, spreadsheetUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className={'w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none text-sm ' +
                      (bookFormErrors.spreadsheetUrl ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500')}
                  />
                </div>
                {bookFormErrors.spreadsheetUrl && <p className="text-red-400 text-xs mt-1">{bookFormErrors.spreadsheetUrl}</p>}
                {bookSheetIdPreview && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    <span>{bookSheetIdPreview}</span>
                  </p>
                )}
              </div>

              {/* Master Bookings URL */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Master Bookings URL <span className="text-gray-500">(for CUT)</span>
                </label>
                <div className="relative">
                  <Scissors className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={bookForm.masterSpreadsheetUrl}
                    onChange={(e) => setBookForm({ ...bookForm, masterSpreadsheetUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className={'w-full bg-gray-900 border rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:outline-none text-sm ' +
                      (bookFormErrors.masterSpreadsheetUrl ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-purple-500')}
                  />
                </div>
                {bookFormErrors.masterSpreadsheetUrl && <p className="text-red-400 text-xs mt-1">{bookFormErrors.masterSpreadsheetUrl}</p>}
                {masterSheetIdPreview && (
                  <p className="text-purple-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} />
                    <span>{masterSheetIdPreview}</span>
                  </p>
                )}
                <p className="text-gray-500 text-xs mt-1">The spreadsheet where CUT will paste bookings into the "Bookings" tab.</p>
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
                    value={bookForm.appsScriptUrl}
                    onChange={(e) => setBookForm({ ...bookForm, appsScriptUrl: e.target.value })}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-10 pr-3 text-white focus:ring-2 focus:ring-green-500 focus:outline-none text-sm"
                  />
                </div>
                <p className="text-gray-500 text-xs mt-1">Used for row highlighting and hidden rows. Can be added later.</p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button onClick={closeBookModal} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSaveBook}
                disabled={savingBook}
                className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {savingBook ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
                {editingBook ? 'Save Changes' : 'Add Book'}
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