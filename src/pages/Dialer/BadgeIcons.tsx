// src/pages/Dialer/BadgeIcons.tsx
//
// Badge & multiplier icons from game-icons.net (CC BY 3.0).
// Loads SVGs from CDN as img tags, colored via CSS filter.
// Artists: Lorc, Delapouite, Skoll, Sbed, Caro Asercion.
//

import React, { useState } from 'react';

// --- Icon path mapping: badge/multiplier ID → "author/icon-name" ---

const ICON_PATHS: Record<string, string> = {
  // ─── BADGE ICONS (50) ───
  // Streaks
  double_kill:    'lorc/crossed-swords',
  triple_kill:    'lorc/triple-skulls',
  unstoppable:    'lorc/fire-silhouette',
  ace:            'lorc/spade-skull',
  rampage:        'lorc/sword-clash',
  godlike:        'lorc/crowned-skull',
  legendary:      'lorc/star-skull',
  tactical_nuke:  'skoll/nuclear-bomb',
  beyond_godlike: 'delapouite/all-seeing-eye',
  // Prepay Streak
  double_tap:     'delapouite/bullet-impacts',
  hat_trick:      'lorc/three-burning-balls',
  grand_slam:     'lorc/gem-pendant',
  royal_flush:    'lorc/crowned-explosion',
  domination:     'lorc/fission',
  // Street
  link_shot_kill: 'lorc/wavy-chains',
  ducks_in_a_row: 'lorc/footprint',
  ducksplosion:   'lorc/bright-explosion',
  // Time
  early_bird:     'lorc/sunrise',
  buzzer_beater:  'lorc/moon',
  // Spree
  killing_spree:  'lorc/bloody-sword',
  warpath:        'lorc/crossed-axes',
  onslaught:      'lorc/sword-wound',
  massacre:       'lorc/death-zone',
  annihilation:   'lorc/mushroom-cloud',
  // Special
  first_blood:    'lorc/drop',
  no_scope:       'skoll/bullseye',
  fast_start:     'lorc/lightning-helix',
  // Headhunter
  headhunter:     'delapouite/archer',
  trophy_hunter:  'lorc/trophy',
  apex_predator:  'lorc/wolf-head',
  // Raise the Dead
  grave_digger:   'sbed/tombstone',
  necromancer:    'lorc/grim-reaper',
  lich_king:      'lorc/daemon-skull',
  resurrection:   'lorc/angel-wings',
  // Ranks
  sergeant:       'delapouite/corporal',
  lieutenant:     'lorc/crested-helmet',
  captain:        'sbed/shield',
  commander:      'lorc/medal',
  general:        'lorc/medal-skull',
  field_marshal:  'lorc/laurel-crown',
  warlord:        'caro-asercion/warlord-helmet',
  supreme_cmdr:   'lorc/queen-crown',
  // Milestones
  first_deploy:   'lorc/rocket',
  sharpshooter:   'lorc/targeting',
  veteran:        'skoll/achievement',
  war_hero:       'delapouite/war-pick',
  legend:         'lorc/laurels',
  // Workhorse
  ironman:        'lorc/muscle-up',
  machine:        'lorc/cogsplosion',
  terminator:     'lorc/android-mask',
  // Conversion
  conversion_therapy: 'delapouite/convince',
  born_again:         'lorc/enlightenment',
  cult_leader:        'lorc/cultist',

  // ─── MULTIPLIER ICONS ───
  mult_op_tempo:        'lorc/lightning-frequency',
  mult_tracer_rounds:   'lorc/supersonic-bullet',
  mult_high_ground:     'lorc/mountaintop',
  mult_night_vision:    'delapouite/night-vision',
  mult_blitz:           'delapouite/speedometer',
  mult_blitz_blitzkrieg:'lorc/supersonic-arrow',
  mult_blitz_shock_awe: 'lorc/mine-explosion',
  mult_enraged:         'delapouite/enrage',
  mult_enraged_furious: 'lorc/screaming',
  mult_enraged_fku:     'delapouite/uprising',
  mult_ratio_focus:     'lorc/on-target',
  mult_war_machine:     'lorc/gears',
  mult_ghost_town:      'lorc/ghost',       // T1 Ghost Town    (+0.5x)
  mult_ghost_town_t2:   'lorc/spectre',     // T2 Super Ghost Town (+1.0x)
  mult_ghost_town_t3:   'lorc/haunting',    // T3 Haunted Town  (+2.0x)
  mult_cold_streak:     'delapouite/frozen-body',
  mult_scorched_earth:  'lorc/fire-zone',
  mult_indoctrinate:    'lorc/psychic-waves',
};

// --- Category accent colors ---

const C = {
  streak:     '#e74c3c',
  prepay:     '#f1c40f',
  street:     '#2ecc71',
  time:       '#e67e22',
  spree:      '#ff5722',
  special:    '#00BCD4',
  headhunter: '#9b59b6',
  dead:       '#8e44ad',
  conversion: '#e056a0',
  rank:       '#f1c40f',
  milestone:  '#3498db',
  workhorse:  '#95a5a6',
};

const CATEGORY_MAP: Record<string, string> = {
  double_kill: C.streak, triple_kill: C.streak, unstoppable: C.streak, ace: C.streak,
  rampage: C.streak, godlike: C.streak, legendary: C.streak, tactical_nuke: C.streak, beyond_godlike: C.streak,
  double_tap: C.prepay, hat_trick: C.prepay, grand_slam: C.prepay, royal_flush: C.prepay, domination: C.prepay,
  link_shot_kill: C.street, ducks_in_a_row: C.street, ducksplosion: C.street,
  early_bird: C.time, buzzer_beater: C.time,
  killing_spree: C.spree, warpath: C.spree, onslaught: C.spree, massacre: C.spree, annihilation: C.spree,
  first_blood: C.special, no_scope: C.special, fast_start: C.special,
  headhunter: C.headhunter, trophy_hunter: C.headhunter, apex_predator: C.headhunter,
  grave_digger: C.dead, necromancer: C.dead, lich_king: C.dead, resurrection: C.dead,
  sergeant: C.rank, lieutenant: C.rank, captain: C.rank, commander: C.rank,
  general: C.rank, field_marshal: C.rank, warlord: C.rank, supreme_cmdr: C.rank,
  first_deploy: C.milestone, sharpshooter: C.milestone, veteran: C.milestone, war_hero: C.milestone, legend: C.milestone,
  ironman: C.workhorse, machine: C.workhorse, terminator: C.workhorse,
  conversion_therapy: C.conversion, born_again: C.conversion, cult_leader: C.conversion,
};

// --- CDN URL builder ---

function getIconUrl(iconPath: string): string {
  return `https://game-icons.net/icons/ffffff/transparent/1x1/${iconPath}.svg`;
}

function GameIcon({
  iconPath,
  size,
  color,
}: {
  iconPath: string;
  size: number;
  color?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = getIconUrl(iconPath);

  if (failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `${color || '#555'}20`,
          border: `1px solid ${color || '#555'}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.4,
          color: color || '#555',
        }}
      >
        ?
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ display: 'block' }}
      loading="lazy"
    />
  );
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function getBadgeIcon(badgeId: string, size: number = 24): React.ReactNode | null {
  const path = ICON_PATHS[badgeId];
  if (!path) return null;
  const color = CATEGORY_MAP[badgeId];
  return <GameIcon iconPath={path} size={size} color={color} />;
}

export function getMultiplierIcon(multiplierId: string, size: number = 24): React.ReactNode | null {
  const key = ICON_PATHS[`mult_${multiplierId}`] ? `mult_${multiplierId}` : multiplierId;
  const path = ICON_PATHS[key];
  if (!path) return null;
  return <GameIcon iconPath={path} size={size} />;
}

/**
 * Get a multiplier icon for a specific tier (blitz, enraged, ghost_town).
 * Falls back to the base multiplier icon.
 */
export function getMultiplierTierIcon(
  multiplierId: string,
  tierIndex: number,
  size: number = 24
): React.ReactNode | null {
  const tierKeys: Record<string, string[]> = {
    blitz:      ['mult_blitz_shock_awe', 'mult_blitz_blitzkrieg', 'mult_blitz'],
    enraged:    ['mult_enraged', 'mult_enraged_furious', 'mult_enraged_fku'],
    ghost_town: ['mult_ghost_town', 'mult_ghost_town_t2', 'mult_ghost_town_t3'],
  };

  const tiers = tierKeys[multiplierId];
  if (tiers && tierIndex >= 0 && tierIndex < tiers.length) {
    const path = ICON_PATHS[tiers[tierIndex]];
    if (path) return <GameIcon iconPath={path} size={size} />;
  }

  return getMultiplierIcon(multiplierId, size);
}

export function getBadgeCategoryColor(badgeId: string): string {
  return CATEGORY_MAP[badgeId] || '#2ecc71';
}

export function getBadgeIconUrl(badgeId: string): string | null {
  const path = ICON_PATHS[badgeId];
  return path ? getIconUrl(path) : null;
}

export function getMultiplierIconUrl(multiplierId: string): string | null {
  const key = ICON_PATHS[`mult_${multiplierId}`] ? `mult_${multiplierId}` : multiplierId;
  const path = ICON_PATHS[key];
  return path ? getIconUrl(path) : null;
}