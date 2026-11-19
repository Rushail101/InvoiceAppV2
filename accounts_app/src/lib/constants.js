// ─── STYLES ───────────────────────────────────────────────────────────────────
export const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`;

export const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0d0d;--bg2:#161616;--bg3:#1e1e1e;--bg4:#252525;
  --border:#2a2a2a;--border2:#333;--border3:#3d3d3d;
  --text:#e8e6df;--text2:#a3a3a3;--text3:#808080;--text4:#5c5c5c;
  /* aliases used by a few screens that were never defined */
  --text1:var(--text);--border1:var(--border);--bg1:var(--bg);
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
.nav-label{font-size:9.5px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;font-family:var(--mono);padding:10px 10px 4px;margin-top:4px;display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;text-align:left}
.nav-label:hover{color:var(--text2)}
.nav-label .chev{font-size:9px;transition:transform .15s}
.nav-label.collapsed .chev{transform:rotate(-90deg)}
.nav-search{margin:4px 6px 2px;position:relative}
.nav-search input{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--r);padding:6px 8px 6px 26px;font-family:var(--font);font-size:12px;outline:none}
.nav-search input:focus{border-color:var(--accent)}
.nav-search .ico{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text3);pointer-events:none}
.nav-search kbd{position:absolute;right:7px;top:50%;transform:translateY(-50%)}
kbd{font-family:var(--mono);font-size:9.5px;color:var(--text3);border:1px solid var(--border2);border-radius:4px;padding:0 4px;background:var(--bg2)}
.nav-count{margin-left:auto;font-family:var(--mono);font-size:10px;padding:0 6px;border-radius:10px;background:#3a1a1a;color:var(--red)}
.nav-item.active .nav-count{background:#0d0d0d;color:var(--accent)}
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
th{text-align:left;padding:9px 12px;font-size:10px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;font-family:var(--mono);border-bottom:1px solid var(--border);font-weight:500;white-space:nowrap}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
td{padding:9px 12px;font-size:12.5px;border-bottom:1px solid var(--border);vertical-align:middle}
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
.badge-manual{background:var(--bg3);color:var(--text2);border:1px solid var(--border2)}
.badge-bank_import{background:#081828;color:var(--blue);border:1px solid #143050}
.badge-reversal{background:#100a28;color:var(--purple);border:1px solid #201848}
.badge-payment{background:#0a2016;color:var(--green);border:1px solid #1a4028}

/* ── Account picker (searchable) ── */
.acct-picker-menu{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--bg3);border:1px solid var(--border3);border-radius:var(--r);box-shadow:var(--shadow2);max-height:220px;overflow-y:auto;z-index:50}
.acct-picker-grp{font-size:9px;color:var(--text4);font-family:var(--mono);text-transform:uppercase;letter-spacing:.07em;padding:6px 9px 3px}
.acct-picker-item{padding:6px 9px;font-size:12px;cursor:pointer;color:var(--text2)}
.acct-picker-item.hl{background:var(--bg4);color:var(--text)}
.acct-picker-item.sel{color:var(--accent)}
.acct-picker-empty{padding:10px 9px;font-size:11.5px;color:var(--text3)}

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

/* ── Focus + layout utilities ── */
.btn:focus-visible,.nav-item:focus-visible,.pill-tab:focus-visible,.nav-label:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.page-head h3{font-size:15px;font-weight:700}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.metric{display:flex;flex-direction:column;gap:6px}
.metric span{font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;font-family:var(--mono)}
.metric strong{font-size:22px;font-weight:700;letter-spacing:-.4px}
.stat-card.clickable{cursor:pointer;transition:border-color .12s,transform .12s}
.stat-card.clickable:hover{border-color:var(--border3);transform:translateY(-1px)}
tr.clickable{cursor:pointer}
.chip-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chip{padding:4px 10px;border-radius:20px;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:11.5px;cursor:pointer;font-family:var(--font)}
.chip:hover{color:var(--text);border-color:var(--border3)}
.chip.active{background:var(--accent);border-color:var(--accent);color:#0d0d0d;font-weight:600}
.sum-strip{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--text3);font-family:var(--mono);margin:-4px 0 12px}
.sum-strip b{color:var(--text);font-weight:600}
.hint{font-size:11px;color:var(--text3)}
.row-actions{display:flex;gap:3px;flex-wrap:wrap}

/* ── Toasts ── */
.toast-stack{position:fixed;right:18px;bottom:18px;z-index:400;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 36px))}
.toast{background:var(--bg3);border:1px solid var(--border3);border-left:3px solid var(--blue);color:var(--text);border-radius:var(--r);padding:10px 12px;font-size:12.5px;box-shadow:var(--shadow2);display:flex;gap:10px;align-items:flex-start;animation:toast-in .18s ease-out;white-space:pre-line}
.toast.success{border-left-color:var(--green)}.toast.error{border-left-color:var(--red)}.toast.warn{border-left-color:var(--amber)}
.toast button{margin-left:auto;background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px}
@keyframes toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ── Mobile nav (hidden on desktop) ── */
.hamburger-btn{display:none;background:none;border:1px solid var(--border2);color:var(--text);border-radius:var(--r);width:32px;height:32px;font-size:16px;cursor:pointer;flex-shrink:0;align-items:center;justify-content:center}
.nav-overlay{display:none}

/* ── Responsive breakpoints ── */
@media (max-width:900px){
  .app{position:relative;overflow-x:hidden}
  .hamburger-btn{display:flex}
  .sidebar{position:fixed;left:-280px;top:0;height:100vh;width:260px;z-index:210;transition:left .22s ease;box-shadow:var(--shadow2)}
  .sidebar.open{left:0}
  .nav-overlay{display:block;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200}
  .main{width:100%}
  .topbar{padding:12px 14px}
  .topbar h2{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .content{padding:14px}
  .stats-grid{grid-template-columns:repeat(2,1fr) !important;gap:8px}
  .two-col,.three-col,.grid-2{grid-template-columns:1fr !important;gap:12px}
  .grid-4{grid-template-columns:repeat(2,1fr) !important}
  .form-row.cols-2,.form-row.cols-3,.form-row.cols-4{grid-template-columns:1fr !important}
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{min-width:640px}
  .modal-overlay{padding:0;align-items:flex-end}
  .modal{max-width:100%;width:100%;max-height:94vh;border-radius:var(--r3) var(--r3) 0 0}
  .modal-lg,.modal-xl{max-width:100%}
  .modal-head{padding:14px 16px}
  .modal-body{padding:14px 16px;overflow-x:auto}
  .modal-foot{padding:12px 16px;flex-wrap:wrap}
  .filter-bar{gap:6px}
  .filter-bar input{min-width:120px}
  .line-items-head{min-width:600px}
  .line-item-row{min-width:600px}
  .config-screen{padding:24px 18px}
}
@media (max-width:480px){
  .stats-grid{grid-template-columns:repeat(2,1fr) !important}
  .stat-card{padding:10px 12px}
  .stat-val{font-size:16px}
  .stat-sub{font-size:9.5px}
  .toast-stack{left:12px;right:12px;bottom:12px;max-width:none}
  .topbar-right .btn span{display:none}
}
`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
// Dates are handled as local calendar dates (YYYY-MM-DD). toISOString() would
// convert to UTC first, which in India (UTC+5:30) gives YESTERDAY's date for
// anything done between midnight and 5:30 am, and shifts month-end dates back
// a day. Always go through these helpers instead.
const pad2 = n => String(n).padStart(2, '0');
export const localISO = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => localISO(new Date());
export const thisMonthKey = () => today().slice(0, 7);
// Last calendar day of a "YYYY-MM" period, as "YYYY-MM-DD".
export const monthEnd = (period) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${pad2(new Date(y, m, 0).getDate())}`;
};
const fyFromYM = (y, m) => { const sy = m >= 4 ? y : y - 1; return `${String(sy).slice(-2)}-${String(sy + 1).slice(-2)}`; };
export const getFY = () => { const d = new Date(); return fyFromYM(d.getFullYear(), d.getMonth() + 1); };
// Same as getFY() but for a "YYYY-MM-DD" date — Indian FY runs April→March.
// Parsed from the string itself so the time zone can never move it across a month.
export const getFYForDate = (dateStr) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return getFY();
  return fyFromYM(Number(m[1]), Number(m[2]));
};
// FY string ("26-27") -> { start: '2026-04-01', end: '2027-03-31' }
export const fyRange = (fy) => {
  const sy = 2000 + parseInt(fy.split('-')[0], 10);
  return { start: `${sy}-04-01`, end: `${sy + 1}-03-31` };
};
// Recent FYs, newest first, for dropdowns.
export const recentFYs = (count = 4) => {
  const sy = 2000 + parseInt(getFY().split('-')[0], 10);
  return Array.from({ length: count }, (_, i) => `${String(sy - i).slice(-2)}-${String(sy - i + 1).slice(-2)}`);
};

// What is still owed on an invoice: total − payments − TDS the customer
// deducted − credit notes issued against it (cancelled notes ignored).
export function invoiceDue(inv, payments = [], creditNotes = []) {
  if (!inv) return 0;
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const cn = creditNotes.filter(c => c.status !== 'cancelled').reduce((s, c) => s + Number(c.total || 0), 0);
  return Number(inv.total || 0) - paid - Number(inv.tds_amount || 0) - cn;
}
export function isOverdue(inv, due) {
  return !!inv?.due_date && inv.due_date < today() && due > 0.01
    && !['paid', 'cancelled', 'proforma', 'draft'].includes(inv.status);
}

// Next number in a business's sales series for the FY of `dateStr` (default today).
// Only SALE documents count — purchase bills carry the supplier's own numbers and
// must never push the sales sequence forward or collide with it.
export function nextInvNum(invoices, isProforma, dateStr) {
  const fy = dateStr ? getFYForDate(dateStr) : getFY();
  const sales = invoices.filter(i => i.type !== 'purchase');
  if (isProforma) {
    // Same rule as accounts_erp.next_proforma_number() in the database, which the
    // operations app and the Telegram bot use — so both apps give the same numbers:
    //   style  = your main series ("PI/26-27/…" or "PI-26-27/…"): highest number, newest year
    //   number = highest proforma number this financial year + 1, never below 1001.
    //   Converted invoices keep their old proforma number, so it's never reused.
    const PI_RE = /^(PI[^0-9]*?)(\d{2}-\d{2})([/-])(\d+)$/;
    let style = null, top = 0;
    sales.forEach(i => [i.invoice_number, i.proforma_number].forEach(num => {
      const m = String(num || '').trim().toUpperCase().match(PI_RE);
      if (!m) return;
      const n = parseInt(m[4], 10);
      if (!style || m[2] > style.fy || (m[2] === style.fy && n > style.n)) style = { pre: m[1], fy: m[2], sep: m[3], n };
      if (m[2] === fy) top = Math.max(top, n);
    }));
    return `${style ? style.pre : 'PI-'}${fy}${style ? style.sep : '/'}${Math.max(top, 1000) + 1}`;
  }
  const pat = new RegExp(`^${fy}/(\\d+)$`);
  let max = 1000; sales.forEach(i => { const m = (i.invoice_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `${fy}/${max + 1}`;
}

export function nextCNNum(creditNotes) {
  const fy = getFY();
  const pat = new RegExp(`^CN-${fy}/(\\d+)$`);
  let max = 0; creditNotes.forEach(c => { const m = (c.cn_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `CN-${fy}/${String(max + 1).padStart(3, '0')}`;
}


// HSN helpers. Keep the classifier intentionally conservative: it only
// suggests a code when the product description contains a strong keyword.
// The suggestion is never treated as authoritative classification.
export const MIN_HSN_DIGITS = 4;
export const MAX_HSN_DIGITS = 8;

const HSN_LOOKUP = [
  { hsn: '6109', label: 'knitted T-shirts / singlets', keywords: ['t-shirt', 'tshirt', 'tee', 'tees', 'singlet'] },
  { hsn: '6110', label: 'knitted jerseys / pullovers / hoodies', keywords: ['hoodie', 'hoodies', 'sweatshirt', 'sweatshirts', 'pullover', 'jersey'] },
  { hsn: '6103', label: 'knitted trousers / joggers', keywords: ['jogger', 'joggers', 'track pant', 'trackpants', 'knitted trouser', 'pants'] },
  { hsn: '6203', label: 'men’s trousers / shorts / jackets', keywords: ['men jacket', 'mens jacket', 'men jeans', 'mens jeans'] },
  { hsn: '6204', label: 'women’s garments', keywords: ['women jacket', 'womens jacket', 'women jeans', 'womens jeans', 'women dress', 'womens dress'] },
  { hsn: '6201', label: 'woven jackets / outerwear', keywords: ['jacket', 'jackets', 'overcoat', 'overcoats', 'coat', 'coats'] },
  { hsn: '6203', label: 'woven men’s jeans / trousers', keywords: ['jean', 'jeans', 'denim trouser', 'cargo pant', 'cargo pants', 'men trouser', 'mens trouser', 'men short', 'mens short'] },
  { hsn: '6204', label: 'woven women’s dresses / trousers', keywords: ['dress', 'dresses', 'skirt', 'skirts', 'women trouser', 'womens trouser', 'women short', 'womens short'] },
  { hsn: '6105', label: 'knitted men’s shirts / polos', keywords: ['polo', 'polos', 'knit shirt', 'knitted shirt'] },
  { hsn: '6205', label: 'woven men’s shirts', keywords: ['shirt', 'shirts', 'overshirt', 'overshirts'] },
  { hsn: '6505', label: 'caps / textile headgear', keywords: ['cap', 'caps', 'bucket hat', 'beanie'] },
  { hsn: '6115', label: 'socks / hosiery', keywords: ['sock', 'socks', 'hosiery'] },
  { hsn: '6217', label: 'belts / clothing accessories', keywords: ['belt', 'belts'] },
  { hsn: '4202', label: 'bags / luggage', keywords: ['bag', 'bags', 'backpack', 'backpacks', 'tote bag', 'sling bag'] },
  { hsn: '6107', label: 'men’s underwear', keywords: ['underwear', 'brief', 'briefs', 'boxer', 'boxers'] },
  { hsn: '5208', label: 'woven cotton fabric', keywords: ['cotton fabric', 'woven fabric', 'cotton cloth'] },
  { hsn: '6006', label: 'other knitted fabrics', keywords: ['knitted fabric', 'knit fabric', 'jersey fabric'] },
];

export function isHSNValid(value, minDigits = MIN_HSN_DIGITS) {
  const h = String(value || '').trim();
  return new RegExp(`^\\d{${minDigits},${MAX_HSN_DIGITS}}$`).test(h);
}

export function guessHSN(description) {
  const text = String(description || '').trim().toLowerCase();
  if (!text) return null;
  for (const entry of HSN_LOOKUP) {
    if (entry.keywords.some(k => text.includes(k))) {
      return { hsn: entry.hsn, label: entry.label };
    }
  }
  return null;
}

export function nextDNNum(debitNotes) {
  const fy = getFY();
  const pat = new RegExp(`^DN-${fy}/(\\d+)$`);
  let max = 0;
  (debitNotes || []).forEach(d => {
    const m = (d.dn_number || '').match(pat);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `DN-${fy}/${String(max + 1).padStart(3, '0')}`;
}

// GST-registration status for B2B/B2C classification purposes must be
// locked to what was true when the invoice was created (party_gstin_snapshot),
// not read live off the party record. Otherwise adding a client's GSTIN
// later — common once they cross the ₹20L mandatory-registration turnover —
// silently flips every one of their PAST invoices from B2C to B2B, changing
// GSTR-1 figures for periods that may already be filed. Convention:
//   null/undefined snapshot -> pre-fix invoice, no snapshot captured yet,
//                               falls back to the party's current GSTIN
//   ''  snapshot            -> explicitly confirmed unregistered at the
//                               time of this invoice — always B2C
//   'GSTIN...' snapshot     -> explicitly confirmed registered with this
//                               GSTIN at the time of this invoice
export function effectiveGstin(invoice, party) {
  return invoice?.party_gstin_snapshot ?? party?.gstin ?? '';
}

// GSTIN format + checksum validation (15 chars: 2-digit state code,
// 10-char PAN, 1 entity code, 'Z' by default, 1 checksum digit).
// Returns true/false — used to warn before a bad GSTIN goes on a printed
// tax invoice (a typo here makes the recipient's ITC claim fail in 2B).
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function isGSTINValid(gstin) {
  if (!gstin) return false;
  const g = gstin.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g)) return false;
  // Checksum (mod-36) over the first 14 characters, per the GSTN spec
  let factor = 2, sum = 0;
  for (let i = 13; i >= 0; i--) {
    let code = GSTIN_CHARS.indexOf(g[i]) * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(code / 36) + (code % 36);
  }
  const checkChar = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return checkChar === g[14];
}

// GST 2.0 (effective 22 Sep 2025) collapsed most goods, including
// readymade garments/made-ups, to two slabs based on per-piece sale
// price: ≤ ₹2,500 → 5%, above → 18%. Used to auto-suggest the line-item
// tax rate instead of leaving 12%/28% (now largely obsolete) as manual
// picks. Not a substitute for checking the HSN's actual current rate for
// non-apparel items.
export const GARMENT_RATE_THRESHOLD = 2500;
export function garmentGSTRate(unitPrice) {
  return Number(unitPrice || 0) > GARMENT_RATE_THRESHOLD ? 18 : 5;
}

// GSTR-1 Table 5 threshold for invoice-wise ("B2C Large") reporting of
// inter-state supplies to unregistered persons. Reduced from ₹2.5L to
// ₹1L effective 1 Aug 2024 (Notification 12/2024-Central Tax). Below
// this, inter-state B2C invoices fall into the B2CS summary instead.
export const B2CL_THRESHOLD = 100000;

// Credit notes affecting supplies of a given FY are only valid for
// adjusting GST output liability if issued by 30 Nov following that
// FY's end (or before the annual return is filed, whichever is
// earlier) — Section 34(2) CGST Act. FY string like "25-26".
export function creditNoteDeadline(fy) {
  const endYear = 2000 + parseInt(fy.split('-')[1], 10);
  return `${endYear}-11-30`;
}

// E-way bill threshold. Inter-state is a flat ₹50,000 everywhere. Intra-state
// varies by state notification — most states are ₹50,000 too, but several
// (including Delhi) raised their own intra-state limit to ₹1,00,000. This
// list is the "higher limit" states as of early 2026; state notifications do
// change, so double-check before relying on this for a state not in your
// regular list.
const EWAY_HIGH_THRESHOLD_STATES = new Set([
  'Delhi', 'Bihar', 'Chhattisgarh', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab',
  'Tamil Nadu', 'Uttarakhand', 'Chandigarh', 'Puducherry',
]);
export function ewayBillThreshold(isInterstate, bizState) {
  if (isInterstate) return 50000;
  return EWAY_HIGH_THRESHOLD_STATES.has(bizState) ? 100000 : 50000;
}
export function needsEwayBill(total, isInterstate, bizState) {
  return Number(total || 0) > ewayBillThreshold(isInterstate, bizState);
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
  { code: '2200', name: 'GST Input Credit', group: 'asset', sub_group: 'Current Assets', description: 'Eligible GST paid on purchases (input tax credit)' },
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
  { code: '5010', name: 'Job Work', group: 'expense', sub_group: 'Direct Expenses', description: 'Job Work, Outsource' },
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
  'Raw Materials','Job work', 'Wages & Salaries', 'Rent', 'Utilities', 'Shipping & Freight',
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
