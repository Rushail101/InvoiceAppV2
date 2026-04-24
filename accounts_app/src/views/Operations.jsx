import { useState, useMemo } from 'react';
import { fmt, fmtDate, today, PAY_MODES, INDIAN_STATES, STATE_CODES, EXPENSE_CATEGORIES } from '../lib/constants.js';
import { saveParty, deleteParty, saveExpense, saveExpenseWithJournal, backfillExpenseJournals, repairOrphanedExpenses, deleteExpense, savePayment, saveBankAccount, saveBankTxn, deleteBankTxn, deletePayment, updateInvoiceStatus, saveInvoice } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState, StatCard, PillTabs } from '../components/ui.jsx';

// ─── PARTIES VIEW ─────────────────────────────────────────────────────────────
export function PartiesView({ parties, businesses, activeBiz, reload }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState(null);

  const filtered = parties.filter(p => {
    const biz = activeBiz ? p.business_id === activeBiz : true;
    const t = typeFilter ? p.type === typeFilter : true;
    const q = search.toLowerCase();
    return biz && t && (!q || p.name.toLowerCase().includes(q) || (p.gstin || '').toLowerCase().includes(q));
  });

  async function save(data, id) { await saveParty(data, id); reload(); }
  async function del(id) { if (!confirm('Delete?')) return; await deleteParty(id); reload(); }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search name, GSTIN…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option><option value="client">Clients</option><option value="vendor">Vendors</option>
        </select>
        <button className="btn btn-primary" onClick={() => { setEditData(null); setShowModal(true); }}>+ Add Party</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>State</th><th>GSTIN</th><th>Business</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><Badge status={p.type} /></td>
                <td className="mono" style={{ fontSize: 11 }}>{p.phone || '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{p.state || '—'}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{p.gstin || '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text3)' }}>{businesses.find(b => b.id === p.business_id)?.name || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditData(p); setShowModal(true); }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(p.id)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7}><EmptyState icon="👥" message="No parties found" /></td></tr>}
          </tbody>
        </table>
      </div>
      {showModal && <PartyModal onClose={() => setShowModal(false)} onSave={save} businesses={businesses} editData={editData} />}
    </>
  );
}

function PartyModal({ onClose, onSave, businesses, editData }) {
  const [f, setF] = useState({
    business_id: editData?.business_id || businesses[0]?.id || '',
    name: editData?.name || '', type: editData?.type || 'client',
    phone: editData?.phone || '', email: editData?.email || '',
    gstin: editData?.gstin || '', state: editData?.state || '', pan: editData?.pan || '',
    address: editData?.address || '',
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) return;
    setBusy(true); await onSave(f, editData?.id); setBusy(false); onClose();
  }
  return (
    <ModalShell title={editData ? 'Edit Party' : 'Add Party'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="Type"><select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}><option value="client">Client</option><option value="vendor">Vendor</option></select></FG>
      </div>
      <div className="form-row"><FG label="Name *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></FG></div>
      <div className="form-row cols-2">
        <FG label="Phone"><input value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} /></FG>
        <FG label="Email"><input value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="GSTIN"><input value={f.gstin} onChange={e => setF(x => ({ ...x, gstin: e.target.value.toUpperCase() }))} /></FG>
        <FG label="PAN"><input value={f.pan} onChange={e => setF(x => ({ ...x, pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" /></FG>
        <FG label="State (Place of Supply)"><select value={f.state} onChange={e => setF(x => ({ ...x, state: e.target.value }))}><option value="">Select…</option>{INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select></FG>
      </div>
      <FG label="Address"><textarea value={f.address} onChange={e => setF(x => ({ ...x, address: e.target.value }))} /></FG>
    </ModalShell>
  );
}

// ─── AR LEDGER ────────────────────────────────────────────────────────────────
export function ARLedgerView({ invoices, payments, creditNotes, parties, businesses, activeBiz }) {
  const [selectedParty, setSelectedParty] = useState('');
  const [agingTab, setAgingTab] = useState('ledger');

  const clients = parties.filter(p => p.type === 'client' && (activeBiz ? p.business_id === activeBiz : true));
  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const clientSummaries = clients.map(c => {
    const cInvs = invoices.filter(i => i.party_id === c.id && i.type === 'sale' && i.status !== 'proforma');
    const totalBilled = cInvs.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = cInvs.reduce((s, i) => (paysByInv[i.id] || []).reduce((ps, p) => ps + Number(p.amount), 0) + s, 0);
    const balance = totalBilled - totalPaid;
    const cCNs = creditNotes.filter(cn => cn.party_id === c.id);
    const cnTotal = cCNs.reduce((s, cn) => s + Number(cn.total), 0);
    const netBalance = balance - cnTotal;
    // Aging
    const now = new Date();
    let aging0 = 0, aging30 = 0, aging60 = 0, aging90 = 0;
    cInvs.filter(i => !['paid', 'cancelled'].includes(i.status)).forEach(i => {
      const paid = (paysByInv[i.id] || []).reduce((s, p) => s + Number(p.amount), 0);
      const bal = Number(i.total) - paid;
      if (bal <= 0) return;
      const days = i.due_date ? Math.floor((now - new Date(i.due_date)) / 86400000) : 0;
      if (days <= 0) aging0 += bal;
      else if (days <= 30) aging30 += bal;
      else if (days <= 60) aging60 += bal;
      else aging90 += bal;
    });
    return { ...c, totalBilled, totalPaid, balance, cnTotal, netBalance, aging0, aging30, aging60, aging90 };
  });

  const grandBalance = clientSummaries.reduce((s, c) => s + c.netBalance, 0);
  const selectedData = selectedParty ? clientSummaries.find(c => c.id === selectedParty) : null;
  const selectedInvs = selectedParty ? invoices.filter(i => i.party_id === selectedParty && i.type === 'sale' && i.status !== 'proforma') : [];

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard label="Total Receivable" value={fmt(grandBalance)} color="amber" sub={`${clients.length} clients`} />
        <StatCard label="Overdue (>30d)" value={fmt(clientSummaries.reduce((s, c) => s + c.aging30 + c.aging60 + c.aging90, 0))} color="red" sub="past due date" />
        <StatCard label="Current (not due)" value={fmt(clientSummaries.reduce((s, c) => s + c.aging0, 0))} color="green" sub="within terms" />
      </div>

      <div className="two-col" style={{ alignItems: 'flex-start' }}>
        <div className="table-wrap">
          <div className="table-toolbar"><h3>Client Balances</h3></div>
          <table>
            <thead><tr><th>Client</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {clientSummaries.filter(c => c.totalBilled > 0 || c.netBalance !== 0).map(c => (
                <tr key={c.id} style={{ cursor: 'pointer', background: selectedParty === c.id ? 'var(--bg3)' : '' }} onClick={() => setSelectedParty(selectedParty === c.id ? '' : c.id)}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td className="r mono" style={{ fontSize: 11 }}>{fmt(c.totalBilled)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--green)' }}>{fmt(c.totalPaid)}</td>
                  <td className="r mono" style={{ fontSize: 12, fontWeight: 600, color: c.netBalance > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt(c.netBalance)}</td>
                </tr>
              ))}
              {clientSummaries.filter(c => c.totalBilled > 0).length === 0 && <tr><td colSpan={4}><EmptyState icon="🧾" message="No receivable data" /></td></tr>}
            </tbody>
          </table>
        </div>

        {selectedData && (
          <div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">{selectedData.name} — Statement</div>
              {selectedInvs.map(inv => {
                const paid = (paysByInv[inv.id] || []).reduce((s, p) => s + Number(p.amount), 0);
                const bal = Number(inv.total) - paid;
                return (
                  <div key={inv.id} className="ledger-row">
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 12 }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{fmtDate(inv.issue_date)} · Due {fmtDate(inv.due_date)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{fmt(inv.total)}</div>
                      {paid > 0 && <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>-{fmt(paid)}</div>}
                      <div style={{ fontSize: 11, fontWeight: 600, color: bal > 0.01 ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--mono)' }}>{bal > 0.01 ? fmt(bal) : '✓ Paid'}</div>
                    </div>
                  </div>
                );
              })}
              <div className="ledger-row total">
                <span>Net Balance Due</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmt(selectedData.netBalance)}</span>
              </div>
            </div>
            {/* Aging */}
            <div className="card">
              <div className="card-head">Aging Analysis</div>
              {[['Not due', selectedData.aging0, 'var(--green)'], ['1-30 days', selectedData.aging30, 'var(--amber)'], ['31-60 days', selectedData.aging60, 'var(--red)'], ['60+ days', selectedData.aging90, 'var(--red)']].map(([lbl, val, clr]) => (
                <div key={lbl} className="ledger-row">
                  <span style={{ fontSize: 12 }}>{lbl}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: val > 0 ? clr : 'var(--text3)' }}>{val > 0 ? fmt(val) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AP LEDGER ────────────────────────────────────────────────────────────────
export function APLedgerView({ invoices, expenses, payments, parties, businesses, activeBiz }) {
  const vendors = parties.filter(p => p.type === 'vendor' && (activeBiz ? p.business_id === activeBiz : true));

  const vendorSummaries = vendors.map(v => {
    const vInvs = invoices.filter(i => i.party_id === v.id && i.type === 'purchase');
    const vExps = expenses.filter(e => e.vendor_id === v.id);
    const totalBilled = vInvs.reduce((s, i) => s + Number(i.total), 0);
    const totalExpenses = vExps.reduce((s, e) => s + Number(e.amount), 0);
    const totalOwed = totalBilled + totalExpenses;
    return { ...v, totalBilled, totalExpenses, totalOwed };
  });

  const grandOwed = vendorSummaries.reduce((s, v) => s + v.totalOwed, 0);

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard label="Total Payable" value={fmt(grandOwed)} color="red" sub={`${vendors.length} vendors`} />
        <StatCard label="Purchase Bills" value={fmt(vendorSummaries.reduce((s, v) => s + v.totalBilled, 0))} color="blue" />
        <StatCard label="Direct Expenses" value={fmt(vendorSummaries.reduce((s, v) => s + v.totalExpenses, 0))} color="amber" />
      </div>
      <div className="table-wrap">
        <div className="table-toolbar"><h3>Vendor Balances</h3></div>
        <table>
          <thead><tr><th>Vendor</th><th className="r">Purchase Bills</th><th className="r">Direct Expenses</th><th className="r">Total Owed</th></tr></thead>
          <tbody>
            {vendorSummaries.filter(v => v.totalOwed > 0).map(v => (
              <tr key={v.id}>
                <td style={{ fontWeight: 500 }}>{v.name}</td>
                <td className="r mono" style={{ fontSize: 11 }}>{fmt(v.totalBilled)}</td>
                <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmt(v.totalExpenses)}</td>
                <td className="r mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>{fmt(v.totalOwed)}</td>
              </tr>
            ))}
            {vendorSummaries.filter(v => v.totalOwed > 0).length === 0 && <tr><td colSpan={4}><EmptyState icon="🏪" message="No payables data" sub="Add vendors and purchase bills to see AP ledger" /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
export function ExpensesView({ expenses, businesses, parties, activeBiz, reload, accounts, journalEntries }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const filtered = expenses.filter(e => {
    const biz = activeBiz ? e.business_id === activeBiz : true;
    const q = search.toLowerCase();
    return biz && (!q || e.category.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
  });

  const [saveErr, setSaveErr] = useState('');
  async function save(data) {
    setSaveErr('');
    try { await saveExpenseWithJournal(data); reload(); }
    catch (e) { setSaveErr(e.message || 'Failed to save expense'); }
  }
  async function del(id) { if (!confirm('Delete?')) return; await deleteExpense(id); reload(); }

  async function backfill() {
    const bizId = activeBiz || businesses[0]?.id;
    if (!bizId) { alert('Select a business first'); return; }
    if (!confirm('This will post journal entries for all expenses that do not have one yet. Continue?')) return;
    setBackfilling(true);
    const result = await backfillExpenseJournals(bizId);
    setBackfilling(false);
    reload();
    if (result.reason === 'no_accounts') {
      alert('⚠️ No Chart of Accounts found.\n\nGo to Accounting → Chart of Accounts → click "Seed Default Accounts" first, then try again.');
    } else if (result.reason === 'no_cash_account') {
      alert('⚠️ Could not find a Bank Account or Cash account.\n\nMake sure your Chart of Accounts is seeded and includes a "Bank Account" or "Cash in Hand" account.');
    } else if (result.count > 0) {
      alert(`✅ Posted ${result.count} journal entries.${result.skipped > 0 ? `\n${result.skipped} already had entries and were skipped.` : ''}`);
    } else {
      alert(`All ${result.skipped} expenses already have journal entries.\n\nIf you expect missing journals, use "🔧 Repair & Post" to fix stale data.`);
    }
  }

  async function repair() {
    const bizId = activeBiz || businesses[0]?.id;
    if (!bizId) { alert('Select a business first'); return; }
    if (!confirm('This will find expenses marked as posted but missing journal entries, reset them, and re-post. Continue?')) return;
    setRepairing(true);
    const repairResult = await repairOrphanedExpenses(bizId);
    if (repairResult.repaired === 0) {
      setRepairing(false);
      alert('No orphaned expenses found — all flagged expenses have valid journal entries.');
      return;
    }
    const backfillResult = await backfillExpenseJournals(bizId);
    setRepairing(false);
    reload();
    alert(`🔧 Repaired ${repairResult.repaired} orphaned expense(s).\n✅ Posted ${backfillResult.count} new journal entries.`);
  }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search category, description…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={backfill} disabled={backfilling} title="Post journal entries for all existing expenses that don't have one yet">
          {backfilling ? 'Posting…' : '⟳ Post All to Journal'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={repair} disabled={repairing} title="Find expenses with stale journal_posted flag and re-post their journals">
          {repairing ? 'Repairing…' : '🔧 Repair & Post'}
        </button>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Expense</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Method</th><th>Ref</th><th className="r">Amount</th><th>Journal</th><th></th></tr></thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 11 }}>{fmtDate(e.expense_date)}</td>
                <td style={{ fontSize: 12 }}>{e.category}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.description || '—'}</td>
                <td style={{ fontSize: 12 }}>{parties.find(p => p.id === e.vendor_id)?.name || '—'}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{e.method}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{e.reference || '—'}</td>
                <td className="r mono" style={{ color: 'var(--red)' }}>{fmt(e.amount)}</td>
                <td style={{ textAlign: 'center' }}>
                  {e.journal_posted
                    ? <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>✓</span>
                    : <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)' }}>—</span>}
                </td>
                <td><button className="btn btn-danger btn-sm" onClick={() => del(e.id)}>Del</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={9}><EmptyState icon="💸" message="No expenses" /></td></tr>}
          </tbody>
        </table>
      </div>
      {saveErr && <p className="err-msg" style={{ marginBottom: 8 }}>{saveErr}</p>}
      {showModal && <ExpenseModal onClose={() => setShowModal(false)} onSave={save} businesses={businesses} parties={parties} activeBiz={activeBiz} />}
    </>
  );
}

function ExpenseModal({ onClose, onSave, businesses, parties, activeBiz }) {
  const [f, setF] = useState({ business_id: activeBiz || businesses[0]?.id || '', category: '', description: '', amount: '', expense_date: today(), vendor_id: '', method: 'UPI', reference: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const vendors = parties.filter(p => p.type === 'vendor' && p.business_id === f.business_id);
  async function save() {
    if (!f.category) { setErr('Category is required'); return; }
    if (!f.amount || Number(f.amount) <= 0) { setErr('Enter a valid amount'); return; }
    setBusy(true); setErr('');
    try { await onSave(f); onClose(); }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Expense" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value, vendor_id: '' }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="Category *"><select value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))}><option value="">Select…</option>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Amount (₹) *"><input type="number" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></FG>
        <FG label="Date *"><input type="date" value={f.expense_date} onChange={e => setF(x => ({ ...x, expense_date: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Vendor"><select value={f.vendor_id} onChange={e => setF(x => ({ ...x, vendor_id: e.target.value }))}><option value="">None</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></FG>
        <FG label="Method"><select value={f.method} onChange={e => setF(x => ({ ...x, method: e.target.value }))}>{PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Reference / UTR"><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} /></FG>
        <FG label="Description"><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></FG>
      </div>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── BANK RECONCILIATION ─────────────────────────────────────────────────────
export function BankView({ bankAccounts, bankTransactions, businesses, activeBiz, reload }) {
  const [selectedBank, setSelectedBank] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);

  const filteredBanks = activeBiz ? bankAccounts.filter(b => b.business_id === activeBiz) : bankAccounts;
  const bankTxns = selectedBank ? bankTransactions.filter(t => t.bank_account_id === selectedBank) : [];
  const selBank = filteredBanks.find(b => b.id === selectedBank);

  const balance = bankTxns.reduce((s, t) => s + (t.type === 'credit' ? Number(t.amount) : -Number(t.amount)), selBank?.opening_balance || 0);

  async function saveBank(data, id) { await saveBankAccount(data, id); reload(); }
  async function addTxn(data) { await saveBankTxn(data); reload(); }
  async function delTxn(id) { if (!confirm('Delete?')) return; await deleteBankTxn(id); reload(); }

  return (
    <div>
      <div className="filter-bar">
        <select value={selectedBank} onChange={e => setSelectedBank(e.target.value)} style={{ minWidth: 200, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <option value="">Select bank account…</option>
          {filteredBanks.map(b => <option key={b.id} value={b.id}>{b.name} — {b.account_number}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAddBank(true)}>+ Add Bank</button>
        {selectedBank && <button className="btn btn-primary" onClick={() => setShowAddTxn(true)}>+ Add Transaction</button>}
      </div>

      {selBank && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 14 }}>
            <StatCard label="Current Balance" value={fmt(balance)} color={balance >= 0 ? 'green' : 'red'} sub={selBank.bank_name} />
            <StatCard label="Opening Balance" value={fmt(selBank.opening_balance || 0)} color="blue" />
            <StatCard label="Transactions" value={bankTxns.length} color="purple" />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Type</th><th className="r">Amount</th><th className="r">Balance</th><th></th></tr></thead>
              <tbody>
                {(() => {
                  let runBal = selBank.opening_balance || 0;
                  return bankTxns.map(t => {
                    runBal += t.type === 'credit' ? Number(t.amount) : -Number(t.amount);
                    return (
                      <tr key={t.id}>
                        <td className="mono" style={{ fontSize: 11 }}>{fmtDate(t.txn_date)}</td>
                        <td style={{ fontWeight: 500, fontSize: 12.5 }}>{t.description}</td>
                        <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{t.reference || '—'}</td>
                        <td><span className={`tag`} style={{ color: t.type === 'credit' ? 'var(--green)' : 'var(--red)', borderColor: t.type === 'credit' ? 'var(--green)' : 'var(--red)' }}>{t.type}</span></td>
                        <td className="r mono" style={{ color: t.type === 'credit' ? 'var(--green)' : 'var(--red)' }}>{t.type === 'credit' ? '+' : '-'}{fmt(t.amount)}</td>
                        <td className="r mono" style={{ fontWeight: 600, color: runBal >= 0 ? 'var(--text)' : 'var(--red)' }}>{fmt(runBal)}</td>
                        <td><button className="btn btn-danger btn-sm" onClick={() => delTxn(t.id)}>Del</button></td>
                      </tr>
                    );
                  });
                })()}
                {bankTxns.length === 0 && <tr><td colSpan={7}><EmptyState icon="🏦" message="No transactions" /></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!selectedBank && filteredBanks.length === 0 && <EmptyState icon="🏦" message="No bank accounts added" sub='Click "+ Add Bank" to get started' />}
      {!selectedBank && filteredBanks.length > 0 && <EmptyState icon="👆" message="Select a bank account above" />}

      {showAddBank && <BankModal onClose={() => setShowAddBank(false)} onSave={saveBank} businesses={businesses} activeBiz={activeBiz} />}
      {showAddTxn && <BankTxnModal onClose={() => setShowAddTxn(false)} onSave={addTxn} bankAccountId={selectedBank} />}
    </div>
  );
}

function BankModal({ onClose, onSave, businesses, activeBiz }) {
  const [f, setF] = useState({ business_id: activeBiz || businesses[0]?.id || '', name: '', bank_name: '', account_number: '', ifsc_code: '', opening_balance: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!f.name.trim()) { setErr('Label is required'); return; }
    setBusy(true); setErr('');
    try { await onSave(f); onClose(); }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Bank Account" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Label *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="e.g. ICICI Current" /></FG>
        <FG label="Bank Name"><input value={f.bank_name} onChange={e => setF(x => ({ ...x, bank_name: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Account Number"><input value={f.account_number} onChange={e => setF(x => ({ ...x, account_number: e.target.value }))} /></FG>
        <FG label="IFSC Code"><input value={f.ifsc_code} onChange={e => setF(x => ({ ...x, ifsc_code: e.target.value.toUpperCase() }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Opening Balance (₹)"><input type="number" value={f.opening_balance} onChange={e => setF(x => ({ ...x, opening_balance: e.target.value }))} /></FG>
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
      </div>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

function BankTxnModal({ onClose, onSave, bankAccountId }) {
  const [f, setF] = useState({ bank_account_id: bankAccountId, txn_date: today(), description: '', reference: '', type: 'credit', amount: '', reconciled: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!f.description.trim()) { setErr('Description is required'); return; }
    if (!f.amount || Number(f.amount) <= 0) { setErr('Enter a valid amount'); return; }
    setBusy(true); setErr('');
    try { await onSave({ ...f, amount: Number(f.amount) }); onClose(); }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Bank Transaction" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Date"><input type="date" value={f.txn_date} onChange={e => setF(x => ({ ...x, txn_date: e.target.value }))} /></FG>
        <FG label="Type"><select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}><option value="credit">Credit (money in)</option><option value="debit">Debit (money out)</option></select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Amount *"><input type="number" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></FG>
        <FG label="Reference / UTR"><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} /></FG>
      </div>
      <FG label="Description *"><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="e.g. Payment from client" /></FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── PAYMENTS VIEW ────────────────────────────────────────────────────────────
export function PaymentsView({ payments, businesses, parties, invoices, activeBiz, reload }) {
  const filtered = activeBiz ? payments.filter(p => p.business_id === activeBiz) : payments;
  async function del(id, invId) {
    if (!confirm('Delete this payment? Invoice status will be recalculated.')) return;
    await deletePayment(id);
    // Recalc invoice status
    const inv = invoices.find(i => i.id === invId);
    if (inv) {
      const remaining = payments.filter(p => p.id !== id && p.invoice_id === invId).reduce((s, p) => s + Number(p.amount), 0);
      const status = remaining <= 0 ? 'sent' : remaining >= Number(inv.total) - 0.01 ? 'paid' : 'partially_paid';
      await updateInvoiceStatus(invId, status);
    }
    reload();
  }
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Party</th><th>Invoice</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th></th></tr></thead>
        <tbody>
          {filtered.map(p => {
            const inv = invoices.find(i => i.id === p.invoice_id);
            return (
              <tr key={p.id}>
                <td className="mono" style={{ fontSize: 11 }}>{fmtDate(p.payment_date)}</td>
                <td style={{ fontWeight: 500 }}>{parties.find(pt => pt.id === p.party_id)?.name || '—'}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{inv?.invoice_number || '—'}</td>
                <td className="mono" style={{ fontSize: 11 }}>{p.method}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{p.reference || '—'}</td>
                <td className="r mono" style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(p.amount)}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => del(p.id, p.invoice_id)}>Del</button></td>
              </tr>
            );
          })}
          {filtered.length === 0 && <tr><td colSpan={7}><EmptyState icon="💳" message="No payments yet" /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── GSTR-1 ───────────────────────────────────────────────────────────────────
export function GSTR1View({ invoices, parties, businesses, activeBiz }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));

  const months = [['01','Jan'],['02','Feb'],['03','Mar'],['04','Apr'],['05','May'],['06','Jun'],['07','Jul'],['08','Aug'],['09','Sep'],['10','Oct'],['11','Nov'],['12','Dec']];
  const years = ['2023','2024','2025','2026','2027'];

  const saleInvoices = invoices.filter(i => {
    if (i.type !== 'sale' || i.status === 'proforma' || i.status === 'draft' || i.status === 'cancelled') return false;
    if (activeBiz && i.business_id !== activeBiz) return false;
    if (!i.issue_date) return false;
    const d = new Date(i.issue_date);
    return String(d.getMonth() + 1).padStart(2, '0') === month && String(d.getFullYear()) === year;
  });

  const biz = activeBiz ? businesses.find(b => b.id === activeBiz) : businesses[0];

  // B2B: invoices with GSTIN
  const b2b = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return p?.gstin; });
  // B2C Large: no GSTIN, amount > 2.5 lakh inter-state
  const b2cLarge = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return !p?.gstin && i.is_interstate && Number(i.total) > 250000; });
  // B2C Small: rest
  const b2cSmall = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return !p?.gstin && !(i.is_interstate && Number(i.total) > 250000); });

  const totalTaxable = saleInvoices.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const totalCGST = saleInvoices.reduce((s, i) => s + Number(i.cgst_amount || 0), 0);
  const totalSGST = saleInvoices.reduce((s, i) => s + Number(i.sgst_amount || 0), 0);
  const totalIGST = saleInvoices.reduce((s, i) => s + Number(i.igst_amount || 0), 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const grandTotal = totalTaxable + totalTax;

  // Export CSV for GSTR-1
  function exportCSV() {
    const rows = [['Invoice No.', 'Date', 'Party Name', 'GSTIN', 'State', 'State Code', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total', 'Supply Type']];
    saleInvoices.forEach(i => {
      const p = parties.find(pt => pt.id === i.party_id) || {};
      const sc = STATE_CODES[p.state] || '';
      rows.push([
        i.invoice_number, i.issue_date, p.name || '', p.gstin || '', p.state || '', sc,
        i.subtotal, i.cgst_amount || 0, i.sgst_amount || 0, i.igst_amount || 0,
        i.total, i.is_interstate === false ? 'Intra-state' : 'Inter-state'
      ]);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `GSTR1_${month}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="filter-bar">
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          {months.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
      </div>

      {/* Summary */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Taxable Value" value={fmt(totalTaxable)} color="blue" sub={`${saleInvoices.length} invoices`} />
        <StatCard label="CGST + SGST" value={fmt(totalCGST + totalSGST)} color="purple" sub="Intra-state" />
        <StatCard label="IGST" value={fmt(totalIGST)} color="amber" sub="Inter-state" />
        <StatCard label="Total Tax" value={fmt(totalTax)} color="red" />
      </div>

      {/* B2B */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-title">B2B Supplies (with GSTIN) — {b2b.length} invoice(s)</div>
        {b2b.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice #</th><th>Date</th><th>Party</th><th>GSTIN</th><th>State</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total</th></tr></thead>
              <tbody>
                {b2b.map(i => {
                  const p = parties.find(pt => pt.id === i.party_id) || {};
                  return (
                    <tr key={i.id}>
                      <td className="mono" style={{ color: 'var(--accent)' }}>{i.invoice_number}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtDate(i.issue_date)}</td>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td className="mono" style={{ fontSize: 10 }}>{p.gstin}</td>
                      <td style={{ fontSize: 11 }}>{p.state} <span className="tag">{STATE_CODES[p.state]}</span></td>
                      <td className="r mono">{fmt(i.subtotal)}</td>
                      <td className="r mono" style={{ color: 'var(--blue)', fontSize: 11 }}>{fmt(i.cgst_amount || 0)}</td>
                      <td className="r mono" style={{ color: 'var(--teal)', fontSize: 11 }}>{fmt(i.sgst_amount || 0)}</td>
                      <td className="r mono" style={{ color: 'var(--amber)', fontSize: 11 }}>{fmt(i.igst_amount || 0)}</td>
                      <td className="r mono" style={{ fontWeight: 600 }}>{fmt(i.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>No B2B invoices this period</div>}
      </div>

      {/* B2C Summary */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-title">B2C Supplies (consumer / unregistered) — {b2cSmall.length + b2cLarge.length} invoice(s)</div>
        {(b2cSmall.length + b2cLarge.length) > 0 ? (
          <div className="card">
            <div className="ledger-row"><span>B2C Large (inter-state &gt;2.5L)</span><span className="mono">{b2cLarge.length} invoices · {fmt(b2cLarge.reduce((s, i) => s + Number(i.total), 0))}</span></div>
            <div className="ledger-row"><span>B2C Small (rest)</span><span className="mono">{b2cSmall.length} invoices · {fmt(b2cSmall.reduce((s, i) => s + Number(i.total), 0))}</span></div>
          </div>
        ) : <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>No B2C invoices this period</div>}
      </div>

      {/* Period totals */}
      <div className="card" style={{ marginTop: 4 }}>
        <div className="card-head">Period Summary — {months.find(([v]) => v === month)?.[1]} {year}</div>
        <div className="ledger-row"><span>Total Taxable Value</span><span className="mono">{fmt(totalTaxable)}</span></div>
        <div className="ledger-row"><span>CGST</span><span className="mono" style={{ color: 'var(--blue)' }}>{fmt(totalCGST)}</span></div>
        <div className="ledger-row"><span>SGST</span><span className="mono" style={{ color: 'var(--teal)' }}>{fmt(totalSGST)}</span></div>
        <div className="ledger-row"><span>IGST</span><span className="mono" style={{ color: 'var(--amber)' }}>{fmt(totalIGST)}</span></div>
        <div className="ledger-row total"><span>Total Tax</span><span className="mono" style={{ color: 'var(--red)' }}>{fmt(totalTax)}</span></div>
        <div className="ledger-row total" style={{ borderTop: '2px solid var(--border2)' }}><span style={{ fontSize: 14 }}>Grand Total</span><span className="mono" style={{ fontSize: 14 }}>{fmt(grandTotal)}</span></div>
      </div>
    </div>
  );
}
