// ═══════════════════════════════════════════════════════════════════════════
// Unit tests for utils/examChecks.js — C-11.
//
// Every test uses a hand-mocked DB client (single `query` method); no real
// Postgres is touched.
// ═══════════════════════════════════════════════════════════════════════════

const {
  checkSarTimeliness,
  checkCddCompleteness,
  checkOfacScreeningCoverage,
  checkFalsePositiveRateTrend,
  computeRunSummary,
  CHECK_WEIGHTS
} = require('./examChecks');

// Mock DB client. Routes queries by SQL fragment to a programmed response.
function mockDb(routes) {
  return {
    query: jest.fn(async (sql /*, params */) => {
      for (const entry of routes) {
        if (entry.match.test(sql)) {
          return typeof entry.result === 'function'
            ? entry.result(sql)
            : entry.result;
        }
      }
      return { rows: [] };
    })
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. checkSarTimeliness — all on time
// ═══════════════════════════════════════════════════════════════════════════
test('SAR_TIMELINESS — all on time', async () => {
  const sars = [];
  for (let i = 0; i < 25; i++) {
    const detect = daysAgo(60);
    // Filed 28 days after detection — within limit.
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: `SAR-${i}`, customer_name: 'Acme Co', detection_date: detect, filed_date: filed, created_at: detect, subject_data: null });
  }
  const db = mockDb([
    { match: /FROM sar_filings/i, result: { rows: sars } }
  ]);
  const result = await checkSarTimeliness(db, { sarSampleSize: 25, sarTimelinessDays: 30, lookbackDays: 365 });
  expect(result.status).toBe('pass');
  expect(result.sampleFailed).toBe(0);
  expect(result.failureRate).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. checkSarTimeliness — 3 late out of 25 (12% → concern)
// ═══════════════════════════════════════════════════════════════════════════
test('SAR_TIMELINESS — 3 late of 25', async () => {
  const sars = [];
  for (let i = 0; i < 22; i++) {
    const detect = daysAgo(60);
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: `SAR-OK-${i}`, customer_name: 'Acme', detection_date: detect, filed_date: filed, created_at: detect, subject_data: null });
  }
  for (let i = 0; i < 3; i++) {
    const detect = daysAgo(60);
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 35); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: `SAR-LATE-${i}`, customer_name: 'Beta LLC', detection_date: detect, filed_date: filed, created_at: detect, subject_data: null });
  }
  const db = mockDb([{ match: /FROM sar_filings/i, result: { rows: sars } }]);
  const result = await checkSarTimeliness(db, { sarSampleSize: 25, sarTimelinessDays: 30, lookbackDays: 365 });
  expect(result.status).toBe('concern');
  expect(result.sampleFailed).toBe(3);
  expect(result.findingDetail.length).toBe(3);
  for (const d of result.findingDetail) {
    expect(d.detailText).toMatch(/days after detection/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. checkSarTimeliness — unknown-subject 60-day extension
// ═══════════════════════════════════════════════════════════════════════════
test('SAR_TIMELINESS — unknown-subject 60-day extension', async () => {
  const sars = [];
  // Padding to clear the minimum-sample-size gate (>= 5).
  for (let i = 0; i < 5; i++) {
    const detect = daysAgo(60);
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 25); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: `PAD-${i}`, customer_name: 'Pad', detection_date: detect, filed_date: filed, created_at: detect, subject_data: null });
  }
  // Day 55, unknown subject — must NOT fail (within 60 day extension).
  {
    const detect = daysAgo(90);
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 55); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: 'SAR-UNK-OK', customer_name: 'X', detection_date: detect, filed_date: filed, created_at: detect, subject_data: JSON.stringify({ subject_unknown: true }) });
  }
  // Day 62, unknown subject — must fail (> 60 day extension).
  {
    const detect = daysAgo(90);
    const filed = (() => { const d = new Date(detect); d.setDate(d.getDate() + 62); return d.toISOString().slice(0, 10); })();
    sars.push({ sar_id: 'SAR-UNK-LATE', customer_name: 'X', detection_date: detect, filed_date: filed, created_at: detect, subject_data: JSON.stringify({ subject_unknown: true }) });
  }
  const db = mockDb([{ match: /FROM sar_filings/i, result: { rows: sars } }]);
  const result = await checkSarTimeliness(db, { sarSampleSize: 50, sarTimelinessDays: 30, lookbackDays: 365 });
  // Exactly one failure: the 62-day unknown-subject one.
  expect(result.sampleFailed).toBe(1);
  const failed = result.findingDetail.find(d => d.recordId === 'SAR-UNK-LATE');
  expect(failed).toBeTruthy();
  expect(result.findingDetail.find(d => d.recordId === 'SAR-UNK-OK')).toBeFalsy();
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. checkCddCompleteness — missing ownership prong + B-10 caveat note
// ═══════════════════════════════════════════════════════════════════════════
test('CDD_COMPLETENESS — missing ownership prong + B-10 note', async () => {
  const customers = [];
  // 3 with empty owners and a legal-entity type (auto-fail the prong).
  for (let i = 0; i < 3; i++) {
    customers.push({
      customer_id: `C-EMPTY-${i}`, customer_name: 'EmptyCo',
      customer_type: 'LLC', cdd_level: 'EDD',
      customer_risk_rating: 'High',
      beneficial_owners: '[]',
      last_kyc_review_date: daysAgo(30),
      exit_status: null,
      customer_since_date: daysAgo(90)
    });
  }
  // 5 individuals with no owners required (control prong N/A).
  for (let i = 0; i < 5; i++) {
    customers.push({
      customer_id: `C-IND-${i}`, customer_name: 'Individual',
      customer_type: 'individual', cdd_level: 'SDD',
      customer_risk_rating: 'Low',
      beneficial_owners: null,
      last_kyc_review_date: daysAgo(30),
      exit_status: null,
      customer_since_date: daysAgo(90)
    });
  }
  const db = mockDb([{ match: /FROM customers/i, result: { rows: customers } }]);
  const result = await checkCddCompleteness(db, { cddSampleSize: 50, lookbackDays: 365 });
  expect(result.sampleFailed).toBeGreaterThanOrEqual(3);
  expect(result.findingSummary).toMatch(/B-10/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. checkOfacScreeningCoverage — stale SDN list overrides pass
// ═══════════════════════════════════════════════════════════════════════════
test('OFAC_SCREENING_COVERAGE — stale SDN list overrides pass', async () => {
  const db = {
    query: jest.fn(async (sql) => {
      if (/COUNT\(\*\)::int AS c FROM customers/i.test(sql)) {
        return { rows: [{ c: 100 }] };
      }
      if (/LEFT JOIN ofac_screening_results/i.test(sql)) {
        return { rows: [] }; // every customer has a recent screening
      }
      if (/FROM ofac_sync_runs/i.test(sql)) {
        const thirtyHoursAgo = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
        return { rows: [{ completed_at: thirtyHoursAgo }] };
      }
      return { rows: [] };
    })
  };
  const result = await checkOfacScreeningCoverage(db, { ofacScreeningStaleness: 365 });
  expect(result.status).toBe('concern');
  expect(result.findingDetail.some(d => d.recordType === 'sdn_sync_status')).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. checkFalsePositiveRateTrend — rising trend triggers concern
// ═══════════════════════════════════════════════════════════════════════════
test('FALSE_POSITIVE_TREND — rising trend triggers concern', async () => {
  // 5 months at 88% + 1 month at 94%.
  const rows = [
    { month_key: '2024-12', total_closed: 100, fp_count: 88 },
    { month_key: '2025-01', total_closed: 100, fp_count: 88 },
    { month_key: '2025-02', total_closed: 100, fp_count: 88 },
    { month_key: '2025-03', total_closed: 100, fp_count: 88 },
    { month_key: '2025-04', total_closed: 100, fp_count: 88 },
    { month_key: '2025-05', total_closed: 100, fp_count: 94 }
  ];
  const db = mockDb([{ match: /WITH months AS/i, result: { rows } }]);
  const result = await checkFalsePositiveRateTrend(db, { lookbackDays: 180 });
  expect(result.status).toBe('concern');
  expect(result.findingSummary).toMatch(/88\.00%|88\.00%|89\.00%/); // contains numeric rates
  expect(result.findingSummary).toMatch(/94\.00%/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. checkFalsePositiveRateTrend — insufficient data → skipped
// ═══════════════════════════════════════════════════════════════════════════
test('FALSE_POSITIVE_TREND — insufficient data → skipped', async () => {
  const rows = [{ month_key: '2025-05', total_closed: 100, fp_count: 90 }];
  const db = mockDb([{ match: /WITH months AS/i, result: { rows } }]);
  const result = await checkFalsePositiveRateTrend(db, { lookbackDays: 180 });
  expect(result.status).toBe('skipped');
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Composite overall_score weighting
// ═══════════════════════════════════════════════════════════════════════════
test('computeRunSummary — weighted average matches the hardcoded weights', () => {
  const findings = [
    { checkId: 'SAR_TIMELINESS',           status: 'pass',    score: 90 },
    { checkId: 'CDD_COMPLETENESS',         status: 'concern', score: 60 },
    { checkId: 'KYC_REVIEW_TIMELINESS',    status: 'pass',    score: 100 },
    { checkId: 'OFAC_SCREENING_COVERAGE',  status: 'pass',    score: 100 },
    { checkId: 'AUDIT_TRAIL_COVERAGE',     status: 'pass',    score: 100 },
    { checkId: 'FALSE_POSITIVE_TREND',     status: 'pass',    score: 100 },
    { checkId: 'SAR_RETENTION_COMPLIANCE', status: 'pass',    score: 100 }
  ];
  const { overallScore, overallStatus, counts } = computeRunSummary(findings);
  // Manual: 90*0.25 + 60*0.20 + 100*(0.15+0.15+0.15+0.05+0.05)
  //       = 22.5 + 12 + 55 = 89.5 → rounded = 90
  expect(overallScore).toBe(90);
  expect(overallStatus).toBe('concern');
  expect(counts.passed).toBe(6);
  expect(counts.concern).toBe(1);
  expect(counts.failed).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. overall_status fails when any check fails
// ═══════════════════════════════════════════════════════════════════════════
test('computeRunSummary — single failure forces overall fail', () => {
  const findings = [
    { checkId: 'SAR_TIMELINESS', status: 'fail', score: 30 },
    { checkId: 'CDD_COMPLETENESS', status: 'pass', score: 100 },
    { checkId: 'KYC_REVIEW_TIMELINESS', status: 'pass', score: 100 },
    { checkId: 'OFAC_SCREENING_COVERAGE', status: 'pass', score: 100 },
    { checkId: 'AUDIT_TRAIL_COVERAGE', status: 'pass', score: 100 }
  ];
  const { overallStatus } = computeRunSummary(findings);
  expect(overallStatus).toBe('fail');
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Skipped checks excluded from the weighted average denominator
// ═══════════════════════════════════════════════════════════════════════════
test('computeRunSummary — skipped checks are excluded', () => {
  const findings = [
    { checkId: 'SAR_TIMELINESS',           status: 'skipped', score: null },
    { checkId: 'CDD_COMPLETENESS',         status: 'pass',    score: 100 },
    { checkId: 'KYC_REVIEW_TIMELINESS',    status: 'pass',    score: 100 },
    { checkId: 'OFAC_SCREENING_COVERAGE',  status: 'pass',    score: 100 },
    { checkId: 'AUDIT_TRAIL_COVERAGE',     status: 'pass',    score: 100 },
    { checkId: 'FALSE_POSITIVE_TREND',     status: 'pass',    score: 100 },
    { checkId: 'SAR_RETENTION_COMPLIANCE', status: 'pass',    score: 100 }
  ];
  const { overallScore, overallStatus, counts } = computeRunSummary(findings);
  expect(overallScore).toBe(100);
  expect(overallStatus).toBe('pass');
  expect(counts.skipped).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. CHECK_WEIGHTS sum to ~1.0 (sanity check on the registry constants)
// ═══════════════════════════════════════════════════════════════════════════
test('CHECK_WEIGHTS sum to 1.0', () => {
  const sum = Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
});
