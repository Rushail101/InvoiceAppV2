import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { FONTS, CSS, today, getFY, fyRange, invoiceDue, isOverdue } from './lib/constants.js';
import { initSupabase, loadCore, loadHeavy, saveBusiness } from './lib/db.js';
import { setOpsBusiness } from './lib/opsLink.js';
import { InvoicesView } from './views/Invoices.jsx';
import { PartiesView, ExpensesView, PaymentsView, ARLedgerView, APLedgerView } from './views/Operations.jsx';
import { PartyStatementView, PaymentListView, ExportView, TDSView } from './views/ExtraViews.jsx';
import { ReconciliationView } from './views/Reconciliation.jsx';
import { CashFlowView } from './views/CashFlow.jsx';
import { ChartOfAccountsView, JournalView, GeneralLedgerView, TrialBalanceView, BalanceSheetView, PLView } from './views/Accounting.jsx';
import { AnalysisView } from './views/Analysis.jsx';
import { JournalHealthView } from './views/JournalHealth.jsx';
import { BankStatementView } from './views/BankStatement.jsx';
import { CreditNotesView } from './views/CreditNotes.jsx';
import { DebitNotesView } from './views/DebitNotes.jsx';
import { GSTR1View } from './views/GSTR1.jsx';
import { ItemsView } from './views/Items.jsx';
import { DeliveryChallansView } from './views/DeliveryChallans.jsx';
import { GSTR3BView, AuditTrailView, KPIDashboard } from './views/EnterpriseViews.jsx';
import { ProductionOrdersView, PayrollView } from './views/Production.jsx';
import { Badge, ModalShell, FG, EmptyState, Toaster, toast } from './components/ui.jsx';
import SCHEMA_SQL from '../sql/schema.sql?raw';

// Grouped by what you're doing rather than by table. `keys` are extra words the
// sidebar search matches on (Ctrl/⌘+K focuses it).
const NAV = [
  { id: 'dashboard',   label: 'Dashboard',         icon: '◈',  group: null },
  { id: 'production',  label: 'Production Orders', icon: '🧵', group: 'Sales', keys: 'po orders dispatch needle point garments ops' },
  { id: 'invoices',    label: 'Invoices',          icon: '📄', group: 'Sales', keys: 'tax invoice bill sale' },
  { id: 'proformas',   label: 'Proforma',          icon: '📋', group: 'Sales', keys: 'pi advance quotation estimate' },
  { id: 'creditnotes', label: 'Credit Notes',      icon: '↩',  group: 'Sales', keys: 'cn return' },
  { id: 'debitnotes',  label: 'Debit Notes',       icon: '↗',  group: 'Sales', keys: 'dn' },
  { id: 'challans',    label: 'Delivery Challans', icon: '🚚', group: 'Sales', keys: 'dc dispatch eway' },
  { id: 'purchasebills', label: 'Purchase Bills',  icon: '🧾', group: 'Purchases', keys: 'supplier vendor itc' },
  { id: 'expenses',    label: 'Expenses',          icon: '💸', group: 'Purchases', keys: 'spend rent salary' },
  { id: 'payroll',     label: 'Payroll',           icon: '👷', group: 'Purchases', keys: 'salary wages staff employees labour' },
  { id: 'bank',        label: 'Bank',              icon: '🏦', group: 'Banking', keys: 'statement import icici' },
  { id: 'payments',    label: 'Payments',          icon: '💳', group: 'Banking', keys: 'receipts collections' },
  { id: 'paylist',     label: 'Payment List',      icon: '💵', group: 'Banking' },
  { id: 'reconcile',   label: 'Reconciliation',    icon: '⚖️', group: 'Banking', keys: 'brs match' },
  { id: 'ar',          label: 'AR Ledger',         icon: '🟢', group: 'Ledgers', keys: 'receivable debtors aging' },
  { id: 'ap',          label: 'AP Ledger',         icon: '🔴', group: 'Ledgers', keys: 'payable creditors' },
  { id: 'statement',   label: 'Party Statement',   icon: '📃', group: 'Ledgers', keys: 'account statement' },
  { id: 'tds',         label: 'TDS',               icon: '📑', group: 'Ledgers' },
  { id: 'accounts',    label: 'Chart of Accounts', icon: '📒', group: 'Accounting', keys: 'coa ledger accounts' },
  { id: 'journal',     label: 'Journal Vouchers',  icon: '📝', group: 'Accounting', keys: 'jv entries' },
  { id: 'ledger',      label: 'General Ledger',    icon: '📖', group: 'Accounting', keys: 'gl' },
  { id: 'trial',       label: 'Trial Balance',     icon: '⚖',  group: 'Accounting', keys: 'tb' },
  { id: 'jhealth',     label: 'Journal Health',    icon: '🩺', group: 'Accounting', keys: 'missing repost' },
  { id: 'pl',          label: 'P&L Report',        icon: '📈', group: 'Reports', keys: 'profit loss income statement' },
  { id: 'balance',     label: 'Balance Sheet',     icon: '📊', group: 'Reports', keys: 'bs' },
  { id: 'cashflow',    label: 'Cash Flow',         icon: '💰', group: 'Reports' },
  { id: 'analysis',    label: 'Analysis',          icon: '🔎', group: 'Reports', keys: 'growth trend' },
  { id: 'kpis',        label: 'Management KPIs',   icon: '🎯', group: 'Reports', keys: 'dashboard metrics' },
  { id: 'gstr1',       label: 'GSTR-1',            icon: '🧾', group: 'GST', keys: 'gst return outward hsn' },
  { id: 'gstr3b',      label: 'GSTR-3B',           icon: '🧮', group: 'GST', keys: 'gst return itc' },
  { id: 'parties',     label: 'Parties',           icon: '👥', group: 'Masters', keys: 'clients customers vendors suppliers' },
  { id: 'items',       label: 'Item Master',       icon: '📦', group: 'Masters', keys: 'products catalog hsn' },
  { id: 'businesses',  label: 'Business profile',  icon: '🏢', group: 'Settings', keys: 'company gstin bank logo needle point' },
  { id: 'audit',       label: 'Audit Trail',       icon: '🛡', group: 'Settings', keys: 'log history' },
  { id: 'export',      label: 'Export Data',       icon: '↓',  group: 'Settings', keys: 'csv excel download' },
  { id: 'sqlsetup',    label: 'SQL Setup',         icon: '⚙',  group: 'Settings', keys: 'schema migration database' },
];
const TITLES = Object.fromEntries(NAV.map(n => [n.id, n.label]));
const GROUPS = [...new Set(NAV.filter(n => n.group).map(n => n.group))];
const VIEW_IDS = new Set(NAV.map(n => n.id));
const viewFromHash = () => { const v = (window.location.hash || '').replace(/^#\/?/, ''); return VIEW_IDS.has(v) ? v : 'dashboard'; };

const STATES = [
  'Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar',
  'Chandigarh','Chhattisgarh','Dadra and Nagar Haveli','Daman and Diu','Delhi','Goa',
  'Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka',
  'Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
  'Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu',
  'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
];

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, client }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const correctUser = import.meta.env.VITE_APP_USERNAME || '';
  const correctPass = import.meta.env.VITE_APP_PASSWORD || '';

  async function login() {
    if (!username.trim() || !password.trim()) { setErr('Enter username and password'); return; }
    setBusy(true); setErr('');
    try {
      const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('sb_url');
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('sb_key');
      // Prefer real Supabase Auth when an email is supplied. The legacy env
      // credential remains as a local-development fallback only.
      if (url && key && username.trim().includes('@')) {
        // Sign in on the SAME client the app queries with, so its requests carry the session
        // (a second client instance also triggers Supabase's "multiple GoTrueClient" warning).
        const authClient = client || createClient(url, key, { db: { schema: 'accounts_erp' } });
        const { error } = await authClient.auth.signInWithPassword({ email: username.trim(), password });
        if (error) throw error;
        localStorage.setItem('np_auth', 'true');
        onLogin();
      } else if (username.trim() === correctUser && password === correctPass) {
        localStorage.setItem('np_auth', 'true');
        onLogin();
      } else {
        setErr('Incorrect username or password');
      }
    } catch (e) {
      setErr(e?.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') login(); }

  return (
    <div className="config-wrap">
      <div className="config-screen">
        <div style={{ fontSize: 42, marginBottom: 14 }}>🧵</div>
        <h2 style={{ marginBottom: 6 }}>Needle Point</h2>
        <p style={{ marginBottom: 24, color: 'var(--text3)', fontSize: 13 }}>Sign in to continue</p>
        <div className="config-form">
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Email or username</label>
            <input
              autoFocus
              placeholder="you@example.com"
              value={username}
              autoComplete="username"
              onChange={e => setUsername(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 18 }}>
            <label>Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              autoComplete="current-password"
              onChange={e => setPassword(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          {err && <p className="err-msg" style={{ marginBottom: 10 }}>{err}</p>}
          <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>
            Sign in with your Supabase email for a real database session. The username login is a local fallback only.
          </p>
          {(!correctUser || !correctPass) && (
            <p style={{ fontSize: 11, color: 'var(--amber,#f59e0b)', marginBottom: 10 }}>
              ⚠ VITE_APP_USERNAME / VITE_APP_PASSWORD not set in environment variables.
            </p>
          )}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={login} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BUSINESS MODAL ───────────────────────────────────────────────────────────
function BizModal({ biz, onClose, onSave }) {
  const [f, setF] = useState({
    name: biz?.name || '', address: biz?.address || '', gstin: biz?.gstin || '',
    state: biz?.state || '', phone: biz?.phone || '', email: biz?.email || '',
    bank_account: biz?.bank_account || '', ifsc_code: biz?.ifsc_code || '',
    bank_name: biz?.bank_name || '', upi_id: biz?.upi_id || '', logo_url: biz?.logo_url || '',
  });
  const [busy, setBusy] = useState(false);

  const [bizErr, setBizErr] = useState('');
  async function save() {
    if (!f.name.trim()) { setBizErr('Business name is required'); return; }
    setBusy(true); setBizErr('');
    try {
      await onSave(f, biz?.id);
      onClose();
    } catch (e) {
      setBizErr(e.message || 'Save failed — check your Supabase connection');
    }
    setBusy(false);
  }

  return (
    <ModalShell
      title={biz?.id ? `Edit — ${biz.name}` : 'Add Business'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}
    >
      <div className="form-row cols-2">
        <FG label="Business Name *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></FG>
        <FG label="GSTIN"><input value={f.gstin} onChange={e => setF(x => ({ ...x, gstin: e.target.value.toUpperCase() }))} placeholder="07AAXFN6403D1Z5" /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Home State *" note="Required for CGST/SGST vs IGST auto-detection">
          <select value={f.state} onChange={e => setF(x => ({ ...x, state: e.target.value }))}>
            <option value="">Select state…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FG>
        <FG label="Phone"><input value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Email"><input value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></FG>
        <FG label="Logo URL"><input value={f.logo_url} onChange={e => setF(x => ({ ...x, logo_url: e.target.value }))} placeholder="https://…" /></FG>
      </div>
      <FG label="Address"><textarea value={f.address} onChange={e => setF(x => ({ ...x, address: e.target.value }))} /></FG>
      {bizErr && <p className="err-msg" style={{ marginTop: 6 }}>{bizErr}</p>}
      <div className="section-title">Bank Details (printed on PDF)</div>
      <div className="form-row cols-2">
        <FG label="Account No."><input value={f.bank_account} onChange={e => setF(x => ({ ...x, bank_account: e.target.value }))} /></FG>
        <FG label="IFSC Code"><input value={f.ifsc_code} onChange={e => setF(x => ({ ...x, ifsc_code: e.target.value.toUpperCase() }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Bank Name & Branch"><input value={f.bank_name} onChange={e => setF(x => ({ ...x, bank_name: e.target.value }))} placeholder="ICICI Bank, Mayapuri" /></FG>
        <FG label="UPI ID"><input value={f.upi_id} onChange={e => setF(x => ({ ...x, upi_id: e.target.value }))} placeholder="needlepoint.ibz@icici" /></FG>
      </div>
    </ModalShell>
  );
}

// ─── ONE BUSINESS: NEEDLE POINT ──────────────────────────────────────────────
// The app runs a single business. It's the one the operations link points at;
// failing that, the one called Needle Point; failing that, the first one.
// Any other businesses in the database stay there untouched, just hidden.
function pickHomeBusiness(businesses, opsBizId) {
  if (!businesses?.length) return null;
  return businesses.find(b => b.id === opsBizId)
    || businesses.find(b => /needle\s*point/i.test(b.name || ''))
    || businesses[0];
}

// Only the home business's records reach the screens. Rows with no business
// (shared defaults such as a common chart of accounts) are kept. Child tables
// follow their parent: bank lines → bank accounts, journal lines → entries,
// invoice lines → invoices, bank links → bank lines.
function scopeToBusiness(data, home) {
  if (!home || data.businesses.length <= 1) return { ...data, businesses: home ? [home] : [] };
  const mine = r => !r.business_id || r.business_id === home.id;
  const out = { ...data, businesses: [home] };
  for (const k of ['invoices', 'parties', 'expenses', 'payments', 'accounts', 'bankAccounts', 'items', 'challans', 'creditNotes', 'debitNotes', 'journalEntries']) {
    out[k] = (data[k] || []).filter(mine);
  }
  const bankIds = new Set(out.bankAccounts.map(b => b.id));
  out.bankTransactions = (data.bankTransactions || []).filter(t => !t.bank_account_id || bankIds.has(t.bank_account_id));
  const txnIds = new Set(out.bankTransactions.map(t => t.id));
  out.bankLinks = (data.bankLinks || []).filter(l => txnIds.has(l.bank_txn_id));
  const entryIds = new Set(out.journalEntries.map(e => e.id));
  out.journalLines = (data.journalLines || []).filter(l => !l.journal_id || entryIds.has(l.journal_id));
  const invIds = new Set(out.invoices.map(i => i.id));
  out.invoiceItems = (data.invoiceItems || []).filter(it => invIds.has(it.invoice_id));
  return out;
}

// ─── BUSINESS PROFILE ─────────────────────────────────────────────────────────
function BusinessProfileView({ home, hiddenCount, reload }) {
  const [modal, setModal] = useState(false);
  async function handleSave(data, id) { await saveBusiness(data, id); reload(); }
  const row = (label, value, warn) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text3)', fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right', color: warn ? 'var(--red)' : 'var(--text)' }}>{value}</span>
    </div>
  );
  if (!home) return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-title">Set up your business</div>
      <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 14 }}>
        Add Needle Point's details once: name, GSTIN, home state (for the CGST/SGST split), address, bank and UPI.
        They appear on every invoice, proforma and challan.
      </p>
      <button className="btn btn-primary" onClick={() => setModal(true)}>Add business details</button>
      {modal && <BizModal biz={{ name: 'Needle Point' }} onClose={() => setModal(false)} onSave={(d) => handleSave(d, null)} />}
    </div>
  );
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        {home.logo_url && <img src={home.logo_url} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, background: '#fff' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--display, inherit)', fontSize: 20, fontWeight: 700 }}>{home.name}</div>
          <div className="hint">These details print on every invoice, proforma and challan.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}>⚙ Edit details</button>
      </div>
      {row('GSTIN', home.gstin || '—')}
      {row('Home state', home.state || '⚠ Not set — CGST/SGST can\'t be split', !home.state)}
      {row('Address', home.address || '—')}
      {row('Phone / email', [home.phone, home.email].filter(Boolean).join(' · ') || '—')}
      {row('Bank', [home.bank_name, home.bank_account, home.ifsc_code].filter(Boolean).join(' · ') || '—')}
      {row('UPI', home.upi_id || '—')}
      {hiddenCount > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          {hiddenCount} other business{hiddenCount === 1 ? ' is' : 'es are'} saved in the database from before. {hiddenCount === 1 ? 'It\'s' : 'They\'re'} hidden here, and {hiddenCount === 1 ? 'its' : 'their'} data is kept untouched.
        </p>
      )}
      {modal && <BizModal biz={home} onClose={() => setModal(false)} onSave={handleSave} />}
    </div>
  );
}

// ─── SQL SETUP ────────────────────────────────────────────────────────────────

function SqlSetupView({ invoices = [], payments = [] }) {
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  function copy() { navigator.clipboard.writeText(SCHEMA_SQL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">First-time Setup</div>
        <ol style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 2.2, paddingLeft: 20 }}>
          <li>Go to <strong style={{ color: 'var(--text)' }}>Supabase → SQL Editor</strong> → paste the SQL below → Run (it already includes migrations 001–005; on an older database run the files in <code>sql/migrations/</code> instead)</li>
          <li>Go to <strong style={{ color: 'var(--text)' }}>Settings → Businesses</strong> → add your business, set the <span style={{ color: 'var(--accent)' }}>Home State</span></li>
          <li>Go to <strong style={{ color: 'var(--text)' }}>Accounting → Chart of Accounts</strong> → click <strong style={{ color: 'var(--text)' }}>Seed Default Accounts</strong></li>
          <li>Add parties (clients/vendors) — set their <strong style={{ color: 'var(--text)' }}>State</strong> for correct GST</li>
          <li>Start creating invoices</li>
        </ol>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>schema.sql</span>
        <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? '✓ Copied!' : 'Copy SQL'}</button>
      </div>
      <div className="sql-box">{SCHEMA_SQL}</div>

      {/* ── One-time proforma date fix ── */}
      {(() => {
        // Find invoices that: have a real invoice number (not PI-), are paid, and likely converted from proforma
        // We identify them as invoices whose issue_date is suspiciously old relative to their payment date
        const converted = invoices.filter(inv =>
          inv.status === 'paid' &&
          inv.invoice_number &&
          !/^PI[-/]/i.test(inv.invoice_number) &&
          !inv.invoice_number.startsWith('PF-')
        );

        // For each, find the latest payment and check if issue_date differs from payment date
        const needsFix = converted.filter(inv => {
          const invPayments = payments
            .filter(p => p.invoice_id === inv.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          if (!invPayments.length) return false;
          const lastPmtDate = invPayments[0].created_at?.split('T')[0];
          return lastPmtDate && lastPmtDate !== inv.issue_date;
        });

        async function runFix() {
          if (!needsFix.length) return;
          if (!confirm(`This will update issue_date for ${needsFix.length} invoice(s) to match when payment was recorded.\n\nThis affects GSTR-1 filing months. Continue?`)) return;
          setFixing(true);
          setFixResult(null);
          const { supabase } = await import('./lib/db.js');
          let fixed = 0, failed = 0;
          for (const inv of needsFix) {
            const lastPmt = payments
              .filter(p => p.invoice_id === inv.id)
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            const newDate = lastPmt.created_at?.split('T')[0];
            const { error } = await supabase.from('invoices')
              .update({ issue_date: newDate })
              .eq('id', inv.id);
            if (error) failed++;
            else fixed++;
          }
          setFixing(false);
          setFixResult({ fixed, failed });
        }

        return (
          <div className="card" style={{ marginTop: 24, borderColor: needsFix.length ? 'var(--amber)' : 'var(--border1)' }}>
            <div className="card-head" style={{ color: needsFix.length ? 'var(--amber)' : 'var(--text2)' }}>
              🔧 One-time Fix — Proforma Conversion Dates
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>
              Finds paid invoices where the <code>issue_date</code> doesn't match the date payment was recorded —
              these were likely converted from proformas before the fix was applied.
              Updates their date to when the final payment hit, so GSTR-1 shows the correct month.
            </p>

            {needsFix.length > 0 ? (
              <>
                <div style={{ marginBottom: 12, background: 'var(--bg2)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border1)' }}>
                        <th style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500 }}>Invoice #</th>
                        <th style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500 }}>Current Date</th>
                        <th style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500 }}>→ Will be updated to</th>
                        <th style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--text3)', fontWeight: 500 }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {needsFix.map(inv => {
                        const lastPmt = payments
                          .filter(p => p.invoice_id === inv.id)
                          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                        const newDate = lastPmt?.created_at?.split('T')[0];
                        return (
                          <tr key={inv.id} style={{ borderBottom: '1px solid var(--border1)' }}>
                            <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: 'var(--text1)' }}>{inv.invoice_number}</td>
                            <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: 'var(--red)', textDecoration: 'line-through', opacity: 0.7 }}>{inv.issue_date}</td>
                            <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: '#4ade80' }}>{newDate}</td>
                            <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: 'var(--text1)', textAlign: 'right' }}>₹{Number(inv.total).toLocaleString('en-IN')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  className="btn btn-warning"
                  onClick={runFix}
                  disabled={fixing}
                  style={{ fontSize: 13 }}
                >
                  {fixing ? '⏳ Updating…' : `Fix ${needsFix.length} Invoice${needsFix.length !== 1 ? 's' : ''}`}
                </button>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#4ade80' }}>
                ✅ All invoice dates look correct — nothing to fix.
              </div>
            )}

            {fixResult && (
              <div style={{ marginTop: 12, fontSize: 13, color: fixResult.failed ? 'var(--amber)' : '#4ade80' }}>
                {fixResult.fixed > 0 && `✅ ${fixResult.fixed} invoice${fixResult.fixed !== 1 ? 's' : ''} updated. `}
                {fixResult.failed > 0 && `⚠️ ${fixResult.failed} failed — check Supabase logs.`}
                {fixResult.fixed > 0 && ' Refresh the page to see updated GSTR-1 data.'}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── MINI BAR CHART ──────────────────────────────────────────────────────────
function MiniBarChart({ data, color = 'var(--accent)', label }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div title={`${d.label}: ₹${Number(d.value).toLocaleString('en-IN')}`}
              style={{ width: '100%', background: color, borderRadius: '3px 3px 0 0', height: `${Math.max(3, (d.value / max) * 52)}px`, transition: 'height .3s', cursor: 'default', opacity: i === data.length - 1 ? 1 : 0.55 }} />
            <div style={{ fontSize: 9.5, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
// Sales figures only (purchase bills used to leak into "Recent Invoices" and the
// overdue list), for the current financial year, with an "overdue" figure that is
// worked out from due dates — nothing ever sets status 'overdue', so the old card
// always read ₹0 while its subtitle counted overdue invoices.
function Dashboard({ invoices, expenses, payments, businesses, parties, creditNotes = [], activeBiz, setView, startAction }) {
  const fy = getFY();
  const { start: fyStart, end: fyEnd } = fyRange(fy);
  const inFY = d => !!d && d >= fyStart && d <= fyEnd;
  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;
  const be = activeBiz ? expenses.filter(e => e.business_id === activeBiz) : expenses;

  const fmtN = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtM = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const partyName = id => parties.find(p => p.id === id)?.name || '—';

  const paysByInv = {};
  payments.forEach(p => { (paysByInv[p.invoice_id] ||= []).push(p); });
  const cnsByInv = {};
  creditNotes.forEach(c => { (cnsByInv[c.invoice_id] ||= []).push(c); });
  const dueOf = i => invoiceDue(i, paysByInv[i.id] || [], cnsByInv[i.id] || []);

  const sales = bi.filter(i => i.type === 'sale');
  const issued = sales.filter(i => !['cancelled', 'proforma', 'draft'].includes(i.status));
  const openSales = sales.filter(i => !['cancelled', 'draft'].includes(i.status)); // incl. proformas (advances)
  const bills = bi.filter(i => i.type === 'purchase' && i.status !== 'cancelled');

  const revenue = issued.filter(i => inFY(i.issue_date)).reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const saleIds = new Set(openSales.map(i => i.id));
  const collected = payments.filter(p => saleIds.has(p.invoice_id) && inFY(p.payment_date)).reduce((s, p) => s + Number(p.amount || 0), 0);
  const receivable = issued.reduce((s, i) => s + Math.max(0, dueOf(i)), 0);
  const overdueInvs = issued.filter(i => isOverdue(i, dueOf(i))).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const overdueAmt = overdueInvs.reduce((s, i) => s + Math.max(0, dueOf(i)), 0);
  const payable = bills.reduce((s, i) => s + Math.max(0, dueOf(i)), 0);
  const fyExp = be.filter(e => inFY(e.expense_date)).reduce((s, e) => s + Number(e.amount || 0), 0);

  const drafts = sales.filter(i => i.status === 'draft');
  const paidProformas = sales.filter(i => i.status === 'proforma' && dueOf(i) <= 0.01);
  const billsDue = bills.filter(i => i.due_date && i.due_date <= today() && dueOf(i) > 0.01);

  // Money received per month, last 6 months (cash basis)
  const monthlyData = (() => {
    const months = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short' });
      const value = payments.filter(p => saleIds.has(p.invoice_id) && (p.payment_date || '').startsWith(key)).reduce((s, p) => s + Number(p.amount || 0), 0);
      months.push({ label, value });
    }
    return months;
  })();

  // Top clients by money received this FY
  const clientRevenue = {};
  payments.forEach(p => {
    if (!saleIds.has(p.invoice_id) || !inFY(p.payment_date)) return;
    const inv = openSales.find(i => i.id === p.invoice_id);
    const name = partyName(inv?.party_id);
    clientRevenue[name] = (clientRevenue[name] || 0) + Number(p.amount || 0);
  });
  const top5 = Object.entries(clientRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxClient = top5[0]?.[1] || 1;

  const missingState = (activeBiz ? businesses.filter(b => b.id === activeBiz) : businesses).filter(b => !b.state);
  const attention = [
    missingState.length && { tone: 'amber', text: `${missingState.map(b => b.name).join(', ')} ${missingState.length === 1 ? 'has' : 'have'} no Home State — CGST/SGST can't be split`, cta: 'Fix', go: () => setView('businesses') },
    overdueInvs.length && { tone: 'red', text: `${overdueInvs.length} invoice${overdueInvs.length === 1 ? '' : 's'} overdue — ${fmtN(overdueAmt)} to chase`, cta: 'View', go: () => startAction('invoices', { filter: 'overdue' }) },
    drafts.length && { tone: 'purple', text: `${drafts.length} draft invoice${drafts.length === 1 ? '' : 's'} not issued — drafts are left out of GSTR-1`, cta: 'Review', go: () => startAction('invoices', { filter: 'draft' }) },
    paidProformas.length && { tone: 'blue', text: `${paidProformas.length} proforma${paidProformas.length === 1 ? ' is' : 's are'} fully paid but not converted to a tax invoice`, cta: 'Convert', go: () => setView('proformas') },
    billsDue.length && { tone: 'amber', text: `${billsDue.length} supplier bill${billsDue.length === 1 ? '' : 's'} due or past due — ${fmtN(billsDue.reduce((s, i) => s + dueOf(i), 0))}`, cta: 'Pay', go: () => startAction('purchasebills', { filter: 'unpaid' }) },
  ].filter(Boolean);

  const Stat = ({ tone, label, value, sub, onClick }) => (
    <div className={`stat-card ${tone}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && e.key === 'Enter') onClick(); }}>
      <div className="stat-label">{label}</div><div className={`stat-val ${tone}`}>{value}</div><div className="stat-sub">{sub}</div>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={() => startAction('invoices', { create: true })}>+ New Invoice</button>
        <button className="btn btn-ghost" onClick={() => startAction('proformas', { create: true })}>+ Proforma</button>
        <button className="btn btn-ghost" onClick={() => startAction('purchasebills', { create: true })}>+ Purchase Bill</button>
        <button className="btn btn-ghost" onClick={() => setView('expenses')}>+ Expense</button>
        <span className="hint" style={{ marginLeft: 'auto' }}>FY {fy} · {activeBiz ? businesses.find(b => b.id === activeBiz)?.name : 'all businesses'}</span>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <Stat tone="green" label="Revenue (taxable)" value={fmtN(revenue)} sub={`${issued.filter(i => inFY(i.issue_date)).length} invoices this FY`} onClick={() => setView('invoices')} />
        <Stat tone="blue" label="Collected" value={fmtN(collected)} sub="received this FY" onClick={() => setView('payments')} />
        <Stat tone="amber" label="Receivable" value={fmtN(receivable)} sub="after TDS & credit notes" onClick={() => setView('ar')} />
        <Stat tone="red" label="Overdue" value={fmtN(overdueAmt)} sub={`${overdueInvs.length} invoice(s) past due`} onClick={() => startAction('invoices', { filter: 'overdue' })} />
        <Stat tone="purple" label="Payable" value={fmtN(payable)} sub={`expenses this FY ${fmtN(fyExp)}`} onClick={() => setView('ap')} />
      </div>

      {attention.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">Needs attention</div>
          {attention.map((a, i) => (
            <div key={i} className="ledger-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: `var(--${a.tone})`, flexShrink: 0 }} />
                <span style={{ color: 'var(--text2)' }}>{a.text}</span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={a.go}>{a.cta} →</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2" style={{ gap: 12, marginBottom: 20 }}>
        <div className="card">
          <div className="card-head">Money received — last 6 months</div>
          <MiniBarChart data={monthlyData} color="var(--accent)" label="₹ collected (incl. GST)" />
        </div>
        <div className="card">
          <div className="card-head">Top clients — received this FY</div>
          {top5.length > 0 ? (
            <div>
              {top5.map(([name, val]) => (
                <div key={name} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{name}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)', fontSize: 11 }}>{fmtN(val)}</span>
                  </div>
                  <div style={{ background: 'var(--bg3)', borderRadius: 3, height: 5 }}>
                    <div style={{ background: 'var(--accent)', borderRadius: 3, height: 5, width: `${(val / maxClient) * 100}%`, transition: 'width .3s' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 0' }}>No payments received this FY yet</div>}
        </div>
      </div>

      {overdueInvs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ color: 'var(--red)', marginTop: 0 }}>Overdue ({overdueInvs.length})</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice #</th><th>Party</th><th>Due Date</th><th className="r">Days late</th><th className="r">Balance</th></tr></thead>
              <tbody>
                {overdueInvs.slice(0, 5).map(inv => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ color: 'var(--accent)' }}>{inv.invoice_number}</td>
                    <td style={{ fontWeight: 500 }}>{partyName(inv.party_id)}</td>
                    <td className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>{fmtD(inv.due_date)}</td>
                    <td className="r mono" style={{ color: 'var(--red)', fontSize: 11 }}>{Math.floor((new Date(today()) - new Date(inv.due_date)) / 86400000)}</td>
                    <td className="r mono" style={{ color: 'var(--red)' }}>{fmtM(dueOf(inv))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-toolbar"><h3>Recent sales documents</h3><button className="btn btn-ghost btn-sm" onClick={() => setView('invoices')}>All invoices →</button></div>
        <table>
          <thead><tr><th>Number</th><th>Party</th><th>Date</th><th className="r">Total</th><th className="r">Balance</th><th>GST</th><th>Status</th></tr></thead>
          <tbody>
            {[...sales].sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || '')).slice(0, 8).map(inv => {
              const gstMode = inv.is_interstate === false ? 'intra' : 'inter';
              const due = dueOf(inv);
              return (
                <tr key={inv.id}>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{inv.invoice_number}</td>
                  <td style={{ fontWeight: 500 }}>{partyName(inv.party_id)}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtD(inv.issue_date)}</td>
                  <td className="r mono">{fmtM(inv.total)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: due > 0.01 && inv.status !== 'cancelled' ? 'var(--amber)' : 'var(--text3)' }}>{inv.status === 'cancelled' ? '—' : due > 0.01 ? fmtM(due) : '✓'}</td>
                  <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S GST' : 'IGST'}</span></td>
                  <td><Badge status={isOverdue(inv, due) ? 'overdue' : inv.status} /></td>
                </tr>
              );
            })}
            {sales.length === 0 && <tr><td colSpan={7}><EmptyState icon="📄" message="No invoices yet" sub='Use "+ New Invoice" above to raise your first one' /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── LAZY DATA ────────────────────────────────────────────────────────────────
// The big tables are only fetched the first time a screen that needs them opens
// (then kept fresh by every refresh). Everything else loads up front via loadCore().
//   journal      -> journal entries + lines
//   bankTxns     -> bank transactions
//   invoiceItems -> invoice line items
const VIEW_NEEDS = {
  expenses: ['journal'], payments: ['journal'],
  bank: ['bankTxns', 'bankLinks', 'journal'],
  journal: ['journal'], analysis: ['journal'], ledger: ['journal'], trial: ['journal'], accounts: ['journal'],
  balance: ['journal'], pl: ['journal'],
  cashflow: ['journal', 'bankTxns'], reconcile: ['journal', 'bankTxns'],
  jhealth: ['journal', 'bankTxns', 'bankLinks'],
  gstr1: ['invoiceItems'],
};

// ─── SIDEBAR COLLAPSE ─────────────────────────────────────────────────────────
// Must match the max-width of the media query in CSS (lib/constants.js) where the
// sidebar turns into the slide-in mobile drawer. Below this width the ☰ button opens
// the drawer; above it, the button hides/shows the sidebar and gives content full width.
const MOBILE_BREAKPOINT = 900;

const SIDEBAR_CSS = `
.hamburger-btn { display: inline-flex !important; align-items: center; justify-content: center; cursor: pointer; }
.app .main, .app .content { min-width: 0; max-width: 100%; }

/* ── Tables: never clip, whatever the data size ───────────────────────────────
   The table grows to the width its content needs (width: max-content) but is never
   narrower than its card (min-width: 100%); the card scrolls sideways when the table
   is wider. Applies to every .table-wrap in the app. */
.table-wrap { overflow-x: auto !important; max-width: 100%; }
.table-wrap > table, .table-wrap table { width: max-content; min-width: 100%; }
.table-wrap td.r, .table-wrap th.r { white-space: nowrap; }

/* ── Frozen columns: add className="freeze-3" to a table to pin its first 3 columns
   (checkbox · invoice # · party). Widths are fixed so the left offsets line up. */
.freeze-3 :is(thead, tbody) tr > :nth-child(-n+3) { position: sticky; z-index: 2; background: var(--bg2); }
.freeze-3 thead tr > :nth-child(-n+3) { z-index: 3; }
.freeze-3 :is(thead, tbody) tr > :nth-child(1) { left: 0;     width: 44px;  min-width: 44px;  max-width: 44px; }
.freeze-3 :is(thead, tbody) tr > :nth-child(2) { left: 44px;  width: 120px; min-width: 120px; max-width: 120px; }
.freeze-3 :is(thead, tbody) tr > :nth-child(3) { left: 164px; width: 190px; min-width: 190px; max-width: 190px;
  box-shadow: 8px 0 8px -6px rgba(0,0,0,.55); }
.freeze-3 tfoot tr > :first-child { position: sticky; left: 0; z-index: 2; background: var(--bg3);
  box-shadow: 8px 0 8px -6px rgba(0,0,0,.55); }
.app.sidebar-hidden { grid-template-columns: minmax(0, 1fr) !important; }
.app.sidebar-hidden .sidebar:not(.open) { display: none !important; }
.app.sidebar-hidden .main { margin-left: 0 !important; width: 100% !important; max-width: 100% !important; }
`;

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem('np_auth') === 'true');
  const [client, setClient] = useState(null);
  // The current screen lives in the URL hash (#/invoices), so refreshing the
  // page or using Back/Forward keeps you where you were, and links can be shared.
  const [view, setViewState] = useState(viewFromHash);
  const setView = useCallback((v) => {
    setViewState(v);
    if (window.location.hash !== `#/${v}`) window.history.pushState(null, '', `#/${v}`);
  }, []);
  useEffect(() => {
    const onPop = () => setViewState(viewFromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // One-shot instruction for the next screen (e.g. dashboard "+ New Invoice" or "View overdue").
  const [pendingAction, setPendingAction] = useState(null);
  const startAction = useCallback((v, action) => { setPendingAction({ view: v, ...action, at: Date.now() }); setView(v); }, [setView]);
  // This app runs one business: Needle Point. Which row that is comes from the
  // operations link (integration_settings) — see pickHomeBusiness below.
  const [opsBizId, setOpsBizId] = useState(undefined);   // undefined = not checked yet, null = not linked
  const autoLinked = useRef(false);
  const [navQuery, setNavQuery] = useState('');
  const navSearchRef = useRef(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => { try { return JSON.parse(localStorage.getItem('np_nav_collapsed') || '{}'); } catch (_) { return {}; } });
  const toggleGroup = g => setCollapsedGroups(c => { const n = { ...c, [g]: !c[g] }; try { localStorage.setItem('np_nav_collapsed', JSON.stringify(n)); } catch (_) {} return n; });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Anything that fails without its own error handling still gets reported,
  // instead of the button silently doing nothing.
  useEffect(() => {
    const onRej = e => { const m = e?.reason?.message || String(e?.reason || 'Something went wrong'); toast(m, 'error'); };
    window.addEventListener('unhandledrejection', onRej);
    return () => window.removeEventListener('unhandledrejection', onRej);
  }, []);
  // Ctrl/⌘+K jumps to the sidebar search.
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches) setMobileNavOpen(true);
        else if (sidebarHidden) setSidebarHidden(false);
        setTimeout(() => navSearchRef.current?.focus(), 30);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('np_sidebar_hidden') === 'true'; } catch (_) { return false; }
  });

  function toggleNav() {
    if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches) {
      setMobileNavOpen(o => !o);
    } else {
      setSidebarHidden(h => {
        const next = !h;
        try { localStorage.setItem('np_sidebar_hidden', String(next)); } catch (_) {}
        return next;
      });
    }
  }
  const [data, setData] = useState({
    businesses: [], invoices: [], parties: [], expenses: [],
    payments: [], accounts: [], journalEntries: [], journalLines: [],
    creditNotes: [], debitNotes: [], bankAccounts: [], bankTransactions: [], items: [], challans: [],
    invoiceItems: [], bankLinks: [], bankLinksReady: true, bankLinksError: '',
  });
  const [coreLoading, setCoreLoading] = useState(false);   // first load only — blanks the screen
  const [refreshing, setRefreshing] = useState(false);     // later reloads — screen stays up
  const [heavyReady, setHeavyReady] = useState({});
  const heavyRequested = useRef({});
  const coreLoaded = useRef(false);
  // Screens must not render before the first load: several fetch on their own
  // when they mount, and with the screen now restored from the URL (#/audit…)
  // they could mount before the Supabase client existed.
  const [coreReady, setCoreReady] = useState(false);
  const dbConfigured = !!((import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('sb_url')) && (import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('sb_key')));

  // Auto-connect Supabase from env vars
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('sb_url');
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('sb_key');
    if (url && key) {
      const c = createClient(url, key, { db: { schema: 'accounts_erp' } });
      initSupabase(c);
      setClient(c);
      c.auth.getSession().then(({ data }) => {
        if (data?.session) {
          localStorage.setItem('np_auth', 'true');
          setAuthed(true);
        }
      }).catch(() => {});
      const { data: listener } = c.auth.onAuthStateChange((_event, session) => {
        if (session) { localStorage.setItem('np_auth', 'true'); setAuthed(true); }
      });
      return () => listener?.subscription?.unsubscribe();
    }
  }, []);

  const loadGroup = useCallback(async (g) => {
    const part = await loadHeavy(g);
    setData(d => ({ ...d, ...part }));
    setHeavyReady(r => ({ ...r, [g]: true }));
  }, []);

  const ensureGroups = useCallback((groups) => {
    groups.forEach(g => {
      if (heavyRequested.current[g]) return;
      heavyRequested.current[g] = loadGroup(g).catch(e => {
        console.error('Load error:', g, e);
        delete heavyRequested.current[g];
      });
    });
  }, [loadGroup]);

  // Reload = refetch the core tables plus any heavy group already opened. Only the very
  // first load replaces the screen with a spinner; after that the current screen stays
  // mounted and simply updates when the data lands, so saving something doesn't blank the page.
  const reload = useCallback(async () => {
    if (!client) return;
    const first = !coreLoaded.current;
    if (first) setCoreLoading(true); else setRefreshing(true);
    try {
      const [core] = await Promise.all([
        loadCore(),
        ...Object.keys(heavyRequested.current).map(g => loadGroup(g)),
      ]);
      setData(d => ({ ...d, ...core }));
      coreLoaded.current = true;
      const { data: integ, error: integErr } = await client.from('integration_settings').select('ops_business_id').eq('id', 1).maybeSingle();
      setOpsBizId(integErr ? null : (integ?.ops_business_id || null));
    } catch (e) { console.error('Load error:', e); toast(`Couldn't load data: ${e.message || e}`, 'error'); }
    setCoreReady(true);
    if (first) setCoreLoading(false); else setRefreshing(false);
  }, [client, loadGroup]);

  useEffect(() => { if (client && authed) reload(); }, [client, authed, reload]);

  // Link Needle Point with the operations app on its own — no setup screen.
  // Runs once, only when the link isn't set yet and the ops tables are there.
  useEffect(() => {
    if (!client || !authed || opsBizId !== null || autoLinked.current) return;
    const homeNow = pickHomeBusiness(data.businesses, null);
    if (!homeNow) return;
    autoLinked.current = true;
    (async () => {
      const probe = await client.schema('ops').from('brands').select('id', { head: true, count: 'exact' });
      if (probe.error) return;                     // operations app not installed here
      try {
        const r = await setOpsBusiness(homeNow.id);
        toast(r.to_review ? `Linked with the operations app. ${r.to_review} brand${r.to_review === 1 ? '' : 's'} to match in Parties → Brand links` : 'Linked with the operations app', 'success', 6000);
        reload();
      } catch (e) { console.warn('auto-link', e); }
    })();
  }, [client, authed, opsBizId, data.businesses]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewNeeds = VIEW_NEEDS[view] || [];
  useEffect(() => { if (client && authed && viewNeeds.length) ensureGroups(viewNeeds); }, [view, client, authed]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogin() { setAuthed(true); }

  async function handleLogout() {
    try { await client?.auth?.signOut(); } catch (_) {}
    localStorage.removeItem('np_auth');
    setAuthed(false);
  }

  if (!authed) return <><style>{FONTS}{CSS}</style><LoginScreen onLogin={handleLogin} client={client} /></>;

  const home = pickHomeBusiness(data.businesses, opsBizId);
  const activeBiz = home?.id || '';
  const hiddenBusinesses = home ? data.businesses.length - 1 : 0;
  const { businesses, invoices, parties, expenses, payments,
    accounts, journalEntries, journalLines, creditNotes, debitNotes,
    bankAccounts, bankTransactions, items, challans, invoiceItems, bankLinks, bankLinksReady, bankLinksError } = scopeToBusiness(data, home);

  // true while the first load runs, or while this screen's big tables are still being fetched
  const loading = (dbConfigured && !coreReady) || coreLoading || !viewNeeds.every(g => heavyReady[g]);

  const cp = { businesses, activeBiz, reload };

  // Sidebar: search filters across every group; a red count marks overdue invoices.
  const q = navQuery.trim().toLowerCase();
  const navMatch = n => !q || n.label.toLowerCase().includes(q) || (n.group || '').toLowerCase().includes(q) || (n.keys || '').includes(q);
  const overdueCount = (() => {
    const pays = {}, cns = {};
    payments.forEach(p => { (pays[p.invoice_id] ||= []).push(p); });
    creditNotes.forEach(c => { (cns[c.invoice_id] ||= []).push(c); });
    return invoices.filter(i => i.type === 'sale' && (!activeBiz || i.business_id === activeBiz)
      && isOverdue(i, invoiceDue(i, pays[i.id] || [], cns[i.id] || []))).length;
  })();
  const navBtn = n => (
    <button key={n.id} className={`nav-item${view === n.id ? ' active' : ''}`} aria-current={view === n.id ? 'page' : undefined}
      onClick={() => { setView(n.id); setMobileNavOpen(false); setNavQuery(''); }}>
      <span className="icon">{n.icon}</span>{n.label}
      {n.id === 'invoices' && overdueCount > 0 && <span className="nav-count" title={`${overdueCount} overdue`}>{overdueCount}</span>}
    </button>
  );
  const actionFor = v => (pendingAction?.view === v ? pendingAction : null);
  const clearAction = () => setPendingAction(null);

  return (
    <>
      <style>{FONTS}{CSS}{SIDEBAR_CSS}</style>
      <div className={`app${sidebarHidden ? ' sidebar-hidden' : ''}`}>
        {mobileNavOpen && <div className="nav-overlay" onClick={() => setMobileNavOpen(false)} />}
        <aside className={`sidebar${mobileNavOpen ? ' open' : ''}`}>
          <div className="sidebar-logo">
            <h1>Accounts</h1>
            <p>{home?.name || 'Set up your business'}</p>
          </div>
          <div className="nav-search">
            <span className="ico">⌕</span>
            <input ref={navSearchRef} value={navQuery} placeholder="Jump to…" aria-label="Search screens"
              onChange={e => setNavQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && q) { const first = NAV.find(navMatch); if (first) { setView(first.id); setNavQuery(''); setMobileNavOpen(false); e.target.blur(); } }
                if (e.key === 'Escape') { setNavQuery(''); e.target.blur(); }
              }} />
            {!navQuery && <kbd>⌘K</kbd>}
          </div>
          <nav className="nav">
            {NAV.filter(n => !n.group && navMatch(n)).map(navBtn)}
            {GROUPS.map(grp => {
              const items = NAV.filter(n => n.group === grp && navMatch(n));
              if (!items.length) return null;
              // A collapsed group stays open while it holds the current screen or a search is running.
              const collapsed = !q && collapsedGroups[grp] && !items.some(n => n.id === view);
              return (
                <div key={grp}>
                  <button className={`nav-label${collapsed ? ' collapsed' : ''}`} onClick={() => toggleGroup(grp)} aria-expanded={!collapsed}>
                    {grp}<span className="chev">▾</span>
                  </button>
                  {!collapsed && items.map(navBtn)}
                </div>
              );
            })}
            {q && !NAV.some(navMatch) && <div className="hint" style={{ padding: '8px 10px' }}>No screen matches “{navQuery}”</div>}
          </nav>
          <div className="sidebar-foot">
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', fontSize: 11, color: 'var(--text4)' }}
              onClick={handleLogout}>
              ⏏ Logout
            </button>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <button className="hamburger-btn" onClick={toggleNav} aria-label="Toggle menu" title={sidebarHidden ? 'Show menu' : 'Hide menu'}>☰</button>
              <h2>{TITLES[view] || view}</h2>
            </div>
            <div className="topbar-right">
              <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading || refreshing} title="Reload data from the database">
                {loading || refreshing ? 'Loading…' : <>↻ <span>Refresh</span></>}
              </button>
            </div>
          </div>
          <div className="content">
            {!loading && !home && view !== 'businesses' && (
              <div className="info-banner" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ flex: 1 }}>Add Needle Point's details (GSTIN, state, bank) before making invoices.</span>
                <button className="btn btn-sm btn-primary" onClick={() => setView('businesses')}>Set up</button>
              </div>
            )}
            {loading && <div className="loading">Loading data…</div>}

            {!loading && view === 'dashboard' && (
              <Dashboard invoices={invoices} expenses={expenses} payments={payments} creditNotes={creditNotes}
                businesses={businesses} parties={parties} activeBiz={activeBiz} setView={setView} startAction={startAction} />
            )}
            {!loading && (view === 'invoices' || view === 'proformas') && (
              <InvoicesView key={view} invoices={invoices} parties={parties} creditNotes={creditNotes}
                payments={payments} isProforma={view === 'proformas'} catalogItems={items}
                action={actionFor(view)} onActionDone={clearAction} {...cp} />
            )}
            {!loading && view === 'creditnotes' && (
              <CreditNotesView creditNotes={creditNotes} invoices={invoices} parties={parties} {...cp} />
            )}
            {!loading && view === 'debitnotes' && (
              <DebitNotesView debitNotes={debitNotes} invoices={invoices} businesses={businesses} parties={parties} activeBiz={activeBiz} reload={reload} />
            )}
            {!loading && view === 'challans' && (
              <DeliveryChallansView challans={challans} parties={parties} invoices={invoices} {...cp} />
            )}
            {!loading && view === 'production' && (
              <ProductionOrdersView businesses={businesses} parties={parties} invoices={invoices} payments={payments} creditNotes={creditNotes}
                challans={challans} expenses={expenses} catalogItems={items} reload={reload} />
            )}
            {!loading && view === 'payroll' && <PayrollView businesses={businesses} parties={parties} expenses={expenses} reload={reload} />}
            {!loading && view === 'parties' && <PartiesView parties={parties} invoices={invoices} payments={payments} creditNotes={creditNotes} {...cp} />}
            {!loading && view === 'items' && <ItemsView items={items} {...cp} />}
            {!loading && view === 'purchasebills' && (
              <InvoicesView key={view} invoices={invoices} parties={parties} creditNotes={creditNotes}
                payments={payments} purchaseMode={true} catalogItems={items}
                action={actionFor(view)} onActionDone={clearAction} {...cp} />
            )}
            {!loading && view === 'expenses' && <ExpensesView expenses={expenses} parties={parties} accounts={accounts} journalEntries={journalEntries} journalLines={journalLines} invoices={invoices} {...cp} />}
            {!loading && view === 'payments' && (
              <PaymentsView payments={payments} invoices={invoices} parties={parties} journalEntries={journalEntries} journalLines={journalLines} {...cp} />
            )}
            {!loading && view === 'bank' && (
              <BankStatementView bankAccounts={bankAccounts} bankTransactions={bankTransactions} businesses={businesses} payments={payments} parties={parties}
                invoices={invoices} accounts={accounts} journalEntries={journalEntries} bankLinks={bankLinks} bankLinksReady={bankLinksReady} {...cp} />
            )}
            {!loading && view === 'statement' && (
              <PartyStatementView parties={parties} invoices={invoices} payments={payments} creditNotes={creditNotes} debitNotes={debitNotes} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'paylist' && (
              <PaymentListView payments={payments} parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'tds' && (
              <TDSView invoices={invoices} payments={payments} parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'export' && (
              <ExportView invoices={invoices} expenses={expenses} payments={payments} parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'accounts' && <ChartOfAccountsView accounts={accounts} journalLines={journalLines} {...cp} />}
            {!loading && view === 'journal' && (
              <JournalView journalEntries={journalEntries} journalLines={journalLines} accounts={accounts}
                expenses={expenses} payments={payments} {...cp} />
            )}
            {!loading && view === 'analysis' && (
              <AnalysisView journalEntries={journalEntries} journalLines={journalLines} accounts={accounts}
                parties={parties} invoices={invoices} payments={payments} {...cp} />
            )}
            {!loading && view === 'ledger' && (
              <GeneralLedgerView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries} {...cp} />
            )}
            {!loading && view === 'trial' && (
              <TrialBalanceView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries}
                invoices={invoices} payments={payments} expenses={expenses} creditNotes={creditNotes} debitNotes={debitNotes} {...cp} />
            )}
            {!loading && view === 'balance' && (
              <BalanceSheetView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries}
                invoices={invoices} payments={payments} expenses={expenses} {...cp} />
            )}
            {!loading && view === 'gstr1' && (
              <GSTR1View invoices={invoices} parties={parties} businesses={businesses}
                activeBiz={activeBiz} invoiceItems={invoiceItems} payments={payments} creditNotes={creditNotes} debitNotes={debitNotes} />
            )}
            {!loading && view === 'ar' && (
              <ARLedgerView invoices={invoices} payments={payments} creditNotes={creditNotes} debitNotes={debitNotes} setView={setView}
                parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'ap' && (
              <APLedgerView invoices={invoices} expenses={expenses} payments={payments}
                parties={parties} businesses={businesses} activeBiz={activeBiz} debitNotes={debitNotes} />
            )}
            {!loading && view === 'pl' && (
              <PLView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries}
                invoices={invoices} expenses={expenses} payments={payments} creditNotes={creditNotes}
                businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'cashflow' && (
              <CashFlowView journalEntries={journalEntries} journalLines={journalLines}
                accounts={accounts} bankTransactions={bankTransactions} activeBiz={activeBiz} />
            )}
            {!loading && view === 'reconcile' && (
              <ReconciliationView
                bankAccounts={bankAccounts} bankTransactions={bankTransactions}
                journalEntries={journalEntries} journalLines={journalLines}
                payments={payments} invoices={invoices} parties={parties}
                accounts={accounts} activeBiz={activeBiz} reload={reload} />
            )}
            {!loading && view === 'jhealth' && (
              <JournalHealthView
                expenses={expenses} payments={payments} bankTransactions={bankTransactions}
                journalEntries={journalEntries} journalLines={journalLines} invoices={invoices} accounts={accounts}
                bankAccounts={bankAccounts} bankLinks={bankLinks} {...cp} />
            )}
            {!loading && view === 'gstr3b' && <GSTR3BView activeBiz={activeBiz} businesses={businesses} invoices={invoices} creditNotes={creditNotes} reload={reload} />}
            {!loading && view === 'audit' && <AuditTrailView activeBiz={activeBiz} />}
            {!loading && view === 'kpis' && <KPIDashboard activeBiz={activeBiz} invoices={invoices} expenses={expenses} payments={payments} parties={parties} creditNotes={creditNotes} />}
            {!loading && view === 'businesses' && <BusinessProfileView home={home} hiddenCount={hiddenBusinesses} reload={reload} />}
            {!loading && view === 'sqlsetup' && <SqlSetupView invoices={invoices} payments={payments} />}
          </div>
        </div>
      </div>
      <Toaster />
    </>
  );
}
