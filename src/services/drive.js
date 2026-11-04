/**
 * Google Drive — estructura de carpetas idempotente DEV/PROD.
 */

var CM = CM || {};
CM.Drive = (function () {
  var MONTH_NAMES = [
    '01-January',
    '02-February',
    '03-March',
    '04-April',
    '05-May',
    '06-June',
    '07-July',
    '08-August',
    '09-September',
    '10-October',
    '11-November',
    '12-December',
  ];

  function findOrCreateFolder_(parent, name) {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  }

  function getFolderById_(id) {
    return DriveApp.getFolderById(id);
  }

  /**
   * Crea árbol:
   * CasitasManager-{ENV}/Properties/Natania-XV/{Invoices,Payment-Receipts,Monthly-Reports,Logs}
   * Idempotente.
   */
  function ensureEnvironmentTree(env) {
    env = env || CM.Settings.getEnvironment();
    var rootName = 'CasitasManager-' + env;
    var root;
    var roots = DriveApp.getFoldersByName(rootName);
    if (roots.hasNext()) {
      root = roots.next();
    } else {
      root = DriveApp.createFolder(rootName);
    }

    var properties = findOrCreateFolder_(root, 'Properties');
    var property = findOrCreateFolder_(properties, 'Natania-XV');
    var invoices = findOrCreateFolder_(property, 'Invoices');
    var receipts = findOrCreateFolder_(property, 'Payment-Receipts');
    var reports = findOrCreateFolder_(property, 'Monthly-Reports');
    var logs = findOrCreateFolder_(property, 'Logs');

    // Año actual
    var year = CM.Dates.todayISO().substring(0, 4);
    findOrCreateFolder_(invoices, year);
    findOrCreateFolder_(receipts, year);

    CM.Settings.set(CM.Settings.KEYS.ROOT_FOLDER_ID, root.getId());
    CM.Settings.set(CM.Settings.KEYS.PROPERTY_FOLDER_ID, property.getId());

    return {
      rootId: root.getId(),
      rootUrl: root.getUrl(),
      propertyId: property.getId(),
      propertyUrl: property.getUrl(),
      invoicesId: invoices.getId(),
      receiptsId: receipts.getId(),
      reportsId: reports.getId(),
      logsId: logs.getId(),
    };
  }

  function monthFolderName(periodYYYYMM) {
    var p = CM.Dates.normalizeBillingPeriod(periodYYYYMM);
    var m = p.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    var idx = parseInt(m[2], 10) - 1;
    if (idx < 0 || idx > 11) return null;
    return { year: m[1], month: MONTH_NAMES[idx] };
  }

  function getInvoiceFolder(billingPeriod) {
    var tree = monthFolderName(billingPeriod);
    if (!tree) throw new Error('billingPeriod inválido: ' + billingPeriod);
    var propId = CM.Settings.get(CM.Settings.KEYS.PROPERTY_FOLDER_ID);
    if (!propId) throw new Error('PROPERTY_FOLDER_ID no configurado');
    var property = getFolderById_(propId);
    var invoices = findOrCreateFolder_(property, 'Invoices');
    var year = findOrCreateFolder_(invoices, tree.year);
    return findOrCreateFolder_(year, tree.month);
  }

  function getReportsFolder() {
    var propId = CM.Settings.get(CM.Settings.KEYS.PROPERTY_FOLDER_ID);
    var property = getFolderById_(propId);
    return findOrCreateFolder_(property, 'Monthly-Reports');
  }

  function getReceiptsFolder(billingPeriod) {
    var tree = monthFolderName(billingPeriod || CM.Dates.currentBillingPeriod());
    var propId = CM.Settings.get(CM.Settings.KEYS.PROPERTY_FOLDER_ID);
    var property = getFolderById_(propId);
    var receipts = findOrCreateFolder_(property, 'Payment-Receipts');
    var year = findOrCreateFolder_(receipts, tree ? tree.year : CM.Dates.todayISO().substring(0, 4));
    return year;
  }

  /**
   * Guarda un blob PDF. Valida magic/size.
   * @returns {{fileId,url,name,validation}}
   */
  function saveInvoicePdf(blob, meta) {
    var validation = CM.Pdf.validatePdfBlob(blob);
    if (!validation.ok) {
      return { ok: false, validation: validation };
    }
    var name = CM.Pdf.invoiceFilename(meta);
    var folder = getInvoiceFolder(meta.billingPeriod || CM.Dates.currentBillingPeriod());
    // Evitar duplicar mismo nombre
    var existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      var f = existing.next();
      return {
        ok: true,
        fileId: f.getId(),
        url: f.getUrl(),
        name: name,
        validation: validation,
        reused: true,
      };
    }
    if (typeof blob.setName === 'function') blob.setName(name);
    var file = folder.createFile(blob);
    file.setName(name);
    return {
      ok: true,
      fileId: file.getId(),
      url: file.getUrl(),
      name: name,
      validation: validation,
      reused: false,
    };
  }

  function saveReportJson(period, payload) {
    var folder = getReportsFolder();
    var name = 'report_' + period + '.json';
    var content = JSON.stringify(payload, null, 2);
    var existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      var f = existing.next();
      f.setContent(content);
      return { fileId: f.getId(), url: f.getUrl(), name: name, updated: true };
    }
    var blob = Utilities.newBlob(content, 'application/json', name);
    var file = folder.createFile(blob);
    return { fileId: file.getId(), url: file.getUrl(), name: name, updated: false };
  }

  return {
    ensureEnvironmentTree: ensureEnvironmentTree,
    getInvoiceFolder: getInvoiceFolder,
    getReportsFolder: getReportsFolder,
    getReceiptsFolder: getReceiptsFolder,
    saveInvoicePdf: saveInvoicePdf,
    saveReportJson: saveReportJson,
    monthFolderName: monthFolderName,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Drive;
}
