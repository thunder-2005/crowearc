// ═══════════════════════════════════════════════════════════════════════════
// EntityAlertTimeline — right-panel chronological strip of alerts + SARs.
//
// Two modes:
//   compact={false} (default) — full timeline with stem line, dots, and a
//                               three-line card per event. Used when a
//                               specific entity is selected.
//   compact={true}            — same colour coding and stem but tighter
//                               padding and only two lines per card.
//                               Used in the default panel state to show
//                               the 5 most recent network-wide events.
//
// Data: the parent passes already-filtered arrays from graphData. This
// component does no fetching of its own.
//
// Role gating: SAR narrative previews are suppressed for analyst_l1
// (31 USC §5318(g)(2)). The backend graph endpoint already hides SAR
// nodes entirely from L1, so in practice `sarAlerts` is empty for them
// — the gate here is belt-and-braces for defence-in-depth.
// ═══════════════════════════════════════════════════════════════════════════

// Severity → dot + left-border colour. Tailwind utility classes only.
const ALERT_SEVERITY_COLOURS = {
  'Very High': { dot: 'bg-red-500',    border: 'border-l-red-500' },
  High:        { dot: 'bg-orange-400', border: 'border-l-orange-400' },
  Medium:      { dot: 'bg-amber-400',  border: 'border-l-amber-400' },
  Low:         { dot: 'bg-gray-400',   border: 'border-l-gray-400' }
};
const SAR_COLOURS = { dot: 'bg-purple-500', border: 'border-l-purple-500' };
const FALLBACK_COLOURS = { dot: 'bg-gray-400', border: 'border-l-gray-400' };

const STATUS_BADGE = {
  open:                'bg-blue-100 text-blue-700',
  'Not Started':       'bg-blue-100 text-blue-700',
  in_progress:         'bg-amber-100 text-amber-700',
  'In Progress':       'bg-amber-100 text-amber-700',
  'Work in Progress':  'bg-amber-100 text-amber-700',
  escalated:           'bg-orange-100 text-orange-700',
  'Escalated - L2':    'bg-orange-100 text-orange-700',
  'Escalated - SAR':   'bg-orange-100 text-orange-700',
  closed:              'bg-gray-100 text-gray-500',
  Completed:           'bg-gray-100 text-gray-500',
  Closed:              'bg-gray-100 text-gray-500',
  false_positive:      'bg-gray-100 text-gray-500',
  'False Positive':    'bg-gray-100 text-gray-500',
  'Closed — False Positive': 'bg-gray-100 text-gray-500',
  filed:               'bg-purple-100 text-purple-700',
  Filed:               'bg-purple-100 text-purple-700',
  pending_approval:    'bg-yellow-100 text-yellow-700',
  'Pending Approval':  'bg-yellow-100 text-yellow-700',
  'Under Manager Review': 'bg-yellow-100 text-yellow-700'
};

// Title-case a snake/kebab/space-delimited bsa_activity_type value.
function titleCase(raw) {
  if (!raw) return 'Activity';
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(typeof iso === 'string' && iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function eventTimestamp(node) {
  // SAR uses filed_date, alert uses created_date. Falls back to whichever
  // is present so a single sort works for the merged stream.
  return node.filed_date || node.created_date || node.created_at || null;
}

function isSar(node) { return node?.type === 'SAR'; }

// Build the merged, sorted stream. SARs sort before alerts on the same day.
function mergeAndSort(alerts, sarAlerts) {
  const events = [];
  for (const a of (alerts || []))     events.push({ ...a, _isSar: false });
  for (const s of (sarAlerts || []))  events.push({ ...s, _isSar: true });
  return events.sort((a, b) => {
    const at = eventTimestamp(a);
    const bt = eventTimestamp(b);
    const ad = at ? new Date(at).getTime() : 0;
    const bd = bt ? new Date(bt).getTime() : 0;
    if (ad !== bd) return bd - ad;
    // Same day → SARs win the tiebreak.
    if (a._isSar && !b._isSar) return -1;
    if (!a._isSar && b._isSar) return 1;
    return 0;
  });
}

function colourFor(event) {
  if (isSar(event)) return SAR_COLOURS;
  const risk = event.priority || event.risk_rating;
  return ALERT_SEVERITY_COLOURS[risk] || FALLBACK_COLOURS;
}

function badgeFor(event) {
  const key = event.status;
  return STATUS_BADGE[key] || 'bg-gray-100 text-gray-600';
}

function statusLabel(event) {
  const s = event.status;
  if (!s) return '—';
  return s.length > 22 ? s.slice(0, 21) + '…' : s;
}

export default function EntityAlertTimeline({
  alerts = [],
  sarAlerts = [],
  entityType = 'customer',
  entityLabel = '',
  userRole = null,
  compact = false
}) {
  // Filter SARs out entirely for L1 — defence in depth on top of the
  // backend's role-gated SAR query.
  const safeSars = userRole === 'analyst_l1' ? [] : sarAlerts;
  const events = mergeAndSort(alerts, safeSars);

  if (events.length === 0) {
    if (compact) return null;
    return (
      <div>
        <SectionHeader compact={compact} entityType={entityType} count={0} />
        <div className="text-xs text-gray-400 italic text-center py-4">
          No alerts recorded for this entity.
        </div>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <SectionHeader compact={compact} entityType={entityType} count={events.length} />
      )}
      <div className="relative pl-5">
        {/* Vertical stem */}
        <span
          aria-hidden="true"
          className="absolute left-1.5 top-1 bottom-1 w-0.5 bg-gray-200"
        />
        <ul className="space-y-2">
          {events.map(e => (
            <EventCard key={e.id} event={e} userRole={userRole} compact={compact} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({ entityType, count }) {
  return (
    <div className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
      Alert History · {count} event{count === 1 ? '' : 's'}
      {entityType === 'counterparty' && (
        <span className="normal-case font-normal text-gray-400 tracking-normal">
          {' '}(via connected customers)
        </span>
      )}
    </div>
  );
}

function EventCard({ event, userRole, compact }) {
  const colours = colourFor(event);
  const badge = badgeFor(event);
  const sar = isSar(event);
  const activity = sar
    ? titleCase(event.filing_type || event.scenario || 'SAR')
    : titleCase(event.scenario || event.bsa_activity_type || 'Alert');
  const eventDate = fmtDate(eventTimestamp(event));

  return (
    <li className="relative">
      {/* Stem dot — slightly left of the card, sitting on the stem line. */}
      <span
        aria-hidden="true"
        className={`absolute -left-[14px] top-2 w-2.5 h-2.5 rounded-full ${colours.dot} ring-2 ring-white`}
      />
      <div
        // TODO: navigate to alert workspace
        onClick={() => {}}
        className={`border-l-2 ${colours.border} bg-white border border-gray-100 rounded-r px-3 ${compact ? 'py-1.5' : 'py-2'} hover:bg-gray-50 cursor-pointer`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-xs font-semibold text-gray-800 truncate">
            {event.label || event.id}
          </div>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge} whitespace-nowrap`}>
            {statusLabel(event)}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5 truncate">
          {activity} · {eventDate}
        </div>
        {!compact && (
          sar ? (
            userRole === 'analyst_l1' ? (
              <div className="text-xs text-gray-300 italic mt-0.5">SAR details restricted</div>
            ) : event.narrative_summary ? (
              <div className="text-xs text-gray-400 mt-0.5 truncate">
                {event.narrative_summary.length > 80
                  ? event.narrative_summary.slice(0, 80) + '…'
                  : event.narrative_summary}
              </div>
            ) : (
              <div className="text-xs text-gray-300 italic mt-0.5">No narrative recorded</div>
            )
          ) : (
            <div className="text-xs text-gray-400 mt-0.5 truncate">
              {event.assigned_to
                ? <>{event.assigned_to} · {event.status || 'Unassigned'}</>
                : <span className="text-gray-300">Unassigned</span>}
            </div>
          )
        )}
      </div>
    </li>
  );
}
