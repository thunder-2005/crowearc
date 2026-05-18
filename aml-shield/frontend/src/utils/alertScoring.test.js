// ═══════════════════════════════════════════════════════════════════════════
// C-05 composite-scoring unit tests.
//
// Pure-function tests on alertScoring.js — no React, no DOM, no network.
// Run with `npm test` (vitest) inside aml-shield/frontend.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeTimeUrgencyScore,
  computeRiskScore,
  computeCompositeScore,
  rankAlerts,
  getNextUpAlert,
  DEFAULT_SCORING_WEIGHTS
} from './alertScoring.js';

// Build a minimally-valid actionable alert. Tests override only the fields
// they care about.
function mkAlert(overrides = {}) {
  return {
    alert_id: 'A-1',
    customer_id: 'C-1',
    customer_name: 'Acme',
    alert_status: 'Not Started',
    assigned_to: 'Henry Morgan',
    priority: 'Medium',
    customer_risk_rating: 'Medium',
    pep_match: 0,
    sanctions_match: 0,
    days_remaining: 20,
    sla_tier: 'normal',
    closed_date: null,
    disposition: null,
    linked_sar_id: null,
    ...overrides
  };
}

describe('computeTimeUrgencyScore', () => {
  it('30 days remaining → 0.0', () => {
    expect(computeTimeUrgencyScore(mkAlert({ days_remaining: 30 }))).toBe(0);
  });
  it('0 days remaining → ~0.857', () => {
    const v = computeTimeUrgencyScore(mkAlert({ days_remaining: 0 }));
    expect(v).toBeCloseTo(30 / 35, 5);
  });
  it('-5 days (breached 5d) → 1.0', () => {
    expect(computeTimeUrgencyScore(mkAlert({ days_remaining: -5 }))).toBe(1);
  });
  it('-100 days clamps to 1.0 (no overshoot)', () => {
    expect(computeTimeUrgencyScore(mkAlert({ days_remaining: -100 }))).toBe(1);
  });
});

describe('computeRiskScore', () => {
  it('Very High maps to 1.0 by itself', () => {
    expect(computeRiskScore(mkAlert({ customer_risk_rating: 'Very High' }))).toBe(1.0);
  });
  it('Low + PEP + sanctions caps at 1.0 (no overflow)', () => {
    const v = computeRiskScore(mkAlert({ customer_risk_rating: 'Low', pep_match: 1, sanctions_match: 1 }));
    expect(v).toBe(Math.min(1.0, 0.25 + 0.15 + 0.25));
    expect(v).toBe(0.65);
  });
});

describe('computeCompositeScore — weight invariants', () => {
  it('weight sla=1.0 reduces to time-urgency component', () => {
    const a = mkAlert({ days_remaining: 10, customer_risk_rating: 'Very High' });
    expect(computeCompositeScore(a, { sla: 1.0, risk: 0.0 })).toBe(computeTimeUrgencyScore(a));
  });
  it('weight sla=0.0 reduces to risk component', () => {
    const a = mkAlert({ days_remaining: 2, customer_risk_rating: 'Low' });
    expect(computeCompositeScore(a, { sla: 0.0, risk: 1.0 })).toBe(computeRiskScore(a));
  });
});

describe('rankAlerts — ordering invariants', () => {
  it('critical SLA beats Very High risk with normal SLA (default weights)', () => {
    const aNormalVeryHigh = mkAlert({
      alert_id: 'A',
      customer_id: 'CA',
      customer_risk_rating: 'Very High',
      days_remaining: 20,
      sla_tier: 'normal'
    });
    const bCriticalHigh = mkAlert({
      alert_id: 'B',
      customer_id: 'CB',
      customer_risk_rating: 'High',
      days_remaining: 3,
      sla_tier: 'critical'
    });
    const ranked = rankAlerts([aNormalVeryHigh, bCriticalHigh], DEFAULT_SCORING_WEIGHTS);
    expect(ranked[0].alert_id).toBe('B');
  });

  it('with 50/50 weights and equal SLA, Very High beats High', () => {
    const a = mkAlert({
      alert_id: 'A',
      customer_id: 'CA',
      customer_risk_rating: 'Very High',
      days_remaining: 15,
      sla_tier: 'normal'
    });
    const b = mkAlert({
      alert_id: 'B',
      customer_id: 'CB',
      customer_risk_rating: 'High',
      days_remaining: 15,
      sla_tier: 'normal'
    });
    const ranked = rankAlerts([a, b], { sla: 0.5, risk: 0.5 });
    expect(ranked[0].alert_id).toBe('A');
  });

  it('breached SLA always outranks critical-tier (default weights)', () => {
    const aCriticalVeryHigh = mkAlert({
      alert_id: 'A',
      customer_id: 'CA',
      customer_risk_rating: 'Very High',
      days_remaining: 2,
      sla_tier: 'critical'
    });
    const bBreachedLow = mkAlert({
      alert_id: 'B',
      customer_id: 'CB',
      customer_risk_rating: 'Low',
      days_remaining: -3,
      sla_tier: 'breached'
    });
    const ranked = rankAlerts([aCriticalVeryHigh, bBreachedLow], DEFAULT_SCORING_WEIGHTS);
    expect(ranked[0].alert_id).toBe('B');
  });
});

describe('getNextUpAlert — sessionClaimedCustomerIds + null cases', () => {
  it('respects sessionResolvedCustomerIds — returns the unclaimed twin', () => {
    const claimed = mkAlert({
      alert_id: 'A',
      customer_id: 'CA',
      customer_risk_rating: 'High',
      days_remaining: 5,
      sla_tier: 'critical'
    });
    const unclaimed = mkAlert({
      alert_id: 'B',
      customer_id: 'CB',
      customer_risk_rating: 'High',
      days_remaining: 5,
      sla_tier: 'critical'
    });
    const result = getNextUpAlert([claimed, unclaimed], null, 'Henry Morgan', {
      sessionResolvedCustomerIds: new Set(['CA']),
      weights: DEFAULT_SCORING_WEIGHTS
    });
    expect(result?.alert_id).toBe('B');
  });

  it('returns null when every alert is claimed or non-actionable', () => {
    const closed = mkAlert({ alert_id: 'A', customer_id: 'CA', alert_status: 'Closed' });
    const claimed = mkAlert({ alert_id: 'B', customer_id: 'CB' });
    const result = getNextUpAlert([closed, claimed], null, 'Henry Morgan', {
      sessionResolvedCustomerIds: new Set(['CB']),
      weights: DEFAULT_SCORING_WEIGHTS
    });
    expect(result).toBeNull();
  });
});
