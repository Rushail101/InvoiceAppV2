// ─── STYLES ───────────────────────────────────────────────────────────────────
export const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`;

export const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0d0d;--bg2:#161616;--bg3:#1e1e1e;--bg4:#252525;
  --border:#2a2a2a;--border2:#333;--border3:#3d3d3d;
  --text:#e8e6df;--text2:#999;--text3:#555;--text4:#333;
  --accent:#c8f064;--accent2:#a8d844;--accent3:#e8ff8a;
  --red:#ff5c5c;--red2:#cc3333;
  --amber:#f5a623;--amber2:#cc8800;
  --blue:#5ca0ff;--blue2:#3a7acc;
  --green:#4ecb71;--green2:#2ea050;
  --purple:#a78bfa;--purple2:#7c55e0;
  --teal:#2dd4bf;
  --font:'Syne',sans-serif;--mono:'DM Mono',monospace;
  --r:8px;--r2:12px;--r3:16px;
  --shadow:0 2px 12px rgba(0,0,0,.4);
  --shadow2:0 4px 24px rgba(0,0,0,.6);
}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;min-height:100vh;-webkit-font-smoothing:antialiased}
.app{display:flex;min-height:100vh}

/* ── Sidebar ── */
.sidebar{width:228px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;flex-shrink:0;overflow:hidden}
.sidebar-logo{padding:20px 18px 14px;border-bottom:1px solid var(--border)}
.sidebar-logo h1{font-size:17px;font-weight:800;letter-spacing:-.4px;color:var(--accent)}
.sidebar-logo p{font-size:10px;color:var(--text3);margin-top:2px;letter-spacing:.1em;text-transform:uppercase;font-family:var(--mono)}
.sidebar-biz{padding:10px 10px 6px}
.sidebar-biz label{font-size:10px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;font-family:var(--mono);display:block;margin-bottom:5px}
.biz-select{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--r);padding:6px 8px;font-family:var(--font);font-size:12px;cursor:pointer;outline:none}
.nav{flex:1;padding:6px;overflow-y:auto}
.nav-label{font-size:9px;color:var(--text4);letter-spacing:.1em;text-transform:uppercase;font-family:var(--mono);padding:10px 10px 4px;margin-top:4px}
.nav-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:var(--r);cursor:pointer;color:var(--text2);font-size:12.5px;font-weight:500;transition:all .12s;border:none;background:none;width:100%;text-align:left}
.nav-item:hover{background:var(--bg3);color:var(--text)}
.nav-item.active{background:var(--accent);color:#0d0d0d;font-weight:600}
.nav-item .icon{width:15px;text-align:center;font-size:12px;flex-shrink:0}
.sidebar-foot{padding:10px 12px;border-top:1px solid var(--border)}

/* ── Main ── */
.main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 26px;border-bottom:1px solid var(--border);background:var(--bg);flex-shrink:0}
.topbar h2{font-size:17px;font-weight:700;letter-spacing:-.3px}
.topbar-right{display:flex;gap:8px;align-items:center}
.content{padding:22px 26px;flex:1;overflow-y:auto}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:var(--r);font-family:var(--font);font-size:12.5px;font-weight:500;cursor:pointer;border:none;transition:all .12s;white-space:nowrap}
.btn-primary{background:var(--accent);color:#0d0d0d}.btn-primary:hover{background:var(--accent2)}
.btn-ghost{background:transparent;color:var(--text2);border:1px solid var(--border2)}.btn-ghost:hover{color:var(--text);border-color:var(--border3)}
.btn-danger{background:transparent;color:var(--red);border:1px solid #3a1a1a}.btn-danger:hover{background:#1e0a0a}
.btn-warning{background:transparent;color:var(--amber);border:1px solid #3a2800}.btn-warning:hover{background:#1e1400}
.btn-info{background:transparent;color:var(--blue);border:1px solid #1a2e4a}.btn-info:hover{background:#0a1520}
.btn-sm{padding:4px 10px;font-size:11.5px}
.btn:disabled{opacity:.45;cursor:not-allowed}

/* ── Stats ── */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);padding:14px 18px;position:relative;overflow:hidden}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.stat-card.green::before{background:var(--green)}
.stat-card.amber::before{background:var(--amber)}
.stat-card.red::before{background:var(--red)}
.stat-card.blue::before{background:var(--blue)}
.stat-card.purple::before{background:var(--purple)}
.stat-label{font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;font-family:var(--mono);margin-bottom:7px}
.stat-val{font-size:22px;font-weight:700;letter-spacing:-.4px}
.stat-val.green{color:var(--green)}.stat-val.amber{color:var(--amber)}.stat-val.red{color:var(--red)}.stat-val.blue{color:var(--blue)}.stat-val.purple{color:var(--purple)}
.stat-sub{font-size:10px;color:var(--text3);margin-top:3px;font-family:var(--mono)}

/* ── Tables ── */
.table-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden}
.table-toolbar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.table-toolbar h3{font-size:13px;font-weight:600}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:9px 16px;font-size:10px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;font-family:var(--mono);border-bottom:1px solid var(--border);font-weight:500;white-space:nowrap}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
td{padding:10px 16px;font-size:12.5px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.mono{font-family:var(--mono);font-size:11.5px}

/* ── Badges ── */
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10.5px;font-weight:500;font-family:var(--mono);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.badge-paid,.badge-active{background:#0a2016;color:var(--green);border:1px solid #1a4028}
.badge-partially_paid{background:#1a1500;color:var(--amber);border:1px solid #3a2e00}
.badge-sent{background:#081828;color:var(--blue);border:1px solid #143050}
.badge-draft{background:var(--bg3);color:var(--text3);border:1px solid var(--border)}
.badge-proforma{background:#100a28;color:var(--purple);border:1px solid #201848}
.badge-overdue{background:#200808;color:var(--red);border:1px solid #401010}
.badge-cancelled{background:var(--bg3);color:var(--text4);border:1px solid var(--border)}
.badge-client{background:#100a28;color:var(--purple);border:1px solid #201848}
.badge-vendor{background:#0a2016;color:var(--green);border:1px solid #1a4028}
.badge-asset{background:#081828;color:var(--blue);border:1px solid #143050}
.badge-liability{background:#200808;color:var(--red);border:1px solid #401010}
.badge-equity{background:#100a28;color:var(--purple);border:1px solid #201848}
.badge-income{background:#0a2016;color:var(--green);border:1px solid #1a4028}
.badge-expense{background:#1a1500;color:var(--amber);border:1px solid #3a2e00}
.badge-credit_note,.badge-credit-note{background:#1a0810;color:#ff8cc8;border:1px solid #3a1030}
.badge-debit{background:#0d1a00;color:var(--accent);border:1px solid #1e3a00}

/* ── Modal ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px;backdrop-filter:blur(2px)}
.modal{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r3);width:100%;max-width:660px;max-height:92vh;display:flex;flex-direction:column;box-shadow:var(--shadow2)}
.modal-lg{max-width:900px}
.modal-xl{max-width:1100px}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--border);flex-shrink:0}
.modal-head h3{font-size:15px;font-weight:600}
.modal-body{padding:20px 22px;overflow-y:auto;flex:1}
.modal-foot{padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}

/* ── Forms ── */
.form-row{display:grid;gap:12px;margin-bottom:12px}
.form-row.cols-2{grid-template-columns:1fr 1fr}
.form-row.cols-3{grid-template-columns:1fr 1fr 1fr}
.form-row.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}
.form-group{display:flex;flex-direction:column;gap:4px}
.form-group label{font-size:10.5px;color:var(--text2);font-weight:500;letter-spacing:.04em}
.form-group input,.form-group select,.form-group textarea{background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--r);padding:7px 11px;font-family:var(--font);font-size:13px;width:100%;outline:none;transition:border-color .12s}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--accent);background:var(--bg4)}
.form-group textarea{resize:vertical;min-height:56px}
.form-group select option{background:var(--bg3);color:var(--text)}
.form-note{font-size:10px;color:var(--text3);margin-top:2px;font-family:var(--mono)}

/* ── Line items ── */
.line-items-head{display:grid;gap:5px;font-size:9.5px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;padding:0 0 5px;border-bottom:1px solid var(--border);margin-bottom:6px}
.line-item-row{display:grid;gap:5px;align-items:center;margin-bottom:6px}
.line-item-row input,.line-item-row select{background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--r);padding:6px 7px;font-family:var(--font);font-size:12px;width:100%;outline:none}
.line-item-row input:focus,.line-item-row select:focus{border-color:var(--accent)}
.line-total{text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--text2);padding:6px 0}
.remove-btn{width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;transition:all .12s}
.remove-btn:hover{color:var(--red);border-color:var(--red);background:#1e0808}
.inv-totals{text-align:right;padding:10px 0;border-top:1px solid var(--border);margin-top:4px}
.inv-totals p{font-size:12.5px;color:var(--text2);margin-bottom:3px;display:flex;justify-content:flex-end;gap:20px}
.inv-totals p span:last-child{font-family:var(--mono);min-width:110px;text-align:right}
.inv-totals .grand{font-size:15px;font-weight:700;color:var(--accent)}
.inv-totals .balance{font-size:13px;font-weight:600;color:var(--amber)}

/* ── Filter bar ── */
.filter-bar{display:flex;gap:7px;margin-bottom:14px;align-items:center;flex-wrap:wrap}
.filter-bar input{flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:var(--r);padding:7px 11px;font-family:var(--font);font-size:13px;outline:none;transition:border-color .12s}
.filter-bar input:focus{border-color:var(--accent)}
.filter-bar select{background:var(--bg2);border:1px solid var(--border);color:var(--text2);border-radius:var(--r);padding:7px 11px;font-family:var(--font);font-size:12.5px;cursor:pointer;outline:none}

/* ── Config screen ── */
.config-wrap{display:flex;min-height:100vh;background:var(--bg);align-items:center;justify-content:center}
.config-screen{max-width:440px;width:100%;padding:40px;text-align:center}
.config-screen h2{font-size:24px;font-weight:800;margin-bottom:6px;letter-spacing:-.4px}
.config-screen p{color:var(--text2);font-size:13px;margin-bottom:24px;line-height:1.7}
.config-form{text-align:left}

/* ── Misc ── */
.empty{text-align:center;padding:50px 20px;color:var(--text3)}
.empty-icon{font-size:28px;margin-bottom:10px}
.empty p{font-size:12.5px;line-height:1.6}
.loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--text3);font-size:13px;font-family:var(--mono)}
.err-msg{color:var(--red);font-size:11.5px;margin-top:5px;font-family:var(--mono)}
.warn-msg{color:var(--amber);font-size:11.5px;margin-top:5px;font-family:var(--mono)}
.info-banner{background:#081828;border:1px solid #143050;border-radius:var(--r);padding:9px 13px;font-size:12px;color:var(--blue);margin-bottom:12px}
.pf-banner{background:#100a28;border:1px solid #201848;border-radius:var(--r);padding:9px 13px;font-size:12px;color:var(--purple);margin-bottom:12px}
.cn-banner{background:#1a0810;border:1px solid #3a1030;border-radius:var(--r);padding:9px 13px;font-size:12px;color:#ff8cc8;margin-bottom:12px}
.section-title{font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.three-col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);padding:16px 20px}
.card-head{font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.07em;font-family:var(--mono);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.ledger-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12.5px}
.ledger-row:last-child{border-bottom:none}
.ledger-row.total{font-weight:600;background:var(--bg3);margin:0 -20px;padding:7px 20px;border-bottom:none}
.tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-family:var(--mono);background:var(--bg3);color:var(--text3);border:1px solid var(--border)}
.dr{color:var(--red)}.cr{color:var(--green)}
.pay-history{margin-top:10px;padding:10px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--border)}
.pay-history h4{font-size:9.5px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
.pay-row{display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;border-bottom:1px solid var(--border)}
.pay-row:last-child{border-bottom:none}
.sql-box{background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:16px;font-family:var(--mono);font-size:10.5px;line-height:1.7;color:var(--text2);white-space:pre-wrap;word-break:break-word;max-height:420px;overflow-y:auto;text-align:left}
.pill-tabs{display:flex;gap:4px;background:var(--bg3);border-radius:var(--r2);padding:3px;width:fit-content;margin-bottom:16px}
.pill-tab{padding:5px 14px;border-radius:var(--r);font-size:12px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--text2);transition:all .12s}
.pill-tab.active{background:var(--bg2);color:var(--text);border:1px solid var(--border2)}
.gst-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;font-size:10px;font-family:var(--mono);border:1px solid var(--border2);color:var(--text3);background:var(--bg3)}
.gst-chip.igst{color:var(--amber);border-color:#3a2800}
.gst-chip.cgst{color:var(--blue);border-color:#143050}
.gst-chip.sgst{color:var(--teal);border-color:#0a2a28}
.aging-bar{height:6px;border-radius:3px;background:var(--bg3);overflow:hidden;margin-top:3px}
.aging-fill{height:100%;border-radius:3px;transition:width .3s}
`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const today = () => new Date().toISOString().split('T')[0];
export const getFY = () => {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const sy = m >= 3 ? y : y - 1;
  return `${String(sy).slice(-2)}-${String(sy + 1).slice(-2)}`;
};

export function nextInvNum(invoices, isProforma) {
  const fy = getFY();
  if (isProforma) {
    const pat = new RegExp(`^PI-${fy}/(\\d+)$`);
    let max = 0; invoices.forEach(i => { const m = (i.invoice_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return `PI-${fy}/${String(max + 1).padStart(3, '0')}`;
  }
  const pat = new RegExp(`^${fy}/(\\d+)$`);
  let max = 1000; invoices.forEach(i => { const m = (i.invoice_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `${fy}/${max + 1}`;
}

export function nextCNNum(creditNotes) {
  const fy = getFY();
  const pat = new RegExp(`^CN-${fy}/(\\d+)$`);
  let max = 0; creditNotes.forEach(c => { const m = (c.cn_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `CN-${fy}/${String(max + 1).padStart(3, '0')}`;
}

// CGST/SGST vs IGST determination
export function gstType(bizState, placeOfSupply) {
  if (!bizState || !placeOfSupply) return 'igst';
  const norm = s => s.toLowerCase().replace(/\s+/g, '').replace(/\(.*\)/, '');
  return norm(bizState) === norm(placeOfSupply) ? 'intrastate' : 'igst';
}

export function calcLineTax(taxable, taxPercent, isIntrastate) {
  const total = taxable * taxPercent / 100;
  if (isIntrastate) return { cgst: total / 2, sgst: total / 2, igst: 0, total };
  return { cgst: 0, sgst: 0, igst: total, total };
}

export function numWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const t = Math.floor(n); const p = Math.round((n - t) * 100);
  function hw(x) {
    if (x === 0) return '';
    if (x < 20) return a[x] + ' ';
    if (x < 100) return b[Math.floor(x / 10)] + ' ' + (x % 10 ? a[x % 10] + ' ' : '');
    if (x < 1000) return a[Math.floor(x / 100)] + ' Hundred ' + (x % 100 ? hw(x % 100) : '');
    if (x < 100000) return hw(Math.floor(x / 1000)) + 'Thousand ' + hw(x % 1000);
    if (x < 10000000) return hw(Math.floor(x / 100000)) + 'Lakh ' + hw(x % 100000);
    return hw(Math.floor(x / 10000000)) + 'Crore ' + hw(x % 10000000);
  }
  return 'Indian Rupee ' + (t ? hw(t).trim() : 'Zero') + (p ? ' and ' + hw(p).trim() + ' Paise Only' : ' Only');
}

// Standard Chart of Accounts seed
export const DEFAULT_ACCOUNTS = [
  // Assets
  { code: '1000', name: 'Cash in Hand', group: 'asset', sub_group: 'Current Assets', description: 'Physical cash' },
  { code: '1010', name: 'Bank Account', group: 'asset', sub_group: 'Current Assets', description: 'Primary bank account' },
  { code: '1100', name: 'Accounts Receivable', group: 'asset', sub_group: 'Current Assets', description: 'Money owed by customers' },
  { code: '1200', name: 'Inventory / Stock', group: 'asset', sub_group: 'Current Assets', description: 'Goods held for sale' },
  { code: '1300', name: 'Prepaid Expenses', group: 'asset', sub_group: 'Current Assets', description: 'Expenses paid in advance' },
  { code: '1500', name: 'Fixed Assets', group: 'asset', sub_group: 'Fixed Assets', description: 'Plant, machinery, equipment' },
  { code: '1510', name: 'Accumulated Depreciation', group: 'asset', sub_group: 'Fixed Assets', description: 'Contra asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', group: 'liability', sub_group: 'Current Liabilities', description: 'Money owed to vendors' },
  { code: '2100', name: 'GST Payable (Output)', group: 'liability', sub_group: 'Current Liabilities', description: 'GST collected from customers' },
  { code: '2110', name: 'IGST Payable', group: 'liability', sub_group: 'Current Liabilities', description: 'Inter-state GST' },
  { code: '2120', name: 'CGST Payable', group: 'liability', sub_group: 'Current Liabilities', description: 'Central GST' },
  { code: '2130', name: 'SGST Payable', group: 'liability', sub_group: 'Current Liabilities', description: 'State GST' },
  { code: '2200', name: 'GST Input Credit', group: 'liability', sub_group: 'Current Liabilities', description: 'GST paid on purchases (credit)' },
  { code: '2300', name: 'TDS Payable', group: 'liability', sub_group: 'Current Liabilities', description: 'Tax deducted at source' },
  { code: '2500', name: 'Loans & Borrowings', group: 'liability', sub_group: 'Long-term Liabilities', description: 'Term loans' },
  // Equity
  { code: '3000', name: 'Owner\'s Capital', group: 'equity', sub_group: 'Equity', description: 'Proprietor capital account' },
  { code: '3100', name: 'Retained Earnings', group: 'equity', sub_group: 'Equity', description: 'Accumulated profits' },
  { code: '3200', name: 'Drawings', group: 'equity', sub_group: 'Equity', description: 'Owner withdrawals' },
  // Income
  { code: '4000', name: 'Sales Revenue', group: 'income', sub_group: 'Direct Income', description: 'Product sales' },
  { code: '4100', name: 'Service Revenue', group: 'income', sub_group: 'Direct Income', description: 'Service income' },
  { code: '4200', name: 'Other Income', group: 'income', sub_group: 'Indirect Income', description: 'Interest, misc.' },
  // Expenses
  { code: '5000', name: 'Cost of Goods Sold', group: 'expense', sub_group: 'Direct Expenses', description: 'Raw materials, production' },
  { code: '5100', name: 'Raw Materials', group: 'expense', sub_group: 'Direct Expenses', description: 'Fabric, yarn, materials' },
  { code: '5200', name: 'Wages & Salaries', group: 'expense', sub_group: 'Direct Expenses', description: 'Labour costs' },
  { code: '6000', name: 'Rent', group: 'expense', sub_group: 'Indirect Expenses', description: 'Office/factory rent' },
  { code: '6100', name: 'Utilities', group: 'expense', sub_group: 'Indirect Expenses', description: 'Electricity, water' },
  { code: '6200', name: 'Marketing & Advertising', group: 'expense', sub_group: 'Indirect Expenses', description: 'Promotion expenses' },
  { code: '6300', name: 'Shipping & Freight', group: 'expense', sub_group: 'Indirect Expenses', description: 'Delivery costs' },
  { code: '6400', name: 'Software & Subscriptions', group: 'expense', sub_group: 'Indirect Expenses', description: 'SaaS tools' },
  { code: '6500', name: 'Travel & Conveyance', group: 'expense', sub_group: 'Indirect Expenses', description: 'Travel expenses' },
  { code: '6600', name: 'Depreciation', group: 'expense', sub_group: 'Indirect Expenses', description: 'Asset depreciation' },
  { code: '6900', name: 'Miscellaneous Expenses', group: 'expense', sub_group: 'Indirect Expenses', description: 'Other expenses' },
];

export const EXPENSE_CATEGORIES = [
  'Raw Materials', 'Wages & Salaries', 'Rent', 'Utilities', 'Shipping & Freight',
  'Marketing', 'Software', 'Travel', 'Printing & Packaging', 'Equipment', 'Miscellaneous'
];

export const GST_RATES = [0, 5, 12, 18, 28];
export const PAY_MODES = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'Cheque', 'Cash', 'Other'];
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli', 'Daman and Diu',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

// State codes for GSTR
export const STATE_CODES = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', 'Punjab': '03', 'Chandigarh': '04',
  'Uttarakhand': '05', 'Haryana': '06', 'Delhi': '07', 'Rajasthan': '08',
  'Uttar Pradesh': '09', 'Bihar': '10', 'Sikkim': '11', 'Arunachal Pradesh': '12',
  'Nagaland': '13', 'Manipur': '14', 'Mizoram': '15', 'Tripura': '16', 'Meghalaya': '17',
  'Assam': '18', 'West Bengal': '19', 'Jharkhand': '20', 'Odisha': '21',
  'Chhattisgarh': '22', 'Madhya Pradesh': '23', 'Gujarat': '24',
  'Dadra and Nagar Haveli': '26', 'Daman and Diu': '25', 'Maharashtra': '27',
  'Karnataka': '29', 'Goa': '30', 'Lakshadweep': '31', 'Kerala': '32',
  'Tamil Nadu': '33', 'Puducherry': '34', 'Andaman and Nicobar Islands': '35',
  'Telangana': '36', 'Andhra Pradesh': '37', 'Ladakh': '38'
};
