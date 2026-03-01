// src/lib/training/index.ts
// Central index — combines all training levels and re-exports everything.
// When adding a new level, import it here and add to ALL_MODULES.

export {
    STORAGE_BASE,
    QUIZ_PASS_THRESHOLD,
  } from './trainingModules';
  
  export type {
    Region,
    QuizQuestion,
    TextSection,
    ImageSection,
    StoryboardFrame,
    StoryboardSection,
    VideoSection,
    LessonSection,
    TrainingModule,
  } from './trainingModules';
  
  import type { Region, TrainingModule } from './trainingModules';
  import { LEVEL_1_MODULES } from './level1Modules';
  import { LEVEL_2_MODULES } from './level2Modules';
  
  // --- Combined module list (add new levels here) ---
  export const TRAINING_MODULES: TrainingModule[] = [
    ...LEVEL_1_MODULES,
    ...LEVEL_2_MODULES,
  ];
  
  // Helper: Get a module by ID
  export const getModuleById = (moduleId: string): TrainingModule | undefined => {
    return TRAINING_MODULES.find((m) => m.module_id === moduleId);
  };
  
  // Helper: Get active modules for a region (or all if no region), optionally filtered by level
  export const getModulesForRegion = (region?: Region, level?: number): TrainingModule[] => {
    return TRAINING_MODULES.filter(
      (m) =>
        m.is_active &&
        (!m.region || m.region === region) &&
        (level === undefined || m.level === level)
    ).sort((a, b) => a.order_index - b.order_index);
  };
  
  // Helper: Get all modules for a specific level
  export const getModulesForLevel = (level: number, region?: Region): TrainingModule[] => {
    return getModulesForRegion(region, level);
  };
  
  // Helper: Get the highest level number available
  export const getMaxLevel = (): number => {
    return Math.max(...TRAINING_MODULES.map((m) => m.level));
  };