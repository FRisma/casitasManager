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
    var p = CM.Dates.normalizeBillingPeriod(period);
    return CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES).filter(function (inv) {
      return String(inv.billing_period) === p;
    });
  }

  function listPendingPayment() {
    return CM.Sheets.list(CM.Sheets.SHEET_NAMES.INVOICES).filter(function (inv) {
      return String(inv.payment_status) === 'pending';
    });
  }

  return {
    normalizeAmount: normalizeAmount,
    buildRecord: buildRecord,
    upsert: upsert,
    listForPeriod: listForPeriod,
    listPendingPayment: listPendingPayment,
    VALID_INVOICE_STATUS: VALID_INVOICE_STATUS,
    VALID_PAYMENT_STATUS: VALID_PAYMENT_STATUS,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Invoices;
}
