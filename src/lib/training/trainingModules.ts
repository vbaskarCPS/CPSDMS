// src/lib/training/trainingModules.ts
// Shared types, helpers, and constants for the training module system.
// Module content lives in level1Modules.ts, level2Modules.ts, etc.

export type Region = 'West' | 'Central' | 'East';

// --- Supabase storage base URL for training images ---
export const STORAGE_BASE =
  'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/training-images';

// --- Quiz ---
export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

// --- Structured Lesson Sections ---

export interface TextSection {
  type: 'text';
  heading?: string;
  body: string;
  linkTo?: string;
  linkLabel?: string;
}

export interface ImageSection {
  type: 'image';
  heading?: string;
  body: string;
  image: {
    src: string;
    alt: string;
    position?: 'top' | 'inline-right' | 'inline-left' | 'bottom';
    maxHeight?: number;
  };
}

export interface StoryboardFrame {
  label: string;
  caption: string;
  overlays?: {
    type: 'icon' | 'flag' | 'label';
    src?: string;
    text?: string;
    x: number;
    y: number;
    color?: string;
  }[];
}

export interface StoryboardSection {
  type: 'storyboard';
  heading: string;
  description?: string;
  baseImage: {
    src: string;
    alt: string;
  };
  frames: StoryboardFrame[];
}

export interface VideoSection {
  type: 'video';
  heading: string;
  description?: string;
  youtubeId: string;
  note?: string;
}

export type LessonSection = TextSection | ImageSection | StoryboardSection | VideoSection;

// --- Training Module ---
export interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  lesson_content: string;
  lesson_sections?: LessonSection[];
  quiz: QuizQuestion[];
  region?: Region;
  order_index: number;
  is_active: boolean;
  level: number; // 1 = Level 1, 2 = Level 2, etc.
}

// Pass threshold: 80% or higher to mark a module complete
export const QUIZ_PASS_THRESHOLD = 0.8;