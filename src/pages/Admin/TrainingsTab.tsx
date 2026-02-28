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
} from 'lucide-react';
import { CommandCenter } from '../../lib/commandCenterService';
import { contractorService, ContractorTrainingSummary, TrainingAttempt } from '../../lib/contractorService';
import { googleSheetsService } from '../../lib/googleSheetsService';
import { WORKERBOOK_COLUMNS } from '../../lib/googleSheetsConfig';
import { TRAINING_MODULES, getModulesForRegion } from '../../lib/trainingModules';

interface TrainingsTabProps {
  commandCenter: CommandCenter;
}

const TrainingsTab: React.FC<TrainingsTabProps> = ({ commandCenter }) => {
  const [summaries, setSummaries] = useState<ContractorTrainingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedContractorId, setExpandedContractorId] = useState<string | null>(null);

  // Modules relevant to this CC's region
  const modules = getModulesForRegion(commandCenter.region as any);
  const totalModules = modules.length;

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

    try {
      // Authenticate with Google if needed
      const isAuthenticated = googleSheetsService.isAuthenticated();
      if (!isAuthenticated) {
        const success = await googleSheetsService.authenticate();
        if (!success) throw new Error('Failed to authenticate with Google Sheets');
      }

      // Read the Workerbook Contractors tab (columns A–K cover all contractor fields)
      const rows = await googleSheetsService.readWorkerbookRange('A:K');

      // Skip header rows (first 2 rows are headers)
      const dataRows = rows.slice(WORKERBOOK_COLUMNS.dataStartRow);

      const result = await contractorService.syncContractorsFromRows(
        dataRows,
        commandCenter.id,
        commandCenter.region
      );

      setSyncResult(result);
      await loadData(); // Refresh the list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // --- FILTERED SUMMARIES ---
  const filtered = summaries.filter((s) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      s.contractor.firstName.toLowerCase().includes(term) ||
      s.contractor.lastName.toLowerCase().includes(term) ||
      s.contractor.contractorId.toLowerCase().includes(term)
    );
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
              {totalModules} module{totalModules !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
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
              {syncing ? (
                <Loader className="animate-spin" size={16} />
              ) : (
                <CloudUpload size={16} />
              )}
              Sync from Workerbook
            </button>
          </div>
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className="mt-3 p-3 bg-green-900/20 border border-green-700/50 rounded-lg text-xs text-green-300 flex items-center gap-2">
            <CheckCircle size={14} />
            Sync complete: {syncResult.added} new contractor{syncResult.added !== 1 ? 's' : ''} added,{' '}
            {syncResult.skipped} already existed.
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
            <div className="grid gap-2 px-4 pb-2 border-b border-gray-800" style={{ gridTemplateColumns: `1fr repeat(${totalModules}, minmax(60px, 80px)) 80px` }}>
              <span className="text-xs font-medium text-gray-500 uppercase">Contractor</span>
              {modules.map((m) => (
                <span key={m.module_id} className="text-xs font-medium text-gray-500 uppercase text-center truncate" title={m.title}>
                  M{m.order_index}
                </span>
              ))}
              <span className="text-xs font-medium text-gray-500 uppercase text-center">Total</span>
            </div>

            {filtered.map((summary) => {
              const isExpanded = expandedContractorId === summary.contractor.contractorId;

              return (
                <ContractorRow
                  key={summary.contractor.id}
                  summary={summary}
                  modules={modules}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(summary.contractor.contractorId)}
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
  modules: typeof TRAINING_MODULES;
  isExpanded: boolean;
  onToggle: () => void;
}

const ContractorRow: React.FC<ContractorRowProps> = ({
  summary,
  modules,
  isExpanded,
  onToggle,
}) => {
  const { contractor, progress, attempts, completedCount, totalModules } = summary;

  const getModuleStatus = (moduleId: string) => {
    return progress.find((p) => p.moduleId === moduleId && p.isCompleted);
  };

  const getModuleAttempts = (moduleId: string): TrainingAttempt[] => {
    return attempts.filter((a) => a.moduleId === moduleId);
  };

  const allDone = completedCount === totalModules && totalModules > 0;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `1fr repeat(${modules.length}, minmax(60px, 80px)) 80px` }}>
          {/* Name */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-gray-400" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {contractor.lastName}, {contractor.firstName}
              </p>
              <p className="text-gray-500 text-xs">{contractor.contractorId}</p>
            </div>
          </div>

          {/* Per-module status */}
          {modules.map((m) => {
            const completed = getModuleStatus(m.module_id);
            const moduleAttempts = getModuleAttempts(m.module_id);
            return (
              <div key={m.module_id} className="flex justify-center">
                {completed ? (
                  <CheckCircle size={18} className="text-green-400" />
                ) : moduleAttempts.length > 0 ? (
                  <XCircle size={18} className="text-red-400" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-gray-700" />
                )}
              </div>
            );
          })}

          {/* Total */}
          <div className="flex items-center justify-center gap-1">
            <span className={`text-sm font-bold ${allDone ? 'text-green-400' : 'text-gray-300'}`}>
              {completedCount}/{totalModules}
            </span>
            <span className="text-gray-600">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </div>
        </div>
      </button>

      {/* Expanded: per-module attempt history */}
      {isExpanded && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-4 bg-gray-900/50">
          {modules.map((m) => {
            const moduleAttempts = getModuleAttempts(m.module_id);
            const completed = getModuleStatus(m.module_id);

            return (
              <div key={m.module_id}>
                <div className="flex items-center gap-2 mb-2">
                  {completed ? (
                    <CheckCircle size={14} className="text-green-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-600" />
                  )}
                  <span className="text-sm font-medium text-gray-300">{m.title}</span>
                  {completed && (
                    <span className="text-xs text-green-500 ml-auto">
                      Passed {completed.completedAt ? new Date(completed.completedAt).toLocaleDateString() : ''}
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
                          {a.score}/{a.totalQuestions} ({Math.round((a.score / a.totalQuestions) * 100)}%)
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
          })}
        </div>
      )}
    </div>
  );
};

export default TrainingsTab;