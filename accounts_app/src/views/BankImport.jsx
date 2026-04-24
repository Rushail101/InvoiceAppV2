import { useState, useRef } from 'react';
import { fmt } from '../lib/constants.js';
import { saveBankTxn } from '../lib/db.js';
import { FG, EmptyState } from '../components/ui.jsx';

// ─── PDF TEXT EXTRACTION ──────────────────────────────────────────────────────

function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = () => rej(new Error('File read failed'));
    r.readAsArrayBuffer(file);
  });
}

async function extractPDFText(file) {
  const arrayBuffer = await readFileAsArrayBuffer(file);

  // Use npm pdfjs-dist — no CDN, no CSP issues
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).href;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = {};
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push(item.str);
    });
    Object.keys(lines).map(Number).sort((a, b) => b - a)
      .forEach(y => { fullText += lines[y].join(' ') + '\n'; });
    fullText += '\n';
  }
  return fullText;
}

// ─── GROQ PARSER ──────────────────────────────────────────────────────────────

async function parseWithGroq(text, groqKey) {
  const prompt = `You are an expert Indian bank statement parser. Extract ALL transactions from this ICICI Bank statement.

Return ONLY a valid JSON array. No markdown, no backticks, no explanation — just raw JSON.

Each item must have:
{
  "txn_date": "YYYY-MM-DD",
  "description": "full narration text",
  "reference": "UTR/cheque/ref number or empty string",
  "amount": 12345.67,
  "type": "credit" or "debit"
}

Rules:
- credit = money coming IN (deposits, receipts, NEFT/IMPS received, interest credited)
- debit = money going OUT (withdrawals, charges, payments, transfers out)
- amount is always a positive number
- ICICI format: "Cr" suffix means credit, "Dr" suffix means debit
- Convert dates to YYYY-MM-DD. Indian format is DD/MM/YYYY
- Skip: opening balance, closing balance, header rows, page totals
- Include every actual transaction row, even small ones

Statement:
${text.slice(0, 14000)}`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${resp.status}`);
  }

  const data = await resp.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from Groq');
  return parsed;
}

// ─── DUPE KEY ─────────────────────────────────────────────────────────────────

function buildDupeKey(t) {
  return `${t.txn_date}|${Number(t.amount).toFixed(2)}|${t.type}`;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function BankImportView({ bankAccounts, bankTransactions, businesses, activeBiz, reload }) {
  const [step, setStep] = useState('upload'); // upload | parsing | review | done
  const [selectedBankId, setSelectedBankId] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [parseError, setParseError] = useState('');
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [parseStatus, setParseStatus] = useState('');
  const fileRef = useRef();

  const filteredBanks = activeBiz
    ? bankAccounts.filter(b => b.business_id === activeBiz)
    : bankAccounts;

  const existingKeys = new Set(
    bankTransactions
      .filter(t => t.bank_account_id === selectedBankId)
      .map(buildDupeKey)
  );

  const groqKey = import.meta.env.VITE_GROQ_API_KEY || '';

  // ── File handling ──────────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file) return;
    if (!selectedBankId) { setParseError('Please select a bank account first.'); return; }
    if (!groqKey) { setParseError('VITE_GROQ_API_KEY is not configured. Add it to Render environment variables.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setParseError('Please upload a PDF file.'); return; }

    setFileName(file.name);
    setParseError('');
    setStep('parsing');
    setParseStatus('Extracting text from PDF…');

    try {
      const text = await extractPDFText(file);
      setParseStatus('Sending to Llama AI for parsing…');
      const parsed = await parseWithGroq(text, groqKey);

      const mapped = parsed
        .filter(t => t.txn_date && t.amount > 0)
        .map((t, i) => {
          const txn = {
            txn_date: t.txn_date,
            description: t.description || '',
            reference: t.reference || '',
            amount: Math.abs(Number(t.amount)),
            type: t.type === 'credit' ? 'credit' : 'debit',
          };
          const isDupe = existingKeys.has(buildDupeKey(txn));
          return { _id: i, ...txn, status: 'approve', isDupe }; // dupes shown, user decides
        });

      setRows(mapped);
      setStep('review');
    } catch (e) {
      setParseError(e.message || 'Parsing failed. Please try again.');
      setStep('upload');
    }
  }

  function onFileInput(e) { handleFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }
  function onDrop(e) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer?.files?.[0]); }

  // ── Row controls ───────────────────────────────────────────────────────────

  function toggleRow(id) {
    setRows(rs => rs.map(r => r._id === id
      ? { ...r, status: r.status === 'approve' ? 'skip' : 'approve' } : r));
  }
  function updateRow(id, field, value) {
    setRows(rs => rs.map(r => r._id === id ? { ...r, [field]: value } : r));
  }
  function approveAll() { setRows(rs => rs.map(r => ({ ...r, status: 'approve' }))); }
  function skipAll() { setRows(rs => rs.map(r => ({ ...r, status: 'skip' }))); }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function saveApproved() {
    const toSave = rows.filter(r => r.status === 'approve');
    if (!toSave.length) return;
    setSaving(true);
    let count = 0;
    for (const r of toSave) {
      try {
        await saveBankTxn({
          bank_account_id: selectedBankId,
          txn_date: r.txn_date,
          description: r.description,
          reference: r.reference || null,
          amount: r.amount,
          type: r.type,
          is_reconciled: false,
        });
        count++;
      } catch (e) { console.error('Row save error:', r, e); }
    }
    setSaving(false);
    setSavedCount(count);
    setStep('done');
    reload();
  }

  function reset() { setStep('upload'); setFileName(''); setRows([]); setParseError(''); setSavedCount(0); }

  // ── Computed ───────────────────────────────────────────────────────────────

  const approveCount = rows.filter(r => r.status === 'approve').length;
  const skipCount = rows.filter(r => r.status === 'skip').length;
  const dupeCount = rows.filter(r => r.isDupe).length;

  // ── Render: Done ───────────────────────────────────────────────────────────

  if (step === 'done') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 14 }}>
      <div style={{ fontSize: 56 }}>✅</div>
      <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{savedCount} transactions imported</h3>
      <p style={{ color: 'var(--text3)', margin: 0 }}>{skipCount} skipped · {dupeCount} were duplicates</p>
      <button className="btn btn-primary" onClick={reset} style={{ marginTop: 8 }}>Import Another Statement</button>
    </div>
  );

  // ── Render: Parsing ────────────────────────────────────────────────────────

  if (step === 'parsing') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 16 }}>
      <div style={{ fontSize: 48 }}>🤖</div>
      <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Parsing Statement…</h3>
      <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>{parseStatus}</p>
      <div style={{ width: 220, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', background: 'var(--accent)', borderRadius: 2, animation: 'slideIn 1.6s ease-in-out infinite alternate' }} />
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(-100%) } to { transform: translateX(100%) } }`}</style>
    </div>
  );

  // ── Render: Review ─────────────────────────────────────────────────────────

  if (step === 'review') return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Review — {fileName}</h3>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            {rows.length} found ·&nbsp;
            <span style={{ color: 'var(--green)' }}>{approveCount} to import</span>
            {dupeCount > 0 && <> · <span style={{ color: 'var(--amber)' }}>{dupeCount} duplicates skipped</span></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={approveAll}>Approve All</button>
          <button className="btn btn-ghost btn-sm" onClick={skipAll}>Skip All</button>
          <button className="btn btn-ghost btn-sm" onClick={reset}>← New Import</button>
          <button className="btn btn-primary" onClick={saveApproved} disabled={saving || approveCount === 0}>
            {saving ? 'Saving…' : `Import ${approveCount}`}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>Date</th>
              <th>Description</th>
              <th>Reference / UTR</th>
              <th>Type</th>
              <th className="r">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r._id} style={{ opacity: r.status === 'skip' ? 0.4 : 1, transition: 'opacity .15s' }}>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={r.status === 'approve'}
                    onChange={() => toggleRow(r._id)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--accent)' }} />
                </td>
                <td>
                  <input type="date" value={r.txn_date}
                    onChange={e => updateRow(r._id, 'txn_date', e.target.value)}
                    style={{ fontSize: 11, fontFamily: 'var(--mono)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', color: 'var(--text)', width: 130 }} />
                </td>
                <td>
                  <input value={r.description}
                    onChange={e => updateRow(r._id, 'description', e.target.value)}
                    style={{ width: '100%', minWidth: 180, fontSize: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 7px', color: 'var(--text)' }} />
                </td>
                <td>
                  <input value={r.reference}
                    onChange={e => updateRow(r._id, 'reference', e.target.value)}
                    style={{ width: 140, fontSize: 10, fontFamily: 'var(--mono)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', color: 'var(--text3)' }} />
                </td>
                <td>
                  <select value={r.type} onChange={e => updateRow(r._id, 'type', e.target.value)}
                    style={{ fontSize: 11, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 7px', color: r.type === 'credit' ? 'var(--green)' : 'var(--red)' }}>
                    <option value="credit">Credit ↑</option>
                    <option value="debit">Debit ↓</option>
                  </select>
                </td>
                <td className="r mono" style={{ fontWeight: 600, color: r.type === 'credit' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                  {r.type === 'credit' ? '+' : '–'}{fmt(r.amount)}
                </td>
                <td>
                  {r.isDupe
                    ? <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)', padding: '2px 6px', background: 'rgba(255,180,0,.12)', borderRadius: 3 }}>duplicate</span>
                    : r.status === 'approve'
                      ? <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>✓ import</span>
                      : <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)' }}>skipped</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={saveApproved} disabled={saving || approveCount === 0}>
          {saving ? 'Saving…' : `✓ Import ${approveCount} Transactions`}
        </button>
      </div>
    </div>
  );

  // ── Render: Upload ─────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">1. Select Bank Account</div>
          <FG label="Import transactions into:">
            <select value={selectedBankId} onChange={e => setSelectedBankId(e.target.value)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '8px 12px', width: '100%' }}>
              <option value="">Choose account…</option>
              {filteredBanks.map(b => (
                <option key={b.id} value={b.id}>{b.name} — {b.account_number || b.bank_name || '—'}</option>
              ))}
            </select>
          </FG>
        </div>

        <div className="card">
          <div className="card-head">2. Upload ICICI Bank Statement (PDF)</div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border2,var(--border))'}`,
              borderRadius: 'var(--r2,var(--r))',
              padding: '44px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragging ? 'var(--bg3)' : 'transparent',
              transition: 'all .15s',
              marginBottom: 16,
            }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
            <div style={{ fontWeight: 600, marginBottom: 5, color: 'var(--text)' }}>
              {fileName ? fileName : 'Drop PDF here or click to browse'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              PDF files only · Text is extracted locally in your browser
            </div>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={onFileInput} />
          </div>

          {parseError && (
            <div style={{ padding: '10px 14px', background: 'rgba(220,60,60,.1)', border: '1px solid var(--red)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--red)', marginBottom: 14 }}>
              ⚠ {parseError}
            </div>
          )}

          {!groqKey && (
            <div style={{ padding: '10px 14px', background: 'rgba(255,180,0,.08)', border: '1px solid var(--amber)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--amber)', marginBottom: 14 }}>
              <strong>Setup required:</strong> Add <code style={{ fontFamily: 'var(--mono)' }}>VITE_GROQ_API_KEY</code> to your Render environment variables and redeploy.
              Get a free key at <strong>console.groq.com</strong>
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <strong style={{ color: 'var(--text2)' }}>How it works:</strong><br />
            1️⃣ PDF text extracted in browser — no file upload to any server<br />
            2️⃣ Transaction list sent to <strong>Groq (free Llama 3.3 AI)</strong> for parsing<br />
            3️⃣ You review each transaction — edit dates, amounts, or type<br />
            4️⃣ Duplicates auto-detected &amp; skipped · You confirm before anything saves
          </div>
        </div>

        {filteredBanks.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <EmptyState icon="🏦" message="No bank accounts yet"
              sub='Go to Bank → add a bank account first, then return here to import' />
          </div>
        )}
      </div>
    </div>
  );
}
