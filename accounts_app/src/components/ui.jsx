import { useState } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';

export function Badge({ status }) {
  return <span className={`badge badge-${status}`}>{status?.replace(/_/g, ' ')}</span>;
}

export function ModalShell({ title, onClose, children, foot, size = '' }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
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
