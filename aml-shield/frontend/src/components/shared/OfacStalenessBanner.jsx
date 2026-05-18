import { ShieldAlert, RefreshCw, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useToast } from '../../state/ToastContext.jsx';
import { useRole } from '../../state/RoleContext.jsx';

// ─────────────────────────────────────────────────────────────────────────
// OfacStalenessBanner — compliance warning surfaced when the OFAC SDN list
// is older than the configured threshold OR a sync is currently running.
//
// Renders NOTHING in the healthy state. When stale, renders a red banner
// with NO close button — staleness is a compliance condition, not a
// notification. It disappears only when the next dashboard refresh shows
// the list as fresh again.
//
// BSA Officers see an inline "Trigger Manual OFAC Sync" button alongside
// the message; managers see the banner only.
// ─────────────────────────────────────────────────────────────────────────

function formatTimestamp(iso) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch (_e) {
    return iso;
  }
}

export default function OfacStalenessBanner({ ofacSyncStatus, onSynced }) {
  if (!ofacSyncStatus) return null;
  const { isStale, currentlySyncing } = ofacSyncStatus;
  if (!isStale && !currentlySyncing) return null;

  // Stale takes precedence over "currently syncing". If both are true,
  // the user has more useful information from the red banner.
  if (isStale) {
    return <StaleBanner ofacSyncStatus={ofacSyncStatus} onSynced={onSynced} />;
  }
  return <SyncingBanner />;
}

function StaleBanner({ ofacSyncStatus, onSynced }) {
  const { currentUser } = useRole();
  const { push } = useToast();
  const isBsaOfficer = currentUser?.role === 'bsa_officer';
  const [syncing, setSyncing] = useState(false);
  const pollTimer = useRef(null);
  const pollCount = useRef(0);

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  const triggerManualSync = async () => {
    setSyncing(true);
    try {
      await api.post('/ofac/sync/trigger', {
        performed_by: currentUser?.name || 'BSA Officer'
      });
      push('OFAC sync triggered. The list will update within the next few minutes.', 'success', 4000);

      // Poll /sync-status every 10s for up to 5 minutes; stop on
      // success/failed/timeout.
      pollCount.current = 0;
      pollTimer.current = setInterval(async () => {
        pollCount.current += 1;
        if (pollCount.current >= 30) {
          clearInterval(pollTimer.current);
          pollTimer.current = null;
          setSyncing(false);
          return;
        }
        try {
          const r = await api.get('/ofac/sync-status');
          const latest = r.data?.recentRuns?.[0];
          if (latest && (latest.status === 'success' || latest.status === 'failed')) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
            setSyncing(false);
            if (onSynced) onSynced();
          }
        } catch (_e) { /* keep polling */ }
      }, 10000);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Unknown error';
      push(`Manual sync failed: ${msg}`, 'error', 5000);
      setSyncing(false);
    }
  };

  const lastSyncDesc = formatTimestamp(ofacSyncStatus.lastSuccessfulSyncAt);

  return (
    <div
      role="alert"
      className="flex items-start gap-3 bg-red-700 text-white px-4 py-3 rounded-md"
    >
      <ShieldAlert size={20} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">
          ⚠ OFAC SDN List Stale — Last successful sync: {lastSyncDesc}
        </div>
        <div className="text-xs mt-0.5 opacity-90">
          Sanctions screening results may not reflect the current OFAC list.
          Contact your BSA Officer immediately.
        </div>
      </div>
      {isBsaOfficer && (
        <button
          type="button"
          onClick={triggerManualSync}
          disabled={syncing}
          className="shrink-0 text-xs px-3 py-1.5 rounded border border-white/40 bg-white/10 hover:bg-white/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {syncing ? (
            <><Loader2 size={12} className="animate-spin" /> Syncing…</>
          ) : (
            <><RefreshCw size={12} /> Trigger Manual OFAC Sync</>
          )}
        </button>
      )}
    </div>
  );
}

function SyncingBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 bg-amber-500 text-white px-4 py-3 rounded-md"
    >
      <Loader2 size={20} className="shrink-0 mt-0.5 animate-spin" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">↻ OFAC SDN List sync in progress…</div>
        <div className="text-xs mt-0.5 opacity-90">
          Sanctions screenings against the freshest list will resume as soon as the
          sync completes.
        </div>
      </div>
    </div>
  );
}
