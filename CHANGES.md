# Changes — wiring fixes and UI/UX pass

**Before deploying:** run `accounts_app/sql/migrations/005_app_wiring_fixes.sql` in the Supabase SQL editor.
It is safe to re-run. It ends with an optional clean-up query for journal entries left behind by records deleted earlier.

## Things that were not connected properly

| Area | Problem | Fix |
|---|---|---|
| Proforma page | Showed every invoice; the `isProforma` flag was passed in but never used | Proforma page lists proformas only; Invoices page lists tax invoices only |
| Proforma conversion | Writes `proforma_number`, a column no SQL file created, and the error was ignored, so a conversion could silently fail | Column added (migration 005); conversion errors are now shown |
| Deleting records | Deleting a payment, expense, bank row or invoice left its journal entry behind, so P&L, Trial Balance and Balance Sheet kept counting money that no longer existed | Deletes now remove the linked journal entries; cancelling a purchase bill removes its payable entry |
| Auto-Number | Restarted every series at 1001, colliding with already-issued numbers; its filter `type !== 'proforma'` matched purchase bills, so supplier bill numbers were overwritten | Continues after the highest issued number, only touches sale drafts, and renumbers in two passes so drafts can swap numbers |
| Purchase bill numbers | New bills got the next number from *your* sales series; the "Invoice #" field appeared twice; the unique index blocked two suppliers using the same bill number | Supplier bill # starts blank and appears once; uniqueness is per supplier (migration 005) |
| Invoice type | The sales form let you switch an invoice to "Purchase", after which it vanished from the list | Type is set by the page |
| Balances | Balance ignored TDS deducted by the customer and credit notes, so those invoices could never reach "paid" | Balance = total − payments − TDS − credit notes, everywhere |
| Dashboard | "Overdue" read ₹0 (nothing ever sets status `overdue`) while its subtitle counted overdue invoices; purchase bills appeared in Recent Invoices | Overdue is worked out from due dates; dashboard covers sales only and the current FY |
| AP Ledger | "Total Owed" = bills + expenses and never subtracted payments, so it only ever grew | Bills − payments, with overdue amounts and a per-supplier bill list; expenses shown as already paid |
| AR Ledger | Counted cancelled and draft invoices as owed | Excluded; TDS and credit notes allowed for; overdue column added |
| GSTR-3B | Included proformas and drafts (GSTR-1 doesn't); in IST the month's last day was dropped from the period | Same rule as GSTR-1; month end computed from the calendar |
| P&L | Purchase bills post to *Raw Materials*, but only *Cost of Goods Sold* counted as cost, so gross profit was overstated; "Revenue (excl. GST)" actually includes GST | Every *Direct Expenses* account counts as cost of goods; label corrected; earlier FYs and a custom range added |
| Balance Sheet | Long-term liabilities were in the totals but had no section; accounts with a blank sub-group were in the totals but not listed; *Investments* and equity accounts without a sub-group dropped out of the totals | Every account appears in exactly one section that adds up |
| Trial Balance | Column headers didn't match the cells (Group appeared under "Code") | Headers fixed |
| TDS | Headed "FY 26-27" but summed all years | FY selector; cancelled invoices excluded |
| Dates | `today()` used UTC, so between midnight and 5:30 am IST new documents got yesterday's date | All date helpers now use local time |
| Missing CSS | KPI and GSTR-3B pages used `grid-2`, `grid-4`, `metric`, `page-head`, and some screens used `--text1`, `--border1`, `--bg1`, none of which were defined | Defined |
| Fresh installs | Audit Trail and GSTR-3B snapshots need `audit_log` and `gst_return_snapshots`, which no SQL file creates | Created in migration 005 / schema.sql |
| Silent failures | Many deletes and updates ignored Supabase errors | Errors are shown as toasts; there is a global catch for anything else |
| Login | Email sign-in made a second Supabase client instead of using the app's own | Signs in on the app's client |
| Other | Seeding the Chart of Accounts twice duplicated every account; the Add Account form ignored its Business picker; "Job work" expenses went to Miscellaneous instead of the Job Work ledger; a failed challan delete left the screen stuck; deleting a payment could turn a proforma into "sent" | All fixed |

## UI/UX

- **Navigation:** regrouped by task (Sales, Purchases, Banking, Ledgers, Accounting, Reports, GST, Masters, Settings). Groups collapse. There is a "Jump to…" search (**Ctrl/⌘+K**). A red badge on Invoices counts overdue invoices.
- **URLs:** the current screen is kept in the URL (`#/invoices`), so refresh, the Back button and shared links keep you on the same screen. The selected business is remembered.
- **Dashboard:** quick-create buttons, five clickable cards, and a "Needs attention" list covering overdue invoices, unissued drafts, paid-but-unconverted proformas, supplier bills due and businesses missing a state.
- **Invoices, Proforma, Purchase Bills:** summary cards, one-click status filters (Outstanding, Overdue, Drafts…), and table totals. Searching shows results across all months. Rows show overdue days and "from PI-…". There is a **↩ CN** action that starts a credit note from the invoice's own lines. Issued invoices offer *Cancel* instead of *Del*.
- **Invoice form:** *Save draft* vs **Save & issue** (drafts are left out of GSTR-1, which was easy to miss). The number follows the issue date's FY. Duplicate numbers are caught before saving. The total shows in the footer. The form asks before discarding work.
- **Parties:** typing a GSTIN fills in State and PAN and runs the checksum. The form warns if the GSTIN's state differs from the chosen state. The list shows each party's outstanding balance.
- **Payments / Expenses:** search, money in/out filter and totals on Payments; a month filter and totals on Expenses.
- **Chart of Accounts:** shows each account's balance.
- **KPIs page:** rebuilt with working capital, days sales outstanding and collection rate.
- **Dialogs:** Escape closes the top dialog only. Dragging a text selection out of a dialog no longer closes it.
- **Feedback:** toast messages for saves, deletes and errors.
- **Readability and mobile:** higher-contrast secondary text, keyboard focus outlines, tighter tables, and a two-column layout for summary cards on phones.

## Worth deciding next (not changed)

- **Sales revenue includes GST.** A customer payment is posted in full to *Sales Revenue*. GST is never credited to *CGST/SGST/IGST Payable*, so P&L revenue is overstated by the GST and the Balance Sheet shows no GST liability. The fix is to split each receipt in proportion to the invoice's tax. It changes the books from now on, so it should be your call.
- **Proforma conversion date.** The "→ Invoice" button dates the tax invoice today, while automatic conversion on full payment uses the payment date. These are deliberately different, but worth confirming that this is what your CA wants.


---

# Round 2 — link with the Needle Point operations app

Setup: follow [MERGE_GUIDE.md](MERGE_GUIDE.md). Everything below needs both apps in one Supabase project and `sql/integration/001_link_operations.sql` run.

## New screens

- **Sales → Production Orders**
  - Lists every order from the operations app with pieces ordered, dispatched and invoiced, order value, amount received, balance and billing status.
  - From an order you can raise:
    - a **proforma for the advance**
    - an **invoice for dispatched pieces** (only those not yet invoiced)
    - a **delivery challan** for in-state dispatches
    - a **final invoice** for whatever is left. If nothing has been invoiced yet, this converts the proforma so the advance stays attached.
  - Each document opens with the garments, size breakdown, rate, GST slab and a suggested HSN code already filled in.
  - The order's advance can be adjusted against per-dispatch invoices. If a payment is bigger than the invoice, it is split, and its journal entry is split with it.
  - Shows estimated profit per order: revenue, minus purchase bills tagged with the PO number, minus labour costed from the work log.
- **Purchases → Payroll**
  - Shows each active team member's monthly salary, the pieces they logged and their cost per piece.
  - **Post salaries** creates one Wages & Salaries expense per person, with its journal entry. The database blocks posting the same person twice for a month.

## Sync

- Every brand becomes a client party, and every team member an employee party. An existing party with the same name is reused rather than duplicated.
- GSTIN, state, address, PAN, email and phone sync both ways between brand and party.
- Invoices, challans and invoice lines record which order and garment they came from. Dispatches record their invoice or challan.

## Fixes

- Opening the app directly on a screen (e.g. `#/audit`, `#/gstr3b`) could crash it. Those screens loaded their own data before the database connection existed, which last round's URL routing made possible. The app now waits for the first data load.
