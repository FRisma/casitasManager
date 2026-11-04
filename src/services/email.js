/**
 * Canal email (GmailApp / MailApp).
 * En DEV redirige a destinos de prueba del propietario.
 * Copy diferenciada: tenant = informativo; owner = ops.
 */

var CM = CM || {};
CM.Email = (function () {
  var TENANT_BODY_ES =
    'Hola, les compartimos el detalle de los servicios correspondientes al período indicado de la propiedad de Barrio Natania XV.\n\n' +
    'Adjuntamos las facturas originales para que puedan consultar los consumos y los importes correspondientes.\n\n' +
    'Los servicios incluidos en este resumen fueron abonados por el propietario. Este mensaje es únicamente informativo.\n\n' +
    'Saludos.';

  var OWNER_INTRO_ES =
    'Resumen operativo de servicios (CasitasManager).\n\n' +
    'Este mensaje es para el propietario: incluye payment_status, vencimientos, totales y links. ' +
    'No usa el texto informativo de inquilinos.';

  function resolveRecipients_(contacts, purpose, options) {
    options = options || {};
    var emailsFrom = function (list) {
      return (list || [])
        .map(function (c) {
          return String(c.email || '').trim();
        })
        .filter(Boolean);
    };

    // Dual-test explícito: usar exactamente los contacts pasados (owners+tenants).
    if (options.forceAllContacts) {
      return emailsFrom(contacts);
    }

    var env = CM.Settings.getEnvironment();
    var dry = CM.Settings.isDryRun();
    var owners = CM.Sheets.getContacts(
      CM.ServiceCatalog.getPropertyDefaults().property_id,
      'owner'
    ).filter(function (c) {
      return c.email;
    });

    if (env === 'DEV' || dry) {
      // Nunca inquilinos reales en DEV / dry-run (salvo forceAllContacts arriba)
      return emailsFrom(owners);
    }

    if (purpose === 'tenant_report') {
      return emailsFrom(contacts);
    }

    return emailsFrom(contacts);
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s).replace(/[<>&]/g, '');
  }

  function amountLabel_(it) {
    if (it.amount === '' || it.amount == null) return '—';
    return it.amount + ' ' + (it.currency || 'ARS');
  }

  function buildItemsTableHtml_(report, includeDue) {
    var lines = [];
    lines.push('<table border="1" cellpadding="6" cellspacing="0">');
    lines.push(
      '<tr><th>Proveedor</th><th>Período</th><th>Importe</th><th>Estado pago</th>' +
        (includeDue ? '<th>Vencimiento</th>' : '') +
        '<th>Factura</th></tr>'
    );
    (report.items || []).forEach(function (it) {
      lines.push(
        '<tr><td>' +
          escapeHtml_(it.provider) +
          '</td><td>' +
          escapeHtml_(it.billing_period) +
          '</td><td>' +
          escapeHtml_(amountLabel_(it)) +
          '</td><td>' +
          escapeHtml_(it.payment_status) +
          '</td>' +
          (includeDue ? '<td>' + escapeHtml_(it.due_date || '—') + '</td>' : '') +
          '<td>' +
          (it.invoice_file_url
            ? '<a href="' + escapeHtml_(it.invoice_file_url) + '">PDF</a>'
            : 'sin PDF') +
          '</td></tr>'
      );
    });
    lines.push('</table>');
    return lines.join('\n');
  }

  function buildTenantReportHtml(report) {
    var lines = [];
    lines.push('<p>' + TENANT_BODY_ES.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>');
    lines.push('<p><strong>Período:</strong> ' + escapeHtml_(report.billingPeriod) + '</p>');
    lines.push('<p><strong>Propiedad:</strong> ' + escapeHtml_(report.propertyAddress) + '</p>');
    lines.push(buildItemsTableHtml_(report, false));
    if (report.total != null) {
      lines.push('<p><strong>Total servicios:</strong> ' + escapeHtml_(report.total) + ' ARS</p>');
    }
    return lines.join('\n');
  }

  /**
   * @param {object} report
   * @param {{tenantNotifyNote?: string}} [meta]
   */
  function buildOwnerReportHtml(report, meta) {
    meta = meta || {};
    var lines = [];
    lines.push('<p>' + OWNER_INTRO_ES.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>');
    lines.push('<p><strong>Período:</strong> ' + escapeHtml_(report.billingPeriod) + '</p>');
    lines.push('<p><strong>Propiedad:</strong> ' + escapeHtml_(report.propertyAddress) + '</p>');
    lines.push('<p><strong>Entorno:</strong> ' + escapeHtml_(report.environment) + '</p>');
    if (meta.tenantNotifyNote) {
      lines.push('<p><strong>Inquilinos:</strong> ' + escapeHtml_(meta.tenantNotifyNote) + '</p>');
    }
    if (report.spreadsheetUrl) {
      lines.push(
        '<p><strong>Sheet:</strong> <a href="' +
          escapeHtml_(report.spreadsheetUrl) +
          '">' +
          escapeHtml_(report.spreadsheetUrl) +
          '</a></p>'
      );
    }
    lines.push(buildItemsTableHtml_(report, true));
    if (report.total != null) {
      lines.push('<p><strong>Total servicios:</strong> ' + escapeHtml_(report.total) + ' ARS</p>');
    }
    return lines.join('\n');
  }

  function buildTenantReportText(report) {
    var lines = [TENANT_BODY_ES, '', 'Período: ' + report.billingPeriod, 'Propiedad: ' + report.propertyAddress, ''];
    (report.items || []).forEach(function (it) {
      lines.push(
        '• ' +
          it.provider +
          ': ' +
          amountLabel_(it) +
          ' — ' +
          it.payment_status +
          (it.invoice_file_url ? '\n  ' + it.invoice_file_url : '')
      );
    });
    if (report.total != null) lines.push('\nTotal: ' + report.total + ' ARS');
    return lines.join('\n');
  }

  /**
   * @param {object} report
   * @param {{tenantNotifyNote?: string}} [meta]
   */
  function buildOwnerReportText(report, meta) {
    meta = meta || {};
    var lines = [
      OWNER_INTRO_ES,
      '',
      'Período: ' + report.billingPeriod,
      'Propiedad: ' + report.propertyAddress,
      'Entorno: ' + report.environment,
    ];
    if (meta.tenantNotifyNote) lines.push('Inquilinos: ' + meta.tenantNotifyNote);
    if (report.spreadsheetUrl) lines.push('Sheet: ' + report.spreadsheetUrl);
    lines.push('');
    (report.items || []).forEach(function (it) {
      lines.push(
        '• ' +
          it.provider +
          ': ' +
          amountLabel_(it) +
          ' | payment_status=' +
          it.payment_status +
          ' | vence=' +
          (it.due_date || '—') +
          (it.invoice_file_url ? '\n  factura: ' + it.invoice_file_url : '\n  factura: (sin PDF)')
      );
    });
    if (report.total != null) lines.push('\nTotal: ' + report.total + ' ARS');
    return lines.join('\n');
  }

  /**
   * @returns {{ok, dryRun, to, subject, preview}}
   */
  function send(options) {
    options = options || {};
    var toList = resolveRecipients_(options.contacts, options.purpose, options);
    var subject = options.subject || 'CasitasManager';
    var body = options.body || '';
    var html = options.htmlBody || '';
    var attachments = options.attachments || [];
    var skipDryRun = !!(options.forceRealSend && options.forceAllContacts);

    var preview = {
      to: toList,
      subject: subject,
      body: body,
      htmlBody: html,
      attachmentCount: attachments.length,
      environment: CM.Settings.getEnvironment(),
      dryRun: CM.Settings.isDryRun() && !skipDryRun,
      forceAllContacts: !!options.forceAllContacts,
      forceRealSend: skipDryRun,
      purpose: options.purpose || '',
    };

    if (!toList.length) {
      CM.Logging.warn('email.send', 'Sin destinatarios email configurados', preview);
      return { ok: false, reason: 'no_recipients', preview: preview };
    }

    if (CM.Settings.isDryRun() && !skipDryRun) {
      CM.Logging.info('email.send', 'DRY_RUN — email no enviado', preview);
      return { ok: true, dryRun: true, to: toList, subject: subject, preview: preview };
    }

    try {
      if (typeof GmailApp !== 'undefined') {
        GmailApp.sendEmail(toList.join(','), subject, body, {
          htmlBody: html || undefined,
          attachments: attachments.length ? attachments : undefined,
          name: 'CasitasManager',
        });
      } else if (typeof MailApp !== 'undefined') {
        MailApp.sendEmail({
          to: toList.join(','),
          subject: subject,
          body: body,
          htmlBody: html || undefined,
          attachments: attachments.length ? attachments : undefined,
        });
      } else {
        return { ok: false, reason: 'no_mail_api', to: toList, subject: subject, preview: preview };
      }
      CM.Logging.ok('email.send', 'Email enviado a ' + toList.join(','), { subject: subject });
      return { ok: true, dryRun: false, to: toList, subject: subject, preview: preview };
    } catch (e) {
      CM.Logging.error('email.send', String(e), preview);
      return { ok: false, reason: String(e), preview: preview };
    }
  }

  return {
    TENANT_BODY_ES: TENANT_BODY_ES,
    OWNER_INTRO_ES: OWNER_INTRO_ES,
    resolveRecipients_: resolveRecipients_,
    buildTenantReportHtml: buildTenantReportHtml,
    buildOwnerReportHtml: buildOwnerReportHtml,
    buildTenantReportText: buildTenantReportText,
    buildOwnerReportText: buildOwnerReportText,
    send: send,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Email;
}
