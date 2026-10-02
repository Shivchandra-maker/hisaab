import type { ID, MerchantRule } from '../types';

/** "SWIGGY*ORDER 1234", "Swiggy Ltd" → "swiggy…" — stable key for matching rules. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(
      /\b(pvt|private|ltd|limited|llp|inc|india|technologies|tech|payments?|services?|online|store|retail)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, '')
    .replace(/\d{4,}/g, '')
    .slice(0, 24);
}

/**
 * Built-in guesses for common Indian merchants. Your own rules always win over these.
 * Keys are matched as prefixes of the merchant key.
 */
const KNOWN: [string[], ID][] = [
  [
    [
      'swiggy',
      'zomato',
      'bluetokai',
      'coffee',
      'chai',
      'dominos',
      'mcdonald',
      'kfc',
      'pizzahut',
      'starbucks',
      'chaipoint',
      'thirdwave',
      'haldiram',
      'eatsure',
      'faasos',
      'burgerking',
      'subway',
      'barbeque',
      'cafe',
      'restaurant',
      'hotel',
      'bakery',
      'dhaba',
    ],
    'food',
  ],
  [
    [
      'bigbasket',
      'blinkit',
      'zepto',
      'dmart',
      'jiomart',
      'instamart',
      'reliancefresh',
      'moresupermarket',
      'spencers',
      'naturesbasket',
      'grofers',
      'kirana',
      'supermarket',
      'milkbasket',
      'countrydelight',
    ],
    'groceries',
  ],
  [
    [
      'uber',
      'ola',
      'olacabs',
      'rapido',
      'nammametro',
      'metro',
      'irctc',
      'redbus',
      'fastag',
      'indianoil',
      'iocl',
      'hpcl',
      'bpcl',
      'shell',
      'petrol',
      'fuel',
      'parking',
      'blusmart',
      'yulu',
    ],
    'transport',
  ],
  [
    [
      'amazon',
      'flipkart',
      'myntra',
      'ajio',
      'nykaa',
      'meesho',
      'decathlon',
      'croma',
      'reliancedigital',
      'ikea',
      'tatacliq',
      'lenskart',
      'firstcry',
      'snapdeal',
      'shoppers',
      'westside',
      'zara',
      'hm',
      'uniqlo',
      'lifestyle',
    ],
    'shopping',
  ],
  [
    [
      'bescom',
      'tneb',
      'msedcl',
      'adani',
      'tatapower',
      'electricity',
      'airtel',
      'jio',
      'jiofiber',
      'vodafone',
      'vi',
      'bsnl',
      'actfibernet',
      'hathway',
      'tatasky',
      'tataplay',
      'dishtv',
      'gas',
      'indane',
      'bharatgas',
      'water',
      'broadband',
      'recharge',
      'bbps',
    ],
    'bills',
  ],
  [
    [
      'netflix',
      'spotify',
      'hotstar',
      'disney',
      'primevideo',
      'youtube',
      'sonyliv',
      'zee5',
      'jiocinema',
      'applecom',
      'apple',
      'googleplay',
      'google',
      'microsoft',
      'adobe',
      'linkedin',
      'icloud',
      'notion',
      'openai',
      'chatgpt',
      'anthropic',
      'claude',
    ],
    'subscriptions',
  ],
  [
    [
      'bookmyshow',
      'playo',
      'hudle',
      'pvr',
      'inox',
      'cinepolis',
      'steam',
      'playstation',
      'xbox',
      'dream11',
      'toit',
      'pub',
      'bar',
    ],
    'entertainment',
  ],
  [
    [
      'apollo',
      'pharmeasy',
      'netmeds',
      'medplus',
      '1mg',
      'tata1mg',
      'practo',
      'hospital',
      'clinic',
      'pharmacy',
      'medical',
      'diagnostic',
      'lab',
      'cultfit',
      'cult',
      'gym',
      'healthify',
    ],
    'health',
  ],
  [
    [
      'makemytrip',
      'goibibo',
      'cleartrip',
      'yatra',
      'ixigo',
      'indigo',
      'airindia',
      'vistara',
      'akasa',
      'spicejet',
      'oyo',
      'airbnb',
      'booking',
      'agoda',
      'treebo',
      'fabhotels',
    ],
    'travel',
  ],
  [
    [
      'udemy',
      'coursera',
      'byju',
      'unacademy',
      'school',
      'college',
      'university',
      'tuition',
      'books',
    ],
    'education',
  ],
  [
    [
      'landlord',
      'rent',
      'nobroker',
      'nestaway',
      'society',
      'maintenance',
      'urbancompany',
      'housejoy',
    ],
    'rent',
  ],
  [
    [
      'lic',
      'starhealth',
      'hdfclife',
      'hdfcergo',
      'iciciprudential',
      'icicilombard',
      'maxlife',
      'bajajallianz',
      'tataaig',
      'careinsurance',
      'nivabupa',
      'policybazaar',
      'insurance',
      'acko',
      'digit',
    ],
    'fees',
  ],
];

export interface CategoryGuess {
  categoryId?: ID;
  /** Merchant display name from a rule, if you renamed it. */
  name?: string;
  source: 'rule' | 'built-in' | 'none';
  rule?: MerchantRule;
}

export function guessCategory(merchant: string | undefined, rules: MerchantRule[]): CategoryGuess {
  if (!merchant) return { source: 'none' };
  const key = merchantKey(merchant);
  if (!key) return { source: 'none' };
  const rule = rules.find(
    (r) =>
      !r.deletedAt &&
      (r.key === key || (key.length >= 5 && (key.startsWith(r.key) || r.key.startsWith(key)))),
  );
  if (rule) return { categoryId: rule.categoryId, name: rule.name, source: 'rule', rule };
  for (const [prefixes, categoryId] of KNOWN) {
    // Short names must match exactly ("vi", "ola"), longer ones as a prefix, long ones anywhere.
    if (
      prefixes.some(
        (p) =>
          key === p || (p.length >= 4 && key.startsWith(p)) || (p.length >= 6 && key.includes(p)),
      )
    )
      return { categoryId, source: 'built-in' };
  }
  return { source: 'none' };
}

/** Income categories from wording. */
export function guessIncomeCategory(text: string): ID {
  if (/\b(salary|sal\b|payroll|wages)\b/i.test(text)) return 'salary';
  if (/\b(interest|int\.?\s*(pd|cr|credit)|int paid)\b/i.test(text)) return 'interest';
  if (/\b(cashback|reward|points)\b/i.test(text)) return 'cashback';
  return 'other-income';
}
