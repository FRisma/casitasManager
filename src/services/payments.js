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

  /**
   * Input para registerPayment desde prompts del menú (sin inventar montos).
   * Amount vacío → registerPayment usa el de la factura.
   * @param {string} invoiceId
   * @param {{payment_date?:string,payment_method?:string,notes?:string,amount?:string|number}} [answers]
   */
  function buildMenuPaymentInput(invoiceId, answers) {
    answers = answers || {};
    var id = String(invoiceId || '').trim();
    if (!id) throw new Error('buildMenuPaymentInput requiere invoice_id');
    var input = {
      invoice_id: id,
      confirmation_source: 'manual',
    };
    var dateRaw = answers.payment_date != null ? String(answers.payment_date).trim() : '';
    if (dateRaw) input.payment_date = dateRaw;
    var methodRaw =
      answers.payment_method != null ? String(answers.payment_method).trim() : '';
    if (methodRaw) input.payment_method = methodRaw;
    var notesRaw = answers.notes != null ? String(answers.notes).trim() : '';
    if (notesRaw) input.notes = notesRaw;
    if (answers.amount != null && String(answers.amount).trim() !== '') {
      input.amount = answers.amount;
    }
    return input;
  }

  /**
   * Facturas aún no pagadas (pending / unknown / vacío). Para listado del menú.
   * @param {object[]} invoices
   * @param {number} [limit]
   */
  function listUnpaidForMenu(invoices, limit) {
    var max = limit != null && limit > 0 ? limit : 12;
    var out = [];
    (invoices || []).forEach(function (inv) {
      if (!inv || !inv.invoice_id) return;
      var st = String(inv.payment_status || '').toLowerCase();
      if (st === 'paid') return;
      out.push(inv);
    });
    return out.slice(0, max);
  }

  /**
   * Texto de opciones 1…N para prompt (invoice_id / provider / período / monto).
   * @param {object[]} unpaid
   */
  function formatUnpaidChoices(unpaid) {
    return (unpaid || [])
      .map(function (inv, i) {
        var amt = inv.amount != null && inv.amount !== '' ? String(inv.amount) : '—';
        return (
          String(i + 1) +
          ') ' +
          inv.invoice_id +
          ' · ' +
          (inv.provider || '?') +
          ' · ' +
          (inv.billing_period || '?') +
          ' · $' +
          amt
        );
      })
      .join('\n');
  }

  /**
   * Resuelve índice 1-based o invoice_id literal desde respuesta del prompt.
   * @param {string} answer
   * @param {object[]} unpaid
   * @returns {string|null} invoice_id
   */
  function resolveInvoiceIdFromChoice(answer, unpaid) {
    var raw = answer == null ? '' : String(answer).trim();
    if (!raw) return null;
    var idx = parseInt(raw, 10);
    if (
      String(idx) === raw &&
      idx >= 1 &&
      unpaid &&
      idx <= unpaid.length &&
      unpaid[idx - 1] &&
      unpaid[idx - 1].invoice_id
    ) {
      return String(unpaid[idx - 1].invoice_id);
    }
    return raw;
  }

  /**
   * Mensaje de éxito / error para toast/alert del menú.
   * @param {{ok:boolean,payment?:object,invoice?:object,message?:string,reason?:string}} result
   */
  function formatMarkPaidResultMessage(result) {
    if (!result) return 'Sin resultado.';
    if (!result.ok) {
      return (
        'No se registró el pago.\n\n' +
        (result.message || result.reason || 'Error desconocido')
      );
    }
    var pay = result.payment || {};
    var inv = result.invoice || {};
    return (
      'OK: factura marcada como pagada.\n\n' +
      'payment_id: ' +
      (pay.payment_id || '') +
      '\ninvoice_id: ' +
      (pay.invoice_id || inv.invoice_id || '') +
      '\nfecha: ' +
      (pay.payment_date || '') +
      (pay.amount != null && pay.amount !== '' ? '\nmonto: ' + pay.amount : '') +
      '\n\nSe actualizó payment_status=paid / paid_at y se agregó fila en Payments.'
    );
  }

  return {
    registerPayment: registerPayment,
    newPaymentId: newPaymentId,
    buildMenuPaymentInput: buildMenuPaymentInput,
    listUnpaidForMenu: listUnpaidForMenu,
    formatUnpaidChoices: formatUnpaidChoices,
    resolveInvoiceIdFromChoice: resolveInvoiceIdFromChoice,
    formatMarkPaidResultMessage: formatMarkPaidResultMessage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Payments;
}
