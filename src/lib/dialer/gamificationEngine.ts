// src/lib/dialer/gamificationEngine.ts
//
// Gamification runtime logic — disposition processing, badge evaluation,
// multiplier calculation, point scoring.
// Ported faithfully from Engine.gs. Pure functions operating on GamificationSession.
//

import {
  BADGE_DEFS,
  MULTIPLIER_DEFS,
  BASE_POINTS,
  GamificationSession,
  BadgeEarned,
  BookingRecord,
  ScorchedEarthStack,
  Rank,
  getCurrentRank,
} from './gamificationDefs';

// --- Types ---

export interface DispositionContext {
  timestamp?: number;
  street?: string;
  streetAerCount?: number;
  mostRecentYear?: number;
  streetFullyCleared?: boolean;
  streetVisibleGroupCount?: number;
  sheetName?: string;
  price?: number;
  yesStartTime?: number;
  /** True if this prepay is from a client who has never prepaid before (no 'Prepaid' in service history) */
  isFirstTimePrepay?: boolean;
}

export interface MultiplierSnapshot {
  id: string;
  name: string;
  icon: string;
  value: number;
  expiresIn: number;          // ms remaining, -1 = no timer
  extra?: Record<string, any>;
}

export interface PointBreakdown {
  time: number;
  type: 'PREBOOK' | 'PREPAY';
  base: number;
  multiplier: number;
  multiplierBreakdown: Record<string, number>;
  multiplied: number;
  badgeBonuses: Record<string, number>;
  badgeBonusTotal: number;
  grandTotal: number;
}

export interface ProcessResult {
  session: GamificationSession;
  newBadges: string[];
  pointBreakdown: PointBreakdown | null;
  activeMultipliers: MultiplierSnapshot[];
  rank: Rank | null;
}

// =============================================================================
// DEAD-YEAR HELPER
// Returns true if mostRecentYear is one of the three "graveyard" years.
// Used to gate Exhumer disposition counting and Graveyard badge awarding.
// =============================================================================

function isDeadYear(year: number): boolean {
  return year === 2020 || year === 2021 || year === 2022;
}

// =============================================================================
// MAIN ENTRY
// =============================================================================

export function processDisposition(
  session: GamificationSession,
  dispType: string,
  context: DispositionContext
): ProcessResult {
  const now = context.timestamp || Date.now();
  let newBadges: string[] = [];
  let pointBreakdown: PointBreakdown | null = null;

  recordDial(session, now);

  // --- Op Tempo: recount rolling window on every disposition ---
  updateOpTempo(session, now);

  // --- War Machine: record last dial time and check inactivity ---
  updateWarMachine(session, now);

  // --- High Ground: check BEFORE updating activeStreet ---
  const currentStreet = context.street || '';
  const hg = session.multipliers.high_ground;
  if (hg.activeStreet && currentStreet === hg.activeStreet) {
    hg.active = true;
  } else {
    hg.active = false;
  }

  // Reset streak epochs on rejection
  if (dispType === 'NO' || dispType === 'REMOVE') {
    session._streakBadgeEpoch = session.badges.length;
  }
  if (dispType === 'COMPLETE') {
    session._prepayStreakBadgeEpoch = session.badges.length;
  }

  // --- Exhumer: count qualifying dispositions on dead-year clients ---
  // WN/NIS, NO, and REMOVE on 2020/2021/2022 clients increment the counter.
  // When it hits 20, award 1 charge. Counter resets to 0 after charging.
  if (
    (dispType === 'WN/NIS' || dispType === 'NO' || dispType === 'REMOVE') &&
    isDeadYear(context.mostRecentYear || 0)
  ) {
    updateExhumer(session);
  }

  switch (dispType) {
    case 'NA':
    case 'CTS':
    case 'WN/NIS':
      processUnreached(session);
      if (session.multipliers.cold_streak.chargesRemaining <= 0) {
        session.multipliers.cold_streak.dialsSinceLastYes++;
      }
      checkColdStreakTrigger(session);
      break;
    case 'NO':
    case 'REMOVE':
      processRejection(session, now);
      break;
    case 'COMPLETE':
      newBadges = processYes(session, false, 0, context, now);
      pointBreakdown = scorePoints(session, false, 0, newBadges);
      break;
    case 'PREPAY': {
      const price = context.price || 0;
      newBadges = processYes(session, true, price, context, now);
      pointBreakdown = scorePoints(session, true, price, newBadges);
      break;
    }
  }

  // Check workhorse badges
  const wh = checkWorkhorseBadges(session);
  newBadges = newBadges.concat(wh);

  return {
    session,
    newBadges,
    pointBreakdown,
    activeMultipliers: getActiveMultipliers(session),
    rank: getCurrentRank(session),
  };
}

// =============================================================================
// EXHUMER — disposition counter
// =============================================================================

function updateExhumer(session: GamificationSession): void {
  // Ensure state exists (migration safety)
  if (!session.multipliers.exhumer) {
    (session.multipliers as any).exhumer = { dispositionCount: 0, chargesRemaining: 0 };
  }
  const ex = session.multipliers.exhumer;
  // Only count if we don't already have a charge banked
  if (ex.chargesRemaining > 0) return;

  ex.dispositionCount++;
  if (ex.dispositionCount >= (MULTIPLIER_DEFS.exhumer.requiredDispositions || 20)) {
    ex.chargesRemaining = 1;
    ex.dispositionCount = 0;
  }
}

// =============================================================================
// UNREACHED (NA / CTS / WN-NIS)
// =============================================================================

function processUnreached(session: GamificationSession): void {
  const gt = session.multipliers.ghost_town;
  if (!gt.tier) gt.tier = 0;
  gt.consecutiveUnreached++;

  const def = MULTIPLIER_DEFS.ghost_town;
  if (gt.consecutiveUnreached >= (def.requiredUnreached || 10)) {
    gt.consecutiveUnreached = 0;
    if (gt.chargesRemaining > 0 && gt.tier >= 1 && gt.tier < 3) {
      gt.tier++;
    } else if (gt.chargesRemaining <= 0) {
      gt.tier = 1;
      gt.chargesRemaining = def.charges || 3;
    }
  }
}

function checkColdStreakTrigger(session: GamificationSession): void {
  const cs = session.multipliers.cold_streak;
  const def = MULTIPLIER_DEFS.cold_streak;
  if (cs.dialsSinceLastYes >= (def.requiredDials || 20) && cs.chargesRemaining <= 0) {
    cs.chargesRemaining = def.charges || 2;
    cs.dialsSinceLastYes = 0;
  }
}

// =============================================================================
// REJECTION (NO / REMOVE)
// =============================================================================

function processRejection(session: GamificationSession, now: number): void {
  session.consecutiveYes = 0;

  // Enraged tiered logic
  const en = session.multipliers.enraged;
  if (!en.tier) en.tier = 0;
  if (!en.frozen) {
    en.consecutiveRejections++;
    const tiers = MULTIPLIER_DEFS.enraged.tiers || [];
    if (en.consecutiveRejections >= (MULTIPLIER_DEFS.enraged.requiredRejections || 3)) {
      en.consecutiveRejections = 0;
      if (en.tier === 0) {
        en.tier = 1;
        en.chargesRemaining = tiers[0]?.charges || 1;
      } else if (en.tier < tiers.length) {
        en.tier++;
        en.chargesRemaining = tiers[en.tier - 1]?.charges || 1;
        if (en.tier >= tiers.length) en.frozen = true;
      }
    }
  }

  // Ghost Town: rejection resets consecutive unreached and consumes a charge
  session.multipliers.ghost_town.consecutiveUnreached = 0;
  if (session.multipliers.ghost_town.chargesRemaining > 0) {
    session.multipliers.ghost_town.chargesRemaining--;
    if (session.multipliers.ghost_town.chargesRemaining <= 0) {
      session.multipliers.ghost_town.tier = 0;
    }
  }

  // Cold streak: count dials during rejection too
  if (session.multipliers.cold_streak.chargesRemaining <= 0) {
    session.multipliers.cold_streak.dialsSinceLastYes++;
  }
  checkColdStreakTrigger(session);
}

// =============================================================================
// YES (COMPLETE / PREPAY)
// =============================================================================

function processYes(
  session: GamificationSession,
  isPrepay: boolean,
  price: number,
  context: DispositionContext,
  now: number
): string[] {
  const street = context.street || '';
  const streetAerCount = context.streetAerCount || 0;
  const mostRecentYear = context.mostRecentYear || 0;

  session.totalBookings++;
  session.consecutiveYes++;
  session.bookingTimestamps.push(now);

  if (isPrepay) {
    session.pps++;
    session.consecutivePrepays++;
    session.ppDollars += price;
  } else {
    session.pbs++;
    session.consecutivePrepays = 0;
  }

  if (streetAerCount <= 1) session.newStreetBookings++;

  // Raise the Dead: counts 2020, 2021, OR 2022 clients (combined)
  if (isDeadYear(mostRecentYear)) session.raisedDeadCount++;

  // Graveyard counters: per-year tracking for Graveyard badges
  if (mostRecentYear === 2022) {
    session.almostDeadCount = (session.almostDeadCount || 0) + 1;
  } else if (mostRecentYear === 2021) {
    session.actuallyDeadCount = (session.actuallyDeadCount || 0) + 1;
  } else if (mostRecentYear === 2020) {
    session.reallyDeadCount = (session.reallyDeadCount || 0) + 1;
  }

  // Conversion: track first-time prepays from non-app clients
  if (isPrepay && context.isFirstTimePrepay) {
    session.conversionCount = (session.conversionCount || 0) + 1;
    const indoc = session.multipliers.indoctrinate;
    if (!indoc) (session.multipliers as any).indoctrinate = { chargesRemaining: 0 };
    session.multipliers.indoctrinate.chargesRemaining = (MULTIPLIER_DEFS.indoctrinate.charges || 2);
  }

  // Ghost Town: YES resets consecutive unreached and consumes a charge
  session.multipliers.ghost_town.consecutiveUnreached = 0;
  if (session.multipliers.ghost_town.chargesRemaining > 0) {
    session.multipliers.ghost_town.chargesRemaining--;
    if (session.multipliers.ghost_town.chargesRemaining <= 0) {
      session.multipliers.ghost_town.tier = 0;
    }
  }

  // Cold Streak
  session.multipliers.cold_streak.dialsSinceLastYes = 0;
  if (session.multipliers.cold_streak.chargesRemaining > 0) {
    session.multipliers.cold_streak.chargesRemaining--;
  }

  consumeScorchedEarthCharge(session);
  updateTracerRounds(session, isPrepay, now);
  updateHighGround(session, street);
  updateNightVision(session, now);
  updateBlitz(session, now);
  consumeEnraged(session);

  if (context.streetFullyCleared && street !== '') {
    triggerScorchedEarth(session, street, context.streetVisibleGroupCount || 0);
  }

  const newBadges = evaluateAllBadges(session, isPrepay, price, context, now);

  if (street !== '') {
    if (!session.streetSales) session.streetSales = {};
    session.streetSales[street] = (session.streetSales[street] || 0) + 1;
  }

  return newBadges;
}

// =============================================================================
// MULTIPLIER UPDATES
// =============================================================================

function updateOpTempo(session: GamificationSession, now: number): void {
  const cutoff = now - 3600000;
  const windowCount = (session.bookingTimestamps || []).filter(t => t >= cutoff).length;
  session.multipliers.op_tempo.windowCount = windowCount;
}

function updateTracerRounds(session: GamificationSession, isPrepay: boolean, now: number): void {
  if (!isPrepay) return;
  const s = session.multipliers.tracer_rounds;
  s.prepayCount++;
  s.expiresAt = now + (MULTIPLIER_DEFS.tracer_rounds.timerDuration || 1200000);
}

function updateHighGround(session: GamificationSession, street: string): void {
  if (!street) return;
  session.multipliers.high_ground.activeStreet = street;
}

function updateNightVision(session: GamificationSession, now: number): void {
  if (new Date(now).getHours() >= (MULTIPLIER_DEFS.night_vision.activationHour || 20)) {
    session.multipliers.night_vision.bookingsAfter8++;
  }
}

function updateBlitz(session: GamificationSession, now: number): void {
  const s = session.multipliers.blitz;
  const d = MULTIPLIER_DEFS.blitz;
  if (s.triggered) return;

  const sessionStart = session.sessionStartTime || 0;
  if (sessionStart <= 0) return;

  const elapsed = now - sessionStart;
  const tiers = d.tiers || [];
  const maxWindow = (tiers[tiers.length - 1]?.maxMinutes || 60) * 60000;
  if (elapsed > maxWindow) return;

  s.earlyYesCount = (s.earlyYesCount || 0) + 1;
  if (s.earlyYesCount >= (d.requiredBookings || 5)) {
    s.triggered = true;
    s.triggerTime = now;
    const elapsedMin = elapsed / 60000;
    s.tier = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (elapsedMin <= (tiers[i].maxMinutes || 60)) { s.tier = i + 1; break; }
    }
    if (s.tier === 0) s.tier = tiers.length;
  }
}

function consumeEnraged(session: GamificationSession): void {
  const en = session.multipliers.enraged;
  if (!en.tier) en.tier = 0;
  en.consecutiveRejections = 0;
  if (en.chargesRemaining > 0) {
    en.chargesRemaining--;
    if (en.chargesRemaining <= 0) { en.tier = 0; en.frozen = false; }
  }
}

// =============================================================================
// WAR MACHINE
// =============================================================================

function updateWarMachine(session: GamificationSession, now: number): void {
  const wm = session.multipliers.war_machine;
  const def = MULTIPLIER_DEFS.war_machine;
  const inactivityWindow = def.inactivityWindowMs || 600000;
  const threshold = def.dialThreshold || 50;

  wm.totalDials = (wm.totalDials || 0) + 1;

  if (wm.active) {
    const timeSinceLast = wm.lastDialAt > 0 ? now - wm.lastDialAt : 0;
    if (timeSinceLast > inactivityWindow) {
      wm.active = false;
      wm.totalDials = 1;
    }
  } else {
    if (wm.totalDials >= threshold) {
      wm.active = true;
    }
  }

  wm.lastDialAt = now;
}

// =============================================================================
// SCORCHED EARTH
// =============================================================================

function triggerScorchedEarth(
  session: GamificationSession,
  street: string,
  groupCount: number
): void {
  const se = session.multipliers.scorched_earth;
  if (!se.clearedStreets) se.clearedStreets = {};
  if (se.clearedStreets[street]) return;

  const def = MULTIPLIER_DEFS.scorched_earth;
  const tiers = def.tiers || [];
  let bonus = 0;
  for (const tier of tiers) {
    if (groupCount >= (tier.minGroups || 0)) { bonus = tier.bonus || 0; break; }
  }
  if (bonus <= 0) return;

  se.clearedStreets[street] = true;
  if (!se.bonusStack) se.bonusStack = [];
  se.bonusStack.push({ bonus, charges: def.chargesPerTrigger || 2 });
}

function consumeScorchedEarthCharge(session: GamificationSession): void {
  const se = session.multipliers.scorched_earth;
  if (!se.bonusStack || se.bonusStack.length === 0) return;
  se.bonusStack[0].charges--;
  if (se.bonusStack[0].charges <= 0) se.bonusStack.shift();
}

// =============================================================================
// MULTIPLIER VALUE CALCULATION
// =============================================================================

function calculateMultiplier(session: GamificationSession, now: number): {
  total: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let total = 1.0;

  // Op Tempo
  const opS = session.multipliers.op_tempo;
  const opD = MULTIPLIER_DEFS.op_tempo;
  {
    const cutoff = now - 3600000;
    const wc = (session.bookingTimestamps || []).filter(t => t >= cutoff).length;
    opS.windowCount = wc;
    if (wc >= (opD.activationThreshold || 5)) {
      const v = Math.round(wc * (opD.perLevelBonus || 0.1) * 100) / 100;
      breakdown.op_tempo = v;
      total += v;
    }
  }

  // Tracer Rounds
  const trS = session.multipliers.tracer_rounds;
  const trD = MULTIPLIER_DEFS.tracer_rounds;
  if (trS.expiresAt > 0 && now > trS.expiresAt) { trS.prepayCount = 0; trS.expiresAt = 0; }
  if (trS.expiresAt > 0 && trS.prepayCount >= (trD.activationThreshold || 2)) {
    const v = (trD.baseMultiplier || 0.2) + (trS.prepayCount - (trD.activationThreshold || 2)) * (trD.perLevelBonus || 0.2);
    breakdown.tracer_rounds = Math.round(v * 100) / 100;
    total += v;
  }

  // High Ground
  if (session.multipliers.high_ground.active) {
    breakdown.high_ground = MULTIPLIER_DEFS.high_ground.flatMultiplier || 1.0;
    total += breakdown.high_ground;
  }

  // Night Vision
  const nvC = session.multipliers.night_vision.bookingsAfter8;
  if (nvC > 0) {
    const v = nvC * (MULTIPLIER_DEFS.night_vision.perBookingBonus || 0.2);
    breakdown.night_vision = Math.round(v * 100) / 100;
    total += v;
  }

  // Blitz
  const blS = session.multipliers.blitz;
  const blD = MULTIPLIER_DEFS.blitz;
  if (blS.triggered && blS.triggerTime > 0) {
    const blEnd = blS.triggerTime + (blD.decayDuration || 10800000);
    if (now < blEnd) {
      const rem = Math.max(0, 1 - ((now - blS.triggerTime) / (blD.decayDuration || 10800000)));
      const tiers = blD.tiers || [];
      let tierIdx = (blS.tier || 1) - 1;
      if (tierIdx < 0) tierIdx = tiers.length - 1;
      const startMult = tiers[tierIdx]?.multiplier || 1.0;
      const v = startMult * rem;
      if (v > 0.01) { breakdown.blitz = Math.round(v * 100) / 100; total += v; }
    }
  }

  // Enraged
  const enS = session.multipliers.enraged;
  if (!enS.tier) enS.tier = 0;
  if (enS.tier > 0 && enS.chargesRemaining > 0) {
    const enTiers = MULTIPLIER_DEFS.enraged.tiers || [];
    const enTierDef = enTiers[Math.min(enS.tier - 1, enTiers.length - 1)];
    breakdown.enraged = enTierDef?.multiplier || 1.0;
    total += breakdown.enraged;
  }

  // Ratio Focus
  if (session.totalBookings > 0) {
    const ratio = session.pps / session.totalBookings;
    if (ratio >= (MULTIPLIER_DEFS.ratio_focus.minimumRatio || 0.20)) {
      const v = Math.round(ratio * 100) / 100;
      breakdown.ratio_focus = v;
      total += v;
    }
  }

  // War Machine
  const wmS = session.multipliers.war_machine;
  if (wmS.active) {
    const wmVal = MULTIPLIER_DEFS.war_machine.flatMultiplier || 0.5;
    breakdown.war_machine = wmVal;
    total += wmVal;
  }

  // Ghost Town
  const gtS = session.multipliers.ghost_town;
  if (gtS.chargesRemaining > 0) {
    const gtTier = gtS.tier || 1;
    const gtVal = gtTier === 3 ? 2.0 : gtTier === 2 ? 1.0 : 0.5;
    breakdown.ghost_town = gtVal;
    total += gtVal;
  }

  // Cold Streak
  if (session.multipliers.cold_streak.chargesRemaining > 0) {
    breakdown.cold_streak = MULTIPLIER_DEFS.cold_streak.flatMultiplier || 1.0;
    total += breakdown.cold_streak;
  }

  // Scorched Earth
  const seS = session.multipliers.scorched_earth;
  if (seS.bonusStack && seS.bonusStack.length > 0) {
    let seT = 0;
    for (const stack of seS.bonusStack) seT += stack.bonus;
    seT = Math.round(seT * 100) / 100;
    breakdown.scorched_earth = seT;
    total += seT;
  }

  return { total: Math.round(total * 100) / 100, breakdown };
}

// =============================================================================
// POINT SCORING
// NOTE: Exhumer is NOT included in calculateMultiplier. It doubles the
// entire final grand total AFTER all other badges and multipliers are applied.
// =============================================================================

function scorePoints(
  session: GamificationSession,
  isPrepay: boolean,
  price: number,
  newBadges: string[]
): PointBreakdown {
  const now = Date.now();
  const base = isPrepay
    ? BASE_POINTS.prebook + Math.round(price * BASE_POINTS.prepayPerDollar)
    : BASE_POINTS.prebook;

  const mult = calculateMultiplier(session, now);
  const multipliedTotal = Math.round(base * mult.total);

  let badgeBonusTotal = 0;
  const badgeBonusDetail: Record<string, number> = {};
  for (const bId of newBadges) {
    const bDef = BADGE_DEFS[bId];
    if (bDef && bDef.bonus) {
      badgeBonusTotal += bDef.bonus;
      badgeBonusDetail[bId] = bDef.bonus;
    }
  }

  // Indoctrinate: when active, badge bonuses get multiplied too
  const indoc = session.multipliers.indoctrinate;
  const indocActive = indoc && indoc.chargesRemaining > 0;
  const finalBadgeBonus = indocActive
    ? Math.round(badgeBonusTotal * mult.total)
    : badgeBonusTotal;

  // Pre-Exhumer total (base × multiplier + badge bonuses)
  let grandTotal = multipliedTotal + finalBadgeBonus;

  // Consume Indoctrinate charge after scoring
  if (indocActive) {
    indoc.chargesRemaining--;
  }

  // Exhumer: if a charge is banked, double the entire grand total,
  // then consume the charge and reset the disposition counter to 0.
  const exhumer = session.multipliers.exhumer;
  const exhumerFired = exhumer && exhumer.chargesRemaining > 0;
  if (exhumerFired) {
    grandTotal = grandTotal * 2;
    exhumer.chargesRemaining = 0;
    exhumer.dispositionCount = 0;
  }

  session.totalSessionPoints += grandTotal;

  const record: BookingRecord = {
    time: now,
    type: isPrepay ? 'PREPAY' : 'PREBOOK',
    base,
    multiplier: mult.total,
    multiplierBreakdown: mult.breakdown,
    multiplied: multipliedTotal,
    badgeBonuses: badgeBonusDetail,
    badgeBonusTotal: finalBadgeBonus,
    grandTotal,
  };
  session.recentBookings.push(record);
  if (session.recentBookings.length > 10) {
    session.recentBookings = session.recentBookings.slice(-10);
  }

  return {
    time: now,
    type: isPrepay ? 'PREPAY' : 'PREBOOK',
    base,
    multiplier: mult.total,
    multiplierBreakdown: mult.breakdown,
    multiplied: multipliedTotal,
    badgeBonuses: badgeBonusDetail,
    badgeBonusTotal,
    grandTotal,
  };
}

// =============================================================================
// BADGE EVALUATION
// =============================================================================

function evaluateAllBadges(
  session: GamificationSession,
  isPrepay: boolean,
  price: number,
  context: DispositionContext,
  now: number
): string[] {
  const earned: string[] = [];
  const sn = context.sheetName || '';

  // Streak badges
  const s = session.consecutiveYes;
  const streakBadges: [number, string][] = [
    [10, 'beyond_godlike'], [9, 'tactical_nuke'], [8, 'legendary'], [7, 'godlike'],
    [6, 'rampage'], [5, 'ace'], [4, 'unstoppable'], [3, 'triple_kill'], [2, 'double_kill'],
  ];
  for (const [threshold, id] of streakBadges) {
    if (s >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
  }

  // Prepay streak
  if (isPrepay) {
    const cp = session.consecutivePrepays;
    const ppBadges: [number, string][] = [
      [6, 'domination'], [5, 'royal_flush'], [4, 'grand_slam'], [3, 'hat_trick'], [2, 'double_tap'],
    ];
    for (const [threshold, id] of ppBadges) {
      if (cp >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
    }
  }

  // Special prepay badges
  if (isPrepay) {
    if (session.pps === 1) {
      if (tryAwardBadge(session, 'first_blood', now, sn)) earned.push('first_blood');
    }
    if (context.yesStartTime && context.yesStartTime > 0 && (now - context.yesStartTime) < 120000) {
      if (tryAwardBadge(session, 'no_scope', now, sn)) earned.push('no_scope');
    }
    const rankBadges: [number, string][] = [
      [3500, 'supreme_cmdr'], [3000, 'warlord'], [2500, 'field_marshal'], [2000, 'general'],
      [1500, 'commander'], [1000, 'captain'], [500, 'lieutenant'], [250, 'sergeant'],
    ];
    for (const [threshold, id] of rankBadges) {
      if (session.ppDollars >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
    }
  }

  // Milestone badges
  const mileBadges: [number, string][] = [
    [100, 'legend'], [75, 'war_hero'], [50, 'veteran'], [25, 'sharpshooter'], [10, 'first_deploy'],
  ];
  for (const [threshold, id] of mileBadges) {
    if (session.totalBookings >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
  }

  // Time badges
  const hr = new Date(now).getHours();
  if (hr < 10) { if (tryAwardBadge(session, 'early_bird', now, sn)) earned.push('early_bird'); }
  if (hr >= 20) { if (tryAwardBadge(session, 'buzzer_beater', now, sn)) earned.push('buzzer_beater'); }

  // Fast start
  if (session.sessionStartTime > 0 && (now - session.sessionStartTime) < 600000) {
    if (tryAwardBadge(session, 'fast_start', now, sn)) earned.push('fast_start');
  }

  // Street badges
  const sac = context.streetAerCount || 0;
  if (sac >= 7) { if (tryAwardBadge(session, 'ducksplosion', now, sn)) earned.push('ducksplosion'); }
  else if (sac >= 5) { if (tryAwardBadge(session, 'ducks_in_a_row', now, sn)) earned.push('ducks_in_a_row'); }
  else if (sac >= 3) { if (tryAwardBadge(session, 'link_shot_kill', now, sn)) earned.push('link_shot_kill'); }

  // Headhunter
  const hhBadges: [number, string][] = [
    [30, 'apex_predator'], [20, 'trophy_hunter'], [10, 'headhunter'],
  ];
  for (const [threshold, id] of hhBadges) {
    if (session.newStreetBookings >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
  }

  // Raise the Dead — now counts 2020+2021+2022 combined via raisedDeadCount
  const rtdBadges: [number, string][] = [
    [40, 'resurrection'], [20, 'lich_king'], [10, 'necromancer'], [5, 'grave_digger'],
  ];
  for (const [threshold, id] of rtdBadges) {
    if (session.raisedDeadCount >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
  }

  // Graveyard — repeatable, awarded on every qualifying YES
  const mostRecentYear = context.mostRecentYear || 0;
  if (mostRecentYear === 2022) {
    if (tryAwardBadge(session, 'almost_dead', now, sn)) earned.push('almost_dead');
  } else if (mostRecentYear === 2021) {
    if (tryAwardBadge(session, 'actually_dead', now, sn)) earned.push('actually_dead');
  } else if (mostRecentYear === 2020) {
    if (tryAwardBadge(session, 'really_dead', now, sn)) earned.push('really_dead');
  }

  // Conversion
  const convBadges: [number, string][] = [
    [10, 'cult_leader'], [5, 'born_again'], [2, 'conversion_therapy'],
  ];
  for (const [threshold, id] of convBadges) {
    if ((session.conversionCount || 0) >= threshold) { if (tryAwardBadge(session, id, now, sn)) earned.push(id); break; }
  }

  // Spree badges
  const spree = evaluateSpreeBadges(session, now);
  earned.push(...spree);

  return earned;
}

function evaluateSpreeBadges(session: GamificationSession, now: number): string[] {
  const earned: string[] = [];
  if (!session.bookingTimestamps || session.bookingTimestamps.length < 5) return earned;

  const cutoff = now - 3600000;
  let count = 0;
  for (let i = session.bookingTimestamps.length - 1; i >= 0; i--) {
    if (session.bookingTimestamps[i] >= cutoff) count++;
    else break;
  }

  const spreeBadges: [number, string][] = [
    [15, 'annihilation'], [12, 'massacre'], [10, 'onslaught'], [7, 'warpath'], [5, 'killing_spree'],
  ];
  for (const [threshold, id] of spreeBadges) {
    if (count >= threshold) { if (tryAwardBadge(session, id, now, '')) earned.push(id); break; }
  }

  return earned;
}

// =============================================================================
// BADGE AWARD HELPER
// =============================================================================

function tryAwardBadge(
  session: GamificationSession,
  badgeId: string,
  now: number,
  sheetName: string
): boolean {
  const def = BADGE_DEFS[badgeId];
  if (!def) return false;

  if (def.type === 'once') {
    if (session.badgeOnceClaimed[badgeId]) return false;
    session.badgeOnceClaimed[badgeId] = true;
  }

  if (def.type === 'repeatable') {
    if (def.section === 'Streaks') {
      const epoch = session._streakBadgeEpoch || 0;
      for (let i = epoch; i < session.badges.length; i++) {
        if (session.badges[i].id === badgeId) return false;
      }
    }
    if (def.section === 'Prepay Streak') {
      const epoch = session._prepayStreakBadgeEpoch || 0;
      for (let i = epoch; i < session.badges.length; i++) {
        if (session.badges[i].id === badgeId) return false;
      }
    }
    if (def.section === 'Spree') {
      if (hasRecentBadge(session, badgeId, 3600000)) return false;
    }
    // Graveyard badges: one per booking (no dedup needed beyond the YES event itself)
    // Each YES only calls tryAwardBadge once for the relevant year badge, so
    // we allow it to stack freely. No extra dedup logic required.
  }

  const d = new Date(now);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${m < 10 ? '0' + m : m}${ampm}`;

  session.badges.push({
    id: badgeId,
    time: timeStr,
    sheet: sheetName,
    points: def.bonus || 0,
    timestamp: now,
  });

  return true;
}

function hasRecentBadge(session: GamificationSession, badgeId: string, windowMs: number): boolean {
  const cutoff = Date.now() - windowMs;
  for (let i = session.badges.length - 1; i >= 0; i--) {
    const b = session.badges[i];
    if (b.id === badgeId && b.timestamp && b.timestamp >= cutoff) return true;
    if (b.timestamp && b.timestamp < cutoff) break;
  }
  return false;
}

// =============================================================================
// DIAL TRACKING & WORKHORSE BADGES
// =============================================================================

function recordDial(session: GamificationSession, now: number): void {
  session.totalDials++;
  const hourKey = String(Math.floor(now / 3600000));
  if (!session.hourlyDials) session.hourlyDials = {};
  session.hourlyDials[hourKey] = (session.hourlyDials[hourKey] || 0) + 1;
}

function checkWorkhorseBadges(session: GamificationSession): string[] {
  const earned: string[] = [];
  if (!session.hourlyDials) return earned;

  const keys = Object.keys(session.hourlyDials).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return earned;

  let consecutive = 0;
  let maxC = 0;
  for (let i = 0; i < keys.length; i++) {
    if ((session.hourlyDials[String(keys[i])] || 0) >= 50) {
      consecutive = (i > 0 && keys[i] - keys[i - 1] === 1) ? consecutive + 1 : 1;
    } else {
      consecutive = 0;
    }
    if (consecutive > maxC) maxC = consecutive;
  }

  const now = Date.now();
  if (maxC >= 10) { if (tryAwardBadge(session, 'terminator', now, '')) earned.push('terminator'); }
  else if (maxC >= 5) { if (tryAwardBadge(session, 'machine', now, '')) earned.push('machine'); }
  else if (maxC >= 2) { if (tryAwardBadge(session, 'ironman', now, '')) earned.push('ironman'); }

  return earned;
}

// =============================================================================
// ACTIVE MULTIPLIERS SNAPSHOT (for HUD)
// =============================================================================

export function getActiveMultipliers(session: GamificationSession): MultiplierSnapshot[] {
  const now = Date.now();
  const active: MultiplierSnapshot[] = [];

  // Op Tempo
  const opS = session.multipliers.op_tempo;
  const opD = MULTIPLIER_DEFS.op_tempo;
  {
    const cutoff = now - 3600000;
    const wc = (session.bookingTimestamps || []).filter(t => t >= cutoff).length;
    if (wc >= (opD.activationThreshold || 5)) {
      active.push({
        id: 'op_tempo', name: opD.name, icon: opD.icon,
        value: Math.round(wc * (opD.perLevelBonus || 0.1) * 100) / 100,
        expiresIn: -1,
        extra: { windowCount: wc },
      });
    }
  }

  // Tracer Rounds
  const trS = session.multipliers.tracer_rounds;
  const trD = MULTIPLIER_DEFS.tracer_rounds;
  if (trS.expiresAt > 0 && now < trS.expiresAt && trS.prepayCount >= (trD.activationThreshold || 2)) {
    active.push({
      id: 'tracer_rounds', name: trD.name, icon: trD.icon,
      value: Math.round(((trD.baseMultiplier || 0.2) + (trS.prepayCount - (trD.activationThreshold || 2)) * (trD.perLevelBonus || 0.2)) * 100) / 100,
      expiresIn: trS.expiresAt - now,
    });
  }

  // High Ground
  if (session.multipliers.high_ground.active) {
    active.push({
      id: 'high_ground', name: MULTIPLIER_DEFS.high_ground.name,
      icon: MULTIPLIER_DEFS.high_ground.icon,
      value: MULTIPLIER_DEFS.high_ground.flatMultiplier || 1.0, expiresIn: -1,
    });
  }

  // Night Vision
  const nvC = session.multipliers.night_vision.bookingsAfter8;
  if (nvC > 0) {
    active.push({
      id: 'night_vision', name: MULTIPLIER_DEFS.night_vision.name,
      icon: MULTIPLIER_DEFS.night_vision.icon,
      value: Math.round(nvC * (MULTIPLIER_DEFS.night_vision.perBookingBonus || 0.2) * 100) / 100,
      expiresIn: -1,
    });
  }

  // Blitz
  const blS = session.multipliers.blitz;
  const blD = MULTIPLIER_DEFS.blitz;
  if (blS.triggered && blS.triggerTime > 0) {
    const blEnd = blS.triggerTime + (blD.decayDuration || 10800000);
    if (now < blEnd) {
      const rem = Math.max(0, 1 - ((now - blS.triggerTime) / (blD.decayDuration || 10800000)));
      const tiers = blD.tiers || [];
      let tierIdx = (blS.tier || 1) - 1;
      if (tierIdx < 0) tierIdx = tiers.length - 1;
      const tierDef = tiers[tierIdx];
      const v = (tierDef?.multiplier || 1.0) * rem;
      if (v > 0.01) {
        active.push({
          id: 'blitz', name: tierDef?.name || 'Blitz', icon: tierDef?.icon || '💥',
          value: Math.round(v * 100) / 100, expiresIn: blEnd - now,
        });
      }
    }
  }

  // Enraged
  const enS = session.multipliers.enraged;
  if (enS.tier > 0 && enS.chargesRemaining > 0) {
    const enTiers = MULTIPLIER_DEFS.enraged.tiers || [];
    const enTierDef = enTiers[Math.min(enS.tier - 1, enTiers.length - 1)];
    active.push({
      id: 'enraged', name: enTierDef?.name || 'Enraged', icon: enTierDef?.icon || '💢',
      value: enTierDef?.multiplier || 1.0, expiresIn: -1,
      extra: { charges: enS.chargesRemaining, tier: enS.tier },
    });
  }

  // Ratio Focus
  if (session.totalBookings > 0) {
    const ratio = session.pps / session.totalBookings;
    if (ratio >= (MULTIPLIER_DEFS.ratio_focus.minimumRatio || 0.20)) {
      active.push({
        id: 'ratio_focus', name: MULTIPLIER_DEFS.ratio_focus.name,
        icon: MULTIPLIER_DEFS.ratio_focus.icon,
        value: Math.round(ratio * 100) / 100, expiresIn: -1,
      });
    }
  }

  // War Machine
  const wmS = session.multipliers.war_machine;
  const wmDef = MULTIPLIER_DEFS.war_machine;
  if (wmS.active) {
    const inactivityWindow = wmDef.inactivityWindowMs || 600000;
    const elapsed = wmS.lastDialAt > 0 ? now - wmS.lastDialAt : 0;
    const remaining = Math.max(0, inactivityWindow - elapsed);
    active.push({
      id: 'war_machine', name: wmDef.name,
      icon: wmDef.icon,
      value: wmDef.flatMultiplier || 0.5,
      expiresIn: remaining,
    });
  }

  // Ghost Town
  const gtS = session.multipliers.ghost_town;
  if (gtS.chargesRemaining > 0) {
    const gtTier = gtS.tier || 1;
    const gtName = gtTier === 3 ? 'Haunted Town' : gtTier === 2 ? 'Super Ghost Town' : 'Ghost Town';
    const gtIcon = gtTier === 3 ? '👻' : gtTier === 2 ? '👻' : '👻';
    const gtVal = gtTier === 3 ? 2.0 : gtTier === 2 ? 1.0 : 0.5;
    active.push({
      id: 'ghost_town', name: gtName, icon: gtIcon, value: gtVal,
      expiresIn: -1, extra: { charges: gtS.chargesRemaining, tier: gtTier },
    });
  }

  // Cold Streak
  const csS = session.multipliers.cold_streak;
  if (csS.chargesRemaining > 0) {
    active.push({
      id: 'cold_streak', name: MULTIPLIER_DEFS.cold_streak.name,
      icon: MULTIPLIER_DEFS.cold_streak.icon,
      value: MULTIPLIER_DEFS.cold_streak.flatMultiplier || 1.0,
      expiresIn: -1, extra: { charges: csS.chargesRemaining },
    });
  }

  // Scorched Earth
  const seS = session.multipliers.scorched_earth;
  if (seS.bonusStack && seS.bonusStack.length > 0) {
    let seT = 0;
    let seCh = 0;
    for (const stack of seS.bonusStack) { seT += stack.bonus; seCh += stack.charges; }
    active.push({
      id: 'scorched_earth', name: MULTIPLIER_DEFS.scorched_earth.name,
      icon: MULTIPLIER_DEFS.scorched_earth.icon,
      value: Math.round(seT * 100) / 100,
      expiresIn: -1, extra: { charges: seCh, stacks: seS.bonusStack.length },
    });
  }

  // Indoctrinate
  const indocS = session.multipliers.indoctrinate;
  if (indocS && indocS.chargesRemaining > 0) {
    active.push({
      id: 'indoctrinate', name: MULTIPLIER_DEFS.indoctrinate.name,
      icon: MULTIPLIER_DEFS.indoctrinate.icon,
      value: 0,
      expiresIn: -1, extra: { charges: indocS.chargesRemaining, modifiesScoring: true },
    });
  }

  // Exhumer — shows as "2x FINAL" with charge count
  const exhumerS = session.multipliers.exhumer;
  if (exhumerS && exhumerS.chargesRemaining > 0) {
    active.push({
      id: 'exhumer', name: MULTIPLIER_DEFS.exhumer.name,
      icon: MULTIPLIER_DEFS.exhumer.icon,
      value: 2,
      expiresIn: -1,
      extra: {
        charges: exhumerS.chargesRemaining,
        doublesFinalScore: true,
        // Show progress toward next charge even while one is banked
        dispositionCount: exhumerS.dispositionCount,
      },
    });
  }

  return active;
}