# Proveedores — investigación y limitaciones

Fecha de sonda HTTP (Cloud Agent): **2026-11-04** (reconfirmada + API OSSE).  
Orden de prioridad implementación fetch: **OSSE → Municipalidad (tras catastro) → Ecogas/Naturgy (manual)**.  
Informe extendido: `docs/provider-fetch-feasibility.md`.

## Resumen ejecutivo

| Proveedor | Automatizable con UrlFetchApp hoy | Outcome típico | Acción owner |
|-----------|-----------------------------------|----------------|--------------|
| Ecogas | **No** (reCAPTCHA) | `auth_or_captcha_required` | Carga manual PDF |
| OSSE | **Sí** (API pública `api/unidades/*`) | `downloaded_ok` (tras implementar adapter) | Preferir auto; manual OK |
| Naturgy | **No** (SPA + token / Turnstile) | `auth_or_captcha_required` | Carga manual PDF |
| Municipalidad | **Parcial** (form OK; sin catastro) | `missing_property_info` / `disabled` | Proveer catastro en Sheets |

**Ningún adapter inventa facturas, montos ni estados de pago.** No bypassear CAPTCHA/auth.

---

## Ecogas (gas)

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  
- Cuenta: `20259678`
- Form `POST logon?s=p&c=0` (`#form_login_po`) con `input#cliente`, token hidden, **Google reCAPTCHA**.
- Apps Script no puede resolver captcha (no bypassear).
- **MVP:** `importManualInvoice` / `importManualInvoiceFromDrive` (ver OPERATIONS).

## OSSE (agua) — no OSDE

- **Portal correcto:** https://facturaweb.osse.com.ar/ (SPA Angular “Web Area Clientes OSSE”).
- Institucional: https://www.ossesanjuan.com.ar/v4/ (“Tu factura en un click” enlaza a facturaweb).
- **Host incorrecto (seed/docs viejos):** `facturaweb.osse.ar` → DNS ENOTFOUND. `osse.com.ar` sin registro A.
- Cuenta: `119 0080934 000 1` → API usa **14 dígitos** `11900809340001` · SISA/`unidadId`: `60358` · Catastro prop.: `023220474900000`
- API (sonda 2026-11-04, **sin CAPTCHA** en estos GET):
  1. `GET /api/unidades/UnidadByUnidadAlt?unidadAlt={14dig}` → `guidId`
  2. `GET /api/unidades/UltimasFacturas?guidId=` → lista (periodo, montos, `tpoCom`/`preCom`/`numCom`)
  3. `GET /api/unidades/ImprimirFactura?guidId=&tpoCom=&preCom=&numCom=` → PDF
- Evitar `DescargarFacturaDigital/{id}` a ciegas (500 en prueba).
- Adapter: actualizar `portal_url` + implementar fetch/download. Hasta entonces, carga manual válida.
- No reportar lista vacía como “sin facturas” si el portal/API falla.

## Naturgy San Juan (luz)

- Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta  
- Suministro: `20004193466` · Medidor: `0142679`
- Shell React; bundle `main.*.chunk.js` referencia Widergy:
  - `/api/v1/bills/public_pdf` (query `token`)
  - `/api/v1/bills/bill_detail`
  - `/api/v1/accounts/payment_information`
- Sonda UrlFetch **sin token**: HTTP 200 `text/html` (SPA shell), no PDF/JSON.
- Señales Cloudflare Turnstile / CF en el HTML.
- **MVP:** carga manual. Automatizar solo con flujo de token legítimo (sin bypassear anti-bot).

## Municipalidad de Rivadavia

- Portal: http://181.209.107.110:83/deudavencida/deuda_total.aspx  
- Formulario ASP.NET: `__VIEWSTATE`, `__EVENTVALIDATION`, `txtIndice` (nomenclatura, máx 16), radios Inmueble/Comercio, `rbMensual` / deuda, `btnBuscar`, `btnBoleta`.
- **Catastro: no disponible** → servicio seed con `enabled=false`, `cadastral_number` vacío.
- Activación: completar catastro en hoja Services + `enabled=TRUE` (sin inventar número); luego POST + parser.

---

## Outcomes del interface

Ver `src/providers/provider-interface.js`:  
`invoice_not_available_yet`, `available_not_downloadable`, `downloaded_ok`, `portal_inaccessible`, `portal_structure_changed`, `missing_property_info`, `auth_or_captcha_required`, `disabled`, `not_implemented`, `error`.

Regla: **no** tratar todo fallo HTTP como “no hay facturas este mes”.
