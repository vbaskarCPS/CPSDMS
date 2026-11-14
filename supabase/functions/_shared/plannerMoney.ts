// supabase/functions/_shared/plannerMoney.ts — the planner's money rules that both the app and the
// planner-plaid edge function use, so a transaction gets the same merchant name and category whether it
// came from a CSV in the browser or from Plaid on the server (rules are keyed by merchant name, so the
// two must agree). No imports: this file runs in the browser (Vite) and in Deno.

/** The category names, in the app's order (src/planner/features/money/categories.ts has them with their icons and
 *  colours; a test keeps the two the same). Here so the server can check a category without the app's files. */
export const MONEY_CATEGORIES = ['Groceries', 'Dining', 'Coffee', 'Transport', 'Gas', 'Housing', 'Utilities', 'Phone & Internet', 'Insurance', 'Health', 'Fitness',
  'Shopping', 'Kids', 'Entertainment', 'Subscriptions', 'Travel', 'Gifts', 'Education', 'Personal care', 'Transfers', 'Credit card payment', 'Income',
  'Fees & interest', 'Cash', 'Other'] as const;

/** Long digit runs (13–19) could be a card number: keep the last 4 only. */
export function maskNumbers(s: string): string { return s.replace(/\d[\d -]{11,22}\d/g, m => { const digits = m.replace(/\D/g, ''); return digits.length >= 13 && digits.length <= 19 ? `****${digits.slice(-4)}` : m; }); }

const CITY_TAIL = /\s+(TORONTO|MISSISSAUGA|BRAMPTON|MARKHAM|VAUGHAN|RICHMOND HILL|SCARBOROUGH|NORTH YORK|ETOBICOKE|OAKVILLE|BURLINGTON|HAMILTON|OTTAWA|LONDON|KITCHENER|WATERLOO|MILTON|AJAX|PICKERING|WHITBY|OSHAWA|BARRIE|GUELPH|WINDSOR|KINGSTON|MONTREAL|VANCOUVER|CALGARY|EDMONTON|WINNIPEG)\b.*$/;
/** "TIM HORTONS #2231 TORONTO ON" → "TIM HORTONS". Stable across months, so rules stick. */
export function normalizeMerchant(desc: string): string {
  let s = maskNumbers(desc).toUpperCase();
  s = s.replace(/\*{2,}\d{4}/g, ' ');                       // masked numbers
  s = s.replace(/\b(SQ|TST|SP|PAYPAL|PP|AMZN MKTP|APL)\s*\*\s*/g, '');   // processor prefixes: SQ *, TST*, PAYPAL *
  s = s.replace(/[#*][\w-]*/g, ' ');                       // store numbers: #1234, *QX7
  s = s.replace(/\b\d{2,}\b/g, ' ');                       // other numbers
  s = s.replace(/\b[A-Z]{1,2}\d+[A-Z\d]*\b/g, ' ');         // reference codes like QT4X9
  s = s.replace(CITY_TAIL, '');
  s = s.replace(/\s+(ON|QC|BC|AB|MB|SK|NS|NB|PE|NL|CA|CAN)\b\s*$/, '');
  s = s.replace(/[^\w&'.\-\s/]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 40) || 'UNKNOWN';
}

// Built-in rules: first pattern found in the normalized merchant (or the raw description) wins.
// Order matters: the specific ones (PAYMENT - THANK YOU, E-TRANSFER) come before the generic (PAYMENT).
const RULES: [RegExp, string][] = [
  [/PAYMENT ?- ?THANK YOU|TD VISA|TD MASTERCARD|VISA PAYMENT|MASTERCARD PAYMENT|AMEX PAYMENT|CC PAYMENT|PMT.*VISA|PAYMENT TO.*(VISA|MC|CARD)/, 'Credit card payment'],
  [/E-?TRANSFER|E-?TFR|ETFR|INTERAC|TFR-?TO|TFR-?FR|\bTFR\b|TRANSFER|SEND MONEY|RECEIVED FROM|WIRE|RECURRING TFR|TO SAVINGS|FROM SAVINGS/, 'Transfers'],
  [/PAYROLL|PAY ?ROLL|SALARY|DIRECT DEPOSIT|GC DEPOSIT|CANADA +(FED|PRO)|CRA |GST\/HST|CHILD TAX|CCB|EI BENEFIT|DEPOSIT|REFUND/, 'Income'],
  [/MONTHLY (PLAN|ACCOUNT) FEE|SERVICE CHARGE|NSF|OVERDRAFT|INTEREST CHARGE|PURCHASE INTEREST|CASH ADVANCE INT|ANNUAL FEE|\bFEE\b|INTEREST/, 'Fees & interest'],
  [/\bATM\b|CASH WITHDRAWAL|WITHDRAWAL|ABM/, 'Cash'],
  [/MORTGAGE|MTG|PROPERTY TAX|CONDO FEE|RENT\b|LANDLORD/, 'Housing'],
  [/ENBRIDGE|HYDRO|ALECTRA|TORONTO HYDRO|UNION GAS|RELIANCE|ENERCARE|WATER BILL|UTILIT/, 'Utilities'],
  [/ROGERS|BELL ?(CANADA|MOBILITY)?\b|TELUS|FIDO|FREEDOM MOBILE|KOODO|VIRGIN (PLUS|MOBILE)|PUBLIC MOBILE|CHATR|LUCKY MOBILE|COGECO|SHAW|VIDEOTRON|START\.CA|TEKSAVVY/, 'Phone & Internet'],
  [/INSURANCE|INTACT|AVIVA|DESJARDINS INS|TD INS|BELAIR|SONNET|MANULIFE|SUN LIFE|CANADA LIFE|RBC INS|ALLSTATE|ECONOMICAL|CAA INS/, 'Insurance'],
  [/LOBLAW|NO ?FRILLS|FOOD BASICS|\bMETRO\b|SOBEYS|WALMART|WAL-MART|COSTCO|FRESHCO|FORTINOS|ZEHRS|REAL CDN|SUPERSTORE|LONGO|FARM BOY|WHOLE FOODS|T&T|NATIONS|ADONIS|GALLERIA|H ?MART|GIANT TIGER|FOOD ?LAND|INDEPENDENT GROCER|VALU-?MART|BULK BARN|IGA\b|SAVE-?ON|SAFEWAY|PC EXPRESS|INSTACART|VOILA/, 'Groceries'],
  [/TIM HORTON|STARBUCKS|SECOND CUP|COFFEE|CAFE|TIMOTHY|BALZAC|ARO?MA ESPRESSO|DAVIDSTEA/, 'Coffee'],
  [/MCDONALD|UBER ?EATS|SKIP ?THE|DOORDASH|A&W|WENDY|BURGER KING|HARVEY|SUBWAY|PIZZA|POPEYES|KFC|SWISS CHALET|BOSTON PIZZA|KELSEY|MONTANA|CHIPOTLE|FIVE GUYS|OSMOW|MARY BROWN|SHAWARMA|SUSHI|RAMEN|RESTAURANT|RESTO|BISTRO|GRILL|DINER|EATERY|KITCHEN|TACO|THAI|PHO\b|BBQ|DAIRY QUEEN|BASKIN|WING|CHICKEN|BAR\b|PUB\b|FRESHII|PITA|FOOD/, 'Dining'],
  [/PETRO|ESSO|SHELL|PIONEER|ULTRAMAR|HUSKY|MOBIL|CHEVRON|CIRCLE K|GAS BAR|7-?ELEVEN|COSTCO GAS|CANCO|MACEWEN/, 'Gas'],
  [/PRESTO|GO TRANSIT|407 ?ETR|TTC\b|MIWAY|YRT|BRAMPTON TRANSIT|VIA RAIL|UBER(?! ?EATS)|LYFT|TAXI|PARKING|GREEN P|IMPARK|INDIGO PARK|PARK ?N ?FLY|HONK|407/, 'Transport'],
  [/AIR CANADA|WESTJET|PORTER|FLAIR|AIRBNB|BOOKING\.COM|EXPEDIA|HOTEL|MARRIOTT|HILTON|VRBO|SUNWING|TRANSAT|ENTERPRISE RENT|HERTZ|AVIS|BUDGET RENT/, 'Travel'],
  [/NETFLIX|SPOTIFY|DISNEY|CRAVE|AMAZON PRIME|PRIME VIDEO|APPLE\.COM\/BILL|APPLE\.COM|ITUNES|GOOGLE (PLAY|STORAGE|ONE|YOUTUBE)|YOUTUBE|MICROSOFT|ADOBE|DROPBOX|ICLOUD|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|PATREON|AUDIBLE|KINDLE|PLAYSTATION|XBOX|NINTENDO|DAZN|SIRIUS/, 'Subscriptions'],
  [/CINEPLEX|LANDMARK CINEMA|TICKETMASTER|STUBHUB|THEATRE|CONCERT|STEAM|EVENT|MUSEUM|ZOO\b|AQUARIUM|CN TOWER|WONDERLAND|ESCAPE ROOM|BOWL|ARCADE|GOLF|SKI/, 'Entertainment'],
  [/GOODLIFE|PLANET FITNESS|LA FITNESS|ANYTIME FITNESS|FIT4LESS|ORANGETHEORY|F45|CROSSFIT|YMCA|GYM|YOGA|PELOTON|STRAVA|MYFITNESSPAL/, 'Fitness'],
  [/SHOPPERS|REXALL|PHARMA|DRUG MART|DENTAL|DENTIST|PHYSIO|CHIRO|OPTOM|OPTICAL|CLINIC|MEDICAL|HOSPITAL|LIFELABS|MASSAGE|WELL\.CA/, 'Health'],
  [/TOYS ?R ?US|DAYCARE|CHILD ?CARE|MONTESSORI|KUMON|CARTER|OLD NAVY KIDS|KIDS|SCHOOL|BABY|INDIGO KIDS|LEGO/, 'Kids'],
  [/UNIVERSITY|COLLEGE|TUITION|UDEMY|COURSERA|SKILLSHARE|MASTERCLASS|INDIGO|CHAPTERS|AMAZON KINDLE|BOOK/, 'Education'],
  [/SALON|BARBER|SPA\b|NAILS|SEPHORA|MAC COSMETIC|HAIR/, 'Personal care'],
  [/AMAZON|AMZN|CANADIAN TIRE|HOME DEPOT|LOWES|RONA|IKEA|BEST BUY|STAPLES|DOLLARAMA|WINNERS|HOMESENSE|MARSHALLS|LULULEMON|NIKE|ADIDAS|SPORT CHEK|H&M|ZARA|UNIQLO|OLD NAVY|GAP\b|THE BAY|HUDSON|SIMONS|ALIEXPRESS|TEMU|SHEIN|ETSY|EBAY|SHOPIFY|WAYFAIR|STRUCTUBE|LEON|BRICK|COSTCO\.CA|LCBO|BEER STORE|WINE RACK|PET ?SMART|PETVALU|PET/, 'Shopping'],
  [/GIFT|FLOWER|FLORIST|CHARITY|DONATION|RED CROSS|UNITED WAY|GOFUNDME|TEMPLE|CHURCH|MOSQUE/, 'Gifts'],
];

export function builtinCategory(merchant: string, desc = ''): string | null {
  const s = `${merchant} ${desc}`.toUpperCase();
  for (const [re, cat] of RULES) if (re.test(s)) return cat;
  return null;
}

// ───────────── Plaid ─────────────
// Plaid's own category ("personal_finance_category": primary + detailed) → the planner's. Used only when
// neither one of the household's rules nor a built-in rule knows the merchant.
const PLAID_DETAILED: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries', FOOD_AND_DRINK_COFFEE: 'Coffee',
  TRANSPORTATION_GAS: 'Gas',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'Credit card payment', LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Housing',
  RENT_AND_UTILITIES_RENT: 'Housing', RENT_AND_UTILITIES_TELEPHONE: 'Phone & Internet', RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'Phone & Internet',
  GENERAL_SERVICES_INSURANCE: 'Insurance', GENERAL_SERVICES_EDUCATION: 'Education', GENERAL_SERVICES_CHILDCARE: 'Kids',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'Fitness', PERSONAL_CARE_HAIR_AND_BEAUTY: 'Personal care',
  ENTERTAINMENT_TV_AND_MOVIES: 'Subscriptions', ENTERTAINMENT_MUSIC_AND_AUDIO: 'Subscriptions',
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: 'Education', GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'Gifts',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'Gifts', GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: 'Fees & interest',
  TRANSFER_OUT_WITHDRAWAL: 'Cash', TRANSFER_IN_DEPOSIT: 'Income',
};
const PLAID_PRIMARY: Record<string, string> = {
  INCOME: 'Income', TRANSFER_IN: 'Transfers', TRANSFER_OUT: 'Transfers', LOAN_PAYMENTS: 'Transfers',
  BANK_FEES: 'Fees & interest', ENTERTAINMENT: 'Entertainment', FOOD_AND_DRINK: 'Dining',
  GENERAL_MERCHANDISE: 'Shopping', HOME_IMPROVEMENT: 'Shopping', MEDICAL: 'Health', PERSONAL_CARE: 'Personal care',
  GENERAL_SERVICES: 'Other', GOVERNMENT_AND_NON_PROFIT: 'Other', TRANSPORTATION: 'Transport', TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Utilities',
};
export function plaidCategory(pfc: { primary?: string | null; detailed?: string | null } | null | undefined): string | null {
  if (!pfc) return null;
  return (pfc.detailed && PLAID_DETAILED[pfc.detailed]) || (pfc.primary && PLAID_PRIMARY[pfc.primary]) || null;
}

/** The planner's transaction row (src/planner/features/money/types.ts Txn), as written by the server. */
export interface PlannerTxn {
  id: string; date: string; desc: string; merchant: string; amount: number; balance?: number;
  accountId: string; category: string; source: 'rule' | 'builtin' | 'ai' | 'manual' | 'plaid'; note?: string;
}
/** The fields of a Plaid transaction (/transactions/sync) the planner uses. */
export interface PlaidTxn {
  transaction_id: string; account_id: string; amount: number; date: string; pending: boolean;
  name?: string | null; merchant_name?: string | null; original_description?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
}

export const plaidRowId = (transactionId: string) => `plaid_${transactionId}`;
export const isPlaidRow = (t: { id: string }) => t.id.startsWith('plaid_');

/** A posted Plaid transaction → a planner row. Plaid's amounts are positive for money out; the planner's
 *  are negative for money out. Category: the household's rule for the merchant, then the built-in rules,
 *  then Plaid's category, then Other. A category someone picked by hand ('manual') is kept on updates. */
export function plaidToRow(t: PlaidTxn, accountId: string, rules: Record<string, string>, prev?: PlannerTxn): PlannerTxn {
  const desc = maskNumbers((t.original_description || t.name || t.merchant_name || '').trim()) || 'Unknown';
  const merchant = normalizeMerchant(t.merchant_name || t.name || desc);
  const amount = Math.round(-t.amount * 100) / 100;
  let category: string, source: PlannerTxn['source'];
  if (prev?.source === 'manual') { category = prev.category; source = 'manual'; }
  else if (rules[merchant]) { category = rules[merchant]; source = 'rule'; }
  else {
    const b = builtinCategory(merchant, desc);
    if (b) { category = b; source = 'builtin'; }
    else { category = plaidCategory(t.personal_finance_category) || 'Other'; source = 'plaid'; }
  }
  const row: PlannerTxn = { id: plaidRowId(t.transaction_id), date: t.date, desc, merchant, amount, accountId, category, source };
  if (prev?.note) row.note = prev.note;
  return row;
}

/** Apply one sync's changes to the household's months (YYYY-MM → rows). Returns the months it changed.
 *  Pending transactions are skipped (they get a new id once they post, and come back then). */
export function applySync(
  months: Record<string, PlannerTxn[]>,
  changes: { added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[] },
  accountMap: Record<string, string>, rules: Record<string, string>,
): { touched: Set<string>; added: number; updated: number; removed: number } {
  const touched = new Set<string>();
  let added = 0, updated = 0, removed = 0;
  const where = new Map<string, string>();   // row id → month
  for (const [m, rows] of Object.entries(months)) for (const r of rows) if (isPlaidRow(r)) where.set(r.id, m);
  const drop = (id: string) => {
    const m = where.get(id);
    if (!m) return null;
    const i = months[m].findIndex(r => r.id === id);
    if (i < 0) return null;
    const [old] = months[m].splice(i, 1);
    where.delete(id); touched.add(m);
    return old;
  };
  for (const r of changes.removed) if (drop(plaidRowId(r.transaction_id))) removed++;
  for (const t of [...changes.added, ...changes.modified]) {
    const accountId = accountMap[t.account_id];
    const id = plaidRowId(t.transaction_id);
    if (t.pending || !accountId || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) { if (drop(id)) removed++; continue; }
    const prev = drop(id) || undefined;
    const row = plaidToRow(t, accountId, rules, prev);
    const m = row.date.slice(0, 7);
    (months[m] ||= []).push(row);
    where.set(id, m); touched.add(m);
    if (prev) updated++; else added++;
  }
  for (const m of touched) months[m].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { touched, added, updated, removed };
}

/** For a connected account, the bank's rows are the record: hide that account's CSV rows (they're kept),
 *  up to the day it was disconnected if it was. */
export function hideReplaced<T extends { id: string; date: string; accountId: string }>(
  rows: T[], linked: Record<string, { removedAt?: string } | undefined>,
): T[] {
  return rows.filter(r => {
    const l = linked[r.accountId];
    if (!l || isPlaidRow(r)) return true;
    return !!l.removedAt && r.date > l.removedAt.slice(0, 10);
  });
}
