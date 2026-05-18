import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Zap, PlayCircle, Clock, GripVertical, RotateCcw, CheckCircle2, X, Lock } from 'lucide-react';
import api from '../../api/client.js';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import {
  getNextUpAlert,
  getSlaDescriptor,
  computeTimeUrgencyScore,
  computeRiskScore,
  resolveSlaTier,
  hasCriticalSlaAlert,
  DEFAULT_SCORING_WEIGHTS
} from '../../utils/alertScoring.js';
import { useScoringWeights } from '../../hooks/useScoringWeights.js';

// ─────────────────────────────────────────────────────────────────────────────
// Floating "Next Priority" / "Next Up" widget — pinned to the bottom-right
// of the investigation workspace by default, but draggable by the analyst.
//
// Position persistence (debug notes):
//   - Stored in localStorage per-analyst, under the key
//       crowe_arc_next_priority_position_<currentAnalyst>
//     where <currentAnalyst> comes from useRole().
//   - Payload shape:
//       { x, y, viewport_width, viewport_height, saved_at }
//     viewport_width / viewport_height are saved so we can detect a major
//     layout shift on the next mount.
//   - To wipe one user's saved position:
//       localStorage.removeItem('crowe_arc_next_priority_position_<analyst>')
//     To wipe all: open DevTools and run
//       Object.keys(localStorage).filter(k => k.includes('next_priority'))
//         .forEach(k => localStorage.removeItem(k))
//
// Defensive position restoration (the bug this version is paranoid about):
//   1. localStorage access is wrapped in try/catch — incognito / disabled
//      storage / quota errors can NOT prevent the card from rendering.
//   2. JSON.parse is wrapped — malformed payload ⇒ fall back to default.
//   3. The parsed payload's x and y MUST pass Number.isFinite. Anything
//      else (NaN, null, undefined, strings) ⇒ fall back to default.
//   4. Saved positions are clamped to the current viewport on mount using
//      the CURRENT window dimensions, not the saved viewport dims. A
//      position saved on a 1920-wide screen never renders at x=1850 on
//      a 1440-wide screen — it gets snapped into range first.
//   5. Initial position is computed in a useState lazy initializer, so
//      the very first render uses the clamped value — the card never
//      paints at an off-screen coordinate even for one frame.
//   6. If clamping changes the saved value, the corrected value is
//      persisted back. Stale storage self-heals on the next mount.
//   7. Render-time fallback: even if `position` state somehow contains
//      a non-finite value (it shouldn't, but belt + suspenders), the
//      style object substitutes the default anchor.
//
// Drag UX rules:
//   - Drag the entire card surface EXCEPT buttons (the "Open Alert" CTA
//     and the reset icon both have data-no-drag).
//   - Click vs drag is decided by a 5px movement threshold; under the
//     threshold the click on "Open Alert" still fires normally.
//   - Pointer events (not mouse) so touch works.
//   - Keyboard: when the grip is focused, arrow keys move 20px, Home
//     resets, Escape cancels an active drag.
//   - Viewports narrower than the card itself disable drag and force
//     the default bottom-right anchor.
//
// Rendering rules (unchanged from the original):
//   - L1 analysts only (manager / L2 hidden)
//   - Self-fetches on mount + every 30 seconds, refetches on
//     activeId / alertsRefreshNonce
//   - Renders nothing if no next-up alert remains
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'crowe_arc_next_priority_position_';
// Per-analyst sessionStorage flag set when the analyst dismisses the
// "You're caught up" empty state. Suppresses only the empty state; if a
// real next priority arrives we ignore the flag and show the card.
// Cleared on every mount so a page refresh re-shows the empty state.
const EMPTY_DISMISS_PREFIX = 'crowe_arc_next_priority_empty_dismissed_';
const CARD_WIDTH = 320;
const CARD_HEIGHT_FALLBACK = 160;   // approximate; real height read from ref
const EDGE_MARGIN = 16;             // px guaranteed between card and viewport edge
const DRAG_THRESHOLD = 5;           // px before a pointer-down counts as a drag
const KEYBOARD_STEP = 20;           // px nudge per arrow keypress
const DEFAULT_OFFSET = 16;          // default px from bottom + right edges

// Pure helpers (no React deps — easy to reason about) ────────────────────────

function safeWindow() {
  return (typeof window !== 'undefined') ? window : null;
}

function isValidPos(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function clampToViewport(x, y, w, h) {
  const win = safeWindow();
  if (!win) return { x, y };
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  // Card must be FULLY visible: top-left x must be in [margin, vw - w - margin]
  // and similarly for y. If the viewport is too small, the range collapses
  // and we fall back to the default anchor in the render path (clamp result
  // here may be nonsense; the caller checks viewportTooSmall first).
  return {
    x: Math.max(EDGE_MARGIN, Math.min(vw - w - EDGE_MARGIN, x)),
    y: Math.max(EDGE_MARGIN, Math.min(vh - h - EDGE_MARGIN, y))
  };
}

function isViewportTooSmall(w, h) {
  const win = safeWindow();
  if (!win) return false;
  return win.innerWidth < w + EDGE_MARGIN * 2 || win.innerHeight < h + EDGE_MARGIN * 2;
}

function readSavedPosition(storageKey) {
  if (!storageKey) return null;
  const win = safeWindow();
  if (!win) return null;
  let raw;
  try { raw = win.localStorage.getItem(storageKey); } catch (_) { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!isValidPos(parsed)) return null;
  return parsed;
}

function persistPosition(storageKey, pos) {
  if (!storageKey || !isValidPos(pos)) return;
  const win = safeWindow();
  if (!win) return;
  try {
    win.localStorage.setItem(storageKey, JSON.stringify({
      x: pos.x,
      y: pos.y,
      viewport_width: win.innerWidth,
      viewport_height: win.innerHeight,
      saved_at: new Date().toISOString()
    }));
  } catch (_) { /* quota / disabled / privacy mode — silently ignore */ }
}

function clearSavedPosition(storageKey) {
  if (!storageKey) return;
  const win = safeWindow();
  if (!win) return;
  try { win.localStorage.removeItem(storageKey); } catch (_) { /* ignore */ }
}

// Compute the initial position on mount. Self-heals stale storage by
// writing the clamped value back when it differs from what was saved.
function loadInitialPosition(storageKey) {
  const saved = readSavedPosition(storageKey);
  if (!saved) return null;
  if (isViewportTooSmall(CARD_WIDTH, CARD_HEIGHT_FALLBACK)) {
    // Viewport can't fit the card with margins; default anchor is safer.
    return null;
  }
  const clamped = clampToViewport(saved.x, saved.y, CARD_WIDTH, CARD_HEIGHT_FALLBACK);
  if (clamped.x !== saved.x || clamped.y !== saved.y) {
    persistPosition(storageKey, clamped);
  }
  return clamped;
}

function describePosition(x, y, w, h) {
  const win = safeWindow();
  if (!win) return 'custom position';
  const vw = win.innerWidth, vh = win.innerHeight;
  const cx = x + w / 2, cy = y + h / 2;
  const horiz = cx < vw / 3 ? 'left' : cx > (2 * vw) / 3 ? 'right' : 'center';
  const vert  = cy < vh / 3 ? 'top'  : cy > (2 * vh) / 3 ? 'bottom' : 'middle';
  return vert === 'middle' && horiz === 'center' ? 'center' : `${vert}-${horiz}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function NextUpFloat({ excludeAlertId, onOpen }) {
  const { isL1, currentAnalyst } = useRole();
  const { activeId, alertsRefreshNonce, sessionResolvedCustomerIds } = useInvestigationTabs();
  const [alerts, setAlerts] = useState(null);
  // C-05: scoring weights loaded once from /api/settings/manager. Defaults
  // apply synchronously on first render so the float never blocks waiting
  // for the fetch — see hooks/useScoringWeights.js.
  const weights = useScoringWeights();

  const storageKey = currentAnalyst ? STORAGE_PREFIX + currentAnalyst : null;
  const emptyDismissKey = currentAnalyst ? EMPTY_DISMISS_PREFIX + currentAnalyst : null;

  // Lazy initializer — synchronous read + clamp on mount. The very first
  // render uses the clamped value, so the card never paints off-screen.
  const [position, setPosition] = useState(() => loadInitialPosition(storageKey));
  const [dragging, setDragging] = useState(false);
  const [viewportTooSmall, setViewportTooSmall] = useState(
    () => isViewportTooSmall(CARD_WIDTH, CARD_HEIGHT_FALLBACK)
  );
  const [statusMessage, setStatusMessage] = useState('');

  // Per-analyst "I dismissed the You're caught up notice" flag. Always
  // starts false on mount — a page refresh re-shows the empty state.
  // We mirror the value into sessionStorage on dismiss so the literal
  // storage instruction is honoured and other consumers in the same page
  // session could read it, but the on-mount cleanup effect below clears
  // any leftover value so refresh behaves like a fresh visit.
  const [emptyDismissed, setEmptyDismissed] = useState(false);

  const cardRef = useRef(null);
  // Mutable scratch space for the in-flight drag — avoids re-renders
  // while the pointer is moving (the position state already triggers them).
  const dragStateRef = useRef({ active: false });
  // Track currentAnalyst across renders so we can re-load saved position
  // when the user logs out and a different analyst logs in.
  const analystAtMountRef = useRef(currentAnalyst);

  // Fetch the FULL institution-wide alerts list. The cross-analyst live
  // claim rule in getNextUpAlert needs to see OTHER analysts' alerts on
  // the same customer to know whether a customer is being investigated
  // elsewhere; the restrictToAnalyst arg still narrows the surfaced
  // alert to mine.
  useEffect(() => {
    if (!isL1 || !currentAnalyst) return;
    let cancelled = false;
    const load = () => api.get('/alerts')
      .then(r => { if (!cancelled) setAlerts(r.data || []); })
      .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isL1, currentAnalyst, activeId, alertsRefreshNonce]);

  // Re-load saved position if currentAnalyst changes mid-session.
  useEffect(() => {
    if (currentAnalyst === analystAtMountRef.current) return;
    analystAtMountRef.current = currentAnalyst;
    setPosition(loadInitialPosition(currentAnalyst ? STORAGE_PREFIX + currentAnalyst : null));
  }, [currentAnalyst]);

  // Clear any stale "empty dismissed" flag from a prior page session.
  // sessionStorage normally survives a page refresh, but the product
  // requirement is that refresh re-shows the empty state — so we wipe
  // the entry on mount (and whenever the analyst changes, so a new
  // analyst doesn't inherit the previous analyst's dismissal).
  useEffect(() => {
    if (!emptyDismissKey || typeof window === 'undefined') return;
    try { window.sessionStorage.removeItem(emptyDismissKey); } catch (_) { /* ignore */ }
    setEmptyDismissed(false);
  }, [emptyDismissKey]);

  // After the card has actually rendered, re-clamp using its REAL height
  // (the lazy initializer used the fallback). useLayoutEffect runs before
  // paint, so any correction happens without a visible flash.
  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const realH = cardRef.current.offsetHeight || CARD_HEIGHT_FALLBACK;
    setPosition(prev => {
      if (!isValidPos(prev)) return prev;
      const clamped = clampToViewport(prev.x, prev.y, CARD_WIDTH, realH);
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      persistPosition(storageKey, clamped);
      return clamped;
    });
    // Re-run when the rendered alert changes — height can jump (badges
    // appear / disappear) so a previously OK position may now overflow.
  }, [alerts, storageKey, excludeAlertId]);

  // Viewport resize / sidebar-collapse → reclamp + update too-small flag.
  useEffect(() => {
    const win = safeWindow();
    if (!win) return;
    const onResize = () => {
      setViewportTooSmall(isViewportTooSmall(CARD_WIDTH, CARD_HEIGHT_FALLBACK));
      setPosition(prev => {
        if (!isValidPos(prev)) return prev;
        const h = cardRef.current ? cardRef.current.offsetHeight : CARD_HEIGHT_FALLBACK;
        const clamped = clampToViewport(prev.x, prev.y, CARD_WIDTH, h);
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        persistPosition(storageKey, clamped);
        return clamped;
      });
    };
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
  }, [storageKey]);

  // Pointer-cleanup on unmount — release capture so the browser doesn't
  // leak the pointer listener if the component disappears mid-drag.
  useEffect(() => {
    return () => {
      const s = dragStateRef.current;
      if (s.active && cardRef.current && s.pointerId != null) {
        try { cardRef.current.releasePointerCapture(s.pointerId); } catch (_) {}
      }
      dragStateRef.current = { active: false };
    };
  }, []);

  const resetPosition = useCallback(() => {
    clearSavedPosition(storageKey);
    setPosition(null);
    setStatusMessage('Card reset to default position');
  }, [storageKey]);

  // Dismiss the "You're caught up" notice for the rest of this page
  // session. Re-show conditions:
  //   - page refresh (the on-mount effect above wipes the flag)
  //   - logging in as a different analyst (key changes, effect re-fires)
  //   - a new actionable alert arrives — the render gate ignores the
  //     flag when `next` is non-null, so the card auto-returns with
  //     the real alert
  const dismissEmpty = useCallback(() => {
    if (emptyDismissKey && typeof window !== 'undefined') {
      try { window.sessionStorage.setItem(emptyDismissKey, 'true'); } catch (_) { /* ignore */ }
    }
    setEmptyDismissed(true);
    setStatusMessage('Caught-up notice dismissed');
  }, [emptyDismissKey]);

  // Pointer handlers ─────────────────────────────────────────────────────
  const onPointerDown = (e) => {
    if (viewportTooSmall) return;
    if (e.target.closest('button, a, [data-no-drag]')) return;
    if (e.button !== undefined && e.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      preDragPosition: position,
      pointerId: e.pointerId
    };
    try { card.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };

  const onPointerMove = (e) => {
    const s = dragStateRef.current;
    if (!s.active) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!s.moved) { s.moved = true; setDragging(true); }
    const card = cardRef.current;
    const w = card ? card.offsetWidth : CARD_WIDTH;
    const h = card ? card.offsetHeight : CARD_HEIGHT_FALLBACK;
    setPosition(clampToViewport(s.origLeft + dx, s.origTop + dy, w, h));
  };

  const finishDrag = (commit) => {
    const s = dragStateRef.current;
    if (!s.active) return;
    const card = cardRef.current;
    if (card && s.pointerId != null) {
      try { card.releasePointerCapture(s.pointerId); } catch (_) { /* ignore */ }
    }
    s.active = false;
    if (!s.moved) return;
    setDragging(false);
    if (commit) {
      const w = card ? card.offsetWidth : CARD_WIDTH;
      const h = card ? card.offsetHeight : CARD_HEIGHT_FALLBACK;
      const rect = card ? card.getBoundingClientRect() : null;
      const finalPos = rect ? { x: rect.left, y: rect.top } : position;
      if (isValidPos(finalPos)) {
        persistPosition(storageKey, finalPos);
        setStatusMessage(`Card moved to ${describePosition(finalPos.x, finalPos.y, w, h)}`);
      }
    } else {
      setPosition(s.preDragPosition);
      setStatusMessage('Drag cancelled');
    }
  };

  const onPointerUp = () => finishDrag(true);
  const onPointerCancel = () => finishDrag(false);

  // Keyboard handlers (focused grip) ─────────────────────────────────────
  const moveBy = (dx, dy) => {
    const card = cardRef.current;
    const w = card ? card.offsetWidth : CARD_WIDTH;
    const h = card ? card.offsetHeight : CARD_HEIGHT_FALLBACK;
    let base = position;
    if (!isValidPos(base)) {
      if (card) {
        const r = card.getBoundingClientRect();
        base = { x: r.left, y: r.top };
      } else {
        base = { x: 0, y: 0 };
      }
    }
    const next = clampToViewport(base.x + dx, base.y + dy, w, h);
    setPosition(next);
    persistPosition(storageKey, next);
    setStatusMessage(`Card moved to ${describePosition(next.x, next.y, w, h)}`);
  };

  const onGripKeyDown = (e) => {
    if (viewportTooSmall) return;
    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); moveBy(0, -KEYBOARD_STEP); break;
      case 'ArrowDown':  e.preventDefault(); moveBy(0,  KEYBOARD_STEP); break;
      case 'ArrowLeft':  e.preventDefault(); moveBy(-KEYBOARD_STEP, 0); break;
      case 'ArrowRight': e.preventDefault(); moveBy( KEYBOARD_STEP, 0); break;
      case 'Home':       e.preventDefault(); resetPosition(); break;
      case 'Escape':
        if (dragStateRef.current.active) { e.preventDefault(); finishDrag(false); }
        break;
      default: break;
    }
  };

  // Early returns ─────────────────────────────────────────────────────────
  // Render gates that should keep the card off-screen entirely (different
  // role, no analyst yet, fetch still in flight). Once alerts have loaded
  // we ALWAYS render — either with the next alert or with an explicit
  // "You're caught up" empty state. Returning null after the fetch is
  // what caused the "card disappears on refresh" complaint.
  if (!isL1 || !currentAnalyst) return null;
  if (alerts === null) return null;

  const next = getNextUpAlert(alerts, excludeAlertId, currentAnalyst, {
    allAlerts: alerts,
    sessionResolvedCustomerIds,
    weights
  });

  // C-05: lockout the dismiss button when the manager-enabled feature flag
  // is true AND at least one critical-tier alert is in my queue. The check
  // uses the same exclusion ruleset getNextUpAlert applies, so a customer
  // I just dispositioned this session won't keep me locked.
  const lockoutEnabled = weights?.lockoutOnCritical !== false;
  const hasCritical = lockoutEnabled && hasCriticalSlaAlert(alerts || [], currentAnalyst, {
    allAlerts: alerts,
    sessionResolvedCustomerIds,
    weights
  });
  // The dismiss button hides only on the empty-state path AND when locked.
  // When a real alert is showing, the dismiss button is already absent;
  // lockout adds an explanatory label so the analyst understands why.
  const dismissLocked = lockoutEnabled && hasCritical;

  // If the user dismissed the caught-up notice AND there's still no
  // actionable next priority, hide the card. We still keep a minimal
  // aria-live region in the DOM so the "Caught-up notice dismissed"
  // announcement reaches screen readers even though the visual card
  // has gone away. A real alert (next != null) overrides the dismissal
  // entirely — the card auto-returns with the work.
  if (!next && emptyDismissed) {
    return (
      <span
        aria-live="polite"
        style={{
          position: 'fixed',
          width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap', border: 0
        }}
      >{statusMessage}</span>
    );
  }

  // Derived render values — computed only when there's an alert to show.
  // The empty-state path doesn't read any of these so we can short-circuit.
  const sla = next ? getSlaDescriptor(next) : null;
  // C-05: SAR-clock tier drives the border + ring + countdown. Falls back
  // to the alert-investigation SLA tone when the new field is missing.
  const sarTier = next ? resolveSlaTier(next, weights) : 'normal';
  const borderColor = !next
    ? '#16A34A'
    : sarTier === 'breached' ? '#7F1D1D'
    : sarTier === 'critical' ? '#DC2626'
    : sarTier === 'warning'  ? '#F59E0B'
    : sla.tone === 'red'     ? '#DC2626'
    : sla.tone === 'amber'   ? '#F59E0B'
    : '#2563EB';
  const slaCls = !next
    ? 'text-green-700'
    : sla.tone === 'red' ? 'text-red-700' : sla.tone === 'amber' ? 'text-amber-700' : 'text-blue-700';
  // SAR-clock-prominent countdown rendered in the header. This is the
  // BSA-legal deadline — louder than the alert-investigation timer.
  const daysRemaining = next?.days_remaining;
  const sarCountdownText = next == null
    ? ''
    : daysRemaining == null ? ''
    : sarTier === 'breached'
      ? `⚠ SLA BREACHED`
      : Number(daysRemaining) === 0
        ? `Due today to SLA`
        : `${Number(daysRemaining)} day${Number(daysRemaining) === 1 ? '' : 's'} to SLA`;
  const sarCountdownCls = sarTier === 'breached' ? 'text-red-900 font-bold'
    : sarTier === 'critical' ? 'text-red-700 font-bold'
    : sarTier === 'warning'  ? 'text-amber-700 font-semibold'
    : 'text-slate-500';

  // Composite score breakdown percentages. Round to integer so the bar widths
  // are presentation-stable. Numbers are computed on the raw alert object,
  // not on a rankAlerts() byproduct, so the float doesn't depend on whether
  // it received a decorated row.
  const timePct = next ? Math.round(computeTimeUrgencyScore(next) * 100) : 0;
  const riskPct = next ? Math.round(computeRiskScore(next) * 100) : 0;

  const isPep = next && Number(next.pep_match) === 1;
  const isSanctions = next && Number(next.sanctions_match) === 1;
  const isHighRisk = next && (next.customer_risk_rating === 'Very High' || next.customer_risk_rating === 'High');
  const amount = next ? `$${Number(next.amount_flagged_inr || 0).toLocaleString('en-US')}` : '';

  // Render-time defensive style. If `position` is somehow non-finite, fall
  // back to the default bottom-right anchor — the card stays visible.
  const useCustomPosition = !viewportTooSmall && isValidPos(position);
  const positionalStyle = useCustomPosition
    ? { top: position.y, left: position.x, bottom: 'auto', right: 'auto' }
    : { bottom: DEFAULT_OFFSET, right: DEFAULT_OFFSET };

  // C-05: tier-driven ring on the float container itself. ring + pulse only
  // when the surfaced alert is critical-tier; the warning/normal/breached
  // tiers keep the existing left-border treatment without the ring distraction.
  const ringCls = next && sarTier === 'critical'
    ? 'ring-2 ring-red-500 animate-pulse'
    : '';

  return (
    <aside
      ref={cardRef}
      role="complementary"
      aria-label="Next priority alert"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`bg-white rounded-lg group ${ringCls}`}
      style={{
        position: 'fixed',
        ...positionalStyle,
        width: CARD_WIDTH,
        zIndex: 40,
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: dragging
          ? '0 18px 35px -10px rgba(15, 23, 42, 0.4)'
          : '0 10px 25px -8px rgba(15, 23, 42, 0.25)',
        padding: '12px 14px',
        opacity: dragging ? 0.95 : 1,
        transition: 'box-shadow 150ms ease, opacity 150ms ease',
        cursor: viewportTooSmall ? 'default' : (dragging ? 'grabbing' : 'grab'),
        touchAction: viewportTooSmall ? 'auto' : 'none',
        userSelect: dragging ? 'none' : 'auto'
      }}
    >
      {/* aria-live status — visually hidden */}
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap', border: 0
        }}
      >{statusMessage}</span>

      <div className="flex items-center gap-1.5 mb-1.5">
        {!viewportTooSmall && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Drag to reposition. Use arrow keys to move 20px, Home to reset, Escape to cancel."
            onKeyDown={onGripKeyDown}
            className="inline-flex items-center text-slate-400 hover:text-slate-600 focus:text-slate-700 focus:outline-none rounded"
            style={{ cursor: 'grab' }}
          >
            <GripVertical size={12} />
          </span>
        )}
        <Zap size={12} className="text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Next Priority
        </span>
        <div className="ml-auto inline-flex items-center gap-1">
          {!viewportTooSmall && useCustomPosition && (
            <button
              type="button"
              data-no-drag
              onClick={resetPosition}
              aria-label="Reset card position to default"
              title="Reset position"
              className="inline-flex items-center text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              <RotateCcw size={12} />
            </button>
          )}
          {/* Dismiss button only appears in the empty state — when a real
              priority alert is showing, that alert IS the work and must
              not be hide-able. The button writes its flag to sessionStorage
              and lives only for this page session.
              C-05: when manager-enabled lockout fires AND there's a
              critical-tier alert in the queue, the dismiss button is
              suppressed even in the empty state. We render a small lock
              label instead so the analyst understands the affordance is
              intentionally absent. */}
          {!next && !dismissLocked && (
            <button
              type="button"
              data-no-drag
              onClick={dismissEmpty}
              aria-label="Dismiss caught-up notice"
              title="Dismiss until next refresh"
              className="inline-flex items-center text-slate-400 hover:text-slate-600 focus:text-slate-700 focus:outline-none rounded"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* C-05: prominent SAR countdown — the BSA-legal 30-day clock. Shown
          above the customer name on a real alert so the analyst sees the
          deadline first. */}
      {next && sarCountdownText && (
        <div className={`text-xs mb-1 inline-flex items-center gap-1 ${sarCountdownCls}`}>
          <Clock size={11} />
          <span>{sarCountdownText}</span>
        </div>
      )}

      {next ? (
        <>
          <div className="text-sm font-semibold text-navy-900 truncate" title={next.customer_name}>
            {next.customer_name}
          </div>

          {(isHighRisk || isPep || isSanctions) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {isHighRisk && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                  {next.customer_risk_rating} Risk
                </span>
              )}
              {isPep && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">
                  PEP
                </span>
              )}
              {isSanctions && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                  Sanctions
                </span>
              )}
            </div>
          )}

          <div className="text-[11px] text-slate-500 mt-1.5 font-mono">
            {next.alert_id} · <span className="tabular-nums">{amount}</span>
          </div>

          <div className={`text-[11px] mt-1 inline-flex items-center gap-1 ${slaCls}`}>
            <Clock size={11} />
            <span>{sla.text}</span>
          </div>

          {/* C-05: composite-score breakdown — teaches the analyst WHY this
              alert is the next priority. Two bars: time-pressure vs. risk.
              Widths are inline styles because they're genuinely dynamic. */}
          <div className="mt-2.5 space-y-1">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-500 w-[78px] shrink-0">Time pressure</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
                <div
                  className="h-full bg-red-500 transition-all"
                  style={{ width: `${timePct}%` }}
                />
              </div>
              <span className="tabular-nums text-slate-600 w-[28px] text-right">{timePct}%</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-500 w-[78px] shrink-0">Risk score</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${riskPct}%` }}
                />
              </div>
              <span className="tabular-nums text-slate-600 w-[28px] text-right">{riskPct}%</span>
            </div>
          </div>

          <button
            type="button"
            data-no-drag
            onClick={() => onOpen ? onOpen(next) : null}
            className="mt-3 w-full inline-flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded px-3 py-1.5"
          >
            <PlayCircle size={12} />
            Open Alert →
          </button>
        </>
      ) : (
        /* Empty state — nothing surfaceable for this analyst right now.
           The card stays visible (this is the fix for the "card
           disappears on refresh" complaint) but shows a clear "caught
           up" message instead of silently rendering nothing. */
        <div className="mt-1">
          <div className="flex items-start gap-1.5">
            <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-navy-900">You're caught up</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                No priority alerts assigned to you right now. New alerts
                will appear here as they're routed to your queue.
              </div>
            </div>
          </div>
          {/* C-05: lockout explainer. The dismiss "×" is absent above; this
              tells the analyst why. Only renders when the manager-enabled
              feature is on AND a critical-tier alert sits in queue. */}
          {dismissLocked && (
            <div className="mt-2 text-xs text-red-600 inline-flex items-center gap-1">
              <Lock size={10} />
              <span>Cannot dismiss — critical SLA alert in queue</span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
