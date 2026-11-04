function testNotifications_approvalGate() {
  var prev = CM.Settings.getMonthlyApprovalPeriod();
  CM.Settings.clearMonthlyApproval();
  var blocked = CM.Notifications.sendMonthlyReport('2099-01');
  var okBlocked = blocked && blocked.reason === 'approval_required';

  CM.Settings.setMonthlyApprovalPeriod('2099-01');
  // dry-run + sin contacts → ok soft
  CM.Settings.setDryRun(true);
  var preview = CM.Notifications.previewMonthlyReport('2099-01');
  var okPreview = preview && preview.report && preview.report.billingPeriod === '2099-01';

  if (prev) CM.Settings.setMonthlyApprovalPeriod(prev);
  else CM.Settings.clearMonthlyApproval();

  Logger.log('approval gate: ' + okBlocked + ' preview: ' + okPreview);
  return { ok: okBlocked && okPreview, blocked: blocked, preview: !!preview };
}
