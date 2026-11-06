/**
 * Bot Telegram ops — solo propietarios (Contacts role=owner, active, chat_id).
 * Copy amigable en español; sin jerga técnica en mensajes al usuario.
 * Entrada: doPost webhook → handleUpdate. Sesión multi-paso en Script Properties.
 */

var CM = CM || {};
CM.TelegramBot = (function () {
  var SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
  var EXPECTED_PROVIDERS = ['naturgy', 'ecogas', 'osse', 'municipalidad'];

  var COPY = {
    NO_ACCESS: 'No tenés acceso a este bot.',
    CANCELLED: 'Listo, cancelé lo que estabas haciendo.',
    SESSION_EXPIRED: 'Se venció el tiempo de espera. Empezá de nuevo desde el menú.',
    UNKNOWN: 'No entendí eso. Tocá una opción del menú o escribí /ayuda.',
    HELP:
      'Soy el asistente del propietario para CasitasManager.\n\n' +
      'Podés:\n' +
      '• Ver las facturas del mes\n' +
      '• Revisar un mes anterior\n' +
      '• Cargar el gas con el número de comprobante\n' +
      '• Marcar una factura como pagada\n' +
      '• Agregar una propiedad nueva\n\n' +
      'Escribí /menu o /cancelar cuando quieras.',
    WELCOME:
      'Hola. Este bot es solo para el propietario.\n' +
      'Elegí una opción:',
    ASK_ECOGAS:
      'Mandame el número de comprobante del gas (Ecogas).\n' +
      'Lo ves en el portal después de entrar (ej. 0401B60797913A).\n\n' +
      'Escribí /cancelar para salir.',
    ECOGAS_EMPTY: 'Necesito el número de comprobante. Mandalo o /cancelar.',
    ASK_HISTORY:
      '¿Qué mes querés ver?\n' +
      '• Tocá «Mes pasado»\n' +
      '• O escribí año y mes, por ejemplo: 2026-10 o octubre 2026\n\n' +
      '/cancelar para salir.',
    ASK_MARK_PAID_PERIOD:
      '¿De qué mes querés marcar una factura como pagada?',
    NO_UNPAID: 'No hay facturas pendientes de pago en ese mes.',
    ASK_ADD_NAME: '¿Cómo se llama la propiedad nueva?\n(Ej.: Casa Centro Caucete)',
    ASK_ADD_ADDRESS: '¿Cuál es la dirección?',
    ASK_ADD_CITY: '¿Ciudad o departamento?\n(Ej.: Rivadavia, Caucete)',
    ASK_ADD_PROVINCE:
      '¿Provincia? (Enter o «San Juan» para dejar San Juan por defecto)',
    ASK_ADD_SERVICES:
      '¿Qué servicios tiene? Tocá para marcar/desmarcar, después «Listo».',
    ASK_NATURGY_ACCOUNT: 'Número de cuenta de la luz (Naturgy):',
    ASK_NATURGY_METER: 'Número de medidor de la luz (si no tenés, mandá «-»):',
    ASK_ECOGAS_ACCOUNT: 'Número de cuenta del gas (Ecogas):',
    ASK_OSSE_ACCOUNT: 'Número de cuenta del agua (OSSE):',
    ASK_MUNI_MUNICIPIO:
      '¿Municipio de la tasa municipal?\n' +
      'Importante: Caucete no usa el mismo portal que Rivadavia.',
    ASK_MUNI_CADASTRAL:
      'Nomenclatura / catastro municipal (si no la tenés, mandá «-»):',
    ASK_CONTACT_ROLE: 'Contacto: ¿propietario o inquilino?',
    ASK_CONTACT_NAME: 'Nombre del contacto:',
    ASK_CONTACT_EMAIL: 'Email del contacto (o «-» si no tiene):',
    ASK_CONTACT_TELEGRAM:
      'Chat de Telegram del contacto (número de chat, o «-» si no tiene):',
    ASK_MORE_CONTACTS: '¿Agregar otro contacto para esta propiedad?',
    ADD_NEED_CONTACT: 'Hace falta al menos un contacto. Seguí con el primero.',
  };

  var CB = {
    MENU: 'm:menu',
    MONTH: 'm:month',
    HISTORY: 'm:hist',
    HISTORY_PREV: 'm:hist:prev',
    ECOGAS: 'm:eco',
    PAID: 'm:paid',
    PAID_CUR: 'm:paid:cur',
    PAID_PREV: 'm:paid:prev',
    ADD: 'm:add',
    HELP: 'm:help',
    CANCEL: 'm:cancel',
    DL_OSSE: 'm:dl:osse',
    DL_NAT: 'm:dl:naturgy',
    DL_MUNI: 'm:dl:municipalidad',
    PENDING: 'm:pending',
    PREVIEW: 'm:preview',
    SVC_TOGGLE: 'ap:svc:', // + provider
    SVC_DONE: 'ap:svc:done',
    CONTACT_OWNER: 'ap:role:owner',
    CONTACT_TENANT: 'ap:role:tenant',
    MORE_YES: 'ap:more:yes',
    MORE_NO: 'ap:more:no',
    PAY_PICK: 'pay:', // + index
  };

  /* ─── Auth ─────────────────────────────────────────────────────────── */

  function normalizeChatId_(raw) {
    return String(raw == null ? '' : raw).trim();
  }

  /**
   * Owner activo con telegram coincidente (cualquier property_id).
   * @param {string} chatId
   * @param {object[]} [contacts] inyectable para tests
   */
  function findOwnerByChatId(chatId, contacts) {
    var want = normalizeChatId_(chatId);
    if (!want) return null;
    var list = contacts;
    if (!list) {
      try {
        list = CM.Sheets.list(CM.Sheets.SHEET_NAMES.CONTACTS) || [];
      } catch (e) {
        list = [];
      }
    }
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c) continue;
      if (String(c.role || '').toLowerCase() !== 'owner') continue;
      var active = c.active !== false && String(c.active).toLowerCase() !== 'false';
      if (!active) continue;
      if (normalizeChatId_(c.telegram) === want) return c;
    }
    return null;
  }

  function isAuthorizedOwner(contact) {
    if (!contact) return false;
    if (String(contact.role || '').toLowerCase() !== 'owner') return false;
    var active =
      contact.active !== false && String(contact.active).toLowerCase() !== 'false';
    return active && !!normalizeChatId_(contact.telegram);
  }

  /* ─── Labels / formatting (sin jerga) ──────────────────────────────── */

  function providerLabelEs(provider) {
    var p = String(provider || '').toLowerCase();
    if (p === 'naturgy') return 'luz';
    if (p === 'ecogas') return 'gas';
    if (p === 'osse') return 'agua';
    if (p === 'municipalidad') return 'municipalidad';
    return p || 'servicio';
  }

  function paymentStatusLabelEs(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'paid') return 'pagada';
    if (s === 'pending') return 'pendiente de pago';
    if (s === 'unknown' || !s) return 'sin confirmar';
    return 'sin confirmar';
  }

  function formatAmountEs(amount) {
    if (amount == null || amount === '') return 'sin monto';
    var n = typeof amount === 'number' ? amount : CM.Invoices.normalizeAmount(amount);
    if (n == null || isNaN(n)) return 'sin monto';
    var fixed = n.toFixed(2);
    var parts = fixed.split('.');
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return '$' + intPart + ',' + parts[1];
  }

  function formatDueEs(due) {
    var iso = CM.Dates.parseDateToISO(due);
    if (!iso) return 'sin vencimiento';
    var parts = iso.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function sumAmounts_(invoices) {
    var total = 0;
    var any = false;
    (invoices || []).forEach(function (inv) {
      var n = CM.Invoices.normalizeAmount(inv.amount);
      if (n != null && !isNaN(n)) {
        total += n;
        any = true;
      }
    });
    return any ? total : null;
  }

  /**
   * Lista de facturas de un período — texto owner-friendly.
   * @returns {{text:string, total:number|null, period:string, missing:string[], count:number}}
   */
  function formatMonthListing(invoices, period, options) {
    options = options || {};
    var p = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    var label = CM.Dates.formatPeriodLabelEs(p);
    var lines = [];
    lines.push('Facturas — ' + label);
    if (options.propertyName) lines.push(options.propertyName);
    lines.push('');

    var list = invoices || [];
    if (!list.length) {
      lines.push('Todavía no hay facturas cargadas para este mes.');
      lines.push('Cuando bajemos alguna, va a aparecer acá.');
      return {
        text: lines.join('\n'),
        total: null,
        period: p,
        missing: EXPECTED_PROVIDERS.slice(),
        count: 0,
      };
    }

    var seen = {};
    list.forEach(function (inv) {
      var prov = providerLabelEs(inv.provider);
      seen[String(inv.provider || '').toLowerCase()] = true;
      var amt = formatAmountEs(inv.amount);
      var due = formatDueEs(inv.due_date);
      var st = paymentStatusLabelEs(inv.payment_status);
      var line = '• ' + prov + ': ' + amt + ' · vence ' + due + ' · ' + st;
      if (inv.invoice_file_url) {
        line += '\n  PDF: ' + inv.invoice_file_url;
      } else {
        line += '\n  (sin PDF todavía)';
      }
      lines.push(line);
    });

    var total = sumAmounts_(list);
    if (total != null) {
      lines.push('');
      lines.push('Total: ' + formatAmountEs(total));
    }

    var missing = [];
    var checkList = options.expectedProviders || EXPECTED_PROVIDERS;
    checkList.forEach(function (prov) {
      if (!seen[prov]) missing.push(providerLabelEs(prov));
    });
    if (missing.length) {
      lines.push('');
      if (missing.indexOf('gas') >= 0) {
        lines.push(
          'Todavía falta el gas: cuando tengas el número de comprobante, usá «Cargar gas».'
        );
      }
      var others = missing.filter(function (m) {
        return m !== 'gas';
      });
      if (others.length) {
        lines.push('Aún no vemos: ' + others.join(', ') + '.');
      }
    }

    return {
      text: lines.join('\n'),
      total: total,
      period: p,
      missing: missing,
      count: list.length,
    };
  }

  function formatHistoryListing(invoices, period) {
    var formatted = formatMonthListing(invoices, period, { expectedProviders: [] });
    if (!formatted.count) {
      var label = CM.Dates.formatPeriodLabelEs(
        CM.Dates.normalizeBillingPeriod(period)
      );
      return {
        text:
          'No hay facturas guardadas para ' +
          label +
          '.\nSi ese mes ya pasó y deberían estar, avisame o cargalas desde el menú de la planilla.',
        total: null,
        period: formatted.period,
        count: 0,
      };
    }
    return formatted;
  }

  function formatEcogasResult(downloadResult) {
    if (!downloadResult) {
      return { ok: false, text: 'No pude cargar el gas. Probá de nuevo más tarde.' };
    }
    if (downloadResult.ok || downloadResult.autoPdf) {
      var rec =
        downloadResult.record ||
        (downloadResult.persist &&
          downloadResult.persist.upserts &&
          downloadResult.persist.upserts[0] &&
          downloadResult.persist.upserts[0].record) ||
        null;
      var lines = ['Listo: cargué la factura del gas.'];
      if (rec) {
        if (rec.amount != null && rec.amount !== '') {
          lines.push('Monto: ' + formatAmountEs(rec.amount));
        }
        if (rec.due_date) lines.push('Vence: ' + formatDueEs(rec.due_date));
        if (rec.issue_date) lines.push('Emisión: ' + formatDueEs(rec.issue_date));
        if (rec.invoice_file_url) lines.push('PDF: ' + rec.invoice_file_url);
      } else if (downloadResult.message) {
        // Mensaje interno — no reenviar jerga; genérico si huele a técnico
        lines.push('Quedó guardada en Drive.');
      }
      return { ok: true, text: lines.join('\n') };
    }
    return {
      ok: false,
      text:
        'No pude bajar el PDF con ese comprobante.\n' +
        'Revisá el número e intentá de nuevo, o importá el PDF a mano desde la planilla.',
    };
  }

  function formatMarkPaidResult(result, invoice) {
    if (!result || result.ok === false) {
      return 'No pude marcarla como pagada. Probá de nuevo.';
    }
    var inv = (result && result.invoice) || invoice || {};
    var pay = (result && result.payment) || {};
    var lines = ['Listo: quedó marcada como pagada.'];
    lines.push('Servicio: ' + providerLabelEs(inv.provider || pay.provider));
    if (pay.amount != null && pay.amount !== '') {
      lines.push('Monto: ' + formatAmountEs(pay.amount));
    } else if (inv.amount != null && inv.amount !== '') {
      lines.push('Monto: ' + formatAmountEs(inv.amount));
    }
    if (pay.payment_date) lines.push('Fecha: ' + formatDueEs(pay.payment_date));
    return lines.join('\n');
  }

  function formatAddPropertyResultFriendly(result) {
    if (!result || !result.ok) {
      return (
        'No pude crear la propiedad.\n' +
        'Revisá los datos e intentá de nuevo desde el menú.'
      );
    }
    var lines = [];
    var name =
      (result.property && result.property.property_name) ||
      'la propiedad';
    lines.push('Listo: creé «' + name + '».');
    var svcs = result.services || [];
    if (svcs.length) {
      lines.push(
        'Servicios: ' +
          svcs
            .map(function (s) {
              return providerLabelEs(s.provider);
            })
            .join(', ')
      );
    } else {
      lines.push('Sin servicios por ahora.');
    }
    var cts = result.contacts || [];
    lines.push(
      'Contactos: ' +
        (cts.length
          ? cts
              .map(function (c) {
                var rol = String(c.role) === 'tenant' ? 'inquilino' : 'propietario';
                return rol + (c.name ? ' (' + c.name + ')' : '');
              })
              .join(', ')
          : 'ninguno')
    );
    var attn = result.needsAttention || [];
    var softAttn = [];
    attn.forEach(function (a) {
      var s = String(a);
      if (/caucete|unsupported|municipio/i.test(s)) {
        softAttn.push(
          'La tasa municipal de ese municipio todavía no se descarga sola: importá el PDF a mano cuando lo tengas.'
        );
      } else if (/cuenta|account|catastro|medidor/i.test(s)) {
        softAttn.push('Falta algún dato de cuenta o medidor: completálo después en la planilla.');
      }
    });
    if (softAttn.length) {
      lines.push('');
      softAttn.forEach(function (t) {
        lines.push('• ' + t);
      });
    }
    return lines.join('\n');
  }

  /* ─── Keyboards ────────────────────────────────────────────────────── */

  function mainMenuKeyboard() {
    var B = CM.Telegram.inlineButton;
    return CM.Telegram.inlineKeyboard([
      [B('Mes en curso', CB.MONTH), B('Mes anterior', CB.HISTORY)],
      [B('Cargar gas (comprobante)', CB.ECOGAS)],
      [B('Marcar pagada', CB.PAID), B('Agregar propiedad', CB.ADD)],
      [B('Pendientes de pago', CB.PENDING)],
      [B('Descargar agua', CB.DL_OSSE), B('Descargar luz', CB.DL_NAT)],
      [B('Descargar municipalidad', CB.DL_MUNI)],
      [B('Vista previa aviso', CB.PREVIEW), B('Ayuda', CB.HELP)],
    ]);
  }

  function cancelKeyboard() {
    return CM.Telegram.inlineKeyboard([
      [CM.Telegram.inlineButton('Cancelar', CB.CANCEL)],
    ]);
  }

  function historyKeyboard() {
    var B = CM.Telegram.inlineButton;
    return CM.Telegram.inlineKeyboard([
      [B('Mes pasado', CB.HISTORY_PREV)],
      [B('Cancelar', CB.CANCEL)],
    ]);
  }

  function markPaidPeriodKeyboard() {
    var B = CM.Telegram.inlineButton;
    return CM.Telegram.inlineKeyboard([
      [B('Mes en curso', CB.PAID_CUR), B('Mes pasado', CB.PAID_PREV)],
      [B('Cancelar', CB.CANCEL)],
    ]);
  }

  function servicesKeyboard(selected) {
    selected = selected || {};
    var B = CM.Telegram.inlineButton;
    function mark(key, label) {
      return (selected[key] ? '✓ ' : '') + label;
    }
    return CM.Telegram.inlineKeyboard([
      [B(mark('naturgy', 'Luz'), CB.SVC_TOGGLE + 'naturgy')],
      [B(mark('ecogas', 'Gas'), CB.SVC_TOGGLE + 'ecogas')],
      [B(mark('osse', 'Agua'), CB.SVC_TOGGLE + 'osse')],
      [B(mark('municipalidad', 'Municipalidad'), CB.SVC_TOGGLE + 'municipalidad')],
      [B('Listo', CB.SVC_DONE), B('Cancelar', CB.CANCEL)],
    ]);
  }

  function unpaidKeyboard(unpaid) {
    var rows = [];
    (unpaid || []).slice(0, 10).forEach(function (inv, i) {
      var label =
        providerLabelEs(inv.provider) +
        ' · ' +
        formatAmountEs(inv.amount) +
        ' · vence ' +
        formatDueEs(inv.due_date);
      rows.push([CM.Telegram.inlineButton(label, CB.PAY_PICK + String(i))]);
    });
    rows.push([CM.Telegram.inlineButton('Cancelar', CB.CANCEL)]);
    return CM.Telegram.inlineKeyboard(rows);
  }

  /* ─── Session ──────────────────────────────────────────────────────── */

  function sessionKey_(chatId) {
    return CM.Settings.KEYS.TG_BOT_SESSION_PREFIX + normalizeChatId_(chatId);
  }

  function getSession(chatId) {
    var raw = CM.Settings.get(sessionKey_(chatId), '');
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(chatId, session) {
    session = session || {};
    session.updatedAt = Date.now();
    CM.Settings.set(sessionKey_(chatId), JSON.stringify(session));
    return session;
  }

  function clearSession(chatId) {
    CM.Settings.set(sessionKey_(chatId), '');
  }

  function isSessionExpired(session, nowMs) {
    if (!session || !session.updatedAt) return true;
    var now = nowMs != null ? nowMs : Date.now();
    return now - Number(session.updatedAt) > SESSION_TTL_MS;
  }

  /* ─── Data helpers ─────────────────────────────────────────────────── */

  function listInvoicesForPeriod_(period) {
    return CM.Invoices.listForPeriod(period);
  }

  function listUnpaidForPeriod_(period) {
    var invs = listInvoicesForPeriod_(period);
    return CM.Payments.listUnpaidForMenu(invs, 12);
  }

  function listAllUnpaid_() {
    try {
      var all = CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES) || [];
      return CM.Payments.listUnpaidForMenu(all, 12);
    } catch (e) {
      return [];
    }
  }

  /* ─── Flow handlers ────────────────────────────────────────────────── */

  function replyMenu_(chatId, text) {
    return {
      chatId: chatId,
      text: text || COPY.WELCOME,
      replyMarkup: mainMenuKeyboard(),
    };
  }

  function handleStart_(chatId) {
    clearSession(chatId);
    return replyMenu_(chatId, COPY.WELCOME);
  }

  function handleMonth_(chatId) {
    var period = CM.Dates.currentBillingPeriod();
    var invs = listInvoicesForPeriod_(period);
    var formatted = formatMonthListing(invs, period);
    return {
      chatId: chatId,
      text: formatted.text,
      replyMarkup: mainMenuKeyboard(),
    };
  }

  function handlePending_(chatId) {
    var unpaid = listAllUnpaid_();
    if (!unpaid.length) {
      return replyMenu_(chatId, 'No hay facturas pendientes de pago.');
    }
    var lines = ['Pendientes de pago:'];
    unpaid.forEach(function (inv) {
      lines.push(
        '• ' +
          providerLabelEs(inv.provider) +
          ' (' +
          CM.Dates.formatPeriodLabelEs(inv.billing_period) +
          '): ' +
          formatAmountEs(inv.amount) +
          ' · vence ' +
          formatDueEs(inv.due_date)
      );
    });
    return { chatId: chatId, text: lines.join('\n'), replyMarkup: mainMenuKeyboard() };
  }

  function handleHistoryStart_(chatId) {
    setSession(chatId, { flow: 'history', step: 'ask_period', data: {} });
    return {
      chatId: chatId,
      text: COPY.ASK_HISTORY,
      replyMarkup: historyKeyboard(),
    };
  }

  function handleHistoryPeriod_(chatId, periodRaw) {
    var period = CM.Dates.normalizeBillingPeriod(periodRaw);
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return {
        chatId: chatId,
        text: 'No reconocí el mes. Probá con 2026-10 o «octubre 2026».',
        replyMarkup: historyKeyboard(),
      };
    }
    clearSession(chatId);
    var invs = listInvoicesForPeriod_(period);
    var formatted = formatHistoryListing(invs, period);
    return {
      chatId: chatId,
      text: formatted.text,
      replyMarkup: mainMenuKeyboard(),
    };
  }

  function handleEcogasStart_(chatId) {
    setSession(chatId, { flow: 'ecogas', step: 'ask_comprobante', data: {} });
    return {
      chatId: chatId,
      text: COPY.ASK_ECOGAS,
      replyMarkup: cancelKeyboard(),
    };
  }

  function handleEcogasComprobante_(chatId, text, deps) {
    var comprobante = String(text || '').trim();
    if (!comprobante || comprobante.charAt(0) === '/') {
      return {
        chatId: chatId,
        text: COPY.ECOGAS_EMPTY,
        replyMarkup: cancelKeyboard(),
      };
    }
    clearSession(chatId);
    var downloadFn =
      (deps && deps.downloadEcogas) ||
      function (comp) {
        if (typeof downloadEcogasSessionInvoice === 'function') {
          return downloadEcogasSessionInvoice(comp);
        }
        return { ok: false };
      };
    var result;
    try {
      result = downloadFn(comprobante);
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e) };
    }
    var formatted = formatEcogasResult(result);
    return {
      chatId: chatId,
      text: formatted.text,
      replyMarkup: mainMenuKeyboard(),
    };
  }

  function handleMarkPaidStart_(chatId) {
    setSession(chatId, { flow: 'mark_paid', step: 'ask_period', data: {} });
    return {
      chatId: chatId,
      text: COPY.ASK_MARK_PAID_PERIOD,
      replyMarkup: markPaidPeriodKeyboard(),
    };
  }

  function handleMarkPaidPeriod_(chatId, period) {
    var unpaid = listUnpaidForPeriod_(period);
    if (!unpaid.length) {
      clearSession(chatId);
      return replyMenu_(chatId, COPY.NO_UNPAID);
    }
    setSession(chatId, {
      flow: 'mark_paid',
      step: 'pick',
      data: {
        period: period,
        ids: unpaid.map(function (u) {
          return u.invoice_id;
        }),
      },
    });
    var label = CM.Dates.formatPeriodLabelEs(period);
    return {
      chatId: chatId,
      text: 'Elegí cuál marcar como pagada (' + label + '):',
      replyMarkup: unpaidKeyboard(unpaid),
    };
  }

  function handleMarkPaidPick_(chatId, index, deps) {
    var session = getSession(chatId);
    if (!session || session.flow !== 'mark_paid' || !session.data) {
      clearSession(chatId);
      return replyMenu_(chatId, COPY.SESSION_EXPIRED);
    }
    var ids = session.data.ids || [];
    var invoiceId = ids[index];
    if (!invoiceId) {
      return {
        chatId: chatId,
        text: 'Opción inválida. Elegí una de la lista.',
        replyMarkup: cancelKeyboard(),
      };
    }
    var inv = null;
    try {
      inv = CM.Sheets.findInvoiceById(invoiceId);
    } catch (e) {
      inv = null;
    }
    var registerFn =
      (deps && deps.registerPayment) ||
      function (input) {
        return CM.Payments.registerPayment(input);
      };
    var result;
    try {
      var registered = registerFn({
        invoice_id: invoiceId,
        confirmation_source: 'telegram_owner_bot',
      });
      result = { ok: true, payment: registered.payment, invoice: registered.invoice };
    } catch (e2) {
      result = { ok: false, message: String(e2 && e2.message ? e2.message : e2) };
    }
    clearSession(chatId);
    return {
      chatId: chatId,
      text: formatMarkPaidResult(result, inv),
      replyMarkup: mainMenuKeyboard(),
    };
  }

  function handleDownloadNow_(chatId, providerId, deps) {
    var labels = {
      osse: 'agua',
      naturgy: 'luz',
      municipalidad: 'municipalidad',
    };
    var label = labels[providerId] || providerId;
    var downloadFn =
      (deps && deps.downloadProvider) ||
      function (id) {
        if (typeof downloadProviderInvoice_ === 'function') {
          return downloadProviderInvoice_(id);
        }
        if (typeof downloadProviderInvoice === 'function') {
          return downloadProviderInvoice(id);
        }
        return { ok: false };
      };
    var result;
    try {
      result = downloadFn(providerId);
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e) };
    }
    var ok = !!(result && (result.autoPdf || result.ok || result.metadataOnly));
    var text = ok
      ? 'Listo: intenté descargar la factura de ' + label + '.'
      : 'No pude descargar ' +
        label +
        ' ahora. Revisá después o usá la planilla.';
    if (ok && result.persist && result.persist.upserts && result.persist.upserts[0]) {
      var rec = result.persist.upserts[0].record;
      if (rec) {
        if (rec.amount != null && rec.amount !== '') {
          text += '\nMonto: ' + formatAmountEs(rec.amount);
        }
        if (rec.due_date) text += '\nVence: ' + formatDueEs(rec.due_date);
        if (rec.invoice_file_url) text += '\nPDF: ' + rec.invoice_file_url;
      }
    }
    return { chatId: chatId, text: text, replyMarkup: mainMenuKeyboard() };
  }

  function handlePreviewNotify_(chatId, deps) {
    var period = CM.Dates.currentBillingPeriod();
    var previewFn =
      (deps && deps.previewMonthlyReport) ||
      function (p) {
        if (typeof previewMonthlyReport === 'function') return previewMonthlyReport(p);
        return CM.Notifications.previewMonthlyReport(p);
      };
    var preview;
    try {
      preview = previewFn(period);
    } catch (e) {
      return replyMenu_(
        chatId,
        'No pude armar la vista previa. Probá más tarde.'
      );
    }
    var report = (preview && preview.report) || preview || {};
    var items = report.items || [];
    var lines = [
      'Vista previa del aviso — ' + CM.Dates.formatPeriodLabelEs(period),
      '(solo para vos; no se envió a nadie)',
      '',
    ];
    if (!items.length) {
      lines.push('No hay ítems para este mes todavía.');
    } else {
      items.forEach(function (it) {
        lines.push(
          '• ' +
            providerLabelEs(it.provider) +
            ': ' +
            formatAmountEs(it.amount) +
            ' · ' +
            paymentStatusLabelEs(it.payment_status)
        );
      });
      if (report.total != null) {
        lines.push('');
        lines.push('Total: ' + formatAmountEs(report.total));
      }
    }
    return { chatId: chatId, text: lines.join('\n'), replyMarkup: mainMenuKeyboard() };
  }

  /* ─── Add property state machine ───────────────────────────────────── */

  function addPropertyStart_(chatId) {
    setSession(chatId, {
      flow: 'add_property',
      step: 'name',
      data: { servicesSelected: {}, services: [], contacts: [] },
    });
    return {
      chatId: chatId,
      text: COPY.ASK_ADD_NAME,
      replyMarkup: cancelKeyboard(),
    };
  }

  /**
   * Avanza el diálogo de alta de propiedad.
   * @returns {{session:object, reply:object, done?:boolean, result?:object}}
   */
  function advanceAddProperty(session, input, deps) {
    session = session || { flow: 'add_property', step: 'name', data: {} };
    var data = session.data || (session.data = {});
    var text = input && input.text != null ? String(input.text).trim() : '';
    var callback = input && input.callback ? String(input.callback) : '';

    function ask(step, msg, markup) {
      session.step = step;
      return {
        session: session,
        reply: {
          text: msg,
          replyMarkup: markup || cancelKeyboard(),
        },
      };
    }

    if (session.step === 'name') {
      if (!text) return ask('name', COPY.ASK_ADD_NAME);
      data.property_name = text;
      return ask('address', COPY.ASK_ADD_ADDRESS);
    }
    if (session.step === 'address') {
      data.address = text || '';
      return ask('city', COPY.ASK_ADD_CITY);
    }
    if (session.step === 'city') {
      if (!text) return ask('city', COPY.ASK_ADD_CITY);
      data.city = text;
      return ask('province', COPY.ASK_ADD_PROVINCE);
    }
    if (session.step === 'province') {
      data.province = text && text !== '-' ? text : 'San Juan';
      data.servicesSelected = data.servicesSelected || {};
      return ask('services', COPY.ASK_ADD_SERVICES, servicesKeyboard(data.servicesSelected));
    }
    if (session.step === 'services') {
      if (callback === CB.SVC_DONE || /^listo$/i.test(text)) {
        data.serviceQueue = EXPECTED_PROVIDERS.filter(function (p) {
          return !!data.servicesSelected[p];
        });
        data.services = [];
        return nextServicePrompt_(session);
      }
      if (callback.indexOf(CB.SVC_TOGGLE) === 0) {
        var prov = callback.slice(CB.SVC_TOGGLE.length);
        if (prov && prov !== 'done') {
          data.servicesSelected[prov] = !data.servicesSelected[prov];
        }
        return ask(
          'services',
          COPY.ASK_ADD_SERVICES,
          servicesKeyboard(data.servicesSelected)
        );
      }
      return ask(
        'services',
        COPY.ASK_ADD_SERVICES,
        servicesKeyboard(data.servicesSelected)
      );
    }

    // Per-service identifier collection
    if (session.step.indexOf('svc_') === 0) {
      return advanceServiceStep_(session, text);
    }

    if (session.step === 'contact_role') {
      var role = '';
      if (callback === CB.CONTACT_OWNER || /^propietario/i.test(text)) role = 'owner';
      if (callback === CB.CONTACT_TENANT || /^inquilino/i.test(text)) role = 'tenant';
      if (!role) {
        return ask(
          'contact_role',
          COPY.ASK_CONTACT_ROLE,
          CM.Telegram.inlineKeyboard([
            [
              CM.Telegram.inlineButton('Propietario', CB.CONTACT_OWNER),
              CM.Telegram.inlineButton('Inquilino', CB.CONTACT_TENANT),
            ],
            [CM.Telegram.inlineButton('Cancelar', CB.CANCEL)],
          ])
        );
      }
      data._contact = { role: role };
      return ask('contact_name', COPY.ASK_CONTACT_NAME);
    }
    if (session.step === 'contact_name') {
      if (!text) return ask('contact_name', COPY.ASK_CONTACT_NAME);
      data._contact.name = text;
      return ask('contact_email', COPY.ASK_CONTACT_EMAIL);
    }
    if (session.step === 'contact_email') {
      data._contact.email = text === '-' ? '' : text;
      return ask('contact_telegram', COPY.ASK_CONTACT_TELEGRAM);
    }
    if (session.step === 'contact_telegram') {
      data._contact.telegram = text === '-' ? '' : text;
      data._contact.active = true;
      data.contacts = data.contacts || [];
      data.contacts.push(data._contact);
      data._contact = null;
      return ask(
        'more_contacts',
        COPY.ASK_MORE_CONTACTS,
        CM.Telegram.inlineKeyboard([
          [
            CM.Telegram.inlineButton('Sí', CB.MORE_YES),
            CM.Telegram.inlineButton('No, crear', CB.MORE_NO),
          ],
          [CM.Telegram.inlineButton('Cancelar', CB.CANCEL)],
        ])
      );
    }
    if (session.step === 'more_contacts') {
      if (callback === CB.MORE_YES || /^s[ií]$/i.test(text)) {
        return ask(
          'contact_role',
          COPY.ASK_CONTACT_ROLE,
          CM.Telegram.inlineKeyboard([
            [
              CM.Telegram.inlineButton('Propietario', CB.CONTACT_OWNER),
              CM.Telegram.inlineButton('Inquilino', CB.CONTACT_TENANT),
            ],
            [CM.Telegram.inlineButton('Cancelar', CB.CANCEL)],
          ])
        );
      }
      if (callback === CB.MORE_NO || /^no/i.test(text)) {
        return finishAddProperty_(session, deps);
      }
      return ask(
        'more_contacts',
        COPY.ASK_MORE_CONTACTS,
        CM.Telegram.inlineKeyboard([
          [
            CM.Telegram.inlineButton('Sí', CB.MORE_YES),
            CM.Telegram.inlineButton('No, crear', CB.MORE_NO),
          ],
        ])
      );
    }

    return ask('name', COPY.ASK_ADD_NAME);
  }

  function nextServicePrompt_(session) {
    var data = session.data;
    var queue = data.serviceQueue || [];
    if (!queue.length) {
      session.step = 'contact_role';
      return {
        session: session,
        reply: {
          text: COPY.ASK_CONTACT_ROLE,
          replyMarkup: CM.Telegram.inlineKeyboard([
            [
              CM.Telegram.inlineButton('Propietario', CB.CONTACT_OWNER),
              CM.Telegram.inlineButton('Inquilino', CB.CONTACT_TENANT),
            ],
            [CM.Telegram.inlineButton('Cancelar', CB.CANCEL)],
          ]),
        },
      };
    }
    var next = queue[0];
    data._svc = { provider: next };
    if (next === 'naturgy') {
      session.step = 'svc_naturgy_account';
      return {
        session: session,
        reply: { text: COPY.ASK_NATURGY_ACCOUNT, replyMarkup: cancelKeyboard() },
      };
    }
    if (next === 'ecogas') {
      session.step = 'svc_ecogas_account';
      return {
        session: session,
        reply: { text: COPY.ASK_ECOGAS_ACCOUNT, replyMarkup: cancelKeyboard() },
      };
    }
    if (next === 'osse') {
      session.step = 'svc_osse_account';
      return {
        session: session,
        reply: { text: COPY.ASK_OSSE_ACCOUNT, replyMarkup: cancelKeyboard() },
      };
    }
    if (next === 'municipalidad') {
      session.step = 'svc_muni_municipio';
      return {
        session: session,
        reply: { text: COPY.ASK_MUNI_MUNICIPIO, replyMarkup: cancelKeyboard() },
      };
    }
    // skip unknown
    data.serviceQueue.shift();
    return nextServicePrompt_(session);
  }

  function advanceServiceStep_(session, text) {
    var data = session.data;
    var svc = data._svc || {};
    var step = session.step;

    if (step === 'svc_naturgy_account') {
      svc.account_number = text === '-' ? '' : text;
      session.step = 'svc_naturgy_meter';
      data._svc = svc;
      return {
        session: session,
        reply: { text: COPY.ASK_NATURGY_METER, replyMarkup: cancelKeyboard() },
      };
    }
    if (step === 'svc_naturgy_meter') {
      svc.secondary_identifier = text === '-' ? '' : text;
      data.services.push(svc);
      data._svc = null;
      data.serviceQueue.shift();
      return nextServicePrompt_(session);
    }
    if (step === 'svc_ecogas_account') {
      svc.account_number = text === '-' ? '' : text;
      data.services.push(svc);
      data._svc = null;
      data.serviceQueue.shift();
      return nextServicePrompt_(session);
    }
    if (step === 'svc_osse_account') {
      svc.account_number = text === '-' ? '' : text;
      data.services.push(svc);
      data._svc = null;
      data.serviceQueue.shift();
      return nextServicePrompt_(session);
    }
    if (step === 'svc_muni_municipio') {
      if (!text) {
        return {
          session: session,
          reply: { text: COPY.ASK_MUNI_MUNICIPIO, replyMarkup: cancelKeyboard() },
        };
      }
      svc.municipio = text;
      session.step = 'svc_muni_cadastral';
      data._svc = svc;
      return {
        session: session,
        reply: { text: COPY.ASK_MUNI_CADASTRAL, replyMarkup: cancelKeyboard() },
      };
    }
    if (step === 'svc_muni_cadastral') {
      svc.cadastral_number = text === '-' ? '' : text;
      data.services.push(svc);
      data._svc = null;
      data.serviceQueue.shift();
      return nextServicePrompt_(session);
    }
    return nextServicePrompt_(session);
  }

  function finishAddProperty_(session, deps) {
    var data = session.data || {};
    if (!data.contacts || !data.contacts.length) {
      session.step = 'contact_role';
      return {
        session: session,
        reply: {
          text: COPY.ADD_NEED_CONTACT + '\n' + COPY.ASK_CONTACT_ROLE,
          replyMarkup: CM.Telegram.inlineKeyboard([
            [
              CM.Telegram.inlineButton('Propietario', CB.CONTACT_OWNER),
              CM.Telegram.inlineButton('Inquilino', CB.CONTACT_TENANT),
            ],
          ]),
        },
      };
    }
    var input = {
      property_name: data.property_name,
      address: data.address || '',
      city: data.city || '',
      province: data.province || 'San Juan',
      services: data.services || [],
      contacts: data.contacts || [],
      createDriveFolder: true,
    };
    var addFn =
      (deps && deps.addProperty) ||
      function (inp) {
        return CM.Properties.addProperty(inp);
      };
    var result;
    try {
      result = addFn(input);
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e) };
    }
    return {
      session: null,
      done: true,
      result: result,
      reply: {
        text: formatAddPropertyResultFriendly(result),
        replyMarkup: mainMenuKeyboard(),
      },
    };
  }

  /* ─── Update router ────────────────────────────────────────────────── */

  function parseCommand_(text) {
    var t = String(text || '').trim();
    if (!t) return { cmd: '', args: [], raw: '' };
    if (t.charAt(0) !== '/') return { cmd: '', args: [], raw: t };
    var parts = t.split(/\s+/);
    var cmd = parts[0].replace(/^\//, '').split('@')[0].toLowerCase();
    return { cmd: cmd, args: parts.slice(1), raw: t };
  }

  /**
   * Procesa un update de Telegram (message o callback_query).
   * No llama a la red si deps.silent — retorna acciones para el caller.
   * Por defecto envía reply vía CM.Telegram.replyToChat.
   *
   * @param {object} update
   * @param {object} [deps] mocks: contacts, downloadEcogas, registerPayment, addProperty, …
   * @returns {{ok:boolean, authorized?:boolean, replies?:object[], reason?:string}}
   */
  function handleUpdate(update, deps) {
    deps = deps || {};
    update = update || {};

    var chatId = null;
    var text = '';
    var callbackData = '';
    var callbackQueryId = '';
    var messageId = null;

    if (update.callback_query) {
      var cq = update.callback_query;
      chatId = cq.message && cq.message.chat && cq.message.chat.id;
      callbackData = String(cq.data || '');
      callbackQueryId = cq.id;
      messageId = cq.message && cq.message.message_id;
      text = '';
    } else if (update.message) {
      chatId = update.message.chat && update.message.chat.id;
      text = update.message.text || '';
    } else {
      return { ok: false, reason: 'unsupported_update' };
    }

    chatId = normalizeChatId_(chatId);
    if (!chatId) return { ok: false, reason: 'no_chat' };

    var owner = findOwnerByChatId(chatId, deps.contacts);
    if (!isAuthorizedOwner(owner)) {
      var denied = { chatId: chatId, text: COPY.NO_ACCESS };
      dispatchReplies_([denied], deps, callbackQueryId);
      return { ok: true, authorized: false, replies: [denied] };
    }

    var replies = [];
    var session = getSession(chatId);
    if (session && isSessionExpired(session, deps.nowMs)) {
      clearSession(chatId);
      session = null;
      if (callbackData || (text && text.charAt(0) !== '/')) {
        replies.push({
          chatId: chatId,
          text: COPY.SESSION_EXPIRED,
          replyMarkup: mainMenuKeyboard(),
        });
        dispatchReplies_(replies, deps, callbackQueryId);
        return { ok: true, authorized: true, replies: replies, owner: owner };
      }
    }

    // Global cancel / menu / ayuda — interrumpen cualquier flujo
    var parsed = parseCommand_(text);
    if (
      callbackData === CB.CANCEL ||
      parsed.cmd === 'cancelar' ||
      parsed.cmd === 'cancel'
    ) {
      clearSession(chatId);
      replies.push(replyMenu_(chatId, COPY.CANCELLED));
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }
    if (
      parsed.cmd === 'start' ||
      parsed.cmd === 'menu' ||
      callbackData === CB.MENU
    ) {
      replies.push(handleStart_(chatId));
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }
    if (parsed.cmd === 'ayuda' || parsed.cmd === 'help' || callbackData === CB.HELP) {
      clearSession(chatId);
      replies.push({
        chatId: chatId,
        text: COPY.HELP,
        replyMarkup: mainMenuKeyboard(),
      });
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }

    // Active multi-step flows consume input first
    if (session && session.flow === 'ecogas' && session.step === 'ask_comprobante') {
      if (!callbackData) {
        replies.push(handleEcogasComprobante_(chatId, text, deps));
        dispatchReplies_(replies, deps, callbackQueryId);
        return { ok: true, authorized: true, replies: replies, owner: owner };
      }
    }
    if (session && session.flow === 'history' && session.step === 'ask_period') {
      if (callbackData === CB.HISTORY_PREV) {
        replies.push(
          handleHistoryPeriod_(chatId, CM.Dates.previousBillingPeriod())
        );
      } else if (!callbackData) {
        replies.push(handleHistoryPeriod_(chatId, text));
      } else {
        replies.push({
          chatId: chatId,
          text: COPY.ASK_HISTORY,
          replyMarkup: historyKeyboard(),
        });
      }
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }
    if (session && session.flow === 'mark_paid') {
      if (session.step === 'ask_period') {
        if (callbackData === CB.PAID_CUR) {
          replies.push(handleMarkPaidPeriod_(chatId, CM.Dates.currentBillingPeriod()));
        } else if (callbackData === CB.PAID_PREV) {
          replies.push(
            handleMarkPaidPeriod_(chatId, CM.Dates.previousBillingPeriod())
          );
        } else if (!callbackData && text) {
          var hp = CM.Dates.normalizeBillingPeriod(text);
          if (hp) replies.push(handleMarkPaidPeriod_(chatId, hp));
          else
            replies.push({
              chatId: chatId,
              text: COPY.ASK_MARK_PAID_PERIOD,
              replyMarkup: markPaidPeriodKeyboard(),
            });
        }
        dispatchReplies_(replies, deps, callbackQueryId);
        return { ok: true, authorized: true, replies: replies, owner: owner };
      }
      if (session.step === 'pick' && callbackData.indexOf(CB.PAY_PICK) === 0) {
        var idx = parseInt(callbackData.slice(CB.PAY_PICK.length), 10);
        replies.push(handleMarkPaidPick_(chatId, idx, deps));
        dispatchReplies_(replies, deps, callbackQueryId);
        return { ok: true, authorized: true, replies: replies, owner: owner };
      }
    }
    if (session && session.flow === 'add_property') {
      var adv = advanceAddProperty(
        session,
        { text: text, callback: callbackData },
        deps
      );
      if (adv.done) clearSession(chatId);
      else if (adv.session) setSession(chatId, adv.session);
      replies.push({
        chatId: chatId,
        text: adv.reply.text,
        replyMarkup: adv.reply.replyMarkup,
      });
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }

    // Menu / commands / callbacks (start/ayuda ya se manejaron arriba)
    if (
      parsed.cmd === 'mes' ||
      callbackData === CB.MONTH
    ) {
      replies.push(handleMonth_(chatId));
    } else if (parsed.cmd === 'historico' || parsed.cmd === 'historial' || callbackData === CB.HISTORY) {
      replies.push(handleHistoryStart_(chatId));
    } else if (callbackData === CB.HISTORY_PREV) {
      replies.push(handleHistoryPeriod_(chatId, CM.Dates.previousBillingPeriod()));
    } else if (parsed.cmd === 'ecogas' || parsed.cmd === 'gas' || callbackData === CB.ECOGAS) {
      replies.push(handleEcogasStart_(chatId));
    } else if (parsed.cmd === 'pagada' || parsed.cmd === 'pago' || callbackData === CB.PAID) {
      replies.push(handleMarkPaidStart_(chatId));
    } else if (callbackData === CB.PAID_CUR) {
      replies.push(handleMarkPaidPeriod_(chatId, CM.Dates.currentBillingPeriod()));
    } else if (callbackData === CB.PAID_PREV) {
      replies.push(handleMarkPaidPeriod_(chatId, CM.Dates.previousBillingPeriod()));
    } else if (parsed.cmd === 'propiedad' || callbackData === CB.ADD) {
      replies.push(addPropertyStart_(chatId));
    } else if (callbackData === CB.PENDING || parsed.cmd === 'pendientes') {
      replies.push(handlePending_(chatId));
    } else if (callbackData === CB.DL_OSSE) {
      replies.push(handleDownloadNow_(chatId, 'osse', deps));
    } else if (callbackData === CB.DL_NAT) {
      replies.push(handleDownloadNow_(chatId, 'naturgy', deps));
    } else if (callbackData === CB.DL_MUNI) {
      replies.push(handleDownloadNow_(chatId, 'municipalidad', deps));
    } else if (callbackData === CB.PREVIEW || parsed.cmd === 'preview') {
      replies.push(handlePreviewNotify_(chatId, deps));
    } else if (callbackData.indexOf(CB.PAY_PICK) === 0) {
      // Orphan pick without session
      replies.push(replyMenu_(chatId, COPY.SESSION_EXPIRED));
    } else if (text || callbackData) {
      replies.push({
        chatId: chatId,
        text: COPY.UNKNOWN,
        replyMarkup: mainMenuKeyboard(),
      });
    } else {
      replies.push(handleStart_(chatId));
    }

    dispatchReplies_(replies, deps, callbackQueryId);
    return { ok: true, authorized: true, replies: replies, owner: owner };
  }

  function dispatchReplies_(replies, deps, callbackQueryId) {
    if (deps && deps.silent) return;
    if (callbackQueryId && CM.Telegram && CM.Telegram.answerCallbackQuery) {
      try {
        CM.Telegram.answerCallbackQuery(callbackQueryId);
      } catch (e) {
        /* ignore */
      }
    }
    (replies || []).forEach(function (r) {
      if (!r || !r.chatId) return;
      try {
        CM.Telegram.replyToChat(r.chatId, r.text, r.replyMarkup);
      } catch (e2) {
        try {
          CM.Logging.warn('telegramBot.reply', String(e2));
        } catch (e3) {
          /* ignore */
        }
      }
    });
  }

  /**
   * Entrypoint Apps Script doPost.
   * @param {object} e evento GAS
   */
  function handleDoPost(e) {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw) {
      return jsonOutput_({ ok: false, reason: 'empty' });
    }
    var update;
    try {
      update = JSON.parse(raw);
    } catch (err) {
      return jsonOutput_({ ok: false, reason: 'bad_json' });
    }
    try {
      var result = handleUpdate(update);
      return jsonOutput_({ ok: true, authorized: result.authorized !== false });
    } catch (err2) {
      try {
        CM.Logging.error('telegramBot.doPost', String(err2));
      } catch (e2) {
        /* ignore */
      }
      return jsonOutput_({ ok: false, reason: 'handler_error' });
    }
  }

  function jsonOutput_(obj) {
    if (typeof ContentService !== 'undefined') {
      return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    return obj;
  }

  /** Audit helper: ¿el texto tiene jerga técnica prohibida? */
  function containsTechnicalJargon(text) {
    var t = String(text || '');
    var banned = [
      /\binvoice_id\b/i,
      /\bproperty_id\b/i,
      /\bScript Properties?\b/i,
      /\bUrlFetch\b/i,
      /\bpayment_status\b/i,
      /\bcallback_data\b/i,
      /\bWEBHOOK\b/,
      /\bdoPost\b/,
      /\bPP\b/,
      /\bpp\b/,
      /\bOUTCOME_/i,
      /\bunsupported_municipio\b/i,
    ];
    for (var i = 0; i < banned.length; i++) {
      if (banned[i].test(t)) return true;
    }
    // "pp" as Ecogas form field mention
    if (/\bform field\b/i.test(t)) return true;
    return false;
  }

  return {
    COPY: COPY,
    CB: CB,
    SESSION_TTL_MS: SESSION_TTL_MS,
    findOwnerByChatId: findOwnerByChatId,
    isAuthorizedOwner: isAuthorizedOwner,
    providerLabelEs: providerLabelEs,
    paymentStatusLabelEs: paymentStatusLabelEs,
    formatAmountEs: formatAmountEs,
    formatMonthListing: formatMonthListing,
    formatHistoryListing: formatHistoryListing,
    formatEcogasResult: formatEcogasResult,
    formatMarkPaidResult: formatMarkPaidResult,
    formatAddPropertyResultFriendly: formatAddPropertyResultFriendly,
    mainMenuKeyboard: mainMenuKeyboard,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    isSessionExpired: isSessionExpired,
    advanceAddProperty: advanceAddProperty,
    handleUpdate: handleUpdate,
    handleDoPost: handleDoPost,
    containsTechnicalJargon: containsTechnicalJargon,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.TelegramBot;
}
