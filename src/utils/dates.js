/**
 * Fechas — timezone America/Argentina/Buenos_Aires.
 * Funciones puras reutilizables en tests Node (sin SpreadsheetApp).
 */

var CM = CM || {};
CM.Dates = (function () {
  var TZ = 'America/Argentina/Buenos_Aires';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** @returns {string} YYYY-MM-DD en TZ Argentina (GAS) o UTC fallback (Node). */
  function todayISO() {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    }
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** @returns {string} YYYY-MM */
  function currentBillingPeriod() {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    }
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
  }

  /**
   * Desplaza un período YYYY-MM por N meses (negativo = atrás).
   * @param {string} [period] default = mes actual
   * @param {number} [deltaMonths] default -1 (mes anterior)
   * @returns {string} YYYY-MM
   */
  function shiftBillingPeriod(period, deltaMonths) {
    var p = normalizeBillingPeriod(period || currentBillingPeriod());
    var delta = deltaMonths == null ? -1 : Number(deltaMonths);
    if (!p || isNaN(delta)) return '';
    var parts = p.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!y || !m) return '';
    var idx = y * 12 + (m - 1) + delta;
    var ny = Math.floor(idx / 12);
    var nm = (idx % 12) + 1;
    if (nm <= 0) {
      nm += 12;
      ny -= 1;
    }
    return ny + '-' + pad2(nm);
  }

  /** Alias: mes anterior al indicado (o al actual). */
  function previousBillingPeriod(period) {
    return shiftBillingPeriod(period || currentBillingPeriod(), -1);
  }

  /**
   * Etiqueta amigable ES: "noviembre 2026".
   * @param {string} period YYYY-MM
   */
  function formatPeriodLabelEs(period) {
    var p = normalizeBillingPeriod(period);
    if (!p) return '';
    var parts = p.split('-');
    var months = [
      '',
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    var mi = parseInt(parts[1], 10);
    return (months[mi] || parts[1]) + ' ' + parts[0];
  }

  /**
   * Normaliza períodos a YYYY-MM cuando es posible.
   * Acepta: "2026-01", "01/2026", "enero 2026", "2026/01",
   * y Date de Sheets (columna formateada como fecha → Nov 1 2026, etc.).
   */
  function normalizeBillingPeriod(raw) {
    if (raw == null || raw === '') return '';

    // Google Sheets often returns Date objects for cells that look like 2026-11.
    if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(raw, TZ, 'yyyy-MM');
      }
      return raw.getFullYear() + '-' + pad2(raw.getMonth() + 1);
    }

    var s = String(raw).trim().toLowerCase();
    var m;

    m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m) return m[1] + '-' + pad2(parseInt(m[2], 10));

    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) return m[2] + '-' + pad2(parseInt(m[1], 10));

    var months = {
      enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
      julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
      noviembre: 11, diciembre: 12,
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    m = s.match(/([a-záéíóúñ]+)\s+(\d{4})/);
    if (m && months[m[1]]) return m[2] + '-' + pad2(months[m[1]]);

    // Locale date strings e.g. "sat nov 01 2026 ..." from String(Date)
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\s+(\d{4})\b/);
    if (m && months[m[1]]) return m[3] + '-' + pad2(months[m[1]]);
    m = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/);
    if (m && months[m[2]]) return m[3] + '-' + pad2(months[m[2]]);

    return s;
  }

  /**
   * Parsea fechas comunes AR/ISO → YYYY-MM-DD o '' si inválida.
   * No inventa fechas.
   */
  function parseDateToISO(raw) {
    if (raw == null || raw === '') return '';
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      return raw.getFullYear() + '-' + pad2(raw.getMonth() + 1) + '-' + pad2(raw.getDate());
    }
    var s = String(raw).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return m[3] + '-' + pad2(parseInt(m[2], 10)) + '-' + pad2(parseInt(m[1], 10));
    return '';
  }

  /** Días hasta dueDate (YYYY-MM-DD). Negativo si vencida. */
  function daysUntil(dueISO) {
    var iso = parseDateToISO(dueISO);
    if (!iso) return null;
    var parts = iso.split('-');
    var due = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    var today = parseDateToISO(todayISO()).split('-');
    var now = new Date(Date.UTC(+today[0], +today[1] - 1, +today[2]));
    return Math.round((due - now) / 86400000);
  }

  function timezone() {
    return TZ;
  }

  return {
    TZ: TZ,
    timezone: timezone,
    todayISO: todayISO,
    currentBillingPeriod: currentBillingPeriod,
    shiftBillingPeriod: shiftBillingPeriod,
    previousBillingPeriod: previousBillingPeriod,
    formatPeriodLabelEs: formatPeriodLabelEs,
    normalizeBillingPeriod: normalizeBillingPeriod,
    parseDateToISO: parseDateToISO,
    daysUntil: daysUntil,
    pad2: pad2,
  };
})();

// Export para Node tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Dates;
}
