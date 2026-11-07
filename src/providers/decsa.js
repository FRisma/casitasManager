/**
 * DECSA (Caucete) — Facturación Conjunta luz+agua vía CoopOnlineWeb.
 *
 * Portal: https://www.cooponlineweb.com.ar/DECSA/
 * Branch B (session) — no public unauth debt/PDF API.
 *
 * Flujo verificado (sin CAPTCHA; sin bypass de auth):
 * 1. GET /Login → scrape __RequestVerificationToken + antiforgery cookie
 * 2. POST /Login (DECSA_EMAIL / DECSA_PASSWORD Script Properties) → .AspNetCore.Cookies
 * 3. (opcional) POST /Principal AddAccount Input.newAccount + Input.newKey — idempotente
 * 4. GET /Facturas (cookie codSum = account_number) → parse RowToPay
 * 5. GET Facturas?handler=Descarga → JSON string URL → api/S3 → %PDF
 *
 * Sheets: account_number ← newKey/codSum; secondary_identifier ← newAccount/titular.
 * Credenciales solo Script Properties. Nunca commit/log password ni cookie jar.
 * No inventar montos. CAPTCHA → AUTH_OR_CAPTCHA_REQUIRED (no bypass).
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Decsa = (function () {
  var ID = 'decsa';
  var BASE = 'https://www.cooponlineweb.com.ar/DECSA';
  var PORTAL = BASE + '/';
  var LOGIN_URL = BASE + '/Login';
  var PRINCIPAL_URL = BASE + '/Principal';
  var FACTURAS_URL = BASE + '/Facturas';
  var USER_AGENT = 'CasitasManager/1.0 (Google Apps Script)';
  var ALREADY_ADDED_RE = /ya fue agregada anteriormente/i;

  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  function isEnabled_(service) {
    if (!service) return false;
    return (
      service.enabled === true ||
      String(service.enabled).toLowerCase() === 'true' ||
      String(service.enabled) === 'TRUE'
    );
  }

  /** Código suministro / cuenta (= Input.newKey / cookie codSum). */
  function accountNumber_(service) {
    return String(
      (service && (service.account_number || service.accountNumber || service.codSum)) || ''
    )
      .trim()
      .replace(/\s+/g, '');
  }

  /** Número titular/asociado (= Input.newAccount). */
  function titularNumber_(service) {
    return String(
      (service &&
        (service.secondary_identifier ||
          service.secondaryIdentifier ||
          service.newAccount ||
          service.titular)) ||
        ''
    )
      .trim()
      .replace(/\s+/g, '');
  }

  function hasCredentials_() {
    var email = String(CM.Settings.get(CM.Settings.KEYS.DECSA_EMAIL, '') || '').trim();
    var password = String(CM.Settings.get(CM.Settings.KEYS.DECSA_PASSWORD, '') || '');
    return !!(email && password);
  }

  function credentialsMissingStatus_() {
    return CM.ProviderInterface.baseStatus(ID, {
      ok: false,
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      message:
        'Faltan DECSA_EMAIL / DECSA_PASSWORD en Script Properties. Usá setDecsaCredentials(email, password).',
      capabilities: {
        checkAvailability: true,
        fetchInvoices: false,
        downloadInvoice: false,
      },
    });
  }

  function extractHidden_(html, name) {
    var s = String(html || '');
    var patterns = [
      new RegExp('name="' + name + '"[^>]*value="([^"]*)"', 'i'),
      new RegExp('id="' + name + '"[^>]*value="([^"]*)"', 'i'),
      new RegExp('value="([^"]*)"[^>]*(?:name|id)="' + name + '"', 'i'),
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i]);
      if (m) return m[1];
    }
    return '';
  }

  function extractRequestVerificationToken_(html) {
    return extractHidden_(html, '__RequestVerificationToken');
  }

  function hasLoginForm_(html) {
    var s = String(html || '');
    return /Input\.Email/i.test(s) && /Input\.Password/i.test(s) && /__RequestVerificationToken/i.test(s);
  }

  function hasFacturasTable_(html) {
    var s = String(html || '');
    return (
      /table-content-facturas/i.test(s) ||
      (/nroFac/i.test(s) && /descargarFactura\s*\(/i.test(s))
    );
  }

  /**
   * Une cookies Set-Cookie de headers UrlFetch con un jar string "k=v; k2=v2".
   * (mismo patrón Municipalidad)
   */
  function mergeCookieJar_(jar, headers) {
    jar = jar || '';
    var map = {};
    String(jar)
      .split(';')
      .forEach(function (part) {
        var p = String(part || '').trim();
        if (!p) return;
        var eq = p.indexOf('=');
        if (eq <= 0) return;
        map[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
      });

    headers = headers || {};
    var raw =
      headers['Set-Cookie'] ||
      headers['set-cookie'] ||
      headers['Set-cookie'] ||
      null;
    var list = [];
    if (raw == null) list = [];
    else if (Object.prototype.toString.call(raw) === '[object Array]') list = raw;
    else list = [raw];

    list.forEach(function (line) {
      var first = String(line || '').split(';')[0].trim();
      var eq = first.indexOf('=');
      if (eq <= 0) return;
      map[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    });

    return Object.keys(map)
      .map(function (k) {
        return k + '=' + map[k];
      })
      .join('; ');
  }

  function setJarCookie_(jar, name, value) {
    var map = {};
    String(jar || '')
      .split(';')
      .forEach(function (part) {
        var p = String(part || '').trim();
        if (!p) return;
        var eq = p.indexOf('=');
        if (eq <= 0) return;
        map[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
      });
    if (value == null || value === '') {
      delete map[name];
    } else {
      map[name] = String(value);
    }
    return Object.keys(map)
      .map(function (k) {
        return k + '=' + map[k];
      })
      .join('; ');
  }

  function jarHasSession_(jar) {
    return /\.AspNetCore\.Cookies=/i.test(String(jar || ''));
  }

  function requestHeaders_(cookieJar, extras) {
    var h = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: PORTAL,
    };
    if (cookieJar) h.Cookie = cookieJar;
    extras = extras || {};
    Object.keys(extras).forEach(function (k) {
      h[k] = extras[k];
    });
    return h;
  }

  function portalRequest_(method, url, payload, cookieJar, options) {
    options = options || {};
    var headers = requestHeaders_(cookieJar, options.headers);
    var res;
    if (method === 'get') {
      res = CM.ProviderInterface.httpGet(url, {
        headers: headers,
        followRedirects: options.followRedirects !== false,
      });
    } else {
      res = CM.ProviderInterface.httpPost(url, payload, {
        contentType: options.contentType || 'application/x-www-form-urlencoded',
        headers: headers,
        followRedirects: options.followRedirects !== false,
      });
    }
    var nextJar = mergeCookieJar_(cookieJar, res.headers || {});
    var contentType =
      res.contentType ||
      (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) ||
      '';
    return {
      ok: !!res.ok,
      code: res.code || 0,
      body: res.body || '',
      blob: res.blob || null,
      headers: res.headers || {},
      contentType: contentType,
      error: res.error || '',
      outcome: res.outcome,
      cookieJar: nextJar,
      token: extractRequestVerificationToken_(res.body || ''),
    };
  }

  /**
   * GET Login → POST Login (followRedirects false para capturar Set-Cookie del 302).
   * Nunca loguea email/password/cookie.
   */
  function loginSession_() {
    if (!hasCredentials_()) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Faltan DECSA_EMAIL / DECSA_PASSWORD. Usá setDecsaCredentials(email, password).',
        cookieJar: '',
      };
    }

    var getRes = portalRequest_('get', LOGIN_URL, null, '', { followRedirects: true });
    if (!getRes.ok) {
      return {
        ok: false,
        outcome: getRes.outcome || O().PORTAL_INACCESSIBLE,
        message: getRes.error || 'HTTP ' + getRes.code + ' en GET Login',
        httpCode: getRes.code,
        cookieJar: getRes.cookieJar || '',
      };
    }
    if (CM.ProviderInterface.detectCaptcha(getRes.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA en DECSA Login (no se bypasea)',
        httpCode: getRes.code,
        cookieJar: getRes.cookieJar || '',
        captcha: true,
      };
    }
    if (!hasLoginForm_(getRes.body) || !getRes.token) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'GET Login sin form / __RequestVerificationToken',
        httpCode: getRes.code,
        cookieJar: getRes.cookieJar || '',
      };
    }

    var email = String(CM.Settings.get(CM.Settings.KEYS.DECSA_EMAIL, '') || '').trim();
    var password = String(CM.Settings.get(CM.Settings.KEYS.DECSA_PASSWORD, '') || '');
    var payload = {
      'Input.Email': email,
      'Input.Password': password,
      login: '',
      __RequestVerificationToken: getRes.token,
      'Input.RememberMe': 'false',
    };

    var postRes = portalRequest_('post', LOGIN_URL, payload, getRes.cookieJar, {
      followRedirects: false,
      headers: {
        Origin: 'https://www.cooponlineweb.com.ar',
        Referer: LOGIN_URL,
      },
    });

    var jar = postRes.cookieJar || getRes.cookieJar || '';
    var code = postRes.code || 0;
    // 302 → Principal es el happy path; 200 con cookies de sesión también OK (follow parcial).
    var redirected =
      code >= 300 &&
      code < 400 &&
      /Principal|Facturas/i.test(
        String(
          (postRes.headers && (postRes.headers.Location || postRes.headers.location)) || ''
        )
      );
    var loggedIn = jarHasSession_(jar) || redirected;

    if (!loggedIn) {
      // Si followRedirects false y 302 sin cookie visible, seguir un hop a Location.
      var loc =
        (postRes.headers && (postRes.headers.Location || postRes.headers.location)) || '';
      if (code >= 300 && code < 400 && loc) {
        var abs = String(loc);
        if (abs.indexOf('http') !== 0) {
          abs = 'https://www.cooponlineweb.com.ar' + (abs.charAt(0) === '/' ? abs : '/' + abs);
        }
        var hop = portalRequest_('get', abs, null, jar, { followRedirects: true });
        jar = hop.cookieJar || jar;
        loggedIn = jarHasSession_(jar) || hasFacturasTable_(hop.body) || /Principal/i.test(hop.body || '');
        if (CM.ProviderInterface.detectCaptcha(hop.body)) {
          return {
            ok: false,
            outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
            message: 'CAPTCHA tras Login DECSA (no se bypasea)',
            httpCode: hop.code,
            cookieJar: jar,
            captcha: true,
          };
        }
      }
    }

    if (!loggedIn) {
      if (CM.ProviderInterface.detectCaptcha(postRes.body)) {
        return {
          ok: false,
          outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
          message: 'CAPTCHA tras POST Login (no se bypasea)',
          httpCode: code,
          cookieJar: jar,
          captcha: true,
        };
      }
      if (hasLoginForm_(postRes.body)) {
        return {
          ok: false,
          outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
          message: 'Login DECSA rechazado (sigue en form Login). Revisá DECSA_EMAIL/PASSWORD.',
          httpCode: code,
          cookieJar: jar,
        };
      }
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Login DECSA sin cookie de sesión (HTTP ' + code + ')',
        httpCode: code,
        cookieJar: jar,
      };
    }

    return {
      ok: true,
      outcome: 'logged_in',
      message: 'Sesión DECSA OK',
      cookieJar: jar,
      httpCode: code,
    };
  }

  /**
   * AddAccount opcional (hub). Idempotente: toast "ya fue agregada…" = OK.
   * Phase-1: best-effort; fallo no bloquea si Facturas ya lista el suministro.
   */
  function tryAddAccount_(cookieJar, service) {
    var newKey = accountNumber_(service);
    var newAccount = titularNumber_(service);
    if (!newKey || !newAccount) {
      return {
        ok: true,
        skipped: true,
        message: 'AddAccount omitido (falta account_number o secondary_identifier)',
        cookieJar: cookieJar,
      };
    }

    var getRes = portalRequest_('get', PRINCIPAL_URL, null, cookieJar, {
      followRedirects: true,
    });
    var jar = getRes.cookieJar || cookieJar;
    if (!getRes.ok) {
      return {
        ok: false,
        skipped: false,
        message: getRes.error || 'HTTP ' + getRes.code + ' en GET Principal',
        cookieJar: jar,
        httpCode: getRes.code,
      };
    }
    var token = getRes.token || extractRequestVerificationToken_(getRes.body);
    if (!token) {
      return {
        ok: false,
        skipped: false,
        message: 'Principal sin __RequestVerificationToken para AddAccount',
        cookieJar: jar,
        httpCode: getRes.code,
      };
    }

    var postRes = portalRequest_(
      'post',
      PRINCIPAL_URL,
      {
        'Input.newAccount': newAccount,
        'Input.newKey': newKey,
        __RequestVerificationToken: token,
      },
      jar,
      {
        followRedirects: true,
        headers: {
          Origin: 'https://www.cooponlineweb.com.ar',
          Referer: PRINCIPAL_URL,
        },
      }
    );
    jar = postRes.cookieJar || jar;
    var body = String(postRes.body || '');
    var toast = '';
    var tm = body.match(/msgToastPrincipal\s*=\s*'((?:\\'|[^'])*)'/);
    if (tm) toast = tm[1].replace(/\\'/g, "'");

    if (ALREADY_ADDED_RE.test(toast) || ALREADY_ADDED_RE.test(body)) {
      return {
        ok: true,
        alreadyLinked: true,
        message: 'AddAccount: suministro ya vinculado al hub',
        cookieJar: jar,
        toast: toast,
      };
    }
    if (!postRes.ok) {
      return {
        ok: false,
        message: postRes.error || 'HTTP ' + postRes.code + ' en AddAccount',
        cookieJar: jar,
        httpCode: postRes.code,
        toast: toast,
      };
    }
    return {
      ok: true,
      alreadyLinked: false,
      message: toast || 'AddAccount POST OK',
      cookieJar: jar,
      toast: toast,
    };
  }

  /**
   * Parsea filas Facturas. Periodo preferido: mes de emisión (no inventar montos).
   */
  function parseFacturasHtml_(html, service) {
    var s = String(html || '');
    var rows = [];
    var periodHint = '';
    var trRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    var tr;
    while ((tr = trRe.exec(s))) {
      var attrs = tr[1] || '';
      var inner = tr[2] || '';
      if (/disabledRow/i.test(attrs)) {
        var ph = inner.match(/(\d{1,2}\/\d{4})/);
        if (ph) periodHint = ph[1];
        continue;
      }
      if (!/nroFac/i.test(inner) && !/descargarFactura\s*\(/i.test(inner)) continue;

      var nro = '';
      var nm = inner.match(/class="nroFac"[^>]*>([^<]+)/i);
      if (nm) nro = String(nm[1] || '').trim();

      var codSum = '';
      var sm = inner.match(/class="suministro"[^>]*>([^<]+)/i);
      if (sm) codSum = String(sm[1] || '').trim();

      var pathFile = '';
      var dl = inner.match(
        /descargarFactura\s*\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'([^']+)'\s*\)/i
      );
      if (dl) {
        if (!nro) nro = dl[1];
        if (!codSum) codSum = String(dl[2]);
        pathFile = dl[3];
      }

      var comprobante = '';
      var cm = inner.match(/class="ResComNumFac[^"]*"[^>]*>([^<]+)/i);
      if (cm) comprobante = String(cm[1] || '').trim();

      var tipo = '';
      var tm = inner.match(/class="tipoFac"[^>]*>([^<]+)/i);
      if (tm) tipo = String(tm[1] || '').trim();

      var issueRaw = '';
      var cells = inner.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
      for (var ci = 0; ci < cells.length; ci++) {
        var cellText = String(cells[ci] || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(cellText) && !issueRaw) {
          // First bare DD/MM/YYYY cell is emisión (Vto is in span.Vto1)
          if (!/Vto1/i.test(cells[ci])) {
            issueRaw = cellText;
          }
        }
      }
      // Prefer explicit emission cell that is not Vto1
      for (var cj = 0; cj < cells.length; cj++) {
        if (/Vto1/i.test(cells[cj])) continue;
        var ct = String(cells[cj] || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(ct)) {
          issueRaw = ct;
          break;
        }
      }

      var dueRaw = '';
      var vm = inner.match(/class="Vto1"[^>]*>([^<]+)/i);
      if (vm) dueRaw = String(vm[1] || '').trim();

      var amount = null;
      var am = inner.match(/class="[^"]*\btotal\b[^"]*"[^>]*>([^<]+)/i);
      if (am) {
        var rawAmt = String(am[1] || '').trim();
        // List amounts are like 68919.26 (dot decimal)
        if (/^\d+(\.\d+)?$/.test(rawAmt)) {
          amount = parseFloat(rawAmt);
        } else {
          amount = CM.Invoices && CM.Invoices.normalizeAmount
            ? CM.Invoices.normalizeAmount(rawAmt)
            : null;
        }
      }

      var unpaid =
        /RowToPay/i.test(attrs) || /Pendiente de Pago/i.test(inner);
      var paid = /facPagada/i.test(inner) || /\bPagado\b/i.test(inner);

      var billingPeriod = '';
      if (issueRaw) {
        var iso = CM.Dates.parseDateToISO(issueRaw);
        if (iso && iso.length >= 7) billingPeriod = iso.substring(0, 7);
      }
      if (!billingPeriod && periodHint) {
        billingPeriod = CM.Dates.normalizeBillingPeriod(periodHint);
      }

      var account = accountNumber_(service) || codSum;
      rows.push({
        provider: ID,
        service_id: (service && service.service_id) || '',
        accountNumber: account,
        invoiceNumber: nro,
        comprobante: comprobante,
        tipoFac: tipo,
        billingPeriod: billingPeriod,
        amount: amount,
        currency: 'ARS',
        issueDate: CM.Dates.parseDateToISO(issueRaw) || issueRaw,
        dueDate: CM.Dates.parseDateToISO(dueRaw) || dueRaw,
        invoice_status: 'detected',
        payment_status: unpaid ? 'unknown' : paid ? 'unknown' : 'unknown',
        notes:
          'decsa_portal|tipo=' +
          tipo +
          '|comprobante=' +
          comprobante +
          (unpaid ? '|pendiente' : paid ? '|pagado' : ''),
        autoDownload: !!(nro && pathFile && codSum),
        nroFactura: nro,
        pathFile: pathFile,
        codSum: codSum,
        unpaid: unpaid,
        paid: paid,
        periodHint: periodHint || '',
      });
    }
    return rows;
  }

  function looksLikePdfResponse_(res) {
    if (!res) return false;
    var ct = String(res.contentType || '').toLowerCase();
    if (ct.indexOf('pdf') >= 0) return true;
    if (res.blob && typeof res.blob.getBytes === 'function') {
      try {
        if (CM.Pdf.looksLikePdf(res.blob.getBytes())) return true;
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof res.body === 'string' && res.body.indexOf('%PDF') === 0) return true;
    return false;
  }

  /**
   * Parse PDF text for Facturación Conjunta splits (TOTAL OSSE / TOTAL A PAGAR / conjunta).
   * Accepts plain extracted text or PDF bytes via CM.Pdf.extractEmbeddedText.
   */
  function parseJointPdfSplits_(textOrBytes) {
    var text = '';
    if (typeof textOrBytes === 'string') {
      text = textOrBytes;
    } else if (textOrBytes && CM.Pdf && CM.Pdf.extractEmbeddedText) {
      text = CM.Pdf.extractEmbeddedText(textOrBytes) || '';
    }
    text = String(text || '');
    var out = {
      decsaTotal: null,
      osseTotal: null,
      jointTotal: null,
      foundOsse: false,
      foundDecsa: false,
      foundJoint: false,
    };
    if (!text) return out;

    function parseAr_(raw) {
      if (raw == null || raw === '') return null;
      var s = String(raw).trim();
      // 38.247,31 or 68919,26 or 107.166,57
      if (/\d+\.\d{3},\d{2}/.test(s) || /^\d+,\d{2}$/.test(s)) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else if (/^\d+\.\d+$/.test(s)) {
        // already dot-decimal
      } else if (CM.Invoices && CM.Invoices.normalizeAmount) {
        return CM.Invoices.normalizeAmount(s);
      }
      var n = parseFloat(s);
      return isNaN(n) ? null : n;
    }

    var osseM = text.match(/TOTAL\s+OSSE[^0-9$]*\$?\s*([\d.\s]+,\d{2}|\d+\.\d+)/i);
    if (osseM) {
      out.osseTotal = parseAr_(osseM[1].replace(/\s+/g, ''));
      out.foundOsse = out.osseTotal != null;
    }

    // DECSA TOTAL A PAGAR (avoid matching OSSE block "Total a Pagar")
    var decsaM =
      text.match(/TOTAL\s+A\s+PAGAR\s*:\s*\$?\s*([\d.\s]+,\d{2}|\d+\.\d+)/i) ||
      text.match(/DECSA[\s\S]{0,80}?TOTAL\s+A\s+PAGAR[^0-9$]*\$?\s*([\d.\s]+,\d{2}|\d+\.\d+)/i);
    if (decsaM) {
      out.decsaTotal = parseAr_(decsaM[1].replace(/\s+/g, ''));
      out.foundDecsa = out.decsaTotal != null;
    }

    // Prefer amount with thousand separators after a standalone "Facturacion Conjunta"
    // section (avoid matching the title line that precedes DECSA TOTAL A PAGAR).
    var jointM =
      text.match(
        /\bFacturaci[oó]n\s+Conjunta\b[\s\S]{0,200}?Total\s+a\s+Pagar[^0-9$]*\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2})/i
      ) ||
      text.match(
        /\bFacturaci[oó]n\s+Conjunta\b\s+Total\s+a\s+Pagar[^0-9$]*\$?\s*([\d.\s]+,\d{2}|\d+\.\d+)/i
      );
    if (jointM) {
      out.jointTotal = parseAr_(jointM[1].replace(/\s+/g, ''));
      out.foundJoint = out.jointTotal != null;
    }

    return out;
  }

  function openFacturasSession_(service, options) {
    options = options || {};
    if (!isEnabled_(service)) {
      return {
        ok: false,
        outcome: O().DISABLED,
        message: 'DECSA enabled=false',
        invoices: [],
      };
    }
    var account = accountNumber_(service);
    if (!account) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta account_number (codSum / Input.newKey) — no inventar',
        invoices: [],
      };
    }
    if (!hasCredentials_()) {
      var miss = credentialsMissingStatus_();
      return {
        ok: false,
        outcome: miss.outcome,
        message: miss.message,
        invoices: [],
      };
    }

    var login = loginSession_();
    if (!login.ok) {
      return {
        ok: false,
        outcome: login.outcome || O().AUTH_OR_CAPTCHA_REQUIRED,
        message: login.message,
        httpCode: login.httpCode,
        invoices: [],
        captcha: !!login.captcha,
      };
    }

    var jar = login.cookieJar || '';
    var addAccount = null;
    if (options.skipAddAccount !== true) {
      addAccount = tryAddAccount_(jar, service);
      if (addAccount && addAccount.cookieJar) jar = addAccount.cookieJar;
      // Soft-fail: continue to Facturas even if AddAccount failed (already-linked supplies).
    }

    jar = setJarCookie_(jar, 'codSum', account);

    var factRes = portalRequest_('get', FACTURAS_URL, null, jar, {
      followRedirects: true,
      headers: { Referer: PRINCIPAL_URL },
    });
    jar = factRes.cookieJar || jar;

    if (!factRes.ok) {
      return {
        ok: false,
        outcome: factRes.outcome || O().PORTAL_INACCESSIBLE,
        message: factRes.error || 'HTTP ' + factRes.code + ' en GET Facturas',
        httpCode: factRes.code,
        invoices: [],
        addAccount: addAccount,
      };
    }
    if (CM.ProviderInterface.detectCaptcha(factRes.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA en Facturas DECSA (no se bypasea)',
        httpCode: factRes.code,
        invoices: [],
        captcha: true,
      };
    }
    if (hasLoginForm_(factRes.body) && !hasFacturasTable_(factRes.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'GET Facturas redirigió a Login — sesión inválida',
        httpCode: factRes.code,
        invoices: [],
      };
    }
    if (!hasFacturasTable_(factRes.body)) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'Facturas HTML sin tabla / nroFac / descargarFactura',
        httpCode: factRes.code,
        invoices: [],
        htmlLength: String(factRes.body || '').length,
      };
    }

    var all = parseFacturasHtml_(factRes.body, service);
    // Scope to this property's codSum when present on rows
    var scoped = all.filter(function (inv) {
      return !inv.codSum || String(inv.codSum) === String(account);
    });
    if (!scoped.length) scoped = all;

    return {
      ok: true,
      outcome: 'listed_ok',
      message: 'DECSA listó ' + scoped.length + ' factura(s) (codSum=' + account + ')',
      httpCode: factRes.code,
      invoices: scoped,
      cookieJar: jar,
      html: factRes.body,
      addAccount: addAccount,
      account: account,
    };
  }

  function buildDescargaUrl_(nroFactura, codSum, pathFile) {
    return (
      FACTURAS_URL +
      '?handler=Descarga&NroFactura=' +
      encodeURIComponent(String(nroFactura) + '|' + String(codSum)) +
      '&PathFile=' +
      encodeURIComponent(String(pathFile)) +
      '&_=' +
      String(Date.now())
    );
  }

  function parseDescargaUrl_(body) {
    var raw = String(body || '').trim();
    if (!raw) return '';
    try {
      var parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed && typeof parsed.url === 'string') return parsed.url.trim();
    } catch (e) {
      // quoted URL without full JSON? strip quotes
      var m = raw.match(/^"([^"]+)"/);
      if (m) return m[1];
      if (/^https?:\/\//i.test(raw)) return raw;
    }
    return '';
  }

  /**
   * Descarga 2 hops: handler=Descarga → JSON URL → follow → PDF bytes.
   */
  function downloadPdfWithSession_(cookieJar, meta) {
    meta = meta || {};
    var nro = meta.nroFactura || meta.invoiceNumber || meta.invoice_number || '';
    var codSum = meta.codSum || accountNumber_(meta) || '';
    var pathFile = meta.pathFile || meta.PathFile || '';
    if (!nro || !codSum || !pathFile) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Faltan nroFactura / codSum / pathFile para Descarga',
      };
    }

    var url = buildDescargaUrl_(nro, codSum, pathFile);
    var step1 = portalRequest_('get', url, null, cookieJar, {
      followRedirects: true,
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: FACTURAS_URL,
        'Content-Type': 'application/text; charset=utf-8',
      },
    });

    if (!step1.ok) {
      return {
        ok: false,
        outcome: step1.outcome || O().PORTAL_INACCESSIBLE,
        message: step1.error || 'HTTP ' + step1.code + ' en Descarga',
        httpCode: step1.code,
      };
    }

    // Honest: Descarga must NOT be raw PDF
    if (looksLikePdfResponse_(step1)) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message:
          'Descarga devolvió PDF directo (se esperaba JSON URL). Revisar adapter.',
        httpCode: step1.code,
        contentType: step1.contentType,
      };
    }

    var downloadUrl = parseDescargaUrl_(step1.body);
    if (!downloadUrl || !/^https?:\/\//i.test(downloadUrl)) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message:
          'Descarga no devolvió URL JSON usable (content-type=' +
          (step1.contentType || '') +
          ', len=' +
          String(step1.body || '').length +
          ')',
        httpCode: step1.code,
        contentType: step1.contentType,
      };
    }

    var step2 = CM.ProviderInterface.httpGet(downloadUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/pdf,*/*',
        Referer: FACTURAS_URL,
      },
      followRedirects: true,
    });

    if (!step2.ok) {
      return {
        ok: false,
        outcome: step2.outcome || O().PORTAL_INACCESSIBLE,
        message: step2.error || 'HTTP ' + step2.code + ' en Link/Download',
        httpCode: step2.code,
      };
    }

    var pdfRes = {
      ok: step2.ok,
      code: step2.code,
      body: step2.body,
      blob: step2.blob,
      contentType:
        step2.contentType ||
        (step2.headers && (step2.headers['Content-Type'] || step2.headers['content-type'])) ||
        '',
      headers: step2.headers || {},
    };

    if (!looksLikePdfResponse_(pdfRes) || !pdfRes.blob) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message:
          'Link/Download no devolvió PDF (content-type=' +
          (pdfRes.contentType || '') +
          ')',
        httpCode: pdfRes.code,
        contentType: pdfRes.contentType,
      };
    }

    var magicOk = false;
    var bytes = null;
    try {
      bytes = pdfRes.blob.getBytes();
      magicOk = CM.Pdf.looksLikePdf(bytes);
    } catch (e) {
      magicOk = String(pdfRes.body || '').indexOf('%PDF') === 0;
    }
    if (!magicOk) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message: 'Respuesta download sin magic %PDF',
        httpCode: pdfRes.code,
      };
    }

    var splits = parseJointPdfSplits_(bytes || pdfRes.body);
    return {
      ok: true,
      outcome: O().DOWNLOADED_OK,
      message: 'PDF DECSA OK (Descarga → API → S3)',
      blob: pdfRes.blob,
      contentType: pdfRes.contentType || 'application/pdf',
      httpCode: pdfRes.code,
      invoiceNumber: nro,
      nroFactura: nro,
      pathFile: pathFile,
      codSum: codSum,
      downloadUrlHost: (function () {
        try {
          var m = String(downloadUrl).match(/^https?:\/\/([^/]+)/i);
          return m ? m[1] : '';
        } catch (e2) {
          return '';
        }
      })(),
      // optional split metadata — never invent; only when anchors found
      amount: splits.foundDecsa ? splits.decsaTotal : null,
      osseAmount: splits.foundOsse ? splits.osseTotal : null,
      jointAmount: splits.foundJoint ? splits.jointTotal : null,
      decsaAmount: splits.foundDecsa ? splits.decsaTotal : null,
      pdfSplits: splits,
    };
  }

  function checkAvailability(service) {
    if (!isEnabled_(service)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().DISABLED,
        message: 'Proveedor inactivo (enabled=false).',
        capabilities: { checkAvailability: true },
      });
    }
    if (!accountNumber_(service)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta account_number (codSum / Input.newKey) — no inventar.',
        capabilities: { checkAvailability: true },
      });
    }

    var getRes = portalRequest_('get', LOGIN_URL, null, '', { followRedirects: true });
    if (!getRes.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: getRes.outcome || O().PORTAL_INACCESSIBLE,
        message: getRes.error || 'HTTP ' + getRes.code,
        httpCode: getRes.code,
        portal: PORTAL,
        capabilities: { checkAvailability: true },
      });
    }
    if (CM.ProviderInterface.detectCaptcha(getRes.body)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA en Login DECSA (no se bypasea)',
        httpCode: getRes.code,
        captcha: true,
        capabilities: { checkAvailability: true },
      });
    }
    var formOk = hasLoginForm_(getRes.body);
    var creds = hasCredentials_();
    return CM.ProviderInterface.baseStatus(ID, {
      ok: formOk,
      outcome: formOk ? 'portal_reachable' : O().PORTAL_STRUCTURE_CHANGED,
      message: formOk
        ? creds
          ? 'Login DECSA OK; fetch/download con sesión hub'
          : 'Login form OK; falta setDecsaCredentials para PDF'
        : 'HTML Login sin campos esperados',
      httpCode: getRes.code,
      portal: PORTAL,
      account: accountNumber_(service),
      credentialsSet: creds,
      capabilities: {
        checkAvailability: true,
        fetchInvoices: formOk && creds,
        downloadInvoice: formOk && creds,
        extractInvoiceMetadata: formOk && creds,
        getOutstandingDebt: false,
      },
    });
  }

  function fetchInvoices(service, options) {
    options = options || {};
    var session = openFacturasSession_(service, options);
    if (!session.ok) {
      return {
        outcome: session.outcome || O().ERROR,
        invoices: [],
        message: session.message,
        httpCode: session.httpCode,
        captcha: !!session.captcha,
      };
    }

    var mapped = (session.invoices || []).slice();
    var includePaid = options.includePaid === true;
    if (!includePaid) {
      mapped = mapped.filter(function (inv) {
        return inv.unpaid;
      });
    }

    mapped.sort(function (a, b) {
      var da = String(a.billingPeriod || '');
      var db = String(b.billingPeriod || '');
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
    if (limit > 0 && mapped.length > limit) mapped = mapped.slice(0, limit);

    if (!mapped.length) {
      return {
        outcome: O().INVOICE_NOT_AVAILABLE_YET,
        invoices: [],
        message: options.billingPeriod
          ? 'Portal OK; sin facturas pendientes para período ' + options.billingPeriod
          : 'Portal OK; sin facturas pendientes (RowToPay) para codSum ' +
            accountNumber_(service),
        httpCode: session.httpCode,
        totalFromPortal: (session.invoices || []).length,
        addAccount: session.addAccount,
      };
    }

    return {
      outcome: 'listed_ok',
      invoices: mapped,
      message: 'DECSA listó ' + mapped.length + ' pendiente(s)',
      httpCode: session.httpCode,
      totalFromPortal: (session.invoices || []).length,
      addAccount: session.addAccount,
      // jar no se serializa a Sheets; downloadInvoice reabre sesión
    };
  }

  function downloadInvoice(serviceOrInvoice, invoiceMeta) {
    var meta = invoiceMeta || serviceOrInvoice || {};
    var service = invoiceMeta ? serviceOrInvoice : null;
    if (!service && meta) {
      service = {
        enabled: true,
        account_number: meta.codSum || meta.accountNumber || meta.account_number || '',
        secondary_identifier: meta.secondary_identifier || '',
        service_id: meta.service_id || '',
      };
    }
    if (!service) {
      try {
        service = CM.ServiceCatalog.getByProvider(ID);
      } catch (e) {
        service = null;
      }
    }

    var session = openFacturasSession_(service, { skipAddAccount: false });
    if (!session.ok) {
      return {
        ok: false,
        outcome: session.outcome || O().ERROR,
        message: session.message,
        httpCode: session.httpCode,
      };
    }

    // Resolve download args from meta or matching listed row
    var nro = meta.nroFactura || meta.invoiceNumber || meta.invoice_number || '';
    var pathFile = meta.pathFile || '';
    var codSum = meta.codSum || accountNumber_(service);
    if ((!nro || !pathFile) && session.invoices && session.invoices.length) {
      var wantPeriod = meta.billingPeriod || meta.billing_period || '';
      var pick = null;
      for (var i = 0; i < session.invoices.length; i++) {
        var inv = session.invoices[i];
        if (nro && String(inv.nroFactura) === String(nro)) {
          pick = inv;
          break;
        }
        if (
          wantPeriod &&
          CM.Dates.normalizeBillingPeriod(inv.billingPeriod) ===
            CM.Dates.normalizeBillingPeriod(wantPeriod)
        ) {
          pick = inv;
          break;
        }
      }
      if (!pick) {
        // Prefer first unpaid
        for (var j = 0; j < session.invoices.length; j++) {
          if (session.invoices[j].unpaid) {
            pick = session.invoices[j];
            break;
          }
        }
      }
      if (!pick) pick = session.invoices[0];
      if (pick) {
        nro = nro || pick.nroFactura;
        pathFile = pathFile || pick.pathFile;
        codSum = codSum || pick.codSum;
        if (!meta.billingPeriod) meta.billingPeriod = pick.billingPeriod;
        if (meta.amount == null && pick.amount != null) meta.amount = pick.amount;
      }
    }

    var dl = downloadPdfWithSession_(session.cookieJar, {
      nroFactura: nro,
      pathFile: pathFile,
      codSum: codSum,
      invoiceNumber: nro,
    });
    if (dl.ok && meta.amount != null && dl.amount == null) {
      // Keep list amount if PDF split did not find DECSA total
      dl.amount = meta.amount;
    }
    if (dl.ok) {
      dl.billingPeriod = meta.billingPeriod || meta.billing_period || '';
      dl.dueDate = meta.dueDate || meta.due_date || '';
      dl.issueDate = meta.issueDate || meta.issue_date || '';
    }
    return dl;
  }

  function extractInvoiceMetadata(service, invoiceMeta) {
    var fetched = fetchInvoices(service, {
      billingPeriod: invoiceMeta && (invoiceMeta.billingPeriod || invoiceMeta.billing_period),
      limit: 1,
      includePaid: true,
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
      note: 'No inferir pago por ausencia de deuda; usar listado RowToPay / marcar pagada',
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
    // helpers tests
    mergeCookieJar_: mergeCookieJar_,
    setJarCookie_: setJarCookie_,
    extractRequestVerificationToken_: extractRequestVerificationToken_,
    hasLoginForm_: hasLoginForm_,
    hasFacturasTable_: hasFacturasTable_,
    parseFacturasHtml_: parseFacturasHtml_,
    parseDescargaUrl_: parseDescargaUrl_,
    parseJointPdfSplits_: parseJointPdfSplits_,
    buildDescargaUrl_: buildDescargaUrl_,
    accountNumber_: accountNumber_,
    titularNumber_: titularNumber_,
    ALREADY_ADDED_RE: ALREADY_ADDED_RE,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Decsa;
}
