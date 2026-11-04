/**
 * OSSE (agua) — prioridad #2.
 *
 * Cuenta: 119 0080934 000 1 | Catastro: 023220474900000 | SISA: 60358
 * Portal declarado: https://facturaweb.osse.ar
 *
 * Hallazgos (2026-11-04):
 * - Desde este entorno cloud: DNS de facturaweb.osse.ar / osse.com.ar NO resuelve
 *   (ENOTFOUND). No se pudo inspeccionar HTML ni endpoints PDF.
 * - El adapter intenta UrlFetchApp en runtime GAS (red de Google puede diferir).
 * - Si el dominio sigue caído → portal_inaccessible (no lista vacía de facturas).
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Osse = (function () {
  var ID = 'osse';
  var PORTAL = 'https://facturaweb.osse.ar';
  function O() { return CM.ProviderInterface.OUTCOME; }

  function checkAvailability(service) {
    var url = (service && service.portal_url) || PORTAL;
    var res = CM.ProviderInterface.httpGet(url);
    if (!res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message:
          (res.error || 'HTTP ' + res.code) +
          ' — verificar dominio facturaweb.osse.ar desde la cuenta Google del propietario',
        httpCode: res.code,
        portal: url,
        capabilities: { checkAvailability: true },
      });
    }
    var captcha = CM.ProviderInterface.detectCaptcha(res.body);
    return CM.ProviderInterface.baseStatus(ID, {
      ok: true,
      outcome: captcha ? O().AUTH_OR_CAPTCHA_REQUIRED : 'portal_reachable',
      message: captcha
        ? 'Portal reachable con captcha'
        : 'Portal reachable — falta mapear endpoint de factura (pendiente inspección HTML en GAS)',
      httpCode: res.code,
      captcha: captcha,
      account: service && service.account_number,
      capabilities: {
        checkAvailability: true,
        fetchInvoices: false,
        downloadInvoice: false,
        extractInvoiceMetadata: false,
        getOutstandingDebt: false,
      },
    });
  }

  function fetchInvoices(service) {
    var avail = checkAvailability(service);
    if (!avail.ok) {
      return { outcome: avail.outcome, invoices: [], message: avail.message };
    }
    if (avail.outcome === O().AUTH_OR_CAPTCHA_REQUIRED) {
      return { outcome: avail.outcome, invoices: [], message: avail.message };
    }
    return {
      outcome: O().NOT_IMPLEMENTED,
      invoices: [],
      message:
        'Portal reachable pero aún sin parser de facturas (DNS falló en cloud probe). ' +
        'Ejecutar probeOsse() en Apps Script tras auth de Franco y documentar en PROVIDERS.md.',
      account: service && service.account_number,
    };
  }

  function downloadInvoice() {
    return { ok: false, outcome: O().NOT_IMPLEMENTED, message: 'Pendiente mapeo de endpoint PDF OSSE' };
  }

  function extractInvoiceMetadata() {
    return { outcome: O().NOT_IMPLEMENTED, metadata: null };
  }

  function getOutstandingDebt() {
    return {
      outcome: O().NOT_IMPLEMENTED,
      debt: null,
      note: 'No inferir pago por ausencia de deuda',
    };
  }

  function getProviderStatus(service) {
    return checkAvailability(service || CM.ServiceCatalog.getByProvider(ID));
  }

  var adapter = {
    id: ID,
    portal: PORTAL,
    checkAvailability: checkAvailability,
    fetchInvoices: fetchInvoices,
    downloadInvoice: downloadInvoice,
    extractInvoiceMetadata: extractInvoiceMetadata,
    getOutstandingDebt: getOutstandingDebt,
    getProviderStatus: getProviderStatus,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Osse;
}
