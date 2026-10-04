# Hisaab

A personal expense tracker that answers two questions separately:

1. **How much did I spend this month?** — by the date you actually spent, across bank, cash, UPI and cards.
2. **What do I owe on each credit card?** — by statement period (e.g. 16 Aug – 15 Sep), with due dates.

Card bill payments are transfers, so they are never counted as spending twice.

## Status

**Testing round 3 fixes** (2026-10-04): the Android filter now keeps every bank alert ("Sent Rs…", "Your txn of ₹…", reversals, SIPs) and the parser sets aside bill reminders, "will be debited" notices, payment requests and scam SMS; moves between your own accounts are transfers, not income; data is protected from low-storage clearing and stays out of Google backups. On a simulated 12-month history every month's spending is now within a few percent of the truth (was 44–68% low).

**Phase 3.5 — SMS-first setup** built: first launch reads your bank messages (or pasted ones in the browser), finds your accounts, cards and wallets with balances and bill days, and adds every payment automatically. You sort shops, not payments ("Where does your money go?"), and the Inbox shows only what needs you: new accounts, possible duplicates, unreadable messages and "Spent or lent?" for payments to people, which turns that same payment into a loan in Lent & borrowed.

**Phase 3 — Android app** built: the Hisaab Android app reads new bank SMS and payment-app notifications (PhonePe, GPay, Paytm…) on your phone and files them in the Inbox. It can import the last 30/90 days of messages and optionally add ready ones automatically. Nothing leaves the phone. GitHub Actions builds the signed APK on every push — see [docs/android-setup.md](docs/android-setup.md).

**Phase 2 — Paste bank SMS** done: paste messages into the **Inbox**, review the suggested transactions (account matched by last 4 digits, merchant, category, date) and add them in one tap. OTPs, offers and declined payments are skipped; duplicates are flagged; autopay and EMI messages are kept as notices. Categories you choose become **merchant rules** used next time.

**Phase 1 — Core ledger** done. Data is saved on your device (IndexedDB). You can:

- set up bank, cash, wallet/UPI Lite and credit-card accounts (or explore with sample data);
- add, edit, split, duplicate and delete (with undo) expenses, income, refunds and transfers;
- correct a balance with _Update balance_ (an adjustment that never counts as spending);
- track money lent and borrowed, with repayments;
- manage categories and sub-categories;
- download / restore a backup, switch light/dark theme.

Shortcut on desktop: press **N** to add a transaction.

## Run it

Needs Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain + database tests
npm run typecheck
npm run lint
npm run build      # production build in dist/
npm run build:preview   # one self-contained HTML file in dist-preview/
```

## Project layout

```
src/
  domain/       Pure TypeScript: data model, money, IST dates, statement periods, ledger maths (+ tests)
  db/           Dexie (IndexedDB) schema and default categories
  design/       Design tokens, base CSS, icons, shared components
  screens/      Welcome, Home, Transactions, Accounts, Account/Card detail, Insights, People, Categories, Settings, editors
  sample/       Deterministic sample data for the design preview
  db/repo.ts    All writes: validation, ids, timestamps, soft delete, backup
  store.tsx     Live reads from the database for the screens
  ui.tsx        Shared UI actions (open editors, toasts, navigation)
docs/
  data-model.md     Entities and the rules behind them
  design-system.md  Tokens, components, screen notes
  decisions.md      Architecture decisions
```

## Roadmap

0. Foundation & design ✓
1. Core ledger: bank, cash, UPI, transactions, categories, money lent/borrowed ✓
2. Paste bank SMS → Review inbox, merchant rules ✓
3. Android app reading SMS & notifications automatically ✓
3.5. SMS-first setup, review by exception, loans from SMS ✓
4. Credit cards + EMIs ← next
5. Autopay
6. Themes
7. Insights & budgets
8. Import & reconcile
9. Sync & login (Go + PostgreSQL)
10. Extras
