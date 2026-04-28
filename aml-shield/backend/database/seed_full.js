/**
 * AML Shield — Full US-based seed dataset
 *
 * Run with:   node backend/database/seed_full.js
 *
 * Wipes and rebuilds:
 *   user_profiles, customers, accounts, transactions, alerts, cases,
 *   sar_filings, documents, case_notes, case_documents, audit_trail,
 *   retrieval_log, kyc_reviews, notifications, manager_settings,
 *   employee_settings.  /uploads is also cleared.
 *
 * Bank: First National Bank — US (FEIN 12-3456789), 200 Park Avenue, NY.
 * Currency: USD throughout. Regulator: FinCEN / BSA E-Filing.
 *
 * Note on case_status vs sar_status counts:
 *   The spec listed case_status counts (Filed=12) and sar_status counts (Filed=25)
 *   that don't reconcile 1:1.  This script keeps SAR distribution exact per spec
 *   and aligns case_status='Filed' to 25 to preserve referential consistency.
 *   Other case statuses approximate spec proportions.  See seedCases().
 */

const path = require('path');
const fs = require('fs');
const { db, initSchema } = require('./db');

const REFERENCE_DATE = new Date();
REFERENCE_DATE.setHours(12, 0, 0, 0);
const REF_STR = ymd(REFERENCE_DATE);
const SEED_DIR = path.join(__dirname, 'seed_data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BANK_NAME = 'First National Bank - US';
const BANK_FEIN = '12-3456789';
const BANK_BRANCH = 'Manhattan Compliance Center';
const BANK_ADDRESS = '200 Park Avenue, New York, NY 10166';

// ─────────────────────────────────────────────── helpers

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ts(d, hourOffset = 0) {
  const x = new Date(d);
  x.setHours(9 + hourOffset, 0, 0, 0);
  return `${ymd(x)} ${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}:00`;
}
function addDays(base, days) {
  const d = base instanceof Date ? new Date(base) : new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d;
}
function daysBetween(a, b) {
  const aa = a instanceof Date ? a : new Date(a + 'T12:00:00');
  const bb = b instanceof Date ? b : new Date(b + 'T12:00:00');
  return Math.round((bb - aa) / 86400000);
}
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = Math.abs(h) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const intIn = (r, lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
const moneyIn = (r, lo, hi) => Math.round(lo + r() * (hi - lo));

// ─────────────────────────────────────────────── prepare DB

initSchema();

console.log('[seed_full] wiping data tables...');
db.exec(`
  DELETE FROM notifications;
  DELETE FROM kyc_review_documents;
  DELETE FROM kyc_reviews;
  DELETE FROM sar_review_comments;
  DELETE FROM sar_approval_log;
  DELETE FROM retrieval_log;
  DELETE FROM audit_trail;
  DELETE FROM documents;
  DELETE FROM case_documents;
  DELETE FROM case_notes;
  DELETE FROM transactions;
  DELETE FROM accounts;
  DELETE FROM customers;
  DELETE FROM cases;
  DELETE FROM sar_filings;
  DELETE FROM alerts;
  DELETE FROM employee_settings;
  DELETE FROM manager_settings;
  DELETE FROM user_profiles;
  DELETE FROM report_schedules;
`);

// Wipe upload directory
for (const f of fs.readdirSync(UPLOAD_DIR)) {
  if (f === '.gitkeep') continue;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_e) {}
}

// ─────────────────────────────────────────────── 1. USER PROFILES

const ANALYSTS_T1 = ['Rohit Sharma', 'Priya Nair', 'Sanjay Patil'];
const ANALYSTS_T2 = ['Amit Verma', 'Neha Iyer'];
const ANALYSTS_ALL = [...ANALYSTS_T1, ...ANALYSTS_T2];
const TEAM_LEADS = ['Ananya Sen', 'Vikram Mehta', 'Farah Khan'];
const MANAGERS = ['Arjun Malhotra', 'Nisha Rao'];

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#0ea5e9'];

const userInsert = db.prepare(`
  INSERT INTO user_profiles (user_id, name, role, team, status, avatar_color, email)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let uidCounter = 1;
const userOf = (name, role, team) => {
  const uid = `USR-${String(uidCounter++).padStart(4,'0')}`;
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@firstnationalbank.com`;
  const color = COLORS[(uidCounter - 1) % COLORS.length];
  userInsert.run(uid, name, role, team, 'Active', color, email);
};

ANALYSTS_T1.forEach(n => userOf(n, 'AML Analyst L1', 'T1 Monitoring'));
ANALYSTS_T2.forEach(n => userOf(n, 'AML Analyst L2', 'T2 Investigations'));
TEAM_LEADS.forEach(n => userOf(n, 'Team Lead', 'T2 Investigations'));
MANAGERS.forEach(n => userOf(n, 'Compliance Manager', 'Oversight'));

// ─────────────────────────────────────────────── 2. CUSTOMERS (25)

// Each customer record drives accounts + transactions + alert generation
const customerSpecs = [
  // ─── Individuals (15)
  { id: 'CUS-1001', kind: 'I', name: 'Robert Chen',         risk: 'High',    occupation: 'Real estate developer',   employer: 'Chen Properties LLC',   income: 850000, dob: '1968-03-22', ssn: '142-58-3091', city: 'Miami',          state: 'FL', zip: '33139', phone: '305-555-0142', street: '4520 Collins Avenue, Apt 1502',     pep: 0, pattern: 'rapid_movement' },
  { id: 'CUS-1002', kind: 'I', name: 'Marcus Williams',     risk: 'High',    occupation: 'Import/export business owner', employer: 'Williams Trade Co', income: 620000, dob: '1972-11-08', ssn: '236-71-4408', city: 'Newark',         state: 'NJ', zip: '07102', phone: '973-555-0188', street: '180 Market Street, Suite 4',         pep: 0, pattern: 'high_risk_country' },
  { id: 'CUS-1003', kind: 'I', name: 'Jennifer Davis',      risk: 'Medium',  occupation: 'Attorney',                employer: 'Davis Legal Group',     income: 380000, dob: '1976-07-14', ssn: '341-22-9056', city: 'Chicago',        state: 'IL', zip: '60611', phone: '312-555-0162', street: '875 N Michigan Avenue, Floor 38',    pep: 0, pattern: 'normal' },
  { id: 'CUS-1004', kind: 'I', name: 'Carlos Rodriguez',    risk: 'Medium',  occupation: 'Restaurant owner',        employer: 'El Sol Restaurant Group', income: 220000, dob: '1980-05-30', ssn: '522-19-3345', city: 'Houston',       state: 'TX', zip: '77002', phone: '713-555-0124', street: '2210 Westheimer Road',               pep: 0, pattern: 'cash_intensive' },
  { id: 'CUS-1005', kind: 'I', name: 'James Patterson',     risk: 'High',    occupation: 'Retired government official', employer: 'Self (retired)',     income: 165000, dob: '1955-09-17', ssn: '478-33-2089', city: 'Washington',     state: 'DC', zip: '20007', phone: '202-555-0119', street: '3145 N Street NW',                   pep: 1, pattern: 'rapid_movement' },
  { id: 'CUS-1006', kind: 'I', name: 'Sarah Johnson',       risk: 'Low',     occupation: 'Software engineer',       employer: 'TechCorp Solutions Inc',  income: 175000, dob: '1988-12-04', ssn: '612-44-7723', city: 'Seattle',        state: 'WA', zip: '98101', phone: '206-555-0173', street: '1200 4th Avenue, Apt 505',           pep: 0, pattern: 'normal' },
  { id: 'CUS-1007', kind: 'I', name: 'Dr. Emily Thompson',  risk: 'Low',     occupation: 'Physician',               employer: 'Mass General Hospital',   income: 410000, dob: '1979-04-25', ssn: '108-92-5544', city: 'Boston',         state: 'MA', zip: '02114', phone: '617-555-0136', street: '88 Beacon Street',                   pep: 0, pattern: 'normal' },
  { id: 'CUS-1008', kind: 'I', name: 'Tony Marino',         risk: 'Medium',  occupation: 'Car dealership owner',    employer: 'Marino Auto Group',       income: 290000, dob: '1970-08-12', ssn: '224-65-1107', city: 'Philadelphia',   state: 'PA', zip: '19103', phone: '215-555-0155', street: '1500 Walnut Street',                 pep: 0, pattern: 'normal' },
  { id: 'CUS-1009', kind: 'I', name: "Michael O'Brien",     risk: 'Medium',  occupation: 'Construction contractor', employer: "O'Brien Construction Co", income: 245000, dob: '1974-02-19', ssn: '386-44-6612', city: 'Boston',         state: 'MA', zip: '02129', phone: '617-555-0148', street: '120 Bunker Hill Street',             pep: 0, pattern: 'normal' },
  { id: 'CUS-1010', kind: 'I', name: 'Dr. David Kim',       risk: 'Low',     occupation: 'University professor',    employer: 'Stanford University',     income: 195000, dob: '1971-10-03', ssn: '511-77-8829', city: 'Palo Alto',      state: 'CA', zip: '94305', phone: '650-555-0118', street: '459 Lasuen Mall',                    pep: 0, pattern: 'normal' },
  { id: 'CUS-1011', kind: 'I', name: 'Patricia Sanders',    risk: 'Medium',  occupation: 'Financial advisor',       employer: 'Sanders Wealth Mgmt',     income: 320000, dob: '1973-06-28', ssn: '274-88-3301', city: 'Charlotte',      state: 'NC', zip: '28202', phone: '704-555-0167', street: '350 S Tryon Street',                 pep: 0, pattern: 'normal' },
  { id: 'CUS-1012', kind: 'I', name: 'Lisa Martinez',       risk: 'Medium',  occupation: 'Freelance consultant',    employer: 'Self-employed',           income: 145000, dob: '1985-01-22', ssn: '605-31-9907', city: 'Austin',         state: 'TX', zip: '78701', phone: '512-555-0192', street: '801 W 5th Street, Apt 304',          pep: 0, pattern: 'normal' },
  { id: 'CUS-1013', kind: 'I', name: 'Anthony Russo',       risk: 'High',    occupation: 'Jewelry store owner',     employer: 'Russo Fine Jewelers',     income: 540000, dob: '1969-11-30', ssn: '163-22-4451', city: 'Manhattan',      state: 'NY', zip: '10001', phone: '212-555-0103', street: '47 W 47th Street',                   pep: 0, pattern: 'cash_intensive' },
  { id: 'CUS-1014', kind: 'I', name: 'Vincent Castellano',  risk: 'High',    occupation: 'Nightclub owner',         employer: 'Vincent Hospitality LLC', income: 480000, dob: '1976-04-09', ssn: '319-87-5520', city: 'Las Vegas',      state: 'NV', zip: '89109', phone: '702-555-0177', street: '3667 S Las Vegas Boulevard',         pep: 0, pattern: 'cash_intensive' },
  { id: 'CUS-1015', kind: 'I', name: 'Margaret Wilson',     risk: 'Low',     occupation: 'Accountant',              employer: 'Wilson CPA & Associates', income: 135000, dob: '1968-09-15', ssn: '442-15-3308', city: 'Denver',         state: 'CO', zip: '80202', phone: '303-555-0145', street: '1700 Lincoln Street',                pep: 0, pattern: 'normal' },

  // ─── Businesses (10)
  { id: 'CUS-2001', kind: 'B', name: 'Sunrise Diner Group LLC',           dba: 'Sunrise Diners',   risk: 'High',     industry: 'Cash-Intensive Restaurants', biz_type: 'LLC',    employees: 240, ein: '47-3829145', incorp: '2014-06-18', state_inc: 'NJ', city: 'Atlantic City', state: 'NJ', zip: '08401', phone: '609-555-0210', street: '1700 Pacific Avenue',     contact: 'Daniel Reyes',    pattern: 'cash_intensive' },
  { id: 'CUS-2002', kind: 'B', name: 'Pacific Trade Solutions Inc',       dba: 'Pacific Trade',    risk: 'High',     industry: 'Import/Export Trading',     biz_type: 'Inc',    employees: 85,  ein: '83-7146203', incorp: '2017-02-04', state_inc: 'CA', city: 'Long Beach',    state: 'CA', zip: '90802', phone: '562-555-0233', street: '525 E Seaside Way',       contact: 'Michelle Tran',   pattern: 'high_risk_country' },
  { id: 'CUS-2003', kind: 'B', name: 'Manhattan Heights Holdings LLC',    dba: null,               risk: 'High',     industry: 'Real Estate Holdings',      biz_type: 'LLC',    employees: 12,  ein: '92-1054837', incorp: '2019-09-22', state_inc: 'DE', city: 'Manhattan',     state: 'NY', zip: '10019', phone: '212-555-0288', street: '745 5th Avenue, Suite 2200', contact: 'Edward Reinhold', pattern: 'rapid_movement' },
  { id: 'CUS-2004', kind: 'B', name: 'CashFlow MSB LLC',                  dba: 'CashFlow Money Services', risk: 'Very High', industry: 'Money Services Business', biz_type: 'LLC', employees: 45, ein: '36-7892341', incorp: '2018-11-12', state_inc: 'FL', city: 'Miami',  state: 'FL', zip: '33125', phone: '305-555-0301', street: '4200 NW 7th Street',    contact: 'Hector Diaz',     pattern: 'structuring' },
  { id: 'CUS-2005', kind: 'B', name: 'CryptoVault Exchange Inc',          dba: 'CryptoVault',      risk: 'Very High',industry: 'Cryptocurrency Exchange',   biz_type: 'Inc',    employees: 110, ein: '88-4592013', incorp: '2020-03-18', state_inc: 'WY', city: 'Sheridan',      state: 'WY', zip: '82801', phone: '307-555-0324', street: '30 N Gould Street',       contact: 'Aaron Singh',     pattern: 'high_risk_country' },
  { id: 'CUS-2006', kind: 'B', name: 'Adler Webb & Associates LLP',       dba: null,               risk: 'Medium',   industry: 'Law Firm',                  biz_type: 'LLP',    employees: 78,  ein: '52-9134076', incorp: '2008-05-30', state_inc: 'NY', city: 'Manhattan',     state: 'NY', zip: '10017', phone: '212-555-0265', street: '550 Madison Avenue',      contact: 'Karen Webb',      pattern: 'normal' },
  { id: 'CUS-2007', kind: 'B', name: 'Riverside Family Medicine PC',      dba: null,               risk: 'Low',      industry: 'Medical Practice',          biz_type: 'PC',     employees: 32,  ein: '64-1247589', incorp: '2011-08-08', state_inc: 'IL', city: 'Riverside',     state: 'IL', zip: '60546', phone: '708-555-0179', street: '440 Burlington Street',   contact: 'Dr. Anita Kapoor', pattern: 'normal' },
  { id: 'CUS-2008', kind: 'B', name: 'Eastern Wholesale Distributors Inc',dba: 'Eastern Wholesale',risk: 'Medium',   industry: 'Wholesale Distribution',    biz_type: 'Inc',    employees: 165, ein: '71-4582093', incorp: '2009-12-14', state_inc: 'PA', city: 'Pittsburgh',    state: 'PA', zip: '15222', phone: '412-555-0245', street: '600 Grant Street, Suite 800', contact: 'Robert Kowalski', pattern: 'normal' },
  { id: 'CUS-2009', kind: 'B', name: 'Global Holdings Trust LLC',         dba: null,               risk: 'Very High',industry: 'Holding Company (Shell)',   biz_type: 'LLC',    employees: 4,   ein: '95-8273401', incorp: '2021-07-11', state_inc: 'DE', city: 'Wilmington',    state: 'DE', zip: '19801', phone: '302-555-0392', street: '1209 Orange Street',      contact: 'Trust Administrator', pattern: 'rapid_movement' },
  { id: 'CUS-2010', kind: 'B', name: 'Diamond Coast Trading Inc',          dba: 'Diamond Coast',    risk: 'Very High',industry: 'Precious Metals & Stones',  biz_type: 'Inc',    employees: 42,  ein: '67-3914528', incorp: '2015-04-02', state_inc: 'MA', city: 'Cambridge',     state: 'MA', zip: '02142', phone: '617-555-0271', street: '155 Broadway',            contact: 'Yuki Nakamura',   pattern: 'high_risk_country' }
];

// Risk distribution check at runtime
const riskCounts = customerSpecs.reduce((m, c) => { m[c.risk] = (m[c.risk]||0) + 1; return m; }, {});
console.log('[seed_full] customer risk distribution:', riskCounts);

// KYC status: spec wants 15 Current / 5 Due Soon / 3 Overdue / 2 In Review (= 25)
const KYC_PLAN = [
  // overdue (3) — KYC due in past
  { id: 'CUS-2009', status: 'Overdue', due_offset: -45 },
  { id: 'CUS-2004', status: 'Overdue', due_offset: -22 },
  { id: 'CUS-1005', status: 'Overdue', due_offset: -12 },
  // due-soon (5) — within 30 days
  { id: 'CUS-2005', status: 'Due Soon', due_offset: 8 },
  { id: 'CUS-2002', status: 'Due Soon', due_offset: 14 },
  { id: 'CUS-1014', status: 'Due Soon', due_offset: 20 },
  { id: 'CUS-1013', status: 'Due Soon', due_offset: 25 },
  { id: 'CUS-1002', status: 'Due Soon', due_offset: 28 },
  // in review (2) — open kyc_review record
  { id: 'CUS-2003', status: 'In Review', due_offset: 60 },
  { id: 'CUS-1001', status: 'In Review', due_offset: 90 }
];

// ─────────────────────────────────────────────── 3. CUSTOMERS INSERT

const insertCustomer = db.prepare(`
  INSERT INTO customers (
    customer_id, customer_name, customer_type, segment, customer_risk_rating,
    pep_match, sanctions_match, kyc_review_status,
    date_of_birth, nationality, government_id_type, government_id_number, customer_since_date,
    residential_address, mailing_address, country_of_residence, phone_number, email_address,
    last_kyc_review_date, next_kyc_due_date, cdd_level,
    trading_name, registration_number, date_of_incorporation, country_of_incorporation,
    business_type, industry, naics_code, annual_turnover_range, number_of_employees,
    beneficial_owners, directors,
    employer_name, job_title, employment_type, annual_income_range,
    source_of_funds, source_of_wealth,
    expected_monthly_volume, expected_monthly_value, expected_transaction_types,
    primary_countries, onboarding_notes
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?
  )
`);

const CDD_BY_RISK = { 'Low': 'Standard', 'Medium': 'Standard', 'High': 'Enhanced', 'Very High': 'Enhanced' };
const KYC_INTERVAL = { 'Low': 1095, 'Medium': 730, 'High': 365, 'Very High': 180 };

const TURNOVER_BY_RISK = {
  'Low':       ['$1M – $10M', '$10M – $50M'],
  'Medium':    ['$10M – $50M', '$50M – $250M'],
  'High':      ['$50M – $250M', '$250M – $500M'],
  'Very High': ['$250M – $500M', '$500M +']
};

const INDIVIDUAL_INCOME_BAND = (income) => {
  if (income < 150000) return '$100K – $150K';
  if (income < 250000) return '$150K – $250K';
  if (income < 500000) return '$250K – $500K';
  if (income < 1000000) return '$500K – $1M';
  return '$1M +';
};

const SRC_OF_FUNDS_INDIVIDUAL = ['Salary and bonus', 'Business income', 'Investment returns', 'Real estate income', 'Professional fees'];
const SRC_OF_FUNDS_BUSINESS = ['Operating revenue', 'Trade receivables', 'Investment income', 'Capital contributions', 'Loan proceeds'];

const customerById = new Map();

function kycPlanFor(c) {
  const plan = KYC_PLAN.find(k => k.id === c.id);
  if (plan) {
    const dueDate = ymd(addDays(REFERENCE_DATE, plan.due_offset));
    const lastDate = ymd(addDays(dueDate, -KYC_INTERVAL[c.risk]));
    return { last: lastDate, next: dueDate, status: plan.status };
  }
  // Default: current
  const r = rng(c.id + '_kyc');
  const interval = KYC_INTERVAL[c.risk];
  // last review: 30 to (interval - 60) days ago
  const ago = intIn(r, 30, interval - 60);
  const last = ymd(addDays(REFERENCE_DATE, -ago));
  const next = ymd(addDays(last, interval));
  return { last, next, status: 'Current' };
}

for (const c of customerSpecs) {
  const r = rng(c.id);
  const cdd = CDD_BY_RISK[c.risk] || 'Standard';
  const kyc = kycPlanFor(c);
  const expVolume = c.kind === 'B' ? intIn(r, 200, 800) : intIn(r, 20, 80);
  const baseValue = c.risk === 'Very High' ? 5_000_000 : c.risk === 'High' ? 1_500_000 : c.risk === 'Medium' ? 400_000 : 80_000;
  const expValue = c.kind === 'B' ? baseValue * 4 : baseValue;

  customerById.set(c.id, c);

  if (c.kind === 'I') {
    insertCustomer.run(
      c.id, c.name, 'Individual', c.occupation, c.risk,
      c.pep || 0, 0, kyc.status,
      c.dob, 'United States', 'SSN', c.ssn, ymd(addDays(REFERENCE_DATE, -intIn(r, 365, 3650))),
      `${c.street}, ${c.city}, ${c.state} ${c.zip}`, null, 'United States', c.phone, `${c.name.toLowerCase().replace(/[^a-z]+/g, '.')}@email.com`,
      kyc.last, kyc.next, cdd,
      null, null, null, null,
      null, c.occupation, null, null, null,
      null, null,
      c.employer, c.occupation, 'Full-time', INDIVIDUAL_INCOME_BAND(c.income),
      pick(r, SRC_OF_FUNDS_INDIVIDUAL), 'Earnings, savings and prudent investments',
      expVolume, expValue,
      JSON.stringify(['ACH credit', 'Wire transfer', 'Check deposit', 'Debit card POS']),
      JSON.stringify(['United States']),
      `Customer onboarded ${BANK_BRANCH}; ${c.occupation}; ${c.pep ? 'PEP - enhanced monitoring active.' : 'standard CIP completed.'}`
    );
  } else {
    const ownerNames = c.contact ? [c.contact, ...['Lawrence Stein', 'Maria Gonzalez', 'Daniel Park', 'Sandra Lewis'].slice(0, intIn(r, 1, 3))] : [];
    const owners = ownerNames.map((name, i) => ({
      name,
      pct: i === 0 ? 51 + Math.floor(r() * 30) : 5 + Math.floor(r() * 15),
      nationality: 'United States'
    }));
    insertCustomer.run(
      c.id, c.name, 'Business', c.industry, c.risk,
      0, 0, kyc.status,
      null, 'United States', 'EIN', c.ein, c.incorp,
      `${c.street}, ${c.city}, ${c.state} ${c.zip}`, null, 'United States', c.phone, `compliance@${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
      kyc.last, kyc.next, cdd,
      c.dba || c.name, c.ein, c.incorp, 'United States',
      c.biz_type, c.industry, String(intIn(r, 100000, 999999)).slice(0,6), pick(r, TURNOVER_BY_RISK[c.risk]), c.employees,
      JSON.stringify(owners), JSON.stringify(ownerNames),
      null, null, null, null,
      pick(r, SRC_OF_FUNDS_BUSINESS), 'Founders capital, retained earnings and operating revenue',
      expVolume, expValue,
      JSON.stringify(['ACH credit', 'ACH debit', 'Wire transfer (in)', 'Wire transfer (out)', 'Cash deposit', 'Check deposit']),
      JSON.stringify(c.risk === 'Very High' ? ['United States', 'Cayman Islands', 'British Virgin Islands'] : ['United States', 'Canada', 'Mexico']),
      `Onboarded ${c.incorp} via ${BANK_BRANCH}. Industry: ${c.industry}. State of incorporation: ${c.state_inc}.`
    );
  }
}

// ─────────────────────────────────────────────── 4. ACCOUNTS

const insertAccount = db.prepare(`
  INSERT INTO accounts (account_number, customer_id, account_type, currency, status, opened_date, current_balance)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const accountsByCustomer = new Map();   // customer_id → [account_number]
const accountIdSeq = { n: 1 };
const nextAcct = (cid) => {
  const num = `4001${String(accountIdSeq.n++).padStart(7, '0')}`;
  return num;
};

function balanceRange(c) {
  if (c.kind === 'B') return [10_000, 2_000_000];
  if (c.risk === 'High' || c.risk === 'Very High') return [50_000, 500_000];
  return [5_000, 50_000];
}

for (const c of customerSpecs) {
  const r = rng(c.id + '_acct');
  const [lo, hi] = balanceRange(c);
  const accountCount = c.kind === 'B' ? intIn(r, 2, 4) : intIn(r, 2, 3);
  const accounts = [];

  for (let i = 0; i < accountCount; i++) {
    const num = nextAcct();
    const type = c.kind === 'B'
      ? (i === 0 ? 'Business Checking' : i === 1 ? 'Money Market' : i === 2 ? 'Business Savings' : 'Operating Account')
      : (i === 0 ? 'Checking' : i === 1 ? 'Savings' : 'Money Market');
    const balance = moneyIn(r, lo, hi);
    const opened = c.kind === 'B' ? c.incorp : ymd(addDays(REFERENCE_DATE, -intIn(r, 365, 3650)));
    insertAccount.run(num, c.id, type, 'USD', 'Active', opened, balance);
    accounts.push(num);
  }
  accountsByCustomer.set(c.id, accounts);
}

// ─────────────────────────────────────────────── 5. TRANSACTIONS

const insertTxn = db.prepare(`
  INSERT INTO transactions (
    transaction_id, account_number, customer_id, txn_date, txn_time,
    txn_type, channel, description, counterparty, counterparty_country,
    amount, running_balance, is_alerted, alert_id,
    scenario_triggered, rule_breached, risk_score
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const txnSeq = { n: 1 };
const nextTxnId = () => `TXN${String(txnSeq.n++).padStart(8, '0')}`;

const NORMAL_DESCRIPTIONS_INDIVIDUAL = [
  ['Direct deposit - payroll', 'ACH', 'Credit'],
  ['Mortgage payment', 'ACH', 'Debit'],
  ['Electric utility bill', 'ACH', 'Debit'],
  ['Internet service - Comcast', 'ACH', 'Debit'],
  ['Wholefoods Market POS', 'Debit Card', 'Debit'],
  ['Amazon online purchase', 'Online', 'Debit'],
  ['Costco Wholesale POS', 'Debit Card', 'Debit'],
  ['ATM cash withdrawal', 'ATM', 'Debit'],
  ['Tax refund - IRS', 'ACH', 'Credit'],
  ['Investment dividend - Vanguard', 'ACH', 'Credit'],
  ['Health insurance premium', 'ACH', 'Debit'],
  ['Car insurance - Geico', 'ACH', 'Debit']
];
const NORMAL_DESCRIPTIONS_BUSINESS = [
  ['Customer ACH receipt', 'ACH', 'Credit'],
  ['Vendor payment', 'ACH', 'Debit'],
  ['Payroll batch', 'ACH', 'Debit'],
  ['Lease payment', 'Wire', 'Debit'],
  ['Wholesale customer wire', 'Wire', 'Credit'],
  ['Business loan payment', 'ACH', 'Debit'],
  ['Insurance premium', 'ACH', 'Debit'],
  ['Equipment finance', 'ACH', 'Debit'],
  ['Tax payment - state', 'ACH', 'Debit'],
  ['Customer check deposit', 'Check', 'Credit']
];

const HIGH_RISK_COUNTRIES = ['Myanmar', 'Syria', 'Yemen', 'Iran', 'Russia', 'North Korea', 'Pakistan', 'Haiti'];
const HIGH_RISK_COUNTERPARTIES = {
  'Myanmar':     ['Yangon Industries Co Ltd', 'Mandalay Trading Group'],
  'Syria':       ['Damascus Holdings'],
  'Yemen':       ['Sana\'a Imports Ltd'],
  'Iran':        ['Tehran Pearl Trading', 'Persian Gulf Logistics'],
  'Russia':      ['Sibir Resources OJSC', 'Volga Industrial Trust'],
  'North Korea': ['Pyongyang General Trading'],
  'Pakistan':    ['Karachi Textile Mills', 'Lahore Trading Corp'],
  'Haiti':       ['Port-au-Prince Imports']
};

const OFAC_LIKE_NAMES = [
  'Volkov Holdings BV',
  'Al-Saqr Trading FZE',
  'Konnex Logistik GmbH (sanctions match)',
  'Caspian Sea Holdings Ltd',
  'Pearl River Maritime Co',
  'Northwood Capital Partners (alias hit)'
];

const txnsByCustomer = new Map();   // cid → [txn objects in chrono order]

for (const c of customerSpecs) {
  const r = rng(c.id + '_txn');
  const accounts = accountsByCustomer.get(c.id);
  const primaryAcct = accounts[0];
  const txns = [];

  // 1. Generate normal background activity (50-80 per customer over 12 months)
  const normalCount = intIn(r, 50, 80);
  const dictionary = c.kind === 'B' ? NORMAL_DESCRIPTIONS_BUSINESS : NORMAL_DESCRIPTIONS_INDIVIDUAL;
  for (let i = 0; i < normalCount; i++) {
    const daysAgo = intIn(r, 0, 365);
    const date = addDays(REFERENCE_DATE, -daysAgo);
    const [desc, channel, type] = pick(r, dictionary);
    let amount;
    if (c.kind === 'B') {
      amount = moneyIn(r, 800, c.risk === 'Very High' ? 250_000 : c.risk === 'High' ? 75_000 : 35_000);
    } else {
      amount = type === 'Credit'
        ? moneyIn(r, 1500, Math.round(c.income / 12 * 1.2))
        : moneyIn(r, 50, 5500);
    }
    txns.push({
      id: nextTxnId(),
      account: pick(r, accounts),
      date: ymd(date),
      time: `${String(intIn(r, 8, 19)).padStart(2,'0')}:${String(intIn(r, 0, 59)).padStart(2,'0')}:${String(intIn(r, 0, 59)).padStart(2,'0')}`,
      type,
      channel,
      description: desc,
      counterparty: c.kind === 'B' ? `Vendor #${intIn(r, 1000, 9999)}` : 'Self-managed',
      country: 'United States',
      amount,
      is_alerted: 0
    });
  }

  // 2. Generate suspicious patterns for HIGH/VERY HIGH customers
  // Each pattern produces a tagged group of transactions which will later become alerts
  if (c.pattern === 'structuring') {
    // 2 separate structuring episodes
    const episodes = c.risk === 'Very High' ? 4 : 2;
    for (let ep = 0; ep < episodes; ep++) {
      const anchorDays = intIn(r, 7, 350);
      const baseDate = addDays(REFERENCE_DATE, -anchorDays);
      const numDeposits = intIn(r, 3, 5);
      for (let d = 0; d < numDeposits; d++) {
        const offset = intIn(r, 0, 9);
        const date = addDays(baseDate, offset);
        const amount = moneyIn(r, 9100, 9950);
        txns.push({
          id: nextTxnId(),
          account: primaryAcct,
          date: ymd(date),
          time: `${String(intIn(r, 9, 16)).padStart(2,'0')}:${String(intIn(r, 0, 59)).padStart(2,'0')}:00`,
          type: 'Credit',
          channel: 'Branch',
          description: `Cash deposit - $${amount.toLocaleString()}`,
          counterparty: 'Branch teller deposit',
          country: 'United States',
          amount,
          is_alerted: 1,
          pattern_tag: { kind: 'Structuring', episode: ep, anchor_date: ymd(baseDate.getTime() > REFERENCE_DATE.getTime() ? REFERENCE_DATE : addDays(baseDate, 9)), customer_id: c.id }
        });
      }
    }
  }

  if (c.pattern === 'rapid_movement') {
    const episodes = c.risk === 'Very High' ? 3 : 2;
    for (let ep = 0; ep < episodes; ep++) {
      const anchorDays = intIn(r, 14, 340);
      const baseDate = addDays(REFERENCE_DATE, -anchorDays);
      const inboundAmount = moneyIn(r, 250_000, 800_000);
      const inCountry = pick(r, ['United Kingdom', 'Singapore', 'United Arab Emirates', 'Switzerland']);
      txns.push({
        id: nextTxnId(),
        account: primaryAcct,
        date: ymd(baseDate),
        time: '09:30:00',
        type: 'Credit',
        channel: 'Wire',
        description: `Inbound wire from overseas`,
        counterparty: `Offshore Holdings Trust (${inCountry})`,
        country: inCountry,
        amount: inboundAmount,
        is_alerted: 1,
        pattern_tag: { kind: 'Rapid Movement', episode: ep, anchor_date: ymd(addDays(baseDate, 2)), customer_id: c.id }
      });
      // Multiple small outs within 48 hours
      const numOuts = intIn(r, 4, 7);
      let remaining = inboundAmount;
      for (let o = 0; o < numOuts; o++) {
        const out = o === numOuts - 1 ? Math.max(40_000, remaining) : moneyIn(r, 40_000, 80_000);
        remaining -= out;
        const offsetMinutes = intIn(r, 30, 47 * 60);
        const dt = new Date(baseDate.getTime() + offsetMinutes * 60_000);
        txns.push({
          id: nextTxnId(),
          account: primaryAcct,
          date: ymd(dt),
          time: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:00`,
          type: 'Debit',
          channel: 'Wire',
          description: 'Outbound wire to related entity',
          counterparty: pick(r, ['Northbridge Capital LLC', 'Westwind Investments Inc', 'Crystal Coast Trust', 'Apex Onshore LLC']),
          country: 'United States',
          amount: out,
          is_alerted: 1,
          pattern_tag: { kind: 'Rapid Movement', episode: ep, anchor_date: ymd(addDays(baseDate, 2)), customer_id: c.id }
        });
      }
    }
  }

  if (c.pattern === 'cash_intensive') {
    const weeksWithDeposits = c.risk === 'Very High' ? 16 : 10;
    for (let w = 0; w < weeksWithDeposits; w++) {
      const anchorDays = intIn(r, 14, 350);
      const baseDate = addDays(REFERENCE_DATE, -anchorDays);
      const amount = moneyIn(r, 15_000, 40_000);
      txns.push({
        id: nextTxnId(),
        account: primaryAcct,
        date: ymd(baseDate),
        time: `${String(intIn(r, 10, 16)).padStart(2,'0')}:00:00`,
        type: 'Credit',
        channel: 'Branch',
        description: 'Bulk cash deposit',
        counterparty: 'Branch teller deposit',
        country: 'United States',
        amount,
        is_alerted: 1,
        pattern_tag: { kind: 'Cash Intensive', episode: w, anchor_date: ymd(baseDate), customer_id: c.id }
      });
    }
  }

  if (c.pattern === 'high_risk_country') {
    const episodes = c.risk === 'Very High' ? 5 : 3;
    for (let ep = 0; ep < episodes; ep++) {
      const country = pick(r, HIGH_RISK_COUNTRIES);
      const counter = pick(r, HIGH_RISK_COUNTERPARTIES[country]);
      const anchorDays = intIn(r, 14, 350);
      const baseDate = addDays(REFERENCE_DATE, -anchorDays);
      const numWires = intIn(r, 1, 6);
      for (let w = 0; w < numWires; w++) {
        txns.push({
          id: nextTxnId(),
          account: primaryAcct,
          date: ymd(addDays(baseDate, w * 2)),
          time: '11:00:00',
          type: pick(r, ['Credit', 'Debit']),
          channel: 'Wire',
          description: `Wire transfer ${w === 0 ? 'to' : 'from'} ${country}`,
          counterparty: counter,
          country,
          amount: moneyIn(r, 25_000, 200_000),
          is_alerted: 1,
          pattern_tag: { kind: 'High Risk Country', episode: ep, anchor_date: ymd(baseDate), customer_id: c.id, country }
        });
      }
    }
  }

  // Watchlist hits — add to several HIGH/VERY HIGH customers regardless of primary pattern
  if (['High', 'Very High'].includes(c.risk)) {
    const hits = c.risk === 'Very High' ? 3 : 1;
    for (let h = 0; h < hits; h++) {
      const anchorDays = intIn(r, 21, 340);
      const baseDate = addDays(REFERENCE_DATE, -anchorDays);
      const counter = pick(r, OFAC_LIKE_NAMES);
      txns.push({
        id: nextTxnId(),
        account: primaryAcct,
        date: ymd(baseDate),
        time: '14:15:00',
        type: pick(r, ['Credit', 'Debit']),
        channel: 'Wire',
        description: `Wire transfer counterparty match: ${counter}`,
        counterparty: counter,
        country: pick(r, ['Cyprus', 'Panama', 'British Virgin Islands', 'Cayman Islands']),
        amount: moneyIn(r, 50_000, 250_000),
        is_alerted: 1,
        pattern_tag: { kind: 'Watchlist Hit', episode: h, anchor_date: ymd(baseDate), customer_id: c.id }
      });
    }
  }

  txnsByCustomer.set(c.id, txns);
}

// ─────────────────────────────────────────────── 6. ALERTS

// Plan: 250 alerts. Pattern-tagged transactions form alerts; remaining alerts are
// drawn from non-pattern customers as Watchlist Hit / Cash Intensive false positives etc.
//
// We want to hit:
//   - Scenario distribution: Structuring 70, High Risk Jurisdiction 55, Watchlist 45,
//     Cash Intensive 40, Rapid Movement 25, Trade Based ML 15  = 250
//   - Priority: 60 H / 120 M / 70 L
//   - Status: 90 FP / 35 SAR-escalated / 25 L2-escalated / 55 IP / 30 NS / 15 U
//   - SLA result: 180 on time / 45 breached / 15 at-risk / 10 warning
//   - Analyst load: Rohit 60, Priya 55, Amit 50, Neha 45, Sanjay 40 (15 unassigned)

const SLA_DAYS = { 'High': 3, 'Medium': 7, 'Low': 15 };

const insertAlert = db.prepare(`
  INSERT INTO alerts (
    alert_id, customer_id, customer_name, customer_type, segment,
    scenario, scenario_description, alert_status, priority, risk_score,
    amount_flagged_inr, txn_count_flagged, counterparty_country, channel, branch,
    assigned_to, created_date, last_activity_date, closed_date,
    age_days, sla_days, sla_deadline, sla_breached, due_status,
    case_converted, case_id, disposition, customer_risk_rating,
    pep_match, sanctions_match, kyc_review_status, created_by,
    linked_sar_id, narrative_seed, escalated_to
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?
  )
`);

// Group pattern-tagged transactions into alert candidates
const alertCandidates = [];
for (const c of customerSpecs) {
  const txns = txnsByCustomer.get(c.id) || [];
  const groupKey = (t) => `${t.pattern_tag.kind}__${t.pattern_tag.episode}`;
  const groups = {};
  for (const t of txns) {
    if (!t.is_alerted || !t.pattern_tag) continue;
    const k = groupKey(t);
    (groups[k] ||= { kind: t.pattern_tag.kind, customer: c, anchor: t.pattern_tag.anchor_date, country: t.pattern_tag.country, txns: [] })
      .txns.push(t);
  }
  for (const g of Object.values(groups)) alertCandidates.push(g);
}

// Trim/expand to exact scenario quotas
const SCENARIO_QUOTA = {
  'Structuring':       70,
  'High Risk Country': 55,
  'Watchlist Hit':     45,
  'Cash Intensive':    40,
  'Rapid Movement':    25,
  'Trade Based ML':    15
};
const SCENARIO_DISPLAY = {
  'Structuring':       'Structuring',
  'High Risk Country': 'High Risk Country',
  'Watchlist Hit':     'Watchlist Hit',
  'Cash Intensive':    'Cash Intensive',
  'Rapid Movement':    'Rapid Movement',
  'Trade Based ML':    'Trade Based ML'
};

const candidatesByKind = {};
for (const ac of alertCandidates) (candidatesByKind[ac.kind] ||= []).push(ac);

// Build the final 250-alert list
const alertPlan = [];

function pushAlert(scenario, custom = {}) {
  alertPlan.push({ scenario, ...custom });
}

// Pull existing pattern-grouped candidates first
for (const [kind, list] of Object.entries(candidatesByKind)) {
  const quota = SCENARIO_QUOTA[kind] || 0;
  const take = Math.min(quota, list.length);
  for (let i = 0; i < take; i++) {
    const ac = list[i];
    pushAlert(kind, {
      customer: ac.customer,
      anchor_date: ac.anchor,
      txns: ac.txns,
      country: ac.country
    });
  }
  candidatesByKind[kind] = list.slice(take);
}

// Top up each scenario to its quota with synthetic alerts referencing existing customers
const HIGH_RISK_CUSTOMERS = customerSpecs.filter(c => c.risk === 'High' || c.risk === 'Very High');
const ALL_CUSTOMERS_FOR_FP = customerSpecs;
const TBM_COUNTRIES = ['China', 'Hong Kong', 'Singapore', 'United Arab Emirates', 'Turkey', 'Vietnam'];

for (const [kind, quota] of Object.entries(SCENARIO_QUOTA)) {
  const have = alertPlan.filter(a => a.scenario === kind).length;
  const need = quota - have;
  for (let i = 0; i < need; i++) {
    // For FP-heavy scenarios use any customer; for high-risk scenarios prefer high-risk customers
    const pool = ['Watchlist Hit', 'High Risk Country', 'Trade Based ML'].includes(kind)
      ? (i % 3 === 0 ? ALL_CUSTOMERS_FOR_FP : HIGH_RISK_CUSTOMERS)
      : ALL_CUSTOMERS_FOR_FP;
    const r = rng(`${kind}_synth_${i}`);
    const c = pool[Math.floor(r() * pool.length)];
    const anchorDays = intIn(r, 7, 360);
    const anchor = ymd(addDays(REFERENCE_DATE, -anchorDays));
    let country = 'United States';
    if (kind === 'High Risk Country') country = pick(r, HIGH_RISK_COUNTRIES);
    if (kind === 'Trade Based ML')   country = pick(r, TBM_COUNTRIES);
    if (kind === 'Watchlist Hit')    country = pick(r, ['Cyprus', 'Panama', 'British Virgin Islands']);
    pushAlert(kind, { customer: c, anchor_date: anchor, txns: [], country });
  }
}

// Now assign priority/status/disposition/sla according to spec quotas
const r0 = rng('plan_master');

// Shuffle alertPlan deterministically
for (let i = alertPlan.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [alertPlan[i], alertPlan[j]] = [alertPlan[j], alertPlan[i]];
}

// Priority quotas (sequential assignment)
const priorityQueue = [
  ...Array(60).fill('High'),
  ...Array(120).fill('Medium'),
  ...Array(70).fill('Low')
];
// shuffle priorityQueue
for (let i = priorityQueue.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [priorityQueue[i], priorityQueue[j]] = [priorityQueue[j], priorityQueue[i]];
}
alertPlan.forEach((a, i) => a.priority = priorityQueue[i]);

// Status quotas
const statusQueue = [
  ...Array(90).fill('Closed-FP'),
  ...Array(35).fill('Closed-SAR'),
  ...Array(25).fill('Closed-L2'),
  ...Array(55).fill('Work in Progress'),
  ...Array(30).fill('Not Started'),
  ...Array(15).fill('Unassigned')
];
for (let i = statusQueue.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [statusQueue[i], statusQueue[j]] = [statusQueue[j], statusQueue[i]];
}
alertPlan.forEach((a, i) => a.status_label = statusQueue[i]);

// SLA bucket assignment for OPEN alerts (status not closed)
const openAlerts = alertPlan.filter(a => !a.status_label.startsWith('Closed-'));
const closedAlerts = alertPlan.filter(a => a.status_label.startsWith('Closed-'));

// SLA quotas across all 250: 180 on-time / 45 breached / 15 at-risk / 10 warning
// Closed alerts: ~150 (90+35+25). Open alerts: 100. Warning/at-risk only apply to open.
//   - Allocate 25 of the 45 breached to OPEN alerts (oldest), 20 to CLOSED-late
//   - 15 at-risk + 10 warning go to OPEN
//   - Remaining open (50): on-time
//   - Remaining closed (130): on-time

const openSlaMix = [
  ...Array(25).fill('breached'),
  ...Array(15).fill('at_risk'),
  ...Array(10).fill('warning'),
  ...Array(50).fill('on_time')
];
for (let i = openSlaMix.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [openSlaMix[i], openSlaMix[j]] = [openSlaMix[j], openSlaMix[i]];
}
openAlerts.forEach((a, i) => a.sla_label = openSlaMix[i]);

const closedSlaMix = [
  ...Array(20).fill('breached'),
  ...Array(closedAlerts.length - 20).fill('on_time')
];
for (let i = closedSlaMix.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [closedSlaMix[i], closedSlaMix[j]] = [closedSlaMix[j], closedSlaMix[i]];
}
closedAlerts.forEach((a, i) => a.sla_label = closedSlaMix[i]);

// Assign analyst (Rohit 60, Priya 55, Amit 50, Neha 45, Sanjay 40, plus 15 unassigned)
// Unassigned alerts already have status_label='Unassigned'
const analystQueue = [
  ...Array(60).fill('Rohit Sharma'),
  ...Array(55).fill('Priya Nair'),
  ...Array(50).fill('Amit Verma'),
  ...Array(45).fill('Neha Iyer'),
  ...Array(40).fill('Sanjay Patil')
];   // total 250

for (let i = analystQueue.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [analystQueue[i], analystQueue[j]] = [analystQueue[j], analystQueue[i]];
}

// Assign analysts to non-Unassigned alerts; Unassigned gets null
let aPtr = 0;
for (const a of alertPlan) {
  if (a.status_label === 'Unassigned') a.assigned_to = null;
  else { a.assigned_to = analystQueue[aPtr++]; }
}

// Compute creation_date / closed_date / sla_deadline based on labels
function chooseDates(a) {
  const slaDays = SLA_DAYS[a.priority];
  const r = rng(`alert_dates_${a.priority}_${a.sla_label}_${a.status_label}_${alertPlan.indexOf(a)}`);

  // Closed alerts: pick creation 1-360 days ago
  if (a.status_label.startsWith('Closed-')) {
    const ageDays = intIn(r, 1, 350);
    const created = addDays(REFERENCE_DATE, -ageDays);
    let resolutionDays;
    if (a.sla_label === 'breached') {
      resolutionDays = slaDays + intIn(r, 1, slaDays * 2 + 5);
    } else {
      resolutionDays = intIn(r, 1, Math.max(1, slaDays - 1));
    }
    const closed = addDays(created, resolutionDays);
    if (closed.getTime() > REFERENCE_DATE.getTime()) closed.setTime(REFERENCE_DATE.getTime());
    return { created: ymd(created), closed: ymd(closed), sla_deadline: ymd(addDays(created, slaDays)) };
  }

  // Open alerts:
  let createdAgo;
  if (a.sla_label === 'breached') {
    // older than slaDays; deadline already passed
    createdAgo = slaDays + intIn(r, 2, 60);
  } else if (a.sla_label === 'at_risk') {
    // deadline within next 24h => createdAgo = slaDays - 1
    createdAgo = slaDays - 1;
  } else if (a.sla_label === 'warning') {
    // deadline within 24-48h => createdAgo = slaDays - 2
    createdAgo = Math.max(0, slaDays - 2);
  } else {
    // on time: created such that deadline > 48h
    createdAgo = intIn(r, 0, Math.max(0, slaDays - 3));
  }
  const created = addDays(REFERENCE_DATE, -createdAgo);
  return { created: ymd(created), closed: null, sla_deadline: ymd(addDays(created, slaDays)) };
}

// Risk score and amount
function buildAlertRow(a, idx) {
  const dates = chooseDates(a);
  const r = rng(`alert_row_${idx}`);
  const riskScore = a.priority === 'High' ? intIn(r, 80, 95) : a.priority === 'Medium' ? intIn(r, 55, 80) : intIn(r, 30, 55);

  // Amount: prefer real txn aggregate if available
  let amount;
  let txnCount;
  let counterCountry = a.country || 'United States';
  let channel;
  if (a.txns && a.txns.length > 0) {
    amount = a.txns.reduce((s, t) => s + t.amount, 0);
    txnCount = a.txns.length;
    counterCountry = a.txns[0].country || counterCountry;
    channel = a.txns[0].channel;
  } else {
    txnCount = intIn(r, 1, 8);
    amount = moneyIn(r, 12_000, 220_000);
    channel = pick(r, ['Wire', 'ACH', 'Branch', 'Online']);
  }

  let scenarioDescription;
  switch (a.scenario) {
    case 'Structuring':
      scenarioDescription = `Multiple cash deposits totaling $${amount.toLocaleString()} across ${txnCount} transactions, each below the $10,000 CTR reporting threshold. Pattern consistent with structuring.`;
      break;
    case 'High Risk Country':
      scenarioDescription = `Cross-border ${channel.toLowerCase()} transfers ${a.txns?.[0]?.type === 'Credit' ? 'from' : 'to'} ${counterCountry} totaling $${amount.toLocaleString()}; FATF high-risk jurisdiction.`;
      break;
    case 'Watchlist Hit':
      scenarioDescription = `Counterparty screening generated an OFAC/adverse-media match; recent related activity totals $${amount.toLocaleString()} across ${txnCount} transaction(s).`;
      break;
    case 'Cash Intensive':
      scenarioDescription = `Recurring large cash deposits totaling $${amount.toLocaleString()} inconsistent with stated business profile.`;
      break;
    case 'Rapid Movement':
      scenarioDescription = `Large inbound wires totaling $${amount.toLocaleString()} followed by multiple smaller outbound wires within 48 hours; layering pattern.`;
      break;
    case 'Trade Based ML':
      scenarioDescription = `Trade finance activity with ${counterCountry}; invoice/shipment values appear inconsistent with declared goods. Aggregate exposure $${amount.toLocaleString()}.`;
      break;
    default:
      scenarioDescription = `Unusual activity totaling $${amount.toLocaleString()}.`;
  }

  // Status mapping
  let alertStatus, disposition, caseConverted, escalatedTo, linkedSarId, lastActivityDate, closedBy;
  switch (a.status_label) {
    case 'Unassigned':
      alertStatus = 'Unassigned'; disposition = 'Awaiting Triage'; caseConverted = 0;
      escalatedTo = null; linkedSarId = null; lastActivityDate = dates.created; closedBy = null;
      break;
    case 'Not Started':
      alertStatus = 'Not Started'; disposition = 'Awaiting Triage'; caseConverted = 0;
      escalatedTo = null; linkedSarId = null; lastActivityDate = dates.created; closedBy = null;
      break;
    case 'Work in Progress':
      alertStatus = 'Work in Progress'; disposition = null; caseConverted = 0;
      escalatedTo = null; linkedSarId = null;
      lastActivityDate = ymd(addDays(dates.created, intIn(r, 1, 5))); closedBy = null;
      break;
    case 'Closed-FP':
      alertStatus = 'Completed'; disposition = 'False Positive — Closed'; caseConverted = 0;
      escalatedTo = null; linkedSarId = null; lastActivityDate = dates.closed; closedBy = a.assigned_to;
      break;
    case 'Closed-L2':
      alertStatus = 'Completed'; disposition = 'Escalated to L2'; caseConverted = 1;
      escalatedTo = pick(r, ANALYSTS_T2); linkedSarId = null;
      lastActivityDate = dates.closed; closedBy = a.assigned_to;
      break;
    case 'Closed-SAR':
      alertStatus = 'Completed'; disposition = 'Escalated to SAR Filing'; caseConverted = 1;
      escalatedTo = pick(r, ANALYSTS_T2); linkedSarId = null; // set later
      lastActivityDate = dates.closed; closedBy = a.assigned_to;
      break;
  }

  const slaBreached = a.sla_label === 'breached' ? 1 : 0;
  const dueStatus = (() => {
    if (a.sla_label === 'breached') return 'Overdue';
    if (a.sla_label === 'at_risk')  return 'Due ≤24h';
    if (a.sla_label === 'warning')  return 'Due ≤48h';
    return 'On Track';
  })();

  const ageDays = Math.max(0, daysBetween(dates.created, REFERENCE_DATE));
  return {
    alert_id: `ALT-${String(8000 + idx + 1).padStart(4, '0')}`,
    customer_id: a.customer.id,
    customer_name: a.customer.name,
    customer_type: a.customer.kind === 'I' ? 'Individual' : 'Business',
    segment: a.customer.kind === 'I' ? a.customer.occupation : a.customer.industry,
    scenario: SCENARIO_DISPLAY[a.scenario] || a.scenario,
    scenario_description: scenarioDescription,
    alert_status: alertStatus,
    priority: a.priority,
    risk_score: riskScore,
    amount_flagged_inr: amount,
    txn_count_flagged: txnCount,
    counterparty_country: counterCountry,
    channel,
    branch: BANK_BRANCH,
    assigned_to: a.assigned_to,
    created_date: dates.created,
    last_activity_date: lastActivityDate,
    closed_date: dates.closed,
    age_days: ageDays,
    sla_days: SLA_DAYS[a.priority],
    sla_deadline: dates.sla_deadline,
    sla_breached: slaBreached,
    due_status: dueStatus,
    case_converted: caseConverted,
    case_id: null, // set later
    disposition,
    customer_risk_rating: a.customer.risk,
    pep_match: a.customer.pep || 0,
    sanctions_match: a.scenario === 'Watchlist Hit' ? 1 : 0,
    kyc_review_status: a.customer.risk === 'Very High' ? 'Due Soon' : 'Current',
    created_by: 'system_tm_engine',
    linked_sar_id: linkedSarId,
    narrative_seed: scenarioDescription,
    escalated_to: escalatedTo,
    _alert_planner_ref: a    // for downstream linkage
  };
}

const alertRows = alertPlan.map((a, i) => buildAlertRow(a, i));

// Link is_alerted txns to alert_id for first-fit-by-customer pattern alerts
for (const ar of alertRows) {
  const planner = ar._alert_planner_ref;
  if (planner.txns && planner.txns.length > 0) {
    for (const t of planner.txns) {
      t.alert_id = ar.alert_id;
      t.scenario = ar.scenario;
    }
  }
}

// ─────────────────────────────────────────────── 7. CASES + 8. SAR FILINGS

// 35 SARs allocated to Closed-SAR alerts (35) one-to-one
// Cases (55): all Closed-SAR (35) + Closed-L2 (25) ... wait that's 60.
// Spec: 55 cases. We'll cap: 35 cases-with-SAR + 20 cases-without-SAR (L2 closed + WIP/Pending).
// Actually map per status:
//   Filed cases (25)        ← Filed SARs (25)
//   Pending Review (10)     ← 5 Pending Approval + 3 Returned for Revision + 2 Draft = 10
//   Work In Progress (8)    ← no SAR
//   Not Started (8)         ← no SAR
//   Unassigned (4)          ← no SAR
//   Closed (No SAR) (0)     ← no SAR
// Total cases: 55
// Total SARs: 25 + 5 + 3 + 2 = 35 ✓

const insertCase = db.prepare(`
  INSERT INTO cases (
    case_id, source_alert_id, linked_sar_id, customer_id, customer_name,
    scenario, case_status, assigned_to, created_date, updated_date
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSarFiling = db.prepare(`
  INSERT INTO sar_filings (
    sar_id, case_id, source_alert_id, customer_id, customer_name,
    alert_scenario, sar_status, prepared_by, reviewed_by, approved_by,
    detection_date, incident_start_date, incident_end_date, draft_created_date,
    filed_date, acknowledged_date, amount_involved_inr, narrative_summary,
    reporting_jurisdiction, regulator_reference, retention_expiry_date, retention_status,
    documents_count, export_package_ready, export_count, last_exported_at,
    law_enforcement_hold, access_classification, current_owner, latest_activity_date,
    linked_alert_count, qa_score, notes,
    filing_type, filing_method, regulatory_agency, sar_type, bsa_filing_institution,
    tin, num_transactions, total_amount, currency, suspicious_activity_types,
    transaction_locations, narrative, certification_signed, submitted_by, submitted_at,
    approved_at, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?
  )
`);

// Pull alerts by status_label
const closedSarAlerts = alertRows.filter(a => a._alert_planner_ref.status_label === 'Closed-SAR');
const closedL2Alerts  = alertRows.filter(a => a._alert_planner_ref.status_label === 'Closed-L2');
const wipAlerts       = alertRows.filter(a => a._alert_planner_ref.status_label === 'Work in Progress');
const notStartedAlerts= alertRows.filter(a => a._alert_planner_ref.status_label === 'Not Started');
const unassignedAlerts= alertRows.filter(a => a._alert_planner_ref.status_label === 'Unassigned');

// SAR plan: 35 Closed-SAR alerts → 35 SARs
//   Of those: 25 Filed, 5 Pending Approval, 3 Returned for Revision, 2 Draft
// Case plan: 55 cases
//   25 Filed cases  ← 25 Filed SARs
//   10 Pending Review cases ← 10 SARs (5 PA + 3 RfR + 2 Draft)
//   8 WIP cases    ← drawn from WIP alerts
//   8 Not Started cases ← drawn from NotStarted alerts
//   4 Unassigned cases ← drawn from Unassigned alerts (4 of 15)
// Total: 55 cases

if (closedSarAlerts.length !== 35) {
  console.warn(`[seed_full] expected 35 closed-SAR alerts; got ${closedSarAlerts.length}`);
}

const sarStatusQueue = [
  ...Array(25).fill('Filed'),
  ...Array(5).fill('Pending Approval'),
  ...Array(3).fill('Returned for Revision'),
  ...Array(2).fill('Draft')
];
for (let i = sarStatusQueue.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [sarStatusQueue[i], sarStatusQueue[j]] = [sarStatusQueue[j], sarStatusQueue[i]];
}

const SUSPICIOUS_ACTIVITY_TYPES_BY_SCENARIO = {
  'Structuring':       ['Structuring', 'Money Laundering'],
  'High Risk Country': ['Money Laundering', 'Sanctions Evasion'],
  'Watchlist Hit':     ['Sanctions Evasion', 'Terrorist Financing'],
  'Cash Intensive':    ['Money Laundering', 'Tax Evasion'],
  'Rapid Movement':    ['Money Laundering', 'Fraud'],
  'Trade Based ML':    ['Trade Based ML', 'Money Laundering']
};

const FILING_TYPE_QUEUE = [
  ...Array(25).fill('Initial SAR'),
  ...Array(7).fill('Continuing SAR'),
  ...Array(3).fill('Joint SAR')
];
for (let i = FILING_TYPE_QUEUE.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [FILING_TYPE_QUEUE[i], FILING_TYPE_QUEUE[j]] = [FILING_TYPE_QUEUE[j], FILING_TYPE_QUEUE[i]];
}

// Amount distribution: 10 small (10K-50K), 15 medium (50K-250K), 10 large (250K-2M)
const AMOUNT_BANDS = [
  ...Array(10).fill('S'),
  ...Array(15).fill('M'),
  ...Array(10).fill('L')
];
for (let i = AMOUNT_BANDS.length - 1; i > 0; i--) {
  const j = Math.floor(r0() * (i + 1));
  [AMOUNT_BANDS[i], AMOUNT_BANDS[j]] = [AMOUNT_BANDS[j], AMOUNT_BANDS[i]];
}

// Retention spread: 30d, 90d, 1y, 3y, 5y from now (mix expiry to demo retention monitor)
const RETENTION_OFFSETS_DAYS = [30, 90, 365, 1095, 1825];

const cases = [];
const sars = [];
let caseCounter = 1;
let sarCounter = 1;
let regulatorCounter = 1;

function newCaseId() {
  return `CAS-2025-${String(caseCounter++).padStart(4,'0')}`;
}
function newSarId() {
  return `SAR-2025-${String(sarCounter++).padStart(4,'0')}`;
}
function newRegRef() {
  return `BSA-${new Date().getFullYear()}-${String(regulatorCounter++).padStart(6,'0')}`;
}

// ─── 35 Closed-SAR alerts → 35 cases with SAR
closedSarAlerts.forEach((alert, i) => {
  const sarStatus = sarStatusQueue[i];
  const filingType = FILING_TYPE_QUEUE[i];
  const amountBand = AMOUNT_BANDS[i];
  const r = rng(`sarcase_${alert.alert_id}`);

  const amount = amountBand === 'S' ? moneyIn(r, 10_000, 50_000)
               : amountBand === 'M' ? moneyIn(r, 50_000, 250_000)
               : moneyIn(r, 250_000, 2_000_000);

  const caseId = newCaseId();
  const sarId = newSarId();

  // Dates: alert.created → case.created → sar.draft → sar.filed
  const detection = alert.created_date;
  const draftCreated = ymd(addDays(alert.closed_date, 1));
  const filedDate = sarStatus === 'Filed' ? ymd(addDays(draftCreated, intIn(r, 2, 7))) : null;
  const acknowledgedDate = sarStatus === 'Filed' ? ymd(addDays(filedDate, intIn(r, 1, 5))) : null;
  const incidentStart = ymd(addDays(detection, -intIn(r, 14, 60)));
  const incidentEnd = alert.closed_date;

  const caseStatus = sarStatus === 'Filed' ? 'Filed'
                   : sarStatus === 'Pending Approval' ? 'Pending Review'
                   : sarStatus === 'Returned for Revision' ? 'Pending Review'
                   : sarStatus === 'Draft' ? 'Pending Review'
                   : 'Work In Progress';

  const preparedBy = alert.assigned_to || pick(r, ANALYSTS_ALL);
  const reviewedBy = pick(r, TEAM_LEADS);
  const approvedBy = sarStatus === 'Filed' ? pick(r, MANAGERS) : (sarStatus === 'Returned for Revision' ? pick(r, MANAGERS) : null);

  const retentionOffset = filedDate ? RETENTION_OFFSETS_DAYS[i % RETENTION_OFFSETS_DAYS.length] : null;
  const retentionExpiry = filedDate ? ymd(addDays(REFERENCE_DATE, retentionOffset)) : null;
  const retentionStatus = filedDate
    ? (retentionOffset <= 30 ? 'Expiring Soon' : retentionOffset <= 90 ? 'Expiring Soon' : 'Active')
    : 'Pending Filing';
  const sarType = filingType;

  const activityTypes = SUSPICIOUS_ACTIVITY_TYPES_BY_SCENARIO[alert.scenario] || ['Money Laundering'];
  const txnCount = alert.txn_count_flagged;

  const narrativeSummary = (() => {
    const cust = alert.customer_name;
    const scenName = alert.scenario;
    if (scenName === 'Structuring') {
      return `Customer ${cust} made ${txnCount} cash deposits totaling $${amount.toLocaleString()} between ${incidentStart} and ${incidentEnd}, each below the $10,000 CTR threshold. Pattern of structuring inconsistent with ${alert.segment || 'declared business'}; no reasonable economic rationale provided.`;
    }
    if (scenName === 'High Risk Country') {
      return `Customer ${cust} executed wire transfers ${alert.counterparty_country ? `to/from ${alert.counterparty_country}` : 'with high-risk jurisdiction counterparties'} totaling $${amount.toLocaleString()} across ${txnCount} transactions. Counterparties on FATF grey list; trade documentation could not be reconciled.`;
    }
    if (scenName === 'Watchlist Hit') {
      return `Counterparty screening matched OFAC SDN/adverse-media list. Aggregate exposure $${amount.toLocaleString()} over ${txnCount} transactions. Customer ${cust} unable to provide commercially-reasonable explanation.`;
    }
    if (scenName === 'Cash Intensive') {
      return `${cust} made recurring large cash deposits totaling $${amount.toLocaleString()}, materially in excess of expected monthly volume for declared business profile (${alert.segment || 'unknown'}). Source of funds documentation insufficient.`;
    }
    if (scenName === 'Rapid Movement') {
      return `Inbound wire of $${amount.toLocaleString()} from offshore counterparty followed by ${txnCount - 1} smaller outbound wires within 48 hours, consistent with layering. Counterparties not previously associated with ${cust}.`;
    }
    return `Suspicious activity totaling $${amount.toLocaleString()} across ${txnCount} transactions; full details in case narrative.`;
  })();

  const fullNarrative = `${narrativeSummary}

Filing Institution: ${BANK_NAME} (FEIN: ${BANK_FEIN})
Branch: ${BANK_BRANCH}
Address: ${BANK_ADDRESS}

Subject: ${cust = alert.customer_name}
Customer ID: ${alert.customer_id}
Risk Rating: ${alert.customer_risk_rating}
Activity Period: ${incidentStart} to ${incidentEnd}
Total Amount: $${amount.toLocaleString()}
Number of Transactions: ${txnCount}
Suspicious Activity Type(s): ${activityTypes.join(', ')}

Investigation Findings:
- KYC profile reviewed; transaction pattern materially deviates from declared profile.
- No reasonable business or commercial rationale identified.
- Customer outreach attempted; explanation insufficient.

Recommendation: File ${filingType} with FinCEN via BSA E-Filing.`;

  insertCase.run(
    caseId, alert.alert_id, sarId,
    alert.customer_id, alert.customer_name, alert.scenario,
    caseStatus, alert.assigned_to,
    alert.closed_date, filedDate || draftCreated
  );
  cases.push({ case_id: caseId, alert, sar_id: sarId });

  insertSarFiling.run(
    sarId, caseId, alert.alert_id, alert.customer_id, alert.customer_name,
    alert.scenario, sarStatus, preparedBy, reviewedBy, approvedBy,
    detection, incidentStart, incidentEnd, draftCreated,
    filedDate, acknowledgedDate, amount, narrativeSummary,
    'FinCEN', filedDate ? newRegRef() : null, retentionExpiry, retentionStatus,
    0, filedDate ? 1 : 0, filedDate ? intIn(r, 1, 3) : 0, filedDate || null,
    0, 'Restricted', preparedBy, filedDate || draftCreated,
    1, intIn(r, 78, 96), `Synthetic seed record · ${alert.scenario}`,
    filingType, 'BSA E-Filing', 'FinCEN', sarType, BANK_NAME,
    BANK_FEIN, txnCount, amount, 'USD', JSON.stringify(activityTypes),
    JSON.stringify([`${alert.customer_name} branch activity`, BANK_BRANCH]), fullNarrative,
    filedDate ? 1 : 0, preparedBy, draftCreated,
    filedDate ? `${filedDate} 14:00:00` : null, draftCreated, filedDate || draftCreated
  );

  sars.push({
    sar_id: sarId, case_id: caseId, alert,
    status: sarStatus, filed_date: filedDate, draft_created_date: draftCreated,
    detection_date: detection, prepared_by: preparedBy, reviewed_by: reviewedBy,
    approved_by: approvedBy, amount, scenario: alert.scenario,
    filing_type: filingType, narrative_summary: narrativeSummary,
    incident_start: incidentStart, incident_end: incidentEnd
  });

  // back-link alert to SAR
  alert.linked_sar_id = sarId;
  alert.case_id = caseId;
  db.prepare('UPDATE alerts SET linked_sar_id = ?, case_id = ? WHERE alert_id = ?').run(sarId, caseId, alert.alert_id);
});

// ─── Closed-L2 alerts → cases without SAR (use 8 of 25)
//     Spec: 8 Work In Progress cases without SAR. Use Closed-L2 to feed these.
const wipCount = 8;
for (let i = 0; i < wipCount && i < closedL2Alerts.length; i++) {
  const alert = closedL2Alerts[i];
  const caseId = newCaseId();
  const r = rng(`wipcase_${alert.alert_id}`);
  insertCase.run(
    caseId, alert.alert_id, null,
    alert.customer_id, alert.customer_name, alert.scenario,
    'Work In Progress', alert.escalated_to || pick(r, ANALYSTS_T2),
    alert.closed_date, ymd(addDays(REFERENCE_DATE, -intIn(r, 1, 14)))
  );
  cases.push({ case_id: caseId, alert, sar_id: null });
  alert.case_id = caseId;
  db.prepare('UPDATE alerts SET case_id = ? WHERE alert_id = ?').run(caseId, alert.alert_id);
}

// ─── Cases for Not Started (8) — derived from open-NotStarted alerts
const notStartedSlots = 8;
for (let i = 0; i < notStartedSlots && i < notStartedAlerts.length; i++) {
  const alert = notStartedAlerts[i];
  const caseId = newCaseId();
  insertCase.run(
    caseId, alert.alert_id, null,
    alert.customer_id, alert.customer_name, alert.scenario,
    'Not Started', alert.assigned_to,
    alert.created_date, alert.created_date
  );
  cases.push({ case_id: caseId, alert, sar_id: null });
  alert.case_id = caseId;
  db.prepare('UPDATE alerts SET case_id = ? WHERE alert_id = ?').run(caseId, alert.alert_id);
}

// ─── 4 Unassigned cases — from Unassigned alerts
const unassignedSlots = 4;
for (let i = 0; i < unassignedSlots && i < unassignedAlerts.length; i++) {
  const alert = unassignedAlerts[i];
  const caseId = newCaseId();
  insertCase.run(
    caseId, alert.alert_id, null,
    alert.customer_id, alert.customer_name, alert.scenario,
    'Unassigned', null,
    alert.created_date, alert.created_date
  );
  cases.push({ case_id: caseId, alert, sar_id: null });
  alert.case_id = caseId;
  db.prepare('UPDATE alerts SET case_id = ? WHERE alert_id = ?').run(caseId, alert.alert_id);
}

console.log(`[seed_full] cases inserted: ${cases.length}`);
console.log(`[seed_full] SARs inserted: ${sars.length}`);

// ─────────────────────────────────────────────── 9. CASE NOTES (3-5 per case)

const insertCaseNote = db.prepare(`
  INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
  VALUES (?, ?, ?, ?)
`);

const NOTE_TEMPLATES = {
  'Structuring': [
    'Reviewed transaction history. Customer made {N} cash deposits totaling ${AMT} in {SPAN} days, all just below the $10,000 CTR threshold. Pattern consistent with structuring.',
    'Pulled deposit slips from branch records. All deposits made in person at the same branch. No legitimate business explanation offered.',
    'Customer KYC reviewed. Source of funds listed as {SOURCE} however transaction volume exceeds expected monthly volume by 240%.',
    'Contacted customer via phone for explanation. Customer was evasive and unable to provide source documentation.',
    'Recommendation: escalate for SAR filing. Pattern shows clear intent to evade reporting threshold.'
  ],
  'High Risk Country': [
    'Reviewed wire transfer instructions for the period {SPAN} days. {N} wires totaling ${AMT} sent to/from {COUNTRY}.',
    'Counterparty appears to be on FATF grey list. Requested supporting trade invoices from customer; documentation unsatisfactory.',
    'Compared wire activity to customer\'s declared trade pattern. Activity inconsistent with stated business.',
    'No business justification provided by customer for wire transfers to {COUNTRY}.',
    'Escalated to T2 Investigations for enhanced due diligence.'
  ],
  'Watchlist Hit': [
    'OFAC SDN screening triggered on counterparty {NAME}. Reviewed full match list and confirmed name match score >85.',
    'Pulled supporting documentation. Customer was unable to provide acceptable explanation for the relationship.',
    'Reviewed customer\'s historical transactions for additional matches; one prior match identified in {COUNTRY}.',
    'Compliance team consulted regarding sanctions risk. Recommended SAR filing and account review.',
    'Account review escalated. Considering account closure pending compliance team decision.'
  ],
  'Cash Intensive': [
    'Customer made {N} large cash deposits totaling ${AMT} in last 90 days, well in excess of declared monthly volume.',
    'KYC profile lists business as ${SOURCE}; observed cash volume is 340% of expected.',
    'Site visit recommended to verify business operations.',
    'Compared cash deposit patterns to peer group; significantly above industry benchmark.',
    'No documented commercial rationale for sustained cash inflow.'
  ],
  'Rapid Movement': [
    'Inbound wire of ${IN_AMT} from {COUNTRY} on {ANCHOR}, followed by {N} outbound wires within 48 hours.',
    'Counterparties on outbound wires not previously associated with customer.',
    'Pattern consistent with layering. Customer unable to identify ultimate beneficiaries.',
    'Funds dispersed across multiple US accounts and onward to additional offshore destinations.',
    'Recommend SAR filing — typical layering pattern.'
  ],
  'Trade Based ML': [
    'Reviewed invoices and bills of lading for the period. Declared goods value inconsistent with shipment manifest.',
    'Counterparty in {COUNTRY} is a known free trade zone with limited operating history.',
    'Pricing analysis: invoice values 60% above prevailing market rates for the goods declared.',
    'No supporting customs declaration provided. Trade finance team consulted.',
    'Recommend SAR filing for trade-based money laundering pattern.'
  ]
};

for (const cse of cases) {
  const r = rng(`notes_${cse.case_id}`);
  const noteCount = intIn(r, 3, 5);
  const tmpl = NOTE_TEMPLATES[cse.alert.scenario] || NOTE_TEMPLATES['Structuring'];
  const sub = (s) => s
    .replace('{N}', cse.alert.txn_count_flagged)
    .replace('{AMT}', cse.alert.amount_flagged_inr.toLocaleString())
    .replace('{IN_AMT}', cse.alert.amount_flagged_inr.toLocaleString())
    .replace('{SPAN}', String(intIn(r, 7, 28)))
    .replace('{COUNTRY}', cse.alert.counterparty_country || 'United States')
    .replace('{SOURCE}', 'declared business income')
    .replace('{NAME}', 'matched counterparty')
    .replace('{ANCHOR}', cse.alert.created_date);

  for (let i = 0; i < noteCount; i++) {
    const text = sub(tmpl[i % tmpl.length]);
    const noteDate = i === 0
      ? cse.alert.created_date
      : ymd(addDays(cse.alert.created_date, Math.min(daysBetween(cse.alert.created_date, REFERENCE_DATE) - 1, intIn(r, 1, 14) * (i + 1))));
    const noteTime = `${String(intIn(r, 9, 17)).padStart(2,'0')}:${String(intIn(r, 0, 59)).padStart(2,'0')}:00`;
    const analyst = cse.alert.assigned_to || pick(r, ANALYSTS_ALL);
    insertCaseNote.run(cse.alert.alert_id, text, analyst, `${noteDate} ${noteTime}`);
  }
}

// ─────────────────────────────────────────────── 10. DOCUMENTS (per SAR)

const insertDoc = db.prepare(`
  INSERT INTO documents (sar_id, document_name, document_type, file_path, file_size, uploaded_by, uploaded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const DOC_TYPES_BY_SCENARIO = {
  'Structuring':       ['Cash Deposit Log', 'Bank Statement', 'Branch Activity Report', 'Internal Memo', 'CTR Threshold Analysis', 'Customer Outreach Notes'],
  'High Risk Country': ['Wire Transfer Detail', 'KYC File', 'Correspondent Bank Confirmation', 'Trade Invoice', 'Customs Documentation'],
  'Watchlist Hit':     ['OFAC Screening Hit Detail', 'Adverse Media Report', 'KYC File', 'Enhanced Due Diligence Memo'],
  'Cash Intensive':    ['Cash Deposit Slips', 'Branch Surveillance Log', 'Cash Activity Report', 'Site Visit Memo'],
  'Rapid Movement':    ['SWIFT Wire Trace', 'Counterparty Investigation', 'Bank Statement Excerpt', 'Layering Analysis'],
  'Trade Based ML':    ['Commercial Invoice', 'Bill of Lading', 'Trade Finance Memo', 'Pricing Analysis', 'Customs Declaration']
};

for (const s of sars) {
  const types = DOC_TYPES_BY_SCENARIO[s.scenario] || ['Evidence', 'Memo', 'Statement'];
  const docCount = intIn(rng(`docs_${s.sar_id}`), 4, 8);
  for (let d = 1; d <= docCount; d++) {
    const docType = types[(d - 1) % types.length];
    const filename = `${s.sar_id}_${docType.replace(/[^a-zA-Z0-9]+/g, '_')}_${String(d).padStart(2,'0')}.pdf`;
    const diskName = `seed_${s.sar_id}_${d}.pdf`;
    const absPath  = path.join(UPLOAD_DIR, diskName);

    const body = `AML SHIELD — SUPPORTING DOCUMENT
SAR ID:         ${s.sar_id}
Case ID:        ${s.case_id}
Customer:       ${s.alert.customer_name}
Scenario:       ${s.scenario}
Document Type:  ${docType}
Prepared by:    ${s.prepared_by}
Filing System:  BSA E-Filing
Regulator:      FinCEN
Bank:           ${BANK_NAME} (FEIN: ${BANK_FEIN})
Amount (USD):   $${s.amount.toLocaleString()}
Activity Period: ${s.incident_start} → ${s.incident_end}

${s.narrative_summary}
`;
    fs.writeFileSync(absPath, body);
    const size = fs.statSync(absPath).size;
    const uploadedAt = `${s.draft_created_date} ${String(9 + d).padStart(2,'0')}:00:00`;
    insertDoc.run(s.sar_id, filename, docType, path.join('uploads', diskName), size, s.prepared_by, uploadedAt);
  }

  // update documents_count on the SAR row
  db.prepare('UPDATE sar_filings SET documents_count = ? WHERE sar_id = ?').run(docCount, s.sar_id);
}

// ─────────────────────────────────────────────── 11. AUDIT TRAIL

const insertAudit = db.prepare(`
  INSERT INTO audit_trail (sar_id, action, performed_by, timestamp, details)
  VALUES (?, ?, ?, ?, ?)
`);

const insertApprovalLog = db.prepare(`
  INSERT INTO sar_approval_log (sar_id, action, actioned_by, reason_category, comments, checklist_items_completed, actioned_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

for (const s of sars) {
  const events = [];
  events.push([s.sar_id, 'Detection Logged', 'system_tm_engine', `${s.detection_date} 09:00:00`, `Detection from source alert ${s.alert.alert_id}`]);
  events.push([s.sar_id, 'Alert Assigned', s.prepared_by, `${s.detection_date} 10:30:00`, `Assigned to ${s.prepared_by} for triage`]);
  events.push([s.sar_id, 'Investigation Started', s.prepared_by, `${s.detection_date} 14:00:00`, `Investigation opened`]);
  events.push([s.sar_id, 'SAR Draft Created', s.prepared_by, `${s.draft_created_date} 10:00:00`, `Draft SAR created with ${s.alert.txn_count_flagged} flagged transactions`]);
  events.push([s.sar_id, 'Documents Attached', s.prepared_by, `${s.draft_created_date} 11:30:00`, `Supporting documents attached`]);

  if (s.status === 'Filed') {
    events.push([s.sar_id, 'Submitted for Approval', s.prepared_by, `${s.draft_created_date} 16:00:00`, `Routed to manager for approval`]);
    events.push([s.sar_id, 'Manager Approved', s.approved_by, `${s.filed_date} 10:00:00`, `Approved by ${s.approved_by}`]);
    events.push([s.sar_id, 'SAR Filed', s.approved_by, `${s.filed_date} 11:30:00`, `Filed with FinCEN via BSA E-Filing`]);
    insertApprovalLog.run(s.sar_id, 'approved', s.approved_by, null, 'Approved — narrative complete and supporting documentation adequate', JSON.stringify(['narrative','documents','transactions','customer_info','dates','signature','review']), `${s.filed_date} 10:00:00`);
  } else if (s.status === 'Pending Approval') {
    events.push([s.sar_id, 'Submitted for Approval', s.prepared_by, `${s.draft_created_date} 16:00:00`, `Pending manager review`]);
  } else if (s.status === 'Returned for Revision') {
    events.push([s.sar_id, 'Submitted for Approval', s.prepared_by, `${s.draft_created_date} 16:00:00`, `Submitted for review`]);
    events.push([s.sar_id, 'Returned for Revision', s.approved_by, `${ymd(addDays(s.draft_created_date, 1))} 10:00:00`, `Returned: narrative requires more detail on counterparty relationship`]);
    insertApprovalLog.run(s.sar_id, 'rejected', s.approved_by, 'Incomplete Narrative', 'Narrative lacks detail on counterparty relationship', JSON.stringify(['narrative']), `${ymd(addDays(s.draft_created_date, 1))} 10:00:00`);
    db.prepare('UPDATE sar_filings SET rejection_reason_category = ?, rejection_comments = ?, rejected_by = ?, rejected_at = ?, returned_to_analyst = 1 WHERE sar_id = ?')
      .run('Incomplete Narrative', 'Narrative lacks detail on counterparty relationship', s.approved_by, `${ymd(addDays(s.draft_created_date, 1))} 10:00:00`, s.sar_id);
  }

  for (const e of events) insertAudit.run(...e);
}

// Audit trail for L2-escalated cases (no SAR, but show activity)
for (const cse of cases.filter(c => !c.sar_id && c.alert.disposition === 'Escalated to L2')) {
  insertAudit.run(cse.case_id, 'Case Created', cse.alert.assigned_to || 'system', `${cse.alert.closed_date} 10:00:00`, 'Escalated from alert to L2 Investigations');
  insertAudit.run(cse.case_id, 'Case In Progress', cse.alert.escalated_to, `${cse.alert.closed_date} 12:00:00`, 'L2 analyst beginning investigation');
}

// ─────────────────────────────────────────────── 12. KYC REVIEWS (20)

const insertKyc = db.prepare(`
  INSERT INTO kyc_reviews (
    customer_id, review_type, status, priority, due_date,
    assigned_to, assigned_by, assigned_at, started_at, completed_at,
    previous_risk_rating, new_risk_rating, previous_cdd_level, new_cdd_level,
    review_findings, checklist, recommendation,
    approved_by, approved_at,
    triggered_by_sar_id, triggered_by_alert_id,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Spec: 20 KYC reviews — 8 Completed, 5 In Progress, 3 Pending Approval, 4 Overdue
//       12 Scheduled / 5 Triggered by SAR / 3 Triggered by Alerts
const KYC_PLAN_DETAIL = [
  // Completed (8) — scheduled
  { custId: 'CUS-1006', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-1007', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-1010', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-1015', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-2007', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-2006', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-1003', triggeredBy: 'scheduled', status: 'completed' },
  { custId: 'CUS-1011', triggeredBy: 'scheduled', status: 'completed' },
  // In progress (5) — mix
  { custId: 'CUS-1001', triggeredBy: 'triggered_sar',    status: 'in_progress' },
  { custId: 'CUS-2003', triggeredBy: 'triggered_sar',    status: 'in_progress' },
  { custId: 'CUS-1002', triggeredBy: 'scheduled',        status: 'in_progress' },
  { custId: 'CUS-1014', triggeredBy: 'triggered_alerts', status: 'in_progress' },
  { custId: 'CUS-2010', triggeredBy: 'scheduled',        status: 'in_progress' },
  // Pending approval (3) — triggered SAR
  { custId: 'CUS-2004', triggeredBy: 'triggered_sar',    status: 'pending_approval' },
  { custId: 'CUS-2005', triggeredBy: 'triggered_sar',    status: 'pending_approval' },
  { custId: 'CUS-1013', triggeredBy: 'triggered_alerts', status: 'pending_approval' },
  // Overdue (4) — past due_date, status remains pending or in_progress
  { custId: 'CUS-2009', triggeredBy: 'triggered_sar',    status: 'pending', overdue: true },
  { custId: 'CUS-1005', triggeredBy: 'triggered_alerts', status: 'pending', overdue: true },
  { custId: 'CUS-2002', triggeredBy: 'scheduled',        status: 'pending', overdue: true },
  { custId: 'CUS-2008', triggeredBy: 'scheduled',        status: 'pending', overdue: true }
];

const sarsByCustomer = {};
for (const s of sars) (sarsByCustomer[s.alert.customer_id] ||= []).push(s);
const alertsByCustomer = {};
for (const a of alertRows) (alertsByCustomer[a.customer_id] ||= []).push(a);

const RANK = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 };
function rankToName(n) {
  return ['', 'Low', 'Medium', 'High', 'Very High'][n] || 'Medium';
}

KYC_PLAN_DETAIL.forEach((p, idx) => {
  const c = customerSpecs.find(x => x.id === p.custId);
  if (!c) { console.warn('[seed_full] missing customer for KYC plan:', p.custId); return; }
  const r = rng(`kyc_${idx}`);
  const reviewType = p.triggeredBy === 'scheduled' ? 'periodic'
                   : p.triggeredBy === 'triggered_sar' ? 'triggered_sar'
                   : 'triggered_alerts';

  let assignedAt, dueDate, startedAt, completedAt, approvedBy, approvedAt;
  let previousRating, newRating, previousCdd, newCdd;

  const assignedTo = pick(r, ANALYSTS_T2);
  const assignedBy = pick(r, MANAGERS);

  if (p.status === 'completed') {
    const compDays = intIn(r, 7, 60);
    assignedAt = ymd(addDays(REFERENCE_DATE, -compDays - intIn(r, 7, 30)));
    startedAt = ymd(addDays(assignedAt, intIn(r, 1, 5)));
    completedAt = ymd(addDays(REFERENCE_DATE, -compDays));
    dueDate = ymd(addDays(startedAt, 30));
    approvedBy = pick(r, MANAGERS);
    approvedAt = ymd(addDays(completedAt, 1));
    previousRating = c.risk;
    newRating = c.risk;
    previousCdd = CDD_BY_RISK[c.risk];
    newCdd = previousCdd;
  } else if (p.status === 'in_progress') {
    assignedAt = ymd(addDays(REFERENCE_DATE, -intIn(r, 5, 25)));
    startedAt = ymd(addDays(assignedAt, intIn(r, 1, 4)));
    dueDate = ymd(addDays(assignedAt, 30));
    completedAt = null;
    approvedBy = null;
    approvedAt = null;
    previousRating = c.risk;
    newRating = c.risk;
    previousCdd = CDD_BY_RISK[c.risk];
    newCdd = previousCdd;
  } else if (p.status === 'pending_approval') {
    assignedAt = ymd(addDays(REFERENCE_DATE, -intIn(r, 14, 35)));
    startedAt = ymd(addDays(assignedAt, intIn(r, 1, 3)));
    completedAt = ymd(addDays(REFERENCE_DATE, -intIn(r, 1, 5)));
    dueDate = ymd(addDays(assignedAt, 30));
    approvedBy = null;
    approvedAt = null;
    // Triggered: maybe risk increases
    previousRating = c.risk;
    newRating = rankToName(Math.min(4, RANK[c.risk] + (reviewType !== 'periodic' ? 1 : 0)));
    previousCdd = CDD_BY_RISK[c.risk];
    newCdd = CDD_BY_RISK[newRating];
  } else { // pending overdue
    assignedAt = ymd(addDays(REFERENCE_DATE, -intIn(r, 50, 90)));
    startedAt = null;
    completedAt = null;
    dueDate = ymd(addDays(REFERENCE_DATE, -intIn(r, 5, 30))); // past
    approvedBy = null;
    approvedAt = null;
    previousRating = c.risk;
    newRating = c.risk;
    previousCdd = CDD_BY_RISK[c.risk];
    newCdd = previousCdd;
  }

  const checklist = JSON.stringify({
    'identity_verified':        p.status === 'completed' || p.status === 'pending_approval',
    'address_verified':         p.status === 'completed' || p.status === 'pending_approval',
    'sof_documented':           p.status === 'completed',
    'sow_documented':           p.status === 'completed',
    'pep_screening':            true,
    'sanctions_screening':      true,
    'adverse_media':            true,
    'beneficial_owners':        c.kind === 'B',
    'transaction_pattern':      p.status !== 'pending',
    'business_purpose':         c.kind === 'B' && p.status !== 'pending',
    'expected_activity':        p.status !== 'pending',
    'edd_completed':            (CDD_BY_RISK[c.risk] === 'Enhanced') && (p.status === 'completed'),
    'risk_rating_review':       p.status !== 'pending',
    'manager_approval':         p.status === 'completed'
  });

  let triggeredSar = null;
  let triggeredAlert = null;
  if (reviewType === 'triggered_sar') {
    triggeredSar = sarsByCustomer[c.id]?.[0]?.sar_id || null;
  } else if (reviewType === 'triggered_alerts') {
    triggeredAlert = alertsByCustomer[c.id]?.[0]?.alert_id || null;
  }

  insertKyc.run(
    c.id, reviewType,
    p.status === 'pending_approval' ? 'pending_approval' : p.status,
    c.risk === 'Very High' ? 'high' : c.risk === 'High' ? 'medium' : 'low',
    dueDate,
    assignedTo, assignedBy, assignedAt + ' 10:00:00',
    startedAt ? startedAt + ' 09:30:00' : null,
    completedAt ? completedAt + ' 16:00:00' : null,
    previousRating, newRating, previousCdd, newCdd,
    p.status === 'pending' ? null : 'Customer profile reviewed; transaction patterns and KYC documentation evaluated.',
    checklist,
    p.status === 'completed' || p.status === 'pending_approval' ? 'Maintain current rating; continue periodic monitoring.' : null,
    approvedBy, approvedAt ? approvedAt + ' 11:00:00' : null,
    triggeredSar, triggeredAlert,
    assignedAt + ' 10:00:00', (completedAt || startedAt || assignedAt) + ' 12:00:00'
  );
});

// ─────────────────────────────────────────────── 13. NOTIFICATIONS (14)

const insertNotif = db.prepare(`
  INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone, is_read, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const recentBreached = alertRows.filter(a => a._alert_planner_ref.sla_label === 'breached' && !a.closed_date).slice(0, 5);
const recentAtRisk   = alertRows.filter(a => a._alert_planner_ref.sla_label === 'at_risk').slice(0, 5);
const pendingSars    = sars.filter(s => s.status === 'Pending Approval').slice(0, 3);
const overdueKycCustomers = ['CUS-2009', 'CUS-1005'];

let notifIndex = 0;
function notifTime(daysAgo, hourOffset = 0) {
  const d = addDays(REFERENCE_DATE, -daysAgo);
  d.setHours(9 + hourOffset, intIn(rng(`notif_${notifIndex++}`), 0, 59), 0, 0);
  return `${ymd(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00`;
}

// 5 unread SLA warnings to specific analysts
const slaCandidates = alertRows
  .filter(a => (a._alert_planner_ref.sla_label === 'breached' || a._alert_planner_ref.sla_label === 'at_risk') && a.assigned_to);
slaCandidates.slice(0, 5).forEach((a, i) => {
  insertNotif.run(
    a.assigned_to, 'employee',
    a._alert_planner_ref.sla_label === 'breached' ? 'sla_breached' : 'sla_warning',
    a._alert_planner_ref.sla_label === 'breached' ? 'SLA Breached' : 'SLA Approaching',
    `Alert ${a.alert_id} for ${a.customer_name} ${a._alert_planner_ref.sla_label === 'breached' ? 'has breached' : 'is approaching'} SLA`,
    a.alert_id, 'alert',
    a._alert_planner_ref.sla_label === 'breached' ? 'red' : 'orange',
    0,
    notifTime(intIn(rng(`nt_${i}`), 0, 2))
  );
});

// 3 pending SAR approvals to manager
pendingSars.forEach((s, i) => {
  insertNotif.run(
    null, 'manager', 'sar_approval_pending',
    'SAR Pending Approval',
    `${s.sar_id} for ${s.alert.customer_name} (${s.scenario}) is pending your approval`,
    s.sar_id, 'sar', 'orange', 0, notifTime(i)
  );
});

// 2 KYC reviews overdue (manager)
overdueKycCustomers.forEach((cid, i) => {
  insertNotif.run(
    null, 'manager', 'kyc_overdue',
    'KYC Review Overdue',
    `Periodic KYC review for ${cid} is overdue`,
    cid, 'customer', 'red', 0, notifTime(i + 1)
  );
});

// 4 read/dismissed notifications across analysts
const readNotifs = [
  { who: 'Rohit Sharma', role: 'employee', title: 'New alert assigned', message: 'A new alert was assigned to you', tone: 'blue', daysAgo: 3 },
  { who: 'Priya Nair',   role: 'employee', title: 'SAR approved',       message: 'Your submitted SAR was approved', tone: 'green', daysAgo: 5 },
  { who: 'Amit Verma',   role: 'employee', title: 'Note added by lead', message: 'Team lead added a note on your case', tone: 'blue', daysAgo: 6 },
  { who: 'Neha Iyer',    role: 'employee', title: 'KYC reminder',       message: 'KYC review due next week', tone: 'orange', daysAgo: 4 }
];
readNotifs.forEach((n, i) => {
  insertNotif.run(n.who, n.role, 'system', n.title, n.message, null, null, n.tone, 1, notifTime(n.daysAgo));
});

// ─────────────────────────────────────────────── 14. INSERT ALERTS

let alertIdx = 0;
for (const ar of alertRows) {
  insertAlert.run(
    ar.alert_id, ar.customer_id, ar.customer_name, ar.customer_type, ar.segment,
    ar.scenario, ar.scenario_description, ar.alert_status, ar.priority, ar.risk_score,
    ar.amount_flagged_inr, ar.txn_count_flagged, ar.counterparty_country, ar.channel, ar.branch,
    ar.assigned_to, ar.created_date, ar.last_activity_date, ar.closed_date,
    ar.age_days, ar.sla_days, ar.sla_deadline, ar.sla_breached, ar.due_status,
    ar.case_converted, ar.case_id, ar.disposition, ar.customer_risk_rating,
    ar.pep_match, ar.sanctions_match, ar.kyc_review_status, ar.created_by,
    ar.linked_sar_id, ar.narrative_seed, ar.escalated_to
  );
  alertIdx++;
}

// ─────────────────────────────────────────────── 15. TRANSACTIONS INSERT

for (const c of customerSpecs) {
  const txns = txnsByCustomer.get(c.id) || [];
  txns.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // Compute running balance per account
  const balanceByAccount = {};
  for (const acc of accountsByCustomer.get(c.id)) balanceByAccount[acc] = 0;
  // Seed initial balances by setting back-walked starting balance
  // We'll just compute forward and update accounts.current_balance at the end.
  for (const t of txns) {
    const prev = balanceByAccount[t.account] || 0;
    const change = t.type === 'Credit' ? t.amount : -t.amount;
    balanceByAccount[t.account] = prev + change;
    insertTxn.run(
      t.id, t.account, c.id, t.date, t.time, t.type, t.channel, t.description,
      t.counterparty, t.country, t.amount, balanceByAccount[t.account],
      t.is_alerted, t.alert_id || null,
      t.is_alerted ? (t.scenario || null) : null,
      t.is_alerted ? `R-${(t.scenario||'GEN').replace(/[^A-Z]/g,'').slice(0,3)||'GEN'}-01` : null,
      t.is_alerted ? intIn(rng(t.id), 70, 95) : null
    );
  }

  // Update accounts.current_balance to a realistic positive figure
  for (const acc of Object.keys(balanceByAccount)) {
    // Set account balance to original spec range, nudged by net flow
    const r = rng(acc + '_finalbal');
    const [lo, hi] = balanceRange(c);
    const final = Math.max(1000, moneyIn(r, lo, hi));
    db.prepare('UPDATE accounts SET current_balance = ? WHERE account_number = ?').run(final, acc);
  }
}

// ─────────────────────────────────────────────── 16. MANAGER DEFAULT SETTINGS

const { MANAGER_DEFAULTS } = require('./admin_defaults');
const insertMgrSetting = db.prepare(`
  INSERT INTO manager_settings (setting_key, setting_value) VALUES (?, ?)
`);
for (const [k, v] of Object.entries(MANAGER_DEFAULTS)) {
  insertMgrSetting.run(k, JSON.stringify(v));
}

// ─────────────────────────────────────────────── 17. CSV EXPORT

const ALERTS_CSV_HEADER = [
  'alert_id','customer_id','customer_name','customer_type','segment',
  'scenario','scenario_description','alert_status','priority','risk_score',
  'amount_flagged_inr','txn_count_flagged','counterparty_country','channel','branch',
  'assigned_to','created_date','last_activity_date','closed_date',
  'age_days','sla_days','sla_deadline','sla_breached','due_status',
  'case_converted','case_id','disposition','customer_risk_rating',
  'pep_match','sanctions_match','kyc_review_status','created_by',
  'linked_sar_id','narrative_seed'
];
const SAR_CSV_HEADER = [
  'sar_id','case_id','source_alert_id','customer_id','customer_name',
  'alert_scenario','sar_status','prepared_by','reviewed_by','approved_by',
  'detection_date','incident_start_date','incident_end_date','draft_created_date',
  'filed_date','acknowledged_date','amount_involved_inr','narrative_summary',
  'reporting_jurisdiction','regulator_reference','retention_expiry_date','retention_status',
  'documents_count','export_package_ready','export_count','last_exported_at',
  'law_enforcement_hold','access_classification','current_owner','latest_activity_date',
  'linked_alert_count','qa_score','notes'
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const alertsExport = db.prepare(`
  SELECT alert_id, customer_id, customer_name, customer_type, segment,
         scenario, scenario_description, alert_status, priority, risk_score,
         amount_flagged_inr, txn_count_flagged, counterparty_country, channel, branch,
         assigned_to, created_date, last_activity_date, closed_date,
         age_days, sla_days, sla_deadline, sla_breached, due_status,
         case_converted, case_id, disposition, customer_risk_rating,
         pep_match, sanctions_match, kyc_review_status, created_by,
         linked_sar_id, narrative_seed
    FROM alerts
   ORDER BY alert_id
`).all();

const alertsCsv = [
  ALERTS_CSV_HEADER.join(','),
  ...alertsExport.map(r => ALERTS_CSV_HEADER.map(h => csvEscape(r[h])).join(','))
].join('\n') + '\n';
fs.writeFileSync(path.join(SEED_DIR, 'aml_shield_alerts.csv'), alertsCsv);

const sarsExport = db.prepare(`
  SELECT sar_id, case_id, source_alert_id, customer_id, customer_name,
         alert_scenario, sar_status, prepared_by, reviewed_by, approved_by,
         detection_date, incident_start_date, incident_end_date, draft_created_date,
         filed_date, acknowledged_date, amount_involved_inr, narrative_summary,
         reporting_jurisdiction, regulator_reference, retention_expiry_date, retention_status,
         documents_count, export_package_ready, export_count, last_exported_at,
         law_enforcement_hold, access_classification, current_owner, latest_activity_date,
         linked_alert_count, qa_score, notes
    FROM sar_filings
   ORDER BY sar_id
`).all();

const sarsCsv = [
  SAR_CSV_HEADER.join(','),
  ...sarsExport.map(r => SAR_CSV_HEADER.map(h => csvEscape(r[h])).join(','))
].join('\n') + '\n';
fs.writeFileSync(path.join(SEED_DIR, 'aml_shield_sar_filings.csv'), sarsCsv);

// ─────────────────────────────────────────────── REPORT

const counts = {};
for (const t of ['user_profiles','customers','accounts','transactions','alerts','cases','sar_filings','documents','case_notes','audit_trail','kyc_reviews','notifications','sar_approval_log','manager_settings']) {
  counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
}

console.log('\n[seed_full] reference_date =', REF_STR);
console.log('[seed_full] table counts:');
for (const [t, c] of Object.entries(counts)) console.log(`  ${t.padEnd(20)} = ${c}`);

const txnAlerted = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE is_alerted = 1').get().c;
const slaCounts = db.prepare(`SELECT due_status, COUNT(*) AS c FROM alerts GROUP BY due_status`).all();
const statusCounts = db.prepare(`SELECT alert_status, COUNT(*) AS c FROM alerts GROUP BY alert_status`).all();
const scenarioCounts = db.prepare(`SELECT scenario, COUNT(*) AS c FROM alerts GROUP BY scenario`).all();

console.log(`  transactions(alerted) = ${txnAlerted}`);
console.log('\n[seed_full] alerts by status:', statusCounts);
console.log('[seed_full] alerts by SLA bucket:', slaCounts);
console.log('[seed_full] alerts by scenario:', scenarioCounts);

console.log('\n[seed_full] CSV exports:');
console.log(`  ${path.join(SEED_DIR, 'aml_shield_alerts.csv')} → ${alertsExport.length} rows`);
console.log(`  ${path.join(SEED_DIR, 'aml_shield_sar_filings.csv')} → ${sarsExport.length} rows`);
console.log('\n[seed_full] done.');
