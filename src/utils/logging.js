/**
 * Logging a ExecutionLog (Sheets) + Logger de Apps Script.
 */

var CM = CM || {};
CM.Logging = (function () {
  function nowTs() {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(new Date(), CM.Dates.TZ, "yyyy-MM-dd'T'HH:mm:ss");
    }
    return new Date().toISOString();
  }

  function newExecutionId() {
    var base = nowTs().replace(/[^0-9]/g, '');
    var rnd = Math.floor(Math.random() * 10000);
    return 'exec_' + base + '_' + rnd;
  }

  /**
   * @param {object} entry
   * @param {string} [entry.service_id]
   * @param {string} entry.operation
   * @param {string} entry.status  ok|error|warn|info
   * @param {string} entry.message
   * @param {string|object} [entry.details]
   */
  function log(entry) {
    var row = {
      execution_id: entry.execution_id || newExecutionId(),
      timestamp: entry.timestamp || nowTs(),
      service_id: entry.service_id || '',
      operation: entry.operation || '',
      status: entry.status || 'info',
      message: entry.message || '',
      details:
        typeof entry.details === 'object'
          ? JSON.stringify(entry.details)
          : entry.details || '',
    };

    var line =
      '[' +
      row.status +
      '] ' +
      row.operation +
      (row.service_id ? ' (' + row.service_id + ')' : '') +
      ': ' +
      row.message;

    if (typeof Logger !== 'undefined') {
      Logger.log(line + (row.details ? ' | ' + row.details : ''));
    } else if (typeof console !== 'undefined') {
      console.log(line);
    }

    try {
      if (CM.Sheets && typeof CM.Sheets.appendExecutionLog === 'function') {
        CM.Sheets.appendExecutionLog(row);
      }
    } catch (e) {
      if (typeof Logger !== 'undefined') {
        Logger.log('Logging: no se pudo escribir ExecutionLog: ' + e);
      }
    }

    return row;
  }

  function info(operation, message, details, serviceId) {
    return log({ operation: operation, status: 'info', message: message, details: details, service_id: serviceId });
  }

  function warn(operation, message, details, serviceId) {
    return log({ operation: operation, status: 'warn', message: message, details: details, service_id: serviceId });
  }

  function error(operation, message, details, serviceId) {
    return log({ operation: operation, status: 'error', message: message, details: details, service_id: serviceId });
  }

  function ok(operation, message, details, serviceId) {
    return log({ operation: operation, status: 'ok', message: message, details: details, service_id: serviceId });
  }

  return {
    log: log,
    info: info,
    warn: warn,
    error: error,
    ok: ok,
    newExecutionId: newExecutionId,
    nowTs: nowTs,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Logging;
}
