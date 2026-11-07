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
      .addItem('Descargar Ecogas por comprobante…', 'menuDescargarEcogasPorComprobante')
      .addItem('Descargar factura OSSE', 'menuDescargarOsse')
      .addItem('Descargar factura Naturgy', 'menuDescargarNaturgy')
      .addItem('Descargar factura Municipalidad', 'menuDescargarMunicipalidad')
      .addSeparator()
      .addItem('Importar PDF Ecogas desde Drive', 'menuImportarPdfEcogas')
      .addItem('Importar PDF Naturgy desde Drive', 'menuImportarPdfNaturgy')
      .addItem('Importar PDF desde Drive…', 'menuImportarPdfDesdeDrive')
      .addSeparator()
      .addItem('Marcar factura como pagada…', 'menuMarcarFacturaPagada')
      .addSeparator()
      .addItem('Agregar propiedad…', 'menuAgregarPropiedad')
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

/**
 * Ecogas: pide número de comprobante (UI Ecogas) → mapea a form field `pp` →
 * POST impresion_jano.php sin Cookie → Drive + Invoices.
 * Alias editor: menuDescargarEcogas / downloadEcogasSessionInvoice.
 */
function menuDescargarEcogasPorComprobante() {
  var title = 'CasitasManager — Ecogas por comprobante';
  var existing = '';
  try {
    existing = String(CM.Settings.get(CM.Settings.KEYS.ECOGAS_PRINT_PP, '') || '').trim();
  } catch (e) {
    existing = '';
  }

  if (!hasSpreadsheetUi_()) {
    if (existing) {
      return menuDescargarProveedor_('ecogas', 'Ecogas');
    }
    var noUi = {
      ok: false,
      reason: 'no_ui',
      message:
        'Sin UI de Sheet. En el editor:\n' +
        "setEcogasPrintPp('0401B60797913A');\n" +
        'downloadEcogasSessionInvoice();\n\n' +
        'O abrí el Sheet → CasitasManager → Descargar Ecogas por comprobante…\n' +
        'Fallback: Importar PDF Ecogas desde Drive.',
    };
    notifyOperator_(title, noUi.message);
    return logMenuResult_(noUi);
  }

  var ans = tryUiPrompt_(
    title,
    'Número de comprobante Ecogas (ej. 0401B60797913A).\n\n' +
      'Lo ves en el portal tras login (reCAPTCHA humano) — campo del form Imprimir.\n' +
      'Con el comprobante se descarga el PDF automáticamente (no hace falta cookie).\n\n' +
      'Vacío/cancelar → hint a «Importar PDF Ecogas desde Drive».\n' +
      (existing ? 'Último guardado: ' + existing + '\n' : ''),
    existing || ''
  );
  if (ans === false || ans == null || !String(ans).trim()) {
    notifyOperator_(
      title,
      'Sin comprobante. Usá «Importar PDF Ecogas desde Drive» ' +
        '(bajá el PDF en el navegador → Drive → importar), ' +
        'o reintentá con el número de comprobante.'
    );
    return logMenuResult_({
      ok: false,
      reason: 'cancelled',
      message: 'Cancelado — falta número de comprobante.',
    });
  }

  var comprobante = String(ans).trim();
  CM.Settings.set(CM.Settings.KEYS.ECOGAS_PRINT_PP, comprobante);
  var result = menuDescargarProveedor_('ecogas', 'Ecogas');
  return maybePromptEcogasAmount_(result, title);
}

/**
 * Si el PDF se guardó pero el parse no halló monto, pedir monto (no inventar).
 * Actualiza la misma fila Invoices (mismo invoice_id).
 */
function maybePromptEcogasAmount_(result, title) {
  if (!result || !result.autoPdf || !result.persist || !result.persist.upserts) {
    return result;
  }
  var up = result.persist.upserts[0];
  var rec = up && up.record;
  if (!rec) return result;
  if (rec.amount != null && rec.amount !== '') {
    return result;
  }
  if (!hasSpreadsheetUi_()) {
    result.amountMissing = true;
    result.message =
      (result.message || '') +
      '\n\nMonto vacío tras PDF. Completá con:\n' +
      "importManualInvoice({ provider:'ecogas', billingPeriod:'" +
      (rec.billing_period || '') +
      "', invoiceNumber:'" +
      (rec.invoice_number || '') +
      "', amount:336.56, issueDate:'…', dueDate:'…' })";
    return result;
  }
  var amountAns = tryUiPrompt_(
    title,
    'PDF guardado, pero no se pudo leer el monto del PDF.\n' +
      'Ingresá el total a pagar de la boleta (ej. 336,56). Vacío = dejar vacío.',
    ''
  );
  if (amountAns === false || amountAns == null || !String(amountAns).trim()) {
    result.amountMissing = true;
    return result;
  }
  var account = '';
  try {
    var svc = CM.ServiceCatalog.getByProvider('ecogas');
    account = (svc && svc.account_number) || '';
  } catch (e) {
    account = '';
  }
  var patched = CM.Invoices.upsert({
    // Prefer existing id so we update the blank PROD row even if account missing here.
    invoice_id: rec.invoice_id,
    provider: 'ecogas',
    accountNumber: account,
    service_id: rec.service_id,
    billingPeriod: rec.billing_period,
    invoiceNumber: rec.invoice_number,
    amount: String(amountAns).trim(),
    issueDate: rec.issue_date || '',
    dueDate: rec.due_date || '',
    invoice_status: rec.invoice_status || 'downloaded',
    payment_status: rec.payment_status || 'unknown',
    invoice_file_id: rec.invoice_file_id,
    invoice_file_url: rec.invoice_file_url,
    notes: (rec.notes ? rec.notes + ' | ' : '') + 'amount_prompt',
  });
  result.amountPrompt = patched;
  result.persist.upserts[0] = patched;
  return result;
}

/** Alias: misma ruta por comprobante (menú / editor). */
function menuDescargarEcogas() {
  return menuDescargarEcogasPorComprobante();
}

function menuDescargarOsse() {
  return menuDescargarProveedor_('osse', 'OSSE');
}

function menuDescargarNaturgy() {
  // Listing complete_debts sin sesión. PDF: login sessions + printed_bill si hay props.
  // Nunca pedir ni loguear password en el prompt del menú.
  var hasAuth = false;
  try {
    hasAuth = !!(
      CM.Settings.get(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '') ||
      (CM.Settings.get(CM.Settings.KEYS.NATURGY_EMAIL, '') &&
        CM.Settings.get(CM.Settings.KEYS.NATURGY_PASSWORD, ''))
    );
  } catch (e) {
    hasAuth = false;
  }
  if (!hasAuth) {
    notifyOperator_(
      'CasitasManager — Naturgy',
      'Sin credenciales/token en Script Properties.\n\n' +
        'En el editor DEV/PROD:\n' +
        "setNaturgyCredentials('email', 'password');\n" +
        'luego re-ejecutá Descargar factura Naturgy.\n\n' +
        'O Importar PDF Naturgy desde Drive.\n' +
        'Nunca pegues la password en Issues/chat.'
    );
  }
  return menuDescargarProveedor_('naturgy', 'Naturgy');
}

function menuDescargarMunicipalidad() {
  return menuDescargarProveedor_('municipalidad', 'Municipalidad');
}

/**
 * Import manual Ecogas (fallback si no tenés el número de comprobante).
 */
function menuImportarPdfEcogas() {
  return menuImportarPdfDesdeDrive_({ provider: 'ecogas', label: 'Ecogas' });
}

/**
 * Import manual Naturgy (PDF aún requiere token o bajada browser).
 */
function menuImportarPdfNaturgy() {
  return menuImportarPdfDesdeDrive_({ provider: 'naturgy', label: 'Naturgy' });
}

/**
 * Import manual compartido. Pide provider si no viene fijado.
 * Camino: fileId/URL (o Inbox-Manual) → looksLikePdf → importManualInvoiceFromDrive.
 */
function menuImportarPdfDesdeDrive() {
  return menuImportarPdfDesdeDrive_({ provider: null, label: 'PDF Drive' });
}

/**
 * @param {{provider:?string,label:string}} defaults
 */
function menuImportarPdfDesdeDrive_(defaults) {
  defaults = defaults || {};
  var periodDefault = CM.Dates.currentBillingPeriod();
  var providerDefault = defaults.provider || 'naturgy';
  var label = defaults.label || 'PDF Drive';
  var title = 'CasitasManager — Importar ' + label;

  if (!hasSpreadsheetUi_()) {
    var noUi = {
      ok: false,
      reason: 'no_ui',
      message:
        'Este flujo necesita el menú del Sheet (prompts).\n\n' +
        'Abrí el spreadsheet y usá CasitasManager → Importar PDF…\n' +
        'O desde el editor:\n' +
        "importManualInvoiceFromDrive('FILE_ID', { provider:'" +
        providerDefault +
        "', billingPeriod:'" +
        periodDefault +
        "', amount:… })",
    };
    notifyOperator_(title, noUi.message);
    return logMenuResult_(noUi);
  }

  var provider = providerDefault;
  if (!defaults.provider) {
    var providerAns = tryUiPrompt_(
      title,
      'Proveedor (ecogas | naturgy | osse | municipalidad).\n' +
        'Default: naturgy\n\n' +
        'Naturgy listing auto (complete_debts); PDF aún manual/token.',
      providerDefault
    );
    if (providerAns === false) {
      return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
    }
    if (providerAns && String(providerAns).trim()) {
      provider = String(providerAns).trim().toLowerCase();
    }
  }

  var fileAns = tryUiPrompt_(
    title,
    'Pegá el fileId o la URL del PDF en Drive.\n\n' +
      'Ejemplos:\n' +
      '• 1abc…XYZ (fileId)\n' +
      '• https://drive.google.com/file/d/FILE_ID/view\n\n' +
      'Dejá vacío para listar PDFs recientes en Inbox-Manual\n' +
      '(carpeta Properties/…/Inbox-Manual — subí el PDF ahí antes).',
    ''
  );
  if (fileAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var fileIdOrUrl = fileAns == null ? '' : String(fileAns).trim();
  if (!fileIdOrUrl) {
    var picked = pickFromManualInbox_(title);
    if (!picked.ok) {
      notifyOperator_(title, picked.message || 'Sin PDF en Inbox-Manual.');
      return logMenuResult_(picked);
    }
    fileIdOrUrl = picked.fileId;
  }

  var periodAns = tryUiPrompt_(
    title,
    'Período de facturación (YYYY-MM).\nDefault: mes actual (' + periodDefault + ').',
    periodDefault
  );
  if (periodAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }
  var billingPeriod =
    periodAns != null && String(periodAns).trim() ? String(periodAns).trim() : periodDefault;

  var amountAns = tryUiPrompt_(
    title,
    'Monto de la boleta (opcional).\n' +
      'Dejá vacío si todavía no lo cargás — no inventar importes.\n' +
      'Acepta 1234.56 o 1.234,56',
    ''
  );
  if (amountAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }
  var amount =
    amountAns != null && String(amountAns).trim() !== '' ? String(amountAns).trim() : '';

  var prepared = CM.Invoices.prepareManualDriveImport({
    fileIdOrUrl: fileIdOrUrl,
    provider: provider,
    billingPeriod: billingPeriod,
    amount: amount,
  });
  if (!prepared.ok) {
    notifyOperator_(title, prepared.message || prepared.reason);
    return logMenuResult_({ ok: false, prepare: prepared });
  }

  var result = runManualDriveImport_(prepared.fileId, prepared.input);
  presentManualImportResult_(label, result);
  return result;
}

function pickFromManualInbox_(title) {
  var listed;
  try {
    listed = CM.Drive.listRecentManualInboxPdfs(8);
  } catch (e) {
    return {
      ok: false,
      reason: 'inbox_error',
      message:
        'No pude listar Inbox-Manual: ' +
        String(e) +
        '\n\nSubí el PDF a Drive, copiá fileId/URL y reintentá el menú.',
    };
  }
  if (!listed.files || !listed.files.length) {
    return {
      ok: false,
      reason: 'inbox_empty',
      message:
        'Inbox-Manual está vacío.\n\n' +
        '1) Subí el PDF a: ' +
        (listed.url || 'Properties/…/Inbox-Manual') +
        '\n2) Reabrí Importar PDF… y dejá el fileId vacío, o pegá la URL.',
    };
  }
  var lines = listed.files.map(function (f, i) {
    return String(i + 1) + ') ' + f.name + '  [' + f.fileId + ']';
  });
  var pickAns = tryUiPrompt_(
    title,
    'PDFs recientes en Inbox-Manual:\n\n' +
      lines.join('\n') +
      '\n\nEscribí el número (1–' +
      listed.files.length +
      '). Vacío = 1:',
    '1'
  );
  if (pickAns === false || pickAns == null) {
    return { ok: false, reason: 'cancelled', message: 'Cancelado.' };
  }
  var idx = parseInt(String(pickAns).trim(), 10);
  if (!idx || idx < 1 || idx > listed.files.length) {
    return {
      ok: false,
      reason: 'pick_invalido',
      message: 'Número inválido. Reintentá el menú.',
    };
  }
  return { ok: true, fileId: listed.files[idx - 1].fileId, fromInbox: true };
}

function runManualDriveImport_(fileId, input) {
  var out = {
    ok: false,
    fileId: fileId,
    provider: input && input.provider,
    billingPeriod: input && input.billingPeriod,
  };
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (!CM.Pdf.looksLikePdf(bytes)) {
      out.reason = 'not_pdf';
      out.message =
        'El archivo no parece un PDF (%PDF). Revisá el fileId / Inbox-Manual.\n' +
        'Nombre: ' +
        file.getName();
      logMenuResult_(out);
      return out;
    }
    if (!input.invoiceNumber) {
      input.invoiceNumber = file.getName().replace(/\.pdf$/i, '');
    }
    var imported = importManualInvoiceFromDrive(fileId, input);
    out.ok = !!(imported && imported.ok);
    out.import = imported;
    out.message = out.ok
      ? 'PDF importado → Drive Invoices/{año}/{mes} + fila Invoices (dedupe).'
      : (imported &&
          imported.validation &&
          (imported.validation.reason || JSON.stringify(imported.validation))) ||
        'Import falló (ver Execution log).';
    if (imported && imported.save) {
      out.savedFileId = imported.save.fileId;
      out.savedUrl = imported.save.url;
    }
    if (imported && imported.upsert && imported.upsert.record) {
      out.invoiceId = imported.upsert.record.invoice_id;
    }
  } catch (e) {
    out.reason = 'error';
    out.message = String(e);
  }
  logMenuResult_(out);
  return out;
}

function presentManualImportResult_(label, result) {
  var title = 'CasitasManager — Importar ' + label;
  if (result && result.ok) {
    notifyOperator_(
      title,
      'OK: ' +
        (result.message || 'importado') +
        (result.invoiceId ? '\ninvoice_id: ' + result.invoiceId : '') +
        (result.savedUrl ? '\nPDF: ' + result.savedUrl : '') +
        '\n\nOpcional: sendTestNotifyOwnersOnly() para probar aviso.'
    );
    return;
  }
  notifyOperator_(
    title,
    'No se importó.\n\n' +
      (result && result.message ? result.message : 'Error desconocido') +
      '\n\nVer Execution log.'
  );
}

/**
 * Si hay >1 propiedad con ese provider enabled, pedir cuál (UI Sheet).
 * @returns {{propertyId:string|null, cancelled?:boolean, skipped?:boolean}}
 */
function resolvePropertyIdForDownload_(providerId, explicitPropertyId) {
  if (explicitPropertyId != null && String(explicitPropertyId).trim() !== '') {
    return { propertyId: String(explicitPropertyId).trim() };
  }
  var provider = String(providerId || '').toLowerCase();
  var candidates = [];
  try {
    var services = CM.Sheets.list(CM.Sheets.SHEET_NAMES.SERVICES) || [];
    var props = CM.Sheets.listActiveProperties();
    var nameById = {};
    (props || []).forEach(function (p) {
      nameById[String(p.property_id)] = p.property_name || p.property_id;
    });
    var seen = {};
    services.forEach(function (s) {
      if (!s) return;
      if (String(s.provider || '').toLowerCase() !== provider) return;
      var en =
        s.enabled === true ||
        String(s.enabled).toLowerCase() === 'true' ||
        String(s.enabled) === 'TRUE';
      if (!en) return;
      var pid = String(s.property_id || '').trim();
      if (!pid || seen[pid]) return;
      seen[pid] = true;
      candidates.push({
        property_id: pid,
        property_name: nameById[pid] || pid,
      });
    });
  } catch (e) {
    candidates = [];
  }
  if (candidates.length <= 1) {
    return {
      propertyId: candidates[0] ? candidates[0].property_id : null,
      skipped: true,
    };
  }
  if (!hasSpreadsheetUi_()) {
    return {
      propertyId: null,
      cancelled: false,
      needsPropertyId: true,
      candidates: candidates,
    };
  }
  var lines = candidates
    .map(function (c, i) {
      return String(i + 1) + ') ' + c.property_name;
    })
    .join('\n');
  var ans = tryUiPrompt_(
    'CasitasManager — elegir casa',
    'Hay varias casas con ' +
      provider +
      '.\n¿Cuál querés descargar?\n\n' +
      lines +
      '\n\nEscribí el número (1–' +
      candidates.length +
      ').',
    '1'
  );
  if (ans === false || ans == null || !String(ans).trim()) {
    return { propertyId: null, cancelled: true };
  }
  var idx = parseInt(String(ans).trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
    return { propertyId: null, cancelled: true };
  }
  return { propertyId: candidates[idx].property_id };
}

/**
 * Probe + fetch + intento de download. Si no hay PDF automático, mensaje claro
 * y camino importManualInvoice / FromDrive (sin inventar montos).
 * @param {string} providerId
 * @param {string} label
 * @param {string|object} [propertyIdOrOpts]
 */
function menuDescargarProveedor_(providerId, label, propertyIdOrOpts) {
  var explicit =
    typeof propertyIdOrOpts === 'string'
      ? propertyIdOrOpts
      : propertyIdOrOpts && propertyIdOrOpts.propertyId
        ? propertyIdOrOpts.propertyId
        : propertyIdOrOpts && propertyIdOrOpts.property_id
          ? propertyIdOrOpts.property_id
          : null;
  var pick = resolvePropertyIdForDownload_(providerId, explicit);
  if (pick.cancelled) {
    notifyOperator_('CasitasManager — ' + label, 'Cancelado: no se eligió casa.');
    return { ok: false, reason: 'cancelled', message: 'Cancelado — falta elegir casa.' };
  }
  if (pick.needsPropertyId) {
    var msg =
      'Hay varias casas con este servicio. Pasá propertyId:\n' +
      "downloadProviderInvoice('" +
      providerId +
      "', { propertyId: '…' })";
    notifyOperator_('CasitasManager — ' + label, msg);
    return { ok: false, reason: 'needs_property_id', message: msg, candidates: pick.candidates };
  }
  notifyOperator_(
    'CasitasManager — ' + label,
    'Consultando portal… Revisá Execution log para el detalle.'
  );
  var result = downloadProviderInvoice_(providerId, { propertyId: pick.propertyId });
  presentDownloadResult_(label, result);
  return result;
}

/**
 * @param {string} providerId
 * @param {string|object} [propertyIdOrOpts] property_id o { propertyId / property_id / service }
 */
function downloadProviderInvoice_(providerId, propertyIdOrOpts) {
  providerId = String(providerId || '').toLowerCase();
  var opts = {};
  if (typeof propertyIdOrOpts === 'string') {
    opts = { propertyId: propertyIdOrOpts };
  } else if (propertyIdOrOpts && typeof propertyIdOrOpts === 'object') {
    opts = propertyIdOrOpts;
  }
  var propertyId =
    opts.propertyId || opts.property_id || opts.propertyID || null;
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

  var service = opts.service || null;
  if (!service) {
    try {
      service = CM.Sheets.resolveService(propertyId, providerId);
    } catch (e) {
      service = null;
    }
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
  var metadataOnly =
    !autoPdf && !!(persisted && persisted.upserts && persisted.upserts.length);
  var downloadSummary =
    persisted && persisted.downloads && persisted.downloads[0]
      ? persisted.downloads[0]
      : null;

  var manualHint =
    providerId === 'ecogas'
      ? 'PDF Ecogas no disponible sin número de comprobante.\n\n' +
        'Opciones:\n' +
        'A) Menú «Descargar Ecogas por comprobante…» con el nº (ej. 0401B60797913A).\n' +
        'B) Fallback manual:\n' +
        '   1) Bajá el PDF en el navegador (reCAPTCHA humano).\n' +
        '   2) Subilo a Drive / Inbox-Manual.\n' +
        '   3) Menú «Importar PDF Ecogas desde Drive».\n\n' +
        'Editor: setEcogasPrintPp(\'0401B…\'); downloadEcogasSessionInvoice();\n' +
        'o importManualInvoiceFromDrive(\'FILE_ID\', { provider:\'ecogas\', billingPeriod:\'' +
        period +
        "', amount:… })"
      : 'PDF automático no disponible.\n\n' +
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
        'Plantilla: getManualInvoiceTemplate()\n\n' +
        'Si la fila ya está en Invoices, podés probar aviso con sendTestNotifyOwnersOnly().';

  // Nunca reutilizar "PDF OSSE OK" del adapter si pdfCount===0.
  var message;
  if (autoPdf) {
    message =
      'PDF ' +
      providerId +
      '/auto guardado en Drive + fila Invoices (dedupe). Revisá Execution log.';
  } else if (metadataOnly && persisted && persisted.message) {
    message = persisted.message;
  } else if (metadataOnly) {
    message =
      'Factura registrada (metadata); PDF no descargado porque ' +
      ((persisted && persisted.pdfSkipReason) ||
        (downloadSummary &&
          downloadSummary.save &&
          downloadSummary.save.validation &&
          downloadSummary.save.validation.reason) ||
        (downloadSummary && downloadSummary.download && !downloadSummary.download.ok
          ? downloadSummary.download.message
          : null) ||
        'falló el guardado automático');
  } else {
    message =
      (persisted && persisted.message) ||
      (fetched && fetched.message) ||
      (status && status.message) ||
      'Sin PDF automático';
  }

  var out = {
    ok: autoPdf || metadataOnly,
    provider: providerId,
    propertyId:
      propertyId ||
      (service && service.property_id) ||
      null,
    period: period,
    autoPdf: autoPdf,
    manualRequired: !autoPdf,
    metadataOnly: metadataOnly,
    outcome:
      (persisted && persisted.outcome) ||
      (fetched && fetched.outcome) ||
      (status && status.outcome),
    message: message,
    pdfSkipReason: autoPdf ? null : (persisted && persisted.pdfSkipReason) || null,
    status: status,
    service: service,
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
      metadataOnly: out.metadataOnly,
      outcome: out.outcome,
      message: out.message,
      pdfSkipReason: out.pdfSkipReason,
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
    var amtHint = '';
    try {
      var rec0 =
        result.persist &&
        result.persist.upserts &&
        result.persist.upserts[0] &&
        result.persist.upserts[0].record;
      if (rec0 && rec0.amount != null && rec0.amount !== '') {
        amtHint = '\nMonto: ' + rec0.amount + ' ARS';
        if (rec0.due_date) amtHint += ' · vto ' + rec0.due_date;
      } else if (result.provider === 'ecogas') {
        amtHint =
          '\nMonto/fechas: si quedaron vacíos, reintentá descarga (parse PDF) o completá a mano.';
      }
    } catch (e) {
      amtHint = '';
    }
    notifyOperator_(
      title,
      'OK: PDF guardado en Drive + fila Invoices.' + amtHint + '\nVer Execution log.'
    );
    return;
  }
  var isEcogas = result && result.provider === 'ecogas';
  var body;
  if (result.metadataOnly) {
    body =
      (result.message ||
        'Factura registrada (metadata); PDF no descargado.') +
      '\n\n' +
      'autoPdf=false · manualRequired=true · outcome=' +
      (result.outcome || '') +
      '\n\n' +
      'Si Invoices ya tiene la fila, podés probar sendTestNotifyOwnersOnly().\n' +
      (isEcogas
        ? 'PDF: «Descargar Ecogas por comprobante…» o «Importar PDF Ecogas desde Drive».'
        : 'Para adjuntar PDF: Importar PDF… / importManualInvoiceFromDrive (ver Execution log).') +
      (result.portal ? '\n\nPortal: ' + result.portal : '');
  } else {
    body =
      'No se pudo descargar el PDF automáticamente.\n\n' +
      'Motivo: ' +
      (result.outcome || 'desconocido') +
      '\n' +
      (result.message || '') +
      '\n\n' +
      (isEcogas
        ? 'Reintentá «Descargar Ecogas por comprobante…» con el nº de comprobante,\n' +
          'o usá «Importar PDF Ecogas desde Drive».'
        : 'Usá Importar PDF… / importManualInvoiceFromDrive (ver Execution log).') +
      (result.portal ? '\n\nPortal: ' + result.portal : '');
  }
  notifyOperator_(title, body);
}

/* ─── Marcar factura como pagada ──────────────────────────────────────── */

/**
 * Registra pago vía CM.Payments.registerPayment (Payments + payment_status=paid).
 * Preferencia: fila seleccionada en hoja Invoices → invoice_id; si no, prompt
 * (vacío ofrece listado de no pagadas).
 */
function menuMarcarFacturaPagada() {
  var title = 'CasitasManager — Marcar como pagada';
  var selectedId = getSelectedInvoiceId_();

  if (!hasSpreadsheetUi_()) {
    var noUi = {
      ok: false,
      reason: 'no_ui',
      message:
        'Sin UI de Sheet. Abrí el spreadsheet → CasitasManager → Marcar factura como pagada…\n\n' +
        'O desde el editor:\n' +
        "registerPayment({ invoice_id:'…', payment_date:'YYYY-MM-DD', payment_method:'transferencia', notes:'' })",
      selectedInvoiceId: selectedId || null,
    };
    notifyOperator_(title, noUi.message);
    return logMenuResult_(noUi);
  }

  var invoiceId = selectedId;
  if (invoiceId) {
    var invPreview = null;
    try {
      invPreview = CM.Sheets.findInvoiceById(invoiceId);
    } catch (e) {
      invPreview = null;
    }
    var confirmMsg =
      '¿Registrar pago de esta factura?\n\n' +
      'invoice_id: ' +
      invoiceId +
      (invPreview
        ? '\n' +
          (invPreview.provider || '') +
          ' · ' +
          (invPreview.billing_period || '') +
          (invPreview.amount != null && invPreview.amount !== ''
            ? ' · $' + invPreview.amount
            : '')
        : '') +
      '\n\nSe crea fila en Payments y payment_status=paid.';
    var conf = tryUiConfirm_(title, confirmMsg);
    if (conf === false) {
      return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
    }
  } else {
    invoiceId = resolveInvoiceIdViaPrompt_(title);
    if (!invoiceId) {
      return logMenuResult_({
        ok: false,
        reason: 'cancelled',
        message: 'Cancelado — falta invoice_id.',
      });
    }
  }

  var todayDefault = '';
  try {
    todayDefault = CM.Dates.todayISO();
  } catch (e2) {
    todayDefault = '';
  }

  var dateAns = tryUiPrompt_(
    title,
    'Fecha de pago (YYYY-MM-DD o DD/MM/YYYY).\nDefault: hoy (' + todayDefault + ').',
    todayDefault
  );
  if (dateAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var methodAns = tryUiPrompt_(
    title,
    'Medio de pago (opcional).\nEj.: transferencia, efectivo, débito.',
    ''
  );
  if (methodAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var notesAns = tryUiPrompt_(title, 'Notas (opcional).', '');
  if (notesAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var amountAns = tryUiPrompt_(
    title,
    'Monto (opcional).\nVacío = usar el monto de la factura.\nNo inventar importes.',
    ''
  );
  if (amountAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var result = runMarkInvoicePaid_({
    invoice_id: invoiceId,
    payment_date: dateAns,
    payment_method: methodAns,
    notes: notesAns,
    amount: amountAns,
  });
  presentMarkPaidResult_(title, result);
  return result;
}

/**
 * Lee invoice_id de la fila activa si la hoja es Invoices (fila ≥ 2).
 * @returns {string|null}
 */
function getSelectedInvoiceId_() {
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getActiveSpreadsheet) {
      return null;
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    var sheet = ss.getActiveSheet();
    if (!sheet) return null;
    var invoicesName =
      (CM.Sheets && CM.Sheets.SHEET_NAMES && CM.Sheets.SHEET_NAMES.INVOICES) || 'Invoices';
    if (String(sheet.getName()) !== String(invoicesName)) return null;
    var range = sheet.getActiveRange();
    if (!range) return null;
    var row = range.getRow();
    if (row < 2) return null;
    var headers =
      (CM.Sheets && CM.Sheets.HEADERS && CM.Sheets.HEADERS[invoicesName]) ||
      ['invoice_id'];
    var col = headers.indexOf('invoice_id');
    if (col < 0) col = 0;
    var val = sheet.getRange(row, col + 1).getValue();
    var id = val == null ? '' : String(val).trim();
    return id || null;
  } catch (e) {
    return null;
  }
}

/**
 * Prompt invoice_id; vacío → listado de no pagadas (número o id).
 * @returns {string|null}
 */
function resolveInvoiceIdViaPrompt_(title) {
  var unpaid = [];
  try {
    var rows = CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES) || [];
    unpaid = CM.Payments.listUnpaidForMenu(rows, 12);
  } catch (e) {
    unpaid = [];
  }

  var hint =
    unpaid.length > 0
      ? 'Vacío = ver listado de facturas sin pagar.\n'
      : 'Seleccioná una fila en Invoices o pegá el invoice_id.\n';
  var idAns = tryUiPrompt_(
    title,
    'invoice_id de la factura a marcar como pagada.\n\n' + hint,
    ''
  );
  if (idAns === false) return null;
  if (idAns != null && String(idAns).trim()) {
    return String(idAns).trim();
  }

  if (!unpaid.length) {
    notifyOperator_(
      title,
      'No hay facturas sin pagar en Invoices, o no pude listarlas.\n' +
        'Pegá el invoice_id en el prompt o seleccioná una fila en la hoja Invoices.'
    );
    return null;
  }

  var pickAns = tryUiPrompt_(
    title,
    'Facturas sin pagar:\n\n' +
      CM.Payments.formatUnpaidChoices(unpaid) +
      '\n\nEscribí el número (1–' +
      unpaid.length +
      ') o el invoice_id completo:',
    '1'
  );
  if (pickAns === false || pickAns == null) return null;
  return CM.Payments.resolveInvoiceIdFromChoice(pickAns, unpaid);
}

/**
 * Construye input + llama registerPayment. Captura errores sin tirar al UI crudo.
 * @param {object} answers
 */
function runMarkInvoicePaid_(answers) {
  var out = { ok: false };
  try {
    var input = CM.Payments.buildMenuPaymentInput(answers.invoice_id, {
      payment_date: answers.payment_date,
      payment_method: answers.payment_method,
      notes: answers.notes,
      amount: answers.amount,
    });
    var registered = CM.Payments.registerPayment(input);
    out.ok = true;
    out.payment = registered.payment;
    out.invoice = registered.invoice;
    out.message = CM.Payments.formatMarkPaidResultMessage(out);
  } catch (e) {
    out.ok = false;
    out.reason = 'error';
    out.message = String(e && e.message ? e.message : e);
  }
  logMenuResult_(out);
  return out;
}

function presentMarkPaidResult_(title, result) {
  var msg = CM.Payments.formatMarkPaidResultMessage(result);
  try {
    if (result && result.ok && typeof SpreadsheetApp !== 'undefined') {
      var ss = SpreadsheetApp.getActiveSpreadsheet && SpreadsheetApp.getActiveSpreadsheet();
      if (ss && ss.toast) {
        ss.toast(
          'payment_id: ' + ((result.payment && result.payment.payment_id) || ''),
          'Pago registrado',
          8
        );
      }
    }
  } catch (e) {
    /* toast opcional */
  }
  notifyOperator_(title, msg);
}

/* ─── Agregar propiedad (multi-servicio + contactos) ──────────────────── */

/**
 * Onboarding de una propiedad nueva sin editar seed.
 * Contactos (owners/tenants) quedan con property_id de ESA propiedad.
 */
function menuAgregarPropiedad() {
  var title = 'CasitasManager — Agregar propiedad';

  if (!hasSpreadsheetUi_()) {
    var noUi = {
      ok: false,
      reason: 'no_ui',
      message:
        'Sin UI de Sheet. Abrí el spreadsheet → CasitasManager → Agregar propiedad…\n\n' +
        'O desde el editor:\n' +
        "addProperty({\n" +
        "  property_name: 'Casa Ejemplo',\n" +
        "  address: '…', city: 'Caucete', province: 'San Juan',\n" +
        "  services: [\n" +
        "    { provider:'naturgy', account_number:'…' },\n" +
        "    { provider:'municipalidad', municipio:'Caucete', cadastral_number:'…' }\n" +
        "  ],\n" +
        "  contacts: [\n" +
        "    { role:'owner', name:'…', email:'…', telegram:'', active:true },\n" +
        "    { role:'tenant', name:'…', email:'…', telegram:'', active:true }\n" +
        "  ]\n" +
        '});',
    };
    notifyOperator_(title, noUi.message);
    return logMenuResult_(noUi);
  }

  var nameAns = tryUiPrompt_(
    title,
    'Nombre de la propiedad (obligatorio).\nEj.: Natania XV M6 C2 / Casa Centro Caucete',
    ''
  );
  if (nameAns === false || nameAns == null || !String(nameAns).trim()) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado — falta nombre.' });
  }
  var propertyName = String(nameAns).trim();

  var addressAns = tryUiPrompt_(title, 'Dirección / manzana-casa (opcional).', '');
  if (addressAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var cityAns = tryUiPrompt_(title, 'Ciudad / departamento (ej. Rivadavia, Caucete).', '');
  if (cityAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var provinceDefault =
    (CM.Properties && CM.Properties.DEFAULT_PROVINCE) || 'San Juan';
  var provinceAns = tryUiPrompt_(
    title,
    'Provincia.\nDefault: ' + provinceDefault,
    provinceDefault
  );
  if (provinceAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var notesAns = tryUiPrompt_(title, 'Notas de la propiedad (opcional).', '');
  if (notesAns === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
  }

  var existingIds = [];
  try {
    existingIds = (CM.Sheets.list(CM.Sheets.SHEET_NAMES.PROPERTIES) || []).map(function (p) {
      return p.property_id;
    });
  } catch (e) {
    existingIds = [];
  }
  var alloc = CM.Properties.allocatePropertyId(propertyName, existingIds);
  var propertyId = alloc.property_id;
  if (alloc.collided) {
    var idAns = tryUiPrompt_(
      title,
      'El id derivado ya existe.\nBase: ' +
        alloc.base +
        '\nSugerido: ' +
        alloc.property_id +
        '\n\nConfirmá o escribí otro property_id (slug minúsculas).',
      alloc.property_id
    );
    if (idAns === false) {
      return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
    }
    propertyId = String(idAns || alloc.property_id).trim().toLowerCase();
    var taken = existingIds.some(function (id) {
      return String(id).toLowerCase() === propertyId;
    });
    if (taken) {
      notifyOperator_(title, 'property_id en uso: ' + propertyId + '. Reintentá el menú.');
      return logMenuResult_({
        ok: false,
        reason: 'property_id_collision',
        property_id: propertyId,
      });
    }
  } else {
    var confirmId = tryUiConfirm_(
      title,
      'property_id propuesto: ' + propertyId + '\n\n¿Continuar con este id?'
    );
    if (confirmId === false) {
      var customId = tryUiPrompt_(
        title,
        'Escribí un property_id (slug, ej. casa-caucete-1).',
        propertyId
      );
      if (customId === false || customId == null || !String(customId).trim()) {
        return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado.' });
      }
      propertyId = String(customId).trim().toLowerCase();
    }
  }

  var services = collectPropertyServicesViaPrompts_(title, cityAns);
  if (services === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado en servicios.' });
  }

  var contacts = collectPropertyContactsViaPrompts_(title);
  if (contacts === false) {
    return logMenuResult_({ ok: false, reason: 'cancelled', message: 'Cancelado en contactos.' });
  }

  var result = runAddProperty_({
    property_id: propertyId,
    property_name: propertyName,
    address: addressAns,
    city: cityAns,
    province: provinceAns,
    notes: notesAns,
    services: services,
    contacts: contacts,
    createDriveFolder: true,
  });
  presentAddPropertyResult_(title, result);
  return result;
}

/**
 * Yes/no secuencial por proveedor + prompts de identificadores.
 * @returns {object[]|false}
 */
function collectPropertyServicesViaPrompts_(title, defaultCity) {
  var defs = [
    { key: 'naturgy', label: '¿Electricidad (Naturgy)?' },
    { key: 'ecogas', label: '¿Gas (Ecogas)?' },
    { key: 'osse', label: '¿Agua (OSSE)?' },
    {
      key: 'municipalidad',
      label:
        '¿Tasa municipal (Municipalidad)?\n' +
        'No se asume Rivadavia — vas a indicar el municipio.',
    },
  ];
  var out = [];
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    var yes = tryUiConfirm_(title, d.label);
    if (yes === false) continue;
    if (yes == null) continue;
    var svc = promptServiceDetails_(title, d.key, defaultCity);
    if (svc === false) return false;
    if (svc) out.push(svc);
  }
  return out;
}

/**
 * @returns {object|false|null} false=cancel, null=skip invalid
 */
function promptServiceDetails_(title, providerKey, defaultCity) {
  if (providerKey === 'naturgy') {
    var acc = tryUiPrompt_(
      title,
      'Naturgy — número de cliente / account_number (client_number).',
      ''
    );
    if (acc === false) return false;
    var med = tryUiPrompt_(title, 'Naturgy — medidor / secondary (opcional).', '');
    if (med === false) return false;
    return {
      provider: 'naturgy',
      account_number: acc,
      secondary_identifier: med,
    };
  }
  if (providerKey === 'ecogas') {
    var eg = tryUiPrompt_(title, 'Ecogas — número de cuenta / account_number.', '');
    if (eg === false) return false;
    return { provider: 'ecogas', account_number: eg };
  }
  if (providerKey === 'osse') {
    var os = tryUiPrompt_(
      title,
      'OSSE — account_number (14 dígitos; espacios OK, ej. 024 0005155 000 4).',
      ''
    );
    if (os === false) return false;
    var uni = tryUiPrompt_(title, 'OSSE — unidad / secondary (opcional).', '');
    if (uni === false) return false;
    var osNorm = os;
    if (osNorm && CM.Providers && CM.Providers.Osse && CM.Providers.Osse.accountDigits) {
      osNorm = CM.Providers.Osse.accountDigits(osNorm);
    }
    return {
      provider: 'osse',
      account_number: osNorm,
      secondary_identifier: uni,
    };
  }
  if (providerKey === 'municipalidad') {
    var mun = tryUiPrompt_(
      title,
      'Municipalidad — municipio (ej. Rivadavia, Caucete).\n' +
        'Importante: Caucete NO usa el portal ASP.NET de Rivadavia.',
      defaultCity ? String(defaultCity).trim() : ''
    );
    if (mun === false) return false;
    var cat = tryUiPrompt_(
      title,
      'Municipalidad — nomenclatura / cadastral (si la conocés).\nVacío = completar después.',
      ''
    );
    if (cat === false) return false;
    var portal = tryUiPrompt_(
      title,
      'Municipalidad — portal_url (si la conocés).\n' +
        'Vacío: Rivadavia usa el adapter conocido; otros municipios quedan pendientes de discovery.',
      ''
    );
    if (portal === false) return false;
    return {
      provider: 'municipalidad',
      municipio: mun,
      cadastral_number: cat,
      portal_url: portal,
    };
  }
  return null;
}

/**
 * Loop de contactos owner|tenant para la propiedad nueva.
 * Ofrece al menos owner + posibilidad de tenants; “¿Agregar otro contacto?”.
 * @returns {object[]|false}
 */
function collectPropertyContactsViaPrompts_(title) {
  var add = tryUiConfirm_(
    title,
    '¿Agregar contactos de ESTA propiedad?\n\n' +
      'Cada casa puede tener owners e inquilinos propios\n' +
      '(Contacts.property_id = la propiedad nueva, no Natania).'
  );
  if (add === false) return [];
  if (add == null) return [];

  var contacts = [];
  var idx = 0;
  while (true) {
    idx++;
    var roleDefault = idx === 1 ? 'owner' : 'tenant';
    var roleAns = tryUiPrompt_(
      title,
      'Contacto #' +
        idx +
        ' — role: owner | tenant\n' +
        'Default: ' +
        roleDefault,
      roleDefault
    );
    if (roleAns === false) return false;
    var role = String(roleAns || roleDefault)
      .toLowerCase()
      .trim();
    if (role !== 'owner' && role !== 'tenant') {
      notifyOperator_(title, 'Role inválido (' + role + '). Usá owner o tenant.');
      return false;
    }

    var cName = tryUiPrompt_(title, 'Contacto #' + idx + ' — nombre.', '');
    if (cName === false) return false;
    var cEmail = tryUiPrompt_(title, 'Contacto #' + idx + ' — email (opcional).', '');
    if (cEmail === false) return false;
    var cTg = tryUiPrompt_(
      title,
      'Contacto #' + idx + ' — telegram chat_id (opcional).',
      ''
    );
    if (cTg === false) return false;
    var cActive = tryUiConfirm_(title, '¿Contacto #' + idx + ' activo?');
    if (cActive === false) {
      // NO → inactive; cancel no disponible en YES_NO de la misma forma
    }
    contacts.push({
      role: role,
      name: cName,
      email: cEmail,
      telegram: cTg,
      active: cActive !== false,
    });

    var more = tryUiConfirm_(title, '¿Agregar otro contacto (owner o tenant)?');
    if (more !== true) break;
  }
  return contacts;
}

function runAddProperty_(input) {
  var out = { ok: false };
  try {
    out = CM.Properties.addProperty(input);
  } catch (e) {
    out = {
      ok: false,
      reason: 'error',
      message: String(e && e.message ? e.message : e),
    };
  }
  logMenuResult_(out);
  return out;
}

function presentAddPropertyResult_(title, result) {
  var msg = CM.Properties.formatAddPropertySummary(result);
  try {
    if (result && result.ok && typeof SpreadsheetApp !== 'undefined') {
      var ss = SpreadsheetApp.getActiveSpreadsheet && SpreadsheetApp.getActiveSpreadsheet();
      if (ss && ss.toast) {
        ss.toast(
          'property_id: ' + (result.property_id || '') + ' · svc ' + ((result.services || []).length) +
            ' · contactos ' +
            ((result.contacts || []).length),
          'Propiedad agregada',
          10
        );
      }
    }
  } catch (e) {
    /* toast opcional */
  }
  notifyOperator_(title, msg);
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

function hasSpreadsheetUi_() {
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getUi) return false;
    SpreadsheetApp.getUi();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Prompt OK/Cancel. Sin UI → null. Cancel → false.
 * @returns {string|false|null}
 */
function tryUiPrompt_(title, message, defaultValue) {
  try {
    if (!hasSpreadsheetUi_()) return null;
    var ui = SpreadsheetApp.getUi();
    var r = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return false;
    var text = r.getResponseText();
    if (
      (text == null || String(text).trim() === '') &&
      defaultValue != null &&
      String(defaultValue) !== ''
    ) {
      return String(defaultValue);
    }
    return text == null ? '' : String(text);
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
