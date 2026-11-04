/**
 * Modelo de facturas + deduplicación.
 * Nunca inventa montos, fechas ni estados de pago.
 */

var CM = CM || {};
CM.Invoices = (function () {
  var VALID_INVOICE_STATUS = {
    detected: 1,
    downloaded: 1,
    metadata_only: 1,
    unavailable: 1,
    error: 1,
  };
  var VALID_PAYMENT_STATUS = { pending: 1, paid: 1, unknown: 1 };

  function normalizeAmount(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && !isNaN(raw)) return raw;
    var s = String(raw).trim().replace(/\s/g, '').replace(/\$/g, '');
    // AR: 1.234,56 → 1234.56
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(',', '.');
    }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function buildRecord(input) {
    var amount = normalizeAmount(input.amount);
    var period = CM.Dates.normalizeBillingPeriod(input.billingPeriod || input.billing_period);
    var invoiceId =
      input.invoice_id ||
      CM.Hashes.invoiceIdentity({
        provider: input.provider,
        accountNumber: input.accountNumber || input.account_number,
        invoiceNumber: input.invoiceNumber || input.invoice_number,
        billingPeriod: period,
        amount: amount,
        dueDate: CM.Dates.parseDateToISO(input.dueDate || input.due_date),
      });

    var invoiceStatus = input.invoice_status || input.invoiceStatus || 'detected';
    if (!VALID_INVOICE_STATUS[invoiceStatus]) invoiceStatus = 'detected';

    var paymentStatus = input.payment_status || input.paymentStatus || 'unknown';
    if (!VALID_PAYMENT_STATUS[paymentStatus]) paymentStatus = 'unknown';
    // Nunca inferir paid desde ausencia de deuda en portal
    if (input.inferPaidFromPortalAbsence) {
      paymentStatus = 'unknown';
    }

    return {
      invoice_id: invoiceId,
      property_id: input.property_id || CM.ServiceCatalog.getPropertyDefaults().property_id,
      service_id: input.service_id || '',
      provider: input.provider || '',
      billing_period: period,
      invoice_number: input.invoiceNumber || input.invoice_number || '',
      issue_date: CM.Dates.parseDateToISO(input.issueDate || input.issue_date) || '',
      due_date: CM.Dates.parseDateToISO(input.dueDate || input.due_date) || '',
      amount: amount == null ? '' : amount,
      currency: input.currency || 'ARS',
      invoice_status: invoiceStatus,
      payment_status: paymentStatus,
      invoice_file_id: input.invoice_file_id || '',
      invoice_file_url: input.invoice_file_url || '',
      first_detected_at: input.first_detected_at || CM.Logging.nowTs(),
      last_checked_at: CM.Logging.nowTs(),
      paid_at: input.paid_at || '',
      payment_receipt_file_id: input.payment_receipt_file_id || '',
      payment_receipt_url: input.payment_receipt_url || '',
      notification_sent_at: input.notification_sent_at || '',
      notes: input.notes || '',
    };
  }

  /**
   * Upsert por invoice_id. Preserva first_detected_at y paid_* si ya existen.
   */
  function upsert(input) {
    var record = buildRecord(input);
    var existing = CM.Sheets.findInvoiceById(record.invoice_id);
    if (existing) {
      record.first_detected_at = existing.first_detected_at || record.first_detected_at;
      if (existing.payment_status === 'paid') {
        record.payment_status = 'paid';
        record.paid_at = existing.paid_at;
        record.payment_receipt_file_id = existing.payment_receipt_file_id;
        record.payment_receipt_url = existing.payment_receipt_url;
      }
      if (existing.invoice_file_id && !record.invoice_file_id) {
        record.invoice_file_id = existing.invoice_file_id;
        record.invoice_file_url = existing.invoice_file_url;
      }
      if (existing.notification_sent_at) {
        record.notification_sent_at = existing.notification_sent_at;
      }
      var merged = Object.assign({}, existing, record);
      delete merged.__row;
      CM.Sheets.updateRow(CM.Sheets.SHEET_NAMES.INVOICES, existing.__row, merged);
      return { action: 'updated', record: merged };
    }
    CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.INVOICES, record);
    return { action: 'inserted', record: record };
  }

  function listForPeriod(period) {
    var p = CM.Dates.normalizeBillingPeriod(period || CM.Dates.currentBillingPeriod());
    if (!p) return [];
    return CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES).filter(function (inv) {
      // Normalize both sides: Sheets may give Date or "2026-11" or locale strings.
      return CM.Dates.normalizeBillingPeriod(inv.billing_period) === p;
    });
  }

  function listPendingPayment() {
    return CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES).filter(function (inv) {
      return String(inv.payment_status) === 'pending';
    });
  }

  /**
   * Alta manual solo metadatos (sin PDF). No inventa montos: amount puede ir vacío.
   * invoice_status → metadata_only
   */
  function importManualMetadata(input) {
    if (!input || !input.provider) {
      throw new Error('importManualMetadata requiere provider');
    }
    if (!input.billingPeriod && !input.billing_period) {
      throw new Error('importManualMetadata requiere billingPeriod (YYYY-MM)');
    }
    var service = CM.ServiceCatalog.getByProvider(input.provider) || {};
    var record = buildRecord(
      Object.assign({}, input, {
        accountNumber: input.accountNumber || input.account_number || service.account_number,
        service_id: input.service_id || service.service_id || '',
        invoice_status: 'metadata_only',
        payment_status: input.payment_status || input.paymentStatus || 'unknown',
        notes: (input.notes ? input.notes + ' | ' : '') + 'manual_metadata',
      })
    );
    var result = upsert(record);
    CM.Logging.ok('importManualMetadata', result.action + ' ' + result.record.invoice_id, {
      provider: result.record.provider,
      billing_period: result.record.billing_period,
    });
    return result;
  }

  /**
   * Importa factura desde un FileId de Drive ya subido por el owner.
   * Copia/valida PDF a la carpeta del período y registra metadata.
   */
  function importManualFromDriveFile(fileId, input) {
    if (!fileId) throw new Error('importManualFromDriveFile requiere fileId');
    input = input || {};
    if (!input.provider) throw new Error('requiere provider');
    if (!input.billingPeriod && !input.billing_period) {
      throw new Error('requiere billingPeriod');
    }

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var meta = {
      provider: input.provider,
      billingPeriod: input.billingPeriod || input.billing_period,
      invoiceNumber: input.invoiceNumber || input.invoice_number || file.getName(),
      invoiceId: input.invoice_id,
    };
    var saved = CM.Drive.saveInvoicePdf(blob, meta);
    if (!saved.ok) {
      CM.Logging.error('importManualFromDriveFile', 'PDF inválido', saved.validation);
      return { ok: false, validation: saved.validation };
    }

    var service = CM.ServiceCatalog.getByProvider(input.provider) || {};
    var up = upsert(
      Object.assign({}, input, {
        accountNumber: input.accountNumber || input.account_number || service.account_number,
        service_id: input.service_id || service.service_id || '',
        invoice_status: 'downloaded',
        invoice_file_id: saved.fileId,
        invoice_file_url: saved.url,
        notes: (input.notes ? input.notes + ' | ' : '') + 'manual_drive_import',
      })
    );
    CM.Logging.ok('importManualFromDriveFile', up.action + ' ' + up.record.invoice_id, {
      fileId: saved.fileId,
      reused: saved.reused,
    });
    return { ok: true, save: saved, upsert: up };
  }

  /** Plantilla vacía para el owner (sin datos inventados). */
  function manualImportTemplate() {
    return {
      provider: 'ecogas|osse|naturgy|municipalidad',
      billingPeriod: 'YYYY-MM',
      invoiceNumber: '',
      amount: '',
      currency: 'ARS',
      issueDate: '',
      dueDate: '',
      payment_status: 'unknown|pending|paid',
      notes: '',
      // Para PDF: subir a Drive y pasar fileId a importManualInvoiceFromDrive(...)
      driveFileId: '',
    };
  }

  var MANUAL_PROVIDERS_ = {
    ecogas: 1,
    naturgy: 1,
    osse: 1,
    municipalidad: 1,
  };

  /**
   * Arma args para importManualFromDriveFile a partir de prompts/menú.
   * Puro (sin DriveApp): parsea fileId/URL, normaliza provider/período/monto.
   * No inventa montos: amount vacío → se omite.
   *
   * @param {object} opts
   * @param {string} opts.fileIdOrUrl
   * @param {string} [opts.provider='ecogas']
   * @param {string} [opts.billingPeriod] default = mes actual
   * @param {string|number} [opts.amount]
   * @param {string} [opts.invoiceNumber]
   * @param {string} [opts.dueDate]
   * @param {string} [opts.payment_status]
   * @param {string} [opts.notes]
   * @returns {{ok:true,fileId:string,input:object}|{ok:false,reason:string,message:string}}
   */
  function prepareManualDriveImport(opts) {
    opts = opts || {};
    var parsed =
      CM.Drive && CM.Drive.parseDriveFileId
        ? CM.Drive.parseDriveFileId(opts.fileIdOrUrl)
        : { ok: false, reason: 'parse_unavailable' };
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason || 'fileId_invalido',
        message:
          parsed.reason === 'empty'
            ? 'Falta fileId o URL de Drive.'
            : 'No pude leer un fileId de Drive desde: ' + String(opts.fileIdOrUrl || '').slice(0, 80),
      };
    }

    var provider = String(opts.provider || 'ecogas')
      .toLowerCase()
      .trim();
    if (!MANUAL_PROVIDERS_[provider]) {
      return {
        ok: false,
        reason: 'provider_invalido',
        message: 'Proveedor inválido: ' + provider + ' (ecogas|naturgy|osse|municipalidad)',
      };
    }

    var periodRaw = opts.billingPeriod || opts.billing_period || CM.Dates.currentBillingPeriod();
    var period = CM.Dates.normalizeBillingPeriod(periodRaw);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return {
        ok: false,
        reason: 'billingPeriod_invalido',
        message: 'billingPeriod inválido (usar YYYY-MM): ' + String(periodRaw),
      };
    }

    var input = {
      provider: provider,
      billingPeriod: period,
      currency: opts.currency || 'ARS',
      notes: opts.notes || '',
    };

    if (opts.invoiceNumber || opts.invoice_number) {
      input.invoiceNumber = opts.invoiceNumber || opts.invoice_number;
    }
    if (opts.dueDate || opts.due_date) {
      input.dueDate = opts.dueDate || opts.due_date;
    }
    if (opts.payment_status || opts.paymentStatus) {
      input.payment_status = opts.payment_status || opts.paymentStatus;
    }

    var amountRaw = opts.amount;
    if (amountRaw != null && String(amountRaw).trim() !== '') {
      var amount = normalizeAmount(amountRaw);
      if (amount == null) {
        return {
          ok: false,
          reason: 'amount_invalido',
          message: 'Monto inválido (dejá vacío o usá un número de la boleta): ' + String(amountRaw),
        };
      }
      input.amount = amount;
    }

    return { ok: true, fileId: parsed.fileId, source: parsed.source, input: input };
  }

  /**
   * Persiste facturas listadas por un adapter: upsert con dedupe + PDF a Drive si download ok.
   * No inventa montos; si el PDF falla, igual upsert metadata (invoice_status detected).
   *
   * @param {object} opts
   * @param {string} opts.providerId
   * @param {object} [opts.service]
   * @param {object} opts.fetched  resultado de adapter.fetchInvoices
   * @param {boolean} [opts.download=true] intentar adapter.downloadInvoice + Drive
   * @param {string} [opts.billingPeriod] si set, solo ese período; si vacío y preferLatest, toma la más nueva
   * @param {boolean} [opts.preferLatest=false] si filtro período vacío, usar invoices[0]
   * @param {number} [opts.maxDownloads] tope de PDFs (default: todos los targets)
   */
  function persistProviderFetch(opts) {
    opts = opts || {};
    var providerId = String(opts.providerId || '').toLowerCase();
    var service = opts.service || null;
    var fetched = opts.fetched || { invoices: [] };
    var doDownload = opts.download !== false;
    var adapter =
      CM.ProviderInterface && CM.ProviderInterface.get
        ? CM.ProviderInterface.get(providerId)
        : null;

    var invoices = (fetched.invoices || []).slice();
    if (opts.billingPeriod) {
      var want = CM.Dates.normalizeBillingPeriod(opts.billingPeriod);
      var filtered = invoices.filter(function (inv) {
        return (
          CM.Dates.normalizeBillingPeriod(inv.billingPeriod || inv.billing_period) === want
        );
      });
      if (filtered.length) {
        invoices = filtered;
      } else if (opts.preferLatest && invoices.length) {
        invoices = [invoices[0]];
      } else {
        invoices = [];
      }
    } else if (opts.preferLatest && invoices.length) {
      invoices = [invoices[0]];
    }

    var maxDl =
      opts.maxDownloads != null ? opts.maxDownloads : doDownload ? invoices.length : 0;
    var downloadsAttempted = 0;
    var upserts = [];
    var downloads = [];

    for (var i = 0; i < invoices.length; i++) {
      var raw = Object.assign({}, invoices[i]);
      raw.provider = providerId;
      if (service) {
        raw.service_id = raw.service_id || service.service_id || '';
        raw.accountNumber = raw.accountNumber || raw.account_number || service.account_number;
      }

      var saved = null;
      var dl = null;
      var osseKeys =
        raw.guidId && raw.tpoCom != null && raw.preCom != null && raw.numCom != null;
      var muniKeys = raw.autoDownload === true || !!raw.checkboxName;
      var canDl =
        doDownload &&
        adapter &&
        typeof adapter.downloadInvoice === 'function' &&
        downloadsAttempted < maxDl &&
        (osseKeys || muniKeys);

      if (canDl) {
        downloadsAttempted++;
        try {
          dl = adapter.downloadInvoice(service, raw);
        } catch (e) {
          dl = {
            ok: false,
            outcome: CM.ProviderInterface.OUTCOME.ERROR,
            message: String(e),
          };
        }
        if (dl && dl.ok && dl.blob) {
          try {
            saved = CM.Drive.saveInvoicePdf(dl.blob, {
              provider: providerId,
              billingPeriod: raw.billingPeriod || raw.billing_period,
              invoiceNumber: raw.invoiceNumber || raw.invoice_number,
            });
          } catch (e) {
            saved = { ok: false, validation: { ok: false, reason: 'drive_error', error: String(e) } };
          }
        }
        downloads.push({
          invoiceNumber: raw.invoiceNumber || raw.invoice_number,
          download: dl && {
            ok: !!dl.ok,
            outcome: dl.outcome,
            message: dl.message,
            httpCode: dl.httpCode,
          },
          save: saved && {
            ok: !!(saved && saved.ok),
            fileId: saved && saved.fileId,
            url: saved && saved.url,
            reused: saved && saved.reused,
            validation: saved && saved.validation,
          },
        });
      }

      if (saved && saved.ok) {
        raw.invoice_status = 'downloaded';
        raw.invoice_file_id = saved.fileId;
        raw.invoice_file_url = saved.url;
        raw.notes = (raw.notes ? raw.notes + ' | ' : '') + 'auto_download';
      } else if (!raw.invoice_status) {
        raw.invoice_status = 'detected';
      }

      var up = upsert(raw);
      upserts.push(up);
    }

    var anyPdf = downloads.some(function (d) {
      return d.save && d.save.ok;
    });
    var pdfCount = downloads.filter(function (d) {
      return d.save && d.save.ok;
    }).length;
    var outcome = fetched.outcome;
    if (anyPdf) outcome = CM.ProviderInterface.OUTCOME.DOWNLOADED_OK;
    else if (!invoices.length && fetched.outcome) outcome = fetched.outcome;

    var pdfReason = explainPdfSkip_(downloads, doDownload, adapter, invoices.length);
    var message;
    if (anyPdf) {
      message = 'PDF guardado en Drive + fila Invoices (dedupe).';
    } else if (upserts.length) {
      message =
        'Factura registrada (metadata); PDF no descargado porque ' +
        (pdfReason || 'motivo desconocido');
    } else {
      message = (fetched && fetched.message) || pdfReason || 'Sin facturas para persistir';
    }

    return {
      ok: anyPdf || upserts.length > 0,
      outcome: outcome,
      message: message,
      pdfSkipReason: anyPdf ? null : pdfReason,
      upserts: upserts,
      downloads: downloads,
      invoiceCount: invoices.length,
      pdfCount: pdfCount,
    };
  }

  /**
   * Motivo humano cuando hubo listado/upsert pero no PDF en Drive.
   * No reutilizar el message de éxito de downloadInvoice ("PDF OSSE OK").
   */
  function explainPdfSkip_(downloads, doDownload, adapter, invoiceCount) {
    if (!doDownload) return 'download deshabilitado en persistProviderFetch';
    if (!adapter) return 'adapter no registrado';
    if (!invoiceCount) return 'no había facturas en el listado';
    if (typeof adapter.downloadInvoice !== 'function') {
      return 'el adapter no implementa downloadInvoice';
    }
    var d = downloads && downloads[0];
    if (!d) {
      return (
        'faltan claves de descarga (OSSE: guidId/tpoCom/preCom/numCom; ' +
        'Municipalidad: autoDownload/checkboxName) o se alcanzó maxDownloads'
      );
    }
    if (d.download && !d.download.ok) {
      return d.download.message || d.download.outcome || 'falló ImprimirFactura/download';
    }
    if (d.download && d.download.ok && (!d.save || !d.save.ok)) {
      var v = d.save && d.save.validation;
      if (v && (v.reason || v.error)) {
        return (
          'Drive/validación PDF: ' +
          (v.reason || '') +
          (v.error ? ' ' + v.error : '') +
          (v.size != null ? ' (size=' + v.size + ')' : '')
        ).trim();
      }
      if (!d.save) return 'download OK pero sin blob para guardar en Drive';
      return 'falló guardado en Drive tras download OK';
    }
    return 'PDF no persistido';
  }

  return {
    normalizeAmount: normalizeAmount,
    buildRecord: buildRecord,
    upsert: upsert,
    listForPeriod: listForPeriod,
    listPendingPayment: listPendingPayment,
    importManualMetadata: importManualMetadata,
    importManualFromDriveFile: importManualFromDriveFile,
    manualImportTemplate: manualImportTemplate,
    prepareManualDriveImport: prepareManualDriveImport,
    persistProviderFetch: persistProviderFetch,
    VALID_INVOICE_STATUS: VALID_INVOICE_STATUS,
    VALID_PAYMENT_STATUS: VALID_PAYMENT_STATUS,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Invoices;
}
