import ReopenRequestsQueue from './ReopenRequestsQueue.jsx';

// BSA Officer flavour of the reopen-requests queue — same page, different
// mode prop. Routed at /bsa/reopen-requests so the BSA sidebar entry can
// resolve cleanly.
export default function BsaReopenQueue() {
  return <ReopenRequestsQueue mode="bsa" />;
}
