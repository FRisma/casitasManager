# Viabilidad de fetch de facturas (UrlFetchApp)

Fecha: **2026-11-04** · branch `cursor/casitasmanager-mvp-ca6c`  
Alcance: **Ecogas, OSSE (agua), Naturgy, Municipalidad de Rivadavia** (no OSDE).  
Reglas: no bypassear CAPTCHA/auth · no activar PROD · no inventar facturas/montos/catastro.

Detalle alineado con `docs/PROVIDERS.md` (sonda reconfirmada Cloud Agent 2026-11-04).

## Resumen

| Proveedor | UrlFetchApp lista/PDF hoy | Blockers | Camino a Drive | Próximo experimento seguro |
|-----------|---------------------------|----------|----------------|----------------------------|
| Ecogas | **Semi** (print sin Cookie) | reCAPTCHA para *listar*/descubrir `pp` | Auto PDF si pp conocido; Drive fallback | `setEcogasPrintPp` + `menuDescargarEcogas` |
| OSSE | **Sí** | Adapter/host viejo (`facturaweb.osse.ar` DNS-roto) | **Full auto** API `api/unidades/*` | Implementar adapter + `probeOsse()` en GAS |
| Naturgy | **No** | SPA React + token + Turnstile | Manual / semi-auto | Mapear XHR en browser (sesión humana) |
| Municipalidad | **Sí** | HTTP + VIEWSTATE frágil; requiere postback `rbTipoInm` | **Full auto** boleta PDF | `menuDescargarMunicipalidad` / `probeMunicipalidad()` |

Helpers MVP: `importManualInvoice` / `importManualInvoiceFromDrive` (`docs/OPERATIONS.md`).

## Ecogas — No (auto login); semi-auto sesión opcional

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p · cuenta `20259678`
- Form `POST logon?s=p&c=0` + **Google reCAPTCHA** → `auth_or_captcha_required`
- No POST con captcha inventado. **Preferir** menú Importar PDF Ecogas desde Drive.
- Post-login (Franco, 2026-11-04; cookies **no** en repo):
  - `GET …/uiextranet/index?s=p` + Cookie → landing
  - `GET …/uiextranet/res/panel_detalle_fact.php?d&c&t` XHR → detalle
  - `POST …/uiextranet/res/tra/reimp/impresion_jano.php` form Imprimir (`p,d,c,t=cuy,i=FA,logreimp,m,pp,form_pp`) vía `enviar()` / `#fdocdeu`
- Sonda: SID incompleto → 302 login; detalle anónimo → vacío.
- **Confirmado:** POST Imprimir **sin Cookie** → PDF. Cableado download con `pp`; listing portal **no** anónimo (no afirmarlo). Drive UX = fallback.

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
