// Auto-generates rule_explanation JSONB for every alert that currently
// has rule_explanation = NULL. Safe to re-run (the WHERE clause filters
// out already-populated rows).
//
// Usage:
//   DATABASE_URL=... node scripts/generateRuleExplanations.js          (live update)
//   DATABASE_URL=... node scripts/generateRuleExplanations.js --dry    (print 1 sample per scenario, no DB writes)
//
// Notes:
//  - The alerts table column is amount_flagged_inr (BIGINT, USD whole
//    dollars despite the legacy column name).
//  - Date column is created_date (TEXT).
//  - DB scenario strings are Title Case ('Structuring', 'High Risk Country',
//    …); we map them to UPPER_SNAKE_CASE keys ('STRUCTURING', …) so the
//    JSON.scenario matches the 24 explained alerts and the frontend banner's
//    pill-recipe switch.

require('dotenv').config();
const { Pool } = require('pg');

const SCENARIO_KEY = {
  'Structuring':       'STRUCTURING',
  'High Risk Country': 'HIGH_RISK_COUNTRY',
  'Watchlist Hit':     'WATCHLIST_HIT',
  'Cash Intensive':    'CASH_INTENSIVE',
  'Rapid Movement':    'RAPID_MOVEMENT',
  'Trade Based ML':    'TRADE_BASED_ML'
};

const HIGH_RISK_COUNTRIES = ['Myanmar', 'Yemen', 'Syria', 'Russia', 'Iran', 'Pakistan', 'Haiti'];
const WATCHLISTS = [
  'OFAC SDN List',
  'OFAC Consolidated Non-SDN List',
  'UN Security Council List',
  'Internal PEP List'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function usd(n) { return `$${Number(n || 0).toLocaleString('en-US')}`; }

// ─────────────────────────────────────────────── scenario templates

function structuringExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const txnCount = Math.max(3, Math.floor(amount / 9200) + rand(3, 6));
  const priority = (alert.priority || '').toLowerCase();
  const windowDays = priority === 'high' ? 7 : priority === 'medium' ? 12 : 18;
  const minAmt = 8500 + rand(0, 499);
  const maxAmt = 9600 + rand(0, 399);

  const redFlags = [
    'All cash deposits fell below the $10,000 CTR reporting threshold',
    'Deposits concentrated within a short time window',
    'Pattern inconsistent with customer stated income',
    txnCount > 7
      ? 'Multiple accounts used to distribute deposits'
      : 'Repeated visits to same branch'
  ];

  // Only surface the per-deposit range when the math actually fits the
  // alerted total. For very small alerts the txnCount × minAmt > total
  // and printing the range would be internally inconsistent.
  const avgPerTxn = txnCount > 0 ? amount / txnCount : 0;
  const rangeFits = avgPerTxn >= minAmt && avgPerTxn <= maxAmt;

  const observed = {
    transaction_count: txnCount,
    total_amount_usd: amount,
    window_days: windowDays,
    accounts_involved: txnCount > 6 ? 2 : 1,
    channel: 'Branch'
  };
  if (rangeFits) observed.amount_range_usd = `$${minAmt}-$${maxAmt}`;

  return {
    scenario: 'STRUCTURING',
    version: 'v2',
    rule_summary: `${alert.customer_name} conducted ${txnCount} cash deposits totaling ${usd(amount)} over ${windowDays} days, each structured below the $10,000 CTR reporting threshold.`,
    thresholds_at_detection: {
      min_txn_amount: 8000,
      max_txn_amount: 9999,
      min_count: 3,
      window_days: 10
    },
    observed,
    red_flags: redFlags
  };
}

function highRiskCountryExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const country = pick(HIGH_RISK_COUNTRIES);
  const txnCount = rand(2, 4);
  const avgAmt = Math.floor(amount / txnCount);

  return {
    scenario: 'HIGH_RISK_COUNTRY',
    version: 'v2',
    rule_summary: `${alert.customer_name} sent ${txnCount} international wire transfers totaling ${usd(amount)} to counterparties located in ${country}, a FATF high-risk jurisdiction.`,
    thresholds_at_detection: {
      min_amount: 5000,
      risk_tier: 'high',
      include_fatf_grey: true,
      include_ofac_countries: true
    },
    observed: {
      transaction_count: txnCount,
      total_amount_usd: amount,
      average_wire_usd: avgAmt,
      destination_country: country,
      counterparty_country: country,
      fatf_status: 'Grey List',
      channel: 'Wire Transfer'
    },
    red_flags: [
      `Destination country ${country} is on the FATF high-risk jurisdiction list`,
      'No documented business purpose for international transfers',
      'Transaction volume inconsistent with customer profile',
      'Multiple wires to same high-risk jurisdiction'
    ]
  };
}

function watchlistHitExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const matchScore = 85 + Math.floor(Math.random() * 15); // 85..99
  const watchlist = pick(WATCHLISTS);

  return {
    scenario: 'WATCHLIST_HIT',
    version: 'v2',
    rule_summary: `A transaction involving ${alert.customer_name} returned a ${matchScore}% name match against the ${watchlist}, triggering enhanced review.`,
    thresholds_at_detection: {
      min_match_score: 85,
      screen_counterparties: true,
      screen_beneficial_owners: true
    },
    observed: {
      match_score_pct: matchScore,
      match_scores: [matchScore],
      list_screened: watchlist,
      transaction_amount_usd: amount,
      total_amount_usd: amount,
      match_type: matchScore > 95 ? 'Primary Name' : 'AKA Match',
      channel: 'Wire Transfer'
    },
    red_flags: [
      `Name match score of ${matchScore}% exceeds the 85% screening threshold`,
      'Transaction involves international wire transfer',
      'Customer has not provided documentation to resolve match',
      matchScore > 95
        ? 'High confidence primary name match detected'
        : 'Partial name match across multiple aliases'
    ]
  };
}

function cashIntensiveExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const weeks = rand(2, 5);
  const weeklyAvg = Math.floor(amount / weeks);

  return {
    scenario: 'CASH_INTENSIVE',
    version: 'v2',
    rule_summary: `${alert.customer_name} made recurring large cash deposits totaling ${usd(amount)} over ${weeks} weeks, significantly exceeding expected monthly cash activity.`,
    thresholds_at_detection: {
      weekly_threshold: 15000,
      monthly_threshold: 50000,
      lookback_days: 30
    },
    observed: {
      total_amount_usd: amount,
      total_cash_deposits_usd: amount,
      period_weeks: weeks,
      average_weekly_deposit_usd: weeklyAvg,
      weekly_peak_usd: Math.floor(weeklyAvg * 1.4),
      channel: 'Branch',
      transaction_type: 'Cash Deposit'
    },
    red_flags: [
      'Cash deposit volume significantly exceeds customer stated income',
      'Deposits inconsistent with documented source of funds',
      'Recurring pattern of large cash activity',
      'No documented business justification for cash intensity'
    ]
  };
}

function rapidMovementExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const outgoingCount = rand(4, 7);
  const outflowPct = 88 + Math.floor(Math.random() * 8); // 88..95
  const outgoingTotal = Math.floor(amount * (outflowPct / 100));
  const residual = amount - outgoingTotal;
  const windowHours = pick([24, 36, 48]);

  return {
    scenario: 'RAPID_MOVEMENT',
    version: 'v2',
    rule_summary: `${alert.customer_name} received ${usd(amount)} and disbursed ${usd(outgoingTotal)} across ${outgoingCount} outgoing wires within ${windowHours} hours, retaining only ${usd(residual)}.`,
    thresholds_at_detection: {
      min_inflow_usd: 50000,
      outflow_pct_threshold: 85,
      window_hours: 48
    },
    observed: {
      inflow_amount_usd: amount,
      inflow_usd: amount,
      outflow_amount_usd: outgoingTotal,
      outflow_usd: outgoingTotal,
      outflow_pct: outflowPct,
      outgoing_wire_count: outgoingCount,
      window_hours: windowHours,
      residual_balance_usd: residual
    },
    red_flags: [
      'Funds disbursed within 48 hours of receipt with minimal retention',
      'Pattern consistent with layering activity',
      `${outgoingCount} outgoing wires to multiple counterparties`,
      'Inflow amount inconsistent with customer profile'
    ]
  };
}

function tradeBasedExplanation(alert) {
  const amount = Number(alert.amount_flagged_inr) || 0;
  const jurisdictions = rand(3, 4);
  const invoiceMismatch = rand(20, 59);

  return {
    scenario: 'TRADE_BASED_ML',
    version: 'v2',
    rule_summary: `${alert.customer_name} conducted trade-related wire transfers totaling ${usd(amount)} across ${jurisdictions} jurisdictions with invoice values inconsistent with industry benchmarks.`,
    thresholds_at_detection: {
      invoice_mismatch_pct: 20,
      min_transaction_amount: 10000,
      multi_jurisdiction: true
    },
    observed: {
      total_amount_usd: amount,
      jurisdictions_involved: jurisdictions,
      jurisdictions: Array.from({ length: jurisdictions }, (_, i) =>
        pick(['United States', 'Singapore', 'United Arab Emirates', 'Hong Kong', 'Turkey', 'Panama'])
      ),
      invoice_mismatch_pct: invoiceMismatch,
      average_invoice_mismatch_pct: invoiceMismatch,
      channel: 'Wire Transfer',
      transaction_type: 'International Trade Payment'
    },
    red_flags: [
      `Invoice values differ from wire amounts by ${invoiceMismatch}%`,
      `Transactions span ${jurisdictions} jurisdictions including high-risk countries`,
      'Trade purpose inconsistent with customer business profile',
      'Round-number wire amounts inconsistent with trade invoicing'
    ]
  };
}

// ─────────────────────────────────────────────── dispatch

function generateRuleExplanation(alert) {
  const key = SCENARIO_KEY[alert.scenario];
  switch (key) {
    case 'STRUCTURING':       return structuringExplanation(alert);
    case 'HIGH_RISK_COUNTRY': return highRiskCountryExplanation(alert);
    case 'WATCHLIST_HIT':     return watchlistHitExplanation(alert);
    case 'CASH_INTENSIVE':    return cashIntensiveExplanation(alert);
    case 'RAPID_MOVEMENT':    return rapidMovementExplanation(alert);
    case 'TRADE_BASED_ML':    return tradeBasedExplanation(alert);
    default:
      return {
        scenario: 'UNKNOWN',
        version: 'v2',
        rule_summary: `${alert.customer_name} triggered alert under scenario "${alert.scenario}".`,
        thresholds_at_detection: {},
        observed: {
          total_amount_usd: Number(alert.amount_flagged_inr) || 0,
          channel: 'Unknown'
        },
        red_flags: ['Scenario template not available; manual review required.']
      };
  }
}

// ─────────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry') || argv.includes('--dry-run') || argv.includes('--sample');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    if (dryRun) {
      console.log('--- DRY RUN — sampling one alert per scenario, no DB writes ---\n');
      for (const dbScenario of Object.keys(SCENARIO_KEY)) {
        const r = await pool.query(
          `SELECT alert_id, scenario, priority, amount_flagged_inr,
                  risk_score, customer_id, customer_name, customer_type,
                  assigned_to, alert_status, created_date
             FROM alerts
            WHERE rule_explanation IS NULL AND scenario = $1
            ORDER BY id ASC
            LIMIT 1`,
          [dbScenario]
        );
        if (r.rows.length === 0) {
          console.log(`### ${dbScenario}: no NULL-rule_explanation alert available`);
          continue;
        }
        const alert = r.rows[0];
        const exp = generateRuleExplanation(alert);
        console.log(`### ${dbScenario} — ${alert.alert_id} (priority ${alert.priority}, amount ${usd(alert.amount_flagged_inr)}, customer ${alert.customer_name})`);
        console.log(JSON.stringify(exp, null, 2));
        console.log('');
      }
      return;
    }

    // Live update mode
    const all = (await pool.query(`
      SELECT alert_id, scenario, priority, amount_flagged_inr,
             risk_score, customer_id, customer_name, customer_type,
             assigned_to, alert_status, created_date
        FROM alerts
       WHERE rule_explanation IS NULL
       ORDER BY id ASC
    `)).rows;
    console.log(`[rule-gen] ${all.length} alert(s) need rule_explanation`);

    const BATCH = 50;
    let updated = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < all.length; i++) {
      const alert = all[i];
      try {
        const exp = generateRuleExplanation(alert);
        await pool.query(
          `UPDATE alerts SET rule_explanation = $1::jsonb WHERE alert_id = $2`,
          [JSON.stringify(exp), alert.alert_id]
        );
        updated++;
      } catch (e) {
        failed++;
        failures.push({ alert_id: alert.alert_id, message: e.message });
      }
      if ((i + 1) % BATCH === 0 || i === all.length - 1) {
        console.log(`[rule-gen] Updated ${i + 1}/${all.length}`);
      }
    }

    console.log(`\n[rule-gen] Complete:`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Failed:  ${failed}`);
    console.log(`  Total:   ${all.length}`);
    if (failures.length) {
      console.log('  Failures (first 5):');
      failures.slice(0, 5).forEach(f => console.log(`    - ${f.alert_id}: ${f.message}`));
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
