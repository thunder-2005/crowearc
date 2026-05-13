import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Loader2, ArrowLeft, Send, Save, Check, X, Upload, FileText, Eye, Trash2,
  AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert, PlayCircle
} from 'lucide-react';

const LEFT_TABS = [
  { k: 'profile',   label: 'Customer Profile' },
  { k: 'checklist', label: 'Review Checklist' },
  { k: 'documents', label: 'Documents' },
  { k: 'findings',  label: 'Findings' }
];
const RIGHT_TABS = [
  { k: 'summary',  label: 'KYC Summary' },
  { k: 'alerts',   label: 'Alert History' },
  { k: 'sars',     label: 'SAR History', l2Only: true },
  { k: 'history',  label: 'Review History' }
];

const CHECKLIST_GROUPS = [
  { title: 'Identity Verification', items: [
    { k: 'id.govId',   label: 'Government ID verified and not expired' },
    { k: 'id.address', label: 'Address confirmed and current' },
    { k: 'id.dob',     label: 'Date of birth confirmed' },
    { k: 'id.tin',     label: 'TIN/SSN verified' }
  ]},
  { title: 'Source of Funds / Wealth', items: [
    { k: 'sof.consistent',  label: 'Source of funds still consistent with activity' },
    { k: 'sof.income',      label: 'Income/revenue level matches transaction volumes' },
    { k: 'sof.unexplained', label: 'No unexplained wealth identified' }
  ]},
  { title: 'Sanctions & PEP Screening', items: [
    { k: 'screen.sanctions', label: 'Re-screened against sanctions lists' },
    { k: 'screen.pep',       label: 'PEP status re-confirmed' },
    { k: 'screen.media',     label: 'Adverse media check completed' }
  ]},
  { title: 'Transaction Behaviour', items: [
    { k: 'tx.patterns',  label: 'Transaction patterns match expected activity' },
    { k: 'tx.spikes',    label: 'No unusual spikes or pattern changes' },
    { k: 'tx.geography', label: 'Geographic activity consistent with profile' }
  ]},
  { title: 'Account Review', items: [
    { k: 'acc.active',  label: 'All accounts still active and appropriate' },
    { k: 'acc.dormant', label: 'No dormant accounts with unexpected activity' }
  ]}
];

const RECOMMENDATIONS = [
  { value: 'maintain',         label: 'Maintain Customer' },
  { value: 'monitor',           label: 'Monitor More Closely' },
  { value: 'upgrade_risk',      label: 'Upgrade Risk Rating' },
  { value: 'downgrade_risk',    label: 'Downgrade Risk Rating' },
  { value: 'exit_customer',     label: 'Exit Customer Relationship' },
  { value: 'escalate_sar',      label: 'Escalate to SAR', l2Only: true }
];

const RATINGS  = ['Low', 'Medium', 'High', 'Very High'];
const CDD      = ['Standard', 'Enhanced'];

const AUTOSAVE_MS = 30_000;

function usdFmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toTimeString().slice(0, 5);
}

export default function KYCReviewWorkspace() {
  const { reviewId } = useParams();
  const { isManager, isL1, currentAnalyst } = useRole();
  const visibleRightTabs = RIGHT_TABS.filter(t => !(isL1 && t.l2Only));
  const visibleRecommendations = RECOMMENDATIONS.filter(r => !(isL1 && r.l2Only));
  const { push } = useToast();
  const { goTo } = useRoleNavigate();

  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leftTab, setLeftTab] = useState('profile');
  const [rightTab, setRightTab] = useState('summary');
  const [checklist, setChecklist] = useState({});
  const [findings, setFindings] = useState('');
  const [newRating, setNewRating] = useState('');
  const [newCdd, setNewCdd] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [savingState, setSavingState] = useState({ saving: false, lastSaved: null });
  const [submitting, setSubmitting] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const formRef = useRef({ checklist, findings, newRating, newCdd, recommendation });
  formRef.current = { checklist, findings, newRating, newCdd, recommendation };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/kyc-reviews/${reviewId}`);
        if (cancelled) return;
        setReview(data);
        setChecklist(data.checklist || {});
        setFindings(data.review_findings || '');
        setNewRating(data.new_risk_rating || data.previous_risk_rating || data.customer_risk_rating || '');
        setNewCdd(data.new_cdd_level || data.previous_cdd_level || data.cdd_level || '');
        setRecommendation(data.recommendation || '');
      } catch (e) {
        push('Failed to load review: ' + (e.response?.data?.error || e.message), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reviewId]);

  const isLocked = review && (review.status === 'pending_approval' || review.status === 'completed');
  const isReturned = review?.status === 'returned';

  const startReview = async () => {
    try {
      const { data } = await api.patch(`/kyc-reviews/${review.id}/start`);
      setReview(prev => ({ ...prev, ...data }));
      push('Review started', 'success', 1500);
    } catch (e) {
      push('Failed to start review: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  const saveDraft = async (silent = false) => {
    if (!review || isLocked) return;
    if (review.status === 'pending') {
      try { await api.patch(`/kyc-reviews/${review.id}/start`); } catch (_e) {}
    }
    setSavingState(s => ({ ...s, saving: true }));
    try {
      const f = formRef.current;
      await api.patch(`/kyc-reviews/${review.id}/save`, {
        checklist: f.checklist, review_findings: f.findings,
        new_risk_rating: f.newRating, new_cdd_level: f.newCdd, recommendation: f.recommendation
      });
      setSavingState({ saving: false, lastSaved: new Date() });
      if (!silent) push('Draft saved', 'success', 1500);
    } catch (e) {
      setSavingState(s => ({ ...s, saving: false }));
      if (!silent) push('Save failed: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  useEffect(() => {
    if (!review || isLocked) return;
    const id = setInterval(() => saveDraft(true), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [review?.id, isLocked]);

  const allChecked = useMemo(() =>
    CHECKLIST_GROUPS.every(g => g.items.every(i => !!checklist[i.k]?.checked)),
    [checklist]
  );
  const checkedCount = useMemo(() =>
    CHECKLIST_GROUPS.reduce((sum, g) => sum + g.items.filter(i => checklist[i.k]?.checked).length, 0),
    [checklist]
  );
  const totalItems = CHECKLIST_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
  const documents = review?.documents || [];

  const submitReview = async () => {
    if (!review) return;
    if (!allChecked) return push('Tick every checklist item before submitting', 'warning');
    if (findings.length < 100) return push('Findings narrative must be at least 100 characters', 'warning');
    if (!recommendation) return push('Pick a recommendation', 'warning');
    if (documents.length === 0) return push('Upload at least one supporting document', 'warning');

    setSubmitting(true);
    try {
      const checklistPayload = Object.fromEntries(
        Object.entries(checklist).map(([k, v]) => [k, !!v.checked])
      );
      const { data } = await api.patch(`/kyc-reviews/${review.id}/complete`, {
        checklist: checklistPayload,
        review_findings: findings,
        recommendation,
        new_risk_rating: newRating,
        new_cdd_level: newCdd,
        completed_by: currentAnalyst || 'Compliance Analyst'
      });
      setReview(prev => ({ ...prev, ...data, documents }));
      push('Review submitted for manager approval', 'success');
    } catch (e) {
      push('Submit failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  const approve = async () => {
    setSubmitting(true);
    try {
      await api.patch(`/kyc-reviews/${review.id}/approve`, { approved_by: 'Compliance Manager' });
      push(`Review approved — ${review.customer?.customer_name || review.customer_name}`, 'success');
      goTo('kyc-reviews');
    } catch (e) {
      push('Approval failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  const reject = async ({ reason, comments }) => {
    setSubmitting(true);
    try {
      await api.patch(`/kyc-reviews/${review.id}/reject`, {
        reason, comments, rejected_by: 'Compliance Manager'
      });
      push(`Review returned to analyst`, 'warning');
      goTo('kyc-reviews');
    } catch (e) {
      push('Reject failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  if (loading || !review) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading review…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Header
        review={review}
        savingState={savingState}
        isLocked={isLocked}
        isManager={isManager}
        onBack={() => goTo(isManager ? 'kyc-reviews' : 'kyc-reviews/mine')}
        onStart={startReview}
        onSave={() => saveDraft(false)}
        onSubmit={submitReview}
        submitting={submitting}
        onApprove={() => setShowApprove(true)}
        onReject={() => setShowReject(true)}
      />

      {isReturned && <RevisionBanner review={review} />}

      <div className="flex gap-4 min-w-0">
        <section className="flex-[0.65] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="flex border-b border-slate-200 bg-slate-50/60">
            {LEFT_TABS.map(t => {
              const active = leftTab === t.k;
              return (
                <button key={t.k} onClick={() => setLeftTab(t.k)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 ${
                    active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
                  }`}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {leftTab === 'profile'   && <CustomerProfileTab review={review} />}
            {leftTab === 'checklist' && (
              <ChecklistTab
                checklist={checklist} setChecklist={setChecklist}
                isLocked={isLocked}
                analyst={currentAnalyst}
                checkedCount={checkedCount} total={totalItems}
              />
            )}
            {leftTab === 'documents' && (
              <DocumentsTab review={review} documents={documents}
                isLocked={isLocked}
                analyst={currentAnalyst}
                onChanged={async () => {
                  const { data } = await api.get(`/kyc-reviews/${review.id}`);
                  setReview(data);
                }} />
            )}
            {leftTab === 'findings'  && (
              <FindingsTab
                findings={findings} setFindings={setFindings}
                newRating={newRating} setNewRating={setNewRating}
                newCdd={newCdd} setNewCdd={setNewCdd}
                recommendation={recommendation} setRecommendation={setRecommendation}
                review={review}
                isLocked={isLocked}
                recommendations={visibleRecommendations}
              />
            )}
          </div>
        </section>

        <section className="flex-[0.35] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="flex border-b border-slate-200 bg-slate-50/60">
            {visibleRightTabs.map(t => {
              const active = rightTab === t.k;
              return (
                <button key={t.k} onClick={() => setRightTab(t.k)}
                  className={`flex-1 px-2 py-2.5 text-xs font-medium border-b-2 ${
                    active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
                  }`}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm">
            {rightTab === 'summary' && <SummaryRight review={review} isL1={isL1} />}
            {rightTab === 'alerts'  && <AlertsRight review={review} />}
            {rightTab === 'sars' && !isL1 && <SarsRight review={review} />}
            {rightTab === 'history' && <HistoryRight review={review} />}
          </div>
        </section>
      </div>

      {showApprove && (
        <ApproveModal review={review} submitting={submitting}
          onCancel={() => setShowApprove(false)} onConfirm={() => { setShowApprove(false); approve(); }} />
      )}
      {showReject && (
        <RejectModal review={review} submitting={submitting}
          onCancel={() => setShowReject(false)}
          onConfirm={(payload) => { setShowReject(false); reject(payload); }} />
      )}
    </div>
  );
}

function Header({ review, savingState, isLocked, isManager, onBack, onStart, onSave, onSubmit, submitting, onApprove, onReject }) {
  const status = review.status;
  return (
    <div>
      <button onClick={onBack}
        className="text-xs text-slate-500 hover:text-navy-900 inline-flex items-center gap-1 mb-2">
        <ArrowLeft size={12} /> Back
      </button>
      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-1 min-w-[420px] text-sm">
            <Meta label="Customer"  value={review.customer?.customer_name || review.customer_name} />
            <Meta label="Customer ID" value={<span className="font-mono">{review.customer_id}</span>} />
            <Meta label="Risk"      value={<Badge value={review.customer?.customer_risk_rating || review.previous_risk_rating} />} />
            <Meta label="Due"       value={review.due_date} />
            <Meta label="Assigned"  value={review.assigned_to || '—'} />
          </div>
          <Badge value={statusLabel(status)} />
          <div className="flex gap-2 ml-auto">
            {!isManager && status === 'assigned' && (
              <button onClick={onStart}
                className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
                <PlayCircle size={14} /> Start Review
              </button>
            )}
            {!isManager && !isLocked && (
              <>
                <button onClick={onSave}
                  className="text-sm px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1">
                  <Save size={14} /> Save Draft
                </button>
                <button onClick={onSubmit} disabled={submitting}
                  className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-1">
                  <Send size={14} /> {status === 'returned' ? 'Resubmit Review' : 'Submit Review'}
                </button>
              </>
            )}
            {isManager && status === 'pending_approval' && (
              <>
                <button onClick={onReject}
                  className="text-sm px-3 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 inline-flex items-center gap-1">
                  <X size={14} /> Reject
                </button>
                <button onClick={onApprove}
                  className="text-sm px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white inline-flex items-center gap-1">
                  <Check size={14} /> Approve
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {savingState.saving ? 'Saving…' :
            savingState.lastSaved ? `Draft saved at ${fmtTime(savingState.lastSaved)}` :
            'Auto-save every 30s'}
        </div>
      </Card>
    </div>
  );
}

function RevisionBanner({ review }) {
  return (
    <div className="bg-yellow-50 border border-yellow-300 rounded p-4 space-y-2">
      <div className="flex items-start gap-2">
        <RotateCcw size={16} className="text-yellow-700 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-yellow-900">
            Returned for revision on {review.rejected_at?.slice(0, 16).replace('T', ' ') || '—'}
          </div>
          <div className="text-sm text-yellow-800">
            <span className="font-medium">{review.rejection_reason || 'Returned'}</span>
            {review.rejected_by ? ` · ${review.rejected_by}` : ''}
          </div>
        </div>
      </div>
      {review.rejection_comments && (
        <div className="text-sm text-slate-800 whitespace-pre-wrap bg-white border border-yellow-200 rounded p-2">
          {review.rejection_comments}
        </div>
      )}
    </div>
  );
}

function statusLabel(s) {
  return ({
    pending: 'Pending', overdue: 'Overdue', assigned: 'Assigned',
    in_progress: 'In Progress', pending_approval: 'Pending Approval',
    returned: 'Returned for Revision', completed: 'Completed', rejected: 'Rejected'
  })[s] || s;
}

function CustomerProfileTab({ review }) {
  const c = review.customer || {};
  const accounts = c.accounts || [];
  return (
    <div className="p-5 space-y-4 text-sm">
      <Section title="Identity">
        <Row k="Legal Name" v={c.customer_name} />
        <Row k="Type" v={c.customer_type} />
        <Row k="Segment" v={c.segment} />
        <Row k="Risk Rating" v={<Badge value={c.customer_risk_rating} />} />
        <Row k="CDD Level" v={c.cdd_level} />
        <Row k="Government ID" v={`${c.government_id_type || ''} · ${c.government_id_number || ''}`} />
        <Row k="DOB / Formation" v={c.date_of_birth || c.date_of_incorporation || '—'} />
        <Row k="Customer Since" v={c.customer_since_date} />
      </Section>
      <Section title="Contact / Address">
        <Row k="Address" v={c.residential_address || c.mailing_address} />
        <Row k="Country" v={c.country_of_residence || c.country_of_incorporation} />
        <Row k="Phone" v={c.phone_number} />
        <Row k="Email" v={c.email_address} />
      </Section>
      <Section title="Business / Employment">
        <Row k="Business Type" v={c.business_type} />
        <Row k="Industry" v={c.industry} />
        <Row k="Annual Turnover" v={c.annual_turnover_range} />
        <Row k="Employer" v={c.employer_name} />
        <Row k="Job Title" v={c.job_title} />
        <Row k="Source of Funds" v={c.source_of_funds} />
        <Row k="Source of Wealth" v={c.source_of_wealth} />
      </Section>
      <Section title={`Accounts (${accounts.length})`}>
        {accounts.map(a => (
          <div key={a.account_number} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div className="font-mono">{a.account_number}</div>
            <div className="text-slate-500">{a.account_type} · {a.currency}</div>
            <Badge value={a.status} />
            <div className="text-slate-500">{a.opened_date}</div>
          </div>
        ))}
        {accounts.length === 0 && <div className="text-xs text-slate-400">No accounts</div>}
      </Section>
      <Section title="Last Review">
        <Row k="Last Review Date" v={c.last_kyc_review_date} />
        <Row k="Next Review Due" v={c.next_kyc_due_date} />
        <Row k="KYC Status" v={c.kyc_review_status} />
      </Section>
    </div>
  );
}

function ChecklistTab({ checklist, setChecklist, isLocked, analyst, checkedCount, total }) {
  const toggle = (k) => {
    const cur = checklist[k] || {};
    if (cur.checked) {
      const next = { ...checklist }; delete next[k]; setChecklist(next);
    } else {
      setChecklist({ ...checklist, [k]: {
        checked: true,
        ts: new Date().toISOString().slice(0, 19).replace('T', ' '),
        analyst: analyst || 'Compliance Analyst'
      }});
    }
  };
  return (
    <div className="p-5 space-y-5 text-sm">
      <div className="flex items-center justify-between">
        <SectionTitle title="Standard KYC Checklist" />
        <div className="text-xs text-slate-500">{checkedCount}/{total} complete</div>
      </div>
      {CHECKLIST_GROUPS.map(g => (
        <div key={g.title}>
          <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">{g.title}</div>
          <ul className="space-y-1">
            {g.items.map(it => {
              const c = checklist[it.k];
              const checked = !!c?.checked;
              return (
                <li key={it.k} className={`flex items-start gap-2 px-2 py-1.5 rounded border ${checked ? 'border-green-200 bg-green-50/40' : 'border-slate-200'}`}>
                  <input type="checkbox" checked={checked} disabled={isLocked} onChange={() => toggle(it.k)} className="mt-1" />
                  <div className="flex-1">
                    <div className={`text-sm ${checked ? 'text-slate-700' : 'text-slate-800'}`}>{it.label}</div>
                    {checked && (
                      <div className="text-[11px] text-green-700">
                        <Check size={11} className="inline mr-1" />
                        {c.analyst} · {c.ts}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!isLocked && checkedCount < total && (
        <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
          <AlertTriangle size={12} className="inline mr-1" />
          {total - checkedCount} item{total - checkedCount === 1 ? '' : 's'} remaining before submission.
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ review, documents, isLocked, analyst, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('uploaded_by', analyst || 'Compliance Analyst');
    fd.append('document_type', 'KYC Evidence');
    setUploading(true);
    try {
      await api.post(`/kyc-reviews/${review.id}/documents`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      await onChanged();
    } finally { setUploading(false); }
  };
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };
  const remove = async (id) => {
    if (!confirm('Delete this document?')) return;
    await api.delete(`/kyc-reviews/${review.id}/documents/${id}`);
    await onChanged();
  };

  return (
    <div className="p-5 space-y-4 text-sm">
      {!isLocked && (
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
          <div className="text-sm font-medium text-navy-900">{uploading ? 'Uploading…' : 'Drop files here or click to upload'}</div>
          <div className="text-xs text-slate-500 mt-1">ID copies, statements, screening evidence, etc. (PDF, image, docx)</div>
          <input ref={inputRef} type="file" className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
            onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
        </div>
      )}

      <div>
        <SectionTitle title={`Supporting Documents (${documents.length})`} />
        <div className="space-y-1.5 mt-2">
          {documents.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 p-2 rounded border border-slate-200">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.document_name}</div>
                  <div className="text-[11px] text-slate-500">{d.document_type} · {Math.round(d.file_size / 1024)} KB · {d.uploaded_by} · {d.uploaded_at}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <a href={`/api/kyc-reviews/${review.id}/documents/${d.id}/file?preview=1`} target="_blank" rel="noreferrer"
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Preview"><Eye size={13} /></a>
                <a href={`/api/kyc-reviews/${review.id}/documents/${d.id}/file`}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Download"><FileText size={13} /></a>
                {!isLocked && (
                  <button onClick={() => remove(d.id)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={13} /></button>
                )}
              </div>
            </div>
          ))}
          {documents.length === 0 && (
            <div className="text-xs text-slate-400 italic py-3 text-center border border-dashed border-slate-200 rounded">No documents uploaded yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FindingsTab({ findings, setFindings, newRating, setNewRating, newCdd, setNewCdd, recommendation, setRecommendation, review, isLocked, recommendations }) {
  const c = review.customer || {};
  const wordCount = findings.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="p-5 space-y-5 text-sm">
      <SectionTitle title="Findings" />

      <div>
        <label className="text-xs font-semibold text-slate-700">
          Review narrative <span className="text-red-500">*</span>
          <span className="text-slate-400 font-normal ml-1">(min 100 characters)</span>
        </label>
        <textarea value={findings} onChange={e => setFindings(e.target.value)} rows={8}
          disabled={isLocked}
          placeholder="Document what you reviewed, what you confirmed, and any concerns identified."
          className={`mt-1 w-full text-sm border rounded p-2 focus:outline-none ${
            findings.length < 100 ? 'border-orange-200' : 'border-slate-200'} focus:border-blue-500`} />
        <div className="text-[11px] text-slate-500 mt-1">{findings.length} chars · {wordCount} words</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-slate-700">Risk Rating</label>
          <div className="text-[11px] text-slate-500 min-h-[18px]">Current: <Badge value={c.customer_risk_rating || review.previous_risk_rating} /></div>
          <select value={newRating} onChange={e => setNewRating(e.target.value)}
            disabled={isLocked}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select —</option>
            {RATINGS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-slate-700">CDD Level</label>
          <div className="text-[11px] text-slate-500 min-h-[18px]">Current: {c.cdd_level || review.previous_cdd_level || '—'}</div>
          <select value={newCdd} onChange={e => setNewCdd(e.target.value)}
            disabled={isLocked}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select —</option>
            {CDD.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-slate-700">Recommendation <span className="text-red-500">*</span></label>
          <div className="text-[11px] text-slate-500 min-h-[18px]">Current: —</div>
          <select value={recommendation} onChange={e => setRecommendation(e.target.value)}
            disabled={isLocked}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select —</option>
            {(recommendations || RECOMMENDATIONS).map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {recommendation === 'escalate_sar' && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 inline-flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5" />
          <div>A SAR case will be created automatically and assigned to you on approval.</div>
        </div>
      )}
      {recommendation === 'exit_customer' && (
        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 inline-flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5" />
          <div>The customer record will be flagged "Pending Exit" on approval.</div>
        </div>
      )}
    </div>
  );
}

/* --- Right panel --- */
function SummaryRight({ review, isL1 }) {
  const c = review.customer || {};
  return (
    <div className="space-y-3">
      <Row k="Risk Rating"     v={<Badge value={c.customer_risk_rating || review.previous_risk_rating} />} />
      <Row k="CDD Level"       v={c.cdd_level || review.previous_cdd_level} />
      <Row k="Last Review"     v={c.last_kyc_review_date} />
      <Row k="Next Due"        v={c.next_kyc_due_date} />
      <Row k="KYC Status"      v={c.kyc_review_status} />
      <Row k="PEP"             v={c.pep_match ? 'Yes' : 'No'} />
      <Row k="Sanctions"       v={c.sanctions_match ? <span className="text-red-600 font-semibold">Hit</span> : 'Clear'} />
      <Row k="Open Alerts"     v={(review.alerts || []).filter(a => a.alert_status !== 'Completed').length} />
      {!isL1 && <Row k="Total SARs"      v={(review.sars || []).length} />}
    </div>
  );
}

function AlertsRight({ review }) {
  const alerts = review.alerts || [];
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{alerts.length} alerts</div>
      <ul className="space-y-1.5">
        {alerts.map(a => (
          <li key={a.alert_id} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div className="min-w-0">
              <div className="font-mono">{a.alert_id}</div>
              <div className="text-slate-500 truncate">{a.scenario} · {a.created_date}</div>
            </div>
            <Badge value={a.alert_status} />
          </li>
        ))}
        {alerts.length === 0 && <li className="text-xs text-slate-400">None</li>}
      </ul>
    </div>
  );
}

function SarsRight({ review }) {
  const sars = review.sars || [];
  const willBeNumber = sars.length + 1;
  return (
    <div>
      {sars.length > 0 && (
        <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2 mb-2">
          <AlertTriangle size={12} className="inline mr-1" />
          This will be SAR #{willBeNumber} for this customer.
        </div>
      )}
      <ul className="space-y-1.5">
        {sars.map(s => (
          <li key={s.sar_id} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
            <div className="min-w-0">
              <div className="font-mono">{s.sar_id}</div>
              <div className="text-slate-500 truncate">{s.alert_scenario} · {s.filed_date || s.draft_created_date || '—'}</div>
              <div className="text-slate-500 truncate">{usdFmt(s.amount_involved_inr)} · {s.prepared_by}</div>
            </div>
            <Badge value={s.sar_status} />
          </li>
        ))}
        {sars.length === 0 && <li className="text-xs text-slate-400">No SARs</li>}
      </ul>
    </div>
  );
}

function HistoryRight({ review }) {
  const prev = review.previous_reviews || [];
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{prev.length} previous reviews</div>
      <ul className="space-y-1.5">
        {prev.map(r => (
          <li key={r.id} className="border border-slate-100 rounded p-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{r.completed_at?.slice(0, 10) || r.due_date}</span>
              <Badge value={statusLabel(r.status)} />
            </div>
            <div className="text-xs text-slate-700 mt-1">
              {r.previous_risk_rating} → {r.new_risk_rating || r.previous_risk_rating}
              {r.recommendation ? ` · ${r.recommendation}` : ''}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{r.assigned_to || '—'}{r.approved_by ? ` · ${r.approved_by}` : ''}</div>
          </li>
        ))}
        {prev.length === 0 && <li className="text-xs text-slate-400">No prior reviews</li>}
      </ul>
    </div>
  );
}

function ApproveModal({ review, submitting, onCancel, onConfirm }) {
  const c = review.customer || {};
  const ratingChanged = review.new_risk_rating && review.new_risk_rating !== review.previous_risk_rating;
  return (
    <ModalShell title={`Approve KYC review — ${c.customer_name || review.customer_name}`} tone="green" icon={Check} onCancel={onCancel}>
      <div className="p-5 text-sm space-y-2">
        <div>This will apply the analyst's recommendation to the customer record:</div>
        <ul className="list-disc pl-5 text-slate-700 space-y-0.5">
          <li>Risk rating: <span className="font-medium">{review.previous_risk_rating} → {review.new_risk_rating || review.previous_risk_rating}</span> {ratingChanged ? <span className="text-orange-600">(changed)</span> : ''}</li>
          <li>CDD level: <span className="font-medium">{review.previous_cdd_level} → {review.new_cdd_level || review.previous_cdd_level}</span></li>
          <li>Recommendation: <span className="font-medium">{review.recommendation || '—'}</span></li>
        </ul>
        <div className="text-xs text-slate-500 mt-2">Next review date will recalculate automatically based on the new risk rating.</div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={onConfirm} disabled={submitting}
          className="text-sm px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white">
          {submitting ? 'Approving…' : 'Confirm Approve'}
        </button>
      </div>
    </ModalShell>
  );
}

function RejectModal({ review, submitting, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const REASONS = ['Findings unclear', 'Documents missing', 'Recommendation incorrect', 'Re-screen required', 'Other'];
  const ready = !!reason && text.length >= 30;
  return (
    <ModalShell title={`Reject KYC review — ${review.customer?.customer_name || review.customer_name}`} tone="red" icon={X} onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-700">Reason <span className="text-red-500">*</span></label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select —</option>
            {REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Comments (min 30 chars) <span className="text-red-500">*</span></label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:border-blue-500 focus:outline-none" />
          <div className="text-[11px] text-slate-500">{text.length} chars</div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={() => onConfirm({ reason, comments: text })} disabled={!ready || submitting}
          className="text-sm px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white">
          {submitting ? 'Rejecting…' : 'Confirm Rejection'}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ icon: Icon, title, tone = 'blue', children, onCancel }) {
  const toneCls = ({
    blue:'bg-blue-100 text-blue-600', red:'bg-red-100 text-red-600',
    green:'bg-green-100 text-green-600', orange:'bg-orange-100 text-orange-600'
  })[tone] || 'bg-blue-100 text-blue-600';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${toneCls}`}>
            <Icon size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-navy-900">{title}</div>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --- atoms --- */
function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function SectionTitle({ title }) {
  return <div className="text-sm font-semibold text-navy-900 uppercase tracking-wider">{title}</div>;
}
function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 text-navy-900 font-medium">{value ?? '—'}</div>
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}
