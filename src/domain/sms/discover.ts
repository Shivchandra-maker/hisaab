import { addDays, daysBetween, parseDate } from '../dates';
import type { AccountKind, ISODate, Paise } from '../types';
import type { ParsedSms } from './parse';

/**
 * First-launch setup: work out which accounts, cards and wallets you use from the payment
 * messages already on your phone, so you only have to check them instead of typing them in.
 *
 * Pure function over parsed messages; the screens and database live elsewhere.
 */

export interface ScannedMessage {
  parsed: ParsedSms;
  /** Date the message arrived (IST); used when the text has no date. */
  receivedAt: ISODate;
  /** Arrival time, to order messages on the same day. */
  ts?: number;
  /** False for pasted text: the arrival date is the paste day, not when the bank sent it. */
  dated?: boolean;
}

export interface FoundAccount {
  /** Stable key for this group, e.g. `acct:4521`, `card:8834`, `wallet:phonepe`. */
  key: string;
  kind: Exclude<AccountKind, 'cash'>;
  name: string;
  institution?: string;
  last4?: string;
  /** How many messages mention it. */
  messages: number;
  lastSeen: ISODate;
  firstSeen: ISODate;
  /** Latest balance stated in a message, and the day it was true. */
  balance?: { amount: Paise; date: ISODate };
  /** From the latest statement message (cards). */
  statementDay?: number;
  dueDaysAfterStatement?: number;
  statementDue?: { amount: Paise; date: ISODate };
  /** A debit card that most likely draws from this account. */
  mergeInto?: string;
  isDebitCard?: boolean;
  /** Why it deserves a second look, shown as "Check". */
  check?: string;
  /** Weak evidence (no account number): shown unticked, so it's only added if you say so. */
  unsure?: boolean;
}

const short = (bank?: string) => (bank ? bank.replace(/\s+bank$/i, '').trim() : undefined);

interface Group {
  key: string;
  kind: FoundAccount['kind'];
  last4?: string;
  banks: Map<string, number>;
  walletName?: string;
  isDebitCard?: boolean;
  items: { p: ParsedSms; date: ISODate; ts: number; dated: boolean }[];
}

function groupKey(p: ParsedSms): { key: string; kind: FoundAccount['kind'] } | undefined {
  if (p.instrument === 'credit_card' || p.kind === 'card_payment')
    return {
      key: p.last4 ? `card:${p.last4}` : `card?:${(p.bank ?? '').toLowerCase()}`,
      kind: 'credit_card',
    };
  if (p.instrument === 'upi_lite') return { key: 'lite', kind: 'wallet' };
  if (p.instrument === 'wallet' && p.walletName && !p.isWalletTopUp)
    return { key: `wallet:${p.walletName.toLowerCase().replace(/\s+/g, '')}`, kind: 'wallet' };
  if (p.instrument === 'debit_card' && p.last4) return { key: `debit:${p.last4}`, kind: 'bank' };
  if (p.last4) return { key: `acct:${p.last4}`, kind: 'bank' };
  if (p.bank) return { key: `acct?:${p.bank.toLowerCase()}`, kind: 'bank' };
  return undefined;
}

function counts(p: ParsedSms): boolean {
  if (p.kind !== 'ignore') return true;
  return p.reason === 'Card statement';
}

export function discoverAccounts(messages: ScannedMessage[]): FoundAccount[] {
  const groups = new Map<string, Group>();
  const add = (key: string, kind: Group['kind'], m: ScannedMessage, extra?: Partial<Group>) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, kind, banks: new Map(), items: [], ...extra };
      groups.set(key, g);
    }
    if (m.parsed.bank) g.banks.set(m.parsed.bank, (g.banks.get(m.parsed.bank) ?? 0) + 1);
    if (!g.last4 && m.parsed.last4 && !key.startsWith('wallet') && key !== 'lite')
      g.last4 = m.parsed.last4;
    g.items.push({
      p: m.parsed,
      date: m.parsed.date ?? m.receivedAt,
      ts: m.ts ?? 0,
      dated: !!m.parsed.date || m.dated !== false,
    });
  };

  for (const m of messages) {
    const p = m.parsed;
    if (!counts(p)) continue;
    // A wallet top-up names both the bank account (debited) and the wallet (loaded).
    if (p.isWalletTopUp && p.walletName)
      add(`wallet:${p.walletName.toLowerCase().replace(/\s+/g, '')}`, 'wallet', m, {
        walletName: p.walletName,
      });
    const g = groupKey(p);
    if (!g) continue;
    add(g.key, g.kind, m, {
      walletName: g.key.startsWith('wallet') ? p.walletName : undefined,
      isDebitCard: g.key.startsWith('debit:') || undefined,
    });
  }

  const bankOf = (g: Group) => [...g.banks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fold = (from: Group, into: Group) => {
    into.items.push(...from.items);
    for (const [b, n] of from.banks) into.banks.set(b, (into.banks.get(b) ?? 0) + n);
    groups.delete(from.key);
  };

  // Messages that name a bank but no number: fold into the only account/card of that bank.
  for (const g of [...groups.values()]) {
    const loose = g.key.match(/^(acct|card)\?:(.*)$/);
    if (!loose) continue;
    const bank = loose[2];
    const prefix = loose[1] === 'card' ? 'card:' : 'acct:';
    const same = [...groups.values()].filter(
      (o) => o.key.startsWith(prefix) && (bankOf(o) ?? '').toLowerCase() === bank,
    );
    if (same.length === 1) fold(g, same[0]!);
  }
  // A number seen once without its type but also as a card is that card.
  for (const g of [...groups.values()]) {
    if (!g.key.startsWith('acct:')) continue;
    const card = groups.get(`card:${g.last4}`);
    if (card && g.items.every((i) => i.p.instrument === 'unknown')) fold(g, card);
  }

  // A bank named with no number, in messages with no reference and no balance, is how scam SMS
  // look ("Your SBI account is suspended…"). Real alerts carry at least one of those.
  for (const g of [...groups.values()]) {
    if (g.last4 || g.key.startsWith('wallet') || g.key === 'lite') continue;
    if (!g.items.some((i) => i.p.ref || i.p.balance !== undefined)) groups.delete(g.key);
  }

  const out: FoundAccount[] = [];
  for (const g of groups.values()) {
    const items = [...g.items].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const bank = bankOf(g);
    const first = items[0]!.date;
    const last = items[items.length - 1]!.date;
    const f: FoundAccount = {
      key: g.key,
      kind: g.kind,
      name: '',
      institution: bank,
      last4: g.last4,
      messages: items.length,
      firstSeen: first,
      lastSeen: last,
    };
    // The last 4 digits are shown next to the name everywhere, so they stay out of it.
    const tail = '';
    if (g.kind === 'credit_card') {
      f.name = `${bank ? `${short(bank)} ` : ''}Credit Card${tail}`;
      const stmt = [...items].reverse().find((i) => i.p.statement);
      if (stmt) {
        const due = stmt.p.statement!.dueDate;
        // Pasted statement with no date of its own: guess it from the due date (usually ~20 days).
        const stmtDate = stmt.dated ? stmt.date : due ? addDays(due, -20) : undefined;
        if (stmtDate) {
          f.statementDay = parseDate(stmtDate)[2];
          if (due) {
            const days = daysBetween(stmtDate, due);
            if (days >= 0 && days <= 60) f.dueDaysAfterStatement = days;
          }
          if (stmt.p.statement!.totalDue !== undefined)
            f.statementDue = { amount: stmt.p.statement!.totalDue, date: stmtDate };
          if (!stmt.dated) f.check = 'Bill day guessed — check it in the card later';
        } else {
          f.check = 'Bill day not in messages yet — set it later';
        }
      } else {
        f.check = 'Bill day not in messages yet — set it later';
      }
      if (!g.last4) {
        f.check = 'No card number in messages';
        f.unsure = true;
      }
    } else if (g.key === 'lite') {
      f.name = 'UPI Lite';
    } else if (g.kind === 'wallet') {
      f.name = `${g.walletName ?? 'Wallet'} wallet`;
      f.institution = g.walletName;
    } else if (g.isDebitCard) {
      f.name = `${short(bank) ?? 'Bank'} Debit Card${tail}`;
      f.isDebitCard = true;
    } else {
      f.name = `${bank ?? 'Bank account'}${tail}`;
      if (!g.last4) {
        f.check = 'No account number in messages — tick only if it’s yours';
        f.unsure = true;
      }
    }
    if (g.kind !== 'credit_card') {
      const withBal = [...items]
        .reverse()
        .find((i) => i.p.balance !== undefined && !i.p.balanceIsLimit);
      if (withBal) f.balance = { amount: withBal.p.balance!, date: withBal.date };
    }
    out.push(f);
  }

  // A debit card usually spends from the savings account of the same bank.
  for (const f of out) {
    if (!f.isDebitCard) continue;
    const accts = out.filter(
      (o) =>
        o.kind === 'bank' && !o.isDebitCard && o.institution && o.institution === f.institution,
    );
    if (accts.length === 1) {
      f.mergeInto = accts[0]!.key;
      f.check = `Same account as ${accts[0]!.name}${accts[0]!.last4 ? ` ••${accts[0]!.last4}` : ''}?`;
    } else {
      f.check = 'Debit card — which account does it spend from?';
    }
  }

  const rank = (f: FoundAccount) =>
    f.kind === 'bank' ? (f.isDebitCard ? 1 : 0) : f.kind === 'credit_card' ? 2 : 3;
  return out.sort((a, b) => rank(a) - rank(b) || b.messages - a.messages);
}
