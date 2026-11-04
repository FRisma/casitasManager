/**
 * Bootstrap idempotente de Drive + Sheets + Script Properties.
 * Ejecutar en el editor Apps Script tras clasp push (cuenta de Franco).
 */

/**
 * Setup del entorno actual (DEV por defecto hasta que ENVIRONMENT=PROD).
 * Idempotente: re-ejecutar no duplica carpetas ni filas semilla.
 */
function setupEnvironment() {
  if (CM.ProviderInterface && CM.ProviderInterface.bootstrap) {
    CM.ProviderInterface.bootstrap();
  }
  var env = CM.Settings.getEnvironment() || 'DEV';
  CM.Settings.set(CM.Settings.KEYS.ENVIRONMENT, env);
  // DEV arranca en dry-run por seguridad
  if (env === 'DEV' && CM.Settings.get(CM.Settings.KEYS.DRY_RUN) == null) {
    CM.Settings.setDryRun(true);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tree = CM.Drive.ensureEnvironmentTree(env);

    var ss;
    var existingId = CM.Settings.get(CM.Settings.KEYS.SPREADSHEET_ID);
    if (existingId) {
      ss = SpreadsheetApp.openById(existingId);
    } else {
      var ssName = 'CasitasManager - Property Management (' + env + ')';
      ss = SpreadsheetApp.create(ssName);
      CM.Settings.set(CM.Settings.KEYS.SPREADSHEET_ID, ss.getId());
      // Mover spreadsheet a carpeta del entorno
      try {
        var file = DriveApp.getFileById(ss.getId());
        var root = DriveApp.getFolderById(tree.rootId);
        root.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (e) {
        CM.Logging.warn('setupEnvironment', 'No se pudo mover spreadsheet a carpeta', String(e));
      }
    }

    CM.Sheets.ensureSchema(ss);
    CM.Sheets.seedIfEmpty(ss);
    CM.Sheets.setConfig('root_folder_id', tree.rootId, '');
    CM.Sheets.setConfig('property_folder_id', tree.propertyId, '');
    CM.Sheets.setConfig('spreadsheet_id', ss.getId(), '');
    CM.Sheets.setConfig('spreadsheet_url', ss.getUrl(), '');
    CM.Sheets.setConfig('environment', env, '');

    CM.Logging.ok('setupEnvironment', 'Setup OK ' + env, {
      spreadsheetId: ss.getId(),
      rootFolderId: tree.rootId,
    });

    return {
      ok: true,
      environment: env,
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl(),
      drive: tree,
      dryRun: CM.Settings.isDryRun(),
    };
  } finally {
    lock.releaseLock();
  }
}

/** Alias explícito DEV */
function setupDevEnvironment() {
  CM.Settings.set(CM.Settings.KEYS.ENVIRONMENT, 'DEV');
  CM.Settings.setDryRun(true);
  return setupEnvironment();
}

/**
 * Prepara propiedades PROD (NO activa triggers ni dryRun=false).
 * Franco debe confirmar antes de setupTriggers en PROD.
 */
function setupProdEnvironment() {
  CM.Settings.set(CM.Settings.KEYS.ENVIRONMENT, 'PROD');
  // Mantener dry-run hasta aprobación explícita
  CM.Settings.setDryRun(true);
  var result = setupEnvironment();
  result.warning =
    'PROD creado con DRY_RUN=true y SIN triggers. Ver docs/OPERATIONS.md checklist.';
  return result;
}

/** Aprueba el informe de un período para envío (owner). */
function approveMonthlyReport(period) {
  period = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
  CM.Settings.setMonthlyApprovalPeriod(period);
  CM.Logging.ok('approveMonthlyReport', 'Aprobado ' + period);
  return { ok: true, period: period };
}

function clearMonthlyReportApproval() {
  CM.Settings.clearMonthlyApproval();
  return { ok: true };
}

/** Activa/desactiva dry-run (solo owner). */
function setDryRunMode(enabled) {
  CM.Settings.setDryRun(!!enabled);
  return { dryRun: CM.Settings.isDryRun() };
}

/** Guarda token Telegram en Script Properties (no commitear). */
function setTelegramBotToken(token) {
  if (!token) throw new Error('token vacío');
  CM.Settings.set(CM.Settings.KEYS.TELEGRAM_BOT_TOKEN, String(token).trim());
  return { ok: true, configured: CM.Telegram.isConfigured() };
}
