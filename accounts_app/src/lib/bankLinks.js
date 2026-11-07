// bankLinks.js — pure matching logic for linking bank credits to payments / invoices / proformas.
//
// No React, no Supabase: everything here takes plain arrays and returns plain data, so it can be
// unit-tested on its own. Linking only TAGS records — it never creates journal entries.
//
// Model (same idea as NovaGeo's vendor-project links):
//   pool item  = a bank credit            (amount, minus what is already linked)
//   allocation = a bank_txn_links row     (bank_txn_id, payment_id, amount)
//   payment    = a row in `payments`      (recorded against an invoice or a proforma)
//   remaining  = amount - sum(links)      -> "needs linking" while remaining > 0

export const EPS = 0.01;
const DAY = 86400000;
const WINDOW_DAYS = 5;        // how far apart the bank date and the manually entered payment date may be
const REF_WINDOW_DAYS = 45;   // …when the bank reference/UTR also matches the payment reference
const COMBO_WINDOW_DAYS = 10; // for "one credit pays several invoices" suggestions

const num = v => Number(v) || 0;
const ts = s => (s ? new Date(s).getTime() : NaN);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Direction: 'in' = money received (bank credits <-> sale payments), 'out' = money paid
// (bank debits <-> purchase-bill payments). Everything below defaults to 'in'.
export const txnTypeFor = dir => (dir === 'out' ? 'debit' : 'credit');

export const isCashMethod = m => /cash/i.test(String(m || ''));
export const txnDate = t => t.txn_date || t.date;

// ── coverage ────────────────────────────────────────────────────────────────
export function buildCoverage(links = []) {
  const byBank = new Map(), byPay = new Map();
  for (const l of links) {
    byBank.set(l.bank_txn_id, round2((byBank.get(l.bank_txn_id) || 0) + num(l.amount)));
    byPay.set(l.payment_id, round2((byPay.get(l.payment_id) || 0) + num(l.amount)));
  }
  return { byBank, byPay };
}
export const creditRemaining = (t, cov) => round2(Math.max(0, num(t.amount) - (cov.byBank.get(t.id) || 0)));
export const paymentRemaining = (p, cov) => round2(Math.max(0, num(p.amount) - (cov.byPay.get(p.id) || 0)));

export function businessOfAccounts(bankAccounts = []) {
  return new Map(bankAccounts.map(a => [a.id, a.business_id]));
}

export function paidByInvoice(payments = []) {
  const m = new Map();
  for (const p of payments) m.set(p.invoice_id, round2((m.get(p.invoice_id) || 0) + num(p.amount)));
  return m;
}

// ── eligibility ─────────────────────────────────────────────────────────────
// Payments that could appear in a bank statement: customer receipts that weren't cash.
export function isLinkablePayment(p, invoiceById, dir = 'in') {
  if (isCashMethod(p.method)) return false;
  const inv = invoiceById.get(p.invoice_id);
  const isPurchase = !!inv && inv.type === 'purchase';
  if (isPurchase !== (dir === 'out')) return false;   // sale payments pair with credits, purchase payments with debits
  if (inv && inv.status === 'cancelled') return false;
  return true;
}

function refMatch(txn, pay) {
  const pr = norm(pay.reference);
  if (pr.length < 6) return false;
  const tr = norm(txn.reference), td = norm(txn.description);
  return tr.includes(pr) || td.includes(pr) || (tr.length >= 6 && pr.includes(tr));
}
function sameBusiness(txn, pay, acctBiz) {
  const b = acctBiz.get(txn.bank_account_id);
  return !(b && pay.business_id && b !== pay.business_id);
}
function sameParty(txn, pay) {
  return !(txn.party_id && pay.party_id && txn.party_id !== pay.party_id);
}
const dayDiff = (a, b) => Math.abs(ts(a) - ts(b)) / DAY;
const cmpScore = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);

// ── auto-match: existing payments  <->  bank credits ─────────────────────────
// 1:1 exact matches only land in `auto`, and only when the pairing is unambiguous (a strict
// "best" for BOTH sides). Equal-amount repeats that can't be told apart go to `ambiguous` —
// never guessed. One credit that equals the sum of several of a customer's payments goes to
// `combos` as a suggestion (only when exactly one such combination exists).
export function autoMatch({ bankTxns = [], payments = [], invoices = [], bankAccounts = [], links = [], dir = 'in' }) {
  const cov = buildCoverage(links);
  const acctBiz = businessOfAccounts(bankAccounts);
  const invoiceById = new Map(invoices.map(i => [i.id, i]));

  const credits = bankTxns.filter(t => t.type === txnTypeFor(dir) && !t.link_dismissed && creditRemaining(t, cov) > EPS);
  const pays = payments.filter(p => isLinkablePayment(p, invoiceById, dir) && paymentRemaining(p, cov) > EPS);

  // candidate pairs
  const candsByCredit = new Map(credits.map(c => [c.id, []]));
  const candsByPay = new Map(pays.map(p => [p.id, []]));
  for (const c of credits) {
    const rc = creditRemaining(c, cov);
    for (const p of pays) {
      if (Math.abs(rc - paymentRemaining(p, cov)) > EPS) continue;
      if (!sameBusiness(c, p, acctBiz) || !sameParty(c, p)) continue;
      const dd = dayDiff(txnDate(c), p.payment_date);
      const rm = refMatch(c, p);
      if (!(dd <= WINDOW_DAYS || (rm && dd <= REF_WINDOW_DAYS))) continue;
      const pair = { c, p, score: [rm ? 0 : 1, Math.round(dd * 10) / 10], refMatch: rm, dateDiff: dd };
      candsByCredit.get(c.id).push(pair);
      candsByPay.get(p.id).push(pair);
    }
  }

  const usedC = new Set(), usedP = new Set();
  const auto = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const c of credits) {
      if (usedC.has(c.id)) continue;
      const cs = candsByCredit.get(c.id).filter(x => !usedP.has(x.p.id)).sort((a, b) => cmpScore(a.score, b.score));
      if (!cs.length) continue;
      if (cs.length > 1 && cmpScore(cs[0].score, cs[1].score) === 0) continue;        // tie on the credit side
      const best = cs[0];
      const ps = candsByPay.get(best.p.id).filter(x => !usedC.has(x.c.id)).sort((a, b) => cmpScore(a.score, b.score));
      if (ps[0].c.id !== c.id) continue;                                              // the payment prefers another credit
      if (ps.length > 1 && cmpScore(ps[0].score, ps[1].score) === 0) continue;       // tie on the payment side
      usedC.add(c.id); usedP.add(best.p.id);
      auto.push({ txn: c, payment: best.p, amount: creditRemaining(c, cov), refMatch: best.refMatch, dateDiff: best.dateDiff });
      progress = true;
    }
  }

  // anything left that still has candidates is ambiguous
  const ambiguous = [];
  for (const c of credits) {
    if (usedC.has(c.id)) continue;
    const cs = candsByCredit.get(c.id).filter(x => !usedP.has(x.p.id)).sort((a, b) => cmpScore(a.score, b.score));
    if (cs.length) ambiguous.push({ txn: c, candidates: cs.map(x => ({ payment: x.p, refMatch: x.refMatch, dateDiff: x.dateDiff })) });
  }

  // combos: credits with no 1:1 candidate that equal the sum of 2–4 payments of one customer
  const combos = [];
  const ambIds = new Set(ambiguous.map(a => a.txn.id));
  const freePays = pays.filter(p => !usedP.has(p.id));
  for (const c of credits) {
    if (usedC.has(c.id) || ambIds.has(c.id)) continue;
    const rc = creditRemaining(c, cov);
    const pool = freePays.filter(p =>
      paymentRemaining(p, cov) < rc - EPS && sameBusiness(c, p, acctBiz) && sameParty(c, p) &&
      (dayDiff(txnDate(c), p.payment_date) <= COMBO_WINDOW_DAYS || refMatch(c, p)));
    const groups = new Map();
    for (const p of pool) { const k = p.party_id || '_'; (groups.get(k) || groups.set(k, []).get(k)).push(p); }
    const found = [];
    for (const g of groups.values()) {
      const arr = g.slice(0, 14);
      const n = arr.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        let cnt = 0, sum = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) { cnt++; sum += paymentRemaining(arr[i], cov); if (cnt > 4) break; }
        if (cnt < 2 || cnt > 4) continue;
        if (Math.abs(sum - rc) <= EPS) found.push(arr.filter((_, i) => mask & (1 << i)));
      }
    }
    if (found.length === 1) combos.push({ txn: c, payments: found[0], amounts: found[0].map(p => paymentRemaining(p, cov)) });
  }

  return { auto, ambiguous, combos };
}

// ── "needs linking": suggest invoices / proformas for a credit with no payment yet ──
function partyScores(narration, parties) {
  const text = norm(narration);
  const raw = String(narration || '').toLowerCase();
  const out = new Map();
  for (const p of parties) {
    const name = String(p.name || '').toLowerCase().trim();
    if (!name) continue;
    let s = 0;
    if (name.length >= 4 && (raw.includes(name) || text.includes(norm(name)))) s += 20;
    for (const w of name.split(/[^a-z0-9]+/).filter(w => w.length >= 4)) if (text.includes(w)) s += w.length >= 7 ? 6 : 3;
    const g = String(p.gstin || '').toLowerCase();
    if (g.length >= 10 && text.includes(g)) s += 30;
    if (s > 0) out.set(p.id, s);
  }
  return out;
}

export function suggestInvoices(txn, { invoices = [], payments = [], parties = [], bankAccounts = [], links = [], dir = 'in' }, max = 3) {
  const cov = buildCoverage(links);
  const rem = creditRemaining(txn, cov);
  if (rem <= EPS) return [];
  const acctBiz = businessOfAccounts(bankAccounts);
  const biz = acctBiz.get(txn.bank_account_id);
  const paid = paidByInvoice(payments);
  const narration = `${txn.description || ''} ${txn.reference || ''}`;
  const narrNorm = norm(narration);
  const ps = partyScores(narration, parties);

  const out = [];
  for (const inv of invoices) {
    if ((inv.type === 'purchase') !== (dir === 'out') || ['cancelled', 'draft'].includes(inv.status)) continue;
    if (biz && inv.business_id && biz !== inv.business_id) continue;
    const outstanding = round2(num(inv.total) - (paid.get(inv.id) || 0));
    if (outstanding <= EPS) continue;
    let score = 0; const reasons = [];
    for (const n of [inv.invoice_number, inv.proforma_number]) {
      const nn = norm(n);
      if (nn.length >= 5 && narrNorm.includes(nn)) { score += 60; reasons.push(`number ${n} in narration`); break; }
    }
    const pScore = ps.get(inv.party_id) || 0;
    if (pScore >= 20) { score += 20; reasons.push('customer name'); }
    else if (pScore > 0) { score += 8; reasons.push('customer name (partial)'); }
    const d = Math.abs(outstanding - rem);
    if (d <= EPS) { score += 45; reasons.push('exact amount'); }
    else if (outstanding > 0 && d / outstanding <= 0.01) { score += 38; reasons.push('amount within 1%'); }
    else if (rem < outstanding && pScore > 0) { score += 5; reasons.push('part payment'); }
    if (score >= 45) out.push({ invoice: inv, outstanding, paid: paid.get(inv.id) || 0, total: num(inv.total), score, reasons, isProforma: inv.status === 'proforma' });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

// unlinked payments a credit could be tied to by hand (closest amount/date first)
export function paymentChoicesForCredit(txn, { payments = [], invoices = [], bankAccounts = [], links = [], dir = 'in' }) {
  const cov = buildCoverage(links);
  const acctBiz = businessOfAccounts(bankAccounts);
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  return payments
    .filter(p => isLinkablePayment(p, invoiceById, dir) && paymentRemaining(p, cov) > EPS && sameBusiness(txn, p, acctBiz))
    .map(p => ({ payment: p, remaining: paymentRemaining(p, cov), invoice: invoiceById.get(p.invoice_id),
      rank: Math.abs(paymentRemaining(p, cov) - creditRemaining(txn, cov)) / Math.max(1, num(txn.amount)) + dayDiff(txnDate(txn), p.payment_date) / 365 }))
    .sort((a, b) => a.rank - b.rank);
}

export function creditChoicesForPayment(payment, { bankTxns = [], bankAccounts = [], links = [], dir = 'in' }) {
  const cov = buildCoverage(links);
  const acctBiz = businessOfAccounts(bankAccounts);
  return bankTxns
    .filter(t => t.type === txnTypeFor(dir) && !t.link_dismissed && creditRemaining(t, cov) > EPS && sameBusiness(t, payment, acctBiz))
    .map(t => ({ txn: t, remaining: creditRemaining(t, cov),
      rank: Math.abs(creditRemaining(t, cov) - paymentRemaining(payment, cov)) / Math.max(1, num(payment.amount)) + dayDiff(txnDate(t), payment.payment_date) / 365 }))
    .sort((a, b) => a.rank - b.rank);
}

// payments that look like bank receipts but have no credit linked, restricted to dates the
// imported statement actually covers (so history you never imported isn't reported as "missing")
export function paymentsNotInBank({ payments = [], invoices = [], bankTxns = [], bankAccounts = [], links = [], dir = 'in' }) {
  const cov = buildCoverage(links);
  const acctBiz = businessOfAccounts(bankAccounts);
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  const range = new Map(); // business -> [min,max]
  for (const t of bankTxns) {
    const b = acctBiz.get(t.bank_account_id); const d = ts(txnDate(t));
    if (!b || isNaN(d)) continue;
    const r = range.get(b) || [d, d];
    range.set(b, [Math.min(r[0], d), Math.max(r[1], d)]);
  }
  return payments
    .filter(p => {
      if (!isLinkablePayment(p, invoiceById, dir) || paymentRemaining(p, cov) <= EPS) return false;
      const r = range.get(p.business_id); const d = ts(p.payment_date);
      return r && !isNaN(d) && d >= r[0] - 3 * DAY && d <= r[1] + 3 * DAY;
    })
    .map(p => ({ payment: p, invoice: invoiceById.get(p.invoice_id), remaining: paymentRemaining(p, cov) }));
}

// Both the bank row (source 'bank_import') AND the payment (source 'payment') already carry their own
// journal entry -> the same receipt is in the books twice.
export function journalKeys(journalEntries = []) {
  return new Set(journalEntries.map(j => `${j.source}:${j.source_id}`));
}
export function isDoubleBooked(txn, payment, keys) {
  return keys.has(`bank_import:${txn.id}`) && keys.has(`payment:${payment.id}`);
}

// ── grouping by client / vendor (Bank → Import & Link) ───────────────────────
const NOISE = new Set(['upi','neft','imps','rtgs','mmt','ach','nach','ecs','pos','atm','paid','pay','payment','to','from','by','transfer','trf','ref','inb','bil','bank','icici','hdfc','sbi','axis','kotak','yesb','idfb','utib','cnrb','ibkl','ioba','pnb','cr','dr','credit','debit','received','towards','invoice','inv','cash','chq','cheque']);

// Best-effort payee name out of an ICICI-style narration (UPI/NEFT/IMPS/…).
export function counterpartyOf(txn) {
  const desc = String(txn.description || '');
  const parts = desc.split(/[\/\-|]/).map(x => x.trim()).filter(Boolean);
  for (const part of parts) {
    const letters = part.replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (letters.length < 3) continue;
    if (/\d/.test(part) && !/\s/.test(part)) continue;                 // reference-like token (ABC123456)
    const words = letters.split(' ').filter(w => !NOISE.has(w.toLowerCase()));
    if (!words.length) continue;
    const name = words.join(' ');
    if (name.length >= 3) return name.toUpperCase();
  }
  return 'UNKNOWN';
}

// Group bank rows by the party they belong to: the row's own party_id first, then a name match against
// your parties, then the payee text from the narration. Never guesses a party it can't back up.
export function groupBankTxns(txns = [], parties = []) {
  const partyById = new Map(parties.map(p => [p.id, p]));
  const groups = new Map();
  const put = (key, init, t) => {
    let g = groups.get(key);
    if (!g) { g = { key, partyId: null, name: '', matched: false, txns: [], ...init }; groups.set(key, g); }
    g.txns.push(t);
  };
  for (const t of txns) {
    if (t.party_id && partyById.has(t.party_id)) {
      put('p:' + t.party_id, { partyId: t.party_id, name: partyById.get(t.party_id).name, matched: true }, t);
      continue;
    }
    const narration = `${t.description || ''} ${t.reference || ''}`;
    const sc = partyScores(narration, parties);
    let best = null, bestS = 0;
    for (const [id, v] of sc) if (v > bestS) { best = id; bestS = v; }
    if (best && bestS >= 20) {
      put('p:' + best, { partyId: best, name: partyById.get(best).name, matched: true, auto: true }, t);
      continue;
    }
    const cp = counterpartyOf(t);
    put('n:' + norm(cp), { name: cp, matched: false }, t);
  }
  const arr = [...groups.values()];
  for (const g of arr) g.txns.sort((a, b) => String(txnDate(a)).localeCompare(String(txnDate(b))));
  return arr.sort((a, b) => (Number(b.matched) - Number(a.matched)) || (b.txns.length - a.txns.length) || a.name.localeCompare(b.name));
}

// Which party a bank row belongs to: its own party_id, else an unambiguous name match, else null.
export function txnPartyId(txn, parties = []) {
  if (txn.party_id) return txn.party_id;
  const sc = partyScores(`${txn.description || ''} ${txn.reference || ''}`, parties);
  let best = null, bestS = 0;
  for (const [id, v] of sc) if (v > bestS) { best = id; bestS = v; }
  return best && bestS >= 20 ? best : null;
}

// Rows from a freshly parsed statement that are NOT already saved for this bank account.
// A row is a duplicate if its bank reference already exists, or — when it has no reference — if the same
// date + amount + direction already exists (counted, so two genuine same-day same-amount rows both survive
// unless both were already imported).
export function filterNewRows(parsed = [], existing = []) {
  const refs = new Set(existing.filter(e => e.reference).map(e => String(e.reference)));
  const counts = new Map();
  for (const e of existing) {
    const k = `${e.txn_date}|${Number(e.amount)}|${e.type}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const fresh = [], dupes = [];
  for (const t of parsed) {
    if (t.reference && refs.has(String(t.reference))) { dupes.push(t); continue; }
    const k = `${t.date}|${Number(t.amount)}|${t.type}`;
    if (!t.reference && (counts.get(k) || 0) > 0) { counts.set(k, counts.get(k) - 1); dupes.push(t); continue; }
    fresh.push(t);
  }
  return { fresh, dupes };
}
