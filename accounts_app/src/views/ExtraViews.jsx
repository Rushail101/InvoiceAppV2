import { useState, useMemo } from 'react';
import { fmt, fmtDate, today, getFY, PAY_MODES, GST_RATES, INDIAN_STATES, gstType, calcLineTax } from '../lib/constants.js';
import { savePaymentWithJournal, updateInvoiceStatus, saveInvoice } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

// ─── PARTY STATEMENT ──────────────────────────────────────────────────────────

export function PartyStatementView({ parties, invoices, payments, creditNotes, debitNotes = [], businesses, activeBiz }) {
  const [partyId, setPartyId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredParties = activeBiz ? parties.filter(p => p.business_id === activeBiz) : parties;
  const party = parties.find(p => p.id === partyId);

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
    else { setDateFrom(''); setDateTo(''); }
  }

  const partyInvs = invoices.filter(i => i.party_id === partyId && !['cancelled', 'proforma'].includes(i.status))
    .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date));
  // Every payment recorded against this party — not just ones linked to an
  // invoice already on the statement. Payments carry their own party_id, so
  // this also catches advances recorded against a still-proforma invoice
  // (the "Record Advance" flow) that would otherwise vanish from a client's
  // statement until the proforma converts to a real tax invoice.
  const partyPayments = payments.filter(p => p.party_id === partyId)
    .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
  const partyCNs = creditNotes.filter(c => c.party_id === partyId)
    .sort((a, b) => new Date(a.cn_date) - new Date(b.cn_date));
  const partyDNs = debitNotes.filter(d => d.party_id === partyId)
    .sort((a, b) => new Date(a.dn_date) - new Date(b.dn_date));

  // Build the full ledger first (needed to compute an accurate opening
  // balance for whatever date range gets picked), then split it into the
  // "before the range" portion (collapsed into one Opening Balance line)
  // and the "within range" portion that's actually shown line-by-line.
  const allLines = [];
  partyInvs.forEach(inv => allLines.push({ date: inv.issue_date, type: 'invoice', ref: inv.invoice_number, desc: 'Invoice', debit: Number(inv.total), credit: 0, id: inv.id }));
  partyPayments.forEach(pay => {
    const linkedInv = invoices.find(i => i.id === pay.invoice_id);
    const label = linkedInv?.status === 'proforma' ? `Advance (${linkedInv.invoice_number})` : `Payment (${pay.method || '—'})`;
    allLines.push({ date: pay.payment_date, type: 'payment', ref: pay.reference || pay.method, desc: label, debit: 0, credit: Number(pay.amount), id: pay.id });
  });
  partyCNs.forEach(cn => allLines.push({ date: cn.cn_date, type: 'cn', ref: cn.cn_number, desc: 'Credit Note', debit: 0, credit: Number(cn.total || 0), id: cn.id }));
  partyDNs.forEach(dn => allLines.push({ date: dn.dn_date, type: 'dn', ref: dn.dn_number, desc: 'Debit Note', debit: Number(dn.total || 0), credit: 0, id: dn.id }));
  allLines.sort((a, b) => new Date(a.date) - new Date(b.date));

  const openingBal = dateFrom
    ? allLines.filter(l => l.date < dateFrom).reduce((s, l) => s + l.debit - l.credit, 0)
    : 0;
  const lines = allLines.filter(l => (!dateFrom || l.date >= dateFrom) && (!dateTo || l.date <= dateTo));

  let running = openingBal;
  const linesWithBal = lines.map(l => { running += l.debit - l.credit; return { ...l, balance: running }; });
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const closingBal = openingBal + totalDebit - totalCredit;
  const rangeLabel = dateFrom || dateTo
    ? `${dateFrom ? fmtDate(dateFrom) : 'Start'} – ${dateTo ? fmtDate(dateTo) : 'Today'}`
    : 'All time';

  function printStatement() {
    const biz = businesses.find(b => b.id === (party?.business_id));
    const fileTitle = `Statement_${(party?.name || 'party').trim().replace(/[^\w]+/g, '_')}_${(dateTo || today())}`;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>${fileTitle}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px}
    h2{margin:0 0 4px}p{margin:2px 0;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#f0f0f0;padding:7px 10px;text-align:left;border:1px solid #ddd;font-size:11px}
    td{padding:6px 10px;border:1px solid #ddd;font-size:11px}
    .r{text-align:right}.cr{color:green}.dr{color:#c00}.total{font-weight:700;background:#fafafa}
    </style></head><body>
    <h2>${biz?.name || ''}</h2>
    <p>${biz?.address || ''} | GST: ${biz?.gstin || ''}</p>
    <hr style="margin:12px 0"/>
    <h3 style="margin:0 0 4px">Account Statement — ${party?.name}</h3>
    <p>Period: ${rangeLabel} · Generated ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</p>
    <table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="r">Debit (₹)</th><th class="r">Credit (₹)</th><th class="r">Balance (₹)</th></tr></thead>
    <tbody>
    ${dateFrom ? `<tr class="total"><td colspan="5">OPENING BALANCE (before ${fmtDate(dateFrom)})</td>
      <td class="r ${openingBal > 0 ? 'dr' : 'cr'}">${Math.abs(openingBal).toLocaleString('en-IN',{minimumFractionDigits:2})} ${openingBal > 0 ? 'Dr' : 'Cr'}</td></tr>` : ''}
    ${linesWithBal.map(l => `<tr>
      <td>${new Date(l.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td>${l.ref || '—'}</td><td>${l.desc}</td>
      <td class="r ${l.debit ? 'dr' : ''}">${l.debit ? l.debit.toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}</td>
      <td class="r ${l.credit ? 'cr' : ''}">${l.credit ? l.credit.toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}</td>
      <td class="r">${l.balance.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    </tr>`).join('')}
    <tr class="total"><td colspan="3">CLOSING BALANCE</td>
    <td class="r">${totalDebit.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    <td class="r">${totalCredit.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    <td class="r ${closingBal > 0 ? 'dr' : 'cr'}">${Math.abs(closingBal).toLocaleString('en-IN',{minimumFractionDigits:2})} ${closingBal > 0 ? 'Dr' : 'Cr'}</td></tr>
    </tbody></table>
    <p style="margin-top:20px;font-size:10px;color:#999">Generated by Needle Point ERP · ${new Date().toLocaleString('en-IN')}</p>
    </body></html>`);
    w.document.close(); w.print();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={partyId} onChange={e => setPartyId(e.target.value)}
          style={{ flex: 1, maxWidth: 320, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <option value="">Select a party…</option>
          {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
        </select>
        {partyId && <button className="btn btn-ghost btn-sm" onClick={printStatement}>🖨 Print / PDF</button>}
      </div>

      {partyId && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Period:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12 }} />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12 }} />
          {[['this_month','This Month'],['last_month','Last Month'],['this_fy','This FY'],['all','All Time']].map(([k,l]) => (
            <button key={k} className="btn btn-ghost btn-sm" onClick={() => applyPreset(k)}>{l}</button>
          ))}
        </div>
      )}

      {!partyId && <EmptyState icon="👥" message="Select a party" sub="Choose a client or vendor to view their account statement" />}

      {partyId && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>TOTAL INVOICED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>{fmt(totalDebit)}</div>
            </div>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>TOTAL RECEIVED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{fmt(totalCredit)}</div>
            </div>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>CLOSING BALANCE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: closingBal > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(closingBal))} {closingBal > 0 ? 'Dr' : 'Cr'}</div>
            </div>
          </div>

          {linesWithBal.length === 0 && !dateFrom
            ? <EmptyState icon="📋" message="No transactions" sub="No invoices or payments found for this party" />
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Reference</th><th>Description</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr>
                  </thead>
                  <tbody>
                    {dateFrom && (
                      <tr>
                        <td colSpan={5} style={{ fontWeight: 600, fontSize: 12, color: 'var(--text2)' }}>Opening Balance (before {fmtDate(dateFrom)})</td>
                        <td className="r mono" style={{ fontWeight: 600, fontSize: 12, color: openingBal > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(openingBal))} {openingBal > 0 ? 'Dr' : 'Cr'}</td>
                      </tr>
                    )}
                    {linesWithBal.map((l, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 11 }}>{fmtDate(l.date)}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{l.ref || '—'}</td>
                        <td style={{ fontSize: 12 }}>{l.desc}</td>
                        <td className="r mono" style={{ color: l.debit ? 'var(--red)' : 'var(--text4)', fontSize: 12 }}>{l.debit ? fmt(l.debit) : '—'}</td>
                        <td className="r mono" style={{ color: l.credit ? 'var(--green)' : 'var(--text4)', fontSize: 12 }}>{l.credit ? fmt(l.credit) : '—'}</td>
                        <td className="r mono" style={{ fontWeight: 600, fontSize: 12, color: l.balance > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(l.balance))} {l.balance > 0 ? 'Dr' : 'Cr'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border2)' }}>
                      <td colSpan={3} style={{ fontWeight: 700 }}>CLOSING BALANCE</td>
                      <td className="r mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(totalDebit)}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(totalCredit)}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: closingBal > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(closingBal))} {closingBal > 0 ? 'Dr' : 'Cr'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </>
      )}
    </div>
  );
}

// ─── PAYMENT LIST (bank-statement tally) ──────────────────────────────────────
// Deliberately the opposite of everything else in this file: no invoice
// numbers, no debit/credit, no double-entry framing. Just "money that came
// in or went out, on what date, from/to whom" — the shape a bank statement
// actually comes in, so the two can be checked against each other line by
// line.
export function PaymentListView({ payments, parties, businesses, activeBiz }) {
  const [partyId, setPartyId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredParties = (activeBiz ? parties.filter(p => p.business_id === activeBiz) : parties)
    .slice().sort((a, b) => a.name.localeCompare(b.name));

  function applyPreset(preset) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === 'this_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(iso(now)); }
    else if (preset === 'last_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(iso(new Date(now.getFullYear(), now.getMonth(), 0))); }
    else { setDateFrom(''); setDateTo(''); }
  }

  const rows = (activeBiz ? payments.filter(p => p.business_id === activeBiz) : payments)
    .filter(p => !partyId || p.party_id === partyId)
    .filter(p => (!dateFrom || p.payment_date >= dateFrom) && (!dateTo || p.payment_date <= dateTo))
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
    .map(p => ({ ...p, party: parties.find(pt => pt.id === p.party_id) }));

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  function exportCSV() {
    const csvRows = rows.map(r => [r.payment_date, r.party?.name || '—', r.method || '', r.reference || '', Number(r.amount).toFixed(2)]);
    const csv = [['Date', 'Party', 'Method', 'Reference', 'Amount'].join(','),
      ...csvRows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `payments_${partyId ? (filteredParties.find(p => p.id === partyId)?.name || 'party') : 'all'}_${today()}.csv`.replace(/\s+/g, '_');
    a.click();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={partyId} onChange={e => setPartyId(e.target.value)}
          style={{ flex: 1, maxWidth: 260, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <option value="">All parties</option>
          {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12 }} />
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12 }} />
        {[['this_month', 'This Month'], ['last_month', 'Last Month'], ['all', 'All Time']].map(([k, l]) => (
          <button key={k} className="btn btn-ghost btn-sm" onClick={() => applyPreset(k)}>{l}</button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} disabled={!rows.length}>↓ CSV</button>
      </div>

      {rows.length === 0
        ? <EmptyState icon="💳" message="No payments" sub="No payments match this party/date range" />
        : (
          <>
            <div className="card" style={{ padding: '10px 14px', marginBottom: 14, maxWidth: 220 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>TOTAL</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{fmt(total)}</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Party</th><th>Method</th><th>Reference</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtDate(r.payment_date)}</td>
                      <td style={{ fontSize: 12.5, fontWeight: 500 }}>{r.party?.name || '—'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r.method || '—'}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.reference || '—'}</td>
                      <td className="r mono" style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border2)' }}>
                    <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL</td>
                    <td className="r mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
    </div>
  );
}

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────

export function ExportView({ invoices, expenses, payments, parties, businesses, activeBiz }) {
  const [type, setType] = useState('invoices');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;
  const be = activeBiz ? expenses.filter(e => e.business_id === activeBiz) : expenses;
  const bp = activeBiz ? payments.filter(p => bi.some(i => i.id === p.invoice_id)) : payments;

  function inRange(dateStr) {
    if (!dateStr) return true;
    const d = new Date(dateStr);
    if (fromDate && d < new Date(fromDate)) return false;
    if (toDate && d > new Date(toDate)) return false;
    return true;
  }

  function toCSV(headers, rows) {
    const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))];
    return lines.join('\n');
  }

  function download(csv, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename; a.click();
  }

  function exportInvoices() {
    const rows = bi.filter(i => inRange(i.issue_date)).map(inv => {
      const party = parties.find(p => p.id === inv.party_id);
      const pays = payments.filter(p => p.invoice_id === inv.id);
      const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
      return [inv.invoice_number, party?.name || '', party?.gstin || '', inv.issue_date, inv.due_date || '', inv.type, inv.status,
        inv.subtotal, inv.cgst_amount || 0, inv.sgst_amount || 0, inv.igst_amount || 0, inv.tax_amount || 0, inv.total, paid, Number(inv.total) - paid];
    });
    download(toCSV(['Invoice #','Party','GSTIN','Date','Due Date','Type','Status','Taxable','CGST','SGST','IGST','Total Tax','Invoice Total','Paid','Balance'], rows),
      `invoices_${today()}.csv`);
  }

  function exportExpenses() {
    const rows = be.filter(e => inRange(e.expense_date)).map(exp => {
      const vendor = parties.find(p => p.id === exp.vendor_id);
      return [exp.expense_date, exp.category, exp.description || '', vendor?.name || '', exp.method, exp.reference || '', exp.amount];
    });
    download(toCSV(['Date','Category','Description','Vendor','Method','Reference','Amount'], rows), `expenses_${today()}.csv`);
  }

  function exportPayments() {
    const rows = bp.filter(p => inRange(p.payment_date)).map(pay => {
      const inv = bi.find(i => i.id === pay.invoice_id);
      const party = parties.find(p => p.id === inv?.party_id);
      return [pay.payment_date, inv?.invoice_number || '', party?.name || '', pay.method, pay.reference || '', pay.amount];
    });
    download(toCSV(['Date','Invoice #','Party','Mode','Reference','Amount'], rows), `payments_${today()}.csv`);
  }

  function doExport() {
    if (type === 'invoices') exportInvoices();
    else if (type === 'expenses') exportExpenses();
    else exportPayments();
  }

  const counts = {
    invoices: bi.filter(i => inRange(i.issue_date)).length,
    expenses: be.filter(e => inRange(e.expense_date)).length,
    payments: bp.filter(p => inRange(p.payment_date)).length,
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="card">
        <div className="card-head">Export to CSV / Excel</div>
        <FG label="What to export" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['invoices', 'expenses', 'payments'].map(t => (
              <button key={t} className={`btn btn-sm ${type === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </FG>
        <div className="form-row cols-2">
          <FG label="From Date"><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></FG>
          <FG label="To Date"><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></FG>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
          {counts[type]} record(s) will be exported
        </div>
        <button className="btn btn-primary" onClick={doExport} disabled={counts[type] === 0}>
          ↓ Download CSV
        </button>
        <p style={{ fontSize: 11, color: 'var(--text4)', marginTop: 10 }}>
          CSV files open directly in Excel and Google Sheets. Unicode characters (₹) are preserved.
        </p>
      </div>
    </div>
  );
}

// ─── TDS TRACKER ──────────────────────────────────────────────────────────────

export function TDSView({ invoices, payments, parties, businesses, activeBiz }) {
  const [fy] = useState(getFY());
  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;

  // Collect invoices that have tds_amount set
  const tdsInvs = bi.filter(i => Number(i.tds_amount) > 0 && i.type === 'sale');

  const partyMap = {};
  tdsInvs.forEach(inv => {
    const party = parties.find(p => p.id === inv.party_id);
    const key = inv.party_id;
    if (!partyMap[key]) partyMap[key] = { name: party?.name || '—', pan: party?.pan || '—', tds: 0, invoices: 0, taxable: 0 };
    partyMap[key].tds += Number(inv.tds_amount || 0);
    partyMap[key].taxable += Number(inv.subtotal || 0);
    partyMap[key].invoices++;
  });
  const rows = Object.values(partyMap).sort((a, b) => b.tds - a.tds);
  const totalTDS = rows.reduce((s, r) => s + r.tds, 0);

  function exportCSV() {
    const lines = [['Party','PAN','Invoices','Taxable Amount','TDS Deducted'].join(','),
      ...rows.map(r => [r.name, r.pan, r.invoices, r.taxable.toFixed(2), r.tds.toFixed(2)].join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `tds_${fy}.csv`; a.click();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>FY {fy} · TDS SUMMARY</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>Total TDS: {fmt(totalTDS)}</div>
        </div>
        {rows.length > 0 && <button className="btn btn-ghost btn-sm" onClick={exportCSV}>↓ CSV</button>}
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '9px 13px' }}>
        ℹ TDS amounts are tracked per invoice. To add TDS to an invoice, edit it and set the <strong style={{ color: 'var(--text2)' }}>TDS Amount</strong> field.
      </div>

      {rows.length === 0
        ? <EmptyState icon="📋" message="No TDS recorded" sub="Edit invoices to add TDS deduction amounts" />
        : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Party</th><th>PAN</th><th className="r">Invoices</th><th className="r">Taxable Value</th><th className="r">TDS Deducted</th><th className="r">Effective Rate</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.pan}</td>
                    <td className="r mono">{r.invoices}</td>
                    <td className="r mono">{fmt(r.taxable)}</td>
                    <td className="r mono" style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(r.tds)}</td>
                    <td className="r mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.taxable > 0 ? ((r.tds / r.taxable) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border2)' }}>
                  <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL</td>
                  <td className="r mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>{fmt(totalTDS)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
    </div>
  );
}
