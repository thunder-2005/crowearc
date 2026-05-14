import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, PlayCircle, Clock, GripVertical, RotateCcw } from 'lucide-react';
import api from '../../api/client.js';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { getNextUpAlert, getSlaDescriptor } from '../../utils/alertScoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// Floating "Next Up" / "Next Priority" widget — pinned to the bottom-right
// of the investigation workspace by default, but draggable by the analyst.
//
// Position persistence (debug notes):
//   - Stored in localStorage per-analyst, under the key
//       crowe_arc_next_priority_position_<currentAnalyst>
//     where <currentAnalyst> is the value exposed by useRole().currentAnalyst.
//   - Payload shape:
//       { x, y, viewport_width, viewport_height, saved_at }
//     viewport_width / viewport_height are saved so the next mount can detect
//     a substantial viewport change (>30% in either dimension) and reclamp.
//   - To wipe a user's saved position (e.g. analyst dragged it off-screen on
//     a stale viewport):
//       localStorage.removeItem('crowe_arc_next_priority_position_<analyst>')
//
// Drag UX rules:
//   - Drag the whole card surface EXCEPT interactive children (the "Open
//     Alert" button, the reset icon). The grip handle in the top-left is
//     just a visual affordance — drag works from any non-interactive pixel.
//   - Click vs drag is decided by a 5px movement threshold; under threshold
//     ⇒ the click on "Open Alert" still fires normally.
//   - Pointer events (not mouse) so touch works.
//   - Keyboard: when the grip is focused, arrow keys move the card 20px,
//     Home resets, Escape cancels an active drag.
//   - Viewports narrower than the card itself disable drag and force the
//     bottom-right anchor (mobile/narrow window edge case).
//
// Self-fetches the analyst's alerts and shows the highest-ranked next
// priority. One action only: "Open Alert" — no skip, no dismiss.
//
// Rendering rules:
//   - L1 analysts only (manager / L2 hidden — different workflows)
//   - Self-fetches on mount + every 30 seconds
//   - Renders nothing if no next-up alert remains (silent, not noisy)
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'crowe_arc_next_priority_position_';
const CARD_WIDTH = 320;
const MIN_VISIBLE = 40;       // px of card guaranteed on-screen on every edge
const DRAG_THRESHOLD = 5;     // px movement before pointer-down counts as drag
const KEYBOARD_STEP = 20;     // px nudge per arrow keypress
const VIEWPORT_DRIFT = 0.3;   // 30% change in either dimension triggers reclamp
const DEFAULT_OFFSET = 16;    // default px from bottom + right edges

function clampToViewport(x, y, w, h) {
  if (typeof window === 'undefined') return { x, y };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(MIN_VISIBLE - w, Math.min(vw - MIN_VISIBLE, x)),
    y: Math.max(MIN_VISIBLE - h, Math.min(vh - MIN_VISIBLE, y))
  };
}

function describePosition(x, y, w, h) {
  if (typeof window === 'undefined') return 'custom position';
  const vw = window.innerWidth, vh = window.innerHeight;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horiz = cx < vw / 3 ? 'left' : cx > (2 * vw) / 3 ? 'right' : 'center';
  const vert  = cy < vh / 3 ? 'top'  : cy > (2 * vh) / 3 ? 'bottom' : 'middle';
  return vert === 'middle' && horiz === 'center' ? 'center' : `${vert}-${horiz}`;
}

export default function NextUpFloat({ excludeAlertId, onOpen }) {
  const { isL1, currentAnalyst } = useRole();
  const { activeId, alertsRefreshNonce } = useInvestigationTabs();
  const [alerts, setAlerts] = useState(null);

  // Drag / position state
  const cardRef = useRef(null);
  // `position = null` ⇒ render with the original bottom-right anchor.
  // Once the user drags (or we restore a saved drag), we switch to
  // explicit top/left coordinates.
  const [position, setPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [viewportTooSmall, setViewportTooSmall] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  // Mutable scratch space for the in-flight drag gesture (don't trigger
  // re-renders while the pointer is moving — just the position state does).
  const dragStateRef = useRef({ active: false });

  const storageKey = currentAnalyst ? STORAGE_PREFIX + currentAnalyst : null;

  // Self-fetch the FULL alerts list. The customer-level claim rule inside
  // getNextUpAlert needs to see OTHER analysts' alerts on the same customer
  // to know whether a customer is "claimed" institution-wide; the
  // restrictToAnalyst arg passed below still narrows the surfaced alert
  // to mine. Refetches on currentAnalyst / activeId / alertsRefreshNonce
  // changes so the float reflects out-of-band edits without waiting for
  // the next 30s poll tick.
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

  // Hydrate saved position on mount (and when the analyst changes).
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) { setPosition(null); return; }
      const saved = JSON.parse(raw);
      if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') {
        setPosition(null);
        return;
      }
      // Reclamp to the current viewport — works whether or not the viewport
      // has changed meaningfully since the position was saved. If it changed
      // a lot (>30% in either dimension) the result is the same — clamp into
      // the new bounds. The explicit drift check just makes the intent
      // visible if we ever want to do something different in that case.
      const w = CARD_WIDTH;
      const h = cardRef.current ? cardRef.current.offsetHeight : 160;
      const widthDrift = saved.viewport_width
        ? Math.abs((window.innerWidth - saved.viewport_width) / saved.viewport_width)
        : 0;
      const heightDrift = saved.viewport_height
        ? Math.abs((window.innerHeight - saved.viewport_height) / saved.viewport_height)
        : 0;
      const reclamp = widthDrift > VIEWPORT_DRIFT || heightDrift > VIEWPORT_DRIFT;
      const next = clampToViewport(saved.x, saved.y, w, h);
      setPosition(next);
      if (reclamp && (next.x !== saved.x || next.y !== saved.y)) {
        // Persist the reclamped position so next reload doesn't redo this work.
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            x: next.x, y: next.y,
            viewport_width: window.innerWidth,
            viewport_height: window.innerHeight,
            saved_at: new Date().toISOString()
          }));
        } catch (_) { /* ignore */ }
      }
    } catch (_) {
      // Storage unavailable or corrupt ⇒ silently fall back to default
      setPosition(null);
    }
  }, [storageKey]);

  // Track viewport size so we can reclamp on resize / sidebar collapse
  // and disable drag entirely when the viewport is narrower than the card.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const tooSmall = window.innerWidth < CARD_WIDTH + DEFAULT_OFFSET * 2;
      setViewportTooSmall(tooSmall);
      setPosition(prev => {
        if (prev == null) return prev;
        const h = cardRef.current ? cardRef.current.offsetHeight : 160;
        return clampToViewport(prev.x, prev.y, CARD_WIDTH, h);
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const savePosition = useCallback((pos) => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        x: pos.x,
        y: pos.y,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        saved_at: new Date().toISOString()
      }));
    } catch (_) { /* localStorage unavailable / quota — non-fatal */ }
  }, [storageKey]);

  const resetPosition = useCallback(() => {
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch (_) { /* ignore */ }
    }
    setPosition(null);
    setStatusMessage('Card reset to default position');
  }, [storageKey]);

  // ───────────── Pointer / drag handlers ─────────────
  const onPointerDown = (e) => {
    if (viewportTooSmall) return;
    // Pressing on a button, link, or anything explicitly opted-out ⇒ leave
    // native interaction alone (the "Open Alert" click must still fire).
    if (e.target.closest('button, a, [data-no-drag]')) return;
    if (e.button !== undefined && e.button !== 0) return; // primary button only
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
    if (!s.moved) {
      s.moved = true;
      setDragging(true);
    }
    const card = cardRef.current;
    const w = card ? card.offsetWidth : CARD_WIDTH;
    const h = card ? card.offsetHeight : 160;
    const clamped = clampToViewport(s.origLeft + dx, s.origTop + dy, w, h);
    setPosition(clamped);
  };

  const finishDrag = (commit) => {
    const s = dragStateRef.current;
    if (!s.active) return;
    const card = cardRef.current;
    if (card && s.pointerId != null) {
      try { card.releasePointerCapture(s.pointerId); } catch (_) { /* ignore */ }
    }
    s.active = false;
    if (!s.moved) return; // never crossed threshold ⇒ pure click, nothing to commit
    setDragging(false);
    if (commit) {
      // Commit: persist current position and announce.
      const w = card ? card.offsetWidth : CARD_WIDTH;
      const h = card ? card.offsetHeight : 160;
      const rect = card ? card.getBoundingClientRect() : null;
      const finalPos = rect
        ? { x: rect.left, y: rect.top }
        : (position || { x: 0, y: 0 });
      savePosition(finalPos);
      setStatusMessage(`Card moved to ${describePosition(finalPos.x, finalPos.y, w, h)}`);
    } else {
      // Cancel: revert to pre-drag position (Escape during drag).
      setPosition(s.preDragPosition);
      setStatusMessage('Drag cancelled');
    }
  };

  const onPointerUp = () => finishDrag(true);
  const onPointerCancel = () => finishDrag(false);

  // ───────────── Keyboard handlers (focused grip) ─────────────
  const moveBy = (dx, dy) => {
    const card = cardRef.current;
    const w = card ? card.offsetWidth : CARD_WIDTH;
    const h = card ? card.offsetHeight : 160;
    let base = position;
    if (!base) {
      if (card) {
        const r = card.getBoundingClientRect();
        base = { x: r.left, y: r.top };
      } else {
        base = { x: 0, y: 0 };
      }
    }
    const next = clampToViewport(base.x + dx, base.y + dy, w, h);
    setPosition(next);
    savePosition(next);
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

  // Manager / L2 / unauthenticated → don't render anything.
  if (!isL1 || !currentAnalyst) return null;
  // No data yet (first paint) — stay silent, the workspace shouldn't flash
  // a placeholder for a secondary panel.
  if (alerts === null) return null;

  const next = getNextUpAlert(alerts, excludeAlertId, currentAnalyst);
  if (!next) return null;

  const sla = getSlaDescriptor(next);
  const borderColor = sla.tone === 'red' ? '#DC2626' : sla.tone === 'amber' ? '#F59E0B' : '#2563EB';
  const slaCls = sla.tone === 'red' ? 'text-red-700' : sla.tone === 'amber' ? 'text-amber-700' : 'text-blue-700';

  const isPep = Number(next.pep_match) === 1;
  const isSanctions = Number(next.sanctions_match) === 1;
  const isHighRisk = next.customer_risk_rating === 'Very High' || next.customer_risk_rating === 'High';
  const amount = `$${Number(next.amount_flagged_inr || 0).toLocaleString('en-US')}`;

  // Compose positional style. Default = bottom-right anchor (unchanged from
  // pre-drag behaviour). Once dragged or restored, switch to absolute
  // top/left in viewport coords. Tiny viewports force the default anchor.
  const positionalStyle = (position && !viewportTooSmall)
    ? { top: position.y, left: position.x, bottom: 'auto', right: 'auto' }
    : { bottom: DEFAULT_OFFSET, right: DEFAULT_OFFSET };

  const dragCursorStyle = viewportTooSmall ? 'default' : (dragging ? 'grabbing' : 'grab');
  const shadow = dragging
    ? '0 18px 35px -10px rgba(15, 23, 42, 0.4)'
    : '0 10px 25px -8px rgba(15, 23, 42, 0.25)';

  return (
    <aside
      ref={cardRef}
      role="complementary"
      aria-label="Next priority alert"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="bg-white rounded-lg group"
      style={{
        position: 'fixed',
        ...positionalStyle,
        width: CARD_WIDTH,
        zIndex: 40,
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: shadow,
        padding: '12px 14px',
        opacity: dragging ? 0.95 : 1,
        transition: 'box-shadow 150ms ease, opacity 150ms ease',
        cursor: dragCursorStyle,
        touchAction: viewportTooSmall ? 'auto' : 'none',
        userSelect: dragging ? 'none' : 'auto'
      }}
    >
      {/* Accessibility live region — visually hidden, announces position changes */}
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1, height: 1,
          padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap', border: 0
        }}
      >{statusMessage}</span>

      <div className="flex items-center gap-1.5 mb-1.5">
        {/* Drag handle + reset (reset shows on hover/focus only) */}
        {!viewportTooSmall && (
          /* Grip is a visual + keyboard affordance. We deliberately do NOT
             add data-no-drag here — pointer presses on the grip should
             still initiate a drag (drag from "the entire card surface
             other than buttons"). The role=button + tabIndex make it
             keyboard-focusable for the arrow-keys / Home / Escape shortcuts. */
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
        {!viewportTooSmall && position && (
          <button
            type="button"
            data-no-drag
            onClick={resetPosition}
            aria-label="Reset card position to default"
            title="Reset position"
            className="ml-auto inline-flex items-center text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

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

      <button
        type="button"
        data-no-drag
        onClick={() => onOpen ? onOpen(next) : null}
        className="mt-3 w-full inline-flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded px-3 py-1.5"
      >
        <PlayCircle size={12} />
        Open Alert →
      </button>
    </aside>
  );
}
