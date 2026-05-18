import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { DEFAULT_SCORING_WEIGHTS, weightsFromSettings } from '../utils/alertScoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// useScoringWeights — fetches the four scoring keys from /api/settings/manager
// on mount and returns a frozen weights object compatible with rankAlerts().
//
// Behaviour:
//   - Fires once per mount. The values are session-stable per the C-05 spec —
//     a manager changing the weights does not push them to live analyst
//     sessions; they apply on the analyst's next page load.
//   - On fetch failure (no auth, network error, bad JSON) falls back to
//     DEFAULT_SCORING_WEIGHTS and logs a single console.warn.
//   - Returns the defaults synchronously on the first render so callers
//     never block waiting for the fetch. The ranker reads valid weights
//     immediately; the network response updates the value if/when it
//     differs from the defaults.
//
// Returned shape (frozen):
//   { sla, risk, criticalDays, warningDays, lockoutOnCritical }
// ─────────────────────────────────────────────────────────────────────────────
export function useScoringWeights() {
  const [weights, setWeights] = useState(DEFAULT_SCORING_WEIGHTS);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings/manager')
      .then(r => {
        if (cancelled) return;
        const next = weightsFromSettings(r.data || {});
        // Only push a re-render when the loaded weights differ from
        // the defaults. Cheap equality check on the four numeric/bool
        // fields keeps the callers idempotent.
        if (
          next.sla !== weights.sla
          || next.criticalDays !== weights.criticalDays
          || next.warningDays !== weights.warningDays
          || next.lockoutOnCritical !== weights.lockoutOnCritical
        ) {
          setWeights(next);
        }
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[useScoringWeights] settings fetch failed; using defaults', err?.message || err);
      });
    return () => { cancelled = true; };
    // Mount-only — see component contract above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return weights;
}
