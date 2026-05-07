import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Loader2, Check, X, AlertTriangle, MessageSquarePlus,
  Download, FileText, Printer, ArrowLeft, Eye, ShieldAlert
} from 'lucide-react';

const TABS = [
  { k: 'details',     label: 'SAR Details' },
  { k: 'subject',     label: 'Subject Info' },
  { k: 'activity',    label: 'Suspicious Activity' },
  { k: 'narrative',   label: 'Narrative' },
  { k: 'attachments', label: 'Attachments' },
  { k: 'summary',     label: 'Summary' }
];

const REJECTION_REASONS = [
  'Incomplete Narrative', 'Missing Attachments', 'Incorrect Subject Info',
  'Insufficient Evidence', 'Duplicate SAR', 'Incorrect Filing Details', 'Other'
];

const CHECKLIST_ITEMS = [
  { k: 'subject',    label: 'Subject information is accurate and complete' },
  { k: 'activity',   label: 'Suspicious activity is clearly described' },
  { k: 'amounts',    label: 'Date range and amounts are correct' },
  { k: 'narrative',  label: 'Narrative meets minimum requirements (5W + H)' },
  { k: 'docs',       label: 'At least one supporting document attached' },
  { k: 'noDup',      label: 'No duplicate SAR exists for this subject/period' },
  { k: 'deadline',   label: 'Filing deadline is within regulatory timeframe' }
];

function usdFmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function SARApprovalReview() {
  const { sarId } = useParams();
  const { isManager } = useRole();
  const { push } = useToast();
  const { goTo } = useRoleNavigate();

  const [tab, setTab] = useState('details');
  const [sar, setSar] = useState(null);
  const [comments, setComments] = useState([]);
  const [checklist, setChecklist] = useState({});
  const [approveNote, setApproveNote] = useState('');
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/sar-approvals/${sarId}`);
        if (cancelled) return;
        setSar(data);
        setComments(data.review_comments || []);
        if (data.sar_status === 'Pending Approval') {
          api.post(`/sar-approvals/${sarId}/start-review`).catch(() => {});
        }
      } catch (e) {
        push('Failed to load SAR: ' + (e.response?.data?.error || e.message), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sarId]);

  const allChecked = CHECKLIST_ITEMS.every(c => !!checklist[c.k]);

  const onApprove = async () => {
    setSubmitting(true);
    try {
      await api.post(`/sar-approvals/${sarId}/approve`, {
        approved_by: 'Compliance Manager',
        notes: approveNote,
        checklist
      });
      push(`SAR ${sarId} approved and filed successfully`, 'success');
      goTo('sar-approvals');
    } catch (e) {
      push('Approval failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  const onReject = async ({ reason, comments: txt }) => {
    setSubmitting(true);
    try {
      await api.post(`/sar-approvals/${sarId}/reject`, {
        rejected_by: 'Compliance Manager',
        reason_category: reason,
        comments: txt,
        checklist
      });
      push(`SAR ${sarId} returned for revision`, 'warning');
      goTo('sar-approvals');
    } catch (e) {
      push('Reject failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setSubmitting(false); }
  };

  if (!isManager) {
    return (
      <div className="text-center py-20 text-slate-500">
        <AlertTriangle size={32} className="mx-auto text-orange-400 mb-3" />
        SAR Review is a manager-only view.
      </div>
    );
  }

  if (loading || !sar) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading SAR review…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReviewHeader sar={sar}
        onBack={() => goTo('sar-approvals')}
        onApprove={() => setShowApprove(true)}
        onReject={() => setShowReject(true)}
        canApprove={allChecked && sar.sar_status !== 'Filed'} />

      <div className="flex gap-4 min-w-0">
        <div className="flex-[0.65] min-w-0">
          <Card bodyClassName="p-0">
            <div className="flex border-b border-slate-200 bg-slate-50/60 overflow-x-auto">
              {TABS.map(t => {
                const active = tab === t.k;
                return (
                  <button key={t.k} onClick={() => setTab(t.k)}
                    className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 ${
                      active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
                    }`}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="p-5">
              {tab === 'details'     && <DetailsView sar={sar} />}
              {tab === 'subject'     && <SubjectView sar={sar} />}
              {tab === 'activity'    && <ActivityView sar={sar} />}
              {tab === 'narrative'   && (
                <NarrativeView
                  sar={sar} comments={comments} setComments={setComments}
                  reload={async () => {
                    const { data } = await api.get(`/sar-approvals/${sarId}/comments`);
                    setComments(data);
                  }}
                />
              )}
              {tab === 'attachments' && <AttachmentsView sar={sar} />}
              {tab === 'summary'     && <SummaryView sar={sar} comments={comments} />}
            </div>
          </Card>
        </div>

        <aside className="flex-[0.35] min-w-0 space-y-3">
          <CaseContextCard sar={sar} />
          <AnalystActivityCard sar={sar} />
          <ReviewChecklistCard checklist={checklist} setChecklist={setChecklist} />
          <DecisionCard
            allChecked={allChecked}
            isFiled={sar.sar_status === 'Filed'}
            onApprove={() => setShowApprove(true)}
            onReject={() => setShowReject(true)}
            comments={comments}
          />
        </aside>
      </div>

      {showApprove && (
        <ApproveModal
          sar={sar}
          note={approveNote} setNote={setApproveNote}
          submitting={submitting}
          onCancel={() => setShowApprove(false)}
          onConfirm={onApprove}
        />
      )}
      {showReject && (
        <RejectModal
          sar={sar}
          inlineComments={comments}
          submitting={submitting}
          onCancel={() => setShowReject(false)}
          onConfirm={onReject}
        />
      )}
    </div>
  );
}

/* --- Header --- */
function ReviewHeader({ sar, onBack, onApprove, onReject, canApprove }) {
  return (
    <div>
      <button onClick={onBack}
        className="text-xs text-slate-500 hover:text-navy-900 inline-flex items-center gap-1 mb-2">
        <ArrowLeft size={12} /> Back to Queue
      </button>
      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-1 min-w-[420px] text-sm">
            <Meta label="SAR ID"      value={<span className="font-mono">{sar.sar_id}</span>} />
            <Meta label="Case ID"     value={<span className="font-mono">{sar.case_id || '—'}</span>} />
            <Meta label="Customer"    value={sar.customer_name} />
            <Meta label="Filed By"    value={sar.prepared_by || '—'} />
            <Meta label="Submitted"   value={sar.submitted_at ? sar.submitted_at.slice(0, 16).replace('T', ' ') : '—'} />
          </div>
          <Badge value={sar.sar_status} />
          <div className="flex gap-2 ml-auto">
            <button onClick={onReject}
              disabled={sar.sar_status === 'Filed'}
              className="text-sm px-3 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1">
              <X size={14} /> Reject &amp; Return
            </button>
            <button onClick={onApprove}
              disabled={!canApprove}
              title={!canApprove ? 'Complete the review checklist to enable approval' : ''}
              className="text-sm px-3 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center gap-1">
              <Check size={14} /> Approve &amp; File
            </button>
          </div>
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

/* --- Tab views --- */
function DetailsView({ sar }) {
  return (
    <div className="space-y-4 text-sm">
      <SectionTitle title="Filing" />
      <Grid items={[
        ['Filing Type', sar.filing_type],
        ['Filing Method', sar.filing_method],
        ['Regulator', sar.regulatory_agency],
        ['SAR Type', sar.sar_type],
        ['Detection Date', sar.detection_date],
        ['Report Date', sar.submitted_at?.slice(0, 10) || sar.draft_created_date],
        ['BSA Institution', sar.bsa_filing_institution],
        ['TIN', sar.tin]
      ]} />
      <SectionTitle title="Amounts" />
      <Grid items={[
        ['# Transactions', sar.num_transactions],
        ['Total Amount', sar.total_amount != null ? `${sar.currency || ''} ${Number(sar.total_amount).toLocaleString()}` : '—'],
        ['Currency', sar.currency],
        ['Structuring', sar.structuring_indicator ? 'Yes' : 'No'],
        ['Prior SARs', sar.prior_sars ? `Yes (${sar.prior_sar_count || '?'})` : 'No'],
        ['Date of Recent SAR', sar.date_of_recent_sar]
      ]} />

      {sar.filing_type === 'Joint SAR' && (
        <div className="border-l-4 border-blue-400 bg-blue-50/30 rounded-r-md p-3">
          <SectionTitle title="Co-Filing Institution" />
          <Grid items={[
            ['Institution', sar.joint_filer_name],
            ['FEIN', sar.joint_filer_fein],
            ['Address', [sar.joint_filer_address, sar.joint_filer_city, sar.joint_filer_state, sar.joint_filer_zip].filter(Boolean).join(', ')],
            ['Contact', sar.joint_filer_contact_name],
            ['Phone', sar.joint_filer_contact_phone],
            ['Role', sar.joint_filer_role]
          ]} />
        </div>
      )}

      {sar.filing_type === 'Continuing SAR' && (
        <div className="border-l-4 border-orange-400 bg-orange-50/30 rounded-r-md p-3">
          <SectionTitle title="Prior SAR Reference" />
          <Grid items={[
            ['Prior SAR ID', sar.prior_sar_id ? <a href={`/sars/${sar.prior_sar_id}`} className="text-blue-600 hover:underline font-mono">{sar.prior_sar_id}</a> : '—'],
            ['Prior Filing Date', sar.prior_sar_filing_date],
            ['Activity From', sar.continuing_activity_from],
            ['Activity To', sar.continuing_activity_to]
          ]} />
          {sar.changes_since_prior_sar && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Changes Since Prior SAR</div>
              <div className="text-xs text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded p-2">
                {sar.changes_since_prior_sar}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubjectView({ sar }) {
  const submitted = sar.subject_data || {};
  const live = sar.customer || {};
  const submittedName = submitted.type === 'Individual'
    ? `${submitted.first_name || ''} ${submitted.last_name || ''}`.trim()
    : submitted.legal_name;

  const compare = [
    { label: 'Name',    submitted: submittedName, live: live.customer_name },
    { label: 'Country', submitted: submitted.country, live: live.country_of_residence || live.country_of_incorporation },
    { label: 'ID',      submitted: submitted.ssn_tin || submitted.ein, live: live.government_id_number || live.registration_number },
    { label: 'Industry / Occupation', submitted: submitted.industry || submitted.occupation, live: live.industry || live.job_title }
  ];

  return (
    <div className="space-y-4 text-sm">
      <SectionTitle title="Submitted vs. Current KYC" />
      <div className="space-y-2">
        {compare.map((c, i) => {
          const both = c.submitted && c.live;
          const mismatch = both && String(c.submitted).trim() !== String(c.live).trim();
          return (
            <div key={i} className={`grid grid-cols-3 gap-3 px-3 py-2 rounded border ${mismatch ? 'bg-yellow-50 border-yellow-300' : 'border-slate-200'}`}>
              <div className="text-xs text-slate-500">{c.label}</div>
              <div className="text-navy-900">{c.submitted || <span className="text-slate-400 italic">empty</span>}</div>
              <div className="text-slate-600">
                {c.live || <span className="text-slate-400 italic">no KYC value</span>}
                {mismatch && (
                  <div className="text-[11px] text-yellow-700 mt-0.5">
                    <AlertTriangle size={11} className="inline mr-1" />
                    KYC data has changed since this SAR was filed
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle title="Full Submitted Subject" />
      {submitted.type === 'Individual' ? (
        <Grid items={[
          ['Type', 'Individual'],
          ['First Name', submitted.first_name],
          ['Last Name', submitted.last_name],
          ['DOB', submitted.dob],
          ['SSN/TIN', submitted.ssn_tin],
          ['Address', submitted.address],
          ['City / State / ZIP', `${submitted.city || ''} ${submitted.state || ''} ${submitted.zip || ''}`.trim()],
          ['Country', submitted.country],
          ['ID Type', submitted.id_type],
          ['ID Number', submitted.id_number],
          ['Occupation', submitted.occupation],
          ['Relationship', submitted.relationship]
        ]} />
      ) : (
        <>
          <Grid items={[
            ['Type', 'Entity'],
            ['Legal Name', submitted.legal_name],
            ['DBA', submitted.dba_name],
            ['EIN', submitted.ein],
            ['Address', submitted.address],
            ['Country', submitted.country],
            ['Business Type', submitted.business_type],
            ['Industry', submitted.industry]
          ]} />
          <SectionTitle title={`Beneficial Owners (${(submitted.beneficial_owners || []).length})`} small />
          <ul className="space-y-1 text-xs">
            {(submitted.beneficial_owners || []).map((o, i) => (
              <li key={i} className="border border-slate-100 rounded px-2 py-1">
                {o.name} · {o.pct}% · {o.nationality}
              </li>
            ))}
            {(submitted.beneficial_owners || []).length === 0 && (
              <li className="text-slate-400 italic">No owners listed</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function ActivityView({ sar }) {
  const alertedTxns = sar.source_alert
    ? <AlertedTxnsTable customerId={sar.customer_id} alertId={sar.source_alert_id} />
    : null;

  return (
    <div className="space-y-4 text-sm">
      <SectionTitle title="Activity Window" />
      <Grid items={[
        ['Activity From', sar.activity_date_from],
        ['Activity To',   sar.activity_date_to],
        ['Total Amount Involved', usdFmt(sar.amount_involved_inr)]
      ]} />

      <SectionTitle title="Activity Types" />
      <div className="flex flex-wrap gap-1">
        {(sar.suspicious_activity_types || []).map(t => (
          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{t}</span>
        ))}
        {(sar.suspicious_activity_types || []).length === 0 && (
          <span className="text-xs text-slate-400 italic">None selected</span>
        )}
      </div>

      <SectionTitle title="Transaction Types" />
      <div className="flex flex-wrap gap-1">
        {(sar.transaction_types || []).map(t => (
          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{t}</span>
        ))}
        {(sar.transaction_types || []).length === 0 && (
          <span className="text-xs text-slate-400 italic">None selected</span>
        )}
      </div>

      <Grid items={[
        ['IP Addresses', sar.ip_addresses],
        ['Device Identifiers', sar.device_identifiers],
        ['Transaction Locations', sar.transaction_locations]
      ]} />

      {alertedTxns && (
        <>
          <SectionTitle title="Transactions referenced by source alert" />
          {alertedTxns}
        </>
      )}
    </div>
  );
}

function AlertedTxnsTable({ customerId, alertId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get(`/alerts/${alertId}/transactions`, { params: { alerted_only: 1 } })
      .then(r => setRows(r.data.transactions))
      .catch(() => setRows([]));
  }, [customerId, alertId]);
  if (!rows) return <div className="text-xs text-slate-400 py-3">Loading transactions…</div>;
  if (rows.length === 0) return <div className="text-xs text-slate-400 py-3">No alerted transactions</div>;
  return (
    <div className="overflow-x-auto border border-slate-200 rounded">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50">
          <tr className="text-slate-500 uppercase tracking-wider">
            <th className="px-2 py-1.5 text-left">Date</th>
            <th className="px-2 py-1.5 text-left">Txn ID</th>
            <th className="px-2 py-1.5 text-left">Type</th>
            <th className="px-2 py-1.5 text-left">Counterparty</th>
            <th className="px-2 py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.transaction_id} className="border-t border-slate-100">
              <td className="px-2 py-1">{t.txn_date}</td>
              <td className="px-2 py-1 font-mono">{t.transaction_id}</td>
              <td className="px-2 py-1">{t.txn_type}</td>
              <td className="px-2 py-1 truncate max-w-[180px]">{t.counterparty}</td>
              <td className="px-2 py-1 text-right font-mono">{usdFmt(t.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NarrativeView({ sar, comments, setComments, reload }) {
  const ref = useRef(null);
  const [popup, setPopup] = useState(null);
  const [text, setText] = useState('');
  const wordCount = (sar.narrative || '').trim().split(/\s+/).filter(Boolean).length;

  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setPopup(null); return; }
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) { setPopup(null); return; }
    const selectedText = sel.toString();
    if (!selectedText.trim()) { setPopup(null); return; }
    const startOffset = textOffset(ref.current, range.startContainer, range.startOffset);
    const endOffset   = textOffset(ref.current, range.endContainer, range.endOffset);
    const rect = range.getBoundingClientRect();
    const containerRect = ref.current.getBoundingClientRect();
    setPopup({
      top: rect.top - containerRect.top + ref.current.scrollTop - 6,
      left: rect.left - containerRect.left,
      text: selectedText,
      start: startOffset,
      end: endOffset
    });
  };

  const addComment = async () => {
    if (!popup || !text.trim()) return;
    try {
      await api.post('/sar-approvals/comments', {
        sar_id: sar.sar_id,
        manager_id: 'Compliance Manager',
        comment_text: text.trim(),
        highlighted_text: popup.text,
        position_start: popup.start,
        position_end: popup.end
      });
      setText('');
      setPopup(null);
      window.getSelection()?.removeAllRanges();
      reload();
    } catch (_e) {}
  };

  const removeComment = async (id) => {
    if (!confirm('Remove this comment?')) return;
    await api.delete(`/sar-approvals/comments/${id}`);
    reload();
  };

  const narrativeWithHighlights = useMemo(() => {
    const text = sar.narrative || '';
    if (!text || comments.length === 0) return [{ text, highlighted: false }];
    const ranges = [...comments]
      .filter(c => c.position_start != null && c.position_end != null && c.position_end > c.position_start)
      .sort((a, b) => a.position_start - b.position_start);
    if (ranges.length === 0) return [{ text, highlighted: false }];
    const out = [];
    let cursor = 0;
    for (const r of ranges) {
      const start = Math.max(cursor, r.position_start);
      const end   = Math.min(text.length, r.position_end);
      if (start > cursor) out.push({ text: text.slice(cursor, start), highlighted: false });
      if (end > start) out.push({ text: text.slice(start, end), highlighted: true, comment: r });
      cursor = Math.max(cursor, end);
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), highlighted: false });
    return out;
  }, [sar.narrative, comments]);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <SectionTitle title="Submitted Narrative" />
        <div className="text-xs text-slate-500">{wordCount} words · {(sar.narrative || '').length} chars</div>
      </div>

      <div className="relative">
        <div
          ref={ref}
          onMouseUp={onMouseUp}
          className="text-sm whitespace-pre-wrap text-slate-800 bg-slate-50 border border-slate-200 rounded p-4 leading-relaxed select-text"
        >
          {narrativeWithHighlights.map((part, i) =>
            part.highlighted ? (
              <mark key={i} className="bg-yellow-200 text-navy-900 px-0.5 rounded" title={part.comment?.comment_text}>
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
          {!sar.narrative && <span className="text-slate-400 italic">No narrative submitted</span>}
        </div>

        {popup && (
          <div
            className="absolute bg-white border border-slate-300 shadow-lg rounded-md p-2 z-10 w-64"
            style={{ top: popup.top, left: popup.left }}
          >
            <div className="text-[11px] text-slate-500 mb-1 truncate">"{popup.text.slice(0, 50)}{popup.text.length > 50 ? '…' : ''}"</div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={2}
              placeholder="Add a comment for the analyst…"
              className="w-full text-xs border border-slate-200 rounded p-1.5 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-1 mt-1">
              <button onClick={() => { setPopup(null); setText(''); }}
                className="text-[11px] px-2 py-1 rounded hover:bg-slate-100">Cancel</button>
              <button onClick={addComment} disabled={!text.trim()}
                className="text-[11px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-1">
                <MessageSquarePlus size={11} /> Comment
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <SectionTitle title={`Inline Comments (${comments.length})`} small />
        <ul className="space-y-2 mt-2">
          {comments.map(c => (
            <li key={c.id} className="border border-slate-200 rounded p-2 bg-yellow-50/40">
              <div className="text-[11px] text-slate-500">
                {c.manager_id || 'Manager'} · {c.created_at}
              </div>
              {c.highlighted_text && (
                <div className="text-xs italic text-slate-600 border-l-2 border-yellow-400 pl-2 mt-1">
                  "{c.highlighted_text}"
                </div>
              )}
              <div className="text-sm text-navy-900 mt-1">{c.comment_text}</div>
              <div className="flex justify-end mt-1">
                <button onClick={() => removeComment(c.id)}
                  className="text-[11px] text-red-600 hover:underline">Remove</button>
              </div>
            </li>
          ))}
          {comments.length === 0 && (
            <li className="text-xs text-slate-400 italic">Highlight any text in the narrative and click "Comment" to add feedback.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function textOffset(root, node, nodeOffset) {
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === node) return offset + nodeOffset;
    offset += n.textContent.length;
  }
  return offset;
}

function AttachmentsView({ sar }) {
  const docs = sar.documents || [];
  const included = docs.filter(d => d.included);
  const excluded = docs.filter(d => !d.included);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <SectionTitle title={`Included in SAR (${included.length})`} />
        {included.length > 0 && (
          <button
            onClick={() => included.forEach(d => window.open(`/api/case-documents/file/${d.id}`, '_blank'))}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1">
            <Download size={12} /> Download All
          </button>
        )}
      </div>
      <div className="space-y-2">
        {included.map(d => <DocRow key={d.id} d={d} />)}
        {included.length === 0 && (
          <div className="text-xs text-slate-400 italic py-3 text-center border border-dashed border-slate-200 rounded">
            No attachments included in this SAR
          </div>
        )}
      </div>

      {excluded.length > 0 && (
        <>
          <SectionTitle title={`Available but Excluded (${excluded.length})`} small />
          <div className="space-y-2 opacity-70">
            {excluded.map(d => <DocRow key={d.id} d={d} muted />)}
          </div>
        </>
      )}
    </div>
  );
}

function DocRow({ d, muted }) {
  const isImage = /\.(png|jpg|jpeg|gif)$/i.test(d.file_name);
  const isPdf   = /\.pdf$/i.test(d.file_name);
  return (
    <div className={`flex items-center justify-between gap-2 p-2 rounded border ${muted ? 'border-slate-200' : 'border-slate-200 bg-blue-50/40'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={14} className="text-slate-400 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium truncate">{d.file_name}</div>
          <div className="text-[11px] text-slate-500">
            {d.document_type || 'Other'} · {Math.round(d.file_size / 1024)} KB · {d.uploaded_by}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {(isImage || isPdf) && (
          <a href={`/api/case-documents/file/${d.id}?preview=1`} target="_blank" rel="noreferrer"
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Preview">
            <Eye size={13} />
          </a>
        )}
        <a href={`/api/case-documents/file/${d.id}`}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Download">
          <Download size={13} />
        </a>
      </div>
    </div>
  );
}

function SummaryView({ sar, comments }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center justify-between">
        <SectionTitle title="Full Submission Summary" />
        <button onClick={() => window.print()}
          className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1">
          <Printer size={12} /> Print / PDF
        </button>
      </div>
      <DetailsView sar={sar} />
      <hr className="border-slate-200" />
      <SubjectView sar={sar} />
      <hr className="border-slate-200" />
      <ActivityView sar={sar} />
      <hr className="border-slate-200" />
      <SectionTitle title="Narrative" />
      <div className="bg-slate-50 rounded p-3 whitespace-pre-wrap">{sar.narrative || <span className="italic text-slate-400">Empty</span>}</div>
      {comments.length > 0 && (
        <>
          <SectionTitle title={`Inline Comments (${comments.length})`} small />
          <ul className="space-y-2">
            {comments.map(c => (
              <li key={c.id} className="border border-slate-200 rounded p-2 bg-yellow-50/40 text-xs">
                {c.highlighted_text && <div className="italic text-slate-600">"{c.highlighted_text}"</div>}
                <div className="text-navy-900 mt-1">{c.comment_text}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* --- Right panel cards --- */
function CaseContextCard({ sar }) {
  const a = sar.source_alert || {};
  const c = sar.customer || {};
  return (
    <Card title="Case Context" bodyClassName="p-4 text-sm space-y-2">
      <Row k="Scenario" v={a.scenario || sar.alert_scenario || '—'} />
      <Row k="Alert Amount" v={usdFmt(a.amount_flagged_inr)} />
      <Row k="Detection" v={sar.detection_date || a.created_date || '—'} />
      <Row k="Customer Risk" v={c.customer_risk_rating ? <Badge value={c.customer_risk_rating} /> : '—'} />
      <Row k="KYC Status" v={c.kyc_review_status || '—'} />
      <Row k="PEP / Sanctions"
        v={c.sanctions_match ? <span className="text-red-600 font-semibold">Sanctions hit</span>
            : c.pep_match ? <span className="text-orange-600">PEP</span> : 'Clean'} />
      <hr className="border-slate-100 my-2" />
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
        Previous SARs ({(sar.customer_sars || []).length})
      </div>
      <ul className="space-y-1 text-xs">
        {(sar.customer_sars || []).slice(0, 5).map(s => (
          <li key={s.sar_id} className="flex items-center justify-between">
            <span className="font-mono">{s.sar_id}</span>
            <span className="text-slate-500">{s.filed_date || s.draft_created_date || '—'}</span>
            <Badge value={s.sar_status} />
          </li>
        ))}
        {(sar.customer_sars || []).length === 0 && <li className="text-slate-400 italic">None</li>}
      </ul>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-2">
        Recent Alerts ({(sar.customer_alerts || []).length})
      </div>
      <ul className="space-y-1 text-xs">
        {(sar.customer_alerts || []).slice(0, 5).map(al => (
          <li key={al.alert_id} className="flex items-center justify-between">
            <span className="font-mono">{al.alert_id}</span>
            <span className="text-slate-500 truncate">{al.scenario}</span>
            <Badge value={al.alert_status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AnalystActivityCard({ sar }) {
  const events = useMemo(() => {
    const ev = [];
    const a = sar.source_alert;
    if (a) {
      ev.push({ ts: `${a.created_date} 00:00:00`, kind: 'Alert created', who: a.created_by || 'system_tm_engine' });
      if (a.assigned_to) ev.push({ ts: `${a.created_date} 00:05:00`, kind: 'Alert assigned', who: a.assigned_to });
    }
    for (const n of (sar.case_notes || [])) {
      ev.push({ ts: n.timestamp, kind: 'Note', who: n.analyst, detail: (n.note_text || '').slice(0, 100) + ((n.note_text || '').length > 100 ? '…' : '') });
    }
    if (sar.draft_created_date) {
      ev.push({ ts: `${sar.draft_created_date} 09:00:00`, kind: 'SAR draft created', who: sar.prepared_by });
    }
    if (sar.submitted_at) {
      ev.push({ ts: sar.submitted_at, kind: 'SAR submitted for approval', who: sar.submitted_by });
    }
    for (const log of (sar.approval_log || [])) {
      ev.push({ ts: log.actioned_at, kind: log.action === 'approved' ? 'SAR approved' : 'SAR rejected',
                who: log.actioned_by, detail: log.comments?.slice(0, 100) });
    }
    return ev.sort((x, y) => x.ts.localeCompare(y.ts));
  }, [sar]);

  return (
    <Card title="Analyst Activity" bodyClassName="p-4">
      <ol className="relative border-l border-slate-200 ml-2 space-y-3">
        {events.map((e, i) => (
          <li key={i} className="ml-4">
            <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500 mt-1" />
            <div className="text-xs font-medium text-navy-900">{e.kind}</div>
            <div className="text-[11px] text-slate-500">{e.ts} · {e.who || '—'}</div>
            {e.detail && <div className="text-xs text-slate-700 mt-0.5">{e.detail}</div>}
          </li>
        ))}
        {events.length === 0 && <li className="ml-4 text-xs text-slate-400">No activity</li>}
      </ol>
    </Card>
  );
}

function ReviewChecklistCard({ checklist, setChecklist }) {
  const allChecked = CHECKLIST_ITEMS.every(c => !!checklist[c.k]);
  return (
    <Card title="Review Checklist" bodyClassName="p-4">
      <div className="text-xs text-slate-500 mb-2">
        {allChecked
          ? <span className="text-green-700"><Check size={12} className="inline mr-1" />All items complete</span>
          : 'Tick each item before approving'}
      </div>
      <ul className="space-y-1.5 text-sm">
        {CHECKLIST_ITEMS.map(c => (
          <li key={c.k}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={!!checklist[c.k]}
                onChange={e => setChecklist(cl => ({ ...cl, [c.k]: e.target.checked }))}
                className="mt-1" />
              <span className={checklist[c.k] ? 'text-slate-700 line-through' : 'text-slate-700'}>{c.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DecisionCard({ allChecked, isFiled, onApprove, onReject, comments }) {
  return (
    <Card title="Manager Decision" bodyClassName="p-4 space-y-3">
      {isFiled ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 inline-flex items-center gap-2">
          <Check size={14} /> SAR is already filed — no further action needed.
        </div>
      ) : (
        <>
          <button
            onClick={onApprove}
            disabled={!allChecked}
            title={!allChecked ? 'Complete the checklist to enable approval' : ''}
            className="w-full text-sm px-3 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center justify-center gap-1"
          >
            <Check size={14} /> Approve &amp; File SAR
          </button>
          <button
            onClick={onReject}
            className="w-full text-sm px-3 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 inline-flex items-center justify-center gap-1"
          >
            <X size={14} /> Reject &amp; Return to Analyst
          </button>
          <div className="text-[11px] text-slate-500">
            {comments.length} inline comment{comments.length === 1 ? '' : 's'} will be sent to the analyst on rejection.
          </div>
        </>
      )}
    </Card>
  );
}

/* --- Modals --- */
function ApproveModal({ sar, note, setNote, submitting, onCancel, onConfirm }) {
  return (
    <ModalShell tone="green" icon={Check}
      title={`Approve SAR ${sar.sar_id}?`} onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          You are approving SAR <span className="font-mono font-semibold">{sar.sar_id}</span> for{' '}
          <span className="font-semibold">{sar.customer_name}</span>. This will officially file the SAR with the regulator and assign a regulator reference.
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Approval note (optional)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Optional note for the audit trail."
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={onConfirm} disabled={submitting}
          className="text-sm px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white">
          {submitting ? 'Filing…' : 'Confirm & File'}
        </button>
      </div>
    </ModalShell>
  );
}

function RejectModal({ sar, inlineComments, submitting, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const augmented = useMemo(() => {
    if (inlineComments.length === 0) return text;
    const inline = inlineComments.map(c => `• ${c.highlighted_text ? `"${c.highlighted_text}" — ` : ''}${c.comment_text}`).join('\n');
    return text + (text ? '\n\nInline narrative comments:\n' : 'Inline narrative comments:\n') + inline;
  }, [text, inlineComments]);

  const ready = !!reason && augmented.length >= 50;

  return (
    <ModalShell tone="red" icon={X}
      title={`Reject SAR ${sar.sar_id}`} onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          The analyst will receive a notification with the reason and your comments. The SAR returns to "Returned for Revision".
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Reason category <span className="text-red-500">*</span></label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white focus:border-blue-500 focus:outline-none">
            <option value="">— select reason —</option>
            {REJECTION_REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">
            Comments <span className="text-red-500">*</span>
            <span className="text-slate-400 font-normal ml-1">(min 50 characters incl. inline comments)</span>
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            placeholder="Explain what needs to be corrected…"
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:border-blue-500 focus:outline-none"
          />
          <div className="text-[11px] text-slate-500 mt-1">
            {augmented.length} chars
            {inlineComments.length > 0 && <span className="ml-2">· {inlineComments.length} inline comment{inlineComments.length === 1 ? '' : 's'} appended automatically</span>}
          </div>
        </div>
        {inlineComments.length > 0 && (
          <details className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
            <summary className="cursor-pointer font-medium text-yellow-800">Preview of full feedback ({augmented.length} chars)</summary>
            <pre className="mt-2 whitespace-pre-wrap text-slate-700">{augmented}</pre>
          </details>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={() => onConfirm({ reason, comments: augmented })}
          disabled={!ready || submitting}
          className="text-sm px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white">
          {submitting ? 'Rejecting…' : 'Confirm Rejection'}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ icon: Icon, title, tone = 'blue', children, onCancel }) {
  const toneCls = {
    blue:   'bg-blue-100 text-blue-600',
    red:    'bg-red-100 text-red-600',
    green:  'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600'
  }[tone] || 'bg-blue-100 text-blue-600';
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
        </div>
        {children}
      </div>
    </div>
  );
}

/* --- atoms --- */
function SectionTitle({ title, small }) {
  return (
    <div className={`${small ? 'text-xs' : 'text-sm'} font-semibold text-navy-900 uppercase tracking-wider`}>{title}</div>
  );
}
function Grid({ items }) {
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
function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}
