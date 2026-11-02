// src/lib/msDemoFlag.ts — true inside the public MainstreetAI demo (propertystars.app/mainstreetaidemo).
// The demo runs the real rep and host screens on sample data (src/msdemo); the pieces that would touch a
// real phone's storage (the rep's offline queue and cache) check this and keep everything in memory.
export const msDemo = typeof window !== 'undefined' && /^\/mainstreetaidemo(\/|$)/.test(window.location.pathname);
