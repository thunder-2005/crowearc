import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
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

const COLORS = {
  PERSON:  '#1D9E75',
  COMPANY: '#BA7517',
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
  if (node.is_counterparty) return NODE_RADIUS.COUNTERPARTY;
  if (node.is_neighbour) return NODE_RADIUS.NEIGHBOUR;
  if (node.type === 'CASE') return NODE_RADIUS.CASE;
  if (node.type === 'SAR') return NODE_RADIUS.SAR;
  return NODE_RADIUS.DEFAULT;
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

export default function EntityGraphModal({ customerId, customerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);

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

  // Adjacency map keyed by node id → Set of connected node ids. Used by the
  // dim-others-on-select rule so a click on a node highlights its first-order
  // neighbourhood.
  const adjacency = useMemo(() => {
    const map = new Map();
    if (!data) return map;
    for (const l of data.links || []) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s).add(t);
      map.get(t).add(s);
    }
    return map;
  }, [data]);

  // Fetch graph payload. Do NOT auto-select the focus — the right panel
  // defaults to the welcome state per spec.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setSelected(null);
    api.get(`/customers/${customerId}/graph`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.error || err.message || 'Failed to load graph');
      });
    return () => { cancelled = true; };
  }, [customerId]);

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

  // Tune the d3 forces once the simulation is running. Stronger repulsion
  // and longer target link distance than the default — pushes nodes further
  // apart so labels don't pile up around the focus.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    try {
      const chargeForce = fgRef.current.d3Force('charge');
      if (chargeForce) chargeForce.strength(-200);
      const linkForce = fgRef.current.d3Force('link');
      if (linkForce) linkForce.distance(100);
    } catch (_) { /* older lib versions may not expose d3Force */ }
  }, [data]);

  // Once the simulation has settled, fit the whole network in view.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    const t = setTimeout(() => {
      try { fgRef.current.zoomToFit(400, 80); } catch (_) { /* ignore */ }
    }, 1200);
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

  // Double-click on a customer node opens their profile in a new tab.
  const onNodeDouble = (node) => {
    if (!node || !node.customer_id) return;
    if (node.type !== 'PERSON' && node.type !== 'COMPANY') return;
    if (node.is_counterparty) return;  // counterparties have no profile route
    const url = `${rolePrefix}/customers/${encodeURIComponent(node.customer_id)}`;
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ }
  };

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
      <div className="rounded-lg flex-1 flex flex-col overflow-hidden shadow-2xl border border-slate-800" style={{ background: '#0D1117' }}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-4 text-slate-100">
          <Network size={18} className="text-teal-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold">Entity Network</div>
            <div className="text-[11px] text-slate-400 truncate">
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
                <span className="mx-2 h-5 w-px bg-slate-700" />
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
              background: '#0D1117',
              flex: '0 0 65%',
              maxWidth: '65%',
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
                <div className="text-sm text-red-400">Failed to load graph: {error}</div>
              </Centered>
            ) : !data ? (
              <LoadingState />
            ) : isEmpty ? (
              <Centered>
                <div className="text-center max-w-md px-6">
                  <Network size={36} className="text-slate-600 mx-auto mb-3" />
                  <div className="text-sm font-medium text-slate-200">No connected entities found</div>
                  <div className="text-xs text-slate-400 mt-2">
                    This customer has no shared counterparties with other
                    customers in the current dataset.
                  </div>
                </div>
              </Centered>
            ) : (
              <Suspense fallback={<LoadingState />}>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={data}
                  width={size.w}
                  height={size.h}
                  backgroundColor="#0D1117"
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
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={0.85}
                  onNodeClick={(node) => setSelected(node)}
                  onNodeHover={(node) => setHoveredNode(node || null)}
                  onBackgroundClick={() => setSelected(null)}
                  onLinkHover={(link) => setHoveredLink(link || null)}
                  onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y; }}
                  onNodeRightClick={onNodeDouble}
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
                className="absolute pointer-events-none rounded px-2 py-1 text-[11px] font-medium text-slate-100 border border-slate-700 shadow-sm"
                style={{
                  top: cursorPos.y + 14,
                  left: cursorPos.x + 14,
                  background: 'rgba(13, 17, 23, 0.95)',
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

            {/* Bottom-right one-shot hint */}
            {hintVisible && data && (
              <div
                className="absolute bottom-4 right-4 text-[10px] text-slate-400 border border-slate-700 rounded px-2 py-1 pointer-events-none transition-opacity duration-500"
                style={{ background: 'rgba(13,17,23,0.85)', opacity: hintVisible ? 1 : 0 }}
              >
                Click a node to explore
              </div>
            )}
          </div>

          {/* Right side panel — welcome state or node details. */}
          <SidePanel
            node={selected}
            data={data}
            counts={networkCounts}
            customerName={customerName}
            customerId={customerId}
            userRole={userRole}
            userName={userName}
            rolePrefix={rolePrefix}
            adjacency={adjacency}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Hover label rule ───────────────────────────────────────────────────
// Skip the cursor-following tooltip on nodes that already have a permanent
// label (focus / sanctions / PEP / high-risk-country) — no duplication.
function shouldShowHoverLabel(node) {
  if (!node) return false;
  if (node.is_focus) return false;
  if (node.sanctions) return false;
  if (node.pep) return false;
  if (node.is_high_risk_country) return false;
  return true;
}

// ─── Loading state ──────────────────────────────────────────────────────
function LoadingState() {
  return (
    <Centered>
      <div className="relative w-64 h-32 mb-4">
        <span className="absolute left-1/2 top-2 -translate-x-1/2 block w-5 h-5 rounded-full bg-slate-600 animate-pulse" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 block w-3 h-3 rounded-full bg-slate-700 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 block w-4 h-4 rounded-full bg-slate-600 animate-pulse" style={{ animationDelay: '300ms' }} />
        <span className="absolute left-12 bottom-1 block w-3 h-3 rounded-full bg-slate-700 animate-pulse" style={{ animationDelay: '450ms' }} />
        <span className="absolute right-12 bottom-2 block w-3.5 h-3.5 rounded-full bg-slate-600 animate-pulse" style={{ animationDelay: '600ms' }} />
        <svg className="absolute inset-0 w-full h-full" aria-hidden>
          <line x1="50%" y1="14" x2="14"  y2="50%" stroke="#475569" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="50%" y1="14" x2="232" y2="50%" stroke="#475569" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="14"  y1="50%" x2="60" y2="120" stroke="#475569" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="232" y1="50%" x2="200" y2="120" stroke="#475569" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      </div>
      <Loader2 size={16} className="animate-spin text-slate-400" />
      <div className="text-xs text-slate-400 mt-2">Loading entity network…</div>
    </Centered>
  );
}

// ─── Edge color / width helpers ─────────────────────────────────────────
function linkColor(l, selected) {
  const dimmed = selected && !linkTouchesSelected(l, selected);
  if (dimmed) return 'rgba(100, 116, 139, 0.10)';
  if (l.type === 'TRANSACTS_WITH') return l.alerted ? '#F85149' : '#30363D';
  if (l.type === 'CO_OCCURS_WITH') return '#444C56';
  if (l.type === 'APPEARS_IN')     return '#388BFD';
  if (l.type === 'FILED_BY' || l.type === 'SUBJECT_OF') return '#A32D2D';
  return '#475569';
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
  const color = COLORS[node.type] || '#94A3B8';
  const r = radiusFor(node);

  // Selection dimming
  let alpha = 1;
  if (selected) {
    const isSelected   = selected.id === node.id;
    const isConnected  = adjacency.get(selected.id)?.has(node.id);
    alpha = (isSelected || isConnected) ? 1 : 0.3;
  }
  ctx.save();
  ctx.globalAlpha = alpha;

  // Body
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
  ctx.fillStyle = color;
  ctx.fill();

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

  // Label rules:
  //  - always for focus / sanctions / PEP / high-risk-country
  //  - otherwise only when zoomed in (globalScale >= 0.8)
  const alwaysShow = node.is_focus || node.sanctions || node.pep || node.is_high_risk_country;
  if (alwaysShow || globalScale >= 0.8) {
    const fontSize = Math.max(8, 11 / globalScale);
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
    // Dark-mode pill: dark fill, light text
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
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
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(label, node.x, y + padY);
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
      className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-200 hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

// ─── Legend (bottom-left, collapsible) ──────────────────────────────────
function GraphLegend({ open, onToggle }) {
  return (
    <div
      className="absolute bottom-4 left-4 z-20 text-[11px] text-slate-100"
      style={{
        background: 'rgba(13, 17, 23, 0.92)',
        border: '1px solid #30363D',
        borderRadius: 8,
        padding: open ? '10px 14px' : '6px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-slate-200 hover:text-white"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold uppercase tracking-wider text-[10px]">Legend</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Node types</div>
            <LegendDot color={COLORS.PERSON}  label="Person (customer)" />
            <LegendDot color={COLORS.COMPANY} label="Company / Counterparty" />
            <LegendDot color={COLORS.CASE}    label="Alert / Case" />
            <LegendDot color={COLORS.SAR}     label="SAR Filing" />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Ring indicators</div>
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
      <span className="text-slate-200">{label}</span>
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
      <span className="text-slate-200">{label}</span>
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

// ─── Side panel ─────────────────────────────────────────────────────────
function SidePanel({ node, data, counts, customerName, customerId, userRole, userName, rolePrefix, adjacency }) {
  return (
    <aside
      className="border-l border-slate-800 overflow-y-auto text-slate-100"
      style={{ flex: '0 0 35%', maxWidth: '35%', background: '#161B22' }}
    >
      {!node ? (
        <WelcomeState counts={counts} customerName={customerName} />
      ) : node.type === 'CASE' ? (
        <AlertDetails node={node} userRole={userRole} userName={userName} rolePrefix={rolePrefix} customerId={customerId} />
      ) : node.type === 'SAR' ? (
        <SarDetails node={node} userRole={userRole} rolePrefix={rolePrefix} />
      ) : node.is_counterparty ? (
        <CounterpartyDetails node={node} data={data} adjacency={adjacency} />
      ) : (
        <CustomerDetails node={node} data={data} adjacency={adjacency} userRole={userRole} rolePrefix={rolePrefix} customerId={customerId} />
      )}
    </aside>
  );
}

// ─── Welcome state (default right panel) ────────────────────────────────
function WelcomeState({ counts, customerName }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center bg-teal-500/15 border border-teal-500/30 mb-4">
        <Network size={28} className="text-teal-400" />
      </div>
      <div className="text-base font-bold text-slate-100">Entity Network</div>
      <div className="text-xs text-slate-400 mt-2 max-w-xs">
        Click any node to see details about that entity and its connections.
      </div>

      {counts && (
        <div className="mt-8 w-full max-w-xs">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">In this network</div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat icon={Users}        label="Customers"      value={counts.customers} />
            <SummaryStat icon={Building2}    label="Counterparties" value={counts.counterparties} />
            <SummaryStat icon={ShieldAlert}  label="Alerts"         value={counts.alerts} />
            {counts.sars > 0 && <SummaryStat icon={FileText} label="SARs" value={counts.sars} />}
          </div>
          {customerName && (
            <div className="mt-4 text-[11px] text-slate-500">
              Focus: <span className="text-slate-300 font-medium">{customerName}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-800/40 px-3 py-2 text-left">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 inline-flex items-center gap-1">
        <Icon size={10} /> {label}
      </div>
      <div className="text-lg font-bold text-slate-100 tabular-nums">{value || 0}</div>
    </div>
  );
}

// ─── Customer details (focus or neighbour) ──────────────────────────────
function CustomerDetails({ node, data, adjacency, userRole, rolePrefix, customerId: focusCustomerId }) {
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
          <div className="text-base font-bold text-slate-100 break-words">{node.label}</div>
          {node.customer_id && (
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{node.customer_id}</div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Chip tone="slate">{node.customer_type === 'Business' ? 'Business' : 'Individual'}</Chip>
            {node.is_focus && <Chip tone="blue">Focus</Chip>}
            {node.is_neighbour && <Chip tone="slate-soft">Neighbour</Chip>}
          </div>
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
          <div className="text-xs text-slate-300">
            Connected via shared counterparty:
          </div>
          <div className="text-sm font-medium text-slate-100 mt-1 break-words">
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
function CounterpartyDetails({ node, data, adjacency }) {
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
          <div className="text-base font-bold text-slate-100 break-words">{node.label}</div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">{node.id}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Chip tone="amber">Counterparty</Chip>
            {node.is_high_risk_country && <Chip tone="orange">High Risk</Chip>}
          </div>
        </div>
      </div>

      {/* Risk row — counterparty country */}
      <Section title="Country & risk">
        <KV k="Country" v={node.country || 'Unknown'} />
        {node.is_high_risk_country && (
          <div className="mt-2 text-[11px] text-red-300 border border-red-500/30 bg-red-500/10 rounded px-2.5 py-1.5 inline-flex items-center gap-1.5">
            <Flame size={11} /> FATF high-risk jurisdiction
          </div>
        )}
      </Section>

      {/* Transaction summary — pulled from the focus link */}
      <Section title="Transactions with focus customer">
        <KV k="Total transactions" v={focusLink?.txn_count ?? '—'} />
        <KV k="Total amount"       v={fmtMoney(focusLink?.total_amount)} />
        <KV k="Alerted transactions"
            v={focusLink?.alerted_count > 0
                ? <span className="text-red-300 font-semibold">{focusLink.alerted_count}</span>
                : '0'} />
      </Section>

      {/* Customers connected through this counterparty */}
      {customersConnected.length > 0 && (
        <Section title={`Other customers via this counterparty (${customersConnected.length})`}>
          <div className="space-y-1.5">
            {customersConnected.map(c => (
              <div key={c.id} className="flex items-center justify-between text-xs border border-slate-700 bg-slate-800/40 rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-slate-100 truncate">{c.label}</div>
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
          <div className="text-sm font-bold text-slate-100 font-mono">{node.alert_id || node.label}</div>
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
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Rule explanation</div>
          <div className="border-l-4 border-blue-500 bg-slate-800/40 px-3 py-2 text-[12px] text-slate-200 leading-snug">
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
      <div className="p-5 text-xs text-slate-400">
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
          <div className="text-sm font-bold text-slate-100 font-mono">{node.sar_id || node.label}</div>
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
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">{title}</div>
      <div className="space-y-1.5 text-xs">{children}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="text-slate-100 font-medium text-right break-words">{v == null || v === '' ? '—' : v}</span>
    </div>
  );
}

function Chip({ tone, children }) {
  const toneCls = {
    red:          'bg-red-500/15  text-red-300    border border-red-500/30',
    purple:       'bg-purple-500/15 text-purple-300 border border-purple-500/30',
    amber:        'bg-amber-500/15 text-amber-300  border border-amber-500/30',
    orange:       'bg-orange-500/15 text-orange-300 border border-orange-500/30',
    blue:         'bg-blue-500/15 text-blue-300    border border-blue-500/30',
    slate:        'bg-slate-700/40 text-slate-300  border border-slate-700',
    'slate-soft': 'bg-slate-800/50 text-slate-400  border border-slate-700'
  }[tone] || 'bg-slate-700/40 text-slate-300 border border-slate-700';
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
