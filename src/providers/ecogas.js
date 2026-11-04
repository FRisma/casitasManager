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
 * - PDF response **no confirmado** aún (esperar probe fetch de Franco). No claim OK.
 * - SID solo / jar incompleto → 302 ./login?e=1&; detalle sin sesión → body vacío.
 *
 * Camino MVP: menú Importar PDF Ecogas desde Drive / importManual*.
 * Semi-auto opcional: Script Property ECOGAS_SESSION_COOKIE (nunca en repo/logs).
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
    var pp = String(input.pp || input.detailId || input.compoundId || '').trim();
    if (!pp && input.p && input.d) {
      // permitir p+d sueltos sin reconstruir pp
      pp = String(input.pp || '').trim();
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
          'Faltan p/d (o pp compuesto tipo 0401B60797913A). Ver form Imprimir / Network.',
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
      // sin pp no inventamos el letter/suffix
      return {
        ok: false,
        reason: 'missing_pp',
        message: 'Falta pp (compound id, ej. 0401B60797913A).',
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

  /**
   * POST impresion_jano.php con Cookie de sesión + form Imprimir.
   * No bypassea captcha. No persiste a Drive todavía.
   * PDF **no confirmado** hasta que Franco valide el fetch — aunque haya magic %PDF,
   * el outcome es pdf_magic_seen (probe), no downloaded_ok de menú.
   *
   * @param {object} input  ver buildPrintFormPayload (pp + accountNumber, o campos sueltos)
   */
  function probePrintPdf(input) {
    var cookie = sessionCookie_();
    if (!cookie) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Falta ECOGAS_SESSION_COOKIE. Manual Drive sigue siendo el camino primario.',
        pdfMagic: false,
      };
    }
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

    var res = CM.ProviderInterface.httpPost(PRINT_URL, built.payload, {
      contentType: 'application/x-www-form-urlencoded',
      headers: sessionHeaders_({
        Referer: INDEX,
        Origin: 'https://autogestion.ecogas.com.ar',
        Accept: 'application/pdf,application/octet-stream,text/html,*/*',
      }),
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
      };
    }
    if (looksLikeLoginPage_(res.body, res.headers)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'Imprimir devolvió login — sesión vencida. Renová cookie; no bypass captcha.',
        httpCode: res.code,
        pdfMagic: false,
      };
    }

    var pdfMagic = false;
    var size = 0;
    try {
      if (res.blob && typeof res.blob.getBytes === 'function') {
        var bytes = res.blob.getBytes();
        size = bytes.length;
        pdfMagic = CM.Pdf.looksLikePdf(bytes);
      } else if (res.body) {
        size = String(res.body).length;
        pdfMagic = CM.Pdf.looksLikePdf(String(res.body));
      }
    } catch (e) {
      pdfMagic = false;
    }

    var ct = String(res.contentType || '');
    if (pdfMagic) {
      return {
        ok: true,
        outcome: 'pdf_magic_seen',
        message:
          'Respuesta POST Imprimir tiene magic %PDF (probe). ' +
          'NO cablear auto-download de menú hasta que Franco confirme el fetch. ' +
          'Mientras tanto: Importar PDF Ecogas desde Drive.',
        httpCode: res.code,
        contentType: ct,
        size: size,
        pdfMagic: true,
        confirmedByFranco: false,
        printUrl: PRINT_URL,
        payloadKeys: Object.keys(built.payload),
      };
    }

    return {
      ok: false,
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      message:
        'POST Imprimir OK-ish pero sin magic %PDF (¿HTML error, sesión, o params?). ' +
        'Esperar probe de Franco. Manual Drive primario. contentType=' +
        ct,
      httpCode: res.code,
      contentType: ct,
      size: size,
      pdfMagic: false,
      confirmedByFranco: false,
      printUrl: PRINT_URL,
      payloadKeys: Object.keys(built.payload),
    };
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
        'Usar menú «Importar PDF Ecogas desde Drive» o importManualInvoiceFromDrive. ' +
        'Semi-auto opcional: setEcogasSessionCookie + probeEcogasSession / ' +
        'probeEcogasPrintPdf({pp, accountNumber}) → impresion_jano.php (sin bypass captcha; PDF no confirmado).',
      account: service && service.account_number,
      portal: PORTAL,
      index: INDEX,
      detailPath: DETAIL_PATH,
      printPath: PRINT_PATH,
      formAction: 'logon?s=p&c=0',
      manualImport: true,
    };
  }

  function downloadInvoice() {
    return {
      ok: false,
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      message:
        'Download auto no cableado (reCAPTCHA login; PDF Imprimir aún no confirmado por Franco). ' +
        'Manual Drive, o probeEcogasPrintPdf con Cookie.',
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
