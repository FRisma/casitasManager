/**
 * Alta de propiedades + servicios + contactos (multi-tenant / multi-owner).
 * Seed Natania XV sigue solo para bootstrap de hojas vacías.
 * Puro donde se pueda — usable desde menú y editor.
 */

var CM = CM || {};
CM.Properties = (function () {
  var DEFAULT_PROVINCE = 'San Juan';

  /**
   * Municipios con adapter municipal conocido.
   * Rivadavia → ASP.NET deuda_total. Caucete → stub (falta discovery de portal).
   */
  var MUNICIPIO_REGISTRY = {
    rivadavia: {
      key: 'rivadavia',
      label: 'Rivadavia',
      supported: true,
      portal_url: 'http://181.209.107.110:83/deudavencida/deuda_total.aspx',
      adapter: 'rivadavia_aspnet',
      notes: 'Adapter ASP.NET deudavencida/deuda_total.aspx',
    },
    caucete: {
      key: 'caucete',
      label: 'Caucete',
      supported: false,
      portal_url: '',
      adapter: null,
      notes:
        'unsupported_municipio — falta discovery de portal Caucete; usar Importar PDF manual.',
    },
  };

  var SERVICE_DEFS = {
    naturgy: {
      provider: 'naturgy',
      service_type: 'electricity',
      label: 'Electricidad (Naturgy)',
      defaultPortal: 'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta',
    },
    ecogas: {
      provider: 'ecogas',
      service_type: 'gas',
      label: 'Gas (Ecogas)',
      defaultPortal: 'https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p',
    },
    osse: {
      provider: 'osse',
      service_type: 'water',
      label: 'Agua (OSSE)',
      defaultPortal: 'https://facturaweb.osse.com.ar/',
    },
    municipalidad: {
      provider: 'municipalidad',
      service_type: 'municipal_tax',
      label: 'Tasa municipal (Municipalidad)',
      defaultPortal: '',
    },
  };

  function slugify(name) {
    var s = String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    if (!s) s = 'propiedad';
    if (s.length > 48) s = s.slice(0, 48).replace(/-+$/g, '');
    return s;
  }

  /**
   * Slug estable único frente a property_id existentes.
   * Si choca: usa preferredSuffix, luego -2, -3…
   * @returns {{property_id:string, collided:boolean, base:string}}
   */
  function allocatePropertyId(nameOrSlug, existingIds, preferredSuffix) {
    var base = slugify(nameOrSlug);
    var existing = {};
    (existingIds || []).forEach(function (id) {
      existing[String(id).toLowerCase()] = true;
    });
    if (!existing[base]) {
      return { property_id: base, collided: false, base: base };
    }
    var suffix = preferredSuffix != null ? String(preferredSuffix).trim() : '';
    if (suffix) {
      var withSuffix = slugify(base + '-' + suffix);
      if (!existing[withSuffix]) {
        return { property_id: withSuffix, collided: true, base: base };
      }
    }
    var n = 2;
    while (existing[base + '-' + n]) n++;
    return { property_id: base + '-' + n, collided: true, base: base };
  }

  function folderNameFromPropertyId(propertyId) {
    return String(propertyId || 'propiedad')
      .split('-')
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('-');
  }

  function normalizeMunicipio(raw) {
    var s = String(raw || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    return s;
  }

  function lookupMunicipio(raw) {
    var key = normalizeMunicipio(raw).replace(/\s+/g, '');
    if (MUNICIPIO_REGISTRY[key]) return Object.assign({}, MUNICIPIO_REGISTRY[key]);
    // match by label-ish
    var keys = Object.keys(MUNICIPIO_REGISTRY);
    for (var i = 0; i < keys.length; i++) {
      var entry = MUNICIPIO_REGISTRY[keys[i]];
      if (normalizeMunicipio(entry.label).replace(/\s+/g, '') === key) {
        return Object.assign({}, entry);
      }
    }
    return {
      key: key || 'desconocido',
      label: String(raw || '').trim() || 'desconocido',
      supported: false,
      portal_url: '',
      adapter: null,
      notes:
        'unsupported_municipio — sin adapter conocido; completar portal_url o Importar PDF manual.',
    };
  }

  /**
   * Extrae municipio desde fila Services (secondary_identifier o notes municipio=…).
   */
  function municipioFromService(service) {
    if (!service) return null;
    var sec = String(service.secondary_identifier || '').trim();
    if (sec) return lookupMunicipio(sec);
    var notes = String(service.notes || '');
    var m = notes.match(/municipio\s*=\s*([^|;]+)/i);
    if (m) return lookupMunicipio(m[1]);
    // Seed Natania / Rivadavia portal conocido sin municipio explícito
    var portal = String(service.portal_url || '');
    if (/181\.209\.107\.110:83|deudavencida/i.test(portal)) {
      return lookupMunicipio('Rivadavia');
    }
    return null;
  }

  function isMunicipalidadSupported(service) {
    var info = municipioFromService(service);
    if (!info) {
      // Sin municipio explícito: permitir adapter Rivadavia (seed Natania / filas viejas).
      // Altas nuevas siempre guardan municipio en secondary_identifier.
      return true;
    }
    return !!info.supported;
  }

  function listExistingPropertyIds_() {
    try {
      return (CM.Sheets.list(CM.Sheets.SHEET_NAMES.PROPERTIES) || []).map(function (p) {
        return p.property_id;
      });
    } catch (e) {
      return [];
    }
  }

  function shapePropertyRow(input, propertyId, driveFolderId) {
    input = input || {};
    return {
      property_id: propertyId,
      property_name: String(input.property_name || input.name || '').trim(),
      address: String(input.address || '').trim(),
      city: String(input.city || '').trim(),
      province: String(input.province || DEFAULT_PROVINCE).trim() || DEFAULT_PROVINCE,
      drive_folder_id: driveFolderId || String(input.drive_folder_id || '').trim(),
      active:
        input.active === false ||
        String(input.active).toLowerCase() === 'false' ||
        String(input.active) === 'FALSE'
          ? false
          : true,
    };
  }

  /**
   * Arma fila Services. No inventa montos ni catastro.
   * Municipalidad: municipio → secondary_identifier; portal solo si conocido o user-supplied.
   */
  function shapeServiceRow(propertyId, providerKey, details) {
    details = details || {};
    var key = String(providerKey || details.provider || '')
      .toLowerCase()
      .trim();
    var def = SERVICE_DEFS[key];
    if (!def) {
      throw new Error('Proveedor desconocido: ' + providerKey);
    }
    var account = String(details.account_number || details.accountNumber || '').trim();
    var secondary = String(
      details.secondary_identifier || details.secondaryIdentifier || details.medidor || ''
    ).trim();
    var cadastral = String(
      details.cadastral_number || details.cadastralNumber || details.nomenclatura || ''
    ).trim();
    var portal = String(details.portal_url || details.portalUrl || '').trim();
    var notesParts = [];
    if (details.notes) notesParts.push(String(details.notes).trim());

    var enabled =
      details.enabled === false ||
      String(details.enabled).toLowerCase() === 'false' ||
      String(details.enabled) === 'FALSE'
        ? false
        : true;

    var needsAttention = [];

    if (key === 'municipalidad') {
      var municipioRaw =
        details.municipio || details.municipio_name || details.city || secondary || '';
      var muni = lookupMunicipio(municipioRaw);
      secondary = muni.label;
      if (!portal) {
        portal = muni.portal_url || '';
      }
      // No usar portal Rivadavia para otro municipio
      if (
        !muni.supported &&
        portal &&
        /181\.209\.107\.110:83|deudavencida/i.test(portal) &&
        !details.portal_url &&
        !details.portalUrl
      ) {
        portal = '';
      }
      notesParts.unshift('municipio=' + muni.label);
      if (!muni.supported) {
        notesParts.push(muni.notes || 'unsupported_municipio');
        needsAttention.push(
          'Municipalidad ' +
            muni.label +
            ': sin adapter auto — Importar PDF o completar portal_url tras discovery'
        );
      }
      if (!cadastral) {
        needsAttention.push('Municipalidad: falta cadastral_number / nomenclatura');
      }
      if (!muni.supported && !portal && !cadastral) {
        // Sin datos para intentar después — dejar enabled pero documentado
        needsAttention.push('Municipalidad: enabled=TRUE; runProvider → unsupported_municipio');
      }
    } else if (key === 'naturgy') {
      if (!account) needsAttention.push('Naturgy: falta account_number (client_number)');
      if (!portal) portal = def.defaultPortal;
      if (secondary) notesParts.push('medidor=' + secondary);
    } else if (key === 'ecogas') {
      if (!account) needsAttention.push('Ecogas: falta account_number');
      if (!portal) portal = def.defaultPortal;
    } else if (key === 'osse') {
      if (!account) needsAttention.push('OSSE: falta account_number (14 dígitos)');
      if (!portal) portal = def.defaultPortal;
      if (secondary) notesParts.push('unidad=' + secondary);
    }

    var serviceId =
      details.service_id ||
      'svc_' + key + '_' + String(propertyId).replace(/[^a-z0-9]+/gi, '_');

    return {
      row: {
        service_id: serviceId,
        property_id: propertyId,
        provider: def.provider,
        service_type: def.service_type,
        account_number: account,
        secondary_identifier: secondary,
        cadastral_number: cadastral,
        portal_url: portal,
        enabled: enabled,
        last_checked_at: '',
        last_invoice_detected: '',
        notes: notesParts.filter(Boolean).join(' | '),
      },
      needsAttention: needsAttention,
      municipio: key === 'municipalidad' ? lookupMunicipio(secondary) : null,
    };
  }

  /**
   * Contacto ligado a property_id de la propiedad nueva (nunca Natania por defecto).
   */
  function shapeContactRow(propertyId, contact, index) {
    contact = contact || {};
    var role = String(contact.role || 'owner').toLowerCase().trim();
    if (role !== 'owner' && role !== 'tenant') {
      throw new Error('role debe ser owner|tenant (recibido: ' + contact.role + ')');
    }
    if (!propertyId) throw new Error('shapeContactRow requiere property_id');
    var active =
      contact.active === false ||
      String(contact.active).toLowerCase() === 'false' ||
      String(contact.active) === 'FALSE'
        ? false
        : true;
    var idx = index != null ? index : 1;
    var contactId =
      contact.contact_id ||
      'contact_' +
        String(propertyId).replace(/[^a-z0-9]+/gi, '_') +
        '_' +
        role +
        '_' +
        idx;
    return {
      contact_id: contactId,
      property_id: String(propertyId),
      role: role,
      name: String(contact.name || '').trim(),
      email: String(contact.email || '').trim(),
      telegram: String(contact.telegram || '').trim(),
      active: active,
      notes: String(contact.notes || '').trim(),
    };
  }

  function createDriveFolderSafe_(propertyId) {
    if (!CM.Drive || !CM.Drive.ensurePropertyFolder) {
      return { ok: false, reason: 'no_helper', message: 'CM.Drive.ensurePropertyFolder no disponible' };
    }
    try {
      return CM.Drive.ensurePropertyFolder(propertyId);
    } catch (e) {
      return {
        ok: false,
        reason: 'drive_error',
        message: String(e && e.message ? e.message : e),
      };
    }
  }

  /**
   * Alta programática.
   * @param {object} input
   * @param {string} input.property_name
   * @param {string} [input.property_id]
   * @param {string} [input.address]
   * @param {string} [input.city]
   * @param {string} [input.province]
   * @param {string} [input.notes] → Configuration property_notes_<id>
   * @param {object[]} [input.services]
   * @param {object[]} [input.contacts]
   * @param {boolean} [input.createDriveFolder=true]
   */
  function addProperty(input) {
    input = input || {};
    var name = String(input.property_name || input.name || '').trim();
    if (!name) {
      return { ok: false, reason: 'missing_name', message: 'Falta property_name' };
    }

    var existingIds = listExistingPropertyIds_();
    var desired = String(input.property_id || '').trim();
    var alloc;
    if (desired) {
      var explicitId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(desired)
        ? desired.toLowerCase()
        : slugify(desired);
      var taken = existingIds.some(function (id) {
        return String(id).toLowerCase() === explicitId;
      });
      if (taken) {
        return {
          ok: false,
          reason: 'property_id_collision',
          message: 'property_id ya existe: ' + explicitId,
          property_id: explicitId,
        };
      }
      alloc = { property_id: explicitId, collided: false, base: explicitId };
    } else {
      alloc = allocatePropertyId(name, existingIds, input.id_suffix);
    }

    var propertyId = alloc.property_id;
    var drive = { ok: false, skipped: true };
    var driveFolderId = '';
    if (input.createDriveFolder !== false) {
      drive = createDriveFolderSafe_(propertyId);
      if (drive && drive.ok) {
        driveFolderId = drive.folderId || '';
      }
    }

    var propRow = shapePropertyRow(input, propertyId, driveFolderId);
    CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.PROPERTIES, propRow);

    var propNotes = String(input.notes || '').trim();
    if (propNotes) {
      try {
        CM.Sheets.setConfig('property_notes_' + propertyId, propNotes, 'Notas alta propiedad');
      } catch (e) {
        /* config opcional */
      }
    }

    var servicesOut = [];
    var needsAttention = [];
    (input.services || []).forEach(function (svc) {
      var shaped = shapeServiceRow(propertyId, svc.provider || svc, svc);
      CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.SERVICES, shaped.row);
      servicesOut.push(shaped.row);
      needsAttention = needsAttention.concat(shaped.needsAttention || []);
    });

    var contactsOut = [];
    (input.contacts || []).forEach(function (c, i) {
      var row = shapeContactRow(propertyId, c, i + 1);
      CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.CONTACTS, row);
      contactsOut.push(row);
    });

    var result = {
      ok: true,
      property_id: propertyId,
      property: propRow,
      services: servicesOut,
      contacts: contactsOut,
      drive: drive,
      collided: !!alloc.collided,
      needsAttention: needsAttention,
      message: formatAddPropertySummary({
        ok: true,
        property_id: propertyId,
        property: propRow,
        services: servicesOut,
        contacts: contactsOut,
        drive: drive,
        needsAttention: needsAttention,
      }),
    };

    try {
      CM.Logging.ok('addProperty', 'Propiedad creada ' + propertyId, {
        services: servicesOut.length,
        contacts: contactsOut.length,
      });
    } catch (e2) {
      /* logging opcional */
    }

    return result;
  }

  function addPropertyService(propertyId, serviceInput) {
    propertyId = String(propertyId || '').trim();
    if (!propertyId) {
      return { ok: false, reason: 'missing_property_id', message: 'Falta property_id' };
    }
    var shaped = shapeServiceRow(propertyId, serviceInput && serviceInput.provider, serviceInput);
    CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.SERVICES, shaped.row);
    return {
      ok: true,
      service: shaped.row,
      needsAttention: shaped.needsAttention || [],
      municipio: shaped.municipio,
    };
  }

  function addPropertyContact(propertyId, contactInput) {
    propertyId = String(propertyId || '').trim();
    if (!propertyId) {
      return { ok: false, reason: 'missing_property_id', message: 'Falta property_id' };
    }
    var existing = [];
    try {
      existing = (CM.Sheets.list(CM.Sheets.SHEET_NAMES.CONTACTS) || []).filter(function (c) {
        return String(c.property_id) === propertyId;
      });
    } catch (e) {
      existing = [];
    }
    var row = shapeContactRow(propertyId, contactInput, existing.length + 1);
    CM.Sheets.appendRow(CM.Sheets.SHEET_NAMES.CONTACTS, row);
    return { ok: true, contact: row };
  }

  function formatAddPropertySummary(result) {
    if (!result || !result.ok) {
      return (
        'No se creó la propiedad.\n' +
        ((result && result.message) || (result && result.reason) || 'error')
      );
    }
    var lines = [];
    lines.push('Propiedad creada: ' + result.property_id);
    if (result.property && result.property.property_name) {
      lines.push('Nombre: ' + result.property.property_name);
    }
    var svcs = result.services || [];
    lines.push(
      'Servicios (' +
        svcs.length +
        '): ' +
        (svcs.length
          ? svcs
              .map(function (s) {
                return s.provider;
              })
              .join(', ')
          : '(ninguno)')
    );
    var cts = result.contacts || [];
    lines.push(
      'Contactos (' +
        cts.length +
        '): ' +
        (cts.length
          ? cts
              .map(function (c) {
                return c.role + ':' + (c.name || c.email || c.contact_id);
              })
              .join(', ')
          : '(ninguno)')
    );
    if (result.drive && result.drive.ok) {
      lines.push('Drive folder: ' + (result.drive.folderName || result.drive.folderId));
    } else if (result.drive && !result.drive.skipped) {
      lines.push('Drive: no creado (' + (result.drive.message || result.drive.reason || '') + ')');
    }
    var attn = result.needsAttention || [];
    if (attn.length) {
      lines.push('');
      lines.push('Pendiente / atención:');
      attn.forEach(function (a) {
        lines.push('• ' + a);
      });
    }
    return lines.join('\n');
  }

  return {
    DEFAULT_PROVINCE: DEFAULT_PROVINCE,
    MUNICIPIO_REGISTRY: MUNICIPIO_REGISTRY,
    SERVICE_DEFS: SERVICE_DEFS,
    slugify: slugify,
    allocatePropertyId: allocatePropertyId,
    folderNameFromPropertyId: folderNameFromPropertyId,
    normalizeMunicipio: normalizeMunicipio,
    lookupMunicipio: lookupMunicipio,
    municipioFromService: municipioFromService,
    isMunicipalidadSupported: isMunicipalidadSupported,
    shapePropertyRow: shapePropertyRow,
    shapeServiceRow: shapeServiceRow,
    shapeContactRow: shapeContactRow,
    addProperty: addProperty,
    addPropertyService: addPropertyService,
    addPropertyContact: addPropertyContact,
    formatAddPropertySummary: formatAddPropertySummary,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.Properties;
}
