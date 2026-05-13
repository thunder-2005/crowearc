import { useEffect, useState } from 'react';
import { FileCheck, UserCheck, Shield, CornerUpLeft, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../api/client.js';
import { useRoleNavigate } from '../../state/useRoleNavigate.js';

// "Your Queue Today" — manager-only worklist band that sits above the
// KPI grid on the dashboard. Five action counts fetched in parallel
// from GET /api/dashboard/worklist. Auto-refreshes every 60 seconds.
//
// Card states:
//   count = 0          → blue left border, grey number, "No items"
//   count > 0          → amber left border, amber number, "Oldest: Xd"
//   urgent = true      → red left border, red number, same age line

const CARD_CONFIG = [
  {
    key: 'sars_pending_approval',
    icon: FileCheck,
    label: 'SARs Pending Approval',
    path: 'sar-approvals',
    ageMode: 'oldest'
  },
  {
    key: 'kyc_pending_approval',
    icon: UserCheck,
    label: 'KYC Reviews Pending',
    path: 'kyc-reviews',
    ageMode: 'oldest'
  },
  {
    key: 'ofac_pending_review',
    icon: Shield,
    label: 'OFAC Matches to Review',
    path: 'customers',
    ageMode: 'oldest'
  },
  {
    key: 'alerts_returned_from_l2',
    icon: CornerUpLeft,
    label: 'Returned from L2',
    path: 'alerts',
    ageMode: 'most_recent'
  },
  {
    // PR — Alert Reopen workflow. Swapped from the now-placeholder
    // 'Active Legal Holds' slot. Fetched separately from /reopen-requests
    // and merged into `data` under this key so the existing render code
    // keeps working unchanged.
    key: 'reopen_requests_pending_manager',
    icon: RotateCcw,
    label: 'Reopen Requests',
    path: 'reopen-requests',
    ageMode: 'oldest'
  }
];

function ageText(card, ageMode) {
  if (!card || card.count === 0) {
    if (ageMode === 'none') return card?.not_implemented ? 'Coming soon' : 'No items';
    return 'No items';
  }
  if (ageMode === 'oldest') {
    const d = card.oldest_days;
    if (d == null) return 'In queue';
    return `Oldest: ${d}d`;
  }
  if (ageMode === 'most_recent' && card.most_recent) {
    const ms = Date.now() - new Date(card.most_recent).getTime();
    const days = Math.max(0, Math.round(ms / 86400000));
    return `${days === 0 ? 'Today' : days + 'd ago'}`;
  }
  return '';
}

function lastUpdatedLabel(d) {
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Updated ${hh}:${mm}`;
}

export default function WorklistBand() {
  const { goTo } = useRoleNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [worklist, reopen] = await Promise.all([
          api.get('/dashboard/worklist'),
          api.get('/reopen-requests', { params: { status: 'pending_manager' } })
        ]);
        if (cancelled) return;
        const reopenRows = reopen.data?.requests || [];
        const oldest = reopenRows.length
          ? Math.max(0, Math.floor((Date.now() - new Date(reopenRows[reopenRows.length - 1].requested_at).getTime()) / 86400000))
          : null;
        const merged = {
          ...worklist.data,
          reopen_requests_pending_manager: {
            count: reopenRows.length,
            oldest_days: oldest,
            label: 'Reopen requests pending manager review',
            urgent: reopenRows.length > 0 && oldest != null && oldest >= 2
          }
        };
        setData(merged);
        setError(false);
        setLastUpdated(new Date());
      } catch (_e) {
        if (cancelled) return;
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const allClear = !!data && CARD_CONFIG.every(c => (data[c.key]?.count || 0) === 0);

  return (
    <section aria-label="Your queue today">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">Your Queue Today</h2>
          <p className="text-xs text-slate-500 mt-0.5">Actions requiring your attention</p>
        </div>
        <div className="text-xs text-slate-500">
          {error ? null : lastUpdatedLabel(lastUpdated)}
        </div>
      </header>

      {error && (
        <div className="bg-white border border-slate-200 rounded-md px-4 py-3 text-xs text-slate-500">
          Queue data unavailable — refresh to try again.
        </div>
      )}

      {!error && loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {!error && !loading && allClear && (
        <div
          className="flex items-center gap-2 bg-green-50 rounded-md px-4 py-3 text-sm text-green-800"
          style={{ borderLeft: '4px solid #16A34A' }}
        >
          <CheckCircle2 size={18} className="text-green-600 shrink-0" />
          <span>Your queue is clear — no items require your attention.</span>
        </div>
      )}

      {!error && !loading && !allClear && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {CARD_CONFIG.map(cfg => {
            const card = data?.[cfg.key] || { count: 0 };
            return (
              <WorklistCard
                key={cfg.key}
                cfg={cfg}
                card={card}
                onClick={() => goTo(cfg.path)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorklistCard({ cfg, card, onClick }) {
  const count = Number(card.count || 0);
  const Icon = cfg.icon;
  const urgent = card.urgent === true;
  const empty = count === 0;

  // Left-border + number colour gradient from "all clear" (blue) →
  // "action required" (amber) → "urgent / overdue" (red).
  let borderColor, numberClass, iconClass;
  if (empty) {
    borderColor = '#3B82F6';
    numberClass = 'text-slate-400';
    iconClass = 'text-slate-400';
  } else if (urgent) {
    borderColor = '#DC2626';
    numberClass = 'text-red-600';
    iconClass = 'text-red-600';
  } else {
    borderColor = '#F59E0B';
    numberClass = 'text-amber-600';
    iconClass = 'text-amber-600';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-slate-200 hover:border-[#BFDBFE] cursor-pointer transition-all duration-200 ease-in-out"
      style={{ borderRadius: 10, borderLeftWidth: 4, borderLeftColor: borderColor, padding: '12px 14px' }}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={iconClass} />
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">
          {cfg.label}
        </span>
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${numberClass}`}>{count}</div>
      <div className="mt-0.5 text-xs text-slate-500 inline-flex items-center gap-1">
        {ageText(card, cfg.ageMode)}
        {card.not_implemented && empty && (
          <span className="ml-1 px-1.5 py-0.5 text-[9px] uppercase font-semibold bg-slate-100 text-slate-600 rounded">
            Not built yet
          </span>
        )}
        {urgent && !empty && (
          <AlertTriangle size={11} className="text-red-600" />
        )}
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div
      className="bg-white border border-slate-200 animate-pulse"
      style={{ borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E2E8F0', padding: '12px 14px', minHeight: 92 }}
    >
      <div className="h-2 w-24 bg-slate-200 rounded mb-3" />
      <div className="h-7 w-10 bg-slate-200 rounded mb-2" />
      <div className="h-2 w-16 bg-slate-100 rounded" />
    </div>
  );
}
