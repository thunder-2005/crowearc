import { useState } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Activity, Shield, Database, Users } from 'lucide-react';

// HealthStrip — program-health summary surfaced between WorklistBand and
// the KPI grid. Reads stats.health from /api/dashboard/stats. Manager-only.
//
// Pills: OFAC · Background Jobs · Retention · KYC Queue.
// When all four are 'ok' the entire strip collapses to a single quiet
// line so it doesn't add visual noise. When any pill goes 'warning' or
// 'error' the strip expands and the affected pill shows its message.

const PILL_META = {
  ofac:            { label: 'OFAC',              icon: Shield },
  background_jobs: { label: 'Background Jobs',   icon: Activity },
  retention:       { label: 'Retention',         icon: Database },
  kyc_queue:       { label: 'KYC Queue',         icon: Users }
};

const ORDER = ['ofac', 'background_jobs', 'retention', 'kyc_queue'];

function pillTone(status) {
  switch (status) {
    case 'ok':      return { dot: '#16A34A', bg: 'bg-white border-slate-200', text: 'text-slate-700', glyph: <span className="text-green-500">●</span> };
    case 'warning': return { dot: '#F59E0B', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-900', glyph: <AlertTriangle size={11} className="text-amber-600" /> };
    case 'error':   return { dot: '#DC2626', bg: 'bg-red-50 border-red-200',     text: 'text-red-800',   glyph: <AlertCircle size={11} className="text-red-600" /> };
    default:        return { dot: '#94A3B8', bg: 'bg-white border-slate-200',     text: 'text-slate-500', glyph: <span className="text-slate-400">●</span> };
  }
}

export default function HealthStrip({ health }) {
  const [expandedKey, setExpandedKey] = useState(null);
  if (!health) return null;

  const allOk = ORDER.every(k => health[k]?.status === 'ok');

  // All-green compact state: single quiet line, no per-pill detail.
  if (allOk) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500 -mt-1">
        <CheckCircle2 size={12} className="text-green-500" />
        <span>All systems healthy</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ORDER.map(key => {
        const block = health[key] || { status: 'unknown' };
        const meta = PILL_META[key];
        const tone = pillTone(block.status);
        const Icon = meta.icon;
        const expanded = expandedKey === key;
        const hasDetail = block.status !== 'ok' && (block.message || (block.status === 'error'));

        return (
          <button
            key={key}
            type="button"
            onClick={() => hasDetail ? setExpandedKey(expanded ? null : key) : null}
            className={`inline-flex items-center gap-1.5 border rounded-full text-xs ${tone.bg} ${tone.text} ${hasDetail ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'} transition-shadow`}
            style={{ padding: '4px 10px' }}
          >
            {tone.glyph}
            <Icon size={11} className="opacity-70" />
            <span className="font-medium">{meta.label}</span>
            {block.status === 'warning' && pillCount(key, block)}
            {block.status === 'error' && (
              <span className="font-semibold">· {block.message || 'attention needed'}</span>
            )}
            {expanded && block.message && (
              <span className="ml-1 text-[11px] opacity-80">→ open queue</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function pillCount(key, block) {
  if (key === 'ofac' && block.pending_adjudications > 0) return <span>· {block.pending_adjudications} pending</span>;
  if (key === 'retention' && block.expiring_within_30_days > 0) return <span>· {block.expiring_within_30_days} expiring 30d</span>;
  if (key === 'kyc_queue' && block.overdue_count > 0) return <span>· {block.overdue_count} overdue</span>;
  if (key === 'background_jobs' && block.message) return <span>· {block.message}</span>;
  return null;
}
