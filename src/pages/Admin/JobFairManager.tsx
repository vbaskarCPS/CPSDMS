// src/pages/Admin/JobFairManager.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Play,
  Search,
  Download,
  Lock,
  Unlock,
  Loader,
  CheckCircle,
  AlertCircle,
  Star,
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  ExternalLink,
  RefreshCw,
  UserCheck,
  Briefcase,
  Shield,
  User,
  Hash,
} from 'lucide-react';
import { CommandCenter } from '../../lib/commandCenterService';
import { jobFairService } from '../../lib/jobFairService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { realtimeService } from '../../lib/realtimeService';
import { JobFairSession, JobFairApplicant, ApplicantIdType } from '../../types';

interface JobFairManagerProps {
  commandCenter: CommandCenter;
}

const ID_TYPE_LABELS: Record<ApplicantIdType, string> = {
  SIN: 'SIN',
  DL: "Driver's License",
  HEALTH_CARD: 'Health Card',
  PASSPORT: 'Passport',
};

const ID_TYPE_OPTIONS: ApplicantIdType[] = ['SIN', 'DL', 'HEALTH_CARD', 'PASSPORT'];

// Type for all updatable applicant fields
type ApplicantUpdateFields = Partial<{
  firstName: string;
  lastName: string;
  cellPhone: string;
  alternatePhone: string | null;
  email: string | null;
  address: string;
  city: string | null;
  postalCode: string | null;
  age: number;
  idType: ApplicantIdType;
  idValue: string;
  rating: number | null;
  isBc: boolean;
  isManagement: boolean;
  isInterviewed: boolean;
}>;

const JobFairManager: React.FC<JobFairManagerProps> = ({ commandCenter }) => {
  // Session state
  const [session, setSession] = useState<JobFairSession | null>(null);
  const [applicants, setApplicants] = useState<JobFairApplicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedApplicant, setSelectedApplicant] = useState<JobFairApplicant | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  // Load session and applicants
  const loadData = useCallback(async () => {
    try {
      const activeSession = await jobFairService.getActiveSession();
      setSession(activeSession);

      if (activeSession) {
        const apps = await jobFairService.getApplicantsBySession(activeSession.id);
        setApplicants(apps);
      } else {
        setApplicants([]);
      }
    } catch (err) {
      console.error('Error loading job fair data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!session) return;

    const unsubscribe = realtimeService.subscribeToJobFairApplicants(
      session.id,
      () => {
        // Reload applicants on any change
        jobFairService.getApplicantsBySession(session.id).then(setApplicants);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [session]);

  // Filtered and sorted applicants - non-interviewed first
  const filteredApplicants = useMemo(() => {
    let result = applicants;
    
    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(a => 
        a.firstName.toLowerCase().includes(term) ||
        a.lastName.toLowerCase().includes(term) ||
        a.cellPhone.includes(term) ||
        a.email?.toLowerCase().includes(term)
      );
    }
    
    // Sort: non-interviewed first, then by last name
    return result.sort((a, b) => {
      // Non-interviewed (false) comes before interviewed (true)
      if (a.isInterviewed !== b.isInterviewed) {
        return a.isInterviewed ? 1 : -1;
      }
      // Then sort by last name
      return a.lastName.localeCompare(b.lastName);
    });
  }, [applicants, searchTerm]);

  // Stats
  const stats = useMemo(() => {
    const interviewed = applicants.filter(a => a.isInterviewed).length;
    const withRating = applicants.filter(a => a.rating).length;
    const bcCount = applicants.filter(a => a.isBc).length;
    const mgmtCount = applicants.filter(a => a.isManagement).length;
    
    return { interviewed, withRating, bcCount, mgmtCount, total: applicants.length };
  }, [applicants]);

  // Initialize session
  const handleInitialize = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const newSession = await jobFairService.initializeSession();
      setSession(newSession);
      setApplicants([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize session');
    } finally {
      setLoading(false);
    }
  };

  // Export to Google Sheets
  const handleExport = async () => {
    if (!session) return;

    setExporting(true);
    setError(null);

    try {
      // First authenticate with Google Sheets if needed
      const isAuthenticated = googleSheetsService.isAuthenticated();
      if (!isAuthenticated) {
        const success = await googleSheetsService.authenticate();
        if (!success) {
          throw new Error('Failed to authenticate with Google Sheets');
        }
      }

      // Get applicants formatted for export
      const exportData = await jobFairService.getApplicantsForExport(session.id);
      
      // Append to Applicants tab
      await googleSheetsService.appendApplicants(exportData);
      
      setExportComplete(true);
    } catch (err) {
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setExporting(false);
    }
  };

  // Close session
  const handleClose = async () => {
    if (!session) return;

    if (!exportComplete) {
      if (!window.confirm('Session has not been exported yet. Are you sure you want to close without exporting?')) {
        return;
      }
    }

    if (!window.confirm('Are you sure you want to close this job fair session? This will delete all applicant data.')) {
      return;
    }

    setLoading(true);
    try {
      await jobFairService.closeSession(session.id);
      setSession(null);
      setApplicants([]);
      setExportComplete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close session');
    } finally {
      setLoading(false);
    }
  };

  // Update applicant
  const handleUpdateApplicant = async (
    applicantId: string,
    updates: ApplicantUpdateFields,
    closeModal: boolean = false
  ) => {
    try {
      const updated = await jobFairService.updateApplicant(applicantId, updates);
      
      // Update local state
      setApplicants(prev => prev.map(a => a.id === applicantId ? updated : a));
      
      // Update selected if it's the same (and not closing)
      if (selectedApplicant?.id === applicantId && !closeModal) {
        setSelectedApplicant(updated);
      }
      
      // Close modal if requested
      if (closeModal) {
        setSelectedApplicant(null);
      }
    } catch (err) {
      console.error('Error updating applicant:', err);
    }
  };

  // Get public URL for the form
  const publicUrl = commandCenter.jobFairsSlug 
    ? `${window.location.origin}/${commandCenter.jobFairsSlug}`
    : null;

  // Loading state
  if (loading && !session) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="animate-spin text-blue-400" size={32} />
      </div>
    );
  }

  // No session - show initialize
  if (!session) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center">
          <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-700">
            <Users className="text-purple-400" size={40} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Active Job Fair</h2>
          <p className="text-gray-400 mb-6">
            Initialize a job fair session to start accepting applications.
          </p>
          
          {publicUrl && (
            <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left">
              <p className="text-sm text-gray-400 mb-2">Public application URL:</p>
              <code className="text-blue-400 text-sm break-all">{publicUrl}</code>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300 text-sm">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleInitialize}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-lg font-bold flex items-center justify-center gap-2 mx-auto transition-colors disabled:opacity-50"
          >
            {loading ? <Loader className="animate-spin" size={20} /> : <Play size={20} />}
            Initialize Job Fair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 bg-gray-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white">Job Fair Session</h2>
              <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded border border-green-700/50">
                LIVE
              </span>
            </div>
            <p className="text-sm text-gray-400">
              {session.sessionDate} • {stats.total} applicants
            </p>
          </div>

          <div className="flex items-center gap-2">
            {publicUrl && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
              >
                <ExternalLink size={14} />
                View Form
              </a>
            )}
            <button
              onClick={loadData}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex gap-4 mt-4 text-sm">
          <div className="flex items-center gap-1 text-gray-400">
            <UserCheck size={14} className="text-green-400" />
            <span>{stats.interviewed} interviewed</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <Star size={14} className="text-yellow-400" />
            <span>{stats.withRating} rated</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <Briefcase size={14} className="text-blue-400" />
            <span>{stats.bcCount} BC</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <Shield size={14} className="text-purple-400" />
            <span>{stats.mgmtCount} Mgmt</span>
          </div>
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search applicants..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-10 pr-4 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300 text-sm">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Applicant Grid */}
      <div className="flex-1 overflow-auto p-4">
        {filteredApplicants.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Users className="mx-auto mb-3 opacity-30" size={48} />
            <p>{searchTerm ? 'No applicants match your search' : 'No applicants yet'}</p>
            {!searchTerm && publicUrl && (
              <p className="text-sm mt-2">
                Share this link: <code className="text-blue-400">{publicUrl}</code>
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredApplicants.map((applicant) => (
              <ApplicantCard
                key={applicant.id}
                applicant={applicant}
                onClick={() => setSelectedApplicant(applicant)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-gray-700 bg-gray-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            {exportComplete && (
              <span className="text-green-400 text-sm flex items-center gap-1">
                <CheckCircle size={16} />
                Exported to Workerbook
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting || applicants.length === 0}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                exportComplete
                  ? 'bg-green-900/30 text-green-400 border border-green-700'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {exporting ? (
                <Loader className="animate-spin" size={18} />
              ) : (
                <Download size={18} />
              )}
              {exportComplete ? 'Export Again' : 'Export to Sheets'}
            </button>
            
            <button
              onClick={handleClose}
              disabled={loading}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                exportComplete
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {exportComplete ? <Unlock size={18} /> : <Lock size={18} />}
              Close Session
            </button>
          </div>
        </div>
      </div>

      {/* Applicant Detail Modal */}
      {selectedApplicant && (
        <ApplicantDetailModal
          applicant={selectedApplicant}
          onClose={() => setSelectedApplicant(null)}
          onUpdate={handleUpdateApplicant}
        />
      )}
    </div>
  );
};

// --- APPLICANT CARD COMPONENT ---
interface ApplicantCardProps {
  applicant: JobFairApplicant;
  onClick: () => void;
}

const ApplicantCard: React.FC<ApplicantCardProps> = ({ applicant, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-gray-800 rounded-lg border p-4 transition-all hover:border-purple-500/50 hover:bg-gray-750 ${
        applicant.isInterviewed
          ? 'border-green-700/50'
          : 'border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-bold text-white">
            {applicant.lastName}, {applicant.firstName}
          </h3>
          <p className="text-sm text-gray-400">{applicant.cellPhone}</p>
        </div>
        
        {applicant.rating && (
          <div className="flex items-center gap-1 bg-yellow-900/30 text-yellow-400 px-2 py-0.5 rounded text-sm">
            <Star size={12} fill="currentColor" />
            {applicant.rating}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        {applicant.isInterviewed && (
          <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded">
            Interviewed
          </span>
        )}
        {applicant.isBc && (
          <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded">
            BC
          </span>
        )}
        {applicant.isManagement && (
          <span className="text-xs bg-purple-900/30 text-purple-400 px-2 py-0.5 rounded">
            Mgmt
          </span>
        )}
      </div>
    </button>
  );
};

// --- APPLICANT DETAIL MODAL ---
interface ApplicantDetailModalProps {
  applicant: JobFairApplicant;
  onClose: () => void;
  onUpdate: (id: string, updates: ApplicantUpdateFields, closeModal?: boolean) => void;
}

const ApplicantDetailModal: React.FC<ApplicantDetailModalProps> = ({
  applicant,
  onClose,
  onUpdate,
}) => {
  // Local state for form fields (allows instant UI updates)
  const [firstName, setFirstName] = useState(applicant.firstName);
  const [lastName, setLastName] = useState(applicant.lastName);
  const [cellPhone, setCellPhone] = useState(applicant.cellPhone);
  const [alternatePhone, setAlternatePhone] = useState(applicant.alternatePhone || '');
  const [email, setEmail] = useState(applicant.email || '');
  const [address, setAddress] = useState(applicant.address);
  const [city, setCity] = useState(applicant.city || '');
  const [postalCode, setPostalCode] = useState(applicant.postalCode || '');
  const [age, setAge] = useState(applicant.age);
  const [idType, setIdType] = useState<ApplicantIdType>(applicant.idType);
  const [idValue, setIdValue] = useState(applicant.idValue);

  // Sync local state when applicant prop changes
  useEffect(() => {
    setFirstName(applicant.firstName);
    setLastName(applicant.lastName);
    setCellPhone(applicant.cellPhone);
    setAlternatePhone(applicant.alternatePhone || '');
    setEmail(applicant.email || '');
    setAddress(applicant.address);
    setCity(applicant.city || '');
    setPostalCode(applicant.postalCode || '');
    setAge(applicant.age);
    setIdType(applicant.idType);
    setIdValue(applicant.idValue);
  }, [applicant]);

  // Generic field update handler (saves on blur)
  const handleFieldBlur = (field: keyof ApplicantUpdateFields, value: any) => {
    // Don't save if value hasn't changed
    const currentValue = applicant[field as keyof JobFairApplicant];
    if (value === currentValue || (value === '' && currentValue === null)) return;
    
    onUpdate(applicant.id, { [field]: value || null });
  };

  const handleRatingChange = (rating: number) => {
    onUpdate(applicant.id, { 
      rating: applicant.rating === rating ? null : rating 
    });
  };

  const handleIdTypeChange = (newIdType: ApplicantIdType) => {
    setIdType(newIdType);
    setIdValue(''); // Clear ID value when type changes
    onUpdate(applicant.id, { idType: newIdType, idValue: '' });
  };

  const toggleBc = () => {
    onUpdate(applicant.id, { isBc: !applicant.isBc });
  };

  const toggleManagement = () => {
    onUpdate(applicant.id, { isManagement: !applicant.isManagement });
  };

  const toggleInterviewed = () => {
    // Close modal after marking as interviewed
    onUpdate(applicant.id, { isInterviewed: !applicant.isInterviewed }, true);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <User size={20} className="text-purple-400" />
            Edit Applicant
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={() => handleFieldBlur('firstName', firstName)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={() => handleFieldBlur('lastName', lastName)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <Phone size={12} /> Cell Phone
              </label>
              <input
                type="tel"
                value={cellPhone}
                onChange={(e) => setCellPhone(e.target.value)}
                onBlur={() => handleFieldBlur('cellPhone', cellPhone)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <Phone size={12} /> Alternate Phone (optional)
              </label>
              <input
                type="tel"
                value={alternatePhone}
                onChange={(e) => setAlternatePhone(e.target.value)}
                onBlur={() => handleFieldBlur('alternatePhone', alternatePhone)}
                placeholder="Optional"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <Mail size={12} /> Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => handleFieldBlur('email', email)}
                placeholder="Optional"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none placeholder-gray-600"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <MapPin size={12} /> Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => handleFieldBlur('address', address)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  onBlur={() => handleFieldBlur('city', city)}
                  placeholder="Optional"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Postal Code
                </label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  onBlur={() => handleFieldBlur('postalCode', postalCode)}
                  placeholder="Optional"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none placeholder-gray-600"
                />
              </div>
            </div>
          </div>

          {/* Age & ID */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <Calendar size={12} /> Age
              </label>
              <input
                type="number"
                min="16"
                max="99"
                value={age}
                onChange={(e) => setAge(parseInt(e.target.value) || 0)}
                onBlur={() => handleFieldBlur('age', age)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                <CreditCard size={12} /> ID Type
              </label>
              <select
                value={idType}
                onChange={(e) => handleIdTypeChange(e.target.value as ApplicantIdType)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              >
                {ID_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {ID_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ID Value */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
              <Hash size={12} /> {ID_TYPE_LABELS[idType]} Number
            </label>
            <input
              type="text"
              value={idValue}
              onChange={(e) => setIdValue(e.target.value)}
              onBlur={() => handleFieldBlur('idValue', idValue)}
              placeholder={`Enter ${ID_TYPE_LABELS[idType]} number`}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>

          {/* Divider */}
          <hr className="border-gray-700" />

          {/* Rating */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Rating
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => handleRatingChange(rating)}
                  className={`w-12 h-12 rounded-lg font-bold text-lg transition-all ${
                    applicant.rating === rating
                      ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Tags
            </label>
            <div className="flex gap-3">
              <button
                onClick={toggleBc}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                  applicant.isBc
                    ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                <Briefcase size={18} />
                BC
              </button>
              <button
                onClick={toggleManagement}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                  applicant.isManagement
                    ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                <Shield size={18} />
                Management
              </button>
            </div>
          </div>

          {/* Mark Interviewed */}
          <button
            onClick={toggleInterviewed}
            className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${
              applicant.isInterviewed
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <UserCheck size={20} />
            {applicant.isInterviewed ? 'Interviewed ✓' : 'Mark as Interviewed'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JobFairManager;