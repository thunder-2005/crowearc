// SAR narrative draft generator. Picks a scenario-specific regulatory
// template and fills in real values from the case data. Returns a string
// that the analyst MUST review and edit before submission — never a final
// narrative.

const INSTITUTION = 'First National Bank — US';

// ─────────────────────────────────────────────── helpers

function formatCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(String(s).length <= 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = new Date(String(a).length <= 10 ? `${a}T00:00:00` : a);
  const db = new Date(String(b).length <= 10 ? `${b}T00:00:00` : b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
  return Math.max(1, Math.round(Math.abs(db - da) / 86400000));
}

function listCountries(txns) {
  const set = new Set();
  for (const t of txns || []) {
    const c = t.counterparty_country;
    if (c && String(c).trim()) set.add(String(c).trim());
  }
  return [...set];
}

function listCounterparties(txns) {
  const set = new Set();
  for (const t of txns || []) {
    const c = t.counterparty;
    if (c && String(c).trim()) set.add(String(c).trim());
  }
  const arr = [...set];
  if (arr.length === 0) return '';
  if (arr.length <= 5) return arr.join(', ');
  const rest = arr.length - 5;
  return arr.slice(0, 5).join(', ') + ` and ${rest} other${rest === 1 ? '' : 's'}`;
}

function getRiskFactorList(json) {
  if (!json) return [];
  let parsed = json;
  if (typeof json === 'string') {
    try { parsed = JSON.parse(json); } catch { return []; }
  }
  if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
  if (parsed && typeof parsed === 'object') {
    return Object.keys(parsed).filter(k => parsed[k]);
  }
  return [];
}

function truncateNote(text, max = 300) {
  if (!text) return '';
  const s = String(text).trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '…';
}

// Pick out the latest case note (chronologically). The route hands us
// notes ordered by timestamp ASC; the last one is the most recent.
function lastNote(case_notes) {
  if (!Array.isArray(case_notes) || case_notes.length === 0) return null;
  const sorted = [...case_notes].sort((a, b) =>
    String(a.timestamp || '').localeCompare(String(b.timestamp || ''))
  );
  return sorted[sorted.length - 1];
}

// Describe customer profile lines — branches on individual vs business.
function describeCustomer(customer) {
  if (!customer) return { profile: '', occupation: 'individual', employer: '', isBusiness: false };
  const isBusiness = String(customer.customer_type || '').toLowerCase() === 'business';
  if (isBusiness) {
    const dba = customer.trading_name || customer.customer_name;
    const business_type = customer.business_type || 'business';
    const industry = customer.industry || '';
    return {
      profile: industry ? `a ${business_type} engaged in ${industry}` : `a ${business_type}`,
      operating_as: dba ? `operating as ${dba}` : '',
      occupation: business_type,
      employer: dba || '',
      industry,
      business_type,
      isBusiness: true
    };
  }
  return {
    profile: customer.job_title ? `a ${customer.job_title}` : '',
    operating_as: customer.employer_name ? `employed by ${customer.employer_name}` : '',
    occupation: customer.job_title || 'individual',
    employer: customer.employer_name || '',
    isBusiness: false
  };
}

// Assemble paragraph by joining non-empty lines with a single newline. Drops
// any line that is empty/null/undefined so optional sentences don't leave
// blank gaps in the output.
function paragraph(...lines) {
  return lines.filter(l => l && String(l).trim()).join(' ');
}

function block(...paragraphs) {
  return paragraphs.filter(p => p && String(p).trim()).join('\n\n');
}

// ─────────────────────────────────────────────── shared closing

function closing() {
  return `Based on the foregoing, ${INSTITUTION} has determined that the described activity warrants the filing of this Suspicious Activity Report pursuant to 31 U.S.C. § 5318(g) and its implementing regulations.`;
}

// ─────────────────────────────────────────────── template 1: Structuring

function templateStructuring(ctx) {
  const { customer, transaction_summary: ts, case_notes, l2 } = ctx;
  const cust = describeCustomer(customer);
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const daysSpan = daysBetween(ts.date_range_start, ts.date_range_end);

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName},`,
    cust.profile ? `${cust.profile}` : '',
    cust.operating_as ? `(${cust.operating_as}),` : (cust.profile ? ',' : ''),
    `conducted ${ts.alerted_count} cash transaction${ts.alerted_count === 1 ? '' : 's'}`,
    `totaling ${formatCurrency(ts.total_alerted_amount)} through account(s) held at ${INSTITUTION}.`
  );

  const pattern = paragraph(
    `The transactions ranged from ${formatCurrency(ts.min_amount)} to ${formatCurrency(ts.max_amount)}`,
    daysSpan > 0 ? `and were conducted over ${daysSpan} day${daysSpan === 1 ? '' : 's'},` : 'and were',
    `each structured below the $10,000 Currency Transaction Report (CTR) reporting threshold.`,
    `This pattern of conducting multiple transactions just below the reporting threshold is consistent with structuring activity as defined under 31 U.S.C. § 5324 and FinCEN guidance.`
  );

  const note = lastNote(case_notes);
  const noteBlock = note
    ? `During the course of the investigation, the following was noted: ${truncateNote(note.note_text)}`
    : '';

  const factors = l2 ? getRiskFactorList(l2.risk_factors) : [];
  const l2Block = (l2 && Number(l2.risk_score) >= 60 && factors.length > 0)
    ? `This activity was escalated for enhanced review. The investigation identified the following risk factors: ${factors.join(', ')}.`
    : '';

  const rating = customer?.customer_risk_rating || '';
  const isHigh = /high/i.test(rating);
  const profileBlock = isHigh
    ? `${customerName} is classified as a ${rating} risk customer with ${customer?.cdd_level || 'standard'} due diligence on file. The observed transaction activity is inconsistent with the customer's stated ${customer?.source_of_funds || 'source of funds'} as source of funds.`
    : '';

  return block(opening, pattern, noteBlock, l2Block, profileBlock, closing());
}

// ─────────────────────────────────────────────── template 2: High Risk Country

const FATF_HIGH_RISK = new Set([
  'Iran', 'North Korea', 'Myanmar', 'Syria'
]);
const OFAC_SANCTIONED = new Set([
  'Iran', 'North Korea', 'Syria', 'Cuba', 'Russia', 'Belarus', 'Venezuela'
]);

function templateHighRiskCountry(ctx) {
  const { customer, alerted_transactions: txns, transaction_summary: ts, case_notes } = ctx;
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const countries = listCountries(txns);
  const countriesStr = countries.join(', ') || 'high-risk jurisdictions';
  const channels = [...new Set((txns || []).map(t => t.channel).filter(Boolean))].join(' and ') || 'wire transfer';

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName} conducted ${ts.alerted_count} international transaction${ts.alerted_count === 1 ? '' : 's'}`,
    `totaling ${formatCurrency(ts.total_alerted_amount)}`,
    `involving counterparties located in ${countriesStr}.`
  );

  const fatfHits = countries.filter(c => FATF_HIGH_RISK.has(c));
  const fatfBlock = fatfHits.length > 0
    ? `${fatfHits.join(', ')} appear${fatfHits.length === 1 ? 's' : ''} on the FATF list of high-risk jurisdictions subject to increased monitoring.`
    : '';

  const ofacHits = countries.filter(c => OFAC_SANCTIONED.has(c));
  const ofacBlock = ofacHits.length > 0
    ? `${ofacHits.join(', ')} ${ofacHits.length === 1 ? 'is' : 'are'} subject to OFAC sanctions programs.`
    : '';

  const cps = listCounterparties(txns);
  const detail = paragraph(
    `The transactions were conducted via ${channels}`,
    cps ? `and involved the following counterparties: ${cps}.` : '.'
  );

  const note = lastNote(case_notes);
  const occ = customer?.job_title || customer?.business_type || '';
  const sof = customer?.source_of_funds || '';
  const justification = (occ || sof)
    ? `${INSTITUTION} was unable to identify a clear and documented business justification for the international transfers based on the customer's stated occupation of ${occ || 'record'} and source of funds of ${sof || 'record'}.`
    : `${INSTITUTION} was unable to identify a clear and documented business justification for the international transfers.`;

  const noteBlock = note ? `Investigation findings: ${truncateNote(note.note_text)}` : '';

  return block(opening, fatfBlock, ofacBlock, detail, justification, noteBlock, closing());
}

// ─────────────────────────────────────────────── template 3: Watchlist Hit

function templateWatchlistHit(ctx) {
  const { customer, alerted_transactions: txns, transaction_summary: ts, case_notes } = ctx;
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const cps = listCounterparties(txns) || 'counterparties subject to ongoing review';

  const opening = paragraph(
    `During transaction monitoring for the period ${dateRange},`,
    `${INSTITUTION} identified that ${customerName} conducted`,
    `${ts.alerted_count} transaction${ts.alerted_count === 1 ? '' : 's'} totaling ${formatCurrency(ts.total_alerted_amount)}`,
    `involving counterparty/counterparties that returned potential matches against watchlist screening.`
  );

  const flagged = `The flagged transaction(s) involved the following counterparties: ${cps}.`;

  const pep = (customer && Number(customer.pep_match) === 1)
    ? `Additionally, ${customerName} has been identified as a Politically Exposed Person (PEP), which elevates the risk profile of this activity.`
    : '';

  const sanctions = (customer && Number(customer.sanctions_match) === 1)
    ? `${customerName} has an existing sanctions match on file which was considered in this review.`
    : '';

  const note = lastNote(case_notes);
  const noteBlock = note ? `Investigation notes: ${truncateNote(note.note_text)}` : '';

  const conclusion = `${INSTITUTION} conducted a review of the flagged activity and determined that it could not be reasonably explained.`;

  return block(opening, flagged, pep, sanctions, noteBlock, conclusion, closing());
}

// ─────────────────────────────────────────────── template 4: Cash Intensive

function templateCashIntensive(ctx) {
  const { customer, transaction_summary: ts, case_notes, l2 } = ctx;
  const cust = describeCustomer(customer);
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const occ = customer?.job_title || customer?.business_type || 'record';
  const sof = customer?.source_of_funds || 'record';

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName},`,
    cust.profile ? cust.profile : '',
    cust.operating_as ? `(${cust.operating_as}),` : (cust.profile ? ',' : ''),
    `conducted ${ts.alerted_count} cash transaction${ts.alerted_count === 1 ? '' : 's'}`,
    `totaling ${formatCurrency(ts.total_alerted_amount)}.`
  );

  const inconsistent = `The volume and frequency of cash activity is inconsistent with the customer's stated occupation of ${occ} and declared source of funds of ${sof}. The customer's expected monthly transaction value on file does not account for the observed cash activity during this period.`;

  const note = lastNote(case_notes);
  const noteBlock = note ? `During investigation: ${truncateNote(note.note_text)}` : '';

  const escalated = l2
    ? `This matter was escalated for enhanced Level 2 review due to the nature and volume of the cash activity identified.`
    : '';

  return block(opening, inconsistent, noteBlock, escalated,
    `Based on the foregoing, ${INSTITUTION} has determined that the described cash activity warrants the filing of this Suspicious Activity Report pursuant to 31 U.S.C. § 5318(g).`);
}

// ─────────────────────────────────────────────── template 5: Rapid Movement

function templateRapidMovement(ctx) {
  const { customer, alerted_transactions: txns, transaction_summary: ts, case_notes } = ctx;
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;

  const credits = (txns || []).filter(t => /credit/i.test(t.txn_type || ''));
  const debits = (txns || []).filter(t => /debit/i.test(t.txn_type || ''));
  const totalCredit = credits.reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalDebit = debits.reduce((s, t) => s + Number(t.amount || 0), 0);

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName} exhibited a pattern of rapid movement of funds through account(s) held at ${INSTITUTION}.`
  );

  const flow = paragraph(
    `Specifically, the account received credits of approximately ${formatCurrency(totalCredit)}`,
    `and disbursed approximately ${formatCurrency(totalDebit)} within a short timeframe, with minimal retained balance.`,
    `The total alerted transaction value was ${formatCurrency(ts.total_alerted_amount)} across ${ts.alerted_count} transaction${ts.alerted_count === 1 ? '' : 's'}.`
  );

  const countries = listCountries(txns);
  const countryNote = countries.length > 0 ? ` including counterparties located in ${countries.join(', ')}` : '';
  const dispersion = `The funds were disbursed to ${ts.unique_counterparties || 0} unique counterparties${countryNote}.`;

  const pattern = `This pass-through pattern, where funds are rapidly received and disbursed with little retention, is consistent with potential layering activity.`;

  const note = lastNote(case_notes);
  const noteBlock = note ? `Investigation findings: ${truncateNote(note.note_text)}` : '';

  return block(opening, flow, dispersion, pattern, noteBlock, closing());
}

// ─────────────────────────────────────────────── template 6: Trade Based ML

function templateTradeBasedML(ctx) {
  const { customer, alerted_transactions: txns, transaction_summary: ts, case_notes } = ctx;
  const cust = describeCustomer(customer);
  const customerName = customer?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const businessClause = cust.isBusiness && cust.profile
    ? `${cust.profile}${cust.operating_as ? ` (${cust.operating_as})` : ''},`
    : '';
  const countries = listCountries(txns);
  const channels = [...new Set((txns || []).map(t => t.channel).filter(Boolean))].join(', ') || 'mixed channels';

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName},`,
    businessClause,
    `conducted ${ts.alerted_count} transaction${ts.alerted_count === 1 ? '' : 's'}`,
    `totaling ${formatCurrency(ts.total_alerted_amount)}`,
    `that exhibited characteristics consistent with trade-based money laundering typologies.`
  );

  const detail = paragraph(
    `The transactions involved counterparties in ${countries.join(', ') || 'multiple jurisdictions'}`,
    `and were conducted via ${channels}.`
  );

  const note = lastNote(case_notes);
  const noteBlock = note ? `Investigation notes identified the following: ${truncateNote(note.note_text)}` : '';

  const concern = `The observed activity, including the nature of the counterparties and transaction patterns, raised concerns that could not be reasonably explained by the customer's stated business purpose.`;

  return block(opening, detail, noteBlock, concern, closing());
}

// ─────────────────────────────────────────────── fallback

function templateFallback(ctx) {
  const { alert, customer, transaction_summary: ts, case_notes } = ctx;
  const customerName = customer?.customer_name || alert?.customer_name || 'The customer';
  const dateRange = `${formatDate(ts.date_range_start)} to ${formatDate(ts.date_range_end)}`;
  const scenario = alert?.scenario || 'the institution\'s monitoring rules';

  const opening = paragraph(
    `During the review period of ${dateRange},`,
    `${customerName} conducted ${ts.alerted_count} transaction${ts.alerted_count === 1 ? '' : 's'}`,
    `totaling ${formatCurrency(ts.total_alerted_amount)}`,
    `that were identified as potentially suspicious by the institution's transaction monitoring system under the ${scenario} scenario.`
  );

  const note = lastNote(case_notes);
  const noteBlock = note ? truncateNote(note.note_text) : '';

  const review = `Following a review of the flagged activity, ${INSTITUTION} has determined that the described transactions warrant the filing of this Suspicious Activity Report pursuant to 31 U.S.C. § 5318(g).`;

  return block(opening, noteBlock, review);
}

// ─────────────────────────────────────────────── dispatcher

const TEMPLATES = [
  { match: /^structur/i,           name: 'Structuring',         fn: templateStructuring },
  { match: /high.?risk.?country/i, name: 'High Risk Country',   fn: templateHighRiskCountry },
  { match: /watch.?list/i,         name: 'Watchlist Hit',       fn: templateWatchlistHit },
  { match: /cash.?intensive/i,     name: 'Cash Intensive',      fn: templateCashIntensive },
  { match: /rapid|pass.?through|layering/i, name: 'Rapid Movement', fn: templateRapidMovement },
  { match: /trade.?based|tbml/i,   name: 'Trade Based ML',      fn: templateTradeBasedML }
];

function pickTemplate(scenario) {
  if (!scenario) return { name: 'Fallback', fn: templateFallback };
  for (const t of TEMPLATES) if (t.match.test(scenario)) return { name: t.name, fn: t.fn };
  return { name: 'Fallback', fn: templateFallback };
}

function generateNarrative(data) {
  const t = pickTemplate(data?.alert?.scenario);
  const text = t.fn(data);
  return { text, template: t.name };
}

module.exports = {
  generateNarrative,
  // exposed for unit tests / debugging
  formatCurrency,
  formatDate,
  daysBetween,
  listCountries,
  listCounterparties,
  getRiskFactorList,
  truncateNote,
  pickTemplate,
  INSTITUTION
};
