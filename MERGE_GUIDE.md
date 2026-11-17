# Linking the accounts app with the Needle Point operations app

The two apps share data by living in **one Supabase project**: this one (your invoice project). The accounts tables stay where they are, in `accounts_erp`. The operations app moves in next to them, in its own schema `ops`, with its own photo bucket `ops-photos`. Nothing in `public` or your other projects' schemas is touched.

**The step-by-step guide is `MOVE_GUIDE.md` in the operations app.** In short:

1. Run `ops_install.sql` (operations app) here and add `ops` to Exposed schemas.
2. Copy the operations data and photos with `move-data.mjs`, then run the install again.
3. Run `accounts_app/sql/integration/001_link_operations.sql` here.
4. Point the operations app at this project and deploy both apps.
5. **Accounts → Production Orders → One-time setup**, then match brands to parties.

Nothing about this app's own settings changes: same project, same env.

## Brands ↔ parties

Every brand in operations is billed as one client party here.

- **Setup links the sure matches:** same GSTIN, or the same name once "Pvt Ltd", punctuation and so on are ignored. The rest wait in **Parties → 🔗 Brand links**, so no duplicate parties are created. There you can:
  - accept ★ suggested matches, one by one or all at once;
  - pick any client from the dropdown, or move a link;
  - make a **+ New party** from a brand;
  - on the "Clients not in operations" tab, turn an existing client into a brand.
- **Linked pairs keep billing details in sync:** GSTIN, state, address, PAN, phone and email, edited in either app.
- **The party keeps its own name** (your legal billing name, used on invoices). The brand keeps its short name.
- **Moving or removing a link** takes back the details the brand had only copied from the old party, so they don't leak to the next one.
- **A brand created later** in operations is linked to its sure match automatically, or gets a new party.
- **In operations,** Brands shows "🔗 <party>" on each brand. Adding a brand can start from an existing Accounts client.

An order whose brand isn't linked can't be billed. Production Orders shows a **Match brands** banner until every brand is linked.

## Day-to-day after linking

| You do this in operations | Accounts does this |
|---|---|
| Add / edit a brand | Linked party updated (GSTIN, state, address, PAN, email); a new brand gets its party |
| Add / edit a team member | Employee party created / updated |
| Create an order (PO) | It appears under **Production Orders**; *Proforma for advance* is one click, with garments, sizes, rates and GST filled in |
| Record a dispatch | Shows as "to invoice": use *Invoice dispatched pieces* or, for in-state deliveries, *Challan for dispatch*. A Telegram alert goes out if you've set Telegram up |
| (nothing) | *Final invoice* bills whatever is left, or converts the proforma so the advance stays attached. An advance can also be split across per-dispatch invoices |
| Log work with quantities | Payroll shows pieces and cost per piece (piece-rate staff are paid from their logged work); *Post salaries* books each salary once per month |
| Open an order (admin) | Shows Proforma sent / Advance / Due ₹… / Paid, plus the list of invoices and challans |

**Profit per order.** In a purchase bill's **PO Reference** field, enter the order's PO number for fabric and trims. The order's profitability panel then counts them, along with labour from the work log.

## Security

The lockdown (`ops_lockdown.sql` in the operations app, MOVE_GUIDE §9) restricts the `ops` and `accounts_erp` tables to your own email, the operations admin PIN and, for their own data only, staff and brand clients. Users from your other projects in this Supabase project get nothing. Rules you've already set with `rls_single_user.sql` are kept.

Before running it, make sure you sign in to the accounts app with your **email** (Supabase Auth). The username/password fallback has no database session, so it would see empty tables once the lockdown is on.
