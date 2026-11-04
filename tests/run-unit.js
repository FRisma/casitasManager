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
const blocked = global.CM.Notifications.sendMonthlyReport('2099-01');
assert('blocked without approval', blocked && blocked.reason === 'approval_required');
global.CM.Settings.setMonthlyApprovalPeriod('2099-01');
const preview = global.CM.Notifications.previewMonthlyReport('2099-01');
assert('preview ok', !!(preview && preview.report && preview.report.billingPeriod === '2099-01'));
assert(
  'spanish body present',
  !!(preview && preview.emailPreview.htmlBody.indexOf('únicamente informativo') >= 0)
);

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
