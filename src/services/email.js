/**
 * Canal email (GmailApp / MailApp).
 * En DEV redirige a destinos de prueba del propietario.
 */

var CM = CM || {};
CM.Email = (function () {
  var TENANT_BODY_ES =
    'Hola, les compartimos el detalle de los servicios correspondientes al período indicado de la propiedad de Barrio Natania XV.\n\n' +
    'Adjuntamos las facturas originales para que puedan consultar los consumos y los importes correspondientes.\n\n' +
    'Los servicios incluidos en este resumen fueron abonados por el propietario. Este mensaje es únicamente informativo.\n\n' +
    'Saludos.';

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

  function buildTenantReportHtml(report) {
    var lines = [];
    lines.push('<p>' + TENANT_BODY_ES.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>');
    lines.push('<p><strong>Período:</strong> ' + report.billingPeriod + '</p>');
    lines.push('<p><strong>Propiedad:</strong> ' + report.propertyAddress + '</p>');
    lines.push('<table border="1" cellpadding="6" cellspacing="0">');
    lines.push(
      '<tr><th>Proveedor</th><th>Período</th><th>Importe</th><th>Estado pago</th><th>Factura</th></tr>'
    );
    (report.items || []).forEach(function (it) {
      lines.push(
        '<tr><td>' +
          it.provider +
          '</td><td>' +
          it.billing_period +
          '</td><td>' +
          (it.amount === '' || it.amount == null ? '—' : it.amount + ' ' + (it.currency || 'ARS')) +
          '</td><td>' +
          it.payment_status +
          '</td><td>' +
          (it.invoice_file_url
            ? '<a href="' + it.invoice_file_url + '">PDF</a>'
            : 'sin PDF') +
          '</td></tr>'
      );
    });
    lines.push('</table>');
    if (report.total != null) {
      lines.push('<p><strong>Total servicios:</strong> ' + report.total + ' ARS</p>');
    }
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
    resolveRecipients_: resolveRecipients_,
    buildTenantReportHtml: buildTenantReportHtml,
    send: send,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Email;
}
