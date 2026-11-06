#!/usr/bin/env node
'use strict';

/**
 * Unit tests locales (Node) — lógica pura sin Apps Script runtime.
 */

const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src');

global.CM = {};

function load(rel) {
  let code = fs.readFileSync(path.join(SRC, rel), 'utf8');
  code = code.replace(/if\s*\(\s*typeof\s+module[\s\S]*$/m, '');
  // Evitar que `var CM = CM || {}` sombreé el objeto compartido
  code = code.replace(/var\s+CM\s*=\s*CM\s*\|\|\s*\{\}\s*;?/g, '');
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'CM',
    'Utilities',
    'Logger',
    'console',
    code + '\n;'
  );
  fn(global.CM, undefined, { log: function () {} }, console);
}

load('utils/dates.js');
load('utils/hashes.js');
load('utils/pdf.js');
load('utils/logging.js');
load('config/settings.js');
load('config/services.js');

global.CM.Sheets = {
  SHEET_NAMES: {
    INVOICES: 'Invoices',
    CONTACTS: 'Contacts',
    PROPERTIES: 'Properties',
    SERVICES: 'Services',
    PAYMENTS: 'Payments',
    CONFIGURATION: 'Configuration',
    EXECUTION_LOG: 'ExecutionLog',
  },
  appendExecutionLog: function () {},
  getContacts: function () {
    return [];
  },
  list: function () {
    return [];
  },
  findInvoiceById: function () {
    return null;
  },
  updateRow: function () {},
  appendRow: function () {},
  setConfig: function () {},
};

load('services/invoices.js');
load('services/payments.js');
load('services/properties.js');
load('services/email.js');
load('services/telegram.js');
load('services/telegram-bot.js');
load('services/notifications.js');
load('services/drive.js');
load('providers/provider-interface.js');
load('providers/osse.js');
load('providers/municipalidad.js');
load('providers/naturgy.js');
load('providers/ecogas.js');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

console.log('\n== dates ==');
assert('tz', global.CM.Dates.TZ === 'America/Argentina/Buenos_Aires');
assert('norm 01/2026', global.CM.Dates.normalizeBillingPeriod('01/2026') === '2026-01');
assert('norm 2026-1', global.CM.Dates.normalizeBillingPeriod('2026-1') === '2026-01');
assert('norm marzo', global.CM.Dates.normalizeBillingPeriod('marzo 2026') === '2026-03');
assert('parse AR', global.CM.Dates.parseDateToISO('15/03/2026') === '2026-03-15');
assert('parse ISO', global.CM.Dates.parseDateToISO('2026-03-15') === '2026-03-15');
assert(
  'shift -1 from 2026-11',
  global.CM.Dates.shiftBillingPeriod('2026-11', -1) === '2026-10'
);
assert(
  'previous from 2026-01',
  global.CM.Dates.previousBillingPeriod('2026-01') === '2025-12'
);
assert(
  'period label ES',
  global.CM.Dates.formatPeriodLabelEs('2026-11') === 'noviembre 2026'
);
// Sheets Date coercion (billing_period shown as 2026-11 but cell is Date)
assert(
  'Date→yyyy-MM Nov',
  global.CM.Dates.normalizeBillingPeriod(new Date(2026, 10, 1)) === '2026-11'
);
assert(
  'Date→yyyy-MM Oct',
  global.CM.Dates.normalizeBillingPeriod(new Date(2026, 9, 15)) === '2026-10'
);
assert(
  'String(Date) locale→yyyy-MM',
  global.CM.Dates.normalizeBillingPeriod(String(new Date(2026, 10, 1))) === '2026-11'
);

console.log('\n== listForPeriod with Sheets Date cells ==');
const _origList = global.CM.Sheets.list;
global.CM.Sheets.list = function () {
  return [
    { billing_period: new Date(2026, 10, 1), provider: 'ecogas', amount: 1 },
    { billing_period: '2026-10', provider: 'naturgy', amount: 2 },
    { billing_period: new Date(2026, 9, 1), provider: 'osse', amount: 3 },
  ];
};
assert('listForPeriod Date Nov', global.CM.Invoices.listForPeriod('2026-11').length === 1);
assert('listForPeriod string Oct finds Date+string', global.CM.Invoices.listForPeriod('2026-10').length === 2);
assert('listForPeriod empty month', global.CM.Invoices.listForPeriod('2026-01').length === 0);
global.CM.Sheets.list = _origList;

console.log('\n== hashes / invoice identity ==');
const idA = global.CM.Hashes.invoiceIdentity({
  provider: 'ecogas',
  accountNumber: '20259678',
  invoiceNumber: 'F-1',
  billingPeriod: '2026-01',
});
const idB = global.CM.Hashes.invoiceIdentity({
  provider: 'Ecogas',
  accountNumber: '20259678',
  invoiceNumber: 'F-1',
  billingPeriod: '2026-01',
});
assert('stable identity', idA === idB, idA);
const idH = global.CM.Hashes.invoiceIdentity({
  provider: 'ecogas',
  accountNumber: '20259678',
  billingPeriod: '2026-01',
  amount: 100,
  dueDate: '2026-02-01',
});
assert('fallback hash prefix', idH.indexOf('invh|') === 0, idH);
assert(
  'different amount ≠ same hash',
  global.CM.Hashes.invoiceIdentity({
    provider: 'ecogas',
    accountNumber: '20259678',
    billingPeriod: '2026-01',
    amount: 200,
    dueDate: '2026-02-01',
  }) !== idH
);

console.log('\n== amounts ==');
assert('AR format', global.CM.Invoices.normalizeAmount('1.234,56') === 1234.56);
assert('dot', global.CM.Invoices.normalizeAmount('99.5') === 99.5);
assert('empty→null', global.CM.Invoices.normalizeAmount('') === null);

console.log('\n== pdf names ==');
assert(
  'filename',
  global.CM.Pdf.invoiceFilename({ provider: 'osse', billingPeriod: '2026-01', invoiceNumber: '9' }) ===
    'osse_2026-01_9.pdf'
);
assert('sanitize', global.CM.Pdf.sanitizeFilename('a/b\\c').indexOf('/') === -1);
assert('looksLikePdf string', global.CM.Pdf.looksLikePdf('%PDF-1.4 rest') === true);
assert('looksLikePdf not pdf', global.CM.Pdf.looksLikePdf('<html>') === false);
// Apps Script Blob.getBytes() → number array / Byte[] (no Buffer, no byteLength)
assert(
  'looksLikePdf GAS byte array',
  global.CM.Pdf.looksLikePdf([37, 80, 68, 70, 45, 49]) === true
);
assert(
  'looksLikePdf GAS signed bytes',
  global.CM.Pdf.looksLikePdf([37, 80, 68, 70]) === true
);
assert(
  'looksLikePdf rejects short array',
  global.CM.Pdf.looksLikePdf([37, 80]) === false
);
assert(
  'looksLikePdf leading tab (Ecogas)',
  global.CM.Pdf.looksLikePdf('\t%PDF-1.5 rest') === true
);
assert(
  'looksLikePdf leading tab bytes',
  global.CM.Pdf.looksLikePdf([9, 37, 80, 68, 70]) === true
);
assert(
  'validatePdfBlob GAS-like',
  global.CM.Pdf.validatePdfBlob({
    getBytes: function () {
      return Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(200, 0)]);
    },
    getContentType: function () {
      return 'application/pdf';
    },
  }).ok === true
);

console.log('\n== buildRecord no inventa paid ==');
const rec = global.CM.Invoices.buildRecord({
  provider: 'naturgy',
  accountNumber: '20004193466',
  invoiceNumber: 'X',
  billingPeriod: '2026-04',
  amount: '10',
  inferPaidFromPortalAbsence: true,
});
assert('payment unknown', rec.payment_status === 'unknown');
assert('status detected', rec.invoice_status === 'detected');

console.log('\n== payments menu helpers + registerPayment ==');
{
  const unpaidSample = [
    {
      invoice_id: 'inv_a',
      provider: 'osse',
      billing_period: '2026-10',
      amount: 100,
      payment_status: 'pending',
    },
    {
      invoice_id: 'inv_b',
      provider: 'ecogas',
      billing_period: '2026-11',
      amount: '',
      payment_status: 'unknown',
    },
    {
      invoice_id: 'inv_paid',
      provider: 'naturgy',
      billing_period: '2026-09',
      amount: 50,
      payment_status: 'paid',
    },
  ];
  const unpaid = global.CM.Payments.listUnpaidForMenu(unpaidSample, 12);
  assert('listUnpaid skips paid', unpaid.length === 2 && unpaid[0].invoice_id === 'inv_a');
  const choices = global.CM.Payments.formatUnpaidChoices(unpaid);
  assert('formatUnpaidChoices has ids', choices.indexOf('inv_a') >= 0 && choices.indexOf('1)') === 0);
  assert(
    'resolve by index',
    global.CM.Payments.resolveInvoiceIdFromChoice('2', unpaid) === 'inv_b'
  );
  assert(
    'resolve by literal id',
    global.CM.Payments.resolveInvoiceIdFromChoice('inv_a', unpaid) === 'inv_a'
  );
  assert(
    'resolve empty → null',
    global.CM.Payments.resolveInvoiceIdFromChoice('  ', unpaid) === null
  );

  const built = global.CM.Payments.buildMenuPaymentInput('inv_a', {
    payment_date: '02/11/2026',
    payment_method: 'transferencia',
    notes: 'pago banco',
  });
  assert(
    'buildMenuPaymentInput fields',
    built.invoice_id === 'inv_a' &&
      built.payment_date === '02/11/2026' &&
      built.payment_method === 'transferencia' &&
      built.notes === 'pago banco' &&
      built.confirmation_source === 'manual' &&
      built.amount === undefined
  );

  let builtErr = false;
  try {
    global.CM.Payments.buildMenuPaymentInput('');
  } catch (e) {
    builtErr = true;
  }
  assert('buildMenuPaymentInput requires id', builtErr);

  const payStore = { invoices: [], payments: [] };
  const prevFind = global.CM.Sheets.findInvoiceById;
  const prevAppend = global.CM.Sheets.appendRow;
  const prevUpdate = global.CM.Sheets.updateRow;
  const prevNames = global.CM.Sheets.SHEET_NAMES;
  global.CM.Sheets.SHEET_NAMES = Object.assign({}, prevNames, {
    INVOICES: 'Invoices',
    PAYMENTS: 'Payments',
  });
  payStore.invoices.push({
    invoice_id: 'inv_menu_1',
    provider: 'osse',
    billing_period: '2026-11',
    amount: 1234.5,
    payment_status: 'pending',
    notes: '',
    __row: 2,
  });
  global.CM.Sheets.findInvoiceById = function (id) {
    return (
      payStore.invoices.find(function (r) {
        return r.invoice_id === id;
      }) || null
    );
  };
  global.CM.Sheets.appendRow = function (sheet, row) {
    if (sheet === 'Payments') payStore.payments.push(Object.assign({}, row));
    else payStore.invoices.push(Object.assign({}, row));
  };
  global.CM.Sheets.updateRow = function (sheet, rowNum, row) {
    if (sheet !== 'Invoices') return;
    const idx = payStore.invoices.findIndex(function (r) {
      return r.__row === rowNum || r.invoice_id === row.invoice_id;
    });
    if (idx >= 0) payStore.invoices[idx] = Object.assign({}, row, { __row: rowNum });
  };

  const registered = global.CM.Payments.registerPayment(
    global.CM.Payments.buildMenuPaymentInput('inv_menu_1', {
      payment_date: '2026-11-05',
      payment_method: 'transferencia',
    })
  );
  assert('registerPayment returns payment_id', !!(registered.payment && registered.payment.payment_id));
  assert(
    'registerPayment amount from invoice',
    registered.payment.amount === 1234.5,
    String(registered.payment.amount)
  );
  assert(
    'registerPayment sets paid',
    registered.invoice.payment_status === 'paid' &&
      registered.invoice.paid_at === '2026-11-05'
  );
  assert('registerPayment Payments row', payStore.payments.length === 1);
  assert(
    'formatMarkPaid success has payment_id',
    global.CM.Payments.formatMarkPaidResultMessage({
      ok: true,
      payment: registered.payment,
      invoice: registered.invoice,
    }).indexOf(registered.payment.payment_id) >= 0
  );
  assert(
    'formatMarkPaid error clean',
    global.CM.Payments.formatMarkPaidResultMessage({
      ok: false,
      message: 'Factura no encontrada: x',
    }).indexOf('Factura no encontrada') >= 0
  );

  let missingErr = '';
  try {
    global.CM.Payments.registerPayment({ invoice_id: 'no_existe' });
  } catch (e) {
    missingErr = String(e.message || e);
  }
  assert('registerPayment missing invoice throws', missingErr.indexOf('no_existe') >= 0);

  global.CM.Sheets.findInvoiceById = prevFind;
  global.CM.Sheets.appendRow = prevAppend;
  global.CM.Sheets.updateRow = prevUpdate;
  global.CM.Sheets.SHEET_NAMES = prevNames;
}

console.log('\n== service catalog municipalidad active ==');
const muni = global.CM.ServiceCatalog.getByProvider('municipalidad');
assert('muni enabled seed', muni && muni.enabled === true);
assert(
  'muni cadastral Franco',
  muni && muni.cadastral_number === '322047490000'
);

console.log('\n== notification approval gate ==');
global.CM.Settings.clearMonthlyApproval();
global.CM.Settings.setDryRun(true);
global.CM.Settings.set(global.CM.Settings.KEYS.ENVIRONMENT, 'DEV');
const blocked = global.CM.Notifications.sendMonthlyReport('2099-01');
assert('blocked without approval', blocked && blocked.reason === 'approval_required');
global.CM.Settings.setMonthlyApprovalPeriod('2099-01');
const preview = global.CM.Notifications.previewMonthlyReport('2099-01');
assert('preview ok', !!(preview && preview.report && preview.report.billingPeriod === '2099-01'));
assert(
  'spanish tenant body present',
  !!(preview && preview.emailPreview.htmlBody.indexOf('únicamente informativo') >= 0)
);
assert(
  'owner ops preview present',
  !!(
    preview &&
    preview.ownerEmailPreview &&
    preview.ownerEmailPreview.htmlBody.indexOf('payment_status') >= 0 &&
    preview.ownerEmailPreview.htmlBody.indexOf('únicamente informativo') < 0
  )
);
assert(
  'owner and tenant bodies differ',
  !!(
    preview &&
    preview.emailPreview &&
    preview.ownerEmailPreview &&
    preview.emailPreview.htmlBody !== preview.ownerEmailPreview.htmlBody
  )
);
assert(
  'preview marks owner-only in DEV',
  String(preview.emailPreview.recipientsWouldBe).indexOf('OWNER test only') === 0
);

console.log('\n== dry-run send does not claim real delivery ==');
// Contacts vacíos → no_recipients, pero dryRun path de Email/Telegram no llama APIs externas
const sent = global.CM.Notifications.sendMonthlyReport('2099-01');
assert('send after approval returns object', !!sent);
assert('dry-run flag on report', preview.report.dryRun === true);
const emailDry = global.CM.Email.send({
  contacts: [{ email: 'owner-test@example.com', role: 'owner' }],
  purpose: 'owner',
  subject: 'test',
  body: 'dry',
});
// En DEV, resolveRecipients_ lee owners desde Sheets stub ([]) — sin recipients
assert('email handles empty recipients', emailDry.ok === false && emailDry.reason === 'no_recipients');

// Stub owners in Sheets for dry-run path
global.CM.Sheets.getContacts = function (propertyId, role) {
  if (role === 'owner') {
    return [{ email: 'owner-test@example.com', telegram: '111', role: 'owner', active: true }];
  }
  return [{ email: 'tenant-real@example.com', telegram: '999', role: 'tenant', active: true }];
};
const emailDry2 = global.CM.Email.send({
  contacts: [{ email: 'tenant-real@example.com' }],
  purpose: 'tenant_report',
  subject: 'tenant should redirect',
  body: 'x',
});
assert('DEV dry-run email ok', emailDry2.ok === true && emailDry2.dryRun === true);
assert(
  'DEV redirects to owner not tenant',
  emailDry2.to.length === 1 && emailDry2.to[0] === 'owner-test@example.com'
);
const tgDry = global.CM.Telegram.sendMessage({
  contacts: [{ telegram: '999' }],
  purpose: 'tenant_report',
  text: 'hola',
});
assert('telegram not_configured or dry-run', tgDry.reason === 'not_configured' || tgDry.dryRun === true);
// Configure fake token in memory — still dry-run, no UrlFetch
global.CM.Settings.set(global.CM.Settings.KEYS.TELEGRAM_BOT_TOKEN, '000:TEST');
const tgDry2 = global.CM.Telegram.sendMessage({
  contacts: [{ telegram: '999' }],
  purpose: 'tenant_report',
  text: 'hola',
});
assert('telegram dry-run with token', tgDry2.ok === true && tgDry2.dryRun === true);
assert('telegram DEV uses owner chat', tgDry2.chats.length === 1 && tgDry2.chats[0] === '111');

console.log('\n== manual invoice metadata builder ==');
const manual = global.CM.Invoices.buildRecord({
  provider: 'ecogas',
  accountNumber: '20259678',
  invoiceNumber: 'MANUAL-1',
  billingPeriod: '2026-11',
  amount: '1.500,25',
  invoice_status: 'metadata_only',
  payment_status: 'pending',
});
assert('manual status metadata_only', manual.invoice_status === 'metadata_only');
assert('manual amount AR', manual.amount === 1500.25);
assert('template has provider field', !!global.CM.Invoices.manualImportTemplate().provider);

console.log('\n== dual-test notify gate ==');
global.CM.Sheets.getContacts = function (propertyId, role) {
  var all = [
    { email: 'owner-test@example.com', telegram: '111', role: 'owner', active: true, name: 'Owner' },
    { email: 'tenant-real@example.com', telegram: '999', role: 'tenant', active: true, name: 'Tenant' },
  ];
  if (!role) return all;
  return all.filter(function (c) {
    return c.role === role;
  });
};
global.CM.Settings.set(global.CM.Settings.KEYS.ALLOW_TEST_TENANT_SEND, '');
// Avoid UrlFetchApp in Node: no bot token for this gate test
global.CM.Settings.set(global.CM.Settings.KEYS.TELEGRAM_BOT_TOKEN, '');
const dualBlocked = global.CM.Notifications.sendTestNotifyAllConfiguredContacts('2026-11');
assert('dual blocked without confirm', dualBlocked.reason === 'confirmation_required');
// With confirm: should resolve owners+tenants (email may be no_mail_api in Node; telegram not_configured)
const dualOk = global.CM.Notifications.sendTestNotifyAllConfiguredContacts(
  '2026-11',
  'YES_SEND_TO_TENANTS'
);
assert('dual ran with confirm', !!dualOk.loud && dualOk.reason !== 'confirmation_required');
assert(
  'dual lists tenant+owner emails when contacts exist',
  !!(
    dualOk.loud &&
    dualOk.loud.emailTargets &&
    dualOk.loud.emailTargets.some(function (t) {
      return t.role === 'tenant';
    }) &&
    dualOk.loud.emailTargets.some(function (t) {
      return t.role === 'owner';
    })
  )
);
assert(
  'dual email forceAllContacts hit both',
  !!(dualOk.email && dualOk.email.to && dualOk.email.to.indexOf('tenant-real@example.com') >= 0)
);
assert('dual marks differentiated copy', dualOk.differentiatedCopy === true);
assert(
  'dual owner bundle uses ops subject',
  !!(
    dualOk.owner &&
    dualOk.owner.email &&
    dualOk.owner.email.subject &&
    dualOk.owner.email.subject.indexOf('OWNER') >= 0 &&
    dualOk.owner.email.preview &&
    dualOk.owner.email.preview.body.indexOf('payment_status') >= 0 &&
    dualOk.owner.email.preview.body.indexOf('únicamente informativo') < 0
  )
);
assert(
  'dual tenant bundle uses informational copy',
  !!(
    dualOk.tenant &&
    dualOk.tenant.email &&
    dualOk.tenant.email.subject &&
    dualOk.tenant.email.subject.indexOf('TENANT') >= 0 &&
    dualOk.tenant.email.preview &&
    dualOk.tenant.email.preview.body.indexOf('únicamente informativo') >= 0 &&
    dualOk.tenant.email.preview.body.indexOf('payment_status=') < 0
  )
);
assert(
  'dual owner and tenant bodies differ',
  !!(
    dualOk.owner &&
    dualOk.tenant &&
    dualOk.owner.email &&
    dualOk.tenant.email &&
    dualOk.owner.email.preview &&
    dualOk.tenant.email.preview &&
    dualOk.owner.email.preview.body !== dualOk.tenant.email.preview.body
  )
);
// Normal DEV email still redirects to owners only
const stillSafe = global.CM.Email.send({
  contacts: [{ email: 'tenant-real@example.com' }],
  purpose: 'tenant_report',
  subject: 'should redirect',
  body: 'x',
});
assert(
  'sendMonthlyReport path still owner-only in DEV',
  stillSafe.to.length === 1 && stillSafe.to[0] === 'owner-test@example.com'
);
// sendMonthlyReport in DEV uses owner ops copy (not tenant wording) and does not fan-out to tenants
global.CM.Settings.setMonthlyApprovalPeriod('2026-11');
global.CM.Settings.setDryRun(true);
const monthlyDev = global.CM.Notifications.sendMonthlyReport('2026-11');
assert('monthly DEV send ok soft', !!(monthlyDev && monthlyDev.ok));
assert('monthly DEV differentiated', monthlyDev.differentiatedCopy === true);
assert(
  'monthly DEV owner ops body',
  !!(
    monthlyDev.owner &&
    monthlyDev.owner.email &&
    monthlyDev.owner.email.preview &&
    monthlyDev.owner.email.preview.body.indexOf('payment_status') >= 0 &&
    monthlyDev.owner.email.preview.body.indexOf('únicamente informativo') < 0
  )
);
assert('monthly DEV no tenant send', monthlyDev.tenant === null);

console.log('\n== role-only test notify ==');
global.CM.Settings.set(global.CM.Settings.KEYS.ALLOW_TEST_TENANT_SEND, '');
const ownerOnly = global.CM.Notifications.sendTestNotifyOwnersOnly('2026-11');
assert('owner-only ran without tenant gate', !!ownerOnly.loud && ownerOnly.reason !== 'confirmation_required');
assert(
  'owner-only targets only owners',
  !!(
    ownerOnly.loud &&
    ownerOnly.loud.emailTargets &&
    ownerOnly.loud.emailTargets.every(function (t) {
      return t.role === 'owner';
    }) &&
    ownerOnly.loud.emailTargets.length >= 1
  )
);
assert(
  'owner-only email hits owner not tenant',
  !!(
    ownerOnly.email &&
    ownerOnly.email.to &&
    ownerOnly.email.to.indexOf('owner-test@example.com') >= 0 &&
    ownerOnly.email.to.indexOf('tenant-real@example.com') < 0
  )
);
assert(
  'owner-only uses ops copy',
  !!(
    ownerOnly.owner &&
    ownerOnly.owner.email &&
    ownerOnly.owner.email.subject &&
    ownerOnly.owner.email.subject.indexOf('OWNER') >= 0 &&
    ownerOnly.owner.email.preview &&
    ownerOnly.owner.email.preview.body.indexOf('payment_status') >= 0
  )
);

const tenantBlocked = global.CM.Notifications.sendTestNotifyTenantsOnly('2026-11');
assert('tenant-only blocked without confirm', tenantBlocked.reason === 'confirmation_required');
const tenantOnly = global.CM.Notifications.sendTestNotifyTenantsOnly(
  '2026-11',
  'YES_SEND_TO_TENANTS'
);
assert('tenant-only ran with confirm', !!tenantOnly.loud && tenantOnly.reason !== 'confirmation_required');
assert(
  'tenant-only targets only tenants',
  !!(
    tenantOnly.loud &&
    tenantOnly.loud.emailTargets &&
    tenantOnly.loud.emailTargets.every(function (t) {
      return t.role === 'tenant';
    }) &&
    tenantOnly.loud.emailTargets.length >= 1
  )
);
assert(
  'tenant-only email hits tenant not owner',
  !!(
    tenantOnly.email &&
    tenantOnly.email.to &&
    tenantOnly.email.to.indexOf('tenant-real@example.com') >= 0 &&
    tenantOnly.email.to.indexOf('owner-test@example.com') < 0
  )
);
assert(
  'tenant-only uses informational copy',
  !!(
    tenantOnly.tenant &&
    tenantOnly.tenant.email &&
    tenantOnly.tenant.email.subject &&
    tenantOnly.tenant.email.subject.indexOf('TENANT') >= 0 &&
    tenantOnly.tenant.email.preview &&
    tenantOnly.tenant.email.preview.body.indexOf('únicamente informativo') >= 0
  )
);

console.log('\n== telegram owner commands ==');
const appr = global.CM.Telegram.handleOwnerCommand('approve_report', ['2026-11']);
assert('approve cmd', appr.ok && global.CM.Settings.getMonthlyApprovalPeriod() === '2026-11');

console.log('\n== notification dedupe key ==');
const k1 = global.CM.Hashes.notificationDedupeKey('new', 'inv1');
const k2 = global.CM.Hashes.notificationDedupeKey('new', 'inv1');
assert('dedupe stable', k1 === k2);

console.log('\n== OSSE adapter (pure helpers + mocked http) ==');
const osse = global.CM.Providers.Osse;
assert('osse registered', !!osse && osse.id === 'osse');
assert(
  'osse portal .com.ar',
  osse.portal === 'https://facturaweb.osse.com.ar/'
);
assert(
  'account digits from Services spacing',
  osse.accountDigits({ account_number: '119 0080934 000 1' }) === '11900809340001'
);
assert('account digits strip', osse.accountDigits('119-0080934-000-1') === '11900809340001');
assert(
  'seed catalog portal .com.ar',
  global.CM.ServiceCatalog.getByProvider('osse').portal_url.indexOf('facturaweb.osse.com.ar') >= 0
);
assert(
  'seed catalog not .osse.ar TLD',
  global.CM.ServiceCatalog.getByProvider('osse').portal_url.indexOf('facturaweb.osse.ar/') < 0
);

const unidadParsed = osse.parseUnidadResponse(
  JSON.stringify({
    unidadId: 60358,
    unidadAlt: '11900809340001',
    razon: 'SHOULD_NOT_LEAK',
    guidId: 'UKabcd-test',
  })
);
assert('parse unidad ok', unidadParsed.ok === true && unidadParsed.guidId === 'UKabcd-test');
assert('parse unidad no razon PII', unidadParsed.razon === undefined);
assert(
  'parse unidad bad',
  osse.parseUnidadResponse('not-json').ok === false
);

const factsParsed = osse.parseFacturasResponse(
  JSON.stringify([
    {
      compro: 'FC-0001-19568132',
      tpoCom: 'FC',
      preCom: '0001',
      numCom: 19568132,
      sPeriodo: '11-2026',
      totalBas: 38247.31,
      fecVen: '2026-12-15T00:00:00',
      fecEmi: '2026-11-02T00:00:00',
      sitComMoroso: 'CO',
    },
  ])
);
assert('parse facturas array', factsParsed.ok && factsParsed.data.length === 1);

const mapped = osse.mapFactura(factsParsed.data[0], 'UKabcd-test', {
  service_id: 'svc_osse_water',
  account_number: '119 0080934 000 1',
});
assert('map period MM-YYYY→YYYY-MM', mapped.billingPeriod === '2026-11');
assert('map amount', mapped.amount === 38247.31);
assert('map invoice number', mapped.invoiceNumber === 'FC-0001-19568132');
assert('map never infers paid', mapped.payment_status === 'unknown');
assert('map keeps download keys', mapped.guidId === 'UKabcd-test' && mapped.tpoCom === 'FC');
assert(
  'imprimir url',
  osse.buildImprimirUrl('G1', 'FC', '0001', 19568132).indexOf('ImprimirFactura') >= 0 &&
    osse.buildImprimirUrl('G1', 'FC', '0001', 19568132).indexOf('numCom=19568132') >= 0
);

// Mock httpGet: missing UrlFetch → honest portal_inaccessible from real httpGet;
// override to simulate API success path for fetchInvoices
const _origHttpGet = global.CM.ProviderInterface.httpGet;
const osseService = global.CM.ServiceCatalog.getByProvider('osse');
global.CM.ProviderInterface.httpGet = function (url) {
  if (String(url).indexOf('UnidadByUnidadAlt') >= 0) {
    return {
      ok: true,
      code: 200,
      body: JSON.stringify({
        unidadId: 60358,
        unidadAlt: '11900809340001',
        guidId: 'UKabcd-test',
      }),
      headers: {},
      contentType: 'application/json',
    };
  }
  if (String(url).indexOf('UltimasFacturas') >= 0) {
    return {
      ok: true,
      code: 200,
      body: JSON.stringify(factsParsed.data),
      headers: {},
      contentType: 'application/json',
    };
  }
  if (String(url).indexOf('ImprimirFactura') >= 0) {
    return {
      ok: true,
      code: 200,
      body: '%PDF-1.4 mock',
      contentType: 'application/pdf',
      headers: { 'Content-Type': 'application/pdf' },
      blob: {
        getBytes: function () {
          return Buffer.from('%PDF-1.4 mock');
        },
        getContentType: function () {
          return 'application/pdf';
        },
      },
    };
  }
  return { ok: false, code: 0, error: 'unexpected url ' + url, body: '', headers: {} };
};

const fetched = osse.fetchInvoices(osseService, { billingPeriod: '2026-11', limit: 5 });
assert('fetch listed_ok', fetched.outcome === 'listed_ok', fetched.outcome + ' ' + fetched.message);
assert('fetch one period', fetched.invoices && fetched.invoices.length === 1);
assert('fetch has guid', fetched.guidId === 'UKabcd-test');

const emptyPeriod = osse.fetchInvoices(osseService, { billingPeriod: '2099-01' });
assert(
  'fetch empty period honest',
  emptyPeriod.outcome === 'invoice_not_available_yet' && emptyPeriod.invoices.length === 0
);

const dl = osse.downloadInvoice(osseService, fetched.invoices[0]);
assert('download ok', dl.ok === true && dl.outcome === 'downloaded_ok', dl.message);
assert('download has blob', !!(dl.blob && dl.blob.getBytes));

// Missing account → missing_property_info (not “sin facturas”)
const missing = osse.fetchInvoices({ account_number: '', enabled: true });
assert(
  'missing account honest',
  missing.outcome === 'missing_property_info' && missing.invoices.length === 0
);

// API down → portal_inaccessible (not empty list as “sin facturas”)
global.CM.ProviderInterface.httpGet = function (url) {
  if (String(url).indexOf('UnidadByUnidadAlt') >= 0) {
    return { ok: false, code: 0, error: 'DNS fail', body: '', headers: {}, outcome: 'portal_inaccessible' };
  }
  return { ok: false, code: 0, error: 'no', body: '', headers: {} };
};
const down = osse.fetchInvoices(osseService);
assert(
  'api down portal_inaccessible',
  down.outcome === 'portal_inaccessible' && down.invoices.length === 0
);

global.CM.ProviderInterface.httpGet = _origHttpGet;

// persistProviderFetch upserts + save path (Drive stub)
const stored = [];
global.CM.Sheets.findInvoiceById = function (id) {
  return stored.find(function (r) {
    return r.invoice_id === id;
  }) || null;
};
global.CM.Sheets.appendRow = function (sheet, row) {
  stored.push(Object.assign({}, row));
};
global.CM.Sheets.updateRow = function (sheet, rowNum, row) {
  const idx = stored.findIndex(function (r) {
    return r.invoice_id === row.invoice_id;
  });
  if (idx >= 0) stored[idx] = Object.assign({}, row);
};
global.CM.Drive = {
  saveInvoicePdf: function (blob, meta) {
    return {
      ok: true,
      fileId: 'file_osse_1',
      url: 'https://drive.example/file_osse_1',
      name: global.CM.Pdf.invoiceFilename(meta),
      reused: false,
      validation: { ok: true },
    };
  },
};
global.CM.ProviderInterface.httpGet = function (url) {
  if (String(url).indexOf('ImprimirFactura') >= 0) {
    return {
      ok: true,
      code: 200,
      contentType: 'application/pdf',
      headers: {},
      body: '%PDF-1.4',
      blob: {
        getBytes: function () {
          return Buffer.from('%PDF-1.4');
        },
        getContentType: function () {
          return 'application/pdf';
        },
      },
    };
  }
  return { ok: false, code: 0, error: 'no', body: '', headers: {} };
};
const persisted = global.CM.Invoices.persistProviderFetch({
  providerId: 'osse',
  service: osseService,
  fetched: {
    outcome: 'listed_ok',
    invoices: [mapped],
  },
  download: true,
  maxDownloads: 1,
});
assert('persist pdfCount', persisted.pdfCount === 1, JSON.stringify(persisted.downloads));
assert('persist upsert', persisted.upserts.length === 1 && persisted.upserts[0].action === 'inserted');
assert(
  'persist downloaded status',
  persisted.upserts[0].record.invoice_status === 'downloaded' &&
    persisted.upserts[0].record.invoice_file_id === 'file_osse_1'
);
// dedupe second pass
const persisted2 = global.CM.Invoices.persistProviderFetch({
  providerId: 'osse',
  service: osseService,
  fetched: { outcome: 'listed_ok', invoices: [mapped] },
  download: true,
  maxDownloads: 1,
});
assert('persist dedupe update', persisted2.upserts[0].action === 'updated');

// Drive validation fail → metadata upsert, honest message (never "PDF OSSE OK")
global.CM.Drive = {
  saveInvoicePdf: function () {
    return {
      ok: false,
      validation: { ok: false, reason: 'magic_pdf_ausente', size: 12 },
    };
  },
};
const persistedFail = global.CM.Invoices.persistProviderFetch({
  providerId: 'osse',
  service: osseService,
  fetched: { outcome: 'listed_ok', invoices: [mapped] },
  download: true,
  maxDownloads: 1,
});
assert('persist fail pdfCount 0', persistedFail.pdfCount === 0);
assert('persist fail still upserts', persistedFail.upserts.length === 1);
assert(
  'persist fail message metadata',
  String(persistedFail.message).indexOf('Factura registrada (metadata)') === 0,
  persistedFail.message
);
assert(
  'persist fail message has reason',
  String(persistedFail.message).indexOf('magic_pdf_ausente') >= 0,
  persistedFail.message
);
assert(
  'persist fail never says PDF OSSE OK',
  String(persistedFail.message).indexOf('PDF OSSE OK') < 0,
  persistedFail.message
);
assert(
  'persist fail pdfSkipReason',
  persistedFail.pdfSkipReason &&
    String(persistedFail.pdfSkipReason).indexOf('magic_pdf_ausente') >= 0
);

// content-type PDF but bad magic → downloadInvoice must not claim OK
global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: true,
    code: 200,
    contentType: 'application/pdf',
    headers: { 'Content-Type': 'application/pdf' },
    body: '<html>not a pdf</html>',
    blob: {
      getBytes: function () {
        return Buffer.from('<html>not a pdf</html>');
      },
      getContentType: function () {
        return 'application/pdf';
      },
    },
  };
};
const dlFake = osse.downloadInvoice(osseService, mapped);
assert('download rejects fake pdf ct', dlFake.ok === false, dlFake.message);
assert(
  'download fake outcome',
  dlFake.outcome === 'available_not_downloadable',
  dlFake.outcome
);

global.CM.ProviderInterface.httpGet = _origHttpGet;

console.log('\n== Municipalidad adapter (fixtures + mocked http) ==');
const muniAd = global.CM.Providers.Municipalidad;
assert('muni registered', !!muniAd && muniAd.id === 'municipalidad');
assert(
  'muni portal http',
  muniAd.portal.indexOf('http://181.209.107.110:83/') === 0
);

const getFix = fs.readFileSync(
  path.join(__dirname, 'fixtures/municipalidad/get-form.html'),
  'utf8'
);
const gridFix = fs.readFileSync(
  path.join(__dirname, 'fixtures/municipalidad/search-grid.html'),
  'utf8'
);
assert('fixture get has VIEWSTATE', muniAd.hasAspNetForm_(getFix));
const fieldsGet = muniAd.extractAspNetFields_(getFix);
assert('extract VIEWSTATE', !!(fieldsGet.__VIEWSTATE && fieldsGet.__EVENTVALIDATION));

const parsedRows = muniAd.parseDebtGrid_(gridFix, {
  service_id: 'svc_muni_cadastral',
  cadastral_number: '322047490000',
});
assert('parse grid rows', parsedRows.length === 1, String(parsedRows.length));
assert('parse period 2026-11', parsedRows[0].billingPeriod === '2026-11');
assert('parse ImpTotal amount', parsedRows[0].amount === 9600);
assert('parse dueDate ISO', parsedRows[0].dueDate === '2026-11-10');
assert(
  'parse checkbox ctl02',
  parsedRows[0].checkboxName === 'gvSeleccion$ctl02$Procesar'
);
assert('parse autoDownload', parsedRows[0].autoDownload === true);
assert(
  'detect checkboxes',
  muniAd.detectCheckboxNames_(gridFix)[0] === 'gvSeleccion$ctl02$Procesar'
);

const jar1 = muniAd.mergeCookieJar_('', {
  'Set-Cookie': 'ASP.NET_SessionId=abc123; path=/; HttpOnly',
});
assert('cookie jar set', jar1.indexOf('ASP.NET_SessionId=abc123') >= 0);
const jar2 = muniAd.mergeCookieJar_(jar1, {
  'Set-Cookie': 'ASP.NET_SessionId=xyz789; path=/',
});
assert('cookie jar replace', jar2.indexOf('xyz789') >= 0 && jar2.indexOf('abc123') < 0);

const muniService = global.CM.ServiceCatalog.getByProvider('municipalidad');
assert('seed cadastral', muniService.cadastral_number === '322047490000');
assert('seed enabled', muniService.enabled === true);

const _origHttpGet2 = global.CM.ProviderInterface.httpGet;
const _origHttpPost2 = global.CM.ProviderInterface.httpPost;
let muniPosts = [];
global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: true,
    code: 200,
    body: getFix,
    headers: { 'Set-Cookie': 'ASP.NET_SessionId=sess1; path=/' },
    contentType: 'text/html',
  };
};
global.CM.ProviderInterface.httpPost = function (url, payload) {
  muniPosts.push(payload || {});
  const target = payload && payload.__EVENTTARGET;
  if (target === 'rbTipoInm') {
    return {
      ok: true,
      code: 200,
      body: getFix.replace('maxlength="16"', 'maxlength="12"'),
      headers: {},
      contentType: 'text/html',
      fields: fieldsGet,
    };
  }
  if (payload && payload.btnBuscar === 'BUSCAR') {
    return {
      ok: true,
      code: 200,
      body: gridFix,
      headers: { 'Set-Cookie': 'ASP.NET_SessionId=sess1; path=/' },
      contentType: 'text/html',
    };
  }
  if (payload && (payload['btnBoleta.x'] != null || payload['btnBoleta.y'] != null)) {
    const pdfBytes = Buffer.from('%PDF-1.4 municipalidad-mock');
    return {
      ok: true,
      code: 200,
      body: '%PDF-1.4 municipalidad-mock',
      contentType: 'application/pdf',
      headers: { 'Content-Type': 'application/pdf' },
      blob: {
        getBytes: function () {
          return pdfBytes;
        },
        getContentType: function () {
          return 'application/pdf';
        },
      },
    };
  }
  return { ok: false, code: 500, body: '', headers: {}, error: 'unexpected post' };
};

const muniFetched = muniAd.fetchInvoices(muniService, { billingPeriod: '2026-11' });
assert('muni fetch listed', muniFetched.outcome === 'listed_ok', muniFetched.message);
assert('muni fetch count', muniFetched.invoices && muniFetched.invoices.length === 1);
assert(
  'muni posts include rbTipoInm before BUSCAR',
  muniPosts.length >= 2 &&
    muniPosts[0].__EVENTTARGET === 'rbTipoInm' &&
    muniPosts[1].btnBuscar === 'BUSCAR',
  JSON.stringify(muniPosts.map((p) => Object.keys(p).filter((k) => k.indexOf('btn') === 0 || k === '__EVENTTARGET')))
);

const muniDl = muniAd.downloadInvoice(muniService, muniFetched.invoices[0]);
assert('muni download ok', muniDl.ok === true, muniDl.message);
assert('muni download outcome', muniDl.outcome === 'downloaded_ok');
assert(
  'muni boleta posted checkbox',
  muniPosts.some(
    (p) => p['gvSeleccion$ctl02$Procesar'] === 'on' && p['btnBoleta.x'] != null
  )
);

// persistProviderFetch with autoDownload keys
global.CM.Drive = {
  saveInvoicePdf: function () {
    return {
      ok: true,
      fileId: 'file_muni_1',
      url: 'https://drive.example/file_muni_1',
      reused: false,
      validation: { ok: true },
    };
  },
};
const muniPersist = global.CM.Invoices.persistProviderFetch({
  providerId: 'municipalidad',
  service: muniService,
  fetched: muniFetched,
  download: true,
  preferLatest: true,
  maxDownloads: 1,
});
assert('muni persist pdf', muniPersist.pdfCount === 1, muniPersist.message);
assert(
  'muni persist downloaded status',
  muniPersist.upserts[0] && muniPersist.upserts[0].record.invoice_status === 'downloaded'
);

const disabledFetch = muniAd.fetchInvoices({
  enabled: false,
  cadastral_number: '322047490000',
});
assert('muni disabled outcome', disabledFetch.outcome === 'disabled');

global.CM.ProviderInterface.httpGet = _origHttpGet2;
global.CM.ProviderInterface.httpPost = _origHttpPost2;

console.log('\n== parseDriveFileId / prepareManualDriveImport ==');
// muni/osse stubs overwrite CM.Drive — reload pure helpers
load('services/drive.js');
const parseId = global.CM.Drive.parseDriveFileId;
assert('parse raw fileId', parseId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms').ok === true);
assert(
  'parse /file/d/ URL',
  parseId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view').fileId ===
    '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
);
assert('parse empty', parseId('').ok === false);
const prepNat = global.CM.Invoices.prepareManualDriveImport({
  fileIdOrUrl: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  provider: 'naturgy',
  billingPeriod: '2026-10',
  amount: '15.669,07',
});
assert('prepare naturgy ok', prepNat.ok === true);
assert('prepare naturgy provider', prepNat.input.provider === 'naturgy');
assert('prepare naturgy amount', prepNat.input.amount === 15669.07);

console.log('\n== Naturgy complete_debts listing ==');
const natAd = global.CM.Providers.Naturgy;
assert('naturgy registered', !!natAd && natAd.id === 'naturgy');
assert(
  'complete_debts url',
  natAd.buildCompleteDebtsUrl('20004193466').indexOf('client_number=20004193466') >= 0 &&
    natAd.buildCompleteDebtsUrl('20004193466').indexOf('gateway=mercadopago') >= 0
);
assert('norm period YYYYMM', natAd.normalizeNaturgyPeriod('202605') === '2026-05');

const jobFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/complete-debts-job.json'), 'utf8')
);
const mappedDebt = natAd.mapDebt(jobFixture.debts[0], jobFixture.account, {
  service_id: 'svc_naturgy_elec',
});
assert('map invoiceNumber', mappedDebt.invoiceNumber === '143292286');
assert('map amount', mappedDebt.amount === 15669.07);
assert('map external_id', mappedDebt.external_id === '17-143292286');
assert('map billingPeriod from issued_on', mappedDebt.billingPeriod === '2026-10');
assert('map dueDate', mappedDebt.dueDate === '2026-11-20');
assert('map downloadable', mappedDebt.downloadable === true);
assert('map autoDownload false until token', mappedDebt.autoDownload === false);
assert(
  'printExternalId is document_number',
  mappedDebt.printExternalId === '143292286'
);
assert(
  'resolve strips 17- prefix',
  natAd.resolvePrintedBillExternalId_({ external_id: '17-143292286' }) === '143292286'
);
assert(
  'printed_bill url uses document_number',
  natAd.buildPrintedBillUrl('20004193466', '143292286').indexOf('external_id=143292286') >= 0
);

const acceptFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/complete-debts-accepted.json'), 'utf8')
);
const sessionsFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/sessions-ok.json'), 'utf8')
);
const printedAccept = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/printed-bill-accepted.json'), 'utf8')
);
const printedJob = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/printed-bill-job.json'), 'utf8')
);

const decodeOk = natAd.decodeBase64Pdf_(printedJob.base64);
assert('decode base64 pdf ok', decodeOk.ok === true, decodeOk.reason);
assert('decode looksLikePdf', global.CM.Pdf.looksLikePdf(decodeOk.blob.getBytes()));

assert(
  'extractJwt access_token',
  natAd.extractJwtFromSessionResponse_({
    body: JSON.stringify(sessionsFixture),
    headers: {},
  }) === sessionsFixture.access_token
);
assert(
  'extractJwt Authorization header',
  natAd.extractJwtFromSessionResponse_({
    body: '{}',
    headers: { Authorization: 'Bearer abc.def.ghi' },
  }) === 'abc.def.ghi'
);

const _origHttpGet3 = global.CM.ProviderInterface.httpGet;
const _origHttpPost3 = global.CM.ProviderInterface.httpPost;
let natGetN = 0;
let natPostN = 0;
let lastAuthHeader = '';
global.CM.ProviderInterface.httpGet = function (url, options) {
  natGetN++;
  const hdrs = (options && options.headers) || {};
  if (hdrs.Authorization) lastAuthHeader = hdrs.Authorization;
  if (String(url).indexOf('complete_debts') >= 0) {
    return {
      ok: true,
      code: 202,
      body: JSON.stringify(acceptFixture),
      contentType: 'application/json',
      headers: {},
    };
  }
  if (String(url).indexOf('printed_bill') >= 0) {
    if (!hdrs.Authorization) {
      return {
        ok: false,
        code: 401,
        body: JSON.stringify({
          errors: [{ status: 401, code: 'not_authorized', message: 'No autorizado' }],
        }),
        contentType: 'application/json',
        headers: {},
      };
    }
    return {
      ok: true,
      code: 202,
      body: JSON.stringify(printedAccept),
      contentType: 'application/json',
      headers: {},
    };
  }
  if (String(url).indexOf('async_request/jobs') >= 0) {
    // debts job vs printed_bill job
    if (String(url).indexOf('job-printed-bill') >= 0 || lastAuthHeader) {
      // After login path uses auth; distinguish by whether Authorization present
      if (hdrs.Authorization) {
        return {
          ok: true,
          code: 200,
          body: JSON.stringify(printedJob),
          contentType: 'application/json',
          headers: {},
        };
      }
    }
    return {
      ok: true,
      code: 200,
      body: JSON.stringify(jobFixture),
      contentType: 'application/json',
      headers: {},
    };
  }
  return { ok: false, code: 404, body: '', contentType: '', headers: {}, error: 'unexpected ' + url };
};
global.CM.ProviderInterface.httpPost = function (url, payload, options) {
  natPostN++;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  // Never assert password value in logs — only that JSON parses and has keys
  const parsed = JSON.parse(body);
  assert('sessions post has email key', typeof parsed.email === 'string' && parsed.email.length > 0);
  assert('sessions post has password key', typeof parsed.password === 'string' && parsed.password.length > 0);
  if (String(url).indexOf('/users/sessions') >= 0) {
    return {
      ok: true,
      code: 200,
      body: JSON.stringify(sessionsFixture),
      contentType: 'application/json',
      headers: {},
    };
  }
  return { ok: false, code: 404, body: '', headers: {}, contentType: '', error: 'unexpected post' };
};

// Clear any leftover auth props
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_EMAIL, '');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_PASSWORD, '');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '');

const natFetched = natAd.fetchInvoices({
  account_number: '20004193466',
  service_id: 'svc_naturgy_elec',
});
assert('naturgy fetch outcome', natFetched.outcome === 'available_not_downloadable', natFetched.outcome);
assert('naturgy fetch count', natFetched.invoices && natFetched.invoices.length === 1);
assert(
  'naturgy fetch amount',
  natFetched.invoices[0].amount === 15669.07,
  String(natFetched.invoices[0] && natFetched.invoices[0].amount)
);
assert('naturgy fetch polled job', natGetN >= 2, String(natGetN));
assert('naturgy manualImport without creds', natFetched.manualImport === true);

const natDl = natAd.downloadInvoice(
  { account_number: '20004193466' },
  natFetched.invoices[0]
);
assert('naturgy download pending without creds', natDl.ok === false);
assert(
  'naturgy download auth outcome',
  natDl.outcome === 'auth_or_captcha_required',
  natDl.outcome
);

// Persist metadata only (no creds → no PDF)
global.CM.Drive = {
  saveInvoicePdf: function () {
    throw new Error('should not save PDF without token');
  },
  parseDriveFileId: global.CM.Drive.parseDriveFileId,
};
const natPersist = global.CM.Invoices.persistProviderFetch({
  providerId: 'naturgy',
  service: { account_number: '20004193466', service_id: 'svc_naturgy_elec' },
  fetched: natFetched,
  download: true,
  preferLatest: true,
  maxDownloads: 1,
});
assert('naturgy persist metadata', natPersist.upserts && natPersist.upserts.length === 1);
assert('naturgy persist pdfCount 0', natPersist.pdfCount === 0);

// Full auto: credentials in Script Properties (fixture secrets only)
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_EMAIL, 'owner-test@example.com');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_PASSWORD, 'fixture-password-not-real');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '');
natGetN = 0;
natPostN = 0;
lastAuthHeader = '';

const login = natAd.loginSessions();
assert('login sessions ok', login.ok === true, login.message);
assert('login returns token', !!login.token && login.token.indexOf('eyJ') === 0);
assert('login posted once', natPostN === 1, String(natPostN));
assert(
  'token cached in props',
  global.CM.Settings.get(global.CM.Settings.KEYS.NATURGY_SESSION_TOKEN) === login.token
);

const natDlOk = natAd.downloadInvoice(
  { account_number: '20004193466' },
  Object.assign({}, natFetched.invoices[0], { naturgyToken: login.token, autoDownload: true })
);
assert('naturgy download ok', natDlOk.ok === true, natDlOk.message);
assert('naturgy download outcome', natDlOk.outcome === 'downloaded_ok');
assert('naturgy download has blob', !!(natDlOk.blob && natDlOk.blob.getBytes));
assert(
  'naturgy Authorization raw JWT (no Bearer)',
  lastAuthHeader === login.token && lastAuthHeader.toLowerCase().indexOf('bearer ') !== 0,
  lastAuthHeader.slice(0, 20)
);

global.CM.Drive = {
  saveInvoicePdf: function (blob, meta) {
    assert('persist pdf magic', global.CM.Pdf.looksLikePdf(blob.getBytes()));
    return {
      ok: true,
      fileId: 'file_naturgy_1',
      url: 'https://drive.example/file_naturgy_1',
      reused: false,
      validation: { ok: true },
    };
  },
  parseDriveFileId: global.CM.Drive.parseDriveFileId,
};
const natFetchedAuth = natAd.fetchInvoices({
  account_number: '20004193466',
  service_id: 'svc_naturgy_elec',
});
assert('naturgy fetch with creds autoDownload', natFetchedAuth.invoices[0].autoDownload === true);
const natPersistPdf = global.CM.Invoices.persistProviderFetch({
  providerId: 'naturgy',
  service: { account_number: '20004193466', service_id: 'svc_naturgy_elec' },
  fetched: natFetchedAuth,
  download: true,
  preferLatest: true,
  maxDownloads: 1,
});
assert('naturgy persist pdfCount 1', natPersistPdf.pdfCount === 1, natPersistPdf.message);
assert(
  'naturgy persist downloaded',
  natPersistPdf.upserts[0].record.invoice_status === 'downloaded'
);

// Cleanup fixture secrets from mem props
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_EMAIL, '');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_PASSWORD, '');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '');

global.CM.ProviderInterface.httpGet = _origHttpGet3;
global.CM.ProviderInterface.httpPost = _origHttpPost3;

assert(
  'detectCaptcha turnstile',
  global.CM.ProviderInterface.detectCaptcha('<div class="cf-turnstile"></div>') === true
);

console.log('\n== Ecogas adapter (captcha / comprobante print) ==');
const ecoAd = global.CM.Providers.Ecogas;
assert('ecogas registered', !!ecoAd && ecoAd.id === 'ecogas');
assert('ecogas print path', ecoAd.printPath.indexOf('impresion_jano.php') >= 0);

const ecoEmpty = ecoAd.extractDetailDownloadCandidates('');
assert('ecogas empty html', ecoEmpty.empty === true && ecoEmpty.candidates.length === 0);
const ecoDetalleHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ecogas', 'panel-detalle-sample.html'),
  'utf8'
);
const ecoLinks = ecoAd.extractDetailDownloadCandidates(ecoDetalleHtml);
assert('ecogas fixture has candidates', ecoLinks.candidates.length >= 3);
assert('ecogas fixture pdfLikely', ecoLinks.pdfLikely === true);

assert('ecogas pad account', ecoAd.padAccountNumber('20259678') === '000020259678');
assert('ecogas pad already 12', ecoAd.padAccountNumber('000020259678') === '000020259678');
const ecoParsed = ecoAd.parseCompoundInvoiceId('0401B60797913A');
assert('ecogas parse pp p', ecoParsed && ecoParsed.p === '0401');
assert('ecogas parse pp d', ecoParsed && ecoParsed.d === '60797913');
assert('ecogas parse pp letter', ecoParsed && ecoParsed.letter === 'B');
assert('ecogas parse pp suffix', ecoParsed && ecoParsed.suffix === 'A');

const ecoPrint = ecoAd.buildPrintFormPayload({
  pp: '0401B60797913A',
  accountNumber: '20259678',
});
assert('ecogas print payload ok', ecoPrint.ok === true);
assert('ecogas print p', ecoPrint.payload.p === '0401');
assert('ecogas print d', ecoPrint.payload.d === '60797913');
assert('ecogas print c padded', ecoPrint.payload.c === '000020259678');
assert('ecogas print t default cuy', ecoPrint.payload.t === 'cuy');
assert('ecogas print i FA', ecoPrint.payload.i === 'FA');
assert('ecogas print logreimp', ecoPrint.payload.logreimp === 'S');
assert('ecogas print m', ecoPrint.payload.m === 'p');
assert('ecogas print pp', ecoPrint.payload.pp === '0401B60797913A');
assert('ecogas print form_pp', ecoPrint.payload.form_pp === 'PP');
assert(
  'ecogas print url',
  ecoPrint.printUrl.indexOf('/uiextranet/res/tra/reimp/impresion_jano.php') >= 0
);
assert(
  'ecogas print via comprobante alias',
  ecoAd.buildPrintFormPayload({
    comprobante: '0401B60797913A',
    accountNumber: '20259678',
  }).ok === true
);
assert(
  'ecogas print missing comprobante',
  ecoAd.buildPrintFormPayload({ p: '0401', d: '60797913', accountNumber: '20259678' }).ok ===
    false
);

const ecoCaptchaHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures/ecogas/login-captcha.html'),
  'utf8'
);
const ecoBrokenHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures/ecogas/login-no-cliente.html'),
  'utf8'
);
const _origHttpGetEco = global.CM.ProviderInterface.httpGet;
global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: true,
    code: 200,
    body: ecoCaptchaHtml,
    contentType: 'text/html',
    headers: {},
  };
};
const ecoAvail = ecoAd.checkAvailability({ account_number: '20259678' });
assert('ecogas captcha outcome', ecoAvail.outcome === 'auth_or_captcha_required', ecoAvail.outcome);
assert('ecogas captcha flag', ecoAvail.captcha === true);

const ecoFetchNoPp = ecoAd.fetchInvoices({ account_number: '20259678' });
assert(
  'ecogas fetch without comprobante → no anonymous listing',
  ecoFetchNoPp.invoices.length === 0 &&
    ecoFetchNoPp.manualImport === true &&
    ecoFetchNoPp.listingRequiresAuth === true &&
    (ecoFetchNoPp.outcome === 'auth_or_captcha_required' ||
      ecoFetchNoPp.outcome === 'portal_inaccessible')
);

global.CM.Settings.set(global.CM.Settings.KEYS.ECOGAS_PRINT_PP, '0401B60797913A');
const ecoFetchReady = ecoAd.fetchInvoices({ account_number: '20259678' });
assert('ecogas fetch ready count', ecoFetchReady.invoices.length === 1);
assert('ecogas fetch ready pp', ecoFetchReady.invoices[0].pp === '0401B60797913A');
assert('ecogas fetch ready autoDownload', ecoFetchReady.invoices[0].autoDownload === true);
assert(
  'ecogas fetch leaves amount null until PDF parse',
  ecoFetchReady.invoices[0].amount == null
);
assert('ecogas fetch no listing used', ecoFetchReady.usedListing === false);

console.log('\n== ecogas PDF metadata parse ==');
const ecoTextSample = fs.readFileSync(
  path.join(__dirname, 'fixtures/ecogas/factura-text-sample.txt'),
  'utf8'
);
const ecoMetaText = ecoAd.parseInvoiceMetadataFromText(ecoTextSample);
assert('ecogas text amount 336.56', ecoMetaText.amount === 336.56, String(ecoMetaText.amount));
assert(
  'ecogas text issueDate',
  ecoMetaText.issueDate === '14/10/2026',
  ecoMetaText.issueDate
);
assert('ecogas text dueDate', ecoMetaText.dueDate === '26/10/2026', ecoMetaText.dueDate);
assert(
  'ecogas text ignores TOTAL FACTURA 3666.93',
  ecoMetaText.amount !== 3666.93
);
assert(
  'ecogas text empty → no invent',
  ecoAd.parseInvoiceMetadataFromText('').amount == null
);

const ecoSnippetPdf = fs.readFileSync(
  path.join(__dirname, 'fixtures/ecogas/factura-snippet.pdf')
);
const ecoEmbed = global.CM.Pdf.extractEmbeddedText(ecoSnippetPdf);
assert('ecogas snippet embed has IMPORTE', /IMPORTE/i.test(ecoEmbed), ecoEmbed.slice(0, 120));
assert('ecogas snippet embed has 336.56', /336\.56/.test(ecoEmbed));
const ecoMetaPdf = ecoAd.extractInvoiceMetadataFromPdf(ecoSnippetPdf);
assert('ecogas pdf amount', ecoMetaPdf.amount === 336.56, String(ecoMetaPdf.amount));
assert('ecogas pdf issueDate', ecoMetaPdf.issueDate === '14/10/2026');
assert('ecogas pdf dueDate', ecoMetaPdf.dueDate === '26/10/2026');

const _ecoHttpPost = global.CM.ProviderInterface.httpPost;
global.CM.ProviderInterface.httpPost = function (url, payload, options) {
  assert(
    'ecogas print post no cookie required',
    !(options && options.headers && options.headers.Cookie)
  );
  assert('ecogas print post payload pp', payload && payload.pp === '0401B60797913A');
  return {
    ok: true,
    code: 200,
    body: '',
    contentType: 'application/pdf',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="factura-debito-ECOGAS-nro-0401-60797913-000020259678-cuy.pdf"',
    },
    blob: {
      getBytes: function () {
        return Array.prototype.slice.call(ecoSnippetPdf);
      },
    },
  };
};
const ecoDl = ecoAd.downloadInvoice(
  { account_number: '20259678' },
  { pp: '0401B60797913A', autoDownload: true, ecogasPrint: true }
);
assert('ecogas download ok without cookie', ecoDl.ok === true && ecoDl.outcome === 'downloaded_ok');
assert('ecogas download pdfMagic', ecoDl.pdfMagic === true);
assert('ecogas download has blob', !!ecoDl.blob);
assert('ecogas download usedCookie false', ecoDl.usedCookie === false);
assert('ecogas download amount from PDF', ecoDl.amount === 336.56, String(ecoDl.amount));
assert('ecogas download dueDate from PDF', ecoDl.dueDate === '26/10/2026');
assert('ecogas download issueDate from PDF', ecoDl.issueDate === '14/10/2026');

const _ppSaved = global.CM.Settings.get(global.CM.Settings.KEYS.ECOGAS_PRINT_PP, '');
global.CM.Settings.set(global.CM.Settings.KEYS.ECOGAS_PRINT_PP, '');
const ecoDlMissing = ecoAd.downloadInvoice({ account_number: '20259678' }, {});
assert(
  'ecogas download missing comprobante error',
  ecoDlMissing.ok === false &&
    (ecoDlMissing.outcome === 'missing_property_info' ||
      ecoDlMissing.reason === 'missing_pp' ||
      /comprobante|pp/i.test(ecoDlMissing.message || ''))
);
global.CM.Settings.set(global.CM.Settings.KEYS.ECOGAS_PRINT_PP, _ppSaved);

const ecoProbeNoCookie = ecoAd.probePrintPdf({
  pp: '0401B60797913A',
  accountNumber: '20259678',
});
assert('ecogas probe print ok without cookie', ecoProbeNoCookie.ok === true);

const _ecoSave = global.CM.Drive.saveInvoicePdf;
const _ecoSheetsFind = global.CM.Sheets.findInvoiceById;
const _ecoSheetsAppend = global.CM.Sheets.appendRow;
global.CM.Drive.saveInvoicePdf = function () {
  return {
    ok: true,
    fileId: 'file_eco_1',
    url: 'https://drive/eco',
    reused: false,
    validation: { ok: true },
  };
};
global.CM.Sheets.findInvoiceById = function () {
  return null;
};
let ecoAppended = 0;
let ecoAppendedRecord = null;
global.CM.Sheets.appendRow = function (sheet, row) {
  ecoAppended++;
  ecoAppendedRecord = row;
};
const ecoPersist = global.CM.Invoices.persistProviderFetch({
  providerId: 'ecogas',
  service: { account_number: '20259678', service_id: 'svc_eco' },
  fetched: ecoFetchReady,
  download: true,
  billingPeriod: global.CM.Dates.currentBillingPeriod(),
  maxDownloads: 1,
});
assert('ecogas persist pdfCount', ecoPersist.pdfCount === 1);
assert('ecogas persist appended', ecoAppended === 1);
assert('ecogas persist outcome downloaded', ecoPersist.outcome === 'downloaded_ok');
assert(
  'ecogas persist amount populated',
  ecoPersist.upserts[0] &&
    ecoPersist.upserts[0].record &&
    ecoPersist.upserts[0].record.amount === 336.56,
  String(ecoPersist.upserts[0] && ecoPersist.upserts[0].record && ecoPersist.upserts[0].record.amount)
);
assert(
  'ecogas persist due_date populated',
  ecoPersist.upserts[0].record.due_date === '2026-10-26',
  String(ecoPersist.upserts[0].record.due_date)
);
assert(
  'ecogas persist issue_date populated',
  ecoPersist.upserts[0].record.issue_date === '2026-10-14',
  String(ecoPersist.upserts[0].record.issue_date)
);
assert(
  'ecogas persist append row amount',
  ecoAppendedRecord && ecoAppendedRecord.amount === 336.56
);

global.CM.ProviderInterface.httpPost = _ecoHttpPost;
global.CM.Drive.saveInvoicePdf = _ecoSave;
global.CM.Sheets.findInvoiceById = _ecoSheetsFind;
global.CM.Sheets.appendRow = _ecoSheetsAppend;
global.CM.Settings.set(global.CM.Settings.KEYS.ECOGAS_SESSION_COOKIE, '');
global.CM.Settings.set(global.CM.Settings.KEYS.ECOGAS_PRINT_PP, '');

global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: true,
    code: 200,
    body: ecoBrokenHtml,
    contentType: 'text/html',
    headers: {},
  };
};
const ecoStruct = ecoAd.checkAvailability({ account_number: '20259678' });
assert(
  'ecogas structure changed',
  ecoStruct.outcome === 'portal_structure_changed',
  ecoStruct.outcome
);

global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: false,
    code: 0,
    outcome: 'portal_inaccessible',
    error: 'ENOTFOUND',
    body: '',
    headers: {},
  };
};
const ecoDown = ecoAd.checkAvailability({});
assert('ecogas portal down', ecoDown.outcome === 'portal_inaccessible');
global.CM.ProviderInterface.httpGet = _origHttpGetEco;

console.log('\n== OSSE failure paths ==');
const osseAd2 = global.CM.Providers.Osse;
const _origHttpGetOsseFail = global.CM.ProviderInterface.httpGet;
global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: false,
    code: 503,
    outcome: 'portal_inaccessible',
    error: 'HTTP 503',
    body: '',
    headers: {},
  };
};
const osseDown = osseAd2.fetchInvoices({ account_number: '119 0080934 000 1' });
assert(
  'osse api down honest',
  osseDown.outcome === 'portal_inaccessible' || osseDown.outcome === 'error',
  osseDown.outcome
);
assert('osse down no invoices', !osseDown.invoices || osseDown.invoices.length === 0);
const osseMissing = osseAd2.fetchInvoices({ account_number: '' });
assert(
  'osse missing account',
  osseMissing.outcome === 'missing_property_info' ||
    (osseMissing.message && /account|cuenta|falt/i.test(osseMissing.message)),
  osseMissing.outcome
);
global.CM.ProviderInterface.httpGet = function () {
  return {
    ok: true,
    code: 200,
    body: '<html><body>g-recaptcha</body></html>',
    contentType: 'text/html',
    headers: {},
  };
};
// If OSSE hits captcha on unidad lookup path
const osseCap = osseAd2.fetchInvoices({ account_number: '11900809340001' });
assert(
  'osse unexpected captcha or structure',
  osseCap.outcome === 'auth_or_captcha_required' ||
    osseCap.outcome === 'portal_structure_changed' ||
    osseCap.outcome === 'portal_inaccessible' ||
    osseCap.outcome === 'error',
  osseCap.outcome
);
global.CM.ProviderInterface.httpGet = _origHttpGetOsseFail;

console.log('\n== Municipalidad failure paths ==');
const muniAd2 = global.CM.Providers.Municipalidad;
const muniNoCat = muniAd2.fetchInvoices({
  enabled: true,
  cadastral_number: '',
  account_number: '',
});
assert(
  'muni missing cadastral',
  muniNoCat.outcome === 'missing_property_info',
  muniNoCat.outcome
);
const muniDisabled2 = muniAd2.fetchInvoices({
  enabled: false,
  cadastral_number: '322047490000',
});
assert('muni disabled again', muniDisabled2.outcome === 'disabled');

console.log('\n== Naturgy login failure ==');
const sessionsFail = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/naturgy/sessions-fail.json'), 'utf8')
);
const _origHttpPostFail = global.CM.ProviderInterface.httpPost;
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_EMAIL, 'bad@example.com');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_PASSWORD, 'wrong');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_SESSION_TOKEN, '');
global.CM.ProviderInterface.httpPost = function () {
  return {
    ok: false,
    code: 401,
    body: JSON.stringify(sessionsFail),
    contentType: 'application/json',
    headers: {},
  };
};
const loginFail = global.CM.Providers.Naturgy.loginSessions();
assert('naturgy login fail ok=false', loginFail.ok === false);
assert(
  'naturgy login fail auth outcome',
  loginFail.outcome === 'auth_or_captcha_required',
  loginFail.outcome
);
assert(
  'naturgy login fail message no password echo',
  !!(loginFail.message && loginFail.message.indexOf('wrong') < 0)
);
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_EMAIL, '');
global.CM.Settings.set(global.CM.Settings.KEYS.NATURGY_PASSWORD, '');
global.CM.ProviderInterface.httpPost = _origHttpPostFail;

console.log('\n== Provider registry smoke ==');
global.CM.ProviderInterface.bootstrap();
const listed = global.CM.ProviderInterface.list().sort();
assert(
  'all four providers registered',
  listed.indexOf('ecogas') >= 0 &&
    listed.indexOf('osse') >= 0 &&
    listed.indexOf('naturgy') >= 0 &&
    listed.indexOf('municipalidad') >= 0,
  listed.join(',')
);

console.log('\n== properties slug / service / contact shaping ==');
{
  const P = global.CM.Properties;
  assert('slugify basic', P.slugify('Casa Centro Caucete') === 'casa-centro-caucete');
  assert(
    'slugify accents',
    P.slugify('Natania XV — Manzana 6') === 'natania-xv-manzana-6'
  );
  const a1 = P.allocatePropertyId('Casa Demo', ['casa-demo']);
  assert('allocate collision suffix', a1.collided === true && a1.property_id === 'casa-demo-2');
  const a2 = P.allocatePropertyId('Casa Nueva', ['natania-xv-m6c1']);
  assert('allocate unique', a2.collided === false && a2.property_id === 'casa-nueva');
  const a3 = P.allocatePropertyId('Casa Demo', ['casa-demo', 'casa-demo-2'], 'norte');
  assert(
    'allocate preferred suffix',
    a3.property_id === 'casa-demo-norte',
    a3.property_id
  );

  const nat = P.shapeServiceRow('casa-nueva', 'naturgy', {
    account_number: '20009999999',
    secondary_identifier: '111',
  });
  assert('naturgy provider', nat.row.provider === 'naturgy' && nat.row.service_type === 'electricity');
  assert('naturgy property_id', nat.row.property_id === 'casa-nueva');
  assert('naturgy enabled', nat.row.enabled === true);
  assert('naturgy account', nat.row.account_number === '20009999999');
  assert('naturgy medidor secondary', nat.row.secondary_identifier === '111');

  const muniRiv = P.shapeServiceRow('casa-nueva', 'municipalidad', {
    municipio: 'Rivadavia',
    cadastral_number: '322047490000',
  });
  assert(
    'muni rivadavia portal',
    /deudavencida/i.test(muniRiv.row.portal_url),
    muniRiv.row.portal_url
  );
  assert('muni rivadavia secondary=label', muniRiv.row.secondary_identifier === 'Rivadavia');
  assert(
    'muni rivadavia notes municipio',
    String(muniRiv.row.notes).indexOf('municipio=Rivadavia') >= 0
  );

  const muniCau = P.shapeServiceRow('casa-caucete', 'municipalidad', {
    municipio: 'Caucete',
    cadastral_number: '',
  });
  assert(
    'muni caucete no rivadavia portal',
    !/181\.209\.107\.110|deudavencida/i.test(muniCau.row.portal_url || ''),
    muniCau.row.portal_url
  );
  assert('muni caucete secondary', muniCau.row.secondary_identifier === 'Caucete');
  assert(
    'muni caucete unsupported note',
    /unsupported_municipio/i.test(muniCau.row.notes),
    muniCau.row.notes
  );
  assert('muni caucete needsAttention', muniCau.needsAttention.length > 0);

  const contact = P.shapeContactRow('casa-caucete', {
    role: 'tenant',
    name: 'Inquilino X',
    email: 't@example.com',
    telegram: '123',
    active: true,
  }, 1);
  assert('contact property_id not natania', contact.property_id === 'casa-caucete');
  assert('contact role tenant', contact.role === 'tenant');
  assert('contact active', contact.active === true);

  let badRole = false;
  try {
    P.shapeContactRow('casa-caucete', { role: 'guest', name: 'x' }, 1);
  } catch (e) {
    badRole = true;
  }
  assert('contact rejects bad role', badRole);

  // In-memory Sheets for addProperty (no live HTTP / Drive)
  const store = { Properties: [], Services: [], Contacts: [], Configuration: [] };
  const _list = global.CM.Sheets.list;
  const _append = global.CM.Sheets.appendRow;
  const _setConfig = global.CM.Sheets.setConfig;
  global.CM.Sheets.SHEET_NAMES = Object.assign({}, global.CM.Sheets.SHEET_NAMES, {
    PROPERTIES: 'Properties',
    SERVICES: 'Services',
    CONTACTS: 'Contacts',
    CONFIGURATION: 'Configuration',
  });
  global.CM.Sheets.list = function (name) {
    return (store[name] || []).map(function (r) {
      return Object.assign({}, r);
    });
  };
  global.CM.Sheets.appendRow = function (name, obj) {
    store[name] = store[name] || [];
    store[name].push(Object.assign({}, obj));
  };
  global.CM.Sheets.setConfig = function (key, value, notes) {
    store.Configuration.push({ key: key, value: value, notes: notes || '' });
  };
  // Seed existing Natania so we don't collide and prove contacts aren't reused
  store.Properties.push({ property_id: 'natania-xv-m6c1', property_name: 'Natania XV' });
  store.Contacts.push({
    contact_id: 'owner_1',
    property_id: 'natania-xv-m6c1',
    role: 'owner',
    name: 'Owner Natania',
  });

  const added = P.addProperty({
    property_name: 'Casa Caucete Norte',
    address: 'Calle 1',
    city: 'Caucete',
    province: 'San Juan',
    notes: 'alta test',
    createDriveFolder: false,
    services: [
      { provider: 'ecogas', account_number: '20259999' },
      { provider: 'municipalidad', municipio: 'Caucete', cadastral_number: 'ABC' },
    ],
    contacts: [
      { role: 'owner', name: 'Dueño C', email: 'o@c.com', active: true },
      { role: 'tenant', name: 'Inq C', email: 't@c.com', active: true },
    ],
  });
  assert('addProperty ok', added.ok === true, JSON.stringify(added));
  assert(
    'addProperty id slug',
    added.property_id === 'casa-caucete-norte',
    added.property_id
  );
  assert('addProperty services rows', added.services.length === 2);
  assert(
    'addProperty contacts bound to new id',
    added.contacts.length === 2 &&
      added.contacts.every(function (c) {
        return c.property_id === 'casa-caucete-norte';
      })
  );
  assert(
    'addProperty did not clone natania contacts',
    store.Contacts.filter(function (c) {
      return c.property_id === 'casa-caucete-norte';
    }).length === 2
  );
  assert(
    'addProperty notes in config',
    store.Configuration.some(function (c) {
      return c.key === 'property_notes_casa-caucete-norte' && c.value === 'alta test';
    })
  );

  const collision = P.addProperty({
    property_id: 'casa-caucete-norte',
    property_name: 'Dup',
    createDriveFolder: false,
  });
  assert('addProperty collision', collision.ok === false && collision.reason === 'property_id_collision');

  const svcAdd = P.addPropertyService('casa-caucete-norte', {
    provider: 'osse',
    account_number: '119 0000000 000 1',
  });
  assert('addPropertyService ok', svcAdd.ok && svcAdd.service.provider === 'osse');
  assert('addPropertyService property_id', svcAdd.service.property_id === 'casa-caucete-norte');

  const ctAdd = P.addPropertyContact('casa-caucete-norte', {
    role: 'tenant',
    name: 'Otro inq',
    email: 't2@c.com',
  });
  assert('addPropertyContact ok', ctAdd.ok && ctAdd.contact.property_id === 'casa-caucete-norte');

  assert(
    'isMunicipalidadSupported rivadavia',
    P.isMunicipalidadSupported({
      secondary_identifier: 'Rivadavia',
      portal_url: 'http://181.209.107.110:83/deudavencida/deuda_total.aspx',
    }) === true
  );
  assert(
    'isMunicipalidadSupported caucete false',
    P.isMunicipalidadSupported({
      secondary_identifier: 'Caucete',
      portal_url: '',
      notes: 'municipio=Caucete',
    }) === false
  );

  // Adapter path: unsupported_municipio without HTTP
  const muniStatus = global.CM.Providers.Municipalidad.checkAvailability({
    enabled: true,
    secondary_identifier: 'Caucete',
    cadastral_number: 'XYZ',
    portal_url: '',
    notes: 'municipio=Caucete',
  });
  assert(
    'muni checkAvailability unsupported',
    muniStatus.outcome === 'unsupported_municipio',
    muniStatus.outcome
  );
  const muniFetch = global.CM.Providers.Municipalidad.fetchInvoices({
    enabled: true,
    secondary_identifier: 'Caucete',
    cadastral_number: 'XYZ',
  });
  assert(
    'muni fetchInvoices unsupported',
    muniFetch.outcome === 'unsupported_municipio' &&
      (!muniFetch.invoices || muniFetch.invoices.length === 0),
    muniFetch.outcome
  );
  assert(
    'OUTCOME has UNSUPPORTED_MUNICIPIO',
    global.CM.ProviderInterface.OUTCOME.UNSUPPORTED_MUNICIPIO === 'unsupported_municipio'
  );

  global.CM.Sheets.list = _list;
  global.CM.Sheets.appendRow = _append;
  global.CM.Sheets.setConfig = _setConfig;
}

console.log('\n== telegram owner bot ==');
{
  const Bot = global.CM.TelegramBot;
  assert('bot module loaded', !!Bot && typeof Bot.handleUpdate === 'function');

  const ownerContact = {
    contact_id: 'owner_1',
    property_id: 'natania-xv-m6c1',
    role: 'owner',
    name: 'Franco',
    email: 'owner@example.com',
    telegram: '111222',
    active: true,
  };
  const tenantContact = {
    contact_id: 'tenant_1',
    property_id: 'natania-xv-m6c1',
    role: 'tenant',
    name: 'Inquilino',
    email: 'tenant@example.com',
    telegram: '999888',
    active: true,
  };
  const inactiveOwner = {
    contact_id: 'owner_x',
    property_id: 'natania-xv-m6c1',
    role: 'owner',
    name: 'Ex',
    telegram: '555',
    active: false,
  };

  assert(
    'auth finds owner by chat',
    Bot.findOwnerByChatId('111222', [ownerContact, tenantContact]).name === 'Franco'
  );
  assert(
    'auth rejects tenant chat',
    Bot.findOwnerByChatId('999888', [ownerContact, tenantContact]) == null
  );
  assert(
    'auth rejects inactive owner',
    Bot.findOwnerByChatId('555', [inactiveOwner]) == null
  );
  assert('isAuthorizedOwner owner', Bot.isAuthorizedOwner(ownerContact) === true);
  assert('isAuthorizedOwner tenant false', Bot.isAuthorizedOwner(tenantContact) === false);

  const denied = Bot.handleUpdate(
    { message: { chat: { id: 999888 }, text: '/start' } },
    { silent: true, contacts: [ownerContact, tenantContact] }
  );
  assert('non-owner rejected', denied.authorized === false);
  assert(
    'non-owner no-access copy',
    denied.replies && denied.replies[0] && /no tenés acceso/i.test(denied.replies[0].text)
  );
  assert(
    'non-owner no invoice leak',
    !/factura|monto|luz|gas/i.test((denied.replies[0] && denied.replies[0].text) || '')
  );

  assert('label luz', Bot.providerLabelEs('naturgy') === 'luz');
  assert('label gas', Bot.providerLabelEs('ecogas') === 'gas');
  assert('label agua', Bot.providerLabelEs('osse') === 'agua');
  assert('label muni', Bot.providerLabelEs('municipalidad') === 'municipalidad');
  assert('status pagada', Bot.paymentStatusLabelEs('paid') === 'pagada');
  assert('status pendiente', Bot.paymentStatusLabelEs('pending') === 'pendiente de pago');

  const sampleInvs = [
    {
      provider: 'naturgy',
      amount: 15000.5,
      due_date: '2026-11-20',
      payment_status: 'pending',
      invoice_file_url: 'https://drive.example/luz.pdf',
      billing_period: '2026-11',
    },
    {
      provider: 'osse',
      amount: 38247.31,
      due_date: '15/12/2026',
      payment_status: 'paid',
      billing_period: '2026-11',
    },
  ];
  const monthFmt = Bot.formatMonthListing(sampleInvs, '2026-11');
  assert('month listing has luz', /luz/i.test(monthFmt.text));
  assert('month listing has agua', /agua/i.test(monthFmt.text));
  assert('month listing total', monthFmt.total != null && monthFmt.total > 50000);
  assert('month listing flags missing gas', monthFmt.missing.indexOf('gas') >= 0);
  assert('month listing gentle gas hint', /falta el gas|comprobante/i.test(monthFmt.text));
  assert('month listing no invoice_id', !Bot.containsTechnicalJargon(monthFmt.text));
  assert('month listing PDF link', /drive\.example\/luz\.pdf/.test(monthFmt.text));
  assert('month listing plain paid', /pagada/.test(monthFmt.text));

  const emptyHist = Bot.formatHistoryListing([], '2026-01');
  assert('history empty friendly', /no hay facturas/i.test(emptyHist.text));
  assert('history empty no jargon', !Bot.containsTechnicalJargon(emptyHist.text));

  const histFmt = Bot.formatHistoryListing(sampleInvs, '2026-11');
  assert('history has total', histFmt.total != null);

  // Month command via handleUpdate + mocked Sheets.list
  const _listBot = global.CM.Sheets.list;
  global.CM.Sheets.list = function (name) {
    if (name === 'Invoices') {
      return sampleInvs.concat([
        {
          provider: 'ecogas',
          amount: 336.56,
          due_date: '2026-10-26',
          payment_status: 'unknown',
          billing_period: '2026-10',
          invoice_id: 'inv_eco_old',
        },
      ]);
    }
    if (name === 'Contacts') return [ownerContact, tenantContact];
    return [];
  };
  // Force current period to 2026-11 for deterministic month listing
  const _cur = global.CM.Dates.currentBillingPeriod;
  global.CM.Dates.currentBillingPeriod = function () {
    return '2026-11';
  };

  const monthUpd = Bot.handleUpdate(
    { message: { chat: { id: 111222 }, text: '/mes' } },
    { silent: true, contacts: [ownerContact] }
  );
  assert('month cmd authorized', monthUpd.authorized === true);
  assert(
    'month cmd lists luz',
    monthUpd.replies && /luz/i.test(monthUpd.replies[0].text)
  );

  // History filter + total
  Bot.clearSession('111222');
  const histStart = Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq1',
        data: 'm:hist',
        message: { chat: { id: 111222 }, message_id: 1 },
      },
    },
    { silent: true, contacts: [ownerContact] }
  );
  assert('history start asks period', /qué mes/i.test(histStart.replies[0].text));
  const histPrev = Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq2',
        data: 'm:hist:prev',
        message: { chat: { id: 111222 }, message_id: 2 },
      },
    },
    { silent: true, contacts: [ownerContact] }
  );
  assert(
    'history prev shows oct gas',
    histPrev.replies && /gas/i.test(histPrev.replies[0].text) && /336/.test(histPrev.replies[0].text)
  );
  assert(
    'history prev has total',
    /total/i.test(histPrev.replies[0].text)
  );

  // Ecogas comprobante handler (mocked download)
  Bot.clearSession('111222');
  Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq3',
        data: 'm:eco',
        message: { chat: { id: 111222 }, message_id: 3 },
      },
    },
    { silent: true, contacts: [ownerContact] }
  );
  let ecoCalledWith = null;
  const ecoDone = Bot.handleUpdate(
    { message: { chat: { id: 111222 }, text: '0401B60797913A' } },
    {
      silent: true,
      contacts: [ownerContact],
      downloadEcogas: function (comp) {
        ecoCalledWith = comp;
        return {
          ok: true,
          autoPdf: true,
          record: {
            provider: 'ecogas',
            amount: 336.56,
            due_date: '2026-10-26',
            issue_date: '2026-10-14',
            invoice_file_url: 'https://drive.example/gas.pdf',
          },
        };
      },
    }
  );
  assert('ecogas called with comprobante', ecoCalledWith === '0401B60797913A');
  assert('ecogas success Spanish', /listo.*gas/i.test(ecoDone.replies[0].text));
  assert('ecogas shows amount', /336/.test(ecoDone.replies[0].text));
  assert('ecogas no PP jargon', !/\bPP\b|\bpp\b/.test(ecoDone.replies[0].text));
  assert('ecogas no technical jargon', !Bot.containsTechnicalJargon(ecoDone.replies[0].text));

  // Mark paid (mocked registerPayment)
  Bot.clearSession('111222');
  global.CM.Sheets.list = function (name) {
    if (name === 'Invoices') {
      return [
        {
          invoice_id: 'inv_luz_1',
          provider: 'naturgy',
          amount: 15000,
          due_date: '2026-11-20',
          payment_status: 'pending',
          billing_period: '2026-11',
        },
        {
          invoice_id: 'inv_agua_1',
          provider: 'osse',
          amount: 1000,
          due_date: '2026-11-15',
          payment_status: 'paid',
          billing_period: '2026-11',
        },
      ];
    }
    return [];
  };
  global.CM.Sheets.findInvoiceById = function (id) {
    if (id === 'inv_luz_1') {
      return {
        invoice_id: 'inv_luz_1',
        provider: 'naturgy',
        amount: 15000,
        payment_status: 'pending',
        billing_period: '2026-11',
        __row: 2,
      };
    }
    return null;
  };
  Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq4',
        data: 'm:paid',
        message: { chat: { id: 111222 }, message_id: 4 },
      },
    },
    { silent: true, contacts: [ownerContact] }
  );
  const paidPeriod = Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq5',
        data: 'm:paid:cur',
        message: { chat: { id: 111222 }, message_id: 5 },
      },
    },
    { silent: true, contacts: [ownerContact] }
  );
  assert(
    'mark paid prompt',
    /marcar como pagada/i.test(paidPeriod.replies[0].text)
  );
  const paidKb = JSON.stringify(
    (paidPeriod.replies[0] && paidPeriod.replies[0].replyMarkup) || {}
  );
  assert('mark paid keyboard has pick', paidKb.indexOf('pay:0') >= 0);
  assert('mark paid keyboard labels luz', /luz/i.test(paidKb));
  let paidInput = null;
  const paidDone = Bot.handleUpdate(
    {
      callback_query: {
        id: 'cq6',
        data: 'pay:0',
        message: { chat: { id: 111222 }, message_id: 6 },
      },
    },
    {
      silent: true,
      contacts: [ownerContact],
      registerPayment: function (input) {
        paidInput = input;
        return {
          payment: {
            payment_id: 'pay_x',
            invoice_id: input.invoice_id,
            amount: 15000,
            payment_date: '2026-11-06',
            provider: 'naturgy',
          },
          invoice: {
            invoice_id: input.invoice_id,
            provider: 'naturgy',
            amount: 15000,
            payment_status: 'paid',
          },
        };
      },
    }
  );
  assert('mark paid called registerPayment', paidInput && paidInput.invoice_id === 'inv_luz_1');
  assert('mark paid confirm Spanish', /marcada como pagada/i.test(paidDone.replies[0].text));
  assert('mark paid no invoice_id in copy', !Bot.containsTechnicalJargon(paidDone.replies[0].text));

  // Add-property dialog state machine + Caucete path
  Bot.clearSession('111222');
  let session = {
    flow: 'add_property',
    step: 'name',
    data: { servicesSelected: {}, services: [], contacts: [] },
  };
  let adv = Bot.advanceAddProperty(session, { text: 'Casa Caucete Test' });
  assert('add prop step address', adv.session.step === 'address');
  adv = Bot.advanceAddProperty(adv.session, { text: 'Calle Falsa 123' });
  assert('add prop step city', adv.session.step === 'city');
  adv = Bot.advanceAddProperty(adv.session, { text: 'Caucete' });
  assert('add prop step province', adv.session.step === 'province');
  adv = Bot.advanceAddProperty(adv.session, { text: 'San Juan' });
  assert('add prop step services', adv.session.step === 'services');
  adv = Bot.advanceAddProperty(adv.session, { callback: 'ap:svc:municipalidad' });
  assert(
    'add prop toggled muni',
    adv.session.data.servicesSelected.municipalidad === true
  );
  adv = Bot.advanceAddProperty(adv.session, { callback: 'ap:svc:done' });
  assert('add prop ask municipio', adv.session.step === 'svc_muni_municipio');
  assert('add prop municipio copy mentions Caucete', /Caucete/i.test(adv.reply.text));
  adv = Bot.advanceAddProperty(adv.session, { text: 'Caucete' });
  assert('add prop ask cadastral', adv.session.step === 'svc_muni_cadastral');
  adv = Bot.advanceAddProperty(adv.session, { text: '-' });
  assert('add prop after muni → contact role', adv.session.step === 'contact_role');
  adv = Bot.advanceAddProperty(adv.session, { callback: 'ap:role:owner' });
  adv = Bot.advanceAddProperty(adv.session, { text: 'Dueño Caucete' });
  adv = Bot.advanceAddProperty(adv.session, { text: 'dueno@example.com' });
  adv = Bot.advanceAddProperty(adv.session, { text: '111222' });
  assert('add prop more contacts', adv.session.step === 'more_contacts');

  let addPayload = null;
  const finish = Bot.advanceAddProperty(
    adv.session,
    { callback: 'ap:more:no' },
    {
      addProperty: function (input) {
        addPayload = input;
        return {
          ok: true,
          property_id: 'casa-caucete-test',
          property: {
            property_id: 'casa-caucete-test',
            property_name: input.property_name,
            city: input.city,
          },
          services: input.services.map(function (s) {
            return { provider: s.provider, secondary_identifier: s.municipio || '' };
          }),
          contacts: input.contacts,
          needsAttention: [
            'unsupported_municipio — falta discovery de portal Caucete; usar Importar PDF manual.',
          ],
        };
      },
    }
  );
  assert('add prop finished', finish.done === true && finish.result && finish.result.ok);
  assert(
    'add prop payload name',
    addPayload && addPayload.property_name === 'Casa Caucete Test'
  );
  assert(
    'add prop payload city Caucete',
    addPayload && addPayload.city === 'Caucete'
  );
  assert(
    'add prop muni service',
    !!(
      addPayload &&
      addPayload.services.length === 1 &&
      addPayload.services[0].provider === 'municipalidad' &&
      addPayload.services[0].municipio === 'Caucete'
    )
  );
  assert(
    'add prop contact bound in payload',
    !!(
      addPayload &&
      addPayload.contacts[0].role === 'owner' &&
      addPayload.contacts[0].name === 'Dueño Caucete'
    )
  );
  assert(
    'add prop friendly Caucete note',
    !!(finish.reply && /municipal/i.test(finish.reply.text) && /mano/i.test(finish.reply.text))
  );
  assert(
    'add prop reply no jargon',
    !!(finish.reply && !Bot.containsTechnicalJargon(finish.reply.text))
  );

  // Full handleUpdate add-property path briefly: /cancelar clears
  Bot.setSession('111222', { flow: 'add_property', step: 'name', data: {}, updatedAt: Date.now() });
  const cancelled = Bot.handleUpdate(
    { message: { chat: { id: 111222 }, text: '/cancelar' } },
    { silent: true, contacts: [ownerContact] }
  );
  assert('cancel clears flow', /cancelé/i.test(cancelled.replies[0].text));
  assert('cancel session gone', Bot.getSession('111222') == null);

  // Session timeout (setSession refreshes updatedAt — test helper with raw object)
  assert(
    'session expired helper',
    Bot.isSessionExpired(
      { flow: 'ecogas', updatedAt: Date.now() - Bot.SESSION_TTL_MS - 1000 },
      Date.now()
    ) === true
  );
  assert(
    'session fresh not expired',
    Bot.isSessionExpired({ flow: 'ecogas', updatedAt: Date.now() }, Date.now()) === false
  );
  Bot.clearSession('111222');

  // Copy audit: all COPY values + formatters
  const copyKeys = Object.keys(Bot.COPY);
  let jargonHits = 0;
  copyKeys.forEach(function (k) {
    if (Bot.containsTechnicalJargon(Bot.COPY[k])) jargonHits++;
  });
  assert('COPY strings jargon-free', jargonHits === 0, 'hits=' + jargonHits);

  const helpUpd = Bot.handleUpdate(
    { message: { chat: { id: 111222 }, text: '/ayuda' } },
    { silent: true, contacts: [ownerContact] }
  );
  assert('ayuda menu', /asistente del propietario/i.test(helpUpd.replies[0].text));
  assert('ayuda no jargon', !Bot.containsTechnicalJargon(helpUpd.replies[0].text));

  // Unknown chat id (not in contacts at all)
  const stranger = Bot.handleUpdate(
    { message: { chat: { id: 424242 }, text: '/mes' } },
    { silent: true, contacts: [ownerContact] }
  );
  assert('stranger denied', stranger.authorized === false);

  // formatEcogasResult / formatMarkPaidResult unit
  const ecoFmt = Bot.formatEcogasResult({
    ok: true,
    autoPdf: true,
    record: { amount: 100, due_date: '2026-11-01', invoice_file_url: 'https://x' },
  });
  assert('eco format ok', ecoFmt.ok && /gas/i.test(ecoFmt.text));
  const paidFmt = Bot.formatMarkPaidResult(
    {
      ok: true,
      payment: { amount: 100, payment_date: '2026-11-06', provider: 'osse' },
      invoice: { provider: 'osse' },
    },
    null
  );
  assert('paid format ok', /pagada/i.test(paidFmt) && /agua/i.test(paidFmt));

  // Offset + poll batching (no live network)
  assert(
    'nextOffset empty keeps current',
    Bot.nextOffsetFromUpdates(10, []) === 10
  );
  assert(
    'nextOffset from max id+1',
    Bot.nextOffsetFromUpdates(0, [{ update_id: 5 }, { update_id: 8 }, { update_id: 3 }]) === 9
  );
  assert(
    'nextOffset advances past current',
    Bot.nextOffsetFromUpdates(100, [{ update_id: 100 }, { update_id: 101 }]) === 102
  );
  assert(
    'nextOffset ignores bad ids',
    Bot.nextOffsetFromUpdates(7, [null, {}, { update_id: 'x' }]) === 7
  );

  let storedOffset = 40;
  const pollFetchCalls = [];
  const pollResult = Bot.pollUpdates({
    silent: true,
    contacts: [ownerContact],
    getOffset: function () {
      return storedOffset;
    },
    setOffset: function (n) {
      storedOffset = n;
    },
    fetchUpdates: function (offset) {
      pollFetchCalls.push(offset);
      return {
        ok: true,
        updates: [
          {
            update_id: 40,
            message: { chat: { id: 111222 }, text: '/ayuda' },
          },
          {
            update_id: 41,
            message: { chat: { id: 999888 }, text: '/mes' },
          },
          {
            update_id: 42,
            message: { chat: { id: 111222 }, text: '/mes' },
          },
        ],
      };
    },
  });
  assert('poll fetch uses stored offset', pollFetchCalls[0] === 40);
  assert('poll ok', pollResult.ok === true);
  assert('poll processed 3', pollResult.processed === 3);
  assert('poll nextOffset 43', pollResult.nextOffset === 43 && storedOffset === 43);
  assert(
    'poll owner authorized in batch',
    pollResult.results[0].authorized === true && pollResult.results[2].authorized === true
  );
  assert('poll tenant denied in batch', pollResult.results[1].authorized === false);

  // Empty batch does not move offset
  const emptyPoll = Bot.pollUpdates({
    silent: true,
    contacts: [ownerContact],
    getOffset: function () {
      return 99;
    },
    setOffset: function (n) {
      storedOffset = n;
    },
    fetchUpdates: function () {
      return { ok: true, updates: [] };
    },
  });
  assert('empty poll keeps offset', emptyPoll.nextOffset === 99 && storedOffset === 99);

  // Failed fetch does not advance offset
  let failOffset = 5;
  const failPoll = Bot.pollUpdates({
    silent: true,
    getOffset: function () {
      return failOffset;
    },
    setOffset: function (n) {
      failOffset = n;
    },
    fetchUpdates: function () {
      return { ok: false, reason: 'not_configured', updates: [] };
    },
  });
  assert('failed poll ok false', failPoll.ok === false);
  assert('failed poll offset unchanged', failOffset === 5 && failPoll.nextOffset === 5);

  // Settings-backed offset helpers
  Bot.setUpdateOffset(0);
  assert('offset helper get 0', Bot.getUpdateOffset() === 0);
  Bot.setUpdateOffset(15);
  assert('offset helper set/get', Bot.getUpdateOffset() === 15);
  Bot.setUpdateOffset(0);

  // processUpdatesBatch isolates errors
  const batch = Bot.processUpdatesBatch(
    [
      { message: { chat: { id: 111222 }, text: '/start' } },
      null,
    ],
    { silent: true, contacts: [ownerContact] }
  );
  assert('batch processed count', batch.processed === 2);

  // Restore
  global.CM.Sheets.list = _listBot;
  global.CM.Sheets.findInvoiceById = function () {
    return null;
  };
  global.CM.Dates.currentBillingPeriod = _cur;
  Bot.clearSession('111222');
}

console.log('\n-------------------');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('OK');
