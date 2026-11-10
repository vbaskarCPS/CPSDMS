// src/planner/demo/seed.ts — the demo's sample household: a few days of Vijay's planner, all in memory.
// Nothing here touches Supabase; the demo at /demo reads and writes this store only.
import { dayKey } from '../lib/docs';

const addDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const iso = (key: string, hm: string) => new Date(`${key}T${hm}:00`).toISOString();

export type SeedDoc = { kind: string; key: string; data: unknown };

export function demoSeed(): SeedDoc[] {
  const today = dayKey();
  const y1 = addDays(today, -1), y2 = addDays(today, -2), y3 = addDays(today, -3), t1 = addDays(today, 1), t3 = addDays(today, 3);
  const docs: SeedDoc[] = [];
  const put = (kind: string, key: string, data: unknown) => docs.push({ kind, key, data });

  // ── days: three finished ones and today, half-way through
  const day = (key: string, over: Record<string, unknown>) => ({
    brief: { word: 'Present', aGame: 'Kiaan — undivided attention at bath time', stress: 'The client portal bug', stressResponse: 'Reproduce it first, then one fix at a time', excited: 'Gym with the boys', startedAt: iso(key, '08:34'), finishedAt: iso(key, '08:41'), seconds: 420 },
    ticks: { up: '08:33', dinner: '18:10', gym: '21:05', sauna: '22:20', shake: '23:02', lightsOut: '00:58' },
    night: { review: { win: 'Shipped the portal fix before lunch', drag: 'Phone at the dinner table', tomorrow: 'Phone stays in the kitchen at dinner' }, tomorrowTop: 'Send the Q4 proposal' },
    scores: { clarity: 4, energy: 3, necessity: 4, productivity: 4, influence: 3, courage: 4 },
    todos: [
      { id: `${key}-1`, text: 'Send the Q4 proposal', done: true, must: true, time: '10:00', from: 'coach' },
      { id: `${key}-2`, text: 'Reproduce the portal bug, then one fix at a time', done: true, from: 'coach', note: 'defuses the stress' },
      { id: `${key}-3`, text: 'Kiaan → daycare', done: true, time: '09:30', from: 'coach' },
      { id: `${key}-4`, text: 'Call Mum back', done: true, from: 'me' },
    ],
    priorities: [{ text: 'Send the Q4 proposal', done: true }, { text: '', done: false }, { text: '', done: false }],
    ...over,
  });
  put('day', y3, day(y3, {}));
  put('day', y2, day(y2, { scores: { clarity: 3, energy: 3, necessity: 4, productivity: 3, influence: 4, courage: 3 } }));
  put('day', y1, day(y1, { protein: { slots: [
    { id: 'ps1', kind: 'shake', label: 'Shake 1', time: '06:50', what: 'Protein shake × 2', protein: 50, kcal: 260, eaten: 'x' },
    { id: 'ps2', kind: 'meal', label: 'Meal 1', time: '09:00', what: 'Greek yogurt egg bowl', protein: 42, kcal: 520, recipeId: 'r2', servings: 1, eaten: 'x' },
    { id: 'ps3', kind: 'shake', label: 'Shake 2', time: '11:30', what: 'Protein shake × 2', protein: 50, kcal: 260, eaten: 'x' },
    { id: 'ps4', kind: 'meal', label: 'Meal 2', time: '13:15', what: 'Tandoori chicken thighs & rice', protein: 48, kcal: 640, recipeId: 'r1', servings: 1 },
  ] }, ticks: { up: '08:40', dinner: '18:05', gym: '21:10', sauna: '22:25', shake: '23:00', lightsOut: '01:05' }, reflection: "You kept the fast, trained, and still got the proposal out — that's the day working. The 1:05 lights-out is the one thing to pull back: it's where tomorrow's energy comes from. Tonight, phone in the kitchen at 12:45." }));
  put('day', today, {
    // started a few minutes ago, so the Brief page shows a live timer rather than hours of overtime
    brief: { word: 'Steady', aGame: 'Rosh — plan the weekend together', stress: 'Three calls back to back', stressResponse: 'Five minutes between them, standing up', excited: 'Mobility night — hips need it', startedAt: new Date(Date.now() - 3 * 60_000).toISOString(), finishedAt: new Date().toISOString(), seconds: 480 },
    ticks: { up: '08:31' },
    night: { review: { win: '', drag: '', tomorrow: '' } },
    scores: {},
    todos: [
      { id: 'td-1', text: 'Finish the client portal release notes', done: true, must: true, time: '10:00', from: 'coach' },
      { id: 'td-2', text: 'Kiaan → daycare', done: true, time: '09:30', from: 'coach' },
      { id: 'td-3', text: 'Three calls — stand up between them', done: false, must: true, time: '13:00', from: 'coach', note: 'the stress you named' },
      { id: 'td-4', text: 'Plan the weekend with Rosh', done: false, from: 'coach', note: 'A-game' },
      { id: 'td-5', text: 'Pay the daycare invoice', done: false, from: 'me' },
      { id: 'td-6', text: 'Pick up the dry cleaning', done: false, must: false, time: '16:30', from: 'me' },
    ],
    priorities: [{ text: 'Finish the client portal release notes', done: true }, { text: 'Three calls — stand up between them', done: false }, { text: '', done: false }],
  });

  // ── habits + two weeks of marks
  const habits = [
    { id: 'h-brief', name: 'Bed Brief before getting up', identity: 'someone who decides the day before the day decides him', cue: { time: '08:30', place: 'in bed' }, stack: 'After I wake up with Kiaan', twoMinute: 'Write one word and one priority', why: 'Ten minutes in bed beats a day on autopilot.', days: [0, 1, 2, 3, 4, 5, 6], createdAt: iso(addDays(today, -20), '09:00'), order: 0, auto: 'brief', anchor: { block: 'wake', when: 'after' } },
    { id: 'h-fast', name: 'No food before 6', identity: 'someone who eats with intention', cue: { time: '18:00', place: 'kitchen' }, stack: '', twoMinute: 'Drink a glass of water instead', why: 'The fast keeps the day simple and dinner satisfying.', days: [0, 1, 2, 3, 4, 5, 6], createdAt: iso(addDays(today, -20), '09:00'), order: 1, auto: 'fast', anchor: { block: 'dinner', when: 'before' } },
    { id: 'h-read', name: 'Read 10 pages', identity: 'someone who learns a little every day', cue: { time: '23:10', place: 'the couch' }, stack: 'After I finish the shake', twoMinute: 'Open the book and read one paragraph', why: 'Fifty books a year, ten pages at a time.', days: [0, 1, 2, 3, 4, 5, 6], createdAt: iso(addDays(today, -12), '09:00'), order: 2, anchor: { block: 'shake', when: 'after' } },
    { id: 'h-lights', name: 'Lights out by 1', identity: 'someone who protects his mornings the night before', cue: { time: '01:00', place: 'bedroom' }, stack: 'After the evening review', twoMinute: 'Phone on the charger, face down', why: 'Kiaan wakes at 8 either way.', days: [0, 1, 2, 3, 4, 5, 6], createdAt: iso(addDays(today, -20), '09:00'), order: 3, auto: 'lightsOut', anchor: { block: 'unwind', when: 'after' } },
  ];
  habits.forEach(h => put('habit', h.id, h));
  for (let i = 14; i >= 1; i--) {
    const k = addDays(today, -i);
    put('habitlog', k, { 'h-brief': 'done', 'h-fast': i === 6 ? 'skip' : 'done', 'h-read': i % 4 === 0 ? 'mini' : 'done', 'h-lights': i === 9 ? undefined : 'done' });
  }
  put('habitlog', today, { 'h-brief': 'done' });

  // ── workouts: a template, three finished sessions, today's completed one with the coach's plan
  const tpl = { id: 'tpl-full', name: 'Full body (return)', days: [1, 3, 5], order: 0, exercises: [
    { exerciseId: 'walk', name: 'Walk / bike warm-up', targetSets: 1, targetReps: '', restSec: 0, mode: 'time', targetSec: 300 },
    { exerciseId: 'goblet-squat', name: 'Goblet Squat', targetSets: 3, targetReps: '10-12', restSec: 90, note: 'knees out, heels down' },
    { exerciseId: 'db-bench', name: 'Dumbbell Bench Press', targetSets: 3, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'db-row', name: 'One-arm Dumbbell Row', targetSets: 2, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', targetSets: 2, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'kb-swing', name: 'Kettlebell Swing', targetSets: 2, targetReps: '15', restSec: 60 },
  ] };
  put('template', tpl.id, tpl);
  put('template', 'tpl-tomorrow', { id: 'tpl-tomorrow', name: 'Mobility + easy intervals', order: -1, plannedFor: t1, focus: 'mobility', minutes: 45, exercises: [
    { exerciseId: 'walk', name: 'Walk warm-up', targetSets: 1, targetReps: '', restSec: 0, mode: 'time', targetSec: 300 },
    { exerciseId: 'mobility-flow', name: 'Mobility Flow', targetSets: 2, targetReps: '', restSec: 30, mode: 'time', targetSec: 480, note: 'Hip flexor stretch, 90/90 hip rotations, glute bridges' },
    { exerciseId: 'bike-intervals', name: 'Bike intervals 20s on / 40s off', targetSets: 8, targetReps: '', restSec: 40, mode: 'time', targetSec: 20, note: 'easy pace, breathe through the nose' },
    { exerciseId: 'stretching', name: 'Stretching', targetSets: 1, targetReps: '', restSec: 0, mode: 'time', targetSec: 420, note: 'Hold each 30-45 s. Hips and calves.' },
  ] });
  const session = (key: string, id: string, start: string, end: string, w: [number, number][], extra: Record<string, unknown> = {}) => ({
    id, date: key, startedAt: iso(key, start), endedAt: iso(key, end), templateId: tpl.id, name: tpl.name,
    exercises: [
      { exerciseId: 'walk', name: 'Walk / bike warm-up', restSec: 0, mode: 'time', sets: [{ weight: 0, reps: 0, seconds: 300, done: true }] },
      { exerciseId: 'goblet-squat', name: 'Goblet Squat', restSec: 90, targetReps: '10-12', note: 'knees out, heels down', sets: [1, 2, 3].map(() => ({ weight: w[0][0], reps: w[0][1], done: true })), comment: 'Felt solid, knees fine' },
      { exerciseId: 'db-bench', name: 'Dumbbell Bench Press', restSec: 90, targetReps: '8-12', sets: [1, 2, 3].map(() => ({ weight: w[1][0], reps: w[1][1], done: true })) },
      { exerciseId: 'db-row', name: 'One-arm Dumbbell Row', restSec: 90, targetReps: '8-12', sets: [1, 2].map(() => ({ weight: w[2][0], reps: w[2][1], repsR: w[2][1], done: true })), comment: 'Left side a rep short' },
      { exerciseId: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', restSec: 90, targetReps: '8-12', sets: [1, 2].map(() => ({ weight: w[3][0], reps: w[3][1], done: true })) },
      { exerciseId: 'kb-swing', name: 'Kettlebell Swing', restSec: 60, targetReps: '15', sets: [1, 2].map(() => ({ weight: 40, reps: 15, done: true })) },
    ],
    ...extra,
  });
  put('workout', `${addDays(today, -6)}~w1`, session(addDays(today, -6), 'w1', '21:05', '21:58', [[35, 12], [25, 12], [25, 10], [25, 9]]));
  put('workout', `${addDays(today, -4)}~w2`, session(addDays(today, -4), 'w2', '21:02', '21:55', [[40, 12], [30, 11], [25, 12], [30, 8]]));
  put('workout', `${y2}~w3`, session(y2, 'w3', '21:08', '22:01', [[40, 12], [30, 13], [30, 11], [30, 9]], { prs: ['Goblet Squat: 40 × 12 (e1RM 56)'] }));
  put('workout', `${today}~w4`, session(today, 'w4', '21:04', '21:57', [[45, 11], [30, 13], [30, 12], [30, 10]], {
    notes: 'Good energy. Right hip a bit tight on squats.',
    review: "Solid return session: goblet squat moved up to 45 lb for 11 clean reps with the knees tracking, bench held 30s for 13, and the one-arm row finally matched left and right at 30 × 12. That's three sessions of steady progress without anything hurting, which is exactly the point right now. The tight right hip is the one flag, so tomorrow isn't another lift: it's a 45-minute mobility night — hip flexor and 90/90 work, glute bridges, then eight easy 20-on/40-off bike intervals to keep building the lungs, and a long stretch to finish. Thursday you're back under the dumbbells with the squat at 45 again and bench trying 35.",
    next: { 'goblet-squat': { weight: 45, reps: 12, sets: 3, restSec: 90, cue: 'Same 45 — own all 12 before 50' }, 'db-bench': { weight: 35, reps: 10, sets: 3, restSec: 90, cue: 'Up to 35s, slow on the way down' }, 'db-row': { weight: 30, reps: 12, repsR: 12, sets: 2, restSec: 90, cue: 'Left leads; pull to the hip' } },
  }));
  put('dayplan', today, {
    review: "Solid return session: goblet squat moved up to 45 lb for 11 clean reps with the knees tracking, bench held 30s for 13, and the one-arm row finally matched left and right at 30 × 12. Three sessions of steady progress without anything hurting — exactly the point right now.\n\nThe tight right hip is the one flag, so tomorrow isn't another lift: a 45-minute mobility night — hip flexor and 90/90 work, glute bridges, then eight easy 20-on/40-off bike intervals for the lungs, and a long stretch to finish. Thursday you're back under the dumbbells.",
    questions: [{ id: 'hip', text: 'How does the right hip feel now?', choices: ['Fine', 'A bit tight', 'Sore', 'Painful'] }, { id: 'time', text: 'How long have you got tomorrow?', choices: ['30 min', '45 min', '60+ min'] }],
    tomorrow: { name: 'Mobility + easy intervals', focus: 'mobility', minutes: 45, why: 'Loosen the hip and keep the lungs working without loading the joints.', exercises: [
      { name: 'Walk warm-up', mode: 'time', sets: 1, seconds: 300, restSec: 0 },
      { name: 'Mobility Flow', mode: 'time', sets: 2, seconds: 480, restSec: 30, note: 'Hip flexor stretch, 90/90 hip rotations, glute bridges' },
      { name: 'Bike intervals 20s on / 40s off', mode: 'time', sets: 8, seconds: 20, restSec: 40, note: 'easy pace, breathe through the nose' },
      { name: 'Stretching', mode: 'time', sets: 1, seconds: 420, restSec: 0, note: 'Hold each 30-45 s. Hips and calves.' },
    ] },
    madeAt: iso(today, '22:05'),
  });
  put('bodyweight', addDays(today, -14), { weight: 192 });
  put('bodyweight', addDays(today, -7), { weight: 190.5 });
  put('bodyweight', today, { weight: 189 });

  // ── food: today's dinner, yesterday's two meals, targets
  put('foodprefs', 'targets', { kcal: 2200, protein: 180 });
  put('recipe', 'r1', { id: 'r1', name: 'Tandoori chicken thighs & rice', servings: 4, minutes: 35, perServing: { kcal: 640, protein: 48, carbs: 62, fat: 20 }, createdAt: iso(today, '07:00'),
    ingredients: [{ qty: 2, unit: 'lb', item: 'boneless skinless chicken thighs', section: 'Meat & Seafood' }, { qty: 1, unit: 'cup', item: 'plain Greek yogurt', section: 'Dairy & Eggs' }, { qty: 2, unit: 'tbsp', item: 'tandoori masala', section: 'Pantry', pantry: true }, { qty: 1, item: 'lemon', note: 'juiced', section: 'Produce' }, { qty: 4, unit: 'clove', item: 'garlic', note: 'grated', section: 'Produce' }, { qty: 2, unit: 'cup', item: 'basmati rice', note: 'rinsed', section: 'Pantry' }, { qty: 1, unit: 'tbsp', item: 'cooking oil', section: 'Pantry', pantry: true }, { item: 'salt', section: 'Pantry', pantry: true }],
    steps: ['Mix the yogurt, masala, lemon, garlic and salt; coat the chicken and leave 15 minutes (or overnight).', 'Cook the rice.', 'Sear the chicken in the oil, 6 minutes a side, until 165°F inside.', 'Rest 5 minutes, slice, serve over the rice.'] });
  put('recipe', 'r2', { id: 'r2', name: 'Greek yogurt egg bowl', servings: 1, minutes: 10, perServing: { kcal: 520, protein: 42, carbs: 30, fat: 24 }, createdAt: iso(today, '07:00'),
    ingredients: [{ qty: 3, unit: 'large', item: 'eggs', section: 'Dairy & Eggs' }, { qty: 0.75, unit: 'cup', item: 'plain Greek yogurt', section: 'Dairy & Eggs' }, { qty: 1, item: 'pita', section: 'Bakery' }, { qty: 0.5, item: 'cucumber', note: 'diced', section: 'Produce' }, { item: 'chili flakes', section: 'Pantry', pantry: true }],
    steps: ['Fry or poach the eggs.', 'Spread the yogurt in a bowl, top with the eggs, cucumber and chili flakes.', 'Warm the pita and eat.'] });
  const meal = (key: string, time: string, id: string, name: string, kcal: number, protein: number, carbs: number, fat: number) => put('meal', `${key}~${time}~${id}`, { id, date: key, time, name, items: [{ name, portion: '1 plate', kcal, protein, carbs, fat, confidence: 'medium' }], totals: { kcal, protein, carbs, fat }, source: 'photo' });
  meal(y1, '18:10', 'm1', 'Chicken thighs, rice, salad', 720, 52, 68, 24);
  meal(y1, '23:02', 'm2', 'Protein shake', 240, 40, 12, 4);
  meal(today, '18:12', 'm3', 'Butter chicken, basmati, cucumber', 860, 48, 92, 30);

  // ── calendar, shopping, memory
  put('event', `${t1}~e1`, { id: 'e1', title: "Kiaan's swim lesson", date: t1, time: '10:30', who: 'kiaan', createdAt: iso(today, '09:00') });
  put('event', `${t3}~e2`, { id: 'e2', title: "Dinner at Mum's", date: t3, time: '18:00', who: 'both', notes: 'Bring the dessert', createdAt: iso(today, '09:00') });
  put('event', `${addDays(today, -13)}~e3`, { id: 'e3', title: 'Gym with the boys', date: addDays(today, -13), time: '21:00', who: 'vijay', repeat: 'weekly', createdAt: iso(today, '09:00') });
  put('event', `${addDays(today, 8)}~e4`, { id: 'e4', title: 'Dentist — Rosh', date: addDays(today, 8), time: '14:00', who: 'rosh', createdAt: iso(today, '09:00') });
  const dealAt = new Date(); dealAt.setDate(dealAt.getDate() + 4);
  const validTo = dealAt.toISOString();
  const shop = (id: string, text: string, by: string, section: string, deals: unknown[], extra: Record<string, unknown> = {}) => put('shop', id, { id, text, done: false, by, addedAt: iso(today, '09:10'), section, deals, dealsAt: iso(today, '09:10'), ...extra });
  shop('s1', 'Milk', 'rosh', 'Dairy & Eggs', [{ merchant: 'No Frills', name: 'Neilson 4L Milk', price: 5.49, saleStory: 'SAVE $1.50', validTo, kind: 'flyer' }, { merchant: 'Walmart', name: 'Great Value 4L Milk', price: 5.97, kind: 'regular' }], { qty: '2' });
  shop('s2', 'Chicken thighs', 'vijay', 'Meat & Seafood', [
    { merchant: 'No Frills', name: 'Chicken Thighs, Bone-in, Family Pack', price: 2.99, saleStory: '$2.99/lb', validTo, kind: 'flyer', variant: 'Bone-in', size: 'Family pack', per: 'lb' },
    { merchant: 'Food Basics', name: 'Boneless Skinless Chicken Thighs, Value Pack', price: 4.99, saleStory: '$4.99/lb', validTo, kind: 'flyer', variant: 'Boneless skinless', size: 'Value pack', per: 'lb' },
    { merchant: 'Fortinos', name: 'PC Boneless Skinless Chicken Thighs 6 pc', price: 9.99, validTo, kind: 'flyer', saleStory: 'SAVE $3', variant: 'Boneless skinless', size: '6 pieces (~750 g)', amount: 750, unit: 'g', per: 'each' },
    { merchant: 'Walmart', name: 'Your Fresh Market Boneless Skinless Chicken Thighs 12 pc', price: 17.97, kind: 'regular', variant: 'Boneless skinless', size: '12 pieces (~1.5 kg)', amount: 1500, unit: 'g', per: 'each' },
    { merchant: 'Walmart', name: 'Your Fresh Market Chicken Thighs Bone-in 6 pc', price: 9.47, kind: 'regular', variant: 'Bone-in', size: '6 pieces (~1.1 kg)', amount: 1100, unit: 'g', per: 'each' },
  ]);
  shop('s3', 'AA batteries', 'vijay', 'Hardware & Auto', [{ merchant: 'Canadian Tire', name: 'Duracell AA 16-pack', price: 14.99, saleStory: 'SAVE 40%', validTo, kind: 'flyer' }]);
  shop('s4', 'Basmati rice 10 lb', 'rosh', 'Pantry', [], { suggestedStore: 'Indian grocer', reason: 'bulk basmati, best price' });
  shop('s5', 'Plantain', 'rosh', 'Produce', [], { suggestedStore: 'Caribbean grocer', reason: 'always in stock, ripe' });
  shop('s6', 'Dish soap', 'vijay', 'Household & Cleaning', [{ merchant: 'Walmart', name: 'Dawn Ultra 479 mL', price: 3.47, kind: 'regular' }]);
  put('shopprefs', 'prefs', { postal: 'L8E', stores: ['Walmart', 'Fortinos', 'No Frills', 'Food Basics', 'Canadian Tire'], specialty: [{ name: "Lococo's", note: 'produce & meat, cheap' }, { name: 'Indian grocer', note: 'basmati, atta, dal, spices' }, { name: 'Caribbean grocer', note: 'plantain, scotch bonnet, saltfish' }, { name: 'Middle Eastern grocer', note: 'pita, tahini, halal meat' }] });
  put('memo', 'coach', { notes: [
    { date: addDays(today, -20), by: 'app', text: 'Routine: up ~8:30 with Kiaan, Bed Brief from bed, fast until dinner at 6, gym at 9 pm with friends, sauna, day review, shake at 11, unwind, hard stop 12:45, lights out 1 am.' },
    { date: addDays(today, -20), by: 'you', text: 'Training goals: an everyday habit without overtraining — strength a couple of days a week, beginner HIIT to reclaim my lungs, mobility. Approaching 40, light hip and knee pain. 40–70 min sessions.' },
  ] });
  put('coachchat', 'current', { messages: [
    { role: 'user', content: "How was my workout today?", at: iso(today, '22:10') },
    { role: 'assistant', content: "Good one. Goblet squat went 45 × 11, 11, 10 — first time at 45 and the knees held, so that's the real win. Bench stayed at 30s for 13, 12, 12: ready for 35 next time. One-arm row finally matched sides at 30 × 12. You noted the right hip was tight on squats, which is why tomorrow is a mobility night rather than another lift. Keep the shake at 11 and get the lights out by 1 — Thursday's session is the one you want to be fresh for.", at: iso(today, '22:10') },
  ] });
  put('prefs', 'habitsSeeded', { seeded: true });

  // ── money: a card with this month's charges (yesterday's Costco run is the one the sample receipt matches)
  put('account', 'visa', { id: 'visa', name: 'TD Visa', type: 'credit', last4: '4421', order: 0 });
  const txn = (id: string, date: string, desc: string, merchant: string, amount: number, category: string) =>
    ({ id, date, desc, merchant, amount, accountId: 'visa', category, source: 'builtin' });
  const rows = [
    txn('d1', addDays(today, -6), 'NO FRILLS #3121', 'NO FRILLS', -64.18, 'Groceries'),
    txn('d2', addDays(today, -5), 'TIM HORTONS #2231', 'TIM HORTONS', -6.42, 'Coffee'),
    txn('d3', addDays(today, -4), 'ESSO 7741', 'ESSO', -58.5, 'Gas'),
    txn('d4', addDays(today, -3), 'NETFLIX.COM', 'NETFLIX.COM', -20.99, 'Subscriptions'),
    txn('d5', addDays(today, -2), 'SHOPPERS DRUG MART #1022', 'SHOPPERS DRUG MART', -31.6, 'Health'),
    txn('d6', y1, 'COSTCO WHOLESAL W540', 'COSTCO WHOLESAL', -182.37, 'Groceries'),
  ].filter(r => r.date.slice(0, 7) === today.slice(0, 7));
  if (rows.length) put('txns', today.slice(0, 7), { rows });
  return docs;
}
