// src/planner/demo/store.ts — the demo's stand-in for Supabase: planner docs in memory, a fake pass,
// and Arvy's canned replies. Active only at /demo (lib/app.ts isDemo). Nothing persists.
import { demoSeed } from './seed';
import type { PlannerPass } from '../lib/auth';

export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000demo';
export const demoPass: PlannerPass = {
  token: 'demo', expires_at: '2099-01-01T00:00:00.000Z',
  user: { id: DEMO_USER_ID, username: 'demo', display_name: 'Vijay (demo)', settings: { units: 'lb', profile: 'night', wake_time: '08:30' } },
};

type Row = { key: string; data: unknown; updated_at: string };
let store: Map<string, Map<string, Row>> | null = null;

function db() {
  if (!store) {
    store = new Map();
    const at = new Date().toISOString();
    for (const d of demoSeed()) {
      if (!store.has(d.kind)) store.set(d.kind, new Map());
      store.get(d.kind)!.set(d.key, { key: d.key, data: d.data, updated_at: at });
    }
  }
  return store;
}
/** Back to the seeded sample (the tour's "Start over"). */
export function resetDemo() { store = null; }

/** The same contract as the planner_* RPCs, served from memory. */
export function demoCall(fn: string, args: Record<string, unknown>): unknown {
  switch (fn) {
    case 'planner_get': {
      const kind = String(args.p_kind), from = args.p_from as string | null, to = args.p_to as string | null;
      const rows = [...(db().get(kind)?.values() ?? [])].filter(r => (!from || r.key >= from) && (!to || r.key <= to)).sort((a, b) => a.key.localeCompare(b.key));
      return { ok: true, docs: rows };
    }
    case 'planner_put': { put(String(args.p_kind), String(args.p_key), args.p_data); return { ok: true }; }
    case 'planner_put_many': { for (const d of (args.p_docs as { kind: string; key: string; data: unknown }[]) || []) put(d.kind, d.key, d.data); return { ok: true }; }
    case 'planner_me': return { ok: true, user: demoPass.user };
    case 'planner_save_settings': { demoPass.user.settings = { ...demoPass.user.settings, ...(args.p_settings as object) }; return { ok: true, user: demoPass.user }; }
    case 'planner_change_pin': return { ok: true };
    case 'planner_push_subscribe': case 'planner_push_unsubscribe': return { ok: true };
    default: return { ok: true };
  }
}
function put(kind: string, key: string, data: unknown) {
  const m = db().get(kind) ?? new Map<string, Row>();
  db().set(kind, m);
  if (data === null) m.delete(key); else m.set(key, { key, data, updated_at: new Date().toISOString() });
}

const COACH_REPLIES = [
  "Here's how I'd read it: three lifts in a row with the squat climbing and nothing hurting means the plan is working, so the job tomorrow is to leave the joints alone and loosen that right hip. 45 minutes of mobility and easy bike intervals, then Thursday you lift again. Want me to make that tomorrow's session?",
  "Given the hip, I'd keep tomorrow light. Mobility flow twice through — hip flexor stretch, 90/90 rotations, glute bridges — then eight 20-on/40-off bike intervals at an easy pace, breathing through the nose, and a long stretch to finish. About 45 minutes. Say the word and I'll set it up as tomorrow's workout.",
  "You're asking the right question. The answer is yes, but not every day with weights: strength Monday, Wednesday and Friday, mobility or easy intervals on the other days, and one day where the only goal is a walk. That's an everyday habit that doesn't overtrain a body that's approaching 40 and just quit smoking.",
];
let coachIdx = 0;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Arvy, scripted. The demo never calls the real model. */
export async function demoInvoke(body: Record<string, unknown>): Promise<unknown> {
  await delay(700 + Math.random() * 500);
  switch (body.action) {
    case 'coach': return { reply: COACH_REPLIES[coachIdx++ % COACH_REPLIES.length] };
    case 'reflect': return { reply: "You named the three back-to-back calls as today's stress and then stood up between them — that's the whole method: see it in the morning, handle it by the afternoon. The release notes went out, Kiaan got to daycare, and the gym happened at 9 like it always does now. The weekend plan with Rosh is still open; that's the one to carry into tomorrow's Brief." };
    case 'food_text': case 'food_photo': return { items: [{ name: 'Grilled chicken breast', portion: '6 oz', grams: 170, kcal: 280, protein: 52, carbs: 0, fat: 6, confidence: 'high' }, { name: 'Basmati rice', portion: '1 cup cooked', grams: 160, kcal: 210, protein: 4, carbs: 45, fat: 0, confidence: 'medium' }, { name: 'Cucumber salad', portion: '1 cup', grams: 120, kcal: 45, protein: 1, carbs: 6, fat: 2, confidence: 'medium' }], tips: 'Good protein hit for the fast-break. Add the shake at 11 and you land on 160 g.' };
    case 'sway': { const items = (body.items as string[]) || []; return { tags: Object.fromEntries(items.map(i => [i, /shake|chicken|salad|egg|fish/i.test(i) ? 'go' : /fries|soda|cake|chips/i.test(i) ? 'ease' : 'neutral'])) }; }
    case 'briefhints': return { hints: ["You've started the day with the Brief every day for two weeks — that's the habit that holds the rest up.", 'Lights-out crept to 1:05 last night. Tonight the 12:45 alarm is your friend.'], priority: 'Plan the weekend with Rosh', word: 'Steady' };
    case 'todos': return { items: [
      { text: 'Finish the client portal release notes', time: '10:00', must: true, note: 'your top priority' },
      { text: 'Kiaan → daycare', time: '09:30' },
      { text: 'Three calls — stand up between them', time: '13:00', must: true, note: 'the stress you named, with your own answer to it' },
      { text: 'Plan the weekend with Rosh', note: 'A-game' },
      { text: 'Pay the daycare invoice' },
    ] };
    case 'habit': return { name: 'Read 10 pages', identity: 'someone who learns a little every day', anchor: { block: 'shake', when: 'after' }, stack: 'After I finish the protein shake', twoMinute: 'Open the book and read one paragraph', why: 'Fifty books a year, ten pages at a time.', cue: { time: '23:10', place: 'the couch' } };
    case 'dayplan': return { review: 'Already written for today — see the Train page.', questions: [], tomorrow: null };
    case 'exinfo': return { description: 'Sit with one leg bent in front at 90° and the other bent behind at 90°. Keep the chest tall and hinge forward over the front shin, then switch sides.', setup: 'Floor, no equipment. A cushion under the front hip if it is tight.', tip: 'Breathe out as you fold forward; feel the back of the front hip open, not the knee.', mistakes: ['Rounding the back to get lower', 'Letting the back knee lift off the floor'], parts: [
      { name: 'Hip flexor stretch', description: 'Half-kneeling, tuck the tailbone and shift forward until the front of the back hip stretches.', tip: 'Squeeze the back-leg glute — that is what opens the hip.', videos: [{ id: 'dQw4w9WgXcQ', title: 'Hip flexor stretch — 45 s how-to', seconds: 45 }] },
      { name: '90/90 hip rotations', description: 'Both legs at 90°, rotate from one side to the other without using your hands.', tip: 'Slow; the control is the exercise.', videos: [{ id: 'dQw4w9WgXcQ', title: '90/90 hip switch — 60 s', seconds: 58 }] },
      { name: 'Glute bridge', description: 'On your back, heels close, drive the hips up and pause at the top.', tip: 'Ribs down; squeeze the glutes, not the lower back.', videos: [{ id: 'dQw4w9WgXcQ', title: 'Glute bridge form — 40 s', seconds: 41 }] },
    ], videos: [{ id: 'dQw4w9WgXcQ', title: 'Mobility flow for tight hips — 3 min', seconds: 185 }] };
    case 'deals': return { items: [], specialty: [] };
    case 'receipt': {
      const d = new Date(`${String(body.today || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}T12:00:00`); d.setDate(d.getDate() - 1);
      return { kind: 'receipt', merchant: 'Costco Wholesale', date: d.toISOString().slice(0, 10), time: '14:12', total: 182.37, subtotal: 171.9, tax: 10.47, tip: 0, payment: 'card', card_last4: '4421',
        items: [{ name: 'KS Organic Eggs 24ct', amount: 9.99, category: 'Groceries' }, { name: 'Chicken Thighs 2.4 kg', amount: 24.89, category: 'Groceries' }, { name: 'Basmati Rice 10 kg', amount: 21.99, category: 'Groceries' },
          { name: 'Greek Yogurt 2 kg', amount: 7.49, category: 'Groceries' }, { name: 'Bananas', amount: 1.99, category: 'Groceries' }, { name: 'KS Paper Towels 12', amount: 23.99, category: 'Shopping' },
          { name: 'Tide Pods 104', amount: 29.99, category: 'Shopping' }, { name: 'Kids Snow Boots', amount: 29.99, category: 'Kids' }, { name: 'Strawberries 2 lb', amount: 6.99, category: 'Groceries' }, { name: 'Almond Milk 3 pk', amount: 14.59, category: 'Groceries' }],
        category: 'Groceries', confidence: 'high', confidence_note: '' };
    }
    case 'plan': return { name: 'Coach plan', exercises: [] };
    case 'recipe': case 'recipe_idea': return { name: body.action === 'recipe' ? 'Chicken shawarma bowls' : 'Lemon garlic salmon & lentils', servings: 2, minutes: 30, source: typeof body.url === 'string' ? body.url : undefined,
      perServing: { kcal: 610, protein: Number(body.protein) || 52, carbs: 48, fat: 22 },
      ingredients: [{ qty: 1.5, unit: 'lb', item: 'boneless skinless chicken thighs', section: 'Meat & Seafood', pantry: false }, { qty: 1, unit: 'cup', item: 'plain Greek yogurt', section: 'Dairy & Eggs', pantry: false }, { qty: 2, item: 'pitas', section: 'Bakery', pantry: false }, { qty: 1, item: 'cucumber', section: 'Produce', pantry: false }, { qty: 1, unit: 'tbsp', item: 'shawarma spice', section: 'Pantry', pantry: true }, { qty: 1, unit: 'tbsp', item: 'olive oil', section: 'Pantry', pantry: true }],
      steps: ['Toss the chicken with the spice and oil.', 'Roast at 425°F for 20 minutes.', 'Slice and serve with the yogurt, cucumber and warm pitas.'] };
    default: return {};
  }
}
