# Proveedores — investigación y limitaciones

Fecha de sonda HTTP (Cloud Agent): **2026-11-04** (reconfirmada + API OSSE).  
Orden de prioridad implementación fetch: **OSSE → Municipalidad (tras catastro) → Ecogas/Naturgy (manual)**.  
Informe extendido: `docs/provider-fetch-feasibility.md`.

## Resumen ejecutivo

| Proveedor | Automatizable con UrlFetchApp hoy | Outcome típico | Acción owner |
|-----------|-----------------------------------|----------------|--------------|
| Ecogas | **Sí con nº comprobante** (Imprimir sin cookie); listing **No** (reCAPTCHA) | `downloaded_ok` / `auth_or_captcha_required` | Menú comprobante o Drive |
| OSSE | **Sí** (API pública `api/unidades/*`) | `downloaded_ok` (tras implementar adapter) | Preferir auto; manual OK |
| Naturgy | **No** (SPA + token / Turnstile) | `auth_or_captcha_required` | Carga manual PDF |
| Municipalidad | **Sí** (ASP.NET boleta PDF; HTTP) | `downloaded_ok` | `menuDescargarMunicipalidad` / `runProvider` |
| DECSA (Caucete) | **Sí** (login hub + Facturas + Descarga JSON→PDF) | `downloaded_ok` | `menuDescargarDecsa` / `setDecsaCredentials` |

**Ningún adapter inventa facturas, montos ni estados de pago.** No bypassear CAPTCHA/auth.

---

## Ecogas (gas)

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  
- Cuenta: `20259678`
- Form `POST logon?s=p&c=0` (`#form_login_po`) con `input#cliente`, token hidden, **Google reCAPTCHA**.
- Apps Script no puede resolver captcha (no bypassear) → **no hay listing anónimo**.
- **PDF auto (confirmado):** con nº de **comprobante** (UI Ecogas; form field `pp`, ej. `0401B60797913A`) →  
  `POST /uiextranet/res/tra/reimp/impresion_jano.php` (p/d/c padded/t=cuy/i=FA/…/**pp**/form_pp=PP) → PDF **sin Cookie**.  
  Menú: **Descargar Ecogas por comprobante…**. Editor: `setEcogasPrintPp` / `downloadEcogasSessionInvoice`.
- **Metadata del PDF:** tras Imprimir, se scrapean strings Tj/TJ (`IMPORTE $…`, `Total a pagar hasta el DD/MM/YYYY`, `Fecha de emisión`) → `amount` / `due_date` / `issue_date` en Invoices. No usar `TOTAL FACTURA` (pre–NC). Si falla el parse → prompt de monto en menú.
- **Fallback:** **Importar PDF Ecogas desde Drive** / `importManualInvoiceFromDrive` (ver OPERATIONS).
- Nunca commitear cookies ni inventar montos.

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

- Portal SPA: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta  
- API real: **`https://utilitygo.widergy.com/`** (`Utility-ID: 23`, `Channel: web`). El origin SPA sirve HTML shell para `/api/*` — no usarlo como API.
- Suministro: `20004193466` · Medidor: `0142679`
- **Listing sin sesión (2026-11-04):**  
  `GET /api/v1/accounts/complete_debts?client_number=20004193466&gateway=mercadopago`  
  → 202 `{url}` → `GET url` → `{account, debts[]}`. Adapter `fetchInvoices` cableado.
- **PDF (auto, Franco OK):**  
  1. `POST /api/v1/users/sessions` `{email,password}` → `access_token` (JWT)  
  2. `GET /api/v1/bills/printed_bill?client_number=&external_id=<document_number>` + `Authorization: <JWT>` (sin Bearer) → 202 job  
  3. Poll job (mismo Auth) → `{base64}` → decode PDF → Drive  
  Credenciales solo Script Properties (`NATURGY_EMAIL` / `NATURGY_PASSWORD`); JWT cache `NATURGY_SESSION_TOKEN`. **Nunca commit ni log password.**  
  `external_id` query = `document_number` (ej. `143292286`), no el compound `17-…`.
- Ops: `setNaturgyCredentials(email, password)` → `menuDescargarNaturgy`. Fallback Drive: **Importar PDF Naturgy**.
- Listing `complete_debts` sigue **sin** auth. No bypass Turnstile.

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

## DECSA Caucete (luz+agua conjunta)

- Portal: https://www.cooponlineweb.com.ar/DECSA/ (CoopOnlineWeb Razor Pages).
- **Sin API pública** por titular+cuenta (probe 2026-11-07 cerrado negativo) → Branch B sesión.
- Credenciales hub: Script Properties `DECSA_EMAIL` / `DECSA_PASSWORD` (`setDecsaCredentials`). **Nunca commit/log password.**
- Services: `account_number` = `Input.newKey` / `codSum`; `secondary_identifier` = `Input.newAccount` (titular).
- Flujo:
  1. GET `/Login` → scrape `__RequestVerificationToken` + antiforgery
  2. POST `/Login` (`Input.Email` / `Input.Password` / `RememberMe=false`) → `.AspNetCore.Cookies`
  3. Opcional POST `/Principal` AddAccount (`Input.newAccount` + `Input.newKey`) — idempotente si ya vinculado
  4. GET `/Facturas` (cookie `codSum`) → parse `RowToPay` / montos / `descargarFactura(nro, codSum, path)`
  5. GET `Facturas?handler=Descarga&NroFactura={nro}%7C{codSum}&PathFile=` → **JSON string URL** (no PDF)
  6. GET esa URL (`api.cooponlineweb.com.ar`) → 302 S3 → `%PDF`
- PDF = Facturación Conjunta; list `IMPORTE` = total DECSA; anclas opcionales `TOTAL OSSE` / `TOTAL A PAGAR` / conjunta.
- Menú `menuDescargarDecsa` / `runProvider('decsa')`. Fixtures: `tests/fixtures/decsa/`. Fallback Drive: **Importar PDF DECSA**.
- No CAPTCHA visto en login capturado; si aparece → `auth_or_captcha_required` (no bypass).

---

## Outcomes del interface

Ver `src/providers/provider-interface.js`:  
`invoice_not_available_yet`, `available_not_downloadable`, `downloaded_ok`, `portal_inaccessible`, `portal_structure_changed`, `missing_property_info`, `auth_or_captcha_required`, `disabled`, `not_implemented`, `error`.

Regla: **no** tratar todo fallo HTTP como “no hay facturas este mes”.
