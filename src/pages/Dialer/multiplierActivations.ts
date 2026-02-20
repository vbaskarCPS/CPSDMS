// src/pages/Dialer/multiplierActivations.ts
//
// Utility: diff two MultiplierSnapshot arrays to detect newly activated
// multipliers and tier increases. Returns activation events ready to toast.
//

import type { MultiplierSnapshot } from '../../lib/dialer/gamificationDefs';
import type { MultiplierActivationEvent } from './DialerHUD';

// =============================================================================
// MULTIPLIER TEXT GENERATOR
// =============================================================================

/** Returns the activation text (without the name prefix) for a multiplier */
function getActivationVerb(
  id: string,
  extra?: Record<string, unknown>,
): string {
  const tier = typeof extra?.tier === 'number' ? extra.tier : 0;

  switch (id) {
    case 'op_tempo':
      return 'is On Fire';

    case 'tracer_rounds':
      return 'has Tracer Rounds';

    case 'high_ground':
      return 'has High Ground';

    case 'night_vision':
      return 'has Night Vision';

    case 'blitz':
      // tier 0 → Blitz, 1 → Shock & Awe, 2 → Blitzkrieg
      if (tier >= 2) return 'triggered Blitzkrieg';
      if (tier === 1) return 'triggered Shock & Awe';
      return 'triggered Blitz';

    case 'enraged':
      // tier 0 → Enraged, 1 → Furious, 2 → F@&K Y#U
      if (tier >= 2) return 'is F@&K Y#U';
      if (tier === 1) return 'is Furious';
      return 'is Enraged';

    case 'ratio_focus':
      return 'has Ratio Focus';

    case 'war_machine':
      return 'is a War Machine';

    case 'ghost_town':
      // tier 0 → Ghost Town, 1 → Super Ghost Town, 2 → Haunted Town
      if (tier >= 2) return 'is in a Haunted Town';
      if (tier === 1) return 'is in a Super Ghost Town';
      return 'is in a Ghost Town';

    case 'cold_streak':
      return 'hit a Cold Streak';

    case 'scorched_earth':
      return 'scorched the earth';

    case 'indoctrinate':
      return 'is Indoctrinating';

    case 'exhumer':
      return 'is an Exhumer — 2× FINAL ready';

    default:
      return `activated ${id.replace(/_/g, ' ')}`;
  }
}

// Colors per multiplier
const MULT_COLORS: Record<string, string> = {
  op_tempo: '#f5a623',
  tracer_rounds: '#e74c3c',
  high_ground: '#00e5ff',
  night_vision: '#9b59b6',
  blitz: '#ff6b35',
  enraged: '#ff0040',
  ratio_focus: '#3498db',
  war_machine: '#95a5a6',
  ghost_town: '#bdc3c7',
  cold_streak: '#85c1e9',
  scorched_earth: '#ff5722',
  indoctrinate: '#e056a0',
  exhumer: '#6c3483',
};

const MULT_ICONS: Record<string, string> = {
  op_tempo: '🔥',
  tracer_rounds: '💥',
  high_ground: '🏔️',
  night_vision: '🌙',
  blitz: '⚡',
  enraged: '💢',
  ratio_focus: '📊',
  war_machine: '⚙️',
  ghost_town: '👻',
  cold_streak: '❄️',
  scorched_earth: '🌋',
  indoctrinate: '🧠',
  exhumer: '⚰️',
};

// =============================================================================
// DIFF FUNCTION
// =============================================================================

/**
 * Compares two multiplier arrays and returns activation events for:
 * - Newly added multipliers (not present in prev)
 * - Multipliers whose tier has increased
 *
 * @param prev      Multipliers from previous snapshot (empty on first call)
 * @param next      Current multipliers
 * @param repName   Display name of the rep whose multipliers changed
 * @param isOwn     Whether these are the current user's multipliers
 */
export function detectNewlyActivated(
  prev: MultiplierSnapshot[],
  next: MultiplierSnapshot[],
  repName: string,
  isOwn: boolean,
): MultiplierActivationEvent[] {
  const prevMap = new Map(prev.map(m => [m.id, m]));
  const events: MultiplierActivationEvent[] = [];

  for (const m of next) {
    const prevEntry = prevMap.get(m.id);
    const currTier = typeof (m.extra as any)?.tier === 'number' ? (m.extra as any).tier as number : -1;
    const prevTier = prevEntry
      ? (typeof (prevEntry.extra as any)?.tier === 'number' ? (prevEntry.extra as any).tier as number : -1)
      : -2;

    const isNew = !prevEntry;
    const tierIncreased = !isNew && currTier > prevTier && currTier >= 0;

    if (!isNew && !tierIncreased) continue;

    const displayName = isOwn ? 'You' : repName;
    const verb = getActivationVerb(m.id, m.extra as Record<string, unknown> | undefined);

    // "You have High Ground" vs "Vijay B has High Ground"
    // The verb already uses third-person for teammates; swap for own
    let ownVerb = verb;
    if (isOwn) {
      ownVerb = verb
        .replace(/^is a /, 'are a ')
        .replace(/^is /, 'are ')
        .replace(/^has /, 'have ')
        .replace(/^hit /, 'hit ')
        .replace(/^triggered /, 'triggered ')
        .replace(/^scorched /, 'scorched ')
        .replace(/^activated /, 'activated ');
    }

    const text = `${displayName} ${ownVerb}`;

    events.push({
      id: `${m.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      multiplierId: m.id,
      name: displayName,
      text,
      icon: MULT_ICONS[m.id] || '⚡',
      color: MULT_COLORS[m.id] || '#00e5ff',
      timestamp: Date.now(),
    });
  }

  return events;
}