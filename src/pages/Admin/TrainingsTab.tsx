// src/pages/Admin/TrainingsTab.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  RefreshCw,
  CloudUpload,
  Loader,
  CheckCircle,
  XCircle,
  User,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Search,
  Users,
  Trash2,
  Mail,
  Settings,
  Unlock,
  Lock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CommandCenter } from '../../lib/commandCenterService';
import { contractorService, ContractorTrainingSummary, TrainingAttempt } from '../../lib/contractorService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { WORKERBOOK_COLUMNS } from '../../lib/googleSheetsConfig';
import { TRAINING_MODULES, getModulesForRegion, getModulesForLevel } from '../../lib/training/index';
import { onboardingService } from '../../lib/onboardingService';

interface TrainingsTabProps {
  commandCenter: CommandCenter;
}

const TrainingsTab: React.FC<TrainingsTabProps> = ({ commandCenter }) => {
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<ContractorTrainingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number; coloured?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorWarning, setColorWarning] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedContractorId, setExpandedContractorId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  // Modules relevant to this CC's region, split by level
  const region = commandCenter.region as any;
  const level1Modules = getModulesForLevel(1, region);
  const level2Modules = getModulesForLevel(2, region);
  const allModules = getModulesForRegion(region);
  const totalModules = allModules.length;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contractorService.getTrainingSummaryForCC(
        commandCenter.id,
        totalModules
      );
      setSummaries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load training data');
    } finally {
      setLoading(false);
    }
  }, [commandCenter.id, totalModules]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- SYNC FROM GOOGLE SHEETS ---
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    setColorWarning(null);

    try {
      const isAuthenticated = googleSheetsService.isAuthenticated();
      if (!isAuthenticated) {
        const success = await googleSheetsService.authenticate();
        if (!success) throw new Error('Failed to authenticate with Google Sheets');
      }

      // Read from the Contractors tab, columns A through S
      const rows = await googleSheetsService.readWorkerbookRange(WORKERBOOK_COLUMNS.syncRange);
      const dataRows = rows.slice(WORKERBOOK_COLUMNS.dataStartRow);

      const result = await contractorService.syncContractorsFromRows(
        dataRows,
        commandCenter.id,
        commandCenter.region
      );

      // Fetch fresh summaries — used for both state update and building the colour map
      const freshSummaries = await contractorService.getTrainingSummaryForCC(
        commandCenter.id,
        totalModules
      );
      setSummaries(freshSummaries);

      // Build contractorId → training status map
      const colorMap = new Map<string, 'none' | 'started' | 'level1' | 'level2'>();

      for (const s of freshSummaries) {
        const l1Completed = level1Modules.filter(m =>
          s.progress.some(p => p.moduleId === m.module_id && p.isCompleted)
        ).length;
        const l2Completed = level2Modules.filter(m =>
          s.progress.some(p => p.moduleId === m.module_id && p.isCompleted)
        ).length;

        const l1Done = level1Modules.length > 0 && l1Completed === level1Modules.length;
        const l2Done =
          level2Modules.length > 0 &&
          l2Completed === level2Modules.length &&
          !!s.contractor.level2UnlockedAt;

        let status: 'none' | 'started' | 'level1' | 'level2' = 'none';
        if (l2Done) status = 'level2';
        else if (l1Done) status = 'level1';
        else if (s.progress.some(p => p.isCompleted)) status = 'started';

        colorMap.set(s.contractor.contractorId, status);
      }

      // Apply colours — failures here are non-fatal, shown as a warning
      let coloured = 0;
      try {
        coloured = await googleSheetsService.applyTrainingColorsToWorkerbook(colorMap);
      } catch (colorErr) {
        console.warn('Training colour sync failed:', colorErr);
        setColorWarning(
          colorErr instanceof Error
            ? `Colours not applied: ${colorErr.message}`
            : 'Colours could not be applied to the workerbook.'
        );
      }

      setSyncResult({ ...result, coloured });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // --- DELETE CONTRACTOR ---
  const handleDelete = async (contractorId: string, displayName: string) => {
    if (!window.confirm(`Delete ${displayName}? This will also remove all their training progress and quiz attempts. This cannot be undone.`)) {
      return;
    }

    setDeletingId(contractorId);
    setError(null);

    try {
      await contractorService.deleteContractor(contractorId, commandCenter.id);
      setSummaries((prev) => prev.filter((s) => s.contractor.id !== contractorId));
      if (expandedContractorId === contractorId) {
        setExpandedContractorId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete contractor');
    } finally {
      setDeletingId(null);
    }
  };

  // --- SEND ONBOARDING EMAIL ---
  const handleSendOnboardingEmail = async (summary: ContractorTrainingSummary) => {
    const { contractor } = summary;

    if (!contractor.email) return;

    const displayName = `${contractor.firstName} ${contractor.lastName} (${contractor.contractorId})`;
    if (!window.confirm(`Send onboarding email to ${displayName}?\n\nEmail: ${contractor.email}`)) {
      return;
    }

    setSendingEmailId(contractor.id);
    setError(null);

    try {
      await onboardingService.sendOnboardingEmail({
        contractorId: contractor.contractorId,
        firstName: contractor.firstName,
        lastName: contractor.lastName,
        email: contractor.email,
        shuttle: contractor.shuttle || undefined,
        firstDayBooked: contractor.firstDayBooked || undefined,
        commandCenterId: commandCenter.id,
        commandCenterName: commandCenter.displayName,
      });

      // Update local state to show green icon
      setSummaries((prev) =>
        prev.map((s) =>
          s.contractor.id === contractor.id
            ? {
                ...s,
                contractor: {
                  ...s.contractor,
                  onboardingEmailSentAt: new Date().toISOString(),
                },
              }
            : s
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send onboarding email');
    } finally {
      setSendingEmailId(null);
    }
  };

  // --- UNLOCK LEVEL 2 ---
  const handleUnlockLevel2 = async (summary: ContractorTrainingSummary) => {
    const { contractor } = summary;
    const displayName = `${contractor.firstName} ${contractor.lastName} (${contractor.contractorId})`;

    const hasEmail = !!contractor.email;
    const confirmMsg = hasEmail
      ? `Unlock Level 2 Training for ${displayName}?\n\nThis will send a notification email to ${contractor.email}.`
      : `Unlock Level 2 Training for ${displayName}?\n\nNote: No email on file — they will not receive a notification.`;

    if (!window.confirm(confirmMsg)) return;

    setUnlockingId(contractor.id);
    setError(null);

    try {
      // 1. Write timestamp to DB
      await contractorService.unlockLevel2(contractor.contractorId, commandCenter.id);

      // 2. Send email if they have one
      if (hasEmail) {
        try {
          await onboardingService.sendLevel2UnlockEmail({
            contractorId: contractor.contractorId,
            firstName: contractor.firstName,
            lastName: contractor.lastName,
            email: contractor.email!,
            commandCenterId: commandCenter.id,
            commandCenterName: commandCenter.displayName,
          });
        } catch (emailErr) {
          // Don't fail the unlock if just the email fails
          console.error('Level 2 email failed:', emailErr);
        }
      }

      // 3. Update local state
      setSummaries((prev) =>
        prev.map((s) =>
          s.contractor.id === contractor.id
            ? {
                ...s,
                contractor: {
                  ...s.contractor,
                  level2UnlockedAt: new Date().toISOString(),
                },
              }
            : s
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock Level 2');
    } finally {
      setUnlockingId(null);
    }
  };

  // --- FILTERED & SORTED SUMMARIES ---
  const filtered = summaries
    .filter((s) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        s.contractor.firstName.toLowerCase().includes(term) ||
        s.contractor.lastName.toLowerCase().includes(term) ||
        s.contractor.contractorId.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      // 1. Email not sent → top
      const aEmailSent = a.contractor.onboardingEmailSentAt ? 1 : 0;
      const bEmailSent = b.contractor.onboardingEmailSentAt ? 1 : 0;
      if (aEmailSent !== bEmailSent) return aEmailSent - bEmailSent;

      // 2. Most completed modules → top
      const aCompleted = a.progress.filter((p) => p.isCompleted).length;
      const bCompleted = b.progress.filter((p) => p.isCompleted).length;
      if (aCompleted !== bCompleted) return bCompleted - aCompleted;

      // 3. Alphabetical by last name, then first name
      const lastCmp = a.contractor.lastName.localeCompare(b.contractor.lastName);
      if (lastCmp !== 0) return lastCmp;
      return a.contractor.firstName.localeCompare(b.contractor.firstName);
    });

  const toggleExpand = (contractorId: string) => {
    setExpandedContractorId((prev) => (prev === contractorId ? null : contractorId));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 bg-gray-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <GraduationCap className="text-blue-400" size={20} />
              Training Progress
            </h2>
            <p className="text-sm text-gray-400">
              {summaries.length} contractor{summaries.length !== 1 ? 's' : ''} •{' '}
              L1: {level1Modules.length} module{level1Modules.length !== 1 ? 's' : ''}
              {level2Modules.length > 0 && ` • L2: ${level2Modules.length} module${level2Modules.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/admin/onboarding-setup')}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
              title="Onboarding Email Setup"
            >
              <Mail size={16} />
              <span className="hidden sm:inline">Onboarding Email</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader className="animate-spin" size={16} /> : <CloudUpload size={16} />}
              Sync from Workerbook
            </button>
          </div>
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className="mt-3 p-3 bg-green-900/20 border border-green-700/50 rounded-lg text-xs text-green-300 flex items-center gap-2">
            <CheckCircle size={14} />
            Sync complete: {syncResult.added} contractor{syncResult.added !== 1 ? 's' : ''} synced,{' '}
            {syncResult.skipped} skipped (no CN#).
            {syncResult.coloured !== undefined && syncResult.coloured > 0 && (
              <> {syncResult.coloured} training colour{syncResult.coloured !== 1 ? 's' : ''} applied to workerbook.</>
            )}
          </div>
        )}

        {/* Colour warning (non-fatal — sync succeeded but colours failed) */}
        {colorWarning && (
          <div className="mt-2 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-xs text-yellow-300 flex items-center gap-2">
            <AlertCircle size={14} />
            {colorWarning}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-3 p-3 bg-red-900/20 border border-red-700/50 rounded-lg text-xs text-red-300 flex items-center gap-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Search */}
        <div className="mt-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search contractors..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-blue-400" size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Users className="mx-auto mb-3 opacity-30" size={48} />
            <p className="font-medium">
              {summaries.length === 0
                ? 'No contractors synced yet'
                : 'No contractors match your search'}
            </p>
            {summaries.length === 0 && (
              <p className="text-sm mt-2 text-gray-600">
                Click "Sync from Workerbook" to import contractors from Google Sheets.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Column headers */}
            <div
              className="grid gap-2 px-4 pb-2 border-b border-gray-800 items-end"
              style={{ gridTemplateColumns: '32px 1fr 100px 100px 40px 40px 40px' }}
            >
              <span /> {/* Email column */}
              <span className="text-xs font-medium text-gray-500 uppercase">Contractor</span>
              <span className="text-xs font-medium text-gray-500 uppercase text-center">Level 1</span>
              <span className="text-xs font-medium text-gray-500 uppercase text-center">Level 2</span>
              <span /> {/* Unlock column */}
              <span /> {/* Delete column */}
              <span /> {/* Expand column */}
            </div>

            {filtered.map((summary) => {
              const isExpanded = expandedContractorId === summary.contractor.contractorId;
              const isDeleting = deletingId === summary.contractor.id;

              return (
                <ContractorRow
                  key={summary.contractor.id}
                  summary={summary}
                  level1Modules={level1Modules}
                  level2Modules={level2Modules}
                  isExpanded={isExpanded}
                  isDeleting={isDeleting}
                  isSendingEmail={sendingEmailId === summary.contractor.id}
                  isUnlocking={unlockingId === summary.contractor.id}
                  onToggle={() => toggleExpand(summary.contractor.contractorId)}
                  onDelete={() =>
                    handleDelete(
                      summary.contractor.id,
                      `${summary.contractor.firstName} ${summary.contractor.lastName} (${summary.contractor.contractorId})`
                    )
                  }
                  onSendEmail={() => handleSendOnboardingEmail(summary)}
                  onUnlockLevel2={() => handleUnlockLevel2(summary)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// --- CONTRACTOR ROW ---
interface ContractorRowProps {
  summary: ContractorTrainingSummary;
  level1Modules: typeof TRAINING_MODULES;
  level2Modules: typeof TRAINING_MODULES;
  isExpanded: boolean;
  isDeleting: boolean;
  isSendingEmail: boolean;
  isUnlocking: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSendEmail: () => void;
  onUnlockLevel2: () => void;
}

const ContractorRow: React.FC<ContractorRowProps> = ({
  summary,
  level1Modules,
  level2Modules,
  isExpanded,
  isDeleting,
  isSendingEmail,
  isUnlocking,
  onToggle,
  onDelete,
  onSendEmail,
  onUnlockLevel2,
}) => {
  const { contractor, progress, attempts } = summary;

  const getModuleStatus = (moduleId: string) => {
    return progress.find((p) => p.moduleId === moduleId && p.isCompleted);
  };

  const getModuleAttempts = (moduleId: string): TrainingAttempt[] => {
    return attempts.filter((a) => a.moduleId === moduleId);
  };

  // Per-level completion counts
  const l1Completed = level1Modules.filter((m) => getModuleStatus(m.module_id)).length;
  const l2Completed = level2Modules.filter((m) => getModuleStatus(m.module_id)).length;
  const l1Total = level1Modules.length;
  const l2Total = level2Modules.length;
  const l1Done = l1Completed === l1Total && l1Total > 0;
  const l2Done = l2Completed === l2Total && l2Total > 0;
  const l2Unlocked = !!contractor.level2UnlockedAt;

  // Email status
  const hasEmail = !!contractor.email;
  const emailSent = !!contractor.onboardingEmailSentAt;

  let emailIconColor = 'text-gray-600';
  let emailTooltip = 'No email address on file';
  if (hasEmail && emailSent) {
    emailIconColor = 'text-green-400';
    emailTooltip = `Onboarding email sent ${new Date(contractor.onboardingEmailSentAt!).toLocaleDateString()}`;
  } else if (hasEmail && !emailSent) {
    emailIconColor = 'text-yellow-400';
    emailTooltip = `Click to send onboarding email to ${contractor.email}`;
  }

  // All modules combined for expanded view
  const allModules = [...level1Modules, ...level2Modules];

  return (
    <div className={`bg-gray-900 rounded-lg border border-gray-800 overflow-hidden transition-opacity ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Main row */}
      <div
        className="grid gap-2 items-center px-4 py-3 hover:bg-gray-800/50 transition-colors"
        style={{ gridTemplateColumns: '32px 1fr 100px 100px 40px 40px 40px' }}
      >
        {/* Email icon */}
        <div className="flex justify-center">
          {isSendingEmail ? (
            <Loader size={16} className="animate-spin text-yellow-400" />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasEmail && !emailSent) onSendEmail();
              }}
              disabled={!hasEmail || emailSent}
              className={`p-1 rounded transition-colors ${
                hasEmail && !emailSent
                  ? 'hover:bg-yellow-900/30 cursor-pointer'
                  : hasEmail && emailSent
                  ? 'cursor-default'
                  : 'cursor-not-allowed opacity-50'
              }`}
              title={emailTooltip}
            >
              <Mail size={15} className={emailIconColor} />
            </button>
          )}
        </div>

        {/* Name — clickable to expand */}
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 text-left">
          <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
            <User size={14} className="text-gray-400" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {contractor.lastName}, {contractor.firstName}
            </p>
            <p className="text-gray-500 text-xs">{contractor.contractorId}</p>
          </div>
        </button>

        {/* Level 1 progress */}
        <button onClick={onToggle} className="flex items-center justify-center">
          <span className={`text-sm font-bold ${l1Done ? 'text-green-400' : 'text-gray-300'}`}>
            {l1Completed}/{l1Total}
          </span>
          {l1Done && <CheckCircle size={14} className="text-green-400 ml-1" />}
        </button>

        {/* Level 2 progress */}
        <button onClick={onToggle} className="flex items-center justify-center">
          {l2Unlocked ? (
            <>
              <span className={`text-sm font-bold ${l2Done ? 'text-green-400' : 'text-gray-300'}`}>
                {l2Completed}/{l2Total}
              </span>
              {l2Done && <CheckCircle size={14} className="text-green-400 ml-1" />}
            </>
          ) : (
            <span className="text-xs text-gray-600">Locked</span>
          )}
        </button>

        {/* Unlock Level 2 button */}
        <div className="flex justify-center">
          {isUnlocking ? (
            <Loader size={16} className="animate-spin text-amber-400" />
          ) : l2Unlocked ? (
            <div
              className="p-1 cursor-default"
              title={`Level 2 unlocked ${new Date(contractor.level2UnlockedAt!).toLocaleDateString()}`}
            >
              <Unlock size={15} className="text-green-500" />
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnlockLevel2();
              }}
              className="p-1 text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 rounded transition-colors"
              title="Unlock Level 2 Training"
            >
              <Lock size={15} />
            </button>
          )}
        </div>

        {/* Delete button */}
        <div className="flex justify-center">
          {isDeleting ? (
            <Loader size={16} className="animate-spin text-gray-500" />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
              title="Delete contractor"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>

        {/* Expand/collapse */}
        <button onClick={onToggle} className="flex justify-center text-gray-600">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: per-module attempt history */}
      {isExpanded && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-5 bg-gray-900/50">
          {/* Level 1 section */}
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <GraduationCap size={13} className="text-blue-400" />
              Level 1 — Fundamentals
              <span className={`ml-auto text-xs font-medium ${l1Done ? 'text-green-400' : 'text-gray-500'}`}>
                {l1Completed}/{l1Total}
              </span>
            </h4>
            <div className="space-y-3">
              {level1Modules.map((m) => (
                <ModuleDetail key={m.module_id} module={m} getModuleStatus={getModuleStatus} getModuleAttempts={getModuleAttempts} />
              ))}
            </div>
          </div>

          {/* Level 2 section */}
          {l2Unlocked && level2Modules.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <GraduationCap size={13} className="text-amber-400" />
                Level 2 — Advanced
                <span className={`ml-auto text-xs font-medium ${l2Done ? 'text-green-400' : 'text-gray-500'}`}>
                  {l2Completed}/{l2Total}
                </span>
              </h4>
              <div className="space-y-3">
                {level2Modules.map((m) => (
                  <ModuleDetail key={m.module_id} module={m} getModuleStatus={getModuleStatus} getModuleAttempts={getModuleAttempts} />
                ))}
              </div>
            </div>
          )}

          {!l2Unlocked && level2Modules.length > 0 && (
            <div className="text-center py-3 text-gray-600 text-xs flex items-center justify-center gap-2">
              <Lock size={12} />
              Level 2 not yet unlocked for this contractor
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- MODULE DETAIL (used in expanded view) ---
interface ModuleDetailProps {
  module: typeof TRAINING_MODULES[0];
  getModuleStatus: (moduleId: string) => any;
  getModuleAttempts: (moduleId: string) => TrainingAttempt[];
}

const ModuleDetail: React.FC<ModuleDetailProps> = ({ module, getModuleStatus, getModuleAttempts }) => {
  const completed = getModuleStatus(module.module_id);
  const moduleAttempts = getModuleAttempts(module.module_id);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {completed ? (
          <CheckCircle size={14} className="text-green-400" />
        ) : (
          <div className="w-3.5 h-3.5 rounded-full border border-gray-600" />
        )}
        <span className="text-sm font-medium text-gray-300">{module.title}</span>
        {completed && (
          <span className="text-xs text-green-500 ml-auto">
            Passed{' '}
            {completed.completedAt
              ? new Date(completed.completedAt).toLocaleDateString()
              : ''}
          </span>
        )}
      </div>

      {moduleAttempts.length === 0 ? (
        <p className="text-xs text-gray-600 ml-5">No attempts yet</p>
      ) : (
        <div className="ml-5 space-y-1">
          {moduleAttempts.map((a, i) => (
            <div
              key={a.id}
              className="flex items-center justify-between text-xs text-gray-500 bg-gray-800/50 rounded px-3 py-1.5"
            >
              <span className="text-gray-400">
                {i === 0 ? 'Latest' : `Attempt ${moduleAttempts.length - i}`}
              </span>
              <span>
                {a.score}/{a.totalQuestions} (
                {Math.round((a.score / a.totalQuestions) * 100)}%)
              </span>
              <span className={a.passed ? 'text-green-400' : 'text-red-400'}>
                {a.passed ? 'Passed' : 'Failed'}
              </span>
              <span className="text-gray-600">
                {new Date(a.attemptedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TrainingsTab;