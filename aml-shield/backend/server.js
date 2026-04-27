const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { db, initSchema, seedAdminDataIfEmpty } = require('./database/db');

const alertsRouter = require('./routes/alerts');
const casesRouter = require('./routes/cases');
const sarsRouter = require('./routes/sars');
const documentsRouter = require('./routes/documents');
const auditTrailRouter = require('./routes/auditTrail');
const retrievalLogRouter = require('./routes/retrievalLog');
const dashboardRouter = require('./routes/dashboard');
const customersRouter = require('./routes/customers');
const caseNotesRouter = require('./routes/caseNotes');
const caseDocumentsRouter = require('./routes/caseDocuments');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const sarFilingsRouter = require('./routes/sarFilings');
const sarApprovalsRouter = require('./routes/sarApprovals');
const notificationsRouter = require('./routes/notifications');
const slaRouter = require('./routes/sla');
const kycReviewsRouter = require('./routes/kycReviews');
const slaMonitor = require('./jobs/slaMonitor');
const kycReviewMonitor = require('./jobs/kycReviewMonitor');

const app = express();
const PORT = process.env.PORT || 4000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

initSchema();
seedAdminDataIfEmpty();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aml-shield-backend', time: new Date().toISOString() });
});

app.use('/api/alerts', alertsRouter);
app.use('/api/cases', casesRouter);
app.use('/api/sars', sarsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/audit-trail', auditTrailRouter);
app.use('/api/retrieval-log', retrievalLogRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/customers', customersRouter);
app.use('/api/case-notes', caseNotesRouter);
app.use('/api/case-documents', caseDocumentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/sar-filings', sarFilingsRouter);
app.use('/api/sar-approvals', sarApprovalsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/sla', slaRouter);
app.use('/api/kyc-reviews', kycReviewsRouter);

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[aml-shield] backend listening on http://localhost:${PORT}`);
  slaMonitor.start();
  kycReviewMonitor.start();
});
