/**
 * Contrato de proveedores + helpers UrlFetch.
 *
 * Estados a distinguir (no tratar todo fallo como "sin facturas"):
 * 1 invoice_not_available_yet
 * 2 available_not_downloadable
 * 3 downloaded_ok
 * 4 portal_inaccessible
 * 5 portal_structure_changed
 * 6 missing_property_info
 * 7 auth_or_captcha_required
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.ProviderInterface = (function () {
  var OUTCOME = {
    INVOICE_NOT_AVAILABLE_YET: 'invoice_not_available_yet',
    AVAILABLE_NOT_DOWNLOADABLE: 'available_not_downloadable',
    DOWNLOADED_OK: 'downloaded_ok',
    PORTAL_INACCESSIBLE: 'portal_inaccessible',
    PORTAL_STRUCTURE_CHANGED: 'portal_structure_changed',
    MISSING_PROPERTY_INFO: 'missing_property_info',
    AUTH_OR_CAPTCHA_REQUIRED: 'auth_or_captcha_required',
    NOT_IMPLEMENTED: 'not_implemented',
    DISABLED: 'disabled',
    ERROR: 'error',
  };

  function baseStatus(providerId, extras) {
    return Object.assign(
      {
        provider: providerId,
        checkedAt: CM.Logging.nowTs(),
        ok: false,
        outcome: OUTCOME.NOT_IMPLEMENTED,
        message: '',
        capabilities: {
          checkAvailability: false,
          fetchInvoices: false,
          downloadInvoice: false,
          extractInvoiceMetadata: false,
          getOutstandingDebt: false,
        },
      },
      extras || {}
    );
  }

  function httpGet(url, options) {
    options = options || {};
    if (typeof UrlFetchApp === 'undefined') {
      return {
        ok: false,
        code: 0,
        outcome: OUTCOME.PORTAL_INACCESSIBLE,
        error: 'UrlFetchApp no disponible (runtime local)',
        body: '',
        headers: {},
      };
    }
    try {
      var res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: options.followRedirects !== false,
        headers: options.headers || { 'User-Agent': 'CasitasManager/1.0 (Google Apps Script)' },
        validateHttpsCertificates: options.validateHttpsCertificates !== false,
      });
      var code = res.getResponseCode();
      var headers = res.getAllHeaders();
      var body = res.getContentText();
      return {
        ok: code >= 200 && code < 400,
        code: code,
        body: body,
        headers: headers,
        contentType: headers['Content-Type'] || headers['content-type'] || '',
        blob: res.getBlob(),
      };
    } catch (e) {
      return {
        ok: false,
        code: 0,
        outcome: OUTCOME.PORTAL_INACCESSIBLE,
        error: String(e),
        body: '',
        headers: {},
      };
    }
  }

  function httpPost(url, payload, options) {
    options = options || {};
    if (typeof UrlFetchApp === 'undefined') {
      return {
        ok: false,
        code: 0,
        outcome: OUTCOME.PORTAL_INACCESSIBLE,
        error: 'UrlFetchApp no disponible',
        body: '',
        headers: {},
        contentType: '',
      };
    }
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        muteHttpExceptions: true,
        payload: payload,
        contentType: options.contentType,
        headers: options.headers || {},
        followRedirects: options.followRedirects !== false,
        validateHttpsCertificates: options.validateHttpsCertificates !== false,
      });
      var headers = res.getAllHeaders();
      return {
        ok: res.getResponseCode() >= 200 && res.getResponseCode() < 400,
        code: res.getResponseCode(),
        body: res.getContentText(),
        blob: res.getBlob(),
        headers: headers,
        contentType: headers['Content-Type'] || headers['content-type'] || '',
      };
    } catch (e) {
      return {
        ok: false,
        code: 0,
        outcome: OUTCOME.PORTAL_INACCESSIBLE,
        error: String(e),
        body: '',
        headers: {},
        contentType: '',
      };
    }
  }

  function detectCaptcha(html) {
    var s = String(html || '').toLowerCase();
    return (
      s.indexOf('recaptcha') >= 0 ||
      s.indexOf('g-recaptcha') >= 0 ||
      s.indexOf('hcaptcha') >= 0 ||
      s.indexOf('cf-challenge') >= 0
    );
  }

  /** Registro de adapters */
  var registry_ = {};

  function register(id, adapter) {
    registry_[String(id || '').toLowerCase()] = adapter;
  }

  function get(id) {
    ensureFromNamespace_();
    return registry_[String(id || '').toLowerCase()] || null;
  }

  function list() {
    ensureFromNamespace_();
    return Object.keys(registry_);
  }

  /**
   * Apps Script no garantiza orden de carga de archivos.
   * Re-registra desde CM.Providers.* si el IIFE corrió antes que este módulo.
   */
  function ensureFromNamespace_() {
    if (!CM.Providers) return;
    ['Ecogas', 'Osse', 'Naturgy', 'Municipalidad'].forEach(function (name) {
      var adapter = CM.Providers[name];
      if (adapter && adapter.id && !registry_[adapter.id]) {
        registry_[adapter.id] = adapter;
      }
    });
  }

  function bootstrap() {
    ensureFromNamespace_();
    return list();
  }

  /**
   * Stub adapter que cumple la interfaz reportando limitaciones.
   */
  function createStub(providerId, defaults) {
    defaults = defaults || {};
    return {
      id: providerId,
      checkAvailability: function (service) {
        return baseStatus(providerId, {
          ok: false,
          outcome: defaults.outcome || OUTCOME.NOT_IMPLEMENTED,
          message: defaults.message || 'Adapter stub',
          service_id: service && service.service_id,
        });
      },
      fetchInvoices: function () {
        return { outcome: OUTCOME.NOT_IMPLEMENTED, invoices: [], message: 'No implementado' };
      },
      downloadInvoice: function () {
        return { outcome: OUTCOME.NOT_IMPLEMENTED, ok: false };
      },
      extractInvoiceMetadata: function () {
        return { outcome: OUTCOME.NOT_IMPLEMENTED, metadata: null };
      },
      getOutstandingDebt: function () {
        return { outcome: OUTCOME.NOT_IMPLEMENTED, debt: null, note: 'No inferir pago por ausencia de deuda' };
      },
      getProviderStatus: function () {
        return baseStatus(providerId, defaults);
      },
    };
  }

  return {
    OUTCOME: OUTCOME,
    baseStatus: baseStatus,
    httpGet: httpGet,
    httpPost: httpPost,
    detectCaptcha: detectCaptcha,
    register: register,
    get: get,
    list: list,
    bootstrap: bootstrap,
    createStub: createStub,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.ProviderInterface;
}
