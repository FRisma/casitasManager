/**
 * Menú operador CasitasManager (español).
 *
 * Bound spreadsheet: onOpen() agrega el menú automáticamente.
 * Standalone: ejecutar installCasitasManagerMenu() una vez, o
 * installOnOpenMenuTrigger() para recrearlo al abrir el Sheet vinculado,
 * o llamar las funciones menu* desde el editor (dropdown Run).
 */

var CM_MENU_NAME = 'CasitasManager';

/**
 * Simple trigger: se ejecuta al abrir un Sheet bound a este proyecto.
 */
function onOpen() {
  buildCasitasManagerMenu_();
}

/**
 * Instala / refresca el menú (útil en standalone o tras push).
 * Si hay UI de spreadsheet, crea el menú; si no, loguea cómo usarlo.
 */
function installCasitasManagerMenu() {
  var built = buildCasitasManagerMenu_();
  logMenuResult_({
    ok: !!built,
    tip: built
      ? 'Menú "' + CM_MENU_NAME + '" listo en el spreadsheet.'
      : 'Sin SpreadsheetApp.getUi() (¿proyecto standalone?). ' +
        'Opciones: 1) Vincular el script al Sheet DEV y reabrir; ' +
        '2) installOnOpenMenuTrigger(); 3) correr menuDescargar* / menuProbarEnvio* desde el editor.',
  });
  return built;
}

/**
 * Trigger instalable onOpen → útil si el script es standalone pero tiene SPREADSHEET_ID.
 * Abrí el Sheet DEV; el menú aparece tras autorizar el trigger.
 */
function installOnOpenMenuTrigger() {
  removeOnOpenMenuTriggers_();
  var ssId = CM.Settings.get(CM.Settings.KEYS.SPREADSHEET_ID, '');
  if (!ssId) {
    var msg =
      'Falta SPREADSHEET_ID. Corré setupDevEnvironment() o vinculá el proyecto al Sheet.';
    logMenuResult_({ ok: false, message: msg });
    return { ok: false, message: msg };
  }
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ssId).onOpen().create();
  var out = {
    ok: true,
    spreadsheetId: ssId,
    tip: 'Reabrí el Sheet; debería aparecer el menú ' + CM_MENU_NAME + '.',
  };
  logMenuResult_(out);
  return out;
}

function removeOnOpenMenuTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onOpen' && t.getEventType() === ScriptApp.EventType.ON_OPEN) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function buildCasitasManagerMenu_() {
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getUi) return false;
    var ui = SpreadsheetApp.getUi();
    ui.createMenu(CM_MENU_NAME)
      .addItem('Descargar factura Ecogas', 'menuDescargarEcogas')
      .addItem('Descargar factura OSSE', 'menuDescargarOsse')
      .addItem('Descargar factura Naturgy', 'menuDescargarNaturgy')
      .addItem('Descargar factura Municipalidad', 'menuDescargarMunicipalidad')
      .addSeparator()
      .addItem('Probar envío solo a propietario', 'menuProbarEnvioOwner')
      .addItem('Probar envío solo a inquilino', 'menuProbarEnvioTenant')
      .addToUi();
    return true;
  } catch (e) {
    // Standalone / editor sin UI
    return false;
  }
}

/* ─── Descargas por proveedor ─────────────────────────────────────────── */

function menuDescargarEcogas() {
  return menuDescargarProveedor_('ecogas', 'Ecogas');
}

function menuDescargarOsse() {
  return menuDescargarProveedor_('osse', 'OSSE');
}

function menuDescargarNaturgy() {
  return menuDescargarProveedor_('naturgy', 'Naturgy');
}

function menuDescargarMunicipalidad() {
  return menuDescargarProveedor_('municipalidad', 'Municipalidad');
}

/**
 * Probe + fetch + intento de download. Si no hay PDF automático, mensaje claro
 * y camino importManualInvoice / FromDrive (sin inventar montos).
 */
function menuDescargarProveedor_(providerId, label) {
  notifyOperator_(
    'CasitasManager — ' + label,
    'Consultando portal… Revisá Execution log para el detalle.'
  );
  var result = downloadProviderInvoice_(providerId);
  presentDownloadResult_(label, result);
  return result;
}

function downloadProviderInvoice_(providerId) {
  providerId = String(providerId || '').toLowerCase();
  if (CM.ProviderInterface && CM.ProviderInterface.bootstrap) {
    CM.ProviderInterface.bootstrap();
  }
  var adapter = CM.ProviderInterface.get(providerId);
  if (!adapter) {
    return {
      ok: false,
      provider: providerId,
      outcome: 'error',
      message: 'Proveedor desconocido: ' + providerId,
      autoPdf: false,
      manualRequired: true,
    };
  }

  var service = null;
  try {
    // Preferir fila Services (account_number / portal_url vivos) si Sheets está listo
    var rows = CM.Sheets.list(CM.Sheets.SHEET_NAMES.SERVICES);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].provider).toLowerCase() === providerId) {
        service = rows[i];
        break;
      }
    }
  } catch (e) {
    service = null;
  }
  if (!service) {
    try {
      service = CM.ServiceCatalog.getByProvider(providerId);
    } catch (e2) {
      service = null;
    }
  }

  var period = CM.Dates.currentBillingPeriod();
  var status = adapter.getProviderStatus
    ? adapter.getProviderStatus(service)
    : adapter.checkAvailability(service);

  // Listar (período actual; adapters que ignoran options siguen OK)
  var fetched = adapter.fetchInvoices(service, { billingPeriod: period, limit: 12 });
  // Si el período actual no tiene ítems pero la API listó otros, re-fetch sin filtro
  if (
    fetched &&
    (!fetched.invoices || !fetched.invoices.length) &&
    fetched.outcome === CM.ProviderInterface.OUTCOME.INVOICE_NOT_AVAILABLE_YET
  ) {
    var listed = adapter.fetchInvoices(service, { limit: 12 });
    if (listed && listed.invoices && listed.invoices.length) {
      fetched = listed;
    }
  }

  var persisted = null;
  try {
    persisted = CM.Invoices.persistProviderFetch({
      providerId: providerId,
      service: service,
      fetched: fetched,
      download: true,
      billingPeriod: period,
      preferLatest: true,
      maxDownloads: 1,
    });
  } catch (e) {
    persisted = {
      ok: false,
      outcome: CM.ProviderInterface.OUTCOME.ERROR,
      message: String(e),
      upserts: [],
      downloads: [],
      pdfCount: 0,
    };
  }

  var autoPdf = !!(persisted && persisted.pdfCount > 0);
  var downloadSummary =
    persisted && persisted.downloads && persisted.downloads[0]
      ? persisted.downloads[0]
      : null;

  var manualHint =
    'PDF automático no disponible.\n\n' +
    'Camino honesto (manual):\n' +
    '1) Descargá el PDF desde el portal en el navegador.\n' +
    '2) Subilo a Drive y copiá el fileId.\n' +
    "3) importManualInvoiceFromDrive('FILE_ID', { provider:'" +
    providerId +
    "', billingPeriod:'" +
    period +
    "', amount:…, dueDate:'DD/MM/YYYY' })\n\n" +
    'Solo metadata (sin PDF aún):\n' +
    "importManualInvoice({ provider:'" +
    providerId +
    "', billingPeriod:'" +
    period +
    "', invoiceNumber:'…', amount:…, dueDate:'…' })\n\n" +
    'Plantilla: getManualInvoiceTemplate()';

  var out = {
    ok: autoPdf || !!(persisted && persisted.upserts && persisted.upserts.length),
    provider: providerId,
    period: period,
    autoPdf: autoPdf,
    manualRequired: !autoPdf,
    outcome:
      (persisted && persisted.outcome) ||
      (fetched && fetched.outcome) ||
      (status && status.outcome),
    message: autoPdf
      ? 'PDF OSSE/auto guardado en Drive + fila Invoices (dedupe). Revisá Execution log.'
      : (persisted && persisted.message) ||
        (downloadSummary && downloadSummary.download && downloadSummary.download.message) ||
        (fetched && fetched.message) ||
        (status && status.message) ||
        'Sin PDF automático',
    status: status,
    fetch: {
      outcome: fetched && fetched.outcome,
      message: fetched && fetched.message,
      count: fetched && fetched.invoices ? fetched.invoices.length : 0,
    },
    persist: persisted,
    download: downloadSummary,
    manualHint: autoPdf ? null : manualHint,
    portal: adapter.portal || PORTAL_FALLBACK_(providerId),
  };

  var json = JSON.stringify(
    {
      provider: out.provider,
      ok: out.ok,
      autoPdf: out.autoPdf,
      outcome: out.outcome,
      message: out.message,
      portal: out.portal,
      manualRequired: out.manualRequired,
      fetchOutcome: fetched && fetched.outcome,
      pdfCount: persisted && persisted.pdfCount,
      upsertCount: persisted && persisted.upserts ? persisted.upserts.length : 0,
    },
    null,
    2
  );
  if (typeof Logger !== 'undefined') Logger.log(json);
  if (typeof console !== 'undefined') console.log(json);
  if (out.manualHint && typeof Logger !== 'undefined') {
    Logger.log('--- MANUAL IMPORT ---\n' + out.manualHint);
  }
  return out;
}

function PORTAL_FALLBACK_(providerId) {
  var seed = CM.ServiceCatalog && CM.ServiceCatalog.getByProvider(providerId);
  return (seed && seed.portal_url) || null;
}

function presentDownloadResult_(label, result) {
  var title = 'CasitasManager — ' + label;
  if (result.autoPdf) {
    notifyOperator_(title, 'OK: PDF / facturas detectadas. Ver Execution log e Invoices.');
    return;
  }
  var body =
    'No se pudo descargar el PDF automáticamente.\n\n' +
    'Motivo: ' +
    (result.outcome || 'desconocido') +
    '\n' +
    (result.message || '') +
    '\n\n' +
    'Usá importManualInvoice / importManualInvoiceFromDrive (ver Execution log).' +
    (result.portal ? '\n\nPortal: ' + result.portal : '');
  notifyOperator_(title, body);
}

/* ─── Tests de envío por rol ──────────────────────────────────────────── */

/**
 * Envío REAL solo a owners (copy ops). Soft confirm si hay UI de Sheet.
 */
function menuProbarEnvioOwner() {
  var ui = tryUiConfirm_(
    'Probar envío — propietario',
    '¿Enviar un aviso de PRUEBA solo a contactos owner (email/Telegram configurados)?\n\n' +
      'Cuerpo: copy ops (payment_status, vencimientos, links).\n' +
      'No se envía a inquilinos.'
  );
  if (ui === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado por el usuario.' });
  }
  var result = sendTestNotifyOwnersOnly();
  presentSendResult_('propietario (owner)', result);
  return result;
}

/**
 * Envío REAL solo a tenants (copy informativa).
 * Soft confirm en Sheet UI → pasa YES_SEND_TO_TENANTS.
 * Sin UI (editor): requiere ALLOW_TEST_TENANT_SEND=yes o llamar
 * sendTestNotifyTenantsOnly(period, 'YES_SEND_TO_TENANTS').
 */
function menuProbarEnvioTenant() {
  var ui = tryUiConfirm_(
    'Probar envío — inquilino',
    '¿Enviar un aviso de PRUEBA solo a contactos tenant?\n\n' +
      'Cuerpo: copy informativa ES (no ops).\n' +
      'No se envía a propietarios.\n\n' +
      'Confirmá solo si los emails/Telegram de prueba del inquilino están en Contacts.'
  );
  if (ui === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado por el usuario.' });
  }
  var forceConfirm = ui === true ? CM.Notifications.TEST_CONFIRM : undefined;
  var result = sendTestNotifyTenantsOnly(null, forceConfirm);
  presentSendResult_('inquilino (tenant)', result);
  return result;
}

function presentSendResult_(roleLabel, result) {
  var title = 'CasitasManager — envío ' + roleLabel;
  if (!result) {
    notifyOperator_(title, 'Sin resultado.');
    return;
  }
  if (result.reason === 'confirmation_required') {
    notifyOperator_(
      title,
      'Bloqueado: hace falta confirmación.\n\n' +
        (result.message || '') +
        '\n\nDesde el editor:\nsetAllowTestTenantSend(true);\nsendTestNotifyTenantsOnly();\nclearAllowTestTenantSend();'
    );
    return;
  }
  if (result.reason === 'cancelled') {
    notifyOperator_(title, 'Cancelado.');
    return;
  }
  var emailTo = (result.email && result.email.to) || [];
  var tg = (result.telegram && result.telegram.chats) || [];
  notifyOperator_(
    title,
    (result.ok ? 'Procesado.' : 'No enviado / sin destinatarios.') +
      '\nEmail: ' +
      (emailTo.length ? emailTo.join(', ') : '(ninguno)') +
      '\nTelegram: ' +
      (tg.length ? tg.join(', ') : '(ninguno)') +
      '\nVer Execution log.'
  );
}

/* ─── UI / log helpers ────────────────────────────────────────────────── */

/**
 * @returns {true|false|null} true=YES, false=NO/cancel, null=sin UI
 */
function tryUiConfirm_(title, message) {
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getUi) return null;
    var ui = SpreadsheetApp.getUi();
    var r = ui.alert(title, message, ui.ButtonSet.YES_NO);
    return r === ui.Button.YES;
  } catch (e) {
    return null;
  }
}

function notifyOperator_(title, message) {
  logMenuResult_({ title: title, message: message });
  try {
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getUi) {
      SpreadsheetApp.getUi().alert(title, String(message).slice(0, 1500), SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }
  } catch (e) {
    /* editor / standalone */
  }
}

function logMenuResult_(obj) {
  var json = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  if (typeof Logger !== 'undefined') Logger.log(json);
  if (typeof console !== 'undefined') console.log(json);
  return obj;
}
