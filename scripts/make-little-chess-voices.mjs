#!/usr/bin/env node
// Little Chess voices — makes natural voice clips with Google Cloud Text-to-Speech ("Chirp 3 HD" voices).
// Run it on your own computer (it needs Node.js 18 or newer). Your Google API key is typed in when asked
// and is never saved anywhere.
//
//   1) Listen to the sample voices first:     node make-little-chess-voices.mjs samples
//      -> makes a folder "little-chess-samples" with one clip per voice.
//   2) Make every clip:                       node make-little-chess-voices.mjs all
//      -> makes "little-chess-voices.json" (all the clips in one file). Send that file back in chat.
//
// Don't like a voice? Swap it on the command line, e.g.:   node make-little-chess-voices.mjs samples king=Charon
// Voices to try: Achernar, Achird, Algenib, Algieba, Alnilam, Aoede, Autonoe, Callirrhoe, Charon, Despina,
// Enceladus, Erinome, Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus, Puck, Pulcherrima, Rasalgethi,
// Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel, Vindemiatrix, Zephyr, Zubenelgenubi.
// If his name comes out wrong, say how it sounds:   node make-little-chess-voices.mjs samples name=Kee-ahn

import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// Who sounds like what (Google's own descriptions in brackets). Change any of these freely.
const VOICES = {
  narrator: 'Sulafat',   // warm
  rook: 'Alnilam',       // firm: a sturdy castle
  knight: 'Fenrir',      // excitable: a bouncy horse
  king: 'Algenib',       // gravelly: a big jolly king
  queen: 'Kore',         // firm: a proud queen
  bishop: 'Achird',      // friendly
  pawn: 'Leda',          // youthful: the little one
};
const SPEED = { narrator: 0.9, rook: 1, knight: 1.08, king: 0.92, queen: 1, bishop: 1, pawn: 1.1 };

// Every line the game says, and who says it. (Kept in step with the app by a test; don't edit by hand.)
// LINES-START
const LINES = [["rook","THIS IS ROOK."],["narrator","FIND THE ROOK."],["narrator","WHICH WORD?"],["knight","THIS IS KNIGHT."],["narrator","FIND THE KNIGHT."],["king","THIS IS KING."],["narrator","FIND THE KING."],["queen","THIS IS QUEEN."],["narrator","FIND THE QUEEN."],["bishop","THIS IS BISHOP."],["narrator","FIND THE BISHOP."],["pawn","THIS IS PAWN."],["narrator","FIND THE PAWN."],["narrator","ROOK GOES STRAIGHT."],["narrator","GET THE STAR."],["narrator","GET THE STARS."],["narrator","BISHOP CLIMBS STAIRS."],["narrator","QUEEN GOES EVERYWHERE."],["narrator","KING STEPS ONCE."],["narrator","KNIGHT JUMPS L."],["narrator","PAWN STEPS UP."],["narrator","EAT THE APPLE."],["narrator","EAT THE APPLES."],["narrator","KIAAN GOT A STICKER!"],["rook","YES!"],["rook","GREAT JOB!"],["rook","KIAAN DID IT!"],["rook","WOW!"],["rook","SUPER!"],["knight","YES!"],["knight","GREAT JOB!"],["knight","KIAAN DID IT!"],["knight","WOW!"],["knight","SUPER!"],["king","YES!"],["king","GREAT JOB!"],["king","KIAAN DID IT!"],["king","WOW!"],["king","SUPER!"],["queen","YES!"],["queen","GREAT JOB!"],["queen","KIAAN DID IT!"],["queen","WOW!"],["queen","SUPER!"],["bishop","YES!"],["bishop","GREAT JOB!"],["bishop","KIAAN DID IT!"],["bishop","WOW!"],["bishop","SUPER!"],["pawn","YES!"],["pawn","GREAT JOB!"],["pawn","KIAAN DID IT!"],["pawn","WOW!"],["pawn","SUPER!"]];
// LINES-END

const args = process.argv.slice(2);
const mode = args.find(a => !a.includes('=')) || 'samples';
let sayName = null;
for (const a of args.filter(a => a.includes('='))) {
  const [k, v] = a.split('=');
  if (k === 'name') sayName = v;
  else if (k in VOICES) VOICES[k] = v;
  else console.log(`(ignoring "${a}": not one of ${Object.keys(VOICES).join(', ')}, name)`);
}

/** CAPITALS on screen; normal sentence case for the voice (and the name said the way you asked). */
function spoken(text) {
  let t = text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  t = t.replace(/\bl\.$/, 'L.').replace(/\bkiaan\b/gi, sayName || 'Kiaan');
  return t;
}

async function synth(key, who, text) {
  const body = (withSpeed) => JSON.stringify({
    input: { text: spoken(text) },
    voice: { languageCode: 'en-US', name: `en-US-Chirp3-HD-${VOICES[who]}` },
    audioConfig: { audioEncoding: 'MP3', ...(withSpeed ? { speakingRate: SPEED[who] || 1 } : {}) },
  });
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`;
  let r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(true) });
  if (r.status === 400) r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(false) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText;
    if (/not been used|disabled/i.test(msg)) throw new Error('The Text-to-Speech API is not turned on for this Google Cloud project yet. Turn it on, wait a minute, and try again.');
    if (/API key not valid/i.test(msg)) throw new Error('That API key was not accepted. Copy it again from Google Cloud > APIs & Services > Credentials.');
    if (/voice/i.test(msg)) throw new Error(`Google doesn't know the voice "${VOICES[who]}" (for ${who}). Pick another from the list at the top of this file.`);
    throw new Error(msg);
  }
  return j.audioContent; // base64 MP3
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const key = process.env.GOOGLE_TTS_KEY || (await rl.question('Paste your Google Cloud API key and press Enter: ')).trim();
rl.close();
if (!key) { console.log('No key, nothing done.'); process.exit(1); }

try {
  if (mode === 'samples') {
    mkdirSync('little-chess-samples', { recursive: true });
    const sample = { narrator: 'FIND THE KING. KIAAN GOT A STICKER!' };
    for (const who of Object.keys(VOICES)) {
      const text = sample[who] || `THIS IS ${who.toUpperCase()}. KIAAN DID IT!`;
      const b64 = await synth(key, who, text);
      const file = `little-chess-samples/${who} - ${VOICES[who]}.mp3`;
      writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log('made', file);
    }
    console.log('\nListen to the clips in the "little-chess-samples" folder.');
    console.log('Happy? Run:  node make-little-chess-voices.mjs all' + (sayName ? ` name=${sayName}` : '') + '   (add any voice swaps you used, e.g. king=Charon)');
  } else if (mode === 'all') {
    const clips = {};
    let n = 0;
    for (const [who, text] of LINES) {
      const id = `${who}--${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
      clips[id] = await synth(key, who, text);
      n++;
      process.stdout.write(`\rmade ${n} of ${LINES.length} clips`);
    }
    writeFileSync('little-chess-voices.json', JSON.stringify({ made: new Date().toISOString(), voices: VOICES, name: sayName, clips }));
    console.log('\n\nDone! Send the file "little-chess-voices.json" back in the chat.');
  } else {
    console.log('Say "samples" or "all", e.g.:  node make-little-chess-voices.mjs samples');
  }
} catch (e) {
  console.log('\nStopped: ' + e.message);
  process.exit(1);
}
