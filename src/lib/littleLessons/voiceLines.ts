// src/lib/littleLessons/voiceLines.ts — every line Little Lessons can say, for the recorded voices
// (public/minigame/make-little-chess-voices.mjs makes one clip per line; a test keeps its list in step).
// Each line is said by a character: the chess questions by whoever asks them (chessHost), each level's
// story, Ollie's words, Benny's counting, Zip's sums, and everyone's cheers.
import { LESSONS, NAME_ORDER, cheers, clipId, notThereLine, oopsLine, sentenceFor, slowLine, spokenFor, stickerLine, type Speaker } from '../littleChess/lessons';
import { chessHost, lessonLines, type Cast } from './levels';

export type VoiceLine = { speaker: string; text: string; id: string; spoken: string };
const FRIENDS: Cast[] = ['ollie', 'benny', 'zip'];

export function allVoiceLines(names: string[]): VoiceLine[] {
  const out = new Map<string, VoiceLine>();
  const add = (speaker: string, text: string, spoken: string) => {
    const id = clipId(speaker as Speaker, text);
    if (!out.has(id)) out.set(id, { speaker, text, id, spoken });
  };
  const chess = (speaker: string, text: string, name = names[0] || 'Kiaan') => add(speaker, text, spokenFor(speaker as Speaker, text, name));
  for (const l of LESSONS) for (const r of l.rounds) if (r.kind !== 'hello') chess(chessHost(r), sentenceFor(r));
  // a miss: whoever asked names what he tapped ("THAT IS ROOK."); on a board, the piece says its rule
  for (const p of NAME_ORDER) { for (const host of NAME_ORDER) chess(host, oopsLine(p)); chess(p, notThereLine(p)); }
  for (const l of lessonLines()) add(l.who, l.key, l.said);
  for (const name of names) {
    chess('narrator', stickerLine(name), name);
    chess('narrator', slowLine(name), name);
    for (const who of [...NAME_ORDER, ...FRIENDS]) for (const c of cheers(name)) add(who, c, spokenFor('narrator', c, name));
  }
  return [...out.values()];
}
