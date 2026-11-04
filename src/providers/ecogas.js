/**
 * Ecogas (gas) — prioridad #1.
 *
 * Hallazgos (2026-11-04, sonda HTTP):
 * - Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  → 200 HTML
 * - Form POST action=logon?s=p&c=0 id=form_login_po
 * - Campos: input#cliente, hidden imptoken_reimp, tipo_red=autoconsulta
 * - Google reCAPTCHA (api.js) → UrlFetchApp NO puede completar login/consulta.
 * - Workflow MVP: importManualInvoice / importManualInvoiceFromDrive.
 * Cuenta configurada: 20259678
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Ecogas = (function () {
  var ID = 'ecogas';
  var PORTAL = 'https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p';
  function O() { return CM.ProviderInterface.OUTCOME; }

  function checkAvailability(service) {
    var res = CM.ProviderInterface.httpGet(PORTAL);
    if (!res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
        capabilities: { checkAvailability: true },
      });
    }
    var hasCaptcha = CM.ProviderInterface.detectCaptcha(res.body);
    var hasCliente = /name=["']cliente["']|id=["']cliente["']/.test(res.body || '');
    if (!hasCliente) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'No se encontró input cliente en el HTML de ingreso',
        capabilities: { checkAvailability: true },
      });
    }
    return CM.ProviderInterface.baseStatus(ID, {
      ok: true,
      outcome: hasCaptcha ? O().AUTH_OR_CAPTCHA_REQUIRED : 'portal_reachable',
      message: hasCaptcha
        ? 'Portal reachable; reCAPTCHA bloquea automatización UrlFetchApp'
        : 'Portal reachable',
      httpCode: res.code,
      captcha: hasCaptcha,
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
    if (avail.outcome === O().PORTAL_INACCESSIBLE || avail.outcome === O().PORTAL_STRUCTURE_CHANGED) {
      return { outcome: avail.outcome, invoices: [], message: avail.message };
    }
    return {
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      invoices: [],
        message:
        'Ecogas requiere reCAPTCHA en el ingreso (form logon?s=p). No se inventan facturas. ' +
        'Usar importManualInvoice(...) o importManualInvoiceFromDrive(fileId, {...}).',
      account: service && service.account_number,
      portal: PORTAL,
      formAction: 'logon?s=p&c=0',
      manualImport: true,
    };
  }

  function downloadInvoice() {
    return {
      ok: false,
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      message: 'Download no disponible vía UrlFetchApp (reCAPTCHA)',
    };
  }

  function extractInvoiceMetadata() {
    return { outcome: O().NOT_IMPLEMENTED, metadata: null };
  }

  function getOutstandingDebt() {
    return {
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      debt: null,
      note: 'No inferir pago por ausencia de deuda en portal',
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
  module.exports = CM.Providers.Ecogas;
}
