import { CheckCircle2 } from 'lucide-react';
import { dispositionBadge, formatClosedAt, resolutionTime } from '../../utils/alertStatus.js';

export default function OutcomeCard({ alert }) {
  const disp = dispositionBadge(alert.disposition);
  const closedAt = formatClosedAt(alert);
  const resolution = resolutionTime(alert);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/70">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-slate-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Outcome</span>
      </div>
      <div className="px-3 py-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Disposition</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${disp.tone}`}>{disp.label}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Closed by</span>
          <span className="text-navy-900 font-medium">{alert.assigned_to || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Closed on</span>
          <span className="text-navy-900 font-medium">{closedAt || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Resolution time</span>
          <span className="text-navy-900 font-medium">{resolution ? resolution.label : '—'}</span>
        </div>
      </div>
    </div>
  );
}
