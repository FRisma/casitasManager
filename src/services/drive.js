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
   * Subcarpetas estándar bajo una carpeta de propiedad.
   */
  function ensurePropertySubfolders_(propertyFolder) {
    var invoices = findOrCreateFolder_(propertyFolder, 'Invoices');
    var receipts = findOrCreateFolder_(propertyFolder, 'Payment-Receipts');
    var reports = findOrCreateFolder_(propertyFolder, 'Monthly-Reports');
    var logs = findOrCreateFolder_(propertyFolder, 'Logs');
    var year = CM.Dates.todayISO().substring(0, 4);
    findOrCreateFolder_(invoices, year);
    findOrCreateFolder_(receipts, year);
    return {
      invoicesId: invoices.getId(),
      receiptsId: receipts.getId(),
      reportsId: reports.getId(),
      logsId: logs.getId(),
    };
  }

  /**
   * Crea árbol:
   * CasitasManager-{ENV}/Properties/Natania-XV/{Invoices,Payment-Receipts,Monthly-Reports,Logs}
   * Idempotente. PROPERTY_FOLDER_ID sigue apuntando al seed Natania (default ops).
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
    var subs = ensurePropertySubfolders_(property);

    CM.Settings.set(CM.Settings.KEYS.ROOT_FOLDER_ID, root.getId());
    CM.Settings.set(CM.Settings.KEYS.PROPERTY_FOLDER_ID, property.getId());

    return {
      rootId: root.getId(),
      rootUrl: root.getUrl(),
      propertyId: property.getId(),
      propertyUrl: property.getUrl(),
      invoicesId: subs.invoicesId,
      receiptsId: subs.receiptsId,
      reportsId: subs.reportsId,
      logsId: subs.logsId,
    };
  }

  /**
   * Carpeta de una propiedad bajo CasitasManager-{ENV}/Properties/{FolderName}.
   * Idempotente. No cambia PROPERTY_FOLDER_ID (Natania sigue siendo default).
   * @param {string} propertyId slug (ej. natania-xv-m6c1)
   * @param {string} [folderName] override del nombre de carpeta
   */
  function ensurePropertyFolder(propertyId, folderName) {
    propertyId = String(propertyId || '').trim();
    if (!propertyId) throw new Error('ensurePropertyFolder requiere propertyId');
    var name =
      folderName ||
      (CM.Properties && CM.Properties.folderNameFromPropertyId
        ? CM.Properties.folderNameFromPropertyId(propertyId)
        : propertyId);

    var rootId = CM.Settings.get(CM.Settings.KEYS.ROOT_FOLDER_ID, '');
    var root;
    if (rootId) {
      root = getFolderById_(rootId);
    } else {
      var env = CM.Settings.getEnvironment() || 'DEV';
      var roots = DriveApp.getFoldersByName('CasitasManager-' + env);
      if (!roots.hasNext()) {
        throw new Error('Falta carpeta raíz CasitasManager-' + env + ' — corré setupDevEnvironment()');
      }
      root = roots.next();
      CM.Settings.set(CM.Settings.KEYS.ROOT_FOLDER_ID, root.getId());
    }

    var properties = findOrCreateFolder_(root, 'Properties');
    var property = findOrCreateFolder_(properties, name);
    var subs = ensurePropertySubfolders_(property);
    findOrCreateFolder_(property, 'Inbox-Manual');

    return {
      ok: true,
      propertyId: propertyId,
      folderId: property.getId(),
      folderName: name,
      url: property.getUrl(),
      invoicesId: subs.invoicesId,
      receiptsId: subs.receiptsId,
      reportsId: subs.reportsId,
      logsId: subs.logsId,
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
   * Extrae un Drive fileId desde un id crudo o una URL de Drive/Docs.
   * Puro (sin DriveApp) — usable en menú y tests Node.
   *
   * @returns {{ok:true,fileId:string,source:string}|{ok:false,reason:string}}
   */
  function parseDriveFileId(raw) {
    if (raw == null) return { ok: false, reason: 'empty' };
    var s = String(raw).trim().replace(/^['"]+|['"]+$/g, '');
    if (!s) return { ok: false, reason: 'empty' };

    var m = s.match(/\/(?:file|document|presentation|spreadsheets|folders)\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return { ok: true, fileId: m[1], source: 'path' };

    m = s.match(/[?&#]id=([a-zA-Z0-9_-]+)/);
    if (m) return { ok: true, fileId: m[1], source: 'query' };

    if (/^[a-zA-Z0-9_-]{10,128}$/.test(s)) {
      return { ok: true, fileId: s, source: 'raw' };
    }

    return { ok: false, reason: 'unrecognized', raw: s };
  }

  /**
   * Carpeta fija Properties/Natania-XV/Inbox-Manual para PDFs bajados a mano.
   * Idempotente. Requiere PROPERTY_FOLDER_ID.
   */
  function ensureManualInboxFolder() {
    var propId = CM.Settings.get(CM.Settings.KEYS.PROPERTY_FOLDER_ID);
    if (!propId) throw new Error('PROPERTY_FOLDER_ID no configurado');
    var property = getFolderById_(propId);
    var folder = findOrCreateFolder_(property, 'Inbox-Manual');
    return {
      folderId: folder.getId(),
      url: folder.getUrl(),
      name: 'Inbox-Manual',
    };
  }

  /**
   * Lista PDFs recientes en Inbox-Manual (más nuevos primero).
   * @param {number} [limit=10]
   */
  function listRecentManualInboxPdfs(limit) {
    limit = limit == null ? 10 : limit;
    var inbox = ensureManualInboxFolder();
    var folder = getFolderById_(inbox.folderId);
    var it = folder.getFiles();
    var list = [];
    while (it.hasNext()) {
      var f = it.next();
      var name = f.getName();
      var mime = '';
      try {
        mime = f.getMimeType() || '';
      } catch (e) {
        mime = '';
      }
      var isPdf =
        mime === 'application/pdf' ||
        (typeof MimeType !== 'undefined' && mime === MimeType.PDF) ||
        /\.pdf$/i.test(name);
      if (!isPdf) continue;
      var updated = 0;
      try {
        updated = f.getLastUpdated().getTime();
      } catch (e2) {
        updated = 0;
      }
      list.push({
        fileId: f.getId(),
        name: name,
        url: f.getUrl(),
        updated: updated,
      });
    }
    list.sort(function (a, b) {
      return b.updated - a.updated;
    });
    return {
      folderId: inbox.folderId,
      url: inbox.url,
      files: list.slice(0, limit),
    };
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
    ensurePropertyFolder: ensurePropertyFolder,
    getInvoiceFolder: getInvoiceFolder,
    getReportsFolder: getReportsFolder,
    getReceiptsFolder: getReceiptsFolder,
    saveInvoicePdf: saveInvoicePdf,
    saveReportJson: saveReportJson,
    monthFolderName: monthFolderName,
    parseDriveFileId: parseDriveFileId,
    ensureManualInboxFolder: ensureManualInboxFolder,
    listRecentManualInboxPdfs: listRecentManualInboxPdfs,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Drive;
}
