function testPayments_id() {
  var a = CM.Payments.newPaymentId('inv1');
  var b = CM.Payments.newPaymentId('inv1');
  Logger.log('payment ids distinct: ' + (a !== b));
  return { ok: a !== b && a.indexOf('pay_') === 0, a: a, b: b };
}
