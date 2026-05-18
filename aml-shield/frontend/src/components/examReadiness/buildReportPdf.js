// ═══════════════════════════════════════════════════════════════════════════
// C-11 — Examination Readiness PDF generator (client-side via jsPDF +
// jspdf-autotable, matching the pattern in pages/Reports.jsx).
//
// Sections in order:
//   1. Cover page (institution, title, classification legend, date, BSA officer)
//   2. Executive summary (overall score, check table, top 3 remediations)
//   3. Findings detail — one section per check
//   4. Open MRA summary
//   5. Regulatory reference index (hard-coded)
//
// Confidentiality footer is stamped on every page. The endpoint that fed
// this generator (GET /api/exam-readiness/runs/:id/report) already wrote
// the audit_trail + retrieval_log rows server-side.
// ═══════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const REG_INDEX = [
  ['SAR Filing Timeliness',        'Core Examination Procedures for SAR Monitoring and Filing', '31 CFR 1020.320(b)'],
  ['CDD Completeness',             'Core Examination Procedures for CDD',                       '31 CFR 1010.230'],
  ['KYC Review Timeliness',        'CDD — Ongoing Monitoring',                                  '31 CFR 1010.230(e)'],
  ['OFAC Screening Coverage',      'Core Examination Procedures for OFAC',                      '31 CFR 501.603'],
  ['Audit Trail Coverage',         'BSA/AML Compliance Programme Structures',                   '31 CFR 1020.210'],
  ['False Positive Rate Trend',    'Transaction Monitoring Systems',                            'FFIEC Manual §6'],
  ['SAR Retention Compliance',     'Recordkeeping and Reporting',                               '31 CFR 1020.320(d)']
];

function stampConfidentialityFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(
      'CONFIDENTIAL — For Internal Use Only. Protected under 31 USC §5318(g)(2).',
      40,
      pageH - 20
    );
    doc.text(`Page ${i} of ${pageCount}`, pageW - 70, pageH - 20);
  }
}

function statusBadge(status) {
  const s = (status || '').toUpperCase();
  return s;
}

function pickTopRemediations(findings, max = 3) {
  const all = [];
  for (const f of findings || []) {
    for (const r of (f.remediationItems || [])) {
      all.push({ ...r, checkName: f.checkName });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  all.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  return all.slice(0, max);
}

export function buildReportPdf(report) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // ── Cover page ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(20);
  doc.text(report.institutionName || '[Institution Name]', margin, 100);

  doc.setFontSize(16);
  doc.text('BSA/AML Examination Readiness', margin, 130);
  doc.text('Self-Assessment Report', margin, 150);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(
    'CONFIDENTIAL — For Internal Use Only.',
    margin, 200
  );
  doc.text(
    'This document is protected under 31 USC §5318(g)(2) and is not to be disclosed to third',
    margin, 215
  );
  doc.text(
    'parties. Unauthorised disclosure of suspicious activity reporting information is a',
    margin, 230
  );
  doc.text(
    'federal offense.',
    margin, 245
  );

  doc.setTextColor(20);
  doc.setFontSize(11);
  const dateGenerated = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : new Date().toLocaleString();
  doc.text(`Date of self-assessment: ${dateGenerated}`, margin, 300);
  doc.text(`BSA Officer: ${report.runByName || '(not recorded)'}`, margin, 320);
  if (report.config?.targetExamDate) {
    doc.text(`Target examination date: ${new Date(report.config.targetExamDate).toLocaleDateString()}`, margin, 340);
  }
  if (report.config?.lookbackDays) {
    doc.text(`Lookback period: ${report.config.lookbackDays} days`, margin, 360);
  }

  // ── Executive summary ───────────────────────────────────────────────────
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text('Executive Summary', margin, 60);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Overall Score: ${report.overallScore ?? '—'} / 100`, margin, 90);
  doc.text(`Overall Status: ${statusBadge(report.overallStatus)}`, margin, 108);
  doc.text(
    `Checks: ${report.checksPassed || 0} pass · ${report.checksConcern || 0} concern · ${report.checksFailed || 0} fail`,
    margin, 126
  );

  autoTable(doc, {
    startY: 150,
    head: [['Check', 'Status', 'Score', 'Failure Rate']],
    body: (report.findings || []).map(f => [
      f.checkName,
      statusBadge(f.status),
      f.score == null ? '—' : f.score,
      f.failureRate == null ? '—' : `${Number(f.failureRate).toFixed(2)}%`
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255 }
  });

  const topThree = pickTopRemediations(report.findings || [], 3);
  if (topThree.length > 0) {
    const y = doc.lastAutoTable.finalY + 24;
    doc.setFont('helvetica', 'bold');
    doc.text('Top 3 Highest-Priority Remediations', margin, y);
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y + 8,
      head: [['#', 'Priority', 'Check', 'Action']],
      body: topThree.map((r, i) => [i + 1, (r.priority || '').toUpperCase(), r.checkName, r.action]),
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 60 }, 2: { cellWidth: 130 } },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 }
    });
  }

  // ── Findings detail (one section per check) ─────────────────────────────
  for (const f of (report.findings || [])) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(f.checkName || f.checkId, margin, 60);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(f.ffiecReference || '', margin, 78);
    if (f.cfrReference) doc.text(f.cfrReference, margin, 92);

    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(
      `Status: ${statusBadge(f.status)}    Score: ${f.score ?? '—'}    Sample: ${f.sampleSize ?? '—'}    Failure rate: ${f.failureRate == null ? '—' : Number(f.failureRate).toFixed(2) + '%'}`,
      margin, 116
    );

    if (f.findingSummary) {
      const wrapped = doc.splitTextToSize(f.findingSummary, pageW - margin * 2);
      doc.setFontSize(10);
      doc.text(wrapped, margin, 138);
    }

    let cursorY = 138 + (f.findingSummary ? doc.splitTextToSize(f.findingSummary, pageW - margin * 2).length * 12 + 12 : 12);

    // For FALSE_POSITIVE_TREND emit the monthly data table; otherwise a record list.
    if (f.checkId === 'FALSE_POSITIVE_TREND' && Array.isArray(f.findingDetail) && f.findingDetail.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['Month', 'Closed', 'FP Count', 'FP Rate']],
        body: f.findingDetail.map(d => [
          d.month || d.recordId,
          d.total_closed ?? '—',
          d.fp_count ?? '—',
          d.fp_rate != null ? `${Number(d.fp_rate).toFixed(2)}%` : '—'
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [99, 102, 241], textColor: 255 }
      });
      cursorY = doc.lastAutoTable.finalY + 16;
    } else if (Array.isArray(f.findingDetail) && f.findingDetail.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['Record ID', 'Type', 'Detail', 'Severity']],
        body: f.findingDetail.map(d => [
          d.recordId || '—',
          d.recordType || '—',
          d.detailText || '',
          (d.severity || '').toUpperCase()
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 2: { cellWidth: 260 } },
        headStyles: { fillColor: [99, 102, 241], textColor: 255 }
      });
      cursorY = doc.lastAutoTable.finalY + 16;
    }

    if (Array.isArray(f.remediationItems) && f.remediationItems.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Remediation', margin, cursorY);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: cursorY + 6,
        head: [['#', 'Priority', 'Action', 'Owner']],
        body: f.remediationItems.map((r, i) => [
          i + 1,
          (r.priority || '').toUpperCase(),
          r.action,
          r.ownerRole || '—'
        ]),
        styles: { fontSize: 9, cellPadding: 4 },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 60 }, 3: { cellWidth: 110 } },
        headStyles: { fillColor: [99, 102, 241], textColor: 255 }
      });
    }
  }

  // ── Open MRA summary ────────────────────────────────────────────────────
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text('Open MRA Summary', margin, 60);

  if (Array.isArray(report.openMras) && report.openMras.length > 0) {
    autoTable(doc, {
      startY: 80,
      head: [['Category', 'Title', 'Severity', 'Exam Date', 'Agency', 'Target Date']],
      body: report.openMras.map(m => [
        m.category,
        m.title,
        (m.severity || '').toUpperCase(),
        m.exam_date ? new Date(m.exam_date).toLocaleDateString() : '—',
        m.examiner_agency || '—',
        m.target_date ? new Date(m.target_date).toLocaleDateString() : '—'
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 }
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('No open MRAs at time of report generation.', margin, 90);
  }

  // ── Appendix: Regulatory reference index ───────────────────────────────
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text('Appendix: Regulatory Reference Index', margin, 60);

  autoTable(doc, {
    startY: 80,
    head: [['Check', 'FFIEC Reference', 'CFR Reference']],
    body: REG_INDEX,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255 }
  });

  // Stamp footer on every page after all content is written.
  stampConfidentialityFooter(doc);
  return doc;
}

export function downloadReportPdf(report) {
  const doc = buildReportPdf(report);
  const filename = `ExamReadiness_Report_${report.runId || 'unsaved'}.pdf`;
  doc.save(filename);
}
