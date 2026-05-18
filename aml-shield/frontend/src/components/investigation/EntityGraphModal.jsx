import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import EntityAlertTimeline from './EntityAlertTimeline.jsx';
import {
  X, Network, Loader2, Flame, ZoomIn, ZoomOut, Maximize2,
  ChevronDown, ChevronRight, ExternalLink, Building2, FileText, ShieldAlert,
  Users
} from 'lucide-react';
import api from '../../api/client.js';

// Lazy-loaded so the graph library (~150KB) doesn't ship in the main bundle.
const ForceGraph2D = lazy(() => import('react-force-graph-2d'));

// ─────────────────────────────────────────────────────────────────────────
// Cross-Case Entity Network — clean two-panel design.
//
//   Left  (65%): force-directed graph on a dark canvas.
//   Right (35%): contextual detail panel — welcome state by default,
//                rich per-node detail when the analyst clicks a node.
//
// All five node types (PERSON, COMPANY, ACCOUNT, CASE, SAR) keep their
// taxonomy colours. SAR isolation for L1 is enforced at the backend by
// the x-user-role header on /api/customers/:id/graph; the right-side
// panel also gates the "Open Investigation" button by role.
// ─────────────────────────────────────────────────────────────────────────

// Person → bright blue (sky-500), Company / Counterparty → yellow
// (yellow-500). ACCOUNT / CASE colours retained for downstream surfaces
// that still reference them (CASE no longer renders on the canvas).
const COLORS = {
  PERSON:  '#0EA5E9',
  COMPANY: '#EAB308',
  ACCOUNT: '#185FA5',
  CASE:    '#534AB7',
  SAR:     '#A32D2D'
};

const TYPE_LABEL = {
  PERSON:  'Person',
  COMPANY: 'Company',
  ACCOUNT: 'Account',
  CASE:    'Case',
  SAR:     'SAR'
};

const NODE_RADIUS = {
  FOCUS:        14,
  COUNTERPARTY: 10,
  NEIGHBOUR:    10,
  CASE:         8,
  SAR:          8,
  DEFAULT:      8
};

function radiusFor(node) {
  if (node.is_focus) return NODE_RADIUS.FOCUS;
  // C-10: counterparty nodes scale by log of global txn_count in Phase B
  // so a node that transacts with many customers visually stands out.
  if (node.is_counterparty && node.counterparty_id) {
    const cnt = Number(node.txn_count) || 0;
    return Math.max(6, Math.min(20, 6 + Math.log(cnt + 1) * 2));
  }
  if (node.is_counterparty) return NODE_RADIUS.COUNTERPARTY;
  if (node.is_neighbour) return NODE_RADIUS.NEIGHBOUR;
  if (node.type === 'CASE') return NODE_RADIUS.CASE;
  if (node.type === 'SAR') return NODE_RADIUS.SAR;
  return NODE_RADIUS.DEFAULT;
}

// C-10: a counterparty is a Phase-B first-class entity when the
// backend handed us a counterparty_id. Phase A nodes stay as circles
// so the visual upgrade only kicks in once the dedup backfill has run.
function isPhaseBCounterparty(node) {
  return !!(node?.is_counterparty && node?.counterparty_id);
}

function fmtVolumeShort(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function truncateLabel(s, n = 18) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function readUser() {
  try { return JSON.parse(localStorage.getItem('aml_shield_user') || 'null'); } catch (_e) { return null; }
}

function rolePrefixFor(role) {
  if (role === 'bsa_officer')        return '/bsa';
  if (role === 'compliance_manager') return '/manager';
  return '/employee';
}

function initialsOf(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE AUDIT — pre-addition
//
// What the modal already does (read from the actual code, not the spec):
//
//   1. Right-side panel JSX lives inside <SidePanel>. When the user has not
//      clicked a node, <WelcomeState> renders ("IN THIS NETWORK" counts +
//      flagged entities). When `selected` is set, the panel routes by
//      node.type to one of: AlertDetails / SarDetails / CounterpartyDetails
//      / CustomerDetails.
//   2. selectedNode is the local state `selected` (line 108) — set by
//      onNodeClick={(node) => setSelected(node)}. A selected customer node
//      carries the customer columns (customer_id, customer_name, risk,
//      pep, sanctions, country, …) but NOT its alert list — the alerts
//      live as separate nodes connected by APPEARS_IN links.
//   3. Graph data flows in via a single fetch in the mount effect (around
//      line 145). state name is `data`, holding { focus_id, nodes, links,
//      meta }. The component does NOT re-fetch on node selection.
//   4. Alert nodes are `node.type === 'CASE'` (the backend graph endpoint's
//      taxonomy). Each carries alert_id, scenario, alert_status, priority,
//      created_date, linked_sar_id, amount_flagged_inr, rule_explanation
//      from routes/customers.js graph query. SAR nodes are `node.type ===
//      'SAR'` and carry sar_id, sar_status, filed_date, filing_type,
//      amount. The task spec's `n.type === 'alert' / 'sar' / 'customer' /
//      'counterparty'` filter language must be translated to the real
//      conventions: 'CASE', 'SAR', 'PERSON'|'COMPANY' (without
//      is_counterparty), and `is_counterparty === true`.
//   5. An onNodeClick handler already exists and only does setSelected
//      (the timeline mounts inside the SidePanel branches; no new click
//      hook required).
//
// What the timeline addition needs from the backend that isn't there yet:
//   * Alert nodes: assigned_to, disposition.
//   * SAR nodes:   narrative_summary (truncated to 120 chars; gated server-
//     side by virtue of L1 not getting SAR nodes at all).
// Those four columns are appended to the existing SELECTs in routes/
// customers.js. No restructuring of the graph response envelope.
// ═══════════════════════════════════════════════════════════════════════════

export default function EntityGraphModal({ customerId, customerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);
  // Tableau-style filter modes.
  //   mode='all'      — full graph (default).
  //   mode='keepOnly' — show only the first-order neighbourhood of one node.
  //   mode='exclude'  — hide the listed nodes (and edges touching them).
  // Excluded ids accumulate; Reset returns to 'all'.
  const [filter, setFilter] = useState({ mode: 'all', ids: [] });
  // Right-click context menu state. Coordinates are page-relative.
  const [contextMenu, setContextMenu] = useState(null);
  // Graph-navigation state. The modal opens centered on the `customerId`
  // prop, but the analyst can re-center the canvas onto any neighbour
  // customer they click into. `currentCustomerId` drives the fetch;
  // `navHistory` holds breadcrumbs so we can render a "Back" chip.
  const [currentCustomerId, setCurrentCustomerId] = useState(customerId);
  const [navHistory, setNavHistory] = useState([]);

  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Read the logged-in user's role/name from localStorage — used by the
  // role-aware action buttons in the right panel (Open Investigation /
  // Open Customer Profile go to /manager, /bsa, or /employee accordingly).
  const user = useMemo(() => readUser(), []);
  const userRole = user?.role || null;
  const userName = user?.name || null;
  const rolePrefix = useMemo(() => rolePrefixFor(userRole), [userRole]);

  // C-10/follow-up: alert/case nodes are surfaced ONLY in the right-panel
  // timeline now — not on the canvas. The graph stays focused on identity
  // (customer ↔ counterparty ↔ SAR), with the timeline answering "what
  // happened with this entity" when an analyst clicks any node. The full
  // `data` (with CASE nodes) is preserved for the timeline; only the
  // canvas reads `displayData`. Links touching a filtered-out CASE node
  // are dropped so the layout doesn't try to render dangling edges.
  const displayData = useMemo(() => {
    if (!data) return null;
    // Step 1: always drop CASE nodes (they live in the right-panel timeline).
    const hiddenIds = new Set(
      (data.nodes || []).filter(n => n.type === 'CASE').map(n => n.id)
    );

    // Step 2: apply the Tableau-style filter on top.
    const filterIds = new Set(filter.ids || []);
    if (filter.mode === 'exclude' && filterIds.size > 0) {
      for (const id of filterIds) hiddenIds.add(id);
    } else if (filter.mode === 'keepOnly' && filterIds.size > 0) {
      // Keep the listed nodes + every node connected to them by a direct
      // (CASE-free) link. The result is the "first-order neighbourhood".
      const keep = new Set(filterIds);
      for (const l of data.links || []) {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (hiddenIds.has(s) || hiddenIds.has(t)) continue;
        if (filterIds.has(s)) keep.add(t);
        if (filterIds.has(t)) keep.add(s);
      }
      for (const n of data.nodes || []) {
        if (!keep.has(n.id) && !hiddenIds.has(n.id)) hiddenIds.add(n.id);
      }
    }

    return {
      ...data,
      nodes: (data.nodes || []).filter(n => !hiddenIds.has(n.id)),
      links: (data.links || []).filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return !hiddenIds.has(s) && !hiddenIds.has(t);
      })
    };
  }, [data, filter]);

  // Adjacency map keyed by node id → Set of connected node ids. Used by the
  // dim-others-on-select rule so a click on a node highlights its first-order
  // neighbourhood. Built from displayData so canvas-only nodes stay
  // consistent (CASE nodes aren't on the canvas so they can't be neighbours).
  const adjacency = useMemo(() => {
    const map = new Map();
    if (!displayData) return map;
    for (const l of displayData.links || []) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s).add(t);
      map.get(t).add(s);
    }
    return map;
  }, [displayData]);

  // Fetch graph payload. Do NOT auto-select the focus — the right panel
  // defaults to the welcome state per spec.
  // If the prop changes (parent navigation), reset internal navigation
  // state to the new focus.
  useEffect(() => {
    setCurrentCustomerId(customerId);
    setNavHistory([]);
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setSelected(null);
    api.get(`/customers/${currentCustomerId}/graph`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.error || err.message || 'Failed to load graph');
      });
    return () => { cancelled = true; };
  }, [currentCustomerId]);

  // Track container size for the force graph
  useEffect(() => {
    if (!containerRef.current) return;
    const update = () => {
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: Math.max(400, r.width), h: Math.max(300, r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Tune the d3 forces once the simulation is running. Aggressive repulsion
  // + longer target link distance — pushes nodes apart so the dense hub of
  // a high-risk customer (12 counterparties + 8 alerts radiating from one
  // focus) doesn't collapse into a tight overlapping ring.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    try {
      const chargeForce = fgRef.current.d3Force('charge');
      if (chargeForce) chargeForce.strength(-320);
      const linkForce = fgRef.current.d3Force('link');
      if (linkForce) linkForce.distance(140);
    } catch (_) { /* older lib versions may not expose d3Force */ }
  }, [data]);

  // Once the simulation has settled, fit the whole network in view with
  // extra-generous padding (150px). The fit zoom then lands roughly
  // around 0.4-0.5 — below the 0.7 flagged-label threshold below, so the
  // graph opens visually clean.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    const t = setTimeout(() => {
      try { fgRef.current.zoomToFit(400, 150); } catch (_) { /* ignore */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [data]);

  // Fade the keyboard-hint chip after 5s on first open.
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // Escape closes the modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Body-class lock — prevents underlying scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const zoomIn  = () => { if (fgRef.current) try { fgRef.current.zoom(fgRef.current.zoom() * 1.3, 300); } catch (_) { /* ignore */ } };
  const zoomOut = () => { if (fgRef.current) try { fgRef.current.zoom(fgRef.current.zoom() * 0.7, 300); } catch (_) { /* ignore */ } };
  const fitAll  = () => { if (fgRef.current) try { fgRef.current.zoomToFit(400, 80); } catch (_) { /* ignore */ } };

  // Right-click on any node now opens the filter context menu (Keep Only /
  // Exclude / Reset / Open Profile). The previous behaviour — opening the
  // customer profile in a new tab — is preserved as a context-menu item so
  // no functionality is lost.
  const onNodeContext = (node, event) => {
    if (!node) return;
    // react-force-graph-2d forwards the native event as the 2nd arg.
    // Use page coordinates so the menu lands at the cursor regardless of
    // the modal's scroll position.
    const x = event?.pageX ?? event?.clientX ?? 0;
    const y = event?.pageY ?? event?.clientY ?? 0;
    setContextMenu({ x, y, node });
  };

  const openCustomerProfile = (node) => {
    if (!node || !node.customer_id) return;
    if (node.type !== 'PERSON' && node.type !== 'COMPANY') return;
    if (node.is_counterparty) return;
    const url = `${rolePrefix}/customers/${encodeURIComponent(node.customer_id)}`;
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ }
  };

  // Filter actions wired to the context menu.
  const filterKeepOnly = (nodeId) => {
    setFilter({ mode: 'keepOnly', ids: [nodeId] });
    setSelected(null);
  };
  const filterExclude = (nodeId) => {
    setFilter(prev => {
      if (prev.mode === 'exclude') {
        // Additive: union the new id into the existing exclude set.
        const ids = Array.from(new Set([...prev.ids, nodeId]));
        return { mode: 'exclude', ids };
      }
      return { mode: 'exclude', ids: [nodeId] };
    });
    setSelected(null);
  };
  const filterReset = () => {
    setFilter({ mode: 'all', ids: [] });
  };

  // Re-center the canvas onto a different customer. Pushes the current
  // focus onto navHistory so the analyst can step back. Also resets the
  // filter + selection so they don't carry over.
  const recenterOn = (newCustomerId) => {
    if (!newCustomerId || newCustomerId === currentCustomerId) return;
    setNavHistory(prev => [...prev, currentCustomerId]);
    setCurrentCustomerId(newCustomerId);
    setFilter({ mode: 'all', ids: [] });
    setSelected(null);
  };
  const navigateBack = () => {
    setNavHistory(prev => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const target = prev[prev.length - 1];
      setCurrentCustomerId(target);
      setFilter({ mode: 'all', ids: [] });
      setSelected(null);
      return next;
    });
  };

  // Close the context menu on any outside click / Escape press.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const t = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const isEmpty = data && data.nodes.length <= 1 && data.links.length === 0;

  // Network counts for the welcome state.
  const networkCounts = useMemo(() => {
    if (!data) return null;
    let customers = 0, counterparties = 0, alerts = 0, sars = 0;
    for (const n of data.nodes) {
      if (n.type === 'CASE') alerts++;
      else if (n.type === 'SAR') sars++;
      else if (n.is_counterparty) counterparties++;
      else if (n.type === 'PERSON' || n.type === 'COMPANY') customers++;
    }
    return { customers, counterparties, alerts, sars };
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(2, 6, 23, 0.78)', padding: 24 }}
      role="dialog"
      aria-modal="true"
      aria-label="Entity network graph"
    >
      <div className="rounded-lg flex-1 flex flex-col overflow-hidden shadow-2xl border border-slate-200 bg-white">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-4 text-slate-700 bg-white">
          <Network size={18} className="text-teal-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-navy-900">Entity Network</div>
            <div className="text-[11px] text-slate-500 truncate">
              {data ? `${data.nodes.length} nodes · ${data.links.length} connections` : 'Loading…'}
              {customerName ? ` · ${customerName}` : ''}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {data && !isEmpty && (
              <div className="hidden md:flex items-center gap-1">
                <ChromeButton onClick={zoomIn}  title="Zoom in"><ZoomIn size={14} /></ChromeButton>
                <ChromeButton onClick={zoomOut} title="Zoom out"><ZoomOut size={14} /></ChromeButton>
                <ChromeButton onClick={fitAll}  title="Fit all to view"><Maximize2 size={14} /></ChromeButton>
                <span className="mx-2 h-5 w-px bg-slate-200" />
              </div>
            )}
            <ChromeButton onClick={onClose} title="Close (Esc)"><X size={16} /></ChromeButton>
          </div>
        </div>

        {/* ── Body: graph (65%) + details (35%) ──────────────────── */}
        <div className="flex-1 flex min-h-0">
          <div
            ref={containerRef}
            className="relative"
            style={{
              background: '#F8FAFC',
              flex: '0 0 70%',
              maxWidth: '70%',
              cursor: hoveredNode ? 'pointer' : 'default'
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => { setHoveredNode(null); setHoveredLink(null); }}
          >
            {error ? (
              <Centered>
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">Failed to load graph: {error}</div>
              </Centered>
            ) : !data ? (
              <LoadingState />
            ) : isEmpty ? (
              <Centered>
                <div className="text-center max-w-md px-6">
                  <Network size={36} className="text-slate-300 mx-auto mb-3" />
                  <div className="text-sm font-medium text-navy-900">No connected entities found</div>
                  <div className="text-xs text-slate-500 mt-2">
                    This customer has no shared counterparties with other
                    customers in the current dataset.
                  </div>
                </div>
              </Centered>
            ) : (
              <Suspense fallback={<LoadingState />}>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={displayData}
                  width={size.w}
                  height={size.h}
                  backgroundColor="#F8FAFC"
                  nodeRelSize={5}
                  nodeCanvasObject={(node, ctx, globalScale) =>
                    drawNode(node, ctx, globalScale, selected, hoveredNode, adjacency)
                  }
                  nodePointerAreaPaint={(node, color, ctx) => {
                    ctx.fillStyle = color;
                    const r = radiusFor(node) + 4;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fill();
                  }}
                  linkColor={(l) => linkColor(l, selected)}
                  linkWidth={(l) => linkWidth(l)}
                  linkLineDash={(l) => l.computed ? [3, 3] : null}
                  // Money-flow direction. Larger arrows (6px) sit at the
                  // target end so the eye lands on the receiving entity.
                  // Particles animate in the same direction; their count
                  // is log-scaled to the transaction count so high-volume
                  // edges visibly shimmer. Bidirectional (near-zero net
                  // flow) edges get a single particle in each direction.
                  linkDirectionalArrowLength={(l) => l.type === 'TRANSACTS_WITH' ? 6 : 3}
                  linkDirectionalArrowRelPos={0.92}
                  linkDirectionalParticles={(l) => {
                    if (l.type !== 'TRANSACTS_WITH') return 0;
                    if (l.direction === 'bidirectional') return 2;
                    const cnt = Number(l.txn_count) || 0;
                    return Math.max(1, Math.min(4, Math.round(Math.log10(cnt + 1) + 1)));
                  }}
                  linkDirectionalParticleSpeed={(l) => l.alerted ? 0.012 : 0.006}
                  linkDirectionalParticleWidth={(l) => l.alerted ? 3 : 2}
                  linkDirectionalParticleColor={(l) => l.alerted ? '#DC2626' : '#475569'}
                  onNodeClick={(node) => setSelected(node)}
                  onNodeHover={(node) => setHoveredNode(node || null)}
                  onBackgroundClick={() => setSelected(null)}
                  onLinkHover={(link) => setHoveredLink(link || null)}
                  onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y; }}
                  onNodeRightClick={onNodeContext}
                  cooldownTicks={200}
                  warmupTicks={80}
                  d3VelocityDecay={0.4}
                  d3AlphaDecay={0.02}
                />
              </Suspense>
            )}

            {/* Hover-following label tooltip — only shows when the analyst
                hovers a node whose permanent label is hidden. */}
            {hoveredNode && shouldShowHoverLabel(hoveredNode) && (
              <div
                className="absolute pointer-events-none rounded px-2 py-1 text-[11px] font-medium text-navy-900 border border-slate-200 shadow-md"
                style={{
                  top: cursorPos.y + 14,
                  left: cursorPos.x + 14,
                  background: 'rgba(255, 255, 255, 0.98)',
                  zIndex: 30,
                  maxWidth: 240
                }}
              >
                {hoveredNode.label}
              </div>
            )}

            {/* Edge-hover tooltip */}
            {hoveredLink && (
              <EdgeTooltip link={hoveredLink} pos={cursorPos} data={data} />
            )}

            {/* Bottom-left collapsible legend */}
            {data && !isEmpty && (
              <GraphLegend open={legendOpen} onToggle={() => setLegendOpen(o => !o)} />
            )}

            {/* C-10: phase indicator — tells the analyst whether the graph
                is using string-equality dedup (Phase A) or proper entity
                FK joins (Phase B). Removable once Phase B is universal. */}
            {data?.meta?.graphPhase && (
              <div
                className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-[10px] font-medium px-2 py-1 rounded ${
                  data.meta.graphPhase === 'entity_fk'
                    ? 'bg-teal-100 text-teal-800 border border-teal-300'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                } pointer-events-none`}
                title={data.meta.graphPhase === 'entity_fk'
                  ? 'Graph using counterparty_id FK joins (C-10 Phase B)'
                  : 'Graph using counterparty_normalised string matching (C-10 Phase A — backfill not yet run)'}
              >
                Graph: {data.meta.graphPhase === 'entity_fk' ? 'entity-linked' : 'normalised matching'}
              </div>
            )}

            {/* Bottom-right one-shot hint */}
            {hintVisible && data && (
              <div
                className="absolute bottom-4 right-4 text-[10px] text-slate-600 border border-slate-200 rounded px-2 py-1 pointer-events-none transition-opacity duration-500 shadow-sm"
                style={{ background: 'rgba(255,255,255,0.95)', opacity: hintVisible ? 1 : 0 }}
              >
                Click a node to explore · Right-click for filter
              </div>
            )}

            {/* Top-left back chip. Appears whenever the analyst has
                re-centered onto a different customer; clicking pops the
                navigation history one level. */}
            {navHistory.length > 0 && (
              <button
                type="button"
                onClick={navigateBack}
                className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:border-blue-400 text-slate-700 text-[11px] font-semibold rounded-md px-2.5 py-1 shadow-sm"
                title="Return to the previous customer focus"
              >
                ← Back
              </button>
            )}

            {/* Top-right active-filter chip. Shows when keepOnly/exclude is
                active so the analyst always sees that the canvas is
                non-default + can reset in one click. */}
            {filter.mode !== 'all' && (
              <div className="absolute top-3 right-3 z-20 inline-flex items-center gap-2 bg-blue-50 border border-blue-300 text-blue-800 text-[11px] font-semibold rounded-md px-2.5 py-1 shadow-sm">
                {filter.mode === 'keepOnly' ? (
                  <span>Filter: Keep Only · 1 node + neighbours</span>
                ) : (
                  <span>Filter: Excluding {filter.ids.length} node{filter.ids.length === 1 ? '' : 's'}</span>
                )}
                <button
                  type="button"
                  onClick={filterReset}
                  className="text-blue-700 hover:text-blue-900 underline text-[11px]"
                >
                  Reset
                </button>
              </div>
            )}
          </div>

          {/* Right side panel — welcome state or node details. */}
          <SidePanel
            node={selected}
            data={data}
            counts={networkCounts}
            customerName={customerName}
            customerId={currentCustomerId}
            userRole={userRole}
            userName={userName}
            rolePrefix={rolePrefix}
            adjacency={adjacency}
            onSelectNode={setSelected}
            onRecenter={recenterOn}
          />
        </div>

        {/* Right-click context menu. Rendered at the top level so its
            page-absolute positioning sits above the canvas + side panel. */}
        {contextMenu && (
          <NodeContextMenu
            menu={contextMenu}
            onKeepOnly={() => { filterKeepOnly(contextMenu.node.id); setContextMenu(null); }}
            onExclude={() => { filterExclude(contextMenu.node.id); setContextMenu(null); }}
            onReset={() => { filterReset(); setContextMenu(null); }}
            onOpenProfile={() => { openCustomerProfile(contextMenu.node); setContextMenu(null); }}
            onRecenter={() => { recenterOn(contextMenu.node.customer_id); setContextMenu(null); }}
            currentCustomerId={currentCustomerId}
            filterActive={filter.mode !== 'all'}
          />
        )}
      </div>
    </div>
  );
}

// Tableau-style context menu shown on right-click of a graph node.
function NodeContextMenu({ menu, onKeepOnly, onExclude, onReset, onOpenProfile, onRecenter, currentCustomerId, filterActive }) {
  const isCustomer = (menu.node.type === 'PERSON' || menu.node.type === 'COMPANY') && !menu.node.is_counterparty && menu.node.customer_id;
  const isOtherCustomer = isCustomer && menu.node.customer_id !== currentCustomerId;
  const label = menu.node.label || menu.node.customer_name || menu.node.id;
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] bg-white border border-slate-200 rounded-md shadow-lg text-xs text-slate-700"
      style={{ top: menu.y + 4, left: menu.x + 4, minWidth: 200 }}
    >
      <div className="px-3 py-2 border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 truncate" title={label}>
        {label}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={onKeepOnly}
        className="w-full text-left px-3 py-2 hover:bg-slate-50"
      >
        Keep Only
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onExclude}
        className="w-full text-left px-3 py-2 hover:bg-slate-50"
      >
        Exclude
      </button>
      {filterActive && (
        <button
          type="button"
          role="menuitem"
          onClick={onReset}
          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100"
        >
          Reset Filter
        </button>
      )}
      {isOtherCustomer && (
        <button
          type="button"
          role="menuitem"
          onClick={onRecenter}
          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100 text-blue-700 font-medium"
        >
          Re-center Graph Here →
        </button>
      )}
      {isCustomer && (
        <button
          type="button"
          role="menuitem"
          onClick={onOpenProfile}
          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100 text-blue-700"
        >
          Open Customer Profile ↗
        </button>
      )}
    </div>
  );
}

// ─── Hover label rule ───────────────────────────────────────────────────
// Show the cursor-following tooltip on every node EXCEPT the focus (which
// always carries a permanent label below its body — a hover tooltip would
// just duplicate it at the cursor). Flagged nodes now get hover labels
// too, because their permanent labels only appear above zoom 0.7 — when
// zoomed out the hover tooltip is the only way to read their name.
function shouldShowHoverLabel(node) {
  if (!node) return false;
  if (node.is_focus) return false;
  return true;
}

// ─── Loading state ──────────────────────────────────────────────────────
function LoadingState() {
  return (
    <Centered>
      <div className="relative w-64 h-32 mb-4">
        <span className="absolute left-1/2 top-2 -translate-x-1/2 block w-5 h-5 rounded-full bg-slate-300 animate-pulse" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 block w-3 h-3 rounded-full bg-slate-200 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 block w-4 h-4 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '300ms' }} />
        <span className="absolute left-12 bottom-1 block w-3 h-3 rounded-full bg-slate-200 animate-pulse" style={{ animationDelay: '450ms' }} />
        <span className="absolute right-12 bottom-2 block w-3.5 h-3.5 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '600ms' }} />
        <svg className="absolute inset-0 w-full h-full" aria-hidden>
          <line x1="50%" y1="14" x2="14"  y2="50%" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="50%" y1="14" x2="232" y2="50%" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="14"  y1="50%" x2="60" y2="120" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="232" y1="50%" x2="200" y2="120" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      </div>
      <Loader2 size={16} className="animate-spin text-slate-400" />
      <div className="text-xs text-slate-500 mt-2">Loading entity network…</div>
    </Centered>
  );
}

// ─── Edge color / width helpers ─────────────────────────────────────────
function linkColor(l, selected) {
  const dimmed = selected && !linkTouchesSelected(l, selected);
  if (dimmed) return 'rgba(148, 163, 184, 0.15)';
  if (l.type === 'TRANSACTS_WITH') return l.alerted ? '#DC2626' : '#94A3B8';
  if (l.type === 'CO_OCCURS_WITH') return '#CBD5E1';
  if (l.type === 'APPEARS_IN')     return '#3B82F6';
  if (l.type === 'FILED_BY' || l.type === 'SUBJECT_OF') return '#A32D2D';
  return '#94A3B8';
}

function linkWidth(l) {
  if (l.type === 'TRANSACTS_WITH') return l.alerted ? 2 : 1;
  if (l.type === 'CO_OCCURS_WITH') return 0.5;
  return 1;
}

function linkTouchesSelected(link, selected) {
  if (!selected) return true;
  const s = typeof link.source === 'object' ? link.source.id : link.source;
  const t = typeof link.target === 'object' ? link.target.id : link.target;
  return s === selected.id || t === selected.id;
}

// ─── Custom node draw ───────────────────────────────────────────────────
function drawNode(node, ctx, globalScale, selected, hoveredNode, adjacency) {
  // C-10: Phase B counterparties get the high-risk orange fill when any
  // risk indicator fires; otherwise they keep the standard COMPANY hue.
  const phaseB = isPhaseBCounterparty(node);
  let color = COLORS[node.type] || '#94A3B8';
  if (phaseB && node.is_high_risk_counterparty) color = '#F97316'; // orange-500
  const r = radiusFor(node);

  // Selection dimming — when a node is clicked, non-neighbour nodes fade
  // heavily so the first-order neighbourhood pops. Tableau-style focus.
  let alpha = 1;
  if (selected) {
    const isSelected   = selected.id === node.id;
    const isConnected  = adjacency.get(selected.id)?.has(node.id);
    alpha = (isSelected || isConnected) ? 1 : 0.1;
  }
  ctx.save();
  ctx.globalAlpha = alpha;

  // Body. Phase B counterparties are drawn as a rotated square (diamond)
  // to visually distinguish them from customer circles. Everything else
  // stays a circle.
  ctx.beginPath();
  if (phaseB) {
    ctx.moveTo(node.x,     node.y - r);
    ctx.lineTo(node.x + r, node.y);
    ctx.lineTo(node.x,     node.y + r);
    ctx.lineTo(node.x - r, node.y);
    ctx.closePath();
  } else {
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
  }
  ctx.fillStyle = color;
  ctx.fill();

  // Hub ring — fires when this counterparty transacts with 3+ ARC
  // customers. Visible at zoom ≥ 0.4. The single most important AML
  // signal the graph can show.
  if (phaseB && Number(node.shared_with_customer_count) >= 3 && globalScale >= 0.4) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7C3AED'; // violet-600
    ctx.stroke();
  }

  // Sanctions / PEP hazard ring (driven by node.risk_indicators in Phase B,
  // node.pep / node.sanctions on customers as before). Kept distinct from
  // the hub ring above — different colour, different meaning.
  if (phaseB && node.risk_indicators?.sanctions_hit) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 1, 0, 2 * Math.PI, false);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#DC2626';
    ctx.stroke();
  }

  // Focus halo (subtle outer ring on the root entity)
  if (node.is_focus) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // High-risk-country dashed ring (drawn first so sanctions/PEP solid rings
  // sit between it and the selection ring)
  if (node.is_high_risk_country) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI, false);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#FF6B35';
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (node.pep || node.sanctions) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 1, 0, 2 * Math.PI, false);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = node.sanctions ? '#DC2626' : '#7C3AED';
    ctx.stroke();
  }

  // Selection ring (blue, outermost)
  if (selected && selected.id === node.id) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 7, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3B82F6';
    ctx.stroke();
  }

  // Label rules — kept intentionally minimal to keep the canvas clean.
  //   - Focus and selected nodes always carry a label (no ambiguity about
  //     what the analyst is anchored to).
  //   - Flagged nodes (sanctions / PEP / high-risk country) only label
  //     themselves once the analyst has zoomed in to globalScale >= 0.7.
  //     At the default fit-to-view zoom (~0.4-0.5) the graph opens with
  //     ONLY the focus labeled, even when many flagged nodes are present
  //     — analysts read flag status from rings, names from hover.
  //   - Every other node is unlabeled on the canvas; names come from the
  //     hover tooltip or the side panel after a click.
  const isSelected = selected && selected.id === node.id;
  const alwaysShow = node.is_focus || isSelected;
  const isFlagged  = node.sanctions || node.pep || node.is_high_risk_country;
  const showLabel  = alwaysShow || (isFlagged && globalScale >= 0.7);
  if (showLabel) {
    const fontSize = Math.max(9, 11 / globalScale);
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = truncateLabel(node.label, 18);
    const padX = 5;
    const padY = 2;
    const textMetrics = ctx.measureText(label);
    const w = textMetrics.width + padX * 2;
    const h = fontSize + padY * 2;
    const x = node.x - w / 2;
    const y = node.y + r + 4;
    // Light-mode pill: near-white fill, slate border, dark text.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.lineWidth = 1;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = '#0F172A';
    ctx.fillText(label, node.x, y + padY);

    // C-10: zoom-gated sub-label for Phase B counterparties showing
    // per-focus txn count + volume. Stricter zoom threshold (0.7) than
    // the primary label (0.6) so it only appears when the analyst is
    // actually zoomed in on a region.
    if (phaseB && globalScale >= 0.7) {
      const subFontSize = Math.max(8, 9 / globalScale);
      ctx.font = `${subFontSize}px Inter, sans-serif`;
      ctx.fillStyle = '#64748B';
      const sub = `${node.txn_count_with_focus ?? 0} txns · ${fmtVolumeShort(node.total_volume)}`;
      ctx.fillText(sub, node.x, y + h + 2);
    }
  }

  ctx.restore();
}

function Centered({ children }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      {children}
    </div>
  );
}

// ─── Header chrome button ───────────────────────────────────────────────
function ChromeButton({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}

// ─── Legend (bottom-left, collapsible) ──────────────────────────────────
function GraphLegend({ open, onToggle }) {
  return (
    <div
      className="absolute bottom-4 left-4 z-20 text-[11px] text-slate-700"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        padding: open ? '10px 14px' : '6px 10px',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)'
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-slate-700 hover:text-navy-900"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold uppercase tracking-wider text-[10px]">Legend</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Node types</div>
            <LegendDot color={COLORS.PERSON}  label="Person (customer)" />
            <LegendDot color={COLORS.COMPANY} label="Company / Counterparty" />
            <LegendDot color={COLORS.SAR}     label="SAR Filing" />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Ring indicators</div>
            <LegendRing color="#DC2626"  dash={false} label="Sanctions match" />
            <LegendRing color="#7C3AED"  dash={false} label="PEP flag" />
            <LegendRing color="#FF6B35"  dash={true}  label="High-risk country" />
          </div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="inline-flex items-center gap-1.5 mr-3 mb-0.5 w-full">
      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-slate-700">{label}</span>
    </div>
  );
}

function LegendRing({ color, dash, label }) {
  return (
    <div className="inline-flex items-center gap-1.5 mr-3 mb-0.5 w-full">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{
          background: 'transparent',
          border: `1.5px ${dash ? 'dashed' : 'solid'} ${color}`
        }}
      />
      <span className="text-slate-700">{label}</span>
    </div>
  );
}

// ─── Edge tooltip ───────────────────────────────────────────────────────
function EdgeTooltip({ link, pos, data }) {
  const lines = describeLink(link, data);
  if (!lines || lines.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: pos.y - 10,
        left: pos.x + 15,
        background: '#1C2128',
        color: 'white',
        border: '1px solid #30363D',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 100,
        maxWidth: 220,
        boxShadow: '0 6px 16px rgba(0,0,0,0.5)'
      }}
    >
      {lines.map((l, i) => (
        <div key={i} className={l.tone === 'red' ? 'text-red-300' : l.tone === 'muted' ? 'text-slate-400 text-[11px]' : ''}>
          {l.tone === 'header' ? <span className="font-semibold">{l.text}</span> : l.text}
        </div>
      ))}
    </div>
  );
}

function describeLink(link, data) {
  const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
  const targetId = typeof link.target === 'object' ? link.target.id : link.target;
  const nodeById = (id) => data?.nodes?.find(n => n.id === id);

  if (link.type === 'TRANSACTS_WITH') {
    const out = [];
    out.push({ tone: 'header', text: `${link.txn_count || 0} transactions` });
    out.push({ text: fmtMoney(link.total_amount) });
    // Flow breakdown (C-10 follow-up). If both sides are populated, show
    // a Sends $X / Receives $Y pair so the analyst sees the directional
    // picture even without inspecting the arrow.
    if (link.outflow_amount != null || link.inflow_amount != null) {
      const outflowAmt = Number(link.outflow_amount) || 0;
      const inflowAmt  = Number(link.inflow_amount)  || 0;
      if (outflowAmt > 0) out.push({ tone: 'muted', text: `Sends ${fmtMoney(outflowAmt)} (${link.outflow_count || 0} txn)` });
      if (inflowAmt  > 0) out.push({ tone: 'muted', text: `Receives ${fmtMoney(inflowAmt)} (${link.inflow_count || 0} txn)` });
    }
    if (link.alerted_count > 0) {
      out.push({ tone: 'red', text: `${link.alerted_count} alerted` });
    }
    return out;
  }
  if (link.type === 'CO_OCCURS_WITH') {
    return [
      { tone: 'header', text: 'Shared counterparty' },
      { tone: 'muted', text: link.via || '(unspecified)' }
    ];
  }
  if (link.type === 'APPEARS_IN') {
    const alertNode = nodeById(targetId) || nodeById(sourceId);
    return [
      { tone: 'header', text: 'Alert connection' },
      { tone: 'muted', text: alertNode?.label || '' }
    ];
  }
  if (link.type === 'FILED_BY' || link.type === 'SUBJECT_OF') {
    const sarNode = nodeById(targetId) || nodeById(sourceId);
    return [
      { tone: 'header', text: 'SAR connection' },
      { tone: 'muted', text: sarNode?.label || '' }
    ];
  }
  return null;
}

// ─── Timeline data derivation ───────────────────────────────────────────
// Build the alert/SAR arrays the EntityAlertTimeline expects, given the
// already-fetched graph data and the currently-selected node. Pure;
// returns empty arrays when the inputs are missing.
//
// Node-type → derivation rules (matching the actual backend taxonomy
// 'CASE' / 'SAR' / customer (PERSON|COMPANY without is_counterparty) /
// counterparty (is_counterparty: true)):
//
//   * Alert (CASE)   → single-event "showing selected" stream.
//   * SAR            → single-event "showing selected" stream.
//   * Customer       → alerts + SARs directly linked to that customer.
//   * Counterparty   → alerts + SARs of every neighbour customer
//                      connected to the counterparty.
function deriveTimeline(data, node) {
  const empty = { alerts: [], sars: [] };
  if (!data || !node) return empty;
  const links = data.links || [];
  const nodes = data.nodes || [];

  if (node.type === 'CASE') return { alerts: [node], sars: [] };
  if (node.type === 'SAR')  return { alerts: [], sars: [node] };

  const neighboursOf = (rootId) => {
    const out = new Set();
    for (const l of links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === rootId) out.add(t);
      else if (t === rootId) out.add(s);
    }
    return out;
  };

  if (!node.is_counterparty) {
    const linked = neighboursOf(node.id);
    const alerts = nodes.filter(n => n.type === 'CASE' && linked.has(n.id));
    const sars   = nodes.filter(n => n.type === 'SAR'  && linked.has(n.id));
    return { alerts, sars };
  }

  const directLinks = neighboursOf(node.id);
  const customerIds = new Set();
  for (const id of directLinks) {
    const n = nodes.find(x => x.id === id);
    if (n && (n.type === 'PERSON' || n.type === 'COMPANY') && !n.is_counterparty) {
      customerIds.add(id);
    }
  }
  const linkedEventIds = new Set();
  for (const c of customerIds) {
    for (const id of neighboursOf(c)) linkedEventIds.add(id);
  }
  const alerts = nodes.filter(n => n.type === 'CASE' && linkedEventIds.has(n.id));
  const sars   = nodes.filter(n => n.type === 'SAR'  && linkedEventIds.has(n.id));
  return { alerts, sars };
}

// 5 most recent alerts/SARs across the whole network — feeds the default
// panel state when nothing is selected.
function deriveNetworkRecent(data) {
  if (!data) return { alerts: [], sars: [] };
  const events = (data.nodes || []).filter(n => n.type === 'CASE' || n.type === 'SAR');
  events.sort((a, b) => {
    const at = a.filed_date || a.created_date || 0;
    const bt = b.filed_date || b.created_date || 0;
    return new Date(bt).getTime() - new Date(at).getTime();
  });
  const top = events.slice(0, 5);
  return {
    alerts: top.filter(n => n.type === 'CASE'),
    sars:   top.filter(n => n.type === 'SAR')
  };
}

// ─── Side panel ─────────────────────────────────────────────────────────
function SidePanel({ node, data, counts, customerName, customerId, userRole, userName, rolePrefix, adjacency, onSelectNode, onRecenter }) {
  const { alerts: timelineAlerts, sars: timelineSars } = useMemo(
    () => deriveTimeline(data, node),
    [data, node]
  );
  const networkRecent = useMemo(() => deriveNetworkRecent(data), [data]);
  const selectedEntityType = node?.is_counterparty
    ? 'counterparty'
    : (node?.type === 'CASE' || node?.type === 'SAR')
      ? 'event'
      : 'customer';
  const selectedEntityLabel = node?.label || node?.customer_name || node?.alert_id || node?.sar_id || '';

  return (
    <aside
      className="border-l border-slate-200 overflow-y-auto text-slate-700 bg-white"
      style={{ flex: '0 0 30%', maxWidth: '30%' }}
    >
      {!node ? (
        <>
          <WelcomeState counts={counts} customerName={customerName} data={data} onSelectNode={onSelectNode} />
          {(networkRecent.alerts.length > 0 || networkRecent.sars.length > 0) && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
                Recent Network Activity
              </div>
              <EntityAlertTimeline
                alerts={networkRecent.alerts}
                sarAlerts={networkRecent.sars}
                entityType="customer"
                entityLabel=""
                userRole={userRole}
                compact={true}
              />
            </div>
          )}
        </>
      ) : (
        <>
          {node.type === 'CASE' ? (
            <AlertDetails node={node} userRole={userRole} userName={userName} rolePrefix={rolePrefix} customerId={customerId} />
          ) : node.type === 'SAR' ? (
            <SarDetails node={node} userRole={userRole} rolePrefix={rolePrefix} />
          ) : node.is_counterparty ? (
            <CounterpartyDetails node={node} data={data} adjacency={adjacency} userRole={userRole} />
          ) : (
            <CustomerDetails node={node} data={data} adjacency={adjacency} userRole={userRole} rolePrefix={rolePrefix} customerId={customerId} onRecenter={onRecenter} />
          )}

          {/* Alert Timeline — appended below the entity details for every
              node type. When the selected node is itself a CASE or SAR,
              the timeline shows just that single event with a "Showing
              selected event" hint. */}
          <div className="mx-5 mt-4 pt-4 border-t border-gray-100 pb-5">
            {selectedEntityType === 'event' && (
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
                Showing selected event
              </div>
            )}
            <EntityAlertTimeline
              alerts={timelineAlerts}
              sarAlerts={timelineSars}
              entityType={selectedEntityType === 'counterparty' ? 'counterparty' : 'customer'}
              entityLabel={selectedEntityLabel}
              userRole={userRole}
            />
          </div>
        </>
      )}
    </aside>
  );
}

// ─── Welcome state (default right panel) ────────────────────────────────
function WelcomeState({ counts, customerName, data, onSelectNode }) {
  // Collect every flagged node (sanctions, PEP, or high-risk country).
  // Sorted by severity — sanctions first, then PEP, then high-risk country.
  const flagged = useMemo(() => {
    if (!data?.nodes) return [];
    const items = data.nodes
      .filter(n => n.sanctions || n.pep || n.is_high_risk_country)
      .filter(n => !n.is_focus); // focus is already labeled in the center
    items.sort((a, b) => {
      const score = (x) => (x.sanctions ? 3 : 0) + (x.pep ? 2 : 0) + (x.is_high_risk_country ? 1 : 0);
      return score(b) - score(a);
    });
    return items;
  }, [data]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center bg-teal-50 border border-teal-200 mb-3">
          <Network size={24} className="text-teal-600" />
        </div>
        <div className="text-base font-bold text-navy-900">Entity Network</div>
        <div className="text-xs text-slate-500 mt-1.5 max-w-xs">
          Click any node to see details about that entity and its connections.
        </div>
      </div>

      {/* Network counts */}
      {counts && (
        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">In this network</div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat icon={Users}        label="Customers"      value={counts.customers} />
            <SummaryStat icon={Building2}    label="Counterparties" value={counts.counterparties} />
            <SummaryStat icon={ShieldAlert}  label="Alerts"         value={counts.alerts} />
            {counts.sars > 0 && <SummaryStat icon={FileText} label="SARs" value={counts.sars} />}
          </div>
          {customerName && (
            <div className="mt-3 text-[11px] text-slate-500">
              Focus: <span className="text-navy-900 font-medium">{customerName}</span>
            </div>
          )}
        </div>
      )}

      {/* Flagged entities list — surfaces every PEP / sanctions / high-risk
          country node from the network as a clickable row. Replaces the
          "always show flagged labels on canvas" pattern that piled labels
          on top of each other when the network had many flagged entities. */}
      {flagged.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame size={11} className="text-orange-500" />
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Flagged entities ({flagged.length})
            </div>
          </div>
          <div className="space-y-1.5">
            {flagged.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode && onSelectNode(n)}
                className="w-full flex items-start gap-2 text-left border border-slate-200 hover:border-blue-300 hover:bg-blue-50 rounded px-2.5 py-1.5 transition"
                title={`Focus on ${n.label}`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                  style={{ backgroundColor: COLORS[n.type] || '#94A3B8' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-navy-900 truncate">{n.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {n.sanctions && <FlagChip tone="red">Sanctions</FlagChip>}
                    {n.pep && <FlagChip tone="purple">PEP</FlagChip>}
                    {n.is_high_risk_country && <FlagChip tone="orange">High Risk</FlagChip>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlagChip({ tone, children }) {
  const cls = {
    red:    'bg-red-50    text-red-700    border-red-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200'
  }[tone] || 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${cls}`}>
      {children}
    </span>
  );
}

function SummaryStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 inline-flex items-center gap-1">
        <Icon size={10} /> {label}
      </div>
      <div className="text-lg font-bold text-navy-900 tabular-nums">{value || 0}</div>
    </div>
  );
}

// ─── Customer details (focus or neighbour) ──────────────────────────────
function CustomerDetails({ node, data, adjacency, userRole, rolePrefix, customerId: focusCustomerId, onRecenter }) {
  // Build the connection summary for neighbours from the existing links payload.
  let neighbourSummary = null;
  if (node.is_neighbour && data?.links) {
    // Find the link that connects this neighbour to either the focus or a
    // shared counterparty hub. We render the via_counterparty stored on the
    // node when present (always set by the backend for neighbours).
    neighbourSummary = node.via_counterparty || null;
  }

  const profileHref = node.customer_id
    ? `${rolePrefix}/customers/${encodeURIComponent(node.customer_id)}`
    : null;

  return (
    <div className="p-5 space-y-5">
      {/* Header: avatar + name */}
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-full inline-flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ background: COLORS[node.type] || '#94A3B8' }}
        >
          {initialsOf(node.label)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-navy-900 break-words">{node.label}</div>
          {node.customer_id && (
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{node.customer_id}</div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Chip tone="slate">{node.customer_type === 'Business' ? 'Business' : 'Individual'}</Chip>
            {node.is_focus && <Chip tone="blue">Focus</Chip>}
            {node.is_neighbour && <Chip tone="slate-soft">Neighbour</Chip>}
          </div>
          {/* Re-center action. Only shown when this is NOT the current
              focus and the analyst can drill into this customer's own
              network. */}
          {onRecenter && node.customer_id && node.customer_id !== focusCustomerId && (
            <button
              type="button"
              onClick={() => onRecenter(node.customer_id)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
            >
              Focus this customer →
            </button>
          )}
        </div>
      </div>

      {/* Risk row */}
      <Section title="Risk">
        <div className="flex flex-wrap gap-1.5">
          {node.risk && <Chip tone={riskTone(node.risk)}>{node.risk}</Chip>}
          {node.cdd_level && <Chip tone="slate">{node.cdd_level === 'Enhanced' ? 'Enhanced CDD' : 'Standard CDD'}</Chip>}
        </div>
        {(node.pep || node.sanctions || node.is_high_risk_country) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {node.pep && <Chip tone="purple">PEP</Chip>}
            {node.sanctions && <Chip tone="red">Sanctions</Chip>}
            {node.is_high_risk_country && <Chip tone="orange">High Risk Country</Chip>}
          </div>
        )}
      </Section>

      {/* Key facts */}
      <Section title="Key facts">
        <KV k="Customer since" v={node.customer_since ? String(node.customer_since).slice(0, 10) : '—'} />
        <KV k={node.customer_type === 'Business' ? 'Industry' : 'Occupation'}
            v={node.customer_type === 'Business' ? (node.industry || '—') : (node.occupation || '—')} />
        <KV k="Country" v={node.country || '—'} />
      </Section>

      {/* Connection summary for neighbours */}
      {node.is_neighbour && neighbourSummary && (
        <Section title="Connection">
          <div className="text-xs text-slate-600">
            Connected via shared counterparty:
          </div>
          <div className="text-sm font-medium text-navy-900 mt-1 break-words">
            {neighbourSummary}
          </div>
        </Section>
      )}

      {/* Action */}
      {profileHref && (
        <a
          href={profileHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded px-3 py-2"
        >
          View Customer Profile <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

// ─── Counterparty details ───────────────────────────────────────────────
function CounterpartyDetails({ node, data, adjacency, userRole }) {
  // Pull the TRANSACTS_WITH link that connects this counterparty to the focus.
  const focusLink = useMemo(() => {
    if (!data?.links) return null;
    return data.links.find(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return l.type === 'TRANSACTS_WITH' && (s === node.id || t === node.id);
    }) || null;
  }, [data, node.id]);

  // Customers connected through this counterparty — derived client-side from
  // CO_OCCURS_WITH links via this counterparty plus any neighbour whose
  // via_counterparty matches.
  const customersConnected = useMemo(() => {
    if (!data) return [];
    const matchName = (node.label || '').trim().toLowerCase();
    return data.nodes.filter(n =>
      n.is_neighbour &&
      typeof n.via_counterparty === 'string' &&
      n.via_counterparty.trim().toLowerCase() === matchName
    );
  }, [data, node.label]);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-full inline-flex items-center justify-center text-white shrink-0"
          style={{ background: COLORS.COMPANY }}
        >
          <Building2 size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-navy-900 break-words">{node.label}</div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">{node.id}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Chip tone="amber">Counterparty</Chip>
            {node.is_high_risk_country && <Chip tone="orange">High Risk</Chip>}
          </div>
        </div>
      </div>

      {/* C-10 Phase B: entity-type badge + risk indicator badges */}
      {node.counterparty_id && (
        <Section title="Entity">
          <div className="flex flex-wrap gap-1 mb-2">
            <Chip tone="slate">
              {(node.counterparty_type || 'unknown').replace('_', ' ').toUpperCase()}
            </Chip>
            {node.risk_indicators?.pep && <Chip tone="purple">PEP</Chip>}
            {node.risk_indicators?.sanctions_hit && <Chip tone="red">SANCTIONS HIT</Chip>}
            {node.risk_indicators?.high_risk_jurisdiction && <Chip tone="orange">HIGH-RISK JURISDICTION</Chip>}
          </div>
          <div className="text-[10px] text-slate-500 font-mono break-all">
            {node.counterparty_id}
          </div>
        </Section>
      )}

      {/* Risk row — counterparty country */}
      <Section title="Country & risk">
        <KV k="Country" v={node.country || 'Unknown'} />
        {node.is_high_risk_country && (
          <div className="mt-2 text-[11px] text-red-700 border border-red-200 bg-red-50 rounded px-2.5 py-1.5 inline-flex items-center gap-1.5">
            <Flame size={11} /> FATF high-risk jurisdiction
          </div>
        )}
      </Section>

      {/* Transaction summary — pulled from the focus link */}
      <Section title="Transactions with focus customer">
        <KV k="Total transactions" v={focusLink?.txn_count ?? node.txn_count_with_focus ?? '—'} />
        <KV k="Total amount"       v={fmtMoney(focusLink?.total_amount)} />
        <KV k="Alerted transactions"
            v={focusLink?.alerted_count > 0
                ? <span className="text-red-700 font-semibold">{focusLink.alerted_count}</span>
                : '0'} />
      </Section>

      {/* C-10 Phase B: global stats across all ARC customers */}
      {node.counterparty_id && (
        <Section title="Across all customers in this institution">
          <KV k="Total transactions" v={node.txn_count ?? '—'} />
          <KV k="Total volume"       v={fmtMoney(node.total_volume)} />
          <KV k="Customer count"     v={node.shared_with_customer_count >= 99 ? '99+' : (node.shared_with_customer_count ?? '—')} />
          {Number(node.shared_with_customer_count) >= 3 && (
            <div className="mt-2 text-[11px] text-violet-800 border border-violet-300 bg-violet-50 rounded px-2.5 py-1.5">
              ⚠ Network hub — this entity transacts with {node.shared_with_customer_count >= 99 ? '99+' : node.shared_with_customer_count} customers in your institution. Review for potential layering or structuring through a common intermediary.
            </div>
          )}
        </Section>
      )}

      {/* C-10: BSA-only deep link to the Counterparty Merge page,
          pre-selecting this counterparty in the All Counterparties tab.
          Matches the same role-gate pattern used for the SAR node
          investigation-open link. */}
      {node.counterparty_id && userRole === 'bsa_officer' && (
        <Section title="Full profile">
          <a
            href={`/bsa/counterparty-merge?id=${encodeURIComponent(node.counterparty_id)}`}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            View Full Profile →
          </a>
        </Section>
      )}

      {/* Customers connected through this counterparty */}
      {customersConnected.length > 0 && (
        <Section title={`Other customers via this counterparty (${customersConnected.length})`}>
          <div className="space-y-1.5">
            {customersConnected.map(c => (
              <div key={c.id} className="flex items-center justify-between text-xs border border-slate-200 bg-slate-50 rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-navy-900 truncate">{c.label}</div>
                  {c.customer_id && <div className="text-[10px] text-slate-500 font-mono">{c.customer_id}</div>}
                </div>
                {c.risk && <Chip tone={riskTone(c.risk)}>{c.risk}</Chip>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Alert / Case details ───────────────────────────────────────────────
function AlertDetails({ node, userRole, userName, rolePrefix, customerId }) {
  const ruleSummary = node.rule_explanation?.rule_summary
    || node.rule_explanation?.summary
    || node.rule_explanation?.description
    || (typeof node.rule_explanation === 'string' ? node.rule_explanation : null);

  // L1 sees the open button only when this alert is assigned to them. We
  // don't have assigned_to in the node payload — but the role-aware default
  // works for L2/Manager/BSA. For L1, we'd need the field; skipping for now
  // and showing the button only for L2 / Manager / BSA.
  const canOpen = userRole && userRole !== 'analyst_l1';
  const investigationHref = canOpen
    ? `${rolePrefix}/alerts?alert=${encodeURIComponent(node.alert_id || node.label)}`
    : null;

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded inline-flex items-center justify-center text-white shrink-0"
          style={{ background: COLORS.CASE }}
        >
          <ShieldAlert size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-navy-900 font-mono">{node.alert_id || node.label}</div>
          {node.customer_name && (
            <div className="text-[11px] text-slate-500 mt-0.5">{node.customer_name}</div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.priority && <Chip tone={priorityTone(node.priority)}>{node.priority}</Chip>}
            {node.status && <Chip tone="slate">{node.status}</Chip>}
          </div>
        </div>
      </div>

      <Section title="Detection">
        {node.scenario && <KV k="Scenario" v={node.scenario} />}
        {node.amount != null && <KV k="Amount" v={fmtMoney(node.amount)} />}
        {node.created_date && <KV k="Created" v={String(node.created_date).slice(0, 10)} />}
      </Section>

      {ruleSummary && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Rule explanation</div>
          <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-[12px] text-slate-700 leading-snug">
            {truncateRuleSummary(ruleSummary)}
          </div>
        </div>
      )}

      {investigationHref && (
        <a
          href={investigationHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded px-3 py-2"
        >
          Open Investigation <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function truncateRuleSummary(s) {
  const str = String(s);
  if (str.length <= 220) return str;
  return str.slice(0, 220).replace(/\s+\S*$/, '') + '… read more in the investigation workspace';
}

// ─── SAR details ────────────────────────────────────────────────────────
function SarDetails({ node, userRole }) {
  // SAR isolation is already enforced on the backend for L1 — the node
  // shouldn't reach the client. But guard the panel too in case something
  // slips through (defense-in-depth).
  if (userRole === 'analyst_l1') {
    return (
      <div className="p-5 text-xs text-slate-500">
        SAR details are not visible to L1 analysts.
      </div>
    );
  }
  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded inline-flex items-center justify-center text-white shrink-0"
          style={{ background: COLORS.SAR }}
        >
          <FileText size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-navy-900 font-mono">{node.sar_id || node.label}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Filed SAR</div>
        </div>
      </div>

      <Section title="Filing">
        {node.status && <KV k="Status" v={node.status} />}
        {node.filed_date && <KV k="Filed date" v={String(node.filed_date).slice(0, 10)} />}
        {node.amount != null && <KV k="Total amount" v={fmtMoney(node.amount)} />}
        {node.filing_type && <KV k="Filing type" v={node.filing_type} />}
      </Section>
    </div>
  );
}

// ─── Section / KV / Chip primitives (dark-mode) ─────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{title}</div>
      <div className="space-y-1.5 text-xs">{children}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v == null || v === '' ? '—' : v}</span>
    </div>
  );
}

function Chip({ tone, children }) {
  const toneCls = {
    red:          'bg-red-50    text-red-700    border border-red-200',
    purple:       'bg-purple-50 text-purple-700 border border-purple-200',
    amber:        'bg-amber-50  text-amber-700  border border-amber-200',
    orange:       'bg-orange-50 text-orange-700 border border-orange-200',
    blue:         'bg-blue-50   text-blue-700   border border-blue-200',
    slate:        'bg-slate-100 text-slate-700  border border-slate-200',
    'slate-soft': 'bg-slate-50  text-slate-500  border border-slate-200'
  }[tone] || 'bg-slate-100 text-slate-700 border border-slate-200';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${toneCls}`}>
      {children}
    </span>
  );
}

function riskTone(rating) {
  if (rating === 'Very High') return 'red';
  if (rating === 'High')      return 'orange';
  if (rating === 'Medium')    return 'amber';
  return 'slate';
}

function priorityTone(priority) {
  if (priority === 'High')   return 'red';
  if (priority === 'Medium') return 'amber';
  return 'slate';
}
