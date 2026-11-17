import { useState, useEffect, useRef } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';

export function Badge({ status }) {
  return <span className={`badge badge-${status}`}>{status?.replace(/_/g, ' ')}</span>;
}

// Escape closes the modal. Clicking the dark backdrop closes it only when the
// press also STARTED on the backdrop — otherwise selecting text in a field and
// releasing the mouse outside the dialog would throw away the whole form.
// Pass `confirmClose` (a message) for big forms so an accidental close asks first.
const modalStack = [];
export function ModalShell({ title, onClose, children, foot, size = '', confirmClose }) {
  const downOnBackdrop = useRef(false);
  const me = useRef({});
  const requestClose = () => { if (!confirmClose || confirm(confirmClose)) onClose(); };
  useEffect(() => {
    modalStack.push(me.current);
    return () => { const i = modalStack.indexOf(me.current); if (i >= 0) modalStack.splice(i, 1); };
  }, []);
  useEffect(() => {
    // Only the top-most dialog reacts, so Escape in a nested popup doesn't close its parent too.
    const onKey = e => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === me.current) requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="modal-overlay"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (e.target === e.currentTarget && downOnBackdrop.current) requestClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={requestClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

// ─── Toasts ───────────────────────────────────────────────────────────────────
// toast('Saved', 'success') from anywhere; <Toaster/> is mounted once in App.
const toastListeners = new Set();
let toastSeq = 0;
export function toast(message, type = 'info', ms) {
  const t = { id: ++toastSeq, message: String(message || ''), type };
  toastListeners.forEach(fn => fn(t, ms ?? (type === 'error' ? 8000 : 3500)));
}
export function Toaster() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const fn = (t, ms) => {
      setList(l => [...l.slice(-3), t]);
      setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), ms);
    };
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  if (!list.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.message}</span>
          <button onClick={() => setList(l => l.filter(x => x.id !== t.id))} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}

export function FG({ label, children, note }) {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      {children}
      {note && <div className="form-note">{note}</div>}
    </div>
  );
}

export function EmptyState({ icon, message, sub }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || '📭'}</div>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{message}</p>
      {sub && <p style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text3)' }}>{sub}</p>}
    </div>
  );
}

export function StatCard({ label, value, sub, color = 'blue' }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-val ${color}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function PillTabs({ tabs, active, onChange }) {
  return (
    <div className="pill-tabs">
      {tabs.map(t => (
        <button key={t.id} className={`pill-tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Searchable account picker — type to filter by code or name instead of
// scrolling a long <select>. Supports arrow-key navigation and Enter to pick.
export function AccountSelect({ accounts, value, onChange, placeholder = 'Search account…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const selected = accounts.find(a => a.id === value);

  useEffect(() => {
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? accounts.filter(a => a.name.toLowerCase().includes(q) || (a.code || '').toLowerCase().includes(q))
    : accounts;
  const groupOrder = ['asset', 'liability', 'equity', 'income', 'expense'];
  const grouped = groupOrder.map(g => ({ g, items: filtered.filter(a => a.group === g) })).filter(x => x.items.length);
  const flat = grouped.flatMap(x => x.items);

  function pick(acc) { onChange(acc.id); setQuery(''); setOpen(false); }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[highlight]) pick(flat[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={open ? query : (selected ? `${selected.code} — ${selected.name}` : '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 7px', fontSize: 12, width: '100%', outline: 'none' }}
      />
      {open && (
        <div className="acct-picker-menu">
          {flat.length === 0 && <div className="acct-picker-empty">No match</div>}
          {grouped.map(({ g, items }) => (
            <div key={g}>
              <div className="acct-picker-grp">{g}</div>
              {items.map(a => {
                const idx = flat.indexOf(a);
                return (
                  <div
                    key={a.id}
                    className={`acct-picker-item ${idx === highlight ? 'hl' : ''} ${a.id === value ? 'sel' : ''}`}
                    onMouseDown={e => { e.preventDefault(); pick(a); }}
                    onMouseEnter={() => setHighlight(idx)}
                  >
                    <span className="mono" style={{ color: 'var(--accent)', fontSize: 10.5 }}>{a.code}</span> {a.name}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Payment history widget (reusable inside modals)
export function PayHistory({ payments, invoiceTotal }) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = invoiceTotal - totalPaid;
  if (!payments.length) return null;
  return (
    <div className="pay-history">
      <h4>Payment History</h4>
      {payments.map(p => (
        <div className="pay-row" key={p.id}>
          <span>{fmtDate(p.payment_date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(p.amount)}</span>
        </div>
      ))}
      <div className="pay-row" style={{ fontWeight: 600 }}>
        <span>Balance Due</span>
        <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmt(balance)}</span>
      </div>
    </div>
  );
}
