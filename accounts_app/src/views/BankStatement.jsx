// BankStatement.jsx — the single Bank page.
//
//   Grouped  : import a statement, rows are MERGED BY CLIENT / VENDOR (like NovaGeo's Bank Statement).
//              Name a group to attach it to a client / vendor, then route it:
//                • invoices / bills -> done from the invoice's Record Payment popup ("Link bank payment")
//                • journal entry    -> post the whole group to two accounts you choose
//                • ignore           -> keep the rows, book nothing
//   Ledger   : the plain running-balance bank ledger (add bank, add transaction).
//
// Nothing here matches or fills in invoice payments automatically.
import { useState, useMemo, useRef } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';
import { ModalShell, StatCard, EmptyState, PillTabs } from '../components/ui.jsx';
import { BankView } from './Operations.jsx';
import { parseICICIXls, parseICICIPdf } from './BankImport.jsx';
import { saveBankTxnsHeldBulk, setBankTxnParty, saveNewParty, postHeldBankTxn, dismissBankCredit } from '../lib/db.js';
import { EPS, buildCoverage, creditRemaining, groupBankTxns, filterNewRows, txnDate, journalKeys } from '../lib/bankLinks.js';

const CAP = 150;
const variantKey = d => String(d || '').toLowerCase().replace(/\d+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

export function BankStatementView(props) {
  const { bankAccounts, bankTransactions = [], bankLinks = [], bankLinksReady = true, activeBiz, reload } = props;
  const [tab, setTab] = useState('groups');
  if (!bankLinksReady) {
    return (
      <div style={{ maxWidth: 720, background: '#2b1f08', border: '1px solid #5c3d0a', color: '#fbbf24', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <strong>One-time setup needed.</strong> Run <code>accounts_app/sql/migrations/002_bank_txn_links.sql</code> and <code>003_bank_pending_link.sql</code> in the
        Supabase SQL editor, then press Refresh.
      </div>
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <PillTabs tabs={[{ id: 'groups', label: 'Grouped (import & link)' }, { id: 'ledger', label: 'Ledger' }]} active={tab} onChange={setTab} />
      </div>
      {tab === 'groups' ? <GroupedTab {...props} /> : <BankView {...props} />}
    </div>
  );
}

function GroupedTab({ bankAccounts, bankTransactions = [], businesses, parties = [], invoices = [], payments = [], accounts = [], journalEntries = [], bankLinks = [], activeBiz, reload }) {
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const [route, setRoute] = useState({});            // group key -> 'invoice' | 'journal' | 'ignore'
  const [accts, setAccts] = useState({});            // group key -> { dr, cr }
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const scopedAccts = useMemo(() => bankAccounts.filter(b => !activeBiz || b.business_id === activeBiz), [bankAccounts, activeBiz]);
  const acctById = useMemo(() => new Map(bankAccounts.map(b => [b.id, b])), [bankAccounts]);
  const txns = useMemo(() => { const ids = new Set(scopedAccts.map(b => b.id)); return bankTransactions.filter(t => ids.has(t.bank_account_id)); }, [bankTransactions, scopedAccts]);

  const cov = useMemo(() => buildCoverage(bankLinks), [bankLinks]);
  const keys = useMemo(() => journalKeys(journalEntries), [journalEntries]);
  const invById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const payById = useMemo(() => new Map(payments.map(p => [p.id, p])), [payments]);
  const linksByBank = useMemo(() => { const m = new Map(); bankLinks.forEach(l => (m.get(l.bank_txn_id) || m.set(l.bank_txn_id, []).get(l.bank_txn_id)).push(l)); return m; }, [bankLinks]);

  // status of one bank row
  const statusOf = t => {
    if (t.link_dismissed) return 'ignored';
    const linked = cov.byBank.get(t.id) || 0;
    if (linked >= Number(t.amount) - EPS) return 'linked';
    if (keys.has(`bank_import:${t.id}`)) return linked > 0 ? 'part' : 'inbooks';
    return linked > 0 ? 'part' : 'pending';
  };
  const isPending = t => { const s = statusOf(t); return s === 'pending' || s === 'part'; };

  const groups = useMemo(() => groupBankTxns(txns, parties).map(g => ({
    ...g,
    pending: g.txns.filter(isPending),
    paid: g.txns.filter(t => t.type === 'debit').reduce((s, t) => s + Number(t.amount), 0),
    received: g.txns.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount), 0),
    unlinked: g.txns.filter(isPending).reduce((s, t) => s + creditRemaining(t, cov), 0),
    variants: new Set(g.txns.map(t => variantKey(t.description))).size,
  })), [txns, parties, cov, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const shown = groups.filter(g => (!pendingOnly || g.pending.length) &&
    (!q || g.name.toLowerCase().includes(q) || g.txns.some(t => `${t.description} ${t.reference}`.toLowerCase().includes(q))));
  const pendingTotal = groups.reduce((s, g) => s + g.pending.length, 0);

  const bizOf = g => acctById.get(g.txns[0]?.bank_account_id)?.business_id || activeBiz;

  async function saveName(g, raw) {
    const name = raw.trim();
    if (!name || name === g.name) return;
    const biz = bizOf(g);
    let party = parties.find(p => p.business_id === biz && p.name.trim().toLowerCase() === name.toLowerCase());
    try {
      if (!party) {
        const credits = g.txns.filter(t => t.type === 'credit').length;
        const type = credits >= g.txns.length / 2 ? 'client' : 'vendor';
        if (!confirm(`No client or vendor named “${name}”. Create it as a new ${type}?`)) return;
        party = await saveNewParty({ business_id: biz, name, type });
      }
      await setBankTxnParty(g.txns.map(t => t.id), party.id);
      await reload();
    } catch (e) { alert(e.message || String(e)); }
  }

  async function postGroup(g) {
    const a = accts[g.key] || {};
    if (!a.dr || !a.cr) return alert('Choose both a debit and a credit account.');
    if (!confirm(`Post ${g.pending.length} transaction(s) as journal entries?\n\nDr ${a.dr}\nCr ${a.cr}`)) return;
    setBusy(g.key);
    let ok = 0; const errs = [];
    for (const t of g.pending) {
      try {
        const res = await postHeldBankTxn(t, a.dr, a.cr, accounts, bizOf(g));
        if (res.skipped) errs.push(`${fmtDate(txnDate(t))} ${fmt(t.amount)}: ${res.skipReason}`); else ok++;
      } catch (e) { errs.push(`${fmtDate(txnDate(t))} ${fmt(t.amount)}: ${e.message}`); }
    }
    setBusy('');
    await reload();
    alert(`${ok} posted${errs.length ? `, ${errs.length} failed:\n${errs.slice(0, 5).join('\n')}` : '.'}`);
  }

  async function ignoreGroup(g) {
    if (!confirm(`Ignore ${g.pending.length} transaction(s)? They stay in the ledger but no journal entry is made.`)) return;
    setBusy(g.key);
    try { for (const t of g.pending) await dismissBankCredit(t.id, true, 'Ignored from Bank import'); await reload(); }
    catch (e) { alert(e.message || String(e)); }
    setBusy('');
  }
  async function restore(t) { try { await dismissBankCredit(t.id, false); await reload(); } catch (e) { alert(e.message || String(e)); } }

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
        <StatCard label="Groups" value={groups.length} sub={`${shown.length} shown`} color="blue" />
        <StatCard label="Transactions" value={txns.length} color="purple" />
        <StatCard label="Waiting to be linked / booked" value={pendingTotal} color={pendingTotal ? 'amber' : 'green'} />
        <StatCard label="Linked" value={txns.filter(t => statusOf(t) === 'linked').length} color="green" />
      </div>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setImportOpen(true)} disabled={!scopedAccts.length}>⬆ Import statement</button>
        <input placeholder="Search name or narration…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...fld, minWidth: 240 }} />
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} /> Only groups with rows still waiting
        </label>
      </div>
      {!scopedAccts.length && <EmptyState icon="🏦" message="No bank account yet" sub="Add one in the Ledger tab, then import a statement here." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.slice(0, CAP).map(g => {
          const rt = route[g.key] || 'invoice';
          const isOpen = open.has(g.key);
          const bizAccts = accounts.filter(a => a.business_id === bizOf(g));
          const a = accts[g.key] || {};
          return (
            <div key={g.key} className="config-card" style={{ padding: 16, marginBottom: 0 }}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <div style={lbl}>{g.matched ? 'Client / vendor' : 'Name this group'}</div>
                    <input key={g.key + g.name} list="bank-party-names" defaultValue={g.name} style={{ ...fld, minWidth: 260, fontWeight: 600 }}
                      onKeyDown={e => { if (e.key === 'Enter') saveName(g, e.currentTarget.value); }} />
                    <div style={{ ...dim, marginTop: 4 }}>{g.matched ? 'Press Enter to rename / move to another party' : 'Type an existing client / vendor (or a new name) and press Enter to save'}</div>
                  </div>
                  <div>
                    <div style={lbl}>Route</div>
                    <select value={rt} onChange={e => setRoute(r => ({ ...r, [g.key]: e.target.value }))} style={{ ...fld, minWidth: 230 }}>
                      <option value="invoice">Link to invoices / bills</option>
                      <option value="journal">Post as journal entry…</option>
                      <option value="ignore">Ignore (no entry)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 22, fontFamily: 'var(--mono)', fontSize: 12 }}>
                  <div><div style={lbl}>PAID</div><div style={{ color: 'var(--red)', fontWeight: 700 }}>{fmt(g.paid)}</div></div>
                  <div><div style={lbl}>RECEIVED</div><div style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(g.received)}</div></div>
                  <div><div style={lbl}>TXNS</div><div style={{ fontWeight: 700 }}>{g.txns.length}</div></div>
                  <div><div style={lbl}>WAITING</div><div style={{ color: g.pending.length ? 'var(--amber)' : 'var(--text3)', fontWeight: 700 }}>{g.pending.length}</div></div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
                <span style={dim}>{g.variants > 1 ? `Merged from ${g.variants} narration variations` : ' '}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => { const n = new Set(o); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}>
                  {isOpen ? 'Hide' : 'Show'} transactions
                </button>
              </div>

              {rt === 'invoice' && g.pending.length > 0 && (
                <p style={{ ...dim, marginTop: 6 }}>
                  To link these to {g.received >= g.paid ? 'sales invoices / proformas' : 'purchase bills'}: open the invoice → <strong>Record Payment</strong> → <strong>🔗 Link bank payment</strong>.
                </p>
              )}
              {rt === 'journal' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                  <select value={a.dr || ''} onChange={e => setAccts(x => ({ ...x, [g.key]: { ...a, dr: e.target.value } }))} style={{ ...fld, flex: 1, minWidth: 170 }}>
                    <option value="">Debit account…</option>{bizAccts.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
                  </select>
                  <span style={dim}>→</span>
                  <select value={a.cr || ''} onChange={e => setAccts(x => ({ ...x, [g.key]: { ...a, cr: e.target.value } }))} style={{ ...fld, flex: 1, minWidth: 170 }}>
                    <option value="">Credit account…</option>{bizAccts.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
                  </select>
                  <button className="btn btn-primary btn-sm" disabled={busy === g.key || !g.pending.length} onClick={() => postGroup(g)}>Post {g.pending.length} waiting</button>
                </div>
              )}
              {rt === 'ignore' && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy === g.key || !g.pending.length} onClick={() => ignoreGroup(g)}>Ignore {g.pending.length} waiting</button>
                </div>
              )}

              {isOpen && (
                <div className="table-wrap" style={{ marginTop: 10, marginBottom: 0 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Narration</th><th className="r">Debit</th><th className="r">Credit</th><th>Status</th></tr></thead>
                    <tbody>
                      {g.txns.map(t => {
                        const st = statusOf(t);
                        return (
                          <tr key={t.id}>
                            <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(txnDate(t))}</td>
                            <td style={{ fontSize: 12, maxWidth: 520 }}>{t.description}</td>
                            <td className="r mono" style={{ color: 'var(--red)' }}>{t.type === 'debit' ? fmt(t.amount) : '—'}</td>
                            <td className="r mono" style={{ color: 'var(--green)' }}>{t.type === 'credit' ? fmt(t.amount) : '—'}</td>
                            <td style={{ fontSize: 11.5 }}>
                              {st === 'pending' && <span style={{ color: 'var(--amber)' }}>waiting</span>}
                              {st === 'inbooks' && <span style={{ color: 'var(--text3)' }}>already in books</span>}
                              {st === 'ignored' && <span style={{ color: 'var(--text3)' }}>ignored <button className="btn btn-ghost btn-sm" onClick={() => restore(t)}>Restore</button></span>}
                              {(st === 'linked' || st === 'part') && (
                                <span>
                                  {(linksByBank.get(t.id) || []).map(l => {
                                    const inv = invById.get(payById.get(l.payment_id)?.invoice_id);
                                    return <span key={l.id} style={{ marginRight: 8, color: 'var(--green)' }}>🔗 {inv?.invoice_number || 'payment'} · {fmt(l.amount)}</span>;
                                  })}
                                  {st === 'part' && <span style={{ color: 'var(--amber)' }}>{fmt(creditRemaining(t, cov))} left</span>}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && scopedAccts.length > 0 && <EmptyState icon="✅" message={txns.length ? 'Nothing waiting' : 'No bank transactions yet'} sub={txns.length ? 'Untick “Only groups with rows still waiting” to see everything.' : 'Use “Import statement” to bring in a bank statement.'} />}
        {shown.length > CAP && <p style={dim}>Showing {CAP} of {shown.length} groups — use search to narrow.</p>}
      </div>
      <datalist id="bank-party-names">{parties.map(p => <option key={p.id} value={p.name} />)}</datalist>

      {importOpen && <ImportModal accts={scopedAccts} existing={bankTransactions} onClose={() => setImportOpen(false)} onDone={async () => { setImportOpen(false); await reload(); }} />}
    </div>
  );
}

const lbl = { fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 };
const dim = { fontSize: 11, color: 'var(--text3)' };
const fld = { background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text1)', borderRadius: 6, padding: '7px 10px', fontSize: 13 };

function ImportModal({ accts, existing, onClose, onDone }) {
  const [acct, setAcct] = useState(accts[0]?.id || '');
  const [res, setRes] = useState(null);     // { fresh, dupes, name }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  async function onFile(f) {
    if (!f) return;
    setErr(''); setRes(null); setBusy(true);
    try {
      const rows = /\.pdf$/i.test(f.name) ? await parseICICIPdf(f) : await parseICICIXls(f);
      if (!rows.length) throw new Error('No transactions found in that file.');
      const { fresh, dupes } = filterNewRows(rows, existing.filter(t => t.bank_account_id === acct));
      setRes({ fresh, dupes, name: f.name });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }
  async function doImport() {
    setBusy(true); setErr('');
    try { await saveBankTxnsHeldBulk(res.fresh, acct); await onDone(); }
    catch (e) { setErr(e.message || String(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Import bank statement" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !res?.fresh.length} onClick={doImport}>{busy ? 'Working…' : `Import ${res?.fresh.length || 0} transactions`}</button></>}>
      <p style={{ ...dim, marginBottom: 10 }}>
        Rows are saved as they are — no journal entries are made. They are grouped by client / vendor on this page, and each one gets its entry when you link
        it to an invoice or post the group.
      </p>
      <div style={{ marginBottom: 10 }}>
        <div style={lbl}>Bank account</div>
        <select value={acct} onChange={e => { setAcct(e.target.value); setRes(null); }} style={{ width: '100%' }}>
          {accts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.account_number}</option>)}
        </select>
      </div>
      <input ref={fileRef} type="file" accept=".xls,.xlsx,.pdf" onChange={e => onFile(e.target.files?.[0])} />
      {res && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <strong>{res.name}</strong>: {res.fresh.length} new, {res.dupes.length} already in the app (skipped).
        </div>
      )}
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}
