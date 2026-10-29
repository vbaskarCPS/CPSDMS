// src/lib/littleLessons/voiceLines.ts — every line Little Lessons can say, for the recorded voices
// (public/minigame/make-little-chess-voices.mjs makes one clip per line; a test keeps its list in step).
// The chess lines are Little Chess's own; then each level's story, Ollie's words, Benny's counting,
// Zip's sums, and each friend's cheers.
import { cheers, clipId, spokenFor, voiceLines as chessLines, type Speaker } from '../littleChess/lessons';
import { lessonLines, type Friend } from './levels';

export type VoiceLine = { speaker: string; text: string; id: string; spoken: string };
const FRIENDS: Friend[] = ['ollie', 'benny', 'zip'];

export function allVoiceLines(names: string[]): VoiceLine[] {
  const out = new Map<string, VoiceLine>();
  const add = (l: VoiceLine) => { if (!out.has(l.id)) out.set(l.id, l); };
  chessLines(names).forEach(add);
  for (const l of lessonLines()) add({ speaker: l.who, text: l.key, id: clipId(l.who as Speaker, l.key), spoken: l.said });
  for (const name of names) for (const f of FRIENDS) for (const c of cheers(name))
    add({ speaker: f, text: c, id: clipId(f as unknown as Speaker, c), spoken: spokenFor('narrator', c, name) });
  return [...out.values()];
}
