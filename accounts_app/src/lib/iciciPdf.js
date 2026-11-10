// iciciPdf.js — reader for the two ICICI Bank PDF statement layouts:
//
//   A) Internet-banking "Detailed Statement":
//        Sr No | Tran ID | Value Date | Transaction Date | Cheque no/RefNo | Transaction Remarks | Withdrawl (Dr) | Deposit (Cr) | Balance
//        dates like 21-Jun-2025, "NA" in the unused amount column, remarks wrapped over several short lines
//   B) "Transactions List" (Value Date / Txn Posted Date … Cr/Dr / Transaction Amount / Available Balance)
//        dates like 01/10/2026, Indian digit grouping (3,91,370.46), description wrapped, cells vertically centred
//
// Works on pdf.js text items (string + x / y position), so it does not depend on how pdf.js orders the text.
// Every row is checked against the running balance, so a missed or misread row shows up as a warning.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const NUM = /^\d[\d,]*\.\d{2}$/;
const num = s => parseFloat(String(s).replace(/,/g, ''));
const pad = n => String(n).padStart(2, '0');

const dateA = s => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s); return m && MONTHS[m[2].toLowerCase()] ? `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}` : null; };
const dateB = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// pdf.js document -> [[{ str, x, y, w }]] one array per page
export async function pagesFromPdfjs(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.filter(it => String(it.str).trim()).map(it => ({ str: String(it.str).trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0 })));
  }
  return pages;
}

function findHeader(items) {
  const get = re => items.find(i => re.test(i.str));
  const withdraw = get(/^Withdraw/i), deposit = get(/^Deposit/i), remarks = get(/^Remarks$/i), crdr = get(/^Cr\/Dr$/i), desc = get(/^Description$/i);
  if (withdraw && deposit && remarks) {
    const left = re => items.filter(i => re.test(i.str)).sort((a, b) => a.x - b.x)[0];
    return { fmt: 'A', xSr: left(/^Sr$/).x, xTran: left(/^Tran$/).x, xValue: left(/^Value$/).x, xTxn: left(/^Transaction$/).x,
      xCheque: left(/^Cheque$/).x, xW: withdraw.x };
  }
  if (crdr && desc) {
    const byX = re => items.filter(i => re.test(i.str)).sort((a, b) => a.x - b.x);
    return { fmt: 'B', xSr: byX(/^No\.$/)[0].x, xTran: byX(/^Transactio/)[0].x, xValue: byX(/^Value Date$/)[0].x, xPosted: byX(/^Txn Posted Date$/)[0].x,
      xCheque: byX(/^Cheque/)[0].x, xDesc: desc.x, xCrDr: crdr.x };
  }
  return null;
}

// lines of items that share (roughly) the same y, top to bottom, each left to right
function toLines(items, tol = 2.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
  return lines;
}

const lineW = ln => ln.items.reduce((s, x) => s + x.w, 0);
const percentile = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };

// Join wrapped description lines. A line that fills the whole column width was broken mid-word -> no space.
function joinLines(lines, maxW, ratio) {
  let out = '';
  lines.forEach((ln, i) => {
    const text = ln.items.map(x => x.str).join(' ');
    if (i === 0) { out = text; return; }
    const prev = lines[i - 1];
    const midWord = maxW > 0 && lineW(prev) >= maxW * ratio;
    out += (midWord || /[@\/-]$/.test(out) || /^[\/-]/.test(text) ? '' : ' ') + text;
  });
  return out.replace(/\s+/g, ' ').trim();
}

function parseA(pages, g) {
  const srMax = (g.xSr + g.xTran) / 2, valueMin = (g.xTran + g.xValue) / 2, txnMin = (g.xValue + g.xTxn) / 2;
  const remMin = (g.xTxn + g.xCheque) / 2, amtMin = g.xW - 12;
  const rows = []; let ignored = 0; const samples = [];
  for (const items of pages) {
    let cur = rows.length ? rows[rows.length - 1] : null, first = true;
    for (const ln of toLines(items)) {
      const sr = ln.items.find(i => /^\d+$/.test(i.str) && i.x < srMax);
      const tran = ln.items.find(i => i.x >= srMax && i.x < valueMin);
      if (sr && tran) {
        const dates = ln.items.filter(i => i.x >= valueMin && i.x < remMin && dateA(i.str));
        const tail = ln.items.filter(i => i.x >= amtMin);
        const rem = ln.items.filter(i => i.x >= remMin && i.x < amtMin);
        if (dates.length < 1 || tail.length !== 3) { ignored++; cur = null; first = false; continue; }
        const [w, d, bal] = tail.map(t => t.str);
        const isDr = w !== 'NA' && NUM.test(w), isCr = d !== 'NA' && NUM.test(d);
        if (isDr === isCr || !NUM.test(bal)) { ignored++; cur = null; first = false; continue; }
        cur = {
          sr: Number(sr.str), date: dateA(dates[dates.length - 1].str) || dateA(dates[0].str), reference: tran.str,
          type: isCr ? 'credit' : 'debit', amount: num(isCr ? d : w), balance: num(bal), lines: [{ items: rem }],
        };
        rows.push(cur);
      } else if (cur) {
        // wrapped remarks; other cells (e.g. the year of a wrapped date) can share the line and are skipped
        const rem = ln.items.filter(i => i.x >= remMin && i.x < amtMin);
        const stray = ln.items.filter(i => (i.x < remMin ? !/^\d{4}$/.test(i.str) : i.x >= amtMin));
        if (rem.length) cur.lines.push({ items: rem });
        if (stray.length) { ignored++; samples.push(stray.map(i => i.str).join(' ')); }
      } else if (!first) ignored++;
      first = false;
    }
  }
  const maxW = percentile(rows.flatMap(r => r.lines.map(lineW)), 0.97);   // a full-width line was wrapped mid-word
  return { rows: rows.map(r => ({ ...r, description: joinLines(r.lines.filter(l => l.items.length), maxW, 0.93) })), ignored, samples };
}

function parseB(pages, g) {
  const srMax = (g.xSr + g.xTran) / 2, valueMin = (g.xTran + g.xValue) / 2, postedMin = (g.xValue + g.xPosted) / 2;
  const chequeMin = (g.xPosted + g.xCheque) / 2, descMin = g.xCheque + (g.xDesc - g.xCheque) * 0.35, crdrMin = g.xCrDr - 10;
  const rows = []; let ignored = 0;
  for (const items of pages) {
    // split the page into row blocks wherever there is a clear vertical gap
    const ys = [...new Set(items.map(i => Math.round(i.y)))].sort((a, b) => b - a);
    const blocks = []; let cur = null;
    for (const y of ys) {
      if (!cur || cur.min - y > 30) { cur = { max: y, min: y, items: [] }; blocks.push(cur); }
      cur.min = y;
    }
    for (const it of items) { const b = blocks.find(b => it.y <= b.max + 0.5 && it.y >= b.min - 0.5); if (b) b.items.push(it); }
    for (const b of blocks) {
      const anchors = b.items.filter(i => /^\d+$/.test(i.str) && i.x < srMax);
      if (!anchors.length) { if (b.items.some(i => i.x >= descMin)) ignored++; continue; }
      // normally one anchor per block; if two rows are packed tightly, hand each text to the nearest anchor
      const groups = anchors.length === 1 ? [{ a: anchors[0], items: b.items }]
        : anchors.map(a => ({ a, items: [] }));
      if (anchors.length > 1) for (const it of b.items) {
        groups.reduce((best, grp) => (Math.abs(grp.a.y - it.y) < Math.abs(best.a.y - it.y) ? grp : best)).items.push(it);
      }
      for (const { a, items: its } of groups) {
        const tran = its.find(i => i.x >= srMax && i.x < valueMin);
        const value = its.find(i => i.x >= valueMin && i.x < postedMin && dateB(i.str));
        const crdr = its.find(i => /^(CR|DR)$/i.test(i.str) && i.x >= crdrMin - 5);
        const nums = its.filter(i => i.x >= crdrMin && NUM.test(i.str)).sort((p, q) => p.x - q.x);
        if (!tran || !value || !crdr || nums.length < 2) { ignored++; continue; }
        const descLines = toLines(its.filter(i => i.x >= descMin && i.x < crdrMin - 5), 3);
        rows.push({
          sr: Number(a.str), date: dateB(value.str), reference: tran.str,
          type: /^CR$/i.test(crdr.str) ? 'credit' : 'debit', amount: num(nums[0].str), balance: num(nums[1].str),
          cheque: its.filter(i => i.x >= chequeMin && i.x < descMin && i.str !== '-').map(i => i.str).join(' '),
          lines: descLines,
        });
      }
    }
  }
  const maxW = percentile(rows.flatMap(r => r.lines.map(lineW)), 0.97);
  rows.forEach(r => { r.description = joinLines(r.lines, maxW, 0.95); });
  return { rows, ignored };
}

// Parse the pages and verify against the running balance.
export function parseIciciPages(pages) {
  let header = null;
  for (const items of pages) { header = findHeader(items); if (header) break; }
  if (!header) throw new Error('This PDF is not a recognised ICICI statement layout (looked for the "Withdrawl / Deposit / Balance" or "Cr/Dr / Description" column headings).');
  const { rows, ignored, samples = [] } = header.fmt === 'A' ? parseA(pages, header) : parseB(pages, header);
  if (!rows.length) throw new Error('Recognised an ICICI statement but found no transaction rows.');

  // running-balance check (statements may be oldest-first or newest-first)
  const check = (list, dir) => {
    const bad = [];
    for (let i = 1; i < list.length; i++) {
      const cur = list[i], prev = list[i - 1];
      const base = dir === 'fwd' ? prev.balance : cur.balance;
      const mover = dir === 'fwd' ? cur : prev;
      const expect = Math.round((base + (mover.type === 'credit' ? mover.amount : -mover.amount)) * 100) / 100;
      const actual = dir === 'fwd' ? cur.balance : prev.balance;
      if (Math.abs(expect - actual) > 0.011) bad.push(dir === 'fwd' ? cur.sr : prev.sr);
    }
    return bad;
  };
  const fwd = check(rows, 'fwd'), rev = check(rows, 'rev');
  const mismatches = fwd.length <= rev.length ? fwd : rev;
  const meta = {
    format: header.fmt === 'A' ? 'ICICI internet-banking Detailed Statement' : 'ICICI Transactions List',
    count: rows.length,
    from: rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date),
    to: rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date),
    totalDebit: Math.round(rows.filter(r => r.type === 'debit').reduce((s, r) => s + r.amount, 0) * 100) / 100,
    totalCredit: Math.round(rows.filter(r => r.type === 'credit').reduce((s, r) => s + r.amount, 0) * 100) / 100,
    balanceMismatches: mismatches,
    ignoredBlocks: ignored,
    ignoredSamples: samples.slice(0, 6),
    missingSerials: (() => { const s = new Set(rows.map(r => r.sr)); const miss = []; const lo = Math.min(...s), hi = Math.max(...s); for (let n = lo; n <= hi && miss.length < 20; n++) if (!s.has(n)) miss.push(n); return miss; })(),
  };
  const txns = rows.map(r => ({ date: r.date, description: r.description, reference: r.reference, type: r.type, amount: r.amount, balance: r.balance }));
  return { txns, meta };
}
