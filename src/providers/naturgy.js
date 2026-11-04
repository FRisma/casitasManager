/**
 * Naturgy San Juan (electricidad) — prioridad #3.
 *
 * Suministro: 20004193466 | Medidor: 0142679
 * Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta
 *
 * Hallazgos (2026-11-04):
 * - HTML es shell React (static/js/*.chunk.js). Sin formularios server-rendered.
 * - UrlFetchApp del HTML estático no expone facturas; hace falta descubrir API XHR.
 * - Se intenta un probe de rutas comunes /api; si no hay JSON útil → documentar limitación.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Naturgy = (function () {
  var ID = 'naturgy';
  var PORTAL = 'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta';
  var ORIGIN = 'https://oficinavirtual.naturgysj.com.ar';
  function O() { return CM.ProviderInterface.OUTCOME; }

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
      outcome: spa ? O().PORTAL_STRUCTURE_CHANGED : 'portal_reachable',
      message: spa
        ? 'SPA React detectada — facturas no están en HTML inicial; requiere API'
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

  /**
   * Intentos best-effort de endpoints públicos (pueden 404).
   * No inventa facturas si la respuesta no es parseable.
   */
  function probeApis_(account) {
    var candidates = [
      ORIGIN + '/api/pagos/consulta?suministro=' + encodeURIComponent(account),
      ORIGIN + '/api/publico/pagos/consulta?numero=' + encodeURIComponent(account),
      ORIGIN + '/publico/pagos/consulta?suministro=' + encodeURIComponent(account),
    ];
    var results = [];
    candidates.forEach(function (url) {
      var res = CM.ProviderInterface.httpGet(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'CasitasManager/1.0',
        },
      });
      results.push({
        url: url,
        code: res.code,
        contentType: res.contentType,
        jsonLikely: (res.contentType || '').indexOf('json') >= 0,
        bodySample: String(res.body || '').slice(0, 200),
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
    var jsonHit = probes.filter(function (p) {
      return p.jsonLikely && p.code >= 200 && p.code < 300;
    });
    if (!jsonHit.length) {
      return {
        outcome: O().NOT_IMPLEMENTED,
        invoices: [],
        message:
          'Sin API JSON pública usable desde UrlFetchApp. Carga manual de PDF o análisis de network ' +
          'en navegador del propietario para mapear endpoint real.',
        probes: probes,
        account: account,
      };
    }
    // Si hubiera JSON, no parseamos a ciegas inventando campos — devolver raw para revisión
    return {
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      invoices: [],
      message: 'Respuesta JSON detectada — revisar manualmente antes de mapear campos',
      probes: jsonHit,
      account: account,
    };
  }

  function downloadInvoice() {
    return { ok: false, outcome: O().NOT_IMPLEMENTED, message: 'API PDF Naturgy no mapeada' };
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
