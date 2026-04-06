import { useState, useMemo } from 'react';
import { fmt, fmtDate, today, DEFAULT_ACCOUNTS } from '../lib/constants.js';
import { saveAccount, saveJournal, deleteJournal, seedAccounts } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState, StatCard } from '../components/ui.jsx';

// ─── CHART OF ACCOUNTS ────────────────────────────────────────────────────────
export function ChartOfAccountsView({ accounts, businesses, activeBiz, reload }) {
  const [showModal, setShowModal] = useState(false);
  const [editAcc, setEditAcc] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const filtered = activeBiz ? accounts.filter(a => a.business_id === activeBiz) : accounts;
  const groups = ['asset', 'liability', 'equity', 'income', 'expense'];

  async function handleSeed() {
    if (!activeBiz) { alert('Select a business first'); return; }
    if (!confirm('Seed standard Chart of Accounts? This adds ~32 default ledger accounts.')) return;
    setSeeding(true);
    try { await seedAccounts(activeBiz, DEFAULT_ACCOUNTS); reload(); }
    catch (e) { alert(e.message); }
    setSeeding(false);
  }

  async function handleSave(data, id) {
    await saveAccount({ ...data, business_id: activeBiz || businesses[0]?.id }, id);
    reload();
  }

  return (
    <>
      <div className="filter-bar">
        <button className="btn btn-ghost btn-sm" onClick={handleSeed} disabled={seeding}>{seeding ? 'Seeding…' : '⚡ Seed Default Accounts'}</button>
        <button className="btn btn-primary" onClick={() => { setEditAcc(null); setShowModal(true); }}>+ Add Account</button>
      </div>

      {groups.map(grp => {
        const grpAccs = filtered.filter(a => a.group === grp);
        if (!grpAccs.length) return null;
        return (
          <div key={grp} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge status={grp} />
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{grp}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Sub-Group</th><th>Description</th><th>Actions</th></tr></thead>
                <tbody>
                  {grpAccs.map(a => (
                    <tr key={a.id}>
                      <td className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{a.code}</td>
                      <td style={{ fontWeight: 500 }}>{a.name}</td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>{a.sub_group || '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{a.description || '—'}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => { setEditAcc(a); setShowModal(true); }}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && <EmptyState icon="📒" message="No accounts yet" sub='Click "Seed Default Accounts" to get started with a standard chart of accounts' />}

      {showModal && (
        <AccountModal onClose={() => setShowModal(false)} onSave={handleSave} editData={editAcc} businesses={businesses} activeBiz={activeBiz} />
      )}
    </>
  );
}

function AccountModal({ onClose, onSave, editData, businesses, activeBiz }) {
  const [f, setF] = useState({
    code: editData?.code || '',
    name: editData?.name || '',
    group: editData?.group || 'asset',
    sub_group: editData?.sub_group || '',
    description: editData?.description || '',
    business_id: activeBiz || businesses[0]?.id || '',
  });
  const [busy, setBusy] = useState(false);

  const subGroups = {
    asset: ['Current Assets', 'Fixed Assets', 'Investments'],
    liability: ['Current Liabilities', 'Long-term Liabilities'],
    equity: ['Equity'],
    income: ['Direct Income', 'Indirect Income'],
    expense: ['Direct Expenses', 'Indirect Expenses'],
  };

  async function save() {
    if (!f.name.trim() || !f.code.trim()) return;
    setBusy(true);
    await onSave(f, editData?.id);
    setBusy(false); onClose();
  }

  return (
    <ModalShell title={editData ? 'Edit Account' : 'Add Account'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Account Code *"><input value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value }))} placeholder="e.g. 1010" /></FG>
        <FG label="Group *">
          <select value={f.group} onChange={e => setF(x => ({ ...x, group: e.target.value, sub_group: '' }))}>
            {['asset', 'liability', 'equity', 'income', 'expense'].map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
          </select>
        </FG>
      </div>
      <div className="form-row">
        <FG label="Account Name *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Sub-Group">
          <select value={f.sub_group} onChange={e => setF(x => ({ ...x, sub_group: e.target.value }))}>
            <option value="">Select…</option>
            {(subGroups[f.group] || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FG>
        <FG label="Business">
          <select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FG>
      </div>
      <FG label="Description"><textarea value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></FG>
    </ModalShell>
  );
}

// ─── JOURNAL VOUCHERS ────────────────────────────────────────────────────────
export function JournalView({ journalEntries, journalLines, accounts, businesses, activeBiz, reload }) {
  const [showModal, setShowModal] = useState(false);
  const filtered = activeBiz ? journalEntries.filter(j => j.business_id === activeBiz) : journalEntries;

  async function handleSave(entry, lines) {
    await saveJournal(entry, lines);
    reload();
  }

  async function del(id) {
    if (!confirm('Delete this journal entry?')) return;
    await deleteJournal(id);
    reload();
  }

  const linesByJournal = {};
  (journalLines || []).forEach(l => { if (!linesByJournal[l.journal_id]) linesByJournal[l.journal_id] = []; linesByJournal[l.journal_id].push(l); });

  return (
    <>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Journal Entry</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="r">Debit</th><th className="r">Credit</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(j => {
              const lines = linesByJournal[j.id] || [];
              const totalDr = lines.filter(l => l.type === 'debit').reduce((s, l) => s + Number(l.amount), 0);
              const totalCr = lines.filter(l => l.type === 'credit').reduce((s, l) => s + Number(l.amount), 0);
              return (
                <tr key={j.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(j.entry_date)}</td>
                  <td className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{j.reference || '—'}</td>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 500, fontSize: 12.5 }}>{j.description}</div>
                    {lines.slice(0, 3).map((l, i) => {
                      const acc = accounts.find(a => a.id === l.account_id);
                      return <div key={i} style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{l.type === 'debit' ? 'Dr' : '  Cr'} {acc?.name || l.account_id}</div>;
                    })}
                    {lines.length > 3 && <div style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)' }}>+{lines.length - 3} more…</div>}
                  </td>
                  <td className="r mono dr">{fmt(totalDr)}</td>
                  <td className="r mono cr">{fmt(totalCr)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-danger btn-sm" onClick={() => del(j.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={6}><EmptyState icon="📋" message="No journal entries" sub="Post manual double-entry transactions here" /></td></tr>}
          </tbody>
        </table>
      </div>
      {showModal && <JournalModal onClose={() => setShowModal(false)} onSave={handleSave} accounts={accounts} businesses={businesses} activeBiz={activeBiz} />}
    </>
  );
}

function JournalModal({ onClose, onSave, accounts, businesses, activeBiz }) {
  const [f, setF] = useState({
    business_id: activeBiz || businesses[0]?.id || '',
    entry_date: today(),
    reference: '',
    description: '',
    narration: '',
  });
  const [lines, setLines] = useState([
    { account_id: '', type: 'debit', amount: '', narration: '' },
    { account_id: '', type: 'credit', amount: '', narration: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const filtAccs = accounts.filter(a => a.business_id === f.business_id);
  const totalDr = lines.filter(l => l.type === 'debit').reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalCr = lines.filter(l => l.type === 'credit').reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  function updLine(idx, field, val) { setLines(prev => prev.map((l, i) => i !== idx ? l : { ...l, [field]: val })); }

  async function save() {
    if (!f.description.trim()) { setErr('Enter a description'); return; }
    if (!balanced) { setErr(`Not balanced — Dr: ${fmt(totalDr)}, Cr: ${fmt(totalCr)}`); return; }
    const validLines = lines.filter(l => l.account_id && Number(l.amount) > 0);
    if (validLines.length < 2) { setErr('Need at least one debit and one credit line'); return; }
    setErr(''); setBusy(true);
    try {
      await onSave(f, validLines.map(l => ({ ...l, amount: Number(l.amount) })));
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="New Journal Entry" onClose={onClose} size="modal-lg"
      foot={<>
        <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, color: balanced ? 'var(--green)' : 'var(--red)' }}>
          {balanced ? '✓ Balanced' : `⚠ Dr ${fmt(totalDr)} ≠ Cr ${fmt(totalCr)}`}
        </div>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !balanced}>{busy ? 'Posting…' : 'Post Entry'}</button>
      </>}>

      <div className="form-row cols-3">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="Date"><input type="date" value={f.entry_date} onChange={e => setF(x => ({ ...x, entry_date: e.target.value }))} /></FG>
        <FG label="Reference / Voucher No."><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} placeholder="JV-001" /></FG>
      </div>
      <div className="form-row">
        <FG label="Description *"><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="e.g. Paid rent for March" /></FG>
      </div>

      <div className="section-title">Ledger Lines</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 1fr 28px', gap: 5, fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 5, borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
        <span>Account</span><span>Dr / Cr</span><span>Amount</span><span>Narration</span><span></span>
      </div>
      {lines.map((l, idx) => (
        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 1fr 28px', gap: 5, marginBottom: 6, alignItems: 'center' }}>
          <select value={l.account_id} onChange={e => updLine(idx, 'account_id', e.target.value)}>
            <option value="">Select account…</option>
            {['asset', 'liability', 'equity', 'income', 'expense'].map(grp => (
              <optgroup key={grp} label={grp.charAt(0).toUpperCase() + grp.slice(1)}>
                {filtAccs.filter(a => a.group === grp).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </optgroup>
            ))}
          </select>
          <select value={l.type} onChange={e => updLine(idx, 'type', e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: l.type === 'debit' ? 'var(--red)' : 'var(--green)', borderRadius: 'var(--r)', padding: '6px 7px', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}>
            <option value="debit">Dr</option>
            <option value="credit">Cr</option>
          </select>
          <input type="number" min="0" value={l.amount} onChange={e => updLine(idx, 'amount', e.target.value)} placeholder="0.00" style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 7px', fontSize: 12, fontFamily: 'var(--mono)', outline: 'none', width: '100%' }} />
          <input value={l.narration} onChange={e => updLine(idx, 'narration', e.target.value)} placeholder="Optional narration" style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 7px', fontSize: 12, outline: 'none', width: '100%' }} />
          {lines.length > 2 ? <button className="remove-btn" onClick={() => setLines(p => p.filter((_, i) => i !== idx))}>×</button> : <div />}
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setLines(p => [...p, { account_id: '', type: 'credit', amount: '', narration: '' }])}>+ Add line</button>
      {err && <p className="err-msg" style={{ marginTop: 8 }}>{err}</p>}
    </ModalShell>
  );
}

// ─── TRIAL BALANCE ────────────────────────────────────────────────────────────
export function TrialBalanceView({ accounts, journalLines, journalEntries, invoices, payments, expenses, creditNotes, businesses, activeBiz }) {
  const filtered = activeBiz ? accounts.filter(a => a.business_id === activeBiz) : accounts;

  // Build account balances from journal lines
  const accBalances = {};
  filtered.forEach(a => { accBalances[a.id] = { dr: 0, cr: 0 }; });

  const relevantJournals = activeBiz
    ? journalEntries.filter(j => j.business_id === activeBiz).map(j => j.id)
    : journalEntries.map(j => j.id);

  (journalLines || []).forEach(l => {
    if (!relevantJournals.includes(l.journal_id)) return;
    if (!accBalances[l.account_id]) return;
    if (l.type === 'debit') accBalances[l.account_id].dr += Number(l.amount);
    else accBalances[l.account_id].cr += Number(l.amount);
  });

  const rows = filtered.map(a => {
    const b = accBalances[a.id] || { dr: 0, cr: 0 };
    const net = b.dr - b.cr;
    // Normal balance: Assets+Expenses = Dr; Liabilities+Equity+Income = Cr
    const isDebitNormal = ['asset', 'expense'].includes(a.group);
    const closingDr = isDebitNormal ? (net > 0 ? net : 0) : (net < 0 ? -net : 0);
    const closingCr = !isDebitNormal ? (net < 0 ? -net : 0) : (net > 0 ? 0 : -net);
    return { ...a, totalDr: b.dr, totalCr: b.cr, closingDr, closingCr };
  }).filter(r => r.totalDr > 0 || r.totalCr > 0);

  const sumDr = rows.reduce((s, r) => s + r.totalDr, 0);
  const sumCr = rows.reduce((s, r) => s + r.totalCr, 0);
  const closDr = rows.reduce((s, r) => s + r.closingDr, 0);
  const closCr = rows.reduce((s, r) => s + r.closingCr, 0);
  const isBalanced = Math.abs(sumDr - sumCr) < 0.01;

  if (rows.length === 0) return <EmptyState icon="⚖️" message="No journal entries yet" sub="Post journal entries to see the Trial Balance" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Cumulative · all dates</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: isBalanced ? 'var(--green)' : 'var(--red)' }}>
          {isBalanced ? '✓ Balanced' : '⚠ Not balanced'}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Code</th><th>Account</th><th>Group</th>
            <th className="r">Total Debit</th><th className="r">Total Credit</th>
            <th className="r">Closing Dr</th><th className="r">Closing Cr</th>
          </tr></thead>
          <tbody>
            {['asset', 'liability', 'equity', 'income', 'expense'].map(grp => {
              const grpRows = rows.filter(r => r.group === grp);
              if (!grpRows.length) return null;
              return grpRows.map((r, i) => (
                <tr key={r.id}>
                  {i === 0 && <td rowSpan={grpRows.length} style={{ verticalAlign: 'top', paddingTop: 14 }}><Badge status={grp} /></td>}
                  <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.code}</td>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="r mono dr" style={{ fontSize: 11 }}>{r.totalDr > 0 ? fmt(r.totalDr) : '—'}</td>
                  <td className="r mono cr" style={{ fontSize: 11 }}>{r.totalCr > 0 ? fmt(r.totalCr) : '—'}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--text)' }}>{r.closingDr > 0.01 ? fmt(r.closingDr) : '—'}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--text)' }}>{r.closingCr > 0.01 ? fmt(r.closingCr) : '—'}</td>
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border2)', background: 'var(--bg3)' }}>
              <td colSpan={3} style={{ padding: '10px 16px', fontFamily: 'var(--mono)', fontSize: 12 }}>TOTAL</td>
              <td className="r mono" style={{ padding: '10px 16px', color: 'var(--red)' }}>{fmt(sumDr)}</td>
              <td className="r mono" style={{ padding: '10px 16px', color: 'var(--green)' }}>{fmt(sumCr)}</td>
              <td className="r mono" style={{ padding: '10px 16px' }}>{fmt(closDr)}</td>
              <td className="r mono" style={{ padding: '10px 16px' }}>{fmt(closCr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── BALANCE SHEET ────────────────────────────────────────────────────────────
export function BalanceSheetView({ accounts, journalLines, journalEntries, invoices, payments, expenses, businesses, activeBiz }) {
  const bizAccounts = activeBiz ? accounts.filter(a => a.business_id === activeBiz) : accounts;
  const relevantJournals = activeBiz
    ? journalEntries.filter(j => j.business_id === activeBiz).map(j => j.id)
    : journalEntries.map(j => j.id);

  // Compute net balance per account
  function getBalance(accountId) {
    let dr = 0, cr = 0;
    (journalLines || []).forEach(l => {
      if (!relevantJournals.includes(l.journal_id) || l.account_id !== accountId) return;
      if (l.type === 'debit') dr += Number(l.amount);
      else cr += Number(l.amount);
    });
    return dr - cr;
  }

  function groupTotal(grp, subGrp) {
    return bizAccounts
      .filter(a => a.group === grp && (!subGrp || a.sub_group === subGrp))
      .reduce((s, a) => {
        const bal = getBalance(a.id);
        return s + (grp === 'asset' || grp === 'expense' ? bal : -bal);
      }, 0);
  }

  // Assets
  const currentAssets = groupTotal('asset', 'Current Assets');
  const fixedAssets = groupTotal('asset', 'Fixed Assets');
  const totalAssets = currentAssets + fixedAssets;

  // Liabilities
  const currentLiab = groupTotal('liability', 'Current Liabilities');
  const longTermLiab = groupTotal('liability', 'Long-term Liabilities');
  const totalLiab = currentLiab + longTermLiab;

  // Equity
  const equity = groupTotal('equity', 'Equity');
  // Net income (income - expense) adds to equity
  const income = bizAccounts.filter(a => a.group === 'income').reduce((s, a) => s - getBalance(a), 0);
  const expAmt = bizAccounts.filter(a => a.group === 'expense').reduce((s, a) => s + getBalance(a), 0);
  const netIncome = income - expAmt;
  const totalEquity = equity + netIncome;
  const totalLiabEquity = totalLiab + totalEquity;

  const isBalanced = Math.abs(totalAssets - totalLiabEquity) < 0.01;

  function AccSection({ title, accs, grp, color }) {
    if (!accs || !accs.length) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', paddingBottom: 4, marginBottom: 4, borderBottom: '1px solid var(--border)' }}>{title}</div>
        {accs.map(a => {
          const bal = getBalance(a.id);
          const display = grp === 'asset' || grp === 'expense' ? bal : -bal;
          if (Math.abs(display) < 0.01) return null;
          return (
            <div key={a.id} className="ledger-row">
              <span style={{ color: 'var(--text2)', fontSize: 12.5 }}>{a.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color }}>{fmt(Math.abs(display))}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (bizAccounts.length === 0) return <EmptyState icon="📊" message="No accounts configured" sub='Go to "Chart of Accounts" and click "Seed Default Accounts"' />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Balance Sheet · As at today</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: isBalanced ? 'var(--green)' : 'var(--red)' }}>
          {isBalanced ? '✓ Assets = Liabilities + Equity' : `⚠ Difference: ${fmt(Math.abs(totalAssets - totalLiabEquity))}`}
        </span>
      </div>

      <div className="two-col">
        {/* LEFT — Assets */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--blue)' }}>ASSETS</div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">Current Assets</div>
            <AccSection accs={bizAccounts.filter(a => a.group === 'asset' && a.sub_group === 'Current Assets')} grp="asset" color="var(--blue)" />
            <div className="ledger-row total"><span>Total Current Assets</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>{fmt(currentAssets)}</span></div>
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">Fixed Assets</div>
            <AccSection accs={bizAccounts.filter(a => a.group === 'asset' && a.sub_group === 'Fixed Assets')} grp="asset" color="var(--blue)" />
            <div className="ledger-row total"><span>Total Fixed Assets</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>{fmt(fixedAssets)}</span></div>
          </div>
          <div className="card" style={{ background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
            <div className="ledger-row total" style={{ margin: 0, padding: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>TOTAL ASSETS</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>{fmt(totalAssets)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — Liabilities + Equity */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--red)' }}>LIABILITIES & EQUITY</div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">Current Liabilities</div>
            <AccSection accs={bizAccounts.filter(a => a.group === 'liability' && a.sub_group === 'Current Liabilities')} grp="liability" color="var(--red)" />
            <div className="ledger-row total"><span>Total Current Liabilities</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--red)' }}>{fmt(currentLiab)}</span></div>
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">Equity</div>
            <AccSection accs={bizAccounts.filter(a => a.group === 'equity')} grp="equity" color="var(--purple)" />
            <div className="ledger-row" style={{ borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text2)', fontSize: 12.5 }}>Net Income (this period)</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: netIncome >= 0 ? 'var(--green)' : 'var(--red)' }}>{netIncome >= 0 ? fmt(netIncome) : `-${fmt(-netIncome)}`}</span>
            </div>
            <div className="ledger-row total"><span>Total Equity</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--purple)' }}>{fmt(totalEquity)}</span></div>
          </div>
          <div className="card" style={{ background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
            <div className="ledger-row total" style={{ margin: 0, padding: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>TOTAL L + E</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: isBalanced ? 'var(--green)' : 'var(--red)' }}>{fmt(totalLiabEquity)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── P&L REPORT ───────────────────────────────────────────────────────────────
export function PLView({ invoices, expenses, payments, businesses, activeBiz }) {
  const [period, setPeriod] = useState('fy'); // 'fy' | 'month' | 'quarter'
  const now = new Date();
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);

  function inPeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (period === 'fy') return d >= fyStart;
    if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'quarter') {
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return d >= qStart;
    }
    return true;
  }

  const bizList = activeBiz ? businesses.filter(b => b.id === activeBiz) : businesses;

  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Period:</span>
        {[['fy', 'This FY'], ['quarter', 'This Quarter'], ['month', 'This Month']].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${period === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPeriod(v)}>{l}</button>
        ))}
      </div>

      {bizList.map(biz => {
        // Invoiced revenue — sent/paid invoices only (accrual basis)
        const bi = invoices.filter(i => i.business_id === biz.id && i.type === 'sale'
          && !['draft', 'cancelled', 'proforma'].includes(i.status) && inPeriod(i.issue_date));
        const pi = invoices.filter(i => i.business_id === biz.id && i.type === 'purchase'
          && !['draft', 'cancelled', 'proforma'].includes(i.status) && inPeriod(i.issue_date));
        const be = expenses.filter(e => e.business_id === biz.id && inPeriod(e.expense_date));

        // All sale invoices including proforma (for cash tracking)
        const allSaleInv = invoices.filter(i => i.business_id === biz.id && i.type === 'sale'
          && !['draft', 'cancelled'].includes(i.status) && inPeriod(i.issue_date));

        const revenue = bi.reduce((s, i) => s + Number(i.subtotal || 0), 0);
        const taxCollected = bi.reduce((s, i) => s + Number(i.tax_amount || 0), 0);
        const purchases = pi.reduce((s, i) => s + Number(i.subtotal || 0), 0);
        const grossProfit = revenue - purchases;

        // Group expenses by category
        const expByCategory = {};
        be.forEach(e => {
          expByCategory[e.category] = (expByCategory[e.category] || 0) + Number(e.amount);
        });
        const totalExp = be.reduce((s, e) => s + Number(e.amount), 0);
        const netProfit = grossProfit - totalExp;

        // Collections (cash-basis) — include payments against proformas too
        const collected = allSaleInv.reduce((s, i) => s + (paysByInv[i.id] || []).reduce((ps, p) => ps + Number(p.amount), 0), 0);
        const outstanding = allSaleInv.reduce((s, i) => {
          const paid = (paysByInv[i.id] || []).reduce((ps, p) => ps + Number(p.amount), 0);
          return s + Math.max(0, Number(i.total) - paid);
        }, 0);

        return (
          <div key={biz.id} style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--accent)', fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>
              {biz.name}
            </h3>

            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 20 }}>
              <div className="stat-card green"><div className="stat-label">Revenue</div><div className="stat-val green">{fmt(revenue)}</div><div className="stat-sub">invoiced (excl. GST)</div></div>
              <div className="stat-card blue"><div className="stat-label">Collected</div><div className="stat-val blue">{fmt(collected)}</div><div className="stat-sub">cash received</div></div>
              <div className="stat-card amber"><div className="stat-label">Outstanding</div><div className="stat-val amber">{fmt(outstanding)}</div><div className="stat-sub">unpaid</div></div>
              <div className="stat-card red"><div className="stat-label">Total Expenses</div><div className="stat-val red">{fmt(totalExp + purchases)}</div><div className="stat-sub">purchases + opex</div></div>
              <div className={`stat-card ${netProfit >= 0 ? 'green' : 'red'}`}>
                <div className="stat-label">Net Profit</div>
                <div className={`stat-val ${netProfit >= 0 ? 'green' : 'red'}`}>{fmt(Math.abs(netProfit))}</div>
                <div className="stat-sub">{netProfit >= 0 ? 'profit' : 'loss'}</div>
              </div>
            </div>

            <div className="two-col">
              {/* Income side */}
              <div>
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="card-head" style={{ color: 'var(--green)' }}>Income</div>
                  <div className="ledger-row">
                    <span>Sales Revenue</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(revenue)}</span>
                  </div>
                  <div className="ledger-row">
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>GST Collected</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{fmt(taxCollected)}</span>
                  </div>
                  <div className="ledger-row total">
                    <span>Total Income</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(revenue)}</span>
                  </div>
                </div>

                <div className="card">
                  <div className="card-head" style={{ color: 'var(--red)' }}>Cost of Goods</div>
                  <div className="ledger-row">
                    <span>Purchases / Raw Material</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--red)' }}>{fmt(purchases)}</span>
                  </div>
                  <div className="ledger-row total">
                    <span style={{ fontWeight: 700 }}>Gross Profit</span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {grossProfit < 0 ? '-' : ''}{fmt(Math.abs(grossProfit))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expenses side */}
              <div>
                <div className="card">
                  <div className="card-head" style={{ color: 'var(--amber)' }}>Operating Expenses</div>
                  {Object.entries(expByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                    <div key={cat} className="ledger-row">
                      <span style={{ fontSize: 12.5 }}>{cat}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)' }}>{fmt(amt)}</span>
                    </div>
                  ))}
                  {!Object.keys(expByCategory).length && (
                    <div className="ledger-row" style={{ color: 'var(--text3)' }}>No expenses this period</div>
                  )}
                  <div className="ledger-row total">
                    <span>Total Expenses</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmt(totalExp)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Profit bar */}
            <div style={{
              marginTop: 16, padding: '18px 24px',
              background: 'var(--bg2)', border: `1px solid ${netProfit >= 0 ? 'var(--green2)' : 'var(--red2)'}`,
              borderRadius: 'var(--r2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Net Profit / (Loss)</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  Margin: {revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0'}%
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.5px', color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {netProfit < 0 ? '(' : ''}{fmt(Math.abs(netProfit))}{netProfit < 0 ? ')' : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
