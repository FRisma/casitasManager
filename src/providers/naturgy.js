/**
 * Naturgy San Juan (electricidad) — prioridad #3.
 *
 * Suministro: 20004193466 | Medidor: 0142679
 * Portal SPA: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta
 * API Widergy: https://utilitygo.widergy.com/ (Utility-ID: 23, Channel: web)
 *
 * Hallazgos (2026-11-04):
 * - Listing SIN sesión: GET /api/v1/accounts/complete_debts?client_number=&gateway=mercadopago
 *   → 202 {url} → GET url → {account, debts[]}. No Turnstile en este path (hasta ahora).
 * - PDF: SPA llama GET /api/v1/bills/public_pdf?token=… (Accept: application/pdf).
 *   document_number / external_id solos → 400 param_is_missing (token).
 *   token inventado → 403 utility_service_forbidden. payment_document_pdf exige auth.
 * - SPA origin (/api/v1/*) sirve HTML shell S3/CloudFront — NO es el API real.
 * - Turnstile en login SPA → NO bypassear. Manual Drive / token pegado por Franco.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Naturgy = (function () {
  var ID = 'naturgy';
  var PORTAL = 'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta';
  var ORIGIN = 'https://oficinavirtual.naturgysj.com.ar';
  var API_BASE = 'https://utilitygo.widergy.com';
  var UTILITY_ID = '23';
  var CHANNEL = 'web';
  var GATEWAY = 'mercadopago';
  var DEFAULT_ACCOUNT = '20004193466';
  var JOB_POLL_MS = 1000;
  var JOB_POLL_MAX = 15;

  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  function apiHeaders_(extra) {
    var h = {
      Accept: 'application/json',
      'User-Agent': 'CasitasManager/1.0',
      Origin: ORIGIN,
      Referer: ORIGIN + '/',
      Channel: CHANNEL,
      'Utility-ID': UTILITY_ID,
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        h[k] = extra[k];
      });
    }
    return h;
  }

  function resolveAccount_(service) {
    var n =
      (service && (service.account_number || service.accountNumber || service.client_number)) ||
      '';
    n = String(n).replace(/\D/g, '');
    if (!n) n = DEFAULT_ACCOUNT;
    return n;
  }

  function buildCompleteDebtsUrl(clientNumber, gateway) {
    return (
      API_BASE +
      '/api/v1/accounts/complete_debts?client_number=' +
      encodeURIComponent(clientNumber) +
      '&gateway=' +
      encodeURIComponent(gateway || GATEWAY)
    );
  }

  function buildPublicPdfUrl(token) {
    return (
      API_BASE + '/api/v1/bills/public_pdf?token=' + encodeURIComponent(String(token || ''))
    );
  }

  /**
   * period "202605" → "2026-05" when YYYYMM; else Dates.normalizeBillingPeriod.
   * Prefer issued_on month when period looks like an opaque cycle code vs calendar month —
   * caller decides; this only normalizes the raw period field.
   */
  function normalizeNaturgyPeriod(period) {
    var s = String(period || '').trim();
    var m = s.match(/^(\d{4})(\d{2})$/);
    if (m) {
      var month = parseInt(m[2], 10);
      if (month >= 1 && month <= 12) return m[1] + '-' + (month < 10 ? '0' + month : String(month));
    }
    return CM.Dates.normalizeBillingPeriod(s);
  }

  function isoDateOnly_(raw) {
    if (!raw) return '';
    var s = String(raw);
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : CM.Dates.parseDateToISO(s) || '';
  }

  /**
   * Map debt row → invoice. No inventa montos.
   * billingPeriod: issued_on month if present (mejor fit reporte mensual);
   * naturgyPeriod guarda el period crudo del API.
   */
  function mapDebt(debt, account, service) {
    debt = debt || {};
    account = account || {};
    var issued = isoDateOnly_(debt.issued_on);
    var due = isoDateOnly_(debt.first_expiration_on);
    var billingPeriod = '';
    if (issued) {
      billingPeriod = issued.substring(0, 7);
    } else {
      billingPeriod = normalizeNaturgyPeriod(debt.period);
    }
    var invoiceNumber =
      debt.document_number || debt.external_id || debt.settlement_number || '';
    return {
      provider: ID,
      accountNumber: debt.client_number || account.client_number || '',
      service_id: (service && service.service_id) || '',
      invoiceNumber: String(invoiceNumber),
      billingPeriod: billingPeriod,
      amount: typeof debt.amount === 'number' ? debt.amount : CM.Invoices.normalizeAmount(debt.amount),
      currency: 'ARS',
      issueDate: issued,
      dueDate: due,
      invoice_status: 'detected',
      payment_status: 'unknown',
      notes: debt.status ? 'naturgy_status=' + debt.status : '',
      // claves para download (cuando haya token)
      external_id: debt.external_id || '',
      document_number: debt.document_number || '',
      document_type: debt.document_type || '',
      downloadable: debt.downloadable === true,
      naturgyPeriod: debt.period || '',
      autoDownload: false,
      raw: debt,
    };
  }

  function parseJson_(body) {
    try {
      return { ok: true, data: JSON.parse(String(body || '')) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function looksLikeHtmlShell_(body, contentType) {
    var ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('html') >= 0) return true;
    var s = String(body || '').slice(0, 200).toLowerCase();
    return s.indexOf('<!doctype html') >= 0 || s.indexOf('<html') >= 0;
  }

  function apiErrorMessage_(data) {
    if (!data || !data.errors || !data.errors.length) return '';
    var e = data.errors[0];
    return (e.code || '') + (e.message ? ': ' + e.message : '') + (e.meta ? ' (' + e.meta + ')' : '');
  }

  function sleep_(ms) {
    if (typeof Utilities !== 'undefined' && Utilities.sleep) {
      Utilities.sleep(ms);
      return;
    }
    // Node / tests: busy no-op (tests mock http, no live poll)
  }

  /**
   * Poll async job URL until debts/account payload or error/timeout.
   * @returns {{ok:boolean, data?:object, outcome?:string, message?:string, httpCode?:number}}
   */
  function pollJobUrl_(jobUrl) {
    if (!jobUrl) {
      return { ok: false, outcome: O().PORTAL_STRUCTURE_CHANGED, message: 'complete_debts sin url de job' };
    }
    var last = null;
    for (var i = 0; i < JOB_POLL_MAX; i++) {
      if (i > 0) sleep_(JOB_POLL_MS);
      var res = CM.ProviderInterface.httpGet(jobUrl, { headers: apiHeaders_() });
      last = res;
      if (!res.ok && res.code !== 202) {
        if (res.code === 401 || res.code === 403) {
          return {
            ok: false,
            outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
            message: 'Job async HTTP ' + res.code + ' (auth). No se bypassea Turnstile.',
            httpCode: res.code,
          };
        }
        // 500 on job may be transient; keep polling a bit
        if (res.code < 500) {
          return {
            ok: false,
            outcome: O().PORTAL_INACCESSIBLE,
            message: res.error || 'HTTP ' + res.code + ' en job async',
            httpCode: res.code,
          };
        }
      }
      if (looksLikeHtmlShell_(res.body, res.contentType)) {
        return {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message: 'Job URL devolvió HTML shell (¿host/API cambió?)',
          httpCode: res.code,
        };
      }
      var parsed = parseJson_(res.body);
      if (!parsed.ok) {
        if (i < JOB_POLL_MAX - 1) continue;
        return {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message: 'Job response no-JSON: ' + (parsed.error || ''),
          httpCode: res.code,
        };
      }
      var data = parsed.data;
      if (data && data.errors && data.errors.length) {
        var msg = apiErrorMessage_(data);
        var code = data.errors[0].status || res.code;
        if (code === 401 || code === 403) {
          return {
            ok: false,
            outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
            message: msg,
            httpCode: code,
          };
        }
        // keep polling on 5xx
        if (code >= 500 && i < JOB_POLL_MAX - 1) continue;
        return {
          ok: false,
          outcome: O().ERROR,
          message: msg || 'Error en job async',
          httpCode: code,
          data: data,
        };
      }
      // Accepted handshake again?
      if (data && data.url && !data.debts && !data.account) {
        jobUrl = data.url;
        continue;
      }
      if (data && (data.debts || data.account)) {
        return { ok: true, data: data, httpCode: res.code };
      }
    }
    return {
      ok: false,
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      message:
        'Timeout esperando job complete_debts (' +
        JOB_POLL_MAX +
        ' intentos). Último HTTP ' +
        ((last && last.code) || '?'),
      httpCode: last && last.code,
    };
  }

  /**
   * GET complete_debts → follow 202 job url → debts payload.
   */
  function fetchCompleteDebts(clientNumber, gateway) {
    var url = buildCompleteDebtsUrl(clientNumber, gateway);
    var res = CM.ProviderInterface.httpGet(url, { headers: apiHeaders_() });
    if (!res.ok && res.code !== 202) {
      if (res.code === 401 || res.code === 403) {
        return {
          ok: false,
          outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
          message:
            'complete_debts HTTP ' +
            res.code +
            '. Si pide Turnstile/login, no se bypassea — usar import manual.',
          httpCode: res.code,
        };
      }
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code + ' en complete_debts',
        httpCode: res.code,
      };
    }
    if (looksLikeHtmlShell_(res.body, res.contentType)) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'complete_debts devolvió HTML (¿pegado al SPA origin en vez de utilitygo?)',
        httpCode: res.code,
      };
    }
    var parsed = parseJson_(res.body);
    if (!parsed.ok) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'complete_debts no-JSON: ' + (parsed.error || ''),
        httpCode: res.code,
      };
    }
    var data = parsed.data;
    if (data && data.errors && data.errors.length) {
      return {
        ok: false,
        outcome: O().ERROR,
        message: apiErrorMessage_(data),
        httpCode: res.code,
        data: data,
      };
    }
    // Sync payload (unlikely) or async handshake
    if (data && (data.debts || data.account) && !data.url) {
      return { ok: true, data: data, httpCode: res.code, async: false };
    }
    if (data && data.url) {
      var job = pollJobUrl_(data.url);
      if (!job.ok) return job;
      return { ok: true, data: job.data, httpCode: job.httpCode, async: true, jobUrl: data.url };
    }
    return {
      ok: false,
      outcome: O().PORTAL_STRUCTURE_CHANGED,
      message: 'complete_debts sin debts ni url de job',
      httpCode: res.code,
      data: data,
    };
  }

  function getSessionToken_() {
    try {
      return String(CM.Settings.get(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function checkAvailability(service) {
    var account = resolveAccount_(service);
    var url = buildCompleteDebtsUrl(account);
    var res = CM.ProviderInterface.httpGet(url, { headers: apiHeaders_() });
    // 202 Accepted = API viva
    if (res.ok || res.code === 202) {
      var spaShell = looksLikeHtmlShell_(res.body, res.contentType);
      return CM.ProviderInterface.baseStatus(ID, {
        ok: !spaShell,
        outcome: spaShell ? O().PORTAL_STRUCTURE_CHANGED : 'portal_reachable',
        message: spaShell
          ? 'utilitygo devolvió HTML inesperado'
          : 'API utilitygo complete_debts reachable (listing sin sesión)',
        httpCode: res.code,
        account: account,
        apiBase: API_BASE,
        capabilities: {
          checkAvailability: true,
          fetchInvoices: true,
          downloadInvoice: !!getSessionToken_(),
          extractInvoiceMetadata: false,
          getOutstandingDebt: true,
        },
      });
    }
    if (res.code === 401 || res.code === 403) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'complete_debts exige auth/captcha (HTTP ' + res.code + ') — no bypass',
        httpCode: res.code,
        account: account,
      });
    }
    return CM.ProviderInterface.baseStatus(ID, {
      ok: false,
      outcome: O().PORTAL_INACCESSIBLE,
      message: res.error || 'HTTP ' + res.code,
      httpCode: res.code,
      account: account,
    });
  }

  function fetchInvoices(service, options) {
    options = options || {};
    var account = resolveAccount_(service);
    if (!account) {
      return { outcome: O().MISSING_PROPERTY_INFO, invoices: [], message: 'Falta account_number' };
    }

    var fetched = fetchCompleteDebts(account, GATEWAY);
    if (!fetched.ok) {
      return {
        outcome: fetched.outcome || O().ERROR,
        invoices: [],
        message: fetched.message || 'complete_debts falló',
        httpCode: fetched.httpCode,
        account: account,
        manualImport: true,
      };
    }

    var payload = fetched.data || {};
    var debts = payload.debts || [];
    var mapped = debts.map(function (d) {
      return mapDebt(d, payload.account, service);
    });

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

    var token = getSessionToken_();
    if (token) {
      mapped.forEach(function (inv) {
        if (inv.downloadable) {
          inv.autoDownload = true;
          inv.naturgyToken = token;
        }
      });
    }

    if (!mapped.length) {
      return {
        outcome: O().INVOICE_NOT_AVAILABLE_YET,
        invoices: [],
        message: options.billingPeriod
          ? 'Sin deudas Naturgy para período ' + options.billingPeriod
          : 'complete_debts OK pero debts[] vacío',
        account: account,
        accountInfo: payload.account || null,
        balances: payload.balances || null,
      };
    }

    return {
      outcome: token ? O().AVAILABLE_NOT_DOWNLOADABLE : O().AVAILABLE_NOT_DOWNLOADABLE,
      invoices: mapped,
      message: token
        ? 'Listado complete_debts OK; token en Script Properties — intentar public_pdf'
        : 'Listado complete_debts OK (sin sesión). PDF requiere token public_pdf (Franco Network) o importManualInvoiceFromDrive.',
      account: account,
      accountInfo: payload.account || null,
      balances: payload.balances || null,
      async: !!fetched.async,
      manualImport: !token,
    };
  }

  /**
   * Download PDF vía public_pdf?token=…
   * Token: meta.naturgyToken | meta.token | NATURGY_SESSION_TOKEN Script Property.
   * Sin token → auth_or_captcha_required (honesto). No inventar tokens.
   */
  function downloadInvoice(service, meta) {
    meta = meta || {};
    var token =
      meta.naturgyToken ||
      meta.token ||
      meta.publicPdfToken ||
      getSessionToken_();
    token = String(token || '').trim();
    if (!token) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'PDF Naturgy: falta token public_pdf. Pegá el token (Network tras abrir boleta) con setNaturgySessionToken, ' +
          'o importManualInvoiceFromDrive / menú Importar PDF Naturgy. No se inventa token ni se bypassea Turnstile.',
        external_id: meta.external_id || '',
        document_number: meta.document_number || '',
      };
    }

    var url = buildPublicPdfUrl(token);
    var res = CM.ProviderInterface.httpGet(url, {
      headers: apiHeaders_({ Accept: 'application/pdf, application/json, */*' }),
    });

    if (res.code === 401 || res.code === 403) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'public_pdf HTTP ' +
          res.code +
          ' — token inválido/expirado o servicio prohibido. Renová token (Network) o usá import manual.',
        httpCode: res.code,
        url: API_BASE + '/api/v1/bills/public_pdf?token=(redacted)',
      };
    }
    if (!res.ok) {
      var errParsed = parseJson_(res.body);
      var errMsg =
        (errParsed.ok && apiErrorMessage_(errParsed.data)) ||
        res.error ||
        'HTTP ' + res.code;
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message: 'public_pdf: ' + errMsg,
        httpCode: res.code,
      };
    }

    if (looksLikeHtmlShell_(res.body, res.contentType)) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'public_pdf devolvió HTML shell — ¿URL incorrecta (SPA origin)?',
        httpCode: res.code,
      };
    }

    // JSON error with 200?
    var maybeJson = parseJson_(res.body);
    if (
      maybeJson.ok &&
      maybeJson.data &&
      maybeJson.data.errors &&
      String(res.contentType || '').indexOf('json') >= 0
    ) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'public_pdf JSON error: ' + apiErrorMessage_(maybeJson.data),
        httpCode: res.code,
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
        message: 'CAPTCHA/Turnstile en lugar de PDF (no se bypassea)',
        httpCode: res.code,
      };
    }

    if (!magicOk) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message:
          'public_pdf no devolvió PDF válido (content-type=' +
          (res.contentType || '') +
          ', magic=%PDF ausente). ¿Token de sesión en vez de token de boleta?',
        httpCode: res.code,
        contentType: res.contentType,
      };
    }

    if (!blob) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message: 'public_pdf devolvió PDF en body pero sin blob UrlFetch para Drive',
        httpCode: res.code,
      };
    }

    return {
      ok: true,
      outcome: O().DOWNLOADED_OK,
      message: 'PDF Naturgy public_pdf OK',
      blob: blob,
      contentType: res.contentType || 'application/pdf',
      httpCode: res.code,
      invoiceNumber: meta.invoiceNumber || meta.invoice_number || meta.document_number || '',
      billingPeriod: meta.billingPeriod || meta.billing_period || '',
      external_id: meta.external_id || '',
    };
  }

  function extractInvoiceMetadata() {
    return { outcome: O().NOT_IMPLEMENTED, metadata: null };
  }

  function getOutstandingDebt(service) {
    var account = resolveAccount_(service);
    var fetched = fetchCompleteDebts(account, GATEWAY);
    if (!fetched.ok) {
      return {
        outcome: fetched.outcome || O().ERROR,
        debt: null,
        message: fetched.message,
        note: 'No inferir pago por ausencia de deuda si el portal falló',
      };
    }
    var bal = (fetched.data && fetched.data.balances) || {};
    var debts = (fetched.data && fetched.data.debts) || [];
    return {
      outcome: O().DOWNLOADED_OK,
      debt: {
        total_balance: bal.total_balance,
        non_expired_balance: bal.non_expired_balance,
        expired_balance: bal.expired_balance,
        next_expiration_on: fetched.data.next_expiration_on || null,
        openCount: debts.length,
      },
      message: 'balances desde complete_debts',
      note: 'No marcar paid solo porque total_balance=0 sin confirmar pago',
    };
  }

  function getProviderStatus(service) {
    return checkAvailability(service || CM.ServiceCatalog.getByProvider(ID));
  }

  var adapter = {
    id: ID,
    portal: PORTAL,
    apiBase: API_BASE,
    utilityId: UTILITY_ID,
    checkAvailability: checkAvailability,
    fetchInvoices: fetchInvoices,
    downloadInvoice: downloadInvoice,
    extractInvoiceMetadata: extractInvoiceMetadata,
    getOutstandingDebt: getOutstandingDebt,
    getProviderStatus: getProviderStatus,
    // test / ops helpers
    buildCompleteDebtsUrl: buildCompleteDebtsUrl,
    buildPublicPdfUrl: buildPublicPdfUrl,
    mapDebt: mapDebt,
    normalizeNaturgyPeriod: normalizeNaturgyPeriod,
    fetchCompleteDebts: fetchCompleteDebts,
    pollJobUrl_: pollJobUrl_,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Naturgy;
}
