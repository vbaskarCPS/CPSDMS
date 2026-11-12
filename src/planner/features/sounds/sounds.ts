// src/planner/features/sounds/sounds.ts — the planner's own notification sounds, made with Web Audio (no sound files):
// each one is a short list of soft notes. Played while the planner is open (store.ts) and from the play buttons in
// Settings › Sounds. When the planner is closed the phone plays its own sound instead: a web notification can't
// carry one of these. Ringing for a video call is separate (us/call/ring.ts) and stays as it is.

/** One note: when it starts (s), its pitch (Hz), how long it rings (s), and how loud at its peak (0–1). `to` = the
 *  pitch it slides to over `slide` seconds (a pop, a drop). */
export interface Note { at: number; hz: number; dur: number; gain: number; wave?: OscillatorType; to?: number; slide?: number; attack?: number }
export interface Sound { id: string; name: string; notes: Note[] }

export const SOUNDS: Sound[] = [
  { id: 'chime', name: 'Two-note chime', notes: [
    { at: 0, hz: 784, dur: 0.45, gain: 0.14 },
    { at: 0.16, hz: 1047, dur: 0.5, gain: 0.13 },
  ] },
  { id: 'sparkle', name: 'Rising sparkle', notes: [
    { at: 0, hz: 1047, dur: 0.28, gain: 0.09 },
    { at: 0.07, hz: 1319, dur: 0.28, gain: 0.09 },
    { at: 0.14, hz: 1568, dur: 0.3, gain: 0.09 },
    { at: 0.21, hz: 2093, dur: 0.4, gain: 0.08 },
  ] },
  { id: 'bell', name: 'Bell', notes: [
    { at: 0, hz: 1319, dur: 1.1, gain: 0.12, attack: 0.005 },
    { at: 0, hz: 3166, dur: 0.5, gain: 0.03, attack: 0.005 },
    { at: 0, hz: 659, dur: 1.1, gain: 0.05, attack: 0.005 },
  ] },
  { id: 'pop', name: 'Soft pop', notes: [
    { at: 0, hz: 320, to: 760, slide: 0.07, dur: 0.15, gain: 0.2, attack: 0.004 },
  ] },
  { id: 'knock', name: 'Wood knock', notes: [
    { at: 0, hz: 620, dur: 0.09, gain: 0.2, wave: 'triangle', attack: 0.002 },
    { at: 0, hz: 1240, dur: 0.05, gain: 0.06, attack: 0.002 },
    { at: 0.14, hz: 620, dur: 0.09, gain: 0.18, wave: 'triangle', attack: 0.002 },
    { at: 0.14, hz: 1240, dur: 0.05, gain: 0.05, attack: 0.002 },
  ] },
  { id: 'harp', name: 'Harp pluck', notes: [
    { at: 0, hz: 523, dur: 0.6, gain: 0.12, wave: 'triangle', attack: 0.004 },
    { at: 0.08, hz: 659, dur: 0.6, gain: 0.11, wave: 'triangle', attack: 0.004 },
    { at: 0.16, hz: 784, dur: 0.65, gain: 0.1, wave: 'triangle', attack: 0.004 },
  ] },
  { id: 'drop', name: 'Water drop', notes: [
    { at: 0, hz: 1400, to: 520, slide: 0.16, dur: 0.2, gain: 0.16, attack: 0.004 },
  ] },
  { id: 'marimba', name: 'Marimba', notes: [
    { at: 0, hz: 440, dur: 0.4, gain: 0.16, attack: 0.003 },
    { at: 0, hz: 1760, dur: 0.1, gain: 0.04, attack: 0.003 },
    { at: 0.17, hz: 659, dur: 0.42, gain: 0.15, attack: 0.003 },
    { at: 0.17, hz: 2637, dur: 0.1, gain: 0.03, attack: 0.003 },
  ] },
];
export type SoundId = string;
export const NO_SOUND = 'none';

export const soundOf = (id: string): Sound | undefined => SOUNDS.find(s => s.id === id);
/** How long a sound lasts, in seconds (0 for none). */
export const soundLength = (id: string): number => Math.max(0, ...(soundOf(id)?.notes.map(n => n.at + n.dur) ?? []));

/** Line a sound up on an audio clock, starting now. Does nothing for "none" or an unknown one. */
export function playOn(ctx: AudioContext, id: string): void {
  const s = soundOf(id);
  if (!s) return;
  const start = ctx.currentTime + 0.02;
  for (const n of s.notes) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = start + n.at;
    o.type = n.wave || 'sine';
    o.frequency.setValueAtTime(n.hz, t);
    if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, t + (n.slide || n.dur));
    // a quick rise and a soft fall: no click at either end
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(n.gain, t + (n.attack ?? 0.015));
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + n.dur + 0.02);
  }
}
