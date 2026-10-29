// src/lib/littleLessons/levels.ts — every level of Little Lessons, in order, for each subject:
//   chess  the Little Chess lessons (names → guessing games → moves → eating), told by the pieces
//   words  sight words with Ollie the Owl, five new words a level, more choices and look-alikes later
//   math   counting with Benny the Bear (counting, then counting to add, then counting to take away),
//          then Zip the Robot's number machine (real addition, then real subtraction)
// Each level has a character, a little story told the first time the level shows up, and makes its own
// questions (fresh numbers and boards each time). Pure data; the page draws it.
import { LESSONS, WORD as PIECE_WORD, makeBoard, type Piece, type Round } from '../littleChess/lessons';
import { WORD_GROUPS, lookAlikes } from './words';

export type Subject = 'chess' | 'words' | 'math';
export const SUBJECTS: Subject[] = ['chess', 'words', 'math'];
export const SUBJECT_LABEL: Record<Subject, string> = { chess: 'Chess', words: 'Sight words', math: 'Math' };

/** Who's on screen: a chess piece, or one of the lesson friends. */
export type Friend = 'ollie' | 'benny' | 'zip';
export type Cast = Piece | Friend;
export const FRIEND_NAME: Record<Friend, string> = { ollie: 'OLLIE', benny: 'BENNY', zip: 'ZIP' };

export type MathRound =
  | { kind: 'count'; n: number; thing: string; options: number[]; dots: boolean }
  | { kind: 'countAdd'; a: number; b: number; thing: string; options: number[] }
  | { kind: 'countSub'; a: number; b: number; thing: string; options: number[] }
  | { kind: 'add' | 'sub'; a: number; b: number; options: number[] };
export type WordRound = { kind: 'sight'; word: string; options: string[] };
export type Question = (Round | WordRound | MathRound) & { level: string; subject: Subject; cast: Cast };

export type Story = { lines: string[]; said: string };
export type Level = {
  id: string; subject: Subject; title: string; cast: Cast; story: Story;
  /** a question for this level; `k` counts how many it has asked before (to take turns through a lesson) */
  make: (rand: () => number, k: number) => Question;
};

// ── helpers ──
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pickOne = <T,>(rand: () => number, xs: T[]): T => xs[Math.floor(rand() * xs.length)];
export function shuffle<T>(rand: () => number, xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const between = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Three number choices: the answer and two close to it (never below `min`: counting starts at 1). */
export function numberChoices(rand: () => number, answer: number, count = 3, min = 0): number[] {
  const near = shuffle(rand, [answer - 1, answer + 1, answer - 2, answer + 2, answer + 3].filter(n => n >= min && n !== answer));
  return shuffle(rand, [answer, ...near.slice(0, count - 1)]);
}

// ── chess: one level per Little Chess lesson; a question is one of its rounds (fresh boards each time) ──
const CHESS_STORY: Record<string, Story> = {
  'names-rook': { lines: ['THIS IS ROOK.', 'ROOK IS A BIG CASTLE.'], said: "Once upon a time, in the Chess Kingdom, there lived a strong castle tower called Rook. Rook keeps everyone safe. Let's meet Rook!" },
  'names-knight': { lines: ['THIS IS KNIGHT.', 'KNIGHT IS A HORSE.'], said: "Clip clop! Here comes Knight, the bounciest horse in the kingdom. Knight loves to jump over things. Let's meet Knight!" },
  'names-king': { lines: ['THIS IS KING.', 'KING HAS A CROSS.'], said: "This is the King. He wears a crown with a little cross on top, and he gives the best hugs in the whole kingdom. Let's meet the King!" },
  'names-queen': { lines: ['THIS IS QUEEN.', 'QUEEN HAS A CROWN.'], said: "And here is the Queen! Her crown has lots of shiny points. She is the fastest in the kingdom. Let's meet the Queen!" },
  'names-bishop': { lines: ['THIS IS BISHOP.', 'BISHOP HAS A HAT.'], said: "This is Bishop, in a tall pointy hat. Bishop is the kindest helper in the castle. Let's meet Bishop!" },
  'names-pawn': { lines: ['THIS IS PAWN.', 'PAWN IS LITTLE.'], said: "And this is Pawn, the littlest one. Pawn is small, but very, very brave! Let's meet Pawn!" },
  'names-review': { lines: ['ALL SIX!', 'FIND THEM.'], said: "All six friends are here for a party at the castle! Can you find each one?" },
  'mix-find-1': { lines: ['A BIG MIX!'], said: "Oh no! The friends got all mixed up. Can you find the right one?" },
  'mix-find-2': { lines: ['MORE FRIENDS!'], said: "Even more friends came to play. Look carefully and find the right one!" },
  'mix-word-1': { lines: ['READ THE WORD.'], said: "The friends wrote their names on little cards. Can you read them?" },
  'mix-word-2': { lines: ['MORE WORDS!'], said: "More name cards! Which word goes with each friend?" },
  'shadow-1': { lines: ['WHO IS HIDING?'], said: "It's getting dark in the castle. Someone is hiding in the shadows! Who could it be?" },
  'shadow-2': { lines: ['READ AND FIND.'], said: "The shadows are back! This time, find the name card of the friend who is hiding." },
  'peek-1': { lines: ['PEEKABOO!'], said: "Peekaboo! Someone is peeking over the castle wall. Who is it?" },
  'peek-2': { lines: ['PEEK AND READ.'], said: "Peekaboo again! Find the name card for the friend behind the wall." },
  'moves-rook': { lines: ['ROOK GOES STRAIGHT.'], said: "Rook wants to collect the stars! Rook goes straight: up, down, left or right." },
  'moves-bishop': { lines: ['BISHOP CLIMBS STAIRS.'], said: "Bishop loves stairs! Bishop goes corner to corner, and always stays on the same colour." },
  'moves-queen': { lines: ['QUEEN GOES EVERYWHERE.'], said: "The Queen can go straight like Rook, and up the stairs like Bishop. Let's help her get the stars!" },
  'moves-king': { lines: ['KING STEPS ONCE.'], said: "The King is a little sleepy. He takes just one step at a time, any way he likes." },
  'moves-knight': { lines: ['KNIGHT JUMPS L.'], said: "Knight jumps in a big L: two steps, then a turn! Knight can even jump over things." },
  'moves-pawn': { lines: ['PAWN STEPS UP.'], said: "Little Pawn marches forward, one brave step at a time." },
  'eat-rook': { lines: ['ROOK IS HUNGRY!'], said: "Rook is so hungry! Help Rook gobble up the apples. Remember, Rook goes straight." },
  'eat-bishop': { lines: ['BISHOP IS HUNGRY!'], said: "Bishop found an apple tree! Climb the stairs to eat the apples." },
  'eat-queen': { lines: ['QUEEN IS HUNGRY!'], said: "It's the Queen's snack time! She can go everywhere to get the apples." },
  'eat-king': { lines: ['KING IS HUNGRY!'], said: "The King wants apples for his royal lunch. One little step at a time!" },
  'eat-knight': { lines: ['KNIGHT IS HUNGRY!'], said: "Knight is a hungry horse! Jump in an L to munch the apples." },
};

const nice = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();
/** "Meet the King", "King moves", "King eats apples", "Guess: Shadow 2"… */
function chessTitle(l: (typeof LESSONS)[number]): string {
  const who = l.piece ? nice(PIECE_WORD[l.piece]) : '';
  if (l.layer === 'names') return `Meet the ${who}`;
  if (l.layer === 'review') return 'All six pieces';
  if (l.layer === 'moves') return `${who} moves`;
  if (l.layer === 'eat') return `${who} eats apples`;
  return `Guess: ${nice(l.title)} ${l.id.slice(-1)}`;
}

function chessLevel(lessonIndex: number): Level {
  const lesson = LESSONS[lessonIndex];
  const story = CHESS_STORY[lesson.id] || { lines: [lesson.title], said: lesson.title };
  const cast: Cast = lesson.piece || 'king';
  // the hello round is the story's job; after that, take turns through the lesson's rounds
  const rounds = lesson.rounds.filter(r => r.kind !== 'hello');
  return {
    id: `chess:${lesson.id}`, subject: 'chess', title: chessTitle(lesson), cast, story,
    make: (rand, k) => {
      const r = rounds[k % rounds.length];
      const fresh: Round = r.kind === 'board' ? { ...r, ...makeBoard(r.piece, r.targets.length, rand) }
        : r.kind === 'show' ? { ...r, start: makeBoard(r.piece, 1, rand).start }
        : 'options' in r ? { ...r, options: shuffle(rand, r.options) } as Round : r;
      return { ...fresh, level: `chess:${lesson.id}`, subject: 'chess', cast: fresh.kind === 'hello' ? fresh.piece : 'piece' in fresh ? fresh.piece : cast };
    },
  };
}

// ── sight words with Ollie the Owl ──
const PLACES = [
  'IN THE TREE', 'BY THE POND', 'IN THE GRASS', 'UNDER A ROCK', 'IN A NEST', 'ON A LEAF', 'BY THE RIVER', 'IN THE GARDEN',
  'UP THE HILL', 'IN THE SNOW', 'ON THE MOON', 'IN A BOAT', 'BY THE SEA', 'IN THE BARN', 'ON A TRAIN', 'IN THE PARK',
  'IN A CAVE', 'ON A CLOUD', 'IN THE RAIN', 'BY THE FIRE', 'IN THE SAND', 'ON THE BUS', 'IN A BOX', 'AT THE ZOO',
  'IN THE SKY', 'IN THE MUD', 'AT HOME',
];
const PLACE_SAID: Record<string, string> = { 'IN THE TREE': 'way up in the old oak tree', 'BY THE POND': 'by the pond, next to a sleepy frog', 'IN THE GRASS': 'in the tall tickly grass',
  'UNDER A ROCK': 'under a big grey rock', 'IN A NEST': 'in a cozy bird nest', 'ON A LEAF': 'on a giant green leaf', 'BY THE RIVER': 'by the splashy river',
  'IN THE GARDEN': 'in the garden, between the carrots', 'UP THE HILL': 'at the very top of the hill', 'IN THE SNOW': 'in the cold white snow', 'ON THE MOON': 'all the way up on the moon',
  'IN A BOAT': 'in a little red boat', 'BY THE SEA': 'by the sea, in the sand', 'IN THE BARN': 'in the barn, with the cows', 'ON A TRAIN': 'on a choo-choo train',
  'IN THE PARK': 'in the park, under the slide', 'IN A CAVE': 'in a dark echo-y cave', 'ON A CLOUD': 'on a soft fluffy cloud', 'IN THE RAIN': 'in a puddle, in the rain',
  'BY THE FIRE': 'by a warm campfire', 'IN THE SAND': 'in the sandbox', 'ON THE BUS': 'on the big yellow bus', 'IN A BOX': 'in a cardboard box', 'AT THE ZOO': 'at the zoo, with the giraffes',
  'IN THE SKY': 'floating in the sky', 'IN THE MUD': 'in the squishy mud', 'AT HOME': 'right back at home' };

/** How many word cards to pick from at word level `i`, and whether look-alike words are used as wrong answers. */
export const wordChoices = (i: number) => ({ count: i < 3 ? 2 : i < 8 ? 3 : 4, alike: i >= 6 });

function wordLevel(i: number): Level {
  const group = WORD_GROUPS[i];
  const place = PLACES[i % PLACES.length];
  const known = WORD_GROUPS.slice(0, i + 1).flat();
  const shown = group.map(w => w.toUpperCase()).join(', ');
  const story: Story = i === 0
    ? { lines: ['THIS IS OLLIE.', 'OLLIE LOVES WORDS.'], said: `Hoo hoo! This is Ollie the Owl. Ollie loves books more than anything! But oh no, the wind blew the words right out of her book. Let's find them! The first words are: ${group.join(', ')}.` }
    : { lines: [`OLLIE FOUND WORDS ${place}!`, shown], said: `Hoo hoo! Ollie found more words ${PLACE_SAID[place] || place.toLowerCase()}! The new words are: ${group.join(', ')}. Can you find them?` };
  return {
    id: `words:${i + 1}`, subject: 'words', title: `Words ${i + 1}: ${group.join(' ')}`, cast: 'ollie', story,
    make: rand => {
      // mostly this level's new words, sometimes one he met before
      const word = i > 0 && rand() < 0.3 ? pickOne(rand, WORD_GROUPS.slice(0, i).flat()) : pickOne(rand, group);
      const { count, alike } = wordChoices(i);
      const hard = alike ? shuffle(rand, lookAlikes(word).filter(w => known.includes(w))).slice(0, count - 2) : [];
      const rest = shuffle(rand, known.filter(w => w !== word && !hard.includes(w)));
      const options = shuffle(rand, [word, ...hard, ...rest].slice(0, count));
      return { kind: 'sight', word, options, level: `words:${i + 1}`, subject: 'words', cast: 'ollie' };
    },
  };
}

// ── math: Benny the Bear counts; Zip the Robot does real sums ──
type MathSpec = { id: string; kind: MathRound['kind']; title: string; cast: Friend; things: string[]; story: Story;
  nums: (rand: () => number) => { n?: number; a?: number; b?: number } };
const MATH: MathSpec[] = [
  { id: 'count-3', kind: 'count', title: 'Counting to 3', cast: 'benny', things: ['🍓', '🫐'],
    story: { lines: ['THIS IS BENNY.', 'BENNY LOVES BERRIES.'], said: "Hello! This is Benny the Bear. Benny is going berry picking, and he needs a helper to count his berries. Will you help? Touch each berry and count with me!" },
    nums: r => ({ n: between(r, 1, 3) }) },
  { id: 'count-5', kind: 'count', title: 'Counting to 5', cast: 'benny', things: ['🍎', '🍓', '🐞'],
    story: { lines: ['BENNY HAS MORE!', 'COUNT TO 5.'], said: "Benny found a bigger berry bush! Now there are up to five things to count. One, two, three, four, five!" },
    nums: r => ({ n: between(r, 1, 5) }) },
  { id: 'count-8', kind: 'count', title: 'Counting to 8', cast: 'benny', things: ['🐟', '🌟', '🦋'],
    story: { lines: ['BENNY GOES FISHING.'], said: "Benny went fishing at the lake! Splash! Let's count the fish he sees." },
    nums: r => ({ n: between(r, 3, 8) }) },
  { id: 'count-10', kind: 'count', title: 'Counting to 10', cast: 'benny', things: ['🍯', '🐝', '🌻'],
    story: { lines: ['BENNY FOUND HONEY!', 'COUNT TO 10.'], said: "Yum! Benny found a whole row of honey pots! Let's count all the way to ten." },
    nums: r => ({ n: between(r, 1, 10) }) },
  { id: 'count-20', kind: 'count', title: 'Counting to 20', cast: 'benny', things: ['⭐', '🍪', '🎈'],
    story: { lines: ['A BIG PARTY!', 'COUNT TO 20.'], said: "It's Benny's birthday party! There are so many things! Let's count by rows of ten. Ten, and then some more!" },
    nums: r => ({ n: between(r, 10, 20) }) },
  { id: 'cadd-3', kind: 'countAdd', title: 'Counting to add (to 3)', cast: 'benny', things: ['🍓', '🍎'],
    story: { lines: ['BENNY HAS A FRIEND!'], said: "Benny's friend came to visit, and brought more berries! Let's put them together. How many are there in all?" },
    nums: r => { const a = between(r, 1, 2); return { a, b: between(r, 1, 3 - a) }; } },
  { id: 'cadd-5', kind: 'countAdd', title: 'Counting to add (to 5)', cast: 'benny', things: ['🐟', '🍪', '🌟'],
    story: { lines: ['MORE FRIENDS CAME!'], said: "More friends came to the picnic, and everyone brought a snack. Count them all together!" },
    nums: r => { const a = between(r, 1, 4); return { a, b: between(r, 1, 5 - a) }; } },
  { id: 'cadd-10', kind: 'countAdd', title: 'Counting to add (to 10)', cast: 'benny', things: ['🍯', '🎈', '🐞'],
    story: { lines: ['A BIG PICNIC!'], said: "Now it's a giant picnic! Lots and lots of snacks. Put the two piles together and count them all." },
    nums: r => { const a = between(r, 1, 7); return { a, b: between(r, 1, 10 - a) }; } },
  { id: 'csub-5', kind: 'countSub', title: 'Counting to take away (to 5)', cast: 'benny', things: ['🍓', '🍪'],
    story: { lines: ['OH NO, BIRDS!'], said: "Oh no! Some birds came and flew away with Benny's berries! Let's count how many are left." },
    nums: r => { const a = between(r, 2, 5); return { a, b: between(r, 1, a - 1) }; } },
  { id: 'csub-10', kind: 'countSub', title: 'Counting to take away (to 10)', cast: 'benny', things: ['🍯', '🍎', '🐟'],
    story: { lines: ['BENNY ATE SOME!'], said: "Benny was so hungry, he ate some of his snacks! Yum. How many are left now?" },
    nums: r => { const a = between(r, 3, 10); return { a, b: between(r, 1, a - 1) }; } },
  { id: 'add-5', kind: 'add', title: 'Addition to 5', cast: 'zip',
    things: [], story: { lines: ['THIS IS ZIP.', 'ZIP LOVES NUMBERS.'], said: "Beep boop! This is Zip the Robot. Zip has a number machine! Put two numbers in, and the machine adds them up. Can you help Zip find the answer?" },
    nums: r => { const a = between(r, 0, 4); return { a, b: between(r, 1, 5 - a) }; } },
  { id: 'add-10', kind: 'add', title: 'Addition to 10', cast: 'zip', things: [],
    story: { lines: ['ZIP GOES FASTER!'], said: "Zip's machine got an upgrade! Now it adds bigger numbers, all the way to ten. Beep beep!" },
    nums: r => { const a = between(r, 1, 9); return { a, b: between(r, 1, 10 - a) }; } },
  { id: 'add-20', kind: 'add', title: 'Addition to 20', cast: 'zip', things: [],
    story: { lines: ['A ROCKET!', 'ZIP GOES UP!'], said: "Zip built a rocket! To fly it, we need to add numbers all the way to twenty. Three, two, one, blast off!" },
    nums: r => { const a = between(r, 2, 15); return { a, b: between(r, 1, 20 - a) }; } },
  { id: 'sub-5', kind: 'sub', title: 'Subtraction to 5', cast: 'zip', things: [],
    story: { lines: ['ZIP TAKES AWAY.'], said: "Zip's machine can take away too! Put in a number, take some away, and see what's left. Beep boop!" },
    nums: r => { const a = between(r, 1, 5); return { a, b: between(r, 0, a) }; } },
  { id: 'sub-10', kind: 'sub', title: 'Subtraction to 10', cast: 'zip', things: [],
    story: { lines: ['ZIP IS A CHEF!'], said: "Zip is cooking cookies! Some got eaten. Take them away and find what's left, up to ten." },
    nums: r => { const a = between(r, 2, 10); return { a, b: between(r, 1, a) }; } },
  { id: 'sub-20', kind: 'sub', title: 'Subtraction to 20', cast: 'zip', things: [],
    story: { lines: ['ZIP IN SPACE!'], said: "Zip is flying through space, and the rocket is using up fuel. Take away, all the way from twenty!" },
    nums: r => { const a = between(r, 5, 20); return { a, b: between(r, 1, Math.min(a, 10)) }; } },
];

function mathLevel(s: MathSpec): Level {
  return {
    id: `math:${s.id}`, subject: 'math', title: s.title, cast: s.cast, story: s.story,
    make: rand => {
      const x = s.nums(rand), base = { level: `math:${s.id}`, subject: 'math' as const, cast: s.cast };
      const thing = s.things.length ? pickOne(rand, s.things) : '';
      if (s.kind === 'count') return { kind: 'count', n: x.n!, thing, options: numberChoices(rand, x.n!, 3, 1), dots: s.id === 'count-3' || s.id === 'count-5', ...base };
      const ans = s.kind === 'countAdd' || s.kind === 'add' ? x.a! + x.b! : x.a! - x.b!;
      if (s.kind === 'countAdd' || s.kind === 'countSub') return { kind: s.kind, a: x.a!, b: x.b!, thing, options: numberChoices(rand, ans, 3, s.kind === 'countAdd' ? 1 : 0), ...base };
      return { kind: s.kind as 'add' | 'sub', a: x.a!, b: x.b!, options: numberChoices(rand, ans), ...base };
    },
  };
}

export const LEVELS: Record<Subject, Level[]> = {
  chess: LESSONS.map((_, i) => chessLevel(i)),
  words: WORD_GROUPS.map((_, i) => wordLevel(i)),
  math: MATH.map(mathLevel),
};
export const levelById = (id: string): Level | undefined => SUBJECTS.flatMap(s => LEVELS[s]).find(l => l.id === id);

/** The right answer to a question (for checking taps and for tests). */
export function answerOf(q: Question): number | string | null {
  switch (q.kind) {
    case 'count': return q.n;
    case 'countAdd': case 'add': return q.a + q.b;
    case 'countSub': case 'sub': return q.a - q.b;
    case 'sight': return q.word;
    default: return null;
  }
}

// ── what's shown and said ──
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export const numberWord = (n: number) => NUM_WORD[n] ?? String(n);
const THING_NAME: Record<string, string> = { '🍓': 'berries', '🫐': 'blueberries', '🍎': 'apples', '🐞': 'ladybugs', '🐟': 'fish', '🌟': 'stars', '⭐': 'stars', '🦋': 'butterflies',
  '🍯': 'honey pots', '🐝': 'bees', '🌻': 'sunflowers', '🍪': 'cookies', '🎈': 'balloons' };
export const thingName = (t: string) => THING_NAME[t] || 'things';

/** A new-kind question's sentence on screen (short sight words) and what's said out loud. */
export function lessonLine(q: Question): { text: string; said: string } | null {
  switch (q.kind) {
    case 'sight': return { text: 'FIND THE WORD.', said: `Find the word: ${q.word}. ${q.word}.` };
    case 'count': return { text: 'HOW MANY?', said: `How many ${thingName(q.thing)}? Count them!` };
    case 'countAdd': return { text: 'HOW MANY IN ALL?', said: `${cap(numberWord(q.a))} ${thingName(q.thing)}, and ${numberWord(q.b)} more. How many in all?` };
    case 'countSub': return { text: 'HOW MANY ARE LEFT?', said: `There were ${numberWord(q.a)} ${thingName(q.thing)}. ${cap(numberWord(q.b))} went away. How many are left?` };
    case 'add': return { text: `${q.a} + ${q.b} = ?`, said: `What is ${numberWord(q.a)} plus ${numberWord(q.b)}?` };
    case 'sub': return { text: `${q.a} − ${q.b} = ?`, said: `What is ${numberWord(q.a)} take away ${numberWord(q.b)}?` };
    default: return null;
  }
}
/** A wrong tap on a new-kind question: say what he tapped, so the miss still teaches. */
export function lessonOops(q: Question, tapped: number | string): { text: string; said: string } {
  if (q.kind === 'sight') return { text: `THAT IS ${String(tapped).toUpperCase()}.`, said: `Oops! That word is ${tapped}. Listen again: ${q.word}.` };
  return { text: 'TRY AGAIN.', said: `Hmm, not ${numberWord(Number(tapped))}. Let's count again!` };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The friend's name for a cast member who isn't a chess piece. */
export const castName = (c: Cast) => (c in FRIEND_NAME ? FRIEND_NAME[c as Friend] : PIECE_WORD[c as Piece]);
