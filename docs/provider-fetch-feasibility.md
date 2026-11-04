# Viabilidad de fetch de facturas (UrlFetchApp)

Fecha: **2026-11-04** · branch `cursor/casitasmanager-mvp-ca6c`  
Alcance: **Ecogas, OSSE (agua), Naturgy, Municipalidad de Rivadavia** (no OSDE).  
Reglas: no bypassear CAPTCHA/auth · no activar PROD · no inventar facturas/montos/catastro.

Detalle alineado con `docs/PROVIDERS.md` (sonda reconfirmada Cloud Agent 2026-11-04).

## Resumen

| Proveedor | UrlFetchApp lista/PDF hoy | Blockers | Camino a Drive | Próximo experimento seguro |
|-----------|---------------------------|----------|----------------|----------------------------|
| Ecogas | **No** (login) | reCAPTCHA; PDF URL aún no vista en detalle | Manual Drive UX; semi-auto Cookie opcional | `menuImportarPdfEcogas`; `probeEcogasSession` |
| OSSE | **Sí** | Adapter/host viejo (`facturaweb.osse.ar` DNS-roto) | **Full auto** API `api/unidades/*` | Implementar adapter + `probeOsse()` en GAS |
| Naturgy | **No** | SPA React + token + Turnstile | Manual / semi-auto | Mapear XHR en browser (sesión humana) |
| Municipalidad | **Sí** | HTTP + VIEWSTATE frágil; requiere postback `rbTipoInm` | **Full auto** boleta PDF | `menuDescargarMunicipalidad` / `probeMunicipalidad()` |

Helpers MVP: `importManualInvoice` / `importManualInvoiceFromDrive` (`docs/OPERATIONS.md`).

## Ecogas — No (auto login); semi-auto sesión opcional

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p · cuenta `20259678`
- Form `POST logon?s=p&c=0` + **Google reCAPTCHA** → `auth_or_captcha_required`
- No POST con captcha inventado. **Preferir** menú Importar PDF Ecogas desde Drive.
- Post-login curls (Franco, 2026-11-04; cookies **no** en repo):
  - `GET …/uiextranet/index?s=p` + Cookie → landing
  - `GET …/uiextranet/res/panel_detalle_fact.php?d=…&c=20259678&t=…` XHR → HTML detalle (**sin PDF URL** en el capture)
- Sonda Cloud Agent: SID incompleto/expirado → 302 login; detalle anónimo → body vacío.
- Próximo seguro: con cookie fresca + `d`/`t` vivos, `probeEcogasInvoiceDetail` → si aparece link `.pdf`/descarga, GET + `looksLikePdf`; si no, scrapear HTML real a fixture y ampliar parser.

## OSSE (agua) — Sí

**Host correcto:** `https://facturaweb.osse.com.ar/` (institucional: `www.ossesanjuan.com.ar`).  
**Host incorrecto en seed previo:** `facturaweb.osse.ar` → ENOTFOUND.

API pública (sin CAPTCHA en sonda), cuenta 14 dígitos `11900809340001` (SISA `60358`):

1. `GET /api/unidades/UnidadByUnidadAlt?unidadAlt={14dig}` → `guidId`
2. `GET /api/unidades/UltimasFacturas?guidId=` → lista (`tpoCom`,`preCom`,`numCom`,`sPeriodo`,`totalBas`,`fecVen`,…)
3. `GET /api/unidades/ImprimirFactura?guidId=&tpoCom=&preCom=&numCom=` → PDF (`%PDF`)

Sonda: listado 200 JSON; PDF reciente válido. Preferir `ImprimirFactura` (no `DescargarFacturaDigital/{id}`, 500 en prueba).

## Naturgy — No

- SPA Widergy; `/api/v1/bills/*` sin token → HTML shell.
- Turnstile/CF. Manual hasta token legítimo (sin bypass).

## Municipalidad — Sí (boleta ASP.NET)

- Portal HTTP: `http://181.209.107.110:83/deudavencida/deuda_total.aspx`
- Nomenclatura: `322047490000`
- Flujo: GET → POST `rbTipoInm` → BUSCAR → `btnBoleta`+`Procesar` → PDF (~65KB)
- Limitaciones: no HTTPS; VIEWSTATE frágil; sin CAPTCHA bypass

## Prioridad post-doc

1. OSSE + Municipalidad auto (implementados).  
2. Ecogas/Naturgy: seguir manual / UX import.
