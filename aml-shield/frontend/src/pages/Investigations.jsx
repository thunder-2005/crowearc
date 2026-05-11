import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, Users, AlertCircle, FileText, Globe, Loader2 } from 'lucide-react';
import api from '../api/client.js';
import { KpiCard } from '../components/shared/Card.jsx';

const FATF_HIGH_RISK = new Set([
  'Myanmar', 'Syria', 'Yemen', 'Iran', 'Russia', 'Pakistan', 'Haiti', 'North Korea'
]);

const RISK_RANK = { 'Very High': 0, 'High': 1, 'Medium': 2, 'Low': 3 };

function formatUSD(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function RiskBadge({ level }) {
  const tone =
    level === 'Very High' ? 'bg-red-100 text-red-700' :
    level === 'High'      ? 'bg-orange-100 text-orange-700' :
    level === 'Medium'    ? 'bg-yellow-100 text-yellow-800' :
    level === 'Low'       ? 'bg-green-100 text-green-700' :
                            'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tone}`}>
      {level || '—'}
    </span>
  );
}

function FatfBadge({ country }) {
  if (!country || !FATF_HIGH_RISK.has(country)) return null;
  return (
    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
      High Risk Country
    </span>
  );
}

function isBothHighRisk(a, b) {
  return ['High', 'Very High'].includes(a) && ['High', 'Very High'].includes(b);
}

export default function Investigations() {
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('counterparty');
  const [cpLinks, setCpLinks] = useState(null);
  const [boLinks, setBoLinks] = useState(null);
  const [boMessage, setBoMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailPair, setDetailPair] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/investigations/summary'),
      api.get('/investigations/counterparty-links'),
      api.get('/investigations/beneficial-owner-links')
    ])
      .then(([sumRes, cpRes, boRes]) => {
        if (cancelled) return;
        setSummary(sumRes.data || null);
        setCpLinks(cpRes.data?.links || []);
        setBoLinks(boRes.data?.links || []);
        setBoMessage(boRes.data?.message || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load investigations');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-navy-900">Linked Case Investigations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Customers connected through shared counterparties and beneficial owners
        </p>
      </header>

      <SummaryBar summary={summary} loading={loading} />

      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabButton active={tab === 'counterparty'} onClick={() => setTab('counterparty')}>
          Counterparty Links
        </TabButton>
        <TabButton active={tab === 'owner'} onClick={() => setTab('owner')}>
          Beneficial Owner Links
        </TabButton>
      </div>

      {loading ? (
        <LoadingPanel />
      ) : tab === 'counterparty' ? (
        <CounterpartyTab links={cpLinks || []} onOpenDetail={setDetailPair} />
      ) : (
        <OwnerTab links={boLinks || []} message={boMessage} onOpenDetail={setDetailPair} />
      )}

      <DetailDrawer pair={detailPair} onClose={() => setDetailPair(null)} />
    </div>
  );
}

function SummaryBar({ summary, loading }) {
  const s = summary || {};
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Total Connections"
        value={loading ? '…' : (s.total_counterparty_links ?? 0).toLocaleString()}
        tone="blue"
        icon={Users}
      />
      <KpiCard
        label="High Risk Connections"
        value={loading ? '…' : (s.high_risk_links ?? 0).toLocaleString()}
        tone="red"
        icon={AlertCircle}
      />
      <KpiCard
        label="Customers in Network"
        value={loading ? '…' : (s.customers_in_network ?? 0).toLocaleString()}
        icon={Users}
      />
      <KpiCard
        label="Shared Counterparties"
        value={loading ? '…' : (s.shared_counterparties ?? 0).toLocaleString()}
        sub={s.highest_risk_counterparty ? `Top: ${s.highest_risk_counterparty.name}` : null}
        tone="orange"
        icon={Globe}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function LoadingPanel() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-500">
      <Loader2 className="animate-spin mb-3" size={32} />
      <div className="text-sm">Analyzing customer connections...</div>
    </div>
  );
}

function CounterpartyTab({ links, onOpenDetail }) {
  const [riskFilter, setRiskFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [hasOpenAlerts, setHasOpenAlerts] = useState(false);
  const [hasSar, setHasSar] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('risk');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const countries = useMemo(() => {
    const set = new Set();
    for (const l of links) if (l.counterparty_country) set.add(l.counterparty_country);
    return Array.from(set).sort();
  }, [links]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return links.filter((l) => {
      const aR = l.customer_a_risk, bR = l.customer_b_risk;
      if (riskFilter === 'high' && !(['High', 'Very High'].includes(aR) || ['High', 'Very High'].includes(bR))) return false;
      if (riskFilter === 'medium' && !(aR === 'Medium' || bR === 'Medium')) return false;
      if (riskFilter === 'low' && !(aR === 'Low' || bR === 'Low')) return false;
      if (countryFilter !== 'all' && l.counterparty_country !== countryFilter) return false;
      if (hasOpenAlerts && Number(l.customer_a_open_alerts || 0) + Number(l.customer_b_open_alerts || 0) === 0) return false;
      if (hasSar && Number(l.customer_a_sars || 0) + Number(l.customer_b_sars || 0) === 0) return false;
      if (term) {
        const blob = `${l.customer_a_name || ''} ${l.customer_b_name || ''} ${l.shared_counterparty || ''}`.toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    });
  }, [links, riskFilter, countryFilter, hasOpenAlerts, hasSar, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    const sorter = {
      risk: (a, b) => (Math.min(RISK_RANK[a.customer_a_risk] ?? 9, RISK_RANK[a.customer_b_risk] ?? 9)
                     - Math.min(RISK_RANK[b.customer_a_risk] ?? 9, RISK_RANK[b.customer_b_risk] ?? 9)) * dir,
      customer_a: (a, b) => (a.customer_a_name || '').localeCompare(b.customer_a_name || '') * dir,
      customer_b: (a, b) => (a.customer_b_name || '').localeCompare(b.customer_b_name || '') * dir,
      counterparty: (a, b) => (a.shared_counterparty || '').localeCompare(b.shared_counterparty || '') * dir,
      country: (a, b) => (a.counterparty_country || '').localeCompare(b.counterparty_country || '') * dir,
      txns: (a, b) => (Number(a.total_shared_txns) - Number(b.total_shared_txns)) * dir,
      amount: (a, b) => (Number(a.total_shared_amount) - Number(b.total_shared_amount)) * dir,
      alerts: (a, b) => ((Number(a.customer_a_open_alerts) + Number(a.customer_b_open_alerts))
                       - (Number(b.customer_a_open_alerts) + Number(b.customer_b_open_alerts))) * dir,
      sars: (a, b) => ((Number(a.customer_a_sars) + Number(a.customer_b_sars))
                     - (Number(b.customer_a_sars) + Number(b.customer_b_sars))) * dir
    };
    arr.sort(sorter[sortKey] || sorter.risk);
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'risk' ? 'asc' : 'desc'); }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <Field label="Risk Level">
          <select className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white" value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setPage(0); }}>
            <option value="all">All</option>
            <option value="high">High + Very High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Country">
          <select className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white" value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setPage(0); }}>
            <option value="all">All countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={hasOpenAlerts} onChange={(e) => { setHasOpenAlerts(e.target.checked); setPage(0); }} />
          Has Open Alerts
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={hasSar} onChange={(e) => { setHasSar(e.target.checked); setPage(0); }} />
          Has SAR Filed
        </label>
        <div className="flex-1 min-w-[200px]">
          <Field label="Search">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                className="w-full border border-slate-200 rounded pl-7 pr-2 py-1.5 text-sm"
                placeholder="Customer or counterparty name"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </Field>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState text="No counterparty connections match the current filters." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <Th onClick={() => toggleSort('customer_a')} active={sortKey === 'customer_a'} dir={sortDir}>Customer A</Th>
                  <Th>Risk</Th>
                  <Th onClick={() => toggleSort('customer_b')} active={sortKey === 'customer_b'} dir={sortDir}>Customer B</Th>
                  <Th>Risk</Th>
                  <Th onClick={() => toggleSort('counterparty')} active={sortKey === 'counterparty'} dir={sortDir}>Shared Counterparty</Th>
                  <Th onClick={() => toggleSort('country')} active={sortKey === 'country'} dir={sortDir}>Country</Th>
                  <Th onClick={() => toggleSort('txns')} active={sortKey === 'txns'} dir={sortDir}>Txns</Th>
                  <Th onClick={() => toggleSort('amount')} active={sortKey === 'amount'} dir={sortDir}>Amount</Th>
                  <Th onClick={() => toggleSort('alerts')} active={sortKey === 'alerts'} dir={sortDir}>Open Alerts</Th>
                  <Th onClick={() => toggleSort('sars')} active={sortKey === 'sars'} dir={sortDir}>SARs</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((l, idx) => {
                  const both = isBothHighRisk(l.customer_a_risk, l.customer_b_risk);
                  const openTotal = Number(l.customer_a_open_alerts || 0) + Number(l.customer_b_open_alerts || 0);
                  const sarTotal = Number(l.customer_a_sars || 0) + Number(l.customer_b_sars || 0);
                  return (
                    <tr key={`${l.customer_a_id}-${l.customer_b_id}-${l.shared_counterparty}-${idx}`}
                        className={both ? 'border-l-4 border-l-red-400' : ''}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{l.customer_a_name}</div>
                        <div className="text-xs text-slate-500">{l.customer_a_id}</div>
                      </td>
                      <td className="px-3 py-2"><RiskBadge level={l.customer_a_risk} /></td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{l.customer_b_name}</div>
                        <div className="text-xs text-slate-500">{l.customer_b_id}</div>
                      </td>
                      <td className="px-3 py-2"><RiskBadge level={l.customer_b_risk} /></td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{l.shared_counterparty}</div>
                        {both && (
                          <div className="mt-1">
                            <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-700 rounded border border-red-200">
                              High Risk Connection
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span>{l.counterparty_country || '—'}</span>
                        <FatfBadge country={l.counterparty_country} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{Number(l.total_shared_txns).toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums">{formatUSD(l.total_shared_amount)}</td>
                      <td className={`px-3 py-2 tabular-nums ${openTotal > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                        {openTotal}
                      </td>
                      <td className={`px-3 py-2 tabular-nums ${sarTotal > 0 ? 'text-navy-900 font-semibold' : 'text-slate-400'}`}>
                        {sarTotal}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => onOpenDetail({
                            customer_a_id: l.customer_a_id,
                            customer_b_id: l.customer_b_id,
                            customer_a_name: l.customer_a_name,
                            customer_b_name: l.customer_b_name,
                            shared_via: `counterparty ${l.shared_counterparty}`
                          })}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View Connection
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            shown={visible.length}
            total={sorted.length}
          />
        </div>
      )}
    </div>
  );
}

function OwnerTab({ links, message, onOpenDetail }) {
  if (!links || links.length === 0) {
    return (
      <EmptyState text={message || 'No beneficial owner connections found in current data.'}
                  sub="Beneficial owner data is populated from KYB/UBO records during customer onboarding." />
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <Th>Customer A</Th>
              <Th>Customer B</Th>
              <Th>Shared Owner</Th>
              <Th>% A</Th>
              <Th>% B</Th>
              <Th>Combined Risk</Th>
              <Th>Open Alerts</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {links.map((l, idx) => {
              const both = isBothHighRisk(l.customer_a_risk, l.customer_b_risk);
              const openTotal = Number(l.customer_a_open_alerts || 0) + Number(l.customer_b_open_alerts || 0);
              const combinedRisk =
                both ? 'Very High'
                : (['High', 'Very High'].includes(l.customer_a_risk) || ['High', 'Very High'].includes(l.customer_b_risk)) ? 'High'
                : (l.customer_a_risk === 'Medium' || l.customer_b_risk === 'Medium') ? 'Medium'
                : 'Low';
              return (
                <tr key={`${l.customer_a_id}-${l.customer_b_id}-${l.shared_owner}-${idx}`}
                    className={both ? 'border-l-4 border-l-red-400' : ''}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{l.customer_a_name}</div>
                    <div className="text-xs text-slate-500">{l.customer_a_id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{l.customer_b_name}</div>
                    <div className="text-xs text-slate-500">{l.customer_b_id}</div>
                  </td>
                  <td className="px-3 py-2 font-medium">{l.shared_owner}</td>
                  <td className="px-3 py-2 tabular-nums">{l.customer_a_pct != null ? `${l.customer_a_pct}%` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{l.customer_b_pct != null ? `${l.customer_b_pct}%` : '—'}</td>
                  <td className="px-3 py-2"><RiskBadge level={combinedRisk} /></td>
                  <td className={`px-3 py-2 tabular-nums ${openTotal > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                    {openTotal}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onOpenDetail({
                        customer_a_id: l.customer_a_id,
                        customer_b_id: l.customer_b_id,
                        customer_a_name: l.customer_a_name,
                        customer_b_name: l.customer_b_name,
                        shared_via: `beneficial owner ${l.shared_owner}`
                      })}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      View Connection
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col">
      <label className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Th({ children, onClick, active, dir }) {
  const sortable = !!onClick;
  return (
    <th
      onClick={onClick}
      className={`text-left px-3 py-2 font-medium ${sortable ? 'cursor-pointer hover:text-slate-700' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && active && <span className="text-slate-400">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

function Pagination({ page, totalPages, onPrev, onNext, shown, total }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
      <div>Showing {shown} of {total.toLocaleString()}</div>
      <div className="flex items-center gap-2">
        <button onClick={onPrev} disabled={page === 0} className="px-2 py-1 border border-slate-200 rounded disabled:opacity-40">Prev</button>
        <span>Page {page + 1} of {totalPages}</span>
        <button onClick={onNext} disabled={page >= totalPages - 1} className="px-2 py-1 border border-slate-200 rounded disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function EmptyState({ text, sub }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg py-12 text-center">
      <div className="text-sm font-medium text-slate-700">{text}</div>
      {sub && <div className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{sub}</div>}
    </div>
  );
}

function DetailDrawer({ pair, onClose }) {
  const open = pair !== null;
  const lastPairRef = useRef(null);
  if (pair) lastPairRef.current = pair;
  const renderPair = pair || lastPairRef.current;

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
          zIndex: 40
        }}
      />
      <aside
        role="dialog" aria-modal="true"
        className="border-l border-slate-200"
        style={{
          position: 'fixed', top: 0, right: 0,
          height: '100vh', width: 480,
          backgroundColor: '#ffffff',
          boxShadow: '-12px 0 32px -8px rgba(15, 23, 42, 0.18)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: open ? 'transform 0.25s ease-out' : 'transform 0.25s ease-in',
          zIndex: 50,
          display: 'flex', flexDirection: 'column'
        }}
      >
        {renderPair && <DetailBody key={`${renderPair.customer_a_id}-${renderPair.customer_b_id}`} pair={renderPair} onClose={onClose} />}
      </aside>
    </>
  );
}

function DetailBody({ pair, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    api.get('/investigations/link-detail', {
      params: { customer_a_id: pair.customer_a_id, customer_b_id: pair.customer_b_id }
    })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load connection');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pair.customer_a_id, pair.customer_b_id]);

  async function saveNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.post('/investigations/note', {
        customer_a_id: pair.customer_a_id,
        customer_b_id: pair.customer_b_id,
        customer_a_name: pair.customer_a_name,
        customer_b_name: pair.customer_b_name,
        shared_via: pair.shared_via,
        note: note.trim()
      });
      setNote('');
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Connection Detail</div>
          <div className="text-sm font-semibold text-navy-900 mt-1">
            {pair.customer_a_name} <span className="text-slate-400">↔</span> {pair.customer_b_name}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Loader2 className="animate-spin mb-3" size={28} />
            <div className="text-sm">Loading connection detail...</div>
          </div>
        )}
        {error && !loading && (
          <div className="rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
        )}
        {data && !loading && (
          <>
            <ProfileSection a={data.customer_a} b={data.customer_b}
                            aAlerts={data.customer_a_alerts?.length || 0}
                            bAlerts={data.customer_b_alerts?.length || 0}
                            aSars={data.customer_a_sars?.length || 0}
                            bSars={data.customer_b_sars?.length || 0} />
            <SharedCounterpartiesSection items={data.shared_counterparties}
                                         aName={pair.customer_a_name}
                                         bName={pair.customer_b_name} />
            {(data.shared_beneficial_owners?.length > 0) && (
              <Section title="Shared Beneficial Owners">
                <ul className="space-y-1">
                  {data.shared_beneficial_owners.map((o, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-slate-500 text-xs ml-2">
                        A: {o.customer_a_pct != null ? `${o.customer_a_pct}%` : '—'} · B: {o.customer_b_pct != null ? `${o.customer_b_pct}%` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <OpenAlertsSection a={data.customer_a_alerts || []} b={data.customer_b_alerts || []} />
            <SarsSection a={data.customer_a_sars || []} b={data.customer_b_sars || []} />
            <Section title="Investigation Note">
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add investigation note..."
                className="w-full border border-slate-200 rounded p-2 text-sm"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={saveNote}
                  disabled={!note.trim() || saving}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded disabled:opacity-50 hover:bg-blue-700"
                >
                  {saving ? 'Saving...' : 'Save Note'}
                </button>
                {savedAt && <span className="text-xs text-green-600">Saved to audit trail</span>}
              </div>
            </Section>
          </>
        )}
      </div>
    </>
  );
}

function ProfileSection({ a, b, aAlerts, bAlerts, aSars, bSars }) {
  return (
    <Section title="Customer Profiles">
      <div className="grid grid-cols-2 gap-3">
        <ProfileCard c={a} alerts={aAlerts} sars={aSars} />
        <ProfileCard c={b} alerts={bAlerts} sars={bSars} />
      </div>
    </Section>
  );
}

function ProfileCard({ c, alerts, sars }) {
  if (!c) return <div className="text-sm text-slate-400">Customer not found</div>;
  return (
    <div className="border border-slate-200 rounded p-3 space-y-1 text-xs">
      <div className="font-semibold text-slate-800 text-sm">{c.customer_name}</div>
      <div className="text-slate-500">{c.customer_id}</div>
      <div className="pt-1"><RiskBadge level={c.customer_risk_rating} /></div>
      <div className="text-slate-600">CDD: {c.cdd_level || '—'}</div>
      <div className="text-slate-600">Since: {c.customer_since_date || '—'}</div>
      <div className="text-slate-600">Open Alerts: <span className={alerts > 0 ? 'text-red-600 font-semibold' : ''}>{alerts}</span></div>
      <div className="text-slate-600">SARs: {sars}</div>
      <Link
        to={`/manager/customers/${c.customer_id}`}
        className="text-blue-600 hover:text-blue-800 text-xs font-medium inline-block pt-1"
      >
        View Profile →
      </Link>
    </div>
  );
}

function SharedCounterpartiesSection({ items, aName, bName }) {
  if (!items || items.length === 0) {
    return <Section title="Shared Counterparties"><div className="text-sm text-slate-500">No shared counterparties found.</div></Section>;
  }
  return (
    <Section title="Shared Counterparties">
      <div className="space-y-3">
        {items.map((cp, i) => {
          const aTxns = cp.customer_a_transactions || [];
          const bTxns = cp.customer_b_transactions || [];
          const combined = [
            ...aTxns.map((t) => ({ ...t, customer: aName })),
            ...bTxns.map((t) => ({ ...t, customer: bName }))
          ].sort((x, y) => (y.txn_date || '').localeCompare(x.txn_date || ''));
          return (
            <div key={i} className="border border-slate-200 rounded">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                <div className="font-semibold text-sm text-slate-800">
                  {cp.name}
                </div>
                <div className="text-xs text-slate-500 inline-flex items-center">
                  {cp.country || 'Unknown country'}
                  <FatfBadge country={cp.country} />
                </div>
              </div>
              {combined.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">No transactions on record.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-white text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Date</th>
                      <th className="text-left px-2 py-1 font-medium">Customer</th>
                      <th className="text-right px-2 py-1 font-medium">Amount</th>
                      <th className="text-left px-2 py-1 font-medium">Channel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {combined.slice(0, 10).map((t, j) => (
                      <tr key={j}>
                        <td className="px-2 py-1 tabular-nums">{t.txn_date || '—'}</td>
                        <td className="px-2 py-1 truncate max-w-[120px]">{t.customer}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{formatUSD(t.amount)}</td>
                        <td className="px-2 py-1">{t.channel || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {combined.length > 10 && (
                <div className="px-3 py-1 text-[11px] text-slate-400 border-t border-slate-100">
                  Showing 10 of {combined.length} transactions
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function OpenAlertsSection({ a, b }) {
  const items = [...a.map((x) => ({ ...x, side: 'A' })), ...b.map((x) => ({ ...x, side: 'B' }))];
  return (
    <Section title="Open Alerts">
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No open alerts on either customer.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left px-2 py-1 font-medium">Alert</th>
              <th className="text-left px-2 py-1 font-medium">Customer</th>
              <th className="text-left px-2 py-1 font-medium">Scenario</th>
              <th className="text-left px-2 py-1 font-medium">Priority</th>
              <th className="text-left px-2 py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((al, i) => (
              <tr key={i}>
                <td className="px-2 py-1">
                  <Link to={`/manager/alerts?alert=${al.alert_id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {al.alert_id}
                  </Link>
                </td>
                <td className="px-2 py-1 truncate max-w-[100px]">{al.customer_name}</td>
                <td className="px-2 py-1 truncate max-w-[120px]">{al.scenario}</td>
                <td className="px-2 py-1">{al.priority}</td>
                <td className="px-2 py-1">{al.alert_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function SarsSection({ a, b }) {
  const items = [...a, ...b];
  return (
    <Section title="SAR History">
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No SARs filed on either customer.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left px-2 py-1 font-medium">SAR</th>
              <th className="text-left px-2 py-1 font-medium">Customer</th>
              <th className="text-left px-2 py-1 font-medium">Filed</th>
              <th className="text-left px-2 py-1 font-medium">Status</th>
              <th className="text-right px-2 py-1 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((s, i) => (
              <tr key={i}>
                <td className="px-2 py-1">
                  <Link to={`/manager/sars?sar=${s.sar_id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {s.sar_id}
                  </Link>
                </td>
                <td className="px-2 py-1 truncate max-w-[100px]">{s.customer_name}</td>
                <td className="px-2 py-1">{s.filed_date || '—'}</td>
                <td className="px-2 py-1">{s.sar_status}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatUSD(s.amount_involved_inr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}
