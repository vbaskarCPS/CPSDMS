// src/planner/features/money/categories.ts — the fixed category list and the built-in merchant rules.
export interface Category { name: string; icon: string; color: string; spending: boolean }

export const CATEGORIES: Category[] = [
  { name: 'Groceries', icon: 'ShoppingCart', color: '#2a9d8f', spending: true },
  { name: 'Dining', icon: 'Utensils', color: '#e76f51', spending: true },
  { name: 'Coffee', icon: 'Coffee', color: '#a86b0a', spending: true },
  { name: 'Transport', icon: 'Bus', color: '#457b9d', spending: true },
  { name: 'Gas', icon: 'Fuel', color: '#6d597a', spending: true },
  { name: 'Housing', icon: 'Home', color: '#0f3d3e', spending: true },
  { name: 'Utilities', icon: 'Zap', color: '#f4a261', spending: true },
  { name: 'Phone & Internet', icon: 'Smartphone', color: '#3d5a80', spending: true },
  { name: 'Insurance', icon: 'Shield', color: '#5c677d', spending: true },
  { name: 'Health', icon: 'HeartPulse', color: '#c0392b', spending: true },
  { name: 'Fitness', icon: 'Dumbbell', color: '#1b998b', spending: true },
  { name: 'Shopping', icon: 'ShoppingBag', color: '#b56576', spending: true },
  { name: 'Kids', icon: 'Baby', color: '#f6b23c', spending: true },
  { name: 'Entertainment', icon: 'Film', color: '#8e44ad', spending: true },
  { name: 'Subscriptions', icon: 'Repeat', color: '#6c5ce7', spending: true },
  { name: 'Travel', icon: 'Plane', color: '#0984e3', spending: true },
  { name: 'Gifts', icon: 'Gift', color: '#e84393', spending: true },
  { name: 'Education', icon: 'GraduationCap', color: '#00897b', spending: true },
  { name: 'Personal care', icon: 'Scissors', color: '#d35400', spending: true },
  { name: 'Transfers', icon: 'ArrowLeftRight', color: '#7f8c8d', spending: false },
  { name: 'Credit card payment', icon: 'CreditCard', color: '#7f8c8d', spending: false },
  { name: 'Income', icon: 'Banknote', color: '#2a9d8f', spending: false },
  { name: 'Fees & interest', icon: 'Percent', color: '#c0392b', spending: true },
  { name: 'Cash', icon: 'Wallet', color: '#636e72', spending: true },
  { name: 'Other', icon: 'CircleDashed', color: '#95a5a6', spending: true },
];
export const CATEGORY_NAMES = CATEGORIES.map(c => c.name);
export const SPENDING_CATEGORIES = CATEGORIES.filter(c => c.spending).map(c => c.name);
export const byName = (name: string): Category => CATEGORIES.find(c => c.name === name) || CATEGORIES[CATEGORIES.length - 1];

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
