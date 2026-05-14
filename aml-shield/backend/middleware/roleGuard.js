// Centralized role-based authorisation. The frontend axios interceptor
// stamps x-user-role on every request from the logged-in user (see
// frontend/src/api/client.js). Each route that mutates state mounts one
// of the pre-built guards below.
//
// Whitelist semantics — missing/empty role → 401, unknown role → 403.
// GET routes are intentionally left ungated so all logged-in roles can
// continue to read.

const roleGuard = (allowedRoles) => {
  return (req, res, next) => {
    const role = req.headers['x-user-role'];
    if (!role) {
      return res.status(401).json({ error: 'Unauthorized — no role provided' });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Access denied — requires: ${allowedRoles.join(' or ')}`
      });
    }
    next();
  };
};

// BSA Officer has at-least-manager privileges by program design — anywhere
// a compliance manager is allowed, the BSA Officer is too. We don't grant
// any BSA-specific permissions in this guard layer yet; BSA-only gates
// (retention disposition, dual-approval policy edits, KYC policy approval)
// will arrive in a follow-up change that adds dedicated middlewares.
const requireManager      = roleGuard(['compliance_manager', 'bsa_officer']);
const requireL2OrManager  = roleGuard(['analyst_l2', 'compliance_manager', 'bsa_officer']);
const requireAnyAnalyst   = roleGuard(['analyst_l1', 'analyst_l2', 'compliance_manager', 'bsa_officer']);
const requireL1Only       = roleGuard(['analyst_l1']);
const requireBsaOfficer   = roleGuard(['bsa_officer']);
const requireBsaOrManager = roleGuard(['bsa_officer', 'compliance_manager']);

module.exports = {
  roleGuard,
  requireManager,
  requireL2OrManager,
  requireAnyAnalyst,
  requireL1Only,
  requireBsaOfficer,
  requireBsaOrManager
};
