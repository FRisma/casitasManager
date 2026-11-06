/**
 * Entrypoints globales CasitasManager.
 * Apps Script carga todos los .js en scope global; CM.* agrupa módulos.
 */

function getSystemStatus() {
  if (CM.ProviderInterface && CM.ProviderInterface.bootstrap) {
    CM.ProviderInterface.bootstrap();
  }
  var status = {
    environment: CM.Settings.getEnvironment(),
    dryRun: CM.Settings.isDryRun(),
    timezone: CM.Dates.TZ,
    spreadsheetId: CM.Settings.get(CM.Settings.KEYS.SPREADSHEET_ID, ''),
    rootFolderId: CM.Settings.get(CM.Settings.KEYS.ROOT_FOLDER_ID, ''),
    telegramConfigured: CM.Telegram.isConfigured(),
    monthlyApproval: CM.Settings.getMonthlyApprovalPeriod() || null,
    providers: CM.ProviderInterface.list(),
    lastRunAt: CM.Settings.get(CM.Settings.KEYS.LAST_RUN_AT, ''),
  };
  // Apps Script Execution log no muestra el return value — hay que loguear.
  var json = JSON.stringify(status, null, 2);
  if (typeof Logger !== 'undefined') Logger.log(json);
  if (typeof console !== 'undefined') console.log(json);
  return status;
}

function generateMonthlyReport(period) {
  period = period || CM.Dates.currentBillingPeriod();
  return CM.Notifications.generateMonthlyReport(period);
}

function previewMonthlyReport(period) {
  // Si se omite (o string vacío desde el prompt del editor) → mes actual YYYY-MM.
  period = period || CM.Dates.currentBillingPeriod();
  var preview = CM.Notifications.previewMonthlyReport(period);
  var summary = {
    billingPeriod: preview.report && preview.report.billingPeriod,
    itemCount: preview.report && preview.report.items ? preview.report.items.length : 0,
    total: preview.report && preview.report.total,
    dryRun: preview.report && preview.report.dryRun,
    emailRecipientsWouldBe: preview.emailPreview && preview.emailPreview.recipientsWouldBe,
    telegramRecipientsWouldBe: preview.telegramPreview && preview.telegramPreview.recipientsWouldBe,
  };
  var json = JSON.stringify(summary, null, 2);
  if (typeof Logger !== 'undefined') Logger.log(json);
  if (typeof console !== 'undefined') console.log(json);
  return preview;
}

function sendMonthlyReport(period) {
  period = period || CM.Dates.currentBillingPeriod();
  return CM.Notifications.sendMonthlyReport(period);
}

/**
 * Test REAL a owners + tenants (email y Telegram).
 * Cuerpos diferenciados: owner=ops, tenant=informativo ES.
 * No altera sendMonthlyReport (DEV sigue solo owners).
 *
 * Preferí el menú CasitasManager o:
 *   sendTestNotifyOwnersOnly() / sendTestNotifyTenantsOnly(..., 'YES_SEND_TO_TENANTS')
 *
 * Dual (ambos roles):
 *   setAllowTestTenantSend(true)
 *   sendTestNotifyAllConfiguredContacts()
 *   clearAllowTestTenantSend()
 * o: sendTestNotifyAllConfiguredContacts('2026-11', 'YES_SEND_TO_TENANTS')
 */
function sendTestNotifyAllConfiguredContacts(period, forceConfirm) {
  return CM.Notifications.sendTestNotifyAllConfiguredContacts(period, forceConfirm);
}

/** Test REAL solo owners (copy ops). Soft confirm en menú Sheet. */
function sendTestNotifyOwnersOnly(period) {
  return CM.Notifications.sendTestNotifyOwnersOnly(period);
}

/**
 * Test REAL solo tenants (copy informativa).
 * Gate: ALLOW_TEST_TENANT_SEND=yes o forceConfirm 'YES_SEND_TO_TENANTS'
 * (el menú Sheet pasa el flag tras soft confirm).
 */
function sendTestNotifyTenantsOnly(period, forceConfirm) {
  return CM.Notifications.sendTestNotifyTenantsOnly(period, forceConfirm);
}

function setAllowTestTenantSend(enabled) {
  CM.Settings.set(CM.Settings.KEYS.ALLOW_TEST_TENANT_SEND, enabled ? 'yes' : '');
  var v = CM.Settings.get(CM.Settings.KEYS.ALLOW_TEST_TENANT_SEND, '');
  if (typeof Logger !== 'undefined') Logger.log('ALLOW_TEST_TENANT_SEND=' + (v || '(unset)'));
  return { ALLOW_TEST_TENANT_SEND: v || null };
}

function clearAllowTestTenantSend() {
  return setAllowTestTenantSend(false);
}

/** Alias de probe + intento download (también vía menú CasitasManager). */
function downloadProviderInvoice(providerId) {
  return downloadProviderInvoice_(providerId);
}

/**
 * Registro manual de pago (owner).
 * Ejemplo: registerPayment({ invoice_id: '…', payment_date: '2026-11-01', amount: 1234.56 })
 */
function registerPayment(input) {
  return CM.Payments.registerPayment(input);
}

/**
 * Alta de propiedad + servicios + contactos (también menú «Agregar propiedad…»).
 * Contacts.property_id = la propiedad nueva (nunca reusa Natania por defecto).
 *
 * addProperty({
 *   property_name: 'Casa Caucete',
 *   address: '…', city: 'Caucete', province: 'San Juan',
 *   services: [
 *     { provider:'naturgy', account_number:'…' },
 *     { provider:'municipalidad', municipio:'Caucete', cadastral_number:'…' }
 *   ],
 *   contacts: [
 *     { role:'owner', name:'…', email:'…', telegram:'', active:true },
 *     { role:'tenant', name:'…', email:'…', telegram:'', active:true }
 *   ]
 * })
 */
function addProperty(input) {
  return CM.Properties.addProperty(input);
}

/** Agrega una fila Services a una property_id existente. */
function addPropertyService(propertyId, serviceInput) {
  return CM.Properties.addPropertyService(propertyId, serviceInput);
}

/** Agrega un contacto (owner|tenant) ligado a property_id. */
function addPropertyContact(propertyId, contactInput) {
  return CM.Properties.addPropertyContact(propertyId, contactInput);
}

/** Ver campos esperados para carga manual (sin inventar valores). */
function getManualInvoiceTemplate() {
  return CM.Invoices.manualImportTemplate();
}

/**
 * Alta manual solo metadatos (providers sin PDF automático).
 * Ejemplo:
 * importManualInvoice({ provider:'ecogas', billingPeriod:'2026-11', invoiceNumber:'…', amount:1234.56, dueDate:'15/11/2026' })
 */
function importManualInvoice(input) {
  return CM.Invoices.importManualMetadata(input);
}

/**
 * Helper DEV: prueba importManualInvoice con defaults TEST seguros.
 * No envía email/Telegram. Correr desde el editor: importTestInvoice()
 * Período = mes actual (YYYY-MM) para que previewMonthlyReport() lo encuentre;
 * invoiceNumber TEST-* evita chocar con boletas reales.
 */
function importTestInvoice() {
  var period = CM.Dates.currentBillingPeriod();
  var stamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || CM.Dates.TZ,
    "yyyyMMdd'T'HHmmss"
  );
  var parts = period.split('-');
  var dueDate =
    parts.length === 2 ? '28/' + parts[1] + '/' + parts[0] : CM.Dates.todayISO();
  var result = importManualInvoice({
    provider: 'ecogas',
    billingPeriod: period,
    invoiceNumber: 'TEST-IMPORT-' + stamp,
    amount: 1.0,
    currency: 'ARS',
    dueDate: dueDate,
    payment_status: 'unknown',
    notes: 'DEV importTestInvoice — safe defaults (period=' + period + ')',
  });
  var json = JSON.stringify(
    {
      billingPeriod: period,
      tip: 'Corré previewMonthlyReport() sin args (usa el mismo mes actual).',
      result: result,
    },
    null,
    2
  );
  if (typeof Logger !== 'undefined') Logger.log(json);
  if (typeof console !== 'undefined') console.log(json);
  return result;
}

/**
 * Alta manual con PDF ya subido a Drive.
 * 1) Subir PDF a cualquier carpeta Drive (o Inbox-Manual / Invoices/…)
 * 2) Copiar fileId o URL
 * 3) importManualInvoiceFromDrive('FILE_ID', { provider:'naturgy', billingPeriod:'2026-11', amount:… })
 */
function importManualInvoiceFromDrive(fileIdOrUrl, input) {
  var prepared = CM.Invoices.prepareManualDriveImport(
    Object.assign({}, input || {}, { fileIdOrUrl: fileIdOrUrl })
  );
  if (!prepared.ok) {
    return { ok: false, prepare: prepared, message: prepared.message };
  }
  return CM.Invoices.importManualFromDriveFile(prepared.fileId, prepared.input);
}

/** Crea/asegura Properties/…/Inbox-Manual (PDFs bajados a mano). */
function ensureManualInboxFolder() {
  return CM.Drive.ensureManualInboxFolder();
}

/** Lista PDFs recientes en Inbox-Manual. */
function listManualInboxPdfs(limit) {
  return CM.Drive.listRecentManualInboxPdfs(limit == null ? 10 : limit);
}

/**
 * Operación owner vía Telegram (handlers; webhook/polling fuera de MVP query-bot).
 */
function telegramOwnerCommand(command, arg1) {
  return CM.Telegram.handleOwnerCommand(command, arg1 ? [arg1] : []);
}

/** Probe manual de un portal (diagnóstico). */
function probeProvider(providerId) {
  var adapter = CM.ProviderInterface.get(providerId);
  if (!adapter) return { error: 'unknown' };
  var service = CM.ServiceCatalog.getByProvider(providerId);
  return {
    status: adapter.getProviderStatus(service),
    fetch: adapter.fetchInvoices(service),
  };
}

function probeOsse() {
  return probeProvider('osse');
}

function probeEcogas() {
  return probeProvider('ecogas');
}

/**
 * Guarda el número de comprobante Ecogas (UI) → Script Property ECOGAS_PRINT_PP
 * (form field interno `pp`, ej. 0401B60797913A). No es secreto; cambia por boleta.
 * Vacío / clearEcogasPrintPp() borra.
 */
function setEcogasPrintPp(comprobanteOrPp) {
  var v = comprobanteOrPp == null ? '' : String(comprobanteOrPp).trim();
  CM.Settings.set(CM.Settings.KEYS.ECOGAS_PRINT_PP, v);
  return {
    ok: true,
    set: !!v,
    tip: v
      ? 'Comprobante guardado. Corré downloadEcogasSessionInvoice() o menú «Descargar Ecogas por comprobante…».'
      : 'Comprobante borrado.',
  };
}

function clearEcogasPrintPp() {
  return setEcogasPrintPp('');
}

/**
 * Cookie post-login Ecogas (opcional; listing futuro). Solo Script Properties.
 * Nunca loguea el valor. PDF Imprimir NO la requiere si hay comprobante.
 */
function setEcogasSessionCookie(cookieHeader) {
  var v = cookieHeader == null ? '' : String(cookieHeader).trim();
  CM.Settings.set(CM.Settings.KEYS.ECOGAS_SESSION_COOKIE, v);
  return {
    ok: true,
    set: !!v,
    tip: v
      ? 'Cookie guardada (valor no logueado). PDF por comprobante no la necesita.'
      : 'Cookie Ecogas borrada.',
  };
}

function clearEcogasSessionCookie() {
  return setEcogasSessionCookie('');
}

/**
 * One-shot Ecogas: comprobante (pp) → POST impresion_jano sin Cookie → Drive.
 * @param {string|object} [ppOrOpts] comprobante string o { pp / comprobante }
 */
function downloadEcogasSessionInvoice(ppOrOpts) {
  var opts = {};
  if (typeof ppOrOpts === 'string') {
    opts = { pp: ppOrOpts };
  } else if (ppOrOpts && typeof ppOrOpts === 'object') {
    opts = ppOrOpts;
  }
  var comprobante = opts.pp || opts.comprobante || opts.compoundId || '';
  if (comprobante) setEcogasPrintPp(comprobante);
  var result = downloadProviderInvoice_('ecogas');
  var out = {
    ok: !!(result && (result.autoPdf || result.metadataOnly)),
    autoPdf: !!(result && result.autoPdf),
    metadataOnly: !!(result && result.metadataOnly),
    outcome: result && result.outcome,
    message: result && result.message,
    tip: result && result.autoPdf
      ? 'PDF Ecogas en Drive + fila Invoices.'
      : 'Sin PDF: setEcogasPrintPp(comprobante) o menú «Descargar Ecogas por comprobante…»; ' +
        'fallback «Importar PDF Ecogas desde Drive». Listing anónimo no existe.',
  };
  if (typeof Logger !== 'undefined') Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Probe POST Imprimir con comprobante (no escribe Drive). */
function probeEcogasPrintPdf(input) {
  if (CM.ProviderInterface && CM.ProviderInterface.bootstrap) {
    CM.ProviderInterface.bootstrap();
  }
  var adapter = CM.ProviderInterface.get('ecogas');
  if (!adapter || typeof adapter.probePrintPdf !== 'function') {
    return { ok: false, message: 'adapter Ecogas sin probePrintPdf' };
  }
  return adapter.probePrintPdf(input || {});
}

function probeNaturgy() {
  return probeProvider('naturgy');
}

/**
 * Cache JWT (Authorization raw). Solo Script Properties. No loguear el valor.
 * Preferí setNaturgyCredentials para auto-login. Vacío = clear.
 */
function setNaturgySessionToken(token) {
  var v = token == null ? '' : String(token).trim();
  if (v.toLowerCase().indexOf('bearer ') === 0) v = v.slice(7).trim();
  CM.Settings.set(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, v);
  return {
    ok: true,
    set: !!v,
    length: v.length,
    tip: v
      ? 'JWT cacheado (length=' + v.length + '). Probar menuDescargarNaturgy / downloadNaturgySessionInvoice().'
      : 'JWT borrado.',
  };
}

function clearNaturgySessionToken() {
  return setNaturgySessionToken('');
}

/**
 * Guarda email/password portal Naturgy en Script Properties (DEV o PROD).
 * NUNCA commit. NUNCA loguea ni devuelve el password. Rotá si se expuso en chat.
 */
function setNaturgyCredentials(email, password) {
  var em = email == null ? '' : String(email).trim();
  var pw = password == null ? '' : String(password);
  if (!em || !pw) {
    return {
      ok: false,
      message: 'Requiere email y password no vacíos. clearNaturgyCredentials() para borrar.',
    };
  }
  CM.Settings.set(CM.Settings.KEYS.NATURGY_EMAIL, em);
  CM.Settings.set(CM.Settings.KEYS.NATURGY_PASSWORD, pw);
  // No incluir password ni JWT en el return/log
  var out = {
    ok: true,
    emailSet: true,
    passwordSet: true,
    emailLength: em.length,
    passwordLength: pw.length,
    tip:
      'Credenciales en Script Properties. Corré menuDescargarNaturgy() o downloadNaturgySessionInvoice(). ' +
      'Si expusiste la password en chat, rotála en el portal.',
  };
  if (typeof Logger !== 'undefined') {
    Logger.log(
      JSON.stringify({
        ok: true,
        emailSet: true,
        passwordSet: true,
        emailLength: em.length,
        passwordLength: pw.length,
      })
    );
  }
  return out;
}

function clearNaturgyCredentials() {
  CM.Settings.set(CM.Settings.KEYS.NATURGY_EMAIL, '');
  CM.Settings.set(CM.Settings.KEYS.NATURGY_PASSWORD, '');
  clearNaturgySessionToken();
  return { ok: true, cleared: true, tip: 'Email/password/JWT Naturgy borrados de Script Properties.' };
}

/** ¿Hay email+password o JWT cacheado? No revela valores. */
function getNaturgyAuthStatus() {
  var email = String(CM.Settings.get(CM.Settings.KEYS.NATURGY_EMAIL, '') || '');
  var password = String(CM.Settings.get(CM.Settings.KEYS.NATURGY_PASSWORD, '') || '');
  var token = String(CM.Settings.get(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '') || '');
  return {
    emailSet: !!email,
    passwordSet: !!password,
    tokenCached: !!token,
    canAutoPdf: !!(token || (email && password)),
    tip: 'Valores no se muestran. setNaturgyCredentials / clearNaturgyCredentials.',
  };
}

/**
 * One-shot: complete_debts + login (si props) + printed_bill → Drive.
 * Nunca loguea password/JWT.
 */
function downloadNaturgySessionInvoice(tokenOrOpts) {
  var opts = {};
  if (typeof tokenOrOpts === 'string') {
    opts = { token: tokenOrOpts };
  } else if (tokenOrOpts && typeof tokenOrOpts === 'object') {
    opts = tokenOrOpts;
  }
  if (opts.token) setNaturgySessionToken(opts.token);
  if (opts.email && opts.password) setNaturgyCredentials(opts.email, opts.password);
  var result = downloadProviderInvoice_('naturgy');
  var out = {
    ok: !!(result && (result.autoPdf || result.metadataOnly)),
    autoPdf: !!(result && result.autoPdf),
    metadataOnly: !!(result && result.metadataOnly),
    outcome: result && result.outcome,
    message: result && result.message,
    tip: result && result.autoPdf
      ? 'PDF en Drive + fila Invoices.'
      : 'Sin PDF auto: setNaturgyCredentials(email, password) o menuImportarPdfNaturgy().',
  };
  if (typeof Logger !== 'undefined') Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function probeMunicipalidad() {
  return probeProvider('municipalidad');
}
