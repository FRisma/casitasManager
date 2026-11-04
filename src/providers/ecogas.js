/**
 * Ecogas (gas) — prioridad #1.
 *
 * Hallazgos (2026-11-04, sonda HTTP + curls post-login de Franco):
 * - Portal login: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  → 200 HTML
 * - Form POST action=logon?s=p&c=0 id=form_login_po + Google reCAPTCHA
 *   → UrlFetchApp NO puede completar login. NO bypassear captcha.
 * - Post-login (sesión humana):
 *   GET /uiextranet/index?s=p  (Cookie SID + jar F5/TS) → landing
 *   GET /uiextranet/res/panel_detalle_fact.php?d=…&c=20259678&t=… (XHR) → detalle
 *   POST /uiextranet/res/tra/reimp/impresion_jano.php  (Imprimir; enviar()→#fdocdeu+#impresion)
 *     fields: p,d,c(padded),t=cuy,i=FA,logreimp=S,m=p,pp,form_pp=PP
 *     pp=0401B60797913A → p=0401, d=60797913; c=000020259678 ← cuenta 20259678
 * - PDF confirmado (2026-11-04): POST Imprimir → 200 application/pdf ~313KB %PDF-
 *   **sin Cookie** si p/d/c/t/i/pp/form_pp conocidos (cloud + Franco).
 * - Listar/descubrir `pp` sigue necesitando sesión humana (reCAPTCHA); no inventar listing.
 * - SID solo → 302 login; detalle sin sesión → body vacío.
 *
 * Download auto cuando hay nº de comprobante (Property / menú; form field `pp`).
 * Fallback: Importar PDF Ecogas desde Drive. Cookie opcional; nunca commitear cookies.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Ecogas = (function () {
  var ID = 'ecogas';
  var PORTAL = 'https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p';
  var INDEX = 'https://autogestion.ecogas.com.ar/uiextranet/index?s=p';
  var DETAIL_PATH = '/uiextranet/res/panel_detalle_fact.php';
  var DETAIL_BASE = 'https://autogestion.ecogas.com.ar' + DETAIL_PATH;
  var PRINT_PATH = '/uiextranet/res/tra/reimp/impresion_jano.php';
  var PRINT_URL = 'https://autogestion.ecogas.com.ar' + PRINT_PATH;

  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  /**
   * Cuenta Ecogas en form Imprimir: 12 dígitos con ceros a la izquierda.
   * 20259678 → 000020259678
   */
  function padAccountNumber(raw) {
    var s = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (!s) return '';
    while (s.length < 12) s = '0' + s;
    return s;
  }

  /**
   * pp / detail id compuesto: 0401B60797913A → { p:'0401', d:'60797913', letter:'B', suffix:'A' }
   */
  function parseCompoundInvoiceId(pp) {
    var s = String(pp == null ? '' : pp).trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})([A-Za-z])(\d+)([A-Za-z])?$/);
    if (!m) return null;
    return {
      pp: s,
      p: m[1],
      letter: m[2].toUpperCase(),
      d: m[3],
      suffix: m[4] ? m[4].toUpperCase() : '',
    };
  }

  /**
   * Arma payload de #fdocdeu / impresion_jano.php (puro).
   * Defaults de captura DOM 2026-11-04: t=cuy, i=FA, logreimp=S, m=p, form_pp=PP.
   * Nota: t aquí es tipo corto ("cuy"), distinto del token largo ?t= del detalle XHR.
   *
   * @returns {{ok:true,payload:object,printUrl:string}|{ok:false,reason:string,message:string}}
   */
  function buildPrintFormPayload(input) {
    input = input || {};
    var pp = String(
      input.pp || input.comprobante || input.detailId || input.compoundId || ''
    ).trim();
    if (!pp && input.p && input.d) {
      // permitir p+d sueltos sin reconstruir pp
      pp = String(input.pp || input.comprobante || '').trim();
    }
    var parsed = pp ? parseCompoundInvoiceId(pp) : null;
    var p = String(input.p || (parsed && parsed.p) || '').trim();
    var d = String(input.d || (parsed && parsed.d) || '').trim();
    var accountRaw =
      input.accountNumber != null
        ? input.accountNumber
        : input.account_number != null
          ? input.account_number
          : input.c != null
            ? input.c
            : '';
    var c =
      input.cPadded != null && String(input.cPadded).trim() !== ''
        ? String(input.cPadded).replace(/\D/g, '')
        : padAccountNumber(accountRaw);

    if (!p || !d) {
      return {
        ok: false,
        reason: 'missing_p_d',
        message:
          'Faltan p/d (o nº de comprobante tipo 0401B60797913A). Ver form Imprimir / Network.',
      };
    }
    if (!c || c.length < 8) {
      return {
        ok: false,
        reason: 'missing_account',
        message: 'Falta cuenta (c). Seed: 20259678 → padded 000020259678.',
      };
    }
    if (!pp) {
      // sin comprobante/pp no inventamos letter/suffix
      return {
        ok: false,
        reason: 'missing_pp',
        message: 'Falta número de comprobante (ej. 0401B60797913A).',
      };
    }

    var payload = {
      p: p,
      d: d,
      c: c,
      t: input.t != null && String(input.t) !== '' ? String(input.t) : 'cuy',
      i: input.i != null && String(input.i) !== '' ? String(input.i) : 'FA',
      logreimp:
        input.logreimp != null && String(input.logreimp) !== ''
          ? String(input.logreimp)
          : 'S',
      m: input.m != null && String(input.m) !== '' ? String(input.m) : 'p',
      pp: pp,
      form_pp:
        input.form_pp != null && String(input.form_pp) !== ''
          ? String(input.form_pp)
          : 'PP',
    };
    return { ok: true, payload: payload, printUrl: PRINT_URL, parsed: parsed };
  }

  /**
   * Busca candidatos a descarga/PDF en el HTML de panel_detalle_fact (o similar).
   * Puro — sin UrlFetch. No inventa URLs: solo extrae del markup.
   *
   * Patrones: href/src .pdf, descarg|imprim|boleta|factura, panel_*.php, onclick location/open.
   *
   * @returns {{candidates:Array<{url:string,kind:string,text:string}>, pdfLikely:boolean}}
   */
  function extractDetailDownloadCandidates(html) {
    var out = [];
    var seen = {};
    if (html == null || String(html).trim() === '') {
      return { candidates: out, pdfLikely: false, empty: true };
    }
    var s = String(html);

    function push(url, kind, text) {
      url = String(url || '').trim();
      if (!url || url === '#' || /^javascript:/i.test(url)) return;
      var key = url + '|' + kind;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({
        url: url,
        kind: kind,
        text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }

    var reHref =
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = reHref.exec(s))) {
      var href = m[1];
      var text = m[2].replace(/<[^>]+>/g, '');
      var kind = classifyDownloadUrl_(href, text);
      if (kind) push(href, kind, text);
    }

    var reSrc = /<(?:iframe|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    while ((m = reSrc.exec(s))) {
      kind = classifyDownloadUrl_(m[1], '');
      if (kind) push(m[1], kind, '');
    }

    var reJs =
      /(?:window\.open|location(?:\.href)?|document\.location)\s*=\s*["']([^"']+)["']/gi;
    while ((m = reJs.exec(s))) {
      kind = classifyDownloadUrl_(m[1], '');
      if (kind) push(m[1], 'js_' + kind, '');
    }

    // href sueltos a .pdf / panel_*.php aunque no matcheen <a> bien formado
    var reLoose =
      /(?:href|src|data)\s*=\s*["']([^"']+\.pdf[^"']*|[^"']*panel_[a-z0-9_]+\.php[^"']*)["']/gi;
    while ((m = reLoose.exec(s))) {
      kind = classifyDownloadUrl_(m[1], '');
      if (kind) push(m[1], kind, '');
    }

    var pdfLikely = out.some(function (c) {
      return c.kind === 'pdf' || c.kind === 'js_pdf' || /\.pdf(\?|$)/i.test(c.url);
    });
    return { candidates: out, pdfLikely: pdfLikely, empty: false };
  }

  function classifyDownloadUrl_(url, text) {
    var u = String(url || '');
    var t = String(text || '').toLowerCase();
    if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf';
    if (/panel_[a-z0-9_]*descarg/i.test(u) || /descarg/i.test(u)) return 'download_endpoint';
    if (/impresion_jano\.php/i.test(u) || /imprim/i.test(u) || /boleta/i.test(u)) {
      return 'print_endpoint';
    }
    if (/panel_detalle_fact\.php/i.test(u)) return 'detail_panel';
    if (/factura/i.test(u) && /(pdf|descarg|imprim|boleta|download)/i.test(u + ' ' + t)) {
      return 'factura_link';
    }
    if (/(descarg|imprim|boleta|pdf|comprobante)/i.test(t)) return 'labeled_link';
    return null;
  }

  /** Absolute URL for a relative path under /uiextranet/. */
  function resolveEcogasUrl(href) {
    href = String(href || '').trim();
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    if (href.charAt(0) === '/') return 'https://autogestion.ecogas.com.ar' + href;
    return 'https://autogestion.ecogas.com.ar/uiextranet/' + href.replace(/^\.\//, '');
  }

  function buildDetailUrl(params) {
    params = params || {};
    var q = [];
    if (params.d) q.push('d=' + encodeURIComponent(params.d));
    if (params.c) q.push('c=' + encodeURIComponent(params.c));
    if (params.t) q.push('t=' + encodeURIComponent(params.t));
    return DETAIL_BASE + (q.length ? '?' + q.join('&') : '');
  }

  function sessionCookie_() {
    return String(CM.Settings.get(CM.Settings.KEYS.ECOGAS_SESSION_COOKIE, '') || '').trim();
  }

  function sessionHeaders_(extra) {
    var cookie = sessionCookie_();
    var headers = {
      'User-Agent':
        'Mozilla/5.0 (compatible; CasitasManager/1.0; Ecogas session probe)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (cookie) headers.Cookie = cookie;
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        headers[k] = extra[k];
      });
    }
    return headers;
  }

  function looksLikeLoginPage_(body, headers, finalUrl) {
    var loc =
      (headers && (headers.Location || headers.location)) ||
      String(finalUrl || '');
    if (/\/login\b/i.test(loc) || /ingreso\?s=p/i.test(loc)) return true;
    var s = String(body || '');
    if (/form_login_po|id=["']cliente["']|name=["']cliente["']/.test(s) && /recaptcha/i.test(s)) {
      return true;
    }
    return false;
  }

  /**
   * Probe landing con Cookie de Script Properties (sesión humana).
   * Nunca loguea el valor de la cookie. No bypassea captcha.
   */
  function probeSessionLanding() {
    var cookie = sessionCookie_();
    if (!cookie) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Sin ECOGAS_SESSION_COOKIE. Pegá el Cookie header post-login (canal privado) con setEcogasSessionCookie(...). ' +
          'Mientras tanto: menú Importar PDF Ecogas desde Drive.',
        hasCookie: false,
        portal: INDEX,
      };
    }
    var res = CM.ProviderInterface.httpGet(INDEX, {
      headers: sessionHeaders_(),
      followRedirects: false,
    });
    if (!res.ok && res.code !== 302 && res.code !== 301) {
      return {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
        hasCookie: true,
      };
    }
    if (res.code === 302 || res.code === 301 || looksLikeLoginPage_(res.body, res.headers)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Sesión Ecogas inválida/expirada (redirect a login). Renová cookie tras login humano. ' +
          'No bypassear reCAPTCHA. Manual Drive sigue OK.',
        httpCode: res.code,
        hasCookie: true,
        redirectedToLogin: true,
      };
    }
    return {
      ok: true,
      outcome: 'session_ok',
      message: 'Landing index?s=p OK con cookie de sesión (no se loguea la cookie).',
      httpCode: res.code,
      hasCookie: true,
      bodyBytes: res.body ? res.body.length : 0,
    };
  }

  /**
   * GET panel_detalle_fact.php con sesión. Parsea candidatos a PDF/descarga.
   * params: { d, c, t } — t es token de sesión de UI; no commitear.
   */
  function probeInvoiceDetail(params) {
    params = params || {};
    var cookie = sessionCookie_();
    if (!cookie) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Falta ECOGAS_SESSION_COOKIE',
        candidates: [],
      };
    }
    if (!params.d || !params.c || !params.t) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message:
          'Faltan params detalle { d, c, t }. Ejemplo c=20259678. Obtené d/t del Network tras login humano.',
        candidates: [],
      };
    }
    var url = buildDetailUrl(params);
    var res = CM.ProviderInterface.httpGet(url, {
      headers: sessionHeaders_({
        'X-Requested-With': 'XMLHttpRequest',
        Referer: INDEX,
      }),
      followRedirects: true,
    });
    if (!res.ok) {
      return {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
        candidates: [],
      };
    }
    if (looksLikeLoginPage_(res.body, res.headers)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Detalle devolvió login/captcha — sesión vencida',
        httpCode: res.code,
        candidates: [],
      };
    }
    var body = res.body || '';
    if (!String(body).trim()) {
      return {
        ok: false,
        outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
        message:
          'Detalle HTML vacío (sesión inválida o params d/t viejos). Sin URL PDF que parsear.',
        httpCode: res.code,
        candidates: [],
        emptyBody: true,
      };
    }
    var extracted = extractDetailDownloadCandidates(body);
    var resolved = extracted.candidates.map(function (c) {
      return {
        url: resolveEcogasUrl(c.url),
        kind: c.kind,
        text: c.text,
        raw: c.url,
      };
    });
    return {
      ok: resolved.length > 0,
      outcome: resolved.length
        ? extracted.pdfLikely
          ? 'pdf_link_candidates'
          : 'download_link_candidates'
        : O().AVAILABLE_NOT_DOWNLOADABLE,
      message: resolved.length
        ? 'Candidatos a descarga en detalle (probar GET + looksLikePdf). No inventar montos.'
        : 'HTML de detalle sin href/pdf/descarga reconocible — seguir manual Drive o ampliar parser con fixture real.',
      httpCode: res.code,
      bodyBytes: body.length,
      pdfLikely: extracted.pdfLikely,
      candidates: resolved,
    };
  }

  function printPpFromSettings_() {
    return String(CM.Settings.get(CM.Settings.KEYS.ECOGAS_PRINT_PP, '') || '').trim();
  }

  function resolvePrintInput_(service, invoice, input) {
    input = input || {};
    invoice = invoice || {};
    service = service || {};
    var pp =
      input.pp ||
      input.comprobante ||
      invoice.pp ||
      invoice.comprobante ||
      invoice.compoundId ||
      invoice.detailId ||
      invoice.invoiceNumber ||
      printPpFromSettings_() ||
      '';
    var account =
      input.accountNumber ||
      input.account_number ||
      invoice.accountNumber ||
      invoice.account_number ||
      service.account_number ||
      '';
    return Object.assign({}, input, {
      pp: pp,
      accountNumber: account,
      p: input.p || invoice.p,
      d: input.d || invoice.d,
      t: input.t || invoice.printType || invoice.t_print,
      i: input.i || invoice.i,
      logreimp: input.logreimp || invoice.logreimp,
      m: input.m || invoice.m,
      form_pp: input.form_pp || invoice.form_pp,
    });
  }

  /**
   * POST impresion_jano.php. Shared by probe + downloadInvoice.
   * Cookie NO requerida para el PDF si el form está completo (cloud 2026-11-04).
   * Cookie opcional si está en Script Properties (no se loguea).
   */
  function postPrintPdf_(input) {
    var built = buildPrintFormPayload(input);
    if (!built.ok) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: built.message,
        reason: built.reason,
        pdfMagic: false,
      };
    }

    var headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; CasitasManager/1.0; Ecogas print)',
      Accept: 'application/pdf,application/octet-stream,text/html,*/*',
      Referer: INDEX,
      Origin: 'https://autogestion.ecogas.com.ar',
    };
    // Cookie opcional — el endpoint Imprimir responde PDF sin ella cuando pp conocido.
    var cookie = sessionCookie_();
    if (cookie) headers.Cookie = cookie;

    var res = CM.ProviderInterface.httpPost(PRINT_URL, built.payload, {
      contentType: 'application/x-www-form-urlencoded',
      headers: headers,
      followRedirects: true,
    });

    if (!res.ok && !(res.code >= 200 && res.code < 400)) {
      return {
        ok: false,
        outcome: O().PORTAL_INACCESSIBLE,
        message: res.error || 'HTTP ' + res.code,
        httpCode: res.code,
        pdfMagic: false,
        payloadKeys: Object.keys(built.payload),
        usedCookie: !!cookie,
      };
    }
    // Solo tratar como login si NO hay magic PDF (el print a veces setea SID nuevo)
    var pdfMagic = false;
    var size = 0;
    try {
      if (res.blob && typeof res.blob.getBytes === 'function') {
        size = res.blob.getBytes().length;
        pdfMagic = CM.Pdf.looksLikePdf(res.blob.getBytes());
      } else if (res.body) {
        size = String(res.body).length;
        pdfMagic = CM.Pdf.looksLikePdf(String(res.body));
      }
    } catch (e) {
      pdfMagic = false;
    }

    if (!pdfMagic && looksLikeLoginPage_(res.body, res.headers)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message:
          'Imprimir devolvió login HTML (sin PDF). Revisá comprobante/cuenta o Importar PDF Ecogas.',
        httpCode: res.code,
        pdfMagic: false,
        usedCookie: !!cookie,
      };
    }

    var ct = String(res.contentType || '');
    if (pdfMagic) {
      return {
        ok: true,
        outcome: O().DOWNLOADED_OK,
        message:
          'PDF Ecogas Imprimir OK (magic %PDF; sin Cookie requerida si form completo).',
        httpCode: res.code,
        contentType: ct,
        size: size,
        pdfMagic: true,
        blob: res.blob || null,
        printUrl: PRINT_URL,
        payload: built.payload,
        payloadKeys: Object.keys(built.payload),
        usedCookie: !!cookie,
      };
    }

    return {
      ok: false,
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      message:
        'POST Imprimir sin magic %PDF. Revisá comprobante/params o Importar PDF Ecogas. contentType=' +
        ct,
      httpCode: res.code,
      contentType: ct,
      size: size,
      pdfMagic: false,
      printUrl: PRINT_URL,
      payloadKeys: Object.keys(built.payload),
      usedCookie: !!cookie,
    };
  }

  /** Probe/diagnostic — same POST as download; does not write Drive. */
  function probePrintPdf(input) {
    return postPrintPdf_(resolvePrintInput_(null, null, input));
  }

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
        // Listing/descubrimiento de pp NO funciona sin auth (no afirmar lo contrario).
        fetchInvoices: false,
        // Download sí: POST Imprimir sin Cookie si pp conocido.
        downloadInvoice: !!printPpFromSettings_(),
        // Metadata se parsea del PDF Imprimir (Tj/TJ), no del listing.
        extractInvoiceMetadata: true,
        getOutstandingDebt: false,
        manualDriveImport: true,
        printWithoutCookie: true,
      },
    });
  }

  function fetchInvoices(service, options) {
    options = options || {};
    var pp =
      (options && (options.pp || options.comprobante || options.compoundId)) ||
      printPpFromSettings_() ||
      '';

    // Con pp: no hace falta portal/login para armar el target de Imprimir.
    if (pp) {
      var period =
        (options && options.billingPeriod) || CM.Dates.currentBillingPeriod();
      var parsed = parseCompoundInvoiceId(pp);
      var inv = {
        provider: ID,
        accountNumber: service && service.account_number,
        billingPeriod: period,
        invoiceNumber: pp,
        pp: pp,
        p: parsed && parsed.p,
        d: parsed && parsed.d,
        // amount/fechas se completan al descargar el PDF (parse Tj/TJ); no inventar acá.
        amount: null,
        issueDate: '',
        dueDate: '',
        currency: 'ARS',
        payment_status: 'unknown',
        autoDownload: true,
        ecogasPrint: true,
        notes: 'ecogas_print_pp',
      };
      return {
        outcome: 'print_pp_ready',
        invoices: [inv],
        message:
          'Comprobante conocido → POST Imprimir sin Cookie; monto/fechas se leen del PDF (sin inventar; listing portal no usado).',
        account: service && service.account_number,
        printPath: PRINT_PATH,
        manualImport: false,
        listingRequiresAuth: true,
        usedListing: false,
      };
    }

    // Sin pp: no hay listing anónimo.
    var avail = checkAvailability(service);
    if (avail.outcome === O().PORTAL_INACCESSIBLE || avail.outcome === O().PORTAL_STRUCTURE_CHANGED) {
      return {
        outcome: avail.outcome,
        invoices: [],
        message: avail.message,
        manualImport: true,
        listingRequiresAuth: true,
      };
    }
    return {
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      invoices: [],
      message:
        'Ecogas: sin número de comprobante no se listan facturas (login/reCAPTCHA; no bypassear). ' +
        'Opciones: menú «Descargar Ecogas por comprobante…», setEcogasPrintPp(…), ' +
        'o «Importar PDF Ecogas desde Drive». Con comprobante, Imprimir NO requiere Cookie.',
      account: service && service.account_number,
      portal: PORTAL,
      index: INDEX,
      detailPath: DETAIL_PATH,
      printPath: PRINT_PATH,
      formAction: 'logon?s=p&c=0',
      manualImport: true,
      listingRequiresAuth: true,
    };
  }

  /**
   * Parse amount / issue / due from Ecogas factura text (PDF-extracted or OCR).
   * Prefer "IMPORTE" / "TOTAL A PAGAR" / "Total a pagar hasta el … $X".
   * Never uses "TOTAL FACTURA" (pre–nota de crédito). No inventa valores.
   *
   * @returns {{amount:number|null, issueDate:string, dueDate:string, currency:string, source:string}}
   */
  function parseInvoiceMetadataFromText(text) {
    var empty = {
      amount: null,
      issueDate: '',
      dueDate: '',
      currency: 'ARS',
      source: 'ecogas_pdf_text',
    };
    if (text == null || String(text).trim() === '') return empty;
    var t = String(text).replace(/\u00a0/g, ' ');

    var amount = null;
    var amountSource = '';
    var m;

    // 1) IMPORTE $ 336.56 (pie de boleta — monto a pagar)
    m = t.match(/\bIMPORTE\s*\$?\s*([\d.]+,?\d*|\d+,\d{2}|\d+\.\d{2})\b/i);
    if (m) {
      amount = CM.Invoices.normalizeAmount(m[1]);
      if (amount != null) amountSource = 'importe';
    }

    // 2) TOTAL A PAGAR … $ 336.56 (no TOTAL FACTURA)
    if (amount == null) {
      m = t.match(
        /TOTAL\s+A\s+PAGAR(?!\s*:)[\s\S]{0,80}?\$\s*([\d.]+,?\d*|\d+,\d{2}|\d+\.\d{2})\b/i
      );
      if (m) {
        amount = CM.Invoices.normalizeAmount(m[1]);
        if (amount != null) amountSource = 'total_a_pagar';
      }
    }

    // 3) Total a pagar hasta el DD/MM/YYYY $ X
    var dueFromTotal = '';
    m = t.match(
      /Total\s+a\s+pagar\s+hasta\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,60}?\$\s*([\d.]+,?\d*|\d+,\d{2}|\d+\.\d{2})\b/i
    );
    if (m) {
      dueFromTotal = m[1];
      if (amount == null) {
        amount = CM.Invoices.normalizeAmount(m[2]);
        if (amount != null) amountSource = 'total_hasta';
      }
    } else {
      m = t.match(/Total\s+a\s+pagar\s+hasta\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) dueFromTotal = m[1];
    }

    var issueDate = '';
    m = t.match(/Fecha\s+de\s+emisi[oó]n\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (m) issueDate = m[1];

    var dueDate = dueFromTotal;
    // Do not use "C.E.S.P … Fecha de vto." as invoice due (different concept).

    return {
      amount: amount,
      issueDate: issueDate,
      dueDate: dueDate,
      currency: 'ARS',
      source: amountSource
        ? 'ecogas_pdf_text:' + amountSource
        : 'ecogas_pdf_text',
      rawMatched: !!(amount != null || issueDate || dueDate),
    };
  }

  /**
   * Extract printable Tj/TJ text from PDF bytes/blob, then parse metadata.
   */
  function extractInvoiceMetadataFromPdf(bytesOrBlob) {
    var bytes = bytesOrBlob;
    if (bytesOrBlob && typeof bytesOrBlob.getBytes === 'function') {
      try {
        bytes = bytesOrBlob.getBytes();
      } catch (e) {
        bytes = null;
      }
    }
    var text = CM.Pdf && CM.Pdf.extractEmbeddedText ? CM.Pdf.extractEmbeddedText(bytes) : '';
    var meta = parseInvoiceMetadataFromText(text);
    meta.pdfTextLength = text ? text.length : 0;
    meta.outcome =
      meta.amount != null || meta.issueDate || meta.dueDate
        ? O().DOWNLOADED_OK
        : O().NOT_IMPLEMENTED;
    return meta;
  }

  /**
   * Descarga PDF vía POST Imprimir. Cookie no requerida si pp/form completo.
   * Tras PDF OK, intenta parsear amount / fechas del contenido embebido (sin inventar).
   */
  function downloadInvoice(service, invoice) {
    var input = resolvePrintInput_(service, invoice, {});
    var result = postPrintPdf_(input);
    if (!result.ok) return result;

    var meta = { amount: null, issueDate: '', dueDate: '', currency: 'ARS' };
    try {
      if (result.blob) meta = extractInvoiceMetadataFromPdf(result.blob);
    } catch (e) {
      meta = {
        amount: null,
        issueDate: '',
        dueDate: '',
        currency: 'ARS',
        parseError: String(e),
      };
    }

    return {
      ok: true,
      outcome: O().DOWNLOADED_OK,
      message: result.message,
      httpCode: result.httpCode,
      contentType: result.contentType,
      size: result.size,
      blob: result.blob,
      pdfMagic: true,
      pp: input.pp,
      usedCookie: !!result.usedCookie,
      // Campos planos para persistProviderFetch + metadata object
      amount: meta.amount,
      issueDate: meta.issueDate || '',
      dueDate: meta.dueDate || '',
      currency: meta.currency || 'ARS',
      metadata: meta,
      metadataSource: meta.source || 'ecogas_pdf_text',
    };
  }

  function extractInvoiceMetadata(service, invoiceOrBlob) {
    if (invoiceOrBlob && (invoiceOrBlob.getBytes || typeof invoiceOrBlob === 'string' || invoiceOrBlob.length)) {
      var meta = extractInvoiceMetadataFromPdf(invoiceOrBlob);
      return { outcome: meta.outcome, metadata: meta };
    }
    return {
      outcome: O().NOT_IMPLEMENTED,
      metadata: null,
      message:
        'Pasá el blob/bytes del PDF Ecogas (post-Imprimir) para parsear amount/fechas.',
    };
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
    index: INDEX,
    detailPath: DETAIL_PATH,
    printPath: PRINT_PATH,
    printUrl: PRINT_URL,
    checkAvailability: checkAvailability,
    fetchInvoices: fetchInvoices,
    downloadInvoice: downloadInvoice,
    extractInvoiceMetadata: extractInvoiceMetadata,
    getOutstandingDebt: getOutstandingDebt,
    getProviderStatus: getProviderStatus,
    extractDetailDownloadCandidates: extractDetailDownloadCandidates,
    resolveEcogasUrl: resolveEcogasUrl,
    buildDetailUrl: buildDetailUrl,
    padAccountNumber: padAccountNumber,
    parseCompoundInvoiceId: parseCompoundInvoiceId,
    buildPrintFormPayload: buildPrintFormPayload,
    parseInvoiceMetadataFromText: parseInvoiceMetadataFromText,
    extractInvoiceMetadataFromPdf: extractInvoiceMetadataFromPdf,
    probeSessionLanding: probeSessionLanding,
    probeInvoiceDetail: probeInvoiceDetail,
    probePrintPdf: probePrintPdf,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Ecogas;
}
