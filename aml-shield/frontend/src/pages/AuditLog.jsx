import { useEffect, useState } from 'react';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import { Search, Filter } from 'lucide-react';

export default function AuditLog() {
  const [audit, setAudit] = useState([]);
  const [retrievals, setRetrievals] = useState([]);
  const [sarId, setSarId] = useState('');
  const [actionType, setActionType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    const params = {};
    if (sarId) params.sar_id = sarId;
    if (actionType) params.action = actionType;
    if (from) params.from = from;
    if (to) params.to = to;
    api.get('/retrieval-log', { params }).then(r => {
      setAudit(r.data.audit);
      setRetrievals(r.data.retrievals);
    });
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xl font-bold text-navy-900">Audit Trail / Retrieval Log</div>
        <div className="text-sm text-slate-500">
          Every access, export and modification to a SAR is recorded here.
        </div>
      </div>

      <Card bodyClassName="p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="SAR ID"
              value={sarId}
              onChange={e => setSarId(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md w-40"
            />
          </div>
          <select value={actionType} onChange={e => setActionType(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All actions</option>
            <option>Detection Logged</option>
            <option>Draft Created</option>
            <option>Submitted for Review</option>
            <option>SAR Filed</option>
            <option>Regulator Acknowledged</option>
            <option>Legal Hold Applied</option>
            <option>SAR Updated</option>
            <option>Document Uploaded</option>
            <option>Document Downloaded</option>
            <option>Document Deleted</option>
            <option>Export Package Generated</option>
            <option>Retrieval Requested</option>
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" />
          <button onClick={load}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Filter size={14} /> Apply
          </button>
        </div>
      </Card>

      <Card title={`Audit Events (${audit.length})`} subtitle="All modifications, accesses, and system events" bodyClassName="p-0">
        <Table
          columns={[
            { key: 'timestamp', label: 'Timestamp', cellClass: 'font-mono text-xs' },
            { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs font-medium text-navy-900' },
            { key: 'action', label: 'Action' },
            { key: 'performed_by', label: 'By', render: r => r.performed_by || '—' },
            { key: 'details', label: 'Details', render: r => r.details || '—' }
          ]}
          rows={audit}
          emptyMessage="No events match"
        />
      </Card>

      <Card title={`Retrieval Log (${retrievals.length})`} subtitle="Requests for SAR retrieval / export" bodyClassName="p-0">
        <Table
          columns={[
            { key: 'requested_at', label: 'Requested At', cellClass: 'font-mono text-xs' },
            { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs font-medium text-navy-900' },
            { key: 'requested_by', label: 'By' },
            { key: 'request_purpose', label: 'Purpose', render: r => r.request_purpose || '—' },
            { key: 'exported_at', label: 'Exported At', render: r => r.exported_at || '—' }
          ]}
          rows={retrievals}
          emptyMessage="No retrieval records"
        />
      </Card>
    </div>
  );
}
