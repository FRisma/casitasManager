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
