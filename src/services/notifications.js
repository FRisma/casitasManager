/**
 * Notificaciones propietario + informe mensual inquilinos (email + Telegram).
 * Gate de aprobación explícita obligatorio para envío a inquilinos.
 */

var CM = CM || {};
CM.Notifications = (function () {
  function propertyId_() {
    return CM.ServiceCatalog.getPropertyDefaults().property_id;
  }

  function ownerContacts_() {
    return CM.Sheets.getContacts(propertyId_(), 'owner');
  }

  function tenantContacts_() {
    return CM.Sheets.getContacts(propertyId_(), 'tenant');
  }

  function alreadyNotified_(invoice) {
    return !!(invoice && invoice.notification_sent_at);
  }

  function markNotified_(invoice) {
    if (!invoice || !invoice.__row) return;
    var updated = Object.assign({}, invoice, { notification_sent_at: CM.Logging.nowTs() });
    delete updated.__row;
    CM.Sheets.updateRow(CM.Sheets.SHEET_NAMES.INVOICES, invoice.__row, updated);
  }

  function notifyOwnerEvent(kind, payload) {
    var subject = '[CasitasManager] ' + kind;
    var lines = [
      'Evento: ' + kind,
      'Propiedad: ' + CM.ServiceCatalog.getPropertyDefaults().property_name,
      'Entorno: ' + CM.Settings.getEnvironment(),
      '',
    ];
    Object.keys(payload || {}).forEach(function (k) {
      lines.push(k + ': ' + payload[k]);
    });
    var text = lines.join('\n');
    var contacts = ownerContacts_();

    var emailResult = CM.Email.send({
      contacts: contacts,
      purpose: 'owner',
      subject: subject,
      body: text,
      htmlBody: '<pre>' + text.replace(/[<>&]/g, '') + '</pre>',
    });
    var tgResult = CM.Telegram.sendMessage({
      contacts: contacts,
      purpose: 'owner',
      text: text,
    });
    return { email: emailResult, telegram: tgResult };
  }

  function notifyNewInvoice(invoice) {
    if (alreadyNotified_(invoice)) {
      return { skipped: true, reason: 'already_notified' };
    }
    var result = notifyOwnerEvent('Nueva factura detectada', {
      provider: invoice.provider,
      billing_period: invoice.billing_period,
      amount: invoice.amount,
      due_date: invoice.due_date,
      payment_status: invoice.payment_status,
      invoice_id: invoice.invoice_id,
      invoice_url: invoice.invoice_file_url || '(sin PDF)',
    });
    if ((result.email && result.email.ok) || (result.telegram && result.telegram.ok)) {
      markNotified_(invoice);
    }
    return result;
  }

  function notifyPortalIssue(provider, message, details) {
    return notifyOwnerEvent('Portal / ejecución', {
      provider: provider,
      message: message,
      details: typeof details === 'object' ? JSON.stringify(details) : details || '',
    });
  }

  /**
   * Genera el informe mensual sin enviar.
   */
  function generateMonthlyReport(period) {
    period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var prop = CM.ServiceCatalog.getPropertyDefaults();
    var invoices = CM.Invoices.listForPeriod(period);
    var items = invoices.map(function (inv) {
      return {
        provider: inv.provider,
        service_id: inv.service_id,
        billing_period: inv.billing_period,
        amount: inv.amount,
        currency: inv.currency || 'ARS',
        payment_status: inv.payment_status,
        invoice_file_url: inv.invoice_file_url,
        invoice_file_id: inv.invoice_file_id,
        invoice_id: inv.invoice_id,
      };
    });
    var total = 0;
    var hasAmount = false;
    items.forEach(function (it) {
      if (it.amount !== '' && it.amount != null && !isNaN(Number(it.amount))) {
        total += Number(it.amount);
        hasAmount = true;
      }
    });
    var report = {
      billingPeriod: period,
      propertyId: prop.property_id,
      propertyName: prop.property_name,
      propertyAddress: prop.address + ', ' + prop.city + ', ' + prop.province,
      generatedAt: CM.Logging.nowTs(),
      environment: CM.Settings.getEnvironment(),
      dryRun: CM.Settings.isDryRun(),
      items: items,
      total: hasAmount ? Math.round(total * 100) / 100 : null,
      approvalPeriod: CM.Settings.getMonthlyApprovalPeriod(),
      approved: CM.Settings.getMonthlyApprovalPeriod() === period,
    };

    try {
      if (typeof DriveApp !== 'undefined') {
        report.driveSave = CM.Drive.saveReportJson(period, report);
      }
    } catch (e) {
      report.driveSaveError = String(e);
    }

    CM.Logging.ok('generateMonthlyReport', 'Informe generado ' + period, {
      items: items.length,
      total: report.total,
    });
    return report;
  }

  function previewMonthlyReport(period) {
    var report = generateMonthlyReport(period);
    var html = CM.Email.buildTenantReportHtml(report);
    var tgText = CM.Telegram.formatReportText(report);
    var ownerOnly = CM.Settings.isDev() || CM.Settings.isDryRun();
    return {
      report: report,
      emailPreview: {
        subject: 'Servicios ' + report.billingPeriod + ' — Natania XV (informativo)',
        htmlBody: html,
        textBody: CM.Email.TENANT_BODY_ES,
        recipientsWouldBe: ownerOnly
          ? 'OWNER test only (DEV/dry-run)'
          : tenantContacts_()
              .map(function (c) {
                return c.email;
              })
              .filter(Boolean),
      },
      telegramPreview: {
        text: tgText,
        recipientsWouldBe: ownerOnly
          ? 'OWNER test only (DEV/dry-run)'
          : tenantContacts_()
              .map(function (c) {
                return c.telegram;
              })
              .filter(Boolean),
      },
    };
  }

  /**
   * Envía informe mensual SOLO si hay aprobación explícita del período.
   * En DEV siempre a destinos owner.
   */
  function sendMonthlyReport(period, options) {
    options = options || {};
    period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var approved = CM.Settings.getMonthlyApprovalPeriod();
    if (approved !== period && !options.forceApprovalBypass) {
      CM.Logging.warn('sendMonthlyReport', 'Bloqueado: sin aprobación owner para ' + period, {
        approved: approved,
      });
      return {
        ok: false,
        reason: 'approval_required',
        message:
          'El propietario debe aprobar el período (approveMonthlyReport("' +
          period +
          '") o /approve_report ' +
          period +
          ') antes del envío.',
      };
    }
    // forceApprovalBypass solo para tests internos — jamás en PROD entrypoints
    if (options.forceApprovalBypass && CM.Settings.isProd()) {
      throw new Error('forceApprovalBypass prohibido en PROD');
    }

    var preview = previewMonthlyReport(period);
    var report = preview.report;

    // Destinatarios: en PROD (no dry-run) → tenants + owners; en DEV → solo owners (email/telegram layers)
    var recipients = CM.Settings.isProd() && !CM.Settings.isDryRun()
      ? tenantContacts_().concat(ownerContacts_())
      : ownerContacts_();

    var attachments = [];
    if (typeof DriveApp !== 'undefined') {
      report.items.forEach(function (it) {
        if (it.invoice_file_id) {
          try {
            attachments.push(DriveApp.getFileById(it.invoice_file_id).getBlob());
          } catch (e) {
            CM.Logging.warn('sendMonthlyReport', 'No se pudo adjuntar ' + it.invoice_file_id, String(e));
          }
        }
      });
    }

    var emailResult = CM.Email.send({
      contacts: recipients,
      purpose: 'tenant_report',
      subject: preview.emailPreview.subject,
      body: preview.emailPreview.textBody + '\n\n' + CM.Telegram.formatReportText(report),
      htmlBody: preview.emailPreview.htmlBody,
      attachments: attachments,
    });

    var tgResult = CM.Telegram.sendMessage({
      contacts: recipients,
      purpose: 'tenant_report',
      text: preview.telegramPreview.text,
    });

    // Intentar PDFs por Telegram (best-effort)
    if (!CM.Settings.isDryRun() && attachments.length && CM.Telegram.isConfigured()) {
      attachments.forEach(function (blob) {
        CM.Telegram.sendDocument({
          contacts: recipients,
          purpose: 'tenant_report',
          blob: blob,
          caption: 'Factura ' + report.billingPeriod,
        });
      });
    }

    CM.Logging.ok('sendMonthlyReport', 'Envío procesado ' + period, {
      email: emailResult.ok,
      telegram: tgResult.ok,
      dryRun: CM.Settings.isDryRun(),
    });

    return {
      ok: !!(emailResult.ok || tgResult.ok),
      period: period,
      email: emailResult,
      telegram: tgResult,
      preview: preview,
    };
  }

  function sendPendingPaymentReminders() {
    var pending = CM.Invoices.listPendingPayment();
    var results = [];
    pending.forEach(function (inv) {
      var days = CM.Dates.daysUntil(inv.due_date);
      if (days == null) return;
      // Recordar si vencida o ≤ 5 días
      if (days <= 5) {
        results.push(
          notifyOwnerEvent('Recordatorio de pago', {
            provider: inv.provider,
            invoice_id: inv.invoice_id,
            amount: inv.amount,
            due_date: inv.due_date,
            days_until_due: days,
            payment_status: inv.payment_status,
          })
        );
      }
    });
    return { count: results.length, results: results };
  }

  return {
    notifyOwnerEvent: notifyOwnerEvent,
    notifyNewInvoice: notifyNewInvoice,
    notifyPortalIssue: notifyPortalIssue,
    generateMonthlyReport: generateMonthlyReport,
    previewMonthlyReport: previewMonthlyReport,
    sendMonthlyReport: sendMonthlyReport,
    sendPendingPaymentReminders: sendPendingPaymentReminders,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Notifications;
}
