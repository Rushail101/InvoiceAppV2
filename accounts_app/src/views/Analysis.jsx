import { useState } from 'react';
import { fmt } from '../lib/constants.js';
import { StatCard, EmptyState } from '../components/ui.jsx';

// Simple horizontal bar row — used for both the spending-by-category and
// earning-by-party lists below. No charting library needed for this.
function BarRow({ label, sub, amount, pct, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          {sub && <span style={{ fontSize: 10.5, color: 'var(--text4)', marginLeft: 6 }}>{sub}</span>}
        </div>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text2)' }}>{fmt(amount)} <span style={{ color: 'var(--text4)', fontSize: 10.5 }}>({pct.toFixed(1)}%)</span></span>
      </div>
      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(pct, 1)}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

export function AnalysisView({ journalEntries, journalLines, accounts, businesses, activeBiz, parties, invoices, payments }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function applyPreset(preset) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === 'this_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(iso(now)); }
    else if (preset === 'last_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(iso(new Date(now.getFullYear(), now.getMonth(), 0))); }
    else if (preset === 'this_fy') {
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setDateFrom(iso(new Date(fyStartYear, 3, 1))); setDateTo(iso(now));
    }
    else if (preset === 'last_fy') {
      const fyStartYear = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) - 1;
      setDateFrom(iso(new Date(fyStartYear, 3, 1))); setDateTo(iso(new Date(fyStartYear + 1, 2, 31)));
    }
    else { setDateFrom(''); setDateTo(''); }
  }

  const bizJournals = activeBiz ? journalEntries.filter(j => j.business_id === activeBiz) : journalEntries;
  const inDateRange = d => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  const periodJournals = bizJournals.filter(j => inDateRange(j.entry_date));
  const journalIds = new Set(periodJournals.map(j => j.id));
  const periodLines = (journalLines || []).filter(l => journalIds.has(l.journal_id));

  const acctById = {};
  accounts.forEach(a => { acctById[a.id] = a; });

  // ── Spending by category — every expense-account debit line in the
  // period, sourced from the journal so it includes bank-imported spend,
  // manual entries, and posted expenses, not just one table. ──
  const spendByAcct = {};
  let totalSpend = 0;
  periodLines.forEach(l => {
    if (l.type !== 'debit') return;
    const acc = acctById[l.account_id];
    if (!acc || acc.group !== 'expense') return;
    spendByAcct[acc.name] = (spendByAcct[acc.name] || 0) + Number(l.amount);
    totalSpend += Number(l.amount);
  });
  const spendRows = Object.entries(spendByAcct).sort((a, b) => b[1] - a[1]);

  // ── Income by category (Sales Revenue vs Service/Other Income) — same
  // journal-based source, credit side of income-group accounts. ──
  const incomeByAcct = {};
  let totalIncome = 0;
  periodLines.forEach(l => {
    if (l.type !== 'credit') return;
    const acc = acctById[l.account_id];
    if (!acc || acc.group !== 'income') return;
    incomeByAcct[acc.name] = (incomeByAcct[acc.name] || 0) + Number(l.amount);
    totalIncome += Number(l.amount);
  });
  const incomeRows = Object.entries(incomeByAcct).sort((a, b) => b[1] - a[1]);

  // ── Earning by party — from the payments table (has party linkage,
  // which journal_lines don't), excluding money paid OUT against purchase
  // bills so this only reflects money actually received from someone. ──
  const invById = {};
  (invoices || []).forEach(i => { invById[i.id] = i; });
  const bizPayments = (activeBiz ? (payments || []).filter(p => p.business_id === activeBiz) : (payments || []))
    .filter(p => inDateRange(p.payment_date))
    .filter(p => { const inv = invById[p.invoice_id]; return !inv || inv.type !== 'purchase'; });

  const incomeByParty = {};
  let totalReceived = 0;
  bizPayments.forEach(p => {
    const party = (parties || []).find(pt => pt.id === p.party_id);
    const name = party?.name || 'Unlinked / Unknown';
    incomeByParty[name] = (incomeByParty[name] || 0) + Number(p.amount);
    totalReceived += Number(p.amount);
  });
  const partyRows = Object.entries(incomeByParty).sort((a, b) => b[1] - a[1]);

  const net = totalIncome - totalSpend;
  const COLORS = ['var(--accent)', 'var(--blue)', 'var(--purple)', 'var(--amber)', 'var(--green)', '#ff8cc8', '#f97316', '#22d3ee'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[['this_month', 'This month'], ['last_month', 'Last month'], ['this_fy', 'This FY'], ['last_fy', 'Last FY'], ['', 'All time']].map(([id, label]) => (
          <button key={id || 'all'} className="btn btn-ghost btn-sm" onClick={() => applyPreset(id)}>{label}</button>
        ))}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ maxWidth: 145 }} title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ maxWidth: 145 }} title="To date" />
      </div>

      <div className="stats-grid">
        <StatCard label="Total Spent" value={fmt(totalSpend)} color="red" sub={`${spendRows.length} categories`} />
        <StatCard label="Total Earned" value={fmt(totalIncome)} color="green" sub={`${incomeRows.length} categories`} />
        <StatCard label="Net" value={fmt(net)} color={net >= 0 ? 'green' : 'red'} sub={net >= 0 ? 'Profit' : 'Loss'} />
        <StatCard label="Cash Received" value={fmt(totalReceived)} color="blue" sub={`from ${partyRows.length} ${partyRows.length === 1 ? 'party' : 'parties'}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="table-wrap" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Where your money is going</div>
          {spendRows.length === 0
            ? <EmptyState icon="💸" message="No spending in this period" />
            : spendRows.map(([name, amt], i) => (
                <BarRow key={name} label={name} amount={amt} pct={totalSpend ? (amt / totalSpend) * 100 : 0} color={COLORS[i % COLORS.length]} />
              ))}
        </div>

        <div className="table-wrap" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Who you're earning from</div>
          {partyRows.length === 0
            ? <EmptyState icon="🤝" message="No payments received in this period" />
            : partyRows.map(([name, amt], i) => (
                <BarRow key={name} label={name} amount={amt} pct={totalReceived ? (amt / totalReceived) * 100 : 0} color={COLORS[i % COLORS.length]} />
              ))}
        </div>
      </div>

      {incomeRows.length > 0 && (
        <div className="table-wrap" style={{ padding: 18, marginTop: 20 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Income by category</div>
          {incomeRows.map(([name, amt], i) => (
            <BarRow key={name} label={name} amount={amt} pct={totalIncome ? (amt / totalIncome) * 100 : 0} color={COLORS[i % COLORS.length]} />
          ))}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text4)', fontFamily: 'var(--mono)', marginTop: 16 }}>
        Spending/income figures are pulled from Journal Vouchers, so they reflect everything posted there — bank imports, manual entries, expenses, and payments. "Who you're earning from" is pulled from Payments directly, since journal lines don't track which party they belong to.
      </p>
    </div>
  );
}
