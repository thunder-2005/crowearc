import { useEffect, useMemo, useState } from 'react';
import {
  Mail, Plus, X, ArrowDownToLine, ArrowUpFromLine, Loader2, AlertTriangle, CheckCircle2
} from 'lucide-react';
import api from '../api/client.js';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import Card from '../components/shared/Card.jsx';

// BSA Officer — Regulatory Correspondence Log.
// One unified surface for inbound/outbound communications with regulators:
//   314(a) information requests, legal-hold letters, exam correspondence,
//   MRAs (Matter Requiring Attention), subpoenas, and general comms.
// Replaces the two "Coming soon" cards (Legal Holds + 314(a)) previously
// shown on the BSA action queue.

const TYPE_OPTIONS = [
  { value: '314a_request', label: '314(a) Request',   tone: 'bg-blue-100 text-blue-700' },
  { value: 'legal_hold',   label: 'Legal Hold',       tone: 'bg-red-100 text-red-700' },
  { value: 'examination',  label: 'Examination',      tone: 'bg-purple-100 text-purple-700' },
  { value: 'mra',          label: 'MRA',              tone: 'bg-orange-100 text-orange-700' },
  { value: 'subpoena',     label: 'Subpoena',         tone: 'bg-red-100 text-red-700' },
  { value: 'general',      label: 'General',          tone: 'bg-slate-100 text-slate-700' }
];

const STATUS_OPTIONS = [
  { value: 'open',         label: 'Open',         tone: 'bg-red-50 text-red-700 border border-red-200' },
  { value: 'in_progress',  label: 'In Progress',  tone: 'bg-amber-50 text-amber-700 border border-amber-200' },
  { value: 'responded',    label: 'Responded',    tone: 'bg-blue-50 text-blue-700 border border-blue-200' },
  { value: 'closed',       label: 'Closed',       tone: 'bg-green-50 text-green-700 border border-green-200' }
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', tone: 'bg-red-100 text-red-700' },
  { value: 'high',   label: 'High',   tone: 'bg-orange-100 text-orange-700' },
  { value: 'normal', label: 'Normal', tone: 'bg-slate-100 text-slate-700' },
  { value: 'low',    label: 'Low',    tone: 'bg-slate-50 text-slate-500' }
];

const typeLabel    = (v) => TYPE_OPTIONS.find(t => t.value === v)?.label    || v;
const typeTone     = (v) => TYPE_OPTIONS.find(t => t.value === v)?.tone     || 'bg-slate-100 text-slate-700';
const statusLabel  = (v) => STATUS_OPTIONS.find(s => s.value === v)?.label  || v;
const statusTone   = (v) => STATUS_OPTIONS.find(s => s.value === v)?.tone   || 'bg-slate-50 text-slate-700 border border-slate-200';
const priorityLabel = (v) => PRIORITY_OPTIONS.find(p => p.value === v)?.label || v;
const priorityTone  = (v) => PRIORITY_OPTIONS.find(p => p.value === v)?.tone  || 'bg-slate-100 text-slate-700';

function fmtDate(d) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.slice(0, 10) : d;
  return s;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function DueCell({ dueDate }) {
  if (!dueDate) return <span className="text-slate-400">—</span>;
  const d = daysUntil(dueDate);
  if (d == null) return <span className="text-slate-400">—</span>;
  if (d < 0)   return <span className="text-red-700 font-semibold">{Math.abs(d)}d overdue</span>;
  if (d === 0) return <span className="text-red-700 font-semibold">Due today</span>;
  if (d <= 7)  return <span className="text-amber-700 font-medium">Due in {d}d</span>;
  return <span className="text-slate-600">{fmtDate(dueDate)}</span>;
}

export default function BsaRegulatoryCorrespondence() {
  const { currentUser } = useRole();
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  // filters
  const [typeFilter, setTypeFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const [list, sum] = await Promise.all([
        api.get('/bsa/regulatory-correspondence'),
        api.get('/bsa/regulatory-correspondence/summary')
      ]);
      setRows(list.data || []);
      setSummary(sum.data || null);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r =>
    (!typeFilter || r.type === typeFilter) &&
    (!directionFilter || r.direction === directionFilter) &&
    (!statusFilter || r.status === statusFilter)
  ), [rows, typeFilter, directionFilter, statusFilter]);

  const refreshAfterChange = async () => { await load(); };

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-16 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading correspondence…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-navy-900">Regulatory Correspondence</h1>
          <p className="text-sm text-slate-500 mt-0.5">Inbound and outbound communications with regulators</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 shadow-sm"
        >
          <Plus size={14} /> New Record
        </button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryPill label="Open"     value={summary?.total_open ?? 0}      tone="red" />
        <SummaryPill label="Urgent"   value={summary?.urgent_count ?? 0}    tone="orange" />
        <SummaryPill label="Overdue"  value={summary?.overdue_count ?? 0}   tone="red" />
        <SummaryPill label="Closed This Year" value={summary?.closed_this_year ?? 0} tone="green" />
      </div>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterRow
            label="Type"
            options={[{ value: '', label: 'All' }, ...TYPE_OPTIONS]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
          <FilterRow
            label="Direction"
            options={[
              { value: '',         label: 'All' },
              { value: 'inbound',  label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' }
            ]}
            value={directionFilter}
            onChange={setDirectionFilter}
          />
          <FilterRow
            label="Status"
            options={[{ value: '', label: 'All' }, ...STATUS_OPTIONS]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <div className="ml-auto text-xs text-slate-500">
            {filtered.length} of {rows.length} records
          </div>
        </div>
      </Card>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left py-2 px-3 font-semibold">ID</th>
              <th className="text-left py-2 px-3 font-semibold">Type</th>
              <th className="text-left py-2 px-3 font-semibold">Dir</th>
              <th className="text-left py-2 px-3 font-semibold">Agency</th>
              <th className="text-left py-2 px-3 font-semibold">Subject</th>
              <th className="text-left py-2 px-3 font-semibold">Received</th>
              <th className="text-left py-2 px-3 font-semibold">Due</th>
              <th className="text-left py-2 px-3 font-semibold">Status</th>
              <th className="text-left py-2 px-3 font-semibold">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(r => (
              <tr
                key={r.id}
                onClick={() => setSelected(r)}
                className="hover:bg-blue-50 cursor-pointer"
              >
                <td className="px-3 py-2 font-mono text-xs text-navy-900">{r.correspondence_id}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${typeTone(r.type)}`}>
                    {typeLabel(r.type)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.direction === 'inbound'
                    ? <ArrowDownToLine size={14} className="text-slate-500" />
                    : <ArrowUpFromLine size={14} className="text-blue-600" />}
                </td>
                <td className="px-3 py-2 text-slate-700">{r.agency}</td>
                <td className="px-3 py-2 text-navy-900 max-w-[400px] truncate">{r.subject}</td>
                <td className="px-3 py-2 text-slate-600">{fmtDate(r.received_or_sent_date)}</td>
                <td className="px-3 py-2"><DueCell dueDate={r.response_due_date} /></td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${statusTone(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${priorityTone(r.priority)}`}>
                    {priorityLabel(r.priority)}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-8 text-sm">No records match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <DetailPanel
          record={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => { await refreshAfterChange(); }}
          currentUser={currentUser}
          push={push}
        />
      )}

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await refreshAfterChange(); push('Correspondence record created', 'success'); }}
          currentUser={currentUser}
          push={push}
        />
      )}
    </div>
  );
}

function SummaryPill({ label, value, tone }) {
  const map = {
    red:    'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    green:  'bg-green-50 text-green-700 border-green-200',
    slate:  'bg-slate-50 text-slate-700 border-slate-200'
  };
  return (
    <div className={`rounded-md border px-4 py-3 ${map[tone] || map.slate}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-slate-200 rounded px-2 py-1 bg-white text-xs"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ──────────────────── Detail panel (right-side slide-in) ──────────────────────

function DetailPanel({ record, onClose, onChanged, currentUser, push }) {
  const [editing, setEditing] = useState({
    status:            record.status,
    notes:             record.notes || '',
    handled_by:        record.handled_by || '',
    response_due_date: record.response_due_date ? record.response_due_date.slice(0, 10) : '',
    priority:          record.priority,
    linked_sar_id:     record.linked_sar_id || ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing({
      status:            record.status,
      notes:             record.notes || '',
      handled_by:        record.handled_by || '',
      response_due_date: record.response_due_date ? record.response_due_date.slice(0, 10) : '',
      priority:          record.priority,
      linked_sar_id:     record.linked_sar_id || ''
    });
  }, [record.id]);

  const save = async (overrides = {}) => {
    const payload = { ...editing, ...overrides };
    setSaving(true);
    try {
      await api.patch(`/bsa/regulatory-correspondence/${record.id}`, payload);
      push('Updated', 'success', 2000);
      await onChanged();
    } catch (e) {
      push(`Save failed: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setSaving(false);
    }
  };

  const markResponded = () => save({ status: 'responded' });
  const markClosed    = () => save({ status: 'closed' });

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 bottom-0 w-[480px] bg-white border-l border-slate-200 shadow-xl overflow-y-auto"
      >
        <header className="flex items-start justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <div className="text-xs font-mono text-slate-500">{record.correspondence_id}</div>
            <div className="text-base font-semibold text-navy-900 truncate">{record.subject}</div>
            <div className="text-xs text-slate-500 mt-1">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeTone(record.type)}`}>
                {typeLabel(record.type)}
              </span>
              {' · '}
              {record.direction === 'inbound' ? 'Inbound from' : 'Outbound to'} {record.agency}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 shrink-0">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4 text-sm">
          <Section title="Details">
            <Row k="Reference #" v={record.reference_number || '—'} />
            <Row k="Received / Sent" v={fmtDate(record.received_or_sent_date)} />
            <Row k="Linked Alert" v={record.linked_alert_id || '—'} />
            <Row k="Created By" v={record.created_by || '—'} />
            <Row k="Created At" v={record.created_at ? new Date(record.created_at).toLocaleString() : '—'} />
            {record.closed_at && <Row k="Closed At" v={new Date(record.closed_at).toLocaleString()} />}
          </Section>

          <Section title="Status & Workflow">
            <Field label="Status">
              <select
                value={editing.status}
                onChange={e => setEditing(s => ({ ...s, status: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              >
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={editing.priority}
                onChange={e => setEditing(s => ({ ...s, priority: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              >
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Response Due Date">
              <input
                type="date"
                value={editing.response_due_date}
                onChange={e => setEditing(s => ({ ...s, response_due_date: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              />
            </Field>
            <Field label="Handled By">
              <input
                type="text"
                value={editing.handled_by}
                onChange={e => setEditing(s => ({ ...s, handled_by: e.target.value }))}
                placeholder="e.g. James Carter"
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              />
            </Field>
            <Field label="Linked SAR ID">
              <input
                type="text"
                value={editing.linked_sar_id}
                onChange={e => setEditing(s => ({ ...s, linked_sar_id: e.target.value }))}
                placeholder="e.g. SAR-2025-00018"
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm font-mono"
              />
            </Field>
          </Section>

          <Section title="Notes">
            <textarea
              value={editing.notes}
              onChange={e => setEditing(s => ({ ...s, notes: e.target.value }))}
              rows={5}
              placeholder="Add notes about this correspondence — handler actions, deadlines, next steps."
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
          </Section>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => save()}
              disabled={saving}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {record.status !== 'responded' && record.status !== 'closed' && (
              <button
                onClick={markResponded}
                disabled={saving}
                className="text-sm bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded px-3 py-1.5 inline-flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} /> Mark as Responded
              </button>
            )}
            {record.status !== 'closed' && (
              <button
                onClick={markClosed}
                disabled={saving}
                className="text-sm bg-white border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50 rounded px-3 py-1.5"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 text-right">{v}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-slate-700 block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ──────────────────── Create modal ──────────────────────

function CreateModal({ onClose, onCreated, currentUser, push }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type: '314a_request',
    direction: 'inbound',
    agency: '',
    subject: '',
    reference_number: '',
    received_or_sent_date: today,
    response_due_date: '',
    priority: 'normal',
    notes: '',
    linked_sar_id: ''
  });
  const [saving, setSaving] = useState(false);

  const valid = form.type && form.direction && form.agency.trim() && form.subject.trim() && form.received_or_sent_date && form.priority;

  const submit = async () => {
    if (!valid) {
      push('Type, direction, agency, subject, received date and priority are required', 'error', 4000);
      return;
    }
    setSaving(true);
    try {
      await api.post('/bsa/regulatory-correspondence', {
        ...form,
        reference_number: form.reference_number.trim() || null,
        response_due_date: form.response_due_date || null,
        notes: form.notes.trim() || null,
        linked_sar_id: form.linked_sar_id.trim() || null,
        created_by: currentUser?.name || 'BSA Officer'
      });
      await onCreated();
    } catch (e) {
      push(`Create failed: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <div className="text-sm font-semibold text-navy-900">New Correspondence Record</div>
            <div className="text-xs text-slate-500 mt-0.5">Log a regulator communication</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </header>
        <div className="p-5 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type *">
              <select
                value={form.type}
                onChange={e => setForm(s => ({ ...s, type: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              >
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Direction *">
              <div className="flex gap-3 pt-1.5">
                <label className="text-xs inline-flex items-center gap-1.5">
                  <input type="radio" checked={form.direction === 'inbound'} onChange={() => setForm(s => ({ ...s, direction: 'inbound' }))} /> Inbound
                </label>
                <label className="text-xs inline-flex items-center gap-1.5">
                  <input type="radio" checked={form.direction === 'outbound'} onChange={() => setForm(s => ({ ...s, direction: 'outbound' }))} /> Outbound
                </label>
              </div>
            </Field>
          </div>
          <Field label="Agency *">
            <input
              type="text"
              value={form.agency}
              onChange={e => setForm(s => ({ ...s, agency: e.target.value }))}
              placeholder="e.g. FinCEN, OCC, FDIC, DOJ"
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
          </Field>
          <Field label="Subject *">
            <input
              type="text"
              value={form.subject}
              onChange={e => setForm(s => ({ ...s, subject: e.target.value }))}
              placeholder="Short description of the correspondence"
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
          </Field>
          <Field label="Reference #">
            <input
              type="text"
              value={form.reference_number}
              onChange={e => setForm(s => ({ ...s, reference_number: e.target.value }))}
              placeholder="Optional regulator-issued ref number"
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Received / Sent *">
              <input
                type="date"
                value={form.received_or_sent_date}
                onChange={e => setForm(s => ({ ...s, received_or_sent_date: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              />
            </Field>
            <Field label="Response Due">
              <input
                type="date"
                value={form.response_due_date}
                onChange={e => setForm(s => ({ ...s, response_due_date: e.target.value }))}
                className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
              />
            </Field>
          </div>
          <Field label="Priority *">
            <select
              value={form.priority}
              onChange={e => setForm(s => ({ ...s, priority: e.target.value }))}
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            >
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Linked SAR ID">
            <input
              type="text"
              value={form.linked_sar_id}
              onChange={e => setForm(s => ({ ...s, linked_sar_id: e.target.value }))}
              placeholder="e.g. SAR-2025-00018"
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm font-mono"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={e => setForm(s => ({ ...s, notes: e.target.value }))}
              rows={3}
              placeholder="Additional context, handler instructions, deadlines."
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="text-sm bg-white border border-slate-300 hover:bg-slate-100 rounded px-3 py-1.5">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !valid}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {saving ? 'Saving…' : 'Save Record'}
          </button>
        </div>
      </div>
    </div>
  );
}
