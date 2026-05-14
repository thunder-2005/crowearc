import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { RoleProvider } from './state/RoleContext.jsx';
import { InvestigationTabsProvider } from './state/InvestigationTabsContext.jsx';
import { ToastProvider } from './state/ToastContext.jsx';
import './index.css';

// Top-level error boundary — catches render-time exceptions ANYWHERE in the
// tree (including Sidebar, Topbar, and any Provider child). Without this, a
// crash in those surfaces produces a completely blank page with nothing in
// the DOM and no clue what failed. The fallback prints the message + stack
// so we can fix the root cause instead of guessing.
class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', error, info?.componentStack);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto' }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16 }}>
            <div style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 8 }}>
              Crowe ARC — Render Error
            </div>
            <div style={{ fontSize: 14, color: '#1f2937', marginBottom: 12, wordBreak: 'break-word' }}>
              {String(this.state.error?.message || this.state.error)}
            </div>
            {this.state.info?.componentStack && (
              <pre style={{ background: '#fff', border: '1px solid #fee2e2', padding: 10, borderRadius: 6, fontSize: 11, color: '#374151', overflow: 'auto', maxHeight: 240 }}>
                {this.state.info.componentStack}
              </pre>
            )}
            <button
              onClick={() => { this.setState({ error: null, info: null }); window.location.reload(); }}
              style={{ marginTop: 12, background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 14 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <RoleProvider>
          <InvestigationTabsProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </InvestigationTabsProvider>
        </RoleProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>
);
