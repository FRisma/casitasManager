/**
 * Ecogas (gas) — prioridad #1.
 *
 * Hallazgos (2026-11-04, sonda HTTP + curls post-login de Franco):
 * - Portal login: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  → 200 HTML
 * - Form POST action=logon?s=p&c=0 id=form_login_po + Google reCAPTCHA
 *   → UrlFetchApp NO puede completar login. NO bypassear captcha.
 * - Post-login (sesión humana):
 *   GET /uiextranet/index?s=p  (Cookie SID + jar F5/TS) → landing
 *   GET /uiextranet/res/panel_detalle_fact.php?d=…&c=20259678&t=… (XHR)
 *     → HTML detalle de factura (cuenta seed 20259678). Aún sin URL PDF
 *     explícita en lo capturado; hay que buscar link/descarga en ese HTML.
 * - SID solo (sin jar completo / sesión expirada) → 302 ./login?e=1&
 * - Detalle sin sesión válida → 200 body vacío (whitespace).
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

  function O() {
    return CM.ProviderInterface.OUTCOME;
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
    if (/imprim/i.test(u) || /boleta/i.test(u)) return 'print_endpoint';
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
        'Semi-auto opcional: setEcogasSessionCookie + probeEcogasSession / probeEcogasInvoiceDetail (sin bypass captcha).',
      account: service && service.account_number,
      portal: PORTAL,
      index: INDEX,
      detailPath: DETAIL_PATH,
      formAction: 'logon?s=p&c=0',
      manualImport: true,
    };
  }

  function downloadInvoice() {
    return {
      ok: false,
      outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
      message:
        'Download auto no disponible (reCAPTCHA login). Manual Drive, o sesión Cookie + probe detalle PDF.',
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
    checkAvailability: checkAvailability,
    fetchInvoices: fetchInvoices,
    downloadInvoice: downloadInvoice,
    extractInvoiceMetadata: extractInvoiceMetadata,
    getOutstandingDebt: getOutstandingDebt,
    getProviderStatus: getProviderStatus,
    extractDetailDownloadCandidates: extractDetailDownloadCandidates,
    resolveEcogasUrl: resolveEcogasUrl,
    buildDetailUrl: buildDetailUrl,
    probeSessionLanding: probeSessionLanding,
    probeInvoiceDetail: probeInvoiceDetail,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Ecogas;
}
