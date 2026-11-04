/**
 * OSSE (agua) — full auto vía API pública facturaweb.osse.com.ar.
 *
 * Cuenta Services: "119 0080934 000 1" → API 14 dígitos 11900809340001
 * Catastro: 023220474900000 | SISA/unidadId: 60358
 *
 * Flujo (sin CAPTCHA en estos endpoints; no bypassear auth):
 * 1. GET /api/unidades/UnidadByUnidadAlt?unidadAlt={14dig} → guidId
 * 2. GET /api/unidades/UltimasFacturas?guidId= → lista
 * 3. GET /api/unidades/ImprimirFactura?guidId&tpoCom&preCom&numCom → PDF
 *
 * Host correcto: facturaweb.osse.com.ar
 * Host incorrecto (DNS ENOTFOUND): facturaweb.osse.ar
 * No usar DescargarFacturaDigital/{id} a ciegas (500 en sonda).
 * No loguear PII (razon). No inferir payment_status desde sitComMoroso.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Osse = (function () {
  var ID = 'osse';
  var PORTAL = 'https://facturaweb.osse.com.ar/';
  var API_BASE = 'https://facturaweb.osse.com.ar/api/unidades';
  var EXPECTED_ACCOUNT_DIGITS = 14;

  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  /** Cuenta OSSE en API = solo dígitos (strip spaces/guiones del Services sheet). */
  function accountDigits(accountOrService) {
    var raw =
      accountOrService && typeof accountOrService === 'object'
        ? accountOrService.account_number
        : accountOrService;
    return String(raw || '').replace(/\D/g, '');
  }

  function candidateUrls_(service) {
    var primary = (service && service.portal_url) || PORTAL;
    var alts = [
      primary,
      PORTAL,
      'https://www.ossesanjuan.com.ar/v4/',
      // Hosts legacy / rotos — al final, solo diagnóstico
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

  function apiUrl_(pathAndQuery) {
    if (!pathAndQuery) return API_BASE;
    if (pathAndQuery.indexOf('http') === 0) return pathAndQuery;
    return API_BASE + (pathAndQuery.charAt(0) === '/' ? pathAndQuery : '/' + pathAndQuery);
  }

  function buildUnidadUrl(digits) {
    return apiUrl_('/UnidadByUnidadAlt?unidadAlt=' + encodeURIComponent(digits));
  }

  function buildFacturasUrl(guidId) {
    return apiUrl_('/UltimasFacturas?guidId=' + encodeURIComponent(guidId));
  }

  function buildImprimirUrl(guidId, tpoCom, preCom, numCom) {
    return (
      apiUrl_('/ImprimirFactura') +
      '?guidId=' +
      encodeURIComponent(guidId) +
      '&tpoCom=' +
      encodeURIComponent(tpoCom) +
      '&preCom=' +
      encodeURIComponent(preCom) +
      '&numCom=' +
      encodeURIComponent(numCom)
    );
  }

  function parseJsonBody_(body) {
    if (body == null || body === '') return { ok: false, error: 'empty_body' };
    if (typeof body === 'object') return { ok: true, data: body };
    try {
      return { ok: true, data: JSON.parse(String(body)) };
    } catch (e) {
      return { ok: false, error: 'invalid_json', detail: String(e) };
    }
  }

  /**
   * Normaliza respuesta UnidadByUnidadAlt.
   * No expone `razon` (PII) en el objeto retornado.
   */
  function parseUnidadResponse(body) {
    var parsed = parseJsonBody_(body);
    if (!parsed.ok) return parsed;
    var d = parsed.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { ok: false, error: 'unexpected_shape' };
    }
    var guidId = d.guidId || d.GuidId || '';
    var unidadId = d.unidadId != null ? d.unidadId : d.UnidadId;
    var unidadAlt = d.unidadAlt || d.UnidadAlt || '';
    if (!guidId) return { ok: false, error: 'missing_guidId', unidadId: unidadId };
    return {
      ok: true,
      unidadId: unidadId,
      unidadAlt: String(unidadAlt),
      guidId: String(guidId),
    };
  }

  function parseFacturasResponse(body) {
    var parsed = parseJsonBody_(body);
    if (!parsed.ok) return parsed;
    if (!Array.isArray(parsed.data)) {
      return { ok: false, error: 'expected_array', detail: typeof parsed.data };
    }
    return { ok: true, data: parsed.data };
  }

  /**
   * Mapea ítem UltimasFacturas → campos CasitasManager + claves de descarga.
   * payment_status siempre unknown (no inferir de sitComMoroso).
   */
  function mapFactura(raw, guidId, service) {
    raw = raw || {};
    var invoiceNumber =
      raw.compro ||
      raw.comproFormateado ||
      [raw.tpoCom, raw.preCom, raw.numCom].filter(function (x) {
        return x != null && x !== '';
      }).join('-');
    var period = CM.Dates.normalizeBillingPeriod(raw.sPeriodo || raw.perComFec || '');
    return {
      provider: ID,
      service_id: (service && service.service_id) || '',
      accountNumber: (service && service.account_number) || '',
      invoiceNumber: String(invoiceNumber || ''),
      billingPeriod: period,
      amount: raw.totalBas != null ? raw.totalBas : raw.saldoBase,
      currency: 'ARS',
      issueDate: raw.fecEmi || '',
      dueDate: raw.fecVen || '',
      invoice_status: 'detected',
      payment_status: 'unknown',
      notes: 'osse_api',
      // Claves ImprimirFactura (no son PII)
      guidId: guidId,
      tpoCom: raw.tpoCom,
      preCom: raw.preCom,
      numCom: raw.numCom,
      osseCompro: raw.compro || '',
    };
  }

  function requireAccountDigits_(service) {
    var digits = accountDigits(service);
    if (!digits) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta account_number OSSE en hoja Services',
        digits: '',
      };
    }
    if (digits.length !== EXPECTED_ACCOUNT_DIGITS) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message:
          'account_number OSSE debe normalizar a ' +
          EXPECTED_ACCOUNT_DIGITS +
          ' dígitos (Services: espacios OK). Obtenido: ' +
          digits.length +
          ' dígitos',
        digits: digits,
      };
    }
    return { ok: true, digits: digits };
  }

  function resolveUnidad_(service) {
    var acct = requireAccountDigits_(service);
    if (!acct.ok) return acct;
    var url = buildUnidadUrl(acct.digits);
    var res = CM.ProviderInterface.httpGet(url);
    if (!res.ok) {
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code + ' en UnidadByUnidadAlt',
        httpCode: res.code,
        digits: acct.digits,
        url: url,
      };
    }
    if (CM.ProviderInterface.detectCaptcha(res.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA inesperado en API OSSE (no se bypasea)',
        digits: acct.digits,
      };
    }
    var unidad = parseUnidadResponse(res.body);
    if (!unidad.ok) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'Respuesta UnidadByUnidadAlt inválida: ' + (unidad.error || ''),
        digits: acct.digits,
        httpCode: res.code,
      };
    }
    return {
      ok: true,
      digits: acct.digits,
      unidadId: unidad.unidadId,
      unidadAlt: unidad.unidadAlt,
      guidId: unidad.guidId,
    };
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

    var caps = {
      checkAvailability: true,
      fetchInvoices: true,
      downloadInvoice: true,
      extractInvoiceMetadata: true,
      getOutstandingDebt: false,
    };

    if (!res || !res.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message:
          (res && (res.error || 'HTTP ' + res.code)) +
          ' — portal/API OSSE inaccesible; reintentar probeOsse() o carga manual',
        httpCode: res && res.code,
        portal: url,
        attempts: attempts,
        manualImport: true,
        capabilities: { checkAvailability: true },
      });
    }

    var captcha = CM.ProviderInterface.detectCaptcha(res.body);
    if (captcha) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Portal reachable con captcha (no bypassear)',
        httpCode: res.code,
        captcha: true,
        portal: url,
        attempts: attempts,
        capabilities: { checkAvailability: true },
      });
    }

    // Preferir API real si hay cuenta
    var apiProbe = null;
    var acct = requireAccountDigits_(service);
    if (acct.ok) {
      var uRes = CM.ProviderInterface.httpGet(buildUnidadUrl(acct.digits));
      apiProbe = { code: uRes.code, ok: !!uRes.ok, error: uRes.error || '' };
      if (uRes.ok) {
        var unidad = parseUnidadResponse(uRes.body);
        if (unidad.ok) {
          return CM.ProviderInterface.baseStatus(ID, {
            ok: true,
            outcome: 'portal_reachable',
            message:
              'API OSSE OK (UnidadByUnidadAlt). Fetch/download vía UltimasFacturas + ImprimirFactura.',
            httpCode: uRes.code,
            portal: PORTAL,
            apiBase: API_BASE,
            accountDigits: acct.digits,
            unidadId: unidad.unidadId,
            // guidId útil para debug; no PII
            guidId: unidad.guidId,
            apiProbe: apiProbe,
            attempts: attempts,
            capabilities: caps,
          });
        }
        return CM.ProviderInterface.baseStatus(ID, {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message: 'API respondió pero sin guidId usable: ' + (unidad.error || ''),
          httpCode: uRes.code,
          apiProbe: apiProbe,
          accountDigits: acct.digits,
          capabilities: { checkAvailability: true },
        });
      }
      // Portal HTML OK pero API falló → honest
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message:
          'Portal HTML OK pero API UnidadByUnidadAlt falló: ' +
          (uRes.error || 'HTTP ' + uRes.code),
        httpCode: uRes.code,
        portal: PORTAL,
        apiProbe: apiProbe,
        accountDigits: acct.digits,
        attempts: attempts,
        manualImport: true,
        capabilities: { checkAvailability: true },
      });
    }

    var spa = /Web Area Clientes OSSE|main-es2015|ng-version/i.test(res.body || '');
    return CM.ProviderInterface.baseStatus(ID, {
      ok: true,
      outcome: 'portal_reachable',
      message: spa
        ? 'Portal facturaweb.osse.com.ar reachable; ' +
          (acct.message || 'verificar account_number en Services')
        : 'Portal reachable — ' + (acct.message || 'verificar account_number'),
      httpCode: res.code,
      spa: spa,
      apiBase: API_BASE,
      account: service && service.account_number,
      accountDigits: acct.digits || '',
      accountError: acct.message,
      attempts: attempts,
      capabilities: caps,
    });
  }

  /**
   * @param {object} service fila Services
   * @param {object} [options]
   * @param {string} [options.billingPeriod] filtrar YYYY-MM
   * @param {number} [options.limit] máx ítems (default 12, newest first)
   */
  function fetchInvoices(service, options) {
    options = options || {};
    var unidad = resolveUnidad_(service);
    if (!unidad.ok) {
      return {
        outcome: unidad.outcome || O().ERROR,
        invoices: [],
        message: unidad.message,
        httpCode: unidad.httpCode,
        accountDigits: unidad.digits,
        manualImport: unidad.outcome === O().PORTAL_INACCESSIBLE,
      };
    }

    var url = buildFacturasUrl(unidad.guidId);
    var res = CM.ProviderInterface.httpGet(url);
    if (!res.ok) {
      return {
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        invoices: [],
        message: res.error || 'HTTP ' + res.code + ' en UltimasFacturas',
        httpCode: res.code,
        guidId: unidad.guidId,
        manualImport: true,
      };
    }
    if (CM.ProviderInterface.detectCaptcha(res.body)) {
      return {
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        invoices: [],
        message: 'CAPTCHA inesperado en UltimasFacturas (no se bypasea)',
        guidId: unidad.guidId,
      };
    }

    var parsed = parseFacturasResponse(res.body);
    if (!parsed.ok) {
      return {
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        invoices: [],
        message: 'UltimasFacturas no es JSON array: ' + (parsed.error || ''),
        guidId: unidad.guidId,
      };
    }

    var mapped = parsed.data.map(function (row) {
      return mapFactura(row, unidad.guidId, service);
    });

    // newest first by issueDate / billingPeriod
    mapped.sort(function (a, b) {
      var da = String(a.issueDate || a.billingPeriod || '');
      var db = String(b.issueDate || b.billingPeriod || '');
      if (da < db) return 1;
      if (da > db) return -1;
      return 0;
    });

    if (options.billingPeriod) {
      var want = CM.Dates.normalizeBillingPeriod(options.billingPeriod);
      mapped = mapped.filter(function (inv) {
        return inv.billingPeriod === want;
      });
    }

    var limit = options.limit != null ? options.limit : 12;
    if (limit > 0 && mapped.length > limit) {
      mapped = mapped.slice(0, limit);
    }

    if (!mapped.length) {
      return {
        outcome: O().INVOICE_NOT_AVAILABLE_YET,
        invoices: [],
        message: options.billingPeriod
          ? 'API OK; sin facturas para período ' + options.billingPeriod
          : 'API OK; UltimasFacturas vacío',
        guidId: unidad.guidId,
        unidadId: unidad.unidadId,
        totalFromApi: parsed.data.length,
      };
    }

    return {
      outcome: 'listed_ok',
      invoices: mapped,
      message: 'OSSE listó ' + mapped.length + ' factura(s)',
      guidId: unidad.guidId,
      unidadId: unidad.unidadId,
      totalFromApi: parsed.data.length,
    };
  }

  /**
   * Descarga PDF vía ImprimirFactura.
   * @param {object} serviceOrInvoice service o meta con guidId/tpoCom/…
   * @param {object} [invoiceMeta] si el 1er arg es service
   */
  function downloadInvoice(serviceOrInvoice, invoiceMeta) {
    var meta = invoiceMeta || serviceOrInvoice || {};
    var service = invoiceMeta ? serviceOrInvoice : null;
    var guidId = meta.guidId;
    var tpoCom = meta.tpoCom;
    var preCom = meta.preCom;
    var numCom = meta.numCom;

    if (!guidId && service) {
      var unidad = resolveUnidad_(service);
      if (!unidad.ok) {
        return {
          ok: false,
          outcome: unidad.outcome || O().ERROR,
          message: unidad.message,
        };
      }
      guidId = unidad.guidId;
    }

    if (!guidId || tpoCom == null || tpoCom === '' || preCom == null || preCom === '' || numCom == null || numCom === '') {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message:
          'downloadInvoice requiere guidId, tpoCom, preCom, numCom (correr fetchInvoices antes)',
      };
    }

    var url = buildImprimirUrl(guidId, tpoCom, preCom, numCom);
    var res = CM.ProviderInterface.httpGet(url);
    if (!res.ok) {
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code + ' en ImprimirFactura',
        httpCode: res.code,
        url: url,
      };
    }

    var blob = res.blob || null;
    var magicOk = false;
    if (blob && typeof blob.getBytes === 'function') {
      try {
        magicOk = CM.Pdf.looksLikePdf(blob.getBytes());
      } catch (e) {
        magicOk = false;
      }
    } else if (typeof res.body === 'string' && res.body.indexOf('%PDF') === 0) {
      magicOk = true;
    }

    if (CM.ProviderInterface.detectCaptcha(res.body) && !magicOk) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA/HTML en lugar de PDF (no se bypasea)',
        httpCode: res.code,
      };
    }

    // Exigir magic %PDF (no confiar solo en content-type): si no, Drive falla
    // después y el menú decía "PDF OSSE OK" con pdfCount 0.
    if (!magicOk) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message:
          'ImprimirFactura no devolvió PDF válido (content-type=' +
          (res.contentType || '') +
          ', magic=%PDF ausente)',
        httpCode: res.code,
        contentType: res.contentType,
      };
    }

    if (!blob) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message: 'ImprimirFactura devolvió PDF en body pero sin blob UrlFetch para Drive',
        httpCode: res.code,
        contentType: res.contentType,
      };
    }

    return {
      ok: true,
      outcome: O().DOWNLOADED_OK,
      message: 'PDF OSSE OK',
      blob: blob,
      contentType: res.contentType || 'application/pdf',
      httpCode: res.code,
      guidId: guidId,
      tpoCom: tpoCom,
      preCom: preCom,
      numCom: numCom,
      invoiceNumber: meta.invoiceNumber || meta.invoice_number || '',
      billingPeriod: meta.billingPeriod || meta.billing_period || '',
    };
  }

  function extractInvoiceMetadata(service, invoiceMeta) {
    var fetched = fetchInvoices(service, {
      billingPeriod: invoiceMeta && (invoiceMeta.billingPeriod || invoiceMeta.billing_period),
      limit: 1,
    });
    if (!fetched.invoices || !fetched.invoices.length) {
      return { outcome: fetched.outcome, metadata: null, message: fetched.message };
    }
    return { outcome: 'ok', metadata: fetched.invoices[0] };
  }

  function getOutstandingDebt() {
    return {
      outcome: O().NOT_IMPLEMENTED,
      debt: null,
      note: 'No inferir pago por ausencia de deuda / sitComMoroso',
    };
  }

  function getProviderStatus(service) {
    return checkAvailability(service || CM.ServiceCatalog.getByProvider(ID));
  }

  var adapter = {
    id: ID,
    portal: PORTAL,
    apiBase: API_BASE,
    checkAvailability: checkAvailability,
    fetchInvoices: fetchInvoices,
    downloadInvoice: downloadInvoice,
    extractInvoiceMetadata: extractInvoiceMetadata,
    getOutstandingDebt: getOutstandingDebt,
    getProviderStatus: getProviderStatus,
    // Helpers exportados para unit tests / orquestación
    accountDigits: accountDigits,
    mapFactura: mapFactura,
    parseUnidadResponse: parseUnidadResponse,
    parseFacturasResponse: parseFacturasResponse,
    buildUnidadUrl: buildUnidadUrl,
    buildFacturasUrl: buildFacturasUrl,
    buildImprimirUrl: buildImprimirUrl,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Osse;
}
