import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Check, Circle, Loader2, Save, Send, X, ArrowLeft, ArrowRight,
  ExternalLink, AlertTriangle, CheckCircle2, FileText, Upload,
  Trash2, Sparkles, Info, RotateCcw, Lock
} from 'lucide-react';

const STEPS = [
  { k: 'details',    label: 'SAR Details' },
  { k: 'subject',    label: 'Subject Information' },
  { k: 'activity',   label: 'Suspicious Activity Information' },
  { k: 'narrative',  label: 'Narrative' },
  { k: 'attachments', label: 'Attachments' },
  { k: 'review',     label: 'Review & Submit' }
];

const FILING_TYPES = ['Initial SAR', 'Continuing SAR', 'Joint SAR'];
const FILING_METHODS = ['Electronic', 'Paper'];
const REGULATORS = ['FinCEN', 'OCC', 'FRB', 'FDIC', 'FIU-IND'];
const SAR_TYPES = ['BSA (Bank Secrecy Act)', 'Other'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const ACTIVITY_TYPES = [
  'Structuring', 'Money Laundering', 'Fraud', 'Terrorist Financing',
  'Identity Theft', 'Bribery/Corruption', 'Cyber Crime', 'Human Trafficking',
  'Tax Evasion', 'Sanctions Evasion', 'Trade Based ML', 'Other'
];
const TXN_TYPES = [
  'Wire Transfer', 'Cash Deposit', 'Cash Withdrawal', 'ACH',
  'Check', 'Trade Finance', 'Virtual Currency', 'Other'
];

const today = () => new Date().toISOString().slice(0, 10);

function usdFmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toTimeString().slice(0, 5);
}

const FINANCIAL_INSTITUTION = {
  name: 'First National Bank - US',
  address: '200 Park Avenue, New York, NY 10166, USA',
  fein: '12-3456789',
  contact_name: 'Compliance Department',
  contact_phone: '212-555-0100'
};
const BSA_INSTITUTION_DEFAULT = 'First National Bank - US (FEIN: 12-3456789)';

export default function SARFiling() {
  const { caseId } = useParams();
  const [search] = useSearchParams();
  const isViewOnly = search.get('view') === '1';
  const { isManager, isL1, currentAnalyst } = useRole();
  const { push: pushToast } = useToast();
  const { goTo } = useRoleNavigate();

  // L1 analysts cannot file SARs — bounce them back to the dashboard with a
  // toast so a stale bookmark / browser back-button doesn't drop them on a
  // wizard they aren't permitted to use.
  useEffect(() => {
    if (isL1) {
      pushToast('SAR filing is restricted to L2 analysts and above.', 'warning');
      goTo('dashboard');
    }
  }, [isL1, goTo, pushToast]);
  if (isL1) return null;

  const [stepIdx, setStepIdx] = useState(0);
  const [caseInfo, setCaseInfo] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [filing, setFiling] = useState(null);
  const [form, setForm] = useState(null);
  const [docs, setDocs] = useState([]);
  const [includeDocIds, setIncludeDocIds] = useState([]);
  const [notesText, setNotesText] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState({ saving: false, lastSaved: null });
  const [submittingFinal, setSubmittingFinal] = useState(false);
  const [success, setSuccess] = useState(null);
  const [errors, setErrors] = useState({});

  const formRef = useRef(form);
  formRef.current = form;
  const includeDocIdsRef = useRef(includeDocIds);
  includeDocIdsRef.current = includeDocIds;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: c } = await api.get(`/cases/${caseId}`);
        if (cancelled) return;
        setCaseInfo(c);

        let cust = null;
        if (c.customer_id) {
          try {
            const { data } = await api.get(`/customers/${c.customer_id}`);
            cust = data;
          } catch (_e) { /* customer optional */ }
        }
        if (cancelled) return;
        setCustomer(cust);

        let f = null;
        try {
          const { data } = await api.get(`/sar-filings/by-case/${encodeURIComponent(caseId)}`);
          f = data;
        } catch (_e) { /* no filing yet */ }

        if (!f && !isViewOnly) {
          const { data: created } = await api.post('/sar-filings', {
            case_id: c.case_id,
            customer_id: c.customer_id,
            customer_name: c.customer_name,
            source_alert_id: c.source_alert_id,
            alert_scenario: c.scenario,
            prepared_by: currentAnalyst || 'Compliance Analyst'
          });
          f = created;
        }
        if (cancelled) return;
        setFiling(f);
        setForm(buildInitialForm(c, cust, f));
        const incoming = (f?.draft_data?.included_documents) || f?.included_documents || [];
        setIncludeDocIds(Array.isArray(incoming) ? incoming : []);

        if (c.source_alert_id) {
          try {
            const { data: alertDocs } = await api.get(`/case-documents/${c.source_alert_id}`);
            if (!cancelled) setDocs(alertDocs);
            if (!cancelled && (!incoming || incoming.length === 0)) {
              setIncludeDocIds(alertDocs.map(d => d.id));
            }
            const { data: notes } = await api.get(`/case-notes/${c.source_alert_id}`);
            if (!cancelled) {
              setNotesText(notes.map(n => `[${n.timestamp} · ${n.analyst}] ${n.note_text}`).join('\n\n'));
            }
          } catch (_e) { /* docs/notes optional */ }
        }
      } catch (e) {
        pushToast('Failed to load case: ' + (e.response?.data?.error || e.message), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [caseId]);

  // saveDraft accepts an optional { stepCompleted: 1..6 } so the backend can
  // emit a "Step N completed — [Title]" audit row. Auto-saves and manual
  // saves omit it; only the wizard's Next button passes it.
  const saveDraft = async (silent = false, opts = {}) => {
    if (!filing || isViewOnly) return;
    const f = formRef.current;
    if (!f) return;
    setSavingState(s => ({ ...s, saving: true }));
    try {
      const payload = serializeForm(f, includeDocIdsRef.current);
      if (opts.stepCompleted) payload.step_completed = opts.stepCompleted;
      if (currentAnalyst) payload.performed_by = currentAnalyst;
      const { data } = await api.patch(`/sar-filings/${filing.sar_id}`, payload);
      setFiling(data);
      setSavingState({ saving: false, lastSaved: new Date() });
      if (!silent) pushToast('Draft saved', 'success', 1800);
    } catch (e) {
      setSavingState(s => ({ ...s, saving: false }));
      if (!silent) pushToast('Save failed: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  useEffect(() => {
    if (!filing || isViewOnly) return;
    const id = setInterval(() => saveDraft(true), 30000);
    return () => clearInterval(id);
  }, [filing, isViewOnly]);

  const validation = useMemo(() => buildValidation(form, includeDocIds), [form, includeDocIds]);
  const completedSteps = useMemo(() => stepCompletion(form, validation, includeDocIds), [form, validation, includeDocIds]);

  const goStep = (i) => { setStepIdx(Math.max(0, Math.min(STEPS.length - 1, i))); };
  const next = () => {
    const errs = validateStep(STEPS[stepIdx].k, form, validation, includeDocIds);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      pushToast('Fix the highlighted fields before continuing', 'warning');
      return;
    }
    setErrors({});
    // stepIdx is 0-based; spec wants 1-based step numbers in the audit log.
    saveDraft(true, { stepCompleted: stepIdx + 1 });
    goStep(stepIdx + 1);
  };
  const prev = () => { setErrors({}); goStep(stepIdx - 1); };

  const submitFinal = async () => {
    if (isViewOnly || !filing) return;
    const allErrs = {};
    for (const s of STEPS) Object.assign(allErrs, validateStep(s.k, form, validation, includeDocIds));
    if (!form.certification_signed) allErrs.certification_signed = 'Certification required';
    setErrors(allErrs);
    if (Object.keys(allErrs).length > 0) {
      pushToast('SAR is incomplete — review the validation panel', 'error');
      return;
    }
    setSubmittingFinal(true);
    try {
      await api.patch(`/sar-filings/${filing.sar_id}`, serializeForm(form, includeDocIds));
      const { data } = await api.post(`/sar-filings/${filing.sar_id}/submit`, {
        submitted_by: currentAnalyst || form.prepared_by || 'Compliance Analyst'
      });
      setSuccess(data);
    } catch (e) {
      pushToast('Submit failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmittingFinal(false); }
  };

  if (loading || !caseInfo || !form) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading SAR filing…
      </div>
    );
  }

  if (success) {
    return (
      <SuccessScreen
        sar={success}
        onViewRepo={() => goTo('sars')}
        onBackToCases={() => goTo('cases')}
      />
    );
  }

  const isLocked = filing && (filing.sar_status === 'Pending Approval' || filing.sar_status === 'Under Manager Review' || filing.sar_status === 'Filed');
  const isReturned = filing && filing.sar_status === 'Returned for Revision';

  const dirtyForm = (patch) => {
    if (isLocked) return;
    setForm(f => ({ ...f, ...patch }));
  };

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <Header
          caseInfo={caseInfo}
          filing={filing}
          isViewOnly={isViewOnly || isLocked}
          isLocked={isLocked}
          savingState={savingState}
          onCancel={() => goTo('sars')}
          onSaveDraft={() => saveDraft(false)}
          onSubmit={submitFinal}
          submittingFinal={submittingFinal}
          analyst={currentAnalyst}
        />

        {isReturned && <RevisionBanner filing={filing} />}
        {filing?.kyc_data_changed && !isLocked && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-900 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 text-yellow-700" />
            <div>
              <div className="font-semibold">KYC data updated since draft was saved</div>
              <div className="text-xs mt-0.5">
                Customer record was last reviewed on <span className="font-mono">{filing.customer_kyc_status ? filing.customer_kyc_status : ''}</span>.
                Re-check Step 2 (Subject Information) before submitting — auto-populated values may be stale.
              </div>
            </div>
          </div>
        )}
        {isLocked && filing.sar_status === 'Pending Approval' && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800 flex items-start gap-2">
            <Lock size={14} className="mt-0.5" />
            <div>
              <div className="font-semibold">SAR submitted for supervisor approval</div>
              <div className="text-xs">You will be notified when reviewed. The form is locked while pending.</div>
            </div>
          </div>
        )}
        {isLocked && filing.sar_status === 'Filed' && (
          <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800 flex items-start gap-2">
            <CheckCircle2 size={14} className="mt-0.5" />
            <div>
              <div className="font-semibold">SAR filed</div>
              <div className="text-xs">Filed on {filing.filed_date} · Reference {filing.regulator_reference || '—'}</div>
            </div>
          </div>
        )}

        <Stepper steps={STEPS} idx={stepIdx} completed={completedSteps} onSelect={goStep} />

        <Card bodyClassName="p-0">
          <div className="p-5">
            {STEPS[stepIdx].k === 'details' && (
              <StepDetails form={form} setForm={dirtyForm} errors={errors}
                customer={customer} caseInfo={caseInfo} jumpToSubject={() => goStep(1)} />
            )}
            {STEPS[stepIdx].k === 'subject' && (
              <StepSubject form={form} setForm={dirtyForm} errors={errors} />
            )}
            {STEPS[stepIdx].k === 'activity' && (
              <StepActivity form={form} setForm={dirtyForm} errors={errors} />
            )}
            {STEPS[stepIdx].k === 'narrative' && (
              <StepNarrative form={form} setForm={dirtyForm} errors={errors} notesText={notesText} />
            )}
            {STEPS[stepIdx].k === 'attachments' && (
              <StepAttachments
                caseInfo={caseInfo}
                docs={docs}
                setDocs={setDocs}
                includeDocIds={includeDocIds}
                setIncludeDocIds={setIncludeDocIds}
                errors={errors}
                analyst={currentAnalyst}
              />
            )}
            {STEPS[stepIdx].k === 'review' && (
              <StepReview
                form={form} setForm={dirtyForm} errors={errors}
                docs={docs} includeDocIds={includeDocIds}
                caseInfo={caseInfo} customer={customer}
                onSubmit={submitFinal} submitting={submittingFinal}
                isViewOnly={isViewOnly}
              />
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={prev}
              disabled={stepIdx === 0}
              className="text-sm px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Previous
            </button>
            <div className="text-xs text-slate-500">
              Step {stepIdx + 1} of {STEPS.length}
            </div>
            {stepIdx < STEPS.length - 1 ? (
              <button
                onClick={next}
                className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
              >
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={submitFinal}
                disabled={isViewOnly || submittingFinal}
                className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-1"
              >
                <Send size={14} /> {submittingFinal ? 'Submitting…' : 'Submit SAR'}
              </button>
            )}
          </div>
        </Card>
      </div>

      <Sidebar steps={STEPS} idx={stepIdx} completed={completedSteps} validation={validation} />
    </div>
  );
}

function buildInitialForm(c, cust, f) {
  const draft = (f && f.draft_data) || {};
  const fromFiling = (k, fallback) => (draft[k] !== undefined ? draft[k]
                                       : (f && f[k] !== undefined && f[k] !== null) ? f[k]
                                       : fallback);

  const subjectFromCustomer = cust ? {
    type: cust.customer_type === 'Individual' ? 'Individual' : 'Entity',
    first_name: cust.customer_type === 'Individual' ? (cust.customer_name || '').split(' ')[0] : '',
    last_name:  cust.customer_type === 'Individual' ? (cust.customer_name || '').split(' ').slice(1).join(' ') : '',
    legal_name: cust.customer_type !== 'Individual' ? cust.customer_name : '',
    dba_name: cust.trading_name || '',
    dob: cust.date_of_birth || '',
    ein: cust.registration_number || '',
    ssn_tin: cust.government_id_number || '',
    address: cust.residential_address || cust.mailing_address || '',
    country: cust.country_of_residence || cust.country_of_incorporation || '',
    business_type: cust.business_type || '',
    industry: cust.industry || '',
    occupation: cust.job_title || '',
    relationship: 'Customer',
    beneficial_owners: Array.isArray(cust.beneficial_owners) ? cust.beneficial_owners : []
  } : { type: 'Individual', beneficial_owners: [] };

  return {
    filing_type:        fromFiling('filing_type', 'Initial SAR'),
    filing_method:      fromFiling('filing_method', 'Electronic'),
    regulatory_agency:  fromFiling('regulatory_agency', 'FinCEN'),
    sar_type:           fromFiling('sar_type', 'BSA (Bank Secrecy Act)'),
    detection_date:     fromFiling('detection_date', c.created_date || today()),
    date_of_report:     fromFiling('date_of_report', today()),
    bsa_filing_institution: fromFiling('bsa_filing_institution', BSA_INSTITUTION_DEFAULT),
    tin:                fromFiling('tin', cust?.government_id_number || FINANCIAL_INSTITUTION.fein),
    num_transactions:   fromFiling('num_transactions', ''),
    total_amount:       fromFiling('total_amount', ''),
    currency:           fromFiling('currency', 'USD'),
    structuring_indicator: fromFiling('structuring_indicator', 0),
    prior_sars:         fromFiling('prior_sars', 0),
    prior_sar_count:    fromFiling('prior_sar_count', ''),
    date_of_recent_sar: fromFiling('date_of_recent_sar', ''),

    activity_date_from: fromFiling('activity_date_from', ''),
    activity_date_to:   fromFiling('activity_date_to', ''),
    amount_involved_inr: fromFiling('amount_involved_inr', 0),
    suspicious_activity_types: fromFiling('suspicious_activity_types', []) || [],
    suspicious_activity_other: fromFiling('suspicious_activity_other', ''),
    transaction_types:  fromFiling('transaction_types', []) || [],
    transaction_locations: fromFiling('transaction_locations', ''),
    ip_addresses:       fromFiling('ip_addresses', ''),
    device_identifiers: fromFiling('device_identifiers', ''),

    subject:            fromFiling('subject', subjectFromCustomer),

    narrative:          fromFiling('narrative', f?.narrative_summary || ''),
    certification_signed: fromFiling('certification_signed', 0) ? true : false,

    prepared_by: f?.prepared_by || ''
  };
}

function serializeForm(form, includeDocIds) {
  return {
    filing_type: form.filing_type,
    filing_method: form.filing_method,
    regulatory_agency: form.regulatory_agency,
    sar_type: form.sar_type,
    detection_date: form.detection_date || null,
    bsa_filing_institution: form.bsa_filing_institution,
    tin: form.tin,
    num_transactions: form.num_transactions === '' ? null : Number(form.num_transactions),
    total_amount: form.total_amount === '' ? null : Number(form.total_amount),
    currency: form.currency,
    structuring_indicator: form.structuring_indicator ? 1 : 0,
    prior_sars: form.prior_sars ? 1 : 0,
    prior_sar_count: form.prior_sar_count === '' ? null : Number(form.prior_sar_count),
    date_of_recent_sar: form.date_of_recent_sar || null,
    activity_date_from: form.activity_date_from || null,
    activity_date_to: form.activity_date_to || null,
    amount_involved_inr: form.amount_involved_inr === '' ? 0 : Number(form.amount_involved_inr),
    suspicious_activity_types: form.suspicious_activity_types || [],
    transaction_types: form.transaction_types || [],
    transaction_locations: form.transaction_locations || '',
    ip_addresses: form.ip_addresses || '',
    device_identifiers: form.device_identifiers || '',
    subject_data: form.subject || {},
    narrative: form.narrative || '',
    narrative_summary: form.narrative || '',
    certification_signed: form.certification_signed ? 1 : 0,
    included_documents: includeDocIds || [],
    documents_count: (includeDocIds || []).length,
    draft_data: { ...form, included_documents: includeDocIds }
  };
}

function buildValidation(form, includeDocIds) {
  if (!form) return [];
  const v = [];
  v.push({ ok: !!(form.filing_type && form.filing_method && form.regulatory_agency && form.sar_type && form.detection_date),
           label: 'SAR details required fields completed' });
  const subj = form.subject || {};
  const subjOk = subj.type === 'Individual'
    ? !!(subj.first_name && subj.last_name && subj.address)
    : !!(subj.legal_name && subj.address);
  v.push({ ok: subjOk, label: 'Subject information completed' });
  v.push({ ok: (form.suspicious_activity_types || []).length > 0,
           label: 'Suspicious activity type selected' });
  v.push({ ok: (form.narrative || '').length >= 100,
           label: 'Narrative is at least 100 characters' });
  v.push({ ok: (includeDocIds || []).length > 0,
           label: 'At least one attachment included' });
  v.push({ ok: !!form.certification_signed,
           label: 'Certification signed' });
  return v;
}

function stepCompletion(form, validation) {
  if (!form) return [];
  const subj = form.subject || {};
  const subjOk = subj.type === 'Individual'
    ? !!(subj.first_name && subj.last_name && subj.address)
    : !!(subj.legal_name && subj.address);
  return [
    !!(form.filing_type && form.filing_method && form.regulatory_agency && form.sar_type && form.detection_date),
    subjOk,
    (form.suspicious_activity_types || []).length > 0 && (form.transaction_types || []).length > 0,
    (form.narrative || '').length >= 100,
    validation[4]?.ok,
    !!form.certification_signed
  ];
}

function validateStep(stepKey, form, validation, includeDocIds) {
  const errs = {};
  if (stepKey === 'details') {
    if (!form.filing_type) errs.filing_type = 'Required';
    if (!form.filing_method) errs.filing_method = 'Required';
    if (!form.regulatory_agency) errs.regulatory_agency = 'Required';
    if (!form.sar_type) errs.sar_type = 'Required';
    if (!form.detection_date) errs.detection_date = 'Required';
    if (!form.bsa_filing_institution) errs.bsa_filing_institution = 'Required';
    if (!form.tin) errs.tin = 'Required';
  }
  if (stepKey === 'subject') {
    const s = form.subject || {};
    if (s.type === 'Individual') {
      if (!s.first_name) errs['subject.first_name'] = 'Required';
      if (!s.last_name) errs['subject.last_name'] = 'Required';
      if (!s.address) errs['subject.address'] = 'Required';
    } else {
      if (!s.legal_name) errs['subject.legal_name'] = 'Required';
      if (!s.address) errs['subject.address'] = 'Required';
    }
  }
  if (stepKey === 'activity') {
    if ((form.suspicious_activity_types || []).length === 0) errs.suspicious_activity_types = 'Pick at least one';
    if ((form.transaction_types || []).length === 0) errs.transaction_types = 'Pick at least one';
  }
  if (stepKey === 'narrative') {
    if ((form.narrative || '').length < 100) errs.narrative = 'Narrative must be at least 100 characters';
  }
  if (stepKey === 'attachments') {
    if ((includeDocIds || []).length === 0) errs.attachments = 'At least one attachment required';
  }
  return errs;
}

/* --- Header --- */
function Header({ caseInfo, filing, isViewOnly, isLocked, savingState, onCancel, onSaveDraft, onSubmit, submittingFinal, analyst }) {
  const titleSuffix = filing?.sar_status === 'Returned for Revision'
    ? <span className="text-xs ml-2 text-orange-700 font-semibold">· Returned for Revision</span>
    : filing?.sar_status === 'Pending Approval'
    ? <span className="text-xs ml-2 text-blue-700 font-semibold">· Pending Approval</span>
    : filing?.sar_status === 'Filed'
    ? <span className="text-xs ml-2 text-green-700 font-semibold">· Filed</span>
    : null;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-bold text-navy-900 inline-flex items-center gap-2">
            Create SAR
            <Info size={14} className="text-slate-400" title="SAR filing wizard" />
            {titleSuffix}
          </div>
          <div className="text-sm text-slate-500">
            {filing?.sar_id ? `Draft ${filing.sar_id} · ` : ''}
            {isLocked ? <span className="text-slate-500"><Lock size={11} className="inline mr-1" />Read-only</span> :
              savingState.saving ? <span className="text-blue-600">Saving…</span> :
              savingState.lastSaved ? <span>Draft saved at {fmtTime(savingState.lastSaved)}</span> :
              <span>Auto-save every 30s</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="text-sm px-3 py-2 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
          {!isViewOnly && (
            <>
              <button onClick={onSaveDraft}
                className="text-sm px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1">
                <Save size={14} /> Save Draft
              </button>
              <button onClick={onSubmit}
                disabled={submittingFinal}
                className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-1">
                <Send size={14} /> {filing?.sar_status === 'Returned for Revision' ? 'Resubmit SAR' : 'Submit SAR'}
              </button>
            </>
          )}
        </div>
      </div>

      <Card bodyClassName="p-4 mt-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Meta label="Case ID" value={<span className="font-mono">{caseInfo.case_id}</span>} />
          <Meta label="Case Status" value={<Badge value={caseInfo.case_status} />} />
          <Meta label="Alert ID(s)" value={<span className="font-mono">{caseInfo.source_alert_id || '—'}</span>} />
          <Meta label="Customer" value={caseInfo.customer_name} />
          <Meta label="Investigator" value={analyst || '—'} />
          <Meta label="Organization" value={FINANCIAL_INSTITUTION.name} />
          <Meta label="Opened Date" value={caseInfo.created_date || '—'} />
          <Meta label="Case Type" value={caseInfo.scenario || '—'} />
        </div>
      </Card>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 text-navy-900 font-medium">{value}</div>
    </div>
  );
}

/* --- Stepper --- */
function Stepper({ steps, idx, completed, onSelect }) {
  return (
    <Card bodyClassName="p-3">
      <div className="flex items-center gap-2 overflow-x-auto">
        {steps.map((s, i) => {
          const active = i === idx;
          const isDone = completed[i];
          return (
            <button key={s.k} onClick={() => onSelect(i)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs whitespace-nowrap transition ${
                active ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                isDone ? 'text-green-700 hover:bg-slate-50' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                active ? 'bg-blue-600 text-white' :
                isDone ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-600'
              }`}>{isDone ? <Check size={12} /> : i + 1}</span>
              <span className="font-medium">{s.label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* --- Sidebar --- */
function Sidebar({ steps, idx, completed, validation }) {
  const completedCount = completed.filter(Boolean).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <aside className="w-[300px] shrink-0 space-y-3">
      <Card title="SAR Progress" bodyClassName="p-4">
        <div className="flex items-center gap-3">
          <Donut pct={pct} />
          <div>
            <div className="text-xl font-bold text-navy-900">{completedCount} of {steps.length}</div>
            <div className="text-xs text-slate-500">Completed</div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={s.k} className="flex items-center gap-2">
              {completed[i]
                ? <CheckCircle2 size={14} className="text-green-500" />
                : <Circle size={14} className={i === idx ? 'text-blue-500' : 'text-slate-300'} />}
              <span className={i === idx ? 'font-semibold text-navy-900' : (completed[i] ? 'text-slate-700' : 'text-slate-500')}>
                {i + 1}. {s.label}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="SAR Validation" bodyClassName="p-4">
        <ul className="space-y-1.5 text-sm">
          {validation.map((v, i) => (
            <li key={i} className="flex items-start gap-2">
              {v.ok
                ? <CheckCircle2 size={14} className="text-green-500 mt-0.5" />
                : <AlertTriangle size={14} className="text-slate-300 mt-0.5" />}
              <span className={v.ok ? 'text-slate-700' : 'text-slate-500'}>{v.label}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Help & Resources" bodyClassName="p-4">
        <ul className="space-y-2 text-sm">
          <li>
            <a href="https://www.fincen.gov/resources/filing-information" target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1">
              FinCEN SAR Filing Instructions <ExternalLink size={11} />
            </a>
          </li>
          <li>
            <a href="https://bsaefiling1.fincen.treas.gov/" target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1">
              BSA E-Filing System <ExternalLink size={11} />
            </a>
          </li>
          <li>
            <a href="https://www.fiuindia.gov.in/" target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1">
              Regulatory References <ExternalLink size={11} />
            </a>
          </li>
        </ul>
      </Card>
    </aside>
  );
}

function Donut({ pct }) {
  const radius = 26;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#2563eb" strokeWidth="6"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">{pct}%</text>
    </svg>
  );
}

/* --- Step 1: SAR Details --- */
function StepDetails({ form, setForm, errors, customer, caseInfo, jumpToSubject }) {
  return (
    <div className="space-y-5">
      <SectionTitle title="SAR Details" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Select label="Filing Type *" value={form.filing_type} onChange={v => setForm({ filing_type: v })}
          options={FILING_TYPES} error={errors.filing_type} />
        <Select label="Filing Method *" value={form.filing_method} onChange={v => setForm({ filing_method: v })}
          options={FILING_METHODS} error={errors.filing_method} />
        <Select label="Regulatory Agency *" value={form.regulatory_agency} onChange={v => setForm({ regulatory_agency: v })}
          options={REGULATORS} error={errors.regulatory_agency} />
        <Select label="SAR Type *" value={form.sar_type} onChange={v => setForm({ sar_type: v })}
          options={SAR_TYPES} error={errors.sar_type} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <DateInput label="Date of Initial Detection *" value={form.detection_date}
          onChange={v => setForm({ detection_date: v })} error={errors.detection_date} />
        <DateInput label="Date of This Report *" value={form.date_of_report}
          onChange={v => setForm({ date_of_report: v })} />
        <Text label="BSA Filing Institution *" value={form.bsa_filing_institution}
          onChange={v => setForm({ bsa_filing_institution: v })} error={errors.bsa_filing_institution} />
        <Text label="TIN *" value={form.tin} onChange={v => setForm({ tin: v })} error={errors.tin} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <NumberInput label="No. of Transactions in SAR" value={form.num_transactions}
          onChange={v => setForm({ num_transactions: v })} />
        <NumberInput label="Total Dollar Amount" value={form.total_amount}
          onChange={v => setForm({ total_amount: v })} />
        <Select label="Currency" value={form.currency} onChange={v => setForm({ currency: v })}
          options={CURRENCIES} />
        <Radio label="Structuring Indicator" value={form.structuring_indicator ? 'Yes' : 'No'}
          options={['Yes', 'No']} onChange={v => setForm({ structuring_indicator: v === 'Yes' })} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Radio label="Prior SAR(s) Filed on Subject" value={form.prior_sars ? 'Yes' : 'No'}
          options={['Yes', 'No']} onChange={v => setForm({ prior_sars: v === 'Yes' })} />
        {form.prior_sars && (
          <>
            <NumberInput label="If yes, how many?" value={form.prior_sar_count}
              onChange={v => setForm({ prior_sar_count: v })} />
            <DateInput label="Date of Most Recent SAR" value={form.date_of_recent_sar}
              onChange={v => setForm({ date_of_recent_sar: v })} />
          </>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <SectionTitle title="Subject Information Summary" />
        <div className="bg-slate-50 rounded-md p-4 text-sm grid grid-cols-1 md:grid-cols-5 gap-3">
          <Meta label="Type" value={form.subject?.type || '—'} />
          <Meta label="Name" value={customer?.customer_name || caseInfo?.customer_name} />
          <Meta label="TIN/EIN" value={form.tin || '—'} />
          <Meta label="DoB / Formation" value={form.subject?.dob || customer?.date_of_incorporation || '—'} />
          <div className="flex items-end justify-end">
            <button onClick={jumpToSubject}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-white">Edit Subject</button>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle title="Financial Institution Information" />
        <div className="bg-slate-50 rounded-md p-4 text-sm grid grid-cols-1 md:grid-cols-5 gap-3">
          <Meta label="Name" value={FINANCIAL_INSTITUTION.name} />
          <Meta label="Address" value={FINANCIAL_INSTITUTION.address} />
          <Meta label="FEIN" value={FINANCIAL_INSTITUTION.fein} />
          <Meta label="Contact Name" value={FINANCIAL_INSTITUTION.contact_name} />
          <Meta label="Contact Phone" value={FINANCIAL_INSTITUTION.contact_phone} />
        </div>
      </div>
    </div>
  );
}

/* --- Step 2: Subject --- */
function StepSubject({ form, setForm, errors }) {
  const subj = form.subject || {};
  const setSubj = (patch) => setForm({ subject: { ...subj, ...patch } });
  const isInd = subj.type === 'Individual';

  const addOwner = () => setSubj({ beneficial_owners: [...(subj.beneficial_owners || []), { name: '', pct: '', nationality: '' }] });
  const updateOwner = (i, patch) => {
    const next = [...(subj.beneficial_owners || [])];
    next[i] = { ...next[i], ...patch };
    setSubj({ beneficial_owners: next });
  };
  const removeOwner = (i) => {
    const next = (subj.beneficial_owners || []).filter((_, idx) => idx !== i);
    setSubj({ beneficial_owners: next });
  };

  return (
    <div className="space-y-5">
      <SectionTitle title="Subject Information" />

      <Radio label="Subject Type" value={subj.type || 'Individual'}
        options={['Individual', 'Entity']} onChange={v => setSubj({ type: v })} />

      {isInd ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Text label="First Name *" value={subj.first_name || ''}
              onChange={v => setSubj({ first_name: v })} error={errors['subject.first_name']} />
            <Text label="Last Name *" value={subj.last_name || ''}
              onChange={v => setSubj({ last_name: v })} error={errors['subject.last_name']} />
            <DateInput label="Date of Birth" value={subj.dob || ''}
              onChange={v => setSubj({ dob: v })} />
            <Text label="SSN/TIN" value={subj.ssn_tin || ''}
              onChange={v => setSubj({ ssn_tin: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Text label="Address *" value={subj.address || ''}
              onChange={v => setSubj({ address: v })} error={errors['subject.address']} />
            <Text label="City" value={subj.city || ''} onChange={v => setSubj({ city: v })} />
            <Text label="State" value={subj.state || ''} onChange={v => setSubj({ state: v })} />
            <Text label="ZIP" value={subj.zip || ''} onChange={v => setSubj({ zip: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Text label="Country" value={subj.country || ''} onChange={v => setSubj({ country: v })} />
            <Text label="ID Type" value={subj.id_type || ''} onChange={v => setSubj({ id_type: v })} />
            <Text label="ID Number" value={subj.id_number || ''} onChange={v => setSubj({ id_number: v })} />
            <Text label="Occupation" value={subj.occupation || ''} onChange={v => setSubj({ occupation: v })} />
          </div>
          <Select label="Relationship to Institution" value={subj.relationship || 'Customer'}
            options={['Customer', 'Employee', 'Other']} onChange={v => setSubj({ relationship: v })} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Text label="Legal Name *" value={subj.legal_name || ''}
              onChange={v => setSubj({ legal_name: v })} error={errors['subject.legal_name']} />
            <Text label="DBA Name" value={subj.dba_name || ''}
              onChange={v => setSubj({ dba_name: v })} />
            <Text label="EIN" value={subj.ein || ''} onChange={v => setSubj({ ein: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Text label="Address *" value={subj.address || ''}
              onChange={v => setSubj({ address: v })} error={errors['subject.address']} />
            <Text label="City" value={subj.city || ''} onChange={v => setSubj({ city: v })} />
            <Text label="State" value={subj.state || ''} onChange={v => setSubj({ state: v })} />
            <Text label="ZIP" value={subj.zip || ''} onChange={v => setSubj({ zip: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Text label="Country" value={subj.country || ''} onChange={v => setSubj({ country: v })} />
            <Text label="Business Type" value={subj.business_type || ''} onChange={v => setSubj({ business_type: v })} />
            <Text label="Industry" value={subj.industry || ''} onChange={v => setSubj({ industry: v })} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle title={`Beneficial Owners (${(subj.beneficial_owners || []).length})`} small />
              <button onClick={addOwner}
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">+ Add Owner</button>
            </div>
            <div className="space-y-2">
              {(subj.beneficial_owners || []).map((o, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <Text label="Name" value={o.name} onChange={v => updateOwner(i, { name: v })} />
                  <Text label="Ownership %" value={o.pct} onChange={v => updateOwner(i, { pct: v })} />
                  <Text label="Nationality" value={o.nationality} onChange={v => updateOwner(i, { nationality: v })} />
                  <button onClick={() => removeOwner(i)}
                    className="text-xs text-red-600 hover:bg-red-50 px-2 py-1.5 rounded inline-flex items-center gap-1">
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              ))}
              {(subj.beneficial_owners || []).length === 0 && (
                <div className="text-xs text-slate-400 italic">No owners listed</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* --- Step 3: Activity --- */
function StepActivity({ form, setForm, errors }) {
  const toggle = (key, val) => {
    const cur = form[key] || [];
    const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val];
    setForm({ [key]: next });
  };

  return (
    <div className="space-y-5">
      <SectionTitle title="Suspicious Activity Information" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DateInput label="Activity Date From" value={form.activity_date_from}
          onChange={v => setForm({ activity_date_from: v })} />
        <DateInput label="Activity Date To" value={form.activity_date_to}
          onChange={v => setForm({ activity_date_to: v })} />
        <NumberInput label="Total Amount Involved ($)" value={form.amount_involved_inr}
          onChange={v => setForm({ amount_involved_inr: v })} />
      </div>

      <Text label="Transaction Locations (comma-separated)" value={form.transaction_locations}
        onChange={v => setForm({ transaction_locations: v })} />

      <div>
        <div className="text-sm font-semibold text-navy-900 mb-2">
          Suspicious Activity Type <span className="text-red-500">*</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {ACTIVITY_TYPES.map(t => (
            <Check2 key={t} label={t} checked={(form.suspicious_activity_types || []).includes(t)}
              onChange={() => toggle('suspicious_activity_types', t)} />
          ))}
        </div>
        {(form.suspicious_activity_types || []).includes('Other') && (
          <div className="mt-2">
            <Text label="Other (specify)" value={form.suspicious_activity_other || ''}
              onChange={v => setForm({ suspicious_activity_other: v })} />
          </div>
        )}
        {errors.suspicious_activity_types && <FieldError msg={errors.suspicious_activity_types} />}
      </div>

      <div>
        <div className="text-sm font-semibold text-navy-900 mb-2">
          Transaction Types Involved <span className="text-red-500">*</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {TXN_TYPES.map(t => (
            <Check2 key={t} label={t} checked={(form.transaction_types || []).includes(t)}
              onChange={() => toggle('transaction_types', t)} />
          ))}
        </div>
        {errors.transaction_types && <FieldError msg={errors.transaction_types} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Text label="IP Address(es) involved" value={form.ip_addresses}
          onChange={v => setForm({ ip_addresses: v })} />
        <Text label="Device/Account Identifiers" value={form.device_identifiers}
          onChange={v => setForm({ device_identifiers: v })} />
      </div>
    </div>
  );
}

/* --- Step 4: Narrative --- */
function StepNarrative({ form, setForm, errors, notesText }) {
  const len = (form.narrative || '').length;

  const generate = () => {
    if (!notesText) {
      setForm({ narrative: form.narrative || 'No prior case notes available — write the narrative manually.' });
      return;
    }
    const seed = `Drafted from investigation case notes (review and edit before submission):\n\n${notesText}`;
    setForm({ narrative: seed });
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Narrative" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Narrative <span className="text-red-500">*</span>
              <span className="text-slate-400 font-normal ml-1">(min 100 characters)</span>
            </label>
            <button type="button" onClick={generate}
              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">
              <Sparkles size={12} /> Generate from Case Notes
            </button>
          </div>
          <textarea
            spellCheck="true"
            value={form.narrative || ''}
            onChange={e => setForm({ narrative: e.target.value })}
            rows={16}
            placeholder="Describe who is involved, what happened, when, where, why it is suspicious, and how the activity was conducted…"
            className={`w-full text-sm border rounded-md p-3 focus:outline-none ${
              errors.narrative ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-blue-500'
            }`}
          />
          <div className="flex items-center justify-between text-xs">
            <span className={len >= 100 ? 'text-green-600' : 'text-slate-500'}>{len} characters</span>
            {errors.narrative && <FieldError msg={errors.narrative} />}
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm space-y-1.5">
          <div className="font-semibold text-navy-900 mb-2">A complete SAR narrative includes:</div>
          {[
            'Who is involved',
            'What suspicious activity occurred',
            'When it occurred',
            'Where it occurred',
            'Why it is suspicious',
            'How the activity was conducted'
          ].map(t => (
            <div key={t} className="flex items-center gap-2">
              <Check size={14} className="text-blue-600" /> <span className="text-slate-700">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- Step 5: Attachments --- */
function StepAttachments({ caseInfo, docs, setDocs, includeDocIds, setIncludeDocIds, errors, analyst }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();
  const alertId = caseInfo?.source_alert_id;

  const reload = async () => {
    if (!alertId) return;
    const { data } = await api.get(`/case-documents/${alertId}`);
    setDocs(data);
  };

  const upload = async (file) => {
    if (!file || !alertId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alert_id', alertId);
    fd.append('document_type', 'SAR Evidence');
    fd.append('uploaded_by', analyst || 'Compliance Analyst');
    setUploading(true);
    try {
      const { data } = await api.post('/case-documents/upload', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setIncludeDocIds(ids => [...ids, data.id]);
      await reload();
    } finally { setUploading(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this attachment?')) return;
    await api.delete(`/case-documents/${id}`);
    setIncludeDocIds(ids => ids.filter(x => x !== id));
    await reload();
  };

  const toggle = (id) => {
    setIncludeDocIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Attachments" />

      {alertId ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 bg-slate-50'
          }`}
        >
          <Upload size={24} className="mx-auto text-slate-400 mb-2" />
          <div className="text-sm font-medium text-navy-900">
            {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
          </div>
          <div className="text-xs text-slate-500 mt-1">PDF, PNG, JPG, DOCX, XLSX up to 25 MB</div>
          <input ref={inputRef} type="file" className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
            onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="text-sm text-slate-500 italic border border-slate-200 rounded p-3 bg-slate-50">
          Direct uploads are linked to the source alert. This case has no source alert; attach documents via the SAR detail panel after submission.
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
          Documents ({docs.length}) — {includeDocIds.length} included in SAR
        </div>
        <div className="space-y-1.5">
          {docs.map(d => {
            const included = includeDocIds.includes(d.id);
            return (
              <div key={d.id} className={`flex items-center justify-between gap-3 p-2 rounded border text-sm ${included ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200'}`}>
                <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                  <input type="checkbox" checked={included} onChange={() => toggle(d.id)} />
                  <FileText size={14} className="text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.file_name}</div>
                    <div className="text-[11px] text-slate-500">
                      {d.document_type || 'Other'} · {Math.round(d.file_size / 1024)} KB · {d.uploaded_by} · {d.uploaded_at}
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-1">
                  <a href={`/api/case-documents/file/${d.id}`}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Download">
                    <FileText size={13} />
                  </a>
                  <button onClick={() => remove(d.id)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {docs.length === 0 && (
            <div className="text-xs text-slate-400 italic py-3 text-center border border-dashed border-slate-200 rounded">
              No documents yet — upload one above
            </div>
          )}
        </div>
        {errors.attachments && <FieldError msg={errors.attachments} />}
      </div>
    </div>
  );
}

/* --- Step 6: Review --- */
function StepReview({ form, setForm, errors, docs, includeDocIds, caseInfo, customer, onSubmit, submitting, isViewOnly }) {
  const [dual, setDual] = useState(false);
  const [open, setOpen] = useState({ details: true, subject: false, activity: false, narrative: false, attachments: false });

  useEffect(() => {
    api.get('/settings/manager').then(r => setDual(r.data['sar.dual_approval_required'] === true)).catch(() => {});
  }, []);

  const sub = form.subject || {};
  const incDocs = docs.filter(d => includeDocIds.includes(d.id));

  return (
    <div className="space-y-4">
      <SectionTitle title="Review & Submit" />

      <Collapsible title="SAR Details" open={open.details} onToggle={() => setOpen(o => ({ ...o, details: !o.details }))}>
        <ReviewGrid items={[
          ['Filing Type', form.filing_type],
          ['Filing Method', form.filing_method],
          ['Regulator', form.regulatory_agency],
          ['SAR Type', form.sar_type],
          ['Detection Date', form.detection_date],
          ['Report Date', form.date_of_report],
          ['BSA Institution', form.bsa_filing_institution],
          ['TIN', form.tin],
          ['# Transactions', form.num_transactions || '—'],
          ['Total Amount', `${form.currency} ${Number(form.total_amount || 0).toLocaleString()}`],
          ['Structuring', form.structuring_indicator ? 'Yes' : 'No'],
          ['Prior SARs', form.prior_sars ? `Yes (${form.prior_sar_count || '?'})` : 'No']
        ]} />
      </Collapsible>

      <Collapsible title="Subject Information" open={open.subject} onToggle={() => setOpen(o => ({ ...o, subject: !o.subject }))}>
        <ReviewGrid items={[
          ['Type', sub.type || '—'],
          ['Name', sub.type === 'Individual' ? `${sub.first_name || ''} ${sub.last_name || ''}`.trim() : (sub.legal_name || '—')],
          ['Address', sub.address || '—'],
          ['Country', sub.country || '—'],
          sub.type === 'Individual' ? ['DOB', sub.dob || '—'] : ['EIN', sub.ein || '—'],
          sub.type === 'Individual' ? ['Occupation', sub.occupation || '—'] : ['Industry', sub.industry || '—']
        ]} />
      </Collapsible>

      <Collapsible title="Suspicious Activity" open={open.activity} onToggle={() => setOpen(o => ({ ...o, activity: !o.activity }))}>
        <ReviewGrid items={[
          ['Activity From', form.activity_date_from || '—'],
          ['Activity To', form.activity_date_to || '—'],
          ['Amount Involved', usdFmt(form.amount_involved_inr)],
          ['Activity Types', (form.suspicious_activity_types || []).join(', ') || '—'],
          ['Transaction Types', (form.transaction_types || []).join(', ') || '—'],
          ['IPs', form.ip_addresses || '—']
        ]} />
      </Collapsible>

      <Collapsible title="Narrative" open={open.narrative} onToggle={() => setOpen(o => ({ ...o, narrative: !o.narrative }))}>
        <div className="bg-slate-50 rounded p-3 text-sm whitespace-pre-wrap text-slate-700">
          {form.narrative || <span className="italic text-slate-400">Empty</span>}
        </div>
      </Collapsible>

      <Collapsible title={`Attachments (${incDocs.length})`} open={open.attachments} onToggle={() => setOpen(o => ({ ...o, attachments: !o.attachments }))}>
        <ul className="space-y-1.5 text-sm">
          {incDocs.map(d => (
            <li key={d.id} className="flex items-center gap-2">
              <FileText size={14} className="text-slate-400" />
              <span className="font-medium">{d.file_name}</span>
              <span className="text-xs text-slate-500">({d.document_type})</span>
            </li>
          ))}
          {incDocs.length === 0 && <li className="text-slate-400 italic">No attachments included</li>}
        </ul>
      </Collapsible>

      {!isViewOnly && (
        <>
          <label className={`flex items-start gap-3 p-3 rounded-md border ${form.certification_signed ? 'border-green-300 bg-green-50/40' : 'border-slate-300'}`}>
            <input type="checkbox" checked={!!form.certification_signed}
              onChange={e => setForm({ certification_signed: e.target.checked })} className="mt-1" />
            <span className="text-sm text-slate-700">
              I certify that the information provided in this SAR is true and accurate to the best of my knowledge.
            </span>
          </label>
          {errors.certification_signed && <FieldError msg={errors.certification_signed} />}

          {dual && (
            <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800">
              <AlertTriangle size={14} className="inline mr-1" />
              This SAR requires supervisor approval before filing. Submitting will move it to the manager review queue.
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={onSubmit}
              disabled={submitting || !form.certification_signed}
              className="text-sm px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-1">
              <Send size={14} /> {submitting ? 'Submitting…' : (dual ? 'Submit for Approval' : 'Submit SAR')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SuccessScreen({ sar, onViewRepo, onBackToCases }) {
  const filed = sar.sar_status === 'Filed';
  return (
    <div className="max-w-xl mx-auto py-12">
      <Card bodyClassName="p-8 text-center">
        <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center ${filed ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
          <CheckCircle2 size={32} />
        </div>
        <div className="mt-4 text-2xl font-bold text-navy-900">
          {filed ? 'SAR Successfully Filed' : 'SAR submitted for supervisor approval'}
        </div>
        <div className="text-sm text-slate-500 mt-1">
          {filed
            ? 'The SAR has been recorded and is now retained per FIU-IND policy.'
            : 'You will be notified when reviewed. The form will reopen if revisions are requested.'}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
          <Meta label="SAR ID"     value={<span className="font-mono">{sar.sar_id}</span>} />
          <Meta label={filed ? 'Filed Date' : 'Submitted'} value={sar.filed_date || sar.submitted_at?.slice(0, 10) || '—'} />
          <Meta label={filed ? 'Filed By' : 'Submitted By'} value={sar.submitted_by || '—'} />
        </div>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={onViewRepo}
            className="text-sm px-3 py-2 rounded border border-slate-300 hover:bg-slate-50">View SAR in Repository</button>
          <button onClick={onBackToCases}
            className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Return to Cases</button>
        </div>
      </Card>
    </div>
  );
}

/* --- form atoms --- */
function SectionTitle({ title, small }) {
  return (
    <div className={`${small ? 'text-xs' : 'text-sm'} font-semibold text-navy-900 uppercase tracking-wider`}>
      {title}
    </div>
  );
}
function FieldError({ msg }) {
  return <div className="text-xs text-red-600 mt-1">{msg}</div>;
}
function Field({ label, error, children }) {
  return (
    <div>
      {label && <label className="text-xs font-semibold text-slate-700 block mb-1">{label}</label>}
      {children}
      {error && <FieldError msg={error} />}
    </div>
  );
}
function Text({ label, value, onChange, error, placeholder }) {
  return (
    <Field label={label} error={error}>
      <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full text-sm border rounded-md px-2 py-1.5 ${error ? 'border-red-400' : 'border-slate-200'} focus:border-blue-500 focus:outline-none`} />
    </Field>
  );
}
function NumberInput({ label, value, onChange, error }) {
  return (
    <Field label={label} error={error}>
      <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
        className={`w-full text-sm border rounded-md px-2 py-1.5 ${error ? 'border-red-400' : 'border-slate-200'} focus:border-blue-500 focus:outline-none`} />
    </Field>
  );
}
function DateInput({ label, value, onChange, error }) {
  return (
    <Field label={label} error={error}>
      <input type="date" value={value || ''} onChange={e => onChange(e.target.value)}
        className={`w-full text-sm border rounded-md px-2 py-1.5 ${error ? 'border-red-400' : 'border-slate-200'} focus:border-blue-500 focus:outline-none`} />
    </Field>
  );
}
function Select({ label, value, onChange, options, error }) {
  return (
    <Field label={label} error={error}>
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        className={`w-full text-sm border rounded-md px-2 py-1.5 bg-white ${error ? 'border-red-400' : 'border-slate-200'} focus:border-blue-500 focus:outline-none`}>
        <option value="">— select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}
function Radio({ label, value, options, onChange }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3 pt-1">
        {options.map(o => (
          <label key={o} className="text-sm inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={value === o} onChange={() => onChange(o)} /> {o}
          </label>
        ))}
      </div>
    </Field>
  );
}
function Check2({ label, checked, onChange }) {
  return (
    <label className={`flex items-center gap-2 px-2 py-1.5 rounded border text-sm cursor-pointer ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
function ReviewGrid({ items }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
      {items.map(([k, v], i) => (
        <div key={i}>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">{k}</div>
          <div className="text-navy-900 font-medium">{v ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}
function RevisionBanner({ filing }) {
  const [comments, setComments] = useState([]);
  useEffect(() => {
    api.get(`/sar-approvals/${filing.sar_id}/comments`).then(r => setComments(r.data)).catch(() => {});
  }, [filing.sar_id]);
  const date = filing.rejected_at?.slice(0, 16).replace('T', ' ') || '—';
  return (
    <div className="bg-yellow-50 border border-yellow-300 rounded p-4 space-y-2">
      <div className="flex items-start gap-2">
        <RotateCcw size={16} className="text-yellow-700 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-yellow-900">
            This SAR was returned for revision on {date}
          </div>
          <div className="text-sm text-yellow-800 mt-0.5">
            <span className="font-medium">{filing.rejection_reason_category || 'Returned'}</span>
            {filing.rejected_by ? <span className="text-yellow-700"> · {filing.rejected_by}</span> : null}
          </div>
        </div>
      </div>
      {filing.rejection_comments && (
        <div className="text-sm text-slate-800 whitespace-pre-wrap bg-white border border-yellow-200 rounded p-2">
          {filing.rejection_comments}
        </div>
      )}
      {comments.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-yellow-800 uppercase tracking-wider mb-1">
            Inline narrative comments ({comments.length})
          </div>
          <ul className="space-y-1.5">
            {comments.map(c => (
              <li key={c.id} className="text-xs bg-white border border-yellow-200 rounded p-2">
                {c.highlighted_text && (
                  <div className="italic text-slate-600 border-l-2 border-yellow-400 pl-2">"{c.highlighted_text}"</div>
                )}
                <div className="text-navy-900 mt-0.5">{c.comment_text}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-xs text-yellow-700 pt-1">
        Address the items above, then click <span className="font-semibold">Resubmit SAR</span> to send back for approval.
      </div>
    </div>
  );
}

function Collapsible({ title, open, onToggle, children }) {
  return (
    <div className="border border-slate-200 rounded-md">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50">
        {title} <span className="text-slate-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 py-3 border-t border-slate-100">{children}</div>}
    </div>
  );
}
