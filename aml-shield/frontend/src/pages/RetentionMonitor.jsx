import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import { Clock, AlertOctagon, ShieldCheck, Calendar, Lock } from 'lucide-react';

function daysTo(d) { return Math.round((new Date(d) - new Date()) / 86400000); }

export default function RetentionMonitor() {
  const [sars, setSars] = useState([]);

  useEffect(() => {
    api.get('/sars', { params: { pageSize: 500 } }).then(r => setSars(r.data.items));
  }, []);

  const stats = useMemo(() => {
    const filed = sars.filter(s => !!s.retention_expiry_date);
    let exp90 = 0, exp30 = 0, overdue = 0, onHold = 0;
    for (const s of filed) {
      if (s.law_enforcement_hold) onHold++;
      const d = daysTo(s.retention_expiry_date);
      if (d < 0) overdue++;
      if (d <= 30 && d >= 0) exp30++;
      if (d <= 90 && d >= 0) exp90++;
    }
    return {
      total: sars.length,
      retained: filed.length,
      pendingFiling: sars.length - filed.length,
      exp90, exp30, overdue, onHold
    };
  }, [sars]);

  const sorted = useMemo(() => {
    return [...sars]
      .filter(s => s.retention_expiry_date)
      .sort((a, b) => new Date(a.retention_expiry_date) - new Date(b.retention_expiry_date));
  }, [sars]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xl font-bold text-navy-900">Retention Monitor</div>
        <div className="text-sm text-slate-500">
          Track SAR retention periods against the FIU-IND 5-year minimum.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Total SARs" value={stats.total} icon={ShieldCheck} />
        <KpiCard label="Under retention" value={stats.retained} tone="blue" icon={Calendar}
                 sub={`${stats.pendingFiling} awaiting filing`} />
        <KpiCard label="Expiring ≤ 90 days" value={stats.exp90} tone="orange" icon={Calendar} />
        <KpiCard label="Expiring ≤ 30 days" value={stats.exp30} tone="red" icon={Clock} />
        <KpiCard label="Overdue / Hold" value={`${stats.overdue} / ${stats.onHold}`} tone="red" icon={AlertOctagon}
                 sub={`${stats.onHold} legal hold`} />
      </div>

      <Card title="SARs by Retention Expiry (earliest first)" bodyClassName="p-0">
        <Table
          columns={[
            { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs font-medium text-navy-900' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'filed_date', label: 'Filed', render: r => r.filed_date || '—' },
            { key: 'retention_status', label: 'Status',
              render: r => <Badge value={r.retention_status === 'Legal Hold' ? 'Breached' : r.retention_status}>
                {r.retention_status}
              </Badge> },
            { key: 'retention_expiry_date', label: 'Expires' },
            {
              key: 'urgency', label: 'Urgency',
              render: r => {
                const d = daysTo(r.retention_expiry_date);
                let tone = 'bg-green-100 text-green-700', label = `${d}d remaining`;
                if (d < 0) { tone = 'bg-red-100 text-red-700'; label = `${Math.abs(d)}d overdue`; }
                else if (d <= 30) { tone = 'bg-red-100 text-red-700'; label = `${d}d — critical`; }
                else if (d <= 90) { tone = 'bg-orange-100 text-orange-700'; label = `${d}d — soon`; }
                return (
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${tone}`}>{label}</span>
                    {r.law_enforcement_hold ? <Lock size={13} className="text-red-500" title="Legal hold" /> : null}
                  </div>
                );
              }
            },
            { key: 'sar_status', label: 'SAR', render: r => <Badge value={r.sar_status} /> }
          ]}
          rows={sorted}
          emptyMessage="No SARs with retention dates"
        />
      </Card>
    </div>
  );
}
