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

const requireManager      = roleGuard(['compliance_manager']);
const requireL2OrManager  = roleGuard(['analyst_l2', 'compliance_manager']);
const requireAnyAnalyst   = roleGuard(['analyst_l1', 'analyst_l2', 'compliance_manager']);
const requireL1Only       = roleGuard(['analyst_l1']);

module.exports = {
  roleGuard,
  requireManager,
  requireL2OrManager,
  requireAnyAnalyst,
  requireL1Only
};
