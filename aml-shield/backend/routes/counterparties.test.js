// ═══════════════════════════════════════════════════════════════════════════
// C-10 graph endpoint phase-detection tests + counterparty route auth tests.
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../database/db', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn(),
  on: jest.fn()
}));

jest.mock('../utils/audit', () => ({ logAudit: jest.fn(), ENTITY_TYPES: {} }));

const express = require('express');
const request = require('supertest');
const customersRouter = require('./customers');
const counterpartiesRouter = require('./counterparties');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/customers', customersRouter);
  a.use('/api/counterparties', counterpartiesRouter);
  a.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return a;
}

beforeEach(() => { mockQuery.mockReset(); });

// ─── Phase A: empty counterparties → graphPhase: 'normalised' ────────────
test("graphPhase is 'normalised' when counterparties is empty", async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT 1 FROM counterparties WHERE transaction_count > 0 LIMIT 1/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM customers WHERE customer_id = \$1/i.test(sql)) {
      return { rows: [{
        customer_id: 'C1', customer_name: 'Focus', customer_type: 'Individual',
        customer_risk_rating: 'Medium', pep_match: 0, sanctions_match: 0,
        country_of_residence: 'US', country_of_incorporation: null,
        customer_since_date: '2020-01-01', cdd_level: 'standard',
        job_title: null, industry: null
      }] };
    }
    if (/GROUP BY counterparty_normalised/i.test(sql)) {
      return { rows: [{
        normalised_name: 'first capital llc',
        display_name: 'First Capital LLC',
        txn_count: 5,
        alerted_txn_count: 0,
        total_amount: 1000,
        country: 'US',
        counterparty_id: null
      }] };
    }
    return { rows: [] };
  });

  const res = await request(app())
    .get('/api/customers/C1/graph')
    .set('x-user-role', 'analyst_l1');
  expect(res.status).toBe(200);
  expect(res.body.meta.graphPhase).toBe('normalised');
  // The cp- node id falls back to a hash of normalised_name (the literal
  // text) — assert at least one such node exists.
  const cpNode = res.body.nodes.find(n => typeof n.id === 'string' && n.id.startsWith('cp-'));
  expect(cpNode).toBeTruthy();
  expect(cpNode.counterparty_id).toBeNull();
});

// ─── Phase B: counterparties populated → graphPhase: 'entity_fk' ─────────
test("graphPhase is 'entity_fk' when counterparties has txn_count > 0 rows", async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT 1 FROM counterparties WHERE transaction_count > 0 LIMIT 1/i.test(sql)) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (/FROM customers WHERE customer_id = \$1/i.test(sql)) {
      return { rows: [{
        customer_id: 'C1', customer_name: 'Focus', customer_type: 'Individual',
        customer_risk_rating: 'Medium', pep_match: 0, sanctions_match: 0,
        country_of_residence: 'US', country_of_incorporation: null,
        customer_since_date: '2020-01-01', cdd_level: 'standard',
        job_title: null, industry: null
      }] };
    }
    // Phase B counterparty query
    if (/FROM transactions t\s+JOIN counterparties cp ON cp\.id = t\.counterparty_id/i.test(sql)) {
      return { rows: [{
        counterparty_id: 'cp-uuid-1',
        canonical_name: 'First Capital LLC',
        counterparty_type: 'business',
        risk_indicators: { pep: false, sanctions_hit: false, high_risk_jurisdiction: false },
        global_txn_count: 42,
        global_total_volume: 100000,
        txn_count: 12,
        alerted_txn_count: 0,
        total_amount: 30000,
        country: 'US',
        shared_with_customer_count: 4
      }] };
    }
    // Phase B neighbour query
    if (/JOIN transactions t2 ON t1\.counterparty_id = t2\.counterparty_id/i.test(sql)) {
      return { rows: [{
        customer_id: 'C2', customer_name: 'Other Co', customer_type: 'Business',
        customer_risk_rating: 'High', pep_match: 0, sanctions_match: 0,
        country_of_residence: 'US', country_of_incorporation: 'US',
        customer_since_date: '2019-01-01', cdd_level: 'EDD',
        job_title: null, industry: 'finance',
        via_counterparty: 'First Capital LLC',
        via_counterparty_id: 'cp-uuid-1'
      }] };
    }
    return { rows: [] };
  });

  const res = await request(app())
    .get('/api/customers/C1/graph')
    .set('x-user-role', 'compliance_manager');
  expect(res.status).toBe(200);
  expect(res.body.meta.graphPhase).toBe('entity_fk');

  // Counterparty node uses the canonical id and carries the new fields.
  const cpNode = res.body.nodes.find(n => n.id === 'cp-cp-uuid-1');
  expect(cpNode).toBeTruthy();
  expect(cpNode.counterparty_type).toBe('business');
  expect(cpNode.shared_with_customer_count).toBe(4);
  expect(cpNode.txn_count_with_focus).toBe(12);
  expect(cpNode.txn_count).toBe(42);

  // Neighbour customer C2 should be present and link through the same
  // canonical counterparty.
  const neighbour = res.body.nodes.find(n => n.id === 'c-C2');
  expect(neighbour).toBeTruthy();
});

// ─── shared_with_customer_count accuracy ─────────────────────────────────
test('shared_with_customer_count flows through to the counterparty node', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT 1 FROM counterparties WHERE transaction_count > 0 LIMIT 1/i.test(sql)) {
      return { rows: [{}], rowCount: 1 };
    }
    if (/FROM customers WHERE customer_id = \$1/i.test(sql)) {
      return { rows: [{
        customer_id: 'C1', customer_name: 'F', customer_type: 'Individual',
        customer_risk_rating: 'Low', pep_match: 0, sanctions_match: 0,
        country_of_residence: null, country_of_incorporation: null
      }] };
    }
    if (/JOIN counterparties cp ON cp\.id = t\.counterparty_id/i.test(sql)) {
      return { rows: [{
        counterparty_id: 'hub-1',
        canonical_name: 'Hub Co',
        counterparty_type: 'business',
        risk_indicators: {},
        global_txn_count: 20,
        global_total_volume: 50000,
        txn_count: 4,
        alerted_txn_count: 0,
        total_amount: 12000,
        country: null,
        shared_with_customer_count: 7   // 7 distinct customers
      }] };
    }
    return { rows: [] };
  });

  const res = await request(app())
    .get('/api/customers/C1/graph')
    .set('x-user-role', 'bsa_officer');
  const hub = res.body.nodes.find(n => n.id === 'cp-hub-1');
  expect(hub.shared_with_customer_count).toBe(7);
});

// ─── Counterparty merge endpoint — auth ──────────────────────────────────
test('POST /api/counterparties/merge — 403 for compliance_manager', async () => {
  const res = await request(app())
    .post('/api/counterparties/merge')
    .set('x-user-role', 'compliance_manager')
    .send({ sourceId: 'a', targetId: 'b' });
  expect(res.status).toBe(403);
});

test('POST /api/counterparties/resolve/:id — 403 for analyst_l2', async () => {
  const res = await request(app())
    .post('/api/counterparties/resolve/q1')
    .set('x-user-role', 'analyst_l2')
    .send({ targetCounterpartyId: 'cp-x' });
  expect(res.status).toBe(403);
});
