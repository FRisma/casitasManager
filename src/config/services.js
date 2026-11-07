/**
 * Catálogo semilla de propiedades + servicios.
 * Natania XV (Rivadavia) + Justo Castro (Caucete: DECSA + OSSE).
 * Municipalidad Natania: nomenclatura Franco `322047490000` (Inmueble / boleta mensual).
 * Cuentas Caucete: DECSA codSum/titular + OSSE 14 dígitos (texto, leading zero).
 */

var CM = CM || {};
CM.ServiceCatalog = (function () {
  var NATANIA = {
    property_id: 'natania-xv-m6c1',
    property_name: 'Natania XV — Manzana 6 Casa 1',
    address: 'Manzana 6, Casa 1, Barrio Natania XV',
    city: 'Rivadavia',
    province: 'San Juan',
    country: 'Argentina',
  };

  var JUSTO_CASTRO = {
    property_id: 'justo-castro',
    property_name: 'Justo Castro 2 MH C11',
    address: 'Juan de Dios Flores s/n, Barrio Justo P. Castro II, Mza H C11',
    city: 'Caucete',
    province: 'San Juan',
    country: 'Argentina',
  };

  var PROPERTIES = [NATANIA, JUSTO_CASTRO];

  /**
   * Catálogo semilla (no inventa facturas ni estados de pago).
   * account/cadastral reales según datos del propietario.
   */
  var SERVICES = [
    {
      service_id: 'svc_naturgy_elec',
      property_id: NATANIA.property_id,
      provider: 'naturgy',
      service_type: 'electricity',
      account_number: '20004193466',
      secondary_identifier: '0142679',
      cadastral_number: '',
      portal_url: 'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta',
      enabled: true,
      notes: 'Suministro Naturgy SJ; medidor 0142679. Portal SPA (React).',
    },
    {
      service_id: 'svc_ecogas_gas',
      property_id: NATANIA.property_id,
      provider: 'ecogas',
      service_type: 'gas',
      account_number: '20259678',
      secondary_identifier: '',
      cadastral_number: '',
      portal_url: 'https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p',
      enabled: true,
      notes: 'Portal con reCAPTCHA — automatización UrlFetch limitada.',
    },
    {
      service_id: 'svc_osse_water',
      property_id: NATANIA.property_id,
      provider: 'osse',
      service_type: 'water',
      account_number: '119 0080934 000 1',
      secondary_identifier: '60358',
      cadastral_number: '023220474900000',
      portal_url: 'https://facturaweb.osse.com.ar/',
      enabled: true,
      notes:
        'Unidad SISA 60358. API pública /api/unidades (14 dígitos cuenta). Host viejo facturaweb.osse.ar no resuelve.',
    },
    {
      service_id: 'svc_muni_cadastral',
      property_id: NATANIA.property_id,
      provider: 'municipalidad',
      service_type: 'municipal_tax',
      account_number: '',
      secondary_identifier: '',
      cadastral_number: '322047490000',
      portal_url: 'http://181.209.107.110:83/deudavencida/deuda_total.aspx',
      enabled: true,
      notes:
        'Nomenclatura Inmueble Natania XV (txtIndice). Flujo ASP.NET: rbTipoInm → BUSCAR → boleta PDF. Portal HTTP (no HTTPS).',
    },
    {
      service_id: 'svc_decsa_justo',
      property_id: JUSTO_CASTRO.property_id,
      provider: 'decsa',
      service_type: 'electricity',
      account_number: '1063',
      secondary_identifier: '948',
      cadastral_number: '',
      portal_url: 'https://www.cooponlineweb.com.ar/DECSA/',
      enabled: true,
      notes:
        'Caucete Facturación Conjunta luz+agua. account_number=codSum/newKey; secondary=titular/newAccount. Opcional OSSE aparte.',
    },
    {
      service_id: 'svc_osse_justo',
      property_id: JUSTO_CASTRO.property_id,
      provider: 'osse',
      service_type: 'water',
      // Texto con leading zero — Sheets numérico lo pierde; resolveService / accountDigits re-pad.
      account_number: '02400051550004',
      secondary_identifier: '',
      cadastral_number: '',
      portal_url: 'https://facturaweb.osse.com.ar/',
      enabled: true,
      notes:
        'OSSE Caucete Justo Castro (14 dígitos texto). Path OSSE+DECSA: agua sola vía OSSE; conjunta vía DECSA.',
    },
  ];

  /** Propiedad bootstrap legacy (Natania). */
  function getPropertyDefaults() {
    return Object.assign({}, NATANIA);
  }

  /** Todas las propiedades semilla (Natania + Justo Castro). */
  function getPropertySeeds() {
    return PROPERTIES.map(function (p) {
      return Object.assign({}, p);
    });
  }

  function getServiceSeeds() {
    return SERVICES.map(function (s) {
      return Object.assign({}, s);
    });
  }

  /**
   * Primera fila del provider en el catálogo (legacy / Natania primero).
   * Para Caucete usá resolveService(propertyId, provider).
   */
  function getByProvider(providerId) {
    var id = String(providerId || '').toLowerCase();
    for (var i = 0; i < SERVICES.length; i++) {
      if (SERVICES[i].provider === id) return Object.assign({}, SERVICES[i]);
    }
    return null;
  }

  /** Orden de implementación / ejecución preferido. */
  function providerPriority() {
    return ['ecogas', 'osse', 'naturgy', 'decsa', 'municipalidad'];
  }

  return {
    getPropertyDefaults: getPropertyDefaults,
    getPropertySeeds: getPropertySeeds,
    getServiceSeeds: getServiceSeeds,
    getByProvider: getByProvider,
    providerPriority: providerPriority,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.ServiceCatalog;
}
