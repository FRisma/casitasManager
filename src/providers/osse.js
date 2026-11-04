/**
 * OSSE (agua) — prioridad #2.
 *
 * Cuenta: 119 0080934 000 1 (API: 11900809340001) | Catastro: 023220474900000 | SISA: 60358
 * Portal correcto: https://facturaweb.osse.com.ar/
 * Host incorrecto (DNS ENOTFOUND): facturaweb.osse.ar
 *
 * Hallazgos (2026-11-04):
 * - SPA Angular; API pública sin CAPTCHA: /api/unidades/UnidadByUnidadAlt, UltimasFacturas, ImprimirFactura.
 * - Full auto UrlFetchApp factible (ver docs/PROVIDERS.md + provider-fetch-feasibility.md).
 * - Este adapter aún no implementa el fetch PDF; checkAvailability debe pegarle al host .com.ar.
 * - Si DNS/portal falla → portal_inaccessible (nunca lista vacía fingiendo “sin facturas”).
 * - Mientras tanto: importManualInvoice / importManualInvoiceFromDrive.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Osse = (function () {
  var ID = 'osse';
  var PORTAL = 'https://facturaweb.osse.com.ar/';
  var API_BASE = 'https://facturaweb.osse.com.ar/api/unidades';
  function O() { return CM.ProviderInterface.OUTCOME; }

  function candidateUrls_(service) {
    var primary = (service && service.portal_url) || PORTAL;
    var alts = [
      primary,
      'https://facturaweb.osse.com.ar/',
      'https://www.ossesanjuan.com.ar/v4/',
      // Hosts legacy / rotos — se prueban al final para diagnóstico
      'https://facturaweb.osse.ar/',
      'https://www.osse.com.ar/',
    ];
    var seen = {};
    return alts.filter(function (u) {
      if (!u || seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  /** Cuenta OSSE en API = 14 dígitos sin espacios. */
  function accountDigits_(service) {
    return String((service && service.account_number) || '').replace(/\D/g, '');
  }

  function checkAvailability(service) {
    var urls = candidateUrls_(service);
    var attempts = [];
    var res = null;
    var url = urls[0];
    for (var i = 0; i < urls.length; i++) {
      url = urls[i];
      res = CM.ProviderInterface.httpGet(url);
      attempts.push({ url: url, code: res.code, error: res.error || '' });
      if (res.ok) break;
    }
    if (!res || !res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message:
          (res && (res.error || 'HTTP ' + res.code)) +
          ' — DNS/portal OSSE inaccesible desde este runtime; reintentar probeOsse() en GAS o carga manual',
        httpCode: res && res.code,
        portal: url,
        attempts: attempts,
        manualImport: true,
        capabilities: { checkAvailability: true },
      });
    }
    var captcha = CM.ProviderInterface.detectCaptcha(res.body);
    var spa = /Web Area Clientes OSSE|main-es2015|ng-version/i.test(res.body || '');
    return CM.ProviderInterface.baseStatus(ID, {
      ok: true,
      outcome: captcha ? O().AUTH_OR_CAPTCHA_REQUIRED : 'portal_reachable',
      message: captcha
        ? 'Portal reachable con captcha'
        : spa
          ? 'Portal facturaweb.osse.com.ar reachable (SPA). API /api/unidades/* lista para implementar fetch.'
          : 'Portal reachable — verificar API /api/unidades',
      httpCode: res.code,
      captcha: captcha,
      spa: spa,
      apiBase: API_BASE,
      account: service && service.account_number,
      accountDigits: accountDigits_(service),
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
    var digits = accountDigits_(service);
    return {
      outcome: O().NOT_IMPLEMENTED,
      invoices: [],
      message:
        'Portal/API OSSE reachable. Fetch PDF aún no cableado en adapter: ' +
        'UnidadByUnidadAlt → UltimasFacturas → ImprimirFactura (ver PROVIDERS.md). ' +
        'Usar importManualInvoice* mientras tanto.',
      account: service && service.account_number,
      accountDigits: digits,
      apiBase: API_BASE,
      manualImport: true,
    };
  }

  function downloadInvoice() {
    return {
      ok: false,
      outcome: O().NOT_IMPLEMENTED,
      message: 'Usar ImprimirFactura?guidId&tpoCom&preCom&numCom — implementar en siguiente iteración',
    };
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
