import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { RoleProvider } from './state/RoleContext.jsx';
import { InvestigationTabsProvider } from './state/InvestigationTabsContext.jsx';
import { ToastProvider } from './state/ToastContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <InvestigationTabsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </InvestigationTabsProvider>
      </RoleProvider>
    </BrowserRouter>
  </React.StrictMode>
);
