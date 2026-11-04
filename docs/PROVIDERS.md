# Proveedores — investigación y limitaciones

Fecha de sonda HTTP (Cloud Agent): **2026-11-04**.  
Orden de prioridad: Ecogas → OSSE → Naturgy → Municipalidad.

## Resumen ejecutivo

| Proveedor | Automatizable con UrlFetchApp hoy | Outcome típico | Acción owner |
|-----------|-----------------------------------|----------------|--------------|
| Ecogas | **No** (reCAPTCHA) | `auth_or_captcha_required` | Carga manual PDF / captura asistida |
| OSSE | **Pendiente** (DNS falló en cloud; re-probar en GAS) | `portal_inaccessible` o `not_implemented` | `probeOsse()` tras auth |
| Naturgy | **No** (SPA React sin API pública hallada) | `not_implemented` / structure | Mapear XHR en browser |
| Municipalidad | **Inactivo** (sin catastro) | `missing_property_info` / `disabled` | Proveer catastro en Sheets |

**Ningún adapter inventa facturas, montos ni estados de pago.**

---

## Ecogas (gas)

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  
- Cuenta: `20259678`
- Form `POST logon?s=p&c=0` (`#form_login_po`) con `input#cliente`, token hidden, **Google reCAPTCHA**.
- Apps Script no puede resolver captcha (no bypassear).
- **MVP:** `importManualInvoice` / `importManualInvoiceFromDrive` (ver OPERATIONS).

## OSSE (agua)

- Portal declarado: https://facturaweb.osse.ar  
- Cuenta: `119 0080934 000 1` · Catastro: `023220474900000` · SISA: `60358`
- Cloud VM (2026-11-04): **DNS ENOTFOUND** también para `www` / `autofactura` / `oficina.osse.com.ar`.
- Adapter prueba varias URLs; en GAS ejecutar `probeOsse()` (red Google puede diferir).
- No reportar lista vacía como “sin facturas”; outcome `portal_inaccessible` + carga manual.

## Naturgy San Juan (luz)

- Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta  
- Suministro: `20004193466` · Medidor: `0142679`
- Shell React; bundle `main.*.chunk.js` referencia Widergy:
  - `/api/v1/bills/public_pdf` (query `token`)
  - `/api/v1/bills/bill_detail`
  - `/api/v1/accounts/payment_information`
- Sonda UrlFetch **sin token**: HTTP 200 `text/html` (SPA shell), no PDF/JSON.
- Dependencias del bundle incluyen Cloudflare Turnstile.
- **MVP:** carga manual. Automatizar solo si Franco aporta flujo de token legítimo (sin bypassear anti-bot).

## Municipalidad de Rivadavia

- Portal: http://181.209.107.110:83/deudavencida/deuda_total.aspx  
- Formulario ASP.NET: `__VIEWSTATE`, `txtIndice` (índice/catastro), `btnBuscar`.
- **Catastro: no disponible** → servicio seed con `enabled=false`, `cadastral_number` vacío.
- Activación: completar catastro en hoja Services + `enabled=TRUE` (sin inventar número).

---

## Outcomes del interface

Ver `src/providers/provider-interface.js`:  
`invoice_not_available_yet`, `available_not_downloadable`, `downloaded_ok`, `portal_inaccessible`, `portal_structure_changed`, `missing_property_info`, `auth_or_captcha_required`, `disabled`, `not_implemented`, `error`.

Regla: **no** tratar todo fallo HTTP como “no hay facturas este mes”.
