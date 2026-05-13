import { useEffect, useState } from 'react';
import { FileCheck, RotateCcw, Shield, Lock, Clock, CheckCircle2 } from 'lucide-react';
import api from '../../api/client.js';
import { useRoleNavigate } from '../../state/useRoleNavigate.js';

// BSA Officer "Requires Your Action" band. Mirrors the manager
// WorklistBand shape but the cards reflect what only James can authorize:
//
//   1. SARs Awaiting Final Sign-off
//   2. Alert Reopen Requests (placeholder — table not built)
//   3. OFAC Confirmed Hits
//   4. Active Legal Holds (placeholder)
//   5. 314(a) Deadlines (placeholder)

export default function BsaActionQueue() {
  const { goTo } = useRoleNavigate();
  const [signoff, setSignoff] = useState(null);
  const [ofacStatus, setOfacStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [{ data: a }, { data: b }] = await Promise.all([
          api.get('/bsa/awaiting-signoff'),
          api.get('/ofac/status')
        ]);
        if (cancelled) return;
        setSignoff(a);
        setOfacStatus(b);
      } catch (_e) { /* keep null */ }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const signoffCount = Number(signoff?.count) || 0;
  const signoffOldest = signoff?.oldest_days != null ? Number(signoff.oldest_days) : null;
  const ofacConfirmed = Number(ofacStatus?.confirmed_count) || 0;

  const allClear = signoffCount === 0 && ofacConfirmed === 0;

  return (
    <section aria-label="Requires your action">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">Requires Your Action</h2>
          <p className="text-xs text-slate-500 mt-0.5">Items only you can authorize</p>
        </div>
      </header>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i}
              className="bg-white border border-slate-200 animate-pulse"
              style={{ borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E2E8F0', padding: '12px 14px', minHeight: 92 }} />
          ))}
        </div>
      )}

      {!loading && allClear && (
        <div
          className="flex items-center gap-2 bg-green-50 rounded-md px-4 py-3 text-sm text-green-800"
          style={{ borderLeft: '4px solid #16A34A' }}
        >
          <CheckCircle2 size={18} className="text-green-600 shrink-0" />
          <span>No immediate actions required</span>
        </div>
      )}

      {!loading && !allClear && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <ActionCard
            icon={FileCheck}
            label="SARs Awaiting Final Sign-off"
            count={signoffCount}
            sub={signoffCount === 0
              ? 'No items'
              : signoffOldest != null ? `Oldest: ${signoffOldest}d filed` : 'In queue'}
            urgent={signoffCount > 0}
            onClick={() => goTo('sar-approvals')}
          />
          <ActionCard
            icon={RotateCcw}
            label="Alert Reopen Requests"
            count={0}
            sub="Coming soon"
            placeholder
            onClick={() => goTo('dashboard')}
          />
          <ActionCard
            icon={Shield}
            label="OFAC Confirmed Hits"
            count={ofacConfirmed}
            sub={ofacConfirmed === 0 ? 'No items' : 'Review required'}
            urgent={ofacConfirmed > 0}
            onClick={() => goTo('customers')}
          />
          <ActionCard
            icon={Lock}
            label="Active Legal Holds"
            count={0}
            sub="Coming soon"
            placeholder
            onClick={() => goTo('sar-repository')}
          />
          <ActionCard
            icon={Clock}
            label="314(a) Deadlines"
            count={0}
            sub="Coming soon"
            placeholder
            onClick={() => goTo('dashboard')}
          />
        </div>
      )}
    </section>
  );
}

function ActionCard({ icon: Icon, label, count, sub, urgent, placeholder, onClick }) {
  const empty = count === 0;
  let border = '#3B82F6';
  let numberClass = 'text-slate-400';
  let iconClass = 'text-slate-400';
  if (!empty && urgent) {
    border = '#DC2626';
    numberClass = 'text-red-600';
    iconClass = 'text-red-600';
  } else if (!empty) {
    border = '#F59E0B';
    numberClass = 'text-amber-600';
    iconClass = 'text-amber-600';
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-slate-200 hover:border-[#BFDBFE] cursor-pointer transition-all duration-200 ease-in-out"
      style={{ borderRadius: 10, borderLeftWidth: 4, borderLeftColor: border, padding: '12px 14px' }}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={iconClass} />
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">{label}</span>
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${numberClass}`}>{count}</div>
      <div className="mt-0.5 text-xs text-slate-500 inline-flex items-center gap-1">
        {sub}
        {placeholder && empty && (
          <span className="ml-1 px-1.5 py-0.5 text-[9px] uppercase font-semibold bg-slate-100 text-slate-600 rounded">
            Not built yet
          </span>
        )}
      </div>
    </button>
  );
}
