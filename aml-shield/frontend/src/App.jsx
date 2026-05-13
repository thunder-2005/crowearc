import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
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
    </div>
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
                <Route path="cases"                 element={<Cases />} />
                <Route path="customers"             element={<CustomerKYC />} />
                <Route path="customers/:id"         element={<CustomerKYC />} />
                <Route path="sars"                  element={<SARRepository />} />
                <Route path="sar-filing/:caseId"    element={<SARFiling />} />
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
