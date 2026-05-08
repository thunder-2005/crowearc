import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import { Clock, AlertOctagon, ShieldCheck, Calendar, Lock } from 'lucide-react';

function daysTo(d) { return Math.round((new Date(d) - new Date()) / 86400000); }

export default function RetentionMonitor() {
  const [sars, setSars] = useState([]);
  // Manager-tunable: how many days before expiry counts as "expiring soon".
  // Default 90; the "very soon" bucket below uses warnDays / 3 (default 30).
  const [warnDays, setWarnDays] = useState(90);

  useEffect(() => {
    api.get('/sars', { params: { pageSize: 500 } }).then(r => setSars(r.data.items));
    api.get('/settings/manager').then(r => {
      const w = Number(r.data?.['sar.retention_warn_days']);
      if (Number.isFinite(w) && w > 0) setWarnDays(w);
    }).catch(() => { /* keep default */ });
  }, []);

  const verySoonDays = Math.max(1, Math.round(warnDays / 3));

  const stats = useMemo(() => {
    const filed = sars.filter(s => !!s.retention_expiry_date);
    let expSoon = 0, expVerySoon = 0, overdue = 0, onHold = 0;
    for (const s of filed) {
      if (s.law_enforcement_hold) onHold++;
      const d = daysTo(s.retention_expiry_date);
      if (d < 0) overdue++;
      if (d <= verySoonDays && d >= 0) expVerySoon++;
      if (d <= warnDays && d >= 0) expSoon++;
    }
    return {
      total: sars.length,
      retained: filed.length,
      pendingFiling: sars.length - filed.length,
      expSoon, expVerySoon, overdue, onHold
    };
  }, [sars, warnDays, verySoonDays]);

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
        <KpiCard label={`Expiring ≤ ${warnDays} days`} value={stats.expSoon} tone="orange" icon={Calendar} />
        <KpiCard label={`Expiring ≤ ${verySoonDays} days`} value={stats.expVerySoon} tone="red" icon={Clock} />
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
                else if (d <= verySoonDays) { tone = 'bg-red-100 text-red-700'; label = `${d}d — critical`; }
                else if (d <= warnDays) { tone = 'bg-orange-100 text-orange-700'; label = `${d}d — soon`; }
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
