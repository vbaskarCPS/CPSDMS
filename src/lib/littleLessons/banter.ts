// src/lib/littleLessons/banter.ts — what Mr Monkey says, and what he and the other characters say to each
// other. Mr Monkey is the host (speaker 'narrator': his recorded voice); every chess piece and friend has a
// personality of its own, and they talk back. Each line has the short words shown on screen (sight-word
// style, capitals, which also name its recorded clip) and the full sentence that's said out loud.
//
// Moments:
//   opener(cast)       a lesson with this character starts: hello, a bit of chat, then the question
//   handoff(cast)      Mr Monkey asks the character to ask the question (before the question is read)
//   cheer(cast)        a right answer: the character cheers (its own voice) and the two of them celebrate
//   comfort(cast)      a miss: a kind word from Mr Monkey, the character chips in
//   afterStory(cast)   the character has told its story: Mr Monkey reacts, the character answers
//   stickerParty(cast) a sticker earned: the two of them celebrate it
//   thinking()         Mr Monkey while Kiaan is looking at the answers (said once in a while)
//   monkeyTap(name)    Mr Monkey tapped on his own: a little line about stickers, bananas or friends
//   monkeyWelcome(name) the home screen: who he is and what the game is
// `allBanterLines` lists every line for the voice script (one clip each).
import { NAME_ORDER, WORD } from '../littleChess/lessons';
import type { Cast, Friend } from './levels';

export type Who = Cast | 'narrator';
export type BanterLine = { who: Who; text: string; said: string };
export type Exchange = BanterLine[];

export const FRIENDS: Friend[] = ['ollie', 'benny', 'zip'];
export const CAST: Cast[] = [...NAME_ORDER, ...FRIENDS];
const NAME: Record<Cast, string> = { ...WORD, ollie: 'OLLIE', benny: 'BENNY', zip: 'ZIP' };
const nice: Record<Cast, string> = { rook: 'Rook', knight: 'Knight', king: 'King', queen: 'Queen', bishop: 'Bishop', pawn: 'Pawn', ollie: 'Ollie', benny: 'Benny', zip: 'Zip' };

type L = [string, string];   // [screen words, what's said]
const M = (text: string, said: string): BanterLine => ({ who: 'narrator', text, said });
const C = (who: Cast, text: string, said: string): BanterLine => ({ who, text, said });

// ── how each character talks ──────────────────────────────────────────────────────────────────────────
type Voice = { hello: L[]; chat: L[]; ask: L[]; right: L[]; wrong: L[]; story: L[]; sticker: L[] };
const VOICES: Record<Cast, Voice> = {
  rook: {
    hello: [['HI, MR MONKEY!', "Hello, Mr Monkey! I'm standing tall today."], ['HELLO!', 'Hello! A castle is always ready.'], ['GOOD TO SEE YOU.', 'Good to see you, Mr Monkey. Come and stand by my wall.']],
    chat: [['I AM STRONG.', "I'm a castle, so I'm very strong. Nothing knocks me over!"], ['I GO STRAIGHT.', 'I only go straight. No wiggles for me!'], ['I LIKE TOWERS.', "I like tall towers. I AM a tall tower!"],
      ['I HAVE A FLAG.', 'I have a little flag on top. Can you see it?'], ['I GUARD THE CORNER.', 'I guard the corner of the board. Nobody gets past me!']],
    ask: [['MY TURN TO ASK.', 'My turn to ask! Listen carefully.'], ['HERE IS ONE.', "Here's one for you. Ready?"]],
    right: [['STRONG WORK!', 'Strong work! Just like a castle!'], ['SOLID!', 'Solid as a rock! Well done!'], ['TALL AND PROUD!', "That's tall and proud, that is!"], ['STRAIGHT TO IT!', 'Straight to it! Like a Rook!'], ['WALLS UP! HOORAY!', 'Walls up! Hooray!']],
    wrong: [['STAND TALL.', "Stand tall. A castle never gives up. Try again!"], ['STEADY NOW.', 'Steady now. Have another look.'], ['A CASTLE WAITS.', 'A castle can wait. Take your time.']],
    story: [['THAT IS ME.', "That's me! Straight lines, all day long."], ['I TOLD IT WELL.', "I told that well, didn't I?"]],
    sticker: [['A STICKER!', 'A sticker! I would put that on my tower!'], ['CASTLE CHEER!', 'Castle cheer! Hip hip hooray!'], ['RAISE THE FLAG!', 'Raise the flag! A sticker for Mr Monkey!']],
  },
  knight: {
    hello: [['NEIGH! HI!', 'Neigh! Hi, Mr Monkey! Want to see me jump?'], ['HELLO, MONKEY!', 'Hello, Monkey! I just galloped here.'], ['NEIGH, NEIGH!', 'Neigh, neigh! That means hello twice!']],
    chat: [['I CAN JUMP!', 'I can jump over anybody! Boing!'], ['I GO IN AN L.', "I go two steps and a turn. It's an L shape!"], ['I AM FAST.', "I'm the fastest horse there is. Neigh!"],
      ['I LIKE CARROTS.', 'I like carrots. And apples. And oats.'], ['MY MANE IS SHINY.', 'My mane is very shiny today. I brushed it.']],
    ask: [['A QUESTION! NEIGH!', 'A question! Neigh! Here it comes.'], ['WATCH THIS.', 'Watch this. Ready, set, go!']],
    right: [['NEIGH! YES!', 'Neigh! Yes! Jump for joy!'], ['GALLOP!', 'Gallop, gallop, hooray!'], ['YOU JUMPED IT!', 'You jumped right over that one!'], ['BOING! CORRECT!', 'Boing! Correct! Boing boing!'], ['FAST THINKING!', 'Fast thinking! As fast as me!']],
    wrong: [['WHOA THERE.', 'Whoa there! Slow down and look again.'], ['A LITTLE HOP.', 'Take a little hop back and try once more.'], ['EASY, EASY.', 'Easy, easy. Even horses miss a jump.']],
    story: [['NEIGH!', 'Neigh! Did you like my story?'], ['I LOVE JUMPING.', 'I love jumping. Did I say that already?']],
    sticker: [['A HORSE STICKER?', 'Is it a horse sticker? Can I see?'], ['NEIGH-HOORAY!', 'Neigh-hooray! A sticker for Mr Monkey!'], ['JUMP FOR JOY!', 'Jump for joy! Boing boing boing!']],
  },
  king: {
    hello: [['HELLO, MR MONKEY.', 'Hello, Mr Monkey. The King is pleased to see you.'], ['GOOD DAY!', 'Good day, good day! Welcome!'], ['AH, MR MONKEY.', 'Ah, Mr Monkey. Right on time.']],
    chat: [['I HAVE A CROWN.', 'I have a crown with a little cross on top. Do you like it?'], ['ONE STEP AT A TIME.', 'I take one step at a time. No rush for a king!'], ['I AM VERY IMPORTANT.', 'I am very, very important. Everyone looks after me.'],
      ['I LIVE IN A CASTLE.', 'I live in a castle. The Rook, actually. Shh.'], ['I LIKE CAKE.', 'I like cake. Royal cake, with a crown on it.']],
    ask: [['A ROYAL QUESTION.', 'A royal question! Listen well.'], ['THE KING ASKS.', 'The King asks, and you answer. Ready?']],
    right: [['ROYAL CHEER!', 'A royal cheer for that! Splendid!'], ['SPLENDID!', 'Splendid! Simply splendid!'], ['THE KING IS PLEASED.', 'The King is pleased. Very pleased indeed.'], ['MARVELLOUS!', 'Marvellous! Bring out the cake!'], ['A ROYAL YES!', 'A royal yes! Hooray!']],
    wrong: [['TAKE YOUR TIME.', 'Take your time. Kings never hurry.'], ['LOOK AGAIN.', 'Look again, my friend. You will find it.'], ['HMM. NOT THAT.', 'Hmm. Not that one. Try once more.']],
    story: [['A FINE STORY.', 'A fine story, if I say so myself.'], ['THANK YOU.', 'Thank you, thank you. You may clap now.']],
    sticker: [['A ROYAL STICKER!', 'A royal sticker! Put it somewhere grand.'], ['HOORAY!', 'Hooray! The King declares a party!'], ['CAKE FOR EVERYONE!', 'Cake for everyone! And a sticker for Mr Monkey!']],
  },
  queen: {
    hello: [['HELLO, DEAR MONKEY.', 'Hello, dear Monkey. Lovely to see you.'], ['GOOD TO SEE YOU!', 'Good to see you! Shall we begin?'], ['HELLO, LITTLE ONE.', 'Hello, little one. Come and sit with me.']],
    chat: [['I GO EVERYWHERE.', 'I can go everywhere! Straight, or up the stairs.'], ['MY CROWN HAS POINTS.', 'My crown has lots of points. Count them if you like!'], ['I AM VERY KIND.', 'I am very kind, and very clever too.'],
      ['I LOOK AFTER EVERYONE.', 'I look after everyone on the board. Even the King.'], ['I LIKE FLOWERS.', 'I like flowers. Yellow ones, mostly.']],
    ask: [['HERE IS A QUESTION.', 'Here is a question for you, dear.'], ['LISTEN, DEAR.', 'Listen, dear. This one is yours.']],
    right: [['BEAUTIFULLY DONE!', 'Beautifully done! Just beautiful.'], ['WONDERFUL!', 'Wonderful! You are so clever.'], ['THE QUEEN APPROVES.', 'The Queen approves. Well done!'], ['OH, BRAVO!', 'Oh, bravo! Bravo!'], ['PERFECT, DEAR.', 'Perfect, dear. Simply perfect.']],
    wrong: [['NEVER MIND.', 'Never mind, dear. Have another go.'], ['GENTLY NOW.', 'Gently now. Look at each one.'], ['ALMOST, DEAR.', 'Almost, dear. One more look.']],
    story: [['I DO LOVE A STORY.', 'I do love a story. Thank you for listening.'], ["WASN'T THAT NICE?", "Wasn't that nice? Now, let's play."]],
    sticker: [['HOW LOVELY!', 'How lovely! A sticker for your collection, Mr Monkey.'], ['A PARTY!', 'A party! Everyone is invited!'], ['WELL EARNED!', 'Well earned, both of you!']],
  },
  bishop: {
    hello: [['HI, FRIEND!', 'Hi, friend! Can I help with anything?'], ['HELLO, MR MONKEY!', "Hello, Mr Monkey! Nice hat day, isn't it?"], ['OH, HELLO!', "Oh, hello! I was just tidying my hat."]],
    chat: [['I CLIMB STAIRS.', 'I climb the stairs, corner to corner. Up, up, up!'], ['I LIKE MY HAT.', "I like my tall pointy hat. It's very tall."], ['I STAY ON MY COLOUR.', 'I always stay on my own colour. Always!'],
      ['I HELP THE KING.', 'I help the King. And the Queen. I help everybody!'], ['I AM GOOD AT STAIRS.', "I'm very good at stairs. Up and down, all day."]],
    ask: [['LET ME HELP.', "Let me help you with this one. Here's the question."], ['A QUESTION FOR YOU.', 'A question for you! I know you can do it.']],
    right: [['HELPFUL!', 'Helpful and clever! Great job!'], ['UP THE STAIRS!', 'Up the stairs we go! Yes!'], ['HAT OFF TO YOU!', "Hat off to you! Well, nearly. It's a tall hat."], ['THAT HELPED!', 'That helped a lot! Well done!'], ['TOP OF THE STAIRS!', 'Top of the stairs! Hooray!']],
    wrong: [['I CAN HELP.', 'I can help! Look at the glowing one.'], ['NOT THAT ONE.', "Not that one. But you're close!"], ['ONE STEP BACK.', 'One step back down the stairs, and try again.']],
    story: [['I HOPE THAT HELPED.', 'I hope that helped! I like to help.'], ['THE END!', 'The end! Shall we play now?']],
    sticker: [['A STICKER! HOORAY!', "A sticker! Hooray! I'll help you stick it on."], ['WELL DONE, BOTH!', 'Well done, both of you!'], ['STICK IT UP HIGH!', 'Stick it up high! I can reach, with my hat.']],
  },
  pawn: {
    hello: [['HI! HI! HI!', 'Hi! Hi! Hi, Mr Monkey!'], ['HELLO UP THERE!', "Hello up there! I'm down here!"], ['YOU CAME!', 'You came! I was waiting for you!']],
    chat: [['I AM LITTLE.', "I'm the littlest one. But I'm brave!"], ['I STEP FORWARD.', 'I step forward, one little step at a time.'], ['I WANT TO BE BIG.', 'One day I want to be big like the Queen!'],
      ['I HAVE LOTS OF FRIENDS.', 'I have lots of friends. There are eight of me!'], ['I AM FIRST.', "I go first. I'm always at the front!"]],
    ask: [['CAN I ASK?', 'Can I ask? Can I? Okay, here it is!'], ['MY QUESTION!', 'My question! Listen, listen!']],
    right: [['YAY! YAY!', 'Yay! Yay! You did it!'], ['LITTLE CHEER!', 'A little cheer from a little pawn! Hooray!'], ['SO GOOD!', 'So good! So, so good!'], ['I KNEW IT!', 'I knew it! I knew you could!'], ['HOP HOP HOORAY!', 'Hop hop hooray!']],
    wrong: [["IT'S OKAY.", "It's okay. I get things wrong too. Try again!"], ['ONE MORE STEP.', 'One more step. You can do it!'], ["DON'T BE SAD.", "Don't be sad. I'm little and I keep trying!"]],
    story: [['THAT WAS ME!', 'That was me! The littlest one!'], ['DID YOU LIKE IT?', 'Did you like it? I was a bit nervous.']],
    sticker: [['OOH, A STICKER!', 'Ooh, a sticker! Can I hold it?'], ['WE DID IT!', 'We did it! All of us!'], ['SO SHINY!', "So shiny! It's the shiniest one yet!"]],
  },
  ollie: {
    hello: [['HOOT! HELLO.', 'Hoot! Hello, Mr Monkey. I was just reading.'], ['HI, MR MONKEY.', 'Hi, Mr Monkey. Ready for some words?'], ['HOOT HOOT, FRIEND.', 'Hoot hoot, friend. Pull up a branch.']],
    chat: [['I LOVE BOOKS.', 'I love books. I read one every night.'], ['WORDS ARE FUN.', 'Words are fun! Every word is a little puzzle.'], ['HOOT HOOT.', 'Hoot hoot. That means hello in owl.'],
      ['I STAY UP LATE.', 'I stay up late. Owls do that. Reading, mostly.'], ['I CAN TURN MY HEAD.', 'I can turn my head almost all the way round. Watch!']],
    ask: [['A WORD FOR YOU.', 'A word for you! Look at the letters.'], ['READY TO READ?', 'Ready to read? Hoot! Here we go.']],
    right: [['HOOT! YES!', 'Hoot! Yes! You read it!'], ['WISE CHOICE!', 'A wise choice! Very wise.'], ['CLEVER READER!', 'Clever reader! Hoot hoot!'], ['BOOK-SMART!', "Book-smart! That's what you are!"], ['HOOT HOORAY!', 'Hoot hooray! Right again!']],
    wrong: [['LOOK AT THE LETTERS.', 'Look at the letters, one at a time.'], ['HOOT. TRY AGAIN.', 'Hoot. Try again, slowly.'], ['SOUND IT OUT.', 'Sound it out. The first letter helps.']],
    story: [['THE END.', 'The end. I love a good story.'], ['HOOT. ALL DONE.', 'Hoot. All done. Shall we read some words?']],
    sticker: [['A STICKER FOR MONKEY!', 'A sticker for Mr Monkey! Hoot hooray!'], ['HOW WISE!', 'How wise you both are!'], ['IN THE BOOK!', 'Put it in the book! The sticker book!']],
  },
  benny: {
    hello: [['HI, MR MONKEY!', 'Hi, Mr Monkey! Want a berry?'], ['HELLO, BUDDY.', "Hello, buddy. It's a good day for counting."], ['BIG HUG!', 'Big hug! Hello, Mr Monkey!']],
    chat: [['I LIKE BERRIES.', 'I like berries. One, two, three berries!'], ['I AM CUDDLY.', "I'm very cuddly. Everyone says so."], ["LET'S COUNT.", "Let's count something. Anything! I love counting."],
      ['I HAVE A BASKET.', 'I have a basket. It is full of berries. Mostly.'], ['I LIKE NAPS.', 'I like naps. After counting, a nice long nap.']],
    ask: [['COUNT WITH ME.', "Count with me! Here's the question."], ['A COUNTING ONE!', 'A counting one! Yum. I mean, yay.']],
    right: [['BEARY GOOD!', 'Beary good! Beary, beary good!'], ['YES! COUNTED IT!', 'Yes! You counted it right!'], ['BIG BEAR HUG!', 'Big bear hug for that one!'], ['BERRY NICE!', 'Berry nice! Get it? Berry!'], ['ONE MORE BERRY!', 'One more berry for you! Well done!']],
    wrong: [['COUNT AGAIN.', 'Count again, nice and slow. One... two...'], ['NEARLY, BUDDY.', 'Nearly, buddy. Have another go.'], ['USE YOUR FINGER.', 'Use your finger. Point at each one.']],
    story: [['THAT WAS MY STORY.', 'That was my story. Did you like the berries part?'], ['ALL DONE.', 'All done. Now, who wants to count?']],
    sticker: [['A STICKER! YUM.', "A sticker! Yum. Wait, you can't eat stickers."], ['BEAR CHEER!', 'Bear cheer! Hooray for Mr Monkey!'], ['ONE MORE STICKER!', 'One more sticker! Let\'s count them all!']],
  },
  zip: {
    hello: [['BEEP! HELLO.', 'Beep! Hello, Mr Monkey. Systems ready.'], ['HI, MONKEY. BEEP.', "Hi, Monkey. Beep boop. Let's add some numbers."], ['ROBOT SAYS HI.', 'Robot says hi. Beep beep!']],
    chat: [['I LOVE SUMS.', 'I love sums! One plus one is two. Beep!'], ['I AM A ROBOT.', "I'm a robot. I have buttons. Please don't press them."], ['BEEP BOOP.', "Beep boop. That means I'm happy."],
      ['I NEVER GET TIRED.', 'I never get tired. I just need charging.'], ['MY LIGHT IS ON.', 'My light is on. That means thinking.']],
    ask: [['QUESTION LOADING.', 'Question loading. Beep. Here it is!'], ['SUM TIME!', 'Sum time! Beep boop! Ready?']],
    right: [['CORRECT! BEEP!', 'Correct! Beep beep! Correct!'], ['COMPUTING... YES!', 'Computing... Yes! That is right!'], ['ROBOT DANCE!', 'Robot dance! Beep boop beep!'], ['ANSWER ACCEPTED.', 'Answer accepted. Great job. Beep!'], ['ONE HUNDRED PERCENT!', 'One hundred percent! Beep!']],
    wrong: [['RECALCULATING.', 'Recalculating. Try again, please.'], ['BEEP. NOT QUITE.', 'Beep. Not quite. Count once more.'], ['ERROR? NO PROBLEM.', 'Error? No problem. Robots try again too.']],
    story: [['STORY COMPLETE.', 'Story complete. Beep! Did you enjoy it?'], ['BOOP. THE END.', 'Boop. The end. Sums now?']],
    sticker: [['STICKER DETECTED!', 'Sticker detected! Beep beep hooray!'], ['ADDING ONE STICKER.', 'Adding one sticker to the collection. Beep!'], ['ROBOT PARTY!', 'Robot party! Beep boop beep boop!']],
  },
};

// ── Mr Monkey's own lines ─────────────────────────────────────────────────────────────────────────────
const MONKEY_HELLOS: Record<Cast, L[]> = {
  rook: [['HI, ROOK!', 'Hi, Rook! You look very tall today.'], ['HELLO, CASTLE!', 'Hello, Castle! Can I climb you? Just kidding.'], ['ROOK! MY FRIEND!', 'Rook! My friend! Let\'s play!']],
  knight: [['HI, KNIGHT!', 'Hi, Knight! Neigh! Did I say it right?'], ['HELLO, HORSE!', 'Hello, Horse! Can I have a ride? Later? Okay.'], ['KNIGHT! JUMP FOR ME!', 'Knight! Jump for me! Boing!']],
  king: [['HI, KING!', 'Hi, King! I like your crown!'], ['HELLO, YOUR MAJESTY!', 'Hello, your Majesty! Should I bow? I will bow.'], ['KING! IS THERE CAKE?', 'King! Is there cake today?']],
  queen: [['HI, QUEEN!', 'Hi, Queen! You have the pointiest crown!'], ['HELLO, QUEEN!', "Hello, Queen! You are my favourite. Don't tell the King."], ['QUEEN! I MISSED YOU!', 'Queen! I missed you!']],
  bishop: [['HI, BISHOP!', 'Hi, Bishop! That hat is so tall!'], ['HELLO, BISHOP!', "Hello, Bishop! Can I try your hat on? It's too tall for me."], ['BISHOP! HELP ME!', 'Bishop! Help me get a sticker!']],
  pawn: [['HI, LITTLE PAWN!', 'Hi, little Pawn! You are little, like me!'], ['HELLO, PAWN!', "Hello, Pawn! Let's be brave together."], ['PAWN! YOU ARE FIRST!', 'Pawn! You are first! Go, go, go!']],
  ollie: [['HI, OLLIE!', 'Hi, Ollie! Read me a story later?'], ['HELLO, OWL!', 'Hello, Owl! Hoot hoot! That means hi, right?'], ['OLLIE! A BOOK!', 'Ollie! You brought a book! What is it about?']],
  benny: [['HI, BENNY!', 'Hi, Benny! Yes please, I want a berry!'], ['HELLO, BEAR!', 'Hello, Bear! You give the best hugs.'], ['BENNY! HUG TIME!', 'Benny! Hug time! Come here!']],
  zip: [['HI, ZIP!', 'Hi, Zip! Beep boop to you too!'], ['HELLO, ROBOT!', 'Hello, Robot! Can I press a button? Just one?'], ['ZIP! IS YOUR LIGHT ON?', 'Zip! Is your light on? It is! You are thinking!']],
};
const MONKEY_CHAT_REPLY: L[] = [
  ['WOW!', 'Wow! That is so cool!'], ['ME TOO!', 'Me too! Well, sort of.'], ['I LIKE THAT.', 'I like that. I like you!'],
  ['COOL!', "Cool! Okay, let's play!"], ['HA HA!', 'Ha ha! You are funny.'], ["OKAY, LET'S GO!", "Okay, let's go! Are you ready?"],
  ['REALLY?', 'Really? I did not know that!'], ['THAT IS AMAZING.', 'That is amazing. You are amazing.'],
  ['YOU ARE THE BEST.', 'You are the best. Now, a question!'], ['TELL ME MORE LATER.', 'Tell me more later! First, a question for you.'],
];
/** Mr Monkey asks the character to ask the question. */
const MONKEY_HANDOFF: Record<Cast, L[]> = {
  rook: [['ROOK, ASK ONE!', 'Rook, ask one!'], ['YOUR TURN, ROOK.', 'Your turn, Rook. Ask a question!']],
  knight: [['KNIGHT, ASK ONE!', 'Knight, ask one!'], ['GO ON, KNIGHT.', 'Go on, Knight. Ask away!']],
  king: [['KING, ASK ONE!', 'King, ask one! Please, your Majesty.'], ['YOUR TURN, KING.', 'Your turn, King. A royal question!']],
  queen: [['QUEEN, ASK ONE!', 'Queen, ask one!'], ['YOUR TURN, QUEEN.', 'Your turn, Queen. Ask a question!']],
  bishop: [['BISHOP, ASK ONE!', 'Bishop, ask one!'], ['YOUR TURN, BISHOP.', 'Your turn, Bishop. Ask away!']],
  pawn: [['PAWN, ASK ONE!', 'Pawn, ask one!'], ['YOUR TURN, PAWN.', 'Your turn, little Pawn. Ask a question!']],
  ollie: [['OLLIE, ASK ONE!', 'Ollie, ask one!'], ['YOUR TURN, OLLIE.', 'Your turn, Ollie. A word question!']],
  benny: [['BENNY, ASK ONE!', 'Benny, ask one!'], ['YOUR TURN, BENNY.', 'Your turn, Benny. A counting question!']],
  zip: [['ZIP, ASK ONE!', 'Zip, ask one!'], ['YOUR TURN, ZIP.', 'Your turn, Zip. A sum, please!']],
};
const MONKEY_RIGHT: L[] = [
  ['HIGH FIVE, FRIEND!', 'High five, friend! Up top!'], ['WE DID IT!', 'We did it! Together!'], ['THAT WAS GREAT!', 'That was great! I knew you could!'],
  ['STICKER TIME SOON!', 'Sticker time soon! Keep going!'], ['MONKEY DANCE!', 'Monkey dance! Ooh ooh ah ah!'], ['SO SMART!', 'So smart! You are so smart!'],
  ['I AM SO HAPPY!', 'I am so happy I could swing from a tree!'], ['BANANAS!', 'Bananas! That means amazing!'],
  ['YES YES YES!', 'Yes yes yes! That is the one!'], ['YOU GOT IT!', 'You got it! First try or not, you got it!'],
  ['CLAP CLAP!', 'Clap clap! Everybody clap!'], ['ONE STEP CLOSER!', 'One step closer to a sticker!'],
];
const MONKEY_WRONG: L[] = [
  ["THAT'S OKAY.", "That's okay. Everybody gets some wrong."], ['TRY AGAIN!', 'Try again! I believe in you.'], ['LOOK CLOSELY.', 'Look closely. Take your time.'],
  ['NEARLY!', 'Nearly! You are getting close.'], ["DON'T WORRY.", "Don't worry. I'm right here."], ['ONE MORE TRY.', 'One more try. You can do it!'],
  ['HMM, NOT THAT ONE.', 'Hmm, not that one. Which one, then?'], ['I GET IT WRONG TOO.', 'I get things wrong too. Lots!'],
  ['DEEP BREATH.', 'Deep breath. Now look again.'], ['YOU ARE DOING GREAT.', 'You are doing great. Keep going.'],
];
const MONKEY_STORY: Record<Cast, L[]> = {
  rook: [['WOW, ROOK!', 'Wow, Rook! Straight lines are so cool!'], ['GOOD STORY, ROOK!', 'Good story, Rook! I want a flag too.']],
  knight: [['BOING!', 'Boing! I want to jump like that!'], ['GOOD STORY, KNIGHT!', 'Good story, Knight! Neigh!']],
  king: [['NICE CROWN!', 'Nice crown, King! Great story!'], ['GOOD STORY, KING!', 'Good story, King! Very royal.']],
  queen: [['SO CLEVER!', 'So clever, Queen! Everywhere!'], ['GOOD STORY, QUEEN!', 'Good story, Queen! I clapped the loudest.']],
  bishop: [['UP THE STAIRS!', 'Up the stairs! I like stairs too!'], ['GOOD STORY, BISHOP!', 'Good story, Bishop! That helped!']],
  pawn: [['BRAVE PAWN!', 'Brave little Pawn! That was a good story.'], ['GOOD STORY, PAWN!', 'Good story, Pawn! You were not nervous at all.']],
  ollie: [['GOOD STORY, OLLIE!', 'Good story, Ollie! Hoot hoot!'], ['READ IT AGAIN!', 'Read it again! Later. Okay, later.']],
  benny: [['I WANT A BERRY!', 'I want a berry! Good story, Benny!'], ['GOOD STORY, BENNY!', 'Good story, Benny! Now I am hungry.']],
  zip: [['BEEP BOOP!', 'Beep boop! Good story, Zip!'], ['GOOD STORY, ZIP!', 'Good story, Zip! Your light was on the whole time.']],
};
const MONKEY_STICKER: L[] = [
  ['A NEW STICKER!', 'A new sticker for my collection! Thank you!'], ['I LOVE IT!', 'I love it! Where should I stick it?'],
  ['LOOK AT MY STICKERS!', 'Look at all my stickers! You helped me get every one.'], ['BEST DAY EVER!', 'Best day ever! Another sticker!'],
  ['MY COLLECTION IS GROWING!', 'My collection is growing! Look how many!'], ['THANK YOU, FRIEND!', 'Thank you, friend! You are the best helper.'],
  ['I WILL KEEP IT FOREVER.', 'I will keep it forever. In my book.'], ['ONE MORE FOR THE BOOK!', 'One more for the sticker book! Hooray!'],
];
/** While Kiaan is looking at the answers (said now and then, never twice in a row). */
export const thinkingLines: L[] = [
  ['HMM, WHICH ONE?', 'Hmm, which one is it?'], ['TAKE A LOOK.', 'Take a good look.'], ['I THINK YOU KNOW.', 'I think you know this one.'],
  ['TAP THE RIGHT ONE.', 'Tap the right one when you see it.'], ['NO RUSH.', 'No rush. I can wait. I am very patient.'],
  ['LOOK AT THEM ALL.', 'Look at them all, one by one.'], ['WHAT DO YOU THINK?', `What do you think? I think... hmm.`],
  ['I AM WATCHING.', 'I am watching. Go on!'],
];
/** When Kiaan taps Mr Monkey on his own: stickers, bananas, friends. */
export const monkeyTap = (name: string): BanterLine[] => [
  M('HI!', `Hi ${name}! That tickles!`), M('I LOVE STICKERS.', 'I love stickers. Shiny ones, sparkly ones, all of them!'),
  M('I LIKE BANANAS.', 'I like bananas. Do you like bananas?'), M('YOU ARE MY FRIEND.', `You are my best friend, ${name}.`),
  M("LET'S GET A STICKER!", "Let's get a sticker! Answer the question!"), M('OOH OOH AH AH!', 'Ooh ooh ah ah! That is monkey for hello.'),
  M('I AM SO FLOPPY.', 'I am so floppy. Look at my arms!'), M('WHO IS THAT?', `Who is that? Oh, it's you, ${name}!`),
  M('MY TAIL IS CURLY.', 'My tail is curly. Can you see it?'), M('I CAN SWING!', 'I can swing from trees! Not right now, though.'),
  M('HIGH FIVE?', 'High five? Tap my hand!'), M('I HAVE A BUTTON.', 'I have a button on my shirt. Just one.'),
  M('SHALL WE PLAY?', 'Shall we play? Tap the answer!'), M('YOU ARE CLEVER.', `You are so clever, ${name}. I mean it.`),
  M('MONKEY SEE!', 'Monkey see, monkey do! What are you doing?'), M('I AM LISTENING.', `I am listening, ${name}. Go on!`),
  M('I AM SOFT.', 'I am very soft. Squishy, even.'), M('MY SHIRT IS STRIPY.', 'My shirt is stripy. Red and white, red and white.'),
  M('I SLEEP IN YOUR BED.', `I sleep in your bed, ${name}. It is very cosy.`), M('TICKLE TICKLE!', 'Tickle tickle! Ha ha, stop it!'),
  M('I LIKE YOUR FACE.', 'I like your face. It is a nice face.'), M('ARE YOU HAPPY?', `Are you happy, ${name}? I am happy.`),
  M('MONKEY HUG!', 'Monkey hug! Squeeze!'), M('I CAN COUNT TO THREE.', 'I can count to three. One, two, three! Did it.'),
  M('WHERE IS MY BANANA?', 'Where is my banana? Did you eat it?'), M('I AM A GOOD MONKEY.', 'I am a good monkey. Mostly.'),
  M('BOO!', 'Boo! Did I scare you? Sorry!'), M('I LIKE THIS GAME.', 'I like this game. It has stickers in it.'),
  M('MY EARS ARE SMALL.', 'My ears are small. But I hear everything!'), M('YOU TAPPED ME!', 'You tapped me! Tap me again!'),
];
/** The home screen: who he is and what the game is. */
export const monkeyWelcome = (name: string): BanterLine[] => [
  M(`HI ${name.toUpperCase()}! I AM MR MONKEY.`, `Hi ${name}! I'm Mr Monkey! I'm collecting stickers. Will you help me? Let's play!`),
  M('HELP MR MONKEY GET STICKERS!', 'Help Mr Monkey get stickers! Every time you finish a lesson, he gets a new one for his collection.'),
  M('MY FRIENDS ARE HERE!', 'My friends are here! The chess pieces, Ollie, Benny and Zip. Say hi!'),
  M('TAP PLAY!', 'Tap the big yellow PLAY button and we can start!'),
  M('I HAVE A STICKER BOOK.', 'I have a sticker book. It is down there. Look!'),
  M('EVERY LESSON IS A STICKER.', 'Every lesson you finish is a sticker for me. Deal?'),
];

// ── the exchanges ─────────────────────────────────────────────────────────────────────────────────────
const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];
const line = (who: Cast, [text, said]: L) => C(who, text, said);
const rnd = () => Math.floor(Math.random() * 1e6);

/** A lesson with this character starts: Mr Monkey says hi, the character says hi back and tells him something, he replies. */
export function opener(cast: Cast, seed = rnd()): Exchange {
  const v = VOICES[cast];
  return [M(...pick(MONKEY_HELLOS[cast], seed)), line(cast, pick(v.hello, seed >> 1)), line(cast, pick(v.chat, seed >> 2)), M(...pick(MONKEY_CHAT_REPLY, seed >> 3))];
}
/** Mr Monkey hands the question to the character, who takes it (then the game reads the question). */
export function handoff(cast: Cast, seed = rnd()): Exchange {
  return [M(...pick(MONKEY_HANDOFF[cast], seed)), line(cast, pick(VOICES[cast].ask, seed >> 2))];
}
/** A right answer: the character's cheer, then Mr Monkey. */
export function cheer(cast: Cast, seed = rnd()): Exchange {
  return [line(cast, pick(VOICES[cast].right, seed)), M(...pick(MONKEY_RIGHT, seed >> 2))];
}
/** A miss: Mr Monkey first, kindly, then the character. */
export function comfort(cast: Cast, seed = rnd()): Exchange {
  return [M(...pick(MONKEY_WRONG, seed)), line(cast, pick(VOICES[cast].wrong, seed >> 2))];
}
/** After the character's story. */
export function afterStory(cast: Cast, seed = rnd()): Exchange {
  return [M(...pick(MONKEY_STORY[cast], seed)), line(cast, pick(VOICES[cast].story, seed >> 2))];
}
/** A sticker earned, with the last character on stage. */
export function stickerParty(cast: Cast, seed = rnd()): Exchange {
  return [M(...pick(MONKEY_STICKER, seed)), line(cast, pick(VOICES[cast].sticker, seed >> 2))];
}
export const thinking = (seed = rnd()): BanterLine => M(...pick(thinkingLines, seed));

/** Every line, once, for the voice script. */
export function allBanterLines(names: string[]): BanterLine[] {
  const out: BanterLine[] = [];
  for (const c of CAST) {
    for (const l of [...MONKEY_HELLOS[c], ...MONKEY_HANDOFF[c], ...MONKEY_STORY[c]]) out.push(M(...l));
    const v = VOICES[c];
    for (const l of [...v.hello, ...v.chat, ...v.ask, ...v.right, ...v.wrong, ...v.story, ...v.sticker]) out.push(line(c, l));
  }
  for (const l of [...MONKEY_CHAT_REPLY, ...MONKEY_RIGHT, ...MONKEY_WRONG, ...MONKEY_STICKER, ...thinkingLines]) out.push(M(...l));
  for (const n of names) out.push(...monkeyTap(n), ...monkeyWelcome(n));
  return out;
}
export const castLabel = (c: Cast) => NAME[c];
export const castNice = (c: Cast) => nice[c];
