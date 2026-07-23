import { numWords, fmtDate } from './constants.js';

export function printInvoice(invoice, items, party, biz, invPayments, isCreditNote = false) {
  const calc = items.map(it => {
    const base = Number(it.quantity) * Number(it.unit_price);
    const discAmt = base * (Number(it.discount_percent || 0) / 100);
    const taxable = base - discAmt;
    const cgst = Number(it.cgst_amount || 0);
    const sgst = Number(it.sgst_amount || 0);
    const igst = Number(it.igst_amount || 0);
    const tax = cgst + sgst + igst;
    return { ...it, base, discAmt, taxable, cgst, sgst, igst, tax, lineTotal: taxable + tax };
  });

  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const preDiscGrand = subtotal + totalTax;
  const lineDiscTotal = calc.reduce((s, i) => s + i.discAmt, 0);
  const invLevelDisc = Number(invoice.discount_amount || 0);
  const invLevelDiscPct = Number(invoice.discount_percent || 0);
  const grand = preDiscGrand - invLevelDisc;
  const discTotal = lineDiscTotal; // line-item discounts (already baked into taxable)
  const totalPaid = (invPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = grand - totalPaid;
  const isIntrastate = totalCGST > 0;
  const isPF = invoice.status === 'proforma';
  const isCN = isCreditNote;

  // GST groups for totals section
  const gstGroups = {};
  calc.forEach(it => {
    const r = Number(it.tax_percent || 0);
    if (r > 0) {
      if (!gstGroups[r]) gstGroups[r] = { cgst: 0, sgst: 0, igst: 0 };
      gstGroups[r].cgst += it.cgst;
      gstGroups[r].sgst += it.sgst;
      gstGroups[r].igst += it.igst;
    }
  });

  const upiData = biz.upi_id
    ? `upi://pay?pa=${encodeURIComponent(biz.upi_id)}&pn=${encodeURIComponent(biz.name || '')}&am=${grand.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoice_number || '')}`
    : null;
  const qrUrl = upiData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(upiData)}`
    : null;

  const titleMap = { proforma: 'PROFORMA INVOICE', draft: 'TAX INVOICE', sent: 'TAX INVOICE', paid: 'TAX INVOICE', partially_paid: 'TAX INVOICE', overdue: 'TAX INVOICE', cancelled: 'TAX INVOICE' };
  const docTitle = isCN ? 'CREDIT NOTE' : (titleMap[invoice.status] || 'TAX INVOICE');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${invoice.invoice_number || invoice.cn_number}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:20px}
.page{max-width:800px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2.5px solid #111;margin-bottom:12px}
.biz-name{font-size:22px;font-weight:800;margin-bottom:4px;letter-spacing:-.3px}
.biz-info{font-size:10px;color:#444;line-height:1.65}
.doc-title{text-align:right}
.doc-title h1{font-size:28px;font-weight:800;letter-spacing:1.5px;color:${isCN ? '#b00' : '#111'}}
.doc-title .sub{font-size:9.5px;color:#888;margin-top:2px}
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #ccc;margin-bottom:10px}
.mc{padding:5px 9px;font-size:10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.mc:nth-child(3n){border-right:none}.mc:nth-last-child(-n+3){border-bottom:none}
.mc .lbl{color:#888;margin-bottom:1px;font-size:9px;text-transform:uppercase;letter-spacing:.04em}.mc .val{font-weight:700}
.party{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ccc;margin-bottom:10px}
.pc{padding:8px 10px;font-size:10px}.pc:first-child{border-right:1px solid #ccc}
.pc h4{font-weight:700;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #e0e0e0;font-size:9.5px;color:#555;text-transform:uppercase;letter-spacing:.05em}
.pc p{line-height:1.65}
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:0}
thead th{background:#111;color:#fff;padding:6px 8px;text-align:left;font-weight:600;font-size:9.5px;letter-spacing:.04em}
thead th.r{text-align:right}
tbody td{padding:4.5px 8px;border-bottom:1px solid #eee;vertical-align:top}
tbody td.r{text-align:right}
tbody tr:nth-child(even) td{background:#fafafa}
.bottom{display:flex;border:1px solid #ccc;border-top:none}
.words-col{flex:1;padding:9px;border-right:1px solid #ccc;font-size:10px}
.words-col .lbl{color:#888;margin-bottom:2px;font-size:9px}.words-col .val{font-style:italic}
.words-col .partial-note{color:#b45309;margin-top:3px;font-weight:500;font-size:9.5px}
.tots-col{min-width:220px}
.tots-col table{font-size:10px}
.tots-col td{padding:3.5px 9px;border-bottom:1px solid #eee}
.tots-col td.r{text-align:right}
.tots-col .grand-row td{font-weight:700;font-size:12px;background:#111;color:#fff;border-bottom:none}
.tots-col .grand-row td.r{text-align:right}
.tots-col .bal-row td{font-weight:700;color:#b00;font-size:11px}
.gst-detail{display:flex;gap:12px;font-size:9.5px;color:#666;margin-top:3px;flex-wrap:wrap}
.gst-chip{padding:1px 5px;border-radius:3px;font-size:9px}
.gst-igst{background:#fff8e8;color:#7a4500;border:1px solid #e0c080}
.gst-cgst{background:#e8f0ff;color:#1a3a8a;border:1px solid #b0c8f0}
.gst-sgst{background:#e8fff8;color:#005a40;border:1px solid #80d0b8}
.footer{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ccc;margin-top:10px}
.fc{padding:9px}.fc:first-child{border-right:1px solid #ccc}
.fc h4{font-size:9.5px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}
.bd-row{display:flex;justify-content:space-between;font-size:9.5px;padding:2px 0;border-bottom:1px solid #f0f0f0}
.bd-row:last-child{border-bottom:none}
.bd-row span:first-child{color:#777}
.qr-wrap{text-align:center}
.note{margin-top:8px;padding:6px 9px;background:#f8f8f8;border:1px solid #e5e5e5;font-size:9.5px;color:#666;border-radius:3px}
.disc-amt{font-size:9px;color:#888;font-style:italic}
@media print{body{padding:0}.page{max-width:100%}button{display:none!important}}
</style></head><body><div class="page">

<div class="header">
  <div>
    ${biz.logo_url ? `<img src="${biz.logo_url}" style="height:40px;margin-bottom:5px;display:block">` : ''}
    <div class="biz-name">${biz.name || ''}</div>
    <div class="biz-info">
      ${(biz.address || '').replace(/\n/g, '<br>')}
      ${biz.gstin ? `<br><strong>GSTIN:</strong> ${biz.gstin}` : ''}
      ${biz.state ? ` &nbsp;|&nbsp; <strong>State:</strong> ${biz.state}` : ''}
      <br>${biz.phone || ''} &nbsp;|&nbsp; ${biz.email || ''}
    </div>
  </div>
  <div class="doc-title">
    <h1>${docTitle}</h1>
    ${isPF ? '<div class="sub">Not valid for GST input credit</div>' : ''}
    ${isCN ? '<div class="sub">Credit Note</div>' : ''}
    ${isIntrastate ? '<div class="sub" style="color:#1a3a8a">Intra-state supply · CGST + SGST</div>' : '<div class="sub" style="color:#7a4500">Inter-state supply · IGST</div>'}
  </div>
</div>

<div class="meta-grid">
  <div class="mc"><div class="lbl">${isCN ? 'CN Number' : 'Invoice #'}</div><div class="val">${invoice.invoice_number || invoice.cn_number || ''}</div></div>
  <div class="mc"><div class="lbl">Date</div><div class="val">${fmtDate(invoice.issue_date || invoice.cn_date)}</div></div>
  <div class="mc"><div class="lbl">Place of Supply</div><div class="val">${party.state || ''}</div></div>
  ${!isCN ? `<div class="mc"><div class="lbl">Due Date</div><div class="val">${fmtDate(invoice.due_date)}</div></div>` : ''}
  ${!isCN ? `<div class="mc"><div class="lbl">Terms</div><div class="val">${invoice.notes || 'Due on Receipt'}</div></div>` : ''}
  <div class="mc"><div class="lbl">Status</div><div class="val">${(invoice.status || 'CREDIT NOTE').toUpperCase()}</div></div>
</div>

<div class="party">
  <div class="pc"><h4>Bill To</h4>
    <p><strong>${party.name || ''}</strong><br>
    ${(party.address || '').replace(/\n/g, '<br>')}
    ${party.phone ? `<br>${party.phone}` : ''}
    ${party.gstin ? `<br><strong>GSTIN:</strong> ${party.gstin}` : ''}</p>
  </div>
  <div class="pc"><h4>Ship To</h4>
    <p>${(party.address || '').replace(/\n/g, '<br>')}
    ${party.phone ? `<br>${party.phone}` : ''}</p>
  </div>
</div>

<table>
  <thead><tr>
    <th style="width:24px">#</th>
    <th>Item & Description</th>
    <th>HSN</th>
    <th class="r">Qty</th>
    <th class="r">Rate</th>
    ${discTotal > 0 ? '<th class="r">Disc%</th>' : ''}
    <th class="r">Taxable</th>
    <th class="r">GST%</th>
    ${isIntrastate ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}
    <th class="r">Amount</th>
  </tr></thead>
  <tbody>
  ${calc.map((it, i) => `<tr>
    <td>${i + 1}</td>
    <td>${it.description || ''}</td>
    <td style="font-family:monospace;font-size:9px">${it.hsn_code || ''}</td>
    <td class="r">${Number(it.quantity).toFixed(2)}</td>
    <td class="r">${Number(it.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    ${discTotal > 0 ? `<td class="r"><span class="disc-amt">${it.discount_percent || 0}%</span></td>` : ''}
    <td class="r">${it.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    <td class="r">${it.tax_percent}%</td>
    ${isIntrastate
      ? `<td class="r">${it.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td class="r">${it.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>`
      : `<td class="r">${it.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>`}
    <td class="r"><strong>${it.lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
  </tr>`).join('')}
  </tbody>
</table>

<div class="bottom">
  <div class="words-col">
    <div class="lbl">Total In Words</div>
    <div class="val">${numWords(grand)}</div>
    ${totalPaid > 0 && totalPaid < grand - 0.01 ? `<div class="partial-note">Partial payment of ₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })} received. Balance: ₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>` : ''}
    <div class="gst-detail">
      ${isIntrastate
        ? `<span class="gst-chip gst-cgst">CGST: ₹${totalCGST.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span><span class="gst-chip gst-sgst">SGST: ₹${totalSGST.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>`
        : `<span class="gst-chip gst-igst">IGST: ₹${totalIGST.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>`}
    </div>
  </div>
  <div class="tots-col">
    <table>
      <tr><td>Subtotal (Taxable)</td><td class="r">${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
      ${discTotal > 0 ? `<tr><td>Item Discounts</td><td class="r" style="color:#b00">-${discTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>` : ''}
      ${Object.entries(gstGroups).sort(([a], [b]) => Number(a) - Number(b)).map(([r, g]) =>
        isIntrastate
          ? `<tr><td>CGST @ ${Number(r) / 2}%</td><td class="r">${g.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
             <tr><td>SGST @ ${Number(r) / 2}%</td><td class="r">${g.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`
          : `<tr><td>IGST @ ${r}%</td><td class="r">${g.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`
      ).join('')}
      ${invLevelDisc > 0 ? `<tr><td>Discount${invLevelDiscPct > 0 ? ` (${invLevelDiscPct.toFixed(2)}%)` : ''}</td><td class="r" style="color:#b00">-${invLevelDisc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>` : ''}
      <tr class="grand-row"><td><strong>Total</strong></td><td class="r"><strong>₹${grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td></tr>
      ${totalPaid > 0 ? `<tr><td>Paid</td><td class="r">-₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>` : ''}
      <tr class="bal-row"><td>Balance Due</td><td class="r">₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
    </table>
  </div>
</div>

<div class="footer">
  <div class="fc">
    <h4>Bank Details</h4>
    ${biz.bank_account ? `<div class="bd-row"><span>Ac No.</span><span>${biz.bank_account}</span></div>` : ''}
    ${biz.ifsc_code ? `<div class="bd-row"><span>IFSC</span><span>${biz.ifsc_code}</span></div>` : ''}
    ${biz.bank_name ? `<div class="bd-row"><span>Bank</span><span>${biz.bank_name}</span></div>` : ''}
    ${biz.upi_id ? `<div class="bd-row"><span>UPI ID</span><span>${biz.upi_id}</span></div>` : ''}
    ${!biz.bank_account && !biz.upi_id ? `<p style="color:#bbb;font-size:9.5px">Add bank details in ⚙ Business Settings</p>` : ''}
  </div>
  <div class="fc qr-wrap">
    <h4>Scan to Pay (UPI)</h4>
    ${qrUrl ? `<img src="${qrUrl}" style="width:95px;height:95px;margin-top:3px"><div class="bd-row" style="justify-content:center;margin-top:3px;font-size:9px;color:#666">${biz.upi_id}</div>` : `<p style="color:#bbb;font-size:9.5px;margin-top:4px">Add UPI ID in Business Settings</p>`}
  </div>
</div>
<div class="note">This is a computer-generated document and does not require a physical signature.${isCN ? ' This credit note reduces the amount due on the linked invoice.' : ''}</div>
</div></body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const burl = URL.createObjectURL(blob);
  const docNum = invoice.invoice_number || invoice.cn_number || 'doc';
  // File name = "<Brand>-<InvoiceNumber>.html" instead of just the invoice
  // number, so downloads are identifiable once they're out of the app (e.g.
  // sitting in a Downloads folder or emailed to someone). Strip characters
  // that are invalid in file names on Windows/Mac/Linux.
  const safeBizName = (biz.name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  const fileName = safeBizName ? `${safeBizName}-${docNum}` : docNum;

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:sans-serif;backdrop-filter:blur(3px)';
  const bx = document.createElement('div');
  bx.style.cssText = 'background:#1a1a1a;border:1px solid #333;border-radius:14px;padding:28px 32px;text-align:center;color:#e8e6df;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.6)';
  bx.innerHTML = `<div style="font-size:24px;margin-bottom:8px">${isCN ? '🔄' : '📄'}</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:3px">${docNum}</div>
    <div style="font-size:12px;color:#888;margin-bottom:20px">${docTitle} · ₹${grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <a href="${burl}" download="${fileName}.html" style="display:block;padding:10px 20px;background:#c8f064;color:#0d0d0d;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">⬇ Download HTML → Print to PDF</a>
      <button id="pp" style="padding:10px 20px;background:transparent;color:#5ca0ff;border:1px solid #1a3a55;border-radius:8px;cursor:pointer;font-size:13px;width:100%">🖨 Print directly</button>
      <button id="pc" style="padding:7px;background:transparent;color:#555;border:none;cursor:pointer;font-size:12px">Close</button>
    </div>`;
  ov.appendChild(bx); document.body.appendChild(ov);
  bx.querySelector('#pc').onclick = () => { document.body.removeChild(ov); URL.revokeObjectURL(burl); };
  bx.querySelector('#pp').onclick = () => {
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;height:700px;border:none';
    ifr.src = burl; document.body.appendChild(ifr);
    ifr.onload = () => { setTimeout(() => ifr.contentWindow.print(), 600); setTimeout(() => { document.body.removeChild(ifr); URL.revokeObjectURL(burl); }, 5000); };
    document.body.removeChild(ov);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// printChallan — generates and downloads a Delivery Challan PDF
// ─────────────────────────────────────────────────────────────────────────────
export function printChallan(challan, items, party, biz, linkedInv = null) {
  const calc = items.map(it => {
    const base = Number(it.quantity) * Number(it.unit_price);
    const discAmt = base * (Number(it.discount_percent || 0) / 100);
    const taxable = base - discAmt;
    const cgst = Number(it.cgst_amount || 0);
    const sgst = Number(it.sgst_amount || 0);
    const igst = Number(it.igst_amount || 0);
    return { ...it, base, discAmt, taxable, cgst, sgst, igst, lineTotal: taxable + cgst + sgst + igst };
  });

  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const grand = subtotal + totalCGST + totalSGST + totalIGST;
  const isIntrastate = totalCGST > 0;

  const r = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fd = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const statusBadge = {
    draft: { bg: '#f3f4f6', color: '#374151', label: 'DRAFT' },
    dispatched: { bg: '#dbeafe', color: '#1d4ed8', label: 'DISPATCHED' },
    delivered: { bg: '#d1fae5', color: '#065f46', label: 'DELIVERED' },
    cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'CANCELLED' },
  }[challan.status] || { bg: '#f3f4f6', color: '#374151', label: (challan.status || '').toUpperCase() };

  const gstGroups = {};
  calc.forEach(it => {
    const rate = Number(it.tax_percent || 0);
    if (rate > 0) {
      if (!gstGroups[rate]) gstGroups[rate] = { cgst: 0, sgst: 0, igst: 0 };
      gstGroups[rate].cgst += it.cgst;
      gstGroups[rate].sgst += it.sgst;
      gstGroups[rate].igst += it.igst;
    }
  });

  const gstRows = Object.entries(gstGroups).map(([rate, g]) =>
    isIntrastate
      ? `<tr><td>GST @ ${rate}%</td><td class="r">CGST @ ${rate / 2}%</td><td class="r">${r(g.cgst)}</td></tr>
         <tr><td></td><td class="r">SGST @ ${rate / 2}%</td><td class="r">${r(g.sgst)}</td></tr>`
      : `<tr><td>GST @ ${rate}%</td><td class="r">IGST @ ${rate}%</td><td class="r">${r(g.igst)}</td></tr>`
  ).join('');

  const itemRows = calc.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${it.description || ''}${it.hsn_code ? `<br><span class="dim">HSN: ${it.hsn_code}</span>` : ''}</td>
      <td class="c">${it.unit || 'Nos'}</td>
      <td class="r">${Number(it.quantity).toLocaleString('en-IN')}</td>
      <td class="r">${r(it.unit_price)}</td>
      ${it.discAmt > 0 ? `<td class="r">${Number(it.discount_percent || 0).toFixed(1)}%</td>` : '<td class="r">—</td>'}
      <td class="r">${r(it.taxable)}</td>
      <td class="c">${it.tax_percent || 0}%</td>
      <td class="r">${r(it.lineTotal)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${challan.challan_number}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:20px}
.page{max-width:820px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2.5px solid #111;margin-bottom:12px}
.biz-name{font-size:22px;font-weight:800;margin-bottom:4px}
.biz-info{font-size:10px;color:#444;line-height:1.65}
.doc-right{text-align:right}
.doc-right h1{font-size:26px;font-weight:800;letter-spacing:1.5px;color:#111}
.doc-right .dc-num{font-size:13px;font-weight:700;margin-top:4px;color:#444}
.status-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-top:6px;background:${statusBadge.bg};color:${statusBadge.color}}
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #ccc;margin-bottom:10px}
.mc{padding:5px 9px;font-size:10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.mc:nth-child(3n){border-right:none}.mc:nth-last-child(-n+3){border-bottom:none}
.mc .lbl{color:#888;margin-bottom:1px;font-size:9px;text-transform:uppercase;letter-spacing:.04em}.mc .val{font-weight:700}
.party{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ccc;margin-bottom:10px}
.pc{padding:8px 10px;font-size:10px}.pc:first-child{border-right:1px solid #ccc}
.pc h4{font-weight:700;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #e0e0e0;font-size:9.5px;color:#555;text-transform:uppercase;letter-spacing:.05em}
.pc p{line-height:1.65}
.transport-box{border:1px solid #ccc;margin-bottom:10px;padding:8px 10px}
.transport-box h4{font-weight:700;font-size:9.5px;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #e0e0e0}
.transport-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px}
.tf .lbl{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.04em}
.tf .val{font-weight:600;font-size:10.5px}
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:0}
thead th{background:#111;color:#fff;padding:6px 8px;text-align:left;font-weight:600;font-size:9.5px;letter-spacing:.04em}
thead th.r{text-align:right}thead th.c{text-align:center}
tbody td{padding:4.5px 8px;border-bottom:1px solid #eee;vertical-align:top}
tbody td.r{text-align:right}tbody td.c{text-align:center}
tbody tr:nth-child(even) td{background:#fafafa}
.dim{color:#999;font-size:9px}
.totals-wrap{display:flex;border:1px solid #ccc;border-top:none}
.notes-col{flex:1;padding:9px;border-right:1px solid #ccc;font-size:10px}
.notes-col .lbl{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.amounts-col{min-width:220px;padding:0}
.amounts-col table{font-size:10px}
.amounts-col td{padding:3.5px 9px;border-bottom:1px solid #eee}
.amounts-col .grand td{font-weight:800;font-size:11.5px;background:#111;color:#fff}
.sig-row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ccc;border-top:none;margin-top:0}
.sig-box{padding:8px 10px;font-size:10px}
.sig-box:first-child{border-right:1px solid #ccc}
.sig-box .sig-lbl{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:24px}
.sig-box .sig-line{border-top:1px solid #aaa;width:140px;padding-top:3px;font-size:9px;color:#888}
.linked-inv{font-size:9.5px;color:#555;margin-top:6px;padding:3px 8px;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;display:inline-block}
@media print{body{padding:0}button,a{display:none!important}}
</style></head><body><div class="page">

<!-- Header -->
<div class="header">
  <div>
    ${biz.logo_url ? `<img src="${biz.logo_url}" style="height:48px;margin-bottom:6px;display:block">` : ''}
    <div class="biz-name">${biz.name || ''}</div>
    <div class="biz-info">
      ${biz.address ? `${biz.address}<br>` : ''}
      ${biz.gstin ? `GSTIN: <strong>${biz.gstin}</strong>` : ''}
      ${biz.phone ? ` &nbsp;|&nbsp; Ph: ${biz.phone}` : ''}
      ${biz.email ? `<br>${biz.email}` : ''}
    </div>
  </div>
  <div class="doc-right">
    <h1>DELIVERY CHALLAN</h1>
    <div class="dc-num">${challan.challan_number}</div>
    <div><span class="status-badge">${statusBadge.label}</span></div>
    ${linkedInv ? `<div class="linked-inv">Against Invoice: ${linkedInv.invoice_number}</div>` : ''}
  </div>
</div>

<!-- Meta -->
<div class="meta-grid">
  <div class="mc"><div class="lbl">Challan No.</div><div class="val">${challan.challan_number}</div></div>
  <div class="mc"><div class="lbl">Date</div><div class="val">${fd(challan.challan_date)}</div></div>
  <div class="mc"><div class="lbl">Purpose</div><div class="val">${challan.purpose || '—'}</div></div>
</div>

<!-- Party -->
<div class="party">
  <div class="pc">
    <h4>Consignor (From)</h4>
    <p>
      <strong>${biz.name || ''}</strong><br>
      ${biz.address ? biz.address + '<br>' : ''}
      ${biz.gstin ? `GSTIN: ${biz.gstin}` : ''}
    </p>
  </div>
  <div class="pc">
    <h4>Consignee (To)</h4>
    <p>
      <strong>${party.name || '—'}</strong><br>
      ${party.address ? party.address + '<br>' : ''}
      ${party.gstin ? `GSTIN: ${party.gstin}` : ''}
      ${party.phone ? `<br>Ph: ${party.phone}` : ''}
    </p>
  </div>
</div>

<!-- Transport -->
<div class="transport-box">
  <h4>Transport Details</h4>
  <div class="transport-grid">
    <div class="tf"><div class="lbl">Mode</div><div class="val">${challan.transport_mode || '—'}</div></div>
    <div class="tf"><div class="lbl">Vehicle No.</div><div class="val">${challan.vehicle_number || '—'}</div></div>
    <div class="tf"><div class="lbl">LR / GR No.</div><div class="val">${challan.lr_number || '—'}</div></div>
    <div class="tf"><div class="lbl">Driver Name</div><div class="val">${challan.driver_name || '—'}</div></div>
    <div class="tf"><div class="lbl">Dispatched From</div><div class="val">${challan.dispatch_from || '—'}</div></div>
    <div class="tf"><div class="lbl">Dispatch To</div><div class="val">${challan.dispatch_to || '—'}</div></div>
  </div>
</div>

<!-- Items Table -->
<table>
  <thead>
    <tr>
      <th class="c" style="width:4%">#</th>
      <th style="width:30%">Description / HSN</th>
      <th class="c" style="width:7%">Unit</th>
      <th class="r" style="width:7%">Qty</th>
      <th class="r" style="width:10%">Rate</th>
      <th class="r" style="width:7%">Disc%</th>
      <th class="r" style="width:12%">Taxable</th>
      <th class="c" style="width:7%">GST%</th>
      <th class="r" style="width:12%">Amount</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<!-- Totals + Notes -->
<div class="totals-wrap">
  <div class="notes-col">
    ${challan.notes ? `<div class="lbl">Notes / Remarks</div><div>${challan.notes}</div>` : '<div class="lbl">Notes / Remarks</div><div style="color:#ccc">—</div>'}
  </div>
  <div class="amounts-col">
    <table>
      <tbody>
        <tr><td>Taxable Value</td><td class="r">${r(subtotal)}</td></tr>
        ${gstRows}
        <tr class="grand"><td>Total Value</td><td class="r">${r(grand)}</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Signatures -->
<div class="sig-row">
  <div class="sig-box">
    <div class="sig-lbl">Prepared By</div>
    <div class="sig-line">Signature &amp; Name</div>
  </div>
  <div class="sig-box" style="text-align:right">
    <div class="sig-lbl">For ${biz.name || ''}</div>
    <div class="sig-line" style="margin-left:auto">Authorised Signatory</div>
  </div>
</div>

<p style="text-align:center;font-size:9px;color:#bbb;margin-top:12px">
  This is a computer-generated delivery challan — no signature required if sent electronically.
</p>

</div></body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const burl = URL.createObjectURL(blob);
  const docNum = challan.challan_number || 'DC';

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999';
  const bx = document.createElement('div');
  bx.style.cssText = 'background:#1a1a1a;border:1px solid #333;border-radius:14px;padding:28px 32px;text-align:center;color:#e8e6df;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.6)';
  bx.innerHTML = `<div style="font-size:24px;margin-bottom:8px">🚚</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:3px">${docNum}</div>
    <div style="font-size:12px;color:#888;margin-bottom:20px">Delivery Challan · ₹${grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <a href="${burl}" download="${docNum}.html" style="display:block;padding:10px 20px;background:#c8f064;color:#0d0d0d;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">⬇ Download HTML → Print to PDF</a>
      <button id="pp" style="padding:10px 20px;background:transparent;color:#5ca0ff;border:1px solid #1a3a55;border-radius:8px;cursor:pointer;font-size:13px;width:100%">🖨 Print directly</button>
      <button id="pc" style="padding:7px;background:transparent;color:#555;border:none;cursor:pointer;font-size:12px">Close</button>
    </div>`;
  ov.appendChild(bx); document.body.appendChild(ov);
  bx.querySelector('#pc').onclick = () => { document.body.removeChild(ov); URL.revokeObjectURL(burl); };
  bx.querySelector('#pp').onclick = () => {
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;height:700px;border:none';
    ifr.src = burl; document.body.appendChild(ifr);
    ifr.onload = () => { setTimeout(() => ifr.contentWindow.print(), 600); setTimeout(() => { document.body.removeChild(ifr); URL.revokeObjectURL(burl); }, 5000); };
    document.body.removeChild(ov);
  };
}
