import { useEffect, useState, useRef } from 'react';
import api from '../api/client.js';
import Badge from '../components/shared/Badge.jsx';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import {
  Search, Download, FileText, Upload, X, Trash2, Package, Clock, AlertCircle, Lock
} from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';

const STATUSES = ['', 'Draft', 'Under Review', 'Filed', 'Acknowledged'];
const RETENTION = ['', 'Pending Filing', 'Active', 'Legal Hold'];

function retentionUrgency(expiry) {
  if (!expiry) return { label: 'Pending filing', tone: 'bg-slate-100 text-slate-600' };
  const days = Math.round((new Date(expiry) - new Date()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'bg-red-100 text-red-700' };
  if (days <= 30) return { label: `${days}d to expire`, tone: 'bg-red-100 text-red-700' };
  if (days <= 90) return { label: `${days}d to expire`, tone: 'bg-orange-100 text-orange-700' };
  return { label: `${days}d`, tone: 'bg-green-100 text-green-700' };
}

export default function SARRepository() {
  const { isManager, currentAnalyst } = useRole();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sar_status, setSarStatus] = useState('');
  const [retention_status, setRetentionStatus] = useState('');
  const [selected, setSelected] = useState(null);

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

  const openSar = async (row) => {
    const { data } = await api.get(`/sars/${row.sar_id}`);
    setSelected(data);
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const { data } = await api.get(`/sars/${selected.sar_id}`);
    setSelected(data);
  };

  const requester = encodeURIComponent(isManager ? 'Compliance Manager' : (currentAnalyst || 'rakshit.sapra@crowe.com'));

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold text-navy-900">SAR Repository</div>
            <div className="text-sm text-slate-500">
              Control #3 · {total} SARs · FIU-IND jurisdiction · 5-year retention
              {isManager && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Manager — read-only</span>}
            </div>
          </div>
        </div>

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
              { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs text-navy-900 font-medium' },
              { key: 'filed_date', label: 'Filed', render: r => r.filed_date || <span className="italic text-slate-400">{r.draft_created_date}</span> },
              { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
              { key: 'case_id', label: 'Case ID', render: r => r.case_id || '—' },
              { key: 'sar_status', label: 'Status', render: r => <Badge value={r.sar_status} /> },
              { key: 'amount_involved_inr', label: 'Amount', render: r => `₹${Number(r.amount_involved_inr || 0).toLocaleString('en-IN')}` },
              { key: 'current_owner', label: 'Owner' },
              {
                key: 'retention_expiry_date', label: 'Retention',
                render: r => {
                  const s = retentionUrgency(r.retention_expiry_date);
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
          isManager={isManager}
          requester={requester}
        />
      )}
    </div>
  );
}

function SarDetail({ sar, onClose, onRefresh, isManager, requester }) {
  const fileInput = useRef();
  const [uploading, setUploading] = useState(false);
  const retention = retentionUrgency(sar.retention_expiry_date);

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
          <div className="text-xs font-mono text-slate-500">{sar.sar_id}</div>
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
            <div className="text-slate-500">Amount</div><div>₹{Number(sar.amount_involved_inr).toLocaleString('en-IN')}</div>
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
            {!isManager && (
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
                  {!isManager && (
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
        <button className="text-sm border border-slate-300 hover:border-slate-400 rounded-md px-3 py-2 inline-flex items-center gap-1">
          <AlertCircle size={14} /> Flag
        </button>
      </div>
    </aside>
  );
}
