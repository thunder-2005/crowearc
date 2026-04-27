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
import SLAPopup from './components/SLAPopup.jsx';
import Placeholder from './pages/Placeholder.jsx';

export default function App() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/investigations" element={<Placeholder title="Investigations" />} />
            <Route path="/customers" element={<CustomerKYC />} />
            <Route path="/customers/:id" element={<CustomerKYC />} />
            <Route path="/sars" element={<SARRepository />} />
            <Route path="/sar-filing/:caseId" element={<SARFiling />} />
            <Route path="/sar-approvals" element={<SARApprovalQueue />} />
            <Route path="/sar-approval/:sarId" element={<SARApprovalReview />} />
            <Route path="/kyc-reviews" element={<KYCReviewQueue scope="manager" />} />
            <Route path="/kyc-reviews/mine" element={<KYCReviewQueue scope="mine" />} />
            <Route path="/kyc-review/:reviewId" element={<KYCReviewWorkspace />} />
            <Route path="/retention" element={<RetentionMonitor />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/reports" element={<Placeholder title="Reports" />} />
            <Route path="/analytics" element={<Placeholder title="Analytics" />} />
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <SLAPopup />
    </div>
  );
}
