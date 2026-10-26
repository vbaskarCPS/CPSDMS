#!/usr/bin/env node
// Little Chess voices — makes natural voice clips with Google Cloud Text-to-Speech ("Chirp 3 HD" voices).
//
// Easiest from a phone: Google Cloud Shell (shell.cloud.google.com), which has Node and your Google login.
//   gcloud services enable texttospeech.googleapis.com
//   curl -sO https://propertystars.app/minigame/make-little-chess-voices.mjs
//   node make-little-chess-voices.mjs samples     -> then tap Web Preview (port 8080) to listen
//   node make-little-chess-voices.mjs all         -> downloads little-chess-voices.json; send it back in chat
// In Cloud Shell no API key is needed (it uses your login). On a computer with Node 18+, it asks for a
// Google API key instead (typed in, never saved).
//
// Don't like a voice? Swap it on the command line, e.g.:   node make-little-chess-voices.mjs samples king=Charon
// Voices to try: Achernar, Achird, Algenib, Algieba, Alnilam, Aoede, Autonoe, Callirrhoe, Charon, Despina,
// Enceladus, Erinome, Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus, Puck, Pulcherrima, Rasalgethi,
// Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel, Vindemiatrix, Zephyr, Zubenelgenubi.
// If his name comes out wrong, say how it sounds:   node make-little-chess-voices.mjs samples name=Kee-ahn

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
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

// How we sign in to Google: an API key, or (in Cloud Shell) your own login.
let auth = null;   // { key } or { token, project }
const sh = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (auth.token) { h.Authorization = `Bearer ${auth.token}`; if (auth.project) h['x-goog-user-project'] = auth.project; }
  return h;
}

async function synth(key, who, text) {
  const body = (withSpeed) => JSON.stringify({
    input: { text: spoken(text) },
    voice: { languageCode: 'en-US', name: `en-US-Chirp3-HD-${VOICES[who]}` },
    audioConfig: { audioEncoding: 'MP3', ...(withSpeed ? { speakingRate: SPEED[who] || 1 } : {}) },
  });
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize' + (auth.key ? `?key=${encodeURIComponent(auth.key)}` : '');
  let r = await fetch(url, { method: 'POST', headers: headers(), body: body(true) });
  if (r.status === 400) r = await fetch(url, { method: 'POST', headers: headers(), body: body(false) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText;
    if (/not been used|disabled|SERVICE_DISABLED/i.test(msg)) throw new Error('Text-to-Speech is not turned on for this project yet. Run:  gcloud services enable texttospeech.googleapis.com  then wait a minute and try again.');
    if (/quota project|billing/i.test(msg)) throw new Error('Google needs a project for this. Run:  gcloud config set project YOUR-PROJECT-ID  (find it at the top of console.cloud.google.com), then try again.');
    if (/API key not valid/i.test(msg)) throw new Error('That API key was not accepted. Copy it again from Google Cloud > APIs & Services > Credentials.');
    if (/voice/i.test(msg)) throw new Error(`Google doesn't know the voice "${VOICES[who]}" (for ${who}). Pick another from the list at the top of this file.`);
    throw new Error(msg);
  }
  return j.audioContent; // base64 MP3
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
if (process.env.GOOGLE_TTS_KEY) auth = { key: process.env.GOOGLE_TTS_KEY };
else {
  const token = sh('gcloud auth print-access-token');
  if (token) {
    auth = { token, project: sh('gcloud config get-value project') || null };
    console.log(`Using your Google login${auth.project ? ` (project ${auth.project})` : ''}.`);
    if (!auth.project) console.log('No project set. If Google complains, run:  gcloud config set project YOUR-PROJECT-ID');
  } else {
    const k = (await rl.question('Paste your Google Cloud API key and press Enter: ')).trim();
    if (!k) { console.log('No key, nothing done.'); process.exit(1); }
    auth = { key: k };
  }
}
const key = null;   // (kept for the synth() signature)

/** A little web page with every sample, for Cloud Shell's Web Preview (port 8080). Enter stops it. */
async function serveSamples() {
  const files = readdirSync('little-chess-samples').filter(f => f.endsWith('.mp3')).sort();
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Little Chess voices</title><body style="font-family:system-ui;padding:16px;max-width:520px;margin:auto;background:#f0fdfa">
<h2>Little Chess voices</h2><p>Tap play on each one. Don't like one? Back in Cloud Shell, press Enter and run samples again with a swap, e.g. <code>king=Charon</code>.</p>
${files.map(f => `<div style="margin:14px 0;padding:12px;border-radius:12px;background:#fff"><b>${f.replace('.mp3', '')}</b><br><audio controls preload="none" style="width:100%;margin-top:6px" src="${encodeURIComponent(f)}"></audio></div>`).join('')}
</body>`;
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0].slice(1));
    if (name && files.includes(name)) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(readFileSync(`little-chess-samples/${name}`)); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page);
  });
  await new Promise(ok => server.listen(8080, ok)).catch(() => null);
  console.log('\nTo listen: tap the Web Preview button (the eye/box icon at the top of Cloud Shell) > Preview on port 8080.');
  console.log('On a computer: open http://localhost:8080');
  await rl.question('Press Enter here when you are done listening. ');
  server.close();
}

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
    await serveSamples();
    const swaps = args.filter(a => a.includes('=')).join(' ');
    console.log('\nHappy with them? Run:  node make-little-chess-voices.mjs all' + (swaps ? ' ' + swaps : ''));
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
    console.log('\n\nDone! Made little-chess-voices.json.');
    if (sh('which cloudshell')) { sh('cloudshell download little-chess-voices.json'); console.log('Your phone should now download it. (If not, run:  cloudshell download little-chess-voices.json)'); }
    console.log('Send the file "little-chess-voices.json" back in the chat.');
  } else {
    console.log('Say "samples" or "all", e.g.:  node make-little-chess-voices.mjs samples');
  }
} catch (e) {
  console.log('\nStopped: ' + e.message);
  process.exit(1);
} finally {
  rl.close();
}
