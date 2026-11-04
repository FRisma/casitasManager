/**
 * Validación y nombres de archivos PDF.
 */

var CM = CM || {};
CM.Pdf = (function () {
  var PDF_MAGIC = '%PDF';

  /**
   * Detecta magic `%PDF` en string, Buffer, TypedArray o array-like de bytes.
   * Apps Script `Blob.getBytes()` devuelve Byte[] (array-like de números) — sin
   * `.byteLength` ni Buffer — y el path viejo devolvía false → Drive rechazaba
   * PDFs válidos con magic_pdf_ausente tras un download "OK".
   */
  function looksLikePdf(bytesOrString) {
    if (bytesOrString == null) return false;
    if (typeof bytesOrString === 'string') {
      // Ecogas Imprimir a veces antepone whitespace (tab) antes de %PDF
      var s = bytesOrString.replace(/^[\s\u0000]+/, '');
      return s.substring(0, 5).indexOf(PDF_MAGIC) === 0;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytesOrString)) {
      var start = 0;
      while (start < bytesOrString.length && start < 64) {
        var bb = bytesOrString[start];
        if (bb === 9 || bb === 10 || bb === 13 || bb === 32 || bb === 0) {
          start++;
          continue;
        }
        break;
      }
      return bytesOrString.slice(start, start + 4).toString('utf8') === PDF_MAGIC;
    }
    // ArrayBuffer / TypedArray (algunos runtimes)
    if (typeof ArrayBuffer !== 'undefined' && bytesOrString instanceof ArrayBuffer) {
      return looksLikePdfByteArray_(new Uint8Array(bytesOrString));
    }
    if (
      bytesOrString.buffer &&
      typeof bytesOrString.BYTES_PER_ELEMENT === 'number' &&
      typeof bytesOrString.length === 'number'
    ) {
      return looksLikePdfByteArray_(bytesOrString);
    }
    // GAS Byte[] / number[] array-like
    if (typeof bytesOrString.length === 'number' && bytesOrString.length >= 4) {
      return looksLikePdfByteArray_(bytesOrString);
    }
    if (typeof Utilities !== 'undefined' && bytesOrString.byteLength != null) {
      try {
        var head = Utilities.newBlob(bytesOrString)
          .getDataAsString()
          .replace(/^[\s\u0000]+/, '')
          .substring(0, 4);
        return head.indexOf(PDF_MAGIC) === 0;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function looksLikePdfByteArray_(arr) {
    if (!arr || arr.length < 4) return false;
    var start = 0;
    while (start < arr.length && start < 64) {
      var skip = arr[start];
      if (typeof skip !== 'number') return false;
      if (skip < 0) skip = skip + 256;
      if (skip === 9 || skip === 10 || skip === 13 || skip === 32 || skip === 0) {
        start++;
        continue;
      }
      break;
    }
    if (arr.length - start < 4) return false;
    var s = '';
    for (var i = 0; i < 4; i++) {
      var b = arr[start + i];
      if (typeof b !== 'number') return false;
      if (b < 0) b = b + 256; // Java signed bytes
      s += String.fromCharCode(b & 0xff);
    }
    return s === PDF_MAGIC;
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
