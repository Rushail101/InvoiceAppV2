import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { FONTS, CSS } from './lib/constants.js';
import { initSupabase, loadAll, saveBusiness, deleteBusiness } from './lib/db.js';
import { InvoicesView } from './views/Invoices.jsx';
import { PartiesView, ExpensesView, PaymentsView, BankView, ARLedgerView, APLedgerView } from './views/Operations.jsx';
import { ChartOfAccountsView, JournalView, TrialBalanceView, BalanceSheetView, PLView } from './views/Accounting.jsx';
import { CreditNotesView } from './views/CreditNotes.jsx';
import { GSTR1View } from './views/GSTR1.jsx';
import { ItemsView } from './views/Items.jsx';
import { Badge, ModalShell, FG, EmptyState } from './components/ui.jsx';

const NAV = [
  { id: 'dashboard',   label: 'Dashboard',        icon: '◈',  group: null },
  { id: 'invoices',    label: 'Invoices',          icon: '📄',  group: 'Sales' },
  { id: 'proformas',   label: 'Proforma',          icon: '📋',  group: 'Sales' },
  { id: 'creditnotes', label: 'Credit Notes',      icon: '↩',   group: 'Sales' },
  { id: 'parties',     label: 'Parties',           icon: '👥',  group: 'Sales' },
  { id: 'items',       label: 'Item Master',       icon: '📦',  group: 'Sales' },
  { id: 'expenses',    label: 'Expenses',          icon: '💸',  group: 'Purchases' },
  { id: 'payments',    label: 'Payments',          icon: '💳',  group: 'Purchases' },
  { id: 'bank',        label: 'Bank',              icon: '🏦',  group: 'Purchases' },
  { id: 'ar',          label: 'AR Ledger',         icon: '🟢',  group: 'Ledgers' },
  { id: 'ap',          label: 'AP Ledger',         icon: '🔴',  group: 'Ledgers' },
  { id: 'accounts',    label: 'Chart of Accounts', icon: '📒',  group: 'Accounting' },
  { id: 'journal',     label: 'Journal Vouchers',  icon: '📝',  group: 'Accounting' },
  { id: 'trial',       label: 'Trial Balance',     icon: '⚖',   group: 'Accounting' },
  { id: 'balance',     label: 'Balance Sheet',     icon: '📊',  group: 'Accounting' },
  { id: 'pl',          label: 'P&L Report',        icon: '📈',  group: 'Accounting' },
  { id: 'gstr1',       label: 'GSTR-1',            icon: '🧾',  group: 'GST' },
  { id: 'businesses',  label: 'Businesses',        icon: '🏢',  group: 'Settings' },
  { id: 'sqlsetup',    label: 'SQL Setup',         icon: '⚙',   group: 'Settings' },
];
const TITLES = Object.fromEntries(NAV.map(n => [n.id, n.label]));
const GROUPS = [...new Set(NAV.filter(n => n.group).map(n => n.group))];

const STATES = [
  'Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar',
  'Chandigarh','Chhattisgarh','Dadra and Nagar Haveli','Daman and Diu','Delhi','Goa',
  'Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka',
  'Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
  'Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu',
  'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
];

// ─── CONFIG SCREEN ────────────────────────────────────────────────────────────
function ConfigScreen({ onConnect }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!url.trim() || !key.trim()) { setErr('Both fields required'); return; }
    setBusy(true); setErr('');
    try {
      const c = createClient(url.trim(), key.trim());
      const { error } = await c.from('businesses').select('id').limit(1);
      if (error) throw error;
      localStorage.setItem('sb_url', url.trim());
      localStorage.setItem('sb_key', key.trim());
      onConnect(c);
    } catch (e) {
      setErr(e.message || 'Connection failed — check URL, key and that you have run the SQL schema.');
    }
    setBusy(false);
  }

  return (
    <div className="config-wrap">
      <div className="config-screen">
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚡</div>
        <h2>Connect Supabase</h2>
        <p>Enter your project URL and anon key.<br />First time? Connect first, then go to <strong style={{ color: 'var(--text)' }}>Settings → SQL Setup</strong> to create the tables.</p>
        <div className="config-form">
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Project URL</label>
            <input placeholder="https://xxxx.supabase.co" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && connect()} />
          </div>
          <div className="form-group" style={{ marginBottom: 18 }}>
            <label>Anon Key</label>
            <input placeholder="eyJhbGci…" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && connect()} />
          </div>
          {err && <p className="err-msg" style={{ marginBottom: 10 }}>{err}</p>}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect & Enter'}
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

// ─── BUSINESSES VIEW ──────────────────────────────────────────────────────────
function BusinessesView({ businesses, reload }) {
  const [modal, setModal] = useState(false);
  const [editBiz, setEditBiz] = useState(null);

  async function handleSave(data, id) { await saveBusiness(data, id); reload(); }
  async function handleDelete(id) {
    if (!confirm('Delete this business and ALL its data? Cannot be undone.')) return;
    await deleteBusiness(id); reload();
  }

  return (
    <>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => { setEditBiz(null); setModal(true); }}>+ Add Business</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Home State</th><th>GSTIN</th><th>Phone</th><th>UPI</th><th>Actions</th></tr></thead>
          <tbody>
            {businesses.map(b => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600 }}>{b.name}</td>
                <td style={{ fontSize: 11 }}>
                  {b.state || <span style={{ color: 'var(--red)', fontSize: 10, fontFamily: 'var(--mono)' }}>⚠ Not set — GST split disabled</span>}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>{b.gstin || '—'}</td>
                <td style={{ fontSize: 12 }}>{b.phone || '—'}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{b.upi_id || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditBiz(b); setModal(true); }}>⚙ Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(b.id)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
            {businesses.length === 0 && (
              <tr><td colSpan={6}><EmptyState icon="🏢" message="No businesses yet" sub='Click "+ Add Business" to get started' /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {modal && <BizModal biz={editBiz} onClose={() => setModal(false)} onSave={handleSave} />}
    </>
  );
}

// ─── SQL SETUP ────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `-- ═══════════════════════════════════════════════════════════
-- Accounts ERP — Full Schema + Migration
-- Run this in Supabase SQL Editor (safe to re-run — uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- ── STEP 1: Core tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS businesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  address      text,
  gstin        text,
  state        text,
  phone        text,
  email        text,
  bank_account text,
  ifsc_code    text,
  bank_name    text,
  upi_id       text,
  logo_url     text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'client',
  phone       text,
  email       text,
  gstin       text,
  address     text,
  state       text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text,
  hsn_code       text,
  unit           text DEFAULT 'Pcs',
  sale_price     numeric(12,2) DEFAULT 0,
  purchase_price numeric(12,2) DEFAULT 0,
  tax_percent    numeric(5,2)  DEFAULT 5,
  description    text,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid REFERENCES businesses(id) ON DELETE CASCADE,
  party_id         uuid REFERENCES parties(id) ON DELETE SET NULL,
  invoice_number   text NOT NULL,
  type             text NOT NULL DEFAULT 'sale',
  status           text NOT NULL DEFAULT 'draft',
  issue_date       date,
  due_date         date,
  notes            text,
  discount_percent numeric(5,2)  DEFAULT 0,
  discount_amount  numeric(12,2) DEFAULT 0,
  subtotal         numeric(12,2) DEFAULT 0,
  cgst_amount      numeric(12,2) DEFAULT 0,
  sgst_amount      numeric(12,2) DEFAULT 0,
  igst_amount      numeric(12,2) DEFAULT 0,
  tax_amount       numeric(12,2) DEFAULT 0,
  total            numeric(12,2) DEFAULT 0,
  is_interstate    boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid REFERENCES invoices(id) ON DELETE CASCADE,
  description      text,
  hsn_code         text,
  quantity         numeric(10,2) DEFAULT 1,
  unit_price       numeric(12,2) DEFAULT 0,
  discount_percent numeric(5,2)  DEFAULT 0,
  taxable_amount   numeric(12,2) DEFAULT 0,
  tax_percent      numeric(5,2)  DEFAULT 0,
  cgst_amount      numeric(12,2) DEFAULT 0,
  sgst_amount      numeric(12,2) DEFAULT 0,
  igst_amount      numeric(12,2) DEFAULT 0,
  amount           numeric(12,2) DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id   uuid REFERENCES invoices(id) ON DELETE CASCADE,
  party_id     uuid REFERENCES parties(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL,
  payment_date date NOT NULL,
  method       text,
  reference    text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_id    uuid REFERENCES parties(id) ON DELETE SET NULL,
  category     text NOT NULL,
  description  text,
  amount       numeric(12,2) NOT NULL,
  expense_date date NOT NULL,
  method       text,
  reference    text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  "group"     text NOT NULL,
  sub_group   text,
  description text,
  is_system   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(business_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  entry_date  date NOT NULL,
  reference   text,
  description text NOT NULL,
  narration   text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  type       text NOT NULL,
  amount     numeric(12,2) NOT NULL,
  narration  text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id  uuid REFERENCES invoices(id) ON DELETE SET NULL,
  party_id    uuid REFERENCES parties(id) ON DELETE SET NULL,
  cn_number   text NOT NULL,
  cn_date     date NOT NULL,
  reason      text,
  subtotal    numeric(12,2) DEFAULT 0,
  tax_amount  numeric(12,2) DEFAULT 0,
  total       numeric(12,2) DEFAULT 0,
  status      text DEFAULT 'active',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid REFERENCES credit_notes(id) ON DELETE CASCADE,
  description    text,
  hsn_code       text,
  quantity       numeric(10,2) DEFAULT 1,
  unit_price     numeric(12,2) DEFAULT 0,
  tax_percent    numeric(5,2)  DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  tax_amount     numeric(12,2) DEFAULT 0,
  amount         numeric(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name            text NOT NULL,
  account_number  text,
  ifsc_code       text,
  bank_name       text,
  opening_balance numeric(12,2) DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE CASCADE,
  txn_date        date NOT NULL,
  description     text,
  amount          numeric(12,2) NOT NULL,
  type            text,
  reference       text,
  is_reconciled   boolean DEFAULT false,
  payment_id      uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

-- ── STEP 2: Migration — add missing columns to existing tables ─────────────────
-- Safe to run on both new and old databases

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS state text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2)  DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount  numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS igst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_interstate    boolean DEFAULT true;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2)  DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable_amount   numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS igst_amount      numeric(12,2) DEFAULT 0;

-- ── STEP 3: Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_party    ON invoices(party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_items_inv     ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_biz      ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_biz      ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_parties_biz       ON parties(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_biz      ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_jlines_journal    ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account    ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_cn_invoice        ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_items_biz         ON items(business_id);

-- ── STEP 4: Seed your first business (edit values, then uncomment & run) ───────

-- INSERT INTO businesses (name, gstin, state, phone, email, address, bank_account, ifsc_code, bank_name, upi_id)
-- VALUES ('Needle Point','07AAXFN6403D1Z5','Delhi','9988998727','rushailharjai10@gmail.com',
--   'C-157, 3rd Floor, Mayapuri Industrial Area, Phase 2, New Delhi 110064',
--   '181805001556','ICIC0001818','ICICI Bank Ltd, WH-9 Mayapuri Phase 1, 110064',
--   'needlepoint.ibz@icici');`

function SqlSetupView() {
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(SCHEMA_SQL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">First-time Setup</div>
        <ol style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 2.2, paddingLeft: 20 }}>
          <li>Go to <strong style={{ color: 'var(--text)' }}>Supabase → SQL Editor</strong> → paste the SQL below → Run</li>
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
            <div style={{ fontSize: 8, color: 'var(--text4)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ invoices, expenses, payments, businesses, parties, activeBiz, setView }) {
  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;
  const be = activeBiz ? expenses.filter(e => e.business_id === activeBiz) : expenses;

  const fmtN = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtM = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  // Invoiced revenue (accrual) — excludes proforma/draft/cancelled
  const saleInvs = bi.filter(i => i.type === 'sale' && !['cancelled','proforma','draft'].includes(i.status));
  // All active sale invoices including proforma — for cash tracking
  const allSaleInvs = bi.filter(i => i.type === 'sale' && !['cancelled','draft'].includes(i.status));

  const revenue = saleInvs.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  // Collected = all cash received including advances against proformas
  const collected = allSaleInvs.reduce((s, i) => s + (paysByInv[i.id]||[]).reduce((ps,p)=>ps+Number(p.amount),0), 0);
  const pending = allSaleInvs.filter(i => ['sent','partially_paid','proforma'].includes(i.status)).reduce((s,i)=>{
    const paid = (paysByInv[i.id]||[]).reduce((ps,p)=>ps+Number(p.amount),0);
    return s + Math.max(0, Number(i.total) - paid);
  }, 0);
  const overdue = saleInvs.filter(i => i.status === 'overdue').reduce((s,i)=>s+Number(i.total),0);
  const totalExp = be.reduce((s, e) => s + Number(e.amount), 0);
  const overdueInvs = bi.filter(i => i.due_date && new Date(i.due_date) < new Date() && !['paid','cancelled','proforma'].includes(i.status));

  // Monthly revenue — last 6 months (cash basis — what was actually received)
  const monthlyData = (() => {
    const months = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(); d.setMonth(d.getMonth() - m);
      const yr = d.getFullYear(); const mo = d.getMonth();
      const label = d.toLocaleDateString('en-IN', { month: 'short' });
      // Use payments received in that month rather than invoice date
      const value = payments
        .filter(p => {
          const pd = new Date(p.payment_date);
          return pd.getFullYear()===yr && pd.getMonth()===mo
            && allSaleInvs.some(i => i.id === p.invoice_id);
        })
        .reduce((s,p) => s + Number(p.amount||0), 0);
      months.push({ label, value });
    }
    return months;
  })();

  // Top 5 clients by revenue (include proforma payments)
  const clientRevenue = {};
  allSaleInvs.forEach(i => {
    const p = parties.find(pt => pt.id === i.party_id);
    const paid = (paysByInv[i.id]||[]).reduce((ps,p)=>ps+Number(p.amount),0);
    if (p && paid > 0) clientRevenue[p.name] = (clientRevenue[p.name] || 0) + paid;
    else if (p && i.status !== 'proforma') clientRevenue[p.name] = (clientRevenue[p.name] || 0) + Number(i.subtotal || 0);
  });
  const top5 = Object.entries(clientRevenue).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxClient = top5[0]?.[1] || 1;

  const missingState = businesses.some(b => !b.state);

  return (
    <>
      {missingState && (
        <div style={{ background: '#1a1000', border: '1px solid #3a2800', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--amber)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ Some businesses are missing <strong>Home State</strong> — CGST/SGST auto-split is disabled for those businesses.</span>
          <button className="btn btn-warning btn-sm" style={{ marginLeft: 12, flexShrink: 0 }} onClick={() => setView('businesses')}>Fix Now →</button>
        </div>
      )}

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <div className="stat-card green"><div className="stat-label">Revenue (Taxable)</div><div className="stat-val green">{fmtN(revenue)}</div><div className="stat-sub">{saleInvs.length} invoices</div></div>
        <div className="stat-card blue"><div className="stat-label">Collected</div><div className="stat-val blue">{fmtN(collected)}</div><div className="stat-sub">cash received</div></div>
        <div className="stat-card amber"><div className="stat-label">Outstanding</div><div className="stat-val amber">{fmtN(pending)}</div><div className="stat-sub">pending payment</div></div>
        <div className="stat-card red"><div className="stat-label">Overdue</div><div className="stat-val red">{fmtN(overdue)}</div><div className="stat-sub">{overdueInvs.length} invoice(s)</div></div>
        <div className="stat-card purple"><div className="stat-label">Expenses</div><div className="stat-val purple">{fmtN(totalExp)}</div><div className="stat-sub">all categories</div></div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div className="card">
          <div className="card-head">Monthly Revenue (last 6 months)</div>
          <MiniBarChart data={monthlyData} color="var(--accent)" label="₹ taxable value" />
        </div>
        <div className="card">
          <div className="card-head">Top Clients by Revenue</div>
          {top5.length > 0 ? (
            <div>
              {top5.map(([name, val]) => (
                <div key={name} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{name}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)', fontSize: 11 }}>{fmtN(val)}</span>
                  </div>
                  <div style={{ background: 'var(--bg3)', borderRadius: 3, height: 5 }}>
                    <div style={{ background: 'var(--accent)', borderRadius: 3, height: 5, width: `${(val/maxClient)*100}%`, transition: 'width .3s' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 0' }}>No data yet</div>}
        </div>
      </div>

      {overdueInvs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
            Overdue ({overdueInvs.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice #</th><th>Party</th><th>Due Date</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {overdueInvs.slice(0, 5).map(inv => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ color: 'var(--accent)' }}>{inv.invoice_number}</td>
                    <td style={{ fontWeight: 500 }}>{parties.find(p => p.id === inv.party_id)?.name || '—'}</td>
                    <td className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>{fmtD(inv.due_date)}</td>
                    <td className="r mono" style={{ color: 'var(--red)' }}>{fmtM(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-toolbar"><h3>Recent Invoices</h3></div>
        <table>
          <thead><tr><th>Invoice #</th><th>Party</th><th>Date</th><th className="r">Total</th><th>GST</th><th>Status</th></tr></thead>
          <tbody>
            {bi.slice(0, 10).map(inv => {
              const gstMode = inv.is_interstate === false ? 'intra' : 'inter';
              return (
                <tr key={inv.id}>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{inv.invoice_number}</td>
                  <td style={{ fontWeight: 500 }}>{parties.find(p => p.id === inv.party_id)?.name || '—'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtD(inv.issue_date)}</td>
                  <td className="r mono">{fmtM(inv.total)}</td>
                  <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S GST' : 'IGST'}</span></td>
                  <td><Badge status={inv.status} /></td>
                </tr>
              );
            })}
            {bi.length === 0 && <tr><td colSpan={6}><EmptyState icon="📄" message="No invoices yet" sub='Go to Sales → Invoices to create your first invoice' /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [client, setClient] = useState(null);
  const [view, setView] = useState('dashboard');
  const [activeBiz, setActiveBiz] = useState('');
  const [data, setData] = useState({
    businesses: [], invoices: [], parties: [], expenses: [],
    payments: [], accounts: [], journalEntries: [], journalLines: [],
    creditNotes: [], bankAccounts: [], bankTransactions: [], items: [],
  });
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = localStorage.getItem('sb_url');
    const key = localStorage.getItem('sb_key');
    if (url && key) {
      const c = createClient(url, key);
      initSupabase(c);
      setClient(c);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const d = await loadAll();
      setData(d);
      const { data: items } = await client.from('invoice_items').select('*');
      setInvoiceItems(items || []);
    } catch (e) { console.error('Load error:', e); }
    setLoading(false);
  }, [client]);

  useEffect(() => { if (client) reload(); }, [client, reload]);

  function handleConnect(c) { initSupabase(c); setClient(c); }

  if (!client) return <><style>{FONTS}{CSS}</style><ConfigScreen onConnect={handleConnect} /></>;

  const { businesses, invoices, parties, expenses, payments,
    accounts, journalEntries, journalLines, creditNotes,
    bankAccounts, bankTransactions, items } = data;

  const cp = { businesses, activeBiz, reload };

  return (
    <>
      <style>{FONTS}{CSS}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <h1>Accounts</h1>
            <p>{businesses.find(b => b.id === activeBiz)?.name || 'All Businesses'}</p>
          </div>
          <div className="sidebar-biz">
            <label>Business</label>
            <select className="biz-select" value={activeBiz} onChange={e => setActiveBiz(e.target.value)}>
              <option value="">All Businesses</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <nav className="nav">
            {NAV.filter(n => !n.group).map(n => (
              <button key={n.id} className={`nav-item${view === n.id ? ' active' : ''}`} onClick={() => setView(n.id)}>
                <span className="icon">{n.icon}</span>{n.label}
              </button>
            ))}
            {GROUPS.map(grp => (
              <div key={grp}>
                <div className="nav-label">{grp}</div>
                {NAV.filter(n => n.group === grp).map(n => (
                  <button key={n.id} className={`nav-item${view === n.id ? ' active' : ''}`} onClick={() => setView(n.id)}>
                    <span className="icon">{n.icon}</span>{n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', fontSize: 11, color: 'var(--text4)' }}
              onClick={() => { localStorage.clear(); setClient(null); }}>
              ⏏ Disconnect
            </button>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <h2>{TITLES[view] || view}</h2>
            <div className="topbar-right">
              <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
                {loading ? 'Loading…' : '↻ Refresh'}
              </button>
            </div>
          </div>
          <div className="content">
            {loading && <div className="loading">Loading data…</div>}

            {!loading && view === 'dashboard' && (
              <Dashboard invoices={invoices} expenses={expenses} payments={payments}
                businesses={businesses} parties={parties} activeBiz={activeBiz} setView={setView} />
            )}
            {!loading && (view === 'invoices' || view === 'proformas') && (
              <InvoicesView invoices={invoices} parties={parties} creditNotes={creditNotes}
                payments={payments} isProforma={view === 'proformas'} catalogItems={items} {...cp} />
            )}
            {!loading && view === 'creditnotes' && (
              <CreditNotesView creditNotes={creditNotes} invoices={invoices} parties={parties} {...cp} />
            )}
            {!loading && view === 'parties' && <PartiesView parties={parties} {...cp} />}
            {!loading && view === 'expenses' && <ExpensesView expenses={expenses} parties={parties} {...cp} />}
            {!loading && view === 'payments' && (
              <PaymentsView payments={payments} invoices={invoices} parties={parties} {...cp} />
            )}
            {!loading && view === 'bank' && (
              <BankView bankAccounts={bankAccounts} bankTransactions={bankTransactions} payments={payments} {...cp} />
            )}
            {!loading && view === 'accounts' && <ChartOfAccountsView accounts={accounts} {...cp} />}
            {!loading && view === 'journal' && (
              <JournalView journalEntries={journalEntries} journalLines={journalLines} accounts={accounts} {...cp} />
            )}
            {!loading && view === 'trial' && (
              <TrialBalanceView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries}
                invoices={invoices} payments={payments} expenses={expenses} creditNotes={creditNotes} {...cp} />
            )}
            {!loading && view === 'balance' && (
              <BalanceSheetView accounts={accounts} journalLines={journalLines} journalEntries={journalEntries}
                invoices={invoices} payments={payments} expenses={expenses} {...cp} />
            )}
            {!loading && view === 'gstr1' && (
              <GSTR1View invoices={invoices} parties={parties} businesses={businesses}
                activeBiz={activeBiz} invoiceItems={invoiceItems} />
            )}
            {!loading && view === 'ar' && (
              <ARLedgerView invoices={invoices} payments={payments} creditNotes={creditNotes}
                parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'ap' && (
              <APLedgerView invoices={invoices} expenses={expenses} payments={payments}
                parties={parties} businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'items' && (
              <ItemsView items={items} businesses={businesses} activeBiz={activeBiz} reload={reload} />
            )}
            {!loading && view === 'pl' && (
              <PLView invoices={invoices} expenses={expenses} payments={payments}
                businesses={businesses} activeBiz={activeBiz} />
            )}
            {!loading && view === 'businesses' && <BusinessesView businesses={businesses} reload={reload} />}
            {!loading && view === 'sqlsetup' && <SqlSetupView />}
          </div>
        </div>
      </div>
    </>
  );
}
