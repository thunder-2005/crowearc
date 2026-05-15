import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { X, Network, Loader2, Flame } from 'lucide-react';
import api from '../../api/client.js';

// Lazy-loaded so the graph library (~150KB) doesn't ship in the main
// bundle. The modal is only mounted when the analyst clicks "View Network"
// on the Linked tab — at that point we pay the load cost once.
const ForceGraph2D = lazy(() => import('react-force-graph-2d'));

// ─────────────────────────────────────────────────────────────────────────────
// CCEG graph explorer — Phase 4 prototype
//
// Renders a force-directed visualisation of the focus customer's local
// network: counterparties, recent alerts, linked SARs, and other customers
// that share counterparties. Backed by /api/customers/:id/graph, which
// reads from the existing customers/alerts/transactions/sar_filings tables
// (NOT the still-empty CCEG goldenRegistry — see CCEG_PHASE_1_DESIGN.md
// for the swap path).
//
// Node colours match the spec (§7.2):
//   Person = teal, Company = amber, Case = purple, SAR = red, Account = blue
//
// Edge encoding:
//   - thickness ∝ log(txn_count)         for TRANSACTS_WITH
//   - colour    = red                    for any TRANSACTS_WITH that touched an alerted txn
//   - dashed                              for computed edges (CO_OCCURS_WITH, etc)
//   - directional arrow on every edge
//
// Library choice: react-force-graph-2d (Canvas 2D). The spec recommends
// Sigma.js + graphology for WebGL scale. For demo data (~20-30 nodes)
// Canvas is more than enough and the integration is one component, one
// install. Swap path to Sigma.js is straightforward when scale demands —
// the data shape (nodes + links) is identical.
// ─────────────────────────────────────────────────────────────────────────────

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

export default function EntityGraphModal({ customerId, customerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Fetch graph payload
  useEffect(() => {
    let cancelled = false;
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

  // Once the graph stabilises, fit the viewport so the whole network is visible.
  // 800ms gives the force simulation time to settle on a layout before we zoom.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    const t = setTimeout(() => {
      try { fgRef.current.zoomToFit(400, 60); } catch (_) { /* ignore */ }
    }, 800);
    return () => clearTimeout(t);
  }, [data]);

  // Escape closes the modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          <div className="flex items-center gap-2">
            <Network size={18} className="text-teal-600" />
            <div>
              <div className="text-sm font-bold text-navy-900">Entity Network</div>
              <div className="text-[11px] text-slate-500">
                {customerName}
                {data ? ` · ${data.nodes.length} entities · ${data.links.length} connections` : ''}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Legend />
            <button
              onClick={onClose}
              aria-label="Close graph"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Preview banner ─────────────────────────────────────── */}
        <div className="bg-teal-50 border-b border-teal-100 px-4 py-2 text-[11px] text-teal-800">
          <span className="font-semibold">Cross-Case Entity Graph · preview · synthetic data.</span>{' '}
          Sourced from the existing customers / alerts / transactions tables.
          Full CCEG goldenRegistry backing arrives when Phase 2 ships.
        </div>

        {/* ── Body: graph + details ──────────────────────────────── */}
        <div className="flex-1 flex min-h-0">
          <div ref={containerRef} className="flex-1 relative" style={{ background: '#F8FAFC' }}>
            {error ? (
              <Centered>
                <div className="text-sm text-red-700">Failed to load graph: {error}</div>
              </Centered>
            ) : !data ? (
              <Centered>
                <Loader2 size={20} className="animate-spin text-slate-400" />
                <div className="text-xs text-slate-500 mt-2">Loading network…</div>
              </Centered>
            ) : data.nodes.length === 0 ? (
              <Centered>
                <div className="text-sm text-slate-500">No network connections found for this customer.</div>
              </Centered>
            ) : (
              <Suspense fallback={<Centered><Loader2 size={20} className="animate-spin text-slate-400" /></Centered>}>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={data}
                  width={size.w}
                  height={size.h}
                  backgroundColor="#F8FAFC"
                  nodeRelSize={5}
                  nodeCanvasObject={(node, ctx, globalScale) => drawNode(node, ctx, globalScale, selected)}
                  nodePointerAreaPaint={(node, color, ctx) => {
                    ctx.fillStyle = color;
                    const r = node.is_focus ? 12 : 8;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fill();
                  }}
                  linkColor={(l) => l.alerted ? 'rgba(220, 38, 38, 0.7)' : 'rgba(100, 116, 139, 0.4)'}
                  linkWidth={(l) => {
                    if (l.txn_count) return Math.min(1 + Math.log10(l.txn_count + 1) * 2, 5);
                    return 1;
                  }}
                  linkLineDash={(l) => l.computed ? [4, 4] : null}
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={0.85}
                  onNodeClick={(node) => setSelected(node)}
                  onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y; }}
                  cooldownTicks={150}
                  warmupTicks={60}
                  d3VelocityDecay={0.3}
                />
              </Suspense>
            )}
          </div>

          {/* Details panel */}
          <NodeDetails node={selected} data={data} />
        </div>
      </div>
    </div>
  );
}

// Custom canvas draw: colored circle + size by importance + label below.
// Highlight ring for the selected node + focus ring for the root entity.
function drawNode(node, ctx, globalScale, selected) {
  const color = COLORS[node.type] || '#94A3B8';
  const r = node.is_focus ? 9 : 6;

  // Body
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
  ctx.fillStyle = color;
  ctx.fill();

  // Focus ring
  if (node.is_focus) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // PEP / sanctions hazard ring
  if (node.pep || node.sanctions) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 1, 0, 2 * Math.PI, false);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = node.sanctions ? '#DC2626' : '#7C3AED';
    ctx.stroke();
  }

  // Selection ring
  if (selected && selected.id === node.id) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3B82F6';
    ctx.stroke();
  }

  // Label (only when reasonably zoomed in to keep the canvas readable)
  if (globalScale >= 0.6) {
    const fontSize = Math.max(8, 11 / globalScale);
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0F172A';
    const raw = node.label || '';
    const label = raw.length > 28 ? raw.slice(0, 26) + '…' : raw;
    ctx.fillText(label, node.x, node.y + r + 3);
  }
}

function Centered({ children }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      {children}
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden md:flex items-center gap-2 text-[10px]">
      <LegendDot color={COLORS.PERSON} label="Person" />
      <LegendDot color={COLORS.COMPANY} label="Company" />
      <LegendDot color={COLORS.CASE} label="Case" />
      <LegendDot color={COLORS.SAR} label="SAR" />
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-slate-600">{label}</span>
    </span>
  );
}

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
      {/* Type chip + role chip */}
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

      {/* Type-specific details */}
      {(node.type === 'PERSON' || node.type === 'COMPANY') && (
        <div className="space-y-1.5">
          {node.risk && <Row k="Risk rating" v={<Badge tone={riskTone(node.risk)}>{node.risk}</Badge>} />}
          {node.pep && <Row k="PEP" v={<Badge tone="purple">Yes</Badge>} />}
          {node.sanctions && <Row k="Sanctions" v={<Badge tone="red">Hit</Badge>} />}
          {node.country && <Row k="Country" v={node.country} />}
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

      {/* Graph context footer */}
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
