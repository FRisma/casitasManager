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

  /**
   * Latin-1 string from PDF bytes / Buffer / GAS Byte[] / string.
   * Used for heuristic Tj/TJ text scrape (no full PDF parser).
   */
  function bytesToLatin1(bytesOrString) {
    if (bytesOrString == null) return '';
    if (typeof bytesOrString === 'string') return bytesOrString;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytesOrString)) {
      return bytesOrString.toString('latin1');
    }
    if (typeof bytesOrString.length === 'number') {
      var out = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytesOrString.length; i += chunk) {
        var end = Math.min(i + chunk, bytesOrString.length);
        var arr = [];
        for (var j = i; j < end; j++) {
          var b = bytesOrString[j];
          if (typeof b !== 'number') return out;
          if (b < 0) b = b + 256;
          arr.push(b & 0xff);
        }
        out += String.fromCharCode.apply(null, arr);
      }
      return out;
    }
    return '';
  }

  /**
   * Decode one PDF literal `(...)` starting at openParenIndex (the '(').
   * @returns {{text:string, end:number}|null}
   */
  function decodePdfLiteral_(s, openParenIndex) {
    if (!s || s.charAt(openParenIndex) !== '(') return null;
    var i = openParenIndex + 1;
    var buf = '';
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) {
        var nxt = s.charAt(i + 1);
        var escMap = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (escMap[nxt] != null) {
          buf += escMap[nxt];
          i += 2;
          continue;
        }
        if (nxt >= '0' && nxt <= '7') {
          var oct = nxt;
          i += 2;
          while (oct.length < 3 && i < s.length && s.charAt(i) >= '0' && s.charAt(i) <= '7') {
            oct += s.charAt(i);
            i++;
          }
          buf += String.fromCharCode(parseInt(oct, 8) & 0xff);
          continue;
        }
        buf += nxt;
        i += 2;
        continue;
      }
      if (ch === ')') {
        return { text: buf, end: i + 1 };
      }
      buf += ch;
      i++;
    }
    return null;
  }

  function isMostlyPrintable_(text) {
    if (!text) return false;
    var printable = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (
        c === 9 ||
        c === 10 ||
        c === 13 ||
        (c >= 32 && c <= 126) ||
        (c >= 160 && c <= 255)
      ) {
        printable++;
      }
    }
    return printable / text.length >= 0.85;
  }

  /**
   * Heuristic: pull text from uncompressed PDF content operators `(...)Tj` / `[...]TJ`.
   * Enough for Ecogas Imprimir PDFs where totals/dates sit in clear-text streams.
   * Does not inflate FlateDecode streams (GAS-friendly). Returns '' if nothing useful.
   */
  function extractEmbeddedText(bytesOrString) {
    var s = bytesToLatin1(bytesOrString);
    if (!s || s.indexOf('%PDF') === -1) {
      // allow already-stripped bodies that still have Tj
      if (!s || (s.indexOf('Tj') === -1 && s.indexOf('TJ') === -1)) return '';
    }
    var parts = [];
    var i = 0;
    while (i < s.length) {
      if (s.charAt(i) !== '(') {
        i++;
        continue;
      }
      var lit = decodePdfLiteral_(s, i);
      if (!lit) {
        i++;
        continue;
      }
      var after = s.substring(lit.end, lit.end + 24);
      var usedAsText = /^\s*Tj/.test(after) || /^\s*'/.test(after) || /^\s*"/.test(after);
      // Inside TJ array: next non-space is number, another '(', ']', or '-'
      if (!usedAsText) {
        var rest = s.substring(lit.end, lit.end + 48);
        if (/^\s*[-0-9.]/.test(rest) || /^\s*\(/.test(rest) || /^\s*\]/.test(rest)) {
          // Confirm a nearby TJ (look back for '[' and forward for '] TJ')
          var back = s.lastIndexOf('[', i);
          var fwd = s.indexOf(']', lit.end);
          if (
            back >= 0 &&
            fwd > lit.end &&
            fwd - back < 800 &&
            /^\s*TJ/.test(s.substring(fwd + 1, fwd + 12))
          ) {
            usedAsText = true;
          }
        }
      }
      if (usedAsText && isMostlyPrintable_(lit.text) && lit.text.replace(/\s+/g, '').length > 0) {
        parts.push(lit.text);
      }
      i = lit.end;
    }
    return parts.join(' ');
  }

  return {
    looksLikePdf: looksLikePdf,
    sanitizeFilename: sanitizeFilename,
    invoiceFilename: invoiceFilename,
    validatePdfBlob: validatePdfBlob,
    bytesToLatin1: bytesToLatin1,
    extractEmbeddedText: extractEmbeddedText,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Pdf;
}
