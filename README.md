# Hisaab

A personal expense tracker that answers two questions separately:

1. **How much did I spend this month?** — by the date you actually spent, across bank, cash, UPI and cards.
2. **What do I owe on each credit card?** — by statement period (e.g. 16 Aug – 15 Sep), with due dates.

Card bill payments are transfers, so they are never counted as spending twice.

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
3. Android app reading SMS & notifications automatically ✓ (built, awaiting first device test)
4. Credit cards + EMIs ← next
5. Autopay
6. Themes
7. Insights & budgets
8. Import & reconcile
9. Sync & login (Go + PostgreSQL)
10. Extras
