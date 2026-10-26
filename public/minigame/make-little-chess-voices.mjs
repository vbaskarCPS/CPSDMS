#!/usr/bin/env node
// Little Chess voices: makes every voice clip with Google Cloud Text-to-Speech ("Chirp 3 HD" voices),
// a warm narrator plus a voice to suit each character. One run, no choices to make.
//
// From a phone, in Google Cloud Shell (shell.cloud.google.com), which has Node and your Google login:
//   gcloud services enable texttospeech.googleapis.com
//   curl -sO https://propertystars.app/minigame/make-little-chess-voices.mjs
//   node make-little-chess-voices.mjs
// It makes little-chess-voices.json and hands it to your phone to download; send that file back in chat.
// (On a computer with Node 18+ it asks for a Google API key instead; the key is never saved.)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

// A voice to suit each character (Google's descriptions of the voices in brackets).
const VOICES = {
  narrator: 'Sulafat',   // warm: a kind grown-up reading the instructions
  rook: 'Alnilam',       // firm: a big sturdy castle
  knight: 'Fenrir',      // excitable: a bouncy horse
  king: 'Algenib',       // gravelly: a big jolly king
  queen: 'Gacrux',       // mature: a proud, kind queen
  bishop: 'Achird',      // friendly: the helpful one in the tall hat
  pawn: 'Leda',          // youthful: the littlest one
};
const SPEED = { narrator: 0.92, rook: 0.95, knight: 1.08, king: 0.9, queen: 0.95, bishop: 1, pawn: 1.1 };

// Every line: who says it, the short words on screen (which name the clip), and the full sentence said.
// (Kept in step with the app by a test; don't edit by hand.)
// LINES-START
const LINES = [["rook","THIS IS ROOK.","Hi there! I'm the Rook. I look like a castle tower!"],["narrator","FIND THE ROOK.","Can you find the Rook? Tap the Rook!"],["narrator","WHICH WORD?","Which word is this piece? Tap the right word!"],["knight","THIS IS KNIGHT.","Neigh! I'm the Knight. I look like a horse!"],["narrator","FIND THE KNIGHT.","Can you find the Knight? Tap the Knight!"],["king","THIS IS KING.","Hello! I'm the King. My crown has a little cross on top!"],["narrator","FIND THE KING.","Can you find the King? Tap the King!"],["queen","THIS IS QUEEN.","Hello! I'm the Queen. My crown has lots of points!"],["narrator","FIND THE QUEEN.","Can you find the Queen? Tap the Queen!"],["bishop","THIS IS BISHOP.","Hi! I'm the Bishop. I wear a tall pointy hat!"],["narrator","FIND THE BISHOP.","Can you find the Bishop? Tap the Bishop!"],["pawn","THIS IS PAWN.","Hi! I'm the Pawn. I'm the littlest one!"],["narrator","FIND THE PAWN.","Can you find the Pawn? Tap the Pawn!"],["narrator","WHO IS HIDING?","Someone is hiding in the shadow! Who is it? Can you guess?"],["narrator","WHO IS PEEKING?","Peekaboo! Someone is peeking over the wall. Who is it?"],["narrator","ROOK GOES STRAIGHT.","The Rook goes straight: up, down, left or right, as far as it likes. Tap a glowing square to try it!"],["narrator","GET THE STAR.","Let's get the star! Tap where the piece can go."],["narrator","GET THE STARS.","Let's get all the stars, one at a time!"],["narrator","BISHOP CLIMBS STAIRS.","The Bishop climbs the stairs, corner to corner, and always stays on its own colour. Tap a glowing square to try it!"],["narrator","QUEEN GOES EVERYWHERE.","The Queen goes everywhere! Straight like the Rook, and up the stairs like the Bishop. Tap a glowing square to try it!"],["narrator","KING STEPS ONCE.","The King steps once. Just one little step, any way he likes. Tap a glowing square to try it!"],["narrator","KNIGHT JUMPS L.","The Knight jumps in an L shape: two steps, then a turn. He can even hop over things! Tap a glowing square to try it!"],["narrator","PAWN STEPS UP.","The Pawn steps up, one little step forward at a time. Tap the glowing square to try it!"],["narrator","EAT THE APPLE.","Snack time! Can you eat the apple? Move onto it to gobble it up!"],["narrator","EAT THE APPLES.","Snack time! Eat all the apples, one at a time!"],["narrator","THAT IS ROOK.","Oops! That one is the Rook. Look carefully and try again."],["narrator","NOT THERE! ROOK GOES STRAIGHT.","Oops! The Rook can't go there. Remember, the Rook goes straight."],["narrator","THAT IS KNIGHT.","Oops! That one is the Knight. Look carefully and try again."],["narrator","NOT THERE! KNIGHT JUMPS L.","Oops! The Knight can't go there. Remember, the Knight jumps in an L shape."],["narrator","THAT IS KING.","Oops! That one is the King. Look carefully and try again."],["narrator","NOT THERE! KING STEPS ONCE.","Oops! The King can't go there. Remember, the King takes just one little step."],["narrator","THAT IS QUEEN.","Oops! That one is the Queen. Look carefully and try again."],["narrator","NOT THERE! QUEEN GOES EVERYWHERE.","Oops! The Queen can't go there. Remember, the Queen goes straight, or up the stairs."],["narrator","THAT IS BISHOP.","Oops! That one is the Bishop. Look carefully and try again."],["narrator","NOT THERE! BISHOP CLIMBS STAIRS.","Oops! The Bishop can't go there. Remember, the Bishop climbs the stairs, corner to corner."],["narrator","THAT IS PAWN.","Oops! That one is the Pawn. Look carefully and try again."],["narrator","NOT THERE! PAWN STEPS UP.","Oops! The Pawn can't go there. Remember, the Pawn steps straight up, one step."],["narrator","KIAAN GOT A STICKER!","Hooray! Kiaan got a sticker! Great job!"],["narrator","SLOW DOWN, KIAAN.","Whoa, slow down Kiaan! Take a big breath, and think about it."],["rook","YES!","Yes! You got it!"],["rook","GREAT JOB!","Great job! You're so clever!"],["rook","KIAAN DID IT!","Kiaan did it! Hooray!"],["rook","WOW!","Wow! That was amazing!"],["rook","SUPER!","Super! Give me a high five!"],["knight","YES!","Yes! You got it!"],["knight","GREAT JOB!","Great job! You're so clever!"],["knight","KIAAN DID IT!","Kiaan did it! Hooray!"],["knight","WOW!","Wow! That was amazing!"],["knight","SUPER!","Super! Give me a high five!"],["king","YES!","Yes! You got it!"],["king","GREAT JOB!","Great job! You're so clever!"],["king","KIAAN DID IT!","Kiaan did it! Hooray!"],["king","WOW!","Wow! That was amazing!"],["king","SUPER!","Super! Give me a high five!"],["queen","YES!","Yes! You got it!"],["queen","GREAT JOB!","Great job! You're so clever!"],["queen","KIAAN DID IT!","Kiaan did it! Hooray!"],["queen","WOW!","Wow! That was amazing!"],["queen","SUPER!","Super! Give me a high five!"],["bishop","YES!","Yes! You got it!"],["bishop","GREAT JOB!","Great job! You're so clever!"],["bishop","KIAAN DID IT!","Kiaan did it! Hooray!"],["bishop","WOW!","Wow! That was amazing!"],["bishop","SUPER!","Super! Give me a high five!"],["pawn","YES!","Yes! You got it!"],["pawn","GREAT JOB!","Great job! You're so clever!"],["pawn","KIAAN DID IT!","Kiaan did it! Hooray!"],["pawn","WOW!","Wow! That was amazing!"],["pawn","SUPER!","Super! Give me a high five!"]];
// LINES-END

let auth = null;   // { key } or { token, project }
const sh = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (auth.token) { h.Authorization = `Bearer ${auth.token}`; if (auth.project) h['x-goog-user-project'] = auth.project; }
  return h;
}

async function synth(who, spoken) {
  const body = (withSpeed) => JSON.stringify({
    input: { text: spoken },
    voice: { languageCode: 'en-US', name: `en-US-Chirp3-HD-${VOICES[who]}` },
    audioConfig: { audioEncoding: 'MP3', ...(withSpeed ? { speakingRate: SPEED[who] || 1 } : {}) },
  });
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize' + (auth.key ? `?key=${encodeURIComponent(auth.key)}` : '');
  // Google sometimes leaves a request hanging: give each try 30 seconds, and try up to 4 times.
  const send = async (withSpeed) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: headers(), body: body(withSpeed), signal: AbortSignal.timeout(30000) });
        if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise(ok => setTimeout(ok, 2000 * attempt)); continue; }
        return r;
      } catch (e) {
        if (attempt >= 4) throw new Error(`Google didn't answer for "${spoken.slice(0, 40)}..." after 4 tries. Run this again; it carries on where it stopped.`);
        await new Promise(ok => setTimeout(ok, 2000 * attempt));
      }
    }
  };
  let r = await send(true);
  if (r.status === 400) r = await send(false);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText;
    if (/not been used|disabled|SERVICE_DISABLED/i.test(msg)) throw new Error('Text-to-Speech is not turned on for this project yet. Run:  gcloud services enable texttospeech.googleapis.com  then wait a minute and run this again.');
    if (/quota project|billing/i.test(msg)) throw new Error('Google needs to know your project. Run:  gcloud config set project YOUR-PROJECT-ID  (shown at the top of console.cloud.google.com), then run this again.');
    if (/API key not valid/i.test(msg)) throw new Error('That API key was not accepted.');
    throw new Error(msg);
  }
  return j.audioContent; // base64 MP3
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (process.env.GOOGLE_TTS_KEY) auth = { key: process.env.GOOGLE_TTS_KEY };
  else {
    const token = sh('gcloud auth print-access-token');
    if (token) auth = { token, project: sh('gcloud config get-value project') || null };
    else {
      const k = (await rl.question('Paste your Google Cloud API key and press Enter: ')).trim();
      if (!k) throw new Error('No key, nothing done.');
      auth = { key: k };
    }
  }
  console.log(`Making ${LINES.length} voice clips${auth.project ? ` (project ${auth.project})` : ''}...`);
  // carry on from an earlier run that stopped part way (same voices only)
  const PART = 'little-chess-voices.partial.json';
  let clips = {};
  try { const old = JSON.parse(readFileSync(PART, 'utf8')); if (JSON.stringify(old.voices) === JSON.stringify(VOICES)) clips = old.clips || {}; } catch { /* fresh start */ }
  const todo = LINES.map(([who, text, spoken]) => ({ who, spoken, id: `${who}--${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` }))
    .filter(l => !clips[l.id]);
  let n = LINES.length - todo.length;
  const show = () => process.stdout.write(`\rmade ${n} of ${LINES.length}`);
  show();
  // four at a time
  const workers = Array.from({ length: 4 }, async () => {
    while (todo.length) {
      const l = todo.shift();
      // Google now and then answers OK with no audio: ask again (a few times) rather than keep a gap
      let audio = null;
      for (let t = 1; t <= 4 && !audio; t++) audio = await synth(l.who, l.spoken);
      if (!audio) throw new Error(`Google sent no audio for "${l.spoken.slice(0, 40)}..." Run this again; it carries on where it stopped.`);
      clips[l.id] = audio;
      n++; show();
      writeFileSync(PART, JSON.stringify({ voices: VOICES, clips }));
    }
  });
  await Promise.all(workers);
  writeFileSync('little-chess-voices.json', JSON.stringify({ made: new Date().toISOString(), voices: VOICES, clips }));
  if (existsSync(PART)) writeFileSync(PART, '{}');
  console.log('\n\nDone! Made little-chess-voices.json.');
  if (sh('which cloudshell')) { sh('cloudshell download little-chess-voices.json'); console.log('Your phone should download it now. (If not, run:  cloudshell download little-chess-voices.json)'); }
  console.log('Send the file "little-chess-voices.json" back in the chat.');
} catch (e) {
  console.log('\nStopped: ' + e.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
