// src/pages/Training/TrainingPortal.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CheckCircle, LogOut, ChevronRight, Trophy, Lock } from 'lucide-react';
import { contractorService, TrainingProgress } from '../../lib/contractorService';
import { getModulesForLevel, TrainingModule, QUIZ_PASS_THRESHOLD } from '../../lib/training';

const LOGO_URL =
  'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

const TrainingPortal: React.FC = () => {
  const navigate = useNavigate();

  const contractor = contractorService.getCurrentTrainingContractor();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!contractor) {
      navigate('/login');
    }
  }, [contractor, navigate]);

  const [progress, setProgress] = useState<TrainingProgress[]>([]);
  const [loading, setLoading] = useState(true);

  // Get modules filtered by region, split by level
  const region = contractor?.region as any;
  const level1Modules = contractor ? getModulesForLevel(1, region) : [];
  const level2Modules = contractor ? getModulesForLevel(2, region) : [];
  const level2Unlocked = !!contractor?.level2UnlockedAt;

  // Total visible modules (Level 1 always + Level 2 if unlocked)
  const visibleModules = level2Unlocked
    ? [...level1Modules, ...level2Modules]
    : level1Modules;

  useEffect(() => {
    if (!contractor) return;

    contractorService
      .getProgressForContractor(contractor.contractorId)
      .then(setProgress)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [contractor?.contractorId]);

  const handleLogout = () => {
    contractorService.clearCurrentTrainingContractor();
    navigate('/login');
  };

  const isModuleCompleted = (moduleId: string): boolean => {
    return progress.some((p) => p.moduleId === moduleId && p.isCompleted);
  };

  const completedCount = visibleModules.filter((m) => isModuleCompleted(m.module_id)).length;
  const progressPercent = visibleModules.length > 0 ? Math.round((completedCount / visibleModules.length) * 100) : 0;

  // Per-level counts
  const l1Completed = level1Modules.filter((m) => isModuleCompleted(m.module_id)).length;
  const l2Completed = level2Modules.filter((m) => isModuleCompleted(m.module_id)).length;

  if (!contractor) return null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="Logo" className="h-8" />
            <div>
              <h1 className="font-bold text-white text-sm">Online Training</h1>
              <p className="text-xs text-gray-400">
                Welcome, {contractor.firstName} {contractor.lastName}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Progress Banner */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="text-yellow-400" size={20} />
              <span className="font-bold text-white">Your Progress</span>
            </div>
            <span className="text-sm text-gray-400">
              {completedCount} / {visibleModules.length} modules complete
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500">
              Pass score: {Math.round(QUIZ_PASS_THRESHOLD * 100)}% or higher on each quiz
            </p>
            {level2Unlocked && (
              <p className="text-xs text-gray-500">
                L1: {l1Completed}/{level1Modules.length} • L2: {l2Completed}/{level2Modules.length}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 animate-pulse">
            Loading your progress...
          </div>
        ) : (
          <>
            {/* Level 1 Modules */}
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              Level 1 — Fundamentals
              {l1Completed === level1Modules.length && level1Modules.length > 0 && (
                <CheckCircle size={18} className="text-green-400" />
              )}
            </h2>

            <div className="space-y-3">
              {level1Modules.map((module, index) => {
                const completed = isModuleCompleted(module.module_id);

                return (
                  <ModuleCard
                    key={module.module_id}
                    module={module}
                    index={index}
                    completed={completed}
                    onClick={() => navigate(`/training/${module.module_id}`)}
                  />
                );
              })}
            </div>

            {/* Level 2 Modules */}
            {level2Unlocked && level2Modules.length > 0 && (
              <>
                <h2 className="text-lg font-bold text-white mb-4 mt-10 flex items-center gap-2">
                  Level 2 — Advanced
                  {l2Completed === level2Modules.length && level2Modules.length > 0 && (
                    <CheckCircle size={18} className="text-green-400" />
                  )}
                </h2>

                <div className="space-y-3">
                  {level2Modules.map((module, index) => {
                    const completed = isModuleCompleted(module.module_id);

                    return (
                      <ModuleCard
                        key={module.module_id}
                        module={module}
                        index={level1Modules.length + index}
                        completed={completed}
                        onClick={() => navigate(`/training/${module.module_id}`)}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {/* Level 2 locked teaser */}
            {!level2Unlocked && level2Modules.length > 0 && (
              <div className="mt-10 bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
                <Lock className="text-gray-600 mx-auto mb-3" size={32} />
                <h3 className="text-gray-400 font-bold text-sm mb-1">Level 2 — Advanced Training</h3>
                <p className="text-gray-600 text-xs">
                  {level2Modules.length} additional modules will be unlocked by your manager when you're ready.
                </p>
              </div>
            )}

            {/* All done banner */}
            {completedCount === visibleModules.length && visibleModules.length > 0 && (
              <div className="mt-8 bg-green-900/20 border border-green-700/50 rounded-xl p-6 text-center">
                <CheckCircle className="text-green-400 mx-auto mb-3" size={40} />
                <h3 className="text-green-300 font-bold text-lg mb-1">
                  {level2Unlocked ? 'All modules complete!' : 'Level 1 complete!'}
                </h3>
                <p className="text-gray-400 text-sm">
                  {level2Unlocked
                    ? `Great work, ${contractor.firstName}. You've completed all training modules.`
                    : `Great work, ${contractor.firstName}. You're ready for the field.`}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// --- MODULE CARD ---
interface ModuleCardProps {
  module: TrainingModule;
  index: number;
  completed: boolean;
  onClick: () => void;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module, index, completed, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-5 transition-all group flex items-center gap-4 ${
        completed
          ? 'bg-green-900/10 border-green-700/40 hover:border-green-600'
          : 'bg-gray-900 border-gray-800 hover:border-gray-600'
      }`}
    >
      {/* Module number / complete indicator */}
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-lg ${
          completed
            ? 'bg-green-600 text-white'
            : 'bg-gray-800 text-gray-400 border border-gray-700'
        }`}
      >
        {completed ? <CheckCircle size={22} /> : index + 1}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-bold text-white text-sm truncate">{module.title}</h3>
          {completed && (
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded flex-shrink-0">
              Complete
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 line-clamp-2">{module.description}</p>
        <p className="text-xs text-gray-600 mt-1">{module.quiz.length} quiz questions</p>
      </div>

      {/* Arrow */}
      <ChevronRight
        className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0"
        size={20}
      />
    </button>
  );
};

export default TrainingPortal;