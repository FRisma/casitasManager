/**
 * Municipalidad de Rivadavia — impuestos municipales (boleta mensual).
 *
 * Portal (HTTP, no HTTPS): http://181.209.107.110:83/deudavencida/deuda_total.aspx
 * Nomenclatura Natania XV: 322047490000 (txtIndice, máx 12 tras postback Inmueble).
 *
 * Flujo ASP.NET verificado (sin CAPTCHA):
 * 1. GET → __VIEWSTATE / __VIEWSTATEGENERATOR / __EVENTVALIDATION (+ cookie si aparece)
 * 2. POST __EVENTTARGET=rbTipoInm (obligatorio: sin esto txtIndice queda máx 8 y BUSCAR falla)
 * 3. POST btnBuscar=BUSCAR (tipo=rbTipoInm, txtIndice, txtFecha=DD/MM/YYYY, rivadavia=rbMensual)
 * 4. POST boleta: btnBoleta.x / btnBoleta.y + gvSeleccion$ctlNN$Procesar=on → PDF
 *
 * Limitaciones: HTTP claro; VIEWSTATE frágil si el portal cambia markup; no inventar catastro;
 * no bypassear CAPTCHA si aparece. Cookie de sesión se reenvía entre pasos.
 */

var CM = CM || {};
CM.Providers = CM.Providers || {};

CM.Providers.Municipalidad = (function () {
  var ID = 'municipalidad';
  var PORTAL = 'http://181.209.107.110:83/deudavencida/deuda_total.aspx';
  var USER_AGENT = 'CasitasManager/1.0 (Google Apps Script)';

  function O() {
    return CM.ProviderInterface.OUTCOME;
  }

  function cadastralNumber_(service) {
    return String((service && service.cadastral_number) || '')
      .trim()
      .replace(/\s+/g, '');
  }

  function hasCadastral_(service) {
    return !!cadastralNumber_(service);
  }

  function isEnabled_(service) {
    if (!service) return false;
    return (
      service.enabled === true ||
      String(service.enabled).toLowerCase() === 'true' ||
      String(service.enabled) === 'TRUE'
    );
  }

  /**
   * Solo Rivadavia (portal deudavencida conocido) tiene adapter ASP.NET.
   * Otros municipios (ej. Caucete) → unsupported_municipio (sin fake download).
   */
  function unsupportedMunicipioStatus_(service) {
    if (!CM.Properties || !CM.Properties.isMunicipalidadSupported) return null;
    if (CM.Properties.isMunicipalidadSupported(service)) return null;
    var info =
      CM.Properties.municipioFromService && CM.Properties.municipioFromService(service);
    var label = (info && info.label) || 'desconocido';
    return CM.ProviderInterface.baseStatus(ID, {
      ok: false,
      outcome: O().UNSUPPORTED_MUNICIPIO,
      message:
        'Municipalidad ' +
        label +
        ': sin adapter auto. Completar portal_url tras discovery o Importar PDF manual. ' +
        'No usar el portal Rivadavia para otro municipio.',
      municipio: label,
      manualImport: true,
      capabilities: {
        checkAvailability: true,
        fetchInvoices: false,
        downloadInvoice: false,
      },
    });
  }

  /** Fecha de consulta portal: DD/MM/YYYY (Argentina). */
  function todayDMY_(override) {
    if (override) return String(override);
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(new Date(), CM.Dates.TZ, 'dd/MM/yyyy');
    }
    var iso = CM.Dates.todayISO();
    var p = String(iso).split('-');
    if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
    return '';
  }

  function extractHidden_(html, name) {
    var s = String(html || '');
    var patterns = [
      new RegExp('id="' + name + '"[^>]*value="([^"]*)"', 'i'),
      new RegExp('name="' + name + '"[^>]*value="([^"]*)"', 'i'),
      new RegExp('value="([^"]*)"[^>]*(?:name|id)="' + name + '"', 'i'),
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i]);
      if (m) return m[1];
    }
    return '';
  }

  function extractAspNetFields_(html) {
    return {
      __VIEWSTATE: extractHidden_(html, '__VIEWSTATE'),
      __VIEWSTATEGENERATOR: extractHidden_(html, '__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: extractHidden_(html, '__EVENTVALIDATION'),
    };
  }

  function hasAspNetForm_(html) {
    var s = String(html || '');
    return /__VIEWSTATE/i.test(s) && /txtIndice/i.test(s) && /btnBuscar/i.test(s);
  }

  /**
   * Une cookies Set-Cookie de headers UrlFetch con un jar string "k=v; k2=v2".
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

  function requestHeaders_(cookieJar) {
    var h = {
      'User-Agent': USER_AGENT,
      Referer: PORTAL,
    };
    if (cookieJar) h.Cookie = cookieJar;
    return h;
  }

  /**
   * GET/POST al portal. Actualiza cookie jar. No hardcodea VIEWSTATE.
   */
  function portalRequest_(method, payload, cookieJar) {
    var res;
    if (method === 'get') {
      res = CM.ProviderInterface.httpGet(PORTAL, {
        headers: requestHeaders_(cookieJar),
        followRedirects: true,
        validateHttpsCertificates: false,
      });
    } else {
      res = CM.ProviderInterface.httpPost(PORTAL, payload, {
        contentType: 'application/x-www-form-urlencoded',
        headers: requestHeaders_(cookieJar),
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
      fields: extractAspNetFields_(res.body || ''),
    };
  }

  function baseForm_(fields, cadastral, fecha, extras) {
    var f = fields || {};
    var payload = {
      __VIEWSTATE: f.__VIEWSTATE || '',
      __VIEWSTATEGENERATOR: f.__VIEWSTATEGENERATOR || '',
      __EVENTVALIDATION: f.__EVENTVALIDATION || '',
      tipo: 'rbTipoInm',
      txtIndice: cadastral || '',
      txtFecha: fecha || '',
      rivadavia: 'rbMensual',
    };
    extras = extras || {};
    Object.keys(extras).forEach(function (k) {
      payload[k] = extras[k];
    });
    return payload;
  }

  function parseArAmount_(raw) {
    if (raw == null || raw === '') return null;
    var s = String(raw).trim().replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /**
   * Parsea filas de #gvSeleccion.
   * Columnas: Seleccione | Año | Cuota | Cuota_mes | Importe | Descuentos | Planes | Intereses | ImpTotal | Vencimiento
   */
  function parseDebtGrid_(html, service) {
    var s = String(html || '');
    var rows = [];
    // Cada checkbox Procesar + celdas siguientes
    var re = /name="(gvSeleccion\$ctl\d+\$Procesar)"[\s\S]*?<\/td>\s*<td>(\d{4})<\/td>\s*<td>(\d{1,2})<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/gi;
    var m;
    while ((m = re.exec(s))) {
      var year = m[2];
      var cuota = m[3];
      var mesNombre = String(m[4] || '').trim();
      var importe = parseArAmount_(m[5]);
      var descuentos = parseArAmount_(m[6]);
      var planes = parseArAmount_(m[7]);
      var intereses = parseArAmount_(m[8]);
      var impTotal = parseArAmount_(m[9]);
      var vto = String(m[10] || '').trim();
      var period = CM.Dates.normalizeBillingPeriod(year + '-' + cuota);
      if (!period) period = CM.Dates.normalizeBillingPeriod(mesNombre + ' ' + year);
      rows.push({
        provider: ID,
        service_id: (service && service.service_id) || '',
        accountNumber: cadastralNumber_(service),
        invoiceNumber: year + '-' + CM.Dates.pad2(parseInt(cuota, 10)),
        billingPeriod: period,
        amount: impTotal != null ? impTotal : importe,
        currency: 'ARS',
        issueDate: '',
        dueDate: CM.Dates.parseDateToISO(vto) || vto,
        invoice_status: 'detected',
        payment_status: 'unknown',
        notes:
          'municipalidad_aspnet|importe=' +
          (importe != null ? importe : '') +
          '|descuento=' +
          (descuentos != null ? descuentos : '') +
          '|impTotal=' +
          (impTotal != null ? impTotal : '') +
          '|mes=' +
          mesNombre,
        // claves download
        autoDownload: true,
        checkboxName: m[1],
        cadastral: cadastralNumber_(service),
        cuota: cuota,
        mesNombre: mesNombre,
        importe: importe,
        descuentos: descuentos,
        planes: planes,
        intereses: intereses,
        impTotal: impTotal,
      });
    }
    return rows;
  }

  function detectCheckboxNames_(html) {
    var names = [];
    var re = /name="(gvSeleccion\$ctl\d+\$Procesar)"/gi;
    var m;
    while ((m = re.exec(String(html || '')))) {
      if (names.indexOf(m[1]) < 0) names.push(m[1]);
    }
    return names;
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
   * Sesión hasta grilla de deuda (pasos 1–3).
   * @returns {{ok, outcome, message, cookieJar, fields, html, invoices, httpCode}}
   */
  function openDebtSession_(service, options) {
    options = options || {};
    var cadastral = cadastralNumber_(service);
    var fecha = todayDMY_(options.fecha);

    if (!isEnabled_(service)) {
      return {
        ok: false,
        outcome: O().DISABLED,
        message: 'Municipalidad enabled=false',
        invoices: [],
      };
    }
    var unsupported = unsupportedMunicipioStatus_(service);
    if (unsupported) {
      return {
        ok: false,
        outcome: O().UNSUPPORTED_MUNICIPIO,
        message: unsupported.message,
        municipio: unsupported.municipio,
        invoices: [],
        manualImport: true,
      };
    }
    if (!cadastral) {
      return {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta cadastral_number — no inventar',
        invoices: [],
      };
    }

    // 1) GET
    var getRes = portalRequest_('get', null, '');
    if (!getRes.ok) {
      return {
        ok: false,
        outcome: getRes.outcome || O().PORTAL_INACCESSIBLE,
        message: getRes.error || 'HTTP ' + getRes.code + ' en GET deuda_total.aspx',
        httpCode: getRes.code,
        invoices: [],
        manualImport: true,
      };
    }
    if (CM.ProviderInterface.detectCaptcha(getRes.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA en portal municipal (no se bypasea)',
        httpCode: getRes.code,
        invoices: [],
      };
    }
    if (!hasAspNetForm_(getRes.body) || !getRes.fields.__VIEWSTATE) {
      return {
        ok: false,
        outcome: O().PORTAL_STRUCTURE_CHANGED,
        message: 'GET sin formulario ASP.NET / VIEWSTATE',
        httpCode: getRes.code,
        invoices: [],
      };
    }

    var jar = getRes.cookieJar;
    var fields = getRes.fields;

    // 2) POST rbTipoInm (crítico)
    var tipoPayload = baseForm_(fields, '', fecha, {
      __EVENTTARGET: 'rbTipoInm',
      __EVENTARGUMENT: '',
    });
    var tipoRes = portalRequest_('post', tipoPayload, jar);
    if (!tipoRes.ok) {
      return {
        ok: false,
        outcome: tipoRes.outcome || O().PORTAL_INACCESSIBLE,
        message: tipoRes.error || 'HTTP ' + tipoRes.code + ' en postback rbTipoInm',
        httpCode: tipoRes.code,
        invoices: [],
        manualImport: true,
      };
    }
    jar = tipoRes.cookieJar;
    fields = tipoRes.fields.__VIEWSTATE ? tipoRes.fields : fields;

    // 3) BUSCAR
    var searchPayload = baseForm_(fields, cadastral, fecha, { btnBuscar: 'BUSCAR' });
    var searchRes = portalRequest_('post', searchPayload, jar);
    if (!searchRes.ok) {
      return {
        ok: false,
        outcome: searchRes.outcome || O().PORTAL_INACCESSIBLE,
        message: searchRes.error || 'HTTP ' + searchRes.code + ' en btnBuscar',
        httpCode: searchRes.code,
        invoices: [],
        manualImport: true,
      };
    }
    jar = searchRes.cookieJar;
    fields = searchRes.fields.__VIEWSTATE ? searchRes.fields : fields;

    if (CM.ProviderInterface.detectCaptcha(searchRes.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA tras BUSCAR (no se bypassea)',
        httpCode: searchRes.code,
        invoices: [],
      };
    }

    var nomenclaturaHint = /Ingrese la Nomenclatura/i.test(searchRes.body || '');
    var invoices = parseDebtGrid_(searchRes.body, service);
    var checkboxes = detectCheckboxNames_(searchRes.body);

    if (!invoices.length) {
      if (nomenclaturaHint || (!/gvSeleccion/i.test(searchRes.body) && !checkboxes.length)) {
        return {
          ok: false,
          outcome: O().PORTAL_STRUCTURE_CHANGED,
          message:
            nomenclaturaHint
              ? 'BUSCAR rechazó nomenclatura (¿faltó postback rbTipoInm o catastro inválido?)'
              : 'BUSCAR OK HTTP pero sin grilla gvSeleccion — markup cambió o sin deuda visible',
          httpCode: searchRes.code,
          htmlLength: (searchRes.body || '').length,
          invoices: [],
          cookieJar: jar,
          fields: fields,
          html: searchRes.body,
        };
      }
      return {
        ok: true,
        outcome: O().INVOICE_NOT_AVAILABLE_YET,
        message: 'Portal OK; grilla sin filas de deuda para ' + cadastral,
        httpCode: searchRes.code,
        invoices: [],
        cookieJar: jar,
        fields: fields,
        html: searchRes.body,
      };
    }

    return {
      ok: true,
      outcome: 'listed_ok',
      message: 'Municipalidad listó ' + invoices.length + ' cuota(s)',
      httpCode: searchRes.code,
      invoices: invoices,
      cookieJar: jar,
      fields: fields,
      html: searchRes.body,
      fecha: fecha,
      cadastral: cadastral,
    };
  }

  function postBoleta_(session, checkboxName) {
    var extras = {
      'btnBoleta.x': '40',
      'btnBoleta.y': '40',
    };
    extras[checkboxName] = 'on';
    var payload = baseForm_(session.fields, session.cadastral, session.fecha, extras);
    return portalRequest_('post', payload, session.cookieJar);
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
    var unsupported = unsupportedMunicipioStatus_(service);
    if (unsupported) return unsupported;
    if (!hasCadastral_(service)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().MISSING_PROPERTY_INFO,
        message: 'Falta cadastral_number — no inventar. Completar en hoja Services.',
        capabilities: { checkAvailability: true },
      });
    }

    var getRes = portalRequest_('get', null, '');
    if (!getRes.ok) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: getRes.outcome || O().PORTAL_INACCESSIBLE,
        message: getRes.error || 'HTTP ' + getRes.code,
        httpCode: getRes.code,
        portal: PORTAL,
        manualImport: true,
        capabilities: { checkAvailability: true },
      });
    }
    if (CM.ProviderInterface.detectCaptcha(getRes.body)) {
      return CM.ProviderInterface.baseStatus(ID, {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA en portal (no se bypassea)',
        httpCode: getRes.code,
        captcha: true,
        capabilities: { checkAvailability: true },
      });
    }
    var hasForm = hasAspNetForm_(getRes.body);
    return CM.ProviderInterface.baseStatus(ID, {
      ok: hasForm,
      outcome: hasForm ? 'portal_reachable' : O().PORTAL_STRUCTURE_CHANGED,
      message: hasForm
        ? 'Formulario ASP.NET OK; fetch/download vía rbTipoInm → BUSCAR → boleta PDF'
        : 'HTML sin campos ASP.NET esperados',
      httpCode: getRes.code,
      portal: PORTAL,
      cadastral: cadastralNumber_(service),
      transport: 'http',
      limitations: 'http_not_https; viewstate_fragile; requires_rbTipoInm_postback',
      capabilities: {
        checkAvailability: true,
        fetchInvoices: hasForm,
        downloadInvoice: hasForm,
        extractInvoiceMetadata: hasForm,
        getOutstandingDebt: false,
      },
    });
  }

  function fetchInvoices(service, options) {
    options = options || {};
    var session = openDebtSession_(service, options);
    if (!session.ok) {
      return {
        outcome: session.outcome || O().ERROR,
        invoices: [],
        message: session.message,
        httpCode: session.httpCode,
        manualImport: !!session.manualImport,
      };
    }

    var mapped = (session.invoices || []).slice();
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
          ? 'Portal OK; sin cuotas para período ' + options.billingPeriod
          : session.message || 'Sin filas',
        httpCode: session.httpCode,
        totalFromGrid: (session.invoices || []).length,
      };
    }

    return {
      outcome: 'listed_ok',
      invoices: mapped,
      message: 'Municipalidad listó ' + mapped.length + ' cuota(s)',
      httpCode: session.httpCode,
      totalFromGrid: (session.invoices || []).length,
      // sesión no se serializa a Sheets; downloadInvoice reabre sesión
    };
  }

  /**
   * Reabre sesión (GET→tipo→BUSCAR) y POST boleta para la fila indicada.
   */
  function downloadInvoice(serviceOrInvoice, invoiceMeta) {
    var meta = invoiceMeta || serviceOrInvoice || {};
    var service = invoiceMeta ? serviceOrInvoice : null;
    if (!service && meta && meta.cadastral) {
      service = {
        enabled: true,
        cadastral_number: meta.cadastral,
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

    var session = openDebtSession_(service, {
      fecha: meta.fecha,
    });
    if (!session.ok) {
      return {
        ok: false,
        outcome: session.outcome || O().ERROR,
        message: session.message,
        httpCode: session.httpCode,
      };
    }

    var checkbox =
      meta.checkboxName ||
      (session.invoices[0] && session.invoices[0].checkboxName) ||
      '';
    if (meta.billingPeriod) {
      var want = CM.Dates.normalizeBillingPeriod(meta.billingPeriod);
      for (var i = 0; i < session.invoices.length; i++) {
        if (session.invoices[i].billingPeriod === want) {
          checkbox = session.invoices[i].checkboxName;
          break;
        }
      }
    }
    if (!checkbox) {
      var detected = detectCheckboxNames_(session.html);
      checkbox = detected[0] || 'gvSeleccion$ctl02$Procesar';
    }

    var boleta = postBoleta_(session, checkbox);
    if (!boleta.ok) {
      return {
        ok: false,
        outcome: boleta.outcome || O().PORTAL_INACCESSIBLE,
        message: boleta.error || 'HTTP ' + boleta.code + ' en btnBoleta',
        httpCode: boleta.code,
      };
    }

    if (looksLikePdfResponse_(boleta)) {
      if (!boleta.blob) {
        return {
          ok: false,
          outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
          message: 'Boleta PDF detectada pero sin blob UrlFetch para Drive',
          httpCode: boleta.code,
          contentType: boleta.contentType,
        };
      }
      var magicOk = false;
      try {
        magicOk = CM.Pdf.looksLikePdf(boleta.blob.getBytes());
      } catch (e) {
        magicOk = String(boleta.body || '').indexOf('%PDF') === 0;
      }
      if (!magicOk) {
        return {
          ok: false,
          outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
          message: 'Respuesta boleta no tiene magic %PDF',
          httpCode: boleta.code,
          contentType: boleta.contentType,
        };
      }
      return {
        ok: true,
        outcome: O().DOWNLOADED_OK,
        message: 'PDF Municipalidad OK',
        blob: boleta.blob,
        contentType: boleta.contentType || 'application/pdf',
        httpCode: boleta.code,
        checkboxName: checkbox,
        invoiceNumber: meta.invoiceNumber || meta.invoice_number || '',
        billingPeriod: meta.billingPeriod || meta.billing_period || '',
      };
    }

    // Honest: HTML u otra cosa
    if (CM.ProviderInterface.detectCaptcha(boleta.body)) {
      return {
        ok: false,
        outcome: O().AUTH_OR_CAPTCHA_REQUIRED,
        message: 'CAPTCHA/HTML en lugar de PDF boleta (no se bypasea)',
        httpCode: boleta.code,
      };
    }

    var lbl = '';
    var lm = String(boleta.body || '').match(/id="lblMensaje"[^>]*>([\s\S]*?)<\/span>/i);
    if (lm) lbl = String(lm[1] || '').replace(/<[^>]+>/g, '').trim();

    return {
      ok: false,
      outcome: O().AVAILABLE_NOT_DOWNLOADABLE,
      message:
        'Boleta no devolvió PDF (content-type=' +
        (boleta.contentType || '') +
        ', len=' +
        String(boleta.body || '').length +
        ')' +
        (lbl ? ' — ' + lbl.slice(0, 180) : ''),
      httpCode: boleta.code,
      contentType: boleta.contentType,
      htmlLength: String(boleta.body || '').length,
      checkboxName: checkbox,
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
      note: 'No inferir pago por ausencia de deuda en grilla',
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
    // helpers tests / orquestación
    extractAspNetFields_: extractAspNetFields_,
    parseDebtGrid_: parseDebtGrid_,
    detectCheckboxNames_: detectCheckboxNames_,
    mergeCookieJar_: mergeCookieJar_,
    todayDMY_: todayDMY_,
    cadastralNumber_: cadastralNumber_,
    hasAspNetForm_: hasAspNetForm_,
  };

  if (CM.ProviderInterface && CM.ProviderInterface.register) {
    CM.ProviderInterface.register(ID, adapter);
  }
  return adapter;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Providers.Municipalidad;
}
