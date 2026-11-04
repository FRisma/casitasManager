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
load('providers/provider-interface.js');
load('providers/osse.js');

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

console.log('\n-------------------');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('OK');
