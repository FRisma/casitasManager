/**
 * Repositorio Google Sheets — schema multi-tenant/owner (Contacts).
 */

var CM = CM || {};
CM.Sheets = (function () {
  var SHEET_NAMES = {
    PROPERTIES: 'Properties',
    CONTACTS: 'Contacts',
    SERVICES: 'Services',
    INVOICES: 'Invoices',
    PAYMENTS: 'Payments',
    CONFIGURATION: 'Configuration',
    EXECUTION_LOG: 'ExecutionLog',
  };

  var HEADERS = {};
  HEADERS[SHEET_NAMES.PROPERTIES] = [
    'property_id',
    'property_name',
    'address',
    'city',
    'province',
    'drive_folder_id',
    'active',
  ];
  HEADERS[SHEET_NAMES.CONTACTS] = [
    'contact_id',
    'property_id',
    'role',
    'name',
    'email',
    'telegram',
    'active',
    'notes',
  ];
  HEADERS[SHEET_NAMES.SERVICES] = [
    'service_id',
    'property_id',
    'provider',
    'service_type',
    'account_number',
    'secondary_identifier',
    'cadastral_number',
    'portal_url',
    'enabled',
    'last_checked_at',
    'last_invoice_detected',
    'notes',
  ];
  HEADERS[SHEET_NAMES.INVOICES] = [
    'invoice_id',
    'property_id',
    'service_id',
    'provider',
    'billing_period',
    'invoice_number',
    'issue_date',
    'due_date',
    'amount',
    'currency',
    'invoice_status',
    'payment_status',
    'invoice_file_id',
    'invoice_file_url',
    'first_detected_at',
    'last_checked_at',
    'paid_at',
    'payment_receipt_file_id',
    'payment_receipt_url',
    'notification_sent_at',
    'notes',
  ];
  HEADERS[SHEET_NAMES.PAYMENTS] = [
    'payment_id',
    'invoice_id',
    'provider',
    'payment_date',
    'amount',
    'payment_method',
    'receipt_file_id',
    'receipt_file_url',
    'confirmation_source',
    'notes',
  ];
  HEADERS[SHEET_NAMES.CONFIGURATION] = ['key', 'value', 'updated_at', 'notes'];
  HEADERS[SHEET_NAMES.EXECUTION_LOG] = [
    'execution_id',
    'timestamp',
    'service_id',
    'operation',
    'status',
    'message',
    'details',
  ];

  function spreadsheet_() {
    var id = CM.Settings.get(CM.Settings.KEYS.SPREADSHEET_ID);
    if (!id) throw new Error('SPREADSHEET_ID no configurado en Script Properties');
    return SpreadsheetApp.openById(id);
  }

  function ensureSheet_(ss, name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = HEADERS[name];
    if (!headers) return sh;
    var range = sh.getRange(1, 1, 1, headers.length);
    var existing = range.getValues()[0];
    var empty = existing.every(function (c) {
      return c === '' || c == null;
    });
    if (empty) {
      range.setValues([headers]);
      sh.setFrozenRows(1);
    }
    return sh;
  }

  /** Crea/valida todas las pestañas e headers. Idempotente. */
  function ensureSchema(ss) {
    ss = ss || spreadsheet_();
    Object.keys(HEADERS).forEach(function (name) {
      ensureSheet_(ss, name);
    });
    // Eliminar Sheet1 vacío si quedó
    var def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) {
      try {
        ss.deleteSheet(def);
      } catch (e) {
        /* ignore */
      }
    }
    return ss;
  }

  function coerceCell_(header, value) {
    if (value == null || value === '') return value;
    // billing_period must stay YYYY-MM even if Sheets stored a Date.
    if (header === 'billing_period') {
      return CM.Dates.normalizeBillingPeriod(value);
    }
    // Common date columns → ISO string when Sheets returns Date.
    if (
      (header === 'issue_date' ||
        header === 'due_date' ||
        header === 'payment_date' ||
        header === 'paid_at') &&
      Object.prototype.toString.call(value) === '[object Date]'
    ) {
      return CM.Dates.parseDateToISO(value) || value;
    }
    return value;
  }

  function sheetToObjects_(sh) {
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    var headers = values[0].map(String);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var obj = {};
      var empty = true;
      for (var c = 0; c < headers.length; c++) {
        var v = coerceCell_(headers[c], values[r][c]);
        obj[headers[c]] = v;
        if (v !== '' && v != null) empty = false;
      }
      if (!empty) {
        obj.__row = r + 1;
        rows.push(obj);
      }
    }
    return rows;
  }

  function objectsToRow_(headers, obj) {
    return headers.map(function (h) {
      var v = obj[h] != null ? obj[h] : '';
      // Force billing_period as plain text so Sheets does not auto-convert to Date.
      if (h === 'billing_period' && v !== '') {
        var period = CM.Dates.normalizeBillingPeriod(v);
        return period ? "'" + period : '';
      }
      return v;
    });
  }

  function list(sheetName) {
    var sh = ensureSheet_(spreadsheet_(), sheetName);
    return sheetToObjects_(sh);
  }

  function appendRow(sheetName, obj) {
    var sh = ensureSheet_(spreadsheet_(), sheetName);
    var headers = HEADERS[sheetName];
    sh.appendRow(objectsToRow_(headers, obj));
  }

  function updateRow(sheetName, rowNumber, obj) {
    var sh = ensureSheet_(spreadsheet_(), sheetName);
    var headers = HEADERS[sheetName];
    sh.getRange(rowNumber, 1, 1, headers.length).setValues([objectsToRow_(headers, obj)]);
  }

  function upsertByKey(sheetName, keyField, obj) {
    var rows = list(sheetName);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][keyField]) === String(obj[keyField])) {
        var merged = Object.assign({}, rows[i], obj);
        delete merged.__row;
        updateRow(sheetName, rows[i].__row, merged);
        return { action: 'updated', row: rows[i].__row };
      }
    }
    appendRow(sheetName, obj);
    return { action: 'inserted' };
  }

  function setConfig(key, value, notes) {
    var ts = CM.Logging.nowTs();
    return upsertByKey(SHEET_NAMES.CONFIGURATION, 'key', {
      key: key,
      value: value,
      updated_at: ts,
      notes: notes || '',
    });
  }

  function getConfig(key, fallback) {
    var rows = list(SHEET_NAMES.CONFIGURATION);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].key) === String(key)) return rows[i].value;
    }
    return fallback;
  }

  function appendExecutionLog(row) {
    appendRow(SHEET_NAMES.EXECUTION_LOG, row);
  }

  function getEnabledServices() {
    return list(SHEET_NAMES.SERVICES).filter(function (s) {
      return String(s.enabled).toLowerCase() === 'true' || s.enabled === true || s.enabled === 'TRUE';
    });
  }

  function getContacts(propertyId, role) {
    return list(SHEET_NAMES.CONTACTS).filter(function (c) {
      if (String(c.active).toLowerCase() === 'false' || c.active === false) return false;
      if (propertyId && String(c.property_id) !== String(propertyId)) return false;
      if (role && String(c.role).toLowerCase() !== String(role).toLowerCase()) return false;
      return true;
    });
  }

  function findInvoiceById(invoiceId) {
    var rows = list(SHEET_NAMES.INVOICES);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].invoice_id) === String(invoiceId)) return rows[i];
    }
    return null;
  }

  /**
   * Corrige portal_url OSSE si quedó el TLD viejo facturaweb.osse.ar (DNS ENOTFOUND).
   * Idempotente. No inventa cuentas ni toca otros providers.
   */
  function repairOssePortalUrl_(serviceRows) {
    var CORRECT = 'https://facturaweb.osse.com.ar/';
    (serviceRows || []).forEach(function (s) {
      if (String(s.provider || '').toLowerCase() !== 'osse') return;
      var url = String(s.portal_url || '');
      if (!url) return;
      if (/facturaweb\.osse\.com\.ar/i.test(url)) return;
      if (/facturaweb\.osse\.ar/i.test(url) || /osse\.ar\//i.test(url)) {
        if (!s.__row) return;
        var patch = Object.assign({}, s, { portal_url: CORRECT });
        delete patch.__row;
        try {
          updateRow(SHEET_NAMES.SERVICES, s.__row, patch);
          CM.Logging.info('repairOssePortalUrl', 'portal_url → ' + CORRECT);
        } catch (e) {
          /* sheet locked / tests */
        }
      }
    });
  }

  function seedIfEmpty(ss) {
    ss = ensureSchema(ss);
    var props = sheetToObjects_(ss.getSheetByName(SHEET_NAMES.PROPERTIES));
    if (!props.length) {
      var p = CM.ServiceCatalog.getPropertyDefaults();
      appendRow(SHEET_NAMES.PROPERTIES, {
        property_id: p.property_id,
        property_name: p.property_name,
        address: p.address,
        city: p.city,
        province: p.province,
        drive_folder_id: CM.Settings.get(CM.Settings.KEYS.PROPERTY_FOLDER_ID, ''),
        active: true,
      });
    }

    var services = sheetToObjects_(ss.getSheetByName(SHEET_NAMES.SERVICES));
    if (!services.length) {
      CM.ServiceCatalog.getServiceSeeds().forEach(function (s) {
        appendRow(
          SHEET_NAMES.SERVICES,
          Object.assign({}, s, {
            enabled: s.enabled,
            last_checked_at: '',
            last_invoice_detected: '',
          })
        );
      });
    } else {
      // Reparar portal OSSE viejo (facturaweb.osse.ar → .com.ar) sin tocar otras filas
      repairOssePortalUrl_(services);
    }

    var contacts = sheetToObjects_(ss.getSheetByName(SHEET_NAMES.CONTACTS));
    if (!contacts.length) {
      // Placeholders — Franco completa emails/telegram reales en Sheets
      appendRow(SHEET_NAMES.CONTACTS, {
        contact_id: 'owner_1',
        property_id: CM.ServiceCatalog.getPropertyDefaults().property_id,
        role: 'owner',
        name: 'Propietario (completar)',
        email: '',
        telegram: '',
        active: true,
        notes: 'Completar email/telegram de prueba DEV',
      });
      appendRow(SHEET_NAMES.CONTACTS, {
        contact_id: 'tenant_1',
        property_id: CM.ServiceCatalog.getPropertyDefaults().property_id,
        role: 'tenant',
        name: 'Inquilino (completar)',
        email: '',
        telegram: '',
        active: true,
        notes: 'En DEV nunca se notifica a inquilinos reales',
      });
    }

    setConfig('timezone', CM.Dates.TZ, 'Fijo');
    setConfig('environment', CM.Settings.getEnvironment(), '');
    setConfig('dry_run', String(CM.Settings.isDryRun()), 'true = no envía mail/telegram reales');
    setConfig('property_id', CM.ServiceCatalog.getPropertyDefaults().property_id, '');
  }

  return {
    SHEET_NAMES: SHEET_NAMES,
    HEADERS: HEADERS,
    ensureSchema: ensureSchema,
    seedIfEmpty: seedIfEmpty,
    list: list,
    appendRow: appendRow,
    updateRow: updateRow,
    upsertByKey: upsertByKey,
    setConfig: setConfig,
    getConfig: getConfig,
    appendExecutionLog: appendExecutionLog,
    getEnabledServices: getEnabledServices,
    getContacts: getContacts,
    findInvoiceById: findInvoiceById,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Sheets;
}
