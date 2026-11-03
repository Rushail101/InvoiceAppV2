# InvoiceAppV2 — Accounts ERP

A personal, GST-aware invoicing and accounting app for running multiple businesses
from one place. React + Vite front-end, Supabase (Postgres) back-end, schema `accounts_erp`.

All app code lives in [`accounts_app/`](accounts_app/).

## What it does

| Area | Screens |
|---|---|
| **Sales** | Invoices, Proforma (converts to a tax invoice, keeping the PI number), Delivery Challans, Parties, Item Master (per-brand items and prices) |
| **Purchases** | Purchase Bills, Expenses, Payments, Bank |
| **Ledgers** | AR Ledger, AP Ledger, Party Statement, Payment List, TDS |
| **Accounting** | Chart of Accounts, Journal Vouchers, General Ledger, Trial Balance, Balance Sheet, P&L, Cash Flow, Analysis, Reconciliation, Journal Health, Bulk Bank Import |
| **GST** | GSTR-1 (invoice-date or payment-date mode, B2B / B2C, HSN summary), GSTR-3B review |
| **Settings** | Businesses, Export Data, SQL Setup |

Notes on behaviour:

- CGST/SGST vs IGST is chosen automatically from the business state and the place of supply.
- Invoice totals round to the nearest rupee by default, shown as a separate "Rounding Off" line.
- Invoice PDFs / downloads are named `<doc number>_<client>` (e.g. `PI_26_27_1012_Cayani`).
- The UPI QR on an invoice is generated in the browser. The UPI ID and amount are not sent to any outside service.
- Credit Notes, Debit Notes, Aging, Bulk Payment and Recurring invoices were removed from the app.

## Setup

1. **Database.** In the Supabase SQL editor run [`accounts_app/sql/schema.sql`](accounts_app/sql/schema.sql)
   (safe to re-run), then every file in [`accounts_app/sql/migrations/`](accounts_app/sql/migrations/) in order.
   The same schema is also viewable under *Settings → SQL Setup* in the app.
2. **Environment variables** (Render dashboard, or `accounts_app/.env` locally — never commit it):

   | Variable | Purpose |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
   | `VITE_APP_USERNAME` / `VITE_APP_PASSWORD` | Legacy single-user login. Logging in with an email address uses Supabase Auth instead. |

3. **Run locally**
   ```bash
   cd accounts_app
   npm install
   npm run dev        # http://localhost:5173
   ```
4. **Deploy (Render static site).** Root directory `accounts_app`, build command
   `npm install && npm run build`, publish directory `dist`, and add a rewrite rule
   `/*  →  /index.html` so deep links work.

## Securing the database

The anon key ships inside the front-end bundle, so the screen login alone does not protect the data.
[`accounts_app/sql/rls_single_user.sql`](accounts_app/sql/rls_single_user.sql) locks every table so only one
Supabase Auth user can read or write. It is deliberately **not** run automatically — read its header first
(you must sign in with the Supabase email account afterwards; the env-var login has no database session).

## Project layout

```
accounts_app/
  src/
    App.jsx            shell, navigation, login, dashboard, lazy data loading
    views/             one file per screen
    lib/db.js          all Supabase queries (loadCore / loadHeavy / fetchAll paging)
    lib/pdf.js         invoice and challan documents, local UPI QR
    lib/constants.js   GST helpers, number formatting, invoice numbering, CSS
    lib/automation.js  bank-transaction classification
  sql/
    schema.sql         full schema (safe to re-run)
    migrations/        incremental changes, numbered
    rls_single_user.sql  optional lock-down, see above
    scope_reduction_teardown.sql  one-off cleanup from removing earlier enterprise modules
```

## How data loads

On start only the small tables load (businesses, invoices, parties, expenses, payments, accounts, items,
bank accounts, challans). The large ones — journal entries/lines, bank transactions, invoice line items —
load the first time a screen that needs them is opened, and are refreshed with every later save.
Saving no longer blanks the page; the screen stays up while data refreshes in the background.
Tables over 1,000 rows are paged in parallel (Supabase caps a single request at 1,000 rows).

## Known follow-ups

- Spreadsheet import (`BankImport`, `BulkImport`) still loads SheetJS 0.18.5 from cdnjs. Upgrade to the
  official 0.20.x build from `cdn.sheetjs.com` after testing a bank-statement import.
- No automated tests yet (GST split, rounding, FY numbering and proforma conversion are the first candidates).
