/**
 * Tests ejecutables en Apps Script (Run → testInvoices_all).
 * Lógica espejo también cubierta por tests/ Node.
 */
function testInvoices_all() {
  var results = [];
  function assert(name, cond) {
    results.push({ name: name, ok: !!cond });
    if (!cond) Logger.log('FAIL ' + name);
  }

  var id1 = CM.Hashes.invoiceIdentity({
    provider: 'ecogas',
    accountNumber: '20259678',
    invoiceNumber: 'F-1',
    billingPeriod: '2026-01',
  });
  var id2 = CM.Hashes.invoiceIdentity({
    provider: 'ecogas',
    accountNumber: '20259678',
    invoiceNumber: 'F-1',
    billingPeriod: '2026-01',
  });
  assert('identity_stable', id1 === id2);

  var id3 = CM.Hashes.invoiceIdentity({
    provider: 'ecogas',
    accountNumber: '20259678',
    billingPeriod: '2026-01',
    amount: 100,
    dueDate: '2026-02-01',
  });
  assert('fallback_hash', id3.indexOf('invh|') === 0);

  assert('amount_ar', CM.Invoices.normalizeAmount('1.234,56') === 1234.56);
  assert('amount_dot', CM.Invoices.normalizeAmount('1234.56') === 1234.56);
  assert('period', CM.Dates.normalizeBillingPeriod('01/2026') === '2026-01');

  var rec = CM.Invoices.buildRecord({
    provider: 'naturgy',
    accountNumber: '20004193466',
    invoiceNumber: 'X',
    billingPeriod: 'marzo 2026',
    amount: '10,5',
    dueDate: '15/03/2026',
    inferPaidFromPortalAbsence: true,
  });
  assert('no_infer_paid', rec.payment_status === 'unknown');
  assert('period_marzo', rec.billing_period === '2026-03');

  var failed = results.filter(function (r) {
    return !r.ok;
  });
  Logger.log('testInvoices_all: ' + (results.length - failed.length) + '/' + results.length);
  return { ok: failed.length === 0, results: results };
}
