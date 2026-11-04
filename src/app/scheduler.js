/**
 * Triggers días 1, 10, 20, 28 — America/Argentina/Buenos_Aires.
 */

var CM_TRIGGER_HANDLER = 'runDailyCheck';

function setupTriggers() {
  removeTriggers();
  var days = [1, 10, 20, 28];
  days.forEach(function (day) {
    ScriptApp.newTrigger(CM_TRIGGER_HANDLER)
      .timeBased()
      .onMonthDay(day)
      .atHour(8)
      .inTimezone(CM.Dates.TZ)
      .create();
  });
  CM.Logging.ok('setupTriggers', 'Triggers creados para días ' + days.join(','));
  return { ok: true, days: days, handler: CM_TRIGGER_HANDLER, timezone: CM.Dates.TZ };
}

function removeTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === CM_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  CM.Logging.info('removeTriggers', 'Eliminados ' + removed);
  return { removed: removed };
}

/**
 * Punto de entrada del trigger + ejecución manual.
 */
function runDailyCheck() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    CM.Logging.warn('runDailyCheck', 'Lock ocupado — skip');
    return { ok: false, reason: 'lock' };
  }
  try {
    if (CM.ProviderInterface && CM.ProviderInterface.bootstrap) {
      CM.ProviderInterface.bootstrap();
    }
    CM.Settings.set(CM.Settings.KEYS.LAST_RUN_AT, CM.Logging.nowTs());
    var providers = runAllProviders();
    var reminders = CM.Notifications.sendPendingPaymentReminders();
    CM.Logging.ok('runDailyCheck', 'Completado', {
      providers: providers.summary,
      reminders: reminders.count,
    });
    return { ok: true, providers: providers, reminders: reminders };
  } catch (e) {
    CM.Logging.error('runDailyCheck', String(e));
    try {
      CM.Notifications.notifyPortalIssue('scheduler', String(e));
    } catch (e2) {
      /* ignore */
    }
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

function runAllProviders() {
  var order = CM.ServiceCatalog.providerPriority();
  var results = {};
  order.forEach(function (id) {
    results[id] = runProvider(id);
  });
  var summary = {};
  Object.keys(results).forEach(function (k) {
    summary[k] = results[k] && results[k].outcome;
  });
  return { results: results, summary: summary };
}

/**
 * Ejecuta un proveedor: availability → fetch → upsert metadata (sin inventar).
 */
function runProvider(providerId) {
  providerId = String(providerId || '').toLowerCase();
  var adapter = CM.ProviderInterface.get(providerId);
  if (!adapter) {
    CM.Logging.error('runProvider', 'Adapter desconocido: ' + providerId);
    return { outcome: 'error', message: 'unknown provider' };
  }

  var serviceRow = null;
  try {
    var services = CM.Sheets.list(CM.Sheets.SHEET_NAMES.SERVICES);
    for (var i = 0; i < services.length; i++) {
      if (String(services[i].provider).toLowerCase() === providerId) {
        serviceRow = services[i];
        break;
      }
    }
  } catch (e) {
    // Sheets aún no configurado
    serviceRow = CM.ServiceCatalog.getByProvider(providerId);
  }

  if (!serviceRow) serviceRow = CM.ServiceCatalog.getByProvider(providerId);

  var enabled =
    serviceRow &&
    (serviceRow.enabled === true ||
      String(serviceRow.enabled).toLowerCase() === 'true' ||
      String(serviceRow.enabled) === 'TRUE');

  if (serviceRow && !enabled) {
    CM.Logging.info('runProvider', providerId + ' disabled', { service_id: serviceRow.service_id });
    return { outcome: CM.ProviderInterface.OUTCOME.DISABLED, provider: providerId };
  }

  var status = adapter.checkAvailability(serviceRow);
  CM.Logging.info('runProvider.check', providerId, status, serviceRow && serviceRow.service_id);

  if (serviceRow && serviceRow.__row) {
    var patch = Object.assign({}, serviceRow, { last_checked_at: CM.Logging.nowTs() });
    delete patch.__row;
    try {
      CM.Sheets.updateRow(CM.Sheets.SHEET_NAMES.SERVICES, serviceRow.__row, patch);
    } catch (e) {
      /* ignore */
    }
  }

  if (
    status.outcome === CM.ProviderInterface.OUTCOME.PORTAL_INACCESSIBLE ||
    status.outcome === CM.ProviderInterface.OUTCOME.AUTH_OR_CAPTCHA_REQUIRED
  ) {
    try {
      CM.Notifications.notifyPortalIssue(providerId, status.message, status);
    } catch (e) {
      /* ignore if sheets/mail not ready */
    }
  }

  var period = CM.Dates.currentBillingPeriod();
  var fetched = adapter.fetchInvoices(serviceRow, { limit: 12 });

  // Upsert + PDF (OSSE ImprimirFactura / Municipalidad boleta → Drive).
  // Adapters sin download quedan metadata-only (maxDownloads 0).
  var autoPdfProviders = { osse: 3, municipalidad: 1 };
  var maxDl = Object.prototype.hasOwnProperty.call(autoPdfProviders, providerId)
    ? autoPdfProviders[providerId]
    : 0;
  var persisted = CM.Invoices.persistProviderFetch({
    providerId: providerId,
    service: serviceRow,
    fetched: fetched,
    download: true,
    billingPeriod: period,
    preferLatest: maxDl > 0,
    maxDownloads: maxDl,
  });

  (persisted.upserts || []).forEach(function (up) {
    if (up.action === 'inserted') {
      try {
        var found = CM.Sheets.findInvoiceById(up.record.invoice_id);
        CM.Notifications.notifyNewInvoice(
          Object.assign({}, up.record, { __row: found && found.__row })
        );
      } catch (e) {
        CM.Logging.warn('runProvider', 'notify failed', String(e));
      }
    }
  });

  return {
    provider: providerId,
    outcome: persisted.outcome || fetched.outcome || status.outcome,
    status: status,
    fetch: {
      outcome: fetched.outcome,
      message: fetched.message,
      count: (fetched.invoices || []).length,
    },
    persist: persisted,
    upserts: persisted.upserts || [],
    pdfCount: persisted.pdfCount || 0,
  };
}

function sendPendingPaymentReminders() {
  return CM.Notifications.sendPendingPaymentReminders();
}
