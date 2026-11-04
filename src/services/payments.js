/**
 * Registro manual de pagos. Sin pagos automáticos.
 * Solo el propietario paga.
 */

var CM = CM || {};
CM.Payments = (function () {
  function newPaymentId(invoiceId) {
    return (
      'pay_' +
      CM.Hashes.simpleHash(String(invoiceId) + '|' + CM.Logging.nowTs() + '|' + Math.random())
    );
  }

  /**
   * @param {object} input
   * @param {string} input.invoice_id
   * @param {string|number} [input.amount]
   * @param {string} [input.payment_date] YYYY-MM-DD
   * @param {string} [input.payment_method]
   * @param {string} [input.receipt_file_id]
   * @param {string} [input.receipt_file_url]
   * @param {string} [input.confirmation_source]
   * @param {string} [input.notes]
   */
  function registerPayment(input) {
    if (!input || !input.invoice_id) {
      throw new Error('registerPayment requiere invoice_id');
    }
    var inv = CM.Sheets.findInvoiceById(input.invoice_id);
    if (!inv) throw new Error('Factura no encontrada: ' + input.invoice_id);

    var amount = CM.Invoices.normalizeAmount(
      input.amount != null && input.amount !== '' ? input.amount : inv.amount
    );
    var paymentDate = CM.Dates.parseDateToISO(input.payment_date) || CM.Dates.todayISO();

    var payment = {
      payment_id: input.payment_id || newPaymentId(input.invoice_id),
      invoice_id: input.invoice_id,
      provider: inv.provider,
      payment_date: paymentDate,
      amount: amount == null ? '' : amount,
      payment_method: input.payment_method || '',
      receipt_file_id: input.receipt_file_id || '',
      receipt_file_url: input.receipt_file_url || '',
      confirmation_source: input.confirmation_source || 'manual',
      notes: input.notes || '',
    };

    CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.PAYMENTS, payment);

    var updated = Object.assign({}, inv, {
      payment_status: 'paid',
      paid_at: paymentDate,
      payment_receipt_file_id: payment.receipt_file_id,
      payment_receipt_url: payment.receipt_file_url,
      last_checked_at: CM.Logging.nowTs(),
      notes: inv.notes
        ? inv.notes + ' | paid via ' + payment.payment_id
        : 'paid via ' + payment.payment_id,
    });
    delete updated.__row;
    CM.Sheets.updateRow(CM.Sheets.SHEET_NAMES.INVOICES, inv.__row, updated);

    CM.Logging.ok('registerPayment', 'Pago registrado', {
      payment_id: payment.payment_id,
      invoice_id: payment.invoice_id,
    });

    return { payment: payment, invoice: updated };
  }

  return {
    registerPayment: registerPayment,
    newPaymentId: newPaymentId,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Payments;
}
