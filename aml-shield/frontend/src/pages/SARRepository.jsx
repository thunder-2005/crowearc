import { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import Badge from '../components/shared/Badge.jsx';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import {
  Search, Download, FileText, Upload, X, Trash2, Package, Clock, AlertCircle, Lock,
  FolderOpen, Eye, Briefcase, Inbox, CheckCircle2, Send, Activity
} from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';
import { useInvestigationTabs } from '../state/InvestigationTabsContext.jsx';

const STATUSES = ['', 'Draft', 'Under Review', 'Filed', 'Acknowledged'];
const RETENTION = ['', 'Pending Filing', 'Active', 'Legal Hold'];

// Color-coded filing-type pill — same wording the wizard uses verbatim.
function FilingTypeBadge({ type }) {
  if (!type) return null;
  const tone = type === 'Joint SAR'      ? 'bg-purple-100 text-purple-700'
             : type === 'Continuing SAR' ? 'bg-orange-100 text-orange-700'
             : /* Initial SAR */           'bg-blue-100 text-blue-700';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tone}`}>
      {type}
    </span>
  );
}

// `warnDays` (defaults to 90) controls the orange "expiring soon" band;
// the red "critical" band is `warnDays / 3` (defaults to 30). Pass the
// value loaded from sar.retention_warn_days when rendering.
function retentionUrgency(expiry, warnDays = 90) {
  if (!expiry) return { label: 'Pending filing', tone: 'bg-slate-100 text-slate-600' };
  const days = Math.round((new Date(expiry) - new Date()) / 86400000);
  const verySoonDays = Math.max(1, Math.round(warnDays / 3));
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'bg-red-100 text-red-700' };
  if (days <= verySoonDays) return { label: `${days}d to expire`, tone: 'bg-red-100 text-red-700' };
  if (days <= warnDays) return { label: `${days}d to expire`, tone: 'bg-orange-100 text-orange-700' };
  return { label: `${days}d`, tone: 'bg-green-100 text-green-700' };
}

export default function SARRepository() {
  const { isEmployee, isL1, isL2 } = useRole();
  // L2 employees get the My-Cases / File-SAR view. L1 employees and Managers
  // both land on the read-only repository table.
  if (isEmployee && isL2) return <EmployeeSarCases />;
  return <ManagerSarRepository />;
}

function ManagerSarRepository() {
  const { isManager, isL1, currentAnalyst } = useRole();
  // The repository table is read-only for both managers and L1 analysts.
  // Only L2 analysts have a separate filing view (above), so any user that
  // ends up here cannot upload new evidence or file new SARs from this page.
  const readOnly = isManager || isL1;
  const [params] = useSearchParams();
  const deepLinkSarId = params.get('sar_id');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sar_status, setSarStatus] = useState('');
  const [retention_status, setRetentionStatus] = useState('');
  const [selected, setSelected] = useState(null);
  // Manager-tunable retention-warning threshold; loaded once on mount.
  const [warnDays, setWarnDays] = useState(90);
  useEffect(() => {
    api.get('/settings/manager').then(r => {
      const w = Number(r.data?.['sar.retention_warn_days']);
      if (Number.isFinite(w) && w > 0) setWarnDays(w);
    }).catch(() => { /* keep default */ });
  }, []);

  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (sar_status) params.sar_status = sar_status;
    if (retention_status) params.retention_status = retention_status;
    api.get('/sars', { params }).then(r => {
      setItems(r.data.items);
      setTotal(r.data.total);
    });
  };

  useEffect(() => { load(); }, [sar_status, retention_status]);

  useEffect(() => {
    if (!deepLinkSarId) return;
    api.get(`/sars/${deepLinkSarId}`)
      .then(r => setSelected(r.data))
      .catch(() => {});
  }, [deepLinkSarId]);

  const openSar = async (row) => {
    const { data } = await api.get(`/sars/${row.sar_id}`);
    setSelected(data);
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const { data } = await api.get(`/sars/${selected.sar_id}`);
    setSelected(data);
  };

  const requester = encodeURIComponent(isManager ? 'Compliance Manager' : (currentAnalyst || 'Compliance Officer'));

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold text-navy-900">SAR Repository</div>
            <div className="text-sm text-slate-500">
              Control #3 · {total} SARs · FIU-IND jurisdiction · 5-year retention
              {isManager && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Manager — read-only</span>}
              {isL1     && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">L1 — read-only</span>}
            </div>
          </div>
        </div>

        {isL1 && (
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>
              Viewing SAR records for case reference. SAR filing is available to L2 analysts and above.
            </span>
          </div>
        )}

        <Card bodyClassName="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Search by SAR ID, customer, case ID…"
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load()}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>
            <select value={sar_status} onChange={e => setSarStatus(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
              {STATUSES.map(s => <option key={s || '_any'} value={s}>{s || 'All statuses'}</option>)}
            </select>
            <select value={retention_status} onChange={e => setRetentionStatus(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
              {RETENTION.map(s => <option key={s || '_any'} value={s}>{s || 'All retention'}</option>)}
            </select>
            <button onClick={load}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2">
              Apply
            </button>
          </div>
        </Card>

        <Card bodyClassName="p-0">
          <Table
            onRowClick={openSar}
            columns={[
              { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs text-navy-900 font-medium',
                render: r => (
                  <div className="flex items-center gap-2">
                    <span>{r.sar_id}</span>
                    <FilingTypeBadge type={r.filing_type} />
                  </div>
                ) },
              { key: 'filed_date', label: 'Filed', render: r => r.filed_date || <span className="italic text-slate-400">{r.draft_created_date}</span> },
              { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
              { key: 'case_id', label: 'Case ID', render: r => r.case_id || '—' },
              { key: 'sar_status', label: 'Status', render: r => <Badge value={r.sar_status} /> },
              { key: 'amount_involved_inr', label: 'Amount', render: r => `$${Number(r.amount_involved_inr || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
              { key: 'current_owner', label: 'Owner' },
              {
                key: 'retention_expiry_date', label: 'Retention',
                render: r => {
                  const s = retentionUrgency(r.retention_expiry_date, warnDays);
                  return (
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${s.tone}`}>{s.label}</span>
                      {r.law_enforcement_hold ? <Lock size={13} className="text-red-500" title="Legal hold" /> : null}
                    </div>
                  );
                }
              },
              {
                key: 'actions', label: '',
                render: r => (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <a
                      href={`/api/sars/${r.sar_id}/export?requested_by=${requester}&purpose=Manual%20download`}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Export package"
                    ><Download size={15} /></a>
                    <button onClick={() => openSar(r)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="View">
                      <FileText size={15} />
                    </button>
                  </div>
                )
              }
            ]}
            rows={items}
            emptyMessage="No SARs found"
          />
        </Card>
      </div>

      {selected && (
        <SarDetail
          sar={selected}
          onClose={() => setSelected(null)}
          onRefresh={refreshSelected}
          readOnly={readOnly}
          requester={requester}
          warnDays={warnDays}
        />
      )}
    </div>
  );
}

function SarDetail({ sar, onClose, onRefresh, readOnly, requester, warnDays = 90 }) {
  const fileInput = useRef();
  const [uploading, setUploading] = useState(false);
  const retention = retentionUrgency(sar.retention_expiry_date, warnDays);

  const doUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('sar_id', sar.sar_id);
    fd.append('document_type', 'Evidence');
    fd.append('uploaded_by', decodeURIComponent(requester));
    setUploading(true);
    try {
      await api.post('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await onRefresh();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const deleteDoc = async (id) => {
    if (!confirm('Delete this document?')) return;
    await api.delete(`/documents/${id}?user=${requester}`);
    await onRefresh();
  };

  return (
    <aside className="w-[480px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500 flex items-center gap-2">
            <span>{sar.sar_id}</span>
            <FilingTypeBadge type={sar.filing_type} />
          </div>
          <div className="text-base font-semibold text-navy-900 truncate">{sar.customer_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">Case {sar.case_id || '—'} · Alert {sar.source_alert_id || '—'}</div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge value={sar.sar_status} />
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${retention.tone}`}>
              <Clock size={12} /> {retention.label}
            </span>
            {sar.law_enforcement_hold ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">
                <Lock size={12} /> Legal Hold
              </span>
            ) : null}
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
              {sar.access_classification}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
            <div className="text-slate-500">Scenario</div><div>{sar.alert_scenario}</div>
            <div className="text-slate-500">Amount</div><div>${Number(sar.amount_involved_inr || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-slate-500">Detection</div><div>{sar.detection_date}</div>
            <div className="text-slate-500">Draft</div><div>{sar.draft_created_date}</div>
            <div className="text-slate-500">Filed</div><div>{sar.filed_date || '—'}</div>
            <div className="text-slate-500">Acknowledged</div><div>{sar.acknowledged_date || '—'}</div>
            <div className="text-slate-500">Prepared By</div><div>{sar.prepared_by || '—'}</div>
            <div className="text-slate-500">Reviewed By</div><div>{sar.reviewed_by || '—'}</div>
            <div className="text-slate-500">Approved By</div><div>{sar.approved_by || '—'}</div>
            <div className="text-slate-500">Jurisdiction</div><div>{sar.reporting_jurisdiction}</div>
            <div className="text-slate-500">Regulator Ref</div><div>{sar.regulator_reference || '—'}</div>
            <div className="text-slate-500">Retention</div><div>{sar.retention_status} · {sar.retention_expiry_date || '—'}</div>
            <div className="text-slate-500">QA Score</div><div>{sar.qa_score}</div>
            <div className="text-slate-500">Exports</div><div>{sar.export_count} (last {sar.last_exported_at || '—'})</div>
          </div>
          {sar.filing_type === 'Joint SAR' && (
            <div className="mt-3 border-l-4 border-blue-400 bg-blue-50/40 rounded-r-md p-3">
              <div className="text-xs font-semibold text-navy-900 mb-2">Co-Filer</div>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                <div className="text-slate-500">Institution</div><div>{sar.joint_filer_name || '—'}</div>
                <div className="text-slate-500">FEIN</div><div>{sar.joint_filer_fein || '—'}</div>
                <div className="text-slate-500">Address</div><div>{[sar.joint_filer_address, sar.joint_filer_city, sar.joint_filer_state, sar.joint_filer_zip].filter(Boolean).join(', ') || '—'}</div>
                <div className="text-slate-500">Contact</div><div>{sar.joint_filer_contact_name || '—'}</div>
                <div className="text-slate-500">Phone</div><div>{sar.joint_filer_contact_phone || '—'}</div>
                <div className="text-slate-500">Role</div><div>{sar.joint_filer_role || '—'}</div>
              </div>
            </div>
          )}
          {sar.filing_type === 'Continuing SAR' && (
            <div className="mt-3 border-l-4 border-orange-400 bg-orange-50/40 rounded-r-md p-3">
              <div className="text-xs font-semibold text-navy-900 mb-2">Prior SAR</div>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                <div className="text-slate-500">Continuing from</div>
                <div>
                  {sar.prior_sar_id ? (
                    <a href={`?sar_id=${encodeURIComponent(sar.prior_sar_id)}`}
                       className="text-blue-600 hover:underline font-mono">{sar.prior_sar_id}</a>
                  ) : '—'}
                </div>
                <div className="text-slate-500">Filed on</div><div>{sar.prior_sar_filing_date || '—'}</div>
                <div className="text-slate-500">Activity From</div><div>{sar.continuing_activity_from || '—'}</div>
                <div className="text-slate-500">Activity To</div><div>{sar.continuing_activity_to || '—'}</div>
              </div>
              {sar.changes_since_prior_sar && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Changes Since Prior SAR</div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded p-2">{sar.changes_since_prior_sar}</div>
                </div>
              )}
            </div>
          )}
          {sar.narrative_summary && (
            <div className="mt-3 p-3 rounded bg-slate-50 text-xs text-slate-700 leading-relaxed">
              <div className="font-semibold text-slate-900 mb-1">Narrative</div>
              {sar.narrative_summary}
            </div>
          )}
        </section>

        <section className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-navy-900">
              Supporting Documents <span className="text-xs text-slate-500">({sar.documents.length})</span>
            </div>
            {!readOnly && (
              <button
                onClick={() => fileInput.current?.click()}
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                disabled={uploading}
              >
                <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
              </button>
            )}
            <input ref={fileInput} type="file" className="hidden" onChange={doUpload} />
          </div>
          <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {sar.documents.map(d => (
              <li key={d.id} className="flex items-center justify-between p-2 rounded border border-slate-100 text-xs hover:bg-slate-50">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-slate-400 shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-navy-900 truncate">{d.document_name}</div>
                    <div className="text-slate-500">{d.document_type || '-'} · {Math.round(d.file_size/1024)} KB</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <a href={`/api/documents/${d.id}?user=${requester}`}
                     className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Download">
                    <Download size={13} />
                  </a>
                  {!readOnly && (
                    <button onClick={() => deleteDoc(d.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
            {sar.documents.length === 0 && (
              <li className="text-xs text-slate-400 py-3 text-center">No documents attached</li>
            )}
          </ul>
        </section>

        <section className="px-5 py-4 border-b border-slate-100">
          <div className="text-sm font-semibold text-navy-900 mb-2">Audit Trail</div>
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {sar.audit_trail.map(a => (
              <li key={a.id} className="ml-4">
                <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500 mt-1.5" />
                <div className="text-xs font-medium text-navy-900">{a.action}</div>
                <div className="text-[11px] text-slate-500">
                  {a.timestamp} · {a.performed_by || '—'}
                </div>
                {a.details && <div className="text-xs text-slate-600 mt-0.5">{a.details}</div>}
              </li>
            ))}
            {sar.audit_trail.length === 0 && (
              <li className="ml-4 text-xs text-slate-400">No audit events</li>
            )}
          </ol>
        </section>
      </div>

      <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
        <a
          href={`/api/sars/${sar.sar_id}/export?requested_by=${requester}&purpose=Regulator%20request`}
          className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
        >
          <Package size={14} /> Export Package
        </a>
      </div>
    </aside>
  );
}

function caseStatusGroup(c, sar) {
  if (sar?.sar_status === 'Filed' || c.case_status === 'Filed')                   return 'Filed';
  if (sar?.sar_status === 'Pending Review' || c.case_status === 'Pending Review') return 'Pending Review';
  if (c.case_status === 'Closed')                                                  return 'Closed';
  if (!c.assigned_to)                                                              return 'Unassigned';
  return 'In Progress';
}

function dueLabel(createdDate) {
  if (!createdDate) return { label: '—', tone: 'text-slate-500' };
  const days = Math.round((Date.now() - new Date(createdDate)) / 86400000);
  const remaining = 30 - days;
  if (remaining < 0)  return { label: `${Math.abs(remaining)}d overdue`, tone: 'text-red-600 font-semibold' };
  if (remaining <= 5) return { label: `${remaining}d left`, tone: 'text-orange-600' };
  return { label: `${remaining}d left`, tone: 'text-green-700' };
}

function EmployeeSarCases() {
  const { currentAnalyst } = useRole();
  const { openTab } = useInvestigationTabs();
  const { goTo } = useRoleNavigate();

  const [cases, setCases] = useState([]);
  const [filings, setFilings] = useState({});
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    const params = {};
    if (currentAnalyst) {
      params.assigned_to = currentAnalyst;
      params.include_unassigned_for = 1;
    }
    const { data } = await api.get('/cases', { params });
    setCases(data);
    const filingsByCase = {};
    await Promise.all(data.map(async (c) => {
      try {
        const { data: f } = await api.get(`/sar-filings/by-case/${encodeURIComponent(c.case_id)}`);
        filingsByCase[c.case_id] = f;
      } catch (_e) { /* no filing yet */ }
    }));
    setFilings(filingsByCase);
  };

  useEffect(() => { load(); }, [currentAnalyst]);

  const enriched = useMemo(() => cases.map(c => {
    const f = filings[c.case_id];
    return {
      ...c,
      filing: f || null,
      status_group: caseStatusGroup(c, f),
      sla: dueLabel(c.created_date)
    };
  }), [cases, filings]);

  const visible = useMemo(() => enriched.filter(c => {
    if (statusFilter && c.status_group !== statusFilter) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (!(c.case_id.toLowerCase().includes(needle) ||
            (c.customer_name || '').toLowerCase().includes(needle) ||
            (c.source_alert_id || '').toLowerCase().includes(needle))) return false;
    }
    if (from && c.created_date && c.created_date < from) return false;
    if (to   && c.created_date && c.created_date > to)   return false;
    return true;
  }), [enriched, statusFilter, q, from, to]);

  const counts = useMemo(() => {
    const g = { total: enriched.length, Unassigned: 0, 'In Progress': 0, 'Pending Review': 0, Filed: 0, Closed: 0 };
    enriched.forEach(c => { g[c.status_group] = (g[c.status_group] || 0) + 1; });
    return g;
  }, [enriched]);

  const openCase = async (c) => {
    if (!c.source_alert_id) {
      goTo(`sar-filing/${c.case_id}`);
      return;
    }
    try {
      const { data: alert } = await api.get(`/alerts/${c.source_alert_id}`);
      openTab(alert);
      goTo('alerts');
    } catch (_e) { goTo('alerts'); }
  };

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <div className="text-xl font-bold text-navy-900">SAR Repository · My Cases</div>
        <div className="text-sm text-slate-500">
          {currentAnalyst} — {counts.total} SAR cases · 30-day filing SLA
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Total"         value={counts.total}              icon={Inbox} />
        <KpiCard label="Unassigned"    value={counts.Unassigned}         icon={Activity}    tone="orange" />
        <KpiCard label="In Progress"   value={counts['In Progress']}     icon={Briefcase}   tone="blue" />
        <KpiCard label="Pending Review" value={counts['Pending Review']} icon={Send}        tone="orange" />
        <KpiCard label="Filed"         value={counts.Filed}              icon={CheckCircle2} tone="green" />
        <KpiCard label="Closed"        value={counts.Closed}             icon={X} />
      </div>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search by Case ID, customer name, alert ID"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All status</option>
            <option>Unassigned</option>
            <option>In Progress</option>
            <option>Pending Review</option>
            <option>Filed</option>
            <option>Closed</option>
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-2" />
          <span className="text-xs text-slate-400">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-2" />
        </div>
      </Card>

      <Card bodyClassName="p-0">
        <Table
          rows={visible}
          emptyMessage="No SAR cases match"
          columns={[
            { key: 'case_id', label: 'Case ID',
              render: r => <span className="font-mono text-xs text-navy-900 font-medium">{r.case_id}</span> },
            { key: 'source_alert_id', label: 'Linked Alert',
              render: r => r.source_alert_id ? <span className="font-mono text-xs">{r.source_alert_id}</span> : '—' },
            { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
            { key: 'assigned_to', label: 'Assigned',
              render: r => r.assigned_to || <span className="italic text-slate-400">Unassigned</span> },
            { key: 'status_group', label: 'Status',
              render: r => <Badge value={r.status_group} /> },
            { key: 'created_date', label: 'Created' },
            { key: 'sla', label: 'SLA Due',
              render: r => <span className={`text-xs ${r.sla.tone}`}><Clock size={11} className="inline mr-1" />{r.sla.label}</span> },
            { key: 'actions', label: '',
              render: r => (
                <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openCase(r)}
                    title="Open Case"
                    className="px-2 py-1 rounded text-xs border border-slate-200 hover:border-blue-400 hover:text-blue-600 inline-flex items-center gap-1">
                    <FolderOpen size={12} /> Open
                  </button>
                  {!r.filing || r.filing?.sar_status === 'Draft' ? (
                    <button onClick={() => goTo(`sar-filing/${r.case_id}`)}
                      title="File SAR"
                      className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
                      <FileText size={12} /> {r.filing ? 'Resume' : 'File SAR'}
                    </button>
                  ) : (
                    <button onClick={() => goTo(`sar-filing/${r.case_id}?view=1`)}
                      title="View SAR"
                      className="px-2 py-1 rounded text-xs border border-green-300 text-green-700 hover:bg-green-50 inline-flex items-center gap-1">
                      <Eye size={12} /> View SAR
                    </button>
                  )}
                </div>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}
