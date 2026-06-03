// src/pages/Management/PayoutToday.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  Loader,
  Clock,
  Users,
  TrendingUp,
  DollarSign,
  Banknote,
  CreditCard,
  Receipt,
  Wallet,
  Trophy,
  Plus,
  X,
  Trash2,
  Star,
  Sparkles,
  Check,
  AlertTriangle,
  Camera,
  Truck,
  Shovel, // NEW: Sealing season banner icon
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  Worker,
  SortOption,
  ManagementUser,
  LogsheetSession,
  Bonus,
  BonusType,
  SessionTransaction,
  SeasonType,
} from '../../types';
import { sessionService } from '../../lib/sessionService';
import { seasonHasTeams, createEqualSplit } from '../../lib/commandCenterService';

// Import SVG icons for achievements
import GreenJacketIcon from '../../assets/green-jacket.svg';
import GoldJerseyIcon from '../../assets/gold-jersey.svg';
import SilverHatIcon from '../../assets/silver-hat.svg';

interface PayoutTodayProps {
  consoleProfileId: number;
  date: string;
  sortOption: SortOption;
  searchTerm: string;
  managers: ManagementUser[];
  workers: Worker[];
}

interface AggregatedStats {
  workerCount: number;
  totalSteps: number;
  prodGross: number;
  avgEQ: number;
  upsellCount: number;
  upsellGross: number;
  totalCash: number;
  totalCheque: number;
  totalETransfer: number;
  totalCreditCard: number;
  totalPrepaid: number;
  totalBilled: number;
}

interface ManagerGroupStats {
  totalSteps: number;
  totalUpsellGross: number;
  avgEQ: number;
  avgCommission: number;
}

interface BonusQualification {
  qualified: boolean;
  ratioPass: boolean;
  detailsPass: boolean;
  prebookCount: number;
  salesCount: number;
  detailsCollected: number;
  detailsPossible: number;
}

interface BonusWinner {
  firstName: string;
  lastName: string;
  bonus: Bonus;
  eq: number;
  upsellGross: number;
  finalCommission: number;
  // Session id needed for drag/reorder persistence
  sessionId: string;
}

// --- RENAMED: was RejuvWorkerPayout — now covers all team seasons (Rejuv + Sealing) ---
interface TeamWorkerPayout {
  worker: Worker;
  commission: number;
  bonusShare: number;
}

// --- RENAMED: was RejuvBonusWinner — cart-level bonus winner, per-worker breakdown ---
interface TeamBonusWinner {
  cartWorkers: Worker[];
  teamSize: number;
  bonus: Bonus;
  teamTotalEQ: number;
  workerPayouts: TeamWorkerPayout[];
  // Session id needed for drag/reorder persistence
  sessionId: string;
}

// Team cart with full worker and session data for any team season (Rejuv + Sealing)
interface TeamCartDisplay {
  teamId: string;
  sessionId: string;
  session: LogsheetSession;
  workers: Worker[];
  sharedStats: {
    stepCount: number;
    upsellGross: number;
    totalEQ: number;
  };
  isValidated: boolean;
  totalCommission: number;
}

// --- Equiv sort multiplier per team size ---
// Solo=1.0, Team of 2=1.5, Team of 3=2.0, Team of 4=2.5, etc.
// Not season-specific.
function getEquivMultiplier(teamSize: number): number {
  if (teamSize <= 1) return 1.0;
  return 1.0 + (teamSize - 1) * 0.5;
}

// --- RENAMED + EXTENDED: was getRejuvThresholds. Now season-aware. ---
// Rejuv (unchanged):  Solo 30/40/60 · Team 40/60/100 · Super 60/100/(50×size)
// Sealing (NEW):      Solo 40/60/80 · Team 60/80/120 · Super 60/80/(60×size)
function getTeamThresholds(
  teamSize: number,
  seasonType: SeasonType
): { green: number; gold: number; silver: number } {
  if (seasonType === 'sealing') {
    if (teamSize === 1) return { green: 40, gold: 60, silver: 80 };
    if (teamSize === 2) return { green: 60, gold: 80, silver: 120 };
    return { green: 80, gold: 120, silver: teamSize * 60 };
  }
  // Rejuv (and any future team season — Rejuv numbers are the default)
  if (teamSize === 1) return { green: 30, gold: 40, silver: 60 };
  if (teamSize === 2) return { green: 40, gold: 60, silver: 100 };
  return { green: 60, gold: 100, silver: teamSize * 50 };
}

// Dynamic sizing based on total bonus count and column count
type SizeConfig = {
  headerPadding: string;
  headerTrophy: string;
  headerTitle: string;
  headerDate: string;
  columnGap: string;
  sectionIcon: number;
  sectionTitle: string;
  sectionMargin: string;
  rowPadding: string;
  rowGap: string;
  rowMargin: string;
  medalSize: string;
  placingText: string;
  firstNameText: string;
  lastNameText: string;
  achievementSize: string;
  achievementContainer: string;
  eqOverlayText: string;
  upsellText: string;
  bonusText: string;
  payoutText: string;
  minWidthMedal: string;
  minWidthBonus: string;
  minWidthPayout: string;
};

function getSizeConfig(totalBonuses: number, columnCount: number): SizeConfig {
  if (columnCount === 4) {
    if (totalBonuses <= 8) {
      return {
        headerPadding: 'p-3',
        headerTrophy: 'text-3xl',
        headerTitle: 'text-xl md:text-2xl',
        headerDate: 'text-sm md:text-base',
        columnGap: 'gap-3',
        sectionIcon: 16,
        sectionTitle: 'text-sm',
        sectionMargin: 'mb-2',
        rowPadding: 'p-2',
        rowGap: 'gap-2',
        rowMargin: 'space-y-1.5',
        medalSize: 'text-2xl',
        placingText: 'text-[9px]',
        firstNameText: 'text-sm',
        lastNameText: 'text-xs',
        achievementSize: 'w-10 h-10',
        achievementContainer: 'w-12 h-12',
        eqOverlayText: 'text-xs',
        upsellText: 'text-xs',
        bonusText: 'text-xs',
        payoutText: 'text-lg',
        minWidthMedal: 'min-w-[35px]',
        minWidthBonus: 'min-w-[45px]',
        minWidthPayout: 'min-w-[70px]',
      };
    } else {
      return {
        headerPadding: 'p-2',
        headerTrophy: 'text-2xl',
        headerTitle: 'text-lg md:text-xl',
        headerDate: 'text-xs md:text-sm',
        columnGap: 'gap-2',
        sectionIcon: 14,
        sectionTitle: 'text-xs',
        sectionMargin: 'mb-1.5',
        rowPadding: 'p-1.5',
        rowGap: 'gap-1.5',
        rowMargin: 'space-y-1',
        medalSize: 'text-xl',
        placingText: 'text-[8px]',
        firstNameText: 'text-xs',
        lastNameText: 'text-[10px]',
        achievementSize: 'w-8 h-8',
        achievementContainer: 'w-10 h-10',
        eqOverlayText: 'text-[10px]',
        upsellText: 'text-[10px]',
        bonusText: 'text-[10px]',
        payoutText: 'text-base',
        minWidthMedal: 'min-w-[30px]',
        minWidthBonus: 'min-w-[40px]',
        minWidthPayout: 'min-w-[60px]',
      };
    }
  }

  if (columnCount === 3) {
    if (totalBonuses <= 9) {
      return {
        headerPadding: 'p-4',
        headerTrophy: 'text-4xl',
        headerTitle: 'text-2xl md:text-3xl',
        headerDate: 'text-base md:text-lg',
        columnGap: 'gap-4',
        sectionIcon: 20,
        sectionTitle: 'text-base',
        sectionMargin: 'mb-3',
        rowPadding: 'p-3',
        rowGap: 'gap-3',
        rowMargin: 'space-y-2',
        medalSize: 'text-3xl',
        placingText: 'text-[10px]',
        firstNameText: 'text-base',
        lastNameText: 'text-sm',
        achievementSize: 'w-14 h-14',
        achievementContainer: 'w-16 h-16',
        eqOverlayText: 'text-sm',
        upsellText: 'text-sm',
        bonusText: 'text-sm',
        payoutText: 'text-xl',
        minWidthMedal: 'min-w-[45px]',
        minWidthBonus: 'min-w-[55px]',
        minWidthPayout: 'min-w-[85px]',
      };
    } else {
      return {
        headerPadding: 'p-3',
        headerTrophy: 'text-3xl',
        headerTitle: 'text-xl md:text-2xl',
        headerDate: 'text-sm md:text-base',
        columnGap: 'gap-3',
        sectionIcon: 18,
        sectionTitle: 'text-sm',
        sectionMargin: 'mb-2',
        rowPadding: 'p-2',
        rowGap: 'gap-2',
        rowMargin: 'space-y-1.5',
        medalSize: 'text-2xl',
        placingText: 'text-[9px]',
        firstNameText: 'text-sm',
        lastNameText: 'text-xs',
        achievementSize: 'w-12 h-12',
        achievementContainer: 'w-14 h-14',
        eqOverlayText: 'text-xs',
        upsellText: 'text-xs',
        bonusText: 'text-xs',
        payoutText: 'text-lg',
        minWidthMedal: 'min-w-[40px]',
        minWidthBonus: 'min-w-[50px]',
        minWidthPayout: 'min-w-[75px]',
      };
    }
  }

  if (columnCount === 2) {
    if (totalBonuses <= 6) {
      return {
        headerPadding: 'p-5',
        headerTrophy: 'text-5xl',
        headerTitle: 'text-3xl md:text-4xl',
        headerDate: 'text-xl md:text-2xl',
        columnGap: 'gap-6',
        sectionIcon: 24,
        sectionTitle: 'text-xl',
        sectionMargin: 'mb-4',
        rowPadding: 'p-4',
        rowGap: 'gap-4',
        rowMargin: 'space-y-3',
        medalSize: 'text-4xl',
        placingText: 'text-sm',
        firstNameText: 'text-xl',
        lastNameText: 'text-base',
        achievementSize: 'w-16 h-16',
        achievementContainer: 'w-20 h-20',
        eqOverlayText: 'text-base',
        upsellText: 'text-base',
        bonusText: 'text-base',
        payoutText: 'text-2xl',
        minWidthMedal: 'min-w-[55px]',
        minWidthBonus: 'min-w-[65px]',
        minWidthPayout: 'min-w-[100px]',
      };
    } else {
      return {
        headerPadding: 'p-4',
        headerTrophy: 'text-4xl',
        headerTitle: 'text-2xl md:text-3xl',
        headerDate: 'text-lg md:text-xl',
        columnGap: 'gap-5',
        sectionIcon: 22,
        sectionTitle: 'text-lg',
        sectionMargin: 'mb-3',
        rowPadding: 'p-3',
        rowGap: 'gap-3',
        rowMargin: 'space-y-2',
        medalSize: 'text-3xl',
        placingText: 'text-xs',
        firstNameText: 'text-lg',
        lastNameText: 'text-sm',
        achievementSize: 'w-14 h-14',
        // FIXED: w-18 h-18 doesn't exist in Tailwind — bumped to w-20 h-20
        achievementContainer: 'w-20 h-20',
        eqOverlayText: 'text-sm',
        upsellText: 'text-sm',
        bonusText: 'text-sm',
        payoutText: 'text-xl',
        minWidthMedal: 'min-w-[50px]',
        minWidthBonus: 'min-w-[60px]',
        minWidthPayout: 'min-w-[90px]',
      };
    }
  }

  if (totalBonuses <= 4) {
    return {
      headerPadding: 'p-6',
      headerTrophy: 'text-6xl',
      headerTitle: 'text-4xl md:text-5xl',
      headerDate: 'text-2xl md:text-3xl',
      columnGap: 'gap-6',
      sectionIcon: 28,
      sectionTitle: 'text-2xl',
      sectionMargin: 'mb-5',
      rowPadding: 'p-5',
      rowGap: 'gap-5',
      rowMargin: 'space-y-4',
      medalSize: 'text-5xl',
      placingText: 'text-base',
      firstNameText: 'text-2xl',
      lastNameText: 'text-lg',
      achievementSize: 'w-20 h-20',
      achievementContainer: 'w-24 h-24',
      eqOverlayText: 'text-lg',
      upsellText: 'text-lg',
      bonusText: 'text-lg',
      payoutText: 'text-4xl',
      minWidthMedal: 'min-w-[70px]',
      minWidthBonus: 'min-w-[80px]',
      minWidthPayout: 'min-w-[130px]',
    };
  } else {
    return {
      headerPadding: 'p-5',
      headerTrophy: 'text-5xl',
      headerTitle: 'text-3xl md:text-4xl',
      headerDate: 'text-xl md:text-2xl',
      columnGap: 'gap-5',
      sectionIcon: 26,
      sectionTitle: 'text-xl',
      sectionMargin: 'mb-4',
      rowPadding: 'p-4',
      rowGap: 'gap-4',
      rowMargin: 'space-y-3',
      medalSize: 'text-4xl',
      placingText: 'text-sm',
      firstNameText: 'text-xl',
      lastNameText: 'text-base',
      // FIXED: w-18 h-18 doesn't exist in Tailwind — bumped to w-20 h-20
      achievementSize: 'w-20 h-20',
      // FIXED: w-22 h-22 doesn't exist in Tailwind — bumped to w-24 h-24
      achievementContainer: 'w-24 h-24',
      eqOverlayText: 'text-base',
      upsellText: 'text-base',
      bonusText: 'text-base',
      payoutText: 'text-3xl',
      minWidthMedal: 'min-w-[60px]',
      minWidthBonus: 'min-w-[70px]',
      minWidthPayout: 'min-w-[110px]',
    };
  }
}

// --- Bonus qualification rule ---
// isTeamSeason=true: Rejuv & Sealing — "new money" = Sale + Upgrade + Add-On, "old money" = Production.
//   (Sealing has no Upgrades/Add-Ons so the math reduces to Sale ≥ Production, per spec.)
// isTeamSeason=false: Aeration — sales (Sale+Upgrade) ≥ prebooks (Production).
function checkBonusQualification(transactions: SessionTransaction[], isTeamSeason = false): BonusQualification {
  if (isTeamSeason) {
    // Old money = Production (office flats/prepaids)
    // New money = Upgrade, Sale, Add-On
    const oldMoneyTxs = transactions.filter(tx => tx.type === 'Production');
    const newMoneyTxs = transactions.filter(tx => tx.type === 'Upgrade' || tx.type === 'Sale' || tx.type === 'Add-On');

    const oldMoneyCount = oldMoneyTxs.length;
    const newMoneyCount = newMoneyTxs.length;

    // 1:1 — new money must be >= old money
    const ratioPass = newMoneyCount >= oldMoneyCount;

    // Details check on new money transactions
    const detailsPossible = newMoneyTxs.length * 2;
    let detailsCollected = 0;
    newMoneyTxs.forEach(tx => {
      if (tx.customerPhone && tx.customerPhone.trim() !== '') detailsCollected++;
      if (tx.customerEmail && tx.customerEmail.trim() !== '') detailsCollected++;
    });
    const detailsPass = detailsPossible === 0 ? false : detailsCollected >= detailsPossible * 0.8;

    return {
      qualified: ratioPass && detailsPass,
      ratioPass,
      detailsPass,
      prebookCount: oldMoneyCount,
      salesCount: newMoneyCount,
      detailsCollected,
      detailsPossible,
    };
  }

  // Original aeration logic unchanged
  const prebookCount = transactions.filter(tx => tx.type === 'Production').length;
  const salesCount = transactions.filter(tx => tx.type === 'Upgrade' || tx.type === 'Sale').length;

  const ratioPass = salesCount > 0 && salesCount >= prebookCount;

  const upgradesAndSales = transactions.filter(tx => tx.type === 'Upgrade' || tx.type === 'Sale');
  const detailsPossible = upgradesAndSales.length * 2;

  let detailsCollected = 0;
  upgradesAndSales.forEach(tx => {
    if (tx.customerPhone && tx.customerPhone.trim() !== '') detailsCollected++;
    if (tx.customerEmail && tx.customerEmail.trim() !== '') detailsCollected++;
  });

  const detailsPass = detailsPossible === 0 ? false : detailsCollected >= detailsPossible * 0.8;

  return {
    qualified: ratioPass && detailsPass,
    ratioPass,
    detailsPass,
    prebookCount,
    salesCount,
    detailsCollected,
    detailsPossible,
  };
}

// --- Badge component — accepts thresholds prop so caller can pass Rejuv or Sealing cutoffs ---
function AchievementBadge({
  eq,
  thresholds,
  sizeClass,
  containerClass,
  textClass,
}: {
  eq: number;
  thresholds?: { green: number; gold: number; silver: number };
  sizeClass: string;
  containerClass: string;
  textClass: string;
}): React.ReactNode {
  const t = thresholds || { green: 30, gold: 40, silver: 50 };

  let icon = null;
  let bgColor = 'bg-gray-700';
  let textColor = 'text-blue-300';

  if (eq >= t.silver) {
    icon = <img src={SilverHatIcon} alt="Silver Hat" className={`${sizeClass} object-contain`} />;
    bgColor = 'bg-purple-900/50';
    textColor = 'text-purple-200';
  } else if (eq >= t.gold) {
    icon = <img src={GoldJerseyIcon} alt="Gold Jersey" className={`${sizeClass} object-contain`} />;
    bgColor = 'bg-yellow-900/50';
    textColor = 'text-yellow-200';
  } else if (eq >= t.green) {
    icon = <img src={GreenJacketIcon} alt="Green Jacket" className={`${sizeClass} object-contain`} />;
    bgColor = 'bg-green-900/50';
    textColor = 'text-green-200';
  }

  return (
    <div className={`relative ${containerClass} flex items-center justify-center rounded-lg ${bgColor}`}>
      {icon}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${textClass} font-black ${textColor} drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]`}>
          {eq.toFixed(1)}
          <span className="text-[0.6em] ml-0.5">EQ</span>
        </span>
      </div>
    </div>
  );
}

function getPlacingSuffix(n: number | 'other' | undefined): string {
  if (n === undefined || n === 'other') return '';
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function getMedalEmoji(placing: number | 'other' | undefined): string {
  if (placing === 1) return '🥇';
  if (placing === 2) return '🥈';
  if (placing === 3) return '🥉';
  return '🏆';
}

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// --- DND: Sortable wrapper for "Other" column cards ---
function SortableOtherCard({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
    position: 'relative',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
    >
      {children}
    </div>
  );
}

const PayoutToday: React.FC<PayoutTodayProps> = ({
  date,
  sortOption,
  searchTerm,
  managers,
  workers,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<{ worker: Worker; session: LogsheetSession }[]>([]);

  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  const isTeamSeason = seasonHasTeams(seasonType);

  // NEW: derive cart visual styles per season (Rejuv → green, Sealing → slate-gray).
  // Used in renderTeamCart so the multi-worker cart border/header/count-pill
  // visually matches the Admin & RMLogbook Sealing badges.
  const teamCartStyles = useMemo(() => {
    if (seasonType === 'sealing') {
      return {
        cartBorder: 'border-slate-600',
        cartHeaderBg: 'bg-slate-800/40',
        cartHeaderBorder: 'border-slate-600/50',
        cartCountPillBg: 'bg-slate-700/40',
        cartCountPillBorder: 'border-slate-600',
        cartCountIcon: 'text-slate-300',
        cartCountText: 'text-slate-200',
      };
    }
    // Default = Rejuv (and any future team season that doesn't override)
    return {
      cartBorder: 'border-green-700/50',
      cartHeaderBg: 'bg-green-900/20',
      cartHeaderBorder: 'border-green-700/30',
      cartCountPillBg: 'bg-green-900/40',
      cartCountPillBorder: 'border-green-700/50',
      cartCountIcon: 'text-green-400',
      cartCountText: 'text-green-400',
    };
  }, [seasonType]);

  const [showBonusModal, setShowBonusModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<LogsheetSession | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState<string>('');
  const [selectedTeamWorkers, setSelectedTeamWorkers] = useState<Worker[]>([]);

  const [showScreenshotModal, setShowScreenshotModal] = useState(false);

  const [bonusStep, setBonusStep] = useState<'type' | 'details'>('type');
  const [selectedBonusType, setSelectedBonusType] = useState<BonusType | null>(null);
  const [bonusPlacing, setBonusPlacing] = useState<number | 'other' | ''>('');
  const [bonusCustomDesc, setBonusCustomDesc] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusSplitPercentages, setBonusSplitPercentages] = useState<Record<string, number>>({});

  // DND sensors — pointer for mouse/touch, keyboard for accessibility.
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const currentSeasonType = await sessionService.getSessionSeasonType();
      setSeasonType(currentSeasonType);

      const allSessions = await sessionService.getLogsheetSessions();

      const merged = allSessions
        .map((session) => {
          const worker = workers.find((w) => w.contractorId === session.workerId);
          if (!worker) return null;
          return { worker, session };
        })
        .filter(Boolean) as { worker: Worker; session: LogsheetSession }[];

      setItems(merged);
    } catch (err) {
      console.error('PayoutToday Load Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (workers.length > 0) {
      loadData();
    }
  }, [date, workers]);

  const teamCartsDisplay = useMemo<TeamCartDisplay[]>(() => {
    if (!isTeamSeason) return [];

    const cartMap = new Map<string, TeamCartDisplay>();

    items.forEach(({ worker, session }) => {
      const cartKey = session.id;

      if (!cartMap.has(cartKey)) {
        const isValidated = session.validation?.isValidated || false;
        const eq = isValidated
          ? session.validation?.actualTotalEQ || 0
          : session.stats?.totalEQ || 0;

        cartMap.set(cartKey, {
          teamId: cartKey,
          sessionId: session.id,
          session,
          workers: [],
          sharedStats: {
            stepCount: session.stats?.stepCount || 0,
            upsellGross: session.stats?.upsellGross || 0,
            totalEQ: eq,
          },
          isValidated,
          totalCommission: session.validation?.finalCommission || 0,
        });
      }

      const cart = cartMap.get(cartKey)!;

      if (!cart.workers.find((w) => w.contractorId === worker.contractorId)) {
        cart.workers.push(worker);
      }

      if (session.teamWorkerIds && session.teamWorkerIds.length > 0) {
        session.teamWorkerIds.forEach((wid) => {
          if (!cart.workers.find((w) => w.contractorId === wid)) {
            const teamWorker = workers.find((w) => w.contractorId === wid);
            if (teamWorker) cart.workers.push(teamWorker);
          }
        });
      }
    });

    return Array.from(cartMap.values());
  }, [items, isTeamSeason, workers]);

  const aggregatedStats = useMemo<AggregatedStats>(() => {
    const stats: AggregatedStats = {
      workerCount: items.length,
      totalSteps: 0,
      prodGross: 0,
      avgEQ: 0,
      upsellCount: 0,
      upsellGross: 0,
      totalCash: 0,
      totalCheque: 0,
      totalETransfer: 0,
      totalCreditCard: 0,
      totalPrepaid: 0,
      totalBilled: 0,
    };

    let totalEQ = 0;

    if (isTeamSeason) {
      stats.workerCount = teamCartsDisplay.reduce((sum, cart) => sum + cart.workers.length, 0);

      teamCartsDisplay.forEach((cart) => {
        const session = cart.session;
        if (!session) return;
        const s = session.stats;
        const v = session.validation;
        const isValidated = v?.isValidated || false;

        stats.totalSteps += s.stepCount || 0;

        const prodCash = isValidated ? v?.actualProdCash || 0 : s.prodCash || 0;
        const prodCheque = isValidated ? v?.actualProdCheque || 0 : s.prodCheque || 0;
        const prodGrossCalc =
          (s.prodPrepaid || 0) +
          (s.prodBilled || 0) +
          prodCash +
          prodCheque +
          (s.prodETransfer || 0) +
          (s.prodCreditCard || 0) +
          (s.prodFlats || 0) +
          (s.prodPrepaidSplit || 0);
        stats.prodGross += prodGrossCalc;

        const eq = isValidated ? v?.actualTotalEQ || 0 : s.totalEQ || 0;
        totalEQ += eq;

        stats.upsellCount += s.upsellCount || 0;
        stats.upsellGross += s.upsellGross || 0;

        stats.totalCash += prodCash + (s.upsellCash || 0);
        stats.totalCheque += prodCheque + (s.upsellCheque || 0);
        stats.totalETransfer += (s.prodETransfer || 0) + (s.upsellETransfer || 0);
        stats.totalCreditCard += (s.prodCreditCard || 0) + (s.upsellCreditCard || 0);
        stats.totalPrepaid +=
          (s.prodFlats || 0) +
          (s.prodPrepaid || 0) +
          (s.prodPrepaidSplit || 0) +
          (s.upsellPrepaid || 0);
        stats.totalBilled += s.prodBilled || 0;
      });

      stats.avgEQ = teamCartsDisplay.length > 0 ? totalEQ / teamCartsDisplay.length : 0;
    } else {
      items.forEach(({ session }) => {
        const s = session.stats;
        const v = session.validation;
        const isValidated = v?.isValidated || false;

        stats.totalSteps += s.stepCount || 0;

        const prodCash = isValidated ? v?.actualProdCash || 0 : s.prodCash || 0;
        const prodCheque = isValidated ? v?.actualProdCheque || 0 : s.prodCheque || 0;
        const prodGrossCalc =
          (s.prodPrepaid || 0) +
          (s.prodBilled || 0) +
          prodCash +
          prodCheque +
          (s.prodETransfer || 0) +
          (s.prodCreditCard || 0) +
          (s.prodFlats || 0) +
          (s.prodPrepaidSplit || 0);
        stats.prodGross += prodGrossCalc;

        const eq = isValidated ? v?.actualTotalEQ || 0 : s.totalEQ || 0;
        totalEQ += eq;

        stats.upsellCount += s.upsellCount || 0;
        stats.upsellGross += s.upsellGross || 0;

        stats.totalCash += prodCash + (s.upsellCash || 0);
        stats.totalCheque += prodCheque + (s.upsellCheque || 0);
        stats.totalETransfer += (s.prodETransfer || 0) + (s.upsellETransfer || 0);
        stats.totalCreditCard += (s.prodCreditCard || 0) + (s.upsellCreditCard || 0);
        stats.totalPrepaid +=
          (s.prodFlats || 0) +
          (s.prodPrepaid || 0) +
          (s.prodPrepaidSplit || 0) +
          (s.upsellPrepaid || 0);
        stats.totalBilled += s.prodBilled || 0;
      });

      stats.avgEQ = items.length > 0 ? totalEQ / items.length : 0;
    }

    return stats;
  }, [items, teamCartsDisplay, isTeamSeason]);

  // Aeration bonus winners (unchanged)
  const bonusWinners = useMemo(() => {
    const winners: {
      performanceEQ: BonusWinner[];
      totalUpsell: BonusWinner[];
      rookie: BonusWinner[];
      other: BonusWinner[];
    } = { performanceEQ: [], totalUpsell: [], rookie: [], other: [] };

    items.forEach(({ worker, session }) => {
      if (!session.bonuses || session.bonuses.length === 0) return;

      const isValidated = session.validation?.isValidated || false;
      const eq = isValidated ? session.validation?.actualTotalEQ || 0 : session.stats.totalEQ;
      const finalCommission = session.validation?.finalCommission || 0;
      const upsellGross = session.stats.upsellGross || 0;

      session.bonuses.forEach((bonus) => {
        const winnerData: BonusWinner = {
          firstName: worker.firstName,
          lastName: worker.lastName,
          bonus,
          eq,
          upsellGross,
          finalCommission,
          sessionId: session.id,
        };

        switch (bonus.type) {
          case 'Performance EQ': winners.performanceEQ.push(winnerData); break;
          case 'Total Upsell': winners.totalUpsell.push(winnerData); break;
          case 'Rookie': winners.rookie.push(winnerData); break;
          case 'Other': winners.other.push(winnerData); break;
        }
      });
    });

    const sortByPlacingThenEQ = (a: BonusWinner, b: BonusWinner) => {
      const aP = typeof a.bonus.placing === 'number' ? a.bonus.placing : 999;
      const bP = typeof b.bonus.placing === 'number' ? b.bonus.placing : 999;
      if (aP === bP) return b.eq - a.eq;
      return aP - bP;
    };

    // "Other" column sorts by manual sortOrder (drag-to-reorder).
    const sortByManualOrder = (a: BonusWinner, b: BonusWinner) => {
      const aSO = a.bonus.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bSO = b.bonus.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (aSO !== bSO) return aSO - bSO;
      return a.bonus.id - b.bonus.id;
    };

    winners.performanceEQ.sort(sortByPlacingThenEQ);
    winners.totalUpsell.sort(sortByPlacingThenEQ);
    winners.rookie.sort(sortByPlacingThenEQ);
    winners.other.sort(sortByManualOrder);

    return winners;
  }, [items]);

  // --- RENAMED: was rejuvBonusWinners — cart-level winners for any team season (Rejuv + Sealing) ---
  const teamBonusWinners = useMemo(() => {
    const winners: {
      performanceEQ: TeamBonusWinner[];
      totalUpsell: TeamBonusWinner[];
      rookie: TeamBonusWinner[];
      other: TeamBonusWinner[];
    } = { performanceEQ: [], totalUpsell: [], rookie: [], other: [] };

    if (!isTeamSeason) return winners;

    teamCartsDisplay.forEach((cart) => {
      const session = cart.session;
      if (!session.bonuses || session.bonuses.length === 0) return;

      const teamSize = cart.workers.length;
      const teamTotalEQ = cart.sharedStats.totalEQ;

      // Use calculateTeamPayouts for accurate per-worker commission
      const payoutBreakdowns = sessionService.calculateTeamPayouts(
        session,
        cart.workers,
        seasonType
      );
      const payoutMap = new Map(payoutBreakdowns.map(p => [p.workerId, p]));

      session.bonuses.forEach((bonus) => {
        const workerPayouts: TeamWorkerPayout[] = cart.workers.map((w) => {
          const equivPercent =
            (session.equivSplit?.[w.contractorId] ?? 100 / teamSize) / 100;

          const payout = payoutMap.get(w.contractorId);
          const commission = payout?.finalCommission || 0;

          const bonusSplitPercent =
            bonus.splitPercentages?.[w.contractorId] ?? equivPercent * 100;
          const bonusShare = bonus.amount * (bonusSplitPercent / 100);

          return { worker: w, commission, bonusShare };
        });

        const winnerData: TeamBonusWinner = {
          cartWorkers: cart.workers,
          teamSize,
          bonus,
          teamTotalEQ,
          workerPayouts,
          sessionId: session.id,
        };

        switch (bonus.type) {
          case 'Performance EQ': winners.performanceEQ.push(winnerData); break;
          case 'Total Upsell': winners.totalUpsell.push(winnerData); break;
          case 'Rookie': winners.rookie.push(winnerData); break;
          case 'Other': winners.other.push(winnerData); break;
        }
      });
    });

    const sortByPlacing = (a: TeamBonusWinner, b: TeamBonusWinner) => {
      const aP = typeof a.bonus.placing === 'number' ? a.bonus.placing : 999;
      const bP = typeof b.bonus.placing === 'number' ? b.bonus.placing : 999;
      if (aP === bP) return b.teamTotalEQ - a.teamTotalEQ;
      return aP - bP;
    };

    const sortByManualOrder = (a: TeamBonusWinner, b: TeamBonusWinner) => {
      const aSO = a.bonus.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bSO = b.bonus.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (aSO !== bSO) return aSO - bSO;
      return a.bonus.id - b.bonus.id;
    };

    winners.performanceEQ.sort(sortByPlacing);
    winners.totalUpsell.sort(sortByPlacing);
    winners.rookie.sort(sortByPlacing);
    winners.other.sort(sortByManualOrder);

    return winners;
  }, [teamCartsDisplay, isTeamSeason, seasonType]);

  // Use the right winners set depending on season
  const activeBonusWinners = isTeamSeason ? teamBonusWinners : bonusWinners;

  const totalBonusCount = useMemo(() => {
    return (
      activeBonusWinners.performanceEQ.length +
      activeBonusWinners.totalUpsell.length +
      activeBonusWinners.rookie.length +
      activeBonusWinners.other.length
    );
  }, [activeBonusWinners]);

  const activeColumns = useMemo(() => {
    return [
      activeBonusWinners.performanceEQ.length > 0,
      activeBonusWinners.totalUpsell.length > 0,
      activeBonusWinners.rookie.length > 0,
      activeBonusWinners.other.length > 0,
    ].filter(Boolean).length;
  }, [activeBonusWinners]);

  const sizeConfig = useMemo(
    () => getSizeConfig(totalBonusCount, activeColumns),
    [totalBonusCount, activeColumns]
  );

  const hasBonuses = totalBonusCount > 0;

  // --- Drag-end handler for "Other" column reordering ---
  const handleOtherDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOther = activeBonusWinners.other as (BonusWinner | TeamBonusWinner)[];
    const oldIds = currentOther.map((w) => `bonus-${w.bonus.id}`);
    const oldIndex = oldIds.indexOf(String(active.id));
    const newIndex = oldIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(currentOther, oldIndex, newIndex);

    const updatesBySession: Record<string, Record<number, number>> = {};
    reordered.forEach((winner, idx) => {
      const sid = winner.sessionId;
      if (!updatesBySession[sid]) updatesBySession[sid] = {};
      updatesBySession[sid][winner.bonus.id] = idx;
    });

    try {
      const allSessions = isTeamSeason
        ? teamCartsDisplay.map((c) => c.session)
        : items.map((i) => i.session);

      const savePromises: Promise<void>[] = [];
      for (const [sid, newOrders] of Object.entries(updatesBySession)) {
        const sess = allSessions.find((s) => s.id === sid);
        if (!sess || !sess.bonuses) continue;

        const updatedBonuses: Bonus[] = sess.bonuses.map((b) => {
          if (b.type === 'Other' && newOrders[b.id] !== undefined) {
            return { ...b, sortOrder: newOrders[b.id] };
          }
          return b;
        });

        savePromises.push(
          sessionService.updateLogsheetSession(sid, { bonuses: updatedBonuses })
        );
      }

      await Promise.all(savePromises);
      await loadData();
    } catch (err) {
      console.error('Failed to persist bonus reorder:', err);
    }
  };

  const sortedItems = useMemo(() => {
    let filtered = items;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.worker.firstName.toLowerCase().includes(lower) ||
          i.worker.lastName.toLowerCase().includes(lower) ||
          i.worker.contractorId.includes(lower)
      );
    }

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'standard': {
          const aManager =
            managers.find((m) => m.userId === a.worker.assignedManagerId)?.name || 'ZZZ';
          const bManager =
            managers.find((m) => m.userId === b.worker.assignedManagerId)?.name || 'ZZZ';
          if (aManager !== bManager) return aManager.localeCompare(bManager);
          const lastNameCompare = a.worker.lastName.localeCompare(b.worker.lastName);
          if (lastNameCompare !== 0) return lastNameCompare;
          return a.worker.firstName.localeCompare(b.worker.firstName);
        }
        case 'alpha': {
          const lastNameCompare = a.worker.lastName.localeCompare(b.worker.lastName);
          if (lastNameCompare !== 0) return lastNameCompare;
          return a.worker.firstName.localeCompare(b.worker.firstName);
        }
        case 'steps':
          return (b.session.stats.stepCount || 0) - (a.session.stats.stepCount || 0);
        case 'equiv':
          return (b.session.stats.totalEQ || 0) - (a.session.stats.totalEQ || 0);
        case 'upsell':
          return (b.session.stats.upsellCount || 0) - (a.session.stats.upsellCount || 0);
        case 'upGross':
          return (b.session.stats.upsellGross || 0) - (a.session.stats.upsellGross || 0);
        case 'commission':
          return (
            (b.session.validation?.finalCommission || 0) -
            (a.session.validation?.finalCommission || 0)
          );
        default:
          return 0;
      }
    });
  }, [items, searchTerm, sortOption, managers]);

  // equiv case now uses multiplier for team-season sort
  const sortedTeamCarts = useMemo(() => {
    if (!isTeamSeason) return [];

    let filtered = teamCartsDisplay;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter((cart) =>
        cart.workers.some(
          (w) =>
            w.firstName.toLowerCase().includes(lower) ||
            w.lastName.toLowerCase().includes(lower) ||
            w.contractorId.includes(lower)
        )
      );
    }

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'steps':
          return b.sharedStats.stepCount - a.sharedStats.stepCount;
        case 'equiv':
          return b.sharedStats.totalEQ - a.sharedStats.totalEQ;
        case 'bonusEquiv': {
          const aScore = a.sharedStats.totalEQ / getEquivMultiplier(a.workers.length);
          const bScore = b.sharedStats.totalEQ / getEquivMultiplier(b.workers.length);
          return bScore - aScore;
        }
        case 'upGross':
          return b.sharedStats.upsellGross - a.sharedStats.upsellGross;
        case 'commission':
          return b.totalCommission - a.totalCommission;
        default: {
          const aName = a.workers[0]?.lastName || '';
          const bName = b.workers[0]?.lastName || '';
          return aName.localeCompare(bName);
        }
      }
    });
  }, [teamCartsDisplay, searchTerm, sortOption, isTeamSeason]);

  const groupedByManager = useMemo(() => {
    if (sortOption !== 'standard' || isTeamSeason) return null;

    type GroupValue = {
      manager: ManagementUser | null;
      items: typeof sortedItems;
      stats: ManagerGroupStats;
    };
    const groups: Record<string, GroupValue> = {};

    sortedItems.forEach((item) => {
      const managerId = item.worker.assignedManagerId || 'unassigned';
      if (!groups[managerId]) {
        const manager = managers.find((m) => m.userId === managerId) || null;
        groups[managerId] = {
          manager,
          items: [],
          stats: { totalSteps: 0, totalUpsellGross: 0, avgEQ: 0, avgCommission: 0 },
        };
      }
      groups[managerId].items.push(item);
    });

    Object.values(groups).forEach((group) => {
      let totalEQ = 0;
      let totalCommission = 0;

      group.items.forEach(({ session }) => {
        const v = session.validation;
        const isValidated = v?.isValidated || false;

        group.stats.totalSteps += session.stats.stepCount || 0;
        group.stats.totalUpsellGross += session.stats.upsellGross || 0;

        const eq = isValidated ? v?.actualTotalEQ || 0 : session.stats.totalEQ || 0;
        totalEQ += eq;

        totalCommission += v?.finalCommission || 0;
      });

      const workerCount = group.items.length;
      group.stats.avgEQ = workerCount > 0 ? totalEQ / workerCount : 0;
      group.stats.avgCommission = workerCount > 0 ? totalCommission / workerCount : 0;
    });

    return Object.entries(groups).sort(([, a], [, b]) => {
      const aName = a.manager?.name || 'ZZZ';
      const bName = b.manager?.name || 'ZZZ';
      return aName.localeCompare(bName);
    });
  }, [sortedItems, sortOption, managers, isTeamSeason]);

  const handleOpenBonusModal = (
    session: LogsheetSession,
    workerName: string,
    teamWorkers?: Worker[]
  ) => {
    setSelectedSession(session);
    setSelectedWorkerName(workerName);
    setSelectedTeamWorkers(teamWorkers || []);
    setBonusStep('type');
    setSelectedBonusType(null);
    setBonusPlacing('');
    setBonusCustomDesc('');
    setBonusAmount('');

    if (teamWorkers && teamWorkers.length > 1) {
      const equalSplit = createEqualSplit(teamWorkers.map((w) => w.contractorId));
      setBonusSplitPercentages(equalSplit);
    } else {
      setBonusSplitPercentages({});
    }

    setShowBonusModal(true);
  };

  const handleCloseBonusModal = () => {
    setShowBonusModal(false);
    setSelectedSession(null);
    setSelectedTeamWorkers([]);
  };

  const handleSelectBonusType = (type: BonusType) => {
    setSelectedBonusType(type);
    setBonusPlacing('');
    setBonusCustomDesc('');
    setBonusAmount('');
    setBonusStep('details');
  };

  const handleBackToTypeSelection = () => {
    setBonusStep('type');
    setSelectedBonusType(null);
  };

  const handleAddBonus = async () => {
    if (!selectedSession || !selectedBonusType || !bonusAmount) return;

    const amt = parseFloat(bonusAmount);
    if (isNaN(amt) || amt <= 0) return;

    if (selectedBonusType !== 'Other' && !bonusPlacing) return;
    if (selectedBonusType === 'Other' && !bonusCustomDesc.trim()) return;
    if (bonusPlacing === 'other' && !bonusCustomDesc.trim()) return;

    const newBonus: Bonus = {
      id: Date.now(),
      type: selectedBonusType,
      amount: amt,
      placing: selectedBonusType !== 'Other' ? (bonusPlacing as number | 'other') : undefined,
      customDescription:
        selectedBonusType === 'Other' || bonusPlacing === 'other' ? bonusCustomDesc : undefined,
      splitPercentages: selectedTeamWorkers.length > 1 ? bonusSplitPercentages : undefined,
    };

    const updatedBonuses = [...(selectedSession.bonuses || []), newBonus];

    const currentPay = selectedSession.validation?.finalCommission || 0;
    const newPay = currentPay + amt;

    const updatedValidation = selectedSession.validation
      ? { ...selectedSession.validation, finalCommission: newPay }
      : undefined;

    await sessionService.updateLogsheetSession(selectedSession.id, {
      bonuses: updatedBonuses,
      validation: updatedValidation,
    });

    handleCloseBonusModal();
    loadData();
  };

  const handleRemoveBonus = async (bonusId: number) => {
    if (!selectedSession) return;

    const bonusToRemove = selectedSession.bonuses?.find((b) => b.id === bonusId);
    if (!bonusToRemove) return;

    const updatedBonuses = (selectedSession.bonuses || []).filter((b) => b.id !== bonusId);

    const currentPay = selectedSession.validation?.finalCommission || 0;
    const newPay = currentPay - bonusToRemove.amount;

    const updatedValidation = selectedSession.validation
      ? { ...selectedSession.validation, finalCommission: newPay }
      : undefined;

    await sessionService.updateLogsheetSession(selectedSession.id, {
      bonuses: updatedBonuses,
      validation: updatedValidation,
    });

    handleCloseBonusModal();
    loadData();
  };

  const formatBonusDisplay = (bonus: Bonus): string => {
    if (bonus.type === 'Other') return bonus.customDescription || 'Other';
    if (bonus.placing === 'other') return `${bonus.type} - ${bonus.customDescription}`;
    return `${bonus.type} - ${getPlacingSuffix(bonus.placing)} Place`;
  };

  // checkBonusQualification's second arg = isTeamSeason (true for Rejuv AND Sealing)
  const selectedQualification = selectedSession
    ? checkBonusQualification(selectedSession.financialStore || [], isTeamSeason)
    : null;

  if (loading)
    return (
      <div className="p-10 text-center flex-1 flex items-center justify-center">
        <Loader className="inline animate-spin text-cps-blue" />
        <span className="ml-2 text-gray-400">Loading Payouts...</span>
      </div>
    );

  // --- RENDER TEAM CART (Rejuv + Sealing) ---
  // CHANGED: multi-worker cart border/header/count-pill now uses teamCartStyles
  // so Sealing gets slate-gray and Rejuv keeps green. Solo carts unchanged.
  const renderTeamCart = (cart: TeamCartDisplay) => {
    const { session, workers: cartWorkers, sharedStats, isValidated, totalCommission } = cart;
    const bonusTotal = (session.bonuses || []).reduce((sum, b) => sum + b.amount, 0);
    const qualification = checkBonusQualification(session.financialStore || [], true);
    const isSoloCart = cartWorkers.length === 1;

    return (
      <div
        key={cart.teamId}
        className={`bg-gray-800 border-2 ${isSoloCart ? 'border-gray-700' : teamCartStyles.cartBorder} rounded-lg overflow-hidden mb-2`}
      >
        <div
          className={`px-3 py-2 ${isSoloCart ? 'bg-gray-750' : teamCartStyles.cartHeaderBg} border-b ${isSoloCart ? 'border-gray-700' : teamCartStyles.cartHeaderBorder} flex items-center justify-between`}
        >
          <div className="flex items-center gap-3">
            {!isSoloCart && (
              <div className={`flex items-center gap-1 ${teamCartStyles.cartCountPillBg} px-2 py-1 rounded border ${teamCartStyles.cartCountPillBorder}`}>
                <Truck size={12} className={teamCartStyles.cartCountIcon} />
                <span className={`${teamCartStyles.cartCountText} font-bold text-[10px]`}>{cartWorkers.length}</span>
              </div>
            )}

            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                isValidated
                  ? 'bg-green-900/30 text-green-400 border border-green-800'
                  : 'bg-yellow-900/30 text-yellow-500 border border-yellow-800'
              }`}
            >
              <Clock size={8} />
              {isValidated ? 'Paid' : 'Pending'}
            </span>
          </div>

          <div className="flex items-center gap-4 text-gray-400 text-xs">
            <div className="text-center">
              <span className="text-[9px] text-gray-600 uppercase block leading-none">Steps</span>
              <span className="font-bold text-gray-300">{sharedStats.stepCount}</span>
            </div>
            <div className="text-center">
              <span className="text-[9px] text-gray-600 uppercase block leading-none">Upsell</span>
              <span className="font-bold text-white">${sharedStats.upsellGross.toFixed(2)}</span>
            </div>
            <div className="text-center">
              <span className="text-[9px] text-gray-600 uppercase block leading-none">
                {isSoloCart ? 'EQ' : 'Team EQ'}
              </span>
              <span className="font-mono font-bold text-blue-300">
                {sharedStats.totalEQ.toFixed(2)}
              </span>
            </div>
            {isValidated && (
              <div className="text-center">
                <span className="text-[9px] text-gray-600 uppercase block leading-none">
                  {isSoloCart ? 'Total' : 'Team Total'}
                </span>
                <span className="font-mono font-bold text-green-400">
                  ${totalCommission.toFixed(2)}
                </span>
              </div>
            )}

            {isValidated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const teamName = cartWorkers
                    .map((w) => `${w.firstName} ${w.lastName}`)
                    .join(', ');
                  handleOpenBonusModal(session, teamName, cartWorkers);
                }}
                className={`px-2 py-1 rounded text-[9px] font-bold flex items-center gap-1 transition-colors ${
                  bonusTotal > 0
                    ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700 hover:bg-yellow-900/50'
                    : qualification.qualified
                    ? 'bg-blue-900/30 text-blue-400 border border-blue-800 hover:bg-blue-900/50'
                    : 'bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50'
                }`}
              >
                {bonusTotal > 0 ? (
                  <>
                    <Trophy size={10} /> +${bonusTotal.toFixed(0)}
                  </>
                ) : (
                  <>
                    <Plus size={10} /> Bonus
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-gray-700/50">
          {cartWorkers.map((worker) => {
            let workerCommission = 0;
            if (isValidated) {
              const equivSplitPercent =
                session.equivSplit?.[worker.contractorId] || 100 / cartWorkers.length;
              workerCommission = totalCommission * (equivSplitPercent / 100);
            }

            return (
              <div
                key={worker.contractorId}
                onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
                className="px-3 py-2 flex items-center gap-2 hover:bg-gray-750 transition-colors cursor-pointer group text-xs"
              >
                <div
                  className={`w-0.5 h-5 rounded-full flex-shrink-0 ${
                    isValidated ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                />

                <div className="font-bold text-gray-200 min-w-[140px] truncate hover:text-white">
                  {worker.firstName} {worker.lastName}
                </div>

                <span className="text-gray-500 font-mono text-[10px] min-w-[50px]">
                  #{worker.contractorId}
                </span>

                {!isSoloCart && session.equivSplit && (
                  <span className="text-gray-500 text-[10px]">
                    ({session.equivSplit[worker.contractorId] || 0}%)
                  </span>
                )}

                <div className="flex-1" />

                {isValidated && (
                  <div className="text-center min-w-[70px]">
                    <span className="text-[9px] text-gray-600 uppercase block leading-none">
                      Comm
                    </span>
                    <span className="font-mono font-bold text-green-400">
                      ${workerCommission.toFixed(2)}
                    </span>
                  </div>
                )}

                <ChevronRight
                  size={14}
                  className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0"
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // --- RENDER WORKER ROW (Aeration — unchanged) ---
  const renderWorkerRow = ({
    worker,
    session,
  }: {
    worker: Worker;
    session: LogsheetSession;
  }) => {
    const isValidated = session.validation?.isValidated || false;
    const payAmount = session.validation?.finalCommission ?? 0;
    const eq = isValidated ? session.validation?.actualTotalEQ || 0 : session.stats.totalEQ;
    const bonusTotal = (session.bonuses || []).reduce((sum, b) => sum + b.amount, 0);

    const qualification = checkBonusQualification(session.financialStore || [], false);

    return (
      <div
        key={session.id}
        className="bg-gray-800 border border-gray-700 py-1.5 px-2 rounded flex items-center gap-2 hover:bg-gray-750 hover:border-gray-600 transition-colors group text-xs"
      >
        <div
          className={`w-0.5 h-5 rounded-full flex-shrink-0 ${
            isValidated ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />

        <div
          onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
          className="font-bold text-gray-200 min-w-[120px] truncate cursor-pointer hover:text-white"
        >
          {worker.firstName} {worker.lastName}
        </div>

        <span className="text-gray-500 font-mono text-[10px] min-w-[50px]">
          #{worker.contractorId}
        </span>

        <span className="text-gray-700">|</span>

        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 min-w-[55px] justify-center ${
            isValidated
              ? 'bg-green-900/30 text-green-400 border border-green-800'
              : 'bg-yellow-900/30 text-yellow-500 border border-yellow-800'
          }`}
        >
          <Clock size={8} />
          {isValidated ? 'Paid' : 'Pending'}
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-gray-400">
          <div className="text-center min-w-[40px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Steps</span>
            <span className="font-bold text-gray-300">{session.stats.stepCount}</span>
          </div>
          <div className="text-center min-w-[50px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Upsell</span>
            <span className="font-bold text-white">${session.stats.upsellGross.toFixed(2)}</span>
          </div>
          <div className="text-center min-w-[40px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">EQ</span>
            <span className="font-mono font-bold text-blue-300">{eq.toFixed(2)}</span>
          </div>
          <div className="text-center min-w-[55px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Comm</span>
            <span className={`font-mono font-bold ${isValidated ? 'text-green-400' : 'text-gray-500'}`}>
              ${payAmount.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="ml-2 min-w-[70px] flex justify-center">
          {isValidated ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenBonusModal(session, `${worker.firstName} ${worker.lastName}`);
              }}
              className={`px-2 py-1 rounded text-[9px] font-bold flex items-center gap-1 transition-colors ${
                bonusTotal > 0
                  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700 hover:bg-yellow-900/50'
                  : qualification.qualified
                  ? 'bg-blue-900/30 text-blue-400 border border-blue-800 hover:bg-blue-900/50'
                  : 'bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50'
              }`}
            >
              {bonusTotal > 0 ? (
                <>
                  <Trophy size={10} /> +${bonusTotal.toFixed(0)}
                </>
              ) : (
                <>
                  <Plus size={10} /> Bonus
                </>
              )}
            </button>
          ) : (
            <div className="w-[60px]" />
          )}
        </div>

        <ChevronRight
          size={14}
          onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
          className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0 cursor-pointer"
        />
      </div>
    );
  };

  // --- RENAMED: was renderRejuvWinnerRow — now uses getTeamThresholds with seasonType ---
  const renderTeamWinnerRow = (winner: TeamBonusWinner, idx: number) => {
    const thresholds = getTeamThresholds(winner.teamSize, seasonType);

    return (
      <div
        key={idx}
        className={`bg-gray-800/80 rounded-xl border border-gray-700 ${sizeConfig.rowPadding} flex items-start ${sizeConfig.rowGap}`}
      >
        {/* Medal + placing */}
        <div className={`flex flex-col items-center flex-shrink-0 ${sizeConfig.minWidthMedal}`}>
          <span className={sizeConfig.medalSize}>{getMedalEmoji(winner.bonus.placing)}</span>
          <span className={`text-white font-bold ${sizeConfig.placingText}`}>
            {winner.bonus.placing === 'other'
              ? winner.bonus.customDescription
              : getPlacingSuffix(winner.bonus.placing)}
          </span>
        </div>

        {/* EQ Badge with correct team thresholds */}
        <AchievementBadge
          eq={winner.teamTotalEQ}
          thresholds={thresholds}
          sizeClass={sizeConfig.achievementSize}
          containerClass={sizeConfig.achievementContainer}
          textClass={sizeConfig.eqOverlayText}
        />

        {/* Per-worker breakdown */}
        <div className="flex-1 min-w-0 space-y-1">
          {winner.workerPayouts.map((wp) => (
            <div
              key={wp.worker.contractorId}
              className="flex items-center justify-between gap-2 py-0.5"
            >
              <div className="min-w-0 flex-1">
                <span className={`${sizeConfig.firstNameText} font-bold text-white leading-tight block truncate`}>
                  {wp.worker.firstName}{' '}
                  <span className={`${sizeConfig.lastNameText} text-gray-400`}>
                    {wp.worker.lastName}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {wp.bonusShare > 0 && (
                  <span className={`${sizeConfig.bonusText} font-bold text-yellow-400`}>
                    +${wp.bonusShare.toFixed(0)}
                  </span>
                )}
                <span className={`${sizeConfig.payoutText} font-black text-green-400`}>
                  ${wp.commission.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* --- STATS HEADER --- */}
      <div className="border-b border-gray-700 bg-gray-900/50">
        {/* CHANGED: season-aware banner. Rejuv keeps green + Truck. Sealing gets
            slate-gray + Shovel and reads "SEALING SEASON". Layout identical. */}
        {isTeamSeason && (
          <div
            className={`px-3 py-1.5 border-b flex items-center gap-2 ${
              seasonType === 'sealing'
                ? 'bg-slate-800/40 border-slate-600/50'
                : 'bg-green-900/30 border-green-700/50'
            }`}
          >
            {seasonType === 'sealing' ? (
              <Shovel size={14} className="text-slate-300" />
            ) : (
              <Truck size={14} className="text-green-400" />
            )}
            <span
              className={`text-xs font-bold ${
                seasonType === 'sealing' ? 'text-slate-300' : 'text-green-400'
              }`}
            >
              {seasonType === 'sealing' ? 'SEALING SEASON' : 'LAWN REJUVENATION SEASON'}
            </span>
            <span
              className={`text-xs ${
                seasonType === 'sealing' ? 'text-slate-400' : 'text-green-300'
              }`}
            >
              ({teamCartsDisplay.length} carts, {aggregatedStats.workerCount} workers)
            </span>
          </div>
        )}

        <div className="grid grid-cols-6 gap-px bg-gray-700">
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Users size={10} />
              <span className="text-[9px] uppercase font-bold">Workers</span>
            </div>
            <div className="text-lg font-bold text-blue-300">{aggregatedStats.workerCount}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <TrendingUp size={10} />
              <span className="text-[9px] uppercase font-bold">Steps</span>
            </div>
            <div className="text-lg font-bold text-white">{aggregatedStats.totalSteps}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <DollarSign size={10} />
              <span className="text-[9px] uppercase font-bold">Prod Gross</span>
            </div>
            <div className="text-lg font-bold text-green-400">
              ${aggregatedStats.prodGross.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Avg EQ</span>
            </div>
            <div
              className={`text-lg font-bold ${
                aggregatedStats.avgEQ >= 3
                  ? 'text-green-400'
                  : aggregatedStats.avgEQ >= 2
                  ? 'text-yellow-400'
                  : 'text-red-400'
              }`}
            >
              {aggregatedStats.avgEQ.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Upsells</span>
            </div>
            <div className="text-lg font-bold text-purple-400">{aggregatedStats.upsellCount}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center relative">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Up Gross</span>
            </div>
            <div className="text-lg font-bold text-purple-300">
              ${aggregatedStats.upsellGross.toFixed(2)}
            </div>

            {hasBonuses && (
              <button
                onClick={() => setShowScreenshotModal(true)}
                className="absolute top-1 right-1 p-1.5 bg-yellow-600 hover:bg-yellow-500 rounded-full text-white transition-colors shadow-lg"
                title="View Bonus Summary"
              >
                <Camera size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-6 gap-px bg-gray-700">
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Banknote size={9} />
              <span className="text-[8px] uppercase font-bold">Cash</span>
            </div>
            <div className="text-sm font-bold text-green-300 font-mono">
              ${aggregatedStats.totalCash.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Receipt size={9} />
              <span className="text-[8px] uppercase font-bold">Cheque</span>
            </div>
            <div className="text-sm font-bold text-blue-300 font-mono">
              ${aggregatedStats.totalCheque.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">E-Trans</span>
            </div>
            <div className="text-sm font-bold text-cyan-300 font-mono">
              ${aggregatedStats.totalETransfer.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <CreditCard size={9} />
              <span className="text-[8px] uppercase font-bold">CC</span>
            </div>
            <div className="text-sm font-bold text-orange-300 font-mono">
              ${aggregatedStats.totalCreditCard.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Wallet size={9} />
              <span className="text-[8px] uppercase font-bold">Prepaid</span>
            </div>
            <div className="text-sm font-bold text-indigo-300 font-mono">
              ${aggregatedStats.totalPrepaid.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">Billed</span>
            </div>
            <div className="text-sm font-bold text-gray-400 font-mono">
              ${aggregatedStats.totalBilled.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* --- WORKER / CART LIST --- */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
        {isTeamSeason && (
          <>
            {sortedTeamCarts.length === 0 && (
              <div className="text-center py-10 text-gray-500 flex flex-col items-center">
                <AlertCircle size={32} className="mb-2 opacity-50" />
                <p>No active sessions found for this date.</p>
              </div>
            )}
            <div className="space-y-2">
              {sortedTeamCarts.map((cart) => renderTeamCart(cart))}
            </div>
          </>
        )}

        {!isTeamSeason && (
          <>
            {sortedItems.length === 0 && (
              <div className="text-center py-10 text-gray-500 flex flex-col items-center">
                <AlertCircle size={32} className="mb-2 opacity-50" />
                <p>No active sessions found for this date.</p>
              </div>
            )}

            {sortOption === 'standard' &&
              groupedByManager &&
              groupedByManager.map(([managerId, group]) => (
                <div key={managerId} className="mb-3">
                  <div className="sticky top-0 z-10 bg-gray-700 border border-gray-600 py-1.5 px-2 rounded flex items-center gap-2 text-xs mb-1">
                    <div className="w-0.5 h-5 rounded-full flex-shrink-0 bg-blue-500" />
                    <div className="font-bold text-white min-w-[120px] truncate uppercase tracking-wide">
                      {group.manager?.name || 'Unassigned'}
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 min-w-[55px] justify-center bg-blue-900/30 text-blue-400 border border-blue-800">
                      <Users size={8} />
                      {group.items.length}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-3 text-gray-400">
                      <div className="text-center min-w-[40px]">
                        <span className="text-[9px] text-gray-500 uppercase block leading-none">Steps</span>
                        <span className="font-bold text-white">{group.stats.totalSteps}</span>
                      </div>
                      <div className="text-center min-w-[50px]">
                        <span className="text-[9px] text-gray-500 uppercase block leading-none">Upsell</span>
                        <span className="font-bold text-purple-300">
                          ${group.stats.totalUpsellGross.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-center min-w-[40px]">
                        <span className="text-[9px] text-gray-500 uppercase block leading-none">Avg EQ</span>
                        <span
                          className={`font-mono font-bold ${
                            group.stats.avgEQ >= 3
                              ? 'text-green-400'
                              : group.stats.avgEQ >= 2
                              ? 'text-yellow-400'
                              : 'text-red-400'
                          }`}
                        >
                          {group.stats.avgEQ.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-center min-w-[55px]">
                        <span className="text-[9px] text-gray-500 uppercase block leading-none">Avg Comm</span>
                        <span className="font-mono font-bold text-green-400">
                          ${group.stats.avgCommission.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="ml-2 min-w-[70px]" />
                    <div className="w-[14px]" />
                  </div>
                  <div className="space-y-1">{group.items.map(renderWorkerRow)}</div>
                </div>
              ))}

            {sortOption !== 'standard' && sortedItems.map(renderWorkerRow)}
          </>
        )}
      </div>

      {/* --- BONUS MODAL --- */}
      {showBonusModal && selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg border border-gray-700 max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trophy size={20} className="text-yellow-400" /> Manage Bonuses
                </h3>
                <p className="text-sm text-gray-400">{selectedWorkerName}</p>
                {selectedTeamWorkers.length > 1 && (
                  <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                    <Truck size={12} /> Team of {selectedTeamWorkers.length}
                  </p>
                )}
              </div>
              <button onClick={handleCloseBonusModal} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            {selectedQualification && (
              <div
                className={`mx-4 mt-4 p-3 rounded-lg border ${
                  selectedQualification.qualified
                    ? 'bg-green-900/20 border-green-700/50'
                    : 'bg-red-900/20 border-red-700/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {selectedQualification.qualified ? (
                    <Check size={16} className="text-green-400" />
                  ) : (
                    <AlertTriangle size={16} className="text-red-400" />
                  )}
                  <span
                    className={`text-sm font-bold ${
                      selectedQualification.qualified ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {selectedQualification.qualified
                      ? 'Qualified for Bonus'
                      : 'Not Qualified for Bonus'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div
                    className={`flex items-center gap-1 ${
                      selectedQualification.ratioPass ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {selectedQualification.ratioPass ? <Check size={12} /> : <X size={12} />}
                    <span>
                      {isTeamSeason
                        ? `New vs Old: ${selectedQualification.salesCount} new / ${selectedQualification.prebookCount} old`
                        : `Ratio: ${selectedQualification.salesCount} Sales vs ${selectedQualification.prebookCount} Prebooks`}
                    </span>
                  </div>
                  <div
                    className={`flex items-center gap-1 ${
                      selectedQualification.detailsPass ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {selectedQualification.detailsPass ? <Check size={12} /> : <X size={12} />}
                    <span>
                      Details: {selectedQualification.detailsCollected}/
                      {selectedQualification.detailsPossible} (80% req)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedSession.bonuses && selectedSession.bonuses.length > 0 && (
              <div className="mx-4 mt-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Assigned Bonuses</h4>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {selectedSession.bonuses.map((bonus) => (
                    <div
                      key={bonus.id}
                      className="flex items-center justify-between bg-gray-900/50 p-2 rounded border border-gray-700"
                    >
                      <div className="flex items-center gap-2">
                        <Trophy size={14} className="text-yellow-400" />
                        <span className="text-sm text-white">{formatBonusDisplay(bonus)}</span>
                        <span className="text-sm font-bold text-green-400">
                          ${bonus.amount.toFixed(2)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveBonus(bonus.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {bonusStep === 'type' && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">
                    Select Bonus Type
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleSelectBonusType('Performance EQ')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-blue-900/30 text-blue-400 group-hover:bg-blue-900/50">
                          <TrendingUp size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Performance EQ</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Best EQ performers</p>
                    </button>

                    <button
                      onClick={() => handleSelectBonusType('Total Upsell')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-purple-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-purple-900/30 text-purple-400 group-hover:bg-purple-900/50">
                          <DollarSign size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Total Upsell</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Highest upsell gross</p>
                    </button>

                    <button
                      onClick={() => handleSelectBonusType('Rookie')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-yellow-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-yellow-900/30 text-yellow-400 group-hover:bg-yellow-900/50">
                          <Star size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Rookie</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Best new worker</p>
                    </button>

                    <button
                      onClick={() => handleSelectBonusType('Other')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-gray-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-gray-700 text-gray-400 group-hover:bg-gray-600">
                          <Sparkles size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Other</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Custom bonus type</p>
                    </button>
                  </div>
                </div>
              )}

              {bonusStep === 'details' && selectedBonusType && (
                <div className="space-y-4">
                  <button
                    onClick={handleBackToTypeSelection}
                    className="text-sm text-gray-400 hover:text-white flex items-center gap-1"
                  >
                    ← Back to type selection
                  </button>

                  <div className="flex items-center gap-2 p-3 bg-gray-900 rounded-lg border border-gray-700">
                    {selectedBonusType === 'Performance EQ' && (
                      <TrendingUp size={20} className="text-blue-400" />
                    )}
                    {selectedBonusType === 'Total Upsell' && (
                      <DollarSign size={20} className="text-purple-400" />
                    )}
                    {selectedBonusType === 'Rookie' && (
                      <Star size={20} className="text-yellow-400" />
                    )}
                    {selectedBonusType === 'Other' && (
                      <Sparkles size={20} className="text-gray-400" />
                    )}
                    <span className="font-bold text-white">{selectedBonusType}</span>
                  </div>

                  {selectedBonusType !== 'Other' && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-2">Placing</label>
                      <select
                        value={bonusPlacing}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBonusPlacing(
                            val === 'other' ? 'other' : val === '' ? '' : parseInt(val)
                          );
                        }}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">Select placing...</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`} Place
                          </option>
                        ))}
                        <option value="other">Other</option>
                      </select>
                    </div>
                  )}

                  {(selectedBonusType === 'Other' || bonusPlacing === 'other') && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-2">
                        {selectedBonusType === 'Other'
                          ? 'Bonus Description'
                          : 'Custom Placing Description'}
                      </label>
                      <input
                        type="text"
                        value={bonusCustomDesc}
                        onChange={(e) => setBonusCustomDesc(e.target.value)}
                        placeholder={
                          selectedBonusType === 'Other'
                            ? 'e.g., Team spirit award'
                            : 'e.g., 11th place'
                        }
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-gray-400 block mb-2">Amount ($)</label>
                    <div className="relative">
                      <DollarSign
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        type="number"
                        value={bonusAmount}
                        onChange={(e) => setBonusAmount(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 pl-8 text-white focus:ring-2 focus:ring-green-500 outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {selectedTeamWorkers.length > 1 && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-2 flex items-center gap-2">
                        <Truck size={12} className="text-green-400" />
                        Team Bonus Split (%)
                      </label>
                      <div className="space-y-2 bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                        {selectedTeamWorkers.map((worker) => (
                          <div
                            key={worker.contractorId}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="text-sm text-white flex-1">
                              {worker.firstName} {worker.lastName}
                            </span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={bonusSplitPercentages[worker.contractorId] || 0}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setBonusSplitPercentages((prev) => ({
                                    ...prev,
                                    [worker.contractorId]: Math.min(100, Math.max(0, val)),
                                  }));
                                }}
                                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm text-right"
                              />
                              <span className="text-gray-400 text-sm">%</span>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                          <span className="text-xs text-gray-500">Total:</span>
                          <span
                            className={`text-sm font-bold ${
                              Object.values(bonusSplitPercentages).reduce((a, b) => a + b, 0) ===
                              100
                                ? 'text-green-400'
                                : 'text-red-400'
                            }`}
                          >
                            {Object.values(bonusSplitPercentages)
                              .reduce((a, b) => a + b, 0)
                              .toFixed(0)}
                            %
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {bonusStep === 'details' && (
              <div className="p-4 border-t border-gray-700 flex-shrink-0">
                <button
                  onClick={handleAddBonus}
                  disabled={
                    !bonusAmount ||
                    parseFloat(bonusAmount) <= 0 ||
                    (selectedBonusType !== 'Other' && !bonusPlacing) ||
                    (selectedBonusType === 'Other' && !bonusCustomDesc.trim()) ||
                    (bonusPlacing === 'other' && !bonusCustomDesc.trim()) ||
                    (selectedTeamWorkers.length > 1 &&
                      Object.values(bonusSplitPercentages).reduce((a, b) => a + b, 0) !== 100)
                  }
                  className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-bold shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> Add Bonus
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- BONUS SCREENSHOT MODAL --- */}
      {showScreenshotModal && (
        <div
          className="fixed inset-0 bg-gray-900 z-50 flex flex-col h-screen overflow-hidden"
          style={{ fontFamily: "'Quicksand', 'Nunito', sans-serif" }}
        >
          {/* Clickable Dark Red Header */}
          <div
            onClick={() => setShowScreenshotModal(false)}
            className={`bg-gradient-to-r from-red-900 via-red-800 to-red-900 ${sizeConfig.headerPadding} shadow-2xl cursor-pointer hover:from-red-800 hover:via-red-700 hover:to-red-800 transition-colors flex-shrink-0`}
          >
            <div className="max-w-full mx-auto px-4 flex items-center gap-4">
              <div className={sizeConfig.headerTrophy}>🏆</div>
              <div>
                <h1
                  className={`${sizeConfig.headerTitle} font-black text-white tracking-tight drop-shadow-lg`}
                >
                  BONUSES FOR
                </h1>
                <p className={`${sizeConfig.headerDate} font-bold text-red-200 mt-1`}>
                  {formatDateForDisplay(date)}
                </p>
              </div>
            </div>
          </div>

          {/* Content — Horizontal Columns */}
          <div className="flex-1 overflow-hidden p-4">
            <div className={`h-full flex ${sizeConfig.columnGap}`}>

              {/* Performance EQ Column */}
              {activeBonusWinners.performanceEQ.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className={`flex items-center gap-2 ${sizeConfig.sectionMargin} flex-shrink-0`}>
                    <div className="p-1.5 rounded-full bg-blue-500/20 border-2 border-blue-400">
                      <TrendingUp size={sizeConfig.sectionIcon} className="text-blue-400" />
                    </div>
                    <h2 className={`${sizeConfig.sectionTitle} font-black text-blue-400 uppercase tracking-wide`}>
                      Performance EQ
                    </h2>
                  </div>
                  <div className={`${sizeConfig.rowMargin} flex-1 overflow-hidden`}>
                    {isTeamSeason
                      ? (activeBonusWinners.performanceEQ as TeamBonusWinner[]).map(
                          (winner, idx) => renderTeamWinnerRow(winner, idx)
                        )
                      : (activeBonusWinners.performanceEQ as BonusWinner[]).map((winner, idx) => (
                          <div
                            key={idx}
                            className={`bg-gray-800/80 rounded-xl border border-gray-700 ${sizeConfig.rowPadding} flex items-center ${sizeConfig.rowGap}`}
                          >
                            <div className={`flex flex-col items-center ${sizeConfig.minWidthMedal}`}>
                              <span className={sizeConfig.medalSize}>
                                {getMedalEmoji(winner.bonus.placing)}
                              </span>
                              <span className={`text-white font-bold ${sizeConfig.placingText}`}>
                                {winner.bonus.placing === 'other'
                                  ? winner.bonus.customDescription
                                  : getPlacingSuffix(winner.bonus.placing)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`${sizeConfig.firstNameText} font-bold text-white leading-tight`}>
                                {winner.firstName}
                              </p>
                              <p className={`${sizeConfig.lastNameText} font-medium text-gray-400 leading-tight`}>
                                {winner.lastName}
                              </p>
                            </div>
                            <AchievementBadge
                              eq={winner.eq}
                              sizeClass={sizeConfig.achievementSize}
                              containerClass={sizeConfig.achievementContainer}
                              textClass={sizeConfig.eqOverlayText}
                            />
                            <div className={`text-center ${sizeConfig.minWidthBonus}`}>
                              <span className={`${sizeConfig.bonusText} font-bold text-yellow-400`}>
                                +${winner.bonus.amount.toFixed(0)}
                              </span>
                            </div>
                            <div className={`text-right ${sizeConfig.minWidthPayout}`}>
                              <p className={`${sizeConfig.payoutText} font-black text-green-400`}>
                                ${winner.finalCommission.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
              )}

              {/* Total Upsell Column */}
              {activeBonusWinners.totalUpsell.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className={`flex items-center gap-2 ${sizeConfig.sectionMargin} flex-shrink-0`}>
                    <div className="p-1.5 rounded-full bg-purple-500/20 border-2 border-purple-400">
                      <DollarSign size={sizeConfig.sectionIcon} className="text-purple-400" />
                    </div>
                    <h2 className={`${sizeConfig.sectionTitle} font-black text-purple-400 uppercase tracking-wide`}>
                      Total Upsell
                    </h2>
                  </div>
                  <div className={`${sizeConfig.rowMargin} flex-1 overflow-hidden`}>
                    {isTeamSeason
                      ? (activeBonusWinners.totalUpsell as TeamBonusWinner[]).map(
                          (winner, idx) => renderTeamWinnerRow(winner, idx)
                        )
                      : (activeBonusWinners.totalUpsell as BonusWinner[]).map((winner, idx) => (
                          <div
                            key={idx}
                            className={`bg-gray-800/80 rounded-xl border border-gray-700 ${sizeConfig.rowPadding} flex items-center ${sizeConfig.rowGap}`}
                          >
                            <div className={`flex flex-col items-center ${sizeConfig.minWidthMedal}`}>
                              <span className={sizeConfig.medalSize}>
                                {getMedalEmoji(winner.bonus.placing)}
                              </span>
                              <span className={`text-white font-bold ${sizeConfig.placingText}`}>
                                {winner.bonus.placing === 'other'
                                  ? winner.bonus.customDescription
                                  : getPlacingSuffix(winner.bonus.placing)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`${sizeConfig.firstNameText} font-bold text-white leading-tight`}>
                                {winner.firstName}
                              </p>
                              <p className={`${sizeConfig.lastNameText} font-medium text-gray-400 leading-tight`}>
                                {winner.lastName}
                              </p>
                            </div>
                            <div className="text-center">
                              <span className={`${sizeConfig.upsellText} font-black text-purple-300`}>
                                ${winner.upsellGross.toFixed(0)}
                              </span>
                            </div>
                            <div className={`text-center ${sizeConfig.minWidthBonus}`}>
                              <span className={`${sizeConfig.bonusText} font-bold text-yellow-400`}>
                                +${winner.bonus.amount.toFixed(0)}
                              </span>
                            </div>
                            <div className={`text-right ${sizeConfig.minWidthPayout}`}>
                              <p className={`${sizeConfig.payoutText} font-black text-green-400`}>
                                ${winner.finalCommission.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
              )}

              {/* Rookie Column */}
              {activeBonusWinners.rookie.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className={`flex items-center gap-2 ${sizeConfig.sectionMargin} flex-shrink-0`}>
                    <div className="p-1.5 rounded-full bg-yellow-500/20 border-2 border-yellow-400">
                      <Star size={sizeConfig.sectionIcon} className="text-yellow-400" />
                    </div>
                    <h2 className={`${sizeConfig.sectionTitle} font-black text-yellow-400 uppercase tracking-wide`}>
                      Rookie
                    </h2>
                  </div>
                  <div className={`${sizeConfig.rowMargin} flex-1 overflow-hidden`}>
                    {isTeamSeason
                      ? (activeBonusWinners.rookie as TeamBonusWinner[]).map(
                          (winner, idx) => renderTeamWinnerRow(winner, idx)
                        )
                      : (activeBonusWinners.rookie as BonusWinner[]).map((winner, idx) => (
                          <div
                            key={idx}
                            className={`bg-gray-800/80 rounded-xl border border-gray-700 ${sizeConfig.rowPadding} flex items-center ${sizeConfig.rowGap}`}
                          >
                            <div className={`flex flex-col items-center ${sizeConfig.minWidthMedal}`}>
                              <span className={sizeConfig.medalSize}>
                                {getMedalEmoji(winner.bonus.placing)}
                              </span>
                              <span className={`text-white font-bold ${sizeConfig.placingText}`}>
                                {winner.bonus.placing === 'other'
                                  ? winner.bonus.customDescription
                                  : getPlacingSuffix(winner.bonus.placing)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`${sizeConfig.firstNameText} font-bold text-white leading-tight`}>
                                {winner.firstName}
                              </p>
                              <p className={`${sizeConfig.lastNameText} font-medium text-gray-400 leading-tight`}>
                                {winner.lastName}
                              </p>
                            </div>
                            <AchievementBadge
                              eq={winner.eq}
                              sizeClass={sizeConfig.achievementSize}
                              containerClass={sizeConfig.achievementContainer}
                              textClass={sizeConfig.eqOverlayText}
                            />
                            <div className={`text-center ${sizeConfig.minWidthBonus}`}>
                              <span className={`${sizeConfig.bonusText} font-bold text-yellow-400`}>
                                +${winner.bonus.amount.toFixed(0)}
                              </span>
                            </div>
                            <div className={`text-right ${sizeConfig.minWidthPayout}`}>
                              <p className={`${sizeConfig.payoutText} font-black text-green-400`}>
                                ${winner.finalCommission.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
              )}

              {/* Other Bonuses Column — DRAG-TO-REORDER ENABLED */}
              {activeBonusWinners.other.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className={`flex items-center gap-2 ${sizeConfig.sectionMargin} flex-shrink-0`}>
                    <div className="p-1.5 rounded-full bg-gray-500/20 border-2 border-gray-400">
                      <Sparkles size={sizeConfig.sectionIcon} className="text-gray-400" />
                    </div>
                    <h2 className={`${sizeConfig.sectionTitle} font-black text-gray-400 uppercase tracking-wide`}>
                      Other
                    </h2>
                    <span className="text-[10px] text-gray-500 italic ml-auto flex items-center gap-1">
                      <GripVertical size={10} /> drag to reorder
                    </span>
                  </div>
                  <div className={`${sizeConfig.rowMargin} flex-1 overflow-hidden`}>
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleOtherDragEnd}
                    >
                      <SortableContext
                        items={(activeBonusWinners.other as (BonusWinner | TeamBonusWinner)[]).map(
                          (w) => `bonus-${w.bonus.id}`
                        )}
                        strategy={verticalListSortingStrategy}
                      >
                        {isTeamSeason
                          ? (activeBonusWinners.other as TeamBonusWinner[]).map((winner, idx) => (
                              <SortableOtherCard key={winner.bonus.id} id={`bonus-${winner.bonus.id}`}>
                                {renderTeamWinnerRow(winner, idx)}
                              </SortableOtherCard>
                            ))
                          : (activeBonusWinners.other as BonusWinner[]).map((winner, idx) => (
                              <SortableOtherCard key={winner.bonus.id} id={`bonus-${winner.bonus.id}`}>
                                <div
                                  className={`bg-gray-800/80 rounded-xl border border-gray-700 ${sizeConfig.rowPadding} flex items-center ${sizeConfig.rowGap}`}
                                >
                                  <div className={`flex flex-col items-center ${sizeConfig.minWidthMedal}`}>
                                    <span className={sizeConfig.medalSize}>🏆</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={`${sizeConfig.placingText} font-bold text-amber-400 leading-tight truncate`}>
                                      {winner.bonus.customDescription || 'Other'}
                                    </p>
                                    <p className={`${sizeConfig.firstNameText} font-bold text-white leading-tight`}>
                                      {winner.firstName}
                                    </p>
                                    <p className={`${sizeConfig.lastNameText} font-medium text-gray-400 leading-tight`}>
                                      {winner.lastName}
                                    </p>
                                  </div>
                                  <div className={`text-center ${sizeConfig.minWidthBonus}`}>
                                    <span className={`${sizeConfig.bonusText} font-bold text-yellow-400`}>
                                      +${winner.bonus.amount.toFixed(0)}
                                    </span>
                                  </div>
                                  <div className={`text-right ${sizeConfig.minWidthPayout}`}>
                                    <p className={`${sizeConfig.payoutText} font-black text-green-400`}>
                                      ${winner.finalCommission.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              </SortableOtherCard>
                            ))}
                      </SortableContext>
                    </DndContext>
                  </div>
                </div>
              )}

              {!hasBonuses && (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Trophy size={80} className="mx-auto mb-4 opacity-30" />
                    <p className="text-2xl">No bonuses have been assigned yet.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayoutToday;