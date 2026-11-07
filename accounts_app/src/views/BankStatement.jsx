// BankStatement.jsx — the single Bank page.
//
//   Grouped : every imported bank transaction shows up UNNAMED. You type a name (and pick a category) and press Enter;
//             rows given the same name are merged into one group — nothing is grouped automatically.
//             • Customer / Vendor groups are linked to invoices / bills from the invoice's Record Payment popup
//               ("Link bank payment"); the popup lists the rows you named after that client / vendor first.
//             • Other categories (staff, rent, loan, tax…) can be posted to two accounts you choose, or ignored.
//   Ledger  : the plain running-balance bank ledger (add bank, add transaction).
//
// Nothing here matches or fills in invoice payments automatically.
import { useState, useMemo, useRef } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';
import { ModalShell, StatCard, EmptyState, PillTabs } from '../components/ui.jsx';
import { BankView } from './Operations.jsx';
import { parseICICIXls, parseICICIPdf } from './BankImport.jsx';
import { saveBankTxnsHeldBulk, setBankTxnGroup, postHeldBankTxn, dismissBankCredit } from '../lib/db.js';
import { EPS, buildCoverage, creditRemaining, filterNewRows, txnDate, journalKeys, normName } from '../lib/bankLinks.js';

const CATEGORIES = [
  { id: '', label: 'Unlabeled' },
  { id: 'customer', label: 'Customer / Buyer' },
  { id: 'vendor', label: 'Vendor / Supplier' },
  { id: 'staff', label: 'Staff / Labour' },
  { id: 'owner', label: 'Owner / Capital' },
  { id: 'loan', label: 'Loan / Bank' },
  { id: 'utility', label: 'Utility / Rent' },
  { id: 'tax', label: 'Tax / Government' },
  { id: 'other', label: 'Other' },
];
const INVOICE_CATS = new Set(['customer', 'vendor']);
const variantKey = d => String(d || '').toLowerCase().replace(/\d+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

export function BankStatementView(props) {
  const { bankLinksReady = true } = props;
  const [tab, setTab] = useState('groups');
  if (!bankLinksReady) {
    return (
      <div style={{ maxWidth: 720, background: '#2b1f08', border: '1px solid #5c3d0a', color: '#fbbf24', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <strong>One-time setup needed.</strong> Run <code>accounts_app/sql/migrations/002</code>, <code>003</code> and <code>004</code> (bank_txn_links, pending_link,
        group_name) in the Supabase SQL editor, then press Refresh.
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

function GroupedTab({ bankAccounts, bankTransactions = [], parties = [], invoices = [], payments = [], accounts = [], journalEntries = [], bankLinks = [], activeBiz, reload }) {
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [nameFilter, setNameFilter] = useState('all');     // all | unnamed | named
  const [open, setOpen] = useState(() => new Set());
  const [ov, setOv] = useState({});                        // optimistic name / category edits: txn id -> { group_name, group_category }
  const [accts, setAccts] = useState({});                  // group key -> { dr, cr }
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const scopedAccts = useMemo(() => bankAccounts.filter(b => !activeBiz || b.business_id === activeBiz), [bankAccounts, activeBiz]);
  const acctById = useMemo(() => new Map(bankAccounts.map(b => [b.id, b])), [bankAccounts]);
  const txns = useMemo(() => {
    const ids = new Set(scopedAccts.map(b => b.id));
    return bankTransactions.filter(t => ids.has(t.bank_account_id)).map(t => (ov[t.id] ? { ...t, ...ov[t.id] } : t));
  }, [bankTransactions, scopedAccts, ov]);

  const cov = useMemo(() => buildCoverage(bankLinks), [bankLinks]);
  const keys = useMemo(() => journalKeys(journalEntries), [journalEntries]);
  const invById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const payById = useMemo(() => new Map(payments.map(p => [p.id, p])), [payments]);
  const linksByBank = useMemo(() => { const m = new Map(); bankLinks.forEach(l => (m.get(l.bank_txn_id) || m.set(l.bank_txn_id, []).get(l.bank_txn_id)).push(l)); return m; }, [bankLinks]);

  const statusOf = t => {
    if (t.link_dismissed) return 'ignored';
    const linked = cov.byBank.get(t.id) || 0;
    if (linked >= Number(t.amount) - EPS) return 'linked';
    if (keys.has(`bank_import:${t.id}`)) return linked > 0 ? 'part' : 'inbooks';
    return linked > 0 ? 'part' : 'pending';
  };
  const isPending = t => { const s = statusOf(t); return s === 'pending' || s === 'part'; };

  // Group ONLY by the name you typed. Rows with no name are one card each.
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of txns) {
      const nm = normName(t.group_name);
      const key = nm ? 'n:' + nm : 'u:' + t.id;
      let g = m.get(key);
      if (!g) { g = { key, named: !!nm, name: (t.group_name || '').trim(), txns: [] }; m.set(key, g); }
      g.txns.push(t);
    }
    return [...m.values()].map(g => {
      g.txns.sort((a, b) => String(txnDate(b)).localeCompare(String(txnDate(a))));
      const pend = g.txns.filter(isPending);
      return {
        ...g,
        category: g.txns.find(t => t.group_category)?.group_category || '',
        latest: txnDate(g.txns[0]) || '',
        pending: pend,
        paid: g.txns.filter(t => t.type === 'debit').reduce((s, t) => s + Number(t.amount), 0),
        received: g.txns.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount), 0),
        variants: new Set(g.txns.map(t => variantKey(t.description))).size,
      };
    }).sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || a.key.localeCompare(b.key));
  }, [txns, cov, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const shown = groups.filter(g => (!pendingOnly || g.pending.length) &&
    (nameFilter === 'all' || (nameFilter === 'named') === g.named) &&
    (!q || g.name.toLowerCase().includes(q) || g.txns.some(t => `${t.description} ${t.reference} ${t.amount}`.toLowerCase().includes(q))));
  const pendingTotal = groups.reduce((s, g) => s + g.pending.length, 0);
  const namedNames = useMemo(() => [...new Set([...txns.map(t => (t.group_name || '').trim()).filter(Boolean), ...parties.map(p => p.name)])].sort(), [txns, parties]);

  const bizOf = g => acctById.get(g.txns[0]?.bank_account_id)?.business_id || activeBiz;
  const patchLocal = (ids, patch) => setOv(o => { const n = { ...o }; ids.forEach(id => { n[id] = { ...(n[id] || {}), ...patch }; }); return n; });

  async function saveName(g, raw) {
    const name = raw.trim();
    if (name === g.name) return;
    const ids = g.txns.map(t => t.id);
    const patch = { group_name: name || null };
    const dbPatch = { name };
    // joining an existing group inherits its category when this row has none
    if (name && !g.category) {
      const other = groups.find(x => x.key !== g.key && x.named && normName(x.name) === normName(name));
      if (other?.category) { patch.group_category = other.category; dbPatch.category = other.category; }
    }
    try { await setBankTxnGroup(ids, dbPatch); patchLocal(ids, patch); }
    catch (e) { alert(e.message || String(e)); }
  }
  async function saveCategory(g, category) {
    const ids = g.txns.map(t => t.id);
    try { await setBankTxnGroup(ids, { category }); patchLocal(ids, { group_category: category || null }); }
    catch (e) { alert(e.message || String(e)); }
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
        <StatCard label="Groups / cards" value={groups.length} sub={`${shown.length} shown`} color="blue" />
        <StatCard label="Transactions" value={txns.length} sub={`${txns.filter(t => !normName(t.group_name)).length} unnamed`} color="purple" />
        <StatCard label="Waiting to be linked / booked" value={pendingTotal} color={pendingTotal ? 'amber' : 'green'} />
        <StatCard label="Linked" value={txns.filter(t => statusOf(t) === 'linked').length} color="green" />
      </div>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setImportOpen(true)} disabled={!scopedAccts.length}>⬆ Import statement</button>
        <input placeholder="Search name or narration…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...fld, minWidth: 240 }} />
        <select value={nameFilter} onChange={e => setNameFilter(e.target.value)} style={fld}>
          <option value="all">All cards</option><option value="unnamed">Unnamed only</option><option value="named">Named groups only</option>
        </select>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} /> Only rows still waiting
        </label>
      </div>
      <p style={{ ...dim, margin: '4px 2px 12px' }}>
        Type a name on a card and press Enter — cards with the same name merge into one group. Then link a Customer / Vendor group from
        <strong> Invoices / Purchase Bills → 💰 Record Payment → 🔗 Link bank payment</strong>. Nothing is grouped or matched automatically.
      </p>
      {!scopedAccts.length && <EmptyState icon="🏦" message="No bank account yet" sub="Add one in the Ledger tab, then import a statement here." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map(g => {
          const isOpen = open.has(g.key);
          const showPost = g.category && !INVOICE_CATS.has(g.category);
          const bizAccts = showPost ? accounts.filter(a => a.business_id === bizOf(g)) : [];
          const a = accts[g.key] || {};
          return (
            <div key={g.key} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', contentVisibility: 'auto', containIntrinsicSize: '0 150px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 0 }}>
                  <div>
                    <div style={lbl}>{g.named ? 'Group name' : 'Name this group'}</div>
                    <input key={g.key + '|' + g.name} list="bank-group-names" defaultValue={g.name} placeholder="Type a name…" style={{ ...fld, width: 230, fontWeight: 600 }}
                      onKeyDown={e => { if (e.key === 'Enter') { saveName(g, e.currentTarget.value); e.currentTarget.blur(); } }} />
                    <div style={{ ...dim, marginTop: 6 }}>Press Enter to save name</div>
                  </div>
                  <div>
                    <div style={lbl}>Type / category routing</div>
                    <select value={g.category} onChange={e => saveCategory(g, e.target.value)} style={{ ...fld, width: 230 }}>
                      {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 22, fontFamily: 'var(--mono)', fontSize: 13, justifyContent: 'flex-end', marginBottom: 10 }}>
                    <div><div style={lbl}>PAID</div><div style={{ color: g.paid ? 'var(--red)' : 'var(--text3)', fontWeight: 700 }}>{fmt(g.paid)}</div></div>
                    <div><div style={lbl}>RECEIVED</div><div style={{ color: g.received ? 'var(--green)' : 'var(--text3)', fontWeight: 700 }}>{fmt(g.received)}</div></div>
                    <div><div style={lbl}>TXNS</div><div style={{ fontWeight: 700 }}>{g.txns.length}</div></div>
                    <div><div style={lbl}>WAITING</div><div style={{ color: g.pending.length ? 'var(--amber)' : 'var(--text3)', fontWeight: 700 }}>{g.pending.length}</div></div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => { const n = new Set(o); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}>
                    {isOpen ? 'Hide' : 'Show'} transactions
                  </button>
                </div>
              </div>
              <div style={{ ...dim, marginTop: 4, fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }}>
                {g.txns.length === 1 ? g.txns[0].description : g.variants > 1 ? `Merged from ${g.variants} narration variations` : g.txns[0].description}
              </div>

              {showPost && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                  <select value={a.dr || ''} onChange={e => setAccts(x => ({ ...x, [g.key]: { ...a, dr: e.target.value } }))} style={{ ...fld, flex: 1, minWidth: 170 }}>
                    <option value="">Debit account…</option>{bizAccts.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
                  </select>
                  <span style={dim}>→</span>
                  <select value={a.cr || ''} onChange={e => setAccts(x => ({ ...x, [g.key]: { ...a, cr: e.target.value } }))} style={{ ...fld, flex: 1, minWidth: 170 }}>
                    <option value="">Credit account…</option>{bizAccts.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
                  </select>
                  <button className="btn btn-primary btn-sm" disabled={busy === g.key || !g.pending.length} onClick={() => postGroup(g)}>Post {g.pending.length} waiting</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === g.key || !g.pending.length} onClick={() => ignoreGroup(g)}>Ignore</button>
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
        {shown.length === 0 && scopedAccts.length > 0 && <EmptyState icon="✅" message={txns.length ? 'Nothing to show' : 'No bank transactions yet'} sub={txns.length ? 'Untick “Only rows still waiting” or change the filter to see more.' : 'Use “Import statement” to bring in a bank statement.'} />}
      </div>
      <datalist id="bank-group-names">{namedNames.map(n => <option key={n} value={n} />)}</datalist>

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
