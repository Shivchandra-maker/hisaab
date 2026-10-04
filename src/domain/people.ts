/**
 * Your phone contacts, used only to tell friends from shops: people lend and borrow with people
 * they know, so "Spent or lent?" is asked only for payments to (or from) a saved contact.
 * Kept in memory on the phone; never stored in the database or in backups.
 */

export interface Contact {
  name: string;
  phones: string[];
}

interface Indexed {
  name: string;
  tokens: string[];
}

let byPhone = new Map<string, string>();
let people: Indexed[] = [];
let loaded = false;

const tokensOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

/** Last 10 digits: "+91 98765-43210" and "9876543210" are the same number. */
const phoneKey = (digits: string) => {
  const d = digits.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

export function setContacts(list: Contact[]) {
  byPhone = new Map();
  people = [];
  for (const c of list) {
    for (const p of c.phones) {
      const k = phoneKey(p);
      if (k) byPhone.set(k, c.name);
    }
    const tokens = tokensOf(c.name);
    if (tokens.length) people.push({ name: c.name, tokens });
  }
  loaded = true;
}

/** True once contacts were read (Android with permission). Without them we never ask. */
export const contactsLoaded = () => loaded;

const sameToken = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * The contact a payee is, if any: by the phone number in a UPI ID, or by name — at least two
 * name parts must agree ("RAHUL SHARMA" ↔ "Rahul Sharma Office"), so a lone "Rahul" never matches.
 */
export function contactFor(payee?: string, vpa?: string): string | undefined {
  if (!loaded) return undefined;
  const local = vpa?.split('@')[0] ?? '';
  const k = /^\+?\d{10,12}$/.test(local) ? phoneKey(local) : '';
  if (k && byPhone.has(k)) return byPhone.get(k);
  if (!payee) return undefined;
  const want = tokensOf(payee);
  if (want.length < 2) return undefined;
  let best: { name: string; hits: number } | undefined;
  for (const p of people) {
    const hits = want.filter((w) => p.tokens.some((t) => sameToken(w, t))).length;
    if (hits >= 2 && hits >= Math.min(want.length, p.tokens.length) && (!best || hits > best.hits))
      best = { name: p.name, hits };
  }
  return best?.name;
}
