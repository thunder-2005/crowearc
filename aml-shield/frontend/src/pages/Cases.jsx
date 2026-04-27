import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Badge from '../components/shared/Badge.jsx';
import { X, UserPlus, FileText, ExternalLink, Upload, FolderOpen } from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { useInvestigationTabs } from '../state/InvestigationTabsContext.jsx';

const COLUMNS = [
  'Unassigned', 'Not Started', 'Work In Progress',
  'Pending Review', 'Filed', 'Closed'
];
const ACCENT = {
  'Unassigned':       'border-t-slate-400',
  'Not Started':      'border-t-orange-400',
  'Work In Progress': 'border-t-blue-500',
  'Pending Review':   'border-t-indigo-500',
  'Filed':            'border-t-green-500',
  'Closed':           'border-t-slate-500'
};

function usd(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function Cases() {
  const { isManager, isEmployee, currentAnalyst } = useRole();
  const { openTab } = useInvestigationTabs();
  const { goTo } = useRoleNavigate();
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(null);

  const openCaseInvestigation = async (c) => {
    if (!c.source_alert_id) return;
    try {
      const { data: alert } = await api.get(`/alerts/${c.source_alert_id}`);
      openTab(alert);
      goTo('alerts');
    } catch (_e) {
      goTo('alerts');
    }
  };

  const goFileSar = (c) => goTo(`sar-filing/${c.case_id}`);

  const load = () => {
    const params = {};
    if (isEmployee && currentAnalyst) {
      params.assigned_to = currentAnalyst;
      params.include_unassigned_for = 1;
    }
    return api.get('/cases', { params }).then(r => setCases(r.data));
  };

  useEffect(() => { load(); }, [isEmployee, currentAnalyst]);

  const openCase = async (c) => {
    const { data } = await api.get(`/cases/${c.case_id}`);
    setSelected(data);
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const { data } = await api.get(`/cases/${selected.case_id}`);
    setSelected(data);
  };

  const assignToMe = async (c) => {
    if (!currentAnalyst) return;
    await api.patch(`/cases/${c.case_id}/assign`, { assigned_to: currentAnalyst });
    await load();
    if (selected?.case_id === c.case_id) await refreshSelected();
  };

  const grouped = useMemo(() => {
    const g = Object.fromEntries(COLUMNS.map(c => [c, []]));
    for (const c of cases) {
      const col = g[c.case_status];
      if (col) col.push(c);
    }
    return g;
  }, [cases]);

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div>
          <div className="text-xl font-bold text-navy-900">
            {isManager ? 'SAR Cases — Team Board' : `${currentAnalyst || ''} — SAR Cases`}
          </div>
          <div className="text-sm text-slate-500">
            {cases.length} cases {isEmployee ? '(yours + unassigned)' : 'team-wide'} · self-assign from the Unassigned column
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {COLUMNS.map(col => (
            <div key={col} className={`bg-slate-100/70 rounded-lg border-t-4 ${ACCENT[col]}`}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="text-sm font-semibold text-navy-900">{col}</div>
                <span className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5">
                  {(grouped[col] || []).length}
                </span>
              </div>
              <div className="px-2 pb-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                {(grouped[col] || []).map(c => {
                  const isMine = isEmployee && c.assigned_to === currentAnalyst;
                  return (
                    <div
                      key={c.case_id}
                      onClick={() => openCase(c)}
                      className={`bg-white rounded-md border shadow-sm p-3 cursor-pointer hover:border-blue-400 ${isMine ? 'border-blue-300' : 'border-slate-200'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-mono text-slate-500 truncate">{c.case_id}</div>
                        <Badge value={c.case_status} />
                      </div>
                      <div className="mt-1 text-sm font-medium text-navy-900 truncate">{c.customer_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">{c.scenario}</div>
                      <div className="text-[11px] text-slate-400 mt-1 truncate">
                        {c.source_alert_id} {c.linked_sar_id && `· ${c.linked_sar_id}`}
                      </div>
                      <div className="text-xs text-slate-500 mt-2 truncate">
                        {c.assigned_to || <span className="italic text-slate-400">Unassigned</span>}
                      </div>
                      {isEmployee && col === 'Unassigned' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); assignToMe(c); }}
                          className="mt-2 w-full text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md py-1.5 inline-flex items-center justify-center gap-1"
                        >
                          <UserPlus size={12} /> Assign to Me
                        </button>
                      )}
                      {isEmployee && col !== 'Unassigned' && (
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openCaseInvestigation(c); }}
                            className="text-[11px] border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded-md py-1.5 inline-flex items-center justify-center gap-1"
                          >
                            <FolderOpen size={11} /> Open
                          </button>
                          {!c.linked_sar_id ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); goFileSar(c); }}
                              className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded-md py-1.5 inline-flex items-center justify-center gap-1"
                            >
                              <FileText size={11} /> File SAR
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); goTo(`sars?sar_id=${c.linked_sar_id}`); }}
                              className="text-[11px] border border-green-300 text-green-700 hover:bg-green-50 rounded-md py-1.5 inline-flex items-center justify-center gap-1"
                            >
                              <FileText size={11} /> View SAR
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(grouped[col] || []).length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-6">No cases</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <CaseDetail
          c={selected}
          onClose={() => setSelected(null)}
          onRefresh={refreshSelected}
          onAssign={() => assignToMe(selected)}
          onOpenInvestigation={() => openCaseInvestigation(selected)}
          onFileSar={() => goFileSar(selected)}
          onViewSar={() => goTo(`sars?sar_id=${selected.linked_sar_id}`)}
        />
      )}
    </div>
  );
}

function CaseDetail({ c, onClose, onRefresh, onAssign, onOpenInvestigation, onFileSar, onViewSar }) {
  const { isEmployee, currentAnalyst } = useRole();
  const alert = c.source_alert;
  const sar = c.linked_sar;

  return (
    <aside className="w-[440px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500">{c.case_id}</div>
          <div className="text-base font-semibold text-navy-900 truncate">{c.customer_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{c.scenario}</div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-5 py-4 border-b border-slate-100 space-y-2 text-sm">
          <div className="flex items-center gap-2 mb-2">
            <Badge value={c.case_status} />
            {c.assigned_to
              ? <span className="text-xs text-slate-500">owned by {c.assigned_to}</span>
              : <span className="text-xs italic text-slate-400">Unassigned</span>}
          </div>
          <div className="text-xs text-slate-500 uppercase tracking-wider pt-2">Timeline</div>
          <div className="text-xs text-slate-600">
            Created {c.created_date} · last activity {c.updated_date}
          </div>
        </section>

        {alert && (
          <section className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-navy-900">Source Alert</div>
              <button
                onClick={onOpenInvestigation}
                className="text-xs font-mono text-blue-600 hover:underline"
                title="Open the investigation tab for this alert"
              >
                {alert.alert_id} →
              </button>
            </div>
            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded space-y-1">
              <div><span className="text-slate-500">Priority:</span> <Badge value={alert.priority} /></div>
              <div><span className="text-slate-500">Risk Score:</span> {alert.risk_score}/100</div>
              <div><span className="text-slate-500">Amount:</span> {usd(alert.amount_flagged_inr)}</div>
              <div><span className="text-slate-500">Counterparty:</span> {alert.counterparty_country}</div>
              <div><span className="text-slate-500">SLA:</span> {alert.due_status}</div>
              <div className="pt-2 text-slate-700">{alert.scenario_description}</div>
            </div>
          </section>
        )}

        <section className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-navy-900">Customer Profile</div>
          </div>
          <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded grid grid-cols-2 gap-y-1">
            <div className="text-slate-500">Customer ID</div><div>{c.customer_id || '—'}</div>
            {alert && (<>
              <div className="text-slate-500">Type</div><div>{alert.customer_type}</div>
              <div className="text-slate-500">Segment</div><div>{alert.segment}</div>
              <div className="text-slate-500">Risk Rating</div><div>{alert.customer_risk_rating}</div>
              <div className="text-slate-500">KYC</div><div>{alert.kyc_review_status}</div>
              <div className="text-slate-500">PEP / Sanctions</div>
              <div>{alert.pep_match ? 'PEP ' : ''}{alert.sanctions_match ? 'Sanctions' : (alert.pep_match ? '' : 'None')}</div>
            </>)}
          </div>
        </section>

        {sar ? (
          <section className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-navy-900">Linked SAR</div>
              <button
                onClick={onViewSar}
                className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                title="Open this SAR in the repository"
              >
                {sar.sar_id} <ExternalLink size={11} />
              </button>
            </div>
            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded space-y-1">
              <div><span className="text-slate-500">SAR ID:</span> <span className="font-mono">{sar.sar_id}</span></div>
              <div><span className="text-slate-500">Status:</span> <Badge value={sar.sar_status} /></div>
              <div><span className="text-slate-500">Prepared by:</span> {sar.prepared_by}</div>
              <div><span className="text-slate-500">Reviewed by:</span> {sar.reviewed_by || '—'}</div>
              <div><span className="text-slate-500">Approved by:</span> {sar.approved_by || '—'}</div>
              <div><span className="text-slate-500">Regulator ref:</span> {sar.regulator_reference || '—'}</div>
              <div><span className="text-slate-500">QA score:</span> {sar.qa_score}</div>
              <div><span className="text-slate-500">Documents:</span> {sar.documents_count}</div>
              <div className="pt-2 text-slate-700">{sar.narrative_summary}</div>
            </div>
          </section>
        ) : (
          <section className="px-5 py-4 border-b border-slate-100">
            <div className="text-sm font-semibold text-navy-900 mb-1">SAR</div>
            <div className="text-xs text-slate-500">No SAR filed yet for this case.</div>
          </section>
        )}
      </div>

      <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
        {isEmployee && !c.assigned_to && (
          <button
            onClick={onAssign}
            className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <UserPlus size={14} /> Assign to Me
          </button>
        )}
        {isEmployee && c.assigned_to && c.source_alert_id && (
          <button
            onClick={onOpenInvestigation}
            className="flex-1 text-sm border border-slate-300 hover:border-slate-400 rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <FolderOpen size={14} /> Open Case
          </button>
        )}
        {isEmployee && c.assigned_to === currentAnalyst && !sar && (
          <button
            onClick={onFileSar}
            className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <FileText size={14} /> File SAR
          </button>
        )}
        {sar && (
          <button
            onClick={onViewSar}
            className="flex-1 text-sm border border-slate-300 hover:border-slate-400 rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <Upload size={14} /> View SAR
          </button>
        )}
      </div>
    </aside>
  );
}
