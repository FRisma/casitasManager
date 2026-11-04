# Viabilidad de fetch de facturas (UrlFetchApp)

Fecha: **2026-11-04** · branch `cursor/casitasmanager-mvp-ca6c`  
Alcance: **Ecogas, OSSE (agua), Naturgy, Municipalidad de Rivadavia** (no OSDE).  
Reglas: no bypassear CAPTCHA/auth · no activar PROD · no inventar facturas/montos/catastro.

Detalle alineado con `docs/PROVIDERS.md` (sonda reconfirmada Cloud Agent 2026-11-04).

## Resumen

| Proveedor | UrlFetchApp lista/PDF hoy | Blockers | Camino a Drive | Próximo experimento seguro |
|-----------|---------------------------|----------|----------------|----------------------------|
| Ecogas | **No** | reCAPTCHA en login | Manual / semi-auto | `probeEcogas()` (GET only) |
| OSSE | **Sí** | Adapter/host viejo (`facturaweb.osse.ar` DNS-roto) | **Full auto** API `api/unidades/*` | Implementar adapter + `probeOsse()` en GAS |
| Naturgy | **No** | SPA React + token + Turnstile | Manual / semi-auto | Mapear XHR en browser (sesión humana) |
| Municipalidad | **Parcial** | Sin catastro; parser POST pendiente | Manual → auto tras catastro | Cargar catastro en Sheets + `probeMunicipalidad()` |

Helpers MVP: `importManualInvoice` / `importManualInvoiceFromDrive` (`docs/OPERATIONS.md`).

## Ecogas — No

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p · cuenta `20259678`
- Form `POST logon?s=p&c=0` + **Google reCAPTCHA** → `auth_or_captcha_required`
- No POST con captcha inventado. Carga manual de PDF.

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

## Municipalidad — Parcial

- ASP.NET en `http://181.209.107.110:83/deudavencida/deuda_total.aspx` (`txtIndice`, `__VIEWSTATE`, `btnBuscar`).
- Inactivo hasta `cadastral_number` real + `enabled=TRUE`. Luego POST + parseo.

## Prioridad post-doc

1. Implementar fetch OSSE full auto.  
2. Catastro Municipalidad.  
3. Ecogas/Naturgy: seguir manual.
