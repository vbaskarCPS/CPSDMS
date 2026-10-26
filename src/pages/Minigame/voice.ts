// src/pages/Minigame/voice.ts — the tablet's own voice, picking the most natural-sounding one it has.
// Phones and tablets ship several voices; the newer "natural", "neural", "enhanced" or Google network
// voices sound far less robotic than the default. A grown-up can also pick one by name (saved in the
// player's progress); if that voice isn't on this device, the best one is used instead.

export type VoiceInfo = { name: string; lang: string };

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : undefined);

/** How natural a voice is likely to sound (higher is better). English only. */
export function voiceScore(v: { name: string; lang: string; localService?: boolean }): number {
  if (!/^en[-_]/i.test(v.lang)) return -1;
  const n = v.name.toLowerCase();
  let s = 0;
  if (/natural|neural|premium|enhanced|wavenet|studio/.test(n)) s += 10;
  if (/google/.test(n)) s += 6;                          // Android / Chrome network voices
  if (/samantha|ava|allison|susan|zoe|aria|jenny|libby|sonia/.test(n)) s += 4;   // well-liked system voices
  if (/siri/.test(n)) s += 5;
  if (/compact|espeak|robot|novelty|bad news|bells|whisper|zarvox|trinoids|albert|bubbles|cellos|organ|jester|superstar|wobble/.test(n)) s -= 20;
  if (/en[-_]us/i.test(v.lang)) s += 2; else if (/en[-_](ca|gb|au)/i.test(v.lang)) s += 1;
  if (v.localService === false) s += 1;                  // online voices are usually the nicer ones
  return s;
}

/** English voices on this device, best first. Voices load late on some tablets, so call again later. */
export function englishVoices(): VoiceInfo[] {
  const all = synth()?.getVoices() || [];
  return all.filter(v => voiceScore(v) >= 0).sort((a, b) => voiceScore(b) - voiceScore(a)).map(v => ({ name: v.name, lang: v.lang }));
}

function pickVoice(preferred?: string | null): SpeechSynthesisVoice | null {
  const all = synth()?.getVoices() || [];
  const chosen = preferred ? all.find(v => v.name === preferred) : null;
  if (chosen) return chosen;
  const best = all.filter(v => voiceScore(v) >= 0).sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  return best || null;
}

/** Say something. Text in CAPITALS is said as normal words. onWord lights up one word at a time. */
export function say(text: string, opts: { on: boolean; voice?: string | null; onWord?: (i: number) => void }) {
  if (!opts.on) return;
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text.toLowerCase().replace(/\bl\b/g, 'L'));
    const v = pickVoice(opts.voice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    // a little slower and only slightly brighter than normal: friendly without sounding like a chipmunk
    u.rate = 0.88; u.pitch = 1.05;
    if (opts.onWord) {
      const words = text.split(' ').length, on = opts.onWord;
      let i = 0;
      u.onstart = () => {
        on(0);
        const t = window.setInterval(() => { i++; if (i >= words) { window.clearInterval(t); on(-1); } else on(i); }, 480);
      };
    }
    s.speak(u);
  } catch { /* no voice on this device */ }
}

export const hush = () => { try { synth()?.cancel(); } catch { /* ignore */ } };

/** Some tablets fill the voice list a moment after the page opens. */
export function onVoicesReady(fn: () => void): () => void {
  const s = synth();
  if (!s) return () => undefined;
  fn();
  s.addEventListener?.('voiceschanged', fn);
  return () => s.removeEventListener?.('voiceschanged', fn);
}
