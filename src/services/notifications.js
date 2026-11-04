/**
 * Notificaciones propietario + informe mensual inquilinos (email + Telegram).
 * Gate de aprobación explícita obligatorio para envío a inquilinos.
 * Copy diferenciada: tenant = informativo ES; owner = ops (status, vencimientos, links).
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

  function spreadsheetUrl_() {
    var id = CM.Settings.get(CM.Settings.KEYS.SPREADSHEET_ID, '');
    if (!id) return '';
    return 'https://docs.google.com/spreadsheets/d/' + id;
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
        due_date: inv.due_date || '',
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
      spreadsheetUrl: spreadsheetUrl_(),
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

  function tenantNotifyNoteForSend_(mode) {
    // mode: 'prod_send' | 'dev_send' | 'dual_test'
    if (mode === 'dual_test') {
      return 'También se notifica a inquilinos configurados (copia informativa distinta).';
    }
    if (mode === 'prod_send') {
      return 'Los inquilinos configurados reciben/recibieron el aviso informativo (texto distinto al de ops).';
    }
    return 'DEV/dry-run: no se notifica a inquilinos reales; en PROD recibirían aviso informativo tras aprobación.';
  }

  function buildRolePayloads_(report, mode) {
    var ownerMeta = { tenantNotifyNote: tenantNotifyNoteForSend_(mode) };
    return {
      tenant: {
        subject: 'Servicios ' + report.billingPeriod + ' — Natania XV (informativo)',
        textBody: CM.Email.buildTenantReportText(report),
        htmlBody: CM.Email.buildTenantReportHtml(report),
        tgText: CM.Telegram.formatTenantReportText(report),
      },
      owner: {
        subject: '[CasitasManager OPS] Servicios ' + report.billingPeriod + ' — Natania XV',
        textBody: CM.Email.buildOwnerReportText(report, ownerMeta),
        htmlBody: CM.Email.buildOwnerReportHtml(report, ownerMeta),
        tgText: CM.Telegram.formatOwnerReportText(report, ownerMeta),
      },
    };
  }

  function collectAttachments_(report) {
    var attachments = [];
    if (typeof DriveApp === 'undefined') return attachments;
    (report.items || []).forEach(function (it) {
      if (it.invoice_file_id) {
        try {
          attachments.push(DriveApp.getFileById(it.invoice_file_id).getBlob());
        } catch (e) {
          CM.Logging.warn('notifications.attachments', 'No se pudo adjuntar ' + it.invoice_file_id, String(e));
        }
      }
    });
    return attachments;
  }

  /**
   * Envía email+Telegram a un set de contacts con un payload de rol.
   */
  function sendRoleBundle_(contacts, purpose, payload, attachments, sendFlags) {
    sendFlags = sendFlags || {};
    var opts = {
      contacts: contacts,
      purpose: purpose,
    };
    if (sendFlags.forceAllContacts) opts.forceAllContacts = true;
    if (sendFlags.forceRealSend) opts.forceRealSend = true;

    var emailResult = CM.Email.send(
      Object.assign({}, opts, {
        subject: payload.subject,
        body: payload.textBody,
        htmlBody: payload.htmlBody,
        attachments: attachments || [],
      })
    );
    var tgResult = CM.Telegram.sendMessage(
      Object.assign({}, opts, {
        text: payload.tgText,
      })
    );

    var docResults = [];
    if (
      sendFlags.sendDocuments &&
      !CM.Settings.isDryRun() &&
      attachments &&
      attachments.length &&
      CM.Telegram.isConfigured()
    ) {
      attachments.forEach(function (blob) {
        docResults.push(
          CM.Telegram.sendDocument(
            Object.assign({}, opts, {
              blob: blob,
              caption: payload.subject,
            })
          )
        );
      });
    }

    return { email: emailResult, telegram: tgResult, documents: docResults };
  }

  function previewMonthlyReport(period) {
    var report = generateMonthlyReport(period);
    var payloads = buildRolePayloads_(report, CM.Settings.isDev() || CM.Settings.isDryRun() ? 'dev_send' : 'prod_send');
    var ownerOnly = CM.Settings.isDev() || CM.Settings.isDryRun();
    return {
      report: report,
      emailPreview: {
        subject: payloads.tenant.subject,
        htmlBody: payloads.tenant.htmlBody,
        textBody: payloads.tenant.textBody,
        recipientsWouldBe: ownerOnly
          ? 'OWNER test only (DEV/dry-run) — owner ops copy on send'
          : tenantContacts_()
              .map(function (c) {
                return c.email;
              })
              .filter(Boolean),
      },
      ownerEmailPreview: {
        subject: payloads.owner.subject,
        htmlBody: payloads.owner.htmlBody,
        textBody: payloads.owner.textBody,
      },
      telegramPreview: {
        text: payloads.tenant.tgText,
        recipientsWouldBe: ownerOnly
          ? 'OWNER test only (DEV/dry-run) — owner ops copy on send'
          : tenantContacts_()
              .map(function (c) {
                return c.telegram;
              })
              .filter(Boolean),
      },
      ownerTelegramPreview: {
        text: payloads.owner.tgText,
      },
      copyNote:
        'Tenant = informativo ES; Owner = ops (payment_status, vencimientos, totales, Sheet/PDF). No comparten el mismo cuerpo.',
    };
  }

  /**
   * Envía informe mensual SOLO si hay aprobación explícita del período.
   * En DEV siempre a destinos owner (copy ops).
   * En PROD: tenants → copy informativa; owners → copy ops.
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
    var isProdLive = CM.Settings.isProd() && !CM.Settings.isDryRun();
    var mode = isProdLive ? 'prod_send' : 'dev_send';
    var payloads = buildRolePayloads_(report, mode);
    var attachments = collectAttachments_(report);

    var owners = ownerContacts_();
    var tenants = isProdLive ? tenantContacts_() : [];

    var ownerSend = sendRoleBundle_(owners, 'owner_report', payloads.owner, attachments, {
      sendDocuments: true,
    });
    var tenantSend = null;
    if (tenants.length) {
      tenantSend = sendRoleBundle_(tenants, 'tenant_report', payloads.tenant, attachments, {
        sendDocuments: true,
      });
    }

    var emailOk = !!(ownerSend.email && ownerSend.email.ok) || !!(tenantSend && tenantSend.email && tenantSend.email.ok);
    var tgOk =
      !!(ownerSend.telegram && ownerSend.telegram.ok) ||
      !!(tenantSend && tenantSend.telegram && tenantSend.telegram.ok);

    CM.Logging.ok('sendMonthlyReport', 'Envío procesado ' + period, {
      email: emailOk,
      telegram: tgOk,
      dryRun: CM.Settings.isDryRun(),
      ownerOnly: !isProdLive,
      differentiatedCopy: true,
    });

    return {
      ok: !!(emailOk || tgOk),
      period: period,
      email: ownerSend.email,
      telegram: ownerSend.telegram,
      owner: ownerSend,
      tenant: tenantSend,
      preview: preview,
      differentiatedCopy: true,
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

  var TEST_CONFIRM = 'YES_SEND_TO_TENANTS';

  function isTestTenantSendAllowed_(forceConfirm) {
    var prop = String(CM.Settings.get(CM.Settings.KEYS.ALLOW_TEST_TENANT_SEND, '') || '')
      .trim()
      .toLowerCase();
    if (prop === 'yes') return { ok: true, via: 'script_property' };
    if (String(forceConfirm || '') === TEST_CONFIRM) return { ok: true, via: 'forceConfirm' };
    return {
      ok: false,
      message:
        'Dual-test bloqueado. Setear Script Property ALLOW_TEST_TENANT_SEND=yes ' +
        'o pasar forceConfirm "' +
        TEST_CONFIRM +
        '". Luego clearAllowTestTenantSend(). ' +
        'sendMonthlyReport en DEV sigue yendo solo a owners.',
    };
  }

  function isActiveContact_(c) {
    return String(c.active).toLowerCase() !== 'false' && c.active !== false;
  }

  function roleOf_(c) {
    return String(c.role || '')
      .trim()
      .toLowerCase();
  }

  function prefixPayload_(tag, roleLabel, payload) {
    return {
      subject: '[TEST ' + tag + ' ' + roleLabel + '] ' + payload.subject,
      textBody: '[TEST CasitasManager — ' + roleLabel + ']\n\n' + payload.textBody,
      htmlBody: payload.htmlBody,
      tgText: '[TEST ' + tag + ' ' + roleLabel + ']\n\n' + payload.tgText,
    };
  }

  function emptyRoleSend_() {
    return {
      email: { ok: false, reason: 'no_contacts', to: [] },
      telegram: { ok: false, chats: [] },
    };
  }

  function summarizeRoleTargets_(contacts) {
    return {
      emailTargets: contacts
        .filter(function (c) {
          return c.email;
        })
        .map(function (c) {
          return { role: c.role, name: c.name, email: String(c.email).trim() };
        }),
      telegramTargets: contacts
        .filter(function (c) {
          return c.telegram;
        })
        .map(function (c) {
          return { role: c.role, name: c.name, telegram: String(c.telegram).trim() };
        }),
    };
  }

  /**
   * Test explícito: email + Telegram a TODOS los Contacts activos (owners + tenants).
   * Cada rol recibe su copy (owner=ops, tenant=informativo).
   * No cambia el routing de sendMonthlyReport.
   * Requiere ALLOW_TEST_TENANT_SEND=yes O forceConfirm === YES_SEND_TO_TENANTS.
   */
  function sendTestNotifyAllConfiguredContacts(period, forceConfirm) {
    var gate = isTestTenantSendAllowed_(forceConfirm);
    if (!gate.ok) {
      CM.Logging.warn('sendTestNotifyAllConfiguredContacts', gate.message);
      return { ok: false, reason: 'confirmation_required', message: gate.message };
    }

    period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var report = generateMonthlyReport(period);
    var payloads = buildRolePayloads_(report, 'dual_test');
    var propertyId = propertyId_();
    var recipients = CM.Sheets.getContacts(propertyId).filter(isActiveContact_);
    var owners = recipients.filter(function (c) {
      return roleOf_(c) === 'owner';
    });
    var tenants = recipients.filter(function (c) {
      return roleOf_(c) === 'tenant';
    });

    var targets = summarizeRoleTargets_(recipients);
    var loud = {
      WARNING: 'REAL dual-test send to owners+tenants (role-differentiated copy)',
      period: period,
      gate: gate.via,
      environment: CM.Settings.getEnvironment(),
      globalDryRun: CM.Settings.isDryRun(),
      emailTargets: targets.emailTargets,
      telegramTargets: targets.telegramTargets,
      itemCount: (report.items || []).length,
      ownerCopySubject: payloads.owner.subject,
      tenantCopySubject: payloads.tenant.subject,
      copyDifferentiated: true,
    };
    var loudJson = JSON.stringify(loud, null, 2);
    if (typeof Logger !== 'undefined') Logger.log(loudJson);
    if (typeof console !== 'undefined') console.log(loudJson);
    CM.Logging.warn('sendTestNotifyAllConfiguredContacts', 'Enviando a owners+tenants (copy por rol)', loud);

    if (!targets.emailTargets.length && !targets.telegramTargets.length) {
      return {
        ok: false,
        reason: 'no_recipients',
        message: 'Contacts sin email/telegram. Completar hoja Contacts.',
        loud: loud,
      };
    }

    var sendFlags = { forceAllContacts: true, forceRealSend: true, sendDocuments: false };
    var ownerPrefix = prefixPayload_('dual', 'OWNER ops', payloads.owner);
    var tenantPrefix = prefixPayload_('dual', 'TENANT informativo', payloads.tenant);

    var ownerSend = owners.length
      ? sendRoleBundle_(owners, 'test_dual_notify_owner', ownerPrefix, [], sendFlags)
      : emptyRoleSend_();
    var tenantSend = tenants.length
      ? sendRoleBundle_(tenants, 'test_dual_notify_tenant', tenantPrefix, [], sendFlags)
      : emptyRoleSend_();

    return finalizeRoleTest_(
      'sendTestNotifyAllConfiguredContacts',
      'dual',
      period,
      gate.via,
      ownerSend,
      tenantSend,
      ownerPrefix,
      tenantPrefix,
      loud
    );
  }

  /**
   * Test REAL solo a owners (copy ops). Sin gate YES — soft confirm vive en el menú.
   * No toca tenants. forceRealSend bypass dry-run (mismo patrón que dual-test).
   */
  function sendTestNotifyOwnersOnly(period) {
    period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var report = generateMonthlyReport(period);
    var payloads = buildRolePayloads_(report, 'dual_test');
    var owners = ownerContacts_().filter(isActiveContact_);
    var targets = summarizeRoleTargets_(owners);
    var loud = {
      WARNING: 'REAL owner-only test send (ops copy) — tenants NOT notified',
      period: period,
      roles: ['owner'],
      environment: CM.Settings.getEnvironment(),
      globalDryRun: CM.Settings.isDryRun(),
      emailTargets: targets.emailTargets,
      telegramTargets: targets.telegramTargets,
      itemCount: (report.items || []).length,
      ownerCopySubject: payloads.owner.subject,
      copyDifferentiated: true,
    };
    logLoud_(loud);
    CM.Logging.warn('sendTestNotifyOwnersOnly', 'Enviando solo a owners (copy ops)', loud);

    if (!targets.emailTargets.length && !targets.telegramTargets.length) {
      return {
        ok: false,
        reason: 'no_recipients',
        message: 'Contacts owner sin email/telegram. Completar hoja Contacts.',
        loud: loud,
      };
    }

    var sendFlags = { forceAllContacts: true, forceRealSend: true, sendDocuments: false };
    var ownerPrefix = prefixPayload_('owner-only', 'OWNER ops', payloads.owner);
    var ownerSend = sendRoleBundle_(owners, 'test_owner_only', ownerPrefix, [], sendFlags);
    return finalizeRoleTest_(
      'sendTestNotifyOwnersOnly',
      'owner-only',
      period,
      'owner_only_no_tenant_gate',
      ownerSend,
      null,
      ownerPrefix,
      null,
      loud
    );
  }

  /**
   * Test REAL solo a tenants (copy informativa).
   * Gate: ALLOW_TEST_TENANT_SEND=yes O forceConfirm === YES_SEND_TO_TENANTS.
   * No toca owners.
   */
  function sendTestNotifyTenantsOnly(period, forceConfirm) {
    var gate = isTestTenantSendAllowed_(forceConfirm);
    if (!gate.ok) {
      var tenantMsg =
        'Envío tenant bloqueado. Soft confirm en menú Sheet, o setAllowTestTenantSend(true), ' +
        'o pasar forceConfirm "' +
        TEST_CONFIRM +
        '". Luego clearAllowTestTenantSend().';
      CM.Logging.warn('sendTestNotifyTenantsOnly', tenantMsg);
      return { ok: false, reason: 'confirmation_required', message: tenantMsg };
    }

    period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var report = generateMonthlyReport(period);
    var payloads = buildRolePayloads_(report, 'dual_test');
    var tenants = tenantContacts_().filter(isActiveContact_);
    var targets = summarizeRoleTargets_(tenants);
    var loud = {
      WARNING: 'REAL tenant-only test send (informativo) — owners NOT notified',
      period: period,
      gate: gate.via,
      roles: ['tenant'],
      environment: CM.Settings.getEnvironment(),
      globalDryRun: CM.Settings.isDryRun(),
      emailTargets: targets.emailTargets,
      telegramTargets: targets.telegramTargets,
      itemCount: (report.items || []).length,
      tenantCopySubject: payloads.tenant.subject,
      copyDifferentiated: true,
    };
    logLoud_(loud);
    CM.Logging.warn('sendTestNotifyTenantsOnly', 'Enviando solo a tenants (copy informativa)', loud);

    if (!targets.emailTargets.length && !targets.telegramTargets.length) {
      return {
        ok: false,
        reason: 'no_recipients',
        message: 'Contacts tenant sin email/telegram. Completar hoja Contacts.',
        loud: loud,
      };
    }

    var sendFlags = { forceAllContacts: true, forceRealSend: true, sendDocuments: false };
    var tenantPrefix = prefixPayload_('tenant-only', 'TENANT informativo', payloads.tenant);
    var tenantSend = sendRoleBundle_(tenants, 'test_tenant_only', tenantPrefix, [], sendFlags);
    return finalizeRoleTest_(
      'sendTestNotifyTenantsOnly',
      'tenant-only',
      period,
      gate.via,
      null,
      tenantSend,
      null,
      tenantPrefix,
      loud
    );
  }

  function logLoud_(loud) {
    var loudJson = JSON.stringify(loud, null, 2);
    if (typeof Logger !== 'undefined') Logger.log(loudJson);
    if (typeof console !== 'undefined') console.log(loudJson);
  }

  function finalizeRoleTest_(
    logName,
    mode,
    period,
    gateVia,
    ownerSend,
    tenantSend,
    ownerPrefix,
    tenantPrefix,
    loud
  ) {
    ownerSend = ownerSend || emptyRoleSend_();
    tenantSend = tenantSend || emptyRoleSend_();

    var emailTo = []
      .concat((ownerSend.email && ownerSend.email.to) || [])
      .concat((tenantSend.email && tenantSend.email.to) || []);
    var tgChats = []
      .concat((ownerSend.telegram && ownerSend.telegram.chats) || [])
      .concat((tenantSend.telegram && tenantSend.telegram.chats) || []);

    var emailOk = !!(ownerSend.email && ownerSend.email.ok) || !!(tenantSend.email && tenantSend.email.ok);
    var tgOk =
      !!(ownerSend.telegram && ownerSend.telegram.ok) || !!(tenantSend.telegram && tenantSend.telegram.ok);

    var out = {
      ok: !!(emailOk || tgOk),
      period: period,
      mode: mode,
      gate: gateVia,
      email: {
        ok: emailOk,
        to: emailTo,
        owner: ownerSend.email,
        tenant: tenantSend.email,
      },
      telegram: {
        ok: tgOk,
        chats: tgChats,
        owner: ownerSend.telegram,
        tenant: tenantSend.telegram,
      },
      owner: ownerSend,
      tenant: tenantSend,
      loud: loud,
      differentiatedCopy: true,
      reminder:
        mode === 'dual' || mode.indexOf('tenant') >= 0
          ? 'Después del test: clearAllowTestTenantSend() o borrar Script Property ALLOW_TEST_TENANT_SEND'
          : null,
    };
    var outJson = JSON.stringify(
      {
        ok: out.ok,
        mode: mode,
        period: out.period,
        emailTo: emailTo,
        telegramChats: tgChats,
        ownerSubject: ownerPrefix && ownerPrefix.subject,
        tenantSubject: tenantPrefix && tenantPrefix.subject,
        differentiatedCopy: true,
        reminder: out.reminder,
      },
      null,
      2
    );
    if (typeof Logger !== 'undefined') Logger.log(outJson);
    if (typeof console !== 'undefined') console.log(outJson);
    CM.Logging.ok(logName, 'Test ' + mode + ' procesado (copy por rol)', {
      email: emailOk,
      telegram: tgOk,
    });
    return out;
  }

  return {
    notifyOwnerEvent: notifyOwnerEvent,
    notifyNewInvoice: notifyNewInvoice,
    notifyPortalIssue: notifyPortalIssue,
    generateMonthlyReport: generateMonthlyReport,
    previewMonthlyReport: previewMonthlyReport,
    sendMonthlyReport: sendMonthlyReport,
    sendPendingPaymentReminders: sendPendingPaymentReminders,
    sendTestNotifyAllConfiguredContacts: sendTestNotifyAllConfiguredContacts,
    sendTestNotifyOwnersOnly: sendTestNotifyOwnersOnly,
    sendTestNotifyTenantsOnly: sendTestNotifyTenantsOnly,
    TEST_CONFIRM: TEST_CONFIRM,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Notifications;
}
