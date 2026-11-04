/**
 * Entrypoints globales CasitasManager.
 * Apps Script carga todos los .js en scope global; CM.* agrupa módulos.
 */

function getSystemStatus() {
  return {
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
}

function generateMonthlyReport(period) {
  return CM.Notifications.generateMonthlyReport(period);
}

function previewMonthlyReport(period) {
  return CM.Notifications.previewMonthlyReport(period);
}

function sendMonthlyReport(period) {
  return CM.Notifications.sendMonthlyReport(period);
}

/**
 * Registro manual de pago (owner).
 * Ejemplo: registerPayment({ invoice_id: '…', payment_date: '2026-11-01', amount: 1234.56 })
 */
function registerPayment(input) {
  return CM.Payments.registerPayment(input);
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
