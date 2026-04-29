// Centralised alert-status helpers used by every component that renders an
// SLA badge, an action button or an outcome card.
//
// We treat an alert as "closed" if its alert_status is in CLOSED_STATUSES, OR
// if it has a non-null closed_date (handles legacy rows that pre-date the
// status taxonomy).  Once an alert is closed there is no live SLA timer — we
// show a static "Closed on time" or "Closed late" pill based on whether the
// closure happened before or after the original SLA deadline.

const CLOSED_STATUSES = new Set([
  'Completed',
  'Closed',
  'Filed',
  'False Positive',
  'Closed - L2 Review',
  'Closed by L2',
  'Escalated - L2',
  'Escalated - SAR'
]);

export function isAlertClosed(alert) {
  if (!alert) return false;
  const s = alert.alert_status;
  if (s && CLOSED_STATUSES.has(s)) return true;
  if (alert.closed_date) return true;
  return false;
}

function parseDeadline(a) {
  if (!a?.sla_deadline) return null;
  const raw = a.sla_deadline.length <= 10 ? `${a.sla_deadline}T23:59:59` : a.sla_deadline;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseClosed(a) {
  if (!a?.closed_date) return null;
  const raw = a.closed_date.length <= 10 ? `${a.closed_date}T23:59:59` : a.closed_date;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCreated(a) {
  if (!a?.created_date) return null;
  const raw = a.created_date.length <= 10 ? `${a.created_date}T00:00:00` : a.created_date;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Snapshot used by every SLA badge in the app.
//   open alerts   →  live countdown buckets (breached / critical / ok)
//   closed alerts →  static closed_on_time / closed_late / closed pill
//
// Always returns { kind, label, tone, bucket, ...extras } so existing
// destructuring stays valid.
export function slaSnapshot(alert, now = Date.now()) {
  if (isAlertClosed(alert)) {
    const closed = parseClosed(alert);
    const dl = parseDeadline(alert);
    if (closed && dl && closed.getTime() > dl.getTime()) {
      return {
        kind: 'closed_late',
        label: 'Closed late',
        tone: 'text-slate-600 bg-slate-100',
        bucket: 'closed_late',
        closedAt: closed,
        dueAt: dl,
        remainingMs: null
      };
    }
    if (closed) {
      return {
        kind: 'closed_on_time',
        label: 'Closed on time',
        tone: 'text-green-700 bg-green-50',
        bucket: 'closed_on_time',
        closedAt: closed,
        dueAt: dl,
        remainingMs: null
      };
    }
    return {
      kind: 'closed',
      label: 'Closed',
      tone: 'text-slate-600 bg-slate-100',
      bucket: 'closed',
      closedAt: null,
      dueAt: dl,
      remainingMs: null
    };
  }

  const dl = parseDeadline(alert);
  if (!dl) {
    return {
      kind: 'unknown',
      label: alert?.due_status || '—',
      tone: 'text-slate-600 bg-slate-100',
      bucket: 'unknown',
      remainingMs: null
    };
  }
  const remainingMs = dl.getTime() - now;
  if (remainingMs <= 0) {
    const ago = Math.abs(remainingMs);
    const h = Math.floor(ago / 3600000);
    const m = Math.floor((ago % 3600000) / 60000);
    return {
      kind: 'breached',
      label: `Breached ${h}h ${m}m ago`,
      tone: 'text-red-700 bg-red-100',
      bucket: 'breached',
      remainingMs
    };
  }
  const totalMin = Math.floor(remainingMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (remainingMs <= 24 * 3600000) {
    return {
      kind: 'critical',
      label: `${h}h ${m}m`,
      tone: 'text-orange-700 bg-orange-50',
      bucket: 'critical',
      remainingMs
    };
  }
  const days = Math.floor(h / 24);
  const remH = h % 24;
  return {
    kind: 'ok',
    label: `${days}d ${remH}h`,
    tone: 'text-green-700 bg-green-50',
    bucket: 'ok',
    remainingMs
  };
}

// Compact label-only variant used in the global search dropdown.
// Returns the bucket name ('Breached' / 'At Risk' / 'On Time') or null
// if the alert is closed (caller should hide the pill entirely).
export function slaShortLabel(alert) {
  if (isAlertClosed(alert)) return null;
  const dl = parseDeadline(alert);
  if (!dl) return alert?.due_status || null;
  const remainingMs = dl.getTime() - Date.now();
  if (remainingMs <= 0) return 'Breached';
  if (remainingMs <= 24 * 3600000) return 'At Risk';
  return 'On Time';
}

// Resolution time as "X days Y hours" — null if dates are missing.
export function resolutionTime(alert) {
  const start = parseCreated(alert);
  const end = parseClosed(alert);
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  const totalHours = Math.floor(ms / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const dayPart = `${days} ${days === 1 ? 'day' : 'days'}`;
  const hourPart = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return { days, hours, label: `${dayPart} ${hourPart}` };
}

// Disposition → coloured badge.
const DISPOSITION_BADGE = {
  'False Positive — Closed':               { label: 'False Positive',      tone: 'bg-slate-200 text-slate-700' },
  'False Positive':                        { label: 'False Positive',      tone: 'bg-slate-200 text-slate-700' },
  'Escalated to L2':                       { label: 'Escalated to L2',     tone: 'bg-blue-100 text-blue-700' },
  'Escalated to SAR Filing':               { label: 'Escalated to SAR',    tone: 'bg-purple-100 text-purple-700' },
  'Escalated to SAR':                      { label: 'Escalated to SAR',    tone: 'bg-purple-100 text-purple-700' },
  'Closed by L2 — No Suspicious Activity': { label: 'Closed — No Suspicion', tone: 'bg-green-100 text-green-700' },
  'No Suspicious Activity':                { label: 'No Suspicion',        tone: 'bg-green-100 text-green-700' }
};

export function dispositionBadge(disposition) {
  if (!disposition) return { label: 'Closed', tone: 'bg-slate-100 text-slate-600' };
  if (DISPOSITION_BADGE[disposition]) return DISPOSITION_BADGE[disposition];
  const d = String(disposition).toLowerCase();
  if (d.includes('false positive'))                       return { label: 'False Positive',      tone: 'bg-slate-200 text-slate-700' };
  if (d.includes('sar'))                                  return { label: 'Escalated to SAR',    tone: 'bg-purple-100 text-purple-700' };
  if (d.includes('l2'))                                   return { label: 'Escalated to L2',     tone: 'bg-blue-100 text-blue-700' };
  if (d.includes('no suspicion') || d.includes('no suspicious')) return { label: 'No Suspicion', tone: 'bg-green-100 text-green-700' };
  return { label: disposition, tone: 'bg-slate-100 text-slate-600' };
}

// Format closed_date as "15 Nov 2025" or "15 Nov 2025 at 10:32 AM".
// Time is only shown when the source string carried a time component —
// otherwise we fall back to date-only to avoid implying 11:59 PM.
export function formatClosedAt(alert) {
  const d = parseClosed(alert);
  if (!d) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateLabel = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  const hasTime = typeof alert.closed_date === 'string' && alert.closed_date.length > 10;
  if (!hasTime) return dateLabel;
  let h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dateLabel} at ${h}:${String(m).padStart(2,'0')} ${period}`;
}
