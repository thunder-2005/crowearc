import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, X, ArrowRight } from 'lucide-react';
import api from '../api/client.js';
import { useRole } from '../state/RoleContext.jsx';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { useInvestigationTabs } from '../state/InvestigationTabsContext.jsx';

const POLL_MS = 60_000;
const AUTO_DISMISS_WARNING_MS = 30_000;
const VISIBLE_MAX = 3;

const SLA_TYPES = new Set(['sla_warning', 'sla_breached', 'sla_warning_manager', 'sla_breached_manager']);

function isBreach(t) { return t === 'sla_breached' || t === 'sla_breached_manager'; }
function isManagerType(t) { return t === 'sla_warning_manager' || t === 'sla_breached_manager'; }

function fmtRemaining(ms) {
  if (ms == null) return '—';
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(ms);
  const totalMin = Math.floor(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0 && m <= 0) return sign < 0 ? 'Just breached' : 'less than 1m';
  if (sign < 0) return `${h}h ${m}m ago`;
  return `${h}h ${m}m`;
}

function pctRemaining(deadline, slaDays) {
  if (!deadline || slaDays == null) return 0;
  const total = slaDays * 86400000;
  const remaining = deadline.getTime() - Date.now();
  return Math.max(0, Math.min(100, (remaining / total) * 100));
}

function tryPlaySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.4);
  } catch (_e) { /* audio unavailable; ignore */ }
}

export default function SLAPopup() {
  const { isManager, currentAnalyst } = useRole();
  const { openTab } = useInvestigationTabs();
  const location = useLocation();
  const { goTo } = useRoleNavigate();

  const [popups, setPopups] = useState([]);
  const [collapsed, setCollapsed] = useState(true);
  const [tick, setTick] = useState(0);
  const seenIdsRef = useRef(new Set());

  const recipientPath = isManager ? 'manager' : (currentAnalyst ? `user/${encodeURIComponent(currentAnalyst)}` : null);

  const enrichAndAdd = useCallback(async (notifications) => {
    const candidates = notifications.filter(n => SLA_TYPES.has(n.type) && !seenIdsRef.current.has(n.id));
    if (candidates.length === 0) return;
    const closedStatuses = new Set([
      'Completed', 'Closed', 'Filed', 'False Positive',
      'Closed - L2 Review', 'Closed by L2',
      'Escalated - L2', 'Escalated - SAR'
    ]);
    const enriched = (await Promise.all(candidates.map(async (n) => {
      seenIdsRef.current.add(n.id);
      let alert = null;
      try {
        const { data } = await api.get(`/alerts/${n.related_id}`);
        alert = data;
      } catch (_e) { /* alert may have been removed; show with what we have */ }
      // Suppress SLA popups for alerts that have been closed since the
      // notification was issued — a closed alert has no live SLA timer.
      if (alert && (closedStatuses.has(alert.alert_status) || alert.closed_date)) {
        try { await api.patch(`/notifications/${n.id}/read`); } catch (_e) {}
        return null;
      }
      const deadline = (() => {
        if (!alert) return null;
        if (alert.sla_deadline) {
          const d = new Date(alert.sla_deadline.length <= 10 ? `${alert.sla_deadline}T23:59:59` : alert.sla_deadline);
          return isNaN(d.getTime()) ? null : d;
        }
        if (alert.created_date && alert.sla_days != null) {
          return new Date(new Date(alert.created_date).getTime() + alert.sla_days * 86400000);
        }
        return null;
      })();
      return {
        notif_id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        related_id: n.related_id,
        is_breach: isBreach(n.type),
        is_manager: isManagerType(n.type),
        alert,
        deadline,
        sla_days: alert?.sla_days,
        created_at: n.created_at
      };
    }))).filter(Boolean);
    setPopups(prev => [...prev, ...enriched]);
    if (enriched.some(p => p.is_breach)) tryPlaySound();
  }, []);

  useEffect(() => {
    if (!recipientPath) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get(`/notifications/unread/${recipientPath}`);
        if (!cancelled) await enrichAndAdd(data);
      } catch (_e) { /* swallow */ }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [recipientPath, enrichAndAdd, location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const timers = popups
      .filter(p => !p.is_breach)
      .map(p => setTimeout(() => dismiss(p.notif_id, true), AUTO_DISMISS_WARNING_MS));
    return () => timers.forEach(clearTimeout);
  }, [popups.map(p => p.notif_id).join('|')]);

  const dismiss = async (id, silent = false) => {
    setPopups(prev => prev.filter(p => p.notif_id !== id));
    if (!silent) {
      try { await api.patch(`/notifications/${id}/read`); } catch (_e) {}
    } else {
      try { await api.patch(`/notifications/${id}/read`); } catch (_e) {}
    }
  };

  const open = async (popup) => {
    if (popup.alert) {
      openTab(popup.alert);
      goTo('alerts');
    }
    dismiss(popup.notif_id, false);
  };

  if (!recipientPath || popups.length === 0) return null;

  const visibleAll = popups.length;
  const visible = collapsed ? popups.slice(-VISIBLE_MAX) : popups;
  const hidden = visibleAll - visible.length;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[360px]">
      {hidden > 0 && collapsed && (
        <button onClick={() => setCollapsed(false)}
          className="self-end text-xs px-3 py-1.5 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800">
          + {hidden} more SLA alert{hidden > 1 ? 's' : ''}
        </button>
      )}
      {!collapsed && popups.length > VISIBLE_MAX && (
        <button onClick={() => setCollapsed(true)}
          className="self-end text-xs px-3 py-1.5 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800">
          Collapse
        </button>
      )}
      {visible.map(p => <PopupCard key={p.notif_id} popup={p} tick={tick}
        onDismiss={() => dismiss(p.notif_id, false)} onOpen={() => open(p)} />)}
    </div>
  );
}

function PopupCard({ popup, tick, onDismiss, onOpen }) {
  const remainingMs = popup.deadline ? popup.deadline.getTime() - Date.now() : null;
  const pct = pctRemaining(popup.deadline, popup.sla_days);

  const tone = popup.is_breach
    ? { border: 'border-l-red-500', bg: 'bg-red-50', dot: 'text-red-600', titleColor: 'text-red-700' }
    : { border: 'border-l-orange-500', bg: 'bg-white', dot: 'text-orange-600', titleColor: 'text-orange-700' };

  const Icon = popup.is_breach ? ShieldAlert : AlertTriangle;
  const headerLabel = popup.is_breach
    ? (popup.is_manager ? 'Team SLA Breached' : 'SLA Breached')
    : (popup.is_manager ? 'Team SLA Warning'  : 'SLA Warning');

  return (
    <div className={`rounded-lg border ${tone.border} border-l-4 border-slate-200 ${tone.bg} shadow-xl overflow-hidden`} role="alert">
      <div className="flex items-start gap-2 px-4 pt-3">
        <Icon size={16} className={`mt-0.5 ${tone.dot}`} />
        <div className={`text-sm font-semibold ${tone.titleColor} flex-1`}>{headerLabel}</div>
        <button onClick={onDismiss} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X size={14} /></button>
      </div>
      <div className="px-4 pb-2">
        <div className="text-sm font-medium text-navy-900">
          {popup.alert?.alert_id || popup.related_id}
          {popup.alert?.scenario ? ` — ${popup.alert.scenario}` : ''}
        </div>
        <div className="text-xs text-slate-600">
          {popup.alert?.customer_name
            ? <>Customer: <span className="font-medium">{popup.alert.customer_name}</span></>
            : popup.message}
        </div>
        {popup.is_manager && popup.alert?.assigned_to && (
          <div className="text-xs text-slate-500 mt-0.5">
            Assigned to: <span className="font-medium">{popup.alert.assigned_to}</span>
          </div>
        )}
        <div className={`text-xs mt-2 ${popup.is_breach ? 'text-red-600 font-semibold' : 'text-orange-700'}`} key={tick}>
          {popup.is_breach ? 'Breached by:' : 'Time Remaining:'} {fmtRemaining(remainingMs)}
        </div>
      </div>
      {!popup.is_breach && popup.deadline && popup.sla_days != null && (
        <div className="h-1 bg-slate-100">
          <div
            className={`h-full transition-all ${pct < 30 ? 'bg-red-500' : pct < 50 ? 'bg-orange-500' : 'bg-green-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="px-4 py-2 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
        <button onClick={onDismiss}
          className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-white">Dismiss</button>
        <button onClick={onOpen}
          className={`text-xs px-2.5 py-1 rounded text-white inline-flex items-center gap-1 ${popup.is_breach ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
          Open Alert <ArrowRight size={11} />
        </button>
      </div>
    </div>
  );
}
