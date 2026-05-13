import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import NextUpFloat from './components/investigation/NextUpFloat.jsx';
import { useInvestigationTabs } from './state/InvestigationTabsContext.jsx';
import { useRoleNavigate } from './state/useRoleNavigate.js';
import Dashboard from './pages/Dashboard.jsx';
import Alerts from './pages/Alerts.jsx';
import Cases from './pages/Cases.jsx';
import SARRepository from './pages/SARRepository.jsx';
import RetentionMonitor from './pages/RetentionMonitor.jsx';
import AuditLog from './pages/AuditLog.jsx';
import CustomerKYC from './pages/CustomerKYC.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import SARFiling from './pages/SARFiling.jsx';
import SARApprovalQueue from './pages/SARApprovalQueue.jsx';
import SARApprovalReview from './pages/SARApprovalReview.jsx';
import KYCReviewQueue from './pages/KYCReviewQueue.jsx';
import KYCReviewWorkspace from './pages/KYCReviewWorkspace.jsx';
import Analytics from './pages/Analytics.jsx';
import Reports from './pages/Reports.jsx';
import Investigations from './pages/Investigations.jsx';
import BsaDashboard from './pages/BsaDashboard.jsx';
import ReopenRequestsQueue from './pages/ReopenRequestsQueue.jsx';
import BsaReopenQueue from './pages/BsaReopenQueue.jsx';
import SLAPopup from './components/SLAPopup.jsx';
import Placeholder from './pages/Placeholder.jsx';
import Login from './pages/Login.jsx';
import ProtectedRoute, { RootRedirect } from './components/ProtectedRoute.jsx';

function Shell({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 overflow-x-hidden">{children}</main>
      </div>
      <SLAPopup />
      <NextUpFloatIdle />
    </div>
  );
}

/**
 * Renders the floating "Next Priority" widget ONLY when the analyst is
 * idle — meaning they are NOT currently inside an investigation
 * workspace. Definition of "in a workspace": the route is the alerts
 * page (`/alerts` segment) AND an investigation tab is currently
 * active. Everywhere else (dashboard, settings, reports, customer
 * profile, KYC queue, etc.) the float is visible so the next-up alert
 * stays one click away.
 *
 * NextUpFloat itself self-gates to L1 analysts internally, so manager
 * and L2 sessions render nothing regardless of where they navigate.
 */
function NextUpFloatIdle() {
  const { activeId } = useInvestigationTabs();
  const location = useLocation();
  const { goTo } = useRoleNavigate();

  const onAlertsRoute = /\/alerts(\/|$|\?)/.test(location.pathname);
  const inActiveInvestigation = onAlertsRoute && !!activeId;
  if (inActiveInvestigation) return null;

  return (
    <NextUpFloat
      excludeAlertId={null}
      onOpen={(next) => goTo(`alerts?alert=${next.alert_id}`)}
    />
  );
}

export default function App() {
  return (
    <Routes>
      {/* Login (public) */}
      <Route path="/login" element={<Login />} />

      {/* Root → send the user to wherever they belong */}
      <Route path="/" element={<RootRedirect />} />

      {/* MANAGER */}
      <Route path="/manager" element={<Navigate to="/manager/dashboard" replace />} />
      <Route
        path="/manager/*"
        element={
          <ProtectedRoute allowedRoles={['compliance_manager', 'bsa_officer']}>
            <Shell>
              <Routes>
                <Route path="dashboard"             element={<Dashboard />} />
                <Route path="alerts"                element={<Alerts />} />
                <Route path="cases"                 element={<Cases />} />
                <Route path="investigations"        element={<Investigations />} />
                <Route path="customers"             element={<CustomerKYC />} />
                <Route path="customers/:id"         element={<CustomerKYC />} />
                <Route path="sars"                  element={<SARRepository />} />
                <Route path="sar-approvals"         element={<SARApprovalQueue />} />
                <Route path="sar-approval/:sarId"   element={<SARApprovalReview />} />
                <Route path="kyc-reviews"           element={<KYCReviewQueue scope="manager" />} />
                <Route path="reopen-requests"       element={<ReopenRequestsQueue mode="manager" />} />
                <Route path="kyc-review/:reviewId"  element={<KYCReviewWorkspace />} />
                <Route path="retention"             element={<RetentionMonitor />} />
                <Route path="audit"                 element={<AuditLog />} />
                <Route path="reports"               element={<Reports />} />
                <Route path="analytics"             element={<Analytics />} />
                <Route path="users"                 element={<Users />} />
                <Route path="settings"              element={<Settings />} />
                <Route path="*"                     element={<Navigate to="/manager/dashboard" replace />} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
      />

      {/* BSA OFFICER — program oversight + final SAR sign-off */}
      <Route path="/bsa" element={<Navigate to="/bsa/dashboard" replace />} />
      <Route
        path="/bsa/*"
        element={
          <ProtectedRoute allowedRoles={['bsa_officer']}>
            <Shell>
              <Routes>
                <Route path="dashboard"             element={<BsaDashboard />} />
                <Route path="alerts"                element={<Alerts />} />
                <Route path="cases"                 element={<Cases />} />
                <Route path="customers"             element={<CustomerKYC />} />
                <Route path="customers/:id"         element={<CustomerKYC />} />
                <Route path="sar-repository"        element={<SARRepository />} />
                <Route path="sar-approvals"         element={<SARApprovalQueue />} />
                <Route path="sar-approval/:sarId"   element={<SARApprovalReview />} />
                <Route path="retention"             element={<RetentionMonitor />} />
                <Route path="audit-trail"           element={<AuditLog />} />
                <Route path="reopen-requests"       element={<BsaReopenQueue />} />
                <Route path="*"                     element={<Navigate to="/bsa/dashboard" replace />} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
      />

      {/* EMPLOYEE */}
      <Route path="/employee" element={<Navigate to="/employee/dashboard" replace />} />
      <Route
        path="/employee/*"
        element={
          <ProtectedRoute allowedRoles={['analyst_l1', 'analyst_l2']}>
            <Shell>
              <Routes>
                <Route path="dashboard"             element={<Dashboard />} />
                <Route path="alerts"                element={<Alerts />} />
                <Route path="cases"                 element={
                  <ProtectedRoute allowedRoles={['analyst_l2']}>
                    <Cases />
                  </ProtectedRoute>
                } />
                <Route path="customers"             element={<CustomerKYC />} />
                <Route path="customers/:id"         element={<CustomerKYC />} />
                <Route path="sars"                  element={
                  <ProtectedRoute allowedRoles={['analyst_l2']}>
                    <SARRepository />
                  </ProtectedRoute>
                } />
                <Route path="sar-filing/:caseId"    element={
                  <ProtectedRoute allowedRoles={['analyst_l2']}>
                    <SARFiling />
                  </ProtectedRoute>
                } />
                <Route path="kyc-reviews/mine"      element={<KYCReviewQueue scope="mine" />} />
                <Route path="kyc-review/:reviewId"  element={<KYCReviewWorkspace />} />
                <Route path="reports"               element={<Reports />} />
                <Route path="settings"              element={<Settings />} />
                <Route path="*"                     element={<Navigate to="/employee/dashboard" replace />} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
      />

      {/* anything else → root redirect */}
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
