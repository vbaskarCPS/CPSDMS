// src/planner/features/cycle/types.ts — the cycle tracker's docs.
export type Flow = 'spotting' | 'light' | 'medium' | 'heavy';

/** kind 'period', key = start date */
export interface Period { start: string; end: string; source?: 'flo' | 'app'; flow?: 'light' | 'medium' | 'heavy' }

/** kind 'cyclelog', key = date */
export interface DayLog {
  flow?: Flow;
  symptoms?: string[];
  mood?: string[];
  discharge?: 'dry' | 'sticky' | 'creamy' | 'egg white' | 'watery';
  sex?: 'protected' | 'unprotected' | 'none';
  ovulationTest?: 'positive' | 'negative';
  bbt?: number;
  notes?: string;
}

/** kind 'cycleprefs', key 'settings' */
export interface CyclePrefs {
  cycleLength?: number;
  periodLength?: number;
  lutealDays: number;
  fertileBefore: number;
  fertileAfter: number;
  useLast: number;
}
export const DEFAULT_PREFS: CyclePrefs = { lutealDays: 14, fertileBefore: 5, fertileAfter: 1, useLast: 6 };

export const SYMPTOMS = ['cramps', 'headache', 'bloating', 'tender breasts', 'backache', 'acne', 'fatigue', 'nausea', 'cravings'];
export const MOODS = ['calm', 'happy', 'energetic', 'irritable', 'anxious', 'sad', 'mood swings'];
export const FLOWS: Flow[] = ['spotting', 'light', 'medium', 'heavy'];
export const DISCHARGE: NonNullable<DayLog['discharge']>[] = ['dry', 'sticky', 'creamy', 'egg white', 'watery'];

export const hasLog = (l: DayLog | null | undefined): boolean =>
  !!l && !!(l.flow || l.symptoms?.length || l.mood?.length || l.discharge || l.sex || l.ovulationTest || l.bbt || l.notes);
