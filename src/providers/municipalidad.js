/**
 * Municipalidad de Rivadavia — impuestos municipales.
 *
 * Portal: http://181.209.107.110:83/deudavencida/deuda_total.aspx
 * Hallazgos: formulario ASP.NET clásico (VIEWSTATE, txtIndice=catastro, btnBuscar).
 *
 * CRÍTICO: número catastral NO disponible.
 * Servicio configurado con enabled=false. No inventar catastro.
 * Cuando Franco provea el número, actualizar hoja Services (cadastral_number + enabled=true)
 * sin cambiar código.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Municipalidad = (function () {
  var ID = 'municipalidad';
  var PORTAL = 'http://181.209.107.110:83/deudavencida/deuda_total.aspx';
  function O() { return CM.ProviderInterface.OUTCOME; }

  function hasCadastral_(service) {
    return !!(service && String(service.cadastral_number || '').trim());
  }

  function checkAvailability(service) {
    if (!service || String(service.enabled).toLowerCase() === 'false' || service.enabled === false) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().DISABLED,
        message: 'Proveedor inactivo (enabled=false). Probable falta de catastro.',
      });
    }
    if (!hasCadastral_(service)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta cadastral_number — no inventar. Completar en hoja Services.',
      });
    }
    var res = CM.ProviderInterface.httpGet(PORTAL);
    if (!res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
      });
    }
    var hasForm = /txtIndice|btnBuscar|__VIEWSTATE/.test(res.body || '');
    return CM.ProviderInterface.baseStatus(ID, {
      ok: hasForm,
      outcome: hasForm ? 'portal_reachable' : O().PORTAL_STRUCTURE_CHANGED,
      message: hasForm
        ? 'Formulario ASP.NET reachable; listo para POST con catastro (cuando enabled)'
        : 'HTML sin campos esperados',
      httpCode: res.code,
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
    if (!service || !hasCadastral_(service) || String(service.enabled).toLowerCase() === 'false') {
      return {
        outcome: O().MISSING_PROPERTY_INFO,
        invoices: [],
        message: 'Municipalidad inactiva o sin catastro — 0 facturas inventadas',
      };
    }
    // Implementación POST ASP.NET pendiente de activación real
    return {
      outcome: O().NOT_IMPLEMENTED,
      invoices: [],
      message:
        'Catastro presente pero parser ASP.NET postback aún no activado en producción. ' +
        'Completar en siguiente iteración tras enable.',
      cadastral: service.cadastral_number,
    };
  }

  function downloadInvoice() {
    return { ok: false, outcome: O().DISABLED, message: 'Inactivo hasta tener catastro' };
  }

  function extractInvoiceMetadata() {
    return { outcome: O().DISABLED, metadata: null };
  }

  function getOutstandingDebt() {
    return { outcome: O().DISABLED, debt: null, note: 'No inferir pago por ausencia de deuda' };
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
  module.exports = CM.Providers.Municipalidad;
}
