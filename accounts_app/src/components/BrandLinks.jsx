// Brand links — which client party each operations-app brand is billed as.
// Opened from Parties (🔗 Brand links) and from Production Orders.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ModalShell, EmptyState, toast } from './ui.jsx';
import { loadBrandLinks, suggestParty, linkBrandParty, unlinkBrand, createPartyForBrand, createBrandFromParty } from '../lib/opsLink.js';

export function useBrandLinks() {
  const [data, setData] = useState(null);
  const refresh = useCallback(async () => setData(await loadBrandLinks()), []);
  useEffect(() => { refresh(); }, [refresh]);
  return [data, refresh];
}

// How many brands still need a party (for badges/banners). null = not set up.
export function unlinkedBrandCount(data, parties) {
  if (!data?.ok || !data.opsBiz) return null;
  const linked = new Set(parties.filter(p => p.business_id === data.opsBiz && p.brand_id).map(p => p.brand_id));
  return data.brands.filter(b => !linked.has(b.id)).length;
}

const selStyle = { background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '5px 8px', fontSize: 12, maxWidth: 260, width: '100%' };

export function BrandLinksModal({ data, parties, onClose, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState('brands');
  const opsBiz = data?.opsBiz;
  const clients = useMemo(() => parties.filter(p => p.business_id === opsBiz && p.type === 'client').sort((a, b) => a.name.localeCompare(b.name)), [parties, opsBiz]);
  const partyOf = useMemo(() => Object.fromEntries(clients.filter(p => p.brand_id).map(p => [p.brand_id, p])), [clients]);
  const free = clients.filter(p => !p.brand_id);

  const rows = useMemo(() => (data?.brands || []).map(b => ({ brand: b, party: partyOf[b.id] || null, suggestion: partyOf[b.id] ? null : suggestParty(b, free) }))
    .sort((a, b) => (!!a.party - !!b.party) || a.brand.name.localeCompare(b.brand.name)), [data, partyOf, free]);
  const unlinked = rows.filter(r => !r.party);
  const suggested = unlinked.filter(r => r.suggestion && r.suggestion.score >= 70);

  async function run(key, fn, msg) {
    setBusy(key);
    try { await fn(); if (msg) toast(msg, 'success'); await onChanged(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(null);
  }
  async function linkAllSuggested() {
    await run('all', async () => {
      // one at a time: two brands must not grab the same party
      const used = new Set();
      for (const r of suggested) {
        if (used.has(r.suggestion.party.id)) continue;
        used.add(r.suggestion.party.id);
        await linkBrandParty(r.brand.id, r.suggestion.party.id);
      }
    }, `Linked ${suggested.length} brand${suggested.length === 1 ? '' : 's'}`);
  }

  if (!data?.ok) return (
    <ModalShell title="Brand links" onClose={onClose}>
      <p className="err-msg">The operations app isn't reachable from here yet: {data?.error || 'loading…'}</p>
    </ModalShell>
  );
  if (!opsBiz) return (
    <ModalShell title="Brand links" onClose={onClose}>
      <p style={{ fontSize: 13, color: 'var(--text2)' }}>Not linked with the operations app yet. It links on its own when the app opens; or use Production Orders → Link now.</p>
    </ModalShell>
  );

  return (
    <ModalShell title="🔗 Brand links" onClose={onClose} size="modal-lg"
      foot={<button className="btn btn-ghost" onClick={onClose}>Done</button>}>
      <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12 }}>
        Each brand in the operations app is billed as one client party here. Linked pairs keep GSTIN, state, address, PAN,
        phone and email in sync both ways; the party keeps its own (legal) name for invoices.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${tab === 'brands' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('brands')}>
          Brands ({rows.length}){unlinked.length ? ` · ${unlinked.length} not linked` : ''}
        </button>
        <button className={`btn btn-sm ${tab === 'clients' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('clients')}>
          Clients not in operations ({free.length})
        </button>
        <span style={{ flex: 1 }} />
        {tab === 'brands' && suggested.length > 0 && (
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={linkAllSuggested}>
            {busy === 'all' ? 'Linking…' : `✓ Accept ${suggested.length} suggested match${suggested.length === 1 ? '' : 'es'}`}
          </button>
        )}
      </div>

      {tab === 'brands' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Brand (operations)</th><th>Billed as (party here)</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ brand: b, party, suggestion }) => (
                <tr key={b.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{b.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{b.gstin || 'no GSTIN'}{b.state ? ` · ${b.state}` : ''}</div>
                  </td>
                  <td>
                    <select style={selStyle} value={party?.id || ''} disabled={!!busy}
                      onChange={e => e.target.value
                        ? run(b.id, () => linkBrandParty(b.id, e.target.value), `${b.name} linked`)
                        : run(b.id, () => unlinkBrand(b.id), `${b.name} unlinked`)}>
                      <option value="">— not linked —</option>
                      {party && <option value={party.id}>{party.name}{party.gstin ? ` · ${party.gstin}` : ''}</option>}
                      {suggestion && <option value={suggestion.party.id}>★ {suggestion.party.name} ({suggestion.why})</option>}
                      {free.filter(p => p.id !== suggestion?.party.id).map(p => <option key={p.id} value={p.id}>{p.name}{p.gstin ? ` · ${p.gstin}` : ''}</option>)}
                    </select>
                    {!party && suggestion && suggestion.score >= 70 && (
                      <div className="hint" style={{ color: 'var(--blue)', marginTop: 3 }}>Suggested: {suggestion.party.name} ({suggestion.why})</div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {party
                      ? <span className="tag" style={{ color: 'var(--green)' }}>✓ linked</span>
                      : <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {suggestion && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run(b.id, () => linkBrandParty(b.id, suggestion.party.id), `${b.name} linked to ${suggestion.party.name}`)}>Link</button>}
                          <button className="btn btn-ghost btn-sm" disabled={!!busy} title="Make a new client party from this brand's details"
                            onClick={() => run(b.id, () => createPartyForBrand(b.id), `${b.name} added as a client`)}>+ New party</button>
                        </div>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3}><EmptyState icon="🏷️" message="No brands in the operations app yet" /></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'clients' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client party</th><th>GSTIN</th><th></th></tr></thead>
            <tbody>
              {free.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.name}<div className="hint">{p.state || ''}</div></td>
                  <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{p.gstin || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" disabled={!!busy} title="Creates the brand in the operations app with these details, already linked"
                      onClick={() => run(p.id, () => createBrandFromParty(p.id), `${p.name} added as a brand in operations`)}>+ Add as brand</button>
                  </td>
                </tr>
              ))}
              {free.length === 0 && <tr><td colSpan={3}><EmptyState icon="✓" message="Every client is linked to a brand" /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}
