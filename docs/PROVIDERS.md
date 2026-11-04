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
| Municipalidad | **Sí** (ASP.NET boleta PDF; HTTP) | `downloaded_ok` | `menuDescargarMunicipalidad` / `runProvider` |

**Ningún adapter inventa facturas, montos ni estados de pago.** No bypassear CAPTCHA/auth.

---

## Ecogas (gas)

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  
- Cuenta: `20259678`
- Form `POST logon?s=p&c=0` (`#form_login_po`) con `input#cliente`, token hidden, **Google reCAPTCHA**.
- Apps Script no puede resolver captcha (no bypassear).
- **MVP / camino honesto:** menú **Importar PDF Ecogas desde Drive** (fileId/URL o Inbox-Manual) → `importManualInvoiceFromDrive` (ver OPERATIONS). Sin bypass de reCAPTCHA.
- **Post-login (sesión humana, 2026-11-04):**
  1. `GET /uiextranet/index?s=p` + Cookie jar (SID + F5/TS/…) → landing
  2. `GET /uiextranet/res/panel_detalle_fact.php?d=…&c=20259678&t=…` (XHR) → HTML detalle
  3. **Imprimir PDF (DOM):** `POST /uiextranet/res/tra/reimp/impresion_jano.php`  
     `enviar()` → `$('#fdocdeu'+$('#impresion').val()).submit()`  
     fields: `p=0401`, `d=60797913`, `c=000020259678`, `t=cuy`, `i=FA`, `logreimp=S`, `m=p`, `pp=0401B60797913A`, `form_pp=PP`  
     (`pp` compuesto; `c` padded vs cuenta `20259678`; `t=cuy` ≠ token largo del detalle)
  - **PDF confirmado (2026-11-04):** POST Imprimir → `200` `application/pdf` ~313KB `%PDF-1.5` **sin Cookie** si form completo (`p,d,c,t,i,pp,…`). Filename `factura-debito-ECOGAS-nro-…`.
  - **Listing / descubrir `pp`:** sigue requiriendo login humano (reCAPTCHA) — no hay listado anónimo.
  - **Auto-download** cuando `pp` conocido (`setEcogasPrintPp` / prompt menú) → `menuDescargarEcogas` / `downloadEcogasSessionInvoice`.
  - **Fallback:** menú **Importar PDF Ecogas desde Drive**. Cookie Script Property solo si hace falta para listing futuro; **nunca** en repo.

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
- Adapter `src/providers/osse.js`: `checkAvailability` / `fetchInvoices` / `downloadInvoice` vía UrlFetchApp; PDF → Drive (`saveInvoicePdf`) + upsert dedupe. Menú `menuDescargarOsse` y `runProvider('osse')` cableados.
- Cuenta desde hoja Services: strip no-dígitos → 14 chars. Seed `portal_url` = `https://facturaweb.osse.com.ar/` (`seedIfEmpty` repara `.osse.ar` viejo).
- No reportar lista vacía como “sin facturas” si el portal/API falla. Sin CAPTCHA bypass.

## Naturgy San Juan (luz)

- Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta  
- Suministro: `20004193466` · Medidor: `0142679`
- Shell React; bundle `main.*.chunk.js` referencia Widergy:
  - `/api/v1/bills/public_pdf` (query `token`)
  - `/api/v1/bills/bill_detail`
  - `/api/v1/accounts/payment_information`
- Sonda UrlFetch **sin token**: HTTP 200 `text/html` (SPA shell), no PDF/JSON.
- Señales Cloudflare Turnstile / CF en el HTML.
- **MVP:** menú **Importar PDF desde Drive…** (`provider=naturgy`) o `importManualInvoiceFromDrive` (ver OPERATIONS). Automatizar solo con flujo de token legítimo (sin bypassear anti-bot).

## Municipalidad de Rivadavia

- Portal (**HTTP, no HTTPS**): http://181.209.107.110:83/deudavencida/deuda_total.aspx  
- Nomenclatura Natania XV: **`322047490000`** (`txtIndice`; máx 12 tras postback Inmueble).
- Formulario ASP.NET clásico: `__VIEWSTATE` / `__VIEWSTATEGENERATOR` / `__EVENTVALIDATION`, radios, `btnBuscar`, `btnBoleta` (image), grilla `gvSeleccion$ctlNN$Procesar`.
- Flujo auto verificado (sin CAPTCHA):
  1. GET página
  2. POST `__EVENTTARGET=rbTipoInm` (**obligatorio** — sin esto `txtIndice` queda máx 8 y BUSCAR falla)
  3. POST `btnBuscar=BUSCAR` (`tipo=rbTipoInm`, `txtIndice`, `txtFecha=DD/MM/YYYY`, `rivadavia=rbMensual`)
  4. POST `btnBoleta.x` / `btnBoleta.y` + checkbox `Procesar=on` → PDF (`%PDF-1.4`)
- Adapter `src/providers/municipalidad.js`: parsea grilla (Año/Cuota/ImpTotal/Vencimiento); PDF → Drive + upsert. Menú `menuDescargarMunicipalidad` y `runProvider('municipalidad')` cableados (`maxDownloads=1`).
- Seed: `cadastral_number=322047490000`, `enabled=true`. `seedIfEmpty` repara filas viejas vacías/disabled.
- **Limitaciones:** transporte HTTP; VIEWSTATE frágil si cambia el markup; cookie de sesión entre pasos; no CAPTCHA bypass si aparece.

---

## Outcomes del interface

Ver `src/providers/provider-interface.js`:  
`invoice_not_available_yet`, `available_not_downloadable`, `downloaded_ok`, `portal_inaccessible`, `portal_structure_changed`, `missing_property_info`, `auth_or_captcha_required`, `disabled`, `not_implemented`, `error`.

Regla: **no** tratar todo fallo HTTP como “no hay facturas este mes”.
