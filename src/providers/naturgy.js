/**
 * Naturgy San Juan (electricidad) — prioridad #3.
 *
 * Suministro: 20004193466 | Medidor: 0142679
 * Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta
 *
 * Hallazgos (2026-11-04):
 * - HTML es shell React (static/js/*.chunk.js). Sin formularios server-rendered.
 * - Bundle main.* expone rutas Widergy: /api/v1/bills/public_pdf, /api/v1/bills/bill_detail,
 *   /api/v1/accounts/payment_information — llamadas con `token` en query (sesión).
 * - UrlFetch sin token recibe el shell HTML (text/html 200), no JSON/PDF.
 * - Turnstile/Cloudflare aparece en dependencias del bundle → riesgo anti-bot.
 * - Workflow práctico MVP: importManualInvoice / importManualInvoiceFromDrive.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Naturgy = (function () {
  var ID = 'naturgy';
  var PORTAL = 'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta';
  var ORIGIN = 'https://oficinavirtual.naturgysj.com.ar';
  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  function checkAvailability(service) {
    var res = CM.ProviderInterface.httpGet(PORTAL);
    if (!res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
      });
    }
    var spa = /static\/js\/.*\.chunk\.js|react/i.test(res.body || '');
    return CM.ProviderInterface.baseStatus(ID, {
      ok: true,
      outcome: spa ? O().AUTH_OR_CAPTCHA_REQUIRED : 'portal_reachable',
      message: spa
        ? 'SPA React reachable; APIs /api/v1/bills/* requieren token de sesión (no público)'
        : 'Portal reachable',
      httpCode: res.code,
      spa: spa,
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

  function looksLikeHtmlShell_(body, contentType) {
    var ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('html') >= 0) return true;
    var s = String(body || '').slice(0, 200).toLowerCase();
    return s.indexOf('<!doctype html') >= 0 || s.indexOf('<html') >= 0;
  }

  /**
   * Probes de endpoints descubiertos en el bundle (sin token).
   * No inventa facturas si la respuesta es shell HTML o no-JSON.
   */
  function probeApis_(account) {
    var candidates = [
      ORIGIN + '/api/v1/bills/public_pdf?supply=' + encodeURIComponent(account),
      ORIGIN + '/api/v1/bills/bill_detail?supply=' + encodeURIComponent(account),
      ORIGIN + '/api/v1/accounts/payment_information?account_id=' + encodeURIComponent(account),
      ORIGIN + '/api/v1/accounts/full_data?account=' + encodeURIComponent(account),
      ORIGIN + '/api/v2/bills/public_pdf?token=probe',
    ];
    var results = [];
    candidates.forEach(function (url) {
      var res = CM.ProviderInterface.httpGet(url, {
        headers: {
          Accept: 'application/json, application/pdf, */*',
          'User-Agent': 'CasitasManager/1.0',
          Referer: PORTAL,
        },
      });
      var htmlShell = looksLikeHtmlShell_(res.body, res.contentType);
      results.push({
        url: url,
        code: res.code,
        contentType: res.contentType,
        jsonLikely: !htmlShell && (res.contentType || '').indexOf('json') >= 0,
        pdfLikely: !htmlShell && (res.contentType || '').indexOf('pdf') >= 0,
        htmlShell: htmlShell,
        bodySample: String(res.body || '').slice(0, 120),
      });
    });
    return results;
  }

  function fetchInvoices(service) {
    var account = (service && service.account_number) || '';
    if (!account) {
      return { outcome: O().MISSING_PROPERTY_INFO, invoices: [], message: 'Falta account_number' };
    }
    var avail = checkAvailability(service);
    if (avail.outcome === O().PORTAL_INACCESSIBLE) {
      return { outcome: avail.outcome, invoices: [], message: avail.message };
    }
    var probes = probeApis_(account);
    var usable = probes.filter(function (p) {
      return (p.jsonLikely || p.pdfLikely) && p.code >= 200 && p.code < 300 && !p.htmlShell;
    });
    if (!usable.length) {
      return {
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        invoices: [],
        message:
          'Endpoints /api/v1/bills/* existen en el SPA pero sin token de sesión UrlFetch recibe HTML shell. ' +
          'Usar importManualInvoice / importManualInvoiceFromDrive. No inventar facturas.',
        probes: probes,
        account: account,
        manualImport: true,
      };
    }
    return {
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      invoices: [],
      message: 'Respuesta API no-HTML detectada — revisar manualmente antes de mapear campos',
      probes: usable,
      account: account,
    };
  }

  function downloadInvoice() {
    return {
      ok: false,
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      message: '/api/v1/bills/public_pdf requiere token de sesión; no disponible vía UrlFetch anónimo',
    };
  }

  function extractInvoiceMetadata() {
    return { outcome: O().NOT_IMPLEMENTED, metadata: null };
  }

  function getOutstandingDebt() {
    return { outcome: O().NOT_IMPLEMENTED, debt: null, note: 'No inferir pago por ausencia de deuda' };
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
    probeApis_: probeApis_,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Naturgy;
}
