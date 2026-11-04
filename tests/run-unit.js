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
  SHEET_NAMES: { INVOICES: 'Invoices', CONTACTS: 'Contacts', EXECUTION_LOG: 'ExecutionLog' },
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
};

load('services/invoices.js');
load('services/payments.js');
load('services/email.js');
load('services/telegram.js');
load('services/notifications.js');

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

console.log('\n== service catalog municipalidad inactive ==');
const muni = global.CM.ServiceCatalog.getByProvider('municipalidad');
assert('muni disabled seed', muni && muni.enabled === false);
assert('muni no cadastral', muni && !muni.cadastral_number);

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
  'spanish body present',
  !!(preview && preview.emailPreview.htmlBody.indexOf('únicamente informativo') >= 0)
);
assert(
  'preview marks owner-only in DEV',
  preview.emailPreview.recipientsWouldBe === 'OWNER test only (DEV/dry-run)'
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

console.log('\n== telegram owner commands ==');
const appr = global.CM.Telegram.handleOwnerCommand('approve_report', ['2026-11']);
assert('approve cmd', appr.ok && global.CM.Settings.getMonthlyApprovalPeriod() === '2026-11');

console.log('\n== notification dedupe key ==');
const k1 = global.CM.Hashes.notificationDedupeKey('new', 'inv1');
const k2 = global.CM.Hashes.notificationDedupeKey('new', 'inv1');
assert('dedupe stable', k1 === k2);

console.log('\n-------------------');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('OK');
