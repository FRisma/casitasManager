/**
 * Definición de servicios de la propiedad Natania XV.
 * Municipalidad: sin número catastral → enabled=false.
 */

var CM = CM || {};
CM.ServiceCatalog = (function () {
  var PROPERTY = {
    property_id: 'natania-xv-m6c1',
    property_name: 'Natania XV — Manzana 6 Casa 1',
    address: 'Manzana 6, Casa 1, Barrio Natania XV',
    city: 'Rivadavia',
    province: 'San Juan',
    country: 'Argentina',
  };

  /**
   * Catálogo semilla (no inventa facturas ni estados de pago).
   * account/cadastral reales según datos del propietario.
   */
  var SERVICES = [
    {
      service_id: 'svc_naturgy_elec',
      property_id: PROPERTY.property_id,
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
      property_id: PROPERTY.property_id,
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
      property_id: PROPERTY.property_id,
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
      property_id: PROPERTY.property_id,
      provider: 'municipalidad',
      service_type: 'municipal_tax',
      account_number: '',
      secondary_identifier: '',
      cadastral_number: '',
      portal_url: 'http://181.209.107.110:83/deudavencida/deuda_total.aspx',
      enabled: false,
      notes:
        'INACTIVO: falta número catastral. No inventar. Activar vía hoja Services cuando se provea.',
    },
  ];

  function getPropertyDefaults() {
    return Object.assign({}, PROPERTY);
  }

  function getServiceSeeds() {
    return SERVICES.map(function (s) {
      return Object.assign({}, s);
    });
  }

  function getByProvider(providerId) {
    var id = String(providerId || '').toLowerCase();
    for (var i = 0; i < SERVICES.length; i++) {
      if (SERVICES[i].provider === id) return Object.assign({}, SERVICES[i]);
    }
    return null;
  }

  /** Orden de implementación / ejecución preferido. */
  function providerPriority() {
    return ['ecogas', 'osse', 'naturgy', 'municipalidad'];
  }

  return {
    getPropertyDefaults: getPropertyDefaults,
    getServiceSeeds: getServiceSeeds,
    getByProvider: getByProvider,
    providerPriority: providerPriority,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CM.ServiceCatalog;
}
