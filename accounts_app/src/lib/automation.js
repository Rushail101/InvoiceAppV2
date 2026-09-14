// automation.js — deterministic, no-API accounting automation rules.
// Shared by bank import + database journal posting so classification lives in ONE place.

const CUSTOM_RULES_KEY = 'np_automation_bank_rules_v1';

// Rules are checked in order. Keep specific rules above broad rules.
const BANK_RULES = [
  // Credits / money in
  { match: ['tailored verse', 'odd mob', 'whitesockslab', 'scjersey', 'bake a film', 'proformaadvance', 'advance', 'gaurish', 'tomsan'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Sales Revenue', label: 'Customer Payment' },
  { match: ['foreign inward', 'rda foreign', 'inward remittance', 'fcy'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Sales Revenue', label: 'Export Payment' },
  { match: ['blueheightsavia', 'capital', 'proprietor', 'partner loan'], type: 'credit', debitAcct: 'Bank Account', creditAcct: "Owner's Capital", label: 'Capital Infusion' },

  // Debits / money out
  { match: ['porter', 'dtdc', 'bluedart', 'fedex', 'delhivery', 'xpressbees', 'ecomexpress', 'shiprocket', 'shipping', 'freight', 'courier', 'delivery'], type: 'debit', debitAcct: 'Shipping & Freight', creditAcct: 'Bank Account', label: 'Freight/Courier' },
  { match: ['fabric', 'fabr', 'cloth', 'denim', 'cotton', 'polyester', 'lining', 'interlining', 'woven', 'knit'], type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Fabric Purchase' },
  { match: ['thread', 'threads', 'zip', 'zips', 'zipper', 'button', 'buttons', 'kaajbutton', 'magnetbutton', 'elastic', 'label', 'labels', 'tag', 'rivet', 'patch', 'velcro', 'felt', 'material', 'bags', 'bagsavation'], type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Trims/Accessories' },
  { match: ['salary', 'sal ', 'wages', 'meerasalary', 'salarymamta', 'salarysaddam', 'advancesalary', 'hariram', 'masterjip', 'rambabu', 'worker', 'tailor', 'labour', 'labr'], type: 'debit', debitAcct: 'Wages & Salaries', creditAcct: 'Bank Account', label: 'Salary/Wages' },
  { match: ['gib/', 'gst', 'igst', 'cgst', 'sgst', 'gstn', 'gst challan', 'tax challan'], type: 'debit', debitAcct: 'GST Payable (Output)', creditAcct: 'Bank Account', label: 'GST Payment' },
  { match: ['bses', 'electricity', 'bijli', 'msedcl', 'tata power', 'adani electric', 'power bill', 'bil/onl'], type: 'debit', debitAcct: 'Utilities', creditAcct: 'Bank Account', label: 'Electricity' },
  { match: ['waterbill', 'water bill', 'jal board', 'djb'], type: 'debit', debitAcct: 'Utilities', creditAcct: 'Bank Account', label: 'Water Bill' },
  { match: ['rent', 'rental', 'landlord', 'property owner'], type: 'debit', debitAcct: 'Rent', creditAcct: 'Bank Account', label: 'Rent' },
  { match: ['amazon', 'flipkart', 'meesho', 'myntra'], type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account', label: 'Online Supplies' },
  { match: ['marketing', 'advertis', 'meta', 'google ads', 'facebook ads', 'instagram'], type: 'debit', debitAcct: 'Marketing & Advertising', creditAcct: 'Bank Account', label: 'Marketing' },
  { match: ['software', 'subscription', 'saas', 'tally', 'zoho', 'microsoft', 'adobe', 'aws', 'google workspace'], type: 'debit', debitAcct: 'Software & Subscriptions', creditAcct: 'Bank Account', label: 'Software' },
  { match: ['uber', 'ola', 'petrol', 'diesel', 'fuel', 'travel', 'cab', 'auto ride'], type: 'debit', debitAcct: 'Travel & Conveyance', creditAcct: 'Bank Account', label: 'Travel' },
  { match: ['emi', 'loan repay', 'loan instalment', 'loan emi'], type: 'debit', debitAcct: 'Loans & Borrowings', creditAcct: 'Bank Account', label: 'Loan Repayment' },
  { match: ['drawings', 'personal use', 'self withdrawal'], type: 'debit', debitAcct: 'Drawings', creditAcct: 'Bank Account', label: 'Drawings' },
  { match: ['equipment', 'machine', 'sewing', 'machinery', 'tool', 'overlock'], type: 'debit', debitAcct: 'Fixed Assets', creditAcct: 'Bank Account', label: 'Fixed Asset' },
];

function loadCustomRules() {
  try {
    const raw = localStorage.getItem(CUSTOM_RULES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveBankAutomationRule({ businessId, keyword, type, debitAcct, creditAcct, label }) {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized || !debitAcct || !creditAcct) return false;
  const all = loadCustomRules();
  const next = all.filter(r => !(r.businessId === businessId && r.type === type && r.keyword === normalized));
  next.unshift({ businessId: businessId || null, keyword: normalized, type, debitAcct, creditAcct, label: label || 'Custom Rule', createdAt: new Date().toISOString() });
  localStorage.setItem(CUSTOM_RULES_KEY, JSON.stringify(next.slice(0, 500)));
  return true;
}

export function getBankAutomationRules(businessId) {
  return loadCustomRules().filter(r => !r.businessId || r.businessId === businessId);
}

function textFor(txn) {
  const desc = String(txn?.description || '').toLowerCase();
  const ref = String(txn?.reference || '').toLowerCase();
  const upiPurposeMatch = desc.match(/upi\/\d+\/([^/]+)\//);
  const upiPurpose = upiPurposeMatch ? upiPurposeMatch[1].trim() : '';
  return `${desc} ${ref} ${upiPurpose}`.trim();
}

export function classifyBankTransaction(txn, businessId = null) {
  const combined = textFor(txn);
  const custom = getBankAutomationRules(businessId);

  // User-created rules always win over built-in rules.
  for (const rule of custom) {
    if (rule.type !== txn.type) continue;
    if (combined.includes(rule.keyword)) {
      return { debitAcct: rule.debitAcct, creditAcct: rule.creditAcct, label: rule.label, confidence: 'high', method: 'custom_rule', matchedKeyword: rule.keyword, reason: rule.label };
    }
  }

  for (const rule of BANK_RULES) {
    if (rule.type !== txn.type) continue;
    for (const keyword of rule.match) {
      if (combined.includes(keyword.toLowerCase())) {
        return { debitAcct: rule.debitAcct, creditAcct: rule.creditAcct, label: rule.label, confidence: 'high', method: 'rule', matchedKeyword: keyword, reason: rule.label };
      }
    }
  }

  return {
    debitAcct: txn.type === 'credit' ? 'Bank Account' : 'Miscellaneous Expenses',
    creditAcct: txn.type === 'credit' ? 'Other Income' : 'Bank Account',
    label: 'Unclassified',
    confidence: 'low',
    method: 'fallback',
    matchedKeyword: null,
    reason: 'No automation rule matched',
  };
}


// Deterministic bank-to-books matching. No API/AI required.
// Priority: exact bank reference/invoice number > GSTIN/phone > party name > amount/date.
export function matchBankTransaction(txn, parties = [], invoices = [], payments = [], existingTxns = []) {
  const desc = String(txn?.description || '').toLowerCase();
  const ref = String(txn?.reference || '').toLowerCase();
  const combined = `${desc} ${ref}`.trim();

  const duplicate = existingTxns.find(e =>
    (txn.reference && e.reference && e.reference === txn.reference) ||
    (e.txn_date === txn.date && Number(e.amount) === Number(txn.amount) && e.type === txn.type)
  );
  if (duplicate) return { status: 'duplicate', confidence: 'high', partyId: null, invoiceId: null, score: 100, reason: 'Already imported/recorded' };

  const alreadyPaid = payments.find(p => p.reference && combined.includes(String(p.reference).toLowerCase()));
  if (alreadyPaid) return { status: 'duplicate', confidence: 'high', partyId: alreadyPaid.party_id || null, invoiceId: alreadyPaid.invoice_id || null, score: 95, reason: 'Payment reference already recorded' };

  let bestParty = null, bestScore = 0, bestReasons = [];
  for (const party of parties) {
    let score = 0, reasons = [];
    const name = String(party.name || '').toLowerCase();
    const gstin = String(party.gstin || '').toLowerCase();
    const phone = String(party.phone || '').replace(/\D/g, '');
    if (name && name.length >= 4 && combined.includes(name)) { score += 8; reasons.push('exact party name'); }
    name.split(/\s+/).filter(w => w.length >= 4).forEach(w => { if (combined.includes(w)) { score += w.length >= 7 ? 3 : 1; } });
    if (gstin && gstin.length >= 10 && combined.includes(gstin)) { score += 12; reasons.push('GSTIN'); }
    if (phone.length >= 10 && combined.includes(phone.slice(-10))) { score += 10; reasons.push('phone'); }
    if (score > bestScore) { bestScore = score; bestParty = party; bestReasons = reasons; }
  }

  let bestInvoice = null, bestInvoiceScore = 0;
  if (txn.type === 'credit') {
    // Invoice number/reference is strong enough to find an invoice even when
    // the bank narration does not contain the customer's name. Otherwise
    // restrict candidates to the matched party to avoid false positives.
    const candidates = invoices.filter(i => !['cancelled','proforma'].includes(i.status) && (i.party_id === bestParty?.id || (i.invoice_number && combined.includes(String(i.invoice_number).toLowerCase()))));
    for (const inv of candidates) {
      const number = String(inv.invoice_number || '').toLowerCase();
      let score = 0;
      if (number && combined.includes(number)) score += 60;
      if (bestParty?.id && inv.party_id === bestParty.id) score += 10;
      const total = Number(inv.total || 0);
      const paid = payments.filter(p => p.invoice_id === inv.id).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const outstanding = Math.max(0, total - paid);
      if (outstanding <= 0.01) continue;
      const diffOutstanding = Math.abs(outstanding - Number(txn.amount));
      const diffTotal = Math.abs(total - Number(txn.amount));
      if (outstanding > 0 && diffOutstanding < 0.01) score += 45;
      else if (outstanding > 0 && diffOutstanding / outstanding < 0.01) score += 38;
      else if (outstanding > 0 && diffOutstanding < 500) score += 20;
      else if (total > 0 && diffTotal / total < 0.01) score += 18;
      if (inv.issue_date && txn.date) {
        const days = Math.abs(new Date(txn.date) - new Date(inv.issue_date)) / 86400000;
        if (days <= 90) score += 5;
      }
      if (score > bestInvoiceScore) { bestInvoiceScore = score; bestInvoice = inv; }
    }
  }

  const score = bestScore + bestInvoiceScore;
  const confidence = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
  return {
    status: score >= 20 ? 'matched' : 'unknown',
    confidence,
    partyId: bestParty?.id || null,
    invoiceId: bestInvoice?.id || null,
    score,
    reason: bestInvoice
      ? `Matched ${bestParty?.name || 'party'} + ${bestInvoice.invoice_number}`
      : bestParty
        ? `Matched ${bestParty.name}${bestReasons.length ? ` (${bestReasons.join(', ')})` : ''}`
        : 'No match found',
  };
}
