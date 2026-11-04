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
 * Alta manual con PDF ya subido a Drive.
 * 1) Subir PDF a cualquier carpeta Drive (o Invoices/…)
 * 2) Copiar fileId del archivo
 * 3) importManualInvoiceFromDrive('FILE_ID', { provider:'ecogas', billingPeriod:'2026-11', amount:… })
 */
function importManualInvoiceFromDrive(fileId, input) {
  return CM.Invoices.importManualFromDriveFile(fileId, input);
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
