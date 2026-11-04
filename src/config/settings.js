/**
 * Settings / Script Properties / dry-run / entorno.
 */

var CM = CM || {};
CM.Settings = (function () {
  var KEYS = {
    ENVIRONMENT: 'ENVIRONMENT',
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    PROPERTY_FOLDER_ID: 'PROPERTY_FOLDER_ID',
    DRY_RUN: 'DRY_RUN',
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    OWNER_APPROVAL_MONTHLY: 'OWNER_APPROVAL_MONTHLY',
    LAST_RUN_AT: 'LAST_RUN_AT',
    /** Solo para sendTestNotifyAllConfiguredContacts — valor esperado: yes */
    ALLOW_TEST_TENANT_SEND: 'ALLOW_TEST_TENANT_SEND',
    /**
     * Token query de Widergy GET /api/v1/bills/public_pdf?token=…
     * Pegado por Franco desde Network tras abrir boleta (sesión humana).
     * Solo Script Properties — nunca commitear. Expira; renovar al fallar.
     */
    NATURGY_SESSION_TOKEN: 'NATURGY_SESSION_TOKEN',
  };

  function props_() {
    if (typeof PropertiesService === 'undefined') {
      if (!CM._memProps) CM._memProps = {};
      return {
        getProperty: function (k) {
          return CM._memProps[k] || null;
        },
        setProperty: function (k, v) {
          CM._memProps[k] = String(v);
        },
        getProperties: function () {
          return Object.assign({}, CM._memProps);
        },
        deleteProperty: function (k) {
          delete CM._memProps[k];
        },
      };
    }
    return PropertiesService.getScriptProperties();
  }

  function get(key, fallback) {
    var v = props_().getProperty(key);
    return v == null || v === '' ? fallback : v;
  }

  function set(key, value) {
    props_().setProperty(key, value == null ? '' : String(value));
  }

  function getEnvironment() {
    return get(KEYS.ENVIRONMENT, 'DEV');
  }

  function isProd() {
    return getEnvironment() === 'PROD';
  }

  function isDev() {
    return !isProd();
  }

  function isDryRun() {
    var v = get(KEYS.DRY_RUN, 'true');
    return String(v).toLowerCase() === 'true' || v === '1';
  }

  function setDryRun(enabled) {
    set(KEYS.DRY_RUN, enabled ? 'true' : 'false');
  }

  /**
   * Aprobación explícita del informe mensual.
   * Formato: YYYY-MM (período aprobado) o vacío.
   */
  function getMonthlyApprovalPeriod() {
    return get(KEYS.OWNER_APPROVAL_MONTHLY, '');
  }

  function setMonthlyApprovalPeriod(period) {
    set(KEYS.OWNER_APPROVAL_MONTHLY, period || '');
  }

  function clearMonthlyApproval() {
    set(KEYS.OWNER_APPROVAL_MONTHLY, '');
  }

  function timezone() {
    return CM.Dates.TZ;
  }

  function getAll() {
    return props_().getProperties();
  }

  return {
    KEYS: KEYS,
    get: get,
    set: set,
    getEnvironment: getEnvironment,
    isProd: isProd,
    isDev: isDev,
    isDryRun: isDryRun,
    setDryRun: setDryRun,
    getMonthlyApprovalPeriod: getMonthlyApprovalPeriod,
    setMonthlyApprovalPeriod: setMonthlyApprovalPeriod,
    clearMonthlyApproval: clearMonthlyApproval,
    timezone: timezone,
    getAll: getAll,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Settings;
}
