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
 * 2) Copiar fileId o URL del archivo
 * 3) Menú «Importar PDF Ecogas desde Drive» — o:
 *    importManualInvoiceFromDrive('FILE_ID', { provider:'ecogas', billingPeriod:'2026-11', amount:… })
 * Acepta fileId crudo o URL de Drive (se parsea con CM.Drive.parseDriveFileId).
 */
function importManualInvoiceFromDrive(fileIdOrUrl, input) {
  var prepared = CM.Invoices.prepareManualDriveImport(
    Object.assign({}, input || {}, { fileIdOrUrl: fileIdOrUrl })
  );
  if (!prepared.ok) {
    var err = { ok: false, reason: prepared.reason, message: prepared.message };
    if (typeof Logger !== 'undefined') Logger.log(JSON.stringify(err, null, 2));
    return err;
  }
  return CM.Invoices.importManualFromDriveFile(prepared.fileId, prepared.input);
}

/** Crea/asegura Properties/…/Inbox-Manual (PDFs bajados a mano). */
function ensureManualInboxFolder() {
  return CM.Drive.ensureManualInboxFolder();
}

/** Lista PDFs recientes en Inbox-Manual (para import sin copiar fileId a mano). */
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

function probeNaturgy() {
  return probeProvider('naturgy');
}

function probeMunicipalidad() {
  return probeProvider('municipalidad');
}
