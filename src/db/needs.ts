import { accountHintKey, suggest, type Suggestion } from '../domain/sms/match';
import { formatINR } from '../domain/money';
import type { Account, InboxItem, MerchantRule, Transaction } from '../domain/types';
import type { ParsedSms } from '../domain/sms/parse';

/** Duplicates we're not sure about; certain ones (same bank reference…) are handled silently. */
export const UNSURE_DUPLICATES = [
  'Same payment from a bank SMS and an app notification',
  'Same amount, account and date',
];
export const needsDupCheck = (i: InboxItem) =>
  i.status === 'duplicate' && UNSURE_DUPLICATES.includes(i.note ?? '');

export const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface InboxNeeds {
  /** "Spent or lent?" — one entry per person. */
  people: Transaction[][];
  /** Messages from an account Hisaab doesn't know — one entry per account. */
  groups: [string, InboxItem[]][];
  /** Possible duplicates to confirm. */
  dups: InboxItem[];
  /** Messages Hisaab couldn't fully read. */
  other: InboxItem[];
  /** Fully understood messages not added yet (added on their own when auto-add is on). */
  ready: InboxItem[];
  suggestions: Map<string, Suggestion>;
  /** The one number shown everywhere: badge, Home banner, Inbox heading (D-01). */
  count: number;
}

/**
 * What in the Inbox needs the user. The single source for every "needs you" number,
 * so the bell, the banner, the sidebar badge and the Inbox page always agree.
 */
export function inboxNeeds(ctx: {
  inbox: InboxItem[];
  transactions: Transaction[];
  accounts: Account[];
  rules: MerchantRule[];
  accountHints: Record<string, string>;
  autoAdd: boolean;
}): InboxNeeds {
  const fresh = ctx.inbox.filter((i) => i.status === 'new');
  const dups = ctx.inbox.filter(needsDupCheck);

  const byPerson = new Map<string, Transaction[]>();
  for (const t of ctx.transactions) {
    if (!t.askLoan || t.deletedAt) continue;
    const k = personKey(t.merchant ?? '?');
    byPerson.set(k, [...(byPerson.get(k) ?? []), t]);
  }

  const base = {
    accounts: ctx.accounts,
    rules: ctx.rules,
    transactions: ctx.transactions,
    accountHints: ctx.accountHints,
  };
  const suggestions = new Map(
    fresh.map((i) => [i.id, suggest(i.parsed, { ...base, receivedAt: i.receivedAt })]),
  );

  const byAccount = new Map<string, InboxItem[]>();
  for (const i of fresh) {
    const s = suggestions.get(i.id);
    if (!s || s.accountId || !(i.parsed.last4 || i.parsed.bank || i.parsed.walletName)) continue;
    const k = accountHintKey(i.parsed);
    byAccount.set(k, [...(byAccount.get(k) ?? []), i]);
  }
  const groups = [...byAccount.entries()];
  const grouped = new Set(groups.flatMap(([, items]) => items.map((i) => i.id)));
  const ready = fresh.filter((i) => suggestions.get(i.id)?.ready);
  const other = fresh.filter((i) => !grouped.has(i.id) && !suggestions.get(i.id)?.ready);
  const people = [...byPerson.values()];

  return {
    people,
    groups,
    dups,
    other,
    ready,
    suggestions,
    count:
      people.length + groups.length + dups.length + other.length + (ctx.autoAdd ? 0 : ready.length),
  };
}

/** "ICICI Credit Card ••5566", "PhonePe wallet" — the name used for an account found in messages. */
export function foundAccountName(p: ParsedSms): string {
  const isCard = p.instrument === 'credit_card' || p.kind === 'card_payment';
  const isWallet = p.instrument === 'wallet' || p.instrument === 'upi_lite';
  const bank = p.bank?.replace(/ Bank$/, '');
  return isWallet
    ? `${p.walletName ?? 'UPI Lite'}${p.walletName ? ' wallet' : ''}`
    : `${bank ? `${bank} ` : ''}${isCard ? 'Credit Card' : p.instrument === 'debit_card' ? 'Debit Card' : 'Bank'}${p.last4 ? ` ••${p.last4}` : ''}`;
}

/**
 * What the Home banner says (D-02): the thing itself when there's one, a short list when there
 * are a few — never just "3 things need you".
 */
export function needsHeadline(n: InboxNeeds): { title: string; detail: string } | null {
  if (!n.count) return null;
  if (n.count === 1) {
    const g = n.groups[0];
    if (g) return { title: 'New account found', detail: foundAccountName(g[1][0]!.parsed) };
    const person = n.people[0];
    if (person) return { title: `${person[0]!.merchant ?? 'Someone'}:`, detail: 'spent or lent?' };
    const d = n.dups[0];
    if (d)
      return {
        title: 'Possible duplicate',
        detail: [d.parsed.merchant, d.parsed.amount !== undefined && formatINR(d.parsed.amount)]
          .filter(Boolean)
          .join(' · '),
      };
    return { title: 'A bank message', detail: 'needs a quick look' };
  }
  const parts = [
    n.groups.length && `${n.groups.length} new account${n.groups.length > 1 ? 's' : ''}`,
    n.people.length && `${n.people.length} spent-or-lent`,
    n.dups.length && `${n.dups.length} possible duplicate${n.dups.length > 1 ? 's' : ''}`,
    n.other.length && `${n.other.length} message${n.other.length > 1 ? 's' : ''} to check`,
    n.count - n.groups.length - n.people.length - n.dups.length - n.other.length > 0 &&
      `${n.ready.length} ready to add`,
  ].filter(Boolean);
  return { title: `${n.count} things need you`, detail: parts.join(' · ') };
}
