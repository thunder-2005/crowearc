/* eslint-disable no-console */
/**
 * reseedData.js — replaces transactional seed data so Crowe ARC looks like a
 * live, functioning compliance team. Keeps customers, accounts, user_profiles,
 * counterparties (Phase B), scenario_versions, ofac_sdn_entries, manager_settings,
 * regulatory_correspondence. Replaces everything else.
 *
 * Run with: npm run reseed   (or  node scripts/reseedData.js  from backend/)
 * Requires DATABASE_URL in env (uses pg with default SSL handling).
 *
 * Deterministic — seeded PRNG so output is reproducible.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[reseed] FATAL: DATABASE_URL not set'); process.exit(1); }

// ─── Seeded PRNG (LCG) ──────────────────────────────────────────────────────
let _seed = 20260518;
const rand = () => { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; };
const choice = (a) => a[Math.floor(rand() * a.length)];
const randint = (lo, hi) => Math.floor(rand() * (hi - lo + 1)) + lo;
const sample = (arr, n) => {
  const a = arr.slice(); const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rand()*a.length), 1)[0]);
  return out;
};
const pad = (n, w) => String(n).padStart(w, '0');

// ─── Date helpers (UTC, no TZ drift) ────────────────────────────────────────
const TODAY = new Date(Date.UTC(2026, 4, 18)); // 2026-05-18
const DAY = 86400000;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const ymd = (d) => d.toISOString().slice(0, 10);
const isoTs = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const randDateBetween = (lo, hi) => addDays(lo, randint(0, Math.round((hi - lo) / DAY)));

// ─── Reference data ─────────────────────────────────────────────────────────
const L1_ANALYSTS = ['Robert Wright', 'Arjun Sharma', 'Priya Nair', 'Rohit Mehta', 'Neha Iyer', 'Vikram Sinha'];
const L2_ANALYSTS = ['Olivia Brown', 'Cassian Jude', 'Marie Davis', 'Hannah Louise'];
const MANAGER = 'Henry Morgan';
const BSA_OFFICER = 'James Carter';
const BSA_OFFICER_ID = '23'; // user_profiles.id for James Carter

const CUSTOMERS = [
  { id: 'CUST-0001', name: 'John Mitchell',                  type: 'Individual', risk: 'High',      pep: 0, sanctions: 0, kyc: 'Due Soon', scenarios: ['Cash Intensive'] },
  { id: 'CUST-0002', name: 'Sarah Kaplan',                   type: 'Individual', risk: 'High',      pep: 0, sanctions: 0, kyc: 'Due Soon', scenarios: ['Cash Intensive'] },
  { id: 'CUST-0003', name: 'Richard Ellis',                  type: 'Individual', risk: 'Very High', pep: 1, sanctions: 1, kyc: 'Overdue',  scenarios: ['Watchlist Hit', 'PEP Activity'] },
  { id: 'CUST-0004', name: 'Daniel Haddad',                  type: 'Individual', risk: 'High',      pep: 0, sanctions: 1, kyc: 'Due Soon', scenarios: ['High Risk Country', 'Watchlist Hit'] },
  { id: 'CUST-0005', name: 'Marcus Reed',                    type: 'Individual', risk: 'High',      pep: 0, sanctions: 1, kyc: 'Due Soon', scenarios: ['Structuring', 'Cash Intensive'] },
  { id: 'CUST-0006', name: 'Emily Chen',                     type: 'Individual', risk: 'Low',       pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0007', name: 'Lisa Bennett',                   type: 'Individual', risk: 'Low',       pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0008', name: 'Nathan Brooks',                  type: 'Individual', risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0009', name: 'Tony Ramirez',                   type: 'Individual', risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0010', name: 'Susan Walker',                   type: 'Individual', risk: 'Low',       pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0011', name: 'Kevin ONeill',                   type: 'Individual', risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: ['Structuring'] },
  { id: 'CUST-0012', name: 'Rebecca Stone',                  type: 'Individual', risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0013', name: 'Blue Harbor Restaurants Inc.',   type: 'Business',   risk: 'High',      pep: 0, sanctions: 0, kyc: 'Due Soon', scenarios: ['Cash Intensive'] },
  { id: 'CUST-0014', name: 'Meridian Global Trading LLC',    type: 'Business',   risk: 'Very High', pep: 0, sanctions: 1, kyc: 'Overdue',  scenarios: ['High Risk Country', 'Watchlist Hit'] },
  { id: 'CUST-0015', name: 'Granite Peak Holdings LLC',      type: 'Business',   risk: 'High',      pep: 0, sanctions: 0, kyc: 'Due Soon', scenarios: ['Rapid Movement'] },
  { id: 'CUST-0016', name: 'Liberty Remit Services Inc.',    type: 'Business',   risk: 'Very High', pep: 0, sanctions: 0, kyc: 'Overdue',  scenarios: ['Rapid Movement', 'High Risk Country'] },
  { id: 'CUST-0017', name: 'NovaBit Exchange LLC',           type: 'Business',   risk: 'Very High', pep: 0, sanctions: 0, kyc: 'Overdue',  scenarios: ['High Risk Country', 'Rapid Movement'] },
  { id: 'CUST-0018', name: 'Whitman and Cole LLP',           type: 'Business',   risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0019', name: 'Lakeside Family Medical PC',     type: 'Business',   risk: 'Low',       pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
  { id: 'CUST-0020', name: 'Apex Cloud Consulting LLC',      type: 'Business',   risk: 'Medium',    pep: 0, sanctions: 0, kyc: 'Current',  scenarios: [] },
];
const CUST_BY_ID = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]));

// Loaded from DB
let ACCOUNTS_BY_CUSTOMER = {};

const FATF_HIGH_RISK = [
  { country: 'Iran',        code: 'IR' },
  { country: 'North Korea', code: 'KP' },
  { country: 'Myanmar',     code: 'MM' },
  { country: 'Syria',       code: 'SY' },
  { country: 'Yemen',       code: 'YE' },
  { country: 'Russia',      code: 'RU' },
  { country: 'Pakistan',    code: 'PK' },
  { country: 'Haiti',       code: 'HT' },
  { country: 'Cuba',        code: 'CU' },
  { country: 'Libya',       code: 'LY' },
  { country: 'Sudan',       code: 'SD' },
  { country: 'Somalia',     code: 'SO' },
];

const NORMAL_PAYEES = [
  { desc: 'Salary Credit',          payee: 'Payroll Department',      chan: 'ACH',  type: 'credit', amtLo: 4500, amtHi: 18000 },
  { desc: 'Mortgage Payment',       payee: 'Wells Fargo Home Mortgage', chan: 'ACH', type: 'debit',  amtLo: 1800, amtHi: 4500 },
  { desc: 'Rent Payment',           payee: 'Avalon Property Management', chan: 'ACH', type: 'debit', amtLo: 1500, amtHi: 3800 },
  { desc: 'Utility Payment',        payee: 'Consolidated Edison',     chan: 'ACH',  type: 'debit',  amtLo: 80,   amtHi: 380 },
  { desc: 'Utility Payment',        payee: 'Pacific Gas & Electric',  chan: 'ACH',  type: 'debit',  amtLo: 90,   amtHi: 420 },
  { desc: 'Phone Bill',             payee: 'Verizon Wireless',        chan: 'ACH',  type: 'debit',  amtLo: 65,   amtHi: 240 },
  { desc: 'Internet Bill',          payee: 'Comcast Xfinity',         chan: 'ACH',  type: 'debit',  amtLo: 70,   amtHi: 180 },
  { desc: 'Grocery Purchase',       payee: 'Whole Foods Market',      chan: 'Card', type: 'debit',  amtLo: 50,   amtHi: 320 },
  { desc: 'Grocery Purchase',       payee: 'Trader Joes',             chan: 'Card', type: 'debit',  amtLo: 40,   amtHi: 220 },
  { desc: 'Retail Purchase',        payee: 'Target',                  chan: 'Card', type: 'debit',  amtLo: 30,   amtHi: 480 },
  { desc: 'Retail Purchase',        payee: 'Costco Wholesale',        chan: 'Card', type: 'debit',  amtLo: 120,  amtHi: 720 },
  { desc: 'Online Purchase',        payee: 'Amazon.com',              chan: 'Card', type: 'debit',  amtLo: 25,   amtHi: 580 },
  { desc: 'ATM Withdrawal',         payee: 'ATM',                     chan: 'ATM',  type: 'debit',  amtLo: 60,   amtHi: 400 },
  { desc: 'Restaurant',             payee: 'Chipotle Mexican Grill',  chan: 'Card', type: 'debit',  amtLo: 12,   amtHi: 90 },
  { desc: 'Restaurant',             payee: 'Starbucks',               chan: 'Card', type: 'debit',  amtLo: 5,    amtHi: 32 },
  { desc: 'Fuel Purchase',          payee: 'Shell Gas Station',       chan: 'Card', type: 'debit',  amtLo: 30,   amtHi: 110 },
  { desc: 'Insurance Premium',      payee: 'State Farm Insurance',    chan: 'ACH',  type: 'debit',  amtLo: 130,  amtHi: 580 },
  { desc: 'Vendor Payment',         payee: 'Office Depot',            chan: 'ACH',  type: 'debit',  amtLo: 120,  amtHi: 1800 },
  { desc: 'Client Payment Receipt', payee: 'Northwell Industries',    chan: 'Wire', type: 'credit', amtLo: 4500, amtHi: 42000 },
  { desc: 'Client Payment Receipt', payee: 'Westfield Construction',  chan: 'Wire', type: 'credit', amtLo: 6000, amtHi: 58000 },
  { desc: 'Investment Dividend',    payee: 'Vanguard Brokerage',      chan: 'ACH',  type: 'credit', amtLo: 200,  amtHi: 4200 },
  { desc: 'Tax Refund',             payee: 'IRS Treasury',            chan: 'ACH',  type: 'credit', amtLo: 800,  amtHi: 6400 },
  { desc: 'Subscription Service',   payee: 'Netflix',                 chan: 'Card', type: 'debit',  amtLo: 12,   amtHi: 22 },
  { desc: 'Subscription Service',   payee: 'Spotify',                 chan: 'Card', type: 'debit',  amtLo: 10,   amtHi: 18 },
];

const FLAGGED_COUNTERPARTIES = [
  { name: 'Aleksandr Volkov',        country: 'Russia',   code: 'RU' },
  { name: 'Bayan Petrochemical Co',  country: 'Iran',     code: 'IR' },
  { name: 'Damascus Trading FZE',    country: 'Syria',    code: 'SY' },
  { name: 'Korea Mining Industries', country: 'North Korea', code: 'KP' },
  { name: 'Yangon Holdings Ltd',     country: 'Myanmar',  code: 'MM' },
  { name: 'Mokpo Shipping Co',       country: 'North Korea', code: 'KP' },
];

const BRANCHES = ['NYC-Manhattan-001', 'LAX-Downtown-002', 'CHI-Loop-003', 'MIA-Brickell-004', 'HOU-Galleria-005', 'SFO-Mission-006'];

const SCENARIO_DESCRIPTIONS = {
  'Structuring':        'Multiple cash transactions structured below $10,000 CTR reporting threshold',
  'High Risk Country':  'Wire transfers to FATF high-risk-jurisdiction counterparties',
  'Cash Intensive':     'Cash deposit volumes exceeding expected customer profile',
  'Rapid Movement':     'Funds rapidly moved through account with no apparent business purpose',
  'Watchlist Hit':      'Counterparty matched against OFAC SDN watchlist',
  'PEP Activity':       'Politically exposed person activity requiring enhanced review',
};

const FP_REASONS = [
  'Activity consistent with customer profile and source-of-funds documentation',
  'Documented legitimate business purpose verified with customer',
  'Transaction pattern aligns with declared expected activity',
  'Counterparty verified — false positive on name screening',
  'Cash deposits supported by retail business receipts on file',
  'Wire transfers documented under existing trade-finance facility',
];

// ─── Generic batch insert ───────────────────────────────────────────────────
async function batchInsert(client, table, columns, rows, chunkSize = 100) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, r) =>
      '(' + columns.map((__, c) => `$${r * columns.length + c + 1}`).join(',') + ')'
    ).join(',');
    const params = chunk.flatMap(row => columns.map(col => (row[col] === undefined ? null : row[col])));
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, params);
    inserted += chunk.length;
  }
  return inserted;
}

// ═══ GENERATORS ════════════════════════════════════════════════════════════

// ── Transactions ────────────────────────────────────────────────────────────
function generateTransactions() {
  const txns = [];
  const suspiciousByCustomer = {};
  const startDate = new Date(Date.UTC(2025, 0, 1));   // 2025-01-01
  const endDate   = new Date(Date.UTC(2026, 4, 15));  // 2026-05-15

  let txnSeq = 1;
  const newTxnId = () => `TXN-2025-${pad(txnSeq++, 6)}`;

  for (const cust of CUSTOMERS) {
    const accts = ACCOUNTS_BY_CUSTOMER[cust.id] || [];
    if (!accts.length) continue;
    const primary = accts[0].account_number;
    const target = randint(50, 80);
    let balance = 50000 + randint(0, 250000);

    const custTxns = [];

    // Normal transactions — distribute across the 16-month window
    for (let i = 0; i < target; i++) {
      const date = randDateBetween(startDate, endDate);
      const p = choice(NORMAL_PAYEES);
      const amount = randint(p.amtLo, p.amtHi);
      const signed = p.type === 'credit' ? amount : -amount;
      balance = Math.max(1000, balance + signed);
      const acct = choice(accts).account_number;
      custTxns.push({
        transaction_id: newTxnId(),
        account_number: acct,
        customer_id: cust.id,
        txn_date: ymd(date),
        txn_time: `${pad(randint(7,21),2)}:${pad(randint(0,59),2)}:${pad(randint(0,59),2)}`,
        txn_type: p.type === 'credit' ? 'Credit' : 'Debit',
        channel: p.chan,
        description: p.desc,
        counterparty: p.payee,
        counterparty_country: 'United States',
        amount: Math.abs(amount),
        running_balance: balance,
        is_alerted: 0,
        alert_id: null,
        scenario_triggered: null,
        rule_breached: null,
        risk_score: randint(0, 25),
      });
    }

    // Suspicious patterns — only for customers tagged with scenarios
    if (cust.scenarios.length > 0) {
      const scenario = choice(cust.scenarios);
      const clusterStart = randDateBetween(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 3, 30)));
      const clusterTxns = generateSuspiciousCluster(scenario, cust, primary, clusterStart, newTxnId);
      // Use last running_balance and roll it forward
      for (const t of clusterTxns) {
        balance = Math.max(1000, balance + (t.txn_type === 'Credit' ? t.amount : -t.amount));
        t.running_balance = balance;
        custTxns.push(t);
      }
      suspiciousByCustomer[cust.id] = { scenario, txnIds: clusterTxns.map(t => t.transaction_id) };
    }

    // Sort each customer's txns chronologically and roll balance properly
    custTxns.sort((a, b) => (a.txn_date + a.txn_time).localeCompare(b.txn_date + b.txn_time));
    let bal = 50000 + randint(0, 250000);
    for (const t of custTxns) {
      bal = Math.max(1000, bal + (t.txn_type === 'Credit' ? t.amount : -t.amount));
      t.running_balance = bal;
    }
    txns.push(...custTxns);
  }

  return { txns, suspiciousByCustomer };
}

function generateSuspiciousCluster(scenario, cust, primary, startDate, newTxnId) {
  const out = [];
  const pushTxn = (offsetDays, partial) => {
    const d = addDays(startDate, offsetDays);
    out.push({
      transaction_id: newTxnId(),
      account_number: primary,
      customer_id: cust.id,
      txn_date: ymd(d),
      txn_time: `${pad(randint(9,17),2)}:${pad(randint(0,59),2)}:${pad(randint(0,59),2)}`,
      is_alerted: 1,
      scenario_triggered: scenario,
      risk_score: randint(70, 95),
      counterparty_country: 'United States',
      ...partial,
    });
  };

  switch (scenario) {
    case 'Structuring': {
      const n = randint(6, 10);
      for (let i = 0; i < n; i++) {
        pushTxn(i * randint(1, 3), {
          txn_type: 'Credit', channel: 'Branch', description: 'Cash Deposit',
          counterparty: 'Cash Deposit', amount: randint(8500, 9900),
          rule_breached: 'Multiple deposits below $10,000 CTR threshold within 14 days',
        });
      }
      break;
    }
    case 'High Risk Country': {
      const n = randint(3, 5);
      for (let i = 0; i < n; i++) {
        const cp = choice(FATF_HIGH_RISK);
        pushTxn(i * randint(2, 5), {
          txn_type: 'Debit', channel: 'Wire', description: `Outbound wire to ${cp.country}`,
          counterparty: `${choice(['Global','Atlantic','Continental','Maritime'])} ${choice(['Holdings','Trading','Industries','Logistics'])} ${cp.code}`,
          counterparty_country: cp.country,
          amount: randint(35000, 220000),
          rule_breached: `Wire transfer to FATF high-risk jurisdiction (${cp.country})`,
        });
      }
      break;
    }
    case 'Cash Intensive': {
      const n = randint(5, 9);
      for (let i = 0; i < n; i++) {
        pushTxn(i * 6 + randint(-1, 1), {
          txn_type: 'Credit', channel: 'Branch', description: 'Weekly Cash Deposit',
          counterparty: 'Cash Deposit', amount: randint(18000, 48000),
          rule_breached: 'Cash deposit volume exceeds expected monthly value by >150%',
        });
      }
      break;
    }
    case 'Rapid Movement': {
      const inflow = randint(280000, 850000);
      pushTxn(0, {
        txn_type: 'Credit', channel: 'Wire', description: 'Inbound wire receipt',
        counterparty: `${choice(['Apex','Vertex','Cascade'])} ${choice(['Capital','Ventures','Partners'])} ${choice(['LLC','Ltd'])}`,
        amount: inflow,
        rule_breached: 'Large inbound wire followed by rapid disbursement',
      });
      const outN = randint(3, 6);
      for (let i = 0; i < outN; i++) {
        pushTxn(1 + i, {
          txn_type: 'Debit', channel: 'Wire', description: 'Outbound wire',
          counterparty: `${choice(['Sigma','Delta','Omega','Phoenix'])} ${choice(['Trading','Capital','Holdings'])} ${choice(['Inc','Ltd','LLC'])}`,
          amount: Math.round(inflow / (outN + 1) + randint(-15000, 15000)),
          rule_breached: 'Outbound wire pattern indicates layering activity',
        });
      }
      break;
    }
    case 'Watchlist Hit': {
      const n = randint(1, 3);
      for (let i = 0; i < n; i++) {
        const cp = choice(FLAGGED_COUNTERPARTIES);
        pushTxn(i * randint(3, 10), {
          txn_type: choice(['Debit', 'Credit']),
          channel: 'Wire',
          description: `Wire ${choice(['to','from'])} sanctioned-list match`,
          counterparty: cp.name, counterparty_country: cp.country,
          amount: randint(45000, 380000),
          rule_breached: `Counterparty match: OFAC SDN list — ${cp.name} (${cp.country})`,
        });
      }
      break;
    }
    case 'PEP Activity': {
      const n = randint(2, 4);
      for (let i = 0; i < n; i++) {
        pushTxn(i * randint(2, 8), {
          txn_type: 'Credit', channel: 'Wire', description: 'Consulting fee from foreign entity',
          counterparty: `${choice(['Strategic','International','Global'])} Advisory ${choice(['Group','Partners'])}`,
          counterparty_country: choice(['Switzerland','UAE','Cayman Islands','Singapore']),
          amount: randint(120000, 480000),
          rule_breached: 'PEP receiving large advisory payments from offshore entities',
        });
      }
      break;
    }
  }
  return out;
}

// ── Alerts ──────────────────────────────────────────────────────────────────
function generateAlerts(suspiciousByCustomer) {
  const alerts = [];
  let seq = 1;
  const mkId = () => `ALERT-2025-${pad(seq++, 5)}`;

  // Distribution
  const DIST = [
    { status: 'Unassigned',              n: 25,  open: true,  age: [0, 13],  team: null },
    { status: 'Not Started',             n: 55,  open: true,  age: [7, 28],  team: 'L1' },
    { status: 'In Progress',             n: 75,  open: true,  age: [7, 42],  team: 'L1' },
    { status: 'Pending QC',              n: 20,  open: true,  age: [3, 14],  team: 'L1', qc: 'pending', disposition: 'False Positive' },
    { status: 'Escalated - L2',          n: 40,  open: true,  age: [14, 56], team: 'L2' },
    { status: 'Escalated - SAR',         n: 35,  open: true,  age: [28, 84], team: 'L2' },
    { status: 'Closed — False Positive', n: 130, open: false, age: [14, 365], team: 'L1', disposition: 'False Positive' },
    { status: 'Completed',               n: 20,  open: false, age: [21, 180], team: 'L1', disposition: 'Closed' },
  ];

  // L1/L2 assignment counters for even distribution
  const l1Counter = Object.fromEntries(L1_ANALYSTS.map(a => [a, 0]));
  const l2Counter = Object.fromEntries(L2_ANALYSTS.map(a => [a, 0]));
  const pickL1 = () => {
    const min = Math.min(...Object.values(l1Counter));
    const candidates = L1_ANALYSTS.filter(a => l1Counter[a] === min);
    const pick = choice(candidates);
    l1Counter[pick]++;
    return pick;
  };
  const pickL2 = () => {
    const min = Math.min(...Object.values(l2Counter));
    const candidates = L2_ANALYSTS.filter(a => l2Counter[a] === min);
    const pick = choice(candidates);
    l2Counter[pick]++;
    return pick;
  };

  // Build a customer pool weighted to risk for the alert generator
  const highRiskCusts = CUSTOMERS.filter(c => c.risk === 'High' || c.risk === 'Very High');
  const allCusts = CUSTOMERS;

  // ── Distribute scenarios across alerts ────────────────────────────────────
  const SCENARIOS = ['Structuring', 'High Risk Country', 'Cash Intensive', 'Rapid Movement', 'Watchlist Hit', 'PEP Activity'];

  // For Escalated-L2 / Escalated-SAR alerts, prefer high-risk customers + their scenarios
  // to give the demo coherent stories (case_notes / SARs reference these).
  const escalatedAlerts = []; // collected here, used downstream

  for (const bucket of DIST) {
    for (let i = 0; i < bucket.n; i++) {
      // Pick customer
      let cust;
      if (bucket.status === 'Escalated - SAR' || bucket.status === 'Escalated - L2') {
        cust = choice(highRiskCusts);
      } else if (rand() < 0.65) {
        cust = choice(highRiskCusts);
      } else {
        cust = choice(allCusts);
      }

      // Pick scenario — prefer one of the customer's own scenarios for realism
      const scenario = cust.scenarios.length > 0 && rand() < 0.7 ? choice(cust.scenarios) : choice(SCENARIOS);
      const priority = scenario === 'Watchlist Hit' || scenario === 'PEP Activity'
        ? choice(['High', 'High', 'Medium'])
        : choice(['High', 'Medium', 'Medium', 'Low']);

      // Dates
      const createdDate = addDays(TODAY, -randint(bucket.age[0], bucket.age[1]));
      // SLA — open alerts must have deadline >= today+10
      let slaDeadline;
      const isOpen = bucket.open;
      if (isOpen) {
        const bands = { High: [15, 30], Medium: [20, 45], Low: [30, 60] };
        const [lo, hi] = bands[priority];
        slaDeadline = addDays(TODAY, randint(lo, hi));
      } else {
        slaDeadline = addDays(createdDate, randint(20, 45));
      }
      const slaDays = Math.max(1, Math.round((slaDeadline - createdDate) / DAY));

      // Assigned to
      let assignedTo = null, escalatedTo = null;
      if (bucket.team === 'L1') assignedTo = pickL1();
      else if (bucket.team === 'L2') { assignedTo = pickL1(); escalatedTo = pickL2(); }

      // Amounts
      const amtFlagged = scenario === 'High Risk Country' || scenario === 'Watchlist Hit' || scenario === 'PEP Activity' || scenario === 'Rapid Movement'
        ? randint(60000, 480000) : randint(15000, 95000);
      const txnCount = scenario === 'Structuring' ? randint(6, 10)
        : scenario === 'Cash Intensive' ? randint(4, 9)
        : scenario === 'Rapid Movement' ? randint(4, 7)
        : randint(1, 4);
      const riskScore = scenario === 'Watchlist Hit' || scenario === 'PEP Activity' ? randint(82, 96)
        : (cust.risk === 'Very High' ? randint(75, 92) : cust.risk === 'High' ? randint(60, 85) : randint(40, 75));

      // closed_date
      const closedDate = bucket.open ? null : ymd(addDays(createdDate, randint(5, Math.max(5, slaDays - 2))));

      // Counterparty country
      const counterpartyCountry = scenario === 'High Risk Country' || scenario === 'Watchlist Hit'
        ? choice(FATF_HIGH_RISK).country : 'United States';

      const alert = {
        alert_id: mkId(),
        customer_id: cust.id,
        customer_name: cust.name,
        customer_type: cust.type,
        segment: null,
        scenario,
        scenario_description: SCENARIO_DESCRIPTIONS[scenario],
        alert_status: bucket.status,
        priority,
        risk_score: riskScore,
        amount_flagged_inr: amtFlagged,
        txn_count_flagged: txnCount,
        counterparty_country: counterpartyCountry,
        channel: scenario === 'Structuring' || scenario === 'Cash Intensive' ? 'Branch' : 'Wire',
        branch: choice(BRANCHES),
        assigned_to: assignedTo,
        created_date: ymd(createdDate),
        last_activity_date: closedDate || ymd(addDays(createdDate, randint(0, Math.max(1, Math.floor((TODAY - createdDate) / DAY) - 1)))),
        closed_date: closedDate,
        age_days: Math.max(0, Math.floor((TODAY - createdDate) / DAY)),
        sla_days: slaDays,
        sla_deadline: ymd(slaDeadline),
        sla_breached: isOpen && slaDeadline < TODAY ? 1 : 0,
        due_status: isOpen ? (slaDeadline < TODAY ? 'Breached' : (slaDeadline - TODAY < 7*DAY ? 'Due Soon' : 'On Track')) : 'Closed',
        case_converted: (bucket.status === 'Escalated - L2' || bucket.status === 'Escalated - SAR') ? 1 : 0,
        case_id: null, // populated by case generator
        disposition: bucket.disposition || null,
        customer_risk_rating: cust.risk,
        pep_match: cust.pep,
        sanctions_match: cust.sanctions,
        kyc_review_status: cust.kyc,
        created_by: 'TM Engine',
        linked_sar_id: null, // populated by SAR generator
        narrative_seed: null,
        sla_warning_notified_at: null,
        sla_breach_notified_at: null,
        escalation_notes: bucket.status === 'Escalated - SAR' ? `Escalated to L2 for SAR consideration — ${scenario} pattern confirmed` :
                          bucket.status === 'Escalated - L2' ? `Escalated to L2 — additional analysis required` : null,
        fp_close_reason: bucket.disposition === 'False Positive' ? choice(FP_REASONS) : null,
        escalated_to: escalatedTo,
        escalated_to_l2_at: escalatedTo ? isoTs(addDays(createdDate, randint(1, 5))) : null,
        l2_case_id: null,
        l2_analyst_id: null,
        l2_decision: null,
        l2_decision_at: null,
        returned_from_l2_at: null,
        l2_return_reason: null,
        l2_return_instructions: null,
        rule_explanation: null,
        reopened_at: null,
        reopened_by: null,
        reopen_request_id: null,
        qc_status: bucket.qc || null,
        qc_review_id: null, // populated by qc generator
      };

      if (bucket.status === 'Escalated - L2' || bucket.status === 'Escalated - SAR') {
        escalatedAlerts.push(alert);
      }
      alerts.push(alert);
    }
  }

  return { alerts, escalatedAlerts };
}

// ── Cases ───────────────────────────────────────────────────────────────────
function generateCases(escalatedAlerts) {
  // Spec: ~75 cases — one per Escalated alert (we have 40+35=75 escalated alerts)
  const cases = [];
  let seq = 1;
  const mkId = () => `CASE-2025-${pad(seq++, 4)}`;

  // Status distribution: Unassigned 5, Not Started 10, Work In Progress 30, Pending Review 15, Filed 12, Closed 3
  const slots = [];
  ['Unassigned'].forEach(() => { for (let i = 0; i < 5;  i++) slots.push('Unassigned'); });
  for (let i = 0; i < 10; i++) slots.push('Not Started');
  for (let i = 0; i < 30; i++) slots.push('Work In Progress');
  for (let i = 0; i < 15; i++) slots.push('Pending Review');
  for (let i = 0; i < 12; i++) slots.push('Filed');
  for (let i = 0; i < 3;  i++) slots.push('Closed');
  // Filed/Closed should map to Escalated-SAR alerts; rest to Escalated-L2.
  const sarAlerts = escalatedAlerts.filter(a => a.alert_status === 'Escalated - SAR');
  const l2Alerts  = escalatedAlerts.filter(a => a.alert_status === 'Escalated - L2');

  // Filed (12) + Closed (3) -> sarAlerts (35 available)
  const sarPool = sarAlerts.slice();
  const l2Pool  = l2Alerts.slice();
  const sarBuckets = ['Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Filed', 'Closed', 'Closed', 'Closed'];
  // Remaining 20 SAR alerts -> Pending Review / Work In Progress
  for (let i = 0; i < 20; i++) sarBuckets.push(i < 15 ? 'Pending Review' : 'Work In Progress');
  // L2 alerts (40): rest of Work In Progress + Not Started + Unassigned
  const l2Buckets = [];
  for (let i = 0; i < 25; i++) l2Buckets.push('Work In Progress');
  for (let i = 0; i < 10; i++) l2Buckets.push('Not Started');
  for (let i = 0; i < 5;  i++) l2Buckets.push('Unassigned');

  const allPairs = [
    ...sarPool.map((a, i) => ({ a, status: sarBuckets[i] || 'Filed' })),
    ...l2Pool.map((a, i) => ({ a, status: l2Buckets[i] || 'Work In Progress' })),
  ];

  for (const { a, status } of allPairs) {
    const caseId = mkId();
    a.case_id = caseId;
    a.l2_case_id = caseId;
    const createdDate = a.created_date;
    cases.push({
      case_id: caseId,
      source_alert_id: a.alert_id,
      linked_sar_id: null,
      customer_id: a.customer_id,
      customer_name: a.customer_name,
      scenario: a.scenario,
      case_status: status,
      assigned_to: status === 'Unassigned' ? null : (a.escalated_to || choice(L2_ANALYSTS)),
      created_date: createdDate,
      updated_date: ymd(addDays(new Date(Date.UTC(...createdDate.split('-').map((x,i)=>i===1?+x-1:+x))), randint(1, 14))),
    });
  }
  return cases;
}

// ── Case notes ──────────────────────────────────────────────────────────────
function generateCaseNotes(cases, alerts) {
  const notes = [];
  const alertById = Object.fromEntries(alerts.map(a => [a.alert_id, a]));

  const L1_NOTES = (a) => ([
    `Opened case for review. Alert flagged ${a.scenario} on customer ${a.customer_name} — ${a.txn_count_flagged} transactions totalling $${a.amount_flagged_inr.toLocaleString()}.`,
    `Reviewed transaction history for the past 90 days. Pattern consistent with ${a.scenario.toLowerCase()} — ${a.scenario === 'Structuring' ? 'multiple deposits below $10K threshold' : a.scenario === 'High Risk Country' ? 'wires to FATF high-risk jurisdiction' : a.scenario === 'Cash Intensive' ? 'cash volume well above declared expected monthly value' : a.scenario === 'Watchlist Hit' ? 'counterparty match on OFAC SDN list' : 'rapid layering through correspondent accounts'}.`,
    `Checked customer KYC. ${a.customer_name} carries ${a.customer_risk_rating} risk rating with KYC status "${a.kyc_review_status}". ${a.pep_match ? 'PEP indicator present. ' : ''}${a.sanctions_match ? 'Sanctions-screening prior match on file. ' : ''}Source-of-funds documentation reviewed.`,
    `Activity not explained by declared business profile or prior account behaviour. Recommending escalation to L2 for further investigation.`,
  ]);
  const L2_NOTES = (a) => ([
    `Received case from L1 analyst. Reviewing prior L1 findings on ${a.scenario} pattern affecting customer ${a.customer_name}.`,
    `Pulled extended 6-month transaction history. Confirmed ${a.scenario.toLowerCase()} indicators — ${a.txn_count_flagged} transactions, aggregate $${a.amount_flagged_inr.toLocaleString()}. Cross-referenced counterparty data and beneficial ownership records.`,
    `Engaged customer relations to request supporting documentation. ${a.disposition === 'False Positive' ? 'Documentation received supports legitimate business purpose. Closing as FP.' : 'Documentation either insufficient or inconsistent with activity pattern.'}`,
  ]);

  for (const c of cases) {
    const a = alertById[c.source_alert_id];
    if (!a) continue;
    const l1notes = L1_NOTES(a);
    const l2notes = L2_NOTES(a);
    const created = new Date(Date.UTC(...c.created_date.split('-').map((x,i)=>i===1?+x-1:+x)));
    const n = randint(3, 5);
    // First 1-3 L1 notes, then L2 notes if case has progressed
    for (let i = 0; i < Math.min(n, 4); i++) {
      const isL1 = i < 2 || c.case_status === 'Unassigned' || c.case_status === 'Not Started';
      const analyst = isL1 ? a.assigned_to || choice(L1_ANALYSTS) : (c.assigned_to || choice(L2_ANALYSTS));
      const noteText = isL1 ? l1notes[i % l1notes.length] : l2notes[(i - 2) % l2notes.length];
      notes.push({
        alert_id: a.alert_id,
        note_text: noteText,
        analyst,
        timestamp: isoTs(addDays(created, i + randint(0, 1))),
      });
    }
  }
  return notes;
}

// ── SAR filings ─────────────────────────────────────────────────────────────
function generateSARs(cases, alerts) {
  const sars = [];
  let seq = 1;
  const mkId = () => `SAR-2025-${pad(seq++, 5)}`;
  const alertById = Object.fromEntries(alerts.map(a => [a.alert_id, a]));

  // SARs link to cases that are Filed / Pending Review / Work In Progress (escalated-SAR alerts mainly)
  const sarCandidates = cases.filter(c =>
    alertById[c.source_alert_id]?.alert_status === 'Escalated - SAR' ||
    c.case_status === 'Filed'
  );

  // Distribution: Draft 5, Pending Approval 6, Approved 3, Filed 18, Returned for Revision 3 = 35
  const statusBuckets = [];
  for (let i = 0; i < 5;  i++) statusBuckets.push('Draft');
  for (let i = 0; i < 6;  i++) statusBuckets.push('Pending Approval');
  for (let i = 0; i < 3;  i++) statusBuckets.push('Approved');
  for (let i = 0; i < 18; i++) statusBuckets.push('Filed');
  for (let i = 0; i < 3;  i++) statusBuckets.push('Returned for Revision');

  // Filing types: Initial 28, Continuing 5, Joint 2
  const filingTypeBuckets = [];
  for (let i = 0; i < 28; i++) filingTypeBuckets.push('Initial SAR');
  for (let i = 0; i < 5;  i++) filingTypeBuckets.push('Continuing SAR');
  for (let i = 0; i < 2;  i++) filingTypeBuckets.push('Joint SAR');

  const pool = sarCandidates.slice(0, 35);
  while (pool.length < 35) pool.push(choice(sarCandidates)); // pad if short

  const filedSARs = []; // for downstream linking

  for (let i = 0; i < 35; i++) {
    const c = pool[i];
    const a = alertById[c.source_alert_id];
    if (!a) continue;
    const status = statusBuckets[i];
    const filingType = filingTypeBuckets[i];
    const sarId = mkId();
    const createdDate = new Date(Date.UTC(...c.created_date.split('-').map((x,i2)=>i2===1?+x-1:+x)));
    const draftDate = addDays(createdDate, randint(3, 14));
    const filedDate = status === 'Filed' ? addDays(draftDate, randint(2, 10)) : null;
    const approvedAt = (status === 'Approved' || status === 'Filed') ? addDays(draftDate, randint(1, 5)) : null;
    const submittedAt = status === 'Draft' ? null : addDays(draftDate, randint(0, 2));

    const narratives = {
      'Structuring':       `Customer ${a.customer_name} executed ${a.txn_count_flagged} cash deposits between $8,500 and $9,900 over a 14-day window, aggregating $${a.amount_flagged_inr.toLocaleString()} USD, with each deposit structured below the $10,000 CTR reporting threshold. The pattern is inconsistent with the declared expected monthly cash volume and the customer's stated business model. Recommend SAR filing under 31 CFR 1020.320 for structuring.`,
      'High Risk Country': `Customer ${a.customer_name} initiated ${a.txn_count_flagged} outbound wire transfers totalling $${a.amount_flagged_inr.toLocaleString()} USD to counterparties in ${a.counterparty_country} between ${ymd(addDays(filedDate||TODAY, -45))} and ${ymd(addDays(filedDate||TODAY, -10))}. The destination is on the FATF high-risk-jurisdictions list, and no documented commercial purpose has been provided for the transfers. Filing SAR under jurisdictional-risk concerns.`,
      'Cash Intensive':    `Customer ${a.customer_name} deposited $${a.amount_flagged_inr.toLocaleString()} in cash across ${a.txn_count_flagged} branch deposits, exceeding declared expected monthly cash volume by more than 200%. Source of funds verification was inconclusive and prior CDD documentation does not support activity at this scale. SAR filing supported by cash-volume anomaly and lack of source-of-funds documentation.`,
      'Rapid Movement':    `Customer ${a.customer_name} received a $${a.amount_flagged_inr.toLocaleString()} inbound wire and disbursed the funds to ${a.txn_count_flagged} unrelated counterparties within 4 business days, leaving negligible residual balance. The pattern exhibits classic layering characteristics with no apparent business rationale documented in customer records. Filing SAR for layering/structured-movement concerns.`,
      'Watchlist Hit':     `Customer ${a.customer_name} engaged in ${a.txn_count_flagged} wire transactions aggregating $${a.amount_flagged_inr.toLocaleString()} with counterparties matched against the OFAC Specially Designated Nationals list. Customer carries ${a.customer_risk_rating} risk rating with prior sanctions-screening hit on file. Filing SAR pursuant to BSA sanctions-related reporting requirements.`,
      'PEP Activity':      `Customer ${a.customer_name}, identified as a politically exposed person, received ${a.txn_count_flagged} payments totalling $${a.amount_flagged_inr.toLocaleString()} from offshore advisory entities with limited supporting documentation. The aggregate payment volume is inconsistent with declared income and consultancy activities described at onboarding. Filing SAR under enhanced PEP-monitoring procedures.`,
    };

    sars.push({
      sar_id: sarId,
      case_id: c.case_id,
      source_alert_id: a.alert_id,
      customer_id: a.customer_id,
      customer_name: a.customer_name,
      alert_scenario: a.scenario,
      sar_status: status,
      prepared_by: c.assigned_to || choice(L2_ANALYSTS),
      reviewed_by: status === 'Pending Approval' || status === 'Approved' || status === 'Filed' || status === 'Returned for Revision' ? MANAGER : null,
      approved_by: (status === 'Approved' || status === 'Filed') ? MANAGER : null,
      detection_date: a.created_date,
      incident_start_date: ymd(addDays(createdDate, -45)),
      incident_end_date: ymd(addDays(createdDate, -1)),
      draft_created_date: ymd(draftDate),
      filed_date: filedDate ? ymd(filedDate) : null,
      acknowledged_date: filedDate ? ymd(addDays(filedDate, randint(1, 4))) : null,
      amount_involved_inr: a.amount_flagged_inr,
      narrative_summary: narratives[a.scenario] || 'Suspicious activity warranting SAR filing per enhanced-monitoring procedures.',
      reporting_jurisdiction: 'US FinCEN',
      regulator_reference: status === 'Filed' ? `BSA-${randint(20000, 99999)}` : null,
      retention_expiry_date: filedDate ? ymd(addDays(filedDate, 5 * 365)) : null,
      retention_status: filedDate ? 'Active' : null,
      documents_count: status === 'Filed' ? randint(3, 7) : status === 'Draft' ? 0 : randint(1, 4),
      export_package_ready: status === 'Filed' ? 1 : 0,
      export_count: status === 'Filed' ? randint(1, 3) : 0,
      last_exported_at: filedDate ? isoTs(addDays(filedDate, randint(1, 7))) : null,
      law_enforcement_hold: 0,
      access_classification: 'Confidential',
      current_owner: status === 'Filed' ? BSA_OFFICER : (status === 'Approved' || status === 'Pending Approval' ? MANAGER : (c.assigned_to || choice(L2_ANALYSTS))),
      latest_activity_date: ymd(filedDate || approvedAt || draftDate),
      linked_alert_count: 1,
      qa_score: status === 'Filed' ? randint(85, 100) : null,
      notes: null,
      filing_type: filingType,
      filing_method: 'FinCEN E-Filing',
      regulatory_agency: 'FinCEN',
      sar_type: 'BSA SAR',
      bsa_filing_institution: 'Crowe Bank N.A.',
      tin: null,
      num_transactions: a.txn_count_flagged,
      total_amount: a.amount_flagged_inr,
      currency: 'USD',
      structuring_indicator: a.scenario === 'Structuring' ? 1 : 0,
      prior_sars: 0,
      prior_sar_count: filingType === 'Continuing SAR' ? randint(1, 3) : 0,
      date_of_recent_sar: null,
      activity_date_from: ymd(addDays(createdDate, -45)),
      activity_date_to: ymd(addDays(createdDate, -1)),
      suspicious_activity_types: a.scenario,
      transaction_types: a.channel,
      transaction_locations: a.branch,
      ip_addresses: null,
      device_identifiers: null,
      subject_data: null,
      narrative: narratives[a.scenario] || null,
      certification_signed: status === 'Filed' ? 1 : 0,
      submitted_by: submittedAt ? (c.assigned_to || choice(L2_ANALYSTS)) : null,
      submitted_at: submittedAt ? isoTs(submittedAt) : null,
      approved_at: approvedAt ? isoTs(approvedAt) : null,
      draft_data: null,
      included_documents: null,
      created_at: isoTs(draftDate),
      updated_at: isoTs(filedDate || approvedAt || draftDate),
      rejection_reason_category: status === 'Returned for Revision' ? choice(['Insufficient Narrative', 'Missing Documentation', 'Narrative Clarity']) : null,
      rejection_comments: status === 'Returned for Revision' ? 'Narrative requires additional detail on customer source-of-funds. Please attach updated CDD review and revise pattern description.' : null,
      rejection_checklist: null,
      rejected_by: status === 'Returned for Revision' ? MANAGER : null,
      rejected_at: status === 'Returned for Revision' ? isoTs(addDays(draftDate, randint(1, 4))) : null,
      returned_to_analyst: status === 'Returned for Revision' ? 1 : 0,
      joint_filer_name: filingType === 'Joint SAR' ? 'Liberty National Bank' : null,
      joint_filer_address: filingType === 'Joint SAR' ? '120 Broadway, New York, NY' : null,
      joint_filer_city: filingType === 'Joint SAR' ? 'New York' : null,
      joint_filer_state: filingType === 'Joint SAR' ? 'NY' : null,
      joint_filer_zip: filingType === 'Joint SAR' ? '10005' : null,
      joint_filer_fein: filingType === 'Joint SAR' ? '13-2024500' : null,
      joint_filer_contact_name: filingType === 'Joint SAR' ? 'Margaret Liu' : null,
      joint_filer_contact_phone: filingType === 'Joint SAR' ? '212-555-0188' : null,
      joint_filer_role: filingType === 'Joint SAR' ? 'Co-Filer' : null,
      prior_sar_id: filingType === 'Continuing SAR' ? `SAR-2024-${pad(randint(1, 99), 5)}` : null,
      prior_sar_filing_date: filingType === 'Continuing SAR' ? ymd(addDays(createdDate, -180)) : null,
      changes_since_prior_sar: filingType === 'Continuing SAR' ? 'Activity has continued at similar volume; counterparties expanded to include additional FATF high-risk jurisdictions.' : null,
      continuing_activity_from: filingType === 'Continuing SAR' ? ymd(addDays(createdDate, -180)) : null,
      continuing_activity_to: filingType === 'Continuing SAR' ? ymd(addDays(createdDate, -1)) : null,
      bsa_officer_id: status === 'Filed' ? BSA_OFFICER_ID : null,
      bsa_approved_at: status === 'Filed' && filedDate ? isoTs(addDays(filedDate, -1)) : null,
    });

    if (status === 'Filed' || status === 'Approved' || status === 'Pending Approval') {
      a.linked_sar_id = sarId;
      c.linked_sar_id = sarId;
    }
    if (status === 'Filed') filedSARs.push({ sarId, alertId: a.alert_id, caseId: c.case_id });
  }

  return { sars, filedSARs };
}

// ── KYC reviews ─────────────────────────────────────────────────────────────
function generateKYCReviews(filedSARs) {
  // Distribution: Scheduled 15, In Progress 10, Pending Approval 8, Completed 22, Overdue 5 = 60
  const reviews = [];
  const REVIEW_TYPES = ['scheduled_periodic', 'triggered_by_sar', 'triggered_by_alert_cluster', 'triggered_by_material_change', 'manual'];
  const STATUSES = [
    { st: 'assigned',         n: 15, futureDue: true,  done: false, approved: false },
    { st: 'in_progress',      n: 10, futureDue: true,  done: false, approved: false },
    { st: 'pending_approval', n: 8,  futureDue: true,  done: false, approved: false },
    { st: 'completed',        n: 22, futureDue: false, done: true,  approved: true },
    { st: 'overdue',          n: 5,  futureDue: false, done: false, approved: false },
  ];

  // Ensure at least 2 of each review type by tagging the first 10 slots
  let typeIdx = 0;
  const nextType = () => {
    if (typeIdx < 10) {
      const t = REVIEW_TYPES[Math.floor(typeIdx / 2)];
      typeIdx++;
      return t;
    }
    return choice(REVIEW_TYPES);
  };

  let i = 0;
  for (const bucket of STATUSES) {
    for (let k = 0; k < bucket.n; k++) {
      const cust = choice(CUSTOMERS);
      const reviewType = nextType();
      const assignDate = addDays(TODAY, -randint(7, 60));
      const dueDate = bucket.futureDue ? addDays(TODAY, randint(7, 45)) : addDays(TODAY, bucket.st === 'overdue' ? -randint(5, 30) : -randint(1, 14));
      const startedAt = bucket.st === 'in_progress' || bucket.st === 'pending_approval' || bucket.done ? addDays(assignDate, randint(1, 5)) : null;
      const completedAt = bucket.done ? addDays(startedAt || assignDate, randint(2, 14)) : null;
      const triggeringSar = reviewType === 'triggered_by_sar' && filedSARs.length ? choice(filedSARs).sarId : null;
      const checklist = JSON.stringify({
        identity_verified: bucket.done || bucket.st !== 'assigned',
        source_of_funds_reviewed: bucket.done || bucket.st === 'pending_approval' || bucket.st === 'in_progress',
        sanctions_rescreening_complete: bucket.done || bucket.st === 'pending_approval',
        pep_status_confirmed: bucket.done || bucket.st === 'pending_approval' || bucket.st === 'in_progress',
        transaction_pattern_reviewed: bucket.done || bucket.st === 'pending_approval',
        beneficial_owners_updated: bucket.done,
        risk_rating_re_evaluated: bucket.done || bucket.st === 'pending_approval',
        documentation_collected: bucket.done || bucket.st !== 'assigned',
      });

      reviews.push({
        customer_id: cust.id,
        review_type: reviewType,
        status: bucket.st,
        priority: cust.risk === 'Very High' ? 'High' : cust.risk === 'High' ? 'Medium' : 'Low',
        due_date: ymd(dueDate),
        assigned_to: choice(L1_ANALYSTS),
        assigned_by: MANAGER,
        assigned_at: isoTs(assignDate),
        assigned_note: reviewType === 'triggered_by_sar' ? 'Triggered by recent SAR filing — refresh CDD' : null,
        started_at: startedAt ? isoTs(startedAt) : null,
        completed_at: completedAt ? isoTs(completedAt) : null,
        previous_risk_rating: cust.risk,
        new_risk_rating: bucket.done ? cust.risk : null,
        previous_cdd_level: cust.risk === 'Very High' || cust.risk === 'High' ? 'Enhanced' : 'Standard',
        new_cdd_level: bucket.done ? (cust.risk === 'Very High' || cust.risk === 'High' ? 'Enhanced' : 'Standard') : null,
        review_findings: bucket.done ? `Customer profile re-verified. Activity patterns reviewed against declared profile. ${cust.risk === 'Very High' || cust.risk === 'High' ? 'Enhanced monitoring continues.' : 'No material changes identified.'}` : null,
        checklist,
        recommendation: bucket.done ? 'maintain_rating' : null,
        approved_by: bucket.approved ? MANAGER : null,
        approved_at: bucket.approved && completedAt ? isoTs(addDays(completedAt, 1)) : null,
        rejection_reason: null,
        rejection_comments: null,
        rejected_by: null,
        rejected_at: null,
        returned_to_analyst: 0,
        triggered_by_sar_id: triggeringSar,
        triggered_by_alert_id: null,
        created_at: isoTs(assignDate),
        updated_at: isoTs(completedAt || startedAt || assignDate),
      });
      i++;
    }
  }
  return reviews;
}

// ── QC reviews + Pending QC alert linking ───────────────────────────────────
function generateQCReviews(alerts) {
  const reviews = [];
  let seq = 1;
  const mkId = () => `QC-${Date.now()}-${pad(seq++, 4)}`;
  const pendingQCAlerts = alerts.filter(a => a.alert_status === 'Pending QC');
  const fpClosedAlerts = alerts.filter(a => a.alert_status === 'Closed — False Positive');

  // 20 Pending — match Pending QC alerts (we have 20)
  for (const a of pendingQCAlerts) {
    const qcId = mkId();
    a.qc_review_id = qcId;
    const closedAt = addDays(TODAY, -randint(2, 10));
    reviews.push({
      qc_id: qcId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_analyst: a.assigned_to || choice(L1_ANALYSTS),
      original_disposition: 'False Positive',
      original_closed_at: isoTs(closedAt),
      assigned_to: choice(L2_ANALYSTS),
      assigned_at: isoTs(addDays(closedAt, 1)),
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      checklist: JSON.stringify({}),
      overall_decision: null,
      failure_reason: null,
      failure_notes: null,
      reopen_request_id: null,
      created_at: isoTs(closedAt),
      updated_at: isoTs(closedAt),
    });
  }
  // 3 In Review
  const inReviewSources = sample(fpClosedAlerts, 3);
  for (const a of inReviewSources) {
    const qcId = mkId();
    const closedAt = addDays(TODAY, -randint(5, 12));
    reviews.push({
      qc_id: qcId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_analyst: a.assigned_to || choice(L1_ANALYSTS),
      original_disposition: 'False Positive',
      original_closed_at: isoTs(closedAt),
      assigned_to: choice(L2_ANALYSTS),
      assigned_at: isoTs(addDays(closedAt, 1)),
      status: 'in_review',
      reviewed_by: null,
      reviewed_at: null,
      checklist: JSON.stringify({
        evidence_reviewed: true, narrative_sufficient: true, kyc_checked: false,
      }),
      overall_decision: null,
      failure_reason: null,
      failure_notes: null,
      reopen_request_id: null,
      created_at: isoTs(closedAt),
      updated_at: isoTs(addDays(closedAt, 2)),
    });
  }
  // 5 Passed
  const passedSources = sample(fpClosedAlerts.filter(x => !inReviewSources.includes(x)), 5);
  for (const a of passedSources) {
    const qcId = mkId();
    const closedAt = addDays(TODAY, -randint(10, 30));
    const reviewedAt = addDays(closedAt, randint(2, 8));
    reviews.push({
      qc_id: qcId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_analyst: a.assigned_to || choice(L1_ANALYSTS),
      original_disposition: 'False Positive',
      original_closed_at: isoTs(closedAt),
      assigned_to: choice(L2_ANALYSTS),
      assigned_at: isoTs(addDays(closedAt, 1)),
      status: 'passed',
      reviewed_by: choice(L2_ANALYSTS),
      reviewed_at: isoTs(reviewedAt),
      checklist: JSON.stringify({
        evidence_reviewed: true, narrative_sufficient: true, kyc_checked: true,
        sanctions_rescreened: true, conclusion_supported: true,
      }),
      overall_decision: 'pass',
      failure_reason: null,
      failure_notes: null,
      reopen_request_id: null,
      created_at: isoTs(closedAt),
      updated_at: isoTs(reviewedAt),
    });
  }
  // 2 Failed (will link reopen_request_id below)
  const failedSources = sample(fpClosedAlerts.filter(x => !inReviewSources.includes(x) && !passedSources.includes(x)), 2);
  const failedRecords = [];
  for (const a of failedSources) {
    const qcId = mkId();
    const closedAt = addDays(TODAY, -randint(12, 25));
    const reviewedAt = addDays(closedAt, randint(2, 6));
    const rec = {
      qc_id: qcId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_analyst: a.assigned_to || choice(L1_ANALYSTS),
      original_disposition: 'False Positive',
      original_closed_at: isoTs(closedAt),
      assigned_to: choice(L2_ANALYSTS),
      assigned_at: isoTs(addDays(closedAt, 1)),
      status: 'failed',
      reviewed_by: choice(L2_ANALYSTS),
      reviewed_at: isoTs(reviewedAt),
      checklist: JSON.stringify({
        evidence_reviewed: true, narrative_sufficient: false, kyc_checked: false,
        sanctions_rescreened: true, conclusion_supported: false,
      }),
      overall_decision: 'fail',
      failure_reason: 'insufficient_evidence',
      failure_notes: 'L1 disposition does not adequately address structuring indicators. Source-of-funds verification absent. Recommend reopen for further investigation.',
      reopen_request_id: null, // linked below
      created_at: isoTs(closedAt),
      updated_at: isoTs(reviewedAt),
    };
    failedRecords.push({ rec, sourceAlert: a });
    reviews.push(rec);
  }

  return { reviews, failedRecords };
}

// ── Reopen requests ─────────────────────────────────────────────────────────
function generateReopenRequests(alerts, failedQcRecords) {
  // 5 requests covering each workflow stage
  const reqs = [];
  let seq = Date.now();
  const mkId = () => `RRQ-${seq++}-${randint(100, 999)}`;
  const fpClosed = alerts.filter(a => a.alert_status === 'Closed — False Positive');

  // 1. pending_manager — from QC failure
  if (failedQcRecords.length > 0) {
    const { rec, sourceAlert } = failedQcRecords[0];
    const reqId = mkId();
    rec.reopen_request_id = reqId;
    const reqDate = new Date(rec.reviewed_at);
    reqs.push({
      request_id: reqId,
      alert_id: sourceAlert.alert_id,
      customer_name: sourceAlert.customer_name,
      original_disposition: 'False Positive',
      original_closed_by: sourceAlert.assigned_to || choice(L1_ANALYSTS),
      original_closed_at: rec.original_closed_at,
      requested_by: rec.reviewed_by,
      requested_by_role: 'analyst_l2',
      requested_at: rec.reviewed_at,
      reason_code: 'qc_review_failed',
      reason_detail: 'QC review failed — narrative insufficient and source-of-funds verification absent. Structuring pattern requires deeper review with extended transaction history. Reopening for L1 re-investigation under enhanced procedures.',
      evidence_document_id: null,
      status: 'pending_manager',
      manager_reviewed_by: null, manager_reviewed_at: null, manager_decision: null, manager_notes: null,
      bsa_reviewed_by: null, bsa_reviewed_at: null, bsa_decision: null, bsa_notes: null,
      created_at: rec.reviewed_at, updated_at: rec.reviewed_at,
    });
  }

  // 2. manager_approved — pending BSA
  {
    const a = choice(fpClosed);
    const reqId = mkId();
    const reqDate = addDays(TODAY, -randint(5, 12));
    const mgrDate = addDays(reqDate, randint(1, 3));
    reqs.push({
      request_id: reqId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_disposition: 'False Positive',
      original_closed_by: a.assigned_to || choice(L1_ANALYSTS),
      original_closed_at: isoTs(addDays(reqDate, -randint(20, 45))),
      requested_by: choice(L2_ANALYSTS),
      requested_by_role: 'analyst_l2',
      requested_at: isoTs(reqDate),
      reason_code: 'new_information',
      reason_detail: 'New OFAC list update flagged a previously-cleared counterparty. Re-investigation required to confirm whether prior transactions implicate the now-listed entity. Recommend reopen for full sanctions retro-review.',
      evidence_document_id: null,
      status: 'manager_approved',
      manager_reviewed_by: MANAGER, manager_reviewed_at: isoTs(mgrDate),
      manager_decision: 'approve',
      manager_notes: 'Approved for BSA officer sign-off. New SDN listing merits a fresh look at prior cleared transactions.',
      bsa_reviewed_by: null, bsa_reviewed_at: null, bsa_decision: null, bsa_notes: null,
      created_at: isoTs(reqDate), updated_at: isoTs(mgrDate),
    });
  }

  // 3. bsa_approved — alert reopened
  {
    const a = choice(fpClosed.filter(x => x.reopen_request_id == null));
    const reqId = mkId();
    const reqDate = addDays(TODAY, -randint(10, 20));
    const mgrDate = addDays(reqDate, randint(1, 2));
    const bsaDate = addDays(mgrDate, randint(1, 3));
    reqs.push({
      request_id: reqId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_disposition: 'False Positive',
      original_closed_by: a.assigned_to || choice(L1_ANALYSTS),
      original_closed_at: isoTs(addDays(reqDate, -randint(20, 60))),
      requested_by: choice(L2_ANALYSTS),
      requested_by_role: 'analyst_l2',
      requested_at: isoTs(reqDate),
      reason_code: 'related_alert',
      reason_detail: 'Related alert on the same customer revealed a wider structuring pattern. Original disposition no longer holds given new evidence linking multiple deposit clusters. Reopen for consolidated investigation under a single case.',
      evidence_document_id: null,
      status: 'bsa_approved',
      manager_reviewed_by: MANAGER, manager_reviewed_at: isoTs(mgrDate),
      manager_decision: 'approve', manager_notes: 'Pattern of related alerts justifies reopen. Forwarding to BSA officer.',
      bsa_reviewed_by: BSA_OFFICER, bsa_reviewed_at: isoTs(bsaDate),
      bsa_decision: 'approve',
      bsa_notes: 'Approved. Alert reopened in In Progress status. Authorising L1 to re-investigate under enhanced procedures.',
      created_at: isoTs(reqDate), updated_at: isoTs(bsaDate),
    });
    // Flip alert state to reopened in-progress and refresh SLA forward
    a.alert_status = 'In Progress';
    a.disposition = null;
    a.closed_date = null;
    a.reopened_at = isoTs(bsaDate);
    a.reopened_by = BSA_OFFICER;
    a.reopen_request_id = reqId;
    const newDeadline = addDays(TODAY, randint(20, 40));
    a.sla_deadline = ymd(newDeadline);
    a.sla_breached = 0;
    a.due_status = 'On Track';
    a.fp_close_reason = null;
  }

  // 4. manager_rejected
  {
    const a = choice(fpClosed.filter(x => x.reopen_request_id == null));
    const reqId = mkId();
    const reqDate = addDays(TODAY, -randint(8, 16));
    const mgrDate = addDays(reqDate, randint(1, 3));
    reqs.push({
      request_id: reqId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_disposition: 'False Positive',
      original_closed_by: a.assigned_to || choice(L1_ANALYSTS),
      original_closed_at: isoTs(addDays(reqDate, -randint(15, 40))),
      requested_by: choice(L2_ANALYSTS),
      requested_by_role: 'analyst_l2',
      requested_at: isoTs(reqDate),
      reason_code: 'sla_overlooked',
      reason_detail: 'Alert was closed close to SLA breach window. L2 review suggests rushed disposition. Requesting reopen to validate adequacy of original investigation.',
      evidence_document_id: null,
      status: 'manager_rejected',
      manager_reviewed_by: MANAGER, manager_reviewed_at: isoTs(mgrDate),
      manager_decision: 'reject',
      manager_notes: 'Disposition documentation supports the FP close. Time-pressure concern is procedural and not substantive. Closing reopen request — no new evidence presented.',
      bsa_reviewed_by: null, bsa_reviewed_at: null, bsa_decision: null, bsa_notes: null,
      created_at: isoTs(reqDate), updated_at: isoTs(mgrDate),
    });
  }

  // 5. bsa_rejected — manager approved but BSA officer denied
  {
    const a = choice(fpClosed.filter(x => x.reopen_request_id == null));
    const reqId = mkId();
    const reqDate = addDays(TODAY, -randint(14, 24));
    const mgrDate = addDays(reqDate, randint(1, 2));
    const bsaDate = addDays(mgrDate, randint(1, 4));
    reqs.push({
      request_id: reqId,
      alert_id: a.alert_id,
      customer_name: a.customer_name,
      original_disposition: 'False Positive',
      original_closed_by: a.assigned_to || choice(L1_ANALYSTS),
      original_closed_at: isoTs(addDays(reqDate, -randint(25, 70))),
      requested_by: choice(L2_ANALYSTS),
      requested_by_role: 'analyst_l2',
      requested_at: isoTs(reqDate),
      reason_code: 'pattern_continues',
      reason_detail: 'Subsequent monthly review surfaced apparent continuation of the original pattern. Recommending reopen of original alert for consolidated review with new activity. Cross-reference with related alerts pending.',
      evidence_document_id: null,
      status: 'bsa_rejected',
      manager_reviewed_by: MANAGER, manager_reviewed_at: isoTs(mgrDate),
      manager_decision: 'approve', manager_notes: 'Continuation pattern merits sign-off — forwarding to BSA officer.',
      bsa_reviewed_by: BSA_OFFICER, bsa_reviewed_at: isoTs(bsaDate),
      bsa_decision: 'reject',
      bsa_notes: 'Original alert documentation is sufficient. New activity should be raised as a fresh alert under continuing-pattern monitoring, not as a reopen. Denying reopen request.',
      created_at: isoTs(reqDate), updated_at: isoTs(bsaDate),
    });
  }

  return reqs;
}

// ── Notifications ───────────────────────────────────────────────────────────
function generateNotifications(alerts, sars, kycReviews, qcReviews, reopenReqs) {
  const notifs = [];
  const NOTIF_TYPES = [
    'alert_assigned', 'sla_warning', 'sla_warning_48hr', 'sar_pending_approval', 'sar_approved',
    'sar_rejected', 'kyc_review_assigned', 'qc_review_pending', 'qc_passed', 'qc_failed',
    'reopen_request_pending', 'reopen_request_bsa', 'ofac_match',
  ];

  const openAlerts = alerts.filter(a => a.assigned_to && ['Not Started','In Progress','Escalated - L2'].includes(a.alert_status));
  const filedSARs = sars.filter(s => s.sar_status === 'Filed');
  const pendingSARs = sars.filter(s => s.sar_status === 'Pending Approval');
  const rejectedSARs = sars.filter(s => s.sar_status === 'Returned for Revision');
  const completedKYC = kycReviews.filter(k => k.status === 'completed');
  const assignedKYC = kycReviews.filter(k => k.status === 'assigned' || k.status === 'in_progress');
  const passedQC = qcReviews.filter(q => q.overall_decision === 'pass');
  const failedQC = qcReviews.filter(q => q.overall_decision === 'fail');
  const pendingQC = qcReviews.filter(q => q.status === 'pending');

  const push = (type, recipientId, recipientRole, title, message, relatedId, relatedType, tone, ageDays) => {
    notifs.push({
      recipient_id: recipientId,
      recipient_role: recipientRole,
      type, title, message,
      related_id: relatedId,
      related_type: relatedType,
      tone,
      is_read: rand() < 0.4 ? 0 : 1,
      created_at: isoTs(addDays(TODAY, -ageDays)),
    });
  };

  // alert_assigned — 18
  for (const a of sample(openAlerts, Math.min(18, openAlerts.length))) {
    push('alert_assigned', a.assigned_to, 'employee', `New alert assigned: ${a.alert_id}`,
      `${a.scenario} alert on ${a.customer_name} (Priority: ${a.priority})`, a.alert_id, 'alert', 'info', randint(0, 21));
  }
  // sla_warning — 8 (5+ required)
  for (const a of sample(openAlerts, Math.min(8, openAlerts.length))) {
    push('sla_warning', a.assigned_to, 'employee', `SLA warning: ${a.alert_id}`,
      `Alert nearing SLA deadline (${a.sla_deadline})`, a.alert_id, 'alert', 'warning', randint(0, 7));
  }
  // sla_warning_48hr — 8
  for (const a of sample(openAlerts, Math.min(8, openAlerts.length))) {
    push('sla_warning_48hr', a.assigned_to, 'employee', `SLA 48hr warning: ${a.alert_id}`,
      `Alert must be actioned within 48 hours`, a.alert_id, 'alert', 'warning', randint(0, 3));
  }
  // sar_pending_approval — manager-targeted, 6
  for (const s of pendingSARs.slice(0, 6)) {
    push('sar_pending_approval', MANAGER, 'compliance_manager', `SAR pending approval: ${s.sar_id}`,
      `${s.alert_scenario} SAR on ${s.customer_name} submitted for manager approval`, s.sar_id, 'sar', 'warning', randint(0, 10));
  }
  // sar_approved — 8
  for (const s of sample(filedSARs, Math.min(8, filedSARs.length))) {
    push('sar_approved', s.prepared_by, 'employee', `SAR approved: ${s.sar_id}`,
      `Your SAR has been approved and filed (Reference: ${s.regulator_reference || 'BSA-pending'})`, s.sar_id, 'sar', 'success', randint(1, 30));
  }
  // sar_rejected — 5 (cover Returned for Revision SARs)
  for (const s of rejectedSARs.slice(0, 3).concat(sample(filedSARs, 2))) {
    push('sar_rejected', s.prepared_by, 'employee', `SAR returned for revision: ${s.sar_id}`,
      `Manager returned SAR for revision. Reason: ${s.rejection_reason_category || 'Narrative clarity'}`, s.sar_id, 'sar', 'warning', randint(1, 15));
  }
  // kyc_review_assigned — 8
  for (const k of sample(assignedKYC, Math.min(8, assignedKYC.length))) {
    push('kyc_review_assigned', k.assigned_to, 'employee', `KYC review assigned`,
      `Customer ${k.customer_id} — ${k.review_type} review due ${k.due_date}`, k.customer_id, 'kyc_review', 'info', randint(0, 14));
  }
  // qc_review_pending — 10 (cover all 20 pending alerts as QC notifs to L2)
  for (const q of pendingQC.slice(0, 10)) {
    push('qc_review_pending', q.assigned_to, 'employee', `QC review pending: ${q.alert_id}`,
      `False-positive disposition on ${q.customer_name} awaiting your QC review`, q.alert_id, 'alert', 'info', randint(0, 7));
  }
  // qc_passed — 5
  for (const q of passedQC) {
    push('qc_passed', q.original_analyst, 'employee', `QC review passed`,
      `Your FP disposition on ${q.alert_id} was validated by L2 QC`, q.alert_id, 'alert', 'success', randint(2, 25));
  }
  // qc_failed — 5 (only 2 actual failed, pad with related notifications)
  for (const q of failedQC) {
    push('qc_failed', q.original_analyst, 'employee', `QC review failed: ${q.alert_id}`,
      `L2 QC challenged your disposition. Reason: ${q.failure_reason}`, q.alert_id, 'alert', 'warning', randint(2, 18));
  }
  for (const q of passedQC.slice(0, 3)) {
    push('qc_failed', q.original_analyst, 'employee', `QC follow-up requested: ${q.alert_id}`,
      `L2 reviewer requested follow-up clarification on closed alert`, q.alert_id, 'alert', 'warning', randint(2, 18));
  }
  // reopen_request_pending — 5 (to manager)
  for (let i = 0; i < 5; i++) {
    const r = reopenReqs[Math.min(i, reopenReqs.length - 1)];
    push('reopen_request_pending', MANAGER, 'compliance_manager', `Reopen request pending: ${r.alert_id}`,
      `L2 requested reopen — reason: ${r.reason_code}`, r.request_id, 'reopen_request', 'warning', randint(0, 12));
  }
  // reopen_request_bsa — 5 (to BSA)
  for (let i = 0; i < 5; i++) {
    const r = reopenReqs[Math.min(i, reopenReqs.length - 1)];
    push('reopen_request_bsa', BSA_OFFICER, 'bsa_officer', `Reopen request — BSA review`,
      `Manager approved reopen request ${r.request_id} for ${r.alert_id} — awaiting your sign-off`, r.request_id, 'reopen_request', 'warning', randint(0, 10));
  }
  // ofac_match — 8
  const sanctionsAlerts = alerts.filter(a => a.scenario === 'Watchlist Hit').slice(0, 8);
  for (const a of sanctionsAlerts) {
    push('ofac_match', a.assigned_to || MANAGER, a.assigned_to ? 'employee' : 'compliance_manager',
      `OFAC sanctions match`, `Transaction counterparty matched OFAC SDN list on ${a.alert_id}`,
      a.alert_id, 'alert', 'critical', randint(0, 20));
  }
  // Top up to ~150 with assorted mixes
  while (notifs.length < 150) {
    const a = choice(alerts);
    const recipient = a.assigned_to || choice(L1_ANALYSTS);
    push(choice(['alert_assigned','sla_warning']), recipient, 'employee',
      `Alert update: ${a.alert_id}`, `Status: ${a.alert_status}`, a.alert_id, 'alert', 'info', randint(0, 30));
  }
  return notifs;
}

// ── Audit trail ─────────────────────────────────────────────────────────────
function generateAuditTrail(alerts, sars, kycReviews, reopenReqs) {
  const out = [];
  const filedSARs = sars.filter(s => s.sar_status === 'Filed');
  const escalatedAlerts = alerts.filter(a => a.alert_status === 'Escalated - L2' || a.alert_status === 'Escalated - SAR');

  // audit_trail.sar_id is NOT NULL in this schema and is used as a generic
  // "entity anchor" id — for non-SAR events we pass the alert_id / case_id /
  // kyc customer_id / reopen request_id into the column.
  const push = (anchorId, action, performedBy, ts, details, entityType) => {
    out.push({
      sar_id: anchorId,
      action, performed_by: performedBy,
      timestamp: typeof ts === 'string' ? ts : isoTs(ts),
      details, entity_type: entityType,
    });
  };

  // ~20 alert lifecycle events
  for (const a of sample(escalatedAlerts, 20)) {
    const created = new Date(Date.UTC(...a.created_date.split('-').map((x,i)=>i===1?+x-1:+x)));
    push(a.alert_id, 'alert_assigned', a.assigned_to, addDays(created, 0), `Alert ${a.alert_id} assigned to ${a.assigned_to}`, 'alert');
    if (a.escalated_to_l2_at) {
      push(a.alert_id, 'alert_escalated_l2', a.escalated_to, a.escalated_to_l2_at,
        `Alert ${a.alert_id} escalated from L1 (${a.assigned_to}) to L2 (${a.escalated_to})`, 'alert');
    }
  }

  // ~30 SAR lifecycle events
  for (const s of filedSARs) {
    push(s.sar_id, 'sar_draft_created', s.prepared_by, s.created_at,
      `Draft SAR ${s.sar_id} created for ${s.customer_name}`, 'sar');
    if (s.submitted_at) push(s.sar_id, 'sar_submitted_for_approval', s.prepared_by, s.submitted_at,
      `SAR ${s.sar_id} submitted to compliance manager for approval`, 'sar');
    if (s.approved_at) push(s.sar_id, 'sar_manager_approved', MANAGER, s.approved_at,
      `SAR ${s.sar_id} approved by compliance manager`, 'sar');
    if (s.bsa_approved_at) push(s.sar_id, 'sar_bsa_signed_off', BSA_OFFICER, s.bsa_approved_at,
      `SAR ${s.sar_id} signed off by BSA officer`, 'sar');
    if (s.filed_date) push(s.sar_id, 'sar_filed_to_fincen', BSA_OFFICER, isoTs(new Date(Date.UTC(...s.filed_date.split('-').map((x,i)=>i===1?+x-1:+x)))),
      `SAR ${s.sar_id} filed to FinCEN (ref: ${s.regulator_reference})`, 'sar');
  }

  // ~15 KYC completion events
  for (const k of kycReviews.filter(r => r.status === 'completed').slice(0, 15)) {
    push(k.customer_id, 'kyc_review_completed', k.approved_by || k.assigned_to, k.completed_at,
      `KYC review completed for customer ${k.customer_id} — risk rating maintained`, 'kyc_review');
  }

  // ~5 reopen events
  for (const r of reopenReqs) {
    push(r.request_id, `reopen_${r.status}`, r.bsa_reviewed_by || r.manager_reviewed_by || r.requested_by,
      r.updated_at, `Reopen request ${r.request_id} — status: ${r.status}`, 'reopen_request');
  }

  return out;
}

// ═══ MAIN ═══════════════════════════════════════════════════════════════════
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('[reseed] Connected to Supabase\n');

  // Load accounts
  const accRes = await client.query(`SELECT account_number, customer_id, account_type FROM accounts ORDER BY id`);
  for (const row of accRes.rows) {
    if (!ACCOUNTS_BY_CUSTOMER[row.customer_id]) ACCOUNTS_BY_CUSTOMER[row.customer_id] = [];
    ACCOUNTS_BY_CUSTOMER[row.customer_id].push(row);
  }
  console.log(`[reseed] Loaded ${accRes.rows.length} accounts across ${Object.keys(ACCOUNTS_BY_CUSTOMER).length} customers`);

  // ── DELETE in child→parent order ────────────────────────────────────────
  console.log('\n[reseed] Deleting existing data (child tables first)...');
  const deletes = [
    'notifications', 'audit_trail', 'sar_review_comments', 'sar_approval_log', 'retrieval_log',
    'qc_reviews', 'alert_reopen_requests', 'kyc_review_documents', 'kyc_reviews',
    'l2_documents', 'l2_notes', 'l2_cases', 'sar_filings',
    'case_documents', 'case_notes', 'cases', 'documents',
    'alert_transactions', 'alerts', 'transactions',
  ];
  for (const t of deletes) {
    try {
      const r = await client.query(`DELETE FROM ${t}`);
      console.log(`  deleted ${String(r.rowCount).padStart(5)} from ${t}`);
    } catch (e) {
      console.log(`  skipped ${t}: ${e.message.split('\n')[0]}`);
    }
  }

  // ── GENERATE ────────────────────────────────────────────────────────────
  console.log('\n[reseed] Generating new dataset...');
  const { txns, suspiciousByCustomer } = generateTransactions();
  console.log(`  generated ${txns.length} transactions (${txns.filter(t=>t.is_alerted===1).length} alerted)`);

  const { alerts, escalatedAlerts } = generateAlerts(suspiciousByCustomer);
  console.log(`  generated ${alerts.length} alerts (${escalatedAlerts.length} escalated)`);

  const cases = generateCases(escalatedAlerts);
  console.log(`  generated ${cases.length} cases`);

  const caseNotes = generateCaseNotes(cases, alerts);
  console.log(`  generated ${caseNotes.length} case notes`);

  const { sars, filedSARs } = generateSARs(cases, alerts);
  console.log(`  generated ${sars.length} SARs (${filedSARs.length} filed)`);

  const kycReviews = generateKYCReviews(filedSARs);
  console.log(`  generated ${kycReviews.length} KYC reviews`);

  const { reviews: qcReviews, failedRecords: failedQc } = generateQCReviews(alerts);
  console.log(`  generated ${qcReviews.length} QC reviews`);

  const reopenReqs = generateReopenRequests(alerts, failedQc);
  console.log(`  generated ${reopenReqs.length} reopen requests`);

  const notifications = generateNotifications(alerts, sars, kycReviews, qcReviews, reopenReqs);
  console.log(`  generated ${notifications.length} notifications`);

  const auditEntries = generateAuditTrail(alerts, sars, kycReviews, reopenReqs);
  console.log(`  generated ${auditEntries.length} audit-trail entries`);

  // ── INSERT (in dependency order) ────────────────────────────────────────
  console.log('\n[reseed] Inserting new data...');

  await batchInsert(client, 'transactions',
    ['transaction_id','account_number','customer_id','txn_date','txn_time','txn_type','channel','description','counterparty','counterparty_country','amount','running_balance','is_alerted','alert_id','scenario_triggered','rule_breached','risk_score'],
    txns);
  console.log(`  inserted ${txns.length} transactions`);

  await batchInsert(client, 'alerts',
    ['alert_id','customer_id','customer_name','customer_type','segment','scenario','scenario_description','alert_status','priority','risk_score','amount_flagged_inr','txn_count_flagged','counterparty_country','channel','branch','assigned_to','created_date','last_activity_date','closed_date','age_days','sla_days','sla_deadline','sla_breached','due_status','case_converted','case_id','disposition','customer_risk_rating','pep_match','sanctions_match','kyc_review_status','created_by','linked_sar_id','narrative_seed','sla_warning_notified_at','sla_breach_notified_at','escalation_notes','fp_close_reason','escalated_to','escalated_to_l2_at','l2_case_id','l2_analyst_id','l2_decision','l2_decision_at','returned_from_l2_at','l2_return_reason','l2_return_instructions','rule_explanation','reopened_at','reopened_by','reopen_request_id','qc_status','qc_review_id'],
    alerts);
  console.log(`  inserted ${alerts.length} alerts`);

  // alert_transactions — link suspicious clusters to their parent escalated alert
  const linkRows = [];
  for (const [custId, info] of Object.entries(suspiciousByCustomer)) {
    const matchingAlerts = alerts.filter(a =>
      a.customer_id === custId && a.scenario === info.scenario &&
      (a.alert_status === 'Escalated - L2' || a.alert_status === 'Escalated - SAR' || a.alert_status === 'In Progress')
    );
    if (matchingAlerts.length === 0) continue;
    const parent = matchingAlerts[0];
    for (const txnId of info.txnIds) {
      linkRows.push({ alert_id: parent.alert_id, transaction_id: txnId, role: 'primary', created_at: isoTs(TODAY) });
    }
  }
  if (linkRows.length) {
    await batchInsert(client, 'alert_transactions', ['alert_id','transaction_id','role','created_at'], linkRows);
    console.log(`  inserted ${linkRows.length} alert-transaction links`);
  }

  await batchInsert(client, 'cases',
    ['case_id','source_alert_id','linked_sar_id','customer_id','customer_name','scenario','case_status','assigned_to','created_date','updated_date'],
    cases);
  console.log(`  inserted ${cases.length} cases`);

  await batchInsert(client, 'case_notes', ['alert_id','note_text','analyst','timestamp'], caseNotes);
  console.log(`  inserted ${caseNotes.length} case notes`);

  await batchInsert(client, 'sar_filings',
    ['sar_id','case_id','source_alert_id','customer_id','customer_name','alert_scenario','sar_status','prepared_by','reviewed_by','approved_by','detection_date','incident_start_date','incident_end_date','draft_created_date','filed_date','acknowledged_date','amount_involved_inr','narrative_summary','reporting_jurisdiction','regulator_reference','retention_expiry_date','retention_status','documents_count','export_package_ready','export_count','last_exported_at','law_enforcement_hold','access_classification','current_owner','latest_activity_date','linked_alert_count','qa_score','notes','filing_type','filing_method','regulatory_agency','sar_type','bsa_filing_institution','tin','num_transactions','total_amount','currency','structuring_indicator','prior_sars','prior_sar_count','date_of_recent_sar','activity_date_from','activity_date_to','suspicious_activity_types','transaction_types','transaction_locations','ip_addresses','device_identifiers','subject_data','narrative','certification_signed','submitted_by','submitted_at','approved_at','draft_data','included_documents','created_at','updated_at','rejection_reason_category','rejection_comments','rejection_checklist','rejected_by','rejected_at','returned_to_analyst','joint_filer_name','joint_filer_address','joint_filer_city','joint_filer_state','joint_filer_zip','joint_filer_fein','joint_filer_contact_name','joint_filer_contact_phone','joint_filer_role','prior_sar_id','prior_sar_filing_date','changes_since_prior_sar','continuing_activity_from','continuing_activity_to','bsa_officer_id','bsa_approved_at'],
    sars);
  console.log(`  inserted ${sars.length} SARs`);

  await batchInsert(client, 'kyc_reviews',
    ['customer_id','review_type','status','priority','due_date','assigned_to','assigned_by','assigned_at','assigned_note','started_at','completed_at','previous_risk_rating','new_risk_rating','previous_cdd_level','new_cdd_level','review_findings','checklist','recommendation','approved_by','approved_at','rejection_reason','rejection_comments','rejected_by','rejected_at','returned_to_analyst','triggered_by_sar_id','triggered_by_alert_id','created_at','updated_at'],
    kycReviews);
  console.log(`  inserted ${kycReviews.length} KYC reviews`);

  await batchInsert(client, 'qc_reviews',
    ['qc_id','alert_id','customer_name','original_analyst','original_disposition','original_closed_at','assigned_to','assigned_at','status','reviewed_by','reviewed_at','checklist','overall_decision','failure_reason','failure_notes','reopen_request_id','created_at','updated_at'],
    qcReviews);
  console.log(`  inserted ${qcReviews.length} QC reviews`);

  await batchInsert(client, 'alert_reopen_requests',
    ['request_id','alert_id','customer_name','original_disposition','original_closed_by','original_closed_at','requested_by','requested_by_role','requested_at','reason_code','reason_detail','evidence_document_id','status','manager_reviewed_by','manager_reviewed_at','manager_decision','manager_notes','bsa_reviewed_by','bsa_reviewed_at','bsa_decision','bsa_notes','created_at','updated_at'],
    reopenReqs);
  console.log(`  inserted ${reopenReqs.length} reopen requests`);

  await batchInsert(client, 'notifications',
    ['recipient_id','recipient_role','type','title','message','related_id','related_type','tone','is_read','created_at'],
    notifications);
  console.log(`  inserted ${notifications.length} notifications`);

  await batchInsert(client, 'audit_trail',
    ['sar_id','action','performed_by','timestamp','details','entity_type'],
    auditEntries);
  console.log(`  inserted ${auditEntries.length} audit-trail entries`);

  // ── Patch alerts that got new state from QC reviews / reopen requests ──
  // qc_review_id on Pending QC alerts
  for (const a of alerts.filter(x => x.qc_review_id)) {
    await client.query(`UPDATE alerts SET qc_review_id=$1 WHERE alert_id=$2`, [a.qc_review_id, a.alert_id]);
  }
  // case_id, linked_sar_id, reopened state on alerts that got mutated post-insert
  for (const a of alerts.filter(x => x.case_id || x.linked_sar_id || x.reopened_at)) {
    await client.query(
      `UPDATE alerts SET case_id=$1, l2_case_id=$2, linked_sar_id=$3, reopened_at=$4, reopened_by=$5, reopen_request_id=$6, alert_status=$7, disposition=$8, closed_date=$9, due_status=$10 WHERE alert_id=$11`,
      [a.case_id, a.l2_case_id, a.linked_sar_id, a.reopened_at, a.reopened_by, a.reopen_request_id, a.alert_status, a.disposition, a.closed_date, a.due_status, a.alert_id]
    );
  }
  // linked_sar_id on cases
  for (const c of cases.filter(x => x.linked_sar_id)) {
    await client.query(`UPDATE cases SET linked_sar_id=$1 WHERE case_id=$2`, [c.linked_sar_id, c.case_id]);
  }
  // reopen_request_id on QC failed reviews
  for (const q of qcReviews.filter(x => x.overall_decision === 'fail' && x.reopen_request_id)) {
    await client.query(`UPDATE qc_reviews SET reopen_request_id=$1 WHERE qc_id=$2`, [q.reopen_request_id, q.qc_id]);
  }
  console.log('  patched cross-table references');

  // ── VALIDATE ────────────────────────────────────────────────────────────
  console.log('\n[reseed] Validating...');
  const v = {};
  v.txnRate = (await client.query(`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_alerted=1)::int AS alerted,
           ROUND(COUNT(*) FILTER (WHERE is_alerted=1)*100.0/NULLIF(COUNT(*),0), 1) AS pct
      FROM transactions`)).rows[0];
  v.slaBreaches = (await client.query(`
    SELECT COUNT(*)::int AS n FROM alerts
     WHERE sla_deadline::date < NOW()::date
       AND alert_status NOT IN ('Completed','Closed','Closed — False Positive','False Positive','Escalated - SAR','Filed')`)).rows[0].n;
  v.statusDist = (await client.query(`SELECT alert_status, COUNT(*)::int AS n FROM alerts GROUP BY alert_status ORDER BY n DESC`)).rows;
  v.orphanCases = (await client.query(`
    SELECT COUNT(*)::int AS n FROM cases c
     WHERE NOT EXISTS (SELECT 1 FROM alerts a WHERE a.alert_id = c.source_alert_id)`)).rows[0].n;
  v.orphanSARs = (await client.query(`
    SELECT COUNT(*)::int AS n FROM sar_filings sf
     WHERE NOT EXISTS (SELECT 1 FROM cases c WHERE c.case_id = sf.case_id)`)).rows[0].n;

  console.log(`\n[reseed] Complete:`);
  console.log(`  transactions: ${v.txnRate.total} (alert rate: ${v.txnRate.pct}%)`);
  console.log(`  alerts: ${alerts.length}`);
  console.log(`  cases: ${cases.length}`);
  console.log(`  case_notes: ${caseNotes.length}`);
  console.log(`  sar_filings: ${sars.length}`);
  console.log(`  kyc_reviews: ${kycReviews.length}`);
  console.log(`  qc_reviews: ${qcReviews.length}`);
  console.log(`  alert_reopen_requests: ${reopenReqs.length}`);
  console.log(`  notifications: ${notifications.length}`);
  console.log(`  audit_trail: ${auditEntries.length}`);
  console.log(`  SLA breaches: ${v.slaBreaches}`);
  console.log(`  Orphaned cases: ${v.orphanCases}`);
  console.log(`  Orphaned SARs: ${v.orphanSARs}`);
  console.log(`\n  Status distribution:`);
  for (const row of v.statusDist) console.log(`    ${row.alert_status.padEnd(36)} ${row.n}`);

  await client.end();

  // Final sanity gate
  if (parseFloat(v.txnRate.pct) >= 5) console.warn('\n⚠️  Alert rate is ≥5% — spec target was 3-4%');
  if (v.slaBreaches > 0) console.warn(`\n⚠️  ${v.slaBreaches} open alerts have breached SLA — spec required 0`);
  if (v.orphanCases > 0) console.warn(`\n⚠️  ${v.orphanCases} orphan cases`);
  if (v.orphanSARs > 0) console.warn(`\n⚠️  ${v.orphanSARs} orphan SARs`);
}

main().catch(err => { console.error('[reseed] FATAL:', err); process.exit(1); });
