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
     * JWT de sesión Widergy (Authorization raw, sin Bearer). Cache tras login.
     * Solo Script Properties — nunca commitear. Expira; se renueva vía sessions.
     */
    NATURGY_SESSION_TOKEN: 'NATURGY_SESSION_TOKEN',
    /** Email portal Naturgy — solo Script Properties. Nunca commit / log. */
    NATURGY_EMAIL: 'NATURGY_EMAIL',
    /** Password portal Naturgy — solo Script Properties. Nunca commit / log / echo. */
    NATURGY_PASSWORD: 'NATURGY_PASSWORD',
    /**
     * Cookie header post-login Ecogas (opcional; listing futuro). Solo Script Properties.
     * Nunca commitear ni loguear. Expira; renovar tras login humano.
     */
    ECOGAS_SESSION_COOKIE: 'ECOGAS_SESSION_COOKIE',
    /**
     * Número de comprobante Ecogas (= form field `pp`, ej. 0401B60797913A).
     * Solo Script Properties. Cambia por boleta; no hardcodear en adapters.
     */
    ECOGAS_PRINT_PP: 'ECOGAS_PRINT_PP',
    /**
     * Prefijo de sesión del bot Telegram ops (owner).
     * Clave completa: TG_BOT_SESSION_<chatId> → JSON.
     */
    TG_BOT_SESSION_PREFIX: 'TG_BOT_SESSION_',
    /**
     * Offset de getUpdates (polling 1 min). Entero; vacío = 0.
     * Tras cada lote se guarda last update_id + 1.
     */
    TG_BOT_UPDATE_OFFSET: 'TG_BOT_UPDATE_OFFSET',
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
