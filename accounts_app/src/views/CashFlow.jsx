/**
 * CashFlow.jsx — Monthly Cash Flow Statement
 *
 * Builds indirect-method cash flow from journal entries:
 *  Operating:  Collections (AR/Sales), Payments (wages, materials, utilities, GST, misc)
 *  Investing:  Fixed asset purchases/sales
 *  Financing:  Capital infusions, loan drawdowns, loan repayments, drawings
 *
 * Month selector + running chart of net cash flow.
 */
import { useState, useMemo } from 'react';
import { fmt } from '../lib/constants.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Map account group/name substrings → cash flow section + sign
// sign: +1 = cash in, -1 = cash out
const ACCOUNT_MAP = [
  // Operating — inflows
  { match: ['sales revenue','other income','interest income'],        section:'operating',  sign:+1, label:'Collections from customers' },
  // Operating — outflows
  { match: ['raw material','wages','salary','utilities','rent','shipping','freight','marketing','software','travel','miscellaneous expense','gst payable'],
                                                                      section:'operating',  sign:-1, label:'Payments (expenses)' },
  // Investing
  { match: ['fixed asset','equipment','machinery','capital work'],    section:'investing',  sign:-1, label:'Asset purchases' },
  { match: ['asset disposal','asset sale'],                           section:'investing',  sign:+1, label:'Asset sale proceeds' },
  // Financing — inflows
  { match: ["owner's capital","partner loan","loans & borrowings"],   section:'financing',  sign:+1, label:'Capital / Loan inflows' },
  // Financing — outflows
  { match: ['drawings','loan repayment'],                             section:'financing',  sign:-1, label:'Drawings / Loan repayments' },
];

function mapAccount(accountName) {
  const n = (accountName || '').toLowerCase();
  for (const rule of ACCOUNT_MAP) {
    for (const kw of rule.match) {
      if (n.includes(kw)) return rule;
    }
  }
  return { section: 'operating', sign: -1, label: 'Other operating' };
}

function buildMonthlyFlow(journalEntries, journalLines, accounts, activeBiz, year) {
  const bizAccountIds = new Set(accounts.filter(a => a.business_id === activeBiz).map(a => a.id));
  const bankAcct = accounts.find(a => a.business_id === activeBiz && a.name.toLowerCase().includes('bank'));

  // For each JE that touches Bank Account, look at the OTHER side to categorise
  const relevantJEs = journalEntries.filter(j => j.business_id === activeBiz && j.entry_date?.startsWith(String(year)));

  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    operating: [],
    investing: [],
    financing: [],
  }));

  for (const je of relevantJEs) {
    const mo = parseInt(je.entry_date?.slice(5, 7)) - 1;
    if (mo < 0 || mo > 11) continue;
    const lines = journalLines.filter(l => l.journal_id === je.id);
    const bankLine = bankAcct ? lines.find(l => l.account_id === bankAcct.id) : null;
    if (!bankLine) continue;

    // Cash movement = net change on Bank account line
    const cashIn  = Number(bankLine.debit  || 0);
    const cashOut = Number(bankLine.credit || 0);
    const netCash = cashIn - cashOut; // positive = cash in

    // Find the contra account to categorise
    const contraLine = lines.find(l => l.account_id !== bankAcct.id && bizAccountIds.has(l.account_id));
    const contraAcct = contraLine ? accounts.find(a => a.id === contraLine.account_id) : null;
    const rule = mapAccount(contraAcct?.name);

    monthly[mo][rule.section].push({
      amount: Math.abs(netCash),
      isInflow: netCash > 0,
      label: contraAcct?.name || je.narration || 'Bank movement',
      narration: je.narration,
      date: je.entry_date,
    });
  }

  return monthly;
}

function sectionTotal(items) {
  return items.reduce((s, item) => s + (item.isInflow ? item.amount : -item.amount), 0);
}

export function CashFlowView({ journalEntries, journalLines, accounts, bankTransactions, activeBiz }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear]     = useState(currentYear);
  const [selMonth, setSelMonth] = useState(null); // null = show all months
  const [expandSec, setExpandSec] = useState({ operating: false, investing: false, financing: false });

  const monthly = useMemo(() =>
    buildMonthlyFlow(journalEntries, journalLines, accounts, activeBiz, year),
    [journalEntries, journalLines, accounts, activeBiz, year]
  );

  const summary = useMemo(() => monthly.map(m => ({
    month: m.month,
    operating: sectionTotal(m.operating),
    investing: sectionTotal(m.investing),
    financing: sectionTotal(m.financing),
    net: sectionTotal(m.operating) + sectionTotal(m.investing) + sectionTotal(m.financing),
  })), [monthly]);

  // Bar chart max
  const maxAbs = Math.max(...summary.map(s => Math.abs(s.net)), 1);

  const displayMonths = selMonth !== null ? [monthly[selMonth - 1]] : monthly;
  const totOp  = summary.reduce((s, m) => s + m.operating, 0);
  const totInv = summary.reduce((s, m) => s + m.investing, 0);
  const totFin = summary.reduce((s, m) => s + m.financing, 0);
  const totNet = totOp + totInv + totFin;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Year</label>
          <select value={year} onChange={e => { setYear(Number(e.target.value)); setSelMonth(null); }}
            style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 13 }}>
            {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Month</label>
          <select value={selMonth || ''} onChange={e => setSelMonth(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 13 }}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
        </div>
        {selMonth && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => setSelMonth(null)}>
            ✕ Clear month filter
          </button>
        )}
      </div>

      {/* Annual summary bar chart */}
      {!selMonth && (
        <div style={{ marginBottom: 24, padding: '16px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            Monthly Net Cash Flow — {year}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 80 }}>
            {summary.map((s, i) => {
              const h = Math.max(4, Math.round(Math.abs(s.net) / maxAbs * 76));
              const isPos = s.net >= 0;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                  onClick={() => setSelMonth(s.month)}>
                  <div style={{ fontSize: 10, color: isPos ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)', fontWeight: 700 }}>
                    {s.net !== 0 ? (isPos ? '+' : '') + Math.round(s.net / 1000) + 'k' : ''}
                  </div>
                  <div style={{ width: '100%', height: h, borderRadius: 4, background: isPos ? '#1a5c36' : '#5c1a1a', border: `1px solid ${isPos ? '#4ade80' : '#f87171'}22` }} />
                  <div style={{ fontSize: 9, color: 'var(--text4)' }}>{MONTHS[i]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Annual totals */}
      {!selMonth && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Operating Cash Flow',  val: totOp,  icon: '⚙️' },
            { label: 'Investing Cash Flow',  val: totInv, icon: '🏗' },
            { label: 'Financing Cash Flow',  val: totFin, icon: '💼' },
            { label: 'Net Cash Flow',        val: totNet, icon: '💰', bold: true },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, minWidth: 160, padding: '14px 16px', background: 'var(--bg2)', borderRadius: 10, border: `1px solid ${s.val >= 0 ? '#1a4a2a' : '#4a1a1a'}` }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: s.bold ? 22 : 20, fontWeight: 800, color: s.val >= 0 ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)' }}>
                {s.val >= 0 ? '+' : ''}{fmt(s.val)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detailed section breakdown */}
      {displayMonths.map((m, mi) => {
        const opTotal  = sectionTotal(m.operating);
        const invTotal = sectionTotal(m.investing);
        const finTotal = sectionTotal(m.financing);
        const netTotal = opTotal + invTotal + finTotal;

        return (
          <div key={m.month} style={{ marginBottom: 16, background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border2)', overflow: 'hidden' }}>
            {/* Month header */}
            <div style={{ padding: '12px 16px', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text1)' }}>
                {MONTHS[m.month - 1]} {year}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: netTotal >= 0 ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)' }}>
                Net: {netTotal >= 0 ? '+' : ''}{fmt(netTotal)}
              </div>
            </div>

            {/* Three sections */}
            {[
              { key: 'operating',  items: m.operating,  total: opTotal,  icon: '⚙️', label: 'Operating Activities' },
              { key: 'investing',  items: m.investing,  total: invTotal, icon: '🏗',  label: 'Investing Activities' },
              { key: 'financing',  items: m.financing,  total: finTotal, icon: '💼', label: 'Financing Activities' },
            ].map(sec => (
              <div key={sec.key} style={{ borderTop: '1px solid var(--border1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', cursor: 'pointer' }}
                  onClick={() => setExpandSec(p => ({ ...p, [sec.key]: !p[sec.key] }))}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)' }}>{sec.icon} {sec.label}</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: sec.total >= 0 ? '#4ade80' : '#f87171' }}>
                      {sec.total >= 0 ? '+' : ''}{fmt(sec.total)}
                    </span>
                    <span style={{ color: 'var(--text4)', fontSize: 11 }}>{expandSec[sec.key] ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expandSec[sec.key] && sec.items.length > 0 && (
                  <div style={{ padding: '0 16px 12px' }}>
                    {sec.items.map((item, ii) => (
                      <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border1)', fontSize: 12 }}>
                        <div>
                          <span style={{ color: 'var(--text2)' }}>{item.label}</span>
                          {item.narration && item.narration !== item.label && (
                            <span style={{ color: 'var(--text4)', marginLeft: 6, fontSize: 11 }}>— {item.narration}</span>
                          )}
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', color: item.isInflow ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                          {item.isInflow ? '+' : '-'}{fmt(item.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {expandSec[sec.key] && sec.items.length === 0 && (
                  <div style={{ padding: '8px 16px 12px', fontSize: 12, color: 'var(--text4)' }}>No entries this month</div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
