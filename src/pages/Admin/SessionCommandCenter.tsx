// src/pages/Admin/SessionCommandCenter.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Upload,
  AlertCircle,
  FileText,
  Users,
  Play,
  Search,
  Filter,
  Download,
  Lock,
  Unlock,
  Mail,
  CloudUpload,
  Loader,
  CheckCircle,
  Sheet,
  LogOut,
  ArrowLeft,
  Building2,
  Leaf,
  Wind,
  Package,
  UserPlus,
  GraduationCap,
  FileSpreadsheet,
  MapPin,
  Map as MapIcon,
  BookOpen,
  PlusCircle,
  CreditCard,
  Banknote,
} from 'lucide-react';
import { parseDailySessionXLSX } from '../../lib/feedParser';
import { sessionService, ImportMeta } from '../../lib/sessionService';
import { generateSessionExport, exportToGoogleSheets } from '../../lib/exportService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { getDateTabError } from '../../lib/googleSheetsConfig';
import { commandCenterService, regionHasSeasonSelection } from '../../lib/commandCenterService';
import { removeStorageItem } from '../../lib/localStorage';
import { DailySessionData, SortOption, LogsheetSession, SeasonType, SEASON_CONFIGS, EQ_DIVISOR } from '../../types';
import PayoutToday from '../Management/PayoutToday';
import JobFairManager from './JobFairManager';
import TrainingsTab from './TrainingsTab';
import PayslipGenerator from './PayslipGenerator';
import RouteFinderView from '../../components/RouteFinder/RouteFinderView';
import DigitalMasterBookings from './DigitalMasterBookings';
import DigitalWorkerbook from './DigitalWorkerbook';

const SessionCommandCenter: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<'lifecycle' | 'payout' | 'onboarding'>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'payout') return 'payout';
    if (tabParam === 'onboarding') return 'onboarding';
    return 'lifecycle';
  });

  // Sub-tab within Onboarding
  const [onboardingSubTab, setOnboardingSubTab] = useState<'jobfairs' | 'trainings'>('jobfairs');

  // Payslip generator visibility
  const [showPayslipGenerator, setShowPayslipGenerator] = useState(false);

  // Route Finder visibility
  const [showRouteFinder, setShowRouteFinder] = useState(false);

  // Digital Master Bookings visibility
  const [showDigitalMasterBookings, setShowDigitalMasterBookings] = useState(false);

  // Digital Workerbook visibility
  const [showDigitalWorkerbook, setShowDigitalWorkerbook] = useState(false);

  // --- COMMAND CENTER CONTEXT (stored in state to avoid infinite loops) ---
  const [currentCC, setCurrentCC] = useState(() => commandCenterService.getCurrentCommandCenter());
  const [isSuperAdminMode, setIsSuperAdminMode] = useState(() => commandCenterService.isSuperAdminMode());

  // Sync CC from localStorage on storage events (for cross-tab updates)
  useEffect(() => {
    const handleStorageUpdate = () => {
      setCurrentCC(commandCenterService.getCurrentCommandCenter());
      setIsSuperAdminMode(commandCenterService.isSuperAdminMode());
    };

    window.addEventListener('storageUpdated', handleStorageUpdate);
    window.addEventListener('storage', handleStorageUpdate);
    
    return () => {
      window.removeEventListener('storageUpdated', handleStorageUpdate);
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, []);

  // Redirect if no CC context
  useEffect(() => {
    if (!currentCC) {
      navigate('/login');
    }
  }, [currentCC, navigate]);

  // --- STATE ---
  const [feedFile, setFeedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<DailySessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [currentSession, setCurrentSession] = useState<DailySessionData | null>(null);
  const [logsheetSessions, setLogsheetSessions] = useState<LogsheetSession[]>([]);
  
  // Import metadata (persisted in DB)
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null);
  
  // Email Settings
  const [emailEnabled, setEmailEnabled] = useState(true);

  // NEW: Live Card Processing toggle
  const [liveCardEnabled, setLiveCardEnabled] = useState(false);

  // NEW: No Tax on Cash toggle (Rejuv only, default ON)
  const [noTaxOnCash, setNoTaxOnCash] = useState(true);

  // --- ADD ADDITIONAL STATE ---
  const [showAddAdditional, setShowAddAdditional] = useState(false);
  const [addAdditionalLoading, setAddAdditionalLoading] = useState(false);
  const [addAdditionalResult, setAddAdditionalResult] = useState<{
    managersAdded: number;
    workersAdded: number;
    routesAdded: number;
    bookingsAdded: number;
  } | null>(null);

  // --- SEASON TYPE STATE (West Region Only) ---
  const [selectedSeasonType, setSelectedSeasonType] = useState<SeasonType>('aeration');
  const canSelectSeason = currentCC ? regionHasSeasonSelection(currentCC.region) : false;

  // --- PRODUCT COST STATE (Lawn Rejuv Only) ---
  const [productCostPercent, setProductCostPercent] = useState<number>(
    SEASON_CONFIGS['lawn_rejuv'].defaultProductCostPercent
  );

  // Update product cost when season type changes
  useEffect(() => {
    setProductCostPercent(SEASON_CONFIGS[selectedSeasonType].defaultProductCostPercent);
  }, [selectedSeasonType]);

  // --- GOOGLE SHEETS STATE ---
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [dateTab, setDateTab] = useState('');
  const [dateTabError, setDateTabError] = useState<string | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsExportResult, setSheetsExportResult] = useState<{
    bookingsUpdated: number;
    accountsAppended: number;
    logsheetsAppended: number;
    statsAppended: number;
  } | null>(null);

  // --- PAYOUT STATE ---
  const [payoutSearch, setPayoutSearch] = useState('');
  const [payoutSort, setPayoutSort] = useState<SortOption>('standard');

  // Computed: Can close session (either exported to sheets or downloaded)
  const canCloseSession = importMeta?.sheetsExported || false;

  // Computed: Is imported from Google Sheets
  const isFromSheets = importMeta?.source === 'sheets';

  // Computed: Has job fairs / onboarding enabled
  const hasOnboarding = currentCC?.jobFairsEnabled || false;

  // Computed: Has digital mapping enabled
  const hasDigitalMapping = currentCC?.digitalMappingEnabled || false;

  // Load session function (memoized to avoid recreation)
  const loadSession = useCallback(async () => {
    if (!currentCC) return;
    
    try {
      const session = await sessionService.getDailySession();
      setCurrentSession(session);
      
      if (session) {
        // Load import metadata from session
        const meta = await sessionService.getSessionImportMeta();
        setImportMeta(meta);
        
        // If we have a dateTab from the stored meta, use it
        if (meta?.dateTab) {
          setDateTab(meta.dateTab);
        }
        
        // If we have a seasonType from the stored meta, use it
        if (meta?.seasonType) {
          setSelectedSeasonType(meta.seasonType);
        } else if (session.seasonType) {
          setSelectedSeasonType(session.seasonType);
        }
        
        // If we have a productCostPercent from the stored meta, use it
        if (meta?.productCostPercent !== undefined) {
          setProductCostPercent(meta.productCostPercent);
        }

        // NEW: Load live card setting from meta
        if (meta?.liveCardProcessingEnabled !== undefined) {
          setLiveCardEnabled(meta.liveCardProcessingEnabled);
        }

        // NEW: Load no-tax-on-cash setting from meta
        if (meta?.noTaxOnCash !== undefined) {
          setNoTaxOnCash(meta.noTaxOnCash);
        }
        
        // Load logsheet sessions for validation check
        const sessions = await sessionService.getLogsheetSessions();
        setLogsheetSessions(sessions);
      }
    } catch (err) {
      console.error('Error loading session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
    }
  }, [currentCC]);

  // Load active session on mount and when CC changes
  useEffect(() => {
    if (currentCC?.id) {
      loadSession();
    }
  }, [currentCC?.id, loadSession]);

  const handleTabChange = (tab: 'lifecycle' | 'payout' | 'onboarding') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Check payout completion status
  const payoutStatus = useMemo(() => {
    if (!logsheetSessions.length) {
      return { hasValidatedPayouts: false, hasBonuses: false, totalWorkers: 0, validatedWorkers: 0 };
    }

    const validatedCount = logsheetSessions.filter(s => s.validation?.isValidated).length;
    const bonusCount = logsheetSessions.filter(s => s.bonuses && s.bonuses.length > 0).length;

    return {
      hasValidatedPayouts: validatedCount > 0,
      hasBonuses: bonusCount > 0,
      totalWorkers: logsheetSessions.length,
      validatedWorkers: validatedCount
    };
  }, [logsheetSessions]);

  // --- FILE UPLOAD HANDLER ---
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedFile(file);
    setPreviewData(null);
    setError(null);
    setLoading(true);

    try {
      const data = await parseDailySessionXLSX(file);
      // Add file import metadata with season type and product cost
      (data as any)._importMeta = { 
        source: 'file', 
        sheetsExported: false,
        seasonType: selectedSeasonType,
        productCostPercent: productCostPercent,
        liveCardProcessingEnabled: liveCardEnabled,
        noTaxOnCash: selectedSeasonType === 'lawn_rejuv' ? noTaxOnCash : undefined,
      } as ImportMeta;
      data.seasonType = selectedSeasonType;
      setPreviewData(data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Failed to parse Excel file.'
      );
    } finally {
      setLoading(false);
    }
  };

  // --- GOOGLE SHEETS HANDLERS ---
  const handleConnectGoogle = async () => {
    setSheetsLoading(true);
    setError(null);
    
    try {
      const connected = await googleSheetsService.authenticate();
      setIsGoogleConnected(connected);
      if (!connected) {
        setError('Failed to connect to Google. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to connect to Google.');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleDateTabChange = (value: string) => {
    setDateTab(value);
    setDateTabError(getDateTabError(value));
  };

  const handleImportFromSheets = async () => {
    const tabError = getDateTabError(dateTab);
    if (tabError) {
      setDateTabError(tabError);
      return;
    }

    setSheetsLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      // Pass the selected season type to the import function
      const data = await googleSheetsService.importSessionData(dateTab, selectedSeasonType);
      
      // Update the import meta with the custom product cost percent
      if ((data as any)._importMeta) {
        (data as any)._importMeta.productCostPercent = productCostPercent;
        (data as any)._importMeta.liveCardProcessingEnabled = liveCardEnabled;
        (data as any)._importMeta.noTaxOnCash = selectedSeasonType === 'lawn_rejuv' ? noTaxOnCash : undefined;
      }
      
      setPreviewData(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to import from Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleExportToSheets = async () => {
    if (!isFromSheets || !importMeta?.dateTab) {
      setError('Google Sheets export is only available for sessions imported from Google Sheets.');
      return;
    }

    // Safety check: Warn if payouts aren't validated or no bonuses assigned
    if (!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) {
      const warnings: string[] = [];
      
      if (!payoutStatus.hasValidatedPayouts) {
        warnings.push(`⚠️ No payouts have been validated yet (${payoutStatus.validatedWorkers}/${payoutStatus.totalWorkers} workers complete)`);
      }
      
      if (!payoutStatus.hasBonuses) {
        warnings.push(`⚠️ No bonuses have been assigned yet`);
      }

      const warningMessage = [
        "Warning: Session data may be incomplete",
        "",
        ...warnings,
        "",
        "Exporting now may result in missing payout data.",
        "",
        "Are you sure you want to export to Google Sheets?"
      ].join("\n");

      if (!window.confirm(warningMessage)) {
        return;
      }
    }

    setSheetsLoading(true);
    setError(null);
    setSheetsExportResult(null);

    try {
      // Use the dateTab from importMeta (same one used during import)
      const result = await exportToGoogleSheets(importMeta.dateTab);
      setSheetsExportResult(result);
      
      // Update import meta to mark as exported
      const updatedMeta = { ...importMeta, sheetsExported: true };
      await sessionService.updateSessionImportMeta(updatedMeta);
      setImportMeta(updatedMeta);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to export to Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  };

  // --- SESSION HANDLERS ---
  const handleStartSession = async () => {
    if (!previewData) return;
    if (window.confirm('This will overwrite/start the session in the cloud. Continue?')) {
      setLoading(true);
      try {
        // Extract import meta from preview data
        const meta = (previewData as any)._importMeta as ImportMeta || { 
          source: 'file', 
          sheetsExported: false,
          seasonType: selectedSeasonType,
          productCostPercent: productCostPercent,
        };
        
        // Ensure productCostPercent is set
        meta.productCostPercent = productCostPercent;

        // NEW: Stamp live card setting into meta
        meta.liveCardProcessingEnabled = liveCardEnabled;

        // NEW: Stamp no-tax-on-cash into meta (Rejuv only)
        meta.noTaxOnCash = selectedSeasonType === 'lawn_rejuv' ? noTaxOnCash : undefined;
        
        // Ensure season type is set
        previewData.seasonType = selectedSeasonType;
        
        await sessionService.uploadDailySession(previewData, emailEnabled, meta);
        await loadSession(); // Reload from DB
        setPreviewData(null);
        setFeedFile(null);
        alert('Session Started Successfully!');
      } catch (err) {
        console.error(err);
        alert('Failed to upload session: ' + (err as any).message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async () => {
    // Safety check: Warn if payouts aren't validated or no bonuses assigned
    if (!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) {
      const warnings: string[] = [];
      
      if (!payoutStatus.hasValidatedPayouts) {
        warnings.push(`⚠️ No payouts have been validated yet (${payoutStatus.validatedWorkers}/${payoutStatus.totalWorkers} workers complete)`);
      }
      
      if (!payoutStatus.hasBonuses) {
        warnings.push(`⚠️ No bonuses have been assigned yet`);
      }

      const warningMessage = [
        "Warning: Session data may be incomplete",
        "",
        ...warnings,
        "",
        "Downloading now may result in missing payout data in the export.",
        "",
        "Are you sure you want to download?"
      ].join("\n");

      if (!window.confirm(warningMessage)) {
        return;
      }
    }

    setLoading(true);
    try {
        await generateSessionExport();
        // Downloading always enables close (regardless of import source)
        const updatedMeta = importMeta 
          ? { ...importMeta, sheetsExported: true }
          : { source: 'file' as const, sheetsExported: true };
        await sessionService.updateSessionImportMeta(updatedMeta);
        setImportMeta(updatedMeta);
    } catch (err) {
        alert("Export failed: " + err);
    } finally {
        setLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!currentSession) return;
    if (window.confirm("DANGER: This will delete today's session from the cloud. Your email templates will be preserved. Are you sure?")) {
      setLoading(true);
      try {
        await sessionService.adminResetDailySession(currentSession.date);
        setCurrentSession(null);
        setImportMeta(null);
        setSheetsExportResult(null);
        setDateTab('');
        setSelectedSeasonType('aeration');
        setProductCostPercent(SEASON_CONFIGS['aeration'].defaultProductCostPercent);
        setLiveCardEnabled(false);
        setNoTaxOnCash(true); // Reset to default ON
      } catch (err) {
        alert('Error: ' + err);
      } finally {
        setLoading(false);
      }
    }
  };

  // --- ADD ADDITIONAL HANDLER ---
  const handleAddAdditional = async () => {
    if (!importMeta?.dateTab) return;

    // Ensure Google is connected
    if (!isGoogleConnected) {
      setError('Please connect to Google first using the button below.');
      return;
    }

    setAddAdditionalLoading(true);
    setError(null);
    setAddAdditionalResult(null);

    try {
      // Re-import the same tab to get the latest data
      const freshData = await googleSheetsService.importSessionData(
        importMeta.dateTab,
        selectedSeasonType
      );

      // Add only the net-new entries
      const result = await sessionService.addAdditionalSessionData(freshData);
      setAddAdditionalResult(result);

      // Reload the live session report to reflect new workers/bookings
      await loadSession();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to add additional data.');
    } finally {
      setAddAdditionalLoading(false);
    }
  };

  // --- SUPER ADMIN: Exit impersonation ---
  const handleExitImpersonation = () => {
    navigate('/super-admin');
  };

  // --- LOGOUT ---
  const handleLogout = () => {
    removeStorageItem('current_user');
    commandCenterService.clearCurrentCommandCenter();
    commandCenterService.setSuperAdminMode(false);
    navigate('/login');
  };

  // --- REPORT GENERATION HELPERS ---
  const generateManagerReport = (data: DailySessionData) => {
      return data.managers.map(m => {
          const workerCount = data.workers.filter(w => w.assignedManagerId === m.userId).length;
          const myRoutes = data.routes.filter(r => r.managerId === m.userId);
          const routeCount = myRoutes.length;
          const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));
          const prebookCount = data.pendingBookings.filter(b => b['Route Number'] && myRouteCodes.has(b['Route Number'])).length;

          return {
              name: m.name,
              workers: workerCount,
              routes: routeCount,
              prebooks: prebookCount
          };
      });
  };

  const activeReportData = useMemo(() => {
      if (previewData) return generateManagerReport(previewData);
      if (currentSession) return generateManagerReport(currentSession);
      return [];
  }, [previewData, currentSession]);

  // Get season config for display
  const seasonConfig = SEASON_CONFIGS[selectedSeasonType];
  const currentSessionSeasonConfig = currentSession?.seasonType 
    ? SEASON_CONFIGS[currentSession.seasonType] 
    : null;

  // Don't render if no CC context
  if (!currentCC) {
    return null;
  }

  // --- OVERLAY VIEWS ---
  if (showDigitalMasterBookings) {
    return <DigitalMasterBookings onBack={() => setShowDigitalMasterBookings(false)} />;
  }

  if (showDigitalWorkerbook) {
    return <DigitalWorkerbook onBack={() => setShowDigitalWorkerbook(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto">
        
        {/* SUPER ADMIN IMPERSONATION BANNER */}
        {isSuperAdminMode && (
          <div className="mb-4 bg-purple-900/30 border border-purple-700 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="text-purple-400" size={20} />
              <span className="text-purple-300 font-medium">
                Viewing as: <span className="text-white font-bold">{currentCC.displayName}</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                currentCC.region === 'West' ? 'bg-blue-900/50 text-blue-300' :
                currentCC.region === 'Central' ? 'bg-green-900/50 text-green-300' :
                'bg-orange-900/50 text-orange-300'
              }`}>
                {currentCC.region}
              </span>
            </div>
            <button
              onClick={handleExitImpersonation}
              className="flex items-center gap-2 text-purple-300 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft size={16} />
              Back to Admin
            </button>
          </div>
        )}

        {/* HEADER WITH TABS AND EMAIL TEMPLATES BUTTON */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <Users className="text-cps-blue" size={20} />
            <div className="flex flex-col">
              <span className="text-sm text-gray-400">
                {currentSession ? `Active: ${currentSession.date}` : "No Active Session"}
              </span>
              {!isSuperAdminMode && (
                <span className="text-xs text-gray-500">{currentCC.displayName}</span>
              )}
            </div>
            {/* Season Type Badge for Active Session */}
            {currentSessionSeasonConfig && (
              <span className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${
                currentSession?.seasonType === 'lawn_rejuv'
                  ? 'bg-green-900/30 text-green-400 border-green-700/50'
                  : 'bg-blue-900/30 text-blue-400 border-blue-700/50'
              }`}>
                {currentSession?.seasonType === 'lawn_rejuv' ? <Leaf size={12} /> : <Wind size={12} />}
                {currentSessionSeasonConfig.displayName}
              </span>
            )}
            {/* Product Cost Badge for Active Session (Lawn Rejuv only) */}
            {currentSession?.seasonType === 'lawn_rejuv' && importMeta?.productCostPercent !== undefined && (
              <span className="text-xs px-2 py-0.5 rounded border bg-orange-900/30 text-orange-400 border-orange-700/50 flex items-center gap-1">
                <Package size={12} />
                {importMeta.productCostPercent}% Product Cost
              </span>
            )}
            {/* NEW: Live Cards badge for active session */}
            {importMeta?.liveCardProcessingEnabled && (
              <span className="text-xs px-2 py-0.5 rounded border bg-purple-900/30 text-purple-400 border-purple-700/50 flex items-center gap-1">
                <CreditCard size={12} />
                Live Cards
              </span>
            )}
            {/* NEW: No Tax on Cash badge for active session */}
            {importMeta?.noTaxOnCash && (
              <span className="text-xs px-2 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-700/50 flex items-center gap-1">
                <Banknote size={12} />
                No Tax Cash
              </span>
            )}
            {importMeta?.source === 'sheets' && importMeta.dateTab && (
              <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded border border-green-700/50">
                {importMeta.dateTab}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* EMAIL TEMPLATES BUTTON - Always visible */}
            <button
              onClick={() => navigate('/admin/email-templates')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition-colors text-sm"
            >
              <Mail size={16} />
              Email Templates
            </button>
            
            <div className="bg-gray-800 rounded-lg p-1 flex border border-gray-700">
              <button
                onClick={() => handleTabChange('lifecycle')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'lifecycle' ? 'bg-cps-blue text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Session Cycle
              </button>
              <button
                onClick={() => handleTabChange('payout')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'payout' ? 'bg-green-600 text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Payout Today
              </button>
              {/* ONBOARDING TAB (shown when jobFairsEnabled) */}
              {hasOnboarding && (
                <button
                  onClick={() => handleTabChange('onboarding')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
                    activeTab === 'onboarding' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <UserPlus size={14} />
                  Onboarding
                </button>
              )}
            </div>

            {!isSuperAdminMode && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
              >
                <LogOut size={16} />
                Logout
              </button>
            )}
          </div>
        </div>

        {/* --- VIEW 1: SESSION CYCLE (Start -> Monitor -> End) --- */}
        {activeTab === 'lifecycle' && (
          <div className="space-y-8 animate-fade-in">

            {showPayslipGenerator ? (
              <PayslipGenerator onBack={() => setShowPayslipGenerator(false)} />
            ) : showRouteFinder ? (
              <RouteFinderView onBack={() => setShowRouteFinder(false)} />
            ) : (
              <>
                {/* Utility buttons row */}
                <div className="flex justify-end gap-2 flex-wrap">
                  {/* Digital Master Bookings — only if enabled for this CC */}
                  {hasDigitalMapping && (
                    <button
                      onClick={() => setShowDigitalMasterBookings(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 transition-colors text-sm font-medium"
                    >
                      <MapIcon size={16} className="text-blue-400" />
                      Digital Master Bookings
                    </button>
                  )}
                  {/* Digital Workerbook */}
                  <button
                    onClick={() => setShowDigitalWorkerbook(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 transition-colors text-sm font-medium"
                  >
                    <BookOpen size={16} className="text-purple-400" />
                    Digital Workerbook
                  </button>
                  <button
                    onClick={() => setShowRouteFinder(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 transition-colors text-sm font-medium"
                  >
                    <MapPin size={16} className="text-blue-400" />
                    Route Finder
                  </button>
                  <button
                    onClick={() => setShowPayslipGenerator(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 transition-colors text-sm font-medium"
                  >
                    <FileSpreadsheet size={16} className="text-green-400" />
                    Generate Payslips
                  </button>
                </div>

            {/* 1. UPLOAD SECTION (Only if no session) */}
            {!currentSession && (
                <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 shadow-lg">
                    <div className="max-w-lg mx-auto">
                        <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700">
                            <Sheet className="text-green-400" size={32} />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2 text-center">Initialize New Session</h2>
                        <p className="text-gray-400 text-sm mb-6 text-center">Import from Google Sheets to generate assignments.</p>
                        
                        {/* SEASON TYPE SELECTOR (West Region Only) */}
                        {canSelectSeason && (
                          <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                              Season Type
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={() => setSelectedSeasonType('aeration')}
                                className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                                  selectedSeasonType === 'aeration'
                                    ? 'border-blue-500 bg-blue-900/20 text-blue-300'
                                    : 'border-gray-600 bg-gray-900 text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                <Wind size={24} className={selectedSeasonType === 'aeration' ? 'text-blue-400' : 'text-gray-500'} />
                                <span className="font-bold">Aeration</span>
                                <span className="text-[10px] text-gray-500">
                                  $8/EQ • SP/RJ Flats • 50% Prepaid
                                </span>
                              </button>
                              <button
                                onClick={() => setSelectedSeasonType('lawn_rejuv')}
                                className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                                  selectedSeasonType === 'lawn_rejuv'
                                    ? 'border-green-500 bg-green-900/20 text-green-300'
                                    : 'border-gray-600 bg-gray-900 text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                <Leaf size={24} className={selectedSeasonType === 'lawn_rejuv' ? 'text-green-400' : 'text-gray-500'} />
                                <span className="font-bold">Lawn Rejuv</span>
                                <span className="text-[10px] text-gray-500">
                                  Teams • $6-8/EQ • FSL Flat • 70% Prepaid
                                </span>
                              </button>
                            </div>
                            
                            {/* PRODUCT COST INPUT (Lawn Rejuv Only) */}
                            {selectedSeasonType === 'lawn_rejuv' && (
                              <div className="mt-4 p-4 rounded-lg border border-orange-700/50 bg-orange-900/10">
                                <label className="flex items-center gap-2 text-sm font-medium text-orange-300 mb-2">
                                  <Package size={16} />
                                  Product Cost Deduction
                                </label>
                                <div className="flex items-center gap-3">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={productCostPercent}
                                    onChange={(e) => setProductCostPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                    className="w-24 bg-gray-900 border border-orange-700/50 rounded-lg py-2 px-3 text-white text-center focus:ring-2 focus:ring-orange-500 focus:outline-none"
                                  />
                                  <span className="text-orange-300 font-bold">%</span>
                                  <span className="text-xs text-gray-400 flex-1">
                                    Deducted from production payable after tax removal
                                  </span>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-2">
                                  Formula: prodPayable = (weightedProd / tax) × (1 - {productCostPercent}%)
                                </p>
                              </div>
                            )}
                            
                            {/* Season Info Banner */}
                            <div className={`mt-3 p-3 rounded-lg border text-xs ${
                              selectedSeasonType === 'lawn_rejuv'
                                ? 'bg-green-900/10 border-green-700/50 text-green-300'
                                : 'bg-blue-900/10 border-blue-700/50 text-blue-300'
                            }`}>
                              <div className="font-bold mb-1">{seasonConfig.displayName}</div>
                              <div className="text-gray-400 space-y-0.5">
                                <div>• EQ Calculation: prodPayable / {EQ_DIVISOR} (always)</div>
                                <div>• Payout Rate: ${seasonConfig.payoutRateSolo}/EQ solo{selectedSeasonType === 'lawn_rejuv' ? `, $${seasonConfig.payoutRateTeam}/EQ team (2+)` : ''}</div>
                                <div>• Prepaid Weight: {seasonConfig.prepaidWeight * 100}%</div>
                                <div>• Office Flats: {seasonConfig.officeFlats.map(f => `${f.code} ($${f.value})`).join(', ')}</div>
                                {selectedSeasonType === 'lawn_rejuv' && (
                                  <>
                                    <div>• Product Cost: {productCostPercent}% deduction</div>
                                    <div>• Services: A/D/F/S/L (Aeration, Dethatch, Fertilizer, Seed, Lime)</div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* GOOGLE SHEETS IMPORT (Default) */}
                        {!showFileUpload && (
                          <div className="space-y-4">
                            {/* Connection Status */}
                            {!isGoogleConnected ? (
                              <button
                                onClick={handleConnectGoogle}
                                disabled={sheetsLoading}
                                className="w-full bg-white hover:bg-gray-100 text-gray-800 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
                              >
                                {sheetsLoading ? (
                                  <Loader className="animate-spin" size={20} />
                                ) : (
                                  <>
                                    <svg width="20" height="20" viewBox="0 0 24 24">
                                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                    </svg>
                                    Connect to Google
                                  </>
                                )}
                              </button>
                            ) : (
                              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 flex items-center gap-2 text-green-400">
                                <CheckCircle size={18} />
                                <span className="text-sm font-medium">Connected to Google</span>
                              </div>
                            )}

                            {/* Date Tab Input */}
                            {isGoogleConnected && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Worker Tab Name (e.g., Feb01, Mar15)
                                  </label>
                                  <input
                                    type="text"
                                    value={dateTab}
                                    onChange={(e) => handleDateTabChange(e.target.value)}
                                    placeholder="Feb01"
                                    className={`w-full bg-gray-900 border rounded-lg py-3 px-4 text-white focus:ring-2 focus:outline-none ${
                                      dateTabError ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-green-500'
                                    }`}
                                  />
                                  {dateTabError && (
                                    <p className="text-red-400 text-xs mt-1">{dateTabError}</p>
                                  )}
                                </div>

                                <button
                                  onClick={handleImportFromSheets}
                                  disabled={sheetsLoading || !dateTab || !!dateTabError}
                                  className="w-full bg-green-600 hover:bg-green-500 text-white py-3 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {sheetsLoading ? (
                                    <Loader className="animate-spin" size={20} />
                                  ) : (
                                    <>
                                      <CloudUpload size={20} /> Import from Google Sheets
                                    </>
                                  )}
                                </button>
                              </>
                            )}

                            {/* Toggle to File Upload */}
                            <button
                              onClick={() => setShowFileUpload(true)}
                              className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 flex items-center justify-center gap-2 transition-colors"
                            >
                              <Upload size={14} /> Or upload Excel file manually
                            </button>
                          </div>
                        )}

                        {/* FILE UPLOAD (Secondary) */}
                        {showFileUpload && (
                          <div className="space-y-4">
                            <div className="relative">
                                <input
                                    type="file"
                                    accept=".xlsx, .xls"
                                    onChange={handleFileChange}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                                <div className="bg-gray-900 border-2 border-dashed border-gray-600 hover:border-cps-blue rounded-lg p-4 transition-colors text-center">
                                    <span className="text-sm font-bold text-gray-300">
                                        {feedFile ? feedFile.name : "Click to Select File"}
                                    </span>
                                </div>
                            </div>

                            {/* Toggle back to Google Sheets */}
                            <button
                              onClick={() => { setShowFileUpload(false); setFeedFile(null); setPreviewData(null); setError(null); }}
                              className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 flex items-center justify-center gap-2 transition-colors"
                            >
                              <Sheet size={14} /> Back to Google Sheets import
                            </button>
                          </div>
                        )}

                        {error && <div className="mt-4 text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{error}</div>}
                        {loading && <div className="mt-4 text-blue-400 animate-pulse text-center">Processing Feed...</div>}
                    </div>
                </div>
            )}

            {/* 2. REPORT SECTION (Preview OR Live) */}
            {(previewData || currentSession) && (
                <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden">
                    <div className="p-4 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <FileText size={20} className="text-green-400"/> 
                            {previewData ? "Session Preview Report" : "Live Session Report"}
                        </h3>
                        <div className="flex items-center gap-2">
                          {previewData && <span className="text-xs bg-yellow-900/30 text-yellow-300 px-2 py-1 rounded border border-yellow-700/50">PREVIEW MODE</span>}
                          {currentSession && !previewData && (
                            <>
                              <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded border border-green-700/50">LIVE</span>
                              {/* ADD ADDITIONAL BUTTON — only for Sheets-based sessions */}
                              {isFromSheets && (
                                <button
                                  onClick={() => {
                                    setShowAddAdditional(v => !v);
                                    setAddAdditionalResult(null);
                                    setError(null);
                                  }}
                                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                    showAddAdditional
                                      ? 'bg-blue-900/40 text-blue-300 border-blue-600'
                                      : 'bg-gray-800 text-gray-300 hover:text-white border-gray-600 hover:border-blue-500'
                                  }`}
                                >
                                  <PlusCircle size={13} />
                                  Add Additional
                                </button>
                              )}
                            </>
                          )}
                        </div>
                    </div>
                    
                    <div className="p-6">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-gray-400 text-sm border-b border-gray-700">
                                        <th className="py-3 font-medium">Route Manager</th>
                                        <th className="py-3 font-medium text-center">Workers</th>
                                        <th className="py-3 font-medium text-center">Routes</th>
                                        <th className="py-3 font-medium text-center">Pre-books</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-200">
                                    {activeReportData.map((manager, idx) => (
                                        <tr key={idx} className="border-b border-gray-800 hover:bg-gray-700/30 transition-colors">
                                            <td className="py-3 font-bold">{manager.name}</td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-blue-300 font-mono">{manager.workers}</span>
                                            </td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-purple-300 font-mono">{manager.routes}</span>
                                            </td>
                                            <td className="py-3 text-center">
                                                <span className="bg-gray-700 px-2 py-1 rounded text-xs text-yellow-300 font-mono">{manager.prebooks}</span>
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="bg-gray-900/30 font-bold">
                                        <td className="py-3 text-right pr-4 text-gray-400">TOTALS:</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.workers, 0)}</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.routes, 0)}</td>
                                        <td className="py-3 text-center text-white">{activeReportData.reduce((sum, m) => sum + m.prebooks, 0)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* ADD ADDITIONAL PANEL */}
                        {currentSession && !previewData && showAddAdditional && (
                          <div className="mt-6 p-5 bg-gray-900/60 rounded-xl border border-blue-800/50">
                            <div className="flex items-start gap-3 mb-4">
                              <PlusCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <h4 className="text-white font-bold text-sm">Add Additional Workers & Bookings</h4>
                                <p className="text-gray-400 text-xs mt-0.5">
                                  Re-reads <span className="text-blue-300 font-mono">{importMeta?.dateTab}</span> from Google Sheets and appends anything not already in the live session. Existing workers, routes, and bookings are untouched.
                                </p>
                              </div>
                            </div>

                            {/* Google connect (if not already connected) */}
                            {!isGoogleConnected && (
                              <button
                                onClick={handleConnectGoogle}
                                disabled={sheetsLoading}
                                className="w-full mb-3 bg-white hover:bg-gray-100 text-gray-800 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50 text-sm"
                              >
                                {sheetsLoading ? (
                                  <Loader className="animate-spin" size={16} />
                                ) : (
                                  <>
                                    <svg width="16" height="16" viewBox="0 0 24 24">
                                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                    </svg>
                                    Connect to Google first
                                  </>
                                )}
                              </button>
                            )}

                            {isGoogleConnected && (
                              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-2.5 flex items-center gap-2 text-green-400 mb-3 text-xs">
                                <CheckCircle size={14} />
                                <span className="font-medium">Connected to Google</span>
                              </div>
                            )}

                            {/* Result summary */}
                            {addAdditionalResult && (
                              <div className={`mb-3 p-3 rounded-lg border text-xs ${
                                addAdditionalResult.workersAdded === 0 && addAdditionalResult.bookingsAdded === 0
                                  ? 'bg-gray-800 border-gray-600 text-gray-400'
                                  : 'bg-green-900/20 border-green-700/50 text-green-300'
                              }`}>
                                {addAdditionalResult.workersAdded === 0 &&
                                 addAdditionalResult.routesAdded === 0 &&
                                 addAdditionalResult.bookingsAdded === 0 ? (
                                  <div className="flex items-center gap-2">
                                    <CheckCircle size={13} className="text-gray-500" />
                                    <span>Nothing new found — session is already up to date.</span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2 font-bold mb-1.5">
                                      <CheckCircle size={13} />
                                      <span>Added successfully</span>
                                    </div>
                                    {addAdditionalResult.managersAdded > 0 && (
                                      <div>• {addAdditionalResult.managersAdded} new manager{addAdditionalResult.managersAdded !== 1 ? 's' : ''}</div>
                                    )}
                                    {addAdditionalResult.workersAdded > 0 && (
                                      <div>• {addAdditionalResult.workersAdded} new worker{addAdditionalResult.workersAdded !== 1 ? 's' : ''}</div>
                                    )}
                                    {addAdditionalResult.routesAdded > 0 && (
                                      <div>• {addAdditionalResult.routesAdded} new route{addAdditionalResult.routesAdded !== 1 ? 's' : ''}</div>
                                    )}
                                    {addAdditionalResult.bookingsAdded > 0 && (
                                      <div>• {addAdditionalResult.bookingsAdded} new booking{addAdditionalResult.bookingsAdded !== 1 ? 's' : ''}</div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}

                            {error && (
                              <div className="mb-3 text-red-400 text-xs bg-red-900/20 p-3 rounded border border-red-900/50">
                                {error}
                              </div>
                            )}

                            <button
                              onClick={handleAddAdditional}
                              disabled={addAdditionalLoading || !isGoogleConnected}
                              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors text-sm"
                            >
                              {addAdditionalLoading ? (
                                <>
                                  <Loader className="animate-spin" size={16} />
                                  Checking for new entries…
                                </>
                              ) : (
                                <>
                                  <PlusCircle size={16} />
                                  Load Additional from {importMeta?.dateTab}
                                </>
                              )}
                            </button>
                          </div>
                        )}

                        {/* EMAIL TOGGLE + LIVE CARD TOGGLE + NO TAX ON CASH TOGGLE + START SESSION */}
                        {previewData && !currentSession && (
                            <div className="mt-8 space-y-4">
                                {/* Email receipts toggle */}
                                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                                  <label className="flex items-start gap-3 cursor-pointer group">
                                    <input 
                                      type="checkbox" 
                                      checked={emailEnabled}
                                      onChange={(e) => setEmailEnabled(e.target.checked)}
                                      className="w-5 h-5 mt-0.5 accent-blue-500 cursor-pointer flex-shrink-0"
                                    />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 text-white font-medium mb-1">
                                        <Mail size={16} className={emailEnabled ? 'text-green-400' : 'text-gray-500'} />
                                        <span>Send Receipt Emails</span>
                                      </div>
                                      <p className="text-xs text-gray-400 leading-relaxed">
                                        Automatically email receipts to customers when jobs are completed during this session.
                                        {!emailEnabled && ' (Currently disabled - no emails will be sent)'}
                                      </p>
                                    </div>
                                  </label>
                                </div>

                                {/* NEW: Live Card Processing toggle */}
                                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                                  <label className="flex items-start gap-3 cursor-pointer group">
                                    <input 
                                      type="checkbox" 
                                      checked={liveCardEnabled}
                                      onChange={(e) => setLiveCardEnabled(e.target.checked)}
                                      className="w-5 h-5 mt-0.5 accent-purple-500 cursor-pointer flex-shrink-0"
                                    />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 text-white font-medium mb-1">
                                        <CreditCard size={16} className={liveCardEnabled ? 'text-purple-400' : 'text-gray-500'} />
                                        <span>Live Card Processing</span>
                                        {liveCardEnabled && (
                                          <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700">
                                            BAMBORA LIVE
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-400 leading-relaxed">
                                        Workers will use a live Bambora terminal to charge cards in real-time. Card details are never stored — only the masked last 4 digits go to Google Sheets.
                                        {!liveCardEnabled && ' (Currently disabled - card details captured manually)'}
                                      </p>
                                    </div>
                                  </label>
                                </div>

                                {/* NEW: No Tax on Cash toggle (Rejuv only) */}
                                {selectedSeasonType === 'lawn_rejuv' && (
                                  <div className="bg-gray-900/50 rounded-lg p-4 border border-green-700/30">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                      <input 
                                        type="checkbox" 
                                        checked={noTaxOnCash}
                                        onChange={(e) => setNoTaxOnCash(e.target.checked)}
                                        className="w-5 h-5 mt-0.5 accent-green-500 cursor-pointer flex-shrink-0"
                                      />
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 text-white font-medium mb-1">
                                          <Banknote size={16} className={noTaxOnCash ? 'text-green-400' : 'text-gray-500'} />
                                          <span>No Tax on Cash</span>
                                          {noTaxOnCash && (
                                            <span className="text-[10px] bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded border border-green-700">
                                              REJUV
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-gray-400 leading-relaxed">
                                          Cash payments (prodCash and upsellCash) bypass the tax divisor when calculating production payable and upsell payable. All other payment methods still have tax removed.
                                          {!noTaxOnCash && ' (Currently disabled - all payment methods taxed equally)'}
                                        </p>
                                      </div>
                                    </label>
                                  </div>
                                )}

                                <div className="flex justify-end">
                                    <button 
                                        onClick={handleStartSession}
                                        disabled={loading}
                                        className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2 transform transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Play size={20} fill="currentColor" /> Initialize Session
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 3. EXPORT & CLOSE (Only Active Session) */}
            {currentSession && (
                <div className="space-y-6 pt-4 border-t border-gray-800">
                    {/* Primary Export: Google Sheets (only if imported from sheets) */}
                    {isFromSheets && (
                      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                              <div className="flex-1">
                                  <h4 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                                    <Sheet size={20} className="text-green-400" />
                                    Export to Google Sheets
                                    <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded ml-2">
                                      → {importMeta?.dateTab}
                                    </span>
                                  </h4>
                                  <p className="text-sm text-gray-400">Push data directly to Masterbookings and Workerbook sheets.</p>
                                  
                                  {sheetsExportResult && (
                                    <div className="bg-green-900/20 border border-green-700/50 rounded p-3 mt-3 text-xs space-y-1">
                                      <div className="flex items-center gap-2 text-green-400 font-bold mb-1">
                                        <CheckCircle size={14} />
                                        <span>Export Complete</span>
                                      </div>
                                      <div className="text-green-300">• {sheetsExportResult.bookingsUpdated} bookings updated</div>
                                      <div className="text-green-300">• {sheetsExportResult.accountsAppended} accounts added</div>
                                      <div className="text-green-300">• {sheetsExportResult.logsheetsAppended} logsheets added</div>
                                      <div className="text-green-300">• {sheetsExportResult.statsAppended} payout stats added</div>
                                    </div>
                                  )}

                                  {(!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) && !sheetsExportResult && (
                                    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3 mt-3 text-xs space-y-1">
                                      <div className="flex items-center gap-2 text-yellow-400 font-bold mb-1">
                                        <AlertCircle size={14} />
                                        <span>Incomplete Payout Data</span>
                                      </div>
                                      {!payoutStatus.hasValidatedPayouts && (
                                        <div className="text-yellow-300">
                                          • No validated payouts ({payoutStatus.validatedWorkers}/{payoutStatus.totalWorkers} workers complete)
                                        </div>
                                      )}
                                      {!payoutStatus.hasBonuses && (
                                        <div className="text-yellow-300">
                                          • No bonuses have been assigned yet
                                        </div>
                                      )}
                                    </div>
                                  )}
                              </div>
                              <button 
                                  onClick={handleExportToSheets}
                                  disabled={sheetsLoading}
                                  className={`py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                                      importMeta?.sheetsExported 
                                      ? 'bg-green-900/30 text-green-400 border border-green-700' 
                                      : 'bg-green-600 hover:bg-green-500 text-white'
                                  }`}
                              >
                                  {sheetsLoading ? <Loader className="animate-spin" size={20} /> : <CloudUpload size={20} />}
                                  {importMeta?.sheetsExported ? 'Export Again' : 'Export to Sheets'}
                              </button>
                          </div>
                      </div>
                    )}

                    {/* File-based session or secondary download option */}
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="flex-1">
                                <h4 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                                  <Download size={20} className="text-cps-blue" />
                                  {isFromSheets ? 'Download Excel Backup' : 'Download Session Data'}
                                </h4>
                                <p className="text-sm text-gray-400">
                                  {isFromSheets 
                                    ? 'Download a local Excel file as backup.' 
                                    : 'Export all payouts, transactions, and logsheets as an Excel file.'}
                                </p>
                                
                                {!isFromSheets && (!payoutStatus.hasValidatedPayouts || !payoutStatus.hasBonuses) && (
                                  <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3 mt-3 text-xs space-y-1">
                                    <div className="flex items-center gap-2 text-yellow-400 font-bold mb-1">
                                      <AlertCircle size={14} />
                                      <span>Incomplete Payout Data</span>
                                    </div>
                                    {!payoutStatus.hasValidatedPayouts && (
                                      <div className="text-yellow-300">
                                        • No validated payouts ({payoutStatus.validatedWorkers}/{payoutStatus.totalWorkers} workers complete)
                                      </div>
                                    )}
                                    {!payoutStatus.hasBonuses && (
                                      <div className="text-yellow-300">
                                        • No bonuses have been assigned yet
                                      </div>
                                    )}
                                  </div>
                                )}
                            </div>
                            <button 
                                onClick={handleDownload}
                                disabled={loading}
                                className={`py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                                  isFromSheets 
                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                                    : 'bg-cps-blue hover:bg-blue-600 text-white'
                                }`}
                            >
                                {loading ? <Loader className="animate-spin" size={20} /> : <Download size={20} />}
                                Download Excel
                            </button>
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && !showAddAdditional && (
                      <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-red-400 text-sm">
                        {error}
                      </div>
                    )}

                    {/* Close Session */}
                    <div className={`bg-gray-800 p-6 rounded-xl border border-gray-700 transition-opacity ${!canCloseSession ? 'opacity-50' : 'opacity-100'}`}>
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h4 className="text-lg font-bold text-white mb-1">Close Session</h4>
                                <p className="text-sm text-gray-400">
                                    {canCloseSession 
                                        ? "Session data is secured. Email templates will be preserved." 
                                        : isFromSheets 
                                          ? "Export to Google Sheets before closing to prevent data loss."
                                          : "Download session data before closing to prevent data loss."}
                                </p>
                            </div>
                            <button 
                                onClick={handleCloseSession}
                                disabled={!canCloseSession}
                                className={`py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                                    canCloseSession 
                                    ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer' 
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                            >
                                {canCloseSession ? <Unlock size={20} /> : <Lock size={20} />} 
                                Close & Wipe Session
                            </button>
                        </div>
                    </div>
                </div>
            )}

              </>
            )}

          </div>
        )}

        {/* --- VIEW 2: PAYOUT TODAY --- */}
        {activeTab === 'payout' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row gap-3 bg-gray-800 p-3 rounded-lg border border-gray-700">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type="text"
                  placeholder="Search workers..."
                  value={payoutSearch}
                  onChange={(e) => setPayoutSearch(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-9 pr-4 text-sm text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 min-w-[180px]">
                <Filter className="text-gray-500" size={16} />
                <select
                  value={payoutSort}
                  onChange={(e) => setPayoutSort(e.target.value as SortOption)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-sm text-white focus:ring-2 focus:ring-cps-blue focus:outline-none"
                >
                  <option value="standard">Standard (by RM)</option>
                  <option value="alpha">Alphabetical</option>
                  <option value="steps">Sort by Steps</option>
                  <option value="upGross">Sort by Up Gross</option>
                  <option value="upsell">Sort by Upsells</option>
                  <option value="equiv">Sort by EQ</option>
                  <option value="bonusEquiv">Bonus EQ</option>
                  <option value="commission">Sort by Payout</option>
                </select>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 min-h-[500px] flex flex-col overflow-hidden">
              {currentSession ? (
                <PayoutToday
                  consoleProfileId={1}
                  date={currentSession.date}
                  sortOption={payoutSort}
                  searchTerm={payoutSearch}
                  managers={currentSession.managers}
                  workers={currentSession.workers}
                />
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-500 p-10">
                  <AlertCircle size={48} className="mb-2 opacity-20" />
                  <p>No active session found.</p>
                  <p className="text-sm">
                    Import from Google Sheets to start payout calculations.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- VIEW 3: ONBOARDING (Job Fairs + Trainings sub-tabs) --- */}
        {activeTab === 'onboarding' && hasOnboarding && (
          <div className="animate-fade-in">
            {/* Sub-tab switcher */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setOnboardingSubTab('jobfairs')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  onboardingSubTab === 'jobfairs'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <UserPlus size={16} />
                Job Fairs
              </button>
              <button
                onClick={() => setOnboardingSubTab('trainings')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  onboardingSubTab === 'trainings'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <GraduationCap size={16} />
                Trainings
              </button>
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 min-h-[500px] flex flex-col overflow-hidden">
              {onboardingSubTab === 'jobfairs' && (
                <JobFairManager commandCenter={currentCC} />
              )}
              {onboardingSubTab === 'trainings' && (
                <TrainingsTab commandCenter={currentCC} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionCommandCenter;