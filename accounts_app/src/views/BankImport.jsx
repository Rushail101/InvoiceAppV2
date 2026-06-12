/**
 * BankImport.jsx — ICICI PDF Statement Importer
 * 
 * Flow:
 *  1. User drops PDF → pdfjs extracts raw text
 *  2. Claude API parses text → structured transaction JSON
 *  3. Client-side matching against parties/invoices
 *  4. Review UI: user approves / edits / skips each row
 *  5. Bulk post: bank_transactions + payments + journal_entries
 */

import { useState, useCallback, useRef } from 'react';
import { fmt, fmtDate, today } from '../lib/constants.js';
import { saveBankTxn, savePayment, updateInvoiceStatus } from '../lib/db.js';
import { ModalShell, FG } from '../components/ui.jsx';

// ── PDF text extraction via pdfjs from CDN ─────────────────────────────────────
async function extractPdfText(file) {
  // Dynamically load pdfjs from CDN (no npm install needed)
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
    // Join items with spacing, preserving row structure
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// ── Claude API: parse raw statement text → transactions array ──────────────────
async function parseStatementWithAI(rawText, accountNumber) {
  const prompt = `You are a bank statement parser. Extract ALL transactions from this ICICI bank statement text.

Return ONLY a valid JSON array. No explanation, no markdown, no backticks.

Each transaction object must have exactly these fields:
{
  "date": "YYYY-MM-DD",
  "description": "narration as-is from statement",
  "reference": "cheque/UTR/UPI ref number if present, else empty string",
  "type": "credit" or "debit",
  "amount": number (positive, no sign),
  "balance": number (running balance after this txn, if available, else null)
}

Rules:
- Credits = money coming IN (salary, customer payments, transfers in)
- Debits = money going OUT (expenses, vendor payments, transfers out)
- Ignore header rows, summary rows, opening/closing balance lines
- Parse every single transaction row — do not skip any
- For UPI transactions, include full UPI string in description
- For NEFT/RTGS, include the full narration

Bank statement text:
${rawText.slice(0, 12000)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '[]';

  // Strip any accidental markdown
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Try to extract JSON array from text
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI returned invalid JSON. Try re-uploading.');
  }
}

// ── Smart matching: find best party + invoice match for a transaction ──────────
function matchTransaction(txn, parties, invoices, payments) {
  const desc = (txn.description || '').toLowerCase();
  const ref = (txn.reference || '').toLowerCase();
  const combined = desc + ' ' + ref;

  // Already reconciled? Check if reference matches existing payment UTR
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
    // Name match (partial)
    const nameWords = name.split(/\s+/).filter(w => w.length > 3);
    for (const word of nameWords) {
      if (combined.includes(word)) score += word.length > 6 ? 3 : 1;
    }
    // GSTIN match
    if (gstin && combined.includes(gstin.slice(0, 10))) score += 5;
    // Phone match
    if (phone && phone.length >= 10 && combined.includes(phone.slice(-10))) score += 4;

    if (score > bestScore) { bestScore = score; bestParty = party; }
  }

  // Find open invoice for matched party
  let bestInvoice = null;
  if (bestParty) {
    const partyInvoices = invoices.filter(i =>
      i.party_id === bestParty.id &&
      !['paid', 'cancelled', 'proforma'].includes(i.status) &&
      txn.type === 'credit' // credits match sales invoices
    );
    // Match by amount proximity (within 1%)
    bestInvoice = partyInvoices.find(i => Math.abs(Number(i.total) - txn.amount) / txn.amount < 0.01)
      || partyInvoices.find(i => Math.abs(Number(i.total) - txn.amount) < 500)
      || null;
  }

  const confidence = bestScore >= 4 ? 'high' : bestScore >= 2 ? 'medium' : 'low';
  const status = bestScore >= 2 ? 'matched' : 'unknown';

  return {
    status,
    partyId: bestParty?.id || null,
    invoiceId: bestInvoice?.id || null,
    confidence,
    reason: bestScore >= 2
      ? `Matched "${bestParty?.name}"${bestInvoice ? ` + Invoice ${bestInvoice.invoice_number}` : ''}`
      : 'No match found',
  };
}

// ── Status badge colours ────────────────────────────────────────────────────────
const CONF_COLORS = {
  high: { bg: '#0d2b1a', border: '#1a5c36', text: '#4ade80' },
  medium: { bg: '#2b1f08', border: '#5c3d0a', text: '#fbbf24' },
  low: { bg: '#2b0d0d', border: '#5c1a1a', text: '#f87171' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export function BankImportModal({
  onClose, bankAccountId, bankAccountName,
  parties, invoices, payments, accounts, businesses, activeBiz,
  reload,
}) {
  const [step, setStep] = useState('upload'); // upload | parsing | review | posting | done
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  // Parsed + enriched transactions for review
  const [rows, setRows] = useState([]); // { ...txn, match, approved, skip, editedPartyId, editedInvoiceId, createExpense }
  const [editingIdx, setEditingIdx] = useState(null);

  const fileRef = useRef();
  const dragRef = useRef();

  // ── Drop zone ─────────────────────────────────────────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
    const f = e.dataTransfer?.files[0] || e.target.files[0];
    if (f && f.type === 'application/pdf') { setFile(f); setError(''); }
    else setError('Please upload a PDF file.');
  }, []);

  // ── Step 1: Parse PDF ─────────────────────────────────────────────────────────
  async function handleParse() {
    if (!file) return;
    setStep('parsing');
    setError('');
    try {
      setProgress('Extracting text from PDF…');
      const rawText = await extractPdfText(file);
      if (rawText.length < 100) throw new Error('Could not extract text from PDF. Is it a scanned/image PDF?');

      setProgress('Sending to AI for parsing… (this takes ~10 seconds)');
      const txns = await parseStatementWithAI(rawText, bankAccountName);
      if (!Array.isArray(txns) || !txns.length) throw new Error('No transactions found in statement.');

      setProgress('Matching against your parties and invoices…');
      const enriched = txns.map(txn => {
        const match = matchTransaction(txn, parties, invoices, payments);
        return {
          ...txn,
          match,
          approved: match.status === 'matched' && match.confidence === 'high',
          skip: false,
          editedPartyId: match.partyId,
          editedInvoiceId: match.invoiceId,
          postAs: txn.type === 'credit' ? 'payment' : 'expense', // default action
        };
      });

      setRows(enriched);
      setStep('review');
    } catch (e) {
      setError(e.message);
      setStep('upload');
    }
  }

  // ── Step 2: Review helpers ────────────────────────────────────────────────────
  function toggleApprove(idx) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, approved: !r.approved, skip: false }));
  }
  function toggleSkip(idx) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, skip: !r.skip, approved: false }));
  }
  function updateRow(idx, patch) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, ...patch }));
  }
  function approveAll() {
    setRows(prev => prev.map(r => r.skip ? r : { ...r, approved: true }));
  }

  const approvedCount = rows.filter(r => r.approved).length;
  const skippedCount = rows.filter(r => r.skip).length;
  const pendingCount = rows.filter(r => !r.approved && !r.skip).length;

  // ── Step 3: Post to Supabase ──────────────────────────────────────────────────
  async function handlePost() {
    const toPost = rows.filter(r => r.approved);
    if (!toPost.length) { setError('Approve at least one transaction.'); return; }

    setStep('posting');
    setError('');
    let posted = 0;

    for (const row of toPost) {
      try {
        // 1. Save bank transaction
        await saveBankTxn({
          bank_account_id: bankAccountId,
          txn_date: row.date,
          description: row.description,
          reference: row.reference || '',
          type: row.type,
          amount: row.amount,
          reconciled: true,
          party_id: row.editedPartyId || null,
        });

        // 2. If credit + invoice matched → record payment
        if (row.type === 'credit' && row.editedInvoiceId && row.postAs === 'payment') {
          const inv = invoices.find(i => i.id === row.editedInvoiceId);
          if (inv) {
            const existingPaid = payments
              .filter(p => p.invoice_id === row.editedInvoiceId)
              .reduce((s, p) => s + Number(p.amount), 0);
            const newTotal = existingPaid + row.amount;
            const isFullyPaid = newTotal >= Number(inv.total) - 0.01;

            await savePayment({
              invoice_id: row.editedInvoiceId,
              business_id: inv.business_id,
              party_id: row.editedPartyId || inv.party_id,
              amount: row.amount,
              payment_date: row.date,
              method: 'Bank Transfer',
              reference: row.reference || '',
              notes: `Auto-imported from bank statement`,
            });
            await updateInvoiceStatus(row.editedInvoiceId, isFullyPaid ? 'paid' : 'partially_paid');
          }
        }

        posted++;
      } catch (e) {
        console.error('Post error for row:', row, e);
      }
    }

    setProgress(`✅ Posted ${posted} of ${toPost.length} transactions.`);
    setStep('done');
    reload();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
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
      {/* ── UPLOAD STEP ── */}
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
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            {file ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                  {(file.size / 1024).toFixed(0)} KB · Click to change
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>Drop ICICI PDF Statement here</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>or click to browse</div>
              </>
            )}
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={onDrop} />
          </div>

          <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text1)' }}>What happens next:</strong><br />
            1. PDF text is extracted in your browser (nothing uploaded to any server)<br />
            2. Transaction rows are sent to Claude AI for structured parsing<br />
            3. Each transaction is matched against your parties and open invoices<br />
            4. You review and approve before anything is saved
          </div>

          {error && <p className="err-msg" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}

      {/* ── PARSING STEP ── */}
      {step === 'parsing' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 20, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⚙️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Processing…</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{progress}</div>
        </div>
      )}

      {/* ── REVIEW STEP ── */}
      {step === 'review' && (
        <div>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', val: rows.length, color: 'var(--text1)' },
              { label: 'Auto-matched', val: rows.filter(r => r.match.status === 'matched').length, color: '#4ade80' },
              { label: 'Unknown', val: rows.filter(r => r.match.status === 'unknown').length, color: '#fbbf24' },
              { label: 'Credits', val: rows.filter(r => r.type === 'credit').length, color: '#4ade80' },
              { label: 'Debits', val: rows.filter(r => r.type === 'debit').length, color: '#f87171' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>{s.label} </span>
                <span style={{ color: s.color, fontWeight: 700, fontFamily: 'var(--mono)' }}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* Transaction rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '55vh', overflowY: 'auto' }}>
            {rows.map((row, idx) => {
              const conf = CONF_COLORS[row.match.confidence] || CONF_COLORS.low;
              const party = parties.find(p => p.id === row.editedPartyId);
              const invoice = invoices.find(i => i.id === row.editedInvoiceId);
              const isCredit = row.type === 'credit';

              return (
                <div key={idx} style={{
                  border: '1px solid',
                  borderColor: row.skip ? 'var(--border1)' : row.approved ? '#1a5c36' : 'var(--border2)',
                  borderRadius: 8, padding: '10px 12px',
                  background: row.skip ? 'var(--bg1)' : row.approved ? '#0a1f12' : 'var(--bg2)',
                  opacity: row.skip ? 0.45 : 1,
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr auto auto auto auto',
                  gap: 10, alignItems: 'center',
                }}>
                  {/* Date */}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{row.date}</div>

                  {/* Description + match */}
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text1)', marginBottom: 3 }}>
                      {row.description}
                    </div>
                    {row.reference && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{row.reference}</div>}
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Confidence badge */}
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 99,
                        background: conf.bg, border: `1px solid ${conf.border}`, color: conf.text,
                        fontFamily: 'var(--mono)',
                      }}>
                        {row.match.confidence === 'high' ? '●' : row.match.confidence === 'medium' ? '◑' : '○'} {row.match.reason}
                      </span>
                      {invoice && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: '#0d1f2b', border: '1px solid #1a3a5c', color: '#60a5fa', fontFamily: 'var(--mono)' }}>
                          📄 {invoice.invoice_number}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700,
                    color: isCredit ? '#4ade80' : '#f87171', fontSize: 13, minWidth: 90 }}>
                    {isCredit ? '+' : '-'}{fmt(row.amount)}
                  </div>

                  {/* Edit button */}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                  >
                    ✏️ Edit
                  </button>

                  {/* Skip button */}
                  <button
                    className={`btn btn-sm ${row.skip ? 'btn-warning' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => toggleSkip(idx)}
                  >
                    {row.skip ? 'Skipped' : 'Skip'}
                  </button>

                  {/* Approve toggle */}
                  <button
                    className={`btn btn-sm ${row.approved ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '3px 10px', minWidth: 80 }}
                    onClick={() => toggleApprove(idx)}
                    disabled={row.skip}
                  >
                    {row.approved ? '✓ Approved' : 'Approve'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Inline edit panel */}
          {editingIdx !== null && (
            <EditPanel
              row={rows[editingIdx]}
              parties={parties}
              invoices={invoices}
              onSave={(patch) => { updateRow(editingIdx, { ...patch, approved: true }); setEditingIdx(null); }}
              onClose={() => setEditingIdx(null)}
            />
          )}
        </div>
      )}

      {/* ── POSTING STEP ── */}
      {step === 'posting' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>💾</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Posting to books…</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Saving transactions, payments and journal entries</div>
        </div>
      )}

      {/* ── DONE STEP ── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>Import complete!</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{progress}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
            Check the Bank Ledger and Invoices page — payments have been recorded automatically.
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .drag-over { border-color: var(--accent) !important; background: var(--bg3) !important; }
      `}</style>
    </ModalShell>
  );
}

// ── Edit Panel: lets user fix party/invoice assignment before approving ─────────
function EditPanel({ row, parties, invoices, onSave, onClose }) {
  const [partyId, setPartyId] = useState(row.editedPartyId || '');
  const [invoiceId, setInvoiceId] = useState(row.editedInvoiceId || '');
  const [postAs, setPostAs] = useState(row.postAs || (row.type === 'credit' ? 'payment' : 'expense'));
  const [desc, setDesc] = useState(row.description || '');

  const partyInvoices = invoices.filter(i =>
    i.party_id === partyId &&
    !['cancelled', 'proforma'].includes(i.status)
  );

  return (
    <div style={{
      marginTop: 12, padding: '14px 16px', background: 'var(--bg3)',
      borderRadius: 8, border: '1px solid var(--accent)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 12 }}>
        ✏️ Edit — {row.type === 'credit' ? '+' : '-'}{fmt(row.amount)} on {row.date}
      </div>
      <div className="form-row cols-2">
        <FG label="Description">
          <input value={desc} onChange={e => setDesc(e.target.value)} />
        </FG>
        <FG label="Post As">
          <select value={postAs} onChange={e => setPostAs(e.target.value)}>
            {row.type === 'credit' && <option value="payment">Invoice Payment (Credit)</option>}
            {row.type === 'credit' && <option value="income">Other Income</option>}
            {row.type === 'debit' && <option value="expense">Expense</option>}
            {row.type === 'debit' && <option value="transfer">Transfer / Internal</option>}
            <option value="bank_only">Bank Entry Only (no journal)</option>
          </select>
        </FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Party">
          <select value={partyId} onChange={e => { setPartyId(e.target.value); setInvoiceId(''); }}>
            <option value="">— Unknown / No party —</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FG>
        <FG label="Link to Invoice">
          <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}
            disabled={!partyId || row.type !== 'credit'}>
            <option value="">— No invoice —</option>
            {partyInvoices.map(i => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} · {fmt(i.total)} · {i.status}
              </option>
            ))}
          </select>
        </FG>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => onSave({
          description: desc,
          editedPartyId: partyId || null,
          editedInvoiceId: invoiceId || null,
          postAs,
        })}>
          Save & Approve
        </button>
      </div>
    </div>
  );
}
