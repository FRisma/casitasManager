/**
 * Canal Telegram via Bot API (UrlFetchApp).
 * MVP: notificaciones salientes + hooks de operación del propietario.
 * Fuera de MVP: bot de consulta de facturas para inquilinos.
 */

var CM = CM || {};
CM.Telegram = (function () {
  var API = 'https://api.telegram.org';

  function getToken_() {
    return CM.Settings.get(CM.Settings.KEYS.TELEGRAM_BOT_TOKEN, '');
  }

  function isConfigured() {
    return !!getToken_();
  }

  function resolveChatIds_(contacts, purpose, options) {
    options = options || {};
    var chatsFrom = function (list) {
      return (list || [])
        .map(function (c) {
          return String(c.telegram || '').trim();
        })
        .filter(Boolean);
    };

    if (options.forceAllContacts) {
      return chatsFrom(contacts);
    }

    var env = CM.Settings.getEnvironment();
    var dry = CM.Settings.isDryRun();
    var owners = CM.Sheets.getContacts(
      CM.ServiceCatalog.getPropertyDefaults().property_id,
      'owner'
    ).filter(function (c) {
      return c.telegram;
    });

    if (env === 'DEV' || dry) {
      return chatsFrom(owners);
    }

    return chatsFrom(contacts);
  }

  function apiCall_(method, payload) {
    var token = getToken_();
    if (!token) return { ok: false, reason: 'token_missing' };
    var url = API + '/bot' + token + '/' + method;
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    var parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      parsed = { raw: body };
    }
    return { ok: code >= 200 && code < 300 && parsed && parsed.ok !== false, code: code, body: parsed };
  }

  /**
   * Envía texto. En dry-run no llama a la API.
   */
  function sendMessage(options) {
    options = options || {};
    var chats = resolveChatIds_(options.contacts, options.purpose, options);
    var text = options.text || '';
    var skipDryRun = !!(options.forceRealSend && options.forceAllContacts);
    var preview = {
      chats: chats,
      text: text,
      environment: CM.Settings.getEnvironment(),
      dryRun: CM.Settings.isDryRun() && !skipDryRun,
      forceAllContacts: !!options.forceAllContacts,
      forceRealSend: skipDryRun,
      configured: isConfigured(),
    };

    if (!isConfigured()) {
      CM.Logging.warn('telegram.send', 'TELEGRAM_BOT_TOKEN no configurado', preview);
      return { ok: false, reason: 'not_configured', preview: preview };
    }
    if (!chats.length) {
      CM.Logging.warn('telegram.send', 'Sin chat_id telegram en contactos', preview);
      return { ok: false, reason: 'no_recipients', preview: preview };
    }
    if (CM.Settings.isDryRun() && !skipDryRun) {
      CM.Logging.info('telegram.send', 'DRY_RUN — telegram no enviado', preview);
      return { ok: true, dryRun: true, chats: chats, preview: preview };
    }

    var results = [];
    chats.forEach(function (chatId) {
      results.push(apiCall_('sendMessage', { chat_id: chatId, text: text, disable_web_page_preview: false }));
    });
    var allOk = results.every(function (r) {
      return r.ok;
    });
    return { ok: allOk, dryRun: false, chats: chats, results: results, preview: preview };
  }

  /**
   * Envía documento (PDF) si hay file blob/url.
   * Telegram Bot API sendDocument requiere multipart; con UrlFetchApp usamos blob.
   */
  function sendDocument(options) {
    options = options || {};
    var chats = resolveChatIds_(options.contacts, options.purpose, options);
    var skipDryRun = !!(options.forceRealSend && options.forceAllContacts);
    var preview = {
      chats: chats,
      caption: options.caption || '',
      dryRun: CM.Settings.isDryRun() && !skipDryRun,
      forceAllContacts: !!options.forceAllContacts,
      configured: isConfigured(),
    };
    if (!isConfigured()) return { ok: false, reason: 'not_configured', preview: preview };
    if (!chats.length) return { ok: false, reason: 'no_recipients', preview: preview };
    if (CM.Settings.isDryRun() && !skipDryRun) {
      CM.Logging.info('telegram.sendDocument', 'DRY_RUN', preview);
      return { ok: true, dryRun: true, preview: preview };
    }
    if (!options.blob) return { ok: false, reason: 'no_blob', preview: preview };

    var token = getToken_();
    var results = [];
    chats.forEach(function (chatId) {
      var url = API + '/bot' + token + '/sendDocument';
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        payload: {
          chat_id: String(chatId),
          caption: options.caption || '',
          document: options.blob,
        },
        muteHttpExceptions: true,
      });
      results.push({ code: res.getResponseCode(), body: res.getContentText() });
    });
    return { ok: true, results: results, preview: preview };
  }

  /**
   * Formatea resumen de montos + links PDF para Telegram.
   */
  function formatReportText(report) {
    var lines = [];
    lines.push('CasitasManager — ' + report.billingPeriod);
    lines.push(report.propertyAddress || '');
    lines.push('');
    lines.push(
      'Los servicios fueron abonados por el propietario. Mensaje informativo.'
    );
    lines.push('');
    (report.items || []).forEach(function (it) {
      lines.push(
        '• ' +
          it.provider +
          ': ' +
          (it.amount === '' || it.amount == null ? 's/d' : it.amount + ' ARS') +
          ' (' +
          it.payment_status +
          ')' +
          (it.invoice_file_url ? '\n  ' + it.invoice_file_url : '')
      );
    });
    if (report.total != null) lines.push('\nTotal: ' + report.total + ' ARS');
    return lines.join('\n');
  }

  /**
   * Operación propietario vía Telegram (stubs documentados).
   * Comandos previstos (no query-bot de inquilinos):
   *  /approve_report YYYY-MM
   *  /status
   *  /run_check
   * Requiere webhook o polling futuro; MVP expone handlers invocables.
   */
  function handleOwnerCommand(command, args) {
    var cmd = String(command || '')
      .replace(/^\//, '')
      .toLowerCase();
    if (cmd === 'approve_report') {
      var period = CM.Dates.normalizeBillingPeriod(args && args[0]);
      if (!period) return { ok: false, message: 'Uso: /approve_report YYYY-MM' };
      CM.Settings.setMonthlyApprovalPeriod(period);
      CM.Logging.ok('telegram.owner', 'Aprobación mensual ' + period);
      return { ok: true, message: 'Informe ' + period + ' aprobado para envío.' };
    }
    if (cmd === 'status') {
      return {
        ok: true,
        message:
          'ENV=' +
          CM.Settings.getEnvironment() +
          ' dryRun=' +
          CM.Settings.isDryRun() +
          ' approval=' +
          (CM.Settings.getMonthlyApprovalPeriod() || '(ninguna)'),
      };
    }
    if (cmd === 'run_check') {
      if (typeof runDailyCheck === 'function') {
        var result = runDailyCheck();
        return { ok: true, message: 'runDailyCheck ejecutado', result: result };
      }
      return { ok: false, message: 'runDailyCheck no disponible' };
    }
    return {
      ok: false,
      message: 'Comando no soportado en MVP. Disponibles: approve_report, status, run_check',
    };
  }

  return {
    isConfigured: isConfigured,
    sendMessage: sendMessage,
    sendDocument: sendDocument,
    formatReportText: formatReportText,
    handleOwnerCommand: handleOwnerCommand,
    resolveChatIds_: resolveChatIds_,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Telegram;
}
