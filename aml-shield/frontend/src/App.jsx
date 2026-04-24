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
    </div>
  );
}
