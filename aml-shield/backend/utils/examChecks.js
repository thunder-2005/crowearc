// ═══════════════════════════════════════════════════════════════════════════
// FFIEC BSA/AML Examination Procedure Checks (C-11)
//
// Each exported check is a pure async function:
//   check(db, config) → standardised result object
//
// Checks DO NOT write to the database — the route handler is the only
// place that INSERTs findings rows. This separation keeps the checks
// independently testable against mock DB clients.
//
// All SQL uses parameterised queries ($1, $2). No string-interpolation
// of user-supplied values. Ever.
//
// Scoring rules (consistent across every check):
//   pass    : score 85–100  (failure rate ≤ 5%)
//   concern : score 50–84   (failure rate 6–20%)
//   fail    : score 0–49    (failure rate > 20%, OR a fail-severity
//                            override, OR check cannot run for data
//                            reasons)
//   skipped : not included in the run, OR pre-requisite unmet (< 5
//             records in scope)
//
// FFIEC references in this file map to the FFIEC BSA/AML Examination
// Manual (2020 revision, updated 2023) sections. CFR references are the
// canonical U.S. federal citations.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_DETAIL_ITEMS = 50;

// ── shared helpers ────────────────────────────────────────────────────────

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreFromFailureRate(failurePct) {
  // 0% → 100, 20% → 50, 50% → 0 (clamped linearly through those anchors).
  if (failurePct <= 5)  return clamp(Math.round(100 - failurePct * 2), 85, 100);
  if (failurePct <= 20) return clamp(Math.round(100 - failurePct * 2), 50, 84);
  return clamp(Math.round(100 - failurePct * 2), 0, 49);
}

function statusFromFailureRate(failurePct, hasMaxSeverity = false) {
  if (hasMaxSeverity) return 'fail';
  if (failurePct <= 5)  return 'pass';
  if (failurePct <= 20) return 'concern';
  return 'fail';
}

function withOverflowNote(details, totalFailures) {
  if (details.length <= MAX_DETAIL_ITEMS) return details;
  const trimmed = details.slice(0, MAX_DETAIL_ITEMS);
  trimmed.push({
    recordId: null,
    recordType: 'overflow_note',
    detailText: `${totalFailures - MAX_DETAIL_ITEMS} additional records not shown.`,
    severity: 'info'
  });
  return trimmed;
}

function maskName(name) {
  if (!name || typeof name !== 'string') return 'Customer';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Heuristic: the sar_filings schema doesn't carry an explicit
// subject_unknown column. We probe subject_data (JSON or free text) for
// telltale strings. Once an explicit column exists (B-5), replace this.
function isSubjectUnknown(sar) {
  const raw = sar.subject_data;
  if (!raw) return false;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && (parsed.subject_unknown === true || parsed.is_unknown === true)) return true;
    if (parsed && typeof parsed.subject_name === 'string' && /unknown/i.test(parsed.subject_name)) return true;
  } catch (_e) {
    if (typeof raw === 'string' && /unknown/i.test(raw)) return true;
  }
  return false;
}

function pgDaysBetween(later, earlier) {
  const a = new Date(later);
  const b = new Date(earlier);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function makeSkipped(checkId, checkName, ffiecReference, cfrReference, reason) {
  return {
    checkId,
    checkName,
    ffiecReference,
    cfrReference,
    status: 'skipped',
    score: null,
    sampleSize: 0,
    samplePassed: 0,
    sampleFailed: 0,
    failureRate: null,
    findingSummary: reason,
    findingDetail: [],
    remediationItems: []
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 1 — SAR Filing Timeliness
// FFIEC: Core Examination Procedures for SAR Monitoring and Filing
// CFR:   31 CFR 1020.320(b)
// ═══════════════════════════════════════════════════════════════════════════
async function checkSarTimeliness(db, config) {
  const checkId        = 'SAR_TIMELINESS';
  const checkName      = 'SAR Filing Timeliness';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Core Examination Procedures for SAR Monitoring and Filing';
  const cfrReference   = '31 CFR 1020.320(b)';

  const sampleSize = Math.max(1, Number(config.sarSampleSize) || 25);
  const thresholdDays = Math.max(1, Number(config.sarTimelinessDays) || 30);
  const lookbackDays  = Math.max(1, Number(config.lookbackDays) || 365);

  // Random sample of filed SARs within the lookback window. We anchor on
  // sar_filings.detection_date when populated; fall back to created_at.
  // TODO(B-5): once detection_date is immutable + non-null, drop the
  // COALESCE and require detection_date.
  const r = await db.query(
    `SELECT sar_id, customer_name, detection_date, filed_date, created_at,
            subject_data
       FROM sar_filings
      WHERE filed_date IS NOT NULL
        AND NULLIF(filed_date, '') IS NOT NULL
        AND NULLIF(COALESCE(detection_date, created_at), '') IS NOT NULL
        AND (
          NULLIF(COALESCE(detection_date, created_at), '')::date
          >= (CURRENT_DATE - ($1 || ' days')::interval)::date
        )
      ORDER BY RANDOM()
      LIMIT $2`,
    [String(lookbackDays), sampleSize]
  );
  const sars = r.rows;

  if (sars.length < 5) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${sars.length} filed SAR(s) in the lookback window — sample is too small to be meaningful.`);
  }

  const failures = [];
  for (const sar of sars) {
    const detection = sar.detection_date || sar.created_at;
    const elapsed = pgDaysBetween(sar.filed_date, detection);
    if (elapsed == null) continue;
    const subjectUnknown = isSubjectUnknown(sar);
    const limit = subjectUnknown ? 60 : thresholdDays;
    if (elapsed > limit) {
      failures.push({
        recordId: sar.sar_id,
        recordType: 'sar_filing',
        detailText: `Filed ${elapsed} days after detection (limit ${limit} day${limit === 1 ? '' : 's'}${subjectUnknown ? ' — unknown-subject extension' : ''}). Customer: ${maskName(sar.customer_name)}. Detection: ${String(detection).slice(0, 10)}, Filed: ${String(sar.filed_date).slice(0, 10)}.`,
        severity: elapsed > limit + 30 ? 'high' : 'medium'
      });
    }
  }

  const sampleFailed = failures.length;
  const samplePassed = sars.length - sampleFailed;
  const failureRate  = Math.round((sampleFailed / sars.length) * 10000) / 100;
  const status       = statusFromFailureRate(failureRate);
  const score        = scoreFromFailureRate(failureRate);

  const remediationItems = [];
  if (sampleFailed > 0) {
    remediationItems.push({
      priority: 'high',
      action: 'Review SLA escalation thresholds in Manager Settings. Ensure L2 investigators receive SLA-breach warnings at 21 days.',
      ownerRole: 'compliance_manager'
    });
  }
  if (failureRate > 10) {
    remediationItems.push({
      priority: 'high',
      action: 'Conduct a root-cause analysis across all late SARs in the sample. Determine whether delays concentrate in specific analysts, alert types, or approval steps.',
      ownerRole: 'bsa_officer'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: sars.length,
    samplePassed,
    sampleFailed,
    failureRate,
    findingSummary: sampleFailed === 0
      ? `All ${sars.length} sampled SARs were filed within the regulatory deadline.`
      : `${sampleFailed} of ${sars.length} sampled SARs were filed more than ${thresholdDays} days after detection.`,
    findingDetail: withOverflowNote(failures, sampleFailed),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 2 — CDD Completeness
// FFIEC: Core Examination Procedures for Customer Due Diligence
// CFR:   31 CFR 1010.230 (CDD Final Rule)
// ═══════════════════════════════════════════════════════════════════════════
async function checkCddCompleteness(db, config) {
  const checkId        = 'CDD_COMPLETENESS';
  const checkName      = 'CDD Completeness — Ownership & Control Prongs';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Core Examination Procedures for CDD';
  const cfrReference   = '31 CFR 1010.230 (CDD Final Rule)';

  const sampleSize    = Math.max(1, Number(config.cddSampleSize) || 50);
  const lookbackDays  = Math.max(1, Number(config.lookbackDays) || 365);

  const r = await db.query(
    `SELECT customer_id, customer_name, customer_type, cdd_level,
            customer_risk_rating, beneficial_owners, last_kyc_review_date,
            exit_status, customer_since_date
       FROM customers
      WHERE (exit_status IS NULL OR exit_status NOT IN ('exited','closed','inactive'))
        AND (
          NULLIF(customer_since_date, '') IS NULL
          OR NULLIF(customer_since_date, '')::date
             >= (CURRENT_DATE - ($1 || ' days')::interval)::date
        )
      ORDER BY RANDOM()
      LIMIT $2`,
    [String(lookbackDays), sampleSize]
  );
  const customers = r.rows;

  if (customers.length < 5) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${customers.length} active customer(s) in scope — sample is too small to be meaningful.`);
  }

  const failures = [];
  let concernOnly = 0;

  for (const c of customers) {
    const reasons = [];
    let hardFail = false;

    // Ownership prong: ≥1 beneficial owner with ownership_percentage >= 25
    let owners = [];
    let ownersParseable = true;
    if (c.beneficial_owners) {
      try {
        const parsed = JSON.parse(c.beneficial_owners);
        owners = Array.isArray(parsed) ? parsed : (parsed?.owners || []);
      } catch (_e) {
        ownersParseable = false;
      }
    }
    const hasOwnership = Array.isArray(owners) && owners.some(o => {
      const pct = Number(o?.ownership_percentage ?? o?.percentage ?? o?.pct);
      return Number.isFinite(pct) && pct >= 25;
    });
    if (!ownersParseable) { reasons.push('beneficial_owners JSON malformed'); hardFail = true; }
    else if (!hasOwnership) { reasons.push('no owner with ≥25% interest'); hardFail = true; }

    // Control prong: at least one record flagged as controller OR a single-
    // member entity (parsed identically; checked under is_controller /
    // control_prong / role flags). For non-legal-entity customers (when
    // customer_type indicates individual) the control prong is satisfied
    // by the customer themselves; only legal entities fail this gate.
    const isLegalEntity = c.customer_type && /(entity|corp|llc|partnership|trust|business)/i.test(c.customer_type);
    if (isLegalEntity) {
      const hasController = Array.isArray(owners) && owners.some(o =>
        o?.is_controller === true || o?.control_prong === true || /controller|control/i.test(String(o?.role || ''))
      );
      if (!hasController) { reasons.push('no documented controller (control prong)'); hardFail = true; }
    }

    // CDD level documented (mandatory for legal entities)
    if (isLegalEntity && (!c.cdd_level || String(c.cdd_level).trim() === '')) {
      reasons.push('cdd_level not documented');
      hardFail = true;
    }

    // KYC review currency — concern only, not fail
    if (!c.last_kyc_review_date
        || pgDaysBetween(new Date().toISOString(), c.last_kyc_review_date) > lookbackDays) {
      reasons.push('no completed KYC review in lookback window');
      if (!hardFail) concernOnly++;
    }

    if (reasons.length > 0) {
      failures.push({
        recordId: c.customer_id,
        recordType: 'customer',
        detailText: `${reasons.join('; ')}. Risk rating: ${c.customer_risk_rating || 'unknown'}.`,
        severity: hardFail ? 'high' : 'medium'
      });
    }
  }

  const sampleFailed = failures.filter(f => f.severity === 'high').length;
  const samplePassed = customers.length - failures.length;
  const failureRate  = Math.round((sampleFailed / customers.length) * 10000) / 100;
  const status       = statusFromFailureRate(failureRate);
  const score        = scoreFromFailureRate(failureRate);

  const remediationItems = [];
  if (sampleFailed > 0) {
    remediationItems.push({
      priority: 'high',
      action: 'Re-collect ownership and control documentation for customers missing the CDD Final Rule prongs. Open KYC review tasks for each affected record.',
      ownerRole: 'compliance_manager'
    });
  }
  if (concernOnly > 0) {
    remediationItems.push({
      priority: 'medium',
      action: `Schedule overdue KYC periodic reviews for ${concernOnly} customer(s) with no completed review in the lookback window.`,
      ownerRole: 'compliance_manager'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: customers.length,
    samplePassed,
    sampleFailed,
    failureRate,
    findingSummary: `${sampleFailed} of ${customers.length} sampled customers have CDD ownership/control gaps. ${concernOnly} additional records have lapsed periodic reviews. NOTE: UBO data is stored as unstructured JSON. Once B-10 (relational UBO schema) is remediated, this check will have stronger query-level enforcement.`,
    findingDetail: withOverflowNote(failures, failures.length),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 3 — KYC Review Timeliness
// FFIEC: CDD — Ongoing Monitoring
// CFR:   31 CFR 1010.230(e)
// ═══════════════════════════════════════════════════════════════════════════
async function checkKycReviewTimeliness(db, config) {
  const checkId        = 'KYC_REVIEW_TIMELINESS';
  const checkName      = 'KYC Review Timeliness';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — CDD Ongoing Monitoring';
  const cfrReference   = '31 CFR 1010.230(e)';

  const lookbackDays = Math.max(1, Number(config.lookbackDays) || 365);
  const overdueDays  = Math.max(0, Number(config.kycOverdueDays) || 30);

  const total = await db.query(
    `SELECT COUNT(*)::int AS c FROM kyc_reviews
      WHERE NULLIF(created_at, '')::timestamp
        >= NOW() - ($1 || ' days')::interval`,
    [String(lookbackDays)]
  );
  const totalReviews = Number(total.rows[0]?.c) || 0;

  if (totalReviews < 5) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${totalReviews} KYC review(s) in scope — sample is too small to be meaningful.`);
  }

  const overdueRows = (await db.query(
    `SELECT r.id, r.customer_id, r.review_type, r.due_date, r.status,
            c.customer_risk_rating
       FROM kyc_reviews r
       LEFT JOIN customers c ON c.customer_id = r.customer_id
      WHERE r.status IN ('pending','in_progress')
        AND NULLIF(r.due_date, '') IS NOT NULL
        AND NULLIF(r.due_date, '')::date < CURRENT_DATE`,
    []
  )).rows;

  const lateCompletedRows = (await db.query(
    `SELECT r.id, r.customer_id, r.review_type, r.due_date, r.completed_at,
            c.customer_risk_rating
       FROM kyc_reviews r
       LEFT JOIN customers c ON c.customer_id = r.customer_id
      WHERE r.status = 'completed'
        AND NULLIF(r.due_date, '') IS NOT NULL
        AND NULLIF(r.completed_at, '')::date
            > (NULLIF(r.due_date, '')::date + ($1 || ' days')::interval)::date
        AND NULLIF(r.created_at, '')::timestamp
            >= NOW() - ($2 || ' days')::interval`,
    [String(overdueDays), String(lookbackDays)]
  )).rows;

  const failures = [];
  let hasHighRiskFailure = false;

  for (const r of overdueRows) {
    const daysOverdue = pgDaysBetween(new Date().toISOString(), r.due_date);
    const highRisk = ['high','very_high','very high','High','Very High'].includes(r.customer_risk_rating);
    if (highRisk) hasHighRiskFailure = true;
    failures.push({
      recordId: String(r.id),
      recordType: 'kyc_review',
      detailText: `Review #${r.id} for customer ${r.customer_id} (${r.review_type || 'unspecified'}). Status: ${r.status}. Due ${String(r.due_date).slice(0, 10)} (${daysOverdue}d overdue). Risk rating: ${r.customer_risk_rating || 'unknown'}.`,
      severity: highRisk ? 'high' : 'medium'
    });
  }
  for (const r of lateCompletedRows) {
    const daysLate = pgDaysBetween(r.completed_at, r.due_date);
    const highRisk = ['high','very_high','very high','High','Very High'].includes(r.customer_risk_rating);
    if (highRisk) hasHighRiskFailure = true;
    failures.push({
      recordId: String(r.id),
      recordType: 'kyc_review',
      detailText: `Review #${r.id} for customer ${r.customer_id} completed ${daysLate}d after due date (${String(r.due_date).slice(0, 10)} → ${String(r.completed_at).slice(0, 10)}). Risk rating: ${r.customer_risk_rating || 'unknown'}.`,
      severity: highRisk ? 'high' : 'low'
    });
  }

  const sampleFailed = failures.length;
  const samplePassed = totalReviews - sampleFailed;
  const failureRate  = Math.round((sampleFailed / totalReviews) * 10000) / 100;
  const status       = statusFromFailureRate(failureRate, hasHighRiskFailure);
  const score        = hasHighRiskFailure ? Math.min(scoreFromFailureRate(failureRate), 49)
                                          : scoreFromFailureRate(failureRate);

  const remediationItems = [];
  if (sampleFailed > 0) {
    remediationItems.push({
      priority: hasHighRiskFailure ? 'high' : 'medium',
      action: 'Re-prioritise the overdue KYC review backlog. High-risk customers must be cleared first per 31 CFR 1010.230(e).',
      ownerRole: 'compliance_manager'
    });
  }
  if (hasHighRiskFailure) {
    remediationItems.push({
      priority: 'high',
      action: 'Escalate the overdue high-risk KYC reviews to the BSA Officer for personal review and rationale documentation.',
      ownerRole: 'bsa_officer'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: totalReviews,
    samplePassed,
    sampleFailed,
    failureRate,
    findingSummary: sampleFailed === 0
      ? `All ${totalReviews} KYC reviews in the lookback window are current.`
      : `${overdueRows.length} overdue + ${lateCompletedRows.length} completed-late KYC review(s) found across ${totalReviews} reviews in scope.`,
    findingDetail: withOverflowNote(failures, failures.length),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 4 — OFAC Screening Coverage
// FFIEC: Core Examination Procedures for OFAC
// CFR:   31 CFR 501.603
// ═══════════════════════════════════════════════════════════════════════════
async function checkOfacScreeningCoverage(db, config) {
  const checkId        = 'OFAC_SCREENING_COVERAGE';
  const checkName      = 'OFAC Screening Coverage';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Core Examination Procedures for OFAC';
  const cfrReference   = '31 CFR 501.603';

  const staleness = Math.max(1, Number(config.ofacScreeningStaleness) || 365);

  const activeCount = await db.query(
    `SELECT COUNT(*)::int AS c FROM customers
      WHERE (exit_status IS NULL OR exit_status NOT IN ('exited','closed','inactive'))`
  );
  const totalActive = Number(activeCount.rows[0]?.c) || 0;

  if (totalActive < 5) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${totalActive} active customer(s) — sample is too small to be meaningful.`);
  }

  const unscreened = (await db.query(
    `SELECT c.customer_id, c.customer_name, c.customer_risk_rating,
            MAX(NULLIF(o.screened_at, '')::timestamp) AS last_screened
       FROM customers c
       LEFT JOIN ofac_screening_results o
         ON o.entity_id = c.customer_id
        AND o.entity_type = 'customer'
        AND NULLIF(o.screened_at, '')::timestamp
            >= NOW() - ($1 || ' days')::interval
      WHERE (c.exit_status IS NULL OR c.exit_status NOT IN ('exited','closed','inactive'))
      GROUP BY c.customer_id, c.customer_name, c.customer_risk_rating
     HAVING MAX(NULLIF(o.screened_at, '')::timestamp) IS NULL`,
    [String(staleness)]
  )).rows;

  // SDN-list staleness override — forces concern even at 100% coverage.
  let sdnStale = false;
  let sdnLastSync = null;
  try {
    const sync = await db.query(
      `SELECT completed_at FROM ofac_sync_runs
        WHERE status = 'success'
        ORDER BY completed_at DESC LIMIT 1`
    );
    sdnLastSync = sync.rows[0]?.completed_at || null;
    if (!sdnLastSync) {
      sdnStale = true;
    } else {
      const hoursAgo = (Date.now() - new Date(sdnLastSync).getTime()) / 3600000;
      if (hoursAgo > 26) sdnStale = true;
    }
  } catch (_e) {
    // ofac_sync_runs may not exist on a fresh DB (migration 002 not yet
    // applied). Treat that as stale — the operator can't prove the list
    // is current.
    sdnStale = true;
  }

  let hasHighRiskFailure = false;
  const failures = [];
  for (const u of unscreened) {
    const highRisk = ['high','very_high','very high','High','Very High'].includes(u.customer_risk_rating);
    if (highRisk) hasHighRiskFailure = true;
    failures.push({
      recordId: u.customer_id,
      recordType: 'customer',
      detailText: `Customer ${u.customer_id} has no OFAC screening within the last ${staleness} days. Risk rating: ${u.customer_risk_rating || 'unknown'}.`,
      severity: highRisk ? 'high' : 'medium'
    });
  }
  if (sdnStale) {
    failures.unshift({
      recordId: null,
      recordType: 'sdn_sync_status',
      detailText: `OFAC SDN list may be stale. Last successful sync: ${sdnLastSync ? new Date(sdnLastSync).toISOString() : 'never'}. All screening results since that time may not reflect current SDN list state.`,
      severity: 'high'
    });
  }

  const sampleFailed = unscreened.length;
  const samplePassed = totalActive - sampleFailed;
  const failureRate  = Math.round((sampleFailed / totalActive) * 10000) / 100;
  // Forced concern minimum when SDN stale, even at 100% coverage.
  let status = statusFromFailureRate(failureRate, hasHighRiskFailure);
  if (sdnStale && status === 'pass') status = 'concern';
  let score = hasHighRiskFailure ? Math.min(scoreFromFailureRate(failureRate), 49)
                                  : scoreFromFailureRate(failureRate);
  if (sdnStale && score > 84) score = 84;

  const remediationItems = [];
  if (sdnStale) {
    remediationItems.push({
      priority: 'high',
      action: 'Trigger a manual OFAC SDN sync from the BSA Officer dashboard and confirm the next scheduled sync completes successfully.',
      ownerRole: 'bsa_officer'
    });
  }
  if (sampleFailed > 0) {
    remediationItems.push({
      priority: hasHighRiskFailure ? 'high' : 'medium',
      action: `Re-screen the ${sampleFailed} customer(s) without a current OFAC result. Prioritise high-risk records first.`,
      ownerRole: 'compliance_manager'
    });
  }

  const overflowSuffix = sampleFailed > MAX_DETAIL_ITEMS
    ? ` NOTE: ${sampleFailed - MAX_DETAIL_ITEMS} additional unscreened customers not shown. Export the full list for remediation.`
    : '';

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: totalActive,
    samplePassed,
    sampleFailed,
    failureRate,
    findingSummary: sampleFailed === 0 && !sdnStale
      ? `All ${totalActive} active customers screened within the last ${staleness} days.`
      : `${sampleFailed} of ${totalActive} active customers have no current OFAC screening.${sdnStale ? ' SDN list is stale.' : ''}${overflowSuffix}`,
    findingDetail: withOverflowNote(failures, failures.length),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 5 — Audit Trail Coverage
// FFIEC: Appendix I — BSA/AML Compliance Program Structures
// CFR:   31 CFR 1020.210 (recordkeeping)
// ═══════════════════════════════════════════════════════════════════════════
async function checkAuditTrailCoverage(db, config) {
  const checkId        = 'AUDIT_TRAIL_COVERAGE';
  const checkName      = 'Audit Trail Coverage';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Appendix I: BSA/AML Compliance Program Structures';
  const cfrReference   = '31 CFR 1020.210';

  const lookbackDays = Math.max(1, Number(config.lookbackDays) || 365);

  const filedSars = (await db.query(
    `SELECT sf.sar_id,
            BOOL_OR(at.action ILIKE '%approve%' OR at.action ILIKE '%file%') AS has_approval_event,
            COUNT(at.*)::int AS audit_rows
       FROM sar_filings sf
       LEFT JOIN audit_trail at
         ON at.sar_id = sf.sar_id
        AND at.entity_type = 'sar'
      WHERE sf.filed_date IS NOT NULL
        AND NULLIF(sf.filed_date, '')::date
            >= (CURRENT_DATE - ($1 || ' days')::interval)::date
      GROUP BY sf.sar_id`,
    [String(lookbackDays)]
  )).rows;

  const escalatedOrClosedAlerts = (await db.query(
    `SELECT a.alert_id, COUNT(at.*)::int AS audit_rows
       FROM alerts a
       LEFT JOIN audit_trail at
         ON at.sar_id = a.alert_id
        AND at.entity_type = 'alert'
      WHERE (a.alert_status IN ('Escalated - L2','Escalated - SAR','Completed','Closed','Closed — False Positive','False Positive')
        OR a.closed_date IS NOT NULL)
        AND NULLIF(a.last_activity_date, '')::date
            >= (CURRENT_DATE - ($1 || ' days')::interval)::date
      GROUP BY a.alert_id`,
    [String(lookbackDays)]
  )).rows;

  const completedKyc = (await db.query(
    `SELECT r.id, COUNT(at.*)::int AS audit_rows
       FROM kyc_reviews r
       LEFT JOIN audit_trail at
         ON at.sar_id = r.id::text
        AND at.entity_type = 'kyc_review'
      WHERE r.status = 'completed'
        AND NULLIF(r.completed_at, '')::timestamp
            >= NOW() - ($1 || ' days')::interval
      GROUP BY r.id`,
    [String(lookbackDays)]
  )).rows;

  const failures = [];
  for (const s of filedSars) {
    if (s.audit_rows === 0 || !s.has_approval_event) {
      failures.push({
        recordId: s.sar_id,
        recordType: 'sar_filing',
        detailText: `Filed SAR ${s.sar_id} is missing the approval/file audit event (audit rows: ${s.audit_rows}). Regulatory record is incomplete.`,
        severity: 'high'
      });
    }
  }
  for (const a of escalatedOrClosedAlerts) {
    if (a.audit_rows === 0) {
      failures.push({
        recordId: a.alert_id,
        recordType: 'alert',
        detailText: `Alert ${a.alert_id} (escalated or closed) has no audit trail rows.`,
        severity: 'medium'
      });
    }
  }
  for (const k of completedKyc) {
    if (k.audit_rows === 0) {
      failures.push({
        recordId: String(k.id),
        recordType: 'kyc_review',
        detailText: `KYC review #${k.id} (completed) has no audit trail rows.`,
        severity: 'medium'
      });
    }
  }

  const totalChecked = filedSars.length + escalatedOrClosedAlerts.length + completedKyc.length;
  if (totalChecked < 5) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${totalChecked} record(s) in scope across SARs/alerts/KYC reviews — sample is too small to be meaningful.`);
  }

  const sampleFailed = failures.length;
  const samplePassed = totalChecked - sampleFailed;
  const failureRate  = Math.round((sampleFailed / totalChecked) * 10000) / 100;
  const sarFailure   = failures.some(f => f.recordType === 'sar_filing');
  const status       = statusFromFailureRate(failureRate, sarFailure);
  const score        = sarFailure ? Math.min(scoreFromFailureRate(failureRate), 49)
                                  : scoreFromFailureRate(failureRate);

  const remediationItems = [];
  if (sarFailure) {
    remediationItems.push({
      priority: 'high',
      action: 'Investigate every filed SAR missing an approval audit event. Reconstruct the approval timeline from sar_approval_log and write the missing audit rows.',
      ownerRole: 'bsa_officer'
    });
  }
  if (sampleFailed > 0) {
    remediationItems.push({
      priority: 'medium',
      action: 'Audit every workflow handler that mutates SAR / alert / KYC state. Add or verify logAudit() calls. Run the coverage check again after deployment.',
      ownerRole: 'compliance_manager'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: totalChecked,
    samplePassed,
    sampleFailed,
    failureRate,
    findingSummary: `${sampleFailed} of ${totalChecked} workflow events lack a corresponding audit_trail entry. NOTE: Audit trail tamper-resistance (hash-chaining) is pending remediation per B-8. This check verifies coverage only, not tamper-evidence.`,
    findingDetail: withOverflowNote(failures, failures.length),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 6 — False Positive Rate Trend
// FFIEC: Transaction Monitoring Systems
// CFR:   adequate monitoring programme standard
// ═══════════════════════════════════════════════════════════════════════════
async function checkFalsePositiveRateTrend(db, config) {
  const checkId        = 'FALSE_POSITIVE_TREND';
  const checkName      = 'False Positive Rate Trend';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Transaction Monitoring Systems';
  const cfrReference   = 'Implicit: adequate monitoring programme standard';

  const lookbackDays = Math.max(1, Number(config.lookbackDays) || 180);
  const months = Math.min(12, Math.max(1, Math.ceil(lookbackDays / 30)));

  const rows = (await db.query(
    `WITH months AS (
       SELECT to_char(date_trunc('month', d), 'YYYY-MM') AS month_key,
              date_trunc('month', d) AS month_start
         FROM generate_series(
           (CURRENT_DATE - ($1 || ' months')::interval)::date,
           CURRENT_DATE,
           '1 month'::interval
         ) d
     )
     SELECT m.month_key,
            COALESCE(stat.total_closed, 0)::int AS total_closed,
            COALESCE(stat.fp_count, 0)::int     AS fp_count
       FROM months m
       LEFT JOIN (
         SELECT to_char(date_trunc('month', NULLIF(closed_date, '')::date), 'YYYY-MM') AS mk,
                COUNT(*) FILTER (
                  WHERE alert_status IN ('Completed','Closed','Closed — False Positive','False Positive')
                )::int AS total_closed,
                COUNT(*) FILTER (
                  WHERE (disposition ILIKE '%false positive%'
                         OR alert_status IN ('Closed — False Positive','False Positive'))
                )::int AS fp_count
           FROM alerts
          WHERE NULLIF(closed_date, '') IS NOT NULL
            AND NULLIF(closed_date, '')::date
                >= (CURRENT_DATE - ($1 || ' months')::interval)::date
          GROUP BY mk
       ) stat ON stat.mk = m.month_key
      ORDER BY m.month_key ASC`,
    [String(months)]
  )).rows;

  const monthsWithData = rows.filter(r => Number(r.total_closed) > 0);
  if (monthsWithData.length < 2) {
    return makeSkipped(checkId, checkName, ffiecReference, cfrReference,
      `Only ${monthsWithData.length} month(s) of disposition data — trend is not yet meaningful.`);
  }

  const monthly = monthsWithData.map(r => ({
    month: r.month_key,
    total_closed: Number(r.total_closed),
    fp_count: Number(r.fp_count),
    fp_rate: Number(r.total_closed) > 0
      ? Math.round((Number(r.fp_count) / Number(r.total_closed)) * 10000) / 100
      : 0
  }));
  const avgRate = Math.round(
    (monthly.reduce((s, m) => s + m.fp_rate, 0) / monthly.length) * 100
  ) / 100;
  const latest = monthly[monthly.length - 1];
  const delta = Math.round((latest.fp_rate - avgRate) * 100) / 100;
  const trend = delta > 3 ? 'rising' : delta < -3 ? 'falling' : 'stable';

  let status, score;
  if (latest.fp_rate > 97 || (trend === 'rising' && latest.fp_rate > 95)) {
    status = 'fail';
    score = Math.max(0, 49 - Math.round(latest.fp_rate - 95));
  } else if (latest.fp_rate > 90 || trend === 'rising') {
    status = 'concern';
    score = clamp(84 - Math.round(latest.fp_rate - 85), 50, 84);
  } else {
    status = 'pass';
    score = clamp(100 - Math.round(latest.fp_rate / 2), 85, 100);
  }

  const remediationItems = [];
  if (latest.fp_rate > 95) {
    remediationItems.push({
      priority: 'high',
      action: 'Recalibrate transaction monitoring scenarios. Review the scoring.weight_sla / scenario thresholds — the rule set may be too broad for the current customer population.',
      ownerRole: 'compliance_manager'
    });
  }
  if (trend === 'rising') {
    remediationItems.push({
      priority: 'medium',
      action: 'Investigate which scenarios contributed to the rise in false positives this month. Adjust thresholds where the rule is the cause; document where customer-population drift is the cause.',
      ownerRole: 'bsa_officer'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: monthly.reduce((s, m) => s + m.total_closed, 0),
    samplePassed: null,
    sampleFailed: null,
    failureRate: latest.fp_rate,
    findingSummary: `False positive rate for the most recent month: ${latest.fp_rate.toFixed(2)}% (${monthly.length}-month average: ${avgRate.toFixed(2)}%). Trend: ${trend}${delta >= 0 ? ` (+${delta.toFixed(2)}pp)` : ` (${delta.toFixed(2)}pp)`}. ${
      latest.fp_rate > 95 ? 'This may indicate the transaction monitoring model is not calibrated for the current customer population.' : ''
    }`.trim(),
    findingDetail: monthly.map(m => ({
      recordId: m.month,
      recordType: 'monthly_fp_rate',
      detailText: `${m.month}: ${m.fp_count} FP / ${m.total_closed} closed = ${m.fp_rate.toFixed(2)}%`,
      severity: m.fp_rate > 95 ? 'high' : m.fp_rate > 90 ? 'medium' : 'low',
      // Frontend reads these structured fields for the trend chart.
      month: m.month,
      total_closed: m.total_closed,
      fp_count: m.fp_count,
      fp_rate: m.fp_rate
    })),
    remediationItems
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 7 — SAR Retention Compliance
// FFIEC: Core Examination Procedures for Recordkeeping and Reporting
// CFR:   31 CFR 1020.320(d)
// ═══════════════════════════════════════════════════════════════════════════
async function checkSarRetentionCompliance(db, config) {
  const checkId        = 'SAR_RETENTION_COMPLIANCE';
  const checkName      = 'SAR Retention Compliance';
  const ffiecReference = 'FFIEC BSA/AML Examination Manual — Core Examination Procedures for Recordkeeping and Reporting';
  const cfrReference   = '31 CFR 1020.320(d)';

  const lookbackDays = Math.max(1, Number(config.lookbackDays) || 365);

  // Past-retention SARs still in the active dataset.
  const pastRetention = (await db.query(
    `SELECT sar_id, filed_date, retention_expiry_date, retention_status,
            law_enforcement_hold
       FROM sar_filings
      WHERE NULLIF(filed_date, '') IS NOT NULL
        AND (
          (
            NULLIF(retention_expiry_date, '') IS NOT NULL
            AND NULLIF(retention_expiry_date, '')::date < CURRENT_DATE
          )
          OR (
            NULLIF(retention_expiry_date, '') IS NULL
            AND NULLIF(filed_date, '')::date < (CURRENT_DATE - INTERVAL '5 years')
          )
        )`
  )).rows;

  // Retrieval-log coverage — retrievals missing attribution.
  const missingActor = (await db.query(
    `SELECT id, sar_id, requested_by, requested_at
       FROM retrieval_log
      WHERE NULLIF(requested_at, '')::timestamp
            >= NOW() - ($1 || ' days')::interval
        AND (requested_by IS NULL OR TRIM(requested_by) = '' OR requested_by = 'system')`,
    [String(lookbackDays)]
  )).rows;

  // Legal hold without a documented reason. The current schema only carries
  // law_enforcement_hold (INTEGER) — no reason field. We treat hold=1 as
  // documented when the SAR has any retention_status text; otherwise it's
  // a concern-level note. Once a dedicated reason column ships (M-10 in
  // the audit plan), this check can become stricter.
  const holdNoReason = (await db.query(
    `SELECT sar_id, retention_status
       FROM sar_filings
      WHERE law_enforcement_hold = 1
        AND (retention_status IS NULL OR TRIM(retention_status) = '')`
  )).rows;

  const failures = [];
  for (const sar of pastRetention) {
    const onHold = Number(sar.law_enforcement_hold) === 1;
    failures.push({
      recordId: sar.sar_id,
      recordType: 'sar_filing',
      detailText: `SAR ${sar.sar_id} past retention expiry (${sar.retention_expiry_date || 'filed_date + 5y'})${onHold ? ' — flagged for legal hold' : ''}. No documented disposition.`,
      severity: onHold ? 'medium' : 'high'
    });
  }
  for (const r of missingActor) {
    failures.push({
      recordId: String(r.id),
      recordType: 'retrieval_log',
      detailText: `Retrieval log #${r.id} for SAR ${r.sar_id} at ${r.requested_at} has no attributed actor.`,
      severity: 'medium'
    });
  }
  for (const h of holdNoReason) {
    failures.push({
      recordId: h.sar_id,
      recordType: 'sar_filing',
      detailText: `SAR ${h.sar_id} marked for legal hold but no retention_status / reason documented.`,
      severity: 'low'
    });
  }

  const totalChecked = pastRetention.length + missingActor.length + holdNoReason.length;
  const baseScope = Math.max(1, totalChecked);
  const sampleFailed = pastRetention.length + missingActor.length;
  const failureRate = Math.round((sampleFailed / Math.max(1, baseScope)) * 10000) / 100;
  const hasMaxSeverity = pastRetention.some(s => Number(s.law_enforcement_hold) !== 1);
  let status, score;
  if (sampleFailed === 0 && holdNoReason.length === 0) {
    status = 'pass';
    score = 100;
  } else if (hasMaxSeverity) {
    status = 'fail';
    score = Math.min(49, scoreFromFailureRate(failureRate));
  } else if (failures.length > 0) {
    status = 'concern';
    score = clamp(70, 50, 84);
  } else {
    status = 'pass';
    score = 100;
  }

  const remediationItems = [];
  if (pastRetention.length > 0) {
    remediationItems.push({
      priority: 'high',
      action: 'Review each past-retention SAR. Either document a disposition (purge, archive, or extended retention with reason) or place under legal hold.',
      ownerRole: 'bsa_officer'
    });
  }
  if (missingActor.length > 0) {
    remediationItems.push({
      priority: 'medium',
      action: 'Audit the retrieval log entry paths. Ensure every export records a non-system requesting user.',
      ownerRole: 'compliance_manager'
    });
  }
  if (holdNoReason.length > 0) {
    remediationItems.push({
      priority: 'low',
      action: 'Document the legal-hold reason for each affected SAR. Track via the BSA Officer regulatory correspondence file.',
      ownerRole: 'bsa_officer'
    });
  }

  return {
    checkId, checkName, ffiecReference, cfrReference,
    status, score,
    sampleSize: totalChecked || 0,
    samplePassed: Math.max(0, totalChecked - failures.length),
    sampleFailed: failures.length,
    failureRate,
    findingSummary: failures.length === 0
      ? 'No retention violations. All retrieval-log entries are properly attributed.'
      : `${pastRetention.length} past-retention SAR(s), ${missingActor.length} retrieval log entry/entries missing actor, ${holdNoReason.length} legal hold(s) without reason.`,
    findingDetail: withOverflowNote(failures, failures.length),
    remediationItems
  };
}

// ── Composite scoring ─────────────────────────────────────────────────────

const CHECK_WEIGHTS = Object.freeze({
  SAR_TIMELINESS:           0.25,
  CDD_COMPLETENESS:         0.20,
  KYC_REVIEW_TIMELINESS:    0.15,
  OFAC_SCREENING_COVERAGE:  0.15,
  AUDIT_TRAIL_COVERAGE:     0.15,
  FALSE_POSITIVE_TREND:     0.05,
  SAR_RETENTION_COMPLIANCE: 0.05
});

// Returns { overallScore, overallStatus, counts } where counts is
// { run, passed, concern, failed, skipped }.
function computeRunSummary(findings) {
  const counts = { run: findings.length, passed: 0, concern: 0, failed: 0, skipped: 0 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const f of findings) {
    if (f.status === 'skipped') { counts.skipped++; continue; }
    if (f.status === 'pass')    counts.passed++;
    if (f.status === 'concern') counts.concern++;
    if (f.status === 'fail')    counts.failed++;
    const w = CHECK_WEIGHTS[f.checkId];
    if (w == null) continue;
    weightedSum += (Number(f.score) || 0) * w;
    weightTotal += w;
  }
  const overallScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
  const overallStatus = counts.failed > 0 ? 'fail'
                      : counts.concern > 0 ? 'concern'
                      : 'pass';
  return { overallScore, overallStatus, counts };
}

// Registry — used by the route handler to drive each enabled check.
const CHECK_REGISTRY = Object.freeze({
  SAR_TIMELINESS:           checkSarTimeliness,
  CDD_COMPLETENESS:         checkCddCompleteness,
  KYC_REVIEW_TIMELINESS:    checkKycReviewTimeliness,
  OFAC_SCREENING_COVERAGE:  checkOfacScreeningCoverage,
  AUDIT_TRAIL_COVERAGE:     checkAuditTrailCoverage,
  FALSE_POSITIVE_TREND:     checkFalsePositiveRateTrend,
  SAR_RETENTION_COMPLIANCE: checkSarRetentionCompliance
});

module.exports = {
  // Check functions.
  checkSarTimeliness,
  checkCddCompleteness,
  checkKycReviewTimeliness,
  checkOfacScreeningCoverage,
  checkAuditTrailCoverage,
  checkFalsePositiveRateTrend,
  checkSarRetentionCompliance,
  // Registry + composite scoring.
  CHECK_REGISTRY,
  CHECK_WEIGHTS,
  computeRunSummary,
  // Constants (test reuse).
  MAX_DETAIL_ITEMS
};
