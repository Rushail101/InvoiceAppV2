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
