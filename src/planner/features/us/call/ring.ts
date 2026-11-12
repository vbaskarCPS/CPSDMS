// src/planner/features/us/call/ring.ts — the sound of the other one calling: two soft notes every few seconds, made
// with Web Audio (no sound file), and a buzz. A phone only lets a page make sound after it has been touched, so this
// may well stay silent (the banner is what must be seen); it starts by itself at the first touch.

/** Start ringing. Returns the stop. */
export function startRing(): () => void {
  let ctx: AudioContext | null = null;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
  } catch { /* no sound on this phone */ }
  const note = (hz: number, at: number) => {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
    o.type = 'sine'; o.frequency.value = hz; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.start(t); o.stop(t + 0.55);
  };
  const ring = () => {
    // only while the sound is really running: notes lined up on a clock that is stopped would all play at once later
    try { if (ctx?.state === 'running') { note(659, 0); note(880, 0.32); } } catch { /* no sound */ }
    try { navigator.vibrate?.([220, 140, 220]); } catch { /* no buzz on this phone */ }
  };
  const wake = () => { try { void ctx?.resume().catch(() => undefined); } catch { /* still silent */ } };
  window.addEventListener('pointerdown', wake);
  wake(); ring();
  const every = window.setInterval(ring, 2600);
  return () => {
    window.clearInterval(every);
    window.removeEventListener('pointerdown', wake);
    try { navigator.vibrate?.(0); } catch { /* none */ }
    try { void ctx?.close().catch(() => undefined); } catch { /* already closed */ }
    ctx = null;
  };
}
