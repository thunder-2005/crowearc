import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { X, Network, Loader2, Flame, ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../api/client.js';

// Lazy-loaded so the graph library (~150KB) doesn't ship in the main bundle.
// The modal mounts only when the analyst clicks "View Network".
const ForceGraph2D = lazy(() => import('react-force-graph-2d'));

// Cross-Case Entity Network — force-directed visualisation of the focus
// customer's local network: counterparties, recent alerts, linked SARs, and
// other customers that share counterparties.
//
// Node colours:
//   Person = teal, Company = amber, Case = purple, SAR = red, Account = blue
//
// Edge encoding:
//   - thickness ∝ log(txn_count)  for TRANSACTS_WITH
//   - colour = red                for any edge that touched an alerted txn
//   - dashed                       for computed edges (CO_OCCURS_WITH, etc)
//   - directional arrow on every edge
//
// Rings (stacked on the node body):
//   - solid red    = sanctions match
//   - solid purple = PEP flag
//   - dashed orange = FATF / sanctioned high-risk jurisdiction

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

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function truncateLabel(s, n = 18) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export default function EntityGraphModal({ customerId, customerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);

  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Adjacency map keyed by node id → Set of connected node ids. Used by the
  // dim-others-on-select rule so a click on a node highlights its first-order
  // neighbourhood and dims everything else.
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

  // Fetch graph payload
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.get(`/customers/${customerId}/graph`)
      .then(r => {
        if (cancelled) return;
        setData(r.data);
        // Auto-select the focus node so the details panel isn't empty
        const focus = (r.data.nodes || []).find(n => n.id === r.data.focus_id);
        if (focus) setSelected(focus);
      })
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

  // Tune the d3 forces once the simulation is running. -120 charge gives the
  // network more breathing room; 80px target link distance keeps clusters
  // readable instead of bunched at the centre.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    try {
      const chargeForce = fgRef.current.d3Force('charge');
      if (chargeForce) chargeForce.strength(-120);
      const linkForce = fgRef.current.d3Force('link');
      if (linkForce) linkForce.distance(80);
    } catch (_) { /* ignore — older lib versions may not expose d3Force */ }
  }, [data]);

  // Once the simulation has had time to settle, fit the whole network in view.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    const t = setTimeout(() => {
      try { fgRef.current.zoomToFit(400, 60); } catch (_) { /* ignore */ }
    }, 1100);
    return () => clearTimeout(t);
  }, [data]);

  // Fade the keyboard-hint chip after 4s so it doesn't sit there forever.
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // Escape closes the modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomIn  = () => { if (fgRef.current) try { fgRef.current.zoom(fgRef.current.zoom() * 1.3, 300); } catch (_) { /* ignore */ } };
  const zoomOut = () => { if (fgRef.current) try { fgRef.current.zoom(fgRef.current.zoom() * 0.7, 300); } catch (_) { /* ignore */ } };
  const fitAll  = () => { if (fgRef.current) try { fgRef.current.zoomToFit(400, 60); } catch (_) { /* ignore */ } };

  const isEmpty = data && data.nodes.length <= 1 && data.links.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(15, 23, 42, 0.75)', padding: 24 }}
      role="dialog"
      aria-modal="true"
      aria-label="Entity network graph"
    >
      <div className="bg-white rounded-lg flex-1 flex flex-col overflow-hidden shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-4">
          <Network size={18} className="text-teal-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-navy-900">Cross-Case Entity Network</div>
            <div className="text-[11px] text-slate-500 truncate">
              Connected entities via shared counterparties and alerts
              {data ? ` · ${data.nodes.length} entities · ${data.links.length} connections` : ''}
              {customerName ? ` · ${customerName}` : ''}
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close graph"
            className="ml-auto p-1.5 rounded hover:bg-slate-100 text-slate-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body: graph + details ──────────────────────────────── */}
        <div className="flex-1 flex min-h-0">
          <div
            ref={containerRef}
            className="flex-1 relative"
            style={{ background: '#F8FAFC' }}
            onMouseMove={(e) => {
              if (!hoveredLink) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
          >
            {error ? (
              <Centered>
                <div className="text-sm text-red-700">Failed to load graph: {error}</div>
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
                  graphData={data}
                  width={size.w}
                  height={size.h}
                  backgroundColor="#F8FAFC"
                  nodeRelSize={5}
                  nodeCanvasObject={(node, ctx, globalScale) =>
                    drawNode(node, ctx, globalScale, selected, adjacency)
                  }
                  nodePointerAreaPaint={(node, color, ctx) => {
                    ctx.fillStyle = color;
                    const r = node.is_focus ? 12 : 8;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fill();
                  }}
                  linkColor={(l) => {
                    const dim = selected && !linkTouchesSelected(l, selected);
                    if (dim) return 'rgba(100, 116, 139, 0.15)';
                    return l.alerted ? 'rgba(220, 38, 38, 0.75)' : 'rgba(100, 116, 139, 0.5)';
                  }}
                  linkWidth={(l) => {
                    if (l.txn_count) return Math.min(1 + Math.log10(l.txn_count + 1) * 2, 5);
                    return 1;
                  }}
                  linkLineDash={(l) => l.computed ? [4, 4] : null}
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={0.85}
                  onNodeClick={(node) => setSelected(node)}
                  onBackgroundClick={() => setSelected(null)}
                  onLinkHover={(link) => setHoveredLink(link || null)}
                  onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y; }}
                  cooldownTicks={200}
                  warmupTicks={80}
                  d3VelocityDecay={0.4}
                  d3AlphaDecay={0.02}
                />
              </Suspense>
            )}

            {/* Zoom controls — top-right inside the canvas */}
            {data && !isEmpty && (
              <div className="absolute top-4 right-4 flex flex-col gap-1.5 z-20">
                <ZoomButton onClick={zoomIn}  title="Zoom in"><ZoomIn size={14} /></ZoomButton>
                <ZoomButton onClick={zoomOut} title="Zoom out"><ZoomOut size={14} /></ZoomButton>
                <ZoomButton onClick={fitAll}  title="Fit all to view"><Maximize2 size={14} /></ZoomButton>
              </div>
            )}

            {/* Legend — bottom-left, collapsible */}
            {data && !isEmpty && (
              <GraphLegend open={legendOpen} onToggle={() => setLegendOpen(o => !o)} />
            )}

            {/* Edge-hover tooltip */}
            {hoveredLink && (
              <EdgeTooltip link={hoveredLink} pos={tooltipPos} data={data} />
            )}

            {/* Keyboard-hint chip — bottom-right, fades after 4s */}
            {hintVisible && data && (
              <div
                className="absolute bottom-4 right-4 text-[10px] text-slate-500 bg-white/80 border border-slate-200 rounded px-2 py-1 shadow-sm pointer-events-none transition-opacity duration-500"
                style={{ opacity: hintVisible ? 1 : 0 }}
              >
                Esc to close · Scroll to zoom · Drag to pan · Click node for details
              </div>
            )}
          </div>

          {/* Details panel */}
          <NodeDetails node={selected} data={data} />
        </div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────
function LoadingState() {
  return (
    <Centered>
      <div className="relative w-64 h-32 mb-4">
        {/* Placeholder nodes — pulsing circles */}
        <span className="absolute left-1/2 top-2 -translate-x-1/2 block w-5 h-5 rounded-full bg-slate-300 animate-pulse" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 block w-3 h-3 rounded-full bg-slate-200 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 block w-4 h-4 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '300ms' }} />
        <span className="absolute left-12 bottom-1 block w-3 h-3 rounded-full bg-slate-200 animate-pulse" style={{ animationDelay: '450ms' }} />
        <span className="absolute right-12 bottom-2 block w-3.5 h-3.5 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '600ms' }} />
        {/* Placeholder lines */}
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

// ─── Helpers ─────────────────────────────────────────────────────────────
function linkTouchesSelected(link, selected) {
  if (!selected) return true;
  const s = typeof link.source === 'object' ? link.source.id : link.source;
  const t = typeof link.target === 'object' ? link.target.id : link.target;
  return s === selected.id || t === selected.id;
}

// Custom canvas draw: colored circle + size by importance + rings + label.
function drawNode(node, ctx, globalScale, selected, adjacency) {
  const color = COLORS[node.type] || '#94A3B8';
  const r = node.is_focus ? 9 : 6;

  // Dim non-selected / non-connected nodes when a selection is active.
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

  // Focus ring (subtle outer halo on the root entity)
  if (node.is_focus) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // Hazard rings — drawn in priority order so the most severe wins outermost.
  // High-risk-country (dashed orange) sits a touch outside the body so it
  // doesn't visually merge with sanctions/PEP solid rings.
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

  // Selection ring (blue, outermost when selected)
  if (selected && selected.id === node.id) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 7, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3B82F6';
    ctx.stroke();
  }

  // Label rules:
  //  - always show for the focus, sanctions, PEP, or high-risk-country nodes
  //  - otherwise only at zoom ≥ 0.6 so the canvas stays readable when zoomed out
  const alwaysShow = node.is_focus || node.sanctions || node.pep || node.is_high_risk_country;
  if (alwaysShow || globalScale >= 0.6) {
    const fontSize = Math.max(8, 11 / globalScale);
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = truncateLabel(node.label, 18);
    const padX = 4;
    const padY = 1;
    const textMetrics = ctx.measureText(label);
    const w = textMetrics.width + padX * 2;
    const h = fontSize + padY * 2;
    const x = node.x - w / 2;
    const y = node.y + r + 3;
    // Subtle background pill for readability against any canvas tint
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#0F172A';
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

// ─── Zoom button ─────────────────────────────────────────────────────────
function ZoomButton({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-8 h-8 inline-flex items-center justify-center rounded shadow-sm bg-slate-800/85 hover:bg-slate-900 text-white border border-slate-700"
    >
      {children}
    </button>
  );
}

// ─── Legend (bottom-left, collapsible) ───────────────────────────────────
function GraphLegend({ open, onToggle }) {
  return (
    <div
      className="absolute bottom-4 left-4 z-20 text-[11px] text-slate-100"
      style={{
        background: 'rgba(13, 17, 23, 0.85)',
        border: '1px solid #30363D',
        borderRadius: 8,
        padding: open ? '10px 14px' : '6px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
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

// ─── Edge tooltip ────────────────────────────────────────────────────────
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
        boxShadow: '0 6px 16px rgba(0,0,0,0.3)'
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

// ─── Node details panel (unchanged shape, kept compact) ──────────────────
function NodeDetails({ node, data }) {
  if (!node) {
    return (
      <div className="w-72 border-l border-slate-200 p-4 bg-white text-xs text-slate-500">
        Click a node to see its details.
      </div>
    );
  }

  return (
    <div className="w-72 border-l border-slate-200 p-4 bg-white text-xs overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[node.type] || '#94A3B8' }} />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
          {TYPE_LABEL[node.type] || node.type}
        </span>
        {node.is_focus && (
          <span className="ml-auto text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">FOCUS</span>
        )}
        {node.is_neighbour && (
          <span className="ml-auto text-[9px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">NEIGHBOUR</span>
        )}
        {node.is_counterparty && !node.is_neighbour && (
          <span className="ml-auto text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">COUNTERPARTY</span>
        )}
      </div>

      <div className="font-semibold text-navy-900 text-sm break-words mb-2">
        {node.label}
      </div>

      {(node.type === 'PERSON' || node.type === 'COMPANY') && (
        <div className="space-y-1.5">
          {node.risk && <Row k="Risk rating" v={<Badge tone={riskTone(node.risk)}>{node.risk}</Badge>} />}
          {node.pep && <Row k="PEP" v={<Badge tone="purple">Yes</Badge>} />}
          {node.sanctions && <Row k="Sanctions" v={<Badge tone="red">Hit</Badge>} />}
          {node.country && (
            <Row
              k="Country"
              v={
                <span className="inline-flex items-center gap-1">
                  {node.country}
                  {node.is_high_risk_country && (
                    <Badge tone="orange">High risk</Badge>
                  )}
                </span>
              }
            />
          )}
          {node.alerted_txn_count > 0 && (
            <Row k="Alerted txns" v={
              <span className="inline-flex items-center gap-0.5 text-red-700 font-semibold">
                <Flame size={10} />{node.alerted_txn_count}
              </span>
            } />
          )}
        </div>
      )}

      {node.type === 'CASE' && (
        <div className="space-y-1.5">
          {node.scenario && <Row k="Scenario" v={node.scenario} />}
          {node.priority && <Row k="Priority" v={node.priority} />}
          {node.status && <Row k="Status" v={node.status} />}
          {node.amount != null && <Row k="Amount" v={`$${Number(node.amount).toLocaleString('en-US')}`} />}
        </div>
      )}

      {node.type === 'SAR' && (
        <div className="space-y-1.5">
          {node.status && <Row k="Status" v={node.status} />}
          {node.filed_date && <Row k="Filed" v={String(node.filed_date).slice(0, 10)} />}
        </div>
      )}

      {data?.meta && (
        <div className="border-t border-slate-100 pt-2 mt-3 text-[10px] text-slate-400 space-y-0.5">
          <div>Network: {data.nodes.length} nodes · {data.links.length} edges</div>
          <div>
            {data.meta.counterparty_count} counterparties ·{' '}
            {data.meta.alert_count} alerts ·{' '}
            {data.meta.sars_included ? `${data.meta.sar_count} SARs` : 'SARs hidden'}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}

function Badge({ tone, children }) {
  const toneCls = {
    red:    'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    amber:  'bg-amber-100 text-amber-700',
    orange: 'bg-orange-100 text-orange-700',
    slate:  'bg-slate-100 text-slate-700'
  }[tone] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${toneCls}`}>
      {children}
    </span>
  );
}

function riskTone(rating) {
  if (rating === 'Very High') return 'red';
  if (rating === 'High')      return 'amber';
  if (rating === 'Medium')    return 'slate';
  return 'slate';
}
