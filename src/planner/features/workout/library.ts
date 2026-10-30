// src/planner/features/workout/library.ts — the built-in exercise list. Custom ones live in kind 'exercise'.
import type { Exercise, Muscle, Equipment } from './types';

const ex = (id: string, name: string, muscles: Muscle[], equipment: Equipment, defaultStep?: number, type: 'strength' | 'cardio' = 'strength'): Exercise =>
  ({ id, name, muscles, equipment, type, defaultStep });

export const LIBRARY: Exercise[] = [
  // chest
  ex('bench-press', 'Barbell Bench Press', ['chest', 'triceps', 'shoulders'], 'barbell', 5),
  ex('incline-bench', 'Incline Barbell Bench Press', ['chest', 'shoulders', 'triceps'], 'barbell', 5),
  ex('db-bench', 'Dumbbell Bench Press', ['chest', 'triceps', 'shoulders'], 'dumbbell', 5),
  ex('db-incline-bench', 'Incline Dumbbell Press', ['chest', 'shoulders', 'triceps'], 'dumbbell', 5),
  ex('db-fly', 'Dumbbell Fly', ['chest'], 'dumbbell', 2.5),
  ex('cable-fly', 'Cable Fly', ['chest'], 'cable', 5),
  ex('pec-deck', 'Pec Deck', ['chest'], 'machine', 5),
  ex('machine-chest-press', 'Machine Chest Press', ['chest', 'triceps'], 'machine', 10),
  ex('push-up', 'Push-up', ['chest', 'triceps', 'core'], 'bodyweight'),
  ex('dip', 'Dip', ['chest', 'triceps'], 'bodyweight', 5),
  // back
  ex('deadlift', 'Deadlift', ['back', 'hamstrings', 'glutes'], 'barbell', 10),
  ex('barbell-row', 'Barbell Row', ['back', 'biceps'], 'barbell', 5),
  ex('pendlay-row', 'Pendlay Row', ['back', 'biceps'], 'barbell', 5),
  ex('db-row', 'One-arm Dumbbell Row', ['back', 'biceps'], 'dumbbell', 5),
  ex('pull-up', 'Pull-up', ['back', 'biceps'], 'bodyweight', 5),
  ex('chin-up', 'Chin-up', ['back', 'biceps'], 'bodyweight', 5),
  ex('lat-pulldown', 'Lat Pulldown', ['back', 'biceps'], 'cable', 10),
  ex('seated-row', 'Seated Cable Row', ['back', 'biceps'], 'cable', 10),
  ex('t-bar-row', 'T-Bar Row', ['back', 'biceps'], 'barbell', 10),
  ex('chest-supported-row', 'Chest-Supported Row', ['back', 'biceps'], 'machine', 10),
  ex('face-pull', 'Face Pull', ['shoulders', 'back'], 'cable', 5),
  ex('straight-arm-pulldown', 'Straight-Arm Pulldown', ['back'], 'cable', 5),
  ex('rack-pull', 'Rack Pull', ['back', 'glutes', 'hamstrings'], 'barbell', 10),
  ex('back-extension', 'Back Extension', ['back', 'glutes', 'hamstrings'], 'bodyweight', 5),
  // shoulders
  ex('ohp', 'Overhead Press', ['shoulders', 'triceps'], 'barbell', 5),
  ex('db-shoulder-press', 'Dumbbell Shoulder Press', ['shoulders', 'triceps'], 'dumbbell', 5),
  ex('arnold-press', 'Arnold Press', ['shoulders', 'triceps'], 'dumbbell', 5),
  ex('machine-shoulder-press', 'Machine Shoulder Press', ['shoulders', 'triceps'], 'machine', 10),
  ex('lateral-raise', 'Dumbbell Lateral Raise', ['shoulders'], 'dumbbell', 2.5),
  ex('cable-lateral-raise', 'Cable Lateral Raise', ['shoulders'], 'cable', 2.5),
  ex('front-raise', 'Front Raise', ['shoulders'], 'dumbbell', 2.5),
  ex('rear-delt-fly', 'Rear Delt Fly', ['shoulders', 'back'], 'dumbbell', 2.5),
  ex('upright-row', 'Upright Row', ['shoulders', 'back'], 'barbell', 5),
  ex('shrug', 'Barbell Shrug', ['back', 'shoulders'], 'barbell', 10),
  ex('db-shrug', 'Dumbbell Shrug', ['back', 'shoulders'], 'dumbbell', 5),
  // biceps
  ex('barbell-curl', 'Barbell Curl', ['biceps'], 'barbell', 5),
  ex('ez-curl', 'EZ-Bar Curl', ['biceps'], 'barbell', 5),
  ex('db-curl', 'Dumbbell Curl', ['biceps'], 'dumbbell', 2.5),
  ex('hammer-curl', 'Hammer Curl', ['biceps'], 'dumbbell', 2.5),
  ex('incline-curl', 'Incline Dumbbell Curl', ['biceps'], 'dumbbell', 2.5),
  ex('preacher-curl', 'Preacher Curl', ['biceps'], 'machine', 5),
  ex('cable-curl', 'Cable Curl', ['biceps'], 'cable', 5),
  ex('concentration-curl', 'Concentration Curl', ['biceps'], 'dumbbell', 2.5),
  // triceps
  ex('close-grip-bench', 'Close-Grip Bench Press', ['triceps', 'chest'], 'barbell', 5),
  ex('skullcrusher', 'Skull Crusher', ['triceps'], 'barbell', 5),
  ex('pushdown', 'Cable Pushdown', ['triceps'], 'cable', 5),
  ex('rope-pushdown', 'Rope Pushdown', ['triceps'], 'cable', 5),
  ex('overhead-ext', 'Overhead Triceps Extension', ['triceps'], 'dumbbell', 5),
  ex('cable-overhead-ext', 'Cable Overhead Extension', ['triceps'], 'cable', 5),
  ex('kickback', 'Triceps Kickback', ['triceps'], 'dumbbell', 2.5),
  ex('bench-dip', 'Bench Dip', ['triceps'], 'bodyweight'),
  ex('diamond-pushup', 'Diamond Push-up', ['triceps', 'chest'], 'bodyweight'),
  // quads
  ex('squat', 'Barbell Back Squat', ['quads', 'glutes', 'core'], 'barbell', 10),
  ex('front-squat', 'Front Squat', ['quads', 'core', 'glutes'], 'barbell', 10),
  ex('goblet-squat', 'Goblet Squat', ['quads', 'glutes'], 'dumbbell', 5),
  ex('leg-press', 'Leg Press', ['quads', 'glutes'], 'machine', 20),
  ex('hack-squat', 'Hack Squat', ['quads', 'glutes'], 'machine', 10),
  ex('leg-extension', 'Leg Extension', ['quads'], 'machine', 10),
  ex('lunge', 'Walking Lunge', ['quads', 'glutes'], 'dumbbell', 5),
  ex('reverse-lunge', 'Reverse Lunge', ['quads', 'glutes'], 'dumbbell', 5),
  ex('bulgarian-split-squat', 'Bulgarian Split Squat', ['quads', 'glutes'], 'dumbbell', 5),
  ex('step-up', 'Step-up', ['quads', 'glutes'], 'dumbbell', 5),
  ex('sissy-squat', 'Sissy Squat', ['quads'], 'bodyweight'),
  ex('box-jump', 'Box Jump', ['quads', 'glutes'], 'bodyweight'),
  // hamstrings / glutes
  ex('rdl', 'Romanian Deadlift', ['hamstrings', 'glutes', 'back'], 'barbell', 10),
  ex('db-rdl', 'Dumbbell Romanian Deadlift', ['hamstrings', 'glutes'], 'dumbbell', 5),
  ex('sumo-deadlift', 'Sumo Deadlift', ['glutes', 'hamstrings', 'quads'], 'barbell', 10),
  ex('leg-curl', 'Lying Leg Curl', ['hamstrings'], 'machine', 5),
  ex('seated-leg-curl', 'Seated Leg Curl', ['hamstrings'], 'machine', 5),
  ex('nordic-curl', 'Nordic Curl', ['hamstrings'], 'bodyweight'),
  ex('good-morning', 'Good Morning', ['hamstrings', 'back', 'glutes'], 'barbell', 5),
  ex('hip-thrust', 'Barbell Hip Thrust', ['glutes', 'hamstrings'], 'barbell', 10),
  ex('glute-bridge', 'Glute Bridge', ['glutes'], 'bodyweight', 5),
  ex('cable-kickback', 'Cable Glute Kickback', ['glutes'], 'cable', 5),
  ex('hip-abduction', 'Hip Abduction Machine', ['glutes'], 'machine', 10),
  ex('hip-adduction', 'Hip Adduction Machine', ['quads'], 'machine', 10),
  ex('kb-swing', 'Kettlebell Swing', ['glutes', 'hamstrings', 'core'], 'kettlebell', 5),
  // calves
  ex('standing-calf-raise', 'Standing Calf Raise', ['calves'], 'machine', 10),
  ex('seated-calf-raise', 'Seated Calf Raise', ['calves'], 'machine', 5),
  ex('leg-press-calf', 'Leg Press Calf Raise', ['calves'], 'machine', 20),
  ex('db-calf-raise', 'Dumbbell Calf Raise', ['calves'], 'dumbbell', 5),
  // core
  ex('plank', 'Plank', ['core'], 'bodyweight'),
  ex('side-plank', 'Side Plank', ['core'], 'bodyweight'),
  ex('hanging-leg-raise', 'Hanging Leg Raise', ['core'], 'bodyweight'),
  ex('hanging-knee-raise', 'Hanging Knee Raise', ['core'], 'bodyweight'),
  ex('cable-crunch', 'Cable Crunch', ['core'], 'cable', 5),
  ex('ab-wheel', 'Ab Wheel Rollout', ['core'], 'bodyweight'),
  ex('crunch', 'Crunch', ['core'], 'bodyweight'),
  ex('reverse-crunch', 'Reverse Crunch', ['core'], 'bodyweight'),
  ex('russian-twist', 'Russian Twist', ['core'], 'bodyweight'),
  ex('dead-bug', 'Dead Bug', ['core'], 'bodyweight'),
  ex('bird-dog', 'Bird Dog', ['core', 'back'], 'bodyweight'),
  ex('pallof-press', 'Pallof Press', ['core'], 'cable', 5),
  ex('mountain-climber', 'Mountain Climber', ['core', 'cardio'], 'bodyweight'),
  ex('decline-situp', 'Decline Sit-up', ['core'], 'bodyweight', 5),
  ex('farmers-carry', "Farmer's Carry", ['core', 'full'], 'dumbbell', 10),
  ex('suitcase-carry', 'Suitcase Carry', ['core'], 'kettlebell', 5),
  // full body / olympic / kettlebell / band
  ex('power-clean', 'Power Clean', ['full', 'back', 'quads'], 'barbell', 5),
  ex('clean-and-press', 'Clean and Press', ['full', 'shoulders'], 'barbell', 5),
  ex('push-press', 'Push Press', ['shoulders', 'triceps', 'quads'], 'barbell', 5),
  ex('thruster', 'Thruster', ['full', 'quads', 'shoulders'], 'barbell', 5),
  ex('kb-clean', 'Kettlebell Clean', ['full'], 'kettlebell', 5),
  ex('kb-snatch', 'Kettlebell Snatch', ['full', 'shoulders'], 'kettlebell', 5),
  ex('kb-goblet-squat', 'Kettlebell Goblet Squat', ['quads', 'glutes'], 'kettlebell', 5),
  ex('turkish-getup', 'Turkish Get-up', ['full', 'core', 'shoulders'], 'kettlebell', 5),
  ex('burpee', 'Burpee', ['full', 'cardio'], 'bodyweight'),
  ex('band-pull-apart', 'Band Pull-Apart', ['shoulders', 'back'], 'band'),
  ex('band-row', 'Band Row', ['back', 'biceps'], 'band'),
  ex('band-face-pull', 'Band Face Pull', ['shoulders', 'back'], 'band'),
  ex('band-squat', 'Band Squat', ['quads', 'glutes'], 'band'),
  ex('band-curl', 'Band Curl', ['biceps'], 'band'),
  ex('band-pushdown', 'Band Pushdown', ['triceps'], 'band'),
  ex('band-lateral-walk', 'Band Lateral Walk', ['glutes'], 'band'),
  ex('wall-ball', 'Wall Ball', ['full', 'quads', 'shoulders'], 'bodyweight', 2),
  ex('sled-push', 'Sled Push', ['full', 'quads', 'glutes'], 'machine', 25),
  ex('battle-ropes', 'Battle Ropes', ['full', 'cardio', 'shoulders'], 'bodyweight'),
  // cardio (weight = minutes, reps = intensity/level — logged loosely)
  ex('treadmill', 'Treadmill', ['cardio'], 'cardio', undefined, 'cardio'),
  ex('incline-walk', 'Incline Walk', ['cardio'], 'cardio', undefined, 'cardio'),
  ex('running', 'Running (outdoor)', ['cardio'], 'cardio', undefined, 'cardio'),
  ex('cycling', 'Stationary Bike', ['cardio', 'quads'], 'cardio', undefined, 'cardio'),
  ex('rowing', 'Rowing Machine', ['cardio', 'back'], 'cardio', undefined, 'cardio'),
  ex('elliptical', 'Elliptical', ['cardio'], 'cardio', undefined, 'cardio'),
  ex('stair-climber', 'Stair Climber', ['cardio', 'glutes'], 'cardio', undefined, 'cardio'),
  ex('jump-rope', 'Jump Rope', ['cardio', 'calves'], 'cardio', undefined, 'cardio'),
  ex('assault-bike', 'Assault Bike', ['cardio', 'full'], 'cardio', undefined, 'cardio'),
  ex('swimming', 'Swimming', ['cardio', 'full'], 'cardio', undefined, 'cardio'),
  ex('walking', 'Walking', ['cardio'], 'cardio', undefined, 'cardio'),
  ex('hiit', 'HIIT Circuit', ['cardio', 'full'], 'cardio', undefined, 'cardio'),
];

export const MUSCLES: { id: Muscle; label: string }[] = [
  { id: 'chest', label: 'Chest' }, { id: 'back', label: 'Back' }, { id: 'shoulders', label: 'Shoulders' }, { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' }, { id: 'quads', label: 'Quads' }, { id: 'hamstrings', label: 'Hamstrings' }, { id: 'glutes', label: 'Glutes' },
  { id: 'calves', label: 'Calves' }, { id: 'core', label: 'Core' }, { id: 'full', label: 'Full body' }, { id: 'cardio', label: 'Cardio' },
];
export const muscleLabel = (m: Muscle) => MUSCLES.find(x => x.id === m)?.label || m;

/** Lower-body compound lifts progress in bigger jumps. */
export const LOWER: Muscle[] = ['quads', 'hamstrings', 'glutes'];
export const isLower = (e: Pick<Exercise, 'muscles'>) => LOWER.includes(e.muscles[0]);

export function findExercise(id: string, custom: Exercise[] = []): Exercise | undefined {
  return custom.find(e => e.id === id) || LIBRARY.find(e => e.id === id);
}

export function searchExercises(q: string, custom: Exercise[] = []): Exercise[] {
  const all = [...custom, ...LIBRARY];
  const s = q.trim().toLowerCase();
  if (!s) return all;
  return all.filter(e => e.name.toLowerCase().includes(s) || e.muscles.some(m => m.includes(s)) || e.equipment.includes(s));
}
