import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import Badge from '../shared/Badge.jsx';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { useToast } from '../../state/ToastContext.jsx';
import {
  AlertCircle, Filter, Flame, FileText, MessageSquare, FolderOpen, ListChecks,
  User, Briefcase, ClipboardList, Link2, Upload, Trash2, Download, Eye, X,
  Send, ArrowRight, Loader2, Clock, ArrowUpRight, AlertTriangle, Lock
} from 'lucide-react';
import OutcomeCard from '../shared/OutcomeCard.jsx';
import OfacScreeningPanel from './OfacScreeningPanel.jsx';
import { isAlertClosed, slaSnapshot } from '../../utils/alertStatus.js';

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvestigationWorkspace({ alertId }) {
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leftTab, setLeftTab] = useState('transactions');
  const [rightTab, setRightTab] = useState('kyc');

  useEffect(() => {
    setLoading(true);
    api.get(`/alerts/${alertId}`)
      .then(r => setAlert(r.data))
      .finally(() => setLoading(false));
  }, [alertId]);

  if (loading || !alert) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading investigation workspace…
      </div>
    );
  }

  const closed = isAlertClosed(alert);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {closed && (
        <div className="bg-slate-100 border border-slate-200 rounded-md px-4 py-2.5 text-sm text-slate-700 flex items-center gap-2">
          <Lock size={14} className="text-slate-500 shrink-0" />
          <span>This alert is closed — viewing in read only mode</span>
        </div>
      )}
      {alert.returned_from_l2_at && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-md px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-yellow-700 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-yellow-800">
                Returned by L2 · {new Date(alert.returned_from_l2_at).toLocaleString()}
              </div>
              {alert.l2_return_reason && (
                <div className="text-yellow-800 mt-0.5">
                  <span className="font-medium">Reason:</span> {alert.l2_return_reason}
                </div>
              )}
              {alert.l2_return_instructions && (
                <div className="text-yellow-800 mt-0.5 whitespace-pre-wrap">
                  <span className="font-medium">L2 instructions:</span> {alert.l2_return_instructions}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-4 min-w-0 h-[calc(100vh-200px)]">
      <section className="flex-[0.65] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <LeftTabBar tab={leftTab} onChange={setLeftTab} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          {leftTab === 'transactions' && <TransactionsTab alert={alert} />}
          {leftTab === 'notes' && <CaseNotesTab alert={alert} />}
          {leftTab === 'documents' && <DocumentsTab alert={alert} />}
          {leftTab === 'activity' && <ActivityLogTab alert={alert} />}
        </div>
      </section>
      <section className="flex-[0.35] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <RightTabBar tab={rightTab} onChange={setRightTab} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rightTab === 'kyc' && <CustomerKycTab customerId={alert.customer_id} />}
          {rightTab === 'business' && <BusinessTab customerId={alert.customer_id} />}
          {rightTab === 'case' && <CaseInfoTab alert={alert} onAlertChange={setAlert} />}
          {rightTab === 'linked' && <LinkedCasesTab alert={alert} />}
        </div>
      </section>
      </div>
    </div>
  );
}

function LeftTabBar({ tab, onChange }) {
  const items = [
    { k: 'transactions', label: 'Transactions', icon: FileText },
    { k: 'notes', label: 'Case Notes', icon: MessageSquare },
    { k: 'documents', label: 'Documents', icon: FolderOpen },
    { k: 'activity', label: 'Activity Log', icon: ListChecks }
  ];
  return (
    <div className="flex border-b border-slate-200 bg-slate-50/60">
      {items.map(it => {
        const Icon = it.icon;
        const active = tab === it.k;
        return (
          <button key={it.k} onClick={() => onChange(it.k)}
            className={`px-4 py-2.5 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 ${
              active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
            }`}>
            <Icon size={14} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function RightTabBar({ tab, onChange }) {
  const items = [
    { k: 'kyc', label: 'Customer KYC', icon: User },
    { k: 'business', label: 'Business', icon: Briefcase },
    { k: 'case', label: 'Case Info', icon: ClipboardList },
    { k: 'linked', label: 'Linked', icon: Link2 }
  ];
  return (
    <div className="flex border-b border-slate-200 bg-slate-50/60">
      {items.map(it => {
        const Icon = it.icon;
        const active = tab === it.k;
        return (
          <button key={it.k} onClick={() => onChange(it.k)}
            className={`flex-1 px-2 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1 border-b-2 ${
              active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
            }`}>
            <Icon size={13} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function TransactionsTab({ alert }) {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({
    from: '', to: '', txn_type: '', min_amount: '', max_amount: '', alerted_only: false
  });
  const [expanded, setExpanded] = useState(null);
  const [customer, setCustomer] = useState(null);

  const fetchTxns = () => {
    const params = {};
    for (const k of ['from', 'to', 'txn_type', 'min_amount', 'max_amount']) {
      if (filters[k]) params[k] = filters[k];
    }
    // alerted_only is applied client-side so the summary bar can compute
    // alerted % of the full loaded set in both toggle states
    api.get(`/alerts/${alert.alert_id}/transactions`, { params })
      .then(r => setData(r.data));
  };

  useEffect(() => { fetchTxns(); }, [alert.alert_id, filters.from, filters.to, filters.txn_type, filters.min_amount, filters.max_amount]);

  useEffect(() => {
    api.get(`/customers/${alert.customer_id}`).then(r => setCustomer(r.data));
  }, [alert.customer_id]);

  if (!data || !customer) return <div className="p-8 text-center text-slate-400">Loading transactions…</div>;

  const acct = customer.accounts?.[0];

  const allTxns = data.transactions;
  const alertedTxns = allTxns.filter(t => t.is_alerted);
  const totalSum = allTxns.reduce((s, t) => s + (t.amount || 0), 0);
  const alertedSum = alertedTxns.reduce((s, t) => s + (t.amount || 0), 0);
  const alertedPct = totalSum > 0 ? ((alertedSum / totalSum) * 100).toFixed(1) : '0.0';
  const displayTxns = filters.alerted_only ? alertedTxns : allTxns;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-5 gap-3 text-xs">
        <Stat label="Customer" value={customer.customer_name} />
        <Stat label="Account" value={acct?.account_number || '—'} mono />
        <Stat label="Type" value={acct?.account_type || '—'} />
        <Stat label="Currency" value={acct?.currency || '—'} />
        <Stat label="Current balance" value={usd(acct?.current_balance)} strong />
      </div>

      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <Filter size={12} className="text-slate-400" />
        <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1" />
        <span className="text-slate-400">to</span>
        <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1" />
        <select value={filters.txn_type} onChange={e => setFilters(f => ({ ...f, txn_type: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="">All types</option><option>Credit</option><option>Debit</option>
        </select>
        <input type="number" placeholder="Min $" value={filters.min_amount}
          onChange={e => setFilters(f => ({ ...f, min_amount: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1 w-24" />
        <input type="number" placeholder="Max $" value={filters.max_amount}
          onChange={e => setFilters(f => ({ ...f, max_amount: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1 w-24" />
        <label className="inline-flex items-center gap-1 ml-auto cursor-pointer">
          <input type="checkbox" checked={filters.alerted_only}
            onChange={e => setFilters(f => ({ ...f, alerted_only: e.target.checked }))} />
          Show alerted only
        </label>
      </div>

      <div className="px-5 py-3 border-b border-slate-100">
        {filters.alerted_only ? (
          <div className="bg-slate-100 rounded-md px-4 py-3 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              <Flame size={12} className="inline mr-1 text-red-500" />
              Showing <span className="font-semibold text-navy-900">{alertedTxns.length}</span> alerted transactions
            </div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Total Alerted Amount</div>
              <div className="text-lg font-bold text-red-600 font-mono">{usd(alertedSum)}</div>
            </div>
            <div className="text-xs text-slate-600 text-right">
              <span className="font-semibold text-navy-900">{alertedPct}%</span>
              <span className="text-slate-500"> of total transaction value</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-100 rounded-md px-4 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
            <div className="flex items-center justify-between sm:block">
              <span className="text-slate-500">All Transactions</span>
              <span className="ml-2 font-semibold text-navy-900">{allTxns.length}</span>
            </div>
            <div className="flex items-center justify-between sm:block">
              <span className="text-slate-500">Total</span>
              <span className="ml-2 font-mono font-semibold text-navy-900">{usd(totalSum)}</span>
            </div>
            <div className="flex items-center justify-between sm:block">
              <span className="text-slate-500">Alerted</span>
              <span className="ml-2 font-semibold text-navy-900">{alertedTxns.length}</span>
            </div>
            <div className="flex items-center justify-between sm:block">
              <span className="text-slate-500">Alerted Sum</span>
              <span className="ml-2 font-mono font-bold text-red-600">{usd(alertedSum)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-2 py-2 text-left font-semibold">Time</th>
              <th className="px-2 py-2 text-left font-semibold">Txn ID</th>
              <th className="px-2 py-2 text-left font-semibold">Type</th>
              <th className="px-2 py-2 text-left font-semibold">Channel</th>
              <th className="px-3 py-2 text-left font-semibold">Description / Counterparty</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-3 py-2 text-right font-semibold">Balance</th>
              <th className="px-2 py-2 text-left font-semibold">Flag</th>
            </tr>
          </thead>
          <tbody>
            {displayTxns.map(t => {
              const isAlerted = !!t.is_alerted;
              const isThis = !!t.is_this_alert;
              const isOpen = expanded === t.transaction_id;
              return (
                <>
                  <tr key={t.transaction_id}
                    onClick={() => isAlerted && setExpanded(isOpen ? null : t.transaction_id)}
                    className={`border-b border-slate-100 ${isAlerted ? 'bg-red-50/60 cursor-pointer hover:bg-red-50' : ''} ${isAlerted ? 'border-l-4 border-l-red-500' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{t.txn_date}</td>
                    <td className="px-2 py-2 text-slate-500">{t.txn_time}</td>
                    <td className="px-2 py-2 font-mono text-[11px]">{t.transaction_id}</td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.txn_type === 'Credit' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {t.txn_type}
                      </span>
                    </td>
                    <td className="px-2 py-2">{t.channel}</td>
                    <td className="px-3 py-2 truncate max-w-[260px]">
                      <div className="truncate">{t.description}</div>
                      <div className="text-[10px] text-slate-500 truncate">{t.counterparty} · {t.counterparty_country}</div>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${t.txn_type === 'Credit' ? 'text-green-700' : 'text-slate-800'}`}>
                      {t.txn_type === 'Credit' ? '+' : '−'}{usd(t.amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(t.running_balance)}</td>
                    <td className="px-2 py-2">
                      {isAlerted ? (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${isThis ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}>
                          <AlertCircle size={10} /> {isThis ? 'THIS ALERT' : 'ALERTED'}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-red-50">
                      <td colSpan={9} className="px-8 py-3 text-[11px] text-slate-700">
                        <div className="grid grid-cols-3 gap-4">
                          <div><span className="text-slate-500">Rule triggered:</span> <span className="font-semibold">{t.rule_breached}</span></div>
                          <div><span className="text-slate-500">Scenario:</span> <span className="font-semibold">{t.scenario_triggered}</span></div>
                          <div><span className="text-slate-500">Risk score:</span> <span className="font-semibold">{t.risk_score}/100</span></div>
                          <div className="col-span-3 text-slate-600">
                            Linked alert: <span className="font-mono">{t.alert_id}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        {displayTxns.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-xs">No transactions match filters</div>
        )}
      </div>
    </div>
  );
}

function CaseNotesTab({ alert }) {
  const { isEmployee, currentAnalyst } = useRole();
  const closed = isAlertClosed(alert);
  const canEdit = isEmployee && !closed;
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.get(`/case-notes/${alert.alert_id}`).then(r => setNotes(r.data));
  useEffect(() => { load(); }, [alert.alert_id]);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.post('/case-notes', {
        alert_id: alert.alert_id,
        note_text: draft.trim(),
        analyst: currentAnalyst || 'Compliance Analyst'
      });
      setDraft('');
      await load();
    } finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-4">
      {canEdit ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="text-slate-500">Recording as <span className="font-semibold text-navy-900">{currentAnalyst}</span></div>
            <div className="text-slate-400">Timestamps are added on save</div>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={5}
            placeholder="Type your investigation narrative — what you checked, what the customer said, what the transaction evidence shows…"
            className="w-full text-sm border border-slate-200 rounded-md p-3 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button onClick={save} disabled={saving || !draft.trim()}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md px-4 py-2 inline-flex items-center gap-1">
              <Send size={14} /> {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 italic border border-slate-200 rounded-md p-3 bg-slate-50">
          {closed
            ? 'Alert is closed · notes are read-only.'
            : 'Manager view · notes are read-only here. Switch to Employee view to add.'}
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Timeline ({notes.length})
        </div>
        <ol className="relative border-l border-slate-200 ml-2 space-y-4">
          {notes.map(n => (
            <li key={n.id} className="ml-4">
              <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500 mt-1" />
              <div className="text-xs text-slate-500">{n.timestamp} · <span className="font-medium text-navy-900">{n.analyst}</span></div>
              <div className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap">{n.note_text}</div>
            </li>
          ))}
          {notes.length === 0 && (
            <li className="ml-4 text-sm text-slate-400">No notes yet</li>
          )}
        </ol>
      </div>
    </div>
  );
}

function DocumentsTab({ alert }) {
  const { isEmployee, currentAnalyst } = useRole();
  const closed = isAlertClosed(alert);
  const canEdit = isEmployee && !closed;
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [description, setDescription] = useState('');
  const [docType, setDocType] = useState('Screenshot');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const load = () => api.get(`/case-documents/${alert.alert_id}`).then(r => setDocs(r.data));
  useEffect(() => { load(); }, [alert.alert_id]);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alert_id', alert.alert_id);
    fd.append('document_type', docType);
    fd.append('description', description);
    fd.append('uploaded_by', currentAnalyst || 'Compliance Analyst');
    setUploading(true);
    try {
      await api.post('/case-documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDescription('');
      await load();
    } finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  const remove = async (id) => {
    if (!confirm('Delete this document?')) return;
    await api.delete(`/case-documents/${id}`);
    await load();
  };

  return (
    <div className="p-5 space-y-4">
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 bg-slate-50'
          }`}
        >
          <Upload size={24} className="mx-auto text-slate-400 mb-2" />
          <div className="text-sm font-medium text-navy-900">
            {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
          </div>
          <div className="text-xs text-slate-500 mt-1">PDF, PNG, JPG, DOCX, XLSX up to 25 MB</div>
          <input ref={inputRef} type="file" className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
            onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
        </div>
      )}

      {canEdit && (
        <div className="grid grid-cols-3 gap-2">
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="col-span-1 text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white">
            <option>Screenshot</option>
            <option>Bank Statement</option>
            <option>ID Document</option>
            <option>Court Record</option>
            <option>Internal Report</option>
            <option>Other</option>
          </select>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className="col-span-2 text-xs border border-slate-200 rounded-md px-2 py-1.5" />
        </div>
      )}

      {closed && isEmployee && (
        <div className="text-xs text-slate-500 italic border border-slate-200 rounded-md p-3 bg-slate-50">
          Alert is closed · uploads disabled.
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Evidence ({docs.length})
        </div>
        <div className="space-y-2">
          {docs.map(d => {
            const isImage = /\.(png|jpg|jpeg|gif)$/i.test(d.file_name);
            const isPdf   = /\.pdf$/i.test(d.file_name);
            return (
              <div key={d.id} className="p-3 rounded border border-slate-200 bg-white text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-navy-900 truncate">{d.file_name}</div>
                    <div className="text-[11px] text-slate-500">
                      {d.document_type} · {Math.round(d.file_size / 1024)} KB · {d.uploaded_by} · {d.uploaded_at}
                    </div>
                    {d.description && <div className="text-xs text-slate-600 mt-1">{d.description}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(isImage || isPdf) && (
                      <button onClick={() => setPreview(d)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Preview">
                        <Eye size={14} />
                      </button>
                    )}
                    <a href={`/api/case-documents/file/${d.id}`}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Download">
                      <Download size={14} />
                    </a>
                    {canEdit && (
                      <button onClick={() => remove(d.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {docs.length === 0 && (
            <div className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-md">
              No documents uploaded yet
            </div>
          )}
        </div>
      </div>

      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PreviewModal({ doc, onClose }) {
  const isImage = /\.(png|jpg|jpeg|gif)$/i.test(doc.file_name);
  const src = `/api/case-documents/file/${doc.id}?preview=1`;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-4xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-navy-900 truncate">{doc.file_name}</div>
          <div className="flex gap-2">
            <a href={`/api/case-documents/file/${doc.id}`}
              className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
              <Download size={12} /> Download
            </a>
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-50">
          {isImage
            ? <img src={src} alt={doc.file_name} className="max-w-full max-h-full mx-auto" />
            : <iframe src={src} className="w-full h-full" title={doc.file_name} />}
        </div>
      </div>
    </div>
  );
}

function ActivityLogTab({ alert }) {
  const [notes, setNotes] = useState([]);
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    api.get(`/case-notes/${alert.alert_id}`).then(r => setNotes(r.data));
    api.get(`/case-documents/${alert.alert_id}`).then(r => setDocs(r.data));
  }, [alert.alert_id]);

  const events = useMemo(() => {
    const ev = [];
    ev.push({ ts: `${alert.created_date} 00:00:00`, kind: 'Alert created',
      who: alert.created_by || 'system_tm_engine',
      detail: `Generated from ${alert.scenario} scenario, risk score ${alert.risk_score}` });
    if (alert.assigned_to) {
      ev.push({ ts: `${alert.created_date} 00:05:00`, kind: 'Alert assigned',
        who: alert.assigned_to, detail: `Routed to ${alert.assigned_to}` });
    }
    if (alert.alert_status === 'Work in Progress') {
      ev.push({ ts: `${alert.last_activity_date} 09:00:00`, kind: 'Investigation started',
        who: alert.assigned_to, detail: 'Analyst opened the investigation workspace' });
    }
    for (const n of notes) {
      ev.push({ ts: n.timestamp, kind: 'Note added', who: n.analyst,
        detail: n.note_text.slice(0, 140) + (n.note_text.length > 140 ? '…' : '') });
    }
    for (const d of docs) {
      ev.push({ ts: d.uploaded_at, kind: 'Document uploaded', who: d.uploaded_by,
        detail: `${d.file_name} (${d.document_type})` });
    }
    if (alert.disposition && alert.disposition !== 'Awaiting Triage' && alert.disposition !== 'Investigating') {
      ev.push({ ts: `${alert.last_activity_date} 11:00:00`, kind: 'Disposition set',
        who: alert.assigned_to, detail: alert.disposition });
    }
    if (alert.closed_date) {
      ev.push({ ts: `${alert.closed_date} 12:00:00`, kind: 'Alert closed',
        who: alert.assigned_to, detail: alert.disposition || 'Closed' });
    }
    if (alert.linked_sar_id) {
      ev.push({ ts: `${alert.last_activity_date} 11:30:00`, kind: 'SAR filed',
        who: alert.assigned_to, detail: `Linked SAR ${alert.linked_sar_id}` });
    }
    return ev.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  }, [alert, notes, docs]);

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Audit Trail · read only</div>
        <button
          onClick={() => window.print()}
          className="text-xs inline-flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50"
        >
          <Download size={12} /> Export as PDF
        </button>
      </div>
      <ol className="relative border-l border-slate-200 ml-2 space-y-3">
        {events.map((e, i) => (
          <li key={i} className="ml-4">
            <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500 mt-1" />
            <div className="text-xs font-medium text-navy-900">{e.kind}</div>
            <div className="text-[11px] text-slate-500">{e.ts} · {e.who || '—'}</div>
            {e.detail && <div className="text-xs text-slate-700 mt-0.5">{e.detail}</div>}
          </li>
        ))}
        {events.length === 0 && <li className="ml-4 text-xs text-slate-400">No events</li>}
      </ol>
    </div>
  );
}

function CustomerKycTab({ customerId }) {
  const [cust, setCust] = useState(null);
  useEffect(() => {
    api.get(`/customers/${customerId}`).then(r => setCust(r.data));
  }, [customerId]);
  if (!cust) return <div className="p-6 text-slate-400 text-sm">Loading KYC…</div>;
  return <KycProfileBlock c={cust} />;
}

export function KycProfileBlock({ c }) {
  const initials = (c.customer_name || '').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  return (
    <div className="p-4 space-y-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-navy-900 truncate">{c.customer_name}</div>
          <div className="text-xs text-slate-500">{c.customer_id} · {c.customer_type} · {c.segment}</div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Badge value={c.customer_risk_rating}>{c.customer_risk_rating} risk</Badge>
            {c.pep_match ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 font-semibold">PEP</span> : null}
            {c.sanctions_match ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-semibold">Sanctions Hit</span> : <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-semibold">Sanctions Clear</span>}
          </div>
        </div>
      </div>

      <Section title="Identity">
        <Row k="Legal Name" v={c.customer_name} />
        <Row k="Nationality / Country" v={c.nationality || c.country_of_incorporation || '—'} />
        <Row k="Government ID" v={`${c.government_id_type} · ${c.government_id_number}`} />
        <Row k="Customer Since" v={c.customer_since_date || '—'} />
      </Section>

      <Section title="Address">
        <Row k="Registered" v={c.residential_address} />
        <Row k="Country" v={c.country_of_residence} />
      </Section>

      <Section title="Contact">
        <Row k="Phone" v={c.phone_number} />
        <Row k="Email" v={c.email_address} />
      </Section>

      <Section title={`Accounts (${c.accounts?.length || 0})`}>
        {c.accounts?.map(a => (
          <div key={a.account_number} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div className="font-mono">{a.account_number}</div>
            <div className="text-slate-500">{a.account_type}</div>
            <div className="text-slate-500">{a.currency}</div>
            <Badge value={a.status}>{a.status}</Badge>
            <div className="text-slate-500">{a.opened_date}</div>
          </div>
        ))}
        {(!c.accounts || c.accounts.length === 0) && <div className="text-xs text-slate-400">No accounts</div>}
      </Section>

      <Section title="KYC Review">
        <Row k="Last Review" v={c.last_kyc_review_date} />
        <Row k="Next Due" v={c.next_kyc_due_date} />
        <Row k="Status" v={<span className={c.kyc_review_status === 'Overdue' ? 'text-red-600 font-semibold' : ''}>{c.kyc_review_status}</span>} />
        <Row k="CDD Level" v={c.cdd_level} />
      </Section>

      <div className="border-t border-slate-100 pt-3">
        <OfacScreeningPanel
          entityType="customer"
          entityId={c.customer_id}
          entityName={c.customer_name}
        />
      </div>
    </div>
  );
}

function BusinessTab({ customerId }) {
  const [cust, setCust] = useState(null);
  useEffect(() => {
    api.get(`/customers/${customerId}`).then(r => setCust(r.data));
  }, [customerId]);
  if (!cust) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;
  const owners   = cust.beneficial_owners || [];
  const directors = cust.directors || [];
  return (
    <div className="p-4 space-y-4 text-sm">
      <Section title="Business">
        <Row k="Legal Name" v={cust.customer_name} />
        <Row k="Trading Name" v={cust.trading_name} />
        <Row k="Registration" v={cust.registration_number} />
        <Row k="Incorporation" v={`${cust.date_of_incorporation} (${cust.country_of_incorporation})`} />
        <Row k="Business Type" v={cust.business_type} />
        <Row k="Industry" v={cust.industry} />
        <Row k="NAICS" v={cust.naics_code} />
        <Row k="Turnover" v={cust.annual_turnover_range} />
        <Row k="Employees" v={cust.number_of_employees} />
      </Section>

      <Section title={`Beneficial Owners (${owners.length})`}>
        {owners.map((o, i) => (
          <div key={i} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div className="font-medium text-navy-900">{o.name}</div>
            <div className="text-slate-500">{o.pct}%</div>
            <div className="text-slate-500">{o.nationality}</div>
          </div>
        ))}
      </Section>

      <Section title={`Directors (${directors.length})`}>
        {directors.map((d, i) => (
          <div key={i} className="text-xs border border-slate-100 rounded px-2 py-1.5">{d}</div>
        ))}
      </Section>

      <Section title="Funds & Wealth">
        <Row k="Source of Funds" v={cust.source_of_funds} />
        <Row k="Source of Wealth" v={cust.source_of_wealth} />
      </Section>

      <Section title="Expected Activity">
        <Row k="Monthly Volume" v={`${cust.expected_monthly_volume} txn`} />
        <Row k="Monthly Value" v={usd(cust.expected_monthly_value)} />
        <Row k="Txn Types" v={(cust.expected_transaction_types || []).join(', ')} />
        <Row k="Countries" v={(cust.primary_countries || []).join(', ')} />
        <Row k="Onboarding" v={cust.onboarding_notes} />
      </Section>
    </div>
  );
}

function CaseInfoTab({ alert, onAlertChange }) {
  const { isEmployee, currentAnalyst, isManager } = useRole();
  const { closeTab } = useInvestigationTabs();
  const { push: pushToast } = useToast();

  const closed = isAlertClosed(alert);
  const sla = slaSnapshot(alert);

  const [disposition, setDisposition] = useState('');
  const [modal, setModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [requireFpReason, setRequireFpReason] = useState(true);

  useEffect(() => {
    api.get('/settings/manager').then(r => {
      const v = r.data['audit.require_fp_reason'];
      setRequireFpReason(v === undefined ? true : v === true);
    }).catch(() => {});
  }, []);

  const daysLeft = useMemo(() => {
    if (!alert.sla_deadline) return null;
    return Math.round((new Date(alert.sla_deadline) - new Date()) / 86400000);
  }, [alert.sla_deadline]);

  const analyst = currentAnalyst || 'Compliance Analyst';

  const finishFalsePositive = async (reason) => {
    setSubmitting(true);
    try {
      await api.patch(`/alerts/${alert.alert_id}/disposition`, {
        disposition: 'False Positive — Closed', performed_by: analyst
      });
      const { data } = await api.patch(`/alerts/${alert.alert_id}/status`, { alert_status: 'Completed' });
      onAlertChange({ ...alert, ...data });
      await api.post('/case-notes', {
        alert_id: alert.alert_id,
        note_text: `Alert closed as False Positive by ${analyst}. Reason: ${reason || '(no reason provided)'}`,
        analyst
      });
      pushToast('Alert closed as False Positive', 'success');
      setModal(null);
      setTimeout(() => closeTab('L1:' + alert.alert_id), 2000);
    } catch (e) {
      pushToast('Failed to close alert: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  const finishEscalateL2 = async (notes) => {
    setSubmitting(true);
    try {
      // Create L2 case via backend (handles notifications + alert status update + audit)
      await api.post('/l2', {
        alert_id: alert.alert_id,
        escalated_by: analyst,
        escalation_reason: notes || ''
      });
      await api.post('/case-notes', {
        alert_id: alert.alert_id,
        note_text: `Alert escalated to Level 2 by ${analyst}.${notes ? ' Reason: ' + notes : ''}`,
        analyst
      });
      const { data: refreshed } = await api.get(`/alerts/${alert.alert_id}`);
      onAlertChange(refreshed);
      pushToast('Alert escalated to Level 2', 'success');
      setModal(null);
      setTimeout(() => closeTab('L1:' + alert.alert_id), 1500);
    } catch (e) {
      pushToast('Failed to escalate: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  const onSubmit = () => {
    if (!disposition) return;
    if (disposition === 'fp') setModal({ kind: 'fp' });
    if (disposition === 'l2') setModal({ kind: 'l2' });
  };

  return (
    <div className="p-4 space-y-4 text-sm">
      <Section title="Alert">
        <Row k="Alert ID" v={<span className="font-mono">{alert.alert_id}</span>} />
        <Row k="Scenario" v={alert.scenario} />
        <Row k="Priority" v={<Badge value={alert.priority} />} />
        <Row k="Status" v={<Badge value={alert.alert_status} />} />
        <Row k="Risk Score" v={`${alert.risk_score}/100`} />
        <Row k="Assigned" v={alert.assigned_to || '—'} />
        <Row k="Created" v={alert.created_date} />
      </Section>

      <Section title="SLA">
        <Row k="Deadline" v={alert.sla_deadline || '—'} />
        {closed
          ? <Row k="Result" v={
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${sla.tone}`}>{sla.label}</span>
            } />
          : <Row k="Countdown" v={
              <span className={`font-mono ${alert.sla_breached ? 'text-red-600 font-semibold' : daysLeft <= 3 ? 'text-orange-600' : 'text-green-700'}`}>
                <Clock size={12} className="inline mr-1" />
                {alert.due_status || (daysLeft != null ? `${daysLeft}d` : '—')}
              </span>
            } />}
      </Section>

      <Section title="Linked">
        <Row k="Case ID" v={alert.case_id || '—'} />
        <Row k="SAR ID" v={alert.linked_sar_id || '—'} />
      </Section>

      {closed && (
        <Section title="Outcome">
          <OutcomeCard alert={alert} />
        </Section>
      )}

      {isEmployee && !closed && (
        <Section title="Disposition">
          <select
            value={disposition}
            onChange={e => setDisposition(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="">— pick a disposition —</option>
            <option value="fp">False Positive — Close Alert</option>
            <option value="l2">Escalate to Level 2</option>
          </select>
          <button
            onClick={onSubmit}
            disabled={!disposition || submitting}
            className="mt-2 w-full text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <Send size={14} /> Submit Disposition
          </button>
        </Section>
      )}

      {isManager && !closed && (
        <div className="text-xs text-slate-500 italic border border-slate-200 rounded-md p-3 bg-slate-50">
          Manager view · dispose and close actions are hidden.
        </div>
      )}

      {modal?.kind === 'fp' && (
        <FalsePositiveModal
          alertId={alert.alert_id}
          requireReason={requireFpReason}
          submitting={submitting}
          onCancel={() => setModal(null)}
          onConfirm={finishFalsePositive}
        />
      )}
      {modal?.kind === 'l2' && (
        <EscalateL2Modal
          alertId={alert.alert_id}
          submitting={submitting}
          onCancel={() => setModal(null)}
          onConfirm={finishEscalateL2}
        />
      )}
    </div>
  );
}

function ModalShell({ icon: Icon, title, tone = 'blue', children, onCancel }) {
  const toneCls = {
    blue:   'bg-blue-100 text-blue-600',
    red:    'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-600'
  }[tone] || 'bg-blue-100 text-blue-600';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${toneCls}`}>
            <Icon size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-navy-900">{title}</div>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FalsePositiveModal({ alertId, requireReason, submitting, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const ready = !requireReason || reason.trim().length >= 10;
  return (
    <ModalShell icon={X} title={`Close ${alertId} as False Positive?`} tone="orange" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          This will close the alert and mark it as a false positive. The action is logged to the audit trail.
        </div>
        {requireReason && (
          <div>
            <label className="text-xs font-semibold text-slate-700">
              Reason <span className="text-red-500">*</span>
              <span className="text-slate-400 font-normal ml-1">(required by manager policy, min 10 chars)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Counterparty verified as long-standing supplier; transactions match expected business pattern."
              className="mt-1 w-full text-sm border border-slate-200 rounded-md p-2 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => onConfirm(reason.trim())}
          disabled={!ready || submitting}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
        >{submitting ? 'Closing…' : 'Confirm Close'}</button>
      </div>
    </ModalShell>
  );
}

function EscalateL2Modal({ alertId, submitting, onCancel, onConfirm }) {
  const [notes, setNotes] = useState('');
  return (
    <ModalShell icon={ArrowUpRight} title={`Escalate ${alertId} to Level 2 team?`} tone="blue" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          This will move the alert into the Level 2 queue and unassign it from you. Add optional notes for the L2 reviewer.
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Context for L2 review (transactions of interest, customer history, why escalating)."
            className="mt-1 w-full text-sm border border-slate-200 rounded-md p-2 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => onConfirm(notes.trim())}
          disabled={submitting}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
        >{submitting ? 'Escalating…' : 'Confirm Escalate'}</button>
      </div>
    </ModalShell>
  );
}

function LinkedCasesTab({ alert }) {
  const { openTab } = useInvestigationTabs();
  const [alerts, setAlerts] = useState([]);
  const [sars, setSars] = useState([]);

  useEffect(() => {
    api.get(`/customers/${alert.customer_id}/alerts`).then(r => setAlerts(r.data));
    api.get(`/customers/${alert.customer_id}/sars`).then(r => setSars(r.data));
  }, [alert.customer_id]);

  return (
    <div className="p-4 space-y-4 text-sm">
      <Section title={`Alert History (${alerts.length})`}>
        {alerts.map(a => (
          <div key={a.alert_id}
            onClick={() => a.alert_id !== alert.alert_id && openTab(a)}
            className={`flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5 ${a.alert_id === alert.alert_id ? 'bg-blue-50 border-blue-300' : 'cursor-pointer hover:bg-slate-50'}`}>
            <div>
              <div className="font-mono font-medium">{a.alert_id}</div>
              <div className="text-slate-500">{a.scenario} · {a.created_date}</div>
            </div>
            <Badge value={a.alert_status} />
          </div>
        ))}
        {alerts.length === 0 && <div className="text-xs text-slate-400">No prior alerts</div>}
      </Section>

      <Section title={`SAR History (${sars.length})`}>
        {sars.map(s => (
          <div key={s.sar_id} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div>
              <div className="font-mono font-medium">{s.sar_id}</div>
              <div className="text-slate-500">{s.alert_scenario} · {s.filed_date || 'draft'}</div>
            </div>
            <Badge value={s.sar_status} />
          </div>
        ))}
        {sars.length === 0 && <div className="text-xs text-slate-400">No SARs filed on this customer</div>}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}

function Stat({ label, value, mono = false, strong = false }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-navy-900 ${mono ? 'font-mono text-xs' : 'text-sm'} ${strong ? 'font-bold' : 'font-medium'}`}>
        {value}
      </div>
    </div>
  );
}
