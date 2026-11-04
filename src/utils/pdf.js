/**
 * Validación y nombres de archivos PDF.
 */

var CM = CM || {};
CM.Pdf = (function () {
  var PDF_MAGIC = '%PDF';

  function looksLikePdf(bytesOrString) {
    if (bytesOrString == null) return false;
    if (typeof Utilities !== 'undefined' && bytesOrString.byteLength != null) {
      try {
        var head = Utilities.newBlob(bytesOrString).getDataAsString().substring(0, 4);
        return head.indexOf(PDF_MAGIC) === 0;
      } catch (e) {
        return false;
      }
    }
    if (typeof bytesOrString === 'string') {
      return bytesOrString.substring(0, 5).indexOf(PDF_MAGIC) === 0;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytesOrString)) {
      return bytesOrString.slice(0, 4).toString('utf8') === PDF_MAGIC;
    }
    return false;
  }

  function sanitizeFilename(name) {
    var s = String(name || 'documento')
      .replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120);
    if (!/\.pdf$/i.test(s)) s += '.pdf';
    return s;
  }

  /**
   * Nombre determinístico para factura.
   * No incluye datos inventados: usa solo campos provistos.
   */
  function invoiceFilename(meta) {
    var parts = [
      meta.provider || 'provider',
      meta.billingPeriod || 'periodo',
      meta.invoiceNumber || meta.invoiceId || 'sin-numero',
    ];
    return sanitizeFilename(parts.join('_'));
  }

  function validatePdfBlob(blob, minBytes, maxBytes) {
    minBytes = minBytes == null ? 100 : minBytes;
    maxBytes = maxBytes == null ? 15 * 1024 * 1024 : maxBytes;
    if (!blob) return { ok: false, reason: 'blob_vacio' };
    var size = typeof blob.getBytes === 'function' ? blob.getBytes().length : blob.size || 0;
    if (size < minBytes) return { ok: false, reason: 'demasiado_pequeno', size: size };
    if (size > maxBytes) return { ok: false, reason: 'demasiado_grande', size: size };
    var ct = typeof blob.getContentType === 'function' ? blob.getContentType() : blob.contentType || '';
    if (ct && ct.indexOf('pdf') === -1 && ct.indexOf('octet-stream') === -1) {
      return { ok: false, reason: 'content_type_invalido', contentType: ct };
    }
    try {
      var bytes = typeof blob.getBytes === 'function' ? blob.getBytes() : null;
      if (bytes && !looksLikePdf(bytes)) {
        return { ok: false, reason: 'magic_pdf_ausente', size: size };
      }
    } catch (e) {
      return { ok: false, reason: 'error_leyendo_blob', error: String(e) };
    }
    return { ok: true, size: size, contentType: ct };
  }

  return {
    looksLikePdf: looksLikePdf,
    sanitizeFilename: sanitizeFilename,
    invoiceFilename: invoiceFilename,
    validatePdfBlob: validatePdfBlob,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Pdf;
}
