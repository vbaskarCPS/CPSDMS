// src/lib/dialer/gamificationDefs.ts
//
// Gamification definitions: badges, multipliers, points, session schema.
// Ported directly from Gamification.gs — pure data, no logic.
//

// --- Badge Definition ---

export interface BadgeDef {
  icon: string;
  name: string;
  desc: string;
  section: string;
  color: string;
  type: 'repeatable' | 'once';
  bonus: number;
}

export const BADGE_DEFS: Record<string, BadgeDef> = {
  // ─── STREAKS (9) — Repeatable ───
  double_kill:    { icon: '💀💀',    name: 'Double Kill',     desc: '2 YES in a row',     section: 'Streaks',        color: 'toast-double',        type: 'repeatable', bonus: 25 },
  triple_kill:    { icon: '💀💀💀',  name: 'Triple Kill',     desc: '3 YES in a row',     section: 'Streaks',        color: 'toast-triple',        type: 'repeatable', bonus: 50 },
  unstoppable:    { icon: '🔥',      name: 'Unstoppable',     desc: '4 YES in a row',     section: 'Streaks',        color: 'toast-unstoppable',   type: 'repeatable', bonus: 50 },
  ace:            { icon: '♠️',      name: 'Ace',             desc: '5 YES in a row',     section: 'Streaks',        color: 'toast-ace',           type: 'repeatable', bonus: 100 },
  rampage:        { icon: '⚡',      name: 'Rampage',         desc: '6 YES in a row',     section: 'Streaks',        color: 'toast-rampage',       type: 'repeatable', bonus: 100 },
  godlike:        { icon: '👑',      name: 'God Like',        desc: '7 YES in a row',     section: 'Streaks',        color: 'toast-godlike',       type: 'repeatable', bonus: 200 },
  legendary:      { icon: '⭐',      name: 'Legendary',       desc: '8 YES in a row',     section: 'Streaks',        color: 'toast-legendary',     type: 'repeatable', bonus: 200 },
  tactical_nuke:  { icon: '☢️',     name: 'Tactical Nuke',   desc: '9 YES in a row',     section: 'Streaks',        color: 'toast-nuke',          type: 'repeatable', bonus: 500 },
  beyond_godlike: { icon: '🌟',      name: 'Beyond Godlike',  desc: '10 YES in a row',    section: 'Streaks',        color: 'toast-beyondgodlike', type: 'repeatable', bonus: 500 },

  // ─── CONSECUTIVE PREPAYS (5) — Repeatable ───
  double_tap:     { icon: '🔫',      name: 'Double Tap',      desc: '2 prepays in a row',   section: 'Prepay Streak', color: 'toast-doubletap',     type: 'repeatable', bonus: 100 },
  hat_trick:      { icon: '🎩',      name: 'Hat Trick',       desc: '3 prepays in a row',   section: 'Prepay Streak', color: 'toast-hattrick',      type: 'repeatable', bonus: 200 },
  grand_slam:     { icon: '💎',      name: 'Grand Slam',      desc: '4 prepays in a row',   section: 'Prepay Streak', color: 'toast-grandslam',     type: 'repeatable', bonus: 300 },
  royal_flush:    { icon: '👑',      name: 'Royal Flush',     desc: '5 prepays in a row',   section: 'Prepay Streak', color: 'toast-royalflush',    type: 'repeatable', bonus: 400 },
  domination:     { icon: '👊',      name: 'Domination',      desc: '6+ prepays in a row',  section: 'Prepay Streak', color: 'toast-domination',    type: 'repeatable', bonus: 500 },

  // ─── STREET (3) — Repeatable ───
  link_shot_kill: { icon: '🔗',      name: 'Link Shot Kill',  desc: '3rd sale on a street',  section: 'Street',  color: 'toast-linkshot',      type: 'repeatable', bonus: 50 },
  ducks_in_a_row: { icon: '🦆',      name: 'Ducks in a Row',  desc: '5th sale on a street',  section: 'Street',  color: 'toast-ducks',         type: 'repeatable', bonus: 200 },
  ducksplosion:   { icon: '💥🦆',   name: 'Ducksplosion',    desc: '7th sale on a street',  section: 'Street',  color: 'toast-ducksplosion',  type: 'repeatable', bonus: 300 },

  // ─── TIME (2) — Repeatable ───
  early_bird:     { icon: '🌅',      name: 'Early Bird',      desc: 'Booking before 10am',  section: 'Time',    color: 'toast-earlybird',     type: 'repeatable', bonus: 50 },
  buzzer_beater:  { icon: '🌙',      name: 'Buzzer Beater',   desc: 'Booking after 8pm',    section: 'Time',    color: 'toast-buzzerbeater',  type: 'repeatable', bonus: 50 },

  // ─── SPREE (5) — Repeatable ───
  killing_spree:  { icon: '🔪',      name: 'Killing Spree',   desc: '5 bookings in 1 hr',   section: 'Spree',   color: 'toast-killingspree',  type: 'repeatable', bonus: 100 },
  warpath:        { icon: '⚔️',     name: 'Warpath',         desc: '7 bookings in 1 hr',   section: 'Spree',   color: 'toast-warpath',       type: 'repeatable', bonus: 100 },
  onslaught:      { icon: '🛡️',     name: 'Onslaught',       desc: '10 bookings in 1 hr',  section: 'Spree',   color: 'toast-onslaught',     type: 'repeatable', bonus: 150 },
  massacre:       { icon: '💀',      name: 'Massacre',        desc: '12 bookings in 1 hr',  section: 'Spree',   color: 'toast-massacre',      type: 'repeatable', bonus: 150 },
  annihilation:   { icon: '☠️',     name: 'Annihilation',    desc: '15 bookings in 1 hr',  section: 'Spree',   color: 'toast-annihilation',  type: 'repeatable', bonus: 200 },

  // ─── SPECIAL (3) — Once ───
  first_blood:    { icon: '🩸',      name: 'First Blood',     desc: 'First prepay of session',   section: 'Special',     color: 'toast-firstblood',    type: 'once', bonus: 100 },
  no_scope:       { icon: '🎯',      name: '360 No Scope',    desc: 'Prepay in under 2 min',     section: 'Special',     color: 'toast-noscope',       type: 'once', bonus: 100 },
  fast_start:     { icon: '⚡',      name: 'Fast Start',      desc: 'Booking in first 10 min',   section: 'Special',     color: 'toast-faststart',     type: 'once', bonus: 100 },

  // ─── HEADHUNTER (3) — Once ───
  headhunter:     { icon: '🏹',      name: 'Headhunter',      desc: '10 new-street bookings',   section: 'Headhunter',    color: 'toast-headhunter',    type: 'once', bonus: 200 },
  trophy_hunter:  { icon: '🏹',      name: 'Trophy Hunter',   desc: '20 new-street bookings',   section: 'Headhunter',    color: 'toast-trophyhunter',  type: 'once', bonus: 200 },
  apex_predator:  { icon: '🐺',      name: 'Apex Predator',   desc: '30 new-street bookings',   section: 'Headhunter',    color: 'toast-apexpredator',  type: 'once', bonus: 200 },

  // ─── RAISE THE DEAD (4) — Once ───
  grave_digger:   { icon: '⚰️',     name: 'Grave Digger',    desc: '5 raised dead clients',    section: 'Raise the Dead', color: 'toast-gravedigger',   type: 'once', bonus: 200 },
  necromancer:    { icon: '💀',      name: 'Necromancer',     desc: '10 raised dead clients',   section: 'Raise the Dead', color: 'toast-necromancer',   type: 'once', bonus: 300 },
  lich_king:      { icon: '👑',      name: 'Lich King',       desc: '20 raised dead clients',   section: 'Raise the Dead', color: 'toast-lichking',      type: 'once', bonus: 500 },
  resurrection:   { icon: '🧟',      name: 'Resurrection',    desc: '40 raised dead clients',   section: 'Raise the Dead', color: 'toast-resurrection',  type: 'once', bonus: 2000 },

  // ─── GRAVEYARD (3) — Repeatable ───
  almost_dead:    { icon: '🦴',      name: 'Almost Dead',     desc: 'Book a 2022 client',       section: 'Graveyard',     color: 'toast-almostdead',    type: 'repeatable', bonus: 25 },
  actually_dead:  { icon: '💀',      name: 'Actually Dead',   desc: 'Book a 2021 client',       section: 'Graveyard',     color: 'toast-actuallydead',  type: 'repeatable', bonus: 50 },
  really_dead:    { icon: '👻',      name: 'Really Dead',     desc: 'Book a 2020 client',       section: 'Graveyard',     color: 'toast-reallydead',    type: 'repeatable', bonus: 100 },

  // ─── CONVERSION (3) — Once ───
  conversion_therapy: { icon: '🧠', name: 'Conversion Therapy', desc: '2 non-app prepay converts',  section: 'Conversion', color: 'toast-conversion',   type: 'once', bonus: 200 },
  born_again:         { icon: '✨', name: 'Born Again',         desc: '5 non-app prepay converts',  section: 'Conversion', color: 'toast-bornagain',    type: 'once', bonus: 500 },
  cult_leader:        { icon: '🪬', name: 'Cult Leader',        desc: '10 non-app prepay converts', section: 'Conversion', color: 'toast-cultleader',   type: 'once', bonus: 1000 },

  // ─── RANKS (8) — Once ───
  sergeant:       { icon: '🎖',  name: 'Sergeant',           desc: '$250 in prepays',   section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 125 },
  lieutenant:     { icon: '🎖',  name: 'Lieutenant',         desc: '$500 in prepays',   section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 250 },
  captain:        { icon: '🎖',  name: 'Captain',            desc: '$1000 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 500 },
  commander:      { icon: '🎖',  name: 'Commander',          desc: '$1500 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 750 },
  general:        { icon: '⭐',  name: 'General',            desc: '$2000 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 1000 },
  field_marshal:  { icon: '🏅',  name: 'Field Marshal',      desc: '$2500 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 1250 },
  warlord:        { icon: '⚔️', name: 'Warlord',            desc: '$3000 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 1500 },
  supreme_cmdr:   { icon: '👑',  name: 'Supreme Commander',  desc: '$3500 in prepays',  section: 'Ranks', color: 'toast-rank', type: 'once', bonus: 2000 },

  // ─── MILESTONES (5) — Once ───
  first_deploy:   { icon: '🚀',  name: 'First Deploy',   desc: '10 total bookings',   section: 'Milestones', color: 'toast-milestone', type: 'once', bonus: 300 },
  sharpshooter:   { icon: '🎯',  name: 'Sharpshooter',   desc: '25 total bookings',   section: 'Milestones', color: 'toast-milestone', type: 'once', bonus: 750 },
  veteran:        { icon: '🏅',  name: 'Veteran',         desc: '50 total bookings',   section: 'Milestones', color: 'toast-milestone', type: 'once', bonus: 1500 },
  war_hero:       { icon: '🎗',  name: 'War Hero',        desc: '75 total bookings',   section: 'Milestones', color: 'toast-milestone', type: 'once', bonus: 2250 },
  legend:         { icon: '🏆',  name: 'Legend',           desc: '100 total bookings',  section: 'Milestones', color: 'toast-milestone', type: 'once', bonus: 3000 },

  // ─── WORKHORSE (3) — Once ───
  ironman:        { icon: '💪',  name: 'Ironman',     desc: '2 hrs active (50+/hr)',   section: 'Workhorse', color: 'toast-ironman',     type: 'once', bonus: 200 },
  machine:        { icon: '⚙️', name: 'Machine',     desc: '5 hrs active (50+/hr)',   section: 'Workhorse', color: 'toast-machine',     type: 'once', bonus: 500 },
  terminator:     { icon: '🤖',  name: 'Terminator',  desc: '10 hrs active (50+/hr)',  section: 'Workhorse', color: 'toast-terminator',  type: 'once', bonus: 1000 },
};

// --- Multiplier Definitions ---

export interface MultiplierTier {
  maxMinutes?: number;
  multiplier: number;
  name: string;
  icon: string;
  charges?: number;
  tier?: number;
  minGroups?: number;
  bonus?: number;
}

export interface MultiplierDef {
  name: string;
  icon: string;
  activationThreshold?: number;
  baseMultiplier?: number;
  perLevelBonus?: number;
  timerDuration?: number;
  decays: boolean;
  flatMultiplier?: number;
  perBookingBonus?: number;
  activationHour?: number;
  noCap?: boolean;
  requiredBookings?: number;
  decayDuration?: number;
  tiers?: MultiplierTier[];
  requiredRejections?: number;
  minimumRatio?: number;
  perHourBonus?: number;
  minDialsPerHour?: number;
  requiredUnreached?: number;
  charges?: number;
  requiredDials?: number;
  chargesPerTrigger?: number;
  /** If true, this multiplier modifies scoring logic rather than adding a value */
  modifiesScoring?: boolean;
  /** For war_machine: inactivity window in ms before multiplier drops */
  inactivityWindowMs?: number;
  /** For war_machine: number of dials required to activate */
  dialThreshold?: number;
  /** For exhumer: number of qualifying dispositions required to earn a charge */
  requiredDispositions?: number;
  /** If true, this multiplier doubles the entire final score (applied after all other scoring) */
  doublesFinalScore?: boolean;
}

export const MULTIPLIER_DEFS: Record<string, MultiplierDef> = {
  op_tempo: {
    name: 'Op Tempo', icon: '⚡',
    activationThreshold: 5,
    perLevelBonus: 0.1,
    timerDuration: 0, decays: false,
  },
  tracer_rounds: {
    name: 'Tracer Rounds', icon: '🔴',
    activationThreshold: 2, baseMultiplier: 0.2, perLevelBonus: 0.2,
    timerDuration: 1200000, decays: false,
  },
  high_ground: {
    name: 'High Ground', icon: '⛰️',
    flatMultiplier: 1.0, timerDuration: 0, decays: false,
  },
  night_vision: {
    name: 'Night Vision', icon: '🌙',
    perBookingBonus: 0.2, activationHour: 20,
    timerDuration: 0, decays: false, noCap: true,
  },
  blitz: {
    name: 'Blitz', icon: '💥',
    requiredBookings: 5, decayDuration: 10800000,
    tiers: [
      { maxMinutes: 20, multiplier: 2.0, name: 'Shock & Awe', icon: '💣' },
      { maxMinutes: 40, multiplier: 1.5, name: 'Blitzkrieg', icon: '⚡' },
      { maxMinutes: 60, multiplier: 1.0, name: 'Blitz', icon: '💥' },
    ],
    decays: true,
  },
  enraged: {
    name: 'Enraged', icon: '💢',
    requiredRejections: 3,
    tiers: [
      { tier: 1, name: 'Enraged',   icon: '💢', multiplier: 1.0, charges: 1 },
      { tier: 2, name: 'Furious',   icon: '🤬', multiplier: 2.0, charges: 1 },
      { tier: 3, name: 'F@&K Y#U', icon: '🖕', multiplier: 2.0, charges: 2 },
    ],
    timerDuration: 0, decays: false,
  },
  ratio_focus: {
    name: 'Ratio Focus', icon: '🎯',
    minimumRatio: 0.20, timerDuration: 0, decays: false,
  },
  war_machine: {
    name: 'War Machine', icon: '⚙️',
    flatMultiplier: 0.5,
    dialThreshold: 50,
    inactivityWindowMs: 600000,
    timerDuration: 0, decays: false,
  },
  ghost_town: {
    name: 'Ghost Town', icon: '👻',
    requiredUnreached: 10, flatMultiplier: 0.5, charges: 3,
    timerDuration: 0, decays: false,
  },
  cold_streak: {
    name: 'Cold Streak', icon: '❄️',
    requiredDials: 20, flatMultiplier: 1.0, charges: 2,
    timerDuration: 0, decays: false,
  },
  scorched_earth: {
    name: 'Scorched Earth', icon: '🔥',
    chargesPerTrigger: 2,
    tiers: [
      { minGroups: 21, bonus: 2.0, multiplier: 2.0, name: 'Scorched Earth', icon: '🔥' },
      { minGroups: 16, bonus: 1.0, multiplier: 1.0, name: 'Scorched Earth', icon: '🔥' },
      { minGroups: 11, bonus: 0.5, multiplier: 0.5, name: 'Scorched Earth', icon: '🔥' },
      { minGroups: 6,  bonus: 0.3, multiplier: 0.3, name: 'Scorched Earth', icon: '🔥' },
      { minGroups: 3,  bonus: 0.1, multiplier: 0.1, name: 'Scorched Earth', icon: '🔥' },
    ],
    timerDuration: 0, decays: false,
  },
  indoctrinate: {
    name: 'Indoctrinate', icon: '🧠',
    charges: 2,
    timerDuration: 0, decays: false,
    modifiesScoring: true,
  },
  exhumer: {
    name: 'Exhumer', icon: '⚰️',
    // Activated by: 20 WN/NIS, NO, or REMOVE dispositions on clients
    // whose mostRecentYear is 2020, 2021, or 2022.
    // Effect: doubles the entire final grand total on the next booking (1 charge).
    // After firing, counter resets to 0 — need another 20 to earn again.
    requiredDispositions: 20,
    charges: 1,
    doublesFinalScore: true,
    timerDuration: 0, decays: false,
  },
};

// --- Base Points ---

export const BASE_POINTS = {
  prebook: 100,
  prepayPerDollar: 1,
};

// --- Session Schema ---

export interface BadgeEarned {
  id: string;
  time: string;
  sheet: string;
  points: number;
  timestamp: number;
}

export interface BookingRecord {
  time: number;
  type: 'PREBOOK' | 'PREPAY';
  base: number;
  multiplier: number;
  multiplierBreakdown: Record<string, number>;
  multiplied: number;
  badgeBonuses: Record<string, number>;
  badgeBonusTotal: number;
  grandTotal: number;
  manual?: boolean;
}

export interface ScorchedEarthStack {
  bonus: number;
  charges: number;
}

export interface GamificationSession {
  repCode: string;
  date: string;

  pbs: number;
  pps: number;
  ppDollars: number;
  totalBookings: number;
  upsells: number;

  consecutiveYes: number;
  consecutivePrepays: number;

  newStreetBookings: number;
  raisedDeadCount: number;
  conversionCount: number;

  // Graveyard badge counters (incremented on every YES of matching year)
  almostDeadCount: number;   // 2022 clients booked
  actuallyDeadCount: number; // 2021 clients booked
  reallyDeadCount: number;   // 2020 clients booked

  totalDials: number;
  hourlyDials: Record<string, number>;
  bookingTimestamps: number[];
  sessionStartTime: number;

  totalSessionPoints: number;
  recentBookings: BookingRecord[];

  badges: BadgeEarned[];
  badgeOnceClaimed: Record<string, boolean>;

  streetSales: Record<string, number>;

  // Streak epoch markers (for repeatable badge dedup)
  _streakBadgeEpoch?: number;
  _prepayStreakBadgeEpoch?: number;

  multipliers: {
    op_tempo: { windowCount: number };
    tracer_rounds: { prepayCount: number; expiresAt: number };
    high_ground: { activeStreet: string; active: boolean };
    night_vision: { bookingsAfter8: number };
    blitz: { earlyYesCount: number; triggered: boolean; triggerTime: number; tier: number };
    enraged: { consecutiveRejections: number; tier: number; chargesRemaining: number; frozen: boolean };
    ratio_focus: Record<string, never>;
    war_machine: { totalDials: number; active: boolean; lastDialAt: number };
    ghost_town: { consecutiveUnreached: number; chargesRemaining: number; tier: number };
    cold_streak: { dialsSinceLastYes: number; chargesRemaining: number };
    scorched_earth: { bonusStack: ScorchedEarthStack[]; clearedStreets: Record<string, boolean> };
    indoctrinate: { chargesRemaining: number };
    // Exhumer: counts qualifying dispositions (WN/NIS, NO, REMOVE on dead-year clients).
    // Once dispositionCount reaches 20, chargesRemaining becomes 1.
    // On the next YES the charge fires (doubles final score) and dispositionCount resets to 0.
    exhumer: { dispositionCount: number; chargesRemaining: number };
  };
}

/**
 * Create a fresh gamification session.
 */
export function createFreshSession(repCode: string, dateStr: string): GamificationSession {
  return {
    repCode: repCode || '',
    date: dateStr || '',
    pbs: 0, pps: 0, ppDollars: 0, totalBookings: 0, upsells: 0,
    consecutiveYes: 0, consecutivePrepays: 0,
    newStreetBookings: 0, raisedDeadCount: 0, conversionCount: 0,
    almostDeadCount: 0, actuallyDeadCount: 0, reallyDeadCount: 0,
    totalDials: 0, hourlyDials: {}, bookingTimestamps: [], sessionStartTime: 0,
    totalSessionPoints: 0, recentBookings: [],
    badges: [], badgeOnceClaimed: {},
    streetSales: {},
    multipliers: {
      op_tempo: { windowCount: 0 },
      tracer_rounds: { prepayCount: 0, expiresAt: 0 },
      high_ground: { activeStreet: '', active: false },
      night_vision: { bookingsAfter8: 0 },
      blitz: { earlyYesCount: 0, triggered: false, triggerTime: 0, tier: 0 },
      enraged: { consecutiveRejections: 0, tier: 0, chargesRemaining: 0, frozen: false },
      ratio_focus: {},
      war_machine: { totalDials: 0, active: false, lastDialAt: 0 },
      ghost_town: { consecutiveUnreached: 0, chargesRemaining: 0, tier: 0 },
      cold_streak: { dialsSinceLastYes: 0, chargesRemaining: 0 },
      scorched_earth: { bonusStack: [], clearedStreets: {} },
      indoctrinate: { chargesRemaining: 0 },
      exhumer: { dispositionCount: 0, chargesRemaining: 0 },
    },
  };
}

// --- Rank Lookup ---

export interface Rank {
  icon: string;
  label: string;
}

export function getCurrentRank(session: GamificationSession): Rank | null {
  const d = session.ppDollars || 0;
  if (d >= 3500) return { icon: '👑', label: 'Supreme Cmdr' };
  if (d >= 3000) return { icon: '⚔️', label: 'Warlord' };
  if (d >= 2500) return { icon: '🏅', label: 'Field Marshal' };
  if (d >= 2000) return { icon: '⭐', label: 'General' };
  if (d >= 1500) return { icon: '🎖', label: 'Commander' };
  if (d >= 1000) return { icon: '🎖', label: 'Captain' };
  if (d >= 500)  return { icon: '🎖', label: 'Lieutenant' };
  if (d >= 250)  return { icon: '🎖', label: 'Sergeant' };
  return null;
}