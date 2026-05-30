/**
 * BankImport.jsx — ICICI XLS/PDF Statement Importer
 *
 * Flow:
 *  1. User drops XLS (or PDF) file
 *  2. XLS: parsed client-side with SheetJS (no AI needed)
 *     PDF: extracted via pdfjs + rule engine (no AI needed)
 *  3. Rule engine classifies each transaction → debit/credit accounts
 *  4. Review UI: user approves / edits / skips each row
 *  5. Bulk post: bank_transactions + journal_entries + payments
 *
 * ICICI XLS format (OpTransactionHistory*.xls):
 *  Row 0-4: header/blank
 *  Row 5:   account info line
 *  Row 6:   column headers
 *  Row 7+:  transactions
 *  Cols:    0=No, 1=TxnID, 2=ValueDate, 3=PostedDate, 4=ChequeNo,
 *           5=Description, 6=Cr/Dr, 7=Amount, 8=Balance
 */

import { useState, useCallback, useRef } from 'react';
import { fmt, fmtDate, today } from '../lib/constants.js';
import { saveBankTxnWithJournal, savePayment, updateInvoiceStatus } from '../lib/db.js';
import { ModalShell, FG } from '../components/ui.jsx';

// ══════════════════════════════════════════════════════════════════════════════
// RULE ENGINE — classify transactions without any AI
// ══════════════════════════════════════════════════════════════════════════════
//
// Rules are checked in order. First match wins.
// Each rule: { match: string[], type: 'debit'|'credit'|'any', debitAcct, creditAcct, label }
// "match" checks the UPI purpose field OR full description (lowercased).
//
const CLASSIFICATION_RULES = [
  // ── CREDITS (money IN) ─────────────────────────────────────────────────────
  // Customer payments via NEFT/UPI
  { match: ['tailored verse', 'odd mob', 'whitesockslab', 'scjersey', 'bake a film', 'proformaadvance', 'advance', 'gaurish', 'tomsan'],
    type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Sales Revenue', label: 'Customer Payment' },
  // Foreign inward remittance
  { match: ['foreign inward', 'rda foreign', 'inward remittance', 'fcy'],
    type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Sales Revenue', label: 'Export Payment' },
  // Capital / loan from partner
  { match: ['blueheightsavia', 'capital', 'proprietor', 'partner loan'],
    type: 'credit', debitAcct: 'Bank Account', creditAcct: "Owner's Capital", label: 'Capital Infusion' },

  // ── DEBITS (money OUT) ────────────────────────────────────────────────────
  // Logistics / Porter
  { match: ['porter', 'dtdc', 'bluedart', 'fedex', 'delhivery', 'xpressbees', 'ecomexpress', 'shiprocket', 'shipping', 'freight', 'courier', 'delivery'],
    type: 'debit', debitAcct: 'Shipping & Freight', creditAcct: 'Bank Account', label: 'Freight/Courier' },
  // Raw materials — fabric
  { match: ['fabric', 'fabr', 'cloth', 'denim', 'cotton', 'polyester', 'lining', 'interlining', 'woven', 'knit'],
    type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Fabric Purchase' },
  // Raw materials — trims & accessories
  { match: ['thread', 'threads', 'zip', 'zips', 'zipper', 'button', 'buttons', 'kaajbutton', 'magnetbutton', 'elastic', 'label', 'labels', 'tag', 'rivet', 'patch', 'velcro', 'felt', 'material', 'bags', 'bagsavation'],
    type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Trims/Accessories' },
  // Salary & wages
  { match: ['salary', 'sal ', 'wages', 'meerasalary', 'salarymamta', 'salarysaddam', 'advancesalary', 'hariram', 'masterjip', 'rambabu', 'worker', 'tailor', 'labour', 'labr'],
    type: 'debit', debitAcct: 'Wages & Salaries', creditAcct: 'Bank Account', label: 'Salary/Wages' },
  // GST challan
  { match: ['gib/', 'gst', 'igst', 'cgst', 'sgst', 'gstn', 'gst challan', 'tax challan'],
    type: 'debit', debitAcct: 'GST Payable (Output)', creditAcct: 'Bank Account', label: 'GST Payment' },
  // Electricity / Utilities
  { match: ['bses', 'electricity', 'bijli', 'msedcl', 'tata power', 'adani electric', 'power bill', 'bil/onl'],
    type: 'debit', debitAcct: 'Utilities', creditAcct: 'Bank Account', label: 'Electricity' },
  // Water
  { match: ['waterbill', 'water bill', 'jal board', 'djb'],
    type: 'debit', debitAcct: 'Utilities', creditAcct: 'Bank Account', label: 'Water Bill' },
  // Rent
  { match: ['rent', 'rental', 'landlord', 'property owner'],
    type: 'debit', debitAcct: 'Rent', creditAcct: 'Bank Account', label: 'Rent' },
  // Amazon / online purchases (supplies)
  { match: ['amazon', 'flipkart', 'meesho', 'myntra'],
    type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Online Supplies' },
  // Marketing
  { match: ['marketing', 'advertis', 'meta', 'google ads', 'facebook ads', 'instagram'],
    type: 'debit', debitAcct: 'Marketing & Advertising', creditAcct: 'Bank Account', label: 'Marketing' },
  // Software
  { match: ['software', 'subscription', 'saas', 'tally', 'zoho', 'microsoft', 'adobe', 'aws', 'google workspace'],
    type: 'debit', debitAcct: 'Software & Subscriptions', creditAcct: 'Bank Account', label: 'Software' },
  // Travel
  { match: ['uber', 'ola', 'petrol', 'diesel', 'fuel', 'travel', 'cab', 'auto ride'],
    type: 'debit', debitAcct: 'Travel & Conveyance', creditAcct: 'Bank Account', label: 'Travel' },
  // Loan repayment
  { match: ['emi', 'loan repay', 'loan instalment', 'loan emi'],
    type: 'debit', debitAcct: 'Loans & Borrowings', creditAcct: 'Bank Account', label: 'Loan Repayment' },
  // Drawings
  { match: ['drawings', 'personal use', 'self withdrawal'],
    type: 'debit', debitAcct: 'Drawings', creditAcct: 'Bank Account', label: 'Drawings' },
];

function classifyTransaction(txn) {
  // Extract UPI purpose field: UPI/<refno>/<purpose>/<vpa>/...
  const desc = (txn.description || '').toLowerCase();
  const upiPurposeMatch = desc.match(/upi\/\d+\/([^/]+)\//);
  const upiPurpose = upiPurposeMatch ? upiPurposeMatch[1].toLowerCase().trim() : '';
  const combined = desc + ' ' + upiPurpose;

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.type !== 'any' && rule.type !== txn.type) continue;
    for (const kw of rule.match) {
      if (combined.includes(kw.toLowerCase())) {
        return {
          debitAcct: rule.debitAcct,
          creditAcct: rule.creditAcct,
          label: rule.label,
          confidence: 'high',
          method: 'rule',
          matchedKeyword: kw,
        };
      }
    }
  }

  // Fallback: safe defaults
  return {
    debitAcct: txn.type === 'credit' ? 'Bank Account' : 'Miscellaneous Expenses',
    creditAcct: txn.type === 'credit' ? 'Other Income' : 'Bank Account',
    label: 'Unclassified',
    confidence: 'low',
    method: 'fallback',
    matchedKeyword: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// XLS PARSER — parse ICICI OpTransactionHistory XLS client-side via SheetJS
// ══════════════════════════════════════════════════════════════════════════════
async function parseICICIXls(file) {
  // Dynamically load SheetJS from CDN
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Find the header row (contains "Transaction ID" or "Value Date")
  let headerRow = 6; // default for ICICI OpTransactionHistory format
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const rowStr = (rows[i] || []).join(' ').toLowerCase();
    if (rowStr.includes('transaction id') || rowStr.includes('value date')) {
      headerRow = i;
      break;
    }
  }

  const transactions = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || c === '')) continue;

    // Col indices: 0=No, 1=TxnID, 2=ValueDate, 3=PostedDate, 4=ChequeNo, 5=Description, 6=CrDr, 7=Amount, 8=Balance
    const txnId   = row[1];
    const rawDate = row[2]; // Value Date
    const desc    = String(row[5] || '').trim();
    const crDr    = String(row[6] || '').trim().toUpperCase();
    const amount  = parseFloat(row[7]);
    const balance = parseFloat(row[8]);

    if (!desc || isNaN(amount) || amount <= 0) continue;
    if (!['CR', 'DR'].includes(crDr)) continue;

    // Parse date — could be a JS Date object (SheetJS with cellDates), string DD/MM/YYYY, or serial
    let dateStr = '';
    if (rawDate instanceof Date) {
      const y = rawDate.getFullYear();
      const m = String(rawDate.getMonth() + 1).padStart(2, '0');
      const d = String(rawDate.getDate()).padStart(2, '0');
      dateStr = `${y}-${m}-${d}`;
    } else if (typeof rawDate === 'string' && rawDate.includes('/')) {
      const parts = rawDate.split('/');
      if (parts.length === 3) {
        // DD/MM/YYYY
        dateStr = `${parts[2].slice(0,4)}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
    } else if (typeof rawDate === 'number') {
      // Excel date serial
      const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      dateStr = `${y}-${mo}-${da}`;
    }

    if (!dateStr) continue;

    transactions.push({
      date: dateStr,
      description: desc,
      reference: String(txnId || ''),
      type: crDr === 'CR' ? 'credit' : 'debit',
      amount,
      balance: isNaN(balance) ? null : balance,
    });
  }

  return transactions;
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF PARSER (fallback) — extract text via pdfjs, parse with regex
// ══════════════════════════════════════════════════════════════════════════════
async function parseICICIPdf(file) {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }

  // Try to parse ICICI PDF statement rows
  // Pattern: date description DR/CR amount balance
  const txns = [];
  const lines = fullText.split('\n');
  const txnPattern = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(CR|DR)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/;
  for (const line of lines) {
    const m = line.match(txnPattern);
    if (!m) continue;
    const [, rawDate, desc, crDr, rawAmt] = m;
    const parts = rawDate.split('/');
    const dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
    const amount = parseFloat(rawAmt.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) continue;
    txns.push({ date: dateStr, description: desc.trim(), reference: '', type: crDr === 'CR' ? 'credit' : 'debit', amount, balance: null });
  }
  return txns;
}

// ══════════════════════════════════════════════════════════════════════════════
// PARTY MATCHING (unchanged from v11)
// ══════════════════════════════════════════════════════════════════════════════
function matchTransaction(txn, parties, invoices, payments) {
  const desc = (txn.description || '').toLowerCase();
  const ref = (txn.reference || '').toLowerCase();
  const combined = desc + ' ' + ref;

  const alreadyPaid = payments.find(p =>
    p.reference && combined.includes(p.reference.toLowerCase())
  );
  if (alreadyPaid) return { status: 'duplicate', partyId: null, invoiceId: null, confidence: 'high', reason: 'Already recorded' };

  let bestParty = null;
  let bestScore = 0;
  for (const party of parties) {
    const name = party.name.toLowerCase();
    const gstin = (party.gstin || '').toLowerCase();
    const phone = (party.phone || '').replace(/\D/g, '');
    let score = 0;
    name.split(/\s+/).filter(w => w.length > 3).forEach(w => { if (combined.includes(w)) score += w.length > 6 ? 3 : 1; });
    if (gstin && combined.includes(gstin.slice(0, 10))) score += 5;
    if (phone && phone.length >= 10 && combined.includes(phone.slice(-10))) score += 4;
    if (score > bestScore) { bestScore = score; bestParty = party; }
  }

  let bestInvoice = null;
  if (bestParty) {
    const partyInvoices = invoices.filter(i =>
      i.party_id === bestParty.id &&
      !['paid', 'cancelled', 'proforma'].includes(i.status) &&
      txn.type === 'credit'
    );
    bestInvoice = partyInvoices.find(i => Math.abs(Number(i.total) - txn.amount) / txn.amount < 0.01)
      || partyInvoices.find(i => Math.abs(Number(i.total) - txn.amount) < 500) || null;
  }

  const confidence = bestScore >= 4 ? 'high' : bestScore >= 2 ? 'medium' : 'low';
  return {
    status: bestScore >= 2 ? 'matched' : 'unknown',
    partyId: bestParty?.id || null,
    invoiceId: bestInvoice?.id || null,
    confidence,
    reason: bestScore >= 2
      ? `Matched "${bestParty?.name}"${bestInvoice ? ` + Invoice ${bestInvoice.invoice_number}` : ''}`
      : 'No match found',
  };
}

const CONF_COLORS = {
  high:   { bg: '#0d2b1a', border: '#1a5c36', text: '#4ade80' },
  medium: { bg: '#2b1f08', border: '#5c3d0a', text: '#fbbf24' },
  low:    { bg: '#2b0d0d', border: '#5c1a1a', text: '#f87171' },
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export function BankImportModal({
  onClose, bankAccountId, bankAccountName,
  parties, invoices, payments, accounts, businesses, activeBiz,
  reload,
}) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [rows, setRows] = useState([]);
  const [editingIdx, setEditingIdx] = useState(null);
  const [jeResults, setJeResults] = useState([]);
  const fileRef = useRef();
  const dragRef = useRef();

  const isXls = file && (file.name.endsWith('.xls') || file.name.endsWith('.xlsx'));
  const isPdf = file && file.name.endsWith('.pdf');

  const onDrop = useCallback((e) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
    const f = e.dataTransfer?.files[0] || e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.pdf')) {
      setFile(f); setError('');
    } else {
      setError('Please upload an ICICI XLS statement (.xls / .xlsx) or PDF.');
    }
  }, []);

  async function handleParse() {
    if (!file) return;
    setStep('parsing');
    setError('');
    try {
      let txns = [];
      if (isXls) {
        setProgress('Reading XLS file…');
        txns = await parseICICIXls(file);
      } else {
        setProgress('Extracting PDF text…');
        txns = await parseICICIPdf(file);
      }
      if (!txns.length) throw new Error('No transactions found. Make sure this is an ICICI OpTransactionHistory export.');

      setProgress('Classifying transactions…');
      const enriched = txns.map(txn => {
        const je = classifyTransaction(txn);
        const match = matchTransaction(txn, parties, invoices, payments);
        return {
          ...txn,
          je,
          match,
          approved: match.status !== 'duplicate' && je.confidence === 'high',
          skip: match.status === 'duplicate',
          editedPartyId: match.partyId,
          editedInvoiceId: match.invoiceId,
          editedDebitAcct: je.debitAcct,
          editedCreditAcct: je.creditAcct,
          postAs: txn.type === 'credit' ? 'payment' : 'expense',
        };
      });

      setRows(enriched);
      setStep('review');
    } catch (e) {
      setError(e.message);
      setStep('upload');
    }
  }

  function toggleApprove(idx) { setRows(p => p.map((r, i) => i !== idx ? r : { ...r, approved: !r.approved, skip: false })); }
  function toggleSkip(idx)    { setRows(p => p.map((r, i) => i !== idx ? r : { ...r, skip: !r.skip, approved: false })); }
  function updateRow(idx, patch) { setRows(p => p.map((r, i) => i !== idx ? r : { ...r, ...patch })); }
  function approveAll()       { setRows(p => p.map(r => r.skip ? r : { ...r, approved: true })); }

  const approvedCount = rows.filter(r => r.approved).length;
  const skippedCount  = rows.filter(r => r.skip).length;
  const pendingCount  = rows.filter(r => !r.approved && !r.skip).length;
  const unclassifiedCount = rows.filter(r => r.je?.confidence === 'low').length;

  async function handlePost() {
    const toPost = rows.filter(r => r.approved);
    if (!toPost.length) { setError('Approve at least one transaction.'); return; }
    setStep('posting');
    setError('');
    let posted = 0, jePosted = 0, jeSkipped = 0;
    const results = [];

    for (let i = 0; i < toPost.length; i++) {
      const row = toPost[i];
      setProgress(`Posting transaction ${i + 1} of ${toPost.length}…`);
      try {
        // Use the user's (possibly edited) account selections
        const txnForJe = {
          ...row,
          bankAccountId,
          partyId: row.editedPartyId || null,
          // Override the auto-classification with user edits if changed
          _overrideDebit: row.editedDebitAcct,
          _overrideCredit: row.editedCreditAcct,
        };

        const result = await saveBankTxnWithJournal(txnForJe, accounts, activeBiz);
        results.push({ row, result });
        if (result.journalId) jePosted++;
        else jeSkipped++;

        // Invoice payment linkage
        if (row.type === 'credit' && row.editedInvoiceId && row.postAs === 'payment') {
          const inv = invoices.find(i => i.id === row.editedInvoiceId);
          if (inv) {
            const existingPaid = payments.filter(p => p.invoice_id === row.editedInvoiceId).reduce((s, p) => s + Number(p.amount), 0);
            const isFullyPaid = (existingPaid + row.amount) >= Number(inv.total) - 0.01;
            await savePayment({
              invoice_id: row.editedInvoiceId, business_id: inv.business_id,
              party_id: row.editedPartyId || inv.party_id, amount: row.amount,
              payment_date: row.date, method: 'Bank Transfer',
              reference: row.reference || '', notes: 'Auto-imported from bank statement',
            });
            await updateInvoiceStatus(row.editedInvoiceId, isFullyPaid ? 'paid' : 'partially_paid');
          }
        }
        posted++;
      } catch (e) {
        console.error('Post error:', row, e);
        results.push({ row, result: null, error: e.message });
      }
    }

    setJeResults(results);
    setProgress(`✅ Posted ${posted} transactions · ${jePosted} journal entries · ${jeSkipped} skipped (accounts not found).`);
    setStep('done');
    reload();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ModalShell
      title={`Import Bank Statement — ${bankAccountName}`}
      onClose={onClose}
      size="modal-xl"
      foot={
        step === 'upload' ? (
          <><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleParse} disabled={!file}>Parse Statement</button></>
        ) : step === 'review' ? (
          <><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <span style={{ fontSize: 12, color: 'var(--text3)', margin: 'auto 0' }}>
              {approvedCount} approved · {skippedCount} skipped · {pendingCount} pending
              {unclassifiedCount > 0 && <span style={{ color: '#fbbf24' }}> · {unclassifiedCount} unclassified</span>}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={approveAll}>✓ Approve All</button>
            <button className="btn btn-primary" onClick={handlePost} disabled={!approvedCount}>
              Post {approvedCount} Transaction{approvedCount !== 1 ? 's' : ''}
            </button></>
        ) : step === 'done' ? (
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        ) : null
      }
    >
      {/* ── UPLOAD ── */}
      {step === 'upload' && (
        <div>
          <div
            ref={dragRef}
            onDragOver={e => { e.preventDefault(); dragRef.current?.classList.add('drag-over'); }}
            onDragLeave={() => dragRef.current?.classList.remove('drag-over')}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: '2px dashed var(--border2)', borderRadius: 10, padding: '48px 32px',
              textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
              background: file ? 'var(--bg2)' : 'var(--bg1)',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>{file ? (isXls ? '📊' : '📄') : '📂'}</div>
            {file ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                  {(file.size / 1024).toFixed(0)} KB · {isXls ? 'XLS — will parse directly (no AI needed)' : 'PDF — will extract & classify'} · Click to change
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>Drop ICICI Statement here</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Accepts <strong style={{ color: 'var(--accent)' }}>.xls / .xlsx</strong> (OpTransactionHistory export) or PDF · click to browse
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xls,.xlsx,.pdf" style={{ display: 'none' }} onChange={onDrop} />
          </div>

          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, border: '1px solid var(--border2)' }}>
              <div style={{ fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>📊 XLS Upload (recommended)</div>
              Export from ICICI → OpTransactionHistory → Download as Excel.<br />
              Parsed entirely in your browser. No AI, no API calls, instant.
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, border: '1px solid var(--border2)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>📄 PDF Upload (fallback)</div>
              Drop a PDF statement if XLS isn't available.<br />
              Parsed via regex pattern matching.
            </div>
          </div>

          {error && <p className="err-msg" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}

      {/* ── PARSING ── */}
      {step === 'parsing' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 20, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⚙️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Processing…</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{progress}</div>
        </div>
      )}

      {/* ── REVIEW ── */}
      {step === 'review' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Total',         val: rows.length,                                                   color: 'var(--text1)' },
              { label: 'Classified',    val: rows.filter(r => r.je?.confidence === 'high').length,          color: '#4ade80' },
              { label: 'Unclassified',  val: unclassifiedCount,                                             color: '#fbbf24' },
              { label: 'Duplicates',    val: rows.filter(r => r.match?.status === 'duplicate').length,      color: '#94a3b8' },
              { label: 'Credits',       val: rows.filter(r => r.type === 'credit').length,                  color: '#4ade80' },
              { label: 'Debits',        val: rows.filter(r => r.type === 'debit').length,                   color: '#f87171' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>{s.label} </span>
                <span style={{ color: s.color, fontWeight: 700, fontFamily: 'var(--mono)' }}>{s.val}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '55vh', overflowY: 'auto' }}>
            {rows.map((row, idx) => {
              const conf = CONF_COLORS[row.je?.confidence] || CONF_COLORS.low;
              const isCredit = row.type === 'credit';
              return (
                <div key={idx} style={{
                  border: '1px solid',
                  borderColor: row.skip ? 'var(--border1)' : row.approved ? '#1a5c36' : 'var(--border2)',
                  borderRadius: 8, padding: '9px 12px',
                  background: row.skip ? 'var(--bg1)' : row.approved ? '#0a1f12' : 'var(--bg2)',
                  opacity: row.skip ? 0.45 : 1,
                  display: 'grid',
                  gridTemplateColumns: '88px 1fr auto auto auto auto',
                  gap: 8, alignItems: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{row.date}</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text1)', marginBottom: 3 }}>{row.description}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
                      {/* JE classification badge */}
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 99,
                        background: conf.bg, border: `1px solid ${conf.border}`, color: conf.text,
                        fontFamily: 'var(--mono)',
                      }}>
                        {row.je?.confidence === 'high' ? '⚡' : '?'} {row.editedDebitAcct} → {row.editedCreditAcct}
                        {row.je?.matchedKeyword && <span style={{ opacity: 0.7 }}> [{row.je.matchedKeyword}]</span>}
                      </span>
                      {/* Party match badge */}
                      {row.match?.status === 'matched' && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: '#0d1f2b', border: '1px solid #1a3a5c', color: '#60a5fa', fontFamily: 'var(--mono)' }}>
                          👤 {row.match.reason}
                        </span>
                      )}
                      {row.match?.status === 'duplicate' && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: '#1a1a2b', border: '1px solid #2a2a5c', color: '#94a3b8', fontFamily: 'var(--mono)' }}>
                          ⊘ Duplicate
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700,
                    color: isCredit ? '#4ade80' : '#f87171', fontSize: 13, minWidth: 90 }}>
                    {isCredit ? '+' : '-'}{fmt(row.amount)}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}>✏️ Edit</button>
                  <button className={`btn btn-sm ${row.skip ? 'btn-warning' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => toggleSkip(idx)}>
                    {row.skip ? 'Skipped' : 'Skip'}
                  </button>
                  <button className={`btn btn-sm ${row.approved ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '3px 10px', minWidth: 80 }}
                    onClick={() => toggleApprove(idx)} disabled={row.skip}>
                    {row.approved ? '✓ Approved' : 'Approve'}
                  </button>
                </div>
              );
            })}
          </div>

          {editingIdx !== null && (
            <EditPanel
              row={rows[editingIdx]}
              parties={parties}
              invoices={invoices}
              accounts={accounts}
              activeBiz={activeBiz}
              onSave={(patch) => { updateRow(editingIdx, { ...patch, approved: true }); setEditingIdx(null); }}
              onClose={() => setEditingIdx(null)}
            />
          )}
        </div>
      )}

      {/* ── POSTING ── */}
      {step === 'posting' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>💾</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Posting to books…</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{progress}</div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === 'done' && (
        <div style={{ padding: '24px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80', marginBottom: 6 }}>Import complete!</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>{progress}</div>
          </div>
          {jeResults.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Journal Entry Log
              </div>
              <div style={{ maxHeight: '45vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {jeResults.map(({ row, result, error: rowErr }, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 10, alignItems: 'center',
                    padding: '7px 12px', borderRadius: 6,
                    background: rowErr ? '#1f0a0a' : result?.journalId ? '#0a1a0f' : '#1a1a0a',
                    border: `1px solid ${rowErr ? '#5c1a1a' : result?.journalId ? '#1a4a2a' : '#3a3a10'}`,
                  }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{row.date}</div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text1)', marginBottom: 2 }}>{row.description}</div>
                      {result?.journalId && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                          Dr <span style={{ color: '#60a5fa' }}>{result.mapping?.debitAcct}</span>
                          {' / '}Cr <span style={{ color: '#a78bfa' }}>{result.mapping?.creditAcct}</span>
                        </div>
                      )}
                      {result?.skipped && <div style={{ fontSize: 11, color: '#fbbf24' }}>⚠ Account not found — check Chart of Accounts</div>}
                      {rowErr && <div style={{ fontSize: 11, color: '#f87171' }}>Error: {rowErr}</div>}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12,
                      color: row.type === 'credit' ? '#4ade80' : '#f87171', textAlign: 'right' }}>
                      {row.type === 'credit' ? '+' : '-'}₹{row.amount.toLocaleString('en-IN')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .drag-over { border-color: var(--accent) !important; background: var(--bg3) !important; }
      `}</style>
    </ModalShell>
  );
}

// ── Edit Panel ─────────────────────────────────────────────────────────────────
function EditPanel({ row, parties, invoices, accounts, activeBiz, onSave, onClose }) {
  const [partyId, setPartyId] = useState(row.editedPartyId || '');
  const [invoiceId, setInvoiceId] = useState(row.editedInvoiceId || '');
  const [debitAcct, setDebitAcct] = useState(row.editedDebitAcct || row.je?.debitAcct || '');
  const [creditAcct, setCreditAcct] = useState(row.editedCreditAcct || row.je?.creditAcct || '');
  const [postAs, setPostAs] = useState(row.postAs || (row.type === 'credit' ? 'payment' : 'expense'));

  const bizAccounts = (accounts || []).filter(a => a.business_id === activeBiz);
  const partyInvoices = invoices.filter(i => i.party_id === partyId && !['cancelled', 'proforma'].includes(i.status));

  return (
    <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--accent)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 12 }}>
        ✏️ Edit — {row.type === 'credit' ? '+' : '-'}{fmt(row.amount)} on {row.date}
      </div>
      <div className="form-row cols-2">
        <FG label="Debit Account">
          <select value={debitAcct} onChange={e => setDebitAcct(e.target.value)}>
            <option value="">— Select account —</option>
            {bizAccounts.map(a => <option key={a.id} value={a.name}>{a.name} ({a.code})</option>)}
          </select>
        </FG>
        <FG label="Credit Account">
          <select value={creditAcct} onChange={e => setCreditAcct(e.target.value)}>
            <option value="">— Select account —</option>
            {bizAccounts.map(a => <option key={a.id} value={a.name}>{a.name} ({a.code})</option>)}
          </select>
        </FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Party">
          <select value={partyId} onChange={e => { setPartyId(e.target.value); setInvoiceId(''); }}>
            <option value="">— No party —</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FG>
        <FG label="Link Invoice">
          <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}
            disabled={!partyId || row.type !== 'credit'}>
            <option value="">— No invoice —</option>
            {partyInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} · ₹{i.total} · {i.status}</option>)}
          </select>
        </FG>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => onSave({
          editedPartyId: partyId || null,
          editedInvoiceId: invoiceId || null,
          editedDebitAcct: debitAcct,
          editedCreditAcct: creditAcct,
          postAs,
        })}>Save & Approve</button>
      </div>
    </div>
  );
}
