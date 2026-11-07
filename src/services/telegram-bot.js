/**
 * Bot Telegram ops — solo propietarios (Contacts role=owner, active, chat_id).
 * Multi-casa: Inicio → Mis casas → hub de esa casa (acciones filtradas).
 * Copy amigable en español; sin jerga técnica en mensajes al usuario.
 * Entrada preferida: polling 1 min (getUpdates + offset) → handleUpdate.
 * doPost webhook queda opcional / no usado por default.
 */

var CM = CM || {};
CM.TelegramBot = (function () {
  var SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
  var EXPECTED_PROVIDERS = ['naturgy', 'decsa', 'ecogas', 'osse', 'municipalidad'];

  var COPY = {
    NO_ACCESS: 'No tenés acceso a este bot.',
    CANCELLED: 'Listo, cancelé lo que estabas haciendo.',
    SESSION_EXPIRED: 'Se venció el tiempo de espera. Empezá de nuevo desde el menú.',
    UNKNOWN: 'No entendí eso. Tocá una opción del menú o escribí /ayuda.',
    HELP:
      'Soy el asistente del propietario para CasitasManager.\n\n' +
      'Primero elegí una casa (Mis casas) y después:\n' +
      '• Ver las facturas del mes\n' +
      '• Revisar un mes anterior\n' +
      '• Cargar el gas con el número de comprobante\n' +
      '• Marcar una factura como pagada\n' +
      '• Descargar los servicios de esa casa\n\n' +
      'Desde Inicio también podés agregar una propiedad o ver pagos pendientes de todas las casas.\n\n' +
      'Escribí /menu o /cancelar cuando quieras.',
    WELCOME:
      'Hola. Este bot es solo para el propietario.\n' +
      'Elegí una opción:',
    NO_HOUSES:
      'Todavía no hay casas cargadas.\n' +
      'Usá «Agregar propiedad» para dar de alta la primera.',
    PICK_HOUSE: '¿Sobre qué casa querés trabajar?',
    NEED_HOUSE:
      'Primero elegí una casa con «Mis casas».',
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
    ASK_DECSA_ACCOUNT:
      'DECSA — código de suministro / cuenta (newKey, ej. 1063):',
    ASK_DECSA_TITULAR:
      'DECSA — número de titular / asociado (newAccount, ej. 948):',
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
    HOUSES: 'm:houses',
    PICK_PROP: 'm:prop:', // + property_id
    HUB: 'm:hub',
    CHANGE: 'm:change',
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
    DL_DECSA: 'm:dl:decsa',
    DL_MUNI: 'm:dl:municipalidad',
    DL_YES: 'm:dly:', // + provider
    PENDING_ALL: 'm:pending',
    PENDING_PROP: 'm:pend:prop',
    PREVIEW: 'm:preview',
    SVC_TOGGLE: 'ap:svc:', // + provider
    SVC_DONE: 'ap:svc:done',
    CONTACT_OWNER: 'ap:role:owner',
    CONTACT_TENANT: 'ap:role:tenant',
    MORE_YES: 'ap:more:yes',
    MORE_NO: 'ap:more:no',
    PAY_PICK: 'pay:', // + index
  };

  var DL_CALLBACK = {
    osse: CB.DL_OSSE,
    naturgy: CB.DL_NAT,
    decsa: CB.DL_DECSA,
    municipalidad: CB.DL_MUNI,
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
    if (p === 'decsa') return 'DECSA (luz+agua)';
    if (p === 'ecogas') return 'gas';
    if (p === 'osse') return 'agua';
    if (p === 'municipalidad') return 'municipalidad';
    return p || 'servicio';
  }

  function downloadButtonLabel_(provider) {
    var p = String(provider || '').toLowerCase();
    if (p === 'osse') return 'Descargar agua';
    if (p === 'naturgy') return 'Descargar luz';
    if (p === 'decsa') return 'Descargar DECSA';
    if (p === 'municipalidad') return 'Descargar municipalidad';
    return 'Descargar ' + providerLabelEs(p);
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

  function propertyDisplayName_(prop) {
    if (!prop) return 'esta casa';
    return String(prop.property_name || prop.name || 'esta casa').trim() || 'esta casa';
  }

  function servicesSummaryEs_(providers) {
    var labels = (providers || []).map(providerLabelEs);
    if (!labels.length) return 'sin servicios';
    return labels.join(', ');
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
    var house = options.propertyName || '';
    if (house) {
      lines.push(house + ' · ' + label);
    } else {
      lines.push('Facturas — ' + label);
    }
    lines.push('');

    var list = invoices || [];
    if (!list.length) {
      lines.push('Todavía no hay facturas cargadas para este mes.');
      lines.push('Cuando bajemos alguna, va a aparecer acá.');
      return {
        text: lines.join('\n'),
        total: null,
        period: p,
        missing: (options.expectedProviders || EXPECTED_PROVIDERS).slice(),
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

  function formatHistoryListing(invoices, period, options) {
    var formatted = formatMonthListing(invoices, period, Object.assign({
      expectedProviders: [],
    }, options || {}));
    if (!formatted.count) {
      var label = CM.Dates.formatPeriodLabelEs(
        CM.Dates.normalizeBillingPeriod(period)
      );
      var house = options && options.propertyName ? options.propertyName + ' · ' : '';
      return {
        text:
          'No hay facturas guardadas para ' +
          house +
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

  function formatPendingGrouped_(unpaid, properties) {
    var nameById = {};
    (properties || []).forEach(function (p) {
      if (p && p.property_id) {
        nameById[String(p.property_id)] = propertyDisplayName_(p);
      }
    });
    var groups = {};
    var order = [];
    (unpaid || []).forEach(function (inv) {
      var pid = String(inv.property_id || '') || '_';
      if (!groups[pid]) {
        groups[pid] = [];
        order.push(pid);
      }
      groups[pid].push(inv);
    });
    var lines = ['Pagos pendientes:'];
    if (order.length > 1 || (order.length === 1 && order[0] !== '_')) {
      order.forEach(function (pid) {
        var title =
          pid === '_'
            ? 'Sin casa asignada'
            : nameById[pid] || 'Casa';
        lines.push('');
        lines.push(title);
        groups[pid].forEach(function (inv) {
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
      });
    } else {
      (unpaid || []).forEach(function (inv) {
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
    }
    return lines.join('\n');
  }

  /* ─── Keyboards ────────────────────────────────────────────────────── */

  function homeMenuKeyboard() {
    var B = CM.Telegram.inlineButton;
    return CM.Telegram.inlineKeyboard([
      [B('Mis casas', CB.HOUSES)],
      [B('Agregar propiedad', CB.ADD)],
      [B('Pagos pendientes', CB.PENDING_ALL), B('Ayuda', CB.HELP)],
    ]);
  }

  /** @deprecated use homeMenuKeyboard — alias for older tests/callers */
  function mainMenuKeyboard() {
    return homeMenuKeyboard();
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
      [B(mark('naturgy', 'Luz (Naturgy)'), CB.SVC_TOGGLE + 'naturgy')],
      [B(mark('decsa', 'DECSA Caucete (luz+agua)'), CB.SVC_TOGGLE + 'decsa')],
      [B(mark('ecogas', 'Gas'), CB.SVC_TOGGLE + 'ecogas')],
      [B(mark('osse', 'Agua (OSSE)'), CB.SVC_TOGGLE + 'osse')],
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

  function pickPropertyKeyboard(properties) {
    var B = CM.Telegram.inlineButton;
    var rows = (properties || []).map(function (p) {
      return [B(propertyDisplayName_(p), CB.PICK_PROP + String(p.property_id))];
    });
    rows.push([B('← Volver', CB.MENU)]);
    return CM.Telegram.inlineKeyboard(rows);
  }

  /**
   * Hub de casa: botones según servicios enabled de esa property.
   * @param {string[]} providers
   */
  function propertyHubKeyboard(providers) {
    var B = CM.Telegram.inlineButton;
    var rows = [
      [B('Mes en curso', CB.MONTH), B('Mes anterior', CB.HISTORY)],
    ];
    var has = {};
    (providers || []).forEach(function (p) {
      has[String(p).toLowerCase()] = true;
    });
    if (has.ecogas) {
      rows.push([B('Cargar gas (comprobante)', CB.ECOGAS)]);
    }
    rows.push([
      B('Marcar pagada', CB.PAID),
      B('Pagos pendientes', CB.PENDING_PROP),
    ]);
    var dlOrder = ['osse', 'naturgy', 'decsa', 'municipalidad'];
    var dlRow = [];
    dlOrder.forEach(function (p) {
      if (!has[p] || !DL_CALLBACK[p]) return;
      dlRow.push(B(downloadButtonLabel_(p), DL_CALLBACK[p]));
      if (dlRow.length === 2) {
        rows.push(dlRow);
        dlRow = [];
      }
    });
    if (dlRow.length) rows.push(dlRow);
    rows.push([B('Cambiar de casa', CB.CHANGE), B('Inicio', CB.MENU)]);
    return CM.Telegram.inlineKeyboard(rows);
  }

  function monthActionsKeyboard(providers) {
    var B = CM.Telegram.inlineButton;
    var rows = [];
    var has = {};
    (providers || []).forEach(function (p) {
      has[String(p).toLowerCase()] = true;
    });
    var top = [];
    if (has.ecogas) top.push(B('Cargar gas', CB.ECOGAS));
    top.push(B('Marcar pagada', CB.PAID));
    rows.push(top);
    rows.push([B('← Hub de casa', CB.HUB)]);
    return CM.Telegram.inlineKeyboard(rows);
  }

  function confirmDownloadKeyboard(provider) {
    var B = CM.Telegram.inlineButton;
    return CM.Telegram.inlineKeyboard([
      [
        B('Sí, descargar', CB.DL_YES + String(provider)),
        B('Cancelar', CB.CANCEL),
      ],
    ]);
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

  /**
   * Actualiza sesión preservando casa seleccionada (salvo que partial la limpie).
   */
  function patchSession(chatId, partial) {
    var cur = getSession(chatId) || {};
    var next = Object.assign({}, cur, partial || {});
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'selectedPropertyId')) {
      next.selectedPropertyId = partial.selectedPropertyId;
      next.selectedPropertyName = partial.selectedPropertyName;
    }
    return setSession(chatId, next);
  }

  function clearFlowKeepProperty_(chatId) {
    var cur = getSession(chatId) || {};
    var keep = {
      selectedPropertyId: cur.selectedPropertyId || null,
      selectedPropertyName: cur.selectedPropertyName || null,
    };
    if (!keep.selectedPropertyId) {
      clearSession(chatId);
      return null;
    }
    return setSession(chatId, keep);
  }

  function isSessionExpired(session, nowMs) {
    if (!session || !session.updatedAt) return true;
    var now = nowMs != null ? nowMs : Date.now();
    return now - Number(session.updatedAt) > SESSION_TTL_MS;
  }

  /* ─── Property helpers ─────────────────────────────────────────────── */

  function listProperties_(deps) {
    if (deps && deps.properties) return deps.properties.slice();
    try {
      return CM.Sheets.listActiveProperties();
    } catch (e) {
      return [];
    }
  }

  function listServices_(deps) {
    if (deps && deps.services) return deps.services.slice();
    try {
      return CM.Sheets.list(CM.Sheets.SHEET_NAMES.SERVICES) || [];
    } catch (e) {
      return [];
    }
  }

  function findPropertyById_(propertyId, deps) {
    var want = String(propertyId || '').trim();
    if (!want) return null;
    var props = listProperties_(deps);
    for (var i = 0; i < props.length; i++) {
      if (String(props[i].property_id) === want) return props[i];
    }
    return null;
  }

  function providersForProperty_(propertyId, deps) {
    if (deps && typeof deps.providersForProperty === 'function') {
      return deps.providersForProperty(propertyId) || [];
    }
    try {
      return CM.Sheets.listEnabledProvidersForProperty(
        propertyId,
        listServices_(deps)
      );
    } catch (e) {
      return [];
    }
  }

  function getSelectedProperty(chatId, deps) {
    var session = getSession(chatId);
    if (!session || !session.selectedPropertyId) return null;
    var prop = findPropertyById_(session.selectedPropertyId, deps);
    if (prop) return prop;
    // Session name fallback if sheet missing in tests
    if (session.selectedPropertyName) {
      return {
        property_id: session.selectedPropertyId,
        property_name: session.selectedPropertyName,
        active: true,
      };
    }
    return null;
  }

  function selectProperty(chatId, property) {
    if (!property || !property.property_id) return null;
    return setSession(chatId, {
      selectedPropertyId: String(property.property_id),
      selectedPropertyName: propertyDisplayName_(property),
    });
  }

  /**
   * Si hay 1 casa activa → la selecciona; si hay varias → null (hay que elegir);
   * si 0 → null.
   */
  function autoSelectIfOneProperty(chatId, deps) {
    var props = listProperties_(deps);
    if (props.length === 1) {
      selectProperty(chatId, props[0]);
      return props[0];
    }
    return null;
  }

  function hubText_(property, providers) {
    var name = propertyDisplayName_(property);
    var city = String((property && property.city) || '').trim();
    var svc = servicesSummaryEs_(providers);
    var lines = [name];
    if (city) lines.push(city + ' · servicios: ' + svc);
    else lines.push('Servicios: ' + svc);
    return lines.join('\n');
  }

  function replyHome_(chatId, text) {
    return {
      chatId: chatId,
      text: text || COPY.WELCOME,
      replyMarkup: homeMenuKeyboard(),
    };
  }

  function replyHub_(chatId, property, deps, text) {
    var providers = providersForProperty_(property.property_id, deps);
    return {
      chatId: chatId,
      text: text || hubText_(property, providers),
      replyMarkup: propertyHubKeyboard(providers),
    };
  }

  function replyAfterAction_(chatId, text, deps) {
    var prop = getSelectedProperty(chatId, deps);
    if (prop) return replyHub_(chatId, prop, deps, text);
    return replyHome_(chatId, text);
  }

  /* ─── Data helpers ─────────────────────────────────────────────────── */

  function listInvoicesForPeriod_(period, propertyId) {
    var invs = CM.Invoices.listForPeriod(period);
    if (!propertyId) return invs;
    var want = String(propertyId);
    return (invs || []).filter(function (inv) {
      return String(inv.property_id || '') === want;
    });
  }

  function listUnpaidForPeriod_(period, propertyId) {
    var invs = listInvoicesForPeriod_(period, propertyId);
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

  function listUnpaidForProperty_(propertyId) {
    try {
      var all = CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES) || [];
      var want = String(propertyId || '');
      var filtered = (all || []).filter(function (inv) {
        return String(inv.property_id || '') === want;
      });
      return CM.Payments.listUnpaidForMenu(filtered, 12);
    } catch (e) {
      return [];
    }
  }

  /* ─── Flow handlers ────────────────────────────────────────────────── */

  function handleStart_(chatId) {
    var cur = getSession(chatId) || {};
    clearSession(chatId);
    if (cur.selectedPropertyId) {
      setSession(chatId, {
        selectedPropertyId: cur.selectedPropertyId,
        selectedPropertyName: cur.selectedPropertyName || null,
      });
    }
    return replyHome_(chatId, COPY.WELCOME);
  }

  function handleHouses_(chatId, deps) {
    var props = listProperties_(deps);
    if (!props.length) {
      return replyHome_(chatId, COPY.NO_HOUSES);
    }
    if (props.length === 1) {
      selectProperty(chatId, props[0]);
      return replyHub_(chatId, props[0], deps);
    }
    return {
      chatId: chatId,
      text: COPY.PICK_HOUSE,
      replyMarkup: pickPropertyKeyboard(props),
    };
  }

  function handlePickProperty_(chatId, propertyId, deps) {
    var prop = findPropertyById_(propertyId, deps);
    if (!prop) {
      return replyHome_(chatId, 'No encontré esa casa. Probá de nuevo con «Mis casas».');
    }
    selectProperty(chatId, prop);
    return replyHub_(chatId, prop, deps);
  }

  function handleHub_(chatId, deps) {
    var prop = getSelectedProperty(chatId, deps);
    if (!prop) return handleHouses_(chatId, deps);
    return replyHub_(chatId, prop, deps);
  }

  function requirePropertyOrAsk_(chatId, deps) {
    var prop = getSelectedProperty(chatId, deps);
    if (prop) return { property: prop };
    var only = autoSelectIfOneProperty(chatId, deps);
    if (only) return { property: only };
    var props = listProperties_(deps);
    if (!props.length) {
      return { reply: replyHome_(chatId, COPY.NO_HOUSES) };
    }
    return {
      reply: {
        chatId: chatId,
        text: COPY.NEED_HOUSE + '\n\n' + COPY.PICK_HOUSE,
        replyMarkup: pickPropertyKeyboard(props),
      },
    };
  }

  function handleMonth_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    var period = CM.Dates.currentBillingPeriod();
    var providers = providersForProperty_(prop.property_id, deps);
    var invs = listInvoicesForPeriod_(period, prop.property_id);
    var formatted = formatMonthListing(invs, period, {
      propertyName: propertyDisplayName_(prop),
      expectedProviders: providers.length ? providers : EXPECTED_PROVIDERS,
    });
    return {
      chatId: chatId,
      text: formatted.text,
      replyMarkup: monthActionsKeyboard(providers),
    };
  }

  function handlePendingAll_(chatId, deps) {
    var unpaid = listAllUnpaid_();
    if (!unpaid.length) {
      return replyHome_(chatId, 'No hay pagos pendientes.');
    }
    var text = formatPendingGrouped_(unpaid, listProperties_(deps));
    return { chatId: chatId, text: text, replyMarkup: homeMenuKeyboard() };
  }

  function handlePendingProp_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    var unpaid = listUnpaidForProperty_(prop.property_id);
    if (!unpaid.length) {
      return replyHub_(
        chatId,
        prop,
        deps,
        'No hay pagos pendientes en ' + propertyDisplayName_(prop) + '.'
      );
    }
    var lines = [
      'Pagos pendientes — ' + propertyDisplayName_(prop) + ':',
    ];
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
    return replyHub_(chatId, prop, deps, lines.join('\n'));
  }

  function handleHistoryStart_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    patchSession(chatId, {
      flow: 'history',
      step: 'ask_period',
      data: {},
      selectedPropertyId: req.property.property_id,
      selectedPropertyName: propertyDisplayName_(req.property),
    });
    return {
      chatId: chatId,
      text: COPY.ASK_HISTORY,
      replyMarkup: historyKeyboard(),
    };
  }

  function handleHistoryPeriod_(chatId, periodRaw, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var period = CM.Dates.normalizeBillingPeriod(periodRaw);
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return {
        chatId: chatId,
        text: 'No reconocí el mes. Probá con 2026-10 o «octubre 2026».',
        replyMarkup: historyKeyboard(),
      };
    }
    clearFlowKeepProperty_(chatId);
    var prop = req.property;
    var invs = listInvoicesForPeriod_(period, prop.property_id);
    var formatted = formatHistoryListing(invs, period, {
      propertyName: propertyDisplayName_(prop),
    });
    return replyHub_(chatId, prop, deps, formatted.text);
  }

  function handleEcogasStart_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    patchSession(chatId, {
      flow: 'ecogas',
      step: 'ask_comprobante',
      data: {},
      selectedPropertyId: prop.property_id,
      selectedPropertyName: propertyDisplayName_(prop),
    });
    var text =
      'Casa: ' +
      propertyDisplayName_(prop) +
      '\n\n' +
      COPY.ASK_ECOGAS;
    return {
      chatId: chatId,
      text: text,
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
    var prop = getSelectedProperty(chatId, deps);
    var propertyId = prop && prop.property_id;
    clearFlowKeepProperty_(chatId);
    var downloadFn =
      (deps && deps.downloadEcogas) ||
      function (comp, pid) {
        if (typeof downloadEcogasSessionInvoice === 'function') {
          return downloadEcogasSessionInvoice({
            pp: comp,
            propertyId: pid || undefined,
          });
        }
        return { ok: false };
      };
    var result;
    try {
      result = downloadFn(comprobante, propertyId);
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e) };
    }
    var formatted = formatEcogasResult(result);
    return replyAfterAction_(chatId, formatted.text, deps);
  }

  function handleMarkPaidStart_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    patchSession(chatId, {
      flow: 'mark_paid',
      step: 'ask_period',
      data: {},
      selectedPropertyId: req.property.property_id,
      selectedPropertyName: propertyDisplayName_(req.property),
    });
    return {
      chatId: chatId,
      text: COPY.ASK_MARK_PAID_PERIOD,
      replyMarkup: markPaidPeriodKeyboard(),
    };
  }

  function handleMarkPaidPeriod_(chatId, period, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    var unpaid = listUnpaidForPeriod_(period, prop.property_id);
    if (!unpaid.length) {
      clearFlowKeepProperty_(chatId);
      return replyHub_(chatId, prop, deps, COPY.NO_UNPAID);
    }
    patchSession(chatId, {
      flow: 'mark_paid',
      step: 'pick',
      data: {
        period: period,
        ids: unpaid.map(function (u) {
          return u.invoice_id;
        }),
      },
      selectedPropertyId: prop.property_id,
      selectedPropertyName: propertyDisplayName_(prop),
    });
    var label = CM.Dates.formatPeriodLabelEs(period);
    return {
      chatId: chatId,
      text:
        propertyDisplayName_(prop) +
        ' · facturas sin pagar de ' +
        label +
        '. Tocá una:',
      replyMarkup: unpaidKeyboard(unpaid),
    };
  }

  function handleMarkPaidPick_(chatId, index, deps) {
    var session = getSession(chatId);
    if (!session || session.flow !== 'mark_paid' || !session.data) {
      clearFlowKeepProperty_(chatId);
      return replyAfterAction_(chatId, COPY.SESSION_EXPIRED, deps);
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
    clearFlowKeepProperty_(chatId);
    return replyAfterAction_(chatId, formatMarkPaidResult(result, inv), deps);
  }

  function handleDownloadAsk_(chatId, providerId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    var providers = providersForProperty_(prop.property_id, deps);
    if (providers.indexOf(providerId) < 0) {
      return replyHub_(
        chatId,
        prop,
        deps,
        'Esta casa no tiene ' + providerLabelEs(providerId) + '.'
      );
    }
    var label = providerLabelEs(providerId);
    var article =
      label === 'municipalidad'
        ? 'la municipalidad'
        : providerId === 'decsa'
          ? 'DECSA (luz+agua)'
          : 'la ' + label;
    return {
      chatId: chatId,
      text:
        'Voy a descargar ' +
        article +
        ' de ' +
        propertyDisplayName_(prop) +
        '. ¿Confirmás?',
      replyMarkup: confirmDownloadKeyboard(providerId),
    };
  }

  function handleDownloadConfirm_(chatId, providerId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
    var label = providerLabelEs(providerId);
    var propertyId = prop.property_id;
    var downloadFn =
      (deps && deps.downloadProvider) ||
      function (id, pid) {
        if (typeof downloadProviderInvoice_ === 'function') {
          return downloadProviderInvoice_(id, { propertyId: pid });
        }
        if (typeof downloadProviderInvoice === 'function') {
          return downloadProviderInvoice(id, { propertyId: pid });
        }
        return { ok: false };
      };
    var result;
    try {
      result = downloadFn(providerId, propertyId);
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e) };
    }
    var ok = !!(result && (result.autoPdf || result.ok || result.metadataOnly));
    var article =
      label === 'municipalidad'
        ? 'la municipalidad'
        : providerId === 'decsa'
          ? 'DECSA (luz+agua)'
          : 'la ' + label;
    var text = ok
      ? 'Listo: intenté descargar ' +
        article +
        ' de ' +
        propertyDisplayName_(prop) +
        '.'
      : 'No pude descargar ' +
        label +
        ' de ' +
        propertyDisplayName_(prop) +
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
    return replyHub_(chatId, prop, deps, text);
  }

  function handlePreviewNotify_(chatId, deps) {
    var req = requirePropertyOrAsk_(chatId, deps);
    if (req.reply) return req.reply;
    var prop = req.property;
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
      return replyHub_(
        chatId,
        prop,
        deps,
        'No pude armar la vista previa. Probá más tarde.'
      );
    }
    var report = (preview && preview.report) || preview || {};
    var items = (report.items || []).filter(function (it) {
      if (!it) return false;
      if (!prop.property_id) return true;
      if (it.property_id == null || it.property_id === '') return true;
      return String(it.property_id) === String(prop.property_id);
    });
    var lines = [
      'Vista previa del aviso — ' +
        propertyDisplayName_(prop) +
        ' · ' +
        CM.Dates.formatPeriodLabelEs(period),
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
      if (report.total != null && items.length === (report.items || []).length) {
        lines.push('');
        lines.push('Total: ' + formatAmountEs(report.total));
      }
    }
    return replyHub_(chatId, prop, deps, lines.join('\n'));
  }

  /* ─── Add property state machine ───────────────────────────────────── */

  function addPropertyStart_(chatId) {
    var cur = getSession(chatId) || {};
    setSession(chatId, {
      flow: 'add_property',
      step: 'name',
      data: { servicesSelected: {}, services: [], contacts: [] },
      selectedPropertyId: cur.selectedPropertyId || null,
      selectedPropertyName: cur.selectedPropertyName || null,
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
    if (next === 'decsa') {
      session.step = 'svc_decsa_account';
      return {
        session: session,
        reply: { text: COPY.ASK_DECSA_ACCOUNT, replyMarkup: cancelKeyboard() },
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
    if (step === 'svc_decsa_account') {
      svc.account_number = text === '-' ? '' : text;
      session.step = 'svc_decsa_titular';
      data._svc = svc;
      return {
        session: session,
        reply: { text: COPY.ASK_DECSA_TITULAR, replyMarkup: cancelKeyboard() },
      };
    }
    if (step === 'svc_decsa_titular') {
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
      if (text === '-') {
        svc.account_number = '';
      } else if (CM.Providers && CM.Providers.Osse && CM.Providers.Osse.accountDigits) {
        svc.account_number = CM.Providers.Osse.accountDigits(text);
      } else {
        svc.account_number = String(text || '').replace(/\D/g, '');
      }
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
        replyMarkup: homeMenuKeyboard(),
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
   * @param {object} update
   * @param {object} [deps] mocks: contacts, properties, services, downloadEcogas, …
   */
  function handleUpdate(update, deps) {
    deps = deps || {};
    update = update || {};

    var chatId = null;
    var text = '';
    var callbackData = '';
    var callbackQueryId = '';

    if (update.callback_query) {
      var cq = update.callback_query;
      chatId = cq.message && cq.message.chat && cq.message.chat.id;
      callbackData = String(cq.data || '');
      callbackQueryId = cq.id;
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
      var keptProp = {
        selectedPropertyId: session.selectedPropertyId || null,
        selectedPropertyName: session.selectedPropertyName || null,
      };
      clearSession(chatId);
      if (keptProp.selectedPropertyId) setSession(chatId, keptProp);
      session = getSession(chatId);
      if (callbackData || (text && text.charAt(0) !== '/')) {
        replies.push({
          chatId: chatId,
          text: COPY.SESSION_EXPIRED,
          replyMarkup: homeMenuKeyboard(),
        });
        dispatchReplies_(replies, deps, callbackQueryId);
        return { ok: true, authorized: true, replies: replies, owner: owner };
      }
    }

    var parsed = parseCommand_(text);
    if (
      callbackData === CB.CANCEL ||
      parsed.cmd === 'cancelar' ||
      parsed.cmd === 'cancel'
    ) {
      clearFlowKeepProperty_(chatId);
      var propAfterCancel = getSelectedProperty(chatId, deps);
      if (propAfterCancel) {
        replies.push(replyHub_(chatId, propAfterCancel, deps, COPY.CANCELLED));
      } else {
        replies.push(replyHome_(chatId, COPY.CANCELLED));
      }
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
      clearFlowKeepProperty_(chatId);
      replies.push({
        chatId: chatId,
        text: COPY.HELP,
        replyMarkup: homeMenuKeyboard(),
      });
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }

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
          handleHistoryPeriod_(chatId, CM.Dates.previousBillingPeriod(), deps)
        );
      } else if (!callbackData) {
        replies.push(handleHistoryPeriod_(chatId, text, deps));
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
          replies.push(handleMarkPaidPeriod_(chatId, CM.Dates.currentBillingPeriod(), deps));
        } else if (callbackData === CB.PAID_PREV) {
          replies.push(
            handleMarkPaidPeriod_(chatId, CM.Dates.previousBillingPeriod(), deps)
          );
        } else if (!callbackData && text) {
          var hp = CM.Dates.normalizeBillingPeriod(text);
          if (hp) replies.push(handleMarkPaidPeriod_(chatId, hp, deps));
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
      if (adv.done) {
        var keep = {
          selectedPropertyId: session.selectedPropertyId || null,
          selectedPropertyName: session.selectedPropertyName || null,
        };
        clearSession(chatId);
        if (keep.selectedPropertyId) setSession(chatId, keep);
      } else if (adv.session) setSession(chatId, adv.session);
      replies.push({
        chatId: chatId,
        text: adv.reply.text,
        replyMarkup: adv.reply.replyMarkup,
      });
      dispatchReplies_(replies, deps, callbackQueryId);
      return { ok: true, authorized: true, replies: replies, owner: owner };
    }

    if (callbackData === CB.HOUSES || parsed.cmd === 'casas') {
      replies.push(handleHouses_(chatId, deps));
    } else if (callbackData.indexOf(CB.PICK_PROP) === 0) {
      replies.push(
        handlePickProperty_(chatId, callbackData.slice(CB.PICK_PROP.length), deps)
      );
    } else if (callbackData === CB.HUB) {
      replies.push(handleHub_(chatId, deps));
    } else if (callbackData === CB.CHANGE) {
      // Forzar lista aunque haya una sola? wireframe: Cambiar de casa → pick.
      // Si hay una sola, hub de nuevo; si varias, pick.
      var propsChange = listProperties_(deps);
      if (propsChange.length <= 1) {
        replies.push(handleHouses_(chatId, deps));
      } else {
        replies.push({
          chatId: chatId,
          text: COPY.PICK_HOUSE,
          replyMarkup: pickPropertyKeyboard(propsChange),
        });
      }
    } else if (parsed.cmd === 'mes' || callbackData === CB.MONTH) {
      replies.push(handleMonth_(chatId, deps));
    } else if (
      parsed.cmd === 'historico' ||
      parsed.cmd === 'historial' ||
      callbackData === CB.HISTORY
    ) {
      replies.push(handleHistoryStart_(chatId, deps));
    } else if (callbackData === CB.HISTORY_PREV) {
      replies.push(
        handleHistoryPeriod_(chatId, CM.Dates.previousBillingPeriod(), deps)
      );
    } else if (
      parsed.cmd === 'ecogas' ||
      parsed.cmd === 'gas' ||
      callbackData === CB.ECOGAS
    ) {
      replies.push(handleEcogasStart_(chatId, deps));
    } else if (
      parsed.cmd === 'pagada' ||
      parsed.cmd === 'pago' ||
      callbackData === CB.PAID
    ) {
      replies.push(handleMarkPaidStart_(chatId, deps));
    } else if (callbackData === CB.PAID_CUR) {
      replies.push(handleMarkPaidPeriod_(chatId, CM.Dates.currentBillingPeriod(), deps));
    } else if (callbackData === CB.PAID_PREV) {
      replies.push(
        handleMarkPaidPeriod_(chatId, CM.Dates.previousBillingPeriod(), deps)
      );
    } else if (parsed.cmd === 'propiedad' || callbackData === CB.ADD) {
      replies.push(addPropertyStart_(chatId));
    } else if (callbackData === CB.PENDING_ALL || parsed.cmd === 'pendientes') {
      replies.push(handlePendingAll_(chatId, deps));
    } else if (callbackData === CB.PENDING_PROP) {
      replies.push(handlePendingProp_(chatId, deps));
    } else if (callbackData === CB.DL_OSSE) {
      replies.push(handleDownloadAsk_(chatId, 'osse', deps));
    } else if (callbackData === CB.DL_NAT) {
      replies.push(handleDownloadAsk_(chatId, 'naturgy', deps));
    } else if (callbackData === CB.DL_DECSA) {
      replies.push(handleDownloadAsk_(chatId, 'decsa', deps));
    } else if (callbackData === CB.DL_MUNI) {
      replies.push(handleDownloadAsk_(chatId, 'municipalidad', deps));
    } else if (callbackData.indexOf(CB.DL_YES) === 0) {
      replies.push(
        handleDownloadConfirm_(chatId, callbackData.slice(CB.DL_YES.length), deps)
      );
    } else if (callbackData === CB.PREVIEW || parsed.cmd === 'preview') {
      replies.push(handlePreviewNotify_(chatId, deps));
    } else if (callbackData.indexOf(CB.PAY_PICK) === 0) {
      replies.push(replyAfterAction_(chatId, COPY.SESSION_EXPIRED, deps));
    } else if (text || callbackData) {
      replies.push({
        chatId: chatId,
        text: COPY.UNKNOWN,
        replyMarkup: homeMenuKeyboard(),
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

  /* ─── Polling getUpdates (camino default) ──────────────────────────── */

  function getUpdateOffset() {
    var raw = CM.Settings.get(CM.Settings.KEYS.TG_BOT_UPDATE_OFFSET, '0');
    var n = parseInt(raw, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function setUpdateOffset(offset) {
    var n = parseInt(offset, 10);
    if (isNaN(n) || n < 0) n = 0;
    CM.Settings.set(CM.Settings.KEYS.TG_BOT_UPDATE_OFFSET, String(n));
    return n;
  }

  function nextOffsetFromUpdates(currentOffset, updates) {
    var next = currentOffset != null ? Number(currentOffset) : 0;
    if (isNaN(next) || next < 0) next = 0;
    var list = updates || [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      if (!u || u.update_id == null) continue;
      var id = Number(u.update_id);
      if (!isNaN(id) && id + 1 > next) next = id + 1;
    }
    return next;
  }

  function processUpdatesBatch(updates, deps) {
    deps = deps || {};
    var results = [];
    var errors = 0;
    (updates || []).forEach(function (update) {
      try {
        results.push(handleUpdate(update, deps));
      } catch (e) {
        errors++;
        results.push({
          ok: false,
          reason: 'handler_error',
          message: String(e && e.message ? e.message : e),
        });
        try {
          CM.Logging.warn('telegramBot.batch', String(e));
        } catch (e2) {
          /* ignore */
        }
      }
    });
    return { processed: results.length, results: results, errors: errors };
  }

  function pollUpdates(deps) {
    deps = deps || {};
    var offset =
      typeof deps.getOffset === 'function' ? deps.getOffset() : getUpdateOffset();

    var fetched;
    if (typeof deps.fetchUpdates === 'function') {
      fetched = deps.fetchUpdates(offset);
    } else {
      fetched = CM.Telegram.getUpdates({
        offset: offset,
        limit: deps.limit != null ? deps.limit : 50,
        timeout: deps.timeout != null ? deps.timeout : 0,
      });
    }

    if (!fetched || fetched.ok === false) {
      var failReason = (fetched && fetched.reason) || 'fetch_failed';
      try {
        CM.Logging.error('telegramBot.poll', failReason, {
          offset: offset,
          processed: 0,
        });
      } catch (eFail) {
        /* ignore */
      }
      return {
        ok: false,
        reason: failReason,
        offset: offset,
        processed: 0,
        nextOffset: offset,
      };
    }

    var updates = fetched.updates || [];
    var batch = processUpdatesBatch(updates, deps);
    var next = nextOffsetFromUpdates(offset, updates);

    if (typeof deps.setOffset === 'function') {
      deps.setOffset(next);
    } else {
      setUpdateOffset(next);
    }

    var loteDetails = {
      offset: offset,
      nextOffset: next,
      processed: batch.processed,
      errors: batch.errors,
    };
    // Empty idle polls (~1/min) must not spam Sheets ExecutionLog.
    // Logger (Apps Script / pollTelegramUpdates wrapper) is enough for quiet debug.
    if (batch.processed > 0 || batch.errors > 0) {
      try {
        CM.Logging.info('telegramBot.poll', 'lote', loteDetails);
      } catch (e) {
        /* ignore */
      }
    } else if (typeof Logger !== 'undefined') {
      try {
        Logger.log(
          '[info] telegramBot.poll: idle | ' + JSON.stringify(loteDetails)
        );
      } catch (eIdle) {
        /* ignore */
      }
    }

    return {
      ok: true,
      offset: offset,
      nextOffset: next,
      processed: batch.processed,
      errors: batch.errors,
      results: batch.results,
      updates: updates,
    };
  }

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
    homeMenuKeyboard: homeMenuKeyboard,
    mainMenuKeyboard: mainMenuKeyboard,
    propertyHubKeyboard: propertyHubKeyboard,
    pickPropertyKeyboard: pickPropertyKeyboard,
    getSession: getSession,
    setSession: setSession,
    patchSession: patchSession,
    clearSession: clearSession,
    isSessionExpired: isSessionExpired,
    getSelectedProperty: getSelectedProperty,
    selectProperty: selectProperty,
    autoSelectIfOneProperty: autoSelectIfOneProperty,
    advanceAddProperty: advanceAddProperty,
    handleUpdate: handleUpdate,
    handleDoPost: handleDoPost,
    getUpdateOffset: getUpdateOffset,
    setUpdateOffset: setUpdateOffset,
    nextOffsetFromUpdates: nextOffsetFromUpdates,
    processUpdatesBatch: processUpdatesBatch,
    pollUpdates: pollUpdates,
    containsTechnicalJargon: containsTechnicalJargon,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.TelegramBot;
}
