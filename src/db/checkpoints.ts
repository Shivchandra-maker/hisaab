import { assetDelta, counted } from '../domain/ledger';
import { accountForMessage } from '../domain/sms/match';
import { parseDate } from '../domain/dates';
import type { Account, ID, InboxItem, ISODate, Paise, Transaction } from '../domain/types';
import { stamp } from './db';
import { db, getMeta } from './repo';

/**
 * Keep balances honest with what the bank says.
 *
 * Most bank and wallet messages end with the balance after the payment ("Avl bal ₹X",
 * "Remaining balance"), and card messages with the available limit. The latest one becomes a
 * checkpoint: the account's balance from that moment is exactly what the bank said, plus the
 * payments after it. So money that never had its own SMS (charges, interest, a missed message)
 * stops pushing the balance off; `check.drift` shows how far off it had got.
 */

const isLiability = (a: Account) => a.kind === 'credit_card';

interface Point {
  account: Account;
  /** Balance (assets) or amount owed (cards) at that moment. */
  amount: Paise;
  date: ISODate;
  ts: number;
}

const later = (a: { date: ISODate; ts?: number }, b?: { date: ISODate; ts?: number }) =>
  !b || a.date > b.date || (a.date === b.date && (a.ts ?? 0) > (b.ts ?? 0));

/** Balance of `account` just after the message at (date, ts): earlier days + that day up to it. */
function balanceAt(
  account: Account,
  txns: Transaction[],
  date: ISODate,
  ts: number,
  tsOf: Map<ID, number>,
): Paise {
  let delta = 0;
  for (const t of txns) {
    if (!counted(t) || t.date < account.openingDate || t.date > date) continue;
    if (t.date === date) {
      const at = tsOf.get(t.id);
      if (at !== undefined && at > ts) continue; // after the message
    }
    delta += assetDelta(t, account.id);
  }
  return isLiability(account) ? account.openingBalance - delta : account.openingBalance + delta;
}

/** Payments on `date` up to the message, to start the day from the right amount. */
function deltaUpTo(
  account: Account,
  txns: Transaction[],
  date: ISODate,
  ts: number,
  tsOf: Map<ID, number>,
) {
  let delta = 0;
  for (const t of txns) {
    if (!counted(t) || t.date !== date) continue;
    const at = tsOf.get(t.id);
    if (at !== undefined && at > ts) continue;
    delta += assetDelta(t, account.id);
  }
  return delta;
}

export async function refreshCheckpoints(): Promise<number> {
  const [accounts, inbox, txns, hints] = await Promise.all([
    db.accounts.toArray(),
    db.inbox.toArray(),
    db.transactions.toArray(),
    getMeta<Record<string, string>>('accountHints', {}),
  ]);
  const live = accounts.filter((a) => !a.deletedAt && !a.archived);
  const tsOf = new Map<ID, number>();
  for (const i of inbox) if (i.txnId && i.receivedTs) tsOf.set(i.txnId, i.receivedTs);

  const latest = new Map<ID, Point>();
  const previous = new Map<ID, Point>();
  const avail = new Map<ID, { amount: Paise; date: ISODate }>();
  const statements = new Map<ID, InboxItem>();
  for (const i of inbox) {
    const p = i.parsed;
    const date = p.date ?? i.receivedAt;
    const ts = i.receivedTs ?? 0;
    if (p.statement && p.instrument === 'credit_card' && (p.date || i.source !== 'paste')) {
      const card = accountForMessage(p, live, hints);
      if (card?.card) {
        const prev = statements.get(card.id);
        if (!prev || later({ date, ts }, { date: prev.receivedAt, ts: prev.receivedTs }))
          statements.set(card.id, i);
      }
      continue;
    }
    if (p.balance === undefined) continue;
    const account = accountForMessage(p, live, hints);
    if (!account) continue;
    let amount: Paise;
    if (account.kind === 'credit_card') {
      if (!p.balanceIsLimit) continue;
      const seen = { amount: p.balance, date };
      if (later(seen, avail.get(account.id) ?? account.lastAvailable)) avail.set(account.id, seen);
      const limit = account.card?.creditLimit ?? 0;
      if (!limit) continue; // can't turn "available" into "owed" without the limit
      amount = limit - p.balance;
    } else {
      if (p.balanceIsLimit) continue;
      amount = p.balance;
    }
    const point = { account, amount, date, ts };
    const cur = latest.get(account.id);
    if (later(point, cur)) {
      if (cur) previous.set(account.id, cur);
      latest.set(account.id, point);
    } else if (later(point, previous.get(account.id))) previous.set(account.id, point);
  }

  let changed = 0;
  for (const a of live) {
    const pt = latest.get(a.id);
    const upd: Partial<Account> = {};
    const av = avail.get(a.id);
    if (av) upd.lastAvailable = av;
    if (pt && pt.date >= a.openingDate && later(pt, a.check)) {
      // How far off our own count was between the last two balances the bank stated.
      const prev = previous.get(a.id);
      let drift = 0;
      if (prev) {
        const d0 = deltaUpTo(a, txns, prev.date, prev.ts, tsOf);
        const anchored = {
          ...a,
          openingDate: prev.date,
          openingBalance: isLiability(a) ? prev.amount + d0 : prev.amount - d0,
        };
        drift = pt.amount - balanceAt(anchored, txns, pt.date, pt.ts, tsOf);
      }
      const d = deltaUpTo(a, txns, pt.date, pt.ts, tsOf);
      Object.assign(upd, {
        openingDate: pt.date,
        openingBalance: isLiability(a) ? pt.amount + d : pt.amount - d,
        check: { amount: pt.amount, date: pt.date, ts: pt.ts, drift },
      });
    }
    // A new statement message corrects a guessed bill day and days to pay.
    const st = statements.get(a.id);
    if (st && a.card) {
      const sd = st.parsed.date ?? st.receivedAt;
      const day = parseDate(sd)[2];
      const due = st.parsed.statement?.dueDate;
      const dueDays = due ? Math.round((Date.parse(due) - Date.parse(sd)) / 86_400_000) : undefined;
      if (
        day !== a.card.statementDay ||
        (dueDays !== undefined &&
          dueDays >= 0 &&
          dueDays <= 60 &&
          dueDays !== a.card.dueDaysAfterStatement)
      )
        upd.card = {
          ...a.card,
          statementDay: day,
          dueDaysAfterStatement:
            dueDays !== undefined && dueDays >= 0 && dueDays <= 60
              ? dueDays
              : a.card.dueDaysAfterStatement,
        };
    }
    if (Object.keys(upd).length) {
      await db.accounts.update(a.id, { ...upd, updatedAt: stamp() });
      changed++;
    }
  }
  return changed;
}
