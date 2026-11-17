# Linking the accounts app with the Needle Point operations app

The two apps can only share data if they live in **one Supabase project**. The
accounts tables are already in their own schema (`accounts_erp`), so they can
move next to the operations tables (`public`) without clashing.

**Move the accounts schema into the operations project**, not the other way
round. The operations data includes photos in Supabase Storage, saved as full
URLs, which are awkward to move. The accounts data is almost entirely rows.

Expect about 30–45 minutes. Nothing changes in the old accounts project, so you
can always point the app back at it.

## Before you start

- In **both** projects, take a backup: Database → Backups, or at least export the
  important tables to CSV.
- Install the Postgres client tools, version 15 or newer (`pg_dump`, `pg_restore`, `psql`).
  - Mac: `brew install libpq`
  - Windows: the "Command Line Tools" option of the PostgreSQL installer
- Get each project's connection string from Supabase → **Connect** → *Session
  pooler*. Below, `OLD_DB` is the accounts project and `OPS_DB` is the operations
  project.

## Step 1 — Copy the accounts data out

```bash
pg_dump "$OLD_DB" --schema=accounts_erp --no-owner --no-privileges -Fc -f accounts.dump
```

## Step 2 — Restore it into the operations project

```bash
pg_restore --no-owner --no-privileges -d "$OPS_DB" accounts.dump
```

A few `already exists` notices are fine. Real errors mention a table or column.

## Step 3 — Give the API access to it

In the operations project's **SQL editor**, run
`accounts_app/sql/integration/000_after_restore_grants.sql`.

Then go to **Project Settings → Data API → Exposed schemas** and add `accounts_erp`.

## Step 4 — Bring the schema up to date and link the apps

In the same SQL editor, run these in order:

1. `accounts_app/sql/migrations/005_app_wiring_fixes.sql`, if you hadn't run it yet.
2. `needlepoint_ERP/supabase/migration_007_schema_catchup.sql`. This changes nothing on
   your live data; it records tables the app already uses.
3. `accounts_app/sql/integration/001_link_operations.sql`.

## Step 5 — Files and logins (only if you use them)

**Expense receipts.** These are only needed if you attached bills to expenses.
1. Create a **private** bucket named `expense-attachments` in the operations project.
2. Copy the files across, keeping the same folder paths.

**Email sign-in.** This is only needed if you sign in to the accounts app with an email address.
1. Add the same user under Authentication → Users in the operations project.
2. If you ran `rls_single_user.sql`, run it again with the new user's id.

## Step 6 — Point the accounts app at the operations project

1. In Render, set the accounts app's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   to the **operations** project's values.
2. Deploy the updated code for **both** apps.

## Step 7 — Switch the link on

1. Open Accounts → **Production Orders**.
2. Pick *Needle Point* and press **Link brands & staff**. Every brand becomes a
   client party and every team member an employee party. An existing party with
   the same name is reused rather than duplicated.
3. Open each brand in the operations app once and fill in GSTIN, state and address.
   They copy across to the accounts party automatically, and edits in either app
   update the other.

Leave the old accounts project running for a week as a fallback, then pause it.

---

## Day-to-day after linking

| You do this in operations | Accounts does this |
|---|---|
| Add / edit a brand | Client party created / updated (GSTIN, state, address, PAN, email) |
| Add / edit a team member | Employee party created / updated |
| Create an order (PO) | It appears under **Production Orders** → *Proforma for advance* is one click, with garments, sizes, rates and GST filled in |
| Record a dispatch | Shows as "to invoice" → *Invoice dispatched pieces* or, for in-state deliveries, *Challan for dispatch*. A Telegram alert goes out if you've set Telegram up |
| — | *Final invoice* bills whatever is left, or converts the proforma so the advance stays attached. An advance can also be split across per-dispatch invoices |
| Log work with quantities | Payroll shows pieces and cost per piece; *Post salaries* books each salary once per month |
| Open an order (admin) | Shows Proforma sent / Advance / Due ₹… / Paid, plus the list of invoices and challans |

**Profit per order.** In the purchase bill's **PO Reference** field, enter the
order's PO number for fabric and trims. The order's profitability panel then
counts them, along with labour from the work log.

## Security note

Both apps use Supabase's public ("anon") key with open access rules. Anyone who
gets the key from either site's code can read every table. That includes the
accounts data and the brands' portal passwords, which are stored as plain text.
This was already the case before the merge. Merging puts it all behind one key.

Two fixes are worth doing next:
- Lock the accounts tables to your own login (`rls_single_user.sql`).
- Move the portal and PIN checks into the database rather than the browser.
