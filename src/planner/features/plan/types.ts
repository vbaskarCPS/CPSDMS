// src/planner/features/plan/types.ts — the day page (doc kind 'day'), week ('week'), month ('month') and prefs.

export interface Savers { silence: boolean; affirmations: boolean; visualization: boolean; exercise: boolean; reading: boolean; scribing: boolean }
export interface Victory { wokeAt?: string; move: boolean; reflect: boolean; grow: boolean; savers: Savers }
export interface Morning { excited: string; word: string; aGame: string; stress: string; stressResponse: string; appreciate: string; progress: string }
export interface Project { name: string; steps: [string, string, string] }
export interface Priority { text: string; done: boolean }
export interface Slot { time: string; text: string }
export interface Evening { appreciated: string; handledWell: string; learned: string; better: string; connected: string; coachNote: string }
export type ScoreKey = 'clarity' | 'energy' | 'necessity' | 'productivity' | 'influence' | 'courage';
export type Scores = Partial<Record<ScoreKey, number>>;

/** The Bed Brief: ≤10 minutes, from bed, before getting up. Its priorities live in day.priorities. */
export interface Brief { word: string; aGame: string; stress: string; stressResponse: string; excited: string; startedAt?: string; finishedAt?: string; seconds?: number }
/** When each block of the routine was ticked ('HH:MM', phone time). */
export interface Ticks { up?: string; kiaanUp?: string; daycare?: string; dinner?: string; gym?: string; sauna?: string; shake?: string; lightsOut?: string }
/** Miracle Morning (morning profile): stretch → meditate → light workout, each ticked as it completes. */
export interface MorningRoutine { stretch?: boolean; meditate?: boolean; workout?: boolean; startedAt?: string; finishedAt?: string }
/** Miracle Night: unwind, the quick review, tomorrow's #1. */
export interface Night { saunaStart?: string; unwindStart?: string; unwindEnd?: string; tomorrowTop?: string; review: { win: string; drag: string; tomorrow: string } }
export const reviewDone = (d: Day) => Object.values(d.night.review).every(v => v.trim());

export interface Day {
  brief: Brief;
  ticks: Ticks;
  night: Night;
  morningRoutine: MorningRoutine;
  victory: Victory;
  morning: Morning;
  projects: Project[];
  people: { connect: string; lead: string };
  priorities: Priority[];
  schedule: Slot[];
  evening: Evening;
  scores: Scores;
  reflection?: string;
}

export const briefDone = (d: Day): boolean => !!d.brief.finishedAt;

export const SCORE_KEYS: { key: ScoreKey; label: string; hint: string }[] = [
  { key: 'clarity', label: 'Clarity', hint: 'I knew what I wanted and why' },
  { key: 'energy', label: 'Energy', hint: 'I kept my physical and mental energy up' },
  { key: 'necessity', label: 'Necessity', hint: 'I felt it was necessary to perform well' },
  { key: 'productivity', label: 'Productivity', hint: 'I moved the important things forward' },
  { key: 'influence', label: 'Influence', hint: 'I connected with and lifted people' },
  { key: 'courage', label: 'Courage', hint: 'I did the hard, right thing' },
];

export const emptyDay = (): Day => ({
  brief: { word: '', aGame: '', stress: '', stressResponse: '', excited: '' },
  ticks: {},
  night: { review: { win: '', drag: '', tomorrow: '' } },
  morningRoutine: {},
  victory: { move: false, reflect: false, grow: false, savers: { silence: false, affirmations: false, visualization: false, exercise: false, reading: false, scribing: false } },
  morning: { excited: '', word: '', aGame: '', stress: '', stressResponse: '', appreciate: '', progress: '' },
  projects: [{ name: '', steps: ['', '', ''] }, { name: '', steps: ['', '', ''] }, { name: '', steps: ['', '', ''] }],
  people: { connect: '', lead: '' },
  priorities: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }],
  schedule: [],
  evening: { appreciated: '', handledWell: '', learned: '', better: '', connected: '', coachNote: '' },
  scores: {},
});

/** A doc from the server may be older/partial: fill the gaps so every screen can read it. */
export function normalizeDay(d: Partial<Day> | null | undefined): Day {
  const e = emptyDay();
  if (!d) return e;
  const projects = Array.isArray(d.projects) ? d.projects.slice(0, 3) : [];
  while (projects.length < 3) projects.push({ name: '', steps: ['', '', ''] });
  const priorities = Array.isArray(d.priorities) ? d.priorities.slice(0, 3) : [];
  while (priorities.length < 3) priorities.push({ text: '', done: false });
  return {
    brief: { ...e.brief, ...(d.brief || {}) },
    ticks: { ...(d.ticks || {}) },
    morningRoutine: { ...(d.morningRoutine || {}) },
    night: { ...e.night, ...(d.night || {}), review: { ...e.night.review, ...(d.night?.review || {}) } },
    victory: { ...e.victory, ...(d.victory || {}), savers: { ...e.victory.savers, ...(d.victory?.savers || {}) } },
    morning: { ...e.morning, ...(d.morning || {}) },
    projects: projects.map(p => ({ name: p?.name || '', steps: [p?.steps?.[0] || '', p?.steps?.[1] || '', p?.steps?.[2] || ''] })),
    people: { ...e.people, ...(d.people || {}) },
    priorities: priorities.map(p => ({ text: p?.text || '', done: !!p?.done })),
    schedule: Array.isArray(d.schedule) ? d.schedule.filter(s => s && typeof s.time === 'string') : [],
    evening: { ...e.evening, ...(d.evening || {}) },
    scores: d.scores || {},
    reflection: d.reflection,
  };
}

export const LIFE_AREAS = ['Health', 'Mission', 'Family', 'Learning', 'Finances', 'Friends', 'Spirit', 'Mental energy', 'Love', 'Experiences'] as const;
export type LifeArea = typeof LIFE_AREAS[number];
export type LifeScores = Partial<Record<LifeArea, number>>;

export interface Week { areas: LifeScores; lessons: string; win: string; differently: string }
export const emptyWeek = (): Week => ({ areas: {}, lessons: '', win: '', differently: '' });

export interface Month { deadlines: string[]; areas: LifeScores; wentWell: string; didnt: string }
export const emptyMonth = (): Month => ({ deadlines: [], areas: {}, wentWell: '', didnt: '' });

export interface Goals { oneYear: string[]; threeYear: string[] }
export const emptyGoals = (): Goals => ({ oneYear: [], threeYear: [] });

export interface VictoryPrefs { move: number; reflect: number; grow: number }
export const defaultVictoryPrefs = (): VictoryPrefs => ({ move: 20, reflect: 20, grow: 20 });

/** Average of the six scores, or null when none is set. */
export function dayAverage(s: Scores | undefined): number | null {
  const v = SCORE_KEYS.map(k => s?.[k.key]).filter((n): n is number => typeof n === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}
