import { useEffect, useState } from 'react';
import { FileCheck, RotateCcw, Shield, Mail, CheckCircle2 } from 'lucide-react';
import api from '../../api/client.js';
import { useRoleNavigate } from '../../state/useRoleNavigate.js';

// BSA Officer "Requires Your Action" band. Mirrors the manager
// WorklistBand shape but the cards reflect what only James can authorize:
//
//   1. SARs Awaiting Final Sign-off
//   2. Alert Reopen Requests
//   3. OFAC Confirmed Hits
//   4. Regulatory Correspondence (314(a), legal holds, exams, MRAs, subpoenas)
//
// Previous v1 had two separate placeholder cards for Active Legal Holds
// and 314(a) Deadlines; both are now subsumed under Regulatory Correspondence.

export default function BsaActionQueue() {
  const { goTo } = useRoleNavigate();
  const [signoff, setSignoff] = useState(null);
  const [reopen, setReopen] = useState(null);
  const [ofacStatus, setOfacStatus] = useState(null);
  const [regCorr, setRegCorr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [{ data: a }, { data: b }, { data: c }, { data: d }] = await Promise.all([
          api.get('/bsa/awaiting-signoff'),
          api.get('/ofac/status'),
          api.get('/bsa/reopen-requests'),
          api.get('/bsa/regulatory-correspondence/summary')
        ]);
        if (cancelled) return;
        setSignoff(a);
        setOfacStatus(b);
        setReopen(c);
        setRegCorr(d);
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
  const reopenCount = Number(reopen?.count) || 0;
  const reopenOldest = reopen?.oldest_days != null ? Number(reopen.oldest_days) : null;
  const regOpen = Number(regCorr?.total_open) || 0;
  const regUrgent = Number(regCorr?.urgent_count) || 0;
  const regOverdue = Number(regCorr?.overdue_count) || 0;
  const regNextDue = regCorr?.next_due?.response_due_date || null;

  const allClear = signoffCount === 0 && ofacConfirmed === 0 && reopenCount === 0 && regOpen === 0;

  return (
    <section aria-label="Requires your action">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">Requires Your Action</h2>
          <p className="text-xs text-slate-500 mt-0.5">Items only you can authorize</p>
        </div>
      </header>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => (
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            count={reopenCount}
            sub={reopenCount === 0
              ? 'No items'
              : reopenOldest != null ? `Oldest: ${reopenOldest}d since manager approval` : 'In queue'}
            urgent={reopenCount > 0}
            onClick={() => goTo('reopen-requests')}
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
            icon={Mail}
            label="Regulatory Correspondence"
            count={regOpen}
            sub={regOpen === 0
              ? 'No items'
              : regOverdue > 0
                ? `${regOverdue} overdue · ${regUrgent} urgent`
                : regUrgent > 0
                  ? `${regUrgent} urgent` + (regNextDue ? ` · next due ${regNextDue}` : '')
                  : regNextDue
                    ? `Next due ${regNextDue}`
                    : 'Open items'}
            urgent={regUrgent > 0 || regOverdue > 0}
            onClick={() => goTo('regulatory-correspondence')}
          />
        </div>
      )}
    </section>
  );
}

function ActionCard({ icon: Icon, label, count, sub, urgent, onClick }) {
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
      </div>
    </button>
  );
}
