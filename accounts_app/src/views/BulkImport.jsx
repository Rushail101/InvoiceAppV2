/**
 * BulkImport.jsx — Multi-file ICICI XLS bulk import
 * Handles full-year backlog: upload many XLS files at once,
 * classify all transactions, group unclassified by pattern
 * for batch account assignment, then post everything in one shot.
 */
import { useState, useCallback, useRef } from 'react';
import { fmt } from '../lib/constants.js';
import { saveBankTxnWithJournal, savePayment, updateInvoiceStatus } from '../lib/db.js';

// ── XLS Parser (same as BankImport, extracted) ────────────────────────────────
async function loadSheetJS() {
  if (window.XLSX) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function parseXls(file) {
  await loadSheetJS();
  const ab = await file.arrayBuffer();
  const wb = window.XLSX.read(ab, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let headerRow = 6;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const s = (rows[i] || []).join(' ').toLowerCase();
    if (s.includes('transaction id') || s.includes('value date')) { headerRow = i; break; }
  }

  const txns = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || c === '')) continue;
    const txnId = row[1], rawDate = row[2], desc = String(row[5] || '').trim();
    const crDr = String(row[6] || '').trim().toUpperCase();
    const amount = parseFloat(row[7]);
    if (!desc || isNaN(amount) || amount <= 0 || !['CR','DR'].includes(crDr)) continue;

    let dateStr = '';
    if (rawDate instanceof Date) {
      dateStr = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}-${String(rawDate.getDate()).padStart(2,'0')}`;
    } else if (typeof rawDate === 'string' && rawDate.includes('/')) {
      const p = rawDate.split('/');
      dateStr = `${p[2].slice(0,4)}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    } else if (typeof rawDate === 'number') {
      const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
      dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    if (!dateStr) continue;
    txns.push({ date: dateStr, description: desc, reference: String(txnId || ''), type: crDr === 'CR' ? 'credit' : 'debit', amount, _file: file.name });
  }
  return txns;
}

// ── Rule Engine ────────────────────────────────────────────────────────────────
const RULES = [
  { match: ['tailored verse','odd mob','whitesockslab','scjersey','bake a film','proformaadvance','gaurish','tomsan'], type:'credit', dr:'Bank Account', cr:'Sales Revenue', label:'Customer Payment' },
  { match: ['foreign inward','rda foreign','inward remittance'], type:'credit', dr:'Bank Account', cr:'Sales Revenue', label:'Export Payment' },
  { match: ['blueheightsavia','capital','proprietor'], type:'credit', dr:'Bank Account', cr:"Owner's Capital", label:'Capital' },
  { match: ['porter','dtdc','bluedart','fedex','delhivery','xpressbees','ecomexpress','shiprocket','shipping','freight','courier'], type:'debit', dr:'Shipping & Freight', cr:'Bank Account', label:'Freight' },
  { match: ['fabric','fabr','cloth','denim','cotton','polyester','lining','interlining','woven','knit'], type:'debit', dr:'Raw Materials', cr:'Bank Account', label:'Fabric' },
  { match: ['thread','threads','zip','zips','zipper','button','buttons','kaajbutton','magnetbutton','elastic','label','labels','rivet','patch','velcro','felt','material','bags','bagsavation'], type:'debit', dr:'Raw Materials', cr:'Bank Account', label:'Trims' },
  { match: ['salary','sal ','wages','meerasalary','salarymamta','salarysaddam','advancesalary','hariram','masterjip','rambabu','worker','tailor'], type:'debit', dr:'Wages & Salaries', cr:'Bank Account', label:'Salary' },
  { match: ['gib/','gst','igst','cgst','sgst','gstn','gst challan','tax challan'], type:'debit', dr:'GST Payable (Output)', cr:'Bank Account', label:'GST' },
  { match: ['bses','electricity','bijli','msedcl','tata power','adani electric','bil/onl'], type:'debit', dr:'Utilities', cr:'Bank Account', label:'Electricity' },
  { match: ['waterbill','water bill','jal board','djb'], type:'debit', dr:'Utilities', cr:'Bank Account', label:'Water' },
  { match: ['rent','rental','landlord'], type:'debit', dr:'Rent', cr:'Bank Account', label:'Rent' },
  { match: ['amazon','flipkart','meesho'], type:'debit', dr:'Raw Materials', cr:'Bank Account', label:'Online Supplies' },
  { match: ['marketing','advertis','meta','google ads','facebook ads'], type:'debit', dr:'Marketing & Advertising', cr:'Bank Account', label:'Marketing' },
  { match: ['emi','loan repay','loan instalment'], type:'debit', dr:'Loans & Borrowings', cr:'Bank Account', label:'Loan EMI' },
  { match: ['drawings','personal use','self withdrawal'], type:'debit', dr:'Drawings', cr:'Bank Account', label:'Drawings' },
];

function classify(txn) {
  const desc = (txn.description || '').toLowerCase();
  const upiM = desc.match(/upi\/\d+\/([^/]+)\//);
  const combined = desc + ' ' + (upiM ? upiM[1] : '');
  for (const r of RULES) {
    if (r.type !== txn.type) continue;
    for (const kw of r.match) {
      if (combined.includes(kw)) return { dr: r.dr, cr: r.cr, label: r.label, confidence: 'high', kw };
    }
  }
  // Extract UPI purpose for grouping unclassified
  const purpose = upiM ? upiM[1].toLowerCase().replace(/[^a-z0-9]/g,' ').trim() : '';
  return { dr: '', cr: '', label: purpose || 'Unclassified', confidence: 'low', kw: null };
}

function dedupeKey(txn) { return `${txn.date}|${txn.amount}|${txn.type}|${txn.reference}`; }

// Check a freshly-parsed row against transactions ALREADY SAVED for this bank
// account (from a prior import or manual entry) so re-uploading the same
// statement, or an overlapping date range, doesn't create duplicate entries.
function findExistingDuplicate(txn, existingTxns) {
  if (!existingTxns?.length) return null;
  if (txn.reference) {
    const refMatch = existingTxns.find(e => e.reference && e.reference === txn.reference);
    if (refMatch) return 'Already imported — same transaction ID';
  }
  const fuzzyMatch = existingTxns.find(e =>
    e.txn_date === txn.date && Number(e.amount) === Number(txn.amount) && e.type === txn.type
  );
  if (fuzzyMatch) return 'Already recorded — same date & amount';
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function BulkImportView({ bankAccounts, bankTransactions = [], accounts, invoices, payments, parties, activeBiz, reload }) {
  const [step, setStep]         = useState('upload');    // upload|parsed|groupreview|posting|done
  const [files, setFiles]       = useState([]);
  const [allTxns, setAllTxns]   = useState([]);          // all parsed txns with classification
  const [groups, setGroups]     = useState([]);          // unclassified groups
  const [bankAccId, setBankAccId] = useState(bankAccounts[0]?.id || '');
  const [progress, setProgress] = useState('');
  const [results, setResults]   = useState({ posted: 0, jePosted: 0, skipped: 0, errors: [] });
  const [error, setError]       = useState('');
  const dragRef = useRef();
  const fileRef = useRef();

  // Scope to the SELECTED BANK ACCOUNT's own business, not the global "activeBiz"
  // sidebar filter. When the sidebar is on "All Businesses", activeBiz is '' — and
  // saveBankTxnWithJournal filters the Chart of Accounts by business_id === bizId,
  // so an empty bizId matches zero accounts and journal entries get silently
  // skipped even though the bank_transactions rows save fine.
  const selectedBankBiz = bankAccounts.find(b => b.id === bankAccId)?.business_id || activeBiz;
  const bizAccounts = (accounts || []).filter(a => a.business_id === selectedBankBiz);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
    const dropped = Array.from(e.dataTransfer?.files || e.target.files || [])
      .filter(f => f.name.toLowerCase().endsWith('.xls') || f.name.toLowerCase().endsWith('.xlsx'));
    if (!dropped.length) { setError('Please upload .xls or .xlsx files only.'); return; }
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...dropped.filter(f => !names.has(f.name))];
    });
    setError('');
  }, []);

  async function handleParseAll() {
    if (!files.length) return;
    if (!bankAccId) { setError('Select a bank account first.'); return; }
    setStep('parsed');
    setError('');

    const seen = new Set();
    let parsed = [];
    const existingForBank = bankTransactions.filter(b => b.bank_account_id === bankAccId);

    for (const file of files) {
      setProgress(`Parsing ${file.name}…`);
      try {
        const txns = await parseXls(file);
        for (const t of txns) {
          const k = dedupeKey(t);
          if (seen.has(k)) continue;
          seen.add(k);
          const dupeReason = findExistingDuplicate(t, existingForBank);
          parsed.push({
            ...t, cls: classify(t), bankAccountId: bankAccId,
            dupe: !!dupeReason, dupeReason,
            approved: false, skip: !!dupeReason,
          });
        }
      } catch (e) { setError(`Error in ${file.name}: ${e.message}`); }
    }

    // Sort by date
    parsed.sort((a, b) => a.date.localeCompare(b.date));

    // Auto-approve high-confidence rows (never auto-approve known duplicates)
    parsed = parsed.map(t => ({ ...t, approved: !t.dupe && t.cls.confidence === 'high' }));

    // Build unclassified groups for batch assignment — duplicates are already
    // skipped, so leave them out of the grouping workflow entirely.
    const unclassified = parsed.filter(t => t.cls.confidence === 'low' && !t.dupe);
    const groupMap = {};
    for (const t of unclassified) {
      const key = t.cls.label + '|' + t.type;
      if (!groupMap[key]) groupMap[key] = { label: t.cls.label, type: t.type, txns: [], dr: '', cr: '', assigned: false };
      groupMap[key].txns.push(t);
    }
    setGroups(Object.values(groupMap).sort((a, b) => b.txns.length - a.txns.length));
    setAllTxns(parsed);
    setStep('groupreview');
  }

  function applyGroupAssignment(groupIdx, dr, cr) {
    const g = groups[groupIdx];
    const txnKeys = new Set(g.txns.map(dedupeKey));
    setAllTxns(prev => prev.map(t =>
      txnKeys.has(dedupeKey(t))
        ? { ...t, cls: { ...t.cls, dr, cr, confidence: 'assigned' }, approved: true }
        : t
    ));
    setGroups(prev => prev.map((g2, i) => i !== groupIdx ? g2 : { ...g2, dr, cr, assigned: true }));
  }

  function skipGroup(groupIdx) {
    const g = groups[groupIdx];
    const txnKeys = new Set(g.txns.map(dedupeKey));
    setAllTxns(prev => prev.map(t => txnKeys.has(dedupeKey(t)) ? { ...t, skip: true, approved: false } : t));
    setGroups(prev => prev.map((g2, i) => i !== groupIdx ? g2 : { ...g2, assigned: true, skipped: true }));
  }

  async function handlePostAll() {
    const toPost = allTxns.filter(t => t.approved && !t.skip);
    if (!toPost.length) { setError('No transactions approved.'); return; }
    setStep('posting');
    let posted = 0, jePosted = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < toPost.length; i++) {
      if (i % 10 === 0) setProgress(`Posting ${i + 1} / ${toPost.length}…`);
      const t = toPost[i];
      try {
        const result = await saveBankTxnWithJournal(
          { ...t, partyId: null, _overrideDebit: t.cls.dr, _overrideCredit: t.cls.cr },
          accounts, selectedBankBiz
        );
        if (result.journalId) jePosted++; else skipped++;
        posted++;
      } catch (e) {
        errors.push(`${t.date} ₹${t.amount}: ${e.message}`);
      }
    }

    setResults({ posted, jePosted, skipped, errors });
    setStep('done');
    reload();
  }

  const approvedCount    = allTxns.filter(t => t.approved && !t.skip).length;
  const duplicateCount   = allTxns.filter(t => t.dupe).length;
  const unassignedGroups = groups.filter(g => !g.assigned).length;
  const classified       = allTxns.filter(t => t.cls.confidence === 'high' || t.cls.confidence === 'assigned').length;
  const totalCredit      = allTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const totalDebit       = allTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* ── UPLOAD ── */}
      {step === 'upload' && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Bank Account</label>
              <select value={bankAccId} onChange={e => setBankAccId(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 13 }}>
                {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div ref={dragRef}
            onDragOver={e => { e.preventDefault(); dragRef.current?.classList.add('drag-over'); }}
            onDragLeave={() => dragRef.current?.classList.remove('drag-over')}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{ border: '2px dashed var(--border2)', borderRadius: 10, padding: '40px 32px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg1)' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>Drop all ICICI XLS statements here</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
              Upload all 12 months at once — duplicates are removed automatically
            </div>
            <input ref={fileRef} type="file" accept=".xls,.xlsx" multiple style={{ display: 'none' }} onChange={onDrop} />
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{files.length} file{files.length !== 1 ? 's' : ''} queued</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border2)', fontSize: 12 }}>
                    📊 {f.name}
                    <button onClick={e => { e.stopPropagation(); setFiles(p => p.filter((_, j) => j !== i)); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{error}</p>}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleParseAll} disabled={!files.length || !bankAccId}>
              Parse {files.length} File{files.length !== 1 ? 's' : ''} →
            </button>
          </div>
        </>
      )}

      {/* ── PARSING SPINNER ── */}
      {step === 'parsed' && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⚙️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>{progress}</div>
        </div>
      )}

      {/* ── GROUP REVIEW ── */}
      {step === 'groupreview' && (
        <>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            {[
              { label: 'Total Txns',    val: allTxns.length,          color: 'var(--text1)' },
              { label: 'Auto-classified', val: classified,            color: '#4ade80' },
              { label: 'Already in ledger', val: duplicateCount,      color: '#94a3b8' },
              { label: 'Need review',   val: groups.filter(g => !g.assigned).length + ' groups', color: '#fbbf24' },
              { label: 'Total Credits', val: fmt(totalCredit),        color: '#4ade80' },
              { label: 'Total Debits',  val: fmt(totalDebit),         color: '#f87171' },
              { label: 'Ready to post', val: approvedCount,           color: 'var(--accent)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 14px', fontSize: 12, border: '1px solid var(--border2)' }}>
                <span style={{ color: 'var(--text3)' }}>{s.label} </span>
                <span style={{ color: s.color, fontWeight: 700, fontFamily: 'var(--mono)' }}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* Unclassified groups */}
          {groups.filter(g => !g.assigned).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', marginBottom: 10 }}>
                ⚠ {unassignedGroups} unclassified group{unassignedGroups !== 1 ? 's' : ''} — assign accounts or skip
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groups.map((g, gi) => g.assigned ? null : (
                  <UnclassifiedGroup
                    key={gi}
                    group={g}
                    accounts={bizAccounts}
                    onAssign={(dr, cr) => applyGroupAssignment(gi, dr, cr)}
                    onSkip={() => skipGroup(gi)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Assigned groups summary */}
          {groups.filter(g => g.assigned && !g.skipped).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>✅ Assigned groups</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {groups.filter(g => g.assigned && !g.skipped).map((g, i) => (
                  <div key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#0a1f12', border: '1px solid #1a5c36', color: '#4ade80', fontFamily: 'var(--mono)' }}>
                    {g.label} ({g.txns.length}) → {g.dr} / {g.cr}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border1)' }}>
            <button className="btn btn-ghost" onClick={() => setStep('upload')}>← Back</button>
            <button className="btn btn-primary" onClick={handlePostAll} disabled={!approvedCount}>
              Post {approvedCount} Transactions →
            </button>
          </div>
        </>
      )}

      {/* ── POSTING ── */}
      {step === 'posting' && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💾</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>{progress}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>Writing to Supabase — do not close the tab</div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>Backlog imported!</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginTop: 20 }}>
            {[
              { label: 'Transactions posted', val: results.posted, color: '#4ade80' },
              { label: 'Journal entries created', val: results.jePosted, color: '#60a5fa' },
              { label: 'JEs skipped (no account)', val: results.skipped, color: '#fbbf24' },
              { label: 'Errors', val: results.errors.length, color: '#f87171' },
            ].map(s => (
              <div key={s.label} style={{ padding: '16px 24px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border2)' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: 'var(--mono)' }}>{s.val}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {results.errors.length > 0 && (
            <div style={{ marginTop: 20, textAlign: 'left', maxWidth: 600, margin: '20px auto 0' }}>
              <div style={{ fontSize: 12, color: '#f87171', marginBottom: 6 }}>Errors:</div>
              {results.errors.map((e, i) => <div key={i} style={{ fontSize: 11, color: '#f87171', fontFamily: 'var(--mono)' }}>{e}</div>)}
            </div>
          )}
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => setStep('upload')}>
            Import More
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .drag-over { border-color: var(--accent) !important; background: var(--bg3) !important; }`}</style>
    </div>
  );
}

function UnclassifiedGroup({ group, accounts, onAssign, onSkip }) {
  const [dr, setDr] = useState('');
  const [cr, setCr] = useState('');
  const total = group.txns.reduce((s, t) => s + t.amount, 0);
  const isCredit = group.type === 'credit';

  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid #3a3a10' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', fontFamily: 'var(--mono)' }}>
          {group.label || '(unknown)'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{group.txns.length} txns</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCredit ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
          {isCredit ? '+' : '-'}{fmt(total)}
        </span>
      </div>
      {/* Sample descriptions */}
      <div style={{ marginBottom: 10 }}>
        {group.txns.slice(0, 3).map((t, i) => (
          <div key={i} style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.description}
          </div>
        ))}
        {group.txns.length > 3 && <div style={{ fontSize: 10, color: 'var(--text4)' }}>…and {group.txns.length - 3} more</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={dr} onChange={e => setDr(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12, flex: 1, minWidth: 140 }}>
          <option value="">Debit Account…</option>
          {accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <span style={{ color: 'var(--text4)', fontSize: 12 }}>→</span>
        <select value={cr} onChange={e => setCr(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 12, flex: 1, minWidth: 140 }}>
          <option value="">Credit Account…</option>
          {accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => onAssign(dr, cr)} disabled={!dr || !cr} style={{ fontSize: 11 }}>
          Apply to all {group.txns.length}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onSkip} style={{ fontSize: 11 }}>Skip</button>
      </div>
    </div>
  );
}
