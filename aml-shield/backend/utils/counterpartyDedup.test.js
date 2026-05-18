// ═══════════════════════════════════════════════════════════════════════════
// C-10 — counterparty dedup pipeline unit tests.
//
// Mock DB; no real Postgres. Each test scripts the queries by SQL regex
// match, then asserts on what the pipeline wrote.
// ═══════════════════════════════════════════════════════════════════════════

const mockLogAudit = jest.fn();
jest.mock('./audit', () => ({ logAudit: (...args) => mockLogAudit(...args) }));

const {
  resolveQueue,
  resolveManually,
  mergeCounterparties,
  normalize
} = require('./counterpartyDedup');

function mockDb(initialState = {}) {
  const calls = [];
  // queue holds pending dedup rows: { id, normalised_name, account_number, transaction_count, raw_counterparty }
  // universe holds counterparties: { id, canonical_name, normalised_name, account_number, is_merged_away }
  const state = {
    queue: initialState.queue || [],
    universe: initialState.universe || [],
    transactions: initialState.transactions || [],
    queueUpdates: [],
    universeInserts: [],
    transactionLinks: [],
    dedupDecisions: []
  };

  const query = jest.fn(async (sql, params = []) => {
    calls.push({ sql, params });

    if (/SELECT id, raw_counterparty, normalised_name, account_number, transaction_count\s+FROM counterparty_dedup_queue/i.test(sql)) {
      return { rows: state.queue.filter(q => (q.resolution_status || 'pending') === 'pending'), rowCount: state.queue.length };
    }
    if (/SELECT id, canonical_name, normalised_name, account_number\s+FROM counterparties/i.test(sql)) {
      return { rows: state.universe.filter(c => !c.is_merged_away), rowCount: state.universe.length };
    }

    // queue updates (auto_resolved, needs_review, manually_resolved)
    if (/UPDATE counterparty_dedup_queue/i.test(sql)) {
      state.queueUpdates.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }

    if (/UPDATE transactions\s+SET counterparty_id = \$1\s+WHERE counterparty_normalised = \$2/i.test(sql)) {
      const [cpId, normalised] = params;
      const linkable = state.transactions.filter(t => t.counterparty_normalised === normalised && !t.counterparty_id);
      for (const t of linkable) { t.counterparty_id = cpId; }
      state.transactionLinks.push({ cpId, normalised, count: linkable.length });
      return { rowCount: linkable.length, rows: [] };
    }

    if (/UPDATE transactions SET counterparty_id = \$1 WHERE counterparty_id = \$2/i.test(sql)) {
      const [target, source] = params;
      const moved = state.transactions.filter(t => t.counterparty_id === source);
      for (const t of moved) { t.counterparty_id = target; }
      return { rowCount: moved.length, rows: [] };
    }

    if (/INSERT INTO counterparties/i.test(sql)) {
      const [canonical, normalised, type, accountNumber] = params;
      const newCp = {
        id: `cp-uuid-${state.universe.length + 1}`,
        canonical_name: canonical,
        normalised_name: normalised,
        counterparty_type: type,
        account_number: accountNumber,
        is_merged_away: false
      };
      state.universe.push(newCp);
      state.universeInserts.push(newCp);
      return { rows: [newCp], rowCount: 1 };
    }

    if (/INSERT INTO dedup_decisions/i.test(sql)) {
      state.dedupDecisions.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }

    if (/UPDATE counterparties\s+SET is_merged_away = TRUE/i.test(sql)) {
      const [targetId, sourceId] = params;
      const src = state.universe.find(c => c.id === sourceId);
      if (src) {
        src.is_merged_away = true;
        src.merged_into_id = targetId;
      }
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE counterparties\s+SET merge_source_ids = array_append/i.test(sql)) {
      const [sourceId, targetId] = params;
      const tgt = state.universe.find(c => c.id === targetId);
      if (tgt) {
        tgt.merge_source_ids = [...(tgt.merge_source_ids || []), sourceId];
      }
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE counterparty_dedup_queue\s+SET resolved_counterparty_id = \$1/i.test(sql)) {
      return { rowCount: 0, rows: [] };
    }
    if (/SELECT id, normalised_name FROM counterparty_dedup_queue WHERE id = \$1/i.test(sql)) {
      const [qid] = params;
      const q = state.queue.find(x => x.id === qid);
      return { rows: q ? [q] : [], rowCount: q ? 1 : 0 };
    }
    if (/SELECT id, canonical_name FROM counterparties\s+WHERE id = \$1 AND is_merged_away = FALSE/i.test(sql)) {
      const [cid] = params;
      const c = state.universe.find(x => x.id === cid && !x.is_merged_away);
      return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
    }
    if (/SELECT id, canonical_name FROM counterparties WHERE id = \$1/i.test(sql)) {
      const [cid] = params;
      const c = state.universe.find(x => x.id === cid);
      return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  return { query, state, calls };
}

beforeEach(() => { mockLogAudit.mockReset(); });

// ─── Test 1: Exact account number match ─────────────────────────────────
test('Tier 1 — exact account number match resolves to that counterparty', async () => {
  const db = mockDb({
    queue: [{
      id: 'q1',
      raw_counterparty: 'First Capital LLC',
      normalised_name: 'first capital llc',
      account_number: '123456789',
      transaction_count: 10
    }],
    universe: [{
      id: 'cp-A',
      canonical_name: 'First Capital LLC',
      normalised_name: 'first capital llc - different normalised somehow',
      account_number: '123456789',
      is_merged_away: false
    }],
    transactions: [
      { counterparty_normalised: 'first capital llc', counterparty_id: null }
    ]
  });

  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88, dryRun: false });
  expect(summary.autoResolved).toBe(1);
  expect(summary.transactionsLinked).toBe(1);
  // Queue updated to auto_resolved with exact_account method.
  const update = db.state.queueUpdates.find(u => /auto_resolved/.test(u.sql) && u.params.includes('exact_account'));
  expect(update).toBeTruthy();
  expect(update.params[0]).toBe('cp-A');
});

// ─── Test 2: Exact normalised name match ────────────────────────────────
test('Tier 2 — exact normalised name match', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'Acme', normalised_name: 'acme holdings', account_number: null, transaction_count: 4 }],
    universe: [{ id: 'cp-B', canonical_name: 'Acme Holdings', normalised_name: 'acme holdings', is_merged_away: false }],
    transactions: [{ counterparty_normalised: 'acme holdings', counterparty_id: null }]
  });
  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88 });
  expect(summary.autoResolved).toBe(1);
  const update = db.state.queueUpdates.find(u => /auto_resolved/.test(u.sql) && u.params.includes('exact_normalised'));
  expect(update).toBeTruthy();
  expect(update.params[2]).toBeCloseTo(0.95, 5); // confidence
});

// ─── Test 3: Fuzzy match — single candidate above threshold ─────────────
test('Tier 3 — single fuzzy candidate above threshold auto-resolves', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'First Capitol LLC', normalised_name: 'first capitol llc', account_number: null, transaction_count: 3 }],
    universe: [{ id: 'cp-C', canonical_name: 'First Capital LLC', normalised_name: 'first capital llc', is_merged_away: false }],
    transactions: [{ counterparty_normalised: 'first capitol llc', counterparty_id: null }]
  });
  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88 });
  expect(summary.autoResolved).toBe(1);
  const update = db.state.queueUpdates.find(u => /auto_resolved/.test(u.sql) && u.params.includes('fuzzy_name'));
  expect(update).toBeTruthy();
  expect(Number(update.params[2])).toBeGreaterThanOrEqual(0.88);
});

// ─── Test 4: Fuzzy match — multiple candidates → needs_review ────────────
test('Tier 3 — multi-candidate fuzzy match goes to needs_review (no phantom entity)', async () => {
  // Two close existing entities; queue entry is fuzzy to both above the
  // 0.75 review floor but not unambiguously above the 0.88 auto threshold.
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'Capital First', normalised_name: 'capital first', account_number: null, transaction_count: 2 }],
    universe: [
      { id: 'cp-D1', canonical_name: 'Capital First Ltd',  normalised_name: 'capital first ltd',  is_merged_away: false },
      { id: 'cp-D2', canonical_name: 'Capital First Bank', normalised_name: 'capital first bank', is_merged_away: false }
    ],
    transactions: []
  });
  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88 });
  expect(summary.needsReview).toBe(1);
  expect(summary.autoResolved).toBe(0);
  expect(db.state.universeInserts.length).toBe(0); // no phantom entity
  expect(db.state.transactionLinks.length).toBe(0); // no transactions linked
  // Queue updated to needs_review with conflict_candidates.
  const update = db.state.queueUpdates.find(u => /needs_review/.test(u.sql));
  expect(update).toBeTruthy();
  const candidatesJson = update.params[0];
  const candidates = JSON.parse(candidatesJson);
  expect(candidates.length).toBeGreaterThanOrEqual(2);
});

// ─── Test 5: No match — new entity created ───────────────────────────────
test('No match — new entity is created and queue resolves to it', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'Brand New Co', normalised_name: 'brand new co', account_number: null, transaction_count: 5 }],
    universe: [
      { id: 'cp-E1', canonical_name: 'Unrelated', normalised_name: 'unrelated entity', is_merged_away: false }
    ],
    transactions: [{ counterparty_normalised: 'brand new co', counterparty_id: null }]
  });
  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88 });
  expect(summary.autoResolved).toBe(1);
  expect(summary.newEntitiesCreated).toBe(1);
  expect(db.state.universeInserts.length).toBe(1);
  expect(db.state.universeInserts[0].canonical_name).toBe('Brand New Co');
  // logAudit called with action=counterparty_created.
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'counterparty_created' })
  );
});

// ─── Test 6: mergeCounterparties soft-merge ──────────────────────────────
test('mergeCounterparties — soft merge re-attributes transactions and flags source', async () => {
  const db = mockDb({
    universe: [
      { id: 'src', canonical_name: 'First Capital LLC',  normalised_name: 'first capital llc',  is_merged_away: false, merge_source_ids: [] },
      { id: 'tgt', canonical_name: 'First Capital, LLC', normalised_name: 'first capital llc punctuated', is_merged_away: false, merge_source_ids: [] }
    ],
    transactions: [
      { counterparty_id: 'src' },
      { counterparty_id: 'src' },
      { counterparty_id: 'tgt' }
    ]
  });
  const result = await mergeCounterparties(db, 'src', 'tgt', 7);
  expect(result.transactions_relinked).toBe(2);
  // src is_merged_away flipped
  const src = db.state.universe.find(c => c.id === 'src');
  expect(src.is_merged_away).toBe(true);
  expect(src.merged_into_id).toBe('tgt');
  // tgt.merge_source_ids contains the source
  const tgt = db.state.universe.find(c => c.id === 'tgt');
  expect(tgt.merge_source_ids).toContain('src');
  // dedup_decisions row written
  expect(db.state.dedupDecisions.length).toBe(1);
  // audit trail row written
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'counterparty_merged' })
  );
});

// ─── Test 7: Dry run does not commit ─────────────────────────────────────
test('Dry run does not write to queue, counterparties, or transactions', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'Brand New Co', normalised_name: 'brand new co', account_number: null, transaction_count: 5 }],
    universe: [{ id: 'cp-X', canonical_name: 'Existing', normalised_name: 'existing', is_merged_away: false }],
    transactions: [{ counterparty_normalised: 'brand new co', counterparty_id: null }]
  });
  const summary = await resolveQueue(db, { fuzzyThreshold: 0.88, dryRun: true });
  expect(summary.autoResolved).toBe(1);          // counts a would-be resolution
  expect(summary.newEntitiesCreated).toBe(1);
  expect(db.state.queueUpdates.length).toBe(0);  // no UPDATEs
  expect(db.state.universeInserts.length).toBe(0); // no INSERTs
  expect(db.state.transactionLinks.length).toBe(0); // no transactions linked
  expect(db.state.dedupDecisions.length).toBe(0);  // no audit rows
});

// ─── Test 8: resolveManually links transactions and writes audit ─────────
test('resolveManually — re-attributes transactions and writes audit + dedup_decisions rows', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'AmbigCorp', normalised_name: 'ambigcorp', account_number: null, transaction_count: 3 }],
    universe: [{ id: 'cp-Z', canonical_name: 'AmbigCorp Holdings', normalised_name: 'ambigcorp holdings', is_merged_away: false }],
    transactions: [{ counterparty_normalised: 'ambigcorp', counterparty_id: null }]
  });
  const result = await resolveManually(db, 'q1', 'cp-Z', 99);
  expect(result.resolved_counterparty_id).toBe('cp-Z');
  expect(result.transactions_linked).toBe(1);
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'counterparty_resolved_manually' })
  );
});

// ─── Test 9: normalize helper sanity ─────────────────────────────────────
test('normalize matches the Postgres generated-column logic', () => {
  expect(normalize('First Capital LLC')).toBe('first capital llc');
  expect(normalize('First Capital, LLC')).toBe('first capital llc');
  expect(normalize('  FIRST  Capital, LLC.  ')).toBe('first  capital llc');
  expect(normalize(null)).toBe('');
});

// ─── Test 10: Confidence score on fuzzy match is the actual JW score ────
test('Fuzzy match writes the actual Jaro-Winkler score as confidence', async () => {
  const db = mockDb({
    queue: [{ id: 'q1', raw_counterparty: 'First Capitol LLC', normalised_name: 'first capitol llc', account_number: null, transaction_count: 1 }],
    universe: [{ id: 'cp-F', canonical_name: 'First Capital LLC', normalised_name: 'first capital llc', is_merged_away: false }],
    transactions: []
  });
  await resolveQueue(db, { fuzzyThreshold: 0.88 });
  const update = db.state.queueUpdates.find(u => /auto_resolved/.test(u.sql) && u.params.includes('fuzzy_name'));
  expect(update).toBeTruthy();
  // Confidence is the third positional param after id+method.
  const conf = Number(update.params[2]);
  // Real JW on the strings; just confirm it's in the auto range and < 1.0.
  expect(conf).toBeGreaterThanOrEqual(0.88);
  expect(conf).toBeLessThan(1.0);
});
