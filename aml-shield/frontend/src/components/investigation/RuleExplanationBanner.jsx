// "Why this alert fired" panel — read-only, informational.
// Renders the alert.rule_explanation JSONB column from the backend.
// Two render variants:
//   variant="full"    → workspace header (pills, red flags, expand-on-overflow)
//   variant="compact" → manager side panel (summary + bulleted red flags only)
//
// Safe against missing / malformed rule_explanation. Uses optional
// chaining throughout.

import { useState } from 'react';

const FATF_HIGH_RISK = new Set([
  'Myanmar', 'Syria', 'Yemen', 'Iran', 'Russia', 'Pakistan', 'Haiti', 'North Korea'
]);

function formatUSD(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function buildPills(rule) {
  const o = rule?.observed || {};
  const scenario = (rule?.scenario || '').toUpperCase();
  const pills = [];
  const push = (label, tone = 'default') => {
    if (label) pills.push({ label, tone });
  };

  if (scenario === 'STRUCTURING') {
    if (o.transaction_count) push(`${o.transaction_count} transactions`);
    if (o.total_amount_usd) push(`${formatUSD(o.total_amount_usd)} total`);
    if (rule?.thresholds_at_detection?.window_days) push(`${rule.thresholds_at_detection.window_days} day window`);
    if (o.accounts_used) push(`${o.accounts_used} ${o.accounts_used === 1 ? 'account' : 'accounts'}`);
  } else if (scenario === 'HIGH_RISK_COUNTRY') {
    if (o.transaction_count) push(`${o.transaction_count} wire transfers`);
    if (o.total_amount_usd) push(`${formatUSD(o.total_amount_usd)} total`);
    if (o.counterparty_country) {
      push(o.counterparty_country, FATF_HIGH_RISK.has(o.counterparty_country) ? 'red' : 'default');
    }
  } else if (scenario === 'WATCHLIST_HIT') {
    if (Array.isArray(o.match_scores) && o.match_scores.length) {
      push(`Match score: ${Math.max(...o.match_scores)}%`, 'red');
    }
    push('OFAC SDN', 'red');
    if (o.transaction_count) push(`${o.transaction_count} payments`);
    if (o.total_amount_usd) push(`${formatUSD(o.total_amount_usd)} total`);
  } else if (scenario === 'CASH_INTENSIVE') {
    if (o.transaction_count) push(`${o.transaction_count} cash deposits`);
    const totalCash = o.total_cash_deposits_usd ?? o.total_amount_usd;
    if (totalCash) push(`${formatUSD(totalCash)} total`);
    if (o.weekly_peak_usd) push(`Weekly peak ${formatUSD(o.weekly_peak_usd)}`);
  } else if (scenario === 'RAPID_MOVEMENT') {
    if (o.inflow_usd) push(`In: ${formatUSD(o.inflow_usd)}`);
    if (o.outflow_usd && o.window_hours) push(`Out: ${formatUSD(o.outflow_usd)} within ${o.window_hours}h`);
    else if (o.outflow_usd) push(`Out: ${formatUSD(o.outflow_usd)}`);
    if (o.outflow_pct) push(`${o.outflow_pct}% pass-through`);
  } else if (scenario === 'TRADE_BASED_ML') {
    if (Array.isArray(o.jurisdictions) && o.jurisdictions.length) {
      push(`${o.jurisdictions.length} jurisdictions`);
    }
    if (o.total_amount_usd) push(`${formatUSD(o.total_amount_usd)} total`);
    if (o.average_invoice_mismatch_pct) push(`${o.average_invoice_mismatch_pct}% avg invoice mismatch`);
  } else {
    // Fallback: turn the first ~4 observed key/value pairs into pills.
    let i = 0;
    for (const [k, v] of Object.entries(o)) {
      if (i >= 4) break;
      if (Array.isArray(v) || (typeof v === 'object' && v !== null)) continue;
      const label = k.replace(/_/g, ' ');
      const value = typeof v === 'number' && k.toLowerCase().includes('usd') ? formatUSD(v) : v;
      push(`${label}: ${value}`);
      i++;
    }
  }
  return pills;
}

function Pill({ tone, children }) {
  const cls =
    tone === 'red'    ? 'bg-red-50 text-red-700 border-red-200' :
    tone === 'amber'  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-white text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function NullBanner({ compact }) {
  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-md ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} text-xs text-slate-500`}>
      Alert reason not available for this record. This alert was generated before rule explanation tracking was enabled.
    </div>
  );
}

export default function RuleExplanationBanner({ alert, variant = 'full' }) {
  const [expanded, setExpanded] = useState(false);
  const rule = alert?.rule_explanation;

  if (!rule || typeof rule !== 'object') {
    return <NullBanner compact={variant === 'compact'} />;
  }

  const summary = rule?.rule_summary || 'Rule explanation captured for this alert.';
  const flags = Array.isArray(rule?.red_flags) ? rule.red_flags : [];
  const flagsToShow = expanded ? flags : flags.slice(0, 3);
  const extraCount = Math.max(0, flags.length - 3);

  if (variant === 'compact') {
    return (
      <div
        className="bg-blue-50 rounded-md text-[12px]"
        style={{ borderLeft: '4px solid #2563EB', padding: '10px 12px' }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 mb-1">
          Why This Alert Fired
        </div>
        <div className="text-slate-800 leading-snug">{summary}</div>
        {flags.length > 0 && (
          <ul className="mt-2 space-y-1">
            {flags.slice(0, 3).map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-slate-700 text-[11px] leading-snug">
                <span className="text-red-500 mt-1 shrink-0" style={{ fontSize: 9 }}>●</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const pills = buildPills(rule);
  const version = rule?.version || rule?.scenario_version;

  return (
    <div
      className="rounded-md"
      style={{
        backgroundColor: '#EFF6FF',
        borderLeft: '4px solid #2563EB',
        padding: '12px 16px'
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
          Why This Alert Fired
        </div>
        <div className="flex items-center gap-2">
          {rule?.scenario && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
              {rule.scenario}
            </span>
          )}
          {version && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-700">
              {String(version).toLowerCase().startsWith('v') ? version : `v${version}`}
            </span>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-800 leading-snug mb-2">{summary}</div>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pills.map((p, i) => <Pill key={i} tone={p.tone}>{p.label}</Pill>)}
        </div>
      )}

      {flags.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {flagsToShow.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700 leading-snug">
              <span className="text-red-500 mt-1 shrink-0" style={{ fontSize: 9 }}>●</span>
              <span>{f}</span>
            </li>
          ))}
          {extraCount > 0 && !expanded && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-[11px] text-blue-700 hover:text-blue-900 font-medium mt-1"
              >
                + {extraCount} more
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
