# Accounts — Multi-Business ERP

## Deploy in 5 minutes (Netlify, free)

### Option A — Netlify Drop (Easiest, no account needed)
1. Run `npm install && npm run build` locally  
2. Drag the `dist/` folder to **https://app.netlify.com/drop**  
3. Done — you get a live URL like `https://abc123.netlify.app`

### Option B — Netlify + GitHub (Auto-deploys on push)
1. Push this folder to a GitHub repo  
2. Go to **https://app.netlify.com** → New site → Import from Git  
3. Build command: `npm run build` | Publish dir: `dist`  
4. Deploy — done

### Option C — Vercel
1. Push to GitHub  
2. Go to **https://vercel.com** → New Project → import repo  
3. Framework: Vite | Build: `npm run build` | Output: `dist`  
4. Deploy

---

## First-time Setup (after deploy)

1. Open your deployed URL
2. Go to **Setup → SQL Schema** — copy the SQL
3. Paste into **Supabase → SQL Editor → Run**
4. Come back to the app, enter your Supabase URL + anon key → Connect
5. Go to **Businesses** → Add Business → fill in Needle Point details
6. Go to **Parties** → Add your clients

## Local Development
```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

## Your Supabase credentials
- URL: https://your-project.supabase.co  
- Anon key: from Supabase → Settings → API  
- These are saved in browser localStorage after first login

## Production security (Phase 12)
For a production deployment, enable Supabase Auth and run `auth_rls_phase12.sql` after the master migration. The application accepts Supabase email/password authentication when an email is entered; the old VITE_APP_USERNAME/VITE_APP_PASSWORD login is retained only as a local-development fallback. After Auth/RLS is enabled, every business must have a `user_business_roles` membership. Newly created businesses automatically assign the authenticated creator as owner.

## Phase completion
Phases 1–16 are represented in this build: accounting/automation, purchase GST/ITC, GSTR-2B/3B review, inventory/item master, PO/GRN, quotations/sales orders, GST amendments staging, audit trail, Auth/RLS hardening, warehouses, production, cost centres/projects, and management KPIs. GST filing remains a human review/submission step; the ERP does not call paid AI or external filing APIs.

## Final 16-phase implementation

The final source bundle includes the application wiring for the enterprise phases and the deterministic automation layer. `FINAL_ACCOUNTS_ERP_PATCH.sql` is the small incremental SQL patch intended for the already-migrated `accounts_erp` database; it does not drop tables, truncate data, or delete records.

### GitHub
Do **not** commit `node_modules/` or `dist/`. Run `npm install` after cloning and use `npm run build` for a production build. A `.gitignore` is included for this.
