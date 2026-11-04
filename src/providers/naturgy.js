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
 * - PDF (Franco E2E + auto aprobado):
 *   POST /api/v1/users/sessions {email,password} → access_token (JWT).
 *   GET /api/v1/bills/printed_bill?client_number=&external_id=<document_number>
 *     Authorization: <JWT> SIN "Bearer" → 202 {url} → poll (mismo Auth) → {base64} → decode PDF.
 *   Credenciales / JWT solo Script Properties (NATURGY_EMAIL/PASSWORD/SESSION_TOKEN). NUNCA commit ni log password.
 * - Listing complete_debts sigue SIN auth. Manual Drive si login/PDF falla.
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

  /**
   * PDF download URL. externalIdQuery = document_number (not "17-…" compound).
   */
  function buildPrintedBillUrl(clientNumber, externalIdQuery) {
    return (
      API_BASE +
      '/api/v1/bills/printed_bill?client_number=' +
      encodeURIComponent(String(clientNumber || '')) +
      '&external_id=' +
      encodeURIComponent(String(externalIdQuery || ''))
    );
  }

  /**
   * printed_bill?external_id= uses document_number (143292286), not compound 17-143292286.
   */
  function resolvePrintedBillExternalId_(meta) {
    meta = meta || {};
    var doc = String(meta.document_number || meta.invoiceNumber || meta.invoice_number || '').trim();
    if (doc && /^\d+$/.test(doc)) return doc;
    var ext = String(meta.printExternalId || meta.external_id || '').trim();
    if (!ext) return '';
    // Strip leading "17-" / "NN-" document_type prefix if present
    var m = ext.match(/^\d+-(\d+)$/);
    if (m) return m[1];
    return ext;
  }

  function normalizeAuthHeaderValue_(raw) {
    var v = String(raw || '').trim();
    if (!v) return '';
    // Franco curl uses raw JWT; strip accidental "Bearer " if pasted
    if (v.toLowerCase().indexOf('bearer ') === 0) v = v.slice(7).trim();
    return v;
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
      // claves para download (cuando haya JWT en Script Properties)
      external_id: debt.external_id || '',
      document_number: debt.document_number || '',
      document_type: debt.document_type || '',
      /** Query param for printed_bill — document_number, not compound external_id */
      printExternalId: debt.document_number || '',
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
   * Poll async job URL until opts.isDone(data) or debts/account (default) or error/timeout.
   * @param {string} jobUrl
   * @param {{headers?:object, isDone?:function, label?:string}} [opts]
   * @returns {{ok:boolean, data?:object, outcome?:string, message?:string, httpCode?:number}}
   */
  function pollJobUrl_(jobUrl, opts) {
    opts = opts || {};
    var label = opts.label || 'async job';
    var isDone =
      opts.isDone ||
      function (data) {
        return !!(data && (data.debts || data.account));
      };
    if (!jobUrl) {
      return { ok: false, outcome: O().PORTAL_STRUCTURE_CHANGED, message: label + ' sin url de job' };
    }
    var last = null;
    for (var i = 0; i < JOB_POLL_MAX; i++) {
      if (i > 0) sleep_(JOB_POLL_MS);
      var res = CM.ProviderInterface.httpGet(jobUrl, {
        headers: apiHeaders_(opts.headers || {}),
      });
      last = res;
      if (!res.ok && res.code !== 202) {
        if (res.code === 401 || res.code === 403) {
          return {
            ok: false,
            outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
            message: label + ' HTTP ' + res.code + ' (auth). No se bypassea Turnstile.',
            httpCode: res.code,
          };
        }
        if (res.code < 500) {
          return {
            ok: false,
            outcome: O().PORTAL_INACCESSIBLE,
            message: res.error || 'HTTP ' + res.code + ' en ' + label,
            httpCode: res.code,
          };
        }
      }
      if (looksLikeHtmlShell_(res.body, res.contentType)) {
        return {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message: label + ' devolvió HTML shell (¿host/API cambió?)',
          httpCode: res.code,
        };
      }
      var parsed = parseJson_(res.body);
      if (!parsed.ok) {
        if (i < JOB_POLL_MAX - 1) continue;
        return {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message: label + ' no-JSON: ' + (parsed.error || ''),
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
        if (code >= 500 && i < JOB_POLL_MAX - 1) continue;
        return {
          ok: false,
          outcome: O().ERROR,
          message: msg || 'Error en ' + label,
          httpCode: code,
          data: data,
        };
      }
      if (isDone(data)) {
        return { ok: true, data: data, httpCode: res.code };
      }
      // Handshake / redirect to another job url
      if (data && data.url) {
        jobUrl = data.url;
        continue;
      }
    }
    return {
      ok: false,
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      message:
        'Timeout esperando ' +
        label +
        ' (' +
        JOB_POLL_MAX +
        ' intentos). Último HTTP ' +
        ((last && last.code) || '?'),
      httpCode: last && last.code,
    };
  }

  /**
   * Decode Widergy printed_bill job base64 → PDF blob.
   * GAS: Utilities.base64Decode + newBlob. Node tests: Buffer.
   */
  function decodeBase64Pdf_(b64) {
    if (b64 == null || b64 === '') return { ok: false, reason: 'empty' };
    var s = String(b64).trim();
    var comma = s.indexOf(',');
    if (/base64/i.test(s.slice(0, Math.max(comma, 0))) && comma >= 0) {
      s = s.slice(comma + 1);
    }
    try {
      if (typeof Utilities !== 'undefined' && Utilities.base64Decode) {
        var bytes = Utilities.base64Decode(s);
        if (!CM.Pdf.looksLikePdf(bytes)) {
          return { ok: false, reason: 'magic_pdf_ausente' };
        }
        return {
          ok: true,
          blob: Utilities.newBlob(bytes, 'application/pdf'),
          size: bytes.length,
        };
      }
      if (typeof Buffer !== 'undefined') {
        var buf = Buffer.from(s, 'base64');
        if (!CM.Pdf.looksLikePdf(buf)) {
          return { ok: false, reason: 'magic_pdf_ausente' };
        }
        var arr = Array.prototype.slice.call(buf);
        return {
          ok: true,
          blob: {
            getBytes: function () {
              return arr;
            },
            getContentType: function () {
              return 'application/pdf';
            },
            setName: function () {},
          },
          size: buf.length,
        };
      }
      return { ok: false, reason: 'no_base64_runtime' };
    } catch (e) {
      return { ok: false, reason: 'decode_error', error: String(e) };
    }
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
      return normalizeAuthHeaderValue_(
        CM.Settings.get(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '') || ''
      );
    } catch (e) {
      return '';
    }
  }

  function setSessionTokenCache_(token) {
    try {
      CM.Settings.set(CM.Settings.KEYS.NATURGY_SESSION_TOKEN, normalizeAuthHeaderValue_(token));
    } catch (e) {
      /* ignore */
    }
  }

  function clearSessionTokenCache_() {
    setSessionTokenCache_('');
  }

  /** @returns {{email:string,password:string}|null} Never log password. */
  function getStoredCredentials_() {
    try {
      var email = String(CM.Settings.get(CM.Settings.KEYS.NATURGY_EMAIL, '') || '').trim();
      var password = String(CM.Settings.get(CM.Settings.KEYS.NATURGY_PASSWORD, '') || '');
      if (!email || !password) return null;
      return { email: email, password: password };
    } catch (e) {
      return null;
    }
  }

  function hasDownloadAuth_() {
    return !!(getSessionToken_() || getStoredCredentials_());
  }

  function headerGet_(headers, name) {
    if (!headers) return '';
    var want = String(name).toLowerCase();
    for (var k in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, k)) continue;
      if (String(k).toLowerCase() !== want) continue;
      var v = headers[k];
      return Array.isArray(v) ? String(v[0] || '') : String(v == null ? '' : v);
    }
    return '';
  }

  /**
   * Extract JWT from sessions response. Prefers body.access_token; also Authorization header.
   * Never logs body (may contain PII).
   */
  function extractJwtFromSessionResponse_(res) {
    res = res || {};
    var fromHeader = normalizeAuthHeaderValue_(headerGet_(res.headers, 'Authorization'));
    if (fromHeader) return fromHeader;
    var parsed = parseJson_(res.body);
    if (!parsed.ok || !parsed.data) return '';
    var d = parsed.data;
    var token =
      d.access_token ||
      d.accessToken ||
      d.token ||
      d.jwt ||
      (d.data && (d.data.access_token || d.data.accessToken || d.data.token)) ||
      '';
    return normalizeAuthHeaderValue_(token);
  }

  function buildSessionsUrl() {
    return API_BASE + '/api/v1/users/sessions';
  }

  /**
   * POST /api/v1/users/sessions. Does not log email/password/token values.
   * @returns {{ok:boolean, token?:string, outcome?:string, message?:string, httpCode?:number}}
   */
  function loginSessions(credentials) {
    credentials = credentials || getStoredCredentials_();
    if (!credentials || !credentials.email || !credentials.password) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Faltan NATURGY_EMAIL / NATURGY_PASSWORD en Script Properties. Usá setNaturgyCredentials(email, password).',
      };
    }
    var payload = JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    });
    var res = CM.ProviderInterface.httpPost(buildSessionsUrl(), payload, {
      contentType: 'application/json',
      headers: apiHeaders_({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    });
    if (res.code === 401 || res.code === 403) {
      clearSessionTokenCache_();
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Login sessions HTTP ' +
          res.code +
          ' (credenciales inválidas o bloqueo). No se loguea el password. Revisá props o import manual.',
        httpCode: res.code,
      };
    }
    if (!res.ok) {
      var errP = parseJson_(res.body);
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message:
          'Login sessions falló HTTP ' +
          res.code +
          (errP.ok && apiErrorMessage_(errP.data) ? ': ' + apiErrorMessage_(errP.data) : ''),
        httpCode: res.code,
      };
    }
    var token = extractJwtFromSessionResponse_(res);
    if (!token) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message:
          'Login sessions OK pero sin access_token / Authorization en la respuesta. Revisar shape del API.',
        httpCode: res.code,
      };
    }
    setSessionTokenCache_(token);
    return { ok: true, token: token, httpCode: res.code, cached: true };
  }

  /**
   * JWT for printed_bill: cached token, else login with Script Property credentials.
   * @param {boolean} [forceLogin]
   */
  function ensureAuthToken_(forceLogin) {
    if (!forceLogin) {
      var cached = getSessionToken_();
      if (cached) return { ok: true, token: cached, source: 'cache' };
    }
    var login = loginSessions();
    if (!login.ok) return login;
    return { ok: true, token: login.token, source: 'login' };
  }

  function checkAvailability(service) {
    var account = resolveAccount_(service);
    var url = buildCompleteDebtsUrl(account);
    var res = CM.ProviderInterface.httpGet(url, { headers: apiHeaders_() });
    // 202 Accepted = API viva
    if (res.ok || res.code === 202) {
      var spaShell = looksLikeHtmlShell_(res.body, res.contentType);
      var canDl = hasDownloadAuth_();
      return CM.ProviderInterface.baseStatus(ID, {
        ok: !spaShell,
        outcome: spaShell ? O().PORTAL_STRUCTURE_CHANGED : 'portal_reachable',
        message: spaShell
          ? 'utilitygo devolvió HTML inesperado'
          : 'API utilitygo complete_debts reachable (listing sin sesión)' +
            (canDl ? '; PDF auth props presentes' : '; PDF necesita setNaturgyCredentials'),
        httpCode: res.code,
        account: account,
        apiBase: API_BASE,
        capabilities: {
          checkAvailability: true,
          fetchInvoices: true,
          downloadInvoice: canDl,
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

    // Listing is unauthenticated; attach JWT only if auth props exist (login deferred to download).
    var canAuto = hasDownloadAuth_();
    if (canAuto) {
      var auth = ensureAuthToken_(false);
      if (auth.ok && auth.token) {
        mapped.forEach(function (inv) {
          if (inv.downloadable) {
            inv.autoDownload = true;
            inv.naturgyToken = auth.token;
          }
        });
      }
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

    var anyAuto = mapped.some(function (inv) {
      return inv.autoDownload;
    });
    return {
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      invoices: mapped,
      message: anyAuto
        ? 'Listado complete_debts OK; auth listo — intentar printed_bill'
        : 'Listado complete_debts OK. PDF: setNaturgyCredentials(email, password) o importManualInvoiceFromDrive.',
      account: account,
      accountInfo: payload.account || null,
      balances: payload.balances || null,
      async: !!fetched.async,
      manualImport: !anyAuto,
    };
  }

  function downloadPrintedBillWithToken_(token, clientNumber, printExt, meta) {
    meta = meta || {};
    var redactedUrl =
      API_BASE +
      '/api/v1/bills/printed_bill?client_number=' +
      clientNumber +
      '&external_id=' +
      printExt;
    var authHeaders = { Authorization: token, Accept: 'application/json, application/pdf, */*' };
    var url = buildPrintedBillUrl(clientNumber, printExt);
    var res = CM.ProviderInterface.httpGet(url, { headers: apiHeaders_(authHeaders) });

    if (res.code === 401 || res.code === 403) {
      return {
        ok: false,
        authFailed: true,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'printed_bill HTTP ' + res.code + ' — JWT inválido/expirado.',
        httpCode: res.code,
        url: redactedUrl,
      };
    }
    if (!res.ok && res.code !== 202) {
      var errParsed = parseJson_(res.body);
      var errMsg =
        (errParsed.ok && apiErrorMessage_(errParsed.data)) ||
        res.error ||
        'HTTP ' + res.code;
      return {
        ok: false,
        outcome: res.outcome || O().PORTAL_INACCESSIBLE,
        message: 'printed_bill: ' + errMsg,
        httpCode: res.code,
        url: redactedUrl,
      };
    }

    if (looksLikeHtmlShell_(res.body, res.contentType)) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'printed_bill devolvió HTML shell — ¿URL incorrecta (SPA origin)?',
        httpCode: res.code,
      };
    }

    var directMagic = false;
    if (res.blob && typeof res.blob.getBytes === 'function') {
      try {
        directMagic = CM.Pdf.looksLikePdf(res.blob.getBytes());
      } catch (e) {
        directMagic = false;
      }
    }
    if (directMagic || (typeof res.body === 'string' && res.body.indexOf('%PDF') === 0)) {
      return {
        ok: true,
        outcome: O().DOWNLOADED_OK,
        message: 'PDF Naturgy printed_bill OK (direct)',
        blob: res.blob,
        contentType: res.contentType || 'application/pdf',
        httpCode: res.code,
        invoiceNumber: meta.invoiceNumber || meta.invoice_number || meta.document_number || printExt,
        billingPeriod: meta.billingPeriod || meta.billing_period || '',
        printExternalId: printExt,
        client_number: clientNumber,
      };
    }

    var parsed = parseJson_(res.body);
    if (!parsed.ok) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'printed_bill no-JSON / no-PDF: ' + (parsed.error || ''),
        httpCode: res.code,
      };
    }
    var data = parsed.data;
    if (data && data.errors && data.errors.length) {
      var errCode = data.errors[0].status;
      return {
        ok: false,
        authFailed: errCode === 401 || errCode === 403,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'printed_bill JSON error: ' + apiErrorMessage_(data),
        httpCode: res.code,
      };
    }

    if (!(data && data.base64) && data && data.url) {
      var job = pollJobUrl_(data.url, {
        headers: authHeaders,
        label: 'printed_bill job',
        isDone: function (d) {
          return !!(d && d.base64);
        },
      });
      if (!job.ok) {
        return {
          ok: false,
          authFailed: job.outcome === O().AUTH_OR_CAPTCHA_REQUIRED,
          outcome: job.outcome || O().ERROR,
          message: job.message || 'printed_bill job falló',
          httpCode: job.httpCode,
          url: redactedUrl,
        };
      }
      data = job.data;
    }

    if (!data || !data.base64) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'printed_bill job sin campo base64',
        httpCode: res.code,
      };
    }

    var decoded = decodeBase64Pdf_(data.base64);
    if (!decoded.ok) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message: 'printed_bill base64 decode falló: ' + (decoded.reason || decoded.error || ''),
        httpCode: res.code,
      };
    }

    return {
      ok: true,
      outcome: O().DOWNLOADED_OK,
      message: 'PDF Naturgy printed_bill OK (base64 job)',
      blob: decoded.blob,
      contentType: (data.type && String(data.type)) || 'application/pdf',
      httpCode: res.code,
      size: decoded.size,
      invoiceNumber: meta.invoiceNumber || meta.invoice_number || meta.document_number || printExt,
      billingPeriod: meta.billingPeriod || meta.billing_period || '',
      external_id: meta.external_id || '',
      printExternalId: printExt,
      client_number: clientNumber,
    };
  }

  /**
   * Download PDF: ensure JWT (cache or POST sessions) → printed_bill → job → base64 → blob.
   * Listing complete_debts remains unauthenticated. Never logs password/JWT.
   */
  function downloadInvoice(service, meta) {
    meta = meta || {};
    var clientNumber =
      resolveAccount_(service) ||
      String(meta.accountNumber || meta.account_number || meta.client_number || '').replace(/\D/g, '');
    var printExt = resolvePrintedBillExternalId_(meta);

    if (!clientNumber || !printExt) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message:
          'printed_bill requiere client_number y document_number (external_id query). ' +
          'client=' +
          (clientNumber || '?') +
          ' external_id_query=' +
          (printExt || '?'),
      };
    }

    var auth = null;
    var token = normalizeAuthHeaderValue_(
      meta.naturgyToken || meta.token || meta.authorization || ''
    );
    if (!token) {
      auth = ensureAuthToken_(false);
      if (!auth.ok) {
        return {
          ok: false,
          outcome: auth.outcome || O().AUTH_OR_CAPTCHA_REQUIRED,
          message:
            auth.message ||
            'PDF Naturgy: setNaturgyCredentials(email, password) o setNaturgySessionToken(JWT).',
          document_number: meta.document_number || '',
          printExternalId: printExt,
        };
      }
      token = auth.token;
    }

    var result = downloadPrintedBillWithToken_(token, clientNumber, printExt, meta);
    if (result.ok) return result;

    // One retry with fresh login if auth failed and credentials exist
    if (result.authFailed && getStoredCredentials_()) {
      clearSessionTokenCache_();
      var relogin = ensureAuthToken_(true);
      if (relogin.ok && relogin.token) {
        var retry = downloadPrintedBillWithToken_(relogin.token, clientNumber, printExt, meta);
        if (retry.ok) return retry;
        result = retry;
      }
    }

    if (result.authFailed) {
      result.message =
        (result.message || 'auth failed') +
        ' Renová setNaturgyCredentials o usá Importar PDF Naturgy. No se bypassea Turnstile.';
    }
    return result;
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
    buildPrintedBillUrl: buildPrintedBillUrl,
    buildSessionsUrl: buildSessionsUrl,
    resolvePrintedBillExternalId_: resolvePrintedBillExternalId_,
    decodeBase64Pdf_: decodeBase64Pdf_,
    extractJwtFromSessionResponse_: extractJwtFromSessionResponse_,
    loginSessions: loginSessions,
    ensureAuthToken_: ensureAuthToken_,
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
