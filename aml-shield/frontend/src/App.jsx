import { Component } from 'react';
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
import BsaRegulatoryCorrespondence from './pages/BsaRegulatoryCorrespondence.jsx';
import ExamReadiness from './pages/ExamReadiness.jsx';
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
        <main className="flex-1 p-6 overflow-x-hidden">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <SLAPopup />
      <NextUpFloatIdle />
    </div>
  );
}

// Catches render-time exceptions in the page content so we never serve a
// completely blank screen — without this, any unhandled JSX/runtime error
// in a child component (a misnamed prop, a bad axios response shape, etc.)
// silently unmounts the entire route. The fallback shows the error message
// + a Reload button so analysts can recover without DevTools.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto mt-12 bg-white border border-red-200 rounded-lg shadow-sm p-6">
          <div className="text-red-700 font-semibold mb-2">Something went wrong rendering this page.</div>
          <div className="text-sm text-slate-700 mb-3 break-words">
            {String(this.state.error?.message || this.state.error)}
          </div>
          <div className="text-xs text-slate-500 mb-4">
            The full stack trace is in your browser DevTools console. The rest of the app is still working —
            navigate via the sidebar.
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
  const { activeId, openTab } = useInvestigationTabs();
  const location = useLocation();
  const { goTo } = useRoleNavigate();

  const onAlertsRoute = /\/alerts(\/|$|\?)/.test(location.pathname);
  const inActiveInvestigation = onAlertsRoute && !!activeId;
  if (inActiveInvestigation) return null;

  // Clicking Open Alert: register the alert in InvestigationTabsContext
  // (which sets activeId), then navigate to the alerts route. The alerts
  // page reads activeTab from context and renders InvestigationWorkspace
  // automatically — no URL-param coordination needed. (The previous
  // implementation passed `?alert=...` in the query string, but
  // Alerts.jsx never read it, so nothing opened.)
  const handleOpen = (next) => {
    openTab(next, { level: 'L1' });
    goTo('alerts');
  };

  return (
    <NextUpFloat
      excludeAlertId={null}
      onOpen={handleOpen}
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
                <Route path="regulatory-correspondence" element={<BsaRegulatoryCorrespondence />} />
                <Route path="exam-readiness"        element={<ExamReadiness />} />
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
