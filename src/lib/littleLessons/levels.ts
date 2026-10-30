// src/lib/littleLessons/levels.ts — every level of Little Lessons, in order, for each subject. A level is one
// skill; inside it is a deck of lessons (little games) that all practise that skill, so it never feels like
// the same thing over and over. Kiaan plays a lesson as a short run of 3–5 questions of one game.
//   chess  Naming the pieces → How they move → Eating apples, told by the pieces; inside each level the
//          pieces join one at a time as he gets questions right (`depth`)
//   words  sight words with Ollie the Owl, five new words a level, more choices and look-alikes later
//   math   counting with Benny the Bear (counting, then counting to add, then counting to take away),
//          then Zip the Robot's number machine (real addition, then real subtraction)
// Each level has a character and a little story told the first time it shows up (chess pieces also say
// hello the first time they join). Questions are made fresh each time. Pure data; the page draws it.
import { EAT_ORDER, MOVE_ORDER, NAME_ORDER, WORD as PIECE_WORD, canMove, makeBoard, movesFrom, type Piece, type Round, type Sq } from '../littleChess/lessons';
import { ALL_WORDS, WORD_GROUPS, lookAlikes } from './words';

export type Subject = 'chess' | 'words' | 'math';
export const SUBJECTS: Subject[] = ['chess', 'words', 'math'];
export const SUBJECT_LABEL: Record<Subject, string> = { chess: 'Chess', words: 'Sight words', math: 'Math' };

/** Who's on screen: a chess piece, or one of the lesson friends. */
export type Friend = 'ollie' | 'benny' | 'zip';
export type Cast = Piece | Friend;
export const FRIEND_NAME: Record<Friend, string> = { ollie: 'OLLIE', benny: 'BENNY', zip: 'ZIP' };

// ── the questions ──
/** Chess games beyond Little Chess's own rounds. */
export type ChessRound =
  | Exclude<Round, { kind: 'hello' }>
  | { kind: 'pieceMatch'; piece: Piece; options: Piece[] }                     // FIND THE SAME.
  | { kind: 'gone'; piece: Piece; row: Piece[]; options: Piece[] }              // WHO IS MISSING?
  | { kind: 'where'; piece: Piece; start: Sq }                                  // WHERE CAN ROOK GO? (tap every square)
  | { kind: 'who'; piece: Piece; options: Piece[]; start: Sq; target: Sq; mode: 'star' | 'apple' };  // WHO CAN GET THE STAR?
export type WordRound =
  | { kind: 'sight'; word: string; options: string[] }                          // hear it, tap it
  | { kind: 'wordMatch'; word: string; options: string[] }                      // find the same word
  | { kind: 'pop'; word: string; bubbles: string[] }                            // pop every bubble that says it
  | { kind: 'sentence'; word: string; sentence: string; options: string[] };    // the missing word ("I _ a bird.")
export type MathRound =
  | { kind: 'count'; n: number; thing: string; options: number[]; dots: boolean }
  | { kind: 'countAdd'; a: number; b: number; thing: string; options: number[] }
  | { kind: 'countSub'; a: number; b: number; thing: string; options: number[] }
  | { kind: 'add' | 'sub'; a: number; b: number; options: number[] }
  | { kind: 'dots'; n: number; options: number[] }                              // dice dots
  | { kind: 'dotsAdd'; a: number; b: number; options: number[] }                // two dice
  | { kind: 'more'; a: number; b: number; thing: string }                       // which side has more?
  | { kind: 'feed'; n: number; thing: string; pile: number }                    // give Benny 4
  | { kind: 'hop'; from: number; by: number; max: number }                      // the frog on the number line
  | { kind: 'gap'; a: number; b: number; op: 'add' | 'sub'; options: number[] }; // 3 + ? = 5 (b is missing)
export type Question = (ChessRound | WordRound | MathRound) & { level: string; game: string; subject: Subject; cast: Cast };

export type Story = { lines: string[]; said: string };
/** A story card: a level's story, or a chess piece saying hello when it joins. */
export type Intro = { id: string; story: Story; cast: Cast };
/** One lesson in a level's deck. `from`: only once he's got this many of the level's questions right. */
export type Game = { id: string; title: string; from?: number; make: (rand: () => number, depth: number) => ChessRound | WordRound | MathRound };
export type Level = Intro & {
  subject: Subject; title: string; games: Game[];
  /** how many levels' worth of right answers this one takes (the chess levels are big) */
  size: number;
  /** pieces saying hello as they join, by how far into the level he is */
  intros?: (depth: number) => Intro[];
};

// ── helpers ──
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pickOne = <T,>(rand: () => number, xs: T[]): T => xs[Math.floor(rand() * xs.length)];
export function shuffle<T>(rand: () => number, xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const between = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Number choices: the answer and some close to it (never below `min`: counting starts at 1). */
export function numberChoices(rand: () => number, answer: number, count = 3, min = 0): number[] {
  const near = shuffle(rand, [answer - 1, answer + 1, answer - 2, answer + 2, answer + 3].filter(n => n >= min && n !== answer));
  return shuffle(rand, [answer, ...near.slice(0, count - 1)]);
}

// ── chess: three big levels; the pieces join one at a time inside each ──
const STORY: Record<string, Story> = {
  'chess:naming': { lines: ['THE CHESS KINGDOM!'], said: "Welcome to the Chess Kingdom! Lots of friends live in the castle. Let's meet them, one at a time, and learn all their names!" },
  'chess:moves': { lines: ['TIME TO MOVE!'], said: "The chess friends want to play on the board! Every friend moves in its own special way. Let's find out how!" },
  'chess:eating': { lines: ['SNACK TIME!'], said: "The chess friends are hungry! There are apples all over the board. Help each friend move the right way to gobble them up!" },
  'chess:names-rook': { lines: ['THIS IS ROOK.', 'ROOK IS A BIG CASTLE.'], said: "Once upon a time, in the Chess Kingdom, there lived a strong castle tower called Rook. Rook keeps everyone safe. Let's meet Rook!" },
  'chess:names-knight': { lines: ['THIS IS KNIGHT.', 'KNIGHT IS A HORSE.'], said: "Clip clop! Here comes Knight, the bounciest horse in the kingdom. Knight loves to jump over things. Let's meet Knight!" },
  'chess:names-king': { lines: ['THIS IS KING.', 'KING HAS A CROSS.'], said: "This is the King. He wears a crown with a little cross on top, and he gives the best hugs in the whole kingdom. Let's meet the King!" },
  'chess:names-queen': { lines: ['THIS IS QUEEN.', 'QUEEN HAS A CROWN.'], said: "And here is the Queen! Her crown has lots of shiny points. She is the fastest in the kingdom. Let's meet the Queen!" },
  'chess:names-bishop': { lines: ['THIS IS BISHOP.', 'BISHOP HAS A HAT.'], said: "This is Bishop, in a tall pointy hat. Bishop is the kindest helper in the castle. Let's meet Bishop!" },
  'chess:names-pawn': { lines: ['THIS IS PAWN.', 'PAWN IS LITTLE.'], said: "And this is Pawn, the littlest one. Pawn is small, but very, very brave! Let's meet Pawn!" },
  'chess:moves-rook': { lines: ['ROOK GOES STRAIGHT.'], said: "Rook wants to collect the stars! Rook goes straight: up, down, left or right." },
  'chess:moves-bishop': { lines: ['BISHOP CLIMBS STAIRS.'], said: "Bishop loves stairs! Bishop goes corner to corner, and always stays on the same colour." },
  'chess:moves-queen': { lines: ['QUEEN GOES EVERYWHERE.'], said: "The Queen can go straight like Rook, and up the stairs like Bishop. Let's help her get the stars!" },
  'chess:moves-king': { lines: ['KING STEPS ONCE.'], said: "The King is a little sleepy. He takes just one step at a time, any way he likes." },
  'chess:moves-knight': { lines: ['KNIGHT JUMPS L.'], said: "Knight jumps in a big L: two steps, then a turn! Knight can even jump over things." },
  'chess:moves-pawn': { lines: ['PAWN STEPS UP.'], said: "Little Pawn marches forward, one brave step at a time." },
  'chess:eat-rook': { lines: ['ROOK IS HUNGRY!'], said: "Rook is so hungry! Help Rook gobble up the apples. Remember, Rook goes straight." },
  'chess:eat-bishop': { lines: ['BISHOP IS HUNGRY!'], said: "Bishop found an apple tree! Climb the stairs to eat the apples." },
  'chess:eat-queen': { lines: ['QUEEN IS HUNGRY!'], said: "It's the Queen's snack time! She can go everywhere to get the apples." },
  'chess:eat-king': { lines: ['KING IS HUNGRY!'], said: "The King wants apples for his royal lunch. One little step at a time!" },
  'chess:eat-knight': { lines: ['KNIGHT IS HUNGRY!'], said: "Knight is a hungry horse! Jump in an L to munch the apples." },
};

/** The pieces he has met in a chess level, by how far into it he is. */
export const metNames = (d: number) => NAME_ORDER.slice(0, Math.min(6, 2 + Math.floor(d / 3)));
export const metMoves = (d: number) => MOVE_ORDER.slice(0, Math.min(6, 1 + Math.floor(d / 4)));
export const metEat = (d: number) => EAT_ORDER.slice(0, Math.min(5, 1 + Math.floor(d / 3)));
/** Half the time the newest piece, else any he's met. */
const featured = (rand: () => number, met: Piece[]) => (rand() < 0.5 ? met[met.length - 1] : pickOne(rand, met));
const pieceChoices = (rand: () => number, piece: Piece, n: number, pool: Piece[]) =>
  shuffle(rand, [piece, ...shuffle(rand, pool.filter(p => p !== piece)).slice(0, Math.max(1, n - 1))]);
/** How many pieces to pick from: 2, then 3, then 4. */
const pieceCount = (d: number, met: Piece[]) => Math.min(met.length, d < 6 ? 2 : d < 15 ? 3 : 4);

/** "Who can get the star?": one of the pieces can reach it in one move, the others can't. */
function whoRound(rand: () => number, met: Piece[], d: number, mode: 'star' | 'apple'): ChessRound {
  for (let tries = 0; tries < 80; tries++) {
    const piece = featured(rand, met);
    const start: Sq = piece === 'pawn' ? [3, between(rand, 0, 3)] : [between(rand, 0, 3), between(rand, 0, 3)];
    const target = pickOne(rand, movesFrom(piece, start));
    if (!target) continue;
    const cant = shuffle(rand, met.filter(p => p !== piece && !canMove(p, start, target)));
    if (!cant.length) continue;
    return { kind: 'who', piece, start, target, mode, options: shuffle(rand, [piece, ...cant.slice(0, Math.min(2, d < 20 ? 1 : 2))]) };
  }
  const piece = featured(rand, met);
  return { kind: 'board', piece, mode, glow: true, ...makeBoard(piece, 1, rand) };
}

const NAMING: Game[] = [
  { id: 'find', title: 'Find it', make: (rand, d) => { const met = metNames(d), piece = featured(rand, met); return { kind: 'find', piece, options: pieceChoices(rand, piece, pieceCount(d, met), met) }; } },
  { id: 'same', title: 'Find the same', make: (rand, d) => { const met = metNames(d), piece = featured(rand, met); return { kind: 'pieceMatch', piece, options: pieceChoices(rand, piece, pieceCount(d, met) + 1, met) }; } },
  { id: 'word', title: 'Read its name', from: 3, make: (rand, d) => { const met = metNames(d), piece = featured(rand, met); return { kind: 'word', piece, options: pieceChoices(rand, piece, pieceCount(d, met), met) }; } },
  { id: 'shadow', title: 'Shadow', from: 6, make: (rand, d) => { const met = metNames(d), piece = featured(rand, met); return { kind: 'shadow', piece, options: pieceChoices(rand, piece, 3, met), answer: d >= 15 && rand() < 0.5 ? 'word' : 'piece' }; } },
  { id: 'peek', title: 'Peekaboo', from: 6, make: (rand, d) => { const met = metNames(d), piece = featured(rand, met); return { kind: 'peek', piece, options: pieceChoices(rand, piece, 3, met), answer: d >= 15 && rand() < 0.5 ? 'word' : 'piece' }; } },
  { id: 'gone', title: "Who's missing", from: 9, make: (rand, d) => {
    const met = metNames(d), row = shuffle(rand, met).slice(0, Math.min(4, met.length)), piece = pickOne(rand, row);
    return { kind: 'gone', piece, row, options: pieceChoices(rand, piece, Math.min(3, row.length), row) };
  } },
];
const MOVES: Game[] = [
  { id: 'path', title: 'Follow the glow', make: (rand, d) => { const piece = featured(rand, metMoves(d)); return { kind: 'show', piece, start: makeBoard(piece, 1, rand).start, taps: 2 }; } },
  { id: 'stars', title: 'Collect the stars', make: (rand, d) => {
    const met = metMoves(d), piece = featured(rand, met), fresh = piece === met[met.length - 1] && d % 4 < 2;
    return { kind: 'board', piece, mode: 'star', glow: d < 8 || fresh, ...makeBoard(piece, d >= 4 && rand() < 0.5 ? 2 : 1, rand) };
  } },
  { id: 'where', title: 'Where can it go?', from: 6, make: (rand, d) => {
    const piece = featured(rand, metMoves(d));
    let start = makeBoard(piece, 1, rand).start;
    for (let i = 0; i < 30 && movesFrom(piece, start).length > 6; i++) start = makeBoard(piece, 1, rand).start;
    return { kind: 'where', piece, start };
  } },
  { id: 'who', title: 'Who can get the star?', from: 12, make: (rand, d) => whoRound(rand, metMoves(d), d, 'star') },
];
const EATING: Game[] = [
  { id: 'apples', title: 'Eat the apples', make: (rand, d) => {
    const met = metEat(d), piece = featured(rand, met);
    return { kind: 'board', piece, mode: 'apple', glow: d < 6 || (piece === met[met.length - 1] && d % 3 === 0), ...makeBoard(piece, d >= 3 && rand() < 0.5 ? 2 : 1, rand) };
  } },
  { id: 'feast', title: 'Apple feast', make: (rand, d) => { const piece = featured(rand, metEat(d)); return { kind: 'board', piece, mode: 'apple', glow: d < 9, ...makeBoard(piece, 3, rand) }; } },
  { id: 'nohint', title: 'Apples, no hints', from: 6, make: (rand, d) => { const piece = featured(rand, metEat(d)); return { kind: 'board', piece, mode: 'apple', glow: false, ...makeBoard(piece, rand() < 0.5 ? 2 : 1, rand) }; } },
  { id: 'who', title: 'Who can eat it?', from: 3, make: (rand, d) => whoRound(rand, metEat(d), d, 'apple') },
];
const pieceIntros = (prefix: string, met: Piece[]): Intro[] => met.map(p => ({ id: `chess:${prefix}-${p}`, story: STORY[`chess:${prefix}-${p}`], cast: p }));
const CHESS: Level[] = [
  { id: 'chess:naming', subject: 'chess', title: 'Naming the pieces', cast: 'king', story: STORY['chess:naming'], size: 3, games: NAMING, intros: d => pieceIntros('names', metNames(d)) },
  { id: 'chess:moves', subject: 'chess', title: 'How the pieces move', cast: 'queen', story: STORY['chess:moves'], size: 3, games: MOVES, intros: d => pieceIntros('moves', metMoves(d)) },
  { id: 'chess:eating', subject: 'chess', title: 'Eating apples', cast: 'knight', story: STORY['chess:eating'], size: 2, games: EATING, intros: d => pieceIntros('eat', metEat(d)) },
];
/** Every piece hello there is (for the voice script). */
export const PIECE_INTROS: Intro[] = [...pieceIntros('names', NAME_ORDER), ...pieceIntros('moves', MOVE_ORDER), ...pieceIntros('eat', EAT_ORDER)];

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

/** Ollie's sentences: `_` is where the word goes. */
export const SENTENCES: Record<string, string> = {
  I: '_ like cake.', a: 'I see _ cat.', the: 'Look at _ dog.', see: 'I _ a bird.', go: 'We _ to the park.', me: 'Look at _!', my: 'This is _ ball.',
  up: 'Jump _ high!', we: '_ like to play.', is: 'The cat _ big.', it: 'I can see _.', in: 'The fish is _ the pond.', to: 'I go _ the park.',
  can: 'I _ jump.', you: 'I love _.', and: 'Mom _ Dad.', big: 'The bear is _.', red: 'The apple is _.', run: 'I can _ fast.', one: 'I have _ nose.',
  two: 'I have _ hands.', not: 'I am _ sad.', for: 'This cake is _ you.', look: '_ at the moon!', come: '_ and play!', down: 'Sit _.', help: 'Can you _ me?',
  here: 'Come _.', jump: 'Frogs can _.', play: "Let's _ outside.", said: 'Mom _ yes.', blue: 'The sky is _.', find: 'Can you _ the cat?', make: "Let's _ a cake.",
  three: 'I see _ ducks.', little: 'The bug is _.', yellow: 'The sun is _.', funny: 'The clown is _.', where: '_ is my hat?', away: 'The bird flew _.',
  am: 'I _ happy.', at: 'Look _ me!', be: 'I will _ good.', do: 'What can you _?', he: '_ is my dad.', no: '_, thank you.', on: 'The cat is _ the bed.',
  so: 'I am _ happy!', all: 'We _ like ice cream.', are: 'You _ my friend.', ate: 'The dog _ a bone.', did: 'I _ it!', eat: "Let's _ lunch.",
  get: 'Go _ the ball.', new: 'I have a _ toy.', now: "Let's go _.", our: 'This is _ house.', out: "Let's go _ to play.", ran: 'The dog _ fast.',
  saw: 'I _ a bee.', say: '_ hello!', she: '_ is my mom.', too: 'I want one _.', was: 'The cake _ good.', who: '_ is at the door?', yes: '_, please.',
  came: 'Grandma _ to see us.', four: 'A dog has _ legs.', good: 'The cake is _.', have: 'I _ a ball.', into: 'Jump _ the pool.', like: 'I _ trucks.',
  ride: 'I can _ my bike.', soon: 'We will eat _.', that: 'I want _ one.', they: '_ are my friends.', this: '_ is my dog.', want: 'I _ a cookie.',
  went: 'We _ to the zoo.', what: '_ is that?', will: 'I _ help you.', with: 'Come play _ me.', black: 'The cat is _.', brown: 'The bear is _.',
  there: 'Look over _!', under: 'The ball is _ the bed.', white: 'Snow is _.', please: 'More milk, _.', pretty: 'The flower is _.',
  of: 'A cup _ milk.', an: 'I ate _ apple.', by: 'Sit _ me.', ask: '_ Mom.', fly: 'Birds can _.', had: 'I _ fun.', has: 'The cat _ a hat.',
  her: 'Give it to _.', him: 'Wave to _.', his: 'This is _ hat.', how: '_ old are you?', let: '_ me see!', old: 'My dog is _.', put: '_ it here.',
  again: "Let's do it _!", from: 'A gift _ Dad.', give: '_ me a hug.', going: 'We are _ home.', know: 'I _ my ABCs.', live: 'Fish _ in water.',
  once: '_ upon a time.', open: '_ the door.', over: 'Jump _ the log.', round: 'The ball is _.', some: 'Can I have _?', stop: '_ at the red light.',
  take: '_ my hand.', thank: '_ you!', them: 'Look at _ go!', think: 'I _ so.', walk: "Let's go for a _.", were: 'We _ at the park.', when: '_ can we go?',
};
/** A sentence with its word put back, as Ollie reads it. */
export const sentenceSaid = (word: string) => (SENTENCES[word] || '_').replace('_', word);

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
  // mostly this level's new words, sometimes one he met before
  const target = (rand: () => number, from = group, older = WORD_GROUPS.slice(0, i).flat()) =>
    older.length && rand() < 0.3 ? pickOne(rand, older) : pickOne(rand, from);
  const choices = (rand: () => number, word: string, count = wordChoices(i).count) => {
    const hard = wordChoices(i).alike ? shuffle(rand, lookAlikes(word).filter(w => known.includes(w))).slice(0, count - 2) : [];
    const rest = shuffle(rand, known.filter(w => w !== word && !hard.includes(w)));
    return shuffle(rand, [word, ...hard, ...rest].slice(0, count));
  };
  const withSentence = (ws: string[]) => ws.filter(w => SENTENCES[w]);
  const games: Game[] = [
    { id: 'hear', title: 'Hear it, tap it', make: rand => { const word = target(rand); return { kind: 'sight', word, options: choices(rand, word) }; } },
    { id: 'same', title: 'Find the same word', make: rand => { const word = target(rand); return { kind: 'wordMatch', word, options: choices(rand, word, wordChoices(i).count + 1) }; } },
    { id: 'pop', title: 'Pop the bubbles', make: rand => {
      const word = target(rand), n = 2 + Math.floor(rand() * 2);
      const others = choices(rand, word, 6).filter(w => w !== word);
      return { kind: 'pop', word, bubbles: shuffle(rand, [...Array(n).fill(word), ...Array.from({ length: 6 - n }, (_, k) => others[k % others.length])]) };
    } },
  ];
  if (i >= 1 && withSentence(known).length) games.push({ id: 'sentence', title: "Ollie's sentence", make: rand => {
    const mine = withSentence(group), word = mine.length && rand() < 0.7 ? pickOne(rand, mine) : pickOne(rand, withSentence(known));
    return { kind: 'sentence', word, sentence: SENTENCES[word], options: choices(rand, word) };
  } });
  return { id: `words:${i + 1}`, subject: 'words', title: `Words ${i + 1}: ${group.join(' ')}`, cast: 'ollie', story, size: 1, games };
}

// ── math: Benny the Bear counts; Zip the Robot does real sums ──
type MathSpec = { id: string; kind: 'count' | 'countAdd' | 'countSub' | 'add' | 'sub'; title: string; cast: Friend; things: string[]; story: Story;
  nums: (rand: () => number) => { n?: number; a?: number; b?: number };
  /** the number line's last number */
  line: number;
  /** (sums) every a, b `nums` can give: each one gets a recorded line */
  ok?: (a: number, b: number) => boolean };
export const MATH: MathSpec[] = [
  { id: 'count-3', kind: 'count', title: 'Counting to 3', cast: 'benny', things: ['🍓', '🍊'], line: 5   /* one thing per picture (🫐 shows a bunch) */,
    story: { lines: ['THIS IS BENNY.', 'BENNY LOVES BERRIES.'], said: "Hello! This is Benny the Bear. Benny is going berry picking, and he needs a helper to count his berries. Will you help? Touch each berry and count with me!" },
    nums: r => ({ n: between(r, 1, 3) }) },
  { id: 'count-5', kind: 'count', title: 'Counting to 5', cast: 'benny', things: ['🍎', '🍓', '🐞'], line: 5,
    story: { lines: ['BENNY HAS MORE!', 'COUNT TO 5.'], said: "Benny found a bigger berry bush! Now there are up to five things to count. One, two, three, four, five!" },
    nums: r => ({ n: between(r, 1, 5) }) },
  { id: 'count-8', kind: 'count', title: 'Counting to 8', cast: 'benny', things: ['🐟', '🌟', '🦋'], line: 10,
    story: { lines: ['BENNY GOES FISHING.'], said: "Benny went fishing at the lake! Splash! Let's count the fish he sees." },
    nums: r => ({ n: between(r, 3, 8) }) },
  { id: 'count-10', kind: 'count', title: 'Counting to 10', cast: 'benny', things: ['🍯', '🐝', '🌻'], line: 10,
    story: { lines: ['BENNY FOUND HONEY!', 'COUNT TO 10.'], said: "Yum! Benny found a whole row of honey pots! Let's count all the way to ten." },
    nums: r => ({ n: between(r, 1, 10) }) },
  { id: 'count-20', kind: 'count', title: 'Counting to 20', cast: 'benny', things: ['⭐', '🍪', '🎈'], line: 20,
    story: { lines: ['A BIG PARTY!', 'COUNT TO 20.'], said: "It's Benny's birthday party! There are so many things! Let's count by rows of ten. Ten, and then some more!" },
    nums: r => ({ n: between(r, 10, 20) }) },
  { id: 'cadd-3', kind: 'countAdd', title: 'Counting to add (to 3)', cast: 'benny', things: ['🍓', '🍎'], line: 5,
    story: { lines: ['BENNY HAS A FRIEND!'], said: "Benny's friend came to visit, and brought more berries! Let's put them together. How many are there in all?" },
    nums: r => { const a = between(r, 1, 2); return { a, b: between(r, 1, 3 - a) }; } },
  { id: 'cadd-5', kind: 'countAdd', title: 'Counting to add (to 5)', cast: 'benny', things: ['🐟', '🍪', '🌟'], line: 5,
    story: { lines: ['MORE FRIENDS CAME!'], said: "More friends came to the picnic, and everyone brought a snack. Count them all together!" },
    nums: r => { const a = between(r, 1, 4); return { a, b: between(r, 1, 5 - a) }; } },
  { id: 'cadd-10', kind: 'countAdd', title: 'Counting to add (to 10)', cast: 'benny', things: ['🍯', '🎈', '🐞'], line: 10,
    story: { lines: ['A BIG PICNIC!'], said: "Now it's a giant picnic! Lots and lots of snacks. Put the two piles together and count them all." },
    nums: r => { const a = between(r, 1, 7); return { a, b: between(r, 1, 10 - a) }; } },
  { id: 'csub-5', kind: 'countSub', title: 'Counting to take away (to 5)', cast: 'benny', things: ['🍓', '🍪'], line: 5,
    story: { lines: ['OH NO, BIRDS!'], said: "Oh no! Some birds came and flew away with Benny's berries! Let's count how many are left." },
    nums: r => { const a = between(r, 2, 5); return { a, b: between(r, 1, a - 1) }; } },
  { id: 'csub-10', kind: 'countSub', title: 'Counting to take away (to 10)', cast: 'benny', things: ['🍯', '🍎', '🐟'], line: 10,
    story: { lines: ['BENNY ATE SOME!'], said: "Benny was so hungry, he ate some of his snacks! Yum. How many are left now?" },
    nums: r => { const a = between(r, 3, 10); return { a, b: between(r, 1, a - 1) }; } },
  { id: 'add-5', kind: 'add', title: 'Addition to 5', cast: 'zip', line: 5,
    things: [], story: { lines: ['THIS IS ZIP.', 'ZIP LOVES NUMBERS.'], said: "Beep boop! This is Zip the Robot. Zip has a number machine! Put two numbers in, and the machine adds them up. Can you help Zip find the answer?" },
    nums: r => { const a = between(r, 0, 4); return { a, b: between(r, 1, 5 - a) }; }, ok: (a, b) => a <= 4 && b >= 1 && a + b <= 5 },
  { id: 'add-10', kind: 'add', title: 'Addition to 10', cast: 'zip', things: [], line: 10,
    story: { lines: ['ZIP GOES FASTER!'], said: "Zip's machine got an upgrade! Now it adds bigger numbers, all the way to ten. Beep beep!" },
    nums: r => { const a = between(r, 1, 9); return { a, b: between(r, 1, 10 - a) }; }, ok: (a, b) => a >= 1 && b >= 1 && a + b <= 10 },
  { id: 'add-20', kind: 'add', title: 'Addition to 20', cast: 'zip', things: [], line: 20,
    story: { lines: ['A ROCKET!', 'ZIP GOES UP!'], said: "Zip built a rocket! To fly it, we need to add numbers all the way to twenty. Three, two, one, blast off!" },
    nums: r => { const a = between(r, 2, 15); return { a, b: between(r, 1, 20 - a) }; }, ok: (a, b) => a >= 2 && a <= 15 && b >= 1 && a + b <= 20 },
  { id: 'sub-5', kind: 'sub', title: 'Subtraction to 5', cast: 'zip', things: [], line: 5,
    story: { lines: ['ZIP TAKES AWAY.'], said: "Zip's machine can take away too! Put in a number, take some away, and see what's left. Beep boop!" },
    nums: r => { const a = between(r, 1, 5); return { a, b: between(r, 0, a) }; }, ok: (a, b) => a >= 1 && a <= 5 && b <= a },
  { id: 'sub-10', kind: 'sub', title: 'Subtraction to 10', cast: 'zip', things: [], line: 10,
    story: { lines: ['ZIP IS A CHEF!'], said: "Zip is cooking cookies! Some got eaten. Take them away and find what's left, up to ten." },
    nums: r => { const a = between(r, 2, 10); return { a, b: between(r, 1, a) }; }, ok: (a, b) => a >= 2 && a <= 10 && b >= 1 && b <= a },
  { id: 'sub-20', kind: 'sub', title: 'Subtraction to 20', cast: 'zip', things: [], line: 20,
    story: { lines: ['ZIP IN SPACE!'], said: "Zip is flying through space, and the rocket is using up fuel. Take away, all the way from twenty!" },
    nums: r => { const a = between(r, 5, 20); return { a, b: between(r, 1, Math.min(a, 10)) }; }, ok: (a, b) => a >= 5 && a <= 20 && b >= 1 && b <= Math.min(a, 10) },
];

/** The highest number a counting level goes to. */
const countTop = (s: MathSpec) => Number(s.id.split('-')[1]);

function mathGames(s: MathSpec): Game[] {
  const thing = (rand: () => number) => (s.things.length ? pickOne(rand, s.things) : '🍪');
  const nums = (rand: () => number) => s.nums(rand) as { n: number; a: number; b: number };
  if (s.kind === 'count') {
    const top = countTop(s), small = Math.min(top, 10);
    return [
      { id: 'count', title: 'Count them', make: rand => { const { n } = nums(rand); return { kind: 'count', n, thing: thing(rand), options: numberChoices(rand, n, 3, 1), dots: top <= 5 }; } },
      { id: 'dots', title: 'Dice dots', make: rand => { const n = Math.min(nums(rand).n, top <= 10 ? 10 : 20); return { kind: 'dots', n, options: numberChoices(rand, n, 3, 1) }; } },
      { id: 'more', title: 'Which has more?', make: rand => {
        const gap = top <= 3 ? 1 : 2, hi = Math.max(gap + 1, small);
        const a = between(rand, 1 + gap, hi), b = between(rand, 1, a - gap);
        return rand() < 0.5 ? { kind: 'more', a, b, thing: thing(rand) } : { kind: 'more', a: b, b: a, thing: thing(rand) };
      } },
      { id: 'feed', title: 'Feed Benny', make: rand => { const n = Math.min(nums(rand).n, small); return { kind: 'feed', n, thing: thing(rand), pile: Math.min(12, n + between(rand, 2, 3)) }; } },
      { id: 'hop', title: 'Hop to it', make: rand => ({ kind: 'hop', from: 0, by: Math.min(nums(rand).n, s.line), max: s.line }) },
    ];
  }
  if (s.kind === 'countAdd') return [
    { id: 'count', title: 'Put them together', make: rand => { const { a, b } = nums(rand); return { kind: 'countAdd', a, b, thing: thing(rand), options: numberChoices(rand, a + b, 3, 1) }; } },
    { id: 'dots', title: 'Two dice', make: rand => { let { a, b } = nums(rand); a = Math.min(a, 6); b = Math.min(b, 6); return { kind: 'dotsAdd', a, b, options: numberChoices(rand, a + b, 3, 1) }; } },
    { id: 'hop', title: 'Hop more', make: rand => { const { a, b } = nums(rand); return { kind: 'hop', from: a, by: b, max: s.line }; } },
  ];
  if (s.kind === 'countSub') return [
    { id: 'count', title: 'How many are left?', make: rand => { const { a, b } = nums(rand); return { kind: 'countSub', a, b, thing: thing(rand), options: numberChoices(rand, a - b, 3, 0) }; } },
    { id: 'hop', title: 'Hop back', make: rand => { const { a, b } = nums(rand); return { kind: 'hop', from: a, by: -b, max: s.line }; } },
  ];
  const op = s.kind;
  return [
    { id: 'sum', title: "Zip's machine", make: rand => { const { a, b } = nums(rand); return { kind: op, a, b, options: numberChoices(rand, op === 'add' ? a + b : a - b) }; } },
    { id: 'hop', title: 'Number line', make: rand => { const { a, b } = nums(rand), by = Math.max(1, b); return { kind: 'hop', from: a, by: op === 'add' ? by : -Math.min(by, a), max: s.line }; } },
    { id: 'gap', title: 'What is missing?', from: 3, make: rand => { const { a, b } = nums(rand); return { kind: 'gap', a, b, op, options: numberChoices(rand, b) }; } },
  ];
}

function mathLevel(s: MathSpec): Level {
  return { id: `math:${s.id}`, subject: 'math', title: s.title, cast: s.cast, story: s.story, size: 1, games: mathGames(s) };
}

export const LEVELS: Record<Subject, Level[]> = {
  chess: CHESS,
  words: WORD_GROUPS.map((_, i) => wordLevel(i)),
  math: MATH.map(mathLevel),
};
export const levelById = (id: string): Level | undefined => SUBJECTS.flatMap(s => LEVELS[s]).find(l => l.id === id);

/** The games of a level he can play now (some only once he's further in). */
export const gamesAt = (l: Level, depth: number) => l.games.filter(g => depth >= (g.from || 0));

/** A question from one game of a level. */
export function makeQuestion(l: Level, gameId: string, rand: () => number, depth: number): Question {
  const g = l.games.find(x => x.id === gameId) || l.games[0];
  const r = g.make(rand, depth);
  const cast: Cast = l.subject === 'chess' && 'piece' in r ? r.piece : l.cast;
  return { ...r, level: l.id, game: g.id, subject: l.subject, cast } as Question;
}

/** The right answer to a question (for checking taps and for tests). */
export function answerOf(q: Question): number | string | null {
  switch (q.kind) {
    case 'count': case 'dots': case 'feed': return q.n;
    case 'countAdd': case 'add': case 'dotsAdd': return q.a + q.b;
    case 'countSub': case 'sub': return q.a - q.b;
    case 'hop': return q.from + q.by;
    case 'gap': return q.b;
    case 'more': return q.a > q.b ? 'a' : 'b';
    case 'sight': case 'wordMatch': case 'pop': case 'sentence': return q.word;
    case 'find': case 'word': case 'shadow': case 'peek': case 'pieceMatch': case 'gone': case 'who': return q.piece;
    default: return null;
  }
}

// ── what's shown and said ──
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export const numberWord = (n: number) => NUM_WORD[n] ?? String(n);
const THING_NAME: Record<string, string> = { '🍓': 'berries', '🍊': 'oranges', '🍎': 'apples', '🐞': 'ladybugs', '🐟': 'fish', '🌟': 'stars', '⭐': 'stars', '🦋': 'butterflies',
  '🍯': 'honey pots', '🐝': 'bees', '🌻': 'sunflowers', '🍪': 'cookies', '🎈': 'balloons' };
export const thingName = (t: string) => THING_NAME[t] || 'things';

/** Something said out loud: `text` on screen, `key` names its recorded clip (with `who`), `said` is what's spoken. */
export type Said = { text: string; key: string; said: string; who: Cast | 'narrator' };
const plural = (t: string) => thingName(t);
const nice = (p: Piece) => p.charAt(0).toUpperCase() + p.slice(1);

/** Who asks a chess question: on a board, and for "which word?", the piece itself; to find or guess a
 *  piece, the King (or the Queen, when the King is the one to find). */
export const chessHost = (r: ChessRound | Round): Piece =>
  r.kind === 'board' || r.kind === 'show' || r.kind === 'word' || r.kind === 'hello' || r.kind === 'where' ? r.piece : r.piece === 'king' ? 'queen' : 'king';

/** The sentence on screen (short sight words) and what's said, for the games Little Chess doesn't have. */
export function lessonLine(q: Question): Said | null {
  switch (q.kind) {
    case 'sight': return { text: 'FIND THE WORD.', ...sightFind(q.word) };
    case 'wordMatch': return { text: 'FIND THE SAME WORD.', ...wordSame };
    case 'pop': return { text: `POP EVERY ${q.word.toUpperCase()}.`, ...popLine(q.word) };
    case 'sentence': return { text: 'FIND THE MISSING WORD.', ...sentenceLine(q.word) };
    case 'count': return { text: 'HOW MANY?', ...howMany(plural(q.thing)) };
    case 'countAdd': return { text: 'HOW MANY IN ALL?', ...inAll(plural(q.thing)) };
    case 'countSub': return { text: 'HOW MANY ARE LEFT?', ...areLeft(plural(q.thing)) };
    case 'add': case 'sub': return { text: `${q.a} ${q.kind === 'add' ? '+' : '−'} ${q.b} = ?`, ...sum(q.kind, q.a, q.b) };
    case 'dots': return { text: 'HOW MANY DOTS?', ...dotsLine };
    case 'dotsAdd': return { text: 'HOW MANY DOTS IN ALL?', ...dotsAllLine };
    case 'more': return { text: 'WHICH HAS MORE?', ...moreLine };
    case 'feed': return { text: `GIVE BENNY ${q.n}.`, ...feedLine(q.n) };
    case 'hop': return { text: q.from === 0 ? `HOP TO ${q.by}.` : `HOP ${Math.abs(q.by)} ${q.by > 0 ? 'MORE' : 'BACK'}.`, ...hopLine(q.from, q.by, q.cast === 'zip' ? 'zip' : 'benny') };
    case 'gap': return { text: 'WHAT IS MISSING?', ...gapLine };
    case 'pieceMatch': return { text: 'FIND THE SAME.', ...chessLine('FIND THE SAME', "Can you find the same one? Look carefully, and tap it!", chessHost(q)) };
    case 'gone': return { text: 'WHO IS MISSING?', ...chessLine('WHO IS MISSING', "Look at all the friends! Oh, someone went away. Who is missing?", chessHost(q)) };
    case 'where': return { text: `WHERE CAN ${PIECE_WORD[q.piece]} GO?`, ...whereLine(q.piece) };
    case 'who': return q.mode === 'star'
      ? { text: 'WHO CAN GET THE STAR?', ...chessLine('WHO CAN GET THE STAR', 'Which friend can get the star in one move? Think about how each one moves!', chessHost(q)) }
      : { text: 'WHO CAN EAT THE APPLE?', ...chessLine('WHO CAN EAT THE APPLE', 'Which friend can eat the apple in one move? Think about how each one moves!', chessHost(q)) };
    default: return null;
  }
}
const sightFind = (w: string) => ({ key: `FIND ${w}`, said: `Find the word: ${w}. ${w}.`, who: 'ollie' as const });
const wordSame = { key: 'SAME WORD', said: 'Find the same word! Look carefully at all the letters.', who: 'ollie' as const };
const popLine = (w: string) => ({ key: `POP ${w}`, said: `Pop every bubble that says ${w}! ${w}.`, who: 'ollie' as const });
const sentenceLine = (w: string) => ({ key: `SENTENCE ${w}`, said: `${sentenceSaid(w)} Which word is missing? ${w}.`, who: 'ollie' as const });
// (`t` is the things' name: "berries")
const howMany = (t: string) => ({ key: `HOW MANY ${t}`, said: `How many ${t}? Count them!`, who: 'benny' as const });
const inAll = (t: string) => ({ key: `IN ALL ${t}`, said: `Let's put the ${t} together. How many ${t} in all?`, who: 'benny' as const });
const areLeft = (t: string) => ({ key: `LEFT ${t}`, said: `Some ${t} went away! How many ${t} are left?`, who: 'benny' as const });
const sum = (k: 'add' | 'sub', a: number, b: number) => ({ key: `${a} ${k === 'add' ? 'PLUS' : 'MINUS'} ${b}`,
  said: `What is ${numberWord(a)} ${k === 'add' ? 'plus' : 'take away'} ${numberWord(b)}?`, who: 'zip' as const });
const dotsLine = { key: 'HOW MANY DOTS', said: 'How many dots? Count the dots!', who: 'benny' as const };
const dotsAllLine = { key: 'DOTS IN ALL', said: 'Two dice! How many dots are there in all?', who: 'benny' as const };
const moreLine = { key: 'WHICH MORE', said: 'Which side has more? Tap the side with more!', who: 'benny' as const };
const fewerLine = { key: 'FEWER', said: 'Hmm, that side has fewer. Look again!', who: 'benny' as const };
const feedLine = (n: number) => ({ key: `GIVE ${n}`, said: `Give Benny ${numberWord(n)}! Tap them into his basket, then press the green check.`, who: 'benny' as const });
const hopLine = (from: number, by: number, who: 'benny' | 'zip') => from === 0
  ? { key: `HOP TO ${by}`, said: `Help the frog hop to ${numberWord(by)}! Tap the frog to hop, then press the green check.`, who }
  : { key: `HOP ${Math.abs(by)} ${by > 0 ? 'MORE' : 'BACK'}`, said: `Hop ${numberWord(Math.abs(by))} ${by > 0 ? 'more' : 'back'}! Tap the frog to hop, then press the green check.`, who };
const gapLine = { key: 'WHAT IS MISSING', said: 'Beep boop! A number fell out of my machine. What number is missing?', who: 'zip' as const };
const chessLine = (key: string, said: string, who: Piece) => ({ key, said, who });
const whereLine = (p: Piece) => ({ key: `WHERE CAN ${PIECE_WORD[p]} GO`, said: `Where can the ${nice(p)} go? Tap every square the ${nice(p)} can go to!`, who: p });

/** A wrong tap on a new-kind question: say what he tapped, so the miss still teaches. */
export function lessonOops(q: Question, tapped: number | string): Said {
  if (q.kind === 'sight' || q.kind === 'wordMatch' || q.kind === 'pop' || q.kind === 'sentence') return { text: `THAT IS ${String(tapped).toUpperCase()}.`, ...wordOops(String(tapped)) };
  if (q.kind === 'more') return { text: 'THAT HAS FEWER.', ...fewerLine };
  return { text: q.kind === 'feed' || q.kind === 'hop' ? `THAT IS ${tapped}.` : 'TRY AGAIN.', ...numberOops(Number(tapped), q.cast === 'zip' ? 'zip' : 'benny') };
}
const wordOops = (w: string) => ({ key: `NOT ${w}`, said: `Oops! That word is ${w}. Try again!`, who: 'ollie' as const });
const numberOops = (n: number, who: 'benny' | 'zip') => ({ key: `NOT ${n}`, said: `Hmm, not ${numberWord(n)}. Let's try again!`, who });
/** Counting out loud (Benny's things, the frog's hops). */
export const countAloud = (n: number, who: 'benny' | 'zip' = 'benny'): Said => ({ text: String(n), key: `COUNT ${n}`, said: `${cap(numberWord(n))}!`, who });
/** A level's story, or a piece's hello, told by its character. */
export const storyLine = (l: Intro): Said => ({ text: l.story.lines.join(' '), key: `STORY ${l.id}`, said: l.story.said, who: l.cast });

/** Every lesson line there is (not the chess rounds Little Chess already lists): for the voice script. */
export function lessonLines(): Omit<Said, 'text'>[] {
  const out: Omit<Said, 'text'>[] = [];
  const add = (x: Omit<Said, 'text'>) => out.push({ key: x.key, said: x.said, who: x.who });
  for (const s of SUBJECTS) for (const l of LEVELS[s]) add(storyLine(l));
  for (const l of PIECE_INTROS) add(storyLine(l));
  for (const host of ['king', 'queen'] as Piece[]) {
    add(chessLine('FIND THE SAME', "Can you find the same one? Look carefully, and tap it!", host));
    add(chessLine('WHO IS MISSING', "Look at all the friends! Oh, someone went away. Who is missing?", host));
    add(chessLine('WHO CAN GET THE STAR', 'Which friend can get the star in one move? Think about how each one moves!', host));
    add(chessLine('WHO CAN EAT THE APPLE', 'Which friend can eat the apple in one move? Think about how each one moves!', host));
  }
  for (const p of NAME_ORDER) add(whereLine(p));
  add(wordSame);
  for (const w of ALL_WORDS) { add(sightFind(w)); add(wordOops(w)); add(popLine(w)); if (SENTENCES[w]) add(sentenceLine(w)); }
  const things = (kind: MathSpec['kind']) => [...new Set(MATH.filter(m => m.kind === kind).flatMap(m => m.things.map(plural)))];
  for (const t of things('count')) add(howMany(t));
  for (const t of things('countAdd')) add(inAll(t));
  for (const t of things('countSub')) add(areLeft(t));
  for (const k of ['add', 'sub'] as const) for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++)
    if (MATH.some(m => m.kind === k && m.ok?.(a, b))) add(sum(k, a, b));
  add(dotsLine); add(dotsAllLine); add(moreLine); add(fewerLine); add(gapLine);
  for (let n = 1; n <= 10; n++) add(feedLine(n));
  for (const who of ['benny', 'zip'] as const) {
    for (let n = 1; n <= 20; n++) { add(hopLine(0, n, who)); add(countAloud(n, who)); }
    for (let n = 1; n <= 20; n++) add(hopLine(1, n, who));
    for (let n = 1; n <= 10; n++) add(hopLine(1, -n, who));
  }
  for (let n = 0; n <= 23; n++) { add(numberOops(n, 'benny')); add(numberOops(n, 'zip')); }
  return out;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The friend's name for a cast member who isn't a chess piece. */
export const castName = (c: Cast) => (c in FRIEND_NAME ? FRIEND_NAME[c as Friend] : PIECE_WORD[c as Piece]);
