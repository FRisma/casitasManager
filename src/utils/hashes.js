/**
 * Identidad de facturas y hashes determinísticos.
 */

var CM = CM || {};
CM.Hashes = (function () {
  function stableString(v) {
    if (v == null) return '';
    return String(v).trim().toLowerCase();
  }

  /**
   * Identidad preferida: provider + account + invoiceNumber + billingPeriod.
   * Fallback: hash de provider + account + period + amount + dueDate.
   */
  function invoiceIdentity(parts) {
    var provider = stableString(parts.provider);
    var account = stableString(parts.accountNumber || parts.account);
    var period = stableString(parts.billingPeriod);
    var number = stableString(parts.invoiceNumber);

    if (provider && account && number && period) {
      return ['inv', provider, account, number, period].join('|');
    }

    var amount = parts.amount != null && parts.amount !== '' ? String(parts.amount) : '';
    var due = stableString(parts.dueDate);
    var basis = [provider, account, period, amount, due].join('|');
    return 'invh|' + simpleHash(basis);
  }

  /** Hash FNV-1a 32-bit → hex (suficiente para dedupe local, no crypto). */
  function simpleHash(str) {
    var h = 0x811c9dc5;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function notificationDedupeKey(kind, invoiceId, extra) {
    return ['notif', kind, stableString(invoiceId), stableString(extra || '')].join('|');
  }

  return {
    invoiceIdentity: invoiceIdentity,
    simpleHash: simpleHash,
    notificationDedupeKey: notificationDedupeKey,
    stableString: stableString,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Hashes;
}
