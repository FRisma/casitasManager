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
   * options.replyMarkup → InlineKeyboardMarkup / ReplyKeyboardMarkup (Bot API).
   * options.forceChatIds → lista de chat_id (bypass resolución Contacts; p.ej. respuesta a un update).
   * options.skipDryRun → envía de verdad (respuestas del bot ops al owner).
   */
  function sendMessage(options) {
    options = options || {};
    var chats = options.forceChatIds
      ? (options.forceChatIds || []).map(String).filter(Boolean)
      : resolveChatIds_(options.contacts, options.purpose, options);
    var text = options.text || '';
    var skipDryRun =
      !!(options.forceRealSend && options.forceAllContacts) || !!options.skipDryRun;
    var preview = {
      chats: chats,
      text: text,
      environment: CM.Settings.getEnvironment(),
      dryRun: CM.Settings.isDryRun() && !skipDryRun,
      forceAllContacts: !!options.forceAllContacts,
      forceRealSend: skipDryRun,
      configured: isConfigured(),
      hasReplyMarkup: !!options.replyMarkup,
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
      var payload = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: options.disableWebPagePreview != null
          ? !!options.disableWebPagePreview
          : false,
      };
      if (options.replyMarkup) payload.reply_markup = options.replyMarkup;
      if (options.parseMode) payload.parse_mode = options.parseMode;
      results.push(apiCall_('sendMessage', payload));
    });
    var allOk = results.every(function (r) {
      return r.ok;
    });
    return { ok: allOk, dryRun: false, chats: chats, results: results, preview: preview };
  }

  /**
   * Respuesta directa a un chat (bot ops). Siempre intenta envío real si hay token
   * (no aplica dry-run de notificaciones mensuales).
   */
  function replyToChat(chatId, text, replyMarkup) {
    return sendMessage({
      forceChatIds: [String(chatId)],
      text: text || '',
      replyMarkup: replyMarkup || undefined,
      skipDryRun: true,
      purpose: 'owner_bot_reply',
    });
  }

  function answerCallbackQuery(callbackQueryId, text, showAlert) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    // Acks de botones del bot ops — no aplica dry-run de notificaciones.
    return apiCall_('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || '',
      show_alert: !!showAlert,
    });
  }

  function editMessageText(chatId, messageId, text, replyMarkup) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    var payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text || '',
      disable_web_page_preview: false,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return apiCall_('editMessageText', payload);
  }

  /**
   * Long/short poll Bot API getUpdates (modo polling; incompatible con webhook activo).
   * @param {{offset?:number, limit?:number, timeout?:number}} [opts]
   */
  function getUpdates(opts) {
    opts = opts || {};
    if (!isConfigured()) return { ok: false, reason: 'not_configured', updates: [] };
    var payload = {
      offset: opts.offset != null ? Number(opts.offset) : 0,
      limit: opts.limit != null ? Number(opts.limit) : 50,
      timeout: opts.timeout != null ? Number(opts.timeout) : 0,
      allowed_updates: opts.allowed_updates || ['message', 'callback_query'],
    };
    var res = apiCall_('getUpdates', payload);
    var list =
      res && res.body && res.body.result && Object.prototype.toString.call(res.body.result) === '[object Array]'
        ? res.body.result
        : [];
    return {
      ok: !!(res && res.ok),
      code: res && res.code,
      body: res && res.body,
      updates: list,
      offsetRequested: payload.offset,
    };
  }

  /** Inline keyboard helpers (Bot API). */
  function inlineKeyboard(rows) {
    return { inline_keyboard: rows || [] };
  }

  function inlineButton(label, callbackData) {
    return { text: String(label), callback_data: String(callbackData).slice(0, 64) };
  }

  /**
   * Webhook opcional (no es el camino default). Preferí polling 1 min.
   * Si hay webhook activo, getUpdates no entrega updates.
   */
  function setWebhook(webAppUrl) {
    var url = String(webAppUrl || '').trim();
    if (!url) return { ok: false, reason: 'missing_url', message: 'Falta URL del Web App.' };
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    return apiCall_('setWebhook', {
      url: url,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
  }

  function deleteWebhook(dropPending) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    return apiCall_('deleteWebhook', {
      drop_pending_updates: dropPending === true,
    });
  }

  function getWebhookInfo() {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    return apiCall_('getWebhookInfo', {});
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
   * Texto Telegram para inquilinos (informativo; no ops).
   */
  function formatTenantReportText(report) {
    var lines = [];
    lines.push('CasitasManager — ' + report.billingPeriod);
    lines.push(report.propertyAddress || '');
    lines.push('');
    lines.push(
      'Hola, les compartimos el detalle de los servicios. ' +
        'Fueron abonados por el propietario. Este mensaje es únicamente informativo.'
    );
    lines.push('');
    (report.items || []).forEach(function (it) {
      lines.push(
        '• ' +
          it.provider +
          ': ' +
          (it.amount === '' || it.amount == null ? 's/d' : it.amount + ' ARS') +
          (it.invoice_file_url ? '\n  ' + it.invoice_file_url : '')
      );
    });
    if (report.total != null) lines.push('\nTotal: ' + report.total + ' ARS');
    return lines.join('\n');
  }

  /**
   * Texto Telegram para propietario (ops: status, vencimientos, totales, links).
   * @param {object} report
   * @param {{tenantNotifyNote?: string}} [meta]
   */
  function formatOwnerReportText(report, meta) {
    meta = meta || {};
    var lines = [];
    lines.push('CasitasManager OPS — ' + report.billingPeriod);
    lines.push(report.propertyAddress || '');
    lines.push('Entorno: ' + (report.environment || ''));
    if (meta.tenantNotifyNote) lines.push('Inquilinos: ' + meta.tenantNotifyNote);
    if (report.spreadsheetUrl) lines.push('Sheet: ' + report.spreadsheetUrl);
    lines.push('');
    (report.items || []).forEach(function (it) {
      lines.push(
        '• ' +
          it.provider +
          ': ' +
          (it.amount === '' || it.amount == null ? 's/d' : it.amount + ' ARS') +
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

  /** @deprecated Prefer formatTenantReportText; alias for callers existentes. */
  function formatReportText(report) {
    return formatTenantReportText(report);
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
    replyToChat: replyToChat,
    answerCallbackQuery: answerCallbackQuery,
    editMessageText: editMessageText,
    getUpdates: getUpdates,
    inlineKeyboard: inlineKeyboard,
    inlineButton: inlineButton,
    setWebhook: setWebhook,
    deleteWebhook: deleteWebhook,
    getWebhookInfo: getWebhookInfo,
    formatTenantReportText: formatTenantReportText,
    formatOwnerReportText: formatOwnerReportText,
    formatReportText: formatReportText,
    handleOwnerCommand: handleOwnerCommand,
    resolveChatIds_: resolveChatIds_,
    apiCall_: apiCall_,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Telegram;
}
