import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import Toggle from '../components/shared/Toggle.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Save, RotateCcw, AlertTriangle, Shield, SlidersHorizontal, Users as UsersIcon,
  FileText, Bell, Lock, Briefcase, Layout, Monitor, FolderOpen
} from 'lucide-react';

const MANAGER_SECTIONS = [
  { k: 'alerts',     label: 'Alert & SLA Configuration',    icon: SlidersHorizontal },
  { k: 'scenarios',  label: 'Scenario Configuration',       icon: Shield },
  { k: 'scoring',    label: 'Alert Priority Scoring',       icon: AlertTriangle },
  { k: 'team',       label: 'Team & Workload Management',   icon: UsersIcon },
  { k: 'sar',        label: 'SAR & Retention',              icon: FileText },
  { k: 'report',     label: 'Reporting & Notifications',    icon: Bell },
  { k: 'audit',      label: 'Audit & Compliance',           icon: Lock }
];

const SCENARIO_LIST = [
  { name: 'Structuring',       desc: 'Multiple transactions below the $10,000 CTR threshold' },
  { name: 'High Risk Country', desc: 'Transactions involving FATF high-risk jurisdictions' },
  { name: 'Watchlist Hit',     desc: 'Counterparty matches OFAC or internal watchlist' },
  { name: 'Cash Intensive',    desc: 'Cash activity inconsistent with customer profile' },
  { name: 'Rapid Movement',    desc: 'Large funds received and disbursed within 48 hours' },
  { name: 'Trade Based ML',    desc: 'Trade transactions with anomalous patterns' }
];

const SCENARIO_PRIORITIES = ['High', 'Medium', 'Low'];

const EMPLOYEE_SECTIONS = [
  { k: 'workspace',     label: 'My Workspace',             icon: Layout },
  { k: 'investigation', label: 'Investigation Workspace',  icon: Briefcase },
  { k: 'notif',         label: 'Notifications',            icon: Bell },
  { k: 'display',       label: 'Display Preferences',      icon: Monitor },
  { k: 'docs',          label: 'Documents & Notes',        icon: FolderOpen }
];

const SECTION_KEY_PREFIX = {
  alerts:     ['sla.', 'max_alerts_per_analyst', 'alert_aging_highlight_days'],
  scenarios:  ['scenarios.'],
  scoring:    ['scoring.'],
  team:       ['team.'],
  sar:        ['sar.'],
  report:     ['report.'],
  audit:      ['audit.', 'ofac.'],
  workspace:     ['workspace.'],
  investigation: ['investigation.'],
  notif:         ['notif.'],
  display:       ['display.'],
  docs:          ['docs.']
};

function keysForSection(sectionK, allKeys) {
  const prefixes = SECTION_KEY_PREFIX[sectionK] || [];
  return allKeys.filter(k => prefixes.some(p => p.endsWith('.') ? k.startsWith(p) : k === p));
}

export default function Settings() {
  const { isManager } = useRole();

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-bold text-navy-900">
          {isManager ? 'Manager Settings' : 'My Settings'}
        </div>
        <div className="text-sm text-slate-500">
          {isManager
            ? 'Manager-level controls apply team-wide.'
            : 'These preferences apply only to your account.'}
        </div>
      </div>

      {isManager && (
        <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-slate-700">
          Settings are managed by the Compliance Manager. Changes take effect immediately.
        </div>
      )}

      {isManager ? <ManagerSettingsPane /> : <EmployeeSettingsPane />}
    </div>
  );
}

function useBeforeUnload(isDirty) {
  useEffect(() => {
    if (!isDirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);
}

// ============================================================ MANAGER PANE

function ManagerSettingsPane() {
  return <SettingsPane
    kind="manager"
    sections={MANAGER_SECTIONS}
    loadUrl="/settings/manager"
    saveUrl="/settings/manager"
    resetUrl="/settings/manager"
    renderSection={(sectionK, values, setValue) => (
      <ManagerSectionContent sectionK={sectionK} values={values} setValue={setValue} />
    )}
  />;
}

// ============================================================ EMPLOYEE PANE

function EmployeeSettingsPane() {
  const { analysts, currentAnalyst, setCurrentAnalyst } = useRole();
  const activeAnalyst = currentAnalyst || analysts[0];

  if (!activeAnalyst) {
    return <div className="text-sm text-slate-500 py-10 text-center">Loading analysts…</div>;
  }

  return (
    <div className="space-y-3">
      <Card bodyClassName="p-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">Settings for:</span>
          <select
            value={activeAnalyst}
            onChange={e => setCurrentAnalyst(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white"
          >
            {analysts.map(a => <option key={a}>{a}</option>)}
          </select>
          <span className="text-xs text-slate-400 ml-auto">
            Employee settings persist per analyst
          </span>
        </div>
      </Card>
      <SettingsPane
        key={activeAnalyst}
        kind="employee"
        sections={EMPLOYEE_SECTIONS}
        loadUrl={`/settings/employee/${encodeURIComponent(activeAnalyst)}`}
        saveUrl={`/settings/employee/${encodeURIComponent(activeAnalyst)}`}
        resetUrl={`/settings/employee/${encodeURIComponent(activeAnalyst)}`}
        renderSection={(sectionK, values, setValue) => (
          <EmployeeSectionContent sectionK={sectionK} values={values} setValue={setValue} />
        )}
      />
    </div>
  );
}

// ============================================================ SHARED PANE

function SettingsPane({ kind, sections, loadUrl, saveUrl, resetUrl, renderSection }) {
  const { push } = useToast();
  const [original, setOriginal] = useState(null);
  const [values, setValues] = useState(null);
  const [active, setActive] = useState(sections[0].k);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(loadUrl).then(r => {
      setOriginal(r.data);
      setValues(r.data);
    });
  }, [loadUrl]);

  const dirtyKeys = useMemo(() => {
    if (!original || !values) return new Set();
    const d = new Set();
    for (const k of Object.keys(values)) {
      if (JSON.stringify(values[k]) !== JSON.stringify(original[k])) d.add(k);
    }
    return d;
  }, [values, original]);

  const isDirty = dirtyKeys.size > 0;
  useBeforeUnload(isDirty);

  const allKeys = values ? Object.keys(values) : [];
  const dirtySections = useMemo(() => {
    const s = new Set();
    for (const sec of sections) {
      const secKeys = keysForSection(sec.k, allKeys);
      if (secKeys.some(k => dirtyKeys.has(k))) s.add(sec.k);
    }
    return s;
  }, [dirtyKeys, allKeys, sections]);

  const setValue = (key, next) => setValues(v => ({ ...v, [key]: next }));

  const saveSection = async () => {
    const secKeys = keysForSection(active, allKeys).filter(k => dirtyKeys.has(k));
    if (secKeys.length === 0) return;
    const payload = Object.fromEntries(secKeys.map(k => [k, values[k]]));
    setSaving(true);
    try {
      const { data } = await api.post(saveUrl, payload);
      setOriginal(data.settings);
      setValues(data.settings);
      push('Settings saved successfully', 'success');
    } catch (e) {
      push('Failed to save settings', 'error');
    } finally { setSaving(false); }
  };

  const resetSection = async () => {
    if (!confirm('Reset this section to defaults?')) return;
    const secKeys = keysForSection(active, allKeys);
    const { data: defaults } = await api.get('/settings/defaults');
    const bucket = defaults[kind];
    const payload = Object.fromEntries(secKeys.map(k => [k, bucket[k]]));
    setSaving(true);
    try {
      const { data } = await api.post(saveUrl, payload);
      setOriginal(data.settings);
      setValues(data.settings);
      push('Section reset to defaults', 'info');
    } finally { setSaving(false); }
  };

  if (!values) return <div className="text-slate-400 text-sm py-10 text-center">Loading settings…</div>;

  return (
    <div className="flex gap-4">
      <nav className="w-64 shrink-0 bg-white rounded-lg border border-slate-200 shadow-sm p-2">
        {sections.map(sec => {
          const Icon = sec.icon;
          const activeSec = sec.k === active;
          const dirty = dirtySections.has(sec.k);
          return (
            <button key={sec.k} onClick={() => setActive(sec.k)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition ${
                activeSec ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              <Icon size={15} />
              <span className="flex-1">{sec.label}</span>
              {dirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes" />}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-w-0">
        <Card
          title={sections.find(s => s.k === active)?.label}
          subtitle={dirtySections.has(active)
            ? <span className="text-yellow-600 flex items-center gap-1"><AlertTriangle size={12} /> Unsaved changes in this section</span>
            : null}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={resetSection}
                className="text-xs inline-flex items-center gap-1 border border-slate-200 hover:bg-slate-50 rounded-md px-3 py-1.5"
              >
                <RotateCcw size={13} /> Reset to Default
              </button>
              <button
                onClick={saveSection}
                disabled={saving || !dirtySections.has(active)}
                className="text-xs inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md px-3 py-1.5"
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          }
        >
          {renderSection(active, values, setValue)}
        </Card>
      </div>
    </div>
  );
}

// ============================================================ MANAGER SECTION CONTENT

function ManagerSectionContent({ sectionK, values, setValue }) {
  if (sectionK === 'alerts') return (
    <div className="space-y-6">
      <Group title="Default SLA by Priority">
        <NumberField label="High priority SLA (days)"   value={values['sla.high_days']}   onChange={v => setValue('sla.high_days', v)}   min={1} max={30} />
        <NumberField label="Medium priority SLA (days)" value={values['sla.medium_days']} onChange={v => setValue('sla.medium_days', v)} min={1} max={60} />
        <NumberField label="Low priority SLA (days)"    value={values['sla.low_days']}    onChange={v => setValue('sla.low_days', v)}    min={1} max={90} />
      </Group>
      <Group title="SLA Breach Warnings">
        <SliderField label="Warn when X% of SLA has elapsed"
          value={values['sla.warning_threshold_pct']}
          onChange={v => setValue('sla.warning_threshold_pct', v)} min={50} max={100} suffix="%" />
        <NumberField label="Auto-escalate if SLA breached by (days)"
          value={values['sla.auto_escalate_days_overdue']}
          onChange={v => setValue('sla.auto_escalate_days_overdue', v)} min={1} max={30} />
      </Group>
      <Group title="Workload Limits">
        <NumberField label="Maximum alerts per analyst" value={values['max_alerts_per_analyst']}
          onChange={v => setValue('max_alerts_per_analyst', v)} min={5} max={200} />
        <NumberField label="Alert aging threshold for dashboard highlight (days)"
          value={values['alert_aging_highlight_days']}
          onChange={v => setValue('alert_aging_highlight_days', v)} min={1} max={180} />
      </Group>
    </div>
  );

  if (sectionK === 'scenarios') return (
    <div className="space-y-4">
      <div className="text-xs text-slate-600">
        Configure monitoring scenarios and alert thresholds.
      </div>
      <div className="text-[11px] text-slate-400 italic">
        Changes take effect on the next monitoring cycle.
      </div>
      {SCENARIO_LIST.map(s => {
        const active = values['scenarios.active']?.[s.name] !== false;
        const cfg = values['scenarios.config']?.[s.name] || {};
        const priority = cfg.priority || 'Medium';
        const fpWarn = cfg.fp_warn_pct != null ? cfg.fp_warn_pct : 40;
        const updateActive = (checked) =>
          setValue('scenarios.active', { ...(values['scenarios.active'] || {}), [s.name]: checked });
        const updateCfg = (patch) =>
          setValue('scenarios.config', {
            ...(values['scenarios.config'] || {}),
            [s.name]: { ...cfg, ...patch }
          });
        return (
          <div key={s.name} className={`border rounded-md p-3 ${active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-sm text-navy-900">{s.name}</div>
                  {!active && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-slate-200 text-slate-600">Inactive</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-slate-500">Active</span>
                <Toggle checked={active} onChange={updateActive} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <LabeledSelect label="Default priority" value={priority}
                onChange={v => updateCfg({ priority: v })} options={SCENARIO_PRIORITIES} />
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                  Alert if FP rate exceeds
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1} max={100}
                    value={fpWarn}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) updateCfg({ fp_warn_pct: Math.min(100, Math.max(1, n)) });
                    }}
                    className="w-20 text-xs border border-slate-200 rounded px-2 py-1 text-right"
                  />
                  <span className="text-[11px] text-slate-500">%</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  % of alerts closed as false positive
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  if (sectionK === 'scoring') return (
    <div className="space-y-6">
      <div className="text-xs text-slate-500 leading-snug">
        These settings control how ARC ranks which alert an analyst should
        work on next. Increasing the SLA weight ensures time-critical alerts
        surface before high-risk but time-flexible alerts. Changes take effect
        on the analyst's next page load.
      </div>
      <Group title="Composite Score Weights">
        <SliderField
          label="SLA weight"
          value={Math.round(Number(values['scoring.weight_sla'] ?? 0.6) * 100)}
          onChange={v => setValue('scoring.weight_sla', Math.max(0, Math.min(1, Number(v) / 100)))}
          min={0}
          max={100}
          suffix="%"
        />
        <div className="text-xs text-slate-500 -mt-2">
          Risk weight: {Math.round((1 - Number(values['scoring.weight_sla'] ?? 0.6)) * 100)}% (derived as 100% − SLA weight)
        </div>
      </Group>
      <Group title="SLA Urgency Tiers">
        <NumberField
          label="Critical-tier threshold (days remaining)"
          value={values['scoring.critical_tier_days']}
          onChange={v => {
            const n = Number(v);
            const warning = Number(values['scoring.warning_tier_days'] ?? 10);
            // Critical must be strictly less than warning. Clamp on the way out.
            if (Number.isFinite(n)) setValue('scoring.critical_tier_days', Math.max(1, Math.min(14, Math.min(n, warning - 1))));
          }}
          min={1}
          max={14}
        />
        <NumberField
          label="Warning-tier threshold (days remaining)"
          value={values['scoring.warning_tier_days']}
          onChange={v => {
            const n = Number(v);
            const critical = Number(values['scoring.critical_tier_days'] ?? 5);
            if (Number.isFinite(n)) setValue('scoring.warning_tier_days', Math.max(2, Math.min(20, Math.max(n, critical + 1))));
          }}
          min={2}
          max={20}
        />
      </Group>
      <Group title="Float Lockout">
        <ToggleField
          label="Prevent analysts from dismissing the priority float when a critical-SLA alert is in queue"
          checked={values['scoring.float_lockout_on_critical']}
          onChange={v => setValue('scoring.float_lockout_on_critical', v)}
        />
      </Group>
    </div>
  );

  if (sectionK === 'team') return (
    <div className="space-y-6">
      <SliderField label="Alert when analyst exceeds X% capacity"
        value={values['team.capacity_warn_pct']}
        onChange={v => setValue('team.capacity_warn_pct', v)} min={50} max={100} suffix="%" />
      <ToggleField label="Auto-distribute unassigned alerts"
        checked={values['team.auto_distribute']}
        onChange={v => setValue('team.auto_distribute', v)} />
      <ToggleField label="Round-robin assignment"
        sub="Rotate new alerts across analysts evenly"
        checked={values['team.round_robin']}
        onChange={v => setValue('team.round_robin', v)} />
      <ToggleField label="Assign by workload"
        sub="Route to the analyst with the fewest open alerts"
        checked={values['team.assign_by_workload']}
        onChange={v => setValue('team.assign_by_workload', v)} />
      <NumberField label="Team lead escalation after X hours unactioned"
        value={values['team.lead_escalation_hours']}
        onChange={v => setValue('team.lead_escalation_hours', v)} min={1} max={168} />
    </div>
  );

  if (sectionK === 'sar') return (
    <div className="space-y-6">
      <Group title="Retention Policy">
        <NumberField label="Default retention period (years)"
          value={values['sar.retention_years']}
          onChange={v => setValue('sar.retention_years', v)} min={1} max={15} />
        <NumberField label="Warn X days before expiry"
          value={values['sar.retention_warn_days']}
          onChange={v => setValue('sar.retention_warn_days', v)} min={1} max={365} />
      </Group>
      <Group title="Filing">
        <ToggleField label="Require dual approval for SAR filing"
          checked={values['sar.dual_approval_required']}
          onChange={v => setValue('sar.dual_approval_required', v)} />
        <NumberField label="SAR filing deadline after escalation (days)"
          value={values['sar.filing_deadline_days']}
          onChange={v => setValue('sar.filing_deadline_days', v)} min={1} max={90} />
        <NumberField label="Auto-archive closed cases after (days)"
          value={values['sar.auto_archive_closed_days']}
          onChange={v => setValue('sar.auto_archive_closed_days', v)} min={30} max={3650} />
      </Group>
      <Group title="Mandatory fields for SAR filing">
        <Toggle label="Narrative" sub="Always required" disabled checked={true} onChange={() => {}} />
        <Toggle label="Supporting document"
          checked={values['sar.mandatory_fields']?.supporting_document}
          onChange={v => setValue('sar.mandatory_fields', { ...values['sar.mandatory_fields'], supporting_document: v })} />
        <Toggle label="Transaction evidence"
          checked={values['sar.mandatory_fields']?.transaction_evidence}
          onChange={v => setValue('sar.mandatory_fields', { ...values['sar.mandatory_fields'], transaction_evidence: v })} />
        <Toggle label="Supervisor approval"
          checked={values['sar.mandatory_fields']?.supervisor_approval}
          onChange={v => setValue('sar.mandatory_fields', { ...values['sar.mandatory_fields'], supervisor_approval: v })} />
      </Group>
    </div>
  );

  if (sectionK === 'report') return (
    <div className="space-y-6">
      <SelectField label="Dashboard refresh interval"
        value={values['report.refresh_interval']}
        onChange={v => setValue('report.refresh_interval', v)}
        options={['Real-time', 'Every 5 min', 'Every 15 min', 'Every 30 min']} />
      <ToggleField label="Email notifications for SLA breaches"
        checked={values['report.notify_sla_breach']}
        onChange={v => setValue('report.notify_sla_breach', v)} />
      <ToggleField label="Email notifications for new high-priority alerts"
        checked={values['report.notify_high_priority']}
        onChange={v => setValue('report.notify_high_priority', v)} />
      <ToggleField label="Weekly performance report auto-send"
        checked={values['report.weekly_autoreport']}
        onChange={v => setValue('report.weekly_autoreport', v)} />
      <TextField label="Report recipients"
        sub="Comma-separated email addresses"
        value={values['report.recipients']}
        onChange={v => setValue('report.recipients', v)} placeholder="alice@bank.in, bob@bank.in" />
      <SelectField label="Export format default"
        value={values['report.export_format']}
        onChange={v => setValue('report.export_format', v)}
        options={['PDF', 'Excel', 'CSV']} />
    </div>
  );

  if (sectionK === 'audit') return (
    <div className="space-y-6">
      <ToggleField label="Require reason when closing alert as false positive"
        checked={values['audit.require_fp_reason']}
        onChange={v => setValue('audit.require_fp_reason', v)} />
      <ToggleField label="Require note before changing alert status"
        checked={values['audit.require_note_on_status_change']}
        onChange={v => setValue('audit.require_note_on_status_change', v)} />
      <ToggleField label="Lock case after SAR filed"
        checked={values['audit.lock_case_after_sar']}
        onChange={v => setValue('audit.lock_case_after_sar', v)} />
      <NumberField label="Minimum note length for investigation (characters)"
        value={values['audit.min_note_length']}
        onChange={v => setValue('audit.min_note_length', v)} min={0} max={2000} />
      <NumberField label="Session timeout (minutes)"
        value={values['audit.session_timeout_min']}
        onChange={v => setValue('audit.session_timeout_min', v)} min={5} max={480} />
      <ToggleField label="Download / export requires confirmation"
        checked={values['audit.export_requires_confirm']}
        onChange={v => setValue('audit.export_requires_confirm', v)} />
      <Group title="OFAC Sanctions Screening">
        <div className="text-xs text-slate-500 leading-snug">
          Hours after the last successful OFAC SDN sync before the staleness
          banner appears on the Manager and BSA Officer dashboards.
          Recommended 25-48; floor 24h, ceiling 168h (one week).
        </div>
        <NumberField
          label="OFAC staleness warning threshold (hours)"
          value={values['ofac.staleness_threshold_hours']}
          onChange={v => setValue('ofac.staleness_threshold_hours', v)}
          min={24}
          max={168}
        />
      </Group>
    </div>
  );

  return null;
}

// ============================================================ EMPLOYEE SECTION CONTENT

function EmployeeSectionContent({ sectionK, values, setValue }) {
  if (sectionK === 'workspace') return (
    <div className="space-y-6">
      <SelectField label="Default landing page after login"
        value={values['workspace.landing']}
        onChange={v => setValue('workspace.landing', v)}
        options={['My Dashboard', 'My Alerts', 'My Cases']} />
      <SelectField label="Default alert sort order"
        value={values['workspace.alert_sort']}
        onChange={v => setValue('workspace.alert_sort', v)}
        options={['SLA Earliest', 'Priority High-Low', 'Oldest First', 'Newest First']} />
      <SelectField label="Default transaction date range"
        value={values['workspace.txn_date_range']}
        onChange={v => setValue('workspace.txn_date_range', v)}
        options={['Last 30 Days', 'Last 60 Days', 'Last 90 Days', 'Last 6 Months']} />
      <ToggleField label="Collapse Kanban columns by default"
        checked={values['workspace.collapse_kanban']}
        onChange={v => setValue('workspace.collapse_kanban', v)} />
      <ToggleField label="Show SLA countdown timer on cards"
        checked={values['workspace.show_sla_timer']}
        onChange={v => setValue('workspace.show_sla_timer', v)} />
      <ToggleField label="Show customer risk badge on alert cards"
        checked={values['workspace.show_risk_badge']}
        onChange={v => setValue('workspace.show_risk_badge', v)} />
    </div>
  );

  if (sectionK === 'investigation') return (
    <div className="space-y-6">
      <SelectField label="Default left panel tab"
        value={values['investigation.left_tab']}
        onChange={v => setValue('investigation.left_tab', v)}
        options={['Transactions', 'Case Notes', 'Documents', 'Activity Log']} />
      <SelectField label="Default right panel tab"
        value={values['investigation.right_tab']}
        onChange={v => setValue('investigation.right_tab', v)}
        options={['Customer KYC', 'Business Info', 'Case Info', 'Linked Cases']} />
      <ToggleField label="Auto-expand alerted transactions"
        checked={values['investigation.autoexpand_alerted']}
        onChange={v => setValue('investigation.autoexpand_alerted', v)} />
      <ToggleField label="Show running balance column in transactions"
        checked={values['investigation.show_running_balance']}
        onChange={v => setValue('investigation.show_running_balance', v)} />
      <ToggleField label="Highlight counterparty on alerted transactions"
        checked={values['investigation.highlight_counterparty']}
        onChange={v => setValue('investigation.highlight_counterparty', v)} />
      <NumberField label="Auto-save notes every X seconds"
        value={values['investigation.autosave_seconds']}
        onChange={v => setValue('investigation.autosave_seconds', v)} min={5} max={300} />
      <ToggleField label="Confirm before closing investigation tab"
        checked={values['investigation.confirm_close_tab']}
        onChange={v => setValue('investigation.confirm_close_tab', v)} />
    </div>
  );

  if (sectionK === 'notif') return (
    <div className="space-y-6">
      <ToggleField label="New alert assigned to me"
        checked={values['notif.new_alert_assigned']}
        onChange={v => setValue('notif.new_alert_assigned', v)} />
      <ToggleField label="SLA within 2 hours"
        checked={values['notif.sla_within_2hr']}
        onChange={v => setValue('notif.sla_within_2hr', v)} />
      <ToggleField label="Case I filed was approved"
        checked={values['notif.case_approved']}
        onChange={v => setValue('notif.case_approved', v)} />
      <ToggleField label="Supervisor adds a comment"
        checked={values['notif.supervisor_comment']}
        onChange={v => setValue('notif.supervisor_comment', v)} />
      <ToggleField label="Notification sound"
        checked={values['notif.sound']}
        onChange={v => setValue('notif.sound', v)} />
      <SelectField label="Notification style"
        value={values['notif.style']}
        onChange={v => setValue('notif.style', v)}
        options={['Banner', 'Badge', 'Both']} />
    </div>
  );

  if (sectionK === 'display') return (
    <div className="space-y-6">
      <SelectField label="Date format" value={values['display.date_format']}
        onChange={v => setValue('display.date_format', v)}
        options={['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']} />
      <SelectField label="Time format" value={values['display.time_format']}
        onChange={v => setValue('display.time_format', v)} options={['12hr', '24hr']} />
      <SelectField label="Currency display" value={values['display.currency']}
        onChange={v => setValue('display.currency', v)} options={['Symbol', 'Code', 'Both']} />
      <SelectField label="Table row density" value={values['display.row_density']}
        onChange={v => setValue('display.row_density', v)} options={['Comfortable', 'Compact']} />
      <SelectField label="Theme" value={values['display.theme']}
        onChange={v => setValue('display.theme', v)} options={['Light', 'Dark']} />
    </div>
  );

  if (sectionK === 'docs') return (
    <div className="space-y-6">
      <SelectField label="Default document type on upload"
        value={values['docs.default_type']}
        onChange={v => setValue('docs.default_type', v)}
        options={['Screenshot', 'Bank Statement', 'ID Document', 'Court Record', 'Internal Report', 'Other']} />
      <ToggleField label="Show document preview on hover"
        checked={values['docs.preview_on_hover']}
        onChange={v => setValue('docs.preview_on_hover', v)} />
      <ToggleField label="Spell check in case notes"
        checked={values['docs.spellcheck_notes']}
        onChange={v => setValue('docs.spellcheck_notes', v)} />
      <div>
        <div className="text-sm text-navy-900 mb-1">Note template</div>
        <div className="text-xs text-slate-500 mb-2">Default structure prepended to every new note.</div>
        <textarea
          value={values['docs.note_template'] || ''}
          onChange={e => setValue('docs.note_template', e.target.value)}
          rows={6}
          placeholder={`Subject:\nCustomer checks:\nTransaction review:\nConclusion / recommendation:`}
          className="w-full text-sm border border-slate-200 rounded-md p-3 font-mono focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );

  return null;
}

// ============================================================ FIELD HELPERS

function Group({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, max = 9999, suffix }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-navy-900">{label}</div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          onChange={e => {
            const n = e.target.value === '' ? '' : Math.max(min, Math.min(max, parseInt(e.target.value, 10)));
            onChange(n === '' ? value : n);
          }}
          className="w-24 text-sm border border-slate-200 rounded-md px-2 py-1 text-right"
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}

function SliderField({ label, value, onChange, min = 0, max = 100, suffix }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm text-navy-900 mb-1">
        <span>{label}</span>
        <span className="font-mono text-xs text-slate-600">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-blue-600"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-navy-900">{label}</div>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white min-w-[180px]">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, sub }) {
  return (
    <div>
      <div className="text-sm text-navy-900">{label}</div>
      {sub && <div className="text-xs text-slate-500 mb-1">{sub}</div>}
      <input
        type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 text-sm border border-slate-200 rounded-md px-3 py-1.5 focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

function ToggleField({ label, sub, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-navy-900">{label}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
